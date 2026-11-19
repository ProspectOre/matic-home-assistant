"""Photo tours: send the robot to rooms and viewpoints and photograph each."""

from __future__ import annotations

import asyncio
import logging
import math
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from time import monotonic
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.components.vacuum.const import SERVICE_RETURN_TO_BASE
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .camera_ai import async_answer_about_photo, validate_ai_task_entity
from .client import MaticError, RobotOperationalState, RobotPose, room_name_key
from .const import (
    CONF_PHOTO_ALLOW_UNATTENDED,
    CONF_PHOTO_COOLDOWN_SECONDS,
    CONF_PHOTO_NO_PHOTO_ROOMS,
    DOMAIN,
)
from .media_source import PhotoAttachmentUnavailable, photo_attachment_source
from .native_schedules import schedule_occurrences
from .plan_model import resolve_room_reference
from .robot_controls import RobotControls
from .viewpoints import near_no_go_zone, readable_zones

if TYPE_CHECKING:
    from . import MaticConfigEntry
    from .photo_library import PhotoRecord
    from .viewpoints import Viewpoint

# The robot reports this code while it waits at a Go to room destination,
# and starts a ten-minute countdown to dock on its own.
PARKED_STATE_CODE = 109
POLL_SECONDS = 2.0
# From one room to the next the robot is already parked, so arrival is only
# known once it has left. A robot that never seems to leave was sent where it
# already is.
LEAVE_TIMEOUT_SECONDS = 20.0
ARRIVAL_TIMEOUT_SECONDS = 180.0
# The robot has reached a viewpoint once it parks this close to the spot,
# facing within this angle of the heading when it reports one.
ARRIVAL_DISTANCE_METERS = 0.4
ARRIVAL_HEADING_RADIANS = math.radians(20)
# Let the robot settle after it parks so the photo is not blurred.
SETTLE_SECONDS = 2.0
# A tour needs enough charge to reach every stop and get back.
MIN_BATTERY_PERCENT = 20
# The snap countdown is about 9 s and the photo lands about 6 s after it.
PHOTO_TIMEOUT_SECONDS = 40.0
MAX_TOUR_SECONDS = 15 * 60
CLEANUP_RESERVE_SECONDS = 60
SCHEDULE_GUARD_BEFORE = timedelta(minutes=30)
DEFAULT_COOLDOWN_SECONDS = 15 * 60
PHOTO_TAKEN_EVENT = f"{DOMAIN}_photo_taken"

_tours: dict[str, asyncio.Lock] = {}
_last_tour_started: dict[str, float] = {}
_LOGGER = logging.getLogger(__name__)


def photo_url(entry_id: str, photo_id: str) -> str:
    """Return the authenticated URL that serves one recent photo."""
    return f"/api/{DOMAIN}/photo/{entry_id}/{photo_id}"


def photo_preview_url(entry_id: str, photo_id: str) -> str:
    """Return the authenticated, pixelated URL safe for notifications."""
    return f"/api/{DOMAIN}/photo/{entry_id}/preview/{photo_id}"


@dataclass(frozen=True, slots=True)
class TourStop:
    """One stop: a room, where the robot picks the spot, or a viewpoint.

    At a viewpoint the robot takes ``look_around`` photos, turning in place
    by an equal share of a full turn from the saved heading between them.
    """

    room: str | None = None
    viewpoint: str | None = None
    look_around: int = 1


@dataclass(frozen=True, slots=True)
class _Shot:
    """Where one photo is taken, and how the robot is sent and known to be there."""

    stop: TourStop
    room: str
    viewpoint: Viewpoint | None = None
    heading: float | None = None

    @property
    def label(self) -> str:
        return self.viewpoint.name if self.viewpoint is not None else self.room


