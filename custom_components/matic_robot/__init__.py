"""Matic Robot integration for Home Assistant."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .client.api import MaticHermesClient
from .client.auth import HermesCredential
from .client.commands import CleaningMode, CoverageSetting
from .const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_CLEANING_MODE,
    CONF_COVERAGE_SETTING,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
    DATA_FIRMWARE_TRACKER,
    DATA_PLAN_MANAGER,
    DOMAIN,
    PLATFORMS,
)
from .coordinator import MaticCoordinator
from .firmware import FirmwareTracker
from .frontend import async_register_room_plan_editor
from .migrations import async_migrate_entry
from .plans import CleaningPlanManager
from .services import async_register_services

__all__ = ["async_migrate_entry"]


@dataclass(slots=True)
class MaticRuntimeData:
    """Runtime data held by the config entry."""

    client: MaticHermesClient
    coordinator: MaticCoordinator
    cleaning_plans: CleaningPlanManager
    firmware_tracker: FirmwareTracker


MaticConfigEntry = ConfigEntry[MaticRuntimeData]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register integration-wide services and the plan editor."""
    await async_register_room_plan_editor(hass)
    await async_register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> bool:
    """Set up an unofficial Matic robot integration from a config entry."""
    offset = dt_util.now().utcoffset()
    client = MaticHermesClient(
        entry.data[CONF_HOST],
        entry.data[CONF_PORT],
        hostname=entry.data[CONF_HOSTNAME],
        serial_number=entry.data[CONF_SERIAL_NUMBER],
        certificate_fingerprint=entry.data[CONF_CERTIFICATE_FINGERPRINT],
        credential=HermesCredential.from_storage(entry.data[CONF_HERMES_CREDENTIAL])
        if CONF_HERMES_CREDENTIAL in entry.data
        else None,
        timezone_identifier=hass.config.time_zone,
        seconds_from_gmt=int(offset.total_seconds()) if offset is not None else 0,
    )
    try:
        firmware_tracker = hass.data[DOMAIN][DATA_FIRMWARE_TRACKER]
        coordinator = MaticCoordinator(
            hass,
            client,
            entry,
            cleaning_mode=CleaningMode(
                entry.options.get(CONF_CLEANING_MODE, CleaningMode.BOTH)
            ),
            coverage_setting=CoverageSetting(
                entry.options.get(CONF_COVERAGE_SETTING, CoverageSetting.STANDARD)
            ),
            firmware_tracker=firmware_tracker,
        )
        await coordinator.async_config_entry_first_refresh()
        plans = hass.data[DOMAIN][DATA_PLAN_MANAGER]
        entry.runtime_data = MaticRuntimeData(
            client, coordinator, plans, firmware_tracker
        )
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except BaseException:
        client.close()
        raise
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> bool:
    """Unload the Matic robot integration."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        entry.runtime_data.client.close()
    return unload_ok


async def async_remove_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> None:
    """Erase the removed robot's persisted firmware history and repairs."""
    tracker: FirmwareTracker | None = hass.data.get(DOMAIN, {}).get(
        DATA_FIRMWARE_TRACKER
    )
    if tracker is not None:
        await tracker.async_remove_robot(entry.entry_id)
