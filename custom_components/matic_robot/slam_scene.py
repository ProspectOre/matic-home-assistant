"""Authenticated local HTTP views for the private 3D SLAM studio."""

from __future__ import annotations

import asyncio
import json
from collections import deque
from dataclasses import dataclass
from functools import partial
from hashlib import sha256
from http import HTTPStatus
from time import monotonic
from typing import TYPE_CHECKING, cast

import voluptuous as vol
from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.components.http.decorators import require_admin
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView
from homeassistant.util import slugify

from .area_binding import (
    AREA_SCHEMA_VERSION,
    AreaBindingStatus,
    area_binding_allows_review,
    area_binding_status,
    binding_for_area,
)
from .area_selector import MaticAreaSelector
from .client.commands import CleaningMode, CoverageSetting
from .client.exceptions import MaticError
from .client.floor_plan import resolve_robot_map_position, robot_location_source
from .client.models import FloorPlan, HermesCollectionEntry, RobotPose
from .client.slam_map import decode_slam_tile, encode_slam_scene
from .const import DOMAIN
from .slam_delta import encode_slam_scene_delta
from .slam_map_store import SlamMapIdentity

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticConfigEntry, MaticRuntimeData
    from .slam_history import SlamHistorySnapshot

SCENE_API_URL = "/api/matic_robot/slam_scene/{entry_id}"
POSE_API_URL = "/api/matic_robot/slam_pose/{entry_id}"
CATALOG_API_URL = "/api/matic_robot/slam_entries"
DELTA_API_URL = "/api/matic_robot/slam_delta/{entry_id}"
HISTORY_API_URL = "/api/matic_robot/slam_history/{entry_id}"
HISTORY_SCENE_API_URL = "/api/matic_robot/slam_history_scene/{entry_id}/{snapshot_id}"
AREAS_API_URL = "/api/matic_robot/areas/{entry_id}"
PLANS_API_URL = "/api/matic_robot/plans/{entry_id}"
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


def areas_api_url(entry_id: str) -> str:
    """Return the authenticated custom-area workspace URL for one entry."""
    return AREAS_API_URL.format(entry_id=entry_id)


def plans_api_url(entry_id: str) -> str:
    """Return the authenticated cleaning-plan workspace URL for one entry."""
    return PLANS_API_URL.format(entry_id=entry_id)


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
    floor_plan_coherent: bool


