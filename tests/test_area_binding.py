"""Stable binding of private custom areas to synthetic floor plans."""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest

from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    MAP_BINDING_VERSION,
    SCOPED_MAP_BINDING_VERSION,
    AreaBindingStatus,
    _hash_only_area_geometry_fingerprint,
    _local_segment_geometries_match,
    _local_segments_match,
    area_binding_allows_review,
    area_binding_status,
    area_geometry_fingerprint,
    async_delete_custom_area_issue,
    async_sync_custom_area_issue,
    binding_for_area,
    binding_for_floor_plan,
    custom_area_issue_id,
    floor_plan_geometry_fingerprint,
)
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.const import DOMAIN


def _room(
    room_id: str,
    name: str,
    boundary: tuple[tuple[float, float], ...],
) -> Room:
    return Room(room_id, name, f"protocol-{room_id}", room_id.encode(), boundary)


def _floor_plan() -> FloorPlan:
    return FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            _room(
                "kitchen",
                "Kitchen",
                ((-0.0, 0.0), (2.0, 0.0), (2.0, 1.5), (0.0, 1.5)),
            ),
            _room(
                "study",
                "Study",
                ((2.0, 0.0), (3.0, 0.0), (3.0, 1.0), (2.0, 1.0)),
            ),
        ),
    )


def _area(floor_plan: FloorPlan | None = None) -> dict[str, object]:
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "map_binding": binding_for_floor_plan(floor_plan or _floor_plan()),
    }


def _scoped_area(
    floor_plan: FloorPlan | None = None,
    circles: list[dict[str, float]] | None = None,
) -> dict[str, object]:
    plan = floor_plan or _floor_plan()
    saved_circles = circles or [{"x": 0.5, "y": 0.5, "radius": 0.1}]
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": saved_circles,
        "map_binding": binding_for_area(plan, saved_circles),
    }


def _hash_only_scoped_area(
    floor_plan: FloorPlan | None = None,
    circles: list[dict[str, float]] | None = None,
) -> dict[str, object]:
    plan = floor_plan or _floor_plan()
    saved_circles = circles or [{"x": 0.5, "y": 0.5, "radius": 0.1}]
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": saved_circles,
        "map_binding": {
            **binding_for_floor_plan(plan),
            "version": HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            "local_geometry_sha256": _hash_only_area_geometry_fingerprint(
                plan, saved_circles
            ),
        },
    }


def test_fingerprint_ignores_labels_order_start_winding_and_polygon_closure() -> None:
    floor_plan = _floor_plan()
    kitchen, study = floor_plan.rooms
    equivalent = replace(
        floor_plan,
        rooms=(
            replace(
                study,
                id="renumbered-study",
                name="Work room",
                protocol_id="different-protocol",
                boundary=((3.0, 1.0), (3.0, 0.0), (2.0, 0.0), (2.0, 1.0)),
            ),
            replace(
                kitchen,
                id="renumbered-kitchen",
                name="Galley",
                protocol_id="another-protocol",
                boundary=(
                    (2.0, 1.5),
                    (2.0, 0.0),
                    (0.0, -0.0),
                    (0.0, 1.5),
                    (2.0, 1.5),
                ),
            ),
        ),
    )

    assert floor_plan_geometry_fingerprint(equivalent) == (
        floor_plan_geometry_fingerprint(floor_plan)
    )


def test_fingerprint_quantizes_to_millimeters_and_detects_real_change() -> None:
    floor_plan = _floor_plan()
    kitchen, study = floor_plan.rooms
    submillimeter = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=((0.0004, 0.0), *kitchen.boundary[1:]),
            ),
            study,
        ),
    )
    changed = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=((0.001, 0.0), *kitchen.boundary[1:]),
            ),
            study,
        ),
    )

    original = floor_plan_geometry_fingerprint(floor_plan)
    assert floor_plan_geometry_fingerprint(submillimeter) == original
    assert floor_plan_geometry_fingerprint(changed) != original


def test_fingerprint_preserves_duplicate_polygons() -> None:
    floor_plan = _floor_plan()
    duplicate = replace(
        floor_plan,
        rooms=(*floor_plan.rooms, replace(floor_plan.rooms[0], id="duplicate")),
    )

    assert floor_plan_geometry_fingerprint(duplicate) != (
        floor_plan_geometry_fingerprint(floor_plan)
    )


