"""Boundary and malformed-input tests for the bounded protobuf decoder."""

from __future__ import annotations

import struct

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.wire import (
    decode_fields,
    first_bytes,
    first_varint,
    packed_floats,
    point,
    uuid_string,
)


@pytest.mark.parametrize(
    "payload",
    [b"\x00", b"\x0b", b"\x08\x80", b"\x08" + b"\x80" * 10],
)
def test_decode_fields_rejects_invalid_wire_data(payload: bytes) -> None:
    with pytest.raises(DecodeError):
        decode_fields(payload)


def test_fixed_width_and_missing_field_errors() -> None:
    with pytest.raises(DecodeError, match="truncated protobuf value"):
        decode_fields(b"\x09\x00")
    with pytest.raises(DecodeError, match="missing protobuf field"):
        first_bytes(b"", 1)
    with pytest.raises(DecodeError, match="missing protobuf varint"):
        first_varint(b"", 1)
    with pytest.raises(DecodeError, match="packed float"):
        packed_floats(b"short", 2)
    with pytest.raises(DecodeError, match="invalid point"):
        point(b"\x08\x01")


def test_point_and_nested_uuid_decode() -> None:
    assert point(b"\x0d" + struct.pack("<f", 1.5)) == (1.5, 0.0)
    nested_uuid = b"\x0a\x12\x09" + b"\x01" * 8 + b"\x11" + b"\x02" * 8
    assert uuid_string(nested_uuid) == "01010101-0101-0101-0202-020202020202"
    with pytest.raises(DecodeError, match="invalid Matic UUID"):
        uuid_string(b"", max_depth=0)


def test_uuid_search_skips_non_message_and_invalid_nested_fields() -> None:
    uuid_message = b"\x09" + b"\x01" * 8 + b"\x11" + b"\x02" * 8
    payload = (
        b"\x18\x05"  # varint field: not a nested message, skipped
        + b"\x0a\x01\x00"  # nested bytes that fail to decode, skipped
        + b"\x0a\x12"
        + uuid_message
    )

    assert uuid_string(payload) == "01010101-0101-0101-0202-020202020202"
