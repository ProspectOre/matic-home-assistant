"""Bounded Home Assistant observations and native session ownership waits."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Collection, Sequence
from datetime import datetime
from time import monotonic
from typing import Any

from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import dt as dt_util

from .client.coverage_receipts import native_session_hash
from .client.exceptions import MaticError
from .client.models import CleaningSessionRecord
from .managed_run import (
    PlanCancelledError,
    RoomInterruptedError,
    RoomRunOutcome,
    RoomTakenOverError,
    _validation_error,
)
from .native_completion import (
    match_single_room_completions,
    native_room_key,
    session_overlaps_dispatch,
)
from .native_history import OEM_STOP_RECONCILIATION_SECONDS
from .plan_model import CleaningRoom

_LOGGER = logging.getLogger(__name__)

ROOM_STATUS_REFRESH_SECONDS = 5

ACTIVE_SESSION_UNKNOWN_ATTEMPTS = 3

ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS = 1

SESSION_HISTORY_ATTEMPTS = 151

SESSION_HISTORY_RETRY_SECONDS = 2

SESSION_HISTORY_TIMEOUT_SECONDS = 300

LEG_HANDOFF_POLL_SECONDS = ROOM_STATUS_REFRESH_SECONDS

LEG_HANDOFF_TIMEOUT_SECONDS = OEM_STOP_RECONCILIATION_SECONDS


async def _async_verify_leg_completion(
    reader: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
    baseline: frozenset[bytes] | None,
    rooms: Sequence[CleaningRoom],
    dispatched_at: datetime,
    *,
    hass: HomeAssistant | None = None,
    entity_id: str | None = None,
    cancel_event: asyncio.Event | None = None,
    attempts: int = SESSION_HISTORY_ATTEMPTS,
    allow_active_cleaning: bool = False,
    timeout_seconds: float | None = None,
    on_verified_session: Callable[[str], None] | None = None,
    skipped_room_ids: Collection[str] = (),
) -> dict[str, tuple[str, int]] | None:
    """Match one new native leg record and return per-room completion evidence.

    The returned mapping holds ``room_id -> (ended_at, duration_seconds)`` for
    every leg room the record marks completed with a positive duration.  A
    missing or ambiguous record returns ``None`` and credits nothing.
    """
    if reader is None or baseline is None:
        return None
    targets = {room.name.strip().casefold(): room.room_id for room in rooms}
    required_room_ids = set(targets.values()) - set(skipped_room_ids)
    evidence: dict[str, tuple[str, int]] | None = None
    matched_key: bytes | None = None
    try:
        async with asyncio.timeout(
            SESSION_HISTORY_TIMEOUT_SECONDS
            if timeout_seconds is None
            else timeout_seconds
        ):
            for attempt in range(attempts):
                _raise_if_completion_verification_was_replaced(
                    hass,
                    entity_id,
                    cancel_event,
                    allow_active_cleaning=allow_active_cleaning,
                )
                try:
                    records = await reader()
                except MaticError as err:
                    _LOGGER.debug(
                        "Native Matic leg evidence unavailable (%s)", type(err).__name__
                    )
                    records = ()
                _raise_if_completion_verification_was_replaced(
                    hass,
                    entity_id,
                    cancel_event,
                    allow_active_cleaning=allow_active_cleaning,
                )
                now = dt_util.utcnow()
                matches: list[CleaningSessionRecord] = []
                for record in records:
                    session = record.session
                    if record.key in baseline:
                        continue
                    if not session_overlaps_dispatch(session, dispatched_at, now):
                        continue
                    names = [name.strip().casefold() for name in session.rooms]
                    if (
                        not names
                        or len(names) != len(set(names))
                        or any(name not in targets for name in names)
                    ):
                        # Native names are exact strings; normalized aliases must
                        # not collapse distinct rooms into one completion credit.
                        continue
                    matches.append(record)
                if len(matches) == 1:
                    if matched_key is not None and matched_key != matches[0].key:
                        return None
                    matched_key = matches[0].key
                    session = matches[0].session
                    ended_at = session.ended_at
                    assert isinstance(ended_at, str)
                    evidence = {}
                    for room in rooms:
                        if room.room_id not in required_room_ids:
                            continue
                        name = room.name.strip().casefold()
                        durations = {
                            name.strip().casefold(): duration
                            for name, duration in session.room_durations_for_mode(
                                room.cleaning_mode
                            )
                        }
                        completed_names = {
                            name.strip().casefold()
                            for name in session.completed_rooms_for_mode(
                                room.cleaning_mode
                            )
                        }
                        duration = durations.get(name)
                        if (
                            name in completed_names
                            and isinstance(duration, int)
                            and not isinstance(duration, bool)
                            and duration > 0
                        ):
                            evidence[room.room_id] = (ended_at, duration)
                    # Native history can publish timestamps before per-room results.
                    # Keep polling the same record until complete or the bounded window
                    # expires; never combine evidence from different physical sessions.
                    if set(evidence) == required_room_ids:
                        break
                if len(matches) > 1:
                    return None
                if attempt + 1 < attempts:
                    if cancel_event is None:
                        await asyncio.sleep(SESSION_HISTORY_RETRY_SECONDS)
                    else:
                        try:
                            async with asyncio.timeout(SESSION_HISTORY_RETRY_SECONDS):
                                await cancel_event.wait()
                        except TimeoutError:
                            continue
                        raise PlanCancelledError
    except TimeoutError:
        pass
    if evidence and matched_key is not None and on_verified_session is not None:
        if session_hash := native_session_hash(matched_key):
            on_verified_session(session_hash)
    return evidence


async def _async_wait_for_room_outcome(
    hass: HomeAssistant,
    entity_id: str,
    room: CleaningRoom,
    cancel_event: asyncio.Event | None = None,
    *,
    initial_observed: bool = False,
) -> RoomRunOutcome:
    """Classify the next terminal transition using positive room evidence.

    A bare ``returning``, ``docked``, or ``idle`` state is deliberately not a
    completion.  Completion requires the issued single-room command to be seen
    cleaning that room before a normal return.  A low-charge return is a
    suspension so firmware may recharge and resume it.  Every other terminal
    transition is interrupted/unknown and receives no room-history credit.
    """
    outcome, _changed = await _async_wait_for_leg_outcome(
        hass,
        entity_id,
        [room],
        room,
        cancel_event,
        initial_observed=initial_observed,
    )
    return outcome


class _LegOutcomeObserver:
    """Own ordered, bounded observations for one multi-room native leg."""

    def __init__(
        self,
        hass: HomeAssistant,
        entity_id: str,
        rooms: Sequence[CleaningRoom],
        initial_room: CleaningRoom,
        *,
        initial_observed: bool,
        classify_current: bool = True,
        suppress_pause: bool = False,
        initial_suspended: bool = False,
    ) -> None:
        self._rooms = tuple(rooms)
        self._queue: asyncio.Queue[
            tuple[
                tuple[RoomRunOutcome, CleaningRoom | None] | BaseException,
                asyncio.Event | None,
            ]
        ] = asyncio.Queue(maxsize=max(4, len(self._rooms) * 2 + 2))
        self._active_room = initial_room
        self._observed_any = initial_observed
        self._terminal_pending = False
        self._suppress_pause = suppress_pause or initial_suspended
        self._pause_open = self._suppress_pause
        # One runner suspension write owns an entire native pause episode.
        # In particular, a low-charge RETURNING update may follow PAUSED
        # before the target room reports CLEANING; it must not enqueue a
        # second outcome carrying the same resume event.
        self._pause_episode_handled = self._suppress_pause
        self.resume_event = asyncio.Event()
        self._active_pause_resume_event = (
            self.resume_event if self._pause_open else None
        )
        self._suppress_initial_suspend_state = initial_suspended
        self._overflowed = False
        self._fault: BaseException | None = None
        self._closed = False
        self._remove_listener = async_track_state_change_event(
            hass, entity_id, self._state_changed
        )
        if classify_current:
            self._classify(hass.states.get(entity_id))

    @callback
    def _state_changed(self, event: Event[EventStateChangedData]) -> None:
        self._classify(event.data["new_state"])

    def _enqueue(
        self,
        outcome: tuple[RoomRunOutcome, CleaningRoom | None] | BaseException,
        resume_event: asyncio.Event | None = None,
    ) -> None:
        if self._closed or self._overflowed:
            return
        try:
            self._queue.put_nowait((outcome, resume_event))
        except asyncio.QueueFull:
            # Losing one of the finite physical room transitions would make
            # both the active-room display and Finish current room ambiguous.
            self._overflowed = True

    def _classify(self, state: Any) -> None:
        if self._closed or self._fault is not None or state is None:
            return
        if state.state in {"cleaning", "paused"}:
            current_area = state.attributes.get("current_area")
            matched = next(
                (
                    room
                    for room in self._rooms
                    if _area_matches_room(current_area, room)
                ),
                None,
            )
            if matched is not None:
                self._observed_any = True
                if (
                    matched.room_id != self._active_room.room_id
                    and state.state == "cleaning"
                ):
                    self._active_room = matched
                    self._enqueue((RoomRunOutcome.ROOM_CHANGED, matched))
        if state.state == "cleaning" and matched is None:
            # Raw activity is not evidence that this leg resumed. Keep the
            # current pause episode open until a target-room state arrives.
            return
        if state.state == "paused":
            self._terminal_pending = False
            if not self._pause_open:
                self._pause_open = True
                self._active_pause_resume_event = asyncio.Event()
            if not self._suppress_pause and not self._pause_episode_handled:
                self._pause_episode_handled = True
                self._enqueue(
                    (RoomRunOutcome.PAUSED, None),
                    self._active_pause_resume_event,
                )
            return
        if state.state == "cleaning":
            self._terminal_pending = False
            if self._pause_open:
                if self._active_pause_resume_event is not None:
                    self._active_pause_resume_event.set()
                self._suppress_pause = False
                self._pause_open = False
            self._pause_episode_handled = False
            self._suppress_initial_suspend_state = False
            return
        if state.state == "error":
            self._terminal_pending = True
            self._fault = _validation_error(
                "The selected Matic robot reported an error", "robot_error"
            )
            # A verified robot fault supersedes queued ordinary outcomes and
            # queue overflow. Preserve one authoritative first fault.
            while not self._queue.empty():
                self._queue.get_nowait()
            self._overflowed = False
            self._queue.put_nowait((self._fault, None))
        elif state.state == "returning":
            if not self._terminal_pending:
                self._terminal_pending = True
                low_charge = state.attributes.get("low_charge") is True
                if self._suppress_initial_suspend_state:
                    self._suppress_initial_suspend_state = False
                    if low_charge:
                        return
                if low_charge:
                    if not self._pause_open:
                        self._pause_open = True
                        self._active_pause_resume_event = asyncio.Event()
                if not low_charge or not self._pause_episode_handled:
                    if low_charge:
                        self._pause_episode_handled = True
                    self._enqueue(
                        (
                            RoomRunOutcome.SUSPENDED
                            if low_charge
                            else (
                                RoomRunOutcome.HANDOFF_CANDIDATE
                                if self._observed_any
                                else RoomRunOutcome.INTERRUPTED
                            ),
                            None,
                        ),
                        self._active_pause_resume_event if low_charge else None,
                    )
        elif state.state == "idle":
            if not self._terminal_pending:
                self._terminal_pending = True
                self._enqueue((RoomRunOutcome.STOPPED_IN_PLACE, None))
        elif state.state == "docked" and not self._terminal_pending:
            self._terminal_pending = True
            if self._suppress_initial_suspend_state:
                self._suppress_initial_suspend_state = False
                return
            self._enqueue(
                (
                    RoomRunOutcome.HANDOFF_CANDIDATE
                    if self._observed_any
                    else RoomRunOutcome.INTERRUPTED,
                    None,
                )
            )

    def resume_after_initial_pause(self) -> None:
        self._suppress_pause = False

    async def next(
        self, cancel_event: asyncio.Event | None = None
    ) -> tuple[RoomRunOutcome, CleaningRoom | None]:
        if cancel_event is not None and cancel_event.is_set():
            raise PlanCancelledError
        item: tuple[
            tuple[RoomRunOutcome, CleaningRoom | None] | BaseException,
            asyncio.Event | None,
        ]
        if self._fault is not None:
            raise self._fault
        if self._overflowed:
            raise RoomInterruptedError(
                "Room observations exceeded the bounded leg queue"
            )
        if cancel_event is None:
            item = await self._queue.get()
        else:
            observation = asyncio.create_task(self._queue.get())
            cancelled = asyncio.create_task(cancel_event.wait())
            try:
                done, _pending = await asyncio.wait(
                    {observation, cancelled},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if cancelled in done and cancelled.result():
                    raise PlanCancelledError
                item = observation.result()
            finally:
                observation.cancel()
                cancelled.cancel()
                await asyncio.gather(observation, cancelled, return_exceptions=True)
            if cancel_event.is_set():
                raise PlanCancelledError
        if self._fault is not None:
            item = (self._fault, None)
        outcome, resume_event = item
        if isinstance(outcome, BaseException):
            raise outcome
        if (
            outcome[0] in {RoomRunOutcome.PAUSED, RoomRunOutcome.SUSPENDED}
            and resume_event is not None
        ):
            self.resume_event = resume_event
        return outcome

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._remove_listener()


async def _async_wait_for_leg_outcome(
    hass: HomeAssistant,
    entity_id: str,
    rooms: Sequence[CleaningRoom],
    active_room: CleaningRoom,
    cancel_event: asyncio.Event | None = None,
    *,
    initial_observed: bool = False,
) -> tuple[RoomRunOutcome, CleaningRoom | None]:
    """One-shot lifecycle adapter over the shared leg outcome observer."""
    observer = _LegOutcomeObserver(
        hass,
        entity_id,
        rooms,
        active_room,
        initial_observed=initial_observed,
    )
    try:
        return await observer.next(cancel_event)
    finally:
        observer.close()


async def _async_active_session_state(
    reader: Callable[[], Awaitable[bool | None]] | None,
) -> bool | None:
    """Resolve active-task presence with a small bounded unknown retry window."""
    if reader is None:
        return None
    for attempt in range(ACTIVE_SESSION_UNKNOWN_ATTEMPTS):
        try:
            state = await reader()
        except MaticError as err:
            _LOGGER.debug(
                "Native Matic active-session state unavailable (%s)",
                type(err).__name__,
            )
            state = None
        if state is not None:
            return state
        if attempt + 1 < ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
            await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
    return None


async def _async_session_history_baseline(
    reader: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
) -> frozenset[bytes] | None:
    """Capture opaque native keys before dispatch without exposing their values."""
    if reader is None:
        return None
    try:
        return frozenset(record.key for record in await reader())
    except MaticError as err:
        _LOGGER.debug(
            "Native Matic completion baseline unavailable (%s)", type(err).__name__
        )
        return None


async def _async_verify_room_completion(
    reader: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
    baseline: frozenset[bytes] | None,
    room: CleaningRoom,
    dispatched_at: datetime,
    *,
    hass: HomeAssistant | None = None,
    entity_id: str | None = None,
    cancel_event: asyncio.Event | None = None,
    attempts: int = SESSION_HISTORY_ATTEMPTS,
    allow_active_cleaning: bool = False,
    on_verified_session: Callable[[str], None] | None = None,
) -> bool:
    """Require one new, completed, overlapping native single-room record."""
    if reader is None or baseline is None:
        return False
    try:
        async with asyncio.timeout(SESSION_HISTORY_TIMEOUT_SECONDS):
            for attempt in range(attempts):
                _raise_if_completion_verification_was_replaced(
                    hass,
                    entity_id,
                    cancel_event,
                    allow_active_cleaning=allow_active_cleaning,
                )
                try:
                    records = await reader()
                except MaticError as err:
                    _LOGGER.debug(
                        "Native Matic completion evidence unavailable (%s)",
                        type(err).__name__,
                    )
                    records = ()
                _raise_if_completion_verification_was_replaced(
                    hass,
                    entity_id,
                    cancel_event,
                    allow_active_cleaning=allow_active_cleaning,
                )
                now = dt_util.utcnow()
                matches = match_single_room_completions(
                    records,
                    baseline=baseline,
                    room_name=room.name,
                    cleaning_mode=room.cleaning_mode,
                    dispatched_at=dispatched_at,
                    now=now,
                )
                if len(matches) == 1:
                    if on_verified_session is not None:
                        if session_hash := native_session_hash(matches[0].record.key):
                            on_verified_session(session_hash)
                    return True
                if len(matches) > 1:
                    return False
                if attempt + 1 < attempts:
                    if cancel_event is None:
                        await asyncio.sleep(SESSION_HISTORY_RETRY_SECONDS)
                    else:
                        try:
                            async with asyncio.timeout(SESSION_HISTORY_RETRY_SECONDS):
                                await cancel_event.wait()
                        except TimeoutError:
                            continue
                        raise PlanCancelledError
    except TimeoutError:
        return False
    return False


def _raise_if_completion_verification_was_replaced(
    hass: HomeAssistant | None,
    entity_id: str | None,
    cancel_event: asyncio.Event | None,
    *,
    allow_active_cleaning: bool = False,
) -> None:
    """Abort history verification if cancellation or a new task takes over."""
    if cancel_event is not None and cancel_event.is_set():
        raise PlanCancelledError
    if hass is None or entity_id is None:
        return
    state = hass.states.get(entity_id)
    if (
        not allow_active_cleaning
        and state is not None
        and state.state in {"cleaning", "paused"}
    ):
        raise RoomTakenOverError(
            "Another cleaning task started while completion was being verified"
        )


async def _async_wait_for_active_session_resolution(
    hass: HomeAssistant,
    entity_id: str,
    reader: Callable[[], Awaitable[bool | None]] | None,
    cancel_event: asyncio.Event | None = None,
    *,
    identity_reader: Callable[[], Awaitable[bytes | None]] | None = None,
    expected_identity: bytes | None = None,
) -> bool | None:
    """Wait for a returning task to finish or visibly resume.

    ``False`` means the firmware session ended and operational handoff is safe;
    it does not prove completion. ``True`` means cleaning resumed, and ``None``
    means repeated direct reads could not establish session ownership. The
    enclosing room timeout bounds the wait while known-active firmware sessions
    return to their dock.
    """
    if reader is None and identity_reader is None:
        return None
    unknown_reads = 0
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise PlanCancelledError
        observed_state = hass.states.get(entity_id)
        identity = await _async_read_session_identity(identity_reader)
        state = hass.states.get(entity_id)
        if identity_reader is not None:
            if identity == b"" and state is observed_state:
                return False
            if identity and identity != expected_identity:
                raise RoomTakenOverError("The returning native task was replaced")
        if state is not None:
            if state.state == "error":
                raise _validation_error(
                    "The selected Matic robot reported an error", "robot_error"
                )
            if state.state == "cleaning" and (
                identity_reader is None or (identity and state is observed_state)
            ):
                return True
        try:
            if identity_reader is not None:
                session_active = True if identity is not None else None
            else:
                assert reader is not None
                session_active = await reader()
        except MaticError as err:
            _LOGGER.debug(
                "Native Matic active-session resolution unavailable (%s)",
                type(err).__name__,
            )
            session_active = None
        if session_active is False:
            return False
        if session_active is None:
            unknown_reads += 1
            if unknown_reads >= ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
                if identity_reader is not None:
                    raise RoomTakenOverError(
                        "The returning native task ownership could not be verified"
                    )
                return None
        else:
            unknown_reads = 0
        if cancel_event is None:
            await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
            continue
        try:
            async with asyncio.timeout(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS):
                await cancel_event.wait()
        except TimeoutError:
            continue
        raise PlanCancelledError


async def _async_wait_for_settled_leg_handoff(
    hass: HomeAssistant,
    entity_id: str,
    cancel_event: asyncio.Event | None,
    *,
    refresh: Callable[[], Awaitable[None]] | None = None,
    active_session: Callable[[], Awaitable[bool | None]] | None = None,
    identity_reader: Callable[[], Awaitable[bytes | None]] | None = None,
    expected_identity: bytes | None = None,
    reject_new_identity: bool = False,
    timeout_seconds: float = LEG_HANDOFF_TIMEOUT_SECONDS,
    finish_room_event: asyncio.Event | None = None,
) -> bool:
    """Wait until a completed leg can safely hand off to new settings.

    A native completion record only proves that the prior mission ended; the
    vacuum may still be returning and its session identity may remain visible
    for a short period. Dispatching the next settings leg in that window is
    rejected by firmware and the generic failure cleanup sends STOP, which
    starts the long OEM stop countdown. A stable idle state is sufficient for
    continuation (the dock is not a required boundary), while an unknown or
    still-active native identity is deliberately held until it clears.

    ``False`` is a bounded timeout or graceful stop, not a command failure. The caller
    leaves the remaining legs unattempted and lets normal terminal accounting
    describe the run without issuing a second STOP.
    """
    deadline = monotonic() + max(0.0, timeout_seconds)
    settled_states = {"docked", "charging", "idle"}
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise PlanCancelledError
        if finish_room_event is not None and finish_room_event.is_set():
            return False
        if refresh is not None:
            try:
                await refresh()
            except (MaticError, HomeAssistantError) as err:
                _LOGGER.debug(
                    "Matic leg handoff refresh unavailable (%s)",
                    type(err).__name__,
                )
        state = hass.states.get(entity_id)
        if state is not None and state.state == "error":
            raise _validation_error(
                "The selected Matic robot reported an error", "robot_error"
            )
        identity = await _async_read_session_identity(identity_reader)
        session_active: bool | None = None
        if active_session is not None:
            try:
                session_active = await active_session()
            except MaticError as err:
                _LOGGER.debug(
                    "Native Matic handoff session read unavailable (%s)",
                    type(err).__name__,
                )
        if identity and (
            reject_new_identity
            or (expected_identity is not None and identity != expected_identity)
        ):
            raise RoomTakenOverError("The returning native task was replaced")
        if (
            state is not None
            and state.state in settled_states
            and (identity_reader is None or identity == b"")
        ):
            return True
        # A blocked doorway can leave the firmware in its homeward/idle state
        # while retaining the completed mission identity for a short period.
        # An explicit inactive-session read is the stronger evidence boundary:
        # no native mission remains to collide with the next settings leg, so
        # do not abandon the remaining queue waiting for a stale identity to
        # clear.
        if (
            active_session is not None
            and session_active is False
            and state is not None
            and state.state in {"returning", "docked", "charging", "idle"}
        ):
            return True
        if monotonic() >= deadline:
            _LOGGER.warning(
                "Matic leg handoff did not settle before the bounded timeout"
            )
            return False
        events = [
            event for event in (cancel_event, finish_room_event) if event is not None
        ]
        if not events:
            await asyncio.sleep(LEG_HANDOFF_POLL_SECONDS)
            continue
        waiters = [asyncio.create_task(event.wait()) for event in events]
        try:
            await asyncio.wait(
                waiters,
                timeout=LEG_HANDOFF_POLL_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            for waiter in waiters:
                waiter.cancel()
            await asyncio.gather(*waiters, return_exceptions=True)


def _area_matches_room(value: object, room: CleaningRoom) -> bool:
    """Match decoded current/previous area text to the commanded room."""
    if not isinstance(value, str):
        return False
    normalized = native_room_key(value)
    return normalized in {native_room_key(room.room_id), native_room_key(room.name)}


async def _async_periodic_refresh(
    refresh: Callable[[], Awaitable[None]],
) -> None:
    """Poll operational state quickly enough to intercept a return to dock."""
    while True:
        await asyncio.sleep(ROOM_STATUS_REFRESH_SECONDS)
        await refresh()


async def _async_read_session_identity(
    reader: Callable[[], Awaitable[bytes | None]] | None,
) -> bytes | None:
    """Read an opaque identity without logging its value on transport failure."""
    if reader is None:
        return None
    try:
        return await reader()
    except Exception as err:
        _LOGGER.debug(
            "Matic session identity read unavailable (%s)", type(err).__name__
        )
        return None


async def _async_wait_with_native_identity[T](
    outcome: Callable[[], Awaitable[T]],
    reader: Callable[[], Awaitable[bytes | None]] | None,
    expected: bytes | None,
) -> T:
    """Notice replacement even when the OEM task keeps cleaning the same room."""
    if reader is None:
        return await outcome()

    async def wait_for_outcome() -> T:
        return await outcome()

    changed = asyncio.create_task(wait_for_outcome(), eager_start=True)
    unknown_reads = 0
    try:
        while True:
            transition_observed = changed.done()
            if transition_observed:
                changed.result()
            identity = await _async_read_session_identity(reader)
            if identity is None:
                unknown_reads += 1
                if unknown_reads >= ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
                    raise RoomTakenOverError(
                        "The native task ownership could not be verified"
                    )
            elif identity and identity != expected:
                raise RoomTakenOverError("The native cleaning task was replaced")
            else:
                # An ended session can precede HA's normal return update;
                # its history still needs independent completion verification.
                unknown_reads = 0
                if transition_observed:
                    return changed.result()
            if changed.done():
                changed.result()
                await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
            else:
                await asyncio.wait(
                    {changed}, timeout=ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS
                )
    finally:
        changed.cancel()
        await asyncio.gather(changed, return_exceptions=True)


async def _async_wait_for_owned_start(
    hass: HomeAssistant,
    entity_id: str,
    timeout_seconds: int,
    cancel_event: asyncio.Event | None,
    rooms: CleaningRoom | Sequence[CleaningRoom] | None,
    reader: Callable[[], Awaitable[bytes | None]] | None,
    bind_identity: Callable[[bytes | None], None],
    identity_baseline: bytes | None,
    expected: bytes | None,
    *,
    already_accepted: bool = False,
) -> str:
    """Bind the dispatched task even while HA's activity/room update lags.

    Publish ownership before the state waiter can fail, so timeout or unload
    cleanup can stop the same accepted task. Never replace that identity with
    a later OEM task. A successful HA state also needs a current native read.
    """
    if already_accepted:
        # Recovery has already verified the accepted mission twice. Requiring
        # another cleaning transition can misclassify a normal finish in the
        # handoff window. Join ongoing identity/outcome monitoring instead:
        # empty identity permits native-history verification, while replacement,
        # unknown ownership, and an in-place stop still fail closed there.
        current = hass.states.get(entity_id)
        return (
            "paused"
            if current is not None and current.state == "paused"
            else "cleaning"
        )
    if reader is None:
        return await _async_wait_for_vacuum_state(
            hass,
            entity_id,
            {"cleaning", "paused"},
            timeout_seconds,
            cancel_event,
            rooms,
        )
    started = asyncio.create_task(
        _async_wait_for_vacuum_state(
            hass,
            entity_id,
            {"cleaning", "paused"},
            timeout_seconds,
            cancel_event,
            rooms,
        ),
        eager_start=True,
    )
    try:
        async with asyncio.timeout(timeout_seconds):
            return await _async_confirm_started_identity(
                started,
                reader,
                bind_identity,
                identity_baseline,
                expected,
                cancel_event,
            )
    finally:
        started.cancel()
        await asyncio.gather(started, return_exceptions=True)


async def _async_confirm_started_identity(
    started: asyncio.Task[str],
    reader: Callable[[], Awaitable[bytes | None]],
    bind_identity: Callable[[bytes | None], None],
    identity_baseline: bytes | None,
    expected: bytes | None,
    cancel_event: asyncio.Event | None,
) -> str:
    """Wait for a new identity, never the task that preceded dispatch."""
    unknown_reads = 0
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise PlanCancelledError
        transition_observed = started.done()
        identity = await _async_read_session_identity(reader)
        if identity and identity != identity_baseline and expected is None:
            expected = identity
            bind_identity(identity)
        elif identity is not None and expected and identity != expected:
            raise RoomTakenOverError("The dispatched native task ended or was replaced")
        if started.done():
            state = started.result()
            if transition_observed and identity and identity == expected:
                return state
            unknown_reads = unknown_reads + 1 if identity is None else 0
            if unknown_reads >= ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
                raise RoomTakenOverError(
                    "The started native task could not be identified"
                )
            await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
        else:
            await asyncio.wait({started}, timeout=ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)


async def _async_wait_for_owned_resume(
    hass: HomeAssistant,
    entity_id: str,
    timeout_seconds: float,
    cancel_event: asyncio.Event | None,
    rooms: CleaningRoom | Sequence[CleaningRoom],
    reader: Callable[[], Awaitable[bytes | None]] | None,
    expected: bytes | None,
    *,
    resume_event: asyncio.Event | None = None,
) -> None:
    """Resume only the original native mission, including while docked.

    A cleared session is terminal even when the last room state said low
    charge. A new OEM task can clean the same room, so room/activity alone
    cannot prove resumption. Unknown ownership is bounded and fails without
    STOP or completion credit: cleanup must not cancel an independent task.
    """
    if reader is None or not expected:
        raise RoomTakenOverError("The suspended native task could not be identified")
    resumed = asyncio.create_task(
        _async_wait_for_vacuum_state(
            hass, entity_id, {"cleaning"}, timeout_seconds, cancel_event, rooms
        )
    )
    observed_resume = (
        asyncio.create_task(resume_event.wait()) if resume_event is not None else None
    )
    unknown_reads = 0
    try:
        async with asyncio.timeout(timeout_seconds):
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise PlanCancelledError
                transition_observed = resumed.done() or (
                    observed_resume is not None and observed_resume.done()
                )
                identity = await _async_read_session_identity(reader)
                if identity is None:
                    unknown_reads += 1
                    if unknown_reads >= ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
                        raise RoomTakenOverError(
                            "The suspended native task ownership could not be verified"
                        )
                elif identity != expected:
                    raise RoomTakenOverError(
                        "The suspended native task ended or was replaced"
                    )
                else:
                    unknown_reads = 0
                    if transition_observed:
                        # The identity read began after the observed resume.
                        # Propagate errors/cancellation before recording it.
                        if resumed.done():
                            resumed.result()
                        return
                # Check again after the state transition, and keep checking
                # session continuity during a potentially long charge interval.
                if resumed.done():
                    resumed.result()
                    await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
                else:
                    waiters: set[asyncio.Task[Any]] = {resumed}
                    if observed_resume is not None:
                        waiters.add(observed_resume)
                    await asyncio.wait(
                        waiters, timeout=ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS
                    )
    finally:
        resumed.cancel()
        tasks: list[asyncio.Task[Any]] = [resumed]
        if observed_resume is not None:
            observed_resume.cancel()
            tasks.append(observed_resume)
        await asyncio.gather(*tasks, return_exceptions=True)


async def _async_wait_for_vacuum_state(
    hass: HomeAssistant,
    entity_id: str,
    desired: set[str],
    timeout_seconds: float,
    cancel_event: asyncio.Event | None = None,
    room: CleaningRoom | Sequence[CleaningRoom] | None = None,
) -> str:
    """Wait for an expected state and optional target-room confirmation.

    A coordinator refresh can make an entity briefly unavailable even after the
    robot accepted a command.  Keep waiting through that transport condition;
    the enclosing timeout remains the hard limit.  The vacuum ``error`` state,
    by contrast, comes from verified robot error codes and is terminal.  When a
    room is supplied, a lingering state from a prior task is not accepted until
    ``current_area`` identifies the commanded room.
    """

    room_list: tuple[CleaningRoom, ...] | None = None
    if room is not None:
        room_list = (room,) if isinstance(room, CleaningRoom) else tuple(room)

    def desired_state(state: Any) -> bool:
        return state.state in desired and (
            room_list is None
            or any(
                _area_matches_room(state.attributes.get("current_area"), candidate)
                for candidate in room_list
            )
        )

    failed = {"error"}
    if (state := hass.states.get(entity_id)) is not None:
        if state.state in failed:
            raise _validation_error(
                "The selected Matic robot reported an error",
                "robot_error",
            )
        if desired_state(state):
            return state.state

    future: asyncio.Future[str] = hass.loop.create_future()

    @callback
    def state_changed(event: Event[EventStateChangedData]) -> None:
        new_state = event.data["new_state"]
        if new_state is None or future.done():
            return
        if new_state.state in failed:
            future.set_exception(
                _validation_error(
                    "The selected Matic robot reported an error",
                    "robot_error",
                )
            )
        elif desired_state(new_state):
            future.set_result(new_state.state)

    remove_listener = async_track_state_change_event(hass, entity_id, state_changed)
    cancel_wait: asyncio.Task[bool] | None = None
    try:
        async with asyncio.timeout(timeout_seconds):
            if cancel_event is None:
                return await future
            cancel_wait = asyncio.create_task(cancel_event.wait())
            waiters: set[asyncio.Future[Any]] = {future, cancel_wait}
            done, _pending = await asyncio.wait(
                waiters, return_when=asyncio.FIRST_COMPLETED
            )
            if cancel_wait in done and cancel_wait.result():
                if not future.done():
                    future.cancel()
                raise PlanCancelledError
            cancel_wait.cancel()
            return future.result()
    finally:
        if cancel_wait is not None:
            cancel_wait.cancel()
        remove_listener()