@pytest.mark.parametrize(
    "floor_plan, error",
    [
        (replace(_floor_plan(), rooms=()), "no room geometry"),
        (
            replace(
                _floor_plan(),
                rooms=(
                    replace(
                        _floor_plan().rooms[0],
                        boundary=((0.0, 0.0), (0.0004, 0.0), (0.0, 0.0004)),
                    ),
                ),
            ),
            "fewer than three",
        ),
        (
            replace(
                _floor_plan(),
                rooms=(
                    replace(
                        _floor_plan().rooms[0],
                        boundary=((float("nan"), 0.0), (1.0, 0.0), (0.0, 1.0)),
                    ),
                ),
            ),
            "finite",
        ),
        (
            replace(
                _floor_plan(),
                rooms=(
                    replace(
                        _floor_plan().rooms[0],
                        boundary=((1e308, 0.0), (1.0, 0.0), (0.0, 1.0)),
                    ),
                ),
            ),
            "out of range",
        ),
        (
            replace(
                _floor_plan(),
                rooms=(
                    replace(
                        _floor_plan().rooms[0],
                        boundary=((1e16, 0.0), (1.0, 0.0), (0.0, 1.0)),
                    ),
                ),
            ),
            "out of range",
        ),
    ],
)
def test_fingerprint_rejects_unusable_geometry(
    floor_plan: FloorPlan, error: str
) -> None:
    with pytest.raises(ValueError, match=error):
        floor_plan_geometry_fingerprint(floor_plan)


@pytest.mark.parametrize(
    "floor_plan",
    [
        replace(_floor_plan(), mission_id=-1),
        replace(_floor_plan(), mission_id=1 << 32),
        replace(_floor_plan(), mission_id=True),
        replace(_floor_plan(), partition_protocol_id=""),
    ],
)
def test_binding_rejects_invalid_floor_identity(floor_plan: FloorPlan) -> None:
    with pytest.raises(ValueError):
        binding_for_floor_plan(floor_plan)


def test_binding_contains_only_versioned_current_map_identity() -> None:
    floor_plan = _floor_plan()

    assert binding_for_floor_plan(floor_plan) == {
        "version": MAP_BINDING_VERSION,
        "mission_id": 42,
        "partition_id": "synthetic-partition",
        "geometry_sha256": floor_plan_geometry_fingerprint(floor_plan),
    }


def test_scoped_binding_contains_private_local_geometry_signature() -> None:
    floor_plan = _floor_plan()
    circles = [
        {"x": 0.5, "y": 0.5, "radius": 0.1},
        {"x": 0.7, "y": 0.5, "radius": 0.15},
    ]

    binding = binding_for_area(floor_plan, circles)
    assert binding == {
        "version": SCOPED_MAP_BINDING_VERSION,
        "mission_id": 42,
        "partition_id": "synthetic-partition",
        "geometry_sha256": floor_plan_geometry_fingerprint(floor_plan),
        "area_shape_sha256": binding["area_shape_sha256"],
        "local_geometry_sha256": area_geometry_fingerprint(floor_plan, circles),
        "local_occupancy": [511, 511],
        "local_segments_mm": [],
    }
    assert len(binding["area_shape_sha256"]) == 64
    assert binding_for_area(floor_plan, list(reversed(circles))) == binding
    assert area_geometry_fingerprint(floor_plan, circles) == (
        area_geometry_fingerprint(floor_plan, list(reversed(circles)))
    )


def test_scoped_binding_automatically_accepts_unrelated_geometry_changes() -> None:
    floor_plan = _floor_plan()
    area = _scoped_area(floor_plan)
    kitchen, study = floor_plan.rooms
    changed_elsewhere = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=((0.0, 0.0), (2.2, 0.0), (2.2, 1.5), (0.0, 1.5)),
            ),
            replace(
                study,
                boundary=((2.2, 0.0), (3.2, 0.0), (3.2, 1.0), (2.2, 1.0)),
            ),
        ),
    )

    assert floor_plan_geometry_fingerprint(changed_elsewhere) != (
        floor_plan_geometry_fingerprint(floor_plan)
    )
    assert area_binding_status(area, changed_elsewhere) is AreaBindingStatus.CURRENT


