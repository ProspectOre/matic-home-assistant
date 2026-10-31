"""Single-room mission execution with independent native completion proof."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import datetime, timedelta

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from . import managed_dispatch as dispatch_control
from . import managed_observation as observation
from . import managed_reconciliation as history_reconciliation
from . import managed_run
from .client.commands import UserCommand
from .client.coverage_receipts import CoverageVerifier
from .client.exceptions import CoverageGuardError, MaticError
from .client.models import CleaningSessionRecord
from .const import DOMAIN
from .coverage_accounting import (
    async_confirm_completed_coverage,
)
from .managed_run import (
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


async def _async_run_room(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    room: CleaningRoom,
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
    provenance: str | None = None,
    recovered_suspend_reason: str | None = None,
    expected_dispatch_identity: bytes | None = None,
    expected_dispatch_history: frozenset[str] | None = None,
    coverage_verifier: CoverageVerifier | None = None,
) -> bool:
    """Run one room and report whether native history verified completion."""
    resolve_session = observation._async_wait_for_active_session_resolution
    if not room_name_is_unique:
        raise managed_run._validation_error(
            "Managed completion cannot distinguish duplicate mapped room names",
            "ambiguous_room_name",
            {"room": room.name},
        )
    event_data = {
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
    first_start = await manager.ledger.async_mark_started(
        serial_number, call.data["plan_id"], room, run_id=run_id
    )
    if first_start:
        hass.bus.async_fire(f"{DOMAIN}_room_started", event_data, context=call.context)
    completion_verified = False
    completion_sessions: list[str] = []
    dispatch_attempted = False
    room_started = False
    dispatch: _PreparedRoomDispatch | None = prepared_dispatch
    history_baseline: frozenset[bytes] | None = None
    dispatched_at: datetime | None = None
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

    try:
        if dispatch is None:
            dispatch = await dispatch_control._async_dispatch_leg_command(
                hass,
                call,
                entity_id,
                [room],
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
            if dispatch.rooms != (room,):
                raise ValueError("prepared room dispatch does not match the room")
            dispatch_attempted = True
            bind_native_identity(dispatch.native_identity)
        history_baseline = dispatch.history_baseline
        dispatched_at = dispatch.dispatched_at
        assert dispatched_at is not None
        if checkpoint_dispatch is not None:
            await checkpoint_dispatch(dispatch)
        try:
            start_state = await observation._async_wait_for_owned_start(
                hass,
                entity_id,
                call.data["start_timeout"],
                cancel_event,
                room,
                session_identity,
                bind_native_identity,
                dispatch.native_identity_baseline,
                native_identity,
                already_accepted=dispatch.recovered,
            )
        except TimeoutError as err:
            raise RoomStartTimeoutError from err
        dispatch = replace(dispatch, native_identity=native_identity)
        if checkpoint_dispatch is not None:
            await checkpoint_dispatch(dispatch)
        if start_state == "paused" or recovered_suspend_reason in {
            "paused",
            "low_charge",
        }:
            await manager.ledger.async_mark_suspended(
                serial_number,
                call.data["plan_id"],
                room,
                recovered_suspend_reason or "paused",
            )
            await observation._async_wait_for_owned_resume(
                hass,
                entity_id,
                managed_run._remaining_completion_time(
                    dispatch, call.data["completion_timeout"]
                ),
                cancel_event,
                room,
                session_identity,
                native_identity,
            )
        await manager.ledger.async_mark_resumed(
            serial_number, call.data["plan_id"], room
        )
        room_started = True
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
                    outcome = await observation._async_wait_with_native_identity(
                        lambda: observation._async_wait_for_room_outcome(
                            hass,
                            entity_id,
                            room,
                            cancel_event,
                            # Owned start already observed this room. Preserve that
                            # evidence across transient cleaning during dock travel.
                            initial_observed=True,
                        ),
                        session_identity,
                        native_identity,
                    )
                    if outcome is RoomRunOutcome.HANDOFF_CANDIDATE:
                        if session_identity is not None:
                            session_resolution = await resolve_session(
                                hass,
                                entity_id,
                                active_session,
                                cancel_event,
                                identity_reader=session_identity,
                                expected_identity=native_identity,
                            )
                        else:
                            session_resolution = (
                                await observation._async_active_session_state(
                                    active_session
                                )
                            )
                            if active_session is None:
                                session_resolution = False
                            elif session_resolution is True:
                                session_resolution = await resolve_session(
                                    hass, entity_id, active_session, cancel_event
                                )
                        if session_resolution is False:
                            mission_timeout.reschedule(None)
                            await manager.ledger.async_mark_verifying(
                                serial_number,
                                call.data["plan_id"],
                                room,
                                verification_deadline=dt_util.utcnow()
                                + timedelta(
                                    seconds=observation.SESSION_HISTORY_TIMEOUT_SECONDS
                                ),
                            )
                            completion_verified = (
                                await observation._async_verify_room_completion(
                                    session_history,
                                    history_baseline,
                                    room,
                                    dispatched_at,
                                    hass=hass,
                                    entity_id=entity_id,
                                    cancel_event=cancel_event,
                                    on_verified_session=completion_sessions.append,
                                )
                            )
                            break
                        if session_resolution is None:
                            raise RoomInterruptedError(
                                f"{room.name} completion could not be verified"
                            )
                        await manager.ledger.async_mark_resumed(
                            serial_number, call.data["plan_id"], room
                        )
                        continue
                    if outcome is RoomRunOutcome.STOPPED_IN_PLACE:
                        raise RoomStoppedInPlaceError(
                            f"{room.name} ended in place without returning; "
                            "the stop cause is unconfirmed"
                        )
                    if outcome is RoomRunOutcome.INTERRUPTED:
                        raise RoomInterruptedError(
                            f"{room.name} stopped without verified completion"
                        )
                    if outcome is RoomRunOutcome.PAUSED:
                        suspend_reason = "paused"
                    elif outcome is RoomRunOutcome.SUSPENDED:
                        suspend_reason = "low_charge"
                    await manager.ledger.async_mark_suspended(
                        serial_number,
                        call.data["plan_id"],
                        room,
                        suspend_reason,
                    )
                    await observation._async_wait_for_owned_resume(
                        hass,
                        entity_id,
                        call.data["completion_timeout"],
                        cancel_event,
                        room,
                        session_identity,
                        native_identity,
                    )
                    await manager.ledger.async_mark_resumed(
                        serial_number, call.data["plan_id"], room
                    )
        finally:
            if refresh_task is not None:
                refresh_task.cancel()
                await asyncio.gather(refresh_task, return_exceptions=True)
    except ManagedMotionReplacedError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        await manager.ledger.async_mark_cancelled(
            serial_number, call.data["plan_id"], room
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_cancelled",
            {**event_data, "reason_code": "managed_cancelled", "cause": "replacement"},
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
            reconciliation = history_reconciliation._build_native_reconciliation(
                call.data["plan_id"], room, dispatched_at, room_started, run_id=run_id
            )
            async with dispatch_control._managed_reconciliation_guard(
                manager, serial_number, motion_token
            ) as owned:
                await manager.ledger.async_mark_interrupted(
                    serial_number,
                    call.data["plan_id"],
                    room,
                    "Home Assistant unloaded while cleaning this room",
                    native_reconciliation=history_reconciliation._native_reconciliation_data(
                        reconciliation if owned else None
                    ),
                )
            hass.bus.async_fire(
                f"{DOMAIN}_room_interrupted",
                {
                    **event_data,
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
                serial_number, call.data["plan_id"], room
            )
            hass.bus.async_fire(
                f"{DOMAIN}_room_cancelled",
                {
                    **event_data,
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
    except RoomTakenOverError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        err.suspend_reason = dispatch_control._suspended_run_reason(
            manager, serial_number
        )
        await manager.ledger.async_mark_interrupted(
            serial_number, call.data["plan_id"], room, str(err)
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_interrupted",
            {
                **event_data,
                "error": str(err),
                "reason_code": "native_task_taken_over",
                "cause": "unknown",
            },
            context=call.context,
        )
        raise managed_run._validation_error(
            "The original native cleaning task could no longer be verified",
            "room_taken_over",
            {"room": room.name},
        ) from err
    except RoomInterruptedError as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        await dispatch_control._async_cleanup_managed_motion(
            managed_user_command,
            motion_token,
            dispatch_attempted,
        )
        reconciliation = (
            None
            if isinstance(err, RoomStoppedInPlaceError)
            else history_reconciliation._build_native_reconciliation(
                call.data["plan_id"], room, dispatched_at, room_started, run_id=run_id
            )
        )
        async with dispatch_control._managed_reconciliation_guard(
            manager, serial_number, motion_token
        ) as owned:
            current_reconciliation = reconciliation if owned else None
            await manager.ledger.async_mark_interrupted(
                serial_number,
                call.data["plan_id"],
                room,
                str(err),
                native_reconciliation=history_reconciliation._native_reconciliation_data(
                    current_reconciliation
                ),
            )
            if not dispatch_control._managed_reconciliation_is_current(
                manager, serial_number, motion_token
            ):
                current_reconciliation = None
            history_reconciliation._schedule_native_reconciliation(
                hass,
                manager,
                serial_number,
                entity_id,
                room,
                current_reconciliation,
                history_baseline,
                active_session,
                session_history,
                confirm_room_completed,
                call.context,
                coverage_verifier=coverage_verifier,
            )
        hass.bus.async_fire(
            f"{DOMAIN}_room_interrupted",
            {
                **event_data,
                "error": str(err),
                "reason_code": managed_run._interruption_reason_code(err),
                "cause": "unknown",
            },
            context=call.context,
        )
        raise managed_run._validation_error(
            str(err), "room_interrupted", {"room": room.name}
        ) from err
    except (TimeoutError, HomeAssistantError, MaticError) as err:
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        # A graceful finish request can race a room failure.  Clear that
        # intent before sending the failure STOP so its dock watcher cannot
        # upgrade the still-running record and mask the durable failure.
        if finish_room_event is not None:
            finish_room_event.clear()
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
        reconciliation = history_reconciliation._build_native_reconciliation(
            call.data["plan_id"], room, dispatched_at, room_started, run_id=run_id
        )
        async with dispatch_control._managed_reconciliation_guard(
            manager, serial_number, motion_token
        ) as owned:
            current_reconciliation = reconciliation if owned else None
            await manager.ledger.async_mark_failed(
                serial_number,
                call.data["plan_id"],
                room,
                failure_reason,
                native_reconciliation=history_reconciliation._native_reconciliation_data(
                    current_reconciliation
                ),
            )
            if not dispatch_control._managed_reconciliation_is_current(
                manager, serial_number, motion_token
            ):
                current_reconciliation = None
            history_reconciliation._schedule_native_reconciliation(
                hass,
                manager,
                serial_number,
                entity_id,
                room,
                current_reconciliation,
                history_baseline,
                active_session,
                session_history,
                confirm_room_completed,
                call.context,
                coverage_verifier=coverage_verifier,
            )
        hass.bus.async_fire(
            f"{DOMAIN}_room_failed",
            {
                **event_data,
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
                f"The robot did not begin cleaning {room.name} before the start "
                "timeout",
                "plan_start_timeout",
                {"room": room.name},
            ) from err
        if isinstance(err, MaticError):
            if isinstance(err, CoverageGuardError):
                raise managed_run._validation_error(
                    err.safe_message, err.reason_code
                ) from err
            raise managed_run._validation_error(
                "The robot could not complete the managed room",
                "robot_command_failed",
                {"room": room.name},
            ) from err
        if isinstance(err, TimeoutError):
            raise managed_run._validation_error(
                f"Timed out while cleaning {room.name}",
                "plan_timeout",
                {"room": room.name},
            ) from err
        raise

    if completion_verified:
        verified_coverage = await async_confirm_completed_coverage(
            manager.ledger.coverage_receipt(serial_number, run_id),
            completion_sessions[-1] if completion_sessions else None,
            coverage_verifier,
        )
        if not await manager.ledger.async_mark_completed(
            serial_number,
            call.data["plan_id"],
            room,
            run_id=run_id,
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
        ):
            raise PlanCancelledError(
                "Run ownership changed before room completion could be credited"
            )
        if record_room_completed is not None:
            record_room_completed(room)
        if confirm_room_completed is not None:
            confirm_room_completed(room.name)
        hass.bus.async_fire(
            f"{DOMAIN}_room_completed",
            {**event_data, "reason_code": "verified_completion"},
            context=call.context,
        )
    elif run_id is not None and room.room_id in manager.ledger.skipped_room_ids(
        serial_number, run_id
    ):
        # Skipped without credit, but settled, so the run goes on.
        await manager.ledger.async_mark_skipped(
            serial_number, call.data["plan_id"], room, run_id=run_id
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_skipped",
            {**event_data, "reason_code": "owner_skipped"},
            context=call.context,
        )
        completion_verified = True
    else:
        await manager.ledger.async_mark_ended_unverified(
            serial_number, call.data["plan_id"], room
        )
        hass.bus.async_fire(
            f"{DOMAIN}_room_ended_unverified",
            {
                **event_data,
                "reason_code": "unverified_completion",
                "cause": "unknown",
            },
            context=call.context,
        )
    if completion_verified and prefetch_next is not None:
        await prefetch_next()
    return completion_verified
