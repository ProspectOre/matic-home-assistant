"""Private, bounded history for local SLAM scenes."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import secrets
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any, override

from google.protobuf.message import DecodeError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import slam_history_format as _history_format
from .const import DOMAIN
from .slam_delta import MAX_SCENE_BYTES

STORAGE_VERSION = 2
MAX_ACTIVE_HISTORY_READS = 2
MAX_ACTIVE_HISTORY_READ_BYTES = 2 * MAX_SCENE_BYTES
MIN_HISTORY_INTERVAL_SECONDS = 5 * 60
TRASH_RETENTION = timedelta(hours=24)
SAVE_DELAY_SECONDS = 1
_LOGGER = logging.getLogger(__name__)


class HistoryReadCapacityError(RuntimeError):
    """The bounded scene-decode budget is currently occupied."""


class _SlamHistoryStorage(Store[dict[str, Any]]):
    """Version SLAM history changes so older readers fail closed."""

    @override
    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Carry the v1 payload forward for the existing record decoder."""
        if old_major_version != 1 or old_minor_version != 1:
            raise ValueError(
                "unsupported SLAM history storage version "
                f"{old_major_version}.{old_minor_version}"
            )
        return old_data


class SlamHistoryStore:
    """Retain a bounded local timeline outside Recorder and entity state."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._store = _SlamHistoryStorage(
            hass,
            STORAGE_VERSION,
            f"{DOMAIN}.slam_history.{entry_id}",
            private=True,
            serialize_in_event_loop=False,
        )
        self._snapshots: list[_history_format.SlamHistorySnapshot] = []
        self._group_salt = secrets.token_bytes(32)
        self._generation = 0
        # Storage generation changes for catalog mutations. Lifecycle generation
        # changes only when this store instance is closed or removed.
        self._lifecycle_generation = 0
        self._capture_paused = False
        self._capacity_blocked = False
        self._reserved_bytes = 0
        self._requests: dict[str, tuple[str, dict[str, Any]]] = {}
        self._mutation_lock = asyncio.Lock()
        self._active_reads: dict[str, int] = {}
        self._active_read_bytes = 0
        self._reserved_count = 0
        self._reserved_victims: set[str] = set()
        self._listeners: set[Callable[[], None]] = set()
        self._expiry_changed = asyncio.Event()
        self._closed = False

    async def async_load(self) -> None:
        """Load and validate retained scenes off the event loop."""
        stored = await self._store.async_load() or {}
        snapshots, dirty = await self._hass.async_add_executor_job(
            _history_format._decode_history, stored
        )
        salt, generation, paused, requests = _history_format._decode_history_state(
            stored
        )
        dirty |= salt is None
        self._snapshots = snapshots
        self._group_salt = salt or self._group_salt
        self._generation = generation
        self._lifecycle_generation += 1
        self._capture_paused = paused
        self._requests = requests
        migrated: list[_history_format.SlamHistorySnapshot] = []
        for snapshot in snapshots:
            group = snapshot.comparison_group or self.public_group(
                snapshot.mission_token
            )
            frame = snapshot.frame
            if frame is None:
                scene = await self._hass.async_add_executor_job(
                    _history_format._decompress_scene, snapshot.compressed
                )
                frame = await self._hass.async_add_executor_job(
                    _history_format._scene_frame, scene
                )
            if group != snapshot.comparison_group or frame != snapshot.frame:
                dirty = True
            migrated.append(replace(snapshot, comparison_group=group, frame=frame))
        self._snapshots = migrated
        if (
            len(self._snapshots) > _history_format.MAX_HISTORY_ITEMS
            or sum(len(item.compressed) for item in self._snapshots)
            > _history_format.MAX_HISTORY_COMPRESSED_BYTES
        ):
            self._capacity_blocked = True
            dirty = True
        self._closed = False
        if dirty:
            self._schedule_save()

    async def async_add(
        self,
        scene: bytes,
        revision: int,
        *,
        created_at: datetime | None = None,
        mission_token: str | None = None,
    ) -> bool:
        """Add or refresh one time-spaced scene checkpoint."""
        if self._closed:
            return False
        if self._closed or self._capture_paused or len(scene) > MAX_SCENE_BYTES:
            return False
        async with self._mutation_lock:
            if self._closed or self._capture_paused:
                return False
            reservation = _reservation_bytes(len(scene))
            victims = self._reserve_capture(reservation, mission_token, created_at)
            if victims is None:
                if reservation > _history_format.MAX_HISTORY_COMPRESSED_BYTES:
                    raise DecodeError("SLAM history snapshot exceeds storage bounds")
                self._set_capacity_blocked(True)
                return False
            lifecycle_generation = self._lifecycle_generation
            generation = self._generation
        try:
            snapshot = await self._hass.async_add_executor_job(
                _history_format._build_snapshot,
                scene,
                revision,
                created_at or datetime.now(UTC),
                mission_token,
                self._group_salt,
            )
            async with self._mutation_lock:
                if (
                    self._closed
                    or lifecycle_generation != self._lifecycle_generation
                    or generation != self._generation
                ):
                    return False
                before = list(self._snapshots)
                old_generation = self._generation
                if any(
                    current.snapshot_id == snapshot.snapshot_id
                    and current.mission_token == snapshot.mission_token
                    and current.retention != "trash"
                    for current in self._snapshots
                ):
                    return False
                latest = next(
                    (
                        item
                        for item in reversed(self._snapshots)
                        if item.mission_token == snapshot.mission_token
                        and item.retention == "automatic"
                    ),
                    None,
                )
                victim_ids = set(victims)
                if (
                    latest is not None
                    and (snapshot.created_at - latest.created_at).total_seconds()
                    < MIN_HISTORY_INTERVAL_SECONDS
                ):
                    victim_ids.add(latest.record_id)
                survivors = [
                    item for item in self._snapshots if item.record_id not in victim_ids
                ]
                while (
                    len(survivors) >= _history_format.MAX_HISTORY_ITEMS
                    or sum(len(item.compressed) for item in survivors)
                    + len(snapshot.compressed)
                    > _history_format.MAX_HISTORY_COMPRESSED_BYTES
                ):
                    extra = _oldest_auto_victim(
                        survivors, self._active_reads, self._reserved_victims
                    )
                    if extra is None:
                        self._set_capacity_blocked(True)
                        return False
                    victim_ids.add(extra.record_id)
                    survivors.remove(extra)
                if (
                    latest is not None
                    and (snapshot.created_at - latest.created_at).total_seconds()
                    < MIN_HISTORY_INTERVAL_SECONDS
                ):
                    victim_ids.add(latest.record_id)
                self._snapshots = survivors
                snapshot = replace(
                    snapshot,
                    record_id=secrets.token_hex(16),
                    comparison_group=self.public_group(mission_token),
                )
                self._snapshots.append(snapshot)
                self._capacity_blocked = False
                _history_format._enforce_history_bounds(self._snapshots)
                self._generation += 1
                try:
                    await self._persist_locked()
                except BaseException:
                    self._snapshots = before
                    self._generation = old_generation
                    raise
            self._notify()
            return True
        finally:
            async with self._mutation_lock:
                self._release_capture(reservation, victims)

    def async_add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Subscribe to catalog changes; return an idempotent remover."""
        self._listeners.add(listener)

        def remove_listener() -> None:
            self._listeners.discard(listener)

        return remove_listener

    def catalog(self) -> tuple[_history_format.SlamHistorySnapshot, ...]:
        """Return immutable snapshot metadata and compressed payload references."""
        return tuple(self._snapshots)

    def active_catalog(self) -> tuple[_history_format.SlamHistorySnapshot, ...]:
        return tuple(item for item in self._snapshots if item.retention != "trash")

    def trash_catalog(self) -> tuple[_history_format.SlamHistorySnapshot, ...]:
        return tuple(item for item in self._snapshots if item.retention == "trash")

    @property
    def generation(self) -> int:
        return self._generation

    @property
    def capture_paused(self) -> bool:
        return self._capture_paused

    @property
    def capacity_blocked(self) -> bool:
        """Whether the latest automatic capture could not fit in current storage."""
        return self._capacity_blocked

    def usage(self) -> dict[str, int]:
        active = [item for item in self._snapshots if item.retention != "trash"]
        deleted = [item for item in self._snapshots if item.retention == "trash"]
        return {
            "record_count": len(self._snapshots),
            "automatic_count": sum(item.retention == "automatic" for item in active),
            "kept_count": sum(item.retention == "kept" for item in active),
            "trash_count": len(deleted),
            "compressed_bytes": sum(len(item.compressed) for item in self._snapshots),
            "active_compressed_bytes": sum(len(item.compressed) for item in active),
            "trash_compressed_bytes": sum(len(item.compressed) for item in deleted),
            "reserved_bytes": self._reserved_bytes,
            "reserved_count": self._reserved_count,
            "active_read_count": sum(self._active_reads.values()),
            "active_read_bytes": self._active_read_bytes,
        }

    def public_group(self, mission_token: str | None) -> str | None:
        if not isinstance(
            mission_token, str
        ) or not _history_format._valid_mission_token(mission_token):
            return None
        return hmac.new(
            self._group_salt, mission_token.encode(), hashlib.sha256
        ).hexdigest()

    def catalog_for_mission(
        self, mission_token: str | None
    ) -> tuple[_history_format.SlamHistorySnapshot, ...]:
        """Return only snapshots proven to belong to the active map mission."""
        if not _history_format._valid_mission_token(mission_token):
            return ()
        return tuple(
            snapshot
            for snapshot in self._snapshots
            if snapshot.mission_token == mission_token
        )

    def catalogs_by_mission(
        self,
    ) -> tuple[tuple[str, tuple[_history_format.SlamHistorySnapshot, ...]], ...]:
        """Group classified snapshots by floor without exposing map content."""
        grouped: dict[str, list[_history_format.SlamHistorySnapshot]] = {}
        for snapshot in self._snapshots:
            mission_token = snapshot.mission_token
            if not isinstance(
                mission_token, str
            ) or not _history_format._valid_mission_token(mission_token):
                continue
            grouped.setdefault(mission_token, []).append(snapshot)
        return tuple(
            (mission_token, tuple(snapshots))
            for mission_token, snapshots in sorted(
                grouped.items(),
                key=lambda item: item[1][-1].created_at,
                reverse=True,
            )
        )

    async def async_scene(
        self,
        snapshot_id: str,
        *,
        mission_token: str | None = None,
    ) -> bytes | None:
        """Return one validated scene without retaining another decompressed copy."""
        snapshot = next(
            (
                candidate
                for candidate in self._snapshots
                if candidate.record_id == snapshot_id
                and candidate.retention != "trash"
                and (mission_token is None or candidate.mission_token == mission_token)
            ),
            None,
        )
        if snapshot is None:
            legacy_matches = [
                candidate
                for candidate in self._snapshots
                if candidate.snapshot_id == snapshot_id
                and candidate.retention != "trash"
                and (mission_token is None or candidate.mission_token == mission_token)
            ]
            snapshot = legacy_matches[0] if len(legacy_matches) == 1 else None
        if snapshot is None or self._closed:
            return None
        if snapshot.record_id in self._reserved_victims:
            raise HistoryReadCapacityError("saved-map scene is reserved for eviction")
        if (
            sum(self._active_reads.values()) >= MAX_ACTIVE_HISTORY_READS
            or self._active_read_bytes + MAX_SCENE_BYTES > MAX_ACTIVE_HISTORY_READ_BYTES
        ):
            raise HistoryReadCapacityError("saved-map scene reads are busy")
        lifecycle_generation = self._lifecycle_generation
        self._active_reads[snapshot.record_id] = (
            self._active_reads.get(snapshot.record_id, 0) + 1
        )
        self._active_read_bytes += MAX_SCENE_BYTES
        decode_task = asyncio.ensure_future(
            self._hass.async_add_executor_job(
                _history_format._decompress_scene, snapshot.compressed
            )
        )
        release_after_decode = False
        try:
            scene = await asyncio.shield(decode_task)
            current = next(
                (
                    item
                    for item in self._snapshots
                    if item.record_id == snapshot.record_id
                ),
                None,
            )
            if (
                self._closed
                or current is None
                or current.retention == "trash"
                or lifecycle_generation != self._lifecycle_generation
                or current is not snapshot
            ):
                return None
            return scene
        except asyncio.CancelledError:
            if not decode_task.done():
                release_after_decode = True
                decode_task.add_done_callback(
                    lambda _task: self._release_scene_read(snapshot.record_id)
                )
            raise
        finally:
            if not release_after_decode:
                self._release_scene_read(snapshot.record_id)

    def _release_scene_read(self, record_id: str) -> None:
        readers = self._active_reads.get(record_id, 1) - 1
        if readers > 0:
            self._active_reads[record_id] = readers
        else:
            self._active_reads.pop(record_id, None)
        self._active_read_bytes = max(0, self._active_read_bytes - MAX_SCENE_BYTES)

    async def async_mutate(
        self,
        action: str,
        record_ids: Sequence[str],
        *,
        expected_generation: int,
        request_id: str,
        name: str | None = None,
        allow_kept: bool = False,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Apply one idempotent durable user mutation to exact record IDs."""
        if (
            not isinstance(request_id, str)
            or not isinstance(action, str)
            or not request_id
            or len(request_id) > 128
            or len(record_ids) > _history_format.MAX_HISTORY_ITEMS
            or any(not isinstance(record_id, str) for record_id in record_ids)
            or len(set(record_ids)) != len(record_ids)
            or (action not in {"pause_capture", "resume_capture"} and not record_ids)
        ):
            raise ValueError("invalid-history-mutation")
        fingerprint = json.dumps(
            [action, sorted(record_ids), name, allow_kept], separators=(",", ":")
        )
        async with self._mutation_lock:
            prior = self._requests.get(request_id)
            if prior is not None:
                if prior[0] != fingerprint:
                    raise ValueError("history-request-id-reused")
                return dict(prior[1])
            if self._closed:
                raise ValueError("history-store-closed")
            if expected_generation != self._generation:
                raise ValueError("history-generation-conflict")
            selected = [
                item for item in self._snapshots if item.record_id in set(record_ids)
            ]
            if len(selected) != len(set(record_ids)):
                raise ValueError("history-record-not-found")
            timestamp = (now or datetime.now(UTC)).astimezone(UTC)
            by_id = {item.record_id: item for item in self._snapshots}
            before = list(self._snapshots)
            before_generation = self._generation
            before_paused = self._capture_paused
            before_capacity_blocked = self._capacity_blocked
            if action == "keep":
                for item in selected:
                    if item.retention == "trash":
                        raise ValueError("history-record-in-trash")
                    by_id[item.record_id] = replace(
                        item,
                        retention="kept",
                        name=_history_format._valid_name(name)
                        if name is not None
                        else item.name,
                    )
            elif action == "unkeep":
                for item in selected:
                    if item.retention != "kept":
                        raise ValueError("history-record-not-kept")
                    by_id[item.record_id] = replace(item, retention="automatic")
            elif action == "rename":
                clean_name = _history_format._valid_name(name)
                for item in selected:
                    if item.retention == "trash":
                        raise ValueError("history-record-in-trash")
                    by_id[item.record_id] = replace(item, name=clean_name)
            elif action == "delete":
                for item in selected:
                    if item.retention == "kept" and not allow_kept:
                        raise ValueError("history-kept-record-requires-explicit-delete")
                    if item.retention == "trash":
                        raise ValueError("history-record-already-deleted")
                    by_id[item.record_id] = replace(
                        item,
                        retention="trash",
                        deleted_until=timestamp + TRASH_RETENTION,
                        deleted_retention=item.retention,
                    )
            elif action == "restore":
                for item in selected:
                    if (
                        item.retention != "trash"
                        or item.deleted_until is None
                        or item.deleted_until <= timestamp
                    ):
                        raise ValueError("history-trash-expired")
                    by_id[item.record_id] = replace(
                        item,
                        retention=item.deleted_retention or "automatic",
                        deleted_until=None,
                        deleted_retention=None,
                    )
            elif action == "permanent_delete":
                if any(item.retention != "trash" for item in selected):
                    raise ValueError("history-record-not-in-trash")
                self._snapshots = [
                    item
                    for item in self._snapshots
                    if item.record_id not in set(record_ids)
                ]
            elif action == "pause_capture":
                self._capture_paused = True
            elif action == "resume_capture":
                self._capture_paused = False
            else:
                raise ValueError("invalid-history-action")
            if action not in {"permanent_delete", "pause_capture", "resume_capture"}:
                self._snapshots = [by_id[item.record_id] for item in self._snapshots]
            if action in {"permanent_delete", "unkeep"}:
                self._capacity_blocked = False
            if action in {"delete", "restore", "permanent_delete"}:
                self._generation += 1
            elif action in {
                "keep",
                "unkeep",
                "rename",
                "pause_capture",
                "resume_capture",
            }:
                self._generation += 1
            response = {"generation": self._generation, "request_id": request_id}
            self._requests[request_id] = (fingerprint, response)
            self._requests = dict(
                list(self._requests.items())[-_history_format.MAX_HISTORY_REQUESTS :]
            )
            try:
                await self._persist_locked()
            except BaseException:
                self._snapshots = before
                self._generation = before_generation
                self._capture_paused = before_paused
                self._capacity_blocked = before_capacity_blocked
                self._requests.pop(request_id, None)
                raise
        self._notify()
        return response

    async def async_expire_trash(self, *, now: datetime | None = None) -> int:
        """Permanently remove expired trash after revoking it from readers."""
        timestamp = (now or datetime.now(UTC)).astimezone(UTC)
        async with self._mutation_lock:
            expired = [
                item
                for item in self._snapshots
                if item.retention == "trash"
                and item.deleted_until is not None
                and item.deleted_until <= timestamp
            ]
            if not expired:
                return 0
            before = list(self._snapshots)
            before_capacity_blocked = self._capacity_blocked
            self._snapshots = [item for item in self._snapshots if item not in expired]
            self._capacity_blocked = False
            self._generation += 1
            try:
                await self._persist_locked()
            except BaseException:
                self._snapshots = before
                self._generation -= 1
                self._capacity_blocked = before_capacity_blocked
                raise
        self._notify()
        return len(expired)

    async def async_expire_trash_until_closed(self) -> None:
        """Expire trash at its nearest deadline; task cancellation follows unload."""
        retry_delay = 1.0
        while not self._closed:
            deadlines = [
                item.deleted_until
                for item in self._snapshots
                if item.retention == "trash" and item.deleted_until is not None
            ]
            if not deadlines:
                self._expiry_changed.clear()
                await self._expiry_changed.wait()
                continue
            delay = max(0.0, (min(deadlines) - datetime.now(UTC)).total_seconds())
            if delay:
                self._expiry_changed.clear()
                try:
                    await asyncio.wait_for(self._expiry_changed.wait(), timeout=delay)
                    continue
                except TimeoutError:
                    pass
            if self._closed:
                return
            try:
                await self.async_expire_trash()
                retry_delay = 1.0
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOGGER.exception("Failed to expire saved-map trash; retrying")
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 300.0)

    async def async_export(
        self, record_ids: Sequence[str], *, expected_generation: int
    ) -> dict[str, Any]:
        """Create a bounded, credential-free archive of selected active records."""
        if (
            len(record_ids) < 1
            or len(record_ids) > _history_format.MAX_HISTORY_ITEMS
            or any(not isinstance(record_id, str) for record_id in record_ids)
            or len(set(record_ids)) != len(record_ids)
            or isinstance(expected_generation, bool)
            or not isinstance(expected_generation, int)
        ):
            raise ValueError("invalid-history-export-selection")
        async with self._mutation_lock:
            if expected_generation != self._generation:
                raise ValueError("history-generation-conflict")
            selected = [
                item for item in self._snapshots if item.record_id in set(record_ids)
            ]
            if len(selected) != len(set(record_ids)) or any(
                item.retention == "trash" for item in selected
            ):
                raise ValueError("history-record-not-found")
            archive_records = []
            encoded_size = 0
            for item in selected:
                encoded = base64.b64encode(item.compressed).decode("ascii")
                encoded_size += len(encoded)
                if encoded_size > _history_format.MAX_ARCHIVE_BYTES:
                    raise ValueError("history-archive-too-large")
                archive_records.append(
                    {
                        "source_id": item.record_id,
                        "created_at": item.created_at.isoformat(),
                        "name": item.name,
                        "sha256": hashlib.sha256(item.compressed).hexdigest(),
                        "scene_zlib_base64": encoded,
                        "frame": item.frame,
                    }
                )
            result: dict[str, Any] = {
                "format": "matic-map-archive",
                "version": 1,
                "records": archive_records,
            }
            if (
                len(json.dumps(result, separators=(",", ":")).encode())
                > _history_format.MAX_ARCHIVE_BYTES
            ):
                raise ValueError("history-archive-too-large")
            return result

    async def async_import(
        self,
        archive: Mapping[str, Any],
        *,
        expected_generation: int,
        request_id: str,
    ) -> dict[str, Any]:
        """Validate then import bounded archive records as read-only kept history."""
        if (
            not isinstance(request_id, str)
            or not request_id
            or len(request_id) > 128
            or isinstance(expected_generation, bool)
            or not isinstance(expected_generation, int)
            or not isinstance(archive, Mapping)
        ):
            raise ValueError("invalid-history-archive")
        fingerprint = await self._hass.async_add_executor_job(
            _history_format._archive_fingerprint, archive
        )
        async with self._mutation_lock:
            prior = self._requests.get(request_id)
            if prior is not None:
                if prior[0] != fingerprint:
                    raise ValueError("history-request-id-reused")
                return dict(prior[1])
            if self._closed or expected_generation != self._generation:
                raise ValueError("history-generation-conflict")
        prepared = await self._hass.async_add_executor_job(
            _history_format._import_records, archive.get("records"), self._group_salt
        )
        async with self._mutation_lock:
            prior = self._requests.get(request_id)
            if prior is not None:
                if prior[0] != fingerprint:
                    raise ValueError("history-request-id-reused")
                return dict(prior[1])
            if self._closed or expected_generation != self._generation:
                raise ValueError("history-generation-conflict")
            if (
                len(self._snapshots) + len(prepared) > _history_format.MAX_HISTORY_ITEMS
                or sum(len(item.compressed) for item in self._snapshots + prepared)
                > _history_format.MAX_HISTORY_COMPRESSED_BYTES
            ):
                raise ValueError("history-quota-exceeded")
            before = list(self._snapshots)
            self._snapshots.extend(prepared)
            self._generation += 1
            response = {
                "generation": self._generation,
                "request_id": request_id,
                "record_ids": [item.record_id for item in prepared],
            }
            self._requests[request_id] = (fingerprint, response)
            self._requests = dict(
                list(self._requests.items())[-_history_format.MAX_HISTORY_REQUESTS :]
            )
            try:
                await self._persist_locked()
            except BaseException:
                self._snapshots = before
                self._generation -= 1
                self._requests.pop(request_id, None)
                raise
        self._notify()
        return response

    async def async_set_policy(
        self, paused: bool, *, request_id: str, expected_generation: int
    ) -> dict[str, Any]:
        return await self.async_mutate(
            "pause_capture" if paused else "resume_capture",
            (),
            expected_generation=expected_generation,
            request_id=request_id,
        )

    def _reserve_capture(
        self, amount: int, mission_token: str | None, created_at: datetime | None
    ) -> list[str] | None:
        if amount > _history_format.MAX_HISTORY_COMPRESSED_BYTES:
            return None
        now = (created_at or datetime.now(UTC)).astimezone(UTC)
        latest = next(
            (
                item
                for item in reversed(self._snapshots)
                if item.mission_token == mission_token and item.retention == "automatic"
            ),
            None,
        )
        replace_id = (
            latest.record_id
            if latest is not None
            and (now - latest.created_at).total_seconds() < MIN_HISTORY_INTERVAL_SECONDS
            else None
        )
        projected = [item for item in self._snapshots if item.record_id != replace_id]
        reserved = self._reserved_bytes
        count_reserved = self._reserved_count
        victims: list[str] = []
        while (
            len(projected) + count_reserved >= _history_format.MAX_HISTORY_ITEMS
            or sum(len(candidate.compressed) for candidate in projected)
            + reserved
            + amount
            > _history_format.MAX_HISTORY_COMPRESSED_BYTES
        ):
            victim = _oldest_auto_victim(
                projected, self._active_reads, self._reserved_victims
            )
            if victim is None:
                return None
            projected.remove(victim)
            victims.append(victim.record_id)
        self._reserved_bytes += amount
        self._reserved_count += 1
        self._reserved_victims.update(victims)
        return victims

    def _release_capture(self, amount: int, victims: Sequence[str]) -> None:
        self._reserved_bytes = max(0, self._reserved_bytes - amount)
        self._reserved_count = max(0, self._reserved_count - 1)
        self._reserved_victims.difference_update(victims)

    async def _persist_locked(self) -> None:
        data = await self._hass.async_add_executor_job(
            _history_format._serialize_history,
            tuple(self._snapshots),
            self._group_salt,
            self._generation,
            self._capture_paused,
            self._requests,
        )
        await self._store.async_save(data)

    def _notify(self) -> None:
        self._expiry_changed.set()
        for listener in tuple(self._listeners):
            listener()

    def _set_capacity_blocked(self, blocked: bool) -> None:
        if self._capacity_blocked == blocked:
            return
        self._capacity_blocked = blocked
        self._notify()

    async def async_shutdown(self) -> None:
        """Resolve delayed writes before the config entry unloads."""
        if self._closed:
            return
        self._closed = True
        self._lifecycle_generation += 1
        self._expiry_changed.set()
        async with self._mutation_lock:
            data = await self._hass.async_add_executor_job(
                _history_format._serialize_history,
                tuple(self._snapshots),
                self._group_salt,
                self._generation,
                self._capture_paused,
                self._requests,
            )
            await self._store.async_save(data)

    async def async_remove(self) -> None:
        """Erase every retained scene for a removed config entry."""
        self._closed = True
        self._lifecycle_generation += 1
        self._expiry_changed.set()
        async with self._mutation_lock:
            had_snapshots = bool(self._snapshots)
            self._snapshots.clear()
            self._generation += 1
            await self._store.async_remove()
        if had_snapshots:
            self._notify()

    def _schedule_save(self) -> None:
        if self._closed:
            return
        self._store.async_delay_save(
            partial(
                _history_format._serialize_history,
                tuple(self._snapshots),
                self._group_salt,
                self._generation,
                self._capture_paused,
                self._requests,
            ),
            SAVE_DELAY_SECONDS,
        )


def _reservation_bytes(scene_bytes: int) -> int:
    # zlib's documented conservative bound plus bounded metadata/record overhead.
    return (
        scene_bytes
        + (scene_bytes >> 12)
        + (scene_bytes >> 14)
        + (scene_bytes >> 25)
        + 13
        + 4096
    )


def _oldest_auto_victim(
    snapshots: Sequence[_history_format.SlamHistorySnapshot],
    active_reads: Mapping[str, int],
    reserved: set[str],
) -> _history_format.SlamHistorySnapshot | None:
    """Prefer duplicate automatic samples and preserve the last sample per floor."""
    candidates = [
        item
        for item in snapshots
        if item.retention == "automatic"
        and item.record_id not in reserved
        and active_reads.get(item.record_id, 0) == 0
    ]
    if not candidates:
        return None
    counts: dict[str | None, int] = {}
    for item in snapshots:
        counts[item.mission_token] = counts.get(item.mission_token, 0) + 1
    duplicates = [item for item in candidates if counts.get(item.mission_token, 0) > 1]
    return min(duplicates or candidates, key=lambda item: item.created_at)
