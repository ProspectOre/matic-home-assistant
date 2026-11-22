"""Managed cleaning execution and native-session reconciliation."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from functools import partial
from typing import Any, NamedTuple
from uuid import uuid4

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import Context, HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from . import leg_handoff, managed_run
from . import managed_area as area_execution
from . import managed_dispatch as dispatch_control
from . import managed_leg as leg_execution
from . import managed_observation as observation
from .client import MaticError, RobotActivity, UserCommand
from .const import DOMAIN, EVENT_PLAN_FINISHED, EVENT_PLAN_STARTED
from .managed_run import (
    PlanCancelledError,
    RoomInterruptedError,
    RoomStoppedInPlaceError,
    RoomTakenOverError,
    _PreparedRoomDispatch,
)
from .native_completion import native_room_key
from .plan_model import (
    AreaLeg,
    CleaningRoom,
    PlanLeg,
    plan_legs,
    run_entries,
)
from .plan_records import LastRun, RecoveryCheckpoint
from .plans import CleaningPlanManager
from .robot_port import RobotPort
from .run_control import ManagedMotionReplacedError
from .run_machine import (
    AreaFinished,
    CheckpointWrite,
    DispatchRecorded,
    HandoffEntered,
    LegDispatching,
    LegVerified,
    RoomVerified,
    Run,
    RunEvent,
    transition,
)

_LOGGER = logging.getLogger(__name__)


class _Handoff(NamedTuple):
    """How a leg starts: the dispatch it adopts and the boundary a new one checks."""

    dispatch: _PreparedRoomDispatch | None = None
    history: frozenset[str] | None = None
    revision: str | None = None


@dataclass(slots=True, kw_only=True)
class _PlanRun:
    """One managed run, from its admission under the lock to its end record."""

    hass: HomeAssistant
    call: ServiceCall
    manager: CleaningPlanManager
    entity_id: str
    serial_number: str
    rooms: list[CleaningRoom]
    robot: RobotPort
    floor_token: str
    run_id: str
    recovery: LastRun | None
    cadence_by_room: Mapping[str, Mapping[str, Any]] | None
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None
    mapped_room_names: tuple[str, ...]
    floor_is_current: Callable[[], bool] | None
    validate_prepared_run: Callable[[], None] | None
    entries: Sequence[Mapping[str, Any]] | None
    held_rooms: Sequence[Mapping[str, str]]
    missing_rooms: Sequence[Mapping[str, str | None]]
    on_started: Callable[[str], None] | None
    # The mission a recovered run adopts for its first remaining leg.
    recovered_dispatch: _PreparedRoomDispatch | None
    cancel_event: asyncio.Event
    motion_token: int
    # The identity of the mission the run is on, b"" when none.
    native_identity: bytes | None
    # The completed mission a new dispatch may replace, if any.
    expected_identity: bytes | None
    finish_room_event: asyncio.Event = field(init=False)
    finish_current_room: bool = field(init=False)
    finish_current_room_threshold: int = field(init=False)
    started_at: str = field(init=False)
    provenance: str = field(init=False)
    checkpoint: RecoveryCheckpoint = field(init=False)
    run: Run = field(init=False)
    # Whether plan_started was fired, so plan_finished must follow.
    run_started: bool = field(init=False)
    outer_command: Callable[[int, UserCommand], Awaitable[None]] | None = field(
        init=False
    )
    legs: list[PlanLeg] = field(default_factory=list)
    # The outcome, reason code and cause the run ends with.
    ending: tuple[str, str, str] = ("failed", "run_not_finished", "unknown")
    shutdown_suspended: bool = False
    dock_confirmation_scheduled: bool = False

    def __post_init__(self) -> None:
        recovery, manager = self.recovery, self.manager
        self.finish_room_event = manager.control.finish_room_event(self.serial_number)
        self.finish_current_room, self.finish_current_room_threshold = (
            manager.cadence.prepared_run_stop_policy(self.serial_number, self.run_id)
        )
        self.run_started = recovery is not None
        if recovery is None:
            self.started_at = dt_util.utcnow().isoformat()
            self.provenance = dispatch_control._run_provenance(self.call)
            self.checkpoint = RecoveryCheckpoint.parse({})
            self.run = Run()
        else:
            assert recovery.checkpoint is not None
            self.started_at = str(recovery.started_at)
            self.provenance = recovery.provenance
            self.checkpoint = recovery.checkpoint
            self.run = Run.from_checkpoint(self.checkpoint)
        self.outer_command = dispatch_control._guard_native_commands(
            self.managed_user_command,
            manager,
            self.serial_number,
            self.robot.session_identity,
            lambda: self.native_identity,
            allow_ended_dock=True,
        )

    def started(self) -> dict[str, Any]:
        """Name the run as it began, for plan_started and plan_finished."""
        return {
            "plan_id": self.call.data["plan_id"],
            "run_id": self.run_id,
            "trigger": self.provenance,
            "provenance": self.provenance,
            "service": str(self.call.service),
            "started_at": self.started_at,
            "room_count": len(self.rooms),
            **(
                {"missing_rooms": list(self.missing_rooms)}
                if self.missing_rooms
                else {}
            ),
        }

    async def advance(self, event: RunEvent) -> CheckpointWrite:
        """Move the run and apply its write to the durable checkpoint."""
        self.run, write = transition(self.run, event)
        self.checkpoint = write.applied(self.checkpoint)
        if write.save:
            await self.manager.recovery.async_set_recovery_checkpoint(
                self.serial_number, self.run_id, self.checkpoint.stored()
            )
        return write

    async def save_dispatch(self, dispatch: _PreparedRoomDispatch) -> None:
        await self.advance(
            DispatchRecorded(
                dispatch.dispatched_at,
                dispatch.completion_deadline,
                dispatch.native_identity,
                dispatch.history_baseline,
                dispatch.session_hash,
            )
        )
        if self.on_started is not None:
            self.on_started(self.run_id)

    def bind_native_identity(self, identity: bytes | None) -> None:
        self.native_identity = identity

    def record_room_completed(self, _room: CleaningRoom) -> None:
        counted = self.manager.recovery.counted_room_ids(
            self.serial_number, self.run_id
        )
        self.run = transition(self.run, RoomVerified(counted))[0]

    def raise_if_cancelled(self) -> None:
        if self.cancel_event.is_set() or not (
            self.manager.control.managed_motion_is_current(
                self.serial_number, self.motion_token
            )
        ):
            raise PlanCancelledError

    def validate_new_run(self) -> None:
        if self.recovery is None and self.validate_prepared_run is not None:
            self.validate_prepared_run()

    async def async_start(self) -> None:
        """Wait out a stop fence, plan the legs and record a new run's start."""
        # Publish ownership before the first suspending check. Otherwise
        # Stop can observe no run while this start waits for an old stop
        # fence to clear, and prepare_run would erase its cancellation.
        await dispatch_control._ensure_stop_settled(
            self.hass,
            self.manager,
            self.serial_number,
            self.entity_id,
            self.robot.active_session,
            self.robot.fresh_state,
        )
        self.validate_new_run()
        checkpoint = self.checkpoint
        if checkpoint.stop_intent == "after_room":
            self.finish_room_event.set()
        recovered = self.recovery is not None
        entries = checkpoint.entries if recovered else run_entries(self.entries)
        self.legs = plan_legs(
            self.rooms,
            entries,
            # A Smart Stop run 0.5 started ran each room as its own mission;
            # a recovered one keeps that grouping.
            single_room_missions=recovered and checkpoint.single_room_missions,
        )
        if not recovered:
            self.run_started = True
            await self.async_announce_start()
        if self.mapped_room_names:
            mapped_keys = [native_room_key(name) for name in self.mapped_room_names]
            ambiguous = [
                room.name
                for room in self.rooms
                if mapped_keys.count(native_room_key(room.name)) != 1
            ]
            if ambiguous:
                # Admission and completion must use the same identity key.
                raise managed_run.validation_error(
                    "Managed completion cannot distinguish duplicate mapped room names",
                    "ambiguous_room_name",
                    {"room": ", ".join(ambiguous)},
                )
        if not recovered:
            await self.async_save_first_checkpoint(entries)
        self.validate_new_run()

    async def async_announce_start(self) -> None:
        """Begin the run's ledger record and fire plan_started and room_held."""
        await self.manager.ledger.async_begin_run(
            self.serial_number,
            self.call.data["plan_id"],
            self.run_id,
            len(self.rooms),
            trigger=self.provenance,
            service=str(self.call.service),
            provenance=self.provenance,
            finish_current_room=self.finish_current_room,
            finish_current_room_threshold=self.finish_current_room_threshold,
            held_rooms=self.held_rooms,
        )
        bus, context = self.hass.bus, self.call.context
        bus.async_fire(
            EVENT_PLAN_STARTED,
            {ATTR_ENTITY_ID: self.entity_id, **self.started()},
            context=context,
        )
        for held in self.held_rooms:
            bus.async_fire(
                f"{DOMAIN}_room_held",
                {
                    ATTR_ENTITY_ID: self.entity_id,
                    "plan_id": self.call.data["plan_id"],
                    "room_id": held["room_id"],
                    "room": held["name"],
                    "run_id": self.run_id,
                    "provenance": self.provenance,
                    "reason_code": held["reason"],
                    "sensor": held["sensor"],
                },
                context=context,
            )

    async def async_save_first_checkpoint(
        self, entries: list[dict[str, str]] | None
    ) -> None:
        """Store what restart recovery needs to resume a new run."""
        checkpoint = {
            "version": 1,
            "mixed_settings": True,
            # A Smart Stop now ends the mission after its current room
            # through the robot's queue, so rooms share missions.
            "single_room_missions": False,
            "entity_id": self.entity_id,
            "floor_token": self.floor_token,
            "rooms": [asdict(room) for room in self.rooms],
            "data": dict(self.call.data),
            **self.run.position(),
            "finish_current_room": self.finish_current_room,
            "finish_current_room_threshold": self.finish_current_room_threshold,
        }
        if entries is not None:
            checkpoint["entries"] = entries
        if self.cadence_by_room is not None:
            checkpoint["cadence_by_room"] = deepcopy(
                {key: dict(value) for key, value in self.cadence_by_room.items()}
            )
        self.checkpoint = RecoveryCheckpoint.parse(checkpoint)
        await self.manager.recovery.async_set_recovery_checkpoint(
            self.serial_number, self.run_id, checkpoint
        )

    async def async_run_legs(self) -> None:
        """Run each remaining leg until one is left unsettled or a stop ends it."""
        for index, leg in enumerate(self.legs):
            if index < self.run.leg_index:
                continue
            self.raise_if_cancelled()
            handoff = _Handoff(self.recovered_dispatch)
            self.recovered_dispatch = None
            if index > 0 and handoff.dispatch is None:
                settled_handoff = await self.async_hand_off(index, leg)
                if settled_handoff is None:
                    break
                handoff = settled_handoff
            if handoff.dispatch is None:
                await self.advance(LegDispatching(index))
            settled = await self.async_run_leg(index, leg, handoff)
            self.expected_identity = None
            if not settled:
                break
            self.raise_if_cancelled()
            if self.finish_room_event.is_set():
                break
            if index + 1 < len(self.legs):
                # The verified leg is complete, but the native task may still
                # be returning. Persist the next leg before the bounded handoff
                # wait so restart recovery can resume the queue instead of
                # treating the prior verifying leg as the only recoverable work.
                revision = await self.robot.handoff_revision()
                handoff_keys = await self.robot.history_keys(
                    handoff=True, session_hash=self.checkpoint.session_hash
                )
                await self.advance(LegVerified(index + 1, handoff_keys, revision))

    async def async_hand_off(self, index: int, leg: PlanLeg) -> _Handoff | None:
        """Carry the run from the ended leg into this one, or None to stop.

        A room leg starts while the robot returns when it can; otherwise
        the robot must settle before the next dispatch.
        """
        handoff_history = self.checkpoint.handoff_history
        if handoff_history is None:
            # No durable evidence boundary means we cannot prove that an
            # intervening native mission did not complete.
            return None
        history = frozenset(handoff_history)
        revision = self.checkpoint.handoff_revision
        await self.advance(HandoffEntered(index))
        if self.finish_room_event.is_set():
            return None
        refused_on_return = False
        if isinstance(leg, list):

            async def dispatch(
                on_identity: Callable[[bytes | None], None],
            ) -> _PreparedRoomDispatch:
                await self.advance(LegDispatching(index))
                return await dispatch_control._async_dispatch_leg_command(
                    self.robot,
                    leg,
                    self.motion_token,
                    floor_token=self.floor_token,
                    floor_is_current=self.floor_is_current,
                    on_dispatch=lambda: self.bind_native_identity(None),
                    on_claim=lambda session_id: (
                        self.manager.ledger.async_claim_native_session(
                            self.serial_number, session_id, run_id=self.run_id
                        )
                    ),
                    on_identity=on_identity,
                    expected_dispatch_identity=b"",
                    expected_dispatch_history=history,
                    expected_dispatch_revision=revision,
                )

            async def back_to_handoff() -> None:
                nonlocal refused_on_return
                refused_on_return = True
                await self.advance(HandoffEntered(index))

            prepared = await leg_handoff.async_dispatch_on_return(
                self.robot,
                dispatch,
                self.bind_native_identity,
                back_to_handoff,
                partial(
                    dispatch_control._async_cleanup_managed_motion,
                    self.outer_command,
                    self.motion_token,
                    dispatch_attempted=True,
                ),
                partial(
                    dispatch_control._shutdown_suspends_run,
                    self.hass,
                    self.manager,
                    self.serial_number,
                ),
            )
            if prepared is not None:
                return _Handoff(prepared, history, revision)
        if not await observation._async_wait_for_settled_leg_handoff(
            self.robot,
            self.cancel_event,
            expected_identity=self.native_identity,
            # A refused command whose session shows up late is the robot
            # taking it after all: never send it twice.
            reject_new_identity=refused_on_return,
            finish_room_event=self.finish_room_event,
        ):
            # The previous native leg is complete, but the robot never reached
            # a safe handoff state. Leave the remaining settings legs
            # unattempted; issuing STOP here would restart the OEM stop
            # countdown we just waited out.
            return None
        # The settled handoff establishes an empty ownership boundary, which
        # dispatch rechecks so a new external mission is never adopted as our
        # baseline. Firmware can retain the completed mission identity while
        # a blocked doorway leaves it returning or idle, so that identity stays
        # the dispatch fence: dispatch accepts it or its clearing.
        self.expected_identity = self.native_identity or b""
        self.native_identity = b""
        if revision is None:
            revision = await self.robot.handoff_revision()
            self.checkpoint = CheckpointWrite(
                {"handoff_revision": revision}, save=False
            ).applied(self.checkpoint)
        if self.finish_room_event.is_set():
            # Honor a graceful finish request before dispatching a new
            # settings-boundary leg.
            return None
        return _Handoff(None, history, revision)

    async def async_run_leg(self, index: int, leg: PlanLeg, handoff: _Handoff) -> bool:
        """Run one area or room leg and report whether it settled."""
        if isinstance(leg, AreaLeg):
            settled = await area_execution._async_run_area_leg(
                self.hass,
                self.call,
                self.manager,
                self.entity_id,
                self.serial_number,
                leg,
                self.robot,
                self.cancel_event,
                self.motion_token,
                self.managed_user_command,
                prepared_dispatch=handoff.dispatch,
                finish_room_event=self.finish_room_event,
                floor_is_current=self.floor_is_current,
                floor_token=self.floor_token,
                expected_dispatch_identity=self.expected_identity,
                expected_dispatch_history=handoff.history,
                expected_dispatch_revision=handoff.revision,
                on_native_identity=self.bind_native_identity,
                run_id=self.run_id,
                checkpoint_dispatch=self.save_dispatch,
                provenance=self.provenance,
                # Later legs need the area's own record in history.
                settle_history=index + 1 < len(self.legs),
            )
            await self.advance(
                AreaFinished(index, last_leg=index + 1 == len(self.legs))
            )
            return settled
        resumed = (
            self.manager.ledger.active_target(self.serial_number)
            if self.recovery is not None and index == self.run.leg_index
            else None
        )
        return await leg_execution._async_run_leg(
            self.hass,
            self.call,
            self.manager,
            self.entity_id,
            self.serial_number,
            leg,
            self.robot,
            self.motion_token,
            cancel_event=self.cancel_event,
            managed_user_command=self.managed_user_command,
            prepared_dispatch=handoff.dispatch,
            finish_room_event=self.finish_room_event,
            floor_is_current=self.floor_is_current,
            floor_token=self.floor_token,
            expected_dispatch_identity=self.expected_identity,
            expected_dispatch_history=handoff.history,
            expected_dispatch_revision=handoff.revision,
            on_native_identity=self.bind_native_identity,
            run_id=self.run_id,
            record_room_completed=self.record_room_completed,
            checkpoint_dispatch=self.save_dispatch,
            advance=self.advance,
            provenance=self.provenance,
            recovered_suspend_reason=resumed.suspend_reason
            if resumed is not None
            else None,
            recovered_room_id=resumed.room_id if resumed is not None else None,
        )

    async def async_end(self) -> None:
        """Name how the legs ended and send the robot home when it should go."""
        # Every room has a result and every custom area's own mission ended.
        all_settled = self.run.all_settled(
            {room.room_id for room in self.rooms},
            {index for index, leg in enumerate(self.legs) if isinstance(leg, AreaLeg)},
        )
        smart_stopped = self.finish_room_event.is_set() and not all_settled
        if smart_stopped:
            self.ending = ("cancelled", "managed_stop", "managed_cancellation")
            self.manager.control.mark_managed_stop(self.serial_number)
        elif all_settled:
            self.ending = ("completed", self.run.end_reason, "verified_completion")
        else:
            self.ending = ("unverified", "partial_native_result", "native_result")
        self.raise_if_cancelled()
        current = self.robot.observed()
        home_or_returning = observation.HOME | {RobotActivity.RETURNING}
        if (
            not (self.call.data["return_to_base"] or self.finish_room_event.is_set())
            or current is None
            or self.outer_command is None
            or dispatch_control._stop_is_pending(self.manager, self.serial_number)
            or (current.activity in home_or_returning and not smart_stopped)
        ):
            return
        try:
            if current.activity not in home_or_returning:
                await self.outer_command(self.motion_token, UserCommand.DOCK)
            if smart_stopped:
                dispatch_control._schedule_run_dock_confirmation(
                    self.hass,
                    self.manager,
                    self.robot,
                    self.serial_number,
                    self.entity_id,
                    self.run_id,
                    self.call.context,
                )
                self.dock_confirmation_scheduled = True
        except ManagedMotionReplacedError as err:
            raise PlanCancelledError from err
        except MaticError as err:
            raise managed_run.validation_error(
                "The robot could not return to its dock", "robot_command_failed"
            ) from err

    def cancelled(self, err: PlanCancelledError) -> None:
        """Attribute a cancelled run, or keep it for restart on shutdown."""
        manager, serial_number = self.manager, self.serial_number
        if dispatch_control._shutdown_suspends_run(self.hass, manager, serial_number):
            self.shutdown_suspended = True
            return
        reason = manager.control.cancellation_reason(serial_number)
        if reason == "config_entry_unload":
            self.ending = ("unverified", "config_entry_unload", "home_assistant")
        elif reason == "motion_replaced" or isinstance(
            err.__cause__, ManagedMotionReplacedError
        ):
            self.ending = ("cancelled", "managed_replaced", "replacement")
        elif reason == "managed_stop":
            self.ending = ("cancelled", "managed_stop", "managed_cancellation")
        elif "low_charge" in (
            getattr(err, "suspend_reason", None),
            dispatch_control._suspended_run_reason(manager, serial_number),
        ):
            self.ending = ("recharge_suspended", "low_charge", "robot")
        else:
            self.ending = ("unverified", "cancellation_unattributed", "unknown")

    async def async_failed(self, err: BaseException) -> bool:
        """Attribute a failed run and return whether the error propagates."""
        if dispatch_control._shutdown_suspends_run(
            self.hass, self.manager, self.serial_number
        ):
            self.shutdown_suspended = True
            return True
        # A native task that ends in place is positive evidence that the room
        # was stopped, but it does not identify who or what stopped it. Keep
        # the no-credit guard from the room handler while treating this
        # expected partial plan outcome as a controlled result, so a presence
        # automation does not turn a valid stop into a generic service error.
        if isinstance(err, RoomStoppedInPlaceError) or isinstance(
            err.__cause__, RoomStoppedInPlaceError
        ):
            self.ending = ("unverified", "stopped_in_place", "unknown")
            return False
        leaf_error = (
            err.__cause__
            if isinstance(err, ServiceValidationError) and err.__cause__ is not None
            else err
        )
        if getattr(leaf_error, "suspend_reason", None) == "low_charge":
            self.ending = ("recharge_suspended", "low_charge", "robot")
        elif isinstance(leaf_error, RoomTakenOverError):
            self.ending = ("unverified", "native_task_taken_over", "unknown")
        elif isinstance(leaf_error, RoomInterruptedError):
            reason_code = managed_run._interruption_reason_code(leaf_error)
            self.ending = ("unverified", reason_code, "unknown")
        else:
            self.ending = (
                "failed",
                managed_run._failure_reason_code(err),
                "unknown"
                if isinstance(err, HomeAssistantError | MaticError | TimeoutError)
                else "internal",
            )
            self.finish_room_event.clear()
            await self.async_record_aborted(err)
        return True

    async def async_record_aborted(self, err: BaseException) -> None:
        """Close the room an unexpected failure left running, and stop the robot.

        Leaf handlers retire expected failures; this leaves a terminal record
        before ownership is released.
        """
        manager, serial_number = self.manager, self.serial_number
        active = manager.ledger.active_target(serial_number)
        if active is None:
            return
        room = next(
            (room for room in self.rooms if room.room_id == active.room_id), None
        )
        if (
            room is None
            or active.plan_id != self.call.data["plan_id"]
            or not manager.control.managed_motion_is_current(
                serial_number, self.motion_token
            )
        ):
            return
        reason = f"Managed cleaning aborted ({type(err).__name__})"
        _LOGGER.error(reason)
        await manager.ledger.async_mark_interrupted(
            serial_number, self.call.data["plan_id"], room, reason
        )
        leg_execution.fire_room_event(
            self.hass,
            self.call,
            self.entity_id,
            room,
            "interrupted",
            run_id=self.run_id,
            provenance=self.provenance,
            error=reason,
            reason_code="unexpected_exception",
            cause="internal",
        )
        session_ended = False
        current = self.robot.observed()
        if current is not None and current.activity in observation.HOME | {
            RobotActivity.READY,
            RobotActivity.RETURNING,
        }:
            try:
                session_ended = (
                    await observation._async_active_session_state(
                        self.robot.active_session
                    )
                ) is False
            except (Exception, asyncio.CancelledError) as cleanup_error:
                _LOGGER.warning(
                    "Unable to confirm aborted native session ended (%s)",
                    type(cleanup_error).__name__,
                )
        # Returning is already a firmware-owned terminal motion state. Sending
        # STOP here can replace a natural handoff with the OEM ten-minute stop
        # countdown, leaving later settings legs unattempted. Only stop when
        # the robot is not already on its way home.
        if (
            not session_ended
            and (
                current is None
                or current.activity is not RobotActivity.RETURNING
                or current.low_charge
            )
            and managed_run._coverage_guard_cause(err) is None
            and not dispatch_control._managed_stop_fence_owned_by_run(
                manager, serial_number, self.run_id
            )
        ):
            await dispatch_control._async_cleanup_managed_motion(
                self.outer_command, self.motion_token, dispatch_attempted=True
            )

    async def async_close(self) -> None:
        """Record the run's end and release what it held on the robot."""
        control = self.manager.control
        try:
            # Cancellation during HA shutdown is not a robot outcome.
            # Explicit unload/stop and genuine failures still finalize.
            if self.run_started and not self.shutdown_suspended:
                await async_finish_plan_run(
                    self.hass,
                    self.manager,
                    self.serial_number,
                    self.entity_id,
                    self.started(),
                    *self.ending,
                    len(self.run.completed_room_ids),
                    context=self.call.context,
                )
        finally:
            control.end_managed_motion(self.serial_number, self.motion_token)
            # The recovery wrapper still needs the lifecycle reason to preserve
            # this checkpoint when HA itself is not stopping. It unregisters
            # the same task after observing suspension.
            if self.recovery is None or not self.shutdown_suspended:
                control.unregister_run_task(self.serial_number)
            if not self.dock_confirmation_scheduled and not (
                control.defer_activity_scope_cleanup(
                    self.serial_number,
                    self.run_id,
                    self.robot.set_activity_run_id,
                    self.robot.get_activity_run_id,
                )
            ):
                self.robot.set_activity_run_id(None)


