"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import replace
from functools import partial
from typing import TYPE_CHECKING, Any

from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
)

from . import service_context as context
from .client import MaticError, QueueAction
from .managed_run import (
    validation_error,
)
from .plans import CleaningPlanManager
from .robot_controls import QUEUE_COMMANDS, RobotControls, queue_options
from .room_coherence import current_floor_plan as _current_floor_plan
from .service_context import ServiceRuntime, register_robot_action
from .service_names import (
    SERVICE_CLEAN,
    SERVICE_CLEAN_AREA,
    SERVICE_CLEAN_ROOM_AGAIN,
    SERVICE_CLEAN_ROOM_NEXT,
    SERVICE_GO_TO_ROOM,
    SERVICE_SKIP_ROOM,
)
from .service_plans import (
    validated_area_command,
)
from .service_schemas import (
    CLEAN_AREA_SERVICE_SCHEMA,
    CLEAN_ROOM_AGAIN_SERVICE_SCHEMA,
    CLEAN_SERVICE_SCHEMA,
    GO_TO_ROOM_SERVICE_SCHEMA,
)

if TYPE_CHECKING:
    pass


def register_controls_services(runtime: ServiceRuntime) -> None:
    """Register this action domain against the shared integration runtime."""
    hass = runtime.hass
    manager = runtime.manager
    register_robot_action(
        hass, SERVICE_CLEAN, partial(_async_clean, hass), CLEAN_SERVICE_SCHEMA
    )
    register_robot_action(
        hass,
        SERVICE_GO_TO_ROOM,
        partial(_async_go_to_room, hass),
        GO_TO_ROOM_SERVICE_SCHEMA,
    )
    for service, schema in (
        (SERVICE_SKIP_ROOM, GO_TO_ROOM_SERVICE_SCHEMA),
        (SERVICE_CLEAN_ROOM_NEXT, GO_TO_ROOM_SERVICE_SCHEMA),
        (SERVICE_CLEAN_ROOM_AGAIN, CLEAN_ROOM_AGAIN_SERVICE_SCHEMA),
    ):
        register_robot_action(
            hass, service, partial(_async_change_queue, hass, service), schema
        )
    register_robot_action(
        hass,
        SERVICE_CLEAN_AREA,
        partial(_async_clean_area, hass, manager),
        CLEAN_AREA_SERVICE_SCHEMA,
    )


async def _async_clean(
    hass: HomeAssistant, call: ServiceCall, entity_ids: list[str]
) -> None:
    """Route the complete verified cleaning matrix to selected vacuums."""
    for entity_id in entity_ids:
        entry = context.entry_for_entity(hass, entity_id)
        await RobotControls(hass, entry, entity_id).async_ensure_stop_settled(
            entry.runtime_data.session.info.serial_number
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


async def _async_go_to_room(
    hass: HomeAssistant, call: ServiceCall, entity_ids: list[str]
) -> None:
    """Send selected vacuums to one room without cleaning it."""
    await _async_each_robot(
        hass,
        entity_ids,
        lambda robot: robot.async_go_to_room(call.data["room"]),
    )


async def _async_change_queue(
    hass: HomeAssistant, command: str, call: ServiceCall, entity_ids: list[str]
) -> None:
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
        lambda robot: robot.async_change_queue(action, call.data["room"], **options),
    )


async def _async_clean_area(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    call: ServiceCall,
    entity_ids: list[str],
) -> None:
    """Clean one private saved area without putting coordinates in the call."""
    entity_id, entry, serial_number, _room_map = context.saved_plan_context(
        hass, entity_ids, require_current_floor=True
    )
    commands = RobotControls(hass, entry, entity_id)
    area_command = partial(
        validated_area_command,
        cleaning_mode=call.data.get("cleaning_mode"),
        coverage_setting=call.data.get("coverage_setting"),
    )
    fence = await commands.async_admit_motion()
    area = _saved_area(manager, serial_number, call.data["area"])
    area_command(area, entry.runtime_data.session.floor.value)

    # Check the area again before taking motion, so a missing or moved area
    # never replaces a plan's ownership.
    async with commands.motion_lease(fence, take_motion=False):
        current_area = _saved_area(manager, serial_number, call.data["area"])
        area_command(current_area, _current_floor_plan(entry))
        generation = await manager.control.async_replace_managed_motion(serial_number)
        commands.require_fence(replace(fence, generation=generation))
        floor_plan, circles, mode, coverage = area_command(
            current_area, _current_floor_plan(entry)
        )
        try:
            await entry.runtime_data.client.async_start_custom_coverage(
                floor_plan,
                circles,
                cleaning_mode=mode,
                coverage_setting=coverage,
            )
        except MaticError as err:
            raise validation_error(
                "The robot could not start the custom-area clean",
                "robot_command_failed",
            ) from err
    await entry.runtime_data.session.heartbeat.async_request_refresh()


def _saved_area(
    manager: CleaningPlanManager, serial_number: str, name: str
) -> dict[str, Any]:
    """Return the saved custom area a call names."""
    try:
        return manager.catalog.area(serial_number, name)
    except KeyError as err:
        raise validation_error(
            f"Unknown Matic custom area: {name}",
            "unknown_area",
            {"area": str(name)},
        ) from err


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
        RobotControls(hass, context.entry_for_entity(hass, entity_id), entity_id)
        for entity_id in entity_ids
    ]
    results = await asyncio.gather(
        *(send(robot) for robot in robots if robot.reachable),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, BaseException):
            raise result
