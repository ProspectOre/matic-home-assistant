"""Base entity for Matic Hermes."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import slugify

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
        self._matic_device_name = info.name or "Matic"
        self._matic_serial = info.serial_number

    @property
    def suggested_object_id(self) -> str | None:
        """Anchor object ids to stable keys instead of translated names.

        The registry prefixes the device name itself for named entities, so
        the returned id must stay unprefixed; the vacuum returns None so it
        becomes the bare device name.
        """
        unique_id = self.unique_id
        if unique_id is None:
            return None
        key = unique_id.removeprefix(f"{self._matic_serial}_")
        if key == "vacuum":
            return None
        return slugify(key)
