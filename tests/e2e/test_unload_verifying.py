"""Unloading the entry while a run verifies a leg from the robot's history.

A held or stalled history read must not hold the unload: the run's reads end
with it, and its checkpoint stays as restart recovery expects.
"""

from __future__ import annotations

import asyncio
from time import monotonic
from typing import Any
from uuid import uuid4

from homeassistant.core import Event, HomeAssistant, callback

from custom_components.matic_robot.area_binding import binding_for_area
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import SimulatedRobot
from .plan_run import (
    VACUUM,
    PlanRun,
    active_plan,
    expect_finished,
    recovery_record,
    state_becomes,
)

HISTORY = "coverage_session_history"
SESSION = "active_session_key"


async def _unload_promptly(plan: PlanRun, hass: HomeAssistant) -> None:
    """Unload within a second, leaving no history read running."""
    started = monotonic()
    assert await hass.config_entries.async_unload(plan.entry.entry_id)
    assert monotonic() - started < 1
    # The client's reads and the run's wrappers around them are all gone.
    assert not [
        name
        for task in asyncio.all_tasks()
        if any(
            part in (name := getattr(task.get_coro(), "__qualname__", ""))
            for part in ("collection", "session", "handoff", "history")
        )
    ]


async def _wait_for_read(plan: PlanRun, robot: SimulatedRobot, reads: int) -> None:
    """Poll until a history read after ``reads`` has started and had time to stall."""
    async with asyncio.timeout(10):
        while robot.reads[HISTORY] == reads:
            await plan.poll()
    await asyncio.sleep(0.5)


async def test_unload_while_a_held_record_is_awaited(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await plan.start()
    robot.hold_history()
    robot.finish_room()
    await plan.poll()
    reads = robot.reads[HISTORY]
    robot.finish_room()
    robot.finish_session()
    async with asyncio.timeout(10):
        while active_plan(hass).get("status") != "verifying":
            await plan.poll()
    await _wait_for_read(plan, robot, reads)
    plans = plan.entry.runtime_data.cleaning_plans

    await _unload_promptly(plan, hass)
    checkpoint = recovery_record(plans, robot.serial_number)
    assert (
        checkpoint is not None
        and checkpoint["recovery_checkpoint"]["phase"] == "verifying"
    )

    # The record lands while Home Assistant is down; restart reads it.
    robot.release_history()
    robot.arrive_at_dock()
    assert await hass.config_entries.async_setup(plan.entry.entry_id)
    finished = await plan.wait_for_finished()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")


async def _room_then_rug(plan: PlanRun, robot: SimulatedRobot) -> Any:
    """Save a plan of the Kitchen then a rug area, and return the plan manager."""
    session = plan.entry.runtime_data.session
    async with asyncio.timeout(10):
        while session.floor.value is None:
            await plan.poll()
    circles = [{"x": 1.0, "y": 0.75, "radius": 0.25}]
    plans = plan.entry.runtime_data.cleaning_plans
    await plans.catalog.async_save_area(
        robot.serial_number,
        "rug",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Rug",
            "circles": circles,
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": binding_for_area(session.floor.value, circles),
        },
    )
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id="room-then-rug",
        name="Kitchen, rug",
        run_behavior="ordered",
        rooms=[{"room": "Kitchen", "cleaning_mode": "vacuum"}, {"area": "Rug"}],
    )
    return plans


