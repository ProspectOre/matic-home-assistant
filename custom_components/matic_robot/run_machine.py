"""A plan run's position in its queue and the checkpoint writes each step makes.

The executor feeds an event to ``transition`` and applies the writes it
returns to the run's recovery checkpoint; nothing else sets a run's phase or
queue position. The checkpoint stays the one durable record, in the format
restart recovery reads.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from typing import Any


class RunPhase(StrEnum):
    """Where a durable run stands in its current leg, as checkpointed."""

    READY = "ready"
    DISPATCHING = "dispatching"
    STARTING = "starting"
    ACCEPTED = "accepted"
    VERIFYING = "verifying"
    HANDOFF = "handoff"


@dataclass(frozen=True, slots=True)
class Run:
    """The queue state a run checkpoints: its leg, phase and settled entries."""

    phase: RunPhase = RunPhase.READY
    leg_index: int = 0
    completed_room_ids: frozenset[str] = frozenset()
    finished_area_legs: frozenset[int] = frozenset()

    @classmethod
    def from_checkpoint(cls, checkpoint: Mapping[str, Any]) -> Run:
        """Resume from the checkpoint restart recovery validated."""
        return cls(
            RunPhase(checkpoint["phase"]),
            checkpoint["leg_index"],
            frozenset(checkpoint.get("completed_room_ids", [])),
            frozenset(checkpoint.get("finished_area_legs", [])),
        )

    def position(self) -> dict[str, Any]:
        """Return the queue position as the checkpoint stores it."""
        return {
            "leg_index": self.leg_index,
            "phase": self.phase.value,
            "completed_room_ids": sorted(self.completed_room_ids),
        }


@dataclass(frozen=True, slots=True)
class HandoffEntered:
    """The run waits for the previous leg's mission to settle before a leg."""

    leg_index: int


@dataclass(frozen=True, slots=True)
class LegDispatching:
    """The run is about to send a leg's command."""

    leg_index: int


@dataclass(frozen=True, slots=True)
class DispatchRecorded:
    """The robot took a leg's command; a deadline means its start was seen."""

    dispatched_at: datetime
    completion_deadline: datetime | None
    native_identity: bytes | None
    history_baseline: frozenset[bytes] | None


@dataclass(frozen=True, slots=True)
class RoomVerified:
    """The robot's own history credited a room."""

    room_id: str


@dataclass(frozen=True, slots=True)
class AreaFinished:
    """A custom area's own mission ended; the last leg saves at once."""

    leg_index: int
    last_leg: bool


@dataclass(frozen=True, slots=True)
class LegVerifying:
    """A leg's mission ended; its history is read until ``deadline``."""

    deadline: datetime


@dataclass(frozen=True, slots=True)
class LegVerified:
    """A leg's rooms are settled and the next leg waits for its handoff.

    ``history`` is the robot's session history at this boundary, or None when
    it could not be read, which leaves the next leg unable to start.
    """

    next_leg_index: int
    history: frozenset[bytes] | None


type RunEvent = (
    HandoffEntered
    | LegDispatching
    | DispatchRecorded
    | RoomVerified
    | AreaFinished
    | LegVerifying
    | LegVerified
)


@dataclass(frozen=True, slots=True)
class CheckpointWrite:
    """Fields to set and drop on the checkpoint.

    The executor saves the checkpoint when ``save`` is true; a write with
    ``save`` false waits for a later save, or the ledger saves it with a room
    record.
    """

    fields: Mapping[str, Any]
    drop: tuple[str, ...] = ()
    save: bool = True

    def apply(self, checkpoint: dict[str, Any]) -> None:
        """Set and drop this write's fields on ``checkpoint``."""
        checkpoint.update(self.fields)
        for key in self.drop:
            checkpoint.pop(key, None)


def transition(run: Run, event: RunEvent) -> tuple[Run, CheckpointWrite]:
    """Return the run after ``event`` and the checkpoint write it needs."""
    match event:
        case HandoffEntered(leg_index):
            return _moved(run, RunPhase.HANDOFF, leg_index)
        case LegDispatching(leg_index):
            return _moved(run, RunPhase.DISPATCHING, leg_index)
        case DispatchRecorded():
            phase = (
                RunPhase.STARTING
                if event.completion_deadline is None
                else RunPhase.ACCEPTED
            )
            return replace(run, phase=phase), CheckpointWrite(
                {
                    "phase": phase.value,
                    "dispatched_at": event.dispatched_at.isoformat(),
                    "completion_deadline": event.completion_deadline.isoformat()
                    if event.completion_deadline is not None
                    else None,
                    "native_identity_hash": _digest(event.native_identity)
                    if event.native_identity
                    else None,
                    "history_baseline": _digests(event.history_baseline),
                }
            )
        case RoomVerified(room_id):
            # Saved with the next leg's position, after the leg's own records.
            return replace(
                run, completed_room_ids=run.completed_room_ids | {room_id}
            ), CheckpointWrite({}, save=False)
        case AreaFinished(leg_index, last_leg):
            finished = run.finished_area_legs | {leg_index}
            # No handoff save follows the last leg, so it saves now; a
            # restart before finalization then still completes the run.
            return replace(run, finished_area_legs=finished), CheckpointWrite(
                {"finished_area_legs": sorted(finished)}, save=last_leg
            )
        case LegVerifying(deadline):
            # The ledger saves it with the room's verifying record.
            return replace(run, phase=RunPhase.VERIFYING), CheckpointWrite(
                {
                    "phase": RunPhase.VERIFYING.value,
                    "verification_deadline": deadline.isoformat(),
                },
                save=False,
            )
    moved, write = _moved(run, RunPhase.HANDOFF, event.next_leg_index)
    return moved, CheckpointWrite(
        {**write.fields, "handoff_history": _digests(event.history)},
        drop=("verification_deadline",),
    )


def _moved(run: Run, phase: RunPhase, leg_index: int) -> tuple[Run, CheckpointWrite]:
    moved = replace(run, phase=phase, leg_index=leg_index)
    return moved, CheckpointWrite(moved.position())


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _digests(values: frozenset[bytes] | None) -> list[str] | None:
    return sorted(_digest(value) for value in values) if values is not None else None
