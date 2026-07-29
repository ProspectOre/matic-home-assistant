"""Tests for bounded native flythrough decoding."""

from __future__ import annotations

import hashlib
import math
import struct

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.flythrough import (
    MAX_FLYTHROUGH_PAYLOAD_BYTES,
    MAX_FLYTHROUGH_POSES,
    decode_flythrough,
)

MISSION = bytes((2 << 3 | 5,)) + struct.pack("<I", 0x1234ABCD)
MISSION_TOKEN = hashlib.sha256(MISSION).hexdigest()


def _bytes_field(number: int, value: bytes) -> bytes:
    assert len(value) < 128
    return bytes((number << 3 | 2, len(value))) + value


def _fixed32_field(number: int, value: float) -> bytes:
    return bytes((number << 3 | 5,)) + struct.pack("<f", value)


def _vector(x: float, y: float, z: float | None = None) -> bytes:
    payload = _fixed32_field(1, x) + _fixed32_field(2, y)
    return payload if z is None else payload + _fixed32_field(3, z)


def _pose(
    *,
    location: bytes | None = None,
    target: bytes | None = None,
) -> bytes:
    return _bytes_field(1, location or _vector(1.0, -2.0, 3.0)) + _bytes_field(
        2, target or _vector(4.0, 5.0)
    )


def _payload(*poses: bytes, mission: bytes = MISSION) -> bytes:
    return b"".join(_bytes_field(1, pose) for pose in poses) + _bytes_field(2, mission)


def test_decode_flythrough_preserves_native_pose_geometry() -> None:
    decoded = decode_flythrough(
        _payload(
            _pose(),
            _pose(target=_vector(-6.0, 7.0, 8.0)),
        ),
        expected_mission_token=MISSION_TOKEN,
    )

    assert decoded.mission_token == MISSION_TOKEN
    assert decoded.poses[0].location == (1.0, -2.0, 3.0)
    assert decoded.poses[0].target == (4.0, 5.0, 0.0)
    assert decoded.poses[1].target == (-6.0, 7.0, 8.0)


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        bytes(MAX_FLYTHROUGH_PAYLOAD_BYTES + 1),
        _bytes_field(2, MISSION),
        _payload(_pose()) + _bytes_field(2, MISSION),
        _bytes_field(3, _pose()) + _bytes_field(2, MISSION),
        _bytes_field(1, _pose()) + bytes((2 << 3, 1)),
    ],
)
def test_decode_flythrough_rejects_invalid_envelopes(payload: bytes) -> None:
    with pytest.raises(DecodeError):
        decode_flythrough(payload, expected_mission_token=MISSION_TOKEN)


def test_decode_flythrough_enforces_pose_limit() -> None:
    payload = _payload(*([_pose()] * (MAX_FLYTHROUGH_POSES + 1)))

    with pytest.raises(DecodeError, match="envelope"):
        decode_flythrough(payload, expected_mission_token=MISSION_TOKEN)


@pytest.mark.parametrize(
    ("mission", "token"),
    [
        (_bytes_field(2, b"invalid"), MISSION_TOKEN),
        (MISSION, hashlib.sha256(b"different").hexdigest()),
    ],
)
def test_decode_flythrough_rejects_invalid_mission(mission: bytes, token: str) -> None:
    with pytest.raises(DecodeError):
        decode_flythrough(
            _payload(_pose(), mission=mission),
            expected_mission_token=token,
        )


@pytest.mark.parametrize(
    "pose",
    [
        _bytes_field(1, _vector(1.0, 2.0, 3.0)),
        _pose() + _bytes_field(3, b"invalid"),
        _bytes_field(2, _vector(4.0, 5.0)) + _bytes_field(1, _vector(1.0, 2.0, 3.0)),
    ],
)
def test_decode_flythrough_rejects_invalid_poses(pose: bytes) -> None:
    with pytest.raises(DecodeError, match="pose"):
        decode_flythrough(
            _payload(pose),
            expected_mission_token=MISSION_TOKEN,
        )


@pytest.mark.parametrize(
    "vector",
    [
        _fixed32_field(1, 1.0),
        _vector(1.0, 2.0) + _fixed32_field(4, 3.0),
        _vector(math.nan, 2.0, 3.0),
        _vector(10_001.0, 2.0, 3.0),
    ],
)
def test_decode_flythrough_rejects_invalid_vectors(vector: bytes) -> None:
    with pytest.raises(DecodeError, match="vector"):
        decode_flythrough(
            _payload(_pose(location=vector)),
            expected_mission_token=MISSION_TOKEN,
        )
