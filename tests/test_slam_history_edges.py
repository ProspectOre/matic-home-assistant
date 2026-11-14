"""Error-path and quota coverage for durable saved-map history."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import zlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import numpy as np
import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot import slam_history_format as history_format
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.client.slam_tiles import (
    SlamStructureTile,
    decode_slam_tile,
)
from custom_components.matic_robot.scene_encoding import (
    _coverage_metadata,
    _room_floor_geometry,
    encode_slam_scene,
    parse_slam_scene_header,
)
from custom_components.matic_robot.slam_history import (
    SlamHistoryStore,
    _oldest_auto_victim,
)
from custom_components.matic_robot.slam_history_format import (
    _build_snapshot,
    _decode_history_state,
    _enforce_history_bounds,
    _oldest_disposable_snapshot_index,
    _valid_name,
    _validate_coverage,
)
from tests.test_slam_map import synthetic_slam_entry


def _scene(page_x: int = 0) -> bytes:
    return encode_slam_scene((decode_slam_tile(synthetic_slam_entry(page_x=page_x)),))


def _broken_archive(scene: bytes, **overrides):
    compressed = zlib.compress(scene)
    item = {
        "source_id": "source-1",
        "created_at": "2026-07-26T12:00:00+00:00",
        "name": "Kitchen",
        "sha256": hashlib.sha256(compressed).hexdigest(),
        "scene_zlib_base64": base64.b64encode(compressed).decode("ascii"),
        "frame": {},
    }
    item.update(overrides)
    return {"format": "matic-map-archive", "version": 1, "records": [item]}


async def _add(store: SlamHistoryStore, page_x: int = 0, minute: int = 0) -> str:
    now = datetime(2026, 7, 26, tzinfo=UTC) + timedelta(minutes=minute)
    assert await store.async_add(_scene(page_x), page_x + 1, created_at=now)
    return store.catalog()[-1].record_id


async def test_history_mutation_errors_and_all_lifecycle_actions(hass) -> None:
    store = SlamHistoryStore(hass, "history-action-edges")
    await store.async_load()
    first = await _add(store)
    second = await _add(store, 1, 6)

    for args in (
        ("", [first], store.generation, "invalid-history-action"),
        ("rename", [first, first], store.generation, "invalid-history-mutation"),
        ("rename", [None], store.generation, "invalid-history-mutation"),
        ("rename", [], store.generation, "invalid-history-mutation"),
        ("rename", ["missing"], store.generation, "history-record-not-found"),
    ):
        action, ids, generation, error = args
        with pytest.raises(ValueError, match=error):
            await store.async_mutate(
                action,
                ids,
                expected_generation=generation,
                request_id=f"bad-{len(store._requests)}-{action}",
                name="Valid",
            )

    kept = await store.async_mutate(
        "keep",
        [first],
        expected_generation=store.generation,
        request_id="keep-edge",
    )
    with pytest.raises(ValueError, match="request-id-reused"):
        await store.async_mutate(
            "rename",
            [first],
            expected_generation=kept["generation"],
            request_id="keep-edge",
            name="different request",
        )
    with pytest.raises(ValueError, match="not-kept"):
        await store.async_mutate(
            "unkeep",
            [second],
            expected_generation=store.generation,
            request_id="unkeep-auto",
        )
    with pytest.raises(ValueError, match="invalid-history-name"):
        await store.async_mutate(
            "rename",
            [first],
            expected_generation=store.generation,
            request_id="rename-empty",
            name="  \n ",
        )
    renamed = await store.async_mutate(
        "rename",
        [first],
        expected_generation=store.generation,
        request_id="rename-cleaned",
        name="  Kitchen    saved  ",
    )
    assert renamed["generation"] == store.generation
    assert (
        next(item for item in store.catalog() if item.record_id == first).name
        == "Kitchen saved"
    )
    with pytest.raises(ValueError, match="explicit-delete"):
        await store.async_mutate(
            "delete",
            [first],
            expected_generation=store.generation,
            request_id="delete-kept-denied",
        )

    await store.async_mutate(
        "delete",
        [first],
        expected_generation=store.generation,
        request_id="delete-kept-allowed",
        allow_kept=True,
    )
    assert [item.record_id for item in store.trash_catalog()] == [first]
    assert [item.record_id for item in store.active_catalog()] == [second]
    assert store.usage()["trash_count"] == 1
    with pytest.raises(ValueError, match="in-trash"):
        await store.async_mutate(
            "keep",
            [first],
            expected_generation=store.generation,
            request_id="keep-trash",
        )
    with pytest.raises(ValueError, match="not-kept"):
        await store.async_mutate(
            "unkeep",
            [first],
            expected_generation=store.generation,
            request_id="unkeep-trash",
        )
    with pytest.raises(ValueError, match="in-trash"):
        await store.async_mutate(
            "rename",
            [first],
            expected_generation=store.generation,
            request_id="rename-trash",
            name="x",
        )
    with pytest.raises(ValueError, match="already-deleted"):
        await store.async_mutate(
            "delete",
            [first],
            expected_generation=store.generation,
            request_id="delete-trash",
        )
    with pytest.raises(ValueError, match="trash-expired"):
        await store.async_mutate(
            "restore",
            [first],
            expected_generation=store.generation,
            request_id="restore-expired",
            now=datetime.now(UTC) + timedelta(days=2),
        )
    with pytest.raises(ValueError, match="not-in-trash"):
        await store.async_mutate(
            "permanent_delete",
            [second],
            expected_generation=store.generation,
            request_id="purge-active",
        )
    with pytest.raises(ValueError, match="invalid-history-action"):
        await store.async_mutate(
            "unknown",
            [second],
            expected_generation=store.generation,
            request_id="unknown",
        )

    await store.async_mutate(
        "keep",
        [second],
        expected_generation=store.generation,
        request_id="keep-second",
    )
    await store.async_mutate(
        "unkeep",
        [second],
        expected_generation=store.generation,
        request_id="unkeep-second",
    )
    assert (
        next(item for item in store.catalog() if item.record_id == second).retention
        == "automatic"
    )

    await store.async_mutate(
        "pause_capture", [], expected_generation=store.generation, request_id="pause"
    )
    assert store.capture_paused
    await store.async_set_policy(
        False, request_id="resume", expected_generation=store.generation
    )
    assert not store.capture_paused
    await store.async_mutate(
        "permanent_delete",
        [first],
        expected_generation=store.generation,
        request_id="purge-trash",
    )
    assert store.trash_catalog() == ()
    await store.async_shutdown()


async def test_history_add_and_mutation_persist_failures_roll_back(hass) -> None:
    store = SlamHistoryStore(hass, "history-add-rollback")
    await store.async_load()
    store._store.async_save = AsyncMock(side_effect=OSError("disk full"))
    with pytest.raises(OSError, match="disk full"):
        await store.async_add(_scene(), 1)
    assert store.catalog() == ()
    assert store.generation == 0
    assert store.usage()["reserved_count"] == 0
    store._store.async_save = AsyncMock()
    await _add(store)
    await store.async_shutdown()

    expiring = SlamHistoryStore(hass, "history-expire-rollback")
    await expiring.async_load()
    record_id = await _add(expiring)
    await expiring.async_mutate(
        "delete",
        [record_id],
        expected_generation=expiring.generation,
        request_id="trash",
    )
    generation = expiring.generation
    expiring._store.async_save = AsyncMock(side_effect=OSError("disk full"))
    with pytest.raises(OSError, match="disk full"):
        await expiring.async_expire_trash(now=datetime.now(UTC) + timedelta(days=2))
    assert expiring.generation == generation
    assert expiring.trash_catalog()
    expiring._store.async_save = AsyncMock()
    await expiring.async_shutdown()


async def test_history_mutation_rejects_closed_store_and_capture_victim_constraints(
    hass,
) -> None:
    closed = SlamHistoryStore(hass, "history-closed-mutation")
    await closed.async_load()
    await closed.async_shutdown()
    with pytest.raises(ValueError, match="store-closed"):
        await closed.async_mutate(
            "pause_capture",
            [],
            expected_generation=closed.generation,
            request_id="closed",
        )

    store = SlamHistoryStore(hass, "history-kept-capacity")
    await store.async_load()
    record_id = await _add(store)
    await store.async_mutate(
        "keep", [record_id], expected_generation=store.generation, request_id="keep"
    )
    with patch.object(history_format, "MAX_HISTORY_ITEMS", 1):
        assert (
            await store.async_add(
                _scene(1), 2, created_at=datetime(2026, 7, 26, 1, tzinfo=UTC)
            )
            is False
        )
    assert len(store.catalog()) == 1
    await store.async_shutdown()


async def test_history_scene_decode_is_revoked_after_catalog_mutation(hass) -> None:
    store = SlamHistoryStore(hass, "history-scene-revoked")
    await store.async_load()
    record_id = await _add(store)
    started = asyncio.Event()
    release = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_decode(function, *args):
        if function.__name__ == "_decompress_scene":
            started.set()
            await release.wait()
        return await executor(function, *args)

    with patch.object(hass, "async_add_executor_job", delayed_decode):
        reading = asyncio.create_task(store.async_scene(record_id))
        await started.wait()
        await store.async_mutate(
            "delete",
            [record_id],
            expected_generation=store.generation,
            request_id="delete-active-reader",
        )
        release.set()
        assert await reading is None
    await store.async_shutdown()


async def test_history_scene_survives_unrelated_catalog_mutation(hass) -> None:
    store = SlamHistoryStore(hass, "history-scene-unrelated-mutation")
    await store.async_load()
    record_id = await _add(store)
    unrelated_id = await _add(store, page_x=1, minute=10)
    started = asyncio.Event()
    release = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_decode(function, *args):
        if function.__name__ == "_decompress_scene":
            started.set()
            await release.wait()
        return await executor(function, *args)

    with patch.object(hass, "async_add_executor_job", delayed_decode):
        reading = asyncio.create_task(store.async_scene(record_id))
        await started.wait()
        await store.async_mutate(
            "keep",
            [unrelated_id],
            expected_generation=store.generation,
            request_id="keep-during-read",
        )
        release.set()
        assert await reading == _scene()
    await store.async_shutdown()


async def test_history_trash_expiry_watcher_tracks_deadline_and_shutdown(hass) -> None:
    store = SlamHistoryStore(hass, "history-expiry-watcher")
    await store.async_load()
    record_id = await _add(store)
    await store.async_mutate(
        "delete",
        [record_id],
        expected_generation=store.generation,
        request_id="trash-for-expiry",
        now=datetime.now(UTC) - timedelta(seconds=2),
    )
    store._snapshots = [
        replace(item, deleted_until=datetime.now(UTC) - timedelta(seconds=1))
        if item.record_id == record_id
        else item
        for item in store._snapshots
    ]
    expired = asyncio.Event()
    remove_listener = store.async_add_listener(expired.set)
    expiry = asyncio.create_task(store.async_expire_trash_until_closed())
    try:
        await asyncio.wait_for(expired.wait(), timeout=1)
        assert store.catalog() == ()
    finally:
        remove_listener()
        await store.async_shutdown()
        await asyncio.wait_for(expiry, timeout=1)


async def test_history_capacity_block_is_separate_and_recovers(hass) -> None:
    store = SlamHistoryStore(hass, "history-capacity-state")
    await store.async_load()
    with patch.object(history_format, "MAX_HISTORY_ITEMS", 1):
        record_id = await _add(store)
        await store.async_mutate(
            "keep",
            [record_id],
            expected_generation=store.generation,
            request_id="capacity-keep",
        )
        assert not store.capture_paused
        assert not await store.async_add(_scene(1), 2)
        assert store.capacity_blocked
        assert not store.capture_paused
        await store.async_set_policy(
            True, request_id="capacity-pause", expected_generation=store.generation
        )
        assert store.capture_paused and store.capacity_blocked
        await store.async_set_policy(
            False, request_id="capacity-resume", expected_generation=store.generation
        )
        assert not store.capture_paused and store.capacity_blocked
        await store.async_mutate(
            "delete",
            [record_id],
            expected_generation=store.generation,
            request_id="capacity-delete",
            allow_kept=True,
        )
        await store.async_mutate(
            "permanent_delete",
            [record_id],
            expected_generation=store.generation,
            request_id="capacity-purge",
        )
        assert not store.capacity_blocked
        assert await store.async_add(_scene(1), 3)
    await store.async_shutdown()


async def test_history_trash_expiry_retries_storage_errors_with_backoff(hass) -> None:
    store = SlamHistoryStore(hass, "history-expiry-retry")
    await store.async_load()
    record_id = await _add(store)
    await store.async_mutate(
        "delete",
        [record_id],
        expected_generation=store.generation,
        request_id="trash-for-retry",
    )
    store._snapshots = [
        replace(item, deleted_until=datetime.now(UTC) - timedelta(seconds=1))
        for item in store._snapshots
    ]
    attempts = 0

    async def fail_once(*, now=None):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OSError("transient storage failure")
        store._closed = True
        store._expiry_changed.set()
        return 0

    with patch.object(store, "async_expire_trash", fail_once):
        expiry = asyncio.create_task(store.async_expire_trash_until_closed())
        await asyncio.wait_for(expiry, timeout=3)
    assert attempts == 2
    await store.async_shutdown()


@pytest.mark.parametrize(
    ("action", "ids"),
    [(None, ["x"]), ("rename", []), ("rename", [None]), ("rename", ["x", "x"])],
)
async def test_history_mutation_rejects_malformed_selection(hass, action, ids) -> None:
    store = SlamHistoryStore(hass, "history-invalid-selection")
    await store.async_load()
    with pytest.raises(ValueError, match="invalid-history-mutation"):
        await store.async_mutate(
            action, ids, expected_generation=0, request_id="invalid", name="Name"
        )
    await store.async_shutdown()


async def test_history_archive_export_validation_and_size_limits(hass) -> None:
    store = SlamHistoryStore(hass, "history-export-errors")
    await store.async_load()
    record_id = await _add(store)
    generation = store.generation
    for ids, expected, error in (
        ([], generation, "invalid-history-export-selection"),
        ([record_id, record_id], generation, "invalid-history-export-selection"),
        ([record_id], True, "invalid-history-export-selection"),
        (["missing"], generation, "history-record-not-found"),
    ):
        with pytest.raises(ValueError, match=error):
            await store.async_export(ids, expected_generation=expected)
    with pytest.raises(ValueError, match="generation-conflict"):
        await store.async_export([record_id], expected_generation=generation - 1)
    await store.async_export([record_id], expected_generation=generation)
    await store.async_mutate(
        "delete",
        [record_id],
        expected_generation=store.generation,
        request_id="export-trash",
    )
    with pytest.raises(ValueError, match="record-not-found"):
        await store.async_export([record_id], expected_generation=store.generation)

    active = SlamHistoryStore(hass, "history-export-json-size")
    await active.async_load()
    active_id = await _add(active)
    record = active.catalog()[0]
    encoded_len = len(base64.b64encode(record.compressed))
    with patch.object(history_format, "MAX_ARCHIVE_BYTES", encoded_len + 1):
        with pytest.raises(ValueError, match="archive-too-large"):
            await active.async_export(
                [active_id], expected_generation=active.generation
            )
    await store.async_shutdown()
    await active.async_shutdown()


@pytest.mark.parametrize(
    "archive",
    [
        None,
        {"format": "other", "version": 1, "records": []},
        {"format": "matic-map-archive", "version": 2, "records": []},
        {"format": "matic-map-archive", "version": 1, "records": [], "extra": 1},
        {"format": "matic-map-archive", "version": 1, "records": "not-list"},
        {"format": "matic-map-archive", "version": 1, "records": []},
        {"format": "matic-map-archive", "version": 1, "records": [None]},
    ],
)
async def test_history_archive_rejects_invalid_envelopes(hass, archive) -> None:
    store = SlamHistoryStore(hass, "history-invalid-archive")
    await store.async_load()
    with pytest.raises(ValueError, match="invalid-history-archive"):
        await store.async_import(archive, expected_generation=0, request_id="invalid")
    await store.async_shutdown()


@pytest.mark.parametrize(
    "override, message",
    [
        ({"scene_zlib_base64": "%%%"}, "invalid-history-archive-record"),
        ({"sha256": "0" * 64}, "invalid-history-archive-record"),
        ({"created_at": "2026-07-26T12:00:00"}, "invalid-history-archive-record"),
        ({"created_at": "0001-01-01T00:00:00+23:59"}, "invalid-history-archive-record"),
        ({"created_at": "9999-12-31T23:59:59-23:59"}, "invalid-history-archive-record"),
        ({"source_id": "x" * 129}, "invalid-history-archive-record"),
        ({"unknown": "field"}, "invalid-history-archive-record"),
        (
            {"scene_zlib_base64": base64.b64encode(b"broken-zlib").decode()},
            "invalid-history-archive-record",
        ),
    ],
)
async def test_history_archive_rejects_corrupt_records(hass, override, message) -> None:
    store = SlamHistoryStore(hass, "history-corrupt-archive")
    await store.async_load()
    archive = _broken_archive(_scene(), **override)
    with pytest.raises(ValueError, match=message):
        await store.async_import(archive, expected_generation=0, request_id="corrupt")
    assert store.catalog() == ()
    await store.async_shutdown()


async def test_history_archive_import_json_quota_rollback_and_idempotent_race(
    hass,
) -> None:
    store = SlamHistoryStore(hass, "history-import-rollback")
    await store.async_load()
    archive = _broken_archive(_scene())
    with pytest.raises(ValueError, match="invalid-history-archive"):
        await store.async_import(
            {"records": [object()]}, expected_generation=0, request_id="bad-json"
        )

    quota_store = SlamHistoryStore(hass, "history-import-quota")
    await quota_store.async_load()
    await _add(quota_store)
    with patch.object(history_format, "MAX_HISTORY_ITEMS", 1):
        with pytest.raises(ValueError, match="quota-exceeded"):
            await quota_store.async_import(
                archive, expected_generation=quota_store.generation, request_id="quota"
            )
    assert len(quota_store.catalog()) == 1
    await quota_store.async_shutdown()

    store._store.async_save = AsyncMock(side_effect=OSError("disk full"))
    with pytest.raises(OSError, match="disk full"):
        await store.async_import(
            archive, expected_generation=0, request_id="rollback-import"
        )
    assert store.catalog() == ()
    assert store.generation == 0

    store._store.async_save = AsyncMock()
    starts = 0
    both_started = asyncio.Event()
    release = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_decode(function, *args):
        nonlocal starts
        if function.__name__ == "_import_records":
            starts += 1
            if starts == 2:
                both_started.set()
            await release.wait()
        return await executor(function, *args)

    with patch.object(hass, "async_add_executor_job", delayed_decode):
        first = asyncio.create_task(
            store.async_import(archive, expected_generation=0, request_id="raced")
        )
        second = asyncio.create_task(
            store.async_import(archive, expected_generation=0, request_id="raced")
        )
        await asyncio.wait_for(both_started.wait(), 2)
        release.set()
        first_result, second_result = await asyncio.gather(first, second)
    assert first_result == second_result
    assert len(store.catalog()) == 1
    await store.async_shutdown()


async def test_history_import_generation_and_request_identity_conflicts(hass) -> None:
    store = SlamHistoryStore(hass, "history-import-conflicts")
    await store.async_load()
    archive = _broken_archive(_scene())
    with pytest.raises(ValueError, match="invalid-history-archive"):
        await store.async_import(archive, expected_generation=True, request_id="bool")
    with pytest.raises(ValueError, match="invalid-history-archive"):
        await store.async_import(archive, expected_generation=0, request_id="")
    with pytest.raises(ValueError, match="invalid-history-archive"):
        await store.async_import(
            {
                "format": "matic-map-archive",
                "version": 1,
                "records": [],
                "bad": object(),
            },
            expected_generation=0,
            request_id="obj",
        )

    await store.async_import(archive, expected_generation=0, request_id="same-id")
    with pytest.raises(ValueError, match="request-id-reused"):
        await store.async_import(
            _broken_archive(_scene(1)), expected_generation=0, request_id="same-id"
        )
    await store.async_shutdown()


def test_history_state_decoder_rejects_bad_salt_generation_and_requests() -> None:
    assert _decode_history_state("bad") == (None, 0, False, {})
    decoded = _decode_history_state(
        {
            "group_salt": "%%%",
            "generation": True,
            "capture_paused": "yes",
            "requests": {
                "ok": {"fingerprint": "f", "response": {"x": 1}},
                3: {"fingerprint": "f", "response": {}},
                "x" * 129: {"fingerprint": "f", "response": {}},
                "bad": {"fingerprint": 1, "response": {}},
            },
        }
    )
    assert decoded == (None, 0, False, {"ok": ("f", {"x": 1})})


def test_oldest_automatic_victim_skips_kept_readers_and_reserved_records(hass) -> None:
    store = SlamHistoryStore(hass, "victim-selection")
    first_id = "a" * 32
    second_id = "b" * 32
    first = store.__class__.__new__(store.__class__)
    del first
    from custom_components.matic_robot.slam_history_format import _build_snapshot

    created = datetime(2026, 7, 26, tzinfo=UTC)
    a = _build_snapshot(_scene(), 1, created, None)
    b = _build_snapshot(_scene(1), 2, created + timedelta(minutes=1), None)
    from dataclasses import replace

    a = replace(a, record_id=first_id)
    b = replace(b, record_id=second_id, retention="kept")
    assert _oldest_auto_victim([a, b], {first_id: 1}, set()) is None
    assert _oldest_auto_victim([a, b], {}, {first_id}) is None


def test_structure_coverage_encoding_marks_unavailable_invalid_and_large(
    monkeypatch,
) -> None:
    tile = decode_slam_tile(synthetic_slam_entry())
    structure = SlamStructureTile(0, 0, tile.mission_token, b"x", b"")
    assert _coverage_metadata((), 0, 0, 32, 32)["status"] == "unavailable"
    assert _coverage_metadata((structure,), 0, 0, 32, 32)["status"] == "invalid"
    valid = SlamStructureTile(0, 0, tile.mission_token, bytes(1024), b"")
    monkeypatch.setattr(
        "custom_components.matic_robot.scene_encoding.MAX_COVERAGE_MASK_BYTES", 0
    )
    assert _coverage_metadata((valid,), 0, 0, 32, 32)["status"] == "too_large"


async def test_history_capture_refuses_unusable_capacity_and_bounds_reservation(hass):
    store = SlamHistoryStore(hass, "history-unusable-victims")
    await store.async_load()
    monkeypatch = patch.object(history_format, "MAX_HISTORY_ITEMS", 0)
    with monkeypatch:
        store._reserve_capture = lambda *_args: []
        assert await store.async_add(_scene(), 1) is False
    await store.async_shutdown()


async def test_history_trash_expiry_without_matches_and_snapshot_compress_bound(hass):
    store = SlamHistoryStore(hass, "history-no-expiry")
    await store.async_load()
    record_id = await _add(store)
    await store.async_mutate(
        "delete", [record_id], expected_generation=store.generation, request_id="trash"
    )
    assert await store.async_expire_trash(now=datetime.now(UTC)) == 0
    await store.async_shutdown()

    with patch.object(history_format, "MAX_HISTORY_COMPRESSED_BYTES", 1):
        with pytest.raises(DecodeError, match="storage bounds"):
            _build_snapshot(_scene(), 1, datetime.now(UTC), None)


async def test_history_export_rejects_selected_compressed_record_over_archive_cap(hass):
    store = SlamHistoryStore(hass, "history-export-cap")
    await store.async_load()
    record_id = await _add(store)
    with patch.object(history_format, "MAX_ARCHIVE_BYTES", 1):
        with pytest.raises(ValueError, match="archive-too-large"):
            await store.async_export([record_id], expected_generation=store.generation)
    await store.async_shutdown()


async def test_history_import_rejects_stale_or_closed_store(hass):
    archive = _broken_archive(_scene())
    store = SlamHistoryStore(hass, "history-import-stale")
    await store.async_load()
    with pytest.raises(ValueError, match="generation-conflict"):
        await store.async_import(archive, expected_generation=1, request_id="stale")
    await store.async_shutdown()

    closed = SlamHistoryStore(hass, "history-import-closed")
    await closed.async_load()
    await closed.async_shutdown()
    with pytest.raises(ValueError, match="generation-conflict"):
        await closed.async_import(archive, expected_generation=0, request_id="closed")


async def test_history_import_second_commit_rechecks_generation_and_idempotency(hass):
    archive = _broken_archive(_scene())
    store = SlamHistoryStore(hass, "history-import-generation-recheck")
    await store.async_load()
    started = asyncio.Event()
    release = asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed_decode(function, *args):
        if function.__name__ == "_import_records":
            started.set()
            await release.wait()
        return await executor(function, *args)

    with patch.object(hass, "async_add_executor_job", delayed_decode):
        importing = asyncio.create_task(
            store.async_import(
                archive, expected_generation=0, request_id="generation-recheck"
            )
        )
        await started.wait()
        await store.async_set_policy(
            True, request_id="generation-change", expected_generation=store.generation
        )
        release.set()
        with pytest.raises(ValueError, match="generation-conflict"):
            await importing
    await store.async_shutdown()

    reused = SlamHistoryStore(hass, "history-import-reused-race-edges")
    await reused.async_load()
    archives = [_broken_archive(_scene()), _broken_archive(_scene(1))]
    count = 0
    both_started = asyncio.Event()
    release_decode = asyncio.Event()

    async def wait_for_both(function, *args):
        nonlocal count
        if function.__name__ == "_import_records":
            count += 1
            if count == 2:
                both_started.set()
            await release_decode.wait()
        return await executor(function, *args)

    with patch.object(hass, "async_add_executor_job", wait_for_both):
        tasks = [
            asyncio.create_task(
                reused.async_import(
                    candidate, expected_generation=0, request_id="same-id"
                )
            )
            for candidate in archives
        ]
        await asyncio.wait_for(both_started.wait(), 2)
        release_decode.set()
        results = await asyncio.gather(*tasks, return_exceptions=True)
    assert sum(isinstance(item, ValueError) for item in results) == 1
    assert len(reused.catalog()) == 1
    await reused.async_shutdown()


def test_history_coverage_validation_rejects_shape_digest_and_stream_errors():
    tile = SlamStructureTile(0, 0, "a" * 64, bytes(1024), b"")
    base = _coverage_metadata((tile,), 0, 0, 32, 32)
    assert _validate_coverage(base, [0, 0], 0.015, [32, 32])["diff_eligible"]
    assert not _validate_coverage({**base, "version": 2}, [0, 0], 0.015, [32, 32])[
        "diff_eligible"
    ]
    expanded = {**base, "span_cells": [4097, 1025]}
    assert (
        _validate_coverage(expanded, [0, 0], 0.015, [4097, 1025])["status"]
        == "too_large"
    )
    for coverage in (
        {**base, "observed_cells": True},
        {**base, "mask_sha256": "0" * 64},
        {
            **base,
            "mask_zlib_base64": base64.b64encode(b"bad-zlib").decode(),
            "mask_sha256": hashlib.sha256(b"bad-zlib").hexdigest(),
        },
        {
            **base,
            "mask_zlib_base64": base64.b64encode(
                zlib.compress(bytes(128)) + b"tail"
            ).decode(),
            "mask_sha256": hashlib.sha256(
                zlib.compress(bytes(128)) + b"tail"
            ).hexdigest(),
        },
    ):
        assert (
            _validate_coverage(coverage, [0, 0], 0.015, [32, 32])["status"] == "invalid"
        )
    assert not _validate_coverage(
        {**base, "observed_cells": 0}, [0, 0], 0.015, [32, 32]
    )["diff_eligible"]


def test_history_name_bounds_and_loaded_item_bounds():
    for name in (None, "  ", "x" * 129):
        with pytest.raises(ValueError, match="invalid-history-name"):
            _valid_name(name)

    snapshots = [
        _build_snapshot(
            _scene(index),
            index + 1,
            datetime(2026, 7, 26, tzinfo=UTC) + timedelta(minutes=index),
            f"{index + 1:064x}",
        )
        for index in range(3)
    ]
    assert _oldest_disposable_snapshot_index(snapshots) == 0
    duplicate = [
        snapshots[0],
        replace(snapshots[1], mission_token=snapshots[0].mission_token),
    ]
    assert _oldest_disposable_snapshot_index(duplicate) == 0
    with patch.object(history_format, "MAX_HISTORY_ITEMS", 2):
        _enforce_history_bounds(snapshots)
    assert [item.revision for item in snapshots] == [2, 3]


def test_scene_encoder_error_limits_and_metadata_fallback(monkeypatch):
    tile = decode_slam_tile(synthetic_slam_entry())
    with pytest.raises(DecodeError, match="no photorealistic"):
        encode_slam_scene(())
    with pytest.raises(DecodeError, match="bounds"):
        encode_slam_scene((tile,), max_points=0)
    monkeypatch.setattr(
        "custom_components.matic_robot.scene_encoding.MAX_SCENE_SPAN", 1
    )
    with pytest.raises(DecodeError, match="too wide"):
        encode_slam_scene((tile,))
    monkeypatch.setattr(
        "custom_components.matic_robot.scene_encoding.MAX_SCENE_SPAN", 65_536
    )

    blank = replace(
        tile,
        floor_rgba=bytes(len(tile.floor_rgba)),
        surface_bits=bytes(len(tile.surface_bits)),
    )
    with pytest.raises(DecodeError, match="no visible"):
        encode_slam_scene((blank,))
    no_rgb = decode_slam_tile(synthetic_slam_entry(with_rgb=False))
    assert parse_slam_scene_header(encode_slam_scene((no_rgb,))).point_count > 0

    empty_room = Room("empty", "Empty", "empty", b"empty", ())
    plan = FloorPlan(1, "partition", b"partition", (empty_room,))
    assert (
        parse_slam_scene_header(encode_slam_scene((tile,), floor_plan=plan)).point_count
        > 0
    )
    assert (
        _room_floor_geometry(
            [[0, 0], [4, 0], [4, 4], [0, 4]], np.zeros((8, 8), dtype=bool)
        )
        is None
    )

    structure = SlamStructureTile(0, 0, "a" * 64, bytes(1024), b"")
    monkeypatch.setattr(
        "custom_components.matic_robot.scene_encoding._coverage_metadata",
        lambda *_: {"oversize": "x" * 600},
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.scene_encoding.MAX_SCENE_METADATA_BYTES", 500
    )
    fallback = encode_slam_scene((tile,), structure_tiles=(structure,))
    header = parse_slam_scene_header(fallback)
    from custom_components.matic_robot.scene_encoding import _SCENE_HEADER

    metadata = json.loads(
        fallback[_SCENE_HEADER.size : _SCENE_HEADER.size + header.metadata_bytes]
    )
    assert metadata["coverage"]["status"] == "too_large"
    monkeypatch.setattr(
        "custom_components.matic_robot.scene_encoding.MAX_SCENE_METADATA_BYTES", 50
    )
    with pytest.raises(DecodeError, match="metadata exceeds"):
        encode_slam_scene((tile,), structure_tiles=(structure,))


def test_structure_coverage_skips_tiles_outside_scene_and_headers_are_checked():
    tile = decode_slam_tile(synthetic_slam_entry())
    outside = SlamStructureTile(99, 99, tile.mission_token, bytes(1024), b"")
    coverage = _coverage_metadata((outside,), 0, 0, 32, 32)
    assert coverage["status"] == "verified"
    assert coverage["observed_cells"] == 0
    with pytest.raises(DecodeError, match="incomplete"):
        parse_slam_scene_header(b"short")
    with pytest.raises(DecodeError, match="invalid"):
        parse_slam_scene_header(bytes(24))


async def test_history_trash_expiry_watcher_wakes_for_catalog_change(hass) -> None:
    """A catalog notification restarts the deadline wait before expiry."""
    store = SlamHistoryStore(hass, "history-expiry-wakeup")
    await store.async_load()
    record_id = await _add(store)
    await store.async_mutate(
        "delete",
        [record_id],
        expected_generation=store.generation,
        request_id="trash-for-wakeup",
    )
    store._snapshots = [
        replace(item, deleted_until=datetime.now(UTC) + timedelta(seconds=0.05))
        for item in store._snapshots
    ]
    expiry = asyncio.create_task(store.async_expire_trash_until_closed())
    await asyncio.sleep(0)
    store._expiry_changed.set()
    await asyncio.sleep(0)
    store._closed = True
    store._expiry_changed.set()
    await asyncio.wait_for(expiry, timeout=1)
    store._closed = False
    await store.async_shutdown()


async def test_history_trash_expiry_watcher_returns_when_closed_at_deadline(
    hass,
) -> None:
    """A closed store exits after its current deadline wait completes."""
    store = SlamHistoryStore(hass, "history-expiry-closed")
    await store.async_load()
    record_id = await _add(store)
    await store.async_mutate(
        "delete",
        [record_id],
        expected_generation=store.generation,
        request_id="trash-for-close",
    )
    store._snapshots = [
        replace(item, deleted_until=datetime.now(UTC) + timedelta(seconds=0.05))
        for item in store._snapshots
    ]
    expiry = asyncio.create_task(store.async_expire_trash_until_closed())
    await asyncio.sleep(0.005)
    store._closed = True
    await asyncio.wait_for(expiry, timeout=1)
    await store.async_shutdown()


async def test_history_trash_expiry_watcher_propagates_cancellation(hass) -> None:
    """Cancellation during an expiry operation is never swallowed."""
    store = SlamHistoryStore(hass, "history-expiry-cancel")
    await store.async_load()
    record_id = await _add(store)
    await store.async_mutate(
        "delete",
        [record_id],
        expected_generation=store.generation,
        request_id="trash-for-cancel",
    )
    store._snapshots = [
        replace(item, deleted_until=datetime.now(UTC) - timedelta(seconds=1))
        for item in store._snapshots
    ]

    async def cancelled_expiry():
        raise asyncio.CancelledError

    with patch.object(store, "async_expire_trash", cancelled_expiry):
        expiry = asyncio.create_task(store.async_expire_trash_until_closed())
        with pytest.raises(asyncio.CancelledError):
            await expiry
    store._set_capacity_blocked(False)
    await store.async_shutdown()
