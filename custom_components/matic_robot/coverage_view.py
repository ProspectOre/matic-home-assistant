"""Serve the active run's native cleaning coverage to the map."""

from __future__ import annotations

import asyncio
from http import HTTPStatus
from weakref import WeakKeyDictionary

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.exceptions import MaticError
from .client.slam_tiles import TILE_SIDE, VOXEL_SCALE_METERS, SlamSemanticTile
from .http import COVERAGE_API_URL, PRIVATE_NO_STORE_HEADERS, runtime_for_entry
from .live_coverage import LiveCoverage
from .slam_view_data import _map_session_key

_MAX_RUNS = 20_000


class MaticLiveCoverageView(HomeAssistantView):
    """Return bounded, partial coverage from the currently active session."""

    url = COVERAGE_API_URL
    name = "api:matic_robot:live_coverage"

    def __init__(self) -> None:
        self._encoded: WeakKeyDictionary[
            LiveCoverage, tuple[int, int, asyncio.Future[tuple[list[list[int]], bool]]]
        ] = WeakKeyDictionary()

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
        if request.query.get("session") != runtime.live_coverage.request_key:
            return web.Response(
                status=HTTPStatus.CONFLICT, headers=PRIVATE_NO_STORE_HEADERS
            )
        map_session_key = _map_session_key(runtime)
        if map_session_key is None:
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE, headers=PRIVATE_NO_STORE_HEADERS
            )
        coverage = runtime.live_coverage
        generation, revision = coverage.generation, coverage.revision
        withdrawals = coverage.withdrawal_revision
        ownership_unverified = coverage.ownership_unverified
        partial = getattr(coverage, "partial", False)
        cached = self._encoded.get(coverage)
        if (
            cached is None
            or cached[:2] != (generation, revision)
            or (
                cached[2].done()
                and (cached[2].cancelled() or cached[2].exception() is not None)
            )
        ):
            encoding = asyncio.ensure_future(
                hass.async_add_executor_job(_coverage_runs, pages)
            )
            encoding.add_done_callback(
                lambda done: None if done.cancelled() else done.exception()
            )
            self._encoded[coverage] = (generation, revision, encoding)
        else:
            encoding = cached[2]
        runs, truncated = await asyncio.shield(encoding)
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
            or coverage.withdrawal_revision != withdrawals
            or _map_session_key(runtime) != map_session_key
        ):
            return web.Response(
                status=HTTPStatus.SERVICE_UNAVAILABLE, headers=PRIVATE_NO_STORE_HEADERS
            )
        # Additive updates do not invalidate an immutable snapshot, but a
        # withdrawn mark must never be restored by an in-flight response.
        return self.json(
            {
                "active": True,
                "map_session_key": map_session_key,
                "cell_size": VOXEL_SCALE_METERS,
                "runs": runs,
                **(
                    {"ownership_unverified": True}
                    if ownership_unverified
                    else {"coverage_basis": "observed_changes"}
                ),
                "truncated": truncated or partial,
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
