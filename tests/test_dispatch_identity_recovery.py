"""A start that fails after it may have reached the robot.

Recovery adopts only the session the command carried, and the run stops only
that session.
"""

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.managed_dispatch import async_dispatch_leg_command
from custom_components.matic_robot.managed_leg import async_run_room_leg
from custom_components.matic_robot.plan_model import CleaningRoom
from tests.session_fakes import FakeRobot, run_step
from tests.wire_builders import _session_identity

ROOM = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")


@pytest.fixture(autouse=True)
def fast_identity_polls(monkeypatch):
    """Retry reads after 1 ms, end recovery at 20 ms and silence at 50 ms."""
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_dispatch.DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS",
        0.02,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_run.RECONNECT_SECONDS", 0.05
    )


@pytest.mark.parametrize(
    "reported",
    ["command", "transient_command", "replacement", "ended", "reader_error"],
)
async def test_failed_managed_dispatch_recovers_only_its_exact_session(hass, reported):
    robot = FakeRobot()
    sent = []
    replacement_identity = _session_identity(
        UUID("44444444-4444-4444-8444-444444444444")
    )
    current_identity = b""
    recovery_reads = 0

    async def fail_after_dispatch(call):
        nonlocal current_identity
        sent.append(call)
        session_id = call.session_id
        current_identity = (
            _session_identity(session_id)
            if reported in {"command", "transient_command"}
            else replacement_identity
            if reported == "replacement"
            else b""
        )
        raise HomeAssistantError("synthetic readback failure")

    robot.on_start = fail_after_dispatch

    async def read_identity():
        nonlocal recovery_reads
        recovery_reads += 1
        if reported == "reader_error" and sent:
            raise RuntimeError("synthetic unexpected read failure")
        if reported == "transient_command" and recovery_reads == 1:
            raise MaticError("synthetic transient read failure")
        return current_identity

    reader = AsyncMock(side_effect=read_identity)
    bound = []

    expected_failure = (
        "synthetic dispatch failure"
        if reported == "pre_transmission"
        else "synthetic readback failure"
    )
    with pytest.raises(HomeAssistantError, match=expected_failure):
        await async_dispatch_leg_command(
            robot.port(session_identity=reader),
            [ROOM],
            7,
            on_identity=bound.append,
            floor_token="floor",
        )

    command_identity = _session_identity(sent[0].session_id)
    assert command_identity != replacement_identity
    assert bound == (
        [current_identity] if reported in {"command", "transient_command"} else []
    )


@pytest.mark.parametrize(
    "reported",
    ["command", "transient_command", "replacement", "pre_transmission", "unreadable"],
)
async def test_failed_managed_dispatch_stops_only_its_exact_session(
    hass, monkeypatch, reported
):
    if reported == "transient_command":
        # Recovery finds the identity on the read after a 1 ms retry sleep. A
        # starved loop can resume that sleep after the 20 ms test window, so
        # keep the production window, which only a broken recovery reaches.
        monkeypatch.setattr(
            "custom_components.matic_robot.managed_dispatch.DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS",
            10,
        )
    robot = FakeRobot()
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            async_claim_native_session=AsyncMock(),
            async_mark_started=AsyncMock(return_value=False),
            async_mark_failed=AsyncMock(),
        ),
        control=SimpleNamespace(
            async_replace_managed_motion=AsyncMock(),
            cancellation_reason=MagicMock(return_value=None),
            managed_reconciliation=MagicMock(return_value=nullcontext(True)),
            managed_motion_is_current=MagicMock(return_value=True),
        ),
    )
    replacement_identity = _session_identity(
        UUID("44444444-4444-4444-8444-444444444444")
    )
    current_identity = b""

    async def fail_after_dispatch(call):
        nonlocal current_identity
        if reported == "pre_transmission":
            raise HomeAssistantError("synthetic dispatch failure")
        session_id = call.session_id
        current_identity = (
            _session_identity(session_id)
            if reported in {"command", "transient_command"}
            else replacement_identity
            if reported == "replacement"
            else MaticError("synthetic readback unavailable")
        )
        raise HomeAssistantError("synthetic readback failure")

    robot.on_start = fail_after_dispatch

    reads = 0

    async def read_identity():
        nonlocal reads
        reads += 1
        if reported == "transient_command" and reads == 2:
            raise MaticError("synthetic transient read failure")
        if isinstance(current_identity, Exception):
            raise current_identity
        return current_identity

    sender = AsyncMock()
    call = ServiceCall(
        hass,
        "matic_robot",
        "run_selected_plan",
        {
            "plan_id": "synthetic-plan",
            "start_timeout": 1,
            "completion_timeout": 1,
            "return_to_base": True,
        },
    )

    expected_failure = (
        "synthetic dispatch failure"
        if reported == "pre_transmission"
        else "synthetic readback failure"
    )
    with pytest.raises(HomeAssistantError, match=expected_failure):
        await async_run_room_leg(
            hass,
            call,
            manager,
            "vacuum.matic",
            "synthetic-serial",
            [ROOM],
            robot.port(
                session_history=AsyncMock(return_value=()),
                session_identity=read_identity,
            ),
            7,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    if reported in {"command", "transient_command"}:
        sender.assert_awaited_once_with(7, UserCommand.STOP)
    else:
        sender.assert_not_awaited()
    manager.ledger.async_mark_failed.assert_awaited_once()
