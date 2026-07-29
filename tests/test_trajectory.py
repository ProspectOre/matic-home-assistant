"""Tests for bounded live trajectory decoding."""

from __future__ import annotations

import struct

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.trajectory import (
    MAX_ABSOLUTE_MAP_COORDINATE,
    MAX_TRAJECTORY_PAYLOAD_BYTES,
    MAX_TRAJECTORY_POINTS,
    decode_approximate_trajectory,
)

MISSION_ID = 0x1234ABCD


def _varint(value: int) -> bytes:
    result = bytearray()
    while value >= 0x80:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value)
    return bytes(result)


def _tag(number: int, wire_type: int) -> bytes:
    return _varint((number << 3) | wire_type)


def _bytes_field(number: int, value: bytes) -> bytes:
    return _tag(number, 2) + _varint(len(value)) + value


def _fixed32(number: int, value: float) -> bytes:
    return _tag(number, 5) + struct.pack("<f", value)


def _mission(value: int = MISSION_ID) -> bytes:
    return _bytes_field(2, _tag(2, 5) + struct.pack("<I", value))


def _point(x: float, y: float) -> bytes:
    return _bytes_field(1, _fixed32(1, x) + _fixed32(2, y))


def _path(*points: bytes, metadata: bytes | None = None) -> bytes:
    return _bytes_field(
        1,
        b"".join(points) + (metadata if metadata is not None else _fixed32(3, 1.5)),
    )


def test_decode_approximate_trajectory_and_clear_marker() -> None:
    trajectory = decode_approximate_trajectory(
        _path(_point(-1.25, 2.5), _point(3.75, -4.5)) + _mission(),
        expected_mission_id=MISSION_ID,
    )

    assert trajectory.mission_id == MISSION_ID
    assert trajectory.points == ((-1.25, 2.5), (3.75, -4.5))
    assert (
        decode_approximate_trajectory(_mission(), expected_mission_id=MISSION_ID).points
        == ()
    )


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (b"", "empty"),
        (b"\x00" * (MAX_TRAJECTORY_PAYLOAD_BYTES + 1), "size limit"),
        (_path(_point(1.0, 2.0)), "envelope"),
        (_mission() + _mission(), "envelope"),
        (_path(_point(1.0, 2.0)) * 2 + _mission(), "envelope"),
        (_mission() + _bytes_field(4, b"unknown"), "envelope"),
        (_mission() + _tag(1, 0) + _varint(1), "envelope"),
        (_bytes_field(2, _fixed32(1, 1.0)), "mission identifier"),
        (_mission(MISSION_ID + 1), "does not match"),
    ],
)
def test_decode_approximate_trajectory_rejects_invalid_envelopes(
    payload: bytes, message: str
) -> None:
    with pytest.raises(DecodeError, match=message):
        decode_approximate_trajectory(payload, expected_mission_id=MISSION_ID)


@pytest.mark.parametrize(
    ("path", "message"),
    [
        (_path(), "path"),
        (_path(_point(1.0, 2.0), metadata=b""), "path"),
        (
            _path(
                _point(1.0, 2.0),
                metadata=_fixed32(3, 1.0) + _fixed32(3, 2.0),
            ),
            "path",
        ),
        (
            _path(
                _point(1.0, 2.0),
                metadata=_fixed32(3, float("nan")),
            ),
            "metadata",
        ),
        (
            _path(
                _point(1.0, 2.0),
                metadata=_fixed32(3, 1.0) + _fixed32(4, 2.0),
            ),
            "path",
        ),
        (
            _path(
                _point(1.0, 2.0),
                metadata=_fixed32(3, 1.0) + _tag(1, 0) + _varint(1),
            ),
            "path",
        ),
    ],
)
def test_decode_approximate_trajectory_rejects_invalid_paths(
    path: bytes, message: str
) -> None:
    with pytest.raises(DecodeError, match=message):
        decode_approximate_trajectory(path + _mission(), expected_mission_id=MISSION_ID)


def test_decode_approximate_trajectory_enforces_point_limit() -> None:
    payload = _path(*(_point(1.0, 2.0) for _ in range(MAX_TRAJECTORY_POINTS + 1)))

    with pytest.raises(DecodeError, match="path"):
        decode_approximate_trajectory(
            payload + _mission(), expected_mission_id=MISSION_ID
        )


@pytest.mark.parametrize(
    "point",
    [
        _bytes_field(1, _fixed32(1, 1.0)),
        _bytes_field(1, _fixed32(1, 1.0) + _fixed32(1, 2.0) + _fixed32(2, 3.0)),
        _bytes_field(1, _fixed32(1, 1.0) + _fixed32(3, 2.0)),
        _bytes_field(1, _fixed32(1, float("inf")) + _fixed32(2, 2.0)),
        _point(MAX_ABSOLUTE_MAP_COORDINATE + 1.0, 2.0),
    ],
)
def test_decode_approximate_trajectory_rejects_invalid_points(point: bytes) -> None:
    with pytest.raises(DecodeError, match="point"):
        decode_approximate_trajectory(
            _path(point) + _mission(), expected_mission_id=MISSION_ID
        )
