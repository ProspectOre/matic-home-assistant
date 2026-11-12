"""Run one plan room through the robot port and record its outcome."""

import asyncio
from contextlib import asynccontextmanager, nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import RobotActivity
from custom_components.matic_robot.managed_dispatch import _async_dispatch_leg_command
from custom_components.matic_robot.managed_room import _async_run_room
from custom_components.matic_robot.managed_run import PlanCancelledError
from custom_components.matic_robot.plan_model import CleaningRoom
from tests.session_fakes import FakeRobot
from tests.test_services import _execution_call


async def test_room_cancellation_records_history_and_reraises() -> None:
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus)
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_cancelled=AsyncMock(),
        ),
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value=None),
            managed_motion_is_current=MagicMock(return_value=True),
            managed_reconciliation=lambda *_args: nullcontext(True),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_run_room(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            room,
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
        )
    manager.ledger.async_mark_cancelled.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_cancelled"


async def test_room_cancellation_preserves_low_charge_reason() -> None:
    """Room cleanup carries suspension evidence to the plan finalizer."""
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus)
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_cancelled=AsyncMock(),
        ),
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value=None),
            managed_motion_is_current=MagicMock(return_value=True),
            managed_reconciliation=lambda *_args: nullcontext(True),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        history=SimpleNamespace(
            snapshot=MagicMock(
                return_value={
                    "active_plan": {
                        "status": "suspended",
                        "suspend_reason": "low_charge",
                    }
                }
            )
        ),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        pytest.raises(PlanCancelledError) as excinfo,
    ):
        await _async_run_room(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            room,
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
        )
    assert excinfo.value.suspend_reason == "low_charge"


@pytest.mark.parametrize("changes_during_history", [False, True])
async def test_room_dispatch_rechecks_exact_floor_before_robot_command(
    changes_during_history: bool,
) -> None:
    """No room IDs are sent after either floor-coherence guard fails."""
    robot = FakeRobot()
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    session_history = AsyncMock(return_value=())
    floor_is_current = MagicMock(
        side_effect=[True, False] if changes_during_history else [False]
    )
    on_dispatch = MagicMock()

    with pytest.raises(ServiceValidationError) as excinfo:
        await _async_dispatch_leg_command(
            robot.port(
                session_history=session_history, session_identity=robot.accepting
            ),
            [room],
            17,
            floor_is_current=floor_is_current,
            on_dispatch=on_dispatch,
            floor_token="floor",
        )

    assert excinfo.value.translation_key == "room_plan_unavailable"
    if changes_during_history:
        session_history.assert_awaited_once()
    else:
        session_history.assert_not_awaited()
    on_dispatch.assert_not_called()
    assert not robot.started


async def test_room_handoff_after_returning_does_not_credit_completion(hass) -> None:
    """A targeted return permits handoff without claiming room completion."""

    robot = FakeRobot()

    async def send_command(*_args, **_kwargs) -> None:
        robot.show("cleaning", current_area="Study")

        async def finish_room() -> None:
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            robot.show("returning", current_area="Study", low_charge=False)

        hass.async_create_task(finish_room(), eager_start=True)

    robot.on_start = send_command
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_interrupted=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value=None),
            managed_motion_is_current=MagicMock(return_value=True),
            managed_reconciliation=lambda *_args: nullcontext(True),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
    )
    refresh = AsyncMock()

    with (
        patch(
            "custom_components.matic_robot.managed_observation.ROOM_STATUS_REFRESH_SECONDS",
            0,
        ),
        patch(
            "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
            0,
        ),
    ):
        await _async_run_room(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            CleaningRoom("room-study", "Study", "vacuum", "quick"),
            robot.port(
                refresh=refresh,
                active_session=AsyncMock(return_value=False),
                session_identity=robot.accepting,
            ),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
        )

    assert robot.port().observed().activity is RobotActivity.RETURNING
    refresh.assert_awaited()
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()
    manager.ledger.async_mark_failed.assert_not_awaited()


async def test_app_stop_after_partial_room_never_credits_or_advances(hass) -> None:
    """A direct idle transition is an interruption and receives no credit."""

    robot = FakeRobot()

    async def send_command(*_args, **_kwargs) -> None:
        robot.show("cleaning", current_area="Study")

        async def stop_room() -> None:
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            robot.show("idle", current_area="Study")

        hass.async_create_task(stop_room(), eager_start=True)

    robot.on_start = send_command

    @asynccontextmanager
    async def current_reconciliation(_serial, _token):
        yield True

    manager = SimpleNamespace(
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value=None),
            managed_reconciliation=current_reconciliation,
            managed_motion_is_current=MagicMock(return_value=True),
            async_replace_managed_motion=AsyncMock(),
        ),
        ledger=SimpleNamespace(
            async_claim_native_session=AsyncMock(),
            async_mark_started=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_interrupted=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
    )
    session_reader = AsyncMock(return_value=False)
    sender = AsyncMock()

    with pytest.raises(ServiceValidationError):
        await _async_run_room(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            CleaningRoom("room-study", "Study", "vacuum", "quick"),
            robot.port(active_session=session_reader, session_identity=robot.accepting),
            17,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
        )

    session_reader.assert_not_awaited()
    manager.ledger.async_mark_interrupted.assert_awaited_once()
    manager.ledger.async_mark_ended_unverified.assert_not_awaited()
    manager.ledger.async_mark_completed.assert_not_awaited()


@pytest.mark.parametrize(
    ("error", "expected_type", "expected_reason_code"),
    [
        (
            MaticError("robot rejected the command"),
            ServiceValidationError,
            "robot_error",
        ),
        (
            ServiceValidationError("translated failure"),
            ServiceValidationError,
            "managed_failure",
        ),
        (HomeAssistantError("call failed"), HomeAssistantError, "managed_failure"),
    ],
)
async def test_room_failures_translate_client_errors_at_boundary(
    error, expected_type, expected_reason_code
) -> None:
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus)
    manager = SimpleNamespace(
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value=None),
            managed_motion_is_current=MagicMock(return_value=True),
            managed_reconciliation=lambda *_args: nullcontext(True),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
        ),
    )
    finish_room_event = asyncio.Event()
    finish_room_event.set()
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(side_effect=error),
        ),
        pytest.raises(expected_type) as excinfo,
    ):
        await _async_run_room(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            room,
            robot.port(session_identity=robot.accepting),
            7,
            finish_room_event=finish_room_event,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
        )
    if isinstance(error, MaticError):
        assert excinfo.value.translation_key == "robot_command_failed"
        assert "robot rejected" not in str(excinfo.value)
    else:
        assert excinfo.value is error
    manager.ledger.async_mark_failed.assert_awaited_once()
    assert not finish_room_event.is_set()
    manager.ledger.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_failed"
    event_data = bus.async_fire.call_args_list[-1].args[1]
    assert event_data["reason_code"] == expected_reason_code
    assert event_data["cause"] == "unknown"
