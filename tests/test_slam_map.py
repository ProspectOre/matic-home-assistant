"""Tests for the bounded photorealistic SLAM tile decoder and renderer."""

from __future__ import annotations

import json
import struct
from io import BytesIO
from unittest.mock import patch

import numpy as np
import pytest
from google.protobuf.message import DecodeError
from PIL import Image, ImageOps

from custom_components.matic_robot.client.models import (
    FloorPlan,
    HermesCollectionEntry,
    Room,
)
from custom_components.matic_robot.client.slam_map import (
    FLOOR_RGBA_BYTES,
    SCENE_MAGIC,
    SCENE_POINT_STRIDE,
    SCENE_VERSION,
    SEMANTIC_BYTES,
    SURFACE_BYTES,
    SlamTile,
    decode_slam_semantic_tile,
    decode_slam_structure_tile,
    decode_slam_tile,
    encode_slam_scene,
    parse_slam_scene_header,
    render_slam_map,
)
from custom_components.matic_robot.client.wire import first_bytes


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


def _sint32(value: int) -> int:
    return (value << 1) ^ (value >> 31)


def synthetic_slam_entry(
    *,
    page_x: int = 2,
    page_y: int = -1,
    mission: bytes = b"synthetic-mission",
    malformed: str | None = None,
    surface_height: int = 7,
    surface_outer: int = 0,
    surface_inner: int = 0,
    with_rgb: bool = True,
) -> HermesCollectionEntry:
    """Build a byte-for-byte synthetic equivalent of the observed tile shape."""
    page = _varint_field(3, _sint32(page_x)) + _varint_field(4, _sint32(page_y))
    key = _bytes_field(1, page) + _bytes_field(2, mission)

    dimensions = b"".join(
        _varint_field(number, value)
        for number, value in enumerate((1, 32, 32, 24), start=1)
    )
    if malformed == "dimensions":
        dimensions = dimensions[:-1] + b"\x17"
    surface = bytearray(SURFACE_BYTES)
    surface_index = surface_outer * 32 * 24 + surface_inner * 24 + surface_height
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


def synthetic_structure_entry(
    *,
    page_x: int = 2,
    page_y: int = -1,
    mission: bytes = b"synthetic-mission",
    malformed: str | None = None,
) -> HermesCollectionEntry:
    """Build a synthetic equivalent of an observed integrated-map page."""
    page = _varint_field(3, _sint32(page_x)) + _varint_field(4, _sint32(page_y))
    key = _bytes_field(1, page) + _bytes_field(2, mission)
    dimensions = b"".join(
        _varint_field(number, value)
        for number, value in enumerate((1, 32, 32, 24), start=1)
    )
    if malformed == "dimensions":
        dimensions = dimensions[:-1] + b"\x17"
    surface = bytes(SURFACE_BYTES - (1 if malformed == "surface" else 0))
    surface_envelope = _bytes_field(2, dimensions) + _bytes_field(
        3, _bytes_field(1, surface)
    )
    occupancy = bytearray(b"\x11" * 512)
    occupancy[-1] = 0x30
    if malformed == "plane":
        occupancy.pop()
    return HermesCollectionEntry(
        key,
        _bytes_field(5, surface_envelope)
        + _bytes_field(6, mission)
        + _bytes_field(7, _bytes_field(1, bytes(occupancy)))
        + _bytes_field(8, _bytes_field(1, b"\x22" * 512))
        + _bytes_field(9, _bytes_field(1, bytes(512))),
    )


