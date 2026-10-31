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
from collections.abc import Awaitable, Callable
from time import monotonic
from typing import Protocol

from homeassistant.core import HomeAssistant

from .client.commands import UserCommand
from .client.exceptions import MaticError
from .const import DOMAIN
from .native_history import OEM_STOP_FENCE_SECONDS
from .plans import CleaningPlanManager

DOCK_SETTLE_POLL_SECONDS = 3
DOCK_SETTLE_TIMEOUT_SECONDS = OEM_STOP_FENCE_SECONDS
DOCK_CONFIRM_TIMEOUT_SECONDS = OEM_STOP_FENCE_SECONDS
# Coordinator state can still show the pre-STOP task for one refresh. Keep
# that stale edge from abandoning the settlement watcher, but stop waiting if
# cleaning or pause persists long enough to be replacement work.
DOCK_SETTLE_TRANSITION_GRACE_SECONDS = 60
DOCK_CONFIRM_TRANSITION_GRACE_SECONDS = DOCK_SETTLE_TRANSITION_GRACE_SECONDS

SETTLED_STATE = "idle"
HOMEWARD_STATES = frozenset({"docked", "returning", "charging"})
DOCKED_STATES = frozenset({"docked", "charging"})
REPLACEMENT_STATES = frozenset({"cleaning", "paused"})

_LOGGER = logging.getLogger(__name__)


class StopReturnClient(Protocol):
    """The small part of the robot client this watcher needs."""

    async def async_get_active_cleaning_session_state(self) -> bool | None:
        """Return whether the robot still owns an active cleaning task."""

    async def async_get_state(self) -> object:
        """Read one fresh operational snapshot directly from the robot."""

    async def async_send_user_command(self, command: UserCommand) -> None:
        """Send one vetted user command to the robot."""


async def async_native_stop_is_settled(
    hass: HomeAssistant,
    native_active: Callable[[], Awaitable[bool | None]],
    entity_id: str,
    *,
    fresh_state: Callable[[], Awaitable[object]] | None = None,
    allowed_states: frozenset[str] = DOCKED_STATES,
) -> bool:
    """Require native inactivity followed by a direct, fresh robot snapshot."""
    if fresh_state is None:
        return False
    try:
        active = await native_active()
    except MaticError as err:
        _LOGGER.debug(
            "Native Matic stop settlement unreadable (%s)", type(err).__name__
        )
        return False
    if active is not False:
        return False
    try:
        confirmed = await fresh_state()
    except MaticError as err:
        _LOGGER.debug("Fresh Matic stop state unreadable (%s)", type(err).__name__)
        return False
    cached = hass.states.get(entity_id)
    return (
        _fresh_state_name(confirmed) in allowed_states
        and cached is not None
        and cached.state not in REPLACEMENT_STATES
    )


def _fresh_state_name(state: object) -> str:
    """Classify only operational fields present in the direct snapshot."""
    flags = ("returning", "cleaning", "paused", "charging", "charging_idle")
    values = tuple(getattr(state, flag, None) for flag in flags)
    errors = getattr(state, "error_codes", None)
    if any(type(value) is not bool for value in values) or not isinstance(
        errors, tuple
    ):
        return "unknown"
    returning, cleaning, paused, charging, charging_idle = values
    if returning:
        return "returning"
    if cleaning:
        return "cleaning"
    if paused:
        return "paused"
    if charging:
        return "charging"
    if charging_idle:
        return "docked"
    if errors:
        return "error"
    return "idle"


