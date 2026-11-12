"""Plan actions start the run in the background against the simulated robot."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.const import DOMAIN, EVENT_PLAN_FINISHED

from .hermes_sim import Phase, SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished
from .sim_mission import SimFloor, two_room_floor

ROOMS = {ATTR_ENTITY_ID: VACUUM, "rooms": [{"room": "Kitchen"}, {"room": "Study"}]}


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def _start(hass: HomeAssistant, plan: PlanRun) -> str:
    """Call the action without wait and return the run_id it answers with."""
    call = hass.async_create_task(
        hass.services.async_call(
            DOMAIN, "clean_room_sequence", ROOMS, blocking=True, return_response=True
        )
    )
    async with asyncio.timeout(10):
        while not call.done():
            await plan.poll()
    response = await call
    assert response is not None
    return str(response["run_id"])


async def test_action_returns_once_the_robot_starts_and_the_run_goes_on(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    finished: list[dict[str, Any]] = []
    hass.bus.async_listen(
        EVENT_PLAN_FINISHED, lambda event: finished.append(dict(event.data))
    )
    run_id = await _start(hass, plan)
    # The action returned with the one start command sent and the run going.
    assert len(plan.coverage_commands()) == 1
    serial = robot.serial_number
    plans = plan.entry.runtime_data.cleaning_plans
    assert plans.control.lock(serial).locked()
    assert plans.ledger.active_run_id(serial) == run_id
    with pytest.raises(ServiceValidationError) as refused:
        await hass.services.async_call(DOMAIN, "clean_room_sequence", ROOMS, True)
    assert refused.value.translation_key == "plan_already_running"

    async with asyncio.timeout(10):
        await robot.wait_for_phase(Phase.CLEANING)
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    async with asyncio.timeout(30):
        while not finished:
            await plan.poll()
    (event,) = finished
    expect_finished(event, "completed", "all_rooms_verified", 2, "docked")
    assert event["run_id"] == run_id
    assert len(plan.coverage_commands()) == 1
    assert plans.control.actor(serial).run_task is None


async def test_unload_stops_a_background_run_and_restart_recovers_it(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    run_id = await _start(hass, plan)
    serial = robot.serial_number
    plans = plan.entry.runtime_data.cleaning_plans
    task = plans.control.actor(serial).run_task
    assert task is not None
    assert await hass.config_entries.async_unload(plan.entry.entry_id)
    assert task.done()
    assert plans.control.actor(serial).run_task is None
    assert not plans.control.lock(serial).locked()
    # Home Assistant kept the run for recovery, as for an awaited run.
    assert plans.recovery.recovery_run(serial)["run_id"] == run_id
    assert await hass.config_entries.async_setup(plan.entry.entry_id)
    assert len(plan.coverage_commands()) == 1
