"""Bind private custom cleaning areas to one verified local floor plan."""

from __future__ import annotations

import hashlib
import math
import struct
from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .client.models import FloorPlan
from .const import DOMAIN

AREA_SCHEMA_VERSION = 1
MAP_BINDING_VERSION = 1
_FINGERPRINT_DOMAIN = b"matic-area-geometry\0"
_MILLIMETERS_PER_METER = 1_000
_MIN_SIGNED_64 = -(1 << 63)
_MAX_SIGNED_64 = (1 << 63) - 1
_AREA_REPAIR_LEARN_MORE_URL = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/docs/automation.md#drawn-custom-areas"
)

MapBinding = dict[str, int | str]
_QuantizedPoint = tuple[int, int]
_CanonicalPolygon = tuple[_QuantizedPoint, ...]


class AreaBindingStatus(StrEnum):
    """Whether saved custom-area coordinates match the active floor plan."""

    CURRENT = "current"
    LEGACY = "legacy"
    INVALID = "invalid"
    MISSION_CHANGED = "mission_changed"
    PARTITION_CHANGED = "partition_changed"
    GEOMETRY_CHANGED = "geometry_changed"


@callback
def async_sync_custom_area_issue(
    hass: HomeAssistant,
    entry_id: str,
    areas: Mapping[str, Any],
    floor_plan: FloorPlan | None,
) -> int | None:
    """Create, update, or clear one privacy-safe stale-area Repair.

    A missing or unusable live map cannot establish compatibility, so it never
    creates or clears an existing issue. The Repair exposes only a count.
    """
    if floor_plan is None:
        return None
    try:
        binding_for_floor_plan(floor_plan)
    except OverflowError, TypeError, ValueError:
        return None

    stale_count = sum(
        not isinstance(area, Mapping)
        or area_binding_status(area, floor_plan) is not AreaBindingStatus.CURRENT
        for area in areas.values()
    )
    issue_id = custom_area_issue_id(entry_id)
    if stale_count:
        ir.async_create_issue(
            hass,
            DOMAIN,
            issue_id,
            is_fixable=False,
            is_persistent=True,
            learn_more_url=_AREA_REPAIR_LEARN_MORE_URL,
            severity=ir.IssueSeverity.WARNING,
            translation_key="custom_area_map_changed",
            translation_placeholders={"count": str(stale_count)},
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
    return stale_count


@callback
def async_delete_custom_area_issue(hass: HomeAssistant, entry_id: str) -> None:
    """Delete the stale-area Repair when its config entry is removed."""
    ir.async_delete_issue(hass, DOMAIN, custom_area_issue_id(entry_id))


def custom_area_issue_id(entry_id: str) -> str:
    """Return a stable Repair key without exposing the config-entry id."""
    digest = hashlib.sha256(entry_id.encode()).hexdigest()[:12]
    return f"custom_area_map_changed_{digest}"


def floor_plan_geometry_fingerprint(floor_plan: FloorPlan) -> str:
    """Return a stable, name-independent fingerprint of mapped room geometry.

    Coordinates are quantized to millimeters. Polygon start position, winding,
    room order, room names, and protocol identifiers do not affect the result.
    Duplicate polygons remain significant so the digest cannot collapse rooms.
    """
    polygons = sorted(_canonical_polygon(room.boundary) for room in floor_plan.rooms)
    if not polygons:
        raise ValueError("floor plan has no room geometry")

    digest = hashlib.sha256()
    digest.update(_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">H", MAP_BINDING_VERSION))
    digest.update(struct.pack(">I", len(polygons)))
    for polygon in polygons:
        digest.update(struct.pack(">I", len(polygon)))
        for x, y in polygon:
            digest.update(struct.pack(">qq", x, y))
    return digest.hexdigest()


