"""Validation tests for the private drawn-area selector."""

import pytest
import voluptuous as vol

from custom_components.matic_robot.area_selector import (
    GeometryTooComplex,
    MaticAreaSelector,
    _IndexedPolygon,
    _RoomGeometryIndex,
)


def _selector() -> MaticAreaSelector:
    return MaticAreaSelector(
        {
            "scene_url": "/api/matic_robot/slam_scene/0123456789abcdef",
            "rooms": [
                {
                    "room_id": "office",
                    "name": "Office",
                    "boundary": [[0, 0], [3, 0], [3, 2], [0, 2]],
                }
            ],
        }
    )


def test_area_selector_preserves_private_geometry() -> None:
    value = [{"x": 1, "y": 1.25, "radius": 0.35}]
    assert _selector()(value) == [{"x": 1.0, "y": 1.25, "radius": 0.35}]
    serialized = _selector().serialize()["selector"]["matic-area"]
    assert serialized["rooms"][0]["name"] == "Office"
    assert serialized["scene_url"] == ("/api/matic_robot/slam_scene/0123456789abcdef")


def test_area_selector_rejects_an_external_scene_url() -> None:
    """The editor can fetch only its private integration-owned scene route."""
    with pytest.raises(vol.Invalid):
        MaticAreaSelector(
            {
                "rooms": [],
                "scene_url": "https://example.invalid/private-map",
            }
        )


@pytest.mark.parametrize(
    "value",
    [
        [],
        "not-a-list",
        [{"x": 1, "y": 1, "radius": 0.01}],
        [{"x": float("inf"), "y": 1, "radius": 0.3}],
        [{"x": 1, "y": 1, "radius": 0.3, "private": "extra"}],
        [{"x": 4, "y": 1, "radius": 0.3}],
    ],
)
def test_area_selector_rejects_invalid_geometry(value) -> None:
    with pytest.raises(vol.Invalid):
        _selector()(value)


def test_area_selector_accepts_room_boundary_points() -> None:
    """A mark centered exactly on a mapped edge remains usable."""
    assert _selector()([{"x": 0, "y": 1, "radius": 0.3}]) == [
        {"x": 0.0, "y": 1.0, "radius": 0.3}
    ]


@pytest.mark.parametrize("tolerance", [0.0, 0.01])
def test_indexed_room_geometry_matches_reference_polygon(tolerance: float) -> None:
    """The acceleration index preserves exact boundary and tolerance semantics."""
    boundary = [
        [0.0, 0.0],
        [3.0, 0.0],
        [3.0, 1.0],
        [2.0, 1.0],
        [2.0, 2.0],
        [0.0, 2.0],
    ]
    geometry = _RoomGeometryIndex(
        [{"room_id": "room", "name": "Room", "boundary": boundary}]
    )
    for x, y in (
        (-0.005, 1.0),
        (0.0, 1.0),
        (1.0, 1.0),
        (2.5, 1.5),
        (3.0, 0.5),
        (3.005, 0.5),
    ):
        assert geometry.contains(x, y, tolerance) is (
            MaticAreaSelector._point_in_or_near_polygon(x, y, boundary, tolerance)
        )


def test_polygon_storage_does_not_expand_edges_across_vertical_buckets() -> None:
    """A tall zigzag polygon uses the bounded fallback."""
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(4_096)
    ]

    polygon = _IndexedPolygon(boundary)

    assert polygon.boundary is boundary
    assert polygon.overloaded is True
    assert (
        sum(map(len, polygon.edges_by_bucket.values())) <= polygon._MAX_EDGE_REFERENCES
    )
    assert polygon.contains(1.0, 0.0, 0.0) is False


def test_overloaded_index_preserves_comb_polygon_containment() -> None:
    """A concave comb remains queryable when bucket references are capped."""
    boundary = [[0.0, 0.0], [0.0, 10_000.0]]
    for tooth in range(68):
        x = float(tooth + 1)
        boundary.extend([[x, 10_000.0], [x, 0.0]])
    boundary.extend([[69.0, 0.0], [69.0, 10_000.0]])

    polygon = _IndexedPolygon(boundary)

    assert polygon.overloaded is True
    assert polygon.contains(68.5, 5_000.0, 0.0) is True
    assert polygon.contains(68.5, 5_000.0, 0.0) is MaticAreaSelector._point_in_polygon(
        68.5, 5_000.0, boundary
    )


