"""Decode the robot's local ``zones`` collection (no-go and similar areas)."""

from __future__ import annotations

import math
import struct
from itertools import pairwise

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
# How far off a room edge overlap probes sit; well under the 1.5 cm map grid.
_PROBE_OFFSET_METERS = 1e-4


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


def _bounds(points: tuple[_Point, ...]) -> tuple[float, float, float, float]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


def _edge_in_bounds(
    edge: tuple[_Point, _Point], bounds: tuple[float, float, float, float]
) -> bool:
    (x1, y1), (x2, y2) = edge
    return not (
        max(x1, x2) < bounds[0]
        or max(y1, y2) < bounds[1]
        or min(x1, x2) > bounds[2]
        or min(y1, y2) > bounds[3]
    )


def _split_points(
    start: _Point, end: _Point, others: list[tuple[_Point, _Point]]
) -> list[float]:
    """Return where other edges meet this edge, as fractions along it."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = dx * dx + dy * dy
    cuts = [0.0, 1.0]
    for c, d in others:
        ex, ey = d[0] - c[0], d[1] - c[1]
        denominator = dx * ey - dy * ex
        if denominator:
            t = ((c[0] - start[0]) * ey - (c[1] - start[1]) * ex) / denominator
            u = ((c[0] - start[0]) * dy - (c[1] - start[1]) * dx) / denominator
            if 0 <= t <= 1 and 0 <= u <= 1:
                cuts.append(t)
        elif not _cross(start, end, c):
            # Collinear: the other edge's ends split this one where they land.
            cuts.extend(
                t
                for point in (c, d)
                if 0
                < (
                    t := ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy)
                    / length
                )
                < 1
            )
    return sorted(cuts)


def zone_overlaps_polygon(zone: MapZone, polygon: tuple[_Point, ...]) -> bool:
    """Return whether a zone and a room polygon share area.

    Touching boundaries do not count. Each room edge near the zone is split
    where the zone boundary meets it, and a point just off either side of each
    piece is tested against both shapes, so aligned edges are handled too.
    """
    if len(polygon) < 3:
        return False
    zone_bounds = _bounds(zone.outline)
    room_bounds = _bounds(polygon)
    if not (
        zone_bounds[0] < room_bounds[2]
        and room_bounds[0] < zone_bounds[2]
        and zone_bounds[1] < room_bounds[3]
        and room_bounds[1] < zone_bounds[3]
    ):
        return False
    # A zone wholly inside the room touches no room edge, so test one of its
    # corners; a corner on the room's boundary is left to the edge probes.
    corner = zone.outline[0]
    if _contains(polygon, corner) and all(
        _segment_distance(corner, a, b) > _PROBE_OFFSET_METERS
        for a, b in _edges(polygon)
    ):
        return True
    zone_edges = [
        edge for edge in _zone_edges(zone) if _edge_in_bounds(edge, room_bounds)
    ]
    for start, end in _edges(polygon):
        if (start == end) or not _edge_in_bounds((start, end), zone_bounds):
            continue
        dx, dy = end[0] - start[0], end[1] - start[1]
        scale = _PROBE_OFFSET_METERS / math.hypot(dx, dy)
        cuts = _split_points(start, end, zone_edges)
        for low, high in pairwise(cuts):
            if high - low <= 1e-9:
                continue
            middle = (low + high) / 2
            x, y = start[0] + middle * dx, start[1] + middle * dy
            for side in (1, -1):
                probe = (x - side * dy * scale, y + side * dx * scale)
                if _zone_contains(zone, probe) and _contains(polygon, probe):
                    return True
    return False


def zone_overlaps_circle(zone: MapZone, center: _Point, radius: float) -> bool:
    """Return whether a cleaning disc reaches into a zone."""
    return _zone_contains(zone, center) or any(
        _segment_distance(center, a, b) < radius for a, b in _zone_edges(zone)
    )
