"""Room runs and the executor's loop over them."""

import asyncio
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import RobotActivity
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RoomRunOutcome,
    _PreparedRoomDispatch,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.run_control import ManagedMotionReplacedError
from tests.plans.fakes import (
    OWNED_SESSION,
    heavy_room,
    kitchen_leg_ends,
    leg_rooms,
    memory_manager,
    mission_ends,
    plan_room,
    run_plan_call,
)
from tests.session_fakes import FakeRobot, one_room_missions, run_step
from tests.wire_builders import _session_identity


def _owned_leg(verified: object = True) -> AsyncMock:
    """Stand in for a leg whose mission ran as this run's own native session."""

    async def run(*_args: object, on_native_identity, **_kwargs: object) -> object:
        on_native_identity(OWNED_SESSION)
        return verified

    return AsyncMock(side_effect=run)


async def test_room_unverified_handoff_does_not_start_the_next_room(
    hass,
) -> None:
    """An unverified current room cannot dispatch the following room."""
    robot = FakeRobot()
    room = plan_room("Kitchen", "room-kitchen")
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
            async_mark_suspended=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )

    robot.on_start = kitchen_leg_ends(hass, robot)

    sender = AsyncMock()
    with patch(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    ):
        completed = await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(
                session_history=AsyncMock(return_value=()),
                session_identity=robot.accepting,
            ),
            7,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    assert completed is False
    sender.assert_not_awaited()
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_room_accepts_only_matching_prepared_dispatch() -> None:
    robot = FakeRobot()
    robot.running = OWNED_SESSION
    room = plan_room("Kitchen", "room-kitchen")
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
            async_mark_suspended=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    hass = SimpleNamespace(
        bus=SimpleNamespace(async_fire=MagicMock()),
    )
    prepared = _PreparedRoomDispatch((room,), None, dt_util.utcnow())
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            mission_ends(robot),
        ),
    ):
        assert not await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(session_identity=robot.accepting),
            7,
            prepared_dispatch=prepared,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    wrong = _PreparedRoomDispatch(
        (plan_room("Study", "room-study"),), None, dt_util.utcnow()
    )
    with pytest.raises(ValueError, match="does not match"):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(session_identity=robot.accepting),
            7,
            prepared_dispatch=wrong,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )


@pytest.mark.parametrize("failure_stage", ["initial_unknown", "later_unknown"])
async def test_unknown_session_identity_fails_closed_without_room_credit(
    failure_stage,
) -> None:
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
            async_mark_suspended=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    # After the handoff the session reads as this run's once, while the room
    # outcome settles, and once more for a later failure; then it is unknown.
    known_reads = 1 if failure_stage == "initial_unknown" else 2

    async def identity() -> bytes | None:
        nonlocal known_reads
        if outcome.await_count:
            if not known_reads:
                return None
            known_reads -= 1
        return await robot.accepting()

    sender = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ) as outcome,
        patch(
            "custom_components.matic_robot.managed_executor.asyncio.sleep", AsyncMock()
        ),
        pytest.raises(ServiceValidationError) as failure,
    ):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "room-kitchen")],
            robot.port(session_identity=identity),
            10,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    assert failure.value.translation_key == "room_taken_over"
    # A task this run cannot identify is never its to stop.
    sender.assert_not_awaited()
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_room_starting_paused_is_suspended_until_resume() -> None:
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
    wait = AsyncMock(side_effect=[RobotActivity.PAUSED, RobotActivity.CLEANING])
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            wait,
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ) as outcome,
    ):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "room-kitchen")],
            robot.port(
                session_identity=AsyncMock(
                    side_effect=lambda: (
                        b""
                        if not robot.started or outcome.await_count >= 1
                        else _session_identity(robot.started[-1].session_id)
                    )
                ),
            ),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_suspended.assert_awaited_once()
    assert wait.await_count == 2
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_room_pause_and_resume_outcome() -> None:
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
            async_mark_suspended=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    room = plan_room("Kitchen", "room-kitchen")
    wait = AsyncMock(return_value=RobotActivity.CLEANING)
    run = _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        [room],
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
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            wait,
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(
                side_effect=[
                    RoomRunOutcome.PAUSED,
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                ]
            ),
        ) as outcome,
    ):
        await run

    manager.ledger.async_mark_suspended.assert_awaited_once_with(
        "serial", "away", room, "paused"
    )
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_room_interruption_and_replaced_dispatch_never_complete() -> None:
    room = plan_room("Kitchen", "room-kitchen")
    for interrupted in (True, False):
        robot = FakeRobot()
        bus = SimpleNamespace(async_fire=MagicMock())
        hass = SimpleNamespace(
            bus=bus,
            is_stopping=False,
            async_create_background_task=lambda watcher, _name: watcher.close(),
        )
        manager = SimpleNamespace(
            ledger=SimpleNamespace(
                async_mark_started=AsyncMock(),
                async_claim_native_session=AsyncMock(),
                async_mark_completed=AsyncMock(),
                async_mark_ended_unverified=AsyncMock(),
                async_mark_verifying=AsyncMock(),
                async_mark_failed=AsyncMock(),
                async_mark_interrupted=AsyncMock(),
                async_mark_cancelled=AsyncMock(),
                async_mark_resumed=AsyncMock(),
            ),
            control=SimpleNamespace(
                managed_reconciliation=lambda *_args: nullcontext(True),
                managed_motion_is_current=MagicMock(return_value=True),
                register_reconciliation_task=MagicMock(),
                cancellation_reason=MagicMock(return_value=None),
            ),
            history=SimpleNamespace(snapshot=MagicMock(return_value={})),
        )
        if interrupted:
            outcome = AsyncMock(return_value=RoomRunOutcome.INTERRUPTED)
            state = AsyncMock(return_value=RobotActivity.CLEANING)
        else:
            robot.on_start = AsyncMock(
                side_effect=ManagedMotionReplacedError("replaced")
            )
            outcome = AsyncMock()
            state = AsyncMock()
        sender = AsyncMock()
        with (
            patch(
                "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
                outcome,
            ),
            patch(
                "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
                state,
            ),
            pytest.raises(
                ServiceValidationError if interrupted else PlanCancelledError
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
                4,
                managed_user_command=sender,
                floor_token="floor",
                checkpoint_dispatch=AsyncMock(),
                advance=run_step,
            )
        manager.ledger.async_mark_completed.assert_not_awaited()
        if interrupted:
            manager.ledger.async_mark_resumed.assert_awaited_once()
            manager.ledger.async_mark_interrupted.assert_awaited_once()
            assert (
                bus.async_fire.call_args_list[-1].args[0].endswith("room_interrupted")
            )
        else:
            manager.ledger.async_mark_resumed.assert_not_awaited()
            manager.ledger.async_mark_cancelled.assert_awaited_once()
            sender.assert_not_awaited()


async def test_unload_cancellation_stops_and_persists_interruption() -> None:
    """Config-entry unload stops accepted motion and never credits the room."""
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        bus=bus,
        is_stopping=False,
        async_create_background_task=lambda watcher, _name: watcher.close(),
    )
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_interrupted=AsyncMock(),
            async_mark_cancelled=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value="config_entry_unload"),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
    )
    sender = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "room-kitchen")],
            robot.port(session_identity=robot.accepting),
            8,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    sender.assert_awaited_once_with(8, UserCommand.STOP)
    manager.ledger.async_mark_interrupted.assert_awaited_once()
    manager.ledger.async_mark_cancelled.assert_not_awaited()
    manager.ledger.async_mark_completed.assert_not_awaited()


