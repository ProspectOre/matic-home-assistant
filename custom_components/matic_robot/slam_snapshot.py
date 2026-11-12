"""Pure encoding, validation and bounded collections for persisted SLAM maps.

The store supplies current resource limits and owns live admission and recovery.
Decoding returns data and provenance; it never verifies a live robot session.
"""

from __future__ import annotations

import base64
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import NamedTuple, NotRequired, TypedDict

from google.protobuf.message import DecodeError

from .client.models import HermesCollectionEntry
from .client.slam_tiles import (
    SlamStructureTile,
    SlamTile,
    decode_slam_structure_tile,
    decode_slam_tile,
)
from .slam_decoded_map import PageDigests, page_digest

# Bounds applied before snapshots recorded their provenance.
LEGACY_BOUNDS = (1024, 16 * 1024 * 1024)
SPATIAL_BUCKETS_PER_AXIS = 8

RecoveryBaseline = tuple[frozenset[str], frozenset[str]]


@dataclass(frozen=True, slots=True)
class SnapshotLimits:
    """Resource admission limits supplied by the storage owner."""

    max_tiles: int
    max_bytes: int
    max_load_items_per_layer: int
    max_tile_entry_bytes: int
    max_health_counter: int

    @property
    def bounds(self) -> tuple[int, int]:
        """Return the persisted provenance for these limits."""
        return self.max_tiles, self.max_bytes

    def increment(self, value: int, amount: int = 1) -> int:
        """Saturate a diagnostic counter without accepting negative increments."""
        return min(self.max_health_counter, value + max(0, amount))


class SnapshotMetadata(NamedTuple):
    """Immutable state captured by the owner before encoding a snapshot."""

    mission_token: str | None
    truncated: bool
    dropped_photo_tiles: int
    dropped_structure_tiles: int
    bounds: tuple[int, int]
    baseline: RecoveryBaseline | None


class StoredEntry(TypedDict):
    """One base64-encoded Hermes collection entry."""

    key: str
    value: str


class StoredBounds(TypedDict):
    """Resource limits in effect when the truncation latch was recorded."""

    tiles: int
    bytes: int


class StoredBaseline(TypedDict):
    """Retained coordinates needed to resume legacy truncation recovery."""

    tiles: list[str]
    structure_tiles: list[str]


class StoredSnapshot(TypedDict):
    """Version-one private storage shape."""

    mission_token: str | None
    truncated: bool
    dropped_photo_tiles: int
    dropped_structure_tiles: int
    bounds: StoredBounds
    tiles: list[StoredEntry]
    structure_tiles: list[StoredEntry]
    legacy_retained: NotRequired[StoredBaseline]


@dataclass(frozen=True, slots=True)
class LoadedSnapshot:
    """One fully decoded private storage snapshot built off the event loop."""

    mission_token: str | None
    mission_id: int | None
    entries: dict[str, HermesCollectionEntry]
    structure_entries: dict[str, HermesCollectionEntry]
    truncated: bool
    dropped_photo_tiles: int
    dropped_structure_tiles: int
    invalid_tiles: int
    dirty: bool
    # The (tiles, bytes) bounds the truncation latch was recorded under. A
    # latch from bounds smaller than this build applies may be cleared by a
    # complete live replay; one from the current bounds cannot.
    bounds: tuple[int, int]
    # The retained set recovery was armed with, when a snapshot persisted one.
    baseline: RecoveryBaseline | None = None
    # Content digests of the loaded pages.
    digests: PageDigests = field(default_factory=PageDigests)

    def can_recover_under(self, current_bounds: tuple[int, int]) -> bool:
        """Return whether a complete live replay may clear the latch."""
        return self.truncated and (
            self.bounds[0] < current_bounds[0] or self.bounds[1] < current_bounds[1]
        )


