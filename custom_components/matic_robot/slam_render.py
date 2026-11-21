"""Render bounded local PNGs from decoded SLAM tiles."""

from __future__ import annotations

import math
from contextlib import closing
from dataclasses import dataclass
from io import BytesIO

import numpy as np
from google.protobuf.message import DecodeError
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .client import (
    MAX_SLAM_TILES,
    TILE_HEIGHT,
    TILE_SIDE,
    VOXEL_SCALE_METERS,
    FloorPlan,
    SlamStructureTile,
    SlamTile,
)
from .scene_encoding import (
    MAX_SCENE_RASTER_CELLS,
    MAX_SCENE_SPAN,
)

MAX_RENDER_PIXELS = 16 * 1024 * 1024
_MARGIN_X = 6
_VERTICAL_HEADROOM = round((TILE_HEIGHT - 7) * 2.5) + 8
_ROOM_COLORS = (
    (91, 143, 249, 74),
    (97, 221, 170, 74),
    (120, 211, 248, 74),
    (114, 98, 253, 74),
    (246, 144, 61, 74),
    (240, 139, 180, 74),
)

type _Label = tuple[str, float, float]


@dataclass(frozen=True, slots=True)
class _Grid:
    """The cell rectangle that holds every page and room corner."""

    min_x: int
    min_y: int
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class _Projection:
    """The isometric view of a grid, scaled to fit the intermediate image."""

    grid: _Grid
    scale: float
    width: int
    height: int

    def cell[T: (float, np.ndarray)](self, x: T, y: T, z: T | float = 0) -> tuple[T, T]:
        """Return where a cell at height `z` lands in the projected image."""
        local_x = x - self.grid.min_x
        local_y = y - self.grid.min_y
        return (
            (_MARGIN_X + 2 * (local_x - local_y) + 2 * (self.grid.height - 1))
            * self.scale,
            (_VERTICAL_HEADROOM + local_x + local_y - z * 2.5) * self.scale,
        )


