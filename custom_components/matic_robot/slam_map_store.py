"""Private Home Assistant storage for local photorealistic SLAM tiles."""

from __future__ import annotations

import asyncio
import base64
import hashlib
from collections import OrderedDict, defaultdict, deque
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from time import monotonic
from typing import Any, Literal

from google.protobuf.message import DecodeError
from homeassistant.core import CALLBACK_TYPE, HassJob, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.storage import Store

from .client.api import MaticHermesClient
from .client.models import FloorPlan, HermesCollectionEntry
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
# A valid mapped floor can be physically small. Completeness comes from both
# independent live layers agreeing on mission and spatial topology, followed by
# a bounded settle period; floor area is not a correctness signal.
MIN_COMPLETE_TILES = 1
MIN_LAYER_OVERLAP = 0.95
SPATIAL_BUCKETS_PER_AXIS = 8
MAX_HEALTH_COUNTER = 2**31 - 1
MAX_LOAD_ITEMS_PER_LAYER = MAX_TILES * 2
MAX_CANDIDATE_MISSIONS = 2
MAX_CANDIDATE_TILES_PER_LAYER = 128
MAX_CANDIDATE_BYTES = 2 * 1024 * 1024
MAX_RETIRED_MISSIONS = 8
# A candidate needs pages from both independent subscriptions.  Allow three
# normal retry intervals for those streams to converge, then classify a
# one-sided candidate so it cannot hold the active map unavailable forever.
CANDIDATE_CLASSIFICATION_SECONDS = STREAM_RETRY_SECONDS * 3
CANDIDATE_REFRESH_RETRY_SECONDS = STREAM_RETRY_SECONDS

MapHealthState = Literal[
    "empty", "collecting", "incomplete", "ready", "truncated", "degraded"
]
MapStreamState = Literal["idle", "connecting", "connected", "retrying"]


@dataclass(frozen=True, slots=True)
class SlamMapHealth:
    """Bounded, content-free health details for the private map cache."""

    state: MapHealthState
    complete: bool
    truncated: bool
    photo_tiles: int
    structure_tiles: int
    overlapping_tiles: int
    layer_overlap: float
    dropped_photo_tiles: int
    dropped_structure_tiles: int
    invalid_tiles: int
    stream_state: MapStreamState
    stream_failures: int


@dataclass(frozen=True, slots=True)
class SlamMapIdentity:
    """Private identity of the map mission currently safe to render."""

    mission_token: str
    mission_id: int | None

    def matches_floor_plan(self, floor_plan: FloorPlan | None) -> bool:
        """Return whether a floor plan is proven to describe this map."""
        return (
            self.mission_id is not None
            and floor_plan is not None
            and floor_plan.mission_id == self.mission_id
        )


@dataclass(slots=True)
class _MissionCandidate:
    """Bounded pages waiting for cross-layer mission confirmation."""

    generation: int
    first_seen_at: float
    entries: dict[str, HermesCollectionEntry]
    structure_entries: dict[str, HermesCollectionEntry]
    mission_id: int | None
    blocks_active: bool = True
    truncated: bool = False
    dropped_photo_tiles: int = 0
    dropped_structure_tiles: int = 0


@dataclass(frozen=True, slots=True)
class _LoadedMap:
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


class SlamMapStore:
    """Accumulate current robot SLAM tiles without exposing them to Recorder."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            f"{DOMAIN}.slam_map.{entry_id}",
            private=True,
            serialize_in_event_loop=False,
        )
        self._mission_token: str | None = None
        self._mission_id: int | None = None
        self._expected_mission_id: int | None = None
        self._entries: dict[str, HermesCollectionEntry] = {}
        self._structure_entries: dict[str, HermesCollectionEntry] = {}
        self._entry_content_digests: dict[str, bytes] = {}
        self._structure_content_digests: dict[str, bytes] = {}
        self._revision = 0
        self._last_change = 0.0
        self._last_topology_change = 0.0
        self._map_complete = False
        # A restored private cache is useful as a bounded local checkpoint, but
        # it is not proof that it describes the robot's location *after this
        # integration session starts*.  Both live map collections must confirm
        # the active mission before anything treats the cached scene as live.
        self._live_photo_seen = False
        self._live_structure_seen = False
        self._truncated = False
        self._dropped_photo_tiles = 0
        self._dropped_structure_tiles = 0
        self._invalid_tiles = 0
        self._stream_states: dict[str, MapStreamState] = {
            "map_compressed_rgb": "idle",
            "map_integrated": "idle",
        }
        self._stream_failures = 0
        self._listeners: set[Callable[[], None]] = set()
        self._candidates: OrderedDict[str, _MissionCandidate] = OrderedDict()
        self._retired_missions: deque[str] = deque(maxlen=MAX_RETIRED_MISSIONS)
        self._candidate_generation = 0
        self._candidate_expiry_cancel: CALLBACK_TYPE | None = None
        self._candidate_refresh_retry_cancel: CALLBACK_TYPE | None = None
        self._candidate_refresh_task: asyncio.Task[None] | None = None
        self._collection_client: MaticHermesClient | None = None
        self._closed = False

    async def async_load(self) -> None:
        """Load and validate the robot-local tile cache."""
        self._cancel_candidate_expiry()
        self._cancel_candidate_refresh_retry()
        stored = await self._store.async_load() or {}
        loaded = await self._hass.async_add_executor_job(
            _decode_stored_snapshot, stored
        )
        self._mission_token = loaded.mission_token
        self._mission_id = loaded.mission_id
        self._entries = loaded.entries
        self._structure_entries = loaded.structure_entries
        self._entry_content_digests.clear()
        self._structure_content_digests.clear()
        self._truncated = loaded.truncated
        self._dropped_photo_tiles = loaded.dropped_photo_tiles
        self._dropped_structure_tiles = loaded.dropped_structure_tiles
        self._invalid_tiles = loaded.invalid_tiles
        self._candidates.clear()
        self._retired_missions.clear()
        self._candidate_generation = 0
        self._closed = False
        self._revision = len(self._entries) + len(self._structure_entries)
        self._last_change = 0.0
        self._last_topology_change = 0.0
        self._map_complete = not self._truncated and self._has_balanced_layers()
        self._live_photo_seen = False
        self._live_structure_seen = False
        if loaded.dirty:
            self._schedule_save()
        self._notify_listeners()

    async def async_add(self, entry: HermesCollectionEntry) -> SlamTile:
        """Validate, cache, and privately persist one current tile."""
        tile = decode_slam_tile(entry)
        self._async_cache_entry(entry, tile, structural=False)
        return tile

    async def async_add_structure(
        self, entry: HermesCollectionEntry
    ) -> SlamStructureTile:
        """Validate, cache, and privately persist one structural map page."""
        tile = decode_slam_structure_tile(entry)
        self._async_cache_entry(entry, tile, structural=True)
        return tile

    def _async_cache_entry(
        self,
        entry: HermesCollectionEntry,
        tile: SlamTile | SlamStructureTile,
        *,
        structural: bool,
    ) -> None:
        """Cache an active page or stage a cross-layer mission candidate."""
        if self._closed:
            return
        self._expire_incomplete_candidates()
        mission_token = tile.mission_token
        if (
            self._expected_mission_id is not None
            and tile.mission_id != self._expected_mission_id
        ):
            return
        if self._mission_token is None:
            self._mission_token = mission_token
            self._mission_id = tile.mission_id
        if mission_token != self._mission_token:
            self._stage_candidate(entry, tile, structural=structural)
            return
        if (
            self._mission_id is not None
            and tile.mission_id is not None
            and tile.mission_id != self._mission_id
        ):
            raise DecodeError("SLAM mission identity changed without a new token")
        identity_changed = self._mission_id is None and tile.mission_id is not None
        if identity_changed:
            self._mission_id = tile.mission_id
        target = self._structure_entries if structural else self._entries
        content_digests = (
            self._structure_content_digests
            if structural
            else self._entry_content_digests
        )
        key = _tile_key(tile)
        previous = target.get(key)
        content_digest = _tile_content_digest(tile)
        previous_digest = content_digests.get(key)
        if previous is not None and previous_digest is None:
            previous_tile = (
                decode_slam_structure_tile(previous)
                if structural
                else decode_slam_tile(previous)
            )
            previous_digest = _tile_content_digest(previous_tile)
        changed = previous is None or previous_digest != content_digest
        target[key] = entry
        content_digests[key] = content_digest
        # Once a different mission has been observed, delayed pages from the
        # active token are evidence only for the cached map.  They cannot
        # re-establish that it still represents the robot while a replacement
        # mission is awaiting its independent layer.
        if self._has_blocking_candidate():
            self._invalidate_live_session()
            live_session_confirmed = False
        else:
            live_session_confirmed = self._observe_live_layer(structural=structural)
        if live_session_confirmed:
            self._cancel_candidate_refresh_retry()
        if not changed and not identity_changed and not live_session_confirmed:
            return
        self._content_changed(
            topology_changed=(
                previous is None or identity_changed or live_session_confirmed
            )
        )

    def _stage_candidate(
        self,
        entry: HermesCollectionEntry,
        tile: SlamTile | SlamStructureTile,
        *,
        structural: bool,
    ) -> None:
        """Wait for both independent map layers before changing missions."""
        mission_token = tile.mission_token
        if mission_token in self._retired_missions:
            return
        candidate = self._candidates.get(mission_token)
        if candidate is None:
            if len(self._candidates) >= MAX_CANDIDATE_MISSIONS:
                evicted_token, _candidate = self._candidates.popitem(last=False)
                self._retire_mission(evicted_token)
            self._candidate_generation += 1
            candidate = _MissionCandidate(
                generation=self._candidate_generation,
                first_seen_at=monotonic(),
                entries={},
                structure_entries={},
                mission_id=tile.mission_id,
            )
            self._candidates[mission_token] = candidate
        else:
            self._candidates.move_to_end(mission_token)
            if (
                candidate.mission_id is not None
                and tile.mission_id is not None
                and candidate.mission_id != tile.mission_id
            ):
                raise DecodeError("candidate SLAM mission identity is inconsistent")
            if candidate.mission_id is None:
                candidate.mission_id = tile.mission_id
        target = candidate.structure_entries if structural else candidate.entries
        missing_layer = not target
        target[_tile_key(tile)] = entry
        # A new candidate, or a late counterpart for an expired candidate,
        # makes the active map unsafe until this candidate is classified.  A
        # further page from an already-expired one-sided stream does not start
        # another indefinite pause; its retained page remains available for a
        # future independent counterpart instead.
        if candidate.blocks_active or missing_layer:
            self._cancel_candidate_refresh_retry()
            self._invalidate_live_session()
        self._enforce_candidate_bounds(candidate)
        # A newer observed mission is authoritative until it is classified.
        # Do not promote an older candidate merely because its delayed layer
        # happened to arrive first.
        if (
            candidate.entries
            and candidate.structure_entries
            and self._candidate_can_promote(candidate)
        ):
            self._promote_candidate(mission_token, candidate)
        self._schedule_candidate_expiry()

    def _expire_incomplete_candidates(self) -> bool:
        """Relax one-sided candidates after bounded classification.

        An alternative token invalidates the active map immediately, but a
        failed or skewed subscription must not keep the active map unavailable
        forever.  Retain its bounded early layer so a delayed independent
        counterpart can still promote the candidate, but allow the active
        mission to earn fresh two-layer proof in the meantime.
        """
        cutoff = monotonic() - CANDIDATE_CLASSIFICATION_SECONDS
        relaxed = False
        for candidate in self._candidates.values():
            if candidate.blocks_active and candidate.first_seen_at <= cutoff:
                candidate.blocks_active = False
                relaxed = True
        if relaxed:
            self._promote_latest_complete_candidate()
        self._schedule_candidate_expiry()
        # This method also runs synchronously while processing a newly
        # received page.  If that page crosses the classification deadline
        # before the timer callback runs, schedule the same bounded
        # revalidation the timer path would have requested.  Otherwise a
        # quiet counterpart stream could leave live map state unavailable
        # indefinitely after the candidate has been relaxed.
        if relaxed and not self._has_blocking_candidate():
            self._schedule_candidate_refresh()
        return relaxed

    def _has_blocking_candidate(self) -> bool:
        """Return whether an unclassified candidate still blocks active proof."""
        return any(candidate.blocks_active for candidate in self._candidates.values())

    def _candidate_can_promote(self, candidate: _MissionCandidate) -> bool:
        """Return whether no newer unclassified candidate outranks ``candidate``."""
        return not any(
            pending.blocks_active and pending.generation > candidate.generation
            for pending in self._candidates.values()
        )

    def _promote_latest_complete_candidate(self) -> None:
        """Promote the best complete candidate after a newer one is classified."""
        best: tuple[str, _MissionCandidate] | None = None
        for mission_token, candidate in self._candidates.items():
            if (
                candidate.entries
                and candidate.structure_entries
                and self._candidate_can_promote(candidate)
            ):
                if best is None or candidate.generation > best[1].generation:
                    best = mission_token, candidate
        if best is not None:
            self._promote_candidate(*best)

    def _schedule_candidate_expiry(self) -> None:
        """Schedule classification even while both map streams stay quiet."""
        self._cancel_candidate_expiry()
        if self._closed:
            return
        deadlines = [
            candidate.first_seen_at + CANDIDATE_CLASSIFICATION_SECONDS
            for candidate in self._candidates.values()
            if candidate.blocks_active
        ]
        if not deadlines:
            return
        delay = max(0.0, min(deadlines) - monotonic())
        self._candidate_expiry_cancel = async_call_later(
            self._hass,
            delay,
            HassJob(
                self._async_handle_candidate_expiry,
                "matic_robot_map_candidate_expiry",
                cancel_on_shutdown=True,
            ),
        )

    def _cancel_candidate_expiry(self) -> None:
        """Cancel the pending candidate-classification callback, if any."""
        if self._candidate_expiry_cancel is not None:
            self._candidate_expiry_cancel()
            self._candidate_expiry_cancel = None

    @callback
    def _async_handle_candidate_expiry(self, _now: datetime) -> None:
        """Classify a silent candidate and take fresh bounded map snapshots."""
        self._candidate_expiry_cancel = None
        if self._closed:
            return
        relaxed = self._expire_incomplete_candidates()
        if relaxed and not self._has_blocking_candidate():
            self._schedule_candidate_refresh()

    def _schedule_candidate_refresh(self) -> None:
        """Request fresh independent proof after a candidate expires."""
        client = self._collection_client
        task = self._candidate_refresh_task
        if self._closed or client is None or (task is not None and not task.done()):
            return
        self._candidate_refresh_task = self._hass.async_create_task(
            self._async_refresh_after_candidate_expiry(client),
            "matic_robot_map_candidate_refresh",
        )

    def _needs_candidate_refresh(self) -> bool:
        """Return whether expired candidates still need fresh active-map proof."""
        return bool(
            not self._closed
            and self._candidates
            and not self._has_blocking_candidate()
            and not self.live_session_verified
        )

    def _schedule_candidate_refresh_retry(self) -> None:
        """Retry bounded map revalidation after a transient snapshot failure."""
        self._cancel_candidate_refresh_retry()
        if not self._needs_candidate_refresh():
            return
        self._candidate_refresh_retry_cancel = async_call_later(
            self._hass,
            CANDIDATE_REFRESH_RETRY_SECONDS,
            HassJob(
                self._async_handle_candidate_refresh_retry,
                "matic_robot_map_candidate_refresh_retry",
                cancel_on_shutdown=True,
            ),
        )

    def _cancel_candidate_refresh_retry(self) -> None:
        """Cancel the pending candidate-refresh retry, if any."""
        if self._candidate_refresh_retry_cancel is not None:
            self._candidate_refresh_retry_cancel()
            self._candidate_refresh_retry_cancel = None

    @callback
    def _async_handle_candidate_refresh_retry(self, _now: datetime) -> None:
        """Retry only while no live proof or newer candidate has arrived."""
        self._candidate_refresh_retry_cancel = None
        if self._needs_candidate_refresh():
            self._schedule_candidate_refresh()

    async def _async_refresh_after_candidate_expiry(
        self, client: MaticHermesClient
    ) -> None:
        """Read one page from each map collection without trusting cache state."""
        try:
            photo_entries, structure_entries = await asyncio.gather(
                client.async_get_collection_entries("map_compressed_rgb", limit=1),
                client.async_get_collection_entries("map_integrated", limit=1),
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            self._schedule_candidate_refresh_retry()
            return
        if self._closed or not self._needs_candidate_refresh():
            return
        try:
            for entry in photo_entries:
                await self.async_add(entry)
            for entry in structure_entries:
                await self.async_add_structure(entry)
        except DecodeError:
            self._record_invalid()
            self._notify_listeners()
            self._schedule_candidate_refresh_retry()
            return
        if self._needs_candidate_refresh():
            self._schedule_candidate_refresh_retry()
        else:
            self._cancel_candidate_refresh_retry()

    async def _async_cancel_candidate_refresh(self) -> None:
        """Stop an in-flight bounded map refresh during entry teardown."""
        task = self._candidate_refresh_task
        self._candidate_refresh_task = None
        if task is None or task.done():
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    def _promote_candidate(
        self, mission_token: str, candidate: _MissionCandidate
    ) -> None:
        """Atomically replace the active mission after cross-layer evidence."""
        self._cancel_candidate_refresh_retry()
        if self._mission_token is not None:
            self._retire_mission(self._mission_token)
        for token, pending in tuple(self._candidates.items()):
            if pending.generation < candidate.generation:
                self._candidates.pop(token)
                self._retire_mission(token)
        self._mission_token = mission_token
        self._mission_id = candidate.mission_id
        self._entries = candidate.entries
        self._structure_entries = candidate.structure_entries
        self._entry_content_digests.clear()
        self._structure_content_digests.clear()
        self._truncated = candidate.truncated
        self._dropped_photo_tiles = candidate.dropped_photo_tiles
        self._dropped_structure_tiles = candidate.dropped_structure_tiles
        self._invalid_tiles = 0
        self._candidates.pop(mission_token, None)
        # Promotion itself requires live photographic and structural evidence.
        self._live_photo_seen = True
        self._live_structure_seen = True
        self._content_changed()

    def _retire_mission(self, mission_token: str) -> None:
        """Remember recently superseded tokens so delayed pages are ignored."""
        self._retired_missions.append(mission_token)

    def _enforce_candidate_bounds(self, candidate: _MissionCandidate) -> None:
        dropped_photo, dropped_structure = _enforce_collection_bounds(
            candidate.entries,
            candidate.structure_entries,
            max_tiles=MAX_CANDIDATE_TILES_PER_LAYER,
            max_bytes=MAX_CANDIDATE_BYTES,
        )
        if dropped_photo or dropped_structure:
            candidate.truncated = True
            candidate.dropped_photo_tiles = _increment_by(
                candidate.dropped_photo_tiles, dropped_photo
            )
            candidate.dropped_structure_tiles = _increment_by(
                candidate.dropped_structure_tiles, dropped_structure
            )

    def _content_changed(self, *, topology_changed: bool = True) -> None:
        """Apply bounds and publish one content revision."""
        self._enforce_bounds()
        self._revision += 1
        self._last_change = monotonic()
        if topology_changed:
            self._last_topology_change = self._last_change
            self._map_complete = False
        self._schedule_save()
        self._notify_listeners()

    def _observe_live_layer(self, *, structural: bool) -> bool:
        """Record one fresh collection layer and report first live proof."""
        was_confirmed = self._live_photo_seen and self._live_structure_seen
        if structural:
            self._live_structure_seen = True
        else:
            self._live_photo_seen = True
        return not was_confirmed and self._live_photo_seen and self._live_structure_seen

    def _invalidate_live_session(self) -> None:
        """Fail closed while a newly observed map mission is classified."""
        if not (self._live_photo_seen or self._live_structure_seen):
            return
        self._live_photo_seen = False
        self._live_structure_seen = False
        self._content_changed()

    async def async_collect(self, client: MaticHermesClient) -> None:
        """Continuously collect photographic and structural map pages."""
        self._collection_client = client
        try:
            await asyncio.gather(
                self._async_collect_collection(client, "map_compressed_rgb", False),
                self._async_collect_collection(client, "map_integrated", True),
            )
        finally:
            if self._collection_client is client:
                self._collection_client = None

    async def _async_collect_collection(
        self, client: MaticHermesClient, name: str, structural: bool
    ) -> None:
        while not self._closed:
            self._set_stream_state(name, "connecting")
            try:
                async for entry in client.async_subscribe_collection_entries(name):
                    self._set_stream_state(name, "connected")
                    try:
                        if structural:
                            await self.async_add_structure(entry)
                        else:
                            await self.async_add(entry)
                    except DecodeError:
                        self._record_invalid()
                        self._notify_listeners()
            except asyncio.CancelledError:
                raise
            except Exception:  # A failed private stream must not kill map collection.
                self._stream_failures = _increment(self._stream_failures)
                self._set_stream_state(name, "retrying")
            else:
                self._set_stream_state(name, "retrying")
            if self._closed:
                return
            await asyncio.sleep(STREAM_RETRY_SECONDS)

    def async_add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Subscribe to content and health changes; return an unsubscribe callback."""
        self._listeners.add(listener)

        def remove_listener() -> None:
            self._listeners.discard(listener)

        return remove_listener

    @callback
    def set_expected_mission_id(self, mission_id: int | None) -> None:
        """Bind live map ingestion to the robot-selected mapped floor."""
        if self._expected_mission_id == mission_id:
            return
        self._expected_mission_id = mission_id
        self._cancel_candidate_expiry()
        self._cancel_candidate_refresh_retry()
        self._candidates.clear()
        # A mapped floor can become current again later in the same HA session.
        # Explicit robot selection makes those pages authoritative, rather than
        # delayed evidence from the previously selected floor.
        self._retired_missions.clear()
        self._invalidate_live_session()

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
    def mission_identity(self) -> SlamMapIdentity | None:
        """Return the active private mission identity without its raw payload."""
        if self._mission_token is None:
            return None
        return SlamMapIdentity(self._mission_token, self._mission_id)

    def floor_plan_is_current(self, floor_plan: FloorPlan | None) -> bool:
        """Return whether the active SLAM map and floor plan are correlated."""
        identity = self.mission_identity
        return bool(
            self.live_session_verified
            and identity is not None
            and identity.matches_floor_plan(floor_plan)
        )

    @property
    def live_session_verified(self) -> bool:
        """Return whether both live map collections confirmed this session."""
        return self._live_photo_seen and self._live_structure_seen

    @property
    def structure_tile_count(self) -> int:
        """Return the number of cached structural pages."""
        return len(self._structure_entries)

    @property
    def map_complete(self) -> bool:
        """Return whether both untruncated layers settled for the current mission."""
        if not self.live_session_verified:
            return False
        if self._truncated:
            return False
        if self._map_complete:
            return True
        if not self._has_balanced_layers():
            return False
        self._map_complete = (
            monotonic() - self._last_topology_change >= MAP_SETTLE_SECONDS
        )
        return self._map_complete

    @property
    def health(self) -> SlamMapHealth:
        """Return bounded operational health without exposing map content."""
        complete = self.map_complete
        stream_state = self._combined_stream_state()
        overlapping_tiles, layer_overlap = self._layer_overlap()
        if self._truncated:
            state: MapHealthState = "truncated"
        elif stream_state == "retrying" or self._invalid_tiles:
            state = "degraded"
        elif complete:
            state = "ready"
        elif not self._entries and not self._structure_entries:
            state = "collecting" if stream_state != "idle" else "empty"
        else:
            state = "incomplete"
        return SlamMapHealth(
            state=state,
            complete=complete,
            truncated=self._truncated,
            photo_tiles=len(self._entries),
            structure_tiles=len(self._structure_entries),
            overlapping_tiles=overlapping_tiles,
            layer_overlap=layer_overlap,
            dropped_photo_tiles=self._dropped_photo_tiles,
            dropped_structure_tiles=self._dropped_structure_tiles,
            invalid_tiles=self._invalid_tiles,
            stream_state=stream_state,
            stream_failures=self._stream_failures,
        )

    def _combined_stream_state(self) -> MapStreamState:
        states = tuple(self._stream_states.values())
        if "retrying" in states:
            return "retrying"
        if states and all(state == "connected" for state in states):
            return "connected"
        if any(state in ("connecting", "connected") for state in states):
            return "connecting"
        return "idle"

    def _has_balanced_layers(self) -> bool:
        """Return whether enough pages from both full-map layers are present."""
        photo_count = len(self._entries)
        structure_count = len(self._structure_entries)
        if min(photo_count, structure_count) < MIN_COMPLETE_TILES:
            return False
        _overlap, coverage = self._layer_overlap()
        return coverage >= MIN_LAYER_OVERLAP

    def _layer_overlap(self) -> tuple[int, float]:
        """Return content-free cross-layer page-grid coverage."""
        largest_layer = max(len(self._entries), len(self._structure_entries))
        if largest_layer == 0:
            return 0, 0.0
        overlap = len(self._entries.keys() & self._structure_entries.keys())
        return overlap, overlap / largest_layer

    async def async_remove(self) -> None:
        """Erase the private map cache when the robot entry is removed."""
        self._closed = True
        self._cancel_candidate_expiry()
        self._cancel_candidate_refresh_retry()
        await self._async_cancel_candidate_refresh()
        self._collection_client = None
        self._entries.clear()
        self._structure_entries.clear()
        self._entry_content_digests.clear()
        self._structure_content_digests.clear()
        self._candidates.clear()
        self._retired_missions.clear()
        self._candidate_generation = 0
        self._live_photo_seen = False
        self._live_structure_seen = False
        self._mission_token = None
        self._mission_id = None
        self._revision += 1
        self._last_change = monotonic()
        self._last_topology_change = self._last_change
        self._map_complete = False
        self._truncated = False
        self._dropped_photo_tiles = 0
        self._dropped_structure_tiles = 0
        self._invalid_tiles = 0
        self._notify_listeners()
        await self._store.async_remove()

    async def async_shutdown(self) -> None:
        """Close mutation and resolve pending private writes before unload."""
        if self._closed:
            return
        self._closed = True
        self._cancel_candidate_expiry()
        self._cancel_candidate_refresh_retry()
        await self._async_cancel_candidate_refresh()
        self._collection_client = None
        data = await self._hass.async_add_executor_job(
            _serialize_snapshot,
            tuple(self._entries.values()),
            tuple(self._structure_entries.values()),
            self._snapshot_health(),
        )
        # Store.async_save replaces and resolves any delayed save through the
        # documented API, so a later config-entry removal cannot be resurrected.
        await self._store.async_save(data)

    def _enforce_bounds(self) -> None:
        dropped_photo, dropped_structure = _enforce_collection_bounds(
            self._entries,
            self._structure_entries,
            max_tiles=MAX_TILES,
            max_bytes=MAX_STORED_BYTES,
        )
        if dropped_photo or dropped_structure:
            self._truncated = True
            self._dropped_photo_tiles = _increment_by(
                self._dropped_photo_tiles, dropped_photo
            )
            self._dropped_structure_tiles = _increment_by(
                self._dropped_structure_tiles, dropped_structure
            )
        for key in self._entry_content_digests.keys() - self._entries.keys():
            self._entry_content_digests.pop(key)
        for key in (
            self._structure_content_digests.keys() - self._structure_entries.keys()
        ):
            self._structure_content_digests.pop(key)

    def _record_invalid(self) -> None:
        self._invalid_tiles = _increment(self._invalid_tiles)

    def _set_stream_state(self, name: str, state: MapStreamState) -> None:
        if self._stream_states.get(name) == state:
            return
        self._stream_states[name] = state
        self._notify_listeners()

    def _notify_listeners(self) -> None:
        for listener in tuple(self._listeners):
            listener()

    def _schedule_save(self) -> None:
        """Debounce an immutable snapshot and encode it outside the event loop."""
        if self._closed:
            return
        self._store.async_delay_save(
            partial(
                _serialize_snapshot,
                tuple(self._entries.values()),
                tuple(self._structure_entries.values()),
                self._snapshot_health(),
            ),
            SAVE_DELAY_SECONDS,
        )

    def _snapshot_health(self) -> tuple[str | None, bool, int, int]:
        return (
            self._mission_token,
            self._truncated,
            self._dropped_photo_tiles,
            self._dropped_structure_tiles,
        )

    def _serialized_data(self) -> dict[str, Any]:
        """Build a private payload synchronously for diagnostics and migration."""
        return _serialize_snapshot(
            tuple(self._entries.values()),
            tuple(self._structure_entries.values()),
            self._snapshot_health(),
        )


