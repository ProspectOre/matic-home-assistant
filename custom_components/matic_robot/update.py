"""Read-only firmware update surface for Matic Hermes."""

from __future__ import annotations

from typing import Final

from homeassistant.components.update import (
    UpdateDeviceClass,
    UpdateEntity,
    UpdateEntityDescription,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import translation
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .const import DOMAIN
from .entity import MaticEntity

PARALLEL_UPDATES = 0

# Home Assistant core loads the ``common`` translations before entry setup and
# again on a language change, so the entity reads them from its cache. The
# English values below are the fallback while the cache lacks a key.
PENDING_FIRMWARE_VERSION_KEY: Final = (
    f"component.{DOMAIN}.common.pending_firmware_version"
)
PENDING_FIRMWARE_VERSION_UNKNOWN_KEY: Final = (
    f"component.{DOMAIN}.common.pending_firmware_version_unknown"
)
PENDING_FIRMWARE_VERSION: Final = "Newer than {installed}"
PENDING_FIRMWARE_VERSION_UNKNOWN: Final = "Newer firmware"

UPDATE_DESCRIPTION = UpdateEntityDescription(
    key="firmware",
    translation_key="firmware",
    device_class=UpdateDeviceClass.FIRMWARE,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the read-only Matic firmware update entity."""
    async_add_entities([MaticFirmwareUpdate(entry)])


class MaticFirmwareUpdate(MaticEntity, UpdateEntity):
    """Surface robot-managed OTA state in Home Assistant's update UI.

    The robot never reports the target version over Hermes, so a pending
    OTA reads as "Newer than {installed}" in the user's language. The marker
    changes when the installed version or the language changes, so a Skip
    lasts until the robot installs firmware; with no installed version it
    stays "Newer firmware" and Home Assistant reports no state. Installs stay
    robot-managed.
    """

    entity_description = UPDATE_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_firmware"

    @property
    def installed_version(self) -> str | None:
        """Return the robot's current firmware version."""
        state = self.coordinator.data
        return state.telemetry.software_version or state.operational.software_version

    @property
    def latest_version(self) -> str | None:
        """Return a translated pending marker while the robot reports an OTA."""
        installed = self.installed_version
        if self.coordinator.data.telemetry.update_state != "available":
            return installed
        cached = translation.async_get_cached_translations(
            self.hass, self.hass.config.language, "common", DOMAIN
        )
        if installed is None:
            return cached.get(
                PENDING_FIRMWARE_VERSION_UNKNOWN_KEY, PENDING_FIRMWARE_VERSION_UNKNOWN
            )
        marker = cached.get(PENDING_FIRMWARE_VERSION_KEY, PENDING_FIRMWARE_VERSION)
        return marker.replace("{installed}", installed)

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose the robot's own updater state for automations."""
        telemetry = self.coordinator.data.telemetry
        return {
            "update_state": telemetry.update_state,
            "update_channel": (
                telemetry.update_channel
                or self.coordinator.data.operational.release_channel
            ),
        }
