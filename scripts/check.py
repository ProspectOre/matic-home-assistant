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
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import shutil
import subprocess
import sys
from collections.abc import Container, Iterable, Mapping
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parents[1]
PACKAGE = "custom_components.matic_robot"
CLIENT = f"{PACKAGE}.client"
# Plan values and accounting rules, with the constants they share.
PLAN_CORE = frozenset(
    f"{PACKAGE}.{name}"
    for name in (
        "cadence",
        "cadence_accounting",
        "completion_ledger",
        "const",
        "coverage_accounting",
        "daily_room_limit",
        "plan_model",
        "plan_schema",
        "room_identity",
        "run_machine",
    )
)
# Home Assistant loads an entity platform through its async_setup_entry.
PLATFORM = re.compile(r"^async def async_setup_entry\(", re.MULTILINE)
CEILING = 1000
# Larger files that predate the ceiling, each with the size it may not exceed.
BASELINE = Path("scripts/oversize_files.txt")
CODE_SUFFIXES = {".js", ".mjs", ".py", ".ts"}
GENERATED = "custom_components/matic_robot/client/proto/"
SOURCE = PACKAGE.replace(".", "/")
REPORT = Path("coverage.json")
FULL_SUITE = [f"--cov={SOURCE}", f"--cov-report=json:{REPORT}"]
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


def imported(root: Path, path: Path, removed: Container[str] = ()) -> set[str]:
    """Return the modules a Python file imports, relative imports resolved.

    `removed` names modules whose files are gone but may still be imported.
    """
    package = path.parent.parts
    found = set()
    for node in ast.walk(ast.parse((root / path).read_bytes())):
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


def size_violations(sizes: Mapping[str, int], baseline: Mapping[str, int]) -> list[str]:
    """Return files over the ceiling or their recorded size, and stale records."""
    found = []
    for path, lines in sorted(sizes.items()):
        if path in baseline and lines > baseline[path]:
            found.append(
                f"{path}: {lines} lines, over its recorded {baseline[path]}; "
                "put additions in a new file"
            )
        elif path not in baseline and lines > CEILING:
            found.append(f"{path}: {lines} lines, over the {CEILING} ceiling; split it")
    found.extend(
        f"{BASELINE}: {path} is within the ceiling or gone; delete its line"
        for path in sorted(baseline)
        if sizes.get(path, 0) <= CEILING
    )
    return found


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


def _baseline() -> dict[str, int]:
    rows = (line.split() for line in (ROOT / BASELINE).read_text().splitlines())
    return {path: int(lines) for path, lines in rows}


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
        "client without Home Assistant": [[python, "-m", "pytest", *CLIENT_SUITE]],
        "privacy": [[python, "scripts/check_public_tree.py"]],
    }
    structure = [*layer_violations(), *size_violations(_code_sizes(), _baseline())]
    for violation in structure:
        print(violation)
    failed = ["structure"] if structure else []
    if not selected:
        print("No test reaches a changed file; CI runs every test.")
    elif (build := build_commands()) is None:
        print("Tests read the built Matic Map; install Node.js 24 to build it.")
        failed.append("tests")
    else:
        commands["tests"] = [*build, [python, "-m", "pytest", *selected]]
    for name, steps in commands.items():
        print(f"--- {name}", flush=True)
        # A failed step skips the rest: a failed build leaves nothing to test.
        if any(
            subprocess.run(step, cwd=ROOT, check=False).returncode for step in steps
        ):
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
