"""Bounded cleaning schedule decoders."""

from __future__ import annotations

import struct
from uuid import UUID

from google.protobuf.message import DecodeError

from .models import (
    CleaningSchedule,
)
from .telemetry_fields import (
    bounded_fields,
    decode_text_field,
    decode_text_from_fields,
    telemetry_bytes,
    telemetry_fields,
    telemetry_varint,
)
from .wire import (
    WireField,
    WireFieldBudget,
    WireFieldBudgetExceeded,
    WireFieldLimitExceeded,
    decode_fields,
)

_SCHEDULE_MAX_BYTES = 64 * 1024
_SCHEDULE_MAX_FIELDS = 1024
_SCHEDULE_MAX_UUIDS = 256
_SCHEDULE_MAX_DEPTH = 4
_WEEKDAYS = (
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
)


def decode_schedule(payload: bytes) -> CleaningSchedule | None:
    """Decode a robot-native weekly cleaning schedule."""
    if len(payload) > _SCHEDULE_MAX_BYTES:
        return None
    try:
        weekly = telemetry_bytes(
            payload, 1, max_bytes=_SCHEDULE_MAX_BYTES, max_fields=_SCHEDULE_MAX_FIELDS
        )
        days = telemetry_bytes(weekly, 1)
        schedule_time = telemetry_bytes(weekly, 3)
        minute_of_day = telemetry_varint(schedule_time, 1)
    except DecodeError:
        return None

    weekdays: list[str] = []
    for number, name in enumerate(_WEEKDAYS, start=1):
        try:
            if telemetry_varint(days, number):
                weekdays.append(name)
        except DecodeError:
            continue
    try:
        timezone_payload = telemetry_bytes(schedule_time, 4)
        timezone = decode_text_field(timezone_payload, 2)
    except DecodeError:
        timezone = None
    try:
        ordered = bool(
            telemetry_varint(
                payload,
                3,
                max_bytes=_SCHEDULE_MAX_BYTES,
                max_fields=_SCHEDULE_MAX_FIELDS,
            )
        )
    except DecodeError:
        ordered = False

    enabled: bool | None = None
    try:
        enabled_payload = telemetry_bytes(
            payload, 9, max_bytes=_SCHEDULE_MAX_BYTES, max_fields=_SCHEDULE_MAX_FIELDS
        )
        if not enabled_payload:
            enabled = True
        else:
            enabled_fields = telemetry_fields(enabled_payload)
            if enabled_fields:
                enabled = enabled_fields[0].number == 1
    except DecodeError:
        pass

    try:
        room_ids = _uuid_candidates(payload)
        name_fields = bounded_fields(
            payload, max_bytes=_SCHEDULE_MAX_BYTES, max_fields=_SCHEDULE_MAX_FIELDS
        )
    except DecodeError:
        return None
    return CleaningSchedule(
        name=decode_text_from_fields(name_fields, 2),
        weekdays=tuple(weekdays),
        minute_of_day=minute_of_day if 0 <= minute_of_day < 1440 else None,
        timezone=timezone,
        ordered=ordered,
        enabled=enabled,
        room_ids=room_ids,
        cleaning_mode=_schedule_cleaning_mode(name_fields),
    )


def _schedule_cleaning_mode(fields: tuple[WireField, ...]) -> str | None:
    """Summarize the modes of a schedule's cleaning goals.

    Goals sit at 7.1 and carry the same 6.3 coverage spec as a start command;
    spec field 4 is the mode, 0 for vacuum and 1 for mop, omitted when 0.
    The room walk in ``_uuid_candidates`` already rejects a schedule over the
    shared field budget, so this budget only guards against a second walk.
    """
    field_budget = WireFieldBudget(_SCHEDULE_MAX_FIELDS)
    modes: set[int] = set()

    def children(payload: bytes) -> tuple[WireField, ...] | None:
        try:
            return decode_fields(payload, field_budget=field_budget)
        except DecodeError:
            return None

    def nested(payload: bytes, number: int) -> list[bytes]:
        return [
            field.value
            for field in children(payload) or ()
            if field.number == number
            and field.wire_type == 2
            and isinstance(field.value, bytes)
        ]

    specs = [
        spec
        for field in fields
        if field.number == 7 and isinstance(field.value, bytes)
        for goal in nested(field.value, 1)
        for wrapper in nested(goal, 6)
        for spec in nested(wrapper, 3)
    ]
    for spec in specs:
        # Proto3 omits zero values, so an empty spec is a vacuum goal.
        spec_fields = children(spec)
        if spec_fields is None:
            continue
        modes.add(
            next(
                (
                    spec_field.value
                    for spec_field in spec_fields
                    if spec_field.number == 4 and isinstance(spec_field.value, int)
                ),
                0,
            )
        )
    if modes == {0}:
        return "vacuum"
    if modes == {1}:
        return "mop"
    if modes == {0, 1}:
        return "vacuum_and_mop"
    return None


def _uuid_candidates(payload: bytes) -> tuple[str, ...]:
    """Return stable UUID values nested in a protocol payload."""
    found: list[str] = []
    seen: set[str] = set()
    field_budget = WireFieldBudget(_SCHEDULE_MAX_FIELDS)

    def walk(data: bytes, depth: int) -> None:
        if depth > _SCHEDULE_MAX_DEPTH:
            return
        try:
            fields = decode_fields(data, field_budget=field_budget)
        except WireFieldBudgetExceeded, WireFieldLimitExceeded:
            raise
        except DecodeError:
            return
        fixed = {
            field.number: field.value
            for field in fields
            if field.wire_type == 1 and isinstance(field.value, bytes)
        }
        if set(fixed) >= {1, 2} and len(fixed[1]) == len(fixed[2]) == 8:
            low, high = struct.unpack("<QQ", fixed[1] + fixed[2])
            candidate = str(UUID(int=(low << 64) | high))
            if candidate not in seen:
                if len(found) >= _SCHEDULE_MAX_UUIDS:
                    raise DecodeError("schedule has too many room identifiers")
                seen.add(candidate)
                found.append(candidate)
        for field in fields:
            if field.wire_type == 2 and isinstance(field.value, bytes):
                walk(field.value, depth + 1)

    walk(payload, 0)
    return tuple(found)
