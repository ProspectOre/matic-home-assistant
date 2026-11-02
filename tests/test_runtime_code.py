"""Actual-code identity and explicit limits of the passive runtime probe."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

from custom_components.matic_robot import runtime_code

PACKAGE = "synthetic_matic_code"
SOURCE = """from dataclasses import dataclass
from functools import wraps

TOUCH_COUNT = 0

def decorate(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        return fn(*args, **kwargs)
    return wrapped

@decorate
def calculate(value):
    def nested(number):
        return number + 3
    return [nested(i) for i in range(value)]

@dataclass(frozen=True, slots=True)
class Model:
    value: int

    @property
    def unsafe_to_invoke(self):
        global TOUCH_COUNT
        TOUCH_COUNT += 1
        raise RuntimeError("synthetic-private-value")

    @staticmethod
    def static(value):
        return value + 7

    @classmethod
    def create(cls, value):
        return cls(value)
"""


def capture(*args):
    return runtime_code.capture_runtime_code(*args).report


def load_source(tmp_path, monkeypatch, source=SOURCE):
    root = tmp_path / "component"
    root.mkdir()
    (root / "__init__.py").write_text("")
    path = root / "sample.py"
    path.write_text(source)
    spec = importlib.util.spec_from_file_location(PACKAGE + ".sample", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module.__name__, module)
    spec.loader.exec_module(module)
    return root, path, module


def test_actual_nested_decorated_descriptor_code_matches_without_invoking_it(
    tmp_path, monkeypatch
):
    root, _path, module = load_source(tmp_path, monkeypatch)
    result = capture(root, PACKAGE, (module.Model,))
    assert result["observed_code_matches_installed_source"] is True
    assert result["observed_functions"] >= 5
    assert result["excluded_generated_or_wrapper_functions"] >= 4
    assert result["unloaded_modules"] == 1
    assert module.TOUCH_COUNT == 0
    assert result["whole_process_verified"] is False
    assert "synthetic-private-value" not in repr(result)
    assert (
        result["runtime_code_sha256"]
        == capture(root, PACKAGE, (module.Model,))["runtime_code_sha256"]
    )


def test_code_hash_is_independent_of_install_path(tmp_path, monkeypatch):
    first_root, _path, module = load_source(tmp_path, monkeypatch)
    first = capture(first_root, PACKAGE, (module.Model,))
    second_base = tmp_path / "other"
    second_base.mkdir()
    second_root, _path, module = load_source(second_base, monkeypatch)
    second = capture(second_root, PACKAGE, (module.Model,))
    assert first["runtime_code_sha256"] == second["runtime_code_sha256"]
    assert first["loaded_python_source_sha256"] == second["loaded_python_source_sha256"]


def test_changed_disk_source_is_not_mistaken_for_loaded_code(tmp_path, monkeypatch):
    root, path, module = load_source(tmp_path, monkeypatch)
    path.write_text(SOURCE.replace("number + 3", "number + 9"))
    result = capture(root, PACKAGE, (module.Model,))
    assert result["observed_code_matches_installed_source"] is False
    assert result["mismatched_functions"] >= 1


def test_changed_active_wrapper_is_measured_too(tmp_path, monkeypatch):
    root, _path, module = load_source(tmp_path, monkeypatch)
    module.calculate.__code__ = module.calculate.__code__.replace(co_code=b"\x00\x00")
    result = capture(root, PACKAGE)
    assert result["mismatched_functions"] == 1
    assert result["observed_code_matches_installed_source"] is False


@pytest.mark.parametrize("field", ["name", "origin", "file", "spec"])
def test_module_identity_mismatch_is_rejected(tmp_path, monkeypatch, field):
    root, _path, module = load_source(tmp_path, monkeypatch)
    if field == "file":
        module.__file__ = "/synthetic/wrong.py"
    elif field == "spec":
        module.__spec__ = None
    else:
        setattr(module.__spec__, field, "synthetic-wrong")
    result = capture(root, PACKAGE)
    assert result["identity_errors"] == 1
    assert result["observed_code_matches_installed_source"] is False


def test_stale_runtime_class_and_missing_module_are_distinct(tmp_path, monkeypatch):
    root, _path, module = load_source(tmp_path, monkeypatch)
    old_class = module.Model
    module.Model = type("Model", (), {"__module__": module.__name__})
    result = capture(root, PACKAGE, (old_class,))
    assert result["identity_errors"] >= 1
    monkeypatch.delitem(sys.modules, module.__name__)
    missing = capture(root, PACKAGE)
    assert missing["unloaded_modules"] == 2
    assert missing["observed_functions"] == 0
    assert missing["observed_code_matches_installed_source"] is False


@pytest.mark.parametrize(
    "bound", ["MAX_SOURCE_BYTES", "MAX_TOTAL_SOURCE_BYTES", "MAX_MODULES"]
)
def test_resource_bounds_fail_closed(tmp_path, monkeypatch, bound):
    root, _path, _module = load_source(tmp_path, monkeypatch)
    monkeypatch.setattr(runtime_code, bound, 1)
    result = capture(root, PACKAGE)
    assert result["source_errors"] == 1
    assert result["observed_code_matches_installed_source"] is False


def test_source_module_catalog_accepts_its_limit_and_rejects_one_more(tmp_path):
    for index in range(runtime_code.MAX_MODULES):
        (tmp_path / f"module_{index}.py").touch()
    assert len(runtime_code._source_paths(tmp_path)) == runtime_code.MAX_MODULES

    (tmp_path / "excess.py").touch()
    with pytest.raises(ValueError, match="source module bound"):
        runtime_code._source_paths(tmp_path)


def test_malformed_source_and_symlinks_do_not_yield_a_match(tmp_path, monkeypatch):
    root, path, _module = load_source(tmp_path, monkeypatch)
    path.write_text("invalid source:")
    assert capture(root, PACKAGE)["source_errors"] == 1
    path.unlink()
    path.symlink_to(root / "__init__.py")
    assert capture(root, PACKAGE)["source_errors"] == 1
    alias = tmp_path / "alias"
    alias.symlink_to(root, target_is_directory=True)
    assert capture(alias, PACKAGE)["source_errors"] == 1


def test_unreadable_source_is_bounded_and_redacted(tmp_path, monkeypatch):
    root, path, _module = load_source(tmp_path, monkeypatch)
    real_open = Path.open

    def denied(self, *args, **kwargs):
        if self == path:
            raise PermissionError("synthetic-private-value")
        return real_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", denied)
    result = capture(root, PACKAGE)
    assert result["source_errors"] == 1
    assert "synthetic-private-value" not in repr(result)


def test_decorator_cycle_and_changed_binding_do_not_qualify(tmp_path, monkeypatch):
    root, _path, module = load_source(tmp_path, monkeypatch)
    module.calculate.__wrapped__ = module.calculate
    assert capture(root, PACKAGE)["identity_errors"] >= 1
    module.calculate.__wrapped__ = module.decorate
    original_hash = runtime_code._code_hash

    def replacing(code):
        module.new_binding = object()
        module.Model.static = staticmethod(lambda x: x)
        return original_hash(code)

    monkeypatch.setattr(runtime_code, "_code_hash", replacing)
    assert capture(root, PACKAGE)["identity_errors"] >= 1


def test_protobuf_and_non_component_runtime_classes_are_explicitly_excluded(
    tmp_path, monkeypatch
):
    root, _path, _module = load_source(tmp_path, monkeypatch)
    proto = root / "proto"
    proto.mkdir()
    (proto / "generated.py").write_text("invalid generated input:")
    result = capture(root, PACKAGE, (ModuleType,))
    assert result["source_errors"] == 0
    assert result["identity_errors"] >= 1
    assert "protobuf modules" in result["exclusions"]


@pytest.mark.parametrize("target", ["function", "wrapped", "classmethod"])
@pytest.mark.parametrize("field", ["__module__", "__qualname__", "co_filename"])
def test_changed_function_metadata_cannot_disappear_from_observation(
    tmp_path, monkeypatch, target, field
):
    root, _path, module = load_source(tmp_path, monkeypatch)
    fn = (
        module.calculate
        if target == "function"
        else module.calculate.__wrapped__
        if target == "wrapped"
        else vars(module.Model)["create"].__func__
    )
    if field == "co_filename":
        fn.__code__ = fn.__code__.replace(co_filename="/synthetic/foreign.py")
    else:
        setattr(fn, field, "synthetic_foreign")
    assert capture(root, PACKAGE)["observed_code_matches_installed_source"] is False


@pytest.mark.parametrize("binding", ["calculate", "Model"])
def test_declared_binding_removal_fails_closed(tmp_path, monkeypatch, binding):
    root, _path, module = load_source(tmp_path, monkeypatch)
    delattr(module, binding)
    assert capture(root, PACKAGE)["identity_errors"] >= 1


def test_replaced_dataclass_constructor_is_not_generated_code(tmp_path, monkeypatch):
    root, _path, module = load_source(tmp_path, monkeypatch)
    module.Model.__init__ = lambda self, value: None
    assert capture(root, PACKAGE)["observed_code_matches_installed_source"] is False


@pytest.mark.parametrize(
    "mutation", ["code", "metadata", "binding", "module", "wrapped", "class_metadata"]
)
def test_snapshot_rechecks_all_bindings_after_executor_return(
    tmp_path, monkeypatch, mutation
):
    root, _path, module = load_source(tmp_path, monkeypatch)
    snapshot = runtime_code.capture_runtime_code(root, PACKAGE)
    assert snapshot.report["observed_code_matches_installed_source"] is True
    if mutation == "code":
        module.decorate.__code__ = module.decorate.__code__.replace(co_code=b"\x00\x00")
    elif mutation == "metadata":
        module.decorate.__module__ = "foreign"
    elif mutation == "binding":
        module.Model.static = staticmethod(lambda x: x)
    elif mutation == "module":
        module.__spec__.origin = "/synthetic/foreign.py"
    elif mutation == "wrapped":
        module.calculate.__wrapped__ = module.decorate
    else:
        module.Model.__qualname__ = "ChangedModel"
    assert snapshot.bindings_unchanged() is False
    assert "synthetic-private-value" not in repr(snapshot.report)


def test_live_code_change_during_hashing_is_rejected(tmp_path, monkeypatch):
    root, _path, module = load_source(tmp_path, monkeypatch)
    original = runtime_code._code_hash
    actual = module.decorate.__code__

    calls = 0

    def change(code):
        nonlocal calls
        if code is actual:
            calls += 1
        if code is actual and calls == 2:
            module.decorate.__code__ = actual.replace(co_code=b"\x00\x00")
        return original(code)

    monkeypatch.setattr(runtime_code, "_code_hash", change)
    assert capture(root, PACKAGE)["identity_errors"] >= 1


def test_wrong_declared_class_type_is_rejected(tmp_path, monkeypatch):
    root, _path, module = load_source(tmp_path, monkeypatch)
    module.Model = object()
    assert capture(root, PACKAGE)["identity_errors"] >= 1


def test_loaded_module_missing_from_source_catalog_is_rejected(tmp_path, monkeypatch):
    root, _path, _module = load_source(tmp_path, monkeypatch)
    monkeypatch.setitem(
        sys.modules, PACKAGE + ".missing", ModuleType(PACKAGE + ".missing")
    )
    assert capture(root, PACKAGE)["identity_errors"] >= 1


def test_source_tree_enumeration_stops_at_bound(tmp_path, monkeypatch):
    root = tmp_path / "large"
    root.mkdir()
    for index in range(20):
        (root / f"file{index}.py").write_text("")
    real = runtime_code.os.scandir
    seen = []

    class CountingEntries:
        def __init__(self, path):
            self.entries = real(path)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.entries.close()

        def __iter__(self):
            return self

        def __next__(self):
            entry = next(self.entries)
            seen.append(entry.name)
            return entry

    monkeypatch.setattr(runtime_code.os, "scandir", CountingEntries)
    monkeypatch.setattr(runtime_code, "MAX_TREE_ENTRIES", 3)
    assert capture(root, PACKAGE)["source_errors"] == 1
    assert len(seen) == 4


def test_source_depth_empty_directory_and_enumeration_error(tmp_path, monkeypatch):
    root = tmp_path / "empty"
    root.mkdir()
    assert capture(root, PACKAGE)["source_errors"] == 1
    (root / "nested").mkdir()
    monkeypatch.setattr(runtime_code, "MAX_TREE_DEPTH", 0)
    assert capture(root, PACKAGE)["source_errors"] == 1

    def denied(path):
        raise PermissionError("synthetic-private-value")

    monkeypatch.setattr(runtime_code.os, "scandir", denied)
    assert capture(root, PACKAGE)["source_errors"] == 1


def test_property_setter_deleter_and_nested_class_code_are_measured(
    tmp_path, monkeypatch
):
    source = """class Outer:
    class Inner:
        def value(self):
            return 1
    @property
    def amount(self):
        return 1
    @amount.setter
    def amount(self, value):
        pass
    @amount.deleter
    def amount(self):
        pass
"""
    root, _path, module = load_source(tmp_path, monkeypatch, source)
    assert (
        capture(root, PACKAGE, (module.Outer.Inner,))[
            "observed_code_matches_installed_source"
        ]
        is True
    )
    fn = vars(module.Outer)["amount"].fset
    fn.__code__ = fn.__code__.replace(co_code=b"\x00\x00")
    assert capture(root, PACKAGE)["observed_code_matches_installed_source"] is False


def test_real_component_source_bindings_match_loaded_code():
    root = Path(runtime_code.__file__).parent
    report = capture(root, runtime_code.__package__)
    assert report["observed_code_matches_installed_source"] is True, report


@pytest.mark.parametrize("field", ["__module__", "__qualname__"])
def test_class_metadata_changed_during_capture_cannot_be_skipped(
    tmp_path, monkeypatch, field
):
    root, _path, module = load_source(tmp_path, monkeypatch)
    original = runtime_code._code_hash
    actual = module.decorate.__code__

    def change(code):
        if code is actual:
            setattr(module.Model, field, "synthetic_foreign")
        return original(code)

    monkeypatch.setattr(runtime_code, "_code_hash", change)
    assert capture(root, PACKAGE)["observed_code_matches_installed_source"] is False


def test_canonical_hash_tracks_typed_constants_and_exception_tables():
    code = compile(
        'def sample():\n    return (True, 1, 1.0, 1j, b"a", frozenset())\n',
        "<synthetic>",
        "exec",
    )
    function = next(
        value for value in code.co_consts if isinstance(value, runtime_code.CodeType)
    )
    assert runtime_code._code_hash(function) != runtime_code._code_hash(
        function.replace(co_consts=(None, (1, True, 1.0, 1j, b"a")))
    )
    assert runtime_code._code_hash(function) != runtime_code._code_hash(
        function.replace(co_exceptiontable=b"changed")
    )
    assert runtime_code._constant(frozenset((True, "a"))) == runtime_code._constant(
        frozenset(("a", True))
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "property_to_function",
        "static_to_function",
        "static_to_class",
        "class_to_static",
    ],
)
def test_matching_method_code_does_not_hide_changed_descriptor_semantics(
    tmp_path, monkeypatch, mutation
):
    root, _path, module = load_source(tmp_path, monkeypatch)
    if mutation == "property_to_function":
        module.Model.unsafe_to_invoke = vars(module.Model)["unsafe_to_invoke"].fget
    elif mutation == "static_to_function":
        module.Model.static = vars(module.Model)["static"].__func__
    elif mutation == "static_to_class":
        module.Model.static = classmethod(vars(module.Model)["static"].__func__)
    else:
        module.Model.create = staticmethod(vars(module.Model)["create"].__func__)
    assert capture(root, PACKAGE)["observed_code_matches_installed_source"] is False
    assert module.TOUCH_COUNT == 0


@pytest.mark.parametrize("change", ["wrapped", "dispatch"])
def test_compiled_dbus_wrapper_cannot_hide_changed_source_dispatch(
    tmp_path, monkeypatch, change
):
    source = """from dbus_fast.service import ServiceInterface, method
class Agent(ServiceInterface):
    @method()
    def Release(self):
        pass
"""
    root, _path, module = load_source(tmp_path, monkeypatch, source)
    snapshot = runtime_code.capture_runtime_code(root, PACKAGE)
    assert snapshot.report["observed_code_matches_installed_source"] is True
    wrapped = vars(module.Agent)["Release"]
    if change == "wrapped":
        wrapped.__wrapped__ = lambda: None
    else:
        wrapped.__dict__["__DBUS_METHOD"].fn = lambda: None
    assert snapshot.bindings_unchanged() is False
    assert capture(root, PACKAGE)["observed_code_matches_installed_source"] is False


def test_entry_runtime_class_defined_in_package_root_is_valid():
    from custom_components.matic_robot import MaticRuntimeData

    report = capture(
        Path(runtime_code.__file__).parent,
        runtime_code.__package__,
        (MaticRuntimeData,),
    )
    assert report["observed_code_matches_installed_source"] is True, report


def test_identity_failure_reports_source_location_without_private_metadata(
    tmp_path, monkeypatch
):
    root, _path, module = load_source(tmp_path, monkeypatch)
    module.calculate.__module__ = "synthetic-private-metadata"
    report = capture(root, PACKAGE)
    assert report["observed_code_matches_installed_source"] is False
    assert report["identity_failures"] == [
        {
            "reason": "function_metadata",
            "source_file": "sample.py",
            "source_line": 13,
            "runtime_class_index": None,
        }
    ]
    assert "synthetic-private-metadata" not in repr(report)
    assert str(root) not in repr(report)


def test_identity_failure_details_are_bounded_without_hiding_the_error_count(
    tmp_path, monkeypatch
):
    root, _path, _module = load_source(tmp_path, monkeypatch)
    monkeypatch.setattr(runtime_code, "MAX_IDENTITY_FAILURES", 1)
    report = capture(root, PACKAGE, (ModuleType, str))
    assert report["observed_code_matches_installed_source"] is False
    assert report["identity_errors"] == 3
    assert len(report["identity_failures"]) == 1
    assert report["identity_failures_omitted"] == 2
    assert report["identity_failures"][0]["reason"] == "runtime_class_binding"
    assert report["identity_failures"][0]["source_file"] is None
    assert report["identity_failures"][0]["runtime_class_index"] == 0