async def test_execute_rooms_rejects_overlap_handles_cancel_and_returns_home(
    hass,
) -> None:
    robot = FakeRobot()
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    call = run_plan_call(hass, return_to_base=True)
    lock = manager.control.lock("serial")
    await lock.acquire()
    try:
        with pytest.raises(ServiceValidationError, match="already running"):
            await _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [room],
                floor_token="floor",
                robot=robot.port(),
            )
    finally:
        lock.release()

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg",
        AsyncMock(side_effect=PlanCancelledError),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            floor_token="floor",
            robot=robot.port(),
        )

    managed_command = AsyncMock()
    robot.show("idle")
    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg", _owned_leg()
    ) as run:
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            floor_token="floor",
            robot=robot.port(session_identity=AsyncMock(return_value=OWNED_SESSION)),
            managed_user_command=managed_command,
        )
    run.assert_awaited_once()
    managed_command.assert_awaited_once()
    assert managed_command.await_args.args[1] is UserCommand.DOCK
    assert not robot.started


async def test_execute_rooms_finishes_current_room_then_stops_and_docks(hass) -> None:
    """A graceful stop never dispatches the next room and always returns home."""
    robot = FakeRobot()
    manager = memory_manager(hass)
    managed_command = AsyncMock()
    robot.show("idle")
    call = run_plan_call(hass, return_to_base=False)

    async def finish_then_stop(*_args, on_native_identity, **_kwargs) -> bool:
        on_native_identity(OWNED_SESSION)
        manager.control.finish_room_event("serial").set()
        return True

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg",
        AsyncMock(side_effect=finish_then_stop),
    ) as run:
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "one"), heavy_room("Study", "two")],
            floor_token="floor",
            robot=robot.port(session_identity=AsyncMock(return_value=OWNED_SESSION)),
            managed_user_command=managed_command,
        )

    run.assert_awaited_once()
    managed_command.assert_awaited_once()
    assert managed_command.await_args.args[1] is UserCommand.DOCK


async def test_execute_rooms_stops_after_unverified_room(hass, monkeypatch) -> None:
    """A terminal room without native completion never dispatches the next room."""
    one_room_missions(monkeypatch)
    robot = FakeRobot()
    manager = memory_manager(hass)
    rooms = [
        plan_room("Kitchen", "room-kitchen"),
        heavy_room("Study", "room-study"),
    ]
    managed_command = AsyncMock()
    robot.show("idle")
    manager.repository.robot("serial")["plans"]["away"] = {"finish_current_room": True}

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg", _owned_leg(False)
    ) as run:
        await _async_execute_rooms(
            hass,
            run_plan_call(hass, return_to_base=True),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            floor_token="floor",
            robot=robot.port(session_identity=AsyncMock(return_value=OWNED_SESSION)),
            managed_user_command=managed_command,
        )

    run.assert_awaited_once()
    assert run.await_args.args[5] == [rooms[0]]
    managed_command.assert_awaited_once()
    assert managed_command.await_args.args[1] is UserCommand.DOCK


