"""Layer, size, unused-name, test-selection and coverage rules of the check."""

from __future__ import annotations

import ast
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import check

INTEGRATION = check.PACKAGE
PACKAGE = INTEGRATION.replace(".", "/")
PLATFORM = "async def async_setup_entry() -> None: ...\n"


def _write(root: Path, files: dict[str, str]) -> None:
    for name, source in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)


@pytest.fixture
def integration(tmp_path: Path) -> Path:
    """An integration whose imports stay inside their layers."""
    core = {f"{name.replace('.', '/')}.py": "" for name in check.PLAN_CORE}
    _write(
        tmp_path,
        core
        | {
            f"{PACKAGE}/__init__.py": "from homeassistant.core import HomeAssistant\n",
            f"{PACKAGE}/client/__init__.py": "from .api import Client\n",
            f"{PACKAGE}/client/api.py": "from . import wire\nfrom .proto import pb2\n",
            f"{PACKAGE}/client/wire.py": "import struct\n",
            f"{PACKAGE}/client/proto/pb2.py": "",
            f"{PACKAGE}/plan_model.py": (
                "from . import cadence\nfrom .client import Client\n"
                "from .const import DOMAIN\n"
            ),
            f"{PACKAGE}/entity.py": "from homeassistant.helpers import entity\n",
            f"{PACKAGE}/sensor.py": f"{PLATFORM}from .entity import Base\n",
            f"{PACKAGE}/vacuum.py": f"{PLATFORM}from . import plan_model\n",
        },
    )
    return tmp_path


def test_imports_inside_their_layers_pass(integration: Path) -> None:
    assert check.layer_violations(integration) == []


@pytest.mark.parametrize(
    ("module", "source", "violation"),
    [
        (
            "client/wire.py",
            "from homeassistant.core import HomeAssistant\n",
            "client.wire imports homeassistant.core: the client must not",
        ),
        (
            "client/wire.py",
            "from ..const import DOMAIN\n",
            "client.wire imports custom_components.matic_robot.const: "
            "the client must not",
        ),
        (
            "client/wire.py",
            "from .. import DOMAIN\n",
            "client.wire imports custom_components.matic_robot: the client must not",
        ),
        (
            "entity.py",
            "from .client.api import Client\n",
            "entity imports custom_components.matic_robot.client.api: "
            "import the client package, not its modules",
        ),
        (
            "plan_model.py",
            "from .client import wire\n",
            "plan_model imports custom_components.matic_robot.client.wire: "
            "import the client package, not its modules",
        ),
        (
            "entity.py",
            "from .client.proto.pb2 import Message\n",
            "entity imports custom_components.matic_robot.client.proto.pb2: "
            "import the client package, not its modules",
        ),
        (
            "cadence.py",
            "import homeassistant.util.dt\n",
            "cadence imports homeassistant.util.dt: the plan core must not",
        ),
        (
            "cadence.py",
            "from . import entity\n",
            "cadence imports custom_components.matic_robot.entity: "
            "the plan core must not",
        ),
        (
            "sensor.py",
            f"{PLATFORM}from .vacuum import MaticVacuum\n",
            "sensor imports custom_components.matic_robot.vacuum: "
            "platforms stay independent",
        ),
    ],
)
def test_import_across_a_layer_is_reported(
    integration: Path, module: str, source: str, violation: str
) -> None:
    _write(integration, {f"{PACKAGE}/{module}": source})

    assert check.layer_violations(integration) == [
        f"custom_components.matic_robot.{violation}"
    ]


def test_plan_core_module_that_no_longer_exists_is_reported(integration: Path) -> None:
    (integration / PACKAGE / "cadence.py").unlink()
    _write(integration, {f"{PACKAGE}/plan_model.py": ""})

    assert check.layer_violations(integration) == [
        "scripts/check.py: PLAN_CORE names custom_components.matic_robot.cadence, "
        "which is gone"
    ]


@pytest.mark.parametrize(
    ("sizes", "baseline", "violations"),
    [
        ({"a.py": check.FILES.ceiling}, {}, []),
        ({"old.py": 1500}, {"old.py": 1500}, []),
        ({"old.py": 1200}, {"old.py": 1500}, []),
        ({"a.py": 1001}, {}, ["a.py: 1001 lines, over the 1000 ceiling; split it"]),
        (
            {"old.py": 1501},
            {"old.py": 1500},
            ["old.py: 1501 lines, over its recorded 1500; put additions in a new file"],
        ),
        (
            {"old.py": 900},
            {"old.py": 1500, "gone.py": 1100},
            [
                f"{check.FILES.record}: {name} is within the ceiling or gone; "
                "delete its line"
                for name in ("gone.py", "old.py")
            ],
        ),
    ],
)
def test_file_sizes_are_held_to_the_ceiling_or_their_record(
    sizes: dict[str, int], baseline: dict[str, int], violations: list[str]
) -> None:
    assert check.size_violations(sizes, baseline) == violations


RUN = f"{PACKAGE}/run.py::Runner.run"
LONG = check.FUNCTIONS.ceiling + 50


@pytest.mark.parametrize(
    ("lengths", "baseline", "violations"),
    [
        ({RUN: check.FUNCTIONS.ceiling}, {}, []),
        ({RUN: LONG}, {RUN: LONG}, []),
        ({RUN: LONG}, {}, [f"{RUN}: {LONG} lines, over the 150 ceiling; split it"]),
        (
            {RUN: LONG + 1},
            {RUN: LONG},
            [
                f"{RUN}: {LONG + 1} lines, over its recorded {LONG}; "
                "put additions in a new function"
            ],
        ),
        (
            {RUN: LONG - 1},
            {RUN: LONG},
            [f"{check.FUNCTIONS.record}: {RUN} is down to {LONG - 1} lines; record it"],
        ),
        (
            {RUN: check.FUNCTIONS.ceiling},
            {RUN: LONG, "gone.py::run": LONG},
            [
                f"{check.FUNCTIONS.record}: {name} is within the ceiling or gone; "
                "delete its line"
                for name in (RUN, "gone.py::run")
            ],
        ),
    ],
)
def test_function_lengths_are_held_to_the_ceiling_and_their_exact_record(
    lengths: dict[str, int], baseline: dict[str, int], violations: list[str]
) -> None:
    assert check.size_violations(lengths, baseline, check.FUNCTIONS) == violations


def test_functions_are_measured_under_their_qualified_names() -> None:
    source = """
@decorated
def outer():
    def inner():
        return 1

    return inner


class Runner:
    async def run(self):
        if self:
            def step():
                return (
                    1
                )

if FAST:
    def choice(): return 1
else:
    def choice():
        return 2
"""

    assert check.function_lengths({"a.py": ast.parse(source)}) == {
        "a.py::outer": 5,
        "a.py::outer.inner": 2,
        "a.py::Runner.run": 6,
        "a.py::Runner.run.step": 4,
        "a.py::choice": 2,
    }


USED = {
    f"{PACKAGE}/__init__.py": """
from homeassistant.helpers.storage import Store
from . import plans
from .plans import renamed as _renamed

__all__ = ["exported"]
PARALLEL_UPDATES = 0
LIMIT: int = 3


async def async_setup_entry():
    return getattr(plans, "named_in_text")(
        _renamed, LIMIT, Saved, Flow, Local, plans.Plain
    )


class Saved(Store[dict]):
    def _async_migrate_func(self): ...


class Flow(Base, domain="matic"):
    pass


class Local(plans.Saved):
    def reached_through_home_assistant(self): ...

    def __repr__(self): ...
""",
    f"{PACKAGE}/plans.py": """
from homeassistant.helpers import storage

def exported(): ...
def named_in_text(): ...
def renamed(): ...
def called_by_a_script(): ...


class Saved(storage.Store):
    pass


class Plain:
    pass
""",
}


