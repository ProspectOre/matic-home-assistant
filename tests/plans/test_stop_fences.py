"""Stop fences: the robot's own stop, docking and their persisted markers."""

import asyncio
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.const import EVENT_PLAN_DOCKED, EVENT_PLAN_FINISHED
from custom_components.matic_robot.managed_executor import (
    _async_execute_rooms,
    async_finish_plan_run,
)
from custom_components.matic_robot.managed_run import RoomStoppedInPlaceError
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import memory_manager, plan_room, run_plan_call
from tests.session_fakes import robot_port


async def test_native_stop_in_place_is_a_controlled_partial_run(hass) -> None:
    """A stopped native task never credits a room or fails the automation."""
    manager = memory_manager(hass)
    events = []
    hass.bus.async_listen(EVENT_PLAN_FINISHED, events.append)

    async def stopped_leg(*_args, **_kwargs):
        cause = RoomStoppedInPlaceError("Kitchen ended in place")
        raise ServiceValidationError("room interrupted") from cause

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg",
        AsyncMock(side_effect=stopped_leg),
    ):
        await _async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Kitchen", "room-kitchen")],
            floor_token="floor",
            robot=robot_port(),
        )

    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "unverified"
    assert last_run["reason_code"] == "stopped_in_place"
    assert last_run["completed_room_count"] == 0
    await hass.async_block_till_done()
    assert events[0].data["cause"] == "unknown"
    assert events[0].data["completed_room_count"] == 0


async def test_docked_stop_upgrades_only_after_correlated_final_command(hass) -> None:
    """A stop is not reported docked until the watcher confirms DOCK."""
    manager = memory_manager(hass)
    events = []
    hass.bus.async_listen(EVENT_PLAN_DOCKED, events.append)
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run-1",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )
    assert manager.ledger.active_run_id("serial") == "run-1"
    assert manager.ledger.active_run_id("missing") is None
    await manager.ledger.async_finish_run(
        "serial",
        "run-1",
        "cancelled",
        "managed_stop",
        0,
        terminal_activity="cleaning",
    )
    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "cancelled"
    assert not await manager.ledger.async_mark_run_docked("serial", "wrong-run")

    assert await manager.ledger.async_mark_run_docked(
        "serial", "run-1", entity_id="vacuum.matic"
    )
    await hass.async_block_till_done()
    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "stopped_docked"
    assert last_run["terminal_activity"] == "docked"
    assert events[0].data["run_id"] == "run-1"
    assert events[0].data["outcome"] == "stopped_docked"
    assert not await manager.ledger.async_mark_run_docked("serial", "run-1")


async def test_dock_closure_follows_the_runs_plan_finished(hass) -> None:
    """A dock seen while the run still runs closes it only after plan_finished."""
    manager = memory_manager(hass)
    order: list[str] = []
    for event_type in (EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED):
        hass.bus.async_listen(
            event_type, callback(lambda e: order.append(e.event_type))
        )
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run-1",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )

    closure = hass.async_create_task(
        manager.ledger.async_mark_run_docked("serial", "run-1")
    )
    await asyncio.sleep(0)
    assert not closure.done()
    assert manager.ledger.run_record("serial", "run-1")["outcome"] == "running"

    await async_finish_plan_run(
        hass,
        manager,
        "serial",
        "vacuum.matic",
        {"plan_id": "away", "run_id": "run-1"},
        "cancelled",
        "managed_stop",
        "managed_cancellation",
        0,
    )
    assert await closure
    await hass.async_block_till_done()
    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "stopped_docked"
    assert last_run["terminal_activity"] == "docked"
    assert order == [EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED]


async def test_correlated_dock_clears_its_owned_stop_fence(hass) -> None:
    """A confirmed dock closes the run and its matching stop fence together."""
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run-1",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )
    await manager.ledger.async_finish_run(
        "serial",
        "run-1",
        "cancelled",
        "managed_stop",
        0,
        terminal_activity="cleaning",
    )
    await manager.control.async_mark_stop_pending("serial", run_id="run-1")
    stop_fence_token = manager.control.stop_fence_token("serial")

    assert stop_fence_token is not None
    assert await manager.ledger.async_mark_run_docked(
        "serial", "run-1", stop_fence_token=stop_fence_token
    )

    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "stopped_docked"
    assert not manager.control.stop_pending("serial")
    assert "stop_fence_expires_at" not in manager.repository.robot("serial")


