"""Decode maintenance suggestions and the bag pass."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import UTC, datetime

from google.protobuf.message import DecodeError

from .models import HermesCollectionEntry, MaintenancePart
from .wire import WireField, decode_fields, packed_varints

MAX_MAINTENANCE_SUGGESTIONS = 64
MAX_BAG_PASS_PAYLOAD_BYTES = 256
# 2000-01-01 to 2100-01-01: wider than any real pass, narrow enough to reject
# a misread field.
_MIN_PASS_SECONDS = 946_684_800
_MAX_PASS_SECONDS = 4_102_444_800

# The app declares BRUSH_ROLL, SIDE_BRUSH, MOP_ROLL, CASTER_AND_WEDGE. The
# robot sent 1, 2 and 3 and never 0, so the wire values are taken to start at
# 1 in that order. The app's recap screen has not confirmed the mapping yet.
MAINTENANCE_PARTS_BY_WIRE = {
    1: MaintenancePart.BRUSH_ROLL,
    2: MaintenancePart.SIDE_BRUSH,
    3: MaintenancePart.MOP_ROLL,
    4: MaintenancePart.CASTER_AND_WEDGE,
}


def decode_maintenance_suggestions(
    fields: Sequence[WireField],
) -> tuple[MaintenancePart, ...]:
    """Decode a recap's repeated maintenance enum, packed or unpacked.

    Values the integration does not know are skipped so a new part does not
    hide the known ones.
    """
    values: list[int] = []
    for field in fields:
        if field.wire_type == 0 and isinstance(field.value, int):
            values.append(field.value)
        elif field.wire_type == 2 and isinstance(field.value, bytes):
            values.extend(packed_varints(field.value, MAX_MAINTENANCE_SUGGESTIONS))
        else:
            raise DecodeError("maintenance suggestions have an invalid shape")
        if len(values) > MAX_MAINTENANCE_SUGGESTIONS:
            raise DecodeError("maintenance suggestions exceed the size limit")
    parts = {MAINTENANCE_PARTS_BY_WIRE.get(value) for value in values}
    return tuple(part for part in MaintenancePart if part in parts)


def latest_maintenance_suggestions(
    recaps: Iterable[tuple[int, int, tuple[MaintenancePart, ...]]],
) -> tuple[str, tuple[MaintenancePart, ...]] | None:
    """Return the newest month as ``YYYY-MM`` with its suggestions."""
    latest = max(recaps, key=lambda recap: (recap[1], recap[0]), default=None)
    if latest is None:
        return None
    month, year, parts = latest
    return f"{year:04d}-{month:02d}", parts


def decode_bag_pass_expiry(entry: HermesCollectionEntry) -> datetime | None:
    """Return when an active bag pass ends, or None for any other status.

    The robot sent field 1 holding two timestamps a year apart. The app's
    status is NotOwned, Active(expiresAt), ExpiringSoon or Expired(expiredAt),
    so field 1 is read as Active with its start and end. The tags of the
    other statuses are unknown, and they decode as no active pass.
    """
    if not entry.value or len(entry.value) > MAX_BAG_PASS_PAYLOAD_BYTES:
        raise DecodeError("bag pass payload is empty or oversized")
    fields = decode_fields(entry.value)
    active = [field for field in fields if field.number == 1]
    if not active:
        return None
    if len(active) != 1 or len(fields) != 1 or not isinstance(active[0].value, bytes):
        raise DecodeError("bag pass status has an invalid shape")
    span = decode_fields(active[0].value)
    starts = [field for field in span if field.number == 1]
    ends = [field for field in span if field.number == 2]
    if len(span) != 2 or len(starts) != 1 or len(ends) != 1:
        raise DecodeError("active bag pass has an invalid shape")
    start = _timestamp_seconds(starts[0])
    end = _timestamp_seconds(ends[0])
    if end <= start:
        raise DecodeError("active bag pass ends before it starts")
    return datetime.fromtimestamp(end, UTC)


def _timestamp_seconds(field: WireField) -> int:
    if field.wire_type != 2 or not isinstance(field.value, bytes):
        raise DecodeError("bag pass timestamp has an invalid shape")
    parts = decode_fields(field.value)
    seconds = [
        part.value
        for part in parts
        if part.number == 1 and part.wire_type == 0 and isinstance(part.value, int)
    ]
    nanos = [part for part in parts if part.number == 2 and part.wire_type == 0]
    if len(seconds) != 1 or len(parts) != 1 + len(nanos) or len(nanos) > 1:
        raise DecodeError("bag pass timestamp has an invalid shape")
    if not _MIN_PASS_SECONDS <= seconds[0] <= _MAX_PASS_SECONDS:
        raise DecodeError("bag pass timestamp is outside safe bounds")
    return seconds[0]
