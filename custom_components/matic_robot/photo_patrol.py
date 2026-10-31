"""Send the robot to rooms and photograph each one."""

from __future__ import annotations

import asyncio
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
from .const import DOMAIN
from .plans import resolve_room_reference

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
# A photo captured more than this before the snap command, by the robot's
# clock, is an older one. Live snaps matched Home Assistant's clock to within
# a few seconds.
CLOCK_TOLERANCE = timedelta(minutes=1)
PHOTO_TAKEN_EVENT = f"{DOMAIN}_photo_taken"

_patrols: dict[str, asyncio.Lock] = {}


def photo_url(entry_id: str, photo_id: str) -> str:
    """Return the authenticated URL that serves one recent photo."""
    return f"/api/{DOMAIN}/photo/{entry_id}/{photo_id}"


async def async_photo_patrol(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    entity_id: str,
    rooms: list[str],
    *,
    return_to_dock: bool,
    context: Context | None = None,
) -> list[dict[str, str]]:
    """Visit each room in turn, photograph it, then dock.

    Each photo is returned with its room as soon as the robot has saved it,
    and a ``matic_robot_photo_taken`` event is fired for it.
    """
    lock = _patrols.setdefault(entry.entry_id, asyncio.Lock())
    if lock.locked():
        raise _error("photo_patrol_running")
    async with lock:
        operational = entry.runtime_data.coordinator.data.operational
        if operational.cleaning or operational.paused or operational.returning:
            raise _error("photo_patrol_robot_busy")
        battery = operational.battery_percentage
        if battery is not None and battery < MIN_BATTERY_PERCENT:
            raise _error("photo_patrol_low_battery", battery=str(battery))
        results: list[dict[str, str]] = []
        # The area the robot reported at each room it reached.
        arrivals: list[str] = []
        try:
            for room in rooms:
                photo = await _async_photograph(
                    hass, entry, entity_id, room, context, arrivals
                )
                result = {
                    "room": room,
                    "photo_id": photo.photo_id,
                    "captured_at": photo.captured_at.isoformat(),
                    "url": photo_url(entry.entry_id, photo.photo_id),
                }
                results.append(result)
                hass.bus.async_fire(
                    PHOTO_TAKEN_EVENT,
                    {ATTR_ENTITY_ID: entity_id, **result},
                    context=context,
                )
        finally:
            if (
                return_to_dock
                and arrivals
                and await _async_still_parked(entry, arrivals[-1])
            ):
                await hass.services.async_call(
                    VACUUM_DOMAIN,
                    SERVICE_RETURN_TO_BASE,
                    {ATTR_ENTITY_ID: entity_id},
                    blocking=True,
                    context=context,
                )
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
    # A clean or another Go to room started during the read would take the
    # photo somewhere else.
    if not _left_parked(await _async_state(client), arrivals[-1]):
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