def test_scoped_binding_uses_union_of_separated_mark_neighborhoods() -> None:
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            _room(
                "outer",
                "Outer",
                ((0.0, 0.0), (10.0, 0.0), (10.0, 2.0), (0.0, 2.0)),
            ),
            _room(
                "middle",
                "Middle",
                ((4.5, 0.5), (5.5, 0.5), (5.5, 1.5), (4.5, 1.5)),
            ),
        ),
    )
    circles = [
        {"x": 1.0, "y": 1.0, "radius": 0.1},
        {"x": 9.0, "y": 1.0, "radius": 0.1},
    ]
    area = _scoped_area(floor_plan, circles)
    changed_between_marks = replace(
        floor_plan,
        rooms=(
            floor_plan.rooms[0],
            replace(
                floor_plan.rooms[1],
                boundary=((4.4, 0.5), (5.6, 0.5), (5.6, 1.5), (4.4, 1.5)),
            ),
        ),
    )

    assert floor_plan_geometry_fingerprint(changed_between_marks) != (
        floor_plan_geometry_fingerprint(floor_plan)
    )
    assert area_binding_status(area, changed_between_marks) is AreaBindingStatus.CURRENT


def test_hash_only_v2_binding_remains_valid_for_safe_migration() -> None:
    floor_plan = _floor_plan()
    circles = [{"x": 0.1, "y": 0.5, "radius": 0.05}]
    area = _hash_only_scoped_area(floor_plan, circles)
    kitchen, study = floor_plan.rooms
    changed_elsewhere = replace(
        floor_plan,
        rooms=(
            kitchen,
            replace(
                study,
                boundary=((2.1, 0.0), (3.1, 0.0), (3.1, 1.0), (2.1, 1.0)),
            ),
        ),
    )

    assert area_binding_status(area, floor_plan) is AreaBindingStatus.CURRENT
    assert area_binding_status(area, changed_elsewhere) is AreaBindingStatus.CURRENT
    invalid = {
        **area,
        "map_binding": {
            **area["map_binding"],
            "local_geometry_sha256": "0" * 64,
        },
    }
    assert area_binding_status(invalid, floor_plan) is AreaBindingStatus.INVALID
    missing_circles = {key: value for key, value in area.items() if key != "circles"}
    assert area_binding_status(missing_circles, floor_plan) is AreaBindingStatus.INVALID
    changed_nearby = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=((0.05, 0.0), *kitchen.boundary[1:]),
            ),
            study,
        ),
    )
    assert (
        area_binding_status(area, changed_nearby) is AreaBindingStatus.GEOMETRY_CHANGED
    )


def test_scoped_binding_tolerates_local_subcentimeter_jitter() -> None:
    original = _floor_plan()
    floor_plan = replace(
        original,
        rooms=(
            replace(
                original.rooms[0],
                boundary=((0.004, 0.0), *original.rooms[0].boundary[1:]),
            ),
            original.rooms[1],
        ),
    )
    circles = [{"x": 0.1, "y": 0.5, "radius": 0.05}]
    area = _scoped_area(floor_plan, circles)
    kitchen, study = floor_plan.rooms
    jittered = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=((0.006, 0.0), *kitchen.boundary[1:]),
            ),
            study,
        ),
    )

    assert floor_plan_geometry_fingerprint(jittered) != (
        floor_plan_geometry_fingerprint(floor_plan)
    )
    assert area_binding_status(area, jittered) is AreaBindingStatus.CURRENT


def test_scoped_binding_tolerates_probe_occupancy_flip_at_jittered_wall() -> None:
    floor_plan = _floor_plan()
    circles = [{"x": 0.35, "y": 0.5, "radius": 0.1}]
    area = _scoped_area(floor_plan, circles)
    kitchen, study = floor_plan.rooms
    jittered = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=(
                    (0.002, 0.0),
                    *kitchen.boundary[1:-1],
                    (0.002, 1.5),
                ),
            ),
            study,
        ),
    )

    current_binding = binding_for_area(jittered, circles)
    assert area["map_binding"]["local_occupancy"] != current_binding["local_occupancy"]
    assert area_binding_status(area, jittered) is AreaBindingStatus.CURRENT


def test_scoped_binding_tolerates_probe_flip_with_unchanged_map_hash() -> None:
    floor_plan = _floor_plan()
    kitchen, study = floor_plan.rooms
    floor_plan = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=(
                    (0.0001, 0.0),
                    *kitchen.boundary[1:-1],
                    (0.0001, 1.5),
                ),
            ),
            study,
        ),
    )
    # The lower-left diagonal probe lands at x=0.00025, between both wall
    # positions, while the wall remains inside the local segment neighborhood.
    circles = [{"x": 0.2477373734152916, "y": 0.5, "radius": 0.1}]
    area = _scoped_area(floor_plan, circles)
    jittered = replace(
        floor_plan,
        rooms=(
            replace(
                floor_plan.rooms[0],
                boundary=(
                    (0.0004, 0.0),
                    *floor_plan.rooms[0].boundary[1:-1],
                    (0.0004, 1.5),
                ),
            ),
            study,
        ),
    )

    current_binding = binding_for_area(jittered, circles)
    assert floor_plan_geometry_fingerprint(jittered) == (
        floor_plan_geometry_fingerprint(floor_plan)
    )
    assert area["map_binding"]["local_occupancy"] != current_binding["local_occupancy"]
    assert (
        area["map_binding"]["local_segments_mm"] == current_binding["local_segments_mm"]
    )
    assert area_binding_status(area, jittered) is AreaBindingStatus.CURRENT


def test_scoped_binding_ignores_jitter_at_guard_band_cutoff() -> None:
    floor_plan = _floor_plan()
    kitchen, study = floor_plan.rooms
    floor_plan = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=(
                    (0.139, 0.0),
                    *kitchen.boundary[1:-1],
                    (0.139, 1.5),
                ),
            ),
            study,
        ),
    )
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.1}]
    area = _scoped_area(floor_plan, circles)
    jittered = replace(
        floor_plan,
        rooms=(
            replace(
                floor_plan.rooms[0],
                boundary=(
                    (0.141, 0.0),
                    *floor_plan.rooms[0].boundary[1:-1],
                    (0.141, 1.5),
                ),
            ),
            study,
        ),
    )

    current_binding = binding_for_area(jittered, circles)
    assert area["map_binding"]["local_segments_mm"] == []
    assert current_binding["local_segments_mm"]
    assert area_binding_status(area, jittered) is AreaBindingStatus.CURRENT


def test_local_segment_matching_finds_non_greedy_pairing() -> None:
    saved = ((0, 0, 100, 0), (0, 10, 100, 10))
    current = ((0, 1, 100, 1), (1, -10, 101, -10))

    assert _local_segments_match(saved, current, ((50, 0, 0),))


@pytest.mark.parametrize(
    ("saved", "current", "shape", "expected"),
    [
        (
            (0, 0, 100, 0),
            (0, 1, 100, 1),
            ((1000, 1000, 0), (50, 0, 0)),
            True,
        ),
        ((0, 0, 100, 0), (1000, 0, 1100, 0), ((50, 0, 0),), False),
        ((0, 0, 100, 0), (0, 1, 100, 1), ((1000, 1000, 0),), False),
        ((0, 0, 0, 0), (1, 1, 1, 1), ((0, 0, 0),), True),
    ],
)
def test_local_segment_geometry_matching_edge_cases(
    saved: tuple[int, int, int, int],
    current: tuple[int, int, int, int],
    shape: tuple[tuple[int, int, int], ...],
    expected: bool,
) -> None:
    assert _local_segment_geometries_match(saved, current, shape) is expected


