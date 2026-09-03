"""Data coordinator for Matic Hermes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from functools import partial
from time import monotonic
from typing import Any, cast

from google.protobuf.message import DecodeError
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .client.api import MaticHermesClient
from .client.commands import CleaningMode, CoverageSetting
from .client.exceptions import (
    AuthenticationRequiredError,
    CertificateMismatchError,
    InvalidRobotCertificateError,
    MaticError,
)
from .client.mission import decode_mission_client_state
from .client.models import (
    CuesVoiceStatus,
    FloorPlan,
    RobotInfo,
    RobotOperationalState,
    RobotPose,
    RobotState,
    RobotTelemetry,
)
from .const import (
    CUES_EVENT_TYPES,
    DOMAIN,
    EVENT_CLEANING_FINISHED,
    EVENT_CUES,
    MAP_UPDATE_INTERVAL_SECONDS,
    SLOW_UPDATE_INTERVAL_SECONDS,
    UPDATE_INTERVAL_SECONDS,
)
from .firmware import FirmwareTracker, async_build_firmware_snapshot
from .session_tracking import CleaningSessionTracker

_LOGGER = logging.getLogger(__name__)

# A sweep with this many failed endpoint reads right after an OTA is far more
# likely a flaky reboot window than real drift; retry before recording it.
SNAPSHOT_FAILURE_THRESHOLD = 8
SNAPSHOT_RETRY_SECONDS = 900
SNAPSHOT_MAX_ATTEMPTS = 3
ERROR_CONFIRMATION_POLLS = 2


@dataclass(frozen=True, slots=True)
class MaticCuesEvent:
    """One privacy-safe Cues lifecycle event."""

    event_type: str
    attributes: dict[str, str]


class MaticCoordinator(DataUpdateCoordinator[RobotState]):
    """Coordinate local robot snapshots and Cues push updates."""

    config_entry: ConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        client: MaticHermesClient,
        config_entry: ConfigEntry,
        *,
        cleaning_mode: CleaningMode = CleaningMode.BOTH,
        coverage_setting: CoverageSetting = CoverageSetting.OPTIMAL,
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
        self._verified_floor_mission_id: int | None = None
        self._cached_telemetry: RobotTelemetry | None = None
        self._map_refresh_due = 0.0
        self._slow_refresh_due = 0.0
        self._force_full_refresh = False
        self._snapshot_versions_in_progress: set[str] = set()
        self._snapshot_attempts: dict[str, int] = {}
        self._snapshot_retry_after = 0.0
        self._device_software_version: str | None = None
        self._last_session_key: tuple[str | None, str] | None = None
        self._session_tracker = CleaningSessionTracker()
        self._session_history_recovered = False
        self._pending_error_codes: tuple[int, ...] = ()
        self._pending_error_polls = 0
        self._bag_previous_full: bool | None = None
        self._bag_pending_clear = False
        self._bag_full_events = 0
        self._bag_replacement_events = 0
        self._bag_last_full_at: str | None = None
        self._bag_last_replaced_at: str | None = None
        self._identity_issue_active = False
        self._cues_listeners: set[Callable[[MaticCuesEvent], None]] = set()
        self._latest_cues_state: RobotOperationalState | None = None
        self._cues_push_sequence = 0

    async def async_watch_cues(self) -> None:
        """Keep Cues lifecycle state current between coordinator polls."""
        retry_delay = 1
        while True:
            try:
                states_received = 0
                async for state in self.client.async_subscribe_state():
                    states_received += 1
                    if states_received > 1:
                        retry_delay = 1
                    self.async_process_cues_state(state)
            except asyncio.CancelledError:
                raise
            except MaticError as err:
                _LOGGER.debug("Matic Cues subscription interrupted: %s", err)
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)

    async def async_watch_floor_plan(self) -> None:
        """Refresh floor geometry when the robot changes displayed mission."""
        retry_delay = 1
        while True:
            try:
                states_received = 0
                async for entry in self.client.async_subscribe_collection_entries(
                    "displayed_mission"
                ):
                    try:
                        mission_state = decode_mission_client_state(entry.value)
                    except DecodeError:
                        continue
                    active_floor = mission_state.active_floor
                    if active_floor is None:
                        continue
                    states_received += 1
                    if states_received > 1:
                        retry_delay = 1
                    floor_plan = self.data.floor_plan if self.data is not None else None
                    if (
                        floor_plan is not None
                        and floor_plan.mission_id == active_floor.mission_id
                        and floor_plan.mapped_floors == mission_state.mapped_floors
                    ):
                        continue
                    # This stream is the robot's immediate localization signal.
                    # A previously verified map identity may only be a replayed
                    # scene at the dock, so it cannot override this newer state.
                    self._verified_floor_mission_id = None
                    self._map_refresh_due = 0.0
                    await self.async_request_refresh()
            except asyncio.CancelledError:
                raise
            except MaticError as err:
                _LOGGER.debug("Matic floor subscription interrupted: %s", err)
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)

    @callback
    def async_process_cues_state(self, state: RobotOperationalState) -> None:
        """Merge a live Cues snapshot and emit meaningful transitions."""
        self._latest_cues_state = state
        self._cues_push_sequence += 1
        if self.data is None:
            return
        previous = self.data.operational
        current = replace(
            previous,
            cues_voice_status=state.cues_voice_status,
            cues_voice_intent=state.cues_voice_intent,
            cues_gesture_status=state.cues_gesture_status,
            following_person=state.following_person,
        )
        if current == previous:
            return
        self.async_set_updated_data(replace(self.data, operational=current))
        for event in _cues_events(previous, current):
            self._async_fire_cues_event(event)

    @callback
    def async_add_cues_listener(
        self, listener: Callable[[MaticCuesEvent], None]
    ) -> Callable[[], None]:
        """Subscribe an entity to privacy-safe Cues events."""
        self._cues_listeners.add(listener)

        def _remove_listener() -> None:
            self._cues_listeners.discard(listener)

        return _remove_listener

    @callback
    def _async_fire_cues_event(self, event: MaticCuesEvent) -> None:
        """Publish one Cues transition to HA and the Cues event entity."""
        assert event.event_type in CUES_EVENT_TYPES
        self.hass.bus.async_fire(
            EVENT_CUES,
            {
                "entry_id": self.config_entry.entry_id,
                "device_id": self._device_id(self.data.info.serial_number),
                "event_type": event.event_type,
                **event.attributes,
            },
        )
        for listener in tuple(self._cues_listeners):
            listener(event)

    async def _async_update_data(self) -> RobotState:
        cues_push_sequence = self._cues_push_sequence
        try:
            info, operational, floor_plan, pose, telemetry = await asyncio.gather(
                self._async_info(),
                self.client.async_get_state(),
                self._async_optional_floor_plan(),
                self._async_optional_pose(),
                self._async_optional_telemetry(),
            )
            operational = self._async_confirm_robot_errors(operational)
            self._async_track_bag_state(operational)
            state = RobotState(
                info=info,
                operational=operational,
                floor_plan=floor_plan,
                pose=pose,
                telemetry=telemetry,
            )
            state = await self._async_track_cleaning_session(state)
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
                        self.config_entry.entry_id,
                        version,
                        telemetry.protocol_version,
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
            if self._cues_push_sequence != cues_push_sequence:
                latest_cues_state = self._latest_cues_state
                assert latest_cues_state is not None
                state = replace(
                    state,
                    operational=replace(
                        state.operational,
                        cues_voice_status=latest_cues_state.cues_voice_status,
                        cues_voice_intent=latest_cues_state.cues_voice_intent,
                        cues_gesture_status=latest_cues_state.cues_gesture_status,
                        following_person=latest_cues_state.following_person,
                    ),
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

    @callback
    def _async_track_bag_state(self, state: RobotOperationalState) -> None:
        """Observe bag transitions without registering public HA entities yet."""
        current = state.bag_full
        if current is None:
            return
        if current is True:
            if self._bag_previous_full is False:
                now = dt_util.utcnow().isoformat()
                self._bag_full_events += 1
                self._bag_last_full_at = now
                _LOGGER.info("Observed Matic dust-bag full transition")
            self._bag_previous_full = True
            self._bag_pending_clear = False
            return
        if state.bag_missing is True:
            # A clear full flag while the bag is still reported missing is not
            # a replacement; wait for a present-bag clear sequence instead.
            self._bag_pending_clear = False
            return
        if self._bag_previous_full is True:
            if self._bag_pending_clear:
                now = dt_util.utcnow().isoformat()
                self._bag_replacement_events += 1
                self._bag_last_replaced_at = now
                _LOGGER.info("Observed Matic dust-bag replacement transition")
                self._bag_previous_full = False
                self._bag_pending_clear = False
            else:
                self._bag_pending_clear = True
            return
        self._bag_previous_full = False

    @property
    def bag_observation(self) -> dict[str, object]:
        """Return read-only bag observations for verification tooling."""
        operational = self.data.operational if self.data is not None else None
        return {
            "full": operational.bag_full if operational is not None else None,
            "missing": operational.bag_missing if operational is not None else None,
            "full_events_observed": self._bag_full_events,
            "replacement_events_observed": self._bag_replacement_events,
            "last_full_at": self._bag_last_full_at,
            "last_replaced_at": self._bag_last_replaced_at,
        }

    @callback
    def _async_confirm_robot_errors(
        self, state: RobotOperationalState
    ) -> RobotOperationalState:
        """Suppress one-poll firmware error pulses while preserving real faults."""
        codes = state.error_codes
        if not codes:
            self._pending_error_codes = ()
            self._pending_error_polls = 0
            return state
        if codes != self._pending_error_codes:
            self._pending_error_codes = codes
            self._pending_error_polls = 1
        else:
            self._pending_error_polls += 1
        if self._pending_error_polls < ERROR_CONFIRMATION_POLLS:
            _LOGGER.debug(
                "Waiting for a second poll before exposing robot error codes %s",
                codes,
            )
            # Bag flags are derived from the same error list and must obey the
            # same confirmation window; otherwise a one-poll firmware pulse
            # could create a false full-bag statistic.
            return replace(state, error_codes=(), bag_full=None, bag_missing=None)
        return state

    async def _async_track_cleaning_session(self, state: RobotState) -> RobotState:
        """Merge fresh HA-side run tracking with robot-native session history."""
        room_names = (
            tuple(room.name for room in state.floor_plan.rooms)
            if state.floor_plan is not None
            else ()
        )
        now = dt_util.utcnow()
        if not self._session_history_recovered:
            self._session_history_recovered = await self._async_recover_session_history(
                state.info.serial_number, room_names, now
            )
        self._session_tracker.update(
            cleaning=state.operational.cleaning,
            paused=state.operational.paused,
            returning=state.operational.returning,
            charging=state.operational.is_charging,
            low_charge=state.operational.low_charge,
            current_area=state.operational.current_area,
            room_names=room_names,
            now=now,
        )
        latest = self._session_tracker.preferred_session(state.telemetry.latest_session)
        if latest is state.telemetry.latest_session:
            return state
        return replace(state, telemetry=replace(state.telemetry, latest_session=latest))

    @callback
    def async_discard_current_room(self) -> None:
        """Keep an interrupted room out of local completed-room statistics."""
        self._session_tracker.discard_current_room(now=dt_util.utcnow())

    @callback
    def async_confirm_room_completed(self, room_name: str) -> None:
        """Apply positive managed evidence to local room statistics."""
        self._session_tracker.confirm_room_completed(room_name)

    async def _async_recover_session_history(
        self,
        serial_number: str,
        room_names: tuple[str, ...],
        now: datetime,
    ) -> bool:
        """Recover retained history, retrying until Recorder is ready."""
        registry = er.async_get(self.hass)
        cleaning_entity = registry.async_get_entity_id(
            "binary_sensor", DOMAIN, f"{serial_number}_cleaning"
        )
        area_entity = registry.async_get_entity_id(
            "sensor", DOMAIN, f"{serial_number}_current_area"
        )
        if cleaning_entity is None or area_entity is None:
            return False
        try:
            from homeassistant.components.recorder import history
            from homeassistant.helpers.recorder import get_instance

            states = await get_instance(self.hass).async_add_executor_job(
                partial(
                    history.get_significant_states,
                    self.hass,
                    now - timedelta(days=7),
                    now,
                    [cleaning_entity, area_entity],
                    include_start_time_state=True,
                    significant_changes_only=False,
                    no_attributes=True,
                )
            )
        except Exception as err:  # Recorder is optional and may not be ready yet.
            _LOGGER.debug("Unable to recover Matic cleaning history: %s", err)
            return False
        self._session_tracker.recover(
            cast(Any, states.get(cleaning_entity, [])),
            cast(Any, states.get(area_entity, [])),
            room_names,
            now=now,
        )
        return True

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
            floor_plan = await self.client.async_get_floor_plan(
                expected_mission_id=self._verified_floor_mission_id
            )
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

    async def async_request_floor_plan_refresh(
        self, expected_mission_id: int | None = None
    ) -> None:
        """Refresh the active floor plan after a verified SLAM mission change.

        A robot can localize onto another mapped floor between normal map
        polling intervals.  Keep the other slow reads cached, but do not keep
        a prior floor plan long enough to make a newly observed SLAM mission
        look like an unresolved transition.
        """
        if expected_mission_id is not None:
            self._verified_floor_mission_id = expected_mission_id
        self._map_refresh_due = 0.0
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
                "completed_rooms": list(session.completed_rooms),
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


def _cues_events(
    previous: RobotOperationalState, current: RobotOperationalState
) -> tuple[MaticCuesEvent, ...]:
    """Return safe automation events represented by one Cues transition."""
    events: list[MaticCuesEvent] = []
    if previous.cues_voice_status != current.cues_voice_status:
        voice_event = None
        if current.cues_voice_status is not None:
            voice_event = {
                CuesVoiceStatus.DISABLED: "disabled",
                CuesVoiceStatus.LISTENING_FOR_WAKE_WORD: "ready",
                CuesVoiceStatus.LISTENING_FOR_INTENT: "wake_word_detected",
                CuesVoiceStatus.THINKING_FOR_INTENT: "intent_processing",
                CuesVoiceStatus.CLASSIFIED: "intent_classified",
                CuesVoiceStatus.REJECTED: "intent_rejected",
            }.get(current.cues_voice_status)
        if voice_event is not None:
            attributes = {}
            if (
                current.cues_voice_status is CuesVoiceStatus.CLASSIFIED
                and current.cues_voice_intent is not None
            ):
                attributes["intent"] = current.cues_voice_intent.value
            events.append(MaticCuesEvent(voice_event, attributes))
    elif (
        current.cues_voice_status is CuesVoiceStatus.CLASSIFIED
        and previous.cues_voice_intent != current.cues_voice_intent
    ):
        attributes = (
            {"intent": current.cues_voice_intent.value}
            if current.cues_voice_intent is not None
            else {}
        )
        events.append(MaticCuesEvent("intent_classified", attributes))

    if previous.cues_gesture_status != current.cues_gesture_status:
        if current.cues_gesture_status is not None:
            events.append(
                MaticCuesEvent(
                    f"gesture_{current.cues_gesture_status.value}",
                    {},
                )
            )
    if previous.following_person != current.following_person:
        if current.following_person is True:
            events.append(MaticCuesEvent("following_started", {}))
        elif previous.following_person is True and current.following_person is False:
            events.append(
                MaticCuesEvent(
                    "following_stopped",
                    {},
                )
            )
    return tuple(events)
