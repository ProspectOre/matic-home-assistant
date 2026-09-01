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

from .area_selector import MaticAreaSelector, _RoomGeometryIndex
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
_COORDINATE_QUANTIZATION_ERROR_MILLIMETERS = 0.5
_SEGMENT_QUANTIZATION_ERROR_MILLIMETERS = math.sqrt(
    2 * _COORDINATE_QUANTIZATION_ERROR_MILLIMETERS**2
)
_NEIGHBORHOOD_QUANTIZATION_ERROR_MILLIMETERS = (
    3 * _COORDINATE_QUANTIZATION_ERROR_MILLIMETERS
)
_SEMANTIC_MARGIN_MILLIMETERS = math.ceil(
    _LOCAL_GEOMETRY_MARGIN_METERS * _MILLIMETERS_PER_METER
    + _NEIGHBORHOOD_QUANTIZATION_ERROR_MILLIMETERS
)
_GUARD_MARGIN_MILLIMETERS = math.ceil(
    (_LOCAL_GEOMETRY_MARGIN_METERS + _LOCAL_GEOMETRY_TOLERANCE_METERS)
    * _MILLIMETERS_PER_METER
    + _NEIGHBORHOOD_QUANTIZATION_ERROR_MILLIMETERS
)
_SPATIAL_INDEX_CELL_MILLIMETERS = 100
_SPATIAL_INDEX_SAMPLE_MILLIMETERS = _SPATIAL_INDEX_CELL_MILLIMETERS // 2
_NEIGHBORHOOD_INDEX_CELL_METERS = 0.5
_MAX_NEIGHBORHOOD_QUERY_CELLS = 4_096
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
_SegmentMatch = tuple[int, int]
_SegmentContext = tuple[
    frozenset[int],
    frozenset[int],
    tuple[tuple[int, int], ...],
    frozenset[tuple[int, int]],
]


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

    mapped_missions = tuple(floor.mission_id for floor in floor_plan.mapped_floors)
    primary_mission = mapped_missions[0] if mapped_missions else floor_plan.mission_id
    assigned_missions = tuple(
        _area_repair_mission(area, mapped_missions, primary_mission)
        for area in areas.values()
    )
    stale_count = sum(
        assigned_mission == floor_plan.mission_id
        and (
            not isinstance(area, Mapping)
            or area_binding_status(area, floor_plan) is not AreaBindingStatus.CURRENT
        )
        for area, assigned_mission in zip(
            areas.values(), assigned_missions, strict=True
        )
    )
    issue_id = _custom_area_floor_issue_id(
        entry_id, floor_plan.mission_id, primary_mission
    )
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
    # A deleted area cannot leave a hidden secondary-floor issue behind. Do
    # not otherwise touch inactive-floor issues: their dismissal and lifecycle
    # must survive carrying the robot to another mapped floor.
    represented_missions = set(assigned_missions)
    for mission_id in mapped_missions:
        if mission_id in {primary_mission, floor_plan.mission_id} or (
            mission_id in represented_missions
        ):
            continue
        ir.async_delete_issue(
            hass,
            DOMAIN,
            _custom_area_issue_id_for_mission(entry_id, mission_id),
        )
    valid_issue_ids = {
        _custom_area_issue_id_for_mission(entry_id, mission_id)
        for mission_id in mapped_missions
        if mission_id != primary_mission
    }
    legacy_id = custom_area_issue_id(entry_id)
    for existing_issue_id in _existing_custom_area_issue_ids(hass, entry_id):
        if existing_issue_id == legacy_id or existing_issue_id in valid_issue_ids:
            continue
        ir.async_delete_issue(hass, DOMAIN, existing_issue_id)
    return stale_count


def _area_repair_mission(
    area: object, mapped_missions: tuple[int, ...], primary_mission: int
) -> int:
    """Assign malformed, retired, and valid areas to one stable repair floor."""
    if isinstance(area, Mapping):
        binding = area.get("map_binding")
        if isinstance(binding, Mapping) and _valid_saved_binding(binding):
            mission_id = binding["mission_id"]
            assert isinstance(mission_id, int) and not isinstance(mission_id, bool)
            if mission_id in mapped_missions:
                return mission_id
    return primary_mission


