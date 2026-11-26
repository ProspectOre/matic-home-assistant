"""Strict, provenance-bound decoder for native cleaning-history semantics.

This decoder intentionally accepts only the paths replayed against the OEM
decoder. It does not replace the older best-effort history display parser.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

from google.protobuf.message import DecodeError

from .models import MODE_STATUSES, CleaningModeResult
from .stop_reason import decode_stop_variant, stop_reason_name
from .wire import (
    WireField,
    WireFieldBudget,
    decode_fields,
    seconds_nanos,
    uuid_string,
)

# Large native records repeat opaque geometry in their goal envelopes.
MAX_HISTORY_BYTES = 4 * 1024 * 1024
MAX_HISTORY_FIELDS = 8192
MAX_ROOT_FIELDS = 1024
MAX_NESTED_BYTES = 64 * 1024
MAX_ROOMS = 256
MAX_NAME_BYTES = 512
MAX_NAME_CHARS = 128
MAX_DURATION_SECONDS = 366 * 24 * 60 * 60
_NIL_UUID = "00000000-0000-0000-0000-000000000000"

type HistoryField = WireField[memoryview]


@dataclass(frozen=True, slots=True)
class SemanticHistory:
    """Canonical native identity, outcome, and modern per-room results."""

    mission_id: int
    partition_id: str
    initiator: str
    stop_reason_code: int | None
    stop_reason: str | None
    completion_kind: str | None
    mode_results: tuple[CleaningModeResult, ...]


def decode_history_semantics(payload: bytes) -> SemanticHistory | None:
    """Decode OEM-replayed identity and outcomes; malformed input fails closed."""
    if not payload or len(payload) > MAX_HISTORY_BYTES:
        return None
    budget = WireFieldBudget(MAX_HISTORY_FIELDS)
    try:
        root = _fields(payload, budget, envelope=True, max_fields=MAX_ROOT_FIELDS)
        mission_wrapper = _fields(_required_message(root, 1), budget)
        mission = _required_fixed32(mission_wrapper, 2)
        log = _fields(_required_message(root, 2), budget, envelope=True)
        summary = _required_message(root, 5)
        events = _messages(log, 1)
        starts = []
        for event_payload in events:
            event = _fields(event_payload, budget, envelope=True)
            start_payload = _optional_message(event, 2)
            if start_payload is not None:
                candidate = _fields(start_payload, budget, envelope=True)
                goals_fields = tuple(field for field in candidate if field.number == 1)
                reason_fields = tuple(field for field in candidate if field.number == 3)
                if (
                    goals_fields
                    and reason_fields
                    and all(
                        field.wire_type == 2
                        for field in (*goals_fields, *reason_fields)
                    )
                ):
                    starts.append(start_payload)
        if len(starts) != 1:
            return None
        start = _fields(starts[0], budget, envelope=True)
        goals = _fields(_required_message(start, 1), budget, envelope=True)
        goals_v1 = _messages(goals, 1)
        goals_v2 = _messages(goals, 2)
        if goals_v1 and goals_v2:
            return None
        goal_items = goals_v2 or goals_v1
        if not goal_items:
            return None
        partitions: list[str] = []
        for item in goal_items:
            goal = _fields(item, budget, envelope=True)
            metadata = _fields(_required_message(goal, 7), budget, envelope=True)
            partition_envelope = _fields(_required_message(metadata, 1), budget)
            partition_identity_envelope = _fields(
                _required_message(partition_envelope, 1), budget
            )
            # The identity's enclosing message holds it to the nested byte limit.
            partitions.append(
                uuid_string(
                    _required_message(partition_identity_envelope, 2),
                    path=(),
                    max_fields=MAX_HISTORY_FIELDS,
                    field_budget=budget,
                )
            )
        if len(set(partitions)) != 1 or partitions[0] == _NIL_UUID:
            return None

        initiator = _decode_initiator(start, budget)

        summary_fields = _fields(summary, budget)
        # Field 9's presence is mandatory in the OEM message. Its value is not
        # used as the initiating source; the canonical event log is authoritative.
        if not _has_exact_one(summary_fields, 9, 2):
            return None
        stop_payload = _optional_message(summary_fields, 10)
        stop_reason_code, stop_reason = _decode_stop_reason(stop_payload, budget)
        mode_results = _decode_modern_rooms(summary_fields, budget)
        if mode_results is None:
            return None
        completion_kind = _completion_kind(mode_results)
        return SemanticHistory(
            mission_id=mission,
            partition_id=partitions[0],
            initiator=initiator,
            stop_reason_code=stop_reason_code,
            stop_reason=stop_reason,
            completion_kind=completion_kind,
            mode_results=mode_results,
        )
    except DecodeError, ValueError, TypeError, UnicodeDecodeError:
        return None


def _fields(
    payload: bytes | memoryview,
    budget: WireFieldBudget,
    *,
    envelope: bool = False,
    max_fields: int = MAX_HISTORY_FIELDS,
) -> tuple[HistoryField, ...]:
    if len(payload) > (MAX_HISTORY_BYTES if envelope else MAX_NESTED_BYTES):
        raise DecodeError("history message exceeds byte limit")
    return decode_fields(
        memoryview(payload), max_fields=max_fields, field_budget=budget
    )


def _known(
    fields: tuple[HistoryField, ...], number: int, wire: int
) -> tuple[HistoryField, ...]:
    found = tuple(field for field in fields if field.number == number)
    if any(field.wire_type != wire for field in found):
        raise DecodeError("history known field has wrong wire type")
    if len(found) > 1:
        raise DecodeError("history known field is duplicated")
    return found


def _has_exact_one(fields: tuple[HistoryField, ...], number: int, wire: int) -> bool:
    return len(_known(fields, number, wire)) == 1


def _optional_varint(fields: tuple[HistoryField, ...], number: int) -> int | None:
    values = _known(fields, number, 0)
    if not values:
        return None
    if not isinstance(values[0].value, int):
        raise DecodeError("history varint is malformed")
    return values[0].value


def _messages(fields: tuple[HistoryField, ...], number: int) -> tuple[memoryview, ...]:
    found = tuple(field for field in fields if field.number == number)
    if any(
        field.wire_type != 2 or not isinstance(field.value, memoryview)
        for field in found
    ):
        raise DecodeError("history repeated message has wrong wire type")
    return tuple(field.value for field in found if isinstance(field.value, memoryview))


def _required_message(fields: tuple[HistoryField, ...], number: int) -> memoryview:
    values = _known(fields, number, 2)
    if len(values) != 1 or not isinstance(values[0].value, memoryview):
        raise DecodeError("history required message is missing")
    return values[0].value


def _optional_message(
    fields: tuple[HistoryField, ...], number: int
) -> memoryview | None:
    values = _known(fields, number, 2)
    if not values:
        return None
    if not isinstance(values[0].value, memoryview):
        raise DecodeError("history optional message is malformed")
    return values[0].value


def _required_fixed32(fields: tuple[HistoryField, ...], number: int) -> int:
    values = _known(fields, number, 5)
    if (
        len(values) != 1
        or not isinstance(values[0].value, memoryview)
        or len(values[0].value) != 4
    ):
        raise DecodeError("history fixed32 is missing")
    return int(struct.unpack("<I", values[0].value)[0])


def _decode_initiator(start: tuple[HistoryField, ...], budget: WireFieldBudget) -> str:
    # StartReason field 3 contains User or Schedule. Schedule labels are
    # deliberately decoded only for shape and are not retained.
    reason = _fields(_required_message(start, 3), budget)
    user = _optional_message(reason, 2)
    schedule = _optional_message(reason, 3)
    if user is not None and schedule is not None:
        raise DecodeError("history start reason is ambiguous")
    if schedule is not None:
        _decode_schedule(schedule, budget)
        return "schedule"
    if user is None:
        raise DecodeError("history start reason is unsupported")
    user_fields = _fields(user, budget)
    children = tuple(
        field for field in user_fields if field.number in (1, 2, 3, 4, 5, 6, 7)
    )
    if len(children) > 1:
        raise DecodeError("history user start reason is ambiguous")
    if not children:
        raise DecodeError("history user start reason is malformed")
    child = children[0]
    if child.wire_type != 2 or not isinstance(child.value, memoryview):
        raise DecodeError("history user start reason is malformed")
    # OEM child 7 falls through to default App; do not credit it.
    values = {
        1: "app",
        2: "atrium",
        3: "button",
        4: "matter",
        5: "voice",
        6: "gesture",
    }
    if child.number not in values or child.value:
        raise DecodeError("history user start reason is unsupported")
    return values[child.number]


def _decode_schedule(payload: memoryview, budget: WireFieldBudget) -> None:
    fields = _fields(payload, budget)
    names = _known(fields, 2, 2)
    if not names:
        return
    name = names[0].value
    if not isinstance(name, memoryview) or len(name) > MAX_NAME_BYTES:
        raise DecodeError("history schedule label is oversized")
    decoded = bytes(name).decode("utf-8").strip()
    if len(decoded) > MAX_NAME_CHARS or any(not char.isprintable() for char in decoded):
        raise DecodeError("history schedule label is malformed")


# Each named variant carries one empty OEM marker: finished {5:{1:{}}} or
# {5:{2:{}}}, cancelled by the user {8:{1:{}}}.
_STOP_REASON_MARKERS = {5: (1, 2), 8: (1,)}


def _decode_stop_reason(
    payload: memoryview | None, budget: WireFieldBudget
) -> tuple[int | None, str | None]:
    if payload is None:
        return None, "bot_cancelled"
    variant = decode_stop_variant(payload, field_budget=budget)
    if variant is None:
        return None, None
    markers = _STOP_REASON_MARKERS.get(variant.number)
    if markers is not None:
        assert isinstance(variant.value, memoryview)
        _require_empty_marker(variant.value, markers, budget)
    return variant.number, stop_reason_name(variant.number)


def _require_empty_marker(
    payload: memoryview, numbers: tuple[int, ...], budget: WireFieldBudget
) -> None:
    envelope = _fields(payload, budget)
    markers = [field for field in envelope if field.number in numbers]
    if len(markers) != 1 or any(
        field.wire_type != 2 or field.value for field in markers
    ):
        raise DecodeError("history outcome marker is malformed")


def _decode_modern_rooms(
    summary: tuple[HistoryField, ...], budget: WireFieldBudget
) -> tuple[CleaningModeResult, ...] | None:
    modern = _required_message(summary, 11)
    region_entries = _messages(_fields(modern, budget), 1)
    if not region_entries or len(region_entries) > MAX_ROOMS:
        return None
    results: list[CleaningModeResult] = []
    seen: set[tuple[str, int]] = set()
    room_ids: set[str] = set()
    room_names: dict[str, str] = {}
    for entry_payload in region_entries:
        entry = _fields(entry_payload, budget)
        region_envelope = _fields(_required_message(entry, 1), budget)
        region = _fields(_required_message(region_envelope, 2), budget)
        room_id = uuid_string(
            _required_message(region, 2),
            path=(),
            max_fields=MAX_HISTORY_FIELDS,
            field_budget=budget,
        )
        if room_id == _NIL_UUID or room_id in room_ids:
            return None
        room_ids.add(room_id)
        area = _fields(_required_message(entry, 2), budget)
        name_field = _known(area, 1, 2)
        if len(name_field) != 1 or not isinstance(name_field[0].value, memoryview):
            return None
        raw_name = name_field[0].value
        if len(raw_name) > MAX_NAME_BYTES:
            return None
        name = bytes(raw_name).decode("utf-8").strip()
        if (
            not name
            or len(name) > MAX_NAME_CHARS
            or any(not char.isprintable() for char in name)
        ):
            return None
        room_names[room_id] = name
        mode_entries = _messages(area, 2)
        if not mode_entries:
            return None
        for mode_entry_payload in mode_entries:
            mode_entry = _fields(mode_entry_payload, budget)
            mode = _optional_varint(mode_entry, 1)
            mode = 0 if mode is None else mode
            if mode not in (0, 1) or (room_id, mode) in seen:
                return None
            seen.add((room_id, mode))
            mode_summary = _fields(_required_message(mode_entry, 2), budget)
            status = _optional_varint(mode_summary, 5)
            status = 0 if status is None else status
            if status not in MODE_STATUSES:
                results.append(
                    CleaningModeResult(
                        name, "vacuum" if mode == 0 else "mop", None, None, room_id
                    )
                )
                continue
            duration_payload = _optional_message(mode_summary, 4)
            duration = (
                room_duration_seconds(_fields(duration_payload, budget))
                if duration_payload is not None
                else None
            )
            results.append(
                CleaningModeResult(
                    name,
                    "vacuum" if mode == 0 else "mop",
                    MODE_STATUSES[status],
                    duration,
                    room_id,
                )
            )
    # Names are display labels; identity remains the canonical UUID.
    return tuple(results)


def room_duration_seconds[Buffer: (bytes, memoryview)](
    fields: tuple[WireField[Buffer], ...],
) -> int:
    """Return the whole seconds of one room mode's Duration, legacy or modern."""
    seconds, _ = seconds_nanos(fields)
    if seconds > MAX_DURATION_SECONDS:
        raise DecodeError("history duration outside safe bounds")
    return seconds


def _completion_kind(results: tuple[CleaningModeResult, ...]) -> str | None:
    statuses = [result.status for result in results]
    if not statuses or any(status is None for status in statuses):
        return None
    if all(status == "completed" for status in statuses):
        return "completed"
    if all(status == "unattempted" for status in statuses):
        return "not_started"
    return "incomplete"
