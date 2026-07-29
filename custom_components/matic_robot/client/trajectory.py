"""Decode mission-scoped live route geometry."""

from __future__ import annotations

import math
import struct

from google.protobuf.message import DecodeError

from .models import RobotTrajectory
from .wire import WireField, decode_fields

MAX_TRAJECTORY_PAYLOAD_BYTES = 64 * 1024
MAX_TRAJECTORY_POINTS = 4_096
MAX_ABSOLUTE_MAP_COORDINATE = 10_000.0


def decode_approximate_trajectory(
    payload: bytes, *, expected_mission_id: int
) -> RobotTrajectory:
    """Decode one verified trajectory update for the active floor-plan mission."""
    if not payload:
        raise DecodeError("trajectory payload is empty")
    if len(payload) > MAX_TRAJECTORY_PAYLOAD_BYTES:
        raise DecodeError("trajectory payload exceeds the size limit")

    fields = decode_fields(payload)
    path_fields = _length_delimited(fields, 1)
    mission_fields = _length_delimited(fields, 2)
    if (
        len(path_fields) > 1
        or len(mission_fields) != 1
        or any(
            not (
                field.number in (1, 2)
                and field.wire_type == 2
                and isinstance(field.value, bytes)
            )
            for field in fields
        )
    ):
        raise DecodeError("trajectory envelope has an invalid shape")

    mission_id = _decode_mission_id(mission_fields[0])
    if mission_id != expected_mission_id:
        raise DecodeError("trajectory mission does not match the active floor plan")
    if not path_fields:
        return RobotTrajectory(mission_id=mission_id, points=())

    path = decode_fields(path_fields[0])
    point_fields = _length_delimited(path, 1)
    metadata = _fixed32_values(path, 3)
    if (
        not point_fields
        or len(point_fields) > MAX_TRAJECTORY_POINTS
        or len(metadata) != 1
        or any(
            not (
                (
                    field.number == 1
                    and field.wire_type == 2
                    and isinstance(field.value, bytes)
                )
                or (
                    field.number == 3
                    and field.wire_type == 5
                    and isinstance(field.value, bytes)
                )
            )
            for field in path
        )
    ):
        raise DecodeError("trajectory path has an invalid shape")
    if not math.isfinite(struct.unpack("<f", metadata[0])[0]):
        raise DecodeError("trajectory metadata is not finite")

    return RobotTrajectory(
        mission_id=mission_id,
        points=tuple(_decode_point(value) for value in point_fields),
    )


def _length_delimited(fields: tuple[WireField, ...], number: int) -> tuple[bytes, ...]:
    """Return exact length-delimited occurrences of one field."""
    return tuple(
        field.value
        for field in fields
        if field.number == number
        and field.wire_type == 2
        and isinstance(field.value, bytes)
    )


def _fixed32_values(fields: tuple[WireField, ...], number: int) -> tuple[bytes, ...]:
    """Return exact fixed-width occurrences of one field."""
    return tuple(
        field.value
        for field in fields
        if field.number == number
        and field.wire_type == 5
        and isinstance(field.value, bytes)
    )


def _decode_mission_id(payload: bytes) -> int:
    """Decode the observed fixed-width mission identifier."""
    fields = decode_fields(payload)
    if (
        len(fields) != 1
        or fields[0].number != 2
        or fields[0].wire_type != 5
        or not isinstance(fields[0].value, bytes)
    ):
        raise DecodeError("trajectory mission identifier has an invalid shape")
    return int(struct.unpack("<I", fields[0].value)[0])


def _decode_point(payload: bytes) -> tuple[float, float]:
    """Decode one complete, finite 2D route point."""
    fields = decode_fields(payload)
    coordinates: dict[int, float] = {}
    for field in fields:
        if (
            field.number not in (1, 2)
            or field.number in coordinates
            or field.wire_type != 5
            or not isinstance(field.value, bytes)
        ):
            raise DecodeError("trajectory point has an invalid shape")
        coordinates[field.number] = struct.unpack("<f", field.value)[0]
    if set(coordinates) != {1, 2}:
        raise DecodeError("trajectory point is incomplete")
    value = (coordinates[1], coordinates[2])
    if not all(
        math.isfinite(axis) and abs(axis) <= MAX_ABSOLUTE_MAP_COORDINATE
        for axis in value
    ):
        raise DecodeError("trajectory point is outside safe coordinate bounds")
    return value
