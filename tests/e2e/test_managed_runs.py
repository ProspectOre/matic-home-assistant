"""Managed plan runs against the simulated robot.

Each test starts ``clean_room_sequence`` for the simulated Kitchen and Study,
moves the robot through the scenario, and checks the terminal
``matic_robot_plan_finished`` event and the commands the robot received. The
scenarios follow the acceptance matrix in ``docs/e2e-contract.md``.
"""

from __future__ import annotations

import asyncio

import pytest
from homeassistant.components.vacuum import DOMAIN as VACUUM_DOMAIN
from homeassistant.components.vacuum import SERVICE_RETURN_TO_BASE
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError

import custom_components.matic_robot.managed_observation as managed_observation_module
from custom_components.matic_robot import stop_return

from .hermes_sim import DOCK_PAYLOAD, STOP_PAYLOAD, Phase, SimulatedRobot
from .plan_run import PlanRun, expect_finished
from .sim_mission import SimFloor, two_room_floor


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def test_all_rooms_verify_from_native_history(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await plan.start()
    # The plan sends both rooms as ordered goals, Kitchen before Study.
    assert robot.session is not None
    assert robot.session.ordered
    assert robot.floor is not None
    assert robot.session.rooms == [room.id for room in robot.floor.rooms]
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    assert finished["cause"] == "verified_completion"
    assert plan.error is None
    # One native task covered both rooms in order.
    assert len(plan.coverage_commands()) == 1
    # Native history (300 s vacuum plus 300 s mop per room) reaches the
    # per-room statistics.
    history = hass.states.get("sensor.simulated_matic_cleaning_history")
    assert history is not None
    rooms = history.attributes["last_completed_by_room"].values()
    assert sorted((room["name"], room["duration_seconds"]) for room in rooms) == [
        ("Kitchen", 600),
        ("Study", 600),
    ]


async def test_each_room_keeps_its_own_settings(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await plan.start(
        {"room": "Kitchen", "cleaning_mode": "vacuum", "coverage_setting": "quick"},
        {"room": "Study", "cleaning_mode": "mop"},
    )
    assert robot.session is not None
    # Kitchen gets quick vacuum goals (setting 2) only, Study mop goals only.
    assert [set(visit.passes) for visit in robot.session.visits] == [
        {(0, 2)},
        {(1, 1)},
    ]
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    # One pass each, so 300 s per room rather than 600.
    history = hass.states.get("sensor.simulated_matic_cleaning_history")
    assert history is not None
    rooms = history.attributes["last_completed_by_room"].values()
    assert sorted((room["name"], room["duration_seconds"]) for room in rooms) == [
        ("Kitchen", 300),
        ("Study", 300),
    ]


async def test_native_session_ends_early_credits_only_finished_rooms(
    plan: PlanRun, robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch
) -> None:
    # History may publish per-room results late, so the run keeps reading the
    # same record for minutes; shorten that window, not the logic.
    monkeypatch.setattr(
        managed_observation_module, "SESSION_HISTORY_TIMEOUT_SECONDS", 2
    )
    await plan.start()
    robot.finish_room()
    await plan.poll()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "unverified", "partial_native_result", 1, "docked")
    assert finished["cause"] == "native_result"


async def test_return_home_stops_the_run_then_docks(
    plan: PlanRun, robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_POLL_SECONDS", 0.05)
    await plan.start()
    await plan.call(VACUUM_DOMAIN, SERVICE_RETURN_TO_BASE)
    async with asyncio.timeout(10):
        await robot.wait_for_phase(Phase.RETURNING)
    robot.arrive_at_dock()

    finished = await plan.outcome()
    # The activity is the vacuum entity's state when the run closes, which can
    # be read before or after the coordinator has seen the robot stop.
    expect_finished(finished, "cancelled", "managed_replaced", 0, "cleaning", "idle")
    assert robot.received()[-2:] == [STOP_PAYLOAD, DOCK_PAYLOAD]
    async with asyncio.timeout(10):
        while not plan.docked:
            await plan.poll()
    (docked,) = plan.docked
    assert docked["run_id"] == finished["run_id"]
    assert docked["outcome"] == "stopped_docked"


async def test_app_takeover_gets_no_credit(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    await plan.start()
    robot.app_takes_over()

    finished = await plan.outcome()
    expect_finished(finished, "unverified", "native_task_taken_over", 0, "cleaning")
    assert finished["cause"] == "unknown"
    assert isinstance(plan.error, ServiceValidationError)
    # Home Assistant leaves the app's task alone.
    assert STOP_PAYLOAD not in robot.received()


async def test_recharge_and_resume_completes(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    await plan.start()
    robot.low_charge_recharge()
    await plan.poll()
    await plan.poll()
    robot.recharged()
    await plan.poll()
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    assert len(plan.coverage_commands()) == 1


async def test_robot_fault_fails_the_run(plan: PlanRun, robot: SimulatedRobot) -> None:
    await plan.start()
    robot.fault(326)

    finished = await plan.outcome()
    expect_finished(finished, "failed", "robot_error", 0, "error")
    assert isinstance(plan.error, ServiceValidationError)


async def test_restart_rejoins_the_same_native_mission(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await plan.start()
    robot.finish_room()
    await plan.poll()

    # Reloading an enabled entry preserves the run, as a restart does.
    assert await hass.config_entries.async_reload(plan.entry.entry_id)
    assert plan.task is not None and plan.task.done()
    assert plan.finished == []
    plans = plan.entry.runtime_data.cleaning_plans
    async with asyncio.timeout(10):
        while (plans.control.recovery_run(robot.serial_number) or {}).get(
            "recovery_reason"
        ) != "same_native_mission_verified":
            await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.wait_for_finished()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    # The recovered run did not dispatch the robot again.
    assert len(plan.coverage_commands()) == 1


async def test_restart_after_the_mission_ended_stays_unverified(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await plan.start()
    robot.finish_room()
    await plan.poll()
    await hass.config_entries.async_unload(plan.entry.entry_id)
    # The robot finishes while Home Assistant is down.
    robot.finish_room()
    robot.finish_session()
    robot.arrive_at_dock()
    assert await hass.config_entries.async_setup(plan.entry.entry_id)

    finished = await plan.wait_for_finished()
    expect_finished(
        finished,
        "unverified",
        "restart_native_mission_changed_or_ended",
        0,
        "docked",
    )
