"""Content-free identities and projections shared by private map views."""

from __future__ import annotations

from hashlib import sha256
from typing import TYPE_CHECKING

from .client.floor_plan import resolve_robot_map_position
from .http import (
    COVERAGE_API_URL,
    FLOOR_LAYERS_API_URL,
    WIFI_HEATMAP_API_URL,
    areas_api_url,
    delta_api_url,
    history_api_url,
    plans_api_url,
    pose_api_url,
    scene_api_url,
)
from .run_history import RunTrails
from .slam_map_store import SlamMapIdentity

if TYPE_CHECKING:
    from . import MaticRuntimeData
    from .client.models import RobotPose
    from .slam_history_format import SlamHistorySnapshot
    from .slam_scene import MaticSlamSceneView

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
    runtime: MaticRuntimeData,
    position: tuple[float, float] | None,
    observed_at: float | None = None,
) -> None:
    """Give the trail recorder one verified position, or only the run state."""
    trails: RunTrails | None = getattr(runtime, "run_trails", None)
    if trails is None:
        return
    data = runtime.coordinator.data
    if not pose_observed_in_frame(runtime, observed_at):
        position = None
    trails.observe(
        run_id=runtime.cleaning_plans.ledger.active_run_id(
            str(data.info.serial_number)
        ),
        native_active=data.telemetry.active_cleaning_session,
        map_key=_map_session_key(runtime),
        point=position,
        observed_at=observed_at,
        frame_key=_pose_frame_key(runtime),
    )


def observe_coordinator_trail(runtime: MaticRuntimeData) -> None:
    """Record the coordinator's own pose read, which also closes finished runs."""
    data = runtime.coordinator.data
    position = (
        resolve_robot_map_position(data.floor_plan, data.pose, None)
        if runtime.slam_map.floor_plan_is_current(data.floor_plan)
        else None
    )
    observe_run_trail(
        runtime,
        position[:2] if position is not None else None,
        data.pose.observed_at if data.pose is not None else None,
    )


def observe_live_pose_trail(runtime: MaticRuntimeData, pose: RobotPose) -> None:
    """Record fresh stream poses even when no browser is open."""
    data = runtime.coordinator.data
    position = (
        resolve_robot_map_position(data.floor_plan, pose, None)
        if runtime.slam_map.floor_plan_is_current(data.floor_plan)
        else None
    )
    observe_run_trail(
        runtime, position[:2] if position is not None else None, pose.observed_at
    )


def pose_observed_in_frame(
    runtime: MaticRuntimeData, observed_at: float | None
) -> bool:
    """Reject delayed poses from before the current live frame was established."""
    return (
        observed_at is not None
        and runtime.slam_map.floor_plan_is_current(runtime.coordinator.data.floor_plan)
        and observed_at
        > max(
            getattr(runtime.slam_map, "pose_frame_started_at", 0.0),
            getattr(runtime.coordinator, "floor_frame_started_at", 0.0),
        )
    )


def _pose_frame_key(
    runtime: MaticRuntimeData,
) -> tuple[SlamMapIdentity | None, str | None, int, int]:
    """Bind pose reads to a coordinate frame and its revocation epoch."""
    return (
        runtime.slam_map.mission_identity,
        _map_session_key(runtime),
        getattr(runtime.coordinator, "floor_read_generation", 0),
        getattr(runtime.slam_map, "pose_frame_generation", 0),
    )


def pose_frame_token(runtime: MaticRuntimeData) -> str:
    """Expose an opaque, runtime-local proof epoch for live trail continuity."""
    return sha256(
        repr((id(runtime), _pose_frame_key(runtime))).encode("utf-8")
    ).hexdigest()


def history_floor_choices(
    runtime: MaticRuntimeData,
) -> tuple[str | None, tuple[str, ...], tuple[SlamHistorySnapshot, ...]]:
    """Share current, saved and imported floor choices between both catalogs."""
    floor_plan = runtime.coordinator.data.floor_plan
    identity = runtime.slam_map.mission_identity
    current = (
        identity.mission_token
        if identity is not None and runtime.slam_map.floor_plan_is_current(floor_plan)
        else None
    )
    missions = dict.fromkeys(dict(runtime.slam_history.catalogs_by_mission()))
    for floor in floor_plan.mapped_floors if floor_plan is not None else ():
        missions.setdefault(floor.mission_token)
    if current is not None:
        missions.pop(current, None)
    imported = tuple(
        snapshot
        for snapshot in runtime.slam_history.catalog()
        if getattr(snapshot, "imported", False)
        and getattr(snapshot, "retention", "automatic") != "trash"
    )
    return current, tuple(missions), imported


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
    plan_snapshot = runtime.cleaning_plans.history.snapshot(serial_number)
    telemetry = getattr(runtime.coordinator.data, "telemetry", None)
    _, saved_floors, imported = history_floor_choices(runtime)
    return {
        "entry_id": entry_id,
        # The workspace push is the default transport when this capability is
        # present. Keep legacy saved opt-in values from changing the projection.
        "live_workspace_transport_enabled": True,
        "scene_url": scene_api_url(entry_id),
        "delta_url": delta_api_url(entry_id),
        "pose_url": pose_api_url(entry_id),
        "history_url": history_api_url(entry_id),
        "areas_url": areas_api_url(entry_id),
        "plans_url": plans_api_url(entry_id),
        "wifi_heatmap_url": WIFI_HEATMAP_API_URL.format(entry_id=entry_id),
        "floor_layers_url": FLOOR_LAYERS_API_URL.format(entry_id=entry_id),
        "coverage_url": COVERAGE_API_URL.format(entry_id=entry_id),
        "history_count": len(
            runtime.slam_history.catalog_for_mission(map_identity.mission_token)
            if map_identity is not None
            else ()
        ),
        "history_floor_count": 1 + len(saved_floors) + bool(imported),
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
