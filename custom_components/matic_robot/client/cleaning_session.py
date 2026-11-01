"""Bounded cleaning session decoders."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from google.protobuf.message import DecodeError

from .exceptions import MaticError
from .models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    HermesCollectionEntry,
)
from .telemetry_fields import (
    _TELEMETRY_NESTED_MAX_FIELDS,
    TELEMETRY_NESTED_MAX_BYTES,
    bounded_fields,
    decode_text_field,
    telemetry_bytes,
    telemetry_varint,
)
from .wire import (
    WireField,
)

_SESSION_COMPLETED_STATUS = 0
_ROOM_MODE_COMPLETED_STATUS = 2
_CLEANING_SESSION_MAX_BYTES = 256 * 1024
_CLEANING_SESSION_MAX_FIELDS = 1024
_CLEANING_SESSION_MAX_ROOMS = 256


def _native_history_collection_revision(
    entries: tuple[HermesCollectionEntry, ...],
) -> str:
    """Hash ended records in a complete history snapshot without exposing them."""
    digest = hashlib.sha256(b"matic-native-history-v1\0")
    for entry in sorted(entries, key=lambda item: item.key):
        session = decode_cleaning_session(entry.value)
        if session is None or session.ended_at is None:
            continue
        digest.update(len(entry.key).to_bytes(4, "big"))
        digest.update(entry.key)
        digest.update(len(entry.value).to_bytes(8, "big"))
        digest.update(entry.value)
    return digest.hexdigest()


def decode_cleaning_session_records(
    entries: tuple[HermesCollectionEntry, ...], *, strict: bool = False
) -> tuple[CleaningSessionRecord, ...]:
    """Decode opaque-keyed history entries, optionally requiring full coverage."""
    records = tuple(
        CleaningSessionRecord(entry.key, session)
        for entry in entries
        if entry.key and (session := decode_cleaning_session(entry.value)) is not None
    )
    if strict and len(records) != len(entries):
        raise MaticError("Native history is incomplete or undecodable")
    return records


def decode_cleaning_session(payload: bytes) -> CleaningSession | None:
    """Decode native history without treating its global default as room proof."""
    if len(payload) > _CLEANING_SESSION_MAX_BYTES:
        return None
    try:
        summary = telemetry_bytes(
            payload,
            5,
            max_bytes=_CLEANING_SESSION_MAX_BYTES,
            max_fields=_CLEANING_SESSION_MAX_FIELDS,
        )
    except DecodeError:
        return None
    started_at = decode_nested_timestamp(summary, 3)
    ended_at = decode_nested_timestamp(summary, 4)
    rooms: list[str] = []
    seen_rooms: set[str] = set()
    statuses: dict[tuple[int, str], int | None] = {}
    durations: dict[tuple[int, str], int | None] = {}
    modes: set[int] = set()
    try:
        fields = bounded_fields(
            summary,
            max_bytes=_CLEANING_SESSION_MAX_BYTES,
            max_fields=_CLEANING_SESSION_MAX_FIELDS,
        )
    except DecodeError:
        return None
    for group in fields:
        if group.number not in (6, 7) or not isinstance(group.value, bytes):
            continue
        modes.add(group.number)
        try:
            room_fields = bounded_fields(
                group.value,
                max_bytes=TELEMETRY_NESTED_MAX_BYTES,
                max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
            )
        except DecodeError:
            continue
        for room_field in room_fields:
            if room_field.number != 1 or not isinstance(room_field.value, bytes):
                continue
            try:
                details = telemetry_bytes(room_field.value, 2)
                detail_fields = bounded_fields(
                    details,
                    max_bytes=TELEMETRY_NESTED_MAX_BYTES,
                    max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
                )
            except DecodeError:
                continue
            name = decode_text_field(details, 3)
            if name is None:
                continue
            if name not in seen_rooms:
                if len(rooms) >= _CLEANING_SESSION_MAX_ROOMS:
                    return None
                seen_rooms.add(name)
                rooms.append(name)
            key = (group.number, name)
            if key in statuses:
                # Duplicate map entries cannot supply unambiguous room proof.
                statuses[key] = None
                durations[key] = None
                continue
            status_fields = [field for field in detail_fields if field.number == 5]
            status = 0 if not status_fields else None
            if (
                len(status_fields) == 1
                and status_fields[0].wire_type == 0
                and isinstance(status_fields[0].value, int)
                and status_fields[0].value in (0, 1, 2)
            ):
                status = status_fields[0].value
            statuses[key] = status
            durations[key] = None
            try:
                duration = telemetry_bytes(details, 4)
                seconds_fields = [
                    field
                    for field in bounded_fields(
                        duration,
                        max_bytes=TELEMETRY_NESTED_MAX_BYTES,
                        max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
                    )
                    if field.number == 1
                ]
                if not seconds_fields:
                    durations[key] = 0
                elif (
                    len(seconds_fields) == 1
                    and seconds_fields[0].wire_type == 0
                    and isinstance(seconds_fields[0].value, int)
                ):
                    durations[key] = seconds_fields[0].value
            except DecodeError:
                pass

    duration_seconds = None
    if started_at is not None and ended_at is not None:
        duration_seconds = max(
            0,
            round(
                (
                    datetime.fromisoformat(ended_at)
                    - datetime.fromisoformat(started_at)
                ).total_seconds()
            ),
        )
    status_fields = [field for field in fields if field.number == 5]
    completion_status = 0 if not status_fields else None
    if (
        len(status_fields) == 1
        and status_fields[0].wire_type == 0
        and isinstance(status_fields[0].value, int)
    ):
        completion_status = status_fields[0].value
    # SessionSummary groups 6/7 contain vacuum/mop AreaModeSummary maps.
    # Within each map value field 5 is status (0/1/2); field 6 is a setting,
    # not another mode. Omitted status is protobuf's unattempted default.
    room_completion: dict[str, bool | None] = {}
    for name in rooms:
        results = [statuses.get((mode, name)) for mode in modes]
        if all(status == _ROOM_MODE_COMPLETED_STATUS for status in results):
            room_completion[name] = True
        elif any(status in (0, 1) for status in results):
            room_completion[name] = False
        else:
            room_completion[name] = None
    completed_rooms = tuple(name for name in rooms if room_completion.get(name) is True)
    vacuum_completed_rooms = tuple(
        name
        for name in rooms
        if completion_status == _SESSION_COMPLETED_STATUS
        and statuses.get((6, name)) == _ROOM_MODE_COMPLETED_STATUS
    )
    mop_completed_rooms = tuple(
        name
        for name in rooms
        if completion_status == _SESSION_COMPLETED_STATUS
        and statuses.get((7, name)) == _ROOM_MODE_COMPLETED_STATUS
    )
    combined_completed_rooms = tuple(
        name for name in vacuum_completed_rooms if name in mop_completed_rooms
    )
    mode_results = tuple(
        CleaningModeResult(
            room=name,
            cleaning_mode="vacuum" if mode == 6 else "mop",
            status={0: "unattempted", 1: "partial", 2: "completed", None: None}[status],
            duration_seconds=durations[(mode, name)],
        )
        for (mode, name), status in statuses.items()
    )
    room_durations: dict[str, int] = {}
    for result in mode_results:
        if result.duration_seconds is not None:
            room_durations[result.room] = (
                room_durations.get(result.room, 0) + result.duration_seconds
            )
    completed: bool | None
    if completion_status not in (None, _SESSION_COMPLETED_STATUS):
        completed = False
    elif completion_status is None or not room_completion:
        completed = None
    elif any(value is False for value in room_completion.values()):
        completed = False
    elif any(value is None for value in room_completion.values()):
        completed = None
    else:
        completed = True
    return CleaningSession(
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=duration_seconds,
        rooms=tuple(rooms),
        room_durations=tuple(room_durations.items()),
        completed=completed,
        completed_rooms=completed_rooms,
        vacuum_completed_rooms=vacuum_completed_rooms,
        mop_completed_rooms=mop_completed_rooms,
        combined_completed_rooms=combined_completed_rooms,
        mode_results=mode_results,
        stop_reason_code=decode_stop_reason_code(fields),
    )


def decode_stop_reason_code(summary_fields: tuple[WireField, ...]) -> int | None:
    """Return the oneof tag of the session's stop reason, if it has one."""
    reasons = [field for field in summary_fields if field.number == 10]
    if len(reasons) != 1 or not isinstance(reasons[0].value, bytes):
        return None
    try:
        variants = bounded_fields(
            reasons[0].value,
            max_bytes=TELEMETRY_NESTED_MAX_BYTES,
            max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
        )
    except DecodeError:
        return None
    if len(variants) != 1 or variants[0].wire_type != 2:
        return None
    return variants[0].number


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
        value = datetime.fromtimestamp(seconds + nanos / 1_000_000_000, UTC)
    except DecodeError, OSError, OverflowError, ValueError:
        return None
    return value.isoformat()