def synthetic_semantic_entry(
    *,
    page_x: int = 2,
    page_y: int = -1,
    mission_id: int = 0x1234ABCD,
    malformed: str | None = None,
) -> HermesCollectionEntry:
    """Build a synthetic equivalent of an observed native semantic page."""
    page = _varint_field(3, _sint32(page_x)) + _varint_field(4, _sint32(page_y))
    mission = bytes((2 << 3 | 5,)) + struct.pack("<I", mission_id)
    if malformed == "page_shape":
        page += _varint_field(5, 1)
    if malformed == "mission_shape":
        mission = _bytes_field(2, b"invalid")
    key = _bytes_field(1, page) + _bytes_field(2, mission)
    if malformed == "key_shape":
        key += _bytes_field(3, b"invalid")
    dimensions = b"".join(
        _varint_field(number, value)
        for number, value in enumerate((1, 1, 32, 32), start=1)
    )
    if malformed == "dimensions":
        dimensions += _varint_field(5, 1)
    cells = bytes(index % 7 for index in range(SEMANTIC_BYTES))
    if malformed == "cells":
        cells = cells[:-1]
    cells_wrapper = _bytes_field(1, cells)
    if malformed == "cells_shape":
        cells_wrapper = _bytes_field(2, cells)
    layer = _bytes_field(4, dimensions) + _bytes_field(5, cells_wrapper)
    if malformed == "layer_shape":
        layer += _bytes_field(6, b"invalid")
    value_mission = (
        bytes((2 << 3 | 5,)) + struct.pack("<I", mission_id + 1)
        if malformed == "mission"
        else mission
    )
    metadata = b""
    if malformed == "metadata_shape":
        metadata = _bytes_field(4, b"invalid")
    elif malformed == "metadata_bound":
        metadata = _varint_field(4, 4097)
    value = (
        _bytes_field(1, layer)
        + _bytes_field(4, metadata)
        + _bytes_field(8, value_mission)
    )
    if malformed == "envelope_shape":
        value = _bytes_field(1, layer) + _bytes_field(8, value_mission)
    return HermesCollectionEntry(key, value)


def test_decode_slam_tile_matches_verified_geometry_and_texture() -> None:
    tile = decode_slam_tile(synthetic_slam_entry())

    assert (tile.page_x, tile.page_y) == (2, -1)
    assert len(tile.mission_token) == 64
    assert tile.floor_rgba[:4] == bytes((12, 34, 56, 255))
    assert len(tile.floor_rgba) == 32 * 32 * 4
    assert len(tile.voxels) == 1
    assert (tile.voxels[0].x, tile.voxels[0].y, tile.voxels[0].z) == (64, -32, 0)


def test_decode_slam_tile_transposes_floor_texture_axes() -> None:
    entry = synthetic_slam_entry()
    value = bytearray(entry.value)
    floor_marker = value.find(struct.pack("<e", 12.0) * (32 * 32))
    assert floor_marker >= 0
    red = [float(row * 32 + column) for row in range(32) for column in range(32)]
    value[floor_marker : floor_marker + 2048] = struct.pack("<1024e", *red)

    tile = decode_slam_tile(HermesCollectionEntry(entry.key, bytes(value)))
    pixels = Image.frombytes("RGBA", (32, 32), tile.floor_rgba)

    # Tensor source [row=1, column=2] becomes image [x=1, y=2].
    assert pixels.getpixel((1, 2))[0] == 34
    assert pixels.getpixel((2, 1))[0] == 65


def test_decode_slam_tile_decodes_visible_rgb_voxel() -> None:
    entry = synthetic_slam_entry(
        page_x=0,
        page_y=0,
        surface_height=8,
        surface_outer=1,
        surface_inner=2,
    )
    tile = decode_slam_tile(entry)

    assert len(tile.voxels) == 1
    assert (tile.voxels[0].x, tile.voxels[0].y, tile.voxels[0].z) == (1, 2, 1)
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


