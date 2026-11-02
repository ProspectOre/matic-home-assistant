"""Managed completion events survive later native-history corrections."""

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.util import dt as dt_util

from custom_components.matic_robot.plan_model import CleaningRoom, plan_floor_token
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.test_native_cadence import scenario


async def test_native_retraction_preserves_a_later_managed_completion(hass):
    floor, native, _schedule, _robot = scenario()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    identity = _schedule["identity"]
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                    "cadence": {"scope": "shared", **_schedule["policy"]},
                }
            ],
        },
        floor_token=plan_floor_token(floor),
        room_identities={room.room_id: identity},
    )
    robot = manager.repository.robot("serial")
    schedule = robot["shared_room_cadence"][room.room_id]
    # Model a schedule enabled before the external run, without backfilling a
    # newly created schedule or relying on a wall-clock sleep.
    cutoff = (dt_util.utcnow() - timedelta(hours=1)).isoformat()
    robot["native_cleanings"] = {"enabled": True, "since": cutoff}
    schedule["native_since"] = cutoff
    await manager.ledger.async_import_native_history("serial", floor, [native])
    assert schedule["progress"] == {"mop": 1, "coverage": 1}

    _rooms, snapshots = manager.cadence.resolve_cadence(
        "serial", "home", [room], room_identities={room.room_id: identity}
    )
    await manager.ledger.async_begin_run(
        "serial", "home", "managed-run", 1, trigger="user", service="test"
    )
    await manager.ledger.async_mark_started(
        "serial", "home", room, run_id="managed-run"
    )
    await manager.recovery.async_set_recovery_checkpoint(
        "serial",
        "managed-run",
        {"cadence_by_room": snapshots, "completed_room_ids": []},
    )
    await manager.ledger.async_mark_completed(
        "serial", "home", room, run_id="managed-run"
    )
    assert schedule["progress"] == {"mop": 2, "coverage": 2}

    cancelled = replace(
        native, session=replace(native.session, stop_reason="user_cancelled")
    )
    await manager.ledger.async_import_native_history("serial", floor, [cancelled])

    assert schedule["progress"] == {"mop": 1, "coverage": 1}
    assert robot["rooms"][room.room_id]["completed_runs"] == 1
