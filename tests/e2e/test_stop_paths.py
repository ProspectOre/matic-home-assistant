"""Every Stop and every dock after a stop, as the robot receives it.

One row per path a person or a run can take to stop the robot. The robot
gets STOP only while it holds a task or while the vacuum's own Stop asks for
it, and DOCK only once it reports that stop settled.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import pytest
from homeassistant.core import HomeAssistant

from custom_components.matic_robot import stop_return
from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import DOCK_PAYLOAD, STOP_PAYLOAD, SimulatedRobot
from .plan_run import PlanRun, active_plan
from .sim_mission import parse_coverage_command

# A robot that is still due a command gets it well within this many polls.
SETTLE_POLLS = 20


def _commands(robot: SimulatedRobot, since: int) -> list[str]:
    """Name each user command the robot received after the first ``since``."""
    names = {STOP_PAYLOAD: "STOP", DOCK_PAYLOAD: "DOCK"}
    return [
        names.get(payload)
        or ("coverage" if parse_coverage_command(payload, 0) is not None else "other")
        for payload in robot.received()[since:]
    ]


async def _plan(plan: PlanRun) -> None:
    await plan.start()


async def _smart_stop_plan(plan: PlanRun) -> None:
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


async def _app_clean(plan: PlanRun) -> None:
    plan.robot.start_cleaning("Kitchen")
    await plan.poll()


async def _idle(plan: PlanRun) -> None:
    await plan.poll()


async def _vacuum_stop(plan: PlanRun) -> None:
    await plan.call("vacuum", "stop")


async def _return_to_base(plan: PlanRun) -> None:
    await plan.call("vacuum", "return_to_base")


async def _stop_service(plan: PlanRun) -> None:
    await plan.call(DOMAIN, "stop_intelligent_cleaning")


async def _stop_service_unmanaged(plan: PlanRun) -> None:
    await plan.call(DOMAIN, "stop_intelligent_cleaning", include_unmanaged=True)


async def _smart_stop_after_room(plan: PlanRun) -> None:
    """Stop with Smart Stop: the robot finishes the Kitchen and goes home."""
    await _stop_service(plan)
    async with asyncio.timeout(10):
        while active_plan(plan.hass).get("smart_stop_phase") != "finishing_room":
            await plan.poll()
    plan.robot.finish_room()
    plan.robot.finish_session()
    await plan.outcome()


async def _smart_stop_now(plan: PlanRun) -> None:
    """Stop with Smart Stop, then Stop now while the Kitchen finishes."""
    await _stop_service(plan)
    async with asyncio.timeout(10):
        while len(plan.coverage_commands()) < 2:
            await plan.poll()
    await plan.call(
        DOMAIN, "stop_intelligent_cleaning", stop_now=True, expected_run_id=plan.run_id
    )


async def _robot_fault(plan: PlanRun) -> None:
    plan.robot.fault(326)
    await plan.outcome()


async def _unload(plan: PlanRun) -> None:
    assert await plan.hass.config_entries.async_unload(plan.entry.entry_id)


@dataclass(frozen=True, slots=True)
class StopPath:
    setup: Callable[[PlanRun], Awaitable[None]]
    stop: Callable[[PlanRun], Awaitable[None]]
    sent: tuple[str, ...]


PATHS = {
    # The vacuum's Stop always sends STOP, then docks once the robot settles.
    "vacuum_stop_plan": StopPath(_plan, _vacuum_stop, ("STOP", "DOCK")),
    "vacuum_stop_app_clean": StopPath(_app_clean, _vacuum_stop, ("STOP", "DOCK")),
    # At the dock the robot reports the stop settled at home: no DOCK.
    "vacuum_stop_docked": StopPath(_idle, _vacuum_stop, ("STOP",)),
    # Return to base stops a held task first; an idle robot only docks.
    "return_to_base_plan": StopPath(_plan, _return_to_base, ("STOP", "DOCK")),
    "return_to_base_app_clean": StopPath(_app_clean, _return_to_base, ("STOP", "DOCK")),
    "return_to_base_docked": StopPath(_idle, _return_to_base, ("DOCK",)),
    # Stop cleaning returns home through Return to base.
    "stop_plan_service": StopPath(_plan, _stop_service, ("STOP", "DOCK")),
    "stop_plan_service_no_run": StopPath(_app_clean, _stop_service, ()),
    "stop_plan_service_unmanaged": StopPath(
        _app_clean, _stop_service_unmanaged, ("STOP", "DOCK")
    ),
    "stop_plan_service_unmanaged_docked": StopPath(
        _idle, _stop_service_unmanaged, ("DOCK",)
    ),
    # Smart Stop drops the waiting rooms; the robot ends its task and returns.
    "smart_stop_end_after_current": StopPath(
        _smart_stop_plan, _smart_stop_after_room, ("coverage",)
    ),
    "smart_stop_stop_now": StopPath(
        _smart_stop_plan, _smart_stop_now, ("coverage", "STOP", "DOCK")
    ),
    # A failed run stops its own task; a faulted robot never reports it settled.
    "run_failure": StopPath(_plan, _robot_fault, ("STOP",)),
    # Unload leaves the run's task with the robot.
    "unload_during_run": StopPath(_plan, _unload, ()),
}


@pytest.mark.parametrize("path", PATHS.values(), ids=PATHS.keys())
async def test_each_stop_path_sends_its_commands_in_order(
    plan: PlanRun,
    robot: SimulatedRobot,
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    path: StopPath,
) -> None:
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_POLL_SECONDS", 0.05)
    await path.setup(plan)
    sent = len(robot.received())

    await path.stop(plan)
    for _ in range(SETTLE_POLLS):
        if not hass.config_entries.async_loaded_entries(DOMAIN):
            break
        await plan.poll()
        await asyncio.sleep(stop_return.DOCK_SETTLE_POLL_SECONDS)

    assert tuple(_commands(robot, sent)) == path.sent
    if plan.task is not None:
        await asyncio.gather(plan.task, return_exceptions=True)
