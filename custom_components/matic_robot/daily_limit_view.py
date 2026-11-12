"""Authenticated local API for map-bound daily room limits."""

from __future__ import annotations

import json
from http import HTTPStatus

from aiohttp import ContentTypeError, web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .http import (
    DAILY_LIMIT_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    runtime_for_entry,
)
from .plan_model import (
    SharedRoomScheduleLockedError,
    plan_floor_token,
    room_cadence_identity,
)
from .plan_repository import MetadataAdmissionClosedError
from .plan_schema import DailyLimitRefusal, DailyLimitRefused, DailyLimitSet


class MaticDailyLimitView(HomeAssistantView):
    """Set or clear the shared daily completion cap for a current map room."""

    url = DAILY_LIMIT_API_URL
    name = "api:matic_robot:daily_room_limit"

    @require_admin
    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        """Set one bounded limit after revalidating the live floor identity."""
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        if request.content_length is not None and request.content_length > 4096:
            return self._json_error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "invalid_request"
            )
        try:
            # Untrusted: the type names the fields; each is validated below.
            body: DailyLimitSet = await request.json()
        except ContentTypeError, json.JSONDecodeError, UnicodeDecodeError, ValueError:
            return self._json_error(HTTPStatus.BAD_REQUEST, "invalid_json")
        if not isinstance(body, dict) or set(body) != {
            "room_id",
            "floor_token",
            "limit",
        }:
            return self._json_error(HTTPStatus.BAD_REQUEST, "invalid_request")
        room_id = body.get("room_id")
        floor_token = body.get("floor_token")
        limit = body.get("limit")
        if (
            not isinstance(room_id, str)
            or not room_id
            or len(room_id) > 256
            or not isinstance(floor_token, str)
            or len(floor_token) != 64
            or any(char not in "0123456789abcdef" for char in floor_token)
            or (
                limit is not None
                and (
                    isinstance(limit, bool)
                    or not isinstance(limit, int)
                    or not 1 <= limit <= 100
                )
            )
        ):
            return self._json_error(HTTPStatus.BAD_REQUEST, "invalid_request")

        floor_plan = runtime.session.floor.value
        if (
            floor_plan is None
            or not runtime.slam_map.floor_plan_is_current(floor_plan)
            or plan_floor_token(floor_plan) != floor_token
        ):
            return self._json_error(HTTPStatus.CONFLICT, "map_rechecking")
        try:
            identity = room_cadence_identity(floor_plan, room_id)
        except ValueError:
            return self._json_error(HTTPStatus.CONFLICT, "room_identity_unconfirmed")

        def require_current() -> bool:
            """Recheck both accepted map revision and target room identity."""
            current = runtime.session.floor.value
            if (
                current is None
                or not runtime.slam_map.floor_plan_is_current(current)
                or plan_floor_token(current) != floor_token
            ):
                return False
            try:
                return room_cadence_identity(current, room_id) == identity
            except ValueError:
                return False

        try:
            state = await runtime.cleaning_plans.cadence.async_set_daily_limit(
                str(runtime.session.info.serial_number),
                room_id,
                room_identity=identity,
                limit=limit,
                require_current=require_current,
            )
        except SharedRoomScheduleLockedError:
            return self._json_error(HTTPStatus.CONFLICT, "room_reserved")
        except MetadataAdmissionClosedError:
            return self._json_error(HTTPStatus.CONFLICT, "runtime_unloading")
        except ValueError as err:
            reason: DailyLimitRefusal = (
                "map_rechecking" if "map changed" in str(err) else "invalid_request"
            )
            status = (
                HTTPStatus.CONFLICT
                if reason == "map_rechecking"
                else HTTPStatus.BAD_REQUEST
            )
            return self._json_error(status, reason)
        return self.json(state, headers=PRIVATE_NO_STORE_HEADERS)

    def _json_error(
        self, status: HTTPStatus, reason: DailyLimitRefusal
    ) -> web.Response:
        refused: DailyLimitRefused = {"error": reason}
        return self.json(refused, status_code=status, headers=PRIVATE_NO_STORE_HEADERS)
