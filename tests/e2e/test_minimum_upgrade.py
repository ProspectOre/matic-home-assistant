"""0.6 starts on what 0.5.4 leaves and refuses an older config entry."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.migrations import UPGRADE_ISSUE_ID
from custom_components.matic_robot.plan_storage import STORAGE_KEY

from .conftest import entry_data
from .hermes_sim import RunningSimulator


def _plans(minor_version: int) -> dict[str, Any]:
    plan = {"name": "Evening", "rooms": [{"room_id": "room-1"}]}
    return {
        "version": 1,
        "minor_version": minor_version,
        "key": STORAGE_KEY,
        "data": {"robots": {"SIM0000001": {"plans": {"evening": plan}}}},
    }


async def test_pre_0_5_entry_stops_setup_untouched(
    hass: HomeAssistant, simulator: RunningSimulator, credential: Any
) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=simulator.robot.serial_number,
        data=entry_data(simulator, credential),
        version=1,
        minor_version=2,
    )
    entry.add_to_hass(hass)

    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.MIGRATION_ERROR
    assert entry.minor_version == 2
    assert ir.async_get(hass).async_get_issue(DOMAIN, UPGRADE_ISSUE_ID)


@pytest.mark.parametrize("minor_version", [5, 13])
async def test_0_5_4_entry_loads_with_its_plan_store(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    config_entry: MockConfigEntry,
    minor_version: int,
) -> None:
    """The e2e entry is 1.3, as 0.5.4 leaves it. 0.5.4 rewrites its plan file
    only on a save, so a 0.4 plan file (1.5) can sit beside it."""
    hass_storage[STORAGE_KEY] = _plans(minor_version)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    assert config_entry.minor_version == 5
    repository = config_entry.runtime_data.cleaning_plans.repository
    assert repository.robot("SIM0000001")["plans"]["evening"]["name"] == "Evening"
    assert not ir.async_get(hass).async_get_issue(DOMAIN, UPGRADE_ISSUE_ID)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
