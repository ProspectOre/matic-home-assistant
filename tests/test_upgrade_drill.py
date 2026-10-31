"""Upgrade drill store comparison tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from scripts.upgrade_drill import DrillFailed, compare, plan_state


def _state(runs: int, cadence: int = 3) -> dict[str, Any]:
    return {
        "plan": {
            "rooms": [{"room_id": "kitchen", "cadence": {"mop_every_n": cadence}}]
        },
        "completed_runs": {"kitchen": runs},
    }


def test_plan_state_reads_the_drill_robot(tmp_path: Path) -> None:
    storage = tmp_path / ".storage"
    storage.mkdir()
    robot = {
        "plans": {"evening": {"rooms": []}},
        "rotations": {"evening": {"rooms": {"kitchen": {"completed_runs": 2}}}},
        "last_run": {"outcome": "completed"},
    }
    (storage / "matic_robot.plans").write_text(
        json.dumps({"minor_version": 12, "data": {"robots": {"SIM": robot}}})
    )
    assert plan_state(tmp_path) == {
        "minor_version": 12,
        "plan": {"rooms": []},
        "completed_runs": {"kitchen": 2},
        "last_run": "completed",
        "run_history": 0,
    }


def test_rollback_must_keep_the_plan_and_room_history() -> None:
    compare({"seed": _state(1), "upgrade": _state(2), "restore": _state(1)})
    with pytest.raises(DrillFailed, match="downgrade changed the saved plan"):
        compare({"seed": _state(1), "downgrade": _state(2, cadence=4)})
    with pytest.raises(DrillFailed, match="restore lost completed runs"):
        compare({"seed": _state(2), "restore": _state(1)})
