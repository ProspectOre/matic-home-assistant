"""Saved cleaning-plan controls for Matic robots."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, callback
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
            MaticAreaButton(entry),
        ]
    )


class MaticPlanButton(MaticEntity, ButtonEntity):
    """Run one native saved-plan operation for this robot."""

    def __init__(self, entry: MaticConfigEntry, service: str) -> None:
        super().__init__(entry)
        self._service = service
        self._serial_number = self.coordinator.data.info.serial_number
        self._plans = entry.runtime_data.cleaning_plans
        self._attr_translation_key = service
        self._attr_unique_id = f"{self._serial_number}_{service}"
        self._attr_entity_registry_enabled_default = service in {
            "run_selected_plan",
            "stop_intelligent_cleaning",
        }

    async def async_added_to_hass(self) -> None:
        """Refresh availability when plans or managed runs change."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._plans.async_add_listener(
                self._serial_number, self._async_plans_updated
            )
        )
        self.async_on_remove(
            self._config_entry.runtime_data.slam_map.async_add_listener(
                self._async_plans_updated
            )
        )

    @callback
    def _async_plans_updated(self) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Expose only plan operations that can succeed now."""
        if not super().available:
            return False
        if self._service == "stop_intelligent_cleaning":
            return self._plans.snapshot(self._serial_number)["active_plan"] is not None

        floor_plan = self.coordinator.data.floor_plan
        if (
            floor_plan is None
            or not floor_plan.rooms
            or not self._config_entry.runtime_data.slam_map.floor_plan_is_current(
                floor_plan
            )
        ):
            return False
        room_map = {room.id: room.name for room in floor_plan.rooms}
        try:
            self._plans.preview(self._serial_number, room_map)
        except KeyError, ValueError:
            return False
        return True

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


class MaticAreaButton(MaticEntity, ButtonEntity):
    """Run the custom area selected on the Matic device page."""

    _attr_translation_key = "clean_selected_area"
    _attr_entity_registry_enabled_default = True

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._serial_number = self.coordinator.data.info.serial_number
        self._areas = entry.runtime_data.cleaning_plans
        self._attr_unique_id = f"{self._serial_number}_clean_selected_area"

    async def async_added_to_hass(self) -> None:
        """Refresh availability when custom areas change."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._areas.async_add_listener(
                self._serial_number, self._async_areas_updated
            )
        )
        self.async_on_remove(
            self._config_entry.runtime_data.slam_map.async_add_listener(
                self._async_areas_updated
            )
        )

    @callback
    def _async_areas_updated(self) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Expose the action only while a current custom area can be resolved."""
        floor_plan = self.coordinator.data.floor_plan
        if (
            not super().available
            or floor_plan is None
            or not self._config_entry.runtime_data.slam_map.floor_plan_is_current(
                floor_plan
            )
        ):
            return False
        try:
            self._areas.area(self._serial_number)
        except KeyError:
            return False
        return True

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
        """Run the selected private custom area through the validated action."""
        area = self._areas.area(self._serial_number)
        await self.hass.services.async_call(
            DOMAIN,
            "clean_area",
            {
                ATTR_ENTITY_ID: self._vacuum_entity_id(),
                "area": area["id"],
            },
            blocking=True,
        )
