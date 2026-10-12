"""Pre-1.0 migrations to the integration's canonical data model."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import slugify

from .const import CONF_SERIAL_NUMBER, DOMAIN

_LOGGER = logging.getLogger(__name__)

# Entities 0.5 removed as duplicates; the release notes name each replacement.
REMOVED_ENTITY_KEYS = (
    ("binary_sensor", "active_cleaning_session"),
    ("binary_sensor", "update_available"),
    ("sensor", "software_version"),
    ("sensor", "hardware_revision"),
)


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate one config entry to the current schema exactly once.

    Running under the entry's minor version means a user rename applied
    after this migration is never touched again on later restarts.
    """
    if entry.version > 1:
        return False
    if entry.minor_version < 2:
        _async_migrate_entity_ids(hass, entry)
        hass.config_entries.async_update_entry(entry, minor_version=2)
    if entry.minor_version < 3:
        _async_remove_retired_entities(hass, entry)
        hass.config_entries.async_update_entry(entry, minor_version=3)
    return True


def _async_remove_retired_entities(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete the registry entries of entities 0.5 no longer provides."""
    serial_number = entry.data.get(CONF_SERIAL_NUMBER)
    if serial_number is None:
        return
    registry = er.async_get(hass)
    for domain, key in REMOVED_ENTITY_KEYS:
        if entity_id := registry.async_get_entity_id(
            domain, DOMAIN, f"{serial_number}_{key}"
        ):
            _LOGGER.info("Removing retired entity %s", entity_id)
            registry.async_remove(entity_id)


def _async_migrate_entity_ids(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Move pre-0.2.0 registry entries to descriptive canonical entity IDs."""
    serial_number = entry.data.get(CONF_SERIAL_NUMBER)
    if serial_number is None:
        return
    registry_devices = dr.async_get(hass)
    if lookup := getattr(registry_devices, "async_get_device_by_identifier", None):
        device = lookup((DOMAIN, serial_number), entry.entry_id)
    else:
        device = registry_devices.async_get_device(
            identifiers={(DOMAIN, serial_number)}
        )
        if device is not None and entry.entry_id not in device.config_entries:
            device = None
    device_name = (device.name if device is not None else None) or "Matic"
    registry = er.async_get(hass)
    prefix = f"{serial_number}_"
    for registry_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
        if not registry_entry.unique_id.startswith(prefix):
            continue
        key = registry_entry.unique_id.removeprefix(prefix)
        object_id = slugify(device_name if key == "vacuum" else f"{device_name}_{key}")
        desired = f"{registry_entry.domain}.{object_id}"
        if desired == registry_entry.entity_id:
            continue
        if registry.async_get(desired) is not None:
            _LOGGER.info(
                "Keeping entity id %s: the canonical id %s is already in use",
                registry_entry.entity_id,
                desired,
            )
            continue
        _LOGGER.info("Migrating entity id %s to %s", registry_entry.entity_id, desired)
        registry.async_update_entity(registry_entry.entity_id, new_entity_id=desired)
