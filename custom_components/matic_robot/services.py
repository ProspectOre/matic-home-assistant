"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from collections.abc import (
    Callable,
    Coroutine,
    Mapping,
    Sequence,
)
from functools import partial, wraps
from typing import Any

import probatio
from homeassistant.auth.permissions.const import POLICY_CONTROL
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import (
    ATTR_AREA_ID,
    ATTR_DEVICE_ID,
    ATTR_ENTITY_ID,
    ATTR_FLOOR_ID,
    ATTR_LABEL_ID,
    EVENT_HOMEASSISTANT_STARTED,
    STATE_UNAVAILABLE,
)
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    SupportsResponse,
    callback,
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
from .cadence import MAX_CADENCE_INTERVAL, validate_cadence_interval
from .client.commands import CleaningMode, CoverageSetting, UserCommand
from .client.endpoints import HERMES_ENDPOINT_MAP, HERMES_ENDPOINT_NAMES
from .client.exceptions import MaticError
from .client.floor_plan import pose_vector_paths
from .client.models import FloorPlan
from .const import (
    DATA_FIRMWARE_TRACKER,
    DOMAIN,
    MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE,
    MAX_ROOM_SEQUENCE_SIZE,
)
from .firmware import (
    FirmwareTracker,
    async_build_firmware_snapshot,
    fingerprint_entry,
)
from .firmware_reports import valid_investigator
from .managed_executor import (
    _async_execute_rooms,
    _async_managed_user_command,
    _ensure_stop_settled,
    _validation_error,
)
from .plans import (
    CadenceBindingError,
    CleaningPlanManager,
    CleaningRoom,
    DuplicatePlanAreaError,
    DuplicateRoomError,
    EmptyPlanError,
    PlanAreaLimitError,
    PlanAreaMapChangedError,
    PlanAreaMissingError,
    PlanDisabledError,
    RoomSequenceLimitError,
    SavedPlanLimitError,
    SharedRoomScheduleLockedError,
    SharedRoomScheduleMapChangedError,
    SharedRoomScheduleStaleError,
    async_get_plan_manager,
    plan_entries,
    plan_floor_token,
    resolve_room_reference,
    resolve_rooms,
    room_cadence_identity,
)
from .room_coherence import current_floor_plan as _current_floor_plan
from .room_coherence import room_completion_names_are_current
from .room_sequence import resolve_room_sequence, saved_plan_preview_token

SERVICE_CLEAN = "clean"
SERVICE_CLEAN_ROOM_SEQUENCE = "clean_room_sequence"
SERVICE_CLEAN_AREA = "clean_area"
SERVICE_GO_TO_ROOM = "go_to_room"
SERVICE_SKIP_ROOM = "skip_room"
SERVICE_CLEAN_ROOM_NEXT = "clean_room_next"
SERVICE_CLEAN_ROOM_AGAIN = "clean_room_again"
SERVICE_INTELLIGENT_CLEAN = "intelligent_clean"
SERVICE_CLEAN_ENTIRE_PLAN = "clean_entire_plan"
SERVICE_RUN_SELECTED_PLAN = "run_selected_plan"
SERVICE_PREVIEW_PLAN = "preview_plan"
SERVICE_PREVIEW_ROOM_SEQUENCE = "preview_room_sequence"
SERVICE_STOP_INTELLIGENT_CLEANING = "stop_intelligent_cleaning"
SERVICE_RESET_PLAN_HISTORY = "reset_plan_history"
SERVICE_RESET_ROOM_CADENCE = "reset_room_cadence"
SERVICE_DELETE_ROOM_SCHEDULE = "delete_room_schedule"
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
        probatio.Optional("rooms"): probatio.All(
            cv.ensure_list, [cv.string], probatio.Length(max=MAX_ROOM_SEQUENCE_SIZE)
        ),
        probatio.Optional("cleaning_mode"): probatio.In(
            [value.value for value in CleaningMode]
        ),
        probatio.Optional("coverage_setting"): probatio.In(
            [value.value for value in CoverageSetting]
        ),
        probatio.Optional("ordered", default=False): cv.boolean,
    }
)

GO_TO_ROOM_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("room"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        )
    }
)

CLEAN_ROOM_AGAIN_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("room"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("cleaning_mode"): probatio.In(
            [mode.value for mode in CleaningMode]
        ),
        probatio.Optional("coverage_setting"): probatio.In(
            [setting.value for setting in CoverageSetting]
        ),
    }
)

CLEAN_AREA_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("area"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("cleaning_mode"): probatio.In(
            [value.value for value in CleaningMode]
        ),
        probatio.Optional("coverage_setting"): probatio.In(
            [value.value for value in CoverageSetting]
        ),
    }
)


