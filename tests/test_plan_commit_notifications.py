"""Public plan commits isolate listener failures and survive waiter cancellation."""

from __future__ import annotations

import asyncio
import json
import logging
import threading

import pytest
from homeassistant.helpers.storage import Store

from custom_components.matic_robot.plans import CleaningPlanManager

SERIAL = "synthetic-commit-robot"
PEER = "synthetic-commit-peer"


@pytest.fixture
def hass_storage() -> dict:
    """Use Home Assistant's real Store implementation."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep Store files in the isolated test configuration directory."""
    return hass_tmp_config_dir


async def test_listener_failure_does_not_reject_or_rollback_committed_plan(
    hass, caplog
) -> None:
    """One bad listener cannot turn a durable plan write into a failed call."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    called: list[str] = []

    def broken_listener() -> None:
        called.append("broken")
        raise RuntimeError("synthetic private listener detail")

    def following_listener() -> None:
        called.append("following")

    manager.async_add_listener(SERIAL, broken_listener)
    manager.async_add_listener(SERIAL, following_listener)

    with caplog.at_level(logging.DEBUG):
        await manager.async_save_plan(SERIAL, "home", {"name": "Home"})

    assert sorted(called) == ["broken", "following"]
    assert manager.plan(SERIAL, "home")["name"] == "Home"
    assert "listener" in caplog.text.casefold()
    assert "synthetic private listener detail" not in caplog.text

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.plan(SERIAL, "home")["name"] == "Home"


@pytest.mark.parametrize("held_lock", ("state", "plan_write"))
async def test_cancelled_plan_before_owned_admission_does_not_mutate(
    hass, monkeypatch, held_lock: str
) -> None:
    """Cancellation at either required admission fence creates no commit."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    writes = 0
    write_payloads: list[str] = []
    original_write = Store._write_prepared_data

    def count_writes(store, mode: str, payload: str | bytes) -> None:
        nonlocal writes
        if store is manager._store:
            writes += 1
            write_payloads.append(
                payload.decode() if isinstance(payload, bytes) else payload
            )
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", count_writes)
    held = (
        manager.state_lock(SERIAL)
        if held_lock == "state"
        else manager.plan_write_lock(SERIAL)
    )
    await held.acquire()
    waiter = asyncio.create_task(
        manager.async_save_plan(SERIAL, "not-admitted", {"name": "No"})
    )
    try:
        await asyncio.sleep(0)
        assert not waiter.done()
        assert "not-admitted" not in manager._robot(SERIAL)["plans"]
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
    finally:
        held.release()

    await asyncio.wait_for(manager.async_cancel_and_wait(SERIAL), timeout=3)
    await asyncio.wait_for(manager._async_wait_metadata_persistence(SERIAL), timeout=3)
    assert writes == 0, write_payloads
    assert "not-admitted" not in manager._robot(SERIAL)["plans"]
    assert SERIAL not in manager._metadata_persistence_tasks
    assert not manager.plan_write_lock(SERIAL).locked()
    assert not manager.state_lock(SERIAL).locked()

    await manager.async_save_plan(SERIAL, "after-cancel", {"name": "After"})
    assert manager.plan(SERIAL, "after-cancel")["name"] == "After"

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert "not-admitted" not in reloaded._robot(SERIAL)["plans"]
    assert reloaded.plan(SERIAL, "after-cancel")["name"] == "After"


async def test_cancelled_plan_waiter_drains_owned_real_store_commit_before_peer(
    hass, monkeypatch
) -> None:
    """Cancellation reaches the waiter while its accepted write remains owned."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    write_finished = asyncio.Event()
    peer_store_call = asyncio.Event()
    release_write = threading.Event()
    write_payloads: list[tuple[str, dict]] = []
    original_write = Store._write_prepared_data
    original_async_save = manager._store.async_save
    first_write_paused = False

    def pause_target_write(store, mode: str, payload: str | bytes) -> None:
        nonlocal first_write_paused
        if store is manager._store:
            envelope = json.loads(payload)
            write_payloads.append((mode, envelope))
            if not first_write_paused:
                first_write_paused = True
                loop.call_soon_threadsafe(write_started.set)
                if not release_write.wait(timeout=30):
                    raise TimeoutError("test did not release the real Store write")
                try:
                    original_write(store, mode, payload)
                finally:
                    loop.call_soon_threadsafe(write_finished.set)
                return
        original_write(store, mode, payload)

    async def observe_async_save(data) -> None:
        if PEER in data.get("robots", {}):
            peer_store_call.set()
        await original_async_save(data)

    monkeypatch.setattr(Store, "_write_prepared_data", pause_target_write)
    monkeypatch.setattr(manager._store, "async_save", observe_async_save)

    target_waiter = asyncio.create_task(
        manager.async_save_plan(SERIAL, "accepted", {"name": "Accepted"})
    )
    peer_waiter = None
    unload_drain = None
    try:
        await asyncio.wait_for(write_started.wait(), timeout=3)
        assert not target_waiter.done()
        target_waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await target_waiter

        peer_waiter = asyncio.create_task(
            manager.async_save_plan(PEER, "peer", {"name": "Peer"})
        )
        unload_drain = asyncio.create_task(manager.async_cancel_and_wait(SERIAL))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not peer_store_call.is_set()
        assert not peer_waiter.done()
        assert not unload_drain.done()

        # The queued peer must serialize only after the canceled waiter's
        # accepted transaction has either committed or rolled back.
        release_write.set()
        await asyncio.wait_for(write_finished.wait(), timeout=3)
        await asyncio.wait_for(unload_drain, timeout=3)
        await asyncio.wait_for(peer_waiter, timeout=3)
        await asyncio.wait_for(
            manager._async_wait_metadata_persistence(SERIAL), timeout=3
        )
    finally:
        release_write.set()
        if not target_waiter.done():
            target_waiter.cancel()
        if peer_waiter is not None and not peer_waiter.done():
            await asyncio.gather(peer_waiter, return_exceptions=True)
        if unload_drain is not None and not unload_drain.done():
            await asyncio.gather(unload_drain, return_exceptions=True)
        if write_started.is_set():
            await asyncio.wait_for(write_finished.wait(), timeout=3)

    assert peer_store_call.is_set()
    assert len(write_payloads) == 2
    first_robots = write_payloads[0][1]["data"]["robots"]
    second_robots = write_payloads[1][1]["data"]["robots"]
    assert first_robots[SERIAL]["plans"]["accepted"]["name"] == "Accepted"
    assert PEER not in first_robots
    assert second_robots[SERIAL]["plans"]["accepted"]["name"] == "Accepted"
    assert second_robots[PEER]["plans"]["peer"]["name"] == "Peer"
    assert manager.plan(SERIAL, "accepted")["name"] == "Accepted"
    assert manager.plan(PEER, "peer")["name"] == "Peer"
    assert SERIAL not in manager._metadata_persistence_tasks
    assert not manager._store_lock.locked()

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.plan(SERIAL, "accepted")["name"] == "Accepted"
    assert reloaded.plan(PEER, "peer")["name"] == "Peer"
