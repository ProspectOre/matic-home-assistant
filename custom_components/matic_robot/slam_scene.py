"""Authenticated local HTTP views for the private 3D SLAM studio."""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass
from functools import partial
from hashlib import sha256
from http import HTTPStatus
from time import monotonic
from typing import TYPE_CHECKING, cast

from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.components.http.decorators import require_admin
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.exceptions import MaticError
from .client.floor_plan import resolve_robot_map_position
from .client.models import FloorPlan, HermesCollectionEntry, RobotPose
from .client.slam_map import decode_slam_tile, encode_slam_scene
from .const import DOMAIN
from .slam_delta import encode_slam_scene_delta

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticConfigEntry, MaticRuntimeData

SCENE_API_URL = "/api/matic_robot/slam_scene/{entry_id}"
POSE_API_URL = "/api/matic_robot/slam_pose/{entry_id}"
CATALOG_API_URL = "/api/matic_robot/slam_entries"
DELTA_API_URL = "/api/matic_robot/slam_delta/{entry_id}"
HISTORY_API_URL = "/api/matic_robot/slam_history/{entry_id}"
HISTORY_SCENE_API_URL = "/api/matic_robot/slam_history_scene/{entry_id}/{snapshot_id}"
POSE_CACHE_SECONDS = 1.0
SCENE_ENCODE_ATTEMPTS = 2
SCENE_CACHE_REVISIONS = 2
DELTA_WAIT_SECONDS = 5

PRIVATE_NO_STORE_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
}


def scene_api_url(entry_id: str) -> str:
    """Return the authenticated scene URL for one config entry."""
    return SCENE_API_URL.format(entry_id=entry_id)


def pose_api_url(entry_id: str) -> str:
    """Return the authenticated live-pose URL for one config entry."""
    return POSE_API_URL.format(entry_id=entry_id)


def delta_api_url(entry_id: str) -> str:
    """Return the authenticated live-delta URL for one config entry."""
    return DELTA_API_URL.format(entry_id=entry_id)


def history_api_url(entry_id: str) -> str:
    """Return the authenticated history catalog URL for one config entry."""
    return HISTORY_API_URL.format(entry_id=entry_id)


def history_scene_api_url(entry_id: str, snapshot_id: str) -> str:
    """Return the authenticated URL for one retained scene."""
    return HISTORY_SCENE_API_URL.format(entry_id=entry_id, snapshot_id=snapshot_id)


def _runtime_for_entry(hass: HomeAssistant, entry_id: str) -> MaticRuntimeData | None:
    entry = hass.config_entries.async_get_entry(entry_id)
    if (
        entry is None
        or entry.domain != DOMAIN
        or entry.state is not ConfigEntryState.LOADED
    ):
        return None
    return cast("MaticConfigEntry", entry).runtime_data


@dataclass(frozen=True, slots=True)
class _CachedScene:
    """One compact payload retained only in process memory."""

    key: tuple[object, ...]
    payload: bytes
    etag: str
    revision: int


@dataclass(frozen=True, slots=True)
class _EncodedScene:
    """Scene payload and digest produced together off the event loop."""

    payload: bytes
    etag: str


@dataclass(frozen=True, slots=True)
class _CachedPose:
    """One short-lived on-demand pose result."""

    runtime_id: int
    pose: RobotPose | None
    fetched_at: float
    revision: int
    freshness: str


