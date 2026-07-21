"""Read-only firmware update surface for Matic Hermes."""

from __future__ import annotations

from homeassistant.components.update import (
    UpdateDeviceClass,
    UpdateEntity,
    UpdateEntityDescription,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .entity import MaticEntity

PARALLEL_UPDATES = 0

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
    OTA shows as an unknown latest version; installs stay robot-managed.
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
        """Return the installed version unless the robot reports a pending OTA."""
        if self.coordinator.data.telemetry.update_state == "available":
            return None
        return self.installed_version

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
