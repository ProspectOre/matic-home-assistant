"""Saved plans whose rooms a map edit removed from the robot's map.

tests/e2e/test_plan_missing_rooms.py runs the whole path against the
simulated robot; these cover the branches it does not reach.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import issue_registry as ir

from custom_components.matic_robot.client import FloorPlan, MappedFloor
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.execution_planning import _plan_rooms
from custom_components.matic_robot.plan_model import (
    PlanRoomMissingError,
    resolve_rooms,
)
from custom_components.matic_robot.plan_room_repairs import (
    async_delete_plan_room_issue,
    async_sync_plan_room_issue,
    plan_room_issue_id,
)
from custom_components.matic_robot.plan_views import MaticPlansView
from custom_components.matic_robot.service_execution import _require_unchanged_plan
from tests.test_plan_entries import _floor, _room
from tests.test_slam_scene import _entry, _hass, _request
from tests.test_view_wire import _plans_runtime

# The Matic app re-created the study with a new ID and removed the hall.
EDITED_MAP = {"room-kitchen": "Kitchen", "room-study-2": "Study"}


def _edited_floor(*, floors: int = 1) -> FloorPlan:
    floor = _floor()
    return FloorPlan(
        floor.mission_id,
        floor.partition_protocol_id,
        floor.partition_id_wire,
        tuple(room for room in floor.rooms if room.id == "room-kitchen"),
        mapped_floors=tuple(
            MappedFloor(floor.mission_id + index, f"Floor {index}", f"token-{index}")
            for index in range(floors)
        )
        if floors > 1
        else (),
    )


def test_resolution_names_every_room_the_map_lost() -> None:
    raw = [_room("room-kitchen"), _room("room-study"), _room("room-hall")]

    with pytest.raises(PlanRoomMissingError) as raised:
        resolve_rooms(raw, EDITED_MAP)

    assert raised.value.room_ids == ("room-study", "room-hall")


def test_an_area_plan_with_corrupt_rooms_is_refused() -> None:
    with pytest.raises(ValueError, match="invalid room"):
        _plan_rooms({"rooms": "room-kitchen"}, EDITED_MAP, require_rooms=False)


def test_a_map_edit_during_start_names_the_missing_rooms() -> None:
    preview = MagicMock(side_effect=PlanRoomMissingError(["room-study"]))

    with (
        patch(
            "custom_components.matic_robot.service_execution._current_floor_plan",
            return_value=_edited_floor(),
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        _require_unchanged_plan(MagicMock(), preview, "token")

    assert raised.value.translation_key == "plan_room_missing"
    assert raised.value.translation_placeholders == {"rooms": "room-study"}


async def test_matic_map_hears_which_blocker_stops_the_plan() -> None:
    runtime = _plans_runtime()
    runtime.cleaning_plans.planning.preview = MagicMock(
        side_effect=PlanRoomMissingError(["room-study"])
    )

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    assert {
        plan["next_run_preview"]["blocker"]
        for plan in json.loads(response.body)["plans"]
    } == {"room_missing"}


def _plans(**overrides: object) -> dict:
    plans: dict[str, object] = {
        "home": {"name": "Home", "rooms": [_room("room-kitchen"), _room("room-study")]},
        "kitchen": {"name": "Kitchen only", "rooms": [_room("room-kitchen")]},
        "off": {"name": "Off", "enabled": False, "rooms": [_room("room-hall")]},
        "broken": {"name": "Broken", "rooms": "room-hall"},
        "junk": "not a plan",
    }
    plans.update(overrides)
    return plans


def _issue(hass) -> ir.IssueEntry | None:
    return ir.async_get(hass).async_get_issue(DOMAIN, plan_room_issue_id("entry"))


async def test_repair_names_plans_with_rooms_off_the_map(hass) -> None:
    async_sync_plan_room_issue(hass, "entry", _plans(), _edited_floor())

    issue = _issue(hass)
    assert issue is not None
    assert issue.translation_key == "plan_room_missing"
    assert issue.translation_placeholders["plans"] == "Home"

    # Without a live map the issue stays as it was.
    async_sync_plan_room_issue(hass, "entry", {}, None)
    assert _issue(hass) is not None

    fixed = _plans(home={"name": "Home", "rooms": [_room("room-kitchen")]})
    async_sync_plan_room_issue(hass, "entry", fixed, _edited_floor())
    assert _issue(hass) is None


async def test_repair_skips_plans_for_another_mapped_floor(hass) -> None:
    upstairs = {"upstairs": {"name": "Upstairs", "rooms": [_room("room-attic")]}}

    async_sync_plan_room_issue(hass, "entry", upstairs, _edited_floor(floors=2))
    assert _issue(hass) is None

    # On a robot with one floor, the same plan has lost every room.
    async_sync_plan_room_issue(hass, "entry", upstairs, _edited_floor())
    assert _issue(hass) is not None

    async_delete_plan_room_issue(hass, "entry")
    assert _issue(hass) is None
