"""Verified completions project to the same values release/0.6 stored and read.

`verified_completion_da40c75a.json` holds what release/0.6 at da40c75a computed
and saved for the run below: each step's projections (daily limits, cadence
progress, the plan preview, rotation order and history) and the final store.
Running the same steps here must give the same projections and save the same
data, and the saved data must load here to the same projections.
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.plan_model import (
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
)
from custom_components.matic_robot.plans import CleaningPlanManager

GOLDEN = Path(__file__).parent / "fixtures" / "verified_completion_da40c75a.json"
SERIAL = "serial"
START = datetime(2026, 7, 1, 16, tzinfo=UTC)
GROUND = FloorPlan(
    7,
    "partition",
    b"partition",
    (
        Room("kitchen", "Kitchen", "p-kitchen", b"kitchen", ()),
        Room("hall", "Hall", "p-hall", b"hall", ()),
        Room("den", "Den", "p-den", b"den", ()),
    ),
)
UPPER = FloorPlan(8, "upper", b"upper", (Room("loft", "Loft", "p-loft", b"loft", ()),))
KITCHEN = CleaningRoom("kitchen", "Kitchen", "vacuum", "standard")
HALL = CleaningRoom("hall", "Hall", "vacuum", "standard")
DEN = CleaningRoom("den", "Den", "mop", "standard")
LOFT = CleaningRoom("loft", "Loft", "vacuum", "quick")
ROOMS = (KITCHEN, HALL, DEN)
STORED = (
    "rooms",
    "rotations",
    "rotation_resets",
    "daily_room_completions",
    "shared_room_cadence",
    "plan_room_cadence",
    "plans",
    "native_completion_dedup",
)


def _identity(room: CleaningRoom) -> str:
    return room_cadence_identity(UPPER if room is LOFT else GROUND, room.room_id)


def _json(value: object) -> object:
    return json.loads(json.dumps(value))


def _projections(manager: CleaningPlanManager) -> object:
    robot = manager.repository.robot(SERIAL)
    return _json(
        {
            "daily": {
                room.room_id: manager.cadence.daily_limit_state(
                    SERIAL, room.room_id, _identity(room)
                )
                for room in (*ROOMS, LOFT)
            },
            "progress": {
                room.room_id: manager.cadence.cadence_progress(
                    SERIAL, "home", room.room_id
                )
                for room in ROOMS
            },
            "preview": manager.planning.preview(
                SERIAL,
                {room.room_id: room.name for room in ROOMS},
                "home",
                floor_plan=GROUND,
                floor_token=plan_floor_token(GROUND),
                room_identities={room.room_id: _identity(room) for room in ROOMS},
            ),
            "rotation": manager.planning.rotation_details(SERIAL, "home", ROOMS),
            "history": manager.history.snapshot(SERIAL),
            "stored": {key: robot.get(key) for key in STORED},
        }
    )


async def _begin(manager, plan_id, run_id, rooms, floor) -> dict:
    """Start a run whose checkpoint holds each room's cadence snapshot."""
    identities = {room.room_id: _identity(room) for room in rooms}
    _, snapshots = manager.cadence.resolve_cadence(
        SERIAL, plan_id, list(rooms), room_identities=identities
    )
    cadence = {
        room_id: {**snapshot, "identity": identities[room_id]}
        for room_id, snapshot in snapshots.items()
    }
    await manager.ledger.async_begin_run(
        SERIAL, plan_id, run_id, len(rooms), trigger="user", service="test"
    )
    await manager.recovery.async_set_recovery_checkpoint(
        SERIAL,
        run_id,
        {
            "completed_room_ids": [],
            "cadence_by_room": cadence,
            "floor_token": plan_floor_token(floor),
        },
    )
    return cadence


def _marker(room: CleaningRoom, run_id: str, dispatched: datetime) -> dict:
    return {
        "plan_id": "home",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": dispatched.isoformat(),
        "cleaning_mode": room.cleaning_mode,
        "run_id": run_id,
    }


