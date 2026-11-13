"""The repository's one commit: copy, save, then apply to memory."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot import plan_storage
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.plans import CleaningPlanManager

SERIAL = "synthetic-robot"
ROOM = CleaningRoom("room-a", "Room A", "vacuum", "standard")


async def _manager(hass) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=None), async_save=AsyncMock()
    )
    await manager.async_load()
    await manager.catalog.async_save_plan(
        SERIAL, "plan", {"name": "Plan", "rooms": [{"room_id": ROOM.room_id}]}
    )
    return manager


async def test_failed_save_leaves_memory_unchanged(hass) -> None:
    manager = await _manager(hass)
    before = deepcopy(manager.repository.robot(SERIAL))
    manager.repository.store.async_save.side_effect = OSError("synthetic failure")

    with pytest.raises(OSError, match="synthetic failure"):
        await manager.ledger.async_begin_run(
            SERIAL, "plan", "run", 1, trigger="user", service="run_plan"
        )
    with pytest.raises(OSError, match="synthetic failure"):
        await manager.ledger.async_mark_started(SERIAL, "plan", ROOM, run_id="run")

    assert manager.repository.robot(SERIAL) == before


async def test_block_error_saves_nothing(hass) -> None:
    manager = await _manager(hass)
    before = deepcopy(manager.repository.robot(SERIAL))
    saves = manager.repository.store.async_save.await_count

    with pytest.raises(RuntimeError):
        async with manager.repository.commit(SERIAL) as robot:
            robot["plans"].clear()
            raise RuntimeError

    assert manager.repository.robot(SERIAL) == before
    assert manager.repository.store.async_save.await_count == saves


async def test_readers_see_the_draft_only_inside_the_commit(hass) -> None:
    manager = await _manager(hass)
    release = asyncio.Event()
    started = asyncio.Event()
    original_save = manager.repository.store.async_save

    async def held_save(data) -> None:
        started.set()
        await release.wait()
        await original_save(data)

    manager.repository.store.async_save = held_save
    late = asyncio.Event()

    async def late_reader() -> str:
        await late.wait()
        return manager.catalog.plan_name(SERIAL, "plan")

    async def rename() -> asyncio.Task[str]:
        async with manager.repository.commit(SERIAL) as robot:
            robot["plans"]["plan"]["name"] = "Renamed"
            assert manager.repository.robot(SERIAL) is robot
            # A task started here copies the draft context.
            return asyncio.create_task(late_reader())

    writer = asyncio.create_task(rename())
    await asyncio.wait_for(started.wait(), 1)
    assert manager.catalog.plan_name(SERIAL, "plan") == "Plan"
    release.set()
    reader = await writer
    assert manager.catalog.plan_name(SERIAL, "plan") == "Renamed"
    manager.repository.robot(SERIAL)["plans"]["plan"]["name"] = "Later"
    late.set()
    assert await reader == "Later"


async def test_concurrent_writers_both_land(hass) -> None:
    """Commits queue on one lock, so neither writer loses the other's change."""
    manager = await _manager(hass)
    release = asyncio.Event()
    original_save = manager.repository.store.async_save
    saved: list[dict] = []

    async def held_save(data) -> None:
        saved.append(deepcopy(data["robots"][SERIAL]))
        if len(saved) == 1:
            await release.wait()
        await original_save(data)

    manager.repository.store.async_save = held_save
    first = asyncio.create_task(
        manager.ledger.async_set_native_cleanings_enabled(SERIAL, True)
    )
    second = asyncio.create_task(
        manager.catalog.async_save_plan(SERIAL, "other", {"name": "Other"})
    )
    for _ in range(5):
        await asyncio.sleep(0)
    assert len(saved) == 1
    release.set()
    await asyncio.gather(first, second)

    robot = manager.repository.robot(SERIAL)
    assert robot["native_cleanings"]["enabled"] is True
    assert robot["plans"]["other"]["name"] == "Other"
    assert saved[-1]["native_cleanings"]["enabled"] is True
    assert saved[-1]["plans"]["other"]["name"] == "Other"


async def test_fence_set_during_a_save_stands(hass) -> None:
    """A STOP fence cannot wait for a save, and a commit cannot undo it."""
    manager = await _manager(hass)
    release = asyncio.Event()
    started = asyncio.Event()
    original_save = manager.repository.store.async_save

    async def held_save(data) -> None:
        started.set()
        await release.wait()
        await original_save(data)

    manager.repository.store.async_save = held_save
    writer = asyncio.create_task(
        manager.ledger.async_set_native_cleanings_enabled(SERIAL, True)
    )
    await asyncio.wait_for(started.wait(), 1)
    manager.control.mark_stop_pending(SERIAL, run_id="run")
    release.set()
    await writer

    robot = manager.repository.robot(SERIAL)
    assert robot[plan_storage.STOP_FENCE_RUN_ID] == "run"
    assert robot["native_cleanings"]["enabled"] is True


def _mixed_run(stop_intent: str | None) -> dict:
    return {
        "run_id": "run",
        "outcome": "running",
        "recovery_checkpoint": {
            "phase": "dispatching",
            "mixed_initial_session_hash": "a" * 64,
            "stop_intent": stop_intent,
        },
    }


async def test_mixed_stop_rechecks_its_checkpoint_inside_the_commit(hass) -> None:
    """A run that changes while a STOP waits for the lock keeps its state."""
    manager = await _manager(hass)
    repository = manager.repository
    repository.robot(SERIAL)["last_run"] = _mixed_run(None)

    async with repository.store_lock:
        prepare = asyncio.create_task(
            manager.recovery.async_prepare_mixed_dispatch_stop(SERIAL, "run", "a" * 64)
        )
        for _ in range(5):
            await asyncio.sleep(0)
        assert repository.robot(SERIAL)[plan_storage.STOP_FENCE_RUN_ID] == "run"
        repository.robot(SERIAL)["last_run"]["outcome"] = "completed"
    with pytest.raises(HomeAssistantError):
        await prepare
    assert plan_storage.STOP_FENCE_RUN_ID not in repository.robot(SERIAL)
    assert (
        repository.robot(SERIAL)["last_run"]["recovery_checkpoint"]["stop_intent"]
        is None
    )

    repository.robot(SERIAL)["last_run"] = _mixed_run("immediate")
    manager.control.mark_stop_pending(SERIAL, run_id="run")
    async with repository.store_lock:
        rollback = asyncio.create_task(
            manager.recovery.async_rollback_mixed_dispatch_stop(SERIAL, "run", "a" * 64)
        )
        for _ in range(5):
            await asyncio.sleep(0)
        checkpoint = repository.robot(SERIAL)["last_run"]["recovery_checkpoint"]
        checkpoint["stop_intent"] = "after_room"
    await rollback
    assert checkpoint["stop_intent"] == "after_room"
