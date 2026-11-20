"""A dock command from elsewhere ends a running photo tour."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import photo_tours
from custom_components.matic_robot.client import UserCommand
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.robot_controls import RobotControls

from .hermes_sim import DOCK_PAYLOAD, Phase, SimulatedRobot
from .plan_run import poll
from .sim_mission import SimFloor, two_room_floor
from .test_camera_flows import VACUUM, _configure_tour, _webp

pytestmark = pytest.mark.usefixtures("fast_tour_polls")


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def _start_tour_and_wait_for_the_photo(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> asyncio.Task:
    """Start a two-stop tour and return once it waits for the first photo."""
    robot.set_collection("instamatic_snaps", [])
    robot.set_native_schedules([])
    await _configure_tour(hass, loaded_entry)
    await poll(hass, loaded_entry, robot)
    snapped = asyncio.Event()
    take_photo = RobotControls.async_take_photo

    async def take_and_tell(controls: RobotControls, album: str) -> None:
        await take_photo(controls, album)
        snapped.set()

    # No photo arrives, so the tour waits in the kitchen for one.
    with patch.object(RobotControls, "async_take_photo", take_and_tell):
        tour = hass.async_create_task(
            hass.services.async_call(
                DOMAIN,
                "run_photo_tour",
                {
                    "entity_id": VACUUM,
                    "stops": [{"room": "Kitchen"}, {"room": "Study"}],
                },
                blocking=True,
                return_response=True,
            )
        )
        async with asyncio.timeout(5):
            await snapped.wait()
    assert robot.phase is Phase.PARKED
    return tour


async def _stopped(tour: asyncio.Task) -> None:
    with pytest.raises(HomeAssistantError) as stopped:
        await tour
    assert stopped.value.translation_key == "photo_tour_stopped"


async def test_send_home_stops_the_tour_before_its_next_stop(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    floor: SimFloor,
) -> None:
    tour = await _start_tour_and_wait_for_the_photo(hass, loaded_entry, robot)
    study = next(room.id for room in floor.rooms if room.name == "Study")

    await hass.services.async_call(
        "vacuum", "return_to_base", {"entity_id": VACUUM}, blocking=True
    )

    await _stopped(tour)
    assert robot.destination != study
    assert robot.phase is Phase.RETURNING


async def test_a_command_that_stops_the_tour_is_not_followed_by_its_dock(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    tour = await _start_tour_and_wait_for_the_photo(hass, loaded_entry, robot)
    dispatch = asyncio.Event()
    held = asyncio.Event()
    send = RobotControls.async_send_user_command

    async def pause_held_until_the_tour_ends(
        controls: RobotControls, command: UserCommand
    ) -> None:
        if command is UserCommand.PAUSE:
            held.set()
            await dispatch.wait()
        await send(controls, command)

    sent = len(robot.received())
    with patch.object(
        RobotControls, "async_send_user_command", pause_held_until_the_tour_ends
    ):
        pause = hass.async_create_task(
            hass.services.async_call(
                "vacuum", "pause", {"entity_id": VACUUM}, blocking=True
            )
        )
        try:
            async with asyncio.timeout(5):
                await held.wait()
            # Pause is not sent yet, so the robot is still parked at the stop.
            assert robot.phase is Phase.PARKED
            # A tour that docked on its way out would queue behind Pause.
            async with asyncio.timeout(5):
                await _stopped(tour)
            assert robot.received()[sent:] == []
        finally:
            dispatch.set()
            await pause

    # The tour leaves the robot to Pause instead of sending it to the dock.
    assert DOCK_PAYLOAD not in robot.received()[sent:]


async def test_a_second_tour_waits_and_a_cancelled_one_stays_cancelled(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    tour = await _start_tour_and_wait_for_the_photo(hass, loaded_entry, robot)

    with pytest.raises(HomeAssistantError) as running:
        await hass.services.async_call(
            DOMAIN,
            "run_photo_tour",
            {"entity_id": VACUUM, "stops": [{"room": "Study"}]},
            blocking=True,
            return_response=True,
        )
    assert running.value.translation_key == "photo_tour_running"

    # Cancelling it any other way, such as Home Assistant stopping, is not
    # reported as a stop.
    tour.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tour


async def test_a_command_during_the_final_ownership_read_cancels_the_dock(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    robot.set_collection("instamatic_snaps", [])
    robot.set_native_schedules([])
    await _configure_tour(hass, loaded_entry)
    robot.queue_photo(_webp((40, 90, 160)))
    await poll(hass, loaded_entry, robot)
    reading = asyncio.Event()
    release = asyncio.Event()

    async def read_before_the_command_lands(*_: object) -> bool:
        reading.set()
        await release.wait()
        # The read saw the robot parked before the command reached it.
        return True

    with patch.object(
        photo_tours, "_async_still_parked", read_before_the_command_lands
    ):
        tour = hass.async_create_task(
            hass.services.async_call(
                DOMAIN,
                "run_photo_tour",
                {"entity_id": VACUUM, "stops": [{"room": "Kitchen"}]},
                blocking=True,
                return_response=True,
            )
        )
        async with asyncio.timeout(5):
            await reading.wait()
        sent = len(robot.received())
        await hass.services.async_call(
            "vacuum", "pause", {"entity_id": VACUUM}, blocking=True
        )
        release.set()
        result = await tour

    # The photo is kept, and the robot is left to Pause.
    assert len(result["robots"][0]["photos"]) == 1
    assert DOCK_PAYLOAD not in robot.received()[sent:]
