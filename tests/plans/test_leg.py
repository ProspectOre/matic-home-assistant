"""One managed leg: dispatch, start, suspension, errors and cancellation."""

import asyncio
from contextlib import nullcontext
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningSessionRecord,
    RobotActivity,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_dispatch import _async_dispatch_leg_command
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RoomRunOutcome,
    _PreparedRoomDispatch,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.robot_commands import CleanRooms
from custom_components.matic_robot.run_control import ManagedMotionReplacedError
from tests.plans.fakes import (
    OWNED_SESSION,
    kitchen_leg_ends,
    leg_manager,
    leg_record,
    leg_rooms,
    memory_manager,
    plan_room,
    run_plan_call,
)
from tests.session_fakes import FakeRobot, run_step
from tests.wire_builders import _session_identity


async def test_leg_dispatch_sends_one_ordered_multi_room_mission(hass) -> None:
    robot = FakeRobot()
    rooms = [plan_room("Kitchen", "room-kitchen"), plan_room("Office", "room-office")]

    dispatch = await _async_dispatch_leg_command(
        robot.port(session_identity=robot.accepting), rooms, 7, floor_token="a" * 64
    )

    assert dispatch.rooms == tuple(rooms)
    [command] = robot.started
    assert isinstance(command, CleanRooms)
    assert command.rooms == ("room-kitchen", "room-office")
    assert command.ordered is True
    assert command.cleaning_mode == "vacuum_and_mop"
    assert command.coverage == "standard"
    assert command.motion_token == 7
    assert command.floor_token == "a" * 64
    assert isinstance(command.session_id, UUID)


async def test_leg_dispatch_keeps_single_room_unordered(hass) -> None:
    robot = FakeRobot()

    dispatch = await _async_dispatch_leg_command(
        robot.port(session_identity=robot.accepting),
        [plan_room("Kitchen", "room-kitchen")],
        7,
        floor_token="floor",
    )

    assert dispatch.rooms == (plan_room("Kitchen", "room-kitchen"),)
    [command] = robot.started
    assert command.rooms == ("room-kitchen",)
    assert command.ordered is False


async def test_leg_dispatch_allows_stale_completed_identity(hass) -> None:
    """A blocked-doorway handoff may retain its completed identity at dispatch."""
    robot = FakeRobot()
    identity = AsyncMock(return_value=b"completed")

    async def accept(command) -> None:
        identity.return_value = _session_identity(command.session_id)

    robot.on_start = accept

    dispatch = await _async_dispatch_leg_command(
        robot.port(session_identity=identity),
        [plan_room("Dining Room", "room-dining")],
        7,
        expected_dispatch_identity=b"completed",
        floor_token="floor",
    )

    [command] = robot.started
    assert isinstance(command, CleanRooms)
    assert dispatch.native_identity_baseline == b"completed"
    assert dispatch.native_identity == _session_identity(command.session_id)


async def test_active_session_can_resume_then_end_unverified() -> None:
    """A returning firmware session may resume before an unverified handoff."""
    robot = FakeRobot()
    robot.show("cleaning")
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
    outcomes = 0

    async def leg_outcome(*_args, **_kwargs):
        # The mission resumes once, then ends on its way home.
        nonlocal outcomes
        outcomes += 1
        if outcomes == 2:
            robot.show("returning")
        return RoomRunOutcome.HANDOFF_CANDIDATE

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
    room = plan_room("Kitchen", "room-kitchen")
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            leg_outcome,
        ),
    ):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
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

    manager.ledger.async_mark_suspended.assert_not_awaited()
    assert manager.ledger.async_mark_verifying.await_count == 1
    assert manager.ledger.async_mark_resumed.await_count == 2
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_partial_mixed_dispatch_preserves_its_transmitted_stop(hass) -> None:
    """An API recovery STOP owns settlement; generic cleanup must not replace it."""
    robot = FakeRobot()
    manager = memory_manager(hass)
    sender = AsyncMock()

    async def fail_dispatch(_call) -> None:
        run_id = manager.ledger.active_run_id("serial")
        assert run_id is not None
        await manager.control.async_mark_stop_pending("serial", run_id=run_id)
        raise HomeAssistantError("mixed update failed after recovery STOP")

    robot.on_start = fail_dispatch
    rooms = [
        CleaningRoom("room-kitchen", "Kitchen", "vacuum", "quick"),
        CleaningRoom("room-office", "Office", "mop", "optimal"),
    ]
    with pytest.raises(HomeAssistantError):
        await _async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            robot=robot.port(session_identity=AsyncMock(return_value=b"")),
            managed_user_command=sender,
            floor_token="synthetic-floor-token",
        )

    sender.assert_not_awaited()
    assert manager.control.pending_stop_run_id("serial") is not None