def test_scoped_binding_tolerates_diagonal_clipping_amplification() -> None:
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            _room(
                "sloped",
                "Sloped",
                ((0.0, 0.136), (1.0, 0.156), (1.0, 1.5), (0.0, 1.5)),
            ),
        ),
    )
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.1}]
    area = _scoped_area(floor_plan, circles)
    jittered = replace(
        floor_plan,
        rooms=(
            replace(
                floor_plan.rooms[0],
                boundary=((0.0, 0.138), (1.0, 0.158), (1.0, 1.5), (0.0, 1.5)),
            ),
        ),
    )

    assert area["map_binding"]["local_segments_mm"] == [[0, 136, 1000, 156]]
    assert area_binding_status(area, jittered) is AreaBindingStatus.CURRENT


def test_scoped_binding_preserves_tolerant_shared_wall_multiplicity() -> None:
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            _room(
                "left",
                "Left",
                ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)),
            ),
            _room(
                "right",
                "Right",
                ((1.0, 0.0), (2.0, 0.0), (2.0, 1.0), (1.0, 1.0)),
            ),
        ),
    )
    circles = [{"x": 1.0, "y": 0.5, "radius": 0.1}]
    area = _scoped_area(floor_plan, circles)
    jittered = replace(
        floor_plan,
        rooms=(
            floor_plan.rooms[0],
            replace(
                floor_plan.rooms[1],
                boundary=(
                    (1.002, 0.0),
                    *floor_plan.rooms[1].boundary[1:-1],
                    (1.002, 1.0),
                ),
            ),
        ),
    )

    assert area["map_binding"]["local_segments_mm"] == [
        [1000, 0, 1000, 1000],
        [1000, 0, 1000, 1000],
    ]
    assert area_binding_status(area, jittered) is AreaBindingStatus.CURRENT


def test_scoped_binding_ignores_overlapping_circle_guard_cutoff() -> None:
    floor_plan = _floor_plan()
    kitchen, study = floor_plan.rooms
    floor_plan = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=(
                    (0.139, 0.0),
                    *kitchen.boundary[1:-1],
                    (0.139, 1.5),
                ),
            ),
            study,
        ),
    )
    circles = [
        {"x": 0.45, "y": 0.5, "radius": 0.1},
        {"x": 0.5, "y": 0.5, "radius": 0.1},
    ]
    area = _scoped_area(floor_plan, circles)
    jittered = replace(
        floor_plan,
        rooms=(
            replace(
                floor_plan.rooms[0],
                boundary=(
                    (0.141, 0.0),
                    *floor_plan.rooms[0].boundary[1:-1],
                    (0.141, 1.5),
                ),
            ),
            study,
        ),
    )

    assert area_binding_status(area, jittered) is AreaBindingStatus.CURRENT


def test_scoped_binding_rejects_tampered_tolerance_evidence() -> None:
    floor_plan = _floor_plan()
    circles = [{"x": 0.1, "y": 0.5, "radius": 0.05}]
    area = _scoped_area(floor_plan, circles)
    binding = dict(area["map_binding"])
    segments = [list(segment) for segment in binding["local_segments_mm"]]
    assert segments
    segments[0][0] += 1
    binding["local_segments_mm"] = segments

    assert (
        area_binding_status({**area, "map_binding": binding}, floor_plan)
        is AreaBindingStatus.INVALID
    )


def test_scoped_binding_rejects_self_consistent_wrong_local_evidence() -> None:
    floor_plan = _floor_plan()
    circles = [{"x": 0.1, "y": 0.5, "radius": 0.05}]
    changed_floor = replace(
        floor_plan,
        rooms=(
            replace(
                floor_plan.rooms[0],
                boundary=((0.05, 0.0), *floor_plan.rooms[0].boundary[1:]),
            ),
            floor_plan.rooms[1],
        ),
    )
    wrong_binding = binding_for_area(changed_floor, circles)
    wrong_binding["geometry_sha256"] = floor_plan_geometry_fingerprint(floor_plan)

    assert (
        area_binding_status(
            {
                "schema_version": AREA_SCHEMA_VERSION,
                "circles": circles,
                "map_binding": wrong_binding,
            },
            floor_plan,
        )
        is AreaBindingStatus.INVALID
    )


