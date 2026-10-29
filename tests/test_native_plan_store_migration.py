"""Load the shipped plan-store migration through Home Assistant's real Store."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from homeassistant.helpers.storage import Store

from custom_components.matic_robot.plans import (
    STORAGE_KEY,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
    CleaningPlanManager,
)

SERIAL = "migration-test-robot"
PLAN = "legacy-evening"
ROOM = "room-dining"


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Use versioned JSON files in the per-test Home Assistant config."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep migration input and output isolated from other tests."""
    return hass_tmp_config_dir


def _minor_11_data() -> dict[str, Any]:
    return {
        "robots": {
            SERIAL: {
                "plans": {
                    PLAN: {
                        "name": "Evening",
                        "enabled": True,
                        "run_behavior": "ordered",
                        "rooms": [
                            {
                                "room_id": ROOM,
                                "name": "Dining room",
                                "cleaning_mode": "vacuum",
                                "coverage_setting": "quick",
                                "cadence": {
                                    "scope": "plan",
                                    "mop_every_n": 3,
                                    "coverage_every_n": 4,
                                },
                            }
                        ],
                        "room_order": [ROOM],
                        "return_to_base": True,
                        "finish_current_room": False,
                    }
                },
                "selected_plan": PLAN,
                "selected_area": "reading-nook",
                "areas": {
                    "reading-nook": {
                        "schema_version": 1,
                        "name": "Reading nook",
                        "circles": [{"x": 0.2, "y": 0.3, "radius": 0.1}],
                    }
                },
                "rooms": {
                    ROOM: {
                        "name": "Dining room",
                        "last_completed": "2026-10-01T08:00:00+00:00",
                        "completed_runs": 7,
                        "last_duration_seconds": 120,
                    }
                },
                "shared_room_cadence": {
                    ROOM: {
                        "policy": {
                            "mop_every_n": 3,
                            "coverage_every_n": 4,
                            "periodic_coverage_setting": "heavy_duty",
                        },
                        "progress": {"mop": 2, "coverage": 3},
                    }
                },
                "plan_room_cadence": {
                    PLAN: {
                        ROOM: {
                            "progress": {"mop": 1, "coverage": 2},
                            "identity": "a" * 64,
                        }
                    }
                },
                "rotations": {
                    PLAN: {
                        "rooms": {
                            ROOM: {
                                "name": "Dining room",
                                "cleaning_mode": "vacuum",
                                "coverage_setting": "quick",
                                "duration_history_seconds": [100, 120, 140],
                                "duration_samples": 5,
                                "last_completed": "2026-10-01T08:00:00+00:00",
                            }
                        }
                    }
                },
                "last_run": {
                    "run_id": "completed-run-7",
                    "plan_id": PLAN,
                    "outcome": "completed",
                    "completed_room_count": 1,
                    "room_count": 1,
                },
            }
        }
    }


async def test_minor_11_file_migrates_and_survives_cold_manager_reload(
    hass,
) -> None:
    """A real minor-11 file is migrated, saved as 12, and reloaded intact."""
    legacy = Store(
        hass,
        STORAGE_VERSION,
        STORAGE_KEY,
        private=True,
        minor_version=11,
    )
    await legacy.async_save(_minor_11_data())

    storage_path = Path(hass.config.path(".storage", STORAGE_KEY))
    disk_before = json.loads(await hass.async_add_executor_job(storage_path.read_text))
    assert disk_before["minor_version"] == 11
    assert disk_before["data"] == _minor_11_data()

    manager = CleaningPlanManager(hass)
    await manager.async_load()

    migrated = manager._robot(SERIAL)
    assert manager._store.minor_version == STORAGE_MINOR_VERSION == 12
    assert migrated["selected_plan"] == PLAN
    assert migrated["selected_area"] == "reading-nook"
    assert migrated["plans"][PLAN]["rooms"][0]["room_id"] == ROOM
    assert (
        migrated["areas"]["reading-nook"]
        == _minor_11_data()["robots"][SERIAL]["areas"]["reading-nook"]
    )
    assert migrated["rooms"][ROOM]["completed_runs"] == 7
    assert migrated["rooms"][ROOM]["last_completed"] == ("2026-10-01T08:00:00+00:00")
    assert migrated["shared_room_cadence"][ROOM]["progress"] == {
        "mop": 2,
        "coverage": 3,
    }
    assert migrated["plan_room_cadence"][PLAN][ROOM]["progress"] == {
        "mop": 1,
        "coverage": 2,
    }
    assert migrated["last_run"]["run_id"] == "completed-run-7"

    expected_tier = {
        "duration_history_seconds": [100, 120, 140],
        "duration_samples": 5,
        "last_completed": "2026-10-01T08:00:00+00:00",
    }
    assert migrated["rotations"][PLAN]["rooms"][ROOM]["duration_profiles"] == {
        "vacuum:quick": expected_tier
    }

    disk_after = json.loads(await hass.async_add_executor_job(storage_path.read_text))
    assert disk_after["version"] == STORAGE_VERSION
    assert disk_after["minor_version"] == STORAGE_MINOR_VERSION
    assert disk_after["data"]["robots"][SERIAL]["rooms"][ROOM]["completed_runs"] == 7
    assert disk_after["data"]["robots"][SERIAL]["rotations"][PLAN]["rooms"][ROOM][
        "duration_profiles"
    ] == {"vacuum:quick": expected_tier}

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    persisted = reloaded._robot(SERIAL)
    assert persisted["plans"] == migrated["plans"]
    assert persisted["areas"] == migrated["areas"]
    assert persisted["rooms"] == migrated["rooms"]
    assert persisted["shared_room_cadence"] == migrated["shared_room_cadence"]
    assert persisted["plan_room_cadence"] == migrated["plan_room_cadence"]
    assert persisted["rotations"] == migrated["rotations"]
    assert persisted["last_run"] == migrated["last_run"]
