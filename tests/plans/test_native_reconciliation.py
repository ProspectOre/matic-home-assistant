"""Native completion evidence and its reconciliation with managed runs."""

import asyncio
from contextlib import nullcontext
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    RobotActivity,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_observation import (
    SESSION_HISTORY_ATTEMPTS,
    NativeRoomVerdict,
    _async_adjudicate_room_end,
)
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RoomTakenOverError,
)
from custom_components.matic_robot.native_history import (
    OEM_STOP_RECONCILIATION_SECONDS,
    _reconcile_pending_native_history,
    _record_native_completion,
    _remember_native_reconciliation,
    _validated_native_reconciliation,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import memory_manager, mission_ends, plan_room, run_plan_call
from tests.session_fakes import FakeRobot, run_step


async def test_mark_completed_accepts_native_evidence(hass) -> None:
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    await manager.ledger.async_mark_started("serial", "plan", room)

    await manager.ledger.async_mark_completed(
        "serial",
        "plan",
        room,
        completed_at="2026-08-20T04:16:13+00:00",
        duration_seconds=57,
    )

    snapshot = manager.history.snapshot("serial")
    record = snapshot["plan_history"]["plan"]["rooms"]["room-kitchen"]
    assert record["last_completed"] == "2026-08-20T04:16:13+00:00"
    assert record["last_duration_seconds"] == 57
    assert record["average_duration_seconds"] == 57
    by_room = snapshot["last_completed_by_room"]["room-kitchen"]
    assert by_room["at"] == "2026-08-20T04:16:13+00:00"
    assert snapshot["active_plan"] is None


@pytest.mark.parametrize(
    "save_failure", [None, "io", "cancelled", "concurrent_edit", "replacement"]
)
async def test_pending_native_stop_completion_is_reconciled_on_history_import(
    hass,
    entity_registry,
    save_failure,
) -> None:
    """A native session that finishes after STOP still credits the managed room."""
    manager = memory_manager(hass)
    events = []
    hass.bus.async_listen(f"{DOMAIN}_room_reconciled", events.append)
    entity = entity_registry.async_get_or_create(
        "vacuum", DOMAIN, "serial_vacuum", suggested_object_id="recovered_matic"
    )
    room = plan_room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    dispatched_at = (now - timedelta(seconds=5)).isoformat()
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "synthetic-recovered-run",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )
    await manager.ledger.async_mark_started("serial", "away", room)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at,
            "run_id": "synthetic-recovered-run",
        },
    )
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                room.room_id,
                room.name,
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (1, 0), (1, 1), (0, 1)),
            ),
        ),
    )
    ended_at = (now - timedelta(seconds=1)).isoformat()
    record = CleaningSessionRecord(
        b"new-session",
        CleaningSession(
            (now - timedelta(seconds=10)).isoformat(),
            ended_at,
            9,
            (room.name,),
            ((room.name, 9),),
            True,
            (room.name,),
        ),
    )

    if save_failure is not None:
        before = deepcopy(manager.repository.data)
        error_type = asyncio.CancelledError if save_failure == "cancelled" else OSError

        async def fail_save(data):
            if save_failure == "concurrent_edit":
                manager.repository.robot("serial")["selected_plan"] = "new-selection"
            elif save_failure == "replacement":
                manager.control.replace_managed_motion("serial")
            raise error_type("synthetic reconciliation save")

        manager.repository.store.async_save.side_effect = fail_save
        expected_error = pytest.raises(error_type)
        if save_failure != "cancelled":
            expected_error = pytest.raises(
                error_type, match="synthetic reconciliation save"
            )
        # An owned task crosses asyncio.shield, which may discard the message
        # attached to a Store-originated CancelledError while preserving type.
        with expected_error:
            await manager.ledger.async_import_native_history(
                "serial", floor_plan, [record]
            )
        await hass.async_block_till_done()
        assert events == []
        if save_failure == "concurrent_edit":
            before["robots"]["serial"]["selected_plan"] = "new-selection"
        elif save_failure == "replacement":
            before["robots"]["serial"].pop("pending_native_reconciliation")
        assert manager.repository.data == before
        manager.repository.store.async_save.side_effect = None
    if save_failure == "replacement":
        await manager.ledger.async_import_native_history("serial", floor_plan, [record])
        await hass.async_block_till_done()
        assert manager.history.snapshot("serial")["completed_runs"] == 0
        assert events == []
        return
    assert await manager.ledger.async_import_native_history(
        "serial", floor_plan, [record]
    )
    snapshot = manager.history.snapshot("serial")
    room_record = snapshot["plan_history"]["away"]["rooms"][room.room_id]
    assert room_record["last_result"] == "completed"
    assert room_record["completed_runs"] == 1
    assert room_record["last_duration_seconds"] == 9
    assert snapshot["native_reconciliation_pending"] is False
    await manager.ledger.async_import_native_history("serial", floor_plan, [record])
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["run_id"] == "synthetic-recovered-run"
    assert events[0].data["entity_id"] == entity.entity_id
    assert events[0].data["room_id"] == room.room_id
    assert events[0].data["reason_code"] == "native_reconciled_completion"


