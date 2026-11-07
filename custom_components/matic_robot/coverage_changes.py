"""Hold observed vacuum and mop changes within one versioned map subscription."""

from dataclasses import dataclass

from google.protobuf.message import DecodeError

from .client.models import HermesCollectionEntry
from .client.slam_tiles import (
    MAX_SLAM_TILES,
    SEMANTIC_BYTES,
    SlamSemanticTile,
    decode_semantic_page_key,
    decode_slam_mission_id,
    decode_slam_semantic_tile,
)

# Map both coverage counters to independent presence flags in their original nibbles.
_MODES = bytes(bool(v & 15) + 16 * bool(v & 240) for v in range(256))


@dataclass(slots=True)
class _PageObservation:
    sequence: int
    modes: int | None
    visible: SlamSemanticTile | None


class CoverageChanges:
    """Compare consecutive versions of each page on one uninterrupted stream."""

    def __init__(self, mission: int, epoch: int, start: int) -> None:
        self.mission = mission
        self.epoch = epoch
        self.start = start
        self.pages: dict[tuple[int, int], _PageObservation] = {}
        self.withdrawals = 0

    def visible_pages(self) -> tuple[SlamSemanticTile, ...]:
        return tuple(
            page.visible for page in self.pages.values() if page.visible is not None
        )

    def update(self, entry: HermesCollectionEntry) -> bool:
        """Apply one page version and report whether the displayed layer changed."""
        if entry.sequence_start_ns != self.epoch or entry.sequence_no is None:
            raise ValueError("Coverage stream sequence changed or is unavailable")
        seq = entry.sequence_no
        if seq <= self.start:
            return False
        x, y, mission = decode_semantic_page_key(entry.key)
        if decode_slam_mission_id(mission) != self.mission:
            return False
        key = (x, y)
        prev = self.pages.get(key)
        if prev is not None and seq <= prev.sequence:
            return False
        if prev is None and len(self.pages) >= MAX_SLAM_TILES:
            raise ValueError("Coverage observation exceeded its page limit")
        tile = None
        if not entry.deleted:
            try:
                tile = decode_slam_semantic_tile(entry)
            except DecodeError:
                # The next valid sample must establish a new baseline for this key.
                pass
        modes = (
            None
            if tile is None
            else int.from_bytes(tile.cells.translate(_MODES), "little")
        )
        visible = None
        if (
            tile is not None
            and modes is not None
            and prev is not None
            and prev.modes is not None
        ):
            confirmed = (
                int.from_bytes(prev.visible.cells, "little") if prev.visible else 0
            )
            # Keep observed marks that still exist and add only rising mode bits.
            # Counter increments within the same mode do not imply new coverage.
            added = modes & ~prev.modes
            observed = (modes & confirmed) | added
            if observed:
                visible = SlamSemanticTile(
                    x,
                    y,
                    tile.mission_token,
                    observed.to_bytes(SEMANTIC_BYTES, "little"),
                )
        previous_visible = prev.visible if prev else None
        if previous_visible is not None and int.from_bytes(
            previous_visible.cells, "little"
        ) & ~(int.from_bytes(visible.cells, "little") if visible else 0):
            self.withdrawals += 1
        self.pages[key] = _PageObservation(seq, modes, visible)
        return previous_visible != visible
