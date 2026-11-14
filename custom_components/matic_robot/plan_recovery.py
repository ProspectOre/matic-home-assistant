"""Owned recovery checkpoints and dispatch evidence for restart safety."""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import (
    Mapping,
    Sequence,
)
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
)
from .const import DOMAIN, MAX_ROOM_SEQUENCE_SIZE
from .coverage_accounting import (
    CoverageEvidence,
    coverage_evidence_from_storage,
)
from .plan_model import (
    _dispatching_room_leg,
    checkpoint_legs,
    plan_floor_token,
)
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


def recovery_run_state(robot: Mapping[str, Any]) -> dict[str, Any] | None:
    """Select private recovery state for the current unfinished run."""
    run = robot.get("last_run")
    if isinstance(run, dict) and run.get("outcome") == "running":
        if isinstance(run.get("recovery_checkpoint"), dict):
            return run
    return None


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

    def recovery_run(self, serial_number: str) -> dict[str, Any] | None:
        """Return a private snapshot of the current restart checkpoint."""
        run = recovery_run_state(self.repository.robot(serial_number))
        return deepcopy(run) if run is not None else None

    async def async_set_recovery_checkpoint(
        self,
        serial_number: str,
        run_id: str,
        checkpoint: dict[str, Any],
    ) -> None:
        """Persist the resolved queue required for safe restart recovery."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.commit(serial_number) as robot:
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
            async with self.repository.commit(serial_number) as robot:
                run = robot.get("last_run")
                checkpoint = (
                    run.get("recovery_checkpoint") if isinstance(run, dict) else None
                )
                if (
                    not isinstance(run, dict)
                    or run.get("run_id") != run_id
                    or run.get("outcome") != "running"
                    or not isinstance(checkpoint, dict)
                    or checkpoint.get("phase") != RunPhase.DISPATCHING
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
                checkpoint["coverage_evidence"] = evidence.as_storage()
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
            async with self.repository.commit(serial_number):
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
                    or checkpoint.get("phase") != RunPhase.DISPATCHING
                    or checkpoint.get("mixed_settings") is not True
                    or not _dispatching_room_leg(checkpoint)
                ):
                    raise HomeAssistantError(
                        "Mixed mission checkpoint is not dispatchable",
                        translation_domain=DOMAIN,
                        translation_key="run_changed",
                    )
                checkpoint["mixed_initial_session_hash"] = session_identity_hash

        await self.repository.async_run_owned_metadata(
            serial_number, commit, notify=True
        )

    async def async_prepare_mixed_dispatch_stop(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Persist an at-most-once STOP intent for an exact partial mission."""
        if serial_number in self.repository.metadata_admission_closed:
            return

        def owned_checkpoint() -> dict[str, Any] | None:
            run = self.repository.robot(serial_number).get("last_run")
            checkpoint = (
                run.get("recovery_checkpoint") if isinstance(run, dict) else None
            )
            if (
                not isinstance(run, dict)
                or run.get("run_id") != run_id
                or run.get("outcome") != "running"
                or not isinstance(checkpoint, dict)
                or checkpoint.get("phase") != RunPhase.DISPATCHING
                or checkpoint.get("mixed_initial_session_hash") != session_identity_hash
                or checkpoint.get("stop_intent") not in {None, "after_room"}
            ):
                return None
            return checkpoint

        def owned() -> dict[str, Any]:
            if (checkpoint := owned_checkpoint()) is None:
                raise HomeAssistantError(
                    "Mixed mission STOP no longer owns its checkpoint",
                    translation_domain=DOMAIN,
                    translation_key="run_changed",
                )
            return checkpoint

        owned()
        self.control.mark_stop_pending(serial_number, run_id=run_id)

        def write() -> bool:
            owned()["stop_intent"] = "immediate"
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
            run = self.repository.robot(serial_number).get("last_run") or {}
            checkpoint = run.get("recovery_checkpoint") or {}
            if (
                run.get("run_id") != run_id
                or checkpoint.get("stop_intent") != "immediate"
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

        def owned_checkpoint() -> dict[str, Any] | None:
            run = self.repository.robot(serial_number).get("last_run")
            checkpoint = (
                run.get("recovery_checkpoint") if isinstance(run, dict) else None
            )
            if (
                not isinstance(run, dict)
                or run.get("run_id") != run_id
                or not isinstance(checkpoint, dict)
                or checkpoint.get("mixed_initial_session_hash") != session_identity_hash
                or checkpoint.get("stop_intent") != "immediate"
            ):
                return None
            return checkpoint

        if (
            owned_checkpoint() is None
            or self.repository.robot(serial_number).get(plan_storage.STOP_FENCE_RUN_ID)
            != run_id
        ):
            return
        self.control.clear_stop_pending(serial_number)

        def write() -> bool:
            if (checkpoint := owned_checkpoint()) is not None:
                checkpoint.pop("stop_intent", None)
            return True

        await self.repository.async_mutate_and_save(
            serial_number, write, finish_during_unload=True
        )

    async def async_checkpoint_stop_intent(
        self, serial_number: str, behavior: str, *, run_id: str | None
    ) -> None:
        """Do not lose a user's stop request if HA restarts before completion."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.commit(serial_number, user=True) as robot:
                run = robot.get("last_run")
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
            async with self.repository.commit(serial_number) as robot:
                last_run = robot.get("last_run")
                if (
                    not isinstance(last_run, dict)
                    or last_run.get("outcome") != "running"
                ):
                    return False
                last_run["recovery_status"] = status[:32]
                last_run["recovery_reason"] = reason[:64]
                active = robot.get("active_plan")
                if isinstance(active, dict):
                    active["status"] = status
            return True

        def notify_if_changed(committed: bool) -> None:
            if committed:
                self.repository.notify_listeners(serial_number)

        await self.repository.async_run_owned_metadata(
            serial_number, commit, after_commit=notify_if_changed
        )
