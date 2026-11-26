"""Narrow import helpers for robot-reported per-room statistics."""

from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from homeassistant.util import dt as dt_util

from .client import CleaningModeResult, CleaningSessionRecord, FloorPlan, Room

# The modes a native session reports per room; a combined clean reports both.
NATIVE_MODES = frozenset({"vacuum", "mop"})


@dataclass(frozen=True, slots=True)
class NativeRoomStatistic:
    """One positively reported room completion from native session history."""

    room_id: str
    room_name: str
    ended_at: str
    duration_seconds: int
    timestamp: float
    started_at: str | None
    session_hash: str
    mode_durations: dict[str, int]
    conflicting_modes: frozenset[str]
    invalidated_modes: frozenset[str]
    reported_completed_modes: frozenset[str]
    partition_hash: str | None = None


def native_room_statistics_by_session(
    records: Iterable[CleaningSessionRecord],
    rooms: Iterable[Room],
    *,
    now: datetime,
    future_tolerance_seconds: int,
    multiple_floors_known: bool = False,
    minimum_timestamp: float | None = None,
    floor_plan: FloorPlan | None = None,
) -> dict[str, tuple[NativeRoomStatistic, ...]]:
    """Map explicit completed mode results to unambiguous active room names.

    Canonical records match floor mission and partition IDs and resolve by room
    UUID. Legacy rows use unique names only when one floor is known.
    """
    room_index = _index_rooms(rooms)
    admission = _Admission(
        future_limit=now.timestamp() + future_tolerance_seconds,
        multiple_floors_known=multiple_floors_known,
        minimum_timestamp=minimum_timestamp,
        floor_plan=floor_plan,
    )
    statistics: dict[tuple[str, str], NativeRoomStatistic] = {}
    conflicted_modes: dict[tuple[str, str], set[str]] = defaultdict(set)
    for record in records:
        admitted = _admit(record, admission)
        if admitted is not None:
            _add_session(admitted, room_index, statistics, conflicted_modes)
    by_room: dict[str, list[NativeRoomStatistic]] = defaultdict(list)
    for (room_id, _session_hash), statistic in statistics.items():
        by_room[room_id].append(statistic)
    return {
        room_id: tuple(sorted(history, key=lambda item: item.timestamp, reverse=True))
        for room_id, history in by_room.items()
    }


@dataclass(frozen=True, slots=True)
class _RoomIndex:
    """Active rooms by unique normalized name and by protocol ID."""

    by_name: dict[str, tuple[str, str] | None]
    by_protocol_id: dict[str, tuple[str, str]]


@dataclass(frozen=True, slots=True)
class _Admission:
    """The limits a session must meet for its results to count."""

    future_limit: float
    multiple_floors_known: bool
    minimum_timestamp: float | None
    floor_plan: FloorPlan | None


@dataclass(frozen=True, slots=True)
class _AdmittedSession:
    """A session inside the limits, with its parsed end time."""

    record: CleaningSessionRecord
    ended_at: str
    timestamp: float
    canonical: bool


@dataclass(frozen=True, slots=True)
class _ModeEvidence:
    """What one session reports for one room's modes."""

    durations: dict[str, int]
    duplicate_modes: set[str]
    invalidated_modes: set[str]
    reported_completed_modes: set[str]


def _index_rooms(rooms: Iterable[Room]) -> _RoomIndex:
    by_name: dict[str, tuple[str, str] | None] = {}
    for room in rooms:
        key = _room_key(room.name)
        by_name[key] = None if key in by_name else (room.id, room.name)
    return _RoomIndex(
        by_name, {room.protocol_id: (room.id, room.name) for room in rooms}
    )


def _admit(
    record: CleaningSessionRecord, admission: _Admission
) -> _AdmittedSession | None:
    """Admit a finished session on the active floor, or a legacy one it allows."""
    session = record.session
    ended_at = session.ended_at
    if not isinstance(ended_at, str):
        return None
    parsed = dt_util.parse_datetime(ended_at)
    if parsed is None or parsed.tzinfo is None:
        return None
    timestamp = parsed.timestamp()
    if not math.isfinite(timestamp) or timestamp > admission.future_limit:
        return None
    floor_plan = admission.floor_plan
    canonical = session.mission_id is not None or session.partition_id is not None
    if canonical:
        admitted = bool(
            floor_plan is not None
            and session.mission_id == floor_plan.mission_id
            and session.partition_id == floor_plan.partition_protocol_id
        )
    else:
        admitted = not (
            admission.multiple_floors_known
            or (
                admission.minimum_timestamp is not None
                and timestamp < admission.minimum_timestamp
            )
        )
    return (
        _AdmittedSession(record, ended_at, timestamp, canonical) if admitted else None
    )


