"""Authenticated local HTTP views for the private 3D SLAM studio."""

from __future__ import annotations

import asyncio
import json
import secrets
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from functools import partial
from hashlib import sha256
from http import HTTPStatus
from time import monotonic, time
from typing import TYPE_CHECKING, Any, cast

import probatio
from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.components.http.decorators import require_admin
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView
from homeassistant.util import slugify

from .area_binding import (
    AREA_SCHEMA_VERSION,
    AreaBindingStatus,
    area_binding_allows_review,
    area_binding_needs_geometry_index,
    area_binding_status,
    binding_for_area,
)
from .area_geometry import AreaGeometry, RoomGeometryIndex
from .area_outline import validate_outline
from .cadence import CoverageCadenceRequiresVacuumError
from .client.commands import CleaningMode, CoverageSetting
from .client.exceptions import MaticError
from .client.floor_plan import (
    pose_observation_age_seconds,
    resolve_robot_map_position,
    robot_location_source,
)
from .client.models import FloorPlan, HermesCollectionEntry, MapZone, RobotPose
from .client.slam_map import decode_slam_tile, encode_slam_scene
from .client.zones import zone_overlaps_circle, zone_overlaps_polygon
from .const import DOMAIN
from .plans import (
    AreaFramePointLimitError,
    AreaInUseError,
    AreaSavePreconditionError,
    CleaningRoom,
    MetadataAdmissionClosedError,
    PlanAreaMapChangedError,
    PlanAreaMissingError,
    RoomSequenceLimitError,
    entry_mission_boundaries,
    plan_entries,
    plan_floor_token,
    room_cadence_identity,
)
from .room_sequence import saved_plan_preview_token
from .slam_delta import encode_slam_scene_delta
from .slam_map_store import SlamMapIdentity

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticConfigEntry, MaticRuntimeData
    from .slam_history import SlamHistorySnapshot

SCENE_API_URL = "/api/matic_robot/slam_scene/{entry_id}"
POSE_API_URL = "/api/matic_robot/slam_pose/{entry_id}"
CATALOG_API_URL = "/api/matic_robot/slam_entries"
DELTA_API_URL = "/api/matic_robot/slam_delta/{entry_id}"
HISTORY_API_URL = "/api/matic_robot/slam_history/{entry_id}"
HISTORY_SCENE_API_URL = "/api/matic_robot/slam_history_scene/{entry_id}/{snapshot_id}"
AREAS_API_URL = "/api/matic_robot/areas/{entry_id}"
PLANS_API_URL = "/api/matic_robot/plans/{entry_id}"
WIFI_HEATMAP_API_URL = "/api/matic_robot/wifi_heatmap/{entry_id}"
POSE_CACHE_SECONDS = 1.0
SCENE_ENCODE_ATTEMPTS = 2
SCENE_CACHE_REVISIONS = 2
DELTA_WAIT_SECONDS = 5

PRIVATE_NO_STORE_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
}

_MAP_SESSION_KEY_DOMAIN = b"matic-map-session-v1\0"


def _map_session_key(runtime: MaticRuntimeData) -> str | None:
    """Return a browser-safe identity for one verified SLAM coordinate frame."""
    identity = runtime.slam_map.mission_identity
    floor_plan = runtime.coordinator.data.floor_plan
    if (
        identity is None
        or identity.mission_id is None
        or floor_plan is None
        or floor_plan.mission_id != identity.mission_id
    ):
        return None
    return sha256(
        _MAP_SESSION_KEY_DOMAIN
        + str(identity.mission_id).encode("ascii")
        + b"\0"
        + floor_plan.partition_id_wire
    ).hexdigest()


def _pose_frame_key(
    runtime: MaticRuntimeData,
) -> tuple[SlamMapIdentity | None, str | None, int]:
    """Bind pose reads to a coordinate frame and its revocation epoch."""
    return (
        runtime.slam_map.mission_identity,
        _map_session_key(runtime),
        getattr(runtime.coordinator, "floor_read_generation", 0),
    )


def scene_api_url(entry_id: str) -> str:
    """Return the authenticated scene URL for one config entry."""
    return SCENE_API_URL.format(entry_id=entry_id)


def pose_api_url(entry_id: str) -> str:
    """Return the authenticated live-pose URL for one config entry."""
    return POSE_API_URL.format(entry_id=entry_id)


def delta_api_url(entry_id: str) -> str:
    """Return the authenticated live-delta URL for one config entry."""
    return DELTA_API_URL.format(entry_id=entry_id)


def history_api_url(entry_id: str) -> str:
    """Return the authenticated history catalog URL for one config entry."""
    return HISTORY_API_URL.format(entry_id=entry_id)


def history_scene_api_url(entry_id: str, snapshot_id: str) -> str:
    """Return the authenticated URL for one retained scene."""
    return HISTORY_SCENE_API_URL.format(entry_id=entry_id, snapshot_id=snapshot_id)


def areas_api_url(entry_id: str) -> str:
    """Return the authenticated custom-area workspace URL for one entry."""
    return AREAS_API_URL.format(entry_id=entry_id)


def plans_api_url(entry_id: str) -> str:
    """Return the authenticated cleaning-plan workspace URL for one entry."""
    return PLANS_API_URL.format(entry_id=entry_id)


