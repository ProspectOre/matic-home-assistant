"""Synthetic restart ownership and durable-dispatch regression tests."""

import asyncio
import hashlib
from copy import deepcopy
from dataclasses import asdict
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import CoreState, ServiceCall
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import FloorPlan
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    CleaningRoom,
    plan_floor_token,
)
from custom_components.matic_robot.restart import async_recover_managed_run
from custom_components.matic_robot.services import (
    PlanCancelledError,
    RoomRunOutcome,
    _async_completion_budget,
    _async_execute_rooms,
    _async_run_leg,
    _async_wait_for_owned_start,
    _PreparedRoomDispatch,
)


@pytest.fixture
async def recovery_state(hass):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("kitchen", "Kitchen", "vacuum", "standard")
    floor = FloorPlan(42, "partition", b"partition", ())
    identity = b"synthetic-session"
    entity = er.async_get(hass).async_get_or_create("vacuum", DOMAIN, "serial_vacuum")
    hass.states.async_set(entity.entity_id, "cleaning")
    await manager.async_begin_run(
        "serial", "plan", "run", 1, trigger="automation", service="clean_entire_plan"
    )
    await manager.async_mark_started("serial", "plan", room, run_id="run")
    data = {
        "plan_id": "plan",
        "start_timeout": 120,
        "completion_timeout": 21600,
        "return_to_base": False,
    }
    checkpoint = {
        "version": 1,
        "phase": "accepted",
        "leg_index": 0,
        "floor_token": plan_floor_token(floor),
        "rooms": [asdict(room)],
        "entity_id": entity.entity_id,
        "data": data,
        "native_identity_hash": hashlib.sha256(identity).hexdigest(),
        "dispatched_at": dt_util.utcnow().isoformat(),
        "completion_deadline": (
            dt_util.utcnow() + timedelta(seconds=21600)
        ).isoformat(),
        "history_baseline": [],
        "completed_room_ids": [],
        "started_room_ids": [room.room_id],
    }
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    client = SimpleNamespace(
        async_get_cleaning_session_identity=AsyncMock(return_value=identity),
        async_get_cleaning_session_records=AsyncMock(return_value=()),
        async_has_active_cleaning_session=AsyncMock(return_value=True),
        async_send_user_command=AsyncMock(),
        activity_journal=SimpleNamespace(
            set_run_id=MagicMock(), current_run_id=MagicMock()
        ),
    )
    runtime = SimpleNamespace(
        client=client,
        cleaning_plans=manager,
        coordinator=SimpleNamespace(
            data=SimpleNamespace(floor_plan=floor),
            async_request_refresh=AsyncMock(),
            async_confirm_room_completed=MagicMock(),
        ),
        slam_map=SimpleNamespace(floor_plan_is_current=MagicMock(return_value=True)),
    )
    return manager, SimpleNamespace(runtime_data=runtime), checkpoint, room


async def test_recovery_passes_existing_dispatch_and_run_identity(hass, recovery_state):
    manager, entry, _, room = recovery_state

    async def execute(*args, **kwargs):
        assert kwargs["recovery"]["run_id"] == "run"
        assert kwargs["recovered_dispatch"].rooms == (room,)
        assert kwargs["recovered_dispatch"].native_identity == b"synthetic-session"
        assert kwargs["floor_is_current"]()
        await manager.async_finish_run(
            "serial", "run", "completed", "all_rooms_verified", 1
        )

    with patch(
        "custom_components.matic_robot.restart._async_execute_rooms",
        side_effect=execute,
    ) as runner:
        await async_recover_managed_run(hass, entry, "serial")
    runner.assert_awaited_once()
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()
    assert manager.snapshot("serial")["last_run"]["outcome"] == "completed"
    assert manager.snapshot("serial")["active_plan"] is None


