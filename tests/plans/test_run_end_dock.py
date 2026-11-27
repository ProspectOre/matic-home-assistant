"""How a plan ends: DOCK goes only to a robot that is away and not heading home."""

from unittest.mock import AsyncMock, patch

import pytest

from custom_components.matic_robot import managed_dispatch as dispatch_control
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.managed_executor import async_execute_rooms
from tests.plans.fakes import (
    OWNED_SESSION,
    heavy_room,
    memory_manager,
    owned_leg,
    plan_room,
    run_plan_call,
)
from tests.session_fakes import FakeRobot


@pytest.mark.parametrize(
    ("robot_reports", "docks"),
    [("returning", False), ("docked", False), ("idle", True), ("unreadable", True)],
)
async def test_execute_rooms_docks_on_what_the_robot_reports(
    hass, robot_reports: str, docks: bool
) -> None:
    """The robot's own state, read at the end, wins over a stale stored one."""
    robot = FakeRobot()
    robot.show("cleaning")
    reported = FakeRobot()
    if robot_reports == "unreadable":
        fresh_state = AsyncMock(side_effect=MaticError("unavailable"))
    else:
        reported.show(robot_reports)
        fresh_state = AsyncMock(return_value=reported.state.value.operational)
    managed_command = AsyncMock()
    with patch(
        "custom_components.matic_robot.managed_leg.async_run_room_leg", owned_leg()
    ):
        await async_execute_rooms(
            hass,
            run_plan_call(hass, return_to_base=True),
            memory_manager(hass),
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "room-kitchen")],
            floor_token="floor",
            robot=robot.port(
                session_identity=AsyncMock(return_value=OWNED_SESSION),
                fresh_state=fresh_state,
            ),
            managed_user_command=managed_command,
        )
    fresh_state.assert_awaited_once()
    assert [call.args[1] for call in managed_command.await_args_list] == (
        [UserCommand.DOCK] if docks else []
    )


@pytest.mark.parametrize("stored", ["returning", "docked"])
async def test_execute_rooms_reads_no_robot_state_when_it_already_shows_home(
    hass, stored: str
) -> None:
    """A stored state already home or returning decides alone, with no DOCK."""
    robot = FakeRobot()
    robot.show(stored)
    fresh_state = AsyncMock()
    managed_command = AsyncMock()
    with patch(
        "custom_components.matic_robot.managed_leg.async_run_room_leg", owned_leg()
    ):
        await async_execute_rooms(
            hass,
            run_plan_call(hass, return_to_base=True),
            memory_manager(hass),
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "room-kitchen")],
            floor_token="floor",
            robot=robot.port(
                session_identity=AsyncMock(return_value=OWNED_SESSION),
                fresh_state=fresh_state,
            ),
            managed_user_command=managed_command,
        )
    fresh_state.assert_not_awaited()
    managed_command.assert_not_awaited()


async def test_smart_stop_to_a_returning_robot_sends_no_dock_but_confirms_it(
    hass,
) -> None:
    """After a Smart Stop the run still confirms the dock it did not need to send."""
    robot = FakeRobot()
    robot.show("cleaning")
    reported = FakeRobot()
    reported.show("returning")
    fresh_state = AsyncMock(return_value=reported.state.value.operational)
    manager = memory_manager(hass)
    managed_command = AsyncMock()

    async def finish_then_stop(*_args, on_native_identity, **_kwargs) -> bool:
        on_native_identity(OWNED_SESSION)
        manager.control.finish_room_event("serial").set()
        return True

    with (
        patch(
            "custom_components.matic_robot.managed_leg.async_run_room_leg",
            AsyncMock(side_effect=finish_then_stop),
        ),
        patch.object(dispatch_control, "schedule_run_dock_confirmation") as confirm,
    ):
        await async_execute_rooms(
            hass,
            run_plan_call(hass, return_to_base=False),
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "one"), heavy_room("Study", "two")],
            floor_token="floor",
            robot=robot.port(
                session_identity=AsyncMock(return_value=OWNED_SESSION),
                fresh_state=fresh_state,
            ),
            managed_user_command=managed_command,
        )
    fresh_state.assert_awaited_once()
    managed_command.assert_not_awaited()
    confirm.assert_called_once()


async def test_a_stop_during_the_end_of_run_read_sends_no_dock(hass) -> None:
    """A Stop that arrives while the robot is read wins over the read's answer."""
    robot = FakeRobot()
    robot.show("cleaning")
    reported = FakeRobot()
    reported.show("idle")
    stop_arrived = False

    async def read_then_stop():
        nonlocal stop_arrived
        stop_arrived = True
        return reported.state.value.operational

    managed_command = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.managed_leg.async_run_room_leg",
            owned_leg(),
        ),
        patch.object(
            dispatch_control, "stop_is_pending", side_effect=lambda *_: stop_arrived
        ),
    ):
        await async_execute_rooms(
            hass,
            run_plan_call(hass, return_to_base=True),
            memory_manager(hass),
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "room-kitchen")],
            floor_token="floor",
            robot=robot.port(
                session_identity=AsyncMock(return_value=OWNED_SESSION),
                fresh_state=read_then_stop,
            ),
            managed_user_command=managed_command,
        )
    assert stop_arrived
    managed_command.assert_not_awaited()
