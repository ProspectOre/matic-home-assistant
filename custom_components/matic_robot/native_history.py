"""Durable native completion reconciliation and verified room accounting."""

from __future__ import annotations

import hashlib
import re
import struct
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Any, cast

from homeassistant.util import dt as dt_util

from . import daily_room_limit
from .cadence_accounting import apply_verified_cadence as _apply_verified_cadence
from .cadence_accounting import (
    validated_cadence_snapshot as _validated_cadence_snapshot,
)
from .client.coverage_receipts import CoverageReceipt, native_session_hash
from .client.models import CleaningSessionRecord, FloorPlan, Room
from .const import MAX_ROOM_SEQUENCE_SIZE
from .coverage_accounting import coverage_evidence_from_storage, verified_room_coverage
from .grouped_native_reconciliation import (
    match_native_reconciliation_room,
    validated_grouped_rooms,
)
from .native_completion import NativeRoomCompletion
from .native_completion import native_room_key as _native_room_key
from .plan_model import CleaningRoom, plan_floor_token, room_cadence_identity
from .plan_timing import (
    _admit_room_settings,
    _duration_profile_key,
    _duration_profiles,
    _latest_timestamp,
    _record_duration_sample,
    _stored_count,
)
from .room_statistics import (
    NativeRoomStatistic,
    native_room_statistics_by_session,
    native_statistics_have_ambiguous_floor,
)
from .run_history import repair_run_history

NATIVE_COMPLETION_DEDUP_MAX_KEYS = max(64, MAX_ROOM_SEQUENCE_SIZE)
ROTATION_FUTURE_TOLERANCE_SECONDS = 24 * 60 * 60


def _daily_session_hash(key: bytes) -> str:
    """Keep a bounded session reference without persisting the native key."""
    return (
        native_session_hash(key)
        or hashlib.sha256(b"matic-daily-native-session\0" + key).hexdigest()
    )


def _import_daily_native_uncertainty(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
) -> bool:
    """Hold ambiguous native completions instead of inventing daily credit."""
    now = dt_util.utcnow()
    changed = False
    rooms_by_name: dict[str, list[Room]] = {}
    rooms_by_protocol_id = {room.protocol_id: room for room in floor_plan.rooms}
    for room in floor_plan.rooms:
        rooms_by_name.setdefault(_native_room_key(room.name), []).append(room)
    for record in records:
        session = record.session
        canonical = session.mission_id is not None or session.partition_id is not None
        if canonical:
            # UUID results are authoritative only on their exact floor and
            # partition. Names are labels and can collide across saved floors.
            if (
                session.mission_id != floor_plan.mission_id
                or session.partition_id != floor_plan.partition_protocol_id
            ):
                continue
            reported_rooms = {
                rooms_by_protocol_id[result.room_id]
                for result in session.mode_results
                if result.status == "completed"
                and result.room_id in rooms_by_protocol_id
            }
        else:
            if native_statistics_have_ambiguous_floor(floor_plan):
                continue
            names = (
                {
                    result.room
                    for result in session.mode_results
                    if result.status == "completed"
                }
                if session.mode_results
                else set(session.completed_rooms)
            )
            reported_rooms = {
                room
                for name in names
                for room in rooms_by_name.get(_native_room_key(name), ())
            }
        for room in reported_rooms:
            if daily_room_limit._time(session.ended_at) is None:
                changed = (
                    daily_room_limit.record_unknown_completion_time(
                        robot,
                        room.id,
                        now=now,
                        session_hash=_daily_session_hash(record.key)
                        if record.key
                        else None,
                    )
                    or changed
                )
                continue
            assert isinstance(session.ended_at, str)
            try:
                identity = room_cadence_identity(floor_plan, room.id)
            except ValueError:
                identity = None
            changed = (
                daily_room_limit.record_completion(
                    robot,
                    room.id,
                    identity,
                    session.ended_at,
                    now=now,
                    session_hash=(
                        _daily_session_hash(record.key)
                        if record.key
                        else hashlib.sha256(
                            f"matic-empty-native-key\0{session.ended_at}\0{room.id}".encode()
                        ).hexdigest()
                    ),
                    unverified=True,
                )
                or changed
            )
    return changed


OEM_STOP_RECONCILIATION_SECONDS = 12 * 60

OEM_STOP_FENCE_SECONDS = OEM_STOP_RECONCILIATION_SECONDS