async def test_stale_dock_confirmation_preserves_newer_stop_fence(hass) -> None:
    """A prior dock watcher cannot clear a later STOP for the same run."""
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run-1",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )
    await manager.ledger.async_finish_run(
        "serial",
        "run-1",
        "cancelled",
        "managed_stop",
        0,
        terminal_activity="cleaning",
    )
    with patch(
        "custom_components.matic_robot.run_control.monotonic",
        return_value=10_000_000_000.0,
    ):
        await manager.control.async_mark_stop_pending("serial", run_id="run-1")
        stale_token = manager.control.stop_fence_token("serial")
        await manager.control.async_mark_stop_pending("serial", run_id="run-1")
        current_token = manager.control.stop_fence_token("serial")

    assert stale_token is not None
    assert current_token is not None
    assert current_token != stale_token
    assert not await manager.ledger.async_mark_run_docked(
        "serial", "run-1", stop_fence_token=stale_token
    )

    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "cancelled"
    assert manager.control.stop_fence_token("serial") == current_token
    assert manager.repository.robot("serial")["stop_fence_run_id"] == "run-1"


async def test_stop_fence_clear_requires_current_token_and_owner(hass) -> None:
    manager = memory_manager(hass)
    await manager.control.async_mark_stop_pending("serial", run_id="run-1")
    first_token = manager.control.stop_fence_token("serial")
    assert first_token is not None

    assert not await manager.control.async_clear_stop_pending_if_token(
        "serial", first_token, run_id=None
    )
    assert manager.control.stop_pending("serial")

    with patch(
        "custom_components.matic_robot.run_control.monotonic",
        return_value=10_000_000_000.0,
    ):
        await manager.control.async_mark_stop_pending("serial", run_id="run-1")
        current_token = manager.control.stop_fence_token("serial")
    assert current_token is not None and current_token != first_token
    assert not await manager.control.async_clear_stop_pending_if_token(
        "serial", first_token, run_id="run-1"
    )
    assert manager.control.stop_fence_token("serial") == current_token
    assert await manager.control.async_clear_stop_pending_if_token(
        "serial", current_token, run_id="run-1"
    )
    assert not manager.control.stop_pending("serial")


def test_stop_fence_restore_extends_deadline_without_changing_identity(hass) -> None:
    manager = CleaningPlanManager(hass)
    with patch(
        "custom_components.matic_robot.run_control.monotonic",
        side_effect=[100.0, 105.0, 105.0, 105.0, 105.0],
    ):
        manager.control.arm_stop_pending("serial", 10)
        token = manager.control.stop_fence_token("serial")
        manager.control.arm_stop_pending("serial", 2)
        manager.control.arm_stop_pending("serial", 10)
        restored_token = manager.control.stop_fence_token("serial")

    assert manager.control.actor("serial").stop_fence.deadline == 115.0
    assert restored_token == token


async def test_immediate_stop_records_managed_stop_reason(hass) -> None:
    """The default stop policy is distinguishable from motion replacement."""
    manager = memory_manager(hass)
    manager.repository.robot("serial")["active_plan"] = {"plan_id": "away"}
    await manager.control.lock("serial").acquire()
    try:
        generation = manager.control.motion_generation("serial")
        decision = manager.control.request_stop("serial")
        assert decision.behavior == "immediate"
        assert manager.control.motion_generation("serial") == generation + 1
        assert manager.control.cancellation_reason("serial") == "managed_stop"
    finally:
        manager.control.lock("serial").release()


