"""Privacy-safe Matic Cues events."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from homeassistant.components.event import EventEntity, EventEntityDescription
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .const import CUES_EVENT_TYPES
from .cues import CuesTransitions, MaticCuesEvent
from .entity import MaticEntity
from .stores import Store

PARALLEL_UPDATES = 0

CUES_DESCRIPTION = EventEntityDescription(
    key="cues",
    translation_key="cues",
    event_types=list(CUES_EVENT_TYPES),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the Matic Cues event entity."""
    async_add_entities([MaticCuesEventEntity(entry)])


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
