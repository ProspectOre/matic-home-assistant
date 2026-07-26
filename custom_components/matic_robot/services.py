"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import datetime
from enum import StrEnum
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
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

from .area_binding import AreaBindingStatus, area_binding_status
from .client.commands import CleaningMode, CoverageSetting, UserCommand
from .client.endpoints import HERMES_ENDPOINT_MAP, HERMES_ENDPOINT_NAMES
from .client.exceptions import MaticError
from .client.floor_plan import pose_vector_paths
from .client.models import CleaningSessionRecord, FloorPlan
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
from .plans import (
    PLAN_MOTION_TOKEN,
    CleaningPlanManager,
    CleaningRoom,
    ManagedMotionReplacedError,
    resolve_rooms,
)

SERVICE_CLEAN = "clean"
SERVICE_CLEAN_AREA = "clean_area"
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
ROOM_STATUS_REFRESH_SECONDS = 5
ACTIVE_SESSION_UNKNOWN_ATTEMPTS = 3
ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS = 1
SESSION_HISTORY_ATTEMPTS = 6
SESSION_HISTORY_RETRY_SECONDS = 2

_LOGGER = logging.getLogger(__name__)


class RoomRunOutcome(StrEnum):
    """Conservative result of one managed, single-room command."""

    HANDOFF_CANDIDATE = "handoff_candidate"
    SUSPENDED = "suspended"
    PAUSED = "paused"
    TAKEN_OVER = "taken_over"
    INTERRUPTED = "interrupted"


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

