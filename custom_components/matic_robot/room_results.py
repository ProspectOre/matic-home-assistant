"""Which recorded result a room's statistics show.

A verified managed result always counts. The robot's own report counts when it
fits the active floor and no managed run accounts for its session; a session
the robot reports alone never marks a room finished.
"""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta
from typing import Any

from .client import CleaningSession, FloorPlan
from .room_identity import native_statistics_have_ambiguous_floor

# How far a room start may precede the session that recorded it.
SESSION_LEAD = timedelta(seconds=120)

type RoomValue = tuple[str, int]


def managed_start_in_native_session(
    managed_start: datetime, native_start: datetime, native_end: datetime
) -> bool:
    """Whether a managed room start falls inside a robot-reported session."""
    return native_start - SESSION_LEAD <= managed_start <= native_end + SESSION_LEAD


def room_statistics_result(
    snapshot: dict[str, Any],
    room_id: str,
    floor_plan: FloorPlan | None,
    session: CleaningSession | None,
) -> tuple[bool, RoomValue | None]:
    """Return whether a managed run owns the room's value, and the value."""
    managed_historical = _managed_room_history_value(snapshot, room_id)
    native_historical = _robot_reported_room_history_value(
        snapshot, room_id, floor_plan
    )
    if _native_room_history_matches_managed_room(snapshot, room_id):
        native_historical = None
    historical = _latest_room_statistics_value(managed_historical, native_historical)
    ineligible_native = _native_room_history_is_ineligible(
        snapshot, room_id, floor_plan
    )
    if session is None or session.ended_at is None or floor_plan is None:
        return historical is not None or ineligible_native, historical
    if not any(room.id == room_id for room in floor_plan.rooms):
        return False, None
    managed, managed_value = _managed_room_session_value(
        snapshot, room_id, session.started_at, session.ended_at
    )
    if managed:
        unrelated_native = (
            None
            if _native_room_result_overlaps_session(
                native_historical, session.started_at, session.ended_at
            )
            else native_historical
        )
        return True, _latest_room_statistics_value(managed_value, unrelated_native)
    # The robot marks the room it occupied when a session ended and reports a
    # stopped session as completed, so its session alone keeps the last
    # verified value rather than crediting an interrupted room.
    return historical is not None or ineligible_native, historical


def room_statistics_source(
    snapshot: dict[str, Any],
    room_id: str,
    floor_plan: FloorPlan | None,
    result: tuple[bool, RoomValue | None],
    *,
    restored: bool,
) -> str | None:
    """Name the evidence behind a room statistic's value."""
    managed_session, value = result
    if value is None:
        return "restored_sensor_state" if restored else None
    native = _robot_reported_room_history_value(snapshot, room_id, floor_plan)
    if value == _managed_room_history_value(snapshot, room_id) or (
        managed_session and native != value
    ):
        return "verified_managed_result"
    if value == native:
        return (
            snapshot.get("robot_reported_completed_by_room", {})
            .get(room_id, {})
            .get("source")
        ) or "robot_native_mode_result_room_name_match"
    return "restored_sensor_state"


def native_statistics_blocked(
    snapshot: dict[str, Any], room_id: str, floor_plan: FloorPlan | None
) -> bool:
    """Whether the robot's report is withheld for want of floor identity."""
    return (
        floor_plan is not None
        and native_statistics_have_ambiguous_floor(floor_plan)
        and _robot_reported_room_history_value(snapshot, room_id, floor_plan) is None
    )


