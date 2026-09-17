"""Recovery retains the original mission budget and suspended state."""

import asyncio
from dataclasses import asdict, replace
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import CoreState, ServiceCall
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.plans import CleaningRoom
from custom_components.matic_robot.restart import async_recover_managed_run
from custom_components.matic_robot.services import (
    RoomRunOutcome,
    _async_completion_budget,
    _async_dispatch_leg_command,
    _PreparedRoomDispatch,
    _remaining_completion_time,
)

from .test_restart import recovery_state as recovery_fixture


@pytest.fixture
async def recovery_state(hass):
    return await recovery_fixture.__wrapped__(hass)


async def test_completion_budget_is_persisted_once_and_not_reset():
    saver = AsyncMock()
    dispatch = _PreparedRoomDispatch((), frozenset(), dt_util.utcnow())
    assert _remaining_completion_time(dispatch, 100) == 100
    remaining = await _async_completion_budget(dispatch, 100, saver)
    assert 99 < remaining <= 100
    saved = saver.await_args.args[0]
    assert saved.completion_deadline is not None
    saver.reset_mock()
    near_end = replace(
        saved, completion_deadline=dt_util.utcnow() + timedelta(seconds=5)
    )
    assert 0 < await _async_completion_budget(near_end, 100, saver) <= 5
    saver.assert_not_awaited()


async def test_dispatch_has_absolute_budget_before_initial_state_wait(hass):
    hass.services.async_register("vacuum", "send_command", AsyncMock())
    dispatch = await _async_dispatch_leg_command(
        hass,
        ServiceCall(
            hass, "matic_robot", "clean_entire_plan", {"completion_timeout": 100}
        ),
        "vacuum.matic",
        [CleaningRoom("kitchen", "Kitchen", "vacuum", "standard")],
        None,
        AsyncMock(return_value=()),
        session_identity=AsyncMock(side_effect=[b"", b"accepted"]),
    )
    assert dispatch.native_identity == b"accepted"
    assert dispatch.completion_deadline == dispatch.dispatched_at + timedelta(
        seconds=100
    )


@pytest.mark.parametrize("missing", [True, False])
async def test_accepted_checkpoint_without_budget_is_not_recoverable(
    hass, recovery_state, missing
):
    manager, entry, checkpoint, _ = recovery_state
    if missing:
        checkpoint.pop("completion_deadline")
    else:
        checkpoint["completion_deadline"] = None
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    with patch("custom_components.matic_robot.restart._async_execute_rooms") as execute:
        await async_recover_managed_run(hass, entry, "serial")
    execute.assert_not_called()
    assert manager.snapshot("serial")["last_run"]["outcome"] == "unverified"
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("native_active", [False, True, None])
async def test_recovered_stop_uses_native_settlement_and_correlated_dock(
    hass, recovery_state, native_active
):
    manager, entry, checkpoint, _ = recovery_state
    client = entry.runtime_data.client

    async def command(value):
        if value is UserCommand.STOP:
            manager.mark_managed_stop("serial")
            hass.states.async_set(checkpoint["entity_id"], "idle")
            client.async_has_active_cleaning_session.return_value = native_active
        elif value is UserCommand.DOCK:
            hass.states.async_set(checkpoint["entity_id"], "docked")

    client.async_send_user_command.side_effect = command
    docked = []
    hass.bus.async_listen("matic_robot_plan_docked", docked.append)
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_with_native_identity",
            return_value=RoomRunOutcome.STOPPED_IN_PLACE,
        ),
        patch(
            "custom_components.matic_robot.stop_return.DOCK_SETTLE_TIMEOUT_SECONDS", 0
        ),
        patch("custom_components.matic_robot.stop_return.DOCK_SETTLE_POLL_SECONDS", 0),
        patch("custom_components.matic_robot.services._schedule_native_reconciliation"),
    ):
        await async_recover_managed_run(hass, entry, "serial")
        tasks = tuple(manager._reconciliation_tasks.get("serial", ()))
        await asyncio.wait_for(asyncio.gather(*tasks), 1)
        await hass.async_block_till_done()
    expected = (
        [UserCommand.STOP, UserCommand.DOCK]
        if native_active is False
        else [UserCommand.STOP]
    )
    assert [
        call.args[0] for call in client.async_send_user_command.await_args_list
    ] == expected
    final = manager.snapshot("serial")["last_run"]
    assert final["outcome"] == (
        "stopped_docked" if native_active is False else "unverified"
    )
    if native_active is False:
        assert docked[0].data["run_id"] == "run"
        assert docked[0].data["provenance"] == "automation"
    else:
        assert not docked


@pytest.mark.parametrize("multi", [False, True])
async def test_expired_recovery_budget_stops_only_owned_mission(
    hass, recovery_state, multi
):
    manager, entry, checkpoint, room = recovery_state
    if multi:
        await manager.async_begin_run(
            "serial",
            "plan",
            "run",
            2,
            trigger="automation",
            service="clean_entire_plan",
        )
        checkpoint["rooms"] = [
            asdict(room),
            asdict(CleaningRoom("office", "Office", "vacuum", "standard")),
        ]
    checkpoint["completion_deadline"] = (
        dt_util.utcnow() - timedelta(seconds=1)
    ).isoformat()
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    await async_recover_managed_run(hass, entry, "serial")
    final = manager.snapshot("serial")["last_run"]
    assert final["outcome"] == "failed"
    assert final["reason_code"] == "completion_timeout"
    entry.runtime_data.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )


@pytest.mark.parametrize("multi", [False, True])
@pytest.mark.parametrize("reason", ["low_charge", "paused"])
async def test_recovered_suspension_waits_for_owned_resume_with_remaining_budget(
    hass, recovery_state, multi, reason
):
    manager, entry, checkpoint, room = recovery_state
    if multi:
        await manager.async_begin_run(
            "serial",
            "plan",
            "run",
            2,
            trigger="automation",
            service="clean_entire_plan",
        )
        checkpoint["rooms"] = [
            asdict(room),
            asdict(CleaningRoom("office", "Office", "vacuum", "standard")),
        ]
        await manager.async_mark_started("serial", "plan", room, run_id="run")
    deadline = (dt_util.utcnow() + timedelta(seconds=100)).isoformat()
    checkpoint["completion_deadline"] = deadline
    await manager.async_set_recovery_checkpoint("serial", "run", checkpoint)
    await manager.async_mark_suspended("serial", "plan", room, reason)
    hass.states.async_set(
        checkpoint["entity_id"], "docked" if reason == "low_charge" else "paused"
    )

    async def wait_resume(*args):
        active = manager.snapshot("serial")["active_plan"]
        assert active["status"] == "suspended" and active["suspend_reason"] == reason
        assert 0 < args[2] <= 100
        hass.set_state(CoreState.stopping)
        raise asyncio.CancelledError

    with patch(
        "custom_components.matic_robot.services._async_wait_for_owned_resume",
        side_effect=wait_resume,
    ) as resume:
        with pytest.raises(asyncio.CancelledError):
            await async_recover_managed_run(hass, entry, "serial")
    resume.assert_awaited_once()
    assert (
        manager.recovery_run("serial")["recovery_checkpoint"]["completion_deadline"]
        == deadline
    )
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()
