"""Narrow import helpers for robot-reported per-room statistics."""

from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from homeassistant.util import dt as dt_util

from .client.models import CleaningModeResult, CleaningSessionRecord, Room


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


def completed_native_room_statistics(
    records: Iterable[CleaningSessionRecord],
    rooms: Iterable[Room],
    *,
    now: datetime,
    future_tolerance_seconds: int,
    multiple_floors_known: bool = False,
    minimum_timestamp: float | None = None,
) -> dict[str, NativeRoomStatistic]:
    """Map explicit completed mode results to unambiguous active room names.

    The native history does not include a floor identity. This function only
    uses names that uniquely identify a room on the supplied current floor.
    It returns sensor history evidence; it does not confer managed-run credit.
    If the active map reports multiple floors, room names cannot identify which
    floor the native record belongs to, so no room statistic is returned.
    """
    if multiple_floors_known:
        return {}
    room_by_name: dict[str, tuple[str, str] | None] = {}
    for room in rooms:
        key = _room_key(room.name)
        room_by_name[key] = None if key in room_by_name else (room.id, room.name)

    latest: dict[str, NativeRoomStatistic] = {}
    conflicted_modes_by_session: dict[tuple[str, str, float, str | None], set[str]] = (
        defaultdict(set)
    )
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
        if (
            not math.isfinite(timestamp)
            or timestamp > future_limit
            or (minimum_timestamp is not None and timestamp < minimum_timestamp)
        ):
            continue

        results_by_room: dict[str, dict[str, list[CleaningModeResult]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for result in session.mode_results:
            if result.cleaning_mode not in {"vacuum", "mop"}:
                continue
            results_by_room[_room_key(result.room)][result.cleaning_mode].append(result)

        session_hash = hashlib.sha256(record.key).hexdigest()
        for room_name, modes in results_by_room.items():
            mapped = room_by_name.get(room_name)
            if mapped is None:
                continue
            duplicate_modes = {
                mode for mode, mode_results in modes.items() if len(mode_results) != 1
            }
            mode_durations: dict[str, int] = {}
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
            if not mode_durations and not duplicate_modes:
                continue
            room_id, display_name = mapped
            session_identity = (room_id, session_hash, timestamp, session.started_at)
            tombstones = conflicted_modes_by_session[session_identity]
            tombstones.update(duplicate_modes)
            mode_durations = {
                mode: duration
                for mode, duration in mode_durations.items()
                if mode not in tombstones
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
            )
            current = latest.get(room_id)
            if current is None or candidate.timestamp > current.timestamp:
                latest[room_id] = candidate
            elif (
                candidate.timestamp == current.timestamp
                and candidate.session_hash == current.session_hash
                and candidate.started_at == current.started_at
            ):
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
                merged_modes = {
                    **current.mode_durations,
                    **candidate.mode_durations,
                }
                merged_modes = {
                    mode: duration
                    for mode, duration in merged_modes.items()
                    if mode not in conflicting_modes
                }
                merged_modes = {
                    mode: duration
                    for mode, duration in merged_modes.items()
                    if mode not in tombstones
                }
                latest[room_id] = NativeRoomStatistic(
                    room_id=room_id,
                    room_name=display_name,
                    ended_at=ended_at,
                    duration_seconds=sum(merged_modes.values()),
                    timestamp=timestamp,
                    started_at=session.started_at,
                    session_hash=session_hash,
                    mode_durations=merged_modes,
                    conflicting_modes=frozenset(tombstones),
                )
    return latest


def _room_key(value: str) -> str:
    """Normalize a robot room name for unambiguous local matching."""
    return " ".join(value.casefold().split())
