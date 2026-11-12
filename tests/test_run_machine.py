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
    LegVerifying,
    Restarted,
    RoomSettled,
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


def test_a_verifying_leg_saves_with_its_room_record() -> None:
    """The ledger saves the write in the same store save as the room's record."""
    deadline = SENT + timedelta(minutes=5)
    run, write = transition(
        Run(RunPhase.ACCEPTED, 1, frozenset({"a"})), LegVerifying(deadline)
    )
    assert run == Run(RunPhase.VERIFYING, 1, frozenset({"a"}))
    assert write == CheckpointWrite(
        {"phase": "verifying", "verification_deadline": deadline.isoformat()},
        save=False,
    )


def test_a_write_sets_and_drops_checkpoint_fields() -> None:
    checkpoint = {"phase": "verifying", "verification_deadline": "x", "rooms": []}
    CheckpointWrite({"phase": "handoff"}, drop=("verification_deadline",)).apply(
        checkpoint
    )
    assert checkpoint == {"phase": "handoff", "rooms": []}


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


ROOMS = [
    {
        "room_id": room_id,
        "name": room_id.title(),
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    for room_id in ("kitchen", "office")
]


def _stored(phase: str, leg_index: int = 0, **changes) -> dict:
    """A running run's record with its checkpoint, as the store holds it."""
    checkpoint = {
        "version": 1,
        "phase": phase,
        "leg_index": leg_index,
        "single_room_missions": True,
        "rooms": ROOMS,
        "completed_room_ids": ["kitchen"] if leg_index else [],
        "native_identity_hash": _hash(b"session"),
        "dispatched_at": SENT.isoformat(),
        "completion_deadline": (SENT + timedelta(hours=6)).isoformat(),
        "verification_deadline": (SENT + timedelta(minutes=5)).isoformat(),
        **changes,
    }
    return {
        "room_count": 2,
        "completed_room_count": leg_index,
        "recovery_checkpoint": checkpoint,
    }


@pytest.mark.parametrize(
    ("record", "resumed"),
    [
        (_stored("ready"), Run(ended="restart_checkpoint_unverified")),
        (_stored("dispatching"), Run(ended="restart_checkpoint_unverified")),
        (
            _stored(
                "dispatching",
                mixed_settings=True,
                mixed_initial_session_hash=_hash(b"generated"),
            ),
            Run(RunPhase.DISPATCHING),
        ),
        (_stored("starting"), Run(ended="restart_checkpoint_unverified")),
        (_stored("accepted"), Run(RunPhase.ACCEPTED)),
        (_stored("verifying", 1), Run(RunPhase.VERIFYING, 1, frozenset({"kitchen"}))),
        (_stored("handoff", 1), Run(RunPhase.HANDOFF, 1, frozenset({"kitchen"}))),
        (
            _stored("handoff", 1, completed_room_ids=[], settled_room_ids=["kitchen"])
            | {"completed_room_count": 0},
            Run(RunPhase.HANDOFF, 1, settled_room_ids=frozenset({"kitchen"})),
        ),
    ],
    ids=[
        "ready",
        "dispatching",
        "mixed-dispatching",
        "starting",
        "accepted",
        "verifying",
        "handoff",
        "handoff-after-settled",
    ],
)
def test_a_restarted_run_resumes_only_from_a_resumable_phase(record, resumed) -> None:
    """Only an accepted, verifying, handoff or mixed dispatch can go on."""
    assert transition(Run(), Restarted(record)) == (
        resumed,
        CheckpointWrite({}, save=False),
    )


@pytest.mark.parametrize(
    ("record", "reason"),
    [
        (_stored("accepted", stop_intent="immediate"), "restart_stop_requested"),
        (_stored("handoff", 1, stop_intent="after_room"), "restart_stop_requested"),
        (_stored("verifying", verification_deadline="2026-01-02T03:04:05"), "un"),
        (_stored("handoff", 0), "un"),
        (_stored("accepted", 2), "un"),
        (_stored("accepted", native_identity_hash="not-a-digest"), "un"),
        (_stored("accepted", completion_deadline=None), "un"),
        (_stored("accepted", version=2), "un"),
        (
            _stored("accepted", 1, completed_room_ids=["kitchen", "office"])
            | {"completed_room_count": 2},
            "all_rooms_verified",
        ),
        (
            _stored("accepted", 1, settled_room_ids=["office"]),
            "all_rooms_settled",
        ),
    ],
)
def test_a_restarted_run_ends_when_its_checkpoint_cannot_go_on(record, reason) -> None:
    run, _ = transition(Run(), Restarted(record))
    assert run.ended == ("restart_checkpoint_unverified" if reason == "un" else reason)


def test_a_restarted_run_rejects_an_unreadable_record() -> None:
    """A malformed record raises, and recovery ends the run as unavailable."""
    record = _stored("accepted")
    del record["recovery_checkpoint"]["dispatched_at"]
    with pytest.raises(KeyError):
        transition(Run(), Restarted(record))


def test_a_settled_room_is_saved_with_the_next_position() -> None:
    """A room without credit counts toward the run's end, not its credit."""
    run, write = transition(Run(), RoomSettled("kitchen"))
    assert run == Run(settled_room_ids=frozenset({"kitchen"}))
    # Saved at once, so a restart before the next leg still knows it.
    assert write == CheckpointWrite({"settled_room_ids": ["kitchen"]})
    assert run.position()["settled_room_ids"] == ["kitchen"]
    assert "settled_room_ids" not in Run().position()
    assert not run.all_settled({"kitchen", "office"}, ())
    run, _ = transition(run, RoomVerified("office"))
    assert run.all_settled({"kitchen", "office"}, ())
    assert not run.all_settled({"kitchen", "office"}, {1})
    assert run.end_reason == "all_rooms_settled"
    assert Run(completed_room_ids=frozenset({"a"})).end_reason == "all_rooms_verified"
