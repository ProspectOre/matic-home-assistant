"""Validation tests for the private drawn-area selector."""

import pytest
import voluptuous as vol

from custom_components.matic_robot.area_selector import (
    MaticAreaSelector,
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
