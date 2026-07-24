"""Validation tests for the private drawn-area selector."""

import pytest
import voluptuous as vol

from custom_components.matic_robot.area_selector import MaticAreaSelector


def _selector() -> MaticAreaSelector:
    return MaticAreaSelector(
        {
            "rooms": [
                {
                    "room_id": "office",
                    "name": "Office",
                    "boundary": [[0, 0], [3, 0], [3, 2], [0, 2]],
                }
            ]
        }
    )


def test_area_selector_preserves_private_geometry() -> None:
    value = [{"x": 1, "y": 1.25, "radius": 0.35}]
    assert _selector()(value) == [{"x": 1.0, "y": 1.25, "radius": 0.35}]
    serialized = _selector().serialize()["selector"]["matic-area"]
    assert serialized["rooms"][0]["name"] == "Office"


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