def _custom_area_issue_id_for_mission(entry_id: str, mission_id: int) -> str:
    """Return a private stable Repair key for one non-primary mapped floor."""
    floor_digest = hashlib.sha256(
        b"matic-custom-area-floor-v1\0"
        + entry_id.encode()
        + b"\0"
        + str(mission_id).encode()
    ).hexdigest()[:12]
    return f"{custom_area_issue_id(entry_id)}_{floor_digest}"


def _custom_area_floor_issue_id(
    entry_id: str, mission_id: int, primary_mission: int
) -> str:
    """Preserve the legacy primary-floor key and scope every other floor."""
    if mission_id == primary_mission:
        return custom_area_issue_id(entry_id)
    return _custom_area_issue_id_for_mission(entry_id, mission_id)


def _existing_custom_area_issue_ids(hass: HomeAssistant, entry_id: str) -> set[str]:
    """Return this entry's privacy-safe legacy and floor-scoped issue keys."""
    legacy_id = custom_area_issue_id(entry_id)
    registry_issues = getattr(ir.async_get(hass), "issues", {})
    return {
        issue_id
        for domain, issue_id in registry_issues
        if domain == DOMAIN
        and (issue_id == legacy_id or issue_id.startswith(f"{legacy_id}_"))
    }


@callback
def async_delete_custom_area_issue(
    hass: HomeAssistant,
    entry_id: str,
) -> None:
    """Delete the stale-area Repair when its config entry is removed."""
    legacy_id = custom_area_issue_id(entry_id)
    issue_ids = _existing_custom_area_issue_ids(hass, entry_id)
    issue_ids.add(legacy_id)
    for issue_id in issue_ids:
        ir.async_delete_issue(hass, DOMAIN, issue_id)


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
        probes = _occupancy_probes(x, y, radius)
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
    floor_plan: FloorPlan,
    circles: Sequence[Mapping[str, Any]],
    *,
    center_tolerance: float = 0.0,
) -> _LocalGeometry:
    """Return canonical private area shape, occupancy, and nearby segments."""
    rooms = [
        {
            "room_id": room.id,
            "name": room.name,
            "boundary": [list(point) for point in room.boundary],
        }
        for room in floor_plan.rooms
    ]
    room_geometry = _RoomGeometryIndex(rooms)
    normalized = _validate_area_circles(
        floor_plan,
        circles,
        center_tolerance=center_tolerance,
        room_geometry=room_geometry,
    )
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
    neighborhood_index: dict[tuple[int, int], set[int]] = {}
    for index, neighborhood in enumerate(neighborhoods):
        first_x = math.floor(neighborhood[0] / _NEIGHBORHOOD_INDEX_CELL_METERS)
        first_y = math.floor(neighborhood[1] / _NEIGHBORHOOD_INDEX_CELL_METERS)
        last_x = math.floor(neighborhood[2] / _NEIGHBORHOOD_INDEX_CELL_METERS)
        last_y = math.floor(neighborhood[3] / _NEIGHBORHOOD_INDEX_CELL_METERS)
        for cell_x in range(first_x, last_x + 1):
            for cell_y in range(first_y, last_y + 1):
                neighborhood_index.setdefault((cell_x, cell_y), set()).add(index)

    segments: list[_LocalSegment] = []
    for room in floor_plan.rooms:
        boundary = room.boundary
        for start, end in zip(boundary, (*boundary[1:], boundary[0]), strict=True):
            first_x = math.floor(
                min(start[0], end[0]) / _NEIGHBORHOOD_INDEX_CELL_METERS
            )
            first_y = math.floor(
                min(start[1], end[1]) / _NEIGHBORHOOD_INDEX_CELL_METERS
            )
            last_x = math.floor(max(start[0], end[0]) / _NEIGHBORHOOD_INDEX_CELL_METERS)
            last_y = math.floor(max(start[1], end[1]) / _NEIGHBORHOOD_INDEX_CELL_METERS)
            cell_count = (last_x - first_x + 1) * (last_y - first_y + 1)
            candidate_neighborhoods = (
                range(len(neighborhoods))
                if cell_count > _MAX_NEIGHBORHOOD_QUERY_CELLS
                else {
                    neighborhood
                    for cell_x in range(first_x, last_x + 1)
                    for cell_y in range(first_y, last_y + 1)
                    for neighborhood in neighborhood_index.get((cell_x, cell_y), ())
                }
            )
            if not any(
                _clip_segment(start, end, neighborhoods[index]) is not None
                for index in candidate_neighborhoods
            ):
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
            segments.append((*first, *second))

    occupancy_values = []
    for x, y, radius in ordered_float:
        probes = _occupancy_probes(x, y, radius)
        occupancy = sum(
            int(room_geometry.contains(probe_x, probe_y)) << index
            for index, (probe_x, probe_y) in enumerate(probes)
        )
        occupancy_values.append(occupancy)
    return shape, tuple(occupancy_values), tuple(sorted(segments))