async def test_leg_uses_matching_prepared_dispatch_and_rejects_mismatch(hass) -> None:
    robot = FakeRobot()
    robot.running = OWNED_SESSION
    rooms = leg_rooms()
    manager = leg_manager()
    robot.show("cleaning", current_area="Kitchen")

    async def end_leg() -> None:
        await asyncio.sleep(0)
        robot.show("returning", current_area="Kitchen", low_charge=False)

    hass.async_create_task(end_leg(), eager_start=True)

    async def history() -> tuple[CleaningSessionRecord, ...]:
        return (leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    confirmed: list[str] = []
    recorded: list[str] = []
    prepared = _PreparedRoomDispatch(
        tuple(rooms), frozenset(), dt_util.utcnow() - timedelta(seconds=1)
    )
    completed = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(
            session_history=history,
            confirm_room_completed=confirmed.append,
            session_identity=robot.accepting,
        ),
        7,
        record_room_completed=lambda room: recorded.append(room.room_id),
        prepared_dispatch=prepared,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )
    assert completed is True
    assert confirmed == ["Kitchen", "Office"]
    assert recorded == ["room-kitchen", "room-office"]

    with pytest.raises(ValueError):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            leg_manager(),
            "vacuum.matic",
            "serial",
            rooms,
            robot.port(session_identity=robot.accepting),
            7,
            prepared_dispatch=_PreparedRoomDispatch(
                (rooms[0],), frozenset(), dt_util.utcnow()
            ),
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )


async def test_leg_start_timeout_marks_failure_and_stops(hass) -> None:
    robot = FakeRobot()
    manager = leg_manager()
    robot.show("docked")
    robot.on_start = AsyncMock()
    sender = AsyncMock()

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            run_plan_call(hass, start_timeout=0),
            manager,
            "vacuum.matic",
            "serial",
            leg_rooms(),
            robot.port(session_identity=robot.owned),
            7,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_failed.assert_awaited_once()
    sender.assert_awaited_once_with(7, UserCommand.STOP)


async def test_leg_paused_start_suspends_until_cleaning(hass) -> None:
    robot = FakeRobot()
    rooms = leg_rooms()
    manager = leg_manager()
    resumed = asyncio.Event()

    async def confirm_resume(*args):
        if manager.ledger.async_mark_suspended.await_count:
            resumed.set()

    manager.ledger.async_mark_resumed.side_effect = confirm_resume

    async def send_command(_call) -> None:
        robot.show("paused", current_area="Kitchen")

        async def resume() -> None:
            await asyncio.sleep(0)
            robot.show("cleaning", current_area="Kitchen")
            await resumed.wait()
            robot.show("returning", current_area="Kitchen", low_charge=False)

        hass.async_create_task(resume(), eager_start=True)

    robot.on_start = send_command
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    completed = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(
            session_history=history,
            session_identity=robot.accepting,
        ),
        7,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )

    assert completed is True
    manager.ledger.async_mark_suspended.assert_awaited_once()
    assert manager.ledger.async_mark_suspended.await_args.args[3] == "paused"


async def test_leg_suspension_mid_leg_resumes(hass) -> None:
    robot = FakeRobot()
    rooms = leg_rooms()
    manager = leg_manager()
    resumed = asyncio.Event()

    async def confirm_resume(*args):
        if manager.ledger.async_mark_suspended.await_count:
            resumed.set()

    manager.ledger.async_mark_resumed.side_effect = confirm_resume

    async def send_command(_call) -> None:
        robot.show("cleaning", current_area="Kitchen")

        async def recharge() -> None:
            await asyncio.sleep(0)
            robot.show("returning", current_area="Kitchen", low_charge=True)
            await asyncio.sleep(0)
            robot.show("cleaning", current_area="Office")
            await resumed.wait()
            robot.show("returning", current_area="Office", low_charge=False)

        hass.async_create_task(recharge(), eager_start=True)

    robot.on_start = send_command
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    completed = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(
            session_history=history,
            session_identity=robot.accepting,
        ),
        7,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )

    assert completed is True
    manager.ledger.async_mark_suspended.assert_awaited_once()
    assert manager.ledger.async_mark_suspended.await_args.args[3] == "low_charge"


