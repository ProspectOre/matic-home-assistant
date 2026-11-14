"""Read and convert area bindings saved before version 7.

0.6 converts each stored binding the first time it verifies on its floor;
until then this module is the only reader of the old records. Versions 3, 4
and 6 have an exact version 7 form and are read through it. Versions 1, 2, 5
and version 3 records saved before 0.5 (no room snapshots, or none at all)
keep their own rules here. 0.3.0 to 0.3.2 wrote version 1, 0.3.3 to 0.4.8
version 3 without room snapshots; 2 and 5 were never released.
"""

from __future__ import annotations

import hashlib
import struct
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from . import area_binding_geometry as geometry
from .area_binding_formats import (
    MAP_BINDING_VERSION,
    AreaBindingStatus,
    valid_digest,
    valid_int64,
    valid_occupancy,
    valid_segments,
)
from .area_geometry import GeometryTooComplex, RoomGeometryIndex
from .client import FloorPlan

_WHOLE_FLOOR = 1
_HASH_ONLY = 2
_SCOPED = 3
_BOUNDED_HASH_ONLY = 4
_ANCHORED_HASH_ONLY = 5
_SHAPE_ANCHORED_HASH_ONLY = 6

_INVARIANT = "translation_invariant_geometry_sha256"
_ANCHORS = "translation_room_anchors"


def exact_binding(binding: Mapping[str, Any]) -> dict[str, Any] | None:
    """Return the version 7 form of a binding that has one exactly.

    Version 4 and 6 bindings and version 3 bindings with complete room
    snapshots read the same under version 7 rules on every floor.
    """
    if not _valid_saved_binding(binding):
        return None
    version = binding["version"]
    identity = {
        "version": MAP_BINDING_VERSION,
        "mission_id": binding["mission_id"],
        "partition_id": binding["partition_id"],
        "geometry_sha256": binding["geometry_sha256"].casefold(),
    }
    if version == _BOUNDED_HASH_ONLY:
        return {
            **identity,
            "local": {"sha256": binding["local_geometry_sha256"].casefold()},
        }
    if version not in {_SCOPED, _SHAPE_ANCHORED_HASH_ONLY} or not _has_snapshots(
        binding
    ):
        return None
    local = (
        {"sha256": binding["local_geometry_sha256"].casefold()}
        if version == _SHAPE_ANCHORED_HASH_ONLY
        else {
            "occupancy": list(binding["local_occupancy"]),
            "segments_mm": [list(segment) for segment in binding["local_segments_mm"]],
        }
    )
    return {
        **identity,
        "local": local,
        "frame": {
            "shape_sha256": binding["area_shape_sha256"].casefold(),
            "floor_sha256": binding[_INVARIANT].casefold(),
            "rooms": _rooms(binding[_ANCHORS]),
        },
    }


def _has_snapshots(binding: Mapping[str, Any]) -> bool:
    anchors = binding.get(_ANCHORS) or ()
    return (
        _INVARIANT in binding
        and bool(anchors)
        and all({"room_key", "boundary_mm"} <= set(anchor) for anchor in anchors)
    )


