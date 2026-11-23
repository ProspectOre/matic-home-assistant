"""A partly cleaned room counts toward its schedule as the modes it started.

Issue #566: a room the robot can only partly clean must not stall its mop
schedule. A room it never started counts for nothing, and neither the partial
work nor the settlement counts the room as cleaned.
"""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.cadence_accounting import (
    apply_verified_cadence,
    managed_completion_id,
)
from custom_components.matic_robot.native_completion import RobotEnded
from custom_components.matic_robot.plan_model import CleaningRoom, plan_floor_token
from custom_components.matic_robot.room_identity import room_cadence_identity
from tests.plans.fakes import memory_manager
from tests.test_cadence_manager import _floor

ROOM = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")


async def _settle(
    hass,
    settled,
    *,
    mop_every_n: int,
    mop_next: bool = False,
    run_id: str = "run-1",
    settlements: int = 1,
    current: bool = True,
    scope: str = "plan",
    coverage_next: bool | None = None,
    run_changes: dict[str, Any] | None = None,
    then_complete: bool = False,
):
    manager = memory_manager(hass)
    identity = room_cadence_identity(_floor(), ROOM.room_id)
    cadence: dict[str, Any] = {
        "scope": scope,
        "mop_every_n": mop_every_n,
        "do_mop_next": mop_next,
    }
    if coverage_next is not None:
        cadence |= {
            "coverage_every_n": 3,
            "periodic_coverage_setting": "heavy_duty",
            "do_coverage_next": coverage_next,
        }
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": ROOM.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": cadence,
                }
            ],
        },
        room_identities={ROOM.room_id: identity},
        floor_token=plan_floor_token(_floor()),
    )
    rooms, snapshots = manager.cadence.resolve_cadence(
        "serial",
        "home",
        [ROOM],
        floor_token=plan_floor_token(_floor()),
        room_identities={ROOM.room_id: identity},
        use_shared_schedule=scope == "shared",
    )
    snapshot = {**snapshots[ROOM.room_id], "identity": identity}
    await manager.ledger.async_begin_run(
        "serial", "home", "run-1", 1, trigger="user", service="test"
    )
    await manager.ledger.async_mark_started("serial", "home", rooms[0], run_id="run-1")
    await manager.recovery.async_set_recovery_checkpoint(
        "serial",
        "run-1",
        {
            "cadence_by_room": {ROOM.room_id: snapshot},
            "completed_room_ids": [],
        },
    )
    robot = manager.repository.robot("serial")
    robot["last_run"] |= run_changes or {}
    for _ in range(settlements):
        assert (
            await manager.ledger.async_mark_settled(
                "serial",
                "home",
                rooms[0],
                settled,
                run_id=run_id,
                completion_is_current=lambda: current,
            )
            is current
        )
    if then_complete:
        # The run's later completion of the room, under the id every managed
        # completion uses.
        apply_verified_cadence(
            robot,
            "home",
            ROOM,
            snapshot,
            completion_id=managed_completion_id("run-1", ROOM.room_id),
            completed_at=dt_util.utcnow().timestamp() + 60,
        )
    record = robot["rotations"]["home"]["rooms"].get(ROOM.room_id, {})
    assert "last_completed" not in record  # Never counted as cleaned.
    if current and not isinstance(settled, str):
        assert record[f"{settled.result}_runs"] == 1
    assert snapshots[ROOM.room_id]["mop_due"] is mop_next
    if scope == "shared":
        policy = robot["shared_room_cadence"][ROOM.room_id]["policy"]
    else:
        policy = robot["plans"]["home"]["rooms"][0]["cadence"]
    progress = manager.cadence.cadence_progress("serial", "home", ROOM.room_id)
    if coverage_next is not None:
        assert policy["do_coverage_next"] is coverage_next
    return progress, policy["do_mop_next"]


@pytest.mark.parametrize("scope", ["plan", "shared"])
@pytest.mark.parametrize(
    ("settled", "mop"),
    [
        # Partial vacuum work counts as a clean toward the next mop.
        (RobotEnded("partly_cleaned", "vacuum"), 1),
        # A room the robot never started, or the owner skipped, counts nothing.
        (RobotEnded("unreachable", None), 0),
        ("skipped", 0),
    ],
)
async def test_partial_work_counts_toward_a_mop_not_yet_due(
    hass, settled, mop, scope
) -> None:
    progress, _mop_next = await _settle(hass, settled, mop_every_n=3, scope=scope)
    assert progress == {"mop": mop, "coverage": 0}


@pytest.mark.parametrize("scope", ["plan", "shared"])
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
    hass, attempted, mop, still_due, scope
) -> None:
    progress, mop_next = await _settle(
        hass,
        RobotEnded("partly_cleaned", attempted),
        mop_every_n=3,
        mop_next=True,
        scope=scope,
    )
    assert progress == {"mop": mop, "coverage": 0}
    assert mop_next is still_due


@pytest.mark.parametrize(
    ("coverage_next", "coverage"),
    [
        # Partial work counts as a clean toward the next coverage level...
        (False, 1),
        # ...but never proves the level ran, so a due level stays due.
        (True, 2),
    ],
)
async def test_partial_work_never_proves_a_coverage_level(
    hass, coverage_next, coverage
) -> None:
    progress, _mop_next = await _settle(
        hass,
        RobotEnded("partly_cleaned", "vacuum"),
        mop_every_n=3,
        coverage_next=coverage_next,
    )
    assert progress == {"mop": 1, "coverage": coverage}


@pytest.mark.parametrize(
    "run_changes",
    [
        {"run_id": "run-2"},
        {"outcome": "completed"},
        {"plan_id": "other"},
    ],
    ids=["another-run", "finished-run", "another-plan"],
)
async def test_partial_work_outside_the_running_plan_counts_nothing(
    hass, run_changes
) -> None:
    progress, _mop_next = await _settle(
        hass,
        RobotEnded("partly_cleaned", "vacuum"),
        mop_every_n=3,
        run_changes=run_changes,
    )
    assert progress == {"mop": 0, "coverage": 0}


async def test_partial_work_from_another_run_counts_nothing(hass) -> None:
    progress, _mop_next = await _settle(
        hass, RobotEnded("partly_cleaned", "vacuum"), mop_every_n=3, run_id="run-2"
    )
    assert progress == {"mop": 0, "coverage": 0}


@pytest.mark.parametrize("scope", ["plan", "shared"])
async def test_a_replayed_settlement_counts_once(hass, scope) -> None:
    # Recovery can settle the room again if it stopped before the checkpoint
    # recorded the first settlement.
    progress, _mop_next = await _settle(
        hass,
        RobotEnded("partly_cleaned", "vacuum"),
        mop_every_n=3,
        settlements=2,
        scope=scope,
    )
    assert progress == {"mop": 1, "coverage": 0}


@pytest.mark.parametrize("scope", ["plan", "shared"])
async def test_a_later_completion_in_the_run_counts_as_a_second_clean(
    hass, scope
) -> None:
    progress, _mop_next = await _settle(
        hass,
        RobotEnded("partly_cleaned", "vacuum"),
        mop_every_n=3,
        scope=scope,
        then_complete=True,
    )
    assert progress == {"mop": 2, "coverage": 0}


async def test_partial_work_after_the_run_lost_the_robot_counts_nothing(
    hass,
) -> None:
    progress, _mop_next = await _settle(
        hass, RobotEnded("partly_cleaned", "vacuum"), mop_every_n=3, current=False
    )
    assert progress == {"mop": 0, "coverage": 0}