@pytest.mark.parametrize(
    "case",
    [
        "valid",
        "bad_index",
        "replacement",
        "timeout",
        "cancel",
        "stop",
        "stop_during_wait",
    ],
)
async def test_handoff_checkpoint_resumes_remaining_legs_after_restart(
    hass, recovery_state, case
):
    """A shutdown during settings handoff resumes the next leg, not the old one."""
    manager, entry, checkpoint, room = recovery_state
    next_room = CleaningRoom("office", "Office", "mop", "standard")
    checkpoint.update(
        {
            "phase": "handoff",
            "leg_index": 0 if case == "bad_index" else 1,
            "rooms": [asdict(room), asdict(next_room)],
            "completed_room_ids": [] if case == "bad_index" else [room.room_id],
            **({"stop_intent": "after_room"} if case == "stop" else {}),
        }
    )
    manager._robot("serial")["last_run"]["room_count"] = 2
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    entry.runtime_data.client.async_get_cleaning_session_identity.return_value = (
        b"replacement" if case == "replacement" else b""
    )
    hass.states.async_set(checkpoint["entity_id"], "idle")

    async def execute(*_args, **kwargs):
        assert kwargs["recovery"]["recovery_checkpoint"]["phase"] == "handoff"
        assert kwargs["recovered_dispatch"] is None
        assert kwargs["handoff_expected_identity"] == b""

    async def wait_for_handoff(*_args, **_kwargs):
        assert _kwargs["finish_room_event"] is manager.finish_room_event("serial")
        if case == "cancel":
            manager.begin_managed_motion("serial")
        if case == "stop_during_wait":
            manager.finish_room_event("serial").set()
        return case != "timeout"

    with (
        patch(
            "custom_components.matic_robot.restart._async_wait_for_settled_leg_handoff",
            AsyncMock(side_effect=wait_for_handoff),
        ) as settled,
        patch(
            "custom_components.matic_robot.restart._async_execute_rooms",
            side_effect=execute,
        ) as runner,
    ):
        await async_recover_managed_run(hass, entry, "serial")

    if case in {"valid", "timeout", "cancel", "stop_during_wait"}:
        settled.assert_awaited_once()
    else:
        settled.assert_not_awaited()
    if case == "valid":
        runner.assert_awaited_once()
    else:
        runner.assert_not_awaited()
    if case == "stop_during_wait":
        assert manager.snapshot("serial")["last_run"]["reason_code"] == "managed_stop"
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize(
    "case",
    [
        "dispatching",
        "starting",
        "no_identity",
        "changed",
        "ended",
        "unknown",
        "floor",
        "history_error",
        "malformed",
        "no_entity",
        "superseded",
        "bad_time",
        "bad_baseline",
        "stop_intent",
        "bad_deadline",
        "naive_deadline",
    ],
)
async def test_ambiguous_recovery_never_dispatches(hass, recovery_state, case):
    manager, entry, checkpoint, _ = recovery_state
    client = entry.runtime_data.client
    if case in {"dispatching", "starting"}:
        checkpoint["phase"] = case
    elif case == "no_identity":
        checkpoint["native_identity_hash"] = None
    elif case in {"changed", "ended", "unknown"}:
        client.async_get_cleaning_session_identity.return_value = {
            "changed": b"another",
            "ended": b"",
            "unknown": None,
        }[case]
    elif case == "floor":
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
    elif case == "history_error":
        client.async_get_cleaning_session_records.side_effect = CannotConnectError(
            "unavailable"
        )
    elif case == "malformed":
        checkpoint["rooms"] = [{"invalid": True}]
    elif case == "no_entity":
        er.async_get(hass).async_remove(checkpoint["entity_id"])
    elif case == "superseded":
        client.async_get_cleaning_session_identity.side_effect = [
            b"synthetic-session",
            b"replacement",
        ]
    elif case == "bad_time":
        checkpoint["dispatched_at"] = "invalid"
    elif case == "bad_baseline":
        checkpoint["history_baseline"] = None
    elif case == "stop_intent":
        checkpoint["stop_intent"] = "immediate"
    elif case == "bad_deadline":
        checkpoint["completion_deadline"] = "invalid"
    elif case == "naive_deadline":
        checkpoint["completion_deadline"] = "2026-01-01T00:00:00"
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    with (
        patch("custom_components.matic_robot.restart.RECOVERY_ATTEMPTS", 1),
        patch(
            "custom_components.matic_robot.restart._async_execute_rooms",
            new_callable=AsyncMock,
        ) as runner,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    runner.assert_not_awaited()
    client.async_send_user_command.assert_not_awaited()
    snapshot = manager.snapshot("serial")
    assert snapshot["last_run"]["outcome"] == (
        "cancelled" if case == "stop_intent" else "unverified"
    )
    assert snapshot["active_plan"] is None
    assert manager.recovery_run("serial") is None


async def test_repeated_shutdown_preserves_checkpoint(hass, recovery_state):
    manager, entry, _, _ = recovery_state
    hass.set_state(CoreState.stopping)
    entry.runtime_data.client.async_get_cleaning_session_identity.side_effect = (
        asyncio.CancelledError
    )
    with pytest.raises(asyncio.CancelledError):
        await async_recover_managed_run(hass, entry, "serial")
    assert manager.recovery_run("serial") is not None


async def test_checkpoint_load_preserves_active_room_and_hides_private_state(
    hass, recovery_state
):
    manager, _, _, room = recovery_state
    saved = deepcopy(manager._data)
    manager._store.async_load = AsyncMock(return_value=saved)
    await manager.async_load()
    snapshot = manager.snapshot("serial")
    assert snapshot["active_plan"]["status"] == "recovering"
    assert "recovery_checkpoint" not in snapshot["last_run"]
    assert snapshot["interrupted_runs"] == 0
    await manager.async_mark_completed("serial", "plan", room, duration_seconds=30)
    await manager.async_mark_completed("serial", "plan", room, duration_seconds=30)
    assert manager.snapshot("serial")["completed_runs"] == 1


async def test_executor_checkpoints_dispatch_and_disables_prefetch(
    hass, recovery_state
):
    manager, _, checkpoint, room = recovery_state
    await manager.async_finish_run("serial", "run", "unverified", "test", 0)
    room2 = CleaningRoom("office", "Office", "mop", "standard")
    seen = []

    async def leg(*args, **kwargs):
        saved = manager.recovery_run("serial")
        assert saved["recovery_checkpoint"]["phase"] == "dispatching"
        assert kwargs["prefetch_next"] is None
        if args[5] == [room]:
            # Model the native leg ending before the next settings boundary;
            # the durable runner must wait for this settled handoff.
            hass.states.async_set(checkpoint["entity_id"], "idle")
            kwargs["on_native_identity"](b"new")
        dispatch = _PreparedRoomDispatch(
            tuple(args[5]),
            frozenset({b"old"}),
            dt_util.utcnow(),
            native_identity=b"new",
        )
        await kwargs["checkpoint_dispatch"](dispatch)
        assert (
            manager.recovery_run("serial")["recovery_checkpoint"]["phase"] == "starting"
        )
        await _async_completion_budget(dispatch, 100, kwargs["checkpoint_dispatch"])
        seen.append(manager.recovery_run("serial")["recovery_checkpoint"])
        for target in args[5]:
            kwargs["record_room_completed"](target)
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_leg", side_effect=leg
    ):
        await _async_execute_rooms(
            hass,
            ServiceCall(hass, DOMAIN, "clean_entire_plan", checkpoint["data"]),
            manager,
            checkpoint["entity_id"],
            "serial",
            [room, room2],
            intelligent=False,
            floor_token=checkpoint["floor_token"],
            session_identity=AsyncMock(return_value=b""),
        )
    assert [value["leg_index"] for value in seen] == [0, 1]
    assert all(
        value["phase"] == "accepted" and value["completion_deadline"] for value in seen
    )
    assert seen[1]["completed_room_ids"] == ["kitchen"]
    assert seen[0]["native_identity_hash"] == hashlib.sha256(b"new").hexdigest()
    assert seen[0]["history_baseline"] == [hashlib.sha256(b"old").hexdigest()]
    assert manager.snapshot("serial")["last_run"]["outcome"] == "completed"


