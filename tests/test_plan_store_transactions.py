"""Shared Store commits must not capture another robot's uncommitted state."""

from __future__ import annotations

import asyncio
import json

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util.file import WriteError

from custom_components.matic_robot.plans import CleaningPlanManager

PEER = "synthetic-peer-robot"
TARGET = "synthetic-target-robot"


@pytest.fixture
def hass_storage() -> dict:
    """Use the real Home Assistant Store instead of the test plugin mock."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep Store files in the test's isolated configuration directory."""
    return hass_tmp_config_dir


async def test_failed_plan_write_is_not_persisted_by_queued_peer_write(
    hass, monkeypatch
) -> None:
    """A failed plan remains isolated from an earlier peer Store payload."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager._store_lock.acquire()
    payloads: list[dict] = []
    original_write = Store._write_prepared_data

    def fail_target_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            envelope = json.loads(payload)
            robots = envelope["data"]["robots"]
            payloads.append(robots)
            if robots.get(TARGET, {}).get("plans", {}).get("rejected-plan"):
                raise WriteError("synthetic target write failure")
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", fail_target_write)
    peer_save = None
    target_save = None
    try:
        peer_save = asyncio.create_task(
            manager.async_save_plan(PEER, "peer-plan", {"name": "Peer"})
        )
        await asyncio.sleep(0)
        target_save = asyncio.create_task(
            manager.async_save_plan(TARGET, "rejected-plan", {"name": "Rejected"})
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert TARGET not in manager._data["robots"]
        manager._store_lock.release()
    finally:
        if manager._store_lock.locked():
            manager._store_lock.release()
        assert peer_save is not None and target_save is not None
        peer_result, target_result = await asyncio.gather(
            peer_save, target_save, return_exceptions=True
        )

    assert peer_result is None
    assert isinstance(target_result, HomeAssistantError)
    assert str(target_result) == "Cleaning plan state could not be saved"
    assert len(payloads) == 2
    assert TARGET not in payloads[0]
    assert payloads[1][TARGET]["plans"]["rejected-plan"]["name"] == "Rejected"
    assert "rejected-plan" not in manager._data["robots"][TARGET]["plans"]
    assert manager._data["robots"][PEER]["plans"]["peer-plan"]["name"] == "Peer"

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert "rejected-plan" not in reloaded._data["robots"].get(TARGET, {}).get(
        "plans", {}
    )
    assert reloaded._data["robots"][PEER]["plans"]["peer-plan"]["name"] == "Peer"
