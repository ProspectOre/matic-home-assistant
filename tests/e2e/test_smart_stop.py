"""Smart Stop against the simulated robot: Stop finishes the room, then docks."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant

from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import DOCK_PAYLOAD, STOP_PAYLOAD, Phase, SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished
from .sim_mission import SimFloor, two_room_floor


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def _start_smart_stop_plan(plan: PlanRun) -> None:
    """Run Kitchen then Study with Smart Stop, the room past its share at once."""
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id="evening",
        name="Evening",
        run_behavior="ordered",
        rooms=[{"room": "Kitchen"}, {"room": "Study"}],
        finish_current_room=True,
        finish_current_room_threshold=0,
    )
    await plan.start_service("run_selected_plan", plan="evening")


async def _stop(hass: HomeAssistant, **data: object) -> None:
    await hass.services.async_call(
        DOMAIN,
        "stop_intelligent_cleaning",
        {"entity_id": VACUUM, **data},
        blocking=True,
    )


async def test_stop_finishes_the_current_room_and_skips_the_rest(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant, floor: SimFloor
) -> None:
    await _start_smart_stop_plan(plan)

    await _stop(hass)
    await plan.poll()

    # The robot keeps cleaning the Kitchen; Study leaves its queue.
    assert robot.phase is Phase.CLEANING
    assert robot.session is not None
    assert robot.session.rooms == [floor.rooms[0].id]
    assert STOP_PAYLOAD not in robot.received()
    # The vacuum's own stop, by action or command, follows the same policy.
    await plan.call("vacuum", "stop")
    await plan.call("vacuum", "send_command", command="stop")
    assert robot.phase is Phase.CLEANING
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    finished = await plan.outcome()
    expect_finished(finished, "stopped_docked", "stopped_docked", 1, "docked")
    assert STOP_PAYLOAD not in robot.received()


async def test_stop_now_ends_the_room_being_finished(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await _start_smart_stop_plan(plan)
    await _stop(hass)
    await plan.poll()
    assert robot.phase is Phase.CLEANING

    sent = len(robot.received())
    await _stop(hass, stop_now=True, expected_run_id=plan.run_id)
    await plan.poll()

    assert robot.received()[sent:] == [STOP_PAYLOAD, DOCK_PAYLOAD]
    assert robot.phase is Phase.RETURNING
    robot.arrive_at_dock()
    finished = await plan.outcome()
    # The Kitchen was cut short, so no room counts as cleaned.
    expect_finished(finished, "cancelled", "managed_stop", 0, "idle", "docked")