def binding_for_floor_plan(floor_plan: FloorPlan) -> MapBinding:
    """Return the versioned identity and geometry binding for a floor plan."""
    mission_id = floor_plan.mission_id
    if (
        isinstance(mission_id, bool)
        or not isinstance(mission_id, int)
        or not 0 <= mission_id <= 0xFFFFFFFF
    ):
        raise ValueError("floor plan mission id is invalid")
    partition_id = floor_plan.partition_protocol_id
    if not isinstance(partition_id, str) or not partition_id:
        raise ValueError("floor plan partition id is invalid")
    return {
        "version": MAP_BINDING_VERSION,
        "mission_id": mission_id,
        "partition_id": partition_id,
        "geometry_sha256": floor_plan_geometry_fingerprint(floor_plan),
    }


def area_binding_status(
    area: Mapping[str, Any], floor_plan: FloorPlan
) -> AreaBindingStatus:
    """Compare one saved area with the current floor plan without guessing."""
    schema_version = area.get("schema_version")
    if schema_version is None:
        return AreaBindingStatus.LEGACY
    if isinstance(schema_version, bool):
        return AreaBindingStatus.INVALID
    if schema_version == 0:
        return AreaBindingStatus.LEGACY
    if not isinstance(schema_version, int) or schema_version != AREA_SCHEMA_VERSION:
        return AreaBindingStatus.INVALID

    saved = area.get("map_binding")
    if not isinstance(saved, Mapping) or not _valid_saved_binding(saved):
        return AreaBindingStatus.INVALID
    try:
        current = binding_for_floor_plan(floor_plan)
    except OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID

    if saved["mission_id"] != current["mission_id"]:
        return AreaBindingStatus.MISSION_CHANGED
    if saved["partition_id"] != current["partition_id"]:
        return AreaBindingStatus.PARTITION_CHANGED
    saved_geometry = str(saved["geometry_sha256"]).casefold()
    if saved_geometry != current["geometry_sha256"]:
        return AreaBindingStatus.GEOMETRY_CHANGED
    return AreaBindingStatus.CURRENT


def _valid_saved_binding(binding: Mapping[str, Any]) -> bool:
    """Return whether a persisted binding has the exact supported shape."""
    if set(binding) != {
        "version",
        "mission_id",
        "partition_id",
        "geometry_sha256",
    }:
        return False
    version = binding["version"]
    mission_id = binding["mission_id"]
    partition_id = binding["partition_id"]
    geometry = binding["geometry_sha256"]
    return (
        not isinstance(version, bool)
        and isinstance(version, int)
        and version == MAP_BINDING_VERSION
        and not isinstance(mission_id, bool)
        and isinstance(mission_id, int)
        and 0 <= mission_id <= 0xFFFFFFFF
        and isinstance(partition_id, str)
        and bool(partition_id)
        and isinstance(geometry, str)
        and len(geometry) == 64
        and all(character in "0123456789abcdefABCDEF" for character in geometry)
    )


def _canonical_polygon(boundary: tuple[tuple[float, float], ...]) -> _CanonicalPolygon:
    """Canonicalize one polygon across closure, rotation, and winding."""
    points: list[_QuantizedPoint] = []
    for raw_x, raw_y in boundary:
        point = (_quantize_coordinate(raw_x), _quantize_coordinate(raw_y))
        if not points or point != points[-1]:
            points.append(point)
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    if len(points) < 3 or len(set(points)) < 3:
        raise ValueError("room boundary has fewer than three distinct points")

    forward = _smallest_rotation(tuple(points))
    reverse = _smallest_rotation(tuple(reversed(points)))
    return min(forward, reverse)


def _smallest_rotation(points: _CanonicalPolygon) -> _CanonicalPolygon:
    """Return the lexicographically smallest cyclic rotation."""
    return min(points[index:] + points[:index] for index in range(len(points)))


def _quantize_coordinate(value: float) -> int:
    """Convert finite meters to signed millimeters, normalizing negative zero."""
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("room boundary coordinates must be finite")
    scaled = numeric * _MILLIMETERS_PER_METER
    if not math.isfinite(scaled):
        raise ValueError("room boundary coordinate is out of range")
    quantized = math.floor(scaled + 0.5) if scaled >= 0 else math.ceil(scaled - 0.5)
    if not _MIN_SIGNED_64 <= quantized <= _MAX_SIGNED_64:
        raise ValueError("room boundary coordinate is out of range")
    return quantized
