"""Validate private perimeter editing metadata against dispatched circles."""

from __future__ import annotations

import math
from typing import Any

from .area_selector import MaticAreaSelector


def _distance(p: list[float], a: list[float], b: list[float]) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(
        0.0,
        min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy or 1)),
    )
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def _cross(a: list[float], b: list[float], c: list[float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def validate_outline(
    value: Any, circles: list[dict[str, float]]
) -> list[dict[str, float]] | None:
    """Accept a bounded simple polygon only when all cleaning discs fit inside.

    The perimeter is local editor metadata, never a new Hermes payload. Circle
    validation and map binding remain mandatory at the caller.
    """
    if value is None:
        return None
    if not isinstance(value, list) or not 3 <= len(value) <= 64:
        raise ValueError("invalid area outline")
    points: list[list[float]] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"x", "y"}:
            raise ValueError("invalid area outline point")
        if any(type(item[key]) not in (int, float) for key in ("x", "y")):
            raise ValueError("invalid area outline coordinates")
        point = [float(item["x"]), float(item["y"])]
        if any(not math.isfinite(n) or abs(n) > 10000 for n in point):
            raise ValueError("invalid area outline bounds")
        points.append(point)
    edges = list(zip(points, points[1:] + points[:1], strict=True))
    for i, (a, b) in enumerate(edges):
        if math.dist(a, b) < 0.01:
            raise ValueError("area outline points overlap")
        for j in range(i + 2, len(edges)):
            if i == 0 and j == len(edges) - 1:
                continue
            c, d = edges[j]
            if min(
                _distance(a, c, d),
                _distance(b, c, d),
                _distance(c, a, b),
                _distance(d, a, b),
            ) < 0.00001 or (
                _cross(a, b, c) * _cross(a, b, d) < 0
                and _cross(c, d, a) * _cross(c, d, b) < 0
            ):
                raise ValueError("area outline crosses itself")
    if abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in edges)) <= 0.01:
        raise ValueError("area outline is too small")
    for circle in circles:
        p = [circle["x"], circle["y"]]
        if not MaticAreaSelector._point_in_polygon(p[0], p[1], points) or any(
            _distance(p, a, b) + 0.000001 < circle["radius"] for a, b in edges
        ):
            raise ValueError("area coverage exceeds its outline")
    return [{"x": p[0], "y": p[1]} for p in points]