def catalog_entry_projection(
    entry_id: str,
    runtime: MaticRuntimeData,
    scene_view: MaticSlamSceneView | None = None,
) -> dict[str, object]:
    """Project the bounded catalog row shared by REST and workspace snapshots."""
    health = runtime.slam_map.health
    floor_plan = runtime.coordinator.data.floor_plan
    mapped_floors = floor_plan.mapped_floors if floor_plan is not None else ()
    selected_floor_ordinal = next(
        (
            index
            for index, floor in enumerate(mapped_floors, start=1)
            if floor_plan is not None and floor.mission_id == floor_plan.mission_id
        ),
        None,
    )
    map_identity = runtime.slam_map.mission_identity
    map_floor_ordinal = next(
        (
            index
            for index, floor in enumerate(mapped_floors, start=1)
            if map_identity is not None and floor.mission_id == map_identity.mission_id
        ),
        None,
    )
    floor_plan_coherent = runtime.slam_map.floor_plan_is_current(floor_plan)
    session_verified = getattr(
        runtime.slam_map, "live_session_verified", floor_plan_coherent
    )
    if floor_plan_coherent and session_verified:
        map_block_reason = None
    elif floor_plan is None:
        map_block_reason = "floor_plan_unavailable"
    elif (
        health.photo_tiles == 0
        and health.structure_tiles == 0
        and getattr(health, "bootstrap_state", "not_started")
        in {"complete", "partial", "failed"}
    ):
        map_block_reason = "bootstrap_empty"
    elif map_identity is None or not session_verified:
        map_block_reason = "map_session_unverified"
    else:
        map_block_reason = "floor_plan_mismatch"
    serial_number = runtime.coordinator.data.info.serial_number
    plan_snapshot = runtime.cleaning_plans.snapshot(serial_number)
    telemetry = getattr(runtime.coordinator.data, "telemetry", None)
    return {
        "entry_id": entry_id,
        # Workspace push is withheld pending installed reliability and resource
        # qualification. Map deltas, pose updates and catalog polling remain live.
        "live_workspace_transport_enabled": False,
        "scene_url": scene_api_url(entry_id),
        "delta_url": delta_api_url(entry_id),
        "pose_url": pose_api_url(entry_id),
        "history_url": history_api_url(entry_id),
        "areas_url": areas_api_url(entry_id),
        "plans_url": plans_api_url(entry_id),
        "wifi_heatmap_url": WIFI_HEATMAP_API_URL.format(entry_id=entry_id),
        "history_count": len(_mission_history(runtime)),
        "history_floor_count": len(runtime.slam_history.catalogs_by_mission()),
        "map_revision": (
            scene_view.available_revision(entry_id, runtime)
            if scene_view is not None
            else runtime.slam_map.revision
        ),
        "map_scene_epoch": (
            scene_view.scene_epoch(entry_id) if scene_view is not None else None
        ),
        "map_floor_coherent": floor_plan_coherent,
        "selected_floor_ordinal": selected_floor_ordinal,
        "map_floor_ordinal": map_floor_ordinal,
        "map_session_verified": session_verified,
        "map_session_key": _map_session_key(runtime) if session_verified else None,
        "map_block_reason": map_block_reason,
        "runner_locked": runtime.cleaning_plans.lock(serial_number).locked(),
        "stop_settle_pending": runtime.cleaning_plans.stop_pending(serial_number),
        "active_plan": plan_snapshot.get("active_plan") is not None,
        "native_reconciliation_pending": (
            runtime.cleaning_plans.pending_native_reconciliation(serial_number)
            is not None
        ),
        "native_session_active": getattr(telemetry, "active_cleaning_session", None),
        "map_health": health.state,
        "map_complete": health.complete,
        "map_truncated": health.truncated,
        "stream_failures": health.stream_failures,
        "bootstrap_state": getattr(health, "bootstrap_state", "not_started"),
        "bootstrap_photo_seen": getattr(health, "bootstrap_photo_seen", False),
        "bootstrap_structure_seen": getattr(health, "bootstrap_structure_seen", False),
        "bootstrap_failures": getattr(health, "bootstrap_failures", 0),
    }


def _runtime_for_entry(hass: HomeAssistant, entry_id: str) -> MaticRuntimeData | None:
    entry = hass.config_entries.async_get_entry(entry_id)
    if (
        entry is None
        or entry.domain != DOMAIN
        or entry.state is not ConfigEntryState.LOADED
    ):
        return None
    return cast("MaticConfigEntry", entry).runtime_data


type _SceneKey = tuple[int, SlamMapIdentity | None, FloorPlan | None]


@dataclass(frozen=True, slots=True)
class _CachedScene:
    """One compact payload retained only in process memory."""

    key: _SceneKey
    payload: bytes
    etag: str
    revision: int
    floor_plan_coherent: bool


@dataclass(frozen=True, slots=True)
class _SceneGeneration:
    """A privacy-safe transport generation for one private scene identity."""

    key: _SceneKey
    revision: int


@dataclass(frozen=True, slots=True)
class _EncodedScene:
    """Scene payload and digest produced together off the event loop."""

    payload: bytes
    etag: str


@dataclass(frozen=True, slots=True)
class _CachedPose:
    """One short-lived on-demand pose result."""

    runtime_id: int
    pose: RobotPose | None
    fetched_at: float
    revision: int
    freshness: str
    frame_key: tuple[SlamMapIdentity | None, str | None, int]


