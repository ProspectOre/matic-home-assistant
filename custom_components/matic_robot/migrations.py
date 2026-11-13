"""Pre-1.0 migrations to the integration's canonical data model.

0.6 migrates config entries from what 0.5.4 stores. An older entry steps
through 0.5.4 first, which migrates it on load; 0.6 refuses it with a Repair
instead of guessing at it.
"""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir

from .const import CONF_SERIAL_NUMBER, DOMAIN

_LOGGER = logging.getLogger(__name__)

MINIMUM_UPGRADE_VERSION = "0.5.4"
# The config entry minor version 0.5.4 writes.
MINIMUM_ENTRY_MINOR_VERSION = 3
UPGRADE_ISSUE_ID = "upgrade_through_0_5_4"

# Entities removed as duplicates; each release's notes name the replacements.
REMOVED_IN_0_6 = (
    ("binary_sensor", "paused"),
    ("binary_sensor", "returning"),
    ("binary_sensor", "fully_charged"),
    ("sensor", "activity"),
    ("sensor", "rooms"),
    ("sensor", "update_state"),
    ("sensor", "update_channel"),
    ("sensor", "scheduled_cleanings"),
    ("sensor", "protocol_version"),
    ("sensor", "dock_detections"),
    ("sensor", "sink_summon_locations"),
    ("button", "intelligent_clean"),
    ("button", "clean_entire_plan"),
    ("button", "stop_intelligent_cleaning"),
)


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate one config entry from what 0.5.4 stored, exactly once."""
    if entry.version > 1:
        return False
    if entry.minor_version < MINIMUM_ENTRY_MINOR_VERSION:
        async_create_upgrade_issue(hass)
        return False
    if entry.minor_version < 4:
        _async_delete_maintenance_repairs(hass, entry)
        hass.config_entries.async_update_entry(entry, minor_version=4)
    if entry.minor_version < 5:
        _async_remove_retired_entities(hass, entry, REMOVED_IN_0_6)
        hass.config_entries.async_update_entry(entry, minor_version=5)
    return True


def async_create_upgrade_issue(hass: HomeAssistant) -> None:
    """Ask the user to install 0.5.4 first; their data stays as it was."""
    ir.async_create_issue(
        hass,
        DOMAIN,
        UPGRADE_ISSUE_ID,
        is_fixable=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key=UPGRADE_ISSUE_ID,
        translation_placeholders={"version": MINIMUM_UPGRADE_VERSION},
    )


def _async_remove_retired_entities(
    hass: HomeAssistant, entry: ConfigEntry, keys: tuple[tuple[str, str], ...]
) -> None:
    """Delete the registry entries of entities a release no longer provides."""
    serial_number = entry.data.get(CONF_SERIAL_NUMBER)
    if serial_number is None:
        return
    registry = er.async_get(hass)
    for domain, key in keys:
        if entity_id := registry.async_get_entity_id(
            domain, DOMAIN, f"{serial_number}_{key}"
        ):
            _LOGGER.info("Removing retired entity %s", entity_id)
            registry.async_remove(entity_id)


def _async_delete_maintenance_repairs(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete the maintenance Repair that 0.6 development builds stored."""
    prefix = f"maintenance_{entry.entry_id}_"
    for domain, issue_id in list(ir.async_get(hass).issues):
        if domain == DOMAIN and issue_id.startswith(prefix):
            ir.async_delete_issue(hass, domain, issue_id)