@dataclass(frozen=True, slots=True)
class _SceneGeneration:
    """A privacy-safe transport generation for one private scene identity."""

    key: tuple[object, ...]
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
        self._generations: dict[str, _SceneGeneration] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget all in-memory scene material retained for one robot."""
        self._cache.pop(entry_id, None)
        self._versions.pop(entry_id, None)
        self._locks.pop(entry_id, None)
        self._generations.pop(entry_id, None)
        self._epochs[entry_id] = self._epochs.get(entry_id, 0) + 1

    def current_revision(self, entry_id: str, runtime: MaticRuntimeData) -> int:
        """Return a monotonic revision covering SLAM and floor-plan changes."""
        key = _scene_snapshot_key(runtime)
        current = self._generations.get(entry_id)
        if current is not None and current.key == key:
            return current.revision
        revision = max(
            runtime.slam_map.revision,
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
    ) -> _CachedScene | None:
        """Encode or return the current coherent scene snapshot."""
        data = runtime.coordinator.data
        if not bool(getattr(runtime.slam_map, "live_session_verified", True)):
            self.clear_entry(entry_id)
            return None
        epoch = self._epochs.get(entry_id, 0)
        key = _scene_snapshot_key(runtime)
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
            # A concurrent encoder can populate this cache while this request
            # waits for the lock. Check the live session before returning that
            # newly available payload, not only before entering the lock.
            if not bool(getattr(runtime.slam_map, "live_session_verified", True)):
                self.clear_entry(entry_id)
                return None
            cached = self._cache.get(entry_id)
            if cached is not None and cached is not queued_after:
                return cached
            for _attempt in range(SCENE_ENCODE_ATTEMPTS):
                data = runtime.coordinator.data
                map_revision = runtime.slam_map.revision
                identity = runtime.slam_map.mission_identity
                floor_plan = data.floor_plan
                key = (map_revision, identity, floor_plan)
                if not bool(getattr(runtime.slam_map, "live_session_verified", True)):
                    self.clear_entry(entry_id)
                    return None
                cached = self._cache.get(entry_id)
                if cached is not None and cached.key == key:
                    return cached
                entries = runtime.slam_map.entries()
                floor_plan_coherent = runtime.slam_map.floor_plan_is_current(floor_plan)
                try:
                    encoded = await hass.async_add_executor_job(
                        partial(
                            _encode_scene_entries,
                            entries,
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
                    or _runtime_for_entry(hass, entry_id) is not runtime
                ):
                    return None
                if not _scene_snapshot_is_current(
                    runtime, map_revision, identity, floor_plan
                ):
                    continue
                scene_revision = self.current_revision(entry_id, runtime)
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
            remove_listeners = [runtime.slam_map.async_add_listener(changed.set)]
            coordinator_subscribe = getattr(
                runtime.coordinator, "async_add_listener", None
            )
            if callable(coordinator_subscribe):
                remove_listeners.append(coordinator_subscribe(changed.set))
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
        if (
            _runtime_for_entry(hass, entry_id) is not runtime
            or not bool(getattr(runtime.slam_map, "live_session_verified", True))
            or self._scene_view.current_revision(entry_id, runtime) != current.revision
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
        floor_plan = runtime.coordinator.data.floor_plan
        floor_plan_coherent = runtime.slam_map.floor_plan_is_current(floor_plan)
        current_token = (
            runtime.slam_map.mission_identity.mission_token
            if floor_plan_coherent and runtime.slam_map.mission_identity is not None
            else None
        )
        current_snapshots = _mission_history(runtime) if floor_plan_coherent else ()
        floor_labels = (
            {floor.mission_token: floor.label for floor in floor_plan.mapped_floors}
            if floor_plan is not None
            else {}
        )
        floors = [
            {
                "id": "current",
                "active": True,
                "read_only": False,
                "live_available": floor_plan_coherent,
                "label": (
                    floor_plan.floor_label
                    if floor_plan_coherent and floor_plan is not None
                    else None
                ),
                "snapshots": _history_metadata(entry_id, current_snapshots),
            }
        ]
        saved_ordinal = 0
        for (
            mission_token,
            mission_snapshots,
        ) in runtime.slam_history.catalogs_by_mission():
            if mission_token == current_token:
                continue
            saved_ordinal += 1
            floors.append(
                {
                    "id": f"saved-{saved_ordinal}",
                    "active": False,
                    "read_only": True,
                    "ordinal": saved_ordinal,
                    "label": floor_labels.get(mission_token),
                    "snapshots": _history_metadata(entry_id, mission_snapshots),
                }
            )
        return self.json(
            {
                "entry_id": entry_id,
                "live_available": floor_plan_coherent,
                "snapshots": _history_metadata(entry_id, current_snapshots),
                "floors": floors,
            },
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
        snapshot = next(
            (
                candidate
                for candidate in runtime.slam_history.catalog()
                if candidate.snapshot_id == snapshot_id
                and candidate.mission_token is not None
            ),
            None,
        )
        if snapshot is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        scene = await runtime.slam_history.async_scene(
            snapshot_id, mission_token=snapshot.mission_token
        )
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
        floor_plan_coherent = runtime.slam_map.floor_plan_is_current(data.floor_plan)
        position = (
            resolve_robot_map_position(
                data.floor_plan, cached.pose, data.operational.current_area
            )
            if floor_plan_coherent
            else None
        )
        source = (
            robot_location_source(
                data.floor_plan, cached.pose, data.operational.current_area
            )
            if floor_plan_coherent
            else "unavailable"
        )
        return self.json(
            {
                "position": list(position[:2]) if position is not None else None,
                "source": source,
                "revision": runtime.slam_map.revision,
                "map_floor_coherent": floor_plan_coherent,
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

    def __init__(
        self,
        area_editor_url: str,
        scene_view: MaticSlamSceneView | None = None,
    ) -> None:
        """Initialize the catalog with the private area-editor module route."""
        self._area_editor_url = area_editor_url
        self._scene_view = scene_view

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
            floor_plan = runtime.coordinator.data.floor_plan
            mapped_floors = floor_plan.mapped_floors if floor_plan is not None else ()
            selected_floor_ordinal = next(
                (
                    index
                    for index, floor in enumerate(mapped_floors, start=1)
                    if floor_plan is not None
                    and floor.mission_id == floor_plan.mission_id
                ),
                None,
            )
            map_identity = runtime.slam_map.mission_identity
            map_floor_ordinal = next(
                (
                    index
                    for index, floor in enumerate(mapped_floors, start=1)
                    if map_identity is not None
                    and floor.mission_id == map_identity.mission_id
                ),
                None,
            )
            floor_plan_coherent = runtime.slam_map.floor_plan_is_current(floor_plan)
            entries.append(
                {
                    "entry_id": entry.entry_id,
                    "scene_url": scene_api_url(entry.entry_id),
                    "delta_url": delta_api_url(entry.entry_id),
                    "pose_url": pose_api_url(entry.entry_id),
                    "history_url": history_api_url(entry.entry_id),
                    "areas_url": areas_api_url(entry.entry_id),
                    "plans_url": plans_api_url(entry.entry_id),
                    "area_editor_url": self._area_editor_url,
                    "history_count": len(_mission_history(runtime)),
                    "history_floor_count": len(
                        runtime.slam_history.catalogs_by_mission()
                    ),
                    "map_revision": self._scene_view.current_revision(
                        entry.entry_id, runtime
                    )
                    if self._scene_view is not None
                    else runtime.slam_map.revision,
                    "map_floor_coherent": floor_plan_coherent,
                    "selected_floor_ordinal": selected_floor_ordinal,
                    "map_floor_ordinal": map_floor_ordinal,
                    "map_session_verified": getattr(
                        runtime.slam_map,
                        "live_session_verified",
                        floor_plan_coherent,
                    ),
                    "map_health": health.state,
                    "map_complete": health.complete,
                    "map_truncated": health.truncated,
                    "cached_tiles": health.photo_tiles,
                    "structural_tiles": health.structure_tiles,
                    "overlapping_tiles": health.overlapping_tiles,
                    "layer_overlap": round(health.layer_overlap, 4),
                    "dropped_photo_tiles": health.dropped_photo_tiles,
                    "dropped_structure_tiles": health.dropped_structure_tiles,
                    "invalid_tiles": health.invalid_tiles,
                    "stream_state": health.stream_state,
                    "stream_failures": health.stream_failures,
                }
            )
        return self.json({"entries": entries}, headers=PRIVATE_NO_STORE_HEADERS)


class MaticAreasView(HomeAssistantView):
    """Manage map-bound custom areas inside the private map workspace."""

    url = AREAS_API_URL
    name = "api:matic_robot:areas"

    @staticmethod
    def _rooms(runtime: MaticRuntimeData) -> list[dict[str, object]]:
        floor_plan = runtime.coordinator.data.floor_plan
        if floor_plan is None:
            return []
        return [
            {
                "room_id": room.id,
                "name": room.name,
                "boundary": [list(point) for point in room.boundary],
            }
            for room in floor_plan.rooms
        ]

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the live map geometry and private saved-area definitions."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        if (
            floor_plan is None
            or not floor_plan.rooms
            or not runtime.slam_map.floor_plan_is_current(floor_plan)
        ):
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        serial_number = str(runtime.coordinator.data.info.serial_number)
        areas = []
        for area_id, area in runtime.cleaning_plans.areas(serial_number).items():
            status = area_binding_status(area, floor_plan)
            can_rebind = area_binding_allows_review(area, floor_plan)
            areas.append(
                {
                    "id": area_id,
                    "name": str(area.get("name", area_id)),
                    "circles": area.get("circles", [])
                    if status is AreaBindingStatus.CURRENT or can_rebind
                    else [],
                    "cleaning_mode": area.get(
                        "cleaning_mode", CleaningMode.VACUUM.value
                    ),
                    "coverage_setting": area.get(
                        "coverage_setting", CoverageSetting.OPTIMAL.value
                    ),
                    "status": status.value,
                    "can_rebind": can_rebind,
                }
            )
        return self.json(
            {
                "scene_url": scene_api_url(entry_id),
                "rooms": self._rooms(runtime),
                "areas": areas,
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )

    @require_admin
    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        """Create or replace one validated area on the current map."""
        if request.content_length is not None and request.content_length > 131_072:
            return web.Response(
                status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        if (
            floor_plan is None
            or not floor_plan.rooms
            or not runtime.slam_map.floor_plan_is_current(floor_plan)
        ):
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            body = await request.json(loads=json.loads)
            if not isinstance(body, dict):
                raise ValueError
            name = str(body["name"]).strip()
            if not 1 <= len(name) <= 128:
                raise ValueError
            rooms = self._rooms(runtime)
            circles = MaticAreaSelector({"rooms": rooms})(body["circles"])
            cleaning_mode = CleaningMode(str(body["cleaning_mode"]))
            coverage_setting = CoverageSetting(str(body["coverage_setting"]))
            binding = binding_for_area(floor_plan, circles)
        except KeyError, TypeError, ValueError, vol.Invalid:
            return web.Response(
                status=HTTPStatus.BAD_REQUEST, headers=PRIVATE_NO_STORE_HEADERS
            )
        serial_number = str(runtime.coordinator.data.info.serial_number)
        saved = runtime.cleaning_plans.areas(serial_number)
        requested_id = body.get("area_id")
        if requested_id is None:
            area_id = slugify(name)
            if not area_id or area_id in saved:
                return web.Response(
                    status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
                )
        else:
            area_id = str(requested_id)
            if area_id not in saved:
                return web.Response(
                    status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
                )
        if any(
            key != area_id and str(value.get("name", key)).casefold() == name.casefold()
            for key, value in saved.items()
        ):
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        await runtime.cleaning_plans.async_save_area(
            serial_number,
            area_id,
            {
                "schema_version": AREA_SCHEMA_VERSION,
                "name": name,
                "circles": circles,
                "cleaning_mode": cleaning_mode.value,
                "coverage_setting": coverage_setting.value,
                "map_binding": binding,
            },
        )
        return self.json(
            {"id": area_id},
            headers=PRIVATE_NO_STORE_HEADERS,
        )

    @require_admin
    async def delete(self, request: web.Request, entry_id: str) -> web.Response:
        """Delete one saved custom area by its stable identifier."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        area_id = str(request.query.get("area_id", ""))
        serial_number = str(runtime.coordinator.data.info.serial_number)
        if area_id not in runtime.cleaning_plans.areas(serial_number):
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        await runtime.cleaning_plans.async_delete_area(serial_number, area_id)
        return web.Response(
            status=HTTPStatus.NO_CONTENT, headers=PRIVATE_NO_STORE_HEADERS
        )


