"""Bind private custom cleaning areas to one verified local floor plan."""

from __future__ import annotations

import hashlib
import math
import struct
from collections import deque
from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .area_selector import MaticAreaSelector
from .client.models import FloorPlan
from .const import DOMAIN

AREA_SCHEMA_VERSION = 1
MAP_BINDING_VERSION = 1
HASH_ONLY_SCOPED_MAP_BINDING_VERSION = 2
SCOPED_MAP_BINDING_VERSION = 3
_FINGERPRINT_DOMAIN = b"matic-area-geometry\0"
_SCOPED_FINGERPRINT_DOMAIN = b"matic-area-local-geometry\0"
_AREA_SHAPE_FINGERPRINT_DOMAIN = b"matic-area-shape\0"
_MILLIMETERS_PER_METER = 1_000
_LEGACY_LOCAL_UNITS_PER_METER = 100
_LOCAL_GEOMETRY_MARGIN_METERS = 0.25
_LOCAL_GEOMETRY_TOLERANCE_MILLIMETERS = 10
_LOCAL_GEOMETRY_TOLERANCE_METERS = (
    _LOCAL_GEOMETRY_TOLERANCE_MILLIMETERS / _MILLIMETERS_PER_METER
)
_MIN_SIGNED_64 = -(1 << 63)
_MAX_SIGNED_64 = (1 << 63) - 1
_AREA_REPAIR_LEARN_MORE_URL = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/docs/automation.md#drawn-custom-areas"
)

MapBinding = dict[str, Any]
_QuantizedPoint = tuple[int, int]
_CanonicalPolygon = tuple[_QuantizedPoint, ...]
_LocalSegment = tuple[int, int, int, int]
_AreaShape = tuple[tuple[int, int, int], ...]
_LocalGeometry = tuple[_AreaShape, tuple[int, ...], tuple[_LocalSegment, ...]]


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
    """Return the legacy whole-floor identity and geometry binding."""
    return {
        "version": MAP_BINDING_VERSION,
        **_floor_plan_binding(floor_plan),
    }


def binding_for_area(
    floor_plan: FloorPlan, circles: Sequence[Mapping[str, Any]]
) -> MapBinding:
    """Bind an area to its map identity and nearby room geometry."""
    shape, occupancy, segments = _area_geometry_components(floor_plan, circles)
    return {
        "version": SCOPED_MAP_BINDING_VERSION,
        **_floor_plan_binding(floor_plan),
        "area_shape_sha256": _area_shape_fingerprint(shape),
        "local_geometry_sha256": _local_geometry_fingerprint(
            shape, occupancy, segments
        ),
        "local_occupancy": list(occupancy),
        "local_segments_mm": [list(segment) for segment in segments],
    }


def _floor_plan_binding(floor_plan: FloorPlan) -> MapBinding:
    """Return validated floor identity fields shared by binding versions."""
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
        "mission_id": mission_id,
        "partition_id": partition_id,
        "geometry_sha256": floor_plan_geometry_fingerprint(floor_plan),
    }


def area_geometry_fingerprint(
    floor_plan: FloorPlan, circles: Sequence[Mapping[str, Any]]
) -> str:
    """Fingerprint map geometry only near one painted cleaning area.

    The fingerprint includes the immutable saved circles, mapped-floor
    occupancy probes, and room-boundary segments within a small safety margin
    plus a tolerance guard band. Geometry elsewhere on the floor cannot
    invalidate the area. Binding status compares the private millimeter
    components with an explicit tolerance when the exact digest changes.
    """
    return _local_geometry_fingerprint(*_area_geometry_components(floor_plan, circles))