def test_stop_dispatch_reservation_is_generation_scoped(hass) -> None:
    """An older Stop cannot release a reservation created by a newer Stop."""
    manager = CleaningPlanManager(hass)
    assert not manager.control.stop_dispatch_pending("serial")

    manager.control.reserve_stop_dispatch(
        "serial", expected_generation=1, expected_stop_generation=1
    )
    assert manager.control.stop_dispatch_pending("serial")

    manager.control.reserve_stop_dispatch(
        "serial", expected_generation=2, expected_stop_generation=2
    )
    manager.control.release_stop_dispatch(
        "serial", expected_generation=1, expected_stop_generation=1
    )
    assert manager.control.stop_dispatch_pending("serial")

    manager.control.release_stop_dispatch(
        "serial", expected_generation=2, expected_stop_generation=2
    )
    assert not manager.control.stop_dispatch_pending("serial")


def test_oem_stop_fence_expires_only_after_settle_window(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.control.mark_stop_pending("serial")
    assert manager.control.stop_pending("serial") is True
    manager.control.clear_stop_pending("serial")
    assert manager.control.stop_pending("serial") is False


def test_oem_stop_fence_expiry_is_self_cleaning(hass) -> None:
    manager = CleaningPlanManager(hass)
    with patch(
        "custom_components.matic_robot.run_control.monotonic", side_effect=[0, 720]
    ):
        manager.control.mark_stop_pending("serial")
        assert manager.control.stop_pending("serial") is False


async def test_plan_load_restores_pending_stop_and_removes_bad_marker(hass) -> None:
    now_value = dt_util.utcnow()
    now = now_value.isoformat()
    valid = {
        "plan_id": "away",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": now,
        "expires_at": (now_value + timedelta(seconds=30)).isoformat(),
    }
    stored = {
        "robots": {
            "serial": {"pending_native_reconciliation": valid},
            "other": {"pending_native_reconciliation": {"plan_id": 1}},
            "generic": {
                "stop_fence_expires_at": (now_value + timedelta(seconds=45)).isoformat()
            },
            "bad-fence": {"stop_fence_expires_at": "not-a-timestamp"},
            "stale-fence": {
                "stop_fence_expires_at": (now_value - timedelta(seconds=1)).isoformat()
            },
            "stale": {
                "pending_native_reconciliation": {
                    **valid,
                    "expires_at": (now_value - timedelta(seconds=1)).isoformat(),
                }
            },
        }
    }
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    with (
        patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=now_value,
        ),
        patch(
            "custom_components.matic_robot.run_control.monotonic", return_value=100.0
        ),
    ):
        await manager.async_load()
        assert manager.control.stop_pending("serial") is True
        assert manager.control.actor("serial").stop_fence.deadline == 130.0
        assert (
            manager.repository.robot("serial")["stop_fence_expires_at"]
            == valid["expires_at"]
        )
        assert manager.control.stop_pending("generic") is True
        assert manager.control.actor("generic").stop_fence.deadline == 145.0
        assert "stop_fence_expires_at" not in manager.repository.robot("bad-fence")
        assert "stop_fence_expires_at" not in manager.repository.robot("stale-fence")
        assert "pending_native_reconciliation" not in manager.repository.robot("other")
        assert "pending_native_reconciliation" not in manager.repository.robot("stale")
        assert manager.control.stop_pending("stale") is False
    manager.repository.store.async_load.assert_awaited_once()
    manager.repository.store.async_save.assert_awaited_once()


async def test_dock_closure_waits_for_plan_finished_after_the_end_is_stored(
    hass,
) -> None:
    """A dock seen after the end is stored but before plan_finished still follows it."""
    manager = memory_manager(hass)
    order: list[str] = []
    for event_type in (EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED):
        hass.bus.async_listen(
            event_type, callback(lambda e: order.append(e.event_type))
        )
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run-1",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )
    finish_run = manager.ledger.async_finish_run
    closures: list[asyncio.Task[bool]] = []

    async def finish_then_dock(*args, **kwargs) -> None:
        await finish_run(*args, **kwargs)
        closures.append(
            hass.async_create_task(
                manager.ledger.async_mark_run_docked("serial", "run-1")
            )
        )

    manager.ledger.async_finish_run = finish_then_dock
    await async_finish_plan_run(
        hass,
        manager,
        "serial",
        "vacuum.matic",
        {"plan_id": "away", "run_id": "run-1"},
        "cancelled",
        "managed_stop",
        "managed_cancellation",
        0,
    )
    assert await closures[0]
    await hass.async_block_till_done()
    assert order == [EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED]


