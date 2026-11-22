"""Attempts that end without verified completion leave the daily limit alone."""

from custom_components.matic_robot.plan_model import CleaningRoom, room_cadence_identity
from tests.plans.fakes import memory_manager
from tests.test_daily_room_limit import ROOM_ID, SERIAL, _floor


async def test_failed_cancelled_and_skipped_attempts_do_not_count(hass):
    manager = memory_manager(hass)
    identity = room_cadence_identity(_floor(), ROOM_ID)
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=1, require_current=lambda: True
    )
    room = CleaningRoom(ROOM_ID, "Kitchen", "vacuum", "standard")
    await manager.ledger.async_begin_run(
        SERIAL, "home", "run", 1, trigger="user", service="run_selected_plan"
    )
    await manager.ledger.async_mark_failed(SERIAL, "home", room, "failed")
    await manager.ledger.async_mark_interrupted(SERIAL, "home", room, "interrupted")
    await manager.ledger.async_mark_cancelled(SERIAL, "home", room)
    await manager.ledger.async_mark_settled(
        SERIAL,
        "home",
        room,
        "skipped",
        run_id="run",
        completion_is_current=lambda: True,
    )
    assert manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity) == {
        "limit": 1,
        "completed_today": 0,
        "reached": False,
    }
