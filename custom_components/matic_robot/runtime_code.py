"""Bounded identity of active source-defined Python code, without robot I/O.

This is an operational stale-code check, not whole-process attestation. Module
initialization code, globals/closure values, generated code, dependencies and
aliases held outside the inspected bindings are not measured.
"""

from __future__ import annotations

import ast
import dataclasses
import hashlib
import json
import os
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from types import CodeType, FunctionType, ModuleType
from typing import Any

MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_SOURCE_BYTES = 8 * 1024 * 1024
# Allow the current split integration while bounding catalog traversal.
MAX_MODULES = 192
MAX_TREE_ENTRIES = 512
MAX_TREE_DEPTH = 16
MAX_IDENTITY_FAILURES = 16
_GENERATED_METHODS = frozenset(
    {
        "__init__",
        "__repr__",
        "__eq__",
        "__lt__",
        "__le__",
        "__gt__",
        "__ge__",
        "__hash__",
        "__setattr__",
        "__delattr__",
        "__getstate__",
        "__setstate__",
    }
)


@dataclasses.dataclass(frozen=True, slots=True)
class RuntimeCodeSnapshot:
    """Keep object references private while rechecking after the executor await."""

    report: dict[str, Any]
    bindings_unchanged: Callable[[], bool]


def _source_paths(root: Path) -> list[Path]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("source root")
    pending = [(root, 0)]
    paths: list[Path] = []
    count = 0
    while pending:
        directory, depth = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                count += 1
                if count > MAX_TREE_ENTRIES or entry.is_symlink():
                    raise ValueError("source tree bound")
                if entry.name in ("proto", "__pycache__"):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if depth >= MAX_TREE_DEPTH:
                        raise ValueError("source depth bound")
                    pending.append((Path(entry.path), depth + 1))
                elif entry.name.endswith(".py"):
                    paths.append(Path(entry.path))
                    if len(paths) > MAX_MODULES:
                        raise ValueError("source module bound")
    if not paths:
        raise ValueError("empty source tree")
    return sorted(paths)


def _constant(value: Any) -> Any:
    if isinstance(value, CodeType):
        return ["code", _code_fields(value)]
    if isinstance(value, (tuple, frozenset)):
        items = [_constant(item) for item in value]
        if isinstance(value, frozenset):
            items.sort(key=lambda item: json.dumps(item, sort_keys=True))
        return [type(value).__name__, items]
    return [type(value).__name__, repr(value)]


def _code_fields(code: CodeType) -> dict[str, Any]:
    return {
        "arguments": [
            code.co_argcount,
            code.co_posonlyargcount,
            code.co_kwonlyargcount,
        ],
        "locals": code.co_nlocals,
        "stack": code.co_stacksize,
        "flags": code.co_flags,
        "bytecode": code.co_code.hex(),
        "constants": [_constant(value) for value in code.co_consts],
        "names": code.co_names,
        "variables": code.co_varnames,
        "free_variables": code.co_freevars,
        "cell_variables": code.co_cellvars,
        "name": code.co_name,
        "qualified_name": code.co_qualname,
        "first_line": code.co_firstlineno,
        "line_table": code.co_linetable.hex(),
        "exception_table": code.co_exceptiontable.hex(),
    }


def _code_hash(code: CodeType) -> str:
    return hashlib.sha256(
        json.dumps(_code_fields(code), sort_keys=True).encode()
    ).hexdigest()


def _compiled_codes(code: CodeType) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    pending = [code]
    while pending:
        current = pending.pop()
        fingerprint = _code_hash(current)
        result.setdefault(current.co_qualname, set()).add(fingerprint)
        result.setdefault(f"{current.co_qualname}:{current.co_firstlineno}", set()).add(
            fingerprint
        )
        pending.extend(
            value for value in current.co_consts if isinstance(value, CodeType)
        )
    return result


