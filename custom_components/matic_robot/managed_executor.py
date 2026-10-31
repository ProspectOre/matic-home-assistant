"""Managed cleaning execution and native-session reconciliation."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from copy import deepcopy
from dataclasses import asdict
from functools import partial
from typing import Any
from uuid import uuid4

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from . import managed_area as area_execution
from . import managed_dispatch as dispatch_control
from . import managed_leg as leg_execution
from . import managed_observation as observation
from . import managed_run
from .client.commands import UserCommand
from .client.coverage_receipts import CoverageVerifier
from .client.exceptions import MaticError
from .client.models import CleaningSessionRecord
from .const import DOMAIN, EVENT_PLAN_FINISHED
from .managed_run import (
    LegOutcomeWaiter,
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
    leg_groups,
    normalize_run_provenance,
    plan_legs,
    run_entries,
)
from .plans import CleaningPlanManager
from .run_control import ManagedMotionReplacedError
from .stop_return import (
    schedule_dock_confirmation,
)

_LOGGER = logging.getLogger(__name__)


async def _async_execute_rooms_reserved(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    rooms: list[CleaningRoom],
    *,
    cadence_by_room: Mapping[str, Mapping[str, Any]] | None = None,
    refresh: Callable[[], Awaitable[None]] | None = None,
    active_session: Callable[[], Awaitable[bool | None]] | None = None,
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]]
    | None = None,
    confirm_room_completed: Callable[[str], None] | None = None,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None = None,
    mapped_room_names: tuple[str, ...] = (),
    floor_is_current: Callable[[], bool] | None = None,
    floor_token: str | None = None,
    session_identity: Callable[[], Awaitable[bytes | None]] | None = None,
    set_activity_run_id: Callable[[str | None], None] | None = None,
    get_activity_run_id: Callable[[], str | None] | None = None,
    recovery: dict[str, Any] | None = None,
    recovered_dispatch: _PreparedRoomDispatch | None = None,
    handoff_expected_identity: bytes | None = None,
    wait_for_leg_outcome: LegOutcomeWaiter | None = None,
    _prepared_run_id: str,
    validate_prepared_run: Callable[[], None] | None = None,
    coverage_verifier: CoverageVerifier | None = None,
    entries: Sequence[Mapping[str, Any]] | None = None,
    held_rooms: Sequence[Mapping[str, str]] = (),
) -> None:
    """Execute every resolved room and custom area with safe cancellation.

    ``entries`` is the preview's run order when the plan has a custom area;
    a recovered run reads it from its checkpoint instead.
    """
    lock = manager.control.lock(serial_number)
    async with lock:
        manager.control.require_command_admission(serial_number)
        manager.control.register_run_task(serial_number)
        cancel_event = manager.control.prepare_run(serial_number)
        motion_token = manager.control.begin_managed_motion(serial_number)
        cleanup_stop_sent = False
        dock_confirmation_scheduled = False
        native_identity: bytes | None = handoff_expected_identity
        expected_dispatch_identity = handoff_expected_identity
        run_id = _prepared_run_id
        finish_current_room, finish_current_room_threshold = (
            manager.cadence.prepared_run_stop_policy(serial_number, run_id)
        )
        run_started_at = (
            str(recovery["started_at"]) if recovery else dt_util.utcnow().isoformat()
        )
        run_started = recovery is not None
        shutdown_suspended = False
        run_outcome = "failed"
        run_reason_code = "run_not_finished"
        run_cause = "unknown"
        run_provenance = (
            normalize_run_provenance(recovery["provenance"])
            if recovery
            else dispatch_control._run_provenance(call)
        )
        checkpoint = deepcopy(recovery["recovery_checkpoint"]) if recovery else {}
        completed_room_ids: set[str] = set(checkpoint.get("completed_room_ids", []))
        finished_area_legs: set[int] = set(checkpoint.get("finished_area_legs", []))
        area_leg_count = 0
        chosen: list[CleaningRoom] = []
        durable = floor_token is not None and session_identity is not None

        async def save_dispatch(dispatch: _PreparedRoomDispatch) -> None:
            checkpoint.update(
                {
                    "phase": "accepted"
                    if dispatch.completion_deadline is not None
                    else "starting",
                    "dispatched_at": dispatch.dispatched_at.isoformat(),
                    "completion_deadline": dispatch.completion_deadline.isoformat()
                    if dispatch.completion_deadline is not None
                    else None,
                    "native_identity_hash": hashlib.sha256(
                        dispatch.native_identity
                    ).hexdigest()
                    if dispatch.native_identity
                    else None,
                    "history_baseline": [
                        hashlib.sha256(key).hexdigest()
                        for key in dispatch.history_baseline
                    ]
                    if dispatch.history_baseline is not None
                    else None,
                }
            )
            await manager.ledger.async_set_recovery_checkpoint(
                serial_number, run_id, checkpoint
            )

        def bind_native_identity(identity: bytes | None) -> None:
            nonlocal native_identity
            native_identity = identity

        outer_command = dispatch_control._guard_native_commands(
            managed_user_command,
            manager,
            serial_number,
            session_identity,
            lambda: native_identity,
            allow_ended_dock=True,
        )
        if set_activity_run_id is not None:
            set_activity_run_id(run_id)

        def record_room_completion(room: CleaningRoom) -> None:
            completed_room_ids.add(room.room_id)

        try:
            # Publish ownership before the first suspending check. Otherwise
            # Stop can observe no run while this start waits for an old stop
            # fence to clear, and prepare_run would erase its cancellation.
            await dispatch_control._ensure_stop_settled(
                hass,
                manager,
                serial_number,
                entity_id,
                active_session,
            )
            if recovery is None and validate_prepared_run is not None:
                validate_prepared_run()
            if recovery is not None and not (
                isinstance(checkpoint.get("finish_current_room"), bool)
                and "finish_current_room_threshold" in checkpoint
            ):
                # Upgrade a legacy checkpoint at the recovery boundary using
                # the run-owned policy restored before this first await.
                checkpoint.update(
                    {
                        "finish_current_room": finish_current_room,
                        "finish_current_room_threshold": finish_current_room_threshold,
                    }
                )
                await manager.ledger.async_set_recovery_checkpoint(
                    serial_number, run_id, checkpoint
                )
            finish_room_event = manager.control.finish_room_event(serial_number)
            if checkpoint.get("stop_intent") == "after_room":
                finish_room_event.set()
            single_room_missions = durable and (
                finish_current_room
                and (recovery is None or checkpoint.get("single_room_missions") is True)
            )
            chosen = rooms
            leg_entries = (
                checkpoint.get("entries")
                if recovery is not None
                else run_entries(entries)
            )
            mixed_settings = durable and (
                recovery is None or checkpoint.get("mixed_settings") is True
            )
            preserve_legacy_settings = (
                recovery is not None and checkpoint.get("mixed_settings") is not True
            )
            # A room-only run keeps its legs exactly as before custom areas.
            legs: list[PlanLeg] = (
                list(
                    leg_groups(
                        chosen,
                        mixed_settings=mixed_settings,
                        preserve_legacy_settings=preserve_legacy_settings,
                        single_room_missions=single_room_missions,
                    )
                )
                if leg_entries is None
                else plan_legs(
                    chosen,
                    leg_entries,
                    mixed_settings=mixed_settings,
                    preserve_legacy_settings=preserve_legacy_settings,
                    single_room_missions=single_room_missions,
                )
            )
            area_leg_count = sum(isinstance(leg, AreaLeg) for leg in legs)
            if area_leg_count and not durable:
                # A custom area is recognised only by its owned session.
                raise managed_run._validation_error(
                    "A plan with custom areas needs a tracked run",
                    "invalid_plan_command",
                )
            if recovery is None:
                run_started = True
                await manager.ledger.async_begin_run(
                    serial_number,
                    call.data["plan_id"],
                    run_id,
                    len(chosen),
                    trigger=run_provenance,
                    service=str(call.service),
                    provenance=run_provenance,
                    finish_current_room=finish_current_room,
                    finish_current_room_threshold=finish_current_room_threshold,
                    held_rooms=held_rooms,
                )
                for held in held_rooms:
                    hass.bus.async_fire(
                        f"{DOMAIN}_room_held",
                        {
                            ATTR_ENTITY_ID: entity_id,
                            "plan_id": call.data["plan_id"],
                            "room_id": held["room_id"],
                            "room": held["name"],
                            "run_id": run_id,
                            "provenance": run_provenance,
                            "reason_code": held["reason"],
                            "sensor": held["sensor"],
                        },
                        context=call.context,
                    )
            if mapped_room_names:
                mapped_keys = [native_room_key(name) for name in mapped_room_names]
                ambiguous = [
                    room.name
                    for room in chosen
                    if mapped_keys.count(native_room_key(room.name)) != 1
                ]
                if ambiguous:
                    # Admission and completion must use the same identity key.
                    # Check all legs before a prior leg can prefetch a command.
                    raise managed_run._validation_error(
                        "Managed completion cannot distinguish duplicate "
                        "mapped room names",
                        "ambiguous_room_name",
                        {"room": ", ".join(ambiguous)},
                    )
            if durable and recovery is None:
                checkpoint = {
                    "version": 1,
                    "mixed_settings": True,
                    # New Smart Stop runs must never place later rooms in the
                    # same OEM mission, where a boundary STOP can arrive late.
                    # Missing marker on older checkpoints preserves their
                    # recorded mission grouping exactly during recovery.
                    "single_room_missions": bool(finish_current_room),
                    "entity_id": entity_id,
                    "floor_token": floor_token,
                    "rooms": [asdict(room) for room in chosen],
                    "data": dict(call.data),
                    "leg_index": 0,
                    "phase": "ready",
                    "completed_room_ids": [],
                    "finish_current_room": finish_current_room,
                    "finish_current_room_threshold": finish_current_room_threshold,
                }
                if leg_entries is not None:
                    checkpoint["entries"] = leg_entries
                if cadence_by_room is not None:
                    checkpoint["cadence_by_room"] = deepcopy(
                        {key: dict(value) for key, value in cadence_by_room.items()}
                    )
                await manager.ledger.async_set_recovery_checkpoint(
                    serial_number, run_id, checkpoint
                )
            if recovery is None and validate_prepared_run is not None:
                validate_prepared_run()
            prepared_dispatches: dict[str, _PreparedRoomDispatch] = {}
            for index, leg in enumerate(legs):
                if recovery is not None and index < checkpoint["leg_index"]:
                    continue
                if (
                    cancel_event.is_set()
                    or not manager.control.managed_motion_is_current(
                        serial_number, motion_token
                    )
                ):
                    raise PlanCancelledError
                prepared_dispatch = recovered_dispatch or (
                    None
                    if isinstance(leg, AreaLeg)
                    else prepared_dispatches.pop(leg[0].room_id, None)
                )
                recovered_dispatch = None
                expected_dispatch_history = None
                if durable and index > 0 and prepared_dispatch is None:
                    handoff_history = checkpoint.get("handoff_history")
                    if isinstance(handoff_history, list):
                        expected_dispatch_history = frozenset(handoff_history)
                    else:
                        # No durable evidence boundary means we cannot prove
                        # that an intervening native mission did not complete.
                        break
                    checkpoint.update(
                        {
                            "leg_index": index,
                            "phase": "handoff",
                            "completed_room_ids": sorted(completed_room_ids),
                        }
                    )
                    await manager.ledger.async_set_recovery_checkpoint(
                        serial_number, run_id, checkpoint
                    )
                    if finish_room_event.is_set():
                        break
                    if not await observation._async_wait_for_settled_leg_handoff(
                        hass,
                        entity_id,
                        cancel_event,
                        refresh=refresh,
                        active_session=active_session,
                        identity_reader=session_identity,
                        expected_identity=native_identity,
                        finish_room_event=finish_room_event,
                    ):
                        # The previous native leg is complete, but the robot
                        # never reached a safe handoff state. Leave the
                        # remaining settings legs unattempted; issuing STOP
                        # here would restart the OEM stop countdown we just
                        # waited out.
                        break
                    # The settled handoff establishes an empty ownership
                    # boundary. Recheck that boundary immediately before the
                    # next dispatch so a new external mission cannot be
                    # adopted as our baseline.
                    completed_identity = native_identity
                    native_identity = b""
                    # Firmware can retain the completed mission identity
                    # while a blocked doorway leaves it returning/idle. Keep
                    # that identity as the dispatch fence; the handoff waiter
                    # already established that the session is inactive, and
                    # dispatch accepts either this identity or its clearing.
                    expected_dispatch_identity = completed_identity or b""
                    if finish_room_event.is_set():
                        # Honor a graceful finish request before dispatching a
                        # new settings-boundary leg.
                        break
                if durable and prepared_dispatch is None:
                    checkpoint.update(
                        {
                            "leg_index": index,
                            "phase": "dispatching",
                            "completed_room_ids": sorted(completed_room_ids),
                        }
                    )
                    await manager.ledger.async_set_recovery_checkpoint(
                        serial_number, run_id, checkpoint
                    )
                following = legs[index + 1] if index + 1 < len(legs) else None
                next_leg = following if isinstance(following, list) else None

                async def prefetch_next(
                    candidate: list[CleaningRoom] | None = next_leg,
                ) -> _PreparedRoomDispatch | None:
                    if (
                        candidate is None
                        or finish_room_event.is_set()
                        or cancel_event.is_set()
                        or not manager.control.managed_motion_is_current(
                            serial_number, motion_token
                        )
                        or dispatch_control._stop_is_pending(manager, serial_number)
                    ):
                        return None
                    if existing := prepared_dispatches.get(candidate[0].room_id):
                        return existing
                    try:
                        dispatched = await dispatch_control._async_dispatch_leg_command(
                            hass,
                            call,
                            entity_id,
                            candidate,
                            motion_token,
                            session_history,
                            floor_is_current=floor_is_current,
                            floor_token=floor_token,
                            session_identity=session_identity,
                            on_dispatch=lambda: bind_native_identity(None),
                            on_identity=bind_native_identity,
                        )
                    except (HomeAssistantError, MaticError) as err:
                        _LOGGER.debug(
                            "Next Matic leg dispatch was unavailable (%s)",
                            type(err).__name__,
                        )
                        return None
                    prepared_dispatches[candidate[0].room_id] = dispatched
                    return dispatched

                if isinstance(leg, AreaLeg):
                    completion_verified = await area_execution._async_run_area_leg(
                        hass,
                        call,
                        manager,
                        entity_id,
                        serial_number,
                        leg,
                        cancel_event,
                        motion_token,
                        active_session,
                        session_history,
                        managed_user_command,
                        prepared_dispatch=prepared_dispatch,
                        finish_room_event=finish_room_event,
                        floor_is_current=floor_is_current,
                        floor_token=floor_token,
                        session_identity=session_identity,
                        expected_dispatch_identity=expected_dispatch_identity,
                        expected_dispatch_history=expected_dispatch_history,
                        on_native_identity=bind_native_identity,
                        run_id=run_id,
                        checkpoint_dispatch=save_dispatch,
                        provenance=run_provenance,
                        # Later legs need the area's own record in history.
                        settle_history=index + 1 < len(legs),
                    )
                    finished_area_legs.add(index)
                    checkpoint["finished_area_legs"] = sorted(finished_area_legs)
                    if durable and index + 1 == len(legs):
                        # No handoff save follows the last leg. Persist the
                        # finish so a restart before finalization still
                        # completes the run instead of leaving it unverified.
                        await manager.ledger.async_set_recovery_checkpoint(
                            serial_number, run_id, checkpoint
                        )
                else:
                    completion_verified = await leg_execution._async_run_leg(
                        hass,
                        call,
                        manager,
                        entity_id,
                        serial_number,
                        leg,
                        cancel_event,
                        refresh,
                        motion_token,
                        active_session,
                        session_history,
                        confirm_room_completed,
                        managed_user_command,
                        prepared_dispatch=prepared_dispatch,
                        prefetch_next=prefetch_next
                        if next_leg is not None and not durable
                        else None,
                        finish_room_event=finish_room_event,
                        floor_is_current=floor_is_current,
                        floor_token=floor_token,
                        session_identity=session_identity,
                        expected_dispatch_identity=expected_dispatch_identity,
                        expected_dispatch_history=expected_dispatch_history,
                        on_native_identity=bind_native_identity,
                        run_id=run_id,
                        record_room_completed=record_room_completion,
                        checkpoint_dispatch=save_dispatch if durable else None,
                        provenance=run_provenance,
                        recovered_suspend_reason=(
                            (
                                manager.ledger.snapshot(serial_number).get(
                                    "active_plan"
                                )
                                or {}
                            ).get("suspend_reason")
                            if recovery is not None and index == checkpoint["leg_index"]
                            else None
                        ),
                        recovered_room_id=(
                            (
                                manager.ledger.snapshot(serial_number).get(
                                    "active_plan"
                                )
                                or {}
                            ).get("room_id")
                            if recovery is not None and index == checkpoint["leg_index"]
                            else None
                        ),
                        wait_for_leg_outcome=wait_for_leg_outcome,
                        coverage_verifier=coverage_verifier,
                    )
                expected_dispatch_identity = None
                if not completion_verified:
                    break
                if (
                    cancel_event.is_set()
                    or not manager.control.managed_motion_is_current(
                        serial_number, motion_token
                    )
                ):
                    raise PlanCancelledError
                if finish_room_event.is_set():
                    if prepared_dispatches:
                        await dispatch_control._async_cleanup_managed_motion(
                            outer_command,
                            motion_token,
                            dispatch_attempted=True,
                        )
                        cleanup_stop_sent = dispatch_control._stop_is_pending(
                            manager, serial_number
                        )
                    break
                if durable and index + 1 < len(legs):
                    # The verified leg is complete, but the native task may
                    # still be returning. Persist the next leg before the
                    # bounded handoff wait so restart recovery can resume the
                    # queue instead of treating the prior verifying leg as
                    # the only recoverable work.
                    handoff_keys = await observation._async_session_history_baseline(
                        session_history
                    )
                    checkpoint.update(
                        {
                            "leg_index": index + 1,
                            "phase": "handoff",
                            "completed_room_ids": sorted(completed_room_ids),
                            "handoff_history": sorted(
                                hashlib.sha256(key).hexdigest() for key in handoff_keys
                            )
                            if handoff_keys is not None
                            else None,
                        }
                    )
                    checkpoint.pop("verification_deadline", None)
                    await manager.ledger.async_set_recovery_checkpoint(
                        serial_number, run_id, checkpoint
                    )
            completed_room_count = len(completed_room_ids)
            # Every room verified and every custom area's own mission ended.
            all_entries_done = (
                completed_room_count == len(chosen)
                and len(finished_area_legs) == area_leg_count
            )
            if finish_room_event.is_set() and not all_entries_done:
                run_outcome = "cancelled"
                run_reason_code = "managed_stop"
                run_cause = "managed_cancellation"
                mark_managed_stop = manager.control.mark_managed_stop
                mark_managed_stop(serial_number)
            elif all_entries_done:
                run_outcome = "completed"
                run_reason_code = "all_rooms_verified"
                run_cause = "verified_completion"
            else:
                run_outcome = "unverified"
                run_reason_code = "partial_native_result"
                run_cause = "native_result"
            if cancel_event.is_set() or not manager.control.managed_motion_is_current(
                serial_number, motion_token
            ):
                raise PlanCancelledError
            current = hass.states.get(entity_id)
            needs_dock_confirmation = (
                finish_room_event.is_set() and not all_entries_done
            )
            if (
                (call.data["return_to_base"] or finish_room_event.is_set())
                and current is not None
                and outer_command is not None
                and not cleanup_stop_sent
                and not dispatch_control._stop_is_pending(manager, serial_number)
                and (
                    current.state not in {"docked", "returning"}
                    or needs_dock_confirmation
                )
            ):
                try:
                    if current.state not in {"docked", "returning"}:
                        await outer_command(motion_token, UserCommand.DOCK)
                    if needs_dock_confirmation:
                        dock_confirmation_scheduled = schedule_dock_confirmation(
                            hass,
                            refresh=refresh or (lambda: asyncio.sleep(0)),
                            manager=manager,
                            serial_number=serial_number,
                            entity_id=entity_id,
                            run_id=run_id,
                            set_run_id=set_activity_run_id,
                            get_run_id=get_activity_run_id,
                            on_docked=partial(
                                dispatch_control._async_mark_run_docked,
                                manager,
                                serial_number,
                                run_id,
                                entity_id,
                                call.context,
                            ),
                        )
                except ManagedMotionReplacedError as err:
                    raise PlanCancelledError from err
                except MaticError as err:
                    raise managed_run._validation_error(
                        "The robot could not return to its dock",
                        "robot_command_failed",
                    ) from err
        except PlanCancelledError as err:
            if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
                shutdown_suspended = True
                return
            cancellation_reason_reader = manager.control.cancellation_reason
            cancellation_reason = cancellation_reason_reader(serial_number)
            snapshot_reader = manager.ledger.snapshot
            active_snapshot = snapshot_reader(serial_number).get("active_plan")
            recharge_suspended = getattr(
                err, "suspend_reason", None
            ) == "low_charge" or (
                isinstance(active_snapshot, dict)
                and active_snapshot.get("status") == "suspended"
                and active_snapshot.get("suspend_reason") == "low_charge"
            )
            if cancellation_reason == "config_entry_unload":
                run_outcome = "unverified"
                run_reason_code = "config_entry_unload"
                run_cause = "home_assistant"
            elif cancellation_reason == "motion_replaced" or isinstance(
                err.__cause__, ManagedMotionReplacedError
            ):
                run_outcome = "cancelled"
                run_reason_code = "managed_replaced"
                run_cause = "replacement"
            elif cancellation_reason == "managed_stop":
                run_outcome = "cancelled"
                run_reason_code = "managed_stop"
                run_cause = "managed_cancellation"
            elif recharge_suspended:
                run_outcome = "recharge_suspended"
                run_reason_code = "low_charge"
                run_cause = "robot"
            else:
                run_outcome = "unverified"
                run_reason_code = "cancellation_unattributed"
                run_cause = "unknown"
            return
        except (Exception, asyncio.CancelledError) as err:
            if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
                shutdown_suspended = True
                raise
            # A native task that ends in place is positive evidence that the
            # room was stopped, but it does not identify who or what stopped
            # it.  Keep the no-credit guard from the room handler while
            # treating this expected partial plan outcome as a controlled
            # result, so a presence automation does not turn a valid stop into
            # a generic service error.
            stopped_in_place = isinstance(err, RoomStoppedInPlaceError) or isinstance(
                getattr(err, "__cause__", None), RoomStoppedInPlaceError
            )
            if stopped_in_place:
                run_outcome = "unverified"
                run_reason_code = "stopped_in_place"
                run_cause = "unknown"
                return
            leaf_error = (
                err.__cause__
                if isinstance(err, ServiceValidationError) and err.__cause__ is not None
                else err
            )
            if getattr(leaf_error, "suspend_reason", None) == "low_charge":
                run_outcome = "recharge_suspended"
                run_reason_code = "low_charge"
                run_cause = "robot"
                raise
            if isinstance(leaf_error, RoomInterruptedError | RoomTakenOverError):
                run_outcome = "unverified"
                run_reason_code = (
                    "native_task_taken_over"
                    if isinstance(leaf_error, RoomTakenOverError)
                    else managed_run._interruption_reason_code(leaf_error)
                )
                run_cause = "unknown"
                raise
            run_outcome = "failed"
            run_reason_code = managed_run._failure_reason_code(err)
            run_cause = (
                "unknown"
                if isinstance(err, HomeAssistantError | MaticError | TimeoutError)
                else "internal"
            )
            finish_event_reader = manager.control.finish_room_event
            finish_event_reader(serial_number).clear()
            # Leaf handlers retire expected failures. Unexpected failures must
            # also leave a terminal record before ownership is released.
            active = manager.ledger.snapshot(serial_number)["active_plan"]
            if (
                manager.control.managed_motion_is_current(serial_number, motion_token)
                and isinstance(active, dict)
                and active.get("plan_id") == call.data["plan_id"]
            ):
                room = next(
                    (room for room in rooms if room.room_id == active.get("room_id")),
                    None,
                )
                if room is not None:
                    reason = f"Managed cleaning aborted ({type(err).__name__})"
                    _LOGGER.error(reason)
                    await manager.ledger.async_mark_interrupted(
                        serial_number, call.data["plan_id"], room, reason
                    )
                    hass.bus.async_fire(
                        f"{DOMAIN}_room_interrupted",
                        {
                            "entity_id": entity_id,
                            "plan_id": call.data["plan_id"],
                            "room": room.name,
                            "room_id": room.room_id,
                            "cleaning_mode": room.cleaning_mode,
                            "coverage_setting": room.coverage_setting,
                            "run_id": run_id,
                            "error": reason,
                            "reason_code": "unexpected_exception",
                            "cause": "internal",
                        },
                        context=call.context,
                    )
                    session_ended = False
                    current = hass.states.get(entity_id)
                    if current is not None and current.state in {
                        "docked",
                        "charging",
                        "idle",
                        "returning",
                    }:
                        try:
                            session_ended = (
                                await observation._async_active_session_state(
                                    active_session
                                )
                            ) is False
                        except (Exception, asyncio.CancelledError) as cleanup_error:
                            _LOGGER.warning(
                                "Unable to confirm aborted native session ended (%s)",
                                type(cleanup_error).__name__,
                            )
                    # Returning is already a firmware-owned terminal motion
                    # state. Sending STOP here can replace a natural handoff
                    # with the OEM ten-minute stop countdown, leaving later
                    # settings legs unattempted. Only stop when the robot is
                    # not already on its way home.
                    if (
                        not session_ended
                        and (
                            current is None
                            or current.state != "returning"
                            or current.attributes.get("low_charge") is True
                        )
                        and managed_run._coverage_guard_cause(err) is None
                    ):
                        if not dispatch_control._managed_stop_fence_owned_by_run(
                            manager, serial_number, run_id
                        ):
                            await dispatch_control._async_cleanup_managed_motion(
                                outer_command, motion_token, dispatch_attempted=True
                            )
            raise
        finally:
            try:
                # Cancellation during HA shutdown is not a robot outcome.
                # Explicit unload/stop and genuine failures still finalize.
                if run_started and not shutdown_suspended:
                    finished_at = dt_util.utcnow().isoformat()
                    states = getattr(hass, "states", None)
                    state_getter = getattr(states, "get", None)
                    current_state = (
                        state_getter(entity_id) if callable(state_getter) else None
                    )
                    terminal_activity = (
                        str(getattr(current_state, "state", "unknown"))
                        if current_state is not None
                        else "unknown"
                    )
                    event_outcome = run_outcome
                    event_reason_code = run_reason_code
                    event_cause = run_cause
                    event_terminal_activity = terminal_activity
                    event_completed_room_count = len(completed_room_ids)
                    try:
                        finish_run = manager.ledger.async_finish_run
                        await finish_run(
                            serial_number,
                            run_id,
                            run_outcome,
                            run_reason_code,
                            len(completed_room_ids),
                            terminal_activity=terminal_activity,
                            cause=run_cause,
                            entity_id=entity_id,
                            context=call.context,
                        )
                        snapshot_reader = manager.ledger.snapshot
                        final_snapshot = snapshot_reader(serial_number)
                        final_last_run = (
                            final_snapshot.get("last_run")
                            if isinstance(final_snapshot, dict)
                            else None
                        )
                        if isinstance(final_last_run, dict) and (
                            final_last_run.get("run_id") == run_id
                        ):
                            event_outcome = str(
                                final_last_run.get("outcome", event_outcome)
                            )
                            event_reason_code = str(
                                final_last_run.get("reason_code", event_reason_code)
                            )
                            event_cause = str(final_last_run.get("cause", event_cause))
                            event_terminal_activity = str(
                                final_last_run.get(
                                    "terminal_activity", event_terminal_activity
                                )
                            )
                            completed = final_last_run.get("completed_room_count")
                            if isinstance(completed, int):
                                event_completed_room_count = completed
                    finally:
                        # Room terminal events are queued by the HA bus. Yield
                        # once so the plan terminal event is observed after the
                        # room boundary it summarizes.
                        await asyncio.sleep(0)
                        bus = getattr(hass, "bus", None)
                        fire = getattr(bus, "async_fire", None)
                        if callable(fire):
                            fire(
                                EVENT_PLAN_FINISHED,
                                {
                                    ATTR_ENTITY_ID: entity_id,
                                    "plan_id": call.data["plan_id"],
                                    "run_id": run_id,
                                    "trigger": run_provenance,
                                    "provenance": run_provenance,
                                    "service": str(call.service),
                                    "started_at": run_started_at,
                                    "ended_at": finished_at,
                                    "outcome": event_outcome,
                                    "reason_code": event_reason_code,
                                    "cause": event_cause,
                                    "terminal_activity": event_terminal_activity,
                                    "room_count": len(chosen),
                                    "completed_room_count": event_completed_room_count,
                                },
                                context=call.context,
                            )
            finally:
                manager.control.end_managed_motion(serial_number, motion_token)
                # The recovery wrapper still needs the lifecycle reason to
                # preserve this checkpoint when HA itself is not stopping.
                # It unregisters the same task after observing suspension.
                if recovery is None or not shutdown_suspended:
                    manager.control.unregister_run_task(serial_number)
                defer_scope_cleanup = manager.control.defer_activity_scope_cleanup
                stop_watcher_owns_scope = (
                    set_activity_run_id is not None
                    and (not dock_confirmation_scheduled)
                    and defer_scope_cleanup(
                        serial_number, run_id, set_activity_run_id, get_activity_run_id
                    )
                )
                if (
                    set_activity_run_id is not None
                    and not dock_confirmation_scheduled
                    and not stop_watcher_owns_scope
                ):
                    set_activity_run_id(None)


async def _async_execute_rooms(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    rooms: list[CleaningRoom],
    *,
    cadence_by_room: Mapping[str, Mapping[str, Any]] | None = None,
    refresh: Callable[[], Awaitable[None]] | None = None,
    active_session: Callable[[], Awaitable[bool | None]] | None = None,
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]]
    | None = None,
    confirm_room_completed: Callable[[str], None] | None = None,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None = None,
    mapped_room_names: tuple[str, ...] = (),
    floor_is_current: Callable[[], bool] | None = None,
    floor_token: str | None = None,
    session_identity: Callable[[], Awaitable[bytes | None]] | None = None,
    set_activity_run_id: Callable[[str | None], None] | None = None,
    get_activity_run_id: Callable[[], str | None] | None = None,
    recovery: dict[str, Any] | None = None,
    recovered_dispatch: _PreparedRoomDispatch | None = None,
    handoff_expected_identity: bytes | None = None,
    wait_for_leg_outcome: LegOutcomeWaiter | None = None,
    validate_prepared_run: Callable[[], None] | None = None,
    coverage_verifier: CoverageVerifier | None = None,
    entries: Sequence[Mapping[str, Any]] | None = None,
    held_rooms: Sequence[Mapping[str, str]] = (),
) -> None:
    """Reserve queued cadence synchronously, then execute the prepared run."""
    manager.control.require_command_admission(serial_number)
    lock = manager.control.lock(serial_number)
    if recovery is None and manager.control.recovery_run(serial_number) is not None:
        raise managed_run._validation_error(
            "A managed Matic plan is reconnecting", "plan_already_running"
        )
    if lock.locked():
        raise managed_run._validation_error(
            "A managed Matic cleaning plan is already running", "plan_already_running"
        )
    run_id = str(recovery["run_id"]) if recovery else uuid4().hex
    recovery_checkpoint = (
        recovery.get("recovery_checkpoint") if isinstance(recovery, dict) else None
    )
    try:
        manager.cadence.reserve_prepared_run(
            serial_number,
            str(call.data["plan_id"]),
            run_id,
            (room.room_id for room in rooms),
            cadence_by_room,
            finish_current_room=(
                recovery_checkpoint.get("finish_current_room")
                if isinstance(recovery_checkpoint, Mapping)
                and isinstance(recovery_checkpoint.get("finish_current_room"), bool)
                else None
            ),
            finish_current_room_threshold=(
                recovery_checkpoint.get("finish_current_room_threshold")
                if isinstance(recovery_checkpoint, Mapping)
                and isinstance(
                    recovery_checkpoint.get("finish_current_room_threshold"), int
                )
                and not isinstance(
                    recovery_checkpoint.get("finish_current_room_threshold"), bool
                )
                else None
            ),
        )
    except HomeAssistantError as err:
        raise managed_run._validation_error(str(err), "plan_already_running") from err
    try:
        await _async_execute_rooms_reserved(
            hass,
            call,
            manager,
            entity_id,
            serial_number,
            rooms,
            cadence_by_room=cadence_by_room,
            refresh=refresh,
            active_session=active_session,
            session_history=session_history,
            confirm_room_completed=confirm_room_completed,
            managed_user_command=managed_user_command,
            mapped_room_names=mapped_room_names,
            floor_is_current=floor_is_current,
            floor_token=floor_token,
            session_identity=session_identity,
            set_activity_run_id=set_activity_run_id,
            get_activity_run_id=get_activity_run_id,
            recovery=recovery,
            recovered_dispatch=recovered_dispatch,
            handoff_expected_identity=handoff_expected_identity,
            wait_for_leg_outcome=wait_for_leg_outcome,
            _prepared_run_id=run_id,
            validate_prepared_run=validate_prepared_run,
            coverage_verifier=coverage_verifier,
            entries=entries,
            held_rooms=held_rooms,
        )
    finally:
        manager.cadence.release_prepared_run(serial_number, run_id)
