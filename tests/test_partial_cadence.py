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
    hass,
    ended: RobotEnded,
    *,
    mop_next: bool = False,
    run_id: str = "run-1",
    settlements: int = 1,
    current: bool = True,
    scope: str = "plan",
    active_plan: dict[str, str] | None = None,
):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    identities = {ROOM.room_id: "a" * 64}
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
                        "scope": scope,
                        "mop_every_n": 3,
                        "do_mop_next": mop_next,
                    },
                }
            ],
        },
        floor_token="f" * 64,
        room_identities=identities,
    )
    rooms, snapshots = manager.resolve_cadence(
        "serial",
        "home",
        [ROOM],
        floor_token="f" * 64,
        room_identities=identities,
        use_shared_schedule=scope == "shared",
    )
    assert snapshots[ROOM.room_id]["mop_due"] is mop_next
    await manager.async_begin_run(
        "serial", "home", "run-1", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "run-1",
        {"cadence_by_room": dict(snapshots), "completed_room_ids": []},
    )
    if active_plan is not None:
        manager._robot("serial")["active_plan"] = dict(active_plan)
    for _ in range(settlements):
        assert (
            await manager.async_mark_robot_ended(
                "serial",
                "home",
                rooms[0],
                ended,
                run_id=run_id,
                completion_is_current=lambda: current,
            )
            is current
        )
    robot = manager._robot("serial")
    if active_plan is not None:
        # Only this run's own active plan is cleared.
        owned = (active_plan["plan_id"], active_plan["run_id"]) == ("home", run_id)
        cleared = current and owned
        assert robot["active_plan"] == (None if cleared else active_plan)
    rotation = robot["rotations"].get("home", {"rooms": {}})
    record = rotation["rooms"].get(ROOM.room_id, {})
    assert "last_completed" not in record  # Never counted as cleaned.
    if current:
        assert record["last_result"] == ended.result
        assert record[f"{ended.result}_runs"] == settlements
    else:
        assert "last_result" not in record  # Nothing written for a lost run.
    policy = (
        robot["shared_room_cadence"][ROOM.room_id]["policy"]
        if scope == "shared"
        else robot["plans"]["home"]["rooms"][0]["cadence"]
    )
    mop = manager.cadence_progress("serial", "home", ROOM.room_id)["mop"]
    return mop, policy.get("do_mop_next", False)


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
        # A started mop is the due mop even if the vacuum never ran.
        ("mop", 0, False),
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


async def test_partial_work_counts_once_per_run(hass) -> None:
    ended = RobotEnded("partly_cleaned", "vacuum")
    assert (await _settle(hass, ended, settlements=2))[0] == 1


@pytest.mark.parametrize(
    ("attempted", "mop_next", "expected"),
    [
        ("vacuum", False, (1, False)),
        ("vacuum", True, (2, True)),
        ("mop", True, (0, False)),
    ],
)
async def test_partial_work_counts_toward_a_shared_schedule(
    hass, attempted, mop_next, expected
) -> None:
    ended = RobotEnded("partly_cleaned", attempted)
    assert await _settle(hass, ended, mop_next=mop_next, scope="shared") == expected


async def test_partial_work_counts_once_per_run_on_a_shared_schedule(hass) -> None:
    ended = RobotEnded("partly_cleaned", "vacuum")
    assert (await _settle(hass, ended, settlements=2, scope="shared"))[0] == 1


async def test_partial_work_after_the_run_lost_the_robot_counts_nothing(
    hass,
) -> None:
    ended = RobotEnded("partly_cleaned", "vacuum")
    assert await _settle(hass, ended, current=False) == (0, False)


@pytest.mark.parametrize(
    "active_plan",
    [
        {"plan_id": "home", "run_id": "run-1", "room_id": ROOM.room_id},
        {"plan_id": "home", "run_id": "run-2", "room_id": ROOM.room_id},
        {"plan_id": "other", "run_id": "run-1", "room_id": ROOM.room_id},
    ],
    ids=["this-run", "another-run", "another-plan"],
)
@pytest.mark.parametrize("current", [True, False])
async def test_settling_clears_only_this_runs_active_plan(
    hass, active_plan, current
) -> None:
    ended = RobotEnded("partly_cleaned", "vacuum")
    await _settle(hass, ended, current=current, active_plan=active_plan)