def test_scoped_binding_blocks_a_new_local_boundary() -> None:
    floor_plan = _floor_plan()
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.1}]
    area = _scoped_area(floor_plan, circles)
    added_boundary = replace(
        floor_plan,
        rooms=(
            *floor_plan.rooms,
            _room(
                "overlap",
                "Overlap",
                ((0.4, 0.4), (0.6, 0.4), (0.6, 0.6), (0.4, 0.6)),
            ),
        ),
    )

    assert (
        area_binding_status(area, added_boundary) is AreaBindingStatus.GEOMETRY_CHANGED
    )


def test_scoped_binding_blocks_nearby_geometry_and_circle_changes() -> None:
    floor_plan = _floor_plan()
    circles = [{"x": 0.1, "y": 0.5, "radius": 0.05}]
    area = _scoped_area(floor_plan, circles)
    kitchen, study = floor_plan.rooms
    nearby_change = replace(
        floor_plan,
        rooms=(
            replace(
                kitchen,
                boundary=((0.05, 0.0), *kitchen.boundary[1:]),
            ),
            study,
        ),
    )

    assert (
        area_binding_status(area, nearby_change) is AreaBindingStatus.GEOMETRY_CHANGED
    )
    changed_circles = {**area, "circles": [{"x": 0.2, "y": 0.5, "radius": 0.05}]}
    assert area_binding_status(changed_circles, floor_plan) is AreaBindingStatus.INVALID
    missing_circles = {key: value for key, value in area.items() if key != "circles"}
    assert area_binding_status(missing_circles, floor_plan) is AreaBindingStatus.INVALID


def test_stale_same_map_area_can_be_reviewed_without_blind_rebinding() -> None:
    floor_plan = _floor_plan()
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.1}]
    area = {**_area(floor_plan), "circles": circles}
    changed = replace(
        floor_plan,
        rooms=(
            replace(
                floor_plan.rooms[0],
                boundary=((0.01, 0.0), *floor_plan.rooms[0].boundary[1:]),
            ),
            floor_plan.rooms[1],
        ),
    )

    assert area_binding_allows_review(area, changed) is True
    assert (
        area_binding_allows_review(
            area, replace(changed, mission_id=changed.mission_id + 1)
        )
        is False
    )
    assert (
        area_binding_allows_review(
            {**area, "circles": [{"x": 20.0, "y": 20.0, "radius": 0.1}]},
            changed,
        )
        is False
    )


@pytest.mark.parametrize(
    ("area", "floor_plan", "expected"),
    [
        ({}, _floor_plan(), AreaBindingStatus.LEGACY),
        ({"schema_version": 0}, _floor_plan(), AreaBindingStatus.LEGACY),
        ({"schema_version": False}, _floor_plan(), AreaBindingStatus.INVALID),
        ({"schema_version": True}, _floor_plan(), AreaBindingStatus.INVALID),
        ({"schema_version": 2}, _floor_plan(), AreaBindingStatus.INVALID),
        (
            {"schema_version": AREA_SCHEMA_VERSION},
            _floor_plan(),
            AreaBindingStatus.INVALID,
        ),
        (
            {
                "schema_version": AREA_SCHEMA_VERSION,
                "map_binding": {
                    **binding_for_floor_plan(_floor_plan()),
                    "unexpected": "field",
                },
            },
            _floor_plan(),
            AreaBindingStatus.INVALID,
        ),
        (
            _area(),
            replace(_floor_plan(), mission_id=43),
            AreaBindingStatus.MISSION_CHANGED,
        ),
        (
            _area(),
            replace(_floor_plan(), partition_protocol_id="new-partition"),
            AreaBindingStatus.PARTITION_CHANGED,
        ),
        (
            _area(),
            replace(
                _floor_plan(),
                rooms=(
                    replace(
                        _floor_plan().rooms[0],
                        boundary=((0.01, 0.0), *_floor_plan().rooms[0].boundary[1:]),
                    ),
                    _floor_plan().rooms[1],
                ),
            ),
            AreaBindingStatus.GEOMETRY_CHANGED,
        ),
        (
            _area(),
            replace(_floor_plan(), rooms=()),
            AreaBindingStatus.INVALID,
        ),
        (_area(), _floor_plan(), AreaBindingStatus.CURRENT),
    ],
)
def test_area_binding_status_is_conservative(
    area: dict[str, object],
    floor_plan: FloorPlan,
    expected: AreaBindingStatus,
) -> None:
    assert area_binding_status(area, floor_plan) is expected


