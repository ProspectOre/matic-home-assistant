"""Narrow import helpers for robot-reported per-room statistics."""

from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from homeassistant.util import dt as dt_util

from .client.models import CleaningModeResult, CleaningSessionRecord, FloorPlan, Room


def native_statistics_have_ambiguous_floor(floor_plan: FloorPlan) -> bool:
    """Whether room-name-only history could belong to another known floor."""
    known_floor_ids = {floor.mission_id for floor in floor_plan.mapped_floors}
    return len(known_floor_ids | {floor_plan.mission_id}) > 1


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


def completed_native_room_statistics(
    records: Iterable[CleaningSessionRecord],
    rooms: Iterable[Room],
    *,
    now: datetime,
    future_tolerance_seconds: int,
    multiple_floors_known: bool = False,
    minimum_timestamp: float | None = None,
    floor_plan: FloorPlan | None = None,
) -> dict[str, NativeRoomStatistic]:
    """Return the latest positive completion for each unambiguous room."""
    candidates = native_room_statistics_by_session(
        records,
        rooms,
        now=now,
        future_tolerance_seconds=future_tolerance_seconds,
        multiple_floors_known=multiple_floors_known,
        minimum_timestamp=minimum_timestamp,
        floor_plan=floor_plan,
    )
    return {
        room_id: statistic
        for room_id, room_history in candidates.items()
        if (
            statistic := next(
                (item for item in room_history if item.mode_durations), None
            )
        )
        is not None
    }


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
    room_by_name: dict[str, tuple[str, str] | None] = {}
    for room in rooms:
        key = _room_key(room.name)
        room_by_name[key] = None if key in room_by_name else (room.id, room.name)

    statistics_by_session: dict[tuple[str, str], NativeRoomStatistic] = {}
    conflicted_modes_by_session: dict[tuple[str, str], set[str]] = defaultdict(set)
    future_limit = now.timestamp() + future_tolerance_seconds
    for record in records:
        session = record.session
        ended_at = session.ended_at
        if not isinstance(ended_at, str):
            continue
        parsed = dt_util.parse_datetime(ended_at)
        if parsed is None or parsed.tzinfo is None:
            continue
        timestamp = parsed.timestamp()
        if not math.isfinite(timestamp) or timestamp > future_limit:
            continue

        session_mission = getattr(session, "mission_id", None)
        session_partition = getattr(session, "partition_id", None)
        canonical = session_mission is not None or session_partition is not None
        canonical_ok = bool(
            floor_plan is not None
            and session_mission == floor_plan.mission_id
            and session_partition == floor_plan.partition_protocol_id
        )
        if canonical and not canonical_ok:
            continue
        if not canonical and (
            multiple_floors_known
            or (minimum_timestamp is not None and timestamp < minimum_timestamp)
        ):
            continue

        results_by_room: dict[str, dict[str, list[CleaningModeResult]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for result in session.mode_results:
            if result.cleaning_mode not in {"vacuum", "mop"}:
                continue
            result_key = (
                f"id:{result.room_id}"
                if canonical and result.room_id is not None
                else f"name:{_room_key(result.room)}"
            )
            results_by_room[result_key][result.cleaning_mode].append(result)

        session_hash = hashlib.sha256(record.key).hexdigest()
        rooms_by_id = {room.protocol_id: (room.id, room.name) for room in rooms}
        for room_key, modes in results_by_room.items():
            mapped = (
                rooms_by_id.get(room_key[3:])
                if canonical and room_key.startswith("id:")
                else room_by_name.get(room_key[5:])
                if not canonical
                else None
            )
            if mapped is None:
                continue
            duplicate_modes = {
                mode for mode, mode_results in modes.items() if len(mode_results) != 1
            }
            invalidated_modes = {
                mode
                for mode, mode_results in modes.items()
                if len(mode_results) == 1
                and mode_results[0].status in {"partial", "unattempted"}
            }
            mode_durations: dict[str, int] = {}
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
                    mode_durations[result.cleaning_mode] = duration
                    reported_completed_modes.add(result.cleaning_mode)
            if not mode_durations and not duplicate_modes and not invalidated_modes:
                continue
            room_id, display_name = mapped
            # The opaque native record key identifies the session. End/start
            # timestamps can be revised by the provider after an initial
            # completion, so they must not split one session into two rows.
            session_identity = (room_id, session_hash)
            tombstones = conflicted_modes_by_session[session_identity]
            tombstones.update(duplicate_modes)
            mode_durations = {
                mode: duration
                for mode, duration in mode_durations.items()
                if mode not in tombstones and mode not in invalidated_modes
            }
            candidate = NativeRoomStatistic(
                room_id=room_id,
                room_name=display_name,
                ended_at=ended_at,
                duration_seconds=sum(mode_durations.values()),
                timestamp=timestamp,
                started_at=session.started_at,
                session_hash=session_hash,
                mode_durations=mode_durations,
                conflicting_modes=frozenset(tombstones),
                invalidated_modes=frozenset(invalidated_modes),
                reported_completed_modes=frozenset(reported_completed_modes),
                partition_hash=(
                    hashlib.sha256(session_partition.encode()).hexdigest()
                    if canonical_ok and isinstance(session_partition, str)
                    else None
                ),
            )
            current = statistics_by_session.get(session_identity)
            if current is None:
                statistics_by_session[session_identity] = candidate
            else:
                conflicting_modes = (
                    current.conflicting_modes | candidate.conflicting_modes
                )
                conflicting_modes |= frozenset(
                    mode
                    for mode, duration in candidate.mode_durations.items()
                    if mode in current.mode_durations
                    and current.mode_durations[mode] != duration
                )
                tombstones.update(conflicting_modes)
                invalidated_modes = set(
                    current.invalidated_modes | candidate.invalidated_modes
                )
                reported_completed_modes = set(
                    current.reported_completed_modes
                    | candidate.reported_completed_modes
                )
                merged_modes = {
                    **current.mode_durations,
                    **candidate.mode_durations,
                }
                merged_modes = {
                    mode: duration
                    for mode, duration in merged_modes.items()
                    if mode not in conflicting_modes and mode not in invalidated_modes
                }
                merged_modes = {
                    mode: duration
                    for mode, duration in merged_modes.items()
                    if mode not in tombstones and mode not in invalidated_modes
                }
                statistics_by_session[session_identity] = NativeRoomStatistic(
                    room_id=room_id,
                    room_name=display_name,
                    ended_at=(
                        candidate.ended_at
                        if candidate.timestamp >= current.timestamp
                        else current.ended_at
                    ),
                    duration_seconds=sum(merged_modes.values()),
                    timestamp=max(timestamp, current.timestamp),
                    started_at=(
                        candidate.started_at
                        if candidate.timestamp >= current.timestamp
                        else current.started_at
                    ),
                    session_hash=session_hash,
                    mode_durations=merged_modes,
                    conflicting_modes=frozenset(tombstones),
                    invalidated_modes=frozenset(invalidated_modes),
                    reported_completed_modes=frozenset(reported_completed_modes),
                    partition_hash=candidate.partition_hash or current.partition_hash,
                )
    by_room: dict[str, list[NativeRoomStatistic]] = defaultdict(list)
    for (room_id, _session_hash), statistic in statistics_by_session.items():
        by_room[room_id].append(statistic)
    return {
        room_id: tuple(sorted(history, key=lambda item: item.timestamp, reverse=True))
        for room_id, history in by_room.items()
    }


def _room_key(value: str) -> str:
    """Normalize a robot room name for unambiguous local matching."""
    return " ".join(value.casefold().split())