def _cadence_interval_validator(field: str) -> Callable[[object], int | None]:
    """Adapt the shared cadence validator to probatio errors."""

    def validate(value: object) -> int | None:
        try:
            return validate_cadence_interval(value, field)
        except ValueError as err:
            raise probatio.Invalid(
                f"Use a whole number from 1 to {MAX_CADENCE_INTERVAL}"
            ) from err

    return validate


ROOM_CADENCE_SCHEMA = probatio.Schema(
    {
        probatio.Optional("scope", default="plan"): probatio.In(("plan", "shared")),
        probatio.Optional("mop_every_n"): probatio.Any(
            None,
            _cadence_interval_validator("mop_every_n"),
        ),
        probatio.Optional("coverage_every_n"): probatio.Any(
            None,
            _cadence_interval_validator("coverage_every_n"),
        ),
        probatio.Optional("periodic_coverage_setting"): probatio.Any(
            None, probatio.In([value.value for value in CoverageSetting])
        ),
        probatio.Optional("do_mop_next", default=False): cv.boolean,
        probatio.Optional("do_coverage_next", default=False): cv.boolean,
    }
)

_ROOM_FIELDS = {
    probatio.Required("room"): cv.string,
    probatio.Optional("cleaning_mode", default=CleaningMode.BOTH.value): probatio.In(
        [value.value for value in CleaningMode]
    ),
    probatio.Optional(
        "coverage_setting", default=CoverageSetting.OPTIMAL.value
    ): probatio.In([value.value for value in CoverageSetting]),
}
SAVED_ROOM_SCHEMA = probatio.Schema(_ROOM_FIELDS)
SAVED_PLAN_ROOM_SCHEMA = probatio.Schema(
    {**_ROOM_FIELDS, probatio.Optional("cadence"): ROOM_CADENCE_SCHEMA}
)
# Areas take the same overrides as clean_area and never a cadence: the robot
# reports no per-area completion, so an area runs every time.
SAVED_PLAN_AREA_SCHEMA = probatio.Schema(
    {
        probatio.Required("area"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("cleaning_mode"): probatio.In(
            [value.value for value in CleaningMode]
        ),
        probatio.Optional("coverage_setting"): probatio.In(
            [value.value for value in CoverageSetting]
        ),
    }
)


def saved_plan_entry(value: object) -> dict[str, Any]:
    """Validate one plan entry: a mapped room or a saved custom area."""
    if isinstance(value, Mapping) and "area" in value:
        if "room" in value:
            raise probatio.Invalid("Use either room or area in one entry")
        return dict(SAVED_PLAN_AREA_SCHEMA(value))
    return dict(SAVED_PLAN_ROOM_SCHEMA(value))


SAVED_PLAN_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        )
    }
)

RUN_SELECTED_PLAN_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("preview_token"): probatio.All(
            cv.string,
            probatio.Match(r"^[0-9a-f]{64}$"),
        ),
    }
)

_ROOM_SEQUENCE_FIELDS = {
    probatio.Required("rooms"): probatio.All(
        cv.ensure_list,
        [SAVED_ROOM_SCHEMA],
        probatio.Length(min=1, max=MAX_ROOM_SEQUENCE_SIZE),
    ),
    probatio.Optional("return_to_base", default=True): cv.boolean,
    probatio.Optional("use_room_schedule", default=False): cv.boolean,
    probatio.Optional("override_room_schedule", default=False): cv.boolean,
}
CLEAN_ROOM_SEQUENCE_SCHEMA = cv.make_entity_service_schema(
    {
        **_ROOM_SEQUENCE_FIELDS,
        probatio.Optional("preview_token"): probatio.All(
            cv.string,
            probatio.Match(r"^[0-9a-f]{64}$"),
        ),
    }
)
PREVIEW_ROOM_SEQUENCE_SCHEMA = cv.make_entity_service_schema(_ROOM_SEQUENCE_FIELDS)

PLAN_TARGET_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("include_unmanaged", default=False): cv.boolean,
        probatio.Optional("stop_now", default=False): cv.boolean,
        probatio.Optional("expected_run_id"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
    }
)

RESET_PLAN_HISTORY_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("all_plans", default=False): cv.boolean,
    }
)

RESET_ROOM_CADENCE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("room_id"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("modes"): probatio.All(
            cv.ensure_list,
            [probatio.In(("mop", "coverage"))],
            probatio.Length(min=1, max=2),
        ),
    }
)

DELETE_ROOM_SCHEDULE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("room_id"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Required("expected_token"): probatio.All(
            cv.string, probatio.Match(r"^[0-9a-f]{64}$")
        ),
    }
)

LIST_PLANS_SCHEMA = cv.make_entity_service_schema({})

