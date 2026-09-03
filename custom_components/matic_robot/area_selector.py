"""Selector for drawing a private custom cleaning area on the local map."""

from __future__ import annotations

import math
from typing import Any, NotRequired, TypedDict

import voluptuous as vol
from homeassistant.helpers.selector import (
    SELECTORS,
    Selector,
    make_selector_config_schema,
)


class MaticAreaSelectorConfig(TypedDict):
    """Configuration sent to the custom-area editor."""

    rooms: list[dict[str, Any]]
    embedded: NotRequired[bool]
    scene_url: NotRequired[str]


POINT_SCHEMA = vol.ExactSequence((vol.Coerce(float), vol.Coerce(float)))
ROOM_SCHEMA = vol.Schema(
    {
        vol.Required("room_id"): str,
        vol.Required("name"): str,
        vol.Required("boundary"): vol.All([POINT_SCHEMA], vol.Length(min=3)),
    }
)

_POLYGON_BUCKET_COUNT = 256
_GEOMETRY_EPSILON = 1e-8


class _IndexedPolygon:
    """Answer exact point-in-polygon queries without rescanning every edge."""

    def __init__(self, boundary: list[list[float]]) -> None:
        self.boundary = boundary
        xs = [float(point[0]) for point in boundary]
        ys = [float(point[1]) for point in boundary]
        self.minimum_x = min(xs)
        self.maximum_x = max(xs)
        self.minimum_y = min(ys)
        self.maximum_y = max(ys)
        span = self.maximum_y - self.minimum_y
        self.bucket_height = max(span / _POLYGON_BUCKET_COUNT, _GEOMETRY_EPSILON)
        buckets: dict[int, list[tuple[list[float], list[float]]]] = {}
        previous = boundary[-1]
        for current in boundary:
            minimum_y = min(float(previous[1]), float(current[1]))
            maximum_y = max(float(previous[1]), float(current[1]))
            first = self._bucket(minimum_y - _GEOMETRY_EPSILON)
            last = self._bucket(maximum_y + _GEOMETRY_EPSILON)
            for bucket in range(first, last + 1):
                buckets.setdefault(bucket, []).append((previous, current))
            previous = current
        self.edges_by_bucket = {
            bucket: tuple(edges) for bucket, edges in buckets.items()
        }

    def _bucket(self, y: float) -> int:
        return math.floor((y - self.minimum_y) / self.bucket_height)

    def contains(self, x: float, y: float, tolerance: float) -> bool:
        """Return whether a point is inside or tolerably near this polygon."""
        if not (
            self.minimum_x - tolerance <= x <= self.maximum_x + tolerance
            and self.minimum_y - tolerance <= y <= self.maximum_y + tolerance
        ):
            return False
        candidates = {
            (id(start), id(end)): (start, end)
            for bucket in range(
                self._bucket(y - tolerance - _GEOMETRY_EPSILON),
                self._bucket(y + tolerance + _GEOMETRY_EPSILON) + 1,
            )
            for start, end in self.edges_by_bucket.get(bucket, ())
        }.values()
        edges = tuple(candidates)
        if any(
            MaticAreaSelector._point_on_segment(x, y, start, end)
            for start, end in edges
        ):
            return True
        inside = False
        for previous, current in edges:
            current_x, current_y = (float(value) for value in current)
            previous_x, previous_y = (float(value) for value in previous)
            if (current_y > y) != (previous_y > y) and x < (
                (previous_x - current_x) * (y - current_y) / (previous_y - current_y)
                + current_x
            ):
                inside = not inside
        if inside or not tolerance:
            return inside
        return any(
            MaticAreaSelector._point_near_segment(x, y, start, end, tolerance)
            for start, end in edges
        )


class _RoomGeometryIndex:
    """Share bounded exact room lookups across custom-area validation."""

    def __init__(self, rooms: list[dict[str, Any]]) -> None:
        self.polygons = tuple(_IndexedPolygon(room["boundary"]) for room in rooms)

    def contains(self, x: float, y: float, tolerance: float = 0.0) -> bool:
        """Return whether a point belongs to any mapped room."""
        return any(polygon.contains(x, y, tolerance) for polygon in self.polygons)


