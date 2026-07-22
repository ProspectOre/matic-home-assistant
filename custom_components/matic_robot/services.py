"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import Any

import voluptuous as vol
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import (
    ATTR_AREA_ID,
    ATTR_DEVICE_ID,
    ATTR_ENTITY_ID,
    ATTR_FLOOR_ID,
    ATTR_LABEL_ID,
    STATE_UNAVAILABLE,
)
from homeassistant.core import (
    Event,
    EventStateChangedData,
    HomeAssistant,
    ServiceCall,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import target
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import slugify

from .client.commands import CleaningMode, CoverageSetting
from .client.endpoints import HERMES_ENDPOINT_MAP, HERMES_ENDPOINT_NAMES
from .client.exceptions import MaticError
from .client.floor_plan import pose_vector_paths
from .const import (
    DATA_FIRMWARE_TRACKER,
    DATA_PLAN_MANAGER,
    DOMAIN,
)
from .firmware import (
    FirmwareTracker,
    async_build_firmware_snapshot,
    fingerprint_entry,
)
from .plans import CleaningPlanManager, CleaningRoom, resolve_rooms

SERVICE_CLEAN = "clean"
SERVICE_INTELLIGENT_CLEAN = "intelligent_clean"
SERVICE_CLEAN_ENTIRE_PLAN = "clean_entire_plan"
SERVICE_RUN_SELECTED_PLAN = "run_selected_plan"
SERVICE_PREVIEW_PLAN = "preview_plan"
SERVICE_STOP_INTELLIGENT_CLEANING = "stop_intelligent_cleaning"
SERVICE_RESET_PLAN_HISTORY = "reset_plan_history"
SERVICE_LIST_PLANS = "list_plans"
SERVICE_SAVE_PLAN = "save_plan"
SERVICE_DELETE_PLAN = "delete_plan"
SERVICE_SELECT_PLAN = "select_plan"
SERVICE_SAVE_PLAN_ROOM = "save_plan_room"
SERVICE_DELETE_PLAN_ROOM = "delete_plan_room"
SERVICE_MOVE_PLAN_ROOM = "move_plan_room"
SERVICE_INSPECT_HERMES_ENDPOINT = "inspect_hermes_endpoint"
SERVICE_FIRMWARE_SNAPSHOT = "firmware_snapshot"
TARGET_KEYS = (
    ATTR_ENTITY_ID,
    ATTR_DEVICE_ID,
    ATTR_AREA_ID,
    ATTR_FLOOR_ID,
    ATTR_LABEL_ID,
)

CLEAN_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional("rooms"): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("cleaning_mode"): vol.In([value.value for value in CleaningMode]),
        vol.Optional("coverage_setting"): vol.In(
            [value.value for value in CoverageSetting]
        ),
        vol.Optional("ordered", default=False): cv.boolean,
    }
)

SAVED_ROOM_SCHEMA = vol.Schema(
    {
        vol.Required("room"): cv.string,
        vol.Optional("cleaning_mode", default=CleaningMode.BOTH.value): vol.In(
            [value.value for value in CleaningMode]
        ),
        vol.Optional(
            "coverage_setting", default=CoverageSetting.STANDARD.value
        ): vol.In([value.value for value in CoverageSetting]),
    }
)

SAVED_PLAN_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {vol.Optional("plan"): vol.All(cv.string, vol.Length(min=1, max=128))}
)

PLAN_TARGET_SCHEMA = cv.make_entity_service_schema({})

RESET_PLAN_HISTORY_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional("plan"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Optional("all_plans", default=False): cv.boolean,
    }
)

LIST_PLANS_SCHEMA = cv.make_entity_service_schema({})