def test_encode_slam_scene_packs_floor_surface_rooms_and_neutral_color() -> None:
    tile = decode_slam_tile(
        synthetic_slam_entry(
            page_x=-2,
            page_y=3,
            surface_height=8,
            surface_outer=1,
            surface_inner=2,
            with_rgb=False,
        )
    )
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                "room-1",
                "Synthetic room",
                "protocol-1",
                b"room",
                ((-0.96, 1.44), (-0.48, 1.44), (-0.48, 1.92), (-0.96, 1.92)),
            ),
            Room("empty", "Ignored", "empty", b"empty", ()),
        ),
    )

    scene = encode_slam_scene((tile,), floor_plan=floor_plan)
    header = struct.unpack_from("<8sHHIII", scene)
    magic, version, stride, metadata_size, floor_count, surface_count = header
    assert (magic, version, stride) == (
        SCENE_MAGIC,
        SCENE_VERSION,
        SCENE_POINT_STRIDE,
    )
    assert (floor_count, surface_count) == (1024, 1)
    metadata_start = struct.calcsize("<8sHHIII")
    metadata = json.loads(
        scene[metadata_start : metadata_start + metadata_size].decode()
    )
    assert metadata == {
        "meters_per_cell": 0.015,
        "origin_cells": [-64, 96],
        "span_cells": [32, 32],
        "sample_step": 1,
        "rooms": [
            {
                "name": "Synthetic room",
                "boundary": [[0.0, 0.0], [32.0, 0.0], [32.0, 32.0], [0.0, 32.0]],
                "boundary_closed": True,
                "center": [16.0, 16.0],
            }
        ],
    }
    points_start = metadata_start + metadata_size
    assert struct.unpack_from("<HHBBBB", scene, points_start) == (0, 0, 0, 12, 34, 56)
    surface_start = points_start + floor_count * SCENE_POINT_STRIDE
    assert struct.unpack_from("<HHBBBB", scene, surface_start) == (
        1,
        2,
        1,
        96,
        112,
        128,
    )
    assert len(scene) == surface_start + SCENE_POINT_STRIDE


def test_encode_slam_scene_deterministically_bounds_point_count() -> None:
    tile = decode_slam_tile(synthetic_slam_entry())

    scene = encode_slam_scene((tile,), max_points=2)

    _, _, _, metadata_size, floor_count, surface_count = struct.unpack_from(
        "<8sHHIII", scene
    )
    metadata_start = struct.calcsize("<8sHHIII")
    metadata = json.loads(
        scene[metadata_start : metadata_start + metadata_size].decode()
    )
    assert metadata["sample_step"] == 513
    assert floor_count + surface_count == 2


def test_encode_slam_scene_clips_room_geometry_to_photographed_floor() -> None:
    source = decode_slam_tile(synthetic_slam_entry(page_x=0, page_y=0))
    floor = np.zeros((32, 32, 4), dtype=np.uint8)
    floor[5:20, 7:25] = (40, 50, 60, 255)
    tile = SlamTile(
        source.page_x,
        source.page_y,
        source.mission_token,
        floor.tobytes(),
        source.surface_bits,
        source.rgb_data,
    )
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                "room-1",
                "Synthetic room",
                "protocol-1",
                b"room",
                ((0.0, 0.0), (0.48, 0.0), (0.48, 0.48), (0.0, 0.48)),
            ),
        ),
    )

    scene = encode_slam_scene((tile,), floor_plan=floor_plan)
    metadata_size = struct.unpack_from("<8sHHIII", scene)[3]
    metadata_start = struct.calcsize("<8sHHIII")
    metadata = json.loads(
        scene[metadata_start : metadata_start + metadata_size].decode()
    )

    assert metadata["rooms"] == [
        {
            "name": "Synthetic room",
            "boundary": [[7.0, 5.0], [25.0, 5.0], [25.0, 20.0], [7.0, 20.0]],
            "boundary_closed": True,
            "center": [16.0, 12.5],
        }
    ]


def test_encode_slam_scene_omits_rooms_without_photographed_floor() -> None:
    source = decode_slam_tile(synthetic_slam_entry(page_x=0, page_y=0))
    tile = SlamTile(
        source.page_x,
        source.page_y,
        source.mission_token,
        bytes(32 * 32 * 4),
        source.surface_bits,
        source.rgb_data,
    )
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                "inside",
                "Inside",
                "inside",
                b"inside",
                ((0.0, 0.0), (0.3, 0.0), (0.3, 0.3), (0.0, 0.3)),
            ),
            Room(
                "outside",
                "Outside",
                "outside",
                b"outside",
                ((10.0, 10.0), (11.0, 10.0), (11.0, 11.0), (10.0, 11.0)),
            ),
        ),
    )

    scene = encode_slam_scene((tile,), floor_plan=floor_plan)
    metadata_size = struct.unpack_from("<8sHHIII", scene)[3]
    metadata_start = struct.calcsize("<8sHHIII")
    metadata = json.loads(
        scene[metadata_start : metadata_start + metadata_size].decode()
    )

    assert metadata["rooms"] == []


