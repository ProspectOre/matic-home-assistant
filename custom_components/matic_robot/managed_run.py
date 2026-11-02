"""Managed execution values, completion budgets, and failure vocabulary."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from .client.exceptions import CoverageGuardError, MaticError
from .const import DOMAIN
from .plan_model import CleaningRoom


class RoomRunOutcome(StrEnum):
    """Conservative result of one managed, single-room command."""

    HANDOFF_CANDIDATE = "handoff_candidate"
    SUSPENDED = "suspended"
    PAUSED = "paused"
    INTERRUPTED = "interrupted"
    STOPPED_IN_PLACE = "stopped_in_place"
    ROOM_CHANGED = "room_changed"


type LegOutcomeWaiter = Callable[
    ..., Awaitable[tuple[RoomRunOutcome, CleaningRoom | None]]
]


@dataclass(frozen=True, slots=True)
class _PreparedRoomDispatch:
    """Describe a next-leg command issued during the prior leg's return."""

    rooms: tuple[CleaningRoom, ...]
    history_baseline: frozenset[bytes] | None
    dispatched_at: datetime
    native_identity_baseline: bytes | None = None
    native_identity: bytes | None = None
    recovered: bool = False
    completion_deadline: datetime | None = None


def _remaining_completion_time(dispatch: _PreparedRoomDispatch, timeout: int) -> float:
    """Keep a recovered mission inside its original wall-clock budget."""
    if dispatch.completion_deadline is None:
        return float(timeout)
    return max(0.0, (dispatch.completion_deadline - dt_util.utcnow()).total_seconds())


async def _async_completion_budget(
    dispatch: _PreparedRoomDispatch,
    configured_seconds: int,
    checkpoint: Callable[[_PreparedRoomDispatch], Awaitable[None]] | None,
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
    remaining = _remaining_completion_time(dispatch, configured_seconds)
    if remaining <= 0:
        raise TimeoutError
    return remaining


@dataclass(frozen=True, slots=True)
class _NativeReconciliation:
    """Minimal durable marker for a native session finishing after cleanup."""

    plan_id: str
    room_id: str
    room: str
    dispatched_at: datetime
    cleaning_mode: str | None = None
    run_id: str | None = None
    coverage_setting: str | None = None


class PlanCancelledError(HomeAssistantError):
    """An operator cancelled a managed cleaning plan."""

    def __init__(self, *args: object, suspend_reason: str | None = None) -> None:
        super().__init__(*args)
        self.suspend_reason = suspend_reason


class NativeHistoryBaselineUnavailableError(HomeAssistantError):
    """Native completion history could not be read before mission dispatch."""


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


def _failure_reason_code(error: BaseException) -> str:
    """Map an internal failure to a stable, non-sensitive event code."""
    guard_error = _coverage_guard_cause(error)
    if guard_error is not None:
        return guard_error.reason_code
    if isinstance(error, ServiceValidationError) and error.__cause__ is not None:
        error = error.__cause__
    if isinstance(error, NativeHistoryBaselineUnavailableError):
        return "native_history_baseline_unavailable"
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


def _coverage_guard_cause(error: BaseException) -> CoverageGuardError | None:
    """Find a known pre-write guard through the HA service wrapper."""
    if isinstance(error, CoverageGuardError):
        return error
    if isinstance(error, ServiceValidationError) and isinstance(
        error.__cause__, CoverageGuardError
    ):
        return error.__cause__
    return None


def _interruption_reason_code(error: RoomInterruptedError) -> str:
    """Map an unverified room terminal state without guessing its cause."""
    if isinstance(error, RoomStoppedInPlaceError):
        return "stopped_in_place"
    return "interrupted"


class RoomTakenOverError(HomeAssistantError):
    """The native task ended, changed, or could no longer be identified."""

    def __init__(self, *args: object, suspend_reason: str | None = None) -> None:
        super().__init__(*args)
        self.suspend_reason = suspend_reason


def _validation_error(
    message: str,
    translation_key: str,
    placeholders: dict[str, str] | None = None,
) -> ServiceValidationError:
    return ServiceValidationError(
        message,
        translation_domain=DOMAIN,
        translation_key=translation_key,
        translation_placeholders=placeholders,
    )
