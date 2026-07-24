"""Tests for private photorealistic map persistence."""

from __future__ import annotations

import base64
from unittest.mock import patch

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