def test_overloaded_index_rejects_boundary_larger_than_fallback_cap() -> None:
    """The fallback has a fixed maximum amount of polygon work."""
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0]
        for index in range(_IndexedPolygon._MAX_FALLBACK_EDGES + 1)
    ]

    polygon = _IndexedPolygon(boundary)

    assert polygon.overloaded is True
    assert polygon.contains(1.0, 0.5, 0.0) is False


def test_room_index_caps_aggregate_overloaded_fallback_work() -> None:
    """Overlapping hostile rooms cannot multiply linear fallback work forever."""
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(256)
    ]
    geometry = _RoomGeometryIndex(
        [
            {"room_id": str(index), "name": "Room", "boundary": boundary}
            for index in range(256)
        ]
    )

    for _ in range(geometry._MAX_FALLBACK_WORK // len(boundary) + 1):
        try:
            geometry.contains(128.5, 0.0)
        except ValueError:
            break
    else:
        pytest.fail("fallback budget was not exhausted")

    assert geometry._fallback_work_remaining < len(boundary)
    with pytest.raises(ValueError, match="fallback budget exhausted"):
        geometry.contains(128.5, 0.0)


def test_room_index_fair_fallback_does_not_depend_on_room_order() -> None:
    """A probe in the last overloaded room is found regardless of ordering."""
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(244)
    ]
    rooms = [
        {"room_id": str(index), "name": "Room", "boundary": boundary}
        for index in range(256)
    ]
    forward = _RoomGeometryIndex(rooms)
    reverse = _RoomGeometryIndex(list(reversed(rooms)))

    assert forward.contains(120.5, 0.0) is True
    assert reverse.contains(120.5, 0.0) is True


def test_room_index_does_not_false_negative_late_candidate_after_budget() -> None:
    """Budget exhaustion reports uncertainty instead of rejecting a late room."""
    outside = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(244)
    ]
    geometry = _RoomGeometryIndex(
        [
            {"room_id": str(index), "name": "Room", "boundary": outside}
            for index in range(255)
        ]
        + [{"room_id": "last", "name": "Room", "boundary": outside}]
    )

    for _ in range(geometry._MAX_FALLBACK_WORK // 244 + 1):
        try:
            geometry.contains(120.0, 0.0)
        except ValueError as err:
            assert "fallback budget exhausted" in str(err)
            break
    else:
        pytest.fail("fallback budget was not exhausted")


def test_room_index_skips_overloaded_polygon_outside_bounds() -> None:
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(140)
    ]
    geometry = _RoomGeometryIndex(
        [{"room_id": "room", "name": "Room", "boundary": boundary}]
    )
    remaining = geometry._fallback_work_remaining

    assert geometry.contains(-1.0, 0.0) is False
    assert geometry._fallback_work_remaining == remaining


def test_room_index_reports_exhausted_single_polygon_fallback_budget() -> None:
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(256)
    ]
    geometry = _RoomGeometryIndex(
        [{"room_id": "room", "name": "Room", "boundary": boundary}]
    )
    geometry._fallback_work_remaining = len(boundary) - 1

    with pytest.raises(GeometryTooComplex, match="fallback budget exhausted"):
        geometry.contains(128.5, 0.0)


def test_area_selector_rejects_geometry_budget_exhaustion() -> None:
    selector = MaticAreaSelector(
        {
            "rooms": [
                {
                    "room_id": "room",
                    "name": "Room",
                    "boundary": [
                        [float(index), -10_000.0 if index % 2 else 10_000.0]
                        for index in range(256)
                    ],
                }
            ]
        }
    )
    geometry = _RoomGeometryIndex(selector.config["rooms"])
    geometry._fallback_work_remaining = 0

    with pytest.raises(vol.Invalid, match="fallback budget exhausted"):
        selector.validate([{"x": 128.5, "y": 0.0, "radius": 0.3}], geometry=geometry)


def test_room_index_rejects_polygon_over_fallback_cap_as_uncertain() -> None:
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0]
        for index in range(_IndexedPolygon._MAX_FALLBACK_EDGES + 1)
    ]
    geometry = _RoomGeometryIndex(
        [{"room_id": "room", "name": "Room", "boundary": boundary}]
    )
    assert len(boundary) > _IndexedPolygon._MAX_FALLBACK_EDGES

    with pytest.raises(GeometryTooComplex, match="fallback edge limit"):
        geometry.contains(128.5, 0.0)