def encode_snapshot(
    photo_entries: tuple[HermesCollectionEntry, ...],
    structure_entries: tuple[HermesCollectionEntry, ...],
    health: SnapshotMetadata,
) -> StoredSnapshot:
    """Encode an immutable private snapshot for Home Assistant storage."""
    mission_token, truncated, dropped_photo, dropped_structure, bounds, baseline = (
        health
    )
    snapshot: StoredSnapshot = {
        "mission_token": mission_token,
        "truncated": truncated,
        "dropped_photo_tiles": dropped_photo,
        "dropped_structure_tiles": dropped_structure,
        # Provenance of any truncation latch. A build with larger bounds may
        # recover the latch from a complete live replay; the same bounds
        # cannot, because the evicted pages would be evicted again.
        "bounds": {"tiles": bounds[0], "bytes": bounds[1]},
        "tiles": [encode_entry(item) for item in photo_entries],
        "structure_tiles": [encode_entry(item) for item in structure_entries],
    }
    if baseline is not None:
        # Content-free page coordinates only; retained while recovery is armed.
        snapshot["legacy_retained"] = {
            "tiles": sorted(baseline[0]),
            "structure_tiles": sorted(baseline[1]),
        }
    return snapshot


def encode_entry(item: HermesCollectionEntry) -> StoredEntry:
    """Encode one validated raw entry without changing its bytes."""
    return {
        "key": base64.b64encode(item.key).decode("ascii"),
        "value": base64.b64encode(item.value).decode("ascii"),
    }


