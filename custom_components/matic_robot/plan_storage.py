"""Private plan storage, schema migration, normalization, and rollback."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, cast, override

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util.file import WriteError
from homeassistant.util.json import SerializationError

from .cadence_accounting import (
    validated_cadence_snapshots as _validated_cadence_snapshots,
)
from .const import DOMAIN
from .native_history import (
    NATIVE_COMPLETION_DEDUP_MAX_KEYS,
    _native_reconciliation_key,
    _validated_native_reconciliation,
)
from .plan_model import (
    MANUAL_ROOM_SEQUENCE_PLAN_NAME,
    _is_manual_room_sequence_plan_id,
    _next_manual_room_sequence_plan_id,
    _plan_room_ids,
    normalize_run_outcome,
    normalize_run_provenance,
)
from .plan_timing import (
    _latest_timestamp,
    _latest_timestamp_value,
    _normalize_duration_profiles,
    _stored_count,
    _valid_duration_seconds,
)

STORAGE_VERSION = 1

STORAGE_MINOR_VERSION = 12

STORAGE_KEY = f"{DOMAIN}.plans"

_LEGACY_MANUAL_ROOM_SEQUENCE_PLAN_NAME = "Map Studio room clean"

STOP_FENCE_EXPIRES_AT = "stop_fence_expires_at"

STOP_FENCE_RUN_ID = "stop_fence_run_id"


def _move_legacy_manual_rotation(
    robot: dict[str, Any], run_id: str, manual_plan_id: str
) -> None:
    """Move only rotation rows owned by one legacy manual run."""
    rotations = robot.get("rotations")
    if not isinstance(rotations, dict):
        return
    legacy = rotations.get("quick_clean")
    if not isinstance(legacy, dict):
        return
    legacy_rooms = legacy.get("rooms")
    if not isinstance(legacy_rooms, dict):
        return
    owned_rooms = [
        (room_id, record)
        for room_id, record in legacy_rooms.items()
        if isinstance(record, dict) and record.get("run_id") == run_id
    ]
    if not owned_rooms:
        return
    target = rotations.get(manual_plan_id)
    if not isinstance(target, dict):
        target = {"rooms": {}}
        rotations[manual_plan_id] = target
    target_rooms = target.get("rooms")
    if not isinstance(target_rooms, dict):
        target_rooms = {}
        target["rooms"] = target_rooms
    for room_id, record in owned_rooms:
        existing = target_rooms.get(room_id)
        if not isinstance(existing, dict):
            target_rooms[room_id] = record
        else:
            source_time = _latest_timestamp_value(
                record.get("last_opportunity"), record.get("last_completed")
            )
            target_time = _latest_timestamp_value(
                existing.get("last_opportunity"), existing.get("last_completed")
            )
            source_is_newer = target_time is None or (
                source_time is not None and source_time[0] > target_time[0]
            )
            selected = record if source_is_newer else existing
            source_completion = _latest_timestamp_value(record.get("last_completed"))
            target_completion = _latest_timestamp_value(existing.get("last_completed"))
            newest_completion: tuple[float, str] | None = None
            completion_duration: int | float | None = None
            source_duration = _valid_duration_seconds(
                record.get("last_duration_seconds")
            )
            target_duration = _valid_duration_seconds(
                existing.get("last_duration_seconds")
            )
            source_completion_wins = source_completion is not None and (
                target_completion is None
                or source_completion[0] > target_completion[0]
                or (
                    source_completion[0] == target_completion[0]
                    and (source_duration is not None or target_duration is None)
                )
            )
            if source_completion_wins:
                # Equal instants permit either row's duration; prefer source
                # deterministically when both durations are valid.
                newest_completion = source_completion
                completion_duration = source_duration
            elif target_completion is not None:
                newest_completion = target_completion
                completion_duration = target_duration
            if newest_completion is not None:
                # Row ownership describes the latest run and must keep its
                # run_id/result pair. Completion time is an independent
                # aggregate: a newer failed/manual attempt can own the row
                # while the other row still has the latest verified completion.
                # Keep only duration evidence attached to that completion;
                # do not merge duration history or counts without run provenance.
                selected["last_completed"] = newest_completion[1]
                if completion_duration is not None:
                    selected["last_duration_seconds"] = completion_duration
                else:
                    selected.pop("last_duration_seconds", None)
            target_rooms[room_id] = selected
        legacy_rooms.pop(room_id, None)


def _quarantine_legacy_manual_cadence(robot: dict[str, Any]) -> None:
    """Preserve, but stop trusting, private progress for the legacy ID collision."""
    plans = robot.get("plans")
    quick_clean = plans.get("quick_clean") if isinstance(plans, Mapping) else None
    plan_rooms = quick_clean.get("rooms") if isinstance(quick_clean, Mapping) else None
    if not isinstance(plan_rooms, list):
        return
    cadence_by_room: dict[str, Mapping[str, Any]] = {}
    for room in plan_rooms:
        if not isinstance(room, Mapping) or not isinstance(room.get("room_id"), str):
            continue
        policy = room.get("cadence")
        if not isinstance(policy, Mapping) or policy.get("scope", "plan") == "shared":
            continue
        cadence_by_room[room["room_id"]] = policy
    if not cadence_by_room:
        return
    all_progress = robot.get("plan_room_cadence")
    if not isinstance(all_progress, dict):
        all_progress = {}
        robot["plan_room_cadence"] = all_progress
    progress_by_room = all_progress.get("quick_clean")
    if not isinstance(progress_by_room, dict):
        progress_by_room = {}
        all_progress["quick_clean"] = progress_by_room
    for room_id, policy in cadence_by_room.items():
        modes = [
            mode
            for mode, field in (
                ("mop", "mop_every_n"),
                ("coverage", "coverage_every_n"),
            )
            if isinstance(policy.get(field), int)
            and not isinstance(policy.get(field), bool)
            and 1 <= policy[field] <= 100
        ]
        if not modes:
            continue
        record = progress_by_room.get(room_id)
        if not isinstance(record, dict):
            record = {}
            progress_by_room[room_id] = record
        existing = record.get("unverified_modes")
        unverified = (
            {
                mode
                for mode in existing
                if isinstance(mode, str) and mode in ("mop", "coverage")
            }
            if isinstance(existing, list)
            else set()
        )
        record["unverified_modes"] = [
            mode for mode in ("mop", "coverage") if mode in unverified | set(modes)
        ]


def _migrate_legacy_manual_room_run(robot: dict[str, Any]) -> bool:
    """Isolate a persisted pre-0.5 room run from saved Quick Clean policy."""
    run = robot.get("last_run")
    if (
        not isinstance(run, dict)
        or run.get("plan_id") != "quick_clean"
        or run.get("service") != "clean_room_sequence"
    ):
        return False
    run_id = run.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        return False

    raw_plans = robot.get("plans")
    plans = raw_plans if isinstance(raw_plans, Mapping) else {}
    plan_id = _next_manual_room_sequence_plan_id(plans)
    _move_legacy_manual_rotation(robot, run_id, plan_id)
    run["plan_id"] = plan_id
    run["plan_name"] = MANUAL_ROOM_SEQUENCE_PLAN_NAME

    checkpoint = run.get("recovery_checkpoint")
    if isinstance(checkpoint, dict):
        checkpoint_data = checkpoint.get("data")
        if (
            isinstance(checkpoint_data, dict)
            and checkpoint_data.get("plan_id") == "quick_clean"
        ):
            checkpoint_data["plan_id"] = plan_id
        snapshots = _validated_cadence_snapshots(checkpoint.get("cadence_by_room"))
        shared_snapshots = {
            room_id: snapshot
            for room_id, snapshot in (snapshots or {}).items()
            if snapshot.get("scope") == "shared"
        }
        if shared_snapshots:
            checkpoint["cadence_by_room"] = shared_snapshots
        else:
            checkpoint.pop("cadence_by_room", None)

    active = robot.get("active_plan")
    if (
        isinstance(active, dict)
        and active.get("run_id") == run_id
        and active.get("plan_id") == "quick_clean"
    ):
        active["plan_id"] = plan_id
        active["plan_name"] = MANUAL_ROOM_SEQUENCE_PLAN_NAME

    raw_pending = robot.get("pending_native_reconciliation")
    pending = _validated_native_reconciliation(raw_pending)
    if (
        pending is not None
        and pending.get("run_id") == run_id
        and pending.get("plan_id") == "quick_clean"
    ):
        old_key = _native_reconciliation_key(pending)
        pending["plan_id"] = plan_id
        cadence_state = pending.get("cadence_state")
        if (
            not isinstance(cadence_state, Mapping)
            or cadence_state.get("scope") != "shared"
        ):
            pending.pop("cadence_state", None)
        new_key = _native_reconciliation_key(pending)
        robot["pending_native_reconciliation"] = pending
        dedup = robot.get("native_completion_dedup")
        if isinstance(dedup, list) and old_key in dedup:
            robot["native_completion_dedup"] = [
                new_key if key == old_key else key for key in dedup
            ]
    return True


def _stamp_plan_entries(robot: dict[str, Any]) -> None:
    """Record every existing plan's rooms as its ordered room entries.

    One-way: an older build fails closed on this minor version instead of
    running a plan whose custom areas it cannot see.
    """
    plans = robot.get("plans")
    if not isinstance(plans, dict):
        return
    for plan in plans.values():
        if isinstance(plan, dict) and "entries" not in plan:
            plan["entries"] = [
                {"kind": "room", "room_id": room_id}
                for room_id in _plan_room_ids(plan.get("rooms"))
            ]


class _CleaningPlanStore(Store[dict[str, Any]]):
    """Private plan storage with fail-closed schema migrations."""

    @override
    async def _async_write_data(self, data: dict[str, Any]) -> None:
        """Make failed writes visible to the caller's accounting rollback."""
        try:
            await super()._async_write_data(data)
        except SerializationError, WriteError:
            # Store otherwise logs these errors and returns a successful await.
            # Keep its atomic writer and locks, but do not acknowledge a failed
            # commit or expose serialization payloads in a service error.
            raise HomeAssistantError("Cleaning plan state could not be saved") from None

    @override
    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Migrate local planning state without inventing completion history."""
        if old_major_version != STORAGE_VERSION:
            raise ValueError(f"unsupported plan storage version {old_major_version}")
        if old_minor_version > STORAGE_MINOR_VERSION:
            raise ValueError(
                f"unsupported plan storage minor version {old_minor_version}"
            )
        robots = old_data.get("robots")
        if isinstance(robots, dict):
            for robot in robots.values():
                if not isinstance(robot, dict):
                    continue
                if old_minor_version < 2:
                    areas = robot.get("areas")
                    if isinstance(areas, dict):
                        for area in areas.values():
                            if isinstance(area, dict):
                                area.setdefault("schema_version", 0)
                if old_minor_version < 3:
                    rotations = robot.get("rotations")
                    if isinstance(rotations, dict):
                        for rotation in rotations.values():
                            if not isinstance(rotation, dict):
                                continue
                            room_records = rotation.get("rooms")
                            if isinstance(room_records, dict):
                                for record in room_records.values():
                                    _migrate_room_opportunity(record)
                    rooms = robot.get("rooms")
                    if isinstance(rooms, dict):
                        for record in rooms.values():
                            _migrate_room_opportunity(record)
                if old_minor_version < 5:
                    robot.setdefault("last_run", None)
                if old_minor_version < 6:
                    robot.setdefault("shared_room_cadence", {})
                if old_minor_version < 7:
                    robot.setdefault("plan_room_cadence", {})
                if old_minor_version < 8:
                    robot.setdefault("native_completion_dedup", [])
                if old_minor_version < 9:
                    _migrate_legacy_manual_room_run(robot)
                if old_minor_version < 10:
                    _quarantine_legacy_manual_cadence(robot)
                    run = robot.get("last_run")
                    if (
                        isinstance(run, Mapping)
                        and run.get("service") == "clean_room_sequence"
                        and _is_manual_room_sequence_plan_id(run.get("plan_id"))
                        and isinstance(run.get("run_id"), str)
                    ):
                        _move_legacy_manual_rotation(
                            robot, run["run_id"], run["plan_id"]
                        )
                if old_minor_version < 11:
                    _stamp_plan_entries(robot)
                if old_minor_version < 12:
                    rotations = robot.get("rotations")
                    if isinstance(rotations, dict):
                        for rotation in rotations.values():
                            if not isinstance(rotation, dict):
                                continue
                            records = rotation.get("rooms")
                            if isinstance(records, dict):
                                for record in records.values():
                                    if isinstance(record, dict):
                                        _normalize_duration_profiles(record)
        return old_data


def _restore_unsaved_changes(
    current: dict[str, Any], before: dict[str, Any], applied: dict[str, Any]
) -> None:
    """Undo failed changes while preserving mutations after the snapshot."""
    missing = object()
    for key, value in applied.items():
        previous = before.get(key, missing)
        present = current.get(key, missing)
        if all(isinstance(item, dict) for item in (previous, value, present)):
            _restore_unsaved_changes(present, previous, value)
        elif present == value:
            if previous is missing:
                current.pop(key)
            else:
                current[key] = previous
    for key in before.keys() - applied.keys():
        if key not in current:
            current[key] = before[key]


def _migrate_room_opportunity(record: object) -> None:
    """Preserve the pre-v3 attempt ordering without claiming completion."""
    if not isinstance(record, dict):
        return
    started = record.get("last_started")
    if isinstance(started, str) and not isinstance(record.get("last_opportunity"), str):
        record["last_opportunity"] = started


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
            timestamp = _latest_timestamp(completed)
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
        global_timestamp = _latest_timestamp(global_room.get("last_completed"))
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


def _normalize_robot(robot: dict[str, Any]) -> bool:
    """Repair malformed storage containers without inventing room history."""
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
    ):
        if not isinstance(robot.get(key), dict):
            robot[key] = {}
            changed = True
    dedup = robot.get("native_completion_dedup")
    if not isinstance(dedup, list):
        robot["native_completion_dedup"] = []
        changed = True
    else:
        normalized_dedup = [
            key
            for key in dedup[-NATIVE_COMPLETION_DEDUP_MAX_KEYS:]
            if isinstance(key, str)
            and len(key) == 64
            and all(char in "0123456789abcdef" for char in key)
        ]
        if normalized_dedup != dedup:
            robot["native_completion_dedup"] = normalized_dedup
            changed = True
    for key in ("rooms", "plans", "areas", "area_history"):
        records = robot[key]
        for record_id, record in tuple(records.items()):
            if not isinstance(record, dict):
                records.pop(record_id)
                changed = True
    for plan_id, room_records in tuple(robot["plan_room_cadence"].items()):
        if not isinstance(room_records, dict):
            robot["plan_room_cadence"].pop(plan_id)
            changed = True
            continue
        for room_id, record in tuple(room_records.items()):
            if not isinstance(record, dict):
                room_records.pop(room_id)
                changed = True
                continue
            progress = record.get("progress")
            normalized = {
                "mop": _stored_count(progress, "mop"),
                "coverage": _stored_count(progress, "coverage"),
            }
            if progress != normalized:
                record["progress"] = normalized
                changed = True
            raw_unverified = record.get("unverified_modes")
            normalized_unverified = (
                [
                    mode
                    for mode in ("mop", "coverage")
                    if isinstance(raw_unverified, list) and mode in raw_unverified
                ]
                if isinstance(raw_unverified, list)
                else []
            )
            if normalized_unverified:
                if normalized_unverified != raw_unverified:
                    record["unverified_modes"] = normalized_unverified
                    changed = True
            elif "unverified_modes" in record:
                record.pop("unverified_modes")
                changed = True
            identity = record.get("identity")
            if identity is not None and (
                not isinstance(identity, str) or len(identity) != 64
            ):
                record.pop("identity", None)
                changed = True
    for room_id, record in tuple(robot["shared_room_cadence"].items()):
        if not isinstance(record, dict) or not isinstance(record.get("policy"), dict):
            robot["shared_room_cadence"].pop(room_id)
            changed = True
            continue
        progress = record.get("progress")
        normalized = {
            "mop": _stored_count(progress, "mop"),
            "coverage": _stored_count(progress, "coverage"),
        }
        if progress != normalized:
            record["progress"] = normalized
            changed = True
    rotations = robot["rotations"]
    for plan_id, rotation in tuple(rotations.items()):
        if not isinstance(rotation, dict):
            rotation = {"rooms": {}}
            rotations[plan_id] = rotation
            changed = True
        for kind in ("rooms", "areas"):
            if kind == "areas" and kind not in rotation:
                continue
            records = rotation.get(kind)
            if not isinstance(records, dict):
                records = {}
                rotation[kind] = records
                changed = True
            for record_id, record in tuple(records.items()):
                if not isinstance(record, dict):
                    records.pop(record_id)
                    changed = True
                elif kind == "rooms":
                    changed = _normalize_duration_profiles(record) or changed
    reset_values = robot["rotation_resets"]
    for plan_id, value in tuple(reset_values.items()):
        if not isinstance(value, str):
            reset_values.pop(plan_id)
            changed = True
    selected_plan = robot.get("selected_plan")
    if not isinstance(selected_plan, str) or selected_plan not in robot["plans"]:
        robot["selected_plan"] = next(iter(robot["plans"]), None)
        changed = True
    selected_area = robot.get("selected_area")
    if not isinstance(selected_area, str) or selected_area not in robot["areas"]:
        robot["selected_area"] = next(iter(robot["areas"]), None)
        changed = True
    active = robot.get("active_plan")
    if active is not None and (
        not isinstance(active, dict)
        or not isinstance(active.get("plan_id"), str)
        # A plan's custom area is active by its area ID, not a room.
        or not isinstance(active.get("room_id", active.get("area_id")), str)
    ):
        robot["active_plan"] = None
        changed = True
    elif "active_plan" not in robot:
        robot["active_plan"] = None
        changed = True
    last_run = robot.get("last_run")
    if last_run is not None and (
        not isinstance(last_run, dict)
        or not isinstance(last_run.get("run_id"), str)
        or not isinstance(last_run.get("plan_id"), str)
    ):
        robot["last_run"] = None
        changed = True
    elif "last_run" not in robot:
        robot["last_run"] = None
        changed = True
    elif isinstance(last_run, dict):
        last_run_value = cast(dict[str, Any], last_run)
        checkpoint = last_run_value.get("recovery_checkpoint")
        if isinstance(checkpoint, dict):
            if "cadence_by_room" in checkpoint:
                normalized_cadence = _validated_cadence_snapshots(
                    checkpoint["cadence_by_room"]
                )
                if normalized_cadence is None:
                    checkpoint.pop("cadence_by_room", None)
                    changed = True
                elif checkpoint["cadence_by_room"] != normalized_cadence:
                    checkpoint["cadence_by_room"] = normalized_cadence
                    changed = True
        outcome = last_run_value.get("outcome")
        if isinstance(outcome, str) and outcome != "running":
            normalized_outcome = normalize_run_outcome(outcome)
            if outcome != normalized_outcome:
                last_run_value["outcome"] = normalized_outcome
                changed = True
        raw_provenance = last_run_value.get("provenance") or last_run_value.get(
            "trigger"
        )
        safe_provenance = normalize_run_provenance(
            raw_provenance if isinstance(raw_provenance, str) else None
        )
        if (
            last_run_value.get("trigger") != safe_provenance
            or last_run_value.get("provenance") != safe_provenance
        ):
            last_run_value["trigger"] = safe_provenance
            last_run_value["provenance"] = safe_provenance
            changed = True
    for key in ("last_run", "active_plan"):
        record = robot.get(key)
        if (
            isinstance(record, dict)
            and record.get("plan_name") == _LEGACY_MANUAL_ROOM_SEQUENCE_PLAN_NAME
            and _is_manual_room_sequence_plan_id(record.get("plan_id"))
        ):
            record["plan_name"] = MANUAL_ROOM_SEQUENCE_PLAN_NAME
            changed = True
    pending = robot.get("pending_native_reconciliation")
    if pending is not None and _validated_native_reconciliation(pending) is None:
        robot.pop("pending_native_reconciliation", None)
        changed = True
    changed = _sync_verified_global_room_history(robot) or changed
    return changed
