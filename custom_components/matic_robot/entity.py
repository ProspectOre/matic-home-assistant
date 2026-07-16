"""Base entity for Matic Hermes."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import MaticConfigEntry
from .const import DOMAIN
from .coordinator import MaticCoordinator


class MaticEntity(CoordinatorEntity[MaticCoordinator]):
    """Base Matic Hermes entity."""

    _attr_has_entity_name = True

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry.runtime_data.coordinator)
        self._config_entry = entry
        state = self.coordinator.data
        info = state.info
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, info.serial_number)},
            manufacturer="Matic",
            model="Matic",
            name=info.name or "Matic",
            hw_version=str(info.hardware_revision),
            sw_version=(
                state.telemetry.software_version or state.operational.software_version
            ),
        )
