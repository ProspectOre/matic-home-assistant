"""Private plan storage, schema migration, normalization, and rollback."""

from __future__ import annotations

import math
from typing import Any, cast, override

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util.file import WriteError
from homeassistant.util.json import SerializationError

from .cadence_accounting import (
    validated_cadence_snapshots as _validated_cadence_snapshots,
)
from .const import DOMAIN
from .migrations import MINIMUM_UPGRADE_VERSION, async_create_upgrade_issue
from .native_history import (
    NATIVE_COMPLETION_DEDUP_MAX_KEYS,
    _validated_native_reconciliation,
)
from .plan_model import (
    MANUAL_ROOM_SEQUENCE_PLAN_NAME,
    _is_manual_room_sequence_plan_id,
    normalize_run_outcome,
    normalize_run_provenance,
)
from .plan_timing import (
    _latest_timestamp,
    _normalize_duration_profiles,
    _stored_count,
)

STORAGE_VERSION = 1

STORAGE_MINOR_VERSION = 13

# The oldest plan storage 0.5.4 reads without a migration step.
MINIMUM_STORAGE_MINOR_VERSION = 12

STORAGE_KEY = f"{DOMAIN}.plans"

_LEGACY_MANUAL_ROOM_SEQUENCE_PLAN_NAME = "Map Studio room clean"

MAX_MANAGED_NATIVE_SESSION_CLAIMS = 1024

STOP_FENCE_EXPIRES_AT = "stop_fence_expires_at"

STOP_FENCE_RUN_ID = "stop_fence_run_id"


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
            raise HomeAssistantError(
                "Cleaning plan state could not be saved",
                translation_domain=DOMAIN,
                translation_key="plan_state_unsaved",
            ) from None

    @override
    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Read what 0.5.0 to 0.5.4 stored; refuse anything older or newer.

        1.13 only added keys to 1.12, so 1.12 reads unchanged.
        """
        if old_major_version != STORAGE_VERSION:
            raise ValueError(f"unsupported plan storage version {old_major_version}")
        if old_minor_version > STORAGE_MINOR_VERSION:
            raise ValueError(
                f"unsupported plan storage minor version {old_minor_version}"
            )
        if old_minor_version < MINIMUM_STORAGE_MINOR_VERSION:
            async_create_upgrade_issue(self.hass)
            raise ValueError(
                f"plan storage 1.{old_minor_version} predates 0.5; "
                f"install {MINIMUM_UPGRADE_VERSION} first"
            )
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
        "managed_native_sessions",
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
    claims = robot.get("managed_native_sessions")
    normalized_claims = (
        {
            key: value
            for key, value in claims.items()
            if isinstance(key, str)
            and len(key) == 64
            and all(char in "0123456789abcdef" for char in key)
            and isinstance(value, dict)
        }
        if isinstance(claims, dict)
        else {}
    )
    normalized_claims = dict(
        list(normalized_claims.items())[-MAX_MANAGED_NATIVE_SESSION_CLAIMS:]
    )
    if claims != normalized_claims:
        robot["managed_native_sessions"] = normalized_claims
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
