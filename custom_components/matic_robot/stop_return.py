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
from enum import Enum, auto
from functools import partial
from time import monotonic
from typing import Protocol

from homeassistant.core import HomeAssistant

from .client import MaticError, UserCommand
from .const import DOMAIN
from .native_history import OEM_STOP_FENCE_SECONDS
from .plans import CleaningPlanManager

DOCK_SETTLE_POLL_SECONDS = 3
DOCK_SETTLE_TIMEOUT_SECONDS = OEM_STOP_FENCE_SECONDS
DOCK_CONFIRM_TIMEOUT_SECONDS = OEM_STOP_FENCE_SECONDS
# Pushed state can still show the pre-STOP task for one publish. Keep
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


async def _async_native_settled_state(
    native_active: Callable[[], Awaitable[bool | None]],
    fresh_state: Callable[[], Awaitable[object]],
) -> str | None:
    """Return a fresh state name once the native task reports inactive, else None."""
    try:
        active = await native_active()
    except MaticError as err:
        _LOGGER.debug(
            "Native Matic stop settlement unreadable (%s)", type(err).__name__
        )
        return None
    if active is not False:
        return None
    try:
        confirmed = await fresh_state()
    except MaticError as err:
        _LOGGER.debug("Fresh Matic stop state unreadable (%s)", type(err).__name__)
        return "unknown"
    return _fresh_state_name(confirmed)


async def async_native_stop_is_settled(
    hass: HomeAssistant,
    native_active: Callable[[], Awaitable[bool | None]],
    entity_id: str,
    *,
    fresh_state: Callable[[], Awaitable[object]],
    allowed_states: frozenset[str] = DOCKED_STATES,
) -> bool:
    """Require native inactivity followed by a direct, fresh robot snapshot."""
    fresh = await _async_native_settled_state(native_active, fresh_state)
    if fresh not in allowed_states:
        return False
    cached = hass.states.get(entity_id)
    return cached is not None and cached.state not in REPLACEMENT_STATES


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
    fresh_state: Callable[[], Awaitable[object]],
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
) -> bool:
    """Clear only the captured ownerless fence after native dock settlement."""
    stop_fence_token = manager.control.stop_fence_token(serial_number)
    if stop_fence_token is None:
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


class _Settlement(Enum):
    """What one settlement sample lets the watcher do."""

    ABANDON = auto()  # Replacement work or a lost fence: the firmware keeps STOP.
    WAIT = auto()
    REFRESH = auto()  # Refresh state before the next sample.
    DOCKED = auto()  # Already home: settle without DOCK.
    DOCK = auto()


async def _async_sample_settlement(
    client: StopReturnClient,
    cached_state: str,
    owns_settled_stop: Callable[[], bool],
) -> _Settlement:
    """Classify a settled-looking STOP from the robot's own evidence.

    Runs under the command lock. A replacement invalidates the fence before
    waiting for that lock, so ownership is rechecked before the native reads
    and again before acting on them: a late inactive result cannot DOCK.
    """
    if not owns_settled_stop():
        return _Settlement.ABANDON
    fresh = await _async_native_settled_state(
        client.async_get_active_cleaning_session_state, client.async_get_state
    )
    if fresh is None:
        # A cached homeward value can outlive the task while the native probe
        # is active or unreadable. Retry within the bound; never DOCK until
        # native inactivity is authoritative.
        if cached_state in HOMEWARD_STATES:
            return _Settlement.REFRESH
        return _Settlement.WAIT
    if fresh in REPLACEMENT_STATES:
        return _Settlement.ABANDON
    if fresh not in DOCKED_STATES and fresh != SETTLED_STATE:
        # A failed, opaque or still-returning snapshot is not permission to
        # DOCK or clear the fence; the next fresh sample can settle it.
        return _Settlement.REFRESH
    if not owns_settled_stop():
        return _Settlement.ABANDON
    return _Settlement.DOCKED if fresh in DOCKED_STATES else _Settlement.DOCK


