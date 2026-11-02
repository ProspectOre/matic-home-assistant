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
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)
_SCHEDULE_ROOM_MAX_FIELDS = 16 * 1024
_SCHEDULE_BLOCK_ROOM_PATH = (7, 3, 3)


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
        name_fields = bounded_fields(
            payload, max_bytes=_SCHEDULE_MAX_BYTES, max_fields=_SCHEDULE_MAX_FIELDS
        )
        ordered = _schedule_ordered(name_fields)
        enabled = _schedule_enabled(name_fields)
        room_ids = _schedule_room_ids(payload) or _uuid_candidates(payload)
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


def _schedule_enabled(fields: tuple[WireField, ...]) -> bool | None:
    """Decode the native enabled-state oneof and only then its legacy bool."""
    markers = [field for field in fields if field.number in (8, 9, 10)]
    if markers:
        if len(markers) != 1 or markers[0].wire_type != 2 or markers[0].value != b"":
            return None
        return {8: True, 9: False, 10: None}[markers[0].number]
    legacy = [field for field in fields if field.number == 3]
    if len(legacy) == 1 and legacy[0].wire_type == 0 and legacy[0].value in (0, 1):
        return bool(legacy[0].value)
    return None


def _schedule_ordered(fields: tuple[WireField, ...]) -> bool | None:
    """Derive order from the native ordered or unordered room goal list."""
    kinds: set[int] = set()
    for field in fields:
        if field.number != 7:
            continue
        if field.wire_type != 2 or not isinstance(field.value, bytes):
            return None
        try:
            goals = bounded_fields(
                field.value,
                max_bytes=_SCHEDULE_MAX_BYTES,
                max_fields=_SCHEDULE_MAX_FIELDS,
            )
        except DecodeError:
            return None
        for goal in goals:
            if goal.number in (1, 2):
                if goal.wire_type != 2:
                    return None
                kinds.add(goal.number)
    return True if kinds == {1} else False if kinds == {2} else None


def _schedule_room_ids(payload: bytes) -> tuple[str, ...]:
    """Decode the floor-plan room ID from each bounded per-room goal block."""
    from .wire import (
        WireFieldLimitExceeded,
        bytes_fields,
        first_bytes,
        uuid_string,
    )

    found: dict[str, None] = {}
    budget = WireFieldBudget(_SCHEDULE_ROOM_MAX_FIELDS)
    for container in bytes_fields(payload, 7, field_budget=budget):
        try:
            blocks = decode_fields(
                container,
                max_fields=_SCHEDULE_MAX_FIELDS,
                field_budget=budget,
            )
        except WireFieldBudgetExceeded, WireFieldLimitExceeded:
            raise
        except DecodeError:
            continue
        for block in blocks:
            if block.number not in (1, 2) or block.wire_type != 2:
                continue
            try:
                room = block.value
                assert isinstance(room, bytes)
                for number in _SCHEDULE_BLOCK_ROOM_PATH:
                    room = first_bytes(room, number, field_budget=budget)
                room_id = uuid_string(room, field_budget=budget)
            except WireFieldBudgetExceeded, WireFieldLimitExceeded:
                raise
            except DecodeError:
                continue
            found[room_id] = None
            if len(found) > _SCHEDULE_MAX_UUIDS:
                raise DecodeError("schedule has too many room identifiers")
    return tuple(found)


def _schedule_cleaning_mode(fields: tuple[WireField, ...]) -> str | None:
    """Summarize the modes of a schedule's cleaning goals.

    Goals sit at 7.1 or 7.2 and carry the same 6.3 coverage spec as a start command;
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
        for list_kind in (1, 2)
        for goal in nested(field.value, list_kind)
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
