"""Selector for drawing a private custom cleaning area on the local map."""

from __future__ import annotations

import hashlib
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


class GeometryTooComplex(ValueError):
    """The bounded fallback budget cannot prove containment."""


POINT_SCHEMA = vol.ExactSequence((vol.Coerce(float), vol.Coerce(float)))
ROOM_SCHEMA = vol.Schema(
    {
        vol.Required("room_id"): str,
        vol.Required("name"): str,
        vol.Required("boundary"): vol.All([POINT_SCHEMA], vol.Length(min=3)),
    }
)


class _IndexedPolygon:
    """Answer point-in-polygon queries with bounded storage and work."""

    _BUCKET_COUNT = 256
    _MAX_EDGE_REFERENCES = 16_384
    # Match the room-boundary limit enforced by the protocol decoder. Charge
    # every fallback edge check to the shared query budget.
    _MAX_FALLBACK_EDGES = 4_096

    def __init__(self, boundary: list[list[float]]) -> None:
        self.boundary = boundary
        xs = [float(point[0]) for point in boundary]
        ys = [float(point[1]) for point in boundary]
        self.minimum_x = min(xs)
        self.maximum_x = max(xs)
        self.minimum_y = min(ys)
        self.maximum_y = max(ys)
        fingerprint = hashlib.blake2b(digest_size=8)
        for point in boundary:
            fingerprint.update(float(point[0]).hex().encode("ascii"))
            fingerprint.update(b",")
            fingerprint.update(float(point[1]).hex().encode("ascii"))
            fingerprint.update(b";")
        self.fallback_order_key = (
            len(boundary),
            self.minimum_x,
            self.minimum_y,
            self.maximum_x,
            self.maximum_y,
            fingerprint.digest(),
        )
        span = self.maximum_y - self.minimum_y
        self.bucket_height = max(span / self._BUCKET_COUNT, 1e-8)
        buckets: dict[int, list[tuple[list[float], list[float]]]] = {}
        references = 0
        overloaded = False
        previous = boundary[-1]
        for current in boundary:
            first = self._bucket(min(float(previous[1]), float(current[1])) - 1e-8)
            last = self._bucket(max(float(previous[1]), float(current[1])) + 1e-8)
            count = last - first + 1
            if references + count > self._MAX_EDGE_REFERENCES:
                overloaded = True
                break
            for bucket in range(first, last + 1):
                buckets.setdefault(bucket, []).append((previous, current))
            references += count
            previous = current
        self.edges_by_bucket = {
            bucket: tuple(edges) for bucket, edges in buckets.items()
        }
        self.overloaded = overloaded

    def _bucket(self, y: float) -> int:
        return math.floor((y - self.minimum_y) / self.bucket_height)

    def contains(self, x: float, y: float, tolerance: float) -> bool:
        """Return whether a point is inside or tolerably near this polygon."""
        contained, _ = self.contains_with_work_limit(x, y, tolerance, None)
        return contained

    def contains_with_work_limit(
        self, x: float, y: float, tolerance: float, work_limit: int | None
    ) -> tuple[bool, int]:
        """Return containment and edge work performed under a shared budget."""
        work = 0

        def charge_edge() -> None:
            nonlocal work
            work += 1
            if work_limit is not None and work > work_limit:
                raise GeometryTooComplex("room geometry query budget exhausted")

        if not (
            self.minimum_x - tolerance <= x <= self.maximum_x + tolerance
            and self.minimum_y - tolerance <= y <= self.maximum_y + tolerance
        ):
            return False, work
        if self.overloaded:
            if len(self.boundary) > self._MAX_FALLBACK_EDGES:
                raise GeometryTooComplex(
                    "room geometry exceeds the fallback edge limit"
                )
            return MaticAreaSelector._point_in_or_near_polygon_with_work_limit(
                x, y, self.boundary, tolerance, work_limit
            )

        edge_values: dict[tuple[int, int], tuple[list[float], list[float]]] = {}
        for bucket in range(
            self._bucket(y - tolerance - 1e-8),
            self._bucket(y + tolerance + 1e-8) + 1,
        ):
            for start, end in self.edges_by_bucket.get(bucket, ()):
                charge_edge()
                edge_values[(id(start), id(end))] = (start, end)
        edges = tuple(edge_values.values())
        for start, end in edges:
            charge_edge()
            if MaticAreaSelector._point_on_segment(x, y, start, end):
                return True, work
        inside = False
        for previous, current in edges:
            charge_edge()
            current_x, current_y = (float(value) for value in current)
            previous_x, previous_y = (float(value) for value in previous)
            if (current_y > y) != (previous_y > y) and x < (
                (previous_x - current_x) * (y - current_y) / (previous_y - current_y)
                + current_x
            ):
                inside = not inside
        if inside or not tolerance:
            return inside, work
        for start, end in edges:
            charge_edge()
            if MaticAreaSelector._point_near_segment(x, y, start, end, tolerance):
                return True, work
        return False, work


