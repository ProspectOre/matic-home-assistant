"""Serve the active run's native cleaning coverage to the map."""

from __future__ import annotations

from http import HTTPStatus

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.exceptions import MaticError
from .client.slam_tiles import TILE_SIDE, VOXEL_SCALE_METERS, SlamSemanticTile
from .http import COVERAGE_API_URL, PRIVATE_NO_STORE_HEADERS, runtime_for_entry
from .slam_view_data import _map_session_key

_MAX_RUNS = 20_000


class MaticLiveCoverageView(HomeAssistantView):
    """Return bounded, partial coverage from the currently active session."""

    url = COVERAGE_API_URL
    name = "api:matic_robot:live_coverage"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None or runtime.live_coverage is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            pages = await runtime.live_coverage.async_current()
        except MaticError, TimeoutError:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE, headers=PRIVATE_NO_STORE_HEADERS
            )
        if pages is None:
            return self.json(
                {
                    "active": False,
                    "cell_size": VOXEL_SCALE_METERS,
                    "runs": [],
                    "truncated": False,
                },
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        map_session_key = _map_session_key(runtime)
        if map_session_key is None:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE, headers=PRIVATE_NO_STORE_HEADERS
            )
        revision = runtime.live_coverage.revision
        generation = runtime.live_coverage.generation
        runs, truncated = await hass.async_add_executor_job(_coverage_runs, pages or ())
        if runtime_for_entry(hass, entry_id) is not runtime:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            current = await runtime.live_coverage.async_current()
        except MaticError, TimeoutError:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE, headers=PRIVATE_NO_STORE_HEADERS
            )
        if (
            runtime_for_entry(hass, entry_id) is not runtime
            or current is None
            or runtime.live_coverage.generation != generation
            or _map_session_key(runtime) != map_session_key
        ):
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE, headers=PRIVATE_NO_STORE_HEADERS
            )
        if runtime.live_coverage.revision != revision:
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        return self.json(
            {
                "active": True,
                "map_session_key": map_session_key,
                "cell_size": VOXEL_SCALE_METERS,
                "runs": runs,
                "ownership_unverified": getattr(
                    runtime.live_coverage, "ownership_unverified", False
                ),
                "truncated": truncated
                or getattr(runtime.live_coverage, "partial", False),
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


def _coverage_runs(
    pages: tuple[SlamSemanticTile, ...],
) -> tuple[list[list[int]], bool]:
    """Encode horizontal runs as global cell x, y, length and mode bits."""
    runs: list[list[int]] = []
    for page in sorted(pages, key=lambda p: (p.page_y, p.page_x)):
        for y in range(TILE_SIDE):
            x = 0
            while x < TILE_SIDE:
                value = page.cells[x * TILE_SIDE + y]
                mask = int(bool(value & 0x0F)) | (int(bool(value & 0xF0)) << 1)
                if mask == 0:
                    x += 1
                    continue
                start = x
                x += 1
                while x < TILE_SIDE:
                    value = page.cells[x * TILE_SIDE + y]
                    next_mask = int(bool(value & 0x0F)) | (int(bool(value & 0xF0)) << 1)
                    if next_mask != mask:
                        break
                    x += 1
                if len(runs) >= _MAX_RUNS:
                    return runs, True
                runs.append(
                    [
                        page.page_x * TILE_SIDE + start,
                        page.page_y * TILE_SIDE + y,
                        x - start,
                        mask,
                    ]
                )
    return runs, False
