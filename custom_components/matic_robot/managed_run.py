"""Managed execution values, completion budgets, and failure vocabulary."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from time import monotonic
from typing import ClassVar

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from .client import CoverageGuardError, CoverageGuardReason, MaticError
from .const import DOMAIN
from .plan_model import CleaningRoom

_COVERAGE_GUARD_MESSAGES = {
    CoverageGuardReason.IDENTITY_UNAVAILABLE: (
        "Home Assistant can't confirm the current clean, so check the robot first."
    ),
    CoverageGuardReason.ACTIVITY_UNAVAILABLE: (
        "Home Assistant can't confirm whether the robot is cleaning, so check it first."
    ),
    CoverageGuardReason.NATIVE_SESSION_ACTIVE: (
        "The robot is already cleaning, so wait for it to finish."
    ),
    CoverageGuardReason.IDENTITY_CHANGED: (
        "The clean changed while starting, so check the robot first."
    ),
}


# How long a run waits for the robot to answer again; restart recovery too.
RECONNECT_SECONDS = 120


def coverage_guard_message(error: CoverageGuardError) -> str:
    """Return the fixed recovery guidance for a refused coverage start."""
    return _COVERAGE_GUARD_MESSAGES[error.reason]


class RoomRunOutcome(StrEnum):
    """Conservative result of one managed, single-room command."""

    HANDOFF_CANDIDATE = "handoff_candidate"
    SUSPENDED = "suspended"
    PAUSED = "paused"
    INTERRUPTED = "interrupted"
    STOPPED_IN_PLACE = "stopped_in_place"
    ROOM_CHANGED = "room_changed"


@dataclass(frozen=True, slots=True)
class PreparedRoomDispatch:
    """A dispatched leg mission and the baselines its completion is judged by."""

    rooms: tuple[CleaningRoom, ...]
    history_baseline: frozenset[bytes] | None
    dispatched_at: datetime
    native_identity_baseline: bytes | None = None
    native_identity: bytes | None = None
    recovered: bool = False
    completion_deadline: datetime | None = None
    # The fingerprint of the session ID the robot echoed for this mission.
    session_hash: str | None = None


def remaining_completion_time(dispatch: PreparedRoomDispatch, timeout: int) -> float:
    """Keep a recovered mission inside its original wall-clock budget."""
    if dispatch.completion_deadline is None:
        return float(timeout)
    return max(0.0, (dispatch.completion_deadline - dt_util.utcnow()).total_seconds())


async def async_completion_budget(
    dispatch: PreparedRoomDispatch,
    configured_seconds: int,
    checkpoint: Callable[[PreparedRoomDispatch], Awaitable[None]] | None,
) -> float:
    """Persist the deadline before entering the completion monitor."""
    if dispatch.completion_deadline is None:
        dispatch = replace(
            dispatch,
            completion_deadline=dt_util.utcnow()
            + timedelta(seconds=configured_seconds),
        )
        if checkpoint is not None:
            await checkpoint(dispatch)
    remaining = remaining_completion_time(dispatch, configured_seconds)
    if remaining <= 0:
        raise TimeoutError
    return remaining


@dataclass(frozen=True, slots=True)
class NativeReconciliation:
    """Minimal durable marker for a native session finishing after cleanup."""

    plan_id: str
    room_id: str
    room: str
    dispatched_at: datetime
    cleaning_mode: str | None = None
    run_id: str | None = None
    coverage_setting: str | None = None
    # The mission's own session and the floor it ran on, when it has one.
    session_hash: str | None = None
    floor_token: str | None = None


class PlanCancelledError(HomeAssistantError):
    """An operator cancelled a managed cleaning plan."""

    def __init__(self, *args: object, suspend_reason: str | None = None) -> None:
        super().__init__(*args)
        self.suspend_reason = suspend_reason


async def async_unless_cancelled[T](
    awaitable: Awaitable[T], cancel_event: asyncio.Event | None
) -> T:
    """Await ``awaitable``, ending it at once when ``cancel_event`` is set.

    A history read waits for its session's record up to the client's
    collection bound, which a stop or unload must not wait out.
    """
    if cancel_event is None:
        return await awaitable
    work = asyncio.ensure_future(awaitable)
    cancelled = asyncio.ensure_future(cancel_event.wait())
    try:
        await asyncio.wait((work, cancelled), return_when=asyncio.FIRST_COMPLETED)
        if work.done():
            return work.result()
        raise PlanCancelledError
    finally:
        cancelled.cancel()
        work.cancel()
        # The work releases what it holds, such as a stream, before the run goes on.
        await asyncio.gather(work, return_exceptions=True)


class NativeHistoryBaselineUnavailableError(HomeAssistantError):
    """Native completion history could not be read before mission dispatch."""


class NativeHistoryIncompleteBaselineError(NativeHistoryBaselineUnavailableError):
    """Native history keeps an entry without a session identity.

    Unlike a failed read, retrying does not help until the robot drops the entry.
    """

    def __init__(self) -> None:
        super().__init__(
            "The robot's cleaning history has an entry that doesn't identify its "
            "cleaning session, so this plan can't track its results. Plans can "
            "start again once the robot no longer keeps that entry."
        )


class RoomStartTimeoutError(TimeoutError):
    """The commanded room did not become active before its start deadline."""


class RoomInterruptedError(HomeAssistantError):
    """A room command ended without positive completion evidence."""


class RoomStoppedInPlaceError(RoomInterruptedError):
    """The robot's task ended in place without a verified completion handoff.

    This observation does not identify the stop source or prove a robot fault.
    Late native reconciliation is deliberately not scheduled: the robot can
    report a stopped room the same way it reports a finished one, so history
    alone cannot resolve this terminal ambiguity safely.
    """


class NativeTaskEndedError(RoomInterruptedError):
    """The dispatched native task ended before its room outcome was observed.

    The session that ended is the one this run owns, so this is not a
    takeover. Native history decides what it means: completed, unreachable,
    or ended without credit.
    """


def failure_reason_code(error: BaseException) -> str:
    """Map an internal failure to a stable, non-sensitive event code."""
    guard_error = coverage_guard_cause(error)
    if guard_error is not None:
        return guard_error.reason_code
    if isinstance(error, ServiceValidationError) and error.__cause__ is not None:
        error = error.__cause__
    if isinstance(error, NativeHistoryIncompleteBaselineError):
        return "native_history_incomplete"
    if isinstance(error, NativeHistoryBaselineUnavailableError):
        return "native_history_baseline_unavailable"
    if isinstance(error, RoomInterruptedError):
        return interruption_reason_code(error)
    if isinstance(error, RoomStartTimeoutError):
        return "start_timeout"
    if isinstance(error, TimeoutError):
        return "completion_timeout"
    if isinstance(error, MaticError) or (
        isinstance(error, ServiceValidationError)
        and error.translation_key == "robot_error"
    ):
        return "robot_error"
    return "managed_failure"


def coverage_guard_cause(error: BaseException) -> CoverageGuardError | None:
    """Find a known pre-write guard through the HA service wrapper."""
    if isinstance(error, CoverageGuardError):
        return error
    if isinstance(error, ServiceValidationError) and isinstance(
        error.__cause__, CoverageGuardError
    ):
        return error.__cause__
    return None


def interruption_reason_code(error: RoomInterruptedError) -> str:
    """Map an unverified room terminal state without guessing its cause."""
    if isinstance(error, RoomStoppedInPlaceError):
        return "stopped_in_place"
    if isinstance(error, NativeTaskEndedError):
        return "native_task_ended"
    return "interrupted"


class RoomOwnershipLostError(HomeAssistantError):
    """The run can no longer act for its native task, so it sends nothing more."""

    reason_code: ClassVar[str]

    def __init__(self, *args: object, suspend_reason: str | None = None) -> None:
        super().__init__(*args)
        self.suspend_reason = suspend_reason

    def service_error(self, room: str) -> ServiceValidationError:
        """Return the action error for the room the run lost."""
        if isinstance(self, RobotConnectionLostError) and not self.sent:
            return validation_error(
                "Home Assistant couldn't reach the robot, so the room wasn't sent",
                "room_not_sent_connection_lost",
                {"room": room},
            )
        if isinstance(self, RobotConnectionLostError):
            return validation_error(
                "Home Assistant lost contact with the robot during the run",
                "room_connection_lost",
                {"room": room},
            )
        return validation_error(
            "The original native cleaning task could no longer be verified",
            "room_taken_over",
            {"room": room},
        )


class RoomTakenOverError(RoomOwnershipLostError):
    """Another native task replaced this run's, or its task can't be named."""

    reason_code = "native_task_taken_over"


class RobotConnectionLostError(RoomOwnershipLostError):
    """The robot stopped answering, so the run can't tell what its task did.

    Lost contact is not a takeover: once its leg was ``sent``, the run's own
    task may still be cleaning.
    """

    reason_code = "connection_lost"

    def __init__(self, *args: object, sent: bool = True) -> None:
        super().__init__(*args)
        self.sent = sent


class ReconnectWindow:
    """Tell lost contact from a takeover while a run watches its task.

    An unreadable task identity means the robot is not answering, not that
    another task took over. The run waits for it as long as restart recovery
    does, then ends as connection lost.
    """

    __slots__ = ("_since",)

    def __init__(self) -> None:
        self._since: float | None = None

    @property
    def waiting(self) -> bool:
        """Whether the last identity read failed."""
        return self._since is not None

    def read(self, identity: bytes | None) -> None:
        """Note one identity read; raise once the robot stays unreadable too long."""
        if identity is not None:
            self._since = None
            return
        now = monotonic()
        if self._since is None:
            self._since = now
        elif now - self._since >= RECONNECT_SECONDS:
            raise RobotConnectionLostError("The robot stopped answering during the run")


def validation_error(
    message: str,
    translation_key: str,
    placeholders: dict[str, str] | None = None,
) -> ServiceValidationError:
    """Create a user-facing and fully translatable action error."""
    return ServiceValidationError(
        message,
        translation_domain=DOMAIN,
        translation_key=translation_key,
        translation_placeholders=placeholders,
    )
