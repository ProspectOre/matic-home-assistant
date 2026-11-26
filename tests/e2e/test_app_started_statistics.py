"""Room statistics from cleans started in the Matic app, on a two-floor home."""

from __future__ import annotations

import asyncio
import time
from uuid import UUID, uuid4

import pytest
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import SimulatedRobot
from .plan_run import poll
from .sim_mission import (
    SimFloor,
    app_history_value,
    bytes_field,
    two_room_floor,
    uuid_wire,
)

GROUND = two_room_floor()
# The upper floor reuses the ground floor's room IDs, so only the floor in a
# record can tell the two apart.
UPPER = SimFloor(8, UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), GROUND.rooms)
BLOCKED = "native_statistics_blocked_reason"


@pytest.fixture
def robot() -> SimulatedRobot:
    robot = SimulatedRobot()
    robot.set_mapped_floors((GROUND, UPPER), GROUND)
    return robot


def _entity_id(hass: HomeAssistant, entry: MockConfigEntry, name: str) -> str:
    session = entry.runtime_data.session
    room = next(room for room in session.floor.value.rooms if room.name == name)
    unique_id = f"{session.info.serial_number}_room_{room.id}_last_cleaned"
    entity_id = er.async_get(hass).async_get_entity_id("sensor", DOMAIN, unique_id)
    assert entity_id is not None
    return entity_id


def _last_cleaned(hass: HomeAssistant, entry: MockConfigEntry, name: str) -> State:
    state = hass.states.get(_entity_id(hass, entry, name))
    assert state is not None
    return state


async def _enable_room_sensors(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    """Turn on the room sensors, which are off by default, and reload."""
    registry = er.async_get(hass)
    for name in ("Kitchen", "Study"):
        registry.async_update_entity(_entity_id(hass, entry, name), disabled_by=None)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()


def _app_clean(robot: SimulatedRobot, floor: SimFloor, name: str) -> str:
    """Record an app-started clean of one room and return when it ended."""
    ended = (time.time_ns() // 1_000_000_000 - 60) * 1_000_000_000
    room = next(room for room in floor.rooms if room.name == name)
    robot.add_history(
        bytes_field(2, uuid_wire(uuid4())),
        app_history_value(floor, room, ended - 600_000_000_000, ended),
    )
    return dt_util.utc_from_timestamp(ended // 1_000_000_000).isoformat()


async def test_app_clean_shows_only_on_the_floor_its_record_names(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    await _enable_room_sensors(hass, loaded_entry)
    await poll(hass, loaded_entry, robot)
    assert BLOCKED in _last_cleaned(hass, loaded_entry, "Kitchen").attributes

    # One history read holds a Kitchen clean on the upper floor, a clean whose
    # record names no floor and a Study clean on the active floor.
    _app_clean(robot, UPPER, "Kitchen")
    robot.add_foreign_history()
    ended = _app_clean(robot, GROUND, "Study")
    # Telemetry, which carries the history revision, is read again at once.
    await loaded_entry.runtime_data.session.heartbeat.async_request_full_refresh()
    async with asyncio.timeout(10):
        while _last_cleaned(hass, loaded_entry, "Study").state == "unknown":
            await asyncio.sleep(0.05)

    study = _last_cleaned(hass, loaded_entry, "Study")
    assert dt_util.parse_datetime(study.state) == dt_util.parse_datetime(ended)
    assert study.attributes["statistics_source"] == (
        "robot_native_mode_result_identity_match"
    )
    assert BLOCKED not in study.attributes
    kitchen = _last_cleaned(hass, loaded_entry, "Kitchen")
    assert kitchen.state == "unknown"
    assert BLOCKED in kitchen.attributes
