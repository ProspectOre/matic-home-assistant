"""Bounded robot observations and native session ownership waits."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Collection, Sequence
from datetime import datetime
from enum import StrEnum
from time import monotonic
from typing import Any

from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .client import (
    CleaningSessionRecord,
    MaticError,
    RobotActivity,
    RobotOperationalState,
    native_session_hash,
)
from .managed_run import (
    NativeTaskEndedError,
    PlanCancelledError,
    ReconnectWindow,
    RoomInterruptedError,
    RoomRunOutcome,
    RoomTakenOverError,
    async_unless_cancelled,
    validation_error,
)
from .native_completion import (
    RobotEnded,
    has_cancelled_single_room_record,
    leg_room_results,
    match_single_room_completions,
    match_single_room_robot_ended,
    native_room_key,
    records_for_dispatch,
    session_overlaps_dispatch,
)
from .native_history import OEM_STOP_RECONCILIATION_SECONDS
from .plan_model import CleaningRoom
from .robot_port import RobotPort, SessionHistory

_LOGGER = logging.getLogger(__name__)

ROOM_STATUS_REFRESH_SECONDS = 5

ACTIVE_SESSION_UNKNOWN_ATTEMPTS = 3

ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS = 1

SESSION_HISTORY_ATTEMPTS = 151

SESSION_HISTORY_RETRY_SECONDS = 2

SESSION_HISTORY_TIMEOUT_SECONDS = 300

LEG_HANDOFF_POLL_SECONDS = ROOM_STATUS_REFRESH_SECONDS

LEG_HANDOFF_TIMEOUT_SECONDS = OEM_STOP_RECONCILIATION_SECONDS

# The robot is on its dock, charging or not.
HOME = frozenset({RobotActivity.DOCKED, RobotActivity.CHARGING})


async def async_verify_leg_completion(
    reader: SessionHistory,
    baseline: frozenset[bytes] | None,
    rooms: Sequence[CleaningRoom],
    dispatched_at: datetime,
    *,
    robot: RobotPort,
    cancel_event: asyncio.Event | None = None,
    attempts: int | None = None,
    allow_active_cleaning: bool = False,
    timeout_seconds: float | None = None,
    on_verified_session: Callable[[str], None] | None = None,
    skipped_room_ids: Collection[str] = (),
    on_robot_ended: Callable[[dict[str, RobotEnded]], None] | None = None,
    session_hash: str | None = None,
) -> dict[str, tuple[str, int]] | None:
    """Match one new native leg record and return per-room completion evidence.

    The returned mapping holds ``room_id -> (ended_at, duration_seconds)`` for every
    leg room the record marks completed with a positive duration; ``on_robot_ended``
    gets the rooms the robot could not reach or finish. A missing or ambiguous
    record returns ``None`` and credits nothing. With ``session_hash`` only the
    mission's own record counts.
    """
    if baseline is None and session_hash is None:
        return None
    attempts = SESSION_HISTORY_ATTEMPTS if attempts is None else attempts
    targets = {room.name.strip().casefold(): room.room_id for room in rooms}
    required_room_ids = set(targets.values()) - set(skipped_room_ids)
    evidence: dict[str, tuple[str, int]] | None = None
    robot_ended: dict[str, RobotEnded] = {}
    matched_key: bytes | None = None
    try:
        async with asyncio.timeout(
            SESSION_HISTORY_TIMEOUT_SECONDS
            if timeout_seconds is None
            else timeout_seconds
        ):
            for attempt in range(attempts):
                _raise_if_completion_verification_was_replaced(
                    robot,
                    cancel_event,
                    allow_active_cleaning=allow_active_cleaning,
                )
                try:
                    records = await async_unless_cancelled(
                        reader(session_hash=session_hash), cancel_event
                    )
                except MaticError as err:
                    _LOGGER.debug(
                        "Native Matic leg evidence unavailable (%s)", type(err).__name__
                    )
                    records = ()
                _raise_if_completion_verification_was_replaced(
                    robot,
                    cancel_event,
                    allow_active_cleaning=allow_active_cleaning,
                )
                now = dt_util.utcnow()
                matches: list[CleaningSessionRecord] = []
                candidates = records_for_dispatch(records, baseline, session_hash)
                if not candidates and (candidates is None or session_hash):
                    # An unreadable new record, or no owned one yet, drops
                    # earlier evidence: the rooms stay unverified and due.
                    evidence = None
                for record in candidates or ():
                    session = record.session
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
                    evidence, robot_ended = leg_room_results(
                        matches[0].session, rooms, required_room_ids
                    )
                    # History can publish timestamps before per-room results: poll the
                    # same record until complete or timed out, never mixing sessions.
                    if evidence.keys() | robot_ended.keys() == required_room_ids:
                        break
                if len(matches) > 1:
                    return None
                if attempt + 1 < attempts:
                    await async_unless_cancelled(
                        asyncio.sleep(SESSION_HISTORY_RETRY_SECONDS), cancel_event
                    )
    except TimeoutError:
        pass
    if evidence is not None and on_robot_ended is not None:
        on_robot_ended(robot_ended)
    if evidence and matched_key is not None and on_verified_session is not None:
        if session_hash := native_session_hash(matched_key):
            on_verified_session(session_hash)
    return evidence


async def async_wait_for_room_outcome(
    robot: RobotPort,
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
        robot,
        [room],
        room,
        cancel_event,
        initial_observed=initial_observed,
    )
    return outcome


class LegOutcomeObserver:
    """Own ordered, bounded observations for one multi-room native leg."""

    def __init__(
        self,
        robot: RobotPort,
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
        self._robot = robot
        self._remove_listener = robot.subscribe(self._state_changed)
        if classify_current:
            self._classify(robot.observed())

    @callback
    def _state_changed(self) -> None:
        self._classify(self._robot.observed())

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

    def _classify(self, state: RobotOperationalState | None) -> None:
        if self._closed or self._fault is not None or state is None:
            return
        activity = state.activity
        if activity in {RobotActivity.CLEANING, RobotActivity.PAUSED}:
            current_area = state.current_area
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
                    and activity is RobotActivity.CLEANING
                ):
                    self._active_room = matched
                    self._enqueue((RoomRunOutcome.ROOM_CHANGED, matched))
        if activity is RobotActivity.CLEANING and matched is None:
            # Raw activity is not evidence that this leg resumed. Keep the
            # current pause episode open until a target-room state arrives.
            return
        if activity is RobotActivity.PAUSED:
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
        if activity is RobotActivity.CLEANING:
            self._terminal_pending = False
            if self._pause_open:
                if self._active_pause_resume_event is not None:
                    self._active_pause_resume_event.set()
                self._suppress_pause = False
                self._pause_open = False
            self._pause_episode_handled = False
            self._suppress_initial_suspend_state = False
            return
        if activity is RobotActivity.ERROR:
            self._terminal_pending = True
            self._fault = validation_error(
                "The selected Matic robot reported an error", "robot_error"
            )
            # A verified robot fault supersedes queued ordinary outcomes and
            # queue overflow. Preserve one authoritative first fault.
            while not self._queue.empty():
                self._queue.get_nowait()
            self._overflowed = False
            self._queue.put_nowait((self._fault, None))
        elif activity is RobotActivity.RETURNING:
            if not self._terminal_pending:
                self._terminal_pending = True
                low_charge = state.low_charge
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
        elif activity is RobotActivity.READY:
            if not self._terminal_pending:
                self._terminal_pending = True
                self._enqueue((RoomRunOutcome.STOPPED_IN_PLACE, None))
        elif activity in HOME and not self._terminal_pending:
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
    robot: RobotPort,
    rooms: Sequence[CleaningRoom],
    active_room: CleaningRoom,
    cancel_event: asyncio.Event | None = None,
    *,
    initial_observed: bool = False,
) -> tuple[RoomRunOutcome, CleaningRoom | None]:
    """One-shot lifecycle adapter over the shared leg outcome observer."""
    observer = LegOutcomeObserver(
        robot,
        rooms,
        active_room,
        initial_observed=initial_observed,
    )
    try:
        return await observer.next(cancel_event)
    finally:
        observer.close()


async def async_active_session_state(
    reader: Callable[[], Awaitable[bool | None]],
) -> bool | None:
    """Resolve active-task presence with a small bounded unknown retry window."""
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


class NativeRoomVerdict(StrEnum):
    """What history proves of an owned one-room mission, besides ``RobotEnded``."""

    COMPLETED = "completed"
    UNVERIFIED = "unverified"


async def async_adjudicate_room_end(
    reader: SessionHistory,
    baseline: frozenset[bytes] | None,
    room: CleaningRoom,
    dispatched_at: datetime,
    *,
    robot: RobotPort,
    cancel_event: asyncio.Event | None = None,
    attempts: int | None = None,
    allow_active_cleaning: bool = False,
    on_verified_session: Callable[[str], None] | None = None,
    on_verified_completion: Callable[[str, int], None] | None = None,
    session_hash: str | None = None,
) -> NativeRoomVerdict | RobotEnded:
    """Settle an ended single-room mission from one new native record.

    Completion needs one new, completed, overlapping record for the room; an
    unreachable or partly cleaned room needs one the robot finished short of it.
    Anything else, including ambiguity, earns no verdict. With ``session_hash``
    only the mission's own record counts.
    """
    if baseline is None and session_hash is None:
        return NativeRoomVerdict.UNVERIFIED
    attempts = SESSION_HISTORY_ATTEMPTS if attempts is None else attempts
    try:
        async with asyncio.timeout(SESSION_HISTORY_TIMEOUT_SECONDS):
            for attempt in range(attempts):
                _raise_if_completion_verification_was_replaced(
                    robot,
                    cancel_event,
                    allow_active_cleaning=allow_active_cleaning,
                )
                try:
                    records = await async_unless_cancelled(
                        reader(session_hash=session_hash), cancel_event
                    )
                except MaticError as err:
                    _LOGGER.debug(
                        "Native Matic completion evidence unavailable (%s)",
                        type(err).__name__,
                    )
                    records = ()
                _raise_if_completion_verification_was_replaced(
                    robot,
                    cancel_event,
                    allow_active_cleaning=allow_active_cleaning,
                )
                now = dt_util.utcnow()
                matches = match_single_room_completions(
                    records,
                    baseline=baseline,
                    session_hash=session_hash,
                    room_name=room.name,
                    cleaning_mode=room.cleaning_mode,
                    dispatched_at=dispatched_at,
                    now=now,
                )
                robot_ended = match_single_room_robot_ended(
                    records,
                    baseline=baseline,
                    session_hash=session_hash,
                    room_name=room.name,
                    cleaning_mode=room.cleaning_mode,
                    dispatched_at=dispatched_at,
                    now=now,
                )
                if len(matches) + len(robot_ended) > 1:
                    return NativeRoomVerdict.UNVERIFIED
                if matches:
                    if on_verified_completion is not None:
                        on_verified_completion(
                            matches[0].ended_at, matches[0].duration_seconds
                        )
                    if on_verified_session is not None:
                        if session_hash := native_session_hash(matches[0].record.key):
                            on_verified_session(session_hash)
                    return NativeRoomVerdict.COMPLETED
                if robot_ended:
                    return robot_ended[0][1]
                if has_cancelled_single_room_record(
                    records,
                    baseline=baseline,
                    session_hash=session_hash,
                    room_name=room.name,
                    dispatched_at=dispatched_at,
                    now=now,
                ):
                    return NativeRoomVerdict.UNVERIFIED
                if attempt + 1 < attempts:
                    await async_unless_cancelled(
                        asyncio.sleep(SESSION_HISTORY_RETRY_SECONDS), cancel_event
                    )
    except TimeoutError:
        return NativeRoomVerdict.UNVERIFIED
    return NativeRoomVerdict.UNVERIFIED


def _raise_if_completion_verification_was_replaced(
    robot: RobotPort,
    cancel_event: asyncio.Event | None,
    *,
    allow_active_cleaning: bool = False,
) -> None:
    """Abort history verification if cancellation or a new task takes over."""
    if cancel_event is not None and cancel_event.is_set():
        raise PlanCancelledError
    state = robot.observed()
    if (
        not allow_active_cleaning
        and state is not None
        and state.activity in {RobotActivity.CLEANING, RobotActivity.PAUSED}
    ):
        raise RoomTakenOverError(
            "Another cleaning task started while completion was being verified"
        )


async def async_wait_for_active_session_resolution(
    robot: RobotPort,
    cancel_event: asyncio.Event | None = None,
    *,
    expected_identity: bytes | None = None,
) -> bool:
    """Wait for a returning task to finish or visibly resume.

    ``False`` means the firmware session ended and operational handoff is safe;
    it does not prove completion. ``True`` means cleaning resumed. A robot
    that stops answering raises once the reconnect window passes. The
    enclosing room timeout bounds the wait while known-active firmware
    sessions return to their dock.
    """
    contact = ReconnectWindow()
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise PlanCancelledError
        observed_state = robot.observed()
        identity = await async_read_session_identity(robot.session_identity)
        state = robot.observed()
        if identity == b"" and state is observed_state:
            return False
        if identity and identity != expected_identity:
            raise RoomTakenOverError("The returning native task was replaced")
        if state is not None:
            if state.activity is RobotActivity.ERROR:
                raise validation_error(
                    "The selected Matic robot reported an error", "robot_error"
                )
            if (
                state.activity is RobotActivity.CLEANING
                and identity
                and state is observed_state
            ):
                return True
        contact.read(identity)
        if cancel_event is None:
            await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
            continue
        try:
            async with asyncio.timeout(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS):
                await cancel_event.wait()
        except TimeoutError:
            continue
        raise PlanCancelledError


async def async_wait_for_settled_leg_handoff(
    robot: RobotPort,
    cancel_event: asyncio.Event | None,
    *,
    expected_identity: bytes | None = None,
    reject_new_identity: bool = False,
    timeout_seconds: float = LEG_HANDOFF_TIMEOUT_SECONDS,
    finish_room_event: asyncio.Event | None = None,
) -> bool:
    """Wait until a completed leg can safely hand off to new settings.

    Firmware rejects a leg sent while the ended mission's identity is still
    visible, and the failure cleanup's STOP would start the OEM stop countdown.
    A stable idle state is enough; a still-active identity is held until it
    clears, and an unreadable one counts toward the reconnect window.

    ``False`` is a bounded timeout or graceful stop, not a command failure: the
    caller leaves the remaining legs unattempted without a second STOP.
    """
    deadline = monotonic() + max(0.0, timeout_seconds)
    settled = HOME | {RobotActivity.READY}
    contact = ReconnectWindow(sent=False)
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise PlanCancelledError
        if finish_room_event is not None and finish_room_event.is_set():
            return False
        try:
            await robot.refresh()
        except (MaticError, HomeAssistantError) as err:
            _LOGGER.debug(
                "Matic leg handoff refresh unavailable (%s)",
                type(err).__name__,
            )
        state = robot.observed()
        if state is not None and state.activity is RobotActivity.ERROR:
            raise validation_error(
                "The selected Matic robot reported an error", "robot_error"
            )
        identity = await async_read_session_identity(robot.session_identity)
        session_active: bool | None = None
        try:
            session_active = await robot.active_session()
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
        if state is not None and state.activity in settled and identity == b"":
            return True
        # A blocked doorway can keep the ended identity while the robot is
        # homeward or idle; an explicit inactive session is stronger evidence.
        if (
            session_active is False
            and state is not None
            and state.activity in settled | {RobotActivity.RETURNING}
        ):
            return True
        contact.read(identity)
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


async def async_periodic_refresh(
    refresh: Callable[[], Awaitable[None]],
) -> None:
    """Poll operational state quickly enough to intercept a return to dock."""
    while True:
        await asyncio.sleep(ROOM_STATUS_REFRESH_SECONDS)
        await refresh()


class NativeTaskSignal(StrEnum):
    """One reading of the robot's opaque active-session identity."""

    UNKNOWN = "unknown"  # The read failed; ownership is not known.
    ENDED = "ended"  # No native task is active.
    OWNED = "owned"  # The task this run dispatched is still active.
    REPLACED = "replaced"  # A different native task is active.


