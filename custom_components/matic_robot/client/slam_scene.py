"""Encode bounded local point-cloud scenes from decoded SLAM pages."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import struct
import zlib
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from google.protobuf.message import DecodeError
from PIL import Image, ImageDraw

from .models import FloorPlan
from .scene_schema import SceneCoverage, SceneMetadata, SceneRoom
from .slam_geometry import mask_contours
from .slam_tiles import (
    MAX_SLAM_TILES,
    TILE_HEIGHT,
    TILE_SIDE,
    VOXEL_SCALE_METERS,
    SlamStructureTile,
    SlamTile,
)

SCENE_MAGIC = b"MATIC3D\x00"
SCENE_VERSION = 1
SCENE_POINT_STRIDE = 8
MAX_SCENE_POINTS = 1_500_000
MAX_SCENE_SPAN = 65_536
MAX_SCENE_RASTER_CELLS = 4 * 1024 * 1024
MAX_SCENE_METADATA_BYTES = 1024 * 1024
MAX_COVERAGE_MASK_BYTES = 384 * 1024
MAX_SCENE_BYTES = 16 * 1024 * 1024
MANIFEST_MAGIC = b"MATICMF\x00"
MANIFEST_VERSION = 1
SCENE_PAGE_ID_BYTES = 12
_SCENE_HEADER = struct.Struct("<8sHHIII")
_MANIFEST_HEADER = struct.Struct("<8sHHII")
_MANIFEST_PAGE = struct.Struct(f"<iiII{SCENE_PAGE_ID_BYTES}s")
_SURFACE_FLOOR_LEVEL = 7
_SCENE_POINT = np.dtype(
    [
        ("x", "<u2"),
        ("y", "<u2"),
        ("z", "u1"),
        ("red", "u1"),
        ("green", "u1"),
        ("blue", "u1"),
    ]
)
_PAGE_POINT = np.dtype(
    [
        ("x", "u1"),
        ("y", "u1"),
        ("z", "u1"),
        ("red", "u1"),
        ("green", "u1"),
        ("blue", "u1"),
    ]
)


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


@dataclass(frozen=True, slots=True)
class ScenePage:
    """The sampled points of one map page, addressed by their content.

    ``points`` holds the floor points, then the surface points, in page-local
    cells: x, y, height, red, green and blue, one byte each.
    """

    floor_points: int
    surface_points: int
    points: bytes
    page_id: bytes


@dataclass(frozen=True, slots=True)
class SceneFrame:
    """The cell rectangle that bounds every page of a scene."""

    origin_x: int
    origin_y: int
    span_x: int
    span_y: int


def scene_frame(
    tiles: Sequence[SlamTile], max_points: int = MAX_SCENE_POINTS
) -> SceneFrame:
    """Return the bounds of a scene, rejecting one the renderer cannot hold."""
    if not tiles:
        raise DecodeError("no photorealistic SLAM tiles are cached")
    if len(tiles) > MAX_SLAM_TILES or max_points < 1:
        raise DecodeError("invalid photorealistic SLAM scene bounds")
    min_cell_x = min(tile.page_x * TILE_SIDE for tile in tiles)
    min_cell_y = min(tile.page_y * TILE_SIDE for tile in tiles)
    span_x = max(tile.page_x * TILE_SIDE for tile in tiles) + TILE_SIDE - min_cell_x
    span_y = max(tile.page_y * TILE_SIDE for tile in tiles) + TILE_SIDE - min_cell_y
    if (
        span_x > MAX_SCENE_SPAN
        or span_y > MAX_SCENE_SPAN
        or span_x * span_y > MAX_SCENE_RASTER_CELLS
    ):
        raise DecodeError(
            "photorealistic SLAM scene is too wide or raster is too large"
        )
    return SceneFrame(min_cell_x, min_cell_y, span_x, span_y)


def _floor(tile: SlamTile) -> np.ndarray:
    return np.frombuffer(tile.floor_rgba, dtype=np.uint8).reshape(
        TILE_SIDE, TILE_SIDE, 4
    )


def _surfaces(tile: SlamTile) -> np.ndarray:
    return np.unpackbits(
        np.frombuffer(tile.surface_bits, dtype=np.uint8), bitorder="big"
    ).reshape(TILE_SIDE, TILE_SIDE, TILE_HEIGHT)


def scene_point_count(tile: SlamTile) -> int:
    """Return how many points one page shows before sampling."""
    return int(np.count_nonzero(_floor(tile)[:, :, 3])) + int(
        np.count_nonzero(_surfaces(tile)[:, :, _SURFACE_FLOOR_LEVEL:])
    )


def scene_sample_step(counts: Sequence[int], max_points: int = MAX_SCENE_POINTS) -> int:
    """Return the step that keeps every ``step``-th point of each page in budget.

    The step is the one a single sampled sequence of every point would use,
    raised only when rounding up on every page would pass ``max_points``.
    Each page with content keeps at least one point, so a budget below their
    number is rejected.
    """
    total = sum(counts)
    if total == 0:
        raise DecodeError("photorealistic SLAM scene has no visible content")
    if sum(map(bool, counts)) > max_points:
        raise DecodeError("photorealistic SLAM scene has more pages than points")
    step = max(1, math.ceil(total / max_points))
    while sum(-(-count // step) for count in counts) > max_points:
        step += 1
    return step


def encode_scene_page(tile: SlamTile, sample_step: int) -> ScenePage:
    """Sample one page; its ordinal restarts here, so it depends on nothing else."""
    floor = _floor(tile)
    alpha = floor[:, :, 3] != 0
    floor_y, floor_x = np.nonzero(alpha)
    floor_colors = floor[:, :, :3][alpha]
    surface_x, surface_y, levels = np.nonzero(_surfaces(tile))
    if tile.rgb_data:
        surface_colors = np.frombuffer(tile.rgb_data, dtype=np.uint8).reshape(-1, 3)
    else:
        surface_colors = np.full((len(levels), 3), (96, 112, 128), dtype=np.uint8)
    visible = levels >= _SURFACE_FLOOR_LEVEL
    keep = np.arange(len(floor_x) + np.count_nonzero(visible)) % sample_step == 0
    floor_keep, surface_keep = keep[: len(floor_x)], keep[len(floor_x) :]
    floor_points = _page_points(
        floor_x[floor_keep], floor_y[floor_keep], 0, floor_colors[floor_keep]
    )
    surface_points = _page_points(
        surface_x[visible][surface_keep],
        surface_y[visible][surface_keep],
        levels[visible][surface_keep] - _SURFACE_FLOOR_LEVEL,
        surface_colors[visible][surface_keep],
    )
    points = floor_points.tobytes() + surface_points.tobytes()
    digest = hashlib.sha256(len(floor_points).to_bytes(4, "little"))
    digest.update(points)
    return ScenePage(
        len(floor_points),
        len(surface_points),
        points,
        digest.digest()[:SCENE_PAGE_ID_BYTES],
    )


def _page_points(
    x: np.ndarray, y: np.ndarray, z: np.ndarray | int, colors: np.ndarray
) -> np.ndarray:
    points = np.empty(len(x), dtype=_PAGE_POINT)
    points["x"] = x
    points["y"] = y
    points["z"] = z
    points["red"] = colors[:, 0]
    points["green"] = colors[:, 1]
    points["blue"] = colors[:, 2]
    return points


def scene_metadata(
    tiles: Sequence[SlamTile],
    frame: SceneFrame,
    sample_step: int,
    *,
    floor_plan: FloorPlan | None = None,
    structure_tiles: tuple[SlamStructureTile, ...] | None = None,
) -> bytes:
    """Encode the scene's frame, sampling, rooms and optional coverage."""
    rooms: list[SceneRoom] = []
    if floor_plan is not None:
        floor_occupancy = np.zeros((frame.span_y, frame.span_x), dtype=bool)
        for tile in tiles:
            offset_x = tile.page_x * TILE_SIDE - frame.origin_x
            offset_y = tile.page_y * TILE_SIDE - frame.origin_y
            floor_occupancy[
                offset_y : offset_y + TILE_SIDE,
                offset_x : offset_x + TILE_SIDE,
            ] |= _floor(tile)[:, :, 3] != 0
        for room in floor_plan.rooms:
            if not room.boundary:
                continue
            boundary = [
                [
                    x / VOXEL_SCALE_METERS - frame.origin_x,
                    y / VOXEL_SCALE_METERS - frame.origin_y,
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
    metadata_value: SceneMetadata = {
        "meters_per_cell": VOXEL_SCALE_METERS,
        "origin_cells": [frame.origin_x, frame.origin_y],
        "span_cells": [frame.span_x, frame.span_y],
        "sample_step": sample_step,
        "rooms": rooms,
    }
    if structure_tiles is not None:
        coverage = _coverage_metadata(
            structure_tiles, frame.origin_x, frame.origin_y, frame.span_x, frame.span_y
        )
        if coverage is not None:
            metadata_value["coverage"] = coverage
    metadata = json.dumps(
        metadata_value,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    # Keep the encoder and both scene consumers on the same protocol limit.
    # Geometry and stable room identities are required for correct selection;
    # reject an unrepresentable scene rather than silently omitting rooms or
    # identities and producing a payload that the renderer will discard.
    if len(metadata) > MAX_SCENE_METADATA_BYTES:
        # Coverage is optional for display but required for validated compare.
        # Keep the scene usable and make omitted support explicitly unknown.
        metadata_value.pop("coverage", None)
        metadata_value["coverage"] = {
            "version": 1,
            "status": "too_large",
            "diff_eligible": False,
        }
        metadata = json.dumps(
            metadata_value, ensure_ascii=False, separators=(",", ":")
        ).encode()
        if len(metadata) > MAX_SCENE_METADATA_BYTES:
            metadata_value.pop("coverage", None)
            metadata = json.dumps(
                metadata_value, ensure_ascii=False, separators=(",", ":")
            ).encode()
        if len(metadata) > MAX_SCENE_METADATA_BYTES:
            raise DecodeError(
                "photorealistic SLAM scene metadata exceeds its byte limit"
            )
    return metadata


def encode_scene_manifest(
    metadata: bytes, tiles: Sequence[SlamTile], pages: Sequence[ScenePage]
) -> bytes:
    """Encode the scene metadata and, in scene order, each page's address."""
    return b"".join(
        (
            _MANIFEST_HEADER.pack(
                MANIFEST_MAGIC,
                MANIFEST_VERSION,
                _MANIFEST_PAGE.size,
                len(metadata),
                len(pages),
            ),
            metadata,
            *(
                _MANIFEST_PAGE.pack(
                    tile.page_x,
                    tile.page_y,
                    page.floor_points,
                    page.surface_points,
                    page.page_id,
                )
                for tile, page in zip(tiles, pages, strict=True)
            ),
        )
    )


def encode_slam_scene(
    tiles: tuple[SlamTile, ...],
    *,
    floor_plan: FloorPlan | None = None,
    max_points: int = MAX_SCENE_POINTS,
    structure_tiles: tuple[SlamStructureTile, ...] | None = None,
) -> bytes:
    """Encode one self-contained point cloud, the form saved maps keep.

    Positions use two unsigned 16-bit map-local coordinates, one unsigned
    8-bit height, and RGB bytes: all floor points, then all surface points,
    each in page order. It is the buffer Matic Map assembles from a live
    manifest and its pages.
    """
    frame = scene_frame(tiles, max_points)
    sample_step = scene_sample_step(tuple(map(scene_point_count, tiles)), max_points)
    pages = [encode_scene_page(tile, sample_step) for tile in tiles]
    metadata = scene_metadata(
        tiles,
        frame,
        sample_step,
        floor_plan=floor_plan,
        structure_tiles=structure_tiles,
    )
    floors: list[bytes] = []
    surfaces: list[bytes] = []
    for tile, page in zip(tiles, pages, strict=True):
        local = np.frombuffer(page.points, dtype=_PAGE_POINT)
        points = np.empty(len(local), dtype=_SCENE_POINT)
        points["x"] = local["x"].astype(np.uint16) + (
            tile.page_x * TILE_SIDE - frame.origin_x
        )
        points["y"] = local["y"].astype(np.uint16) + (
            tile.page_y * TILE_SIDE - frame.origin_y
        )
        for channel in ("z", "red", "green", "blue"):
            points[channel] = local[channel]
        floors.append(points[: page.floor_points].tobytes())
        surfaces.append(points[page.floor_points :].tobytes())
    header = _SCENE_HEADER.pack(
        SCENE_MAGIC,
        SCENE_VERSION,
        SCENE_POINT_STRIDE,
        len(metadata),
        sum(page.floor_points for page in pages),
        sum(page.surface_points for page in pages),
    )
    return b"".join((header, metadata, *floors, *surfaces))


def _coverage_metadata(
    tiles: tuple[SlamStructureTile, ...],
    origin_x: int,
    origin_y: int,
    span_x: int,
    span_y: int,
) -> SceneCoverage | None:
    """Encode exact structurally observed cells, or explicitly mark unknown."""
    if not tiles:
        return {"version": 1, "status": "unavailable", "diff_eligible": False}
    observed = np.zeros((span_y, span_x), dtype=np.bool_)
    for tile in tiles:
        if len(tile.occupancy) != TILE_SIDE * TILE_SIDE:
            return {"version": 1, "status": "invalid", "diff_eligible": False}
        left = tile.page_x * TILE_SIDE - origin_x
        top = tile.page_y * TILE_SIDE - origin_y
        x0, y0 = max(0, left), max(0, top)
        x1, y1 = min(span_x, left + TILE_SIDE), min(span_y, top + TILE_SIDE)
        if x0 >= x1 or y0 >= y1:
            continue
        occupancy = np.frombuffer(tile.occupancy, dtype=np.uint8).reshape(
            TILE_SIDE, TILE_SIDE
        )
        observed[y0:y1, x0:x1] |= (
            occupancy[y0 - top : y1 - top, x0 - left : x1 - left] != 1
        )
    packed = np.packbits(observed.reshape(-1), bitorder="little").tobytes()
    compressed = zlib.compress(packed, level=6)
    if len(compressed) > MAX_COVERAGE_MASK_BYTES:
        return {"version": 1, "status": "too_large", "diff_eligible": False}
    return {
        "version": 1,
        "status": "verified",
        "encoding": "zlib-bitset-little-v1",
        "origin_cells": [origin_x, origin_y],
        "meters_per_cell": VOXEL_SCALE_METERS,
        "span_cells": [span_x, span_y],
        "observed_cells": int(np.count_nonzero(observed)),
        "mask_sha256": hashlib.sha256(compressed).hexdigest(),
        "mask_zlib_base64": base64.b64encode(compressed).decode("ascii"),
        "diff_eligible": True,
    }


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
