"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Coroutine
from typing import Any, cast

from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.util.json import JsonValueType

from . import service_context as context
from .client import MaticError, QueueAction
from .managed_dispatch import _ensure_stop_settled
from .managed_run import (
    _validation_error,
)
from .photo_patrol import async_photo_patrol
from .robot_controls import QUEUE_COMMANDS, RobotControls, queue_options
from .room_coherence import current_floor_plan as _current_floor_plan
from .service_context import ServiceRuntime, register_robot_action
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

    async def async_clean(call: ServiceCall, entity_ids: list[str]) -> None:
        """Route the complete verified cleaning matrix to selected vacuums."""
        for entity_id in entity_ids:
            entry = context._entry_for_entity(hass, entity_id)
            await _ensure_stop_settled(
                hass,
                manager,
                entry.runtime_data.session.info.serial_number,
                entity_id,
                entry.runtime_data.client.async_get_active_cleaning_session_state,
                entry.runtime_data.client.async_get_state,
            )
        await _async_each_robot(
            hass,
            entity_ids,
            lambda robot: robot.async_clean(
                call.data.get("rooms"),
                cleaning_mode=call.data.get("cleaning_mode"),
                coverage=call.data.get("coverage_setting"),
                ordered=call.data["ordered"],
            ),
        )

    register_robot_action(hass, SERVICE_CLEAN, async_clean, CLEAN_SERVICE_SCHEMA)

    async def async_go_to_room(call: ServiceCall, entity_ids: list[str]) -> None:
        """Send selected vacuums to one room without cleaning it."""
        await _async_each_robot(
            hass,
            entity_ids,
            lambda robot: robot.async_go_to_room(call.data["room"]),
        )

    register_robot_action(
        hass, SERVICE_GO_TO_ROOM, async_go_to_room, GO_TO_ROOM_SERVICE_SCHEMA
    )

    async def async_photo_patrol_call(
        call: ServiceCall, entity_ids: list[str]
    ) -> ServiceResponse:
        """Photograph each room in turn with every selected robot."""
        robots: list[JsonValueType] = []
        for entity_id in entity_ids:
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

    register_robot_action(
        hass,
        SERVICE_PHOTO_PATROL,
        async_photo_patrol_call,
        PHOTO_PATROL_SERVICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    def queue_handler(
        command: str,
    ) -> Callable[[ServiceCall, list[str]], Coroutine[Any, Any, None]]:
        async def async_change_queue(call: ServiceCall, entity_ids: list[str]) -> None:
            """Change one room's place in the clean that is running."""
            action = QUEUE_COMMANDS[command]
            params = {"room": call.data["room"]}
            if "cleaning_mode" in call.data:
                params["cleaning_mode"] = call.data["cleaning_mode"]
            if "coverage_setting" in call.data:
                params["coverage"] = call.data["coverage_setting"]
            options = queue_options(params) if action is QueueAction.CLEAN_AGAIN else {}
            await _async_each_robot(
                hass,
                entity_ids,
                lambda robot: robot.async_change_queue(
                    action, call.data["room"], **options
                ),
            )

        return async_change_queue

    for service, schema in (
        (SERVICE_SKIP_ROOM, GO_TO_ROOM_SERVICE_SCHEMA),
        (SERVICE_CLEAN_ROOM_NEXT, GO_TO_ROOM_SERVICE_SCHEMA),
        (SERVICE_CLEAN_ROOM_AGAIN, CLEAN_ROOM_AGAIN_SERVICE_SCHEMA),
    ):
        register_robot_action(hass, service, queue_handler(service), schema)

    async def async_clean_area(call: ServiceCall, entity_ids: list[str]) -> None:
        """Clean one private saved area without putting coordinates in the call."""
        entity_id, entry, serial_number, _room_map = context._saved_plan_context(
            hass, entity_ids, require_current_floor=True
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
            entry.runtime_data.client.async_get_state,
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
                entry.runtime_data.client.async_get_state,
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

    register_robot_action(
        hass, SERVICE_CLEAN_AREA, async_clean_area, CLEAN_AREA_SERVICE_SCHEMA
    )


async def _async_each_robot(
    hass: HomeAssistant,
    entity_ids: list[str],
    send: Callable[[RobotControls], Awaitable[None]],
) -> None:
    """Send to each reachable robot at once and raise the first failure.

    This is what the vacuum action these calls replaced did: it skipped an
    unavailable vacuum and ran the others concurrently.
    """
    robots = [
        RobotControls(hass, context._entry_for_entity(hass, entity_id), entity_id)
        for entity_id in entity_ids
    ]
    results = await asyncio.gather(
        *(send(robot) for robot in robots if robot.reachable),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, BaseException):
            raise result
