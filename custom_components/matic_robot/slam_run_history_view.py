"""Serve cleaning runs from Home Assistant and native robot history."""

from __future__ import annotations

import asyncio
from http import HTTPStatus

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.exceptions import MaticError
from .client.models import CleaningSessionRecord
from .http import PRIVATE_NO_STORE_HEADERS, RUNS_API_URL, runtime_for_entry
from .run_history import RUN_HISTORY_LIMIT, RunTrails
from .slam_view_data import _map_session_key

RUNS_NATIVE_READ_SECONDS = 15


class MaticRunHistoryView(HomeAssistantView):
    """Serve recent cleaning runs and their trails to the private workspace."""

    url = RUNS_API_URL
    name = "api:matic_robot:runs"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return the run list, or one trail when ``trail`` names it."""
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        trails: RunTrails | None = getattr(runtime, "run_trails", None)
        if runtime is None or trails is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        map_key = _map_session_key(runtime)
        trail_id = request.query.get("trail")
        if trail_id is not None:
            segments = trails.segments(trail_id, map_key)
            if segments is None:
                return web.Response(
                    status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
                )
            return self.json(
                {
                    "trail": trail_id,
                    "map_session_key": map_key,
                    "segments": [
                        [list(point) for point in segment] for segment in segments
                    ],
                },
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        native: tuple[CleaningSessionRecord, ...] = ()
        robot_history = True
        try:
            async with asyncio.timeout(RUNS_NATIVE_READ_SECONDS):
                native = await runtime.client.async_get_cleaning_session_records()
        except MaticError, TimeoutError:
            robot_history = False
        serial_number = str(runtime.session.info.serial_number)
        runs = runtime.cleaning_plans.history.run_history(serial_number, native)
        for run in runs:
            run["trail"] = (
                trails.trail_id(map_key, run_id=run["id"])
                if run["source"] == "home_assistant"
                else trails.trail_id(
                    map_key,
                    window=(run["started_at"], run["ended_at"]),
                )
                if run["started_at"] is not None
                else None
            )
        return self.json(
            {
                "entry_id": entry_id,
                "map_session_key": map_key,
                "robot_history": robot_history,
                "runs": runs[: RUN_HISTORY_LIMIT * 2],
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )
