"""Exercise the live pose collector over the simulated Hermes transport."""

import asyncio

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from .hermes_sim import SimulatedRobot
from .sim_mission import SimFloor, two_room_floor


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def test_live_pose_stream_updates_without_a_map_browser(
    loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    tracker = loaded_entry.runtime_data.live_pose
    assert tracker is not None
    robot.start_cleaning("Kitchen")
    robot._refresh_pose()
    async with asyncio.timeout(5):
        while tracker.current() is None:  # noqa: ASYNC110
            await asyncio.sleep(0.05)
        original_revision = tracker.revision
        await asyncio.sleep(0.01)
        robot._refresh_pose()
        while tracker.current() is None or tracker.revision <= original_revision:  # noqa: ASYNC110
            await asyncio.sleep(0.05)
    assert tracker.current().mission_id == robot.floor.mission_id