async def async_run_photo_tour(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    entity_id: str,
    stops: list[TourStop],
    *,
    full_resolution: bool = False,
    question: str | None = None,
    ai_task_entity_id: str | None = None,
    context: Context | None = None,
) -> list[dict[str, Any]]:
    """Visit each stop in turn, photograph it, then dock.

    Each photo is returned with its stop as soon as the robot has saved it,
    and a ``matic_robot_photo_taken`` event is fired for it. The robot is sent
    to the dock after the last photo and after a failure when ownership is
    still confirmed.
    """
    lock = _tours.setdefault(entry.entry_id, asyncio.Lock())
    if lock.locked():
        raise _error("photo_tour_running")
    if (question is None) != (ai_task_entity_id is None):
        raise _error("photo_tour_ai_question_required")
    if question is not None and ai_task_entity_id is not None:
        if not question.strip() or len(question) > 500:
            raise _error("photo_tour_ai_question_invalid")
        try:
            validate_ai_task_entity(hass, ai_task_entity_id)
        except HomeAssistantError:
            raise _error("photo_tour_ai_unavailable") from None
        try:
            attachment_generation = photo_attachment_source(
                hass
            ).capture_entry_generation(entry.entry_id)
        except PhotoAttachmentUnavailable:
            raise _error("photo_tour_ai_unavailable") from None
    else:
        attachment_generation = None
    async with lock:
        # Opt-in and privacy come before any viewpoint or zone check.
        _assert_photos_allowed(entry, [])
        shots = _shots(entry, stops)
        rooms = list(dict.fromkeys(shot.room for shot in shots))
        _assert_photos_allowed(entry, rooms)
        room_ids = _resolve_rooms(entry, rooms)
        if room_ids is None:
            raise _error("photo_tour_rooms_unavailable")
        forbidden = set(entry.options.get(CONF_PHOTO_NO_PHOTO_ROOMS, ()))
        current_ids = _current_room_ids(entry)
        if current_ids is None or not forbidden <= current_ids:
            raise _error("photo_tour_rooms_unavailable")
        if forbidden.intersection(room_ids):
            raise _error("photo_tour_room_blocked")
        operational = entry.runtime_data.session.state.value.operational
        if operational.cleaning or operational.paused or operational.returning:
            raise _error("photo_tour_robot_busy")
        battery = operational.battery_percentage
        if battery is not None and battery < MIN_BATTERY_PERCENT:
            raise _error("photo_tour_low_battery", battery=str(battery))
        cooldown = max(
            0,
            int(
                entry.options.get(
                    CONF_PHOTO_COOLDOWN_SECONDS,
                    DEFAULT_COOLDOWN_SECONDS,
                )
            ),
        )
        elapsed = monotonic() - _last_tour_started.get(entry.entry_id, -float("inf"))
        if elapsed < cooldown:
            raise _error(
                "photo_tour_cooldown",
                seconds=str(max(1, int(cooldown - elapsed))),
            )
        deadline = monotonic() + MAX_TOUR_SECONDS
        operation_deadline = deadline - CLEANUP_RESERVE_SECONDS
        try:
            async with asyncio.timeout(max(0, operation_deadline - monotonic())):
                await _async_check_schedule(entry)
        except TimeoutError as err:
            raise _error("photo_tour_timeout") from err
        _last_tour_started[entry.entry_id] = monotonic()
        results: list[dict[str, Any]] = []
        album = uuid4().hex
        # The area the robot reported at each stop it reached.
        arrivals: list[str] = []
        try:
            for shot in shots:
                _assert_photos_allowed(entry, [shot.room])
                try:
                    async with asyncio.timeout(
                        max(0, operation_deadline - monotonic())
                    ):
                        await _async_check_schedule(entry)
                        photo = await _async_photograph(
                            hass, entry, entity_id, shot, arrivals, album
                        )
                        analysis = (
                            await async_answer_about_photo(
                                hass,
                                entry,
                                photo.photo_id,
                                await _async_image(entry, photo.photo_id, shot.label),
                                question,
                                ai_task_entity_id,
                                context,
                                attachment_generation=attachment_generation,
                            )
                            if question is not None and ai_task_entity_id is not None
                            else None
                        )
                except TimeoutError as err:
                    raise _error("photo_tour_timeout") from err
                result: dict[str, Any] = {
                    **_stop_fields(entry, shot),
                    "photo_id": photo.photo_id,
                    "captured_at": photo.captured_at.isoformat(),
                    "url": (
                        photo_url(entry.entry_id, photo.photo_id)
                        if full_resolution
                        else photo_preview_url(entry.entry_id, photo.photo_id)
                    ),
                    "preview_url": photo_preview_url(entry.entry_id, photo.photo_id),
                }
                if analysis is not None:
                    result["analysis"] = analysis
                results.append(result)
                event_result = {
                    key: value for key, value in result.items() if key != "analysis"
                }
                hass.bus.async_fire(
                    PHOTO_TAKEN_EVENT,
                    {ATTR_ENTITY_ID: entity_id, **event_result},
                    context=context,
                )
        finally:
            # A tour always returns to the dock when it still owns the parked
            # robot.
            active_error = sys.exc_info()[1]
            can_dock = False
            if arrivals:
                try:
                    remaining = max(0, deadline - monotonic())
                    if remaining == 0:
                        raise TimeoutError(
                            "tour deadline exhausted before ownership check"
                        )
                    async with asyncio.timeout(remaining):
                        can_dock = await _async_still_parked(entry, arrivals[-1])
                except Exception:
                    _LOGGER.exception("Could not verify Matic photo tour ownership")
                if can_dock:
                    try:
                        remaining = max(0, deadline - monotonic())
                        if remaining == 0:
                            raise TimeoutError("tour deadline exhausted before docking")
                        async with asyncio.timeout(remaining):
                            await hass.services.async_call(
                                VACUUM_DOMAIN,
                                SERVICE_RETURN_TO_BASE,
                                {ATTR_ENTITY_ID: entity_id},
                                blocking=True,
                                context=context,
                            )
                    except Exception as err:
                        _LOGGER.exception("Could not safely finish Matic photo tour")
                        if active_error is None:
                            raise _error("photo_tour_dock_timeout") from err
        return results