def _instant(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _managed_room_history_value(
    snapshot: dict[str, Any], room_id: str
) -> RoomValue | None:
    """Return the latest verified managed result for one room."""
    record = snapshot.get("last_completed_by_room", {}).get(room_id)
    if not isinstance(record, dict):
        return None
    completed = record.get("at")
    duration = record.get("duration_seconds")
    if not isinstance(completed, str) or not isinstance(duration, int | float):
        return None
    return completed, max(0, round(duration))


def _robot_reported_room_history_value(
    snapshot: dict[str, Any], room_id: str, floor_plan: FloorPlan | None
) -> RoomValue | None:
    """Return explicit per-mode completion reported by native robot history."""
    if floor_plan is None:
        return None
    record = snapshot.get("robot_reported_completed_by_room", {}).get(room_id)
    if not isinstance(record, dict):
        return None
    if record.get("floor_mission_id") != floor_plan.mission_id:
        return None
    source = record.get("source")
    if source == "robot_native_mode_result_identity_match":
        partition_hash = hashlib.sha256(
            floor_plan.partition_protocol_id.encode()
        ).hexdigest()
        if record.get("floor_partition_hash") != partition_hash:
            return None
    elif source == "robot_native_mode_result_room_name_match":
        if native_statistics_have_ambiguous_floor(floor_plan):
            return None
    else:
        return None
    completed = record.get("at")
    duration = record.get("duration_seconds")
    if (
        not isinstance(completed, str)
        or not isinstance(duration, int | float)
        or isinstance(duration, bool)
        or not math.isfinite(duration)
        or duration <= 0
    ):
        return None
    parsed = _instant(completed)
    if parsed is None or parsed.tzinfo is None:
        return None
    return completed, round(duration)


def _native_room_history_is_ineligible(
    snapshot: dict[str, Any], room_id: str, floor_plan: FloorPlan | None
) -> bool:
    """Detect persisted native statistics that no longer fit the active map."""
    if floor_plan is None:
        return False
    record = snapshot.get("robot_reported_completed_by_room", {}).get(room_id)
    if not isinstance(record, dict):
        return False
    source = record.get("source")
    if not isinstance(source, str) or not source.startswith("robot_native_mode_result"):
        return False
    if source not in {
        "robot_native_mode_result_room_name_match",
        "robot_native_mode_result_identity_match",
    }:
        return True
    return _robot_reported_room_history_value(snapshot, room_id, floor_plan) is None


def _native_room_result_overlaps_session(
    native: RoomValue | None, started_at: str | None, ended_at: str
) -> bool:
    """Identify native room evidence inside a known managed session window."""
    if native is None or started_at is None:
        return False
    started = _instant(started_at)
    ended = _instant(ended_at)
    result = _instant(native[0])
    if (
        started is None
        or started.tzinfo is None
        or ended is None
        or ended.tzinfo is None
        or result is None
        or result.tzinfo is None
    ):
        return False
    return started - SESSION_LEAD <= result <= ended


def _native_room_history_matches_managed_room(
    snapshot: dict[str, Any], room_id: str
) -> bool:
    """Reject native evidence whose session is represented by a managed run."""
    native_record = snapshot.get("robot_reported_completed_by_room", {}).get(room_id)
    if not isinstance(native_record, dict):
        return False
    native_started = native_record.get("started_at")
    raw_native_end = native_record.get("at")
    native_end = _instant(raw_native_end) if isinstance(raw_native_end, str) else None
    if native_end is None or native_end.tzinfo is None:
        return False
    parsed_start = _instant(native_started) if isinstance(native_started, str) else None
    for rotation in snapshot.get("plan_history", {}).values():
        rooms = rotation.get("rooms") if isinstance(rotation, dict) else None
        record = rooms.get(room_id) if isinstance(rooms, dict) else None
        if not isinstance(record, dict):
            continue
        raw_start = record.get("last_started")
        managed_start = _instant(raw_start) if isinstance(raw_start, str) else None
        if managed_start is None or managed_start.tzinfo is None:
            continue
        raw_end = record.get("last_completed")
        managed_end = _instant(raw_end) if isinstance(raw_end, str) else None
        if managed_end is None or managed_end.tzinfo is None:
            managed_end = managed_start
        if parsed_start is not None and parsed_start.tzinfo is not None:
            if managed_start_in_native_session(managed_start, parsed_start, native_end):
                return True
        elif managed_start - SESSION_LEAD <= native_end <= managed_end + SESSION_LEAD:
            return True
    return False


def _latest_room_statistics_value(
    first: RoomValue | None, second: RoomValue | None
) -> RoomValue | None:
    """Return the newer of two bounded room-statistics observations."""
    values = [value for value in (first, second) if value is not None]
    if not values:
        return None

    def timestamp(value: RoomValue) -> float:
        parsed = _instant(value[0])
        return parsed.timestamp() if parsed is not None else float("-inf")

    return max(values, key=timestamp)


def _managed_room_session_value(
    snapshot: dict[str, Any], room_id: str, started_at: str | None, ended_at: str
) -> tuple[bool, RoomValue | None]:
    """Use exact plan outcomes when a managed run overlaps the session."""
    started = _instant(started_at) if started_at is not None else None
    ended = _instant(ended_at)
    if started is None or ended is None:
        return False, None

    records: list[dict[str, Any]] = []
    relevant: list[dict[str, Any]] = []
    for rotation in snapshot.get("plan_history", {}).values():
        for record in rotation.get("rooms", {}).values():
            records.append(record)
            raw_started = record.get("last_started")
            room_started = (
                _instant(raw_started) if isinstance(raw_started, str) else None
            )
            if (
                room_started is not None
                and started - SESSION_LEAD <= room_started <= ended
            ):
                relevant.append(record)
    if not relevant:
        return False, None

    matching = [record for record in relevant if record.get("room_id") == room_id]
    if matching:
        record = max(matching, key=lambda item: str(item.get("last_started", "")))
        duration = record.get("last_duration_seconds")
        completed = record.get("last_completed")
        if (
            record.get("last_result") == "completed"
            and isinstance(completed, str)
            and isinstance(duration, int | float)
        ):
            return True, (completed, max(0, round(duration)))

    historical = [
        (completed, max(0, round(duration)))
        for record in records
        if record.get("room_id") == room_id
        and isinstance((completed := record.get("last_completed")), str)
        and isinstance((duration := record.get("last_duration_seconds")), int | float)
    ]
    return True, max(historical, default=None, key=lambda item: item[0])
