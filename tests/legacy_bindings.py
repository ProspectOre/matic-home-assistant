"""Area bindings in the forms 0.5 saved, for converter tests.

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


def v3(floor_plan: FloorPlan, circles: Circles) -> dict[str, Any]:
    """The wall-evidence binding with room snapshots."""
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
        "version": 4,
        **geometry.floor_identity(floor_plan),
        "local_geometry_sha256": geometry.neighbourhood_fingerprint(
            floor_plan, circles
        ),
    }


def v6(floor_plan: FloorPlan, circles: Circles) -> dict[str, Any]:
    """The neighbourhood-digest binding with room anchors."""
    return old_record(binding_for_area(floor_plan, circles), 6)


def old_record(binding: Mapping[str, Any], version: int) -> dict[str, Any]:
    """Return a version 7 binding with a frame in its version 3 or 6 form."""
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
        record.update(
            local_occupancy=local["occupancy"], local_segments_mm=local["segments_mm"]
        )
        record["local_geometry_sha256"] = legacy._walls_digest(record)
    else:
        record["local_geometry_sha256"] = local["sha256"]
    return record


def anchor(room: Mapping[str, Any]) -> dict[str, Any]:
    """Return a version 7 room snapshot as an old room anchor."""
    boundary = room["boundary_mm"]
    return {
        **room,
        "fingerprint": legacy._room_fingerprint(boundary),
        "bounds": geometry.room_bounds(boundary),
    }
