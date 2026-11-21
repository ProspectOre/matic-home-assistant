"""Run one plan leg: a native mission over one or more rooms.

A leg is one native mission, so the robot moves room to room without docking.
Credit comes only from the robot's own history record for that mission: each
verified room is credited with the robot's own per-room duration, a room the
record shows the robot could not reach settles without credit, and every
other room stays due. A one-room leg is judged by the single-room history
rules and keeps a late-history marker for that room when it ends without
proof. A Smart Stop ends a multi-room leg's mission after its current room.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Collection, Sequence
from dataclasses import dataclass, field, replace
from datetime import timedelta
from functools import partial
from typing import Any, Literal, NoReturn

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from . import managed_dispatch as dispatch_control
from . import managed_observation as observation
from . import managed_reconciliation as history_reconciliation
from . import managed_run
from .client import CoverageGuardError, MaticError, RobotActivity, UserCommand
from .const import DOMAIN
from .coverage_accounting import async_confirm_completed_coverage
from .grouped_native_reconciliation import build_grouped_native_reconciliation
from .leg_finish import async_end_after_current_room
from .managed_run import (
    NativeTaskEndedError,
    PlanCancelledError,
    RoomInterruptedError,
    RoomRunOutcome,
    RoomStartTimeoutError,
    RoomStoppedInPlaceError,
    RoomTakenOverError,
    _PreparedRoomDispatch,
)
from .plan_model import CleaningRoom
from .plans import CleaningPlanManager
from .robot_port import RobotPort
from .run_control import ManagedMotionReplacedError, evidence_is_current
from .run_machine import CheckpointWrite, LegVerifying, RoomSettled, RunEvent

type RoomResult = Literal[
    "started",
    "completed",
    "skipped",
    "ended_unverified",
    "cancelled",
    "interrupted",
    "failed",
]

_SUSPENDED = frozenset({"paused", "low_charge"})


def fire_room_event(
    hass: HomeAssistant,
    call: ServiceCall,
    entity_id: str,
    room: CleaningRoom,
    result: RoomResult,
    *,
    run_id: str | None,
    provenance: str,
    **fields: str,
) -> None:
    """Announce one room's outcome as the ``matic_robot_room_<result>`` event."""
    hass.bus.async_fire(
        f"{DOMAIN}_room_{result}",
        {
            ATTR_ENTITY_ID: entity_id,
            "plan_id": call.data["plan_id"],
            "room_id": room.room_id,
            "room": room.name,
            "cleaning_mode": room.cleaning_mode,
            "coverage_setting": room.coverage_setting,
            "run_id": run_id,
            "provenance": provenance,
            **fields,
        },
        context=call.context,
    )


