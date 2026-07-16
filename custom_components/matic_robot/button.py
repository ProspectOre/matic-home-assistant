"""Saved cleaning-plan controls for Matic robots."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .const import DOMAIN
from .entity import MaticEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up verified Matic command buttons."""
    async_add_entities(
        [
            MaticPlanButton(entry, "run_selected_plan"),
            MaticPlanButton(entry, "intelligent_clean"),
            MaticPlanButton(entry, "clean_entire_plan"),
            MaticPlanButton(entry, "stop_intelligent_cleaning"),
        ]
    )


class MaticPlanButton(MaticEntity, ButtonEntity):
    """Run one native saved-plan operation for this robot."""

    def __init__(self, entry: MaticConfigEntry, service: str) -> None:
        super().__init__(entry)
        self._service = service
        self._attr_translation_key = service
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_{service}"
        self._attr_entity_registry_enabled_default = service in {
            "run_selected_plan",
            "stop_intelligent_cleaning",
        }

    def _vacuum_entity_id(self) -> str:
        """Find the vacuum entity owned by this config entry."""
        for entity in er.async_entries_for_config_entry(
            er.async_get(self.hass), self._config_entry.entry_id
        ):
            if entity.domain == "vacuum" and entity.platform == DOMAIN:
                return entity.entity_id
        raise HomeAssistantError(
            "The selected Matic robot is unavailable",
            translation_domain=DOMAIN,
            translation_key="robot_unavailable",
        )

    async def async_press(self) -> None:
        """Invoke the selected saved-plan operation."""
        await self.hass.services.async_call(
            DOMAIN,
            self._service,
            {ATTR_ENTITY_ID: self._vacuum_entity_id()},
            blocking=True,
        )
