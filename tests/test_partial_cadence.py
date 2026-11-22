"""A partly cleaned room counts toward its schedule as the modes it started.

Issue #566: a room the robot can only partly clean must not stall its mop
schedule. A room it never started counts for nothing, and neither counts the
room as cleaned.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from custom_components.matic_robot.native_completion import RobotEnded
from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom

ROOM = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")


async def _settle(
    hass, ended: RobotEnded, *, mop_next: bool = False, run_id: str = "run-1"
):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": ROOM.room_id,
                    "name": ROOM.name,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "plan",
                        "mop_every_n": 3,
                        "do_mop_next": mop_next,
                    },
                }
            ],
        },
    )
    rooms, snapshots = manager.resolve_cadence("serial", "home", [ROOM])
    assert snapshots[ROOM.room_id]["mop_due"] is mop_next
    await manager.async_begin_run(
        "serial", "home", "run-1", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "run-1",
        {"cadence_by_room": dict(snapshots), "completed_room_ids": []},
    )
    await manager.async_mark_robot_ended(
        "serial", "home", rooms[0], ended, run_id=run_id
    )
    robot = manager._robot("serial")
    record = robot["rotations"]["home"]["rooms"][ROOM.room_id]
    assert record["last_result"] == ended.result
    assert "last_completed" not in record  # Never counted as cleaned.
    progress = (
        robot["plan_room_cadence"].get("home", {}).get(ROOM.room_id, {}).get("progress")
    )
    mop = progress["mop"] if progress else 0
    return mop, robot["plans"]["home"]["rooms"][0]["cadence"]["do_mop_next"]


@pytest.mark.parametrize(
    ("ended", "mop"),
    [
        # Partial vacuum work counts as a clean toward the next mop.
        (RobotEnded("partly_cleaned", "vacuum"), 1),
        # A room the robot never started counts nothing.
        (RobotEnded("unreachable", None), 0),
    ],
)
async def test_partial_work_counts_toward_a_mop_not_yet_due(hass, ended, mop) -> None:
    assert await _settle(hass, ended) == (mop, False)


@pytest.mark.parametrize(
    ("attempted", "mop", "still_due"),
    [
        # The robot started the due mop, so it counts and the count restarts.
        ("vacuum_and_mop", 0, False),
        # It never started mopping, so the mop stays due.
        ("vacuum", 2, True),
    ],
)
async def test_a_started_mop_counts_as_the_due_mop(
    hass, attempted, mop, still_due
) -> None:
    ended = RobotEnded("partly_cleaned", attempted)
    assert await _settle(hass, ended, mop_next=True) == (mop, still_due)


async def test_partial_work_from_another_run_counts_nothing(hass) -> None:
    ended = RobotEnded("partly_cleaned", "vacuum")
    assert await _settle(hass, ended, run_id="run-2") == (0, False)