async def _async_send_dock(
    client: StopReturnClient,
    run_id: str | None,
    set_run_id: Callable[[str | None], None] | None,
) -> bool:
    """Send DOCK in the run's journal scope; False if the robot refused it."""
    if set_run_id is not None and run_id is not None:
        set_run_id(run_id)
    try:
        await client.async_send_user_command(UserCommand.DOCK)
    except MaticError as err:
        _LOGGER.warning(
            "Unable to dock Matic after its stop settled (%s)", type(err).__name__
        )
        return False
    return True


async def _async_settle_fenced_stop(
    hass: HomeAssistant,
    client: StopReturnClient,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    stop_fence_token: int,
    run_id: str | None,
    on_docked: Callable[[], Awaitable[bool | None]] | None,
) -> bool:
    """Settle a captured STOP fence once the robot is natively done and home."""
    if not await async_native_stop_is_settled(
        hass,
        client.async_get_active_cleaning_session_state,
        entity_id,
        fresh_state=client.async_get_state,
    ):
        return False
    if on_docked is not None:
        return (await on_docked()) is not False
    if run_id is None:
        return bool(
            await manager.control.async_clear_stop_pending_if_token(
                serial_number, stop_fence_token, run_id=None
            )
        )
    # A run's fence settles only through that run's finalizer.
    return False


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
    settle = (
        on_docked
        if stop_fence_token is None
        else partial(
            _async_settle_fenced_stop,
            hass,
            client,
            manager,
            serial_number,
            entity_id,
            stop_fence_token,
            run_id,
            on_docked,
        )
    )

    def owns_stop_fence() -> bool:
        if not manager.control.stop_pending(serial_number):
            return False
        return (
            stop_fence_token is None
            or manager.control.stop_fence_token(serial_number) == stop_fence_token
        )

    def owns_settled_stop() -> bool:
        if not owns_stop_fence():
            return False
        latest = hass.states.get(entity_id)
        return latest is not None and latest.state not in REPLACEMENT_STATES

    try:
        while True:
            if not owns_stop_fence():
                return False
            now = monotonic()
            step = _Settlement.WAIT
            state = hass.states.get(entity_id)
            if state is not None and state.state in REPLACEMENT_STATES:
                # The first state read commonly still reflects the task that
                # accepted STOP. Refresh through that bounded transition edge;
                # a later or persistent cleaning state is replacement motion.
                if settled_state_observed or now >= transition_grace_deadline:
                    return False
                step = _Settlement.REFRESH
            elif state is not None and state.state in HOMEWARD_STATES | {SETTLED_STATE}:
                settled_state_observed = True
                async with manager.control.external_command(serial_number):
                    step = await _async_sample_settlement(
                        client, state.state, owns_settled_stop
                    )
                    if step is _Settlement.DOCK and not await _async_send_dock(
                        client, run_id, set_run_id
                    ):
                        return False
                if step is _Settlement.ABANDON:
                    return False
                if step is _Settlement.DOCKED:
                    return settle is None or (await settle()) is not False
                if step is _Settlement.DOCK:
                    # Failure finalization also needs the command lease. Do
                    # not hold it while waiting for the run's terminal state.
                    if settle is None:
                        await refresh()
                    else:
                        await async_confirm_docked(
                            hass,
                            refresh=refresh,
                            entity_id=entity_id,
                            on_docked=settle,
                            run_id=run_id,
                            set_run_id=set_run_id,
                            get_run_id=get_run_id,
                        )
                    return True
            if now >= deadline:
                return False
            await asyncio.sleep(DOCK_SETTLE_POLL_SECONDS)
            if step is _Settlement.REFRESH:
                await refresh()
    finally:
        # Release this watcher without clearing a newer managed run.
        if set_run_id is not None and (get_run_id is None or get_run_id() == run_id):
            set_run_id(None)


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
    stop_fence_token = manager.control.stop_fence_token(serial_number)
    task = hass.async_create_background_task(
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
    manager.control.register_reconciliation_task(
        serial_number, task, dock=True, run_id=run_id
    )


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
) -> None:
    """Start a lifecycle-bound watcher for an already-sent DOCK command."""
    task = hass.async_create_background_task(
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
    manager.control.register_reconciliation_task(
        serial_number, task, dock=True, run_id=run_id
    )
