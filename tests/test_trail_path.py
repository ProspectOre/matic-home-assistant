"""Tests for where a recorded robot trail breaks and what simplification keeps."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from homeassistant.core import HomeAssistant

from custom_components.matic_robot.run_history import MAX_SAVED_TRAIL_POINTS, RunTrails
from custom_components.matic_robot.trail_path import thin_segments

MAP = "a" * 64
T0 = 1_800_000_000
# The browser's trail recorder (trail-path.ts) is held to the same cases.
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "trail_path_v1.json").read_text()
)


def _tuples(segments: list[list[list[float]]]) -> list[list[tuple]]:
    return [[tuple(point) for point in segment] for segment in segments]


def _observe(trails: RunTrails, x: float, y: float, at: float | None = None) -> None:
    trails.observe(
        run_id="run-1",
        native_active=True,
        map_key=MAP,
        point=(x, y),
        observed_at=at,
    )


def _finish(trails: RunTrails) -> list[list[tuple]]:
    trails.observe(run_id=None, native_active=False, map_key=MAP, point=None)
    return trails.segments(trails.trail_id(MAP, run_id="run-1"), MAP)


async def test_the_trail_breaks_where_the_robot_was_unseen_or_jumped(
    hass: HomeAssistant,
) -> None:
    trails = RunTrails(hass, "entry")
    for x, at in ((0.0, 0), (0.2, 1), (0.4, 2), (0.45, 9), (0.6, 12)):
        # A pose too close to keep still shows the robot was seen at 9 s.
        _observe(trails, x, 0, T0 + at)
    _observe(trails, 0.8, 0, T0 + 40)  # Unseen for 28 s.
    _observe(trails, 2.0, 0, T0 + 41)  # A 1.2 m jump within a second.
    expected = [
        [(0.0, 0, T0), (0.2, 0, T0 + 1), (0.4, 0, T0 + 2), (0.6, 0, T0 + 12)],
        [(0.8, 0, T0 + 40)],
        [(2.0, 0, T0 + 41)],
    ]
    assert trails.live(MAP) == expected
    assert _finish(trails) == expected


async def test_saving_a_retraced_pass_keeps_both_of_its_ends(
    hass: HomeAssistant,
) -> None:
    trails = RunTrails(hass, "entry")
    # Out 60 m, back past the start to -30 m, then home: 901 points in a line.
    path = [index * 0.2 for index in range(301)]
    path += [60 - index * 0.2 for index in range(1, 451)]
    path += [-30 + index * 0.2 for index in range(1, 151)]
    for x in path:
        _observe(trails, x, 0)
    (saved,) = _finish(trails)
    assert len(saved) <= MAX_SAVED_TRAIL_POINTS
    assert [saved[0], saved[-1]] == [(0.0, 0), (0.0, 0)]
    assert (60.0, 0) in saved
    assert (-30.0, 0) in saved


async def test_saving_parallel_lanes_keeps_every_turn(hass: HomeAssistant) -> None:
    trails = RunTrails(hass, "entry")
    turns = []
    for row in range(20):
        lane = [(column * 0.2, row * 0.3) for column in range(60)]
        lane = lane if row % 2 == 0 else lane[::-1]
        for x, y in lane:
            _observe(trails, x, y)
        turns += [(round(x, 2), round(y, 2)) for x, y in (lane[0], lane[-1])]
    (saved,) = _finish(trails)
    assert len(saved) == MAX_SAVED_TRAIL_POINTS
    assert [turn for turn in turns if turn not in saved] == []


@pytest.mark.parametrize("case", FIXTURE["record"], ids=lambda case: case["name"])
async def test_recording_matches_the_shared_cases(hass: HomeAssistant, case) -> None:
    trails = RunTrails(hass, "entry")
    for x, y, at in case["poses"]:
        _observe(trails, x, y, at)
    assert trails.live(MAP) == _tuples(case["segments"])


@pytest.mark.parametrize("case", FIXTURE["thin"], ids=lambda case: case["name"])
def test_thinning_matches_the_shared_cases(case) -> None:
    kept = thin_segments(_tuples(case["segments"]), case["limit"])
    assert kept == _tuples(case["kept"])
