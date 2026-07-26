"""Decode and render Matic's local photorealistic SLAM voxel tiles."""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass
from io import BytesIO

import numpy as np
from google.protobuf.message import DecodeError
from PIL import Image, ImageDraw, ImageFont

from .models import FloorPlan, HermesCollectionEntry
from .wire import first_bytes, first_varint

TILE_SIDE = 32
TILE_HEIGHT = 24
SURFACE_BYTES = TILE_SIDE * TILE_SIDE * TILE_HEIGHT // 8
FLOOR_RGBA_BYTES = TILE_SIDE * TILE_SIDE * 4 * 2
# Each page covers 32 x 32 cells at the robot's verified 1.5 cm map resolution.
VOXEL_SCALE_METERS = 0.015
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
    surface_bits: bytes
    rgb_data: bytes

    @property
    def voxels(self) -> tuple[SlamVoxel, ...]:
        """Decode visible voxels on demand for diagnostics and focused tests."""
        return tuple(_iter_voxels(self))


@dataclass(frozen=True, slots=True)
class SlamStructureTile:
    """One decoded structural page from the robot's integrated map."""

    page_x: int
    page_y: int
    mission_token: str
    occupancy: bytes
    semantics: bytes


def decode_slam_tile(entry: HermesCollectionEntry) -> SlamTile:
    """Decode one verified ``map_compressed_rgb`` collection entry.

    The layout and dimensions match the local app decoder. Strict sizes keep
    malformed private protobuf data bounded and prevent accidental decoding of
    unrelated collections.
    """
    if not entry.key or not entry.value:
        raise DecodeError("photorealistic SLAM tile is empty")

    page = first_bytes(entry.key, 1)
    # Current firmware's Page message uses zig-zag signed fields 3 and 4.
    # Treating these as unsigned separates adjacent negative and positive pages
    # into alternating bands, making a complete map look like scattered tiles.
    page_x = _optional_sint32(page, 3)
    page_y = _optional_sint32(page, 4)

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
    return SlamTile(
        page_x,
        page_y,
        mission_token,
        floor_rgba,
        surface_bits,
        rgb_data,
    )


def decode_slam_structure_tile(entry: HermesCollectionEntry) -> SlamStructureTile:
    """Decode one verified ``map_integrated`` structural page."""
    if not entry.key or not entry.value:
        raise DecodeError("integrated SLAM tile is empty")
    page = first_bytes(entry.key, 1)
    page_x = _optional_sint32(page, 3)
    page_y = _optional_sint32(page, 4)

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
    )