async def test_recovery_retries_then_honors_stop(hass, recovery_state):
    manager, entry, _, _ = recovery_state
    client = entry.runtime_data.client
    client.async_get_cleaning_session_identity.side_effect = CannotConnectError(
        "offline"
    )

    async def stop_after_retry(_):
        assert manager.request_stop("serial").behavior == "immediate"

    with patch(
        "custom_components.matic_robot.restart.asyncio.sleep",
        side_effect=stop_after_retry,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    assert manager.snapshot("serial")["last_run"]["reason_code"] == "managed_stop"
    client.async_send_user_command.assert_not_awaited()


async def test_recovered_command_remains_owned_and_stop_fenced(hass, recovery_state):
    manager, entry, _, _ = recovery_state

    async def execute(*args, **kwargs):
        token = manager.begin_managed_motion("serial")
        await kwargs["managed_user_command"](token, UserCommand.STOP)
        assert manager.stop_pending("serial")
        await manager.async_finish_run("serial", "run", "cancelled", "managed_stop", 0)

    with patch(
        "custom_components.matic_robot.restart._async_execute_rooms",
        side_effect=execute,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    entry.runtime_data.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )


async def test_recovery_storage_ignores_retired_run_and_preserves_stop_intent(
    hass, recovery_state
):
    manager, entry, checkpoint, _ = recovery_state
    await manager.async_set_recovery_checkpoint("serial", "different-run", {})
    assert manager.recovery_run("serial")["recovery_checkpoint"] == checkpoint
    await manager.async_checkpoint_stop_intent("serial", "after_room")
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    assert (
        manager.recovery_run("serial")["recovery_checkpoint"]["stop_intent"]
        == "after_room"
    )
    await manager.async_finish_run("serial", "run", "cancelled", "managed_stop", 0)
    await manager.async_mark_recovery_status("serial", "running", reason="obsolete")
    await async_recover_managed_run(hass, entry, "serial")
    assert manager.recovery_run("serial") is None


async def test_recovery_executor_skips_verified_legs_and_honors_graceful_stop(
    hass, recovery_state
):
    manager, _, checkpoint, room = recovery_state
    first = CleaningRoom("office", "Office", "mop", "standard")
    await manager.async_begin_run(
        "serial", "plan", "run", 2, trigger="automation", service="clean_entire_plan"
    )
    checkpoint.update(
        rooms=[asdict(first), asdict(room)],
        leg_index=1,
        completed_room_ids=[first.room_id],
        stop_intent="after_room",
    )
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    run = manager.recovery_run("serial")
    prepared = _PreparedRoomDispatch(
        (room,), frozenset(), dt_util.utcnow(), native_identity=b"synthetic-session"
    )

    async def leg(*args, **kwargs):
        assert args[5] == [room]
        assert kwargs["prepared_dispatch"] == prepared
        assert kwargs["finish_room_event"].is_set()
        kwargs["record_room_completed"](room)
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_leg", side_effect=leg
    ) as runner:
        await _async_execute_rooms(
            hass,
            ServiceCall(hass, DOMAIN, "clean_entire_plan", checkpoint["data"]),
            manager,
            checkpoint["entity_id"],
            "serial",
            [first, room],
            intelligent=False,
            recovery=run,
            recovered_dispatch=prepared,
        )
    runner.assert_awaited_once()
    assert manager.snapshot("serial")["last_run"]["completed_room_count"] == 2


