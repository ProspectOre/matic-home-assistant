"""Send the robot to rooms and photograph each one."""

from __future__ import annotations

import asyncio
import logging
import sys
from collections.abc import Callable
from datetime import timedelta
from time import monotonic
from typing import TYPE_CHECKING, Any

from homeassistant.components.vacuum.const import (
    ATTR_PARAMS,
    SERVICE_RETURN_TO_BASE,
    SERVICE_SEND_COMMAND,
)
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.const import ATTR_COMMAND, ATTR_ENTITY_ID
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .client.exceptions import MaticError
from .client.floor_plan import room_name_key
from .client.models import RobotOperationalState
from .const import (
    CONF_PHOTO_PATROL_ALLOW_UNATTENDED,
    CONF_PHOTO_PATROL_COOLDOWN_SECONDS,
    CONF_PHOTO_PATROL_NO_PHOTO_ROOMS,
    DOMAIN,
)
from .native_schedules import schedule_occurrences
from .plan_model import resolve_room_reference

if TYPE_CHECKING:
    from . import MaticConfigEntry
    from .client.snaps import RobotPhoto

# The robot reports this code while it waits at a Go to room destination,
# and starts a ten-minute countdown to dock on its own.
PARKED_STATE_CODE = 109
POLL_SECONDS = 2.0
# From one room to the next the robot is already parked, so arrival is only
# known once it has left. A robot that never seems to leave was sent where it
# already is.
LEAVE_TIMEOUT_SECONDS = 20.0
ARRIVAL_TIMEOUT_SECONDS = 180.0
# A patrol needs enough charge to reach every room and get back.
MIN_BATTERY_PERCENT = 20
# The snap countdown is about 9 s and the photo lands about 6 s after it.
PHOTO_TIMEOUT_SECONDS = 40.0
MAX_PATROL_SECONDS = 15 * 60
CLEANUP_RESERVE_SECONDS = 60
SCHEDULE_GUARD_BEFORE = timedelta(minutes=30)
DEFAULT_PATROL_COOLDOWN_SECONDS = 15 * 60
# A photo captured more than this before the snap command, by the robot's
# clock, is an older one. Live snaps matched Home Assistant's clock to within
# a few seconds.
CLOCK_TOLERANCE = timedelta(minutes=1)
PHOTO_TAKEN_EVENT = f"{DOMAIN}_photo_taken"

_patrols: dict[str, asyncio.Lock] = {}
_last_patrol_started: dict[str, float] = {}
_LOGGER = logging.getLogger(__name__)


def photo_url(entry_id: str, photo_id: str) -> str:
    """Return the authenticated URL that serves one recent photo."""
    return f"/api/{DOMAIN}/photo/{entry_id}/{photo_id}"


def photo_preview_url(entry_id: str, photo_id: str) -> str:
    """Return the authenticated, pixelated URL safe for notifications."""
    return f"/api/{DOMAIN}/photo/{entry_id}/preview/{photo_id}"


