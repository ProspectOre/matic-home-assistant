#!/usr/bin/env python3
"""Run format, lint, types, contract types, structure rules, privacy scan, tests.

The robot client's tests in tests/client also run with Home Assistant blocked,
which fails if the client needs it.

A test runs if its imports lead, through any number of modules, to a file
changed since the nearest main or release branch. Imports do not show what
Home Assistant loads by name or which files a test reads, so --all runs every
test, as CI does, and then requires a test to run every line and take every
branch the change adds to the integration. Tests read the built Matic Map, so
it is built first.

The checks run at the same time, and the tests on one worker per CPU; each
check's output is printed whole when it finishes.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import shutil
import subprocess
import sys
from collections.abc import Container, Iterable, Iterator, Mapping
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from functools import cache
from pathlib import Path
from typing import Any, NamedTuple

ROOT = Path(__file__).parents[1]
PACKAGE = "custom_components.matic_robot"
CLIENT = f"{PACKAGE}.client"
# Plan values and accounting rules, with the constants they share.
PLAN_CORE = frozenset(
    f"{PACKAGE}.{name}"
    for name in (
        "cadence",
        "cadence_accounting",
        "cadence_resolution",
        "completion_ledger",
        "const",
        "coverage_accounting",
        "daily_room_limit",
        "plan_model",
        "plan_records",
        "plan_schema",
        "room_identity",
        "run_machine",
    )
)
# Home Assistant loads an entity platform through its async_setup_entry.
PLATFORM = re.compile(r"^async def async_setup_entry\(", re.MULTILINE)


class Limit(NamedTuple):
    """A line ceiling and the record of what was larger when it was set."""

    ceiling: int
    record: Path
    # What to do with code that would take a recorded entry past its size.
    additions: str
    # Whether an entry that shrank must have its recorded size lowered.
    exact: bool


FILES = Limit(1000, Path("scripts/oversize_files.txt"), "a new file", exact=False)
FUNCTIONS = Limit(150, Path("scripts/long_functions.txt"), "a new function", exact=True)
# Names Home Assistant reads from an integration's modules.
HOOKS = frozenset(
    {
        "CONFIG_SCHEMA",
        "PARALLEL_UPDATES",
        "async_attach_trigger",
        "async_create_fix_flow",
        "async_get_config_entry_diagnostics",
        "async_get_media_source",
        "async_get_tools",
        "async_get_triggers",
        "async_remove_entry",
        "async_setup",
        "async_setup_entry",
        "async_unload_entry",
    }
)
# Names only tests reference that stay anyway, each with the reason.
TEST_ONLY: dict[str, str] = {}
DEFINITION = ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef
CODE_SUFFIXES = {".js", ".mjs", ".py", ".ts"}
GENERATED = "custom_components/matic_robot/client/proto/"
SOURCE = PACKAGE.replace(".", "/")
REPORT = Path("coverage.json")
FULL_SUITE = [f"--cov={SOURCE}", f"--cov-report=json:{REPORT}"]
# One worker per CPU; a worker that runs out of tests takes another's.
PARALLEL = ["-n", "auto", "--dist", "worksteal"]
CLIENT_SUITE = [
    *("-p", "tests.client.without_homeassistant", "-p", "no:homeassistant"),
    *("--confcutdir=tests/client", "tests/client"),
]
# The lines a diff hunk adds: `@@ -old +first,count @@`, count 1 when left out.
HUNK = re.compile(r"@@ \S+ \+(\d+)(?:,(\d+))? @@")


def module_name(path: Path) -> str:
    """Return the dotted name of a Python file given relative to the root."""
    parts = path.with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


@cache
def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_bytes())


def imported(root: Path, path: Path, removed: Container[str] = ()) -> set[str]:
    """Return the modules a Python file imports, relative imports resolved.

    `removed` names modules whose files are gone but may still be imported.
    """
    package = path.parent.parts
    found = set()
    for node in ast.walk(_tree(root / path)):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = [*package[: len(package) - node.level + 1]] if node.level else []
            base += node.module.split(".") if node.module else []
            for alias in node.names:
                # `from package import name` targets a submodule when one exists.
                name = ".".join([*base, alias.name])
                target = root.joinpath(*base, alias.name)
                submodule = (
                    name in removed
                    or target.with_suffix(".py").is_file()
                    or target.is_dir()
                )
                found.add(name if submodule else ".".join(base))
    return found


def _inside(module: str, package: str) -> bool:
    return module == package or module.startswith(f"{package}.")


def layer_violations(root: Path = ROOT) -> list[str]:
    """Return every import that crosses a layer boundary."""
    directory = root.joinpath(*PACKAGE.split("."))
    paths = sorted(path.relative_to(root) for path in directory.rglob("*.py"))
    imports = {module_name(path): imported(root, path) for path in paths}
    platforms = {
        module_name(path)
        for path in paths
        if path.name != "__init__.py" and PLATFORM.search((root / path).read_text())
    }
    found = [
        f"scripts/check.py: PLAN_CORE names {name}, which is gone"
        for name in sorted(PLAN_CORE - imports.keys())
    ]
    for name, targets in imports.items():
        client = _inside(name, CLIENT)
        if not client:
            found.extend(
                f"{name} imports {target}: import the client package, not its modules"
                for target in sorted(targets)
                if target != CLIENT and _inside(target, CLIENT)
            )
        if client or name in PLAN_CORE:
            banned = {
                target
                for target in targets
                if _inside(target, "homeassistant")
                or (
                    _inside(target, PACKAGE)
                    and not _inside(target, CLIENT)
                    and (client or target not in PLAN_CORE)
                )
            }
            reason = f"the {'client' if client else 'plan core'} must not"
        else:
            banned = targets & platforms - {name} if name in platforms else set()
            reason = "platforms stay independent"
        found.extend(f"{name} imports {target}: {reason}" for target in sorted(banned))
    return found


def size_violations(
    sizes: Mapping[str, int], baseline: Mapping[str, int], limit: Limit = FILES
) -> list[str]:
    """Return entries over the ceiling or their recorded size, and stale records."""
    ceiling, record, additions, exact = limit
    found = []
    for name, lines in sorted(sizes.items()):
        recorded = baseline.get(name)
        if recorded is None and lines > ceiling:
            found.append(f"{name}: {lines} lines, over the {ceiling} ceiling; split it")
        elif recorded is not None and lines > recorded:
            found.append(
                f"{name}: {lines} lines, over its recorded {recorded}; "
                f"put additions in {additions}"
            )
        elif recorded is not None and exact and ceiling < lines < recorded:
            found.append(f"{record}: {name} is down to {lines} lines; record it")
    found.extend(
        f"{record}: {name} is within the ceiling or gone; delete its line"
        for name in sorted(baseline)
        if sizes.get(name, 0) <= ceiling
    )
    return found


def _definitions(tree: ast.Module) -> Iterator[tuple[str, DEFINITION, ast.AST]]:
    """Yield each function and class: qualified name, node and enclosing scope.

    The scope is the nearest function, class or module, whatever statements
    lie between.
    """
    pending: list[tuple[str, ast.AST, ast.AST]] = [("", tree, tree)]
    while pending:
        scope, owner, node = pending.pop()
        for child in ast.iter_child_nodes(node):
            if isinstance(child, DEFINITION):
                name = f"{scope}.{child.name}" if scope else child.name
                yield name, child, owner
                pending.append((name, child, child))
            elif not isinstance(child, ast.expr):
                pending.append((scope, owner, child))


def function_lengths(trees: Mapping[str, ast.Module]) -> dict[str, int]:
    """Return each function's line count, keyed `path::qualified.name`."""
    lengths: dict[str, int] = {}
    for path, tree in trees.items():
        for name, node, _ in _definitions(tree):
            if not isinstance(node, ast.ClassDef) and node.end_lineno:
                key = f"{path}::{name}"
                lines = node.end_lineno - node.lineno + 1
                lengths[key] = max(lines, lengths.get(key, 0))
    return lengths


