"""Photo tour and viewpoint actions."""

from __future__ import annotations

import math
from datetime import timedelta
from typing import Any, cast

from homeassistant.components.http.auth import async_sign_path
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.util.json import JsonValueType

from . import service_context as context
from .client import pose_observation_is_current
from .photo_tours import TourStop, async_run_photo_tour, check_photo_tour
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
from .viewpoints import async_save_viewpoint, current_floor_plan

# A phone or other notify target fetches the photo without signing in.
PHOTO_LINK_LIFETIME = timedelta(hours=24)


def signed_photo(hass: HomeAssistant, photo: dict[str, Any]) -> dict[str, Any]:
    """Sign the photo's links so each opens that one photo for a day."""
    return photo | {
        key: async_sign_path(
            hass, photo[key], PHOTO_LINK_LIFETIME, use_content_user=True
        )
        for key in ("url", "preview_url")
        if key in photo
    }


def register_photo_services(runtime: ServiceRuntime) -> None:
    """Register the photo tour and viewpoint actions."""
    hass = runtime.hass

    async def async_run_tour(
        call: ServiceCall, entity_ids: list[str]
    ) -> ServiceResponse:
        """Run the tour's stops with every selected robot in turn."""
        stops = [TourStop(**stop) for stop in call.data["stops"]]
        entries = [
            context._entry_for_entity(hass, entity_id) for entity_id in entity_ids
        ]
        # Viewpoints are per robot: refuse a stop any robot lacks before one moves.
        for entry in entries:
            check_photo_tour(entry, stops)
        robots: list[JsonValueType] = []
        for entity_id, entry in zip(entity_ids, entries, strict=True):
            photos = await async_run_photo_tour(
                hass,
                entry,
                entity_id,
                stops,
                full_resolution=call.data["full_resolution"],
                question=call.data.get("question"),
                ai_task_entity_id=call.data.get("ai_task_entity_id"),
                context=call.context,
            )
            signed = [signed_photo(hass, photo) for photo in photos]
            robots.append(
                {"entity_id": entity_id, "photos": cast(list[JsonValueType], signed)}
            )
        return {"robots": robots}

    register_robot_action(
        hass,
        SERVICE_RUN_PHOTO_TOUR,
        async_run_tour,
        RUN_PHOTO_TOUR_SERVICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def async_save_action(
        call: ServiceCall, entity_ids: list[str]
    ) -> ServiceResponse:
        """Save a viewpoint from the given spot, or where the robot stands."""
        entity_id = _one_robot(entity_ids)
        entry = context._entry_for_entity(hass, entity_id)
        floor_plan = current_floor_plan(entry)
        if "x" in call.data:
            x, y = call.data["x"], call.data["y"]
            heading = math.radians(call.data["heading"])
        else:
            pose = entry.runtime_data.session.pose_on(floor_plan)
            if (
                not pose_observation_is_current(pose, floor_plan)
                or pose.heading is None
            ):
                raise validation_error(
                    "The robot's position and direction are unknown",
                    "viewpoint_pose_unavailable",
                )
            x, y, heading = pose.x, pose.y, pose.heading
        viewpoint = await async_save_viewpoint(
            entry, floor_plan, call.data["name"], x=x, y=y, heading=heading
        )
        room = next(
            room.name for room in floor_plan.rooms if room.id == viewpoint.room_id
        )
        robot: JsonValueType = {
            "entity_id": entity_id,
            "viewpoint_id": viewpoint.viewpoint_id,
            "name": viewpoint.name,
            "room": room,
        }
        return {"robots": [robot]}

    register_robot_action(
        hass,
        SERVICE_SAVE_PHOTO_VIEWPOINT,
        async_save_action,
        SAVE_PHOTO_VIEWPOINT_SERVICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
        admin_only=True,
    )

    async def async_delete_viewpoint(call: ServiceCall, entity_ids: list[str]) -> None:
        """Delete a viewpoint from the selected robot."""
        entry = context._entry_for_entity(hass, _one_robot(entity_ids))
        await entry.runtime_data.viewpoints.async_delete(call.data["viewpoint"])

    register_robot_action(
        hass,
        SERVICE_DELETE_PHOTO_VIEWPOINT,
        async_delete_viewpoint,
        DELETE_PHOTO_VIEWPOINT_SERVICE_SCHEMA,
        admin_only=True,
    )


def _one_robot(entity_ids: list[str]) -> str:
    """A viewpoint is a spot on one robot's map, so its actions take one robot."""
    if len(entity_ids) != 1:
        raise validation_error(
            "Viewpoints belong to exactly one Matic robot", "single_robot_required"
        )
    return entity_ids[0]
