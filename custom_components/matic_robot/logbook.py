"""Describe the run lifecycle bus events in the logbook."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from homeassistant.const import ATTR_DEVICE_ID, ATTR_ENTITY_ID
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr

from .const import DOMAIN, RUN_EVENT_TYPES

# The logbook shows each message after the robot's name; {room}, {area} and
# {outcome} come from the event. The logbook entry keys are its own; importing
# them would make logbook a dependency.
MESSAGES = {
    "plan_started": "started a plan",
    "room_held": "held back {room} while it is occupied",
    "room_started": "started cleaning {room}",
    "room_completed": "finished cleaning {room}",
    "room_skipped": "skipped {room}",
    "room_failed": "could not clean {room}",
    "room_cancelled": "cancelled {room}",
    "room_interrupted": "stopped cleaning {room} early",
    "room_ended_unverified": "ended {room} without confirmation",
    "room_reconciled": "confirmed {room} as cleaned",
    "area_started": "started cleaning {area}",
    "area_finished": "finished cleaning {area}",
    "area_failed": "could not clean {area}",
    "plan_finished": "ended a plan ({outcome})",
    "plan_docked": "docked after a stopped plan",
    "cleaning_finished": "ended a clean ({outcome})",
}
assert MESSAGES.keys() == set(RUN_EVENT_TYPES)


@callback
def async_describe_events(
    hass: HomeAssistant,
    async_describe_event: Callable[[str, str, Callable[[Event], dict[str, str]]], None],
) -> None:
    """Describe each run lifecycle event."""

    @callback
    def describe(event: Event) -> dict[str, str]:
        data = event.data
        name = "Matic"
        if (entity_id := data.get(ATTR_ENTITY_ID)) and (
            state := hass.states.get(entity_id)
        ):
            name = state.name
        elif (device_id := data.get(ATTR_DEVICE_ID)) and (
            device := dr.async_get(hass).async_get(device_id)
        ):
            name = device.name_by_user or device.name or name
        kind = str(event.event_type).removeprefix(f"{DOMAIN}_")
        entry = {"name": name, "message": MESSAGES[kind].format(**_placeholders(data))}
        if entity_id:
            entry[ATTR_ENTITY_ID] = entity_id
        return entry

    for event_type in RUN_EVENT_TYPES:
        async_describe_event(DOMAIN, f"{DOMAIN}_{event_type}", describe)


def _placeholders(data: Mapping[str, Any]) -> dict[str, str]:
    """Return the message fields, with plain words for a missing one."""
    outcome = data.get("outcome") or data.get("stop_reason") or "reason not recorded"
    return {
        "room": str(data.get("room") or "a room"),
        "area": str(data.get("area") or "an area"),
        "outcome": str(outcome).replace("_", " "),
    }
