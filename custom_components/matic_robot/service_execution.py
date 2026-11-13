"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.const import (
    ATTR_ENTITY_ID,
)
from homeassistant.core import (
    ServiceCall,
    SupportsResponse,
)

from . import service_context as context
from .client.commands import UserCommand
from .client.models import FloorPlan
from .const import (
    DOMAIN,
)
from .managed_dispatch import _async_managed_user_command
from .managed_executor import _async_execute_rooms
from .managed_run import (
    _validation_error,
)
from .plan_model import (
    plan_floor_token,
)
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
    _plan_occupancy_holds,
    _plan_request_error,
    _preview_has_area,
    _resolve_room_id,
    _saved_plan_execution,
    _saved_plan_preview,
)
from .service_schemas import (
    CLEAN_ROOM_SEQUENCE_SCHEMA,
    PLAN_TARGET_SCHEMA,
    PREVIEW_ROOM_SEQUENCE_SCHEMA,
    RUN_SELECTED_PLAN_SCHEMA,
    SAVED_PLAN_SERVICE_SCHEMA,
)


def register_execution_services(runtime: ServiceRuntime) -> None:
    """Register this action domain against the shared integration runtime."""
    hass = runtime.hass
    manager = runtime.manager

    async def async_run_saved_plan(
        call: ServiceCall,
        entity_ids: list[str],
        *,
        intelligent: bool | None,
        preview_token: str | None = None,
    ) -> dict[str, Any]:
        """Resolve and start a saved plan's run; return its run_id."""
        entity_id, entry, serial_number, room_map = context._saved_plan_context(
            hass, entity_ids, require_current_floor=True
        )
        execution_floor_plan = _current_floor_plan(entry)
        execution_floor_token = plan_floor_token(execution_floor_plan)

        def floor_is_current() -> bool:
            """Keep every native room dispatch bound to the starting map."""
            floor_plan: FloorPlan | None = entry.runtime_data.session.floor.value
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
            if (
                preview.get("daily_limit_held_rooms")
                and not preview.get("rooms")
                and not _preview_has_area(preview)
            ):
                raise _validation_error(
                    "Every selected room has reached its daily cleaning limit",
                    "daily_room_limit_reached",
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

        async def run(on_started: Callable[[str], None]) -> str:
            return await _async_execute_rooms(
                hass,
                execution_call,
                manager,
                entity_id,
                serial_number,
                rooms,
                robot=RobotPort.for_entry(hass, entry, entity_id),
                cadence_by_room=cadence_by_room,
                managed_user_command=async_managed_command,
                mapped_room_names=tuple(room_map.values()),
                floor_is_current=floor_is_current,
                floor_token=execution_floor_token,
                validate_prepared_run=validate_prepared_run,
                # The run order of rooms and custom areas, when there is an area.
                entries=preview["entries"] if _preview_has_area(preview) else None,
                held_rooms=preview.get("held_rooms", ()),
                on_started=on_started,
            )

        return await _async_start(call, run)

    async def _async_start(
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

    async def async_clean_room_sequence(
        call: ServiceCall, entity_ids: list[str]
    ) -> dict[str, Any]:
        """Start an unsaved ordered room sequence with per-room settings."""
        entity_id, entry, serial_number, room_map = context._saved_plan_context(
            hass, entity_ids, require_current_floor=True
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
                entry_id=entry.entry_id,
                return_to_base=bool(call.data["return_to_base"]),
                use_room_schedule=use_room_schedule,
                override_room_schedule=override_room_schedule,
                room_resolver=_resolve_room_id,
            )
        except ValueError as err:
            raise _plan_request_error(err) from err
        preview_token = call.data.get("preview_token")
        if resolved.get("blocker") == "daily_limit_reached":
            raise _validation_error(
                "Every selected room has reached its daily cleaning limit",
                "daily_room_limit_reached",
            )
        if preview_token is not None and preview_token != resolved["preview_token"]:
            raise _validation_error(
                "The room-sequence preview is stale; refresh it before starting",
                "room_sequence_preview_changed",
            )
        rooms = resolved["effective_rooms"]
        cadence_by_room = resolved["cadence_by_room"]

        def floor_is_current() -> bool:
            floor_plan: FloorPlan | None = entry.runtime_data.session.floor.value
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
            current_room_map = {room.id: room.name for room in current_floor_plan.rooms}
            try:
                current = resolve_room_sequence(
                    manager,
                    serial_number,
                    current_floor_plan,
                    current_room_map,
                    call.data["rooms"],
                    entry_id=entry.entry_id,
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

        async def run(on_started: Callable[[str], None]) -> str:
            try:
                return await _async_execute_rooms(
                    hass,
                    execution_call,
                    manager,
                    entity_id,
                    serial_number,
                    rooms,
                    robot=RobotPort.for_entry(hass, entry, entity_id),
                    cadence_by_room=cadence_by_room,
                    managed_user_command=async_managed_command,
                    mapped_room_names=tuple(room_map.values()),
                    floor_is_current=floor_is_current,
                    floor_token=execution_floor_token,
                    validate_prepared_run=validate_prepared_run,
                    on_started=on_started,
                )
            finally:
                manager.catalog.release_manual_room_sequence_plan_id(
                    serial_number, internal_plan_id
                )

        return await _async_start(call, run)

    register_robot_action(
        hass,
        SERVICE_CLEAN_ROOM_SEQUENCE,
        async_clean_room_sequence,
        CLEAN_ROOM_SEQUENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_preview_room_sequence(
        call: ServiceCall, entity_ids: list[str]
    ) -> dict[str, Any]:
        """Return the current authoritative resolution of a room sequence."""
        _entity_id, entry, serial_number, room_map = context._saved_plan_context(
            hass, entity_ids, require_current_floor=True
        )
        floor_plan = _current_floor_plan(entry)
        try:
            resolved = resolve_room_sequence(
                manager,
                serial_number,
                floor_plan,
                room_map,
                call.data["rooms"],
                entry_id=entry.entry_id,
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
            "daily_limit_held_rooms": resolved.get("daily_limit_held_rooms", []),
        }

    register_robot_action(
        hass,
        SERVICE_PREVIEW_ROOM_SEQUENCE,
        async_preview_room_sequence,
        PREVIEW_ROOM_SEQUENCE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
        admin_only=True,
    )

    async def async_run_selected_plan(
        call: ServiceCall, entity_ids: list[str]
    ) -> dict[str, Any]:
        """Run a saved plan in its saved cleaning order, or the one asked for."""
        run_behavior = call.data.get("run_behavior")
        return await async_run_saved_plan(
            call,
            entity_ids,
            intelligent=None if run_behavior is None else run_behavior == "intelligent",
            preview_token=call.data.get("preview_token"),
        )

    register_robot_action(
        hass,
        SERVICE_RUN_SELECTED_PLAN,
        async_run_selected_plan,
        RUN_SELECTED_PLAN_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_preview_plan(
        call: ServiceCall, entity_ids: list[str]
    ) -> dict[str, Any]:
        """Validate and return the exact next saved-plan execution."""
        entity_id, entry, serial_number, room_map = context._saved_plan_context(
            hass, entity_ids, require_current_floor=True
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
        result = {"entity_id": entity_id, **preview, "preview_token": preview_token}
        if (
            preview.get("daily_limit_held_rooms")
            and not preview.get("rooms")
            and not _preview_has_area(preview)
        ):
            result["blocker"] = "daily_limit_reached"
        return result

    register_robot_action(
        hass,
        SERVICE_PREVIEW_PLAN,
        async_preview_plan,
        SAVED_PLAN_SERVICE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_stop_intelligent_cleaning(
        call: ServiceCall, entity_ids: list[str]
    ) -> None:
        """Apply the active plan's stop policy and send the robot home."""
        entity_id, entry, serial_number, _room_map = context._saved_plan_context(
            hass, entity_ids, require_rooms=False
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
                active_plan = manager.history.snapshot(serial_number).get("active_plan")
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
            await manager.recovery.async_checkpoint_stop_intent(
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

    register_robot_action(
        hass,
        SERVICE_STOP_INTELLIGENT_CLEANING,
        async_stop_intelligent_cleaning,
        PLAN_TARGET_SCHEMA,
    )
