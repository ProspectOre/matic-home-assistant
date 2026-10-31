"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from collections.abc import (
    Callable,
    Coroutine,
)
from functools import partial, wraps
from typing import Any, cast

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
    ServiceResponse,
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
from homeassistant.util.json import JsonValueType

from .client.commands import UserCommand
from .client.endpoints import HERMES_ENDPOINT_MAP
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
from .firmware_reports import valid_investigator
from .managed_dispatch import _async_managed_user_command, _ensure_stop_settled
from .managed_executor import _async_execute_rooms
from .managed_run import (
    _validation_error,
)
from .photo_patrol import async_photo_patrol
from .plan_catalog import SavedPlanLimitError
from .plan_model import (
    SharedRoomScheduleLockedError,
    SharedRoomScheduleMapChangedError,
    SharedRoomScheduleStaleError,
    plan_entries,
    plan_floor_token,
    room_cadence_identity,
)
from .plans import CleaningPlanManager, async_get_plan_manager
from .room_coherence import current_floor_plan as _current_floor_plan
from .room_coherence import room_completion_names_are_current
from .room_sequence import resolve_room_sequence
from .service_plans import (
    _invalid_room_position,
    _normalize_saved_area,
    _normalize_saved_room,
    _plan_cadence_bindings,
    _plan_entry_position,
    _plan_occupancy_holds,
    _plan_request_error,
    _preview_has_area,
    _resolve_room_id,
    _resolve_saved_plan,
    _saved_plan_entries,
    _saved_plan_execution,
    _saved_plan_preview,
    _validated_area_command,
)
from .service_schemas import (
    CLEAN_AREA_SERVICE_SCHEMA,
    CLEAN_ROOM_AGAIN_SERVICE_SCHEMA,
    CLEAN_ROOM_SEQUENCE_SCHEMA,
    CLEAN_SERVICE_SCHEMA,
    DELETE_PLAN_ROOM_SCHEMA,
    DELETE_ROOM_SCHEDULE_SCHEMA,
    FIRMWARE_SNAPSHOT_SCHEMA,
    GO_TO_ROOM_SERVICE_SCHEMA,
    INSPECT_ENDPOINT_SERVICE_SCHEMA,
    LIST_PLANS_SCHEMA,
    MOVE_PLAN_ROOM_SCHEMA,
    PHOTO_PATROL_SERVICE_SCHEMA,
    PLAN_REFERENCE_SCHEMA,
    PLAN_TARGET_SCHEMA,
    PREVIEW_ROOM_SEQUENCE_SCHEMA,
    RESET_PLAN_HISTORY_SCHEMA,
    RESET_ROOM_CADENCE_SCHEMA,
    RUN_SELECTED_PLAN_SCHEMA,
    SAVE_PLAN_ROOM_SCHEMA,
    SAVE_PLAN_SCHEMA,
    SAVED_PLAN_SERVICE_SCHEMA,
)

