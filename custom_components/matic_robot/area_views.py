"""Authenticated local HTTP view for saved cleaning areas."""

from __future__ import annotations

import json
from http import HTTPStatus
from typing import Any

import probatio
from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView
from homeassistant.util import slugify

from .area_binding import (
    AREA_SCHEMA_VERSION,
    AreaBindingStatus,
    area_binding_allows_review,
    area_binding_needs_geometry_index,
    area_binding_status,
    binding_for_area,
)
from .area_geometry import AreaGeometry, RoomGeometryIndex
from .area_outline import validate_outline
from .client.commands import CleaningMode, CoverageSetting
from .client.models import (
    FloorPlan,
    MapZone,
)
from .client.zones import zone_overlaps_circle, zone_overlaps_polygon
from .http import (
    AREAS_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    runtime_for_entry,
    scene_api_url,
)
from .plan_model import (
    AreaFramePointLimitError,
    AreaInUseError,
    AreaSavePreconditionError,
)
from .plan_repository import MetadataAdmissionClosedError


class MaticAreasView(HomeAssistantView):
    """Manage map-bound custom areas inside the private map workspace."""

    url = AREAS_API_URL
    name = "api:matic_robot:areas"

    @staticmethod
    def _rooms(floor_plan: FloorPlan | None) -> list[dict[str, object]]:
        """Project rooms from one explicit floor-plan snapshot."""
        if floor_plan is None:
            return []
        return [
            {
                "room_id": room.id,
                "name": room.name,
                "boundary": [list(point) for point in room.boundary],
            }
            for room in floor_plan.rooms
        ]

    @staticmethod
    def _zones(
        zones: tuple[MapZone, ...],
        floor_plan: FloorPlan,
        areas: list[dict[str, Any]],
    ) -> list[dict[str, object]]:
        """Project the robot's zones on this map and what each one overlaps."""
        return [
            {
                "kind": zone.kind,
                "outline": [list(point) for point in zone.outline],
                "holes": [[list(point) for point in hole] for hole in zone.holes],
                "room_ids": [
                    room.id
                    for room in floor_plan.rooms
                    if zone_overlaps_polygon(zone, room.boundary)
                ],
                "area_ids": [
                    area["id"]
                    for area in areas
                    if any(
                        zone_overlaps_circle(
                            zone,
                            (float(circle["x"]), float(circle["y"])),
                            float(circle["radius"]),
                        )
                        for circle in area["circles"]
                    )
                ],
            }
            for zone in zones
            if zone.mission_id == floor_plan.mission_id
        ]

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the live map geometry and private saved-area definitions."""
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        if floor_plan is None or not runtime.slam_map.floor_plan_is_current(floor_plan):
            return web.Response(
                status=HTTPStatus.CONFLICT,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "X-Matic-Areas-Conflict": "map-rechecking",
                },
            )
        if not floor_plan.rooms:
            return web.Response(
                status=HTTPStatus.CONFLICT,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "X-Matic-Areas-Conflict": "no-rooms",
                },
            )
        serial_number = str(runtime.coordinator.data.info.serial_number)
        areas = []
        room_geometry = None
        for area_id, area in runtime.cleaning_plans.catalog.areas(
            serial_number
        ).items():
            uses_indexed_binding = area_binding_needs_geometry_index(area)
            if uses_indexed_binding and room_geometry is None:
                room_geometry = RoomGeometryIndex(self._rooms(floor_plan))
            status = area_binding_status(area, floor_plan, room_geometry=room_geometry)
            if status is AreaBindingStatus.GEOMETRY_CHANGED and room_geometry is None:
                room_geometry = RoomGeometryIndex(self._rooms(floor_plan))
            can_rebind = area_binding_allows_review(
                area,
                floor_plan,
                status=status,
                room_geometry=room_geometry,
                circles_already_validated=uses_indexed_binding,
            )
            areas.append(
                {
                    "id": area_id,
                    "name": str(area.get("name", area_id)),
                    "circles": area.get("circles", [])
                    if status is AreaBindingStatus.CURRENT or can_rebind
                    else [],
                    **(
                        {"outline": area["outline"]}
                        if area.get("outline") is not None
                        and (status is AreaBindingStatus.CURRENT or can_rebind)
                        else {}
                    ),
                    "cleaning_mode": area.get(
                        "cleaning_mode", CleaningMode.VACUUM.value
                    ),
                    "coverage_setting": area.get(
                        "coverage_setting", CoverageSetting.OPTIMAL.value
                    ),
                    "status": status.value,
                    "can_rebind": can_rebind,
                }
            )
        return self.json(
            {
                "scene_url": scene_api_url(entry_id),
                "rooms": self._rooms(floor_plan),
                "areas": areas,
                "selected_area": runtime.cleaning_plans.catalog.selected_area(
                    serial_number
                ),
                "zones": self._zones(
                    runtime.coordinator.data.telemetry.zones, floor_plan, areas
                ),
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )

    @require_admin
    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        """Create or replace one validated area on the current map."""
        if request.content_length is not None and request.content_length > 131_072:
            return web.Response(
                status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.coordinator.data.floor_plan
        map_identity = runtime.slam_map.mission_identity
        if (
            floor_plan is None
            or not floor_plan.rooms
            or map_identity is None
            or not runtime.slam_map.floor_plan_is_current(floor_plan)
        ):
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            body = await request.json(loads=json.loads)
            if (
                runtime_for_entry(hass, entry_id) is not runtime
                or runtime.coordinator.data.floor_plan != floor_plan
                or runtime.slam_map.mission_identity != map_identity
                or not runtime.slam_map.floor_plan_is_current(floor_plan)
            ):
                return web.Response(
                    status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
                )
            if not isinstance(body, dict):
                raise ValueError
            name = str(body["name"]).strip()
            if not 1 <= len(name) <= 128:
                raise ValueError
            rooms = self._rooms(floor_plan)
            circles = AreaGeometry(rooms).validate(body["circles"])
            outline = validate_outline(body.get("outline"), circles)
            cleaning_mode = CleaningMode(str(body["cleaning_mode"]))
            coverage_setting = CoverageSetting(str(body["coverage_setting"]))
            binding = binding_for_area(floor_plan, circles)
        except KeyError, TypeError, ValueError, probatio.Invalid:
            return web.Response(
                status=HTTPStatus.BAD_REQUEST, headers=PRIVATE_NO_STORE_HEADERS
            )
        serial_number = str(runtime.coordinator.data.info.serial_number)
        saved = runtime.cleaning_plans.catalog.areas(serial_number)
        requested_id = body.get("area_id")
        if requested_id is None:
            area_id = slugify(name)
            if not area_id or area_id in saved:
                return web.Response(
                    status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
                )
        else:
            area_id = str(requested_id)
            if area_id not in saved:
                return web.Response(
                    status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
                )
        if any(
            key != area_id and str(value.get("name", key)).casefold() == name.casefold()
            for key, value in saved.items()
        ):
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )

        def validate_commit() -> None:
            """Keep request identities valid through the area metadata commit."""
            if (
                runtime_for_entry(hass, entry_id) is not runtime
                or runtime.coordinator.data.floor_plan != floor_plan
                or runtime.slam_map.mission_identity != map_identity
                or not runtime.slam_map.floor_plan_is_current(floor_plan)
            ):
                raise AreaSavePreconditionError
            current_areas = runtime.cleaning_plans.catalog.areas(serial_number)
            if requested_id is None:
                if area_id in current_areas:
                    raise AreaSavePreconditionError
            elif area_id not in current_areas:
                raise AreaSavePreconditionError(not_found=True)
            if any(
                key != area_id
                and str(value.get("name", key)).casefold() == name.casefold()
                for key, value in current_areas.items()
            ):
                raise AreaSavePreconditionError

        try:
            await runtime.cleaning_plans.catalog.async_save_area(
                serial_number,
                area_id,
                {
                    "schema_version": AREA_SCHEMA_VERSION,
                    "name": name,
                    "circles": circles,
                    **({"outline": outline} if outline is not None else {}),
                    "cleaning_mode": cleaning_mode.value,
                    "coverage_setting": coverage_setting.value,
                    "map_binding": binding,
                },
                precondition=validate_commit,
            )
        except AreaSavePreconditionError as err:
            return web.Response(
                status=(HTTPStatus.NOT_FOUND if err.not_found else HTTPStatus.CONFLICT),
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        except MetadataAdmissionClosedError:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        except AreaFramePointLimitError:
            return self.json(
                {"error": "area_boundary_point_limit"},
                status_code=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        return self.json(
            {"id": area_id},
            headers=PRIVATE_NO_STORE_HEADERS,
        )

    @require_admin
    async def delete(self, request: web.Request, entry_id: str) -> web.Response:
        """Delete one saved custom area by its stable identifier."""
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        area_id = str(request.query.get("area_id", ""))
        serial_number = str(runtime.coordinator.data.info.serial_number)
        if area_id not in runtime.cleaning_plans.catalog.areas(serial_number):
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            await runtime.cleaning_plans.catalog.async_delete_area(
                serial_number, area_id
            )
        except MetadataAdmissionClosedError:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        except AreaInUseError as err:
            # Removing the area would leave these plans with nothing to clean.
            return self.json(
                {"plans": list(err.plan_names)},
                status_code=HTTPStatus.CONFLICT,
                headers={
                    **PRIVATE_NO_STORE_HEADERS,
                    "X-Matic-Areas-Conflict": "plan-would-be-empty",
                },
            )
        return web.Response(
            status=HTTPStatus.NO_CONTENT, headers=PRIVATE_NO_STORE_HEADERS
        )
