"""Verified Matic Hermes binary state."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any, Literal

from homeassistant.components.binary_sensor import (
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.components.binary_sensor.const import BinarySensorDeviceClass
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .entity import MaticEntity
from .session import RobotSession
from .stores import Store

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class MaticBinarySensorDescription(BinarySensorEntityDescription):
    """Describe a predicate on one of the session's stores."""

    store: Literal["state", "telemetry"]
    value_fn: Callable[[RobotSession], bool | None]
    attributes_fn: Callable[[RobotSession], dict[str, object]] | None = None


DESCRIPTIONS = (
    MaticBinarySensorDescription(
        key="charging",
        translation_key="charging",
        device_class=BinarySensorDeviceClass.BATTERY_CHARGING,
        store="state",
        value_fn=lambda session: session.state.value.operational.is_charging,
    ),
    MaticBinarySensorDescription(
        key="cleaning",
        translation_key="cleaning",
        device_class=BinarySensorDeviceClass.RUNNING,
        store="state",
        value_fn=lambda session: session.state.value.operational.cleaning,
    ),
    MaticBinarySensorDescription(
        key="low_charge",
        translation_key="low_charge",
        device_class=BinarySensorDeviceClass.BATTERY,
        store="state",
        value_fn=lambda session: session.state.value.operational.low_charge,
    ),
    MaticBinarySensorDescription(
        key="problem",
        translation_key="problem",
        device_class=BinarySensorDeviceClass.PROBLEM,
        store="state",
        value_fn=lambda session: bool(session.state.value.operational.error_codes),
        attributes_fn=lambda session: {
            "errors": list(session.state.value.operational.error_names)
        },
    ),
    MaticBinarySensorDescription(
        key="bag_full",
        translation_key="bag_full",
        device_class=BinarySensorDeviceClass.PROBLEM,
        store="state",
        value_fn=lambda session: session.state.value.operational.bag_full,
    ),
    MaticBinarySensorDescription(
        key="bag_missing",
        translation_key="bag_missing",
        device_class=BinarySensorDeviceClass.PROBLEM,
        store="state",
        value_fn=lambda session: session.state.value.operational.bag_missing,
    ),
    MaticBinarySensorDescription(
        key="matter_pairing_mode",
        translation_key="matter_pairing_mode",
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        store="telemetry",
        value_fn=lambda session: session.telemetry.value.matter_pairing_enabled,
    ),
    MaticBinarySensorDescription(
        key="ssh_tunnel_permission",
        translation_key="ssh_tunnel_permission",
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        store="telemetry",
        value_fn=lambda session: session.telemetry.value.ssh_tunnel_permission,
    ),
    MaticBinarySensorDescription(
        key="diagnostic_upload",
        translation_key="diagnostic_upload",
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        store="telemetry",
        value_fn=lambda session: session.telemetry.value.uploader_opt_in,
    ),
    MaticBinarySensorDescription(
        key="following_person",
        translation_key="following_person",
        device_class=BinarySensorDeviceClass.RUNNING,
        store="state",
        value_fn=lambda session: session.state.value.operational.following_person,
    ),
    MaticBinarySensorDescription(
        key="maintenance_suggested",
        translation_key="maintenance_suggested",
        device_class=BinarySensorDeviceClass.PROBLEM,
        store="telemetry",
        value_fn=lambda session: (
            None
            if session.telemetry.value.maintenance_suggestions is None
            else bool(session.telemetry.value.maintenance_suggestions)
        ),
        attributes_fn=lambda session: {
            "recap_month": session.telemetry.value.maintenance_recap_month
        },
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
        self._attr_unique_id = f"{self._matic_serial}_{description.key}"

    def _stores(self) -> Iterable[Store[Any]]:
        return (getattr(self.session, self.entity_description.store),)

    @property
    def is_on(self) -> bool | None:
        """Return the current predicate value."""
        return self.entity_description.value_fn(self.session)

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return the description's attributes, if it has any."""
        attributes_fn = self.entity_description.attributes_fn
        return attributes_fn(self.session) if attributes_fn else None
