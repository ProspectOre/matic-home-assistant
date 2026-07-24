"""Decode and render Matic's local photorealistic SLAM voxel tiles."""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass
from io import BytesIO

from google.protobuf.message import DecodeError
from PIL import Image, ImageDraw

from .models import HermesCollectionEntry
from .wire import first_bytes, first_varint

TILE_SIDE = 32
TILE_HEIGHT = 24
SURFACE_BYTES = TILE_SIDE * TILE_SIDE * TILE_HEIGHT // 8
FLOOR_RGBA_BYTES = TILE_SIDE * TILE_SIDE * 4 * 2
VOXEL_SCALE_METERS = 0.0075
_MAX_TILES = 1024


@dataclass(frozen=True, slots=True)
class SlamVoxel:
    """One colored surface voxel in map-global integer coordinates."""

    x: int
    y: int
    z: int
    color: tuple[int, int, int]


@dataclass(frozen=True, slots=True)
class SlamTile:
    """One decoded 32 by 32 photorealistic map page."""

    page_x: int
    page_y: int
    mission_token: str
    floor_rgba: bytes
    voxels: tuple[SlamVoxel, ...]


def decode_slam_tile(entry: HermesCollectionEntry) -> SlamTile:
    """Decode one verified ``map_compressed_rgb`` collection entry.

    The layout and dimensions match the local app decoder. Strict sizes keep
    malformed private protobuf data bounded and prevent accidental decoding of
    unrelated collections.
    """
    if not entry.key or not entry.value:
        raise DecodeError("photorealistic SLAM tile is empty")

    page = first_bytes(entry.key, 1)
    page_x = _optional_int32(page, 1)
    page_y = _optional_int32(page, 2)

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
    surface_count = sum(byte.bit_count() for byte in surface_bits)
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
    floor_rgba = _decode_floor_rgba(floor_data)
    voxels = _decode_voxels(page_x, page_y, surface_bits, rgb_data)
    return SlamTile(page_x, page_y, mission_token, floor_rgba, voxels)


def render_slam_map(
    tiles: tuple[SlamTile, ...], *, width: int = 1024, height: int = 1024
) -> bytes:
    """Render cached photographic tiles as a local isometric PNG."""
    if not tiles:
        raise DecodeError("no photorealistic SLAM tiles are cached")
    if len(tiles) > _MAX_TILES:
        raise DecodeError("too many photorealistic SLAM tiles")

    floor_pixels: list[tuple[int, int, tuple[int, int, int, int]]] = []
    voxels: list[SlamVoxel] = []
    for tile in tiles:
        origin_x = tile.page_x * TILE_SIDE
        origin_y = tile.page_y * TILE_SIDE
        for pixel in range(TILE_SIDE * TILE_SIDE):
            offset = pixel * 4
            red, green, blue, alpha = tile.floor_rgba[offset : offset + 4]
            floor_pixels.append(
                (
                    origin_x + pixel % TILE_SIDE,
                    origin_y + pixel // TILE_SIDE,
                    (red, green, blue, alpha),
                )
            )
        voxels.extend(tile.voxels)

    points = [(x, y, 0) for x, y, _color in floor_pixels]
    points.extend((voxel.x, voxel.y, voxel.z) for voxel in voxels)
    projected = [_project(x, y, z) for x, y, z in points]
    min_x = min(point[0] for point in projected) - 3
    max_x = max(point[0] for point in projected) + 3
    min_y = min(point[1] for point in projected) - 5
    max_y = max(point[1] for point in projected) + 4
    canvas_width = max(1, max_x - min_x)
    canvas_height = max(1, max_y - min_y)
    scale = min((width - 32) / canvas_width, (height - 32) / canvas_height)
    scale = max(0.25, scale)
    offset_x = (width - canvas_width * scale) / 2 - min_x * scale
    offset_y = (height - canvas_height * scale) / 2 - min_y * scale

    image = Image.new("RGB", (width, height), "#0b1118")
    draw = ImageDraw.Draw(image, "RGBA")

    for x, y, color in sorted(floor_pixels, key=lambda item: item[0] + item[1]):
        px, py = _screen(_project(x, y, 0), scale, offset_x, offset_y)
        half_width = max(1.0, 2.1 * scale)
        half_height = max(0.7, 1.05 * scale)
        draw.polygon(
            (
                (px, py - half_height),
                (px + half_width, py),
                (px, py + half_height),
                (px - half_width, py),
            ),
            fill=color,
        )

    for voxel in sorted(voxels, key=lambda item: (item.x + item.y, item.z)):
        px, py = _screen(_project(voxel.x, voxel.y, voxel.z), scale, offset_x, offset_y)
        radius = max(0.8, 1.4 * scale)
        red, green, blue = voxel.color
        draw.ellipse(
            (px - radius, py - radius, px + radius, py + radius),
            fill=(red, green, blue, 245),
        )

    output = BytesIO()
    image.save(output, "PNG", optimize=True)
    return output.getvalue()


def _decode_floor_rgba(payload: bytes) -> bytes:
    output = bytearray(TILE_SIDE * TILE_SIDE * 4)
    pixel_count = TILE_SIDE * TILE_SIDE
    for destination in range(pixel_count):
        source = pixel_count - destination - 1
        for channel in range(4):
            value = struct.unpack_from("<e", payload, channel * 2048 + source * 2)[0]
            output[destination * 4 + channel] = min(255, max(0, round(value)))
    return bytes(output)


def _decode_voxels(
    page_x: int, page_y: int, surface_bits: bytes, rgb_data: bytes
) -> tuple[SlamVoxel, ...]:
    result: list[SlamVoxel] = []
    ordinal = 0
    for outer in range(TILE_SIDE):
        for inner in range(TILE_SIDE):
            for height in range(TILE_HEIGHT):
                index = outer * TILE_SIDE * TILE_HEIGHT + inner * TILE_HEIGHT + height
                if not surface_bits[index >> 3] & (1 << (7 ^ (index & 7))):
                    continue
                if rgb_data:
                    red, green, blue = rgb_data[ordinal * 3 : ordinal * 3 + 3]
                    color = (red, green, blue)
                else:
                    color = (96, 112, 128)
                ordinal += 1
                if height < 7:
                    continue
                result.append(
                    SlamVoxel(
                        page_x * TILE_SIDE + (TILE_SIDE - 1 - inner),
                        page_y * TILE_SIDE + (TILE_SIDE - 1 - outer),
                        height - 7,
                        color,
                    )
                )
    return tuple(result)


def _optional_varint(payload: bytes, number: int) -> int:
    try:
        return first_varint(payload, number)
    except DecodeError:
        return 0


def _optional_int32(payload: bytes, number: int) -> int:
    value = _optional_varint(payload, number) & 0xFFFFFFFF
    return value - (1 << 32) if value >= 1 << 31 else value


def _project(x: int, y: int, z: int) -> tuple[float, float]:
    return (x - y) * 2.0, (x + y) - z * 2.5


def _screen(
    point: tuple[float, float], scale: float, offset_x: float, offset_y: float
) -> tuple[float, float]:
    return point[0] * scale + offset_x, point[1] * scale + offset_y
