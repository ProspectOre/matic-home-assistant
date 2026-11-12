"""Serve and cache the active administrator-only SLAM scene."""

from __future__ import annotations

import asyncio
import secrets
from collections import deque
from dataclasses import dataclass
from functools import partial
from hashlib import sha256
from http import HTTPStatus
from typing import TYPE_CHECKING

from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.models import FloorPlan
from .client.slam_scene import encode_slam_scene
from .client.slam_tiles import SlamTile
from .http import (
    DELTA_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    SCENE_API_URL,
    runtime_for_entry,
)
from .slam_delta import encode_slam_scene_delta
from .slam_map_store import SlamMapIdentity

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticRuntimeData

SCENE_ENCODE_ATTEMPTS = 2
SCENE_CACHE_REVISIONS = 2
DELTA_WAIT_SECONDS = 5

type _SceneKey = tuple[int, SlamMapIdentity | None, FloorPlan | None]


@dataclass(frozen=True, slots=True)
class _CachedScene:
    """One compact payload retained only in process memory."""

    key: _SceneKey
    payload: bytes
    etag: str
    revision: int
    floor_plan_coherent: bool


@dataclass(frozen=True, slots=True)
class _SceneGeneration:
    """A privacy-safe transport generation for one private scene identity."""

    key: _SceneKey
    revision: int


@dataclass(frozen=True, slots=True)
class _EncodedScene:
    """Scene payload and digest produced together off the event loop."""

    payload: bytes
    etag: str


