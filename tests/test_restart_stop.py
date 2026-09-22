"""Persisted run-bound STOP settlement resumes without replaying STOP."""

import asyncio
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.restart import async_recover_managed_run

from .test_restart import recovery_state as recovery_fixture


@pytest.fixture
async def recovery_state(hass):
    return await recovery_fixture.__wrapped__(hass)


async def reload_manager(hass, entry, manager):
    restored = CleaningPlanManager(hass)
    restored._store = SimpleNamespace(
        async_save=AsyncMock(),
        async_load=AsyncMock(return_value=deepcopy(manager._data)),
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
    await manager.async_mark_stop_pending("serial", run_id="run")
    if finished:
        await manager.async_finish_run(
            "serial", "run", "unverified", "stopped_in_place", 0
        )
    manager = await reload_manager(hass, entry, manager)
    client = entry.runtime_data.client
    hass.states.async_set(checkpoint["entity_id"], "idle")
    client.async_has_active_cleaning_session.return_value = native_active

    async def dock(command):
        assert command is UserCommand.DOCK
        hass.states.async_set(checkpoint["entity_id"], "docked")

    client.async_send_user_command.side_effect = dock
    with patch(
        "custom_components.matic_robot.stop_return.DOCK_SETTLE_TIMEOUT_SECONDS", 0
    ):
        await async_recover_managed_run(hass, entry, "serial")
        await asyncio.gather(*tuple(manager._reconciliation_tasks.get("serial", ())))
    if native_active is False:
        client.async_send_user_command.assert_awaited_once_with(UserCommand.DOCK)
        assert manager.snapshot("serial")["last_run"]["outcome"] == "stopped_docked"
    else:
        client.async_send_user_command.assert_not_awaited()
    assert manager.snapshot("serial")["last_run"]["run_id"] == "run"


@pytest.mark.parametrize(
    "case", ["expired", "wrong_owner", "replaced", "cleared", "already_docked"]
)
async def test_stop_watcher_cannot_recover_without_owned_live_fence(
    hass, recovery_state, case
):
    manager, entry, checkpoint, _ = recovery_state
    await manager.async_mark_stop_pending("serial", run_id="run")
    await manager.async_finish_run("serial", "run", "unverified", "test", 0)
    if case == "expired":
        manager._robot("serial")["stop_fence_expires_at"] = (
            dt_util.utcnow() - timedelta(seconds=1)
        ).isoformat()
    elif case == "wrong_owner":
        manager._robot("serial")["stop_fence_run_id"] = "different-run"
    elif case == "replaced":
        await manager.async_replace_managed_motion("serial")
    elif case == "cleared":
        await manager.async_clear_stop_pending("serial")
    else:
        manager._robot("serial")["last_run"]["outcome"] = "stopped_docked"
    manager = await reload_manager(hass, entry, manager)
    hass.states.async_set(checkpoint["entity_id"], "idle")
    await async_recover_managed_run(hass, entry, "serial")
    assert not manager._reconciliation_tasks
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


async def test_stop_fence_rollback_is_scoped_to_its_run(hass, recovery_state):
    manager, _, _, _ = recovery_state
    await manager.async_mark_stop_pending("serial", run_id="run-one")

    await manager.async_clear_stop_pending("serial", run_id="run-two")
    assert manager.stop_pending("serial")

    await manager.async_clear_stop_pending("serial", run_id="run-one")
    assert not manager.stop_pending("serial")


async def test_second_shutdown_retains_settlement_owner(hass, recovery_state):
    manager, entry, checkpoint, _ = recovery_state
    await manager.async_mark_stop_pending("serial", run_id="run")
    manager = await reload_manager(hass, entry, manager)
    hass.states.async_set(checkpoint["entity_id"], "idle")
    entry.runtime_data.client.async_has_active_cleaning_session.return_value = True
    await async_recover_managed_run(hass, entry, "serial")
    assert manager.dock_reconciliation_active("serial")
    await manager.async_cancel_and_wait("serial", preserve_run=True)
    assert manager.pending_stop_run_id("serial") == "run"
    manager = await reload_manager(hass, entry, manager)
    entry.runtime_data.client.async_has_active_cleaning_session.return_value = False

    async def dock(command):
        hass.states.async_set(checkpoint["entity_id"], "docked")

    entry.runtime_data.client.async_send_user_command.side_effect = dock
    await async_recover_managed_run(hass, entry, "serial")
    await asyncio.gather(*tuple(manager._reconciliation_tasks.get("serial", ())))
    entry.runtime_data.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.DOCK
    )
    assert manager.snapshot("serial")["last_run"]["outcome"] == "stopped_docked"
