"""Data coordinator for Matic Hermes."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from time import monotonic

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .client.api import MaticHermesClient
from .client.commands import CleaningMode, CoverageSetting
from .client.exceptions import (
    AuthenticationRequiredError,
    CertificateMismatchError,
    InvalidRobotCertificateError,
    MaticError,
)
from .client.models import FloorPlan, RobotInfo, RobotPose, RobotState, RobotTelemetry
from .const import (
    DOMAIN,
    EVENT_CLEANING_FINISHED,
    MAP_UPDATE_INTERVAL_SECONDS,
    SLOW_UPDATE_INTERVAL_SECONDS,
    UPDATE_INTERVAL_SECONDS,
)
from .firmware import FirmwareTracker, async_build_firmware_snapshot

_LOGGER = logging.getLogger(__name__)

# A sweep with this many failed endpoint reads right after an OTA is far more
# likely a flaky reboot window than real drift; retry before recording it.
SNAPSHOT_FAILURE_THRESHOLD = 8
SNAPSHOT_RETRY_SECONDS = 900
SNAPSHOT_MAX_ATTEMPTS = 3


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
        firmware_tracker: FirmwareTracker | None = None,
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
        self.firmware_tracker = firmware_tracker
        self._cached_info: RobotInfo | None = None
        self._cached_floor_plan: FloorPlan | None = None
        self._cached_telemetry: RobotTelemetry | None = None
        self._map_refresh_due = 0.0
        self._slow_refresh_due = 0.0
        self._force_full_refresh = False
        self._snapshot_versions_in_progress: set[str] = set()
        self._snapshot_attempts: dict[str, int] = {}
        self._snapshot_retry_after = 0.0
        self._device_software_version: str | None = None
        self._last_session_key: tuple[str | None, str] | None = None
        self._identity_issue_active = False

    async def _async_update_data(self) -> RobotState:
        try:
            info, operational, floor_plan, pose, telemetry = await asyncio.gather(
                self._async_info(),
                self.client.async_get_state(),
                self._async_optional_floor_plan(),
                self._async_optional_pose(),
                self._async_optional_telemetry(),
            )
            state = RobotState(
                info=info,
                operational=operational,
                floor_plan=floor_plan,
                pose=pose,
                telemetry=telemetry,
            )
            version = telemetry.software_version or operational.software_version
            if version is not None:
                self._async_update_device_software(version, info.serial_number)
            self._async_clear_identity_issue()
            self._async_fire_session_finished(state, version)
            if self.firmware_tracker is not None:
                await self.firmware_tracker.async_observe_version(
                    self.config_entry.entry_id,
                    version,
                    telemetry.protocol_version,
                    device_id=self._device_id(info.serial_number),
                )
                if (
                    version is not None
                    and version not in self._snapshot_versions_in_progress
                    and monotonic() >= self._snapshot_retry_after
                    and self.firmware_tracker.needs_snapshot(
                        self.config_entry.entry_id, version
                    )
                ):
                    self._snapshot_versions_in_progress.add(version)
                    self.config_entry.async_create_background_task(
                        self.hass,
                        self._async_capture_firmware_snapshot(
                            self.firmware_tracker, state, version
                        ),
                        f"{DOMAIN} firmware snapshot",
                    )
            return state
        except AuthenticationRequiredError as err:
            raise ConfigEntryAuthFailed(
                "The robot rejected its local Home Assistant credential"
            ) from err
        except (CertificateMismatchError, InvalidRobotCertificateError) as err:
            self._async_raise_identity_issue()
            raise UpdateFailed(
                f"The robot's TLS identity no longer matches its pinned"
                f" certificate: {err}"
            ) from err
        except MaticError as err:
            raise UpdateFailed(str(err)) from err
        finally:
            self._force_full_refresh = False

    async def _async_info(self) -> RobotInfo:
        """Read immutable identity once per coordinator lifetime."""
        if self._cached_info is None:
            self._cached_info = await self.client.async_get_info()
        return self._cached_info

    async def _async_optional_floor_plan(self) -> FloorPlan | None:
        """Read map geometry without hiding core state if unavailable."""
        now = monotonic()
        if (
            not self._force_full_refresh
            and self._cached_floor_plan is not None
            and now < self._map_refresh_due
        ):
            return self._cached_floor_plan
        try:
            floor_plan = await self.client.async_get_floor_plan()
            self._cached_floor_plan = floor_plan
            self._map_refresh_due = now + MAP_UPDATE_INTERVAL_SECONDS
            return floor_plan
        except MaticError as err:
            _LOGGER.debug("Optional Hermes floor plan unavailable: %s", err)
            self._map_refresh_due = now + UPDATE_INTERVAL_SECONDS
            return self._cached_floor_plan

    async def _async_optional_pose(self) -> RobotPose | None:
        """Read map pose without hiding core state if unavailable."""
        try:
            return await self.client.async_get_pose()
        except MaticError as err:
            _LOGGER.debug("Optional Hermes pose unavailable: %s", err)
            return None

    async def _async_optional_telemetry(self) -> RobotTelemetry:
        """Read settings and lifecycle telemetry without hiding core state."""
        now = monotonic()
        if (
            not self._force_full_refresh
            and self._cached_telemetry is not None
            and now < self._slow_refresh_due
        ):
            return self._cached_telemetry
        try:
            telemetry = await self.client.async_get_telemetry()
            self._cached_telemetry = telemetry
            self._slow_refresh_due = now + SLOW_UPDATE_INTERVAL_SECONDS
            return telemetry
        except MaticError as err:
            _LOGGER.debug("Optional Hermes telemetry unavailable: %s", err)
            self._slow_refresh_due = now + UPDATE_INTERVAL_SECONDS
            return self._cached_telemetry or RobotTelemetry()

    async def async_request_full_refresh(self) -> None:
        """Refresh slow settings immediately after a local write."""
        self._force_full_refresh = True
        await self.async_request_refresh()

    async def _async_capture_firmware_snapshot(
        self,
        tracker: FirmwareTracker,
        state: RobotState,
        version: str,
    ) -> None:
        """Persist one background snapshot without delaying normal state."""
        try:
            snapshot = await async_build_firmware_snapshot(self.client, state)
            attempts = self._snapshot_attempts.get(version, 0) + 1
            self._snapshot_attempts[version] = attempts
            failed = int(snapshot["failed_endpoints"])
            if (
                failed >= SNAPSHOT_FAILURE_THRESHOLD
                and attempts < SNAPSHOT_MAX_ATTEMPTS
            ):
                self._snapshot_retry_after = monotonic() + SNAPSHOT_RETRY_SECONDS
                _LOGGER.warning(
                    "Deferring the firmware endpoint snapshot for %s: %d of %d"
                    " reads failed (attempt %d of %d); retrying later",
                    version,
                    failed,
                    snapshot["endpoint_count"],
                    attempts,
                    SNAPSHOT_MAX_ATTEMPTS,
                )
                return
            if failed >= SNAPSHOT_FAILURE_THRESHOLD:
                _LOGGER.warning(
                    "Recording a degraded firmware endpoint snapshot for %s"
                    " after %d attempts: %d of %d reads failed",
                    version,
                    attempts,
                    failed,
                    snapshot["endpoint_count"],
                )
            await tracker.async_record_snapshot(self.config_entry.entry_id, snapshot)
            self._snapshot_attempts.pop(version, None)
        finally:
            self._snapshot_versions_in_progress.discard(version)

    @callback
    def _async_fire_session_finished(
        self, state: RobotState, version: str | None
    ) -> None:
        """Announce a newly completed robot cleaning session exactly once."""
        session = state.telemetry.latest_session
        if session is None or session.ended_at is None:
            return
        key = (session.started_at, session.ended_at)
        previous = self._last_session_key
        self._last_session_key = key
        if previous is None or previous == key:
            return
        self.hass.bus.async_fire(
            EVENT_CLEANING_FINISHED,
            {
                "entry_id": self.config_entry.entry_id,
                "device_id": self._device_id(state.info.serial_number),
                "started_at": session.started_at,
                "ended_at": session.ended_at,
                "duration_seconds": session.duration_seconds,
                "completed": session.completed,
                "rooms": list(session.rooms),
                "room_durations": dict(session.room_durations),
                "firmware_version": version,
            },
        )

    @callback
    def _async_raise_identity_issue(self) -> None:
        """Surface a pinned-identity mismatch distinctly from network noise."""
        if self._identity_issue_active:
            return
        self._identity_issue_active = True
        _LOGGER.error(
            "The robot at the configured address presented a TLS certificate"
            " that does not match the pinned robot identity; refusing to"
            " communicate until it matches or the entry is reconfigured"
        )
        ir.async_create_issue(
            self.hass,
            DOMAIN,
            f"robot_identity_changed_{self.config_entry.entry_id}",
            is_fixable=False,
            is_persistent=False,
            severity=ir.IssueSeverity.ERROR,
            translation_key="robot_identity_changed",
        )

    @callback
    def _async_clear_identity_issue(self) -> None:
        """Withdraw the identity warning after a verified reconnect."""
        if not self._identity_issue_active:
            return
        self._identity_issue_active = False
        _LOGGER.warning("The robot's TLS identity matches its pinned certificate again")
        ir.async_delete_issue(
            self.hass,
            DOMAIN,
            f"robot_identity_changed_{self.config_entry.entry_id}",
        )

    def _device_id(self, serial_number: str) -> str | None:
        """Return the Home Assistant device id for event payloads."""
        registry = dr.async_get(self.hass)
        device = registry.async_get_device(identifiers={(DOMAIN, serial_number)})
        return device.id if device is not None else None

    def _async_update_device_software(self, version: str, serial_number: str) -> None:
        """Keep Home Assistant's device firmware field current after an OTA."""
        if version == self._device_software_version:
            return
        registry = dr.async_get(self.hass)
        device = registry.async_get_device(identifiers={(DOMAIN, serial_number)})
        if device is None:
            return
        registry.async_update_device(device.id, sw_version=version)
        self._device_software_version = version