class MaticSlamSceneView(HomeAssistantView):
    """Serve a bounded binary point cloud to an authenticated administrator."""

    url = SCENE_API_URL
    name = "api:matic_robot:slam_scene"

    def __init__(self) -> None:
        self._cache: dict[str, _CachedScene] = {}
        self._versions: dict[str, deque[_CachedScene]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._epochs: dict[str, int] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget all in-memory scene material retained for one robot."""
        self._cache.pop(entry_id, None)
        self._versions.pop(entry_id, None)
        self._locks.pop(entry_id, None)
        self._epochs[entry_id] = self._epochs.get(entry_id, 0) + 1

    def scene_for_revision(self, entry_id: str, revision: int) -> _CachedScene | None:
        """Return a recent in-memory base for a delta request."""
        versions = self._versions.get(entry_id, ())
        return next(
            (scene for scene in reversed(versions) if scene.revision == revision),
            None,
        )

    async def async_scene(
        self,
        hass: HomeAssistant,
        entry_id: str,
        runtime: MaticRuntimeData,
    ) -> _CachedScene | None:
        """Encode or return the current coherent scene snapshot."""
        data = runtime.coordinator.data
        epoch = self._epochs.get(entry_id, 0)
        key = (runtime.slam_map.revision, data.floor_plan)
        cached = self._cache.get(entry_id)
        if cached is not None and cached.key == key:
            return cached
        queued_after = cached
        lock = self._locks.setdefault(entry_id, asyncio.Lock())
        async with lock:
            if (
                self._epochs.get(entry_id, 0) != epoch
                or _runtime_for_entry(hass, entry_id) is not runtime
            ):
                return None
            cached = self._cache.get(entry_id)
            if cached is not None and cached is not queued_after:
                return cached
            for _attempt in range(SCENE_ENCODE_ATTEMPTS):
                data = runtime.coordinator.data
                revision = runtime.slam_map.revision
                floor_plan = data.floor_plan
                key = (revision, floor_plan)
                cached = self._cache.get(entry_id)
                if cached is not None and cached.key == key:
                    return cached
                entries = runtime.slam_map.entries()
                try:
                    encoded = await hass.async_add_executor_job(
                        partial(_encode_scene_entries, entries, floor_plan)
                    )
                except DecodeError:
                    if not _scene_snapshot_is_current(runtime, revision, floor_plan):
                        continue
                    raise
                if (
                    self._epochs.get(entry_id, 0) != epoch
                    or _runtime_for_entry(hass, entry_id) is not runtime
                ):
                    return None
                previous_revision = (
                    cached.revision + 1 if cached is not None else revision
                )
                scene_revision = max(revision, previous_revision)
                cached = _CachedScene(
                    key, encoded.payload, encoded.etag, scene_revision
                )
                self._cache[entry_id] = cached
                versions = self._versions.setdefault(
                    entry_id, deque(maxlen=SCENE_CACHE_REVISIONS)
                )
                if not versions or versions[-1].revision != cached.revision:
                    versions.append(cached)
                return cached
        raise DecodeError("SLAM scene changed before it could be encoded")

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the current local scene, using an ETag for live refreshes."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            cached = await self.async_scene(hass, entry_id, runtime)
        except DecodeError:
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        if cached is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if request.headers.get("If-None-Match") == cached.etag:
            return web.Response(
                status=HTTPStatus.NOT_MODIFIED,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "ETag": cached.etag,
                    "X-Matic-Revision": str(cached.revision),
                },
            )
        return web.Response(
            body=cached.payload,
            content_type="application/vnd.matic.slam-scene",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": cached.etag,
                "X-Matic-Revision": str(cached.revision),
            },
        )


class MaticSlamDeltaView(HomeAssistantView):
    """Long-poll bounded point-cloud changes for the active scene."""

    url = DELTA_API_URL
    name = "api:matic_robot:slam_delta"

    def __init__(self, scene_view: MaticSlamSceneView) -> None:
        self._scene_view = scene_view

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the next delta or a full scene when its base is unavailable."""
        try:
            since = int(request.query.get("since", ""))
        except ValueError:
            since = -1
        if not 0 <= since < 2**64:
            return web.Response(
                status=HTTPStatus.BAD_REQUEST, headers=PRIVATE_NO_STORE_HEADERS
            )
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            current = await self._scene_view.async_scene(hass, entry_id, runtime)
        except DecodeError:
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        if current is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if current.revision == since:
            changed = asyncio.Event()
            remove_listener = runtime.slam_map.async_add_listener(changed.set)
            try:
                if current.revision == since:
                    try:
                        async with asyncio.timeout(DELTA_WAIT_SECONDS):
                            await changed.wait()
                    except TimeoutError:
                        return web.Response(
                            status=HTTPStatus.NO_CONTENT,
                            headers={
                                **PRIVATE_NO_STORE_HEADERS,
                                "X-Matic-Revision": str(since),
                            },
                        )
            finally:
                remove_listener()
        if _runtime_for_entry(hass, entry_id) is not runtime:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            current = await self._scene_view.async_scene(hass, entry_id, runtime)
        except DecodeError:
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        if current is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if current.revision == since:
            return web.Response(
                status=HTTPStatus.NO_CONTENT,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "X-Matic-Revision": str(since),
                },
            )
        base = self._scene_view.scene_for_revision(entry_id, since)
        delta = None
        if base is not None:
            delta = await hass.async_add_executor_job(
                partial(
                    encode_slam_scene_delta,
                    base.payload,
                    current.payload,
                    base_revision=base.revision,
                    revision=current.revision,
                )
            )
        if delta is None:
            return web.Response(
                body=current.payload,
                content_type="application/vnd.matic.slam-scene",
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "ETag": current.etag,
                    "X-Matic-Revision": str(current.revision),
                },
            )
        assert base is not None
        return web.Response(
            body=delta,
            content_type="application/vnd.matic.slam-delta",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": current.etag,
                "X-Matic-Base-Revision": str(base.revision),
                "X-Matic-Revision": str(current.revision),
            },
        )


