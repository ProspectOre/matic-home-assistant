"""Classify how a room ends from the robot's state and session identity."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import RobotActivity
from custom_components.matic_robot.managed_observation import (
    _async_active_session_state,
    _async_wait_for_active_session_resolution,
    _async_wait_for_robot_activity,
    _async_wait_for_room_outcome,
)
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RoomRunOutcome,
    RoomTakenOverError,
)
from tests.session_fakes import FakeRobot
from tests.test_plans import _OWNED, _room


async def test_a_task_that_ends_in_place_is_not_a_completion_candidate(hass) -> None:
    """Ending in place is a stop; only a return can end a room normally.

    Live traces on firmware v172.12: a stopped task goes straight to ``idle``
    where it stood, while a finished one goes ``returning`` first.  The robot's
    own record calls both completed, so this transition is the only thing that
    distinguishes them.
    """
    robot = FakeRobot()
    room = _room("Kitchen", "room-kitchen")
    robot.show("cleaning", current_area="Kitchen")

    async def settle(state: str) -> None:
        await asyncio.sleep(0)
        robot.show(state, current_area="Kitchen")

    hass.async_create_task(settle("idle"), eager_start=True)
    assert (
        await _async_wait_for_room_outcome(robot.port(), room)
        is RoomRunOutcome.STOPPED_IN_PLACE
    )

    robot.show("cleaning", current_area="Kitchen")
    hass.async_create_task(settle("returning"), eager_start=True)
    assert (
        await _async_wait_for_room_outcome(robot.port(), room)
        is RoomRunOutcome.HANDOFF_CANDIDATE
    )

    robot.show("cleaning", current_area="Kitchen")
    hass.async_create_task(settle("docked"), eager_start=True)
    assert (
        await _async_wait_for_room_outcome(robot.port(), room)
        is RoomRunOutcome.HANDOFF_CANDIDATE
    )


async def test_room_outcome_requires_target_evidence_and_classifies_recharge(
    hass,
) -> None:
    robot = FakeRobot()
    room = _room("Study", "room-study")
    robot.show("returning")
    assert (
        await _async_wait_for_room_outcome(robot.port(), room)
        is RoomRunOutcome.INTERRUPTED
    )

    robot.show("returning", current_area="Study", low_charge=True)
    assert (
        await _async_wait_for_room_outcome(robot.port(), room)
        is RoomRunOutcome.SUSPENDED
    )

    robot.show("paused", current_area="Study")
    assert (
        await _async_wait_for_room_outcome(robot.port(), room) is RoomRunOutcome.PAUSED
    )

    robot.show("cleaning", current_area=None)
    waiting = asyncio.create_task(_async_wait_for_room_outcome(robot.port(), room))
    await asyncio.sleep(0)
    robot.show("idle")
    assert await waiting is RoomRunOutcome.STOPPED_IN_PLACE

    robot.show("cleaning", current_area="room-study")
    waiting = asyncio.create_task(_async_wait_for_room_outcome(robot.port(), room))
    await asyncio.sleep(0)
    robot.show("returning", previous_area="Study")
    robot.show("docked")
    assert await waiting is RoomRunOutcome.HANDOFF_CANDIDATE


async def test_room_outcome_propagates_errors_and_cancellation(hass) -> None:
    robot = FakeRobot()
    room = _room("Study", "room-study")
    robot.show("error")
    with pytest.raises(ServiceValidationError, match="reported an error"):
        await _async_wait_for_room_outcome(robot.port(), room)

    robot.show("cleaning", current_area="Study")
    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(robot.port(), room, cancel)
    )
    await asyncio.sleep(0)
    cancel.set()
    with pytest.raises(PlanCancelledError):
        await waiting

    cancel.clear()
    robot.show("cleaning", current_area="Study")
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(robot.port(), room, cancel)
    )
    await asyncio.sleep(0)
    robot.show("returning")
    assert await waiting is RoomRunOutcome.HANDOFF_CANDIDATE

    robot.show("cleaning", current_area="Study")
    stopped = asyncio.create_task(_async_wait_for_room_outcome(robot.port(), room))
    await asyncio.sleep(0)
    robot.show("idle", current_area="Study")
    # Ending in place is a stop, never a finished room.
    assert await stopped is RoomRunOutcome.STOPPED_IN_PLACE


async def test_room_outcome_ignores_transit_through_other_mapped_rooms(hass) -> None:
    robot = FakeRobot()
    room = _room("Study", "room-study")
    robot.show("cleaning", current_area="Study")
    waiting = asyncio.create_task(_async_wait_for_room_outcome(robot.port(), room))
    await asyncio.sleep(0)
    robot.show("cleaning", current_area=None)
    await asyncio.sleep(0)
    assert waiting.done() is False
    robot.show("cleaning", current_area="Hallway transit")
    await asyncio.sleep(0)
    assert waiting.done() is False
    robot.show("cleaning", current_area="the Kitchen")
    await asyncio.sleep(0)
    assert waiting.done() is False
    robot.show("docked", current_area="Kitchen")
    assert await waiting is RoomRunOutcome.HANDOFF_CANDIDATE


async def test_wait_handles_error_unavailable_transition_and_cancel(hass) -> None:
    robot = FakeRobot()
    robot.show("error")
    with pytest.raises(ServiceValidationError, match="error"):
        await _async_wait_for_robot_activity(robot.port(), {RobotActivity.CLEANING}, 10)

    robot.show("unavailable")
    waiting = asyncio.create_task(
        _async_wait_for_robot_activity(robot.port(), {RobotActivity.CLEANING}, 10)
    )
    await asyncio.sleep(0)
    robot.show("cleaning")
    assert await waiting is RobotActivity.CLEANING

    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_robot_activity(robot.port(), {RobotActivity.DOCKED}, 10, cancel)
    )
    await asyncio.sleep(0)
    cancel.set()
    with pytest.raises(PlanCancelledError):
        await waiting

    room = _room("Study", "room-study")
    robot.show("cleaning", current_area="Kitchen")
    target_wait = asyncio.create_task(
        _async_wait_for_robot_activity(
            robot.port(), {RobotActivity.CLEANING}, 10, room=room
        )
    )
    await asyncio.sleep(0)
    assert target_wait.done() is False
    robot.show("cleaning", current_area=" The   Study ")
    assert await target_wait is RobotActivity.CLEANING


async def test_active_session_readers_are_bounded_and_cancel_safe(hass) -> None:
    robot = FakeRobot()
    with patch(
        "custom_components.matic_robot.managed_executor.asyncio.sleep", AsyncMock()
    ):
        assert (
            await _async_active_session_state(
                AsyncMock(side_effect=[None, None, False])
            )
            is False
        )
        assert (
            await _async_active_session_state(
                AsyncMock(side_effect=[MaticError("temporary"), False])
            )
            is False
        )

    robot.show("cleaning")
    assert (
        await _async_wait_for_active_session_resolution(
            robot.port(session_identity=AsyncMock(return_value=_OWNED)),
            expected_identity=_OWNED,
        )
        is True
    )
    robot.show("error")
    with pytest.raises(ServiceValidationError, match="reported an error"):
        await _async_wait_for_active_session_resolution(
            robot.port(session_identity=AsyncMock(return_value=_OWNED)),
            expected_identity=_OWNED,
        )

    robot.show("returning")
    with patch(
        "custom_components.matic_robot.managed_executor.asyncio.sleep", AsyncMock()
    ):
        with pytest.raises(RoomTakenOverError, match="could not be verified"):
            await _async_wait_for_active_session_resolution(
                robot.port(session_identity=AsyncMock(return_value=None)),
                expected_identity=_OWNED,
            )
        assert (
            await _async_wait_for_active_session_resolution(
                robot.port(
                    session_identity=AsyncMock(
                        side_effect=[MaticError("temporary"), b""]
                    )
                ),
                expected_identity=_OWNED,
            )
            is False
        )

    cancelled = asyncio.Event()
    cancelled.set()
    with pytest.raises(PlanCancelledError):
        await _async_wait_for_active_session_resolution(
            robot.port(session_identity=AsyncMock(return_value=_OWNED)),
            cancelled,
            expected_identity=_OWNED,
        )

    cancelled.clear()

    async def set_cancel() -> bytes:
        cancelled.set()
        return _OWNED

    with pytest.raises(PlanCancelledError):
        await _async_wait_for_active_session_resolution(
            robot.port(session_identity=set_cancel),
            cancelled,
            expected_identity=_OWNED,
        )

    with patch(
        "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0,
    ):
        assert (
            await _async_wait_for_active_session_resolution(
                robot.port(session_identity=AsyncMock(side_effect=[_OWNED, b""])),
                asyncio.Event(),
                expected_identity=_OWNED,
            )
            is False
        )