def _rooms(anchors: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return complete anchors as version 7 room snapshots."""
    return [
        {
            "room_key": anchor["room_key"].casefold(),
            "circle_keys": sorted({key.casefold() for key in anchor["circle_keys"]}),
            "boundary_mm": [list(point) for point in anchor["boundary_mm"]],
        }
        for anchor in anchors
    ]


def drifted_binding(
    area: Mapping[str, Any],
    floor_plan: FloorPlan,
    room_geometry: RoomGeometryIndex,
) -> dict[str, Any] | None:
    """Convert a binding verified CURRENT on a changed map, keeping its evidence.

    A version 3 anchor without a room snapshot takes it from the current room,
    which its status check proved exactly unchanged. A saved snapshot is kept:
    status tolerated its room's edits, and replacing it would rebase the frame.
    """
    binding = area["map_binding"]
    if binding["version"] != _SCOPED or _has_snapshots(binding):
        return exact_binding(binding)
    current = {
        room["room_key"]: room
        for room in geometry._translation_room_anchors(
            floor_plan, area["circles"], room_geometry=room_geometry
        )
    }
    anchors = []
    for anchor in binding[_ANCHORS]:
        if "boundary_mm" in anchor:
            anchors.append(anchor)
            continue
        boundary = current[anchor["room_key"].casefold()]["boundary_mm"]
        # Writers before 0.5 could store a wrong maximum x; the status check
        # matched it exactly, so the snapshot takes the true bounds.
        anchors.append(
            {
                **anchor,
                "boundary_mm": boundary,
                "bounds": geometry.room_bounds(boundary),
            }
        )
    return exact_binding({**binding, _ANCHORS: anchors})


def binding_mission(binding: Mapping[str, Any]) -> int | None:
    """Return the floor a well-formed old binding names."""
    return int(binding["mission_id"]) if _valid_saved_binding(binding) else None


def needs_geometry_index(binding: Mapping[str, Any]) -> bool:
    """Return whether a well-formed old binding performs indexed map queries."""
    return _valid_saved_binding(binding) and binding["version"] != _WHOLE_FLOOR


def room_frame_point_count(binding: Mapping[str, Any]) -> int:
    """Count the room boundary vertices an old binding stores."""
    anchors = binding.get(_ANCHORS)
    if not isinstance(anchors, list):
        return 0
    return sum(
        len(points)
        for anchor in anchors
        if isinstance(anchor, Mapping)
        and isinstance((points := anchor.get("boundary_mm")), list)
    )


def legacy_status(
    area: Mapping[str, Any],
    binding: Mapping[str, Any],
    floor_plan: FloorPlan,
    current: Mapping[str, Any],
    *,
    room_geometry: RoomGeometryIndex | None,
) -> AreaBindingStatus:
    """Compare an old binding without a version 7 form with the floor plan."""
    if not _valid_saved_binding(binding):
        return AreaBindingStatus.INVALID
    if binding["mission_id"] != current["mission_id"]:
        return AreaBindingStatus.MISSION_CHANGED
    version = binding["version"]
    partition_changed = binding["partition_id"] != current["partition_id"]
    geometry_changed = (
        binding["geometry_sha256"].casefold() != current["geometry_sha256"]
    )
    if version in {_WHOLE_FLOOR, _HASH_ONLY} and partition_changed and geometry_changed:
        return AreaBindingStatus.PARTITION_CHANGED
    if version == _WHOLE_FLOOR:
        return (
            AreaBindingStatus.GEOMETRY_CHANGED
            if geometry_changed
            else AreaBindingStatus.CURRENT
        )
    if version == _HASH_ONLY:
        return _hash_only_status(
            area, binding, floor_plan, geometry_changed, room_geometry
        )
    if version == _ANCHORED_HASH_ONLY:
        return _anchored_status(
            area, binding, floor_plan, geometry_changed, room_geometry
        )
    return _scoped_status(
        area,
        binding,
        floor_plan,
        partition_changed=partition_changed,
        geometry_changed=geometry_changed,
        room_geometry=room_geometry,
    )


def _hash_only_status(
    area: Mapping[str, Any],
    binding: Mapping[str, Any],
    floor_plan: FloorPlan,
    geometry_changed: bool,
    room_geometry: RoomGeometryIndex | None,
) -> AreaBindingStatus:
    """Version 2 kept no wall evidence, so any map change needs review."""
    try:
        if geometry_changed:
            geometry._validate_area_circles(
                floor_plan, area["circles"], room_geometry=room_geometry
            )
            return AreaBindingStatus.GEOMETRY_CHANGED
        local = _hash_only_fingerprint(
            floor_plan, area["circles"], room_geometry=room_geometry
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if binding["local_geometry_sha256"].casefold() == local:
        return AreaBindingStatus.CURRENT
    return AreaBindingStatus.INVALID


def _anchored_status(
    area: Mapping[str, Any],
    binding: Mapping[str, Any],
    floor_plan: FloorPlan,
    geometry_changed: bool,
    room_geometry: RoomGeometryIndex | None,
) -> AreaBindingStatus:
    """Version 5 survives a map change only with unchanged walls and frames."""
    try:
        local = geometry.neighbourhood_fingerprint(
            floor_plan,
            area["circles"],
            center_tolerance=geometry._LOCAL_GEOMETRY_TOLERANCE_METERS,
            room_geometry=room_geometry,
        )
    except geometry.NeighbourhoodWorkExhausted:
        return (
            AreaBindingStatus.GEOMETRY_CHANGED
            if geometry_changed
            else AreaBindingStatus.INVALID
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if binding["local_geometry_sha256"].casefold() != local:
        return (
            AreaBindingStatus.GEOMETRY_CHANGED
            if geometry_changed
            else AreaBindingStatus.INVALID
        )
    if not geometry_changed:
        return AreaBindingStatus.CURRENT
    try:
        room_geometry = room_geometry or geometry._room_geometry_index(floor_plan)
        if not geometry._saved_room_frames_match(
            _rooms(binding[_ANCHORS]), area["circles"], floor_plan, room_geometry
        ) or binding[
            _INVARIANT
        ].casefold() == geometry.translation_invariant_geometry_fingerprint(floor_plan):
            return AreaBindingStatus.GEOMETRY_CHANGED
    except GeometryTooComplex, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.GEOMETRY_CHANGED
    return AreaBindingStatus.CURRENT


def _scoped_status(
    area: Mapping[str, Any],
    binding: Mapping[str, Any],
    floor_plan: FloorPlan,
    *,
    partition_changed: bool,
    geometry_changed: bool,
    room_geometry: RoomGeometryIndex | None,
) -> AreaBindingStatus:
    """Version 3 without complete room snapshots."""
    try:
        circles = area["circles"]
        room_geometry = room_geometry or geometry._room_geometry_index(floor_plan)
        shape, occupancy, segments = geometry._area_geometry_components(
            floor_plan,
            circles,
            center_tolerance=geometry._LOCAL_GEOMETRY_TOLERANCE_METERS,
            room_geometry=room_geometry,
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if binding["area_shape_sha256"].casefold() != geometry._area_shape_fingerprint(
        shape
    ):
        return AreaBindingStatus.INVALID
    if geometry_changed:
        verdict = _anchor_frames_status(
            binding, circles, floor_plan, room_geometry, partition_changed
        )
        if verdict is not None:
            return verdict
    if binding["local_geometry_sha256"].casefold() == _scoped_fingerprint(
        geometry._area_shape_fingerprint(shape), occupancy, segments
    ):
        if (
            geometry_changed
            and _INVARIANT in binding
            and binding[_INVARIANT].casefold()
            == geometry.translation_invariant_geometry_fingerprint(floor_plan)
        ):
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.CURRENT
    try:
        if geometry.walls_match(
            tuple(binding["local_occupancy"]),
            tuple(tuple(segment) for segment in binding["local_segments_mm"]),
            shape,
            occupancy,
            segments,
            circles,
            room_geometry,
        ):
            return AreaBindingStatus.CURRENT
    except GeometryTooComplex:
        pass
    return (
        AreaBindingStatus.GEOMETRY_CHANGED
        if geometry_changed
        else AreaBindingStatus.INVALID
    )


def _anchor_frames_status(
    binding: Mapping[str, Any],
    circles: Sequence[Mapping[str, Any]],
    floor_plan: FloorPlan,
    room_geometry: RoomGeometryIndex,
    partition_changed: bool,
) -> AreaBindingStatus | None:
    """Check old room anchors after a map change; None lets walls decide.

    An anchor without a boundary snapshot proves its frame only when the
    room's translation-free shape and absolute bounds are exactly unchanged.
    """
    anchors = binding.get(_ANCHORS)
    if not anchors or any(
        "room_key" not in anchor or "circle_keys" not in anchor for anchor in anchors
    ):
        return AreaBindingStatus.GEOMETRY_CHANGED
    expected = {geometry._translation_circle_key(circle) for circle in circles}
    if {key.casefold() for anchor in anchors for key in anchor["circle_keys"]} != (
        expected
    ):
        return AreaBindingStatus.GEOMETRY_CHANGED
    try:
        current_rooms = geometry._translation_room_anchors(
            floor_plan, circles, room_geometry=room_geometry
        )
    except GeometryTooComplex, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    current = geometry._rooms_by_key(current_rooms)
    saved = Counter(anchor["room_key"].casefold() for anchor in anchors)
    if current is None or max(saved.values()) > 1 or set(saved) != set(current):
        return AreaBindingStatus.GEOMETRY_CHANGED
    needing_witnesses = []
    for anchor in anchors:
        room = current[anchor["room_key"].casefold()]
        if {key.casefold() for key in anchor["circle_keys"]} != set(
            room["circle_keys"]
        ):
            return AreaBindingStatus.GEOMETRY_CHANGED
        try:
            if "boundary_mm" in anchor:
                frame_matches = geometry._room_anchor_bounds_match(
                    anchor, room
                ) and geometry._room_frame_matches(anchor, room, room_geometry)
            else:
                frame_matches = not partition_changed and _unchanged_room(anchor, room)
        except GeometryTooComplex:
            return AreaBindingStatus.GEOMETRY_CHANGED
        if not frame_matches:
            needing_witnesses.append((anchor, room))
    if needing_witnesses and _INVARIANT not in binding:
        return AreaBindingStatus.GEOMETRY_CHANGED
    try:
        for anchor, room in needing_witnesses:
            if not geometry._room_has_strong_frame_witnesses(
                anchor, room, room_geometry
            ):
                return AreaBindingStatus.GEOMETRY_CHANGED
    except GeometryTooComplex:
        return AreaBindingStatus.GEOMETRY_CHANGED
    return None


def _unchanged_room(anchor: Mapping[str, Any], room: Mapping[str, Any]) -> bool:
    """Match a snapshot-free anchor by shape and exact absolute bounds.

    Writers before 0.5 stored the last canonical vertex's x as the maximum x;
    that exact form also matches.
    """
    boundary = room["boundary_mm"]
    bounds = geometry.room_bounds(boundary)
    return anchor["fingerprint"].casefold() == _room_polygon_fingerprint(
        boundary
    ) and anchor["bounds"] in (bounds, [*bounds[:2], boundary[-1][0], bounds[3]])


def _hash_only_fingerprint(
    floor_plan: FloorPlan,
    circles: Sequence[Mapping[str, Any]],
    *,
    room_geometry: RoomGeometryIndex | None = None,
) -> str:
    """Reproduce the version 2 digest of the circles and their walls."""
    room_geometry = room_geometry or geometry._room_geometry_index(floor_plan)
    normalized = geometry._validate_area_circles(
        floor_plan, circles, room_geometry=room_geometry
    )
    ordered = sorted(
        (float(circle["x"]), float(circle["y"]), float(circle["radius"]))
        for circle in normalized
    )
    margin = geometry._LOCAL_GEOMETRY_MARGIN_METERS
    neighborhood = (
        min(x - radius for x, _y, radius in ordered) - margin,
        min(y - radius for _x, y, radius in ordered) - margin,
        max(x + radius for x, _y, radius in ordered) + margin,
        max(y + radius for _x, y, radius in ordered) + margin,
    )
    units = geometry._NEIGHBOURHOOD_UNITS_PER_METER
    segments: set[tuple[int, int, int, int]] = set()
    for room in floor_plan.rooms:
        boundary = room.boundary
        for start, end in zip(boundary, (*boundary[1:], boundary[0]), strict=True):
            room_geometry.charge_query_work()
            clipped = geometry._clip_segment(start, end, neighborhood)
            if clipped is None:
                continue
            first = (
                geometry._quantize(clipped[0][0], units),
                geometry._quantize(clipped[0][1], units),
            )
            second = (
                geometry._quantize(clipped[1][0], units),
                geometry._quantize(clipped[1][1], units),
            )
            if second < first:
                first, second = second, first
            segments.add((*first, *second))
    room_geometry.charge_query_work(len(segments))
    digest = hashlib.sha256()
    digest.update(geometry._SCOPED_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">H", _HASH_ONLY))
    digest.update(struct.pack(">I", len(ordered)))
    for x, y, radius in ordered:
        digest.update(
            struct.pack(
                ">qqq",
                geometry._quantize_coordinate(x),
                geometry._quantize_coordinate(y),
                geometry._quantize_coordinate(radius),
            )
        )
        occupancy = sum(
            int(room_geometry.contains(probe_x, probe_y)) << index
            for index, (probe_x, probe_y) in enumerate(
                geometry._occupancy_probes(x, y, radius)
            )
        )
        digest.update(struct.pack(">H", occupancy))
    digest.update(struct.pack(">I", len(segments)))
    for segment in sorted(segments):
        digest.update(struct.pack(">qqqq", *segment))
    return digest.hexdigest()


def _scoped_fingerprint(
    shape_sha256: str,
    occupancy: Sequence[int],
    segments: Sequence[Sequence[int]],
) -> str:
    """Return the version 3 digest of the circles, occupancy and walls."""
    digest = hashlib.sha256()
    digest.update(geometry._SCOPED_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">H", _SCOPED))
    digest.update(bytes.fromhex(shape_sha256))
    digest.update(struct.pack(">I", len(occupancy)))
    for value in occupancy:
        digest.update(struct.pack(">H", value))
    digest.update(struct.pack(">I", len(segments)))
    for segment in segments:
        digest.update(struct.pack(">qqqq", *segment))
    return digest.hexdigest()


def _room_polygon_fingerprint(polygon: Sequence[Sequence[int]]) -> str:
    """Hash a canonical room polygon independently of its absolute origin."""
    origin_x = min(point[0] for point in polygon)
    origin_y = min(point[1] for point in polygon)
    digest = hashlib.sha256()
    digest.update(b"matic-room-frame-anchor-v1\0")
    digest.update(struct.pack(">I", len(polygon)))
    for x, y in polygon:
        digest.update(struct.pack(">qq", x - origin_x, y - origin_y))
    return digest.hexdigest()


def _valid_saved_binding(binding: Mapping[str, Any]) -> bool:
    """Return whether an old binding has the exact shape its version wrote."""
    version = binding.get("version")
    fields = _FIELDS.get(version) if type(version) is int else None
    if fields is None:
        return False
    keys = set(binding)
    if version == _SCOPED:
        optional = {_INVARIANT, "translation_frame_bounds", _ANCHORS}
        if not fields - optional <= keys <= fields:
            return False
    elif keys != fields:
        return False
    mission_id = binding["mission_id"]
    partition_id = binding["partition_id"]
    if not (
        type(mission_id) is int
        and 0 <= mission_id <= 0xFFFFFFFF
        and isinstance(partition_id, str)
        and bool(partition_id)
        and all(
            valid_digest(binding[key])
            for key in (
                "geometry_sha256",
                "local_geometry_sha256",
                "area_shape_sha256",
                _INVARIANT,
            )
            if key in binding
        )
    ):
        return False
    if version in {_ANCHORED_HASH_ONLY, _SHAPE_ANCHORED_HASH_ONLY}:
        return _valid_anchors(binding[_ANCHORS], complete=True)
    if version != _SCOPED:
        return True
    bounds = binding.get("translation_frame_bounds", [0, 0, 0, 0])
    return (
        valid_occupancy(binding["local_occupancy"])
        and valid_segments(binding["local_segments_mm"])
        and isinstance(bounds, list)
        and len(bounds) == 4
        and all(valid_int64(value) for value in bounds)
        and (_ANCHORS not in binding or _valid_anchors(binding[_ANCHORS]))
        and _scoped_fingerprint(
            binding["area_shape_sha256"].casefold(),
            binding["local_occupancy"],
            binding["local_segments_mm"],
        )
        == binding["local_geometry_sha256"].casefold()
    )


def _valid_anchors(value: Any, *, complete: bool = False) -> bool:
    """Validate old room anchors; ``complete`` requires snapshots and keys."""
    if (
        not isinstance(value, list)
        or len(value) > geometry._MAX_TRANSLATION_ROOM_ANCHORS
        or (complete and not value)
    ):
        return False
    shapes = (
        ({"fingerprint", "bounds", "room_key", "circle_keys", "boundary_mm"},)
        if complete
        else (
            {"fingerprint", "bounds"},
            {"fingerprint", "bounds", "room_key", "circle_keys"},
            {"fingerprint", "bounds", "room_key", "circle_keys", "boundary_mm"},
        )
    )
    associations = 0
    points = 0
    for anchor in value:
        if not isinstance(anchor, Mapping) or set(anchor) not in shapes:
            return False
        bounds = anchor["bounds"]
        if not (
            valid_digest(anchor["fingerprint"])
            and isinstance(bounds, list)
            and len(bounds) == 4
            and all(valid_int64(coordinate) for coordinate in bounds)
        ):
            return False
        if "boundary_mm" in anchor:
            polygon = anchor["boundary_mm"]
            if not isinstance(polygon, list) or len(polygon) < 3:
                return False
            points += len(polygon)
            if points > geometry._MAX_ROOM_FRAME_POINTS or not all(
                isinstance(point, list)
                and len(point) == 2
                and all(valid_int64(coordinate) for coordinate in point)
                for point in polygon
            ):
                return False
            try:
                fingerprint = _room_polygon_fingerprint(polygon)
            except OverflowError, struct.error:
                return False
            if fingerprint != anchor[
                "fingerprint"
            ].casefold() or bounds != geometry.room_bounds(polygon):
                return False
        if "room_key" in anchor:
            keys = anchor["circle_keys"]
            if not (
                valid_digest(anchor["room_key"])
                and isinstance(keys, list)
                and 0 < len(keys) <= 512
                and all(valid_digest(key) for key in keys)
                and len(set(keys)) == len(keys)
            ):
                return False
            associations += len(keys)
            if associations > geometry._MAX_TRANSLATION_ROOM_CIRCLE_ASSOCIATIONS:
                return False
    return True


_BASE = frozenset({"version", "mission_id", "partition_id", "geometry_sha256"})

_FIELDS: dict[int, frozenset[str]] = {
    _WHOLE_FLOOR: _BASE,
    _HASH_ONLY: _BASE | {"local_geometry_sha256"},
    _BOUNDED_HASH_ONLY: _BASE | {"local_geometry_sha256"},
    _ANCHORED_HASH_ONLY: _BASE | {"local_geometry_sha256", _INVARIANT, _ANCHORS},
    _SHAPE_ANCHORED_HASH_ONLY: _BASE
    | {"local_geometry_sha256", _INVARIANT, _ANCHORS, "area_shape_sha256"},
    _SCOPED: _BASE
    | {
        "area_shape_sha256",
        "local_geometry_sha256",
        "local_occupancy",
        "local_segments_mm",
        _INVARIANT,
        "translation_frame_bounds",
        _ANCHORS,
    },
}
