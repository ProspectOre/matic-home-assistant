"""Shared proof matching for managed native room completions."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Collection, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, TypeIs

from homeassistant.util import dt as dt_util

from .client.coverage_receipts import native_session_hash
from .client.exceptions import MaticError
from .client.models import CleaningSession, CleaningSessionRecord

LegacyCompletionPolicy = Literal["aggregate", "room_list"]


type HistoryReader = Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]]


@dataclass(frozen=True, slots=True)
class NativeHistoryReader:
    """Expose ordinary inventory reads and a bounded lookup for an owned run."""

    read: Callable[..., Awaitable[tuple[CleaningSessionRecord, ...]]]
    read_keys: Callable[..., Awaitable[frozenset[bytes]]] | None = None
    read_idle_revision: Callable[[], Awaitable[str | None]] | None = None

    async def __call__(self) -> tuple[CleaningSessionRecord, ...]:
        return await self.read(strict=True)

    async def for_session(self, session_hash: str) -> tuple[CleaningSessionRecord, ...]:
        return await self.read(strict=True, session_hash=session_hash)


async def read_dispatch_history(
    reader: HistoryReader, session_hash: str | None
) -> tuple[CleaningSessionRecord, ...]:
    if isinstance(reader, NativeHistoryReader) and session_hash is not None:
        return await reader.for_session(session_hash)
    return await reader()


async def read_handoff_history_keys(
    reader: HistoryReader,
    *,
    session_hash: str | None = None,
    expected_hashes: frozenset[str] | None = None,
) -> frozenset[bytes]:
    """Use the key inventory when available and preserve older readers."""
    if isinstance(reader, NativeHistoryReader) and reader.read_keys is not None:
        return await reader.read_keys(
            session_hash=session_hash, expected_hashes=expected_hashes
        )
    return frozenset(record.key for record in await reader())


async def read_handoff_revision(reader: HistoryReader | None) -> str | None:
    """Read the optional robot-side marker used by handoff and recovery."""
    if (
        isinstance(reader, NativeHistoryReader)
        and reader.read_idle_revision is not None
    ):
        try:
            return await reader.read_idle_revision()
        except MaticError:
            return None
    return None


@dataclass(frozen=True, slots=True)
class NativeRoomCompletion:
    """One native record proving a room's requested mode and duration."""

    record: CleaningSessionRecord
    ended_at: str
    duration_seconds: int


def native_room_key(value: str) -> str:
    """Normalize native and mapped room names for exact comparisons."""
    return " ".join(value.strip().casefold().split()).removeprefix("the ")


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


def records_since_baseline(
    records: Iterable[CleaningSessionRecord], baseline: Collection[bytes]
) -> tuple[CleaningSessionRecord, ...] | None:
    """Return the records created after a dispatch baseline, or None if unsafe.

    None means a new record cannot be decoded. It may be the dispatched session
    itself, so no new record can be attributed to the dispatch until it does.
    Undecodable records in the baseline predate the dispatch and do not matter.
    """
    new = tuple(record for record in records if record.key not in baseline)
    return None if any(not record.decoded for record in new) else new


def is_session_hash(value: object) -> TypeIs[str]:
    """Validate a persisted native session fingerprint."""
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    )


def records_for_dispatch(
    records: Iterable[CleaningSessionRecord],
    baseline: Collection[bytes] | None,
    session_hash: str | None,
) -> tuple[CleaningSessionRecord, ...] | None:
    """Select the owned record, or use the baseline for legacy dispatches.

    An open subscription can return only part of the retained history. An
    omitted old key cannot make an unrelated record part of an owned run.
    """
    if session_hash is None:
        return (
            records_since_baseline(records, baseline)
            if baseline is not None
            else tuple(records)
        )
    if baseline is not None and any(
        native_session_hash(key) == session_hash for key in baseline
    ):
        return None
    matching = tuple(
        record for record in records if native_session_hash(record.key) == session_hash
    )
    if len(matching) > 1 or any(not record.decoded for record in matching):
        return None
    return matching


def match_single_room_completions(
    records: Iterable[CleaningSessionRecord],
    *,
    room_name: str,
    cleaning_mode: str | None,
    dispatched_at: datetime,
    now: datetime,
    baseline: Collection[bytes] | None = None,
    legacy_policy: LegacyCompletionPolicy = "aggregate",
    session_hash: str | None = None,
) -> tuple[NativeRoomCompletion, ...]:
    """Return at most two matching records to distinguish unique from ambiguous."""
    candidates = records_for_dispatch(records, baseline, session_hash)
    if candidates is None:
        return ()
    target = native_room_key(room_name)
    matches: list[NativeRoomCompletion] = []
    for record in candidates:
        session = record.session
        started = dt_util.parse_datetime(session.started_at or "")
        ended = dt_util.parse_datetime(session.ended_at or "")
        if started is None or ended is None or started > ended:
            continue
        if ended < dispatched_at or ended > now:
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