# The fields of a stored run's end that plan_finished reports as stored.
_STORED_END = (
    "ended_at",
    "outcome",
    "reason_code",
    "cause",
    "terminal_activity",
    "completed_room_count",
)


async def async_finish_plan_run(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str | None,
    started: Mapping[str, Any],
    outcome: str,
    reason_code: str,
    cause: str,
    completed_room_count: int,
    *,
    context: Context | None = None,
) -> None:
    """End a run, new or restarted, and announce it as ``plan_finished``.

    ``started`` names the run as it began: plan_id, run_id, trigger,
    provenance, service, started_at and room_count. The event reports the
    stored end once the ledger has recorded it, and is fired even when that
    record fails.
    """
    state = hass.states.get(entity_id) if entity_id else None
    terminal_activity = state.state if state is not None else "unknown"
    end: dict[str, Any] = {
        "ended_at": dt_util.utcnow().isoformat(),
        "outcome": outcome,
        "reason_code": reason_code,
        "cause": cause,
        "terminal_activity": terminal_activity,
        "completed_room_count": completed_room_count,
    }
    # A dock closure seen once the end is stored waits for plan_finished.
    manager.control.run_ending(serial_number, started["run_id"])
    try:
        await manager.ledger.async_finish_run(
            serial_number,
            started["run_id"],
            outcome,
            reason_code,
            completed_room_count,
            terminal_activity=terminal_activity,
            cause=cause,
            entity_id=entity_id,
            context=context,
        )
        run = manager.repository.run_record(serial_number, started["run_id"])
        if run is not None:
            stored = run.published()
            end.update({key: stored[key] for key in _STORED_END if key in stored})
    finally:
        try:
            # Room events queue on the bus first; yield so plan_finished
            # follows the room boundary it summarizes.
            await asyncio.sleep(0)
        finally:
            # Fired and released even when a second cancel lands on the yield,
            # so a waiting dock closure always follows plan_finished.
            hass.bus.async_fire(
                EVENT_PLAN_FINISHED,
                {ATTR_ENTITY_ID: entity_id, **started, **end},
                context=context,
            )
            manager.control.run_ended(serial_number, started["run_id"])