def _validated_native_reconciliation(
    value: object, *, create_expiry: bool = False
) -> dict[str, Any] | None:
    """Validate the small durable marker used to recover a late native stop."""
    if not isinstance(value, Mapping):
        return None
    plan_id = value.get("plan_id")
    room_id = value.get("room_id")
    room = value.get("room")
    dispatched_at = value.get("dispatched_at")
    if not isinstance(plan_id, str) or not plan_id.strip():
        return None
    if not isinstance(room_id, str) or not room_id.strip():
        return None
    if not isinstance(room, str) or not room.strip():
        return None
    if not isinstance(dispatched_at, str) or not dispatched_at.strip():
        return None
    parsed = dt_util.parse_datetime(dispatched_at)
    if parsed is None or parsed.tzinfo is None:
        return None
    expires_at: object
    if create_expiry:
        expires_at = (
            dt_util.utcnow() + timedelta(seconds=OEM_STOP_RECONCILIATION_SECONDS)
        ).isoformat()
    else:
        expires_at = value.get("expires_at")
    if not isinstance(expires_at, str) or not expires_at.strip():
        return None
    parsed_expiry = dt_util.parse_datetime(expires_at)
    if parsed_expiry is None or parsed_expiry.tzinfo is None:
        return None
    cleaning_mode = value.get("cleaning_mode")
    if "cleaning_mode" in value and (
        not isinstance(cleaning_mode, str)
        or cleaning_mode not in ("vacuum", "mop", "vacuum_and_mop")
    ):
        return None
    coverage_setting = value.get("coverage_setting")
    run_id = value.get("run_id")
    result: dict[str, Any] = {
        "plan_id": plan_id,
        "room_id": room_id,
        "room": room,
        "dispatched_at": dispatched_at,
        "expires_at": expires_at,
        **(
            {"cleaning_mode": cleaning_mode}
            if isinstance(cleaning_mode, str)
            and cleaning_mode in ("vacuum", "mop", "vacuum_and_mop")
            else {}
        ),
        **(
            {"coverage_setting": coverage_setting}
            if isinstance(coverage_setting, str)
            and coverage_setting in ("quick", "standard", "heavy_duty")
            else {}
        ),
        **(
            {"run_id": run_id}
            if isinstance(run_id, str) and 0 < len(run_id) <= 64
            else {}
        ),
    }
    cadence_state = _validated_cadence_snapshot(value.get("cadence_state"))
    if cadence_state is not None:
        result["cadence_state"] = cadence_state
    evidence = coverage_evidence_from_storage(value.get("coverage_evidence"))
    if evidence is not None and room_id in dict(evidence.room_regions):
        result["coverage_evidence"] = evidence.as_storage()
    if "session_hash" in value or "rooms" in value:
        # A grouped marker carries an observed native session and floor. Keep
        # its first-room fields so older stores can still load the envelope.
        for key in ("session_hash", "floor_token"):
            identity = value.get(key)
            if (
                not isinstance(identity, str)
                or re.fullmatch(r"[0-9a-f]{64}", identity) is None
            ):
                return None
            result[key] = identity
        if "run_id" not in result or "cleaning_mode" not in result:
            return None
        if "rooms" in value:
            rooms = validated_grouped_rooms(
                {**result, "rooms": value["rooms"]},
                validate_room=_validated_native_reconciliation,
                max_rooms=MAX_ROOM_SEQUENCE_SIZE,
            )
            if rooms is None:
                return None
            result["rooms"] = rooms
    return result


def _native_completion_settings(
    pending: Mapping[str, Any], room: Room | CleaningRoom
) -> CleaningRoom | None:
    """Return only settings frozen by this marker or its exact run checkpoint."""
    mode = pending.get("cleaning_mode")
    coverage = pending.get("coverage_setting")
    cadence_state = pending.get("cadence_state")
    if isinstance(cadence_state, Mapping):
        cadence_mode = cadence_state.get("effective_cleaning_mode")
        cadence_coverage = cadence_state.get("effective_coverage_setting")
        if (mode is not None and cadence_mode != mode) or (
            coverage is not None and cadence_coverage != coverage
        ):
            return None
        mode = cadence_mode
        coverage = cadence_coverage
    if (
        isinstance(mode, str)
        and mode in ("vacuum", "mop", "vacuum_and_mop")
        and isinstance(coverage, str)
        and coverage in ("quick", "standard", "heavy_duty")
    ):
        room_id = room.room_id if isinstance(room, CleaningRoom) else room.id
        return CleaningRoom(room_id, room.name, mode, coverage)
    return None


def _attach_cadence_state(robot: dict[str, Any], pending: dict[str, Any]) -> None:
    """Freeze the dispatched schedule into its exact late-history marker."""
    for child in pending.get("rooms", []):
        _attach_cadence_state(robot, child)
    run = robot.get("last_run")
    if (
        not isinstance(run, dict)
        or run.get("run_id") != pending.get("run_id")
        or run.get("plan_id") != pending.get("plan_id")
    ):
        return
    checkpoint = run.get("recovery_checkpoint")
    by_room = (
        checkpoint.get("cadence_by_room") if isinstance(checkpoint, dict) else None
    )
    state = (
        by_room.get(pending.get("room_id")) if isinstance(by_room, Mapping) else None
    )
    cadence_state = _validated_cadence_snapshot(state)
    if cadence_state is not None:
        pending["cadence_state"] = cadence_state
    evidence = coverage_evidence_from_storage(
        checkpoint.get("coverage_evidence") if isinstance(checkpoint, dict) else None
    )
    if evidence is not None and pending["room_id"] in dict(evidence.room_regions):
        pending["coverage_evidence"] = evidence.as_storage()


