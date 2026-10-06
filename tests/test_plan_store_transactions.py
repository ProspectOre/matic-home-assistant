"""Shared Store commits must not capture another robot's uncommitted state."""

from __future__ import annotations

import asyncio
import json

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.file import WriteError

from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom

PEER = "synthetic-peer-robot"
TARGET = "synthetic-target-robot"


async def _seed_history_and_reconciliation(manager: CleaningPlanManager):
    """Create persisted room progress, a valid pending marker, and its watcher."""
    room = CleaningRoom("room-target", "Target Room", "vacuum", "standard")
    dispatched_at = dt_util.utcnow()
    marker = {
        "plan_id": "target-plan",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": dispatched_at.isoformat(),
    }
    await manager.async_mark_started(TARGET, "target-plan", room)
    await manager.async_mark_completed(TARGET, "target-plan", room)
    await manager.async_mark_started(TARGET, "target-plan", room)
    await manager.async_mark_failed(
        TARGET,
        "target-plan",
        room,
        "stopped",
        native_reconciliation=marker,
    )
    watcher = asyncio.create_task(asyncio.Event().wait())
    manager.register_reconciliation_task(TARGET, watcher)
    return room, marker, watcher


@pytest.fixture
def hass_storage() -> dict:
    """Use the real Home Assistant Store instead of the test plugin mock."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep Store files in the test's isolated configuration directory."""
    return hass_tmp_config_dir


async def test_failed_plan_write_is_not_persisted_by_queued_peer_write(
    hass, monkeypatch
) -> None:
    """A failed plan remains isolated from an earlier peer Store payload."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager._store_lock.acquire()
    payloads: list[dict] = []
    original_write = Store._write_prepared_data

    def fail_target_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            envelope = json.loads(payload)
            robots = envelope["data"]["robots"]
            payloads.append(robots)
            if robots.get(TARGET, {}).get("plans", {}).get("rejected-plan"):
                raise WriteError("synthetic target write failure")
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", fail_target_write)
    peer_save = None
    target_save = None
    try:
        peer_save = asyncio.create_task(
            manager.async_save_plan(PEER, "peer-plan", {"name": "Peer"})
        )
        await asyncio.sleep(0)
        target_save = asyncio.create_task(
            manager.async_save_plan(TARGET, "rejected-plan", {"name": "Rejected"})
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert TARGET not in manager._data["robots"]
        manager._store_lock.release()
    finally:
        if manager._store_lock.locked():
            manager._store_lock.release()
        assert peer_save is not None and target_save is not None
        peer_result, target_result = await asyncio.gather(
            peer_save, target_save, return_exceptions=True
        )

    assert peer_result is None
    assert isinstance(target_result, HomeAssistantError)
    assert str(target_result) == "Cleaning plan state could not be saved"
    assert len(payloads) == 2
    assert TARGET not in payloads[0]
    assert payloads[1][TARGET]["plans"]["rejected-plan"]["name"] == "Rejected"
    assert "rejected-plan" not in manager._data["robots"][TARGET]["plans"]
    assert manager._data["robots"][PEER]["plans"]["peer-plan"]["name"] == "Peer"

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert "rejected-plan" not in reloaded._data["robots"].get(TARGET, {}).get(
        "plans", {}
    )
    assert reloaded._data["robots"][PEER]["plans"]["peer-plan"]["name"] == "Peer"


async def test_failed_plan_selection_is_not_persisted_by_later_peer_write(
    hass, monkeypatch
) -> None:
    """A failed selection cannot leak into a later whole-root Store write."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_save_plan(TARGET, "first-plan", {"name": "First"})
    await manager.async_save_plan(
        TARGET, "second-plan", {"name": "Second"}, select=False
    )
    original_write = Store._write_prepared_data
    target_selections: list[str | None] = []
    failed = False

    def fail_selection(store, mode: str, payload: str | bytes) -> None:
        nonlocal failed
        if store is manager._store:
            robot = json.loads(payload)["data"]["robots"].get(TARGET, {})
            selected = robot.get("selected_plan")
            target_selections.append(selected)
            if selected == "second-plan" and not failed:
                failed = True
                raise WriteError("synthetic selection write failure")
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", fail_selection)
    with pytest.raises(
        HomeAssistantError, match="Cleaning plan state could not be saved"
    ):
        await manager.async_select_plan(TARGET, "second-plan")

    assert failed
    assert manager.snapshot(TARGET)["selected_plan"] == "first-plan"
    await manager.async_save_plan(PEER, "peer-plan", {"name": "Peer"})

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.snapshot(TARGET)["selected_plan"] == "first-plan"
    assert reloaded.plan(TARGET, "second-plan")["name"] == "Second"
    assert reloaded.plan(PEER, "peer-plan")["name"] == "Peer"
    assert target_selections[-1] == "first-plan"


