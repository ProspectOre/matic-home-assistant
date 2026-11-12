"""Stable persisted record and archive formats for private SLAM history."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import zlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any

from google.protobuf.message import DecodeError

from .client import slam_scene
from .client.slam_scene import MAX_COVERAGE_MASK_BYTES, parse_slam_scene_header

# Canonical record/archive limits. The state store imports these through this
# module so persistence and quota checks cannot drift apart.
MAX_HISTORY_ITEMS = 12
MAX_HISTORY_COMPRESSED_BYTES = 48 * 1024 * 1024
MAX_HISTORY_REQUESTS = 64
MAX_ARCHIVE_BYTES = 68 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class SlamHistorySnapshot:
    """One compressed local scene and its content-free catalog metadata."""

    snapshot_id: str
    created_at: datetime
    revision: int
    point_count: int
    compressed: bytes
    mission_token: str | None = None
    record_id: str = ""
    name: str | None = None
    retention: str = "automatic"
    deleted_until: datetime | None = None
    deleted_retention: str | None = None
    imported: bool = False
    source_id: str | None = None
    comparison_group: str | None = None
    frame: dict[str, Any] | None = None
    archive_group: str | None = None


def _build_snapshot(
    scene: bytes,
    revision: int,
    created_at: datetime,
    mission_token: str | None,
    group_salt: bytes = b"",
) -> SlamHistorySnapshot:
    header = parse_slam_scene_header(scene)
    if not 0 <= revision < 2**64:
        raise DecodeError("invalid SLAM history revision")
    if created_at.tzinfo is None:
        raise DecodeError("SLAM history timestamp must include a time zone")
    if mission_token is not None and not _valid_mission_token(mission_token):
        raise DecodeError("SLAM history mission token is invalid")
    timestamp = created_at.astimezone(UTC)
    compressed = zlib.compress(scene, level=6)
    if len(compressed) > MAX_HISTORY_COMPRESSED_BYTES:
        raise DecodeError("SLAM history snapshot exceeds storage bounds")
    snapshot_id = sha256(scene).hexdigest()[:24]
    return SlamHistorySnapshot(
        snapshot_id,
        timestamp,
        revision,
        header.point_count,
        compressed,
        mission_token,
        secrets.token_hex(16),
        comparison_group=(
            hmac.new(group_salt, mission_token.encode(), hashlib.sha256).hexdigest()
            if mission_token is not None and group_salt
            else None
        ),
        frame=_scene_frame(scene),
    )


def _serialize_history(
    snapshots: tuple[SlamHistorySnapshot, ...],
    group_salt: bytes = b"",
    generation: int = 0,
    capture_paused: bool = False,
    requests: Mapping[str, tuple[str, dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    return {
        "group_salt": base64.b64encode(group_salt).decode("ascii"),
        "generation": generation,
        "capture_paused": capture_paused,
        "requests": {
            key: {"fingerprint": value[0], "response": value[1]}
            for key, value in (requests or {}).items()
        },
        "snapshots": [
            {
                "id": snapshot.snapshot_id,
                "created_at": snapshot.created_at.isoformat(),
                "revision": snapshot.revision,
                "point_count": snapshot.point_count,
                "mission_token": snapshot.mission_token,
                "record_id": snapshot.record_id,
                "name": snapshot.name,
                "retention": snapshot.retention,
                "deleted_until": snapshot.deleted_until.isoformat()
                if snapshot.deleted_until
                else None,
                "deleted_retention": snapshot.deleted_retention,
                "imported": snapshot.imported,
                "source_id": snapshot.source_id,
                "comparison_group": snapshot.comparison_group,
                "frame": snapshot.frame,
                "archive_group": snapshot.archive_group,
                "scene": base64.b64encode(snapshot.compressed).decode("ascii"),
            }
            for snapshot in snapshots
        ],
    }


def _decode_history(stored: object) -> tuple[list[SlamHistorySnapshot], bool]:
    if not isinstance(stored, Mapping):
        return [], True
    items = stored.get("snapshots", ())
    if not isinstance(items, Sequence) or isinstance(items, str | bytes):
        return [], True
    snapshots: list[SlamHistorySnapshot] = []
    dirty = len(items) > MAX_HISTORY_ITEMS
    for item in items[-MAX_HISTORY_ITEMS:]:
        try:
            if not isinstance(item, Mapping):
                raise ValueError
            snapshot_id = item["id"]
            created_at = datetime.fromisoformat(str(item["created_at"]))
            revision = item["revision"]
            point_count = item["point_count"]
            mission_token = item.get("mission_token")
            record_id = item.get("record_id")
            retention = item.get("retention", "automatic")
            name = item.get("name")
            deleted_until_value = item.get("deleted_until")
            deleted_retention = item.get("deleted_retention")
            imported = item.get("imported", False)
            source_id = item.get("source_id")
            comparison_group = item.get("comparison_group")
            frame = item.get("frame")
            archive_group = item.get("archive_group")
            deleted_until = (
                datetime.fromisoformat(deleted_until_value)
                if isinstance(deleted_until_value, str)
                else None
            )
            if deleted_until is not None:
                if deleted_until.tzinfo is None:
                    raise ValueError
                deleted_until = deleted_until.astimezone(UTC)
            encoded_scene = item["scene"]
            if (
                not isinstance(encoded_scene, str)
                or len(encoded_scene) > ((MAX_HISTORY_COMPRESSED_BYTES + 2) // 3) * 4
            ):
                raise ValueError("stored history exceeds the encoded byte limit")
            compressed = base64.b64decode(encoded_scene, validate=True)
            if (
                not isinstance(snapshot_id, str)
                or len(snapshot_id) != 24
                or any(character not in "0123456789abcdef" for character in snapshot_id)
                or created_at.tzinfo is None
                or not isinstance(revision, int)
                or isinstance(revision, bool)
                or not 0 <= revision < 2**64
                or not isinstance(point_count, int)
                or isinstance(point_count, bool)
                or point_count < 1
                or (
                    mission_token is not None
                    and not _valid_mission_token(mission_token)
                )
                or len(compressed) > MAX_HISTORY_COMPRESSED_BYTES
                or (
                    record_id is not None
                    and (not isinstance(record_id, str) or len(record_id) != 32)
                )
                or retention not in {"automatic", "kept", "trash"}
                or (
                    deleted_retention is not None
                    and deleted_retention not in {"automatic", "kept"}
                )
                or (deleted_until_value is not None and deleted_until is None)
                or (name is not None and (not isinstance(name, str) or len(name) > 128))
                or not isinstance(imported, bool)
                or (source_id is not None and not isinstance(source_id, str))
                or (
                    comparison_group is not None
                    and not isinstance(comparison_group, str)
                )
                or (frame is not None and not isinstance(frame, Mapping))
                or (
                    archive_group is not None
                    and (not isinstance(archive_group, str) or len(archive_group) != 32)
                )
            ):
                raise ValueError
            created_at_utc = created_at.astimezone(UTC)
            if record_id is None or comparison_group is None or frame is None:
                dirty = True
            scene = _decompress_scene(compressed)
            header = parse_slam_scene_header(scene)
            if (
                sha256(scene).hexdigest()[:24] != snapshot_id
                or header.point_count != point_count
            ):
                raise ValueError
        except DecodeError, KeyError, TypeError, ValueError, OverflowError, zlib.error:
            dirty = True
            continue
        snapshots.append(
            SlamHistorySnapshot(
                snapshot_id,
                created_at_utc,
                revision,
                point_count,
                compressed,
                mission_token,
                record_id
                if isinstance(record_id, str)
                else _legacy_record_id(
                    snapshot_id, created_at, mission_token, len(snapshots)
                ),
                name,
                retention,
                deleted_until,
                deleted_retention,
                imported,
                source_id,
                comparison_group,
                dict(frame) if isinstance(frame, Mapping) else None,
                archive_group,
            )
        )
        # Repair corrupt/oversized caches incrementally instead of retaining
        # every individually valid scene until the entire cache is decoded.
        snapshots.sort(key=lambda snapshot: snapshot.created_at)
        before_count = len(snapshots)
        _enforce_history_bounds(snapshots)
        dirty |= before_count != len(snapshots)
    snapshots.sort(key=lambda snapshot: snapshot.created_at)
    before = tuple(snapshot.snapshot_id for snapshot in snapshots)
    _enforce_history_bounds(snapshots)
    dirty |= before != tuple(snapshot.snapshot_id for snapshot in snapshots)
    return snapshots, dirty


def _decode_history_state(
    stored: object,
) -> tuple[bytes | None, int, bool, dict[str, tuple[str, dict[str, Any]]]]:
    if not isinstance(stored, Mapping):
        return None, 0, False, {}
    raw_salt = stored.get("group_salt")
    try:
        salt = (
            base64.b64decode(raw_salt, validate=True)
            if isinstance(raw_salt, str)
            else None
        )
    except ValueError:
        salt = None
    generation = stored.get("generation", 0)
    paused = stored.get("capture_paused", False)
    raw_requests = stored.get("requests", {})
    requests: dict[str, tuple[str, dict[str, Any]]] = {}
    if isinstance(raw_requests, Mapping):
        for key, raw in list(raw_requests.items())[-MAX_HISTORY_REQUESTS:]:
            if (
                isinstance(key, str)
                and len(key) <= 128
                and isinstance(raw, Mapping)
                and isinstance(raw.get("fingerprint"), str)
                and isinstance(raw.get("response"), Mapping)
            ):
                requests[key] = (raw["fingerprint"], dict(raw["response"]))
    return (
        salt if isinstance(salt, bytes) and len(salt) == 32 else None,
        generation
        if isinstance(generation, int)
        and not isinstance(generation, bool)
        and generation >= 0
        else 0,
        paused if isinstance(paused, bool) else False,
        requests,
    )


def _legacy_record_id(
    snapshot_id: str, created_at: datetime, mission_token: str | None, ordinal: int
) -> str:
    material = (
        f"legacy\0{snapshot_id}\0{created_at.isoformat()}"
        f"\0{mission_token or ''}\0{ordinal}"
    )
    return hashlib.sha256(material.encode()).hexdigest()[:32]


def _scene_frame(scene: bytes) -> dict[str, Any]:
    from .client.slam_scene import _SCENE_HEADER

    header = parse_slam_scene_header(scene)
    metadata_start = _SCENE_HEADER.size
    metadata = json.loads(
        scene[metadata_start : metadata_start + header.metadata_bytes]
    )
    origin = metadata.get("origin_cells")
    scale = metadata.get("meters_per_cell")
    span = metadata.get("span_cells")
    valid = (
        isinstance(origin, list)
        and len(origin) == 2
        and all(
            isinstance(value, int) and not isinstance(value, bool) for value in origin
        )
        and isinstance(scale, (int, float))
        and not isinstance(scale, bool)
        and scale > 0
        and isinstance(span, list)
        and len(span) == 2
        and all(isinstance(value, int) and value > 0 for value in span)
    )
    raw_coverage = metadata.get("coverage")
    coverage_summary: dict[str, Any] = {
        "status": "unknown",
        "observed_cells": 0,
        "mask_sha256": None,
        "diff_eligible": False,
    }
    if isinstance(raw_coverage, Mapping):
        coverage_summary = _validate_coverage(raw_coverage, origin, scale, span)
    return {
        "format_version": 1,
        "coordinate_version": 1,
        "origin_cells": origin if valid else None,
        "meters_per_cell": scale if valid else None,
        "span_cells": span if valid else None,
        "coverage": coverage_summary,
        "diff_eligible": bool(valid and coverage_summary["diff_eligible"]),
    }


def _validate_coverage(
    coverage: Mapping[str, Any], origin: Any, scale: Any, span: Any
) -> dict[str, Any]:
    """Validate bounded occupancy support before advertising compare eligibility."""
    summary = {
        "status": str(coverage.get("status", "unknown"))[:32],
        "observed_cells": 0,
        "mask_sha256": None,
        "diff_eligible": False,
    }
    if (
        coverage.get("version") != 1
        or coverage.get("status") != "verified"
        or coverage.get("encoding") != "zlib-bitset-little-v1"
        or coverage.get("diff_eligible") is not True
        or coverage.get("origin_cells") != origin
        or coverage.get("meters_per_cell") != scale
        or coverage.get("span_cells") != span
        or not isinstance(origin, list)
        or not isinstance(span, list)
        or len(span) != 2
        or any(
            not isinstance(value, int) or isinstance(value, bool) or value < 1
            for value in span
        )
    ):
        return summary
    cells = span[0] * span[1]
    if cells > 4 * 1024 * 1024:
        summary["status"] = "too_large"
        return summary
    encoded = coverage.get("mask_zlib_base64")
    digest = coverage.get("mask_sha256")
    observed_cells = coverage.get("observed_cells")
    if (
        not isinstance(encoded, str)
        or len(encoded) > ((MAX_COVERAGE_MASK_BYTES + 2) // 3) * 4
        or not isinstance(digest, str)
        or not isinstance(observed_cells, int)
        or isinstance(observed_cells, bool)
        or not 0 <= observed_cells <= cells
    ):
        summary["status"] = "invalid"
        return summary
    try:
        compressed = base64.b64decode(encoded, validate=True)
        if (
            len(compressed) > MAX_COVERAGE_MASK_BYTES
            or hashlib.sha256(compressed).hexdigest() != digest
        ):
            raise ValueError
        decompressor = zlib.decompressobj()
        mask = decompressor.decompress(compressed, (cells + 7) // 8 + 1)
        if (
            len(mask) != (cells + 7) // 8
            or decompressor.unconsumed_tail
            or decompressor.unused_data
            or not decompressor.eof
            or sum(byte.bit_count() for byte in mask) != observed_cells
        ):
            raise ValueError
    except ValueError, zlib.error:
        summary["status"] = "invalid"
        return summary
    return {
        "status": "verified",
        "observed_cells": observed_cells,
        "mask_sha256": digest,
        "diff_eligible": observed_cells > 0,
    }


def _valid_name(value: str | None) -> str:
    if not isinstance(value, str):
        raise ValueError("invalid-history-name")
    cleaned = " ".join(value.split())
    if not cleaned or len(cleaned) > 128:
        raise ValueError("invalid-history-name")
    return cleaned


def _valid_mission_token(value: object) -> bool:
    if not isinstance(value, str) or len(value) != 64:
        return False
    try:
        bytes.fromhex(value)
    except ValueError:
        return False
    return True


def _decompress_scene(compressed: bytes) -> bytes:
    decompressor = zlib.decompressobj()
    scene = decompressor.decompress(compressed, slam_scene.MAX_SCENE_BYTES + 1)
    if (
        len(scene) > slam_scene.MAX_SCENE_BYTES
        or decompressor.unconsumed_tail
        or decompressor.unused_data
        or not decompressor.eof
    ):
        raise DecodeError("SLAM history scene expands beyond its bounds")
    scene += decompressor.flush()
    parse_slam_scene_header(scene)
    return scene


def _enforce_history_bounds(snapshots: list[SlamHistorySnapshot]) -> None:
    while len(snapshots) > MAX_HISTORY_ITEMS:
        snapshots.pop(_oldest_disposable_snapshot_index(snapshots))
    while (
        len(snapshots) > 1
        and sum(len(snapshot.compressed) for snapshot in snapshots)
        > MAX_HISTORY_COMPRESSED_BYTES
    ):
        snapshots.pop(_oldest_disposable_snapshot_index(snapshots))


def _oldest_disposable_snapshot_index(
    snapshots: list[SlamHistorySnapshot],
) -> int:
    """Prefer evicting duplicate floor samples over a floor's last scene."""
    mission_counts: dict[str, int] = {}
    for snapshot in snapshots:
        if snapshot.mission_token is not None:
            mission_counts[snapshot.mission_token] = (
                mission_counts.get(snapshot.mission_token, 0) + 1
            )
    for index, snapshot in enumerate(snapshots):
        mission_token = snapshot.mission_token
        if mission_token is None or mission_counts.get(mission_token, 0) > 1:
            return index
    # More distinct floors than the global bound cannot all be retained. Drop
    # the oldest one deterministically and preserve the newest floor set.
    return 0


