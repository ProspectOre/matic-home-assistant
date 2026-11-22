"""Matic Map's saves and deletes of photo viewpoints."""

from __future__ import annotations

import json
from http import HTTPStatus
from typing import TYPE_CHECKING, cast

from aiohttp import ContentTypeError, web
from homeassistant.components.http.decorators import require_admin
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .http import (
    PRIVATE_NO_STORE_HEADERS,
    VIEWPOINT_API_URL,
    VIEWPOINTS_API_URL,
    runtime_for_entry,
)
from .photo_gallery_view import viewpoint_json
from .slam_view_data import map_session_key
from .viewpoints import async_save_viewpoint, current_floor_plan

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticConfigEntry

_FIELDS = {"name", "x", "y", "heading", "map_session_key"}
# Refusals that mean the map Matic Map placed the spot on is not the robot's now.
_MAP_REFUSALS = {"map_changed", "viewpoint_map_unavailable"}


class MaticViewpointsView(HomeAssistantView):
    """Save a viewpoint placed on the map Matic Map shows."""

    url = VIEWPOINTS_API_URL
    name = "api:matic_robot:viewpoints"

    @require_admin
    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        entry = _loaded_entry(request.app[KEY_HASS], entry_id)
        if entry is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if request.content_length is not None and request.content_length > 4096:
            return _refused("invalid_request", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            body = await request.json()
        except ContentTypeError, json.JSONDecodeError, UnicodeDecodeError, ValueError:
            return _refused("invalid_request")
        if not isinstance(body, dict) or set(body) != _FIELDS:
            return _refused("invalid_request")
        name, key = body["name"], body["map_session_key"]
        spot = (body["x"], body["y"], body["heading"])
        if (
            not isinstance(name, str)
            or not isinstance(key, str)
            or any(
                isinstance(value, bool) or not isinstance(value, int | float)
                for value in spot
            )
        ):
            return _refused("invalid_request")
        x, y, heading = (float(value) for value in spot)
        try:
            floor_plan = current_floor_plan(entry)
            # The spot is in the coordinates of the map Matic Map showed.
            if map_session_key(entry.runtime_data) != key:
                return _refused("map_changed")
            viewpoint = await async_save_viewpoint(
                entry, floor_plan, name, x=x, y=y, heading=heading
            )
        except ServiceValidationError as err:
            return _refused(str(err.translation_key))
        return web.json_response(
            viewpoint_json(viewpoint),
            status=HTTPStatus.CREATED,
            headers=PRIVATE_NO_STORE_HEADERS,
        )


class MaticViewpointView(HomeAssistantView):
    """Delete one saved viewpoint."""

    url = VIEWPOINT_API_URL
    name = "api:matic_robot:viewpoint"

    @require_admin
    async def delete(
        self, request: web.Request, entry_id: str, viewpoint_id: str
    ) -> web.Response:
        entry = _loaded_entry(request.app[KEY_HASS], entry_id)
        viewpoints = entry and entry.runtime_data.viewpoints
        # By ID only: the action's name lookup could match a different viewpoint.
        if not viewpoints or all(
            item.viewpoint_id != viewpoint_id for item in viewpoints.all
        ):
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        await viewpoints.async_delete(viewpoint_id)
        return web.Response(
            status=HTTPStatus.NO_CONTENT, headers=PRIVATE_NO_STORE_HEADERS
        )


def _loaded_entry(hass: HomeAssistant, entry_id: str) -> MaticConfigEntry | None:
    if runtime_for_entry(hass, entry_id) is None:
        return None
    return cast("MaticConfigEntry", hass.config_entries.async_get_entry(entry_id))


def _refused(reason: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST) -> web.Response:
    if reason in _MAP_REFUSALS:
        status = HTTPStatus.CONFLICT
    return web.json_response(
        {"error": reason}, status=status, headers=PRIVATE_NO_STORE_HEADERS
    )