async def test_failed_history_reset_is_not_persisted_by_later_peer_write(
    hass, monkeypatch
) -> None:
    """A failed reset retains progress and its accepted native reconciliation."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_save_plan(TARGET, "target-plan", {"name": "Target"})
    _, _, watcher = await _seed_history_and_reconciliation(manager)
    try:
        before_record = manager._robot(TARGET)["rotations"]["target-plan"]["rooms"][
            "room-target"
        ]
        assert before_record["completed_runs"] == 1
        before_record = before_record.copy()
        marker = manager.pending_native_reconciliation(TARGET)
        assert marker is not None
        original_write = Store._write_prepared_data
        failed = False

        def fail_reset(store, mode: str, payload: str | bytes) -> None:
            nonlocal failed
            if store is manager._store:
                robot = json.loads(payload)["data"]["robots"].get(TARGET, {})
                reset_record = robot.get("rotation_resets", {}).get("target-plan")
                if reset_record is not None and not failed:
                    failed = True
                    raise WriteError("synthetic history reset failure")
            original_write(store, mode, payload)

        monkeypatch.setattr(Store, "_write_prepared_data", fail_reset)
        with pytest.raises(
            HomeAssistantError, match="Cleaning plan state could not be saved"
        ):
            await manager.async_reset_history(TARGET, "target-plan")

        assert failed
        target = manager._robot(TARGET)
        assert (
            target["rotations"]["target-plan"]["rooms"]["room-target"] == before_record
        )
        assert target["pending_native_reconciliation"] == marker
        assert not watcher.done()
        assert watcher in manager._reconciliation_tasks[TARGET]
        await manager.async_save_plan(PEER, "peer-plan", {"name": "Peer"})

        reloaded = CleaningPlanManager(hass)
        await reloaded.async_load()
        target = reloaded._robot(TARGET)
        assert (
            target["rotations"]["target-plan"]["rooms"]["room-target"] == before_record
        )
        assert target["pending_native_reconciliation"] == marker
        assert reloaded.plan(PEER, "peer-plan")["name"] == "Peer"
    finally:
        if not watcher.done():
            watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


async def test_successful_history_reset_cancels_reconciliation_after_store_write(
    hass, monkeypatch
) -> None:
    """A successful reset commits before cancelling its native watcher."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_save_plan(TARGET, "target-plan", {"name": "Target"})
    _, _marker, watcher = await _seed_history_and_reconciliation(manager)
    try:
        original_write = Store._write_prepared_data
        watcher_state_during_reset_write: list[bool] = []

        def observe_reset_write(store, mode: str, payload: str | bytes) -> None:
            if store is manager._store:
                robot = json.loads(payload)["data"]["robots"].get(TARGET, {})
                reset_record = robot.get("rotation_resets", {}).get("target-plan")
                if reset_record is not None:
                    watcher_state_during_reset_write.append(watcher.done())
                    assert "pending_native_reconciliation" not in robot
            original_write(store, mode, payload)

        monkeypatch.setattr(Store, "_write_prepared_data", observe_reset_write)
        await manager.async_reset_history(TARGET, "target-plan")

        assert watcher_state_during_reset_write == [False]
        await asyncio.gather(watcher, return_exceptions=True)
        assert watcher.cancelled()
        assert manager.pending_native_reconciliation(TARGET) is None
        reloaded = CleaningPlanManager(hass)
        await reloaded.async_load()
        assert reloaded.pending_native_reconciliation(TARGET) is None
        assert "target-plan" not in reloaded._robot(TARGET)["rotations"]
    finally:
        if not watcher.done():
            watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)
