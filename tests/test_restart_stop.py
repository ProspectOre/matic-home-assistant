"""Persisted run-bound STOP settlement resumes without replaying STOP."""

import asyncio
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot import plan_storage
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.restart import async_recover_managed_run

from .test_restart import _operational_state, _set_interrupted_mixed_dispatch
from .test_restart import recovery_state as recovery_fixture


@pytest.fixture
async def recovery_state(hass):
    return await recovery_fixture.__wrapped__(hass)


async def reload_manager(hass, entry, manager):
    restored = CleaningPlanManager(hass)
    restored.repository.store = SimpleNamespace(
        async_save=AsyncMock(),
        async_load=AsyncMock(return_value=deepcopy(manager.repository.data)),
    )
    await restored.async_load()
    entry.runtime_data.cleaning_plans = restored
    return restored


@pytest.mark.parametrize("finished", [False, True])
@pytest.mark.parametrize("native_active", [False, True, None])
async def test_restored_stop_fence_keeps_run_and_native_guards(
    hass, recovery_state, finished, native_active
):
    manager, entry, checkpoint, _ = recovery_state
    await manager.control.async_mark_stop_pending("serial", run_id="run")
    if finished:
        await manager.ledger.async_finish_run(
            "serial", "run", "unverified", "stopped_in_place", 0
        )
    manager = await reload_manager(hass, entry, manager)
    client = entry.runtime_data.client
    hass.states.async_set(checkpoint["entity_id"], "idle")
    client.async_get_active_cleaning_session_state.return_value = native_active

    async def dock(command):
        assert command is UserCommand.DOCK
        hass.states.async_set(checkpoint["entity_id"], "docked")
        client.async_get_state.return_value = _operational_state(charging_idle=True)

    client.async_send_user_command.side_effect = dock
    with patch(
        "custom_components.matic_robot.stop_return.DOCK_SETTLE_TIMEOUT_SECONDS", 0
    ):
        await async_recover_managed_run(hass, entry, "serial")
        await asyncio.gather(
            *tuple(manager.control.actor("serial").reconciliation_tasks)
        )
    if native_active is False:
        client.async_send_user_command.assert_awaited_once_with(UserCommand.DOCK)
        assert (
            manager.history.snapshot("serial")["last_run"]["outcome"]
            == "stopped_docked"
        )
    else:
        client.async_send_user_command.assert_not_awaited()
    assert manager.history.snapshot("serial")["last_run"]["run_id"] == "run"


@pytest.mark.parametrize(
    "case", ["expired", "wrong_owner", "replaced", "cleared", "already_docked"]
)
async def test_stop_watcher_cannot_recover_without_owned_live_fence(
    hass, recovery_state, case
):
    manager, entry, checkpoint, _ = recovery_state
    await manager.control.async_mark_stop_pending("serial", run_id="run")
    await manager.ledger.async_finish_run("serial", "run", "unverified", "test", 0)
    if case == "expired":
        manager.repository.robot("serial")["stop_fence_expires_at"] = (
            dt_util.utcnow() - timedelta(seconds=1)
        ).isoformat()
    elif case == "wrong_owner":
        manager.repository.robot("serial")["stop_fence_run_id"] = "different-run"
    elif case == "replaced":
        await manager.control.async_replace_managed_motion("serial")
    elif case == "cleared":
        await manager.control.async_clear_stop_pending("serial")
    else:
        manager.repository.robot("serial")["last_run"]["outcome"] = "stopped_docked"
    manager = await reload_manager(hass, entry, manager)
    hass.states.async_set(checkpoint["entity_id"], "idle")
    await async_recover_managed_run(hass, entry, "serial")
    assert not manager.control.actor("serial").reconciliation_tasks
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


async def test_stop_fence_rollback_is_scoped_to_its_run(hass, recovery_state):
    manager, _, _, _ = recovery_state
    await manager.control.async_mark_stop_pending("serial", run_id="run-one")

    await manager.control.async_clear_stop_pending("serial", run_id="run-two")
    assert manager.control.stop_pending("serial")

    await manager.control.async_clear_stop_pending("serial", run_id="run-one")
    assert not manager.control.stop_pending("serial")


