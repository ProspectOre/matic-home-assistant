"""Private Home Assistant storage for local photorealistic SLAM tiles."""

from __future__ import annotations

import base64
from typing import Any

from google.protobuf.message import DecodeError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .client.models import HermesCollectionEntry
from .client.slam_map import SlamTile, decode_slam_tile
from .const import DOMAIN

STORAGE_VERSION = 1
MAX_TILES = 1024
MAX_STORED_BYTES = 16 * 1024 * 1024


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
        self._revision = 0

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
                tile = decode_slam_tile(entry)
            except DecodeError, KeyError, TypeError, ValueError:
                continue
            if self._mission_token not in (None, tile.mission_token):
                entries.clear()
                total = 0
            total += len(entry.key) + len(entry.value)
            if total > MAX_STORED_BYTES or len(entries) >= MAX_TILES:
                break
            self._mission_token = tile.mission_token
            entries[_tile_key(tile)] = entry
        self._entries = entries
        self._revision = len(entries)

    async def async_add(self, entry: HermesCollectionEntry) -> SlamTile:
        """Validate, cache, and privately persist one current tile."""
        tile = decode_slam_tile(entry)
        if self._mission_token not in (None, tile.mission_token):
            self._entries.clear()
        self._mission_token = tile.mission_token
        key = _tile_key(tile)
        changed = self._entries.get(key) != entry
        self._entries[key] = entry
        if not changed:
            return tile
        while len(self._entries) > MAX_TILES or self._stored_bytes() > MAX_STORED_BYTES:
            self._entries.pop(next(iter(self._entries)))
        await self._store.async_save(
            {
                "tiles": [
                    {
                        "key": base64.b64encode(item.key).decode("ascii"),
                        "value": base64.b64encode(item.value).decode("ascii"),
                    }
                    for item in self._entries.values()
                ]
            }
        )
        if changed:
            self._revision += 1
        return tile

    def decoded_tiles(self) -> tuple[SlamTile, ...]:
        """Return all currently valid tiles for local rendering."""
        tiles: list[SlamTile] = []
        for entry in self._entries.values():
            try:
                tiles.append(decode_slam_tile(entry))
            except DecodeError:
                continue
        return tuple(tiles)

    @property
    def tile_count(self) -> int:
        """Return the number of cached pages without exposing their content."""
        return len(self._entries)

    @property
    def revision(self) -> int:
        """Return a content revision suitable for render cache invalidation."""
        return self._revision

    async def async_remove(self) -> None:
        """Erase the private map cache when the robot entry is removed."""
        self._entries.clear()
        self._mission_token = None
        self._revision += 1
        await self._store.async_remove()

    def _stored_bytes(self) -> int:
        return sum(len(item.key) + len(item.value) for item in self._entries.values())


def _tile_key(tile: SlamTile) -> str:
    return f"{tile.page_x}:{tile.page_y}"
