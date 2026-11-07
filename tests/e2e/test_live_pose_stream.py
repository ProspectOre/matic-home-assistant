"""Exercise the live pose collector over the simulated Hermes transport."""

import asyncio

import pytest
from homeassistant.core import HomeAssistant
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


@pytest.mark.parametrize("depart_from_dock", [False, True])
async def test_live_pose_stream_recovers_after_silent_subscription(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
    depart_from_dock: bool,
) -> None:
    original_wait = robot.wait_for_change
    stalled = asyncio.Event()

    async def wait_for_change(name: str, seen: int) -> None:
        if name == "latest_pose" and not stalled.is_set():
            stalled.set()
            await asyncio.Event().wait()
        await original_wait(name, seen)

    monkeypatch.setattr(robot, "wait_for_change", wait_for_change)
    monkeypatch.setattr(
        "custom_components.matic_robot.live_pose._STREAM_IDLE_SECONDS", 0.2
    )
    monkeypatch.setattr("custom_components.matic_robot.live_pose._RETRY_SECONDS", 0)
    if not depart_from_dock:
        robot.start_cleaning("Kitchen")
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    try:
        tracker = config_entry.runtime_data.live_pose
        assert tracker is not None
        await asyncio.wait_for(stalled.wait(), 2)
        initial_revision = tracker.revision
        initial_reads = robot.reads["latest_pose"]
        if depart_from_dock:
            # The silent docked subscription is now in its long retry delay.
            await asyncio.sleep(0.4)
            assert robot.reads["latest_pose"] == initial_reads
            robot.start_cleaning("Kitchen")
        robot._refresh_pose()
        async with asyncio.timeout(3):
            while (
                tracker.current() is None
                or tracker.revision <= initial_revision
                or robot.reads["latest_pose"] <= initial_reads
            ):
                # Like the robot, keep emitting native observations while
                # startup map proof and the stalled subscription recover.
                robot._refresh_pose()
                await asyncio.sleep(0.01)
        assert tracker.current().mission_id == robot.floor.mission_id
        revision = tracker.revision
        robot._refresh_pose()
        async with asyncio.timeout(3):
            while tracker.revision <= revision:  # noqa: ASYNC110
                await asyncio.sleep(0.01)
    finally:
        assert await hass.config_entries.async_unload(config_entry.entry_id)
        await hass.async_block_till_done()
