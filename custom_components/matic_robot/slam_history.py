"""Private, bounded history for local SLAM scenes."""

from __future__ import annotations

import asyncio
import base64
import zlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from hashlib import sha256
from typing import Any

from google.protobuf.message import DecodeError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .client.models import FloorPlan, HermesCollectionEntry
from .client.slam_map import (
    decode_slam_tile,
    encode_slam_scene,
    parse_slam_scene_header,
)
from .const import DOMAIN
from .slam_delta import MAX_SCENE_BYTES
from .slam_map_store import MAP_SETTLE_SECONDS, SlamMapIdentity, SlamMapStore

STORAGE_VERSION = 1
MAX_HISTORY_ITEMS = 12
MAX_HISTORY_COMPRESSED_BYTES = 48 * 1024 * 1024
MIN_HISTORY_INTERVAL_SECONDS = 5 * 60
SAVE_DELAY_SECONDS = 1


@dataclass(frozen=True, slots=True)
class SlamHistorySnapshot:
    """One compressed local scene and its content-free catalog metadata."""

    snapshot_id: str
    created_at: datetime
    revision: int
    point_count: int
    compressed: bytes
    mission_token: str | None = None


class SlamHistoryStore:
    """Retain a bounded local timeline outside Recorder and entity state."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            f"{DOMAIN}.slam_history.{entry_id}",
            private=True,
            serialize_in_event_loop=False,
        )
        self._snapshots: list[SlamHistorySnapshot] = []
        self._closed = False

    async def async_load(self) -> None:
        """Load and validate retained scenes off the event loop."""
        stored = await self._store.async_load() or {}
        snapshots, dirty = await self._hass.async_add_executor_job(
            _decode_history, stored
        )
        self._snapshots = snapshots
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
        snapshot = await self._hass.async_add_executor_job(
            _build_snapshot,
            scene,
            revision,
            created_at or datetime.now(UTC),
            mission_token,
        )
        if (
            self._snapshots
            and self._snapshots[-1].snapshot_id == snapshot.snapshot_id
            and self._snapshots[-1].mission_token == snapshot.mission_token
        ):
            return False
        if (
            self._snapshots
            and self._snapshots[-1].mission_token == snapshot.mission_token
            and (snapshot.created_at - self._snapshots[-1].created_at).total_seconds()
            < MIN_HISTORY_INTERVAL_SECONDS
        ):
            self._snapshots[-1] = snapshot
        else:
            self._snapshots.append(snapshot)
        _enforce_history_bounds(self._snapshots)
        self._schedule_save()
        return True

    def catalog(self) -> tuple[SlamHistorySnapshot, ...]:
        """Return immutable snapshot metadata and compressed payload references."""
        return tuple(self._snapshots)

    def catalog_for_mission(
        self, mission_token: str | None
    ) -> tuple[SlamHistorySnapshot, ...]:
        """Return only snapshots proven to belong to the active map mission."""
        if not _valid_mission_token(mission_token):
            return ()
        return tuple(
            snapshot
            for snapshot in self._snapshots
            if snapshot.mission_token == mission_token
        )

    def catalogs_by_mission(
        self,
    ) -> tuple[tuple[str, tuple[SlamHistorySnapshot, ...]], ...]:
        """Group classified snapshots by floor without exposing map content."""
        grouped: dict[str, list[SlamHistorySnapshot]] = {}
        for snapshot in self._snapshots:
            mission_token = snapshot.mission_token
            if not isinstance(mission_token, str) or not _valid_mission_token(
                mission_token
            ):
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
                if candidate.snapshot_id == snapshot_id
                and (mission_token is None or candidate.mission_token == mission_token)
            ),
            None,
        )
        if snapshot is None:
            return None
        return await self._hass.async_add_executor_job(
            _decompress_scene, snapshot.compressed
        )

    async def async_shutdown(self) -> None:
        """Resolve delayed writes before the config entry unloads."""
        if self._closed:
            return
        self._closed = True
        data = await self._hass.async_add_executor_job(
            _serialize_history, tuple(self._snapshots)
        )
        await self._store.async_save(data)

    async def async_remove(self) -> None:
        """Erase every retained scene for a removed config entry."""
        self._closed = True
        self._snapshots.clear()
        await self._store.async_remove()

    def _schedule_save(self) -> None:
        if self._closed:
            return
        self._store.async_delay_save(
            partial(_serialize_history, tuple(self._snapshots)),
            SAVE_DELAY_SECONDS,
        )


async def async_collect_slam_history(
    hass: HomeAssistant,
    slam_map: SlamMapStore,
    history: SlamHistoryStore,
    floor_plan: Callable[[], FloorPlan | None],
    floor_plan_listener: Callable[[Callable[[], None]], Callable[[], None]]
    | None = None,
) -> None:
    """Capture a checkpoint after each stable, complete map revision."""
    changed = asyncio.Event()
    changed.set()
    remove_listeners = [slam_map.async_add_listener(changed.set)]
    if floor_plan_listener is not None:
        observed_floor_plan = floor_plan()

        def _floor_plan_changed() -> None:
            nonlocal observed_floor_plan
            current_floor_plan = floor_plan()
            if current_floor_plan == observed_floor_plan:
                return
            observed_floor_plan = current_floor_plan
            changed.set()

        remove_listeners.append(floor_plan_listener(_floor_plan_changed))
    try:
        while True:
            await changed.wait()
            changed.clear()
            revision = slam_map.revision
            await asyncio.sleep(MAP_SETTLE_SECONDS)
            if revision != slam_map.revision:
                changed.set()
                continue
            if not slam_map.map_complete:
                continue
            identity = slam_map.mission_identity
            entries = slam_map.entries()
            current_floor_plan = floor_plan()
            if not _mission_matches_floor_plan(identity, current_floor_plan):
                continue
            try:
                scene = await hass.async_add_executor_job(
                    partial(_encode_history_scene, entries, current_floor_plan)
                )
            except DecodeError:
                continue
            if (
                revision != slam_map.revision
                or identity != slam_map.mission_identity
                or current_floor_plan != floor_plan()
            ):
                changed.set()
                continue
            assert identity is not None
            await history.async_add(
                scene,
                revision,
                mission_token=identity.mission_token,
            )
    finally:
        for remove_listener in remove_listeners:
            remove_listener()


def _encode_history_scene(
    entries: tuple[HermesCollectionEntry, ...], floor_plan: FloorPlan | None
) -> bytes:
    return encode_slam_scene(
        tuple(decode_slam_tile(entry) for entry in entries),
        floor_plan=floor_plan,
    )


def _build_snapshot(
    scene: bytes,
    revision: int,
    created_at: datetime,
    mission_token: str | None,
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
    )


def _serialize_history(
    snapshots: tuple[SlamHistorySnapshot, ...],
) -> dict[str, list[dict[str, object]]]:
    return {
        "snapshots": [
            {
                "id": snapshot.snapshot_id,
                "created_at": snapshot.created_at.isoformat(),
                "revision": snapshot.revision,
                "point_count": snapshot.point_count,
                "mission_token": snapshot.mission_token,
                "scene": base64.b64encode(snapshot.compressed).decode("ascii"),
            }
            for snapshot in snapshots
        ]
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
            compressed = base64.b64decode(item["scene"], validate=True)
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
            ):
                raise ValueError
            scene = _decompress_scene(compressed)
            header = parse_slam_scene_header(scene)
            if (
                sha256(scene).hexdigest()[:24] != snapshot_id
                or header.point_count != point_count
            ):
                raise ValueError
        except DecodeError, KeyError, TypeError, ValueError, zlib.error:
            dirty = True
            continue
        snapshots.append(
            SlamHistorySnapshot(
                snapshot_id,
                created_at.astimezone(UTC),
                revision,
                point_count,
                compressed,
                mission_token,
            )
        )
    snapshots.sort(key=lambda snapshot: snapshot.created_at)
    before = tuple(snapshot.snapshot_id for snapshot in snapshots)
    _enforce_history_bounds(snapshots)
    dirty |= before != tuple(snapshot.snapshot_id for snapshot in snapshots)
    return snapshots, dirty


def _mission_matches_floor_plan(
    identity: SlamMapIdentity | None, floor_plan: FloorPlan | None
) -> bool:
    return identity is not None and identity.matches_floor_plan(floor_plan)


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
    scene = decompressor.decompress(compressed, MAX_SCENE_BYTES + 1)
    if (
        len(scene) > MAX_SCENE_BYTES
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
        snapshots.pop(0)
    while (
        len(snapshots) > 1
        and sum(len(snapshot.compressed) for snapshot in snapshots)
        > MAX_HISTORY_COMPRESSED_BYTES
    ):
        snapshots.pop(0)
