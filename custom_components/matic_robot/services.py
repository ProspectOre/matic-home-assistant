"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from collections.abc import (
    Callable,
    Coroutine,
    Mapping,
)
from copy import deepcopy
from functools import partial, wraps
from typing import Any

import voluptuous as vol
from homeassistant.auth.permissions.const import POLICY_CONTROL
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
    HomeAssistant,
    ServiceCall,
    SupportsResponse,
)
from homeassistant.exceptions import (
    ServiceValidationError,
    Unauthorized,
    UnknownUser,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import target
from homeassistant.util import slugify

from .area_binding import AreaBindingStatus, area_binding_status
from .client.commands import CleaningMode, CoverageSetting, UserCommand
from .client.endpoints import HERMES_ENDPOINT_MAP, HERMES_ENDPOINT_NAMES
from .client.exceptions import MaticError
from .client.floor_plan import pose_vector_paths
from .client.models import FloorPlan
from .const import (
    DATA_FIRMWARE_TRACKER,
    DOMAIN,
)
from .firmware import (
    FirmwareTracker,
    async_build_firmware_snapshot,
    fingerprint_entry,
)
from .managed_executor import (
    _async_execute_rooms,
    _async_managed_user_command,
    _ensure_stop_settled,
    _validation_error,
)
from .plans import (
    CleaningPlanManager,
    CleaningRoom,
    SavedPlanLimitError,
    async_get_plan_manager,
    plan_floor_token,
    resolve_room_reference,
    resolve_rooms,
    room_cadence_identity,
)
from .room_coherence import current_floor_plan as _current_floor_plan
from .room_sequence import resolve_room_sequence, saved_plan_preview_token

SERVICE_CLEAN = "clean"
SERVICE_CLEAN_ROOM_SEQUENCE = "clean_room_sequence"
SERVICE_CLEAN_AREA = "clean_area"
SERVICE_INTELLIGENT_CLEAN = "intelligent_clean"
SERVICE_CLEAN_ENTIRE_PLAN = "clean_entire_plan"
SERVICE_RUN_SELECTED_PLAN = "run_selected_plan"
SERVICE_PREVIEW_PLAN = "preview_plan"
SERVICE_PREVIEW_ROOM_SEQUENCE = "preview_room_sequence"
SERVICE_STOP_INTELLIGENT_CLEANING = "stop_intelligent_cleaning"
SERVICE_RESET_PLAN_HISTORY = "reset_plan_history"
SERVICE_RESET_ROOM_CADENCE = "reset_room_cadence"
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

CLEAN_AREA_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required("area"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Optional("cleaning_mode"): vol.In([value.value for value in CleaningMode]),
        vol.Optional("coverage_setting"): vol.In(
            [value.value for value in CoverageSetting]
        ),
    }
)

ROOM_CADENCE_SCHEMA = vol.Schema(
    {
        vol.Optional("scope", default="plan"): vol.In(("plan", "shared")),
        vol.Optional("mop_every_n"): vol.Any(
            None, vol.All(vol.Coerce(int), vol.Range(min=1, max=100))
        ),
        vol.Optional("coverage_every_n"): vol.Any(
            None, vol.All(vol.Coerce(int), vol.Range(min=1, max=100))
        ),
        vol.Optional("periodic_coverage_setting"): vol.Any(
            None, vol.In([value.value for value in CoverageSetting])
        ),
        vol.Optional("do_mop_next", default=False): cv.boolean,
        vol.Optional("do_coverage_next", default=False): cv.boolean,
    }
)

_ROOM_FIELDS = {
    vol.Required("room"): cv.string,
    vol.Optional("cleaning_mode", default=CleaningMode.BOTH.value): vol.In(
        [value.value for value in CleaningMode]
    ),
    vol.Optional("coverage_setting", default=CoverageSetting.OPTIMAL.value): vol.In(
        [value.value for value in CoverageSetting]
    ),
}
SAVED_ROOM_SCHEMA = vol.Schema(_ROOM_FIELDS)
SAVED_PLAN_ROOM_SCHEMA = vol.Schema(
    {**_ROOM_FIELDS, vol.Optional("cadence"): ROOM_CADENCE_SCHEMA}
)

SAVED_PLAN_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {vol.Optional("plan"): vol.All(cv.string, vol.Length(min=1, max=128))}
)

