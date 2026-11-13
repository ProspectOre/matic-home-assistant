"""Run one plan room through the robot port and record its outcome."""

import asyncio
from contextlib import asynccontextmanager, nullcontext
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import RobotActivity
from custom_components.matic_robot.managed_dispatch import _async_dispatch_leg_command
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RoomRunOutcome,
    RoomTakenOverError,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.robot_commands import CleanRooms
from tests.session_fakes import FakeRobot, run_step
from tests.test_plans import (
    _call,
    _mission_ends,
    _room,
    fast_native_history_retries,  # noqa: F401 (autouse fixture)
)
from tests.test_services import _execution_call
from tests.wire_builders import _session_identity


async def test_room_cancellation_records_history_and_reraises() -> None:
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
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
        await _async_run_leg(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            [room],
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )
    manager.ledger.async_mark_cancelled.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_cancelled"


async def test_room_cancellation_preserves_low_charge_reason() -> None:
    """Room cleanup carries suspension evidence to the plan finalizer."""
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
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
        await _async_run_leg(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            [room],
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
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
        await _async_run_leg(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            [CleaningRoom("room-study", "Study", "vacuum", "quick")],
            robot.port(
                refresh=refresh,
                active_session=AsyncMock(return_value=False),
                session_identity=robot.accepting,
            ),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
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
        await _async_run_leg(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            [CleaningRoom("room-study", "Study", "vacuum", "quick")],
            robot.port(active_session=session_reader, session_identity=robot.accepting),
            17,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
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
    hass = SimpleNamespace(bus=bus, is_stopping=False)
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
        await _async_run_leg(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            [room],
            robot.port(session_identity=robot.accepting),
            7,
            finish_room_event=finish_room_event,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
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


async def test_room_execution_uses_its_individual_settings() -> None:
    robot = FakeRobot()
    events = []

    async def send(command):
        events.append(("send", str(command.session_id)))

    async def claim(_serial_number, session_id, *, run_id=None):
        events.append(("claim", session_id, run_id))

    robot.on_start = send
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
    manager = SimpleNamespace(
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value=None),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    manager.ledger.async_claim_native_session = AsyncMock(side_effect=claim)

    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ) as wait,
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            _mission_ends(robot),
        ),
    ):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(
                session_identity=robot.accepting,
            ),
            3,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    [dispatched] = robot.started
    session_id = str(dispatched.session_id)
    assert events == [("claim", session_id, None), ("send", session_id)]
    assert dispatched == CleanRooms(
        rooms=("room-study",),
        cleaning_mode="vacuum",
        coverage="quick",
        ordered=False,
        motion_token=3,
        session_id=dispatched.session_id,
        floor_token="floor",
    )
    assert wait.await_count == 1
    manager.ledger.async_mark_resumed.assert_awaited_once_with("serial", "away", room)
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()
    assert (
        bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_ended_unverified"
    )


async def test_room_timeout_is_failure_safe() -> None:
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
    manager = SimpleNamespace(
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value=None),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    sender = AsyncMock(side_effect=MaticError("synthetic cleanup failure"))
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(side_effect=TimeoutError),
        ),
        pytest.raises(
            ServiceValidationError, match="did not begin cleaning"
        ) as failure,
    ):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "room-kitchen")],
            robot.port(session_identity=robot.accepting),
            7,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )
    sender.assert_awaited_once_with(7, UserCommand.STOP)
    assert failure.value.translation_key == "plan_start_timeout"
    manager.ledger.async_mark_failed.assert_awaited_once()
    assert (
        manager.ledger.async_mark_failed.await_args.args[3]
        == "The robot did not begin cleaning before the start timeout"
    )
    manager.ledger.async_mark_resumed.assert_not_awaited()
    manager.ledger.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_failed"


async def test_room_completion_timeout_is_failure_safe() -> None:
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        bus=bus,
        is_stopping=False,
        async_create_background_task=lambda watcher, _name: watcher.close(),
    )
    manager = SimpleNamespace(
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value=None),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    room = _room("Kitchen", "room-kitchen")

    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(side_effect=TimeoutError),
        ),
        pytest.raises(ServiceValidationError, match="Timed out") as failure,
    ):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    assert failure.value.translation_key == "plan_timeout"
    manager.ledger.async_mark_failed.assert_awaited_once()
    assert (
        manager.ledger.async_mark_failed.await_args.args[3]
        == "The managed room exceeded its completion timeout"
    )
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_room_takeover_during_verification_is_failure_safe() -> None:
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
    manager = SimpleNamespace(
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value=None),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
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
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    room = _room("Kitchen", "room-kitchen")

    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(side_effect=RoomTakenOverError("replacement task")),
        ),
        pytest.raises(ServiceValidationError) as failure,
    ):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    assert failure.value.translation_key == "room_taken_over"
    manager.ledger.async_mark_interrupted.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_room_recharge_waits_for_resume_before_unverified_handoff() -> None:
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
    manager = SimpleNamespace(
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value=None),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_suspended=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(side_effect=[RobotActivity.CLEANING, RobotActivity.CLEANING]),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(
                side_effect=[
                    RoomRunOutcome.SUSPENDED,
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                ]
            ),
        ) as outcome,
    ):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "room-kitchen")],
            robot.port(
                session_identity=AsyncMock(
                    side_effect=lambda: (
                        b""
                        if not robot.started or outcome.await_count >= 2
                        else _session_identity(robot.started[-1].session_id)
                    )
                ),
            ),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_suspended.assert_awaited_once_with(
        "serial", "away", _room("Kitchen", "room-kitchen"), "low_charge"
    )
    assert manager.ledger.async_mark_resumed.await_count == 2
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_active_session_clearing_at_dock_is_not_completion_credit() -> None:
    """Session disappearance permits handoff but never proves room completion."""
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
    manager = SimpleNamespace(
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value=None),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_suspended=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    room = _room("Kitchen", "room-kitchen")
    # The session is still active on the first read after the handoff, then clears.
    active_at_dock = iter((True, False))

    async def identity() -> bytes:
        if not robot.started or (outcome.await_count and not next(active_at_dock)):
            return b""
        return _session_identity(robot.started[-1].session_id)

    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ) as outcome,
    ):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(session_identity=identity),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_suspended.assert_not_awaited()
    manager.ledger.async_mark_verifying.assert_awaited_once()
    assert manager.ledger.async_mark_verifying.await_args.args == (
        "serial",
        "away",
        room,
    )
    assert datetime.fromisoformat(
        manager.ledger.async_mark_verifying.await_args.kwargs["checkpoint"].fields[
            "verification_deadline"
        ]
    ).tzinfo
    assert manager.ledger.async_mark_resumed.await_count == 1
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()