def _classify_native_identity(
    identity: bytes | None, expected: bytes | None
) -> NativeTaskSignal:
    """Read every identity observation by the same rule.

    An ended session is not a replacement: only a different, present identity
    proves another task took over. History decides what an ended task did.
    """
    if identity is None:
        return NativeTaskSignal.UNKNOWN
    if not identity:
        return NativeTaskSignal.ENDED
    if identity == expected:
        return NativeTaskSignal.OWNED
    return NativeTaskSignal.REPLACED


async def async_read_session_identity(
    reader: Callable[[], Awaitable[bytes | None]],
) -> bytes | None:
    """Read an opaque identity without logging its value on transport failure."""
    try:
        return await reader()
    except Exception as err:
        _LOGGER.debug(
            "Matic session identity read unavailable (%s)", type(err).__name__
        )
        return None


async def async_wait_with_native_identity[T](
    outcome: Callable[[], Awaitable[T]],
    reader: Callable[[], Awaitable[bytes | None]],
    expected: bytes | None,
    *,
    cancel_event: asyncio.Event | None,
) -> T:
    """Notice replacement even when the OEM task keeps cleaning the same room.

    ``cancel_event`` also ends the wait for a known identity after the outcome
    has settled, which can last the reconnect window.
    """

    async def wait_for_outcome() -> T:
        return await outcome()

    changed = asyncio.create_task(wait_for_outcome(), eager_start=True)
    contact = ReconnectWindow()
    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                raise PlanCancelledError
            transition_observed = changed.done()
            if transition_observed:
                changed.result()
            identity = await async_read_session_identity(reader)
            contact.read(identity)
            signal = _classify_native_identity(identity, expected)
            if signal is NativeTaskSignal.REPLACED:
                raise RoomTakenOverError("The native cleaning task was replaced")
            if signal is not NativeTaskSignal.UNKNOWN:
                # An ended session can precede HA's normal return update;
                # its history still needs independent completion verification.
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


