"""Bind saved custom areas to one verified floor plan.

A binding records the floor it was drawn on and local evidence that lets the
area survive later map refinements:

- ``local`` holds the walls and occupancy probes near a small area, or, for
  an area with more nearby walls than tolerant matching can handle, one
  digest of each circle's neighbourhood.
- ``frame`` holds the saved circles' digest, the floor's translation-free
  digest and a snapshot of every room that contains a circle. Wall evidence
  always has one. A neighbourhood digest has one unless the rooms could not
  be snapshotted; such a binding cannot survive any map change.

Records 0.5 saved are read through their exact version 7 form, from
``area_binding_legacy``. Any other record is invalid.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from . import area_binding_geometry as geometry
from . import area_binding_legacy as legacy
from .area_binding_formats import (
    AREA_SCHEMA_VERSION,
    MAP_BINDING_VERSION,
    AreaBindingStatus,
    valid_digest,
    valid_int64,
    valid_occupancy,
    valid_segments,
)
from .area_geometry import GeometryTooComplex, RoomGeometryIndex
from .client import FloorPlan

__all__ = ["AreaBindingStatus"]

MapBinding = dict[str, Any]

_IDENTITY_FIELDS = {"version", "mission_id", "partition_id", "geometry_sha256"}


def binding_for_area(
    floor_plan: FloorPlan,
    circles: Sequence[Mapping[str, Any]],
    *,
    room_geometry: RoomGeometryIndex | None = None,
) -> MapBinding:
    """Bind an area to its floor and the geometry around it."""
    room_geometry = room_geometry or geometry._room_geometry_index(floor_plan)
    shape, occupancy, segments = geometry._area_geometry_components(
        floor_plan, circles, room_geometry=room_geometry
    )
    binding: MapBinding = {
        "version": MAP_BINDING_VERSION,
        **geometry.floor_identity(floor_plan),
    }
    if len(segments) <= geometry._MAX_LOCAL_SEGMENT_MATCH_SEGMENTS:
        binding["local"] = {
            "occupancy": list(occupancy),
            "segments_mm": [list(segment) for segment in segments],
        }
        binding["frame"] = _frame(floor_plan, circles, shape, room_geometry)
        return binding
    binding["local"] = {
        "sha256": geometry.neighbourhood_fingerprint(
            floor_plan, circles, room_geometry=room_geometry
        )
    }
    try:
        frame = _frame(floor_plan, circles, shape, room_geometry)
    except GeometryTooComplex, OverflowError, TypeError, ValueError:
        # An area this large stays usable on an unchanged map without rooms.
        return binding
    expected = {geometry._translation_circle_key(circle) for circle in circles}
    if _valid_rooms(frame["rooms"]) and expected == {
        key for room in frame["rooms"] for key in room["circle_keys"]
    }:
        binding["frame"] = frame
    return binding


def _frame(
    floor_plan: FloorPlan,
    circles: Sequence[Mapping[str, Any]],
    shape: geometry._AreaShape,
    room_geometry: RoomGeometryIndex,
) -> dict[str, Any]:
    return {
        "shape_sha256": geometry._area_shape_fingerprint(shape),
        "floor_sha256": geometry.translation_invariant_geometry_fingerprint(floor_plan),
        "rooms": geometry._translation_room_anchors(
            floor_plan, circles, room_geometry=room_geometry
        ),
    }


def valid_binding(binding: Mapping[str, Any]) -> bool:
    """Return whether a stored binding is a well-formed version 7 binding."""
    local = binding.get("local")
    frame = binding.get("frame")
    mission_id = binding.get("mission_id")
    partition_id = binding.get("partition_id")
    if not (
        set(binding) - {"frame"} == _IDENTITY_FIELDS | {"local"}
        and type(binding["version"]) is int
        and binding["version"] == MAP_BINDING_VERSION
        and type(mission_id) is int
        and 0 <= mission_id <= 0xFFFFFFFF
        and isinstance(partition_id, str)
        and bool(partition_id)
        and valid_digest(binding["geometry_sha256"], lowercase=True)
        and isinstance(local, Mapping)
    ):
        return False
    if set(local) == {"occupancy", "segments_mm"}:
        local_valid = valid_occupancy(local["occupancy"]) and valid_segments(
            local["segments_mm"]
        )
    else:
        local_valid = set(local) == {"sha256"} and valid_digest(
            local["sha256"], lowercase=True
        )
    if frame is None:
        return local_valid and "frame" not in binding and "sha256" in local
    return (
        local_valid
        and isinstance(frame, Mapping)
        and set(frame) == {"shape_sha256", "floor_sha256", "rooms"}
        and valid_digest(frame["shape_sha256"], lowercase=True)
        and valid_digest(frame["floor_sha256"], lowercase=True)
        and _valid_rooms(frame["rooms"])
    )


def _valid_rooms(rooms: Any) -> bool:
    """Validate bounded room snapshots and their circle associations."""
    if (
        not isinstance(rooms, list)
        or not 0 < len(rooms) <= geometry._MAX_TRANSLATION_ROOM_ANCHORS
    ):
        return False
    associations = 0
    points = 0
    for room in rooms:
        if not isinstance(room, Mapping) or set(room) != {
            "room_key",
            "circle_keys",
            "boundary_mm",
        }:
            return False
        keys = room["circle_keys"]
        boundary = room["boundary_mm"]
        if not (
            valid_digest(room["room_key"], lowercase=True)
            and isinstance(keys, list)
            and 0 < len(keys) <= 512
            and all(valid_digest(key, lowercase=True) for key in keys)
            and len(set(keys)) == len(keys)
            and isinstance(boundary, list)
            and len(boundary) >= 3
        ):
            return False
        associations += len(keys)
        points += len(boundary)
        if (
            associations > geometry._MAX_TRANSLATION_ROOM_CIRCLE_ASSOCIATIONS
            or points > geometry._MAX_ROOM_FRAME_POINTS
            or not all(
                isinstance(point, list)
                and len(point) == 2
                and all(valid_int64(coordinate) for coordinate in point)
                for point in boundary
            )
            or len({tuple(point) for point in boundary}) < 3
        ):
            return False
    return True


def current_binding(binding: object) -> MapBinding | None:
    """Return a stored binding as version 7, or None if it is unusable."""
    if not isinstance(binding, Mapping):
        return None
    if valid_binding(binding):
        return dict(binding)
    converted = legacy.exact_binding(binding)
    return converted if converted is not None and valid_binding(converted) else None


def binding_mission(binding: object) -> int | None:
    """Return the floor a usable binding names."""
    saved = current_binding(binding)
    return None if saved is None else int(saved["mission_id"])


def area_binding_needs_geometry_index(area: Mapping[str, Any]) -> bool:
    """Return whether a usable binding performs indexed map queries."""
    return (
        type(area.get("schema_version")) is int
        and area["schema_version"] == AREA_SCHEMA_VERSION
        and current_binding(area.get("map_binding")) is not None
    )


def room_frame_point_count(area: Mapping[str, Any]) -> int:
    """Count the room boundary vertices one saved area stores."""
    saved = current_binding(area.get("map_binding"))
    frame = saved.get("frame") if saved else None
    return sum(len(room["boundary_mm"]) for room in frame["rooms"]) if frame else 0


def total_room_frame_point_count(areas: Mapping[str, Any]) -> int:
    """Count the room boundary vertices all of one robot's areas store."""
    return sum(
        room_frame_point_count(area)
        for area in areas.values()
        if isinstance(area, Mapping)
    )


