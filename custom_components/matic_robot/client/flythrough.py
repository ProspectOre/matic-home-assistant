"""Decode bounded mission-scoped flythrough geometry."""

from __future__ import annotations

import hashlib
import math
import struct
from dataclasses import dataclass
from typing import cast

from google.protobuf.message import DecodeError

from .wire import decode_fields

MAX_FLYTHROUGH_PAYLOAD_BYTES = 1024 * 1024
MAX_FLYTHROUGH_POSES = 10_000
MAX_ABSOLUTE_MAP_COORDINATE = 10_000.0


@dataclass(frozen=True, slots=True)
class FlythroughPose:
    """One camera location and target from the robot's native map tour."""

    location: tuple[float, float, float]
    target: tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class Flythrough:
    """A bounded native map tour correlated to one SLAM mission."""

    mission_token: str
    poses: tuple[FlythroughPose, ...]


def decode_flythrough(payload: bytes, *, expected_mission_token: str) -> Flythrough:
    """Decode a verified native map flythrough for the expected SLAM mission."""
    if not payload:
        raise DecodeError("flythrough payload is empty")
    if len(payload) > MAX_FLYTHROUGH_PAYLOAD_BYTES:
        raise DecodeError("flythrough payload exceeds the size limit")

    fields = decode_fields(payload)
    if (
        len(fields) < 2
        or len(fields) > MAX_FLYTHROUGH_POSES + 1
        or any(
            field.number != 1
            or field.wire_type != 2
            or not isinstance(field.value, bytes)
            for field in fields[:-1]
        )
        or fields[-1].number != 2
        or fields[-1].wire_type != 2
        or not isinstance(fields[-1].value, bytes)
    ):
        raise DecodeError("flythrough envelope has an invalid shape")

    mission = _decode_mission(fields[-1].value)
    mission_token = hashlib.sha256(mission).hexdigest()
    if mission_token != expected_mission_token:
        raise DecodeError("flythrough mission does not match the active map")

    return Flythrough(
        mission_token=mission_token,
        poses=tuple(_decode_pose(cast(bytes, field.value)) for field in fields[:-1]),
    )


def _decode_mission(payload: bytes) -> bytes:
    fields = decode_fields(payload)
    if (
        len(fields) != 1
        or fields[0].number != 2
        or fields[0].wire_type != 5
        or not isinstance(fields[0].value, bytes)
    ):
        raise DecodeError("flythrough mission has an invalid shape")
    return payload


def _decode_pose(payload: bytes) -> FlythroughPose:
    fields = decode_fields(payload)
    if tuple((field.number, field.wire_type) for field in fields) != (
        (1, 2),
        (2, 2),
    ):
        raise DecodeError("flythrough pose has an invalid shape")
    location = _decode_vector(cast(bytes, fields[0].value), require_z=True)
    target = _decode_vector(cast(bytes, fields[1].value), require_z=False)
    return FlythroughPose(location=location, target=target)


def _decode_vector(payload: bytes, *, require_z: bool) -> tuple[float, float, float]:
    fields = decode_fields(payload)
    expected = ((1, 5), (2, 5), (3, 5)) if require_z else ((1, 5), (2, 5))
    shape = tuple((field.number, field.wire_type) for field in fields)
    if shape not in (expected, ((1, 5), (2, 5), (3, 5))):
        raise DecodeError("flythrough vector has an invalid shape")
    values = tuple(struct.unpack("<f", cast(bytes, field.value))[0] for field in fields)
    if not all(
        math.isfinite(value) and abs(value) <= MAX_ABSOLUTE_MAP_COORDINATE
        for value in values
    ):
        raise DecodeError("flythrough vector is outside safe coordinate bounds")
    if len(values) == 2:
        return values[0], values[1], 0.0
    return values[0], values[1], values[2]