def _native_reconciliation_key(pending: Mapping[str, Any]) -> str:
    """Build a bounded opaque key for one room dispatch's native completion."""
    digest = hashlib.sha256(b"matic-native-reconciliation-v1\0")
    for value in (
        str(pending["plan_id"]),
        str(pending["room_id"]),
        str(pending.get("run_id", "")),
        str(pending["dispatched_at"]),
    ):
        raw = value.encode("utf-8", "surrogatepass")
        digest.update(struct.pack(">I", len(raw)))
        digest.update(raw)
    return digest.hexdigest()


def _native_reconciliation_was_committed(
    robot: Mapping[str, Any], pending: Mapping[str, Any]
) -> bool:
    """Check dispatch-scoped deduplication, never a room's unrelated history."""
    keys = robot.get("native_completion_dedup")
    return isinstance(keys, list) and _native_reconciliation_key(pending) in keys


def _remember_native_reconciliation(
    robot: dict[str, Any], pending: Mapping[str, Any]
) -> None:
    """Retain a bounded completion receipt alongside native plan history."""
    keys = robot.setdefault("native_completion_dedup", [])
    if not isinstance(keys, list):
        keys = []
        robot["native_completion_dedup"] = keys
    key = _native_reconciliation_key(pending)
    if key not in keys:
        keys.append(key)
        del keys[:-NATIVE_COMPLETION_DEDUP_MAX_KEYS]


def _native_reconciliation_expired(pending: Mapping[str, Any]) -> bool:
    """Return whether a durable late-completion marker passed its fixed window."""
    return _native_reconciliation_remaining_seconds(pending) <= 0


def _stop_fence_remaining_seconds(value: object) -> float | None:
    """Return remaining wall-clock fence time from one stored absolute expiry."""
    if not isinstance(value, str):
        return None
    expires_at = dt_util.parse_datetime(value)
    if expires_at is None or expires_at.tzinfo is None:
        return None
    return (expires_at - dt_util.utcnow()).total_seconds()


def _native_reconciliation_remaining_seconds(
    pending: Mapping[str, Any],
) -> float:
    """Return wall-clock seconds left for durable stop reconciliation."""
    expires_at = cast(datetime, dt_util.parse_datetime(pending["expires_at"]))
    return (expires_at - dt_util.utcnow()).total_seconds()


def _reconcile_pending_native_history(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
    *,
    on_reconciled: Callable[[dict[str, Any]], None] | None = None,
    verified_coverage_receipt: CoverageReceipt | None = None,
) -> bool:
    """Apply exactly one retained native completion to a pending plan room."""
    pending = _validated_native_reconciliation(
        robot.get("pending_native_reconciliation")
    )
    if pending is None:
        return False
    if _native_reconciliation_expired(pending):
        robot.pop("pending_native_reconciliation", None)
        return True
    if "rooms" in pending:
        if pending["floor_token"] != plan_floor_token(floor_plan):
            return False
        changed = False
        records = tuple(records)
        for child in pending["rooms"]:
            if _native_reconciliation_was_committed(robot, child):
                continue
            changed |= _reconcile_native_room_history(
                robot,
                floor_plan,
                records,
                child,
                on_reconciled=on_reconciled,
                verified_coverage_receipt=verified_coverage_receipt,
            )
        if all(
            _native_reconciliation_was_committed(robot, child)
            for child in pending["rooms"]
        ):
            robot.pop("pending_native_reconciliation", None)
            return True
        return changed
    changed = _reconcile_native_room_history(
        robot,
        floor_plan,
        records,
        pending,
        on_reconciled=on_reconciled,
        verified_coverage_receipt=verified_coverage_receipt,
    )
    if changed:
        robot.pop("pending_native_reconciliation", None)
    return changed


def _native_marker_matches(
    records: Iterable[CleaningSessionRecord], pending: Mapping[str, Any]
) -> tuple[NativeRoomCompletion, ...]:
    """Match the settings and identity frozen by a validated marker."""
    return match_native_reconciliation_room(records, pending, dt_util.utcnow())


