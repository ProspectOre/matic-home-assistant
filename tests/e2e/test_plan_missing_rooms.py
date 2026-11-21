"""A saved plan whose rooms a map edit in the Matic app removed."""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import issue_registry as ir

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plan_room_repairs import plan_room_issue_id

from .hermes_sim import SimulatedRobot
from .plan_run import PlanRun
from .sim_mission import SimFloor, SimRoom, three_room_floor

PLAN = "weekly"


@pytest.fixture
def floor() -> SimFloor:
    return three_room_floor()


def _edited(floor: SimFloor) -> SimFloor:
    """The Matic app re-created the study with a new ID and removed the hall."""
    kitchen, study, _hall = floor.rooms
    new_study = SimRoom(
        UUID("44444444-4444-4444-8444-444444444444"), study.name, study.outline
    )
    return SimFloor(floor.mission_id, floor.partition_id, (kitchen, new_study))


async def test_a_plan_with_removed_rooms_names_them_and_raises_a_repair(
    hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot, floor: SimFloor
) -> None:
    runtime = plan.entry.runtime_data
    session = runtime.session
    async with asyncio.timeout(20):
        while session.floor.value is None:
            await plan.poll()
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id=PLAN,
        name="Weekly",
        rooms=[{"room": "Kitchen"}, {"room": "Study"}, {"room": "Hall"}],
    )
    serial = session.info.serial_number
    saved = runtime.cleaning_plans.catalog.plan(serial, PLAN)["rooms"]
    old_study, old_hall = (str(room["room_id"]) for room in saved[1:])
    issues = ir.async_get(hass)
    issue_id = plan_room_issue_id(plan.entry.entry_id)
    assert issues.async_get_issue(DOMAIN, issue_id) is None

    robot.set_floor(_edited(floor))
    await session.heartbeat.async_request_floor_plan_refresh(floor.mission_id)
    async with asyncio.timeout(20):
        while len(session.floor.value.rooms) != 2:
            await plan.poll()
    await hass.async_block_till_done()

    issue = issues.async_get_issue(DOMAIN, issue_id)
    assert issue is not None
    assert issue.translation_placeholders["plans"] == "Weekly"

    commands = len(plan.coverage_commands())
    with pytest.raises(ServiceValidationError) as raised:
        await plan.call(DOMAIN, "run_selected_plan", plan=PLAN)
    assert raised.value.translation_key == "plan_room_missing"
    assert raised.value.translation_placeholders == {
        "rooms": f"{old_study}, {old_hall}"
    }
    assert len(plan.coverage_commands()) == commands

    # Saving the plan with the rooms on the map clears the Repair.
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id=PLAN,
        name="Weekly",
        rooms=[{"room": "Kitchen"}, {"room": "Study"}],
    )
    await hass.async_block_till_done()
    assert issues.async_get_issue(DOMAIN, issue_id) is None
