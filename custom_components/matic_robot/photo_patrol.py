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
from .client.models import RobotOperationalState
from .const import DOMAIN

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
        try:
            for room in rooms:
                photo = await _async_photograph(hass, entry, entity_id, room, context)
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
            if return_to_dock and not await _async_taken_over(entry):
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
) -> RobotPhoto:
    client = entry.runtime_data.client
    photos = entry.runtime_data.photos
    state = await _async_state(client)
    if _busy(state):
        raise _error("photo_patrol_robot_busy")
    was_parked = _parked(state)
    await _async_command(hass, entity_id, "go_to_room", {"room": room}, context)
    if was_parked:
        await _async_wait_for(client, lambda state: not _parked(state), None)
    await _async_wait_for(
        client,
        _parked,
        _error("photo_patrol_no_arrival", room=room),
        within=ARRIVAL_TIMEOUT_SECONDS,
    )
    # Read the collection first so an older photo the store hasn't seen yet
    # doesn't arrive during the wait below. The capture time check covers a
    # read that fails.
    await photos.async_refresh()
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
            return latest
    raise _error("photo_patrol_no_photo", room=room)


async def _async_wait_for(
    client: Any,
    condition: Callable[[RobotOperationalState], bool],
    timeout_error: HomeAssistantError | None,
    *,
    within: float = LEAVE_TIMEOUT_SECONDS,
) -> None:
    """Poll the robot until ``condition`` holds.

    Without ``timeout_error`` a timeout is accepted silently.
    """
    deadline = monotonic() + within
    while monotonic() < deadline:
        await asyncio.sleep(POLL_SECONDS)
        if condition(await _async_state(client)):
            return
    if timeout_error is not None:
        raise timeout_error


async def _async_state(client: Any) -> RobotOperationalState:
    try:
        state: RobotOperationalState = await client.async_get_state()
    except MaticError as err:
        raise _error("photo_patrol_unreachable") from err
    return state


def _parked(state: RobotOperationalState) -> bool:
    return PARKED_STATE_CODE in state.state_codes


def _busy(state: RobotOperationalState) -> bool:
    """Return whether something else gave the robot a task during the patrol.

    The patrol leaves the robot parked at a room between photos, so a robot
    that is cleaning, paused or returning and not parked was taken over by a
    clean or sent back to the dock.
    """
    return not _parked(state) and (state.cleaning or state.paused or state.returning)


async def _async_taken_over(entry: MaticConfigEntry) -> bool:
    """Return whether docking now would stop a task the patrol didn't start."""
    try:
        state: RobotOperationalState = await entry.runtime_data.client.async_get_state()
    except MaticError:
        return False
    return _busy(state)


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
