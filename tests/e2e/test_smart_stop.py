"""Smart Stop against the simulated robot: Stop finishes the room, then docks."""

from __future__ import annotations

import asyncio
from itertools import accumulate

import pytest
from homeassistant.core import HomeAssistant, callback
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.matic_robot.const import (
    DOMAIN,
    EVENT_PLAN_DOCKED,
    EVENT_PLAN_FINISHED,
)
from custom_components.matic_robot.http import plans_api_url

from .hermes_sim import DOCK_PAYLOAD, STOP_PAYLOAD, Phase, SimulatedRobot
from .plan_run import (
    VACUUM,
    PlanRun,
    active_plan,
    expect_finished,
    state_becomes,
)
from .sim_mission import SimFloor, parse_coverage_command


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


async def _smart_stop(plan: PlanRun) -> None:
    """Press Stop and wait until the robot has the request to drop Study."""
    await _stop(plan.hass)
    async with asyncio.timeout(10):
        while len(plan.coverage_commands()) < 2:
            await plan.poll()


def _run_ends(hass: HomeAssistant) -> list[str]:
    """Record plan_finished and plan_docked in the order they fire."""
    order: list[str] = []
    for event_type in (EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED):
        hass.bus.async_listen(
            event_type, callback(lambda e: order.append(e.event_type))
        )
    return order


async def _docked(plan: PlanRun) -> dict[str, object]:
    """Poll until the run's dock closure arrives and return plan_docked."""
    async with asyncio.timeout(30):
        while not plan.docked:
            await plan.poll()
    (docked,) = plan.docked
    return docked


def _stored_outcome(plan: PlanRun) -> object:
    ledger = plan.entry.runtime_data.cleaning_plans.ledger
    assert plan.run_id is not None
    run = ledger.run_record(plan.robot.serial_number, plan.run_id)
    assert run is not None
    return run["outcome"]


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

    await _smart_stop(plan)

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
    # The run ends with the Kitchen verified; the dock closes it after.
    expect_finished(finished, "cancelled", "managed_stop", 1, "returning", "docked")
    assert (await _docked(plan))["outcome"] == "stopped_docked"
    assert STOP_PAYLOAD not in robot.received()


async def test_stop_now_ends_the_room_being_finished(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await _start_smart_stop_plan(plan)
    await _smart_stop(plan)
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
    # The robot has the request to drop Study before Home Assistant restarts.
    await _smart_stop(plan)
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
    expect_finished(finished, "cancelled", "managed_stop", 1, "returning", "docked")
    assert (await _docked(plan))["outcome"] == "stopped_docked"
    # Recovery rejoined the mission and sent the robot nothing.
    assert robot.received()[sent:] == []


@pytest.mark.parametrize("docked_first", [False, True], ids=["verified", "docked"])
async def test_smart_stop_closes_at_the_dock_after_plan_finished(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant, docked_first: bool
) -> None:
    order = _run_ends(hass)
    await _start_smart_stop_plan(plan)
    await _smart_stop(plan)
    if docked_first:
        # The Kitchen's history arrives only once the robot is home.
        robot.hold_history()
    robot.finish_room()
    robot.finish_session()
    if docked_first:
        await plan.poll()
        robot.arrive_at_dock()
        await state_becomes(hass, VACUUM, "docked")
        robot.release_history()
    else:
        await plan.wait_for_finished()
        robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(
        finished,
        "cancelled",
        "managed_stop",
        1,
        "docked" if docked_first else "returning",
    )
    docked = await _docked(plan)
    assert docked["outcome"] == "stopped_docked"
    assert order == [EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED]
    assert _stored_outcome(plan) == "stopped_docked"
    assert STOP_PAYLOAD not in robot.received()


async def _verify_after_smart_stop(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Smart Stop the run, end the Kitchen and hold its history back."""
    await _start_smart_stop_plan(plan)
    await _smart_stop(plan)
    robot.hold_history()
    robot.finish_room()
    robot.finish_session()
    async with asyncio.timeout(10):
        while active_plan(plan.hass).get("smart_stop_phase") != "verifying_completion":
            await plan.poll()


async def test_unload_while_smart_stop_verifies_returns_at_once(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await _verify_after_smart_stop(plan, robot)

    # The history read waits for the Kitchen's record; unload ends it.
    async with asyncio.timeout(5):
        assert await hass.config_entries.async_unload(plan.entry.entry_id)
    assert plan.task is not None and plan.task.done()


async def test_restart_while_smart_stop_verifies_finishes_then_docks(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    order = _run_ends(hass)
    await _verify_after_smart_stop(plan, robot)
    sent = len(robot.received())

    assert await hass.config_entries.async_reload(plan.entry.entry_id)
    plans = plan.entry.runtime_data.cleaning_plans
    async with asyncio.timeout(10):
        # Recovery resumes the history read the restart interrupted.
        while (plans.recovery.recovery_run(robot.serial_number) or {}).get(
            "recovery_reason"
        ) != "native_end_previously_observed":
            await plan.poll()
    robot.release_history()
    # Recovery verifies the Kitchen alone: Study left the robot's queue.
    finished = await plan.wait_for_finished()
    expect_finished(finished, "cancelled", "managed_stop", 1, "returning")
    robot.arrive_at_dock()
    docked = await _docked(plan)
    assert docked["outcome"] == "stopped_docked"
    assert order == [EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED]
    assert _stored_outcome(plan) == "stopped_docked"
    # Recovery sent the robot nothing.
    assert robot.received()[sent:] == []