class MaticSlamSceneView(HomeAssistantView):
    """Serve a bounded binary point cloud to an authenticated administrator."""

    url = SCENE_API_URL
    name = "api:matic_robot:slam_scene"

    def __init__(self) -> None:
        self._cache: dict[str, _CachedScene] = {}
        self._versions: dict[str, deque[_CachedScene]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._tasks: dict[str, asyncio.Task[_CachedScene | None]] = {}
        self._epochs: dict[str, int] = {}
        self._generations: dict[str, _SceneGeneration] = {}
        self._scene_epochs: dict[str, str] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget all in-memory scene material retained for one robot."""
        self._epochs[entry_id] = self._epochs.get(entry_id, 0) + 1
        if entry_id in self._generations:
            self._scene_epochs[entry_id] = secrets.token_hex(16)
        self._cache.pop(entry_id, None)
        self._versions.pop(entry_id, None)
        task = self._tasks.pop(entry_id, None)
        try:
            current_task = asyncio.current_task()
        except RuntimeError:
            current_task = None
        if task is not None and task is not current_task:
            task.cancel()
        self._locks.pop(entry_id, None)
        self._generations.pop(entry_id, None)

    def _scene_task_done(
        self,
        entry_id: str,
        task: asyncio.Task[_CachedScene | None],
    ) -> None:
        """Release one completed encoder and consume any detached exception."""
        if self._tasks.get(entry_id) is task:
            self._tasks.pop(entry_id, None)
        try:
            task.exception()
        except asyncio.CancelledError:
            pass

    def current_revision(self, entry_id: str, runtime: MaticRuntimeData) -> int:
        """Return a monotonic revision covering SLAM and floor-plan changes."""
        key = _scene_snapshot_key(runtime)
        return self._revision_for_key(entry_id, key)

    def scene_epoch(self, entry_id: str) -> str:
        """Return the opaque identity for this entry's transport revision counter."""
        epoch = self._scene_epochs.get(entry_id)
        if epoch is None:
            epoch = secrets.token_hex(16)
            self._scene_epochs[entry_id] = epoch
        return epoch

    def available_revision(self, entry_id: str, runtime: MaticRuntimeData) -> int:
        """Return the newest safe scene a newly opened panel can receive now."""
        key = _scene_snapshot_key(runtime)
        cached = self._cache.get(entry_id)
        if cached is not None and _scene_snapshot_is_publishable(
            runtime,
            cached.key[1],
            cached.key[2],
            cached.floor_plan_coherent,
        ):
            # Advertise the scene that a newly opened panel can receive now.
            # A live map revision may advance much faster than its expensive
            # binary encoder. The delta request will join the background build
            # and advance from this safe base without blanking the workspace.
            return cached.revision
        return self._revision_for_key(entry_id, key)

    def _revision_for_key(self, entry_id: str, key: _SceneKey) -> int:
        """Return a monotonic transport revision for one captured scene key."""
        current = self._generations.get(entry_id)
        if current is not None and current.key == key:
            return current.revision
        revision = max(
            key[0],
            current.revision + 1 if current is not None else 0,
        )
        self._generations[entry_id] = _SceneGeneration(key, revision)
        return revision

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
        *,
        allow_stale: bool = False,
    ) -> _CachedScene | None:
        """Encode or return the current coherent scene snapshot."""
        if getattr(runtime.slam_map, "live_session_verified", False) is not True:
            self.clear_entry(entry_id)
            return None
        epoch = self._epochs.get(entry_id, 0)
        key = _scene_snapshot_key(runtime)
        cached = self._cache.get(entry_id)
        if cached is not None and cached.key == key:
            return cached
        queued_after = cached
        task = self._tasks.get(entry_id)
        if task is None:
            task = asyncio.create_task(
                self._async_build_scene(
                    hass,
                    entry_id,
                    runtime,
                    epoch,
                    queued_after,
                )
            )
            self._tasks[entry_id] = task
            task.add_done_callback(partial(self._scene_task_done, entry_id))
        if (
            allow_stale
            and cached is not None
            and _scene_snapshot_is_publishable(
                runtime,
                cached.key[1],
                cached.key[2],
                cached.floor_plan_coherent,
            )
        ):
            return cached
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            # A cancelled HTTP waiter must not own and discard an expensive
            # scene build. Internal invalidation cancels the shared task and
            # resolves remaining waiters as unavailable instead.
            request_task = asyncio.current_task()
            if request_task is not None and request_task.cancelling():
                raise
            return None

    async def _async_build_scene(
        self,
        hass: HomeAssistant,
        entry_id: str,
        runtime: MaticRuntimeData,
        epoch: int,
        queued_after: _CachedScene | None,
    ) -> _CachedScene | None:
        """Build and publish one coherent scene independently of HTTP waiters."""
        lock = self._locks.setdefault(entry_id, asyncio.Lock())
        async with lock:
            if (
                self._epochs.get(entry_id, 0) != epoch
                or runtime_for_entry(hass, entry_id) is not runtime
            ):
                return None
            # A concurrent encoder can populate this cache while this request
            # waits for the lock. Check the live session before returning that
            # newly available payload, not only before entering the lock.
            if getattr(runtime.slam_map, "live_session_verified", False) is not True:
                self.clear_entry(entry_id)
                return None
            cached = self._cache.get(entry_id)
            if cached is not None and cached is not queued_after:
                return cached
            for _attempt in range(SCENE_ENCODE_ATTEMPTS):
                map_revision = runtime.slam_map.revision
                identity = runtime.slam_map.mission_identity
                floor_plan = runtime.session.floor.value
                key = (map_revision, identity, floor_plan)
                if (
                    getattr(runtime.slam_map, "live_session_verified", False)
                    is not True
                ):
                    self.clear_entry(entry_id)
                    return None
                cached = self._cache.get(entry_id)
                if cached is not None and cached.key == key:
                    return cached
                floor_plan_coherent = runtime.slam_map.floor_plan_is_current(floor_plan)
                # Requested before any await, so this is the ``map_revision`` map.
                decoded = await runtime.slam_map.async_decoded_map()
                try:
                    encoded = await hass.async_add_executor_job(
                        partial(
                            _encode_scene,
                            decoded.tiles,
                            floor_plan if floor_plan_coherent else None,
                        )
                    )
                except DecodeError:
                    if not _scene_snapshot_is_current(
                        runtime, map_revision, identity, floor_plan
                    ):
                        continue
                    raise
                if (
                    self._epochs.get(entry_id, 0) != epoch
                    or runtime_for_entry(hass, entry_id) is not runtime
                ):
                    return None
                if not _scene_snapshot_is_publishable(
                    runtime, identity, floor_plan, floor_plan_coherent
                ):
                    continue
                # The encoded bytes represent the captured key, not a newer
                # same-mission pixel refinement that may have arrived while a
                # large scene was encoded. Publish this coherent point-in-time
                # snapshot; the next request will observe and encode the newer
                # key without starving the current request.
                scene_revision = self._revision_for_key(entry_id, key)
                cached = _CachedScene(
                    key,
                    encoded.payload,
                    encoded.etag,
                    scene_revision,
                    floor_plan_coherent,
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
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            cached = await self.async_scene(
                hass,
                entry_id,
                runtime,
                allow_stale=request.headers.get("X-Matic-Prefer-Cached") == "1",
            )
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
                    "X-Matic-Floor-Coherent": _header_bool(cached.floor_plan_coherent),
                },
            )
        return web.Response(
            body=cached.payload,
            content_type="application/vnd.matic.slam-scene",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": cached.etag,
                "X-Matic-Revision": str(cached.revision),
                "X-Matic-Floor-Coherent": _header_bool(cached.floor_plan_coherent),
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
        runtime = runtime_for_entry(hass, entry_id)
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
            remove_listeners = [
                runtime.slam_map.async_add_listener(changed.set),
                runtime.session.floor.subscribe(changed.set),
            ]
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
                                "X-Matic-Floor-Coherent": _header_bool(
                                    current.floor_plan_coherent
                                ),
                            },
                        )
            finally:
                for remove_listener in remove_listeners:
                    remove_listener()
        if runtime_for_entry(hass, entry_id) is not runtime:
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
                    "X-Matic-Floor-Coherent": _header_bool(current.floor_plan_coherent),
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
        if runtime_for_entry(
            hass, entry_id
        ) is not runtime or not _scene_snapshot_is_publishable(
            runtime,
            current.key[1],
            current.key[2],
            current.floor_plan_coherent,
        ):
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if delta is None:
            return web.Response(
                body=current.payload,
                content_type="application/vnd.matic.slam-scene",
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "ETag": current.etag,
                    "X-Matic-Revision": str(current.revision),
                    "X-Matic-Floor-Coherent": _header_bool(current.floor_plan_coherent),
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
                "X-Matic-Floor-Coherent": _header_bool(current.floor_plan_coherent),
            },
        )


