"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from collections.abc import Callable, Coroutine, Mapping, Sequence
from functools import partial
from typing import TYPE_CHECKING, Any

from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.const import (
    ATTR_ENTITY_ID,
)
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    SupportsResponse,
)

from . import service_context as context
from .client import FloorPlan
from .const import (
    DOMAIN,
)
from .managed_dispatch import async_managed_user_command
from .managed_executor import async_execute_rooms
from .managed_run import (
    validation_error,
)
from .plan_model import (
    PLAN_SETTING_DEFAULTS,
    CleaningRoom,
    PlanRoomMissingError,
    plan_floor_token,
    plan_setting,
)
from .plans import CleaningPlanManager
from .robot_port import RobotPort
from .room_coherence import current_floor_plan as _current_floor_plan
from .room_coherence import room_completion_names_are_current
from .room_sequence import resolve_room_sequence
from .service_context import ServiceRuntime, register_robot_action
from .service_names import (
    SERVICE_CLEAN_ROOM_SEQUENCE,
    SERVICE_PREVIEW_PLAN,
    SERVICE_PREVIEW_ROOM_SEQUENCE,
    SERVICE_RUN_SELECTED_PLAN,
    SERVICE_STOP_INTELLIGENT_CLEANING,
)
from .service_plans import (
    plan_occupancy_holds,
    plan_request_error,
    preview_has_area,
    resolve_room_id,
    saved_plan_execution,
    saved_plan_preview,
    unknown_plan_error,
)
from .service_schemas import (
    CLEAN_ROOM_SEQUENCE_SCHEMA,
    PLAN_TARGET_SCHEMA,
    PREVIEW_ROOM_SEQUENCE_SCHEMA,
    RUN_SELECTED_PLAN_SCHEMA,
    SAVED_PLAN_SERVICE_SCHEMA,
)
from .stop_return import admit_stop

if TYPE_CHECKING:
    from . import MaticConfigEntry

# The targeted vacuum, its entry, its serial number and its room names by ID.
type _Target = tuple[str, MaticConfigEntry, str, dict[str, str]]


def _floor_is_current(
    entry: MaticConfigEntry, floor_token: str, rooms: Sequence[CleaningRoom]
) -> bool:
    """Keep every native room dispatch bound to the starting map."""
    floor_plan: FloorPlan | None = entry.runtime_data.session.floor.value
    return (
        floor_plan is not None
        and plan_floor_token(floor_plan) == floor_token
        and room_completion_names_are_current(floor_plan, rooms)
        and entry.runtime_data.slam_map.floor_plan_is_current(floor_plan)
    )


