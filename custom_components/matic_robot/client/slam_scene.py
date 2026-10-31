"""Encode bounded local point-cloud scenes from decoded SLAM pages."""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass

import numpy as np
from google.protobuf.message import DecodeError
from PIL import Image, ImageDraw

from .models import FloorPlan
from .slam_geometry import mask_contours
from .slam_tiles import (
    MAX_SLAM_TILES,
    TILE_HEIGHT,
    TILE_SIDE,
    VOXEL_SCALE_METERS,
    SlamTile,
)

SCENE_MAGIC = b"MATIC3D\x00"
SCENE_VERSION = 1
SCENE_POINT_STRIDE = 8
MAX_SCENE_POINTS = 1_500_000
MAX_SCENE_SPAN = 65_536
MAX_SCENE_RASTER_CELLS = 4 * 1024 * 1024
MAX_SCENE_METADATA_BYTES = 1024 * 1024
_SCENE_HEADER = struct.Struct("<8sHHIII")


@dataclass(frozen=True, slots=True)
class SlamSceneHeader:
    """Validated bounds and offsets for a binary SLAM scene."""

    metadata_bytes: int
    floor_points: int
    surface_points: int

    @property
    def point_count(self) -> int:
        """Return the total number of encoded points."""
        return self.floor_points + self.surface_points


def _room_floor_geometry(
    boundary: list[list[float]],
    floor_occupancy: np.ndarray,
) -> tuple[list[list[float]], list[float]] | None:
    """Clip one planning region to photographed floor and return its outer edge."""
    height, width = floor_occupancy.shape
    left = max(0, math.floor(min(point[0] for point in boundary)))
    top = max(0, math.floor(min(point[1] for point in boundary)))
    right = min(width, math.ceil(max(point[0] for point in boundary)) + 1)
    bottom = min(height, math.ceil(max(point[1] for point in boundary)) + 1)
    if left >= right or top >= bottom:
        return None
    region_image = Image.new("L", (right - left, bottom - top), 0)
    ImageDraw.Draw(region_image).polygon(
        [(x - left, y - top) for x, y in boundary],
        fill=255,
    )
    region = (
        np.asarray(region_image, dtype=bool) & floor_occupancy[top:bottom, left:right]
    )
    if not np.any(region):
        return None
    contours = mask_contours(region)

    def area(contour: tuple[tuple[int, int], ...]) -> int:
        return abs(
            sum(
                x1 * y2 - x2 * y1
                for (x1, y1), (x2, y2) in zip(
                    contour,
                    contour[1:] + contour[:1],
                    strict=True,
                )
            )
        )

    contour = max(contours, key=area)
    rows, columns = np.nonzero(region)
    return (
        [[float(x + left), float(y + top)] for x, y in contour],
        [
            float(columns.mean() + left + 0.5),
            float(rows.mean() + top + 0.5),
        ],
    )


