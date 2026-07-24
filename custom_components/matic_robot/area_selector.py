"""Selector for drawing a private custom cleaning area on the local map."""

from __future__ import annotations

import math
from typing import Any, TypedDict

import voluptuous as vol
from homeassistant.helpers.selector import (
    SELECTORS,
    Selector,
    make_selector_config_schema,
)


class MaticAreaSelectorConfig(TypedDict):
    """Configuration sent to the custom-area editor."""

    rooms: list[dict[str, Any]]


POINT_SCHEMA = vol.ExactSequence((vol.Coerce(float), vol.Coerce(float)))
ROOM_SCHEMA = vol.Schema(
    {
        vol.Required("room_id"): str,
        vol.Required("name"): str,
        vol.Required("boundary"): vol.All([POINT_SCHEMA], vol.Length(min=3)),
    }
)


@SELECTORS.register("matic-area")
class MaticAreaSelector(Selector[MaticAreaSelectorConfig]):
    """Validate bounded circles drawn over the current local floor plan."""

    selector_type = "matic-area"
    CONFIG_SCHEMA = make_selector_config_schema({vol.Required("rooms"): [ROOM_SCHEMA]})

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

    def __call__(self, data: Any) -> list[dict[str, float]]:
        """Validate and canonicalize drawn circles without exposing them."""
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
        for item in data:
            circle = dict(schema(item))
            if not all(math.isfinite(value) for value in circle.values()):
                raise vol.Invalid("Area circle values must be finite")
            if not any(
                self._point_in_polygon(circle["x"], circle["y"], room["boundary"])
                for room in rooms
            ):
                raise vol.Invalid("Area circle centers must be inside a mapped room")
            circles.append(circle)
        return circles
