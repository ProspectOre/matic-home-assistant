"""Hold plan rooms while their Home Assistant occupancy sensor reports on.

A room's sensors come from the HA Area that the vacuum's area mapping binds
to the room, the same mapping ``vacuum.clean_area`` uses. A plan can name one
sensor per room instead. Only an ``on`` state holds a room: ``off``,
``unknown``, ``unavailable`` and missing entities never do, so a broken sensor
cannot stop the house from being cleaned.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from homeassistant.const import STATE_ON
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

OCCUPANCY_DEVICE_CLASSES = frozenset({"occupancy", "presence"})
HOLD_REASON_OCCUPIED = "occupied"


def plan_occupancy_sensors(plan: Mapping[str, Any]) -> dict[str, str]:
    """Return a plan's valid per-room sensor overrides."""
    raw = plan.get("occupancy_sensors")
    if not isinstance(raw, Mapping):
        return {}
    return {
        str(room_id): entity_id
        for room_id, entity_id in raw.items()
        if isinstance(entity_id, str) and entity_id.startswith("binary_sensor.")
    }


def room_area_ids(hass: HomeAssistant, vacuum_entity_id: str) -> dict[str, str]:
    """Map each room ID to the HA Area the vacuum's area mapping assigns it."""
    entry = er.async_get(hass).async_get(vacuum_entity_id)
    if entry is None:
        return {}
    options = entry.options.get("vacuum")
    mapping = options.get("area_mapping") if isinstance(options, Mapping) else None
    if not isinstance(mapping, Mapping):
        return {}
    areas: dict[str, str] = {}
    for area_id, room_ids in mapping.items():
        if not isinstance(room_ids, list):
            continue
        for room_id in room_ids:
            areas.setdefault(str(room_id), str(area_id))
    return areas


def entry_vacuum_entity_id(hass: HomeAssistant, entry_id: str) -> str | None:
    """Return the vacuum entity a Matic config entry registered, if any."""
    return next(
        (
            entry.entity_id
            for entry in er.async_entries_for_config_entry(er.async_get(hass), entry_id)
            if entry.domain == "vacuum"
        ),
        None,
    )


def area_occupancy_sensors(hass: HomeAssistant, area_id: str) -> list[str]:
    """Return occupancy and presence binary sensors placed in one HA Area.

    An entity without its own area inherits its device's area, as it does
    everywhere else in Home Assistant.
    """
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    sensors: list[str] = []
    for entry in entities.entities.values():
        if entry.domain != "binary_sensor" or entry.disabled_by is not None:
            continue
        entry_area = entry.area_id
        if entry_area is None and entry.device_id is not None:
            entry_area = getattr(devices.async_get(entry.device_id), "area_id", None)
        if entry_area != area_id:
            continue
        device_class = entry.device_class or entry.original_device_class
        if device_class in OCCUPANCY_DEVICE_CLASSES:
            sensors.append(entry.entity_id)
    return sorted(sensors)


def occupancy_holds(
    hass: HomeAssistant,
    vacuum_entity_id: str,
    plan: Mapping[str, Any],
    room_ids: Iterable[str],
) -> dict[str, dict[str, str]]:
    """Return the rooms an occupancy-aware plan holds right now, and why."""
    if plan.get("occupancy_aware") is not True:
        return {}
    overrides = plan_occupancy_sensors(plan)
    areas = room_area_ids(hass, vacuum_entity_id)
    holds: dict[str, dict[str, str]] = {}
    for room_id in room_ids:
        if room_id in overrides:
            candidates = [overrides[room_id]]
        elif room_id in areas:
            candidates = area_occupancy_sensors(hass, areas[room_id])
        else:
            continue
        for sensor in candidates:
            state = hass.states.get(sensor)
            if state is not None and state.state == STATE_ON:
                holds[room_id] = {"reason": HOLD_REASON_OCCUPIED, "sensor": sensor}
                break
    return holds