@dataclass(slots=True, kw_only=True)
class _LegRun:
    """One leg's owned native mission, from dispatch to credit or failure."""

    hass: HomeAssistant
    call: ServiceCall
    manager: CleaningPlanManager
    entity_id: str
    serial_number: str
    leg: list[CleaningRoom]
    robot: RobotPort
    motion_token: int
    floor_token: str
    provenance: str
    run_id: str | None
    checkpoint_dispatch: Callable[[_PreparedRoomDispatch], Awaitable[None]]
    advance: Callable[[RunEvent], Awaitable[CheckpointWrite]]
    cancel_event: asyncio.Event | None
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None
    finish_room_event: asyncio.Event | None
    floor_is_current: Callable[[], bool] | None
    on_native_identity: Callable[[bytes | None], None] | None
    record_room_completed: Callable[[CleaningRoom], None] | None
    recovered_suspend_reason: str | None
    expected_identity: bytes | None
    expected_history: frozenset[str] | None
    expected_revision: str | None
    # The room the robot is cleaning, or the recovered run's current room.
    active_room: CleaningRoom
    # The mission sent, or the prepared one this leg adopts.
    dispatch: _PreparedRoomDispatch | None
    native_identity: bytes | None = None
    # Whether a start may have reached the robot, so a failure must STOP it.
    dispatch_attempted: bool = False
    room_started: bool = False
    stop_sent: bool = False
    # The room the robot finishes before ending the mission on a Smart Stop.
    last_room: CleaningRoom | None = None
    room_observer: observation._LegOutcomeObserver | None = None
    finish_task: asyncio.Task[None] | None = None
    observed_ids: set[str] = field(default_factory=set)
    # Room id to the robot's (ended_at, duration_seconds) for its credit.
    credited: dict[str, tuple[str | None, int | None]] = field(default_factory=dict)
    unreachable: set[str] = field(default_factory=set)
    completion_sessions: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.observed_ids.add(self.active_room.room_id)
        self.managed_user_command = dispatch_control._guard_native_commands(
            self.managed_user_command,
            self.manager,
            self.serial_number,
            self.robot.session_identity,
            lambda: self.native_identity,
        )

    @property
    def plan_id(self) -> str:
        return str(self.call.data["plan_id"])

    @property
    def single(self) -> bool:
        return len(self.leg) == 1

    def announce(self, room: CleaningRoom, result: RoomResult, **fields: str) -> None:
        fire_room_event(
            self.hass,
            self.call,
            self.entity_id,
            room,
            result,
            run_id=self.run_id,
            provenance=self.provenance,
            **fields,
        )

    def bind_native_identity(self, identity: bytes | None) -> None:
        self.native_identity = identity
        if self.on_native_identity is not None:
            self.on_native_identity(identity)

    def mark_dispatch_attempted(self) -> None:
        self.dispatch_attempted = True
        self.bind_native_identity(None)

    def end_after(self, room: CleaningRoom) -> None:
        self.last_room = room

    def skipped_room_ids(self) -> Collection[str]:
        if self.run_id is None:
            return ()
        return self.manager.ledger.skipped_room_ids(self.serial_number, self.run_id)

    def ending_early(self) -> bool:
        """Return whether a STOP or a finish request ends this mission early.

        A finish request counts even when its queue change went unconfirmed:
        the mission can end during the readback, and the robot then left
        the rooms it had not entered.
        """
        return self.stop_sent or (
            self.finish_room_event is not None and self.finish_room_event.is_set()
        )

    def withheld_room_ids(self) -> set[str]:
        """Return the rooms the run kept the robot from, with the owner's skips."""
        withheld = set(self.skipped_room_ids())
        if self.ending_early():
            withheld |= {room.room_id for room in self.leg} - self.observed_ids
        return withheld

    async def async_run(self) -> bool:
        """Run the leg and report whether every room in it settled."""
        if await self.manager.ledger.async_mark_started(
            self.serial_number, self.plan_id, self.active_room, run_id=self.run_id
        ):
            self.announce(self.active_room, "started")
        try:
            await self.async_dispatch()
            if await self.async_start():
                await self.async_watch()
        except (TimeoutError, HomeAssistantError, MaticError) as err:
            await self.async_end_failed(err)
        finally:
            if self.room_observer is not None:
                self.room_observer.close()
            if self.finish_task is not None:
                self.finish_task.cancel()
                await asyncio.gather(self.finish_task, return_exceptions=True)
        return await self.async_settle()

    async def async_dispatch(self) -> None:
        """Send the leg's mission, or adopt the prepared one, and checkpoint it."""
        if self.dispatch is None:
            self.dispatch = await dispatch_control._async_dispatch_leg_command(
                self.robot,
                self.leg,
                self.motion_token,
                floor_token=self.floor_token,
                floor_is_current=self.floor_is_current,
                on_dispatch=self.mark_dispatch_attempted,
                on_claim=lambda session_id: (
                    self.manager.ledger.async_claim_native_session(
                        self.serial_number, session_id, run_id=self.run_id
                    )
                ),
                on_identity=self.bind_native_identity,
                expected_dispatch_identity=self.expected_identity,
                expected_dispatch_history=self.expected_history,
                expected_dispatch_revision=self.expected_revision,
            )
        else:
            if self.dispatch.rooms != tuple(self.leg):
                raise ValueError("prepared leg dispatch does not match the leg")
            self.dispatch_attempted = True
            self.bind_native_identity(self.dispatch.native_identity)
        await self.checkpoint_dispatch(self.dispatch)

    async def async_start(self) -> bool:
        """Bind the owned start; return whether the leg goes on to be watched.

        A mission that ended before its room was observed is judged by its
        history alone, since robot state may still lag.
        """
        dispatch = self.dispatch
        assert dispatch is not None
        try:
            start_state = await observation._async_wait_for_owned_start(
                self.robot,
                self.call.data["start_timeout"],
                self.cancel_event,
                self.leg,
                self.bind_native_identity,
                dispatch.native_identity_baseline,
                self.native_identity,
                already_accepted=dispatch.recovered,
            )
        except TimeoutError as err:
            raise RoomStartTimeoutError from err
        except NativeTaskEndedError:
            if not await self.async_verify_end(mission_ended=True):
                raise
            return False
        recovered_suspended = self.recovered_suspend_reason in _SUSPENDED
        if not self.single:
            self.room_observer = observation._LegOutcomeObserver(
                self.robot,
                self.leg,
                self.active_room,
                initial_observed=True,
                classify_current=True,
                suppress_pause=start_state is RobotActivity.PAUSED
                or recovered_suspended,
                initial_suspended=recovered_suspended,
            )
            if self.finish_room_event is not None:
                self.finish_task = asyncio.create_task(
                    async_end_after_current_room(
                        self.finish_room_event,
                        partial(
                            self.robot.end_after_current_room,
                            self.motion_token,
                            self.floor_token,
                        ),
                        lambda: self.native_identity,
                        lambda: self.active_room,
                        self.end_after,
                    )
                )
        self.dispatch = replace(dispatch, native_identity=self.native_identity)
        await self.checkpoint_dispatch(self.dispatch)
        if start_state is RobotActivity.PAUSED or recovered_suspended:
            await self.async_hold(
                self.recovered_suspend_reason or "paused",
                managed_run._remaining_completion_time(
                    self.dispatch, self.call.data["completion_timeout"]
                ),
            )
        else:
            await self.manager.ledger.async_mark_resumed(
                self.serial_number, self.plan_id, self.active_room
            )
        self.room_started = True
        return True

    async def async_watch(self) -> None:
        """Follow the mission room by room until it ends within its budget."""
        assert self.dispatch is not None
        completion_budget = await managed_run._async_completion_budget(
            self.dispatch,
            self.call.data["completion_timeout"],
            self.checkpoint_dispatch,
        )
        refresh_task = asyncio.create_task(
            observation._async_periodic_refresh(self.robot.refresh)
        )
        try:
            async with asyncio.timeout(completion_budget) as mission_timeout:
                while True:
                    outcome, changed_room = await self.async_next_outcome()
                    if outcome is RoomRunOutcome.ROOM_CHANGED:
                        assert changed_room is not None
                        await self.async_enter_room(changed_room)
                        continue
                    if outcome is RoomRunOutcome.HANDOFF_CANDIDATE:
                        if await observation._async_wait_for_active_session_resolution(
                            self.robot,
                            self.cancel_event,
                            expected_identity=self.native_identity,
                        ):
                            await self.manager.ledger.async_mark_resumed(
                                self.serial_number, self.plan_id, self.active_room
                            )
                            continue
                        mission_timeout.reschedule(None)
                        await self.async_verify_end()
                        return
                    if outcome is RoomRunOutcome.STOPPED_IN_PLACE:
                        raise RoomStoppedInPlaceError(
                            f"{self.active_room.name} ended in place without "
                            "returning; the stop cause is unconfirmed"
                        )
                    if outcome is RoomRunOutcome.INTERRUPTED:
                        raise RoomInterruptedError(
                            f"{self.active_room.name} stopped without verified "
                            "completion"
                        )
                    await self.async_hold(
                        "paused" if outcome is RoomRunOutcome.PAUSED else "low_charge",
                        self.call.data["completion_timeout"],
                    )
        finally:
            refresh_task.cancel()
            await asyncio.gather(refresh_task, return_exceptions=True)

    async def async_next_outcome(self) -> tuple[RoomRunOutcome, CleaningRoom | None]:
        """Wait for the leg's next outcome while the run still owns its task."""
        if self.room_observer is not None:
            return await observation._async_wait_with_native_identity(
                partial(self.room_observer.next, self.cancel_event),
                self.robot.session_identity,
                self.native_identity,
            )
        outcome = await observation._async_wait_with_native_identity(
            # Owned start already observed this room. Preserve that evidence
            # across transient cleaning during dock travel.
            lambda: observation._async_wait_for_room_outcome(
                self.robot, self.leg[0], self.cancel_event, initial_observed=True
            ),
            self.robot.session_identity,
            self.native_identity,
        )
        return outcome, None

    async def async_hold(self, reason: str, seconds: float) -> None:
        """Record a paused or low-charge leg and wait for its owned resume."""
        await self.manager.ledger.async_mark_suspended(
            self.serial_number, self.plan_id, self.active_room, reason
        )
        await observation._async_wait_for_owned_resume(
            self.robot,
            seconds,
            self.cancel_event,
            self.leg,
            self.native_identity,
            resume_event=self.room_observer.resume_event
            if self.room_observer
            else None,
        )
        if self.room_observer is not None:
            self.room_observer.resume_after_initial_pause()
        await self.manager.ledger.async_mark_resumed(
            self.serial_number, self.plan_id, self.active_room
        )

    async def async_enter_room(self, room: CleaningRoom) -> None:
        """Make ``room`` the active room once the run still owns the task."""

        async def confirm_ownership() -> None:
            return None

        await observation._async_wait_with_native_identity(
            confirm_ownership, self.robot.session_identity, self.native_identity
        )
        if (
            self.finish_room_event is not None
            and self.finish_room_event.is_set()
            and not self.stop_sent
            and (self.last_room is None or room.room_id != self.last_room.room_id)
        ):
            # The robot kept the next room: the queue change failed or came
            # too late. Honor the finish request at this boundary.
            await dispatch_control._async_cleanup_managed_motion(
                self.managed_user_command, self.motion_token, dispatch_attempted=True
            )
            self.stop_sent = True
        first_observation = room.room_id not in self.observed_ids
        self.observed_ids.add(room.room_id)
        # A robot can revisit a room within the same native mission. Keep the
        # active room current even though its start event is deduped.
        first_start = await self.manager.ledger.async_mark_started(
            self.serial_number, self.plan_id, room, run_id=self.run_id
        )
        if first_observation and first_start:
            self.announce(room, "started")
        self.active_room = room
        await self.manager.ledger.async_mark_resumed(
            self.serial_number, self.plan_id, room
        )

    async def async_verify_end(self, *, mission_ended: bool = False) -> bool:
        """Read the ended mission's history; return whether it gave a verdict."""
        dispatch = self.dispatch
        assert dispatch is not None
        write = await self.advance(
            LegVerifying(
                dt_util.utcnow()
                + timedelta(seconds=observation.SESSION_HISTORY_TIMEOUT_SECONDS)
            )
        )
        await self.manager.ledger.async_mark_verifying(
            self.serial_number, self.plan_id, self.active_room, checkpoint=write
        )
        if not self.single:
            self.credited.update(
                await observation._async_verify_leg_completion(
                    self.robot.session_history,
                    dispatch.history_baseline,
                    self.leg,
                    dispatch.dispatched_at,
                    session_hash=dispatch.session_hash,
                    robot=self.robot,
                    cancel_event=self.cancel_event,
                    allow_active_cleaning=mission_ended,
                    on_verified_session=self.completion_sessions.append,
                    skipped_room_ids=self.withheld_room_ids(),
                    on_unreached=self.unreachable.add,
                )
                or {}
            )
            return bool(self.credited or self.unreachable)
        room = self.leg[0]
        evidence: list[tuple[str, int]] = []
        verdict = await observation._async_adjudicate_room_end(
            self.robot.session_history,
            dispatch.history_baseline,
            room,
            dispatch.dispatched_at,
            session_hash=dispatch.session_hash,
            robot=self.robot,
            cancel_event=self.cancel_event,
            allow_active_cleaning=mission_ended,
            on_verified_session=self.completion_sessions.append,
            on_verified_completion=lambda ended_at, duration: evidence.append(
                (ended_at, duration)
            ),
        )
        if verdict is observation.NativeRoomVerdict.COMPLETED:
            self.credited[room.room_id] = evidence[-1] if evidence else (None, None)
        if verdict is observation.NativeRoomVerdict.UNREACHABLE:
            self.unreachable.add(room.room_id)
        return verdict is not observation.NativeRoomVerdict.UNVERIFIED

    def late_marker(self, credited_ids: Collection[str] = ()) -> Any:
        """Return what a late history record settles this leg's rooms by."""
        if self.single:
            return history_reconciliation._build_native_reconciliation(
                self.plan_id,
                self.leg[0],
                self.dispatch,
                self.room_started,
                self.run_id,
                self.floor_token,
            )
        skipped = self.skipped_room_ids()
        return build_grouped_native_reconciliation(
            self.plan_id,
            [
                {
                    "room_id": room.room_id,
                    "room": room.name,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                }
                for room in self.leg
                if room.room_id in self.observed_ids
                and room.room_id not in credited_ids
                and room.room_id not in skipped
            ],
            self.dispatch.dispatched_at
            if self.room_observer is not None and self.dispatch is not None
            else None,
            self.native_identity,
            self.floor_token,
            self.run_id,
        )

    def stored_marker(self, marker: Any) -> dict[str, Any]:
        """Return the ledger's keyword for ``marker``, none when there is none."""
        if self.single:
            marker = history_reconciliation._native_reconciliation_data(marker)
        return {} if marker is None else {"native_reconciliation": marker}

    def watch_late_history(self, marker: Any) -> None:
        if self.single:
            history_reconciliation._schedule_native_reconciliation(
                self.hass,
                self.manager,
                self.serial_number,
                self.entity_id,
                self.leg[0],
                marker,
                None if self.dispatch is None else self.dispatch.history_baseline,
                self.robot,
                self.call.context,
            )
        elif marker is not None:
            history_reconciliation._schedule_grouped_native_reconciliation(
                self.hass,
                self.manager,
                self.serial_number,
                self.entity_id,
                marker,
                self.robot,
            )

    async def async_record_ended(
        self, mark: Callable[..., Awaitable[None]], reason: str, marker: Any
    ) -> None:
        """Record the active room's end with the marker while the run owns it."""
        async with dispatch_control._managed_reconciliation_guard(
            self.manager, self.serial_number, self.motion_token
        ) as owned:
            if not owned:
                marker = None
            await mark(
                self.serial_number,
                self.plan_id,
                self.active_room,
                reason,
                **self.stored_marker(marker),
            )
            if not dispatch_control._managed_reconciliation_is_current(
                self.manager, self.serial_number, self.motion_token
            ):
                marker = None
            self.watch_late_history(marker)

    async def async_record_aborted(
        self, mark: Callable[..., Awaitable[None]], reason: str
    ) -> None:
        """Record the active room's end; a one-room leg watches late history."""
        if self.single:
            await self.async_record_ended(mark, reason, self.late_marker())
        else:
            await mark(self.serial_number, self.plan_id, self.active_room, reason)

    async def async_end_failed(self, err: Exception) -> NoReturn:
        """Record and announce how the leg ended early, then raise for the run.

        A shutdown that suspends the run records nothing here.
        """
        if dispatch_control._shutdown_suspends_run(
            self.hass, self.manager, self.serial_number
        ):
            raise err
        room = self.active_room
        if isinstance(err, ManagedMotionReplacedError):
            await self.manager.ledger.async_mark_cancelled(
                self.serial_number, self.plan_id, room
            )
            self.announce(
                room, "cancelled", reason_code="managed_cancelled", cause="replacement"
            )
            raise PlanCancelledError from err
        if isinstance(err, PlanCancelledError):
            await self.async_cancelled(err)
            raise err
        if isinstance(err, RoomTakenOverError):
            err.suspend_reason = dispatch_control._suspended_run_reason(
                self.manager, self.serial_number
            )
            await self.manager.ledger.async_mark_interrupted(
                self.serial_number, self.plan_id, room, str(err)
            )
            self.announce(
                room,
                "interrupted",
                error=str(err),
                reason_code="native_task_taken_over",
                cause="unknown",
            )
            raise managed_run.validation_error(
                "The original native cleaning task could no longer be verified",
                "room_taken_over",
                {"room": room.name},
            ) from err
        if isinstance(err, RoomInterruptedError):
            await dispatch_control._async_cleanup_managed_motion(
                self.managed_user_command, self.motion_token, self.dispatch_attempted
            )
            await self.async_record_ended(
                self.manager.ledger.async_mark_interrupted,
                str(err),
                None
                if isinstance(err, RoomStoppedInPlaceError)
                else self.late_marker(),
            )
            self.announce(
                room,
                "interrupted",
                error=str(err),
                reason_code=managed_run._interruption_reason_code(err),
                cause="unknown",
            )
            raise managed_run.validation_error(
                str(err), "room_interrupted", {"room": room.name}
            ) from err
        await self.async_failed(err)

    async def async_cancelled(self, err: PlanCancelledError) -> None:
        """Record a cancelled leg, or an interrupted one when the entry unloads."""
        err.suspend_reason = dispatch_control._suspended_run_reason(
            self.manager, self.serial_number
        )
        room = self.active_room
        cancellation_reason = self.manager.control.cancellation_reason(
            self.serial_number
        )
        if cancellation_reason == "config_entry_unload":
            await dispatch_control._async_cleanup_managed_motion(
                self.managed_user_command, self.motion_token, self.dispatch_attempted
            )
            await self.async_record_aborted(
                self.manager.ledger.async_mark_interrupted,
                "Home Assistant unloaded while cleaning this room",
            )
            self.announce(
                room,
                "interrupted",
                reason_code="config_entry_unload",
                cause="home_assistant",
            )
            return
        await self.manager.ledger.async_mark_cancelled(
            self.serial_number, self.plan_id, room
        )
        self.announce(
            room,
            "cancelled",
            reason_code=(
                "managed_cancelled"
                if cancellation_reason in {"managed_stop", "motion_replaced"}
                else "cancellation_unattributed"
            ),
            cause=(
                "replacement"
                if cancellation_reason == "motion_replaced"
                else "managed_cancellation"
                if cancellation_reason == "managed_stop"
                else "unknown"
            ),
        )

    async def async_failed(self, err: Exception) -> NoReturn:
        """STOP a failed leg, record and announce it, and raise its action error."""
        # A graceful finish request can race a room failure. Clear that intent
        # before sending the failure STOP so its dock watcher cannot upgrade
        # the still-running record and mask the durable failure.
        if self.finish_room_event is not None:
            self.finish_room_event.clear()
        # A multi-room leg sends no cleanup STOP while this run's own STOP
        # settles; a one-room leg sends it either way.
        if self.single or not dispatch_control._managed_stop_fence_owned_by_run(
            self.manager, self.serial_number, self.run_id
        ):
            await dispatch_control._async_cleanup_managed_motion(
                self.managed_user_command,
                self.motion_token,
                self.dispatch_attempted
                and managed_run._coverage_guard_cause(err) is None,
            )
        if isinstance(err, RoomStartTimeoutError):
            failure_reason = "The robot did not begin cleaning before the start timeout"
        elif isinstance(err, TimeoutError):
            failure_reason = "The managed room exceeded its completion timeout"
        elif isinstance(err, CoverageGuardError):
            failure_reason = managed_run.coverage_guard_message(err)
        elif isinstance(err, MaticError):
            failure_reason = "The robot could not complete the managed room"
        else:
            failure_reason = str(err).strip() or "The managed room failed"
        await self.async_record_aborted(
            self.manager.ledger.async_mark_failed, failure_reason
        )
        room = self.active_room
        self.announce(
            room,
            "failed",
            error=failure_reason,
            reason_code=managed_run._failure_reason_code(err),
            cause="unknown",
        )
        if isinstance(err, ServiceValidationError):
            raise err
        if isinstance(err, RoomStartTimeoutError):
            raise managed_run.validation_error(
                f"The robot did not begin cleaning {room.name} before the "
                "start timeout",
                "plan_start_timeout",
                {"room": room.name},
            ) from err
        if isinstance(err, CoverageGuardError):
            raise managed_run.validation_error(
                managed_run.coverage_guard_message(err), err.reason_code
            ) from err
        if isinstance(err, MaticError):
            raise managed_run.validation_error(
                "The robot could not complete the managed room",
                "robot_command_failed",
                {"room": room.name},
            ) from err
        if isinstance(err, TimeoutError):
            raise managed_run.validation_error(
                f"Timed out while cleaning {room.name}",
                "plan_timeout",
                {"room": room.name},
            ) from err
        raise err

    async def async_settle(self) -> bool:
        """Credit, skip, cancel or leave due each room; return if all settled."""
        credited = self.credited
        session_hash = (
            self.completion_sessions[-1] if self.completion_sessions else None
        )
        verified_coverage = (
            await async_confirm_completed_coverage(
                self.manager.recovery.coverage_receipt(self.serial_number, self.run_id),
                session_hash,
                self.robot.coverage_verifier,
            )
            if credited
            else None
        )
        # A one-room leg reads the owner's skips only when history left it due.
        skipped = (
            self.skipped_room_ids()
            if len(credited) < len(self.leg) and not (self.single and self.unreachable)
            else ()
        )
        marker = None if self.single else self.late_marker(tuple(credited))
        marker_saved = False
        ledger = self.manager.ledger
        for room in self.leg:
            if room.room_id in credited:
                completed_at, duration_seconds = credited[room.room_id]
                if not await ledger.async_mark_completed(
                    self.serial_number,
                    self.plan_id,
                    room,
                    run_id=self.run_id,
                    completed_at=completed_at,
                    duration_seconds=duration_seconds,
                    verified_coverage_receipt=verified_coverage,
                    completion_session_hash=session_hash,
                    completion_is_current=partial(
                        evidence_is_current,
                        self.manager.control,
                        self.serial_number,
                        self.motion_token,
                        self.cancel_event,
                        self.floor_is_current,
                    ),
                ):
                    raise PlanCancelledError(
                        "Run ownership changed before room completion could be credited"
                    )
                self.robot.confirm_room_completed(room.name)
                if self.record_room_completed is not None:
                    self.record_room_completed(room)
                self.announce(room, "completed", reason_code="verified_completion")
            elif self.run_id is not None and room.room_id in skipped:
                # Skipped without credit, but settled, so the run goes on.
                await ledger.async_mark_skipped(
                    self.serial_number, self.plan_id, room, run_id=self.run_id
                )
                await self.advance(RoomSettled(room.room_id))
                self.announce(room, "skipped", reason_code="owner_skipped")
            elif self.ending_early() and room.room_id not in self.observed_ids:
                await ledger.async_mark_cancelled(
                    self.serial_number, self.plan_id, room
                )
                self.announce(
                    room,
                    "cancelled",
                    reason_code="managed_cancelled",
                    cause="finish_current_room_or_stop",
                )
            elif room.room_id in self.unreachable:
                # The robot finished its mission without reaching the room.
                # Settle it without credit so it stays due; the run goes on.
                await ledger.async_mark_unreachable(
                    self.serial_number, self.plan_id, room, run_id=self.run_id
                )
                await self.advance(RoomSettled(room.room_id))
                self.announce(
                    room, "skipped", reason_code="room_unreachable", cause="robot"
                )
            else:
                if self.single:
                    await ledger.async_mark_ended_unverified(
                        self.serial_number, self.plan_id, room
                    )
                else:
                    async with dispatch_control._managed_reconciliation_guard(
                        self.manager, self.serial_number, self.motion_token
                    ) as owned:
                        if not owned or (
                            self.floor_is_current is not None
                            and not self.floor_is_current()
                        ):
                            marker = None
                        await ledger.async_mark_ended_unverified(
                            self.serial_number,
                            self.plan_id,
                            room,
                            **self.stored_marker(None if marker_saved else marker),
                        )
                    marker_saved = True
                self.announce(
                    room,
                    "ended_unverified",
                    reason_code="unverified_completion",
                    cause="unknown",
                )
        self.watch_late_history(marker)
        return all(
            room.room_id in credited
            or room.room_id in skipped
            or room.room_id in self.unreachable
            for room in self.leg
        )


