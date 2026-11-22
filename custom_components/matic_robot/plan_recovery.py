"""Owned recovery checkpoints and dispatch evidence for restart safety."""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import TYPE_CHECKING, Any, Protocol
from uuid import UUID

from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError

from . import plan_storage
from .cadence_accounting import (
    validated_cadence_snapshots as _validated_cadence_snapshots,
)
from .client import (
    CoverageReceipt,
    FloorPlan,
    coverage_floor_hash,
    coverage_region_hash,
    is_sha256_hex,
)
from .const import DOMAIN, MAX_ROOM_SEQUENCE_SIZE
from .coverage_accounting import (
    CoverageEvidence,
    coverage_evidence_from_storage,
)
from .plan_model import plan_floor_token
from .plan_records import LastRun, RecoveryCheckpoint
from .plan_repository import (
    PlanRepository,
    _MetadataLockLease,
)
from .run_machine import RunPhase

if TYPE_CHECKING:
    from .run_control import RunControl


class _RunFinalizer(Protocol):
    """The one accounting operation needed to withdraw recovery ownership."""

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
    ) -> bool: ...


class PlanRecovery:
    """Persist restart evidence through the repository's ownership transactions."""

    def __init__(
        self,
        repository: PlanRepository,
        control: RunControl,
        finalizer: _RunFinalizer,
    ) -> None:
        self.repository = repository
        self.control = control
        self._finalizer = finalizer

    def recovery_run(self, serial_number: str) -> LastRun | None:
        """Return the running run when it has a checkpoint to recover from."""
        run = self.repository.last_run(serial_number)
        return run if run is not None and run.live_checkpoint is not None else None

    def checkpoint(self, serial_number: str, run_id: str) -> RecoveryCheckpoint | None:
        """Return the recovery checkpoint of run ``run_id`` while it runs."""
        run = self.repository.run_record(serial_number, run_id)
        return run.live_checkpoint if run is not None else None

    def counted_room_ids(self, serial_number: str, run_id: str) -> frozenset[str]:
        """Return the rooms the running run ``run_id`` has counted."""
        checkpoint = self.checkpoint(serial_number, run_id)
        return checkpoint.completed_room_ids if checkpoint else frozenset()

    async def async_set_recovery_checkpoint(
        self,
        serial_number: str,
        run_id: str,
        checkpoint: Mapping[str, Any],
    ) -> None:
        """Persist the resolved queue, in its stored form, for restart recovery."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.commit(serial_number):
                run = self.repository.run_record(serial_number, run_id)
                if run is None:
                    return False
                existing = run.checkpoint.stored() if run.checkpoint else {}
                normalized_checkpoint = deepcopy(dict(checkpoint))
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
                    in {RunPhase.STARTING, RunPhase.ACCEPTED, RunPhase.VERIFYING}
                    and all(
                        normalized_checkpoint.get(key) == existing.get(key)
                        for key in ("floor_token", "leg_index", "rooms")
                    )
                    and (
                        existing.get("phase") == RunPhase.DISPATCHING
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
                self.repository.draft_run(serial_number)["recovery_checkpoint"] = {
                    **normalized_checkpoint,
                    # Only count_room adds to the tally; a queue save keeps it.
                    "completed_room_ids": existing.get("completed_room_ids", []),
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
            return True

        def notify_if_changed(committed: bool) -> None:
            if committed:
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
            async with self.repository.commit(serial_number):
                checkpoint = self.checkpoint(serial_number, run_id)
                if (
                    checkpoint is None
                    or checkpoint.phase != RunPhase.DISPATCHING
                    or checkpoint.floor_token != plan_floor_token(floor_plan)
                    or receipt.floor_hash != coverage_floor_hash(floor_plan)
                    or receipt.session_hash
                    != hashlib.sha256(str(session_id).encode("ascii")).hexdigest()
                ):
                    return False
                raw_rooms = checkpoint.rooms
                index = checkpoint.leg_index
                if (
                    not raw_rooms
                    or len(raw_rooms) > MAX_ROOM_SEQUENCE_SIZE
                    or type(index) is not int
                    or index < 0
                ):
                    return False
                try:
                    legs = checkpoint.legs()
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
                self.repository.draft_run(serial_number)["recovery_checkpoint"][
                    "coverage_evidence"
                ] = evidence.as_storage()
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
        if run_id is None:
            return None
        checkpoint = self.checkpoint(serial_number, run_id)
        evidence = coverage_evidence_from_storage(
            checkpoint.coverage_evidence if checkpoint is not None else None
        )
        return evidence.receipt if evidence is not None else None

    async def async_checkpoint_mixed_session(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Persist the generated native identity before mixed START is sent."""

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.repository.commit(serial_number):
                if not is_sha256_hex(session_identity_hash):
                    raise ValueError(
                        "mixed session identity must be a SHA-256 fingerprint"
                    )
                checkpoint = self.checkpoint(serial_number, run_id)
                if (
                    checkpoint is None
                    or checkpoint.phase != RunPhase.DISPATCHING
                    or not checkpoint.dispatching_room_leg()
                ):
                    raise HomeAssistantError(
                        "Mixed mission checkpoint is not dispatchable",
                        translation_domain=DOMAIN,
                        translation_key="run_changed",
                    )
                self.repository.draft_run(serial_number)["recovery_checkpoint"][
                    "mixed_initial_session_hash"
                ] = session_identity_hash

        await self.repository.async_run_owned_metadata(
            serial_number, commit, notify=True
        )

    async def async_prepare_mixed_dispatch_stop(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Persist an at-most-once STOP intent for an exact partial mission."""
        if serial_number in self.repository.metadata_admission_closed:
            return

        def owned() -> None:
            checkpoint = self.checkpoint(serial_number, run_id)
            if (
                checkpoint is None
                or checkpoint.phase != RunPhase.DISPATCHING
                or checkpoint.mixed_initial_session_hash != session_identity_hash
                or checkpoint.stop_intent not in {None, "after_room"}
            ):
                raise HomeAssistantError(
                    "Mixed mission STOP no longer owns its checkpoint",
                    translation_domain=DOMAIN,
                    translation_key="run_changed",
                )

        owned()
        self.control.mark_stop_pending(serial_number, run_id=run_id)

        def write() -> bool:
            owned()
            self.repository.draft_run(serial_number)["recovery_checkpoint"][
                "stop_intent"
            ] = "immediate"
            return True

        try:
            await self.repository.async_mutate_and_save(
                serial_number, write, finish_during_unload=True
            )
        except asyncio.CancelledError:
            # The owned commit outlives this waiter. When it saves the intent,
            # keep the fence so the caller's rollback undoes both.
            pending = self.repository.metadata_persistence_tasks.get(serial_number, ())
            await asyncio.gather(
                *(asyncio.shield(task) for task in tuple(pending)),
                return_exceptions=True,
            )
            run = self.repository.run_record(serial_number, run_id)
            if (
                run is None
                or run.checkpoint is None
                or run.checkpoint.stop_intent != "immediate"
            ):
                self.control.clear_stop_pending(serial_number)
            raise
        except BaseException:
            # The intent was not saved, so this STOP is not prepared.
            self.control.clear_stop_pending(serial_number)
            raise

    async def async_rollback_mixed_dispatch_stop(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Roll back a STOP fence only when transport proves no bytes were sent."""
        if serial_number in self.repository.metadata_admission_closed:
            return

        def owned() -> bool:
            run = self.repository.run_record(serial_number, run_id)
            checkpoint = run.checkpoint if run is not None else None
            return (
                checkpoint is not None
                and checkpoint.mixed_initial_session_hash == session_identity_hash
                and checkpoint.stop_intent == "immediate"
            )

        if (
            not owned()
            or self.repository.robot(serial_number).get(plan_storage.STOP_FENCE_RUN_ID)
            != run_id
        ):
            return
        self.control.clear_stop_pending(serial_number)

        def write() -> bool:
            if owned():
                self.repository.draft_run(serial_number)["recovery_checkpoint"].pop(
                    "stop_intent", None
                )
            return True

        await self.repository.async_mutate_and_save(
            serial_number, write, finish_during_unload=True
        )

    async def async_checkpoint_stop_intent(
        self, serial_number: str, behavior: str, *, run_id: str | None
    ) -> None:
        """Do not lose a user's stop request if HA restarts before completion."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.commit(serial_number, user=True):
                run = (
                    self.repository.run_record(serial_number, run_id)
                    if run_id is not None
                    else None
                )
                if run is None or run.checkpoint is None:
                    return False
                self.repository.draft_run(serial_number)["recovery_checkpoint"][
                    "stop_intent"
                ] = behavior
                if behavior == "after_room":
                    self.control.finish_room_event(serial_number).set()
                elif behavior == "immediate":
                    self.control.finish_room_event(serial_number).clear()
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
        if (run := self.recovery_run(serial_number)) is not None:
            await self._finalizer.async_finish_run(
                serial_number,
                run.run_id,
                "unverified",
                reason,
                run.completed_room_count,
                cause="home_assistant",
            )

    async def async_mark_recovery_status(
        self, serial_number: str, status: str, *, reason: str
    ) -> None:
        """Publish reconnection state without inventing a robot outcome."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.commit(serial_number) as robot:
                run = self.repository.last_run(serial_number)
                if run is None or not run.running:
                    return False
                last_run = self.repository.draft_run(serial_number)
                last_run["recovery_status"] = status[:32]
                last_run["recovery_reason"] = reason[:64]
                if robot["active_plan"] is not None:
                    robot["active_plan"]["status"] = status
            return True

        def notify_if_changed(committed: bool) -> None:
            if committed:
                self.repository.notify_listeners(serial_number)

        await self.repository.async_run_owned_metadata(
            serial_number, commit, after_commit=notify_if_changed
        )