def _occupancy_probes(
    x: float, y: float, radius: float
) -> tuple[tuple[float, float], ...]:
    """Return the exact floating-point probes used by occupancy evidence."""
    probe_radius = radius + _LOCAL_GEOMETRY_MARGIN_METERS
    diagonal = probe_radius / math.sqrt(2)
    return (
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
            floor_plan,
            area["circles"],
            center_tolerance=_LOCAL_GEOMETRY_TOLERANCE_METERS,
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if str(saved["area_shape_sha256"]).casefold() != _area_shape_fingerprint(shape):
        return AreaBindingStatus.INVALID
    local_geometry = _local_geometry_fingerprint(shape, occupancy, segments)
    if str(saved["local_geometry_sha256"]).casefold() == local_geometry:
        return AreaBindingStatus.CURRENT
    saved_segments = tuple(tuple(segment) for segment in saved["local_segments_mm"])
    saved_occupancy = tuple(saved["local_occupancy"])
    segment_matches = _local_segment_correspondence(saved_segments, segments, shape)
    if segment_matches is not None and (
        saved_occupancy == occupancy
        or _occupancy_changes_are_explained(
            saved_occupancy,
            occupancy,
            saved_segments,
            segments,
            shape,
            area["circles"],
            segment_matches,
        )
    ):
        return AreaBindingStatus.CURRENT
    if saved_geometry != current["geometry_sha256"]:
        return AreaBindingStatus.GEOMETRY_CHANGED
    return AreaBindingStatus.INVALID


def area_binding_allows_review(
    area: Mapping[str, Any],
    floor_plan: FloorPlan,
    *,
    status: AreaBindingStatus | None = None,
) -> bool:
    """Return whether stale coordinates can be shown for local confirmation."""
    binding_status = (
        status if status is not None else area_binding_status(area, floor_plan)
    )
    if binding_status is not AreaBindingStatus.GEOMETRY_CHANGED:
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
    """Return whether all semantically local walls have a correspondence."""
    return _local_segment_correspondence(saved, current, shape) is not None


def _local_segment_correspondence(
    saved: Sequence[_LocalSegment],
    current: Sequence[_LocalSegment],
    shape: _AreaShape,
) -> tuple[_SegmentMatch, ...] | None:
    """Find a tolerant one-to-one match for all semantically local segments.

    Segments in the 10 mm selection guard band may appear or disappear without
    invalidating an area, but a segment touching the original 25 cm
    neighborhood must be covered. Minimum-cost maximum matching avoids a
    first-fit choice consuming the wrong nearby segment.
    """
    saved_contexts = tuple(_segment_context(segment, shape) for segment in saved)
    current_contexts = tuple(_segment_context(segment, shape) for segment in current)
    saved_local = tuple(bool(context[0]) for context in saved_contexts)
    current_local = tuple(bool(context[0]) for context in current_contexts)
    current_by_cell: dict[tuple[int, int], list[int]] = {}
    for current_index, context in enumerate(current_contexts):
        for cell in context[3]:
            current_by_cell.setdefault(cell, []).append(current_index)

    compatible: list[tuple[int, int, int]] = []
    maximum_pair_cost = 0
    for saved_index, (saved_segment, saved_context) in enumerate(
        zip(saved, saved_contexts, strict=True)
    ):
        candidates = {
            current_index
            for cell_x, cell_y in saved_context[3]
            for neighbor_x in range(cell_x - 1, cell_x + 2)
            for neighbor_y in range(cell_y - 1, cell_y + 2)
            for current_index in current_by_cell.get((neighbor_x, neighbor_y), ())
        }
        for current_index in candidates:
            if _local_segment_contexts_match(
                saved_segment,
                saved_context,
                current[current_index],
                current_contexts[current_index],
                shape,
            ):
                pair_cost = _segment_pair_cost(saved_segment, current[current_index])
                compatible.append((saved_index, current_index, pair_cost))
                maximum_pair_cost = max(maximum_pair_cost, pair_cost)

    node_count = len(saved) + len(current) + 2
    source = node_count - 2
    sink = node_count - 1
    graph: list[list[list[int]]] = [[] for _ in range(node_count)]
    local_reward = maximum_pair_cost * (min(len(saved), len(current)) + 1) + 1

    for index, is_local in enumerate(saved_local):
        _add_flow_edge(graph, source, index, -local_reward * int(is_local))
    for saved_index, current_index, pair_cost in compatible:
        _add_flow_edge(graph, saved_index, len(saved) + current_index, pair_cost)
    for index, is_local in enumerate(current_local):
        _add_flow_edge(
            graph,
            len(saved) + index,
            sink,
            -local_reward * int(is_local),
        )

    _minimum_cost_maximum_flow(graph, source, sink, stop_at_nonnegative=True)
    matches = tuple(
        (saved_index, edge[0] - len(saved))
        for saved_index in range(len(saved))
        for edge in graph[saved_index]
        if len(saved) <= edge[0] < len(saved) + len(current) and edge[2] == 0
    )
    required_score = sum(saved_local) + sum(current_local)
    matched_score = sum(
        int(saved_local[saved_index]) + int(current_local[current_index])
        for saved_index, current_index in matches
    )
    return matches if matched_score == required_score else None


def _segment_pair_cost(saved: _LocalSegment, current: _LocalSegment) -> int:
    """Return the endpoint distance for the closer wall orientation."""
    direct = sum(abs(saved[index] - current[index]) for index in range(4))
    reversed_current = (current[2], current[3], current[0], current[1])
    reverse = sum(abs(saved[index] - reversed_current[index]) for index in range(4))
    return min(direct, reverse)


def _occupancy_changes_are_explained(
    saved_occupancy: Sequence[int],
    current_occupancy: Sequence[int],
    saved_segments: Sequence[_LocalSegment],
    current_segments: Sequence[_LocalSegment],
    shape: _AreaShape,
    circles: Sequence[Mapping[str, Any]],
    segment_matches: Sequence[_SegmentMatch] | None = None,
) -> bool:
    """Return whether every changed probe is explained by a moving wall pair."""
    ordered_circles = sorted(
        (
            float(circle["x"]),
            float(circle["y"]),
            float(circle["radius"]),
        )
        for circle in circles
    )
    if (
        len(saved_occupancy) != len(shape)
        or len(current_occupancy) != len(shape)
        or len(ordered_circles) != len(shape)
    ):
        return False

    saved_contexts = tuple(
        _segment_context(segment, shape) for segment in saved_segments
    )
    current_contexts = tuple(
        _segment_context(segment, shape) for segment in current_segments
    )
    if segment_matches is None:
        segment_matches = _local_segment_correspondence(
            saved_segments, current_segments, shape
        )
        if segment_matches is None:
            return False
    matches_by_cell: dict[tuple[int, int], set[_SegmentMatch]] = {}
    for match in segment_matches:
        saved_index, current_index = match
        cells = saved_contexts[saved_index][3] | current_contexts[current_index][3]
        for cell in cells:
            matches_by_cell.setdefault(cell, set()).add(match)

    for (
        (x, y, radius),
        saved_value,
        current_value,
    ) in zip(ordered_circles, saved_occupancy, current_occupancy, strict=True):
        changed = saved_value ^ current_value
        if not changed:
            continue
        probes = tuple(
            (probe_x * _MILLIMETERS_PER_METER, probe_y * _MILLIMETERS_PER_METER)
            for probe_x, probe_y in _occupancy_probes(x, y, radius)
        )
        for probe_index, probe in enumerate(probes):
            if not changed & (1 << probe_index):
                continue
            probe_cell_x = math.floor(probe[0] / _SPATIAL_INDEX_CELL_MILLIMETERS)
            probe_cell_y = math.floor(probe[1] / _SPATIAL_INDEX_CELL_MILLIMETERS)
            candidates = {
                match
                for cell_x in range(probe_cell_x - 1, probe_cell_x + 2)
                for cell_y in range(probe_cell_y - 1, probe_cell_y + 2)
                for match in matches_by_cell.get((cell_x, cell_y), ())
            }
            if not any(
                _wall_pair_explains_probe(
                    saved_segments[saved_index],
                    saved_contexts[saved_index],
                    current_segments[current_index],
                    current_contexts[current_index],
                    probe,
                    shape,
                )
                for saved_index, current_index in candidates
            ):
                return False
    return True


def _wall_pair_explains_probe(
    saved: _LocalSegment,
    saved_context: _SegmentContext,
    current: _LocalSegment,
    current_context: _SegmentContext,
    probe: tuple[float, float],
    shape: _AreaShape,
) -> bool:
    """Return whether one compatible wall pair can cross an occupancy probe."""
    if not _point_near_segment(probe, saved) or not _point_near_segment(probe, current):
        return False
    if not _local_segment_contexts_match(
        saved, saved_context, current, current_context, shape
    ):
        return False
    saved_distance = _signed_distance_to_supporting_line(probe, saved)
    current_distance = _signed_distance_to_supporting_line(probe, current)
    if saved_distance is None or current_distance is None:
        return False
    if saved == current:
        return abs(saved_distance) <= _SEGMENT_QUANTIZATION_ERROR_MILLIMETERS
    saved_direction = (saved[2] - saved[0], saved[3] - saved[1])
    current_direction = (current[2] - current[0], current[3] - current[1])
    if (
        saved_direction[0] * current_direction[0]
        + saved_direction[1] * current_direction[1]
        < 0
    ):
        current_distance = -current_distance
    return (
        saved_distance * current_distance <= 0
        or abs(saved_distance) <= _SEGMENT_QUANTIZATION_ERROR_MILLIMETERS
        or abs(current_distance) <= _SEGMENT_QUANTIZATION_ERROR_MILLIMETERS
    )


def _signed_distance_to_supporting_line(
    point: tuple[float, float], segment: _LocalSegment
) -> float | None:
    """Return an oriented point-to-source-wall distance."""
    start_x, start_y, end_x, end_y = segment
    delta_x = end_x - start_x
    delta_y = end_y - start_y
    length = math.hypot(delta_x, delta_y)
    if not length:
        return None
    return (delta_x * (point[1] - start_y) - delta_y * (point[0] - start_x)) / length


def _segment_context(segment: _LocalSegment, shape: _AreaShape) -> _SegmentContext:
    """Precompute the local neighborhoods and endpoints for one source wall."""
    start = (segment[0], segment[1])
    end = (segment[2], segment[3])
    semantic: set[int] = set()
    guard: set[int] = set()
    guard_pieces: list[tuple[tuple[float, float], tuple[float, float]]] = []
    local_endpoints: set[tuple[int, int]] = set()
    for index, (center_x, center_y, radius) in enumerate(shape):
        semantic_bounds = (
            center_x - radius - _SEMANTIC_MARGIN_MILLIMETERS,
            center_y - radius - _SEMANTIC_MARGIN_MILLIMETERS,
            center_x + radius + _SEMANTIC_MARGIN_MILLIMETERS,
            center_y + radius + _SEMANTIC_MARGIN_MILLIMETERS,
        )
        if _clip_segment(start, end, semantic_bounds) is not None:
            semantic.add(index)
        for point in (start, end):
            if (
                semantic_bounds[0] <= point[0] <= semantic_bounds[2]
                and semantic_bounds[1] <= point[1] <= semantic_bounds[3]
            ):
                local_endpoints.add(point)
        guard_bounds = (
            center_x - radius - _GUARD_MARGIN_MILLIMETERS,
            center_y - radius - _GUARD_MARGIN_MILLIMETERS,
            center_x + radius + _GUARD_MARGIN_MILLIMETERS,
            center_y + radius + _GUARD_MARGIN_MILLIMETERS,
        )
        guard_piece = _clip_segment(start, end, guard_bounds)
        if guard_piece is not None:
            guard.add(index)
            guard_pieces.append(guard_piece)
    return (
        frozenset(semantic),
        frozenset(guard),
        tuple(sorted(local_endpoints)),
        _segment_spatial_cells(start, end, guard_pieces),
    )


def _segment_spatial_cells(
    start: tuple[int, int],
    end: tuple[int, int],
    pieces: Sequence[tuple[tuple[float, float], tuple[float, float]]],
) -> frozenset[tuple[int, int]]:
    """Index the union of guard-clipped wall intervals into fixed cells."""
    delta_x = end[0] - start[0]
    delta_y = end[1] - start[1]
    length_squared = delta_x * delta_x + delta_y * delta_y
    if not length_squared:
        return frozenset(
            {
                (
                    math.floor(start[0] / _SPATIAL_INDEX_CELL_MILLIMETERS),
                    math.floor(start[1] / _SPATIAL_INDEX_CELL_MILLIMETERS),
                )
            }
            if pieces
            else set()
        )

    intervals = sorted(
        (
            ((piece[0][0] - start[0]) * delta_x + (piece[0][1] - start[1]) * delta_y)
            / length_squared,
            ((piece[1][0] - start[0]) * delta_x + (piece[1][1] - start[1]) * delta_y)
            / length_squared,
        )
        for piece in pieces
    )
    merged: list[list[float]] = []
    for lower, upper in intervals:
        if merged and lower <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], upper)
        else:
            merged.append([lower, upper])

    cells: set[tuple[int, int]] = set()
    maximum_delta = max(abs(delta_x), abs(delta_y))
    for lower, upper in merged:
        steps = max(
            1,
            math.ceil(
                maximum_delta * (upper - lower) / _SPATIAL_INDEX_SAMPLE_MILLIMETERS
            ),
        )
        for step in range(steps + 1):
            ratio = lower + (upper - lower) * step / steps
            cells.add(
                (
                    math.floor(
                        (start[0] + ratio * delta_x) / _SPATIAL_INDEX_CELL_MILLIMETERS
                    ),
                    math.floor(
                        (start[1] + ratio * delta_y) / _SPATIAL_INDEX_CELL_MILLIMETERS
                    ),
                )
            )
    return frozenset(cells)


