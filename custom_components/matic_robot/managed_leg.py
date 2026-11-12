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
from dataclasses import replace
from datetime import datetime, timedelta
from functools import partial
from typing import Any, Literal

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from . import managed_dispatch as dispatch_control
from . import managed_observation as observation
from . import managed_reconciliation as history_reconciliation
from . import managed_run
from .client.commands import UserCommand
from .client.exceptions import CoverageGuardError, MaticError
from .client.models import RobotActivity
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
from .run_control import ManagedMotionReplacedError
from .run_machine import CheckpointWrite, LegVerifying, RunEvent

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
) -> bool:
    """Run one leg and report whether every room in it settled.

    A room settles when the robot's history credits it, the owner skipped
    it, or the history shows the robot could not reach it.
    """
    leg = list(rooms)
    single = len(leg) == 1
    plan_id = call.data["plan_id"]
    announce = partial(
        fire_room_event,
        hass,
        call,
        entity_id,
        run_id=run_id,
        provenance=provenance
        if provenance is not None
        else dispatch_control._run_provenance(call),
    )
    active_room = next(
        (room for room in leg if room.room_id == recovered_room_id), leg[0]
    )
    observed_ids = {active_room.room_id}
    room_observer: observation._LegOutcomeObserver | None = None
    if await manager.ledger.async_mark_started(
        serial_number, plan_id, active_room, run_id=run_id
    ):
        announce(active_room, "started")
    dispatch_attempted = False
    room_started = False
    stop_sent = False
    # The room the robot finishes before ending the mission on a Smart Stop.
    last_room: CleaningRoom | None = None
    finish_task: asyncio.Task[None] | None = None
    # Room id to the robot's (ended_at, duration_seconds) for its credit.
    credited: dict[str, tuple[str | None, int | None]] = {}
    unreachable: set[str] = set()
    completion_sessions: list[str] = []
    dispatch = prepared_dispatch
    history_baseline: frozenset[bytes] | None = None
    dispatched_at: datetime | None = None
    native_identity: bytes | None = None
    managed_user_command = dispatch_control._guard_native_commands(
        managed_user_command,
        manager,
        serial_number,
        robot.session_identity,
        lambda: native_identity,
    )

    def mark_dispatch_attempted() -> None:
        nonlocal dispatch_attempted
        dispatch_attempted = True
        bind_native_identity(None)

    def bind_native_identity(identity: bytes | None) -> None:
        nonlocal native_identity
        native_identity = identity
        if on_native_identity is not None:
            on_native_identity(identity)

    def end_after(room: CleaningRoom) -> None:
        nonlocal last_room
        last_room = room

    def skipped_room_ids() -> Collection[str]:
        if run_id is None:
            return ()
        return manager.ledger.skipped_room_ids(serial_number, run_id)

    def late_marker(credited_ids: Collection[str] = ()) -> Any:
        """Return what a late history record settles this leg's rooms by."""
        if single:
            return history_reconciliation._build_native_reconciliation(
                plan_id, leg[0], dispatched_at, room_started, run_id=run_id
            )
        skipped = skipped_room_ids()
        return build_grouped_native_reconciliation(
            plan_id,
            [
                {
                    "room_id": room.room_id,
                    "room": room.name,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                }
                for room in leg
                if room.room_id in observed_ids
                and room.room_id not in credited_ids
                and room.room_id not in skipped
            ],
            dispatched_at if room_observer is not None else None,
            native_identity,
            floor_token,
            run_id,
        )

    def stored_marker(marker: Any) -> dict[str, Any]:
        """Return the ledger's keyword for ``marker``, none when there is none."""
        if single:
            marker = history_reconciliation._native_reconciliation_data(marker)
        return {} if marker is None else {"native_reconciliation": marker}

    def watch_late_history(marker: Any) -> None:
        if single:
            history_reconciliation._schedule_native_reconciliation(
                hass,
                manager,
                serial_number,
                entity_id,
                leg[0],
                marker,
                history_baseline,
                robot,
                call.context,
            )
        elif marker is not None:
            history_reconciliation._schedule_grouped_native_reconciliation(
                hass, manager, serial_number, entity_id, marker, robot
            )

    async def async_record_ended(
        mark: Callable[..., Awaitable[None]], reason: str, marker: Any
    ) -> None:
        """Record the active room's end with the marker while the run owns it."""
        async with dispatch_control._managed_reconciliation_guard(
            manager, serial_number, motion_token
        ) as owned:
            if not owned:
                marker = None
            await mark(
                serial_number, plan_id, active_room, reason, **stored_marker(marker)
            )
            if not dispatch_control._managed_reconciliation_is_current(
                manager, serial_number, motion_token
            ):
                marker = None
            watch_late_history(marker)

    def withheld_room_ids() -> set[str]:
        """Return the rooms the run kept the robot from, with the owner's skips."""
        withheld = set(skipped_room_ids())
        if stop_sent or last_room is not None:
            withheld |= {room.room_id for room in leg} - observed_ids
        return withheld

    async def async_verify_end(*, mission_ended: bool = False) -> bool:
        """Read the ended mission's history; return whether it gave a verdict."""
        assert dispatched_at is not None
        write = await advance(
            LegVerifying(
                dt_util.utcnow()
                + timedelta(seconds=observation.SESSION_HISTORY_TIMEOUT_SECONDS)
            )
        )
        await manager.ledger.async_mark_verifying(
            serial_number, plan_id, active_room, checkpoint=write
        )
        if not single:
            credited.update(
                await observation._async_verify_leg_completion(
                    robot.session_history,
                    history_baseline,
                    leg,
                    dispatched_at,
                    robot=robot,
                    cancel_event=cancel_event,
                    allow_active_cleaning=mission_ended,
                    on_verified_session=completion_sessions.append,
                    skipped_room_ids=withheld_room_ids(),
                    on_unreached=unreachable.add,
                )
                or {}
            )
            return bool(credited or unreachable)
        evidence: list[tuple[str, int]] = []
        verdict = await observation._async_adjudicate_room_end(
            robot.session_history,
            history_baseline,
            leg[0],
            dispatched_at,
            robot=robot,
            cancel_event=cancel_event,
            allow_active_cleaning=mission_ended,
            on_verified_session=completion_sessions.append,
            on_verified_completion=lambda ended_at, duration: evidence.append(
                (ended_at, duration)
            ),
        )
        if verdict is observation.NativeRoomVerdict.COMPLETED:
            credited[leg[0].room_id] = evidence[-1] if evidence else (None, None)
        if verdict is observation.NativeRoomVerdict.UNREACHABLE:
            unreachable.add(leg[0].room_id)
        return verdict is not observation.NativeRoomVerdict.UNVERIFIED

    async def async_next_outcome() -> tuple[RoomRunOutcome, CleaningRoom | None]:
        """Wait for the leg's next outcome while the run still owns its task."""
        if room_observer is not None:
            return await observation._async_wait_with_native_identity(
                partial(room_observer.next, cancel_event),
                robot.session_identity,
                native_identity,
            )
        outcome = await observation._async_wait_with_native_identity(
            # Owned start already observed this room. Preserve that evidence
            # across transient cleaning during dock travel.
            lambda: observation._async_wait_for_room_outcome(
                robot, leg[0], cancel_event, initial_observed=True
            ),
            robot.session_identity,
            native_identity,
        )
        return outcome, None

    async def async_wait_for_resume(seconds: float) -> None:
        if room_observer is None:
            await observation._async_wait_for_owned_resume(
                robot, seconds, cancel_event, leg, native_identity
            )
            return
        await observation._async_wait_for_owned_resume(
            robot,
            seconds,
            cancel_event,
            leg,
            native_identity,
            resume_event=room_observer.resume_event,
        )
        room_observer.resume_after_initial_pause()

    async def resumed_after_return() -> bool:
        return await observation._async_wait_for_active_session_resolution(
            robot, cancel_event, expected_identity=native_identity
        )

    async def persist_room_start(changed_room: CleaningRoom) -> None:
        nonlocal active_room, stop_sent

        async def confirm_ownership() -> None:
            return None

        await observation._async_wait_with_native_identity(
            confirm_ownership, robot.session_identity, native_identity
        )
        if (
            finish_room_event is not None
            and finish_room_event.is_set()
            and not stop_sent
            and (last_room is None or changed_room.room_id != last_room.room_id)
        ):
            # The robot kept the next room: the queue change failed or came
            # too late. Honor the finish request at this boundary.
            await dispatch_control._async_cleanup_managed_motion(
                managed_user_command, motion_token, dispatch_attempted=True
            )
            stop_sent = True
        first_observation = changed_room.room_id not in observed_ids
        observed_ids.add(changed_room.room_id)
        # A robot can revisit a room within the same native mission. Keep the
        # active room current even though its start event is deduped.
        first_start = await manager.ledger.async_mark_started(
            serial_number, plan_id, changed_room, run_id=run_id
        )
        if first_observation and first_start:
            announce(changed_room, "started")
        active_room = changed_room
        await manager.ledger.async_mark_resumed(serial_number, plan_id, active_room)

    try:
        if dispatch is None:
            dispatch = await dispatch_control._async_dispatch_leg_command(
                robot,
                leg,
                motion_token,
                floor_token=floor_token,
                floor_is_current=floor_is_current,
                on_dispatch=mark_dispatch_attempted,
                on_claim=lambda session_id: manager.ledger.async_claim_native_session(
                    serial_number, session_id, run_id=run_id
                ),
                on_identity=bind_native_identity,
                expected_dispatch_identity=expected_dispatch_identity,
                expected_dispatch_history=expected_dispatch_history,
            )
        else:
            if dispatch.rooms != tuple(leg):
                raise ValueError("prepared leg dispatch does not match the leg")
            dispatch_attempted = True
            bind_native_identity(dispatch.native_identity)
        history_baseline = dispatch.history_baseline
        dispatched_at = dispatch.dispatched_at
        await checkpoint_dispatch(dispatch)
        try:
            start_state = await observation._async_wait_for_owned_start(
                robot,
                call.data["start_timeout"],
                cancel_event,
                leg,
                bind_native_identity,
                dispatch.native_identity_baseline,
                native_identity,
                already_accepted=dispatch.recovered,
            )
        except TimeoutError as err:
            raise RoomStartTimeoutError from err
        except NativeTaskEndedError:
            # The mission this run owns ended before its room was observed.
            # Only native history can say why; robot state may still lag.
            if not await async_verify_end(mission_ended=True):
                raise
        else:
            suspended = start_state is RobotActivity.PAUSED or (
                recovered_suspend_reason in _SUSPENDED
            )
            if not single:
                room_observer = observation._LegOutcomeObserver(
                    robot,
                    leg,
                    active_room,
                    initial_observed=True,
                    classify_current=True,
                    suppress_pause=suspended,
                    initial_suspended=recovered_suspend_reason in _SUSPENDED,
                )
                if finish_room_event is not None:
                    finish_task = asyncio.create_task(
                        async_end_after_current_room(
                            robot,
                            finish_room_event,
                            floor_token,
                            lambda: native_identity,
                            lambda: active_room,
                            end_after,
                        )
                    )
            dispatch = replace(dispatch, native_identity=native_identity)
            await checkpoint_dispatch(dispatch)
            if suspended:
                await manager.ledger.async_mark_suspended(
                    serial_number,
                    plan_id,
                    active_room,
                    recovered_suspend_reason or "paused",
                )
                await async_wait_for_resume(
                    managed_run._remaining_completion_time(
                        dispatch, call.data["completion_timeout"]
                    )
                )
            await manager.ledger.async_mark_resumed(serial_number, plan_id, active_room)
            room_started = True
            completion_budget = await managed_run._async_completion_budget(
                dispatch, call.data["completion_timeout"], checkpoint_dispatch
            )
            refresh_task = asyncio.create_task(
                observation._async_periodic_refresh(robot.refresh)
            )
            try:
                async with asyncio.timeout(completion_budget) as mission_timeout:
                    while True:
                        outcome, changed_room = await async_next_outcome()
                        if outcome is RoomRunOutcome.ROOM_CHANGED:
                            assert changed_room is not None
                            await persist_room_start(changed_room)
                            continue
                        if outcome is RoomRunOutcome.HANDOFF_CANDIDATE:
                            if await resumed_after_return():
                                await manager.ledger.async_mark_resumed(
                                    serial_number, plan_id, active_room
                                )
                                continue
                            mission_timeout.reschedule(None)
                            await async_verify_end()
                            break
                        if outcome is RoomRunOutcome.STOPPED_IN_PLACE:
                            raise RoomStoppedInPlaceError(
                                f"{active_room.name} ended in place without "
                                "returning; the stop cause is unconfirmed"
                            )
                        if outcome is RoomRunOutcome.INTERRUPTED:
                            raise RoomInterruptedError(
                                f"{active_room.name} stopped without verified "
                                "completion"
                            )
                        await manager.ledger.async_mark_suspended(
                            serial_number,
                            plan_id,
                            active_room,
                            "paused"
                            if outcome is RoomRunOutcome.PAUSED
                            else "low_charge",
                        )
                        await async_wait_for_resume(call.data["completion_timeout"])
                        await manager.ledger.async_mark_resumed(
                            serial_number, plan_id, active_room
                        )
            finally:
                refresh_task.cancel()
                await asyncio.gather(refresh_task, return_exceptions=True)
    except ManagedMotionReplacedError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        await manager.ledger.async_mark_cancelled(serial_number, plan_id, active_room)
        announce(
            active_room,
            "cancelled",
            reason_code="managed_cancelled",
            cause="replacement",
        )
        raise PlanCancelledError from err
    except PlanCancelledError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        err.suspend_reason = dispatch_control._suspended_run_reason(
            manager, serial_number
        )
        cancellation_reason = manager.control.cancellation_reason(serial_number)
        if cancellation_reason == "config_entry_unload":
            await dispatch_control._async_cleanup_managed_motion(
                managed_user_command, motion_token, dispatch_attempted
            )
            reason = "Home Assistant unloaded while cleaning this room"
            if single:
                await async_record_ended(
                    manager.ledger.async_mark_interrupted, reason, late_marker()
                )
            else:
                await manager.ledger.async_mark_interrupted(
                    serial_number, plan_id, active_room, reason
                )
            announce(
                active_room,
                "interrupted",
                reason_code="config_entry_unload",
                cause="home_assistant",
            )
        else:
            await manager.ledger.async_mark_cancelled(
                serial_number, plan_id, active_room
            )
            announce(
                active_room,
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
        raise
    except RoomTakenOverError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        err.suspend_reason = dispatch_control._suspended_run_reason(
            manager, serial_number
        )
        await manager.ledger.async_mark_interrupted(
            serial_number, plan_id, active_room, str(err)
        )
        announce(
            active_room,
            "interrupted",
            error=str(err),
            reason_code="native_task_taken_over",
            cause="unknown",
        )
        raise managed_run._validation_error(
            "The original native cleaning task could no longer be verified",
            "room_taken_over",
            {"room": active_room.name},
        ) from err
    except RoomInterruptedError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        await dispatch_control._async_cleanup_managed_motion(
            managed_user_command, motion_token, dispatch_attempted
        )
        await async_record_ended(
            manager.ledger.async_mark_interrupted,
            str(err),
            None if isinstance(err, RoomStoppedInPlaceError) else late_marker(),
        )
        announce(
            active_room,
            "interrupted",
            error=str(err),
            reason_code=managed_run._interruption_reason_code(err),
            cause="unknown",
        )
        raise managed_run._validation_error(
            str(err), "room_interrupted", {"room": active_room.name}
        ) from err
    except (TimeoutError, HomeAssistantError, MaticError) as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        # A graceful finish request can race a room failure. Clear that intent
        # before sending the failure STOP so its dock watcher cannot upgrade
        # the still-running record and mask the durable failure.
        if finish_room_event is not None:
            finish_room_event.clear()
        # A multi-room leg sends no cleanup STOP while this run's own STOP
        # settles; a one-room leg sends it either way.
        if single or not dispatch_control._managed_stop_fence_owned_by_run(
            manager, serial_number, run_id
        ):
            await dispatch_control._async_cleanup_managed_motion(
                managed_user_command,
                motion_token,
                dispatch_attempted and managed_run._coverage_guard_cause(err) is None,
            )
        if isinstance(err, RoomStartTimeoutError):
            failure_reason = "The robot did not begin cleaning before the start timeout"
        elif isinstance(err, TimeoutError):
            failure_reason = "The managed room exceeded its completion timeout"
        elif isinstance(err, CoverageGuardError):
            failure_reason = err.safe_message
        elif isinstance(err, MaticError):
            failure_reason = "The robot could not complete the managed room"
        else:
            failure_reason = str(err).strip() or "The managed room failed"
        if single:
            await async_record_ended(
                manager.ledger.async_mark_failed, failure_reason, late_marker()
            )
        else:
            await manager.ledger.async_mark_failed(
                serial_number, plan_id, active_room, failure_reason
            )
        announce(
            active_room,
            "failed",
            error=failure_reason,
            reason_code=managed_run._failure_reason_code(err),
            cause="unknown",
        )
        if isinstance(err, ServiceValidationError):
            raise
        if isinstance(err, RoomStartTimeoutError):
            raise managed_run._validation_error(
                f"The robot did not begin cleaning {active_room.name} before the "
                "start timeout",
                "plan_start_timeout",
                {"room": active_room.name},
            ) from err
        if isinstance(err, CoverageGuardError):
            raise managed_run._validation_error(
                err.safe_message, err.reason_code
            ) from err
        if isinstance(err, MaticError):
            raise managed_run._validation_error(
                "The robot could not complete the managed room",
                "robot_command_failed",
                {"room": active_room.name},
            ) from err
        if isinstance(err, TimeoutError):
            raise managed_run._validation_error(
                f"Timed out while cleaning {active_room.name}",
                "plan_timeout",
                {"room": active_room.name},
            ) from err
        raise
    finally:
        if room_observer is not None:
            room_observer.close()
        if finish_task is not None:
            finish_task.cancel()
            await asyncio.gather(finish_task, return_exceptions=True)

    verified_coverage = (
        await async_confirm_completed_coverage(
            manager.recovery.coverage_receipt(serial_number, run_id),
            completion_sessions[-1] if completion_sessions else None,
            robot.coverage_verifier,
        )
        if credited
        else None
    )
    # A one-room leg reads the owner's skips only when history left it due.
    skipped = (
        skipped_room_ids()
        if len(credited) < len(leg) and not (single and unreachable)
        else ()
    )
    marker = None if single else late_marker(tuple(credited))
    marker_saved = False
    for room in leg:
        if room.room_id in credited:
            completed_at, duration_seconds = credited[room.room_id]
            if not await manager.ledger.async_mark_completed(
                serial_number,
                plan_id,
                room,
                run_id=run_id,
                completed_at=completed_at,
                duration_seconds=duration_seconds,
                verified_coverage_receipt=verified_coverage,
                completion_session_hash=completion_sessions[-1]
                if completion_sessions
                else None,
                completion_is_current=lambda: (
                    (cancel_event is None or not cancel_event.is_set())
                    and manager.control.managed_motion_is_current(
                        serial_number, motion_token
                    )
                    and (floor_is_current is None or floor_is_current())
                ),
            ):
                raise PlanCancelledError(
                    "Run ownership changed before room completion could be credited"
                )
            robot.confirm_room_completed(room.name)
            if record_room_completed is not None:
                record_room_completed(room)
            announce(room, "completed", reason_code="verified_completion")
        elif run_id is not None and room.room_id in skipped:
            # Skipped without credit, but settled, so the run goes on.
            await manager.ledger.async_mark_skipped(
                serial_number, plan_id, room, run_id=run_id
            )
            announce(room, "skipped", reason_code="owner_skipped")
        elif (stop_sent or last_room is not None) and room.room_id not in observed_ids:
            await manager.ledger.async_mark_cancelled(serial_number, plan_id, room)
            announce(
                room,
                "cancelled",
                reason_code="managed_cancelled",
                cause="finish_current_room_or_stop",
            )
        elif room.room_id in unreachable:
            # The robot finished its mission without reaching the room. Settle
            # it without credit so it stays due, and let the run go on.
            await manager.ledger.async_mark_unreachable(
                serial_number, plan_id, room, run_id=run_id
            )
            announce(room, "skipped", reason_code="room_unreachable", cause="robot")
        else:
            if single:
                await manager.ledger.async_mark_ended_unverified(
                    serial_number, plan_id, room
                )
            else:
                async with dispatch_control._managed_reconciliation_guard(
                    manager, serial_number, motion_token
                ) as owned:
                    if not owned or (
                        floor_is_current is not None and not floor_is_current()
                    ):
                        marker = None
                    await manager.ledger.async_mark_ended_unverified(
                        serial_number,
                        plan_id,
                        room,
                        **stored_marker(None if marker_saved else marker),
                    )
                marker_saved = True
            announce(
                room,
                "ended_unverified",
                reason_code="unverified_completion",
                cause="unknown",
            )
    watch_late_history(marker)
    return all(
        room.room_id in credited
        or room.room_id in skipped
        or room.room_id in unreachable
        for room in leg
    )
