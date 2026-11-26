"""Unloading or reloading the entry ends its running photo tour."""

from __future__ import annotations

import asyncio

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import Phase, SimulatedRobot
from .test_camera_flows import VACUUM, _webp
from .test_photo_tour_stop import _start_tour_and_wait_for_the_photo

pytestmark = pytest.mark.usefixtures("fast_tour_polls")


async def _ended_by_unload(tour: asyncio.Task) -> None:
    # Unload has already waited for the tour: it is over, not still polling.
    assert tour.done()
    with pytest.raises(HomeAssistantError) as stopped:
        await tour
    assert stopped.value.translation_key == "photo_tour_stopped"


async def test_unload_ends_the_tour_and_sends_nothing(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    tour = await _start_tour_and_wait_for_the_photo(hass, loaded_entry, robot)
    sent = len(robot.commands)

    assert await hass.config_entries.async_unload(loaded_entry.entry_id)

    await _ended_by_unload(tour)
    # The photo the tour waited for lands, and nothing is left to act on it.
    robot.queue_photo(_webp((40, 90, 160)))
    await asyncio.sleep(0.2)
    assert robot.commands[sent:] == []
    # Left parked, the robot docks on its own countdown.
    assert robot.phase is Phase.PARKED


async def test_reload_leaves_one_tour_runner(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    tour = await _start_tour_and_wait_for_the_photo(hass, loaded_entry, robot)
    destination = robot.destination
    sent = len(robot.received())

    assert await hass.config_entries.async_reload(loaded_entry.entry_id)
    assert loaded_entry.state is ConfigEntryState.LOADED

    await _ended_by_unload(tour)
    robot.queue_photo(_webp((40, 90, 160)))
    await asyncio.sleep(0.2)
    # The old tour neither docks the robot nor sends it on to the Study.
    assert robot.received()[sent:] == []
    assert robot.destination == destination

    # The reloaded entry's runner is free and runs a tour of its own.
    result = await hass.services.async_call(
        DOMAIN,
        "run_photo_tour",
        {"entity_id": VACUUM, "stops": [{"room": "Kitchen"}], "skip_cooldown": True},
        blocking=True,
        return_response=True,
    )
    assert len(result["robots"][0]["photos"]) == 1