async def test_second_shutdown_retains_settlement_owner(hass, recovery_state):
    manager, entry, checkpoint, _ = recovery_state
    await manager.control.async_mark_stop_pending("serial", run_id="run")
    manager = await reload_manager(hass, entry, manager)
    hass.states.async_set(checkpoint["entity_id"], "idle")
    entry.runtime_data.client.async_get_active_cleaning_session_state.return_value = (
        True
    )
    await async_recover_managed_run(hass, entry, "serial")
    assert manager.control.dock_reconciliation_active("serial")
    await manager.control.async_cancel_and_wait("serial", preserve_run=True)
    assert manager.control.pending_stop_run_id("serial") == "run"
    manager = await reload_manager(hass, entry, manager)
    entry.runtime_data.client.async_get_active_cleaning_session_state.return_value = (
        False
    )

    async def dock(command):
        hass.states.async_set(checkpoint["entity_id"], "docked")
        entry.runtime_data.client.async_get_state.return_value = _operational_state(
            charging_idle=True
        )

    entry.runtime_data.client.async_send_user_command.side_effect = dock
    await async_recover_managed_run(hass, entry, "serial")
    await asyncio.gather(*tuple(manager.control.actor("serial").reconciliation_tasks))
    entry.runtime_data.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.DOCK
    )
    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "stopped_docked"


@pytest.mark.parametrize("removed", [False, True])
async def test_cancelled_mixed_stop_prepare_settles_before_rollback(
    recovery_state, removed
):
    """A STOP intent save that outlives its waiter is still rolled back."""
    manager, entry, checkpoint, _ = recovery_state
    _, session_hash = await _set_interrupted_mixed_dispatch(manager, entry, checkpoint)
    repository = manager.repository
    save = repository.store.async_save
    started, release = asyncio.Event(), asyncio.Event()

    async def held_save(data) -> None:
        started.set()
        await release.wait()
        await save(data)

    repository.store.async_save = held_save

    async def prepare_then_roll_back() -> None:
        # restart.py rolls back whatever a failed prepare left.
        try:
            await manager.recovery.async_prepare_mixed_dispatch_stop(
                "serial", "run", session_hash
            )
        except BaseException:
            await manager.recovery.async_rollback_mixed_dispatch_stop(
                "serial", "run", session_hash
            )
            raise

    async with repository.store_lock:
        stop = asyncio.create_task(prepare_then_roll_back())
        for _ in range(5):
            await asyncio.sleep(0)
        if removed:
            # The commit finds the robot removed and saves nothing.
            stop.cancel()
            repository.removed_robots.add("serial")
            release.set()
    if not removed:
        await asyncio.wait_for(started.wait(), 1)
        stop.cancel()
        for _ in range(5):
            await asyncio.sleep(0)
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await stop
    pending = tuple(repository.metadata_persistence_tasks.get("serial", ()))
    await asyncio.gather(*pending, return_exceptions=True)

    saved = save.await_args.args[0]["robots"]["serial"]
    for robot in (repository.robot("serial"), saved):
        assert "stop_intent" not in robot["last_run"]["recovery_checkpoint"]
        assert plan_storage.STOP_FENCE_RUN_ID not in robot


async def test_mixed_stop_rechecks_its_checkpoint_inside_the_commit(recovery_state):
    """A run that changes while a STOP waits for the lock keeps its state."""
    manager, entry, checkpoint, _ = recovery_state
    _, session_hash = await _set_interrupted_mixed_dispatch(manager, entry, checkpoint)
    repository = manager.repository

    def stored_checkpoint() -> dict:
        return repository.robot("serial")["last_run"]["recovery_checkpoint"]

    async with repository.store_lock:
        prepare = asyncio.create_task(
            manager.recovery.async_prepare_mixed_dispatch_stop(
                "serial", "run", session_hash
            )
        )
        for _ in range(5):
            await asyncio.sleep(0)
        assert repository.robot("serial")[plan_storage.STOP_FENCE_RUN_ID] == "run"
        stored_checkpoint()["phase"] = "accepted"
    with pytest.raises(HomeAssistantError, match="no longer owns"):
        await prepare
    assert plan_storage.STOP_FENCE_RUN_ID not in repository.robot("serial")
    assert "stop_intent" not in stored_checkpoint()

    stored_checkpoint()["phase"] = "dispatching"
    await manager.recovery.async_prepare_mixed_dispatch_stop(
        "serial", "run", session_hash
    )
    async with repository.store_lock:
        rollback = asyncio.create_task(
            manager.recovery.async_rollback_mixed_dispatch_stop(
                "serial", "run", session_hash
            )
        )
        for _ in range(5):
            await asyncio.sleep(0)
        stored_checkpoint()["stop_intent"] = "after_room"
    await rollback
    assert stored_checkpoint()["stop_intent"] == "after_room"