async def test_new_plan_cannot_replace_pending_recovery(hass, recovery_state):
    manager, _, checkpoint, room = recovery_state
    from homeassistant.exceptions import ServiceValidationError

    with pytest.raises(ServiceValidationError, match="reconnecting"):
        await _async_execute_rooms(
            hass,
            ServiceCall(hass, DOMAIN, "clean_entire_plan", checkpoint["data"]),
            manager,
            checkpoint["entity_id"],
            "serial",
            [room],
            intelligent=False,
        )


@pytest.mark.parametrize("multi", [False, True])
async def test_reattached_leg_checkpoints_without_redispatch_and_suspends(
    hass, recovery_state, multi
):
    manager, _, checkpoint, room = recovery_state
    rooms = (
        [room, CleaningRoom("office", "Office", "vacuum", "standard")]
        if multi
        else [room]
    )
    prepared = _PreparedRoomDispatch(
        tuple(rooms),
        frozenset(),
        dt_util.utcnow(),
        native_identity=None,
    )
    saver = AsyncMock()
    sender = AsyncMock()
    manager._cancellation_reasons["serial"] = "home_assistant_shutdown"

    async def started(*args, **_kwargs):
        args[6](b"synthetic-session")
        return "cleaning"

    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_owned_start",
            AsyncMock(side_effect=started),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_with_native_identity",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        patch(
            "custom_components.matic_robot.services._async_dispatch_leg_command",
            new_callable=AsyncMock,
        ) as dispatch,
        pytest.raises(PlanCancelledError),
    ):
        await _async_run_leg(
            hass,
            ServiceCall(hass, DOMAIN, "clean_entire_plan", checkpoint["data"]),
            manager,
            checkpoint["entity_id"],
            "serial",
            rooms,
            prepared_dispatch=prepared,
            checkpoint_dispatch=saver,
            managed_user_command=sender,
        )
    dispatch.assert_not_awaited()
    sender.assert_not_awaited()
    assert saver.await_count == 3
    assert saver.await_args.args[0].completion_deadline is not None
    assert saver.await_args.args[0].native_identity == b"synthetic-session"
    assert manager.snapshot("serial")["cancelled_runs"] == 0
    assert manager.snapshot("serial")["interrupted_runs"] == 0


