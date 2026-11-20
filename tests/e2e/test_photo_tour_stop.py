"""A dock command from elsewhere ends a running photo tour."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.robot_controls import RobotControls

from .hermes_sim import DOCK_PAYLOAD, Phase, SimulatedRobot
from .plan_run import poll
from .sim_mission import SimFloor, two_room_floor
from .test_camera_flows import VACUUM, _configure_tour

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
    vacuum = hass.data["entity_components"]["vacuum"].get_entity(VACUUM)
    dispatch = asyncio.Event()
    send = vacuum._commands.async_send_user_command

    async def held_until_the_tour_ends(command: object) -> None:
        await dispatch.wait()
        await send(command)

    sent = len(robot.received())
    with patch.object(
        vacuum._commands, "async_send_user_command", held_until_the_tour_ends
    ):
        pause = hass.async_create_task(
            hass.services.async_call(
                "vacuum", "pause", {"entity_id": VACUUM}, blocking=True
            )
        )
        # While Pause waits to be sent, the robot is still parked.
        await _stopped(tour)
        dispatch.set()
        await pause

    # The tour leaves the robot to Pause instead of sending it to the dock.
    assert DOCK_PAYLOAD not in robot.received()[sent:]