def decode_snapshot(stored: object, limits: SnapshotLimits) -> LoadedSnapshot:
    """Decode and bound one private cache snapshot away from the event loop."""
    if not isinstance(stored, Mapping):
        return LoadedSnapshot(None, None, {}, {}, False, 0, 0, 1, True, limits.bounds)
    stored_mission = _stored_mission_token(stored.get("mission_token"))
    mission_token = stored_mission
    truncated = stored.get("truncated") is True
    dropped_photo = _bounded_count(
        stored.get("dropped_photo_tiles", 0), limits.max_health_counter
    )
    dropped_structure = _bounded_count(
        stored.get("dropped_structure_tiles", 0), limits.max_health_counter
    )
    invalid = 0
    # Snapshots written before provenance was recorded come from the smaller
    # pre-0.5 limits. A malformed record is not evidence of smaller bounds.
    stored_bounds = (
        _stored_bounds(stored["bounds"]) if "bounds" in stored else LEGACY_BOUNDS
    )
    bounds = limits.bounds if stored_bounds is None else stored_bounds
    baseline = (
        _stored_baseline(stored["legacy_retained"], limits.max_tiles)
        if "legacy_retained" in stored
        else None
    )
    dirty = (
        (stored.get("mission_token") is not None and stored_mission is None)
        or ("truncated" in stored and not isinstance(stored["truncated"], bool))
        or stored_bounds is None
        or ("legacy_retained" in stored and baseline is None)
        or dropped_photo != stored.get("dropped_photo_tiles", 0)
        or dropped_structure != stored.get("dropped_structure_tiles", 0)
    )
    entries: dict[str, HermesCollectionEntry] = {}
    structure_entries: dict[str, HermesCollectionEntry] = {}
    digests = PageDigests()
    mission_ids: set[int] = set()

    for structural, name in ((False, "tiles"), (True, "structure_tiles")):
        items = stored.get(name, ())
        if not isinstance(items, Sequence) or isinstance(items, str | bytes):
            invalid = limits.increment(invalid)
            dirty = True
            continue
        item_limit = min(len(items), limits.max_load_items_per_layer)
        if len(items) > item_limit:
            overflow = len(items) - item_limit
            truncated = True
            bounds = limits.bounds
            if structural:
                dropped_structure = limits.increment(dropped_structure, overflow)
            else:
                dropped_photo = limits.increment(dropped_photo, overflow)
            dirty = True
        for index in range(item_limit):
            item = items[index]
            if not isinstance(item, Mapping):
                invalid = limits.increment(invalid)
                dirty = True
                continue
            try:
                encoded_key = item["key"]
                encoded_value = item["value"]
                encoded_limit = ((limits.max_tile_entry_bytes + 2) // 3) * 4
                if any(
                    not isinstance(value, str) or len(value) > encoded_limit
                    for value in (encoded_key, encoded_value)
                ):
                    raise ValueError("stored tile exceeds the encoded byte limit")
                decoded_bytes = sum(
                    ((len(value) + 3) // 4) * 3
                    - (2 if value.endswith("==") else int(value.endswith("=")))
                    for value in (encoded_key, encoded_value)
                )
                if decoded_bytes > limits.max_tile_entry_bytes:
                    raise ValueError("stored tile exceeds the combined byte limit")
                entry = HermesCollectionEntry(
                    base64.b64decode(encoded_key, validate=True),
                    base64.b64decode(encoded_value, validate=True),
                )
                tile = (
                    decode_slam_structure_tile(entry)
                    if structural
                    else decode_slam_tile(entry)
                )
            except DecodeError, KeyError, TypeError, ValueError:
                invalid = limits.increment(invalid)
                dirty = True
                continue
            if mission_token not in (None, tile.mission_token):
                if structural and entries:
                    # A delayed structural page from an older/newer mission
                    # must never erase a usable photographic scene during
                    # legacy-cache repair. Keep the photo mission and discard
                    # only the mismatched supporting page; a later matching
                    # page can still complete the pair.
                    dirty = True
                    continue
                entries.clear()
                structure_entries.clear()
                mission_ids.clear()
                truncated = False
                bounds = limits.bounds
                baseline = None
                dropped_photo = 0
                dropped_structure = 0
                invalid = 0
                dirty = True
            if tile.mission_id is not None:
                mission_ids.add(tile.mission_id)
            mission_token = tile.mission_token
            target = structure_entries if structural else entries
            key = tile_key(tile)
            if key in target:
                dirty = True
            target[key] = entry
            digests.layer(structural)[key] = page_digest(tile)
            evicted_photo, evicted_structure = enforce_collection_bounds(
                entries,
                structure_entries,
                max_tiles=limits.max_tiles,
                max_bytes=limits.max_bytes,
            )
            if evicted_photo or evicted_structure:
                # Evicted under the current bounds: not recoverable by replay.
                truncated = True
                bounds = limits.bounds
                dropped_photo = limits.increment(dropped_photo, evicted_photo)
                dropped_structure = limits.increment(
                    dropped_structure, evicted_structure
                )
                dirty = True

    if stored_mission is None and mission_token is not None:
        dirty = True
    return LoadedSnapshot(
        mission_token,
        next(iter(mission_ids), None) if len(mission_ids) == 1 else None,
        entries,
        structure_entries,
        truncated,
        dropped_photo,
        dropped_structure,
        invalid,
        dirty,
        bounds,
        baseline,
        digests,
    )


def _stored_baseline(value: object, max_tiles: int) -> RecoveryBaseline | None:
    """Return the persisted recovery baseline, or ``None`` when malformed."""
    if not isinstance(value, Mapping):
        return None
    layers: list[frozenset[str]] = []
    for name in ("tiles", "structure_tiles"):
        items = value.get(name)
        if (
            not isinstance(items, Sequence)
            or isinstance(items, str | bytes)
            or not 0 < len(items) <= max_tiles
        ):
            return None
        keys: set[str] = set()
        for item in items:
            if not isinstance(item, str) or len(item) > 32:
                return None
            try:
                x, y = parse_tile_key(item)
            except ValueError:
                return None
            if item != f"{x}:{y}":
                return None
            keys.add(item)
        layers.append(frozenset(keys))
    return layers[0], layers[1]


def _stored_bounds(value: object) -> tuple[int, int] | None:
    """Return the (tiles, bytes) bounds a snapshot was written under."""
    if not isinstance(value, Mapping):
        return None
    tiles = value.get("tiles")
    stored_bytes = value.get("bytes")
    if any(
        not isinstance(item, int) or isinstance(item, bool) or item < 0
        for item in (tiles, stored_bytes)
    ):
        return None
    assert isinstance(tiles, int) and isinstance(stored_bytes, int)
    return tiles, stored_bytes


def enforce_collection_bounds(
    entries: dict[str, HermesCollectionEntry],
    structure_entries: dict[str, HermesCollectionEntry],
    *,
    max_tiles: int,
    max_bytes: int,
) -> tuple[int, int]:
    """Mutate two layers to bounded, spatially useful paired coverage."""
    dropped_photo = 0
    dropped_structure = 0

    def drop_layer(
        collection: dict[str, HermesCollectionEntry], *, structural: bool
    ) -> None:
        nonlocal dropped_photo, dropped_structure
        counterpart = entries if structural else structure_entries
        key = _spatial_victim(collection)
        collection.pop(key)
        if structural:
            dropped_structure += 1
        else:
            dropped_photo += 1
        if key in counterpart:
            counterpart.pop(key)
            if structural:
                dropped_photo += 1
            else:
                dropped_structure += 1

    while len(entries) > max_tiles:
        drop_layer(entries, structural=False)
    while len(structure_entries) > max_tiles:
        drop_layer(structure_entries, structural=True)
    while stored_bytes(entries, structure_entries) > max_bytes:
        photo_only = entries.keys() - structure_entries.keys()
        structure_only = structure_entries.keys() - entries.keys()
        if photo_only or structure_only:
            if photo_only and (
                not structure_only or len(photo_only) >= len(structure_only)
            ):
                drop_layer(entries, structural=False)
            else:
                drop_layer(structure_entries, structural=True)
            continue
        if entries:
            drop_layer(entries, structural=False)
    return dropped_photo, dropped_structure


def stored_bytes(
    entries: Mapping[str, HermesCollectionEntry],
    structure_entries: Mapping[str, HermesCollectionEntry],
) -> int:
    return sum(
        len(item.key) + len(item.value)
        for collection in (entries, structure_entries)
        for item in collection.values()
    )


def _spatial_victim(
    collection: Mapping[str, HermesCollectionEntry],
) -> str:
    """Choose a redundant page while retaining broad, deterministic coverage."""
    available = sorted(collection)
    if len(available) == 1:
        return available[0]
    coordinates = {key: parse_tile_key(key) for key in available}
    min_x = min(point[0] for point in coordinates.values())
    max_x = max(point[0] for point in coordinates.values())
    min_y = min(point[1] for point in coordinates.values())
    max_y = max(point[1] for point in coordinates.values())
    extrema = {
        key
        for key, (x, y) in coordinates.items()
        if x in (min_x, max_x) or y in (min_y, max_y)
    }
    removable = [key for key in available if key not in extrema] or available
    buckets: dict[tuple[int, int], list[str]] = defaultdict(list)
    for key in removable:
        x, y = coordinates[key]
        bucket_x = _bucket(x, min_x, max_x)
        bucket_y = _bucket(y, min_y, max_y)
        buckets[(bucket_x, bucket_y)].append(key)
    bucket_center = (SPATIAL_BUCKETS_PER_AXIS - 1) / 2
    fullest = min(
        buckets,
        key=lambda item: (
            -len(buckets[item]),
            (item[0] - bucket_center) ** 2 + (item[1] - bucket_center) ** 2,
            item,
        ),
    )
    bucket_keys = buckets[fullest]
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    return min(
        bucket_keys,
        key=lambda key: (
            (coordinates[key][0] - center_x) ** 2
            + (coordinates[key][1] - center_y) ** 2,
            key,
        ),
    )


def _bucket(value: int, minimum: int, maximum: int) -> int:
    if minimum == maximum:
        return 0
    return min(
        SPATIAL_BUCKETS_PER_AXIS - 1,
        (value - minimum) * SPATIAL_BUCKETS_PER_AXIS // (maximum - minimum + 1),
    )


def _bounded_count(value: object, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        return 0
    return min(maximum, max(0, value))


def _stored_mission_token(value: object) -> str | None:
    if not isinstance(value, str) or len(value) != 64:
        return None
    try:
        bytes.fromhex(value)
    except ValueError:
        return None
    return value


def tile_key(tile: SlamTile | SlamStructureTile) -> str:
    return f"{tile.page_x}:{tile.page_y}"


def parse_tile_key(key: str) -> tuple[int, int]:
    x, y = key.split(":", 1)
    return int(x), int(y)
