"""Saved plans whose rooms a map edit removed from the robot's map."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import issue_registry as ir

from custom_components.matic_robot.client.models import FloorPlan, MappedFloor
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plan_room_repairs import (
    async_delete_plan_room_issue,
    async_sync_plan_room_issue,
    plan_room_issue_id,
)
from custom_components.matic_robot.plans import PlanRoomMissingError, resolve_rooms
from custom_components.matic_robot.services import (
    DELETE_PLAN_ROOM_SCHEMA,
    _plan_request_error,
)
from tests.test_plan_entries import (
    ROOM_MAP,
    SERIAL,
    _call,
    _floor,
    _manager,
    _room,
)
from tests.test_services import _registered_handler, _registered_services

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


async def _plan_manager(hass):
    manager = await _manager(hass)
    await manager.async_save_plan(
        SERIAL,
        "home",
        {
            "name": "Home",
            "rooms": [_room("room-kitchen"), _room("room-study"), _room("room-hall")],
        },
    )
    return manager


def _entry(floor: FloorPlan) -> SimpleNamespace:
    return SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            coordinator=MagicMock(data=SimpleNamespace(floor_plan=floor)),
            client=MagicMock(),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )


async def _call_service(hass, manager, service, data, room_map, entry=None):
    services = await _registered_services(hass, manager)
    entry = entry or _entry(_edited_floor())
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, SERIAL, dict(room_map)),
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(),
        ) as execute,
    ):
        result = await _registered_handler(services, service)(
            _call(hass, service, data)
        )
    return result, execute


def test_resolution_names_every_room_the_map_lost() -> None:
    raw = [_room("room-kitchen"), _room("room-study"), _room("room-hall")]

    with pytest.raises(PlanRoomMissingError) as raised:
        resolve_rooms(raw, EDITED_MAP)

    assert raised.value.room_ids == ("room-study", "room-hall")
    error = _plan_request_error(raised.value)
    assert error.translation_key == "plan_room_missing"
    assert error.translation_placeholders == {"rooms": "room-study, room-hall"}


async def test_running_the_plan_names_the_missing_rooms(hass) -> None:
    manager = await _plan_manager(hass)

    with pytest.raises(ServiceValidationError) as raised:
        await _call_service(
            hass, manager, "run_selected_plan", {"plan": "Home"}, EDITED_MAP
        )

    assert raised.value.translation_key == "plan_room_missing"
    assert raised.value.translation_placeholders == {"rooms": "room-study, room-hall"}


async def test_a_map_edit_during_start_names_the_missing_rooms(hass) -> None:
    manager = await _plan_manager(hass)
    entry = _entry(_floor())

    async def edit_map_then_validate(*_args, **kwargs) -> None:
        entry.runtime_data.coordinator.data.floor_plan = _edited_floor()
        kwargs["validate_prepared_run"]()

    services = await _registered_services(hass, manager)
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, SERIAL, dict(ROOM_MAP)),
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(side_effect=edit_map_then_validate),
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(
            _call(hass, "run_selected_plan", {"plan": "Home"})
        )

    assert raised.value.translation_key == "plan_room_missing"


async def test_delete_plan_room_removes_a_room_the_map_lost(hass) -> None:
    manager = await _plan_manager(hass)

    for room_id in ("room-study", "room-hall"):
        removed, _execute = await _call_service(
            hass,
            manager,
            "delete_plan_room",
            DELETE_PLAN_ROOM_SCHEMA(
                {"entity_id": ["vacuum.test"], "plan": "Home", "room": room_id}
            ),
            EDITED_MAP,
        )
        assert removed["deleted"]["room_id"] == room_id

    plan = manager.plan(SERIAL, "home")
    assert [room["room_id"] for room in plan["rooms"]] == ["room-kitchen"]
    _result, execute = await _call_service(
        hass, manager, "run_selected_plan", {"plan": "Home"}, EDITED_MAP
    )
    execute.assert_awaited_once()


async def test_delete_plan_room_still_rejects_an_id_the_plan_lacks(hass) -> None:
    manager = await _plan_manager(hass)

    with pytest.raises(ServiceValidationError) as raised:
        await _call_service(
            hass,
            manager,
            "delete_plan_room",
            DELETE_PLAN_ROOM_SCHEMA(
                {"entity_id": ["vacuum.test"], "plan": "Home", "room": "room-attic"}
            ),
            EDITED_MAP,
        )

    assert raised.value.translation_key == "unknown_rooms"


def _plans(**overrides) -> dict:
    plans = {
        "home": {
            "name": "Home",
            "rooms": [_room("room-kitchen"), _room("room-study")],
        },
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

    # Fixing the plan clears it.
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
