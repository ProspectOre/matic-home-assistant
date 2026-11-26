"""A managed plan run whose robot stops answering mid-run.

Losing contact is not a take-over: only the robot reporting a different task
is. The run waits for the robot as long as restart recovery does, then ends
as connection lost without sending anything.
"""

from __future__ import annotations

import asyncio

import pytest
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot import managed_run

from .hermes_sim import RunningSimulator, SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished, state_becomes


async def _outage(hass: HomeAssistant, simulator: RunningSimulator) -> None:
    """Take the robot off the network until its vacuum shows unavailable.

    A cut resets the connection and refuses each redial, so reads fail and the
    failed dial marks the robot unreachable at once, with production timeouts.
    """
    simulator.link.cut()
    await state_becomes(hass, VACUUM, STATE_UNAVAILABLE)


async def test_lost_contact_ends_as_connection_lost_not_taken_over(
    plan: PlanRun,
    robot: SimulatedRobot,
    simulator: RunningSimulator,
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(managed_run, "RECONNECT_SECONDS", 0.5)
    await plan.start()
    received = robot.received()
    await _outage(hass, simulator)
    assert plan.task is not None
    async with asyncio.timeout(10):
        while not plan.task.done():  # noqa: ASYNC110
            await asyncio.sleep(0.05)
    simulator.link.restore()

    finished = await plan.outcome()
    expect_finished(finished, "unverified", "connection_lost", 0, "unavailable")
    assert finished["cause"] == "unknown"
    assert isinstance(plan.error, ServiceValidationError)
    assert plan.error.translation_key == "room_connection_lost"
    # The run sends nothing to a robot whose task it can't read.
    assert robot.received() == received


async def test_robot_back_within_the_window_keeps_the_run(
    plan: PlanRun,
    robot: SimulatedRobot,
    simulator: RunningSimulator,
    hass: HomeAssistant,
) -> None:
    await plan.start()
    await _outage(hass, simulator)
    # Longer than the three one-second reads that used to end the run.
    await asyncio.sleep(4)
    simulator.link.restore()
    await state_becomes(hass, VACUUM, "cleaning")

    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    assert len(plan.coverage_commands()) == 1


async def test_a_new_task_seen_after_reconnecting_is_a_takeover(
    plan: PlanRun,
    robot: SimulatedRobot,
    simulator: RunningSimulator,
    hass: HomeAssistant,
) -> None:
    await plan.start()
    received = robot.received()
    await _outage(hass, simulator)
    robot.app_takes_over()
    simulator.link.restore()

    finished = await plan.outcome()
    # The first read after the reconnect can land before the state stream
    # makes the vacuum available again.
    expect_finished(
        finished, "unverified", "native_task_taken_over", 0, "cleaning", "unavailable"
    )
    assert isinstance(plan.error, ServiceValidationError)
    assert plan.error.translation_key == "room_taken_over"
    assert robot.received() == received
