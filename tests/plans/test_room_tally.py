"""A running run's room tally: each room counted once, and never dropped."""

from datetime import timedelta

from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.run_machine import count_room
from tests.plans.fakes import memory_manager, plan_room

KITCHEN = plan_room("Kitchen", "room-kitchen")
OFFICE = plan_room("Office", "room-office")
FLOOR = FloorPlan(
    1,
    "partition",
    b"partition",
    tuple(
        Room(room.room_id, room.name, room.room_id, room.room_id.encode(), ())
        for room in (KITCHEN, OFFICE)
    ),
)


async def _kitchen_reconciled_mid_run(hass):
    """Leg one ended Kitchen unverified; its native record arrives during leg two.

    Returns the manager, the executor's checkpoint as it stands, the record and
    the marker the import cleared.
    """
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial", "plan", "run", 2, trigger="user", service="run_selected_plan"
    )
    checkpoint = {"leg_index": 1, "phase": "handoff", "completed_room_ids": []}
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    now = dt_util.utcnow()
    await manager.ledger.async_mark_started("serial", "plan", KITCHEN)
    await manager.ledger.async_mark_ended_unverified(
        "serial",
        "plan",
        KITCHEN,
        native_reconciliation={
            "plan_id": "plan",
            "room_id": KITCHEN.room_id,
            "room": KITCHEN.name,
            "dispatched_at": (now - timedelta(seconds=20)).isoformat(),
            "run_id": "run",
        },
    )
    record = CleaningSessionRecord(
        b"synthetic-session",
        CleaningSession(
            (now - timedelta(seconds=15)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            14,
            (KITCHEN.name,),
            ((KITCHEN.name, 14),),
            True,
            (KITCHEN.name,),
        ),
    )
    marker = dict(manager.repository.robot("serial")["pending_native_reconciliation"])
    assert await manager.ledger.async_import_native_history("serial", FLOOR, [record])
    return manager, checkpoint, record, marker


def _tally(manager) -> tuple[int, list[str]]:
    run = manager.repository.robot("serial")["last_run"]
    return run["completed_room_count"], run["recovery_checkpoint"]["completed_room_ids"]


async def test_native_history_counts_a_room_once(hass) -> None:
    """A retained marker the history already credited does not count again."""
    manager, _, record, marker = await _kitchen_reconciled_mid_run(hass)
    assert _tally(manager) == (1, [KITCHEN.room_id])
    robot = manager.repository.robot("serial")
    # The credit was saved before its marker was cleared.
    robot["pending_native_reconciliation"] = marker

    assert await manager.ledger.async_import_native_history("serial", FLOOR, [record])

    assert "pending_native_reconciliation" not in robot
    assert _tally(manager) == (1, [KITCHEN.room_id])


async def test_a_queue_save_keeps_a_room_native_history_counted(hass) -> None:
    """The executor's next save cannot drop a room another writer counted."""
    manager, checkpoint, *_ = await _kitchen_reconciled_mid_run(hass)
    checkpoint.update(phase="dispatching")

    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)

    assert _tally(manager) == (1, [KITCHEN.room_id])


def test_count_room_counts_each_room_once_up_to_the_run_size() -> None:
    run = {"room_count": 1, "completed_room_count": 0, "recovery_checkpoint": {}}

    assert count_room(run, "kitchen") is True
    assert count_room(run, "kitchen") is False
    assert count_room(run, "office") is True
    assert run["completed_room_count"] == 1
    assert run["recovery_checkpoint"] == {"completed_room_ids": ["kitchen", "office"]}
    finished = {"room_count": 2, "completed_room_count": 1}
    assert count_room(finished, "kitchen") is True
    assert finished == {"room_count": 2, "completed_room_count": 2}
