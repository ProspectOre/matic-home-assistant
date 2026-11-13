"""Reads of what the robot does not push, on a heartbeat."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from functools import partial
from time import monotonic
from typing import TYPE_CHECKING, Any, cast

from google.protobuf.message import DecodeError
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.event import async_call_later
from homeassistant.util import dt as dt_util

from .client.exceptions import MaticError
from .client.mission import decode_mission_client_state
from .client.models import (
    FloorPlan,
    HermesCollectionEntry,
    MappedFloor,
    RobotOperationalState,
    RobotTelemetry,
    RunProgress,
)
from .const import (
    DOMAIN,
    MAP_UPDATE_INTERVAL_SECONDS,
    SLOW_UPDATE_INTERVAL_SECONDS,
    UPDATE_INTERVAL_SECONDS,
)
from .session_tracking import CleaningSessionTracker
from .stores import CleaningHistory, Store

if TYPE_CHECKING:
    from . import MaticConfigEntry
    from .session import RobotSession

_LOGGER = logging.getLogger(__name__)

# A burst of requests, such as one per command, costs one read at once and
# one more at the end of this many seconds.
REQUEST_REFRESH_COOLDOWN_SECONDS = 10


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


def heartbeat_interval(operational: RobotOperationalState) -> timedelta:
    """Return how often to read what the robot does not push.

    A robot on its dock changes none of it quickly. One that is out moves,
    and its floor and run progress are reads, not streams.
    """
    return timedelta(
        seconds=SLOW_UPDATE_INTERVAL_SECONDS
        if operational.is_charging
        else UPDATE_INTERVAL_SECONDS
    )


class Heartbeat:
    """Read the floor plan, telemetry, run progress and history into stores.

    It reads every ``heartbeat_interval``, on request, and when the robot's
    displayed mission changes, and is the only writer of the session's
    ``floor``, ``telemetry``, ``progress`` and ``history`` stores. It reads
    nothing while the session cannot reach the robot. ``displayed_mission``
    is the mission the robot last said it shows, which can lead the floor.
    """

    def __init__(
        self, hass: HomeAssistant, entry: MaticConfigEntry, session: RobotSession
    ) -> None:
        self.hass = hass
        self.interval = timedelta(seconds=SLOW_UPDATE_INTERVAL_SECONDS)
        self.displayed_mission: Store[int | None] = Store(None)
        self._entry = entry
        self._session = session
        self._timer: CALLBACK_TYPE | None = None
        self._debouncer: Debouncer[Any] = Debouncer(
            hass,
            _LOGGER,
            cooldown=REQUEST_REFRESH_COOLDOWN_SECONDS,
            immediate=True,
            function=self.async_refresh,
        )
        self._unsubscribe: list[CALLBACK_TYPE] = []
        self._reads = asyncio.Lock()
        self._stopped = False
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
        self._session_tracker = CleaningSessionTracker()
        self._session_history_recovered = False

    async def async_start(self) -> None:
        """Run the first read, then follow the displayed mission and the dock."""
        self.interval = heartbeat_interval(self._session.state.value.operational)
        self._unsubscribe.append(
            self._session.state.subscribe(self._async_state_changed)
        )
        await self.async_refresh()
        self._entry.async_create_background_task(
            self.hass,
            self._session.client.async_watch(
                "displayed_mission", self._async_displayed_mission
            ),
            f"{DOMAIN} displayed floor watch",
        )

    async def async_stop(self) -> None:
        """Stop reading for good."""
        self._stopped = True
        while self._unsubscribe:
            self._unsubscribe.pop()()
        self._async_cancel_timer()
        self._debouncer.async_shutdown()

    async def async_refresh(self) -> None:
        """Read now and start the interval again.

        Reads run one at a time, so a read that started before a settings
        write cannot publish over the read that follows the write.
        """
        self._async_cancel_timer()
        try:
            async with self._reads:
                await self._async_read()
        finally:
            self._async_schedule()

    async def async_request_refresh(self) -> None:
        """Read now, or once at the end of a burst of requests."""
        await self._debouncer.async_call()

    async def async_request_full_refresh(self) -> None:
        """Read settings again at once after a local write."""
        self._full_refresh_generation += 1
        self._force_full_refresh = True
        await self.async_refresh()

    async def async_request_floor_plan_refresh(
        self, expected_mission_id: int | None = None
    ) -> None:
        """Refresh the active floor plan after a verified SLAM mission change.

        A robot can localize onto another mapped floor between map reads.
        Keep the other slow reads cached, but do not keep a prior floor plan
        long enough to make a newly observed SLAM mission look like an
        unresolved transition.
        """
        if expected_mission_id is not None:
            if self._verified_floor_mission_id != expected_mission_id:
                self._verified_floor_mission_id = expected_mission_id
                self._floor_read_generation += 1
        self._map_refresh_due = 0.0
        await self.async_request_refresh()

    @property
    def floor_read_generation(self) -> int:
        """Return the admission epoch for asynchronous floor-scoped reads."""
        return self._floor_read_generation

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

    @callback
    def async_discard_current_room(self) -> None:
        """Keep an interrupted room out of local completed-room statistics."""
        self._session_tracker.discard_current_room(now=dt_util.utcnow())

    @callback
    def async_confirm_room_completed(self, room_name: str) -> None:
        """Apply positive managed evidence to local room statistics."""
        self._session_tracker.confirm_room_completed(room_name)

    @callback
    def _async_schedule(self) -> None:
        # A queued read restarts the interval again when it finishes.
        self._async_cancel_timer()
        if self._stopped or self._entry.pref_disable_polling:
            return
        self._timer = async_call_later(self.hass, self.interval, self._async_tick)

    @callback
    def _async_cancel_timer(self) -> None:
        if self._timer is not None:
            self._timer()
            self._timer = None

    @callback
    def _async_tick(self, _now: datetime) -> None:
        self._timer = None
        self._entry.async_create_background_task(
            self.hass, self.async_refresh(), f"{DOMAIN} heartbeat"
        )

    @callback
    def _async_state_changed(self) -> None:
        """Follow the dock, and drop run progress once no clean is running."""
        live = self._session.state.value
        if not live.session_active:
            self._session.progress.set(None)
        if (interval := heartbeat_interval(live.operational)) != self.interval:
            # The read at the dock transition also restarts the timer.
            self.interval = interval
            self._entry.async_create_background_task(
                self.hass, self.async_request_refresh(), f"{DOMAIN} heartbeat"
            )

    async def _async_read(self) -> None:
        """Read what the robot does not push and publish it."""
        session = self._session
        if session.error.value is not None:
            return
        session.async_flush_state()
        full_refresh_generation = self._full_refresh_generation
        floor_read_generation = self._floor_read_generation
        progress: RunProgress | None = None
        try:
            floor_plan, telemetry = await asyncio.gather(
                self._async_optional_floor_plan(), self._async_optional_telemetry()
            )
            if session.state.value.session_active:
                progress = await self._async_optional_run_progress()
        finally:
            if self._full_refresh_generation == full_refresh_generation:
                self._force_full_refresh = False
        history = await self._async_cleaning_history(floor_plan, telemetry)
        # A cached floor may have completed before another gathered read
        # or later enrichment. Revalidate at publication, including a
        # revoke/recover cycle that has already cleared the unknown flag.
        if self._floor_read_generation != floor_read_generation:
            floor_plan = self._current_published_floor_plan()
        # An outage found during the reads above discards them, and a state
        # pushed during them is newer than the one they started from.
        # Nothing may await between here and publication.
        if session.error.value is not None:
            return
        session.floor.set(floor_plan)
        session.telemetry.set(telemetry)
        session.progress.set(progress if session.state.value.session_active else None)
        session.history.set(history)

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
            self._session.floor.value, active_floor.mission_id, displayed_signature
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
        self.displayed_mission.set(active_floor.mission_id)
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
        self._session.floor.set(None)
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
        self.displayed_mission.set(None)
        self._session.floor.set(None)

    async def _async_cleaning_history(
        self, floor_plan: FloorPlan | None, telemetry: RobotTelemetry
    ) -> CleaningHistory:
        """Merge HA-side run tracking with the robot's newest session."""
        room_names = (
            tuple(room.name for room in floor_plan.rooms)
            if floor_plan is not None
            else ()
        )
        now = dt_util.utcnow()
        if not self._session_history_recovered:
            self._session_history_recovered = await self._async_recover_session_history(
                self._session.info.serial_number, room_names, now
            )
        operational = self._session.state.value.operational
        self._session_tracker.update(
            cleaning=operational.cleaning,
            paused=operational.paused,
            returning=operational.returning,
            charging=operational.is_charging,
            low_charge=operational.low_charge,
            current_area=operational.current_area,
            room_names=room_names,
            now=now,
        )
        native = telemetry.latest_session
        return CleaningHistory(
            native_session=native,
            latest_session=self._session_tracker.preferred_session(native),
            revision=telemetry.native_history_revision,
        )

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
                floor_plan = await self._session.client.async_get_floor_plan(
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
        floor_plan = self._session.floor.value
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

    async def _async_optional_run_progress(self) -> RunProgress | None:
        """Read the running clean's time without hiding core state."""
        try:
            return await self._session.client.async_get_run_progress()
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
            telemetry = await self._session.client.async_get_telemetry()
            self._cached_telemetry = telemetry
            self._slow_refresh_due = now + SLOW_UPDATE_INTERVAL_SECONDS
            return telemetry
        except MaticError as err:
            _LOGGER.debug("Optional Hermes telemetry unavailable: %s", err)
            self._slow_refresh_due = now + UPDATE_INTERVAL_SECONDS
            return self._cached_telemetry or RobotTelemetry()
