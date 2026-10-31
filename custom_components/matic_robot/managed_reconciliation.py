"""Lifecycle-bound late native-history watchers and reconciliation markers."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime
from time import monotonic
from typing import Any

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .client.coverage_receipts import CoverageVerifier, native_session_hash
from .client.exceptions import MaticError
from .client.models import CleaningSessionRecord
from .const import DOMAIN
from .coverage_accounting import (
    async_confirm_completed_coverage,
    coverage_evidence_from_storage,
)
from .managed_run import (
    _NativeReconciliation,
)
from .native_completion import match_single_room_completions
from .native_history import OEM_STOP_RECONCILIATION_SECONDS
from .plan_model import (
    CleaningRoom,
)
from .plans import CleaningPlanManager
from .room_coherence import current_entity_floor_plan, current_room_cadence_identity

_LOGGER = logging.getLogger(__name__)

OEM_STOP_RECONCILIATION_POLL_SECONDS = 5


def _schedule_grouped_native_reconciliation(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    pending: dict[str, Any],
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
    coverage_verifier: CoverageVerifier | None,
) -> None:
    """Poll the retained dispatch without sending robot commands."""
    task = hass.async_create_background_task(
        _async_reconcile_grouped_history(
            hass,
            manager,
            serial_number,
            entity_id,
            pending,
            session_history,
            coverage_verifier,
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
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
    coverage_verifier: CoverageVerifier | None,
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
        state = hass.states.get(entity_id)
        if state is not None and state.state == "idle":
            break
        if session_history is not None:
            try:
                records = await session_history()
                floor_plan = current_entity_floor_plan(hass, entity_id)
                await manager.ledger.async_import_native_history(
                    serial_number,
                    floor_plan,
                    records,
                    coverage_verifier=coverage_verifier,
                    current_floor_plan=lambda: current_entity_floor_plan(
                        hass, entity_id
                    ),
                )
            except (MaticError, HomeAssistantError) as err:
                _LOGGER.debug(
                    "Grouped native history unavailable (%s)", type(err).__name__
                )
        await asyncio.sleep(
            min(OEM_STOP_RECONCILIATION_POLL_SECONDS, max(0, deadline - monotonic()))
        )
    dispatched_at = dt_util.parse_datetime(pending["dispatched_at"])
    assert dispatched_at is not None
    await manager.ledger.async_clear_native_reconciliation(
        serial_number, pending["plan_id"], pending["room_id"], dispatched_at
    )


def _build_native_reconciliation(
    plan_id: str,
    room: CleaningRoom,
    dispatched_at: datetime | None,
    room_started: bool,
    *,
    run_id: str | None = None,
) -> _NativeReconciliation | None:
    """Build a late-native marker only after the robot visibly started the room."""
    if not room_started or dispatched_at is None:
        return None
    return _NativeReconciliation(
        plan_id,
        room.room_id,
        room.name,
        dispatched_at,
        room.cleaning_mode,
        run_id,
        room.coverage_setting,
    )


def _native_reconciliation_data(
    value: _NativeReconciliation | None,
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
            {"coverage_setting": value.coverage_setting}
            if value.coverage_setting
            else {}
        ),
    }


def _schedule_native_reconciliation(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    room: CleaningRoom,
    reconciliation: _NativeReconciliation | None,
    history_baseline: frozenset[bytes] | None,
    active_session: Callable[[], Awaitable[bool | None]] | None,
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]] | None,
    confirm_room_completed: Callable[[str], None] | None,
    context: Context | None,
    coverage_verifier: CoverageVerifier | None = None,
) -> None:
    """Start a lifecycle-bound watcher for a native session finishing after STOP."""
    if reconciliation is None:
        return
    create_background_task = getattr(hass, "async_create_background_task", None)
    if not callable(create_background_task):
        return
    if history_baseline is not None and session_history is not None:
        watcher = _async_reconcile_native_stop(
            hass,
            manager,
            serial_number,
            entity_id,
            room,
            reconciliation,
            history_baseline,
            active_session,
            session_history,
            confirm_room_completed,
            context,
            coverage_verifier=coverage_verifier,
        )
    else:
        watcher = _async_expire_native_reconciliation(
            hass,
            manager,
            serial_number,
            entity_id,
            room,
            reconciliation,
        )
    task = create_background_task(
        watcher,
        f"{DOMAIN} native stop reconciliation",
    )
    register_task = manager.control.register_reconciliation_task
    if isinstance(task, asyncio.Task):
        register_task(serial_number, task)


async def _async_reconcile_native_stop(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    room: CleaningRoom,
    reconciliation: _NativeReconciliation,
    history_baseline: frozenset[bytes],
    active_session: Callable[[], Awaitable[bool | None]] | None,
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]],
    confirm_room_completed: Callable[[str], None] | None,
    context: Context | None,
    coverage_verifier: CoverageVerifier | None = None,
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
        state = hass.states.get(entity_id)
        if state is not None and state.state == "idle":
            _LOGGER.debug(
                "Native Matic reconciliation abandoned: the task ended in place"
            )
            break
        try:
            records = await session_history()
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
                coverage_verifier,
            )
            try:
                current_room_identity = current_room_cadence_identity(
                    hass, entity_id, room.room_id
                )
            except HomeAssistantError:
                current_room_identity = None
            completed = await manager.ledger.async_mark_native_completed(
                serial_number,
                reconciliation.plan_id,
                room,
                dispatched_at=reconciliation.dispatched_at,
                completed_at=record.session.ended_at,
                duration_seconds=duration,
                room_identity=current_room_identity,
                verified_coverage_receipt=verified_coverage,
            )
            if completed:
                if confirm_room_completed is not None:
                    confirm_room_completed(room.name)
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
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    room: CleaningRoom,
    reconciliation: _NativeReconciliation,
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
    baseline: frozenset[bytes],
    room: CleaningRoom,
    dispatched_at: datetime,
) -> tuple[CleaningSessionRecord, int] | None:
    """Find one new, completed, single-room native record for a dispatch."""
    matches = match_single_room_completions(
        records,
        baseline=baseline,
        room_name=room.name,
        cleaning_mode=room.cleaning_mode,
        dispatched_at=dispatched_at,
        now=dt_util.utcnow(),
        legacy_policy="aggregate",
    )
    if len(matches) != 1:
        return None
    return matches[0].record, matches[0].duration_seconds
