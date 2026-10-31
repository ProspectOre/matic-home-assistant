"""A managed plan run driven against the simulated robot."""

from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import (
    DOMAIN,
    EVENT_PLAN_DOCKED,
    EVENT_PLAN_FINISHED,
)

from .hermes_sim import Phase, SimulatedRobot
from .sim_mission import parse_coverage_command

VACUUM = "vacuum.simulated_matic"


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

    async def start(self, *rooms: str | dict[str, str]) -> None:
        """Run ``clean_room_sequence``, Kitchen then Study unless rooms are given.

        A room is a name, or a mapping with the room's own settings.
        """
        await self.start_service(
            "clean_room_sequence",
            rooms=[
                room if isinstance(room, dict) else {"room": room}
                for room in rooms or ("Kitchen", "Study")
            ],
        )

    async def start_service(self, service: str, **data: Any) -> None:
        """Start a blocking plan service and wait for the robot to clean."""
        self.hass.bus.async_listen(
            EVENT_PLAN_FINISHED, lambda event: self.finished.append(dict(event.data))
        )
        self.hass.bus.async_listen(
            EVENT_PLAN_DOCKED, lambda event: self.docked.append(dict(event.data))
        )
        self.task = self.hass.async_create_task(
            self.hass.services.async_call(
                DOMAIN, service, {ATTR_ENTITY_ID: VACUUM, **data}, blocking=True
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
            if parse_coverage_command(payload, 0) is not None
        ]

    async def call(self, domain: str, service: str, **data: Any) -> None:
        """Call a service on the vacuum while polling, as the run needs."""
        call = self.hass.async_create_task(
            self.hass.services.async_call(
                domain, service, {ATTR_ENTITY_ID: VACUUM, **data}, blocking=True
            )
        )
        async with asyncio.timeout(30):
            while not call.done():
                await self.poll()
        await call


def expect_finished(
    finished: dict[str, Any],
    outcome: str,
    reason_code: str,
    completed_rooms: int,
    *terminal_activity: str,
    rooms: int = 2,
) -> None:
    """Check a plan_finished event; any listed terminal activity is accepted."""
    assert finished["outcome"] == outcome
    assert finished["reason_code"] == reason_code
    assert finished["completed_room_count"] == completed_rooms
    assert finished["room_count"] == rooms
    assert finished["terminal_activity"] in terminal_activity