async def async_wait_for_owned_start(
    robot: RobotPort,
    timeout_seconds: int,
    cancel_event: asyncio.Event | None,
    rooms: CleaningRoom | Sequence[CleaningRoom] | None,
    bind_identity: Callable[[bytes | None], None],
    identity_baseline: bytes | None,
    expected: bytes | None,
    *,
    already_accepted: bool = False,
) -> RobotActivity:
    """Bind the dispatched task even while the robot's room report lags.

    Publish ownership before the state waiter can fail, so timeout or unload
    cleanup can stop the same accepted task. Never replace that identity with
    a later OEM task. A started state also needs a current native read.
    """
    if already_accepted:
        # Recovery already verified this mission twice; the outcome wait that
        # follows still checks its identity.
        current = robot.observed()
        return (
            RobotActivity.PAUSED
            if current is not None and current.activity is RobotActivity.PAUSED
            else RobotActivity.CLEANING
        )
    started = asyncio.create_task(
        _async_wait_for_robot_activity(
            robot,
            {RobotActivity.CLEANING, RobotActivity.PAUSED},
            timeout_seconds,
            cancel_event,
            rooms,
        ),
        eager_start=True,
    )
    try:
        async with asyncio.timeout(timeout_seconds) as start_deadline:
            return await _async_confirm_started_identity(
                started,
                robot.session_identity,
                bind_identity,
                identity_baseline,
                expected,
                cancel_event,
                start_deadline,
            )
    finally:
        started.cancel()
        await asyncio.gather(started, return_exceptions=True)