async def test_execute_rooms_rechecks_ownership_after_room_history_save(hass) -> None:
    """A replacement after room completion prevents the old plan from docking."""
    manager = memory_manager(hass)
    managed_command = AsyncMock()
    robot = FakeRobot()
    robot.show("idle")

    async def replace_after_room(*_args, **_kwargs) -> bool:
        manager.control.replace_managed_motion("serial")
        return True

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg",
        AsyncMock(side_effect=replace_after_room),
    ):
        await _async_execute_rooms(
            hass,
            run_plan_call(hass, return_to_base=True),
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "one")],
            floor_token="floor",
            robot=robot.port(),
            managed_user_command=managed_command,
        )

    managed_command.assert_not_awaited()
    assert manager.control.lock("serial").locked() is False


async def test_execute_rooms_handles_final_ownership_and_dock_failures(hass) -> None:
    room = plan_room("Kitchen", "one")
    robot = FakeRobot()
    robot.show("idle")
    call = run_plan_call(hass, return_to_base=True)

    manager = memory_manager(hass)
    with (
        patch(
            "custom_components.matic_robot.managed_leg._async_run_leg",
            _owned_leg(),
        ),
        patch.object(
            manager.control,
            "managed_motion_is_current",
            MagicMock(side_effect=[True, True, False]),
        ),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            floor_token="floor",
            robot=robot.port(session_identity=AsyncMock(return_value=OWNED_SESSION)),
            managed_user_command=AsyncMock(),
        )

    for error in (
        ManagedMotionReplacedError("replaced"),
        MaticError("synthetic dock failure"),
    ):
        manager = memory_manager(hass)
        sender = AsyncMock(side_effect=error)
        with patch(
            "custom_components.matic_robot.managed_leg._async_run_leg",
            _owned_leg(),
        ):
            run = _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [room],
                floor_token="floor",
                robot=robot.port(
                    session_identity=AsyncMock(return_value=OWNED_SESSION)
                ),
                managed_user_command=sender,
            )
            if isinstance(error, MaticError):
                with pytest.raises(ServiceValidationError) as failure:
                    await run
                assert failure.value.translation_key == "robot_command_failed"
            else:
                await run
        sender.assert_awaited_once()


@pytest.mark.parametrize("failure", [RuntimeError, asyncio.CancelledError])
@pytest.mark.parametrize(
    ("activity", "session", "low_charge", "expect_stop"),
    [
        ("docked", False, False, False),
        ("cleaning", False, False, True),
        ("returning", True, False, False),
        ("returning", True, True, True),
        ("charging", True, False, True),
        ("charging", RuntimeError, False, True),
    ],
)
async def test_execute_history_failure_does_not_orphan_verifying_room(
    hass, failure, activity, session, low_charge, expect_stop, monkeypatch
):
    """The real runner must retire ownership even when verification aborts."""
    robot = FakeRobot()
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    rooms = leg_rooms()
    reads = 0
    started = asyncio.Event()
    mark_resumed = manager.ledger.async_mark_resumed

    async def resumed(*args):
        await mark_resumed(*args)
        started.set()

    manager.ledger.async_mark_resumed = resumed

    async def send_command(_call):
        robot.show("cleaning", current_area="Kitchen")

        async def finish():
            # The leg docks once the run has seen its mission start.
            await started.wait()
            robot.show("docked", current_area="Kitchen")

        hass.async_create_task(finish(), eager_start=True)

    async def history(**_: object):
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        assert (
            manager.history.snapshot("serial")["active_plan"]["status"] == "verifying"
        )
        robot.show(activity, current_area="Kitchen", low_charge=low_charge)
        raise failure("synthetic verification abort")

    robot.on_start = send_command
    sender = AsyncMock()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0,
    )

    async def native_session():
        # The runner's ordinary completion checks see a finished session;
        # the failure cleanup sees the current recharge/unknown state.
        if reads < 2:
            return False
        if session is RuntimeError:
            raise RuntimeError("synthetic read failure")
        return session

    with pytest.raises(failure, match="synthetic verification abort"):
        await _async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            floor_token="floor",
            robot=robot.port(
                session_history=history,
                active_session=native_session,
                session_identity=robot.accepting,
            ),
            managed_user_command=sender,
        )
    assert not manager.control.lock("serial").locked()
    snapshot = manager.history.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["completed_runs"] == 0
    assert snapshot["interrupted_runs"] == 1
    restored = CleaningPlanManager(hass)
    await restored.async_load()
    assert restored.history.snapshot("serial")["active_plan"] is None
    if expect_stop:
        assert sender.await_count == 1
        assert sender.await_args.args[1] is UserCommand.STOP
    else:
        sender.assert_not_awaited()
