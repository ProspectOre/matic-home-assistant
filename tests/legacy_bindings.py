"""Area bindings in the forms releases before 0.6 saved, for converter tests.

`test_area_binding_pins` checks that these builders reproduce the records
release/0.6 at ba7fb875 wrote.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from custom_components.matic_robot import area_binding_geometry as geometry
from custom_components.matic_robot import area_binding_legacy as legacy
from custom_components.matic_robot.area_binding import binding_for_area
from custom_components.matic_robot.client import FloorPlan

Circles = Sequence[Mapping[str, Any]]


def v1(floor_plan: FloorPlan) -> dict[str, Any]:
    """The whole-floor binding 0.3.0 to 0.3.2 saved."""
    return {"version": 1, **geometry.floor_identity(floor_plan)}


def v2(floor_plan: FloorPlan, circles: Circles) -> dict[str, Any]:
    """The unreleased hash-only binding."""
    return {
        **v1(floor_plan),
        "version": 2,
        "local_geometry_sha256": legacy._hash_only_fingerprint(floor_plan, circles),
    }


def v3(floor_plan: FloorPlan, circles: Circles) -> dict[str, Any]:
    """The wall-evidence binding with room snapshots that 0.5 saved."""
    points = [point for room in floor_plan.rooms for point in room.boundary]
    return {
        **old_record(binding_for_area(floor_plan, circles), 3),
        "translation_frame_bounds": [
            min(round(x * 1000) for x, _ in points),
            min(round(y * 1000) for _, y in points),
            max(round(x * 1000) for x, _ in points),
            max(round(y * 1000) for _, y in points),
        ],
    }


def v4(floor_plan: FloorPlan, circles: Circles) -> dict[str, Any]:
    """The neighbourhood-digest binding without room anchors."""
    return {
        **v1(floor_plan),
        "version": 4,
        "local_geometry_sha256": geometry.neighbourhood_fingerprint(
            floor_plan, circles
        ),
    }


def v6(floor_plan: FloorPlan, circles: Circles) -> dict[str, Any]:
    """The neighbourhood-digest binding with room anchors."""
    return old_record(binding_for_area(floor_plan, circles), 6)


def v5(floor_plan: FloorPlan, circles: Circles) -> dict[str, Any]:
    """The unreleased anchored binding: version 6 without the shape digest."""
    return old_record(binding_for_area(floor_plan, circles), 5)


def old_record(binding: Mapping[str, Any], version: int) -> dict[str, Any]:
    """Return a version 7 binding with a frame in its version 3, 5 or 6 form."""
    frame = binding["frame"]
    local = binding["local"]
    record = {
        **{key: binding[key] for key in ("mission_id", "partition_id")},
        "version": version,
        "geometry_sha256": binding["geometry_sha256"],
        "area_shape_sha256": frame["shape_sha256"],
        "translation_invariant_geometry_sha256": frame["floor_sha256"],
        "translation_room_anchors": [anchor(room) for room in frame["rooms"]],
    }
    if version == 3:
        return {
            **record,
            "local_geometry_sha256": legacy._scoped_fingerprint(
                frame["shape_sha256"], local["occupancy"], local["segments_mm"]
            ),
            "local_occupancy": local["occupancy"],
            "local_segments_mm": local["segments_mm"],
        }
    record["local_geometry_sha256"] = local["sha256"]
    if version == 5:
        del record["area_shape_sha256"]
    return record


def anchor(room: Mapping[str, Any]) -> dict[str, Any]:
    """Return a version 7 room snapshot as an old room anchor."""
    boundary = room["boundary_mm"]
    return {
        **room,
        "fingerprint": legacy._room_polygon_fingerprint(boundary),
        "bounds": geometry.room_bounds(boundary),
    }


def without_boundaries(binding: Mapping[str, Any]) -> dict[str, Any]:
    """Return a version 3 binding as 0.4.5 to 0.4.8 saved it."""
    return {
        **binding,
        "translation_room_anchors": [
            {key: value for key, value in anchor.items() if key != "boundary_mm"}
            for anchor in binding["translation_room_anchors"]
        ],
    }


def unanchored(binding: Mapping[str, Any]) -> dict[str, Any]:
    """Return a version 3 binding as 0.3.3 to 0.4.4 saved it."""
    return {
        key: value
        for key, value in binding.items()
        if key
        not in {
            "translation_invariant_geometry_sha256",
            "translation_frame_bounds",
            "translation_room_anchors",
        }
    }