SAVE_PLAN_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("plan_id"): probatio.All(
            cv.string, probatio.Length(min=1, max=64)
        ),
        probatio.Required("name"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("enabled", default=True): cv.boolean,
        probatio.Optional("run_behavior", default="intelligent"): probatio.In(
            ("intelligent", "ordered")
        ),
        probatio.Required("rooms"): probatio.All(
            cv.ensure_list,
            [saved_plan_entry],
            probatio.Length(min=1, max=MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE),
        ),
        probatio.Optional("return_to_base", default=True): cv.boolean,
        probatio.Optional("finish_current_room", default=False): cv.boolean,
        probatio.Optional("finish_current_room_threshold", default=50): probatio.All(
            probatio.Coerce(int), probatio.Range(min=0, max=100)
        ),
        probatio.Optional("start_timeout", default=120): probatio.All(
            probatio.Coerce(int), probatio.Range(min=10, max=600)
        ),
        probatio.Optional("completion_timeout", default=21600): probatio.All(
            probatio.Coerce(int), probatio.Range(min=60, max=43200)
        ),
        probatio.Optional("select", default=True): cv.boolean,
    }
)

PLAN_REFERENCE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        )
    }
)

SAVE_PLAN_ROOM_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Required("room"): saved_plan_entry,
    }
)

_PLAN_ENTRY_TARGET = {
    probatio.Exclusive("room", "plan_entry"): cv.string,
    probatio.Exclusive("area", "plan_entry"): probatio.All(
        cv.string, probatio.Length(min=1, max=128)
    ),
}

DELETE_PLAN_ROOM_SCHEMA = probatio.All(
    cv.make_entity_service_schema(
        {
            probatio.Required("plan"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
            **_PLAN_ENTRY_TARGET,
        }
    ),
    cv.has_at_least_one_key("room", "area"),
)

MOVE_PLAN_ROOM_SCHEMA = probatio.All(
    cv.make_entity_service_schema(
        {
            probatio.Required("plan"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
            **_PLAN_ENTRY_TARGET,
            # A plan holds up to the room limit and as many custom areas again.
            probatio.Required("new_position"): probatio.All(
                probatio.Coerce(int),
                probatio.Range(min=1, max=2 * MAX_ROOM_SEQUENCE_SIZE),
            ),
        }
    ),
    cv.has_at_least_one_key("room", "area"),
)

INSPECT_ENDPOINT_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("endpoint"): probatio.In(HERMES_ENDPOINT_NAMES),
        probatio.Optional("limit", default=32): probatio.All(
            probatio.Coerce(int), probatio.Range(min=1, max=256)
        ),
    }
)

FIRMWARE_SNAPSHOT_SCHEMA = cv.make_entity_service_schema({})


