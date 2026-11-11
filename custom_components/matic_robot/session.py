"""One robot's connection and the live state read from it."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_call_later, async_track_time_interval

from .client.api import MaticHermesClient
from .client.exceptions import (
    AuthenticationRequiredError,
    CertificateMismatchError,
    InvalidRobotCertificateError,
    MaticError,
)
from .client.models import (
    FloorPlan,
    RobotInfo,
    RobotOperationalState,
    RobotPose,
    RobotTelemetry,
    RunProgress,
)
from .client.supervisor import WatchStatus
from .const import DOMAIN
from .heartbeat import Heartbeat
from .repairs import repair_placeholders
from .robot_health import RobotHealth
from .stores import CleaningHistory, LiveState, Store

_LOGGER = logging.getLogger(__name__)

# The robot can push state many times a second. Publishing the newest
# snapshot once a second bounds entity, event bus and Recorder work.
STATE_PUBLISH_SECONDS = 1.0
# Poses feed the map and the trail, not entities; ten a second moves the robot
# smoothly whatever rate the robot sends at.
POSE_PUBLISH_SECONDS = 0.1
# The robot keeps one latest pose per mission; a robot holds a few maps.
MAX_POSE_MISSIONS = 64
# An error code or bag flag is shown once two samples this far apart carry it.
HEALTH_SAMPLE_SECONDS = 30
# The robot ends a healthy connection about once an hour and the redial takes
# a moment. Only a state watch that stays down this long is an outage.
UNREACHABLE_AFTER_SECONDS = 10.0

# A push may leave these out; the robot still has them.
_KEPT_WHEN_OMITTED = (
    "battery_percentage",
    "software_version",
    "release_channel",
    "robot_profile",
    "cues_voice_status",
    "cues_voice_intent",
    "cues_gesture_status",
    "following_person",
)


class _Throttle:
    """Call ``publish`` at most once per ``seconds``.

    A request publishes at once when the last publish is that old. Otherwise
    it waits for the interval to end, and later requests join it.
    """

    def __init__(
        self, hass: HomeAssistant, seconds: float, publish: Callable[[], None]
    ) -> None:
        self._hass = hass
        self._seconds = seconds
        self._publish = publish
        self._timer: asyncio.TimerHandle | None = None
        self._next = 0.0

    @callback
    def request(self) -> None:
        """Publish now, or at the end of the interval."""
        if self._timer is not None:
            return
        delay = self._next - self._hass.loop.time()
        if delay <= 0:
            self._run()
        else:
            self._timer = self._hass.loop.call_later(delay, self._run)

    @callback
    def flush(self) -> None:
        """Publish a waiting request now."""
        if self._timer is not None:
            self._timer.cancel()
            self._run()

    def cancel(self) -> None:
        """Drop a waiting request."""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    @callback
    def _run(self) -> None:
        self._timer = None
        self._next = self._hass.loop.time() + self._seconds
        self._publish()


class RobotSession:
    """Own one robot's client and a store for each kind of data read from it.

    The ``kabuki_state`` watch is the only writer of ``state``, and the
    ``latest_pose`` watch of ``poses``, the newest pose on each mission's map.
    ``heartbeat`` reads what the robot does not push into ``floor``,
    ``telemetry``, ``progress`` (the running clean's time) and ``history``.
    ``error`` holds why the robot cannot be reached: a dial failed, or the
    state watch has had no live subscription for ``UNREACHABLE_AFTER_SECONDS``.
    The next snapshot from a live subscription clears it.
    """

    info: RobotInfo
    state: Store[LiveState]

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, client: MaticHermesClient
    ) -> None:
        self.hass = hass
        self.client = client
        self.health = RobotHealth(hass, entry.entry_id)
        self.error: Store[Exception | None] = Store(None)
        self.poses: Store[dict[int | None, RobotPose]] = Store({})
        self.floor: Store[FloorPlan | None] = Store(None)
        self.telemetry: Store[RobotTelemetry] = Store(RobotTelemetry())
        self.progress: Store[RunProgress | None] = Store(None)
        self.history: Store[CleaningHistory] = Store(CleaningHistory())
        self.heartbeat = Heartbeat(hass, entry, self)
        self._entry = entry
        self._raw: RobotOperationalState
        self._pending: RobotOperationalState | None = None
        self._pending_poses: dict[int | None, RobotPose] = {}
        self._state_publish = _Throttle(
            hass, STATE_PUBLISH_SECONDS, self._async_publish_pending
        )
        self._pose_publish = _Throttle(
            hass,
            POSE_PUBLISH_SECONDS,
            lambda: self.poses.set(dict(self._pending_poses)),
        )
        self._state_live = False
        self._unreachable_timer: CALLBACK_TYPE | None = None
        self._identity_issue_active = False
        self._stop: list[CALLBACK_TYPE] = []
        self._stopped = False

    async def async_start(self) -> None:
        """Read the robot's identity and state; start the watches and heartbeat.

        Raises what Home Assistant expects from a failed setup.
        """
        try:
            self.info = await self.client.async_get_info()
            self._raw = await self.client.async_get_state()
        except AuthenticationRequiredError as err:
            raise ConfigEntryAuthFailed(
                "The robot rejected its local Home Assistant credential"
            ) from err
        except MaticError as err:
            self._async_track_identity(err)
            raise ConfigEntryNotReady(str(err)) from err
        self.state = Store(self._live(self.health.observe(self._raw)))
        self._stop = [
            self.client.add_connection_listener(self._async_connection_changed),
            async_track_time_interval(
                self.hass,
                self._async_sample_health,
                timedelta(seconds=HEALTH_SAMPLE_SECONDS),
            ),
        ]
        # Entries are not unloaded when Home Assistant stops.
        self._entry.async_on_unload(
            self.hass.bus.async_listen_once(
                EVENT_HOMEASSISTANT_STOP, self._async_hass_stopping
            )
        )
        self._entry.async_create_background_task(
            self.hass,
            self.client.async_watch_state(
                self._async_receive_state, self._async_watch_status
            ),
            f"{DOMAIN} state watch",
        )
        self._entry.async_create_background_task(
            self.hass,
            self.client.async_watch_poses(self._async_receive_pose),
            f"{DOMAIN} pose watch",
        )
        await self.heartbeat.async_start()

    def pose_on(self, floor_plan: FloorPlan | None) -> RobotPose | None:
        """Return the newest pose on this floor plan's map, however old."""
        return (
            None if floor_plan is None else self.poses.value.get(floor_plan.mission_id)
        )

    async def async_stop(self) -> None:
        """Stop publishing and close the connection for good."""
        # The watch reports its ended subscription after the client closes.
        self._stopped = True
        while self._stop:
            self._stop.pop()()
        self._state_publish.cancel()
        self._pose_publish.cancel()
        self._async_cancel_unreachable_timer()
        await self.heartbeat.async_stop()
        await self.client.async_shutdown()

    async def _async_hass_stopping(self, _event: Event) -> None:
        await self.async_stop()

    @callback
    def async_flush_state(self) -> None:
        """Publish a snapshot that is waiting out the publish interval."""
        self._state_publish.flush()

    async def _async_receive_state(self, state: RobotOperationalState) -> None:
        """Keep the newest pushed snapshot and publish at most one a second."""
        self._pending = state
        if not self._stopped:
            self._state_publish.request()

    async def _async_receive_pose(self, pose: RobotPose) -> None:
        """Keep each mission's newest pose and publish ten times a second at most."""
        poses = self._pending_poses
        # Reinserting keeps the least recently updated mission first to go.
        poses.pop(pose.mission_id, None)
        poses[pose.mission_id] = pose
        if len(poses) > MAX_POSE_MISSIONS:
            del poses[next(iter(poses))]
        if not self._stopped:
            self._pose_publish.request()

    @callback
    def _async_publish_pending(self) -> None:
        assert self._pending is not None
        self._raw, self._pending = (
            replace(
                self._pending,
                **{
                    name: getattr(self._raw, name)
                    for name in _KEPT_WHEN_OMITTED
                    if getattr(self._pending, name) is None
                },
            ),
            None,
        )
        # A burst of pushes is one sighting of an error, so error codes and
        # bag flags change only when a sample is taken.
        shown = self.state.value.operational
        self.state.set(
            self._live(
                replace(
                    self._raw,
                    error_codes=shown.error_codes,
                    bag_full=shown.bag_full,
                    bag_missing=shown.bag_missing,
                )
            )
        )
        if self._state_live:
            # Listeners see the robot's current state before they see it back.
            self.error.set(None)

    def _live(self, shown: RobotOperationalState) -> LiveState:
        return LiveState(shown, self._raw.native_session_activity())

    @callback
    def _async_sample_health(self, _now: datetime) -> None:
        """Count the newest snapshot as one sighting of its errors and bag flags."""
        if self._state_live:
            self.async_flush_state()
            self.state.set(self._live(self.health.observe(self._raw)))

    @callback
    def _async_watch_status(self, status: WatchStatus, error: Exception | None) -> None:
        """Start or end the wait that turns a dead state watch into an outage."""
        self._state_live = status == "connected"
        if self._state_live:
            self._async_cancel_unreachable_timer()
        elif self._stopped:
            return
        elif isinstance(error, AuthenticationRequiredError):
            # Waiting does not help a refused credential.
            self._async_set_unreachable(error)
        elif self._unreachable_timer is None and self.error.value is None:
            self._unreachable_timer = async_call_later(
                self.hass, UNREACHABLE_AFTER_SECONDS, self._async_watch_timed_out
            )

    @callback
    def _async_watch_timed_out(self, _now: datetime) -> None:
        self._unreachable_timer = None
        self._async_set_unreachable(MaticError("The robot stopped sending its state"))

    @callback
    def _async_connection_changed(self) -> None:
        """Act on a failed dial at once; a lost connection may only be a redial."""
        error = self.client.connection_error
        if error is None:
            if self.client.connected:
                self._async_track_identity(None)
            return
        self._async_track_identity(error)
        self._async_set_unreachable(error)

    @callback
    def _async_set_unreachable(self, error: Exception) -> None:
        self._async_cancel_unreachable_timer()
        self.error.set(error)
        if isinstance(error, AuthenticationRequiredError):
            self._entry.async_start_reauth(self.hass)

    @callback
    def _async_cancel_unreachable_timer(self) -> None:
        if self._unreachable_timer is not None:
            self._unreachable_timer()
            self._unreachable_timer = None

    @callback
    def _async_track_identity(self, error: Exception | None) -> None:
        """Raise a Repair while the robot's certificate fails its pin."""
        mismatch = isinstance(
            error, CertificateMismatchError | InvalidRobotCertificateError
        )
        if mismatch == self._identity_issue_active or (error and not mismatch):
            return
        self._identity_issue_active = mismatch
        issue_id = f"robot_identity_changed_{self._entry.entry_id}"
        if not mismatch:
            _LOGGER.warning(
                "The robot's TLS identity matches its pinned certificate again"
            )
            ir.async_delete_issue(self.hass, DOMAIN, issue_id)
            return
        _LOGGER.error(
            "The robot at the configured address presented a TLS certificate"
            " that does not match the pinned robot identity; refusing to"
            " communicate until it matches or the entry is reconfigured"
        )
        ir.async_create_issue(
            self.hass,
            DOMAIN,
            issue_id,
            data={"entry_id": self._entry.entry_id},
            is_fixable=True,
            is_persistent=False,
            severity=ir.IssueSeverity.ERROR,
            translation_key="robot_identity_changed",
            translation_placeholders=repair_placeholders(
                self.hass, self._entry.entry_id
            ),
        )
