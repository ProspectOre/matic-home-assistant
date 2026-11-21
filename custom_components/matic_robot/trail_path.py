"""Where a robot trail breaks and which of its points it keeps.

Matic Map's live trail follows the same rules (``trail-path.ts``), held to
the cases in ``tests/fixtures/trail_path_v1.json``. A segment is a stretch
the robot was seen travelling; the map draws each one whole.
"""

from __future__ import annotations

import heapq
import math
from collections.abc import Sequence

from .map_schema import TrailPoint

# A pose closer than this to the last kept point adds nothing to the path.
TRAIL_STEP_METERS = 0.15
# Poses arrive several times a second, so a longer step between two is a
# relocalisation, not travel, and longer than this unseen leaves the path unknown.
TRAIL_JUMP_METERS = 1.0
TRAIL_GAP_SECONDS = 8.0


def starts_segment(
    last: TrailPoint, last_seen: float | None, point: TrailPoint, seen: float | None
) -> bool:
    """Return whether a kept pose begins a new segment instead of extending one."""
    return math.dist(last[:2], point[:2]) > TRAIL_JUMP_METERS or (
        last_seen is not None
        and seen is not None
        and seen - last_seen > TRAIL_GAP_SECONDS
    )


def thin_segments(
    segments: Sequence[Sequence[TrailPoint]], limit: int
) -> list[list[TrailPoint]]:
    """Keep at most ``limit`` points, removing the least shape-defining first.

    Each segment keeps its ends. A point's weight is its distance from the
    line between its kept neighbours, measured to the nearer end beyond it,
    so a turnaround on a straight pass outweighs the points along it. Equal
    weights go oldest first. When the ends alone exceed the budget, the
    oldest segments go whole.
    """
    paths = [list(segment) for segment in segments if segment]
    ends = 0
    first = len(paths)
    while first and ends + min(2, len(paths[first - 1])) <= limit:
        first -= 1
        ends += min(2, len(paths[first]))
    paths = paths[first:]
    points = [point for path in paths for point in path]
    remaining = len(points)
    if remaining <= limit:
        return paths
    # Links between kept points; only a segment's interior can be removed.
    before = list(range(-1, len(points) - 1))
    after = list(range(1, len(points) + 1))
    candidates: set[int] = set()
    start = 0
    for path in paths:
        candidates.update(range(start + 1, start + len(path) - 1))
        start += len(path)
    removed = [False] * len(points)

    def weighed(index: int) -> tuple[float, int, int, int]:
        previous, following = before[index], after[index]
        weight = _weight(points[index], points[previous], points[following])
        return weight, index, previous, following

    heap = [weighed(index) for index in sorted(candidates)]
    heapq.heapify(heap)
    while remaining > limit:
        _, index, previous, following = heapq.heappop(heap)
        if removed[index] or (before[index], after[index]) != (previous, following):
            continue
        removed[index] = True
        remaining -= 1
        after[previous], before[following] = following, previous
        for neighbour in (previous, following):
            if neighbour in candidates:
                heapq.heappush(heap, weighed(neighbour))
    kept: list[list[TrailPoint]] = []
    start = 0
    for path in paths:
        kept.append(
            [point for index, point in enumerate(path, start) if not removed[index]]
        )
        start += len(path)
    return kept


def _weight(point: TrailPoint, first: TrailPoint, last: TrailPoint) -> float:
    """Squared distance from ``point`` to the segment from ``first`` to ``last``."""
    dx, dy = last[0] - first[0], last[1] - first[1]
    px, py = point[0] - first[0], point[1] - first[1]
    length = dx * dx + dy * dy
    along = min(1.0, max(0.0, (px * dx + py * dy) / length)) if length else 0.0
    ex, ey = px - along * dx, py - along * dy
    return ex * ex + ey * ey