@dataclass(frozen=True, slots=True)
class _Placement:
    """Where the cropped scene sits in the output image."""

    left: int
    top: int
    scale: float
    offset_x: int
    offset_y: int

    def point(self, x: float, y: float) -> tuple[float, float]:
        """Return the output position of a point in the uncropped scene."""
        return (
            self.offset_x + (x - self.left) * self.scale,
            self.offset_y + (y - self.top) * self.scale,
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
    if len(tiles) > MAX_SLAM_TILES or len(structure_tiles) > MAX_SLAM_TILES:
        raise DecodeError("too many photorealistic SLAM tiles")
    grid = _grid(tiles, structure_tiles, floor_plan)
    projection = _projection(grid, width, height)
    # Release each raster after its last use. At the pixel ceiling a single
    # RGBA image is 64 MiB; retained draw contexts also keep its core alive.
    with closing(_top_down(grid, tiles, structure_tiles, floor_plan)) as top_down:
        scene = _project_floor(top_down, projection)
    with closing(scene):
        scene = _paint_voxels(scene, tiles, projection)
    labels = _outline_rooms(scene, floor_plan, projection)
    robot_marker: tuple[float, float] | None = None
    if robot_position is not None:
        robot_marker = projection.cell(
            robot_position[0] / VOXEL_SCALE_METERS,
            robot_position[1] / VOXEL_SCALE_METERS,
            2,
        )

    # Matic's app presents the isometric scene from the opposite side of the
    # house from the raw x-y projection above. Mirror the finished geometry,
    # then mirror only the pending overlay coordinates so labels themselves
    # remain readable and the robot marker stays exact.
    with closing(scene):
        scene = ImageOps.mirror(scene)
    mirror_x = scene.width - 1
    labels = [(name, mirror_x - x, y) for name, x, y in labels]
    if robot_marker is not None:
        robot_marker = (mirror_x - robot_marker[0], robot_marker[1])

    cropped, placement = _fit(scene, width, height)
    image = Image.new("RGB", (width, height), "#0b1118")
    image.paste(cropped, (placement.offset_x, placement.offset_y), cropped)
    cropped.close()
    _draw_overlays(image, labels, robot_marker, placement)
    output = BytesIO()
    # Pillow's exhaustive PNG optimizer can monopolize Home Assistant's Python
    # process for seconds on a detailed map. Moderate compression keeps camera
    # refreshes responsive while preserving the exact image.
    image.save(output, "PNG", compress_level=4)
    image.close()
    return output.getvalue()


def _grid(
    tiles: tuple[SlamTile, ...],
    structure_tiles: tuple[SlamStructureTile, ...],
    floor_plan: FloorPlan | None,
) -> _Grid:
    """Bound the cells of every page and room corner, or refuse the raster."""
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
    min_x = min(point[0] for point in cell_points)
    min_y = min(point[1] for point in cell_points)
    width = max(point[0] for point in cell_points) + TILE_SIDE - min_x
    height = max(point[1] for point in cell_points) + TILE_SIDE - min_y
    if (
        width > MAX_SCENE_SPAN
        or height > MAX_SCENE_SPAN
        or width * height > MAX_SCENE_RASTER_CELLS
    ):
        raise DecodeError("photorealistic SLAM map raster is too large")
    return _Grid(min_x, min_y, width, height)


def _projection(grid: _Grid, width: int, height: int) -> _Projection:
    """Fit the entire floor into a bounded intermediate image.

    Rejecting a large projection here defeats the larger tile store; clipping
    pages would recreate holes. Apply one scale to every geometry layer
    instead. Two intermediate pixels per final output pixel on each axis
    retain antialiasing without allocating a native-resolution image for a
    camera thumbnail. Keep the independent hard ceiling for larger requested
    sizes.
    """
    projected_width = 2 * (grid.width + grid.height - 2) + _MARGIN_X * 2 + 1
    projected_height = grid.width + grid.height - 1 + _VERTICAL_HEADROOM + 8
    budget = min(MAX_RENDER_PIXELS, max(1, width * height * 4))
    scale = min(1.0, math.sqrt(budget / (projected_width * projected_height)))
    return _Projection(
        grid,
        scale,
        max(1, math.floor(projected_width * scale)),
        max(1, math.floor(projected_height * scale)),
    )


def _top_down(
    grid: _Grid,
    tiles: tuple[SlamTile, ...],
    structure_tiles: tuple[SlamStructureTile, ...],
    floor_plan: FloorPlan | None,
) -> Image.Image:
    """Stack room fills, structure and floor photos, one pixel per cell."""
    top_down = Image.new("RGBA", (grid.width, grid.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(top_down, "RGBA")
    if floor_plan is not None:
        for index, room in enumerate(floor_plan.rooms):
            polygon = [
                (
                    x / VOXEL_SCALE_METERS - grid.min_x,
                    y / VOXEL_SCALE_METERS - grid.min_y,
                )
                for x, y in room.boundary
            ]
            draw.polygon(polygon, fill=_ROOM_COLORS[index % len(_ROOM_COLORS)])
    for structure_tile in structure_tiles:
        _composite_page(
            top_down, grid, structure_tile, _structure_pixels(structure_tile)
        )
    for photo_tile in tiles:
        _composite_page(top_down, grid, photo_tile, photo_tile.floor_rgba)
    return top_down


def _composite_page(
    top_down: Image.Image,
    grid: _Grid,
    tile: SlamTile | SlamStructureTile,
    pixels: bytes,
) -> None:
    """Blend one page's RGBA cells over the raster at the page's place."""
    top_down.alpha_composite(
        Image.frombytes("RGBA", (TILE_SIDE, TILE_SIDE), pixels),
        dest=(
            tile.page_x * TILE_SIDE - grid.min_x,
            tile.page_y * TILE_SIDE - grid.min_y,
        ),
    )


def _structure_pixels(tile: SlamStructureTile) -> bytes:
    """Shade a structural page's occupied and unknown cells; free cells stay clear."""
    pixels = bytearray(TILE_SIDE * TILE_SIDE * 4)
    for index, occupancy in enumerate(tile.occupancy):
        if occupancy == 1:
            continue
        shade = 46 if occupancy == 0 else 65
        pixels[index * 4 : index * 4 + 4] = bytes((shade, shade + 7, shade + 12, 105))
    return bytes(pixels)


def _project_floor(top_down: Image.Image, projection: _Projection) -> Image.Image:
    """Lay the top-down raster into the isometric scene."""
    scale = projection.scale
    grid_height = projection.grid.height
    return top_down.transform(
        (projection.width, projection.height),
        Image.Transform.AFFINE,
        (
            0.25 / scale,
            0.5 / scale,
            -0.25 * _MARGIN_X - 0.5 * _VERTICAL_HEADROOM - 0.5 * (grid_height - 1),
            -0.25 / scale,
            0.5 / scale,
            0.25 * _MARGIN_X - 0.5 * _VERTICAL_HEADROOM + 0.5 * (grid_height - 1),
        ),
        resample=Image.Resampling.BILINEAR,
    )


def _outline_rooms(
    scene: Image.Image, floor_plan: FloorPlan | None, projection: _Projection
) -> list[_Label]:
    """Outline each room on the scene and return its name at its centre."""
    draw = ImageDraw.Draw(scene, "RGBA")
    labels: list[_Label] = []
    if floor_plan is not None:
        for room in floor_plan.rooms:
            polygon = [
                projection.cell(x / VOXEL_SCALE_METERS, y / VOXEL_SCALE_METERS)
                for x, y in room.boundary
            ]
            draw.line((*polygon, polygon[0]), fill=(225, 237, 250, 155), width=2)
            center_x = sum(point[0] for point in polygon) / len(polygon)
            center_y = sum(point[1] for point in polygon) / len(polygon)
            labels.append((room.name, center_x, center_y))
    return labels


def _fit(scene: Image.Image, width: int, height: int) -> tuple[Image.Image, _Placement]:
    """Crop the scene to its content and scale it into the output, closing it."""
    bounds = scene.getbbox()
    if bounds is None:
        raise DecodeError("photorealistic SLAM map has no visible content")
    with closing(scene):
        cropped = scene.crop(bounds)
    scale = min((width - 32) / cropped.width, (height - 32) / cropped.height)
    target = (
        max(1, round(cropped.width * scale)),
        max(1, round(cropped.height * scale)),
    )
    if cropped.size != target:
        # Pillow resamples RGBA via premultiplied RGBa. Perform those same steps
        # explicitly so the old full-size core can be closed between phases.
        with closing(cropped):
            cropped = cropped.convert("RGBa")
        with closing(cropped):
            cropped = cropped.resize(target, Image.Resampling.LANCZOS)
        with closing(cropped):
            cropped = cropped.convert("RGBA")
    return cropped, _Placement(
        bounds[0],
        bounds[1],
        scale,
        (width - target[0]) // 2,
        (height - target[1]) // 2,
    )


def _draw_overlays(
    image: Image.Image,
    labels: list[_Label],
    robot_marker: tuple[float, float] | None,
    placement: _Placement,
) -> None:
    """Draw the room names and the robot marker at output resolution."""
    draw = ImageDraw.Draw(image, "RGBA")
    font = ImageFont.load_default(size=max(13, min(image.size) // 48))
    for name, center_x, center_y in labels:
        label_x, label_y = placement.point(center_x, center_y)
        box = draw.textbbox((0, 0), name, font=font)
        label_width = box[2] - box[0] + 14
        label_height = box[3] - box[1] + 8
        draw.rounded_rectangle(
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
        draw.text(
            (label_x, label_y), name, font=font, fill=(255, 255, 255, 255), anchor="mm"
        )
    if robot_marker is not None:
        robot_x, robot_y = placement.point(*robot_marker)
        radius = max(9, min(image.size) // 60)
        halo = radius * 1.7
        draw.ellipse(
            (robot_x - halo, robot_y - halo, robot_x + halo, robot_y + halo),
            fill=(255, 255, 255, 48),
        )
        draw.ellipse(
            (robot_x - radius, robot_y - radius, robot_x + radius, robot_y + radius),
            fill=(12, 17, 24, 255),
            outline=(255, 255, 255, 255),
            width=3,
        )


def _surface_voxels(
    batch: list[SlamTile],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None:
    """Return each visible voxel's tile, cell, level and colour, if any."""
    surface_bytes = b"".join(tile.surface_bits for tile in batch)
    surfaces = np.unpackbits(
        np.frombuffer(surface_bytes, dtype=np.uint8),
        bitorder="big",
    ).reshape(len(batch), TILE_SIDE, TILE_SIDE, TILE_HEIGHT)
    tile_indexes, outers, inners, levels = np.nonzero(surfaces)
    if not len(levels):
        return None
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
        return None
    return (
        tile_indexes[visible],
        outers[visible],
        inners[visible],
        levels[visible],
        colors[visible],
    )


def _paint_voxels(
    scene: Image.Image, tiles: tuple[SlamTile, ...], projection: _Projection
) -> Image.Image:
    """Rasterize the point cloud in bounded vector batches."""
    width, height = scene.size
    pixels = np.array(scene, dtype=np.uint8, copy=True)
    sorted_tiles = sorted(
        tiles, key=lambda item: (item.page_x + item.page_y, item.page_x)
    )
    for batch_start in range(0, len(sorted_tiles), 64):
        batch = sorted_tiles[batch_start : batch_start + 64]
        voxels = _surface_voxels(batch)
        if voxels is None:
            continue
        tile_indexes, outers, inners, levels, colors = voxels
        page_x = np.asarray([tile.page_x for tile in batch], dtype=np.int32)
        page_y = np.asarray([tile.page_y for tile in batch], dtype=np.int32)
        # The surface tensor uses the same first-axis-x, second-axis-y layout
        # as the floor tensor. Keeping its former reversed/swapped transform
        # made each 32-cell point-cloud page internally face a different way
        # from the stitched floor beneath it.
        scene_x, scene_y = projection.cell(
            page_x[tile_indexes] * TILE_SIDE + outers,
            page_y[tile_indexes] * TILE_SIDE + inners,
            levels - 7,
        )
        projected_x = scene_x.astype(np.int32)
        projected_y = np.rint(scene_y).astype(np.int32)
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