async def test_expired_native_reconciliation_is_cleared_without_plan_credit(
    hass,
) -> None:
    """A later same-room OEM clean cannot satisfy an expired managed marker."""
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    await manager.ledger.async_mark_started("serial", "away", room)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        },
    )
    manager.repository.robot("serial")["pending_native_reconciliation"][
        "expires_at"
    ] = (now - timedelta(seconds=1)).isoformat()
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                room.room_id,
                room.name,
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (1, 0), (1, 1), (0, 1)),
            ),
        ),
    )
    unrelated = CleaningSessionRecord(
        b"later-session",
        CleaningSession(
            (now - timedelta(seconds=4)).isoformat(),
            now.isoformat(),
            4,
            (room.name,),
            ((room.name, 4),),
            True,
            (room.name,),
        ),
    )

    assert await manager.ledger.async_import_native_history(
        "serial", floor_plan, [unrelated]
    )
    snapshot = manager.history.snapshot("serial")
    plan_record = snapshot["plan_history"]["away"]["rooms"][room.room_id]
    assert plan_record["last_result"] == "failed"
    assert plan_record.get("completed_runs", 0) == 0
    assert snapshot["native_reconciliation_pending"] is False


async def test_late_native_completion_repairs_terminal_run_summary(hass) -> None:
    """A delayed dock-room completion must not leave the run partially failed."""
    manager = memory_manager(hass)
    first = plan_room("Kitchen", "room-kitchen")
    second = plan_room("Dining Room", "room-dining")
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run-1",
        2,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )
    await manager.ledger.async_mark_started("serial", "away", first)
    await manager.ledger.async_mark_completed("serial", "away", first)
    now = dt_util.utcnow()
    await manager.ledger.async_mark_started("serial", "away", second)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        second,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": second.room_id,
            "room": second.name,
            "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
            "cleaning_mode": second.cleaning_mode,
            "coverage_setting": second.coverage_setting,
            "run_id": "run-1",
        },
    )
    await manager.ledger.async_finish_run(
        "serial", "run-1", "failed", "room_failed", 1, cause="native_result"
    )
    manager.repository.robot("serial")["last_run"]["recovery_checkpoint"] = {
        "completed_room_ids": []
    }
    assert await manager.ledger.async_mark_native_completed(
        "serial",
        "away",
        second,
        dispatched_at=now - timedelta(seconds=5),
        completed_at=now.isoformat(),
        duration_seconds=12,
    )
    snapshot = manager.history.snapshot("serial")
    last_run = snapshot["last_run"]
    reconciled_room = snapshot["plan_history"]["away"]["rooms"][second.room_id]
    assert reconciled_room["cleaning_mode"] == second.cleaning_mode
    assert reconciled_room["coverage_setting"] == second.coverage_setting
    assert last_run["completed_room_count"] == 2
    assert last_run["outcome"] == "completed"
    assert last_run["reason_code"] == "all_rooms_verified"
    (saved,) = manager.history.run_history("serial")
    assert (saved["outcome"], saved["ending"]) == ("finished", "finished")
    assert (
        manager.repository.robot("serial")["run_history"][0]["completed_room_count"]
        == 2
    )
    await manager.ledger.async_finish_run(
        "serial", "run-1", "failed", "partial_native_result", 1, cause="native_result"
    )
    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["completed_room_count"] == 2
    assert last_run["outcome"] == "completed"


