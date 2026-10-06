"""Deterministic persistence interleavings for verified room accounting."""

import asyncio
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
)


async def test_reconcile_finish_and_next_start_preserve_exactly_once_credit(
    hass,
) -> None:
    """A late room credit stays durable across terminalization and next start."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    floor_plan = FloorPlan(
        7,
        "partition-proto",
        b"partition-wire",
        (Room(room.room_id, room.name, "room-proto", b"room-wire", ()),),
    )
    identity = room_cadence_identity(floor_plan, room.room_id)
    await manager.async_save_plan(
        "synthetic-robot",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "name": room.name,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "plan",
                        "mop_every_n": 3,
                    },
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.room_id: identity},
    )
    _effective_rooms, cadence = manager.resolve_cadence(
        "synthetic-robot",
        "home",
        [CleaningRoom(room.room_id, room.name, "vacuum", "standard")],
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.room_id: identity},
    )
    cadence_state = {**cadence[room.room_id], "identity": identity}
    assert cadence_state["mop_due"] is False

    await manager.async_begin_run(
        "synthetic-robot", "home", "run-old", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "synthetic-robot",
        "run-old",
        {
            "cadence_by_room": {room.room_id: cadence_state},
            "completed_room_ids": [],
        },
    )
    dispatched_at = dt_util.utcnow() - timedelta(seconds=10)
    await manager.async_mark_failed(
        "synthetic-robot",
        "home",
        room,
        "synthetic stop",
        native_reconciliation={
            "plan_id": "home",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at.isoformat(),
            "run_id": "run-old",
        },
    )
    assert await manager.async_finish_run(
        "synthetic-robot", "run-old", "failed", "room_failed", 0
    )

    reconcile_save_entered = asyncio.Event()
    release_reconcile_save = asyncio.Event()
    finish_write_entered = asyncio.Event()
    next_start_write_entered = asyncio.Event()
    persisted: list[dict] = []
    save_count = 0

    async def save(data) -> None:
        nonlocal save_count
        save_count += 1
        persisted.append(deepcopy(data["robots"]["synthetic-robot"]))
        if save_count == 1:
            reconcile_save_entered.set()
            await release_reconcile_save.wait()

    async def observe_store_write(data) -> None:
        last_run = data["robots"]["synthetic-robot"]["last_run"]
        if (
            save_count > 0
            and last_run.get("run_id") == "run-old"
            and last_run.get("ended_at")
        ):
            finish_write_entered.set()
        if save_count > 0 and last_run.get("run_id") == "run-new":
            next_start_write_entered.set()
        await save(data)

    manager._store.async_save = observe_store_write

    async def reconcile() -> bool:
        return await manager.async_mark_native_completed(
            "synthetic-robot",
            "home",
            room,
            dispatched_at=dispatched_at,
            completed_at=dt_util.utcnow().isoformat(),
            duration_seconds=30,
            room_identity=identity,
        )

    first_reconciliation = asyncio.create_task(reconcile())
    await asyncio.wait_for(reconcile_save_entered.wait(), timeout=1)
    reconciled_last_run = deepcopy(manager._robot("synthetic-robot")["last_run"])

    duplicate_reconciliation = asyncio.create_task(reconcile())
    # The plan-write lock owns both reconciliation attempts. A duplicate must
    # wait for the first durable write before checking the consumed marker.
    assert manager.plan_write_lock("synthetic-robot").locked()

    finish = asyncio.create_task(
        manager.async_finish_run(
            "synthetic-robot", "run-old", "failed", "late_finish", 0
        )
    )

    # Starting the next run while the old reconciliation write is blocked
    # queues behind the same state/store admission fence. Neither finish nor
    # the next run may mutate the live root until reconciliation settles.
    next_start = asyncio.create_task(
        manager.async_begin_run(
            "synthetic-robot",
            "home",
            "run-new",
            1,
            trigger="user",
            service="test",
        )
    )
    try:
        await asyncio.sleep(0)
        assert not finish_write_entered.is_set()
        assert not next_start_write_entered.is_set()
        assert manager._robot("synthetic-robot")["last_run"] == reconciled_last_run
    finally:
        release_reconcile_save.set()
        await asyncio.wait_for(
            asyncio.gather(
                first_reconciliation,
                duplicate_reconciliation,
                finish,
                next_start,
                return_exceptions=True,
            ),
            timeout=1,
        )

    assert await asyncio.wait_for(first_reconciliation, timeout=1) is True
    assert await asyncio.wait_for(duplicate_reconciliation, timeout=1) is False
    assert await asyncio.wait_for(finish, timeout=1) is True
    assert await asyncio.wait_for(next_start, timeout=1) is None
    assert finish_write_entered.is_set()
    assert next_start_write_entered.is_set()

    robot = manager._robot("synthetic-robot")
    assert robot["rooms"][room.room_id]["completed_runs"] == 1
    assert robot["plan_room_cadence"]["home"][room.room_id]["progress"] == {
        "mop": 1,
        "coverage": 0,
    }
    assert len(robot["native_completion_dedup"]) == 1
    assert "pending_native_reconciliation" not in robot
    assert robot["last_run"]["run_id"] == "run-new"
    assert len(persisted) == 3
    assert persisted[0]["rooms"][room.room_id]["completed_runs"] == 1
    assert persisted[0]["last_run"]["outcome"] == "completed"
    assert persisted[0]["last_run"]["completed_room_count"] == 1
    for durable_state in persisted:
        assert durable_state["rooms"][room.room_id]["completed_runs"] == 1
        assert durable_state["plan_room_cadence"]["home"][room.room_id]["progress"] == {
            "mop": 1,
            "coverage": 0,
        }
    assert persisted[-1]["last_run"]["run_id"] == "run-new"
