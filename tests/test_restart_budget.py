"""Recovery retains the original mission budget and suspended state."""

import asyncio
from dataclasses import asdict, replace
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import CoreState
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.plans import CleaningRoom
from custom_components.matic_robot.restart import async_recover_managed_run
from custom_components.matic_robot.services import (
    _async_completion_budget,
    _PreparedRoomDispatch,
)

from .test_restart import recovery_state as recovery_fixture


@pytest.fixture
async def recovery_state(hass):
    return await recovery_fixture.__wrapped__(hass)


async def test_completion_budget_is_persisted_once_and_not_reset():
    saver = AsyncMock()
    dispatch = _PreparedRoomDispatch((), frozenset(), dt_util.utcnow())
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