def _reconcile_native_room_history(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
    pending: dict[str, Any],
    *,
    on_reconciled: Callable[[dict[str, Any]], None] | None,
    verified_coverage_receipt: CoverageReceipt | None,
) -> bool:
    """Apply one room's proof within a retained native dispatch."""
    room = next(
        (
            item
            for item in floor_plan.rooms
            if item.id == pending["room_id"]
            and _native_room_key(item.name) == _native_room_key(pending["room"])
        ),
        None,
    )
    if room is None:
        return False
    matches = _native_marker_matches(records, pending)
    if len(matches) != 1:
        return False
    if _native_reconciliation_was_committed(robot, pending):
        # A prior write may have committed the room before the pending marker
        # was removed. Clear that stale marker without adding history or
        # cadence credit a second time.
        _repair_native_reconciled_run(robot, pending, pending["plan_id"])
        if on_reconciled is not None:
            on_reconciled(pending)
        return True
    room_settings = _native_completion_settings(pending, room)
    try:
        completion_identity = room_cadence_identity(floor_plan, room.id)
    except ValueError:
        completion_identity = None
    _record_native_completion(
        robot,
        pending["plan_id"],
        room,
        completed_at=matches[0].ended_at,
        duration_seconds=matches[0].duration_seconds,
        room_settings=room_settings,
        room_identity=completion_identity,
        run_id=pending.get("run_id"),
        session_hash=_daily_session_hash(matches[0].record.key),
    )
    _remember_native_reconciliation(robot, pending)
    if "session_hash" in pending:
        robot["rooms"][room.id]["last_completed_run_id"] = pending["run_id"]
        robot["rotations"][pending["plan_id"]]["rooms"][room.id]["run_id"] = pending[
            "run_id"
        ]
    cadence_state = pending.get("cadence_state")
    if isinstance(cadence_state, Mapping) and room_settings is not None:
        try:
            current_identity = room_cadence_identity(floor_plan, room.id)
        except ValueError:
            current_identity = None
        _apply_verified_cadence(
            robot,
            pending["plan_id"],
            room_settings,
            cadence_state,
            current_identity=current_identity,
            validate_current_identity=True,
            verified_coverage=verified_room_coverage(
                pending.get("coverage_evidence"),
                verified_coverage_receipt
                if verified_coverage_receipt is not None
                and native_session_hash(matches[0].record.key)
                == verified_coverage_receipt.session_hash
                else None,
                room.id,
                room_settings.cleaning_mode,
                room_settings.coverage_setting,
                cadence_state,
            ),
        )
    _repair_native_reconciled_run(robot, pending, pending["plan_id"])
    if on_reconciled is not None:
        on_reconciled(pending)
    return True


def _repair_native_reconciled_run(
    robot: dict[str, Any], pending: Mapping[str, Any], plan_id: str
) -> None:
    """Repair the matching managed run after a late native completion."""
    last_run = robot.get("last_run")
    if (
        not isinstance(last_run, dict)
        or last_run.get("run_id") != pending.get("run_id")
        or last_run.get("plan_id") != plan_id
    ):
        return
    room_count = _stored_count(last_run, "room_count")
    completed_count = _stored_count(last_run, "completed_room_count")
    if completed_count < room_count:
        completed_count += 1
        last_run["completed_room_count"] = completed_count
        if last_run.get("outcome") == "running" and "session_hash" not in pending:
            last_run["native_reconciled_completion"] = True
        checkpoint = last_run.get("recovery_checkpoint")
        if isinstance(checkpoint, dict):
            completed_ids = checkpoint.setdefault("completed_room_ids", [])
            if (
                isinstance(completed_ids, list)
                and pending["room_id"] not in completed_ids
            ):
                completed_ids.append(pending["room_id"])
    if (
        "session_hash" not in pending
        and completed_count >= room_count
        and last_run.get("outcome")
        in {
            "cancelled",
            "failed",
            "unverified",
        }
    ):
        last_run.update(
            {
                "outcome": "completed",
                "reason_code": "all_rooms_verified",
                "cause": "verified_completion",
            }
        )
    repair_run_history(robot, last_run, pending.get("room"))


def _record_native_completion(
    robot: dict[str, Any],
    plan_id: str,
    room: CleaningRoom | Room,
    *,
    completed_at: str,
    duration_seconds: int | None,
    room_settings: CleaningRoom | None,
    room_identity: str | None = None,
    run_id: str | None = None,
    session_hash: str | None = None,
) -> None:
    """Commit one verified native completion into plan and global history."""
    rotation = robot["rotations"].setdefault(plan_id, {"rooms": {}})
    room_records = rotation.setdefault("rooms", {})
    room_id = room.room_id if isinstance(room, CleaningRoom) else room.id
    daily_room_limit.record_completion(
        robot,
        room_id,
        room_identity,
        completed_at,
        now=dt_util.utcnow(),
        run_id=run_id,
        session_hash=session_hash,
    )
    record = room_records.setdefault(room_id, {})
    record["room_id"] = room_id
    record["name"] = room.name
    record["duration_profiles"] = _duration_profiles(record)
    active = robot.get("active_plan")
    if not (
        isinstance(active, Mapping)
        and active.get("plan_id") == plan_id
        and active.get("room_id") == room_id
        and _duration_profile_key(record)
        != _duration_profile_key(asdict(room_settings) if room_settings else {})
    ):
        _admit_room_settings(record, room_settings)
    record["last_completed"] = completed_at
    record["last_result"] = "completed"
    record["completed_runs"] = _stored_count(record, "completed_runs") + 1
    record["last_native_reconciled"] = dt_util.utcnow().isoformat()
    duration = (
        duration_seconds
        if isinstance(duration_seconds, int)
        and not isinstance(duration_seconds, bool)
        and duration_seconds > 0
        else None
    )
    if duration is not None:
        _record_duration_sample(record, room_settings, duration, completed_at)
    global_room = _global_room(robot, room)
    global_room["name"] = room.name
    global_room["last_completed"] = completed_at
    if duration is not None:
        global_room["last_duration_seconds"] = duration
    global_room["completed_runs"] = _stored_count(global_room, "completed_runs") + 1


