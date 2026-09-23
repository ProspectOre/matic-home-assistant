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


def test_point_in_polygon_accepts_a_boundary_point() -> None:
    boundary = [[0.0, 0.0], [2.0, 0.0], [0.0, 2.0]]

    assert MaticAreaSelector._point_in_polygon(1.0, 0.0, boundary) is True


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
    assert polygon.contains(1.0, 0.0, 0.0) is MaticAreaSelector._point_in_polygon(
        1.0, 0.0, boundary
    )


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


def test_overloaded_index_preserves_comb_above_old_fallback_cutoff() -> None:
    boundary = [[0.0, 0.0], [0.0, 10_000.0]]
    for tooth in range(127):
        x = float(tooth + 1)
        boundary.extend([[x, 10_000.0], [x, 0.0]])
    boundary.extend([[128.0, 0.0], [128.0, 10_000.0]])

    polygon = _IndexedPolygon(boundary)

    assert len(boundary) == 258
    assert polygon.overloaded is True
    assert polygon.contains(127.5, 5_000.0, 0.0) is True


def test_overloaded_index_reports_boundary_larger_than_supported_cap() -> None:
    """The fallback reports uncertainty beyond the protocol-supported room size."""
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0]
        for index in range(_IndexedPolygon._MAX_FALLBACK_EDGES + 1)
    ]

    polygon = _IndexedPolygon(boundary)

    assert polygon.overloaded is True
    with pytest.raises(GeometryTooComplex, match="fallback edge limit"):
        polygon.contains(1.0, 0.5, 0.0)


def test_room_index_charges_only_the_fallback_work_it_performs() -> None:
    """Several eligible overloaded rooms do not reserve the whole budget."""
    boundary = [[0.0, 0.0], [0.0, 10_000.0]]
    for tooth in range(68):
        x = float(tooth + 1)
        boundary.extend([[x, 10_000.0], [x, 0.0]])
    boundary.extend([[69.0, 0.0], [69.0, 10_000.0]])
    geometry = _RoomGeometryIndex(
        [
            {"room_id": str(index), "name": "Room", "boundary": boundary}
            for index in range(2)
        ]
    )
    geometry._query_work_remaining = 400
    initial_budget = geometry._query_work_remaining

    assert geometry.contains(68.5, 5_000.0) is True
    assert geometry._query_work_remaining < initial_budget
    assert geometry._query_work_remaining > 0
    assert geometry.contains(68.5, 5_000.0) is True


def test_room_index_checks_indexed_rooms_before_oversized_fallbacks() -> None:
    """An uncertain overloaded room cannot hide a known containing room."""
    oversized = [
        [float(index), -10_000.0 if index % 2 else 10_000.0]
        for index in range(_IndexedPolygon._MAX_FALLBACK_EDGES + 1)
    ]
    rectangle = [[120.0, -1.0], [130.0, -1.0], [130.0, 1.0], [120.0, 1.0]]
    geometry = _RoomGeometryIndex(
        [
            {"room_id": "oversized", "name": "Room", "boundary": oversized},
            {"room_id": "known", "name": "Room", "boundary": rectangle},
        ]
    )

    assert geometry.contains(128.5, 0.0) is True


def test_room_index_budgets_indexed_candidate_references() -> None:
    boundary = [[float(index), 0.001 if index % 2 else 0.0] for index in range(4_096)]
    boundary.extend([[4_095.0, 1.0], [0.0, 1.0]])
    geometry = _RoomGeometryIndex(
        [
            {
                "room_id": "room",
                "name": "Room",
                "boundary": boundary,
            }
        ]
    )
    geometry._query_work_remaining = 0
    assert geometry.polygons[0].overloaded is False

    with pytest.raises(GeometryTooComplex, match="query budget exhausted"):
        geometry.contains(2_048.5, 0.0005)


def test_indexed_polygon_uses_bounded_fallback_for_tiny_vertical_span() -> None:
    polygon = _IndexedPolygon([[0.0, 0.0], [1.0, 0.0], [1.0, 1e-6], [0.0, 1e-6]])

    assert polygon.overloaded is False
    contained, work = polygon.contains_with_work_limit(0.5, 0.5e-6, 0.01, 100)

    assert contained is True
    assert work < 100


def test_indexed_polygon_rejects_edge_work_over_query_limit() -> None:
    polygon = _IndexedPolygon([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])

    with pytest.raises(GeometryTooComplex, match="query budget exhausted"):
        polygon.contains_with_work_limit(0.5, 0.5, 0.0, 0)


