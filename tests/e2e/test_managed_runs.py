"""Managed plan runs against the simulated robot.

Each test starts ``clean_room_sequence`` for the simulated Kitchen and Study,
moves the robot through the scenario, and checks the terminal
``matic_robot_plan_finished`` event and the commands the robot received. The
scenarios follow the acceptance matrix in ``docs/e2e-contract.md``.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import pytest
from homeassistant.components.vacuum import DOMAIN as VACUUM_DOMAIN
from homeassistant.components.vacuum import SERVICE_RETURN_TO_BASE
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import managed_executor, stop_return
from custom_components.matic_robot.const import (
    DOMAIN,
    EVENT_PLAN_DOCKED,
    EVENT_PLAN_FINISHED,
)

from .hermes_sim import DOCK_PAYLOAD, STOP_PAYLOAD, Phase, SimulatedRobot
from .sim_mission import two_room_floor

VACUUM = "vacuum.simulated_matic"


@pytest.fixture
def robot() -> SimulatedRobot:
    robot = SimulatedRobot()
    robot.set_floor(two_room_floor())
    return robot


@pytest.fixture
async def loaded_entry(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> AsyncIterator[MockConfigEntry]:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.LOADED
    yield config_entry
    if config_entry.state is ConfigEntryState.LOADED:
        assert await hass.config_entries.async_unload(config_entry.entry_id)
        await hass.async_block_till_done()


class PlanRun:
    """A ``clean_room_sequence`` call running while the test drives the robot.

    The run blocks until the plan ends, so it runs as a task and the test
    polls the coordinator in its place; ``async_block_till_done`` would wait
    for the run itself.
    """

    def __init__(
        self, hass: HomeAssistant, entry: MockConfigEntry, robot: SimulatedRobot
    ) -> None:
        self.hass = hass
        self.entry = entry
        self.robot = robot
        self.finished: list[dict[str, Any]] = []
        self.docked: list[dict[str, Any]] = []
        self.task: asyncio.Task[Any] | None = None
        self.error: BaseException | None = None

    async def start(self) -> None:
        self.hass.bus.async_listen(
            EVENT_PLAN_FINISHED, lambda event: self.finished.append(dict(event.data))
        )
        self.hass.bus.async_listen(
            EVENT_PLAN_DOCKED, lambda event: self.docked.append(dict(event.data))
        )
        self.task = self.hass.async_create_task(
            self.hass.services.async_call(
                DOMAIN,
                "clean_room_sequence",
                {
                    ATTR_ENTITY_ID: VACUUM,
                    "rooms": [{"room": "Kitchen"}, {"room": "Study"}],
                },
                blocking=True,
            )
        )
        async with asyncio.timeout(10):
            await self.robot.wait_for_phase(Phase.CLEANING)
        await self.poll()

    async def poll(self) -> None:
        """Run one coordinator poll and let listeners react."""
        await self.entry.runtime_data.coordinator.async_refresh()
        await asyncio.sleep(0.05)

    async def outcome(self) -> dict[str, Any]:
        """Poll until the run ends and return its plan_finished event."""
        assert self.task is not None
        async with asyncio.timeout(30):
            while not self.task.done():
                await self.poll()
        self.error = self.task.exception()
        (finished,) = self.finished
        return finished

    async def wait_for_finished(self) -> dict[str, Any]:
        """Poll until a plan_finished event arrives, from any runner."""
        async with asyncio.timeout(30):
            while not self.finished:
                await self.poll()
        (finished,) = self.finished
        return finished

    def coverage_commands(self) -> list[bytes]:
        """User commands that started or updated coverage."""
        return [
            payload
            for payload in self.robot.received()
            if payload not in (STOP_PAYLOAD, DOCK_PAYLOAD)
        ]

    async def call(self, domain: str, service: str) -> None:
        """Call a service on the vacuum while polling, as the run needs."""
        call = self.hass.async_create_task(
            self.hass.services.async_call(
                domain, service, {ATTR_ENTITY_ID: VACUUM}, blocking=True
            )
        )
        async with asyncio.timeout(30):
            while not call.done():
                await self.poll()
        await call


@pytest.fixture
async def plan(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> PlanRun:
    return PlanRun(hass, loaded_entry, robot)


def _expect(
    finished: dict[str, Any],
    outcome: str,
    reason_code: str,
    completed_rooms: int,
    terminal_activity: str,
) -> None:
    assert finished["outcome"] == outcome
    assert finished["reason_code"] == reason_code
    assert finished["completed_room_count"] == completed_rooms
    assert finished["room_count"] == 2
    assert finished["terminal_activity"] == terminal_activity


async def test_all_rooms_verify_from_native_history(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    await plan.start()
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    _expect(finished, "completed", "all_rooms_verified", 2, "docked")
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


async def test_native_session_ends_early_credits_only_finished_rooms(
    plan: PlanRun, robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch
) -> None:
    # History may publish per-room results late, so the run keeps reading the
    # same record for minutes; shorten that window, not the logic.
    monkeypatch.setattr(managed_executor, "SESSION_HISTORY_TIMEOUT_SECONDS", 2)
    await plan.start()
    robot.finish_room()
    await plan.poll()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    _expect(finished, "unverified", "partial_native_result", 1, "docked")
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
    _expect(finished, "cancelled", "managed_replaced", 0, "idle")
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
    _expect(finished, "unverified", "native_task_taken_over", 0, "cleaning")
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
    _expect(finished, "completed", "all_rooms_verified", 2, "docked")
    assert len(plan.coverage_commands()) == 1


async def test_robot_fault_fails_the_run(plan: PlanRun, robot: SimulatedRobot) -> None:
    await plan.start()
    robot.fault(326)

    finished = await plan.outcome()
    _expect(finished, "failed", "robot_error", 0, "error")
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
        while (plans.recovery_run(robot.serial_number) or {}).get(
            "recovery_reason"
        ) != "same_native_mission_verified":
            await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.wait_for_finished()
    _expect(finished, "completed", "all_rooms_verified", 2, "docked")
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
    _expect(
        finished,
        "unverified",
        "restart_native_mission_changed_or_ended",
        0,
        "docked",
    )
