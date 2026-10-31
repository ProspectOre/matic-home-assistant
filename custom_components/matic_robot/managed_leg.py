"""Grouped room mission execution and per-room evidence accounting."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import replace
from datetime import timedelta
from functools import partial
from typing import Any

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from . import managed_dispatch as dispatch_control
from . import managed_observation as observation
from . import managed_reconciliation as history_reconciliation
from . import managed_room as room_execution
from . import managed_run
from .client.commands import UserCommand
from .client.coverage_receipts import CoverageVerifier
from .client.exceptions import MaticError
from .client.models import CleaningSessionRecord
from .const import DOMAIN
from .coverage_accounting import (
    async_confirm_completed_coverage,
)
from .grouped_native_reconciliation import build_grouped_native_reconciliation
from .managed_run import (
    LegOutcomeWaiter,
    PlanCancelledError,
    RoomInterruptedError,
    RoomRunOutcome,
    RoomStartTimeoutError,
    RoomStoppedInPlaceError,
    RoomTakenOverError,
    _PreparedRoomDispatch,
)
from .plan_model import (
    CleaningRoom,
)
from .plans import CleaningPlanManager
from .run_control import ManagedMotionReplacedError

_LOGGER = logging.getLogger(__name__)


async def _async_run_leg(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    rooms: Sequence[CleaningRoom],
    cancel_event: asyncio.Event | None = None,
    refresh: Callable[[], Awaitable[None]] | None = None,
    motion_token: int | None = None,
    active_session: Callable[[], Awaitable[bool | None]] | None = None,
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]]
    | None = None,
    confirm_room_completed: Callable[[str], None] | None = None,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None = None,
    room_name_is_unique: bool = True,
    prepared_dispatch: _PreparedRoomDispatch | None = None,
    prefetch_next: Callable[[], Awaitable[_PreparedRoomDispatch | None]] | None = None,
    finish_room_event: asyncio.Event | None = None,
    floor_is_current: Callable[[], bool] | None = None,
    floor_token: str | None = None,
    session_identity: Callable[[], Awaitable[bytes | None]] | None = None,
    on_native_identity: Callable[[bytes | None], None] | None = None,
    run_id: str | None = None,
    record_room_completed: Callable[[CleaningRoom], None] | None = None,
    checkpoint_dispatch: Callable[[_PreparedRoomDispatch], Awaitable[None]]
    | None = None,
    recovered_room_id: str | None = None,
    provenance: str | None = None,
    recovered_suspend_reason: str | None = None,
    expected_dispatch_identity: bytes | None = None,
    expected_dispatch_history: frozenset[str] | None = None,
    wait_for_leg_outcome: LegOutcomeWaiter | None = None,
    coverage_verifier: CoverageVerifier | None = None,
) -> bool:
    """Run one mission leg and credit only natively verified rooms.

    A leg is one native multi-room mission, so the robot glides room to room
    without docking.  Rotation credit still comes only from the leg's single
    native history record: each verified room is credited with the robot's
    own per-room duration, and everything else stays due.
    """
    resolve_session = observation._async_wait_for_active_session_resolution
    leg = list(rooms)
    if len(leg) == 1:
        return await room_execution._async_run_room(
            hass,
            call,
            manager,
            entity_id,
            serial_number,
            leg[0],
            cancel_event,
            refresh,
            motion_token,
            active_session,
            session_history,
            confirm_room_completed,
            managed_user_command,
            room_name_is_unique=room_name_is_unique,
            prepared_dispatch=prepared_dispatch,
            prefetch_next=prefetch_next,
            finish_room_event=finish_room_event,
            floor_is_current=floor_is_current,
            floor_token=floor_token,
            session_identity=session_identity,
            on_native_identity=on_native_identity,
            run_id=run_id,
            record_room_completed=record_room_completed,
            checkpoint_dispatch=checkpoint_dispatch,
            provenance=provenance,
            recovered_suspend_reason=recovered_suspend_reason,
            expected_dispatch_identity=expected_dispatch_identity,
            expected_dispatch_history=expected_dispatch_history,
            coverage_verifier=coverage_verifier,
        )
    if not room_name_is_unique:
        raise managed_run._validation_error(
            "Managed completion cannot distinguish duplicate mapped room names",
            "ambiguous_room_name",
            {"room": ", ".join(room.name for room in leg)},
        )

    def event_data(room: CleaningRoom) -> dict[str, Any]:
        return {
            ATTR_ENTITY_ID: entity_id,
            "plan_id": call.data["plan_id"],
            "room_id": room.room_id,
            "room": room.name,
            "cleaning_mode": room.cleaning_mode,
            "coverage_setting": room.coverage_setting,
            "run_id": run_id,
            "provenance": provenance
            if provenance is not None
            else dispatch_control._run_provenance(call),
        }

    active_room = next(
        (room for room in leg if room.room_id == recovered_room_id), leg[0]
    )
    observed_ids = {active_room.room_id}
    room_observer: observation._LegOutcomeObserver | None = None
    first_start = await manager.ledger.async_mark_started(
        serial_number, call.data["plan_id"], active_room, run_id=run_id
    )
    if first_start:
        hass.bus.async_fire(
            f"{DOMAIN}_room_started", event_data(active_room), context=call.context
        )
    dispatch_attempted = False
    stop_sent = False
    evidence: dict[str, tuple[str, int]] | None = None
    completion_sessions: list[str] = []
    dispatch: _PreparedRoomDispatch | None = prepared_dispatch
    native_identity: bytes | None = None
    managed_user_command = dispatch_control._guard_native_commands(
        managed_user_command,
        manager,
        serial_number,
        session_identity,
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

    def build_reconciliation(
        credited_ids: Sequence[str] = (),
    ) -> dict[str, Any] | None:
        skipped_ids = (
            manager.ledger.skipped_room_ids(serial_number, run_id) if run_id else ()
        )
        return build_grouped_native_reconciliation(
            call.data["plan_id"],
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
                and room.room_id not in skipped_ids
            ],
            (
                dispatch.dispatched_at
                if dispatch is not None and room_observer is not None
                else None
            ),
            native_identity,
            floor_token,
            run_id,
        )

    try:
        if dispatch is None:
            dispatch = await dispatch_control._async_dispatch_leg_command(
                hass,
                call,
                entity_id,
                leg,
                motion_token,
                session_history,
                floor_is_current=floor_is_current,
                floor_token=floor_token,
                on_dispatch=mark_dispatch_attempted,
                session_identity=session_identity,
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
        if checkpoint_dispatch is not None:
            await checkpoint_dispatch(dispatch)
        try:
            start_state = await observation._async_wait_for_owned_start(
                hass,
                entity_id,
                call.data["start_timeout"],
                cancel_event,
                leg,
                session_identity,
                bind_native_identity,
                dispatch.native_identity_baseline,
                native_identity,
                already_accepted=dispatch.recovered,
            )
        except TimeoutError as err:
            raise RoomStartTimeoutError from err
        room_observer = observation._LegOutcomeObserver(
            hass,
            entity_id,
            leg,
            active_room,
            initial_observed=True,
            classify_current=True,
            suppress_pause=(
                start_state == "paused"
                or recovered_suspend_reason in {"paused", "low_charge"}
            ),
            initial_suspended=recovered_suspend_reason in {"paused", "low_charge"},
        )
        dispatch = replace(dispatch, native_identity=native_identity)
        if checkpoint_dispatch is not None:
            await checkpoint_dispatch(dispatch)

        async def persist_room_start(changed_room: CleaningRoom) -> None:
            nonlocal active_room, stop_sent

            async def confirm_ownership() -> None:
                return None

            await observation._async_wait_with_native_identity(
                confirm_ownership, session_identity, native_identity
            )
            if (
                finish_room_event is not None
                and finish_room_event.is_set()
                and not stop_sent
            ):
                # A finish-current-room stop cannot withhold the next room
                # inside one native mission. Honor it at the first boundary.
                await dispatch_control._async_cleanup_managed_motion(
                    managed_user_command,
                    motion_token,
                    dispatch_attempted=True,
                )
                stop_sent = True
            first_observation = changed_room.room_id not in observed_ids
            observed_ids.add(changed_room.room_id)
            if first_observation:
                first_start = await manager.ledger.async_mark_started(
                    serial_number,
                    call.data["plan_id"],
                    changed_room,
                    run_id=run_id,
                )
                if first_start:
                    hass.bus.async_fire(
                        f"{DOMAIN}_room_started",
                        event_data(changed_room),
                        context=call.context,
                    )
            active_room = changed_room
            await manager.ledger.async_mark_resumed(
                serial_number, call.data["plan_id"], active_room
            )

        if start_state == "paused" or recovered_suspend_reason in {
            "paused",
            "low_charge",
        }:
            await manager.ledger.async_mark_suspended(
                serial_number,
                call.data["plan_id"],
                active_room,
                recovered_suspend_reason or "paused",
            )
            await observation._async_wait_for_owned_resume(
                hass,
                entity_id,
                managed_run._remaining_completion_time(
                    dispatch, call.data["completion_timeout"]
                ),
                cancel_event,
                leg,
                session_identity,
                native_identity,
                resume_event=room_observer.resume_event,
            )
            room_observer.resume_after_initial_pause()
        await manager.ledger.async_mark_resumed(
            serial_number, call.data["plan_id"], active_room
        )
        completion_budget = await managed_run._async_completion_budget(
            dispatch, call.data["completion_timeout"], checkpoint_dispatch
        )
        refresh_task = (
            asyncio.create_task(observation._async_periodic_refresh(refresh))
            if refresh is not None
            else None
        )
        try:
            async with asyncio.timeout(completion_budget) as mission_timeout:
                while True:
                    wait_for_outcome: Callable[
                        [], Awaitable[tuple[RoomRunOutcome, CleaningRoom | None]]
                    ]
                    if wait_for_leg_outcome is not None:
                        wait_for_outcome = partial(
                            wait_for_leg_outcome,
                            hass,
                            entity_id,
                            leg,
                            active_room,
                            cancel_event,
                            initial_observed=True,
                        )
                    else:
                        assert room_observer is not None
                        wait_for_outcome = partial(room_observer.next, cancel_event)
                    (
                        outcome,
                        changed_room,
                    ) = await observation._async_wait_with_native_identity(
                        wait_for_outcome,
                        session_identity,
                        native_identity,
                    )
                    if outcome is RoomRunOutcome.ROOM_CHANGED:
                        assert changed_room is not None
                        await persist_room_start(changed_room)
                        continue
                    if outcome is RoomRunOutcome.HANDOFF_CANDIDATE:
                        if active_session is not None or session_identity is not None:
                            session_resolution = await resolve_session(
                                hass,
                                entity_id,
                                active_session,
                                cancel_event,
                                identity_reader=session_identity,
                                expected_identity=native_identity,
                            )
                            if session_resolution is True:
                                await manager.ledger.async_mark_resumed(
                                    serial_number, call.data["plan_id"], active_room
                                )
                                continue
                            if session_resolution is None:
                                raise RoomInterruptedError(
                                    "Native session completion could not be confirmed"
                                )
                        mission_timeout.reschedule(None)
                        await manager.ledger.async_mark_verifying(
                            serial_number,
                            call.data["plan_id"],
                            active_room,
                            verification_deadline=dt_util.utcnow()
                            + timedelta(
                                seconds=observation.SESSION_HISTORY_TIMEOUT_SECONDS
                            ),
                        )
                        evidence = await observation._async_verify_leg_completion(
                            session_history,
                            history_baseline,
                            leg,
                            dispatched_at,
                            hass=hass,
                            entity_id=entity_id,
                            cancel_event=cancel_event,
                            on_verified_session=completion_sessions.append,
                            skipped_room_ids=(
                                manager.ledger.skipped_room_ids(serial_number, run_id)
                                if run_id is not None
                                else ()
                            ),
                        )
                        break
                    if outcome is RoomRunOutcome.STOPPED_IN_PLACE:
                        raise RoomStoppedInPlaceError(
                            f"{active_room.name} ended in place without returning; "
                            "the stop cause is unconfirmed"
                        )
                    # The observer starts with the owned room positively
                    # observed, so terminal states cannot classify as unknown.
                    suspend_reason = (
                        "paused" if outcome is RoomRunOutcome.PAUSED else "low_charge"
                    )
                    await manager.ledger.async_mark_suspended(
                        serial_number,
                        call.data["plan_id"],
                        active_room,
                        suspend_reason,
                    )
                    await observation._async_wait_for_owned_resume(
                        hass,
                        entity_id,
                        call.data["completion_timeout"],
                        cancel_event,
                        leg,
                        session_identity,
                        native_identity,
                        resume_event=(
                            room_observer.resume_event
                            if room_observer is not None
                            else None
                        ),
                    )
                    if room_observer is not None:
                        room_observer.resume_after_initial_pause()
                    await manager.ledger.async_mark_resumed(
                        serial_number, call.data["plan_id"], active_room
                    )
        finally:
            if refresh_task is not None:
                refresh_task.cancel()
                await asyncio.gather(refresh_task, return_exceptions=True)
    except ManagedMotionReplacedError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        await manager.ledger.async_mark_cancelled(
            serial_number, call.data["plan_id"], active_room
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_cancelled",
            {
                **event_data(active_room),
                "reason_code": "managed_cancelled",
                "cause": "replacement",
            },
            context=call.context,
        )
        raise PlanCancelledError from err
    except PlanCancelledError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        err.suspend_reason = dispatch_control._suspended_run_reason(
            manager, serial_number
        )
        if manager.control.cancellation_reason(serial_number) == "config_entry_unload":
            await dispatch_control._async_cleanup_managed_motion(
                managed_user_command,
                motion_token,
                dispatch_attempted,
            )
            await manager.ledger.async_mark_interrupted(
                serial_number,
                call.data["plan_id"],
                active_room,
                "Home Assistant unloaded while cleaning this room",
            )
            hass.bus.async_fire(
                f"{DOMAIN}_room_interrupted",
                {
                    **event_data(active_room),
                    "reason_code": "config_entry_unload",
                    "cause": "home_assistant",
                },
                context=call.context,
            )
        else:
            cancellation_reason = manager.control.cancellation_reason(serial_number)
            cancellation_cause = (
                "replacement"
                if cancellation_reason == "motion_replaced"
                else "managed_cancellation"
                if cancellation_reason == "managed_stop"
                else "unknown"
            )
            await manager.ledger.async_mark_cancelled(
                serial_number, call.data["plan_id"], active_room
            )
            hass.bus.async_fire(
                f"{DOMAIN}_room_cancelled",
                {
                    **event_data(active_room),
                    "reason_code": (
                        "managed_cancelled"
                        if cancellation_reason in {"managed_stop", "motion_replaced"}
                        else "cancellation_unattributed"
                    ),
                    "cause": cancellation_cause,
                },
                context=call.context,
            )
        raise
    except RoomInterruptedError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        await dispatch_control._async_cleanup_managed_motion(
            managed_user_command,
            motion_token,
            dispatch_attempted,
        )
        reconciliation = (
            None if isinstance(err, RoomStoppedInPlaceError) else build_reconciliation()
        )
        async with dispatch_control._managed_reconciliation_guard(
            manager, serial_number, motion_token
        ) as owned:
            if not owned:
                reconciliation = None
            await manager.ledger.async_mark_interrupted(
                serial_number,
                call.data["plan_id"],
                active_room,
                str(err),
                **(
                    {"native_reconciliation": reconciliation}
                    if reconciliation is not None
                    else {}
                ),
            )
            if (
                reconciliation is not None
                and dispatch_control._managed_reconciliation_is_current(
                    manager, serial_number, motion_token
                )
            ):
                history_reconciliation._schedule_grouped_native_reconciliation(
                    hass,
                    manager,
                    serial_number,
                    entity_id,
                    reconciliation,
                    session_history,
                    coverage_verifier,
                )
        hass.bus.async_fire(
            f"{DOMAIN}_room_interrupted",
            {
                **event_data(active_room),
                "error": str(err),
                "reason_code": managed_run._interruption_reason_code(err),
                "cause": "unknown",
            },
            context=call.context,
        )
        raise managed_run._validation_error(
            str(err), "room_interrupted", {"room": active_room.name}
        ) from err
    except RoomTakenOverError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        err.suspend_reason = dispatch_control._suspended_run_reason(
            manager, serial_number
        )
        await manager.ledger.async_mark_interrupted(
            serial_number, call.data["plan_id"], active_room, str(err)
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_interrupted",
            {
                **event_data(active_room),
                "error": str(err),
                "reason_code": "native_task_taken_over",
                "cause": "unknown",
            },
            context=call.context,
        )
        raise managed_run._validation_error(
            "The original native cleaning task could no longer be verified",
            "room_taken_over",
            {"room": active_room.name},
        ) from err
    except (TimeoutError, HomeAssistantError, MaticError) as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        # A graceful finish request can race a room failure.  Clear that
        # intent before sending the failure STOP so its dock watcher cannot
        # upgrade the still-running record and mask the durable failure.
        if finish_room_event is not None:
            finish_room_event.clear()
        if not dispatch_control._managed_stop_fence_owned_by_run(
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
        elif isinstance(err, MaticError):
            failure_reason = "The robot could not complete the managed room"
        else:
            failure_reason = str(err).strip() or "The managed room failed"
        await manager.ledger.async_mark_failed(
            serial_number, call.data["plan_id"], active_room, failure_reason
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_failed",
            {
                **event_data(active_room),
                "error": failure_reason,
                "reason_code": managed_run._failure_reason_code(err),
                "cause": "unknown",
            },
            context=call.context,
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

    credited = evidence or {}
    verified_coverage = await async_confirm_completed_coverage(
        manager.ledger.coverage_receipt(serial_number, run_id),
        completion_sessions[-1] if completion_sessions else None,
        coverage_verifier,
    )
    skipped = (
        manager.ledger.skipped_room_ids(serial_number, run_id)
        if run_id is not None
        else frozenset()
    )
    reconciliation = build_reconciliation(tuple(credited))
    marker_saved = False
    for room in leg:
        if room.room_id in credited:
            completed_at, duration_seconds = credited[room.room_id]
            accepted = await manager.ledger.async_mark_completed(
                serial_number,
                call.data["plan_id"],
                room,
                run_id=run_id,
                completed_at=completed_at,
                duration_seconds=duration_seconds,
                verified_coverage_receipt=verified_coverage,
                completion_is_current=lambda: (
                    (cancel_event is None or not cancel_event.is_set())
                    and (
                        motion_token is None
                        or manager.control.managed_motion_is_current(
                            serial_number, motion_token
                        )
                    )
                    and (floor_is_current is None or floor_is_current())
                ),
            )
            if not accepted:
                raise PlanCancelledError(
                    "Run ownership changed before room completion could be credited"
                )
            if confirm_room_completed is not None:
                confirm_room_completed(room.name)
            if record_room_completed is not None:
                record_room_completed(room)
            hass.bus.async_fire(
                f"{DOMAIN}_room_completed",
                {**event_data(room), "reason_code": "verified_completion"},
                context=call.context,
            )
        elif run_id is not None and room.room_id in skipped:
            await manager.ledger.async_mark_skipped(
                serial_number, call.data["plan_id"], room, run_id=run_id
            )
            hass.bus.async_fire(
                f"{DOMAIN}_room_skipped",
                {**event_data(room), "reason_code": "owner_skipped"},
                context=call.context,
            )
        elif stop_sent and room.room_id not in observed_ids:
            await manager.ledger.async_mark_cancelled(
                serial_number, call.data["plan_id"], room
            )
            hass.bus.async_fire(
                f"{DOMAIN}_room_cancelled",
                {
                    **event_data(room),
                    "reason_code": "managed_cancelled",
                    "cause": "finish_current_room_or_stop",
                },
                context=call.context,
            )
        else:
            async with dispatch_control._managed_reconciliation_guard(
                manager, serial_number, motion_token
            ) as owned:
                if not owned or (
                    floor_is_current is not None and not floor_is_current()
                ):
                    reconciliation = None
                await manager.ledger.async_mark_ended_unverified(
                    serial_number,
                    call.data["plan_id"],
                    room,
                    **(
                        {"native_reconciliation": reconciliation}
                        if reconciliation is not None and not marker_saved
                        else {}
                    ),
                )
            marker_saved = True
            hass.bus.async_fire(
                f"{DOMAIN}_room_ended_unverified",
                {
                    **event_data(room),
                    "reason_code": "unverified_completion",
                    "cause": "unknown",
                },
                context=call.context,
            )
    if reconciliation is not None:
        history_reconciliation._schedule_grouped_native_reconciliation(
            hass,
            manager,
            serial_number,
            entity_id,
            reconciliation,
            session_history,
            coverage_verifier,
        )
    # A room the owner skipped is settled without credit, so the run goes on
    # to its next leg.
    all_verified = all(
        room.room_id in credited or room.room_id in skipped for room in leg
    )
    if all_verified and prefetch_next is not None and not stop_sent:
        # Start the next settings leg only after evidence and persistence finish.
        # Otherwise a short next mission can end before its observer attaches.
        await prefetch_next()
    return all_verified