CLEAN_AREA_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required("area"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Optional("cleaning_mode"): vol.In([value.value for value in CleaningMode]),
        vol.Optional("coverage_setting"): vol.In(
            [value.value for value in CoverageSetting]
        ),
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

    async def async_clean_area(call: ServiceCall) -> None:
        """Clean one private saved area without putting coordinates in the call."""
        _entity_id, entry, serial_number, _room_map = _saved_plan_context(hass, call)
        try:
            area = manager.area(serial_number, call.data["area"])
        except KeyError as err:
            raise _validation_error(
                f"Unknown Matic custom area: {call.data['area']}",
                "unknown_area",
                {"area": str(call.data["area"])},
            ) from err
        _validated_area_command(
            area,
            entry.runtime_data.coordinator.data.floor_plan,
            call.data.get("cleaning_mode"),
            call.data.get("coverage_setting"),
        )

        async with manager.command_lock(serial_number):
            try:
                current_area = manager.area(serial_number, call.data["area"])
            except KeyError as err:
                raise _validation_error(
                    f"Unknown Matic custom area: {call.data['area']}",
                    "unknown_area",
                    {"area": str(call.data["area"])},
                ) from err
            floor_plan, circles, mode, coverage = _validated_area_command(
                current_area,
                entry.runtime_data.coordinator.data.floor_plan,
                call.data.get("cleaning_mode"),
                call.data.get("coverage_setting"),
            )
            manager.replace_managed_motion(serial_number)
            try:
                await entry.runtime_data.client.async_start_custom_coverage(
                    floor_plan,
                    circles,
                    cleaning_mode=mode,
                    coverage_setting=coverage,
                )
            except MaticError as err:
                raise _validation_error(
                    "The robot could not start the custom-area clean",
                    "robot_command_failed",
                ) from err
        await entry.runtime_data.coordinator.async_request_refresh()

    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAN_AREA,
        async_clean_area,
        schema=CLEAN_AREA_SERVICE_SCHEMA,
    )

    async def async_run_saved_plan(call: ServiceCall, *, intelligent: bool) -> None:
        """Resolve and run every room in a saved plan."""
        entity_id, entry, serial_number, room_map = _saved_plan_context(hass, call)
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

        async def async_managed_command(token: int, command: UserCommand) -> None:
            async with manager.managed_command(serial_number, token):
                await entry.runtime_data.client.async_send_user_command(command)
                await entry.runtime_data.coordinator.async_request_refresh()

        await _async_execute_rooms(
            hass,
            execution_call,
            manager,
            entity_id,
            serial_number,
            rooms,
            intelligent=intelligent,
            refresh=entry.runtime_data.coordinator.async_request_refresh,
            active_session=(
                entry.runtime_data.client.async_has_active_cleaning_session
            ),
            session_history=(
                entry.runtime_data.client.async_get_cleaning_session_records
            ),
            confirm_room_completed=(
                entry.runtime_data.coordinator.async_confirm_room_completed
            ),
            managed_user_command=async_managed_command,
            mapped_room_names=tuple(room_map.values()),
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
        entity_id, entry, serial_number, _room_map = _saved_plan_context(hass, call)
        decision = manager.request_stop(serial_number)
        if decision.behavior == "not_running":
            return
        if decision.behavior == "after_room":
            return
        entry.runtime_data.coordinator.async_discard_current_room()
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
    refresh: Callable[[], Awaitable[None]] | None = None,
    motion_token: int | None = None,
    active_session: Callable[[], Awaitable[bool | None]] | None = None,
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]]
    | None = None,
    confirm_room_completed: Callable[[str], None] | None = None,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None = None,
    room_name_is_unique: bool = True,
) -> None:
    """Run one room, separating safe handoff from completion credit."""
    if not room_name_is_unique:
        raise _validation_error(
            "Managed completion cannot distinguish duplicate mapped room names",
            "ambiguous_room_name",
            {"room": room.name},
        )
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
    history_baseline = await _async_session_history_baseline(session_history)
    dispatched_at = dt_util.utcnow()
    completion_verified = False
    dispatch_attempted = False
    try:
        params: dict[str, Any] = {
            "rooms": [room.room_id],
            "cleaning_mode": room.cleaning_mode,
            "coverage": room.coverage_setting,
            "ordered": False,
        }
        if motion_token is not None:
            params[PLAN_MOTION_TOKEN] = motion_token
        dispatch_attempted = True
        await hass.services.async_call(
            VACUUM_DOMAIN,
            "send_command",
            {
                ATTR_ENTITY_ID: entity_id,
                "command": "clean_rooms",
                "params": params,
            },
            blocking=True,
            context=call.context,
        )
        start_state = await _async_wait_for_vacuum_state(
            hass,
            entity_id,
            {"cleaning", "paused"},
            call.data["start_timeout"],
            cancel_event,
        )
        if start_state == "paused":
            await manager.async_mark_suspended(
                serial_number, call.data["plan_id"], room, "paused"
            )
            await _async_wait_for_vacuum_state(
                hass,
                entity_id,
                {"cleaning"},
                call.data["completion_timeout"],
                cancel_event,
            )
        await manager.async_mark_resumed(serial_number, call.data["plan_id"], room)
        refresh_task = (
            asyncio.create_task(_async_periodic_refresh(refresh))
            if refresh is not None
            else None
        )
        try:
            async with asyncio.timeout(call.data["completion_timeout"]):
                while True:
                    outcome = await _async_wait_for_room_outcome(
                        hass, entity_id, room, cancel_event
                    )
                    if outcome is RoomRunOutcome.HANDOFF_CANDIDATE:
                        session_active = await _async_active_session_state(
                            active_session
                        )
                        if session_active is False:
                            await manager.async_mark_verifying(
                                serial_number, call.data["plan_id"], room
                            )
                            completion_verified = await _async_verify_room_completion(
                                session_history,
                                history_baseline,
                                room,
                                dispatched_at,
                                hass=hass,
                                entity_id=entity_id,
                                cancel_event=cancel_event,
                            )
                            break
                        if session_active is None:
                            raise RoomInterruptedError(
                                f"{room.name} completion could not be verified"
                            )
                        await manager.async_mark_verifying(
                            serial_number, call.data["plan_id"], room
                        )
                        session_resolution = (
                            await _async_wait_for_active_session_resolution(
                                hass,
                                entity_id,
                                active_session,
                                cancel_event,
                            )
                        )
                        if session_resolution is False:
                            completion_verified = await _async_verify_room_completion(
                                session_history,
                                history_baseline,
                                room,
                                dispatched_at,
                                hass=hass,
                                entity_id=entity_id,
                                cancel_event=cancel_event,
                            )
                            break
                        if session_resolution is None:
                            raise RoomInterruptedError(
                                f"{room.name} completion could not be verified"
                            )
                        await manager.async_mark_resumed(
                            serial_number, call.data["plan_id"], room
                        )
                        continue
                    elif outcome is RoomRunOutcome.TAKEN_OVER:
                        raise RoomTakenOverError(
                            f"{room.name} was replaced by another cleaning task"
                        )
                    if outcome is RoomRunOutcome.INTERRUPTED:
                        raise RoomInterruptedError(
                            f"{room.name} stopped without verified completion"
                        )
                    if outcome is RoomRunOutcome.PAUSED:
                        suspend_reason = "paused"
                    elif outcome is RoomRunOutcome.SUSPENDED:
                        suspend_reason = "low_charge"
                    await manager.async_mark_suspended(
                        serial_number,
                        call.data["plan_id"],
                        room,
                        suspend_reason,
                    )
                    await _async_wait_for_vacuum_state(
                        hass,
                        entity_id,
                        {"cleaning"},
                        call.data["completion_timeout"],
                        cancel_event,
                    )
                    await manager.async_mark_resumed(
                        serial_number, call.data["plan_id"], room
                    )
        finally:
            if refresh_task is not None:
                refresh_task.cancel()
                await asyncio.gather(refresh_task, return_exceptions=True)
    except ManagedMotionReplacedError as err:
        await manager.async_mark_cancelled(serial_number, call.data["plan_id"], room)
        hass.bus.async_fire(
            f"{DOMAIN}_room_cancelled", event_data, context=call.context
        )
        raise PlanCancelledError from err
    except PlanCancelledError:
        if manager.cancellation_reason(serial_number) == "config_entry_unload":
            await _async_cleanup_managed_motion(
                managed_user_command, motion_token, dispatch_attempted
            )
            await manager.async_mark_interrupted(
                serial_number,
                call.data["plan_id"],
                room,
                "Home Assistant unloaded while cleaning this room",
            )
            hass.bus.async_fire(
                f"{DOMAIN}_room_interrupted", event_data, context=call.context
            )
        else:
            await manager.async_mark_cancelled(
                serial_number, call.data["plan_id"], room
            )
            hass.bus.async_fire(
                f"{DOMAIN}_room_cancelled", event_data, context=call.context
            )
        raise
    except RoomTakenOverError as err:
        await manager.async_mark_interrupted(
            serial_number, call.data["plan_id"], room, str(err)
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_interrupted",
            {**event_data, "error": str(err)},
            context=call.context,
        )
        raise _validation_error(
            "The managed room was replaced by another cleaning task",
            "room_taken_over",
            {"room": room.name},
        ) from err
    except RoomInterruptedError as err:
        await _async_cleanup_managed_motion(
            managed_user_command, motion_token, dispatch_attempted
        )
        await manager.async_mark_interrupted(
            serial_number, call.data["plan_id"], room, str(err)
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_interrupted",
            {**event_data, "error": str(err)},
            context=call.context,
        )
        raise _validation_error(
            str(err), "room_interrupted", {"room": room.name}
        ) from err
    except (TimeoutError, HomeAssistantError, MaticError) as err:
        await _async_cleanup_managed_motion(
            managed_user_command, motion_token, dispatch_attempted
        )
        failure_reason = (
            "The robot could not complete the managed room"
            if isinstance(err, MaticError)
            else str(err)
        )
        await manager.async_mark_failed(
            serial_number, call.data["plan_id"], room, failure_reason
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_failed",
            {**event_data, "error": failure_reason},
            context=call.context,
        )
        if isinstance(err, ServiceValidationError):
            raise
        if isinstance(err, MaticError):
            raise _validation_error(
                "The robot could not complete the managed room",
                "robot_command_failed",
                {"room": room.name},
            ) from err
        if isinstance(err, TimeoutError):
            raise _validation_error(
                f"Timed out while cleaning {room.name}",
                "plan_timeout",
                {"room": room.name},
            ) from err
        raise

    if completion_verified:
        await manager.async_mark_completed(serial_number, call.data["plan_id"], room)
        if confirm_room_completed is not None:
            confirm_room_completed(room.name)
        hass.bus.async_fire(
            f"{DOMAIN}_room_completed", event_data, context=call.context
        )
    else:
        await manager.async_mark_ended_unverified(
            serial_number, call.data["plan_id"], room
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_ended_unverified", event_data, context=call.context
        )


