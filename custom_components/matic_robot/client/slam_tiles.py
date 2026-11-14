"""Decode bounded robot collection pages into typed SLAM layers."""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass

import numpy as np
from google.protobuf.message import DecodeError

from .models import HermesCollectionEntry
from .wire import decode_fields, first_bytes, first_varint

TILE_SIDE = 32
TILE_HEIGHT = 24
SURFACE_BYTES = TILE_SIDE * TILE_SIDE * TILE_HEIGHT // 8
FLOOR_RGBA_BYTES = TILE_SIDE * TILE_SIDE * 4 * 2
SEMANTIC_BYTES = TILE_SIDE * TILE_SIDE
VOXEL_SCALE_METERS = 0.015
MAX_SLAM_TILES = 4096
MAX_TILE_ENTRY_BYTES = 128 * 1024
_MAX_TILE_PAGE_COORDINATE = 4096
_MAX_MISSION_ID_BYTES = 64
_MAX_SEMANTIC_PAYLOAD_BYTES = 2048


@dataclass(frozen=True, slots=True)
class SlamTile:
    """One decoded 32 by 32 photorealistic map page."""

    page_x: int
    page_y: int
    mission_token: str
    floor_rgba: bytes
    surface_bits: bytes
    rgb_data: bytes
    mission_id: int | None = None


@dataclass(frozen=True, slots=True)
class SlamStructureTile:
    """One decoded structural page from the robot's integrated map."""

    page_x: int
    page_y: int
    mission_token: str
    occupancy: bytes
    semantics: bytes
    mission_id: int | None = None


@dataclass(frozen=True, slots=True)
class SlamSemanticTile:
    """One mission-correlated 32 by 32 native semantic page."""

    page_x: int
    page_y: int
    mission_token: str
    cells: bytes


def mission_token(mission_id: int) -> str:
    """Return the token a map page keyed by this mission carries."""
    key = bytes((2 << 3 | 5,)) + struct.pack("<I", mission_id)
    return hashlib.sha256(key).hexdigest()


def decode_slam_tile(entry: HermesCollectionEntry) -> SlamTile:
    """Decode one verified ``map_compressed_rgb`` collection entry.

    The layout and dimensions match the local app decoder. Strict sizes keep
    malformed private protobuf data bounded and prevent accidental decoding of
    unrelated collections.
    """
    if not entry.key or not entry.value:
        raise DecodeError("photorealistic SLAM tile is empty")
    if len(entry.key) + len(entry.value) > MAX_TILE_ENTRY_BYTES:
        raise DecodeError("photorealistic SLAM tile exceeds its byte limit")

    page = first_bytes(entry.key, 1)
    # Current firmware's Page message uses zig-zag signed fields 3 and 4.
    # Treating these as unsigned separates adjacent negative and positive pages
    # into alternating bands, making a complete map look like scattered tiles.
    page_x = _optional_sint32(page, 3)
    page_y = _optional_sint32(page, 4)
    if max(abs(page_x), abs(page_y)) > _MAX_TILE_PAGE_COORDINATE:
        raise DecodeError("photorealistic SLAM page is outside safe bounds")

    surface_envelope = first_bytes(entry.value, 4)
    dimensions = first_bytes(surface_envelope, 2)
    if tuple(_optional_varint(dimensions, number) for number in range(1, 5)) != (
        1,
        TILE_SIDE,
        TILE_SIDE,
        TILE_HEIGHT,
    ):
        raise DecodeError("unsupported SLAM voxel dimensions")
    surface_bits = first_bytes(first_bytes(surface_envelope, 3), 1)
    if len(surface_bits) != SURFACE_BYTES:
        raise DecodeError("invalid SLAM surface bit length")

    rgb_data = first_bytes(first_bytes(entry.value, 6), 1)
    surface_count = int.from_bytes(surface_bits).bit_count()
    if len(rgb_data) not in (0, surface_count * 3):
        raise DecodeError("invalid SLAM RGB sample length")

    floor_envelope = first_bytes(first_bytes(first_bytes(entry.value, 7), 1), 1)
    floor_dimensions = first_bytes(floor_envelope, 4)
    if tuple(_optional_varint(floor_dimensions, number) for number in range(1, 5)) != (
        1,
        4,
        TILE_SIDE,
        TILE_SIDE,
    ):
        raise DecodeError("unsupported SLAM floor texture dimensions")
    floor_data = first_bytes(first_bytes(floor_envelope, 5), 1)
    if len(floor_data) != FLOOR_RGBA_BYTES:
        raise DecodeError("invalid SLAM floor texture length")

    mission = first_bytes(entry.value, 5)
    mission_token = hashlib.sha256(mission).hexdigest()
    mission_id = decode_slam_mission_id(mission)
    floor_rgba = _decode_floor_rgba(floor_data)
    return SlamTile(
        page_x,
        page_y,
        mission_token,
        floor_rgba,
        surface_bits,
        rgb_data,
        mission_id,
    )