def _test_only(files: dict[str, str], kept: dict[str, str] | None = None) -> list[str]:
    trees = {name: ast.parse(source) for name, source in (USED | files).items()}
    script = ast.parse("called_by_a_script()")
    return check.unused_violations(trees, [script], kept or {})


def test_names_reached_by_reference_or_by_home_assistant_pass() -> None:
    assert _test_only({}) == []


@pytest.mark.parametrize(
    ("source", "names"),
    [
        ("def helper(): ...\n", ["helper"]),
        ("LIMIT_BYTES = 1\nDELAY: float = 2.0\n", ["DELAY", "LIMIT_BYTES"]),
        ("FIRST, [SECOND, *REST] = 1, [2, 3]\n", ["FIRST", "REST", "SECOND"]),
        # A constant bound under `if`, `try` or `with` is still the module's.
        (
            "if LIMIT:\n    A = 1\nelse:\n    B = 2\n"
            "try:\n    C = 3\nexcept OSError:\n    D = 4\nfinally:\n    E = 5\n"
            "with open(__file__) as handle:\n    F = 6\n"
            "def used():\n    local = 7\nused()\n",
            ["A", "B", "C", "D", "E", "F"],
        ),
        # An in-package base imported under `if TYPE_CHECKING:` is still one.
        (
            "if LIMIT:\n    from .plans import Plain as Local\n"
            "class Mine(Local):\n    def unused(self): ...\nMine()\n",
            ["Mine.unused"],
        ),
        # A method under `if` in a class body belongs to that class.
        (
            "from homeassistant.helpers import storage\n"
            "class Mine(storage.Store):\n"
            "    if LIMIT:\n        def reached_by_the_base(self): ...\n"
            "class Plain:\n"
            "    if LIMIT:\n        def unused(self): ...\n"
            "Mine()\nPlain()\n",
            ["Plain.unused"],
        ),
        ("class Plain:\n    def unused(self): ...\nPlain()\n", ["Plain.unused"]),
        ("class Unused:\n    def method(self): ...\n", ["Unused", "Unused.method"]),
        # Text that mentions a name does not use it.
        (
            'def helper():\n    """Call helper."""\n    return "see helper"\n',
            ["helper"],
        ),
        # A base class of the integration's own does not reach its subclass.
        (
            "class Store:\n    pass\n"
            "class Mine(Store):\n    def unused(self): ...\nMine()\n",
            ["Mine.unused"],
        ),
        # Nor does one imported under another name or through its module.
        (
            "from .plans import Plain as Local\n"
            "class Mine(Local):\n    def unused(self): ...\nMine()\n",
            ["Mine.unused"],
        ),
        (
            f"import {PACKAGE.replace('/', '.')}.plans\n"
            f"class Mine({PACKAGE.replace('/', '.')}.plans.Plain):\n"
            "    def unused(self): ...\nMine()\n",
            ["Mine.unused"],
        ),
    ],
)
def test_name_only_tests_refer_to_is_reported(source: str, names: list[str]) -> None:
    path = f"{PACKAGE}/store.py"

    assert _test_only({path: source}) == [
        f"{path}::{name}: only tests refer to it; delete it and their uses of it"
        for name in names
    ]


def test_kept_test_only_names_pass_until_they_are_used_or_gone() -> None:
    path = f"{PACKAGE}/store.py"
    kept = {f"{path}::helper": "a fixture builder", f"{path}::gone": "was needed"}

    assert _test_only({path: "def helper(): ...\n"}, kept) == [
        f"scripts/check.py: TEST_ONLY lists {path}::gone, which is used or gone"
    ]


