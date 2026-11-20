"""How a photo tour decides it has reached a viewpoint before the snap."""

from __future__ import annotations

import math
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot import photo_tours
from custom_components.matic_robot.client import RobotPose
from custom_components.matic_robot.photo_tours import TourStop
from custom_components.matic_robot.robot_controls import RobotControls
from custom_components.matic_robot.viewpoints import Viewpoint
from tests import test_photo_tours
from tests.test_photo_tours import (
    DOCKED,
    MOVING,
    _entry,
    _hass,
    _parked_in,
    _photo,
    _Photos,
)

DESK = Viewpoint("desk", "Desk", 7, 3.0, 1.0, math.pi / 2, "study")
SHOT = photo_tours._Shot(TourStop(viewpoint="Desk"), "study", DESK, -math.pi / 2)
ON_SPOT = RobotPose(3.0, 1.0, 0, 7, heading=-math.pi / 2)
FACING_AWAY = RobotPose(3.0, 1.0, 0, 7, heading=math.pi / 2)
ELSEWHERE = RobotPose(3.6, 1.0, 0, 7, heading=-math.pi / 2)
STUDY = _parked_in("Study")

# The photo tour tests' fake clock and recorded robot commands, both autouse.
clock = test_photo_tours.clock
robot_commands = test_photo_tours.robot_commands


class _Robot:
    """Serve scripted robot states, each with the pose pushed alongside it."""

    def __init__(self, entry, *steps) -> None:
        self._steps = list(steps)
        self.read = 0
        self.at_snap: tuple[int, RobotPose | None, float] | None = None
        self._session = entry.runtime_data.session
        self._session.poses = SimpleNamespace(value={})
        entry.runtime_data.client.async_get_state.side_effect = self._state

    async def _state(self):
        state, pose = self._steps[min(self.read, len(self._steps) - 1)]
        self.read += 1
        self._session.poses.value = {} if pose is None else {7: pose}
        return state


async def _photograph(steps, clock):
    hass = _hass()
    entry = _entry([], _Photos(None, _photo(1)))
    robot = _Robot(entry, *steps)
    go = AsyncMock()

    async def take_photo(controls: RobotControls, album: str) -> None:
        robot.at_snap = (robot.read, robot._session.poses.value.get(7), clock[0])
        controls._entry.runtime_data.photos.async_expect_photo(album)

    with (
        patch.object(RobotControls, "async_go_to_viewpoint", go),
        patch.object(RobotControls, "async_take_photo", take_photo),
    ):
        await photo_tours._async_photograph(
            hass, entry, "vacuum.matic", SHOT, [], "album"
        )
    go.assert_awaited_once_with(DESK, heading=SHOT.heading)
    return robot


async def test_the_snap_waits_until_the_robot_stands_on_the_spot_facing_the_shot(
    clock,
) -> None:
    steps = [
        (DOCKED, None),
        (MOVING, None),
        (STUDY, ELSEWHERE),
        (STUDY, FACING_AWAY),
        (STUDY, ON_SPOT),
    ]

    robot = await _photograph(steps, clock)

    assert robot.at_snap is not None
    reads, pose, _ = robot.at_snap
    assert reads > len(steps) - 1
    assert pose == ON_SPOT


async def test_the_robot_settles_on_the_spot_before_the_snap(clock) -> None:
    arrived_at: list[float] = []
    steps = [(DOCKED, None), (STUDY, ON_SPOT)]

    original = photo_tours._at_viewpoint

    def at_viewpoint(pose, shot):
        if (reached := original(pose, shot)) and not arrived_at:
            arrived_at.append(clock[0])
        return reached

    with patch.object(photo_tours, "_at_viewpoint", at_viewpoint):
        robot = await _photograph(steps, clock)

    assert robot.at_snap is not None
    assert robot.at_snap[2] - arrived_at[0] >= photo_tours.SETTLE_SECONDS


async def test_a_robot_parked_on_the_spot_must_set_off_before_it_arrives(
    clock,
) -> None:
    # Already parked there facing the shot: arrival counts only after it moves.
    robot = await _photograph(
        [(STUDY, ON_SPOT), (STUDY, ON_SPOT), (MOVING, None), (STUDY, ON_SPOT)], clock
    )

    assert robot.at_snap is not None
    assert robot.at_snap[0] >= 4


async def test_a_robot_parked_off_the_spot_arrives_without_leaving_the_parked_state(
    clock,
) -> None:
    # Parked in the room facing away, it only turns: no state shows it leaving.
    robot = await _photograph(
        [(STUDY, FACING_AWAY), (STUDY, FACING_AWAY), (STUDY, ON_SPOT)], clock
    )

    assert robot.at_snap is not None
    # The state at the start, the arrival poll that turns, the one on the spot
    # and the check before the snap: nothing waited for it to set off.
    assert robot.at_snap[:2] == (4, ON_SPOT)


async def test_a_robot_that_never_faces_the_shot_does_not_arrive(clock) -> None:
    with pytest.raises(HomeAssistantError) as raised:
        await _photograph([(DOCKED, None), (STUDY, FACING_AWAY)], clock)

    assert raised.value.translation_key == "photo_tour_no_arrival"


async def test_a_tour_checks_the_opt_in_before_it_looks_up_viewpoints() -> None:
    entry = _entry([DOCKED], _Photos())
    entry.options["photo_allow_unattended"] = False

    def untouched(_name: str) -> Viewpoint:
        raise AssertionError("looked up a viewpoint")

    entry.runtime_data.viewpoints = SimpleNamespace(find=untouched)

    with pytest.raises(HomeAssistantError) as raised:
        await photo_tours.async_run_photo_tour(
            _hass(), entry, "vacuum.matic", [TourStop(viewpoint="Desk")]
        )

    assert raised.value.translation_key == "photo_tour_not_opted_in"
