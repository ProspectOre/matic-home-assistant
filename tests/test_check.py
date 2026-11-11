"""Layer, size and test-selection rules of the check command."""

from __future__ import annotations

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
                "from . import cadence\nfrom .client.api import Client\n"
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
        ({"a.py": check.CEILING}, {}, []),
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
                f"{check.BASELINE}: {name} is within the ceiling or gone; "
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


def test_deleted_and_renamed_files_count_as_changed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    answers = {
        "for-each-ref": ["refs/remotes/origin/release/0.6"],
        "merge-base": ["base"],
        "rev-list": ["1"],
        "diff": ["deleted.py", "edited.py"],
        "ls-files": ["new.py"],
    }
    calls = []

    def git(command: str, *arguments: str) -> list[str]:
        calls.append((command, *arguments))
        return answers[command]

    monkeypatch.setattr(check, "_git", git)

    assert check.changed_files() == [
        Path("deleted.py"),
        Path("edited.py"),
        Path("new.py"),
    ]
    # With rename detection git lists a moved file under its new name only.
    assert ("diff", "--name-only", "--no-renames", "base") in calls


@pytest.mark.parametrize(
    ("arguments", "changed", "failing", "violations", "status", "tests"),
    [
        ([], [Path("tests/test_check.py")], None, [], 0, ["tests/test_check.py"]),
        ([], [], None, [], 0, None),
        ([], None, None, [], 0, check.FULL_SUITE),
        (["--all"], [], None, [], 0, check.FULL_SUITE),
        (["--all"], [], "pytest", [], 1, check.FULL_SUITE),
        (["--all"], [], "ruff", [], 1, check.FULL_SUITE),
        (["--all"], [], None, ["a.py: too long"], 1, check.FULL_SUITE),
    ],
)
def test_main_fails_when_any_check_fails(
    monkeypatch: pytest.MonkeyPatch,
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
        return SimpleNamespace(returncode=int(failing in command))

    monkeypatch.setattr(check.subprocess, "run", run)
    monkeypatch.setattr(check, "changed_files", lambda: changed)
    monkeypatch.setattr(check, "tests_for", lambda paths: [str(p) for p in paths])
    monkeypatch.setattr(check, "layer_violations", lambda: violations)
    monkeypatch.setattr(check, "_code_sizes", dict)
    monkeypatch.setattr(check, "_baseline", dict)

    assert check.main(arguments) == status
    pytest_runs = [command[3:] for command in commands if "pytest" in command]
    assert pytest_runs == ([] if tests is None else [tests])
