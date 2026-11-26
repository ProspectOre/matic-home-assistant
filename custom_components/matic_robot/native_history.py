"""Durable native completion reconciliation and verified room accounting."""

from __future__ import annotations

import hashlib
import struct
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Any, cast

from homeassistant.util import dt as dt_util

from . import daily_room_limit
from .cadence_accounting import validated_cadence_snapshot
from .client import (
    CleaningSessionRecord,
    CoverageReceipt,
    FloorPlan,
    Room,
    is_sha256_hex,
    native_session_hash,
)
from .const import MAX_ROOM_SEQUENCE_SIZE
from .coverage_accounting import coverage_evidence_from_storage, verified_room_coverage
from .grouped_native_reconciliation import (
    match_native_reconciliation_room,
    validated_grouped_rooms,
)
from .native_completion import NativeRoomCompletion, native_room_key
from .plan_model import (
    CLEANING_MODES,
    COVERAGE_SETTINGS,
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
    stored_count,
)
from .plan_records import stored_active_plan, stored_last_run
from .plan_timing import (
    admit_room_settings,
    duration_profile_key,
    duration_profiles,
    latest_timestamp,
)
from .room_identity import native_statistics_have_ambiguous_floor
from .room_statistics_store import import_native_room_statistics
from .run_history import repair_run_history
from .run_machine import count_room
from .verified_completion import VerifiedCompletion, record_verified_completion

NATIVE_COMPLETION_DEDUP_MAX_KEYS = max(64, MAX_ROOM_SEQUENCE_SIZE)


def _daily_session_hash(key: bytes) -> str:
    """Keep a bounded session reference without persisting the native key."""
    return (
        native_session_hash(key)
        or hashlib.sha256(b"matic-daily-native-session\0" + key).hexdigest()
    )


def import_daily_native_uncertainty(
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
        rooms_by_name.setdefault(native_room_key(room.name), []).append(room)
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
                for room in rooms_by_name.get(native_room_key(name), ())
            }
        for room in reported_rooms:
            if daily_room_limit.parse_time(session.ended_at) is None:
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


def validated_native_reconciliation(
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
        not isinstance(cleaning_mode, str) or cleaning_mode not in CLEANING_MODES
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
            if isinstance(cleaning_mode, str) and cleaning_mode in CLEANING_MODES
            else {}
        ),
        **(
            {"coverage_setting": coverage_setting}
            if isinstance(coverage_setting, str)
            and coverage_setting in COVERAGE_SETTINGS
            else {}
        ),
        **(
            {"run_id": run_id}
            if isinstance(run_id, str) and 0 < len(run_id) <= 64
            else {}
        ),
    }
    cadence_state = validated_cadence_snapshot(value.get("cadence_state"))
    if cadence_state is not None:
        result["cadence_state"] = cadence_state
    evidence = coverage_evidence_from_storage(value.get("coverage_evidence"))
    if evidence is not None and room_id in dict(evidence.room_regions):
        result["coverage_evidence"] = evidence.as_storage()
    if "session_hash" in value or "rooms" in value:
        # A session-bound marker carries its native session and floor. A grouped
        # marker keeps its first-room fields so older stores can still load it.
        for key in ("session_hash", "floor_token"):
            if not is_sha256_hex(value.get(key)):
                return None
            result[key] = value[key]
        if "run_id" not in result or "cleaning_mode" not in result:
            return None
        if "rooms" in value:
            rooms = validated_grouped_rooms(
                {**result, "rooms": value["rooms"]},
                validate_room=validated_native_reconciliation,
                max_rooms=MAX_ROOM_SEQUENCE_SIZE,
            )
            if rooms is None:
                return None
            result["rooms"] = rooms
    return result