SAVE_PLAN_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional("plan_id"): vol.All(cv.string, vol.Length(min=1, max=64)),
        vol.Required("name"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Optional("enabled", default=True): cv.boolean,
        vol.Optional("run_behavior", default="intelligent"): vol.In(
            ("intelligent", "ordered")
        ),
        vol.Required("rooms"): vol.All(
            cv.ensure_list, [SAVED_ROOM_SCHEMA], vol.Length(min=1, max=100)
        ),
        vol.Optional("return_to_base", default=True): cv.boolean,
        vol.Optional("finish_current_room", default=False): cv.boolean,
        vol.Optional("finish_current_room_threshold", default=50): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=100)
        ),
        vol.Optional("start_timeout", default=120): vol.All(
            vol.Coerce(int), vol.Range(min=10, max=600)
        ),
        vol.Optional("completion_timeout", default=21600): vol.All(
            vol.Coerce(int), vol.Range(min=60, max=43200)
        ),
        vol.Optional("select", default=True): cv.boolean,
    }
)

PLAN_REFERENCE_SCHEMA = cv.make_entity_service_schema(
    {vol.Required("plan"): vol.All(cv.string, vol.Length(min=1, max=128))}
)

SAVE_PLAN_ROOM_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required("plan"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Required("room"): SAVED_ROOM_SCHEMA,
    }
)

DELETE_PLAN_ROOM_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required("plan"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Required("room"): cv.string,
    }
)

MOVE_PLAN_ROOM_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required("plan"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Required("room"): cv.string,
        vol.Required("new_position"): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=100)
        ),
    }
)

INSPECT_ENDPOINT_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required("endpoint"): vol.In(HERMES_ENDPOINT_NAMES),
        vol.Optional("limit", default=32): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=256)
        ),
    }
)

FIRMWARE_SNAPSHOT_SCHEMA = cv.make_entity_service_schema({})


