"""Tests for private, bounded SLAM scene history."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import zlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot import slam_delta
from custom_components.matic_robot import slam_history_collector as history_collector
from custom_components.matic_robot import slam_history_format as history_format
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.client.slam_scene import (
    encode_slam_scene,
)
from custom_components.matic_robot.client.slam_tiles import (
    decode_slam_structure_tile,
    decode_slam_tile,
)
from custom_components.matic_robot.slam_delta import MAX_SCENE_BYTES
from custom_components.matic_robot.slam_history import (
    MAX_ACTIVE_HISTORY_READ_BYTES,
    MAX_ACTIVE_HISTORY_READS,
    MIN_HISTORY_INTERVAL_SECONDS,
    HistoryReadCapacityError,
    SlamHistoryStore,
)
from custom_components.matic_robot.slam_history_collector import (
    async_collect_slam_history,
)
from custom_components.matic_robot.slam_history_format import (
    _build_snapshot,
    _decode_history,
    _decompress_scene,
    _enforce_history_bounds,
)
from custom_components.matic_robot.slam_map_store import SlamMapIdentity
from tests.test_slam_map import synthetic_slam_entry, synthetic_structure_entry


def _scene(*, page_x: int = 0, mission_id: int = 0x1234ABCD) -> bytes:
    return encode_slam_scene(
        (decode_slam_tile(synthetic_slam_entry(page_x=page_x, mission_id=mission_id)),)
    )


def _scene_with_structure() -> bytes:
    return encode_slam_scene(
        (decode_slam_tile(synthetic_slam_entry()),),
        structure_tiles=(decode_slam_structure_tile(synthetic_structure_entry()),),
    )


@pytest.mark.parametrize("value", ["A" * 16, b"AAAA"])
def test_stored_history_admission_precedes_base64_allocation(monkeypatch, value):
    monkeypatch.setattr(history_format, "MAX_HISTORY_COMPRESSED_BYTES", 3)
    item = {
        "id": "0" * 24,
        "created_at": "2026-07-26T00:00:00+00:00",
        "revision": 1,
        "point_count": 1,
        "scene": value,
    }
    with patch.object(history_format.base64, "b64decode") as decode:
        assert _decode_history({"snapshots": [item]}) == ([], True)
    decode.assert_not_called()


def _identity(mission_id: int = 0x1234ABCD) -> SlamMapIdentity:
    tile = decode_slam_tile(synthetic_slam_entry(mission_id=mission_id))
    return SlamMapIdentity(tile.mission_token, tile.mission_id)


def _floor_plan() -> FloorPlan:
    return FloorPlan(
        0x1234ABCD,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room(
                "room-1",
                "Synthetic room",
                "protocol-1",
                b"room",
                ((0.0, 0.0), (0.3, 0.0), (0.3, 0.3)),
            ),
        ),
    )


async def test_history_is_scoped_per_floor_mission(hass) -> None:
    store = SlamHistoryStore(hass, "multi-floor-entry")
    await store.async_load()
    started = datetime(2026, 7, 26, 12, 0, tzinfo=UTC)
    first = _identity(1)
    second = _identity(2)

    assert await store.async_add(
        _scene(mission_id=1),
        1,
        created_at=started,
        mission_token=first.mission_token,
    )
    assert await store.async_add(
        _scene(mission_id=2),
        2,
        created_at=started + timedelta(seconds=30),
        mission_token=second.mission_token,
    )

    assert len(store.catalog()) == 2
    first_revisions = [
        item.revision for item in store.catalog_for_mission(first.mission_token)
    ]
    second_revisions = [
        item.revision for item in store.catalog_for_mission(second.mission_token)
    ]
    assert first_revisions == [1]
    assert second_revisions == [2]
    assert store.catalog_for_mission(None) == ()
    assert [
        (mission_token, [snapshot.revision for snapshot in snapshots])
        for mission_token, snapshots in store.catalogs_by_mission()
    ] == [
        (second.mission_token, [2]),
        (first.mission_token, [1]),
    ]
    await store.async_shutdown()

    restored = SlamHistoryStore(hass, "multi-floor-entry")
    await restored.async_load()
    assert [
        item.revision for item in restored.catalog_for_mission(second.mission_token)
    ] == [2]


@pytest.mark.parametrize("close_method", ["async_remove", "async_shutdown"])
async def test_history_discards_encoding_finished_after_close(hass, close_method):
    store = SlamHistoryStore(hass, "closing-history")
    await store.async_load()
    listener = MagicMock()
    store.async_add_listener(listener)
    started = asyncio.Event()
    release = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_encoding(function, *args):
        if function.__name__ == "_build_snapshot":
            started.set()
            await release.wait()
        return await executor(function, *args)

    with patch.object(hass, "async_add_executor_job", delayed_encoding):
        addition = asyncio.create_task(store.async_add(_scene(), 1))
        await started.wait()
        await getattr(store, close_method)()
        release.set()
        assert await addition is False

    assert store.catalog() == ()
    listener.assert_not_called()
    restored = SlamHistoryStore(hass, "closing-history")
    await restored.async_load()
    assert restored.catalog() == ()


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
    assert store.catalogs_by_mission() == ()
    await store.async_shutdown()

    restored = SlamHistoryStore(hass, "synthetic-entry")
    await restored.async_load()
    assert [snapshot.revision for snapshot in restored.catalog()] == [2, 3]
    await restored.async_remove()
    empty = SlamHistoryStore(hass, "synthetic-entry")
    await empty.async_load()
    assert empty.catalog() == ()


async def test_history_capture_persists_verified_structural_support(hass) -> None:
    store = SlamHistoryStore(hass, "coverage-entry")
    await store.async_load()
    scene = _scene_with_structure()
    assert await store.async_add(scene, 1, mission_token=_identity().mission_token)
    snapshot = store.catalog()[0]
    assert snapshot.record_id != snapshot.snapshot_id
    assert snapshot.comparison_group == store.public_group(_identity().mission_token)
    assert snapshot.frame is not None
    assert snapshot.frame["coverage"]["status"] == "verified"
    assert snapshot.frame["diff_eligible"] is True
    assert await store.async_scene(snapshot.record_id) == scene
    await store.async_shutdown()


async def test_history_keep_trash_restore_and_idempotent_generation(hass) -> None:
    store = SlamHistoryStore(hass, "lifecycle-entry")
    await store.async_load()
    assert await store.async_add(_scene(), 1, mission_token=_identity().mission_token)
    record_id = store.catalog()[0].record_id
    kept = await store.async_mutate(
        "keep",
        [record_id],
        expected_generation=store.generation,
        request_id="keep-once",
        name="Kitchen before remodel",
    )
    assert store.catalog()[0].retention == "kept"
    assert store.catalog()[0].name == "Kitchen before remodel"
    assert (
        await store.async_mutate(
            "keep",
            [record_id],
            expected_generation=0,
            request_id="keep-once",
            name="Kitchen before remodel",
        )
        == kept
    )
    with pytest.raises(ValueError, match="generation-conflict"):
        await store.async_mutate(
            "rename",
            [record_id],
            expected_generation=0,
            request_id="stale",
            name="Old name",
        )
    deleted = await store.async_mutate(
        "delete",
        [record_id],
        expected_generation=store.generation,
        request_id="delete-once",
        allow_kept=True,
    )
    assert store.catalog()[0].retention == "trash"
    assert await store.async_scene(record_id) is None
    assert (
        await store.async_mutate(
            "delete",
            [record_id],
            expected_generation=0,
            request_id="delete-once",
            allow_kept=True,
        )
        == deleted
    )
    restored = await store.async_mutate(
        "restore",
        [record_id],
        expected_generation=store.generation,
        request_id="restore-once",
    )
    assert restored["generation"] == store.generation
    assert store.catalog()[0].retention == "kept"
    await store.async_shutdown()


async def test_history_expired_trash_and_bounded_archive_import(hass) -> None:
    store = SlamHistoryStore(hass, "archive-entry")
    await store.async_load()
    assert await store.async_add(_scene(), 1, mission_token=_identity().mission_token)
    original = store.catalog()[0]
    archive = await store.async_export(
        [original.record_id], expected_generation=store.generation
    )
    response = await store.async_import(
        archive, expected_generation=store.generation, request_id="import-once"
    )
    assert (
        await store.async_import(
            archive, expected_generation=0, request_id="import-once"
        )
        == response
    )
    imported = next(
        item for item in store.catalog() if item.record_id == response["record_ids"][0]
    )
    assert imported.imported is True
    assert imported.record_id != original.record_id
    assert imported.source_id == original.record_id
    assert imported.mission_token is None
    assert imported.comparison_group is None
    assert imported.frame is not None and imported.frame["diff_eligible"] is False
    await store.async_mutate(
        "delete",
        [imported.record_id],
        expected_generation=store.generation,
        request_id="trash-import",
        allow_kept=True,
    )
    expired = datetime.now(UTC) + timedelta(hours=25)
    assert await store.async_expire_trash(now=expired) == 1
    assert all(item.record_id != imported.record_id for item in store.catalog())
    await store.async_shutdown()


async def test_history_mutation_rolls_back_after_disk_error(hass) -> None:
    store = SlamHistoryStore(hass, "history-save-rollback-entry")
    await store.async_load()
    assert await store.async_add(_scene(), 1)
    record_id = store.catalog()[0].record_id
    generation = store.generation
    store._store.async_save = AsyncMock(side_effect=OSError("disk full"))

    with pytest.raises(OSError, match="disk full"):
        await store.async_mutate(
            "keep",
            [record_id],
            expected_generation=generation,
            request_id="keep-after-retry",
            name="Preserved",
        )

    assert store.generation == generation
    assert store.catalog()[0].retention == "automatic"
    assert store.catalog()[0].name is None
    store._store.async_save = AsyncMock()
    saved = await store.async_mutate(
        "keep",
        [record_id],
        expected_generation=generation,
        request_id="keep-after-retry",
        name="Preserved",
    )
    assert saved["generation"] == generation + 1
    assert store.catalog()[0].retention == "kept"
    await store.async_shutdown()


async def test_capture_in_flight_cannot_commit_after_record_delete(hass) -> None:
    store = SlamHistoryStore(hass, "history-delete-capture-race-entry")
    await store.async_load()
    assert await store.async_add(_scene(), 1)
    record_id = store.catalog()[0].record_id
    started = asyncio.Event()
    release = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_encoding(function, *args):
        if function.__name__ == "_build_snapshot":
            started.set()
            await release.wait()
        return await executor(function, *args)

    with (
        patch.object(hass, "async_add_executor_job", delayed_encoding),
        patch.object(history_format, "MAX_HISTORY_ITEMS", 1),
    ):
        addition = asyncio.create_task(store.async_add(_scene(page_x=1), 2))
        await started.wait()
        await store.async_mutate(
            "delete",
            [record_id],
            expected_generation=store.generation,
            request_id="delete-during-capture",
        )
        release.set()
        assert await addition is False

    assert [item.record_id for item in store.trash_catalog()] == [record_id]
    assert store.usage()["reserved_bytes"] == 0
    assert store.usage()["reserved_count"] == 0
    await store.async_shutdown()


async def test_capture_quota_respects_active_scene_read_lease(hass) -> None:
    store = SlamHistoryStore(hass, "history-read-lease-entry")
    await store.async_load()
    started_at = datetime.now(UTC)
    assert await store.async_add(_scene(), 1, created_at=started_at)
    record_id = store.catalog()[0].record_id
    read_started = asyncio.Event()
    release_read = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_decompression(function, *args):
        if function.__name__ == "_decompress_scene":
            read_started.set()
            await release_read.wait()
        return await executor(function, *args)

    with (
        patch.object(hass, "async_add_executor_job", delayed_decompression),
        patch.object(history_format, "MAX_HISTORY_ITEMS", 1),
    ):
        reading = asyncio.create_task(store.async_scene(record_id))
        await read_started.wait()
        assert store._active_reads[record_id] == 1
        assert (
            await store.async_add(
                _scene(page_x=1),
                2,
                created_at=started_at + timedelta(minutes=6),
            )
            is False
        )
        assert [item.record_id for item in store.catalog()] == [record_id]
        release_read.set()
        assert await reading == _scene()
        assert record_id not in store._active_reads
        assert await store.async_add(
            _scene(page_x=1),
            2,
            created_at=started_at + timedelta(minutes=6),
        )

    assert [item.revision for item in store.catalog()] == [2]
    await store.async_shutdown()


async def test_scene_read_cannot_lease_a_reserved_capture_victim(hass) -> None:
    store = SlamHistoryStore(hass, "history-reserved-victim-entry")
    await store.async_load()
    started_at = datetime.now(UTC)
    assert await store.async_add(_scene(), 1, created_at=started_at)
    record_id = store.catalog()[0].record_id
    encoding_started = asyncio.Event()
    release_encoding = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_encoding(function, *args):
        if function.__name__ == "_build_snapshot":
            encoding_started.set()
            await release_encoding.wait()
        return await executor(function, *args)

    with (
        patch.object(hass, "async_add_executor_job", delayed_encoding),
        patch.object(history_format, "MAX_HISTORY_ITEMS", 1),
    ):
        addition = asyncio.create_task(
            store.async_add(
                _scene(page_x=1),
                2,
                created_at=started_at + timedelta(minutes=6),
            )
        )
        await encoding_started.wait()
        assert record_id in store._reserved_victims
        with pytest.raises(HistoryReadCapacityError):
            await store.async_scene(record_id)
        release_encoding.set()
        assert await addition

    assert [snapshot.revision for snapshot in store.catalog()] == [2]
    await store.async_shutdown()


async def test_scene_read_budget_holds_until_cancelled_decode_finishes(hass) -> None:
    store = SlamHistoryStore(hass, "history-read-budget-entry")
    await store.async_load()
    assert await store.async_add(_scene(), 1)
    record_id = store.catalog()[0].record_id
    started_count = 0
    first_started = asyncio.Event()
    all_started = asyncio.Event()
    release_decode = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_decompression(function, *args):
        nonlocal started_count
        if function.__name__ == "_decompress_scene":
            started_count += 1
            first_started.set()
            if started_count == MAX_ACTIVE_HISTORY_READS:
                all_started.set()
            await release_decode.wait()
        return await executor(function, *args)

    with patch.object(hass, "async_add_executor_job", delayed_decompression):
        cancelled = asyncio.create_task(store.async_scene(record_id))
        await first_started.wait()
        assert store.usage()["active_read_count"] == 1
        assert store.usage()["active_read_bytes"] == MAX_SCENE_BYTES
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled

        # The coroutine is gone, but the executor decode still owns its lease.
        assert store.usage()["active_read_count"] == 1
        read = asyncio.create_task(store.async_scene(record_id))
        await all_started.wait()
        assert store.usage()["active_read_count"] == MAX_ACTIVE_HISTORY_READS
        assert store.usage()["active_read_bytes"] == MAX_ACTIVE_HISTORY_READ_BYTES
        with pytest.raises(HistoryReadCapacityError):
            await store.async_scene(record_id)

        release_decode.set()
        assert await read == _scene()
        await asyncio.sleep(0)

    assert store.usage()["active_read_count"] == 0
    assert store.usage()["active_read_bytes"] == 0
    await store.async_shutdown()


async def test_history_listener_only_notifies_catalog_mutations(hass) -> None:
    store = SlamHistoryStore(hass, "listener-entry")
    await store.async_load()
    listener = MagicMock()
    remove_listener = store.async_add_listener(listener)
    started = datetime(2026, 7, 26, 12, 0, tzinfo=UTC)

    assert await store.async_add(_scene(), 1, created_at=started)
    listener.assert_called_once_with()
    assert await store.async_add(_scene(), 1, created_at=started) is False
    listener.assert_called_once_with()
    assert await store.async_add(
        _scene(page_x=1), 2, created_at=started + timedelta(seconds=30)
    )
    assert listener.call_count == 2

    await store.async_remove()
    assert listener.call_count == 3
    remove_listener()
    remove_listener()
    await store.async_shutdown()
    assert listener.call_count == 3


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
    with pytest.raises(DecodeError, match="mission token"):
        await active.async_add(_scene(), 1, mission_token="z" * 64)
    with (
        patch.object(
            history_format,
            "MAX_HISTORY_COMPRESSED_BYTES",
            1,
        ),
        pytest.raises(DecodeError, match="storage bounds"),
    ):
        await active.async_add(_scene(), 1)


async def test_paused_capture_is_rechecked_after_waiting_for_mutation_lock(
    hass,
) -> None:
    store = SlamHistoryStore(hass, "paused-history-entry")
    await store.async_load()
    store._capture_paused = True
    assert await store.async_add(_scene(), 1) is False
    store._capture_paused = False

    await store._mutation_lock.acquire()
    addition = asyncio.create_task(store.async_add(_scene(), 2))
    await asyncio.sleep(0)
    store._capture_paused = True
    store._mutation_lock.release()

    assert await addition is False
    assert store.catalog() == ()
    await store.async_shutdown()


async def test_history_load_repairs_corrupt_storage(hass) -> None:
    store = SlamHistoryStore(hass, "repair-entry")
    await store._store.async_save("invalid")
    with patch("custom_components.matic_robot.slam_history.SAVE_DELAY_SECONDS", 0):
        await store.async_load()
    await asyncio.sleep(0)
    await hass.async_block_till_done()
    assert store.catalog() == ()


@pytest.mark.parametrize("field", ["created_at", "deleted_until"])
@pytest.mark.parametrize(
    "timestamp",
    [
        "0001-01-01T00:00:00+23:59",
        "9999-12-31T23:59:59-23:59",
        "2026-07-26T12:00:00",
    ],
)
async def test_history_load_discards_invalid_time_and_preserves_valid_record(
    hass, field, timestamp
) -> None:
    scene = _scene()
    valid = {
        "id": hashlib.sha256(scene).hexdigest()[:24],
        "created_at": "2026-07-26T12:00:00+00:00",
        "revision": 1,
        "point_count": 1025,
        "scene": base64.b64encode(zlib.compress(scene)).decode(),
    }
    store = SlamHistoryStore(hass, "overflow-history-entry")
    store._store.async_load = AsyncMock(
        return_value={"snapshots": [{**valid, field: timestamp}, valid]}
    )
    store._store.async_delay_save = MagicMock()

    await store.async_load()

    assert len(store.catalog()) == 1
    assert store.catalog()[0].created_at == datetime(2026, 7, 26, 12, tzinfo=UTC)
    assert store._store.async_delay_save.called
    await store.async_shutdown()


async def test_history_load_migrates_legacy_and_pauses_oversized_state(hass) -> None:
    scene = _scene_with_structure()
    identity = _identity()
    compressed = zlib.compress(scene)
    legacy = {
        "snapshots": [
            {
                "id": hashlib.sha256(scene).hexdigest()[:24],
                "created_at": "2026-07-26T12:00:00+00:00",
                "revision": 1,
                "point_count": 1025,
                "mission_token": identity.mission_token,
                "scene": base64.b64encode(compressed).decode("ascii"),
            }
        ]
    }
    migrated = SlamHistoryStore(hass, "legacy-history-entry")
    migrated._store.async_load = AsyncMock(return_value=legacy)
    migrated._store.async_delay_save = MagicMock()

    await migrated.async_load()

    snapshot = migrated.catalog()[0]
    assert snapshot.record_id != snapshot.snapshot_id
    assert snapshot.comparison_group == migrated.public_group(identity.mission_token)
    assert snapshot.frame is not None and snapshot.frame["diff_eligible"] is True
    assert migrated._store.async_delay_save.called
    await migrated.async_shutdown()

    now = datetime(2026, 7, 26, 12, 0, tzinfo=UTC)
    oversized = [
        _build_snapshot(
            _scene(mission_id=mission),
            mission,
            now + timedelta(minutes=mission),
            _identity(mission).mission_token,
            b"s" * 32,
        )
        for mission in (1, 2)
    ]
    paused = SlamHistoryStore(hass, "oversized-history-entry")
    paused._store.async_load = AsyncMock(return_value={"snapshots": []})
    with (
        patch.object(
            history_format,
            "_decode_history",
            return_value=(oversized, False),
        ),
        patch.object(history_format, "MAX_HISTORY_ITEMS", 1),
    ):
        await paused.async_load()
    assert paused.capture_paused is False
    assert paused.capacity_blocked is True
    assert len(paused.catalog()) == 2
    await paused.async_shutdown()


async def test_history_bounds_items_and_total_bytes(hass) -> None:
    store = SlamHistoryStore(hass, "bounds-entry")
    await store.async_load()
    started = datetime(2026, 7, 26, tzinfo=UTC)
    with patch.object(history_format, "MAX_HISTORY_ITEMS", 2):
        for index in range(3):
            await store.async_add(
                _scene(page_x=index),
                index,
                created_at=started + timedelta(hours=index),
            )
    assert [snapshot.revision for snapshot in store.catalog()] == [1, 2]

    latest_size = len(store.catalog()[-1].compressed)
    with (
        patch.object(
            history_format,
            "MAX_HISTORY_COMPRESSED_BYTES",
            latest_size * 2,
        ),
        patch(
            "custom_components.matic_robot.slam_history._reservation_bytes",
            return_value=1,
        ),
    ):
        await store.async_add(
            _scene(page_x=4),
            4,
            created_at=started + timedelta(hours=4),
        )
    assert [snapshot.revision for snapshot in store.catalog()] == [4]


async def test_history_bounds_preserve_each_classified_floor(hass) -> None:
    store = SlamHistoryStore(hass, "multi-floor-bounds-entry")
    await store.async_load()
    started = datetime(2026, 7, 26, tzinfo=UTC)
    house = _identity(1)
    shed = _identity(2)

    with patch.object(history_format, "MAX_HISTORY_ITEMS", 3):
        await store.async_add(
            _scene(page_x=1, mission_id=1),
            1,
            created_at=started,
            mission_token=house.mission_token,
        )
        await store.async_add(
            _scene(page_x=2, mission_id=2),
            2,
            created_at=started + timedelta(minutes=6),
            mission_token=shed.mission_token,
        )
        for revision in range(3, 6):
            await store.async_add(
                _scene(page_x=revision, mission_id=1),
                revision,
                created_at=started + timedelta(minutes=revision * 6),
                mission_token=house.mission_token,
            )

    assert [
        (mission_token, [snapshot.revision for snapshot in snapshots])
        for mission_token, snapshots in store.catalogs_by_mission()
    ] == [
        (house.mission_token, [4, 5]),
        (shed.mission_token, [2]),
    ]


async def test_history_byte_bound_preserves_each_classified_floor(hass) -> None:
    store = SlamHistoryStore(hass, "multi-floor-byte-bounds-entry")
    await store.async_load()
    started = datetime(2026, 7, 26, tzinfo=UTC)
    house = _identity(1)
    shed = _identity(2)

    for revision, mission in ((1, house), (2, shed), (3, house)):
        await store.async_add(
            _scene(page_x=revision, mission_id=1 if mission is house else 2),
            revision,
            created_at=started + timedelta(minutes=revision * 6),
            mission_token=mission.mission_token,
        )
    retained_floor_bytes = sum(
        len(snapshot.compressed)
        for snapshot in store.catalog()
        if snapshot.revision in {2, 3}
    )
    with patch.object(
        history_format,
        "MAX_HISTORY_COMPRESSED_BYTES",
        retained_floor_bytes,
    ):
        _enforce_history_bounds(store._snapshots)

    assert [snapshot.revision for snapshot in store.catalog()] == [2, 3]


async def test_history_bound_keeps_newest_set_when_distinct_floors_exceed_it(
    hass,
) -> None:
    store = SlamHistoryStore(hass, "many-floor-bounds-entry")
    await store.async_load()
    started = datetime(2026, 7, 26, tzinfo=UTC)

    with patch.object(history_format, "MAX_HISTORY_ITEMS", 2):
        for revision in range(1, 4):
            await store.async_add(
                _scene(page_x=revision, mission_id=revision),
                revision,
                created_at=started + timedelta(minutes=revision * 6),
                mission_token=_identity(revision).mission_token,
            )

    assert [snapshot.revision for snapshot in store.catalog()] == [2, 3]


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


def test_history_load_trims_between_scene_decodes(monkeypatch) -> None:
    scene = _scene()
    compressed = __import__("zlib").compress(scene)
    snapshot_id = __import__("hashlib").sha256(scene).hexdigest()[:24]
    monkeypatch.setattr(
        history_format,
        "MAX_HISTORY_COMPRESSED_BYTES",
        len(compressed),
    )
    items = [
        {
            "id": snapshot_id,
            "created_at": f"2026-07-26T12:0{index}:00+00:00",
            "revision": index,
            "point_count": 1025,
            "scene": base64.b64encode(compressed).decode(),
        }
        for index in range(6)
    ]
    peaks = []

    def enforce(snapshots):
        peaks.append(sum(len(snapshot.compressed) for snapshot in snapshots))
        _enforce_history_bounds(snapshots)

    with patch.object(history_format, "_enforce_history_bounds", enforce):
        snapshots, dirty = _decode_history({"snapshots": items})
    assert dirty is True
    assert [snapshot.revision for snapshot in snapshots] == [5]
    assert max(peaks) == 2 * len(compressed)
    assert _decode_history({"snapshots": "invalid"}) == ([], True)


def test_history_decompression_is_bounded() -> None:
    scene = _scene()
    compressed = __import__("zlib").compress(scene)
    with patch.object(
        slam_delta,
        "MAX_SCENE_BYTES",
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
        mission_identity=_identity(),
        entries=MagicMock(return_value=(synthetic_slam_entry(),)),
        async_add_listener=MagicMock(
            side_effect=lambda listener: listeners.append(listener) or remove_listener
        ),
    )
    history_added = asyncio.Event()
    history = SimpleNamespace(
        async_add=AsyncMock(side_effect=lambda *_args, **_kwargs: history_added.set())
    )
    task = asyncio.create_task(
        async_collect_slam_history(hass, slam_map, history, _floor_plan)
    )
    try:
        with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
            await asyncio.wait_for(history_added.wait(), timeout=1)
        history.async_add.assert_awaited_once()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_listener.assert_called_once()


async def test_history_collector_waits_for_matching_floor_identity(hass) -> None:
    remove_map_listener = MagicMock()
    remove_floor_listener = MagicMock()
    floor_listener = None

    def subscribe_floor(callback):
        nonlocal floor_listener
        floor_listener = callback
        return remove_floor_listener

    slam_map = SimpleNamespace(
        revision=4,
        map_complete=True,
        mission_identity=_identity(),
        entries=MagicMock(return_value=(synthetic_slam_entry(),)),
        async_add_listener=MagicMock(return_value=remove_map_listener),
    )
    current_floor = replace(_floor_plan(), mission_id=2)
    history_added = asyncio.Event()
    history = SimpleNamespace(
        async_add=AsyncMock(side_effect=lambda *_args, **_kwargs: history_added.set())
    )
    task = asyncio.create_task(
        async_collect_slam_history(
            hass,
            slam_map,
            history,
            lambda: current_floor,
            subscribe_floor,
        )
    )
    try:
        with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
            for _index in range(5):
                await asyncio.sleep(0)
            history.async_add.assert_not_awaited()
            entry_reads = slam_map.entries.call_count
            assert floor_listener is not None
            original_floor_plan_eq = FloorPlan.__eq__
            comparisons = 0

            def count_floor_plan_comparisons(self, other):
                nonlocal comparisons
                comparisons += 1
                return original_floor_plan_eq(self, other)

            current_floor = replace(current_floor)
            with patch.object(FloorPlan, "__eq__", count_floor_plan_comparisons):
                floor_listener()
                assert comparisons == 1
                floor_listener()
                assert comparisons == 1
            for _index in range(5):
                await asyncio.sleep(0)
            assert slam_map.entries.call_count == entry_reads
            current_floor = _floor_plan()
            floor_listener()
            await asyncio.wait_for(history_added.wait(), timeout=1)
        history.async_add.assert_awaited_once()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_map_listener.assert_called_once()
    remove_floor_listener.assert_called_once()


async def test_history_collector_retries_churn_and_skips_incomplete(hass) -> None:
    listener = None

    def subscribe(callback):
        nonlocal listener
        listener = callback
        return MagicMock()

    slam_map = SimpleNamespace(
        revision=1,
        map_complete=False,
        mission_identity=_identity(),
        entries=MagicMock(return_value=(synthetic_slam_entry(),)),
        async_add_listener=MagicMock(side_effect=subscribe),
    )
    history = SimpleNamespace(async_add=AsyncMock())
    task = asyncio.create_task(
        async_collect_slam_history(hass, slam_map, history, _floor_plan)
    )
    with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
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
        mission_identity=_identity(),
        entries=MagicMock(return_value=entries),
        async_add_listener=MagicMock(return_value=remove_listener),
    )
    history = SimpleNamespace(async_add=AsyncMock())
    fake_hass = SimpleNamespace(
        async_add_executor_job=AsyncMock(side_effect=lambda target: target())
    )
    task = asyncio.create_task(
        async_collect_slam_history(fake_hass, slam_map, history, _floor_plan)
    )
    try:
        with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
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
        mission_identity=_identity(),
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
        async_collect_slam_history(fake_hass, slam_map, history, _floor_plan)
    )
    try:
        with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
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