def _local_segment_geometries_match(
    saved: _LocalSegment, current: _LocalSegment, shape: _AreaShape
) -> bool:
    """Compare source walls inside local guard boxes without clip artifacts."""
    return _local_segment_contexts_match(
        saved,
        _segment_context(saved, shape),
        current,
        _segment_context(current, shape),
        shape,
    )


def _local_segment_contexts_match(
    saved: _LocalSegment,
    saved_context: _SegmentContext,
    current: _LocalSegment,
    current_context: _SegmentContext,
    shape: _AreaShape,
) -> bool:
    """Compare two walls using their precomputed relevant neighborhoods."""
    saved_semantic, saved_guard, saved_local_endpoints, _saved_cells = saved_context
    current_semantic, current_guard, current_local_endpoints, _current_cells = (
        current_context
    )
    relevant = saved_semantic | current_semantic
    if not relevant or not relevant <= saved_guard & current_guard:
        return False

    saved_start = (saved[0], saved[1])
    saved_end = (saved[2], saved[3])
    current_start = (current[0], current[1])
    current_end = (current[2], current[3])
    for neighborhood in relevant:
        center_x, center_y, radius = shape[neighborhood]
        guard_bounds = (
            center_x - radius - _GUARD_MARGIN_MILLIMETERS,
            center_y - radius - _GUARD_MARGIN_MILLIMETERS,
            center_x + radius + _GUARD_MARGIN_MILLIMETERS,
            center_y + radius + _GUARD_MARGIN_MILLIMETERS,
        )
        saved_piece = _clip_segment(saved_start, saved_end, guard_bounds)
        current_piece = _clip_segment(current_start, current_end, guard_bounds)
        assert saved_piece is not None and current_piece is not None
        if not all(
            _point_near_supporting_line(point, current_start, current_end)
            for point in saved_piece
        ) or not all(
            _point_near_supporting_line(point, saved_start, saved_end)
            for point in current_piece
        ):
            return False

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
    tolerance = (
        _LOCAL_GEOMETRY_TOLERANCE_MILLIMETERS
        + 2 * _SEGMENT_QUANTIZATION_ERROR_MILLIMETERS
    )
    return cross * cross <= tolerance * tolerance * length_squared


