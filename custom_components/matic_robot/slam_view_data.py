"""Content-free identities and projections shared by private map views."""

from __future__ import annotations

from hashlib import sha256
from time import time
from typing import TYPE_CHECKING

from .client.floor_plan import (
    pose_observation_age_seconds,
    resolve_robot_map_position,
    robot_location_source,
)
from .http import (
    FLOOR_LAYERS_API_URL,
    WIFI_HEATMAP_API_URL,
    areas_api_url,
    history_api_url,
    plans_api_url,
    scene_api_url,
)
from .map_schema import CatalogEntry, MapBlockReason
from .run_history import RunTrails

if TYPE_CHECKING:
    from . import MaticRuntimeData
    from .slam_scene import MaticSlamSceneView

_MAP_SESSION_KEY_DOMAIN = b"matic-map-session-v1\0"


def _map_session_key(runtime: MaticRuntimeData) -> str | None:
    """Return a browser-safe identity for one verified SLAM coordinate frame."""
    identity = runtime.slam_map.mission_identity
    floor_plan = runtime.session.floor.value
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


def observe_trail(runtime: MaticRuntimeData) -> None:
    """Record the newest pose on the current map, and close a finished run."""
    trails: RunTrails | None = getattr(runtime, "run_trails", None)
    if trails is None:
        return
    session = runtime.session
    floor_plan = (
        session.floor.value
        if runtime.slam_map.floor_plan_is_current(session.floor.value)
        else None
    )
    pose = session.pose_on(floor_plan)
    position = resolve_robot_map_position(floor_plan, pose, None)
    trails.observe(
        run_id=runtime.cleaning_plans.ledger.active_run_id(
            str(session.info.serial_number)
        ),
        native_active=session.state.value.session_active,
        map_key=_map_session_key(runtime),
        point=position[:2] if position is not None else None,
        observed_at=pose.observed_at if pose is not None else None,
    )


def pose_projection(
    entry_id: str,
    runtime: MaticRuntimeData,
    scene_view: MaticSlamSceneView | None = None,
) -> dict[str, object]:
    """Project the robot's position on the current map, as the workspace pushes it.

    The scene revision and epoch let the browser tell a pose that predates the
    map it holds from one that revokes it.
    """
    session = runtime.session
    coherent = runtime.slam_map.floor_plan_is_current(session.floor.value)
    floor_plan = session.floor.value if coherent else None
    pose = runtime.session.pose_on(floor_plan)
    now = time()
    position = resolve_robot_map_position(floor_plan, pose, None, now=now)
    age = pose_observation_age_seconds(pose, now=now)
    return {
        "position": list(position[:2]) if position is not None else None,
        "heading": (
            round(pose.heading, 4)
            if position is not None and pose is not None and pose.heading is not None
            else None
        ),
        "source": (
            robot_location_source(
                floor_plan,
                pose,
                session.state.value.operational.current_area,
                now=now,
            )
            if coherent
            else "unavailable"
        ),
        "scene_revision": (
            scene_view.current_revision(entry_id, runtime)
            if scene_view is not None
            else None
        ),
        "scene_epoch": (
            scene_view.scene_epoch(entry_id) if scene_view is not None else None
        ),
        "map_floor_coherent": coherent,
        "map_session_key": _map_session_key(runtime) if coherent else None,
        "pose_age_seconds": round(age, 3) if age is not None else None,
        # The robot's own time of this pose, which the live trail keeps.
        "observed_at": (
            round(pose.observed_at, 3)
            if position is not None
            and pose is not None
            and pose.observed_at is not None
            else None
        ),
    }


def catalog_entry_projection(
    entry_id: str,
    runtime: MaticRuntimeData,
    scene_view: MaticSlamSceneView | None = None,
) -> CatalogEntry:
    """Project the bounded catalog row shared by REST and workspace snapshots."""
    health = runtime.slam_map.health
    floor_plan = runtime.session.floor.value
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
    map_block_reason: MapBlockReason | None
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
    serial_number = runtime.session.info.serial_number
    plan_snapshot = runtime.cleaning_plans.history.snapshot(serial_number)
    return {
        "entry_id": entry_id,
        # The workspace push is the default transport when this capability is
        # present. Keep legacy saved opt-in values from changing the projection.
        "live_workspace_transport_enabled": True,
        "scene_url": scene_api_url(entry_id),
        "history_url": history_api_url(entry_id),
        "areas_url": areas_api_url(entry_id),
        "plans_url": plans_api_url(entry_id),
        "wifi_heatmap_url": WIFI_HEATMAP_API_URL.format(entry_id=entry_id),
        "floor_layers_url": FLOOR_LAYERS_API_URL.format(entry_id=entry_id),
        "history_count": len(
            runtime.slam_history.catalog_for_mission(map_identity.mission_token)
            if map_identity is not None
            else ()
        ),
        "history_floor_count": len(runtime.slam_history.catalogs_by_mission()),
        "map_revision": (
            scene_view.available_revision(entry_id, runtime)
            if scene_view is not None
            else runtime.slam_map.revision
        ),
        # `map_revision` can stay on a cached scene while a newer one awaits its
        # build. A panel without the workspace socket reads this revision, the
        # one the socket announces, to request that build.
        "scene_revision": (
            scene_view.current_revision(entry_id, runtime)
            if scene_view is not None
            else None
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
        "native_session_active": runtime.session.state.value.session_active,
        "map_health": health.state,
        "map_complete": health.complete,
        "map_truncated": health.truncated,
        "stream_failures": health.stream_failures,
        "bootstrap_state": getattr(health, "bootstrap_state", "not_started"),
        "bootstrap_photo_seen": getattr(health, "bootstrap_photo_seen", False),
        "bootstrap_structure_seen": getattr(health, "bootstrap_structure_seen", False),
        "bootstrap_failures": getattr(health, "bootstrap_failures", 0),
    }
