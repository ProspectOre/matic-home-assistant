"""Guarded managed commands, identity recovery and stop settlement."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from functools import partial
from typing import Any
from uuid import UUID, uuid4

from google.protobuf.message import DecodeError
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import Context, HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from . import managed_observation as observation
from . import managed_run
from .client.commands import UserCommand
from .client.exceptions import MaticError
from .client.models import CleaningSessionRecord
from .client.wire import uuid_string
from .managed_run import (
    NativeHistoryBaselineUnavailableError,
    RoomTakenOverError,
    _PreparedRoomDispatch,
)
from .plan_model import (
    PLAN_FLOOR_TOKEN,
    PLAN_MOTION_TOKEN,
    PLAN_SESSION_ID,
    AreaLeg,
    CleaningRoom,
    effective_room_settings,
    normalize_run_provenance,
)
from .plans import CleaningPlanManager
from .run_control import ManagedMotionReplacedError
from .stop_return import (
    async_clear_ownerless_stop_if_settled,
    schedule_dock_after_stop,
)

_LOGGER = logging.getLogger(__name__)

DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS = 10


def _shutdown_suspends_run(
    hass: HomeAssistant, manager: CleaningPlanManager, serial_number: str
) -> bool:
    """Distinguish HA shutdown from an explicit stop, replacement, or unload."""
    reader = manager.control.cancellation_reason
    reason = reader(serial_number)
    if reason in {"managed_stop", "motion_replaced", "config_entry_unload"}:
        return False
    return reason == "home_assistant_shutdown" or (
        getattr(hass, "is_stopping", False) is True
    )


async def _async_managed_user_command(
    hass: HomeAssistant,
    entry: ConfigEntry,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    context: Context | None,
    token: int,
    command: UserCommand,
) -> None:
    """Use the same ownership, stop fence and dock settlement for every run."""
    runtime = entry.runtime_data
    stop_run_id = (
        manager.ledger.active_run_id(serial_number)
        if command is UserCommand.STOP
        else None
    )
    async with manager.control.managed_command(
        serial_number, token, teardown_cleanup=command is UserCommand.STOP
    ):
        await runtime.client.async_send_user_command(command)
        if command is UserCommand.STOP:
            await manager.control.async_mark_stop_pending(
                serial_number, run_id=stop_run_id
            )
        await runtime.coordinator.async_request_refresh()
    if command is UserCommand.STOP:
        _schedule_managed_dock_after_stop(
            hass, entry, manager, serial_number, entity_id, stop_run_id, context
        )


def _schedule_managed_dock_after_stop(
    hass: HomeAssistant,
    entry: ConfigEntry,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    run_id: str | None,
    context: Context | None,
) -> None:
    """Bind fresh or restored settlement to the same run and native guards."""
    runtime = entry.runtime_data
    journal = getattr(runtime.client, "activity_journal", None)
    stop_fence_token_reader = manager.control.stop_fence_token
    stop_fence_token = stop_fence_token_reader(serial_number)
    schedule_dock_after_stop(
        hass,
        client=runtime.client,
        refresh=runtime.coordinator.async_request_refresh,
        manager=manager,
        serial_number=serial_number,
        entity_id=entity_id,
        run_id=run_id,
        set_run_id=getattr(journal, "set_run_id", None),
        get_run_id=getattr(journal, "current_run_id", None),
        on_docked=partial(
            _async_mark_run_docked,
            manager,
            serial_number,
            run_id,
            entity_id,
            context,
            stop_fence_token,
        ),
    )


async def _async_dispatch_leg_command(
    hass: HomeAssistant,
    call: ServiceCall,
    entity_id: str,
    rooms: Sequence[CleaningRoom] | AreaLeg,
    motion_token: int | None,
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
    *,
    floor_is_current: Callable[[], bool] | None = None,
    floor_token: str | None = None,
    on_dispatch: Callable[[], None] | None = None,
    session_identity: Callable[[], Awaitable[bytes | None]] | None = None,
    on_identity: Callable[[bytes | None], None] | None = None,
    expected_dispatch_identity: bytes | None = None,
    expected_dispatch_history: frozenset[str] | None = None,
) -> _PreparedRoomDispatch:
    """Issue one owned leg mission with its completion-history baseline.

    A custom area leg is its own mission, started through the vacuum's
    integration-private ``clean_plan_area`` command with the same ownership.
    """
    area = rooms if isinstance(rooms, AreaLeg) else None
    leg = () if isinstance(rooms, AreaLeg) else tuple(rooms)
    if floor_is_current is not None and not floor_is_current():
        raise managed_run._validation_error(
            "The robot's room map is unavailable", "room_plan_unavailable"
        )
    history_baseline = await observation._async_session_history_baseline(
        session_history
    )
    if session_history is not None and history_baseline is None:
        # A configured native-history reader that failed is different from a
        # legacy caller that has no reader. Dispatching in the former case
        # guarantees that completion cannot be attributed to this mission.
        raise NativeHistoryBaselineUnavailableError(
            "The robot's cleaning history could not be read. "
            "Try again before starting this plan."
        )
    if expected_dispatch_history is not None and (
        history_baseline is None
        or frozenset(hashlib.sha256(key).hexdigest() for key in history_baseline)
        != expected_dispatch_history
    ):
        raise RoomTakenOverError("Native history changed during the handoff boundary")
    identity_baseline: bytes | None = None
    for attempt in range(observation.ACTIVE_SESSION_UNKNOWN_ATTEMPTS):
        identity_baseline = await observation._async_read_session_identity(
            session_identity
        )
        if session_identity is None or identity_baseline is not None:
            break
        if attempt + 1 < observation.ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
            await asyncio.sleep(observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
    if session_identity is not None and identity_baseline is None:
        raise RoomTakenOverError(
            "The native task before dispatch could not be verified"
        )
    if expected_dispatch_identity is not None and not (
        identity_baseline == expected_dispatch_identity
        or (expected_dispatch_identity != b"" and identity_baseline == b"")
    ):
        raise RoomTakenOverError("The native task changed during the handoff boundary")
    if floor_is_current is not None and not floor_is_current():
        raise managed_run._validation_error(
            "The robot's room map is unavailable", "room_plan_unavailable"
        )
    managed_session_id = uuid4() if motion_token is not None else None
    dispatched_at = dt_util.utcnow()
    params: dict[str, Any]
    if area is not None:
        command = "clean_plan_area"
        params = {
            "area": area.area_id,
            "fingerprint": area.fingerprint,
            "cleaning_mode": area.cleaning_mode,
            "coverage": area.coverage_setting,
        }
    else:
        command = "clean_rooms"
        params = {
            "rooms": [room.room_id for room in leg],
            "cleaning_mode": leg[0].cleaning_mode,
            "coverage": leg[0].coverage_setting,
            "ordered": len(leg) > 1,
        }
        if len({effective_room_settings(room) for room in leg}) > 1:
            params["room_coverage"] = [room.coverage_setting for room in leg]
            params["room_modes"] = [room.cleaning_mode for room in leg]
    if motion_token is not None:
        params[PLAN_MOTION_TOKEN] = motion_token
    if managed_session_id is not None:
        params[PLAN_SESSION_ID] = str(managed_session_id)
    if floor_token is not None:
        params[PLAN_FLOOR_TOKEN] = floor_token
    if on_dispatch is not None:
        on_dispatch()
    try:
        await hass.services.async_call(
            VACUUM_DOMAIN,
            "send_command",
            {
                ATTR_ENTITY_ID: entity_id,
                "command": command,
                "params": params,
            },
            blocking=True,
            context=call.context,
        )
    except asyncio.CancelledError:
        try:
            identity = await _async_recover_managed_dispatch_identity(
                session_identity,
                managed_session_id,
                identity_baseline,
            )
            if identity is not None and on_identity is not None:
                on_identity(identity)
        except asyncio.CancelledError:
            # Preserve the original cancellation while keeping recovery
            # bounded; an additional cancellation must not strand the caller.
            pass
        raise
    except Exception:
        # A tracked vacuum service can fail after START reached Hermes, for
        # example when settings readback times out. Recover cleanup ownership
        # only when the robot reports the exact session UUID carried by that
        # command; a changed or merely different identity is never ours to stop.
        identity = await _async_recover_managed_dispatch_identity(
            session_identity,
            managed_session_id,
            identity_baseline,
        )
        if identity is not None and on_identity is not None:
            on_identity(identity)
        raise
    observed = await observation._async_read_session_identity(session_identity)
    identity = observed if observed and observed != identity_baseline else None
    if managed_session_id is not None and session_identity is not None:
        if identity is not None and not _identity_matches_session(
            identity, managed_session_id
        ):
            # A newly observed foreign identity is explicit takeover evidence.
            # Do not keep polling until a later value happens to match ours.
            raise RoomTakenOverError(
                "The dispatched native task was replaced before readback"
            )
        if identity is None or not _identity_matches_session(
            identity, managed_session_id
        ):
            identity = await _async_recover_managed_dispatch_identity(
                session_identity,
                managed_session_id,
                identity_baseline,
            )
        if identity is None or not _identity_matches_session(
            identity, managed_session_id
        ):
            raise RoomTakenOverError(
                "The dispatched native task could not be verified after readback"
            )
    if on_identity is not None:
        on_identity(identity)
    return _PreparedRoomDispatch(
        leg, history_baseline, dispatched_at, identity_baseline, identity
    )


def _identity_matches_session(identity: bytes, session_id: UUID) -> bool:
    """Correlate an opaque native identity to the UUID in our dispatched command."""
    try:
        return uuid_string(identity) == str(session_id)
    except DecodeError:
        return False


async def _async_recover_managed_dispatch_identity(
    reader: Callable[[], Awaitable[bytes | None]] | None,
    session_id: UUID | None,
    baseline: bytes | None,
) -> bytes | None:
    """Boundedly recover only this command's identity after an uncertain write."""
    if reader is None or session_id is None:
        return None
    try:
        async with asyncio.timeout(DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS):
            while True:
                observed = await observation._async_read_session_identity(reader)
                if observed and observed != baseline:
                    return (
                        observed
                        if _identity_matches_session(observed, session_id)
                        else None
                    )
                await asyncio.sleep(observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS)
    except TimeoutError:
        return None


