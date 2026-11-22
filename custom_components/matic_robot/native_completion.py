"""Shared proof matching for managed native room completions."""

from __future__ import annotations

from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from homeassistant.util import dt as dt_util

from .client import CleaningSession, CleaningSessionRecord, native_session_hash
from .plan_model import CleaningRoom

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


def records_for_dispatch(
    records: Iterable[CleaningSessionRecord],
    baseline: Collection[bytes] | None,
    session_hash: str | None = None,
) -> tuple[CleaningSessionRecord, ...] | None:
    """Return the records a dispatch may claim, or None while that is unsafe.

    With ``session_hash``, only the dispatch's own record counts: a read can
    hold part of the retained history, and a missing old key must not make an
    unrelated record part of the run. Otherwise every record outside
    ``baseline`` counts, and None means one of them cannot be decoded. It may
    be the dispatched session itself, so nothing is attributed until it is.
    """
    if session_hash is None:
        if baseline is None:
            return tuple(records)
        new = tuple(record for record in records if record.key not in baseline)
        return None if any(not record.decoded for record in new) else new
    if baseline is not None and any(
        native_session_hash(key) == session_hash for key in baseline
    ):
        return None
    owned = tuple(
        record for record in records if native_session_hash(record.key) == session_hash
    )
    if len(owned) > 1 or any(not record.decoded for record in owned):
        return None
    return owned


def match_single_room_completions(
    records: Iterable[CleaningSessionRecord],
    *,
    room_name: str,
    cleaning_mode: str | None,
    dispatched_at: datetime,
    now: datetime,
    baseline: Collection[bytes] | None = None,
    session_hash: str | None = None,
    legacy_policy: LegacyCompletionPolicy = "aggregate",
) -> tuple[NativeRoomCompletion, ...]:
    """Return at most two matching records to distinguish unique from ambiguous."""
    target = native_room_key(room_name)
    matches: list[NativeRoomCompletion] = []
    for record in records_for_dispatch(records, baseline, session_hash) or ():
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


_REQUESTED_MODES = {
    "vacuum": frozenset({"vacuum"}),
    "mop": frozenset({"mop"}),
    "vacuum_and_mop": frozenset({"vacuum", "mop"}),
}


_MODE_STATUSES = frozenset({"unattempted", "partial", "completed"})
_ATTEMPTED_MODE = {
    frozenset({"vacuum"}): "vacuum",
    frozenset({"mop"}): "mop",
    frozenset({"vacuum", "mop"}): "vacuum_and_mop",
}


@dataclass(frozen=True, slots=True)
class RobotEnded:
    """How a finished mission left a room the robot did not complete."""

    result: Literal["unreachable", "partly_cleaned"]
    # The requested modes the robot started in the room; None if it started none.
    attempted_mode: str | None


def room_robot_ended(
    session: CleaningSession, room_name: str, cleaning_mode: str | None
) -> RobotEnded | None:
    """Return how a finished mission left a room it did not complete.

    The OEM app titles a ``Finished`` stop reason "Area inaccessible" (Matic
    1.183.1), both when the requested room stayed unattempted and when the
    robot cleaned only part of it. Every requested mode unattempted means the
    room was unreachable; any other result short of every mode completed means
    it was partly cleaned. A cancelled or unknown stop reason is neither:
    someone stopped the mission.
    """
    requested = _REQUESTED_MODES.get(cleaning_mode or "")
    if requested is None or session.stop_reason != "finished":
        return None
    target = native_room_key(room_name)
    results = [
        result
        for result in session.mode_results
        if native_room_key(result.room) == target
    ]
    statuses = {result.status for result in results}
    if (
        not results
        or {result.cleaning_mode for result in results} != requested
        or not statuses <= _MODE_STATUSES
        or statuses == {"completed"}
    ):
        return None
    attempted = _ATTEMPTED_MODE.get(
        frozenset(r.cleaning_mode for r in results if r.status != "unattempted")
    )
    return RobotEnded("partly_cleaned" if attempted else "unreachable", attempted)


def leg_room_results(
    session: CleaningSession,
    rooms: Sequence[CleaningRoom],
    room_ids: Collection[str],
) -> tuple[dict[str, tuple[str, int]], dict[str, RobotEnded]]:
    """Return a leg record's credit for ``room_ids`` and the rooms it left unfinished.

    Credit maps ``room_id -> (ended_at, duration_seconds)`` for each room the
    record marks completed with a positive duration. The rooms the robot
    finished its mission without reaching or completing map to how it left
    them.
    """
    ended_at = session.ended_at
    assert isinstance(ended_at, str)
    evidence: dict[str, tuple[str, int]] = {}
    robot_ended: dict[str, RobotEnded] = {}
    for room in rooms:
        if room.room_id not in room_ids:
            continue
        name = room.name.strip().casefold()
        durations = {
            name.strip().casefold(): duration
            for name, duration in session.room_durations_for_mode(room.cleaning_mode)
        }
        completed_names = {
            name.strip().casefold()
            for name in session.completed_rooms_for_mode(room.cleaning_mode)
        }
        duration = durations.get(name)
        if (
            name in completed_names
            and isinstance(duration, int)
            and not isinstance(duration, bool)
            and duration > 0
        ):
            evidence[room.room_id] = (ended_at, duration)
        elif ended := room_robot_ended(session, room.name, room.cleaning_mode):
            robot_ended[room.room_id] = ended
    return evidence, robot_ended


def match_single_room_robot_ended(
    records: Iterable[CleaningSessionRecord],
    *,
    room_name: str,
    cleaning_mode: str | None,
    dispatched_at: datetime,
    now: datetime,
    baseline: Collection[bytes] | None = None,
    session_hash: str | None = None,
) -> tuple[tuple[CleaningSessionRecord, RobotEnded], ...]:
    """Return at most two one-room records the robot finished short of the room."""
    target = native_room_key(room_name)
    matches: list[tuple[CleaningSessionRecord, RobotEnded]] = []
    for record in records_for_dispatch(records, baseline, session_hash) or ():
        session = record.session
        if not session_overlaps_dispatch(session, dispatched_at, now):
            continue
        if tuple(native_room_key(name) for name in session.rooms) != (target,):
            continue
        if not (ended := room_robot_ended(session, room_name, cleaning_mode)):
            continue
        matches.append((record, ended))
        if len(matches) == 2:
            break
    return tuple(matches)


_CANCELLED_STOP_REASONS = frozenset({"stopped", "bot_cancelled"})


def has_cancelled_single_room_record(
    records: Iterable[CleaningSessionRecord],
    *,
    room_name: str,
    dispatched_at: datetime,
    now: datetime,
    baseline: Collection[bytes] | None = None,
    session_hash: str | None = None,
) -> bool:
    """Report a new record proving this room's mission was cancelled.

    A cancelled record is final, so verification can stop waiting for a
    completion that will not come.
    """
    target = native_room_key(room_name)
    return any(
        record.session.stop_reason in _CANCELLED_STOP_REASONS
        and session_overlaps_dispatch(record.session, dispatched_at, now)
        and tuple(native_room_key(name) for name in record.session.rooms) == (target,)
        for record in records_for_dispatch(records, baseline, session_hash) or ()
    )


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
