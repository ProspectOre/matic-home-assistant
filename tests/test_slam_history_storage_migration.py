"""Durable Home Assistant Store versioning for saved map history."""

from __future__ import annotations

import base64
import hashlib
import json
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from homeassistant.exceptions import UnsupportedStorageVersionError
from homeassistant.helpers.storage import Store

from custom_components.matic_robot.client.slam_scene import (
    encode_slam_scene,
    parse_slam_scene_header,
)
from custom_components.matic_robot.client.slam_tiles import decode_slam_tile
from custom_components.matic_robot.slam_history import (
    STORAGE_VERSION,
    SlamHistoryStore,
    _SlamHistoryStorage,
)
from tests.test_slam_map import synthetic_slam_entry


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Use versioned JSON files in Home Assistant's temporary config."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep versioned history files isolated from the shared test config."""
    return hass_tmp_config_dir


def _scene(mission_id: int = 0x1234ABCD) -> bytes:
    return encode_slam_scene(
        (decode_slam_tile(synthetic_slam_entry(mission_id=mission_id)),)
    )


def _mission_token(mission_id: int) -> str:
    return decode_slam_tile(synthetic_slam_entry(mission_id=mission_id)).mission_token


def _legacy_v1_payload(scene: bytes, mission_id: int) -> dict[str, Any]:
    return {
        "snapshots": [
            {
                "id": hashlib.sha256(scene).hexdigest()[:24],
                "created_at": datetime(2026, 7, 26, 12, 0, tzinfo=UTC).isoformat(),
                "revision": 7,
                "point_count": parse_slam_scene_header(scene).point_count,
                "mission_token": _mission_token(mission_id),
                "scene": base64.b64encode(zlib.compress(scene)).decode("ascii"),
            }
        ]
    }


async def test_v1_1_envelope_migrates_and_uses_history_decoder(hass) -> None:
    """v0.5.0's exact Store envelope enters the current history decoder."""
    entry_id = "legacy-v1-history-entry"
    key = f"matic_robot.slam_history.{entry_id}"
    scene = _scene()
    legacy_payload = _legacy_v1_payload(scene, 0x1234ABCD)
    legacy_writer = Store[dict[str, Any]](
        hass, 1, key, private=True, serialize_in_event_loop=False
    )
    await legacy_writer.async_save(legacy_payload)

    storage_path = Path(hass.config.path(".storage", key))
    disk_before = json.loads(await hass.async_add_executor_job(storage_path.read_text))
    assert (disk_before["version"], disk_before["minor_version"]) == (1, 1)
    assert disk_before["data"] == legacy_payload

    current = SlamHistoryStore(hass, entry_id)
    await current.async_load()
    assert STORAGE_VERSION == 2
    assert len(current.catalog()) == 1
    record = current.catalog()[0]
    assert record.snapshot_id == legacy_payload["snapshots"][0]["id"]
    assert record.revision == 7
    assert record.retention == "automatic"
    assert record.record_id
    assert record.comparison_group == current.public_group(_mission_token(0x1234ABCD))
    assert record.frame is not None

    await current.async_shutdown()
    disk_after = json.loads(await hass.async_add_executor_job(storage_path.read_text))
    assert (disk_after["version"], disk_after["minor_version"]) == (2, 1)
    assert disk_after["data"]["group_salt"]
    assert disk_after["data"]["snapshots"][0]["record_id"] == record.record_id
    assert disk_after["data"]["snapshots"][0]["frame"] == record.frame


async def test_v2_lifecycle_survives_reload_and_v1_reader_refuses_unchanged_file(
    hass,
) -> None:
    """New lifecycle fields survive reload; the old Store cannot rewrite them."""
    entry_id = "v2-lifecycle-history-entry"
    key = f"matic_robot.slam_history.{entry_id}"
    current = SlamHistoryStore(hass, entry_id)
    await current.async_load()
    started = datetime.now(UTC)
    record_ids: list[str] = []
    for index in range(3):
        mission_id = index + 1
        assert await current.async_add(
            _scene(mission_id),
            index + 1,
            created_at=started + timedelta(minutes=10 * index),
            mission_token=_mission_token(mission_id),
        )
        record_ids.append(current.catalog()[-1].record_id)

    await current.async_mutate(
        "keep",
        [record_ids[1]],
        expected_generation=current.generation,
        request_id="keep-v2-history-record",
        name="Kept map",
    )
    await current.async_mutate(
        "delete",
        [record_ids[2]],
        expected_generation=current.generation,
        request_id="trash-v2-history-record",
        now=started,
    )
    await current.async_shutdown()

    storage_path = Path(hass.config.path(".storage", key))
    before_refusal = await hass.async_add_executor_job(storage_path.read_bytes)
    envelope = json.loads(before_refusal)
    assert (envelope["version"], envelope["minor_version"]) == (2, 1)
    assert [item["retention"] for item in envelope["data"]["snapshots"]] == [
        "automatic",
        "kept",
        "trash",
    ]

    old_reader = Store[dict[str, Any]](
        hass, 1, key, private=True, serialize_in_event_loop=False
    )
    with pytest.raises(UnsupportedStorageVersionError):
        await old_reader.async_load()
    after_refusal = await hass.async_add_executor_job(storage_path.read_bytes)
    assert after_refusal == before_refusal

    reloaded = SlamHistoryStore(hass, entry_id)
    await reloaded.async_load()
    assert [
        (item.record_id, item.retention, item.name) for item in reloaded.catalog()
    ] == [
        (record_ids[0], "automatic", None),
        (record_ids[1], "kept", "Kept map"),
        (record_ids[2], "trash", None),
    ]
    assert len(reloaded.active_catalog()) == 2
    assert [item.record_id for item in reloaded.trash_catalog()] == [record_ids[2]]
    await reloaded.async_shutdown()


async def test_history_migration_rejects_unsupported_storage_version(hass) -> None:
    """Only the explicitly supported v1 storage major is migrated."""
    store = _SlamHistoryStorage(
        hass,
        STORAGE_VERSION,
        "matic_robot.slam_history.unsupported-migration-entry",
        private=True,
        serialize_in_event_loop=False,
    )
    with pytest.raises(ValueError, match="unsupported SLAM history storage version"):
        await store._async_migrate_func(0, 1, {})
