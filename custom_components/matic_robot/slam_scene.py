"""Authenticated local HTTP views for the private 3D SLAM studio."""

from __future__ import annotations

import asyncio
import secrets
from collections import deque
from dataclasses import dataclass
from functools import partial
from hashlib import sha256
from http import HTTPStatus
from time import monotonic, time
from typing import TYPE_CHECKING

from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.exceptions import MaticError
from .client.floor_plan import (
    pose_observation_age_seconds,
    resolve_robot_map_position,
    robot_location_source,
)
from .client.models import (
    CleaningSessionRecord,
    FloorPlan,
    HermesCollectionEntry,
    RobotPose,
)
from .client.slam_map import decode_slam_tile, encode_slam_scene
from .const import DOMAIN
from .http import (
    CATALOG_API_URL,
    DELTA_API_URL,
    FLOOR_LAYERS_API_URL,
    HISTORY_API_URL,
    HISTORY_SCENE_API_URL,
    POSE_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    RUNS_API_URL,
    SCENE_API_URL,
    WIFI_HEATMAP_API_URL,
    areas_api_url,
    delta_api_url,
    history_api_url,
    history_scene_api_url,
    plans_api_url,
    pose_api_url,
    runtime_for_entry,
    scene_api_url,
)
from .run_history import RUN_HISTORY_LIMIT, RunTrails
from .slam_delta import encode_slam_scene_delta
from .slam_map_store import SlamMapIdentity

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticRuntimeData
    from .slam_history import SlamHistorySnapshot

RUNS_NATIVE_READ_SECONDS = 15
POSE_CACHE_SECONDS = 1.0
SCENE_ENCODE_ATTEMPTS = 2
SCENE_CACHE_REVISIONS = 2
DELTA_WAIT_SECONDS = 5


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


def observe_run_trail(
    runtime: MaticRuntimeData, position: tuple[float, float] | None
) -> None:
    """Give the trail recorder one verified position, or only the run state."""
    trails: RunTrails | None = getattr(runtime, "run_trails", None)
    if trails is None:
        return
    data = runtime.coordinator.data
    trails.observe(
        run_id=runtime.cleaning_plans.ledger.active_run_id(
            str(data.info.serial_number)
        ),
        native_active=data.telemetry.active_cleaning_session,
        map_key=_map_session_key(runtime),
        point=position,
    )


def observe_coordinator_trail(runtime: MaticRuntimeData) -> None:
    """Record the coordinator's own pose read, which also closes finished runs."""
    data = runtime.coordinator.data
    position = (
        resolve_robot_map_position(data.floor_plan, data.pose, None)
        if runtime.slam_map.floor_plan_is_current(data.floor_plan)
        else None
    )
    observe_run_trail(runtime, position[:2] if position is not None else None)


def _pose_frame_key(
    runtime: MaticRuntimeData,
) -> tuple[SlamMapIdentity | None, str | None, int]:
    """Bind pose reads to a coordinate frame and its revocation epoch."""
    return (
        runtime.slam_map.mission_identity,
        _map_session_key(runtime),
        getattr(runtime.coordinator, "floor_read_generation", 0),
    )


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
    plan_snapshot = runtime.cleaning_plans.ledger.snapshot(serial_number)
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
        "floor_layers_url": FLOOR_LAYERS_API_URL.format(entry_id=entry_id),
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
        "runner_locked": runtime.cleaning_plans.control.lock(serial_number).locked(),
        "stop_settle_pending": runtime.cleaning_plans.control.stop_pending(
            serial_number
        ),
        "active_plan": plan_snapshot.get("active_plan") is not None,
        "native_reconciliation_pending": (
            runtime.cleaning_plans.ledger.pending_native_reconciliation(serial_number)
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
                or runtime_for_entry(hass, entry_id) is not runtime
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
                    or runtime_for_entry(hass, entry_id) is not runtime
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
        runtime = runtime_for_entry(hass, entry_id)
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
        runtime = runtime_for_entry(hass, entry_id)
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
        if runtime_for_entry(hass, entry_id) is not runtime:
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
        if runtime_for_entry(
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
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
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
        runtime = runtime_for_entry(hass, entry_id)
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
            or runtime_for_entry(hass, entry_id) is not runtime
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
        runtime = runtime_for_entry(hass, entry_id)
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
                        or runtime_for_entry(hass, entry_id) is not runtime
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
        if cached.freshness == "live":
            observe_run_trail(runtime, position[:2] if position is not None else None)
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
            runtime = runtime_for_entry(hass, entry.entry_id)
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


class MaticRunHistoryView(HomeAssistantView):
    """Serve recent cleaning runs and their trails to the private workspace."""

    url = RUNS_API_URL
    name = "api:matic_robot:runs"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the run list, or one trail when ``trail`` names it."""
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        trails: RunTrails | None = getattr(runtime, "run_trails", None)
        if runtime is None or trails is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        map_key = _map_session_key(runtime)
        trail_id = request.query.get("trail")
        if trail_id is not None:
            segments = trails.segments(trail_id, map_key)
            if segments is None:
                return web.Response(
                    status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
                )
            return self.json(
                {
                    "trail": trail_id,
                    "map_session_key": map_key,
                    "segments": [
                        [list(point) for point in segment] for segment in segments
                    ],
                },
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        native: tuple[CleaningSessionRecord, ...] = ()
        robot_history = True
        try:
            async with asyncio.timeout(RUNS_NATIVE_READ_SECONDS):
                native = await runtime.client.async_get_cleaning_session_records()
        except MaticError, TimeoutError:
            robot_history = False
        serial_number = str(runtime.coordinator.data.info.serial_number)
        runs = runtime.cleaning_plans.ledger.run_history(serial_number, native)
        for run in runs:
            run["trail"] = (
                trails.trail_id(map_key, run_id=run["id"])
                if run["source"] == "home_assistant"
                else trails.trail_id(
                    map_key,
                    window=(run["started_at"], run["ended_at"]),
                )
                if run["started_at"] is not None
                else None
            )
        return self.json(
            {
                "entry_id": entry_id,
                "map_session_key": map_key,
                "robot_history": robot_history,
                "runs": runs[: RUN_HISTORY_LIMIT * 2],
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )
