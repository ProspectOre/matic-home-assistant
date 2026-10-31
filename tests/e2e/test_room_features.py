"""Go to room, the sink trip, occupancy holds and robot alerts."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import RESUME_PAYLOAD, Phase, SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished
from .sim_mission import SimFloor, two_room_floor

STUDY_OCCUPANCY = "binary_sensor.study_occupancy"
ROBOT_ALERT = "sensor.simulated_matic_robot_alert"


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


def _room_id(entry: MockConfigEntry, name: str) -> str:
    floor_plan = entry.runtime_data.coordinator.data.floor_plan
    return next(room.id for room in floor_plan.rooms if room.name == name)


async def test_go_to_room_from_the_dock(
    plan: PlanRun, robot: SimulatedRobot, floor: SimFloor
) -> None:
    await plan.call(DOMAIN, "go_to_room", room="Study")
    assert robot.destination == floor.rooms[1].id
    assert robot.current_area == "Study"
    assert robot.session is None


async def test_go_to_room_during_a_plan_keeps_the_run(
    plan: PlanRun, robot: SimulatedRobot, floor: SimFloor
) -> None:
    await plan.start()
    await plan.call(DOMAIN, "go_to_room", room="Study")
    assert robot.destination == floor.rooms[1].id
    assert robot.phase is Phase.PAUSED
    await plan.call("vacuum", "start")
    assert robot.phase is Phase.CLEANING
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    # The visit and Resume did not restart the task.
    assert len(plan.coverage_commands()) == 1
    assert robot.received()[-1] == RESUME_PAYLOAD


async def test_go_to_an_unknown_room_is_refused(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    with pytest.raises(ServiceValidationError) as err:
        await plan.call(DOMAIN, "go_to_room", room="Garage")
    assert err.value.translation_key == "unknown_rooms"
    assert robot.received() == []


async def test_sink_trip_waits_for_the_refill_then_docks(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    posture = b"\x0a\x04sink"
    robot.save_sink(posture)
    await plan.call("vacuum", "send_command", command="sink_summon")
    assert robot.waiting_at_sink
    (sent,) = robot.received()
    assert posture in sent
    robot.refilled()
    robot.arrive_at_dock()
    await plan.poll()
    vacuum = plan.hass.states.get(VACUUM)
    assert vacuum is not None and vacuum.state == "docked"


async def test_sink_trip_without_a_saved_sink_is_refused(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    # Served only here: an empty collection makes every read wait out its
    # snapshot window, which would slow each setup.
    robot.set_collection("sink_summon_locations", [])
    with pytest.raises(ServiceValidationError) as err:
        await plan.call("vacuum", "send_command", command="sink_summon")
    assert err.value.translation_key == "sink_location_unavailable"
    assert robot.received() == []


async def test_occupied_room_is_held_out_of_a_saved_plan(
    hass: HomeAssistant,
    plan: PlanRun,
    robot: SimulatedRobot,
    floor: SimFloor,
) -> None:
    hass.states.async_set(STUDY_OCCUPANCY, "on", {"device_class": "occupancy"})
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id="evening",
        name="Evening",
        run_behavior="ordered",
        rooms=[{"room": "Kitchen"}, {"room": "Study"}],
        occupancy_aware=True,
        occupancy_sensors={_room_id(plan.entry, "Study"): STUDY_OCCUPANCY},
    )
    await plan.start_service("run_selected_plan", plan="evening")
    assert robot.session is not None
    assert robot.session.rooms == [floor.rooms[0].id]
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 1, "docked", rooms=1)


async def test_full_bag_raises_a_repair_until_emptied(
    hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot
) -> None:
    issue_id = f"robot_alert_bag_full_{plan.entry.entry_id}"
    registry = ir.async_get(hass)
    robot.set_errors(206)
    # A code counts once it is seen on two polls in a row.
    await plan.poll()
    assert registry.async_get_issue(DOMAIN, issue_id) is None
    await plan.poll()
    assert registry.async_get_issue(DOMAIN, issue_id) is not None
    alert = hass.states.get(ROBOT_ALERT)
    assert alert is not None and alert.state == "bag_full"
    robot.set_errors()
    await plan.poll()
    await plan.poll()
    assert registry.async_get_issue(DOMAIN, issue_id) is None
    alert = hass.states.get(ROBOT_ALERT)
    assert alert is not None and alert.state == "none"
