"""Exercise Wi-Fi survey migration and rollback with real HA Store files."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from homeassistant.exceptions import UnsupportedStorageVersionError
from homeassistant.helpers.storage import Store

from custom_components.matic_robot.wifi_survey import (
    STORAGE_VERSION,
    WifiSurveyStore,
    _WifiSurveyStorage,
    survey_frame,
)


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Use versioned files in the test configuration directory."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    return hass_tmp_config_dir


async def test_coarse_survey_migrates_and_requires_matching_rollback(hass) -> None:
    entry_id = "survey-migration"
    key = f"matic_robot.wifi_survey.{entry_id}"
    frame = survey_frame(b"partition")
    legacy = {
        "enabled": True,
        "floors": {"7": [[-2, 3, -70, 4, 100]]},
        "frames": {"7": frame},
    }
    writer = Store[dict[str, Any]](hass, 1, key, private=True)
    await writer.async_save(legacy)
    path = Path(hass.config.path(".storage", key))
    backup = await hass.async_add_executor_job(path.read_bytes)

    survey = WifiSurveyStore(hass, entry_id)
    await survey.async_load()
    assert survey.cells(7, frame)[0]["size"] == 1.0
    assert survey.add_sample(7, frame, -1.4, 3.4, -55, 200)
    await survey.async_shutdown()
    upgraded = await hass.async_add_executor_job(path.read_bytes)

    old_reader = Store[dict[str, Any]](hass, 1, key, private=True)
    with pytest.raises(UnsupportedStorageVersionError):
        await old_reader.async_load()
    assert await hass.async_add_executor_job(path.read_bytes) == upgraded

    await hass.async_add_executor_job(path.write_bytes, backup)
    restored = Store[dict[str, Any]](hass, 1, key, private=True)
    assert await restored.async_load() == legacy


@pytest.mark.parametrize("major,minor", [(0, 1), (1, 0), (1, 2)])
async def test_migration_rejects_unknown_versions(hass, major: int, minor: int) -> None:
    store = _WifiSurveyStorage(hass, STORAGE_VERSION, "survey-unsupported")
    with pytest.raises(ValueError, match="unsupported Wi-Fi survey storage version"):
        await store._async_migrate_func(major, minor, {})