def _hash_only_area_geometry_fingerprint(
    floor_plan: FloorPlan, circles: Sequence[Mapping[str, Any]]
) -> str:
    """Reproduce the short-lived hash-only v2 signature for safe migration."""
    normalized = _validate_area_circles(floor_plan, circles)
    ordered = sorted(
        (
            float(circle["x"]),
            float(circle["y"]),
            float(circle["radius"]),
        )
        for circle in normalized
    )
    neighborhood = (
        min(x - radius for x, _y, radius in ordered) - _LOCAL_GEOMETRY_MARGIN_METERS,
        min(y - radius for _x, y, radius in ordered) - _LOCAL_GEOMETRY_MARGIN_METERS,
        max(x + radius for x, _y, radius in ordered) + _LOCAL_GEOMETRY_MARGIN_METERS,
        max(y + radius for _x, y, radius in ordered) + _LOCAL_GEOMETRY_MARGIN_METERS,
    )
    room_boundaries = tuple(
        [list(point) for point in room.boundary] for room in floor_plan.rooms
    )
    segments: set[_LocalSegment] = set()
    for room in floor_plan.rooms:
        boundary = room.boundary
        for start, end in zip(boundary, (*boundary[1:], boundary[0]), strict=True):
            clipped = _clip_segment(start, end, neighborhood)
            if clipped is None:
                continue
            first = (
                _quantize(clipped[0][0], _LEGACY_LOCAL_UNITS_PER_METER),
                _quantize(clipped[0][1], _LEGACY_LOCAL_UNITS_PER_METER),
            )
            second = (
                _quantize(clipped[1][0], _LEGACY_LOCAL_UNITS_PER_METER),
                _quantize(clipped[1][1], _LEGACY_LOCAL_UNITS_PER_METER),
            )
            if second < first:
                first, second = second, first
            segments.add((*first, *second))

    digest = hashlib.sha256()
    digest.update(_SCOPED_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">H", HASH_ONLY_SCOPED_MAP_BINDING_VERSION))
    digest.update(struct.pack(">I", len(ordered)))
    for x, y, radius in ordered:
        digest.update(
            struct.pack(
                ">qqq",
                _quantize_coordinate(x),
                _quantize_coordinate(y),
                _quantize_coordinate(radius),
            )
        )
        probe_radius = radius + _LOCAL_GEOMETRY_MARGIN_METERS
        diagonal = probe_radius / math.sqrt(2)
        probes = (
            (x, y),
            (x - probe_radius, y),
            (x + probe_radius, y),
            (x, y - probe_radius),
            (x, y + probe_radius),
            (x - diagonal, y - diagonal),
            (x - diagonal, y + diagonal),
            (x + diagonal, y - diagonal),
            (x + diagonal, y + diagonal),
        )
        occupancy = sum(
            int(_point_in_floor(probe_x, probe_y, room_boundaries)) << index
            for index, (probe_x, probe_y) in enumerate(probes)
        )
        digest.update(struct.pack(">H", occupancy))
    digest.update(struct.pack(">I", len(segments)))
    for segment in sorted(segments):
        digest.update(struct.pack(">qqqq", *segment))
    return digest.hexdigest()


def _area_geometry_components(
    floor_plan: FloorPlan, circles: Sequence[Mapping[str, Any]]
) -> _LocalGeometry:
    """Return canonical private area shape, occupancy, and nearby segments."""
    normalized = _validate_area_circles(floor_plan, circles)
    ordered_float = sorted(
        (
            float(circle["x"]),
            float(circle["y"]),
            float(circle["radius"]),
        )
        for circle in normalized
    )
    shape = tuple(
        (
            _quantize_coordinate(x),
            _quantize_coordinate(y),
            _quantize_coordinate(radius),
        )
        for x, y, radius in ordered_float
    )
    neighborhoods = tuple(
        (
            x
            - radius
            - _LOCAL_GEOMETRY_MARGIN_METERS
            - _LOCAL_GEOMETRY_TOLERANCE_METERS,
            y
            - radius
            - _LOCAL_GEOMETRY_MARGIN_METERS
            - _LOCAL_GEOMETRY_TOLERANCE_METERS,
            x
            + radius
            + _LOCAL_GEOMETRY_MARGIN_METERS
            + _LOCAL_GEOMETRY_TOLERANCE_METERS,
            y
            + radius
            + _LOCAL_GEOMETRY_MARGIN_METERS
            + _LOCAL_GEOMETRY_TOLERANCE_METERS,
        )
        for x, y, radius in ordered_float
    )
    room_boundaries = tuple(
        [list(point) for point in room.boundary] for room in floor_plan.rooms
    )

    segments: set[_LocalSegment] = set()
    for room in floor_plan.rooms:
        boundary = room.boundary
        for start, end in zip(boundary, (*boundary[1:], boundary[0]), strict=True):
            for neighborhood in neighborhoods:
                if _clip_segment(start, end, neighborhood) is None:
                    continue
                first = (
                    _quantize_coordinate(start[0]),
                    _quantize_coordinate(start[1]),
                )
                second = (
                    _quantize_coordinate(end[0]),
                    _quantize_coordinate(end[1]),
                )
                if second < first:
                    first, second = second, first
                segments.add((*first, *second))

    occupancy_values = []
    for x, y, radius in ordered_float:
        probe_radius = radius + _LOCAL_GEOMETRY_MARGIN_METERS
        diagonal = probe_radius / math.sqrt(2)
        probes = (
            (x, y),
            (x - probe_radius, y),
            (x + probe_radius, y),
            (x, y - probe_radius),
            (x, y + probe_radius),
            (x - diagonal, y - diagonal),
            (x - diagonal, y + diagonal),
            (x + diagonal, y - diagonal),
            (x + diagonal, y + diagonal),
        )
        occupancy = sum(
            int(_point_in_floor(probe_x, probe_y, room_boundaries)) << index
            for index, (probe_x, probe_y) in enumerate(probes)
        )
        occupancy_values.append(occupancy)
    return shape, tuple(occupancy_values), tuple(sorted(segments))


