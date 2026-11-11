#!/usr/bin/env python3
"""Run format, lint, types, structure rules, the privacy scan and tests.

A test runs if its imports lead, through any number of modules, to a file
changed since the nearest main or release branch. With --all, every test runs
with coverage, as in CI.
"""

from __future__ import annotations

import argparse
import ast
import re
import subprocess
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path

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
        "room_identity",
    )
)
# Home Assistant loads an entity platform through its async_setup_entry.
PLATFORM = re.compile(r"^async def async_setup_entry\(", re.MULTILINE)
CEILING = 1000
# Larger files that predate the ceiling, each with the size it may not exceed.
BASELINE = Path("scripts/oversize_files.txt")
CODE_SUFFIXES = {".js", ".mjs", ".py", ".ts"}
GENERATED = (
    "custom_components/matic_robot/client/proto/",
    "custom_components/matic_robot/map_studio_v4/",
    "custom_components/matic_robot/matic_icons.js",
)
FULL_SUITE = ["--cov=custom_components/matic_robot", "--cov-report=term-missing"]


def module_name(path: Path) -> str:
    """Return the dotted name of a Python file given relative to the root."""
    parts = path.with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def imported(root: Path, path: Path) -> set[str]:
    """Return the modules a Python file imports, relative imports resolved."""
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
                target = root.joinpath(*base, alias.name)
                submodule = target.with_suffix(".py").is_file() or target.is_dir()
                found.add(".".join([*base, alias.name] if submodule else base))
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


def changed_files() -> list[Path] | None:
    """Return files changed since the nearest main or release branch.

    Deleted files are included: their tests still have to run. None means no
    such branch is known, so every test should run.
    """
    refs = _git("for-each-ref", "--format=%(refname)", "refs/remotes")
    bases = [
        base[0]
        for ref in refs
        if (ref.endswith("/main") or "/release/" in ref)
        and (base := _git("merge-base", "HEAD", ref))
    ]
    if not bases:
        return None
    nearest = min(
        bases, key=lambda base: int(_git("rev-list", "--count", f"{base}..HEAD")[0])
    )
    names = _git("diff", "--name-only", nearest)
    names += _git("ls-files", "--others", "--exclude-standard")
    return [Path(name) for name in names]


def tests_for(changed: Iterable[Path], root: Path = ROOT) -> list[str]:
    """Return the test files whose imports or conftests reach a changed file."""
    touched = set(changed)
    imports = {
        path.relative_to(root): imported(root, path.relative_to(root))
        for directory in ("custom_components", "tests")
        for path in root.glob(f"{directory}/**/*.py")
    }
    reached = {module_name(path) for path in touched if path.suffix == ".py"}
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


def main(arguments: list[str] | None = None) -> int:
    """Run every check and report the ones that failed."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--all", action="store_true", help="run every test with coverage, as CI does"
    )
    changed = None if parser.parse_args(arguments).all else changed_files()
    selected = FULL_SUITE if changed is None else tests_for(changed)
    python = sys.executable
    commands = {
        "format": [python, "-m", "ruff", "format", "--check", "."],
        "lint": [python, "-m", "ruff", "check", "."],
        "types": [python, "-m", "mypy", "custom_components/matic_robot"],
        "privacy": [python, "scripts/check_public_tree.py"],
    }
    if selected:
        commands["tests"] = [python, "-m", "pytest", *selected]
    else:
        print("No test reaches a changed file; CI runs every test.")

    structure = [*layer_violations(), *size_violations(_code_sizes(), _baseline())]
    for violation in structure:
        print(violation)
    failed = ["structure"] if structure else []
    for name, command in commands.items():
        print(f"--- {name}", flush=True)
        if subprocess.run(command, cwd=ROOT, check=False).returncode:
            failed.append(name)
    print(f"check: failed: {', '.join(failed)}" if failed else "check: ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
