"""Safety gates for grouped late-history watchers and marker creation."""

from __future__ import annotations

import asyncio
import struct
from contextlib import asynccontextmanager, nullcontext
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.core import Context, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.managed_observation as managed_observation_module
import custom_components.matic_robot.managed_reconciliation as reconciliation_module
from custom_components.matic_robot.client.commands import _wrapped_uuid
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_reconciliation import (
    _async_reconcile_grouped_history,
)
from custom_components.matic_robot.managed_run import (
    RoomInterruptedError,
    RoomRunOutcome,
    _PreparedRoomDispatch,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from tests.wire_builders import _field


def _active_identity() -> bytes:
    session = _field(2, _wrapped_uuid("7f9d3337-4935-4d30-98f3-f38af88cc147"))
    mission = b"\x15" + struct.pack("<I", 1)
    return _field(1, mission) + _field(2, session)


def _dispatch(rooms: tuple[CleaningRoom, ...]) -> _PreparedRoomDispatch:
    return _PreparedRoomDispatch(
        rooms,
        frozenset({b"old-session"}),
        dt_util.utcnow() - timedelta(seconds=5),
        native_identity=_active_identity(),
    )


def _marker() -> dict[str, object]:
    return {
        "plan_id": "weekly",
        "room_id": "kitchen",
        "room": "Kitchen",
        "run_id": "run-1",
        "dispatched_at": dt_util.utcnow().isoformat(),
        "session_hash": "a" * 64,
        "floor_token": "b" * 64,
        "rooms": [],
    }


async def _run_interrupted_leg(hass, monkeypatch, *, owns_motion: bool):
    rooms = (
        CleaningRoom("kitchen", "Kitchen", "vacuum", "quick"),
        CleaningRoom("study", "Study", "vacuum", "quick"),
    )
    run_id = "run-1"
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            snapshot=MagicMock(return_value={}),
            async_mark_started=AsyncMock(return_value=True),
            async_mark_resumed=AsyncMock(),
            async_mark_interrupted=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            skipped_room_ids=MagicMock(return_value=frozenset()),
        ),
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value=None),
            managed_reconciliation=lambda *_args: nullcontext(True),
            register_reconciliation_task=MagicMock(),
            managed_motion_is_current=MagicMock(return_value=owns_motion),
        ),
    )
    if not owns_motion:

        @asynccontextmanager
        async def lost_guard(*_args, **_kwargs):
            yield False

        manager.control.managed_reconciliation = lost_guard
    identity = _active_identity()
    first_outcome = True

    async def wait_for_outcome(*_args, **_kwargs):
        nonlocal first_outcome
        if first_outcome:
            first_outcome = False
            raise RoomInterruptedError("Native identity changed")
        return RoomRunOutcome.HANDOFF_CANDIDATE, None

    monkeypatch.setattr(
        managed_observation_module,
        "_async_wait_for_owned_start",
        AsyncMock(return_value="cleaning"),
    )
    scheduled = MagicMock()
    monkeypatch.setattr(
        reconciliation_module,
        "_schedule_grouped_native_reconciliation",
        scheduled,
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        {"plan_id": "weekly", "completion_timeout": 10, "start_timeout": 2},
        context=Context(),
    )
    task = asyncio.create_task(
        _async_run_leg(
            hass,
            call,
            manager,
            "vacuum.test",
            "serial",
            rooms,
            motion_token=9,
            prepared_dispatch=_dispatch(rooms),
            session_identity=AsyncMock(return_value=identity),
            run_id=run_id,
            wait_for_leg_outcome=wait_for_outcome,
            floor_token="b" * 64,
        )
    )
    return task, manager, scheduled


@pytest.mark.parametrize("owns_motion", [True, False])
async def test_interrupted_group_only_schedules_while_ownership_is_current(
    hass, monkeypatch, owns_motion
) -> None:
    task, manager, scheduled = await _run_interrupted_leg(
        hass, monkeypatch, owns_motion=owns_motion
    )
    with pytest.raises(HomeAssistantError):
        await task

    assert manager.ledger.async_mark_interrupted.await_count == 1
    kwargs = manager.ledger.async_mark_interrupted.await_args.kwargs
    if owns_motion:
        assert "native_reconciliation" in kwargs
        assert [
            room["room_id"] for room in kwargs["native_reconciliation"]["rooms"]
        ] == ["kitchen"]
        scheduled.assert_called_once()
    else:
        assert "native_reconciliation" not in kwargs
        scheduled.assert_not_called()


