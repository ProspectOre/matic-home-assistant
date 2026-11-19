"""Photo viewpoints: a named spot and direction on one floor.

A viewpoint is sent to the robot as the posture goal the Matic app sends for a
map tap, so the robot parks on the spot facing the saved heading.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.storage import Store

from .client import FloorPlan, MapZone, room_at, room_name_key, zone_overlaps_circle
from .const import DOMAIN

if TYPE_CHECKING:
    from . import MaticConfigEntry

STORAGE_VERSION = 1
MAX_VIEWPOINTS = 50
MAX_NAME_LENGTH = 64
# The robot's radius plus a little: a goal closer to a no-go zone than this
# would ask the robot to stand in it.
NO_GO_MARGIN_METERS = 0.25


@dataclass(frozen=True, slots=True)
class Viewpoint:
    """A saved spot in metres on one floor, and a heading in radians.

    The heading is counter-clockwise from the map's +x axis, as robot poses
    report it. ``room_id`` is the room whose outline held the spot when saved.
    """

    viewpoint_id: str
    name: str
    mission_id: int
    x: float
    y: float
    heading: float
    room_id: str


class Viewpoints:
    """One robot's saved viewpoints, kept in Home Assistant's private storage."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store = _store(hass, entry_id)
        self._viewpoints: dict[str, Viewpoint] = {}

    @property
    def all(self) -> tuple[Viewpoint, ...]:
        return tuple(self._viewpoints.values())

    async def async_load(self) -> None:
        stored = await self._store.async_load() or {}
        items = stored.get("viewpoints") if isinstance(stored, dict) else None
        if not isinstance(items, list):
            items = []
        loaded = (_decode(item) for item in items)
        self._viewpoints = {
            viewpoint.viewpoint_id: viewpoint for viewpoint in loaded if viewpoint
        }

    def find(self, reference: str) -> Viewpoint:
        """Return the viewpoint with this ID or name, ignoring case."""
        if viewpoint := self._viewpoints.get(reference):
            return viewpoint
        key = room_name_key(reference)
        for viewpoint in self._viewpoints.values():
            if room_name_key(viewpoint.name) == key:
                return viewpoint
        raise _error("viewpoint_unknown", viewpoint=reference)

    async def async_save(
        self,
        name: str,
        floor_plan: FloorPlan,
        zones: tuple[MapZone, ...] | None,
        no_photo_rooms: set[str],
        *,
        x: float,
        y: float,
        heading: float,
    ) -> Viewpoint:
        """Save a new viewpoint after checking it is a spot photos may be taken.

        ``zones`` is None while the robot's zones can't be read, and then no
        spot can be shown to be clear of no-go zones.
        """
        name = name.strip()
        if not name or len(name) > MAX_NAME_LENGTH:
            raise _error("viewpoint_name_invalid")
        if any(
            room_name_key(viewpoint.name) == room_name_key(name)
            for viewpoint in self._viewpoints.values()
        ):
            raise _error("viewpoint_name_taken", viewpoint=name)
        # A stop or an assistant place names a viewpoint or a room, not both.
        if any(
            room_name_key(room.name) == room_name_key(name) for room in floor_plan.rooms
        ):
            raise _error("viewpoint_name_is_room", viewpoint=name)
        if len(self._viewpoints) >= MAX_VIEWPOINTS:
            raise _error("viewpoint_limit", limit=str(MAX_VIEWPOINTS))
        if not all(math.isfinite(value) for value in (x, y, heading)):
            raise _error("viewpoint_outside_rooms")
        room = room_at(floor_plan, (x, y))
        if room is None:
            raise _error("viewpoint_outside_rooms")
        if room.id in no_photo_rooms:
            raise _error("viewpoint_room_no_photo", room=room.name)
        if zones is None:
            raise _error("viewpoint_zones_unavailable")
        if near_no_go_zone(zones, floor_plan.mission_id, (x, y)):
            raise _error("viewpoint_in_no_go_zone")
        viewpoint = Viewpoint(
            uuid4().hex,
            name,
            floor_plan.mission_id,
            x,
            y,
            math.remainder(heading, math.tau),
            room.id,
        )
        self._viewpoints[viewpoint.viewpoint_id] = viewpoint
        await self._async_save()
        return viewpoint

    async def async_delete(self, reference: str) -> None:
        del self._viewpoints[self.find(reference).viewpoint_id]
        await self._async_save()

    async def async_remove(self) -> None:
        await self._store.async_remove()

    async def _async_save(self) -> None:
        await self._store.async_save(
            {"viewpoints": [asdict(viewpoint) for viewpoint in self.all]}
        )


def readable_zones(entry: MaticConfigEntry) -> tuple[MapZone, ...] | None:
    """Return the robot's zones, or None when the last read of them failed."""
    runtime = entry.runtime_data
    if runtime.client.endpoint_health.get("zones") != "ok":
        return None
    return runtime.session.telemetry.value.zones


def near_no_go_zone(
    zones: tuple[MapZone, ...], mission_id: int, point: tuple[float, float]
) -> bool:
    """Return whether the robot standing at ``point`` would reach a no-go zone."""
    return any(
        zone.kind == "no_go"
        and zone.mission_id == mission_id
        and zone_overlaps_circle(zone, point, NO_GO_MARGIN_METERS)
        for zone in zones
    )


def _store(hass: HomeAssistant, entry_id: str) -> Store[dict[str, Any]]:
    return Store(hass, STORAGE_VERSION, f"{DOMAIN}.viewpoints.{entry_id}", private=True)


def _decode(data: Any) -> Viewpoint | None:
    try:
        viewpoint = Viewpoint(
            str(data["viewpoint_id"]),
            str(data["name"]),
            int(data["mission_id"]),
            float(data["x"]),
            float(data["y"]),
            float(data["heading"]),
            str(data["room_id"]),
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return None
    if not all(
        math.isfinite(value) for value in (viewpoint.x, viewpoint.y, viewpoint.heading)
    ):
        return None
    return viewpoint


def _error(key: str, **placeholders: str) -> ServiceValidationError:
    return ServiceValidationError(
        key,
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=placeholders or None,
    )
