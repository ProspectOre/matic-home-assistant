"""Photo tour and viewpoint actions."""

from __future__ import annotations

import math
from typing import cast

from homeassistant.core import ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.util.json import JsonValueType

from . import service_context as context
from .client import pose_observation_is_current
from .const import CONF_PHOTO_NO_PHOTO_ROOMS
from .photo_tours import TourStop, async_run_photo_tour
from .robot_commands import validation_error
from .service_context import ServiceRuntime, register_robot_action
from .service_names import (
    SERVICE_DELETE_PHOTO_VIEWPOINT,
    SERVICE_RUN_PHOTO_TOUR,
    SERVICE_SAVE_PHOTO_VIEWPOINT,
)
from .service_schemas import (
    DELETE_PHOTO_VIEWPOINT_SERVICE_SCHEMA,
    RUN_PHOTO_TOUR_SERVICE_SCHEMA,
    SAVE_PHOTO_VIEWPOINT_SERVICE_SCHEMA,
)


def register_photo_services(runtime: ServiceRuntime) -> None:
    """Register the photo tour and viewpoint actions."""
    hass = runtime.hass

    async def async_run_tour(
        call: ServiceCall, entity_ids: list[str]
    ) -> ServiceResponse:
        """Run the tour's stops with every selected robot in turn."""
        stops = [TourStop(**stop) for stop in call.data["stops"]]
        robots: list[JsonValueType] = []
        for entity_id in entity_ids:
            photos = await async_run_photo_tour(
                hass,
                context._entry_for_entity(hass, entity_id),
                entity_id,
                stops,
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
        SERVICE_RUN_PHOTO_TOUR,
        async_run_tour,
        RUN_PHOTO_TOUR_SERVICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_save_viewpoint(
        call: ServiceCall, entity_ids: list[str]
    ) -> ServiceResponse:
        """Save a viewpoint from the given spot, or where each robot stands."""
        robots: list[JsonValueType] = []
        for entity_id in entity_ids:
            entry = context._entry_for_entity(hass, entity_id)
            session = entry.runtime_data.session
            floor_plan = session.floor.value
            if floor_plan is None:
                raise validation_error(
                    "The robot's map is unavailable", "viewpoint_map_unavailable"
                )
            if "x" in call.data:
                x, y = call.data["x"], call.data["y"]
                heading = math.radians(call.data["heading"])
            else:
                pose = session.pose_on(floor_plan)
                if (
                    not pose_observation_is_current(pose, floor_plan)
                    or pose.heading is None
                ):
                    raise validation_error(
                        "The robot's position and direction are unknown",
                        "viewpoint_pose_unavailable",
                    )
                x, y, heading = pose.x, pose.y, pose.heading
            viewpoint = await entry.runtime_data.viewpoints.async_save(
                call.data["name"],
                floor_plan,
                session.telemetry.value.zones,
                set(entry.options.get(CONF_PHOTO_NO_PHOTO_ROOMS, ())),
                x=x,
                y=y,
                heading=heading,
            )
            room = next(
                room.name for room in floor_plan.rooms if room.id == viewpoint.room_id
            )
            robots.append(
                {
                    "entity_id": entity_id,
                    "viewpoint_id": viewpoint.viewpoint_id,
                    "name": viewpoint.name,
                    "room": room,
                }
            )
        return {"robots": robots}

    register_robot_action(
        hass,
        SERVICE_SAVE_PHOTO_VIEWPOINT,
        async_save_viewpoint,
        SAVE_PHOTO_VIEWPOINT_SERVICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
        admin_only=True,
    )

    async def async_delete_viewpoint(call: ServiceCall, entity_ids: list[str]) -> None:
        """Delete a viewpoint from each selected robot."""
        for entity_id in entity_ids:
            entry = context._entry_for_entity(hass, entity_id)
            await entry.runtime_data.viewpoints.async_delete(call.data["viewpoint"])

    register_robot_action(
        hass,
        SERVICE_DELETE_PHOTO_VIEWPOINT,
        async_delete_viewpoint,
        DELETE_PHOTO_VIEWPOINT_SERVICE_SCHEMA,
        admin_only=True,
    )