def _encode_scene(
    tiles: tuple[SlamTile, ...], floor_plan: FloorPlan | None
) -> _EncodedScene:
    """Encode a stable store snapshot off the event loop."""
    payload = encode_slam_scene(tiles, floor_plan=floor_plan)
    return _EncodedScene(payload, f'"{sha256(payload).hexdigest()[:24]}"')


def _scene_snapshot_is_current(
    runtime: MaticRuntimeData,
    revision: int,
    identity: SlamMapIdentity | None,
    floor_plan: FloorPlan | None,
) -> bool:
    """Return whether an encoded snapshot still matches live map identity."""
    return runtime.slam_map.revision == revision and _scene_snapshot_is_publishable(
        runtime,
        identity,
        floor_plan,
        runtime.slam_map.floor_plan_is_current(floor_plan),
    )


def _scene_snapshot_is_publishable(
    runtime: MaticRuntimeData,
    identity: SlamMapIdentity | None,
    floor_plan: FloorPlan | None,
    floor_plan_coherent: bool,
) -> bool:
    """Return whether a captured point-in-time scene remains safe to publish."""
    return (
        getattr(runtime.slam_map, "live_session_verified", False) is True
        and runtime.slam_map.mission_identity == identity
        and runtime.session.floor.value == floor_plan
        and runtime.slam_map.floor_plan_is_current(floor_plan) == floor_plan_coherent
    )


def _scene_snapshot_key(runtime: MaticRuntimeData) -> _SceneKey:
    """Return the complete private identity of the currently renderable scene."""
    return (
        runtime.slam_map.revision,
        runtime.slam_map.mission_identity,
        runtime.session.floor.value,
    )


def _header_bool(value: bool) -> str:
    return "1" if value else "0"
