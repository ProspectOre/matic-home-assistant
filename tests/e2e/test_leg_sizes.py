"""A one-room leg and a two-room leg run the same scenarios on the simulator.

A one-room leg is a leg of one room: the same runner observes, stops, settles
and credits it. Each scenario runs a plan of one room and a plan of two and
expects the same outcome and the same commands, apart from the queue change
Smart Stop sends only when a room waits after the current one.
"""

from __future__ import annotations

import asyncio

import pytest
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot import managed_run, session, stop_return
from custom_components.matic_robot.client import hermes_collections, hermes_connection
from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import DOCK_PAYLOAD, STOP_PAYLOAD, RunningSimulator, SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished, state_becomes

LEGS = pytest.mark.parametrize(
    "rooms", [("Kitchen",), ("Kitchen", "Study")], ids=["one_room", "two_rooms"]
)


async def _start(plan: PlanRun, rooms: tuple[str, ...]) -> None:
    """Run a saved plan of ``rooms`` whose Stop finishes the current room."""
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id="synthetic",
        name="Synthetic",
        run_behavior="ordered",
        rooms=[{"room": room} for room in rooms],
        finish_current_room=True,
        finish_current_room_threshold=0,
    )
    await plan.start_service("run_selected_plan", plan="synthetic")


async def _stop(plan: PlanRun, **data: object) -> None:
    await plan.hass.services.async_call(
        DOMAIN, "stop_intelligent_cleaning", {"entity_id": VACUUM, **data}, True
    )


async def _smart_stop(plan: PlanRun, rooms: int) -> None:
    """Press Stop; with a room waiting, wait for the robot to drop it."""
    await _stop(plan)
    async with asyncio.timeout(10):
        while len(plan.coverage_commands()) < rooms:
            await plan.poll()


async def _clean(plan: PlanRun, robot: SimulatedRobot, rooms: int) -> None:
    """Finish every room and the mission, then dock."""
    for _ in range(rooms):
        robot.finish_room()
        await plan.poll()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()


@LEGS
async def test_a_leg_completes(
    plan: PlanRun, robot: SimulatedRobot, rooms: tuple[str, ...]
) -> None:
    await _start(plan, rooms)
    await _clean(plan, robot, len(rooms))

    finished = await plan.outcome()
    expect_finished(
        finished,
        "completed",
        "all_rooms_verified",
        len(rooms),
        "docked",
        rooms=len(rooms),
    )
    assert len(plan.coverage_commands()) == 1
    assert STOP_PAYLOAD not in robot.received()


@LEGS
async def test_smart_stop_finishes_the_room_without_a_stop(
    plan: PlanRun, robot: SimulatedRobot, rooms: tuple[str, ...]
) -> None:
    await _start(plan, rooms)
    # Only a waiting room gives the robot something to drop.
    await _smart_stop(plan, len(rooms))
    assert robot.session is not None
    assert len(robot.session.rooms) == 1
    await _clean(plan, robot, 1)

    finished = await plan.outcome()
    # The run is cancelled only when Smart Stop dropped a room.
    expect_finished(
        finished,
        *(
            ("completed", "all_rooms_verified")
            if len(rooms) == 1
            else ("cancelled", "managed_stop")
        ),
        1,
        "docked",
        rooms=len(rooms),
    )
    assert len(plan.coverage_commands()) == len(rooms)
    assert STOP_PAYLOAD not in robot.received()


@LEGS
async def test_stop_now_after_smart_stop_stops_then_docks(
    plan: PlanRun,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
    rooms: tuple[str, ...],
) -> None:
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_POLL_SECONDS", 0.05)
    await _start(plan, rooms)
    await _smart_stop(plan, len(rooms))
    sent = len(robot.received())
    await _stop(plan, stop_now=True, expected_run_id=plan.run_id)
    async with asyncio.timeout(10):
        while DOCK_PAYLOAD not in robot.received()[sent:]:
            await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(
        finished,
        "cancelled",
        "managed_stop",
        0,
        "cleaning",
        "idle",
        "returning",
        rooms=len(rooms),
    )
    assert robot.received()[sent:] == [STOP_PAYLOAD, DOCK_PAYLOAD]


@LEGS
async def test_lost_contact_sends_nothing(
    plan: PlanRun,
    robot: SimulatedRobot,
    simulator: RunningSimulator,
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    rooms: tuple[str, ...],
) -> None:
    monkeypatch.setattr(hermes_collections, "RPC_TIMEOUT", 0.2)
    monkeypatch.setattr(hermes_connection, "RPC_TIMEOUT", 0.2)
    monkeypatch.setattr(session, "UNREACHABLE_AFTER_SECONDS", 0.2)
    monkeypatch.setattr(managed_run, "RECONNECT_SECONDS", 0.5)
    await _start(plan, rooms)
    received = robot.received()
    simulator.link.cut()
    await state_becomes(hass, VACUUM, STATE_UNAVAILABLE)
    assert plan.task is not None
    async with asyncio.timeout(10):
        while not plan.task.done():  # noqa: ASYNC110
            await asyncio.sleep(0.05)
    simulator.link.restore()

    finished = await plan.outcome()
    expect_finished(
        finished, "unverified", "connection_lost", 0, "unavailable", rooms=len(rooms)
    )
    assert isinstance(plan.error, ServiceValidationError)
    assert plan.error.translation_key == "room_connection_lost"
    assert robot.received() == received