class MaticPlansView(HomeAssistantView):
    """Expose saved plans and current room choices to the private workspace."""

    url = PLANS_API_URL
    name = "api:matic_robot:plans"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return a bounded plan editor model for one loaded robot."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        if (
            floor_plan is None
            or not floor_plan.rooms
            or not runtime.slam_map.floor_plan_is_current(floor_plan)
        ):
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        serial_number = str(runtime.coordinator.data.info.serial_number)
        plans = []
        for plan_id, plan in runtime.cleaning_plans.plans(serial_number).items():
            raw_rooms = plan.get("rooms", [])
            rooms = [
                {
                    "room_id": str(room.get("room_id", "")),
                    "cleaning_mode": str(
                        room.get("cleaning_mode", CleaningMode.VACUUM.value)
                    ),
                    "coverage_setting": str(
                        room.get("coverage_setting", CoverageSetting.OPTIMAL.value)
                    ),
                }
                for room in raw_rooms
                if isinstance(room, dict) and room.get("room_id")
            ]
            plans.append(
                {
                    "id": plan_id,
                    "name": str(plan.get("name", plan_id)),
                    "enabled": bool(plan.get("enabled", True)),
                    "run_behavior": str(plan.get("run_behavior", "intelligent")),
                    "rooms": rooms,
                    "room_order": [
                        str(room_id) for room_id in plan.get("room_order", [])
                    ],
                    "return_to_base": bool(plan.get("return_to_base", True)),
                    "finish_current_room": bool(plan.get("finish_current_room", False)),
                    "finish_current_room_threshold": int(
                        plan.get("finish_current_room_threshold", 50)
                    ),
                }
            )
        selected_plan = runtime.cleaning_plans.snapshot(serial_number).get(
            "selected_plan"
        )
        return self.json(
            {
                "rooms": [
                    {"room_id": room.id, "name": room.name} for room in floor_plan.rooms
                ],
                "plans": plans[:256],
                "selected_plan": selected_plan,
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


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
    runtime: MaticRuntimeData,
    revision: int,
    identity: SlamMapIdentity | None,
    floor_plan: FloorPlan | None,
) -> bool:
    """Return whether an encoded snapshot still matches live map identity."""
    return (
        runtime.slam_map.revision == revision
        and runtime.slam_map.mission_identity == identity
        and runtime.coordinator.data.floor_plan == floor_plan
    )


def _scene_snapshot_key(runtime: MaticRuntimeData) -> tuple[object, ...]:
    """Return the complete private identity of the currently renderable scene."""
    return (
        runtime.slam_map.revision,
        runtime.slam_map.mission_identity,
        runtime.coordinator.data.floor_plan,
    )


def _header_bool(value: bool) -> str:
    return "1" if value else "0"


def _mission_history(
    runtime: MaticRuntimeData,
) -> tuple[SlamHistorySnapshot, ...]:
    """Return retained scenes proven to belong to the active SLAM mission."""
    identity = runtime.slam_map.mission_identity
    if identity is None:
        return ()
    return runtime.slam_history.catalog_for_mission(identity.mission_token)


def _history_metadata(
    entry_id: str, snapshots: tuple[SlamHistorySnapshot, ...]
) -> list[dict[str, object]]:
    """Return bounded, content-free history metadata for the admin UI."""
    return [
        {
            "id": snapshot.snapshot_id,
            "created_at": snapshot.created_at.isoformat(),
            "revision": snapshot.revision,
            "point_count": snapshot.point_count,
            "scene_url": history_scene_api_url(entry_id, snapshot.snapshot_id),
        }
        for snapshot in snapshots
    ]