async def test_cooperative_shutdown_does_not_finalize(hass, recovery_state):
    manager, _, checkpoint, room = recovery_state
    await manager.async_finish_run("serial", "run", "unverified", "test", 0)
    hass.set_state(CoreState.stopping)
    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        AsyncMock(side_effect=PlanCancelledError),
    ):
        await _async_execute_rooms(
            hass,
            ServiceCall(hass, DOMAIN, "clean_entire_plan", checkpoint["data"]),
            manager,
            checkpoint["entity_id"],
            "serial",
            [room],
            intelligent=False,
        )
    assert manager.snapshot("serial")["last_run"]["outcome"] == "running"


async def test_stop_during_recovery_status_save_wins(hass, recovery_state):
    manager, entry, _, _ = recovery_state

    async def stop(*_args, **_kwargs):
        manager.request_stop("serial")

    with (
        patch.object(manager, "async_mark_recovery_status", side_effect=stop),
        patch(
            "custom_components.matic_robot.restart._async_execute_rooms",
            new_callable=AsyncMock,
        ) as runner,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    runner.assert_not_awaited()
    assert manager.snapshot("serial")["last_run"]["outcome"] == "cancelled"


async def test_verified_credit_retries_failed_persistence_without_duplication(
    hass, recovery_state
):
    manager, _, _, room = recovery_state
    manager._store.async_save.side_effect = [OSError("disk unavailable"), None]
    with pytest.raises(OSError):
        await manager.async_mark_completed("serial", "plan", room, duration_seconds=30)
    await manager.async_mark_completed("serial", "plan", room, duration_seconds=30)
    assert manager._store.async_save.await_count >= 2
    assert manager.snapshot("serial")["completed_runs"] == 1


async def test_restart_after_final_credit_preserves_verified_completion(
    hass, recovery_state
):
    manager, entry, _, room = recovery_state
    events = []
    hass.bus.async_listen("matic_robot_plan_finished", events.append)
    await manager.async_mark_completed("serial", "plan", room, duration_seconds=30)
    entry.runtime_data.client.async_get_cleaning_session_identity.return_value = b""
    with patch(
        "custom_components.matic_robot.restart._async_execute_rooms",
        new_callable=AsyncMock,
    ) as runner:
        await async_recover_managed_run(hass, entry, "serial")
    runner.assert_not_awaited()
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()
    assert manager.snapshot("serial")["last_run"]["outcome"] == "completed"
    assert manager.snapshot("serial")["completed_runs"] == 1
    await hass.async_block_till_done()
    assert events[0].data["room_outcomes"] == [
        {"room_id": room.room_id, "room": room.name, "outcome": "completed"}
    ]


@pytest.mark.parametrize("paused", [False, True])
async def test_reloaded_room_retains_elapsed_and_original_timestamps(
    hass, recovery_state, paused
):
    manager, _, checkpoint, room = recovery_state
    robot = manager._robot("serial")
    active = robot["active_plan"]
    earlier = (dt_util.utcnow() - timedelta(seconds=90)).isoformat()
    active.update(
        started=earlier,
        cleaning_started=earlier,
        active_elapsed_seconds=45,
        active_segment_started=None if paused else earlier,
    )
    persisted = deepcopy(manager._data)
    restored = CleaningPlanManager(hass)
    restored._store = SimpleNamespace(
        async_load=AsyncMock(return_value=persisted), async_save=AsyncMock()
    )
    await restored.async_load()
    await restored.async_mark_recovery_status("serial", "running", reason="test")
    assert not await restored.async_mark_started("serial", "plan", room, run_id="run")
    recovered = restored.snapshot("serial")["active_plan"]
    assert recovered["started"] == earlier
    assert recovered["cleaning_started"] == earlier
    assert recovered["active_elapsed_seconds"] >= (45 if paused else 135)
    await restored.async_set_recovery_checkpoint("serial", "run", checkpoint)
    another = CleaningRoom("office", "Office", "vacuum", "standard")
    assert await restored.async_mark_started("serial", "plan", another, run_id="run")
    await restored.async_set_recovery_checkpoint("serial", "run", checkpoint)
    assert restored.recovery_run("serial")["recovery_checkpoint"][
        "started_room_ids"
    ] == [room.room_id, another.room_id]
    assert not await restored.async_mark_started("serial", "plan", room, run_id="run")


@pytest.mark.parametrize("multi", [False, True])
@pytest.mark.parametrize("provenance", ["user", "automation"])
async def test_startup_rejoins_real_executor_to_completion_without_clean_command(
    hass, recovery_state, multi, provenance
):
    manager, entry, checkpoint, room = recovery_state
    starts = []
    hass.bus.async_listen("matic_robot_room_started", starts.append)
    completions = []
    hass.bus.async_listen("matic_robot_room_completed", completions.append)
    rooms = (
        [room, CleaningRoom("office", "Office", "vacuum", "standard")]
        if multi
        else [room]
    )
    if multi:
        await manager.async_begin_run(
            "serial",
            "plan",
            "run",
            2,
            trigger="automation",
            service="clean_entire_plan",
        )
        checkpoint["rooms"] = [asdict(value) for value in rooms]
        await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
        await manager.async_mark_started("serial", "plan", rooms[1], run_id="run")
    manager._robot("serial")["last_run"]["provenance"] = provenance
    with (
        patch(
            "custom_components.matic_robot.services._async_dispatch_leg_command",
            new_callable=AsyncMock,
        ) as dispatch,
        patch(
            "custom_components.matic_robot.services._async_wait_for_owned_start",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_with_native_identity",
            AsyncMock(
                return_value=(RoomRunOutcome.HANDOFF_CANDIDATE, None)
                if multi
                else RoomRunOutcome.HANDOFF_CANDIDATE
            ),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_active_session_resolution",
            AsyncMock(return_value=False),
        ),
        patch(
            "custom_components.matic_robot.services._async_verify_room_completion",
            AsyncMock(return_value=True),
        ),
        patch(
            "custom_components.matic_robot.services._async_verify_leg_completion",
            AsyncMock(
                return_value={
                    value.room_id: (dt_util.utcnow().isoformat(), 30) for value in rooms
                }
            ),
        ),
    ):
        await async_recover_managed_run(hass, entry, "serial")
    dispatch.assert_not_awaited()
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()
    run = manager.snapshot("serial")["last_run"]
    assert run["run_id"] == "run"
    assert run["outcome"] == "completed"
    assert run["completed_room_count"] == len(rooms)
    assert manager.snapshot("serial")["active_plan"] is None
    await hass.async_block_till_done()
    assert not starts
    assert len(completions) == len(rooms)
    assert all(event.data["provenance"] == provenance for event in completions)
    assert run["provenance"] == provenance


@pytest.mark.parametrize("multi", [False, True])
@pytest.mark.parametrize("handoff_read", [2, 3])
@pytest.mark.parametrize(
    "state,identity,verified",
    [
        ("returning", b"", True),
        ("docked", b"", True),
        ("returning", b"", False),
        ("idle", b"", False),
        ("returning", b"replacement", False),
        ("returning", None, False),
    ],
)
async def test_recovery_handoff_terminal_state_uses_history_not_new_start(
    hass, recovery_state, multi, handoff_read, state, identity, verified
):
    manager, entry, checkpoint, room = recovery_state
    rooms = (
        [room, CleaningRoom("office", "Office", "vacuum", "standard")]
        if multi
        else [room]
    )
    if multi:
        await manager.async_begin_run(
            "serial",
            "plan",
            "run",
            2,
            trigger="automation",
            service="clean_entire_plan",
        )
        checkpoint["rooms"] = [asdict(r) for r in rooms]
        await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    reads = 0

    async def native_identity():
        nonlocal reads
        reads += 1
        if reads == handoff_read:
            hass.states.async_set(checkpoint["entity_id"], state)
        if reads < handoff_read:
            return b"synthetic-session"
        return identity

    entry.runtime_data.client.async_get_cleaning_session_identity.side_effect = (
        native_identity
    )
    with (
        patch(
            "custom_components.matic_robot.services.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
            0,
        ),
        patch(
            "custom_components.matic_robot.services._async_verify_room_completion",
            AsyncMock(return_value=verified),
        ) as room_history,
        patch(
            "custom_components.matic_robot.services._async_verify_leg_completion",
            AsyncMock(
                return_value={
                    r.room_id: (dt_util.utcnow().isoformat(), 30) for r in rooms
                }
                if verified
                else {}
            ),
        ) as leg_history,
        patch(
            "custom_components.matic_robot.services._async_dispatch_leg_command",
            new_callable=AsyncMock,
        ) as dispatch,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    run = manager.snapshot("serial")["last_run"]
    assert run["outcome"] == ("completed" if verified else "unverified")
    history = leg_history if multi else room_history
    if state in {"returning", "docked"} and identity == b"":
        history.assert_awaited_once()
    else:
        history.assert_not_awaited()
    dispatch.assert_not_awaited()
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


async def test_recovered_paused_start_enters_resume_monitor(hass):
    hass.states.async_set("vacuum.matic", "paused")
    assert (
        await _async_wait_for_owned_start(
            hass,
            "vacuum.matic",
            120,
            None,
            [],
            AsyncMock(),
            MagicMock(),
            None,
            b"synthetic",
            already_accepted=True,
        )
        == "paused"
    )
