"""Tests for private, bounded SLAM scene history."""

from __future__ import annotations

import asyncio
import base64
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.slam_map import (
    decode_slam_tile,
    encode_slam_scene,
)
from custom_components.matic_robot.slam_history import (
    MIN_HISTORY_INTERVAL_SECONDS,
    SlamHistoryStore,
    _decode_history,
    _decompress_scene,
    async_collect_slam_history,
)
from tests.test_slam_map import synthetic_slam_entry


def _scene(*, page_x: int = 0) -> bytes:
    return encode_slam_scene((decode_slam_tile(synthetic_slam_entry(page_x=page_x)),))


async def test_history_round_trips_replaces_recent_and_removes(hass) -> None:
    store = SlamHistoryStore(hass, "synthetic-entry")
    await store.async_load()
    started = datetime(2026, 7, 26, 12, 0, tzinfo=UTC)

    assert await store.async_add(_scene(), 1, created_at=started) is True
    assert await store.async_add(_scene(), 1, created_at=started) is False
    assert (
        await store.async_add(
            _scene(page_x=1),
            2,
            created_at=started + timedelta(seconds=30),
        )
        is True
    )
    assert len(store.catalog()) == 1
    assert store.catalog()[0].revision == 2
    assert await store.async_scene(store.catalog()[0].snapshot_id) == _scene(page_x=1)
    assert await store.async_scene("missing") is None

    assert (
        await store.async_add(
            _scene(page_x=2),
            3,
            created_at=started + timedelta(seconds=MIN_HISTORY_INTERVAL_SECONDS + 30),
        )
        is True
    )
    assert len(store.catalog()) == 2
    await store.async_shutdown()

    restored = SlamHistoryStore(hass, "synthetic-entry")
    await restored.async_load()
    assert [snapshot.revision for snapshot in restored.catalog()] == [2, 3]
    await restored.async_remove()
    empty = SlamHistoryStore(hass, "synthetic-entry")
    await empty.async_load()
    assert empty.catalog() == ()


async def test_history_rejects_add_after_shutdown_and_invalid_revision(hass) -> None:
    store = SlamHistoryStore(hass, "closed-entry")
    await store.async_load()
    await store.async_shutdown()
    assert await store.async_add(_scene(), 1) is False
    store._schedule_save()
    await store.async_shutdown()

    active = SlamHistoryStore(hass, "invalid-entry")
    await active.async_load()
    with pytest.raises(DecodeError, match="revision"):
        await active.async_add(_scene(), -1)
    with pytest.raises(DecodeError, match="time zone"):
        await active.async_add(
            _scene(),
            1,
            created_at=datetime(2026, 7, 26, 12, 0),
        )
    with (
        patch(
            "custom_components.matic_robot.slam_history.MAX_HISTORY_COMPRESSED_BYTES",
            1,
        ),
        pytest.raises(DecodeError, match="storage bounds"),
    ):
        await active.async_add(_scene(), 1)


async def test_history_load_repairs_corrupt_storage(hass) -> None:
    store = SlamHistoryStore(hass, "repair-entry")
    await store._store.async_save("invalid")
    with patch("custom_components.matic_robot.slam_history.SAVE_DELAY_SECONDS", 0):
        await store.async_load()
    await asyncio.sleep(0)
    await hass.async_block_till_done()
    assert store.catalog() == ()


async def test_history_bounds_items_and_total_bytes(hass) -> None:
    store = SlamHistoryStore(hass, "bounds-entry")
    await store.async_load()
    started = datetime(2026, 7, 26, tzinfo=UTC)
    with patch("custom_components.matic_robot.slam_history.MAX_HISTORY_ITEMS", 2):
        for index in range(3):
            await store.async_add(
                _scene(page_x=index),
                index,
                created_at=started + timedelta(hours=index),
            )
    assert [snapshot.revision for snapshot in store.catalog()] == [1, 2]

    latest_size = len(store.catalog()[-1].compressed)
    with patch(
        "custom_components.matic_robot.slam_history.MAX_HISTORY_COMPRESSED_BYTES",
        latest_size * 2,
    ):
        await store.async_add(
            _scene(page_x=4),
            4,
            created_at=started + timedelta(hours=4),
        )
    assert [snapshot.revision for snapshot in store.catalog()] == [4]


def test_history_decoder_repairs_invalid_private_storage() -> None:
    scene = _scene()
    valid_store = SlamHistoryStore.__new__(SlamHistoryStore)
    del valid_store
    compressed = __import__("zlib").compress(scene)
    snapshot_id = __import__("hashlib").sha256(scene).hexdigest()[:24]
    valid = {
        "id": snapshot_id,
        "created_at": "2026-07-26T12:00:00+00:00",
        "revision": 1,
        "point_count": 1025,
        "scene": base64.b64encode(compressed).decode(),
    }
    snapshots, dirty = _decode_history(
        {
            "snapshots": [
                None,
                {**valid, "id": "invalid"},
                {**valid, "scene": "not-base64"},
                valid,
            ]
        }
    )
    assert dirty is True
    assert len(snapshots) == 1
    mismatched = {**valid, "id": "0" * 24}
    assert _decode_history({"snapshots": [mismatched]}) == ([], True)
    assert _decode_history("invalid") == ([], True)
    assert _decode_history({"snapshots": "invalid"}) == ([], True)


