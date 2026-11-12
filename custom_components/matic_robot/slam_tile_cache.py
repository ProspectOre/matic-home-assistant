"""Decoded SLAM pages shared by every reader of one map store."""

from __future__ import annotations

from collections.abc import Iterable

from .client.models import HermesCollectionEntry
from .client.slam_tiles import SlamStructureTile, SlamTile

# Stale pages may outnumber retained ones by this fraction before a prune, so
# pruning stays amortized constant time per added page.
_STALE_FRACTION = 4
_STALE_SLACK = 64


class DecodedTiles[T: (SlamTile, SlamStructureTile)]:
    """Decoded pages keyed by their raw entry, decoded once off the event loop.

    The map store adds each page it admits. The scene, history and camera read
    these tiles instead of decoding the map again.
    """

    def __init__(self, tiles: dict[HermesCollectionEntry, T] | None = None) -> None:
        self._tiles: dict[HermesCollectionEntry, T] = {} if tiles is None else tiles

    def __getitem__(self, entry: HermesCollectionEntry) -> T:
        return self._tiles[entry]

    def add(self, entry: HermesCollectionEntry, tile: T, retained: int) -> bool:
        """Remember one admitted page and say whether to prune stale pages.

        ``retained`` counts the pages of this layer the store still holds.
        """
        self._tiles[entry] = tile
        return len(self._tiles) > retained + retained // _STALE_FRACTION + _STALE_SLACK

    def tiles(self, entries: Iterable[HermesCollectionEntry]) -> tuple[T, ...]:
        """Return the decoded tiles of retained entries, in their order."""
        return tuple(self._tiles[entry] for entry in entries)

    def retain(self, entries: Iterable[HermesCollectionEntry]) -> None:
        """Forget every page that is not one of ``entries``."""
        self._tiles = {entry: self._tiles[entry] for entry in entries}