def _area_shape_fingerprint(shape: _AreaShape) -> str:
    """Fingerprint the immutable saved circles independently of the map."""
    digest = hashlib.sha256()
    digest.update(_AREA_SHAPE_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">I", len(shape)))
    for circle in shape:
        digest.update(struct.pack(">qqq", *circle))
    return digest.hexdigest()


def _local_geometry_fingerprint(
    shape: _AreaShape,
    occupancy: Sequence[int],
    segments: Sequence[_LocalSegment],
) -> str:
    """Fingerprint exact private components while retaining tolerant evidence."""
    digest = hashlib.sha256()
    digest.update(_SCOPED_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">H", SCOPED_MAP_BINDING_VERSION))
    digest.update(bytes.fromhex(_area_shape_fingerprint(shape)))
    digest.update(struct.pack(">I", len(occupancy)))
    for value in occupancy:
        digest.update(struct.pack(">H", value))
    digest.update(struct.pack(">I", len(segments)))
    for segment in segments:
        digest.update(struct.pack(">qqqq", *segment))
    return digest.hexdigest()


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
        current = _floor_plan_binding(floor_plan)
    except OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID

    if saved["mission_id"] != current["mission_id"]:
        return AreaBindingStatus.MISSION_CHANGED
    if saved["partition_id"] != current["partition_id"]:
        return AreaBindingStatus.PARTITION_CHANGED
    saved_geometry = str(saved["geometry_sha256"]).casefold()
    if saved["version"] == MAP_BINDING_VERSION:
        if saved_geometry != current["geometry_sha256"]:
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.CURRENT
    if saved["version"] == HASH_ONLY_SCOPED_MAP_BINDING_VERSION:
        try:
            local_geometry = _hash_only_area_geometry_fingerprint(
                floor_plan, area["circles"]
            )
        except KeyError, OverflowError, TypeError, ValueError:
            return AreaBindingStatus.INVALID
        if str(saved["local_geometry_sha256"]).casefold() == local_geometry:
            return AreaBindingStatus.CURRENT
        if saved_geometry != current["geometry_sha256"]:
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.INVALID

    try:
        shape, occupancy, segments = _area_geometry_components(
            floor_plan, area["circles"]
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if str(saved["area_shape_sha256"]).casefold() != _area_shape_fingerprint(shape):
        return AreaBindingStatus.INVALID
    local_geometry = _local_geometry_fingerprint(shape, occupancy, segments)
    if str(saved["local_geometry_sha256"]).casefold() == local_geometry:
        return AreaBindingStatus.CURRENT
    saved_segments = tuple(tuple(segment) for segment in saved["local_segments_mm"])
    if _local_segments_match(saved_segments, segments, shape):
        return AreaBindingStatus.CURRENT
    if saved_geometry != current["geometry_sha256"]:
        return AreaBindingStatus.GEOMETRY_CHANGED
    return AreaBindingStatus.INVALID


def area_binding_allows_review(area: Mapping[str, Any], floor_plan: FloorPlan) -> bool:
    """Return whether stale coordinates can be shown for local confirmation."""
    if area_binding_status(area, floor_plan) is not AreaBindingStatus.GEOMETRY_CHANGED:
        return False
    try:
        _validate_area_circles(floor_plan, area["circles"])
    except KeyError, TypeError, ValueError:
        return False
    return True


def _valid_saved_binding(binding: Mapping[str, Any]) -> bool:
    """Return whether a persisted binding has the exact supported shape."""
    base_fields = {
        "version",
        "mission_id",
        "partition_id",
        "geometry_sha256",
    }
    version = binding.get("version")
    if isinstance(version, bool) or not isinstance(version, int):
        return False
    if version == MAP_BINDING_VERSION:
        expected_fields = base_fields
    elif version == HASH_ONLY_SCOPED_MAP_BINDING_VERSION:
        expected_fields = {*base_fields, "local_geometry_sha256"}
    else:
        expected_fields = {
            *base_fields,
            "area_shape_sha256",
            "local_geometry_sha256",
            "local_occupancy",
            "local_segments_mm",
        }
    if set(binding) != expected_fields:
        return False
    mission_id = binding["mission_id"]
    partition_id = binding["partition_id"]
    geometry = binding["geometry_sha256"]
    return (
        version
        in {
            MAP_BINDING_VERSION,
            HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            SCOPED_MAP_BINDING_VERSION,
        }
        and not isinstance(mission_id, bool)
        and isinstance(mission_id, int)
        and 0 <= mission_id <= 0xFFFFFFFF
        and isinstance(partition_id, str)
        and bool(partition_id)
        and isinstance(geometry, str)
        and len(geometry) == 64
        and all(character in "0123456789abcdefABCDEF" for character in geometry)
        and (
            version == MAP_BINDING_VERSION
            or (
                version == HASH_ONLY_SCOPED_MAP_BINDING_VERSION
                and _valid_digest(binding["local_geometry_sha256"])
            )
            or (
                version == SCOPED_MAP_BINDING_VERSION
                and _valid_digest(binding["area_shape_sha256"])
                and _valid_digest(binding["local_geometry_sha256"])
                and _valid_local_occupancy(binding["local_occupancy"])
                and _valid_local_segments(binding["local_segments_mm"])
                and _stored_local_geometry_is_intact(binding)
            )
        )
    )


def _valid_digest(value: Any) -> bool:
    """Return whether a stored SHA-256 digest is canonicalizable."""
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdefABCDEF" for character in value)
    )


