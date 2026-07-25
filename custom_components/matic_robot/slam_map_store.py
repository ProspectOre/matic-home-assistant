"""Private Home Assistant storage for local photorealistic SLAM tiles."""

from __future__ import annotations

import asyncio
import base64
from time import monotonic
from typing import Any

from google.protobuf.message import DecodeError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .client.api import MaticHermesClient
from .client.exceptions import MaticError
from .client.models import HermesCollectionEntry
from .client.slam_map import (
    SlamStructureTile,
    SlamTile,
    decode_slam_structure_tile,
    decode_slam_tile,
)
from .const import DOMAIN

STORAGE_VERSION = 1
MAX_TILES = 1024
MAX_STORED_BYTES = 16 * 1024 * 1024
STREAM_RETRY_SECONDS = 5
SAVE_DELAY_SECONDS = 1
MAP_SETTLE_SECONDS = 3
MIN_COMPLETE_TILES = 32


class SlamMapStore:
    """Accumulate current robot SLAM tiles without exposing them to Recorder."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            f"{DOMAIN}.slam_map.{entry_id}",
            private=True,
        )
        self._mission_token: str | None = None
        self._entries: dict[str, HermesCollectionEntry] = {}
        self._structure_entries: dict[str, HermesCollectionEntry] = {}
        self._revision = 0
        self._last_change = 0.0
        self._map_complete = False

    async def async_load(self) -> None:
        """Load and validate the robot-local tile cache."""
        stored = await self._store.async_load() or {}
        entries: dict[str, HermesCollectionEntry] = {}
        total = 0
        for item in stored.get("tiles", ()):
            try:
                entry = HermesCollectionEntry(
                    base64.b64decode(item["key"], validate=True),
                    base64.b64decode(item["value"], validate=True),
                )
                photo_tile = decode_slam_tile(entry)
            except DecodeError, KeyError, TypeError, ValueError:
                continue
            if self._mission_token not in (None, photo_tile.mission_token):
                entries.clear()
                total = 0
            total += len(entry.key) + len(entry.value)
            if total > MAX_STORED_BYTES or len(entries) >= MAX_TILES:
                break
            self._mission_token = photo_tile.mission_token
            entries[_tile_key(photo_tile)] = entry
        self._entries = entries
        structure_entries: dict[str, HermesCollectionEntry] = {}
        for item in stored.get("structure_tiles", ()):
            try:
                entry = HermesCollectionEntry(
                    base64.b64decode(item["key"], validate=True),
                    base64.b64decode(item["value"], validate=True),
                )
                structure_tile = decode_slam_structure_tile(entry)
            except DecodeError, KeyError, TypeError, ValueError:
                continue
            if self._mission_token not in (None, structure_tile.mission_token):
                entries.clear()
                structure_entries.clear()
                total = 0
            total += len(entry.key) + len(entry.value)
            if total > MAX_STORED_BYTES or len(structure_entries) >= MAX_TILES:
                break
            self._mission_token = structure_tile.mission_token
            structure_entries[_tile_key(structure_tile)] = entry
        self._structure_entries = structure_entries
        self._revision = len(entries) + len(structure_entries)
        self._last_change = 0.0
        self._map_complete = self._has_balanced_layers()

    async def async_add(self, entry: HermesCollectionEntry) -> SlamTile:
        """Validate, cache, and privately persist one current tile."""
        tile = decode_slam_tile(entry)
        if self._mission_token not in (None, tile.mission_token):
            self._entries.clear()
            self._structure_entries.clear()
            self._map_complete = False
        self._mission_token = tile.mission_token
        key = _tile_key(tile)
        changed = self._entries.get(key) != entry
        self._entries[key] = entry
        if not changed:
            return tile
        self._enforce_bounds()
        self._store.async_delay_save(self._serialized_data, SAVE_DELAY_SECONDS)
        if changed:
            self._revision += 1
            self._last_change = monotonic()
        return tile

    async def async_add_structure(
        self, entry: HermesCollectionEntry
    ) -> SlamStructureTile:
        """Validate, cache, and privately persist one structural map page."""
        tile = decode_slam_structure_tile(entry)
        if self._mission_token not in (None, tile.mission_token):
            self._entries.clear()
            self._structure_entries.clear()
            self._map_complete = False
        self._mission_token = tile.mission_token
        key = _tile_key(tile)
        changed = self._structure_entries.get(key) != entry
        self._structure_entries[key] = entry
        if not changed:
            return tile
        self._enforce_bounds()
        self._store.async_delay_save(self._serialized_data, SAVE_DELAY_SECONDS)
        self._revision += 1
        self._last_change = monotonic()
        return tile

    async def async_collect(self, client: MaticHermesClient) -> None:
        """Continuously collect photographic and structural map pages."""
        await asyncio.gather(
            self._async_collect_collection(client, "map_compressed_rgb", False),
            self._async_collect_collection(client, "map_integrated", True),
        )

    async def _async_collect_collection(
        self, client: MaticHermesClient, name: str, structural: bool
    ) -> None:
        while True:
            try:
                async for entry in client.async_subscribe_collection_entries(name):
                    try:
                        if structural:
                            await self.async_add_structure(entry)
                        else:
                            await self.async_add(entry)
                    except DecodeError:
                        continue
            except asyncio.CancelledError:
                raise
            except MaticError:
                await asyncio.sleep(STREAM_RETRY_SECONDS)
            else:
                await asyncio.sleep(STREAM_RETRY_SECONDS)

    def decoded_tiles(self) -> tuple[SlamTile, ...]:
        """Return all currently valid tiles for local rendering."""
        tiles: list[SlamTile] = []
        for entry in self._entries.values():
            try:
                tiles.append(decode_slam_tile(entry))
            except DecodeError:
                continue
        return tuple(tiles)

    def decoded_structure_tiles(self) -> tuple[SlamStructureTile, ...]:
        """Return all currently valid integrated-map pages for rendering."""
        tiles: list[SlamStructureTile] = []
        for entry in self._structure_entries.values():
            try:
                tiles.append(decode_slam_structure_tile(entry))
            except DecodeError:
                continue
        return tuple(tiles)

    def entries(self) -> tuple[HermesCollectionEntry, ...]:
        """Return raw photographic entries for off-event-loop decoding."""
        return tuple(self._entries.values())

    def structure_entries(self) -> tuple[HermesCollectionEntry, ...]:
        """Return raw structural entries for off-event-loop decoding."""
        return tuple(self._structure_entries.values())

    @property
    def tile_count(self) -> int:
        """Return the number of cached pages without exposing their content."""
        return len(self._entries)

    @property
    def revision(self) -> int:
        """Return a content revision suitable for render cache invalidation."""
        return self._revision

    @property
    def structure_tile_count(self) -> int:
        """Return the number of cached structural pages."""
        return len(self._structure_entries)

    @property
    def map_complete(self) -> bool:
        """Return whether both map layers completed for the current mission."""
        if self._map_complete:
            return True
        if not self._has_balanced_layers():
            return False
        self._map_complete = monotonic() - self._last_change >= MAP_SETTLE_SECONDS
        return self._map_complete

    def _has_balanced_layers(self) -> bool:
        """Return whether enough pages from both full-map layers are present."""
        photo_count = len(self._entries)
        structure_count = len(self._structure_entries)
        if min(photo_count, structure_count) < MIN_COMPLETE_TILES:
            return False
        coverage = min(photo_count, structure_count) / max(photo_count, structure_count)
        return coverage >= 0.95

    async def async_remove(self) -> None:
        """Erase the private map cache when the robot entry is removed."""
        self._entries.clear()
        self._structure_entries.clear()
        self._mission_token = None
        self._revision += 1
        self._last_change = monotonic()
        self._map_complete = False
        await self._store.async_remove()

    def _stored_bytes(self) -> int:
        return sum(
            len(item.key) + len(item.value)
            for collection in (self._entries, self._structure_entries)
            for item in collection.values()
        )

    def _enforce_bounds(self) -> None:
        while len(self._entries) > MAX_TILES:
            self._entries.pop(next(iter(self._entries)))
        while len(self._structure_entries) > MAX_TILES:
            self._structure_entries.pop(next(iter(self._structure_entries)))
        while self._stored_bytes() > MAX_STORED_BYTES:
            target = self._entries if self._entries else self._structure_entries
            target.pop(next(iter(target)))

    def _serialized_data(self) -> dict[str, list[dict[str, str]]]:
        """Build the private payload only when the debounced write runs."""
        return {
            "tiles": [
                {
                    "key": base64.b64encode(item.key).decode("ascii"),
                    "value": base64.b64encode(item.value).decode("ascii"),
                }
                for item in self._entries.values()
            ],
            "structure_tiles": [
                {
                    "key": base64.b64encode(item.key).decode("ascii"),
                    "value": base64.b64encode(item.value).decode("ascii"),
                }
                for item in self._structure_entries.values()
            ],
        }


def _tile_key(tile: SlamTile | SlamStructureTile) -> str:
    return f"{tile.page_x}:{tile.page_y}"
