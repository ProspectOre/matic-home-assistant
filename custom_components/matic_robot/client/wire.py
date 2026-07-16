"""Decode bounded protobuf wire payloads."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from uuid import UUID

from google.protobuf.message import DecodeError


@dataclass(frozen=True, slots=True)
class WireField:
    """One protobuf wire field."""

    number: int
    wire_type: int
    value: int | bytes


def decode_fields(payload: bytes) -> tuple[WireField, ...]:
    """Decode a protobuf message without requiring its private schema."""
    fields: list[WireField] = []
    offset = 0
    while offset < len(payload):
        tag, offset = _decode_varint(payload, offset)
        number = tag >> 3
        wire_type = tag & 7
        if number == 0:
            raise DecodeError("invalid protobuf field number")
        value: int | bytes
        if wire_type == 0:
            value, offset = _decode_varint(payload, offset)
        elif wire_type == 1:
            value, offset = _take(payload, offset, 8)
        elif wire_type == 2:
            length, offset = _decode_varint(payload, offset)
            value, offset = _take(payload, offset, length)
        elif wire_type == 5:
            value, offset = _take(payload, offset, 4)
        else:
            raise DecodeError(f"unsupported protobuf wire type {wire_type}")
        fields.append(WireField(number, wire_type, value))
    return tuple(fields)


def bytes_fields(payload: bytes, number: int) -> tuple[bytes, ...]:
    """Return all length-delimited values for a field."""
    return tuple(
        field.value
        for field in decode_fields(payload)
        if field.number == number
        and field.wire_type == 2
        and isinstance(field.value, bytes)
    )


def first_bytes(payload: bytes, number: int) -> bytes:
    """Return the first length-delimited value for a field."""
    values = bytes_fields(payload, number)
    if not values:
        raise DecodeError(f"missing protobuf field {number}")
    return values[0]


def first_varint(payload: bytes, number: int) -> int:
    """Return the first varint value for a field."""
    for field in decode_fields(payload):
        if field.number == number and field.wire_type == 0:
            assert isinstance(field.value, int)
            return field.value
    raise DecodeError(f"missing protobuf varint field {number}")


def packed_floats(payload: bytes, count: int) -> tuple[float, ...]:
    """Decode a fixed-size little-endian float vector."""
    if len(payload) != count * 4:
        raise DecodeError("invalid packed float vector")
    return struct.unpack(f"<{count}f", payload)


def point(payload: bytes) -> tuple[float, float]:
    """Decode Matic's protobuf Point message."""
    coordinates = {1: 0.0, 2: 0.0}
    found = False
    for field in decode_fields(payload):
        if (
            field.number in coordinates
            and field.wire_type == 5
            and isinstance(field.value, bytes)
        ):
            coordinates[field.number] = struct.unpack("<f", field.value)[0]
            found = True
    if not found:
        raise DecodeError("invalid point")
    return coordinates[1], coordinates[2]


def uuid_string(payload: bytes, *, max_depth: int = 4) -> str:
    """Decode Matic's nested two-fixed64 UUID representation."""
    fields = decode_fields(payload)
    high = next(
        (
            field.value
            for field in fields
            if field.number == 1
            and field.wire_type == 1
            and isinstance(field.value, bytes)
            and len(field.value) == 8
        ),
        None,
    )
    low = next(
        (
            field.value
            for field in fields
            if field.number == 2
            and field.wire_type == 1
            and isinstance(field.value, bytes)
            and len(field.value) == 8
        ),
        None,
    )
    if high is not None and low is not None:
        value = (int.from_bytes(high, "little") << 64) | int.from_bytes(low, "little")
        return str(UUID(int=value))
    if max_depth > 0:
        for field in fields:
            if field.wire_type != 2 or not isinstance(field.value, bytes):
                continue
            try:
                return uuid_string(field.value, max_depth=max_depth - 1)
            except DecodeError:
                continue
    raise DecodeError("invalid Matic UUID")


def _decode_varint(payload: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while shift < 70:
        if offset >= len(payload):
            raise DecodeError("truncated protobuf varint")
        byte = payload[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
    raise DecodeError("oversized protobuf varint")


def _take(payload: bytes, offset: int, length: int) -> tuple[bytes, int]:
    end = offset + length
    if length < 0 or end > len(payload):
        raise DecodeError("truncated protobuf value")
    return payload[offset:end], end
