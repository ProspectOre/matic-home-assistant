"""Pre-1.0 migrations to the integration's canonical data model.

0.6 updates from 0.5.4. Older data steps through 0.5.4 first, which migrates
it on load; 0.6 refuses it with a Repair and writes none of it.

Two saved versions tell 0.6 what ran last. The config entry is 1.3 in every
0.5 release and 1.2 in 0.4. The plan file is 1.13 from 0.5.1 on, 1.12 in 0.5.0
and 1.5 in 0.4. So 0.6 refuses an entry below 1.3 here and a plan file below
1.13 in `async_setup`, before anything else loads. It cannot tell 0.5.1 to
0.5.3 from 0.5.4, nor 0.5.0 from 0.5.4 when no plan file was ever saved; it
reads those like 0.5.4's, since no other store changed version within 0.5.
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
# The config entry minor version every 0.5 release writes.
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
    # 0.5 saves minor version 3. No release saved 4.
    if entry.minor_version < 5:
        _async_remove_retired_entities(hass, entry, REMOVED_IN_0_6)
        hass.config_entries.async_update_entry(entry, minor_version=5)
    return True


def async_create_upgrade_issue(hass: HomeAssistant) -> None:
    """Ask the user to install 0.5.4 first; no store has been written."""
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