async def test_native_completion_guard_paths_and_marker_recovery(hass) -> None:
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=5)
    assert (
        await manager.ledger.async_mark_native_completed(
            "serial", "away", room, dispatched_at=dispatched_at
        )
        is False
    )
    marker = {
        "plan_id": "away",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": dispatched_at.isoformat(),
    }
    await manager.ledger.async_mark_started("serial", "away", room)
    await manager.ledger.async_mark_failed(
        "serial", "away", room, "error", native_reconciliation=marker
    )
    assert (
        await manager.ledger.async_mark_native_completed(
            "serial", "other", room, dispatched_at=dispatched_at
        )
        is False
    )
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is True
    manager.repository.robot("serial")["rotations"]["away"]["rooms"][room.room_id][
        "last_result"
    ] = "completed"
    _remember_native_reconciliation(
        manager.repository.robot("serial"),
        manager.repository.robot("serial")["pending_native_reconciliation"],
    )
    assert (
        await manager.ledger.async_mark_native_completed(
            "serial", "away", room, dispatched_at=dispatched_at
        )
        is False
    )
    await manager.ledger.async_mark_started("serial", "away", room)
    await manager.ledger.async_mark_interrupted(
        "serial", "away", room, "interrupted", native_reconciliation=marker
    )
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is True
    manager.repository.robot("serial")["pending_native_reconciliation"][
        "expires_at"
    ] = (now - timedelta(seconds=1)).isoformat()
    assert (
        await manager.ledger.async_mark_native_completed(
            "serial", "away", room, dispatched_at=dispatched_at
        )
        is False
    )
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is False


async def test_stale_native_watcher_cannot_credit_new_same_room_marker(hass) -> None:
    """A superseded watcher cannot apply old settings to a newer dispatch."""
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager.repository.store = SimpleNamespace(async_save=save)
    current_room = plan_room("Kitchen", "room-kitchen")
    stale_room = replace(current_room, cleaning_mode="vacuum")
    now = dt_util.utcnow()
    stale_dispatch = now - timedelta(minutes=1)
    current_dispatch = now - timedelta(seconds=5)
    await manager.ledger.async_mark_started("serial", "away", current_room)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        current_room,
        "stopped",
        native_reconciliation={
            "plan_id": "away",
            "room_id": current_room.room_id,
            "room": current_room.name,
            "dispatched_at": current_dispatch.isoformat(),
        },
    )
    save.reset_mock()

    assert (
        await manager.ledger.async_mark_native_completed(
            "serial",
            "away",
            stale_room,
            dispatched_at=stale_dispatch,
            completed_at=now.isoformat(),
            duration_seconds=60,
        )
        is False
    )
    record = manager.history.snapshot("serial")["plan_history"]["away"]["rooms"][
        current_room.room_id
    ]
    assert record["last_result"] == "failed"
    assert record["cleaning_mode"] == current_room.cleaning_mode
    assert record.get("completed_runs", 0) == 0
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is True
    save.assert_not_awaited()


@pytest.mark.parametrize(
    "value",
    [
        None,
        {
            "plan_id": "",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "plan_id": "plan",
            "room_id": 1,
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": 1,
            "dispatched_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
            "expires_at": 1,
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
            "expires_at": "not-a-time",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
            "expires_at": "2026-01-01T00:12:00",
        },
    ],
)
def test_native_reconciliation_marker_validation_rejects_bad_shapes(value) -> None:
    assert _validated_native_reconciliation(value) is None


