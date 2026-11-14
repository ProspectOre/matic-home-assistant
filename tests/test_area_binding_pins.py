"""Saved areas of every stored binding version resolve and upgrade as before.

`area_binding_pins_ba7fb875.json` holds one stored area per `map_binding`
version, as release/0.6 at ba7fb875 wrote or derived it from the synthetic
floor below, and what that release did with each one on six floors: the
binding status, whether the area could be reviewed, the area as Matic Map
received it, the circles a clean would send to the robot, and what the
startup upgrade saved. v3 appears with room anchors that carry boundaries
(written since 0.5), anchors without boundaries and no anchors (0.3 and 0.4).
v1, v2 and v5 are no longer written; 0.5.4 wrote v3, v4 and v6.

0.6 writes only v7 and converts the others once they verify. The resolved
pins are as ba7fb875 recorded them. The upgrade pins were re-recorded for v7:
the saved version and bytes, `upgraded` and `saves` where v3 and v6 now
convert, and `pending`, which stays true while an old record is unconverted.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot import area_binding_geometry as geometry
from custom_components.matic_robot import area_binding_legacy, plan_state
from custom_components.matic_robot.area_binding import (
    area_binding_allows_review,
    area_binding_status,
    binding_for_area,
    valid_binding,
)
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.area_views import _project_areas
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.service_plans import _validated_area_command
from tests import legacy_bindings

GOLDEN = Path(__file__).parent / "fixtures" / "area_binding_pins_ba7fb875.json"
SERIAL = "pin-robot"
RUG = [{"x": 1.0, "y": 0.75, "radius": 0.25}]
DEN = [{"x": 3.5, "y": 0.5, "radius": 0.5}]
VERSIONS = (
    "v1",
    "v2",
    "v3_unanchored",
    "v3_without_boundaries",
    "v3",
    "v4",
    "v5",
    "v6",
)


def _dense_square(x: float) -> tuple[tuple[float, float], ...]:
    """A 1 m room traced with 300 points, so an area in it hashes its walls."""
    return (
        *((x + index / 75, 0.0) for index in range(75)),
        *((x + 1.0, index / 75) for index in range(75)),
        *((x + 1.0 - index / 75, 1.0) for index in range(75)),
        *((x, 1.0 - index / 75) for index in range(75)),
    )


KITCHEN = Room(
    "kitchen",
    "Kitchen",
    "p-kitchen",
    b"kitchen",
    ((0.0, 0.0), (2.0, 0.0), (2.0, 1.5), (0.0, 1.5)),
)
DEN_ROOM = Room("den", "Den", "p-den", b"den", _dense_square(3.0))
REMOTE = Room(
    "remote",
    "Remote",
    "p-remote",
    b"remote",
    ((20.0, 20.0), (21.0, 20.0), (21.0, 21.0), (20.0, 21.0)),
)
BASE = FloorPlan(7, "partition", b"partition", (KITCHEN, DEN_ROOM))


def _shifted(room: Room, dx: float) -> Room:
    return replace(room, boundary=tuple((x + dx, y) for x, y in room.boundary))


FLOORS = {
    "same": BASE,
    "remote_room_added": replace(BASE, rooms=(*BASE.rooms, REMOTE)),
    "remote_room_added_new_partition": replace(
        BASE,
        partition_protocol_id="partition-2",
        partition_id_wire=b"partition-2",
        rooms=(*BASE.rooms, REMOTE),
    ),
    "rooms_edited": replace(
        BASE,
        rooms=(
            replace(KITCHEN, boundary=((0.0, 0.0), (2.0, 0.0), (2.0, 1.2), (0.0, 1.2))),
            replace(DEN_ROOM, boundary=(*DEN_ROOM.boundary[:-1], (3.0, 0.9))),
        ),
    ),
    "map_translated": replace(
        BASE, rooms=tuple(_shifted(room, 0.5) for room in BASE.rooms)
    ),
    "other_floor": replace(BASE, mission_id=8),
}


def _area(
    binding: dict[str, Any], circles: list[dict[str, float]] | None = None
) -> dict[str, Any]:
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Area",
        "circles": deepcopy(
            circles or (DEN if binding["version"] in {4, 5, 6} else RUG)
        ),
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": deepcopy(binding),
    }


def _digest(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _command(area: dict[str, Any], floor_plan: FloorPlan) -> object:
    try:
        _, circles, _, _ = _validated_area_command(area, floor_plan, None, None)
    except ServiceValidationError as err:
        return err.translation_key
    return [list(circle) for circle in circles]


def _resolved(area: dict[str, Any], floor_plan: FloorPlan) -> dict[str, object]:
    (projected,) = _project_areas("entry", floor_plan, {"area": area}, None, ())[
        "areas"
    ]
    return {
        "status": area_binding_status(area, floor_plan).value,
        "review": area_binding_allows_review(area, floor_plan),
        "map": {
            "status": projected["status"].value,
            "can_rebind": projected["can_rebind"],
            "circles": projected["circles"],
        },
        "command": _command(area, floor_plan),
    }


def _frameless(circles: list[dict[str, float]]) -> dict[str, Any]:
    """Bind as the writer does when the rooms cannot be snapshotted."""
    with patch.object(
        geometry,
        "_translation_room_anchors",
        side_effect=geometry.GeometryTooComplex("synthetic anchor work exhausted"),
    ):
        return binding_for_area(BASE, circles)


async def _upgrade(hass, areas: dict[str, Any], floor_plan: FloorPlan):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot(SERIAL)["areas"].update(deepcopy(areas))
    plan_state.parse_robot(manager.repository.robot(SERIAL))
    result = await manager.catalog.async_upgrade_area_bindings(SERIAL, floor_plan)
    return manager, result


async def _upgraded(hass, areas: dict[str, Any], floor_plan: FloorPlan) -> object:
    manager, result = await _upgrade(hass, areas, floor_plan)
    saved = manager.repository.robot(SERIAL)["areas"]
    return {
        "upgraded": result.upgraded,
        "pending": result.pending,
        "saves": manager.repository.store.async_save.await_count,
        "bindings": {
            area_id: {
                "version": area["map_binding"]["version"],
                "sha256": _digest(area["map_binding"]),
            }
            for area_id, area in saved.items()
        },
    }


@pytest.mark.parametrize("version", VERSIONS)
async def test_stored_binding_resolves_and_upgrades_as_before(
    hass, version: str
) -> None:
    golden = json.loads(GOLDEN.read_text())
    area = _area(golden["stored"][version])
    observed = {
        "resolved": {
            name: _resolved(area, floor_plan) for name, floor_plan in FLOORS.items()
        },
        "upgrade": {
            name: await _upgraded(hass, {"area": area}, floor_plan)
            for name, floor_plan in FLOORS.items()
        },
    }
    assert observed == golden["pins"][version]


async def test_all_versions_upgrade_together_as_before(hass) -> None:
    golden = json.loads(GOLDEN.read_text())
    areas = {version: _area(binding) for version, binding in golden["stored"].items()}
    observed = {
        name: await _upgraded(hass, areas, floor_plan)
        for name, floor_plan in FLOORS.items()
    }
    assert observed == golden["together"]


def test_old_records_with_an_exact_v7_form_map_to_what_v7_writes() -> None:
    stored = json.loads(GOLDEN.read_text())["stored"]
    assert area_binding_legacy.exact_binding(stored["v3"]) == binding_for_area(
        BASE, RUG
    )
    assert area_binding_legacy.exact_binding(stored["v6"]) == binding_for_area(
        BASE, DEN
    )
    assert area_binding_legacy.exact_binding(stored["v4"]) == _frameless(DEN)
    for version in ("v1", "v2", "v3_unanchored", "v3_without_boundaries", "v5"):
        assert area_binding_legacy.exact_binding(stored[version]) is None


@pytest.mark.parametrize("version", VERSIONS)
async def test_converted_bindings_resolve_as_the_v7_writer_kinds(
    hass, version: str
) -> None:
    """Each conversion resolves on every floor as v3 or v6 always did."""
    golden = json.loads(GOLDEN.read_text())
    area = _area(golden["stored"][version])
    expected = golden["pins"]["v6" if area["circles"] == DEN else "v3"]["resolved"]
    for floor_plan in FLOORS.values():
        manager, result = await _upgrade(hass, {"area": area}, floor_plan)
        converted = manager.repository.robot(SERIAL)["areas"]["area"]
        if not result.upgraded:
            assert converted == area
            continue
        assert valid_binding(converted["map_binding"])
        assert {
            name: _resolved(converted, other) for name, other in FLOORS.items()
        } == expected


def test_v7_without_room_frames_resolves_as_v4() -> None:
    golden = json.loads(GOLDEN.read_text())
    area = _area(_frameless(DEN), DEN)
    assert "frame" not in area["map_binding"]
    assert {
        name: _resolved(area, floor_plan) for name, floor_plan in FLOORS.items()
    } == golden["pins"]["v4"]["resolved"]


def test_legacy_builders_reproduce_the_stored_records() -> None:
    stored = json.loads(GOLDEN.read_text())["stored"]
    assert {
        "v1": legacy_bindings.v1(BASE),
        "v2": legacy_bindings.v2(BASE, RUG),
        "v3_unanchored": legacy_bindings.unanchored(legacy_bindings.v3(BASE, RUG)),
        "v3_without_boundaries": legacy_bindings.without_boundaries(
            legacy_bindings.v3(BASE, RUG)
        ),
        "v3": legacy_bindings.v3(BASE, RUG),
        "v4": legacy_bindings.v4(BASE, DEN),
        "v5": legacy_bindings.v5(BASE, DEN),
        "v6": legacy_bindings.v6(BASE, DEN),
    } == stored