def register_execution_services(runtime: ServiceRuntime) -> None:
    """Register this action domain against the shared integration runtime."""
    hass = runtime.hass
    manager = runtime.manager
    register_robot_action(
        hass,
        SERVICE_CLEAN_ROOM_SEQUENCE,
        partial(_async_clean_room_sequence, hass, manager),
        CLEAN_ROOM_SEQUENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    register_robot_action(
        hass,
        SERVICE_PREVIEW_ROOM_SEQUENCE,
        partial(_async_preview_room_sequence, hass, manager),
        PREVIEW_ROOM_SEQUENCE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
        admin_only=True,
    )
    register_robot_action(
        hass,
        SERVICE_RUN_SELECTED_PLAN,
        partial(_async_run_selected_plan, hass, manager),
        RUN_SELECTED_PLAN_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    register_robot_action(
        hass,
        SERVICE_PREVIEW_PLAN,
        partial(_async_preview_plan, hass, manager),
        SAVED_PLAN_SERVICE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    register_robot_action(
        hass,
        SERVICE_STOP_INTELLIGENT_CLEANING,
        partial(_async_stop_intelligent_cleaning, hass, manager),
        PLAN_TARGET_SCHEMA,
    )


async def _async_run_selected_plan(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    call: ServiceCall,
    entity_ids: list[str],
) -> dict[str, Any]:
    """Run a saved plan in its saved cleaning order, or the one asked for."""
    run_behavior = call.data.get("run_behavior")
    preview_token = call.data.get("preview_token")
    target = context.saved_plan_context(hass, entity_ids, require_current_floor=True)
    entity_id, entry, serial_number, room_map = target
    execution_floor_plan = _current_floor_plan(entry)
    execution_floor_token = plan_floor_token(execution_floor_plan)
    # Occupancy is read once at admission. A sensor that changes while the
    # run waits for the robot does not invalidate the run.
    preview_plan = partial(
        saved_plan_preview,
        manager,
        serial_number,
        entry,
        plan_reference=call.data.get("plan"),
        intelligent=None if run_behavior is None else run_behavior == "intelligent",
        held_rooms=plan_occupancy_holds(
            hass, manager, serial_number, entity_id, call.data.get("plan"), room_map
        ),
    )
    try:
        _preview_floor, preview, initial_preview_token = preview_plan(room_map)
        if preview_token is not None and preview_token != initial_preview_token:
            raise validation_error(
                "The saved-plan preview is stale; refresh it before starting",
                "plan_preview_changed",
            )
        if _only_daily_limit_holds(preview):
            raise validation_error(
                "Every selected room has reached its daily cleaning limit",
                "daily_room_limit_reached",
            )
        plan, rooms, cadence_by_room = saved_plan_execution(
            manager, serial_number, execution_floor_plan, preview
        )
    except KeyError as err:
        raise unknown_plan_error(err) from err
    except ValueError as err:
        raise plan_request_error(err) from err

    data = {
        "plan_id": plan["id"],
        "start_timeout": int(plan_setting(plan, "start_timeout")),
        "completion_timeout": int(plan_setting(plan, "completion_timeout")),
        "return_to_base": bool(plan_setting(plan, "return_to_base")),
    }
    run = partial(
        _async_execute,
        hass,
        manager,
        ServiceCall(hass, DOMAIN, call.service, data, context=call.context),
        target,
        rooms,
        execution_floor_token,
        cadence_by_room=cadence_by_room,
        validate_prepared_run=partial(
            _require_unchanged_plan, entry, preview_plan, initial_preview_token
        ),
        # The run order of rooms and custom areas, when there is an area.
        entries=preview["entries"] if preview_has_area(preview) else None,
        held_rooms=preview.get("held_rooms", ()),
        missing_rooms=preview.get("missing_rooms", ()),
    )
    return await _async_start(hass, manager, call, run)


def _require_unchanged_plan(
    entry: MaticConfigEntry,
    preview_plan: Callable[[Mapping[str, str]], tuple[FloorPlan, dict[str, Any], str]],
    preview_token: str,
) -> None:
    """Revalidate authoritative saved-plan inputs after executor waits."""
    try:
        current_floor = _current_floor_plan(entry)
        current_room_map = {room.id: room.name for room in current_floor.rooms}
        _current_floor, _current_preview, current_token = preview_plan(current_room_map)
    except PlanRoomMissingError as err:
        raise plan_request_error(err) from err
    except (KeyError, TypeError, ValueError) as err:
        raise validation_error(
            "The saved plan can no longer run", "invalid_plan"
        ) from err
    if current_token != preview_token:
        raise validation_error(
            "The saved-plan resolution changed before starting",
            "plan_preview_changed",
        )


def _only_daily_limit_holds(preview: Mapping[str, Any]) -> bool:
    """Return whether the daily limit left a plan nothing to clean."""
    return bool(
        preview.get("daily_limit_held_rooms")
        and not preview.get("rooms")
        and not preview_has_area(preview)
    )


async def _async_execute(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    execution_call: ServiceCall,
    target: _Target,
    rooms: list[CleaningRoom],
    floor_token: str,
    on_started: Callable[[str], None],
    *,
    cadence_by_room: Mapping[str, Mapping[str, Any]],
    validate_prepared_run: Callable[[], None],
    entries: Sequence[Mapping[str, Any]] | None = None,
    held_rooms: Sequence[Mapping[str, str]] = (),
    missing_rooms: Sequence[Mapping[str, str | None]] = (),
) -> str:
    """Hand one resolved run to the executor, bound to its robot and map."""
    entity_id, entry, serial_number, room_map = target
    return await async_execute_rooms(
        hass,
        execution_call,
        manager,
        entity_id,
        serial_number,
        rooms,
        robot=RobotPort.for_entry(hass, entry, entity_id),
        managed_user_command=partial(
            async_managed_user_command,
            hass,
            entry,
            manager,
            serial_number,
            entity_id,
            execution_call.context,
        ),
        mapped_room_names=tuple(room_map.values()),
        floor_is_current=partial(_floor_is_current, entry, floor_token, rooms),
        floor_token=floor_token,
        on_started=on_started,
        cadence_by_room=cadence_by_room,
        validate_prepared_run=validate_prepared_run,
        entries=entries,
        held_rooms=held_rooms,
        missing_rooms=missing_rooms,
    )


async def _async_start(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    call: ServiceCall,
    run: Callable[[Callable[[str], None]], Coroutine[Any, Any, str]],
) -> dict[str, Any]:
    """Start the run in the background; with ``wait``, return when it ends."""
    run_id = await manager.control.async_start_run(
        hass,
        run,
        f"{DOMAIN} {call.service}",
        wait=bool(call.data.get("wait", False)),
    )
    return {"run_id": run_id}


def _resolve_sequence(
    manager: CleaningPlanManager,
    serial_number: str,
    entry: MaticConfigEntry,
    floor_plan: FloorPlan,
    room_map: Mapping[str, str],
    data: Mapping[str, Any],
) -> dict[str, Any]:
    """Resolve the room sequence a call asks for against one floor plan."""
    try:
        return resolve_room_sequence(
            manager,
            serial_number,
            floor_plan,
            room_map,
            data["rooms"],
            entry_id=entry.entry_id,
            return_to_base=bool(data["return_to_base"]),
            use_room_schedule=bool(data.get("use_room_schedule", False)),
            override_room_schedule=bool(data.get("override_room_schedule", False)),
            room_resolver=resolve_room_id,
        )
    except ValueError as err:
        raise plan_request_error(err) from err


async def _async_clean_room_sequence(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    call: ServiceCall,
    entity_ids: list[str],
) -> dict[str, Any]:
    """Start an unsaved ordered room sequence with per-room settings."""
    target = context.saved_plan_context(hass, entity_ids, require_current_floor=True)
    _entity_id, entry, serial_number, room_map = target
    execution_floor_plan = _current_floor_plan(entry)
    execution_floor_token = plan_floor_token(execution_floor_plan)
    resolved = _resolve_sequence(
        manager, serial_number, entry, execution_floor_plan, room_map, call.data
    )
    preview_token = call.data.get("preview_token")
    if resolved.get("blocker") == "daily_limit_reached":
        raise validation_error(
            "Every selected room has reached its daily cleaning limit",
            "daily_room_limit_reached",
        )
    if preview_token is not None and preview_token != resolved["preview_token"]:
        raise validation_error(
            "The room-sequence preview is stale; refresh it before starting",
            "room_sequence_preview_changed",
        )

    manager.control.require_command_admission(serial_number)
    internal_plan_id = manager.catalog.reserve_manual_room_sequence_plan_id(
        serial_number
    )
    data = {
        "plan_id": internal_plan_id,
        "start_timeout": PLAN_SETTING_DEFAULTS["start_timeout"],
        "completion_timeout": PLAN_SETTING_DEFAULTS["completion_timeout"],
        "return_to_base": bool(call.data["return_to_base"]),
    }
    execute = partial(
        _async_execute,
        hass,
        manager,
        ServiceCall(hass, DOMAIN, call.service, data, context=call.context),
        target,
        resolved["effective_rooms"],
        execution_floor_token,
        cadence_by_room=resolved["cadence_by_room"],
        validate_prepared_run=partial(
            _require_unchanged_sequence,
            manager,
            serial_number,
            entry,
            call.data,
            resolved["preview_token"],
        ),
    )

    async def run(on_started: Callable[[str], None]) -> str:
        try:
            return await execute(on_started)
        finally:
            manager.catalog.release_manual_room_sequence_plan_id(
                serial_number, internal_plan_id
            )

    return await _async_start(hass, manager, call, run)


def _require_unchanged_sequence(
    manager: CleaningPlanManager,
    serial_number: str,
    entry: MaticConfigEntry,
    data: Mapping[str, Any],
    preview_token: str,
) -> None:
    """Reject map, policy, settings, or progress changes before dispatch."""
    current_floor_plan = _current_floor_plan(entry)
    current_room_map = {room.id: room.name for room in current_floor_plan.rooms}
    current = _resolve_sequence(
        manager, serial_number, entry, current_floor_plan, current_room_map, data
    )
    if current["preview_token"] != preview_token:
        raise validation_error(
            "The room-sequence resolution changed before starting",
            "room_sequence_preview_changed",
        )


async def _async_preview_room_sequence(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    call: ServiceCall,
    entity_ids: list[str],
) -> dict[str, Any]:
    """Return the current authoritative resolution of a room sequence."""
    _entity_id, entry, serial_number, room_map = context.saved_plan_context(
        hass, entity_ids, require_current_floor=True
    )
    resolved = _resolve_sequence(
        manager, serial_number, entry, _current_floor_plan(entry), room_map, call.data
    )
    return {
        "entry_id": resolved["entry_id"],
        "floor_token": resolved["floor_token"],
        "preview_token": resolved["preview_token"],
        "rooms": resolved["rooms"],
        "mission_boundaries": resolved["mission_boundaries"],
        "blocker": resolved["blocker"],
        "daily_limit_held_rooms": resolved.get("daily_limit_held_rooms", []),
    }


async def _async_preview_plan(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    call: ServiceCall,
    entity_ids: list[str],
) -> dict[str, Any]:
    """Validate and return the exact next saved-plan execution."""
    entity_id, entry, serial_number, room_map = context.saved_plan_context(
        hass, entity_ids, require_current_floor=True
    )
    try:
        _floor_plan, preview, preview_token = saved_plan_preview(
            manager,
            serial_number,
            entry,
            room_map,
            call.data.get("plan"),
            held_rooms=plan_occupancy_holds(
                hass,
                manager,
                serial_number,
                entity_id,
                call.data.get("plan"),
                room_map,
            ),
        )
    except KeyError as err:
        raise unknown_plan_error(err) from err
    except ValueError as err:
        raise plan_request_error(err) from err
    result = {"entity_id": entity_id, **preview, "preview_token": preview_token}
    if _only_daily_limit_holds(preview):
        result["blocker"] = "daily_limit_reached"
    return result


async def _async_stop_intelligent_cleaning(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    call: ServiceCall,
    entity_ids: list[str],
) -> None:
    """Apply the active plan's stop policy and send the robot home."""
    entity_id, entry, serial_number, _room_map = context.saved_plan_context(
        hass, entity_ids, require_rooms=False
    )
    fence = await _async_reserve_stop(manager, serial_number, call.data)
    if fence is None:
        return
    expected_generation, expected_stop_generation = fence
    if (
        manager.control.motion_generation(serial_number) == expected_generation
        and manager.control.stop_request_generation(serial_number)
        == expected_stop_generation
    ):
        entry.runtime_data.session.heartbeat.async_discard_current_room()
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


async def _async_reserve_stop(
    manager: CleaningPlanManager, serial_number: str, data: Mapping[str, Any]
) -> tuple[int, int] | None:
    """Admit the stop and reserve its dispatch.

    Returns the motion and stop generations the dispatch is fenced to, or
    None when there is nothing to send.
    """
    async with admit_stop(
        manager,
        serial_number,
        stop_now=bool(data.get("stop_now")),
        require=partial(_require_expected_run, manager, serial_number, data),
    ) as admitted:
        if admitted is None:
            return None
        will_dispatch = admitted.behavior != "after_room" and (
            admitted.behavior != "not_running" or bool(data.get("include_unmanaged"))
        )
        if not will_dispatch:
            return None
        manager.control.reserve_stop_dispatch(
            serial_number,
            expected_generation=admitted.generation,
            expected_stop_generation=admitted.stop_generation,
        )
        return admitted.generation, admitted.stop_generation


def _require_expected_run(
    manager: CleaningPlanManager,
    serial_number: str,
    data: Mapping[str, Any],
    run_id: str | None,
) -> None:
    """Refuse a Stop aimed at a run that is no longer the active one."""
    if "expected_run_id" in data and (
        data["expected_run_id"] != run_id
        or manager.control.cancellation_reason(serial_number) == "motion_replaced"
    ):
        raise validation_error(
            "The managed cleaning run has changed; Stop was not sent",
            "managed_run_changed",
        )
    if data.get("stop_now"):
        _require_pending_smart_stop(manager, serial_number, data, run_id)


def _require_pending_smart_stop(
    manager: CleaningPlanManager,
    serial_number: str,
    data: Mapping[str, Any],
    run_id: str | None,
) -> None:
    """Refuse Stop now unless this run is finishing a room or area to stop."""
    if (
        not run_id
        or data.get("expected_run_id") != run_id
        or manager.control.smart_stop_phase(serial_number)
        not in {"finishing_room", "finishing_area"}
    ):
        raise validation_error(
            "The Smart Stop request is no longer active; no new stop was sent",
            "smart_stop_not_pending",
        )
