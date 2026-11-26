"""A custom area's wait for its own native mission to end."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import RobotActivity
from custom_components.matic_robot.managed_area import (
    _area_refused_before_start,
    _async_wait_for_area_end,
)
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RobotConnectionLostError,
    RoomTakenOverError,
)
from tests.session_fakes import FakeRobot

ORIGINAL = b"synthetic-original-session"


@pytest.fixture(autouse=True)
def fast_reconnect(monkeypatch):
    # Give up on a robot that stops answering after 50 ms, not two minutes.
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_run.RECONNECT_SECONDS", 0.05
    )


@pytest.fixture
def fast_area_polls(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ROOM_STATUS_REFRESH_SECONDS",
        0.001,
    )


async def test_area_end_waiter_fails_closed_and_waits_out_a_return(hass, monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ROOM_STATUS_REFRESH_SECONDS",
        0.001,
    )
    robot = FakeRobot()
    cancel = asyncio.Event()
    robot.show("cleaning")
    with pytest.raises(RoomTakenOverError, match="could not be identified"):
        await _async_wait_for_area_end(
            robot.port(session_identity=AsyncMock(return_value=ORIGINAL)), cancel, b""
        )
    with pytest.raises(RobotConnectionLostError):
        await _async_wait_for_area_end(
            robot.port(session_identity=AsyncMock(return_value=None)), cancel, ORIGINAL
        )

    # A low-charge return keeps the session; firmware may keep an ended
    # mission's identity while home, so an inactive session there ends it.
    reads = []
    active = AsyncMock(return_value=False)

    async def returning_then_home() -> bytes | None:
        reads.append(robot.state.value.operational.activity)
        if len(reads) == 1:
            robot.show("returning", low_charge=True)
            return None
        if len(reads) == 2:
            robot.show("docked")
        return ORIGINAL

    await _async_wait_for_area_end(
        robot.port(session_identity=returning_then_home, active_session=active),
        cancel,
        ORIGINAL,
    )
    assert reads == [RobotActivity.CLEANING, RobotActivity.RETURNING]
    assert robot.state.value.operational.activity is RobotActivity.DOCKED
    active.assert_awaited_once()

    cancel.set()
    with pytest.raises(PlanCancelledError):
        await _async_wait_for_area_end(
            robot.port(session_identity=returning_then_home, active_session=active),
            cancel,
            ORIGINAL,
        )


@pytest.mark.parametrize("during_read", ["stop", "error", "unknown_end"])
async def test_area_end_does_not_credit_a_stop_error_or_unknown_ownership_gap(
    hass, fast_area_polls, during_read
):
    robot = FakeRobot()
    cancel = asyncio.Event()
    robot.show("cleaning")

    async def read():
        if during_read == "stop":
            cancel.set()
        elif during_read == "error":
            robot.show("error")
        return b""

    reader = (
        AsyncMock(side_effect=[None, b""]) if during_read == "unknown_end" else read
    )
    error = {
        "stop": PlanCancelledError,
        "error": ServiceValidationError,
        "unknown_end": RobotConnectionLostError,
    }[during_read]
    with pytest.raises(error):
        await _async_wait_for_area_end(
            robot.port(session_identity=reader), cancel, ORIGINAL
        )


@pytest.mark.parametrize("change", ["stop", "error", "cleaning"])
async def test_area_end_rechecks_state_after_active_session_read(
    hass, fast_area_polls, change
):
    robot = FakeRobot()
    cancel = asyncio.Event()
    robot.show("docked")
    reader = AsyncMock(side_effect=[ORIGINAL, b""])

    async def active():
        if change == "stop":
            cancel.set()
        else:
            robot.show(change)
        return False

    if change == "cleaning":
        await _async_wait_for_area_end(
            robot.port(session_identity=reader, active_session=active), cancel, ORIGINAL
        )
        # A stale inactive response cannot end a mission that resumed.
        assert reader.await_count == 2
    else:
        error = PlanCancelledError if change == "stop" else ServiceValidationError
        with pytest.raises(error):
            await _async_wait_for_area_end(
                robot.port(session_identity=reader, active_session=active),
                cancel,
                ORIGINAL,
            )


def test_only_known_vacuum_refusals_skip_the_area_cleanup_stop():
    def refusal(key: str) -> ServiceValidationError:
        return ServiceValidationError(
            translation_domain="matic_robot", translation_key=key
        )

    assert _area_refused_before_start(refusal("area_map_changed"))
    assert _area_refused_before_start(refusal("plan_area_missing"))
    assert not _area_refused_before_start(refusal("robot_command_failed"))
    assert not _area_refused_before_start(MaticError("area_map_changed"))