def _require_matic_control[ServiceResult](
    hass: HomeAssistant,
    handler: Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]],
    *,
    allow_unavailable: bool = False,
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
                for entity_id in _resolve_loaded_matic_vacuums(
                    hass, call, require_available=not allow_unavailable
                ):
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
    """Require an administrator for restricted previews and research routing."""

    @wraps(handler)
    async def async_authorized(call: ServiceCall) -> ServiceResult:
        user_id = call.context.user_id
        if user_id is None:
            raise Unauthorized(context=call.context, permission=POLICY_CONTROL)
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
    if hass.is_running:
        firmware_tracker.replay_reports()
    else:

        @callback
        def _async_replay_firmware_reports(_event: object) -> None:
            firmware_tracker.replay_reports()

        hass.bus.async_listen_once(
            EVENT_HOMEASSISTANT_STARTED, _async_replay_firmware_reports
        )

    async def async_firmware_investigator(call: ServiceCall) -> None:
        """Change research routing without changing any robot behavior."""
        entry = firmware_entry(call)
        if not valid_investigator(call.data["provider"]):
            raise _validation_error(
                "Investigator names are lowercase slugs", "invalid_investigator"
            )
        try:
            await firmware_tracker.async_configure_investigator(
                entry.entry_id, call.data["provider"]
            )
        except ValueError as err:
            raise _validation_error(
                "Firmware evidence is not available yet",
                "firmware_evidence_unavailable",
            ) from err

    async def async_firmware_notification(call: ServiceCall) -> None:
        """Apply a revision-bound notification action from trusted HA code."""
        entry = firmware_entry(call)
        try:
            await firmware_tracker.async_notification_action(
                entry.entry_id,
                call.data["report_id"],
                call.data["revision"],
                call.data["action"],
            )
        except ValueError as err:
            raise _validation_error(
                "The firmware notification is no longer current",
                "firmware_notification_stale",
            ) from err

    def firmware_entry(call: ServiceCall) -> ConfigEntry[Any]:
        entity_ids = _resolve_loaded_matic_vacuums(hass, call, require_available=False)
        if len(entity_ids) != 1:
            raise _validation_error(
                "Firmware actions require exactly one Matic robot",
                "single_robot_required",
            )
        return _entry_for_entity(hass, entity_ids[0])

    hass.services.async_register(
        DOMAIN,
        "firmware_investigator",
        _require_matic_admin(hass, async_firmware_investigator),
        schema=cv.make_entity_service_schema(
            {
                probatio.Required("provider"): probatio.All(
                    cv.string, probatio.Length(min=1, max=48)
                )
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "firmware_notification",
        _require_matic_control(
            hass, async_firmware_notification, allow_unavailable=True
        ),
        schema=cv.make_entity_service_schema(
            {
                probatio.Required("report_id"): probatio.All(
                    cv.string, probatio.Length(min=24, max=24)
                ),
                probatio.Required("revision"): probatio.All(
                    probatio.Coerce(int), probatio.Range(min=1)
                ),
                probatio.Required("action"): probatio.In(
                    ("acknowledge", "delivered", "recheck")
                ),
            }
        ),
    )

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
                    entry.runtime_data.client.async_get_active_cleaning_session_state,
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

    async def async_go_to_room(call: ServiceCall) -> None:
        """Send selected vacuums to one room without cleaning it."""
        await hass.services.async_call(
            VACUUM_DOMAIN,
            "send_command",
            {
                ATTR_ENTITY_ID: _resolve_loaded_matic_vacuums(hass, call),
                "command": "go_to_room",
                "params": {"room": call.data["room"]},
            },
            blocking=True,
            context=call.context,
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_GO_TO_ROOM,
        _require_matic_control(hass, async_go_to_room),
        schema=GO_TO_ROOM_SERVICE_SCHEMA,
    )

    def queue_handler(
        command: str,
    ) -> Callable[[ServiceCall], Coroutine[Any, Any, None]]:
        async def async_change_queue(call: ServiceCall) -> None:
            """Change one room's place in the clean that is running."""
            params = {"room": call.data["room"]}
            if "cleaning_mode" in call.data:
                params["cleaning_mode"] = call.data["cleaning_mode"]
            if "coverage_setting" in call.data:
                params["coverage"] = call.data["coverage_setting"]
            await hass.services.async_call(
                VACUUM_DOMAIN,
                "send_command",
                {
                    ATTR_ENTITY_ID: _resolve_loaded_matic_vacuums(hass, call),
                    "command": command,
                    "params": params,
                },
                blocking=True,
                context=call.context,
            )

        return async_change_queue

    for service, schema in (
        (SERVICE_SKIP_ROOM, GO_TO_ROOM_SERVICE_SCHEMA),
        (SERVICE_CLEAN_ROOM_NEXT, GO_TO_ROOM_SERVICE_SCHEMA),
        (SERVICE_CLEAN_ROOM_AGAIN, CLEAN_ROOM_AGAIN_SERVICE_SCHEMA),
    ):
        hass.services.async_register(
            DOMAIN,
            service,
            _require_matic_control(hass, queue_handler(service)),
            schema=schema,
        )

    async def async_clean_area(call: ServiceCall) -> None:
        """Clean one private saved area without putting coordinates in the call."""
        entity_id, entry, serial_number, _room_map = _saved_plan_context(
            hass, call, require_current_floor=True
        )
        request_generation = manager.motion_generation(serial_number)
        request_stop_generation = manager.stop_request_generation(serial_number)
        request_admission_epoch = manager.command_admission_epoch(serial_number)
        manager.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )

        def require_current_request(expected_motion_generation: int) -> None:
            if manager.motion_generation(serial_number) != expected_motion_generation:
                raise _validation_error(
                    "The cleaning request was superseded before it could start",
                    "robot_command_failed",
                )
            if (
                manager.stop_request_generation(serial_number)
                != request_stop_generation
            ):
                raise _validation_error(
                    "The cleaning request was superseded before it could start",
                    "robot_command_failed",
                )

        await _ensure_stop_settled(
            hass,
            manager,
            serial_number,
            entity_id,
            entry.runtime_data.client.async_get_active_cleaning_session_state,
        )
        require_current_request(request_generation)
        manager.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )
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

        async with manager.external_command(serial_number):
            require_current_request(request_generation)
            await _ensure_stop_settled(
                hass,
                manager,
                serial_number,
                entity_id,
                entry.runtime_data.client.async_get_active_cleaning_session_state,
            )
            require_current_request(request_generation)
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
            require_current_request(request_generation)
            generation = await manager.async_replace_managed_motion(serial_number)
            require_current_request(generation)
            floor_plan = _current_floor_plan(entry)
            floor_plan, circles, mode, coverage = _validated_area_command(
                current_area,
                floor_plan,
                call.data.get("cleaning_mode"),
                call.data.get("coverage_setting"),
            )
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
                and room_completion_names_are_current(floor_plan, rooms)
                and entry.runtime_data.slam_map.floor_plan_is_current(floor_plan)
            )

        initial_preview_token: str | None = None
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
                    "plan_preview_changed",
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
            raise _plan_request_error(err) from err

        def validate_prepared_run() -> None:
            """Revalidate authoritative saved-plan inputs after executor waits."""
            try:
                current_floor = _current_floor_plan(entry)
                current_room_map = {room.id: room.name for room in current_floor.rooms}
                _current_floor, _current_preview, current_token = _saved_plan_preview(
                    manager,
                    serial_number,
                    entry,
                    current_room_map,
                    call.data.get("plan"),
                    intelligent=intelligent,
                )
            except (KeyError, TypeError, ValueError) as err:
                raise _validation_error(
                    "The saved plan can no longer run", "invalid_plan"
                ) from err
            if current_token != initial_preview_token:
                raise _validation_error(
                    "The saved-plan resolution changed before starting",
                    "plan_preview_changed",
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
                entry.runtime_data.client.async_get_active_cleaning_session_state
            ),
            session_history=partial(
                entry.runtime_data.client.async_get_cleaning_session_records,
                strict=True,
            ),
            session_identity=(
                entry.runtime_data.client.async_get_cleaning_session_identity
            ),
            coverage_verifier=getattr(
                entry.runtime_data.client, "async_confirm_coverage_receipt", None
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
            # The run order of rooms and custom areas, when there is an area.
            entries=preview["entries"] if _preview_has_area(preview) else None,
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
            raise _plan_request_error(err) from err
        preview_token = call.data.get("preview_token")
        if preview_token is not None and preview_token != resolved["preview_token"]:
            raise _validation_error(
                "The room-sequence preview is stale; refresh it before starting",
                "room_sequence_preview_changed",
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
                and room_completion_names_are_current(floor_plan, rooms)
                and entry.runtime_data.slam_map.floor_plan_is_current(floor_plan)
            )

        manager.require_command_admission(serial_number)
        internal_plan_id = manager.reserve_manual_room_sequence_plan_id(serial_number)
        try:
            execution_call = ServiceCall(
                hass,
                DOMAIN,
                call.service,
                {
                    "plan_id": internal_plan_id,
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
                current_room_map = {
                    room.id: room.name for room in current_floor_plan.rooms
                }
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
                    raise _plan_request_error(err) from err
                if current["preview_token"] != initial_sequence_token:
                    raise _validation_error(
                        "The room-sequence resolution changed before starting",
                        "room_sequence_preview_changed",
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
                    entry.runtime_data.client.async_get_active_cleaning_session_state
                ),
                session_history=partial(
                    entry.runtime_data.client.async_get_cleaning_session_records,
                    strict=True,
                ),
                session_identity=(
                    entry.runtime_data.client.async_get_cleaning_session_identity
                ),
                coverage_verifier=getattr(
                    entry.runtime_data.client, "async_confirm_coverage_receipt", None
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
        finally:
            manager.release_manual_room_sequence_plan_id(
                serial_number, internal_plan_id
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
            raise _plan_request_error(err) from err
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
            raise _plan_request_error(err) from err
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
        will_dispatch = False
        async with manager.external_command(serial_number):
            run_id = manager.active_run_id(serial_number)
            if "expected_run_id" in call.data and (
                call.data["expected_run_id"] != run_id
                or manager.cancellation_reason(serial_number) == "motion_replaced"
            ):
                raise _validation_error(
                    "The managed cleaning run has changed; Stop was not sent",
                    "managed_run_changed",
                )
            stop_now = bool(call.data.get("stop_now"))
            if stop_now:
                active_plan = manager.snapshot(serial_number).get("active_plan")
                if (
                    not run_id
                    or call.data.get("expected_run_id") != run_id
                    or not isinstance(active_plan, dict)
                    or active_plan.get("run_id") != run_id
                    or active_plan.get("smart_stop_pending") is not True
                    or active_plan.get("smart_stop_phase")
                    not in {"finishing_room", "finishing_area"}
                ):
                    raise _validation_error(
                        "The Smart Stop request is no longer active; "
                        "no new stop was sent",
                        "smart_stop_not_pending",
                    )
            decision = (
                manager.request_stop(serial_number, stop_now=True)
                if stop_now
                else manager.request_stop(serial_number)
            )
            expected_generation = manager.motion_generation(serial_number)
            expected_stop_generation = manager.stop_request_generation(serial_number)
            await manager.async_checkpoint_stop_intent(
                serial_number, decision.behavior, run_id=run_id
            )
            if (
                manager.motion_generation(serial_number) != expected_generation
                or manager.stop_request_generation(serial_number)
                != expected_stop_generation
            ):
                return
            will_dispatch = decision.behavior != "after_room" and (
                decision.behavior != "not_running"
                or bool(call.data.get("include_unmanaged"))
            )
            if will_dispatch:
                manager.reserve_stop_dispatch(
                    serial_number,
                    expected_generation=expected_generation,
                    expected_stop_generation=expected_stop_generation,
                )
        if not will_dispatch:
            return
        if (
            manager.motion_generation(serial_number) == expected_generation
            and manager.stop_request_generation(serial_number)
            == expected_stop_generation
        ):
            entry.runtime_data.coordinator.async_discard_current_room()
        try:
            with manager.managed_stop_dispatch(
                serial_number,
                expected_generation=expected_generation,
                expected_stop_generation=expected_stop_generation,
            ):
                await hass.services.async_call(
                    VACUUM_DOMAIN,
                    "return_to_base",
                    {ATTR_ENTITY_ID: entity_id},
                    blocking=True,
                    context=call.context,
                )
        finally:
            manager.release_stop_dispatch(
                serial_number,
                expected_generation=expected_generation,
                expected_stop_generation=expected_stop_generation,
            )

    hass.services.async_register(
        DOMAIN,
        SERVICE_STOP_INTELLIGENT_CLEANING,
        _require_matic_control(hass, async_stop_intelligent_cleaning),
        schema=PLAN_TARGET_SCHEMA,
    )

    async def async_reset_plan_history(call: ServiceCall) -> None:
        """Reset selected or explicitly named durable cleaning history."""
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
        if room_ids and room_ids[0] not in {room["room_id"] for room in plan["rooms"]}:
            raise _validation_error(
                "The room is not part of the selected plan",
                "room_not_in_plan",
                {"room": room_ids[0], "plan": plan["name"]},
            )
        modes = call.data.get("modes")
        try:
            receipt = await manager.async_reset_cadence(
                serial_number, plan["id"], room_ids=room_ids, modes=modes
            )
        except ValueError as err:
            raise _validation_error(
                "Room schedule progress is in use by a run", "cadence_reset_blocked"
            ) from err
        return {
            "plan_id": plan["id"],
            **receipt,
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_RESET_ROOM_CADENCE,
        _require_matic_control(hass, async_reset_room_cadence),
        schema=RESET_ROOM_CADENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_delete_room_schedule(call: ServiceCall) -> dict[str, Any]:
        """Remove one shared room schedule and detach its saved consumers."""
        _entity_id, entry, serial_number, room_map = _saved_plan_context(
            hass, call, require_rooms=False, require_current_floor=True
        )
        room_id = call.data["room_id"]
        floor_plan = _current_floor_plan(entry)
        if floor_plan is None or room_id not in room_map:
            raise _validation_error(
                "The room is not present on the current map",
                "cadence_delete_map_changed",
            )
        try:
            floor_token = plan_floor_token(floor_plan)
            identity = room_cadence_identity(floor_plan, room_id)
            receipt = await manager.async_delete_room_schedule(
                serial_number,
                room_id,
                call.data["expected_token"],
                floor_token=floor_token,
                identity=identity,
            )
        except SharedRoomScheduleLockedError as err:
            raise _validation_error(
                "The shared room schedule is in use by a cleaning run",
                "cadence_delete_blocked",
            ) from err
        except SharedRoomScheduleMapChangedError as err:
            raise _validation_error(
                "The shared room schedule belongs to a different map",
                "cadence_delete_map_changed",
            ) from err
        except SharedRoomScheduleStaleError as err:
            raise _validation_error(
                "The shared room schedule changed; refresh before deleting",
                "cadence_delete_stale",
            ) from err
        except ValueError as err:
            raise _validation_error(
                "The shared room schedule is not bound to the current map",
                "cadence_delete_map_changed",
            ) from err
        return receipt

    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_ROOM_SCHEDULE,
        _require_matic_control(hass, async_delete_room_schedule),
        schema=DELETE_ROOM_SCHEDULE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
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
            raise _validation_error("Plan ID is empty", "plan_name_unusable")
        rooms: list[dict[str, Any]] = []
        entries: list[dict[str, Any]] = []
        for item in call.data["rooms"]:
            if "area" in item:
                entries.append(
                    _normalize_saved_area(manager, serial_number, entry, item)
                )
                continue
            room = _normalize_saved_room(item, room_map)
            rooms.append(room)
            entries.append({"kind": "room", "room_id": room["room_id"]})
        plan = {
            "name": call.data["name"],
            "enabled": call.data["enabled"],
            "run_behavior": call.data["run_behavior"],
            "rooms": rooms,
            "entries": entries,
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
            raise _validation_error(
                "The saved-plan limit is reached", "plan_limit_reached"
            ) from err
        except ValueError as err:
            raise _plan_request_error(err) from err
        return {"plan": manager.plan(serial_number, plan_id)}

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
            raise _validation_error(
                "The plan is in use by a run", "plan_locked"
            ) from err
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
        entries = _saved_plan_entries(plan)
        item = call.data["room"]
        saved_entry: dict[str, Any]
        if "area" in item:
            saved_entry = _normalize_saved_area(manager, serial_number, entry, item)
        else:
            room = _normalize_saved_room(item, room_map)
            saved_entry = {"kind": "room", "room_id": room["room_id"]}
            if any(saved["room_id"] == room["room_id"] for saved in plan["rooms"]):
                plan["rooms"] = [
                    room if saved["room_id"] == room["room_id"] else saved
                    for saved in plan["rooms"]
                ]
            else:
                plan["rooms"].append(room)
        key = "area_id" if saved_entry["kind"] == "area" else "room_id"
        position = next(
            (
                index
                for index, saved in enumerate(entries)
                if saved["kind"] == saved_entry["kind"]
                and saved[key] == saved_entry[key]
            ),
            None,
        )
        if position is None:
            entries.append(saved_entry)
            position = len(entries) - 1
        else:
            entries[position] = saved_entry
        plan["entries"] = entries
        plan_id = plan.pop("id")
        cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
        try:
            await manager.async_save_plan(
                serial_number,
                plan_id,
                plan,
                select=False,
                floor_token=cadence_floor_token,
                room_identities=room_identities,
            )
        except ValueError as err:
            raise _plan_request_error(err) from err
        persisted = manager.plan(serial_number, plan_id)
        if saved_entry["kind"] == "area":
            return {
                "plan_id": plan_id,
                "position": position + 1,
                "area": plan_entries(persisted)[position],
            }
        persisted_room = next(
            saved
            for saved in persisted["rooms"]
            if saved["room_id"] == saved_entry["room_id"]
        )
        return {
            "plan_id": plan_id,
            "position": position + 1,
            "room": persisted_room,
        }

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
        entries = _saved_plan_entries(plan)
        position = _plan_entry_position(manager, serial_number, room_map, call, entries)
        removed = entries.pop(position)
        deleted: dict[str, Any] = removed
        if removed["kind"] == "room":
            deleted = next(
                room for room in plan["rooms"] if room["room_id"] == removed["room_id"]
            )
            plan["rooms"].remove(deleted)
        plan["entries"] = entries
        if not entries:
            plan["enabled"] = False
        plan_id = plan.pop("id")
        cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
        try:
            await manager.async_save_plan(
                serial_number,
                plan_id,
                plan,
                select=False,
                floor_token=cadence_floor_token,
                room_identities=room_identities,
            )
        except ValueError as err:
            raise _plan_request_error(err) from err
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
        entries = _saved_plan_entries(plan)
        position = (
            _plan_entry_position(manager, serial_number, room_map, call, entries) + 1
        )
        new_position = call.data["new_position"]
        if not 1 <= new_position <= len(entries):
            raise _invalid_room_position(new_position, len(entries))
        moved = entries.pop(position - 1)
        entries.insert(new_position - 1, moved)
        rooms_by_id = {room["room_id"]: room for room in plan["rooms"]}
        plan["rooms"] = [
            rooms_by_id[saved["room_id"]]
            for saved in entries
            if saved["kind"] == "room"
        ]
        plan["entries"] = entries
        plan_id = plan.pop("id")
        cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
        try:
            await manager.async_save_plan(
                serial_number,
                plan_id,
                plan,
                select=False,
                floor_token=cadence_floor_token,
                room_identities=room_identities,
            )
        except ValueError as err:
            raise _plan_request_error(err) from err
        persisted = manager.plan(serial_number, plan_id)
        if moved["kind"] == "area":
            return {
                "plan_id": plan_id,
                "previous_position": position,
                "position": new_position,
                "area": plan_entries(persisted)[new_position - 1],
            }
        persisted_room = next(
            saved
            for saved in persisted["rooms"]
            if saved["room_id"] == moved["room_id"]
        )
        return {
            "plan_id": plan_id,
            "previous_position": position,
            "position": new_position,
            "room": persisted_room,
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
        occurrence_generation = firmware_tracker.occurrence_generation(entry.entry_id)
        snapshot = await async_build_firmware_snapshot(entry.runtime_data.client, state)
        comparison = await firmware_tracker.async_record_snapshot(
            entry.entry_id,
            snapshot,
            occurrence_generation=occurrence_generation,
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
            "The saved custom area is invalid", "invalid_area"
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
        "floor_plan": floor_plan,
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
    # A plan of custom areas alone runs with no rooms.
    if not isinstance(raw_rooms, list) or not (raw_rooms or _preview_has_area(preview)):
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


def _preview_has_area(preview: Mapping[str, Any]) -> bool:
    """Report whether an authoritative preview includes a custom area."""
    entries = preview.get("entries")
    return isinstance(entries, list) and any(
        isinstance(entry, Mapping) and entry.get("kind") == "area" for entry in entries
    )


def _plan_request_error(err: ValueError) -> ServiceValidationError:
    """Translate a rejected plan or room sequence without exposing its text."""
    if isinstance(err, PlanAreaLimitError):
        return _validation_error(
            "The custom area limit is exceeded",
            "plan_area_limit",
            {"limit": str(MAX_ROOM_SEQUENCE_SIZE)},
        )
    if isinstance(err, PlanAreaMissingError):
        return _validation_error(
            "A custom area in the plan no longer exists", "plan_area_missing"
        )
    if isinstance(err, PlanAreaMapChangedError):
        return _validation_error(
            "The saved custom area belongs to a different room map",
            "area_map_changed",
        )
    if isinstance(err, DuplicatePlanAreaError):
        return _validation_error(
            "A custom area appears more than once", "duplicate_area"
        )
    if isinstance(err, RoomSequenceLimitError):
        return _validation_error(
            "The room limit is exceeded",
            "room_sequence_limit",
            {"limit": str(MAX_ROOM_SEQUENCE_SIZE)},
        )
    if isinstance(err, PlanDisabledError):
        return _validation_error("The plan is turned off", "plan_disabled")
    if isinstance(err, EmptyPlanError):
        return _validation_error("The plan has no rooms", "plan_empty")
    if isinstance(err, DuplicateRoomError):
        return _validation_error("A room appears more than once", "duplicate_room")
    if isinstance(err, CadenceBindingError):
        return _validation_error(
            "A shared room schedule has no confirmed map room",
            "room_schedule_map_unconfirmed",
        )
    return _validation_error("The plan request cannot run", "invalid_plan")


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
    raw["room_id"] = _resolve_room_id(str(raw["room"]), room_map)
    resolved = resolve_rooms([raw], room_map)[0]
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


def _normalize_saved_area(
    manager: CleaningPlanManager,
    serial_number: str,
    entry: ConfigEntry[Any],
    item: Mapping[str, Any],
) -> dict[str, Any]:
    """Resolve one saved custom area that is bound to the current map."""
    try:
        area = manager.area(serial_number, item["area"])
    except KeyError as err:
        raise _validation_error(
            f"Unknown Matic custom area: {item['area']}",
            "unknown_area",
            {"area": str(item["area"])},
        ) from err
    _floor_plan, _circles, mode, coverage = _validated_area_command(
        area,
        _current_floor_plan(entry),
        item.get("cleaning_mode"),
        item.get("coverage_setting"),
    )
    return {
        "kind": "area",
        "area_id": area["id"],
        "cleaning_mode": mode.value,
        "coverage_setting": coverage.value,
    }


def _saved_plan_entries(plan: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Read a plan's ordered entries for an edit, or explain why it can't."""
    try:
        return plan_entries(plan)
    except ValueError as err:
        raise _plan_request_error(err) from err


def _plan_entry_position(
    manager: CleaningPlanManager,
    serial_number: str,
    room_map: Mapping[str, str],
    call: ServiceCall,
    entries: Sequence[Mapping[str, Any]],
) -> int:
    """Find the zero-based entry named by an action's room or area field."""
    if "area" not in call.data:
        room_id = _resolve_room_id(call.data["room"], room_map)
        position = next(
            (
                index
                for index, saved in enumerate(entries)
                if saved["kind"] == "room" and saved["room_id"] == room_id
            ),
            None,
        )
        if position is None:
            raise _validation_error(
                f"Room is not part of this plan: {call.data['room']}",
                "unknown_rooms",
                {"rooms": str(call.data["room"])},
            )
        return position
    reference = str(call.data["area"])
    area_ids = [saved["area_id"] for saved in entries if saved["kind"] == "area"]
    try:
        area_id = str(manager.area(serial_number, reference)["id"])
    except KeyError as err:
        # An entry can still name an area that a store edit removed.
        if reference not in area_ids:
            raise _validation_error(
                f"Unknown Matic custom area: {reference}",
                "unknown_area",
                {"area": reference},
            ) from err
        area_id = reference
    if area_id not in area_ids:
        raise _validation_error(
            f"Custom area is not part of this plan: {reference}",
            "area_not_in_plan",
            {"area": reference},
        )
    return next(
        index
        for index, saved in enumerate(entries)
        if saved["kind"] == "area" and saved["area_id"] == area_id
    )


def _resolve_room_id(identifier: str, room_map: Mapping[str, str]) -> str:
    """Resolve one live room ID or unambiguous display name."""
    try:
        room_id, _room_name = resolve_room_reference(identifier, room_map)
    except ValueError as err:
        if str(err).startswith("ambiguous "):
            raise _validation_error(
                f"Ambiguous Matic room: {identifier}",
                "ambiguous_room",
                {"room": identifier},
            ) from err
        raise _validation_error(
            f"Unknown Matic room: {identifier}",
            "unknown_rooms",
            {"rooms": identifier},
        ) from err
    return room_id


def _invalid_room_position(position: int, room_count: int) -> ServiceValidationError:
    return _validation_error(
        f"Room position {position} is invalid; expected 1 through {room_count}",
        "invalid_room_position",
        {"count": str(room_count)},
    )


def _resolve_loaded_matic_vacuums(
    hass: HomeAssistant, call: ServiceCall, *, require_available: bool = True
) -> list[str]:
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
            or (
                require_available
                and (state is None or state.state == STATE_UNAVAILABLE)
            )
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