async def _async_confirm_started_identity(
    started: asyncio.Task[RobotActivity],
    reader: Callable[[], Awaitable[bytes | None]],
    bind_identity: Callable[[bytes | None], None],
    identity_baseline: bytes | None,
    expected: bytes | None,
    cancel_event: asyncio.Event | None,
    start_deadline: asyncio.Timeout,
) -> RobotActivity:
    """Wait for a new identity, never the task that preceded dispatch.

    Once the robot reports starting, even mid-read, the start deadline is held
    until the robot answers; the reconnect window bounds a silent robot.
    """
    contact = ReconnectWindow()
    deadline = start_deadline.when()
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise PlanCancelledError
        transition_observed = started.done()
        read = asyncio.create_task(
            async_read_session_identity(reader), eager_start=True
        )
        try:
            if not (read.done() or started.done()):
                await asyncio.wait({read, started}, return_when=asyncio.FIRST_COMPLETED)
            if started.done():
                start_deadline.reschedule(None)
            identity = await read
        finally:
            read.cancel()
            await asyncio.gather(read, return_exceptions=True)
        if identity and identity != identity_baseline and expected is None:
            expected = identity
            bind_identity(identity)
        elif expected:
            signal = _classify_native_identity(identity, expected)
            if signal is NativeTaskSignal.REPLACED:
                raise RoomTakenOverError("The dispatched native task was replaced")
            if signal is NativeTaskSignal.ENDED:
                # The owned mission ended before the room started (unreachable).
                raise NativeTaskEndedError(
                    "The dispatched native task ended before the room started"
                )
        if started.done():
            state = started.result()
            if transition_observed and identity and identity == expected:
                return state
            contact.read(identity)
            start_deadline.reschedule(None if contact.waiting else deadline)
            await asyncio.sleep(ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
        else:
            await asyncio.wait({started}, timeout=ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)


async def async_wait_for_owned_resume(
    robot: RobotPort,
    timeout_seconds: float,
    cancel_event: asyncio.Event | None,
    rooms: CleaningRoom | Sequence[CleaningRoom],
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
    if not expected:
        raise RoomTakenOverError("The suspended native task could not be identified")
    resumed = asyncio.create_task(
        _async_wait_for_robot_activity(
            robot, {RobotActivity.CLEANING}, timeout_seconds, cancel_event, rooms
        )
    )
    observed_resume = (
        asyncio.create_task(resume_event.wait()) if resume_event is not None else None
    )
    contact = ReconnectWindow()
    try:
        async with asyncio.timeout(timeout_seconds):
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise PlanCancelledError
                transition_observed = resumed.done() or (
                    observed_resume is not None and observed_resume.done()
                )
                identity = await async_read_session_identity(robot.session_identity)
                contact.read(identity)
                signal = _classify_native_identity(identity, expected)
                if signal is NativeTaskSignal.REPLACED:
                    raise RoomTakenOverError("The suspended native task was replaced")
                if signal is NativeTaskSignal.ENDED:
                    raise NativeTaskEndedError(
                        "The suspended native task ended before it resumed"
                    )
                if signal is NativeTaskSignal.OWNED and transition_observed:
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


async def _async_wait_for_robot_activity(
    robot: RobotPort,
    desired: set[RobotActivity],
    timeout_seconds: float,
    cancel_event: asyncio.Event | None = None,
    room: CleaningRoom | Sequence[CleaningRoom] | None = None,
) -> RobotActivity:
    """Wait for an expected activity and optional target-room confirmation.

    A dropped connection can leave the robot briefly unreachable even after
    it accepted a command. Keep waiting through that transport condition; the
    enclosing timeout remains the hard limit. An error activity, by contrast,
    comes from verified robot error codes and is terminal. When a room is
    supplied, a lingering state from a prior task is not accepted until
    ``current_area`` identifies the commanded room.
    """

    room_list: tuple[CleaningRoom, ...] | None = None
    if room is not None:
        room_list = (room,) if isinstance(room, CleaningRoom) else tuple(room)

    def desired_state(state: RobotOperationalState) -> bool:
        return state.activity in desired and (
            room_list is None
            or any(
                _area_matches_room(state.current_area, candidate)
                for candidate in room_list
            )
        )

    if (state := robot.observed()) is not None:
        if state.activity is RobotActivity.ERROR:
            raise validation_error(
                "The selected Matic robot reported an error",
                "robot_error",
            )
        if desired_state(state):
            return state.activity

    future: asyncio.Future[RobotActivity] = asyncio.get_running_loop().create_future()

    @callback
    def state_changed() -> None:
        new_state = robot.observed()
        if new_state is None or future.done():
            return
        if new_state.activity is RobotActivity.ERROR:
            future.set_exception(
                validation_error(
                    "The selected Matic robot reported an error",
                    "robot_error",
                )
            )
        elif desired_state(new_state):
            future.set_result(new_state.activity)

    remove_listener = robot.subscribe(state_changed)
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
