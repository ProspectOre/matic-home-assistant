"""Native-history imports recheck motion authority before Store admission."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
)

SERIAL = "synthetic-native-import-robot"


async def test_stale_native_import_releases_command_and_skips_after_replacement(
    hass,
) -> None:
    """Replacement wins while import waits for Store, without room credit."""
    manager = CleaningPlanManager(hass)
    persisted: list[dict] = []

    async def save(data: dict) -> None:
        persisted.append(deepcopy(data))

    manager._store = SimpleNamespace(async_save=AsyncMock(side_effect=save))
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    floor_plan = FloorPlan(
        7,
        "partition-proto",
        b"partition-wire",
        (Room(room.room_id, room.name, "room-proto", b"room-wire", ()),),
    )
    identity = room_cadence_identity(floor_plan, room.room_id)
    await manager.async_save_plan(
        SERIAL,
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "name": room.name,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "plan", "mop_every_n": 1},
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.room_id: identity},
    )
    _effective_rooms, cadence = manager.resolve_cadence(
        SERIAL,
        "home",
        [room],
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.room_id: identity},
    )
    cadence_state = {**cadence[room.room_id], "identity": identity}
    await manager.async_begin_run(
        SERIAL, "home", "run-old", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        SERIAL,
        "run-old",
        {"cadence_by_room": {room.room_id: cadence_state}},
    )
    dispatched_at = dt_util.utcnow() - timedelta(seconds=10)
    await manager.async_mark_started(SERIAL, "home", room, run_id="run-old")
    await manager.async_mark_failed(
        SERIAL,
        "home",
        room,
        "synthetic stop",
        native_reconciliation={
            "plan_id": "home",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at.isoformat(),
            "run_id": "run-old",
            "cleaning_mode": room.cleaning_mode,
            "coverage_setting": room.coverage_setting,
        },
    )

    notifications: list[None] = []
    manager.async_add_listener(SERIAL, lambda: notifications.append(None))
    reconciled_events = []
    hass.bus.async_listen("matic_robot_room_reconciled", reconciled_events.append)
    before_durable = deepcopy(persisted[-1])
    before_save_count = len(persisted)
    before_progress = deepcopy(manager.cadence_progress(SERIAL, "home", room.room_id))

    history = [
        CleaningSessionRecord(
            b"synthetic-native-session",
            CleaningSession(
                (dispatched_at - timedelta(seconds=1)).isoformat(),
                (dispatched_at + timedelta(seconds=5)).isoformat(),
                6,
                (room.name,),
                ((room.name, 6),),
                True,
                (room.name,),
            ),
        )
    ]

    command_lock = manager.command_lock(SERIAL)
    command_lock_requested = asyncio.Event()
    original_command_lock = manager.command_lock

    def observe_command_lock(serial_number: str):
        command_lock_requested.set()
        return original_command_lock(serial_number)

    manager.command_lock = observe_command_lock
    await manager._store_lock.acquire()
    await command_lock.acquire()
    test_holds_command_lock = True
    import_task = asyncio.create_task(
        manager.async_import_native_history(SERIAL, floor_plan, history)
    )
    command_observer = None
    try:
        # The import retrieves this lock while building its domain-lock tuple;
        # by the time the test resumes it has queued behind our held lock.
        await asyncio.wait_for(command_lock_requested.wait(), timeout=1)
        # This waiter queues behind the importer, so acquiring the lock proves
        # the importer acquired and released its command lease before Store.
        command_observer = asyncio.create_task(command_lock.acquire())
        command_lock.release()
        test_holds_command_lock = False
        await asyncio.wait_for(command_observer, timeout=1)
        test_holds_command_lock = True
        command_lock.release()
        test_holds_command_lock = False

        # Import releases its command lease before waiting for the shared Store.
        assert manager._store_lock.locked()
        assert not import_task.done()

        old_motion_generation = manager.motion_generation(SERIAL)
        assert manager.replace_managed_motion(SERIAL) is True
        assert manager.motion_generation(SERIAL) == old_motion_generation + 1
        assert "pending_native_reconciliation" not in manager._robot(SERIAL)
        assert manager.cadence_progress(SERIAL, "home", room.room_id) == before_progress
        assert len(persisted) == before_save_count
    finally:
        if test_holds_command_lock:
            command_lock.release()
        if command_observer is not None and not command_observer.done():
            command_observer.cancel()
            await asyncio.gather(command_observer, return_exceptions=True)
        manager._store_lock.release()
        import_result = await asyncio.wait_for(import_task, timeout=2)

    assert import_result is False
    await hass.async_block_till_done()

    robot = manager._robot(SERIAL)
    assert robot["rooms"].get(room.room_id, {}).get("last_opportunity") is None
    assert robot["rooms"].get(room.room_id, {}).get("completed_runs", 0) == 0
    assert robot["native_completion_dedup"] == []
    assert manager.cadence_progress(SERIAL, "home", room.room_id) == before_progress
    assert reconciled_events == []
    assert notifications == []
    assert len(persisted) == before_save_count
    assert persisted[-1] == before_durable
