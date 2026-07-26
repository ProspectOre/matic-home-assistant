"""Authenticated local HTTP views for the private 3D SLAM studio."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import partial
from hashlib import sha256
from http import HTTPStatus
from typing import TYPE_CHECKING, cast

from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.components.http.decorators import require_admin
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.floor_plan import resolve_robot_map_position
from .client.models import FloorPlan, HermesCollectionEntry
from .client.slam_map import decode_slam_tile, encode_slam_scene
from .const import DOMAIN

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticConfigEntry, MaticRuntimeData

SCENE_API_URL = "/api/matic_robot/slam_scene/{entry_id}"
POSE_API_URL = "/api/matic_robot/slam_pose/{entry_id}"


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


class MaticSlamSceneView(HomeAssistantView):
    """Serve a bounded binary point cloud to an authenticated administrator."""

    url = SCENE_API_URL
    name = "api:matic_robot:slam_scene"

    def __init__(self) -> None:
        self._cache: dict[str, _CachedScene] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the current local scene, using an ETag for live refreshes."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)
        data = runtime.coordinator.data
        key = (runtime.slam_map.revision, data.floor_plan)
        cached = self._cache.get(entry_id)
        if cached is None or cached.key != key:
            lock = self._locks.setdefault(entry_id, asyncio.Lock())
            async with lock:
                cached = self._cache.get(entry_id)
                if cached is None or cached.key != key:
                    entries = runtime.slam_map.entries()
                    try:
                        payload = await hass.async_add_executor_job(
                            partial(_encode_scene_entries, entries, data.floor_plan)
                        )
                    except DecodeError:
                        return web.Response(status=HTTPStatus.CONFLICT)
                    etag = f'"{sha256(payload).hexdigest()[:24]}"'
                    cached = _CachedScene(key, payload, etag)
                    self._cache[entry_id] = cached
        if request.headers.get("If-None-Match") == cached.etag:
            return web.Response(
                status=HTTPStatus.NOT_MODIFIED, headers={"ETag": cached.etag}
            )
        return web.Response(
            body=cached.payload,
            content_type="application/vnd.matic.slam-scene",
            headers={
                "Cache-Control": "private, no-cache",
                "ETag": cached.etag,
                "X-Content-Type-Options": "nosniff",
            },
        )


class MaticSlamPoseView(HomeAssistantView):
    """Serve only the current robot marker for lightweight live updates."""

    url = POSE_API_URL
    name = "api:matic_robot:slam_pose"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the current position without exposing it to Recorder."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)
        data = runtime.coordinator.data
        position = resolve_robot_map_position(
            data.floor_plan, data.pose, data.operational.current_area
        )
        return self.json(
            {
                "position": list(position[:2]) if position is not None else None,
                "source": position[2] if position is not None else "unavailable",
                "revision": runtime.slam_map.revision,
            },
            headers={"Cache-Control": "private, no-store"},
        )


def _encode_scene_entries(
    entries: tuple[HermesCollectionEntry, ...], floor_plan: FloorPlan | None
) -> bytes:
    """Decode a stable store snapshot and encode it off the event loop."""
    return encode_slam_scene(
        tuple(decode_slam_tile(entry) for entry in entries),
        floor_plan=floor_plan,
    )