SERVICE_CLEAN = "clean"
SERVICE_CLEAN_ROOM_SEQUENCE = "clean_room_sequence"
SERVICE_CLEAN_AREA = "clean_area"
SERVICE_GO_TO_ROOM = "go_to_room"
SERVICE_PHOTO_PATROL = "photo_patrol"
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
        if callable(getattr(manager.control, "stop_pending", None)):
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

    async def async_photo_patrol_call(call: ServiceCall) -> ServiceResponse:
        """Photograph each room in turn with every selected robot."""
        robots: list[JsonValueType] = []
        for entity_id in _resolve_loaded_matic_vacuums(hass, call):
            photos = await async_photo_patrol(
                hass,
                _entry_for_entity(hass, entity_id),
                entity_id,
                call.data["rooms"],
                full_resolution=call.data["full_resolution"],
                context=call.context,
            )
            robots.append(
                {"entity_id": entity_id, "photos": cast(list[JsonValueType], photos)}
            )
        return {"robots": robots}

    hass.services.async_register(
        DOMAIN,
        SERVICE_PHOTO_PATROL,
        _require_matic_control(hass, async_photo_patrol_call),
        schema=PHOTO_PATROL_SERVICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
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
        request_generation = manager.control.motion_generation(serial_number)
        request_stop_generation = manager.control.stop_request_generation(serial_number)
        request_admission_epoch = manager.control.command_admission_epoch(serial_number)
        manager.control.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )

        def require_current_request(expected_motion_generation: int) -> None:
            if (
                manager.control.motion_generation(serial_number)
                != expected_motion_generation
            ):
                raise _validation_error(
                    "The cleaning request was superseded before it could start",
                    "robot_command_failed",
                )
            if (
                manager.control.stop_request_generation(serial_number)
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
        manager.control.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )
        try:
            area = manager.catalog.area(serial_number, call.data["area"])
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

        async with manager.control.external_command(serial_number):
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
                current_area = manager.catalog.area(serial_number, call.data["area"])
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
            generation = await manager.control.async_replace_managed_motion(
                serial_number
            )
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
        # Occupancy is read once at admission. A sensor that changes while the
        # run waits for the robot does not invalidate the run.
        held_rooms = _plan_occupancy_holds(
            hass, manager, serial_number, entity_id, call.data.get("plan"), room_map
        )
        try:
            _preview_floor, preview, initial_preview_token = _saved_plan_preview(
                manager,
                serial_number,
                entry,
                room_map,
                call.data.get("plan"),
                intelligent=intelligent,
                held_rooms=held_rooms,
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
                    held_rooms=held_rooms,
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
            held_rooms=preview.get("held_rooms", ()),
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

        manager.control.require_command_admission(serial_number)
        internal_plan_id = manager.catalog.reserve_manual_room_sequence_plan_id(
            serial_number
        )
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
            manager.catalog.release_manual_room_sequence_plan_id(
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
                held_rooms=_plan_occupancy_holds(
                    hass,
                    manager,
                    serial_number,
                    entity_id,
                    call.data.get("plan"),
                    room_map,
                ),
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
        async with manager.control.external_command(serial_number):
            run_id = manager.ledger.active_run_id(serial_number)
            if "expected_run_id" in call.data and (
                call.data["expected_run_id"] != run_id
                or manager.control.cancellation_reason(serial_number)
                == "motion_replaced"
            ):
                raise _validation_error(
                    "The managed cleaning run has changed; Stop was not sent",
                    "managed_run_changed",
                )
            stop_now = bool(call.data.get("stop_now"))
            if stop_now:
                active_plan = manager.ledger.snapshot(serial_number).get("active_plan")
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
                manager.control.request_stop(serial_number, stop_now=True)
                if stop_now
                else manager.control.request_stop(serial_number)
            )
            expected_generation = manager.control.motion_generation(serial_number)
            expected_stop_generation = manager.control.stop_request_generation(
                serial_number
            )
            await manager.ledger.async_checkpoint_stop_intent(
                serial_number, decision.behavior, run_id=run_id
            )
            if (
                manager.control.motion_generation(serial_number) != expected_generation
                or manager.control.stop_request_generation(serial_number)
                != expected_stop_generation
            ):
                return
            will_dispatch = decision.behavior != "after_room" and (
                decision.behavior != "not_running"
                or bool(call.data.get("include_unmanaged"))
            )
            if will_dispatch:
                manager.control.reserve_stop_dispatch(
                    serial_number,
                    expected_generation=expected_generation,
                    expected_stop_generation=expected_stop_generation,
                )
        if not will_dispatch:
            return
        if (
            manager.control.motion_generation(serial_number) == expected_generation
            and manager.control.stop_request_generation(serial_number)
            == expected_stop_generation
        ):
            entry.runtime_data.coordinator.async_discard_current_room()
        try:
            with manager.control.managed_stop_dispatch(
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
            manager.control.release_stop_dispatch(
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
                plan_id = manager.catalog.plan(serial_number, call.data.get("plan"))[
                    "id"
                ]
            except KeyError as err:
                raise _validation_error(
                    f"Unknown Matic cleaning plan: {err.args[0]}",
                    "unknown_plan",
                    {"plan": str(err.args[0])},
                ) from err
        await manager.ledger.async_reset_history(serial_number, plan_id)

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
            receipt = await manager.cadence.async_reset_cadence(
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
            receipt = await manager.cadence.async_delete_room_schedule(
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
        snapshot = manager.ledger.snapshot(serial_number)
        return {
            "entity_id": entity_id,
            "selected_plan": snapshot.get("selected_plan"),
            "room_count": len(room_map),
            "plans": [
                {"id": plan_id, **plan}
                for plan_id, plan in manager.catalog.plans(serial_number).items()
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
            "occupancy_aware": call.data["occupancy_aware"],
            "occupancy_sensors": {
                room_id: sensor
                for room_id, sensor in call.data["occupancy_sensors"].items()
                if room_id in {room["room_id"] for room in rooms}
            },
            "start_timeout": call.data["start_timeout"],
            "completion_timeout": call.data["completion_timeout"],
        }
        try:
            cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
            await manager.catalog.async_save_plan(
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
        return {"plan": manager.catalog.plan(serial_number, plan_id)}

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
            await manager.catalog.async_delete_plan(serial_number, plan["id"])
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
        await manager.catalog.async_select_plan(serial_number, plan["id"])
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
            await manager.catalog.async_save_plan(
                serial_number,
                plan_id,
                plan,
                select=False,
                floor_token=cadence_floor_token,
                room_identities=room_identities,
            )
        except ValueError as err:
            raise _plan_request_error(err) from err
        persisted = manager.catalog.plan(serial_number, plan_id)
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
            sensors = plan.get("occupancy_sensors")
            if isinstance(sensors, dict):
                sensors.pop(str(removed["room_id"]), None)
        plan["entries"] = entries
        if not entries:
            plan["enabled"] = False
        plan_id = plan.pop("id")
        cadence_floor_token, room_identities = _plan_cadence_bindings(entry)
        try:
            await manager.catalog.async_save_plan(
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
            await manager.catalog.async_save_plan(
                serial_number,
                plan_id,
                plan,
                select=False,
                floor_token=cadence_floor_token,
                room_identities=room_identities,
            )
        except ValueError as err:
            raise _plan_request_error(err) from err
        persisted = manager.catalog.plan(serial_number, plan_id)
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
