"""Home Assistant and the integration against a robot whose link misbehaves.

Faults come from ``sim_faults``. The state stream tests wait for a pushed
update without polling, so they pass only if the integration resubscribed.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

import pytest
from homeassistant.const import ATTR_ENTITY_ID, STATE_UNAVAILABLE
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.event import async_track_state_change_event
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import managed_dispatch
from custom_components.matic_robot.client import hermes_collections, hermes_connection
from custom_components.matic_robot.const import DOMAIN, EVENT_PLAN_FINISHED

from .hermes_sim import (
    DOCK_PAYLOAD,
    STOP_PAYLOAD,
    Phase,
    RunningSimulator,
    SimulatedRobot,
)
from .sim_faults import Faults
from .sim_mission import SimFloor, parse_coverage_command, two_room_floor

VACUUM = "vacuum.simulated_matic"
BATTERY = "sensor.simulated_matic_battery"


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def _poll(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    await entry.runtime_data.coordinator.async_refresh()
    await hass.async_block_till_done()


def _state(hass: HomeAssistant, entity_id: str) -> str:
    state = hass.states.get(entity_id)
    assert state is not None, entity_id
    return state.state


async def _pushed_battery(
    hass: HomeAssistant, robot: SimulatedRobot, fraction: float
) -> None:
    """Change the battery and wait for the state stream alone to deliver it."""
    delivered = asyncio.Event()

    @callback
    def changed(event: Event[EventStateChangedData]) -> None:
        state = event.data["new_state"]
        if state is not None and state.state == str(round(fraction * 100)):
            delivered.set()

    unsubscribe = async_track_state_change_event(hass, BATTERY, changed)
    robot.set_battery(fraction)
    try:
        async with asyncio.timeout(5):
            await delivered.wait()
    finally:
        unsubscribe()


@pytest.mark.parametrize(
    "fault",
    [
        pytest.param(lambda faults: faults.reset("kabuki_state"), id="reset"),
        pytest.param(lambda faults: faults.corrupt("kabuki_state"), id="value"),
        pytest.param(
            lambda faults: faults.corrupt("kabuki_state", frame=True),
            id="frame",
            marks=pytest.mark.xfail(
                strict=True,
                reason="PRO-165: protobuf's DecodeError is not a Matic error, so"
                " a malformed frame ends the state watcher until reload",
            ),
        ),
    ],
)
async def test_state_stream_recovers_from_a_fault_mid_stream(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    fault: Callable[[Faults], None],
) -> None:
    await _pushed_battery(hass, robot, 0.9)
    subscriptions = robot.reads["kabuki_state"]

    fault(robot.faults)
    await _pushed_battery(hass, robot, 0.5)

    assert robot.reads["kabuki_state"] == subscriptions + 1
    assert _state(hass, VACUUM) == "docked"


async def test_malformed_floor_frame_costs_only_the_floor_read(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    coordinator = loaded_entry.runtime_data.coordinator
    floor_plan = coordinator.data.floor_plan
    assert floor_plan is not None

    robot.faults.corrupt("coverage_plan", frame=True)
    reads = robot.reads["coverage_plan"]
    await coordinator.async_request_full_refresh()
    await hass.async_block_till_done()

    # The read happened and failed; the robot stays available on its last map.
    assert robot.reads["coverage_plan"] == reads + 1
    assert _state(hass, VACUUM) == "docked"
    assert coordinator.data.floor_plan == floor_plan


async def test_silent_link_times_out_then_polls_and_pushes_recover(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    simulator: RunningSimulator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The dial and RPC timeouts are 10 s; shorten the wait, not the logic.
    monkeypatch.setattr(hermes_collections, "_RPC_TIMEOUT", 0.2)
    monkeypatch.setattr(hermes_connection, "_RPC_TIMEOUT", 0.2)
    simulator.link.stall()
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == STATE_UNAVAILABLE

    simulator.link.restore()
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == "docked"
    await _pushed_battery(hass, robot, 0.5)


async def _failed_plan_start(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> dict[str, Any]:
    """Start Kitchen then Study, expect the service to fail, return the event."""
    # After an uncertain send the run waits 10 s for its own native session
    # to appear; shorten the wait, not the logic.
    monkeypatch.setattr(
        managed_dispatch, "DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS", 0.5
    )
    finished: list[dict[str, Any]] = []
    hass.bus.async_listen(
        EVENT_PLAN_FINISHED, lambda event: finished.append(dict(event.data))
    )
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            "clean_room_sequence",
            {ATTR_ENTITY_ID: VACUUM, "rooms": [{"room": "Kitchen"}, {"room": "Study"}]},
            blocking=True,
        )
    await hass.async_block_till_done()
    (event,) = finished
    assert event["outcome"] == "failed"
    assert event["completed_room_count"] == 0
    return event


@pytest.mark.usefixtures("loaded_entry")
async def test_lost_plan_start_is_not_sent_again(
    hass: HomeAssistant, robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch
) -> None:
    robot.faults.reset("user_command")
    await _failed_plan_start(hass, monkeypatch)

    assert robot.received() == []
    assert robot.phase is Phase.DOCKED


@pytest.mark.usefixtures("loaded_entry")
async def test_unacknowledged_plan_start_is_stopped_and_not_sent_again(
    hass: HomeAssistant, robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch
) -> None:
    robot.faults.reset("user_command", after=1)
    await _failed_plan_start(hass, monkeypatch)

    # The robot reports the session this run dispatched, so the run may stop
    # it. The start itself went out once. A background task docks the
    # stopped robot, and its command may not have arrived yet.
    start, stop, *later = robot.received()
    assert parse_coverage_command(start, 0) is not None
    assert stop == STOP_PAYLOAD
    assert later in ([], [DOCK_PAYLOAD])
    assert robot.session is None