def area_binding_status(
    area: Mapping[str, Any],
    floor_plan: FloorPlan,
    *,
    room_geometry: RoomGeometryIndex | None = None,
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
    saved = current_binding(area.get("map_binding"))
    if saved is None:
        return AreaBindingStatus.INVALID
    try:
        current = geometry.floor_identity(floor_plan)
    except OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if saved["mission_id"] != current["mission_id"]:
        return AreaBindingStatus.MISSION_CHANGED
    geometry_changed = saved["geometry_sha256"] != current["geometry_sha256"]
    if "sha256" in saved["local"]:
        return _neighbourhood_status(
            area,
            saved,
            floor_plan,
            partition_changed=saved["partition_id"] != current["partition_id"],
            geometry_changed=geometry_changed,
            room_geometry=room_geometry,
        )
    return _walls_status(
        area,
        saved,
        floor_plan,
        geometry_changed=geometry_changed,
        room_geometry=room_geometry,
    )


def _neighbourhood_status(
    area: Mapping[str, Any],
    saved: Mapping[str, Any],
    floor_plan: FloorPlan,
    *,
    partition_changed: bool,
    geometry_changed: bool,
    room_geometry: RoomGeometryIndex | None,
) -> AreaBindingStatus:
    frame = saved.get("frame")
    if frame is None and partition_changed and geometry_changed:
        return AreaBindingStatus.PARTITION_CHANGED
    try:
        local_matches = saved["local"]["sha256"] == geometry.neighbourhood_fingerprint(
            floor_plan,
            area["circles"],
            center_tolerance=geometry._LOCAL_GEOMETRY_TOLERANCE_METERS,
            room_geometry=room_geometry,
        )
    except geometry.NeighbourhoodWorkExhausted:
        # Raised only after the circles validated: keep them reviewable.
        return (
            AreaBindingStatus.GEOMETRY_CHANGED
            if geometry_changed
            else AreaBindingStatus.INVALID
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if frame is None:
        # Without room frames a changed map can only be reviewed.
        if geometry_changed:
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.CURRENT if local_matches else AreaBindingStatus.INVALID
    try:
        room_geometry = room_geometry or geometry._room_geometry_index(floor_plan)
        shape, _, _ = geometry._area_geometry_components(
            floor_plan,
            area["circles"],
            center_tolerance=geometry._LOCAL_GEOMETRY_TOLERANCE_METERS,
            room_geometry=room_geometry,
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if frame["shape_sha256"] != geometry._area_shape_fingerprint(shape):
        return AreaBindingStatus.INVALID
    if not geometry_changed:
        return AreaBindingStatus.CURRENT if local_matches else AreaBindingStatus.INVALID
    circles = area["circles"]
    rooms = frame["rooms"]
    try:
        failed_room_keys: set[str] = set()
        associations_valid: list[bool] = []
        frames_match = geometry._saved_room_frames_match(
            rooms,
            circles,
            floor_plan,
            room_geometry,
            failed_room_keys=failed_room_keys,
            associations_valid=associations_valid,
        )
        if not (local_matches and frames_match):
            if local_matches and associations_valid == [True]:
                # Unchanged local walls need strong proof only for the rooms
                # whose frame landmarks moved.
                saved_rooms = {room["room_key"]: room for room in rooms}
                current_rooms = {
                    room["room_key"]: room
                    for room in geometry._translation_room_anchors(
                        floor_plan, circles, room_geometry=room_geometry
                    )
                }
                proven = bool(failed_room_keys) and all(
                    key in saved_rooms
                    and key in current_rooms
                    and geometry._room_has_strong_frame_witnesses(
                        saved_rooms[key], current_rooms[key], room_geometry
                    )
                    for key in failed_room_keys
                )
            else:
                # Changed local walls cannot say which room moved, so every
                # room needs strong proof.
                proven = geometry._saved_room_frames_have_strong_witnesses(
                    rooms, circles, floor_plan, room_geometry
                )
            if not proven:
                return AreaBindingStatus.GEOMETRY_CHANGED
        if frame["floor_sha256"] == geometry.translation_invariant_geometry_fingerprint(
            floor_plan
        ):
            return AreaBindingStatus.GEOMETRY_CHANGED
    except GeometryTooComplex, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.GEOMETRY_CHANGED
    return AreaBindingStatus.CURRENT


def _walls_status(
    area: Mapping[str, Any],
    saved: Mapping[str, Any],
    floor_plan: FloorPlan,
    *,
    geometry_changed: bool,
    room_geometry: RoomGeometryIndex | None,
) -> AreaBindingStatus:
    frame = saved["frame"]
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
    if frame["shape_sha256"] != geometry._area_shape_fingerprint(shape):
        return AreaBindingStatus.INVALID
    all_frames_strongly_proven = False
    if geometry_changed:
        # Every circle needs its own containing room's frame: one area may
        # span rooms that moved differently.
        verdict = _room_frames_status(
            frame["rooms"], circles, floor_plan, room_geometry
        )
        if isinstance(verdict, AreaBindingStatus):
            return verdict
        all_frames_strongly_proven = verdict

    def translated() -> bool:
        return bool(
            frame["floor_sha256"]
            == geometry.translation_invariant_geometry_fingerprint(floor_plan)
        )

    if all_frames_strongly_proven:
        try:
            return (
                AreaBindingStatus.GEOMETRY_CHANGED
                if translated()
                else AreaBindingStatus.CURRENT
            )
        except GeometryTooComplex, OverflowError, TypeError, ValueError:
            return AreaBindingStatus.GEOMETRY_CHANGED
    saved_occupancy = tuple(saved["local"]["occupancy"])
    saved_segments = tuple(tuple(segment) for segment in saved["local"]["segments_mm"])
    if saved_occupancy == occupancy and saved_segments == segments:
        if geometry_changed and translated():
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.CURRENT
    try:
        if geometry.walls_match(
            saved_occupancy,
            saved_segments,
            shape,
            occupancy,
            segments,
            circles,
            room_geometry,
        ):
            return AreaBindingStatus.CURRENT
    except GeometryTooComplex:
        # A changed map keeps its circles reviewable when matching runs out of
        # work; GEOMETRY_CHANGED still blocks commands.
        return (
            AreaBindingStatus.GEOMETRY_CHANGED
            if geometry_changed
            else AreaBindingStatus.INVALID
        )
    if not geometry_changed:
        return AreaBindingStatus.INVALID
    try:
        if (
            geometry._saved_room_frames_have_strong_witnesses(
                frame["rooms"], circles, floor_plan, room_geometry
            )
            and not translated()
        ):
            return AreaBindingStatus.CURRENT
    except GeometryTooComplex, OverflowError, TypeError, ValueError:
        pass
    return AreaBindingStatus.GEOMETRY_CHANGED


def _room_frames_status(
    rooms: Sequence[Mapping[str, Any]],
    circles: Sequence[Mapping[str, Any]],
    floor_plan: FloorPlan,
    room_geometry: RoomGeometryIndex,
) -> AreaBindingStatus | bool:
    """Check each saved room frame after a map change.

    Returns a final status, or whether every room needed and passed the
    strong witness proof.
    """
    expected = {geometry._translation_circle_key(circle) for circle in circles}
    if {key for room in rooms for key in room["circle_keys"]} != expected:
        return AreaBindingStatus.GEOMETRY_CHANGED
    try:
        current_rooms = geometry._translation_room_anchors(
            floor_plan, circles, room_geometry=room_geometry
        )
    except GeometryTooComplex, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    current = geometry._rooms_by_key(current_rooms)
    saved = geometry._rooms_by_key(rooms)
    if current is None or saved is None or set(saved) != set(current):
        return AreaBindingStatus.GEOMETRY_CHANGED
    needing_witnesses = []
    for key, saved_room in saved.items():
        current_room = current[key]
        if set(saved_room["circle_keys"]) != set(current_room["circle_keys"]):
            return AreaBindingStatus.GEOMETRY_CHANGED
        try:
            if not (
                geometry._room_anchor_bounds_match(saved_room, current_room)
                and geometry._room_frame_matches(
                    saved_room, current_room, room_geometry
                )
            ):
                needing_witnesses.append((saved_room, current_room))
        except GeometryTooComplex:
            return AreaBindingStatus.GEOMETRY_CHANGED
    # Finish every room's frame check before the optional strong proof, so one
    # room's proof cannot spend a later room's budget.
    try:
        for saved_room, current_room in needing_witnesses:
            if not geometry._room_has_strong_frame_witnesses(
                saved_room, current_room, room_geometry
            ):
                return AreaBindingStatus.GEOMETRY_CHANGED
    except GeometryTooComplex:
        return AreaBindingStatus.GEOMETRY_CHANGED
    return len(needing_witnesses) == len(saved)


def area_binding_allows_review(
    area: Mapping[str, Any],
    floor_plan: FloorPlan,
    *,
    status: AreaBindingStatus | None = None,
    room_geometry: RoomGeometryIndex | None = None,
) -> bool:
    """Return whether stale coordinates can be shown for local confirmation.

    Every GEOMETRY_CHANGED verdict has already placed the circles on this map.
    """
    if status is None:
        status = area_binding_status(area, floor_plan, room_geometry=room_geometry)
    return status is AreaBindingStatus.GEOMETRY_CHANGED