async def _async_execute_rooms(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    rooms: list[CleaningRoom],
    *,
    robot: RobotPort,
    floor_token: str,
    cadence_by_room: Mapping[str, Mapping[str, Any]] | None = None,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None = None,
    mapped_room_names: tuple[str, ...] = (),
    floor_is_current: Callable[[], bool] | None = None,
    recovery: LastRun | None = None,
    recovered_dispatch: _PreparedRoomDispatch | None = None,
    handoff_expected_identity: bytes | None = None,
    validate_prepared_run: Callable[[], None] | None = None,
    entries: Sequence[Mapping[str, Any]] | None = None,
    held_rooms: Sequence[Mapping[str, str]] = (),
    missing_rooms: Sequence[Mapping[str, str | None]] = (),
    on_started: Callable[[str], None] | None = None,
) -> str:
    """Reserve queued cadence, execute every room and custom area, return the run_id.

    ``entries`` is the preview's run order when the plan has a custom area;
    a recovered run reads it from its checkpoint instead. ``on_started``
    receives the run_id once the first command is recorded as sent.
    """
    control = manager.control
    control.require_command_admission(serial_number)
    lock = control.lock(serial_number)
    if recovery is None and manager.recovery.recovery_run(serial_number) is not None:
        raise managed_run.validation_error(
            "A managed Matic plan is reconnecting", "plan_already_running"
        )
    if lock.locked():
        raise managed_run.validation_error(
            "A managed Matic cleaning plan is already running", "plan_already_running"
        )
    run_id = recovery.run_id if recovery else uuid4().hex
    saved = recovery.checkpoint if recovery else None
    manager.cadence.reserve_prepared_run(
        serial_number,
        str(call.data["plan_id"]),
        run_id,
        (room.room_id for room in rooms),
        cadence_by_room,
        finish_current_room=saved.finish_current_room if saved else None,
        finish_current_room_threshold=(
            saved.finish_current_room_threshold if saved else None
        ),
    )
    try:
        async with lock:
            control.require_command_admission(serial_number)
            control.register_run_task(serial_number)
            cancel_event = control.prepare_run(serial_number)
            execution = _PlanRun(
                hass=hass,
                call=call,
                manager=manager,
                entity_id=entity_id,
                serial_number=serial_number,
                rooms=rooms,
                robot=robot,
                floor_token=floor_token,
                run_id=run_id,
                recovery=recovery,
                cadence_by_room=cadence_by_room,
                managed_user_command=managed_user_command,
                mapped_room_names=mapped_room_names,
                floor_is_current=floor_is_current,
                validate_prepared_run=validate_prepared_run,
                entries=entries,
                held_rooms=held_rooms,
                missing_rooms=missing_rooms,
                on_started=on_started,
                recovered_dispatch=recovered_dispatch,
                cancel_event=cancel_event,
                motion_token=control.begin_managed_motion(serial_number),
                native_identity=handoff_expected_identity,
                expected_identity=handoff_expected_identity,
            )
            robot.set_activity_run_id(run_id)
            try:
                await execution.async_start()
                await execution.async_run_legs()
                await execution.async_end()
            except PlanCancelledError as err:
                execution.cancelled(err)
            except (Exception, asyncio.CancelledError) as err:
                if await execution.async_failed(err):
                    raise
            finally:
                await execution.async_close()
    finally:
        manager.cadence.release_prepared_run(serial_number, run_id)
    return run_id
