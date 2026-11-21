"""Stored per-room statistics from the robot's own session history."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from homeassistant.util import dt as dt_util

from .client import CleaningSessionRecord, FloorPlan
from .plan_timing import ROTATION_FUTURE_TOLERANCE_SECONDS, _latest_timestamp
from .room_statistics import (
    NATIVE_MODES,
    NativeRoomStatistic,
    native_room_statistics_by_session,
    native_statistics_have_ambiguous_floor,
)

_COMPLETION_KEYS = (
    "robot_last_completed",
    "robot_last_duration_seconds",
    "robot_last_completed_mode_durations",
    "robot_last_session_hash",
    "robot_last_session_started_at",
    "robot_last_floor_id",
    "robot_last_partition_hash",
)
_INVALIDATION_KEYS = (
    "robot_last_invalidated_at",
    "robot_last_invalid_session_hash",
    "robot_last_invalid_session_started_at",
    "robot_last_invalid_floor_id",
    "robot_last_invalid_modes",
    "robot_last_invalid_source",
    "robot_last_managed_session_hash",
    "robot_last_managed_session_started_at",
)


def import_native_room_statistics(
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
            NATIVE_MODES,
            frozenset(),
            stored_partition_hash,
        )
        changed = (
            _apply_native_room_statistics(robot, stored_floor, {room_id: (rejected,)})
            or changed
        )
    return _apply_native_room_statistics(robot, current_floor_id, statistics) or changed


@dataclass(frozen=True, slots=True)
class _StoredSession:
    """The session a room's stored statistics came from."""

    session_hash: object
    on_floor: bool
    modes: dict[str, int]


@dataclass(frozen=True, slots=True)
class _Candidate:
    """A session that still credits modes, and the modes it may not credit."""

    statistic: NativeRoomStatistic
    modes: dict[str, int]
    excluded: set[str]


@dataclass(frozen=True, slots=True)
class _Screening:
    """What a room's history leaves once its tombstones are applied."""

    candidates: tuple[_Candidate, ...]
    retracted: NativeRoomStatistic | None
    touched_tombstones: bool


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
        if isinstance(room, dict):
            changed = _upgrade_legacy_tombstones(room) or changed
    for room_id, history in histories.items():
        room = robot["rooms"].setdefault(room_id, {})
        changed = _apply_room_history(robot, room, floor_id, history) or changed
    return changed


def _upgrade_legacy_tombstones(room: dict[str, Any]) -> bool:
    """Move a room's single-session rejections into its tombstone list."""
    changed = False
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
        valid_modes = {mode for mode in legacy_modes if mode in NATIVE_MODES}
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
    return changed


def _apply_room_history(
    robot: Mapping[str, Any],
    room: dict[str, Any],
    floor_id: int,
    history: tuple[NativeRoomStatistic, ...],
) -> bool:
    """Store the newest session that a room's history still supports."""
    stored = _stored_session(room, floor_id)
    tombstones = _native_mode_tombstones(room.get("robot_native_mode_tombstones"))
    screening = _screen_history(room, floor_id, history, stored, tombstones)
    changed = False
    if (
        screening.touched_tombstones
        or room.get("robot_native_mode_tombstones", []) != tombstones
    ):
        room["robot_native_mode_tombstones"] = tombstones[-64:]
        changed = True

    positive_timestamp = _latest_timestamp(room.get("robot_last_completed"))
    managed = _managed_session(robot, room, floor_id, history)
    selected = max(
        screening.candidates, key=lambda item: item.statistic.timestamp, default=None
    )
    if managed is not None and (
        selected is None or managed.timestamp >= selected.statistic.timestamp
    ):
        return _store_managed_session(room, floor_id, managed) or changed

    retracted = screening.retracted
    if retracted is not None:
        changed = _store_retraction(room, floor_id, retracted) or changed
    if selected is None:
        if retracted is not None:
            changed = (
                _drop(room, (*_COMPLETION_KEYS, "robot_last_conflicted_modes"))
                or changed
            )
            room["robot_last_invalid_modes"] = sorted(
                _native_tombstone_modes(tombstones, floor_id, retracted)
            )
        return changed
    if retracted is None and _completion_is_stale(
        selected.statistic, stored, positive_timestamp
    ):
        return changed
    return _store_completion(room, floor_id, selected) or changed


def _stored_session(room: Mapping[str, Any], floor_id: int) -> _StoredSession:
    modes = _positive_native_mode_durations(
        room.get("robot_last_completed_mode_durations")
    )
    stored_hash = room.get("robot_last_session_hash")
    stored_end = room.get("robot_last_completed")
    if room.get("robot_last_invalid_source") != "managed_session":
        stored_hash = stored_hash or room.get("robot_last_invalid_session_hash")
        stored_end = stored_end or room.get("robot_last_invalidated_at")
    return _StoredSession(
        session_hash=stored_hash,
        on_floor=(
            isinstance(stored_hash, str)
            and isinstance(stored_end, str)
            and room.get("robot_last_floor_id", room.get("robot_last_invalid_floor_id"))
            == floor_id
        ),
        modes=modes,
    )


def _screen_history(
    room: Mapping[str, Any],
    floor_id: int,
    history: tuple[NativeRoomStatistic, ...],
    stored: _StoredSession,
    tombstones: list[dict[str, Any]],
) -> _Screening:
    """Tombstone the modes this history disputes and keep what still stands."""
    candidates: list[_Candidate] = []
    retracted: NativeRoomStatistic | None = None
    touched_tombstones = False
    for statistic in history:
        # Only the stored session's own modes can be extended or disputed.
        same_session = stored.on_floor and stored.session_hash == statistic.session_hash
        session_modes = stored.modes if same_session else {}
        conflicting = set(statistic.conflicting_modes)
        if same_session:
            conflicting.update(_stored_conflicts(room, statistic, session_modes))
        tombstoned = _native_tombstone_modes(tombstones, floor_id, statistic)
        explicit = set(statistic.invalidated_modes)
        persistent = set(conflicting)
        persistent.update(explicit & statistic.reported_completed_modes)
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
            for mode, duration in {**session_modes, **statistic.mode_durations}.items()
            if mode not in tombstoned
        }
        if modes:
            candidates.append(_Candidate(statistic, modes, conflicting | tombstoned))
        elif persistent & session_modes.keys():
            retracted = statistic
    return _Screening(tuple(candidates), retracted, touched_tombstones)


def _stored_conflicts(
    room: Mapping[str, Any],
    statistic: NativeRoomStatistic,
    session_modes: Mapping[str, int],
) -> set[str]:
    """Return the stored session's rejected modes and those this report revises."""
    conflicting: set[str] = set()
    for key in ("robot_last_conflicted_modes", "robot_last_invalid_modes"):
        stored_modes = room.get(key, [])
        if isinstance(stored_modes, list):
            conflicting.update(mode for mode in stored_modes if mode in NATIVE_MODES)
    conflicting.update(
        mode
        for mode, duration in statistic.mode_durations.items()
        if mode in session_modes and session_modes[mode] != duration
    )
    return conflicting


def _managed_session(
    robot: Mapping[str, Any],
    room: Mapping[str, Any],
    floor_id: int,
    history: tuple[NativeRoomStatistic, ...],
) -> NativeRoomStatistic | None:
    """Return the session in this history that a managed run accounts for."""
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
    if managed is not None:
        return managed
    return next(
        (
            statistic
            for statistic in history
            if (existing_timestamp is None or statistic.timestamp >= existing_timestamp)
            and (
                room.get("robot_last_managed_session_hash") == statistic.session_hash
                or _native_room_statistic_matches_managed_history(robot, statistic)
            )
        ),
        None,
    )


def _store_managed_session(
    room: dict[str, Any], floor_id: int, managed: NativeRoomStatistic
) -> bool:
    """Leave a managed run's session to verified history; keep no statistics."""
    changed = _drop(room, _COMPLETION_KEYS)
    return (
        _store(
            room,
            {
                "robot_last_invalidated_at": managed.ended_at,
                "robot_last_invalid_session_hash": managed.session_hash,
                "robot_last_invalid_session_started_at": managed.started_at,
                "robot_last_invalid_floor_id": floor_id,
                "robot_last_invalid_source": "managed_session",
                "robot_last_managed_session_hash": managed.session_hash,
                "robot_last_managed_session_started_at": managed.started_at,
            },
        )
        or changed
    )


def _store_retraction(
    room: dict[str, Any], floor_id: int, retracted: NativeRoomStatistic
) -> bool:
    return _store(
        room,
        {
            "robot_last_invalidated_at": retracted.ended_at,
            "robot_last_invalid_session_hash": retracted.session_hash,
            "robot_last_invalid_session_started_at": retracted.started_at,
            "robot_last_invalid_floor_id": floor_id,
            "robot_last_invalid_source": "mode_retracted",
        },
    )


def _completion_is_stale(
    statistic: NativeRoomStatistic,
    stored: _StoredSession,
    positive_timestamp: float | None,
) -> bool:
    """Whether the stored completion is newer, or as new from another session."""
    if positive_timestamp is None:
        return False
    return statistic.timestamp < positive_timestamp or (
        statistic.timestamp == positive_timestamp
        and stored.session_hash != statistic.session_hash
    )


def _store_completion(
    room: dict[str, Any], floor_id: int, selected: _Candidate
) -> bool:
    statistic = selected.statistic
    updates = {
        "name": statistic.room_name,
        "robot_last_completed": statistic.ended_at,
        "robot_last_duration_seconds": sum(selected.modes.values()),
        "robot_last_completed_mode_durations": selected.modes,
        "robot_last_session_hash": statistic.session_hash,
        "robot_last_session_started_at": statistic.started_at,
        "robot_last_floor_id": floor_id,
        "robot_last_conflicted_modes": sorted(selected.excluded),
    }
    if statistic.partition_hash is not None:
        updates["robot_last_partition_hash"] = statistic.partition_hash
    else:
        room.pop("robot_last_partition_hash", None)
    changed = _store(room, updates)
    invalid_at = _latest_timestamp(room.get("robot_last_invalidated_at"))
    if invalid_at is None or statistic.timestamp > invalid_at:
        for key in _INVALIDATION_KEYS:
            room.pop(key, None)
    return changed


def _drop(room: dict[str, Any], keys: Iterable[str]) -> bool:
    """Remove the keys a room has and say whether it had any."""
    present = [key for key in keys if key in room]
    for key in present:
        room.pop(key)
    return bool(present)


def _store(room: dict[str, Any], updates: Mapping[str, Any]) -> bool:
    """Write the values unless the room already holds all of them."""
    if not any(room.get(key) != value for key, value in updates.items()):
        return False
    room.update(updates)
    return True


def _positive_native_mode_durations(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {
        mode: duration
        for mode, duration in value.items()
        if mode in NATIVE_MODES
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
                "modes": sorted({mode for mode in modes if mode in NATIVE_MODES}),
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
