"""Listeners that act on a robot session's stores.

Each one subscribes to the stores it needs when the entry is set up, and the
entry's unload removes it.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from time import monotonic
from typing import TYPE_CHECKING

from homeassistant.const import EVENT_CORE_CONFIG_UPDATE
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from .client.models import CleaningSession
from .const import DOMAIN, EVENT_CLEANING_FINISHED, SLOW_UPDATE_INTERVAL_SECONDS
from .cues import async_fire_cues_events
from .firmware import FirmwareTracker, async_build_firmware_snapshot
from .repairs import repair_placeholders
from .session import RobotSession
from .session_tracking import _parse_timestamp, _sessions_overlap
from .time_zone import known_zone, time_zones_differ

if TYPE_CHECKING:
    from . import MaticConfigEntry

# Unexpected snapshot failures retain a RAM cooldown in addition to the
# tracker's persisted normal discovery/recovery cadence.
SNAPSHOT_RETRY_SECONDS = 900
# Snapshot cadence and state sampling depend on time as well as on what the
# robot reports, so the firmware check also runs this often.
FIRMWARE_CHECK_SECONDS = SLOW_UPDATE_INTERVAL_SECONDS


@callback
def async_listen(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    session: RobotSession,
    firmware_tracker: FirmwareTracker,
) -> None:
    """Start every listener on ``session``'s stores until the entry unloads."""
    serial = session.info.serial_number
    entry.async_on_unload(async_fire_cues_events(hass, entry, session.state, serial))
    _FirmwareWatch(hass, entry, session, firmware_tracker).async_start()
    _TimeZoneCheck(hass, entry, session).async_start()
    _FinishedSessions(hass, entry, session).async_start()


def _device_id(hass: HomeAssistant, entry: MaticConfigEntry, serial: str) -> str | None:
    """Return the Home Assistant device id for event payloads."""
    device = dr.async_get(hass).async_get_device_by_identifier(
        (DOMAIN, serial), entry.entry_id
    )
    return device.id if device is not None else None


def _software_version(session: RobotSession) -> str | None:
    return (
        session.telemetry.value.software_version
        or session.state.value.operational.software_version
    )


class _FirmwareWatch:
    """Record each firmware the robot reports and snapshot its endpoints.

    It checks when the version, protocol or activity changes and every
    ``FIRMWARE_CHECK_SECONDS``, one check at a time.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        entry: MaticConfigEntry,
        session: RobotSession,
        tracker: FirmwareTracker,
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._session = session
        self._tracker = tracker
        self._observed: tuple[object, ...] | None = None
        self._checking = False
        self._check_again = False
        self._device_software_version: str | None = None
        self._snapshots_in_progress: set[tuple[str, int | None]] = set()
        self._snapshot_retry_after: dict[tuple[str, int | None], float] = {}

    @callback
    def async_start(self) -> None:
        for store in (self._session.telemetry, self._session.state):
            self._entry.async_on_unload(store.subscribe(self._async_changed))
        self._entry.async_on_unload(
            async_track_time_interval(
                self._hass,
                self._async_check_on_schedule,
                timedelta(seconds=FIRMWARE_CHECK_SECONDS),
                cancel_on_shutdown=True,
            )
        )
        self._async_changed()

    @callback
    def _async_changed(self) -> None:
        version = _software_version(self._session)
        if version is not None:
            self._async_update_device_software(version)
        observed = (
            version,
            self._session.telemetry.value.protocol_version,
            self._session.state.value.operational.activity,
        )
        if observed != self._observed:
            self._observed = observed
            self._async_check()

    @callback
    def _async_check_on_schedule(self, _now: datetime) -> None:
        self._async_check()

    @callback
    def _async_check(self) -> None:
        if self._checking:
            self._check_again = True
            return
        self._checking = True
        self._entry.async_create_background_task(
            self._hass, self._async_run_checks(), f"{DOMAIN} firmware check"
        )

    async def _async_run_checks(self) -> None:
        try:
            self._check_again = True
            while self._check_again:
                self._check_again = False
                await self._async_check_once()
        finally:
            self._checking = False

    async def _async_check_once(self) -> None:
        entry_id = self._entry.entry_id
        version = _software_version(self._session)
        protocol = self._session.telemetry.value.protocol_version
        version_changed = await self._tracker.async_observe_version(
            entry_id,
            version,
            protocol,
            device_id=_device_id(
                self._hass, self._entry, self._session.info.serial_number
            ),
        )
        if version is None:
            return
        identity = (version, protocol)
        if (
            identity not in self._snapshots_in_progress
            and (
                version_changed
                or monotonic() >= self._snapshot_retry_after.get(identity, 0.0)
            )
            and self._tracker.needs_snapshot(
                entry_id,
                version,
                protocol,
                context=self._session.state.value.operational.activity.value,
            )
        ):
            self._snapshots_in_progress.add(identity)
            self._entry.async_create_background_task(
                self._hass,
                self._async_capture_snapshot(
                    identity, self._tracker.occurrence_generation(entry_id)
                ),
                f"{DOMAIN} firmware snapshot",
            )

    async def _async_capture_snapshot(
        self, identity: tuple[str, int | None], occurrence_generation: int
    ) -> None:
        """Persist one background snapshot without delaying anything else."""
        try:
            self._snapshot_retry_after[identity] = monotonic() + SNAPSHOT_RETRY_SECONDS
            snapshot = await async_build_firmware_snapshot(self._session)
            comparison = await self._tracker.async_record_snapshot(
                self._entry.entry_id,
                snapshot,
                occurrence_generation=occurrence_generation,
            )
            if comparison.get("reason") in {
                "snapshot_occurrence_superseded",
                "snapshot_superseded",
            }:
                # A capture from an obsolete occurrence should be retried on the
                # next check instead of waiting out its old cooldown.
                self._snapshot_retry_after.pop(identity, None)
        finally:
            self._snapshots_in_progress.discard(identity)

    @callback
    def _async_update_device_software(self, version: str) -> None:
        """Keep Home Assistant's device firmware field current after an OTA."""
        if version == self._device_software_version:
            return
        registry = dr.async_get(self._hass)
        device = registry.async_get_device_by_identifier(
            (DOMAIN, self._session.info.serial_number), self._entry.entry_id
        )
        if device is None:
            return
        registry.async_update_device(device.id, sw_version=version)
        self._device_software_version = version