class MaticSlamHistoryView(HomeAssistantView):
    """List the private, bounded scene timeline for one robot."""

    url = HISTORY_API_URL
    name = "api:matic_robot:slam_history"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return content-free timeline metadata and authenticated scene URLs."""
        runtime = _runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        snapshots = [
            {
                "id": snapshot.snapshot_id,
                "created_at": snapshot.created_at.isoformat(),
                "revision": snapshot.revision,
                "point_count": snapshot.point_count,
                "scene_url": history_scene_api_url(entry_id, snapshot.snapshot_id),
            }
            for snapshot in runtime.slam_history.catalog()
        ]
        return self.json(
            {"entry_id": entry_id, "snapshots": snapshots},
            headers=PRIVATE_NO_STORE_HEADERS,
        )


class MaticSlamHistorySceneView(HomeAssistantView):
    """Serve one retained scene to an authenticated administrator."""

    url = HISTORY_SCENE_API_URL
    name = "api:matic_robot:slam_history_scene"

    @require_admin
    async def get(
        self, request: web.Request, entry_id: str, snapshot_id: str
    ) -> web.Response:
        """Return an immutable historical scene without public caching."""
        runtime = _runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        scene = await runtime.slam_history.async_scene(snapshot_id)
        if scene is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        return web.Response(
            body=scene,
            content_type="application/vnd.matic.slam-scene",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": f'"{snapshot_id}"',
            },
        )


class MaticSlamPoseView(HomeAssistantView):
    """Serve only the current robot marker for lightweight live updates."""

    url = POSE_API_URL
    name = "api:matic_robot:slam_pose"

    def __init__(self) -> None:
        self._cache: dict[str, _CachedPose] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._epochs: dict[str, int] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget exact pose material retained for one robot."""
        self._cache.pop(entry_id, None)
        self._locks.pop(entry_id, None)
        self._epochs[entry_id] = self._epochs.get(entry_id, 0) + 1

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the current position without exposing it to Recorder."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        epoch = self._epochs.get(entry_id, 0)
        cached = self._cache.get(entry_id)
        now = monotonic()
        if (
            cached is None
            or cached.runtime_id != id(runtime)
            or now - cached.fetched_at >= POSE_CACHE_SECONDS
        ):
            lock = self._locks.setdefault(entry_id, asyncio.Lock())
            async with lock:
                if self._epochs.get(entry_id, 0) != epoch:
                    return web.Response(
                        status=HTTPStatus.NOT_FOUND,
                        headers=PRIVATE_NO_STORE_HEADERS,
                    )
                cached = self._cache.get(entry_id)
                now = monotonic()
                if (
                    cached is None
                    or cached.runtime_id != id(runtime)
                    or now - cached.fetched_at >= POSE_CACHE_SECONDS
                ):
                    pose: RobotPose | None
                    try:
                        pose = await runtime.client.async_get_pose()
                        freshness = "live"
                    except MaticError:
                        pose = runtime.coordinator.data.pose
                        freshness = "coordinator_fallback"
                    if (
                        self._epochs.get(entry_id, 0) != epoch
                        or _runtime_for_entry(hass, entry_id) is not runtime
                    ):
                        return web.Response(
                            status=HTTPStatus.NOT_FOUND,
                            headers=PRIVATE_NO_STORE_HEADERS,
                        )
                    previous_revision = (
                        cached.revision
                        if cached is not None and cached.runtime_id == id(runtime)
                        else 0
                    )
                    cached = _CachedPose(
                        id(runtime),
                        pose,
                        monotonic(),
                        previous_revision + 1,
                        freshness,
                    )
                    self._cache[entry_id] = cached
        data = runtime.coordinator.data
        position = resolve_robot_map_position(
            data.floor_plan, cached.pose, data.operational.current_area
        )
        return self.json(
            {
                "position": list(position[:2]) if position is not None else None,
                "source": position[2] if position is not None else "unavailable",
                "revision": runtime.slam_map.revision,
                "pose_revision": cached.revision,
                "pose_age_seconds": round(max(0.0, monotonic() - cached.fetched_at), 3),
                "pose_freshness": cached.freshness,
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


class MaticSlamCatalogView(HomeAssistantView):
    """List private scene endpoints for loaded robots to administrators only."""

    url = CATALOG_API_URL
    name = "api:matic_robot:slam_entries"

    @require_admin
    async def get(self, request: web.Request) -> web.Response:
        """Return non-persistent discovery data for the admin-only map panel."""
        hass = request.app[KEY_HASS]
        entries = []
        for entry in hass.config_entries.async_entries(DOMAIN):
            runtime = _runtime_for_entry(hass, entry.entry_id)
            if runtime is None:
                continue
            health = runtime.slam_map.health
            entries.append(
                {
                    "entry_id": entry.entry_id,
                    "scene_url": scene_api_url(entry.entry_id),
                    "delta_url": delta_api_url(entry.entry_id),
                    "pose_url": pose_api_url(entry.entry_id),
                    "history_url": history_api_url(entry.entry_id),
                    "history_count": len(runtime.slam_history.catalog()),
                    "map_revision": runtime.slam_map.revision,
                    "map_health": health.state,
                    "map_complete": health.complete,
                    "map_truncated": health.truncated,
                    "cached_tiles": health.photo_tiles,
                    "structural_tiles": health.structure_tiles,
                    "dropped_photo_tiles": health.dropped_photo_tiles,
                    "dropped_structure_tiles": health.dropped_structure_tiles,
                    "invalid_tiles": health.invalid_tiles,
                    "stream_state": health.stream_state,
                    "stream_failures": health.stream_failures,
                }
            )
        return self.json({"entries": entries}, headers=PRIVATE_NO_STORE_HEADERS)


def _encode_scene_entries(
    entries: tuple[HermesCollectionEntry, ...], floor_plan: FloorPlan | None
) -> _EncodedScene:
    """Decode a stable store snapshot and encode it off the event loop."""
    payload = encode_slam_scene(
        tuple(decode_slam_tile(entry) for entry in entries),
        floor_plan=floor_plan,
    )
    return _EncodedScene(payload, f'"{sha256(payload).hexdigest()[:24]}"')


def _scene_snapshot_is_current(
    runtime: MaticRuntimeData, revision: int, floor_plan: FloorPlan | None
) -> bool:
    """Return whether an encoded snapshot still matches live map identity."""
    return (
        runtime.slam_map.revision == revision
        and runtime.coordinator.data.floor_plan == floor_plan
    )
