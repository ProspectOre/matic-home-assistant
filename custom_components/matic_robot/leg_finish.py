"""End a multi-room leg's mission after its current room on a Smart Stop."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from homeassistant.exceptions import HomeAssistantError

from .client import MaticError, QueueChangeError
from .plan_model import CleaningRoom

_LOGGER = logging.getLogger(__name__)


async def async_end_after_current_room(
    finish_room_event: asyncio.Event,
    end: Callable[[bytes], Awaitable[None]],
    identity: Callable[[], bytes | None],
    current_room: Callable[[], CleaningRoom],
    on_ended: Callable[[CleaningRoom], None],
) -> None:
    """Wait for a finish-current-room request, then skip every waiting room.

    ``end`` asks the robot to drop the waiting rooms of the mission it is
    given. The robot finishes the room it is in and ends the mission itself,
    so no STOP has to land between rooms. ``on_ended`` gets the room that was
    current when the request came, once the robot holds no waiting room. When
    the change fails, the leg's STOP at the next room boundary still applies.
    """
    await finish_room_event.wait()
    room = current_room()
    native = identity()
    if not native:
        return
    try:
        await end(native)
    except QueueChangeError as err:
        if err.reason != "last_room":
            _LOGGER.debug("Matic kept the rooms after %s (%s)", room.room_id, err)
            return
    except (HomeAssistantError, MaticError) as err:
        _LOGGER.debug(
            "Matic kept the rooms after %s (%s)", room.room_id, type(err).__name__
        )
        return
    on_ended(room)
