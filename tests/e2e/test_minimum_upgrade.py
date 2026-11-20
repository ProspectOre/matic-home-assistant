"""0.6 starts on what 0.5.4 leaves and refuses older data without writing it.

Every 0.5 release saves the config entry at 1.3; 0.4 saved 1.2. The plan file
is 1.13 from 0.5.1 on, 1.12 in 0.5.0 and 1.5 in 0.4.8. The stores here are
real files, so a refused start can be compared byte for byte.
"""

from __future__ import annotations

import json
from pathlib import Path
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

ENTRY_ID = "matic-minimum-upgrade"


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Use store files in the per-test Home Assistant config."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    return hass_tmp_config_dir


def _plans(minor_version: int) -> dict[str, Any]:
    plan = {"name": "Evening", "rooms": [{"room_id": "room-1"}]}
    return {
        "version": 1,
        "minor_version": minor_version,
        "key": STORAGE_KEY,
        "data": {"robots": {"SIM0000001": {"plans": {"evening": plan}}}},
    }


def _write_stores(hass: HomeAssistant, plan_minor_version: int | None) -> None:
    """Write each store the 0.4 and 0.5 releases keep, as version 1 files."""
    stores: dict[str, Any] = {
        f"{DOMAIN}.firmware": {"robots": {}},
        f"{DOMAIN}.slam_map.{ENTRY_ID}": {"scene": None},
        f"{DOMAIN}.slam_history.{ENTRY_ID}": {"snapshots": []},
    }
    storage = Path(hass.config.path(".storage"))
    storage.mkdir(exist_ok=True)
    for key, data in stores.items():
        envelope = {"version": 1, "minor_version": 1, "key": key, "data": data}
        (storage / key).write_text(json.dumps(envelope))
    if plan_minor_version is not None:
        (storage / STORAGE_KEY).write_text(json.dumps(_plans(plan_minor_version)))


def _store_files(hass: HomeAssistant) -> dict[str, bytes]:
    storage = Path(hass.config.path(".storage"))
    return {path.name: path.read_bytes() for path in storage.glob(f"{DOMAIN}.*")}


@pytest.mark.parametrize(
    ("entry_minor_version", "plan_minor_version", "state"),
    [
        (2, 5, ConfigEntryState.NOT_LOADED),
        (2, None, ConfigEntryState.MIGRATION_ERROR),
        (3, 12, ConfigEntryState.NOT_LOADED),
    ],
    ids=["0.4.8", "0.4.8-without-plans", "0.5.0"],
)
async def test_older_install_is_refused_with_its_stores_unchanged(
    hass: HomeAssistant,
    simulator: RunningSimulator,
    credential: Any,
    entry_minor_version: int,
    plan_minor_version: int | None,
    state: ConfigEntryState,
) -> None:
    """Going back to the old release finds every store as it left it."""
    await hass.async_add_executor_job(_write_stores, hass, plan_minor_version)
    before = await hass.async_add_executor_job(_store_files, hass)
    entry = MockConfigEntry(
        domain=DOMAIN,
        entry_id=ENTRY_ID,
        unique_id=simulator.robot.serial_number,
        data=entry_data(simulator, credential),
        version=1,
        minor_version=entry_minor_version,
    )
    entry.add_to_hass(hass)

    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    await hass.async_stop()

    assert entry.state is state
    assert entry.minor_version == entry_minor_version
    assert ir.async_get(hass).async_get_issue(DOMAIN, UPGRADE_ISSUE_ID)
    assert await hass.async_add_executor_job(_store_files, hass) == before


async def test_0_5_4_entry_loads_with_its_plan_store(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The e2e entry is 1.3 and the plan file 1.13, as 0.5.4 leaves them."""
    await hass.async_add_executor_job(_write_stores, hass, 13)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    assert config_entry.minor_version == 5
    repository = config_entry.runtime_data.cleaning_plans.repository
    assert repository.robot("SIM0000001")["plans"]["evening"]["name"] == "Evening"
    assert not ir.async_get(hass).async_get_issue(DOMAIN, UPGRADE_ISSUE_ID)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