async def async_photo_patrol(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    entity_id: str,
    rooms: list[str],
    *,
    full_resolution: bool = False,
    context: Context | None = None,
) -> list[dict[str, str]]:
    """Visit each room in turn, photograph it, then dock.

    Each photo is returned with its room as soon as the robot has saved it,
    and a ``matic_robot_photo_taken`` event is fired for it. The robot is sent
    to the dock after the last photo and after a failure when ownership is
    still confirmed.
    """
    lock = _patrols.setdefault(entry.entry_id, asyncio.Lock())
    if lock.locked():
        raise _error("photo_patrol_running")
    async with lock:
        _assert_patrol_allowed(entry, rooms)
        room_ids = _resolve_patrol_rooms(entry, rooms)
        if room_ids is None:
            raise _error("photo_patrol_rooms_unavailable")
        forbidden = set(entry.options.get(CONF_PHOTO_PATROL_NO_PHOTO_ROOMS, ()))
        current_ids = _current_room_ids(entry)
        if current_ids is None or not forbidden <= current_ids:
            raise _error("photo_patrol_rooms_unavailable")
        if forbidden.intersection(room_ids):
            raise _error("photo_patrol_room_blocked")
        operational = entry.runtime_data.coordinator.data.operational
        if operational.cleaning or operational.paused or operational.returning:
            raise _error("photo_patrol_robot_busy")
        battery = operational.battery_percentage
        if battery is not None and battery < MIN_BATTERY_PERCENT:
            raise _error("photo_patrol_low_battery", battery=str(battery))
        cooldown = max(
            0,
            int(
                entry.options.get(
                    CONF_PHOTO_PATROL_COOLDOWN_SECONDS,
                    DEFAULT_PATROL_COOLDOWN_SECONDS,
                )
            ),
        )
        elapsed = monotonic() - _last_patrol_started.get(entry.entry_id, -float("inf"))
        if elapsed < cooldown:
            raise _error(
                "photo_patrol_cooldown",
                seconds=str(max(1, int(cooldown - elapsed))),
            )
        deadline = monotonic() + MAX_PATROL_SECONDS
        operation_deadline = deadline - CLEANUP_RESERVE_SECONDS
        try:
            async with asyncio.timeout(max(0, operation_deadline - monotonic())):
                await _async_check_schedule(entry)
        except TimeoutError as err:
            raise _error("photo_patrol_timeout") from err
        _last_patrol_started[entry.entry_id] = monotonic()
        results: list[dict[str, str]] = []
        # The area the robot reported at each room it reached.
        arrivals: list[str] = []
        try:
            for room in rooms:
                _assert_patrol_allowed(entry, [room])
                try:
                    async with asyncio.timeout(
                        max(0, operation_deadline - monotonic())
                    ):
                        await _async_check_schedule(entry)
                        photo = await _async_photograph(
                            hass, entry, entity_id, room, context, arrivals
                        )
                except TimeoutError as err:
                    raise _error("photo_patrol_timeout") from err
                result = {
                    "room": room,
                    "photo_id": photo.photo_id,
                    "captured_at": photo.captured_at.isoformat(),
                    "url": (
                        photo_url(entry.entry_id, photo.photo_id)
                        if full_resolution
                        else photo_preview_url(entry.entry_id, photo.photo_id)
                    ),
                    "preview_url": photo_preview_url(entry.entry_id, photo.photo_id),
                }
                results.append(result)
                hass.bus.async_fire(
                    PHOTO_TAKEN_EVENT,
                    {ATTR_ENTITY_ID: entity_id, **result},
                    context=context,
                )
        finally:
            # Patrol always returns to the dock when it still owns the parked
            # robot.
            active_error = sys.exc_info()[1]
            can_dock = False
            if arrivals:
                try:
                    remaining = max(0, deadline - monotonic())
                    if remaining == 0:
                        raise TimeoutError(
                            "patrol deadline exhausted before ownership check"
                        )
                    async with asyncio.timeout(remaining):
                        can_dock = await _async_still_parked(entry, arrivals[-1])
                except Exception:
                    _LOGGER.exception("Could not verify Matic photo patrol ownership")
                if can_dock:
                    try:
                        remaining = max(0, deadline - monotonic())
                        if remaining == 0:
                            raise TimeoutError(
                                "patrol deadline exhausted before docking"
                            )
                        async with asyncio.timeout(remaining):
                            await hass.services.async_call(
                                VACUUM_DOMAIN,
                                SERVICE_RETURN_TO_BASE,
                                {ATTR_ENTITY_ID: entity_id},
                                blocking=True,
                                context=context,
                            )
                    except Exception as err:
                        _LOGGER.exception("Could not safely finish Matic photo patrol")
                        if active_error is None:
                            raise _error("photo_patrol_dock_timeout") from err
        return results


