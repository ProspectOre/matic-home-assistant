"""Recorded robot responses served by the simulator and read by the decoders.

Every recording is replayed over the real transport. The client must decode
the facts the recording states, and Home Assistant must show its entities.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from enum import Enum
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.client.api import MaticHermesClient

from .hermes_sim import SimulatedRobot
from .sim_recording import Recording, load_recordings


@pytest.fixture(params=load_recordings(), ids=lambda recording: recording.name)
def recording(request: pytest.FixtureRequest) -> Recording:
    return request.param  # type: ignore[no-any-return]


@pytest.fixture
def robot(recording: Recording) -> SimulatedRobot:
    robot = SimulatedRobot(software_version=recording.firmware)
    robot.replay(recording.endpoints)
    return robot


async def _pose(client: MaticHermesClient) -> Any:
    floor_plan = await client.async_get_floor_plan()
    return await client.async_get_pose(expected_mission_id=floor_plan.mission_id)


# The client read behind each key of a recording's ``expect``.
_READS: dict[str, Callable[[MaticHermesClient], Awaitable[Any]]] = {
    "state": lambda client: client.async_get_state(),
    "floor_plan": lambda client: client.async_get_floor_plan(),
    "pose": _pose,
    "run_progress": lambda client: client.async_get_run_progress(),
    "session_identity": lambda client: client.async_get_cleaning_session_identity(),
    "session_records": lambda client: client.async_get_cleaning_session_records(
        strict=True
    ),
    "telemetry": lambda client: client.async_get_telemetry(),
}


def _assert_decoded(actual: Any, expected: Any, path: str) -> None:
    """Compare the facts a recording lists; fields it omits are not judged."""
    if isinstance(expected, dict):
        for name, value in expected.items():
            _assert_decoded(getattr(actual, name), value, f"{path}.{name}")
    elif isinstance(expected, list):
        assert len(actual) == len(expected), path
        for index, (item, value) in enumerate(zip(actual, expected, strict=True)):
            _assert_decoded(item, value, f"{path}[{index}]")
    else:
        if isinstance(actual, Enum):
            actual = actual.value
        elif isinstance(actual, bytes):
            actual = actual.hex()
        elif isinstance(actual, float):
            actual = round(actual, 6)
        assert actual == expected, path


async def test_decoders_read_the_recorded_facts(
    client: MaticHermesClient, recording: Recording
) -> None:
    for read, expected in recording.expect.items():
        _assert_decoded(await _READS[read](client), expected, read)


async def test_home_assistant_shows_the_recorded_robot(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, recording: Recording
) -> None:
    for entity_id, expected in recording.entities.items():
        state = hass.states.get(entity_id)
        assert state is not None, entity_id
        assert state.state == expected, entity_id
    (device,) = dr.async_entries_for_config_entry(
        dr.async_get(hass), loaded_entry.entry_id
    )
    assert device.sw_version == recording.firmware
