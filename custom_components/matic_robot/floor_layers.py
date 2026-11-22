"""Serve carpet and vent outlines to Matic Map.

The robot classifies its map as it cleans, so a read is kept for a few minutes
per map frame instead of being repeated for every map refresh. A fresh read is
not guaranteed to replay every retained page, so pages from earlier reads of
the same frame are kept and newer copies replace them. The frame is the map
session Matic Map draws in: a re-mapped floor partition starts over.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from http import HTTPStatus
from time import monotonic
from typing import TYPE_CHECKING

from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.components.http.decorators import require_admin
from homeassistant.core import HomeAssistant
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client import (
    MAX_SLAM_TILES,
    HermesCollectionEntry,
    MaticError,
    SlamSemanticTile,
    decode_slam_semantic_tile,
    mission_token,
)
from .floor_types import (
    FloorTypeLayer,
    floor_type_layer,
)
from .http import (
    FLOOR_LAYERS_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    runtime_for_entry,
)
from .map_schema import FloorLayers
from .slam_view_data import map_session_key

if TYPE_CHECKING:
    from . import MaticRuntimeData

FLOOR_LAYERS_CACHE_SECONDS = 600.0
# A read that found no page for this floor is retried sooner.
FLOOR_LAYERS_EMPTY_RETRY_SECONDS = 30.0
FLOOR_LAYERS_READ_SECONDS = 45.0


type _Pages = dict[tuple[int, int], SlamSemanticTile]


@dataclass(frozen=True, slots=True)
class _CachedLayers:
    map_key: str
    expires_at: float
    layer: FloorTypeLayer
    pages: _Pages
    overrides: _Pages


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
        runtime = runtime_for_entry(hass, entry_id)
        identity = runtime.slam_map.mission_identity if runtime else None
        mission_id = identity.mission_id if identity else None
        # The frame Matic Map draws in: the mission and its floor partition.
        map_key = map_session_key(runtime) if runtime else None
        if runtime is None or mission_id is None or map_key is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        async with self._locks.setdefault(entry_id, asyncio.Lock()):
            if not _still_current(hass, entry_id, runtime, map_key):
                return _conflict()
            cached = self._cache.get(entry_id)
            if cached is not None and cached.map_key != map_key:
                cached = None
            if cached is None or monotonic() >= cached.expires_at:
                try:
                    read = runtime.client.async_get_tracked_collection_entries
                    async with asyncio.timeout(FLOOR_LAYERS_READ_SECONDS):
                        pages = await read("map_semantics", limit=MAX_SLAM_TILES)
                        overrides = await read(
                            "map_semantics_override", limit=MAX_SLAM_TILES
                        )
                    merged = await hass.async_add_executor_job(
                        _merge, cached, pages, overrides, mission_id, map_key
                    )
                except MaticError, TimeoutError, DecodeError:
                    return web.Response(
                        status=HTTPStatus.SERVICE_UNAVAILABLE,
                        headers=PRIVATE_NO_STORE_HEADERS,
                    )
                # The robot can change floors during the reads; a layer built
                # for the old floor must not be served or cached for the new.
                if not _still_current(hass, entry_id, runtime, map_key):
                    return _conflict()
                cached = merged
                self._cache[entry_id] = cached
        outlines = {
            name: [[list(point) for point in outline] for outline in layer]
            for name, layer in cached.layer.layers.items()
        }
        layers: FloorLayers = {
            "entry_id": entry_id,
            "page_count": cached.layer.page_count,
            "truncated": cached.layer.truncated,
            "layers": {"carpet": outlines["carpet"], "vent": outlines["vent"]},
        }
        return self.json(layers, headers=PRIVATE_NO_STORE_HEADERS)


def _still_current(
    hass: HomeAssistant,
    entry_id: str,
    runtime: MaticRuntimeData,
    map_key: str,
) -> bool:
    """Return whether the entry still shows the map frame this request started on."""
    return (
        runtime_for_entry(hass, entry_id) is runtime
        and map_session_key(runtime) == map_key
    )


def _conflict() -> web.Response:
    return web.Response(status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS)


def _merge(
    previous: _CachedLayers | None,
    pages: tuple[HermesCollectionEntry, ...],
    overrides: tuple[HermesCollectionEntry, ...],
    mission_id: int,
    map_key: str,
) -> _CachedLayers:
    """Add this read's pages to the frame's earlier ones and outline the result."""
    mission = mission_token(mission_id)
    merged_pages = _pages(previous.pages if previous else {}, pages, mission)
    merged_overrides = _pages(
        previous.overrides if previous else {}, overrides, mission
    )
    layer = floor_type_layer(
        merged_pages.values(), merged_overrides.values(), mission=mission
    )
    ttl = (
        FLOOR_LAYERS_CACHE_SECONDS if merged_pages else FLOOR_LAYERS_EMPTY_RETRY_SECONDS
    )
    return _CachedLayers(
        map_key, monotonic() + ttl, layer, merged_pages, merged_overrides
    )


def _pages(
    known: _Pages, entries: tuple[HermesCollectionEntry, ...], mission: str
) -> _Pages:
    """Return the floor's known pages updated with this read's copies."""
    merged = dict(known)
    for page in _decoded(entries):
        if page.mission_token == mission:
            merged[(page.page_x, page.page_y)] = page
    if len(merged) > MAX_SLAM_TILES:
        raise DecodeError("too many semantic pages")
    return merged


def _decoded(entries: tuple[HermesCollectionEntry, ...]) -> list[SlamSemanticTile]:
    """Decode the pages that parse; one damaged page must not hide the rest."""
    pages: list[SlamSemanticTile] = []
    for entry in entries:
        try:
            pages.append(decode_slam_semantic_tile(entry))
        except DecodeError:
            continue
    return pages