def _import_native_room_activity(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
) -> bool:
    """Record where the robot worked, which is not proof that it finished.

    Native partial or completed modes establish activity, while unattempted or
    unknown modes do not. External runs have no matching managed dispatch, so
    this importer updates rotation opportunities without completion credit.
    Legacy summaries retain their conservative completed-room activity subset.
    """
    records = tuple(records)
    room_lookup: dict[str, tuple[str, str] | None] = {}
    for room in floor_plan.rooms:
        key = _native_room_key(room.name)
        room_lookup[key] = None if key in room_lookup else (room.id, room.name)

    candidates: dict[str, tuple[float, str, str]] = {}
    by_protocol_id = {room.protocol_id: room for room in floor_plan.rooms}
    for record in records:
        session = record.session
        timestamp = _latest_timestamp(session.ended_at)
        if timestamp is None or not isinstance(session.ended_at, str):
            continue
        canonical = session.mission_id is not None or session.partition_id is not None
        mapped_rooms: list[tuple[str, str] | None]
        if canonical:
            if (
                session.mission_id != floor_plan.mission_id
                or session.partition_id != floor_plan.partition_protocol_id
            ):
                continue
            worked_ids = {
                result.room_id
                for result in session.mode_results
                if result.status in {"partial", "completed"}
                and result.room_id is not None
            }
            mapped_rooms = [
                (by_protocol_id[room_id].id, by_protocol_id[room_id].name)
                for room_id in worked_ids
                if room_id in by_protocol_id
            ]
        else:
            if native_statistics_have_ambiguous_floor(floor_plan):
                continue
            worked_names = (
                session.visited_rooms
                if session.mode_results
                else session.completed_rooms
            )
            mapped_rooms = [
                room_lookup.get(_native_room_key(name)) for name in worked_names
            ]
        for mapped_room in mapped_rooms:
            if mapped_room is None:
                continue
            room_id, room_name = mapped_room
            current = candidates.get(room_id)
            if current is None or timestamp >= current[0]:
                candidates[room_id] = (timestamp, session.ended_at, room_name)

    changed = False
    for room_id, (timestamp, ended_at, name) in candidates.items():
        global_room = robot["rooms"].setdefault(room_id, {})
        known = _latest_timestamp(
            global_room.get("last_opportunity"),
            global_room.get("last_completed"),
        )
        if known is not None and known >= timestamp:
            continue
        updates = {"name": name, "last_opportunity": ended_at}
        if any(global_room.get(key) != value for key, value in updates.items()):
            global_room.update(updates)
            changed = True
    return _import_native_room_statistics(robot, floor_plan, records) or changed


def _import_native_room_statistics(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
) -> bool:
    """Keep native per-mode statistics separate from verified run history."""
    now = dt_util.utcnow()
    current_floor_id = floor_plan.mission_id
    previous_floor_id = robot.get("robot_room_statistics_floor_id")
    changed = False
    if (
        isinstance(previous_floor_id, int)
        and not isinstance(previous_floor_id, bool)
        and previous_floor_id != current_floor_id
    ):
        robot["robot_room_statistics_floor_changed_at"] = now.isoformat()
        changed = True
    if previous_floor_id != current_floor_id:
        robot["robot_room_statistics_floor_id"] = current_floor_id
        changed = True
    changed_at = _latest_timestamp(robot.get("robot_room_statistics_floor_changed_at"))
    statistics = native_room_statistics_by_session(
        records,
        floor_plan.rooms,
        now=now,
        future_tolerance_seconds=ROTATION_FUTURE_TOLERANCE_SECONDS,
        multiple_floors_known=native_statistics_have_ambiguous_floor(floor_plan),
        minimum_timestamp=changed_at,
        floor_plan=floor_plan,
    )
    # If a retained canonical session is revised so its old floor or
    # partition proof no longer matches, retract its cached statistics. A
    # missing session alone remains retention loss and is not a retraction.
    records_by_hash = {
        hashlib.sha256(record.key).hexdigest(): record for record in records
    }
    for room_id, stored in robot["rooms"].items():
        if not isinstance(stored, dict) or not isinstance(
            stored.get("robot_last_session_hash"), str
        ):
            continue
        prior = records_by_hash.get(stored["robot_last_session_hash"])
        ended = stored.get("robot_last_completed")
        stored_floor = stored.get("robot_last_floor_id")
        stored_partition_hash = stored.get("robot_last_partition_hash")
        timestamp = _latest_timestamp(ended)
        if (
            prior is None
            or not isinstance(ended, str)
            or timestamp is None
            or not isinstance(stored_floor, int)
            or not isinstance(stored_partition_hash, str)
        ):
            continue
        session = prior.session
        current_partition_hash = (
            hashlib.sha256(session.partition_id.encode()).hexdigest()
            if isinstance(session.partition_id, str)
            else None
        )
        if (
            session.mission_id == stored_floor
            and current_partition_hash == stored_partition_hash
            and _latest_timestamp(session.ended_at) is not None
        ):
            continue
        rejected = NativeRoomStatistic(
            room_id,
            str(stored.get("name", room_id)),
            ended,
            0,
            timestamp,
            stored.get("robot_last_session_started_at"),
            stored["robot_last_session_hash"],
            {},
            frozenset(),
            frozenset({"vacuum", "mop"}),
            frozenset(),
            stored_partition_hash,
        )
        changed = (
            _apply_native_room_statistics(robot, stored_floor, {room_id: (rejected,)})
            or changed
        )
    return _apply_native_room_statistics(robot, current_floor_id, statistics) or changed


