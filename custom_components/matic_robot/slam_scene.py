"""Authenticated local HTTP views for the private 3D SLAM studio."""

from __future__ import annotations

import asyncio
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

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticConfigEntry, MaticRuntimeData

SCENE_API_URL = "/api/matic_robot/slam_scene/{entry_id}"
POSE_API_URL = "/api/matic_robot/slam_pose/{entry_id}"
CATALOG_API_URL = "/api/matic_robot/slam_entries"
POSE_CACHE_SECONDS = 1.0
SCENE_ENCODE_ATTEMPTS = 2

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
        self._locks: dict[str, asyncio.Lock] = {}
        self._epochs: dict[str, int] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget all in-memory scene material retained for one robot."""
        self._cache.pop(entry_id, None)
        self._locks.pop(entry_id, None)
        self._epochs[entry_id] = self._epochs.get(entry_id, 0) + 1

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the current local scene, using an ETag for live refreshes."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        data = runtime.coordinator.data
        epoch = self._epochs.get(entry_id, 0)
        key = (runtime.slam_map.revision, id(data.floor_plan))
        cached = self._cache.get(entry_id)
        if cached is None or cached.key != key:
            queued_after = cached
            lock = self._locks.setdefault(entry_id, asyncio.Lock())
            async with lock:
                if (
                    self._epochs.get(entry_id, 0) != epoch
                    or _runtime_for_entry(hass, entry_id) is not runtime
                ):
                    return web.Response(
                        status=HTTPStatus.NOT_FOUND,
                        headers=PRIVATE_NO_STORE_HEADERS,
                    )
                cached = self._cache.get(entry_id)
                if cached is None or cached is queued_after:
                    for _attempt in range(SCENE_ENCODE_ATTEMPTS):
                        data = runtime.coordinator.data
                        revision = runtime.slam_map.revision
                        floor_plan = data.floor_plan
                        key = (revision, id(floor_plan))
                        cached = self._cache.get(entry_id)
                        if cached is not None and cached.key == key:
                            break
                        entries = runtime.slam_map.entries()
                        try:
                            encoded = await hass.async_add_executor_job(
                                partial(_encode_scene_entries, entries, floor_plan)
                            )
                        except DecodeError:
                            if not _scene_snapshot_is_current(
                                runtime, revision, floor_plan
                            ):
                                continue
                            return web.Response(
                                status=HTTPStatus.CONFLICT,
                                headers=PRIVATE_NO_STORE_HEADERS,
                            )
                        if self._epochs.get(entry_id, 0) != epoch:
                            return web.Response(
                                status=HTTPStatus.NOT_FOUND,
                                headers=PRIVATE_NO_STORE_HEADERS,
                            )
                        # The immutable entries and floor plan captured above are
                        # coherent even if collection advances while encoding.
                        cached = _CachedScene(key, encoded.payload, encoded.etag)
                        self._cache[entry_id] = cached
                        break
                    else:
                        return web.Response(
                            status=HTTPStatus.CONFLICT,
                            headers=PRIVATE_NO_STORE_HEADERS,
                        )
        if request.headers.get("If-None-Match") == cached.etag:
            return web.Response(
                status=HTTPStatus.NOT_MODIFIED,
                headers={**PRIVATE_NO_STORE_HEADERS, "ETag": cached.etag},
            )
        return web.Response(
            body=cached.payload,
            content_type="application/vnd.matic.slam-scene",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": cached.etag,
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
                    "pose_url": pose_api_url(entry.entry_id),
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
        and runtime.coordinator.data.floor_plan is floor_plan
    )