def test_binding_status_accepts_uppercase_digest_but_rejects_malformed_values() -> None:
    floor_plan = _floor_plan()
    binding = binding_for_floor_plan(floor_plan)
    uppercase = _area()
    uppercase["map_binding"] = {
        **binding,
        "geometry_sha256": str(binding["geometry_sha256"]).upper(),
    }
    assert area_binding_status(uppercase, floor_plan) is AreaBindingStatus.CURRENT

    for key, value in (
        ("version", True),
        ("version", MAP_BINDING_VERSION + 1),
        ("mission_id", True),
        ("mission_id", -1),
        ("partition_id", ""),
        ("geometry_sha256", "not-a-digest"),
    ):
        malformed = _area()
        malformed["map_binding"] = {**binding, key: value}
        assert area_binding_status(malformed, floor_plan) is AreaBindingStatus.INVALID


def test_area_issue_sync_deduplicates_updates_and_exposes_only_stale_count() -> None:
    hass = MagicMock()
    floor_plan = _floor_plan()
    current = _area(floor_plan)
    legacy = {
        "name": "Private litter location",
        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
    }
    issue_id = custom_area_issue_id("private-entry-id")
    assert "private-entry-id" not in issue_id

    with (
        patch(
            "custom_components.matic_robot.area_binding.ir.async_create_issue"
        ) as create,
        patch(
            "custom_components.matic_robot.area_binding.ir.async_delete_issue"
        ) as delete,
    ):
        assert (
            async_sync_custom_area_issue(
                hass,
                "private-entry-id",
                {"current": current, "private_area_name": legacy},
                floor_plan,
            )
            == 1
        )
        assert (
            async_sync_custom_area_issue(
                hass,
                "private-entry-id",
                {
                    "current": current,
                    "private_area_name": legacy,
                    "malformed_private_area": "invalid",
                },
                floor_plan,
            )
            == 2
        )

    assert create.call_count == 2
    for call in create.call_args_list:
        assert call.args == (hass, DOMAIN, issue_id)
        assert call.kwargs["is_fixable"] is False
        assert call.kwargs["is_persistent"] is True
        assert call.kwargs["severity"].value == "warning"
        assert call.kwargs["translation_key"] == "custom_area_map_changed"
        assert call.kwargs["learn_more_url"].endswith("#drawn-custom-areas")
        serialized = repr(call)
        assert "Private litter location" not in serialized
        assert "private_area_name" not in serialized
        assert "circles" not in serialized
    assert create.call_args.kwargs["translation_placeholders"] == {"count": "2"}
    delete.assert_not_called()


def test_area_issue_sync_preserves_unknown_state_and_clears_verified_state() -> None:
    hass = MagicMock()
    floor_plan = _floor_plan()
    issue_id = custom_area_issue_id("entry")
    with (
        patch(
            "custom_components.matic_robot.area_binding.ir.async_create_issue"
        ) as create,
        patch(
            "custom_components.matic_robot.area_binding.ir.async_delete_issue"
        ) as delete,
    ):
        assert async_sync_custom_area_issue(hass, "entry", {}, None) is None
        assert (
            async_sync_custom_area_issue(
                hass, "entry", {}, replace(floor_plan, rooms=())
            )
            is None
        )
        create.assert_not_called()
        delete.assert_not_called()

        assert async_sync_custom_area_issue(hass, "entry", {}, floor_plan) == 0
        assert (
            async_sync_custom_area_issue(
                hass, "entry", {"current": _area(floor_plan)}, floor_plan
            )
            == 0
        )
        assert delete.call_count == 2
        assert all(
            call.args == (hass, DOMAIN, issue_id) for call in delete.call_args_list
        )
        create.assert_not_called()


def test_delete_custom_area_issue_uses_the_private_stable_key() -> None:
    hass = MagicMock()
    with patch(
        "custom_components.matic_robot.area_binding.ir.async_delete_issue"
    ) as delete:
        async_delete_custom_area_issue(hass, "entry")

    delete.assert_called_once_with(hass, DOMAIN, custom_area_issue_id("entry"))
