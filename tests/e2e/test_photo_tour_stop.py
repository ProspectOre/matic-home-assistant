"""A dock command from elsewhere ends a running photo tour."""

from __future__ import annotations

import asyncio

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import Phase, SimulatedRobot
from .plan_run import poll
from .sim_mission import SimFloor, two_room_floor
from .test_camera_flows import VACUUM, _configure_tour

pytestmark = pytest.mark.usefixtures("fast_tour_polls")


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def test_send_home_stops_the_tour_before_its_next_stop(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    floor: SimFloor,
) -> None:
    robot.set_collection("instamatic_snaps", [])
    robot.set_native_schedules([])
    await _configure_tour(hass, loaded_entry)
    await poll(hass, loaded_entry, robot)
    study = next(room.id for room in floor.rooms if room.name == "Study")

    # No photo arrives, so the tour waits in the kitchen for one.
    tour = hass.async_create_task(
        hass.services.async_call(
            DOMAIN,
            "run_photo_tour",
            {"entity_id": VACUUM, "stops": [{"room": "Kitchen"}, {"room": "Study"}]},
            blocking=True,
            return_response=True,
        )
    )
    async with asyncio.timeout(5):
        await robot.wait_for_phase(Phase.PARKED)
    await hass.services.async_call(
        "vacuum", "return_to_base", {"entity_id": VACUUM}, blocking=True
    )

    with pytest.raises(HomeAssistantError) as stopped:
        await tour
    assert stopped.value.translation_key == "photo_tour_stopped"
    assert robot.destination != study
    assert robot.phase is Phase.RETURNING
