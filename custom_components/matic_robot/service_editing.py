"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from typing import Any

from homeassistant.core import (
    ServiceCall,
    SupportsResponse,
)
from homeassistant.util import slugify

from . import service_context as context
from .const import (
    DOMAIN,
)
from .managed_run import (
    _validation_error,
)
from .plan_catalog import SavedPlanLimitError
from .plan_model import (
    SharedRoomScheduleLockedError,
    SharedRoomScheduleMapChangedError,
    SharedRoomScheduleStaleError,
    plan_floor_token,
    room_cadence_identity,
)
from .room_coherence import current_floor_plan as _current_floor_plan
from .service_context import ServiceRuntime
from .service_names import (
    SERVICE_DELETE_PLAN,
    SERVICE_DELETE_ROOM_SCHEDULE,
    SERVICE_LIST_PLANS,
    SERVICE_RESET_PLAN_HISTORY,
    SERVICE_RESET_ROOM_CADENCE,
    SERVICE_SAVE_PLAN,
)
from .service_plans import (
    _normalize_saved_area,
    _normalize_saved_room,
    _plan_cadence_bindings,
    _plan_request_error,
    _resolve_saved_plan,
)
from .service_schemas import (
    DELETE_ROOM_SCHEDULE_SCHEMA,
    LIST_PLANS_SCHEMA,
    PLAN_REFERENCE_SCHEMA,
    RESET_PLAN_HISTORY_SCHEMA,
    RESET_ROOM_CADENCE_SCHEMA,
    SAVE_PLAN_SCHEMA,
)


def register_editing_services(runtime: ServiceRuntime) -> None:
    """Register this action domain against the shared integration runtime."""
    hass = runtime.hass
    manager = runtime.manager

    async def async_reset_plan_history(call: ServiceCall) -> None:
        """Reset selected or explicitly named durable cleaning history."""
        _entity_id, _entry, serial_number, _room_map = context._saved_plan_context(
            hass, call
        )
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
        context._require_matic_control(hass, async_reset_plan_history),
        schema=RESET_PLAN_HISTORY_SCHEMA,
    )

    async def async_reset_room_cadence(call: ServiceCall) -> dict[str, Any]:
        """Reset cadence counters without resetting completion history."""
        _entity_id, _entry, serial_number, _room_map = context._saved_plan_context(
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
        context._require_matic_control(hass, async_reset_room_cadence),
        schema=RESET_ROOM_CADENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_delete_room_schedule(call: ServiceCall) -> dict[str, Any]:
        """Remove one shared room schedule and detach its saved consumers."""
        _entity_id, entry, serial_number, room_map = context._saved_plan_context(
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
        context._require_matic_control(hass, async_delete_room_schedule),
        schema=DELETE_ROOM_SCHEDULE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_list_plans(call: ServiceCall) -> dict[str, Any]:
        """Return every canonical plan definition and current selection."""
        entity_id, _entry, serial_number, room_map = context._saved_plan_context(
            hass, call, require_rooms=False
        )
        snapshot = manager.history.snapshot(serial_number)
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
        context._require_matic_control(hass, async_list_plans),
        schema=LIST_PLANS_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_save_plan(call: ServiceCall) -> dict[str, Any]:
        """Create or atomically replace a complete saved plan."""
        _entity_id, entry, serial_number, room_map = context._saved_plan_context(
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
        context._require_matic_control(hass, async_save_plan),
        schema=SAVE_PLAN_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_delete_plan(call: ServiceCall) -> dict[str, Any]:
        """Delete one plan by ID or human-readable name."""
        _entity_id, _entry, serial_number, _room_map = context._saved_plan_context(
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
        context._require_matic_control(hass, async_delete_plan),
        schema=PLAN_REFERENCE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
