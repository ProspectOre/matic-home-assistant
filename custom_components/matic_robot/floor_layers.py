"""Serve carpet and vent outlines to Matic Map.

The robot classifies its map as it cleans, so a read is kept for a few minutes
per floor instead of being repeated for every map refresh.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from http import HTTPStatus
from time import monotonic

from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.exceptions import MaticError
from .client.floor_types import FloorTypeLayer, floor_type_layer, mission_token
from .client.models import HermesCollectionEntry
from .client.slam_map import (
    MAX_SLAM_TILES,
    SlamSemanticTile,
    decode_slam_semantic_tile,
)
from .slam_scene import PRIVATE_NO_STORE_HEADERS, _runtime_for_entry

FLOOR_LAYERS_API_URL = "/api/matic_robot/floor_layers/{entry_id}"
FLOOR_LAYERS_CACHE_SECONDS = 600.0
FLOOR_LAYERS_READ_SECONDS = 45.0


@dataclass(frozen=True, slots=True)
class _CachedLayers:
    mission_id: int
    fetched_at: float
    layer: FloorTypeLayer


class MaticFloorLayersView(HomeAssistantView):
    """Return the current floor's carpet and vent outlines in map metres."""

    url = FLOOR_LAYERS_API_URL
    name = "api:matic_robot:floor_layers"

    def __init__(self) -> None:
        self._cache: dict[str, _CachedLayers] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget map material retained for one robot."""
        self._cache.pop(entry_id, None)
        self._locks.pop(entry_id, None)

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return outlines for the floor the map shows, or 404 without one."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        identity = runtime.slam_map.mission_identity if runtime else None
        if runtime is None or identity is None or identity.mission_id is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        mission_id = identity.mission_id
        async with self._locks.setdefault(entry_id, asyncio.Lock()):
            cached = self._cache.get(entry_id)
            if (
                cached is None
                or cached.mission_id != mission_id
                or monotonic() - cached.fetched_at >= FLOOR_LAYERS_CACHE_SECONDS
            ):
                try:
                    read = runtime.client.async_get_tracked_collection_entries
                    async with asyncio.timeout(FLOOR_LAYERS_READ_SECONDS):
                        pages = await read("map_semantics", limit=MAX_SLAM_TILES)
                        overrides = await read(
                            "map_semantics_override", limit=MAX_SLAM_TILES
                        )
                    layer = await hass.async_add_executor_job(
                        _build_layer, pages, overrides, mission_id
                    )
                except MaticError, TimeoutError, DecodeError:
                    return web.Response(
                        status=HTTPStatus.SERVICE_UNAVAILABLE,
                        headers=PRIVATE_NO_STORE_HEADERS,
                    )
                cached = _CachedLayers(mission_id, monotonic(), layer)
                self._cache[entry_id] = cached
        return self.json(
            {
                "entry_id": entry_id,
                "page_count": cached.layer.page_count,
                "truncated": cached.layer.truncated,
                "layers": {
                    name: [[list(point) for point in outline] for outline in outlines]
                    for name, outlines in cached.layer.layers.items()
                },
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


def _build_layer(
    pages: tuple[HermesCollectionEntry, ...],
    overrides: tuple[HermesCollectionEntry, ...],
    mission_id: int,
) -> FloorTypeLayer:
    return floor_type_layer(
        _decoded(pages), _decoded(overrides), mission=mission_token(mission_id)
    )


def _decoded(entries: tuple[HermesCollectionEntry, ...]) -> list[SlamSemanticTile]:
    """Decode the pages that parse; one damaged page must not hide the rest."""
    pages: list[SlamSemanticTile] = []
    for entry in entries:
        try:
            pages.append(decode_slam_semantic_tile(entry))
        except DecodeError:
            continue
    return pages
