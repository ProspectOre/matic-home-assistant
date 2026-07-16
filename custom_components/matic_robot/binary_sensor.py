"""Verified Matic Hermes binary state."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.models import RobotState
from .entity import MaticEntity

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class MaticBinarySensorDescription(BinarySensorEntityDescription):
    """Describe a Matic state predicate."""

    value_fn: Callable[[RobotState], bool | None]


DESCRIPTIONS = (
    MaticBinarySensorDescription(
        key="charging",
        translation_key="charging",
        device_class=BinarySensorDeviceClass.BATTERY_CHARGING,
        value_fn=lambda state: state.operational.is_charging,
    ),
    MaticBinarySensorDescription(
        key="paused",
        translation_key="paused",
        value_fn=lambda state: state.operational.paused,
    ),
    MaticBinarySensorDescription(
        key="cleaning",
        translation_key="cleaning",
        device_class=BinarySensorDeviceClass.RUNNING,
        value_fn=lambda state: state.operational.cleaning,
    ),
    MaticBinarySensorDescription(
        key="returning",
        translation_key="returning",
        device_class=BinarySensorDeviceClass.RUNNING,
        value_fn=lambda state: state.operational.returning,
    ),
    MaticBinarySensorDescription(
        key="low_charge",
        translation_key="low_charge",
        device_class=BinarySensorDeviceClass.BATTERY,
        value_fn=lambda state: state.operational.low_charge,
    ),
    MaticBinarySensorDescription(
        key="fully_charged",
        translation_key="fully_charged",
        value_fn=lambda state: state.operational.is_fully_charged,
    ),
    MaticBinarySensorDescription(
        key="problem",
        translation_key="problem",
        device_class=BinarySensorDeviceClass.PROBLEM,
        value_fn=lambda state: bool(state.operational.error_codes),
    ),
    MaticBinarySensorDescription(
        key="update_available",
        translation_key="update_available",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: (
            None
            if state.telemetry.update_state is None
            else state.telemetry.update_state == "available"
        ),
    ),
    MaticBinarySensorDescription(
        key="matter_pairing_mode",
        translation_key="matter_pairing_mode",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: state.telemetry.matter_pairing_enabled,
    ),
    MaticBinarySensorDescription(
        key="active_cleaning_session",
        translation_key="active_cleaning_session",
        device_class=BinarySensorDeviceClass.RUNNING,
        value_fn=lambda state: state.telemetry.active_cleaning_session,
    ),
    MaticBinarySensorDescription(
        key="ssh_tunnel_permission",
        translation_key="ssh_tunnel_permission",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: state.telemetry.ssh_tunnel_permission,
    ),
    MaticBinarySensorDescription(
        key="diagnostic_upload",
        translation_key="diagnostic_upload",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: state.telemetry.uploader_opt_in,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up verified Matic binary sensors."""
    async_add_entities(
        MaticBinarySensor(entry, description) for description in DESCRIPTIONS
    )


class MaticBinarySensor(MaticEntity, BinarySensorEntity):
    """A binary property derived from verified Hermes state codes."""

    entity_description: MaticBinarySensorDescription

    def __init__(
        self,
        entry: MaticConfigEntry,
        description: MaticBinarySensorDescription,
    ) -> None:
        super().__init__(entry)
        self.entity_description = description
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_{description.key}"
        )

    @property
    def is_on(self) -> bool | None:
        """Return the current predicate value."""
        return self.entity_description.value_fn(self.coordinator.data)