def _point_near_segment(point: tuple[float, float], segment: _LocalSegment) -> bool:
    """Return whether a probe is near a millimeter-quantized source wall."""
    start_x, start_y, end_x, end_y = segment
    delta_x = end_x - start_x
    delta_y = end_y - start_y
    length_squared = delta_x * delta_x + delta_y * delta_y
    nearest_x: float
    nearest_y: float
    if not length_squared:
        nearest_x = start_x
        nearest_y = start_y
    else:
        projection = (
            (point[0] - start_x) * delta_x + (point[1] - start_y) * delta_y
        ) / length_squared
        projection = min(1.0, max(0.0, projection))
        nearest_x = start_x + projection * delta_x
        nearest_y = start_y + projection * delta_y
    distance_x = point[0] - nearest_x
    distance_y = point[1] - nearest_y
    tolerance = (
        _LOCAL_GEOMETRY_TOLERANCE_MILLIMETERS + _SEGMENT_QUANTIZATION_ERROR_MILLIMETERS
    )
    return distance_x * distance_x + distance_y * distance_y <= tolerance * tolerance


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
    """Compare endpoint coordinates with the two-wall rounding allowance."""
    tolerance = (
        _LOCAL_GEOMETRY_TOLERANCE_MILLIMETERS
        + 2 * _COORDINATE_QUANTIZATION_ERROR_MILLIMETERS
    )
    return all(
        abs(saved - current) <= tolerance
        for saved, current in zip(first, second, strict=True)
    )


