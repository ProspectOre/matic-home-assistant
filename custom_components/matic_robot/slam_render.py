"""Render bounded local PNGs from decoded SLAM tiles."""

from __future__ import annotations

import math
from contextlib import closing
from io import BytesIO

import numpy as np
from google.protobuf.message import DecodeError
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .client.models import FloorPlan
from .client.slam_map import (
    MAX_SCENE_RASTER_CELLS,
    MAX_SCENE_SPAN,
    MAX_SLAM_TILES,
    TILE_HEIGHT,
    TILE_SIDE,
    VOXEL_SCALE_METERS,
    SlamStructureTile,
    SlamTile,
)

MAX_RENDER_PIXELS = 16 * 1024 * 1024


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
    if (
        grid_width > MAX_SCENE_SPAN
        or grid_height > MAX_SCENE_SPAN
        or grid_width * grid_height > MAX_SCENE_RASTER_CELLS
    ):
        raise DecodeError("photorealistic SLAM map raster is too large")

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
    # Fit the entire floor into a bounded intermediate image. Rejecting a
    # large projection here defeats the larger tile store; clipping pages
    # would recreate holes. Apply one scale to every geometry layer instead.
    # Two intermediate pixels per final output pixel on each axis retain
    # antialiasing without allocating a native-resolution image for a camera
    # thumbnail. Keep the independent hard ceiling for larger requested sizes.
    projection_budget = min(MAX_RENDER_PIXELS, max(1, width * height * 4))
    projection_scale = min(
        1.0, math.sqrt(projection_budget / (projected_width * projected_height))
    )
    projected_width = max(1, math.floor(projected_width * projection_scale))
    projected_height = max(1, math.floor(projected_height * projection_scale))
    del top_draw
    scene = top_down.transform(
        (projected_width, projected_height),
        Image.Transform.AFFINE,
        (
            0.25 / projection_scale,
            0.5 / projection_scale,
            -0.25 * margin_x - 0.5 * vertical_headroom - 0.5 * (grid_height - 1),
            -0.25 / projection_scale,
            0.5 / projection_scale,
            0.25 * margin_x - 0.5 * vertical_headroom + 0.5 * (grid_height - 1),
        ),
        resample=Image.Resampling.BILINEAR,
    )
    # Release each raster after its last use. At the pixel ceiling a single
    # RGBA image is 64 MiB; retained draw contexts also keep its core alive.
    top_down.close()

    def project_cell(x: float, y: float, z: float = 0) -> tuple[float, float]:
        local_x = x - min_cell_x
        local_y = y - min_cell_y
        return (
            (margin_x + 2 * (local_x - local_y) + 2 * (grid_height - 1))
            * projection_scale,
            (vertical_headroom + local_x + local_y - z * 2.5) * projection_scale,
        )

    with closing(scene):
        scene = _paint_voxels(
            scene,
            tiles,
            min_cell_x=min_cell_x,
            min_cell_y=min_cell_y,
            grid_height=grid_height,
            margin_x=margin_x,
            vertical_headroom=vertical_headroom,
            projection_scale=projection_scale,
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

    # Matic's app presents the isometric scene from the opposite side of the
    # house from the raw x-y projection above. Mirror the finished geometry,
    # then mirror only the pending overlay coordinates so labels themselves
    # remain readable and the robot marker stays exact.
    del draw
    with closing(scene):
        scene = ImageOps.mirror(scene)
    mirror_x = scene.width - 1
    labels = [(name, mirror_x - x, y) for name, x, y in labels]
    if robot_marker is not None:
        robot_marker = (mirror_x - robot_marker[0], robot_marker[1])

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
    image = Image.new("RGB", (width, height), "#0b1118")
    image.paste(
        cropped,
        ((width - target[0]) // 2, (height - target[1]) // 2),
        cropped,
    )
    cropped.close()
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
    del output_draw
    image.close()
    return output.getvalue()


def _paint_voxels(
    scene: Image.Image,
    tiles: tuple[SlamTile, ...],
    *,
    min_cell_x: int,
    min_cell_y: int,
    grid_height: int,
    margin_x: int,
    vertical_headroom: int,
    projection_scale: float = 1.0,
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
            (margin_x + 2 * (local_x - local_y) + 2 * (grid_height - 1))
            * projection_scale
        ).astype(np.int32)
        projected_y = np.rint(
            (vertical_headroom + local_x + local_y - (levels - 7) * 2.5)
            * projection_scale
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
