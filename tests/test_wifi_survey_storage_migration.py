"""Exercise Wi-Fi survey storage versions with real HA Store files."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from homeassistant.exceptions import UnsupportedStorageVersionError
from homeassistant.helpers.storage import Store

from custom_components.matic_robot.wifi_survey import (
    CELL_SIZE_METERS,
    WifiSurveyStore,
    survey_frame,
)


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Use versioned files in the test configuration directory."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    return hass_tmp_config_dir


@pytest.mark.parametrize("old_version", [1, 2])
async def test_a_survey_from_a_development_build_starts_empty(
    hass, old_version: int
) -> None:
    entry_id = "survey-versions"
    key = f"matic_robot.wifi_survey.{entry_id}"
    frame = survey_frame(b"partition")
    writer = Store[dict[str, Any]](hass, old_version, key, private=True)
    await writer.async_save(
        {
            "enabled": True,
            "floors": {"7": [[-2, 3, -70, 4, 100], [-4, 6, -60, 2, 101, 0.5]]},
            "frames": {"7": frame},
        }
    )
    path = Path(hass.config.path(".storage", key))

    survey = WifiSurveyStore(hass, entry_id)
    await survey.async_load()
    assert (survey.enabled, survey.cells(7, frame)) == (False, [])
    assert survey.add_sample(7, frame, -1.4, 3.4, -55, 200)
    cells = survey.cells(7, frame)
    assert [cell["size"] for cell in cells] == [CELL_SIZE_METERS]
    await survey.async_shutdown()
    saved = await hass.async_add_executor_job(path.read_bytes)

    reloaded = WifiSurveyStore(hass, entry_id)
    await reloaded.async_load()
    assert reloaded.cells(7, frame) == cells

    old_reader = Store[dict[str, Any]](hass, old_version, key, private=True)
    with pytest.raises(UnsupportedStorageVersionError):
        await old_reader.async_load()
    assert await hass.async_add_executor_job(path.read_bytes) == saved
