"""Verified numeric settings for Matic robots."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberEntityDescription
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.exceptions import MaticError
from .const import DOMAIN
from .entity import MaticEntity

PARALLEL_UPDATES = 0

WATER_FLOW_DESCRIPTION = NumberEntityDescription(
    key="water_flow",
    translation_key="water_flow",
    entity_category=EntityCategory.CONFIG,
    native_min_value=0.5,
    native_max_value=2.0,
    native_step=0.1,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up verified Matic numeric settings."""
    async_add_entities([MaticWaterFlowNumber(entry)])


class MaticWaterFlowNumber(MaticEntity, NumberEntity):
    """Mopping water-flow multiplier."""

    entity_description = WATER_FLOW_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_water_flow"

    @property
    def native_value(self) -> float | None:
        """Return the verified water-flow factor."""
        return self.coordinator.data.telemetry.water_flow_factor

    @property
    def available(self) -> bool:
        """Disable writes if the robot has not reported this setting."""
        return super().available and self.native_value is not None

    async def async_set_native_value(self, value: float) -> None:
        """Set the robot's official 0.5x to 2.0x water-flow factor."""
        try:
            await self.coordinator.client.async_set_water_flow(value)
        except MaticError:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="setting_unconfirmed",
            ) from None
        await self.coordinator.async_request_full_refresh()
