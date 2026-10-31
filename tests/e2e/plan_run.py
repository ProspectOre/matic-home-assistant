"""A managed plan run driven against the simulated robot."""

from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import Context, Event, HomeAssistant, callback
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
        self.run_id: str | None = None
        self.room_id: str | None = None

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
        context = Context()
        self.run_id = None
        self.room_id = None

        @callback
        def room_started(event: Event[dict[str, Any]]) -> None:
            if event.context.id == context.id:
                self.run_id = event.data["run_id"]
                self.room_id = event.data["room_id"]

        self.hass.bus.async_listen(f"{DOMAIN}_room_started", room_started)
        self.hass.bus.async_listen(
            EVENT_PLAN_FINISHED, lambda event: self.finished.append(dict(event.data))
        )
        self.hass.bus.async_listen(
            EVENT_PLAN_DOCKED, lambda event: self.docked.append(dict(event.data))
        )
        self.task = self.hass.async_create_task(
            self.hass.services.async_call(
                DOMAIN,
                service,
                {ATTR_ENTITY_ID: VACUUM, **data},
                blocking=True,
                context=context,
            )
        )
        async with asyncio.timeout(10):
            await self.robot.wait_for_phase(Phase.CLEANING)
        await self.poll()
        visit = self.robot.session.current_visit if self.robot.session else None
        assert visit is not None, "Managed task ended before start confirmation"
        if not visit.custom_area:
            assert visit.room is not None
            await self.wait_for_room_start()

    async def wait_for_room_start(self) -> None:
        """Wait for this run to confirm ownership and begin active room timing."""
        assert self.task is not None
        async with asyncio.timeout(10):
            while True:
                if self.task.done():
                    await self.task
                    raise AssertionError(
                        "Plan ended before its room start was confirmed"
                    )
                state = self.hass.states.get(
                    "sensor.simulated_matic_current_room_active_time"
                )
                try:
                    active_time = float(state.state) if state is not None else -1
                except ValueError:
                    active_time = -1
                if (
                    state is not None
                    and active_time >= 0
                    and self.run_id is not None
                    and self.room_id is not None
                    and state.attributes.get("run_id") == self.run_id
                    and state.attributes.get("room_id") == self.room_id
                    and state.attributes.get("status") == "running"
                ):
                    return
                await self.poll()

    async def poll(self) -> None:
        """Run one coordinator poll and let listeners react."""
        await self.entry.runtime_data.coordinator.async_refresh()
        await asyncio.sleep(0.05)

    async def outcome(self) -> dict[str, Any]:
        """Poll until the run ends and return its plan_finished event."""
        assert self.task is not None
        async with asyncio.timeout(30):
            # The service can return before the bus delivers plan_finished.
            while not self.task.done() or not self.finished:
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
