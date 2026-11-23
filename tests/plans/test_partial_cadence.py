"""A partly cleaned room counts toward its schedule as the modes it started.

Issue #566: a room the robot can only partly clean must not stall its mop
schedule. A room it never started counts for nothing, and neither the partial
work nor the settlement counts the room as cleaned.
"""

from __future__ import annotations

import pytest

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
):
    manager = memory_manager(hass)
    identity = room_cadence_identity(_floor(), ROOM.room_id)
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
                    "cadence": {
                        "scope": "plan",
                        "mop_every_n": mop_every_n,
                        "do_mop_next": mop_next,
                    },
                }
            ],
        },
        room_identities={ROOM.room_id: identity},
        floor_token=plan_floor_token(_floor()),
    )
    rooms, snapshots = manager.cadence.resolve_cadence(
        "serial", "home", [ROOM], room_identities={ROOM.room_id: identity}
    )
    await manager.ledger.async_begin_run(
        "serial", "home", "run-1", 1, trigger="user", service="test"
    )
    await manager.ledger.async_mark_started("serial", "home", rooms[0], run_id="run-1")
    await manager.recovery.async_set_recovery_checkpoint(
        "serial",
        "run-1",
        {
            "cadence_by_room": {
                ROOM.room_id: {**snapshots[ROOM.room_id], "identity": identity}
            },
            "completed_room_ids": [],
        },
    )
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
    record = manager.repository.robot("serial")["rotations"]["home"]["rooms"].get(
        ROOM.room_id, {}
    )
    assert "last_completed" not in record  # Never counted as cleaned.
    if current and not isinstance(settled, str):
        assert record[f"{settled.result}_runs"] == 1
    assert snapshots[ROOM.room_id]["mop_due"] is mop_next
    policy = manager.repository.robot("serial")["plans"]["home"]["rooms"][0]["cadence"]
    progress = manager.cadence.cadence_progress("serial", "home", ROOM.room_id)
    return progress, policy["do_mop_next"]


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
async def test_partial_work_counts_toward_a_mop_not_yet_due(hass, settled, mop) -> None:
    progress, _mop_next = await _settle(hass, settled, mop_every_n=3)
    assert progress == {"mop": mop, "coverage": 0}


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
    progress, mop_next = await _settle(
        hass, RobotEnded("partly_cleaned", attempted), mop_every_n=3, mop_next=True
    )
    assert progress == {"mop": mop, "coverage": 0}
    assert mop_next is still_due


async def test_partial_work_from_another_run_counts_nothing(hass) -> None:
    progress, _mop_next = await _settle(
        hass, RobotEnded("partly_cleaned", "vacuum"), mop_every_n=3, run_id="run-2"
    )
    assert progress == {"mop": 0, "coverage": 0}


async def test_a_replayed_settlement_counts_once(hass) -> None:
    # Recovery can settle the room again if it stopped before the checkpoint
    # recorded the first settlement.
    progress, _mop_next = await _settle(
        hass, RobotEnded("partly_cleaned", "vacuum"), mop_every_n=3, settlements=2
    )
    assert progress == {"mop": 1, "coverage": 0}


async def test_partial_work_after_the_run_lost_the_robot_counts_nothing(
    hass,
) -> None:
    progress, _mop_next = await _settle(
        hass, RobotEnded("partly_cleaned", "vacuum"), mop_every_n=3, current=False
    )
    assert progress == {"mop": 0, "coverage": 0}