def _serialize_snapshot(
    photo_entries: tuple[HermesCollectionEntry, ...],
    structure_entries: tuple[HermesCollectionEntry, ...],
    health: tuple[str | None, bool, int, int],
) -> dict[str, Any]:
    """Encode an immutable private snapshot for Home Assistant storage."""
    mission_token, truncated, dropped_photo_tiles, dropped_structure_tiles = health
    return {
        "mission_token": mission_token,
        "truncated": truncated,
        "dropped_photo_tiles": dropped_photo_tiles,
        "dropped_structure_tiles": dropped_structure_tiles,
        "tiles": [_serialize_entry(item) for item in photo_entries],
        "structure_tiles": [_serialize_entry(item) for item in structure_entries],
    }


def _serialize_entry(item: HermesCollectionEntry) -> dict[str, str]:
    return {
        "key": base64.b64encode(item.key).decode("ascii"),
        "value": base64.b64encode(item.value).decode("ascii"),
    }


def _decode_stored_snapshot(stored: object) -> _LoadedMap:
    """Decode and bound one private cache snapshot away from the event loop."""
    if not isinstance(stored, Mapping):
        return _LoadedMap(None, None, {}, {}, False, 0, 0, 1, True)
    stored_mission = _stored_mission_token(stored.get("mission_token"))
    mission_token = stored_mission
    truncated = stored.get("truncated") is True
    dropped_photo = _bounded_count(stored.get("dropped_photo_tiles", 0))
    dropped_structure = _bounded_count(stored.get("dropped_structure_tiles", 0))
    invalid = 0
    dirty = (
        (stored.get("mission_token") is not None and stored_mission is None)
        or ("truncated" in stored and not isinstance(stored["truncated"], bool))
        or dropped_photo != stored.get("dropped_photo_tiles", 0)
        or dropped_structure != stored.get("dropped_structure_tiles", 0)
    )
    entries: dict[str, HermesCollectionEntry] = {}
    structure_entries: dict[str, HermesCollectionEntry] = {}
    mission_ids: set[int] = set()

    for structural, name in ((False, "tiles"), (True, "structure_tiles")):
        items = stored.get(name, ())
        if not isinstance(items, Sequence) or isinstance(items, str | bytes):
            invalid = _increment(invalid)
            dirty = True
            continue
        item_limit = min(len(items), MAX_LOAD_ITEMS_PER_LAYER)
        if len(items) > item_limit:
            overflow = len(items) - item_limit
            truncated = True
            if structural:
                dropped_structure = _increment_by(dropped_structure, overflow)
            else:
                dropped_photo = _increment_by(dropped_photo, overflow)
            dirty = True
        for index in range(item_limit):
            item = items[index]
            if not isinstance(item, Mapping):
                invalid = _increment(invalid)
                dirty = True
                continue
            try:
                entry = HermesCollectionEntry(
                    base64.b64decode(item["key"], validate=True),
                    base64.b64decode(item["value"], validate=True),
                )
                tile = (
                    decode_slam_structure_tile(entry)
                    if structural
                    else decode_slam_tile(entry)
                )
            except DecodeError, KeyError, TypeError, ValueError:
                invalid = _increment(invalid)
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
                dropped_photo = 0
                dropped_structure = 0
                invalid = 0
                dirty = True
            if tile.mission_id is not None:
                mission_ids.add(tile.mission_id)
            mission_token = tile.mission_token
            target = structure_entries if structural else entries
            key = _tile_key(tile)
            if key in target:
                dirty = True
            target[key] = entry
            evicted_photo, evicted_structure = _enforce_collection_bounds(
                entries,
                structure_entries,
                max_tiles=MAX_TILES,
                max_bytes=MAX_STORED_BYTES,
            )
            if evicted_photo or evicted_structure:
                truncated = True
                dropped_photo = _increment_by(dropped_photo, evicted_photo)
                dropped_structure = _increment_by(dropped_structure, evicted_structure)
                dirty = True

    if stored_mission is None and mission_token is not None:
        dirty = True
    return _LoadedMap(
        mission_token,
        next(iter(mission_ids), None) if len(mission_ids) == 1 else None,
        entries,
        structure_entries,
        truncated,
        dropped_photo,
        dropped_structure,
        invalid,
        dirty,
    )


def _enforce_collection_bounds(
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
    while _stored_bytes(entries, structure_entries) > max_bytes:
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


def _stored_bytes(
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
    coordinates = {key: _parse_tile_key(key) for key in available}
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


def _bounded_count(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        return 0
    return min(MAX_HEALTH_COUNTER, max(0, value))


def _stored_mission_token(value: object) -> str | None:
    if not isinstance(value, str) or len(value) != 64:
        return None
    try:
        bytes.fromhex(value)
    except ValueError:
        return None
    return value


def _increment(value: int) -> int:
    return min(MAX_HEALTH_COUNTER, value + 1)


def _increment_by(value: int, amount: int) -> int:
    return min(MAX_HEALTH_COUNTER, value + max(0, amount))


def _tile_content_digest(tile: SlamTile | SlamStructureTile) -> bytes:
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


def _tile_key(tile: SlamTile | SlamStructureTile) -> str:
    return f"{tile.page_x}:{tile.page_y}"


def _parse_tile_key(key: str) -> tuple[int, int]:
    x, y = key.split(":", 1)
    return int(x), int(y)
