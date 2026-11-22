"""Multi-room missions, room-boundary stops and smart stop."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.models import CleaningSessionRecord
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_run import PlanCancelledError
from custom_components.matic_robot.plan_model import CleaningRoom, PlanStopDecision
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import (
    credit_rooms,
    kitchen_leg_ends,
    leg_manager,
    leg_record,
    memory_manager,
    plan_room,
    recovery_record,
    run_plan_call,
)
from tests.session_fakes import FakeRobot, robot_port, run_step


@pytest.mark.parametrize("real_store", [False, True])
@pytest.mark.parametrize("reject_second_credit", [False, True])
async def test_leg_runs_two_rooms_in_one_mission_without_redispatch(
    hass, real_store, reject_second_credit
) -> None:
    """One leg mission glides room to room; credit comes from one record."""
    robot = FakeRobot()
    rooms = [plan_room("Kitchen", "room-kitchen"), plan_room("Office", "room-office")]
    manager = CleaningPlanManager(hass) if real_store else leg_manager()
    if real_store:
        await manager.async_load()
        manager.ledger.async_mark_completed = AsyncMock(
            wraps=manager.ledger.async_mark_completed
        )
    motion_token = manager.control.begin_managed_motion("serial") if real_store else 7
    if reject_second_credit:
        manager.ledger.async_mark_completed = AsyncMock(side_effect=[True, False])
    commands = []

    async def send_command(command) -> None:
        commands.append(command)
        robot.show("cleaning", current_area="Kitchen")

        async def glide() -> None:
            await asyncio.sleep(0)
            robot.show("cleaning", current_area="Office")
            await asyncio.sleep(0)
            robot.show("returning", current_area="Office", low_charge=False)

        hass.async_create_task(glide(), eager_start=True)

    robot.on_start = send_command
    record: CleaningSessionRecord | None = None
    reads = 0

    async def history(**_: object) -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads, record
        reads += 1
        if reads == 1:
            return ()
        if record is None:
            record = leg_record(
                ("Kitchen", "Office"), ("Kitchen", "Office"), key=robot.history_key()
            )
        return (record,)

    started_events = []
    completed_events = []
    hass.bus.async_listen(
        f"{DOMAIN}_room_started", lambda e: started_events.append(e.data["room"])
    )
    hass.bus.async_listen(
        f"{DOMAIN}_room_completed", lambda e: completed_events.append(e.data["room"])
    )
    sender = AsyncMock()

    if reject_second_credit:
        with pytest.raises(PlanCancelledError, match="ownership changed"):
            await _async_run_leg(
                hass,
                run_plan_call(hass),
                manager,
                "vacuum.matic",
                "serial",
                rooms,
                robot.port(
                    refresh=AsyncMock(),
                    session_history=history,
                    session_identity=robot.accepting,
                ),
                motion_token,
                managed_user_command=sender,
                floor_token="floor",
                checkpoint_dispatch=AsyncMock(),
                advance=run_step,
            )
        completed = False
    else:
        completed = await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            robot.port(
                refresh=AsyncMock(),
                session_history=history,
                session_identity=robot.accepting,
            ),
            motion_token,
            managed_user_command=sender,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )
    await hass.async_block_till_done()

    assert completed is (not reject_second_credit)
    assert len(commands) == 1
    assert commands[0].rooms == ("room-kitchen", "room-office")
    assert started_events == ["Kitchen", "Office"]
    assert sorted(completed_events) == (
        ["Kitchen"] if reject_second_credit else ["Kitchen", "Office"]
    )
    assert manager.ledger.async_mark_completed.await_count == 2
    assert record is not None
    for call_args in manager.ledger.async_mark_completed.await_args_list:
        assert call_args.kwargs["duration_seconds"] == 57
        assert call_args.kwargs["completed_at"] == record.session.ended_at
    sender.assert_not_awaited()


async def test_leg_partial_record_credits_only_verified_subset(
    hass, monkeypatch
) -> None:
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    rooms = [plan_room("Kitchen", "room-kitchen"), plan_room("Office", "room-office")]
    manager = leg_manager()

    robot.on_start = kitchen_leg_ends(hass, robot)
    reads = 0

    async def history(**_: object) -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (
            leg_record(
                ("Kitchen",), ("Kitchen",), completed=False, key=robot.history_key()
            ),
        )

    sender = AsyncMock()
    completed = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(session_history=history, session_identity=robot.accepting),
        7,
        managed_user_command=sender,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )

    assert completed is False
    manager.ledger.async_mark_completed.assert_awaited_once()
    assert manager.ledger.async_mark_completed.await_args.args[2].name == "Kitchen"
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    assert (
        manager.ledger.async_mark_ended_unverified.await_args.args[2].name == "Office"
    )


async def test_leg_boundary_stop_finishes_current_room_only(hass) -> None:
    """A finish-current-room stop sends STOP at the observed room boundary."""
    robot = FakeRobot()
    rooms = [plan_room("Kitchen", "room-kitchen"), plan_room("Office", "room-office")]
    manager = leg_manager()
    finish_room_event = asyncio.Event()

    async def send_command(_command) -> None:
        robot.show("cleaning", current_area="Kitchen")

        async def cross_boundary() -> None:
            await asyncio.sleep(0)
            finish_room_event.set()
            robot.show("cleaning", current_area="Office")

        hass.async_create_task(cross_boundary(), eager_start=True)

    robot.on_start = send_command
    reads = 0

    async def history(**_: object) -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (
            leg_record(
                ("Kitchen",), ("Kitchen",), completed=False, key=robot.history_key()
            ),
        )

    sender = AsyncMock()

    async def stop_then_return(token, command) -> None:
        assert command is UserCommand.STOP
        robot.show("returning", current_area="Office", low_charge=False)

    sender.side_effect = stop_then_return

    completed = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(session_history=history, session_identity=robot.accepting),
        7,
        managed_user_command=sender,
        finish_room_event=finish_room_event,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )

    assert completed is False
    sender.assert_awaited_once_with(7, UserCommand.STOP)
    manager.ledger.async_mark_completed.assert_awaited_once()
    assert manager.ledger.async_mark_completed.await_args.args[2].name == "Kitchen"
    manager.ledger.async_mark_ended_unverified.assert_awaited_once()
    assert (
        manager.ledger.async_mark_ended_unverified.await_args.args[2].name == "Office"
    )


async def test_boundary_stop_is_not_repeated_while_next_room_is_still_cleaning(
    hass,
):
    """Track the room after STOP so its live state cannot restart the countdown."""
    robot = FakeRobot()
    rooms = [
        plan_room("Kitchen", "room-kitchen"),
        plan_room("Office", "room-office"),
        plan_room("Study", "room-study"),
    ]
    manager = leg_manager()
    finish_room_event = asyncio.Event()

    async def send_command(_command) -> None:
        robot.show("cleaning", current_area="Kitchen")

        async def cross_boundary() -> None:
            await asyncio.sleep(0)
            finish_room_event.set()
            robot.show("cleaning", current_area="Office")

        hass.async_create_task(cross_boundary(), eager_start=True)

    robot.on_start = send_command
    stop_count = 0

    async def stop_then_settle(token: int, command: UserCommand) -> None:
        nonlocal stop_count
        assert token == 7
        assert command is UserCommand.STOP
        stop_count += 1
        if stop_count == 1:

            async def settle() -> None:
                await asyncio.sleep(0.01)
                robot.show("returning", current_area="Office", low_charge=False)

            hass.async_create_task(settle())
        else:
            # The pre-fix loop sends STOP repeatedly while Office remains the
            # current area. Let it unwind so the assertion reports the defect.
            robot.show("returning", current_area="Office", low_charge=False)

    sender = AsyncMock(side_effect=stop_then_settle)
    completed = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(session_identity=robot.accepting),
        7,
        managed_user_command=sender,
        finish_room_event=finish_room_event,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )

    assert completed is False
    assert stop_count == 1
    sender.assert_awaited_once_with(7, UserCommand.STOP)


async def test_finish_room_threshold_never_rounds_progress_up(hass) -> None:
    """Just-below progress stops now; the exact threshold finishes the room."""
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    await manager.catalog.async_save_plan(
        "serial",
        "away",
        {
            "name": "Away",
            "finish_current_room": True,
            "finish_current_room_threshold": 50,
            "rooms": [],
        },
    )
    for _ in range(3):
        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "away", room)
        await manager.ledger.async_mark_completed(
            "serial", "away", room, duration_seconds=100
        )

    lock = manager.control.lock("serial")
    await lock.acquire()
    try:
        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "away", room)
        active = manager.repository.data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 49.9
        active["active_segment_started"] = None

        assert manager.control.request_stop("serial") == PlanStopDecision(
            "immediate", 49, 50
        )
        assert manager.control.cancellation_event("serial").is_set()

        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "away", room)
        active = manager.repository.data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 50.0
        active["active_segment_started"] = None

        assert manager.control.request_stop("serial") == PlanStopDecision(
            "after_room", 50, 50
        )
        assert manager.control.finish_room_event("serial").is_set()
        assert not manager.control.cancellation_event("serial").is_set()
        assert manager.control.request_stop("serial").behavior == "after_room"
    finally:
        lock.release()


async def test_new_smart_stop_run_shares_one_native_mission(hass) -> None:
    manager = memory_manager(hass)
    manager.repository.robot("serial")["plans"]["away"] = {
        "name": "Away",
        "finish_current_room": True,
        "finish_current_room_threshold": 50,
        "rooms": [],
    }
    rooms = [
        CleaningRoom("room-one", "One", "vacuum", "standard"),
        CleaningRoom("room-two", "Two", "vacuum", "standard"),
    ]
    observed: list[list[CleaningRoom]] = []

    async def complete_leg(*args, **kwargs) -> bool:
        checkpoint = recovery_record(manager)["recovery_checkpoint"]
        assert checkpoint["single_room_missions"] is False
        observed.append(args[5])
        credit_rooms(args, kwargs, args[5])
        return True

    with (
        patch(
            "custom_components.matic_robot.managed_leg._async_run_leg",
            AsyncMock(side_effect=complete_leg),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_settled_leg_handoff",
            AsyncMock(return_value=True),
        ),
    ):
        await _async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            robot=robot_port(
                session_identity=AsyncMock(return_value=b""),
                session_history=AsyncMock(return_value=()),
            ),
            managed_user_command=AsyncMock(),
            floor_is_current=lambda: True,
            floor_token="a" * 64,
        )

    assert observed == [rooms]


async def test_smart_stop_pending_is_public_only_for_owned_run(hass) -> None:
    manager = CleaningPlanManager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    robot = manager.repository.robot("serial")
    robot["last_run"] = {
        "run_id": "run-1",
        "plan_id": "away",
        "outcome": "running",
        "recovery_checkpoint": {"stop_intent": "after_room"},
    }
    robot["active_plan"] = {
        "run_id": "run-1",
        "plan_id": "away",
        "room_id": room.room_id,
        "status": "running",
    }
    manager.control.finish_room_event("serial").set()

    active = manager.history.snapshot("serial")["active_plan"]
    assert active["smart_stop_pending"] is True
    assert active["smart_stop_phase"] == "finishing_room"
    robot["active_plan"]["status"] = "verifying"
    active = manager.history.snapshot("serial")["active_plan"]
    assert active["smart_stop_pending"] is True
    assert active["smart_stop_phase"] == "verifying_completion"
    assert (
        manager.control.request_stop("serial", stop_now=True).behavior == "after_room"
    )
    assert manager.control.finish_room_event("serial").is_set()
    assert not manager.control.cancellation_event("serial").is_set()
    robot["active_plan"]["status"] = "running"
    manager.control.finish_room_event("serial").clear()
    assert (
        manager.control.request_stop("serial", stop_now=True).behavior == "after_room"
    )
    assert not manager.control.cancellation_event("serial").is_set()
    manager.control.finish_room_event("serial").set()
    assert manager.control.request_stop("serial", stop_now=True).behavior == "immediate"
    assert not manager.control.finish_room_event("serial").is_set()
    assert manager.control.cancellation_event("serial").is_set()
    manager.control.cancellation_event("serial").clear()
    manager.control.finish_room_event("serial").set()
    robot["active_plan"] = {
        "run_id": "run-1",
        "plan_id": "away",
        "area_id": "area-rug",
        "status": "running",
    }
    assert manager.history.snapshot("serial")["active_plan"]["smart_stop_phase"] == (
        "finishing_area"
    )
    robot["active_plan"] = None
    active = manager.history.snapshot("serial")["active_plan"]
    assert active["run_id"] == "run-1"
    assert active["smart_stop_pending"] is True
    assert active["smart_stop_phase"] == "returning_to_dock"
    robot["last_run"]["run_id"] = "replacement-run"
    robot["active_plan"] = {
        "run_id": "run-1",
        "plan_id": "away",
        "room_id": room.room_id,
        "status": "running",
    }
    assert (
        manager.history.snapshot("serial")["active_plan"]["smart_stop_pending"] is False
    )
