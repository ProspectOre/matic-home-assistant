"""Matic Cues and cleaning run event entities."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from homeassistant.components.event import EventEntity, EventEntityDescription
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.const import ATTR_DEVICE_ID, ATTR_ENTITY_ID
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .const import CUES_EVENT_TYPES, DOMAIN, RUN_EVENT_TYPES
from .cues import CuesTransitions, MaticCuesEvent
from .entity import MaticEntity
from .stores import Store

PARALLEL_UPDATES = 0

CUES_DESCRIPTION = EventEntityDescription(
    key="cues",
    translation_key="cues",
    event_types=list(CUES_EVENT_TYPES),
)
RUN_DESCRIPTION = EventEntityDescription(
    key="cleaning_run",
    translation_key="cleaning_run",
    event_types=list(RUN_EVENT_TYPES),
)
# The robot is the entity itself, so these name it only on the bus.
_ROBOT_FIELDS = frozenset({ATTR_ENTITY_ID, ATTR_DEVICE_ID, "entry_id"})


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the Matic Cues and cleaning run event entities."""
    async_add_entities([MaticCuesEventEntity(entry), MaticRunEventEntity(entry)])


class MaticCuesEventEntity(MaticEntity, EventEntity):
    """Expose Cues voice and gesture lifecycle events to automations."""

    entity_description = CUES_DESCRIPTION
    _unrecorded_attributes = frozenset({"intent"})

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.session.info.serial_number}_cues"

    def _stores(self) -> Iterable[Store[Any]]:
        return ()

    async def async_added_to_hass(self) -> None:
        """Listen for live Cues transitions."""
        await super().async_added_to_hass()
        self.async_on_remove(
            CuesTransitions(self.session.state, self._async_cues_event).subscribe()
        )

    @callback
    def _async_cues_event(self, event: MaticCuesEvent) -> None:
        """Record one Cues lifecycle event on this entity."""
        self._trigger_event(event.event_type, event.attributes)
        self.async_write_ha_state()


class MaticRunEventEntity(MaticEntity, EventEntity):
    """Mirror this robot's run lifecycle bus events, one event type each."""

    entity_description = RUN_DESCRIPTION
    # Cleaning finished's room lists and results stay out of Recorder, as on
    # the sensors.
    _unrecorded_attributes = frozenset({"rooms", "completed_rooms", "room_durations"})

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self._matic_serial}_cleaning_run"

    def _stores(self) -> Iterable[Store[Any]]:
        return ()

    async def async_added_to_hass(self) -> None:
        """Listen for this robot's run events."""
        await super().async_added_to_hass()
        for event_type in RUN_EVENT_TYPES:
            self.async_on_remove(
                self.hass.bus.async_listen(
                    f"{DOMAIN}_{event_type}",
                    self._async_run_event,
                    event_filter=self._is_this_robot,
                )
            )

    @callback
    def _is_this_robot(self, data: Mapping[str, Any]) -> bool:
        """Match the robot's entry, or its vacuum entity as currently named."""
        if data.get("entry_id") == self._config_entry.entry_id:
            return True
        entity_id = data.get(ATTR_ENTITY_ID)
        return entity_id is not None and entity_id == er.async_get(
            self.hass
        ).async_get_entity_id(VACUUM_DOMAIN, DOMAIN, f"{self._matic_serial}_vacuum")

    @callback
    def _async_run_event(self, event: Event[Mapping[str, Any]]) -> None:
        """Record one run event with its payload as attributes."""
        self._trigger_event(
            str(event.event_type).removeprefix(f"{DOMAIN}_"),
            {
                key: value
                for key, value in event.data.items()
                if key not in _ROBOT_FIELDS
            },
        )
        self.async_write_ha_state()
