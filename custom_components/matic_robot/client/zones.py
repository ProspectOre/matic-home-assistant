"""Decode the robot's local ``zones`` collection (no-go and similar areas)."""

from __future__ import annotations

import math
import struct

from google.protobuf.message import DecodeError

from .floor_plan import MAX_MAP_COORDINATE
from .models import HermesCollectionEntry, MapZone
from .wire import decode_fields, point

MAX_ZONES = 64
MAX_ZONE_POINTS = 4096
_MAX_ZONE_VALUE_BYTES = 256 * 1024

# Zone class values at key field 2, verified against zones drawn in the Matic
# app. Other values, including the proto default 0, stay "unknown".
_ZONE_KINDS: dict[int, str] = {1: "no_go"}


def _single(payload: bytes, number: int, wire_type: int) -> bytes:
    values = [
        field.value
        for field in decode_fields(payload, max_fields=MAX_ZONE_POINTS + 8)
        if field.number == number
        and field.wire_type == wire_type
        and isinstance(field.value, bytes)
    ]
    if len(values) != 1:
        raise DecodeError(f"zone field {number} is missing or repeated")
    return values[0]


def _ring(payload: bytes) -> tuple[tuple[float, float], ...]:
    ring = tuple(
        point(field.value, max_fields=4)
        for field in decode_fields(payload, max_fields=MAX_ZONE_POINTS)
        if field.number == 1 and field.wire_type == 2 and isinstance(field.value, bytes)
    )
    if len(ring) < 3 or not all(
        math.isfinite(value) and abs(value) <= MAX_MAP_COORDINATE
        for vertex in ring
        for value in vertex
    ):
        raise DecodeError("zone ring is invalid")
    return ring


def decode_zone(entry: HermesCollectionEntry) -> MapZone:
    """Decode one ``zones`` entry, or raise ``DecodeError``.

    Firmware v181 keys each zone by mission and class, so one entry holds the
    merged geometry of every zone of that class: an outer border at value
    field 1 -> 2 and holes at 1 -> 3.
    """
    if len(entry.value) > _MAX_ZONE_VALUE_BYTES:
        raise DecodeError("zone exceeds its size bound")
    key_fields = decode_fields(entry.key, max_fields=4)
    mission_id = struct.unpack("<I", _single(_single(entry.key, 1, 2), 2, 5))[0]
    class_values = [
        field.value
        for field in key_fields
        if field.number == 2 and field.wire_type == 0
    ]
    if len(class_values) > 1:
        raise DecodeError("zone class is repeated")
    class_value = int(class_values[0]) if class_values else 0
    border = _single(entry.value, 1, 2)
    border_fields = decode_fields(border, max_fields=MAX_ZONE_POINTS)
    outer = [
        field.value
        for field in border_fields
        if field.number == 2 and field.wire_type == 2
    ]
    if len(outer) != 1 or not isinstance(outer[0], bytes):
        raise DecodeError("zone outer border is missing or repeated")
    holes = tuple(
        _ring(field.value)
        for field in border_fields
        if field.number == 3 and field.wire_type == 2 and isinstance(field.value, bytes)
    )
    return MapZone(
        mission_id=mission_id,
        kind=_ZONE_KINDS.get(class_value, "unknown"),
        class_value=class_value,
        outline=_ring(outer[0]),
        holes=holes,
    )


def decode_zones(entries: tuple[HermesCollectionEntry, ...]) -> tuple[MapZone, ...]:
    """Decode valid zones, skipping malformed entries."""
    zones: list[MapZone] = []
    for entry in entries[:MAX_ZONES]:
        try:
            zones.append(decode_zone(entry))
        except DecodeError:
            continue
    return tuple(zones)


_Point = tuple[float, float]


def _contains(polygon: tuple[_Point, ...], point: _Point) -> bool:
    """Even-odd point-in-polygon test."""
    inside = False
    x, y = point
    for (x1, y1), (x2, y2) in zip(polygon, polygon[1:] + polygon[:1], strict=True):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def _segment_distance(point: _Point, start: _Point, end: _Point) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = dx * dx + dy * dy
    t = (
        0.0
        if length == 0
        else max(
            0.0,
            min(
                1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length
            ),
        )
    )
    return math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy)


def _cross(a: _Point, b: _Point, c: _Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _edges(polygon: tuple[_Point, ...]) -> list[tuple[_Point, _Point]]:
    return list(zip(polygon, polygon[1:] + polygon[:1], strict=True))


def _zone_contains(zone: MapZone, point: _Point) -> bool:
    return _contains(zone.outline, point) and not any(
        _contains(hole, point) for hole in zone.holes
    )


def _zone_edges(zone: MapZone) -> list[tuple[_Point, _Point]]:
    edges = _edges(zone.outline)
    for hole in zone.holes:
        edges.extend(_edges(hole))
    return edges


def zone_overlaps_polygon(zone: MapZone, polygon: tuple[_Point, ...]) -> bool:
    """Return whether a zone and a room polygon share any area."""
    if len(polygon) < 3:
        return False
    if _zone_contains(zone, polygon[0]) or _contains(polygon, zone.outline[0]):
        return True
    return any(
        _cross(a, b, c) * _cross(a, b, d) < 0 and _cross(c, d, a) * _cross(c, d, b) < 0
        for a, b in _zone_edges(zone)
        for c, d in _edges(polygon)
    )


def zone_overlaps_circle(zone: MapZone, center: _Point, radius: float) -> bool:
    """Return whether a cleaning disc reaches into a zone."""
    return _zone_contains(zone, center) or any(
        _segment_distance(center, a, b) < radius for a, b in _zone_edges(zone)
    )
