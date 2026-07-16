"""Selector for the guided, ordered cleaning-plan room editor."""

from __future__ import annotations

from typing import Any, TypedDict

import voluptuous as vol
from homeassistant.helpers.selector import (
    SELECTORS,
    Selector,
    make_selector_config_schema,
)

from .client.commands import CleaningMode, CoverageSetting


class MaticRoomPlanSelectorConfig(TypedDict):
    """Configuration sent to the room-plan editor."""

    rooms: list[dict[str, str]]


ROOM_CONFIG_SCHEMA = vol.Schema(
    {vol.Required("room_id"): str, vol.Required("name"): str}
)


@SELECTORS.register("matic-room-plan")
class MaticRoomPlanSelector(Selector[MaticRoomPlanSelectorConfig]):
    """Validate an ordered list of mapped rooms and their preferences."""

    selector_type = "matic-room-plan"
    CONFIG_SCHEMA = make_selector_config_schema(
        {vol.Required("rooms"): [ROOM_CONFIG_SCHEMA]}
    )

    def __call__(self, data: Any) -> list[dict[str, Any]]:
        """Validate and canonicalize the editor value."""
        if not isinstance(data, list):
            raise vol.Invalid("Expected an ordered room list")

        known_rooms = {room["room_id"] for room in self.config["rooms"]}
        row_schema = vol.Schema(
            {
                vol.Required("room_id"): vol.In(known_rooms),
                vol.Required("included"): bool,
                vol.Required("cleaning_mode"): vol.In(
                    [mode.value for mode in CleaningMode]
                ),
                vol.Required("coverage_setting"): vol.In(
                    [coverage.value for coverage in CoverageSetting]
                ),
            },
            extra=vol.PREVENT_EXTRA,
        )
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for value in data:
            row = row_schema(value)
            room_id = row["room_id"]
            if room_id in seen:
                raise vol.Invalid(f"Duplicate room: {room_id}")
            seen.add(room_id)
            result.append(dict(row))
        if seen != known_rooms:
            raise vol.Invalid("Every mapped room must appear exactly once")
        return result