def _archive_fingerprint(archive: Mapping[str, Any]) -> str:
    """Check an import archive's envelope and return its request fingerprint."""
    try:
        raw = json.dumps(archive, separators=(",", ":")).encode()
    except (TypeError, ValueError) as err:
        raise ValueError("invalid-history-archive") from err
    if (
        len(raw) > MAX_ARCHIVE_BYTES
        or archive.get("format") != "matic-map-archive"
        or archive.get("version") != 1
        or set(archive) != {"format", "version", "records"}
    ):
        raise ValueError("invalid-history-archive")
    return hashlib.sha256(raw).hexdigest()


def _import_records(records: object, group_salt: bytes) -> list[SlamHistorySnapshot]:
    """Decode archive records as kept, read-only history snapshots."""
    if not isinstance(records, list) or not records or len(records) > MAX_HISTORY_ITEMS:
        raise ValueError("invalid-history-archive")
    prepared: list[SlamHistorySnapshot] = []
    archive_group = secrets.token_hex(16)
    for item in records:
        if not isinstance(item, Mapping):
            raise ValueError("invalid-history-archive")
        if set(item) != {
            "source_id",
            "created_at",
            "name",
            "sha256",
            "scene_zlib_base64",
            "frame",
        }:
            raise ValueError("invalid-history-archive-record")
        encoded = item.get("scene_zlib_base64")
        digest = item.get("sha256")
        timestamp = item.get("created_at")
        source_id = item.get("source_id")
        try:
            compressed = (
                base64.b64decode(encoded, validate=True)
                if isinstance(encoded, str)
                else b""
            )
            created_at = (
                datetime.fromisoformat(timestamp)
                if isinstance(timestamp, str)
                else None
            )
            if (
                not compressed
                or len(compressed) > MAX_HISTORY_COMPRESSED_BYTES
                or hashlib.sha256(compressed).hexdigest() != digest
                or created_at is None
                or created_at.tzinfo is None
                or (
                    source_id is not None
                    and (not isinstance(source_id, str) or len(source_id) > 128)
                )
            ):
                raise ValueError
            parsed = _build_snapshot(
                _decompress_scene(compressed), 0, created_at, None, group_salt
            )
        except (
            TypeError,
            ValueError,
            OverflowError,
            DecodeError,
            zlib.error,
        ) as err:
            raise ValueError("invalid-history-archive-record") from err
        prepared.append(
            replace(
                parsed,
                record_id=secrets.token_hex(16),
                retention="kept",
                name=_valid_name(item.get("name"))
                if item.get("name") is not None
                else None,
                imported=True,
                source_id=source_id,
                mission_token=None,
                comparison_group=None,
                frame={
                    **(parsed.frame or {}),
                    "diff_eligible": False,
                    "coverage": "unknown",
                },
                archive_group=archive_group,
            )
        )
    return prepared