class _RoomGeometryIndex:
    """Share bounded exact room lookups across custom-area validation."""

    # Cover the 512-circle limit for eight 256-edge rooms and ten
    # center/occupancy probes per circle, with a small indexing margin.
    _MAX_QUERY_WORK = 10_600_000

    def __init__(self, rooms: list[dict[str, Any]]) -> None:
        self.polygons = tuple(_IndexedPolygon(room["boundary"]) for room in rooms)
        self._query_work_remaining = self._MAX_QUERY_WORK

    def contains(self, x: float, y: float, tolerance: float = 0.0) -> bool:
        """Return whether a point belongs to any mapped room."""
        # Indexed rooms have a fixed reference cap, so check them before any
        # fallback that may need to fail closed for excessive geometry.
        for polygon in self.polygons:
            if polygon.overloaded:
                continue
            contained, work = polygon.contains_with_work_limit(
                x, y, tolerance, self._query_work_remaining
            )
            self._query_work_remaining -= work
            if contained:
                return True

        overloaded = sorted(
            (
                polygon
                for polygon in self.polygons
                if polygon.overloaded
                and polygon.minimum_x - tolerance <= x <= polygon.maximum_x + tolerance
                and polygon.minimum_y - tolerance <= y <= polygon.maximum_y + tolerance
            ),
            key=lambda polygon: polygon.fallback_order_key,
        )
        for polygon in overloaded:
            contained, work = polygon.contains_with_work_limit(
                x, y, tolerance, self._query_work_remaining
            )
            self._query_work_remaining -= work
            if contained:
                return True
        return False


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
        contained, _ = cls._point_in_or_near_polygon_with_work_limit(
            x, y, boundary, tolerance, None
        )
        return contained

    @classmethod
    def _point_in_or_near_polygon_with_work_limit(
        cls,
        x: float,
        y: float,
        boundary: list[list[float]],
        tolerance: float,
        work_limit: int | None,
    ) -> tuple[bool, int]:
        """Check a polygon while counting edge work against a shared budget."""
        work = 0

        def charge_edge() -> None:
            nonlocal work
            work += 1
            if work_limit is not None and work > work_limit:
                raise GeometryTooComplex("room geometry fallback budget exhausted")

        inside = False
        previous = boundary[-1]
        for current in boundary:
            charge_edge()
            if cls._point_on_segment(x, y, previous, current):
                return True, work
            current_x, current_y = (float(value) for value in current)
            previous_x, previous_y = (float(value) for value in previous)
            if (current_y > y) != (previous_y > y) and x < (
                (previous_x - current_x) * (y - current_y) / (previous_y - current_y)
                + current_x
            ):
                inside = not inside
            previous = current
        if inside:
            return True, work
        if not tolerance:
            return False, work
        for previous, current in zip(
            (boundary[-1], *boundary[:-1]), boundary, strict=True
        ):
            charge_edge()
            if cls._point_near_segment(x, y, previous, current, tolerance):
                return True, work
        return False, work

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
            try:
                contained = geometry.contains(
                    circle["x"], circle["y"], center_tolerance
                )
            except GeometryTooComplex as err:
                raise vol.Invalid(str(err)) from err
            if not contained:
                raise vol.Invalid("Area circle centers must be inside a mapped room")
            circles.append(circle)
        return circles