def _valid_local_occupancy(value: Any) -> bool:
    """Return whether saved occupancy probes have their bounded list shape."""
    return isinstance(value, list) and all(
        not isinstance(item, bool) and isinstance(item, int) and 0 <= item < 1 << 9
        for item in value
    )


def _valid_local_segments(value: Any) -> bool:
    """Return whether saved millimeter segments have a bounded numeric shape."""
    return isinstance(value, list) and all(
        isinstance(segment, list)
        and len(segment) == 4
        and all(
            not isinstance(coordinate, bool)
            and isinstance(coordinate, int)
            and _MIN_SIGNED_64 <= coordinate <= _MAX_SIGNED_64
            for coordinate in segment
        )
        for segment in value
    )


def _stored_local_geometry_is_intact(binding: Mapping[str, Any]) -> bool:
    """Verify that the private tolerant evidence still matches its digest."""
    shape_digest = str(binding["area_shape_sha256"]).casefold()
    digest = hashlib.sha256()
    digest.update(_SCOPED_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">H", SCOPED_MAP_BINDING_VERSION))
    digest.update(bytes.fromhex(shape_digest))
    occupancy = binding["local_occupancy"]
    digest.update(struct.pack(">I", len(occupancy)))
    for value in occupancy:
        digest.update(struct.pack(">H", value))
    segments = binding["local_segments_mm"]
    digest.update(struct.pack(">I", len(segments)))
    for segment in segments:
        digest.update(struct.pack(">qqqq", *segment))
    return digest.hexdigest() == str(binding["local_geometry_sha256"]).casefold()


def _local_segments_match(
    saved: Sequence[_LocalSegment],
    current: Sequence[_LocalSegment],
    shape: _AreaShape,
) -> bool:
    """Find a tolerant one-to-one match for all semantically local segments.

    Segments in the 10 mm selection guard band may appear or disappear without
    invalidating an area, but a segment touching the original 25 cm
    neighborhood must be covered. Minimum-cost maximum matching avoids a
    first-fit choice consuming the wrong nearby segment.
    """
    saved_local = tuple(_segment_intersects_area(segment, shape) for segment in saved)
    current_local = tuple(
        _segment_intersects_area(segment, shape) for segment in current
    )
    node_count = len(saved) + len(current) + 2
    source = node_count - 2
    sink = node_count - 1
    graph: list[list[list[int]]] = [[] for _ in range(node_count)]

    for index, is_local in enumerate(saved_local):
        _add_flow_edge(graph, source, index, -int(is_local))
    for saved_index, saved_segment in enumerate(saved):
        for current_index, current_segment in enumerate(current):
            if _local_segment_geometries_match(saved_segment, current_segment, shape):
                _add_flow_edge(graph, saved_index, len(saved) + current_index, 0)
    for index, is_local in enumerate(current_local):
        _add_flow_edge(graph, len(saved) + index, sink, -int(is_local))

    required_score = sum(saved_local) + sum(current_local)
    return -_minimum_cost_maximum_flow(graph, source, sink) == required_score


