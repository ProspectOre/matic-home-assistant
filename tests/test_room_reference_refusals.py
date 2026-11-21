"""Room references are refused as ambiguous by error type, not message text."""

from __future__ import annotations

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.client import FloorPlan, Room
from custom_components.matic_robot.robot_controls import _resolve_one_room
from custom_components.matic_robot.service_plans import _resolve_room_id

_SQUARE = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
_ROOMS = {"room-a": "Hall", "room-b": "hall", "room-c": "Den"}


def _floor_plan() -> FloorPlan:
    return FloorPlan(
        7,
        "synthetic-partition",
        b"synthetic-partition",
        tuple(
            Room(room_id, name, f"protocol-{room_id}", room_id.encode(), _SQUARE)
            for room_id, name in _ROOMS.items()
        ),
    )


@pytest.mark.parametrize(
    ("identifier", "key", "placeholders"),
    [
        ("Hall", "ambiguous_room", {"room": "Hall"}),
        # A missing room whose name reads like the ambiguity message.
        ("ambiguous room 2", "unknown_rooms", {"rooms": "ambiguous room 2"}),
    ],
    ids=["two halls", "missing room named ambiguous"],
)
def test_room_refusal_follows_the_error_type(
    identifier: str, key: str, placeholders: dict[str, str]
) -> None:
    with pytest.raises(ServiceValidationError) as control:
        _resolve_one_room(identifier, _floor_plan())
    with pytest.raises(ServiceValidationError) as saved:
        _resolve_room_id(identifier, _ROOMS)

    for refusal in (control.value, saved.value):
        assert refusal.translation_key == key
        assert refusal.translation_placeholders == placeholders
