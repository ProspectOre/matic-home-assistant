"""Bounded cleaning session decoders."""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime

from google.protobuf.message import DecodeError

from .coverage_receipts import native_session_hash
from .exceptions import NativeHistoryIncompleteError
from .history_semantics import (
    MAX_HISTORY_BYTES,
    SemanticHistory,
    decode_history_semantics,
)
from .models import (
    MODE_STATUSES,
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    HermesCollectionEntry,
)
from .stop_reason import decode_stop_variant
from .telemetry_fields import (
    bounded_fields,
    decode_text_from_fields,
    telemetry_bytes,
    telemetry_fields,
    telemetry_varint,
)
from .wire import WireField, decode_fields, field_bytes

_LOGGER = logging.getLogger(__name__)

_SESSION_COMPLETED_STATUS = 0
_ROOM_MODE_COMPLETED_STATUS = 2
_CLEANING_SESSION_MAX_BYTES = 256 * 1024
_CLEANING_SESSION_MAX_FIELDS = 1024
_CLEANING_SESSION_MAX_ROOMS = 256


@dataclass(frozen=True, slots=True)
class _LegacyRoomResults:
    """What a legacy summary's vacuum (6) and mop (7) room maps recorded."""

    rooms: tuple[str, ...]
    modes: frozenset[int]
    statuses: dict[tuple[int, str], int | None]
    durations: dict[tuple[int, str], int | None]


def _native_history_collection_revision(
    entries: tuple[HermesCollectionEntry, ...],
) -> str:
    """Hash ended records in a complete history snapshot without exposing them."""
    digest = hashlib.sha256(b"matic-native-history-v1\0")
    for entry in sorted(entries, key=lambda item: item.key):
        session = decode_cleaning_session(entry.value)
        if session is not None and session.ended_at is None:
            continue
        digest.update(len(entry.key).to_bytes(4, "big"))
        digest.update(entry.key)
        digest.update(len(entry.value).to_bytes(8, "big"))
        digest.update(entry.value)
    return digest.hexdigest()


def decode_cleaning_session_records(
    entries: tuple[HermesCollectionEntry, ...], *, strict: bool = False
) -> tuple[CleaningSessionRecord, ...]:
    """Decode opaque-keyed history entries.

    An undecodable value with a valid session key becomes a placeholder.
    ``strict`` raises if an entry had to be left out for lacking a session
    identity.
    """
    records: list[CleaningSessionRecord] = []
    undecodable = unidentified = 0
    for entry in entries:
        session = decode_cleaning_session(entry.value)
        if entry.key and session is not None:
            records.append(CleaningSessionRecord(entry.key, session))
            continue
        if not entry.key or native_session_hash(entry.key) is None:
            unidentified += 1
            continue
        # Keep a rejected record's exact identity as a placeholder. Its
        # disappearance from retention differs from a correction that no
        # longer supports an earlier completion credit.
        undecodable += 1
        records.append(CleaningSessionRecord.undecodable(entry.key))
    if undecodable or unidentified:
        # Counts only: keys and values stay private.
        _LOGGER.debug(
            "Native history read kept %d undecodable and dropped %d "
            "unidentified of %d entries",
            undecodable,
            unidentified,
            len(entries),
        )
    if strict and unidentified:
        raise NativeHistoryIncompleteError(
            "Native history has an entry without a session identity"
        )
    return tuple(records)


def _session_summary(payload: bytes) -> bytes:
    """Return a record's one bounded summary.

    A large record repeats drawing geometry around it, so its envelope is read
    without copying and only the summary must fit the whole-record cap.
    """
    if len(payload) <= _CLEANING_SESSION_MAX_BYTES:
        return telemetry_bytes(
            payload,
            5,
            max_bytes=_CLEANING_SESSION_MAX_BYTES,
            max_fields=_CLEANING_SESSION_MAX_FIELDS,
        )
    envelope = decode_fields(
        memoryview(payload), max_fields=_CLEANING_SESSION_MAX_FIELDS
    )
    summaries = [field for field in envelope if field.number == 5]
    if (
        len(summaries) != 1
        or summaries[0].wire_type != 2
        or not isinstance(summaries[0].value, memoryview)
        or len(summaries[0].value) > _CLEANING_SESSION_MAX_BYTES
    ):
        raise DecodeError("history summary is missing or oversized")
    return bytes(summaries[0].value)


def decode_cleaning_session(payload: bytes) -> CleaningSession | None:
    """Decode native history without treating its global default as room proof."""
    if len(payload) > MAX_HISTORY_BYTES:
        return None
    try:
        summary = _session_summary(payload)
    except DecodeError:
        return None
    started_at = decode_nested_timestamp(summary, 3)
    ended_at = decode_nested_timestamp(summary, 4)
    try:
        fields = bounded_fields(
            summary,
            max_bytes=_CLEANING_SESSION_MAX_BYTES,
            max_fields=_CLEANING_SESSION_MAX_FIELDS,
        )
    except DecodeError:
        return None
    semantics = decode_history_semantics(payload)
    if semantics is not None:
        return _canonical_cleaning_session(semantics, started_at, ended_at)
    if len(payload) > _CLEANING_SESSION_MAX_BYTES:
        return None
    # Modern pages are governed by the strict OEM-replayed decoder. If the
    # structure is recognized but its semantics are unknown, retain the keyed
    # record without granting room or completion credit.
    modern = tuple(field for field in fields if field.number == 11)
    if modern:
        if len(modern) != 1 or modern[0].wire_type != 2:
            return None
        return CleaningSession(started_at, ended_at, None, (), (), None)
    return _legacy_cleaning_session(started_at, ended_at, fields)


