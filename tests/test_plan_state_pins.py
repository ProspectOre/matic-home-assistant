"""Stored plan files of every released version read and credit as before.

`plan_state_pins_2c7aa210.json` holds what release/0.6 at 2c7aa210 read from
the synthetic store below saved at minor version 5 (0.4.8) and, alike, at 11,
12 (0.5.0) and 13 (0.5.1 to 0.5.4): the robot state, cadence progress, the
plan preview that decides what the robot is sent, rotation order and history,
then the same after one verified room, the saved file and a cold reload. The
store carries every legacy field the plan store has had to repair: duration
scalars, a pre-0.5 room run under `quick_clean`, the old one-time run name,
`trigger` without `provenance`, old run outcomes and malformed containers.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from homeassistant.helpers.storage import Store

from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.plan_model import (
    MANUAL_ROOM_SEQUENCE_PLAN_ID,
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
)
from custom_components.matic_robot.plan_storage import STORAGE_KEY, STORAGE_VERSION
from custom_components.matic_robot.plans import CleaningPlanManager

GOLDEN = Path(__file__).parent / "fixtures" / "plan_state_pins_2c7aa210.json"
SERIAL = "pin-robot"
NOW = datetime(2026, 10, 20, 12, tzinfo=UTC)
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
KITCHEN = CleaningRoom("kitchen", "Kitchen", "vacuum", "standard")
HALL = CleaningRoom("hall", "Hall", "vacuum", "standard")
DEN = CleaningRoom("den", "Den", "mop", "standard")
ROOMS = (KITCHEN, HALL, DEN)
IDENTITIES = {
    room.room_id: room_cadence_identity(GROUND, room.room_id) for room in ROOMS
}
MANUAL = f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_1"


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Use versioned JSON files in the per-test Home Assistant config."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    return hass_tmp_config_dir


def _room(room: CleaningRoom, cadence: dict[str, Any] | None = None) -> dict:
    return {
        "room_id": room.room_id,
        "cleaning_mode": room.cleaning_mode,
        "coverage_setting": room.coverage_setting,
        "cadence_identity": IDENTITIES[room.room_id],
        **({"cadence": cadence} if cadence else {}),
    }


def _stored() -> dict[str, Any]:
    """One robot carrying every legacy field and malformed container."""
    return {
        "robots": {
            SERIAL: {
                "plans": {
                    "home": {
                        "name": "Home",
                        "run_behavior": "intelligent",
                        "rooms": [
                            _room(
                                KITCHEN,
                                {
                                    "scope": "shared",
                                    "mop_every_n": 2,
                                    "coverage_every_n": 3,
                                    "periodic_coverage_setting": "heavy_duty",
                                },
                            ),
                            _room(HALL, {"scope": "plan", "mop_every_n": 3}),
                            _room(DEN),
                        ],
                    },
                    "quick_clean": {
                        "name": "Quick",
                        "run_behavior": "ordered",
                        "rooms": [_room(HALL, {"scope": "plan", "mop_every_n": 2})],
                    },
                    "broken": "not a plan",
                },
                "selected_plan": "gone",
                "selected_area": None,
                "areas": {"nook": {"schema_version": 1, "name": "Nook"}, "bad": 3},
                "rooms": {
                    "kitchen": {
                        "name": "Kitchen",
                        "last_completed": "2026-10-01T08:00:00+00:00",
                        "last_duration_seconds": 400,
                        "completed_runs": 4,
                    },
                    "den": {"name": "Den", "last_started": "2026-10-02T08:00:00+00:00"},
                },
                "rotations": {
                    "home": {
                        "rooms": {
                            # Duration scalars from before duration_profiles.
                            "kitchen": {
                                "room_id": "kitchen",
                                "name": "Kitchen",
                                "cleaning_mode": "vacuum",
                                "coverage_setting": "standard",
                                "duration_history_seconds": [500, 520, 480],
                                "duration_samples": 6,
                                "average_duration_seconds": 500,
                                "last_duration_seconds": 480,
                                "last_completed": "2026-10-10T08:00:00+00:00",
                                "last_result": "completed",
                                "completed_runs": 6,
                            },
                            "hall": {
                                "room_id": "hall",
                                "name": "Hall",
                                "cleaning_mode": "vacuum",
                                "coverage_setting": "standard",
                                "average_duration_seconds": 300,
                                "duration_samples": 3,
                                "last_started": "2026-10-11T08:00:00+00:00",
                                "last_result": "interrupted",
                            },
                            "den": "not a record",
                        }
                    },
                    "quick_clean": {
                        "rooms": {
                            "hall": {
                                "room_id": "hall",
                                "name": "Hall",
                                "run_id": "legacy-run",
                                "last_opportunity": "2026-10-12T08:00:00+00:00",
                                "last_completed": "2026-10-12T08:20:00+00:00",
                                "last_duration_seconds": 1200,
                                "last_result": "completed",
                            }
                        }
                    },
                    "broken": [],
                },
                "rotation_resets": {"home": "2026-09-01T00:00:00+00:00", "x": 1},
                "shared_room_cadence": {
                    "kitchen": {
                        "policy": {
                            "mop_every_n": 2,
                            "coverage_every_n": 3,
                            "periodic_coverage_setting": "heavy_duty",
                        },
                        "progress": {"mop": 1, "coverage": True},
                        "identity": IDENTITIES["kitchen"],
                    },
                    "den": {"progress": {"mop": 1}},
                },
                "plan_room_cadence": {
                    "home": {
                        "hall": {
                            "progress": {"mop": 2, "coverage": -1},
                            "unverified_modes": ["coverage", "bogus"],
                            "identity": "short",
                        }
                    },
                    "quick_clean": {"hall": {"progress": {"mop": 1}}},
                    "broken": 7,
                },
                "native_completion_dedup": ["a" * 64, "not-a-key", "B" * 64],
                "managed_native_sessions": {
                    "b" * 64: {"run_id": "legacy-run"},
                    "short": {"run_id": "x"},
                },
                "active_plan": None,
                # A pre-0.5 one-time room run saved under the Quick Clean ID.
                "last_run": {
                    "run_id": "legacy-run",
                    "plan_id": "quick_clean",
                    "plan_name": "Quick",
                    "service": "clean_room_sequence",
                    "outcome": "stopped",
                    "trigger": "automation",
                    "started_at": "2026-10-12T08:00:00+00:00",
                    "ended_at": "2026-10-12T08:30:00+00:00",
                    "room_count": 1,
                    "completed_room_count": 1,
                },
                "last_interrupted_plan": {
                    "run_id": "older-run",
                    "plan_id": MANUAL,
                    "plan_name": "Map Studio room clean",
                    "room_id": "den",
                },
                "pending_native_reconciliation": {"run_id": "legacy-run"},
            },
            "dropped-robot": "not a robot",
            "second-robot": {
                "plans": {"p": {"name": "P", "rooms": [_room(DEN)]}},
                "last_run": {
                    "run_id": "r2",
                    "plan_id": MANUAL,
                    "plan_name": "Map Studio room clean",
                    "outcome": "partial",
                    "provenance": "account:someone",
                    "trigger": "user",
                },
            },
        }
    }


def _json(value: object) -> object:
    return json.loads(json.dumps(value))


def _projections(manager: CleaningPlanManager) -> object:
    return _json(
        {
            "robots": {
                serial: manager.repository.robot(serial)
                for serial in (SERIAL, "second-robot")
            },
            "progress": {
                plan_id: {
                    room.room_id: manager.cadence.cadence_progress(
                        SERIAL, plan_id, room.room_id
                    )
                    for room in ROOMS
                }
                for plan_id in ("home", "quick_clean")
            },
            "preview": manager.planning.preview(
                SERIAL,
                {room.room_id: room.name for room in ROOMS},
                "home",
                floor_plan=GROUND,
                floor_token=plan_floor_token(GROUND),
                room_identities=IDENTITIES,
            ),
            "rotation": manager.planning.rotation_details(SERIAL, "home", ROOMS),
            "history": manager.history.snapshot(SERIAL),
        }
    )


async def _verified_room(manager: CleaningPlanManager, freezer) -> None:
    """Credit one room the robot's history confirmed during a managed run."""
    _, snapshots = manager.cadence.resolve_cadence(
        SERIAL, "home", [HALL], room_identities=IDENTITIES
    )
    await manager.ledger.async_begin_run(
        SERIAL, "home", "pin-run", 1, trigger="user", service="test"
    )
    await manager.recovery.async_set_recovery_checkpoint(
        SERIAL,
        "pin-run",
        {
            "completed_room_ids": [],
            "cadence_by_room": {
                room_id: {**snapshot, "identity": IDENTITIES[room_id]}
                for room_id, snapshot in snapshots.items()
            },
            "floor_token": plan_floor_token(GROUND),
        },
    )
    hall = CleaningRoom(
        "hall",
        "Hall",
        snapshots["hall"]["effective_cleaning_mode"],
        snapshots["hall"]["effective_coverage_setting"],
    )
    await manager.ledger.async_mark_started(SERIAL, "home", hall, run_id="pin-run")
    freezer.tick(timedelta(minutes=10))
    await manager.ledger.async_mark_completed(
        SERIAL, "home", hall, run_id="pin-run", duration_seconds=600
    )
    await manager.ledger.async_finish_run(
        SERIAL, "pin-run", "completed", "all_rooms_verified", 1
    )


async def _pins(hass, freezer, minor_version: int) -> dict[str, object]:
    freezer.move_to(NOW)
    await Store(
        hass, STORAGE_VERSION, STORAGE_KEY, private=True, minor_version=minor_version
    ).async_save(_stored())
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    loaded = _projections(manager)
    await _verified_room(manager, freezer)
    credited = _projections(manager)
    path = Path(hass.config.path(".storage", STORAGE_KEY))
    saved = json.loads(await hass.async_add_executor_job(path.read_text))["data"]
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    return {
        "loaded": loaded,
        "credited": credited,
        "saved": saved,
        "reloaded": _projections(reloaded),
    }


@pytest.mark.parametrize("minor_version", [5, 11, 12, 13])
async def test_released_store_reads_and_credits_as_before(
    hass, freezer, minor_version: int
) -> None:
    golden = json.loads(GOLDEN.read_text())["0.4.8" if minor_version == 5 else "0.5"]
    assert await _pins(hass, freezer, minor_version) == golden
