"""A plan run's lifecycle on the bus and the Cleaning run event entity."""

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

from custom_components.matic_robot.const import EVENT_PLAN_STARTED

from .hermes_sim import SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished
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
