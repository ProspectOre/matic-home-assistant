"""A native pause and low-charge return share one suspension episode."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from custom_components.matic_robot.managed_executor import (
    RoomRunOutcome,
    _async_wait_for_owned_resume,
    _LegOutcomeObserver,
)
from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom

SERIAL = "synthetic-pause-episode-robot"
ENTITY_ID = "vacuum.synthetic_pause_episode"
ROOM = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
SESSION_IDENTITY = b"synthetic-pause-session"


@pytest.fixture
def hass_storage() -> dict:
    """Use an isolated Store mapping for suspension accounting assertions."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep Store files in the test config directory."""
    return hass_tmp_config_dir


async def test_paused_then_low_charge_return_commits_once_per_episode(hass):
    """A low-charge terminal inside a paused episode cannot queue a second suspend."""
    hass.states.async_set(ENTITY_ID, "cleaning", {"current_area": ROOM.name})
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_mark_started(SERIAL, "synthetic-plan", ROOM)
    observer = _LegOutcomeObserver(
        hass,
        ENTITY_ID,
        [ROOM],
        ROOM,
        initial_observed=True,
    )
    write_started = asyncio.Event()
    allow_write = asyncio.Event()
    suspend_writes = 0
    original_save = manager._store.async_save

    async def observe_save(data) -> None:
        nonlocal suspend_writes
        active = data["robots"][SERIAL]["active_plan"]
        if active["status"] == "suspended":
            suspend_writes += 1
            write_started.set()
            await allow_write.wait()
        await original_save(data)

    manager._store.async_save = observe_save
    try:
        hass.states.async_set(ENTITY_ID, "paused", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        assert (await observer.next())[0] is RoomRunOutcome.PAUSED
        episode_resume = observer.resume_event

        # Hold the first suspension commit while the observer sees the exact
        # pause -> low-charge return -> target-room resume sequence.
        suspend = asyncio.create_task(
            manager.async_mark_suspended(SERIAL, "synthetic-plan", ROOM, "paused")
        )
        await asyncio.wait_for(write_started.wait(), timeout=1)
        hass.states.async_set(
            ENTITY_ID,
            "returning",
            {"current_area": ROOM.name, "low_charge": True},
        )
        await hass.async_block_till_done()
        hass.states.async_set(ENTITY_ID, "cleaning", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        assert observer.resume_event is episode_resume
        assert episode_resume.is_set()

        allow_write.set()
        await asyncio.wait_for(suspend, timeout=2)
        await _async_wait_for_owned_resume(
            hass,
            ENTITY_ID,
            1,
            None,
            ROOM,
            AsyncMock(return_value=SESSION_IDENTITY),
            SESSION_IDENTITY,
            resume_event=episode_resume,
        )
        await manager.async_mark_resumed(SERIAL, "synthetic-plan", ROOM)

        # The executor consumes one observer outcome per suspension write. No
        # second outcome means this episode cannot increment suspended runs or
        # cause duplicate full-root Store churn.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(observer.next(), timeout=0.02)
        assert suspend_writes == 1
        assert manager.snapshot(SERIAL)["active_plan"]["status"] == "running"
    finally:
        allow_write.set()
        observer.close()