async def test_unverified_group_does_not_save_marker_after_floor_changes(
    hass, monkeypatch
) -> None:
    rooms = (
        CleaningRoom("kitchen", "Kitchen", "vacuum", "quick"),
        CleaningRoom("study", "Study", "vacuum", "quick"),
    )
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            snapshot=MagicMock(return_value={}),
            async_mark_started=AsyncMock(return_value=True),
            async_mark_resumed=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            skipped_room_ids=MagicMock(return_value=frozenset()),
            coverage_receipt=MagicMock(return_value=None),
        ),
        control=SimpleNamespace(
            cancellation_reason=MagicMock(return_value=None),
            managed_reconciliation=lambda *_args: nullcontext(True),
            register_reconciliation_task=MagicMock(),
            managed_motion_is_current=MagicMock(return_value=True),
        ),
    )
    monkeypatch.setattr(
        managed_observation_module,
        "_async_wait_for_owned_start",
        AsyncMock(return_value="cleaning"),
    )
    monkeypatch.setattr(
        managed_observation_module,
        "_async_verify_leg_completion",
        AsyncMock(return_value=None),
    )
    outcomes = iter(
        [
            (RoomRunOutcome.HANDOFF_CANDIDATE, None),
            (RoomRunOutcome.ROOM_CHANGED, rooms[1]),
            (RoomRunOutcome.HANDOFF_CANDIDATE, None),
        ]
    )

    async def next_outcome(*_args, **_kwargs):
        return next(outcomes)

    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        {"plan_id": "weekly", "completion_timeout": 10, "start_timeout": 2},
        context=Context(),
    )
    finished = await _async_run_leg(
        hass,
        call,
        manager,
        "vacuum.test",
        "serial",
        rooms,
        motion_token=9,
        prepared_dispatch=_dispatch(rooms),
        run_id="run-1",
        wait_for_leg_outcome=next_outcome,
        floor_is_current=lambda: False,
        floor_token="b" * 64,
    )

    assert not finished
    assert manager.ledger.async_mark_ended_unverified.await_count == 2
    assert all(
        "native_reconciliation" not in invocation.kwargs
        for invocation in manager.ledger.async_mark_ended_unverified.await_args_list
    )


@pytest.mark.parametrize("failure", ["read", "floor"])
async def test_grouped_watcher_tolerates_history_and_map_failures(
    hass, monkeypatch, failure
) -> None:
    marker = _marker()
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            snapshot=MagicMock(return_value={}),
            pending_native_reconciliation=MagicMock(return_value=marker),
            async_import_native_history=AsyncMock(),
            async_clear_native_reconciliation=AsyncMock(),
        )
    )
    hass.states.async_set("vacuum.test", "cleaning")
    reads = AsyncMock(side_effect=MaticError("temporarily unavailable"))
    if failure == "floor":
        reads = AsyncMock(return_value=())
        monkeypatch.setattr(
            reconciliation_module,
            "current_entity_floor_plan",
            MagicMock(side_effect=HomeAssistantError("map changed")),
        )
    else:
        monkeypatch.setattr(
            reconciliation_module,
            "current_entity_floor_plan",
            MagicMock(),
        )
    monkeypatch.setattr(reconciliation_module, "OEM_STOP_RECONCILIATION_SECONDS", 1)
    monkeypatch.setattr(
        reconciliation_module, "OEM_STOP_RECONCILIATION_POLL_SECONDS", 0
    )
    clocks = iter([0.0, 0.0, 0.0, 2.0])
    monkeypatch.setattr(reconciliation_module, "monotonic", lambda: next(clocks))

    await _async_reconcile_grouped_history(
        hass, manager, "serial", "vacuum.test", marker, reads, None
    )

    if failure == "floor":
        manager.ledger.async_import_native_history.assert_not_awaited()
    manager.ledger.async_clear_native_reconciliation.assert_awaited_once_with(
        "serial",
        marker["plan_id"],
        marker["room_id"],
        dt_util.parse_datetime(marker["dispatched_at"]),
    )


async def test_grouped_watcher_stops_when_marker_is_replaced(hass, monkeypatch) -> None:
    marker = _marker()
    replacement = {**marker, "run_id": "new-run"}
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            snapshot=MagicMock(return_value={}),
            pending_native_reconciliation=MagicMock(side_effect=[marker, replacement]),
            async_import_native_history=AsyncMock(),
            async_clear_native_reconciliation=AsyncMock(),
        )
    )
    hass.states.async_set("vacuum.test", "cleaning")
    monkeypatch.setattr(reconciliation_module, "monotonic", lambda: 0.0)

    await _async_reconcile_grouped_history(
        hass, manager, "serial", "vacuum.test", marker, None, None
    )

    manager.ledger.async_import_native_history.assert_not_awaited()
    manager.ledger.async_clear_native_reconciliation.assert_not_awaited()


async def test_grouped_watcher_abandons_marker_when_robot_is_idle(
    hass, monkeypatch
) -> None:
    marker = _marker()
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            snapshot=MagicMock(return_value={}),
            pending_native_reconciliation=MagicMock(return_value=marker),
            async_import_native_history=AsyncMock(),
            async_clear_native_reconciliation=AsyncMock(),
        )
    )
    hass.states.async_set("vacuum.test", "idle")
    monkeypatch.setattr(reconciliation_module, "monotonic", lambda: 0.0)

    await _async_reconcile_grouped_history(
        hass, manager, "serial", "vacuum.test", marker, AsyncMock(), None
    )

    manager.ledger.async_import_native_history.assert_not_awaited()
    manager.ledger.async_clear_native_reconciliation.assert_awaited_once()
