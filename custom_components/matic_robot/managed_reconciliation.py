"""Lifecycle-bound late native-history watchers and reconciliation markers."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from time import monotonic
from typing import Any

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .client import (
    CleaningSessionRecord,
    FloorPlan,
    MaticError,
    RobotActivity,
    native_session_hash,
)
from .const import DOMAIN
from .coverage_accounting import (
    async_confirm_completed_coverage,
    coverage_evidence_from_storage,
)
from .managed_run import NativeReconciliation, PreparedRoomDispatch
from .native_completion import match_single_room_completions
from .native_history import OEM_STOP_RECONCILIATION_SECONDS
from .plan_model import (
    CleaningRoom,
)
from .plans import CleaningPlanManager
from .robot_port import RobotPort
from .room_coherence import current_entity_floor_plan, current_room_cadence_identity

_LOGGER = logging.getLogger(__name__)

OEM_STOP_RECONCILIATION_POLL_SECONDS = 5


def schedule_grouped_native_reconciliation(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    pending: dict[str, Any],
    robot: RobotPort,
) -> None:
    """Poll the retained dispatch without sending robot commands."""
    task = hass.async_create_background_task(
        _async_reconcile_grouped_history(
            hass,
            manager,
            serial_number,
            entity_id,
            pending,
            robot,
        ),
        f"{DOMAIN} grouped native history reconciliation",
    )
    manager.control.register_reconciliation_task(serial_number, task)


async def _async_reconcile_grouped_history(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    pending: dict[str, Any],
    robot: RobotPort,
) -> None:
    """Import exact session evidence until this dispatch settles or expires."""
    deadline = monotonic() + OEM_STOP_RECONCILIATION_SECONDS
    while monotonic() < deadline:
        current = manager.ledger.pending_native_reconciliation(serial_number)
        if current is None or any(
            current.get(key) != pending[key]
            for key in ("plan_id", "run_id", "dispatched_at", "session_hash")
        ):
            return
        try:
            records = await robot.session_history()
            floor_plan = current_entity_floor_plan(hass, entity_id)
            await manager.ledger.async_import_native_history(
                serial_number,
                floor_plan,
                records,
                coverage_verifier=robot.coverage_verifier,
                current_floor_plan=lambda: current_entity_floor_plan(hass, entity_id),
            )
        except (MaticError, HomeAssistantError) as err:
            _LOGGER.debug("Grouped native history unavailable (%s)", type(err).__name__)
        await asyncio.sleep(
            min(OEM_STOP_RECONCILIATION_POLL_SECONDS, max(0, deadline - monotonic()))
        )
    dispatched_at = dt_util.parse_datetime(pending["dispatched_at"])
    assert dispatched_at is not None
    await manager.ledger.async_clear_native_reconciliation(
        serial_number, pending["plan_id"], pending["room_id"], dispatched_at
    )


def build_native_reconciliation(
    plan_id: str,
    room: CleaningRoom,
    dispatch: PreparedRoomDispatch | None,
    room_started: bool,
    run_id: str | None,
    floor_token: str,
) -> NativeReconciliation | None:
    """Build a late-native marker only after the robot visibly started the room.

    A marker bound to the dispatch's own session also keeps its floor, which
    history import checks before crediting it.
    """
    if not room_started or dispatch is None:
        return None
    return NativeReconciliation(
        plan_id,
        room.room_id,
        room.name,
        dispatch.dispatched_at,
        room.cleaning_mode,
        run_id,
        room.coverage_setting,
        dispatch.session_hash,
        floor_token if dispatch.session_hash is not None else None,
    )


def native_reconciliation_data(
    value: NativeReconciliation | None,
) -> dict[str, object] | None:
    """Return the JSON-safe durable shape accepted by the plan manager."""
    if value is None:
        return None
    return {
        "plan_id": value.plan_id,
        "room_id": value.room_id,
        "room": value.room,
        "dispatched_at": value.dispatched_at.isoformat(),
        **({"cleaning_mode": value.cleaning_mode} if value.cleaning_mode else {}),
        **({"run_id": value.run_id} if value.run_id else {}),
        **(
            {"session_hash": value.session_hash, "floor_token": value.floor_token}
            if value.session_hash
            else {}
        ),
        **(
            {"coverage_setting": value.coverage_setting}
            if value.coverage_setting
            else {}
        ),
    }


def schedule_native_reconciliation(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    room: CleaningRoom,
    reconciliation: NativeReconciliation | None,
    history_baseline: frozenset[bytes] | None,
    robot: RobotPort,
    context: Context | None,
) -> None:
    """Start a lifecycle-bound watcher for a native session finishing after STOP."""
    if reconciliation is None:
        return
    if history_baseline is not None or reconciliation.session_hash is not None:
        watcher = _async_reconcile_native_stop(
            hass,
            manager,
            serial_number,
            entity_id,
            room,
            reconciliation,
            history_baseline,
            robot,
            context,
        )
    else:
        watcher = _async_expire_native_reconciliation(
            manager, serial_number, room, reconciliation
        )
    task = hass.async_create_background_task(
        watcher, f"{DOMAIN} native stop reconciliation"
    )
    manager.control.register_reconciliation_task(serial_number, task)


async def _async_reconcile_native_stop(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    room: CleaningRoom,
    reconciliation: NativeReconciliation,
    history_baseline: frozenset[bytes] | None,
    robot: RobotPort,
    context: Context | None,
) -> None:
    """Reconcile one late native completion without issuing another motion command.

    Reconciliation exists for a room Home Assistant lost sight of, so it leans
    on the robot's own record.  That record reports a room the robot was
    stopped in exactly like a finished one, so watching the task end in place
    is positive evidence against it: the watcher abandons the marker instead of
    crediting the room its own observation disproves.
    """
    deadline = monotonic() + OEM_STOP_RECONCILIATION_SECONDS
    while monotonic() < deadline:
        state = robot.observed()
        if state is not None and state.activity is RobotActivity.READY:
            _LOGGER.debug(
                "Native Matic reconciliation abandoned: the task ended in place"
            )
            break
        try:
            records = await robot.session_history(
                session_hash=reconciliation.session_hash
            )
        except MaticError as err:
            _LOGGER.debug(
                "Native Matic stop reconciliation read unavailable (%s)",
                type(err).__name__,
            )
            records = ()
        match = _native_completion_match(
            records,
            history_baseline,
            room,
            reconciliation.dispatched_at,
            session_hash=reconciliation.session_hash,
        )
        if match is not None:
            record, duration = match
            pending = manager.ledger.pending_native_reconciliation(serial_number)
            coverage_evidence = coverage_evidence_from_storage(
                pending.get("coverage_evidence") if pending is not None else None
            )
            verified_coverage = await async_confirm_completed_coverage(
                coverage_evidence.receipt if coverage_evidence is not None else None,
                native_session_hash(record.key),
                robot.coverage_verifier,
            )
            current_floor: FloorPlan | None
            try:
                current_floor = current_entity_floor_plan(hass, entity_id)
                current_room_identity = current_room_cadence_identity(
                    hass, entity_id, room.room_id
                )
            except HomeAssistantError:
                current_floor = current_room_identity = None
            completed = await manager.ledger.async_mark_native_completed(
                serial_number,
                reconciliation.plan_id,
                room,
                dispatched_at=reconciliation.dispatched_at,
                completed_at=record.session.ended_at,
                duration_seconds=duration,
                room_identity=current_room_identity,
                verified_coverage_receipt=verified_coverage,
                floor_plan=current_floor,
            )
            if completed:
                robot.confirm_room_completed(room.name)
                hass.bus.async_fire(
                    f"{DOMAIN}_room_reconciled",
                    {
                        ATTR_ENTITY_ID: entity_id,
                        "plan_id": reconciliation.plan_id,
                        "room_id": room.room_id,
                        "room": room.name,
                        "native_stop_reconciled": True,
                        "reason_code": "native_reconciled_completion",
                        "cause": "late_native_history",
                        **(
                            {"run_id": reconciliation.run_id}
                            if reconciliation.run_id
                            else {}
                        ),
                    },
                    context=context,
                )
                _LOGGER.debug("Native Matic completion reconciled after OEM STOP")
            return
        await asyncio.sleep(OEM_STOP_RECONCILIATION_POLL_SECONDS)
    await manager.ledger.async_clear_native_reconciliation(
        serial_number,
        reconciliation.plan_id,
        room.room_id,
        reconciliation.dispatched_at,
    )
    _LOGGER.debug("Native Matic completion was not observed after OEM STOP settle")


async def _async_expire_native_reconciliation(
    manager: CleaningPlanManager,
    serial_number: str,
    room: CleaningRoom,
    reconciliation: NativeReconciliation,
) -> None:
    """Expire a durable marker when no safe history baseline exists."""
    await asyncio.sleep(OEM_STOP_RECONCILIATION_SECONDS)
    await manager.ledger.async_clear_native_reconciliation(
        serial_number,
        reconciliation.plan_id,
        room.room_id,
        reconciliation.dispatched_at,
    )
    _LOGGER.debug("Native Matic reconciliation expired without a history baseline")


def _native_completion_match(
    records: tuple[CleaningSessionRecord, ...],
    baseline: frozenset[bytes] | None,
    room: CleaningRoom,
    dispatched_at: datetime,
    *,
    session_hash: str | None = None,
) -> tuple[CleaningSessionRecord, int] | None:
    """Find one new, completed, single-room native record for a dispatch."""
    matches = match_single_room_completions(
        records,
        baseline=baseline,
        session_hash=session_hash,
        room_name=room.name,
        cleaning_mode=room.cleaning_mode,
        dispatched_at=dispatched_at,
        now=dt_util.utcnow(),
        legacy_policy="aggregate",
    )
    if len(matches) != 1:
        return None
    return matches[0].record, matches[0].duration_seconds