def render_slam_map(
    tiles: tuple[SlamTile, ...],
    *,
    structure_tiles: tuple[SlamStructureTile, ...] = (),
    floor_plan: FloorPlan | None = None,
    robot_position: tuple[float, float, str] | None = None,
    width: int = 1024,
    height: int = 1024,
) -> bytes:
    """Render a complete local isometric map without retaining a huge point cloud."""
    if not tiles:
        raise DecodeError("no photorealistic SLAM tiles are cached")
    if len(tiles) > _MAX_TILES or len(structure_tiles) > _MAX_TILES:
        raise DecodeError("too many photorealistic SLAM tiles")
    page_coordinates = {(tile.page_x, tile.page_y) for tile in tiles}
    page_coordinates.update((tile.page_x, tile.page_y) for tile in structure_tiles)
    cell_points = [
        (page_x * TILE_SIDE, page_y * TILE_SIDE) for page_x, page_y in page_coordinates
    ]
    if floor_plan is not None:
        cell_points.extend(
            (round(x / VOXEL_SCALE_METERS), round(y / VOXEL_SCALE_METERS))
            for room in floor_plan.rooms
            for x, y in room.boundary
        )
    min_cell_x = min(point[0] for point in cell_points)
    min_cell_y = min(point[1] for point in cell_points)
    max_cell_x = max(point[0] for point in cell_points) + TILE_SIDE - 1
    max_cell_y = max(point[1] for point in cell_points) + TILE_SIDE - 1
    grid_width = max_cell_x - min_cell_x + 1
    grid_height = max_cell_y - min_cell_y + 1

    top_down = Image.new("RGBA", (grid_width, grid_height), (0, 0, 0, 0))
    top_draw = ImageDraw.Draw(top_down, "RGBA")
    room_colors = (
        (91, 143, 249, 74),
        (97, 221, 170, 74),
        (120, 211, 248, 74),
        (114, 98, 253, 74),
        (246, 144, 61, 74),
        (240, 139, 180, 74),
    )
    if floor_plan is not None:
        for index, room in enumerate(floor_plan.rooms):
            polygon = [
                (
                    x / VOXEL_SCALE_METERS - min_cell_x,
                    y / VOXEL_SCALE_METERS - min_cell_y,
                )
                for x, y in room.boundary
            ]
            top_draw.polygon(polygon, fill=room_colors[index % len(room_colors)])

    for structure_tile in structure_tiles:
        origin = (
            structure_tile.page_x * TILE_SIDE - min_cell_x,
            structure_tile.page_y * TILE_SIDE - min_cell_y,
        )
        pixels = bytearray(TILE_SIDE * TILE_SIDE * 4)
        for index, occupancy in enumerate(structure_tile.occupancy):
            if occupancy == 1:
                continue
            shade = 46 if occupancy == 0 else 65
            pixels[index * 4 : index * 4 + 4] = bytes(
                (shade, shade + 7, shade + 12, 105)
            )
        structural = Image.frombytes("RGBA", (TILE_SIDE, TILE_SIDE), bytes(pixels))
        top_down.alpha_composite(structural, dest=origin)

    for photo_tile in tiles:
        origin = (
            photo_tile.page_x * TILE_SIDE - min_cell_x,
            photo_tile.page_y * TILE_SIDE - min_cell_y,
        )
        top_down.alpha_composite(
            Image.frombytes("RGBA", (TILE_SIDE, TILE_SIDE), photo_tile.floor_rgba),
            dest=origin,
        )

    margin_x = 6
    vertical_headroom = round((TILE_HEIGHT - 7) * 2.5) + 8
    projected_width = 2 * (grid_width + grid_height - 2) + margin_x * 2 + 1
    projected_height = grid_width + grid_height - 1 + vertical_headroom + 8
    floor_projection = top_down.transform(
        (projected_width, projected_height),
        Image.Transform.AFFINE,
        (
            0.25,
            0.5,
            -0.25 * margin_x - 0.5 * vertical_headroom - 0.5 * (grid_height - 1),
            -0.25,
            0.5,
            0.25 * margin_x - 0.5 * vertical_headroom + 0.5 * (grid_height - 1),
        ),
        resample=Image.Resampling.BILINEAR,
    )
    scene = floor_projection

    def project_cell(x: float, y: float, z: float = 0) -> tuple[float, float]:
        local_x = x - min_cell_x
        local_y = y - min_cell_y
        return (
            margin_x + 2 * (local_x - local_y) + 2 * (grid_height - 1),
            vertical_headroom + local_x + local_y - z * 2.5,
        )

    scene = _paint_voxels(
        scene,
        tiles,
        min_cell_x=min_cell_x,
        min_cell_y=min_cell_y,
        grid_height=grid_height,
        margin_x=margin_x,
        vertical_headroom=vertical_headroom,
    )
    draw = ImageDraw.Draw(scene, "RGBA")

    labels: list[tuple[str, float, float]] = []
    if floor_plan is not None:
        for room in floor_plan.rooms:
            polygon = [
                project_cell(x / VOXEL_SCALE_METERS, y / VOXEL_SCALE_METERS)
                for x, y in room.boundary
            ]
            draw.line((*polygon, polygon[0]), fill=(225, 237, 250, 155), width=2)
            center_x = sum(point[0] for point in polygon) / len(polygon)
            center_y = sum(point[1] for point in polygon) / len(polygon)
            labels.append((room.name, center_x, center_y))

    robot_marker: tuple[float, float] | None = None
    if robot_position is not None:
        robot_marker = project_cell(
            robot_position[0] / VOXEL_SCALE_METERS,
            robot_position[1] / VOXEL_SCALE_METERS,
            2,
        )

    bounds = scene.getbbox()
    if bounds is None:
        raise DecodeError("photorealistic SLAM map has no visible content")
    cropped = scene.crop(bounds)
    scale = min((width - 32) / cropped.width, (height - 32) / cropped.height)
    target = (
        max(1, round(cropped.width * scale)),
        max(1, round(cropped.height * scale)),
    )
    cropped = cropped.resize(target, Image.Resampling.LANCZOS)
    image = Image.new("RGB", (width, height), "#0b1118")
    image.paste(
        cropped,
        ((width - target[0]) // 2, (height - target[1]) // 2),
        cropped,
    )
    output_draw = ImageDraw.Draw(image, "RGBA")
    offset_x = (width - target[0]) // 2
    offset_y = (height - target[1]) // 2

    def output_point(x: float, y: float) -> tuple[float, float]:
        return (
            offset_x + (x - bounds[0]) * scale,
            offset_y + (y - bounds[1]) * scale,
        )

    font_size = max(13, min(width, height) // 48)
    font = ImageFont.load_default(size=font_size)
    for name, center_x, center_y in labels:
        label_x, label_y = output_point(center_x, center_y)
        box = output_draw.textbbox((0, 0), name, font=font)
        label_width = box[2] - box[0] + 14
        label_height = box[3] - box[1] + 8
        output_draw.rounded_rectangle(
            (
                label_x - label_width / 2,
                label_y - label_height / 2,
                label_x + label_width / 2,
                label_y + label_height / 2,
            ),
            radius=6,
            fill=(11, 17, 24, 220),
            outline=(226, 236, 248, 135),
        )
        output_draw.text(
            (label_x, label_y),
            name,
            font=font,
            fill=(255, 255, 255, 255),
            anchor="mm",
        )
    if robot_marker is not None:
        robot_x, robot_y = output_point(*robot_marker)
        radius = max(9, min(width, height) // 60)
        output_draw.ellipse(
            (
                robot_x - radius * 1.7,
                robot_y - radius * 1.7,
                robot_x + radius * 1.7,
                robot_y + radius * 1.7,
            ),
            fill=(255, 255, 255, 48),
        )
        output_draw.ellipse(
            (
                robot_x - radius,
                robot_y - radius,
                robot_x + radius,
                robot_y + radius,
            ),
            fill=(12, 17, 24, 255),
            outline=(255, 255, 255, 255),
            width=3,
        )
    output = BytesIO()
    # Pillow's exhaustive PNG optimizer can monopolize Home Assistant's Python
    # process for seconds on a detailed map. Moderate compression keeps camera
    # refreshes responsive while preserving the exact image.
    image.save(output, "PNG", compress_level=4)
    return output.getvalue()


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


def _iter_voxels(tile: SlamTile) -> Iterator[SlamVoxel]:
    """Yield visible voxels directly from compact tile bytes."""
    ordinal = 0
    for outer in range(TILE_SIDE):
        for inner in range(TILE_SIDE):
            for height in range(TILE_HEIGHT):
                index = outer * TILE_SIDE * TILE_HEIGHT + inner * TILE_HEIGHT + height
                if not tile.surface_bits[index >> 3] & (1 << (7 ^ (index & 7))):
                    continue
                if tile.rgb_data:
                    red, green, blue = tile.rgb_data[ordinal * 3 : ordinal * 3 + 3]
                    color = (red, green, blue)
                else:
                    color = (96, 112, 128)
                ordinal += 1
                if height < 7:
                    continue
                yield SlamVoxel(
                    tile.page_x * TILE_SIDE + outer,
                    tile.page_y * TILE_SIDE + inner,
                    height - 7,
                    color,
                )


def _paint_voxels(
    scene: Image.Image,
    tiles: tuple[SlamTile, ...],
    *,
    min_cell_x: int,
    min_cell_y: int,
    grid_height: int,
    margin_x: int,
    vertical_headroom: int,
) -> Image.Image:
    """Rasterize the point cloud in bounded vector batches."""
    width, height = scene.size
    pixels = np.array(scene, dtype=np.uint8, copy=True)
    sorted_tiles = sorted(
        tiles, key=lambda item: (item.page_x + item.page_y, item.page_x)
    )
    for batch_start in range(0, len(sorted_tiles), 64):
        batch = sorted_tiles[batch_start : batch_start + 64]
        surface_bytes = b"".join(tile.surface_bits for tile in batch)
        surfaces = np.unpackbits(
            np.frombuffer(surface_bytes, dtype=np.uint8),
            bitorder="big",
        ).reshape(len(batch), TILE_SIDE, TILE_SIDE, TILE_HEIGHT)
        tile_indexes, outers, inners, levels = np.nonzero(surfaces)
        if not len(levels):
            continue
        surface_counts = np.count_nonzero(surfaces, axis=(1, 2, 3))
        color_data = b"".join(
            tile.rgb_data
            if tile.rgb_data
            else bytes((96, 112, 128)) * int(surface_counts[index])
            for index, tile in enumerate(batch)
        )
        colors = np.frombuffer(color_data, dtype=np.uint8).reshape(-1, 3)
        visible = levels >= 7
        if not np.any(visible):
            continue
        tile_indexes = tile_indexes[visible]
        outers = outers[visible]
        inners = inners[visible]
        levels = levels[visible]
        colors = colors[visible]
        page_x = np.asarray([tile.page_x for tile in batch], dtype=np.int32)
        page_y = np.asarray([tile.page_y for tile in batch], dtype=np.int32)
        # The surface tensor uses the same first-axis-x, second-axis-y layout
        # as the floor tensor. Keeping its former reversed/swapped transform
        # made each 32-cell point-cloud page internally face a different way
        # from the stitched floor beneath it.
        local_x = page_x[tile_indexes] * TILE_SIDE + outers - min_cell_x
        local_y = page_y[tile_indexes] * TILE_SIDE + inners - min_cell_y
        projected_x = (
            margin_x + 2 * (local_x - local_y) + 2 * (grid_height - 1)
        ).astype(np.int32)
        projected_y = np.rint(
            vertical_headroom + local_x + local_y - (levels - 7) * 2.5
        ).astype(np.int32)
        for offset_y in (-1, 0):
            for offset_x in (-1, 0, 1):
                target_x = projected_x + offset_x
                target_y = projected_y + offset_y
                valid = (
                    (target_x >= 0)
                    & (target_x < width)
                    & (target_y >= 0)
                    & (target_y < height)
                )
                pixels[target_y[valid], target_x[valid], :3] = colors[valid]
                pixels[target_y[valid], target_x[valid], 3] = 245
    return Image.fromarray(pixels, "RGBA")


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
