"""Perimeter metadata validation uses synthetic geometry only."""

import math

import pytest

from custom_components.matic_robot.area_outline import _distance, validate_outline

SQUARE = [{"x": 0, "y": 0}, {"x": 2, "y": 0}, {"x": 2, "y": 2}, {"x": 0, "y": 2}]


def test_outline_keeps_inscribed_circle_and_vertex_order() -> None:
    assert validate_outline(None, []) is None
    assert validate_outline(SQUARE, [{"x": 1, "y": 1, "radius": 1}]) == SQUARE
    assert validate_outline(list(reversed(SQUARE)), []) == list(reversed(SQUARE))
    assert _distance([1, 1], [0, 0], [0, 0]) == math.sqrt(2)


@pytest.mark.parametrize(
    "outline",
    [
        {},
        [],
        SQUARE[:2],
        SQUARE * 17,
        [{"x": 0, "y": 0, "extra": 1}, *SQUARE[1:]],
        [None, *SQUARE[1:]],
        [{"x": "0", "y": 0}, *SQUARE[1:]],
        [{"x": True, "y": 0}, *SQUARE[1:]],
        [{"x": float("nan"), "y": 0}, *SQUARE[1:]],
        [{"x": float("inf"), "y": 0}, *SQUARE[1:]],
        [{"x": 10001, "y": 0}, *SQUARE[1:]],
        [SQUARE[0], SQUARE[0], *SQUARE[1:]],
        [SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]],
        [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 2, "y": 0}],
        [SQUARE[0], SQUARE[1], SQUARE[2], {"x": 1, "y": 0}, SQUARE[3]],
    ],
)
def test_outline_rejects_malformed_or_crossed_perimeters(outline) -> None:
    with pytest.raises(ValueError):
        validate_outline(outline, [])


@pytest.mark.parametrize(
    "circle",
    [
        {"x": 3, "y": 1, "radius": 0.1},
        {"x": 0.1, "y": 1, "radius": 0.2},
    ],
)
def test_outline_rejects_coverage_outside_perimeter(circle) -> None:
    with pytest.raises(ValueError, match="coverage"):
        validate_outline(SQUARE, [circle])
