"""A plan run's position in its queue and the checkpoint writes each step makes.

The executor feeds an event to ``transition`` and applies the writes it
returns to the run's recovery checkpoint; nothing else sets a run's phase or
queue position. The checkpoint stays the one durable record, in the format
restart recovery reads. After a restart, ``Restarted`` decides from that
record whether the run resumes and in which phase.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from typing import Any

from .plan_model import AreaLeg, CleaningRoom, checkpoint_legs

# Reason codes of a run whose every room and area has a result.
RUN_SETTLED_REASONS = frozenset({"all_rooms_verified", "all_rooms_settled"})


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
    # Rooms settled without credit: owner skips and rooms the robot couldn't reach.
    settled_room_ids: frozenset[str] = frozenset()
    # Why a restarted run ends instead of resuming; None while it can go on.
    ended: str | None = None

    @classmethod
    def from_checkpoint(cls, checkpoint: Mapping[str, Any]) -> Run:
        """Resume from the checkpoint restart recovery validated."""
        return cls(
            RunPhase(checkpoint["phase"]),
            checkpoint["leg_index"],
            frozenset(checkpoint.get("completed_room_ids", [])),
            frozenset(checkpoint.get("finished_area_legs", [])),
            frozenset(checkpoint.get("settled_room_ids", [])),
        )

    def all_settled(
        self, room_ids: Collection[str], area_legs: Collection[int]
    ) -> bool:
        """Return whether every room has a result and every area leg finished."""
        return set(room_ids) == self.completed_room_ids | self.settled_room_ids and (
            set(area_legs) <= self.finished_area_legs
        )

    @property
    def end_reason(self) -> str:
        """Name how a run whose every entry settled ended."""
        return "all_rooms_settled" if self.settled_room_ids else "all_rooms_verified"

    def position(self) -> dict[str, Any]:
        """Return the queue position as the checkpoint stores it."""
        return {
            "leg_index": self.leg_index,
            "phase": self.phase.value,
            "completed_room_ids": sorted(self.completed_room_ids),
            # Written once a room settles, so other checkpoints keep 0.6.0b1's keys.
            **(
                {"settled_room_ids": sorted(self.settled_room_ids)}
                if self.settled_room_ids
                else {}
            ),
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
class RoomSettled:
    """A room ended without credit: the owner skipped it or it was unreachable."""

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


@dataclass(frozen=True, slots=True)
class Restarted:
    """Home Assistant started again and found ``record``, the stored running run.

    Fed to a fresh ``Run()``, it resumes the run at its checkpointed position,
    or ends it with a reason code when the checkpoint cannot authorize more.
    """

    record: Mapping[str, Any]


type RunEvent = (
    HandoffEntered
    | LegDispatching
    | DispatchRecorded
    | RoomVerified
    | RoomSettled
    | AreaFinished
    | LegVerifying
    | LegVerified
    | Restarted
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
        case RoomSettled(room_id):
            # Saved at once: the last leg has no next position to carry it.
            settled = replace(run, settled_room_ids=run.settled_room_ids | {room_id})
            return settled, CheckpointWrite(
                {"settled_room_ids": sorted(settled.settled_room_ids)}
            )
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
        case Restarted(record):
            return _restarted(record), CheckpointWrite({}, save=False)
    moved, write = _moved(run, RunPhase.HANDOFF, event.next_leg_index)
    return moved, CheckpointWrite(
        {**write.fields, "handoff_history": _digests(event.history)},
        drop=("verification_deadline",),
    )


def stored_instant(value: Any) -> datetime | None:
    """Return a checkpointed time, or None when it is unreadable or naive."""
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def is_digest(value: object) -> bool:
    """Return whether ``value`` is a stored SHA-256 fingerprint."""
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    )


def _restarted(record: Mapping[str, Any]) -> Run:
    """Resume a stored run, or end it, checking in the order recovery always has.

    Only an accepted, verifying or handoff checkpoint, or a mixed-settings
    dispatch with its saved session fingerprint, can resume. A malformed
    record raises, as it always has.
    """
    checkpoint = record["recovery_checkpoint"]
    unverified = Run(ended="restart_checkpoint_unverified")
    stop_requested = Run(ended="restart_stop_requested")
    if checkpoint.get("stop_intent") in {"immediate", "not_running"}:
        return stop_requested
    phase = checkpoint.get("phase")
    mixed_dispatch = (
        phase == RunPhase.DISPATCHING
        and checkpoint.get("mixed_settings") is True
        and is_digest(checkpoint.get("mixed_initial_session_hash"))
    )
    if checkpoint.get("version") != 1 or (
        phase not in {RunPhase.ACCEPTED, RunPhase.VERIFYING, RunPhase.HANDOFF}
        and not mixed_dispatch
    ):
        return unverified
    verifying = phase == RunPhase.VERIFYING
    handoff = phase == RunPhase.HANDOFF
    if handoff and checkpoint.get("stop_intent") == "after_room":
        # The preceding leg is already credited. A persisted graceful stop
        # must not wait for native settlement or resume the queue.
        return stop_requested
    if verifying and (
        stored_instant(checkpoint.get("verification_deadline", "")) is None
    ):
        return unverified
    rooms = [CleaningRoom(**room) for room in checkpoint["rooms"]]
    room_ids = {room.room_id for room in rooms}
    legs = checkpoint_legs(checkpoint)
    area_legs = {index for index, leg in enumerate(legs) if isinstance(leg, AreaLeg)}
    saved = Run(
        completed_room_ids=frozenset(checkpoint.get("completed_room_ids", [])),
        settled_room_ids=frozenset(checkpoint.get("settled_room_ids", [])),
        finished_area_legs=frozenset(checkpoint.get("finished_area_legs", [])),
    )
    if (
        (rooms or area_legs)
        and saved.all_settled(room_ids, area_legs)
        and len(room_ids) == len(rooms) == record["room_count"]
        and record["completed_room_count"] == len(saved.completed_room_ids)
    ):
        # Room results and area finishes are saved before the checkpoint
        # records them, so a crash before finalization keeps the completion.
        return Run(ended=saved.end_reason)
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
                    room.room_id
                    for leg in legs[:leg_index]
                    if isinstance(leg, list)
                    for room in leg
                }.issubset(saved.completed_room_ids | saved.settled_room_ids)
                or not {index for index in area_legs if index < leg_index}.issubset(
                    saved.finished_area_legs
                )
            )
        )
    ):
        return unverified
    if isinstance(legs[leg_index], AreaLeg) and (verifying or mixed_dispatch):
        # An area is its own mission: it is never verified from history and
        # never part of a mixed room dispatch.
        return unverified
    if not is_digest(
        checkpoint.get(
            "mixed_initial_session_hash" if mixed_dispatch else "native_identity_hash"
        )
    ):
        return unverified
    if not mixed_dispatch and not handoff:
        # A handoff has no accepted dispatch for its next leg yet.
        if stored_instant(checkpoint["dispatched_at"]) is None:
            return unverified
        deadline = checkpoint.get("completion_deadline")
        if not verifying and (
            not isinstance(deadline, str) or stored_instant(deadline) is None
        ):
            return unverified
    return Run.from_checkpoint(checkpoint)


def _moved(run: Run, phase: RunPhase, leg_index: int) -> tuple[Run, CheckpointWrite]:
    moved = replace(run, phase=phase, leg_index=leg_index)
    return moved, CheckpointWrite(moved.position())


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _digests(values: frozenset[bytes] | None) -> list[str] | None:
    return sorted(_digest(value) for value in values) if values is not None else None
