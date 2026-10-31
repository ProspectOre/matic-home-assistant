"""Bounded telemetry fields decoders."""

from __future__ import annotations

from google.protobuf.message import DecodeError

from .wire import (
    WireField,
    WireFieldLimitExceeded,
    decode_fields,
    field_bytes,
    field_varint,
)

_TELEMETRY_TEXT_MAX_BYTES = 512
TELEMETRY_NESTED_MAX_BYTES = 64 * 1024
_TELEMETRY_NESTED_MAX_FIELDS = 256


def bounded_fields(
    payload: bytes,
    *,
    max_bytes: int,
    max_fields: int,
) -> tuple[WireField, ...]:
    """Decode a protobuf message only within semantic byte and field budgets."""
    if len(payload) > max_bytes:
        raise DecodeError("telemetry payload exceeds the byte limit")
    try:
        return decode_fields(payload, max_fields=max_fields)
    except WireFieldLimitExceeded as err:
        raise DecodeError(
            "telemetry payload has too many fields (field limit)"
        ) from err


def telemetry_fields(payload: bytes) -> tuple[WireField, ...]:
    """Bound scalar property allocation before interpreting its fields."""
    return bounded_fields(
        payload,
        max_bytes=TELEMETRY_NESTED_MAX_BYTES,
        max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
    )


def telemetry_bytes(
    payload: bytes,
    number: int,
    *,
    max_bytes: int = TELEMETRY_NESTED_MAX_BYTES,
    max_fields: int = _TELEMETRY_NESTED_MAX_FIELDS,
) -> bytes:
    """Read a required bytes field after enforcing its message budgets."""
    values = field_bytes(
        bounded_fields(payload, max_bytes=max_bytes, max_fields=max_fields), number
    )
    if not values:
        raise DecodeError(f"missing protobuf field {number}")
    return values[0]


def telemetry_varint(
    payload: bytes,
    number: int,
    *,
    max_bytes: int = TELEMETRY_NESTED_MAX_BYTES,
    max_fields: int = _TELEMETRY_NESTED_MAX_FIELDS,
) -> int:
    """Read a required varint after enforcing its message budgets."""
    return field_varint(
        bounded_fields(payload, max_bytes=max_bytes, max_fields=max_fields), number
    )


def decode_text_from_fields(fields: tuple[WireField, ...], number: int) -> str | None:
    """Decode one bounded UTF-8 string from already parsed fields."""
    values = field_bytes(fields, number)
    value = values[0] if values else None
    if value is None or len(value) > _TELEMETRY_TEXT_MAX_BYTES:
        return None
    try:
        return value.decode("utf-8").strip() or None
    except UnicodeDecodeError:
        return None


def decode_text_field(payload: object, number: int) -> str | None:
    """Decode one safe UTF-8 protobuf string field."""
    if not isinstance(payload, bytes):
        return None
    try:
        return decode_text_from_fields(telemetry_fields(payload), number)
    except DecodeError:
        return None