async def _finish_kitchen(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Start the plan and end the Kitchen's mission; the robot drives home."""
    await plan.start_service("run_selected_plan", plan="room-then-rug")
    robot.finish_room()
    await plan.poll()
    robot.finish_session()
    await plan.poll()


async def _wait_for_phase(plan: PlanRun, plans: Any, phase: str) -> dict[str, Any]:
    """Poll until the stored checkpoint reaches ``phase``, and return it."""
    async with asyncio.timeout(10):
        while True:
            stored = (recovery_record(plans, plan.robot.serial_number) or {}).get(
                "recovery_checkpoint", {}
            )
            if stored.get("phase") == phase:
                return stored
            await plan.poll()


async def test_unload_while_the_next_leg_inventory_stalls(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    plans = await _room_then_rug(plan, robot)
    reads: list[int] = []

    @callback
    def stall_history(_event: Event) -> None:
        # The Kitchen is credited; the next leg's history inventory stalls.
        reads.append(robot.reads[HISTORY])
        robot.faults.stall(HISTORY)

    hass.bus.async_listen(f"{DOMAIN}_room_completed", stall_history)
    await _finish_kitchen(plan, robot)
    robot.arrive_at_dock()
    async with asyncio.timeout(10):
        while not reads:
            await plan.poll()
    await _wait_for_read(plan, robot, reads[0])
    sent = len(robot.received())

    await _unload_promptly(plan, hass)
    checkpoint = recovery_record(plans, robot.serial_number)
    assert checkpoint is not None
    stored = checkpoint["recovery_checkpoint"]
    assert (stored["phase"], stored["leg_index"]) == ("verifying", 0)

    # Recovery rereads the Kitchen's history, counts it once and ends the
    # run without starting the rug.
    robot.faults.clear()
    assert await hass.config_entries.async_setup(plan.entry.entry_id)
    finished = await plan.wait_for_finished()
    expect_finished(
        finished,
        "unverified",
        "restart_remaining_queue_unverified",
        1,
        "docked",
        rooms=1,
    )
    assert len(robot.received()) == sent


async def _finish_rug(plan: PlanRun, robot: SimulatedRobot, sent: int) -> None:
    """Wait for recovery to start the rug, clean it and see the run complete."""
    async with asyncio.timeout(10):
        while len(robot.received()) == sent:
            await plan.poll()
    robot.finish_room()
    await plan.poll()
    # The run ends at its next five-second area poll that reads the session
    # end, and reports the vacuum's state then. Holding that read until the
    # vacuum shows docked makes docked the state it ends in.
    robot.faults.stall(SESSION)
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    await plan.poll()
    await state_becomes(plan.hass, VACUUM, "docked")
    robot.faults.clear()
    finished = await plan.wait_for_finished()
    expect_finished(finished, "completed", "all_rooms_verified", 1, "docked", rooms=1)


async def test_unload_while_the_next_leg_baseline_stalls(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    plans = await _room_then_rug(plan, robot)
    await _finish_kitchen(plan, robot)
    robot.set_property("active_session_key", uuid4().bytes)
    # The handoff is saved while the robot drives home. Once it docks, the
    # rug's dispatch rereads the history keys first, and that read stalls.
    await _wait_for_phase(plan, plans, "handoff")
    reads = robot.reads[HISTORY]
    robot.faults.stall(HISTORY)
    robot.arrive_at_dock()
    await _wait_for_read(plan, robot, reads)
    sent = len(robot.received())

    await _unload_promptly(plan, hass)
    assert len(robot.received()) == sent
    # Nothing was sent, so the handoff stays resumable.
    checkpoint = recovery_record(plans, robot.serial_number)
    assert checkpoint is not None
    stored = checkpoint["recovery_checkpoint"]
    assert (stored["phase"], stored["leg_index"]) == ("handoff", 1)

    robot.faults.clear()
    assert await hass.config_entries.async_setup(plan.entry.entry_id)
    await _finish_rug(plan, robot, sent)


async def test_unload_while_recovery_rereads_a_saved_leg_boundary(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    plans = await _room_then_rug(plan, robot)
    await _finish_kitchen(plan, robot)
    # A robot marks its idle state with a fresh v4 UUID, which the handoff
    # saves and recovery compares before it rereads the history keys.
    robot.set_property("active_session_key", uuid4().bytes)
    await _wait_for_phase(plan, plans, "handoff")
    # Unloading while the run waits for the robot to settle keeps the handoff.
    assert await hass.config_entries.async_unload(plan.entry.entry_id)
    reads = robot.reads[HISTORY]
    robot.faults.stall(HISTORY)
    robot.arrive_at_dock()

    # Recovery rereads the handoff's history keys, and that read stalls.
    assert await hass.config_entries.async_setup(plan.entry.entry_id)
    await _wait_for_read(plan, robot, reads)
    sent = len(robot.received())
    await _unload_promptly(plan, hass)
    assert len(robot.received()) == sent
    checkpoint = recovery_record(plans, robot.serial_number)
    assert checkpoint is not None
    assert checkpoint["recovery_checkpoint"]["phase"] == "handoff"

    # With the history readable, the next setup resumes the queue at the rug.
    robot.faults.clear()
    assert await hass.config_entries.async_setup(plan.entry.entry_id)
    await _finish_rug(plan, robot, sent)