def decode_slam_structure_tile(entry: HermesCollectionEntry) -> SlamStructureTile:
    """Decode one verified ``map_integrated`` structural page."""
    if not entry.key or not entry.value:
        raise DecodeError("integrated SLAM tile is empty")
    if len(entry.key) + len(entry.value) > MAX_TILE_ENTRY_BYTES:
        raise DecodeError("integrated SLAM tile exceeds its byte limit")
    page = first_bytes(entry.key, 1)
    page_x = _optional_sint32(page, 3)
    page_y = _optional_sint32(page, 4)
    if max(abs(page_x), abs(page_y)) > _MAX_TILE_PAGE_COORDINATE:
        raise DecodeError("integrated SLAM page is outside safe bounds")

    surface_envelope = first_bytes(entry.value, 5)
    dimensions = first_bytes(surface_envelope, 2)
    if tuple(_optional_varint(dimensions, number) for number in range(1, 5)) != (
        1,
        TILE_SIDE,
        TILE_SIDE,
        TILE_HEIGHT,
    ):
        raise DecodeError("unsupported integrated SLAM dimensions")
    surface_bits = first_bytes(first_bytes(surface_envelope, 3), 1)
    if len(surface_bits) != SURFACE_BYTES:
        raise DecodeError("invalid integrated SLAM surface bit length")

    occupancy = _decode_nibbles(first_bytes(first_bytes(entry.value, 7), 1))
    semantics = _decode_nibbles(first_bytes(first_bytes(entry.value, 8), 1))
    mission = first_bytes(entry.value, 6)
    return SlamStructureTile(
        page_x,
        page_y,
        hashlib.sha256(mission).hexdigest(),
        occupancy,
        semantics,
        decode_slam_mission_id(mission),
    )


def decode_slam_mission_id(mission: bytes) -> int | None:
    """Return the verified fixed-width mission identifier when available.

    Older retained synthetic/private-map data treated the mission envelope as
    deliberately opaque.  Keep those scenes renderable, but return ``None``
    unless the value has the exact mission shape independently verified by the
    trajectory and semantic-map decoders.  Callers can therefore fail closed
    whenever floor identity matters without guessing at unknown payloads.
    """
    if len(mission) > _MAX_MISSION_ID_BYTES:
        return None
    try:
        fields = decode_fields(mission, max_fields=1)
    except DecodeError:
        return None
    if (
        len(fields) != 1
        or fields[0].number != 2
        or fields[0].wire_type != 5
        or not isinstance(fields[0].value, bytes)
    ):
        return None
    return int(struct.unpack("<I", fields[0].value)[0])