def _source_binding_error(
    module: ModuleType, tree: ast.Module, expected: dict[str, set[str]]
) -> tuple[str, int] | None:
    """Missing/replaced declared bindings must not disappear from the sample."""
    pending: list[tuple[Any, str, list[ast.stmt]]] = [(module, "", tree.body)]
    while pending:
        owner, prefix, body = pending.pop()
        for node in body:
            if not isinstance(
                node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
            ):
                continue
            qualified = prefix + node.name
            value = vars(owner).get(node.name)
            if isinstance(node, ast.ClassDef):
                if (
                    not isinstance(value, type)
                    or value.__module__ != module.__name__
                    or value.__qualname__ != qualified
                ):
                    return "class_binding", node.lineno
                pending.append((value, qualified + ".", node.body))
                continue
            descriptors = {
                decorator.id
                for decorator in node.decorator_list
                if isinstance(decorator, ast.Name)
            }
            if any(
                isinstance(decorator, ast.Attribute)
                and decorator.attr in ("setter", "deleter")
                for decorator in node.decorator_list
            ):
                descriptors.add("property")
            for kind, descriptor in (
                ("property", property),
                ("staticmethod", staticmethod),
                ("classmethod", classmethod),
            ):
                if (kind in descriptors) != isinstance(value, descriptor):
                    return "descriptor_binding", node.lineno
            if isinstance(value, (staticmethod, classmethod)):
                value = value.__func__
            if isinstance(value, property):
                role = next(
                    (
                        d.attr
                        for d in node.decorator_list
                        if isinstance(d, ast.Attribute)
                        and d.attr in ("setter", "deleter")
                    ),
                    "getter",
                )
                value = {
                    "getter": value.fget,
                    "setter": value.fset,
                    "deleter": value.fdel,
                }[role]
            if (dbus_function := _dbus_function(value)) is not None:
                value = dbus_function
            seen: set[int] = set()
            if not isinstance(value, FunctionType) or (
                value.__module__ != module.__name__ or value.__qualname__ != qualified
            ):
                return "function_metadata", node.lineno
            while isinstance(value, FunctionType) and isinstance(
                wrapped := vars(value).get("__wrapped__"), FunctionType
            ):
                if id(value) in seen:
                    return "wrapper_cycle", node.lineno
                seen.add(id(value))
                if (
                    value.__code__.co_qualname in expected
                    and value.__code__.co_filename != module.__file__
                ):
                    return "wrapper_origin", node.lineno
                value = wrapped
            first_line = (
                node.decorator_list[0].lineno if node.decorator_list else node.lineno
            )
            if (
                not isinstance(value, FunctionType)
                or value.__module__ != module.__name__
                or value.__qualname__ != qualified
                or value.__code__.co_filename != module.__file__
                or _code_hash(value.__code__)
                not in expected.get(f"{qualified}:{first_line}", set())
            ):
                return "declared_function", node.lineno
    return None


def _active_codes(
    module: ModuleType, extra_classes: tuple[type, ...]
) -> tuple[list[FunctionType], int, bool, list[tuple[Any, dict[str, Any]]]]:
    functions: list[FunctionType] = []
    excluded = 0
    unsupported = False
    seen: set[int] = set()
    bindings: list[tuple[Any, dict[str, Any]]] = []
    pending = [
        *vars(module).items(),
        *(("runtime_class", cls) for cls in extra_classes),
    ]
    while pending:
        name, value = pending.pop()
        if id(value) in seen:
            continue
        seen.add(id(value))
        if (dbus_function := _dbus_function(value)) is not None:
            bindings.append((value, _code_bindings(value)))
            excluded += 1
            value = dbus_function
        if isinstance(value, (staticmethod, classmethod)):
            value = value.__func__
        if isinstance(value, property):
            pending.extend(
                (name, fn)
                for fn in (value.fget, value.fset, value.fdel)
                if fn is not None
            )
        elif isinstance(value, type) and value.__module__ == module.__name__:
            generated = "__dataclass_fields__" in vars(value)
            bindings.append((value, _code_bindings(value)))
            for key, member in vars(value).items():
                if (
                    generated
                    and key in _GENERATED_METHODS
                    and isinstance(member, FunctionType)
                    and member.__code__.co_filename != module.__file__
                ):
                    inner = vars(member).get("__wrapped__", member)
                    known_helper = member is getattr(
                        dataclasses, "_dataclass_getstate", None
                    ) or member is getattr(dataclasses, "_dataclass_setstate", None)
                    valid_generated = (
                        isinstance(inner, FunctionType)
                        and inner.__code__.co_filename == "<string>"
                        and member.__module__ == module.__name__
                        and member.__qualname__ == f"{value.__qualname__}.{key}"
                    )
                    if valid_generated or known_helper:
                        excluded += 1
                    else:
                        unsupported = True
                else:
                    pending.append((key, member))
        elif isinstance(value, FunctionType) and value.__module__ == module.__name__:
            wrappers: set[int] = set()
            while isinstance(wrapped := vars(value).get("__wrapped__"), FunctionType):
                if id(value) in wrappers:
                    unsupported = True
                    break
                wrappers.add(id(value))
                if value.__code__.co_filename == module.__file__:
                    functions.append(value)
                else:
                    excluded += 1
                value = wrapped
            else:
                functions.append(value)
    bindings.append((module, _code_bindings(module)))
    return functions, excluded, unsupported, bindings