def _guard_native_commands(
    sender: Callable[[int, UserCommand], Awaitable[None]] | None,
    manager: CleaningPlanManager,
    serial_number: str,
    reader: Callable[[], Awaitable[bytes | None]] | None,
    expected_identity: Callable[[], bytes | None],
    *,
    allow_ended_dock: bool = False,
) -> Callable[[int, UserCommand], Awaitable[None]] | None:
    """Recheck native ownership at cleanup, including cancellation/unload races."""
    if sender is None or reader is None:
        return sender

    async def send(token: int, command: UserCommand) -> None:
        expected = expected_identity()
        identity = await observation._async_read_session_identity(reader)
        ended_dock = (
            allow_ended_dock and command is UserCommand.DOCK and identity == b""
        )
        if not expected or (identity != expected and not ended_dock):
            # Revoke local ownership too, so outer abort cleanup and late
            # history reconciliation cannot act for this obsolete mission.
            await manager.control.async_replace_managed_motion(serial_number)
            raise ManagedMotionReplacedError("Native task ownership was lost")
        await sender(token, command)

    return send


async def _async_cleanup_managed_motion(
    sender: Callable[[int, UserCommand], Awaitable[None]] | None,
    motion_token: int | None,
    dispatch_attempted: bool,
) -> None:
    """Best-effort STOP an accepted task without replacing newer ownership.

    STOP is intentionally the only cleanup command here.  Matic's firmware
    owns the ten-minute graceful countdown and will dock after it settles;
    sending DOCK immediately can turn that stop into a recharge-and-resume.
    """
    if sender is None or motion_token is None or not dispatch_attempted:
        return
    try:
        await sender(motion_token, UserCommand.STOP)
        _LOGGER.debug("Matic managed STOP accepted; waiting for OEM settle")
    except (HomeAssistantError, MaticError, ManagedMotionReplacedError) as err:
        _LOGGER.warning(
            "Unable to stop a failed managed Matic motion before cleanup (%s)",
            type(err).__name__,
        )


