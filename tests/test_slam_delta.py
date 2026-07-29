"""Tests for bounded binary SLAM scene deltas."""

from __future__ import annotations

import struct
from random import Random
from unittest.mock import patch

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.slam_map import (
    decode_slam_tile,
    encode_slam_scene,
)
from custom_components.matic_robot.slam_delta import (
    DELTA_FULL_SCENE_RATIO,
    _bounded_decompress,
    decode_slam_scene_delta,
    encode_slam_scene_delta,
)
from tests.test_slam_map import synthetic_slam_entry


def _scene() -> bytes:
    return encode_slam_scene((decode_slam_tile(synthetic_slam_entry()),))


def test_scene_delta_round_trip_preserves_exact_scene() -> None:
    base = _scene()
    changed = bytearray(base)
    changed[-1] ^= 0x7F

    payload = encode_slam_scene_delta(
        base,
        bytes(changed),
        base_revision=17,
        revision=18,
    )

    assert payload is not None
    decoded = decode_slam_scene_delta(payload, base)
    assert decoded.base_revision == 17
    assert decoded.revision == 18
    assert decoded.scene == bytes(changed)
    assert len(payload) < len(changed) * DELTA_FULL_SCENE_RATIO


def test_scene_delta_handles_growth_and_truncation() -> None:
    small = _scene()
    large = encode_slam_scene(
        (
            decode_slam_tile(synthetic_slam_entry(page_x=0)),
            decode_slam_tile(synthetic_slam_entry(page_x=1)),
        )
    )

    grown = encode_slam_scene_delta(small, large, base_revision=1, revision=2)
    shrunk = encode_slam_scene_delta(large, small, base_revision=2, revision=3)

    assert grown is not None
    assert shrunk is not None
    assert decode_slam_scene_delta(grown, small).scene == large
    assert decode_slam_scene_delta(shrunk, large).scene == small


def test_scene_delta_prefers_full_scene_for_dense_changes() -> None:
    base = _scene()
    changed = bytearray(base)
    point_offset = 24 + struct.unpack_from("<I", changed, 12)[0]
    changed[point_offset:] = Random(17).randbytes(len(changed) - point_offset)

    assert (
        encode_slam_scene_delta(
            base,
            bytes(changed),
            base_revision=3,
            revision=4,
        )
        is None
    )


@pytest.mark.parametrize("revision", [-1, 2**64])
def test_scene_delta_rejects_invalid_revisions(revision: int) -> None:
    scene = _scene()
    with pytest.raises(DecodeError, match="revision"):
        encode_slam_scene_delta(scene, scene, base_revision=revision, revision=1)


def test_scene_delta_rejects_malformed_payloads() -> None:
    scene = _scene()
    with pytest.raises(DecodeError, match="header"):
        decode_slam_scene_delta(b"short", scene)

    payload = encode_slam_scene_delta(
        scene, scene[:-1] + b"\x00", base_revision=1, revision=2
    )
    assert payload is not None
    malformed = bytearray(payload)
    malformed[0] ^= 0xFF
    with pytest.raises(DecodeError, match="invalid"):
        decode_slam_scene_delta(bytes(malformed), scene)

    with pytest.raises(DecodeError, match="invalid"):
        decode_slam_scene_delta(payload[:-1], scene)

    invalid_expansion = bytearray(payload)
    struct.pack_into("<I", invalid_expansion, 28, len(scene) + 1)
    with pytest.raises(DecodeError, match="length"):
        decode_slam_scene_delta(bytes(invalid_expansion), scene)


def test_scene_delta_bounds_scene_and_compressed_data() -> None:
    scene = _scene()
    with (
        patch(
            "custom_components.matic_robot.slam_delta.MAX_SCENE_BYTES",
            len(scene) - 1,
        ),
        pytest.raises(DecodeError, match="scene exceeds"),
    ):
        encode_slam_scene_delta(scene, scene, base_revision=1, revision=2)

    with (
        patch("custom_components.matic_robot.slam_delta.MAX_DELTA_BYTES", 0),
        pytest.raises(DecodeError, match="compressed"),
    ):
        encode_slam_scene_delta(
            scene, scene[:-1] + b"\x00", base_revision=1, revision=2
        )


def test_scene_delta_rejects_incomplete_or_trailing_compressed_data() -> None:
    import zlib

    compressed = zlib.compress(b"bounded")
    with pytest.raises(DecodeError, match="bounds"):
        _bounded_decompress(compressed[:-1])
    with pytest.raises(DecodeError, match="bounds"):
        _bounded_decompress(compressed + b"trailing")
