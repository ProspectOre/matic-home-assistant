"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from collections.abc import (
    Callable,
    Coroutine,
)
from typing import Any, cast

from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.const import (
    ATTR_ENTITY_ID,
)
from homeassistant.core import (
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.util.json import JsonValueType

from . import service_context as context
from .client.exceptions import MaticError
from .const import (
    DOMAIN,
)
from .managed_dispatch import _ensure_stop_settled
from .managed_run import (
    _validation_error,
)
from .photo_patrol import async_photo_patrol
from .room_coherence import current_floor_plan as _current_floor_plan
from .service_context import ServiceRuntime
from .service_names import (
    SERVICE_CLEAN,
    SERVICE_CLEAN_AREA,
    SERVICE_CLEAN_ROOM_AGAIN,
    SERVICE_CLEAN_ROOM_NEXT,
    SERVICE_GO_TO_ROOM,
    SERVICE_PHOTO_PATROL,
    SERVICE_SKIP_ROOM,
)
from .service_plans import (
    _validated_area_command,
)
from .service_schemas import (
    CLEAN_AREA_SERVICE_SCHEMA,
    CLEAN_ROOM_AGAIN_SERVICE_SCHEMA,
    CLEAN_SERVICE_SCHEMA,
    GO_TO_ROOM_SERVICE_SCHEMA,
    PHOTO_PATROL_SERVICE_SCHEMA,
)


def register_controls_services(runtime: ServiceRuntime) -> None:
    """Register this action domain against the shared integration runtime."""
    hass = runtime.hass
    manager = runtime.manager

    async def async_clean(call: ServiceCall) -> None:
        """Route the complete verified cleaning matrix to selected vacuums."""
        entity_ids = context._resolve_loaded_matic_vacuums(hass, call)
        if callable(getattr(manager.control, "stop_pending", None)):
            for entity_id in entity_ids:
                entry = context._entry_for_entity(hass, entity_id)
                await _ensure_stop_settled(
                    hass,
                    manager,
                    entry.runtime_data.session.info.serial_number,
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
        context._require_matic_control(hass, async_clean),
        schema=CLEAN_SERVICE_SCHEMA,
    )

    async def async_go_to_room(call: ServiceCall) -> None:
        """Send selected vacuums to one room without cleaning it."""
        await hass.services.async_call(
            VACUUM_DOMAIN,
            "send_command",
            {
                ATTR_ENTITY_ID: context._resolve_loaded_matic_vacuums(hass, call),
                "command": "go_to_room",
                "params": {"room": call.data["room"]},
            },
            blocking=True,
            context=call.context,
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_GO_TO_ROOM,
        context._require_matic_control(hass, async_go_to_room),
        schema=GO_TO_ROOM_SERVICE_SCHEMA,
    )

    async def async_photo_patrol_call(call: ServiceCall) -> ServiceResponse:
        """Photograph each room in turn with every selected robot."""
        robots: list[JsonValueType] = []
        for entity_id in context._resolve_loaded_matic_vacuums(hass, call):
            photos = await async_photo_patrol(
                hass,
                context._entry_for_entity(hass, entity_id),
                entity_id,
                call.data["rooms"],
                full_resolution=call.data["full_resolution"],
                question=call.data.get("question"),
                ai_task_entity_id=call.data.get("ai_task_entity_id"),
                context=call.context,
            )
            robots.append(
                {"entity_id": entity_id, "photos": cast(list[JsonValueType], photos)}
            )
        return {"robots": robots}

    hass.services.async_register(
        DOMAIN,
        SERVICE_PHOTO_PATROL,
        context._require_matic_control(hass, async_photo_patrol_call),
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
                    ATTR_ENTITY_ID: context._resolve_loaded_matic_vacuums(hass, call),
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
            context._require_matic_control(hass, queue_handler(service)),
            schema=schema,
        )

    async def async_clean_area(call: ServiceCall) -> None:
        """Clean one private saved area without putting coordinates in the call."""
        entity_id, entry, serial_number, _room_map = context._saved_plan_context(
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
            entry.runtime_data.session.floor.value,
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
        await entry.runtime_data.session.heartbeat.async_request_refresh()

    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAN_AREA,
        context._require_matic_control(hass, async_clean_area),
        schema=CLEAN_AREA_SERVICE_SCHEMA,
    )