async def test_native_reconciliation_import_rejects_ambiguous_and_invalid_records(
    hass,
) -> None:
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                room.room_id,
                room.name,
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (1, 0), (1, 1), (0, 1)),
            ),
        ),
    )
    pending = {
        "plan_id": "away",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        "expires_at": (
            now + timedelta(seconds=OEM_STOP_RECONCILIATION_SECONDS)
        ).isoformat(),
    }
    robot = manager.repository.robot("serial")
    robot["pending_native_reconciliation"] = pending

    invalid = CleaningSession(None, None, None, (room.name,), (), False)
    malformed_time = CleaningSession(
        None,
        (now - timedelta(seconds=1)).isoformat(),
        1,
        (room.name,),
        ((room.name, 1),),
        True,
        (room.name,),
    )
    wrong_room = CleaningSession(
        (now - timedelta(seconds=10)).isoformat(),
        (now - timedelta(seconds=1)).isoformat(),
        1,
        ("Study",),
        (("Study", 1),),
        True,
        ("Study",),
    )
    missing_completion = CleaningSession(
        (now - timedelta(seconds=10)).isoformat(),
        (now - timedelta(seconds=1)).isoformat(),
        1,
        (room.name,),
        ((room.name, 1),),
        True,
        (),
    )
    for session in (invalid, malformed_time, wrong_room, missing_completion):
        assert not _reconcile_pending_native_history(
            robot, floor_plan, [CleaningSessionRecord(b"candidate", session)]
        )
        robot["pending_native_reconciliation"] = pending

    robot["pending_native_reconciliation"] = {
        **pending,
        "room_id": "missing-room",
    }
    assert not _reconcile_pending_native_history(robot, floor_plan, [])

    _record_native_completion(
        robot,
        "away",
        room,
        completed_at=now.isoformat(),
        duration_seconds=1,
        room_settings=room,
    )


@pytest.mark.parametrize("ownership_current", [True, False])
async def test_new_native_completed_record_credits_only_after_manager_commit(
    ownership_current: bool,
) -> None:
    """A new, overlapping, single-room native success is positive evidence."""
    robot = FakeRobot()
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus, is_stopping=False)
    order: list[str] = []
    manager = SimpleNamespace(
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value=None),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        ledger=SimpleNamespace(
            active_target=MagicMock(return_value=None),
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(
                side_effect=lambda *_args, **_kwargs: (
                    order.append("manager_commit") or ownership_current
                )
            ),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_suspended=AsyncMock(),
            async_mark_resumed=AsyncMock(),
        ),
        recovery=SimpleNamespace(coverage_receipt=MagicMock(return_value=None)),
    )
    now = dt_util.utcnow()
    old = CleaningSessionRecord(
        b"old-key",
        CleaningSession(
            (now - timedelta(hours=2)).isoformat(),
            (now - timedelta(hours=1)).isoformat(),
            60,
            ("Kitchen",),
            (("Kitchen", 60),),
            True,
        ),
    )
    history_reads = 0

    async def history(**_: object) -> tuple[CleaningSessionRecord, ...]:
        nonlocal history_reads
        history_reads += 1
        if history_reads == 1:
            return (old,)
        ended = dt_util.utcnow()
        new = CleaningSessionRecord(
            robot.history_key(),
            CleaningSession(
                (ended - timedelta(seconds=5)).isoformat(),
                ended.isoformat(),
                5,
                ("Kitchen",),
                (("Kitchen", 5),),
                True,
            ),
        )
        return (old, new)

    confirm = MagicMock(side_effect=lambda *_args: order.append("tracker_confirm"))
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
        if ownership_current:
            await _async_run_leg(
                hass,
                run_plan_call(hass),
                manager,
                "vacuum.matic",
                "serial",
                [plan_room("Kitchen", "room-kitchen")],
                robot.port(
                    session_history=history,
                    confirm_room_completed=confirm,
                    session_identity=robot.accepting,
                ),
                7,
                floor_token="floor",
                checkpoint_dispatch=AsyncMock(),
                advance=run_step,
            )
        else:
            with pytest.raises(PlanCancelledError, match="ownership changed"):
                await _async_run_leg(
                    hass,
                    run_plan_call(hass),
                    manager,
                    "vacuum.matic",
                    "serial",
                    [plan_room("Kitchen", "room-kitchen")],
                    robot.port(
                        session_history=history,
                        confirm_room_completed=confirm,
                        session_identity=robot.accepting,
                    ),
                    7,
                    floor_token="floor",
                    checkpoint_dispatch=AsyncMock(),
                    advance=run_step,
                )

    manager.ledger.async_mark_verifying.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_awaited_once()
    manager.ledger.async_mark_ended_unverified.assert_not_awaited()
    if ownership_current:
        assert order == ["manager_commit", "tracker_confirm"]
        assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_completed"
    else:
        assert order == ["manager_commit"]
        confirm.assert_not_called()
        assert all(
            call.args[0] != "matic_robot_room_completed"
            for call in bus.async_fire.call_args_list
        )