def _add_flow_edge(
    graph: list[list[list[int]]], source: int, target: int, cost: int
) -> None:
    """Add one unit-capacity edge and its residual reverse edge."""
    graph[source].append([target, len(graph[target]), 1, cost])
    graph[target].append([source, len(graph[source]) - 1, 0, -cost])


def _minimum_cost_maximum_flow(
    graph: list[list[list[int]]],
    source: int,
    sink: int,
    *,
    stop_at_nonnegative: bool = False,
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
        sink_distance = distances[sink]
        assert sink_distance is not None
        if stop_at_nonnegative and sink_distance >= 0:
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
    floor_plan: FloorPlan,
    circles: Sequence[Mapping[str, Any]],
    *,
    center_tolerance: float = 0.0,
    room_geometry: _RoomGeometryIndex | None = None,
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
        return MaticAreaSelector({"rooms": rooms}).validate(
            circles,
            center_tolerance=center_tolerance,
            geometry=room_geometry,
        )
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
    count = len(points)
    doubled = points + points
    first = 0
    second = 1
    offset = 0
    while first < count and second < count and offset < count:
        first_value = doubled[first + offset]
        second_value = doubled[second + offset]
        if first_value == second_value:
            offset += 1
            continue
        if first_value > second_value:
            first += offset + 1
            if first <= second:
                first = second + 1
        else:
            second += offset + 1
            if second <= first:
                second = first + 1
        offset = 0
    start = min(first, second)
    return points[start:] + points[:start]


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
