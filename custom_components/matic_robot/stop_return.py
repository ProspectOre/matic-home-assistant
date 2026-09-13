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
DOCK_CONFIRM_TIMEOUT_SECONDS = OEM_STOP_FENCE_SECONDS
# Coordinator state can still show the pre-STOP task for one refresh. Keep
# that stale edge from abandoning the settlement watcher, but stop waiting if
# cleaning or pause persists long enough to be replacement work.
DOCK_SETTLE_TRANSITION_GRACE_SECONDS = 60
DOCK_CONFIRM_TRANSITION_GRACE_SECONDS = DOCK_SETTLE_TRANSITION_GRACE_SECONDS

SETTLED_STATE = "idle"
HOMEWARD_STATES = frozenset({"docked", "returning"})
DOCKED_STATES = frozenset({"docked", "charging"})
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
    run_id: str | None = None,
    set_run_id: Callable[[str | None], None] | None = None,
    get_run_id: Callable[[], str | None] | None = None,
    on_docked: Callable[[], Awaitable[None]] | None = None,
) -> bool:
    """Dock once the stopped task ends and report whether DOCK was sent."""
    started = monotonic()
    deadline = started + DOCK_SETTLE_TIMEOUT_SECONDS
    transition_grace_deadline = min(
        deadline, started + DOCK_SETTLE_TRANSITION_GRACE_SECONDS
    )
    settled_state_observed = False
    run_scope_claimed = False

    def clear_run_scope() -> None:
        """Release this watcher without clearing a newer managed run."""
        if set_run_id is not None and (get_run_id is None or get_run_id() == run_id):
            set_run_id(None)

    while True:
        if not manager.stop_pending(serial_number):
            return False
        now = monotonic()
        refresh_transition = False
        state = hass.states.get(entity_id)
        if state is not None:
            if state.state in HOMEWARD_STATES:
                if on_docked is not None:
                    return await async_confirm_docked(
                        hass,
                        refresh=refresh,
                        entity_id=entity_id,
                        on_docked=on_docked,
                        run_id=run_id,
                        set_run_id=set_run_id,
                        get_run_id=get_run_id,
                    )
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
                        if set_run_id is not None and run_id is not None:
                            set_run_id(run_id)
                            run_scope_claimed = True
                        try:
                            try:
                                await client.async_send_user_command(UserCommand.DOCK)
                            except MaticError as err:
                                _LOGGER.warning(
                                    "Unable to dock Matic after its stop settled (%s)",
                                    type(err).__name__,
                                )
                                return False
                            await refresh()
                            if on_docked is not None:
                                confirm_deadline = (
                                    monotonic() + DOCK_CONFIRM_TIMEOUT_SECONDS
                                )
                                replacement_deadline: float | None = None
                                while True:
                                    if not manager.stop_pending(serial_number):
                                        break
                                    confirmed = hass.states.get(entity_id)
                                    now = monotonic()
                                    if (
                                        confirmed is not None
                                        and confirmed.state in DOCKED_STATES
                                    ):
                                        await on_docked()
                                        break
                                    if (
                                        confirmed is not None
                                        and confirmed.state in REPLACEMENT_STATES
                                    ):
                                        if replacement_deadline is None:
                                            replacement_deadline = (
                                                now
                                                + DOCK_CONFIRM_TRANSITION_GRACE_SECONDS
                                            )
                                        elif now >= replacement_deadline:
                                            _LOGGER.debug(
                                                "Matic DOCK confirmation abandoned "
                                                "after replacement motion"
                                            )
                                            break
                                    else:
                                        replacement_deadline = None
                                    if now >= confirm_deadline:
                                        _LOGGER.debug(
                                            "Matic DOCK accepted but docked state was "
                                            "not observed"
                                        )
                                        break
                                    await asyncio.sleep(DOCK_SETTLE_POLL_SECONDS)
                                    await refresh()
                        finally:
                            if run_scope_claimed:
                                clear_run_scope()
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
    run_id: str | None = None,
    set_run_id: Callable[[str | None], None] | None = None,
    get_run_id: Callable[[], str | None] | None = None,
    on_docked: Callable[[], Awaitable[None]] | None = None,
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
            run_id=run_id,
            set_run_id=set_run_id,
            get_run_id=get_run_id,
            on_docked=on_docked,
        ),
        f"{DOMAIN} dock after stop",
    )
    register_task = getattr(manager, "register_reconciliation_task", None)
    if isinstance(task, asyncio.Task) and callable(register_task):
        register_task(serial_number, task, dock=True)


async def async_confirm_docked(
    hass: HomeAssistant,
    *,
    refresh: Callable[[], Awaitable[None]],
    entity_id: str,
    on_docked: Callable[[], Awaitable[None]],
    run_id: str | None = None,
    set_run_id: Callable[[str | None], None] | None = None,
    get_run_id: Callable[[], str | None] | None = None,
) -> bool:
    """Wait for a DOCK command to produce an observed docked state."""
    deadline = monotonic() + DOCK_CONFIRM_TIMEOUT_SECONDS
    run_scope_claimed = False
    if set_run_id is not None and run_id is not None:
        current_run_id = get_run_id() if get_run_id is not None else None
        if get_run_id is not None and current_run_id not in {None, run_id}:
            return False
        set_run_id(run_id)
        run_scope_claimed = True
    replacement_deadline: float | None = None
    try:
        # The command sender has usually refreshed once, but that read can be
        # the pre-command cleaning state. Refresh before interpreting the
        # first confirmation state, then allow a bounded transition edge.
        await refresh()
        while True:
            state = hass.states.get(entity_id)
            now = monotonic()
            if state is not None and state.state in DOCKED_STATES:
                await on_docked()
                return True
            if state is not None and state.state in REPLACEMENT_STATES:
                if replacement_deadline is None:
                    replacement_deadline = now + DOCK_CONFIRM_TRANSITION_GRACE_SECONDS
                if now >= replacement_deadline:
                    _LOGGER.debug(
                        "Matic DOCK confirmation abandoned after replacement motion"
                    )
                    return False
            else:
                replacement_deadline = None
            if now >= deadline:
                return False
            await asyncio.sleep(DOCK_SETTLE_POLL_SECONDS)
            await refresh()
    finally:
        if (
            run_scope_claimed
            and set_run_id is not None
            and (get_run_id is None or get_run_id() == run_id)
        ):
            set_run_id(None)


def schedule_dock_confirmation(
    hass: HomeAssistant,
    *,
    refresh: Callable[[], Awaitable[None]],
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    run_id: str,
    on_docked: Callable[[], Awaitable[None]],
    set_run_id: Callable[[str | None], None] | None = None,
    get_run_id: Callable[[], str | None] | None = None,
) -> bool:
    """Start a lifecycle-bound watcher for an already-sent DOCK command."""
    create_background_task = getattr(hass, "async_create_background_task", None)
    if not callable(create_background_task):
        return False
    task = create_background_task(
        async_confirm_docked(
            hass,
            refresh=refresh,
            entity_id=entity_id,
            on_docked=on_docked,
            run_id=run_id,
            set_run_id=set_run_id,
            get_run_id=get_run_id,
        ),
        f"{DOMAIN} confirm managed dock {run_id}",
    )
    register_task = getattr(manager, "register_reconciliation_task", None)
    if isinstance(task, asyncio.Task) and callable(register_task):
        register_task(serial_number, task, dock=True)
    return isinstance(task, asyncio.Task)
