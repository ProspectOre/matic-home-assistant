"""Focused access to the current floor plan and its room identities."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er

from .client.models import FloorPlan
from .const import DOMAIN
from .native_completion import native_room_key
from .plans import CleaningRoom, room_cadence_identity


def room_completion_names_are_current(
    floor_plan: FloorPlan, rooms: Sequence[CleaningRoom]
) -> bool:
    """Keep completion labels unique and bound to the same mapped room IDs."""
    mapped = {room.id: native_room_key(room.name) for room in floor_plan.rooms}
    counts = Counter(native_room_key(room.name) for room in floor_plan.rooms)
    return all(
        mapped.get(room.room_id) == native_room_key(room.name)
        and counts[native_room_key(room.name)] == 1
        for room in rooms
    )


def current_floor_plan(entry: ConfigEntry[Any]) -> FloorPlan:
    """Return the coordinator floor only while SLAM identity still matches."""
    floor_plan: FloorPlan | None = entry.runtime_data.coordinator.data.floor_plan
    if floor_plan is None or not entry.runtime_data.slam_map.floor_plan_is_current(
        floor_plan
    ):
        raise ServiceValidationError(
            "The robot's room map is unavailable",
            translation_domain=DOMAIN,
            translation_key="room_plan_unavailable",
        )
    return floor_plan


def current_room_cadence_identity(
    hass: HomeAssistant, entity_id: str, room_id: str
) -> str | None:
    """Resolve cadence identity only from the selected entity's current map."""
    registry_entry = er.async_get(hass).async_get(entity_id)
    if registry_entry is None or registry_entry.config_entry_id is None:
        raise ServiceValidationError(
            "The selected Matic robot is unavailable",
            translation_domain=DOMAIN,
            translation_key="robot_unavailable",
        )
    entry: ConfigEntry[Any] | None = hass.config_entries.async_get_entry(
        registry_entry.config_entry_id
    )
    if entry is None:
        raise ServiceValidationError(
            "The selected Matic robot is unavailable",
            translation_domain=DOMAIN,
            translation_key="robot_unavailable",
        )
    floor_plan = current_floor_plan(entry)
    return (
        room_cadence_identity(floor_plan, room_id)
        if any(room.id == room_id for room in floor_plan.rooms)
        else None
    )