async def _async_photograph(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    entity_id: str,
    shot: _Shot,
    arrivals: list[str],
    album: str,
) -> PhotoRecord:
    client = entry.runtime_data.client
    robot = RobotControls(hass, entry, entity_id)
    photos = entry.runtime_data.photos
    state = await _async_state(client)
    _assert_photos_allowed(entry, [shot.room])
    battery = state.battery_percentage
    if battery is None:
        raise _error("photo_tour_battery_unknown")
    if battery < MIN_BATTERY_PERCENT:
        raise _error("photo_tour_low_battery", battery=str(battery))
    # Between stops the tour leaves the robot parked where it took the last
    # photo. A robot that has moved since was given something else to do.
    if _busy(state) if not arrivals else not _left_parked(state, arrivals[-1]):
        raise _error("photo_tour_robot_busy")
    # A parked robot shows it has set off only by leaving the parked state,
    # unless it is away from the viewpoint's spot or heading before it is sent.
    must_leave = _parked(state) and (
        shot.viewpoint is None or _at_viewpoint(_pose(entry, shot.viewpoint), shot)
    )
    if robot.reachable:
        if shot.viewpoint is None:
            await robot.async_go_to_room(shot.room)
        else:
            await robot.async_go_to_viewpoint(shot.viewpoint, heading=shot.heading)
    room_area = _room_area_name(entry, shot.room)

    async def arrived_at(candidate: RobotOperationalState) -> bool:
        if not _arrived_at(candidate, room_area):
            return False
        return shot.viewpoint is None or _at_viewpoint(
            _pose(entry, shot.viewpoint), shot
        )

    async def left(candidate: RobotOperationalState) -> bool:
        return not _parked(candidate)

    if must_leave:
        await _async_wait_for(client, left, None)
    arrived = await _async_wait_for(
        client,
        arrived_at,
        _error("photo_tour_no_arrival", room=shot.label),
        within=ARRIVAL_TIMEOUT_SECONDS,
    )
    # _async_wait_for returns only after a known, matching room is reported.
    assert arrived is not None and arrived.current_area is not None
    arrivals.append(arrived.current_area)
    if shot.viewpoint is not None:
        await asyncio.sleep(SETTLE_SECONDS)
    # Read the collection first so an older photo the store hasn't seen yet
    # can't pass for the new one.
    try:
        await photos.async_read()
    except MaticError as err:
        raise _error("photo_tour_unreachable") from err
    _assert_photos_allowed(entry, [shot.room])
    await _async_check_schedule(entry)
    # The collection read and schedule refresh can both take long enough for
    # another command to move the robot or for its battery to fall.
    current = await _async_state(client)
    _assert_photos_allowed(entry, [shot.room])
    if current.battery_percentage is None:
        raise _error("photo_tour_battery_unknown")
    if current.battery_percentage < MIN_BATTERY_PERCENT:
        raise _error("photo_tour_low_battery", battery=str(current.battery_percentage))
    if not _left_parked(current, arrivals[-1]):
        raise _error("photo_tour_robot_busy")
    taken = len(photos.album(album))
    if robot.reachable:
        await robot.async_take_photo(album)
    deadline = monotonic() + PHOTO_TIMEOUT_SECONDS
    while monotonic() < deadline:
        await asyncio.sleep(POLL_SECONDS)
        await photos.async_refresh()
        if len(shots := photos.album(album)) > taken:
            # The robot can be redirected while its photo is being saved.
            # Check the room again before returning a label for that image.
            if not _left_parked(await _async_state(client), arrivals[-1]):
                raise _error("photo_tour_robot_busy")
            return shots[-1]
    raise _error("photo_tour_no_photo", room=shot.label)


async def _async_image(entry: MaticConfigEntry, photo_id: str, room: str) -> bytes:
    image = await entry.runtime_data.photos.async_image(photo_id)
    if image is None:
        raise _error("photo_tour_no_photo", room=room)
    return image