def _add_session(
    admitted: _AdmittedSession,
    room_index: _RoomIndex,
    statistics: dict[tuple[str, str], NativeRoomStatistic],
    conflicted_modes: dict[tuple[str, str], set[str]],
) -> None:
    """Fold one session's room results into the statistics collected so far."""
    session = admitted.record.session
    results_by_room = _results_by_room(session.mode_results, admitted.canonical)
    session_hash = hashlib.sha256(admitted.record.key).hexdigest()
    for room_key, modes in results_by_room.items():
        mapped = (
            room_index.by_protocol_id.get(room_key[3:])
            if admitted.canonical and room_key.startswith("id:")
            else room_index.by_name.get(room_key[5:])
            if not admitted.canonical
            else None
        )
        if mapped is None:
            continue
        evidence = _mode_evidence(modes)
        if (
            not evidence.durations
            and not evidence.duplicate_modes
            and not evidence.invalidated_modes
        ):
            continue
        # The opaque native record key identifies the session. End/start
        # timestamps can be revised by the provider after an initial
        # completion, so they must not split one session into two rows.
        session_identity = (mapped[0], session_hash)
        tombstones = conflicted_modes[session_identity]
        tombstones.update(evidence.duplicate_modes)
        candidate = _candidate(admitted, mapped, session_hash, evidence, tombstones)
        current = statistics.get(session_identity)
        statistics[session_identity] = (
            candidate if current is None else _merged(current, candidate, tombstones)
        )


def _results_by_room(
    mode_results: Iterable[CleaningModeResult], canonical: bool
) -> dict[str, dict[str, list[CleaningModeResult]]]:
    """Group vacuum and mop results by room ID, or by name for legacy rows."""
    results_by_room: dict[str, dict[str, list[CleaningModeResult]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for result in mode_results:
        if result.cleaning_mode not in NATIVE_MODES:
            continue
        result_key = (
            f"id:{result.room_id}"
            if canonical and result.room_id is not None
            else f"name:{_room_key(result.room)}"
        )
        results_by_room[result_key][result.cleaning_mode].append(result)
    return results_by_room


def _mode_evidence(modes: dict[str, list[CleaningModeResult]]) -> _ModeEvidence:
    """Read a room's modes: only a mode reported exactly once can be credited."""
    durations: dict[str, int] = {}
    reported_completed_modes: set[str] = set()
    for mode_results in modes.values():
        if len(mode_results) != 1:
            continue
        result = mode_results[0]
        duration = result.duration_seconds
        if (
            result.status == "completed"
            and isinstance(duration, int)
            and not isinstance(duration, bool)
            and duration > 0
        ):
            durations[result.cleaning_mode] = duration
            reported_completed_modes.add(result.cleaning_mode)
    return _ModeEvidence(
        durations=durations,
        duplicate_modes={
            mode for mode, mode_results in modes.items() if len(mode_results) != 1
        },
        invalidated_modes={
            mode
            for mode, mode_results in modes.items()
            if len(mode_results) == 1
            and mode_results[0].status in {"partial", "unattempted"}
        },
        reported_completed_modes=reported_completed_modes,
    )


def _candidate(
    admitted: _AdmittedSession,
    mapped: tuple[str, str],
    session_hash: str,
    evidence: _ModeEvidence,
    tombstones: set[str],
) -> NativeRoomStatistic:
    """Build one room's statistic from a session, without its rejected modes."""
    session = admitted.record.session
    durations = {
        mode: duration
        for mode, duration in evidence.durations.items()
        if mode not in tombstones and mode not in evidence.invalidated_modes
    }
    room_id, room_name = mapped
    return NativeRoomStatistic(
        room_id=room_id,
        room_name=room_name,
        ended_at=admitted.ended_at,
        duration_seconds=sum(durations.values()),
        timestamp=admitted.timestamp,
        started_at=session.started_at,
        session_hash=session_hash,
        mode_durations=durations,
        conflicting_modes=frozenset(tombstones),
        invalidated_modes=frozenset(evidence.invalidated_modes),
        reported_completed_modes=frozenset(evidence.reported_completed_modes),
        partition_hash=(
            hashlib.sha256(session.partition_id.encode()).hexdigest()
            if admitted.canonical and isinstance(session.partition_id, str)
            else None
        ),
    )


def _merged(
    current: NativeRoomStatistic,
    candidate: NativeRoomStatistic,
    tombstones: set[str],
) -> NativeRoomStatistic:
    """Combine two reports of one session; modes they disagree on are rejected."""
    tombstones.update(current.conflicting_modes | candidate.conflicting_modes)
    tombstones.update(
        mode
        for mode, duration in candidate.mode_durations.items()
        if mode in current.mode_durations and current.mode_durations[mode] != duration
    )
    invalidated_modes = current.invalidated_modes | candidate.invalidated_modes
    durations = {
        mode: duration
        for mode, duration in {
            **current.mode_durations,
            **candidate.mode_durations,
        }.items()
        if mode not in tombstones and mode not in invalidated_modes
    }
    newest = candidate if candidate.timestamp >= current.timestamp else current
    return NativeRoomStatistic(
        room_id=candidate.room_id,
        room_name=candidate.room_name,
        ended_at=newest.ended_at,
        duration_seconds=sum(durations.values()),
        timestamp=max(candidate.timestamp, current.timestamp),
        started_at=newest.started_at,
        session_hash=candidate.session_hash,
        mode_durations=durations,
        conflicting_modes=frozenset(tombstones),
        invalidated_modes=invalidated_modes,
        reported_completed_modes=(
            current.reported_completed_modes | candidate.reported_completed_modes
        ),
        partition_hash=candidate.partition_hash or current.partition_hash,
    )


def _room_key(value: str) -> str:
    """Normalize a robot room name for unambiguous local matching."""
    return " ".join(value.casefold().split())