async def _async_wait_for_room_outcome(
    hass: HomeAssistant,
    entity_id: str,
    room: CleaningRoom,
    cancel_event: asyncio.Event | None = None,
) -> RoomRunOutcome:
    """Classify the next terminal transition using positive room evidence.

    A bare ``returning``, ``docked``, or ``idle`` state is deliberately not a
    completion.  Completion requires the issued single-room command to be seen
    cleaning that room before a normal return.  A low-charge return is a
    suspension so firmware may recharge and resume it.  Every other terminal
    transition is interrupted/unknown and receives no room-history credit.
    """
    observed_room = False
    future: asyncio.Future[RoomRunOutcome] = hass.loop.create_future()

    def classify(state: Any) -> None:
        nonlocal observed_room
        if state is None or future.done():
            return
        current_area = state.attributes.get("current_area")
        if state.state in {"cleaning", "paused"}:
            if _area_matches_room(current_area, room):
                observed_room = True
            elif observed_room and _is_known_room(
                current_area, state.attributes.get("rooms")
            ):
                future.set_result(RoomRunOutcome.TAKEN_OVER)
                return
            if state.state == "paused":
                future.set_result(RoomRunOutcome.PAUSED)
                return
        if state.state == "error":
            future.set_exception(
                _validation_error(
                    "The selected Matic robot reported an error", "robot_error"
                )
            )
        elif state.state == "returning":
            if state.attributes.get("low_charge") is True:
                future.set_result(RoomRunOutcome.SUSPENDED)
            elif observed_room:
                future.set_result(RoomRunOutcome.HANDOFF_CANDIDATE)
            else:
                future.set_result(RoomRunOutcome.INTERRUPTED)
        elif state.state in {"docked", "idle"}:
            future.set_result(RoomRunOutcome.INTERRUPTED)

    @callback
    def state_changed(event: Event[EventStateChangedData]) -> None:
        classify(event.data["new_state"])

    remove_listener = async_track_state_change_event(hass, entity_id, state_changed)
    classify(hass.states.get(entity_id))
    cancel_wait: asyncio.Task[bool] | None = None
    try:
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