def test_structure_rules_read_the_checkout_and_its_records(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    body = "    pass\n" * check.FUNCTIONS.ceiling
    _write(
        tmp_path,
        {
            f"{PACKAGE}/run.py": f"def run():\n{body}\n\nrun()\n",
            f"{PACKAGE}/old.py": f"def old():\n{body}\n\nold()\n",
            f"{PACKAGE}/client/proto/pb2.py": f"def generated():\n{body}",
            "scripts/tool.py": "used_by_a_script()\n",
            f"{PACKAGE}/plans.py": "def used_by_a_script(): ...\ndef unused(): ...\n",
            str(check.FILES.record): "big.py 1200\n",
            str(check.FUNCTIONS.record): f"{PACKAGE}/old.py::old 151\n",
        },
    )
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "layer_violations", lambda: ["a layer"])
    monkeypatch.setattr(check, "_code_sizes", lambda: {"big.py": 1201})

    assert check.structure_violations() == [
        "a layer",
        "big.py: 1201 lines, over its recorded 1200; put additions in a new file",
        f"{PACKAGE}/run.py::run: 151 lines, over the 150 ceiling; split it",
        f"{PACKAGE}/plans.py::unused: only tests refer to it; "
        "delete it and their uses of it",
    ]


@pytest.mark.parametrize(
    ("changed", "selected"),
    [
        (f"{PACKAGE}/plans.py", ["tests/test_direct.py", "tests/test_package.py"]),
        (f"{PACKAGE}/ledger.py", ["tests/test_direct.py", "tests/test_package.py"]),
        (f"{PACKAGE}/wire.py", ["tests/test_direct.py", "tests/test_package.py"]),
        (
            f"{PACKAGE}/__init__.py",
            [
                "tests/test_deleted.py",
                "tests/test_deleted_name.py",
                "tests/test_direct.py",
                "tests/test_domain.py",
                "tests/test_package.py",
            ],
        ),
        (
            f"{PACKAGE}/deleted.py",
            ["tests/test_deleted.py", "tests/test_deleted_name.py"],
        ),
        ("tests/e2e/simulator.py", ["tests/e2e/test_run.py"]),
        ("tests/e2e/mission.py", ["tests/e2e/test_run.py"]),
        ("tests/e2e/conftest.py", ["tests/e2e/test_run.py", "tests/e2e/test_stop.py"]),
        ("tests/e2e/pairing.py", ["tests/e2e/test_run.py", "tests/e2e/test_stop.py"]),
        ("tests/test_domain.py", ["tests/test_domain.py"]),
        ("docs/guide.md", []),
    ],
)
def test_tests_follow_the_changed_file(
    tmp_path: Path, changed: str, selected: list[str]
) -> None:
    _write(
        tmp_path,
        {
            f"{PACKAGE}/__init__.py": "",
            f"{PACKAGE}/plans.py": "from . import ledger\n",
            f"{PACKAGE}/ledger.py": "from . import wire\n",
            f"{PACKAGE}/wire.py": "",
            "tests/e2e/simulator.py": "from . import mission\n",
            "tests/e2e/mission.py": "",
            "tests/e2e/pairing.py": "",
            "tests/e2e/conftest.py": "from . import pairing\n",
            "tests/test_direct.py": f"from {INTEGRATION}.plans import Manager\n",
            "tests/test_package.py": f"from {INTEGRATION} import plans\n",
            "tests/test_domain.py": f"from {INTEGRATION} import DOMAIN\n",
            "tests/test_deleted.py": f"from {INTEGRATION}.deleted import gone\n",
            "tests/test_deleted_name.py": f"from {INTEGRATION} import deleted\n",
            "tests/e2e/test_run.py": "from .simulator import start\n",
            "tests/e2e/test_stop.py": "",
        },
    )

    assert check.tests_for([Path(changed)], tmp_path) == selected


def _answer(monkeypatch: pytest.MonkeyPatch, answers: dict[str, list[str]]) -> list:
    """Answer each git command from a table and return the calls made."""
    calls = []

    def git(command: str, *arguments: str) -> list[str]:
        calls.append((command, *arguments))
        return answers.get(command, [])

    monkeypatch.setattr(check, "_git", git)
    return calls