def test_history_decompression_is_bounded() -> None:
    scene = _scene()
    compressed = __import__("zlib").compress(scene)
    with patch(
        "custom_components.matic_robot.slam_history.MAX_SCENE_BYTES",
        len(scene) - 1,
    ):
        with pytest.raises(DecodeError, match="bounds"):
            _decompress_scene(compressed)
    with pytest.raises(DecodeError, match="bounds"):
        _decompress_scene(compressed[:-1])
    with pytest.raises(DecodeError, match="bounds"):
        _decompress_scene(compressed + b"trailing")


async def test_history_collector_captures_stable_complete_revision(hass) -> None:
    listeners = []
    remove_listener = MagicMock()
    slam_map = SimpleNamespace(
        revision=4,
        map_complete=True,
        entries=MagicMock(return_value=(synthetic_slam_entry(),)),
        async_add_listener=MagicMock(
            side_effect=lambda listener: listeners.append(listener) or remove_listener
        ),
    )
    history = SimpleNamespace(async_add=AsyncMock())
    task = asyncio.create_task(
        async_collect_slam_history(hass, slam_map, history, lambda: None)
    )
    try:
        with patch("custom_components.matic_robot.slam_history.MAP_SETTLE_SECONDS", 0):
            for _index in range(20):
                if history.async_add.await_count:
                    break
                await asyncio.sleep(0)
        history.async_add.assert_awaited_once()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_listener.assert_called_once()


async def test_history_collector_retries_churn_and_skips_incomplete(hass) -> None:
    listener = None

    def subscribe(callback):
        nonlocal listener
        listener = callback
        return MagicMock()

    slam_map = SimpleNamespace(
        revision=1,
        map_complete=False,
        entries=MagicMock(return_value=(synthetic_slam_entry(),)),
        async_add_listener=MagicMock(side_effect=subscribe),
    )
    history = SimpleNamespace(async_add=AsyncMock())
    task = asyncio.create_task(
        async_collect_slam_history(hass, slam_map, history, lambda: None)
    )
    with patch("custom_components.matic_robot.slam_history.MAP_SETTLE_SECONDS", 0):
        await asyncio.sleep(0)
        assert listener is not None
        slam_map.map_complete = True
        slam_map.revision = 2
        listener()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        slam_map.revision = 3
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert history.async_add.await_count <= 1


@pytest.mark.parametrize(
    ("entries", "complete"),
    [((synthetic_slam_entry(),), False), ((), True)],
)
async def test_history_collector_skips_incomplete_or_undecodable_scene(
    entries, complete
) -> None:
    remove_listener = MagicMock()
    slam_map = SimpleNamespace(
        revision=1,
        map_complete=complete,
        entries=MagicMock(return_value=entries),
        async_add_listener=MagicMock(return_value=remove_listener),
    )
    history = SimpleNamespace(async_add=AsyncMock())
    fake_hass = SimpleNamespace(
        async_add_executor_job=AsyncMock(side_effect=lambda target: target())
    )
    task = asyncio.create_task(
        async_collect_slam_history(fake_hass, slam_map, history, lambda: None)
    )
    try:
        with patch("custom_components.matic_robot.slam_history.MAP_SETTLE_SECONDS", 0):
            for _index in range(5):
                await asyncio.sleep(0)
        history.async_add.assert_not_awaited()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_listener.assert_called_once()


async def test_history_collector_discards_scene_after_revision_change() -> None:
    remove_listener = MagicMock()
    slam_map = SimpleNamespace(
        revision=1,
        map_complete=True,
        entries=MagicMock(return_value=(synthetic_slam_entry(),)),
        async_add_listener=MagicMock(return_value=remove_listener),
    )

    async def encode_then_advance(target):
        scene = target()
        slam_map.revision = 2
        return scene

    fake_hass = SimpleNamespace(async_add_executor_job=encode_then_advance)
    history = SimpleNamespace(async_add=AsyncMock())
    task = asyncio.create_task(
        async_collect_slam_history(fake_hass, slam_map, history, lambda: None)
    )
    try:
        with patch("custom_components.matic_robot.slam_history.MAP_SETTLE_SECONDS", 0):
            for _index in range(10):
                if slam_map.revision == 2:
                    break
                await asyncio.sleep(0)
        history.async_add.assert_not_awaited()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_listener.assert_called_once()
