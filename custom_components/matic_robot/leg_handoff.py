"""Start the next plan leg while the robot drives home from the last one."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from . import managed_observation as observation
from .client.exceptions import MaticError
from .managed_run import PlanCancelledError, _PreparedRoomDispatch
from .run_control import ManagedMotionReplacedError

_LOGGER = logging.getLogger(__name__)


async def async_dispatch_on_return(
    hass: HomeAssistant,
    entity_id: str,
    identity_reader: Callable[[], Awaitable[bytes | None]] | None,
    dispatch: Callable[
        [Callable[[bytes | None], None]], Awaitable[_PreparedRoomDispatch]
    ],
    bind_identity: Callable[[bytes | None], None],
    on_refused: Callable[[], Awaitable[None]],
) -> _PreparedRoomDispatch | None:
    """Send the next leg before the robot docks, or return None to dock first.

    The robot heads home whenever a mission ends, and a Smart Stop plan runs
    each room as its own mission, reached or not. Once its identity has
    cleared, the next leg can start from where the robot is. A command the
    robot refused without taking also returns None, so the caller falls back
    to the settled handoff at the dock, after ``on_refused``. ``dispatch``
    reports the identity of a mission the robot took through the callback it
    is given.
    """
    state = hass.states.get(entity_id)
    if (
        identity_reader is None
        or state is None
        or state.state != "returning"
        or await observation._async_read_session_identity(identity_reader) != b""
    ):
        return None
    taken = False

    def on_identity(identity: bytes | None) -> None:
        nonlocal taken
        taken = identity is not None
        bind_identity(identity)

    try:
        return await dispatch(on_identity)
    except PlanCancelledError, ManagedMotionReplacedError:
        raise
    except (HomeAssistantError, MaticError) as err:
        if taken:
            raise
        _LOGGER.debug(
            "Matic refused the next leg on its way home (%s)", type(err).__name__
        )
        await on_refused()
        return None
