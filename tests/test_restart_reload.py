"""Regression coverage for enabled-entry reloads and recovery retirement."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState

from custom_components.matic_robot import async_unload_entry
from custom_components.matic_robot.const import CONF_SERIAL_NUMBER
from custom_components.matic_robot.managed_executor import PlanCancelledError
from custom_components.matic_robot.restart import async_recover_managed_run

# Reuse the synthetic, real CleaningPlanManager state used by restart tests.
from tests.test_restart import recovery_state as recovery_fixture


@pytest.fixture
async def recovery_state(hass):
    return await recovery_fixture.__wrapped__(hass)


@pytest.mark.parametrize("explicit_reason", [None, "managed_stop", "motion_replaced"])
async def test_enabled_reload_preserves_one_managed_run_for_recovery(
    hass, recovery_state, explicit_reason
) -> None:
    """Unloading an enabled entry is observer loss, not a new cleaning run."""
    manager, entry, checkpoint, room = recovery_state
    runtime = entry.runtime_data
    runtime.slam_map.async_shutdown = AsyncMock()
    runtime.slam_history = SimpleNamespace(async_shutdown=AsyncMock())
    runtime.client.close = lambda: None
    entry.entry_id = "entry"
    entry.disabled_by = None
    entry.data = {CONF_SERIAL_NUMBER: "serial"}

    unload_platforms = AsyncMock(return_value=True)
    hass.config_entries.async_unload_platforms = unload_platforms

    entered = asyncio.Event()
    terminal = []
    hass.bus.async_listen("matic_robot_plan_finished", terminal.append)

    async def hold_native_wait(*args, **kwargs):
        entered.set()
        await manager.cancellation_event("serial").wait()
        raise PlanCancelledError

    with patch(
        "custom_components.matic_robot.managed_executor._async_wait_with_native_identity",
        side_effect=hold_native_wait,
    ) as executor:
        for _ in range(2 if explicit_reason is None else 1):
            entered.clear()
            recovery_task = asyncio.create_task(
                async_recover_managed_run(hass, entry, "serial")
            )
            await asyncio.wait_for(entered.wait(), timeout=2)
            assert not hass.is_stopping
            if explicit_reason:
                manager._cancellation_reasons["serial"] = explicit_reason
            await async_unload_entry(hass, entry)
            await recovery_task

    executor.assert_awaited()
    await hass.async_block_till_done()
    saved = manager.recovery_run("serial")
    if explicit_reason:
        assert saved is None
        assert manager.snapshot("serial")["last_run"]["outcome"] == "cancelled"
        return
    runtime.client.async_send_user_command.assert_not_awaited()
    assert not terminal
    assert saved is not None
    assert saved["run_id"] == "run"
    assert (
        saved["recovery_checkpoint"]["completion_deadline"]
        == checkpoint["completion_deadline"]
    )
    assert manager.snapshot("serial")["last_run"]["outcome"] == "running"
    assert (
        saved["recovery_checkpoint"]["native_identity_hash"]
        == checkpoint["native_identity_hash"]
    )
    assert saved["recovery_checkpoint"]["started_room_ids"] == [room.room_id]


async def test_retire_recovery_is_idempotent_and_drops_checkpoint(
    hass, recovery_state
) -> None:
    manager, _, _, _ = recovery_state

    await manager.async_retire_recovery("serial", "config_entry_removed")
    assert manager.recovery_run("serial") is None
    last_run = manager.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "unverified"
    assert "recovery_checkpoint" not in last_run

    # A second unload/remove callback cannot create another terminal result.
    await manager.async_retire_recovery("serial", "config_entry_removed")
    assert manager.snapshot("serial")["last_run"] == last_run


async def test_retire_missing_run_is_noop(hass) -> None:
    from custom_components.matic_robot.plans import CleaningPlanManager

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_retire_recovery("missing", "config_entry_removed")
    assert manager.recovery_run("missing") is None


async def test_queued_recovery_during_unload_keeps_checkpoint_and_does_not_replay(
    hass, recovery_state
) -> None:
    """A queued callback must not reacquire ownership after unload starts."""
    manager, entry, _, _ = recovery_state
    entry.state = ConfigEntryState.UNLOAD_IN_PROGRESS

    with patch(
        "custom_components.matic_robot.restart._async_execute_rooms",
        new_callable=AsyncMock,
    ) as executor:
        await async_recover_managed_run(hass, entry, "serial")

    executor.assert_not_awaited()
    saved = manager.recovery_run("serial")
    assert saved is not None
    assert saved["run_id"] == "run"
    assert manager.pending_stop_run_id("serial") is None
