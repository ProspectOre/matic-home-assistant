"""Data coordinator for Matic Hermes."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .client.api import MaticHermesClient
from .client.commands import CleaningMode, CoverageSetting
from .client.exceptions import AuthenticationRequiredError, MaticError
from .client.models import FloorPlan, RobotPose, RobotState, RobotTelemetry
from .const import DOMAIN, UPDATE_INTERVAL_SECONDS

_LOGGER = logging.getLogger(__name__)


class MaticCoordinator(DataUpdateCoordinator[RobotState]):
    """Coordinate local robot metadata and, later, push subscriptions."""

    config_entry: ConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        client: MaticHermesClient,
        config_entry: ConfigEntry,
        *,
        cleaning_mode: CleaningMode = CleaningMode.BOTH,
        coverage_setting: CoverageSetting = CoverageSetting.STANDARD,
    ) -> None:
        super().__init__(
            hass,
            logger=_LOGGER,
            name=DOMAIN,
            config_entry=config_entry,
            update_interval=timedelta(seconds=UPDATE_INTERVAL_SECONDS),
            always_update=False,
        )
        self.client = client
        self.cleaning_mode = cleaning_mode
        self.coverage_setting = coverage_setting

    async def _async_update_data(self) -> RobotState:
        try:
            info, operational, floor_plan, pose, telemetry = await asyncio.gather(
                self.client.async_get_info(),
                self.client.async_get_state(),
                self._async_optional_floor_plan(),
                self._async_optional_pose(),
                self._async_optional_telemetry(),
            )
            return RobotState(
                info=info,
                operational=operational,
                floor_plan=floor_plan,
                pose=pose,
                telemetry=telemetry,
            )
        except AuthenticationRequiredError as err:
            raise ConfigEntryAuthFailed(
                "The robot rejected its local Home Assistant credential"
            ) from err
        except MaticError as err:
            raise UpdateFailed(str(err)) from err

    async def _async_optional_floor_plan(self) -> FloorPlan | None:
        """Read map geometry without hiding core state if unavailable."""
        try:
            return await self.client.async_get_floor_plan()
        except MaticError as err:
            _LOGGER.debug("Optional Hermes floor plan unavailable: %s", err)
            return None

    async def _async_optional_pose(self) -> RobotPose | None:
        """Read map pose without hiding core state if unavailable."""
        try:
            return await self.client.async_get_pose()
        except MaticError as err:
            _LOGGER.debug("Optional Hermes pose unavailable: %s", err)
            return None

    async def _async_optional_telemetry(self) -> RobotTelemetry:
        """Read settings and lifecycle telemetry without hiding core state."""
        try:
            return await self.client.async_get_telemetry()
        except MaticError as err:
            _LOGGER.debug("Optional Hermes telemetry unavailable: %s", err)
            return RobotTelemetry()
