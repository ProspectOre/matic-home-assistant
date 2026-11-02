"""Shared proof matching for managed native room completions."""

from __future__ import annotations

from collections.abc import Collection, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from homeassistant.util import dt as dt_util

from .client.coverage_receipts import native_session_hash
from .client.models import CleaningSession, CleaningSessionRecord

LegacyCompletionPolicy = Literal["aggregate", "room_list"]


@dataclass(frozen=True, slots=True)
class NativeRoomCompletion:
    """One native record proving a room's requested mode and duration."""

    record: CleaningSessionRecord
    ended_at: str
    duration_seconds: int


def native_room_key(value: str) -> str:
    """Normalize native and mapped room names for exact comparisons."""
    return " ".join(value.strip().casefold().split()).removeprefix("the ")


def session_overlaps_dispatch(
    session: CleaningSession, dispatched_at: datetime, now: datetime
) -> bool:
    """Admit only ordered, timezone-aware native timestamps inside this dispatch."""
    started = dt_util.parse_datetime(session.started_at or "")
    ended = dt_util.parse_datetime(session.ended_at or "")
    return (
        started is not None
        and ended is not None
        and all(
            value.tzinfo is not None for value in (started, ended, dispatched_at, now)
        )
        and started <= ended
        and dispatched_at <= ended <= now
    )


def room_completion_duration(
    session: CleaningSession,
    room_name: str,
    cleaning_mode: str | None,
    *,
    legacy_policy: LegacyCompletionPolicy = "aggregate",
) -> int | None:
    """Return positive duration only when the requested room mode is complete.

    Modern native summaries carry per-mode results. Legacy summary compatibility
    is intentionally explicit because room history and single-room dispatch
    matchers historically admitted slightly different aggregate evidence.
    """
    if legacy_policy not in {"aggregate", "room_list"}:
        raise ValueError("unsupported legacy native completion policy")
    target = native_room_key(room_name)
    completed = {
        native_room_key(name)
        for name in session.completed_rooms_for_mode(cleaning_mode)
    }
    if session.mode_results:
        if target not in completed:
            return None
    elif legacy_policy == "room_list":
        vacuum_proven = cleaning_mode == "vacuum" and target in {
            native_room_key(name) for name in session.vacuum_completed_rooms
        }
        if session.completed is not True and not vacuum_proven:
            return None
        if target not in completed:
            return None
    else:
        vacuum_proven = cleaning_mode == "vacuum" and target in {
            native_room_key(name) for name in session.vacuum_completed_rooms
        }
        if session.completed is not True and not vacuum_proven:
            return None

    durations = [
        duration
        for name, duration in session.room_durations_for_mode(cleaning_mode)
        if native_room_key(name) == target
        and isinstance(duration, int)
        and not isinstance(duration, bool)
        and duration > 0
    ]
    return durations[0] if len(durations) == 1 else None


def match_single_room_completions(
    records: Iterable[CleaningSessionRecord],
    *,
    room_name: str,
    cleaning_mode: str | None,
    dispatched_at: datetime,
    now: datetime,
    baseline: Collection[bytes] | None = None,
    legacy_policy: LegacyCompletionPolicy = "aggregate",
) -> tuple[NativeRoomCompletion, ...]:
    """Return at most two matching records to distinguish unique from ambiguous."""
    target = native_room_key(room_name)
    matches: list[NativeRoomCompletion] = []
    for record in records:
        if baseline is not None and record.key in baseline:
            continue
        session = record.session
        if not session_overlaps_dispatch(session, dispatched_at, now):
            continue
        # The ordering checks rule out future starts because ended <= now.
        if tuple(native_room_key(name) for name in session.rooms) != (target,):
            continue
        duration = room_completion_duration(
            session,
            room_name,
            cleaning_mode,
            legacy_policy=legacy_policy,
        )
        if duration is None:
            continue
        matches.append(NativeRoomCompletion(record, session.ended_at or "", duration))
        if len(matches) == 2:
            break
    return tuple(matches)


def match_session_room_completions(
    records: Iterable[CleaningSessionRecord],
    *,
    room_name: str,
    cleaning_mode: str,
    dispatched_at: datetime,
    now: datetime,
    session_hash: str,
) -> tuple[NativeRoomCompletion, ...]:
    """Match one room in a multi-room record to its exact native session."""
    target = native_room_key(room_name)
    matches: list[NativeRoomCompletion] = []
    for record in records:
        if native_session_hash(record.key) != session_hash:
            continue
        session = record.session
        if not session_overlaps_dispatch(session, dispatched_at, now):
            continue
        room_keys = tuple(native_room_key(name) for name in session.rooms)
        if len(room_keys) != len(set(room_keys)) or target not in room_keys:
            continue
        duration = room_completion_duration(
            session,
            room_name,
            cleaning_mode,
            legacy_policy="room_list",
        )
        if duration is None:
            continue
        matches.append(NativeRoomCompletion(record, session.ended_at or "", duration))
        if len(matches) == 2:
            break
    return tuple(matches)
