"""Reattach durable managed runs without replaying accepted robot commands."""

from __future__ import annotations

import asyncio
import hashlib
from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .client.commands import UserCommand
from .client.exceptions import MaticError
from .const import DOMAIN, EVENT_PLAN_FINISHED
from .plans import CleaningRoom, leg_groups, plan_floor_token
from .services import (
    _async_execute_rooms,
    _PreparedRoomDispatch,
    _room_outcomes,
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
    runtime = entry.runtime_data
    manager = runtime.cleaning_plans
    run = manager.recovery_run(serial_number)
    if run is None:
        return
    manager.register_run_task(serial_number)
    cancel = manager.prepare_run(serial_number)
    generation = manager.motion_generation(serial_number)
    reason = "restart_checkpoint_unverified"
    rooms: list[CleaningRoom] = []
    try:
        checkpoint = run["recovery_checkpoint"]
        if checkpoint.get("stop_intent") in {"immediate", "not_running"}:
            reason = "restart_stop_requested"
            return
        if checkpoint.get("version") != 1 or checkpoint.get("phase") != "accepted":
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
        expected = checkpoint.get("native_identity_hash")
        if not isinstance(expected, str) or len(expected) != 64:
            return
        legs = leg_groups(rooms)
        leg = legs[checkpoint["leg_index"]]
        dispatched_at = dt_util.parse_datetime(checkpoint["dispatched_at"])
        if dispatched_at is None or dispatched_at.tzinfo is None:
            return
        deadline_value = checkpoint.get("completion_deadline")
        completion_deadline = (
            dt_util.parse_datetime(deadline_value)
            if isinstance(deadline_value, str)
            else None
        )
        if deadline_value is not None and (
            completion_deadline is None or completion_deadline.tzinfo is None
        ):
            return
        entity_id = er.async_get(hass).async_get_entity_id(
            "vacuum", DOMAIN, f"{serial_number}_vacuum"
        )
        if entity_id is None:
            return

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
        if not identity or hashlib.sha256(identity).hexdigest() != expected:
            reason = "restart_native_mission_changed_or_ended"
            return
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

        async def command(token: int, value: UserCommand) -> None:
            async with manager.managed_command(serial_number, token):
                await runtime.client.async_send_user_command(value)
                if value is UserCommand.STOP:
                    await manager.async_mark_stop_pending(serial_number)
                await runtime.coordinator.async_request_refresh()

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
            session_history=runtime.client.async_get_cleaning_session_records,
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
    except HomeAssistantError, MaticError, KeyError, TypeError, ValueError, IndexError:
        reason = "restart_recovery_unavailable"
    finally:
        if (
            reason != "home_assistant_shutdown"
            and not _shutdown_suspends_run(hass, manager, serial_number)
            and manager.recovery_run(serial_number) is not None
        ):
            stopped = manager.cancellation_reason(
                serial_number
            ) == "managed_stop" or checkpoint.get("stop_intent") in {
                "immediate",
                "not_running",
            }
            completed = reason == "all_rooms_verified"
            finished = await manager.async_finish_run(
                serial_number,
                run["run_id"],
                "cancelled" if stopped else "completed" if completed else "unverified",
                "managed_stop" if stopped else reason,
                manager.snapshot(serial_number)["last_run"]["completed_room_count"],
                cause="managed_cancellation"
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
                        "terminal_activity": "unknown",
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
        manager.unregister_run_task(serial_number)
