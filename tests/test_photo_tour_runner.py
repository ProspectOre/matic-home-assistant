"""Unload ends an entry's photo tour and refuses any after it."""

from __future__ import annotations

import asyncio

import pytest
from homeassistant.exceptions import HomeAssistantError

from tests import test_photo_tours
from tests.test_photo_tours import (
    DOCKED,
    MOVING,
    _commands,
    _entry,
    _hass,
    _parked_in,
    _photo,
    _Photos,
    _run_rooms,
)

# The photo tour tests' fake clock and recorded robot commands, both autouse.
clock = test_photo_tours.clock
robot_commands = test_photo_tours.robot_commands


async def test_unload_during_docking_stops_the_tour_before_the_dock_is_sent() -> None:
    hass = _hass()
    entry = _entry(
        [DOCKED, MOVING] + [_parked_in("Kitchen")] * 5, _Photos(None, None, _photo(1))
    )
    runner = entry.runtime_data.photo_tours
    docking = asyncio.Event()
    sent: list[str] = []

    async def held_dock(domain: str, service: str, *_: object, **__: object) -> None:
        docking.set()
        await asyncio.Event().wait()
        sent.append(service)

    hass.services.async_call = held_dock
    tour = asyncio.ensure_future(_run_rooms(hass, entry, "vacuum.matic", ["Kitchen"]))
    async with asyncio.timeout(5):
        await docking.wait()
    # The tour is finishing up, which another command would not interrupt.
    assert runner._finishing

    await runner.async_shutdown()

    assert tour.done()
    with pytest.raises(HomeAssistantError) as stopped:
        await tour
    assert stopped.value.translation_key == "photo_tour_stopped"
    assert sent == []


async def test_no_tour_starts_after_unload() -> None:
    hass = _hass()
    entry = _entry([DOCKED] * 10, _Photos())

    await entry.runtime_data.photo_tours.async_shutdown()

    with pytest.raises(HomeAssistantError) as refused:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])
    assert refused.value.translation_key == "photo_tour_stopped"
    assert _commands(hass) == []
    entry.runtime_data.client.async_get_state.assert_not_awaited()