async def _async_photograph(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    entity_id: str,
    room: str,
    context: Context | None,
    arrivals: list[str],
) -> RobotPhoto:
    client = entry.runtime_data.client
    photos = entry.runtime_data.photos
    state = await _async_state(client)
    _assert_patrol_allowed(entry, [room])
    battery = state.battery_percentage
    if battery is None:
        raise _error("photo_patrol_battery_unknown")
    if battery < MIN_BATTERY_PERCENT:
        raise _error("photo_patrol_low_battery", battery=str(battery))
    # Between rooms the patrol leaves the robot parked where it took the last
    # photo. A robot that has moved since was given something else to do.
    if _busy(state) if not arrivals else not _left_parked(state, arrivals[-1]):
        raise _error("photo_patrol_robot_busy")
    was_parked = _parked(state)
    await _async_command(hass, entity_id, "go_to_room", {"room": room}, context)
    room_area = _room_area_name(entry, room)
    if was_parked:
        await _async_wait_for(client, lambda state: not _parked(state), None)
    arrived = await _async_wait_for(
        client,
        lambda candidate: _arrived_at(candidate, room_area),
        _error("photo_patrol_no_arrival", room=room),
        within=ARRIVAL_TIMEOUT_SECONDS,
    )
    # _async_wait_for returns only after a known, matching room is reported.
    assert arrived is not None and arrived.current_area is not None
    arrivals.append(arrived.current_area)
    # Read the collection first so an older photo the store hasn't seen yet
    # can't pass for the new one.
    try:
        await photos.async_read()
    except MaticError as err:
        raise _error("photo_patrol_unreachable") from err
    _assert_patrol_allowed(entry, [room])
    await _async_check_schedule(entry)
    # The collection read and schedule refresh can both take long enough for
    # another command to move the robot or for its battery to fall.
    current = await _async_state(client)
    _assert_patrol_allowed(entry, [room])
    if current.battery_percentage is None:
        raise _error("photo_patrol_battery_unknown")
    if current.battery_percentage < MIN_BATTERY_PERCENT:
        raise _error(
            "photo_patrol_low_battery", battery=str(current.battery_percentage)
        )
    if not _left_parked(current, arrivals[-1]):
        raise _error("photo_patrol_robot_busy")
    previous = photos.latest
    earliest = dt_util.utcnow() - CLOCK_TOLERANCE
    await _async_command(hass, entity_id, "emote", {"kind": "snap"}, context)
    deadline = monotonic() + PHOTO_TIMEOUT_SECONDS
    while monotonic() < deadline:
        await asyncio.sleep(POLL_SECONDS)
        await photos.async_refresh()
        latest = photos.latest
        if (
            latest is not None
            and latest.captured_at >= earliest
            and (previous is None or latest.captured_at > previous.captured_at)
        ):
            # The robot can be redirected while its photo is being saved.
            # Check the room again before returning a label for that image.
            if not _left_parked(await _async_state(client), arrivals[-1]):
                raise _error("photo_patrol_robot_busy")
            return latest
    raise _error("photo_patrol_no_photo", room=room)


async def _async_wait_for(
    client: Any,
    condition: Callable[[RobotOperationalState], bool],
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
        if condition(state):
            return state
    if timeout_error is not None:
        raise timeout_error
    return None


async def _async_state(client: Any) -> RobotOperationalState:
    try:
        state: RobotOperationalState = await client.async_get_state()
    except MaticError as err:
        raise _error("photo_patrol_unreachable") from err
    return state


def _parked(state: RobotOperationalState) -> bool:
    return PARKED_STATE_CODE in state.state_codes


def _busy(state: RobotOperationalState) -> bool:
    """Return whether the robot has a task that a patrol would interrupt.

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
    state = entry.runtime_data.coordinator.data
    floor_plan = state.floor_plan if state is not None else None
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


def _resolve_patrol_rooms(entry: MaticConfigEntry, rooms: list[str]) -> set[str] | None:
    """Resolve requested rooms using the current coherent floor plan."""
    state = entry.runtime_data.coordinator.data
    floor_plan = state.floor_plan if state is not None else None
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
            raise _error("photo_patrol_room_unknown", room=room) from err
        resolved.add(room_id)
    return resolved


def _current_room_ids(entry: MaticConfigEntry) -> set[str] | None:
    """Return IDs from the coherent active map, or None when it is stale."""
    state = entry.runtime_data.coordinator.data
    floor_plan = state.floor_plan if state is not None else None
    if floor_plan is None or not entry.runtime_data.slam_map.floor_plan_is_current(
        floor_plan
    ):
        return None
    return {room.id for room in floor_plan.rooms}


def _assert_patrol_allowed(entry: MaticConfigEntry, rooms: list[str]) -> None:
    """Recheck opt-in and room privacy before dispatch and before each snap."""
    if not entry.options.get(CONF_PHOTO_PATROL_ALLOW_UNATTENDED, False):
        raise _error("photo_patrol_not_opted_in")
    current_ids = _current_room_ids(entry)
    if current_ids is None:
        raise _error("photo_patrol_rooms_unavailable")
    forbidden = set(entry.options.get(CONF_PHOTO_PATROL_NO_PHOTO_ROOMS, ()))
    if not forbidden <= current_ids:
        raise _error("photo_patrol_rooms_unavailable")
    if rooms:
        room_ids = _resolve_patrol_rooms(entry, rooms)
        if room_ids is None:
            raise _error("photo_patrol_rooms_unavailable")
        if forbidden.intersection(room_ids):
            raise _error("photo_patrol_room_blocked")


async def _async_check_schedule(entry: MaticConfigEntry) -> None:
    """Refresh native schedules before each leg and refuse stale schedule data."""
    coordinator = entry.runtime_data.coordinator
    refresh = getattr(coordinator, "async_request_refresh", None)
    if callable(refresh):
        try:
            async with asyncio.timeout(30):
                await refresh()
        except Exception as err:
            raise _error("photo_patrol_schedule_conflict") from err
    if getattr(coordinator, "last_update_success", True) is False:
        raise _error("photo_patrol_schedule_conflict")
    state = coordinator.data
    if (
        state is None
        or getattr(getattr(state, "telemetry", None), "schedules", None) is None
    ):
        raise _error("photo_patrol_schedule_conflict")
    if _schedule_conflict(entry, dt_util.now()):
        raise _error("photo_patrol_schedule_conflict")


def _schedule_conflict(entry: MaticConfigEntry, now: Any) -> bool:
    """Block a patrol whose bounded run overlaps an enabled native schedule."""
    state = entry.runtime_data.coordinator.data
    if state is None:
        return True
    begin = now - SCHEDULE_GUARD_BEFORE
    end = now + timedelta(seconds=MAX_PATROL_SECONDS) + SCHEDULE_GUARD_BEFORE
    return bool(schedule_occurrences(state, begin, end))


def ensure_current_room_allows_photo(entry: MaticConfigEntry) -> None:
    """Refuse manual snaps when the reported room is blocked or unverifiable."""
    forbidden = set(entry.options.get(CONF_PHOTO_PATROL_NO_PHOTO_ROOMS, ()))
    if not forbidden:
        return
    state = entry.runtime_data.coordinator.data
    floor_plan = state.floor_plan if state is not None else None
    if floor_plan is None or not entry.runtime_data.slam_map.floor_plan_is_current(
        floor_plan
    ):
        raise _error("photo_patrol_rooms_unavailable")
    room_names = {room.id: room.name for room in floor_plan.rooms}
    if not forbidden <= set(room_names):
        raise _error("photo_patrol_rooms_unavailable")
    area = state.operational.current_area
    if not isinstance(area, str) or not area.strip():
        raise _error("photo_patrol_rooms_unavailable")
    try:
        room_id, _name = resolve_room_reference(area, room_names)
    except ValueError as err:
        raise _error("photo_patrol_rooms_unavailable") from err
    if room_id in forbidden:
        raise _error("photo_patrol_room_blocked")


async def _async_still_parked(entry: MaticConfigEntry, area: str) -> bool:
    """Return whether the robot is still where the patrol left it.

    Only then is docking safe: a robot that moved, or can't be read, may have
    started something that docking would stop. A robot left parked docks on
    its own after its ten-minute countdown.
    """
    try:
        state: RobotOperationalState = await entry.runtime_data.client.async_get_state()
    except MaticError:
        return False
    return _left_parked(state, area)


async def _async_command(
    hass: HomeAssistant,
    entity_id: str,
    command: str,
    params: dict[str, str],
    context: Context | None,
) -> None:
    await hass.services.async_call(
        VACUUM_DOMAIN,
        SERVICE_SEND_COMMAND,
        {ATTR_ENTITY_ID: entity_id, ATTR_COMMAND: command, ATTR_PARAMS: params},
        blocking=True,
        context=context,
    )


def _error(key: str, **placeholders: str) -> HomeAssistantError:
    return HomeAssistantError(
        key,
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=placeholders or None,
    )
