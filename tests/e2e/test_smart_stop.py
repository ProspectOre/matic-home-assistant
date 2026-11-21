"""Smart Stop against the simulated robot: Stop finishes the room, then docks."""

from __future__ import annotations

import asyncio
from itertools import accumulate

import pytest
from homeassistant.components import frontend as ha_frontend
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockModule, mock_integration
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.http import plans_api_url

from .hermes_sim import DOCK_PAYLOAD, STOP_PAYLOAD, Phase, SimulatedRobot
from .plan_run import VACUUM, PlanRun, active_plan, expect_finished
from .sim_mission import SimFloor, parse_coverage_command


@pytest.fixture
async def frontend(hass: HomeAssistant) -> None:
    """Matic Map's views are served only beside the frontend.

    The frontend package is not a test dependency, so a stand-in is loaded
    with the module list Matic Map registers into.
    """
    mock_integration(hass, MockModule("frontend"))
    assert await async_setup_component(hass, "frontend", {})
    hass.data[ha_frontend.DATA_EXTRA_MODULE_URL] = set()


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


async def test_the_preview_shows_the_missions_the_run_sends(
    frontend: None,
    plan: PlanRun,
    robot: SimulatedRobot,
    hass_client: ClientSessionGenerator,
) -> None:
    await _start_smart_stop_plan(plan)
    response = await (await hass_client()).get(plans_api_url(plan.entry.entry_id))
    (saved,) = (await response.json())["plans"]
    preview = saved["next_run_preview"]
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    expect_finished(
        await plan.outcome(), "completed", "all_rooms_verified", 2, "docked"
    )

    # Each coverage command is one mission; the preview marks where each ends.
    missions = [
        parse_coverage_command(payload, 0) for payload in plan.coverage_commands()
    ]
    sent = [len(mission.visits) for mission in missions if mission is not None]
    assert sent == [2]
    assert preview["blocker"] is None
    assert preview["mission_boundaries"] == list(accumulate(sent))[:-1]


async def test_restart_during_smart_stop_finishes_the_room_then_docks(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant, floor: SimFloor
) -> None:
    await _start_smart_stop_plan(plan)
    await _stop(hass)
    # The robot has the request to drop Study before Home Assistant restarts.
    async with asyncio.timeout(10):
        while len(plan.coverage_commands()) < 2:
            await plan.poll()
    sent = len(robot.received())

    assert await hass.config_entries.async_reload(plan.entry.entry_id)
    await plan.wait_for_recovery()
    # The recovered run still finishes the Kitchen and skips Study.
    async with asyncio.timeout(10):
        while (active := active_plan(hass)).get("smart_stop_phase") is None:
            await plan.poll()
    assert active["room"] == "Kitchen"
    assert active["smart_stop_phase"] == "finishing_room"
    assert robot.phase is Phase.CLEANING
    assert robot.session is not None
    assert robot.session.rooms == [floor.rooms[0].id]
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.wait_for_finished()
    expect_finished(finished, "stopped_docked", "stopped_docked", 1, "docked")
    # Recovery rejoined the mission and sent the robot nothing.
    assert robot.received()[sent:] == []