async def test_native_completion_evidence_fails_closed_on_errors_and_ambiguity() -> (
    None
):
    robot = FakeRobot()
    room = plan_room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()

    async def failing_reader(**_: object) -> tuple[CleaningSessionRecord, ...]:
        raise MaticError("synthetic unavailable")

    assert await robot.port(session_history=failing_reader).history_keys() is None
    assert (
        await _async_adjudicate_room_end(
            failing_reader, frozenset(), room, now, robot=robot.port()
        )
        is NativeRoomVerdict.UNVERIFIED
    )

    def record(
        key: bytes,
        started: str | None,
        ended: str | None,
        *,
        completed: bool = True,
        room_name: str = "Kitchen",
        duration: int = 10,
    ) -> CleaningSessionRecord:
        return CleaningSessionRecord(
            key,
            CleaningSession(
                started,
                ended,
                duration,
                (room_name,),
                ((room_name, duration),),
                completed,
            ),
        )

    invalid = record(b"invalid", "bad", "also-bad")
    old = record(
        b"old",
        (now - timedelta(hours=3)).isoformat(),
        (now - timedelta(hours=2)).isoformat(),
    )
    valid_one = record(
        b"one",
        (now - timedelta(seconds=5)).isoformat(),
        now.isoformat(),
    )
    valid_two = record(
        b"two",
        (now - timedelta(seconds=4)).isoformat(),
        now.isoformat(),
    )
    reader = AsyncMock(side_effect=[(invalid, old), (valid_one, valid_two)])
    with patch(
        "custom_components.matic_robot.managed_executor.asyncio.sleep", AsyncMock()
    ):
        assert (
            await _async_adjudicate_room_end(
                reader, frozenset(), room, now, robot=robot.port()
            )
            is NativeRoomVerdict.UNVERIFIED
        )

    interrupted = record(
        b"interrupted",
        (now - timedelta(seconds=5)).isoformat(),
        now.isoformat(),
        completed=False,
    )
    interrupted_reader = AsyncMock(return_value=(interrupted,))
    with patch(
        "custom_components.matic_robot.managed_executor.asyncio.sleep", AsyncMock()
    ):
        assert (
            await _async_adjudicate_room_end(
                interrupted_reader, frozenset(), room, now, robot=robot.port()
            )
            is NativeRoomVerdict.UNVERIFIED
        )

    empty = AsyncMock(return_value=())
    with patch(
        "custom_components.matic_robot.managed_executor.asyncio.sleep", AsyncMock()
    ):
        assert (
            await _async_adjudicate_room_end(
                empty, frozenset(), room, now, robot=robot.port()
            )
            is NativeRoomVerdict.UNVERIFIED
        )
    assert empty.await_count == SESSION_HISTORY_ATTEMPTS

    cancel_event = asyncio.Event()

    async def cancel_during_retry(**_: object) -> tuple[CleaningSessionRecord, ...]:
        asyncio.get_running_loop().call_soon(cancel_event.set)
        return ()

    with (
        patch(
            "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
            1,
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_adjudicate_room_end(
            cancel_during_retry,
            frozenset(),
            room,
            now,
            robot=robot.port(),
            cancel_event=cancel_event,
        )

    unset_cancel = asyncio.Event()
    with patch(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    ):
        assert (
            await _async_adjudicate_room_end(
                empty,
                frozenset(),
                room,
                now,
                robot=robot.port(),
                cancel_event=unset_cancel,
            )
            is NativeRoomVerdict.UNVERIFIED
        )

    already_cancelled = asyncio.Event()
    already_cancelled.set()
    with pytest.raises(PlanCancelledError):
        await _async_adjudicate_room_end(
            empty,
            frozenset(),
            room,
            now,
            robot=robot.port(),
            cancel_event=already_cancelled,
        )

    robot.show("cleaning")
    with pytest.raises(RoomTakenOverError):
        await _async_adjudicate_room_end(
            empty, frozenset(), room, now, robot=robot.port()
        )
