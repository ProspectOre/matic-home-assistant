"""Outline carpet and vents from the robot's semantic map pages.

``map_semantics`` holds one byte per 1.5 cm cell in 32 by 32 pages. The app
names the values ``SemanticsKind``: 0 unknown, 1 hard floor, 2 carpet, 3 wire,
4 pet waste, 5 mirror, 6 cloth and 7 vent. ``map_semantics_override`` holds
pages of the same shape; a nonzero override cell replaces the robot's own.
"""

from __future__ import annotations

import hashlib
import struct
from collections.abc import Iterable
from dataclasses import dataclass
from enum import IntEnum

import numpy as np
from google.protobuf.message import DecodeError

from .slam_map import (
    MAX_SCENE_RASTER_CELLS,
    MAX_SLAM_TILES,
    TILE_SIDE,
    VOXEL_SCALE_METERS,
    SlamSemanticTile,
    _mask_contours,
)

# Two by two cells (3 cm) keep rug and vent edges while cutting the staircase
# vertices a 1.5 cm outline has on every diagonal.
_CELL_GROUP = 2
# Specks smaller than this many grouped cells (about 36 cm²) are classifier
# noise rather than a rug or a vent.
_MIN_GROUPED_CELLS = 4
MAX_FLOOR_TYPE_POINTS = 40_000
# Tracing builds every boundary edge before specks are dropped. A real home's
# rugs and vents have a few thousand edges at 3 cm; a class with more than
# this is noise, so it is skipped rather than traced.
MAX_FLOOR_TYPE_EDGES = 200_000


class SemanticKind(IntEnum):
    """Cell classes the robot assigns to its map."""

    UNKNOWN = 0
    HARD_FLOOR = 1
    CARPET = 2
    WIRE = 3
    PET_WASTE = 4
    MIRROR = 5
    CLOTH = 6
    VENT = 7


# Matic Map draws these classes; hard floor is the map's own base.
FLOOR_LAYER_KINDS = {"carpet": SemanticKind.CARPET, "vent": SemanticKind.VENT}

type Outline = tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class FloorTypeLayer:
    """Closed outlines in map metres, grouped by layer name.

    Each layer is drawn with the even-odd rule: outlines inside another
    outline of the same layer are holes.
    """

    layers: dict[str, tuple[Outline, ...]]
    page_count: int
    truncated: bool


def mission_token(mission_id: int) -> str:
    """Return the token a semantic page keyed by this mission carries."""
    key = bytes((2 << 3 | 5,)) + struct.pack("<I", mission_id)
    return hashlib.sha256(key).hexdigest()


def floor_type_layer(
    pages: Iterable[SlamSemanticTile],
    overrides: Iterable[SlamSemanticTile] = (),
    *,
    mission: str,
) -> FloorTypeLayer:
    """Merge the floor's semantic pages and outline each drawn class."""
    merged: dict[tuple[int, int], np.ndarray] = {}
    for page in pages:
        if page.mission_token == mission:
            merged[(page.page_x, page.page_y)] = _cells(page).copy()
    for page in overrides:
        if page.mission_token != mission:
            continue
        cells = _cells(page)
        base = merged.setdefault((page.page_x, page.page_y), np.zeros_like(cells))
        np.copyto(base, cells, where=cells != 0)
    if len(merged) > MAX_SLAM_TILES:
        raise DecodeError("too many semantic pages")
    if not merged:
        return FloorTypeLayer(dict.fromkeys(FLOOR_LAYER_KINDS, ()), 0, False)

    min_x = min(x for x, _ in merged)
    min_y = min(y for _, y in merged)
    width = (max(x for x, _ in merged) - min_x + 1) * TILE_SIDE
    height = (max(y for _, y in merged) - min_y + 1) * TILE_SIDE
    if width * height > MAX_SCENE_RASTER_CELLS:
        raise DecodeError("semantic map raster is too large")
    grid = np.zeros((height, width), dtype=np.uint8)
    for (page_x, page_y), cells in merged.items():
        top = (page_y - min_y) * TILE_SIDE
        left = (page_x - min_x) * TILE_SIDE
        grid[top : top + TILE_SIDE, left : left + TILE_SIDE] = cells

    budget = MAX_FLOOR_TYPE_POINTS
    truncated = False
    layers: dict[str, tuple[Outline, ...]] = {}
    for name, kind in FLOOR_LAYER_KINDS.items():
        outlines, budget, cut = _outlines(
            grid == kind, origin=(min_x * TILE_SIDE, min_y * TILE_SIDE), budget=budget
        )
        layers[name] = outlines
        truncated = truncated or cut
    return FloorTypeLayer(layers, len(merged), truncated)


def _cells(page: SlamSemanticTile) -> np.ndarray:
    """Return one page as rows of cells, the layout of the other map layers."""
    return np.frombuffer(page.cells, dtype=np.uint8).reshape(TILE_SIDE, TILE_SIDE)


def _outlines(
    mask: np.ndarray, *, origin: tuple[int, int], budget: int
) -> tuple[tuple[Outline, ...], int, bool]:
    """Trace one class at 3 cm, largest outlines first, within a point budget."""
    height, width = mask.shape
    grouped: np.ndarray = np.asarray(
        mask.reshape(
            height // _CELL_GROUP, _CELL_GROUP, width // _CELL_GROUP, _CELL_GROUP
        ).any(axis=(1, 3))
    )
    if not grouped.any():
        return (), budget, False
    padded = np.pad(grouped, 1)
    edges = int(np.count_nonzero(padded[1:, :] != padded[:-1, :])) + int(
        np.count_nonzero(padded[:, 1:] != padded[:, :-1])
    )
    if edges > MAX_FLOOR_TYPE_EDGES:
        return (), budget, True
    contours = [
        contour
        for contour in _mask_contours(grouped)
        if abs(_area(contour)) >= 2 * _MIN_GROUPED_CELLS
    ]
    contours.sort(key=lambda contour: abs(_area(contour)), reverse=True)
    scale = _CELL_GROUP * VOXEL_SCALE_METERS
    outlines: list[Outline] = []
    for contour in contours:
        if len(contour) > budget:
            return tuple(outlines), budget, True
        budget -= len(contour)
        outlines.append(
            tuple(
                (
                    round(origin[0] * VOXEL_SCALE_METERS + x * scale, 3),
                    round(origin[1] * VOXEL_SCALE_METERS + y * scale, 3),
                )
                for x, y in contour
            )
        )
    return tuple(outlines), budget, False


def _area(contour: tuple[tuple[int, int], ...]) -> int:
    """Return twice the signed area of one closed contour."""
    return sum(
        x1 * y2 - x2 * y1
        for (x1, y1), (x2, y2) in zip(contour, contour[1:] + contour[:1], strict=True)
    )