def _references(tree: ast.Module) -> set[str]:
    """Return the names a module reads, as code or as a string naming one."""
    found = set()
    pending: list[ast.AST] = [tree]
    while pending:
        node = pending.pop()
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            found.add(node.id)
        elif isinstance(node, ast.Attribute):
            found.add(node.attr)
        elif isinstance(node, ast.ImportFrom):
            # An import under another name is used under that name.
            found.update(alias.name for alias in node.names if alias.asname)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            # `__all__` and getattr name what they use; other text does not.
            found.add(node.value)
        # A docstring that mentions a name does not use it.
        if not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)):
            pending.extend(ast.iter_child_nodes(node))
    return found


def _module_statements(tree: ast.Module) -> Iterator[ast.stmt]:
    """Yield the statements that run at import, inside `if`, `try` and `with` too."""
    pending: list[ast.AST] = [tree]
    while pending:
        for child in ast.iter_child_nodes(pending.pop()):
            if isinstance(child, ast.stmt) and not isinstance(child, DEFINITION):
                yield child
            if not isinstance(child, DEFINITION | ast.expr):
                pending.append(child)


def _class_bases(tree: ast.Module) -> Iterator[tuple[str, set[str]]]:
    """Yield each class in a module with its bases, "" for one from outside."""
    outside = set()
    renamed = {}
    for node in _module_statements(tree):
        if isinstance(node, ast.Import):
            outside |= {
                alias.asname or alias.name.partition(".")[0]
                for alias in node.names
                if not _inside(alias.name, PACKAGE)
            }
        elif isinstance(node, ast.ImportFrom):
            if node.level or _inside(node.module or "", PACKAGE):
                renamed |= {
                    alias.asname: alias.name for alias in node.names if alias.asname
                }
            else:
                outside |= {alias.asname or alias.name for alias in node.names}
    for _, node, _ in _definitions(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        bases = set()
        for base in node.bases:
            while isinstance(base, ast.Subscript):
                base = base.value
            source = base
            while isinstance(source, ast.Attribute):
                source = source.value
            if isinstance(source, ast.Name):
                name = getattr(base, "attr", renamed.get(source.id, source.id))
                bases.add("" if source.id in outside else name)
        yield node.name, bases


def unused_violations(
    trees: Mapping[str, ast.Module],
    scripts: Iterable[ast.Module],
    kept: Mapping[str, str] = TEST_ONLY,
) -> list[str]:
    """Return integration names no integration module or script refers to.

    Functions, classes and module constants are matched by bare name, so a
    name defined twice passes when either is used. Four kinds are reached
    without a reference: a method of a class with a base outside the
    integration, through that base; a class defined with a keyword such as
    `domain=`, which registers it; a name in HOOKS, by Home Assistant; a
    `__dunder__`, by Python.
    """
    used: set[str] = set()
    for tree in (*trees.values(), *scripts):
        used |= _references(tree)
    bases: dict[str, set[str]] = {}
    for tree in trees.values():
        for name, found in _class_bases(tree):
            bases.setdefault(name, set()).update(found)

    def inherits_outside(name: str, seen: frozenset[str] = frozenset()) -> bool:
        return name not in bases or any(
            inherits_outside(base, seen | {name}) for base in bases[name] - seen
        )

    reached = used | HOOKS
    unused = set()
    for path, tree in trees.items():
        for name, node, parent in _definitions(tree):
            if (
                node.name not in reached
                and not node.name.startswith("__")
                and not (isinstance(node, ast.ClassDef) and node.keywords)
                and not (
                    isinstance(parent, ast.ClassDef)
                    and any(inherits_outside(base) for base in bases[parent.name])
                )
            ):
                unused.add(f"{path}::{name}")
        for statement in _module_statements(tree):
            targets = (
                statement.targets
                if isinstance(statement, ast.Assign)
                else [statement.target]
                if isinstance(statement, ast.AnnAssign)
                else []
            )
            unused |= {
                f"{path}::{name.id}"
                for target in targets
                for name in ast.walk(target)
                if isinstance(name, ast.Name)
                and isinstance(name.ctx, ast.Store)
                and name.id not in reached
                and not name.id.startswith("__")
            }
    return [
        *(
            f"{key}: only tests refer to it; delete it and their uses of it"
            for key in sorted(unused - kept.keys())
        ),
        *(
            f"scripts/check.py: TEST_ONLY lists {key}, which is used or gone"
            for key in sorted(kept.keys() - unused)
        ),
    ]


def _git(*arguments: str) -> list[str]:
    result = subprocess.run(
        ["git", *arguments], cwd=ROOT, capture_output=True, text=True, check=False
    )
    return result.stdout.splitlines() if result.returncode == 0 else []


def _code_sizes() -> dict[str, int]:
    """Return the line count of every hand-written code file in the checkout."""
    return {
        name: (ROOT / name).read_bytes().count(b"\n")
        for name in _git("ls-files", "--cached", "--others", "--exclude-standard")
        if Path(name).suffix in CODE_SUFFIXES
        and not name.startswith(GENERATED)
        and (ROOT / name).is_file()
    }


def _baseline(limit: Limit = FILES) -> dict[str, int]:
    rows = (line.split() for line in (ROOT / limit.record).read_text().splitlines())
    return {name: int(lines) for name, lines in rows}


def _trees(directory: str) -> dict[str, ast.Module]:
    """Return the syntax tree of each hand-written Python file in a directory."""
    return {
        name: _tree(path)
        for path in sorted((ROOT / directory).rglob("*.py"))
        if not (name := path.relative_to(ROOT).as_posix()).startswith(GENERATED)
    }


def structure_violations() -> list[str]:
    """Return every broken layer, size, length and unused-name rule."""
    integration = _trees(SOURCE)
    return [
        *layer_violations(),
        *size_violations(_code_sizes(), _baseline()),
        *size_violations(
            function_lengths(integration), _baseline(FUNCTIONS), FUNCTIONS
        ),
        *unused_violations(integration, _trees("scripts").values()),
    ]


def nearest_base() -> str | None:
    """Return where HEAD left the nearest main or release branch, if one is known."""
    refs = _git("for-each-ref", "--format=%(refname)", "refs/remotes")
    bases = [
        base[0]
        for ref in refs
        if (ref.endswith("/main") or "/release/" in ref)
        and (base := _git("merge-base", "HEAD", ref))
    ]
    return min(
        bases,
        key=lambda base: int(_git("rev-list", "--count", f"{base}..HEAD")[0]),
        default=None,
    )


def changed_files(base: str) -> list[Path]:
    """Return files changed since a commit.

    Deleted files are included, and a renamed file under both names: their
    tests still have to run.
    """
    names = _git("diff", "--name-only", "--no-renames", base)
    names += _git("ls-files", "--others", "--exclude-standard")
    return [Path(name) for name in names]


def changed_lines(base: str) -> dict[str, set[int]]:
    """Return the lines of each integration file that a commit does not have.

    A renamed file counts only where its text changed, a new file in full.
    """
    changed: dict[str, set[int]] = {}
    lines: set[int] = set()
    for line in _git(
        "diff", "--unified=0", "--find-renames", "--dst-prefix=b/", base, "--", SOURCE
    ):
        if line.startswith("+++ b/"):
            lines = changed.setdefault(line.removeprefix("+++ b/"), set())
        elif hunk := HUNK.match(line):
            first, count = int(hunk[1]), int(hunk[2] or 1)
            lines.update(range(first, first + count))
    for name in _git("ls-files", "--others", "--exclude-standard", "--", SOURCE):
        size = len((ROOT / name).read_bytes().splitlines())
        changed[name] = set(range(1, size + 1))
    return changed


def untested(
    report: Mapping[str, Any], changed: Mapping[str, Container[int]]
) -> list[str]:
    """Return each changed line no test runs and changed branch no test takes.

    `report` is coverage's JSON report, in which a negative branch target is
    the way out of the function.
    """
    found = []
    for name, file in report["files"].items():
        lines = changed.get(name, ())
        found += [
            f"{name}:{line}: no test runs this line"
            for line in file["missing_lines"]
            if line in lines
        ]
        found += [
            f"{name}:{line}: no test goes from here to "
            + (f"line {target}" if target > 0 else "the end of the function")
            for line, target in file["missing_branches"]
            if line in lines
        ]
    return found


def tests_for(changed: Iterable[Path], root: Path = ROOT) -> list[str]:
    """Return the test files whose imports or conftests reach a changed file."""
    touched = set(changed)
    reached = {module_name(path) for path in touched if path.suffix == ".py"}
    imports = {
        path.relative_to(root): imported(root, path.relative_to(root), reached)
        for directory in ("custom_components", "tests")
        for path in root.glob(f"{directory}/**/*.py")
    }
    # A changed package initializer runs on every import beneath the package.
    beneath = tuple(
        f"{module_name(path)}." for path in touched if path.name == "__init__.py"
    )
    reached |= {
        target
        for targets in imports.values()
        for target in targets
        if target.startswith(beneath)
    }
    # Most modules are only tested through the modules and helpers above them.
    grew = True
    while grew:
        importers = {
            module_name(path) for path, targets in imports.items() if reached & targets
        }
        grew = not importers <= reached
        reached |= importers
    # A conftest applies to every test beneath it.
    shared = {
        path.parent
        for path in touched | imports.keys()
        if path.name == "conftest.py" and module_name(path) in reached
    }
    return [
        str(path)
        for path in sorted(imports)
        if path.parts[0] == "tests"
        and path.name.startswith("test_")
        and (module_name(path) in reached or not shared.isdisjoint(path.parents))
    ]


def _run_steps(
    steps: list[list[str]], after: Future[tuple[bool, str]] | None = None
) -> tuple[bool, str]:
    """Run steps in order and return whether all passed, with their output.

    A failed step skips the rest: a failed build leaves nothing to test. With
    `after`, the steps start once that group has finished.
    """
    if after is not None:
        after.result()
    output = []
    for step in steps:
        result = subprocess.run(
            step,
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        output.append(result.stdout)
        if result.returncode:
            return False, "".join(output)
    return True, "".join(output)


def build_commands(root: Path = ROOT) -> list[list[str]] | None:
    """Return the commands that build Matic Map, or None without Node.js."""
    if (npm := shutil.which("npm")) is None:
        return None
    build = [npm, "run", "build:map-studio-v4"]
    return [build] if (root / "node_modules").is_dir() else [[npm, "ci"], build]


def main(arguments: list[str] | None = None) -> int:
    """Run every check and report the ones that failed."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--all",
        action="store_true",
        help="run every test and require tests for the changed lines, as CI does",
    )
    parser.add_argument(
        "--base",
        help="commit the change is measured from; "
        "by default where HEAD left the nearest main or release branch",
    )
    options = parser.parse_args(arguments)
    if options.base and not _git("rev-parse", "--verify", f"{options.base}^{{commit}}"):
        parser.error(f"--base {options.base} is not a commit in this checkout")
    base = options.base or nearest_base()
    # Without a base nothing shows what changed, so every test runs.
    changed = None if options.all or base is None else changed_files(base)
    selected = FULL_SUITE if changed is None else tests_for(changed)
    python = sys.executable
    commands = {
        "format": [[python, "-m", "ruff", "format", "--check", "."]],
        "lint": [[python, "-m", "ruff", "check", "."]],
        "types": [[python, "-m", "mypy", "custom_components/matic_robot"]],
        "contracts": [[python, "scripts/contract_types.py", "--check"]],
        "client without Home Assistant": [
            [python, "-m", "pytest", *PARALLEL, *CLIENT_SUITE]
        ],
        "privacy": [[python, "scripts/check_public_tree.py"]],
    }
    structure = structure_violations()
    for violation in structure:
        print(violation)
    failed = ["structure"] if structure else []
    if not selected:
        print("No test reaches a changed file; CI runs every test.")
    elif (build := build_commands()) is None:
        print("Tests read the built Matic Map; install Node.js 24 to build it.")
        failed.append("tests")
    else:
        commands["tests"] = [*build, [python, "-m", "pytest", *PARALLEL, *selected]]
    with ThreadPoolExecutor(len(commands)) as pool:
        # The privacy scan reads the whole tree, which the build and the tests
        # write to, so they wait for it.
        scanned = pool.submit(_run_steps, commands.pop("privacy"))
        running = {scanned: "privacy"}
        for name, steps in commands.items():
            after = scanned if name == "tests" else None
            running[pool.submit(_run_steps, steps, after)] = name
        for done in as_completed(running):
            name = running[done]
            passed, output = done.result()
            print(f"--- {name}\n{output}", end="", flush=True)
            if not passed:
                failed.append(name)
    if changed is None and "tests" not in failed:
        report = json.loads((ROOT / REPORT).read_text())
        lines, branches = (
            report["totals"][f"percent_{kind}_covered_display"]
            for kind in ("statements", "branches")
        )
        print(
            f"--- coverage\nTests run {lines}% of the integration's lines and"
            f" {branches}% of its branches; no minimum."
        )
        if base is None:
            print("No main or release branch is known; changed lines go unchecked.")
        elif gaps := untested(report, changed_lines(base)):
            print(*gaps, sep="\n")
            failed.append("coverage")
    print(f"check: failed: {', '.join(failed)}" if failed else "check: ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
