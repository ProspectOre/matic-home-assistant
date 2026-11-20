"""Matic Map's star on a photo, which keeps it past the library's limits."""

from __future__ import annotations

import json
from http import HTTPStatus

from aiohttp import ContentTypeError, web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .http import PHOTO_STAR_API_URL, PRIVATE_NO_STORE_HEADERS, runtime_for_entry
from .photo_library import StarLimitError


class MaticPhotoStarView(HomeAssistantView):
    """Star or unstar one saved photo."""

    url = PHOTO_STAR_API_URL
    name = "api:matic_robot:photo_star"

    @require_admin
    async def put(
        self, request: web.Request, entry_id: str, photo_id: str
    ) -> web.Response:
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if request.content_length is not None and request.content_length > 256:
            return _reply({"error": "invalid_request"}, HTTPStatus.BAD_REQUEST)
        try:
            body = await request.json()
        except ContentTypeError, json.JSONDecodeError, UnicodeDecodeError, ValueError:
            return _reply({"error": "invalid_request"}, HTTPStatus.BAD_REQUEST)
        if (
            not isinstance(body, dict)
            or set(body) != {"starred"}
            or not isinstance(body["starred"], bool)
        ):
            return _reply({"error": "invalid_request"}, HTTPStatus.BAD_REQUEST)
        try:
            record = await runtime.photos.async_set_starred(photo_id, body["starred"])
        except StarLimitError:
            return _reply({"error": "star_limit"}, HTTPStatus.CONFLICT)
        if record is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        return _reply({"starred": record.starred}, HTTPStatus.OK)


def _reply(body: dict[str, object], status: HTTPStatus) -> web.Response:
    return web.json_response(body, status=status, headers=PRIVATE_NO_STORE_HEADERS)