def native_completion_settings(
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
        mode, coverage = cadence_mode, cadence_coverage
    if (
        isinstance(mode, str)
        and mode in CLEANING_MODES
        and isinstance(coverage, str)
        and coverage in COVERAGE_SETTINGS
    ):
        room_id = room.room_id if isinstance(room, CleaningRoom) else room.id
        return CleaningRoom(room_id, room.name, mode, coverage)
    return None


def attach_cadence_state(robot: dict[str, Any], pending: dict[str, Any]) -> None:
    """Freeze the dispatched schedule into its exact late-history marker."""
    for child in pending.get("rooms", []):
        attach_cadence_state(robot, child)
    run = stored_last_run(robot)
    if (
        run is None
        or run.run_id != pending.get("run_id")
        or run.plan_id != pending.get("plan_id")
    ):
        return
    checkpoint = run.checkpoint
    by_room = checkpoint.cadence_by_room if checkpoint is not None else None
    state = (
        by_room.get(cast(str, pending.get("room_id"))) if by_room is not None else None
    )
    if (cadence_state := validated_cadence_snapshot(state)) is not None:
        pending["cadence_state"] = cadence_state
    evidence = coverage_evidence_from_storage(
        checkpoint.coverage_evidence if checkpoint is not None else None
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


def native_reconciliation_was_committed(
    robot: Mapping[str, Any], pending: Mapping[str, Any]
) -> bool:
    """Check dispatch-scoped deduplication, never a room's unrelated history."""
    keys = robot.get("native_completion_dedup")
    return isinstance(keys, list) and _native_reconciliation_key(pending) in keys


def remember_native_reconciliation(
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


def native_reconciliation_expired(pending: Mapping[str, Any]) -> bool:
    """Return whether a durable late-completion marker passed its fixed window."""
    return native_reconciliation_remaining_seconds(pending) <= 0


def stop_fence_remaining_seconds(value: object) -> float | None:
    """Return remaining wall-clock fence time from one stored absolute expiry."""
    if not isinstance(value, str):
        return None
    expires_at = dt_util.parse_datetime(value)
    if expires_at is None or expires_at.tzinfo is None:
        return None
    return (expires_at - dt_util.utcnow()).total_seconds()


def native_reconciliation_remaining_seconds(
    pending: Mapping[str, Any],
) -> float:
    """Return wall-clock seconds left for durable stop reconciliation."""
    expires_at = cast(datetime, dt_util.parse_datetime(pending["expires_at"]))
    return (expires_at - dt_util.utcnow()).total_seconds()


def native_marker_on_floor(
    pending: Mapping[str, Any], floor_plan: FloorPlan | None
) -> bool:
    """Return whether a marker may be credited against this floor.

    A session-bound marker keeps the floor it was dispatched on; a room with
    the same id on another floor is a different room and earns nothing.
    """
    if "floor_token" not in pending:
        return True
    return floor_plan is not None and pending["floor_token"] == plan_floor_token(
        floor_plan
    )


def reconcile_pending_native_history(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
    *,
    on_reconciled: Callable[[dict[str, Any]], None] | None = None,
    verified_coverage_receipt: CoverageReceipt | None = None,
) -> bool:
    """Apply exactly one retained native completion to a pending plan room."""
    pending = validated_native_reconciliation(
        robot.get("pending_native_reconciliation")
    )
    if pending is None:
        return False
    if native_reconciliation_expired(pending):
        robot.pop("pending_native_reconciliation", None)
        return True
    if not native_marker_on_floor(pending, floor_plan):
        return False
    if "rooms" in pending:
        changed = False
        records = tuple(records)
        for child in pending["rooms"]:
            if native_reconciliation_was_committed(robot, child):
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
            native_reconciliation_was_committed(robot, child)
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


def native_marker_matches(
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
            and native_room_key(item.name) == native_room_key(pending["room"])
        ),
        None,
    )
    if room is None:
        return False
    matches = native_marker_matches(records, pending)
    if len(matches) != 1:
        return False
    if native_reconciliation_was_committed(robot, pending):
        # A prior write may have committed the room before the pending marker
        # was removed. Clear that stale marker without adding history or
        # cadence credit a second time.
        repair_native_reconciled_run(robot, pending, pending["plan_id"])
        if on_reconciled is not None:
            on_reconciled(pending)
        return True
    room_settings = native_completion_settings(pending, room)
    try:
        completion_identity = room_cadence_identity(floor_plan, room.id)
    except ValueError:
        completion_identity = None
    receipt = (
        verified_coverage_receipt
        if verified_coverage_receipt is not None
        and native_session_hash(matches[0].record.key)
        == verified_coverage_receipt.session_hash
        else None
    )
    record_native_completion(
        robot,
        pending["plan_id"],
        room,
        completed_at=matches[0].ended_at,
        duration_seconds=matches[0].duration_seconds,
        room_settings=room_settings,
        room_identity=completion_identity,
        run_id=pending.get("run_id"),
        session_hash=_daily_session_hash(matches[0].record.key),
        cadence_state=pending.get("cadence_state"),
        cadence_key=pending.get("run_id") or pending["dispatched_at"],
        verified_coverage=verified_room_coverage(
            pending.get("coverage_evidence"),
            receipt,
            room.id,
            room_settings.cleaning_mode,
            room_settings.coverage_setting,
            pending.get("cadence_state"),
        )
        if room_settings is not None
        else None,
    )
    remember_native_reconciliation(robot, pending)
    if "session_hash" in pending:
        robot["rooms"][room.id]["last_completed_run_id"] = pending["run_id"]
        robot["rotations"][pending["plan_id"]]["rooms"][room.id]["run_id"] = pending[
            "run_id"
        ]
    repair_native_reconciled_run(robot, pending, pending["plan_id"])
    if on_reconciled is not None:
        on_reconciled(pending)
    return True


def repair_native_reconciled_run(
    robot: dict[str, Any], pending: Mapping[str, Any], plan_id: str
) -> None:
    """Repair the matching managed run after a late native completion."""
    run = stored_last_run(robot)
    if run is None or run.run_id != pending.get("run_id") or run.plan_id != plan_id:
        return
    # The caller's commit hands over its draft robot.
    last_run = robot["last_run"]
    if (
        count_room(last_run, pending["room_id"])
        and run.running
        and "session_hash" not in pending
    ):
        last_run["native_reconciled_completion"] = True
    if (
        "session_hash" not in pending
        and stored_count(last_run, "completed_room_count") >= run.room_count
        and run.outcome
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


def record_native_completion(
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
    cadence_state: object = None,
    cadence_key: str = "",
    verified_coverage: str | None = None,
) -> None:
    """Commit one verified native completion; no cadence state, no cadence credit."""
    rotation = robot["rotations"].setdefault(plan_id, {"rooms": {}})
    room_records = rotation.setdefault("rooms", {})
    room_id = room.room_id if isinstance(room, CleaningRoom) else room.id
    record = room_records.setdefault(room_id, {})
    record["room_id"] = room_id
    record["name"] = room.name
    record["duration_profiles"] = duration_profiles(record)
    active = stored_active_plan(robot)
    if not (
        active is not None
        and active.plan_id == plan_id
        and active.room_id == room_id
        and duration_profile_key(record)
        != duration_profile_key(asdict(room_settings) if room_settings else {})
    ):
        admit_room_settings(record, room_settings)
    record["last_native_reconciled"] = dt_util.utcnow().isoformat()
    record_verified_completion(
        robot,
        VerifiedCompletion(
            plan_id,
            room_id,
            room.name,
            completed_at,
            room_settings,
            duration_seconds
            if isinstance(duration_seconds, int)
            and not isinstance(duration_seconds, bool)
            and duration_seconds > 0
            else None,
            room_identity,
            run_id,
            session_hash,
            cadence_key,
            cadence_state,
            verified_coverage,
            native=True,
        ),
        record,
        now=dt_util.utcnow(),
    )


def import_native_room_activity(
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
        key = native_room_key(room.name)
        room_lookup[key] = None if key in room_lookup else (room.id, room.name)

    candidates: dict[str, tuple[float, str, str]] = {}
    by_protocol_id = {room.protocol_id: room for room in floor_plan.rooms}
    for record in records:
        session = record.session
        timestamp = latest_timestamp(session.ended_at)
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
                room_lookup.get(native_room_key(name)) for name in worked_names
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
        known = latest_timestamp(
            global_room.get("last_opportunity"),
            global_room.get("last_completed"),
        )
        if known is not None and known >= timestamp:
            continue
        updates = {"name": name, "last_opportunity": ended_at}
        if any(global_room.get(key) != value for key, value in updates.items()):
            global_room.update(updates)
            changed = True
    return import_native_room_statistics(robot, floor_plan, records) or changed