async def async_register_services(hass: HomeAssistant) -> None:
    """Register actions before any config entry is loaded."""

    manager = CleaningPlanManager(hass)
    await manager.async_load()
    hass.data.setdefault(DOMAIN, {})[DATA_PLAN_MANAGER] = manager
    firmware_tracker = FirmwareTracker(hass)
    await firmware_tracker.async_load()
    hass.data[DOMAIN][DATA_FIRMWARE_TRACKER] = firmware_tracker

    async def async_clean(call: ServiceCall) -> None:
        """Route the complete verified cleaning matrix to selected vacuums."""
        entity_ids = _resolve_loaded_matic_vacuums(hass, call)
        rooms = call.data.get("rooms")
        params: dict[str, Any] = {"ordered": call.data["ordered"]}
        if cleaning_mode := call.data.get("cleaning_mode"):
            params["cleaning_mode"] = cleaning_mode
        if coverage_setting := call.data.get("coverage_setting"):
            params["coverage"] = coverage_setting
        if rooms is None:
            command = "clean_all"
        else:
            command = "clean_rooms"
            params["rooms"] = rooms

        await hass.services.async_call(
            VACUUM_DOMAIN,
            "send_command",
            {
                ATTR_ENTITY_ID: entity_ids,
                "command": command,
                "params": params,
            },
            blocking=True,
            context=call.context,
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAN,
        async_clean,
        schema=CLEAN_SERVICE_SCHEMA,
    )

    async def async_run_saved_plan(call: ServiceCall, *, intelligent: bool) -> None:
        """Resolve and run every room in a saved plan."""
        entity_id, _entry, serial_number, room_map = _saved_plan_context(hass, call)
        try:
            plan, rooms = manager.rooms_for_plan(
                serial_number, room_map, call.data.get("plan")
            )
        except KeyError as err:
            raise _validation_error(
                f"Unknown Matic cleaning plan: {err.args[0]}",
                "unknown_plan",
                {"plan": str(err.args[0])},
            ) from err
        except ValueError as err:
            raise _validation_error(
                str(err), "invalid_plan", {"error": str(err)}
            ) from err
        data = {
            "plan_id": plan["id"],
            "start_timeout": int(plan.get("start_timeout", 120)),
            "completion_timeout": int(plan.get("completion_timeout", 21600)),
            "return_to_base": bool(plan.get("return_to_base", True)),
        }
        execution_call = ServiceCall(
            hass, DOMAIN, call.service, data, context=call.context
        )
        await _async_execute_rooms(
            hass,
            execution_call,
            manager,
            entity_id,
            serial_number,
            rooms,
            intelligent=intelligent,
        )

    async def async_intelligent_clean(call: ServiceCall) -> None:
        """Continue a plan with the rooms that have waited longest."""
        await async_run_saved_plan(call, intelligent=True)

    async def async_clean_entire_plan(call: ServiceCall) -> None:
        """Clean every room in the plan's saved order."""
        await async_run_saved_plan(call, intelligent=False)

    async def async_run_selected_plan(call: ServiceCall) -> None:
        """Run a saved plan using its configured default behavior."""
        _entity_id, _entry, serial_number, _room_map = _saved_plan_context(hass, call)
        try:
            plan = manager.plan(serial_number, call.data.get("plan"))
        except KeyError as err:
            raise _validation_error(
                f"Unknown Matic cleaning plan: {err.args[0]}",
                "unknown_plan",
                {"plan": str(err.args[0])},
            ) from err
        await async_run_saved_plan(
            call,
            intelligent=plan.get("run_behavior", "intelligent") == "intelligent",
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_INTELLIGENT_CLEAN,
        async_intelligent_clean,
        schema=SAVED_PLAN_SERVICE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAN_ENTIRE_PLAN,
        async_clean_entire_plan,
        schema=SAVED_PLAN_SERVICE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_RUN_SELECTED_PLAN,
        async_run_selected_plan,
        schema=SAVED_PLAN_SERVICE_SCHEMA,
    )

    async def async_preview_plan(call: ServiceCall) -> dict[str, Any]:
        """Validate and return the exact next saved-plan execution."""
        entity_id, _entry, serial_number, room_map = _saved_plan_context(hass, call)
        try:
            preview = manager.preview(
                serial_number,
                room_map,
                call.data.get("plan"),
            )
        except KeyError as err:
            raise _validation_error(
                f"Unknown Matic cleaning plan: {err.args[0]}",
                "unknown_plan",
                {"plan": str(err.args[0])},
            ) from err
        except ValueError as err:
            raise _validation_error(
                str(err), "invalid_plan", {"error": str(err)}
            ) from err
        return {"entity_id": entity_id, **preview}

    hass.services.async_register(
        DOMAIN,
        SERVICE_PREVIEW_PLAN,
        async_preview_plan,
        schema=SAVED_PLAN_SERVICE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_stop_intelligent_cleaning(call: ServiceCall) -> None:
        """Apply the active plan's stop policy and send the robot home."""
        entity_id, _entry, serial_number, _room_map = _saved_plan_context(hass, call)
        decision = manager.request_stop(serial_number)
        if decision.behavior == "not_running":
            raise _validation_error(
                "No managed Matic cleaning plan is running", "plan_not_running"
            )
        if decision.behavior == "after_room":
            return
        await hass.services.async_call(
            VACUUM_DOMAIN,
            "return_to_base",
            {ATTR_ENTITY_ID: entity_id},
            blocking=True,
            context=call.context,
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_STOP_INTELLIGENT_CLEANING,
        async_stop_intelligent_cleaning,
        schema=PLAN_TARGET_SCHEMA,
    )

    async def async_reset_plan_history(call: ServiceCall) -> None:
        """Reset selected or explicitly named durable rotation history."""
        _entity_id, _entry, serial_number, _room_map = _saved_plan_context(hass, call)
        plan_id: str | None = None
        if not call.data["all_plans"]:
            try:
                plan_id = manager.plan(serial_number, call.data.get("plan"))["id"]
            except KeyError as err:
                raise _validation_error(
                    f"Unknown Matic cleaning plan: {err.args[0]}",
                    "unknown_plan",
                    {"plan": str(err.args[0])},
                ) from err
        await manager.async_reset_history(serial_number, plan_id)

    hass.services.async_register(
        DOMAIN,
        SERVICE_RESET_PLAN_HISTORY,
        async_reset_plan_history,
        schema=RESET_PLAN_HISTORY_SCHEMA,
    )

    async def async_list_plans(call: ServiceCall) -> dict[str, Any]:
        """Return every canonical plan definition and current selection."""
        entity_id, _entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_rooms=False
        )
        snapshot = manager.snapshot(serial_number)
        return {
            "entity_id": entity_id,
            "selected_plan": snapshot.get("selected_plan"),
            "room_count": len(room_map),
            "plans": [
                {"id": plan_id, **plan}
                for plan_id, plan in manager.plans(serial_number).items()
            ],
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_LIST_PLANS,
        async_list_plans,
        schema=LIST_PLANS_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_save_plan(call: ServiceCall) -> dict[str, Any]:
        """Create or atomically replace a complete saved plan."""
        _entity_id, _entry, serial_number, room_map = _saved_plan_context(hass, call)
        plan_id = call.data.get("plan_id") or slugify(call.data["name"])
        if not plan_id or plan_id == "unknown":
            raise _validation_error(
                "Plan ID is empty", "invalid_plan", {"error": "Plan ID is empty"}
            )
        rooms = [_normalize_saved_room(room, room_map) for room in call.data["rooms"]]
        plan = {
            "name": call.data["name"],
            "enabled": call.data["enabled"],
            "run_behavior": call.data["run_behavior"],
            "rooms": rooms,
            "room_order": [room["room_id"] for room in rooms],
            "return_to_base": call.data["return_to_base"],
            "finish_current_room": call.data["finish_current_room"],
            "finish_current_room_threshold": call.data["finish_current_room_threshold"],
            "start_timeout": call.data["start_timeout"],
            "completion_timeout": call.data["completion_timeout"],
        }
        await manager.async_save_plan(
            serial_number, plan_id, plan, select=call.data["select"]
        )
        return {"plan": {"id": plan_id, **deepcopy(plan)}}

    hass.services.async_register(
        DOMAIN,
        SERVICE_SAVE_PLAN,
        async_save_plan,
        schema=SAVE_PLAN_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_delete_plan(call: ServiceCall) -> dict[str, Any]:
        """Delete one plan by ID or human-readable name."""
        _entity_id, _entry, serial_number, _room_map = _saved_plan_context(
            hass, call, require_rooms=False
        )
        plan = _resolve_saved_plan(manager, serial_number, call.data["plan"])
        await manager.async_delete_plan(serial_number, plan["id"])
        return {"deleted_plan_id": plan["id"]}

    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_PLAN,
        async_delete_plan,
        schema=PLAN_REFERENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_select_plan(call: ServiceCall) -> dict[str, Any]:
        """Choose the plan used by native plan entities and buttons."""
        _entity_id, _entry, serial_number, _room_map = _saved_plan_context(
            hass, call, require_rooms=False
        )
        plan = _resolve_saved_plan(manager, serial_number, call.data["plan"])
        await manager.async_select_plan(serial_number, plan["id"])
        return {"selected_plan_id": plan["id"], "selected_plan_name": plan["name"]}

    hass.services.async_register(
        DOMAIN,
        SERVICE_SELECT_PLAN,
        async_select_plan,
        schema=PLAN_REFERENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_save_plan_room(call: ServiceCall) -> dict[str, Any]:
        """Append or replace one mapped room and its settings."""
        _entity_id, _entry, serial_number, room_map = _saved_plan_context(hass, call)
        plan = _resolve_saved_plan(manager, serial_number, call.data["plan"])
        room = _normalize_saved_room(call.data["room"], room_map)
        position = next(
            (
                index
                for index, saved in enumerate(plan["rooms"])
                if saved["room_id"] == room["room_id"]
            ),
            None,
        )
        if position is None:
            plan["rooms"].append(room)
            position = len(plan["rooms"]) - 1
        else:
            plan["rooms"][position] = room
        plan_id = plan.pop("id")
        await manager.async_save_plan(serial_number, plan_id, plan, select=False)
        return {"plan_id": plan_id, "position": position + 1, "room": room}

    hass.services.async_register(
        DOMAIN,
        SERVICE_SAVE_PLAN_ROOM,
        async_save_plan_room,
        schema=SAVE_PLAN_ROOM_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_delete_plan_room(call: ServiceCall) -> dict[str, Any]:
        """Delete one mapped room from a plan."""
        _entity_id, _entry, serial_number, room_map = _saved_plan_context(hass, call)
        plan = _resolve_saved_plan(manager, serial_number, call.data["plan"])
        room_id = _resolve_room_id(call.data["room"], room_map)
        deleted = next(
            (room for room in plan["rooms"] if room["room_id"] == room_id), None
        )
        if deleted is None:
            raise _validation_error(
                f"Room is not part of this plan: {call.data['room']}",
                "unknown_rooms",
                {"rooms": str(call.data["room"])},
            )
        plan["rooms"].remove(deleted)
        if not plan["rooms"]:
            plan["enabled"] = False
        plan_id = plan.pop("id")
        await manager.async_save_plan(serial_number, plan_id, plan, select=False)
        return {"plan_id": plan_id, "deleted": deleted}

    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_PLAN_ROOM,
        async_delete_plan_room,
        schema=DELETE_PLAN_ROOM_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_move_plan_room(call: ServiceCall) -> dict[str, Any]:
        """Move one mapped room to an exact one-based position."""
        _entity_id, _entry, serial_number, room_map = _saved_plan_context(hass, call)
        plan = _resolve_saved_plan(manager, serial_number, call.data["plan"])
        room_id = _resolve_room_id(call.data["room"], room_map)
        room_count = len(plan["rooms"])
        position = next(
            (
                index + 1
                for index, room in enumerate(plan["rooms"])
                if room["room_id"] == room_id
            ),
            0,
        )
        new_position = call.data["new_position"]
        if position == 0:
            raise _validation_error(
                f"Room is not part of this plan: {call.data['room']}",
                "unknown_rooms",
                {"rooms": str(call.data["room"])},
            )
        if not 1 <= new_position <= room_count:
            raise _invalid_room_position(new_position, room_count)
        room = plan["rooms"].pop(position - 1)
        plan["rooms"].insert(new_position - 1, room)
        plan_id = plan.pop("id")
        await manager.async_save_plan(serial_number, plan_id, plan, select=False)
        return {
            "plan_id": plan_id,
            "previous_position": position,
            "position": new_position,
            "room": room,
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_MOVE_PLAN_ROOM,
        async_move_plan_room,
        schema=MOVE_PLAN_ROOM_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_inspect_endpoint(call: ServiceCall) -> dict[str, Any]:
        """Return payload-free fingerprints from the Hermes allowlist."""
        entity_ids = _resolve_loaded_matic_vacuums(hass, call)
        if len(entity_ids) != 1:
            raise _validation_error(
                "Hermes endpoint inspection requires exactly one Matic robot",
                "single_robot_required",
            )
        entry = _entry_for_entity(hass, entity_ids[0])
        endpoint_name = call.data["endpoint"]
        endpoint = HERMES_ENDPOINT_MAP[endpoint_name]
        values = await entry.runtime_data.client.async_inspect_endpoint(
            endpoint_name, limit=call.data["limit"]
        )
        response: dict[str, Any] = {
            "endpoint": endpoint_name,
            "kind": endpoint.kind,
            "sensitivity": endpoint.sensitivity,
            "entry_count": len(values),
            "limit": call.data["limit"],
            "entries": [fingerprint_entry(value) for value in values],
        }
        if endpoint_name == "latest_pose":
            response["pose_vector_paths"] = [
                list(path)
                for value in values
                for path in pose_vector_paths(value.value)
            ]
        return response

    hass.services.async_register(
        DOMAIN,
        SERVICE_INSPECT_HERMES_ENDPOINT,
        async_inspect_endpoint,
        schema=INSPECT_ENDPOINT_SERVICE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_firmware_snapshot(call: ServiceCall) -> dict[str, Any]:
        """Capture and persist one payload-free compatibility snapshot."""
        entity_ids = _resolve_loaded_matic_vacuums(hass, call)
        if len(entity_ids) != 1:
            raise _validation_error(
                "Firmware snapshots require exactly one Matic robot",
                "single_robot_required",
            )
        entry = _entry_for_entity(hass, entity_ids[0])
        state = entry.runtime_data.coordinator.data
        snapshot = await async_build_firmware_snapshot(entry.runtime_data.client, state)
        comparison = await firmware_tracker.async_record_snapshot(
            entry.entry_id, snapshot
        )
        return {**snapshot, "comparison": comparison}

    hass.services.async_register(
        DOMAIN,
        SERVICE_FIRMWARE_SNAPSHOT,
        async_firmware_snapshot,
        schema=FIRMWARE_SNAPSHOT_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )


async def _async_run_room(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    room: CleaningRoom,
    cancel_event: asyncio.Event | None = None,
) -> None:
    """Run one mapped room and advance history only after completion."""
    event_data = {
        ATTR_ENTITY_ID: entity_id,
        "plan_id": call.data["plan_id"],
        "room_id": room.room_id,
        "room": room.name,
        "cleaning_mode": room.cleaning_mode,
        "coverage_setting": room.coverage_setting,
    }
    await manager.async_mark_started(serial_number, call.data["plan_id"], room)
    hass.bus.async_fire(f"{DOMAIN}_room_started", event_data, context=call.context)
    try:
        await hass.services.async_call(
            VACUUM_DOMAIN,
            "send_command",
            {
                ATTR_ENTITY_ID: entity_id,
                "command": "clean_rooms",
                "params": {
                    "rooms": [room.room_id],
                    "cleaning_mode": room.cleaning_mode,
                    "coverage": room.coverage_setting,
                    "ordered": False,
                },
            },
            blocking=True,
            context=call.context,
        )
        await _async_wait_for_vacuum_state(
            hass,
            entity_id,
            {"cleaning", "paused"},
            call.data["start_timeout"],
            cancel_event,
        )
        await _async_wait_for_vacuum_state(
            hass,
            entity_id,
            {"docked", "idle"},
            call.data["completion_timeout"],
            cancel_event,
        )
    except PlanCancelledError:
        await manager.async_mark_cancelled(serial_number, call.data["plan_id"], room)
        hass.bus.async_fire(
            f"{DOMAIN}_room_cancelled", event_data, context=call.context
        )
        raise
    except (TimeoutError, HomeAssistantError, MaticError) as err:
        await manager.async_mark_failed(
            serial_number, call.data["plan_id"], room, str(err)
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_failed",
            {**event_data, "error": str(err)},
            context=call.context,
        )
        if isinstance(err, (ServiceValidationError, MaticError)):
            raise
        if isinstance(err, TimeoutError):
            raise _validation_error(
                f"Timed out while cleaning {room.name}",
                "plan_timeout",
                {"room": room.name},
            ) from err
        raise

    await manager.async_mark_completed(serial_number, call.data["plan_id"], room)
    hass.bus.async_fire(f"{DOMAIN}_room_completed", event_data, context=call.context)


async def _async_wait_for_vacuum_state(
    hass: HomeAssistant,
    entity_id: str,
    desired: set[str],
    timeout_seconds: int,
    cancel_event: asyncio.Event | None = None,
) -> str:
    """Wait for an expected vacuum state and fail on verified robot errors.

    A coordinator refresh can make an entity briefly unavailable even after the
    robot accepted a command.  Keep waiting through that transport condition;
    the enclosing timeout remains the hard limit.  The vacuum ``error`` state,
    by contrast, comes from verified robot error codes and is terminal.
    """
    failed = {"error"}
    if (state := hass.states.get(entity_id)) is not None:
        if state.state in failed:
            raise _validation_error(
                "The selected Matic robot reported an error",
                "robot_error",
            )
        if state.state in desired:
            return state.state

    future: asyncio.Future[str] = hass.loop.create_future()

    @callback
    def state_changed(event: Event[EventStateChangedData]) -> None:
        new_state = event.data["new_state"]
        if new_state is None or future.done():
            return
        if new_state.state in failed:
            future.set_exception(
                _validation_error(
                    "The selected Matic robot reported an error",
                    "robot_error",
                )
            )
        elif new_state.state in desired:
            future.set_result(new_state.state)

    remove_listener = async_track_state_change_event(hass, entity_id, state_changed)
    cancel_wait: asyncio.Task[bool] | None = None
    try:
        async with asyncio.timeout(timeout_seconds):
            if cancel_event is None:
                return await future
            cancel_wait = asyncio.create_task(cancel_event.wait())
            waiters: set[asyncio.Future[Any]] = {future, cancel_wait}
            done, _pending = await asyncio.wait(
                waiters, return_when=asyncio.FIRST_COMPLETED
            )
            if cancel_wait in done and cancel_wait.result():
                if not future.done():
                    future.cancel()
                raise PlanCancelledError
            cancel_wait.cancel()
            return future.result()
    finally:
        if cancel_wait is not None:
            cancel_wait.cancel()
        remove_listener()


class PlanCancelledError(HomeAssistantError):
    """An operator cancelled a managed cleaning plan."""


async def _async_execute_rooms(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    rooms: list[CleaningRoom],
    *,
    intelligent: bool,
) -> None:
    """Execute every resolved room with safe cancellation semantics."""
    lock = manager.lock(serial_number)
    if lock.locked():
        raise _validation_error(
            "A managed Matic cleaning plan is already running", "plan_already_running"
        )
    async with lock:
        cancel_event = manager.prepare_run(serial_number)
        finish_room_event = manager.finish_room_event(serial_number)
        chosen = (
            manager.choose(serial_number, call.data["plan_id"], rooms)
            if intelligent
            else rooms
        )
        try:
            for room in chosen:
                if cancel_event.is_set():
                    raise PlanCancelledError
                await _async_run_room(
                    hass,
                    call,
                    manager,
                    entity_id,
                    serial_number,
                    room,
                    cancel_event,
                )
                if finish_room_event.is_set():
                    break
        except PlanCancelledError:
            return
        if (
            (call.data["return_to_base"] or finish_room_event.is_set())
            and (current := hass.states.get(entity_id)) is not None
            and current.state not in {"docked", "returning"}
        ):
            await hass.services.async_call(
                VACUUM_DOMAIN,
                "return_to_base",
                {ATTR_ENTITY_ID: entity_id},
                blocking=True,
                context=call.context,
            )


def _saved_plan_context(
    hass: HomeAssistant,
    call: ServiceCall,
    *,
    require_rooms: bool = True,
) -> tuple[str, ConfigEntry[Any], str, dict[str, str]]:
    """Resolve one loaded robot and its current stable room inventory."""
    entity_ids = _resolve_loaded_matic_vacuums(hass, call)
    if len(entity_ids) != 1:
        raise _validation_error(
            "Saved cleaning plans require exactly one Matic robot",
            "single_robot_required",
        )
    entity_id = entity_ids[0]
    entry = _entry_for_entity(hass, entity_id)
    data = entry.runtime_data.coordinator.data
    serial_number = data.info.serial_number
    room_map = (
        {room.id: room.name for room in data.floor_plan.rooms}
        if data.floor_plan is not None
        else {}
    )
    if require_rooms and not room_map:
        raise _validation_error(
            "The robot's room map is unavailable", "room_plan_unavailable"
        )
    return entity_id, entry, serial_number, room_map


def _resolve_saved_plan(
    manager: CleaningPlanManager, serial_number: str, reference: str
) -> dict[str, Any]:
    """Resolve a plan reference and produce a localized action error."""
    try:
        return manager.plan(serial_number, reference)
    except KeyError as err:
        raise _validation_error(
            f"Unknown Matic cleaning plan: {reference}",
            "unknown_plan",
            {"plan": reference},
        ) from err


def _normalize_saved_room(
    room: dict[str, Any], room_map: dict[str, str]
) -> dict[str, Any]:
    """Resolve one mapped room and preserve its individual preferences."""
    raw = dict(room)
    try:
        resolved = resolve_rooms([raw], room_map)[0]
    except ValueError as err:
        raise _validation_error(
            f"Unknown Matic room(s): {err}",
            "unknown_rooms",
            {"rooms": str(err)},
        ) from err
    return {
        "room_id": resolved.room_id,
        "cleaning_mode": resolved.cleaning_mode,
        "coverage_setting": resolved.coverage_setting,
    }


def _resolve_room_id(identifier: str, room_map: dict[str, str]) -> str:
    """Resolve one live room ID or display name."""
    folded = identifier.casefold()
    for room_id, room_name in room_map.items():
        if folded in {room_id.casefold(), room_name.casefold()}:
            return room_id
    raise _validation_error(
        f"Unknown Matic room: {identifier}",
        "unknown_rooms",
        {"rooms": identifier},
    )


def _invalid_room_position(position: int, room_count: int) -> ServiceValidationError:
    return _validation_error(
        f"Room position {position} is invalid; expected 1 through {room_count}",
        "invalid_plan",
        {"error": f"room position must be between 1 and {room_count}"},
    )


def _resolve_loaded_matic_vacuums(hass: HomeAssistant, call: ServiceCall) -> list[str]:
    """Resolve every target form and reject missing or unloaded robots."""
    selection = target.TargetSelection(
        {key: call.data[key] for key in TARGET_KEYS if key in call.data}
    )
    referenced = target.async_extract_referenced_entity_ids(hass, selection, True)
    requested = referenced.referenced | referenced.indirectly_referenced
    registry = er.async_get(hass)
    entity_ids: list[str] = []
    for entity_id in requested:
        entity = registry.async_get(entity_id)
        if (
            entity is None
            or entity.platform != DOMAIN
            or not entity_id.startswith(f"{VACUUM_DOMAIN}.")
        ):
            continue
        entry = (
            hass.config_entries.async_get_entry(entity.config_entry_id)
            if entity.config_entry_id
            else None
        )
        state = hass.states.get(entity_id)
        if (
            entry is None
            or entry.state is not ConfigEntryState.LOADED
            or state is None
            or state.state == STATE_UNAVAILABLE
        ):
            raise ServiceValidationError(
                "The selected Matic robot is unavailable",
                translation_domain=DOMAIN,
                translation_key="robot_unavailable",
            )
        entity_ids.append(entity_id)

    if not entity_ids:
        raise ServiceValidationError(
            "Select at least one loaded Matic vacuum",
            translation_domain=DOMAIN,
            translation_key="no_robot_target",
        )
    return entity_ids


def _entry_for_entity(hass: HomeAssistant, entity_id: str) -> ConfigEntry[Any]:
    """Return the loaded typed Matic config entry behind a vacuum entity."""
    registry_entry = er.async_get(hass).async_get(entity_id)
    if registry_entry is None or registry_entry.config_entry_id is None:
        raise _validation_error(
            "The selected Matic robot is unavailable", "robot_unavailable"
        )
    entry = hass.config_entries.async_get_entry(registry_entry.config_entry_id)
    if entry is None:
        raise _validation_error(
            "The selected Matic robot is unavailable", "robot_unavailable"
        )
    return entry


def _validation_error(
    message: str,
    translation_key: str,
    placeholders: dict[str, str] | None = None,
) -> ServiceValidationError:
    return ServiceValidationError(
        message,
        translation_domain=DOMAIN,
        translation_key=translation_key,
        translation_placeholders=placeholders,
    )
