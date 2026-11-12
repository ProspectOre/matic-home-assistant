"""Serve the active administrator-only SLAM scene as a manifest and its pages."""

from __future__ import annotations

import asyncio
import secrets
from collections import deque
from collections.abc import Mapping
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
from .client.slam_scene import (
    SCENE_PAGE_ID_BYTES,
    ScenePage,
    encode_scene_manifest,
    encode_scene_page,
    scene_frame,
    scene_metadata,
    scene_point_count,
    scene_sample_step,
)
from .client.slam_tiles import SlamTile
from .http import (
    PRIVATE_NO_STORE_HEADERS,
    SCENE_API_URL,
    SCENE_PAGES_API_URL,
    runtime_for_entry,
)
from .slam_decoded_map import page_digest
from .slam_map_store import SlamMapIdentity

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticRuntimeData

SCENE_ENCODE_ATTEMPTS = 2
SCENE_CACHE_REVISIONS = 2
REVISION_WAIT_SECONDS = 5
MAX_PAGES_PER_REQUEST = 256
MANIFEST_CONTENT_TYPE = "application/vnd.matic.slam-manifest"

type _SceneKey = tuple[int, SlamMapIdentity | None, FloorPlan | None]


@dataclass(frozen=True, slots=True)
class _EncodedPage:
    """One page's sampled points, reusable while its content and step hold."""

    shown_points: int
    sample_step: int
    page: ScenePage


@dataclass(frozen=True, slots=True)
class _EncodedScene:
    """A manifest and its pages, keyed by content digest and by page address."""

    manifest: bytes
    etag: str
    by_content: Mapping[bytes, _EncodedPage]
    by_address: Mapping[bytes, ScenePage]


@dataclass(frozen=True, slots=True)
class _CachedScene:
    """One encoded scene retained only in process memory."""

    key: _SceneKey
    encoded: _EncodedScene
    revision: int
    floor_plan_coherent: bool


@dataclass(frozen=True, slots=True)
class _SceneGeneration:
    """A privacy-safe transport generation for one private scene identity."""

    key: _SceneKey
    revision: int


