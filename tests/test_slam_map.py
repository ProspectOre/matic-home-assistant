"""Tests for the bounded photorealistic SLAM tile decoder and renderer."""

from __future__ import annotations

import struct
from io import BytesIO

import pytest
from google.protobuf.message import DecodeError
from PIL import Image

from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.client.slam_map import (
    FLOOR_RGBA_BYTES,
    SURFACE_BYTES,
    SlamTile,
    decode_slam_tile,
    render_slam_map,
)


def _varint(value: int) -> bytes:
    result = bytearray()
    while value >= 0x80:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value)
    return bytes(result)


def _bytes_field(number: int, value: bytes) -> bytes:
    return _varint(number << 3 | 2) + _varint(len(value)) + value


def _varint_field(number: int, value: int) -> bytes:
    return _varint(number << 3) + _varint(value)


def synthetic_slam_entry(
    *,
    page_x: int = 2,
    page_y: int = -1,
    mission: bytes = b"synthetic-mission",
    malformed: str | None = None,
    surface_height: int = 7,
    with_rgb: bool = True,
) -> HermesCollectionEntry:
    """Build a byte-for-byte synthetic equivalent of the observed tile shape."""
    page = _varint_field(1, page_x & ((1 << 64) - 1)) + _varint_field(
        2, page_y & ((1 << 64) - 1)
    )
    key = _bytes_field(1, page) + _bytes_field(2, mission)

    dimensions = b"".join(
        _varint_field(number, value)
        for number, value in enumerate((1, 32, 32, 24), start=1)
    )
    if malformed == "dimensions":
        dimensions = dimensions[:-1] + b"\x17"
    surface = bytearray(SURFACE_BYTES)
    surface_index = surface_height
    surface[surface_index >> 3] |= 1 << (7 ^ (surface_index & 7))
    if malformed == "surface":
        surface.pop()
    surface_envelope = _bytes_field(2, dimensions) + _bytes_field(
        3, _bytes_field(1, bytes(surface))
    )

    rgb = b"\x64\x6e\x78" if with_rgb else b""
    if malformed == "rgb":
        rgb += b"\x00"

    channels = (12.0, 34.0, 56.0, 255.0)
    floor = b"".join(struct.pack("<e", channel) * (32 * 32) for channel in channels)
    assert len(floor) == FLOOR_RGBA_BYTES
    if malformed == "floor":
        floor = floor[:-2]
    floor_dimensions = b"".join(
        _varint_field(number, value)
        for number, value in enumerate((1, 4, 32, 32), start=1)
    )
    if malformed == "floor_dimensions":
        floor_dimensions = floor_dimensions[:-1] + b"\x1f"
    floor_envelope = _bytes_field(4, floor_dimensions) + _bytes_field(
        5, _bytes_field(1, floor)
    )
    value = b"".join(
        (
            _bytes_field(2, b"\x00\x00"),
            _bytes_field(4, surface_envelope),
            _bytes_field(5, mission),
            _bytes_field(6, _bytes_field(1, rgb)),
            _bytes_field(7, _bytes_field(1, _bytes_field(1, floor_envelope))),
        )
    )
    return HermesCollectionEntry(key, value)


def test_decode_slam_tile_matches_verified_geometry_and_texture() -> None:
    tile = decode_slam_tile(synthetic_slam_entry())

    assert (tile.page_x, tile.page_y) == (2, -1)
    assert len(tile.mission_token) == 64
    assert tile.floor_rgba[:4] == bytes((12, 34, 56, 255))
    assert len(tile.floor_rgba) == 32 * 32 * 4
    assert len(tile.voxels) == 1
    assert (tile.voxels[0].x, tile.voxels[0].y, tile.voxels[0].z) == (95, -1, 0)


def test_decode_slam_tile_decodes_visible_rgb_voxel() -> None:
    entry = synthetic_slam_entry(page_x=0, page_y=0)
    value = bytearray(entry.value)
    # Replace the surface bit at z=7 with z=8 without changing the envelope.
    surface_marker = value.find(bytes((0x01,)) + bytes(SURFACE_BYTES - 1))
    assert surface_marker >= 0
    value[surface_marker] = 0x00
    value[surface_marker + 1] = 0x80

    tile = decode_slam_tile(HermesCollectionEntry(entry.key, bytes(value)))

    assert len(tile.voxels) == 1
    assert (tile.voxels[0].x, tile.voxels[0].y, tile.voxels[0].z) == (31, 31, 1)
    assert tile.voxels[0].color == (100, 110, 120)


@pytest.mark.parametrize(
    "malformed", ["dimensions", "surface", "rgb", "floor_dimensions", "floor"]
)
def test_decode_slam_tile_rejects_malformed_private_shapes(malformed: str) -> None:
    with pytest.raises(DecodeError):
        decode_slam_tile(synthetic_slam_entry(malformed=malformed))


@pytest.mark.parametrize(
    "entry",
    [HermesCollectionEntry(b"", b"value"), HermesCollectionEntry(b"key", b"")],
)
def test_decode_slam_tile_rejects_empty_entries(entry: HermesCollectionEntry) -> None:
    with pytest.raises(DecodeError):
        decode_slam_tile(entry)


def test_decode_slam_tile_applies_defaults_for_omitted_fields() -> None:
    entry = synthetic_slam_entry(surface_height=6, with_rgb=False)
    key = _bytes_field(1, b"") + _bytes_field(2, b"synthetic-mission")

    tile = decode_slam_tile(HermesCollectionEntry(key, entry.value))

    assert (tile.page_x, tile.page_y) == (0, 0)
    assert tile.voxels == ()


def test_decode_slam_tile_uses_neutral_color_when_rgb_is_absent() -> None:
    tile = decode_slam_tile(synthetic_slam_entry(with_rgb=False))

    assert tile.voxels[0].color == (96, 112, 128)


def test_render_slam_map_produces_requested_local_png() -> None:
    tile = decode_slam_tile(synthetic_slam_entry())
    result = render_slam_map((tile,), width=320, height=240)

    with Image.open(BytesIO(result)) as image:
        assert image.format == "PNG"
        assert image.size == (320, 240)
        assert image.getpixel((160, 120)) != (11, 17, 24)


def test_render_slam_map_rejects_empty_or_unbounded_cache() -> None:
    with pytest.raises(DecodeError):
        render_slam_map(())

    tile = SlamTile(0, 0, "mission", bytes(4096), ())
    with pytest.raises(DecodeError):
        render_slam_map((tile,) * 1025)