async def test_dock_closure_is_released_when_the_finalizer_is_cancelled(
    hass,
) -> None:
    """A second cancel on the finalizer's yield still announces, then closes."""
    manager = memory_manager(hass)
    order: list[str] = []
    for event_type in (EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED):
        hass.bus.async_listen(
            event_type, callback(lambda e: order.append(e.event_type))
        )
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run-1",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )
    closure = hass.async_create_task(
        manager.ledger.async_mark_run_docked("serial", "run-1")
    )
    finish_run = manager.ledger.async_finish_run

    async def finish_then_cancel(*args, **kwargs) -> None:
        await finish_run(*args, **kwargs)
        finalizer.cancel()

    manager.ledger.async_finish_run = finish_then_cancel
    finalizer = hass.async_create_task(
        async_finish_plan_run(
            hass,
            manager,
            "serial",
            "vacuum.matic",
            {"plan_id": "away", "run_id": "run-1"},
            "cancelled",
            "managed_stop",
            "managed_cancellation",
            0,
        )
    )
    with pytest.raises(asyncio.CancelledError):
        await finalizer
    assert await asyncio.wait_for(closure, 1)
    await hass.async_block_till_done()
    assert order == [EVENT_PLAN_FINISHED, EVENT_PLAN_DOCKED]


async def _finish(hass, manager, outcome: str, reason_code: str) -> None:
    await async_finish_plan_run(
        hass,
        manager,
        "serial",
        "vacuum.matic",
        {"plan_id": "away", "run_id": "run-1"},
        outcome,
        reason_code,
        "managed_cancellation",
        0,
    )


async def _begin(manager) -> None:
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run-1",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )


@pytest.mark.parametrize(
    ("outcome", "reason_code", "fenced"),
    [
        ("completed", "all_rooms_verified", False),
        ("failed", "robot_error", False),
        ("failed", "robot_error", True),
    ],
)
async def test_dock_closure_keeps_the_end_a_live_run_reached(
    hass, outcome: str, reason_code: str, fenced: bool
) -> None:
    """A dock seen while the run ran never overwrites how the run ended."""
    manager = memory_manager(hass)
    await _begin(manager)
    token = None
    if fenced:
        await manager.control.async_mark_stop_pending("serial", run_id="run-1")
        token = manager.control.stop_fence_token("serial")
    closure = hass.async_create_task(
        manager.ledger.async_mark_run_docked("serial", "run-1", stop_fence_token=token)
    )
    await asyncio.sleep(0)
    assert not closure.done()

    await _finish(hass, manager, outcome, reason_code)

    assert await closure is fenced
    assert manager.ledger.run_record("serial", "run-1")["outcome"] == outcome
    assert manager.control.stop_fence_token("serial") is None


async def test_dock_closure_does_not_wait_when_the_end_failed_to_save(
    hass,
) -> None:
    """An announced run whose record still reads running releases its closure."""
    manager = memory_manager(hass)
    await _begin(manager)
    manager.ledger.async_finish_run = AsyncMock()
    await _finish(hass, manager, "cancelled", "managed_stop")
    assert manager.ledger.run_record("serial", "run-1")["outcome"] == "running"

    closing = manager.ledger.async_mark_run_docked("serial", "run-1")
    assert not await asyncio.wait_for(closing, 1)


async def test_a_cancelled_dock_closure_leaves_the_others_waiting(hass) -> None:
    """Cancelling one waiter neither cancels the shared end nor breaks the finalizer."""
    manager = memory_manager(hass)
    await _begin(manager)
    first, second = (
        hass.async_create_task(manager.ledger.async_mark_run_docked("serial", "run-1"))
        for _ in range(2)
    )
    await asyncio.sleep(0)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first

    await _finish(hass, manager, "cancelled", "managed_stop")

    assert await asyncio.wait_for(second, 1)