class _TimeZoneCheck:
    """Raise a Repair while the robot's schedules keep a different clock.

    Each enabled schedule runs in the zone the schedules calendar uses: its
    own, else the robot's, else Home Assistant's. With no enabled schedule
    the robot's zone is checked, and an unread or unresolvable robot zone
    keeps the last decision rather than clearing a real mismatch. It checks
    when telemetry changes and when Home Assistant's own zone does.
    """

    def __init__(
        self, hass: HomeAssistant, entry: MaticConfigEntry, session: RobotSession
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._session = session
        self._checked = False
        self._issue: tuple[str, str] | None = None
        self._scans: dict[tuple[str, str, date], bool | None] = {}

    @callback
    def async_start(self) -> None:
        self._entry.async_on_unload(
            self._session.telemetry.subscribe(self._async_check)
        )
        self._entry.async_on_unload(
            self._hass.bus.async_listen(
                EVENT_CORE_CONFIG_UPDATE, self._async_core_config_updated
            )
        )
        self._async_check()

    @callback
    def _async_core_config_updated(self, _event: Event) -> None:
        self._async_check()

    @callback
    def _async_check(self) -> None:
        telemetry = self._session.telemetry.value
        home_zone = self._hass.config.time_zone
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
        if any(day != today for _, _, day in self._scans):
            self._scans.clear()
        mismatch: tuple[str, str] | None = None
        for zone in dict.fromkeys(zones):
            key = (zone, home_zone, today)
            if key not in self._scans:
                self._scans[key] = time_zones_differ(*key)
            differ = self._scans[key]
            if differ is None:
                return
            if differ:
                mismatch = (zone, home_zone)
                break
        # The first check always writes: a reloaded entry starts unset, and
        # a Repair raised before the reload must still clear on a match.
        if self._checked and mismatch == self._issue:
            return
        self._checked = True
        self._issue = mismatch
        issue_id = f"time_zone_mismatch_{self._entry.entry_id}"
        if mismatch is None:
            ir.async_delete_issue(self._hass, DOMAIN, issue_id)
            return
        ir.async_create_issue(
            self._hass,
            DOMAIN,
            issue_id,
            is_fixable=False,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key="time_zone_mismatch",
            translation_placeholders={
                **repair_placeholders(self._hass, self._entry.entry_id),
                "robot_time_zone": mismatch[0],
                "home_time_zone": home_zone,
            },
        )


class _FinishedSessions:
    """Announce each cleaning session the robot records as finished, once.

    Only the robot's own record counts; a run Home Assistant watched is shown
    but never announced.
    """

    def __init__(
        self, hass: HomeAssistant, entry: MaticConfigEntry, session: RobotSession
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._session = session
        self._last: CleaningSession | None = None
        self._observation_started_at = dt_util.utcnow()

    @callback
    def async_start(self) -> None:
        self._entry.async_on_unload(
            self._session.history.subscribe(self._async_history_changed)
        )
        self._async_history_changed()

    @callback
    def _async_history_changed(self) -> None:
        session = self._session.history.value.native_session
        if session is None:
            return
        if session.ended_at is None:
            previous = self._last
            if previous is None or _parse_timestamp(
                session.started_at
            ) > _parse_timestamp(previous.started_at):
                self._last = session
            return
        # A partial first snapshot may omit pre-existing runs. Never replay
        # sessions that had already ended before this listener started.
        previous = self._last
        observed_active = (
            previous is not None
            and previous.ended_at is None
            and _parse_timestamp(previous.started_at)
            == _parse_timestamp(session.started_at)
        )
        if (
            not observed_active
            and _parse_timestamp(session.ended_at) <= self._observation_started_at
        ):
            return
        key = (session.started_at, session.ended_at)
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
        self._last = session
        # Native history can refine timestamps after publication.
        # That enrichment must not trigger automations twice.
        if previous is not None and (
            (previous.started_at, previous.ended_at) == key
            or _sessions_overlap(previous, session)
        ):
            return
        self._hass.bus.async_fire(
            EVENT_CLEANING_FINISHED,
            {
                "entry_id": self._entry.entry_id,
                "device_id": _device_id(
                    self._hass, self._entry, self._session.info.serial_number
                ),
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
                "firmware_version": _software_version(self._session),
            },
        )
