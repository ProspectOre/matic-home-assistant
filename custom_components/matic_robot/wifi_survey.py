"""Opt-in Wi-Fi signal survey: robot scans paired with its map position."""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from http import HTTPStatus
from time import time
from typing import TYPE_CHECKING, Any

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.core import HomeAssistant
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView
from homeassistant.helpers.storage import Store

from .client.exceptions import MaticError
from .client.floor_plan import MAX_MAP_COORDINATE
from .client.models import RobotPose
from .const import DOMAIN
from .slam_scene import (
    PRIVATE_NO_STORE_HEADERS,
    WIFI_HEATMAP_API_URL,
    _runtime_for_entry,
)

if TYPE_CHECKING:
    from .client.api import MaticHermesClient
    from .coordinator import MaticCoordinator

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
SAVE_DELAY_SECONDS = 30
CELL_SIZE_METERS = 1.0
SAMPLE_INTERVAL_SECONDS = 30
# A scan takes about 7 seconds, so a cleaning robot covers a metre or two.
MAX_POSE_DRIFT_METERS = 2.0
MAX_CELLS_PER_FLOOR = 4096
MAX_FLOORS = 8
# A cell is a plain mean of its first 20 scans, then a fading average that
# gives each new scan a 1/20 weight. Older scans fade rather than drop out, so
# a cell keeps no reading history.
FADE_SAMPLES = 20
MIN_DBM = -120
MAX_DBM = 0


@dataclass(slots=True)
class SignalCell:
    """The running mean signal of one map cell."""

    dbm: float
    samples: int
    updated_at: float


type _CellKey = tuple[int, int]


class WifiSurveyStore:
    """Keep per-floor signal cells locally; the SSID is never stored."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            f"{DOMAIN}.wifi_survey.{entry_id}",
            private=True,
        )
        self._enabled = False
        self._floors: dict[int, dict[_CellKey, SignalCell]] = {}
        self._closed = False
        # Bumped by clear() so a scan that straddles it is discarded.
        self._clears = 0

    @property
    def enabled(self) -> bool:
        """Return whether the owner turned the survey on."""
        return self._enabled

    async def async_load(self) -> None:
        """Load stored cells, dropping anything malformed."""
        stored = await self._store.async_load() or {}
        self._enabled = stored.get("enabled") is True
        self._floors = _decode_floors(stored.get("floors"))
        self._closed = False

    def set_enabled(self, enabled: bool) -> None:
        """Turn sampling on or off."""
        self._enabled = enabled
        self._schedule_save()

    def clear(self) -> None:
        """Forget every sample on every floor."""
        self._floors.clear()
        self._clears += 1
        self._schedule_save()

    def add_sample(
        self, mission_id: int, x: float, y: float, dbm: int, at: float
    ) -> bool:
        """Fold one scan into its cell; refuse out-of-range input."""
        if not (
            abs(x) <= MAX_MAP_COORDINATE
            and abs(y) <= MAX_MAP_COORDINATE
            and MIN_DBM <= dbm <= MAX_DBM
        ):
            return False
        key = (math.floor(x / CELL_SIZE_METERS), math.floor(y / CELL_SIZE_METERS))
        cells = self._floors.get(mission_id)
        if cells is None:
            if len(self._floors) >= MAX_FLOORS:
                oldest = min(self._floors, key=lambda m: _latest(self._floors[m]))
                del self._floors[oldest]
            cells = self._floors[mission_id] = {}
        cell = cells.get(key)
        if cell is None:
            if len(cells) >= MAX_CELLS_PER_FLOOR:
                del cells[min(cells, key=lambda k: cells[k].updated_at)]
            cells[key] = SignalCell(float(dbm), 1, at)
        else:
            cell.samples += 1
            cell.dbm += (dbm - cell.dbm) / min(cell.samples, FADE_SAMPLES)
            cell.updated_at = at
        self._schedule_save()
        return True

    def cells(self, mission_id: int) -> list[dict[str, float | int]]:
        """Return one floor's cells as cell-centre coordinates in metres."""
        return [
            {
                "x": round((ix + 0.5) * CELL_SIZE_METERS, 3),
                "y": round((iy + 0.5) * CELL_SIZE_METERS, 3),
                "dbm": round(cell.dbm, 1),
                "samples": cell.samples,
                "updated_at": round(cell.updated_at),
            }
            for (ix, iy), cell in sorted(self._floors.get(mission_id, {}).items())
        ]

    async def async_collect(
        self, client: MaticHermesClient, coordinator: MaticCoordinator
    ) -> None:
        """Scan at a fixed pace while the survey is on and the robot is out."""
        loop = asyncio.get_running_loop()
        deadline = loop.time()
        while not self._closed:
            # Start scans on a fixed cadence; a slow scan never stacks up a backlog.
            deadline = max(deadline + SAMPLE_INTERVAL_SECONDS, loop.time())
            await asyncio.sleep(deadline - loop.time())
            if self._enabled and not self._closed:
                await self._async_sample(client, coordinator)

    async def _async_sample(
        self, client: MaticHermesClient, coordinator: MaticCoordinator
    ) -> None:
        state = coordinator.data
        floor_plan = state.floor_plan if state is not None else None
        if (
            state is None
            or state.operational.is_charging
            or floor_plan is None
            or coordinator.expected_floor_mission_id != floor_plan.mission_id
        ):
            return
        mission_id = floor_plan.mission_id
        clears = self._clears
        try:
            before = await client.async_get_pose(expected_mission_id=mission_id)
            dbm = await client.async_scan_wifi_signal()
            after = await client.async_get_pose(expected_mission_id=mission_id)
        except MaticError as err:
            _LOGGER.debug("Wi-Fi survey sample skipped: %s", err)
            return
        if dbm is None or clears != self._clears or not _poses_agree(before, after):
            return
        self.add_sample(
            mission_id, (before.x + after.x) / 2, (before.y + after.y) / 2, dbm, time()
        )

    async def async_shutdown(self) -> None:
        """Stop sampling and write pending cells."""
        self._closed = True
        await self._store.async_save(self._data())

    async def async_remove(self) -> None:
        """Erase stored cells for a removed robot."""
        self._closed = True
        await self._store.async_remove()

    def _schedule_save(self) -> None:
        if not self._closed:
            self._store.async_delay_save(self._data, SAVE_DELAY_SECONDS)

    def _data(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "floors": {
                str(mission_id): [
                    [ix, iy, round(cell.dbm, 2), cell.samples, round(cell.updated_at)]
                    for (ix, iy), cell in cells.items()
                ]
                for mission_id, cells in self._floors.items()
            },
        }