def _global_room(robot: dict[str, Any], room: CleaningRoom | Room) -> dict[str, Any]:
    records = robot["rooms"]
    room_id = room.room_id if isinstance(room, CleaningRoom) else room.id
    record = records.get(room_id)
    if not isinstance(record, dict):
        record = {"name": room.name, "completed_runs": 0}
        records[room_id] = record
    return cast(dict[str, Any], record)


def _apply_native_room_statistics(
    robot: dict[str, Any],
    floor_id: int,
    histories: Mapping[str, tuple[NativeRoomStatistic, ...]],
) -> bool:
    """Apply per-session evidence, retaining bounded mode tombstones."""
    changed = False
    # Upgrade legacy negative evidence independently of this refresh's page.
    # Native history can omit an older session or even the entire room, but a
    # later page must not erase the rejection before that session reappears.
    for room in robot["rooms"].values():
        if not isinstance(room, dict):
            continue
        tombstones = _native_mode_tombstones(room.get("robot_native_mode_tombstones"))
        old_tombstones = room.get("robot_native_mode_tombstones", [])
        legacy_tombstones = (
            (
                room.get("robot_last_invalid_floor_id"),
                room.get("robot_last_invalid_session_hash"),
                room.get("robot_last_invalid_session_started_at"),
                room.get("robot_last_invalidated_at"),
                room.get("robot_last_invalid_modes"),
            ),
            (
                room.get("robot_last_floor_id"),
                room.get("robot_last_session_hash"),
                room.get("robot_last_session_started_at"),
                room.get("robot_last_completed"),
                room.get("robot_last_conflicted_modes"),
            ),
        )
        for (
            legacy_floor,
            legacy_hash,
            legacy_start,
            legacy_end,
            legacy_modes,
        ) in legacy_tombstones:
            if room.get(
                "robot_last_invalid_source"
            ) == "managed_session" and legacy_hash == room.get(
                "robot_last_invalid_session_hash"
            ):
                continue
            if (
                not isinstance(legacy_floor, int)
                or isinstance(legacy_floor, bool)
                or not isinstance(legacy_hash, str)
                or not isinstance(legacy_end, str)
                or not isinstance(legacy_modes, list)
            ):
                continue
            valid_modes = {mode for mode in legacy_modes if mode in {"vacuum", "mop"}}
            if valid_modes:
                changed = (
                    _remember_native_mode_tombstone_identity(
                        tombstones,
                        legacy_floor,
                        legacy_hash,
                        legacy_start,
                        legacy_end,
                        valid_modes,
                    )
                    or changed
                )
        if old_tombstones != tombstones:
            room["robot_native_mode_tombstones"] = tombstones
            changed = True

    for room_id, history in histories.items():
        room = robot["rooms"].setdefault(room_id, {})
        prior_modes = _positive_native_mode_durations(
            room.get("robot_last_completed_mode_durations")
        )
        stored_hash = room.get("robot_last_session_hash")
        stored_end = room.get("robot_last_completed")
        if room.get("robot_last_invalid_source") != "managed_session":
            stored_hash = stored_hash or room.get("robot_last_invalid_session_hash")
            stored_end = stored_end or room.get("robot_last_invalidated_at")
        same_stored = (
            isinstance(stored_hash, str)
            and isinstance(stored_end, str)
            and room.get("robot_last_floor_id", room.get("robot_last_invalid_floor_id"))
            == floor_id
        )
        tombstones = _native_mode_tombstones(room.get("robot_native_mode_tombstones"))

        candidates: list[tuple[NativeRoomStatistic, dict[str, int], set[str]]] = []
        retracted: NativeRoomStatistic | None = None
        touched_tombstones = False
        for statistic in history:
            same_session = same_stored and stored_hash == statistic.session_hash
            session_modes = prior_modes if same_session else {}
            conflicting = set(statistic.conflicting_modes)
            if same_session:
                stored_conflicts = room.get("robot_last_conflicted_modes", [])
                if isinstance(stored_conflicts, list):
                    conflicting.update(
                        mode for mode in stored_conflicts if mode in {"vacuum", "mop"}
                    )
                stored_invalid_modes = room.get("robot_last_invalid_modes", [])
                if isinstance(stored_invalid_modes, list):
                    conflicting.update(
                        mode
                        for mode in stored_invalid_modes
                        if mode in {"vacuum", "mop"}
                    )
                conflicting.update(
                    mode
                    for mode, duration in statistic.mode_durations.items()
                    if mode in session_modes and session_modes[mode] != duration
                )
            tombstoned = _native_tombstone_modes(tombstones, floor_id, statistic)
            explicit = set(statistic.invalidated_modes)
            persistent = set(conflicting)
            persistent.update(explicit & statistic.reported_completed_modes)
            if same_session:
                persistent.update(explicit & session_modes.keys())
            if persistent:
                touched_tombstones = (
                    _remember_native_mode_tombstone(
                        tombstones, floor_id, statistic, persistent
                    )
                    or touched_tombstones
                )
                tombstoned.update(persistent)

            modes = {
                mode: duration
                for mode, duration in statistic.mode_durations.items()
                if mode not in tombstoned
            }
            if same_session:
                modes = {
                    **{
                        mode: duration
                        for mode, duration in session_modes.items()
                        if mode not in tombstoned
                    },
                    **modes,
                }
            if modes:
                candidates.append((statistic, modes, conflicting | tombstoned))
            elif same_session and persistent & session_modes.keys():
                retracted = statistic

        old_tombstones = room.get("robot_native_mode_tombstones", [])
        if touched_tombstones or old_tombstones != tombstones:
            room["robot_native_mode_tombstones"] = tombstones[-64:]
            changed = True

        positive_timestamp = _latest_timestamp(room.get("robot_last_completed"))
        existing_timestamp = _latest_timestamp(
            room.get("robot_last_completed"), room.get("robot_last_invalidated_at")
        )
        managed = next(
            (
                statistic
                for statistic in history
                if (
                    room.get("robot_last_invalid_source") == "managed_session"
                    and room.get("robot_last_managed_session_hash")
                    == statistic.session_hash
                    and room.get("robot_last_invalid_floor_id") == floor_id
                )
            ),
            None,
        )
        if managed is None:
            managed = next(
                (
                    statistic
                    for statistic in history
                    if (
                        existing_timestamp is None
                        or statistic.timestamp >= existing_timestamp
                    )
                    and (
                        room.get("robot_last_managed_session_hash")
                        == statistic.session_hash
                        or _native_room_statistic_matches_managed_history(
                            robot, statistic
                        )
                    )
                ),
                None,
            )
        selected = max(candidates, key=lambda item: item[0].timestamp, default=None)
        if managed is not None and (
            selected is None or managed.timestamp >= selected[0].timestamp
        ):
            updates: dict[str, Any] = {
                "robot_last_invalidated_at": managed.ended_at,
                "robot_last_invalid_session_hash": managed.session_hash,
                "robot_last_invalid_session_started_at": managed.started_at,
                "robot_last_invalid_floor_id": floor_id,
                "robot_last_invalid_source": "managed_session",
                "robot_last_managed_session_hash": managed.session_hash,
                "robot_last_managed_session_started_at": managed.started_at,
            }
            for key in (
                "robot_last_completed",
                "robot_last_duration_seconds",
                "robot_last_completed_mode_durations",
                "robot_last_session_hash",
                "robot_last_session_started_at",
                "robot_last_floor_id",
                "robot_last_partition_hash",
            ):
                if key in room:
                    room.pop(key)
                    changed = True
            if any(room.get(key) != value for key, value in updates.items()):
                changed = True
                room.update(updates)
            continue

        if retracted is not None:
            invalidation = {
                "robot_last_invalidated_at": retracted.ended_at,
                "robot_last_invalid_session_hash": retracted.session_hash,
                "robot_last_invalid_session_started_at": retracted.started_at,
                "robot_last_invalid_floor_id": floor_id,
                "robot_last_invalid_source": "mode_retracted",
            }
            if any(room.get(key) != value for key, value in invalidation.items()):
                changed = True
                room.update(invalidation)

        if selected is None:
            if retracted is not None:
                for key in (
                    "robot_last_completed",
                    "robot_last_duration_seconds",
                    "robot_last_completed_mode_durations",
                    "robot_last_session_hash",
                    "robot_last_session_started_at",
                    "robot_last_floor_id",
                    "robot_last_partition_hash",
                    "robot_last_conflicted_modes",
                ):
                    if key in room:
                        room.pop(key)
                        changed = True
                room["robot_last_invalid_modes"] = sorted(
                    _native_tombstone_modes(tombstones, floor_id, retracted)
                )
            continue

        statistic, modes, excluded = selected
        if (
            positive_timestamp is not None
            and statistic.timestamp < positive_timestamp
            and retracted is None
        ):
            continue
        if (
            positive_timestamp is not None
            and statistic.timestamp == positive_timestamp
            and stored_hash != statistic.session_hash
            and retracted is None
        ):
            continue
        updates = {
            "name": statistic.room_name,
            "robot_last_completed": statistic.ended_at,
            "robot_last_duration_seconds": sum(modes.values()),
            "robot_last_completed_mode_durations": modes,
            "robot_last_session_hash": statistic.session_hash,
            "robot_last_session_started_at": statistic.started_at,
            "robot_last_floor_id": floor_id,
            "robot_last_conflicted_modes": sorted(excluded),
        }
        if statistic.partition_hash is not None:
            updates["robot_last_partition_hash"] = statistic.partition_hash
        else:
            room.pop("robot_last_partition_hash", None)
        if any(room.get(key) != value for key, value in updates.items()):
            changed = True
            room.update(updates)
        invalid_at = _latest_timestamp(room.get("robot_last_invalidated_at"))
        if invalid_at is None or statistic.timestamp > invalid_at:
            for key in (
                "robot_last_invalidated_at",
                "robot_last_invalid_session_hash",
                "robot_last_invalid_session_started_at",
                "robot_last_invalid_floor_id",
                "robot_last_invalid_modes",
                "robot_last_invalid_source",
                "robot_last_managed_session_hash",
                "robot_last_managed_session_started_at",
            ):
                room.pop(key, None)
    return changed


