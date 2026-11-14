"""Automatic custom-area recovery keeps the original spatial reference."""

import math
from copy import deepcopy
from dataclasses import replace
from unittest.mock import patch

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot import area_binding as binding
from custom_components.matic_robot import area_binding_formats as binding_formats
from custom_components.matic_robot import area_binding_geometry as binding_geometry
from custom_components.matic_robot import plan_state
from custom_components.matic_robot.area_geometry import RoomGeometryIndex
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.plan_model import (
    PlanAreaMapChangedError,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.service_plans import (
    _validated_area_command,
)
from tests import legacy_bindings


def _floor(boundary=((0, 0), (10, 0), (10, 10), (0, 10))):
    return FloorPlan(
        42,
        "partition",
        b"partition",
        (Room("room", "Room", "protocol", b"room", boundary),),
    )


def _area(floor):
    circles = [{"x": 5.0, "y": 5.0, "radius": 0.2}]
    return {
        "schema_version": binding_formats.AREA_SCHEMA_VERSION,
        "name": "Area",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding.binding_for_area(floor, circles),
    }


def _old_anchors(area):
    """Store the area's binding as version 3 and return its room anchors."""
    area["map_binding"] = legacy_bindings.old_record(area["map_binding"], 3)
    return area["map_binding"]["translation_room_anchors"]


@pytest.mark.parametrize("offset", [0.001, 0.005, 0.010])
def test_small_single_room_frame_shift_stays_reviewable(offset):
    original = _floor()
    area = _area(original)
    before = deepcopy(area)
    changed = _floor(tuple((x + offset, y) for x, y in original.rooms[0].boundary))
    assert (
        binding.area_binding_status(area, changed)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )
    with pytest.raises(ServiceValidationError) as error:
        _validated_area_command(area, changed, None, None)
    assert error.value.translation_key == "area_map_changed"
    assert area == before


def test_successive_small_changes_cannot_walk_the_saved_frame():
    area = _area(_floor())
    for offset in (0.005, 0.010, 0.015):
        current = _floor(tuple((x + offset, y) for x, y in _floor().rooms[0].boundary))
        assert (
            binding.area_binding_status(area, current)
            is binding.AreaBindingStatus.GEOMETRY_CHANGED
        )
    current = _floor(tuple((x + 0.025, y) for x, y in _floor().rooms[0].boundary))
    assert (
        binding.area_binding_status(area, current)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )


def test_one_corner_one_millimeter_refinement_keeps_other_frame_anchors():
    original = _floor()
    area = _area(original)
    changed = _floor(((0.001, 0), *original.rooms[0].boundary[1:]))
    assert (
        binding.area_binding_status(area, changed) is binding.AreaBindingStatus.CURRENT
    )


def test_partition_churn_requires_verified_spatial_evidence():
    original = _floor()
    area = _area(original)
    repartitioned = replace(
        original, partition_protocol_id="new", partition_id_wire=b"new"
    )
    assert (
        binding.area_binding_status(area, repartitioned)
        is binding.AreaBindingStatus.CURRENT
    )
    changed = replace(
        _floor(((1, 0), (11, 0), (11, 10), (1, 10))),
        partition_protocol_id="new",
        partition_id_wire=b"new",
    )
    assert (
        binding.area_binding_status(area, changed)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )


def test_same_bounds_do_not_replace_real_frame_landmarks():
    original = _floor(
        ((0, 2), (2, 0), (8, 0), (10, 2), (10, 8), (8, 10), (2, 10), (0, 8))
    )
    area = _area(original)
    assert (
        binding.area_binding_status(area, _floor())
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )


def test_room_retessellation_does_not_invalidate_an_interior_area():
    area = _area(_floor())
    current = _floor(((0, 0), (3, 0), (10, 0), (10, 7), (10, 10), (0, 10)))
    assert (
        binding.area_binding_status(area, current) is binding.AreaBindingStatus.CURRENT
    )


@pytest.mark.parametrize("offset", [(0.001, 0), (0.015, 0), (0, 0.015), (0.015, 0.015)])
def test_small_single_room_translation_does_not_keep_stale_area_frame(offset):
    original = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    original = replace(original, rooms=(*original.rooms, remote))
    area = _area(original)
    dx, dy = offset
    moved = replace(
        original,
        rooms=(
            replace(
                original.rooms[0],
                boundary=tuple((x + dx, y + dy) for x, y in original.rooms[0].boundary),
            ),
            remote,
        ),
    )
    assert (
        binding_geometry.translation_invariant_geometry_fingerprint(moved)
        != area["map_binding"]["frame"]["floor_sha256"]
    )
    assert (
        binding.area_binding_status(area, moved)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )


def test_small_centered_room_rotation_does_not_keep_stale_area_frame():
    original = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    original = replace(original, rooms=(*original.rooms, remote))
    area = _area(original)
    angle = 0.0005
    cos_angle, sin_angle = math.cos(angle), math.sin(angle)
    rotated_vertices = tuple(
        (
            5 + cos_angle * (x - 5) - sin_angle * (y - 5),
            5 + sin_angle * (x - 5) + cos_angle * (y - 5),
        )
        for x, y in original.rooms[0].boundary
    )
    rotated_boundary = tuple(
        point
        for start, end in zip(
            rotated_vertices, (*rotated_vertices[1:], rotated_vertices[0]), strict=True
        )
        for point in (
            start,
            ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2),
        )
    )
    rotated = replace(
        original,
        rooms=(replace(original.rooms[0], boundary=rotated_boundary), remote),
    )
    assert (
        binding.area_binding_status(area, rotated)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )


async def test_moved_room_blocks_saved_plan_preview(hass):
    original = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    original = replace(original, rooms=(*original.rooms, remote))
    area = _area(original)
    moved = replace(
        original,
        rooms=(
            replace(
                original.rooms[0],
                boundary=tuple((x + 0.015, y) for x, y in original.rooms[0].boundary),
            ),
            remote,
        ),
    )
    manager = CleaningPlanManager(hass)
    manager.repository.robot("serial")["areas"]["area"] = area
    plan_state.parse_robot(manager.repository.robot("serial"))
    with pytest.raises(PlanAreaMapChangedError):
        manager.planning.preview_area(
            "serial",
            {
                "area_id": "area",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
            moved,
        )


@pytest.mark.parametrize(
    "polygon", [None, [], [[True, 0]] * 3, [[0, 0]] * 3, [[0, 0, 0]] * 3]
)
def test_corrupt_frame_snapshot_stays_blocked(polygon):
    floor = _floor()
    area = _area(floor)
    area["map_binding"]["frame"]["rooms"][0]["boundary_mm"] = polygon
    assert binding.area_binding_status(area, floor) is binding.AreaBindingStatus.INVALID
    old = _area(floor)
    _old_anchors(old)[0]["boundary_mm"] = polygon
    assert binding.area_binding_status(old, floor) is binding.AreaBindingStatus.INVALID


def test_overflowing_frame_snapshot_stays_blocked():
    floor = _floor()
    area = _area(floor)
    room = area["map_binding"]["frame"]["rooms"][0]
    room["boundary_mm"] = [[-(1 << 63) - 1, 0], [0, 0], [(1 << 63) - 1, 1]]
    assert binding.area_binding_status(area, floor) is binding.AreaBindingStatus.INVALID
    area = _area(floor)
    anchor = _old_anchors(area)[0]
    anchor["boundary_mm"] = [[-(1 << 63), 0], [0, 0], [(1 << 63) - 1, 1]]
    assert binding.area_binding_status(area, floor) is binding.AreaBindingStatus.INVALID


def test_frame_snapshot_and_matching_are_bounded():
    floor = _floor()
    area = _area(floor)
    with (
        patch.object(binding_geometry, "_MAX_ROOM_FRAME_POINTS", 3),
    ):
        assert (
            binding.area_binding_status(area, floor)
            is binding.AreaBindingStatus.INVALID
        )
        with pytest.raises(ValueError, match="too many room frame"):
            binding.binding_for_area(floor, area["circles"])
    changed = _floor(((0.002, 0), (10, 0), (10, 10), (0.002, 10)))
    with patch.object(
        binding_geometry,
        "_room_frame_matches",
        side_effect=binding.GeometryTooComplex("bounded"),
    ):
        assert (
            binding.area_binding_status(area, changed)
            is binding.AreaBindingStatus.GEOMETRY_CHANGED
        )


def test_degenerate_landmarks_do_not_establish_a_frame():
    saved = {"boundary_mm": [[0, 0], [1, 0], [2, 0]]}
    current = {"boundary_mm": [[0, 0], [1, 1], [2, 0]]}
    assert not binding_geometry._room_frame_matches(
        saved, current, RoomGeometryIndex([])
    )


def test_room_frame_landmark_work_is_charged_before_scan():
    saved = {
        "boundary_mm": [[0, 0], [100, 0], [100, 100], [0, 100]],
    }
    current = {
        "boundary_mm": [[1, 0], [101, 0], [101, 100], [1, 100]],
    }
    room_geometry = RoomGeometryIndex([])
    room_geometry._query_work_remaining = 1
    with pytest.raises(binding.GeometryTooComplex):
        binding_geometry._room_frame_matches(saved, current, room_geometry)


def test_room_frame_area_scan_exhausts_budget_before_integer_geometry():
    saved = {
        "boundary_mm": [[0, 0], [100, 0], [100, 100], [0, 100]],
    }
    current = {
        "boundary_mm": [[1, 0], [100, 0], [100, 100], [0, 100]],
    }
    room_geometry = RoomGeometryIndex([])
    # Equality, directional landmarks and the current-point set consume 76.
    # There must be no integer polygon-area traversal after that budget ends.
    room_geometry._query_work_remaining = 76
    with patch.object(
        binding_geometry,
        "sum",
        side_effect=AssertionError("uncharged area scan"),
        create=True,
    ):
        with pytest.raises(binding.GeometryTooComplex):
            binding_geometry._room_frame_matches(saved, current, room_geometry)