async def _async_active_session_state(
    reader: Callable[[], Awaitable[bool | None]] | None,
) -> bool | None:
    """Resolve active-task presence with a small bounded unknown retry window."""
    if reader is None:
        return None
    for attempt in range(ACTIVE_SESSION_UNKNOWN_ATTEMPTS):
        state = await reader()
        if state is not None:
            return state
        if attempt + 1 < ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
            await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
    return None


async def _async_session_history_baseline(
    reader: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
) -> frozenset[bytes] | None:
    """Capture opaque native keys before dispatch without exposing their values."""
    if reader is None:
        return None
    try:
        return frozenset(record.key for record in await reader())
    except MaticError as err:
        _LOGGER.debug(
            "Native Matic completion baseline unavailable (%s)", type(err).__name__
        )
        return None


async def _async_verify_room_completion(
    reader: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
    baseline: frozenset[bytes] | None,
    room: CleaningRoom,
    dispatched_at: datetime,
    *,
    hass: HomeAssistant | None = None,
    entity_id: str | None = None,
    cancel_event: asyncio.Event | None = None,
) -> bool:
    """Require one new, completed, overlapping native single-room record."""
    if reader is None or baseline is None:
        return False
    target = room.name.strip().casefold()
    for attempt in range(SESSION_HISTORY_ATTEMPTS):
        _raise_if_completion_verification_was_replaced(hass, entity_id, cancel_event)
        try:
            records = await reader()
        except MaticError as err:
            _LOGGER.debug(
                "Native Matic completion evidence unavailable (%s)", type(err).__name__
            )
            records = ()
        _raise_if_completion_verification_was_replaced(hass, entity_id, cancel_event)
        now = dt_util.utcnow()
        matches: list[CleaningSessionRecord] = []
        for record in records:
            session = record.session
            if record.key in baseline or session.completed is not True:
                continue
            started = dt_util.parse_datetime(session.started_at or "")
            ended = dt_util.parse_datetime(session.ended_at or "")
            if started is None or ended is None or started > ended:
                continue
            if ended < dispatched_at or started > now or ended > now:
                continue
            rooms = [name.strip().casefold() for name in session.rooms]
            durations = [
                duration
                for name, duration in session.room_durations
                if name.strip().casefold() == target and duration > 0
            ]
            if rooms == [target] and len(durations) == 1:
                matches.append(record)
        if len(matches) == 1:
            return True
        if len(matches) > 1:
            return False
        if attempt + 1 < SESSION_HISTORY_ATTEMPTS:
            if cancel_event is None:
                await asyncio.sleep(SESSION_HISTORY_RETRY_SECONDS)
            else:
                try:
                    async with asyncio.timeout(SESSION_HISTORY_RETRY_SECONDS):
                        await cancel_event.wait()
                except TimeoutError:
                    continue
                raise PlanCancelledError
    return False