def _code_bindings(owner: Any) -> dict[str, Any]:
    return {
        key: value
        for key, value in vars(owner).items()
        if isinstance(value, (FunctionType, type, staticmethod, classmethod, property))
        or _dbus_function(value) is not None
    }


def _dbus_function(value: Any) -> FunctionType | None:
    """Recognize dbus-fast's compiled decorator without calling the wrapper."""
    service = sys.modules.get("dbus_fast.service")
    factory = (
        vars(service).get("dbus_method") if isinstance(service, ModuleType) else None
    )
    if factory is None or type(value) is not type(factory):
        return None
    wrapped = vars(value).get("__wrapped__")
    metadata = vars(value).get("__DBUS_METHOD")
    if (
        isinstance(wrapped, FunctionType)
        and type(metadata) is vars(service).get("_Method")
        and metadata.fn is wrapped
    ):
        return wrapped
    return None


def _same_bindings(first: Mapping[str, Any], second: Mapping[str, Any]) -> bool:
    return first.keys() == second.keys() and all(
        second[key] is value for key, value in first.items()
    )


def capture_runtime_code(
    root: Path,
    package: str,
    runtime_classes: tuple[type, ...] = (),
) -> RuntimeCodeSnapshot:
    """Compare actual active code objects with source compiled by this process.

    Run in HA's executor: source reads and compilation never block its loop.
    The caller separately checks that its runtime bindings survived the await.
    """
    result: dict[str, Any] = {
        "scope": "active source-defined functions and runtime classes",
        "whole_process_verified": False,
        "process_id": os.getpid(),
        "python_cache_tag": sys.implementation.cache_tag,
        "python_version": list(sys.version_info[:3]),
        "optimization": sys.flags.optimize,
        "loaded_modules": 0,
        "unloaded_modules": 0,
        "observed_functions": 0,
        "mismatched_functions": 0,
        "source_errors": 0,
        "identity_errors": 0,
        "identity_failures": [],
        "identity_failures_omitted": 0,
        "excluded_generated_or_wrapper_functions": 0,
        "exclusions": [
            "module initialization",
            "globals and closure values",
            "generated code",
            "dependencies",
            "external wrapper implementations",
            "external aliases",
            "unloaded modules",
            "protobuf modules",
        ],
    }
    observed: dict[str, list[tuple[str, str]]] = {}
    source_hashes: dict[str, str] = {}
    namespace_guards: list[tuple[Any, dict[str, Any]]] = []
    function_guards: list[tuple[FunctionType, CodeType, str, str, Any]] = []
    module_guards: list[tuple[str, ModuleType, Any, Any, Any]] = []
    class_guards: list[tuple[type, str, str]] = []
    total_bytes = 0

    def identity_failure(
        reason: str,
        source_file: str | None = None,
        source_line: int | None = None,
        runtime_class_index: int | None = None,
    ) -> None:
        result["identity_errors"] += 1
        if len(result["identity_failures"]) >= MAX_IDENTITY_FAILURES:
            result["identity_failures_omitted"] += 1
            return
        result["identity_failures"].append(
            {
                "reason": reason,
                "source_file": source_file,
                "source_line": source_line,
                "runtime_class_index": runtime_class_index,
            }
        )

    try:
        paths = _source_paths(root)
    except OSError, ValueError:
        result["source_errors"] = 1
        paths = []
    catalog = {
        (
            ".".join((package, *(p.relative_to(root).parts[:-1])))
            if p.name == "__init__.py"
            else package + "." + ".".join(p.relative_to(root).with_suffix("").parts)
        ): p.relative_to(root).as_posix()
        for p in paths
    }
    for index, cls in enumerate(runtime_classes):
        owner = sys.modules.get(cls.__module__)
        value: Any = owner
        for part in cls.__qualname__.split("."):
            value = (
                vars(value).get(part) if isinstance(value, (ModuleType, type)) else None
            )
        if (
            cls.__module__ != package and not cls.__module__.startswith(package + ".")
        ) or value is not cls:
            identity_failure(
                "runtime_class_binding", catalog.get(cls.__module__), None, index
            )
    loaded_names = {
        name: module
        for name, module in tuple(sys.modules.items())
        if (name == package or name.startswith(package + "."))
        and "proto" not in name.split(".")
    }
    if loaded_names.keys() - catalog.keys() or any(
        cls.__module__ not in catalog for cls in runtime_classes
    ):
        identity_failure("source_catalog")
    for path in paths:
        relative = path.relative_to(root)
        parts = relative.with_suffix("").parts
        name = ".".join((package, *(parts[:-1] if parts[-1] == "__init__" else parts)))
        module = sys.modules.get(name)
        if not isinstance(module, ModuleType):
            result["unloaded_modules"] += 1
            continue
        result["loaded_modules"] += 1
        spec = module.__spec__
        if (
            module.__name__ != name
            or spec is None
            or spec.name != name
            or module.__file__ != str(path)
            or spec.origin != str(path)
            or any(
                parent.is_symlink()
                for parent in (path, *path.parents[: len(relative.parts)])
            )
        ):
            identity_failure("module_identity", relative.as_posix())
            continue
        try:
            with path.open("rb") as stream:
                content = stream.read(
                    min(MAX_SOURCE_BYTES, MAX_TOTAL_SOURCE_BYTES - total_bytes) + 1
                )
            total_bytes += len(content)
            if len(content) > MAX_SOURCE_BYTES or total_bytes > MAX_TOTAL_SOURCE_BYTES:
                result["source_errors"] += 1
                break
            expected = _compiled_codes(
                compile(
                    content,
                    str(path),
                    "exec",
                    dont_inherit=True,
                    optimize=sys.flags.optimize,
                )
            )
            syntax = ast.parse(content, str(path))
        except OSError, SyntaxError, ValueError:
            result["source_errors"] += 1
            continue
        source_hashes[relative.as_posix()] = hashlib.sha256(content).hexdigest()
        classes = tuple(cls for cls in runtime_classes if cls.__module__ == name)
        functions, excluded, unsupported, bindings = _active_codes(module, classes)
        namespace_guards.extend(bindings)
        class_guards.extend(
            (owner, owner.__module__, owner.__qualname__)
            for owner, _bindings in bindings
            if isinstance(owner, type)
        )
        module_guards.append((name, module, spec, module.__file__, spec.origin))
        result["excluded_generated_or_wrapper_functions"] += excluded
        if unsupported:
            identity_failure("generated_or_wrapper", relative.as_posix())
        codes = [(fn, fn.__code__) for fn in functions]
        for fn, code in codes:
            function_guards.append(
                (fn, code, fn.__module__, fn.__qualname__, vars(fn).get("__wrapped__"))
            )
        if error := _source_binding_error(module, syntax, expected):
            identity_failure(error[0], relative.as_posix(), error[1])
        observed[name] = []
        for fn, code in codes:
            fingerprint = _code_hash(code)
            result["observed_functions"] += 1
            result["mismatched_functions"] += int(
                fingerprint not in expected.get(code.co_qualname, set())
            )
            observed[name].append((code.co_qualname, fingerprint))
            if fn.__code__ is not code:
                identity_failure("function_changed", relative.as_posix())
        observed[name].sort()

    def bindings_unchanged() -> bool:
        current_names = {
            name: module
            for name, module in tuple(sys.modules.items())
            if (name == package or name.startswith(package + "."))
            and "proto" not in name.split(".")
        }
        return (
            _same_bindings(loaded_names, current_names)
            and all(
                module.__name__ == name
                and module.__spec__ is spec
                and spec is not None
                and spec.name == name
                and module.__file__ == filename
                and spec.origin == origin
                for name, module, spec, filename, origin in module_guards
            )
            and all(
                _same_bindings(saved, _code_bindings(owner))
                for owner, saved in namespace_guards
            )
            and all(
                cls.__module__ == name and cls.__qualname__ == qualified
                for cls, name, qualified in class_guards
            )
            and all(
                fn.__code__ is code
                and fn.__module__ == name
                and fn.__qualname__ == qualified
                and vars(fn).get("__wrapped__") is wrapped
                for fn, code, name, qualified, wrapped in function_guards
            )
        )

    if not bindings_unchanged():
        identity_failure("bindings_changed")
    result["runtime_code_sha256"] = hashlib.sha256(
        json.dumps(observed, sort_keys=True).encode()
    ).hexdigest()
    result["loaded_python_source_sha256"] = hashlib.sha256(
        json.dumps(source_hashes, sort_keys=True).encode()
    ).hexdigest()
    result["loaded_python_source_files"] = source_hashes
    result["observed_code_matches_installed_source"] = bool(
        result["observed_functions"]
        and not any(
            result[key]
            for key in ("mismatched_functions", "source_errors", "identity_errors")
        )
    )
    return RuntimeCodeSnapshot(result, bindings_unchanged)