def _legacy_cleaning_session(
    started_at: str | None,
    ended_at: str | None,
    fields: tuple[WireField, ...],
) -> CleaningSession | None:
    """Project a summary older than the semantic decoder from its room maps."""
    results = _legacy_room_results(fields)
    if results is None:
        return None
    completion_status = _omittable_varint(fields, 5)
    room_completion = _legacy_room_completion(results)
    vacuum_completed_rooms = _legacy_mode_completed_rooms(results, 6, completion_status)
    mop_completed_rooms = _legacy_mode_completed_rooms(results, 7, completion_status)
    mode_results = tuple(
        CleaningModeResult(
            room=name,
            cleaning_mode="vacuum" if mode == 6 else "mop",
            status=None if status is None else MODE_STATUSES[status],
            duration_seconds=results.durations[(mode, name)],
        )
        for (mode, name), status in results.statuses.items()
    )
    room_durations: dict[str, int] = {}
    for result in mode_results:
        if result.duration_seconds is not None:
            room_durations[result.room] = (
                room_durations.get(result.room, 0) + result.duration_seconds
            )
    return CleaningSession(
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=_elapsed_seconds(started_at, ended_at),
        rooms=results.rooms,
        room_durations=tuple(room_durations.items()),
        completed=_legacy_session_completed(completion_status, room_completion),
        completed_rooms=tuple(
            name for name in results.rooms if room_completion[name] is True
        ),
        vacuum_completed_rooms=vacuum_completed_rooms,
        mop_completed_rooms=mop_completed_rooms,
        combined_completed_rooms=tuple(
            name for name in vacuum_completed_rooms if name in mop_completed_rooms
        ),
        mode_results=mode_results,
        stop_reason_code=_legacy_stop_reason_code(fields),
    )


def _legacy_room_results(fields: tuple[WireField, ...]) -> _LegacyRoomResults | None:
    """Read each room's result per mode; None past the room ceiling."""
    rooms: dict[str, None] = {}
    statuses: dict[tuple[int, str], int | None] = {}
    durations: dict[tuple[int, str], int | None] = {}
    modes: set[int] = set()
    for group in fields:
        if group.number not in (6, 7) or not isinstance(group.value, bytes):
            continue
        modes.add(group.number)
        for name, detail_fields in _legacy_group_rooms(group.value):
            if name not in rooms:
                if len(rooms) >= _CLEANING_SESSION_MAX_ROOMS:
                    return None
                rooms[name] = None
            key = (group.number, name)
            if key in statuses:
                # Duplicate map entries cannot supply unambiguous room proof.
                statuses[key] = None
                durations[key] = None
                continue
            status = _omittable_varint(detail_fields, 5)
            statuses[key] = status if status in MODE_STATUSES else None
            durations[key] = _legacy_room_duration(detail_fields)
    return _LegacyRoomResults(tuple(rooms), frozenset(modes), statuses, durations)


def _legacy_group_rooms(
    group: bytes,
) -> Iterator[tuple[str, tuple[WireField, ...]]]:
    """Yield the name and detail fields of each readable entry in one mode's map."""
    try:
        room_fields = telemetry_fields(group)
    except DecodeError:
        return
    for room_field in room_fields:
        if room_field.number != 1 or not isinstance(room_field.value, bytes):
            continue
        try:
            detail_fields = telemetry_fields(telemetry_bytes(room_field.value, 2))
        except DecodeError:
            continue
        name = decode_text_from_fields(detail_fields, 3)
        if name is not None:
            yield name, detail_fields


def _legacy_room_duration(detail_fields: tuple[WireField, ...]) -> int | None:
    """Return the seconds a mode spent in a room, if its duration is readable."""
    durations = field_bytes(detail_fields, 4)
    if not durations:
        return None
    try:
        return _omittable_varint(telemetry_fields(durations[0]), 1)
    except DecodeError:
        return None


def _omittable_varint(fields: tuple[WireField, ...], number: int) -> int | None:
    """Read a varint protobuf omits at zero; None if repeated or not a varint."""
    matches = [field for field in fields if field.number == number]
    if not matches:
        return 0
    if (
        len(matches) == 1
        and matches[0].wire_type == 0
        and isinstance(matches[0].value, int)
    ):
        return matches[0].value
    return None


