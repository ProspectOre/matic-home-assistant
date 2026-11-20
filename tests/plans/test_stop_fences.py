"""Stop fences: the robot's own stop, docking and their persisted markers."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.const import EVENT_PLAN_DOCKED, EVENT_PLAN_FINISHED
from custom_components.matic_robot.managed_executor import _async_execute_rooms
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


async def test_docked_stop_can_win_race_with_run_finalizer(hass) -> None:
    """A dock observation received before final cleanup remains durable."""
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

    assert await manager.ledger.async_mark_run_docked("serial", "run-1")
    assert await manager.ledger.async_finish_run(
        "serial", "run-1", "cancelled", "managed_stop", 0, terminal_activity="idle"
    )
    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "stopped_docked"
    assert last_run["reason_code"] == "stopped_docked"
    assert last_run["terminal_activity"] == "docked"


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
