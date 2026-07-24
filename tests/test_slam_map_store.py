"""Tests for private photorealistic map persistence."""

from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.slam_map_store import SlamMapStore
from tests.test_slam_map import synthetic_slam_entry


async def test_slam_map_store_round_trips_replaces_and_removes(hass) -> None:
    store = SlamMapStore(hass, "synthetic-entry")
    await store.async_load()
    entry = synthetic_slam_entry()

    tile = await store.async_add(entry)
    assert store.tile_count == 1
    assert store.revision == 1
    assert store.decoded_tiles() == (tile,)

    await store.async_add(entry)
    assert store.revision == 1

    restored = SlamMapStore(hass, "synthetic-entry")
    await restored.async_load()
    assert restored.tile_count == 1
    assert restored.revision == 1

    replacement = synthetic_slam_entry(mission=b"synthetic-new-mission")
    await restored.async_add(replacement)
    assert restored.tile_count == 1
    assert restored.revision == 2
    assert restored.decoded_tiles()[0].mission_token != tile.mission_token

    await restored.async_remove()
    assert restored.tile_count == 0
    assert restored.revision == 3

    empty = SlamMapStore(hass, "synthetic-entry")
    await empty.async_load()
    assert empty.tile_count == 0


async def test_slam_map_store_ignores_corrupt_private_cache(hass) -> None:
    store = SlamMapStore(hass, "corrupt-entry")
    await store._store.async_save(
        {
            "tiles": [
                {"key": "not base64!", "value": "also invalid"},
                {"key": "a2V5"},
            ]
        }
    )

    await store.async_load()

    assert store.tile_count == 0
    assert store.decoded_tiles() == ()


async def test_slam_map_store_skips_corruption_after_load(hass) -> None:
    store = SlamMapStore(hass, "runtime-corruption")
    await store.async_load()
    store._entries["bad"] = HermesCollectionEntry(b"bad", b"bad")

    assert store.decoded_tiles() == ()


async def test_slam_map_store_resets_missions_and_enforces_load_bound(hass) -> None:
    store = SlamMapStore(hass, "mission-entry")
    first = synthetic_slam_entry(mission=b"first")
    second = synthetic_slam_entry(mission=b"second")
    await store._store.async_save(
        {
            "tiles": [
                {
                    "key": base64.b64encode(item.key).decode(),
                    "value": base64.b64encode(item.value).decode(),
                }
                for item in (first, second)
            ]
        }
    )

    await store.async_load()
    assert store.tile_count == 1

    bounded = SlamMapStore(hass, "mission-entry")
    with patch("custom_components.matic_robot.slam_map_store.MAX_STORED_BYTES", 1):
        await bounded.async_load()
    assert bounded.tile_count == 0


async def test_slam_map_store_evicts_over_limit(hass) -> None:
    store = SlamMapStore(hass, "bounded-entry")
    await store.async_load()

    with patch("custom_components.matic_robot.slam_map_store.MAX_TILES", 0):
        await store.async_add(synthetic_slam_entry())

    assert store.tile_count == 0


async def test_slam_map_store_collects_live_pages_and_skips_corruption(hass) -> None:
    store = SlamMapStore(hass, "live-entry")
    await store.async_load()

    async def live_entries(name):
        assert name == "map_compressed_rgb"
        yield synthetic_slam_entry()
        yield HermesCollectionEntry(b"bad", b"bad")
        raise asyncio.CancelledError

    client = SimpleNamespace(async_subscribe_collection_entries=live_entries)

    with pytest.raises(asyncio.CancelledError):
        await store.async_collect(client)
    assert store.tile_count == 1


@pytest.mark.parametrize("fail_stream", [True, False])
async def test_slam_map_store_retries_failed_or_finished_streams(
    hass, fail_stream
) -> None:
    store = SlamMapStore(hass, "retry-entry")

    async def entries(name):
        if fail_stream:
            raise CannotConnectError("synthetic disconnect")
        if False:
            yield HermesCollectionEntry(b"", b"")

    client = SimpleNamespace(async_subscribe_collection_entries=entries)

    with (
        patch(
            "custom_components.matic_robot.slam_map_store.asyncio.sleep",
            side_effect=asyncio.CancelledError,
        ) as sleep,
        pytest.raises(asyncio.CancelledError),
    ):
        await store.async_collect(client)
    sleep.assert_awaited_once()