class MaticSlamSceneView(HomeAssistantView):
    """Serve the scene manifest to an authenticated administrator.

    With ``since``, wait up to five seconds for a newer revision and answer
    204 if none arrives.
    """

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
            # A live map revision may advance much faster than its encoder.
            # The panel's revision wait joins the background build and moves
            # on from this safe scene without blanking the workspace.
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

    def scene_page(
        self, entry_id: str, runtime: MaticRuntimeData, page_id: bytes
    ) -> ScenePage | None:
        """Return a page of a recent scene of the live map, by its address."""
        identity = runtime.slam_map.mission_identity
        return next(
            (
                page
                for scene in reversed(self._versions.get(entry_id, ()))
                if scene.key[1] == identity
                and (page := scene.encoded.by_address.get(page_id)) is not None
            ),
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
                            {} if cached is None else cached.encoded.by_content,
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
                cached = _CachedScene(key, encoded, scene_revision, floor_plan_coherent)
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
        """Return the current manifest, using an ETag for live refreshes."""
        since: int | None = None
        if "since" in request.query:
            try:
                since = int(request.query["since"])
            except ValueError:
                since = -1
            if not 0 <= since < 2**64:
                return _response(HTTPStatus.BAD_REQUEST)
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None:
            return _response(HTTPStatus.NOT_FOUND)
        try:
            cached = await self.async_scene(
                hass,
                entry_id,
                runtime,
                allow_stale=since is None
                and request.headers.get("X-Matic-Prefer-Cached") == "1",
            )
            if (
                cached is not None
                and cached.revision == since
                and await _async_wait_for_change(runtime)
            ):
                if runtime_for_entry(hass, entry_id) is not runtime:
                    return _response(HTTPStatus.NOT_FOUND)
                cached = await self.async_scene(hass, entry_id, runtime)
        except DecodeError:
            return _response(HTTPStatus.CONFLICT)
        if cached is None:
            return _response(HTTPStatus.NOT_FOUND)
        headers = {
            "ETag": cached.encoded.etag,
            "X-Matic-Revision": str(cached.revision),
            "X-Matic-Floor-Coherent": "1" if cached.floor_plan_coherent else "0",
        }
        if cached.revision == since:
            return _response(HTTPStatus.NO_CONTENT, headers)
        if request.headers.get("If-None-Match") == cached.encoded.etag:
            return _response(HTTPStatus.NOT_MODIFIED, headers)
        return web.Response(
            body=cached.encoded.manifest,
            content_type=MANIFEST_CONTENT_TYPE,
            headers={**PRIVATE_NO_STORE_HEADERS, **headers},
        )


class MaticSlamScenePagesView(HomeAssistantView):
    """Serve the points of requested scene pages, by content address."""

    url = SCENE_PAGES_API_URL
    name = "api:matic_robot:slam_scene_pages"

    def __init__(self, scene_view: MaticSlamSceneView) -> None:
        self._scene_view = scene_view

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the pages' points back to back, in the order requested."""
        try:
            page_ids = [
                bytes.fromhex(value) for value in request.query["ids"].split(",")
            ]
        except KeyError, ValueError:
            page_ids = []
        if not 0 < len(page_ids) <= MAX_PAGES_PER_REQUEST or any(
            len(page_id) != SCENE_PAGE_ID_BYTES for page_id in page_ids
        ):
            return _response(HTTPStatus.BAD_REQUEST)
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if (
            runtime is None
            or getattr(runtime.slam_map, "live_session_verified", False) is not True
        ):
            return _response(HTTPStatus.NOT_FOUND)
        pages = [
            self._scene_view.scene_page(entry_id, runtime, page_id)
            for page_id in page_ids
        ]
        if None in pages:
            # The scene moved on; the panel reads the new manifest.
            return _response(HTTPStatus.NOT_FOUND)
        return web.Response(
            body=b"".join(page.points for page in pages if page is not None),
            content_type="application/octet-stream",
            headers=PRIVATE_NO_STORE_HEADERS,
        )


async def _async_wait_for_change(runtime: MaticRuntimeData) -> bool:
    """Wait for a map or floor-plan change; return False after the wait."""
    changed = asyncio.Event()
    remove_listeners = [
        runtime.slam_map.async_add_listener(changed.set),
        runtime.session.floor.subscribe(changed.set),
    ]
    try:
        async with asyncio.timeout(REVISION_WAIT_SECONDS):
            await changed.wait()
    except TimeoutError:
        return False
    finally:
        for remove_listener in remove_listeners:
            remove_listener()
    return True


def _response(
    status: HTTPStatus, headers: Mapping[str, str] | None = None
) -> web.Response:
    return web.Response(
        status=status, headers={**PRIVATE_NO_STORE_HEADERS, **(headers or {})}
    )


def _encode_scene(
    tiles: tuple[SlamTile, ...],
    floor_plan: FloorPlan | None,
    previous: Mapping[bytes, _EncodedPage],
) -> _EncodedScene:
    """Encode the manifest off the event loop, reusing unchanged pages."""
    frame = scene_frame(tiles)
    digests = [page_digest(tile) for tile in tiles]
    known = [previous.get(digest) for digest in digests]
    counts = [
        scene_point_count(tile) if page is None else page.shown_points
        for tile, page in zip(tiles, known, strict=True)
    ]
    sample_step = scene_sample_step(counts)
    by_content = {
        digest: (
            page
            if page is not None and page.sample_step == sample_step
            else _EncodedPage(count, sample_step, encode_scene_page(tile, sample_step))
        )
        for tile, digest, page, count in zip(tiles, digests, known, counts, strict=True)
    }
    pages = [by_content[digest].page for digest in digests]
    manifest = encode_scene_manifest(
        scene_metadata(tiles, frame, sample_step, floor_plan=floor_plan), tiles, pages
    )
    return _EncodedScene(
        manifest,
        f'"{sha256(manifest).hexdigest()[:24]}"',
        by_content,
        {page.page_id: page for page in pages},
    )


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