def _positive_native_mode_durations(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {
        mode: duration
        for mode, duration in value.items()
        if mode in {"vacuum", "mop"}
        and isinstance(duration, int)
        and not isinstance(duration, bool)
        and duration > 0
    }


def _native_mode_tombstones(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        session_hash = item.get("session_hash")
        ended_at = item.get("ended_at")
        floor_id = item.get("floor_id")
        modes = item.get("modes")
        if (
            not isinstance(session_hash, str)
            or not isinstance(ended_at, str)
            or not isinstance(floor_id, int)
            or isinstance(floor_id, bool)
            or not isinstance(modes, list)
        ):
            continue
        normalized.append(
            {
                "session_hash": session_hash,
                "started_at": item.get("started_at"),
                "ended_at": ended_at,
                "floor_id": floor_id,
                "modes": sorted({mode for mode in modes if mode in {"vacuum", "mop"}}),
            }
        )
    return normalized[-64:]


def _native_tombstone_modes(
    tombstones: list[dict[str, Any]], floor_id: int, statistic: NativeRoomStatistic
) -> set[str]:
    return {
        mode
        for item in tombstones
        if item["floor_id"] == floor_id
        and item["session_hash"] == statistic.session_hash
        for mode in item["modes"]
    }


def _remember_native_mode_tombstone(
    tombstones: list[dict[str, Any]],
    floor_id: int,
    statistic: NativeRoomStatistic,
    modes: set[str],
) -> bool:
    return _remember_native_mode_tombstone_identity(
        tombstones,
        floor_id,
        statistic.session_hash,
        statistic.started_at,
        statistic.ended_at,
        modes,
    )


def _remember_native_mode_tombstone_identity(
    tombstones: list[dict[str, Any]],
    floor_id: int,
    session_hash: str,
    started_at: str | None,
    ended_at: str,
    modes: set[str],
) -> bool:
    existing = {
        mode
        for item in tombstones
        if item["floor_id"] == floor_id and item["session_hash"] == session_hash
        for mode in item["modes"]
    }
    merged = existing | modes
    if merged == existing:
        return False
    tombstones[:] = [
        item
        for item in tombstones
        if not (item["floor_id"] == floor_id and item["session_hash"] == session_hash)
    ]
    tombstones.append(
        {
            "session_hash": session_hash,
            "started_at": started_at,
            "ended_at": ended_at,
            "floor_id": floor_id,
            "modes": sorted(merged),
        }
    )
    del tombstones[:-64]
    return True


def _native_room_statistic_matches_managed_history(
    robot: Mapping[str, Any], statistic: NativeRoomStatistic
) -> bool:
    """Match a native session to any room start recorded for a managed run."""
    native_start = (
        dt_util.parse_datetime(statistic.started_at)
        if isinstance(statistic.started_at, str)
        else None
    )
    native_end = dt_util.parse_datetime(statistic.ended_at)
    if (
        native_start is None
        or native_start.tzinfo is None
        or native_end is None
        or native_end.tzinfo is None
    ):
        return False
    rotations = robot.get("rotations")
    if not isinstance(rotations, Mapping):
        return False
    for rotation in rotations.values():
        if not isinstance(rotation, Mapping):
            continue
        rooms = rotation.get("rooms")
        if not isinstance(rooms, Mapping):
            continue
        for record in rooms.values():
            if not isinstance(record, Mapping):
                continue
            raw_managed_start = record.get("last_started")
            managed_start = (
                dt_util.parse_datetime(raw_managed_start)
                if isinstance(raw_managed_start, str)
                else None
            )
            if managed_start is None or managed_start.tzinfo is None:
                continue
            if (
                native_start - timedelta(seconds=120)
                <= managed_start
                <= native_end + timedelta(seconds=120)
            ):
                return True
    return False
