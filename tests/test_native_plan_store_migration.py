"""Load stored plan files through Home Assistant's real Store."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.storage import Store

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.migrations import UPGRADE_ISSUE_ID
from custom_components.matic_robot.plan_storage import (
    STORAGE_KEY,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
)
from custom_components.matic_robot.plans import CleaningPlanManager

SERIAL = "migration-test-robot"
PLAN = "legacy-evening"
ROOM = "room-dining"
TIER = {
    "duration_history_seconds": [100, 120, 140],
    "duration_samples": 5,
    "last_completed": "2026-10-01T08:00:00+00:00",
}


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

    migrated = manager.repository.robot(SERIAL)
    assert manager.repository.store.minor_version == STORAGE_MINOR_VERSION == 13
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
    persisted = reloaded.repository.robot(SERIAL)
    assert persisted["plans"] == migrated["plans"]
    assert persisted["areas"] == migrated["areas"]
    assert persisted["rooms"] == migrated["rooms"]
    assert persisted["shared_room_cadence"] == migrated["shared_room_cadence"]
    assert persisted["plan_room_cadence"] == migrated["plan_room_cadence"]
    assert persisted["rotations"] == migrated["rotations"]
    assert persisted["last_run"] == migrated["last_run"]


def _v0_5_4_data() -> dict[str, Any]:
    """The same store as 0.5.0 to 0.5.4 save it."""
    data = _minor_11_data()
    robot = data["robots"][SERIAL]
    robot["plans"][PLAN]["entries"] = [{"kind": "room", "room_id": ROOM}]
    robot["rotations"][PLAN]["rooms"][ROOM]["duration_profiles"] = {
        "vacuum:quick": deepcopy(TIER)
    }
    for key in ("rotation_resets", "area_history", "managed_native_sessions"):
        robot[key] = {}
    robot["native_completion_dedup"] = []
    robot["active_plan"] = None
    return data


async def _write(hass, minor_version: int, data: dict[str, Any]) -> Path:
    store = Store(
        hass, STORAGE_VERSION, STORAGE_KEY, private=True, minor_version=minor_version
    )
    await store.async_save(data)
    return Path(hass.config.path(".storage", STORAGE_KEY))


@pytest.mark.parametrize("minor_version", [12, 13])
async def test_0_5_store_loads_and_survives_cold_manager_reload(
    hass, minor_version: int
) -> None:
    """0.5.0 saved 1.12 and 0.5.1 to 0.5.4 save 1.13; both load unchanged."""
    path = await _write(hass, minor_version, _v0_5_4_data())

    manager = CleaningPlanManager(hass)
    await manager.async_load()

    loaded = manager.repository.robot(SERIAL)
    stored = _v0_5_4_data()["robots"][SERIAL]
    for key in (
        "plans",
        "areas",
        "rooms",
        "shared_room_cadence",
        "plan_room_cadence",
        "selected_plan",
        "selected_area",
    ):
        assert loaded[key] == stored[key]
    assert loaded["rotations"][PLAN]["rooms"][ROOM]["duration_profiles"] == {
        "vacuum:quick": TIER
    }
    assert loaded["last_run"]["run_id"] == "completed-run-7"

    await manager.repository.async_save_and_notify(SERIAL)
    disk = json.loads(await hass.async_add_executor_job(path.read_text))
    assert (disk["version"], disk["minor_version"]) == (1, STORAGE_MINOR_VERSION)
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.repository.robot(SERIAL) == loaded
    assert not ir.async_get(hass).async_get_issue(DOMAIN, UPGRADE_ISSUE_ID)


async def test_newer_store_is_refused_untouched(hass) -> None:
    """A file from a newer release fails the load and keeps its bytes."""
    path = await _write(hass, STORAGE_MINOR_VERSION + 1, _v0_5_4_data())
    before = await hass.async_add_executor_job(path.read_bytes)

    with pytest.raises(ValueError, match="unsupported plan storage minor version"):
        await CleaningPlanManager(hass).async_load()

    assert await hass.async_add_executor_job(path.read_bytes) == before