def _managed_stop_fence_owned_by_run(
    manager: CleaningPlanManager,
    serial_number: str,
    run_id: str | None,
) -> bool:
    """Return whether an already-transmitted STOP belongs to this managed run."""
    pending_stop_run_id = manager.control.pending_stop_run_id
    return run_id is not None and pending_stop_run_id(serial_number) == run_id


@asynccontextmanager
async def _managed_reconciliation_guard(
    manager: CleaningPlanManager,
    serial_number: str,
    motion_token: int | None,
) -> AsyncIterator[bool]:
    """Serialize durable reconciliation against replacement command dispatch."""
    if motion_token is None:
        yield True
        return
    async with manager.control.managed_reconciliation(
        serial_number, motion_token
    ) as current:
        yield bool(current)


def _managed_reconciliation_is_current(
    manager: CleaningPlanManager,
    serial_number: str,
    motion_token: int | None,
) -> bool:
    """Recheck ownership after a durable marker write yields to other tasks."""
    return motion_token is None or manager.control.managed_motion_is_current(
        serial_number, motion_token
    )


def _suspended_run_reason(
    manager: CleaningPlanManager, serial_number: str
) -> str | None:
    """Capture a low-charge suspension before room cleanup clears its marker."""
    snapshot = manager.ledger.snapshot
    active = snapshot(serial_number).get("active_plan")
    if isinstance(active, dict) and (
        active.get("status") == "suspended"
        and active.get("suspend_reason") == "low_charge"
    ):
        return "low_charge"
    return None