def test_base_is_where_head_left_the_nearest_main_or_release_branch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    distances = {"old..HEAD": ["40"], "near..HEAD": ["2"]}

    def git(command: str, *arguments: str) -> list[str]:
        if command == "for-each-ref":
            return ["refs/remotes/origin/main", "refs/remotes/origin/release/0.6"]
        if command == "merge-base":
            return ["old" if arguments[1].endswith("/main") else "near"]
        return distances[arguments[1]]

    monkeypatch.setattr(check, "_git", git)
    assert check.nearest_base() == "near"

    monkeypatch.setattr(check, "_git", lambda *_: ["refs/remotes/origin/feature"])
    assert check.nearest_base() is None


def test_deleted_and_renamed_files_count_as_changed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _answer(
        monkeypatch, {"diff": ["deleted.py", "edited.py"], "ls-files": ["new.py"]}
    )

    assert check.changed_files("base") == [
        Path("deleted.py"),
        Path("edited.py"),
        Path("new.py"),
    ]
    # With rename detection git lists a moved file under its new name only.
    assert ("diff", "--name-only", "--no-renames", "base") in calls


def test_changed_lines_are_the_ones_a_diff_adds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    diff = f"""\
--- a/{PACKAGE}/plans.py
+++ b/{PACKAGE}/plans.py
@@ -3 +3,2 @@ def run() -> None:
+    first()
+    second()
@@ -10,2 +10,0 @@
-    removed()
-    removed()
@@ -20 +18 @@
-    before()
+    after()
--- a/{PACKAGE}/deleted.py
+++ /dev/null
@@ -1,2 +0,0 @@
-removed()
-removed()
--- a/{PACKAGE}/old_name.py
+++ b/{PACKAGE}/new_name.py
@@ -7 +7 @@
-    before()
+    after()
"""
    _write(tmp_path, {f"{PACKAGE}/untracked.py": "one()\ntwo()\n"})
    monkeypatch.setattr(check, "ROOT", tmp_path)
    calls = _answer(
        monkeypatch,
        {"diff": diff.splitlines(), "ls-files": [f"{PACKAGE}/untracked.py"]},
    )

    assert check.changed_lines("base") == {
        f"{PACKAGE}/plans.py": {3, 4, 18},
        f"{PACKAGE}/new_name.py": {7},
        f"{PACKAGE}/untracked.py": {1, 2},
    }
    # Only the integration is measured, and a moved file is not new code.
    assert calls[0][-2:] == ("--", PACKAGE)
    assert "--find-renames" in calls[0]


def test_untested_lines_and_branches_of_a_change_are_reported() -> None:
    report = {
        "files": {
            "a.py": {
                "missing_lines": [3, 8],
                "missing_branches": [[4, 6], [4, -2], [9, 10]],
            },
            "b.py": {"missing_lines": [1], "missing_branches": [[1, 2]]},
        }
    }

    assert check.untested(report, {"a.py": {3, 4}}) == [
        "a.py:3: no test runs this line",
        "a.py:4: no test goes from here to line 6",
        "a.py:4: no test goes from here to the end of the function",
    ]


BUILD = ["npm", "run", "build:map-studio-v4"]


GAP = {"missing_lines": [3], "missing_branches": []}


