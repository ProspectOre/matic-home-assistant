"""Verified reversible settings for Matic robots."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.components.switch import SwitchEntity, SwitchEntityDescription
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .entity import MaticEntity

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class MaticSettingDescription(SwitchEntityDescription):
    """Describe one live-verified reversible robot setting."""

    telemetry_attribute: str
    api_setting: str


DESCRIPTIONS = (
    MaticSettingDescription(
        key="child_lock",
        translation_key="child_lock",
        entity_category=EntityCategory.CONFIG,
        telemetry_attribute="child_lock_enabled",
        api_setting="child_lock",
    ),
    MaticSettingDescription(
        key="pet_waste_avoidance",
        translation_key="pet_waste_avoidance",
        entity_category=EntityCategory.CONFIG,
        telemetry_attribute="pet_waste_enabled",
        api_setting="pet_waste",
    ),
    MaticSettingDescription(
        key="voice_assistant",
        translation_key="voice_assistant",
        entity_category=EntityCategory.CONFIG,
        telemetry_attribute="voice_enabled",
        api_setting="voice",
    ),
    MaticSettingDescription(
        key="deep_mop",
        translation_key="deep_mop",
        entity_category=EntityCategory.CONFIG,
        telemetry_attribute="deep_mop_enabled",
        api_setting="deep_mop",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up verified Matic settings."""
    async_add_entities(
        MaticSettingSwitch(entry, description) for description in DESCRIPTIONS
    )


class MaticSettingSwitch(MaticEntity, SwitchEntity):
    """A verified setting backed by local Hermes state."""

    entity_description: MaticSettingDescription

    def __init__(
        self,
        entry: MaticConfigEntry,
        description: MaticSettingDescription,
    ) -> None:
        super().__init__(entry)
        self.entity_description = description
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_{description.key}"
        )

    @property
    def is_on(self) -> bool | None:
        """Return the decoded robot setting."""
        value = getattr(
            self.coordinator.data.telemetry,
            self.entity_description.telemetry_attribute,
        )
        return value if isinstance(value, bool) else None

    @property
    def available(self) -> bool:
        """Disable writes if the robot has not reported this setting."""
        return super().available and self.is_on is not None

    async def async_turn_on(self, **kwargs: object) -> None:
        """Enable this setting."""
        await self._async_set(True)

    async def async_turn_off(self, **kwargs: object) -> None:
        """Disable this setting."""
        await self._async_set(False)

    async def _async_set(self, enabled: bool) -> None:
        setting = self.entity_description.api_setting
        if setting == "deep_mop":
            await self.coordinator.client.async_set_deep_mop(enabled)
        else:
            await self.coordinator.client.async_set_binary_setting(
                setting,
                enabled,
            )
        await self.coordinator.async_request_refresh()