def _run_provenance(call: ServiceCall) -> str:
    """Return bounded trigger provenance without retaining account identity."""
    context = call.context
    if getattr(context, "parent_id", None):
        return "automation"
    if getattr(context, "user_id", None):
        return "user"
    return normalize_run_provenance(None)


async def _async_mark_run_docked(
    manager: CleaningPlanManager,
    serial_number: str,
    run_id: str | None,
    entity_id: str,
    context: Context | None,
    stop_fence_token: int | None = None,
) -> bool:
    """Bridge the stop watcher to durable run closure for service calls."""
    if run_id is None:
        return False
    snapshot_reader = manager.ledger.snapshot
    snapshot = snapshot_reader(serial_number)
    last_run = snapshot.get("last_run") if isinstance(snapshot, dict) else None
    if isinstance(last_run, dict) and (
        last_run.get("run_id") == run_id and last_run.get("outcome") == "running"
    ):
        cancellation_reader = manager.control.cancellation_reason
        cancellation_reason = cancellation_reader(serial_number)
        if cancellation_reason != "managed_stop":
            return False
    if (
        isinstance(last_run, dict)
        and last_run.get("run_id") == run_id
        and last_run.get("outcome") == "failed"
        and stop_fence_token is not None
    ):
        # A failed room stays failed after physically returning home. Only
        # clear its captured STOP fence; never upgrade outcome or credit.
        return await manager.control.async_clear_stop_pending_if_token(
            serial_number, stop_fence_token, run_id=run_id
        )
    return await manager.ledger.async_mark_run_docked(
        serial_number,
        run_id,
        entity_id=entity_id,
        context=context,
        stop_fence_token=stop_fence_token,
    )


async def _ensure_stop_settled(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    native_active: Callable[[], Awaitable[bool | None]] | None = None,
    fresh_state: Callable[[], Awaitable[object]] | None = None,
) -> None:
    """Reject replacement plans while the OEM stop countdown is still active."""
    if not manager.control.stop_pending(serial_number):
        return
    direct_state = fresh_state or getattr(
        getattr(native_active, "__self__", None), "async_get_state", None
    )
    if native_active is not None and await async_clear_ownerless_stop_if_settled(
        hass,
        native_active=native_active,
        fresh_state=direct_state,
        manager=manager,
        serial_number=serial_number,
        entity_id=entity_id,
    ):
        return
    raise managed_run._validation_error(
        "The robot is stopping; wait until it docks",
        "robot_stop_pending",
    )


def _stop_is_pending(manager: CleaningPlanManager, serial_number: str) -> bool:
    """Read the OEM stop fence when the active manager supports it."""
    pending = manager.control.stop_pending
    return bool(pending(serial_number))