@pytest.mark.parametrize(
    ("arguments", "changed", "failing", "violations", "status", "tests"),
    [
        ([], [Path("tests/test_check.py")], None, [], 0, ["tests/test_check.py"]),
        ([], [], None, [], 0, None),
        ([], None, None, [], 0, check.FULL_SUITE),
        (["--all"], [], None, [], 0, check.FULL_SUITE),
        # CI's test job reads the build job's output and builds nothing.
        (["--all", "--built"], [], None, [], 0, check.FULL_SUITE),
        # So it needs no Node.js.
        (["--all", "--built"], [], "no Node.js", [], 0, check.FULL_SUITE),
        (["--all"], [], "pytest", [], 1, check.FULL_SUITE),
        (["--all"], [], "ruff", [], 1, check.FULL_SUITE),
        (["--all"], [], None, ["a.py: too long"], 1, check.FULL_SUITE),
        (["--all"], [], "build:map-studio-v4", [], 1, None),
        (["--all"], [], "no Node.js", [], 1, None),
        # An untested line fails only where the change touches it.
        (["--all"], [], "untested: old.py", [], 0, check.FULL_SUITE),
        (["--all"], [], "untested: new.py", [], 1, check.FULL_SUITE),
        (["--all"], None, "untested: new.py", [], 0, check.FULL_SUITE),
        ([], [], "untested: new.py", [], 0, None),
    ],
)
def test_main_fails_when_any_check_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    arguments: list[str],
    changed: list[Path] | None,
    failing: str | None,
    violations: list[str],
    status: int,
    tests: list[str] | None,
) -> None:
    commands = []

    def run(command: list[str], **_: object) -> SimpleNamespace:
        commands.append(command)
        return SimpleNamespace(
            returncode=int(failing in command), stdout=f"ran {command[-1]}\n"
        )

    untested = str(failing).removeprefix("untested: ")
    totals = {
        "percent_statements_covered_display": "100",
        "percent_branches_covered_display": "97",
    }
    (tmp_path / check.REPORT).write_text(
        json.dumps({"files": {untested: GAP}, "totals": totals})
    )
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check.subprocess, "run", run)
    # No base is known exactly when nothing can say what changed.
    monkeypatch.setattr(
        check, "nearest_base", lambda: None if changed is None else "base"
    )
    monkeypatch.setattr(check, "changed_files", lambda base: changed)
    monkeypatch.setattr(check, "changed_lines", lambda base: {"new.py": {3}})
    monkeypatch.setattr(check, "tests_for", lambda paths: [str(p) for p in paths])
    monkeypatch.setattr(check, "structure_violations", lambda: violations)
    monkeypatch.setattr(
        check, "build_commands", lambda: None if failing == "no Node.js" else [BUILD]
    )

    assert check.main(arguments) == status
    pytest_runs = [command[3:] for command in commands if "pytest" in command]
    # Every test run spreads over one worker per CPU.
    assert all(run[: len(check.PARALLEL)] == check.PARALLEL for run in pytest_runs)
    pytest_runs = [run[len(check.PARALLEL) :] for run in pytest_runs]
    # The client's tests run with Home Assistant blocked on every check.
    # The suites run on separate threads, so they may start in either order.
    expected = [check.CLIENT_SUITE, *([] if tests is None else [tests])]
    assert sorted(map(str, pytest_runs)) == sorted(map(str, expected))
    # Tests read the built Matic Map, so every test run follows a build
    # unless the tree already holds one.
    built = "--built" in arguments
    assert (BUILD in commands) == (
        not built and (tests is not None or failing in BUILD)
    )
    # The scan reads the tree the build and the tests write to.
    privacy = next(i for i, c in enumerate(commands) if "check_public_tree" in c[-1])
    assert all(privacy < i for i, c in enumerate(commands) if c == BUILD)
    # Each check's output is printed under its name.
    assert "--- privacy\nran scripts/check_public_tree.py\n" in capsys.readouterr().out


def test_base_that_is_not_a_commit_stops_the_check(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    calls = _answer(monkeypatch, {})

    with pytest.raises(SystemExit):
        check.main(["--all", "--base", "HEAD^1"])

    assert calls == [("rev-parse", "--verify", "HEAD^1^{commit}")]
    assert "--base HEAD^1 is not a commit in this checkout" in capsys.readouterr().err


def test_matic_map_is_built_with_npm_and_installed_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(check.shutil, "which", lambda name: None)
    assert check.build_commands(tmp_path) is None

    monkeypatch.setattr(check.shutil, "which", lambda name: name)
    assert check.build_commands(tmp_path) == [["npm", "ci"], BUILD]
    (tmp_path / "node_modules").mkdir()
    assert check.build_commands(tmp_path) == [BUILD]