def _raise_if_completion_verification_was_replaced(
    hass: HomeAssistant | None,
    entity_id: str | None,
    cancel_event: asyncio.Event | None,
) -> None:
    """Abort history verification if cancellation or a new task takes over."""
    if cancel_event is not None and cancel_event.is_set():
        raise PlanCancelledError
    if hass is None or entity_id is None:
        return
    state = hass.states.get(entity_id)
    if state is not None and state.state in {"cleaning", "paused"}:
        raise RoomTakenOverError(
            "Another cleaning task started while completion was being verified"
        )


async def _async_wait_for_active_session_resolution(
    hass: HomeAssistant,
    entity_id: str,
    reader: Callable[[], Awaitable[bool | None]] | None,
    cancel_event: asyncio.Event | None = None,
) -> bool | None:
    """Wait for a returning task to finish or visibly resume.

    ``False`` means the firmware session ended and operational handoff is safe;
    it does not prove completion. ``True`` means cleaning resumed, and ``None``
    means repeated direct reads could not establish session ownership. The
    enclosing room timeout bounds the wait while known-active firmware sessions
    return to their dock.
    """
    if reader is None:
        return None
    unknown_reads = 0
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise PlanCancelledError
        state = hass.states.get(entity_id)
        if state is not None:
            if state.state == "error":
                raise _validation_error(
                    "The selected Matic robot reported an error", "robot_error"
                )
            if state.state == "cleaning":
                return True
        session_active = await reader()
        if session_active is False:
            return False
        if session_active is None:
            unknown_reads += 1
            if unknown_reads >= ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
                return None
        else:
            unknown_reads = 0
        if cancel_event is None:
            await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
            continue
        try:
            async with asyncio.timeout(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS):
                await cancel_event.wait()
        except TimeoutError:
            continue
        raise PlanCancelledError


async def _async_cleanup_managed_motion(
    sender: Callable[[int, UserCommand], Awaitable[None]] | None,
    motion_token: int | None,
    dispatch_attempted: bool,
) -> None:
    """Best-effort STOP an accepted task without replacing newer ownership."""
    if sender is None or motion_token is None or not dispatch_attempted:
        return
    try:
        await sender(motion_token, UserCommand.STOP)
    except (HomeAssistantError, MaticError, ManagedMotionReplacedError) as err:
        _LOGGER.warning(
            "Unable to stop a failed managed Matic motion before cleanup (%s)",
            type(err).__name__,
        )


def _area_matches_room(value: object, room: CleaningRoom) -> bool:
    """Match decoded current/previous area text to the commanded room."""
    if not isinstance(value, str):
        return False
    normalized = value.strip().casefold()
    return normalized in {room.room_id.casefold(), room.name.casefold()}


def _is_known_room(value: object, rooms: object) -> bool:
    """Detect a live switch to another mapped room, not an unnamed transit area."""
    if not isinstance(value, str) or not isinstance(rooms, dict):
        return False
    normalized = value.strip().casefold()
    return any(
        normalized in {str(room_id).casefold(), str(room_name).casefold()}
        for room_id, room_name in rooms.items()
    )


async def _async_periodic_refresh(
    refresh: Callable[[], Awaitable[None]],
) -> None:
    """Poll operational state quickly enough to intercept a return to dock."""
    while True:
        await asyncio.sleep(ROOM_STATUS_REFRESH_SECONDS)
        await refresh()


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


class RoomInterruptedError(HomeAssistantError):
    """A room command ended without positive completion evidence."""