@SELECTORS.register("matic-area")
class MaticAreaSelector(Selector[MaticAreaSelectorConfig]):
    """Validate bounded circles drawn over the current local floor plan."""

    selector_type = "matic-area"
    CONFIG_SCHEMA = make_selector_config_schema(
        {
            vol.Required("rooms"): [ROOM_SCHEMA],
            vol.Optional("embedded"): bool,
            vol.Optional("scene_url"): vol.All(
                str,
                vol.Match(r"^/api/matic_robot/slam_scene/[A-Za-z0-9]+$"),
            ),
        }
    )

    @staticmethod
    def _point_on_segment(
        x: float,
        y: float,
        start: list[float],
        end: list[float],
    ) -> bool:
        """Return whether a point lies on a polygon edge."""
        start_x, start_y = (float(value) for value in start)
        end_x, end_y = (float(value) for value in end)
        cross = (x - start_x) * (end_y - start_y) - (y - start_y) * (end_x - start_x)
        if abs(cross) > 1e-8:
            return False
        dot = (x - start_x) * (end_x - start_x) + (y - start_y) * (end_y - start_y)
        squared_length = (end_x - start_x) ** 2 + (end_y - start_y) ** 2
        return -1e-8 <= dot <= squared_length + 1e-8

    @classmethod
    def _point_in_polygon(cls, x: float, y: float, boundary: list[list[float]]) -> bool:
        """Return whether a point is inside or on a room boundary."""
        inside = False
        previous = boundary[-1]
        for current in boundary:
            if cls._point_on_segment(x, y, previous, current):
                return True
            current_x, current_y = (float(value) for value in current)
            previous_x, previous_y = (float(value) for value in previous)
            if (current_y > y) != (previous_y > y) and x < (
                (previous_x - current_x) * (y - current_y) / (previous_y - current_y)
                + current_x
            ):
                inside = not inside
            previous = current
        return inside

    @staticmethod
    def _point_near_segment(
        x: float,
        y: float,
        start: list[float],
        end: list[float],
        tolerance: float,
    ) -> bool:
        """Return whether a point is within a distance of a polygon edge."""
        start_x, start_y = (float(value) for value in start)
        end_x, end_y = (float(value) for value in end)
        delta_x = end_x - start_x
        delta_y = end_y - start_y
        length_squared = delta_x * delta_x + delta_y * delta_y
        projection = (
            0.0
            if not length_squared
            else min(
                1.0,
                max(
                    0.0,
                    ((x - start_x) * delta_x + (y - start_y) * delta_y)
                    / length_squared,
                ),
            )
        )
        nearest_x = start_x + projection * delta_x
        nearest_y = start_y + projection * delta_y
        return math.hypot(x - nearest_x, y - nearest_y) <= tolerance

    @classmethod
    def _point_in_or_near_polygon(
        cls,
        x: float,
        y: float,
        boundary: list[list[float]],
        tolerance: float,
    ) -> bool:
        """Return whether a point is inside or tolerably near a polygon."""
        if cls._point_in_polygon(x, y, boundary):
            return True
        if not tolerance:
            return False
        return any(
            cls._point_near_segment(x, y, previous, current, tolerance)
            for previous, current in zip(
                (boundary[-1], *boundary[:-1]), boundary, strict=True
            )
        )

    def __call__(self, data: Any) -> list[dict[str, float]]:
        """Validate and canonicalize drawn circles without exposing them."""
        return self.validate(data)

    def validate(
        self,
        data: Any,
        *,
        center_tolerance: float = 0.0,
        geometry: _RoomGeometryIndex | None = None,
    ) -> list[dict[str, float]]:
        """Validate circles with an optional saved-center boundary tolerance."""
        if not isinstance(data, list):
            raise vol.Invalid("Expected a list of drawn circles")
        if not 1 <= len(data) <= 512:
            raise vol.Invalid("Draw between 1 and 512 area circles")
        schema = vol.Schema(
            {
                vol.Required("x"): vol.Coerce(float),
                vol.Required("y"): vol.Coerce(float),
                vol.Required("radius"): vol.All(
                    vol.Coerce(float), vol.Range(min=0.05, max=2.5)
                ),
            },
            extra=vol.PREVENT_EXTRA,
        )
        circles: list[dict[str, float]] = []
        rooms = self.config["rooms"]
        geometry = geometry or _RoomGeometryIndex(rooms)
        for item in data:
            circle = dict(schema(item))
            if not all(math.isfinite(value) for value in circle.values()):
                raise vol.Invalid("Area circle values must be finite")
            if not geometry.contains(circle["x"], circle["y"], center_tolerance):
                raise vol.Invalid("Area circle centers must be inside a mapped room")
            circles.append(circle)
        return circles
