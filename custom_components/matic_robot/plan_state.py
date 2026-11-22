"""Parse stored plan state once per start into the form 0.6 reads.

The plan storage refuses a file older than 1.13, so there are no version
steps. `parse_robot` repairs each stored robot once, when the plan manager
loads; `robot()` keeps only `normalize_robot`, the container repairs the
runtime writers rely on. The file stays at 1.13, which 0.5.4 reads.
"""

from __future__ import annotations

import math
from typing import Any

from .cadence_accounting import (
    validated_cadence_snapshots as _validated_cadence_snapshots,
)
from .client import is_sha256_hex
from .native_history import (
    NATIVE_COMPLETION_DEDUP_MAX_KEYS,
    validated_native_reconciliation,
)
from .plan_model import (
    MANUAL_ROOM_SEQUENCE_PLAN_NAME,
    is_manual_room_sequence_plan_id,
    normalize_run_outcome,
    normalize_run_provenance,
    stored_count,
)
from .plan_records import ActivePlan
from .plan_timing import (
    latest_timestamp,
    normalize_duration_profiles,
)

_LEGACY_MANUAL_ROOM_SEQUENCE_PLAN_NAME = "Map Studio room clean"

MAX_MANAGED_NATIVE_SESSION_CLAIMS = 1024


def parse_robot(robot: dict[str, Any]) -> bool:
    """Repair one loaded robot's containers and legacy fields; True if changed."""
    changed = normalize_robot(robot)
    return _repair_legacy_fields(robot) or changed


def _repair_legacy_fields(robot: dict[str, Any]) -> bool:
    """Rewrite fields older releases saved; nothing in 0.6 writes them."""
    changed = False
    for rotation in robot["rotations"].values():
        for record in rotation["rooms"].values():
            changed = normalize_duration_profiles(record) or changed
    last_run = robot["last_run"]
    if last_run is not None:
        outcome = last_run.get("outcome")
        if isinstance(outcome, str) and outcome != "running":
            normalized_outcome = normalize_run_outcome(outcome)
            if outcome != normalized_outcome:
                last_run["outcome"] = normalized_outcome
                changed = True
        raw_provenance = last_run.get("provenance") or last_run.get("trigger")
        safe_provenance = normalize_run_provenance(
            raw_provenance if isinstance(raw_provenance, str) else None
        )
        if (
            last_run.get("trigger") != safe_provenance
            or last_run.get("provenance") != safe_provenance
        ):
            last_run["trigger"] = safe_provenance
            last_run["provenance"] = safe_provenance
            changed = True
    for key in ("last_run", "active_plan"):
        record = robot[key]
        if (
            record is not None
            and record.get("plan_name") == _LEGACY_MANUAL_ROOM_SEQUENCE_PLAN_NAME
            and is_manual_room_sequence_plan_id(record.get("plan_id"))
        ):
            record["plan_name"] = MANUAL_ROOM_SEQUENCE_PLAN_NAME
            changed = True
    return changed


def _sync_verified_global_room_history(robot: dict[str, Any]) -> bool:
    """Backfill global room statistics from verified per-plan completions."""
    changed = False
    candidates: dict[str, tuple[float, dict[str, Any]]] = {}
    for rotation in robot["rotations"].values():
        for room_key, record in rotation["rooms"].items():
            if record.get("last_result") != "completed":
                continue
            room_id = record.get("room_id", room_key)
            completed = record.get("last_completed")
            duration = record.get("last_duration_seconds")
            timestamp = latest_timestamp(completed)
            if (
                not isinstance(room_id, str)
                or timestamp is None
                or not isinstance(duration, int | float)
                or isinstance(duration, bool)
                or not math.isfinite(duration)
                or duration <= 0
            ):
                continue
            current = candidates.get(room_id)
            if current is None or timestamp >= current[0]:
                candidates[room_id] = (timestamp, record)

    for room_id, (candidate_timestamp, candidate) in candidates.items():
        global_room = robot["rooms"].setdefault(room_id, {})
        global_timestamp = latest_timestamp(global_room.get("last_completed"))
        if global_timestamp is not None and global_timestamp > candidate_timestamp:
            continue
        updates = {
            "last_completed": candidate["last_completed"],
            "last_duration_seconds": round(candidate["last_duration_seconds"]),
        }
        if isinstance(candidate.get("name"), str):
            updates["name"] = candidate["name"]
        if any(global_room.get(key) != value for key, value in updates.items()):
            global_room.update(updates)
            changed = True
    return changed


def normalize_robot(robot: dict[str, Any]) -> bool:
    """Repair malformed storage containers without inventing room history."""
    changed = _ensure_containers(robot)
    changed = _normalize_native_completion_dedup(robot) or changed
    changed = _normalize_native_session_claims(robot) or changed
    changed = _drop_malformed_records(robot) or changed
    changed = _normalize_plan_room_cadence(robot["plan_room_cadence"]) or changed
    changed = _normalize_shared_room_cadence(robot["shared_room_cadence"]) or changed
    changed = _normalize_rotations(robot["rotations"]) or changed
    changed = _drop_values_not(str, robot["rotation_resets"]) or changed
    changed = _normalize_selection(robot, "selected_plan", "plans") or changed
    changed = _normalize_selection(robot, "selected_area", "areas") or changed
    changed = _normalize_active_plan(robot) or changed
    changed = _normalize_last_run(robot) or changed
    pending = robot.get("pending_native_reconciliation")
    if pending is not None and validated_native_reconciliation(pending) is None:
        robot.pop("pending_native_reconciliation", None)
        changed = True
    return _sync_verified_global_room_history(robot) or changed


def _ensure_containers(robot: dict[str, Any]) -> bool:
    """Replace each top-level container that is not a dictionary."""
    changed = False
    for key in (
        "rotations",
        "rooms",
        "plans",
        "areas",
        "area_history",
        "rotation_resets",
        "shared_room_cadence",
        "plan_room_cadence",
        "managed_native_sessions",
    ):
        if not isinstance(robot.get(key), dict):
            robot[key] = {}
            changed = True
    return changed


def _normalize_native_completion_dedup(robot: dict[str, Any]) -> bool:
    """Keep the newest well-formed native completion keys."""
    dedup = robot.get("native_completion_dedup")
    normalized = (
        [key for key in dedup[-NATIVE_COMPLETION_DEDUP_MAX_KEYS:] if is_sha256_hex(key)]
        if isinstance(dedup, list)
        else []
    )
    if isinstance(dedup, list) and normalized == dedup:
        return False
    robot["native_completion_dedup"] = normalized
    return True


def _normalize_native_session_claims(robot: dict[str, Any]) -> bool:
    """Keep the newest well-formed claims on native sessions."""
    claims = robot["managed_native_sessions"]
    normalized = {
        key: value
        for key, value in claims.items()
        if is_sha256_hex(key) and isinstance(value, dict)
    }
    normalized = dict(list(normalized.items())[-MAX_MANAGED_NATIVE_SESSION_CLAIMS:])
    if claims == normalized:
        return False
    robot["managed_native_sessions"] = normalized
    return True


def _drop_values_not(kind: type, records: dict[str, Any]) -> bool:
    """Remove every value that is not of the stored kind."""
    malformed = [key for key, value in records.items() if not isinstance(value, kind)]
    for key in malformed:
        records.pop(key)
    return bool(malformed)


def _drop_malformed_records(robot: dict[str, Any]) -> bool:
    """Remove room, plan and area records that are not dictionaries."""
    changed = False
    for key in ("rooms", "plans", "areas", "area_history"):
        changed = _drop_values_not(dict, robot[key]) or changed
    return changed


def _normalize_cadence_progress(record: dict[str, Any]) -> bool:
    """Store a cadence record's progress as its two counts."""
    progress = record.get("progress")
    normalized = {
        "mop": stored_count(progress, "mop"),
        "coverage": stored_count(progress, "coverage"),
    }
    if progress == normalized:
        return False
    record["progress"] = normalized
    return True