def test_scene_header_parser_rejects_incomplete_and_inconsistent_payloads() -> None:
    scene = encode_slam_scene((decode_slam_tile(synthetic_slam_entry()),))
    header = parse_slam_scene_header(scene)
    assert header.metadata_bytes > 0
    assert header.point_count == header.floor_points + header.surface_points

    with pytest.raises(DecodeError, match="incomplete"):
        parse_slam_scene_header(scene[:8])
    with pytest.raises(DecodeError, match="invalid"):
        parse_slam_scene_header(scene[:-1])


def test_encode_slam_scene_rejects_empty_unbounded_or_invisible_data() -> None:
    tile = SlamTile(0, 0, "mission", bytes(4096), bytes(SURFACE_BYTES), b"")
    with pytest.raises(DecodeError, match="no photorealistic"):
        encode_slam_scene(())
    with pytest.raises(DecodeError, match="invalid photorealistic"):
        encode_slam_scene((tile,) * 1025)
    with pytest.raises(DecodeError, match="invalid photorealistic"):
        encode_slam_scene((tile,), max_points=0)
    with pytest.raises(DecodeError, match="no visible"):
        encode_slam_scene((tile,))
    far_tile = SlamTile(
        2048,
        0,
        tile.mission_token,
        tile.floor_rgba,
        tile.surface_bits,
        tile.rgb_data,
    )
    with pytest.raises(DecodeError, match="too wide"):
        encode_slam_scene((tile, far_tile))


def test_decode_integrated_slam_tile_matches_structure_and_orientation() -> None:
    tile = decode_slam_structure_tile(synthetic_structure_entry())

    assert (tile.page_x, tile.page_y) == (2, -1)
    assert len(tile.mission_token) == 64
    assert tile.occupancy[991] == 0
    assert tile.occupancy[1023] == 3
    assert tile.occupancy[:4] == bytes((1, 1, 1, 1))
    assert tile.semantics == bytes((2,)) * (32 * 32)


def test_decode_semantic_slam_tile_matches_page_and_mission() -> None:
    tile = decode_slam_semantic_tile(synthetic_semantic_entry())

    assert (tile.page_x, tile.page_y) == (2, -1)
    assert len(tile.mission_token) == 64
    assert len(tile.cells) == SEMANTIC_BYTES
    assert tile.cells[:7] == bytes(range(7))

    default_page = synthetic_semantic_entry(page_x=0, page_y=0)
    default_page = HermesCollectionEntry(
        _bytes_field(1, b"") + _bytes_field(2, first_bytes(default_page.key, 2)),
        default_page.value,
    )
    assert decode_slam_semantic_tile(default_page).page_x == 0

    metadata_page = synthetic_semantic_entry()
    metadata_page = HermesCollectionEntry(
        metadata_page.key,
        _bytes_field(1, first_bytes(metadata_page.value, 1))
        + _bytes_field(4, _varint_field(4, 63) + _varint_field(6, 1))
        + _bytes_field(8, first_bytes(metadata_page.value, 8)),
    )
    assert decode_slam_semantic_tile(metadata_page).page_y == -1


