"""Automatic custom-area recovery keeps the original spatial reference."""

import math
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot import area_binding as binding
from custom_components.matic_robot.area_geometry import RoomGeometryIndex
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.plan_model import (
    AreaBindingUpgradeResult,
    PlanAreaMapChangedError,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.services import _validated_area_command


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
        "schema_version": binding.AREA_SCHEMA_VERSION,
        "name": "Area",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding.binding_for_area(floor, circles),
    }


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
        binding.translation_invariant_geometry_fingerprint(moved)
        != area["map_binding"]["translation_invariant_geometry_sha256"]
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


def test_legacy_room_anchor_without_absolute_boundary_blocks_small_translation():
    original = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    original = replace(original, rooms=(*original.rooms, remote))
    area = _area(original)
    area["map_binding"]["translation_room_anchors"][0].pop("boundary_mm")
    moved = replace(
        original,
        rooms=(
            replace(
                original.rooms[0],
                boundary=tuple((x + 0.005, y) for x, y in original.rooms[0].boundary),
            ),
            remote,
        ),
    )
    assert (
        binding.area_binding_status(area, moved)
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
    with pytest.raises(PlanAreaMapChangedError):
        manager.catalog.preview_area(
            "serial",
            {
                "area_id": "area",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
            moved,
        )


def test_legacy_bounds_bug_does_not_invalidate_unchanged_room_after_remote_edit():
    original = _floor(((0, 0), (1, 0), (10, 2), (10, 10), (0, 10)))
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    original = replace(original, rooms=(*original.rooms, remote))
    area = _area(original)
    anchor = area["map_binding"]["translation_room_anchors"][0]
    assert anchor["bounds"][2] == 10000
    anchor["bounds"][2] = anchor.pop("boundary_mm")[-1][0]
    assert anchor["bounds"][2] == 1000
    changed = replace(
        original,
        rooms=(
            original.rooms[0],
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    assert (
        binding.area_binding_status(area, changed) is binding.AreaBindingStatus.CURRENT
    )


@pytest.mark.parametrize(
    "polygon", [None, [], [[True, 0]] * 3, [[0, 0]] * 3, [[0, 0, 0]] * 3]
)
def test_corrupt_frame_snapshot_stays_blocked(polygon):
    floor = _floor()
    area = _area(floor)
    area["map_binding"]["translation_room_anchors"][0]["boundary_mm"] = polygon
    assert binding.area_binding_status(area, floor) is binding.AreaBindingStatus.INVALID


def test_overflowing_frame_snapshot_and_malformed_legacy_bounds_stay_blocked():
    floor = _floor()
    area = _area(floor)
    anchor = area["map_binding"]["translation_room_anchors"][0]
    anchor["boundary_mm"] = [[-(1 << 63), 0], [0, 0], [(1 << 63) - 1, 1]]
    assert binding.area_binding_status(area, floor) is binding.AreaBindingStatus.INVALID
    anchor.pop("boundary_mm")
    anchor["bounds"] = [0, 0, True, 10000]
    assert binding.area_binding_status(area, floor) is binding.AreaBindingStatus.INVALID


def test_frame_snapshot_and_matching_are_bounded():
    floor = _floor()
    area = _area(floor)
    with patch.object(binding, "_MAX_ROOM_FRAME_POINTS", 3):
        assert (
            binding.area_binding_status(area, floor)
            is binding.AreaBindingStatus.INVALID
        )
        with pytest.raises(ValueError, match="too many room frame"):
            binding.binding_for_area(floor, area["circles"])
    changed = _floor(((0.002, 0), (10, 0), (10, 10), (0.002, 10)))
    with patch.object(
        binding,
        "_room_frame_matches",
        side_effect=binding.GeometryTooComplex("bounded"),
    ):
        assert (
            binding.area_binding_status(area, changed)
            is binding.AreaBindingStatus.GEOMETRY_CHANGED
        )


def test_degenerate_landmarks_do_not_establish_a_frame():
    saved = {"fingerprint": "a" * 64, "boundary_mm": [[0, 0], [1, 0], [2, 0]]}
    current = {"fingerprint": "b" * 64, "boundary_mm": [[0, 0], [1, 1], [2, 0]]}
    assert not binding._room_frame_matches(saved, current, RoomGeometryIndex([]))
    assert not binding._room_frame_matches(
        saved, {"fingerprint": "a" * 64, "boundary_mm": []}, RoomGeometryIndex([])
    )


def test_room_frame_landmark_work_is_charged_before_scan():
    saved = {
        "fingerprint": "a" * 64,
        "boundary_mm": [[0, 0], [100, 0], [100, 100], [0, 100]],
    }
    current = {
        "fingerprint": "b" * 64,
        "boundary_mm": [[1, 0], [101, 0], [101, 100], [1, 100]],
    }
    room_geometry = RoomGeometryIndex([])
    room_geometry._query_work_remaining = 1
    with pytest.raises(binding.GeometryTooComplex):
        binding._room_frame_matches(saved, current, room_geometry)


def test_room_frame_area_scan_exhausts_budget_before_integer_geometry():
    saved = {
        "fingerprint": "a" * 64,
        "boundary_mm": [[0, 0], [100, 0], [100, 100], [0, 100]],
    }
    current = {
        "fingerprint": "b" * 64,
        "boundary_mm": [[1, 0], [100, 0], [100, 100], [0, 100]],
    }
    room_geometry = RoomGeometryIndex([])
    # Equality, directional landmarks and the current-point set consume 76.
    # There must be no integer polygon-area traversal after that budget ends.
    room_geometry._query_work_remaining = 76
    with patch.object(
        binding, "sum", side_effect=AssertionError("uncharged area scan"), create=True
    ):
        with pytest.raises(binding.GeometryTooComplex):
            binding._room_frame_matches(saved, current, room_geometry)


async def test_legacy_frame_shift_does_not_enrich_but_snapshot_survives_reload(hass):
    floor = _floor()
    area = _area(floor)
    area["map_binding"]["translation_room_anchors"][0].pop("boundary_mm")
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"]["area"] = deepcopy(area)
    changed = _floor(((0.015, 0), (10, 0), (10, 10), (0.015, 10)))
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", changed
    ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", floor
    ) == AreaBindingUpgradeResult(1, False)
    saved = deepcopy(manager.repository.data)
    manager.repository.store.async_save.assert_awaited_once()
    reloaded = CleaningPlanManager(hass)
    reloaded.repository.data = saved
    reloaded.repository.store = SimpleNamespace(async_save=AsyncMock())
    assert (
        binding.area_binding_status(reloaded.catalog.area("serial", "area"), changed)
        is binding.AreaBindingStatus.CURRENT
    )
    assert await reloaded.catalog.async_upgrade_area_bindings(
        "serial", changed
    ) == AreaBindingUpgradeResult(0, False)
    reloaded.repository.store.async_save.assert_not_awaited()
    assert reloaded.repository.data == saved


def test_legacy_anchor_without_boundary_rejects_small_whole_room_translation():
    original = _floor()
    area = _area(original)
    area["map_binding"]["translation_room_anchors"][0].pop("boundary_mm")
    translated = _floor(tuple((x + 0.005, y) for x, y in original.rooms[0].boundary))

    assert (
        binding.area_binding_status(area, translated)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )


async def test_legacy_upgrade_grafts_exact_room_snapshot_across_remote_map_change(hass):
    floor = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    floor = replace(floor, rooms=(*floor.rooms, remote))
    area = _area(floor)
    area["map_binding"]["translation_room_anchors"][0].pop("boundary_mm")
    changed = replace(
        floor,
        rooms=(
            floor.rooms[0],
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    assert (
        binding.area_binding_status(area, changed) is binding.AreaBindingStatus.CURRENT
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"]["area"] = deepcopy(area)
    binding_before = deepcopy(area["map_binding"])
    with patch(
        "custom_components.matic_robot.plan_catalog.binding_for_area",
        side_effect=AssertionError("anchor graft must preserve old local evidence"),
    ):
        assert await manager.catalog.async_upgrade_area_bindings(
            "serial", changed
        ) == AreaBindingUpgradeResult(1, False)
    manager.repository.store.async_save.assert_awaited_once()
    saved = manager.catalog.area("serial", "area")
    saved_binding = saved["map_binding"]
    assert saved_binding["geometry_sha256"] == binding_before["geometry_sha256"]
    assert saved_binding["geometry_sha256"] != binding.floor_plan_geometry_fingerprint(
        changed
    )
    assert {
        key: value
        for key, value in saved_binding.items()
        if key != "translation_room_anchors"
    } == {
        key: value
        for key, value in binding_before.items()
        if key != "translation_room_anchors"
    }
    old_anchor = binding_before["translation_room_anchors"][0]
    saved_anchor = saved_binding["translation_room_anchors"][0]
    assert saved_anchor == {
        **old_anchor,
        "boundary_mm": binding._translation_room_anchors(changed, saved["circles"])[0][
            "boundary_mm"
        ],
    }

    reloaded = CleaningPlanManager(hass)
    reloaded.repository.data = deepcopy(manager.repository.data)
    reloaded.repository.store = SimpleNamespace(async_save=AsyncMock())
    assert (
        binding.area_binding_status(reloaded.catalog.area("serial", "area"), changed)
        is binding.AreaBindingStatus.CURRENT
    )
    refined = replace(
        changed,
        rooms=(
            replace(
                changed.rooms[0],
                boundary=((0, 0), (10, 0), (10, 10), (5, 10), (0, 10)),
            ),
            changed.rooms[1],
        ),
    )
    assert (
        binding.area_binding_status(reloaded.catalog.area("serial", "area"), refined)
        is binding.AreaBindingStatus.CURRENT
    )


async def test_legacy_graft_normalizes_exact_last_vertex_bounds_bug(hass):
    floor = _floor(((0, 0), (1, 0), (10, 2), (10, 10), (0, 10)))
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    floor = replace(floor, rooms=(*floor.rooms, remote))
    area = _area(floor)
    anchor = area["map_binding"]["translation_room_anchors"][0]
    boundary = anchor.pop("boundary_mm")
    correct_bounds = list(anchor["bounds"])
    anchor["bounds"][2] = boundary[-1][0]
    assert anchor["bounds"][2] != correct_bounds[2]
    changed = replace(
        floor,
        rooms=(
            floor.rooms[0],
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    assert (
        binding.area_binding_status(area, changed) is binding.AreaBindingStatus.CURRENT
    )

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"]["area"] = deepcopy(area)
    before = deepcopy(area["map_binding"])
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", changed
    ) == AreaBindingUpgradeResult(1, False)
    manager.repository.store.async_save.assert_awaited_once()
    saved = manager.catalog.area("serial", "area")["map_binding"]
    saved_anchor = saved["translation_room_anchors"][0]
    assert saved_anchor["bounds"] == correct_bounds
    assert saved_anchor["boundary_mm"] == boundary
    assert {
        key: value for key, value in saved.items() if key != "translation_room_anchors"
    } == {
        key: value for key, value in before.items() if key != "translation_room_anchors"
    }
    assert (
        binding.area_binding_status(manager.catalog.area("serial", "area"), changed)
        is binding.AreaBindingStatus.CURRENT
    )


@pytest.mark.parametrize("change", ["room_shape", "room_origin", "room_identity"])
async def test_legacy_graft_fails_closed_without_exact_room_frame(hass, change):
    floor = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    floor = replace(floor, rooms=(*floor.rooms, remote))
    area = _area(floor)
    area["map_binding"]["translation_room_anchors"][0].pop("boundary_mm")
    if change == "room_shape":
        room = replace(
            floor.rooms[0],
            boundary=(
                (0, 0),
                (10, 0),
                (10, 10),
                (6, 10),
                (6, 9),
                (4, 9),
                (4, 10),
                (0, 10),
            ),
        )
    elif change == "room_origin":
        room = replace(
            floor.rooms[0],
            boundary=tuple((x + 0.001, y) for x, y in floor.rooms[0].boundary),
        )
    else:
        room = replace(
            floor.rooms[0],
            id="room-renamed",
            protocol_id="room-renamed",
            id_wire=b"room-renamed",
        )
    changed = replace(
        floor,
        rooms=(
            room,
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    assert (
        binding.area_binding_status(area, changed)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"]["area"] = deepcopy(area)
    before = manager.catalog.areas("serial")
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", changed
    ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    assert manager.catalog.areas("serial") == before


def _admit_malformed_binding_for_graft(
    area, floor_plan, *, room_geometry, _current_room_anchors
):
    """Isolate migration guards from the stricter normal status validator."""
    _current_room_anchors.extend(
        binding._translation_room_anchors(
            floor_plan, area["circles"], room_geometry=room_geometry
        )
    )
    return binding.AreaBindingStatus.CURRENT


async def test_legacy_graft_rejects_changed_target_circle_association(hass):
    polygon = ((0, 0), (10, 0), (10, 10), (0, 10))
    floor = FloorPlan(
        42,
        "partition",
        b"partition",
        (
            Room("first", "First", "first", b"first", polygon),
            Room("second", "Second", "second", b"second", polygon),
            Room(
                "remote",
                "Remote",
                "remote",
                b"remote",
                ((20, 0), (30, 0), (30, 10), (20, 10)),
            ),
        ),
    )
    circles = [
        {"x": 4.0, "y": 5.0, "radius": 0.2},
        {"x": 6.0, "y": 5.0, "radius": 0.2},
    ]
    area = {
        "schema_version": binding.AREA_SCHEMA_VERSION,
        "name": "Area",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding.binding_for_area(floor, circles),
    }
    anchors = area["map_binding"]["translation_room_anchors"]
    assert len(anchors) == 2
    for anchor in anchors:
        anchor.pop("boundary_mm")
    anchors[0]["circle_keys"] = anchors[0]["circle_keys"][:1]
    changed = replace(
        floor,
        rooms=(
            floor.rooms[0],
            floor.rooms[1],
            replace(floor.rooms[2], boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    assert (
        binding.area_binding_status(area, changed)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"]["area"] = deepcopy(area)
    before = manager.catalog.areas("serial")
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", changed
    ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    assert manager.catalog.areas("serial") == before

    # Exercise the migration's independent defensive checks even if its caller
    # were to admit this malformed association. Real status rejects it above.
    with patch(
        "custom_components.matic_robot.plan_catalog.area_binding_status",
        side_effect=_admit_malformed_binding_for_graft,
    ):
        assert await manager.catalog.async_upgrade_area_bindings(
            "serial", changed
        ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    assert manager.catalog.areas("serial") == before


async def test_legacy_graft_rejects_duplicate_saved_room_key(hass):
    polygon = ((0, 0), (10, 0), (10, 10), (0, 10))
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    floor = FloorPlan(
        42,
        "partition",
        b"partition",
        (
            Room("first", "First", "first", b"first", polygon),
            Room("second", "Second", "second", b"second", polygon),
            remote,
        ),
    )
    circles = [{"x": 4.0, "y": 5.0, "radius": 0.2}, {"x": 6.0, "y": 5.0, "radius": 0.2}]
    area = {
        "schema_version": binding.AREA_SCHEMA_VERSION,
        "name": "Area",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding.binding_for_area(floor, circles),
    }
    anchors = area["map_binding"]["translation_room_anchors"]
    assert len(anchors) == 2
    anchors[1]["room_key"] = anchors[0]["room_key"]
    anchors[0].pop("boundary_mm")
    changed = replace(
        floor,
        rooms=(
            floor.rooms[0],
            floor.rooms[1],
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    assert (
        binding.area_binding_status(area, changed)
        is binding.AreaBindingStatus.GEOMETRY_CHANGED
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"]["area"] = deepcopy(area)
    before = manager.catalog.areas("serial")
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", changed
    ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    assert manager.catalog.areas("serial") == before

    # Exercise the migration's independent defensive checks even if its caller
    # were to admit this malformed association. Real status rejects it above.
    with patch(
        "custom_components.matic_robot.plan_catalog.area_binding_status",
        side_effect=_admit_malformed_binding_for_graft,
    ):
        assert await manager.catalog.async_upgrade_area_bindings(
            "serial", changed
        ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    assert manager.catalog.areas("serial") == before


async def test_legacy_graft_preserves_existing_snapshot_in_mixed_anchors(hass):
    polygon = ((0, 0), (10, 0), (10, 10), (0, 10))
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    floor = FloorPlan(
        42,
        "partition",
        b"partition",
        (
            Room("first", "First", "first", b"first", polygon),
            Room("second", "Second", "second", b"second", polygon),
            remote,
        ),
    )
    circles = [{"x": 5.0, "y": 5.0, "radius": 0.2}]
    area = {
        "schema_version": binding.AREA_SCHEMA_VERSION,
        "name": "Area",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding.binding_for_area(floor, circles),
    }
    anchors = area["map_binding"]["translation_room_anchors"]
    assert len(anchors) == 2
    anchors[0].pop("boundary_mm")
    changed = replace(
        floor,
        rooms=(
            floor.rooms[0],
            floor.rooms[1],
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"]["area"] = deepcopy(area)
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", changed
    ) == AreaBindingUpgradeResult(1, False)
    manager.repository.store.async_save.assert_awaited_once()
    saved = manager.catalog.area("serial", "area")["map_binding"][
        "translation_room_anchors"
    ]
    assert all("boundary_mm" in anchor for anchor in saved)
    assert (
        binding.area_binding_status(manager.catalog.area("serial", "area"), changed)
        is binding.AreaBindingStatus.CURRENT
    )


async def test_legacy_graft_fails_closed_when_shared_query_budget_exhausts(hass):
    floor = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    floor = replace(floor, rooms=(*floor.rooms, remote))
    area = _area(floor)
    area["map_binding"]["translation_room_anchors"][0].pop("boundary_mm")
    changed = replace(
        floor,
        rooms=(
            floor.rooms[0],
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"]["area"] = deepcopy(area)
    before = manager.catalog.areas("serial")
    with patch.object(RoomGeometryIndex, "_MAX_QUERY_WORK", 300):
        assert await manager.catalog.async_upgrade_area_bindings(
            "serial", changed
        ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    assert manager.catalog.areas("serial") == before


async def test_legacy_enrichment_respects_aggregate_frame_point_limit(hass):
    floor = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    floor = replace(floor, rooms=(*floor.rooms, remote))
    legacy = _area(floor)
    legacy["map_binding"]["translation_room_anchors"][0].pop("boundary_mm")
    changed = replace(
        floor,
        rooms=(
            floor.rooms[0],
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["areas"] = {
        "legacy": deepcopy(legacy),
        "existing": _area(changed),
    }
    before = deepcopy(manager.catalog.areas("serial"))
    with patch(
        "custom_components.matic_robot.plan_catalog._MAX_PERSISTED_ROOM_FRAME_POINTS_PER_ROBOT",
        7,
    ):
        result = await manager.catalog.async_upgrade_area_bindings("serial", changed)
    assert result == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    assert manager.catalog.areas("serial") == before


async def test_legacy_enrichment_rolls_back_when_store_write_fails(hass):
    floor = _floor()
    remote = Room(
        "remote", "Remote", "remote", b"remote", ((20, 0), (30, 0), (30, 10), (20, 10))
    )
    floor = replace(floor, rooms=(*floor.rooms, remote))
    legacy = _area(floor)
    legacy["map_binding"]["translation_room_anchors"][0].pop("boundary_mm")
    changed = replace(
        floor,
        rooms=(
            floor.rooms[0],
            replace(remote, boundary=((20, 0), (31, 0), (31, 10), (20, 10))),
        ),
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_save=AsyncMock(side_effect=OSError("disk"))
    )
    manager.repository.robot("serial")["areas"]["legacy"] = deepcopy(legacy)
    before = manager.catalog.areas("serial")
    with pytest.raises(OSError, match="disk"):
        await manager.catalog.async_upgrade_area_bindings("serial", changed)
    assert manager.catalog.areas("serial") == before