RUN_SELECTED_PLAN_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional("plan"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Optional("preview_token"): vol.All(
            cv.string,
            vol.Match(r"^[0-9a-f]{64}$"),
        ),
    }
)

_ROOM_SEQUENCE_FIELDS = {
    vol.Required("rooms"): vol.All(
        cv.ensure_list, [SAVED_ROOM_SCHEMA], vol.Length(min=1, max=100)
    ),
    vol.Optional("return_to_base", default=True): cv.boolean,
    vol.Optional("use_room_schedule", default=False): cv.boolean,
    vol.Optional("override_room_schedule", default=False): cv.boolean,
}
CLEAN_ROOM_SEQUENCE_SCHEMA = cv.make_entity_service_schema(
    {
        **_ROOM_SEQUENCE_FIELDS,
        vol.Optional("preview_token"): vol.All(
            cv.string,
            vol.Match(r"^[0-9a-f]{64}$"),
        ),
    }
)
PREVIEW_ROOM_SEQUENCE_SCHEMA = cv.make_entity_service_schema(_ROOM_SEQUENCE_FIELDS)

PLAN_TARGET_SCHEMA = cv.make_entity_service_schema(
    {vol.Optional("include_unmanaged", default=False): cv.boolean}
)

RESET_PLAN_HISTORY_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional("plan"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Optional("all_plans", default=False): cv.boolean,
    }
)

RESET_ROOM_CADENCE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required("plan"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Optional("room_id"): vol.All(cv.string, vol.Length(min=1, max=128)),
        vol.Optional("modes"): vol.All(
            cv.ensure_list,
            [vol.In(("mop", "coverage"))],
            vol.Length(min=1, max=2),
        ),
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
            cv.ensure_list, [SAVED_PLAN_ROOM_SCHEMA], vol.Length(min=1, max=100)
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
        vol.Required("room"): SAVED_PLAN_ROOM_SCHEMA,
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


def _require_matic_control[ServiceResult](
    hass: HomeAssistant,
    handler: Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]],
) -> Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]]:
    """Apply Home Assistant's entity-control policy to a domain service."""

    @wraps(handler)
    async def async_authorized(call: ServiceCall) -> ServiceResult:
        user_id = call.context.user_id
        if user_id is not None:
            user = await hass.auth.async_get_user(user_id)
            if user is None:
                raise UnknownUser(context=call.context)
            if not user.is_admin:
                for entity_id in _resolve_loaded_matic_vacuums(hass, call):
                    if not user.permissions.check_entity(entity_id, POLICY_CONTROL):
                        raise Unauthorized(
                            context=call.context,
                            entity_id=entity_id,
                            permission=POLICY_CONTROL,
                        )
        return await handler(call)

    return async_authorized


def _require_matic_admin[ServiceResult](
    hass: HomeAssistant,
    handler: Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]],
) -> Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]]:
    """Require an administrator for read-only room-sequence previews."""

    @wraps(handler)
    async def async_authorized(call: ServiceCall) -> ServiceResult:
        user_id = call.context.user_id
        if user_id is not None:
            user = await hass.auth.async_get_user(user_id)
            if user is None:
                raise UnknownUser(context=call.context)
            if not user.is_admin:
                entity_ids = _resolve_loaded_matic_vacuums(hass, call)
                raise Unauthorized(
                    context=call.context,
                    entity_id=entity_ids[0] if entity_ids else None,
                    permission=POLICY_CONTROL,
                )
        return await handler(call)

    return async_authorized


