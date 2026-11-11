"""What entities read: the session's live state joined with slower reads."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
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

from .client.commands import CleaningMode, CoverageSetting
from .client.exceptions import AuthenticationRequiredError, MaticError
from .client.mission import decode_mission_client_state
from .client.models import (
    CleaningSession,
    CuesVoiceStatus,
    FloorPlan,
    HermesCollectionEntry,
    MappedFloor,
    RobotOperationalState,
    RobotPose,
    RobotState,
    RobotTelemetry,
    RunProgress,
)
from .const import (
    CUES_EVENT_TYPES,
    DOMAIN,
    EVENT_CLEANING_FINISHED,
    EVENT_CUES,
    EVENT_NATIVE_HISTORY_UPDATED,
    MAP_UPDATE_INTERVAL_SECONDS,
    SLOW_UPDATE_INTERVAL_SECONDS,
    UPDATE_INTERVAL_SECONDS,
)
from .firmware import FirmwareTracker, async_build_firmware_snapshot
from .repairs import repair_placeholders
from .session import RobotSession
from .session_tracking import (
    CleaningSessionTracker,
    _parse_timestamp,
    _sessions_overlap,
)
from .time_zone import known_zone, time_zones_differ

_LOGGER = logging.getLogger(__name__)

# Unexpected snapshot failures retain a RAM cooldown in addition to the
# tracker's persisted normal discovery/recovery cadence.
SNAPSHOT_RETRY_SECONDS = 900


def _floor_plan_matches_displayed(
    floor_plan: FloorPlan | None,
    mission_id: int | None,
    signature: tuple[MappedFloor, ...] | None,
) -> bool:
    """Check displayed identity while honoring the single-plan wire shape."""
    if (
        floor_plan is None
        or mission_id is None
        or signature is None
        or floor_plan.mission_id != mission_id
    ):
        return False
    # The protocol client deliberately skips the mission catalog for a single
    # coverage plan. That payload has no mapped-floor signature to compare, so
    # its exact mission ID is the strongest available identity evidence.
    return not floor_plan.mapped_floors or floor_plan.mapped_floors == signature


def _heartbeat(operational: RobotOperationalState) -> timedelta:
    """Return how often to read what the robot does not push.

    A robot on its dock changes none of it quickly. One that is out moves,
    and its pose and run progress are reads until they are streams.
    """
    return timedelta(
        seconds=SLOW_UPDATE_INTERVAL_SECONDS
        if operational.is_charging
        else UPDATE_INTERVAL_SECONDS
    )


def _update_error(error: Exception) -> Exception:
    """Return the update failure that tells Home Assistant why the robot is away."""
    if isinstance(error, AuthenticationRequiredError):
        return ConfigEntryAuthFailed(
            "The robot rejected its local Home Assistant credential"
        )
    return UpdateFailed(str(error))


@dataclass(frozen=True, slots=True)
class MaticCuesEvent:
    """One privacy-safe Cues lifecycle event."""

    event_type: str
    attributes: dict[str, str]


class MaticCoordinator(DataUpdateCoordinator[RobotState]):
    """Join the session's pushed state with what the robot does not push.

    Robot state is never read here: the session's watch is its only writer,
    and each new value is published at once. The heartbeat reads the floor
    plan, pose, telemetry and run progress, and fails while the session
    cannot reach the robot.
    """

    config_entry: ConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        session: RobotSession,
        config_entry: ConfigEntry,
        *,
        cleaning_mode: CleaningMode = CleaningMode.BOTH,
        coverage_setting: CoverageSetting = CoverageSetting.OPTIMAL,
        firmware_tracker: FirmwareTracker | None = None,
    ) -> None:
        operational = session.state.value.operational
        super().__init__(
            hass,
            logger=_LOGGER,
            name=DOMAIN,
            config_entry=config_entry,
            update_interval=_heartbeat(operational),
            always_update=False,
        )
        self.session = session
        self.client = session.client
        self.robot_health = session.health
        self.data = self._with_live_state(RobotState(session.info, operational))
        self.cleaning_mode = cleaning_mode
        self.coverage_setting = coverage_setting
        self.firmware_tracker = firmware_tracker
        self._cached_floor_plan: FloorPlan | None = None
        # The displayed-mission stream is the first authority that can revoke
        # the current floor. Keep it separately from the map refresh hint so
        # a failed read cannot make an older cached plan current again.
        self._displayed_floor_mission_id: int | None = None
        self._displayed_floor_signature: tuple[MappedFloor, ...] | None = None
        self._displayed_floor_unknown = False
        self._verified_floor_mission_id: int | None = None
        self._floor_read_generation = 0
        self._floor_reads_in_flight = 0
        self._cached_telemetry: RobotTelemetry | None = None
        self._map_refresh_due = 0.0
        self._slow_refresh_due = 0.0
        self._force_full_refresh = False
        self._full_refresh_generation = 0
        self._snapshot_versions_in_progress: set[tuple[str, int | None]] = set()
        self._snapshot_retry_after: dict[tuple[str, int | None], float] = {}
        self._device_software_version: str | None = None
        self._last_finished_session: CleaningSession | None = None
        self._latest_native_history_revision: str | None = None
        self._acknowledged_native_history_revision: str | None = None
        self._finished_observation_started_at = dt_util.utcnow()
        self._session_tracker = CleaningSessionTracker()
        self._session_history_recovered = False
        self._time_zone_checked = False
        self._time_zone_issue: tuple[str, str] | None = None
        self._time_zone_scans: dict[tuple[str, str, date], bool | None] = {}
        self._cues_listeners: set[Callable[[MaticCuesEvent], None]] = set()
        config_entry.async_on_unload(session.state.subscribe(self._async_state_pushed))
        config_entry.async_on_unload(
            session.error.subscribe(self._async_reachability_changed)
        )

    def _with_live_state(self, state: RobotState) -> RobotState:
        """Return ``state`` carrying the session's current robot state."""
        live = self.session.state.value
        return replace(
            state,
            operational=live.operational,
            telemetry=replace(
                state.telemetry,
                active_cleaning_session=live.session_active,
                run_progress=state.telemetry.run_progress
                if live.session_active
                else None,
            ),
        )

    @callback
    def _async_publish(self, state: RobotState) -> None:
        """Give listeners new data; the heartbeat and availability stay as set."""
        self.data = state
        self.async_update_listeners()

    @callback
    def _async_state_pushed(self) -> None:
        """Show the session's new state without waiting for a heartbeat."""
        previous = self.data.operational
        self._async_publish(self._with_live_state(self.data))
        current = self.data.operational
        for event in _cues_events(previous, current):
            self._async_fire_cues_event(event)
        if (heartbeat := _heartbeat(current)) != self.update_interval:
            # The read at the dock transition also restarts the timer.
            self.update_interval = heartbeat
            self.config_entry.async_create_background_task(
                self.hass, self.async_request_refresh(), f"{DOMAIN} heartbeat"
            )

    @callback
    def _async_reachability_changed(self) -> None:
        """Make every entity unavailable while the robot cannot be reached."""
        if (error := self.session.error.value) is None:
            self.async_set_updated_data(self.data)
        else:
            self.async_set_update_error(_update_error(error))

    async def async_watch_floor_plan(self) -> None:
        """Refresh floor geometry when the robot changes displayed mission."""
        await self.client.async_watch(
            "displayed_mission", self._async_displayed_mission
        )

    async def _async_displayed_mission(self, entry: HermesCollectionEntry) -> None:
        """Admit or revoke the floor one displayed-mission entry names."""
        try:
            mission_state = decode_mission_client_state(entry.value)
        except DecodeError:
            self._async_revoke_displayed_floor()
            return
        active_floor = mission_state.active_floor
        if active_floor is None:
            self._async_revoke_displayed_floor()
            return
        self._displayed_floor_unknown = False
        displayed_signature = mission_state.mapped_floors
        identity_changed = (
            self._displayed_floor_mission_id != active_floor.mission_id
            or self._displayed_floor_signature != displayed_signature
        )
        verified_conflict = (
            self._verified_floor_mission_id is not None
            and self._verified_floor_mission_id != active_floor.mission_id
        )
        published_map_matches = _floor_plan_matches_displayed(
            self.data.floor_plan, active_floor.mission_id, displayed_signature
        )
        verified_invalidated = self._verified_floor_mission_id is not None and (
            verified_conflict or not published_map_matches
        )
        invalidates_read = identity_changed or verified_invalidated
        invalidated_read = invalidates_read and self._floor_reads_in_flight > 0
        if invalidates_read:
            self._floor_read_generation += 1
        if verified_invalidated:
            # The displayed mission and floor signature are the
            # immediate localization authority for later reads.
            self._verified_floor_mission_id = None
        self._displayed_floor_mission_id = active_floor.mission_id
        self._displayed_floor_signature = displayed_signature
        if published_map_matches:
            if invalidated_read:
                # The matching published map remains valid, but a
                # read admitted under the prior identity was
                # revoked. Schedule its replacement immediately.
                self._map_refresh_due = 0.0
                await self.async_request_refresh()
            return
        # This stream is the robot's immediate localization signal.
        # A previously verified map identity may only be a replayed
        # scene at the dock, so it cannot override this newer state.
        self._map_refresh_due = 0.0
        # Revoke the old floor before awaiting the replacement read.
        if self.data.floor_plan is not None:
            self._async_publish(replace(self.data, floor_plan=None))
        await self.async_request_refresh()

    @callback
    def _async_revoke_displayed_floor(self) -> None:
        """Withhold cached and in-flight maps after unknown live localization."""
        self._displayed_floor_unknown = True
        self._displayed_floor_mission_id = None
        self._displayed_floor_signature = None
        self._verified_floor_mission_id = None
        self._floor_read_generation += 1
        self._cached_floor_plan = None
        self._map_refresh_due = 0.0
        if self.data.floor_plan is not None:
            self._async_publish(replace(self.data, floor_plan=None))

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
        """Read what the robot does not push and join it with what it does."""
        if (error := self.session.error.value) is not None:
            raise _update_error(error)
        self.session.async_flush_state()
        full_refresh_generation = self._full_refresh_generation
        floor_read_generation = self._floor_read_generation
        try:
            (floor_plan, pose), telemetry = await asyncio.gather(
                self._async_optional_map_state(), self._async_optional_telemetry()
            )
            if self.session.state.value.session_active:
                telemetry = replace(
                    telemetry, run_progress=await self._async_optional_run_progress()
                )
        finally:
            if self._full_refresh_generation == full_refresh_generation:
                self._force_full_refresh = False
        state = self._with_live_state(
            replace(self.data, floor_plan=floor_plan, pose=pose, telemetry=telemetry)
        )
        operational = state.operational
        serial_number = state.info.serial_number
        version = telemetry.software_version or operational.software_version
        if version is not None:
            self._async_update_device_software(version, serial_number)
        self._async_check_time_zone(telemetry)
        # Events require native evidence; local estimates are display-only.
        self._async_fire_native_history_updated(state)
        self._async_fire_session_finished(state, version)
        state = await self._async_track_cleaning_session(state)
        if self.firmware_tracker is not None:
            version_changed = await self.firmware_tracker.async_observe_version(
                self.config_entry.entry_id,
                version,
                telemetry.protocol_version,
                device_id=self._device_id(serial_number),
            )
            if version is not None:
                snapshot_identity = (version, telemetry.protocol_version)
                if (
                    snapshot_identity not in self._snapshot_versions_in_progress
                    and (
                        version_changed
                        or monotonic()
                        >= self._snapshot_retry_after.get(snapshot_identity, 0.0)
                    )
                    and self.firmware_tracker.needs_snapshot(
                        self.config_entry.entry_id,
                        version,
                        telemetry.protocol_version,
                        context=operational.activity.value,
                    )
                ):
                    self._snapshot_versions_in_progress.add(snapshot_identity)
                    occurrence_generation = self.firmware_tracker.occurrence_generation(
                        self.config_entry.entry_id
                    )
                    self.config_entry.async_create_background_task(
                        self.hass,
                        self._async_capture_firmware_snapshot(
                            self.firmware_tracker,
                            state,
                            version,
                            occurrence_generation,
                        ),
                        f"{DOMAIN} firmware snapshot",
                    )
        # A cached floor may have completed before another gathered read
        # or later enrichment. Revalidate at publication, including a
        # revoke/recover cycle that has already cleared the unknown flag.
        if self._floor_read_generation != floor_read_generation:
            state = replace(
                state, floor_plan=self._current_published_floor_plan(), pose=None
            )
        # A state pushed during the reads above is newer than the one they
        # started from, and nothing may await between here and publication.
        return self._with_live_state(state)

    @property
    def floor_read_generation(self) -> int:
        """Return the admission epoch for asynchronous floor-scoped reads."""
        return self._floor_read_generation

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

    async def _async_optional_floor_plan(self) -> FloorPlan | None:
        """Read map geometry without hiding core state if unavailable."""
        if self._displayed_floor_unknown:
            return None
        now = monotonic()
        expected_mission_id = self.expected_floor_mission_id
        read_generation = self._floor_read_generation
        if (
            not self._force_full_refresh
            and self._cached_floor_plan is not None
            and now < self._map_refresh_due
            and (
                expected_mission_id is None
                or self._cached_floor_plan.mission_id == expected_mission_id
            )
        ):
            return self._cached_floor_plan
        floor_plan: FloorPlan | None
        try:
            self._floor_reads_in_flight += 1
            try:
                floor_plan = await self.client.async_get_floor_plan(
                    expected_mission_id=expected_mission_id
                )
            finally:
                self._floor_reads_in_flight -= 1
            refresh_due = now + MAP_UPDATE_INTERVAL_SECONDS
        except MaticError as err:
            _LOGGER.debug("Optional Hermes floor plan unavailable: %s", err)
            floor_plan = self._cached_floor_plan
            refresh_due = now + UPDATE_INTERVAL_SECONDS

        # Apply post-await identity admission to successful reads and cached
        # fallbacks. A stale read can retain a published map only when its
        # mission and mapped-floor signature still match the current display.
        current_expected_mission_id = self.expected_floor_mission_id
        displayed_signature_conflict = (
            current_expected_mission_id == self._displayed_floor_mission_id
            and self._displayed_floor_signature is not None
            and not _floor_plan_matches_displayed(
                floor_plan,
                self._displayed_floor_mission_id,
                self._displayed_floor_signature,
            )
        )
        if (
            self._floor_read_generation != read_generation
            or current_expected_mission_id != expected_mission_id
            or displayed_signature_conflict
            or (
                current_expected_mission_id is not None
                and (
                    floor_plan is None
                    or floor_plan.mission_id != current_expected_mission_id
                )
            )
        ):
            self._map_refresh_due = 0.0
            published_floor_plan = self._current_published_floor_plan()
            if published_floor_plan is not None:
                # A concurrent identity event can revoke this read while
                # confirming that the already-published map is still exact.
                # Keep that verified map visible while the replacement read
                # is queued; a changed floor signature still fails closed.
                self._cached_floor_plan = published_floor_plan
                return published_floor_plan
            return None
        self._map_refresh_due = refresh_due
        self._cached_floor_plan = floor_plan
        return floor_plan

    @callback
    def _current_published_floor_plan(self) -> FloorPlan | None:
        """Retain only a published map still admitted by current localization."""
        if self._displayed_floor_unknown:
            return None
        floor_plan = self.data.floor_plan
        expected_mission_id = self.expected_floor_mission_id
        if _floor_plan_matches_displayed(
            floor_plan,
            self._displayed_floor_mission_id,
            self._displayed_floor_signature,
        ) and (
            expected_mission_id is None
            or (floor_plan is not None and floor_plan.mission_id == expected_mission_id)
        ):
            return floor_plan
        return None

    @property
    def expected_floor_mission_id(self) -> int | None:
        """Return the current floor identity admitted by live evidence."""
        if self._displayed_floor_unknown:
            return None
        return (
            self._verified_floor_mission_id
            if self._verified_floor_mission_id is not None
            else self._displayed_floor_mission_id
        )

    @property
    def displayed_floor_mission_id(self) -> int | None:
        """Return the latest mission selected by the robot's display state."""
        return self._displayed_floor_mission_id

    async def _async_optional_map_state(
        self,
    ) -> tuple[FloorPlan | None, RobotPose | None]:
        """Read a pose only after identifying its expected floor mission."""
        floor_plan = await self._async_optional_floor_plan()
        return floor_plan, await self._async_optional_pose(floor_plan)

    async def _async_optional_pose(
        self, floor_plan: FloorPlan | None
    ) -> RobotPose | None:
        """Read map pose without hiding core state if unavailable."""
        if floor_plan is None:
            return None
        try:
            return await self.client.async_get_pose(
                expected_mission_id=floor_plan.mission_id
            )
        except MaticError as err:
            _LOGGER.debug("Optional Hermes pose unavailable: %s", err)
            return None

    async def _async_optional_run_progress(self) -> RunProgress | None:
        """Read the running clean's time without hiding core state."""
        try:
            return await self.client.async_get_run_progress()
        except MaticError as err:
            _LOGGER.debug("Optional Hermes run progress unavailable: %s", err)
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
        self._full_refresh_generation += 1
        self._force_full_refresh = True
        await self.async_refresh()

    async def async_request_floor_plan_refresh(
        self, expected_mission_id: int | None = None
    ) -> None:
        """Refresh the active floor plan after a verified SLAM mission change.

        A robot can localize onto another mapped floor between map reads.
        Keep the other slow reads cached, but do not keep
        a prior floor plan long enough to make a newly observed SLAM mission
        look like an unresolved transition.
        """
        if expected_mission_id is not None:
            if self._verified_floor_mission_id != expected_mission_id:
                self._verified_floor_mission_id = expected_mission_id
                self._floor_read_generation += 1
        self._map_refresh_due = 0.0
        await self.async_request_refresh()

    async def _async_capture_firmware_snapshot(
        self,
        tracker: FirmwareTracker,
        state: RobotState,
        version: str,
        occurrence_generation: int,
    ) -> None:
        """Persist one background snapshot without delaying normal state."""
        snapshot_identity = (version, state.telemetry.protocol_version)
        try:
            self._snapshot_retry_after[snapshot_identity] = (
                monotonic() + SNAPSHOT_RETRY_SECONDS
            )
            snapshot = await async_build_firmware_snapshot(self.client, state)
            comparison = await tracker.async_record_snapshot(
                self.config_entry.entry_id,
                snapshot,
                occurrence_generation=occurrence_generation,
            )
            if comparison.get("reason") in {
                "snapshot_occurrence_superseded",
                "snapshot_superseded",
            }:
                # A capture from an obsolete occurrence should be retried on the
                # next heartbeat instead of waiting out its old cooldown.
                self._snapshot_retry_after.pop(snapshot_identity, None)
        finally:
            self._snapshot_versions_in_progress.discard(snapshot_identity)

    @callback
    def _async_fire_native_history_updated(self, state: RobotState) -> None:
        """Request a refresh until the full native history revision is imported."""
        revision = state.telemetry.native_history_revision
        if not isinstance(revision, str):
            return
        self._latest_native_history_revision = revision
        if revision == self._acknowledged_native_history_revision:
            return
        # This internal refresh has no completion semantics. The public
        # cleaning-finished event below still announces a session only once.
        self.hass.bus.async_fire(
            EVENT_NATIVE_HISTORY_UPDATED,
            {"entry_id": self.config_entry.entry_id, "revision": revision},
        )

    @callback
    def async_ack_native_history_revision(self, revision: str | None) -> None:
        """Acknowledge one successfully imported native history snapshot."""
        if (
            isinstance(revision, str)
            and revision == self._latest_native_history_revision
        ):
            self._acknowledged_native_history_revision = revision

    @callback
    def native_history_revision_acknowledged(self, revision: str) -> bool:
        """Return whether a full native history snapshot was already imported."""
        return revision == self._acknowledged_native_history_revision

    @callback
    def native_history_revision_is_current(self, revision: str) -> bool:
        """Return whether a refresh request still matches the latest heartbeat."""
        return revision == self._latest_native_history_revision

    @callback
    def _async_fire_session_finished(
        self, state: RobotState, version: str | None
    ) -> None:
        """Announce a newly completed robot cleaning session exactly once."""
        session = state.telemetry.latest_session
        if session is None:
            return
        if session.ended_at is None:
            previous = self._last_finished_session
            if previous is None or _parse_timestamp(
                session.started_at
            ) > _parse_timestamp(previous.started_at):
                self._last_finished_session = session
            return
        # A partial first snapshot may omit pre-existing runs. Never replay
        # sessions that had already ended before this coordinator started.
        previous = self._last_finished_session
        observed_active = (
            previous is not None
            and previous.ended_at is None
            and _parse_timestamp(previous.started_at)
            == _parse_timestamp(session.started_at)
        )
        if (
            not observed_active
            and _parse_timestamp(session.ended_at)
            <= self._finished_observation_started_at
        ):
            return
        key = (session.started_at, session.ended_at)
        previous = self._last_finished_session
        # Partial collection snapshots can regress to an older run. Never
        # move the publication cursor backwards or replay historical events.
        if previous is not None and (
            _parse_timestamp(session.started_at) < _parse_timestamp(previous.started_at)
            or (
                previous.ended_at is not None
                and _parse_timestamp(session.started_at)
                == _parse_timestamp(previous.started_at)
            )
        ):
            return
        self._last_finished_session = session
        # Native history can refine timestamps after publication.
        # That enrichment must not trigger automations twice.
        if previous is not None and (
            (previous.started_at, previous.ended_at) == key
            or _sessions_overlap(previous, session)
        ):
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
                "rooms": list(session.visited_rooms),
                "completed_rooms": list(session.completed_rooms),
                "completion_scope": (
                    "native_room_summary" if session.mode_results else "legacy"
                ),
                **{
                    f"{label}_completed_room_count": sum(
                        duration > 0
                        for room, duration in session.room_durations_for_mode(mode)
                        if room in session.completed_rooms_for_mode(mode)
                    )
                    for label, mode in (
                        ("vacuum", "vacuum"),
                        ("mop", "mop"),
                        ("combined", "vacuum_and_mop"),
                    )
                    if session.mode_results
                },
                "room_durations": dict(session.room_durations),
                "stop_reason": session.stop_reason,
                "firmware_version": version,
            },
        )

    @callback
    def _async_check_time_zone(self, telemetry: RobotTelemetry) -> None:
        """Raise a Repair while the robot's schedules keep a different clock.

        Each enabled schedule runs in the zone the schedules calendar uses: its
        own, else the robot's, else Home Assistant's. With no enabled schedule
        the robot's zone is checked, and an unread or unresolvable robot zone
        keeps the last decision rather than clearing a real mismatch.
        """
        home_zone = self.hass.config.time_zone
        enabled = [
            schedule
            for schedule in telemetry.schedules
            if schedule.enabled is not False
        ]
        if enabled:
            zones = [
                known_zone(schedule.timezone, telemetry.timezone) or home_zone
                for schedule in enabled
            ]
        elif (robot_zone := known_zone(telemetry.timezone)) is not None:
            zones = [robot_zone]
        else:
            return
        # A year of offsets takes tens of milliseconds; scan once per UTC day.
        today = dt_util.utcnow().date()
        if any(day != today for _, _, day in self._time_zone_scans):
            self._time_zone_scans.clear()
        mismatch: tuple[str, str] | None = None
        for zone in dict.fromkeys(zones):
            key = (zone, home_zone, today)
            if key not in self._time_zone_scans:
                self._time_zone_scans[key] = time_zones_differ(*key)
            differ = self._time_zone_scans[key]
            if differ is None:
                return
            if differ:
                mismatch = (zone, home_zone)
                break
        # The first check always writes: a reloaded entry starts unset, and
        # a Repair raised before the reload must still clear on a match.
        if self._time_zone_checked and mismatch == self._time_zone_issue:
            return
        self._time_zone_checked = True
        self._time_zone_issue = mismatch
        issue_id = f"time_zone_mismatch_{self.config_entry.entry_id}"
        if mismatch is None:
            ir.async_delete_issue(self.hass, DOMAIN, issue_id)
            return
        ir.async_create_issue(
            self.hass,
            DOMAIN,
            issue_id,
            is_fixable=False,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key="time_zone_mismatch",
            translation_placeholders={
                **repair_placeholders(self.hass, self.config_entry.entry_id),
                "robot_time_zone": mismatch[0],
                "home_time_zone": home_zone,
            },
        )

    def _device_id(self, serial_number: str) -> str | None:
        """Return the Home Assistant device id for event payloads."""
        registry = dr.async_get(self.hass)
        device = registry.async_get_device_by_identifier(
            (DOMAIN, serial_number), self.config_entry.entry_id
        )
        return device.id if device is not None else None

    def _async_update_device_software(self, version: str, serial_number: str) -> None:
        """Keep Home Assistant's device firmware field current after an OTA."""
        if version == self._device_software_version:
            return
        registry = dr.async_get(self.hass)
        device = registry.async_get_device_by_identifier(
            (DOMAIN, serial_number), self.config_entry.entry_id
        )
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
