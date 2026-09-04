"""Send a stopped robot home as soon as its native task settles.

Matic's firmware owns a graceful countdown after an accepted STOP and docks
only once it expires.  A DOCK sent while that task is still running is
reinterpreted as recharge-and-resume, which is why the integration lets STOP
own the return.  Once the task has actually ended there is nothing left to
resume, so a DOCK then simply sends the robot home: measured live on firmware
v172.12, stop-to-docked falls from 11.5 minutes to under one.

The watcher is deliberately evidence-driven and fails closed.  It docks only
while the robot is idle, the robot's own session reports inactive, and this
stop still owns the fence; anything else leaves the firmware countdown in
charge exactly as before.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from time import monotonic
from typing import Protocol

from homeassistant.core import HomeAssistant

from .client.commands import UserCommand
from .client.exceptions import MaticError
from .const import DOMAIN
from .plans import OEM_STOP_FENCE_SECONDS, CleaningPlanManager

DOCK_SETTLE_POLL_SECONDS = 3
DOCK_SETTLE_TIMEOUT_SECONDS = OEM_STOP_FENCE_SECONDS
# Coordinator state can still show the pre-STOP task for one refresh. Keep
# that stale edge from abandoning the settlement watcher, but stop waiting if
# cleaning or pause persists long enough to be replacement work.
DOCK_SETTLE_TRANSITION_GRACE_SECONDS = 60

SETTLED_STATE = "idle"
HOMEWARD_STATES = frozenset({"docked", "returning"})
REPLACEMENT_STATES = frozenset({"cleaning", "paused"})

_LOGGER = logging.getLogger(__name__)


class StopReturnClient(Protocol):
    """The small part of the robot client this watcher needs."""

    async def async_has_active_cleaning_session(self) -> bool | None:
        """Return whether the robot still owns an active cleaning task."""

    async def async_send_user_command(self, command: UserCommand) -> None:
        """Send one vetted user command to the robot."""


@asynccontextmanager
async def _command_guard(
    manager: CleaningPlanManager, serial_number: str
) -> AsyncIterator[None]:
    """Serialize the final stop-settlement check with replacement commands.

    Older test doubles and integrations may not expose a command lock; those
    callers retain the previous fail-closed behavior.  The real plan manager
    does expose one, so a replacement cannot dispatch between the native
    session read and the final stop-fence check.
    """
    command_lock = getattr(manager, "command_lock", None)
    if not callable(command_lock):
        yield
        return
    async with command_lock(serial_number):
        yield


async def async_dock_when_stop_settles(
    hass: HomeAssistant,
    *,
    client: StopReturnClient,
    refresh: Callable[[], Awaitable[None]],
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
) -> bool:
    """Dock once the stopped task ends and report whether DOCK was sent."""
    started = monotonic()
    deadline = started + DOCK_SETTLE_TIMEOUT_SECONDS
    transition_grace_deadline = min(
        deadline, started + DOCK_SETTLE_TRANSITION_GRACE_SECONDS
    )
    settled_state_observed = False
    while True:
        if not manager.stop_pending(serial_number):
            return False
        now = monotonic()
        refresh_transition = False
        state = hass.states.get(entity_id)
        if state is not None:
            if state.state in HOMEWARD_STATES:
                return False
            if state.state in REPLACEMENT_STATES:
                # The first state read commonly still reflects the task that
                # accepted STOP. Refresh through that bounded transition edge;
                # a later or persistent cleaning state is replacement motion.
                if settled_state_observed or now >= transition_grace_deadline:
                    return False
                refresh_transition = True
            elif state.state == SETTLED_STATE:
                settled_state_observed = True
                async with _command_guard(manager, serial_number):
                    # Replacements invalidate the fence before waiting for
                    # this lock. Recheck it both before and after the native
                    # session read so a late false result cannot trigger a
                    # stale DOCK command.
                    if not manager.stop_pending(serial_number):
                        return False
                    latest_state = hass.states.get(entity_id)
                    if latest_state is None or latest_state.state != SETTLED_STATE:
                        return False
                    try:
                        active = await client.async_has_active_cleaning_session()
                    except MaticError as err:
                        _LOGGER.debug(
                            "Native Matic stop settlement unreadable (%s)",
                            type(err).__name__,
                        )
                        active = None
                    if active is False:
                        if not manager.stop_pending(serial_number):
                            return False
                        latest_state = hass.states.get(entity_id)
                        if latest_state is None or latest_state.state != SETTLED_STATE:
                            return False
                        try:
                            await client.async_send_user_command(UserCommand.DOCK)
                        except MaticError as err:
                            _LOGGER.warning(
                                "Unable to dock Matic after its stop settled (%s)",
                                type(err).__name__,
                            )
                            return False
                        await refresh()
                        return True
        if now >= deadline:
            return False
        await asyncio.sleep(DOCK_SETTLE_POLL_SECONDS)
        if refresh_transition:
            await refresh()


def schedule_dock_after_stop(
    hass: HomeAssistant,
    *,
    client: StopReturnClient,
    refresh: Callable[[], Awaitable[None]],
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
) -> None:
    """Start a lifecycle-bound watcher that docks a settled stop."""
    create_background_task = getattr(hass, "async_create_background_task", None)
    if not callable(create_background_task):
        return
    task = create_background_task(
        async_dock_when_stop_settles(
            hass,
            client=client,
            refresh=refresh,
            manager=manager,
            serial_number=serial_number,
            entity_id=entity_id,
        ),
        f"{DOMAIN} dock after stop",
    )
    register_task = getattr(manager, "register_reconciliation_task", None)
    if isinstance(task, asyncio.Task) and callable(register_task):
        register_task(serial_number, task)