def _segment_intersects_area(segment: _LocalSegment, shape: _AreaShape) -> bool:
    """Return whether a segment touches the original semantic neighborhood."""
    margin = round(_LOCAL_GEOMETRY_MARGIN_METERS * _MILLIMETERS_PER_METER)
    start = (segment[0], segment[1])
    end = (segment[2], segment[3])
    return any(
        _clip_segment(
            start,
            end,
            (
                center_x - radius - margin,
                center_y - radius - margin,
                center_x + radius + margin,
                center_y + radius + margin,
            ),
        )
        is not None
        for center_x, center_y, radius in shape
    )


def _local_segment_geometries_match(
    saved: _LocalSegment, current: _LocalSegment, shape: _AreaShape
) -> bool:
    """Compare source walls inside local guard boxes without clip artifacts."""
    margin = round(
        (_LOCAL_GEOMETRY_MARGIN_METERS + _LOCAL_GEOMETRY_TOLERANCE_METERS)
        * _MILLIMETERS_PER_METER
    )
    saved_start = (saved[0], saved[1])
    saved_end = (saved[2], saved[3])
    current_start = (current[0], current[1])
    current_end = (current[2], current[3])
    compared = False
    for center_x, center_y, radius in shape:
        bounds = (
            center_x - radius - margin,
            center_y - radius - margin,
            center_x + radius + margin,
            center_y + radius + margin,
        )
        saved_piece = _clip_segment(saved_start, saved_end, bounds)
        current_piece = _clip_segment(current_start, current_end, bounds)
        if saved_piece is None and current_piece is None:
            continue
        if saved_piece is None or current_piece is None:
            return False
        compared = True
        if not all(
            _point_near_supporting_line(point, current_start, current_end)
            for point in saved_piece
        ) or not all(
            _point_near_supporting_line(point, saved_start, saved_end)
            for point in current_piece
        ):
            return False

    if not compared:
        return False
    saved_local_endpoints = tuple(
        point
        for point in (saved_start, saved_end)
        if _point_intersects_area(point, shape)
    )
    current_local_endpoints = tuple(
        point
        for point in (current_start, current_end)
        if _point_intersects_area(point, shape)
    )
    return _endpoints_covered(saved_local_endpoints, (current_start, current_end)) and (
        _endpoints_covered(current_local_endpoints, (saved_start, saved_end))
    )


def _point_near_supporting_line(
    point: tuple[float, float],
    line_start: tuple[int, int],
    line_end: tuple[int, int],
) -> bool:
    """Return whether a point is within tolerance of an infinite source line."""
    delta_x = line_end[0] - line_start[0]
    delta_y = line_end[1] - line_start[1]
    length_squared = delta_x * delta_x + delta_y * delta_y
    if not length_squared:
        return _points_within_tolerance(point, line_start)
    cross = delta_x * (point[1] - line_start[1]) - delta_y * (point[0] - line_start[0])
    tolerance = _LOCAL_GEOMETRY_TOLERANCE_MILLIMETERS
    return cross * cross <= tolerance * tolerance * length_squared


def _point_intersects_area(point: tuple[int, int], shape: _AreaShape) -> bool:
    """Return whether an original source endpoint is semantically local."""
    margin = round(_LOCAL_GEOMETRY_MARGIN_METERS * _MILLIMETERS_PER_METER)
    return any(
        center_x - radius - margin <= point[0] <= center_x + radius + margin
        and center_y - radius - margin <= point[1] <= center_y + radius + margin
        for center_x, center_y, radius in shape
    )


def _endpoints_covered(
    required: Sequence[tuple[int, int]], candidates: Sequence[tuple[int, int]]
) -> bool:
    """Return whether every local source endpoint has a tolerant counterpart."""
    return all(
        any(_points_within_tolerance(point, candidate) for candidate in candidates)
        for point in required
    )


