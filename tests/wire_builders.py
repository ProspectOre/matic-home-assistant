"""Shared protobuf wire-encoding builders for synthetic test fixtures.

These are plain importable helpers (not pytest fixtures) used to assemble
byte-for-byte synthetic Hermes payloads. All data produced here is synthetic;
nothing in this module encodes a real robot credential, address, or map.
"""

from __future__ import annotations

import struct
from uuid import UUID


def _varint(value: int) -> bytes:
    """Encode an unsigned integer as a protobuf base-128 varint."""
    result = bytearray()
    while value > 0x7F:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value)
    return bytes(result)


def _vfield(number: int, value: int) -> bytes:
    """Encode a varint (wire type 0) field."""
    return _varint(number << 3) + _varint(value)


def _bfield(number: int, value: bytes) -> bytes:
    """Encode a length-delimited (wire type 2) field."""
    return _varint((number << 3) | 2) + _varint(len(value)) + value


def _fixed32(number: int, value: float) -> bytes:
    """Encode a 32-bit float (wire type 5) field."""
    return _varint((number << 3) | 5) + struct.pack("<f", value)


def _fixed64(number: int, value: int) -> bytes:
    """Encode a 64-bit fixed (wire type 1) field."""
    return _varint((number << 3) | 1) + struct.pack("<Q", value)


def _session_identity(session_id: UUID) -> bytes:
    """Encode the synthetic UUID fields returned by native session reads."""
    return _fixed64(1, session_id.int >> 64) + _fixed64(
        2, session_id.int & ((1 << 64) - 1)
    )


# Aliases matching the historical names used by individual test modules.
_field = _bfield
_varint_field = _vfield
