"""A plan run's lifecycle on the bus, the Cleaning run event entity and the logbook."""

from __future__ import annotations

from collections import Counter
from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import Any

import pytest
from homeassistant.components import event as event_component
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import (
    Event,
    EventStateChangedData,
    HomeAssistant,
    ServiceCall,
    callback,
)
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    MockModule,
    mock_integration,
)
from pytest_homeassistant_custom_component.components.recorder.common import (
    async_wait_recording_done,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.matic_robot import session
from custom_components.matic_robot.client import hermes_collections, hermes_connection
from custom_components.matic_robot.const import (
    DOMAIN,
    EVENT_PLAN_STARTED,
    RUN_EVENT_TYPES,
)

from .hermes_sim import RunningSimulator, SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished, state_becomes
from .sim_mission import SimFloor, three_room_floor, two_room_floor

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


@pytest.fixture
async def run_logbook(
    recorder_mock: Any, hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> Callable[[], Awaitable[None]]:
    """Load the logbook, record every run bus event, and check them against it.

    The check asserts that the Cleaning run entity's state changes, which its
    automation triggers follow, and the logbook each hold every recorded run
    event once, in order, and that the logbook lists nothing from the bus.
    """
    # The logbook's frontend panel needs the frontend package, which the
    # tests do not install; the logbook itself does not.
    mock_integration(hass, MockModule("frontend"))
    assert await async_setup_component(hass, "logbook", {})
    since = dt_util.utcnow()
    fired: list[str] = []
    changed: list[str] = []

    @callback
    def record(event: Event[EventStateChangedData]) -> None:
        state = event.data["new_state"]
        if state is not None and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            changed.append(f"{DOMAIN}_{state.attributes['event_type']}")

    async_track_state_change_event(hass, RUN_ENTITY, record)
    for kind in RUN_EVENT_TYPES:
        hass.bus.async_listen(
            f"{DOMAIN}_{kind}", callback(lambda event: fired.append(event.event_type))
        )

    async def check() -> None:
        await hass.async_block_till_done()
        await async_wait_recording_done(hass)
        client = await hass_ws_client(hass)
        await client.send_json_auto_id(
            {"type": "logbook/get_events", "start_time": since.isoformat()}
        )
        response = await client.receive_json()
        assert response["success"], response
        entries = response["result"]
        assert [entry for entry in entries if entry.get("domain") == DOMAIN] == []
        logged = [
            f"{DOMAIN}_{entry['attributes']['event_type']}"
            for entry in entries
            if entry.get("entity_id") == RUN_ENTITY
            and entry["state"] not in (STATE_UNKNOWN, STATE_UNAVAILABLE)
        ]
        for seen in (changed, logged):
            assert seen == fired, (
                f"missing {sorted((Counter(fired) - Counter(seen)).elements())}, "
                f"extra {sorted((Counter(seen) - Counter(fired)).elements())}"
            )

    return check


async def test_each_run_event_shows_once_in_the_logbook(
    run_logbook: Callable[[], Awaitable[None]],
    plan: PlanRun,
    robot: SimulatedRobot,
) -> None:
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
    await run_logbook()


@pytest.mark.parametrize("floor", [three_room_floor()], ids=["three_rooms"])
async def test_a_burst_of_run_events_shows_once_each_in_the_logbook(
    run_logbook: Callable[[], Awaitable[None]],
    hass: HomeAssistant,
    plan: PlanRun,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Plan started and both Room held fire in one loop step. The worst case is
    # every event entity trigger at the same instant.
    frozen = dt_util.utcnow()
    monkeypatch.setattr(
        event_component,
        "dt_util",
        SimpleNamespace(utcnow=lambda: frozen, parse_datetime=dt_util.parse_datetime),
    )
    sensors = {}
    for name in ("Study", "Hall"):
        sensor = f"binary_sensor.{name.lower()}_occupancy"
        hass.states.async_set(sensor, "on", {"device_class": "occupancy"})
        sensors[_room_id(plan, name)] = sensor
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id="evening",
        name="Evening",
        run_behavior="ordered",
        rooms=[{"room": "Kitchen"}, {"room": "Study"}, {"room": "Hall"}],
        occupancy_aware=True,
        occupancy_sensors=sensors,
    )
    await plan.start_service("run_selected_plan", plan="evening")
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    expect_finished(
        await plan.outcome(), "completed", "all_rooms_verified", 1, "docked", rooms=1
    )
    await run_logbook()


def _room_id(plan: PlanRun, name: str) -> str:
    floor_plan = plan.entry.runtime_data.session.floor.value
    return next(room.id for room in floor_plan.rooms if room.name == name)


@pytest.mark.usefixtures("fast_keepalive")
async def test_the_run_entity_stays_available_while_the_robot_is_unreachable(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    simulator: RunningSimulator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A run ends in Home Assistant, so its last events must still be recorded.
    monkeypatch.setattr(hermes_collections, "RPC_TIMEOUT", 0.2)
    monkeypatch.setattr(hermes_connection, "RPC_TIMEOUT", 0.2)
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


async def test_device_triggers_follow_this_robots_run(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    device_id = er.async_get(hass).async_get(VACUUM).device_id
    # Another robot's device, whose triggers must stay quiet.
    other = dr.async_get(hass).async_get_or_create(
        config_entry_id=plan.entry.entry_id, identifiers={(DOMAIN, "other-robot")}
    )
    other_vacuum = er.async_get(hass).async_get_or_create(
        "vacuum", DOMAIN, "other-robot_vacuum", device_id=other.id
    )
    fired: list[str] = []
    # A callback, so the action finishes in the loop. A plain function runs in
    # the executor, and a single-mode automation skips a trigger that arrives
    # while its previous action is still there.
    hass.services.async_register(
        "test", "automation", callback(lambda call: fired.append(call.data["type"]))
    )

    def automation(device: str, trigger_type: str) -> dict[str, Any]:
        return {
            "triggers": [
                {
                    "trigger": "device",
                    "domain": DOMAIN,
                    "device_id": device,
                    "type": trigger_type,
                }
            ],
            "actions": [{"action": "test.automation", "data": {"type": trigger_type}}],
        }

    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                automation(device_id, "room_completed"),
                automation(device_id, "plan_finished"),
                automation(other.id, "plan_finished"),
            ]
        },
    )
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

    assert fired == ["room_completed", "room_completed", "plan_finished"]
    # The other robot's trigger is attached and answers only its own robot.
    hass.bus.async_fire(
        f"{DOMAIN}_plan_finished", {"entity_id": other_vacuum.entity_id}
    )
    await hass.async_block_till_done()
    assert fired[3:] == ["plan_finished"]