@pytest.mark.parametrize(
    "entry",
    [
        HermesCollectionEntry(b"", b"value"),
        HermesCollectionEntry(b"key", b""),
        synthetic_semantic_entry(malformed="mission"),
        synthetic_semantic_entry(malformed="cells"),
        synthetic_semantic_entry(page_x=4097),
        synthetic_semantic_entry(malformed="key_shape"),
        synthetic_semantic_entry(malformed="page_shape"),
        synthetic_semantic_entry(malformed="mission_shape"),
        synthetic_semantic_entry(malformed="envelope_shape"),
        synthetic_semantic_entry(malformed="layer_shape"),
        synthetic_semantic_entry(malformed="dimensions"),
        synthetic_semantic_entry(malformed="cells_shape"),
        synthetic_semantic_entry(malformed="metadata_shape"),
        synthetic_semantic_entry(malformed="metadata_bound"),
    ],
)
def test_decode_semantic_slam_tile_rejects_invalid_entries(
    entry: HermesCollectionEntry,
) -> None:
    with pytest.raises(DecodeError):
        decode_slam_semantic_tile(entry)


@pytest.mark.parametrize(
    "entry",
    [HermesCollectionEntry(b"", b"value"), HermesCollectionEntry(b"key", b"")],
)
def test_decode_integrated_slam_tile_rejects_empty_entries(
    entry: HermesCollectionEntry,
) -> None:
    with pytest.raises(DecodeError):
        decode_slam_structure_tile(entry)


@pytest.mark.parametrize("malformed", ["dimensions", "surface", "plane"])
def test_decode_integrated_slam_tile_rejects_malformed_shapes(malformed: str) -> None:
    with pytest.raises(DecodeError):
        decode_slam_structure_tile(synthetic_structure_entry(malformed=malformed))


def test_render_slam_map_produces_requested_local_png() -> None:
    tile = decode_slam_tile(synthetic_slam_entry())
    with patch(
        "custom_components.matic_robot.client.slam_map.ImageOps.mirror",
        wraps=ImageOps.mirror,
    ) as mirror:
        result = render_slam_map((tile,), width=320, height=240)

    mirror.assert_called_once()

    with Image.open(BytesIO(result)) as image:
        assert image.format == "PNG"
        assert image.size == (320, 240)
        assert image.getpixel((160, 120)) != (11, 17, 24)


def test_render_slam_map_combines_structure_rooms_labels_and_robot() -> None:
    tile = decode_slam_tile(synthetic_slam_entry(page_x=0, page_y=0))
    structure = decode_slam_structure_tile(
        synthetic_structure_entry(page_x=0, page_y=0)
    )
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                "room-1",
                "Kitchen",
                "protocol-1",
                b"room",
                ((0.0, 0.0), (0.3, 0.0), (0.3, 0.3), (0.0, 0.3)),
            ),
        ),
    )

    result = render_slam_map(
        (tile,),
        structure_tiles=(structure,),
        floor_plan=floor_plan,
        robot_position=(0.15, 0.15, "exact_pose"),
        width=320,
        height=240,
    )

    with Image.open(BytesIO(result)) as image:
        assert image.format == "PNG"
        assert image.size == (320, 240)


def test_render_slam_map_handles_empty_and_below_floor_voxel_batches() -> None:
    empty_surfaces = SlamTile(
        0,
        0,
        "mission",
        bytes((12, 34, 56, 255)) * (32 * 32),
        bytes(SURFACE_BYTES),
        b"",
    )
    below_floor = decode_slam_tile(
        synthetic_slam_entry(page_x=1, page_y=0, surface_height=6)
    )

    result = render_slam_map((empty_surfaces, below_floor), width=256, height=256)

    with Image.open(BytesIO(result)) as image:
        assert image.format == "PNG"


def test_render_slam_map_rejects_fully_transparent_content() -> None:
    tile = SlamTile(0, 0, "mission", bytes(4096), bytes(SURFACE_BYTES), b"")

    with pytest.raises(DecodeError, match="no visible content"):
        render_slam_map((tile,))


def test_render_slam_map_rejects_empty_or_unbounded_cache() -> None:
    with pytest.raises(DecodeError):
        render_slam_map(())

    tile = SlamTile(0, 0, "mission", bytes(4096), bytes(SURFACE_BYTES), b"")
    with pytest.raises(DecodeError):
        render_slam_map((tile,) * 1025)

    structure = decode_slam_structure_tile(synthetic_structure_entry())
    with pytest.raises(DecodeError):
        render_slam_map((tile,), structure_tiles=(structure,) * 1025)