async def test_leg_completion_timeout_fails(hass) -> None:
    robot = FakeRobot()
    manager = leg_manager()
    finish_room_event = asyncio.Event()
    finish_room_event.set()

    async def send_command(_call) -> None:
        robot.show("cleaning", current_area="Kitchen")

    robot.on_start = send_command

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            run_plan_call(hass, completion_timeout=0),
            manager,
            "vacuum.matic",
            "serial",
            leg_rooms(),
            robot.port(session_identity=robot.accepting),
            7,
            finish_room_event=finish_room_event,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_failed.assert_awaited_once()
    assert "completion timeout" in manager.ledger.async_mark_failed.await_args.args[3]
    assert not finish_room_event.is_set()


async def test_leg_matic_error_dispatch_fails(hass) -> None:
    robot = FakeRobot()
    manager = leg_manager()

    async def send_command(_call) -> None:
        raise MaticError("synthetic")

    robot.on_start = send_command

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            leg_rooms(),
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_failed.assert_awaited_once()


async def test_leg_replaced_dispatch_cancels(hass) -> None:
    robot = FakeRobot()
    manager = leg_manager()

    async def send_command(_call) -> None:
        raise ManagedMotionReplacedError("replaced")

    robot.on_start = send_command

    with pytest.raises(PlanCancelledError):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            leg_rooms(),
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_cancelled.assert_awaited_once()


@pytest.mark.parametrize("reason", [None, "motion_replaced", "config_entry_unload"])
async def test_leg_cancellation_records_history(hass, reason: str | None) -> None:
    robot = FakeRobot()
    manager = leg_manager(reason)
    cancel_event = asyncio.Event()
    events = []
    hass.bus.async_listen(f"{DOMAIN}_room_cancelled", events.append)

    async def send_command(_call) -> None:
        robot.show("cleaning", current_area="Kitchen")

        async def cancel() -> None:
            await asyncio.sleep(0)
            cancel_event.set()

        hass.async_create_task(cancel(), eager_start=True)

    robot.on_start = send_command

    with pytest.raises(PlanCancelledError):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            leg_rooms(),
            robot.port(session_identity=robot.accepting),
            7,
            cancel_event=cancel_event,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    if reason != "config_entry_unload":
        manager.ledger.async_mark_cancelled.assert_awaited_once()
        await hass.async_block_till_done()
        assert events[-1].data["cause"] == (
            "replacement"
            if reason == "motion_replaced"
            else "managed_cancellation"
            if reason == "managed_stop"
            else "unknown"
        )
        assert events[-1].data["reason_code"] == (
            "managed_cancelled"
            if reason in {"managed_stop", "motion_replaced"}
            else "cancellation_unattributed"
        )
    else:
        manager.ledger.async_mark_interrupted.assert_awaited_once()


async def test_leg_error_state_raises_robot_error(hass) -> None:
    robot = FakeRobot()
    manager = leg_manager()

    async def send_command(_call) -> None:
        robot.show("cleaning", current_area="Kitchen")

        async def fail() -> None:
            await asyncio.sleep(0)
            robot.show("error")

        hass.async_create_task(fail(), eager_start=True)

    robot.on_start = send_command

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            leg_rooms(),
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_failed.assert_awaited_once()


async def test_leg_takeover_during_verification_interrupts(hass) -> None:
    robot = FakeRobot()
    manager = leg_manager()

    robot.on_start = kitchen_leg_ends(hass, robot)

    async def takeover(*_args, **_kwargs) -> None:
        robot.show("cleaning", current_area="Den")

    manager.ledger.async_mark_verifying = AsyncMock(side_effect=takeover)

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            leg_rooms(),
            robot.port(
                session_history=AsyncMock(return_value=()),
                session_identity=robot.accepting,
            ),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_interrupted.assert_awaited_once()


async def test_leg_without_history_reader_credits_nothing(hass) -> None:
    robot = FakeRobot()
    manager = leg_manager()

    robot.on_start = kitchen_leg_ends(hass, robot)

    completed = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        leg_rooms(),
        robot.port(session_identity=robot.accepting),
        7,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )

    assert completed is False
    assert manager.ledger.async_mark_ended_unverified.await_count == 2
    manager.ledger.async_mark_completed.assert_not_awaited()