async def _async_run_leg(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    rooms: Sequence[CleaningRoom],
    robot: RobotPort,
    motion_token: int,
    *,
    floor_token: str,
    checkpoint_dispatch: Callable[[_PreparedRoomDispatch], Awaitable[None]],
    advance: Callable[[RunEvent], Awaitable[CheckpointWrite]],
    cancel_event: asyncio.Event | None = None,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None = None,
    prepared_dispatch: _PreparedRoomDispatch | None = None,
    finish_room_event: asyncio.Event | None = None,
    floor_is_current: Callable[[], bool] | None = None,
    on_native_identity: Callable[[bytes | None], None] | None = None,
    run_id: str | None = None,
    record_room_completed: Callable[[CleaningRoom], None] | None = None,
    recovered_room_id: str | None = None,
    provenance: str | None = None,
    recovered_suspend_reason: str | None = None,
    expected_dispatch_identity: bytes | None = None,
    expected_dispatch_history: frozenset[str] | None = None,
    expected_dispatch_revision: str | None = None,
) -> bool:
    """Run one leg and report whether every room in it settled.

    A room settles when the robot's history credits it, the owner skipped
    it, or the history shows the robot could not reach it.
    """
    leg = list(rooms)
    return await _LegRun(
        hass=hass,
        call=call,
        manager=manager,
        entity_id=entity_id,
        serial_number=serial_number,
        leg=leg,
        robot=robot,
        motion_token=motion_token,
        floor_token=floor_token,
        provenance=provenance
        if provenance is not None
        else dispatch_control._run_provenance(call),
        run_id=run_id,
        checkpoint_dispatch=checkpoint_dispatch,
        advance=advance,
        cancel_event=cancel_event,
        managed_user_command=managed_user_command,
        finish_room_event=finish_room_event,
        floor_is_current=floor_is_current,
        on_native_identity=on_native_identity,
        record_room_completed=record_room_completed,
        recovered_suspend_reason=recovered_suspend_reason,
        expected_identity=expected_dispatch_identity,
        expected_history=expected_dispatch_history,
        expected_revision=expected_dispatch_revision,
        active_room=next(
            (room for room in leg if room.room_id == recovered_room_id), leg[0]
        ),
        dispatch=prepared_dispatch,
    ).async_run()