async def async_register_services(hass: HomeAssistant) -> None:
    """Register actions before any config entry is loaded."""

    manager = await async_get_plan_manager(hass, manager_factory=CleaningPlanManager)
    firmware_tracker = FirmwareTracker(hass)
    await firmware_tracker.async_load()
    hass.data[DOMAIN][DATA_FIRMWARE_TRACKER] = firmware_tracker

    async def async_clean(call: ServiceCall) -> None:
        """Route the complete verified cleaning matrix to selected vacuums."""
        entity_ids = _resolve_loaded_matic_vacuums(hass, call)
        if callable(getattr(manager, "stop_pending", None)):
            for entity_id in entity_ids:
                entry = _entry_for_entity(hass, entity_id)
                await _ensure_stop_settled(
                    hass,
                    manager,
                    entry.runtime_data.coordinator.data.info.serial_number,
                    entity_id,
                )
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
        _require_matic_control(hass, async_clean),
        schema=CLEAN_SERVICE_SCHEMA,
    )

    async def async_clean_area(call: ServiceCall) -> None:
        """Clean one private saved area without putting coordinates in the call."""
        entity_id, entry, serial_number, _room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
        request_generation = manager.motion_generation(serial_number)

        def require_generation(expected: int) -> None:
            if manager.motion_generation(serial_number) != expected:
                raise _validation_error(
                    "The cleaning request was superseded before it could start",
                    "robot_command_failed",
                )

        await _ensure_stop_settled(hass, manager, serial_number, entity_id)
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
            require_generation(request_generation)
            await _ensure_stop_settled(hass, manager, serial_number, entity_id)
            try:
                current_area = manager.area(serial_number, call.data["area"])
            except KeyError as err:
                raise _validation_error(
                    f"Unknown Matic custom area: {call.data['area']}",
                    "unknown_area",
                    {"area": str(call.data["area"])},
                ) from err
            floor_plan = _current_floor_plan(entry)
            floor_plan, circles, mode, coverage = _validated_area_command(
                current_area,
                floor_plan,
                call.data.get("cleaning_mode"),
                call.data.get("coverage_setting"),
            )
            require_generation(request_generation)
            generation = await manager.async_replace_managed_motion(serial_number)
            floor_plan = _current_floor_plan(entry)
            floor_plan, circles, mode, coverage = _validated_area_command(
                current_area,
                floor_plan,
                call.data.get("cleaning_mode"),
                call.data.get("coverage_setting"),
            )
            require_generation(generation)
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
        _require_matic_control(hass, async_clean_area),
        schema=CLEAN_AREA_SERVICE_SCHEMA,
    )

    async def async_run_saved_plan(
        call: ServiceCall,
        *,
        intelligent: bool | None,
        preview_token: str | None = None,
    ) -> None:
        """Resolve and run every room in a saved plan."""
        entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
        execution_floor_plan = _current_floor_plan(entry)
        execution_floor_token = plan_floor_token(execution_floor_plan)

        def floor_is_current() -> bool:
            """Keep every native room dispatch bound to the starting map."""
            floor_plan: FloorPlan | None = (
                entry.runtime_data.coordinator.data.floor_plan
            )
            return (
                floor_plan is not None
                and plan_floor_token(floor_plan) == execution_floor_token
                and entry.runtime_data.slam_map.floor_plan_is_current(floor_plan)
            )

        initial_preview_token: str | None = None
        validate_prepared_run: Callable[[], None] | None = None
        try:
            _preview_floor, preview, initial_preview_token = _saved_plan_preview(
                manager,
                serial_number,
                entry,
                room_map,
                call.data.get("plan"),
                intelligent=intelligent,
            )
            if preview_token is not None and preview_token != initial_preview_token:
                raise _validation_error(
                    "The saved-plan preview is stale; refresh it before starting",
                    "invalid_plan",
                )
            plan, rooms, cadence_by_room = _saved_plan_execution(
                manager, serial_number, execution_floor_plan, preview
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

        if preview_token is not None:

            def validate_prepared_run() -> None:
                """Reject saved-plan changes after executor settlement awaits."""
                try:
                    current_floor = _current_floor_plan(entry)
                    current_room_map = {
                        room.id: room.name for room in current_floor.rooms
                    }
                    _current_floor, _current_preview, current_token = (
                        _saved_plan_preview(
                            manager,
                            serial_number,
                            entry,
                            current_room_map,
                            call.data.get("plan"),
                            intelligent=intelligent,
                        )
                    )
                except (KeyError, TypeError, ValueError) as err:
                    raise _validation_error(
                        str(err), "invalid_plan", {"error": str(err)}
                    ) from err
                if current_token != initial_preview_token:
                    raise _validation_error(
                        "The saved-plan resolution changed before starting",
                        "invalid_plan",
                    )

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
            await _async_managed_user_command(
                hass,
                entry,
                manager,
                serial_number,
                entity_id,
                call.context,
                token,
                command,
            )

        await _async_execute_rooms(
            hass,
            execution_call,
            manager,
            entity_id,
            serial_number,
            rooms,
            cadence_by_room=cadence_by_room,
            refresh=entry.runtime_data.coordinator.async_request_refresh,
            active_session=(
                entry.runtime_data.client.async_has_active_cleaning_session
            ),
            session_history=partial(
                entry.runtime_data.client.async_get_cleaning_session_records,
                strict=True,
            ),
            session_identity=(
                entry.runtime_data.client.async_get_cleaning_session_identity
            ),
            confirm_room_completed=(
                entry.runtime_data.coordinator.async_confirm_room_completed
            ),
            managed_user_command=async_managed_command,
            mapped_room_names=tuple(room_map.values()),
            floor_is_current=floor_is_current,
            floor_token=execution_floor_token,
            set_activity_run_id=getattr(
                getattr(entry.runtime_data.client, "activity_journal", None),
                "set_run_id",
                None,
            ),
            get_activity_run_id=getattr(
                getattr(entry.runtime_data.client, "activity_journal", None),
                "current_run_id",
                None,
            ),
            validate_prepared_run=validate_prepared_run,
        )

    async def async_clean_room_sequence(call: ServiceCall) -> None:
        """Run an unsaved ordered room sequence with per-room settings."""
        entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
        execution_floor_plan = _current_floor_plan(entry)
        execution_floor_token = plan_floor_token(execution_floor_plan)
        use_room_schedule = bool(call.data.get("use_room_schedule", False))
        override_room_schedule = bool(call.data.get("override_room_schedule", False))
        try:
            resolved = resolve_room_sequence(
                manager,
                serial_number,
                execution_floor_plan,
                room_map,
                call.data["rooms"],
                entry_id=str(getattr(entry, "entry_id", "")),
                return_to_base=bool(call.data["return_to_base"]),
                use_room_schedule=use_room_schedule,
                override_room_schedule=override_room_schedule,
                room_resolver=_resolve_room_id,
            )
        except ValueError as err:
            raise _validation_error(
                str(err), "invalid_plan", {"error": str(err)}
            ) from err
        preview_token = call.data.get("preview_token")
        if preview_token is not None and preview_token != resolved["preview_token"]:
            raise _validation_error(
                "The room-sequence preview is stale; refresh it before starting",
                "invalid_plan",
            )
        rooms = resolved["effective_rooms"]
        cadence_by_room = resolved["cadence_by_room"]

        def floor_is_current() -> bool:
            floor_plan: FloorPlan | None = (
                entry.runtime_data.coordinator.data.floor_plan
            )
            return (
                floor_plan is not None
                and plan_floor_token(floor_plan) == execution_floor_token
                and entry.runtime_data.slam_map.floor_plan_is_current(floor_plan)
            )

        execution_call = ServiceCall(
            hass,
            DOMAIN,
            call.service,
            {
                "plan_id": "quick_clean",
                "start_timeout": 120,
                "completion_timeout": 21600,
                "return_to_base": bool(call.data["return_to_base"]),
            },
            context=call.context,
        )

        async def async_managed_command(token: int, command: UserCommand) -> None:
            await _async_managed_user_command(
                hass,
                entry,
                manager,
                serial_number,
                entity_id,
                call.context,
                token,
                command,
            )

        initial_sequence_token = resolved["preview_token"]

        def validate_prepared_run() -> None:
            """Reject map, policy, settings, or progress changes before dispatch."""
            current_floor_plan = _current_floor_plan(entry)
            current_room_map = {room.id: room.name for room in current_floor_plan.rooms}
            try:
                current = resolve_room_sequence(
                    manager,
                    serial_number,
                    current_floor_plan,
                    current_room_map,
                    call.data["rooms"],
                    entry_id=str(getattr(entry, "entry_id", "")),
                    return_to_base=bool(call.data["return_to_base"]),
                    use_room_schedule=use_room_schedule,
                    override_room_schedule=override_room_schedule,
                    room_resolver=_resolve_room_id,
                )
            except ValueError as err:
                raise _validation_error(
                    str(err), "invalid_plan", {"error": str(err)}
                ) from err
            if current["preview_token"] != initial_sequence_token:
                raise _validation_error(
                    "The room-sequence resolution changed before starting",
                    "invalid_plan",
                )

        await _async_execute_rooms(
            hass,
            execution_call,
            manager,
            entity_id,
            serial_number,
            rooms,
            cadence_by_room=cadence_by_room,
            refresh=entry.runtime_data.coordinator.async_request_refresh,
            active_session=(
                entry.runtime_data.client.async_has_active_cleaning_session
            ),
            session_history=partial(
                entry.runtime_data.client.async_get_cleaning_session_records,
                strict=True,
            ),
            session_identity=(
                entry.runtime_data.client.async_get_cleaning_session_identity
            ),
            confirm_room_completed=(
                entry.runtime_data.coordinator.async_confirm_room_completed
            ),
            managed_user_command=async_managed_command,
            mapped_room_names=tuple(room_map.values()),
            floor_is_current=floor_is_current,
            floor_token=execution_floor_token,
            set_activity_run_id=getattr(
                getattr(entry.runtime_data.client, "activity_journal", None),
                "set_run_id",
                None,
            ),
            get_activity_run_id=getattr(
                getattr(entry.runtime_data.client, "activity_journal", None),
                "current_run_id",
                None,
            ),
            validate_prepared_run=validate_prepared_run,
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAN_ROOM_SEQUENCE,
        _require_matic_control(hass, async_clean_room_sequence),
        schema=CLEAN_ROOM_SEQUENCE_SCHEMA,
    )

    async def async_preview_room_sequence(call: ServiceCall) -> dict[str, Any]:
        """Return the current authoritative resolution of a room sequence."""
        _entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
        floor_plan = _current_floor_plan(entry)
        try:
            resolved = resolve_room_sequence(
                manager,
                serial_number,
                floor_plan,
                room_map,
                call.data["rooms"],
                entry_id=str(getattr(entry, "entry_id", "")),
                return_to_base=bool(call.data["return_to_base"]),
                use_room_schedule=bool(call.data.get("use_room_schedule", False)),
                override_room_schedule=bool(
                    call.data.get("override_room_schedule", False)
                ),
                room_resolver=_resolve_room_id,
            )
        except ValueError as err:
            raise _validation_error(
                str(err), "invalid_plan", {"error": str(err)}
            ) from err
        return {
            "entry_id": resolved["entry_id"],
            "floor_token": resolved["floor_token"],
            "preview_token": resolved["preview_token"],
            "rooms": resolved["rooms"],
            "mission_boundaries": resolved["mission_boundaries"],
            "blocker": resolved["blocker"],
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_PREVIEW_ROOM_SEQUENCE,
        _require_matic_admin(hass, async_preview_room_sequence),
        schema=PREVIEW_ROOM_SEQUENCE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_intelligent_clean(call: ServiceCall) -> None:
        """Continue with the least recently confirmed cleaning opportunity."""
        await async_run_saved_plan(call, intelligent=True)

    async def async_clean_entire_plan(call: ServiceCall) -> None:
        """Clean every room in the plan's saved order."""
        await async_run_saved_plan(call, intelligent=False)

    async def async_run_selected_plan(call: ServiceCall) -> None:
        """Run a saved plan using its configured default behavior."""
        await async_run_saved_plan(
            call,
            intelligent=None,
            preview_token=call.data.get("preview_token"),
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_INTELLIGENT_CLEAN,
        _require_matic_control(hass, async_intelligent_clean),
        schema=SAVED_PLAN_SERVICE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAN_ENTIRE_PLAN,
        _require_matic_control(hass, async_clean_entire_plan),
        schema=SAVED_PLAN_SERVICE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_RUN_SELECTED_PLAN,
        _require_matic_control(hass, async_run_selected_plan),
        schema=RUN_SELECTED_PLAN_SCHEMA,
    )

    async def async_preview_plan(call: ServiceCall) -> dict[str, Any]:
        """Validate and return the exact next saved-plan execution."""
        entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
        try:
            _floor_plan, preview, preview_token = _saved_plan_preview(
                manager,
                serial_number,
                entry,
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
        return {"entity_id": entity_id, **preview, "preview_token": preview_token}

    hass.services.async_register(
        DOMAIN,
        SERVICE_PREVIEW_PLAN,
        _require_matic_control(hass, async_preview_plan),
        schema=SAVED_PLAN_SERVICE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_stop_intelligent_cleaning(call: ServiceCall) -> None:
        """Apply the active plan's stop policy and send the robot home."""
        entity_id, entry, serial_number, _room_map = _saved_plan_context(
            hass, call, require_rooms=False
        )
        decision = manager.request_stop(serial_number)
        await manager.async_checkpoint_stop_intent(serial_number, decision.behavior)
        if decision.behavior == "not_running" and not call.data.get(
            "include_unmanaged"
        ):
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
        _require_matic_control(hass, async_stop_intelligent_cleaning),
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
        _require_matic_control(hass, async_reset_plan_history),
        schema=RESET_PLAN_HISTORY_SCHEMA,
    )

    async def async_reset_room_cadence(call: ServiceCall) -> dict[str, Any]:
        """Reset cadence counters without resetting completion history."""
        _entity_id, _entry, serial_number, _room_map = _saved_plan_context(
            hass, call, require_rooms=False
        )
        plan = _resolve_saved_plan(manager, serial_number, call.data["plan"])
        room_ids = [call.data["room_id"]] if call.data.get("room_id") else None
        modes = call.data.get("modes")
        try:
            await manager.async_reset_cadence(
                serial_number, plan["id"], room_ids=room_ids, modes=modes
            )
        except ValueError as err:
            raise _validation_error(str(err), "cadence_reset_blocked") from err
        return {
            "plan_id": plan["id"],
            "reset_room_ids": room_ids,
            "reset_modes": modes or ["mop", "coverage"],
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_RESET_ROOM_CADENCE,
        _require_matic_control(hass, async_reset_room_cadence),
        schema=RESET_ROOM_CADENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
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
        _require_matic_control(hass, async_list_plans),
        schema=LIST_PLANS_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_save_plan(call: ServiceCall) -> dict[str, Any]:
        """Create or atomically replace a complete saved plan."""
        _entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
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
        try:
            cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
            await manager.async_save_plan(
                serial_number,
                plan_id,
                plan,
                select=call.data["select"],
                floor_token=cadence_floor_token,
                room_identities=room_identities,
            )
        except SavedPlanLimitError as err:
            raise _validation_error(str(err), "plan_limit_reached") from err
        except ValueError as err:
            raise _validation_error(str(err), "invalid_plan") from err
        return {"plan": {"id": plan_id, **deepcopy(plan)}}

    hass.services.async_register(
        DOMAIN,
        SERVICE_SAVE_PLAN,
        _require_matic_control(hass, async_save_plan),
        schema=SAVE_PLAN_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_delete_plan(call: ServiceCall) -> dict[str, Any]:
        """Delete one plan by ID or human-readable name."""
        _entity_id, _entry, serial_number, _room_map = _saved_plan_context(
            hass, call, require_rooms=False
        )
        plan = _resolve_saved_plan(manager, serial_number, call.data["plan"])
        try:
            await manager.async_delete_plan(serial_number, plan["id"])
        except ValueError as err:
            raise _validation_error(str(err), "plan_locked") from err
        return {"deleted_plan_id": plan["id"]}

    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_PLAN,
        _require_matic_control(hass, async_delete_plan),
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
        _require_matic_control(hass, async_select_plan),
        schema=PLAN_REFERENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_save_plan_room(call: ServiceCall) -> dict[str, Any]:
        """Append or replace one mapped room and its settings."""
        _entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
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
        cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
        await manager.async_save_plan(
            serial_number,
            plan_id,
            plan,
            select=False,
            floor_token=cadence_floor_token,
            room_identities=room_identities,
        )
        return {"plan_id": plan_id, "position": position + 1, "room": room}

    hass.services.async_register(
        DOMAIN,
        SERVICE_SAVE_PLAN_ROOM,
        _require_matic_control(hass, async_save_plan_room),
        schema=SAVE_PLAN_ROOM_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_delete_plan_room(call: ServiceCall) -> dict[str, Any]:
        """Delete one mapped room from a plan."""
        _entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
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
        cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
        await manager.async_save_plan(
            serial_number,
            plan_id,
            plan,
            select=False,
            floor_token=cadence_floor_token,
            room_identities=room_identities,
        )
        return {"plan_id": plan_id, "deleted": deleted}

    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_PLAN_ROOM,
        _require_matic_control(hass, async_delete_plan_room),
        schema=DELETE_PLAN_ROOM_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_move_plan_room(call: ServiceCall) -> dict[str, Any]:
        """Move one mapped room to an exact one-based position."""
        _entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
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
        cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
        await manager.async_save_plan(
            serial_number,
            plan_id,
            plan,
            select=False,
            floor_token=cadence_floor_token,
            room_identities=room_identities,
        )
        return {
            "plan_id": plan_id,
            "previous_position": position,
            "position": new_position,
            "room": room,
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_MOVE_PLAN_ROOM,
        _require_matic_control(hass, async_move_plan_room),
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
            "entries": [
                fingerprint_entry(value, endpoint_name=endpoint_name)
                for value in values
            ],
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
        _require_matic_control(hass, async_inspect_endpoint),
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
        _require_matic_control(hass, async_firmware_snapshot),
        schema=FIRMWARE_SNAPSHOT_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )


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
    require_current_floor: bool = False,
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
    floor_plan = (
        _current_floor_plan(entry) if require_current_floor else data.floor_plan
    )
    serial_number = data.info.serial_number
    room_map = (
        {room.id: room.name for room in floor_plan.rooms}
        if floor_plan is not None
        else {}
    )
    if require_rooms and not room_map:
        raise _validation_error(
            "The robot's room map is unavailable", "room_plan_unavailable"
        )
    return entity_id, entry, serial_number, room_map


def _room_cadence_identities(floor_plan: FloorPlan) -> dict[str, str]:
    """Return room identity tokens that survive labels and geometry edits."""
    return {
        room.id: room_cadence_identity(floor_plan, room.id) for room in floor_plan.rooms
    }


def _plan_cadence_bindings(
    entry: ConfigEntry[Any],
) -> tuple[str | None, dict[str, str]]:
    """Read current map bindings when the typed config entry is available."""
    try:
        floor_plan = _current_floor_plan(entry)
    except AttributeError:
        # Service unit tests and pre-runtime adapters can still save fixed
        # plans; cadence identity is attached on the next verified map edit.
        return None, {}
    return plan_floor_token(floor_plan), _room_cadence_identities(floor_plan)


def _saved_plan_preview(
    manager: CleaningPlanManager,
    serial_number: str,
    entry: ConfigEntry[Any],
    room_map: Mapping[str, str],
    plan_reference: str | None,
    *,
    intelligent: bool | None = None,
) -> tuple[FloorPlan, dict[str, Any], str]:
    """Resolve one saved plan and its stable execution fingerprint."""
    floor_plan = _current_floor_plan(entry)
    floor_token = plan_floor_token(floor_plan)
    room_identities = _room_cadence_identities(floor_plan)
    preview_kwargs: dict[str, Any] = {
        "floor_token": floor_token,
        "room_identities": room_identities,
    }
    if intelligent is not None:
        preview_kwargs["intelligent"] = intelligent
    preview = manager.preview(serial_number, room_map, plan_reference, **preview_kwargs)
    token = saved_plan_preview_token(
        preview,
        entry_id=str(getattr(entry, "entry_id", "")),
        floor_token=floor_token,
        room_identities=room_identities,
    )
    return floor_plan, preview, token


def _saved_plan_execution(
    manager: CleaningPlanManager,
    serial_number: str,
    floor_plan: FloorPlan,
    preview: Mapping[str, Any],
) -> tuple[dict[str, Any], list[CleaningRoom], dict[str, dict[str, Any]]]:
    """Materialize the authoritative preview for executor dispatch."""
    room_identities = _room_cadence_identities(floor_plan)
    plan = manager.plan(serial_number, str(preview["plan_id"]))
    raw_rooms = preview.get("rooms")
    if not isinstance(raw_rooms, list) or not raw_rooms:
        raise ValueError("plan has no rooms")
    if any(not isinstance(room, Mapping) for room in raw_rooms):
        raise ValueError("plan contains an invalid room")
    rooms = [
        CleaningRoom(
            str(room["room_id"]),
            str(room["name"]),
            str(room["cleaning_mode"]),
            str(room["coverage_setting"]),
        )
        for room in raw_rooms
    ]
    cadence_by_room = {
        str(room["room_id"]): dict(room["cadence"]) for room in raw_rooms
    }
    for room_id, snapshot in cadence_by_room.items():
        snapshot["identity"] = room_identities.get(room_id)
    return plan, rooms, cadence_by_room


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
        room_id, _room_name = resolve_room_reference(str(raw["room"]), room_map)
        raw["room_id"] = room_id
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
        **(
            {"cadence": dict(raw["cadence"])}
            if isinstance(raw.get("cadence"), dict)
            else {}
        ),
    }


def _resolve_room_id(identifier: str, room_map: Mapping[str, str]) -> str:
    """Resolve one live room ID or unambiguous display name."""
    try:
        room_id, _room_name = resolve_room_reference(identifier, room_map)
    except ValueError as err:
        detail = str(err)
        message = (
            f"Ambiguous Matic room: {identifier}"
            if detail.startswith("ambiguous ")
            else f"Unknown Matic room: {identifier}"
        )
        raise _validation_error(
            message,
            "unknown_rooms",
            {"rooms": detail},
        ) from err
    return room_id


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