def _legacy_room_completion(results: _LegacyRoomResults) -> dict[str, bool | None]:
    """Judge each room across the modes the session ran."""
    # SessionSummary groups 6/7 contain vacuum/mop AreaModeSummary maps.
    # Within each map value field 5 is status (0/1/2); field 6 is a setting,
    # not another mode. Omitted status is protobuf's unattempted default.
    room_completion: dict[str, bool | None] = {}
    for name in results.rooms:
        statuses = [results.statuses.get((mode, name)) for mode in results.modes]
        if all(status == _ROOM_MODE_COMPLETED_STATUS for status in statuses):
            room_completion[name] = True
        elif any(status in (0, 1) for status in statuses):
            room_completion[name] = False
        else:
            room_completion[name] = None
    return room_completion


def _legacy_mode_completed_rooms(
    results: _LegacyRoomResults, mode: int, completion_status: int | None
) -> tuple[str, ...]:
    """Return the rooms one mode completed in a session that itself completed."""
    if completion_status != _SESSION_COMPLETED_STATUS:
        return ()
    return tuple(
        name
        for name in results.rooms
        if results.statuses.get((mode, name)) == _ROOM_MODE_COMPLETED_STATUS
    )


def _legacy_session_completed(
    completion_status: int | None, room_completion: dict[str, bool | None]
) -> bool | None:
    """Combine the session's own status with its rooms' verdicts."""
    if completion_status not in (None, _SESSION_COMPLETED_STATUS):
        return False
    if completion_status is None or not room_completion:
        return None
    if any(value is False for value in room_completion.values()):
        return False
    if any(value is None for value in room_completion.values()):
        return None
    return True


def _elapsed_seconds(started_at: str | None, ended_at: str | None) -> int | None:
    """Return the whole seconds between two decoded timestamps, never negative."""
    if started_at is None or ended_at is None:
        return None
    elapsed = datetime.fromisoformat(ended_at) - datetime.fromisoformat(started_at)
    return max(0, round(elapsed.total_seconds()))


def _canonical_cleaning_session(
    semantics: SemanticHistory,
    started_at: str | None,
    ended_at: str | None,
) -> CleaningSession:
    """Project verified modern history without conflating stop and completion."""
    results = semantics.mode_results
    rooms = tuple(dict.fromkeys(result.room for result in results))
    by_room: dict[str, list[CleaningModeResult]] = {}
    identities_by_name: dict[str, set[str | None]] = {}
    for result in results:
        identities_by_name.setdefault(result.room, set()).add(result.room_id)
    unambiguous = tuple(
        result for result in results if len(identities_by_name[result.room]) == 1
    )
    durations: dict[str, int] = {}
    for result in unambiguous:
        by_room.setdefault(result.room, []).append(result)
        if result.duration_seconds is not None:
            durations[result.room] = (
                durations.get(result.room, 0) + result.duration_seconds
            )
    successful_stop = semantics.stop_reason == "finished"
    vacuum = tuple(
        result.room
        for result in unambiguous
        if successful_stop
        and result.cleaning_mode == "vacuum"
        and result.status == "completed"
    )
    mop = tuple(
        result.room
        for result in unambiguous
        if successful_stop
        and result.cleaning_mode == "mop"
        and result.status == "completed"
    )
    completed_rooms = tuple(
        name
        for name, values in by_room.items()
        if successful_stop and all(item.status == "completed" for item in values)
    )
    completed = (
        successful_stop and semantics.completion_kind == "completed"
        if semantics.completion_kind is not None
        else None
    )
    return CleaningSession(
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=_elapsed_seconds(started_at, ended_at),
        rooms=rooms,
        room_durations=tuple(durations.items()),
        completed=completed,
        completed_rooms=completed_rooms,
        vacuum_completed_rooms=vacuum,
        mop_completed_rooms=mop,
        combined_completed_rooms=tuple(name for name in vacuum if name in mop),
        mode_results=results,
        stop_reason_code=semantics.stop_reason_code,
        mission_id=semantics.mission_id,
        partition_id=semantics.partition_id,
        initiator=semantics.initiator,
        stop_reason=semantics.stop_reason,
        completion_kind=semantics.completion_kind,
    )


def _legacy_stop_reason_code(summary_fields: tuple[WireField, ...]) -> int | None:
    """Return a legacy summary's stop reason tag; None if unset or malformed."""
    reasons = [field for field in summary_fields if field.number == 10]
    if len(reasons) != 1 or not isinstance(reasons[0].value, bytes):
        return None
    try:
        variant = decode_stop_variant(reasons[0].value)
    except DecodeError:
        return None
    return None if variant is None else variant.number


def decode_nested_timestamp(payload: bytes, number: int) -> str | None:
    """Decode Matic's nested SystemTime/Timestamp wrapper as an ISO value."""
    try:
        wrapper = telemetry_bytes(
            payload,
            number,
            max_bytes=_CLEANING_SESSION_MAX_BYTES,
            max_fields=_CLEANING_SESSION_MAX_FIELDS,
        )
        timestamp = telemetry_bytes(wrapper, 1)
        seconds = telemetry_varint(timestamp, 1)
        try:
            nanos = telemetry_varint(timestamp, 2)
        except DecodeError:
            nanos = 0
        if nanos > 999_999_999:
            return None
        value = datetime.fromtimestamp(seconds + nanos / 1_000_000_000, UTC)
    except DecodeError, OSError, OverflowError, ValueError:
        return None
    return value.isoformat()