def _normalize_plan_room_cadence(cadence: dict[str, Any]) -> bool:
    """Repair each plan's per-room cadence records."""
    changed = False
    for plan_id, room_records in tuple(cadence.items()):
        if not isinstance(room_records, dict):
            cadence.pop(plan_id)
            changed = True
            continue
        changed = _drop_values_not(dict, room_records) or changed
        for record in room_records.values():
            changed = _normalize_cadence_progress(record) or changed
            changed = _normalize_unverified_modes(record) or changed
            identity = record.get("identity")
            if identity is not None and (
                not isinstance(identity, str) or len(identity) != 64
            ):
                record.pop("identity", None)
                changed = True
    return changed


def _normalize_unverified_modes(record: dict[str, Any]) -> bool:
    """Keep the known unverified modes in canonical order, or no list at all."""
    raw = record.get("unverified_modes")
    normalized = (
        [mode for mode in ("mop", "coverage") if mode in raw]
        if isinstance(raw, list)
        else []
    )
    if not normalized:
        if "unverified_modes" not in record:
            return False
        record.pop("unverified_modes")
    elif normalized == raw:
        return False
    else:
        record["unverified_modes"] = normalized
    return True


def _normalize_shared_room_cadence(cadence: dict[str, Any]) -> bool:
    """Drop shared cadence records without a policy and repair the rest."""
    changed = False
    for room_id, record in tuple(cadence.items()):
        if not isinstance(record, dict) or not isinstance(record.get("policy"), dict):
            cadence.pop(room_id)
            changed = True
            continue
        changed = _normalize_cadence_progress(record) or changed
    return changed


def _normalize_rotations(rotations: dict[str, Any]) -> bool:
    """Give each rotation a room map and drop malformed room and area records."""
    changed = False
    for plan_id, rotation in tuple(rotations.items()):
        if not isinstance(rotation, dict):
            rotation = {"rooms": {}}
            rotations[plan_id] = rotation
            changed = True
        for kind in ("rooms", "areas"):
            if kind == "areas" and kind not in rotation:
                continue
            if not isinstance(rotation.get(kind), dict):
                rotation[kind] = {}
                changed = True
            changed = _drop_values_not(dict, rotation[kind]) or changed
    return changed


def _normalize_selection(robot: dict[str, Any], key: str, records: str) -> bool:
    """Point a selection that names no stored record at the first one."""
    selected = robot.get(key)
    if isinstance(selected, str) and selected in robot[records]:
        return False
    robot[key] = next(iter(robot[records]), None)
    return True


def _normalize_active_plan(robot: dict[str, Any]) -> bool:
    """Clear an active plan that does not name a plan and a room or area."""
    active = robot.get("active_plan")
    if active is None:
        if "active_plan" in robot:
            return False
    elif isinstance(active, dict) and ActivePlan.parse(active) is not None:
        return False
    robot["active_plan"] = None
    return True


def _normalize_last_run(robot: dict[str, Any]) -> bool:
    """Clear a last run without its identifiers; repair its cadence checkpoint."""
    last_run = robot.get("last_run")
    if last_run is None:
        if "last_run" in robot:
            return False
    elif (
        isinstance(last_run, dict)
        and isinstance(last_run.get("run_id"), str)
        and isinstance(last_run.get("plan_id"), str)
    ):
        return _normalize_checkpoint_cadence(last_run.get("recovery_checkpoint"))
    robot["last_run"] = None
    return True


def _normalize_checkpoint_cadence(checkpoint: object) -> bool:
    """Replace or drop a recovery checkpoint's stored cadence snapshots."""
    if not isinstance(checkpoint, dict) or "cadence_by_room" not in checkpoint:
        return False
    normalized = _validated_cadence_snapshots(checkpoint["cadence_by_room"])
    if normalized is None:
        checkpoint.pop("cadence_by_room", None)
        return True
    if checkpoint["cadence_by_room"] == normalized:
        return False
    checkpoint["cadence_by_room"] = normalized
    return True
