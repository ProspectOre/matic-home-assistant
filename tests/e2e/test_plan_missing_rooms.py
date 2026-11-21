"""A saved plan whose rooms a map edit in the Matic app removed."""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from custom_components.matic_robot.const import DOMAIN, EVENT_PLAN_STARTED
from custom_components.matic_robot.plan_room_repairs import plan_room_issue_id
from custom_components.matic_robot.repairs import async_create_fix_flow

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


async def _clean(plan: PlanRun, robot: SimulatedRobot, start: Any) -> None:
    """Run one managed clean of a single room through to the dock."""
    plan.finished.clear()
    await start
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    assert plan.task is not None
    async with asyncio.timeout(30):
        while not plan.task.done() or not plan.finished:
            await plan.poll()
    await plan.task
    assert plan.finished[-1]["outcome"] == "completed"


async def test_a_plan_runs_the_rooms_left_and_relinks_a_recreated_room(
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
        run_behavior="ordered",
        rooms=[
            {"room": "Kitchen"},
            {
                "room": "Study",
                "cadence": {
                    "coverage_every_n": 3,
                    "periodic_coverage_setting": "heavy_duty",
                },
            },
            {"room": "Hall"},
        ],
    )
    serial = session.info.serial_number
    catalog = runtime.cleaning_plans.catalog
    kitchen, old_study, old_hall = (
        str(room["room_id"]) for room in catalog.plan(serial, PLAN)["rooms"]
    )
    issues = ir.async_get(hass)
    issue_id = plan_room_issue_id(plan.entry.entry_id)
    assert issues.async_get_issue(DOMAIN, issue_id) is None

    robot.set_floor(_edited(floor))
    await session.heartbeat.async_request_floor_plan_refresh(floor.mission_id)
    async with asyncio.timeout(20):
        while len(session.floor.value.rooms) != 2:
            await plan.poll()
    await hass.async_block_till_done()
    new_study = next(
        room.id for room in session.floor.value.rooms if room.name == "Study"
    )
    issue = issues.async_get_issue(DOMAIN, issue_id)
    assert issue is not None
    assert issue.is_fixable
    assert issue.translation_key == "plan_room_relink"
    assert issue.translation_placeholders["plans"] == "Weekly"

    # The plan cleans the kitchen and names the two rooms it skipped.
    started: list[dict[str, Any]] = []
    hass.bus.async_listen(
        EVENT_PLAN_STARTED, lambda event: started.append(dict(event.data))
    )
    await _clean(plan, robot, plan.start_service("run_selected_plan", plan=PLAN))
    assert plan.room_id == kitchen
    assert started[-1]["room_count"] == 1
    assert started[-1]["missing_rooms"] == [
        {"room_id": old_study, "name": "Study", "match_room_id": new_study},
        {"room_id": old_hall, "name": "Hall", "match_room_id": None},
    ]
    assert plan.finished[-1]["missing_rooms"] == started[-1]["missing_rooms"]

    # The Repair moves the study, settings and all, once the user confirms.
    flow = await async_create_fix_flow(hass, issue_id, issue.data)
    flow.hass = hass
    form = await flow.async_step_init()
    assert form["description_placeholders"]["rooms"] == "- Weekly: Study"
    assert (await flow.async_step_init({}))["type"] == "create_entry"
    await hass.async_block_till_done()
    rooms = catalog.plan(serial, PLAN)["rooms"]
    assert [room["room_id"] for room in rooms] == [kitchen, new_study, old_hall]
    assert rooms[1]["cadence"]["coverage_every_n"] == 3

    # The hall has no replacement: the Repair stays, with nothing to move.
    issue = issues.async_get_issue(DOMAIN, issue_id)
    assert issue is not None
    assert not issue.is_fixable
    assert issue.translation_key == "plan_room_missing"
    flow = await async_create_fix_flow(hass, issue_id, issue.data)
    flow.hass = hass
    assert (await flow.async_step_init())["reason"] == "no_matching_rooms"

    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id=PLAN,
        name="Weekly",
        rooms=[{"room": "Kitchen"}, {"room": "Study"}],
    )
    await hass.async_block_till_done()
    assert issues.async_get_issue(DOMAIN, issue_id) is None