class MaticSlamSceneView(HomeAssistantView):
    """Serve a bounded binary point cloud to an authenticated administrator."""

    url = SCENE_API_URL
    name = "api:matic_robot:slam_scene"

    def __init__(self) -> None:
        self._cache: dict[str, _CachedScene] = {}
        self._versions: dict[str, deque[_CachedScene]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._tasks: dict[str, asyncio.Task[_CachedScene | None]] = {}
        self._epochs: dict[str, int] = {}
        self._generations: dict[str, _SceneGeneration] = {}
        self._scene_epochs: dict[str, str] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget all in-memory scene material retained for one robot."""
        self._epochs[entry_id] = self._epochs.get(entry_id, 0) + 1
        if entry_id in self._generations:
            self._scene_epochs[entry_id] = secrets.token_hex(16)
        self._cache.pop(entry_id, None)
        self._versions.pop(entry_id, None)
        task = self._tasks.pop(entry_id, None)
        try:
            current_task = asyncio.current_task()
        except RuntimeError:
            current_task = None
        if task is not None and task is not current_task:
            task.cancel()
        self._locks.pop(entry_id, None)
        self._generations.pop(entry_id, None)

    def _scene_task_done(
        self,
        entry_id: str,
        task: asyncio.Task[_CachedScene | None],
    ) -> None:
        """Release one completed encoder and consume any detached exception."""
        if self._tasks.get(entry_id) is task:
            self._tasks.pop(entry_id, None)
        try:
            task.exception()
        except asyncio.CancelledError:
            pass

    def current_revision(self, entry_id: str, runtime: MaticRuntimeData) -> int:
        """Return a monotonic revision covering SLAM and floor-plan changes."""
        key = _scene_snapshot_key(runtime)
        return self._revision_for_key(entry_id, key)

    def scene_epoch(self, entry_id: str) -> str:
        """Return the opaque identity for this entry's transport revision counter."""
        epoch = self._scene_epochs.get(entry_id)
        if epoch is None:
            epoch = secrets.token_hex(16)
            self._scene_epochs[entry_id] = epoch
        return epoch

    def available_revision(self, entry_id: str, runtime: MaticRuntimeData) -> int:
        """Return the newest safe scene a newly opened panel can receive now."""
        key = _scene_snapshot_key(runtime)
        cached = self._cache.get(entry_id)
        if cached is not None and _scene_snapshot_is_publishable(
            runtime,
            cached.key[1],
            cached.key[2],
            cached.floor_plan_coherent,
        ):
            # Advertise the scene that a newly opened panel can receive now.
            # A live map revision may advance much faster than its expensive
            # binary encoder. The delta request will join the background build
            # and advance from this safe base without blanking the workspace.
            return cached.revision
        return self._revision_for_key(entry_id, key)

    def _revision_for_key(self, entry_id: str, key: _SceneKey) -> int:
        """Return a monotonic transport revision for one captured scene key."""
        current = self._generations.get(entry_id)
        if current is not None and current.key == key:
            return current.revision
        revision = max(
            key[0],
            current.revision + 1 if current is not None else 0,
        )
        self._generations[entry_id] = _SceneGeneration(key, revision)
        return revision

    def scene_for_revision(self, entry_id: str, revision: int) -> _CachedScene | None:
        """Return a recent in-memory base for a delta request."""
        versions = self._versions.get(entry_id, ())
        return next(
            (scene for scene in reversed(versions) if scene.revision == revision),
            None,
        )

    async def async_scene(
        self,
        hass: HomeAssistant,
        entry_id: str,
        runtime: MaticRuntimeData,
        *,
        allow_stale: bool = False,
    ) -> _CachedScene | None:
        """Encode or return the current coherent scene snapshot."""
        if getattr(runtime.slam_map, "live_session_verified", False) is not True:
            self.clear_entry(entry_id)
            return None
        epoch = self._epochs.get(entry_id, 0)
        key = _scene_snapshot_key(runtime)
        cached = self._cache.get(entry_id)
        if cached is not None and cached.key == key:
            return cached
        queued_after = cached
        task = self._tasks.get(entry_id)
        if task is None:
            task = asyncio.create_task(
                self._async_build_scene(
                    hass,
                    entry_id,
                    runtime,
                    epoch,
                    queued_after,
                )
            )
            self._tasks[entry_id] = task
            task.add_done_callback(partial(self._scene_task_done, entry_id))
        if (
            allow_stale
            and cached is not None
            and _scene_snapshot_is_publishable(
                runtime,
                cached.key[1],
                cached.key[2],
                cached.floor_plan_coherent,
            )
        ):
            return cached
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            # A cancelled HTTP waiter must not own and discard an expensive
            # scene build. Internal invalidation cancels the shared task and
            # resolves remaining waiters as unavailable instead.
            request_task = asyncio.current_task()
            if request_task is not None and request_task.cancelling():
                raise
            return None

    async def _async_build_scene(
        self,
        hass: HomeAssistant,
        entry_id: str,
        runtime: MaticRuntimeData,
        epoch: int,
        queued_after: _CachedScene | None,
    ) -> _CachedScene | None:
        """Build and publish one coherent scene independently of HTTP waiters."""
        lock = self._locks.setdefault(entry_id, asyncio.Lock())
        async with lock:
            if (
                self._epochs.get(entry_id, 0) != epoch
                or _runtime_for_entry(hass, entry_id) is not runtime
            ):
                return None
            # A concurrent encoder can populate this cache while this request
            # waits for the lock. Check the live session before returning that
            # newly available payload, not only before entering the lock.
            if getattr(runtime.slam_map, "live_session_verified", False) is not True:
                self.clear_entry(entry_id)
                return None
            cached = self._cache.get(entry_id)
            if cached is not None and cached is not queued_after:
                return cached
            for _attempt in range(SCENE_ENCODE_ATTEMPTS):
                data = runtime.coordinator.data
                map_revision = runtime.slam_map.revision
                identity = runtime.slam_map.mission_identity
                floor_plan = data.floor_plan
                key = (map_revision, identity, floor_plan)
                if (
                    getattr(runtime.slam_map, "live_session_verified", False)
                    is not True
                ):
                    self.clear_entry(entry_id)
                    return None
                cached = self._cache.get(entry_id)
                if cached is not None and cached.key == key:
                    return cached
                entries = runtime.slam_map.entries()
                floor_plan_coherent = runtime.slam_map.floor_plan_is_current(floor_plan)
                try:
                    encoded = await hass.async_add_executor_job(
                        partial(
                            _encode_scene_entries,
                            entries,
                            floor_plan if floor_plan_coherent else None,
                        )
                    )
                except DecodeError:
                    if not _scene_snapshot_is_current(
                        runtime, map_revision, identity, floor_plan
                    ):
                        continue
                    raise
                if (
                    self._epochs.get(entry_id, 0) != epoch
                    or _runtime_for_entry(hass, entry_id) is not runtime
                ):
                    return None
                if not _scene_snapshot_is_publishable(
                    runtime, identity, floor_plan, floor_plan_coherent
                ):
                    continue
                # The encoded bytes represent the captured key, not a newer
                # same-mission pixel refinement that may have arrived while a
                # large scene was encoded. Publish this coherent point-in-time
                # snapshot; the next request will observe and encode the newer
                # key without starving the current request.
                scene_revision = self._revision_for_key(entry_id, key)
                cached = _CachedScene(
                    key,
                    encoded.payload,
                    encoded.etag,
                    scene_revision,
                    floor_plan_coherent,
                )
                self._cache[entry_id] = cached
                versions = self._versions.setdefault(
                    entry_id, deque(maxlen=SCENE_CACHE_REVISIONS)
                )
                if not versions or versions[-1].revision != cached.revision:
                    versions.append(cached)
                return cached
        raise DecodeError("SLAM scene changed before it could be encoded")

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the current local scene, using an ETag for live refreshes."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            cached = await self.async_scene(
                hass,
                entry_id,
                runtime,
                allow_stale=request.headers.get("X-Matic-Prefer-Cached") == "1",
            )
        except DecodeError:
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        if cached is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if request.headers.get("If-None-Match") == cached.etag:
            return web.Response(
                status=HTTPStatus.NOT_MODIFIED,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "ETag": cached.etag,
                    "X-Matic-Revision": str(cached.revision),
                    "X-Matic-Floor-Coherent": _header_bool(cached.floor_plan_coherent),
                },
            )
        return web.Response(
            body=cached.payload,
            content_type="application/vnd.matic.slam-scene",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": cached.etag,
                "X-Matic-Revision": str(cached.revision),
                "X-Matic-Floor-Coherent": _header_bool(cached.floor_plan_coherent),
            },
        )