async def _async_wait_for(
    client: Any,
    condition: Callable[[RobotOperationalState], Awaitable[bool]],
    timeout_error: HomeAssistantError | None,
    *,
    within: float = LEAVE_TIMEOUT_SECONDS,
) -> RobotOperationalState | None:
    """Poll the robot until ``condition`` holds and return that state.

    Without ``timeout_error`` a timeout is accepted silently.
    """
    deadline = monotonic() + within
    while monotonic() < deadline:
        await asyncio.sleep(POLL_SECONDS)
        state = await _async_state(client)
        if await condition(state):
            return state
    if timeout_error is not None:
        raise timeout_error
    return None


def _shots(entry: MaticConfigEntry, stops: list[TourStop]) -> list[_Shot]:
    """Expand stops into photos, refusing unknown or other-floor viewpoints."""
    floor_plan = entry.runtime_data.session.floor.value
    shots: list[_Shot] = []
    for stop in stops:
        if stop.viewpoint is None:
            assert stop.room is not None
            shots.append(_Shot(stop, stop.room))
            continue
        viewpoint = entry.runtime_data.viewpoints.find(stop.viewpoint)
        if floor_plan is None or floor_plan.mission_id != viewpoint.mission_id:
            raise _error("viewpoint_other_floor", viewpoint=viewpoint.name)
        if all(room.id != viewpoint.room_id for room in floor_plan.rooms):
            raise _error("photo_tour_viewpoint_room_gone", viewpoint=viewpoint.name)
        # A no-go zone drawn in the app since the viewpoint was saved counts.
        zones = readable_zones(entry)
        if zones is None:
            raise _error("photo_tour_zones_unavailable")
        if near_no_go_zone(zones, viewpoint.mission_id, (viewpoint.x, viewpoint.y)):
            raise _error("photo_tour_viewpoint_in_no_go_zone", viewpoint=viewpoint.name)
        shots.extend(
            _Shot(
                stop,
                viewpoint.room_id,
                viewpoint,
                math.remainder(
                    viewpoint.heading + turn * math.tau / stop.look_around, math.tau
                ),
            )
            for turn in range(stop.look_around)
        )
    return shots


def _stop_fields(entry: MaticConfigEntry, shot: _Shot) -> dict[str, Any]:
    if shot.viewpoint is None or shot.heading is None:
        return {"room": shot.room}
    return {
        "viewpoint": shot.viewpoint.name,
        "room": _room_area_name(entry, shot.room),
        "heading": round(math.degrees(shot.heading), 1),
    }


def _pose(entry: MaticConfigEntry, viewpoint: Viewpoint) -> RobotPose | None:
    """Return the newest pose the robot pushed on the viewpoint's map."""
    return entry.runtime_data.session.poses.value.get(viewpoint.mission_id)


def _at_viewpoint(pose: RobotPose | None, shot: _Shot) -> bool:
    """Return whether the robot stands on the viewpoint, facing the shot's way.

    A pose without a heading still counts: the robot reports no rotation
    while it is on the dock or its rotation is ambiguous.
    """
    viewpoint = shot.viewpoint
    if pose is None or viewpoint is None or shot.heading is None:
        return False
    if math.hypot(pose.x - viewpoint.x, pose.y - viewpoint.y) > (
        ARRIVAL_DISTANCE_METERS
    ):
        return False
    return (
        pose.heading is None
        or abs(math.remainder(pose.heading - shot.heading, math.tau))
        <= ARRIVAL_HEADING_RADIANS
    )


async def _async_state(client: Any) -> RobotOperationalState:
    try:
        state: RobotOperationalState = await client.async_get_state()
    except MaticError as err:
        raise _error("photo_tour_unreachable") from err
    return state


def _parked(state: RobotOperationalState) -> bool:
    return PARKED_STATE_CODE in state.state_codes


def _busy(state: RobotOperationalState) -> bool:
    """Return whether the robot has a task that a tour would interrupt.

    The robot reports returning (104) during every Go to room trip, so that
    flag only counts while it isn't parked.
    """
    return state.cleaning or state.paused or (state.returning and not _parked(state))


def _arrived_at(state: RobotOperationalState, room: str) -> bool:
    """Require a parked state whose reported area names the requested room."""
    return (
        _parked(state)
        and not (state.cleaning or state.paused)
        and _same_area(state.current_area, room)
    )


