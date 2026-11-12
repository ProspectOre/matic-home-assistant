"""Content digests of retained map pages and one shared decode per revision."""

from __future__ import annotations

import asyncio
import hashlib
import weakref
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant

from .client.models import HermesCollectionEntry
from .client.slam_tiles import (
    SlamStructureTile,
    SlamTile,
    decode_slam_structure_tile,
    decode_slam_tile,
)

if TYPE_CHECKING:
    from .slam_map_store import SlamMapIdentity


def page_digest(tile: SlamTile | SlamStructureTile) -> bytes:
    """Identify decoded map content while ignoring opaque wire metadata."""
    digest = hashlib.sha256()
    if isinstance(tile, SlamTile):
        digest.update(b"photo\0")
        digest.update(tile.floor_rgba)
        digest.update(tile.surface_bits)
        digest.update(tile.rgb_data)
    else:
        digest.update(b"structure\0")
        digest.update(tile.occupancy)
        digest.update(tile.semantics)
    return digest.digest()


def decode_photo_page(entry: HermesCollectionEntry) -> tuple[SlamTile, bytes]:
    """Validate one photographic page and digest its content, off the loop."""
    tile = decode_slam_tile(entry)
    return tile, page_digest(tile)


def decode_structure_page(
    entry: HermesCollectionEntry,
) -> tuple[SlamStructureTile, bytes]:
    """Validate one integrated-map page and digest its content, off the loop."""
    tile = decode_slam_structure_tile(entry)
    return tile, page_digest(tile)


class PageDigests:
    """Content digests of one map's pages, by layer and tile key.

    Keyed by tile key rather than by page, so a replaced or evicted page is
    freed with its layer entry. Each page write also writes its digest, and a
    digest is read only while its key holds a page, so a stale one is never read.
    """

    __slots__ = ("_layers",)

    def __init__(self) -> None:
        self._layers: tuple[dict[str, bytes], dict[str, bytes]] = ({}, {})

    def layer(self, structural: bool) -> dict[str, bytes]:
        """Return the digests of the photographic or structural layer."""
        return self._layers[structural]


@dataclass(frozen=True, slots=True, weakref_slot=True)
class DecodedMap:
    """Every active page of one map revision, decoded once for all readers."""

    revision: int
    identity: SlamMapIdentity | None
    tiles: tuple[SlamTile, ...]
    structure_tiles: tuple[SlamStructureTile, ...]


def decode_map(
    revision: int,
    identity: SlamMapIdentity | None,
    entries: tuple[HermesCollectionEntry, ...],
    structure_entries: tuple[HermesCollectionEntry, ...],
) -> DecodedMap:
    """Decode a point-in-time copy of the active map, off the event loop."""
    return DecodedMap(
        revision,
        identity,
        tuple(map(decode_slam_tile, entries)),
        tuple(map(decode_slam_structure_tile, structure_entries)),
    )


class SharedDecode:
    """One executor decode per map revision, kept only while readers hold it.

    Readers of one revision share a single executor job. Once it finishes,
    only a weak reference remains, so a settled map holds no decoded copy.
    """

    def __init__(self) -> None:
        self._job: tuple[int, asyncio.Future[DecodedMap]] | None = None
        self._finished: weakref.ref[DecodedMap] | None = None

    async def async_get(
        self,
        hass: HomeAssistant,
        revision: int,
        identity: SlamMapIdentity | None,
        entries: Iterable[HermesCollectionEntry],
        structure_entries: Iterable[HermesCollectionEntry],
    ) -> DecodedMap:
        """Return the decode of ``revision``, starting one only if needed."""
        finished = None if self._finished is None else self._finished()
        if finished is not None and finished.revision == revision:
            return finished
        if self._job is None or self._job[0] != revision:
            job = hass.async_add_executor_job(
                decode_map, revision, identity, tuple(entries), tuple(structure_entries)
            )
            self._job = revision, job
            job.add_done_callback(self._done)
        # A cancelled reader must not cancel the decode other readers share.
        return await asyncio.shield(self._job[1])

    def _done(self, job: asyncio.Future[DecodedMap]) -> None:
        if self._job is not None and self._job[1] is job:
            self._job = None
            if not job.cancelled() and job.exception() is None:
                self._finished = weakref.ref(job.result())
