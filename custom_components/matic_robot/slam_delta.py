"""Bounded binary deltas for authenticated SLAM scene updates."""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass

import numpy as np
from google.protobuf.message import DecodeError

from .client.slam_map import parse_slam_scene_header

DELTA_MAGIC = b"MATICDLT"
DELTA_VERSION = 1
DELTA_FLAG_DEFLATE_XOR = 1
MAX_SCENE_BYTES = 16 * 1024 * 1024
MAX_DELTA_BYTES = 16 * 1024 * 1024
DELTA_FULL_SCENE_RATIO = 0.85
_DELTA_HEADER = struct.Struct("<8sHHQQII")


@dataclass(frozen=True, slots=True)
class SlamSceneDelta:
    """One decoded transition between two scene revisions."""

    base_revision: int
    revision: int
    scene: bytes


def encode_slam_scene_delta(
    base: bytes,
    scene: bytes,
    *,
    base_revision: int,
    revision: int,
) -> bytes | None:
    """Return a compressed XOR delta, or ``None`` when a full scene is smaller."""
    parse_slam_scene_header(base)
    parse_slam_scene_header(scene)
    _validate_revision(base_revision)
    _validate_revision(revision)
    if len(base) > MAX_SCENE_BYTES or len(scene) > MAX_SCENE_BYTES:
        raise DecodeError("SLAM scene exceeds delta bounds")

    encoded_length = max(len(base), len(scene))
    difference = np.zeros(encoded_length, dtype=np.uint8)
    base_bytes = np.frombuffer(base, dtype=np.uint8)
    scene_bytes = np.frombuffer(scene, dtype=np.uint8)
    shared_length = min(len(base), len(scene))
    np.bitwise_xor(
        base_bytes[:shared_length],
        scene_bytes[:shared_length],
        out=difference[:shared_length],
    )
    if len(scene) > shared_length:
        difference[shared_length : len(scene)] = scene_bytes[shared_length:]
    elif len(base) > shared_length:
        difference[shared_length : len(base)] = base_bytes[shared_length:]
    compressed = zlib.compress(difference, level=6)
    if len(compressed) > MAX_DELTA_BYTES:
        raise DecodeError("compressed SLAM delta exceeds bounds")
    if _DELTA_HEADER.size + len(compressed) >= len(scene) * DELTA_FULL_SCENE_RATIO:
        return None
    return (
        _DELTA_HEADER.pack(
            DELTA_MAGIC,
            DELTA_VERSION,
            DELTA_FLAG_DEFLATE_XOR,
            base_revision,
            revision,
            len(scene),
            len(compressed),
        )
        + compressed
    )


def decode_slam_scene_delta(payload: bytes, base: bytes) -> SlamSceneDelta:
    """Apply one validated delta to its required base scene."""
    if len(payload) < _DELTA_HEADER.size:
        raise DecodeError("SLAM delta header is incomplete")
    (
        magic,
        version,
        flags,
        base_revision,
        revision,
        scene_length,
        compressed_length,
    ) = _DELTA_HEADER.unpack_from(payload)
    if (
        magic != DELTA_MAGIC
        or version != DELTA_VERSION
        or flags != DELTA_FLAG_DEFLATE_XOR
        or scene_length > MAX_SCENE_BYTES
        or compressed_length > MAX_DELTA_BYTES
        or len(payload) != _DELTA_HEADER.size + compressed_length
    ):
        raise DecodeError("invalid SLAM delta payload")
    _validate_revision(base_revision)
    _validate_revision(revision)
    difference = _bounded_decompress(payload[_DELTA_HEADER.size :])
    encoded_length = max(len(base), scene_length)
    if len(difference) != encoded_length:
        raise DecodeError("SLAM delta length does not match its base")
    result = np.frombuffer(difference, dtype=np.uint8).copy()
    base_bytes = np.frombuffer(base, dtype=np.uint8)
    np.bitwise_xor(
        result[: len(base_bytes)],
        base_bytes,
        out=result[: len(base_bytes)],
    )
    scene = result[:scene_length].tobytes()
    parse_slam_scene_header(scene)
    return SlamSceneDelta(base_revision, revision, scene)


def _bounded_decompress(payload: bytes) -> bytes:
    decompressor = zlib.decompressobj()
    decoded = decompressor.decompress(payload, MAX_SCENE_BYTES + 1)
    if (
        len(decoded) > MAX_SCENE_BYTES
        or decompressor.unconsumed_tail
        or decompressor.unused_data
        or not decompressor.eof
    ):
        raise DecodeError("SLAM delta expands beyond its bounds")
    decoded += decompressor.flush()
    return decoded


def _validate_revision(value: int) -> None:
    if not 0 <= value < 2**64:
        raise DecodeError("invalid SLAM scene revision")
