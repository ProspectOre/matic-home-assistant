"""A robot that goes silent after it reported starting is lost contact.

The start timeout here is no longer than the reconnect window, as with the
defaults (120 s each); both are shortened in proportion.
"""

import asyncio
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.models import RobotActivity
from custom_components.matic_robot.managed_leg import async_run_room_leg
from custom_components.matic_robot.managed_observation import (
    async_wait_for_owned_start,
)
from custom_components.matic_robot.managed_run import RobotConnectionLostError
from custom_components.matic_robot.plan_model import CleaningRoom
from tests.plans.fakes import memory_manager
from tests.session_fakes import FakeRobot, run_step
from tests.wire_builders import _session_identity

ROOM = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
OURS = b"synthetic-original-session"
START_TIMEOUT = 0.2


@pytest.fixture(autouse=True)
def short_waits(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_run.RECONNECT_SECONDS", START_TIMEOUT
    )


def _started() -> FakeRobot:
    robot = FakeRobot()
    robot.show("cleaning", current_area=ROOM.name)
    return robot


async def test_silence_after_the_start_is_lost_contact_not_a_start_timeout(hass):
    reader = AsyncMock(return_value=None)
    with pytest.raises(RobotConnectionLostError):
        await async_wait_for_owned_start(
            _started().port(session_identity=reader),
            START_TIMEOUT,
            None,
            ROOM,
            lambda _identity: None,
            b"",
            OURS,
        )


async def test_a_read_in_flight_at_the_start_deadline_is_lost_contact(hass):
    async def read() -> bytes | None:
        # Each read outlasts the start deadline before it fails.
        await asyncio.sleep(START_TIMEOUT * 1.2)
        return None

    with pytest.raises(RobotConnectionLostError):
        await async_wait_for_owned_start(
            _started().port(session_identity=read),
            START_TIMEOUT,
            None,
            ROOM,
            lambda _identity: None,
            b"",
            OURS,
        )


async def test_a_start_reported_during_a_read_holds_that_read(hass):
    robot = FakeRobot()
    robot.show("docked")

    async def read() -> bytes | None:
        # The robot reports starting mid-read; the read then outlasts the
        # start deadline before it fails.
        await asyncio.sleep(START_TIMEOUT / 2)
        robot.show("cleaning", current_area=ROOM.name)
        await asyncio.sleep(START_TIMEOUT)
        return None

    with pytest.raises(RobotConnectionLostError):
        await async_wait_for_owned_start(
            robot.port(session_identity=read),
            START_TIMEOUT,
            None,
            ROOM,
            lambda _identity: None,
            b"",
            OURS,
        )


async def test_a_start_that_fails_during_a_read_keeps_the_start_deadline(hass):
    robot = FakeRobot()
    robot.show("docked")

    async def read() -> bytes | None:
        # The robot reports an error mid-read, and the read then hangs.
        await asyncio.sleep(START_TIMEOUT / 2)
        robot.show("error")
        await asyncio.Event().wait()
        return None

    with pytest.raises(TimeoutError):
        await async_wait_for_owned_start(
            robot.port(session_identity=read),
            START_TIMEOUT,
            None,
            ROOM,
            lambda _identity: None,
            b"",
            OURS,
        )


async def test_the_robot_back_after_the_start_timeout_keeps_its_start(
    hass, monkeypatch
):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_run.RECONNECT_SECONDS",
        START_TIMEOUT * 2,
    )
    loop = asyncio.get_running_loop()
    back_at = loop.time() + START_TIMEOUT * 1.5

    async def read() -> bytes | None:
        return OURS if loop.time() >= back_at else None

    started = await async_wait_for_owned_start(
        _started().port(session_identity=read),
        START_TIMEOUT,
        None,
        ROOM,
        lambda _identity: None,
        b"",
        OURS,
    )
    assert started is RobotActivity.CLEANING


async def test_an_answer_without_the_new_task_is_still_a_start_timeout(
    hass, monkeypatch
):
    # Silent past the start deadline but well inside the window, then
    # answering without a new task: the start question comes back, and its
    # deadline has passed.
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_run.RECONNECT_SECONDS",
        START_TIMEOUT * 4,
    )
    loop = asyncio.get_running_loop()
    back_at = loop.time() + START_TIMEOUT * 1.5

    async def read() -> bytes | None:
        return b"" if loop.time() >= back_at else None

    with pytest.raises(TimeoutError):
        await async_wait_for_owned_start(
            _started().port(session_identity=read),
            START_TIMEOUT,
            None,
            ROOM,
            lambda _identity: None,
            b"",
            None,
        )


async def test_a_leg_whose_robot_goes_silent_after_starting_sends_nothing(hass):
    robot = FakeRobot()
    identity: bytes | None = b""
    answers_after_start = 1

    async def read() -> bytes | None:
        nonlocal answers_after_start
        if identity and answers_after_start:
            # The start readback sees the run's own task once.
            answers_after_start -= 1
            return identity
        return None if identity else b""

    async def start(command) -> None:
        nonlocal identity
        identity = _session_identity(command.session_id)
        robot.show("cleaning", current_area=ROOM.name)

    robot.on_start = start
    sender = AsyncMock()
    call = ServiceCall(
        hass,
        "matic_robot",
        "run_selected_plan",
        {
            "plan_id": "test-plan",
            "start_timeout": START_TIMEOUT,
            "completion_timeout": 10,
        },
    )
    with pytest.raises(ServiceValidationError) as error:
        await asyncio.wait_for(
            async_run_room_leg(
                hass,
                call,
                memory_manager(hass),
                "vacuum.matic",
                "serial",
                [ROOM],
                robot.port(session_identity=read),
                7,
                managed_user_command=sender,
                floor_token="floor",
                checkpoint_dispatch=AsyncMock(),
                advance=run_step,
            ),
            3,
        )
    assert error.value.translation_key == "room_connection_lost"
    assert UserCommand.STOP not in [c.args[1] for c in sender.await_args_list]