class MaticSlamDeltaView(HomeAssistantView):
    """Long-poll bounded point-cloud changes for the active scene."""

    url = DELTA_API_URL
    name = "api:matic_robot:slam_delta"

    def __init__(self, scene_view: MaticSlamSceneView) -> None:
        self._scene_view = scene_view

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the next delta or a full scene when its base is unavailable."""
        try:
            since = int(request.query.get("since", ""))
        except ValueError:
            since = -1
        if not 0 <= since < 2**64:
            return web.Response(
                status=HTTPStatus.BAD_REQUEST, headers=PRIVATE_NO_STORE_HEADERS
            )
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            current = await self._scene_view.async_scene(hass, entry_id, runtime)
        except DecodeError:
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        if current is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if current.revision == since:
            changed = asyncio.Event()
            remove_listeners = [runtime.slam_map.async_add_listener(changed.set)]
            coordinator_subscribe = getattr(
                runtime.coordinator, "async_add_listener", None
            )
            if callable(coordinator_subscribe):
                remove_listeners.append(coordinator_subscribe(changed.set))
            try:
                if current.revision == since:
                    try:
                        async with asyncio.timeout(DELTA_WAIT_SECONDS):
                            await changed.wait()
                    except TimeoutError:
                        return web.Response(
                            status=HTTPStatus.NO_CONTENT,
                            headers={
                                **PRIVATE_NO_STORE_HEADERS,
                                "X-Matic-Revision": str(since),
                                "X-Matic-Floor-Coherent": _header_bool(
                                    current.floor_plan_coherent
                                ),
                            },
                        )
            finally:
                for remove_listener in remove_listeners:
                    remove_listener()
        if _runtime_for_entry(hass, entry_id) is not runtime:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            current = await self._scene_view.async_scene(hass, entry_id, runtime)
        except DecodeError:
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        if current is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if current.revision == since:
            return web.Response(
                status=HTTPStatus.NO_CONTENT,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "X-Matic-Revision": str(since),
                    "X-Matic-Floor-Coherent": _header_bool(current.floor_plan_coherent),
                },
            )
        base = self._scene_view.scene_for_revision(entry_id, since)
        delta = None
        if base is not None:
            delta = await hass.async_add_executor_job(
                partial(
                    encode_slam_scene_delta,
                    base.payload,
                    current.payload,
                    base_revision=base.revision,
                    revision=current.revision,
                )
            )
        if _runtime_for_entry(
            hass, entry_id
        ) is not runtime or not _scene_snapshot_is_publishable(
            runtime,
            current.key[1],
            current.key[2],
            current.floor_plan_coherent,
        ):
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if delta is None:
            return web.Response(
                body=current.payload,
                content_type="application/vnd.matic.slam-scene",
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "ETag": current.etag,
                    "X-Matic-Revision": str(current.revision),
                    "X-Matic-Floor-Coherent": _header_bool(current.floor_plan_coherent),
                },
            )
        assert base is not None
        return web.Response(
            body=delta,
            content_type="application/vnd.matic.slam-delta",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": current.etag,
                "X-Matic-Base-Revision": str(base.revision),
                "X-Matic-Revision": str(current.revision),
                "X-Matic-Floor-Coherent": _header_bool(current.floor_plan_coherent),
            },
        )


class MaticSlamHistoryView(HomeAssistantView):
    """List the private, bounded scene timeline for one robot."""

    url = HISTORY_API_URL
    name = "api:matic_robot:slam_history"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return content-free timeline metadata and authenticated scene URLs."""
        runtime = _runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        floor_plan_coherent = runtime.slam_map.floor_plan_is_current(floor_plan)
        current_token = (
            runtime.slam_map.mission_identity.mission_token
            if floor_plan_coherent and runtime.slam_map.mission_identity is not None
            else None
        )
        current_snapshots = _mission_history(runtime) if floor_plan_coherent else ()
        floor_labels = (
            {floor.mission_token: floor.label for floor in floor_plan.mapped_floors}
            if floor_plan is not None
            else {}
        )
        floors = [
            {
                "id": "current",
                "active": True,
                "read_only": False,
                "live_available": floor_plan_coherent,
                "label": (
                    floor_plan.floor_label
                    if floor_plan_coherent and floor_plan is not None
                    else None
                ),
                "snapshots": _history_metadata(entry_id, current_snapshots),
            }
        ]
        history_by_mission = dict(runtime.slam_history.catalogs_by_mission())
        saved_missions = [
            mission_token
            for mission_token in history_by_mission
            if mission_token != current_token
        ]
        saved_missions.extend(
            mapped_floor.mission_token
            for mapped_floor in (
                floor_plan.mapped_floors if floor_plan is not None else ()
            )
            if mapped_floor.mission_token != current_token
            and mapped_floor.mission_token not in history_by_mission
        )
        for saved_ordinal, mission_token in enumerate(saved_missions, start=1):
            mission_snapshots = history_by_mission.get(mission_token, ())
            floors.append(
                {
                    "id": f"saved-{saved_ordinal}",
                    "active": False,
                    "read_only": True,
                    "ordinal": saved_ordinal,
                    "label": floor_labels.get(mission_token),
                    "snapshots": _history_metadata(entry_id, mission_snapshots),
                }
            )
        return self.json(
            {
                "entry_id": entry_id,
                "live_available": floor_plan_coherent,
                "snapshots": _history_metadata(entry_id, current_snapshots),
                "floors": floors,
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


class MaticSlamHistorySceneView(HomeAssistantView):
    """Serve one retained scene to an authenticated administrator."""

    url = HISTORY_SCENE_API_URL
    name = "api:matic_robot:slam_history_scene"

    @require_admin
    async def get(
        self, request: web.Request, entry_id: str, snapshot_id: str
    ) -> web.Response:
        """Return an immutable historical scene without public caching."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        snapshot = next(
            (
                candidate
                for candidate in runtime.slam_history.catalog()
                if candidate.snapshot_id == snapshot_id
                and candidate.mission_token is not None
            ),
            None,
        )
        if snapshot is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        history = runtime.slam_history
        scene = await history.async_scene(
            snapshot_id, mission_token=snapshot.mission_token
        )
        if (
            scene is None
            or _runtime_for_entry(hass, entry_id) is not runtime
            or runtime.slam_history is not history
        ):
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        return web.Response(
            body=scene,
            content_type="application/vnd.matic.slam-scene",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": f'"{snapshot_id}"',
            },
        )


class MaticSlamPoseView(HomeAssistantView):
    """Serve only the current robot marker for lightweight live updates."""

    url = POSE_API_URL
    name = "api:matic_robot:slam_pose"

    def __init__(self, scene_view: MaticSlamSceneView | None = None) -> None:
        self._scene_view = scene_view
        self._cache: dict[str, _CachedPose] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._epochs: dict[str, int] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget exact pose material retained for one robot."""
        self._cache.pop(entry_id, None)
        self._locks.pop(entry_id, None)
        self._epochs[entry_id] = self._epochs.get(entry_id, 0) + 1

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the current position without exposing it to Recorder."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        epoch = self._epochs.get(entry_id, 0)
        frame_key = _pose_frame_key(runtime)
        floor_plan = runtime.coordinator.data.floor_plan
        if floor_plan is None or not runtime.slam_map.floor_plan_is_current(floor_plan):
            return self._unavailable_frame(entry_id, runtime)
        cached = self._cache.get(entry_id)
        now = monotonic()
        if (
            cached is None
            or cached.runtime_id != id(runtime)
            or cached.frame_key != frame_key
            or now - cached.fetched_at >= POSE_CACHE_SECONDS
        ):
            lock = self._locks.setdefault(entry_id, asyncio.Lock())
            async with lock:
                if self._epochs.get(entry_id, 0) != epoch:
                    return web.Response(
                        status=HTTPStatus.NOT_FOUND,
                        headers=PRIVATE_NO_STORE_HEADERS,
                    )
                if _pose_frame_key(runtime) != frame_key:
                    return self._unavailable_frame(entry_id, runtime)
                cached = self._cache.get(entry_id)
                now = monotonic()
                if (
                    cached is None
                    or cached.runtime_id != id(runtime)
                    or cached.frame_key != frame_key
                    or now - cached.fetched_at >= POSE_CACHE_SECONDS
                ):
                    pose: RobotPose | None
                    try:
                        pose = await runtime.client.async_get_pose(
                            expected_mission_id=floor_plan.mission_id
                        )
                        freshness = "live"
                    except MaticError:
                        pose = runtime.coordinator.data.pose
                        freshness = "coordinator_fallback"
                    if (
                        self._epochs.get(entry_id, 0) != epoch
                        or _runtime_for_entry(hass, entry_id) is not runtime
                    ):
                        return web.Response(
                            status=HTTPStatus.NOT_FOUND,
                            headers=PRIVATE_NO_STORE_HEADERS,
                        )
                    if _pose_frame_key(runtime) != frame_key:
                        return self._unavailable_frame(entry_id, runtime)
                    previous_revision = (
                        cached.revision
                        if cached is not None and cached.runtime_id == id(runtime)
                        else 0
                    )
                    cached = _CachedPose(
                        id(runtime),
                        pose,
                        monotonic(),
                        previous_revision + 1,
                        freshness,
                        frame_key,
                    )
                    self._cache[entry_id] = cached
        data = runtime.coordinator.data
        floor_plan_coherent = runtime.slam_map.floor_plan_is_current(data.floor_plan)
        pose_now = time()
        native_age = pose_observation_age_seconds(cached.pose, now=pose_now)
        # Transport fallback cannot certify a current position. Keep room-only
        # presence available without moving an old point onto the current map.
        visible_pose = cached.pose if cached.freshness == "live" else None
        position = (
            resolve_robot_map_position(
                data.floor_plan,
                visible_pose,
                data.operational.current_area,
                now=pose_now,
            )
            if floor_plan_coherent
            else None
        )
        source = (
            robot_location_source(
                data.floor_plan,
                visible_pose,
                data.operational.current_area,
                now=pose_now,
            )
            if floor_plan_coherent
            else "unavailable"
        )
        return self.json(
            {
                "position": list(position[:2]) if position is not None else None,
                "heading": (
                    round(visible_pose.heading, 4)
                    if position is not None
                    and visible_pose is not None
                    and visible_pose.heading is not None
                    else None
                ),
                "source": source,
                "revision": runtime.slam_map.revision,
                "scene_revision": (
                    self._scene_view.current_revision(entry_id, runtime)
                    if self._scene_view is not None
                    else None
                ),
                "scene_epoch": (
                    self._scene_view.scene_epoch(entry_id)
                    if self._scene_view is not None
                    else None
                ),
                "map_floor_coherent": floor_plan_coherent,
                "pose_revision": cached.revision,
                "pose_age_seconds": (
                    round(native_age, 3) if native_age is not None else None
                ),
                "pose_fetch_age_seconds": round(
                    max(0.0, monotonic() - cached.fetched_at), 3
                ),
                "pose_observation_current": position is not None,
                # Compatibility enum describes transport; native observation
                # age and admission above determine whether a point exists.
                "pose_freshness": cached.freshness,
                "map_session_key": (
                    _map_session_key(runtime) if floor_plan_coherent else None
                ),
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )

    def _unavailable_frame(
        self, entry_id: str, runtime: MaticRuntimeData
    ) -> web.Response:
        """Clear a previously displayed marker after a coordinate-frame revocation."""
        return self.json(
            {
                "position": None,
                "heading": None,
                "source": "unavailable",
                "revision": runtime.slam_map.revision,
                "scene_revision": (
                    self._scene_view.current_revision(entry_id, runtime)
                    if self._scene_view is not None
                    else None
                ),
                "scene_epoch": (
                    self._scene_view.scene_epoch(entry_id)
                    if self._scene_view is not None
                    else None
                ),
                "map_floor_coherent": False,
                "pose_revision": 0,
                "pose_age_seconds": None,
                "pose_fetch_age_seconds": None,
                "pose_observation_current": False,
                "pose_freshness": "coordinator_fallback",
                "map_session_key": None,
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


class MaticSlamCatalogView(HomeAssistantView):
    """List private scene endpoints for loaded robots to administrators only."""

    url = CATALOG_API_URL
    name = "api:matic_robot:slam_entries"

    def __init__(self, scene_view: MaticSlamSceneView | None = None) -> None:
        """Initialize the catalog with its optional scene cache view."""
        self._scene_view = scene_view

    @require_admin
    async def get(self, request: web.Request) -> web.Response:
        """Return non-persistent discovery data for the admin-only map panel."""
        hass = request.app[KEY_HASS]
        entries = []
        for entry in hass.config_entries.async_entries(DOMAIN):
            runtime = _runtime_for_entry(hass, entry.entry_id)
            if runtime is None:
                continue
            health = runtime.slam_map.health
            projection = catalog_entry_projection(
                entry.entry_id,
                runtime,
                self._scene_view,
            )
            entries.append(
                {
                    **projection,
                    "cached_tiles": health.photo_tiles,
                    "structural_tiles": health.structure_tiles,
                    "overlapping_tiles": health.overlapping_tiles,
                    "layer_overlap": round(health.layer_overlap, 4),
                    "dropped_photo_tiles": health.dropped_photo_tiles,
                    "dropped_structure_tiles": health.dropped_structure_tiles,
                    "invalid_tiles": health.invalid_tiles,
                    "stream_state": health.stream_state,
                    "stream_failures": health.stream_failures,
                    "bootstrap_state": getattr(
                        health, "bootstrap_state", "not_started"
                    ),
                    "bootstrap_photo_seen": getattr(
                        health, "bootstrap_photo_seen", False
                    ),
                    "bootstrap_structure_seen": getattr(
                        health, "bootstrap_structure_seen", False
                    ),
                    "bootstrap_failures": getattr(health, "bootstrap_failures", 0),
                }
            )
        return self.json({"entries": entries}, headers=PRIVATE_NO_STORE_HEADERS)


class MaticAreasView(HomeAssistantView):
    """Manage map-bound custom areas inside the private map workspace."""

    url = AREAS_API_URL
    name = "api:matic_robot:areas"

    @staticmethod
    def _rooms(floor_plan: FloorPlan | None) -> list[dict[str, object]]:
        """Project rooms from one explicit floor-plan snapshot."""
        if floor_plan is None:
            return []
        return [
            {
                "room_id": room.id,
                "name": room.name,
                "boundary": [list(point) for point in room.boundary],
            }
            for room in floor_plan.rooms
        ]

    @staticmethod
    def _zones(
        zones: tuple[MapZone, ...],
        floor_plan: FloorPlan,
        areas: list[dict[str, Any]],
    ) -> list[dict[str, object]]:
        """Project the robot's zones on this map and what each one overlaps."""
        return [
            {
                "kind": zone.kind,
                "outline": [list(point) for point in zone.outline],
                "holes": [[list(point) for point in hole] for hole in zone.holes],
                "room_ids": [
                    room.id
                    for room in floor_plan.rooms
                    if zone_overlaps_polygon(zone, room.boundary)
                ],
                "area_ids": [
                    area["id"]
                    for area in areas
                    if any(
                        zone_overlaps_circle(
                            zone,
                            (float(circle["x"]), float(circle["y"])),
                            float(circle["radius"]),
                        )
                        for circle in area["circles"]
                    )
                ],
            }
            for zone in zones
            if zone.mission_id == floor_plan.mission_id
        ]

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the live map geometry and private saved-area definitions."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        if floor_plan is None or not runtime.slam_map.floor_plan_is_current(floor_plan):
            return web.Response(
                status=HTTPStatus.CONFLICT,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "X-Matic-Areas-Conflict": "map-rechecking",
                },
            )
        if not floor_plan.rooms:
            return web.Response(
                status=HTTPStatus.CONFLICT,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "X-Matic-Areas-Conflict": "no-rooms",
                },
            )
        serial_number = str(runtime.coordinator.data.info.serial_number)
        areas = []
        room_geometry = None
        for area_id, area in runtime.cleaning_plans.areas(serial_number).items():
            uses_indexed_binding = area_binding_needs_geometry_index(area)
            if uses_indexed_binding and room_geometry is None:
                room_geometry = RoomGeometryIndex(self._rooms(floor_plan))
            status = area_binding_status(area, floor_plan, room_geometry=room_geometry)
            if status is AreaBindingStatus.GEOMETRY_CHANGED and room_geometry is None:
                room_geometry = RoomGeometryIndex(self._rooms(floor_plan))
            can_rebind = area_binding_allows_review(
                area,
                floor_plan,
                status=status,
                room_geometry=room_geometry,
                circles_already_validated=uses_indexed_binding,
            )
            areas.append(
                {
                    "id": area_id,
                    "name": str(area.get("name", area_id)),
                    "circles": area.get("circles", [])
                    if status is AreaBindingStatus.CURRENT or can_rebind
                    else [],
                    **(
                        {"outline": area["outline"]}
                        if area.get("outline") is not None
                        and (status is AreaBindingStatus.CURRENT or can_rebind)
                        else {}
                    ),
                    "cleaning_mode": area.get(
                        "cleaning_mode", CleaningMode.VACUUM.value
                    ),
                    "coverage_setting": area.get(
                        "coverage_setting", CoverageSetting.OPTIMAL.value
                    ),
                    "status": status.value,
                    "can_rebind": can_rebind,
                }
            )
        return self.json(
            {
                "scene_url": scene_api_url(entry_id),
                "rooms": self._rooms(floor_plan),
                "areas": areas,
                "selected_area": runtime.cleaning_plans.selected_area(serial_number),
                "zones": self._zones(
                    runtime.coordinator.data.telemetry.zones, floor_plan, areas
                ),
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )

    @require_admin
    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        """Create or replace one validated area on the current map."""
        if request.content_length is not None and request.content_length > 131_072:
            return web.Response(
                status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        map_identity = runtime.slam_map.mission_identity
        if (
            floor_plan is None
            or not floor_plan.rooms
            or map_identity is None
            or not runtime.slam_map.floor_plan_is_current(floor_plan)
        ):
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            body = await request.json(loads=json.loads)
            if (
                _runtime_for_entry(hass, entry_id) is not runtime
                or runtime.coordinator.data.floor_plan != floor_plan
                or runtime.slam_map.mission_identity != map_identity
                or not runtime.slam_map.floor_plan_is_current(floor_plan)
            ):
                return web.Response(
                    status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
                )
            if not isinstance(body, dict):
                raise ValueError
            name = str(body["name"]).strip()
            if not 1 <= len(name) <= 128:
                raise ValueError
            rooms = self._rooms(floor_plan)
            circles = AreaGeometry(rooms).validate(body["circles"])
            outline = validate_outline(body.get("outline"), circles)
            cleaning_mode = CleaningMode(str(body["cleaning_mode"]))
            coverage_setting = CoverageSetting(str(body["coverage_setting"]))
            binding = binding_for_area(floor_plan, circles)
        except KeyError, TypeError, ValueError, probatio.Invalid:
            return web.Response(
                status=HTTPStatus.BAD_REQUEST, headers=PRIVATE_NO_STORE_HEADERS
            )
        serial_number = str(runtime.coordinator.data.info.serial_number)
        saved = runtime.cleaning_plans.areas(serial_number)
        requested_id = body.get("area_id")
        if requested_id is None:
            area_id = slugify(name)
            if not area_id or area_id in saved:
                return web.Response(
                    status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
                )
        else:
            area_id = str(requested_id)
            if area_id not in saved:
                return web.Response(
                    status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
                )
        if any(
            key != area_id and str(value.get("name", key)).casefold() == name.casefold()
            for key, value in saved.items()
        ):
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )

        def validate_commit() -> None:
            """Keep request identities valid through the area metadata commit."""
            if (
                _runtime_for_entry(hass, entry_id) is not runtime
                or runtime.coordinator.data.floor_plan != floor_plan
                or runtime.slam_map.mission_identity != map_identity
                or not runtime.slam_map.floor_plan_is_current(floor_plan)
            ):
                raise AreaSavePreconditionError
            current_areas = runtime.cleaning_plans.areas(serial_number)
            if requested_id is None:
                if area_id in current_areas:
                    raise AreaSavePreconditionError
            elif area_id not in current_areas:
                raise AreaSavePreconditionError(not_found=True)
            if any(
                key != area_id
                and str(value.get("name", key)).casefold() == name.casefold()
                for key, value in current_areas.items()
            ):
                raise AreaSavePreconditionError

        try:
            await runtime.cleaning_plans.async_save_area(
                serial_number,
                area_id,
                {
                    "schema_version": AREA_SCHEMA_VERSION,
                    "name": name,
                    "circles": circles,
                    **({"outline": outline} if outline is not None else {}),
                    "cleaning_mode": cleaning_mode.value,
                    "coverage_setting": coverage_setting.value,
                    "map_binding": binding,
                },
                precondition=validate_commit,
            )
        except AreaSavePreconditionError as err:
            return web.Response(
                status=(HTTPStatus.NOT_FOUND if err.not_found else HTTPStatus.CONFLICT),
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        except MetadataAdmissionClosedError:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        except AreaFramePointLimitError:
            return self.json(
                {"error": "area_boundary_point_limit"},
                status_code=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        return self.json(
            {"id": area_id},
            headers=PRIVATE_NO_STORE_HEADERS,
        )

    @require_admin
    async def delete(self, request: web.Request, entry_id: str) -> web.Response:
        """Delete one saved custom area by its stable identifier."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        area_id = str(request.query.get("area_id", ""))
        serial_number = str(runtime.coordinator.data.info.serial_number)
        if area_id not in runtime.cleaning_plans.areas(serial_number):
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            await runtime.cleaning_plans.async_delete_area(serial_number, area_id)
        except MetadataAdmissionClosedError:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        except AreaInUseError as err:
            # Removing the area would leave these plans with nothing to clean.
            return self.json(
                {"plans": list(err.plan_names)},
                status_code=HTTPStatus.CONFLICT,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "X-Matic-Areas-Conflict": "plan-would-be-empty",
                },
            )
        return web.Response(
            status=HTTPStatus.NO_CONTENT, headers=PRIVATE_NO_STORE_HEADERS
        )


class MaticPlansView(HomeAssistantView):
    """Expose saved plans and current room choices to the private workspace."""

    url = PLANS_API_URL
    name = "api:matic_robot:plans"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return a bounded plan editor model for one loaded robot."""
        hass = request.app[KEY_HASS]
        runtime = _runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        if floor_plan is None or not runtime.slam_map.floor_plan_is_current(floor_plan):
            headers = {
                **PRIVATE_NO_STORE_HEADERS,
                "X-Matic-Plans-Conflict": "map-rechecking",
            }
            return web.Response(status=HTTPStatus.CONFLICT, headers=headers)
        if not floor_plan.rooms:
            headers = {
                **PRIVATE_NO_STORE_HEADERS,
                "X-Matic-Plans-Conflict": "no-rooms",
            }
            return web.Response(status=HTTPStatus.CONFLICT, headers=headers)
        serial_number = str(runtime.coordinator.data.info.serial_number)
        floor_token = plan_floor_token(floor_plan)
        current_rooms = {room.id: room for room in floor_plan.rooms}
        room_map = {room.id: room.name for room in floor_plan.rooms}
        room_identities: dict[str, str] = {}
        identity_error = False
        for room in floor_plan.rooms:
            try:
                room_identities[room.id] = room_cadence_identity(floor_plan, room.id)
            except ValueError:
                identity_error = True

        def next_run_preview(plan_id: str) -> dict[str, object]:
            """Project the authoritative next run without changing plan state."""
            if identity_error:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "cadence_identity_unavailable",
                }
            previewer = getattr(runtime.cleaning_plans, "preview", None)
            if not callable(previewer):
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "preview_unavailable",
                }
            try:
                preview = previewer(
                    serial_number,
                    room_map,
                    plan_id,
                    floor_token=floor_token,
                    room_identities=room_identities,
                    floor_plan=floor_plan,
                )
                preview_entries = preview.get("entries")
                if not isinstance(preview_entries, list):
                    preview_entries = [
                        {"kind": "room", **room} for room in preview["rooms"]
                    ]
                if not preview_entries:
                    raise ValueError("plan has no rooms")
                projected_entries = [
                    {
                        "kind": "area",
                        "area_id": str(entry["area_id"]),
                        "name": str(entry["name"]),
                        "cleaning_mode": str(entry["cleaning_mode"]),
                        "coverage_setting": str(entry["coverage_setting"]),
                        # Areas earn no cadence: they run every time.
                        "cadence_reasons": [],
                    }
                    if entry.get("kind") == "area"
                    else {
                        "kind": "room",
                        "room_id": str(entry["room_id"]),
                        "name": str(entry["name"]),
                        "cleaning_mode": str(entry["cleaning_mode"]),
                        "coverage_setting": str(entry["coverage_setting"]),
                        "cadence_reasons": [
                            reason
                            for reason, due_key in (
                                ("mop_due", "mop_due"),
                                ("coverage_due", "coverage_due"),
                            )
                            if entry.get("cadence", {}).get(due_key) is True
                        ],
                    }
                    for entry in preview_entries
                ]
                projected_rooms = [
                    {key: value for key, value in entry.items() if key != "kind"}
                    for entry in projected_entries
                    if entry["kind"] == "room"
                ]
                # Smart Stop runs each room in its own native mission so a
                # room-boundary STOP cannot allow the next room to start.
                # Custom areas remain separate missions either way.
                boundaries = entry_mission_boundaries(
                    projected_entries,
                    single_room_missions=preview.get("finish_current_room") is True,
                )
            except RoomSequenceLimitError:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "plan_room_limit",
                }
            except PlanAreaMissingError:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "area_missing",
                }
            except PlanAreaMapChangedError:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "area_map_changed",
                }
            except (KeyError, TypeError, ValueError) as err:
                message = str(err).casefold()
                blocker = (
                    "coverage_requires_vacuum"
                    if isinstance(err, CoverageCadenceRequiresVacuumError)
                    else "plan_disabled"
                    if "disabled" in message
                    else "plan_has_no_rooms"
                    if "no rooms" in message
                    else "cadence_identity_changed"
                    if "different map" in message or "identity" in message
                    else "shared_schedule_unavailable"
                    if "shared room cadence" in message and "unavailable" in message
                    else "cadence_progress_unverified"
                    if "progress is unverified" in message
                    else "invalid_cadence_policy"
                    if "cadence" in message
                    else "invalid_plan"
                )
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": blocker,
                }
            return {
                "rooms": projected_rooms,
                "entries": projected_entries,
                "mission_boundaries": boundaries,
                "preview_token": saved_plan_preview_token(
                    preview,
                    entry_id=entry_id,
                    floor_token=floor_token,
                    room_identities=room_identities,
                ),
                "blocker": None,
            }

        def next_run_estimate(preview: dict[str, object]) -> int | None:
            """Estimate the previewed run from the stored per-room durations."""
            estimator = getattr(
                runtime.cleaning_plans, "next_run_estimate_seconds", None
            )
            if preview["blocker"] is not None or not callable(estimator):
                return None
            entries = cast(list[dict[str, str]], preview["entries"])
            if any(entry["kind"] == "area" for entry in entries):
                # The robot keeps no duration history for a custom area.
                return None
            rooms = cast(list[dict[str, str]], preview["rooms"])
            return cast(
                int | None,
                estimator(
                    serial_number,
                    [
                        (
                            room["room_id"],
                            room["cleaning_mode"],
                            room["coverage_setting"],
                        )
                        for room in rooms
                    ],
                ),
            )

        def cadence_state(
            plan_id: str,
            room_id: str,
            name: str,
            cleaning_mode: str,
            coverage_setting: str,
            *,
            use_shared_schedule: bool = False,
        ) -> dict[str, object]:
            project = getattr(runtime.cleaning_plans, "cadence_editor_state", None)
            if not callable(project):
                return {"cadence": None}
            try:
                identity = room_cadence_identity(floor_plan, room_id)
            except ValueError:
                return {
                    "cadence": None,
                    "cadence_progress": None,
                    "cadence_reasons": ["room_not_on_current_map"],
                }
            return cast(
                dict[str, object],
                project(
                    serial_number,
                    plan_id,
                    CleaningRoom(room_id, name, cleaning_mode, coverage_setting),
                    floor_token=floor_token,
                    identity=identity,
                    use_shared_schedule=use_shared_schedule,
                ),
            )

        saved_areas: Mapping[str, object] | None = None

        def area_entry_name(area_id: str) -> str:
            """Name an area entry, falling back to its ID once it is gone."""
            nonlocal saved_areas
            if saved_areas is None:
                saved_areas = runtime.cleaning_plans.areas(serial_number)
            area = saved_areas.get(area_id)
            name = area.get("name") if isinstance(area, Mapping) else None
            return name if isinstance(name, str) else area_id

        plans = []
        for plan_id, plan in runtime.cleaning_plans.plans(serial_number).items():
            raw_rooms = plan.get("rooms", [])
            rooms = []
            for room in raw_rooms:
                if not isinstance(room, dict) or not room.get("room_id"):
                    continue
                room_id = str(room["room_id"])
                cleaning_mode = str(
                    room.get("cleaning_mode", CleaningMode.VACUUM.value)
                )
                coverage_setting = str(
                    room.get("coverage_setting", CoverageSetting.OPTIMAL.value)
                )
                plan_room_projection: dict[str, object] = {
                    "room_id": str(room.get("room_id", "")),
                    "cleaning_mode": cleaning_mode,
                    "coverage_setting": coverage_setting,
                }
                current = current_rooms.get(room_id)
                if current is not None:
                    cadence = cadence_state(
                        plan_id,
                        room_id,
                        current.name,
                        cleaning_mode,
                        coverage_setting,
                    )
                    cadence_reasons = cadence.get("cadence_reasons", [])
                    if cadence["cadence"] is not None or cadence_reasons:
                        plan_room_projection.update(cadence)
                rooms.append(plan_room_projection)
            try:
                entries = plan_entries(plan)
            except ValueError:
                # The preview names the problem; list the rooms that remain.
                entries = plan_entries({"rooms": raw_rooms})
            # Stored area entries carry only an ID; name them for the editor.
            entries = [
                {**entry, "name": area_entry_name(entry["area_id"])}
                if entry["kind"] == "area"
                else entry
                for entry in entries
            ]
            preview = next_run_preview(plan_id)
            plans.append(
                {
                    "id": plan_id,
                    "name": str(plan.get("name", plan_id)),
                    "enabled": bool(plan.get("enabled", True)),
                    "run_behavior": str(plan.get("run_behavior", "intelligent")),
                    "rooms": rooms,
                    "room_order": [
                        str(room_id) for room_id in plan.get("room_order", [])
                    ],
                    "entries": entries,
                    "return_to_base": bool(plan.get("return_to_base", True)),
                    "finish_current_room": bool(plan.get("finish_current_room", False)),
                    "finish_current_room_threshold": int(
                        plan.get("finish_current_room_threshold", 50)
                    ),
                    "next_run_preview": preview,
                    "next_run_estimate_seconds": next_run_estimate(preview),
                }
            )
        selected_plan = runtime.cleaning_plans.snapshot(serial_number).get(
            "selected_plan"
        )
        room_projections: list[dict[str, object]] = []
        for room in floor_plan.rooms:
            workspace_room_projection: dict[str, object] = {
                "room_id": room.id,
                "name": room.name,
            }
            delete_token = getattr(
                runtime.cleaning_plans, "shared_cadence_delete_token", None
            )
            if callable(delete_token):
                token = delete_token(serial_number, room.id)
                if (
                    isinstance(token, str)
                    and len(token) == 64
                    and all(char in "0123456789abcdef" for char in token)
                ):
                    workspace_room_projection["shared_cadence_delete_token"] = token
            cadence = cadence_state(
                "quick_clean",
                room.id,
                room.name,
                CleaningMode.VACUUM.value,
                CoverageSetting.OPTIMAL.value,
                use_shared_schedule=True,
            )
            if cadence["cadence"] is not None:
                workspace_room_projection.update(
                    {
                        "shared_cadence": cadence["cadence"],
                        "shared_cadence_progress": cadence["cadence_progress"],
                        "shared_cadence_reasons": cadence["cadence_reasons"],
                    }
                )
            elif cadence.get("cadence_reasons"):
                workspace_room_projection["shared_cadence_reasons"] = cadence[
                    "cadence_reasons"
                ]
            room_projections.append(workspace_room_projection)
        return self.json(
            {
                "rooms": room_projections,
                "plans": plans[:256],
                "selected_plan": selected_plan,
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


def _encode_scene_entries(
    entries: tuple[HermesCollectionEntry, ...], floor_plan: FloorPlan | None
) -> _EncodedScene:
    """Decode a stable store snapshot and encode it off the event loop."""
    payload = encode_slam_scene(
        tuple(decode_slam_tile(entry) for entry in entries),
        floor_plan=floor_plan,
    )
    return _EncodedScene(payload, f'"{sha256(payload).hexdigest()[:24]}"')


def _scene_snapshot_is_current(
    runtime: MaticRuntimeData,
    revision: int,
    identity: SlamMapIdentity | None,
    floor_plan: FloorPlan | None,
) -> bool:
    """Return whether an encoded snapshot still matches live map identity."""
    return runtime.slam_map.revision == revision and _scene_snapshot_is_publishable(
        runtime,
        identity,
        floor_plan,
        runtime.slam_map.floor_plan_is_current(floor_plan),
    )


def _scene_snapshot_is_publishable(
    runtime: MaticRuntimeData,
    identity: SlamMapIdentity | None,
    floor_plan: FloorPlan | None,
    floor_plan_coherent: bool,
) -> bool:
    """Return whether a captured point-in-time scene remains safe to publish."""
    return (
        getattr(runtime.slam_map, "live_session_verified", False) is True
        and runtime.slam_map.mission_identity == identity
        and runtime.coordinator.data.floor_plan == floor_plan
        and runtime.slam_map.floor_plan_is_current(floor_plan) == floor_plan_coherent
    )


def _scene_snapshot_key(runtime: MaticRuntimeData) -> _SceneKey:
    """Return the complete private identity of the currently renderable scene."""
    return (
        runtime.slam_map.revision,
        runtime.slam_map.mission_identity,
        runtime.coordinator.data.floor_plan,
    )


def _header_bool(value: bool) -> str:
    return "1" if value else "0"


def _mission_history(
    runtime: MaticRuntimeData,
) -> tuple[SlamHistorySnapshot, ...]:
    """Return retained scenes proven to belong to the active SLAM mission."""
    identity = runtime.slam_map.mission_identity
    if identity is None:
        return ()
    return runtime.slam_history.catalog_for_mission(identity.mission_token)


def _history_metadata(
    entry_id: str, snapshots: tuple[SlamHistorySnapshot, ...]
) -> list[dict[str, object]]:
    """Return bounded, content-free history metadata for the admin UI."""
    return [
        {
            "id": snapshot.snapshot_id,
            "created_at": snapshot.created_at.isoformat(),
            "revision": snapshot.revision,
            "point_count": snapshot.point_count,
            "scene_url": history_scene_api_url(entry_id, snapshot.snapshot_id),
        }
        for snapshot in snapshots
    ]
