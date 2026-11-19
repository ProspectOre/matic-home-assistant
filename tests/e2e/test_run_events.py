"""A plan run's lifecycle on the bus, the Cleaning run event entity and the logbook."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import (
    Event,
    EventStateChangedData,
    HomeAssistant,
    ServiceCall,
    callback,
)
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.components.recorder.common import (
    async_wait_recording_done,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.matic_robot import session
from custom_components.matic_robot.client import hermes_collections, hermes_connection
from custom_components.matic_robot.const import DOMAIN, EVENT_PLAN_STARTED

from .hermes_sim import RunningSimulator, SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished, state_becomes
from .sim_mission import SimFloor, two_room_floor

RUN_ENTITY = "event.simulated_matic_cleaning_run"


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def test_a_plan_run_reaches_the_event_entity_in_order(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    seen: list[dict[str, Any]] = []
    started: list[dict[str, Any]] = []

    @callback
    def record(event: Event[EventStateChangedData]) -> None:
        state = event.data["new_state"]
        if state is not None and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            seen.append(dict(state.attributes))

    async_track_state_change_event(hass, RUN_ENTITY, record)
    # Home Assistant's own event entity trigger needs nothing from Matic.
    triggered: list[ServiceCall] = []
    hass.services.async_register("test", "automation", triggered.append)
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": {
                "mode": "queued",
                "triggers": [
                    {
                        "trigger": "event.received",
                        "target": {"entity_id": RUN_ENTITY},
                        "options": {"event_type": ["room_completed"]},
                    }
                ],
                "actions": [{"action": "test.automation"}],
            }
        },
    )
    hass.bus.async_listen(EVENT_PLAN_STARTED, lambda event: started.append(event.data))
    await plan.start()
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    await hass.async_block_till_done()

    # plan_started names the run as plan_finished does.
    (begun,) = started
    assert begun["entity_id"] == VACUUM
    assert dict(begun) == {
        key: finished[key]
        for key in (
            "entity_id",
            "plan_id",
            "run_id",
            "trigger",
            "provenance",
            "service",
            "started_at",
            "room_count",
        )
    }

    plan_events = [
        attributes["event_type"]
        for attributes in seen
        if attributes["event_type"] != "cleaning_finished"
    ]
    assert plan_events[0] == "plan_started"
    assert plan_events[-1] == "plan_finished"
    assert sorted(plan_events[1:-1]) == [
        "room_completed",
        "room_completed",
        "room_started",
        "room_started",
    ]
    # The entity holds the event's payload, less the robot it names.
    last = next(a for a in reversed(seen) if a["event_type"] == "plan_finished")
    assert {key: last[key] for key in finished if key != "entity_id"} == {
        key: value for key, value in finished.items() if key != "entity_id"
    }
    assert "entity_id" not in last
    assert len(triggered) == 2


async def test_each_run_event_shows_once_in_the_logbook(
    recorder_mock: Any,
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    plan: PlanRun,
    robot: SimulatedRobot,
) -> None:
    assert await async_setup_component(hass, "logbook", {})
    since = dt_util.utcnow()
    await plan.start()
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    expect_finished(
        await plan.outcome(), "completed", "all_rooms_verified", 2, "docked"
    )
    await hass.async_block_till_done()
    await async_wait_recording_done(hass)

    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "logbook/get_events", "start_time": since.isoformat()}
    )
    response = await client.receive_json()
    assert response["success"]
    entries = response["result"]
    # The entity's state changes are the run's only entries: no bus event is
    # described a second time.
    assert [entry for entry in entries if entry.get("domain") == DOMAIN] == []
    run_types = [
        entry["attributes"]["event_type"]
        for entry in entries
        if entry.get("entity_id") == RUN_ENTITY
        and entry["state"] not in (STATE_UNKNOWN, STATE_UNAVAILABLE)
    ]
    plan_types = [kind for kind in run_types if kind != "cleaning_finished"]
    assert plan_types[0] == "plan_started"
    assert plan_types[-1] == "plan_finished"
    assert sorted(plan_types[1:-1]) == [
        "room_completed",
        "room_completed",
        "room_started",
        "room_started",
    ]


@pytest.mark.usefixtures("fast_keepalive")
async def test_the_run_entity_stays_available_while_the_robot_is_unreachable(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    simulator: RunningSimulator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A run ends in Home Assistant, so its last events must still be recorded.
    monkeypatch.setattr(hermes_collections, "_RPC_TIMEOUT", 0.2)
    monkeypatch.setattr(hermes_connection, "_RPC_TIMEOUT", 0.2)
    monkeypatch.setattr(session, "UNREACHABLE_AFTER_SECONDS", 0.2)
    simulator.link.stall()
    await state_becomes(hass, VACUUM, STATE_UNAVAILABLE)
    hass.bus.async_fire(
        f"{DOMAIN}_plan_finished", {"entity_id": VACUUM, "outcome": "failed"}
    )
    await hass.async_block_till_done()
    state = hass.states.get(RUN_ENTITY)
    assert state is not None
    assert state.attributes["event_type"] == "plan_finished"
    simulator.link.restore()
    await state_becomes(hass, VACUUM, "docked")
