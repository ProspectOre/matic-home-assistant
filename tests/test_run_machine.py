"""The run state machine moves and checkpoints a run without Home Assistant."""

import hashlib
from datetime import UTC, datetime, timedelta

import pytest

from custom_components.matic_robot.run_machine import (
    AreaFinished,
    CheckpointWrite,
    DispatchRecorded,
    HandoffEntered,
    LegDispatching,
    LegVerified,
    RoomVerified,
    Run,
    RunPhase,
    transition,
)

SENT = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


def _hash(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def test_phases_keep_the_stored_checkpoint_words() -> None:
    """Restart recovery reads checkpoints written before the enum existed."""
    assert [phase.value for phase in RunPhase] == [
        "ready",
        "dispatching",
        "starting",
        "accepted",
        "verifying",
        "handoff",
    ]


def test_a_new_run_starts_ready_at_its_first_leg() -> None:
    assert Run().position() == {
        "leg_index": 0,
        "phase": "ready",
        "completed_room_ids": [],
    }


@pytest.mark.parametrize(
    ("event", "phase"),
    [(LegDispatching(2), RunPhase.DISPATCHING), (HandoffEntered(2), RunPhase.HANDOFF)],
)
def test_moving_to_a_leg_saves_its_position(event, phase) -> None:
    run = Run(completed_room_ids=frozenset({"b", "a"}))
    moved, write = transition(run, event)
    assert moved == Run(phase, 2, frozenset({"a", "b"}))
    assert write == CheckpointWrite(
        {"leg_index": 2, "phase": phase.value, "completed_room_ids": ["a", "b"]}
    )


def test_a_dispatch_starts_then_is_accepted_with_its_deadline() -> None:
    run = Run(RunPhase.DISPATCHING)
    started, write = transition(
        run, DispatchRecorded(SENT, None, b"session", frozenset({b"y", b"x"}))
    )
    assert started.phase is RunPhase.STARTING
    assert write == CheckpointWrite(
        {
            "phase": "starting",
            "dispatched_at": SENT.isoformat(),
            "completion_deadline": None,
            "native_identity_hash": _hash(b"session"),
            "history_baseline": sorted([_hash(b"x"), _hash(b"y")]),
        }
    )
    deadline = SENT + timedelta(hours=6)
    accepted, write = transition(started, DispatchRecorded(SENT, deadline, None, None))
    assert accepted == Run(RunPhase.ACCEPTED)
    assert write.fields["phase"] == "accepted"
    assert write.fields["completion_deadline"] == deadline.isoformat()
    assert write.fields["native_identity_hash"] is None
    assert write.fields["history_baseline"] is None


def test_an_empty_identity_is_not_checkpointed() -> None:
    _, write = transition(Run(), DispatchRecorded(SENT, None, b"", frozenset()))
    assert write.fields["native_identity_hash"] is None
    assert write.fields["history_baseline"] == []


def test_a_verified_room_waits_for_the_next_save() -> None:
    """The leg's own records save first; the next leg's position carries it."""
    run, write = transition(Run(RunPhase.ACCEPTED), RoomVerified("kitchen"))
    assert write == CheckpointWrite({}, save=False)
    assert run.completed_room_ids == {"kitchen"}
    assert run.phase is RunPhase.ACCEPTED


def test_an_area_saves_only_when_it_is_the_last_leg() -> None:
    run, write = transition(Run(), AreaFinished(3, last_leg=False))
    assert write == CheckpointWrite({"finished_area_legs": [3]}, save=False)
    run, write = transition(run, AreaFinished(1, last_leg=True))
    assert run.finished_area_legs == {1, 3}
    assert write == CheckpointWrite({"finished_area_legs": [1, 3]})


@pytest.mark.parametrize(
    ("history", "stored"),
    [(frozenset({b"b", b"a"}), sorted([_hash(b"a"), _hash(b"b")])), (None, None)],
)
def test_a_verified_leg_hands_off_to_the_next(history, stored) -> None:
    run = Run(RunPhase.ACCEPTED, 0, frozenset({"kitchen"}))
    moved, write = transition(run, LegVerified(1, history))
    assert moved == Run(RunPhase.HANDOFF, 1, frozenset({"kitchen"}))
    assert write == CheckpointWrite(
        {
            "leg_index": 1,
            "phase": "handoff",
            "completed_room_ids": ["kitchen"],
            "handoff_history": stored,
        },
        drop=("verification_deadline",),
    )


def test_a_run_resumes_from_its_checkpoint() -> None:
    assert Run.from_checkpoint(
        {
            "phase": "verifying",
            "leg_index": 2,
            "completed_room_ids": ["a"],
            "finished_area_legs": [1],
        }
    ) == Run(RunPhase.VERIFYING, 2, frozenset({"a"}), frozenset({1}))
    assert Run.from_checkpoint({"phase": "handoff", "leg_index": 1}) == Run(
        RunPhase.HANDOFF, 1
    )