class RoomTakenOverError(HomeAssistantError):
    """An external task began cleaning another known mapped room."""


async def _async_execute_rooms(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    rooms: list[CleaningRoom],
    *,
    intelligent: bool,
    refresh: Callable[[], Awaitable[None]] | None = None,
    active_session: Callable[[], Awaitable[bool | None]] | None = None,
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]]
    | None = None,
    confirm_room_completed: Callable[[str], None] | None = None,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None = None,
    mapped_room_names: tuple[str, ...] = (),
) -> None:
    """Execute every resolved room with safe cancellation semantics."""
    lock = manager.lock(serial_number)
    if lock.locked():
        raise _validation_error(
            "A managed Matic cleaning plan is already running", "plan_already_running"
        )
    async with lock:
        manager.register_run_task(serial_number)
        cancel_event = manager.prepare_run(serial_number)
        motion_token = manager.begin_managed_motion(serial_number)
        try:
            finish_room_event = manager.finish_room_event(serial_number)
            chosen = (
                manager.choose(serial_number, call.data["plan_id"], rooms)
                if intelligent
                else rooms
            )
            for room in chosen:
                if cancel_event.is_set() or not manager.managed_motion_is_current(
                    serial_number, motion_token
                ):
                    raise PlanCancelledError
                await _async_run_room(
                    hass,
                    call,
                    manager,
                    entity_id,
                    serial_number,
                    room,
                    cancel_event,
                    refresh,
                    motion_token,
                    active_session,
                    session_history,
                    confirm_room_completed,
                    managed_user_command,
                    room_name_is_unique=(
                        not mapped_room_names
                        or sum(
                            name.strip().casefold() == room.name.strip().casefold()
                            for name in mapped_room_names
                        )
                        == 1
                    ),
                )
                if cancel_event.is_set() or not manager.managed_motion_is_current(
                    serial_number, motion_token
                ):
                    raise PlanCancelledError
                if finish_room_event.is_set():
                    break
            if cancel_event.is_set() or not manager.managed_motion_is_current(
                serial_number, motion_token
            ):
                raise PlanCancelledError
            if (
                (call.data["return_to_base"] or finish_room_event.is_set())
                and (current := hass.states.get(entity_id)) is not None
                and current.state not in {"docked", "returning"}
                and managed_user_command is not None
            ):
                try:
                    await managed_user_command(motion_token, UserCommand.DOCK)
                except ManagedMotionReplacedError as err:
                    raise PlanCancelledError from err
                except MaticError as err:
                    raise _validation_error(
                        "The robot could not return to its dock",
                        "robot_command_failed",
                    ) from err
        except PlanCancelledError:
            return
        finally:
            manager.end_managed_motion(serial_number, motion_token)
            manager.unregister_run_task(serial_number)


def _validated_area_command(
    area: dict[str, Any],
    floor_plan: FloorPlan | None,
    cleaning_mode: object,
    coverage_setting: object,
) -> tuple[
    FloorPlan,
    list[tuple[float, float, float]],
    CleaningMode,
    CoverageSetting,
]:
    """Validate saved private geometry without changing robot ownership."""
    if floor_plan is None or not floor_plan.rooms:
        raise _validation_error(
            "The robot's room map is unavailable", "room_plan_unavailable"
        )
    if area_binding_status(area, floor_plan) is not AreaBindingStatus.CURRENT:
        raise _validation_error(
            "The saved custom area belongs to a different room map",
            "area_map_changed",
        )
    try:
        circles = [
            (float(item["x"]), float(item["y"]), float(item["radius"]))
            for item in area["circles"]
        ]
        mode_value = cleaning_mode or area["cleaning_mode"]
        coverage_value = coverage_setting or area["coverage_setting"]
        if not isinstance(mode_value, str) or not isinstance(coverage_value, str):
            raise TypeError("cleaning settings must be strings")
        mode = CleaningMode(mode_value)
        coverage = CoverageSetting(coverage_value)
    except (KeyError, TypeError, ValueError) as err:
        raise _validation_error(
            "The saved custom area is invalid",
            "invalid_area",
            {"error": str(err)},
        ) from err
    return floor_plan, circles, mode, coverage


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