def _points_within_tolerance(
    first: tuple[float, float], second: tuple[int, int]
) -> bool:
    """Return whether both point coordinates differ by at most 10 mm."""
    return all(
        abs(saved - current) <= _LOCAL_GEOMETRY_TOLERANCE_MILLIMETERS
        for saved, current in zip(first, second, strict=True)
    )


def _add_flow_edge(
    graph: list[list[list[int]]], source: int, target: int, cost: int
) -> None:
    """Add one unit-capacity edge and its residual reverse edge."""
    graph[source].append([target, len(graph[target]), 1, cost])
    graph[target].append([source, len(graph[source]) - 1, 0, -cost])


def _minimum_cost_maximum_flow(
    graph: list[list[list[int]]], source: int, sink: int
) -> int:
    """Return the cost of a unit-capacity minimum-cost maximum flow."""
    total_cost = 0
    while True:
        distances: list[int | None] = [None] * len(graph)
        previous_nodes = [-1] * len(graph)
        previous_edges = [-1] * len(graph)
        distances[source] = 0
        queue = deque([source])
        queued = [False] * len(graph)
        queued[source] = True
        while queue:
            node = queue.popleft()
            queued[node] = False
            distance = distances[node]
            assert distance is not None
            for edge_index, edge in enumerate(graph[node]):
                target, _reverse, capacity, cost = edge
                candidate = distance + cost
                target_distance = distances[target]
                if capacity and (
                    target_distance is None or candidate < target_distance
                ):
                    distances[target] = candidate
                    previous_nodes[target] = node
                    previous_edges[target] = edge_index
                    if not queued[target]:
                        queue.append(target)
                        queued[target] = True
        if previous_nodes[sink] == -1:
            return total_cost

        node = sink
        while node != source:
            previous = previous_nodes[node]
            edge = graph[previous][previous_edges[node]]
            edge[2] = 0
            graph[node][edge[1]][2] = 1
            total_cost += edge[3]
            node = previous


def _validate_area_circles(
    floor_plan: FloorPlan, circles: Sequence[Mapping[str, Any]]
) -> list[dict[str, float]]:
    """Validate saved circles against the mapped floor without exposing them."""
    rooms = [
        {
            "room_id": room.id,
            "name": room.name,
            "boundary": [list(point) for point in room.boundary],
        }
        for room in floor_plan.rooms
    ]
    try:
        return MaticAreaSelector({"rooms": rooms})(circles)
    except vol.Invalid as err:
        raise ValueError("area circles are invalid for the mapped floor") from err


def _point_in_floor(
    x: float, y: float, room_boundaries: Sequence[list[list[float]]]
) -> bool:
    """Return whether one probe lies in any mapped room."""
    return any(
        MaticAreaSelector._point_in_polygon(x, y, boundary)
        for boundary in room_boundaries
    )


def _clip_segment(
    start: tuple[float, float],
    end: tuple[float, float],
    bounds: tuple[float, float, float, float],
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    """Clip a line segment to an axis-aligned local area neighborhood."""
    start_x, start_y = start
    delta_x = end[0] - start_x
    delta_y = end[1] - start_y
    minimum_x, minimum_y, maximum_x, maximum_y = bounds
    lower = 0.0
    upper = 1.0
    for direction, offset in (
        (-delta_x, start_x - minimum_x),
        (delta_x, maximum_x - start_x),
        (-delta_y, start_y - minimum_y),
        (delta_y, maximum_y - start_y),
    ):
        if direction == 0:
            if offset < 0:
                return None
            continue
        ratio = offset / direction
        if direction < 0:
            if ratio > upper:
                return None
            lower = max(lower, ratio)
        else:
            if ratio < lower:
                return None
            upper = min(upper, ratio)
    return (
        (start_x + lower * delta_x, start_y + lower * delta_y),
        (start_x + upper * delta_x, start_y + upper * delta_y),
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
    return _quantize(value, _MILLIMETERS_PER_METER)


def _quantize(value: float, units_per_meter: int) -> int:
    """Convert finite meters to a bounded signed integer unit."""
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("room boundary coordinates must be finite")
    scaled = numeric * units_per_meter
    if not math.isfinite(scaled):
        raise ValueError("room boundary coordinate is out of range")
    quantized = math.floor(scaled + 0.5) if scaled >= 0 else math.ceil(scaled - 0.5)
    if not _MIN_SIGNED_64 <= quantized <= _MAX_SIGNED_64:
        raise ValueError("room boundary coordinate is out of range")
    return quantized