def decode_slam_semantic_tile(entry: HermesCollectionEntry) -> SlamSemanticTile:
    """Decode one bounded native semantic or semantic-override map page."""
    if (
        not entry.key
        or not entry.value
        or len(entry.key) > 64
        or len(entry.value) > _MAX_SEMANTIC_PAYLOAD_BYTES
    ):
        raise DecodeError("semantic SLAM tile is empty or oversized")

    key_fields = decode_fields(entry.key)
    if tuple((field.number, field.wire_type) for field in key_fields) != (
        (1, 2),
        (2, 2),
    ):
        raise DecodeError("semantic SLAM key has an invalid shape")
    page = first_bytes(entry.key, 1)
    mission = first_bytes(entry.key, 2)
    page_fields = decode_fields(page)
    if any(
        field.number not in (3, 4)
        or field.wire_type != 0
        or not isinstance(field.value, int)
        for field in page_fields
    ) or len({field.number for field in page_fields}) != len(page_fields):
        raise DecodeError("semantic SLAM page has an invalid shape")
    mission_fields = decode_fields(mission)
    if (
        len(mission_fields) != 1
        or mission_fields[0].number != 2
        or mission_fields[0].wire_type != 5
        or not isinstance(mission_fields[0].value, bytes)
    ):
        raise DecodeError("semantic SLAM mission has an invalid shape")
    page_x = _optional_sint32(page, 3)
    page_y = _optional_sint32(page, 4)
    if max(abs(page_x), abs(page_y)) > _MAX_TILE_PAGE_COORDINATE:
        raise DecodeError("semantic SLAM page is outside safe bounds")

    fields = decode_fields(entry.value)
    if tuple((field.number, field.wire_type) for field in fields) != (
        (1, 2),
        (4, 2),
        (8, 2),
    ):
        raise DecodeError("semantic SLAM envelope has an invalid shape")
    metadata = decode_fields(first_bytes(entry.value, 4))
    if tuple(field.number for field in metadata) != tuple(
        sorted({field.number for field in metadata})
    ) or any(
        field.number not in (4, 5, 6)
        or field.wire_type != 0
        or not isinstance(field.value, int)
        or field.value > _MAX_TILE_PAGE_COORDINATE
        for field in metadata
    ):
        raise DecodeError("semantic SLAM metadata has an invalid shape")
    if first_bytes(entry.value, 8) != mission:
        raise DecodeError("semantic SLAM mission does not match its page key")

    layer = first_bytes(entry.value, 1)
    layer_fields = decode_fields(layer)
    if tuple((field.number, field.wire_type) for field in layer_fields) != (
        (4, 2),
        (5, 2),
    ):
        raise DecodeError("semantic SLAM layer has an invalid shape")
    dimensions = first_bytes(layer, 4)
    if (
        tuple(_optional_varint(dimensions, number) for number in range(1, 5))
        != (
            1,
            1,
            TILE_SIDE,
            TILE_SIDE,
        )
        or len(decode_fields(dimensions)) != 4
    ):
        raise DecodeError("unsupported semantic SLAM dimensions")
    cells_wrapper = first_bytes(layer, 5)
    cell_fields = decode_fields(cells_wrapper)
    if tuple((field.number, field.wire_type) for field in cell_fields) != ((1, 2),):
        raise DecodeError("semantic SLAM cells have an invalid shape")
    cells = first_bytes(cells_wrapper, 1)
    if len(cells) != SEMANTIC_BYTES:
        raise DecodeError("invalid semantic SLAM cell length")
    return SlamSemanticTile(
        page_x=page_x,
        page_y=page_y,
        mission_token=hashlib.sha256(mission).hexdigest(),
        cells=cells,
    )


def _decode_floor_rgba(payload: bytes) -> bytes:
    # The tensor is channel-major and its two spatial axes are stored in the
    # opposite order from PIL's row/column convention. A flat reversal happens
    # to put each page near the right place, but rotates the texture within the
    # page and leaves a visible 32 px checkerboard. Transposing the spatial axes
    # is the only dihedral orientation whose live neighboring edges are
    # continuous in both directions.
    channels = np.frombuffer(payload, dtype="<f2").reshape(4, TILE_SIDE, TILE_SIDE)
    pixels = channels.transpose(2, 1, 0)
    return bytes(np.clip(np.rint(pixels), 0, 255).astype(np.uint8).tobytes())


def _decode_nibbles(payload: bytes) -> bytes:
    if len(payload) != TILE_SIDE * TILE_SIDE // 2:
        raise DecodeError("invalid integrated SLAM plane length")
    # Values are packed low nibble first. As with the photographic tensor, the
    # first spatial axis is map x and the second is map y, so transpose into
    # PIL's row-major y/x convention before compositing adjacent pages.
    packed = np.frombuffer(payload, dtype=np.uint8)
    values = np.empty(TILE_SIDE * TILE_SIDE, dtype=np.uint8)
    values[0::2] = packed & 0x0F
    values[1::2] = packed >> 4
    return bytes(values.reshape(TILE_SIDE, TILE_SIDE).T.tobytes())


def _optional_varint(payload: bytes, number: int) -> int:
    try:
        return first_varint(payload, number)
    except DecodeError:
        return 0


def _optional_sint32(payload: bytes, number: int) -> int:
    value = _optional_varint(payload, number) & 0xFFFFFFFF
    return (value >> 1) ^ -(value & 1)