async def async_clear_ownerless_stop_if_settled(
    hass: HomeAssistant,
    *,
    native_active: Callable[[], Awaitable[bool | None]],
    fresh_state: Callable[[], Awaitable[object]] | None = None,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
) -> bool:
    """Clear only the captured ownerless fence after native dock settlement."""
    stop_fence_token = manager.control.stop_fence_token(serial_number)
    if stop_fence_token is None or fresh_state is None:
        return False
    if not await async_native_stop_is_settled(
        hass,
        native_active,
        entity_id,
        fresh_state=fresh_state,
        allowed_states=DOCKED_STATES,
    ):
        return False
    return await manager.control.async_clear_stop_pending_if_token(
        serial_number, stop_fence_token, run_id=None
    )


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
    on_docked: Callable[[], Awaitable[bool | None]] | None = None,
    stop_fence_token: int | None = None,
) -> bool:
    """Dock once the stopped task ends and report whether DOCK was sent."""
    started = monotonic()
    deadline = started + DOCK_SETTLE_TIMEOUT_SECONDS
    transition_grace_deadline = min(
        deadline, started + DOCK_SETTLE_TRANSITION_GRACE_SECONDS
    )
    settled_state_observed = False
    settlement_callback = on_docked
    clear_stop_fence = getattr(
        manager.control, "async_clear_stop_pending_if_token", None
    )

    def owns_stop_fence() -> bool:
        if not manager.control.stop_pending(serial_number):
            return False
        current_token = getattr(manager.control, "stop_fence_token", None)
        return (
            stop_fence_token is None
            or not callable(current_token)
            or current_token(serial_number) == stop_fence_token
        )

    if stop_fence_token is not None:

        async def settle_confirmed_stop() -> bool:
            """Require native inactivity and current docking before settling STOP."""
            if not await async_native_stop_is_settled(
                hass,
                client.async_get_active_cleaning_session_state,
                entity_id,
                fresh_state=client.async_get_state,
            ):
                return False
            if on_docked is not None:
                return (await on_docked()) is not False
            elif run_id is None and callable(clear_stop_fence):
                return bool(
                    await clear_stop_fence(serial_number, stop_fence_token, run_id=None)
                )
            return False

        settlement_callback = settle_confirmed_stop

    def clear_run_scope() -> None:
        """Release this watcher without clearing a newer managed run."""
        if set_run_id is not None and (get_run_id is None or get_run_id() == run_id):
            set_run_id(None)

    try:
        while True:
            if not owns_stop_fence():
                return False
            now = monotonic()
            refresh_transition = False
            state = hass.states.get(entity_id)
            if state is not None:
                if state.state in REPLACEMENT_STATES:
                    # The first state read commonly still reflects the task that
                    # accepted STOP. Refresh through that bounded transition edge;
                    # a later or persistent cleaning state is replacement motion.
                    if settled_state_observed or now >= transition_grace_deadline:
                        return False
                    refresh_transition = True
                elif state.state in HOMEWARD_STATES | {SETTLED_STATE}:
                    settled_state_observed = True
                    dock_sent = False
                    already_docked = False
                    async with manager.control.external_command(serial_number):
                        # Replacements invalidate the fence before waiting for
                        # this lock. Recheck it both before and after the native
                        # session read so a late false result cannot trigger a
                        # stale DOCK command.
                        if not owns_stop_fence():
                            return False
                        latest_state = hass.states.get(entity_id)
                        if (
                            latest_state is None
                            or latest_state.state in REPLACEMENT_STATES
                        ):
                            return False
                        try:
                            active = (
                                await client.async_get_active_cleaning_session_state()
                            )
                        except MaticError as err:
                            _LOGGER.debug(
                                "Native Matic stop settlement unreadable (%s)",
                                type(err).__name__,
                            )
                            active = None
                        if active is not False and state.state in HOMEWARD_STATES:
                            # A cached HOMEWARD value can outlive the task, and
                            # the native probe can be active or temporarily
                            # unreadable. Retry within the existing bound; never
                            # send DOCK until native inactivity is authoritative.
                            refresh_transition = True
                        if active is False:
                            try:
                                fresh = await client.async_get_state()
                            except MaticError as err:
                                _LOGGER.debug(
                                    "Fresh Matic stop state unreadable (%s)",
                                    type(err).__name__,
                                )
                                fresh = None
                            fresh_name = (
                                _fresh_state_name(fresh)
                                if fresh is not None
                                else "unknown"
                            )
                            if fresh_name in DOCKED_STATES:
                                if not owns_stop_fence():
                                    return False
                                latest_state = hass.states.get(entity_id)
                                if (
                                    latest_state is None
                                    or latest_state.state in REPLACEMENT_STATES
                                ):
                                    return False
                                already_docked = True
                            elif fresh_name in REPLACEMENT_STATES:
                                return False
                            elif fresh_name != SETTLED_STATE:
                                # A failed, opaque, or still-returning direct
                                # snapshot is not permission to DOCK or clear the
                                # fence. Keep the bounded watcher alive so the
                                # next fresh sample can settle it.
                                refresh_transition = True
                            if not already_docked and not refresh_transition:
                                if not owns_stop_fence():
                                    return False
                                latest_state = hass.states.get(entity_id)
                                if (
                                    latest_state is None
                                    or latest_state.state in REPLACEMENT_STATES
                                ):
                                    return False
                                if set_run_id is not None and run_id is not None:
                                    set_run_id(run_id)
                                try:
                                    await client.async_send_user_command(
                                        UserCommand.DOCK
                                    )
                                except MaticError as err:
                                    _LOGGER.warning(
                                        "Unable to dock Matic after its stop "
                                        "settled (%s)",
                                        type(err).__name__,
                                    )
                                    return False
                                dock_sent = True
                    if already_docked:
                        if settlement_callback is not None:
                            return (await settlement_callback()) is not False
                        return True
                    if dock_sent:
                        # Failure finalization also needs the command lease. Do
                        # not hold it while waiting for the run's terminal state.
                        if settlement_callback is not None:
                            await async_confirm_docked(
                                hass,
                                refresh=refresh,
                                entity_id=entity_id,
                                on_docked=settlement_callback,
                                run_id=run_id,
                                set_run_id=set_run_id,
                                get_run_id=get_run_id,
                            )
                        else:
                            await refresh()
                        return True
            if now >= deadline:
                return False
            await asyncio.sleep(DOCK_SETTLE_POLL_SECONDS)
            if refresh_transition:
                await refresh()
    finally:
        clear_run_scope()


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
    on_docked: Callable[[], Awaitable[bool | None]] | None = None,
) -> None:
    """Start a lifecycle-bound watcher that docks a settled stop."""
    create_background_task = getattr(hass, "async_create_background_task", None)
    if not callable(create_background_task):
        return
    stop_fence_token_reader = getattr(manager.control, "stop_fence_token", None)
    stop_fence_token = (
        stop_fence_token_reader(serial_number)
        if callable(stop_fence_token_reader)
        else None
    )
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
            stop_fence_token=stop_fence_token,
        ),
        f"{DOMAIN} dock after stop",
    )
    register_task = getattr(manager.control, "register_reconciliation_task", None)
    if isinstance(task, asyncio.Task) and callable(register_task):
        register_task(serial_number, task, dock=True, run_id=run_id)


async def async_confirm_docked(
    hass: HomeAssistant,
    *,
    refresh: Callable[[], Awaitable[None]],
    entity_id: str,
    on_docked: Callable[[], Awaitable[bool | None]],
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
                if await on_docked() is not False:
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
    on_docked: Callable[[], Awaitable[bool | None]],
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
    register_task = getattr(manager.control, "register_reconciliation_task", None)
    if isinstance(task, asyncio.Task) and callable(register_task):
        register_task(serial_number, task, dock=True, run_id=run_id)
    return isinstance(task, asyncio.Task)