async def _setup(manager: CleaningPlanManager) -> None:
    for room, limit in ((KITCHEN, 1), (HALL, 2)):
        await manager.cadence.async_set_daily_limit(
            SERIAL,
            room.room_id,
            room_identity=_identity(room),
            limit=limit,
            require_current=lambda: True,
        )
    cadences = {
        "kitchen": {
            "scope": "shared",
            "mop_every_n": 2,
            "coverage_every_n": 3,
            "periodic_coverage_setting": "heavy_duty",
        },
        "hall": {"scope": "plan", "mop_every_n": 3},
    }
    await manager.catalog.async_save_plan(
        SERIAL,
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                    **(
                        {"cadence": cadences[room.room_id]}
                        if room.room_id in cadences
                        else {}
                    ),
                }
                for room in ROOMS
            ],
        },
        room_identities={room.room_id: _identity(room) for room in ROOMS},
        floor_token=plan_floor_token(GROUND),
    )
    await manager.catalog.async_save_plan(
        SERIAL,
        "upstairs",
        {
            "name": "Upstairs",
            "rooms": [
                {
                    "room_id": "loft",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )


async def _run(manager: CleaningPlanManager, freezer) -> list[object]:
    """Fresh install, a managed run, late native credit, a reset, a second floor."""
    steps = [_projections(manager)]
    # Day 1: every room verified during the run; the hall times itself.
    await _begin(manager, "home", "run-1", ROOMS, GROUND)
    for room in ROOMS:
        await manager.ledger.async_mark_started(SERIAL, "home", room, run_id="run-1")
        await manager.ledger.async_mark_resumed(SERIAL, "home", room)
        freezer.tick(timedelta(minutes=12))
        await manager.ledger.async_mark_completed(
            SERIAL,
            "home",
            room,
            run_id="run-1",
            duration_seconds=None if room is HALL else 600,
            completed_at=None if room is HALL else datetime.now(UTC).isoformat(),
            completion_session_hash="1" * 64,
        )
    await manager.ledger.async_finish_run(
        SERIAL, "run-1", "completed", "all_rooms_verified", 3
    )
    steps.append(_projections(manager))
    # Day 2: the kitchen's credit arrives after the run gave it up, and the
    # hall's comes from the next native history read.
    freezer.tick(timedelta(days=1))
    cadence = await _begin(manager, "home", "run-2", (KITCHEN, HALL), GROUND)
    due = CleaningRoom(
        "kitchen",
        "Kitchen",
        cadence["kitchen"]["effective_cleaning_mode"],
        cadence["kitchen"]["effective_coverage_setting"],
    )
    dispatched = datetime.now(UTC)
    await manager.ledger.async_mark_started(SERIAL, "home", due, run_id="run-2")
    await manager.ledger.async_mark_interrupted(
        SERIAL,
        "home",
        due,
        "delayed stop settlement",
        native_reconciliation=_marker(due, "run-2", dispatched),
    )
    freezer.tick(timedelta(minutes=9))
    assert await manager.ledger.async_mark_native_completed(
        SERIAL,
        "home",
        due,
        dispatched_at=dispatched,
        completed_at=datetime.now(UTC).isoformat(),
        duration_seconds=540,
        room_identity=_identity(KITCHEN),
    )
    dispatched = datetime.now(UTC)
    await manager.ledger.async_mark_started(SERIAL, "home", HALL, run_id="run-2")
    await manager.ledger.async_mark_failed(
        SERIAL,
        "home",
        HALL,
        "unverified",
        native_reconciliation=_marker(HALL, "run-2", dispatched),
    )
    freezer.tick(timedelta(minutes=8))
    now = datetime.now(UTC)
    record = CleaningSessionRecord(
        b"hall-session",
        CleaningSession(
            (now - timedelta(minutes=7)).isoformat(),
            (now - timedelta(seconds=30)).isoformat(),
            390,
            ("Hall",),
            (("Hall", 390),),
            True,
            ("Hall",),
        ),
    )
    await manager.ledger.async_import_native_history(SERIAL, GROUND, [record])
    await manager.ledger.async_finish_run(
        SERIAL, "run-2", "completed", "all_rooms_verified", 2
    )
    steps.append(_projections(manager))
    # Day 3: reset the kitchen's mop cadence and the plan's history, then clean
    # the kitchen and the loft on the second floor.
    freezer.tick(timedelta(days=1))
    await manager.cadence.async_reset_cadence(
        SERIAL, "home", ["kitchen"], modes=["mop"]
    )
    await manager.ledger.async_reset_history(SERIAL, "home")
    await _begin(manager, "home", "run-3", (KITCHEN,), GROUND)
    freezer.tick(timedelta(minutes=10))
    await manager.ledger.async_mark_completed(
        SERIAL, "home", KITCHEN, run_id="run-3", duration_seconds=480
    )
    await manager.ledger.async_finish_run(
        SERIAL, "run-3", "completed", "all_rooms_verified", 1
    )
    await _begin(manager, "upstairs", "run-4", (LOFT,), UPPER)
    freezer.tick(timedelta(minutes=10))
    await manager.ledger.async_mark_completed(
        SERIAL, "upstairs", LOFT, run_id="run-4", duration_seconds=300
    )
    await manager.ledger.async_finish_run(
        SERIAL, "run-4", "completed", "all_rooms_verified", 1
    )
    steps.append(_projections(manager))
    return steps


def _manager(hass, stored: object = None) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    return manager


async def test_verified_completions_project_and_save_as_release_0_6(hass, freezer):
    freezer.move_to(START)
    golden = json.loads(GOLDEN.read_text())
    manager = _manager(hass)
    await _setup(manager)
    assert await _run(manager, freezer) == golden["steps"]
    # The same store release/0.6 saved, so either version reads it alike.
    assert _json(manager.repository.data) == golden["saved"]


async def test_release_0_6_store_loads_to_the_same_projections(hass, freezer):
    golden = json.loads(GOLDEN.read_text())
    freezer.move_to(golden["saved_at"])
    manager = _manager(hass, deepcopy(golden["saved"]))
    await manager.async_load()
    assert _projections(manager) == golden["steps"][-1]