def encode_slam_scene(
    tiles: tuple[SlamTile, ...],
    *,
    floor_plan: FloorPlan | None = None,
    max_points: int = MAX_SCENE_POINTS,
) -> bytes:
    """Encode the private color point cloud for the local WebGL studio.

    Positions use two unsigned 16-bit map-local coordinates, one unsigned
    8-bit height, and RGB bytes. The compact fixed stride avoids transferring
    JSON for more than a million points and is decoded without copies by
    WebGL. Deterministic sampling keeps pathological maps bounded.
    """
    if not tiles:
        raise DecodeError("no photorealistic SLAM tiles are cached")
    if len(tiles) > MAX_SLAM_TILES or max_points < 1:
        raise DecodeError("invalid photorealistic SLAM scene bounds")
    min_cell_x = min(tile.page_x * TILE_SIDE for tile in tiles)
    min_cell_y = min(tile.page_y * TILE_SIDE for tile in tiles)
    max_cell_x = max(tile.page_x * TILE_SIDE + TILE_SIDE - 1 for tile in tiles)
    max_cell_y = max(tile.page_y * TILE_SIDE + TILE_SIDE - 1 for tile in tiles)
    span_x = max_cell_x - min_cell_x + 1
    span_y = max_cell_y - min_cell_y + 1
    if (
        span_x > MAX_SCENE_SPAN
        or span_y > MAX_SCENE_SPAN
        or span_x * span_y > MAX_SCENE_RASTER_CELLS
    ):
        raise DecodeError(
            "photorealistic SLAM scene is too wide or raster is too large"
        )

    floor_counts: list[int] = []
    surface_counts: list[int] = []
    for tile in tiles:
        floor = np.frombuffer(tile.floor_rgba, dtype=np.uint8).reshape(
            TILE_SIDE, TILE_SIDE, 4
        )
        floor_counts.append(int(np.count_nonzero(floor[:, :, 3])))
        surfaces = np.unpackbits(
            np.frombuffer(tile.surface_bits, dtype=np.uint8), bitorder="big"
        ).reshape(TILE_SIDE, TILE_SIDE, TILE_HEIGHT)
        surface_counts.append(int(np.count_nonzero(surfaces[:, :, 7:])))
    total_points = sum(floor_counts) + sum(surface_counts)
    if total_points == 0:
        raise DecodeError("photorealistic SLAM scene has no visible content")
    sample_step = max(1, math.ceil(total_points / max_points))

    point_dtype = np.dtype(
        [
            ("x", "<u2"),
            ("y", "<u2"),
            ("z", "u1"),
            ("red", "u1"),
            ("green", "u1"),
            ("blue", "u1"),
        ]
    )
    floor_chunks: list[bytes] = []
    surface_chunks: list[bytes] = []
    floor_occupancy = np.zeros((span_y, span_x), dtype=bool)
    floor_point_count = 0
    surface_point_count = 0
    global_ordinal = 0

    for tile, count in zip(tiles, floor_counts, strict=True):
        floor = np.frombuffer(tile.floor_rgba, dtype=np.uint8).reshape(
            TILE_SIDE, TILE_SIDE, 4
        )
        offset_x = tile.page_x * TILE_SIDE - min_cell_x
        offset_y = tile.page_y * TILE_SIDE - min_cell_y
        floor_occupancy[
            offset_y : offset_y + TILE_SIDE,
            offset_x : offset_x + TILE_SIDE,
        ] |= floor[:, :, 3] != 0
        local_y, local_x = np.nonzero(floor[:, :, 3])
        keep = (global_ordinal + np.arange(count)) % sample_step == 0
        global_ordinal += count
        local_x = local_x[keep]
        local_y = local_y[keep]
        colors = floor[:, :, :3][floor[:, :, 3] != 0][keep]
        points = np.empty(len(local_x), dtype=point_dtype)
        points["x"] = tile.page_x * TILE_SIDE + local_x - min_cell_x
        points["y"] = tile.page_y * TILE_SIDE + local_y - min_cell_y
        points["z"] = 0
        points["red"] = colors[:, 0]
        points["green"] = colors[:, 1]
        points["blue"] = colors[:, 2]
        floor_chunks.append(points.tobytes())
        floor_point_count += len(points)

    for tile, count in zip(tiles, surface_counts, strict=True):
        surfaces = np.unpackbits(
            np.frombuffer(tile.surface_bits, dtype=np.uint8), bitorder="big"
        ).reshape(TILE_SIDE, TILE_SIDE, TILE_HEIGHT)
        local_x, local_y, levels = np.nonzero(surfaces)
        if tile.rgb_data:
            colors = np.frombuffer(tile.rgb_data, dtype=np.uint8).reshape(-1, 3)
        else:
            colors = np.full((len(levels), 3), (96, 112, 128), dtype=np.uint8)
        visible = levels >= 7
        local_x = local_x[visible]
        local_y = local_y[visible]
        colors = colors[visible]
        levels = levels[visible] - 7
        keep = (global_ordinal + np.arange(count)) % sample_step == 0
        global_ordinal += count
        local_x = local_x[keep]
        local_y = local_y[keep]
        colors = colors[keep]
        levels = levels[keep]
        points = np.empty(len(local_x), dtype=point_dtype)
        points["x"] = tile.page_x * TILE_SIDE + local_x - min_cell_x
        points["y"] = tile.page_y * TILE_SIDE + local_y - min_cell_y
        points["z"] = levels
        points["red"] = colors[:, 0]
        points["green"] = colors[:, 1]
        points["blue"] = colors[:, 2]
        surface_chunks.append(points.tobytes())
        surface_point_count += len(points)

    rooms: list[dict[str, object]] = []
    if floor_plan is not None:
        for room in floor_plan.rooms:
            if not room.boundary:
                continue
            boundary = [
                [
                    x / VOXEL_SCALE_METERS - min_cell_x,
                    y / VOXEL_SCALE_METERS - min_cell_y,
                ]
                for x, y in room.boundary
            ]
            geometry = _room_floor_geometry(boundary, floor_occupancy)
            if geometry is None:
                continue
            boundary, center = geometry
            # Clipped geometry lies on integer cell edges (centers may end in
            # .5). Emit integral coordinates as JSON integers to avoid wasting
            # two bytes per coordinate on a decimal suffix at the metadata cap.
            boundary = [
                [int(value) if value.is_integer() else value for value in point]
                for point in boundary
            ]
            center = [int(value) if value.is_integer() else value for value in center]
            rooms.append(
                {
                    "room_id": room.id,
                    "name": room.name,
                    "boundary": boundary,
                    "boundary_closed": True,
                    "center": center,
                }
            )
    metadata = json.dumps(
        {
            "meters_per_cell": VOXEL_SCALE_METERS,
            "origin_cells": [min_cell_x, min_cell_y],
            "span_cells": [span_x, span_y],
            "sample_step": sample_step,
            "rooms": rooms,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    # Keep the encoder and both scene consumers on the same protocol limit.
    # Geometry and stable room identities are required for correct selection;
    # reject an unrepresentable scene rather than silently omitting rooms or
    # identities and producing a payload that the renderer will discard.
    if len(metadata) > MAX_SCENE_METADATA_BYTES:
        raise DecodeError("photorealistic SLAM scene metadata exceeds its byte limit")
    header = _SCENE_HEADER.pack(
        SCENE_MAGIC,
        SCENE_VERSION,
        SCENE_POINT_STRIDE,
        len(metadata),
        floor_point_count,
        surface_point_count,
    )
    return b"".join((header, metadata, *floor_chunks, *surface_chunks))


def parse_slam_scene_header(payload: bytes) -> SlamSceneHeader:
    """Validate a complete binary scene and return its bounded header."""
    if len(payload) < _SCENE_HEADER.size:
        raise DecodeError("SLAM scene header is incomplete")
    magic, version, stride, metadata_bytes, floor_points, surface_points = (
        _SCENE_HEADER.unpack_from(payload)
    )
    point_count = floor_points + surface_points
    point_offset = _SCENE_HEADER.size + metadata_bytes
    if (
        magic != SCENE_MAGIC
        or version != SCENE_VERSION
        or stride != SCENE_POINT_STRIDE
        or metadata_bytes > MAX_SCENE_METADATA_BYTES
        or point_count < 1
        or point_count > MAX_SCENE_POINTS
        or point_offset + point_count * stride != len(payload)
    ):
        raise DecodeError("invalid SLAM scene payload")
    return SlamSceneHeader(metadata_bytes, floor_points, surface_points)