def test_indexed_polygon_rejects_wide_bucket_span_over_fallback_edge_limit() -> None:
    polygon = _IndexedPolygon([[float(index), 0.0] for index in range(4_097)])

    assert polygon.overloaded is False
    with pytest.raises(GeometryTooComplex, match="fallback edge limit"):
        polygon.contains(2_048.0, 0.0, 0.01)


def test_room_query_budget_covers_all_circle_probes_for_eight_rooms() -> None:
    """The aggregate cap covers the editor maximum at the reviewed room size."""
    maximum_circle_probes = 512 * 10
    reviewed_room_work = maximum_circle_probes * 8 * 256

    assert _RoomGeometryIndex._MAX_QUERY_WORK >= reviewed_room_work


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
    geometry._query_work_remaining = len(boundary) * 2

    for _ in range(4):
        try:
            geometry.contains(128.5, 0.0)
        except ValueError:
            break
    else:
        pytest.fail("fallback budget was not exhausted")

    assert geometry._query_work_remaining < len(boundary)
    with pytest.raises(ValueError, match="query budget exhausted"):
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


def test_room_index_completes_supported_repeated_fallback_probes() -> None:
    """The aggregate budget covers 1,000 bounded lookups on supported rooms."""
    outside = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(256)
    ]
    containing = [point.copy() for point in outside]
    containing[129][1] = -5_000.0
    containing.extend([containing[-1].copy(), containing[-1].copy()])
    geometry = _RoomGeometryIndex(
        [
            {"room_id": str(index), "name": "Room", "boundary": outside}
            for index in range(7)
        ]
        + [{"room_id": "containing", "name": "Room", "boundary": containing}]
    )

    for _ in range(1_000):
        assert geometry.contains(128.5, 1.0) is True


def test_room_index_finds_late_supported_room_after_many_valid_probes() -> None:
    """A containing fallback room stays visible through 62 bounded probes."""
    outside = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(256)
    ]
    containing = [point.copy() for point in outside]
    containing[129][1] = -5_000.0
    containing.extend([containing[-1].copy(), containing[-1].copy()])
    geometry = _RoomGeometryIndex(
        [
            {"room_id": str(index), "name": "Room", "boundary": outside}
            for index in range(255)
        ]
        + [{"room_id": "containing", "name": "Room", "boundary": containing}]
    )

    for _ in range(62):
        assert geometry.contains(128.5, 1.0) is True


def test_room_index_reports_uncertainty_when_fallback_budget_is_exhausted() -> None:
    """Budget exhaustion is explicit instead of becoming a false containment result."""
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
    geometry._query_work_remaining = 1

    with pytest.raises(GeometryTooComplex, match="fallback budget exhausted"):
        geometry.contains(120.0, 0.0)


def test_room_index_skips_overloaded_polygon_outside_bounds() -> None:
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(140)
    ]
    geometry = _RoomGeometryIndex(
        [{"room_id": "room", "name": "Room", "boundary": boundary}]
    )
    remaining = geometry._query_work_remaining

    assert geometry.contains(-1.0, 0.0) is False
    assert geometry._query_work_remaining == remaining - 1


def test_room_index_reports_exhausted_single_polygon_fallback_budget() -> None:
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(256)
    ]
    geometry = _RoomGeometryIndex(
        [{"room_id": "room", "name": "Room", "boundary": boundary}]
    )
    geometry._query_work_remaining = 1

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
    geometry._query_work_remaining = 0

    with pytest.raises(vol.Invalid, match="query budget exhausted"):
        selector.validate([{"x": 128.5, "y": 0.0, "radius": 0.3}], geometry=geometry)


def test_room_index_charges_overloaded_candidate_enumeration() -> None:
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(140)
    ]
    geometry = _RoomGeometryIndex(
        [
            {"room_id": str(index), "name": "Room", "boundary": boundary}
            for index in range(3)
        ]
    )
    assert all(polygon.overloaded for polygon in geometry.polygons)
    geometry._query_work_remaining = 2

    with pytest.raises(GeometryTooComplex, match="query budget exhausted"):
        geometry.contains(1_000.0, 0.0)

    assert geometry._query_work_remaining == 0


def test_room_index_does_not_reuse_budget_after_candidate_exhaustion() -> None:
    boundary = [
        [float(index), -10_000.0 if index % 2 else 10_000.0] for index in range(140)
    ]
    geometry = _RoomGeometryIndex(
        [{"room_id": "room", "name": "Room", "boundary": boundary}]
    )
    geometry._query_work_remaining = 2

    with pytest.raises(GeometryTooComplex, match="fallback budget exhausted"):
        geometry.contains(69.0, 0.0)

    assert geometry._query_work_remaining == 0
    with pytest.raises(GeometryTooComplex, match="query budget exhausted"):
        geometry.contains(69.0, 0.0)


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
