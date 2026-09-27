"""Repeated shutdown must preserve an already recovered native mission."""

import asyncio
from copy import deepcopy
from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import CoreState

from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom
from custom_components.matic_robot.restart import async_recover_managed_run

from .test_restart import recovery_state as recovery_fixture


@pytest.fixture
async def recovery_state(hass):
    return await recovery_fixture.__wrapped__(hass)


@pytest.mark.parametrize("stage", ["refresh", "history", "identity", "status"])
async def test_second_shutdown_during_recovery_preserves_checkpoint(
    hass, recovery_state, stage
):
    manager, entry, _, _ = recovery_state
    client = entry.runtime_data.client

    async def shutdown(*_args, **_kwargs):
        hass.set_state(CoreState.stopping)
        await manager.async_cancel_and_wait("serial", preserve_run=True)
        return ()

    if stage == "refresh":
        entry.runtime_data.coordinator.async_request_refresh.side_effect = shutdown
        client.async_get_cleaning_session_identity.return_value = None
    elif stage == "history":
        client.async_get_cleaning_session_records.side_effect = shutdown
    elif stage == "identity":
        reads = 0

        async def identity():
            nonlocal reads
            reads += 1
            if reads == 2:
                await shutdown()
            return b"synthetic-session"

        client.async_get_cleaning_session_identity.side_effect = identity
    else:
        manager.async_mark_recovery_status = AsyncMock(side_effect=shutdown)
    events = []
    hass.bus.async_listen("matic_robot_plan_finished", events.append)
    with (
        patch("custom_components.matic_robot.restart.RECOVERY_RETRY_SECONDS", 0),
        patch(
            "custom_components.matic_robot.restart._async_execute_rooms",
            new_callable=AsyncMock,
        ) as execute,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    execute.assert_not_awaited()
    assert manager.recovery_run("serial")["run_id"] == "run"
    await hass.async_block_till_done()
    assert not events
    client.async_send_user_command.assert_not_awaited()


async def test_two_restarts_rejoin_real_executor_without_replaying(
    hass, recovery_state
):
    manager, entry, checkpoint, _ = recovery_state
    identity_hash = checkpoint["native_identity_hash"]

    async def shutdown_monitor(*_args, **_kwargs):
        hass.set_state(CoreState.stopping)
        raise asyncio.CancelledError

    with patch(
        "custom_components.matic_robot.managed_executor._async_wait_with_native_identity",
        side_effect=shutdown_monitor,
    ):
        with pytest.raises(asyncio.CancelledError):
            await async_recover_managed_run(hass, entry, "serial")
    persisted = deepcopy(manager._data)
    run = manager.recovery_run("serial")
    assert run["run_id"] == "run"
    assert run["recovery_checkpoint"]["native_identity_hash"] == identity_hash
    restored = CleaningPlanManager(hass)
    restored._store = SimpleNamespace(
        async_load=AsyncMock(return_value=persisted), async_save=AsyncMock()
    )
    await restored.async_load()
    entry.runtime_data.cleaning_plans = restored
    hass.set_state(CoreState.running)
    reads = 0

    async def identity():
        nonlocal reads
        reads += 1
        if reads == 2:
            hass.states.async_set(checkpoint["entity_id"], "returning")
        return b"synthetic-session" if reads <= 2 else b""

    entry.runtime_data.client.async_get_cleaning_session_identity.side_effect = identity
    with (
        patch(
            "custom_components.matic_robot.managed_executor._async_verify_room_completion",
            AsyncMock(return_value=True),
        ),
        patch(
            "custom_components.matic_robot.managed_executor._async_dispatch_leg_command",
            new_callable=AsyncMock,
        ) as dispatch,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    final = restored.snapshot("serial")["last_run"]
    assert final["run_id"] == "run" and final["outcome"] == "completed"
    assert final["completed_room_count"] == 1
    assert restored.snapshot("serial")["completed_runs"] == 1
    dispatch.assert_not_awaited()
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


async def test_credited_intermediate_leg_does_not_authorize_offline_queue_replay(
    hass, recovery_state
):
    manager, entry, checkpoint, room = recovery_state
    next_room = CleaningRoom("office", "Office", "vacuum", "quick")
    await manager.async_begin_run(
        "serial", "plan", "run", 2, trigger="automation", service="clean_entire_plan"
    )
    checkpoint["rooms"] = [asdict(room), asdict(next_room)]
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    await manager.async_mark_started("serial", "plan", room, run_id="run")
    await manager.async_mark_completed("serial", "plan", room, duration_seconds=30)
    entry.runtime_data.client.async_get_cleaning_session_identity.return_value = b""
    with patch(
        "custom_components.matic_robot.restart._async_execute_rooms",
        new_callable=AsyncMock,
    ) as execute:
        await async_recover_managed_run(hass, entry, "serial")
    execute.assert_not_awaited()
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()
    final = manager.snapshot("serial")["last_run"]
    assert final["completed_room_count"] == 1
    assert final["outcome"] == "unverified"
    assert final["reason_code"] == "restart_native_mission_changed_or_ended"
