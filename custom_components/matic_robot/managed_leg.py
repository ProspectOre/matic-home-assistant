"""Run one plan leg: a native mission over one or more rooms.

A leg is one native mission, so the robot moves room to room without docking.
A one-room leg is a leg of one room: the same observer, Smart Stop, cleanup
STOP and settlement run every leg. Credit comes only from the robot's own
history record for that mission: each verified room is credited with the
robot's own per-room duration, a room the record shows the robot could not
reach settles without credit, and every other room stays due. Only reading
that record differs, because the record names one room or a group; the leg's
``record`` holds which.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Collection, Sequence
from dataclasses import dataclass, field, replace
from datetime import timedelta
from functools import partial
from typing import Any, NoReturn

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from . import managed_dispatch as dispatch_control
from . import managed_observation as observation
from . import managed_reconciliation as history_reconciliation
from . import managed_run
from .client import CoverageGuardError, MaticError, RobotActivity, UserCommand
from .grouped_native_reconciliation import build_grouped_native_reconciliation
from .leg_finish import async_end_after_current_room
from .leg_settlement import LegSettlement, RoomResult, fire_room_event
from .managed_run import (
    NativeTaskEndedError,
    PlanCancelledError,
    PreparedRoomDispatch,
    RoomInterruptedError,
    RoomOwnershipLostError,
    RoomRunOutcome,
    RoomStartTimeoutError,
    RoomStoppedInPlaceError,
)
from .native_completion import RobotEnded
from .plan_model import CleaningRoom
from .plans import CleaningPlanManager
from .robot_port import RobotPort
from .run_control import ManagedMotionReplacedError, evidence_is_current
from .run_machine import CheckpointWrite, LegVerifying, RunEvent

_SUSPENDED = frozenset({"paused", "low_charge"})


def withheld_room_ids(
    skipped: Collection[str],
    leg: Sequence[CleaningRoom],
    started: Collection[str] | None,
) -> set[str]:
    """Return the leg's rooms the run kept the robot from.

    The owner's skips, and on a mission ending early, a Smart Stop or a STOP,
    each room not in ``started``: the robot dropped those from its mission.
    ``started`` is None while the mission is not ending early.
    """
    withheld = set(skipped)
    if started is not None:
        withheld |= {room.room_id for room in leg} - set(started)
    return withheld


class _OneRoomRecord:
    """How a one-room mission's history record is read: it names that room alone.

    The single-room rules apply: a cancelled record ends the wait, and a
    legacy record's session result stands for its one room. An aborted leg
    keeps a marker for that room, whose watcher drops a task that ended in
    place, since the robot records a stopped room as completed.
    """

    marks_aborted = True
    marks_settled = False

    async def async_verify(self, run: _LegRun, *, mission_ended: bool) -> bool:
        dispatch = run.dispatch
        assert dispatch is not None
        room = run.leg[0]
        evidence: list[tuple[str, int]] = []
        verdict = await observation.async_adjudicate_room_end(
            run.robot.session_history,
            dispatch.history_baseline,
            room,
            dispatch.dispatched_at,
            session_hash=dispatch.session_hash,
            robot=run.robot,
            cancel_event=run.cancel_event,
            allow_active_cleaning=mission_ended,
            on_verified_session=run.completion_sessions.append,
            on_verified_completion=lambda ended_at, duration: evidence.append(
                (ended_at, duration)
            ),
        )
        if verdict is observation.NativeRoomVerdict.COMPLETED:
            run.credited[room.room_id] = evidence[-1] if evidence else (None, None)
        if isinstance(verdict, RobotEnded):
            run.robot_ended[room.room_id] = verdict
        return verdict is not observation.NativeRoomVerdict.UNVERIFIED

    def late_marker(self, run: _LegRun, _credited_ids: Collection[str]) -> Any:
        return history_reconciliation.build_native_reconciliation(
            run.plan_id,
            run.leg[0],
            run.dispatch,
            run.room_started,
            run.run_id,
            run.floor_token,
        )

    def stored(self, marker: Any) -> Any:
        return history_reconciliation.native_reconciliation_data(marker)

    def watch(self, run: _LegRun, marker: Any) -> None:
        history_reconciliation.schedule_native_reconciliation(
            run.hass,
            run.manager,
            run.serial_number,
            run.entity_id,
            run.leg[0],
            marker,
            None if run.dispatch is None else run.dispatch.history_baseline,
            run.robot,
            run.call.context,
        )


class _GroupedRecord:
    """How a multi-room mission's grouped history record is read.

    Each room is matched in the one record bound to the mission. A leg that
    settles without proof keeps a marker for its observed, uncredited rooms.
    """

    marks_aborted = False
    marks_settled = True

    async def async_verify(self, run: _LegRun, *, mission_ended: bool) -> bool:
        dispatch = run.dispatch
        assert dispatch is not None
        run.credited.update(
            await observation.async_verify_leg_completion(
                run.robot.session_history,
                dispatch.history_baseline,
                run.leg,
                dispatch.dispatched_at,
                session_hash=dispatch.session_hash,
                robot=run.robot,
                cancel_event=run.cancel_event,
                allow_active_cleaning=mission_ended,
                on_verified_session=run.completion_sessions.append,
                skipped_room_ids=run.withheld_room_ids(),
                on_robot_ended=run.robot_ended.update,
            )
            or {}
        )
        return bool(run.credited or run.robot_ended)

    def late_marker(self, run: _LegRun, credited_ids: Collection[str]) -> Any:
        skipped = run.skipped_room_ids()
        return build_grouped_native_reconciliation(
            run.plan_id,
            [
                {
                    "room_id": room.room_id,
                    "room": room.name,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                }
                for room in run.leg
                if room.room_id in run.observed_ids
                and room.room_id not in credited_ids
                and room.room_id not in skipped
            ],
            run.dispatch.dispatched_at
            if run.room_observer is not None and run.dispatch is not None
            else None,
            run.native_identity,
            run.floor_token,
            run.run_id,
        )

    def stored(self, marker: Any) -> Any:
        return marker

    def watch(self, run: _LegRun, marker: Any) -> None:
        if marker is not None:
            history_reconciliation.schedule_grouped_native_reconciliation(
                run.hass,
                run.manager,
                run.serial_number,
                run.entity_id,
                marker,
                run.robot,
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
    checkpoint_dispatch: Callable[[PreparedRoomDispatch], Awaitable[None]]
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
    on_dispatching: Callable[[], Awaitable[object]] | None
    # The room the robot is cleaning, or the recovered run's current room.
    active_room: CleaningRoom
    # The mission sent, or the prepared one this leg adopts.
    dispatch: PreparedRoomDispatch | None
    # How the robot's history record for this mission is read.
    record: _OneRoomRecord | _GroupedRecord
    native_identity: bytes | None = None
    # Whether a start may have reached the robot, so a failure must STOP it.
    dispatch_attempted: bool = False
    room_started: bool = False
    stop_sent: bool = False
    # The room the robot finishes before ending the mission on a Smart Stop.
    last_room: CleaningRoom | None = None
    room_observer: observation.LegOutcomeObserver | None = None
    finish_task: asyncio.Task[None] | None = None
    observed_ids: set[str] = field(default_factory=set)
    # Room id to the robot's (ended_at, duration_seconds) for its credit.
    credited: dict[str, tuple[str | None, int | None]] = field(default_factory=dict)
    # Room id to how the robot left a room it finished its mission short of.
    robot_ended: dict[str, RobotEnded] = field(default_factory=dict)
    completion_sessions: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.observed_ids.add(self.active_room.room_id)
        self.managed_user_command = dispatch_control.guard_native_commands(
            self.managed_user_command,
            self.manager,
            self.serial_number,
            self.robot.session_identity,
            lambda: self.native_identity,
        )

    @property
    def plan_id(self) -> str:
        return str(self.call.data["plan_id"])

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
        return withheld_room_ids(
            self.skipped_room_ids(),
            self.leg,
            self.observed_ids if self.ending_early() else None,
        )

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
            self.dispatch = await dispatch_control.async_dispatch_leg_command(
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
                cancel_event=self.cancel_event,
                on_dispatching=self.on_dispatching,
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
            start_state = await observation.async_wait_for_owned_start(
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
        self.room_observer = observation.LegOutcomeObserver(
            self.robot,
            self.leg,
            self.active_room,
            initial_observed=True,
            classify_current=True,
            suppress_pause=start_state is RobotActivity.PAUSED or recovered_suspended,
            initial_suspended=recovered_suspended,
        )
        # A one-room mission holds no waiting room for a Smart Stop to drop.
        if self.finish_room_event is not None and len(self.leg) > 1:
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
                managed_run.remaining_completion_time(
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
        completion_budget = await managed_run.async_completion_budget(
            self.dispatch,
            self.call.data["completion_timeout"],
            self.checkpoint_dispatch,
        )
        refresh_task = asyncio.create_task(
            observation.async_periodic_refresh(self.robot.refresh)
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
                        if await observation.async_wait_for_active_session_resolution(
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
        assert self.room_observer is not None
        return await observation.async_wait_with_native_identity(
            partial(self.room_observer.next, self.cancel_event),
            self.robot.session_identity,
            self.native_identity,
            cancel_event=self.cancel_event,
        )

    async def async_hold(self, reason: str, seconds: float) -> None:
        """Record a paused or low-charge leg and wait for its owned resume."""
        await self.manager.ledger.async_mark_suspended(
            self.serial_number, self.plan_id, self.active_room, reason
        )
        await observation.async_wait_for_owned_resume(
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

        await observation.async_wait_with_native_identity(
            confirm_ownership,
            self.robot.session_identity,
            self.native_identity,
            cancel_event=self.cancel_event,
        )
        if (
            self.finish_room_event is not None
            and self.finish_room_event.is_set()
            and not self.stop_sent
            and (self.last_room is None or room.room_id != self.last_room.room_id)
        ):
            # The robot kept the next room: the queue change failed or came
            # too late. Honor the finish request at this boundary.
            await dispatch_control.async_cleanup_managed_motion(
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
        write = await self.advance(
            LegVerifying(
                dt_util.utcnow()
                + timedelta(seconds=observation.SESSION_HISTORY_TIMEOUT_SECONDS)
            )
        )
        await self.manager.ledger.async_mark_verifying(
            self.serial_number, self.plan_id, self.active_room, checkpoint=write
        )
        return await self.record.async_verify(self, mission_ended=mission_ended)

    def late_marker(self, credited_ids: Collection[str] = ()) -> Any:
        """Return what a late history record settles this leg's rooms by."""
        return self.record.late_marker(self, credited_ids)

    def stored_marker(self, marker: Any) -> dict[str, Any]:
        """Return the ledger's keyword for ``marker``, none when there is none."""
        marker = self.record.stored(marker)
        return {} if marker is None else {"native_reconciliation": marker}

    async def async_record_ended(
        self, mark: Callable[..., Awaitable[None]], reason: str, marker: Any
    ) -> None:
        """Record the active room's end with the marker while the run owns it."""
        async with dispatch_control.managed_reconciliation_guard(
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
            if not dispatch_control.managed_reconciliation_is_current(
                self.manager, self.serial_number, self.motion_token
            ):
                marker = None
            self.record.watch(self, marker)

    async def async_record_aborted(
        self, mark: Callable[..., Awaitable[None]], reason: str
    ) -> None:
        """Record the active room's end, with a marker if the record keeps one."""
        await self.async_record_ended(
            mark, reason, self.late_marker() if self.record.marks_aborted else None
        )

    async def async_end_failed(self, err: Exception) -> NoReturn:
        """Record and announce how the leg ended early, then raise for the run.

        A shutdown that suspends the run records nothing here.
        """
        if dispatch_control.shutdown_suspends_run(
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
        if isinstance(err, RoomOwnershipLostError):
            err.suspend_reason = dispatch_control.suspended_run_reason(
                self.manager, self.serial_number
            )
            await self.manager.ledger.async_mark_interrupted(
                self.serial_number, self.plan_id, room, str(err)
            )
            self.announce(
                room,
                "interrupted",
                error=str(err),
                reason_code=err.reason_code,
                cause="unknown",
            )
            raise err.service_error(room.name) from err
        if isinstance(err, RoomInterruptedError):
            await dispatch_control.async_cleanup_managed_motion(
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
                reason_code=managed_run.interruption_reason_code(err),
                cause="unknown",
            )
            raise managed_run.validation_error(
                str(err), "room_interrupted", {"room": room.name}
            ) from err
        await self.async_failed(err)

    async def async_cancelled(self, err: PlanCancelledError) -> None:
        """Record a cancelled leg, or an interrupted one when the entry unloads."""
        err.suspend_reason = dispatch_control.suspended_run_reason(
            self.manager, self.serial_number
        )
        room = self.active_room
        cancellation_reason = self.manager.control.cancellation_reason(
            self.serial_number
        )
        if cancellation_reason == "config_entry_unload":
            await dispatch_control.async_cleanup_managed_motion(
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
        # No cleanup STOP while this run's own STOP settles.
        if not dispatch_control.managed_stop_fence_owned_by_run(
            self.manager, self.serial_number, self.run_id
        ):
            await dispatch_control.async_cleanup_managed_motion(
                self.managed_user_command,
                self.motion_token,
                self.dispatch_attempted
                and managed_run.coverage_guard_cause(err) is None,
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
            reason_code=managed_run.failure_reason_code(err),
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

    def evidence_is_current(self) -> bool:
        """Whether this run still owns the motion and floor a room result needs."""
        return evidence_is_current(
            self.manager.control,
            self.serial_number,
            self.motion_token,
            self.cancel_event,
            self.floor_is_current,
        )

    async def async_settle(self) -> bool:
        """Settle the leg's rooms and watch late history if the record keeps it."""
        marker = None
        marker_saved = False

        def build_marker() -> None:
            nonlocal marker
            if self.record.marks_settled:
                marker = self.late_marker(tuple(self.credited))

        ledger = self.manager.ledger

        async def record_unverified(room: CleaningRoom) -> bool:
            nonlocal marker, marker_saved
            async with dispatch_control.managed_reconciliation_guard(
                self.manager, self.serial_number, self.motion_token
            ) as owned:
                if not owned or (
                    self.floor_is_current is not None and not self.floor_is_current()
                ):
                    marker = None
                recorded = await ledger.async_mark_ended_unverified(
                    self.serial_number,
                    self.plan_id,
                    room,
                    **self.stored_marker(None if marker_saved else marker),
                )
            marker_saved = True
            return recorded

        settled = await LegSettlement(
            hass=self.hass,
            call=self.call,
            manager=self.manager,
            entity_id=self.entity_id,
            serial_number=self.serial_number,
            run_id=self.run_id,
            provenance=self.provenance,
            leg=self.leg,
            robot=self.robot,
            advance=self.advance,
            record_room_completed=self.record_room_completed,
            evidence_is_current=self.evidence_is_current,
            credited=self.credited,
            robot_ended=self.robot_ended,
            completion_sessions=self.completion_sessions,
            ending_early=self.ending_early,
            entered_room_ids=self.observed_ids,
            record_unverified=record_unverified,
        ).async_settle(build_marker)
        self.record.watch(self, marker)
        return settled


async def async_run_room_leg(
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
    checkpoint_dispatch: Callable[[PreparedRoomDispatch], Awaitable[None]],
    advance: Callable[[RunEvent], Awaitable[CheckpointWrite]],
    cancel_event: asyncio.Event | None = None,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None = None,
    prepared_dispatch: PreparedRoomDispatch | None = None,
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
    on_dispatching: Callable[[], Awaitable[object]] | None = None,
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
        else dispatch_control.run_provenance(call),
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
        on_dispatching=on_dispatching,
        active_room=next(
            (room for room in leg if room.room_id == recovered_room_id), leg[0]
        ),
        dispatch=prepared_dispatch,
        record=_OneRoomRecord() if len(leg) == 1 else _GroupedRecord(),
    ).async_run()
