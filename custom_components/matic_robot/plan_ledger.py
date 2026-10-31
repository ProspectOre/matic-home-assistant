"""Durable run checkpoints, room accounting and native-history commits."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import (
    Callable,
    Iterable,
    Mapping,
    Sequence,
)
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime
from typing import Any, cast
from uuid import UUID

from homeassistant.core import Context, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from . import native_history, plan_storage, plan_timing
from .cadence_accounting import apply_verified_cadence as _apply_verified_cadence
from .cadence_accounting import (
    validated_cadence_snapshots as _validated_cadence_snapshots,
)
from .client.coverage_receipts import (
    CoverageReceipt,
    CoverageVerifier,
    coverage_floor_hash,
    coverage_region_hash,
    native_session_hash,
)
from .client.models import CleaningSessionRecord, FloorPlan
from .const import (
    DOMAIN,
    EVENT_PLAN_DOCKED,
    MAX_ROOM_SEQUENCE_SIZE,
)
from .coverage_accounting import (
    CoverageEvidence,
    async_confirm_completed_coverage,
    coverage_evidence_from_storage,
    verified_room_coverage,
)
from .plan_cadence import (
    PlanCadence,
)
from .plan_catalog import PlanCatalog
from .plan_model import (
    AreaLeg,
    CleaningRoom,
    _bounded_stop_threshold,
    _dispatching_room_leg,
    _has_frozen_stop_policy,
    _is_manual_room_sequence_plan_id,
    _managed_stop_policy,
    checkpoint_legs,
    normalize_run_outcome,
    normalize_run_provenance,
    plan_floor_token,
)
from .plan_repository import (
    PlanRepository,
    _MetadataLockLease,
)
from .run_control import (
    RunControl,
)
from .run_history import append_run_history, history_entries, update_run_history

_LOGGER = logging.getLogger(__name__)


def _close_unfinished_area_records(
    robot: dict[str, Any], *, ended_at: str, run_id: str | None = None
) -> bool:
    """Retain accepted opportunities without inventing success after a stop/restart."""
    changed = False
    containers = [
        robot["area_history"],
        *(rotation.get("areas", {}) for rotation in robot["rotations"].values()),
    ]
    for records in containers:
        for record in records.values():
            if record.get("last_result") == "running" and (
                run_id is None or record.get("run_id") == run_id
            ):
                record.update(
                    {
                        "last_result": "ended_unverified",
                        "last_ended_unverified": ended_at,
                    }
                )
                changed = True
    return changed


def _skip_room_record(
    record: dict[str, Any],
    global_room: dict[str, Any],
    *,
    run_id: str,
    skipped_at: str,
) -> None:
    """Close a skipped room without credit and give back its rotation turn."""
    record["last_result"] = "skipped"
    record["last_skipped"] = skipped_at
    record["skipped_runs"] = plan_timing._stored_count(record, "skipped_runs") + 1
    for target in (record, global_room):
        baseline = target.pop("opportunity_before_run", None)
        if not isinstance(baseline, Mapping) or baseline.get("run_id") != run_id:
            continue
        previous = baseline.get("value")
        if isinstance(previous, str):
            target["last_opportunity"] = previous
        else:
            target.pop("last_opportunity", None)


def _close_unfinished_room_records(
    robot: dict[str, Any],
    *,
    plan_id: str | None = None,
    run_id: str | None = None,
    ended_at: str | None = None,
    recovered_at: str | None = None,
    skipped: frozenset[str] = frozenset(),
) -> list[dict[str, str]]:
    """Close attempts lacking terminal evidence without inventing completion.

    A room the owner skipped during ``run_id`` closes as skipped instead, and
    its entry carries ``"result": "skipped"``.
    """
    closed = []
    for record_plan_id, rotation in robot["rotations"].items():
        if plan_id is not None and record_plan_id != plan_id:
            continue
        for room_id, record in rotation["rooms"].items():
            previous = record.get("last_result")
            if (
                not isinstance(previous, str)
                or previous not in {"running", "suspended", "verifying"}
                or (run_id is not None and record.get("run_id") != run_id)
            ):
                continue
            if room_id in skipped and run_id is not None and ended_at is not None:
                global_room = robot["rooms"].get(room_id)
                _skip_room_record(
                    record,
                    global_room if isinstance(global_room, dict) else {},
                    run_id=run_id,
                    skipped_at=ended_at,
                )
            else:
                record["last_result"] = "ended_unverified"
                record["unverified_runs"] = (
                    plan_timing._stored_count(record, "unverified_runs") + 1
                )
            if ended_at is not None and room_id not in skipped:
                record["last_ended_unverified"] = ended_at
            if recovered_at is not None:
                record["recovered_at"] = recovered_at
                record["last_result_before_recovery"] = previous
            closed.append(
                {
                    "plan_id": record_plan_id,
                    "room_id": room_id,
                    "room": str(record.get("name", room_id)),
                    **{
                        key: record[key]
                        for key in ("cleaning_mode", "coverage_setting")
                        if isinstance(record.get(key), str)
                    },
                    "result": record["last_result"],
                }
            )
    return closed


class PlanLedger:
    """Account for observed runs without confusing activity with completion."""

    def __init__(
        self,
        cadence: PlanCadence,
        catalog: PlanCatalog,
        control: RunControl,
        repository: PlanRepository,
    ) -> None:
        self.cadence = cadence
        self.catalog = catalog
        self.control = control
        self.repository = repository

    @callback
    def pending_native_reconciliation(
        self, serial_number: str
    ) -> dict[str, Any] | None:
        """Return a copy of the exact late-completion marker, when present."""
        pending = native_history._validated_native_reconciliation(
            self.repository.robot(serial_number).get("pending_native_reconciliation")
        )
        return deepcopy(pending) if pending is not None else None

    async def async_import_native_history(
        self,
        serial_number: str,
        floor_plan: FloorPlan | None,
        records: Iterable[CleaningSessionRecord],
        *,
        generation: int | None = None,
        coverage_verifier: CoverageVerifier | None = None,
        current_floor_plan: Callable[[], FloorPlan | None] | None = None,
    ) -> bool:
        """Import native activity and reconcile only the matching pending room."""
        if floor_plan is None:
            return False
        entry_generation = self.control.robot_generation(serial_number)
        proof_generation = self.control.motion_generation(serial_number)
        records = tuple(records)
        proof_pending = self.pending_native_reconciliation(serial_number)
        verified_coverage = None
        if proof_pending is not None:
            evidence_candidates = {
                evidence
                for marker in (proof_pending, *proof_pending.get("rooms", ()))
                if (
                    evidence := coverage_evidence_from_storage(
                        marker.get("coverage_evidence")
                    )
                )
                is not None
            }
            evidence = (
                next(iter(evidence_candidates))
                if len(evidence_candidates) == 1
                else None
            )
            if (
                evidence is not None
                and evidence.receipt.floor_hash == coverage_floor_hash(floor_plan)
            ):
                matches = next(
                    (
                        matched
                        for marker in proof_pending.get("rooms", [proof_pending])
                        if len(
                            matched := native_history._native_marker_matches(
                                records, marker
                            )
                        )
                        == 1
                    ),
                    (),
                )
                if len(matches) == 1:
                    verified_coverage = await async_confirm_completed_coverage(
                        evidence.receipt,
                        native_session_hash(matches[0].record.key),
                        coverage_verifier,
                    )
        reconciled: list[dict[str, Any]] = []

        async def commit(lease: _MetadataLockLease) -> bool:
            motion_generation = self.control.motion_generation(serial_number)
            lease.release(self.control.command_lock(serial_number))
            async with self.repository.store_lock:
                if (
                    serial_number in self.repository.removed_robots
                    or self.control.robot_generation(serial_number) != entry_generation
                    or self.control.motion_generation(serial_number)
                    != motion_generation
                    or (
                        generation is not None
                        and generation != self.control.robot_generation(serial_number)
                    )
                ):
                    return False
                return await self.async_import_native_history_transaction(
                    serial_number,
                    floor_plan,
                    records,
                    generation=generation,
                    reconciled=reconciled,
                    verified_coverage_receipt=verified_coverage
                    if proof_generation == motion_generation
                    and self.pending_native_reconciliation(serial_number)
                    == proof_pending
                    and current_floor_plan is not None
                    and (current_floor := current_floor_plan()) is not None
                    and plan_floor_token(current_floor) == plan_floor_token(floor_plan)
                    else None,
                )

        def after_commit(changed: bool) -> None:
            if not changed:
                return
            self.repository.notify_listeners(serial_number)
            for marker in reconciled:
                entity_id = er.async_get(self.repository.hass).async_get_entity_id(
                    "vacuum", DOMAIN, f"{serial_number}_vacuum"
                )
                self.repository.hass.bus.async_fire(
                    f"{DOMAIN}_room_reconciled",
                    {
                        **({"entity_id": entity_id} if entity_id else {}),
                        "plan_id": marker["plan_id"],
                        "room_id": marker["room_id"],
                        "room": marker["room"],
                        **(
                            {"run_id": marker["run_id"]} if marker.get("run_id") else {}
                        ),
                        "native_stop_reconciled": True,
                        "reason_code": "native_reconciled_completion",
                        "cause": "late_native_history",
                    },
                )

        result = await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(
                self.repository.plan_write_lock(serial_number),
                self.repository.native_history_lock(serial_number),
                self.control.command_lock(serial_number),
            ),
            after_commit=after_commit,
        )
        return bool(result)

    async def async_import_native_history_transaction(
        self,
        serial_number: str,
        floor_plan: FloorPlan,
        records: Iterable[CleaningSessionRecord],
        *,
        generation: int | None,
        reconciled: list[dict[str, Any]],
        verified_coverage_receipt: CoverageReceipt | None = None,
    ) -> bool:
        """Import and reconcile native history under the plan-write lock."""
        robot = self.repository.robot(serial_number)
        before = deepcopy(robot)
        records = tuple(records)
        changed = native_history._import_native_room_activity(
            robot, floor_plan, records
        )
        changed = (
            native_history._reconcile_pending_native_history(
                robot,
                floor_plan,
                records,
                on_reconciled=reconciled.append,
                verified_coverage_receipt=verified_coverage_receipt,
            )
            or changed
        )
        if (
            not changed
            or serial_number in self.repository.removed_robots
            or (
                generation is not None
                and generation != self.control.robot_generation(serial_number)
            )
        ):
            return False
        await self.async_save_native_history(serial_number, before)
        return True

    async def async_reset_history(
        self, serial_number: str, plan_id: str | None = None
    ) -> None:
        """Reset one plan's room and area history or all managed history."""

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.repository.user_metadata_store_transaction(serial_number):
                robot = self.repository.robot(serial_number)
                if plan_id is not None and plan_id not in robot["plans"]:
                    raise KeyError(plan_id)
                before = deepcopy(robot)
                pending = native_history._validated_native_reconciliation(
                    robot.get("pending_native_reconciliation")
                )
                clear_reconciliation = plan_id is None or (
                    pending is not None and pending["plan_id"] == plan_id
                )
                if clear_reconciliation:
                    robot.pop("pending_native_reconciliation", None)
                if plan_id is None:
                    robot["rotations"] = {}
                    robot["rooms"] = {}
                    robot["area_history"] = {}
                    robot["rotation_resets"] = {}
                else:
                    robot["rotations"].pop(plan_id, None)
                    robot["rotation_resets"][plan_id] = dt_util.utcnow().isoformat()
                await self.repository.async_save_with_rollback(serial_number, before)
                if clear_reconciliation:
                    self.control.cancel_reconciliation_tasks(serial_number)

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            notify=True,
            reject_on_admission_close=True,
        )

    async def async_begin_run(
        self,
        serial_number: str,
        plan_id: str,
        run_id: str,
        room_count: int,
        *,
        trigger: str,
        service: str,
        provenance: str | None = None,
        finish_current_room: bool | None = None,
        finish_current_room_threshold: int | None = None,
        held_rooms: Sequence[Mapping[str, str]] = (),
    ) -> None:
        """Persist the bounded identity and provenance of a managed run."""

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.repository.store_lock:
                robot = self.repository.robot(serial_number)
                safe_provenance = normalize_run_provenance(provenance or trigger)
                stop_enabled, stop_threshold = _managed_stop_policy(
                    robot["plans"].get(plan_id, {})
                )
                if finish_current_room is not None:
                    stop_enabled = finish_current_room
                if finish_current_room_threshold is not None:
                    stop_threshold = _bounded_stop_threshold(
                        finish_current_room_threshold
                    )
                robot["last_run"] = {
                    "run_id": run_id,
                    "plan_id": plan_id,
                    "plan_name": self.catalog.plan_name(serial_number, plan_id),
                    "started_at": dt_util.utcnow().isoformat(),
                    "ended_at": None,
                    "outcome": "running",
                    "reason_code": "run_started",
                    "trigger": safe_provenance,
                    "provenance": safe_provenance,
                    "service": service[:128],
                    "room_count": max(0, room_count),
                    "completed_room_count": 0,
                    "finish_current_room": stop_enabled,
                    "finish_current_room_threshold": stop_threshold,
                }
                if held_rooms:
                    robot["last_run"]["held_rooms"] = [
                        dict(room) for room in held_rooms
                    ]
                await self.repository.store.async_save(self.repository.data)

        await self.repository.async_run_owned_metadata(
            serial_number, commit, notify=True
        )

    async def async_set_recovery_checkpoint(
        self,
        serial_number: str,
        run_id: str,
        checkpoint: dict[str, Any],
    ) -> None:
        """Persist the resolved queue required for safe restart recovery."""
        changed = False

        async def commit(_lease: _MetadataLockLease) -> bool:
            nonlocal changed
            async with self.repository.store_lock:
                robot = self.repository.robot(serial_number)
                before = deepcopy(robot)
                last_run = robot.get("last_run")
                if not isinstance(last_run, dict) or last_run.get("run_id") != run_id:
                    return False
                existing = last_run.get("recovery_checkpoint", {})
                normalized_checkpoint = deepcopy(checkpoint)
                # Only the receipt writer may introduce evidence. Executor
                # snapshots can preserve it for the same accepted leg, but
                # cannot carry it into a new dispatch or a different floor.
                normalized_checkpoint.pop("coverage_evidence", None)
                evidence = coverage_evidence_from_storage(
                    existing.get("coverage_evidence")
                )
                if (
                    evidence is not None
                    and normalized_checkpoint.get("phase")
                    in {"starting", "accepted", "verifying"}
                    and all(
                        normalized_checkpoint.get(key) == existing.get(key)
                        for key in ("floor_token", "leg_index", "rooms")
                    )
                    and (
                        existing.get("phase") == "dispatching"
                        or all(
                            existing.get(key) is None
                            or normalized_checkpoint.get(key) == existing.get(key)
                            for key in (
                                "dispatched_at",
                                "native_identity_hash",
                                "history_baseline",
                            )
                        )
                    )
                ):
                    normalized_checkpoint["coverage_evidence"] = evidence.as_storage()
                cadence_by_room = _validated_cadence_snapshots(
                    normalized_checkpoint.get("cadence_by_room")
                )
                if cadence_by_room is None:
                    normalized_checkpoint.pop("cadence_by_room", None)
                else:
                    normalized_checkpoint["cadence_by_room"] = cadence_by_room
                last_run["recovery_checkpoint"] = {
                    **normalized_checkpoint,
                    **(
                        {"started_room_ids": existing["started_room_ids"]}
                        if "started_room_ids" in existing
                        else {}
                    ),
                    **(
                        {"stop_intent": existing["stop_intent"]}
                        if "stop_intent" in existing
                        else {}
                    ),
                }
                changed = True
                await self.repository.async_save_with_rollback(serial_number, before)
                return True

        def notify_if_changed(committed: bool) -> None:
            if committed and changed:
                self.repository.notify_listeners(serial_number)

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            after_commit=notify_if_changed,
        )

    async def async_checkpoint_coverage_receipt(
        self,
        serial_number: str,
        run_id: str,
        receipt: CoverageReceipt,
        *,
        floor_plan: FloorPlan,
        room_ids: Sequence[str],
        session_id: UUID,
    ) -> bool:
        """Persist a verified dispatch only within its exact owned queue leg."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.store_lock:
                robot = self.repository.robot(serial_number)
                run = robot.get("last_run")
                checkpoint = (
                    run.get("recovery_checkpoint") if isinstance(run, dict) else None
                )
                if (
                    not isinstance(run, dict)
                    or run.get("run_id") != run_id
                    or run.get("outcome") != "running"
                    or not isinstance(checkpoint, dict)
                    or checkpoint.get("phase") != "dispatching"
                    or checkpoint.get("floor_token") != plan_floor_token(floor_plan)
                    or receipt.floor_hash != coverage_floor_hash(floor_plan)
                    or receipt.session_hash
                    != hashlib.sha256(str(session_id).encode("ascii")).hexdigest()
                ):
                    return False
                raw_rooms = checkpoint.get("rooms")
                index = checkpoint.get("leg_index")
                if (
                    not isinstance(raw_rooms, list)
                    or not raw_rooms
                    or len(raw_rooms) > MAX_ROOM_SEQUENCE_SIZE
                    or type(index) is not int
                    or index < 0
                ):
                    return False
                try:
                    legs = checkpoint_legs(checkpoint)
                except TypeError, ValueError:
                    return False
                leg = legs[index] if index < len(legs) else None
                if not isinstance(leg, list) or list(room_ids) != [
                    room.room_id for room in leg
                ]:
                    return False
                native_rooms = {room.id: room for room in floor_plan.rooms}
                bindings = []
                settings = {}
                for room in leg:
                    if room.cleaning_mode not in {"vacuum", "vacuum_and_mop"}:
                        continue
                    if room.room_id not in native_rooms:
                        return False
                    region = coverage_region_hash(
                        native_rooms[room.room_id].protocol_id
                    )
                    bindings.append((room.room_id, region))
                    settings[region] = room.coverage_setting
                if settings != {
                    room.region_hash: room.coverage_setting.value
                    for room in receipt.rooms
                }:
                    return False
                evidence = CoverageEvidence(receipt, tuple(sorted(bindings)))
                if coverage_evidence_from_storage(evidence.as_storage()) is None:
                    return False
                before = deepcopy(robot)
                checkpoint["coverage_evidence"] = evidence.as_storage()
                await self.repository.async_save_with_rollback(serial_number, before)
                return True

        return bool(
            await self.repository.async_run_owned_metadata(
                serial_number, commit, reject_on_admission_close=True
            )
        )

    def coverage_receipt(
        self, serial_number: str, run_id: str | None
    ) -> CoverageReceipt | None:
        """Read the current run's bounded receipt without exposing native IDs."""
        run = self.repository.robot(serial_number).get("last_run")
        if (
            run_id is None
            or not isinstance(run, dict)
            or run.get("run_id") != run_id
            or run.get("outcome") != "running"
        ):
            return None
        checkpoint = run.get("recovery_checkpoint")
        evidence = coverage_evidence_from_storage(
            checkpoint.get("coverage_evidence")
            if isinstance(checkpoint, dict)
            else None
        )
        return evidence.receipt if evidence is not None else None

    async def async_checkpoint_mixed_session(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Persist the generated native identity before mixed START is sent."""

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.repository.store_lock:
                if len(session_identity_hash) != 64 or any(
                    char not in "0123456789abcdef" for char in session_identity_hash
                ):
                    raise ValueError(
                        "mixed session identity must be a SHA-256 fingerprint"
                    )
                run = self.repository.robot(serial_number).get("last_run")
                checkpoint = (
                    run.get("recovery_checkpoint") if isinstance(run, dict) else None
                )
                if (
                    not isinstance(run, dict)
                    or run.get("run_id") != run_id
                    or run.get("outcome") != "running"
                    or not isinstance(checkpoint, dict)
                    or checkpoint.get("phase") != "dispatching"
                    or checkpoint.get("mixed_settings") is not True
                    or not _dispatching_room_leg(checkpoint)
                ):
                    raise HomeAssistantError(
                        "Mixed mission checkpoint is not dispatchable"
                    )
                checkpoint["mixed_initial_session_hash"] = session_identity_hash
                await self.repository.store.async_save(self.repository.data)

        await self.repository.async_run_owned_metadata(
            serial_number, commit, notify=True
        )

    async def async_prepare_mixed_dispatch_stop(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Persist an at-most-once STOP intent for an exact partial mission."""
        if serial_number in self.repository.metadata_admission_closed:
            return
        run = self.repository.robot(serial_number).get("last_run")
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        if (
            not isinstance(run, dict)
            or run.get("run_id") != run_id
            or run.get("outcome") != "running"
            or not isinstance(checkpoint, dict)
            or checkpoint.get("phase") != "dispatching"
            or checkpoint.get("mixed_initial_session_hash") != session_identity_hash
            or checkpoint.get("stop_intent") not in {None, "after_room"}
        ):
            raise HomeAssistantError("Mixed mission STOP no longer owns its checkpoint")
        checkpoint["stop_intent"] = "immediate"
        self.control.mark_stop_pending(serial_number, run_id=run_id)
        await self.repository.async_save_and_notify(serial_number)

    async def async_rollback_mixed_dispatch_stop(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Roll back a STOP fence only when transport proves no bytes were sent."""
        if serial_number in self.repository.metadata_admission_closed:
            return
        run = self.repository.robot(serial_number).get("last_run")
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        if (
            not isinstance(run, dict)
            or run.get("run_id") != run_id
            or not isinstance(checkpoint, dict)
            or checkpoint.get("mixed_initial_session_hash") != session_identity_hash
            or checkpoint.get("stop_intent") != "immediate"
            or self.repository.robot(serial_number).get(plan_storage.STOP_FENCE_RUN_ID)
            != run_id
        ):
            return
        checkpoint.pop("stop_intent", None)
        self.control.clear_stop_pending(serial_number)
        await self.repository.async_save_and_notify(serial_number)

    async def async_checkpoint_stop_intent(
        self, serial_number: str, behavior: str, *, run_id: str | None
    ) -> None:
        """Do not lose a user's stop request if HA restarts before completion."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.user_metadata_store_transaction(serial_number):
                run = self.repository.robot(serial_number).get("last_run")
                checkpoint = (
                    run.get("recovery_checkpoint") if isinstance(run, dict) else None
                )
                if (
                    run_id is None
                    or not isinstance(run, dict)
                    or run.get("run_id") != run_id
                    or not isinstance(checkpoint, dict)
                ):
                    return False
                checkpoint["stop_intent"] = behavior
                if behavior == "after_room":
                    self.control.finish_room_event(serial_number).set()
                elif behavior == "immediate":
                    self.control.finish_room_event(serial_number).clear()
                await self.repository.store.async_save(self.repository.data)
                return True

        def notify_if_changed(committed: bool) -> None:
            if committed:
                self.repository.notify_listeners(serial_number)

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            after_commit=notify_if_changed,
            reject_on_admission_close=True,
        )

    async def async_retire_recovery(self, serial_number: str, reason: str) -> None:
        """Withdraw queue ownership when an entry is disabled or removed."""
        if (run := self.control.recovery_run(serial_number)) is not None:
            await self.async_finish_run(
                serial_number,
                run["run_id"],
                "unverified",
                reason,
                run.get("completed_room_count", 0),
                cause="home_assistant",
            )

    async def async_mark_recovery_status(
        self, serial_number: str, status: str, *, reason: str
    ) -> None:
        """Publish reconnection state without inventing a robot outcome."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.store_lock:
                last_run = self.repository.robot(serial_number).get("last_run")
                if (
                    not isinstance(last_run, dict)
                    or last_run.get("outcome") != "running"
                ):
                    return False
                last_run["recovery_status"] = status[:32]
                last_run["recovery_reason"] = reason[:64]
                active = self.repository.robot(serial_number).get("active_plan")
                if isinstance(active, dict):
                    active["status"] = status
                await self.repository.store.async_save(self.repository.data)
                return True

        def notify_if_changed(committed: bool) -> None:
            if committed:
                self.repository.notify_listeners(serial_number)

        await self.repository.async_run_owned_metadata(
            serial_number, commit, after_commit=notify_if_changed
        )

    async def async_finish_run(
        self,
        serial_number: str,
        run_id: str,
        outcome: str,
        reason_code: str,
        completed_room_count: int,
        *,
        terminal_activity: str | None = None,
        cause: str = "unknown",
        entity_id: str | None = None,
        context: Context | None = None,
    ) -> bool:
        """Finish one matching run as an owned sticky metadata transaction."""

        async def commit(
            _lease: _MetadataLockLease,
        ) -> tuple[bool, list[dict[str, Any]]]:
            async with self.repository.store_lock:
                return await self.async_finish_run_transaction(
                    serial_number,
                    run_id,
                    outcome,
                    reason_code,
                    completed_room_count,
                    terminal_activity=terminal_activity,
                    cause=cause,
                )

        def after_commit(result: tuple[bool, list[dict[str, Any]]]) -> None:
            committed, unfinished = result
            if not committed:
                return
            self.repository.notify_listeners(serial_number)
            for room in unfinished:
                skipped = room.pop("result") == "skipped"
                self.repository.hass.bus.async_fire(
                    f"{DOMAIN}_room_skipped"
                    if skipped
                    else f"{DOMAIN}_room_ended_unverified",
                    {
                        **({"entity_id": entity_id} if entity_id else {}),
                        **room,
                        "run_id": run_id,
                        **(
                            {"reason_code": "owner_skipped"}
                            if skipped
                            else {
                                "reason_code": "unverified_completion",
                                "cause": "unknown",
                            }
                        ),
                    },
                    context=context,
                )

        result = await self.repository.async_run_owned_metadata(
            serial_number, commit, after_commit=after_commit
        )
        return bool(result and result[0])

    async def async_finish_run_transaction(
        self,
        serial_number: str,
        run_id: str,
        outcome: str,
        reason_code: str,
        completed_room_count: int,
        *,
        terminal_activity: str | None,
        cause: str,
    ) -> tuple[bool, list[dict[str, Any]]]:
        """Persist one terminal managed-run outcome when its ID still matches."""
        robot = self.repository.robot(serial_number)
        last_run = robot.get("last_run")
        if not isinstance(last_run, dict) or last_run.get("run_id") != run_id:
            return False, []
        room_count = last_run.get("room_count")
        max_rooms = room_count if isinstance(room_count, int) and room_count >= 0 else 0
        ended_at = dt_util.utcnow().isoformat()
        unfinished = _close_unfinished_room_records(
            robot,
            plan_id=last_run["plan_id"],
            run_id=run_id,
            ended_at=ended_at,
            skipped=self.skipped_room_ids(serial_number, run_id),
        )
        _close_unfinished_area_records(robot, run_id=run_id, ended_at=ended_at)
        docked = last_run.get("outcome") == "stopped_docked"
        stored_completed_count = plan_timing._stored_count(
            last_run, "completed_room_count"
        )
        was_completed = last_run.get("outcome") == "completed"
        completed = was_completed or (
            last_run.get("native_reconciled_completion") is True
            and max_rooms > 0
            and stored_completed_count >= max_rooms
        )
        last_run.update(
            {
                "ended_at": ended_at,
                "outcome": (
                    "stopped_docked"
                    if docked
                    else "completed"
                    if completed
                    else normalize_run_outcome(outcome)
                ),
                "reason_code": (
                    "stopped_docked"
                    if docked
                    else last_run.get("reason_code", "all_rooms_verified")
                    if was_completed
                    else "all_rooms_verified"
                    if completed
                    else reason_code[:64]
                ),
                "cause": (
                    "managed_cancellation"
                    if docked
                    else last_run.get("cause", "verified_completion")
                    if was_completed
                    else "verified_completion"
                    if completed
                    else cause[:64]
                ),
                "completed_room_count": min(
                    max(0, max(completed_room_count, stored_completed_count)),
                    max_rooms,
                ),
            }
        )
        if terminal_activity is not None and not docked:
            last_run["terminal_activity"] = terminal_activity[:64]
        append_run_history(robot, last_run)
        last_run.pop("recovery_checkpoint", None)
        last_run.pop("native_reconciled_completion", None)
        last_run.pop("recovery_status", None)
        last_run.pop("recovery_reason", None)
        active = robot.get("active_plan")
        if isinstance(active, dict) and active.get("run_id") == run_id:
            robot["active_plan"] = None
        try:
            await self.repository.store.async_save(self.repository.data)
        finally:
            # A failed save still leaves this in-memory run terminal. If HA
            # restarts before that write becomes durable, async_load rebuilds
            # ownership from the persisted checkpoint and run ID.
            self.cadence.release_prepared_run(serial_number, run_id)
        return True, unfinished

    @callback
    def active_run_id(self, serial_number: str) -> str | None:
        """Return the current managed run ID without exposing user context."""
        last_run = self.repository.robot(serial_number).get("last_run")
        if isinstance(last_run, dict) and last_run.get("outcome") == "running":
            run_id = last_run.get("run_id")
            return run_id if isinstance(run_id, str) else None
        return None

    async def async_mark_run_docked(
        self,
        serial_number: str,
        run_id: str,
        *,
        entity_id: str | None = None,
        context: Context | None = None,
        stop_fence_token: int | None = None,
    ) -> bool:
        """Close a stopped run only after a correlated final DOCK settles."""

        def mutate() -> dict[str, Any] | None:
            robot = self.repository.robot(serial_number)
            last_run = robot.get("last_run")
            if not isinstance(last_run, dict) or last_run.get("run_id") != run_id:
                return None
            if last_run.get("outcome") not in {"running", "cancelled", "unverified"}:
                return None
            if stop_fence_token is not None and (
                self.control.stop_fence_token(serial_number) != stop_fence_token
                or robot.get(plan_storage.STOP_FENCE_RUN_ID) != run_id
            ):
                return None
            now = dt_util.utcnow().isoformat()
            provenance = normalize_run_provenance(
                last_run.get("provenance")
                if isinstance(last_run.get("provenance"), str)
                else None
            )
            last_run.update(
                {
                    "outcome": "stopped_docked",
                    "reason_code": "stopped_docked",
                    "terminal_activity": "docked",
                    "docked_at": now,
                    "provenance": provenance,
                }
            )
            update_run_history(
                robot,
                run_id,
                {
                    "outcome": "stopped_docked",
                    "reason_code": "stopped_docked",
                    "terminal_activity": "docked",
                },
            )
            if stop_fence_token is not None:
                self.control.clear_stop_pending(serial_number)
            return {
                **({"entity_id": entity_id} if entity_id else {}),
                "run_id": run_id,
                "plan_id": last_run.get("plan_id"),
                "outcome": "stopped_docked",
                "reason_code": "stopped_docked",
                "terminal_activity": "docked",
                "docked_at": now,
                "provenance": provenance,
            }

        def notify_docked(event_data: dict[str, Any] | None) -> None:
            if event_data is not None:
                self.repository.hass.bus.async_fire(
                    EVENT_PLAN_DOCKED, event_data, context=context
                )

        result = await self.repository.async_mutate_and_save(
            serial_number, mutate, after_commit=notify_docked
        )
        return result is not None

    async def async_mark_started(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        run_id: str | None = None,
    ) -> bool:
        """Record and publish the start of one room."""

        def mutate() -> bool:
            now = dt_util.utcnow().isoformat()
            record = self.room(serial_number, plan_id, room)
            robot = self.repository.robot(serial_number)
            last_run = robot.get("last_run")
            checkpoint = (
                last_run.get("recovery_checkpoint", {})
                if isinstance(last_run, dict) and last_run.get("run_id") == run_id
                else {}
            )
            started_ids = (
                checkpoint.get("started_room_ids", [])
                if isinstance(checkpoint, dict)
                else []
            )
            duplicate = run_id is not None and room.room_id in started_ids
            if not duplicate:
                record["last_started"] = now
            record["last_result"] = "running"
            if run_id is not None:
                record["run_id"] = run_id
            else:
                record.pop("run_id", None)
            robot.pop("pending_native_reconciliation", None)
            previous_active = robot.get("active_plan")
            previous_active = (
                previous_active if isinstance(previous_active, dict) else {}
            )
            recovering_same_room = (
                run_id is not None
                and (duplicate or previous_active.get("status") == "recovering")
                and previous_active.get("plan_id") == plan_id
                and previous_active.get("room_id") == room.room_id
                and previous_active.get("run_id") == run_id
            )
            robot["active_plan"] = {
                "plan_id": plan_id,
                "plan_name": self.catalog.plan_name(serial_number, plan_id),
                "room_id": room.room_id,
                "room": room.name,
                "started": (
                    previous_active.get("started", now) if recovering_same_room else now
                ),
                "status": "starting",
                "cleaning_started": (
                    previous_active.get("cleaning_started")
                    if recovering_same_room
                    else None
                ),
                "active_elapsed_seconds": (
                    previous_active.get("active_elapsed_seconds", 0)
                    if recovering_same_room
                    else 0
                ),
                "active_segment_started": (
                    previous_active.get("active_segment_started")
                    if recovering_same_room
                    else None
                ),
            }
            stop_policy = (
                last_run
                if isinstance(last_run, Mapping)
                and last_run.get("run_id") == run_id
                and _has_frozen_stop_policy(last_run)
                else checkpoint
            )
            if _has_frozen_stop_policy(stop_policy):
                robot["active_plan"].update(
                    {
                        "finish_current_room": stop_policy["finish_current_room"],
                        "finish_current_room_threshold": _bounded_stop_threshold(
                            stop_policy["finish_current_room_threshold"]
                        ),
                    }
                )
            if run_id is not None:
                robot["active_plan"]["run_id"] = run_id
                if isinstance(checkpoint, dict):
                    checkpoint["started_room_ids"] = list(
                        dict.fromkeys([*started_ids, room.room_id])
                    )
            return not duplicate

        result = await self.repository.async_mutate_and_save(serial_number, mutate)
        return bool(result)

    async def async_mark_area_started(
        self,
        serial_number: str,
        plan_id: str,
        area: AreaLeg,
        *,
        run_id: str,
    ) -> None:
        """Publish the custom area a managed run is cleaning now.

        Dispatch alone is not a cleaning opportunity. History is recorded
        separately once the native session's owned start is confirmed.
        """

        def mutate() -> bool | None:
            robot = self.repository.robot(serial_number)
            last_run = robot.get("last_run")
            if (
                not isinstance(last_run, dict)
                or last_run.get("run_id") != run_id
                or last_run.get("plan_id") != plan_id
                or last_run.get("outcome") != "running"
            ):
                return None
            previous = robot.get("active_plan")
            previous = previous if isinstance(previous, dict) else {}
            # A restart rejoining the same area keeps its original start.
            same_area = (
                previous.get("run_id") == run_id
                and previous.get("plan_id") == plan_id
                and previous.get("area_id") == area.area_id
            )
            robot["active_plan"] = {
                "plan_id": plan_id,
                "plan_name": self.catalog.plan_name(serial_number, plan_id),
                "area_id": area.area_id,
                "area": area.name,
                "started": previous.get("started")
                if same_area
                else dt_util.utcnow().isoformat(),
                "status": "running",
                "run_id": run_id,
            }
            if _has_frozen_stop_policy(last_run):
                robot["active_plan"].update(
                    {
                        "finish_current_room": last_run["finish_current_room"],
                        "finish_current_room_threshold": _bounded_stop_threshold(
                            last_run["finish_current_room_threshold"]
                        ),
                    }
                )
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    async def async_mutate_area_history(
        self, serial_number: str, mutate: Callable[[], bool]
    ) -> bool:
        """Commit area evidence atomically; failed writes cannot publish credit."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.store_lock:
                if serial_number in self.repository.removed_robots:
                    return False
                before = deepcopy(self.repository.robot(serial_number))
                if not mutate():
                    return False
                await self.repository.async_save_with_rollback(serial_number, before)
                return True

        def notify(changed: bool) -> None:
            if changed:
                self.repository.notify_listeners(serial_number)

        result = await self.repository.async_run_owned_metadata(
            serial_number, commit, after_commit=notify
        )
        return bool(result)

    async def async_mark_area_accepted(
        self,
        serial_number: str,
        plan_id: str,
        area: AreaLeg,
        *,
        run_id: str,
        acceptance_is_current: Callable[[], bool],
    ) -> bool:
        """Record one owned cleaning opportunity, never a dispatch or a retry."""

        def mutate() -> bool:
            robot = self.repository.robot(serial_number)
            run = robot.get("last_run")
            active = robot.get("active_plan")
            if (
                not acceptance_is_current()
                or not isinstance(run, dict)
                or run.get("run_id") != run_id
                or run.get("plan_id") != plan_id
                or run.get("outcome") != "running"
                or not isinstance(active, dict)
                or active.get("run_id") != run_id
                or active.get("area_id") != area.area_id
                or active.get("plan_id") != plan_id
            ):
                return False
            now = dt_util.utcnow().isoformat()
            rotation = self.rotation(serial_number, plan_id)
            for records in (rotation.setdefault("areas", {}), robot["area_history"]):
                record = records.get(area.area_id)
                if (
                    not isinstance(record, dict)
                    or record.get("fingerprint") != area.fingerprint
                ):
                    record = {"fingerprint": area.fingerprint}
                    records[area.area_id] = record
                if record.get("run_id") == run_id:
                    continue
                record.update(
                    {
                        "name": area.name,
                        "run_id": run_id,
                        "last_opportunity": now,
                        "last_result": "running",
                        "started_runs": plan_timing._stored_count(
                            record, "started_runs"
                        )
                        + 1,
                    }
                )
            return True

        return await self.async_mutate_area_history(serial_number, mutate)

    async def async_mark_area_finished(
        self,
        serial_number: str,
        area: AreaLeg,
        *,
        run_id: str,
        completed: bool = False,
        completion_is_current: Callable[[], bool] | None = None,
    ) -> bool:
        """Record an owned session end separately from interrupted attempts.

        Firmware has no drawn-area coverage result. Completion here means an
        accepted, continuously owned session ended normally, not room coverage
        or cadence credit. Repeated recovery callbacks cannot increment twice.
        """

        def mutate() -> bool:
            robot = self.repository.robot(serial_number)
            active = robot.get("active_plan")
            run = robot.get("last_run")
            if (
                not isinstance(active, dict)
                or active.get("run_id") != run_id
                or active.get("area_id") != area.area_id
                or not isinstance(run, dict)
                or run.get("run_id") != run_id
                or run.get("plan_id") != active.get("plan_id")
                or run.get("outcome") != "running"
                or (
                    completed
                    and (completion_is_current is None or not completion_is_current())
                )
            ):
                return False
            rotation = robot["rotations"].get(active["plan_id"], {})
            record = rotation.get("areas", {}).get(area.area_id, {})
            if completed and (
                record.get("run_id") != run_id
                or record.get("fingerprint") != area.fingerprint
            ):
                return False
            now = dt_util.utcnow().isoformat()
            for records in (rotation.get("areas", {}), robot["area_history"]):
                record = records.get(area.area_id, {})
                if (
                    record.get("run_id") != run_id
                    or record.get("fingerprint") != area.fingerprint
                ):
                    continue
                if record.get("last_completed_run_id") == run_id:
                    continue
                record["last_result"] = "completed" if completed else "interrupted"
                if completed:
                    record.update(
                        {
                            "last_completed": now,
                            "last_completed_run_id": run_id,
                            "completion_basis": "owned_session_ended",
                            "completed_runs": plan_timing._stored_count(
                                record, "completed_runs"
                            )
                            + 1,
                        }
                    )
                else:
                    record["last_interrupted"] = now
            robot["active_plan"] = None
            return True

        return await self.async_mutate_area_history(serial_number, mutate)

    async def async_mark_completed(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        run_id: str | None = None,
        completed_at: str | None = None,
        duration_seconds: int | None = None,
        verified_coverage_receipt: CoverageReceipt | None = None,
        completion_is_current: Callable[[], bool] | None = None,
    ) -> bool:
        """Advance room history only after the room finishes.

        Native record evidence (``completed_at``/``duration_seconds``) takes
        precedence over wall-clock tracking so one multi-room leg mission can
        credit each verified room with the robot's own per-room timing.
        """

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.store_lock:
                if completion_is_current is not None and not completion_is_current():
                    return False
                return await self.async_mark_completed_transaction(
                    serial_number,
                    plan_id,
                    room,
                    run_id=run_id,
                    completed_at=completed_at,
                    duration_seconds=duration_seconds,
                    verified_coverage_receipt=verified_coverage_receipt,
                )

        def notify_if_changed(changed: bool) -> None:
            if changed:
                self.repository.notify_listeners(serial_number)

        result = await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            after_commit=notify_if_changed,
        )
        return bool(result)

    async def async_mark_completed_transaction(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        run_id: str | None = None,
        completed_at: str | None = None,
        duration_seconds: int | None = None,
        verified_coverage_receipt: CoverageReceipt | None = None,
    ) -> bool:
        """Credit verified completion while owning the plan-write transaction."""
        now_value = dt_util.utcnow()
        robot = self.repository.robot(serial_number)
        before = deepcopy(robot)
        run = robot.get("last_run")
        if run_id is not None and (
            not isinstance(run, dict)
            or run.get("run_id") != run_id
            or run.get("plan_id") != plan_id
            or run.get("outcome") != "running"
        ):
            return False
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        if (
            isinstance(run, dict)
            and isinstance(checkpoint, dict)
            and run.get("plan_id") == plan_id
        ):
            credited = checkpoint.setdefault("completed_room_ids", [])
            if room.room_id in credited:
                # A previous disk write may have failed after updating the
                # in-memory credit. Retry persistence, never increment twice.
                await self.repository.store.async_save(self.repository.data)
                return True
            credited.append(room.room_id)
        now = (
            completed_at
            if completed_at is not None
            and plan_timing._latest_timestamp(completed_at, now=now_value) is not None
            else now_value.isoformat()
        )
        record = self.room(serial_number, plan_id, room)
        active = self.repository.robot(serial_number).get("active_plan")
        duration: int | None
        if (
            isinstance(duration_seconds, int)
            and not isinstance(duration_seconds, bool)
            and duration_seconds > 0
        ):
            duration = duration_seconds
        else:
            duration = (
                plan_timing._active_elapsed_seconds(active, now_value)
                if active is not None
                and active.get("plan_id") == plan_id
                and active.get("room_id") == room.room_id
                else None
            )
        if duration is not None and duration > 0:
            plan_timing._record_duration_sample(record, room, duration, now)
        record["last_completed"] = now
        record["last_result"] = "completed"
        record["completed_runs"] = (
            plan_timing._stored_count(record, "completed_runs") + 1
        )
        global_room = native_history._global_room(
            self.repository.robot(serial_number), room
        )
        global_room["name"] = room.name
        global_room["last_completed"] = now
        if duration is not None and duration > 0:
            global_room["last_duration_seconds"] = duration
        global_room["completed_runs"] = (
            plan_timing._stored_count(global_room, "completed_runs") + 1
        )
        last_run = robot.get("last_run")
        cadence_by_room = (
            checkpoint.get("cadence_by_room") if isinstance(checkpoint, dict) else None
        )
        cadence_state = (
            cadence_by_room.get(room.room_id)
            if isinstance(cadence_by_room, Mapping)
            else None
        )
        _apply_verified_cadence(
            robot,
            plan_id,
            room,
            cadence_state,
            verified_coverage=verified_room_coverage(
                checkpoint.get("coverage_evidence")
                if isinstance(checkpoint, dict)
                else None,
                verified_coverage_receipt,
                room.room_id,
                room.cleaning_mode,
                room.coverage_setting,
                cadence_state,
            )
            if run_id is not None
            else None,
        )
        if (
            isinstance(last_run, dict)
            and last_run.get("outcome") == "running"
            and last_run.get("plan_id") == plan_id
        ):
            # Checkpoint verified credit with room history, so a crash before
            # the plan finalizer cannot lose work already verified and saved.
            last_run["completed_room_count"] = min(
                plan_timing._stored_count(last_run, "completed_room_count") + 1,
                plan_timing._stored_count(last_run, "room_count"),
            )
        active = robot.get("active_plan")
        if run_id is None or (
            isinstance(active, Mapping)
            and active.get("run_id") == run_id
            and active.get("plan_id") == plan_id
        ):
            robot["active_plan"] = None
        await self.repository.async_save_with_rollback(serial_number, before)
        return True

    async def async_mark_ended_unverified(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        native_reconciliation: Mapping[str, object] | None = None,
    ) -> None:
        """Record an operational room handoff without claiming completion."""

        def mutate() -> bool:
            now_value = dt_util.utcnow()
            record = self.room(serial_number, plan_id, room)
            record["last_result"] = "ended_unverified"
            record["last_ended_unverified"] = now_value.isoformat()
            record["unverified_runs"] = (
                plan_timing._stored_count(record, "unverified_runs") + 1
            )
            active = self.repository.robot(serial_number).get("active_plan")
            if active is not None:
                record["last_unverified_duration_seconds"] = (
                    plan_timing._active_elapsed_seconds(active, now_value)
                )
            robot = self.repository.robot(serial_number)
            if native_reconciliation is not None:
                pending = native_history._validated_native_reconciliation(
                    native_reconciliation, create_expiry=True
                )
                if pending is not None:
                    native_history._attach_cadence_state(robot, pending)
                    robot["pending_native_reconciliation"] = pending
            robot["active_plan"] = None
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    async def async_mark_failed(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        reason: str,
        *,
        native_reconciliation: Mapping[str, object] | None = None,
    ) -> None:
        """Persist failure separately so it never advances room history."""

        def mutate() -> bool:
            robot = self.repository.robot(serial_number)
            record = self.room(serial_number, plan_id, room)
            record["last_result"] = "failed"
            record["last_failed"] = dt_util.utcnow().isoformat()
            record["last_error"] = reason
            record["failed_runs"] = plan_timing._stored_count(record, "failed_runs") + 1
            if native_reconciliation is not None:
                pending = native_history._validated_native_reconciliation(
                    native_reconciliation, create_expiry=True
                )
                if pending is not None:
                    native_history._attach_cadence_state(robot, pending)
                    robot["pending_native_reconciliation"] = pending
            robot["active_plan"] = None
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    async def async_mark_native_completed(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        dispatched_at: datetime,
        completed_at: str | None = None,
        duration_seconds: int | None = None,
        room_identity: str | None = None,
        verified_coverage_receipt: CoverageReceipt | None = None,
    ) -> bool:
        """Credit a native completion that arrived after managed cleanup.

        The native robot can finish its graceful STOP countdown after the
        managed runner has already recorded an error.  This method applies
        only to the exact pending dispatch captured by that runner and is
        therefore safe against later or superseding native sessions.
        """
        changed = False

        async def commit(_lease: _MetadataLockLease) -> bool:
            nonlocal changed
            async with self.repository.store_lock:
                return await self.async_mark_native_completed_transaction(
                    serial_number,
                    plan_id,
                    room,
                    dispatched_at=dispatched_at,
                    completed_at=completed_at,
                    duration_seconds=duration_seconds,
                    room_identity=room_identity,
                    verified_coverage_receipt=verified_coverage_receipt,
                    changed=lambda: _set_true(),
                )

        def _set_true() -> None:
            nonlocal changed
            changed = True

        def notify_if_changed(_result: bool) -> None:
            if changed:
                self.repository.notify_listeners(serial_number)

        result = await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            after_commit=notify_if_changed,
        )
        return bool(result)

    async def async_mark_native_completed_transaction(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        dispatched_at: datetime,
        completed_at: str | None = None,
        duration_seconds: int | None = None,
        room_identity: str | None = None,
        verified_coverage_receipt: CoverageReceipt | None = None,
        changed: Callable[[], None] | None = None,
    ) -> bool:
        """Reconcile late completion while owning the plan-write transaction."""
        robot = self.repository.robot(serial_number)
        before = deepcopy(robot)
        pending = native_history._validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        if pending is None:
            return False
        # Grouped markers are reconciled atomically by the native-history import.
        if "rooms" in pending:
            return False
        if native_history._native_reconciliation_expired(pending):
            robot.pop("pending_native_reconciliation", None)
            if changed is not None:
                changed()
            await self.async_save_native_history(serial_number, before)
            return False
        if (
            pending["plan_id"] != plan_id
            or pending["room_id"] != room.room_id
            or dt_util.parse_datetime(pending["dispatched_at"]) != dispatched_at
        ):
            return False
        if native_history._native_reconciliation_was_committed(robot, pending):
            robot.pop("pending_native_reconciliation", None)
            if changed is not None:
                changed()
            await self.async_save_native_history(serial_number, before)
            return False
        completed_value = (
            completed_at
            if isinstance(completed_at, str)
            and plan_timing._latest_timestamp(completed_at) is not None
            else dt_util.utcnow().isoformat()
        )
        room_settings = native_history._native_completion_settings(pending, room)
        native_history._record_native_completion(
            robot,
            plan_id,
            room,
            completed_at=completed_value,
            duration_seconds=duration_seconds,
            room_settings=room_settings,
        )
        native_history._remember_native_reconciliation(robot, pending)
        if room_settings is not None:
            _apply_verified_cadence(
                robot,
                plan_id,
                room_settings,
                pending.get("cadence_state"),
                current_identity=room_identity,
                validate_current_identity=True,
                verified_coverage=verified_room_coverage(
                    pending.get("coverage_evidence"),
                    verified_coverage_receipt,
                    room.room_id,
                    room_settings.cleaning_mode,
                    room_settings.coverage_setting,
                    pending.get("cadence_state"),
                ),
            )
        native_history._repair_native_reconciled_run(robot, pending, plan_id)
        robot.pop("pending_native_reconciliation", None)
        if changed is not None:
            changed()
        await self.async_save_native_history(serial_number, before)
        return True

    async def async_clear_native_reconciliation(
        self,
        serial_number: str,
        plan_id: str,
        room_id: str,
        dispatched_at: datetime,
    ) -> bool:
        """Durably clear one exact late-completion marker after its watcher ends."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.store_lock:
                robot = self.repository.robot(serial_number)
                pending = native_history._validated_native_reconciliation(
                    robot.get("pending_native_reconciliation")
                )
                if (
                    pending is None
                    or pending["plan_id"] != plan_id
                    or pending["room_id"] != room_id
                    or dt_util.parse_datetime(pending["dispatched_at"]) != dispatched_at
                ):
                    return False
                before = deepcopy(robot)
                robot.pop("pending_native_reconciliation", None)
                applied = deepcopy(robot)
                try:
                    await self.repository.store.async_save(self.repository.data)
                except Exception, asyncio.CancelledError:
                    plan_storage._restore_unsaved_changes(robot, before, applied)
                    raise
                return True

        def notify_if_cleared(cleared: bool) -> None:
            if cleared:
                self.repository.notify_listeners(serial_number)

        result = await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.control.command_lock(serial_number),),
            after_commit=notify_if_cleared,
        )
        return bool(result)

    async def async_mark_suspended(
        self, serial_number: str, plan_id: str, room: CleaningRoom, reason: str
    ) -> None:
        def mutate() -> bool:
            now_value = dt_util.utcnow()
            record = self.room(serial_number, plan_id, room)
            record["last_result"] = "suspended"
            record["last_suspended"] = now_value.isoformat()
            record["last_suspend_reason"] = reason
            record["suspended_runs"] = (
                plan_timing._stored_count(record, "suspended_runs") + 1
            )
            active = self.repository.robot(serial_number).get("active_plan")
            if active is not None:
                active["active_elapsed_seconds"] = plan_timing._active_elapsed_seconds(
                    active, now_value
                )
                active["active_segment_started"] = None
                active["status"] = "suspended"
                active["suspend_reason"] = reason
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    async def async_mark_verifying(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        verification_deadline: datetime | None = None,
    ) -> None:
        def mutate() -> bool:
            now_value = dt_util.utcnow()
            record = self.room(serial_number, plan_id, room)
            record["last_result"] = "verifying"
            active = self.repository.robot(serial_number).get("active_plan")
            if active is not None:
                active["active_elapsed_seconds"] = plan_timing._active_elapsed_seconds(
                    active, now_value
                )
                active["active_segment_started"] = None
                active["status"] = "verifying"
                active.pop("suspend_reason", None)
            run = self.repository.robot(serial_number).get("last_run")
            if run is not None and verification_deadline is not None:
                checkpoint = run.get("recovery_checkpoint")
                if checkpoint is not None:
                    checkpoint["phase"] = "verifying"
                    checkpoint["verification_deadline"] = (
                        verification_deadline.isoformat()
                    )
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    async def async_mark_resumed(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        def mutate() -> bool:
            now = dt_util.utcnow().isoformat()
            record = self.room(serial_number, plan_id, room)
            record["last_result"] = "running"
            robot = self.repository.robot(serial_number)
            active = robot.get("active_plan")
            if (
                active is not None
                and active.get("plan_id") == plan_id
                and active.get("room_id") == room.room_id
            ):
                active["status"] = "running"
                if not isinstance(active.get("cleaning_started"), str):
                    active["cleaning_started"] = now
                    global_room = native_history._global_room(robot, room)
                    # A room skipped later in this run gets these back.
                    for target in (record, global_room):
                        target["opportunity_before_run"] = {
                            "run_id": active.get("run_id"),
                            "value": target.get("last_opportunity"),
                        }
                    record["last_opportunity"] = now
                    global_room["name"] = room.name
                    global_room["last_opportunity"] = now
                if active.get("active_segment_started") is None:
                    active["active_segment_started"] = now
                active.pop("suspend_reason", None)
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    async def async_mark_interrupted(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        reason: str,
        *,
        native_reconciliation: Mapping[str, object] | None = None,
    ) -> None:
        def mutate() -> bool:
            now = dt_util.utcnow().isoformat()
            robot = self.repository.robot(serial_number)
            record = self.room(serial_number, plan_id, room)
            record["last_result"] = "interrupted"
            record["last_interrupted"] = now
            record["last_error"] = reason
            record["interrupted_runs"] = (
                plan_timing._stored_count(record, "interrupted_runs") + 1
            )
            if native_reconciliation is not None:
                pending = native_history._validated_native_reconciliation(
                    native_reconciliation, create_expiry=True
                )
                if pending is not None:
                    native_history._attach_cadence_state(robot, pending)
                    robot["pending_native_reconciliation"] = pending
            active = robot.get("active_plan")
            if active is not None:
                robot["last_interrupted_plan"] = deepcopy(active)
            robot["active_plan"] = None
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    async def async_note_room_skipped(
        self, serial_number: str, run_id: str, room_id: str
    ) -> bool:
        """Remember a room the owner skipped while this run was cleaning."""

        def mutate() -> bool:
            run = self.repository.robot(serial_number).get("last_run")
            if (
                not isinstance(run, dict)
                or run.get("run_id") != run_id
                or run.get("outcome") != "running"
            ):
                return False
            skipped = run.setdefault("skipped_room_ids", [])
            if room_id not in skipped:
                skipped.append(room_id)
            return True

        return bool(await self.repository.async_mutate_and_save(serial_number, mutate))

    def skipped_room_ids(self, serial_number: str, run_id: str) -> frozenset[str]:
        """Return the rooms skipped during a run that is still running."""
        run = self.repository.robot(serial_number).get("last_run")
        if not isinstance(run, Mapping) or run.get("run_id") != run_id:
            return frozenset()
        skipped = run.get("skipped_room_ids")
        if not isinstance(skipped, list):
            return frozenset()
        return frozenset(item for item in skipped if isinstance(item, str))

    async def async_mark_skipped(
        self, serial_number: str, plan_id: str, room: CleaningRoom, *, run_id: str
    ) -> None:
        """Close a skipped room without credit and give back its rotation turn."""

        def mutate() -> bool:
            robot = self.repository.robot(serial_number)
            _skip_room_record(
                self.room(serial_number, plan_id, room),
                native_history._global_room(robot, room),
                run_id=run_id,
                skipped_at=dt_util.utcnow().isoformat(),
            )
            robot["active_plan"] = None
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    async def async_mark_cancelled(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        def mutate() -> bool:
            now_value = dt_util.utcnow()
            record = self.room(serial_number, plan_id, room)
            record["last_result"] = "cancelled"
            record["last_cancelled"] = now_value.isoformat()
            record["cancelled_runs"] = (
                plan_timing._stored_count(record, "cancelled_runs") + 1
            )
            active = self.repository.robot(serial_number).get("active_plan")
            if active is not None:
                record["last_cancelled_duration_seconds"] = (
                    plan_timing._active_elapsed_seconds(active, now_value)
                )
            self.repository.robot(serial_number)["active_plan"] = None
            return True

        await self.repository.async_mutate_and_save(serial_number, mutate)

    def current_room_timing(self, serial_number: str) -> dict[str, Any] | None:
        """Read the canonical active-time estimate for a confirmed managed room.

        This read never learns history, advances completion or writes storage.
        Stop uses the same calculation, including its unknown-baseline fallback.
        """
        robot = self.repository.robot(serial_number)
        active = robot.get("active_plan")
        run = robot.get("last_run")
        if (
            not isinstance(active, Mapping)
            or not isinstance(run, Mapping)
            or not isinstance(active.get("room_id"), str)
            or not active["room_id"]
            or not isinstance(active.get("run_id"), str)
            or not active["run_id"]
            or run.get("run_id") != active["run_id"]
            or run.get("plan_id") != active.get("plan_id")
            or run.get("outcome") != "running"
            or self.control.cancellation_reason(serial_number) == "motion_replaced"
            or active.get("status") not in {"running", "suspended"}
            or not isinstance(active.get("cleaning_started"), str)
        ):
            return None
        return {
            "run_id": active["run_id"],
            "room_id": active["room_id"],
            "room": active.get("room"),
            "status": active["status"],
            **plan_timing._room_timing(robot, active, dt_util.utcnow()),
        }

    def run_history(
        self,
        serial_number: str,
        native: Sequence[CleaningSessionRecord] = (),
    ) -> list[dict[str, Any]]:
        """Return recent runs, newest first, with robot-started sessions merged in."""
        return history_entries(
            self.repository.robot(serial_number),
            native,
            manual=_is_manual_room_sequence_plan_id,
        )

    def snapshot(self, serial_number: str) -> dict[str, Any]:
        """Return compact, automation-friendly plan and room history state."""
        robot = self.repository.robot(serial_number)
        records = [
            record
            for rotation in robot["rotations"].values()
            for record in rotation["rooms"].values()
        ]
        completed_runs = sum(
            plan_timing._stored_count(item, "completed_runs") for item in records
        )
        failed_runs = sum(
            plan_timing._stored_count(item, "failed_runs") for item in records
        )
        cancelled_runs = sum(
            plan_timing._stored_count(item, "cancelled_runs") for item in records
        )
        interrupted_runs = sum(
            plan_timing._stored_count(item, "interrupted_runs") for item in records
        )
        suspended_runs = sum(
            plan_timing._stored_count(item, "suspended_runs") for item in records
        )
        unverified_runs = sum(
            plan_timing._stored_count(item, "unverified_runs") for item in records
        )
        skipped_runs = sum(
            plan_timing._stored_count(item, "skipped_runs") for item in records
        )
        last_completed = max(
            (
                str(item["last_completed"])
                for item in records
                if item.get("last_completed")
            ),
            default=None,
        )
        plans = {
            plan_id: {
                "name": plan.get("name", plan_id),
                "enabled": plan.get("enabled", True),
                "room_count": len(plan.get("rooms", [])),
            }
            for plan_id, plan in robot["plans"].items()
        }
        last_run = robot.get("last_run")
        checkpoint = (
            last_run.get("recovery_checkpoint")
            if isinstance(last_run, Mapping) and last_run.get("outcome") == "running"
            else None
        )
        pending_smart_stop = bool(
            isinstance(last_run, Mapping)
            and isinstance(last_run.get("run_id"), str)
            and isinstance(checkpoint, Mapping)
            and checkpoint.get("stop_intent") == "after_room"
            and self.control.finish_room_event(serial_number).is_set()
            and self.control.cancellation_reason(serial_number) != "motion_replaced"
        )
        active_plan = deepcopy(robot.get("active_plan"))
        if (
            pending_smart_stop
            and isinstance(last_run, Mapping)
            and isinstance(last_run.get("run_id"), str)
            and not isinstance(active_plan, dict)
        ):
            active_plan = {
                "run_id": last_run["run_id"],
                "plan_id": last_run.get("plan_id"),
                "plan_name": last_run.get("plan_name"),
                "status": "returning_to_dock",
            }
        if isinstance(active_plan, dict):
            active_plan["active_elapsed_seconds"] = plan_timing._active_elapsed_seconds(
                active_plan, dt_util.utcnow()
            )
            active_plan["smart_stop_pending"] = bool(
                pending_smart_stop
                and isinstance(last_run, Mapping)
                and active_plan.get("run_id") == last_run.get("run_id")
            )
            if active_plan["smart_stop_pending"]:
                active_plan["smart_stop_phase"] = (
                    "verifying_completion"
                    if active_plan.get("status") == "verifying"
                    else "finishing_room"
                    if isinstance(active_plan.get("room_id"), str)
                    else "finishing_area"
                    if isinstance(active_plan.get("area_id"), str)
                    else "returning_to_dock"
                )
        public_last_run = deepcopy(robot.get("last_run"))
        if isinstance(public_last_run, dict):
            public_last_run.pop("recovery_checkpoint", None)
        return {
            "completed_runs": completed_runs,
            "failed_runs": failed_runs,
            "cancelled_runs": cancelled_runs,
            "interrupted_runs": interrupted_runs,
            "suspended_runs": suspended_runs,
            "unverified_runs": unverified_runs,
            "skipped_runs": skipped_runs,
            "last_completed": last_completed,
            "last_completed_by_room": {
                room_id: {
                    "name": room.get("name"),
                    "at": room.get("last_completed"),
                    "duration_seconds": room.get("last_duration_seconds"),
                    "runs": plan_timing._stored_count(room, "completed_runs"),
                }
                for room_id, room in robot["rooms"].items()
            },
            "native_reconciliation_pending": isinstance(
                robot.get("pending_native_reconciliation"), dict
            ),
            "plans": plans,
            "plan_history": deepcopy(robot["rotations"]),
            "selected_plan": robot.get("selected_plan"),
            "selected_plan_name": self.catalog.plan_name(
                serial_number, robot.get("selected_plan")
            ),
            "selected_area": robot.get("selected_area"),
            "selected_area_name": self.catalog.area_name(
                serial_number, robot.get("selected_area")
            ),
            "active_plan": active_plan,
            "last_interrupted_plan": deepcopy(robot.get("last_interrupted_plan")),
            "last_run": public_last_run,
        }

    def next_run_estimate_seconds(
        self, serial_number: str, rooms: Sequence[tuple[str, str, str]]
    ) -> int | None:
        """Sum confident per-room medians at the settings the next run uses."""
        if not rooms:
            return None
        robot = self.repository.robot(serial_number)
        total = 0
        for room_id, cleaning_mode, coverage_setting in rooms:
            history = plan_timing._compatible_duration_history(
                robot,
                room_id,
                {
                    "cleaning_mode": cleaning_mode,
                    "coverage_setting": coverage_setting,
                },
            )
            expected = plan_timing._expected_duration(
                {"duration_history_seconds": history}
            )
            if expected is None:
                return None
            total += expected
        return total

    def rotation(self, serial_number: str, plan_id: str) -> dict[str, Any]:
        rotations = self.repository.robot(serial_number)["rotations"]
        rotation = rotations.get(plan_id)
        if not isinstance(rotation, dict):
            rotation = {"rooms": {}}
            rotations[plan_id] = rotation
        return cast(dict[str, Any], rotation)

    def room(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> dict[str, Any]:
        records = self.rotation(serial_number, plan_id)["rooms"]
        record = records.get(room.room_id)
        if not isinstance(record, dict):
            record = {}
            records[room.room_id] = record
        plan_timing._admit_room_settings(record, room)
        record.update(asdict(room))
        return cast(dict[str, Any], record)

    async def async_save_native_history(
        self,
        serial_number: str,
        before: dict[str, Any],
    ) -> None:
        """Retain retryable evidence and fence replacement behind this save."""
        robot = self.repository.robot(serial_number)
        applied = deepcopy(robot)
        generation = self.control.motion_generation(serial_number)
        done = asyncio.Event()
        saves = self.repository.native_history_saves.setdefault(serial_number, set())
        saves.add(done)
        try:
            await self.repository.store.async_save(self.repository.data)
        except Exception, asyncio.CancelledError:
            if self.control.motion_generation(serial_number) != generation:
                # Replacement must persist removal after this rollback finishes.
                if before.get("pending_native_reconciliation") is not None:
                    self.repository.reconciliation_removal_pending.add(serial_number)
                before.pop("pending_native_reconciliation", None)
                applied.pop("pending_native_reconciliation", None)
            plan_storage._restore_unsaved_changes(robot, before, applied)
            raise
        finally:
            saves.discard(done)
            if not saves:
                self.repository.native_history_saves.pop(serial_number, None)
            done.set()