def _room_area_name(entry: MaticConfigEntry, identifier: str) -> str:
    """Resolve a room ID to the mapped name that robot state reports."""
    floor_plan = entry.runtime_data.session.floor.value
    if floor_plan is None or not entry.runtime_data.slam_map.floor_plan_is_current(
        floor_plan
    ):
        return identifier
    try:
        _room_id, name = resolve_room_reference(
            identifier, {room.id: room.name for room in floor_plan.rooms}
        )
    except ValueError:
        # Let go_to_room return its established unknown/ambiguous-room error.
        return identifier
    return name


def _left_parked(state: RobotOperationalState, area: str) -> bool:
    """Return whether the robot still waits, with no task, where it arrived.

    A clean paused near a room can also report 109, and so does a Go to room
    someone else sent once it arrives, but in another area.
    """
    return (
        _parked(state)
        and not (state.cleaning or state.paused)
        and _same_area(state.current_area, area)
    )


def _same_area(first: str | None, second: str | None) -> bool:
    """Compare known room names using the firmware's canonical area rules."""
    first_key = room_name_key(first)
    second_key = room_name_key(second)
    return (
        first_key is not None
        and second_key is not None
        and first_key not in {"unknown", "unavailable"}
        and second_key not in {"unknown", "unavailable"}
        and first_key == second_key
    )


def _resolve_rooms(entry: MaticConfigEntry, rooms: list[str]) -> set[str] | None:
    """Resolve requested rooms using the current coherent floor plan."""
    floor_plan = entry.runtime_data.session.floor.value
    if floor_plan is None or not entry.runtime_data.slam_map.floor_plan_is_current(
        floor_plan
    ):
        return None
    room_names = {room.id: room.name for room in floor_plan.rooms}
    resolved: set[str] = set()
    for room in rooms:
        try:
            room_id, _name = resolve_room_reference(room, room_names)
        except ValueError as err:
            raise _error("photo_tour_room_unknown", room=room) from err
        resolved.add(room_id)
    return resolved


def _current_room_ids(entry: MaticConfigEntry) -> set[str] | None:
    """Return IDs from the coherent active map, or None when it is stale."""
    floor_plan = entry.runtime_data.session.floor.value
    if floor_plan is None or not entry.runtime_data.slam_map.floor_plan_is_current(
        floor_plan
    ):
        return None
    return {room.id for room in floor_plan.rooms}


def _assert_photos_allowed(entry: MaticConfigEntry, rooms: list[str]) -> None:
    """Recheck opt-in and room privacy before dispatch and before each snap."""
    if not entry.options.get(CONF_PHOTO_ALLOW_UNATTENDED, False):
        raise _error("photo_tour_not_opted_in")
    current_ids = _current_room_ids(entry)
    if current_ids is None:
        raise _error("photo_tour_rooms_unavailable")
    forbidden = set(entry.options.get(CONF_PHOTO_NO_PHOTO_ROOMS, ()))
    if not forbidden <= current_ids:
        raise _error("photo_tour_rooms_unavailable")
    if rooms:
        room_ids = _resolve_rooms(entry, rooms)
        if room_ids is None:
            raise _error("photo_tour_rooms_unavailable")
        if forbidden.intersection(room_ids):
            raise _error("photo_tour_room_blocked")


async def _async_check_schedule(entry: MaticConfigEntry) -> None:
    """Refresh native schedules before each leg and refuse stale schedule data."""
    session = entry.runtime_data.session
    try:
        async with asyncio.timeout(30):
            await session.heartbeat.async_request_refresh()
    except Exception as err:
        raise _error("photo_tour_schedule_conflict") from err
    if session.error.value is not None:
        raise _error("photo_tour_schedule_conflict")
    if _schedule_conflict(entry, dt_util.now()):
        raise _error("photo_tour_schedule_conflict")


def _schedule_conflict(entry: MaticConfigEntry, now: Any) -> bool:
    """Block a tour whose bounded run overlaps an enabled native schedule."""
    session = entry.runtime_data.session
    begin = now - SCHEDULE_GUARD_BEFORE
    end = now + timedelta(seconds=MAX_TOUR_SECONDS) + SCHEDULE_GUARD_BEFORE
    return bool(
        schedule_occurrences(session.telemetry.value, session.floor.value, begin, end)
    )


async def _async_still_parked(entry: MaticConfigEntry, area: str) -> bool:
    """Return whether the robot is still where the tour left it.

    Only then is docking safe: a robot that moved, or can't be read, may have
    started something that docking would stop. A robot left parked docks on
    its own after its ten-minute countdown.
    """
    try:
        state: RobotOperationalState = await entry.runtime_data.client.async_get_state()
    except MaticError:
        return False
    return _left_parked(state, area)


def _error(key: str, **placeholders: str) -> HomeAssistantError:
    return HomeAssistantError(
        key,
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=placeholders or None,
    )
