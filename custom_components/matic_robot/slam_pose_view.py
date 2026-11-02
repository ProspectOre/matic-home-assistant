"""Serve current floor-scoped robot position to the private map."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from http import HTTPStatus
from time import monotonic, time
from typing import TYPE_CHECKING

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.exceptions import MaticError
from .client.floor_plan import (
    pose_observation_age_seconds,
    resolve_robot_map_position,
    robot_location_source,
)
from .client.models import RobotPose
from .http import POSE_API_URL, PRIVATE_NO_STORE_HEADERS, runtime_for_entry
from .slam_map_store import SlamMapIdentity
from .slam_scene import MaticSlamSceneView
from .slam_view_data import _map_session_key, _pose_frame_key, observe_run_trail

if TYPE_CHECKING:
    from . import MaticRuntimeData

POSE_CACHE_SECONDS = 1.0


@dataclass(frozen=True, slots=True)
class _CachedPose:
    """One short-lived on-demand pose result."""

    runtime_id: int
    pose: RobotPose | None
    fetched_at: float
    revision: int
    freshness: str
    frame_key: tuple[SlamMapIdentity | None, str | None, int]


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
