"""Command admission remains fenced across unload and failed-unload reopen."""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.run_control import ManagedMotionReplacedError

SERIAL = "synthetic-command-lifecycle-robot"


@pytest.fixture
def hass_storage() -> dict:
    """Use the real Store with an isolated storage mapping."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep Store files in pytest's isolated config directory."""
    return hass_tmp_config_dir


async def test_queued_external_command_rejects_old_epoch_after_reopen(hass) -> None:
    """A queued request cannot dispatch after teardown reopens the phase."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    command_lock = manager.control.command_lock(SERIAL)
    await command_lock.acquire()
    entered: list[str] = []

    async def send_external() -> None:
        async with manager.control.external_command(SERIAL):
            entered.append("dispatched")

    queued = asyncio.create_task(send_external())
    try:
        # Let the caller capture the open epoch and queue on command ownership.
        await asyncio.sleep(0)
        manager.control.begin_command_teardown(SERIAL)
        manager.control.reopen_metadata_admission(SERIAL)
        assert manager.control.command_admission_open(SERIAL)
        command_lock.release()
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            await asyncio.wait_for(queued, timeout=3)
    finally:
        if command_lock.locked():
            command_lock.release()
        if not queued.done():
            queued.cancel()
            await asyncio.gather(queued, return_exceptions=True)

    assert entered == []
    assert not command_lock.locked()
    assert await _dispatch(manager, SERIAL)

    # New work in the reopened epoch dispatches normally; the old queued
    # request stayed rejected even though admission was open when it resumed.
    async with manager.control.external_command(SERIAL):
        entered.append("reopened")
    assert entered == ["reopened"]


async def _dispatch(manager: CleaningPlanManager, serial_number: str) -> bool:
    """Probe external admission without issuing a device command."""
    try:
        async with manager.control.external_command(serial_number):
            return True
    except HomeAssistantError:
        return False


async def test_queued_external_motion_rejection_preserves_managed_owner(hass) -> None:
    """A queued motion rejected by teardown cannot cancel the managed run."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    token = manager.control.begin_managed_motion(SERIAL)
    cancellation = manager.control.prepare_run(SERIAL)
    plan_lock = manager.control.lock(SERIAL)
    await plan_lock.acquire()
    command_lock = manager.control.command_lock(SERIAL)
    await command_lock.acquire()
    entered: list[int] = []

    async def replace_motion() -> None:
        async with manager.control.external_motion(SERIAL) as generation:
            entered.append(generation)

    queued = asyncio.create_task(replace_motion())
    try:
        await asyncio.sleep(0)
        manager.control.begin_command_teardown(SERIAL)
        manager.control.reopen_metadata_admission(SERIAL)
        command_lock.release()
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            await asyncio.wait_for(queued, timeout=3)
    finally:
        if command_lock.locked():
            command_lock.release()
        if plan_lock.locked():
            plan_lock.release()
        if not queued.done():
            queued.cancel()
            await asyncio.gather(queued, return_exceptions=True)

    assert entered == []
    assert manager.control.managed_motion_is_current(SERIAL, token)
    assert not cancellation.is_set()
    assert not command_lock.locked()
    assert not plan_lock.locked()


async def test_external_motion_drains_store_owner_and_rejects_queued_command(
    hass,
) -> None:
    """Accepted motion completes cleanup; teardown drains it and rejects peers."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    dispatched_at = dt_util.utcnow()
    manager.repository.robot(SERIAL)["pending_native_reconciliation"] = {
        "plan_id": "synthetic-plan",
        "room_id": "synthetic-room",
        "room": "Synthetic room",
        "dispatched_at": dispatched_at.isoformat(),
        "expires_at": (dispatched_at + timedelta(minutes=1)).isoformat(),
        "run_id": "synthetic-run",
    }
    await manager.repository.store.async_save(manager.repository.data)

    await manager.repository.store_lock.acquire()
    entered: list[int] = []

    async def dispatch() -> None:
        async with manager.control.external_motion(SERIAL) as generation:
            entered.append(generation)

    queued_entries: list[str] = []

    async def dispatch_queued() -> None:
        async with manager.control.external_command(SERIAL):
            queued_entries.append("dispatched")

    motion = asyncio.create_task(dispatch())
    queued = None
    close = None
    try:
        for _ in range(20):
            await asyncio.sleep(0)
            if manager.repository.metadata_persistence_tasks.get(SERIAL):
                break
        assert manager.repository.metadata_persistence_tasks.get(SERIAL)
        assert "pending_native_reconciliation" not in manager.repository.robot(SERIAL)
        queued = asyncio.create_task(dispatch_queued())
        await asyncio.sleep(0)
        manager.control.begin_command_teardown(SERIAL)
        close = asyncio.create_task(
            manager.control.async_close_command_admission_and_wait(SERIAL)
        )
        await asyncio.sleep(0)
        assert not close.done()
        manager.repository.store_lock.release()
        await asyncio.wait_for(motion, timeout=3)
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            await asyncio.wait_for(queued, timeout=3)
        await asyncio.wait_for(close, timeout=3)
    finally:
        if manager.repository.store_lock.locked():
            manager.repository.store_lock.release()
        if not motion.done():
            motion.cancel()
            await asyncio.gather(motion, return_exceptions=True)
        if queued is not None and not queued.done():
            queued.cancel()
            await asyncio.gather(queued, return_exceptions=True)
        if close is not None and not close.done():
            await asyncio.gather(close, return_exceptions=True)

    assert len(entered) == 1
    assert queued_entries == []
    assert not manager.control.command_lock(SERIAL).locked()
    assert "pending_native_reconciliation" not in manager.repository.robot(SERIAL)
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert "pending_native_reconciliation" not in reloaded.repository.robot(SERIAL)


async def test_managed_command_allows_only_current_token_cleanup_during_teardown(
    hass,
) -> None:
    """Teardown permits current STOP cleanup but rejects stale and closed work."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    token = manager.control.begin_managed_motion(SERIAL)
    manager.control.begin_command_teardown(SERIAL)
    entered: list[str] = []

    with pytest.raises(HomeAssistantError, match="unavailable during unload"):
        async with manager.control.managed_command(SERIAL, token):
            entered.append("generic")

    async with manager.control.managed_command(SERIAL, token, teardown_cleanup=True):
        entered.append("current-cleanup")

    with pytest.raises(ManagedMotionReplacedError, match="replaced"):
        async with manager.control.managed_command(
            SERIAL, token + 1, teardown_cleanup=True
        ):
            entered.append("stale-cleanup")

    assert entered == ["current-cleanup"]
    assert not manager.control.command_lock(SERIAL).locked()

    await manager.control.async_close_command_admission_and_wait(SERIAL)
    for cleanup in (False, True):
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            async with manager.control.managed_command(
                SERIAL, token, teardown_cleanup=cleanup
            ):
                entered.append("closed")

    assert entered == ["current-cleanup"]
    assert not manager.control.command_lock(SERIAL).locked()
