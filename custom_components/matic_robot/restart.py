"""Reattach durable managed runs without replaying accepted robot commands."""

from __future__ import annotations

import asyncio
import hashlib
from functools import partial
from typing import TYPE_CHECKING

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .client.commands import UserCommand
from .client.exceptions import MaticError
from .client.models import CleaningSessionRecord
from .const import DOMAIN, EVENT_PLAN_FINISHED
from .plans import CleaningRoom, leg_groups, plan_floor_token
from .services import (
    LEG_HANDOFF_TIMEOUT_SECONDS,
    _async_execute_rooms,
    _async_managed_user_command,
    _async_verify_leg_completion,
    _async_wait_for_settled_leg_handoff,
    _PreparedRoomDispatch,
    _room_outcomes,
    _schedule_managed_dock_after_stop,
    _shutdown_suspends_run,
)

if TYPE_CHECKING:
    from . import MaticConfigEntry

RECOVERY_ATTEMPTS = 60
RECOVERY_RETRY_SECONDS = 2


async def async_recover_managed_run(
    hass: HomeAssistant, entry: MaticConfigEntry, serial_number: str
) -> None:
    """Validate the same native mission and rejoin the normal execution loop.

    Native identity bytes stay in memory. Only fingerprints are checkpointed.
    An ended or changed mission while HA was absent is deliberately not replayed:
    native history import can still credit rooms, but cannot prove continuous
    ownership of the remaining queue.
    """
    # A queued background recovery may first run after unload has begun.
    # Leave its checkpoint for the next setup instead of acquiring ownership
    # after the unload handler already checked for a registered task.
    if getattr(entry, "state", None) is ConfigEntryState.UNLOAD_IN_PROGRESS:
        return
    runtime = entry.runtime_data
    manager = runtime.cleaning_plans
    restored_stop_owner = manager.pending_stop_run_id(serial_number)

    def restore_stop_settlement() -> None:
        owner = manager.pending_stop_run_id(serial_number)
        entity_id = er.async_get(hass).async_get_entity_id(
            "vacuum", DOMAIN, f"{serial_number}_vacuum"
        )
        if (
            owner is not None
            and owner == restored_stop_owner
            and entity_id is not None
            and not manager.dock_reconciliation_active(serial_number)
        ):
            _schedule_managed_dock_after_stop(
                hass, entry, manager, serial_number, entity_id, owner, None
            )

    run = manager.recovery_run(serial_number)
    if run is None:
        restore_stop_settlement()
        return
    manager.register_run_task(serial_number)
    cancel = manager.prepare_run(serial_number)
    generation = manager.motion_generation(serial_number)
    reason = "restart_checkpoint_unverified"
    rooms: list[CleaningRoom] = []
    try:
        checkpoint = run["recovery_checkpoint"]
        if manager.pending_stop_run_id(serial_number) is not None:
            reason = "restart_stop_settlement_pending"
            return
        if checkpoint.get("stop_intent") in {"immediate", "not_running"}:
            reason = "restart_stop_requested"
            return
        phase = checkpoint.get("phase")
        if checkpoint.get("version") != 1 or phase not in {
            "accepted",
            "verifying",
            "handoff",
        }:
            return
        verifying = phase == "verifying"
        handoff = phase == "handoff"
        if handoff and checkpoint.get("stop_intent") == "after_room":
            # The preceding leg is already credited. A persisted graceful
            # stop must not wait for native settlement or resume the queue.
            reason = "restart_stop_requested"
            return
        verification_deadline = None
        if verifying:
            verification_deadline = dt_util.parse_datetime(
                checkpoint.get("verification_deadline", "")
            )
            if verification_deadline is None or verification_deadline.tzinfo is None:
                return
        rooms = [CleaningRoom(**room) for room in checkpoint["rooms"]]
        room_ids = {room.room_id for room in rooms}
        if (
            rooms
            and len(room_ids) == len(rooms) == run["room_count"]
            and room_ids == set(checkpoint.get("completed_room_ids", []))
            and run["completed_room_count"] == len(rooms)
        ):
            # Credits and checkpoint were saved together. A crash before the
            # normal finalizer cannot erase an already verified completion.
            reason = "all_rooms_verified"
            return
        legs = leg_groups(rooms)
        leg_index = checkpoint.get("leg_index")
        if (
            not isinstance(leg_index, int)
            or leg_index < 0
            or leg_index >= len(legs)
            or (
                handoff
                and (
                    leg_index == 0
                    or not {
                        room.room_id for leg in legs[:leg_index] for room in leg
                    }.issubset(set(checkpoint.get("completed_room_ids", [])))
                )
            )
        ):
            return
        leg = legs[leg_index]
        expected = checkpoint.get("native_identity_hash")
        if not isinstance(expected, str) or len(expected) != 64:
            return
        if handoff:
            # A handoff checkpoint has no accepted dispatch for the next leg;
            # its previous native identity is retained only to reject a
            # replacement before the queue is resumed.
            dispatched_at = None
            completion_deadline = None
        else:
            dispatched_at = dt_util.parse_datetime(checkpoint["dispatched_at"])
            if dispatched_at is None or dispatched_at.tzinfo is None:
                return
            deadline_value = checkpoint.get("completion_deadline")
            completion_deadline = (
                dt_util.parse_datetime(deadline_value)
                if isinstance(deadline_value, str)
                else None
            )
            if not verifying and (
                completion_deadline is None or completion_deadline.tzinfo is None
            ):
                return
        entity_id = er.async_get(hass).async_get_entity_id(
            "vacuum", DOMAIN, f"{serial_number}_vacuum"
        )
        if entity_id is None:
            return

        async def command(token: int, value: UserCommand) -> None:
            await _async_managed_user_command(
                hass, entry, manager, serial_number, entity_id, None, token, value
            )

        def floor_is_current() -> bool:
            floor = runtime.coordinator.data.floor_plan
            return (
                floor is not None
                and plan_floor_token(floor) == checkpoint["floor_token"]
                and runtime.slam_map.floor_plan_is_current(floor)
            )

        identity: bytes | None = None
        for attempt in range(RECOVERY_ATTEMPTS):
            if (
                cancel.is_set()
                or manager.motion_generation(serial_number) != generation
            ):
                reason = "restart_recovery_cancelled"
                return
            try:
                await runtime.coordinator.async_request_refresh()
                identity = await runtime.client.async_get_cleaning_session_identity()
            except MaticError:
                identity = None
            if identity is not None and floor_is_current():
                break
            if attempt + 1 < RECOVERY_ATTEMPTS:
                await asyncio.sleep(RECOVERY_RETRY_SECONDS)
        else:
            reason = "restart_state_unavailable"
            return
        if handoff:
            if not identity or hashlib.sha256(identity).hexdigest() != expected:
                if identity != b"":
                    reason = "restart_native_mission_changed_or_ended"
                    return
        elif (verifying and identity != b"") or (
            not verifying
            and (not identity or hashlib.sha256(identity).hexdigest() != expected)
        ):
            reason = "restart_native_mission_changed_or_ended"
            return
        if handoff:
            handoff_identity = identity
            handoff_history = checkpoint.get("handoff_history")
            if not isinstance(handoff_history, list) or not all(
                isinstance(key, str) and len(key) == 64 for key in handoff_history
            ):
                reason = "restart_handoff_history_unavailable"
                return
            records = await runtime.client.async_get_cleaning_session_records(
                strict=True
            )
            if {hashlib.sha256(record.key).hexdigest() for record in records} != set(
                handoff_history
            ):
                reason = "restart_handoff_history_changed"
                return
            await manager.async_mark_recovery_status(
                serial_number, "running", reason="handoff_checkpoint_verified"
            )
            settled = await _async_wait_for_settled_leg_handoff(
                hass,
                entity_id,
                cancel,
                refresh=runtime.coordinator.async_request_refresh,
                active_session=runtime.client.async_has_active_cleaning_session,
                identity_reader=runtime.client.async_get_cleaning_session_identity,
                expected_identity=identity if identity else None,
                reject_new_identity=not identity,
                timeout_seconds=LEG_HANDOFF_TIMEOUT_SECONDS,
                finish_room_event=manager.finish_room_event(serial_number),
            )
            if manager.finish_room_event(serial_number).is_set():
                reason = "restart_stop_requested"
                return
            if not settled:
                reason = "restart_handoff_unsettled"
                return
            if (
                cancel.is_set()
                or manager.motion_generation(serial_number) != generation
            ):
                reason = "restart_recovery_cancelled"
                return
            await _async_execute_rooms(
                hass,
                ServiceCall(hass, DOMAIN, run["service"], checkpoint["data"]),
                manager,
                entity_id,
                serial_number,
                rooms,
                intelligent=False,
                refresh=runtime.coordinator.async_request_refresh,
                active_session=runtime.client.async_has_active_cleaning_session,
                session_history=partial(
                    runtime.client.async_get_cleaning_session_records, strict=True
                ),
                session_identity=runtime.client.async_get_cleaning_session_identity,
                confirm_room_completed=runtime.coordinator.async_confirm_room_completed,
                managed_user_command=command,
                floor_is_current=floor_is_current,
                floor_token=checkpoint["floor_token"],
                set_activity_run_id=runtime.client.activity_journal.set_run_id,
                get_activity_run_id=runtime.client.activity_journal.current_run_id,
                recovery=run,
                recovered_dispatch=None,
                handoff_expected_identity=handoff_identity or b"",
            )
            reason = (
                "home_assistant_shutdown"
                if _shutdown_suspends_run(hass, manager, serial_number)
                else "restart_execution_ended"
            )
            return
        assert dispatched_at is not None
        records = await runtime.client.async_get_cleaning_session_records()
        hashes = checkpoint.get("history_baseline")
        if not isinstance(hashes, list):
            return
        baseline = frozenset(
            record.key
            for record in records
            if hashlib.sha256(record.key).hexdigest() in hashes
        )
        # Recheck after I/O: Stop, takeover, and map transitions win recovery.
        if (
            cancel.is_set()
            or manager.motion_generation(serial_number) != generation
            or not floor_is_current()
            or await runtime.client.async_get_cleaning_session_identity()
            not in {identity, b""}
        ):
            reason = "restart_recovery_superseded"
            return
        # The same mission was verified above. An explicit end during the
        # history read is a terminal handoff, not a takeover; the executor still
        # requires normal return and native room evidence before crediting it.
        await manager.async_mark_recovery_status(
            serial_number, "running", reason="same_native_mission_verified"
        )
        if cancel.is_set() or manager.motion_generation(serial_number) != generation:
            reason = "restart_recovery_cancelled"
            return

        if verifying:
            # The mission end was observed and persisted before shutdown. Resume
            # only its bounded evidence observer, never dispatch another leg.
            assert verification_deadline is not None
            remaining = (verification_deadline - dt_util.utcnow()).total_seconds()
            if remaining <= 0:
                reason = "restart_verification_expired"
                return
            await manager.async_mark_recovery_status(
                serial_number, "verifying", reason="native_end_previously_observed"
            )

            async def read_history() -> tuple[CleaningSessionRecord, ...]:
                records = await runtime.client.async_get_cleaning_session_records()
                if (
                    cancel.is_set()
                    or manager.motion_generation(serial_number) != generation
                    or not floor_is_current()
                    or await runtime.client.async_get_cleaning_session_identity() != b""
                ):
                    raise HomeAssistantError("Completion recovery was superseded")
                return records

            evidence = await _async_verify_leg_completion(
                read_history,
                baseline,
                leg,
                dispatched_at,
                hass=hass,
                entity_id=entity_id,
                cancel_event=cancel,
                timeout_seconds=remaining,
            )
            completed_ids = set(checkpoint.get("completed_room_ids", []))
            for room in leg:
                if (
                    evidence
                    and room.room_id in evidence
                    and room.room_id not in completed_ids
                ):
                    completed_at, duration = evidence[room.room_id]
                    await manager.async_mark_completed(
                        serial_number,
                        run["plan_id"],
                        room,
                        completed_at=completed_at,
                        duration_seconds=duration,
                    )
                    completed_ids.add(room.room_id)
                    checkpoint["completed_room_ids"] = list(completed_ids)
                    runtime.coordinator.async_confirm_room_completed(room.name)
                    hass.bus.async_fire(
                        f"{DOMAIN}_room_completed",
                        {
                            "entity_id": entity_id,
                            "plan_id": run["plan_id"],
                            "run_id": run["run_id"],
                            "room_id": room.room_id,
                            "room": room.name,
                            "cleaning_mode": room.cleaning_mode,
                            "coverage_setting": room.coverage_setting,
                            "provenance": run["provenance"],
                            "reason_code": "verified_completion",
                        },
                    )
            reason = (
                "all_rooms_verified"
                if room_ids == completed_ids
                else "restart_remaining_queue_unverified"
            )
            return

        await _async_execute_rooms(
            hass,
            ServiceCall(hass, DOMAIN, run["service"], checkpoint["data"]),
            manager,
            entity_id,
            serial_number,
            rooms,
            intelligent=False,
            refresh=runtime.coordinator.async_request_refresh,
            active_session=runtime.client.async_has_active_cleaning_session,
            session_history=partial(
                runtime.client.async_get_cleaning_session_records, strict=True
            ),
            session_identity=runtime.client.async_get_cleaning_session_identity,
            confirm_room_completed=runtime.coordinator.async_confirm_room_completed,
            managed_user_command=command,
            floor_is_current=floor_is_current,
            floor_token=checkpoint["floor_token"],
            set_activity_run_id=runtime.client.activity_journal.set_run_id,
            get_activity_run_id=runtime.client.activity_journal.current_run_id,
            recovery=run,
            recovered_dispatch=_PreparedRoomDispatch(
                tuple(leg),
                baseline,
                dispatched_at,
                native_identity=identity,
                recovered=True,
                completion_deadline=completion_deadline,
            ),
        )
        reason = (
            "home_assistant_shutdown"
            if _shutdown_suspends_run(hass, manager, serial_number)
            else "restart_execution_ended"
        )
    except asyncio.CancelledError:
        if _shutdown_suspends_run(hass, manager, serial_number):
            reason = "home_assistant_shutdown"
        raise
    except (
        HomeAssistantError,
        MaticError,
        KeyError,
        TypeError,
        ValueError,
        IndexError,
        TimeoutError,
    ):
        reason = "restart_recovery_unavailable"
    finally:
        if (
            reason != "home_assistant_shutdown"
            and not _shutdown_suspends_run(hass, manager, serial_number)
            and manager.recovery_run(serial_number) is not None
        ):
            completed = reason == "all_rooms_verified"
            cancellation = manager.cancellation_reason(serial_number)
            replaced = cancellation == "motion_replaced"
            stopped = (
                cancellation == "managed_stop"
                or reason == "restart_stop_requested"
                or checkpoint.get("stop_intent") in {"immediate", "not_running"}
                or (
                    checkpoint.get("phase") in {"verifying", "handoff"}
                    and checkpoint.get("stop_intent") == "after_room"
                    and not completed
                )
            )
            if cancellation == "config_entry_unload":
                reason = "config_entry_unload"
            terminal_state = hass.states.get(checkpoint.get("entity_id", ""))
            terminal_activity = terminal_state.state if terminal_state else "unknown"
            finished = await manager.async_finish_run(
                serial_number,
                run["run_id"],
                "cancelled"
                if replaced or stopped
                else "completed"
                if completed
                else "unverified",
                "managed_replaced"
                if replaced
                else "managed_stop"
                if stopped
                else reason,
                manager.snapshot(serial_number)["last_run"]["completed_room_count"],
                terminal_activity=terminal_activity,
                cause="replacement"
                if replaced
                else "managed_cancellation"
                if stopped
                else "verified_completion"
                if completed
                else "home_assistant",
            )
            if finished:
                summary = manager.snapshot(serial_number)["last_run"]
                hass.bus.async_fire(
                    EVENT_PLAN_FINISHED,
                    {
                        **summary,
                        "entity_id": checkpoint.get("entity_id"),
                        "terminal_activity": terminal_activity,
                        "room_outcomes": _room_outcomes(
                            manager,
                            serial_number,
                            run["plan_id"],
                            run["run_id"],
                            rooms,
                            set(checkpoint.get("completed_room_ids", [])),
                        ),
                    },
                )
        shutdown_suspended = _shutdown_suspends_run(hass, manager, serial_number)
        manager.unregister_run_task(serial_number)
        if not shutdown_suspended:
            restore_stop_settlement()