def _poses_agree(before: RobotPose, after: RobotPose) -> bool:
    """Accept a scan only if the pose advanced and moved little during it."""
    return (
        before.observed_at is not None
        and after.observed_at is not None
        and after.observed_at > before.observed_at
        and math.hypot(after.x - before.x, after.y - before.y) <= MAX_POSE_DRIFT_METERS
    )


def _latest(cells: dict[_CellKey, SignalCell]) -> float:
    return max((cell.updated_at for cell in cells.values()), default=0.0)


def _decode_floors(raw: object) -> dict[int, dict[_CellKey, SignalCell]]:
    floors: dict[int, dict[_CellKey, SignalCell]] = {}
    if not isinstance(raw, dict):
        return floors
    for mission, rows in list(raw.items())[:MAX_FLOORS]:
        if not (isinstance(mission, str) and mission.isdigit()) or not isinstance(
            rows, list
        ):
            continue
        cells: dict[_CellKey, SignalCell] = {}
        for row in rows[:MAX_CELLS_PER_FLOOR]:
            cell = _decode_cell(row)
            if cell is not None:
                cells[cell[0]] = cell[1]
        floors[int(mission)] = cells
    return floors


_MAX_CELL_INDEX = math.ceil(MAX_MAP_COORDINATE / CELL_SIZE_METERS)


def _decode_cell(row: object) -> tuple[_CellKey, SignalCell] | None:
    if not isinstance(row, list) or len(row) != 5:
        return None
    ix, iy, dbm, samples, updated_at = row
    if not (
        all(type(value) is int for value in (ix, iy, samples))
        and all(type(value) in (int, float) for value in (dbm, updated_at))
        and MIN_DBM <= dbm <= MAX_DBM
        and abs(ix) <= _MAX_CELL_INDEX
        and abs(iy) <= _MAX_CELL_INDEX
        and samples > 0
        and math.isfinite(updated_at)
    ):
        return None
    return (ix, iy), SignalCell(float(dbm), samples, float(updated_at))


class MaticWifiHeatmapView(HomeAssistantView):
    """Serve the current floor's survey cells to an administrator."""

    url = WIFI_HEATMAP_API_URL
    name = "api:matic_robot:wifi_heatmap"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return cell centres and mean signal; no network names."""
        runtime = _runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        survey = runtime.wifi_survey
        floor_plan = runtime.coordinator.data.floor_plan
        return self.json(
            {
                "enabled": survey.enabled,
                "cell_size": CELL_SIZE_METERS,
                "cells": (
                    survey.cells(floor_plan.mission_id)
                    if floor_plan is not None
                    else []
                ),
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )
