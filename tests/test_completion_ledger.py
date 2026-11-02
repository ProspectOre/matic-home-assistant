"""Replay and persistence behavior for the pure cadence ledger."""

from __future__ import annotations

import json
import sys

from custom_components.matic_robot.completion_ledger import (
    record_completion,
    reset_progress,
    retract_completion,
)


def _id(number: int) -> str:
    return f"{number:064x}"


def _snapshot(**overrides: object) -> dict[str, object]:
    result: dict[str, object] = {
        "scope": "plan",
        "schedule_active": True,
        "mop_every_n": 3,
        "coverage_every_n": 2,
        "periodic_coverage_setting": "heavy_duty",
        "effective_cleaning_mode": "vacuum",
        "effective_coverage_setting": "standard",
        "mop_due": False,
        "coverage_due": False,
        "do_mop_next": False,
        "do_coverage_next": False,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    result.update(overrides)
    return result


def _managed(
    schedule: dict[str, object], n: int, at: float, mode: str = "vacuum"
) -> bool:
    return record_completion(
        schedule,
        _id(n),
        at=at,
        source="managed",
        snapshot=_snapshot(),
        mode=mode,
    )


def test_replay_is_chronological_deduplicated_and_preserves_upgrade_baseline() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 1, "coverage": 1}}
    assert _managed(schedule, 1, 20)
    assert not _managed(schedule, 1, 20)
    assert _managed(schedule, 2, 10)
    assert schedule["accounting"]["baseline"] == {"mop": 1, "coverage": 1}  # type: ignore[index]
    # Both dispatches froze a not-due snapshot, so replay advances two counts.
    assert schedule["progress"] == {"mop": 2, "coverage": 1}


def test_native_correction_retains_first_snapshot_and_retraction_replays_later_events():
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    native = _snapshot(cleaning_mode="vacuum", coverage_setting="standard")
    assert record_completion(
        schedule,
        _id(1),
        at=1,
        source="native",
        snapshot=native,
        mode="vacuum",
        coverage="standard",
    )
    edited = _snapshot(mop_every_n=9, coverage_setting="quick")
    assert record_completion(
        schedule,
        _id(1),
        at=2,
        source="native",
        snapshot=edited,
        mode="vacuum_and_mop",
        coverage="heavy_duty",
    )
    event = schedule["accounting"]["events"][0]  # type: ignore[index]
    assert event["snapshot"]["mop_every_n"] == 3
    assert _managed(schedule, 2, 3)
    assert retract_completion(schedule, _id(1))
    assert schedule["progress"] == {"mop": 1, "coverage": 1}
    assert not retract_completion(schedule, _id(2))


def test_managed_promotes_native_and_keeps_managed_snapshot() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert record_completion(
        schedule,
        _id(1),
        at=1,
        source="native",
        snapshot=_snapshot(),
        mode="vacuum",
        coverage="standard",
    )
    frozen = _snapshot(mop_every_n=2)
    assert record_completion(
        schedule,
        _id(1),
        at=2,
        source="managed",
        snapshot=frozen,
        mode="vacuum_and_mop",
        coverage="heavy_duty",
    )
    assert schedule["accounting"]["events"][0]["source"] == "managed"  # type: ignore[index]
    assert schedule["accounting"]["events"][0]["snapshot"]["mop_every_n"] == 2  # type: ignore[index]
    assert not record_completion(
        schedule,
        _id(1),
        at=3,
        source="native",
        snapshot=_snapshot(),
        mode="vacuum",
        coverage=None,
    )


def test_selective_reset_preserves_other_counter_and_blocks_late_pre_reset_event() -> (
    None
):
    schedule: dict[str, object] = {"progress": {"mop": 1, "coverage": 1}}
    assert reset_progress(schedule, ["mop"], at=10)
    assert _managed(schedule, 1, 5)
    assert _managed(schedule, 2, 11)
    assert schedule["progress"] == {"mop": 1, "coverage": 1}


def test_full_reset_sets_cutoff_and_survives_json_reload() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 2, "coverage": 1}}
    assert _managed(schedule, 1, 1)
    assert reset_progress(schedule, ["mop", "coverage"], at=5)
    assert not _managed(schedule, 2, 5)
    assert _managed(schedule, 3, 6)
    restored = json.loads(json.dumps(schedule))
    assert _managed(restored, 4, 7)
    assert restored["progress"] == {"mop": 2, "coverage": 1}
    assert restored["accounting"]["cutoff"] == 5


def test_one_shot_policy_flags_are_not_changed_by_recording() -> None:
    schedule: dict[str, object] = {
        "progress": {"mop": 0, "coverage": 0},
        "policy": {"do_mop_next": True, "do_coverage_next": True},
    }
    assert _managed(schedule, 1, 1, "vacuum_and_mop")
    assert schedule["policy"] == {"do_mop_next": True, "do_coverage_next": True}


def test_native_replay_recomputes_due_from_frozen_policy_and_replayed_progress() -> (
    None
):
    schedule: dict[str, object] = {"progress": {"mop": 2, "coverage": 0}}
    snapshot = _snapshot(
        mop_due=False,
        effective_cleaning_mode="vacuum",
        cleaning_mode="vacuum",
    )
    assert record_completion(
        schedule,
        _id(1),
        at=1,
        source="native",
        snapshot=snapshot,
        mode="vacuum_and_mop",
        coverage="standard",
    )
    # At two of three, the native snapshot is due despite its stale due flag.
    assert schedule["progress"]["mop"] == 0  # type: ignore[index]


def test_invalid_values_fail_closed_without_recording() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert not record_completion(
        schedule,
        "raw-room-name",
        at=float("nan"),
        source="managed",
        snapshot=_snapshot(),
        mode="vacuum",
    )
    assert record_completion(
        schedule,
        _id(1),
        at=1,
        source="managed",
        snapshot=_snapshot(untrusted_room_id="secret"),
        mode="vacuum",
    )
    stored = schedule["accounting"]["events"][0]["snapshot"]  # type: ignore[index]
    assert "untrusted_room_id" not in stored


def test_snapshot_extras_are_filtered_and_optional_policy_is_normalized() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    snapshot = {
        "scope": "shared",
        "schedule_active": True,
        "effective_cleaning_mode": "vacuum",
        "effective_coverage_setting": "standard",
        "identity": "private-room-identity",
        "shared_schedule_participating": True,
        "mop_progress": 5,
        "coverage_progress": 4,
        "next_mop_in": 2,
        "next_coverage_in": 1,
    }
    assert record_completion(
        schedule,
        _id(1),
        at=1,
        source="managed",
        snapshot=snapshot,
        mode="vacuum",
    )
    stored = schedule["accounting"]["events"][0]["snapshot"]  # type: ignore[index]
    assert stored["mop_every_n"] is None
    assert stored["coverage_every_n"] is None
    assert stored["periodic_coverage_setting"] is None
    assert "identity" not in stored
    assert "mop_progress" not in stored


def test_unhashable_bad_inputs_fail_closed() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert not record_completion(
        schedule,
        _id(1),
        at=1,
        source="managed",
        snapshot=_snapshot(scope=[]),
        mode=[],
        coverage={},  # type: ignore[arg-type]
    )
    assert not reset_progress(schedule, [["mop"]], at=1)  # type: ignore[list-item]
    assert not reset_progress(schedule, None, at=1)  # type: ignore[arg-type]
    assert "accounting" not in schedule


def test_invalid_duplicate_or_unknown_persisted_events_fail_closed() -> None:
    event = {
        "id": _id(1),
        "at": 1,
        "source": "managed",
        "snapshot": _snapshot(),
        "mode": "vacuum",
        "coverage": None,
        "order": 0,
    }
    duplicate = {
        "version": 1,
        "baseline": {"mop": 0, "coverage": 0},
        "events": [event, {**event, "order": 1}],
    }
    schedule: dict[str, object] = {"accounting": duplicate}
    assert not _managed(schedule, 2, 2)
    unknown = {
        "version": 1,
        "baseline": {"mop": 0, "coverage": 0},
        "events": [{**event, "id": _id(2), "kind": "unexpected"}],
    }
    assert not _managed({"accounting": unknown}, 3, 3)
    duplicate_order = {
        "version": 1,
        "baseline": {"mop": 0, "coverage": 0},
        "events": [event, {**event, "id": _id(3), "order": 0}],
    }
    assert not _managed({"accounting": duplicate_order}, 4, 4)


def test_snapshot_and_timestamp_validation_rejects_malformed_known_values() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    invalid_snapshots = [
        [],
        _snapshot(scope=[]),
        _snapshot(schedule_active=1),
        _snapshot(mop_every_n=True),
        _snapshot(periodic_coverage_setting=[]),
        _snapshot(cleaning_mode=[]),
        _snapshot(coverage_setting=[]),
        _snapshot(mop_due=1),
    ]
    for index, snapshot in enumerate(invalid_snapshots, start=10):
        assert not record_completion(
            schedule,
            _id(index),
            at=1,
            source="managed",
            snapshot=snapshot,  # type: ignore[arg-type]
            mode="vacuum",
        )
    assert not record_completion(
        schedule,
        _id(30),
        at=sys.float_info.max * 2,
        source="managed",
        snapshot=_snapshot(),
        mode="vacuum",
    )
    assert not record_completion(
        schedule,
        _id(31),
        at=sys.maxsize**1000,
        source="managed",
        snapshot=_snapshot(),
        mode="vacuum",
    )
    assert not record_completion(
        schedule,
        _id(32),
        at="not-a-time",  # type: ignore[arg-type]
        source="managed",
        snapshot=_snapshot(),
        mode="vacuum",
    )


def test_malformed_persisted_ledger_and_initial_progress_fail_closed() -> None:
    assert not _managed({"progress": []}, 1, 1)  # type: ignore[arg-type]
    assert not _managed({"progress": {"mop": True}}, 2, 1)
    for accounting in (
        [],
        {"version": 1, "baseline": [], "events": []},
        {"version": 1, "baseline": {"mop": True, "coverage": 0}, "events": []},
        {
            "version": 1,
            "baseline": {"mop": 0, "coverage": 0},
            "events": [],
            "cutoff": float("inf"),
        },
        {
            "version": 1,
            "baseline": {"mop": 0, "coverage": 0},
            "events": [{"at": float("nan")}],
        },
        {
            "version": 1,
            "baseline": {"mop": 0, "coverage": 0},
            "events": [{"at": 1, "order": True}],
        },
        {
            "version": 1,
            "baseline": {"mop": 0, "coverage": 0},
            "events": [
                {"id": "reset:0", "at": 1, "order": 0, "kind": "reset", "modes": []}
            ],
        },
        {
            "version": 1,
            "baseline": {"mop": 0, "coverage": 0},
            "events": [
                {
                    "id": _id(8),
                    "at": 1,
                    "order": 0,
                    "source": "managed",
                    "snapshot": _snapshot(),
                    "mode": [],
                    "coverage": None,
                }
            ],
        },
    ):
        assert not _managed({"accounting": accounting}, 3, 2)  # type: ignore[arg-type]


def test_retraction_and_reset_reject_missing_or_malformed_history_inputs() -> None:
    assert not retract_completion({"accounting": []}, _id(1))  # type: ignore[arg-type]
    assert not retract_completion(
        {
            "accounting": {
                "version": 1,
                "baseline": {"mop": 0, "coverage": 0},
                "events": [],
            }
        },
        _id(1),
    )
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert not reset_progress(schedule, "mop", at=1)  # type: ignore[arg-type]
    assert not reset_progress(schedule, [], at=1)
    assert not reset_progress(schedule, ["mop"], at=float("nan"))
    assert not reset_progress({"accounting": []}, ["mop"], at=1)  # type: ignore[arg-type]


def test_managed_completion_cannot_be_a_tombstone() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert not record_completion(
        schedule,
        _id(5),
        at=1,
        source="managed",
        snapshot=_snapshot(),
        mode=None,
    )
    assert "accounting" not in schedule


def test_tombstoned_event_cannot_be_corrected_before_full_reset_cutoff() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert _managed(schedule, 1, 6)
    assert reset_progress(schedule, ["mop", "coverage"], at=5)
    assert retract_completion(schedule, _id(1)) is False
    event_id = _id(2)
    assert record_completion(
        schedule,
        event_id,
        at=6,
        source="native",
        snapshot=_snapshot(),
        mode="vacuum",
        coverage="standard",
    )
    assert retract_completion(schedule, event_id)
    assert not record_completion(
        schedule,
        event_id,
        at=4,
        source="native",
        snapshot=_snapshot(),
        mode="vacuum",
        coverage="standard",
    )


def test_correcting_existing_event_before_full_reset_cutoff_retracts_it() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert _managed(schedule, 1, 6)
    assert reset_progress(schedule, ["mop", "coverage"], at=5)
    # The event occurred after the reset; its later correction moves it before.
    assert record_completion(
        schedule,
        _id(1),
        at=4,
        source="managed",
        snapshot=_snapshot(),
        mode="vacuum",
    )
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


def test_compaction_preserves_future_events_and_assigns_unique_later_orders() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert _managed(schedule, 1, 1)
    assert _managed(schedule, 2, 7)
    assert reset_progress(schedule, ["mop", "coverage"], at=5)
    assert reset_progress(schedule, ["mop"], at=8)
    assert _managed(schedule, 3, 9)
    accounting = schedule["accounting"]  # type: ignore[assignment]
    orders = [event["order"] for event in accounting["events"]]
    assert len(orders) == len(set(orders))
    assert schedule["progress"]["mop"] == 1  # type: ignore[index]


def test_native_event_corrected_before_cutoff_becomes_tombstone() -> None:
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert reset_progress(schedule, ["mop", "coverage"], at=5)
    assert record_completion(
        schedule,
        _id(9),
        at=6,
        source="native",
        snapshot=_snapshot(),
        mode="vacuum",
        coverage="standard",
    )
    assert record_completion(
        schedule,
        _id(9),
        at=4,
        source="native",
        snapshot=_snapshot(),
        mode="vacuum",
        coverage="standard",
    )
    event = schedule["accounting"]["events"][0]  # type: ignore[index]
    assert event["mode"] is None
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


def test_native_admission_rejects_inactive_or_missing_base_settings():
    schedule = {}
    assert not record_completion(
        schedule,
        _id(1),
        at=1,
        source="native",
        snapshot=_snapshot(schedule_active=False),
        mode="vacuum",
    )
    snapshot = _snapshot()
    snapshot.pop("cleaning_mode")
    assert not record_completion(
        schedule, _id(1), at=1, source="native", snapshot=snapshot, mode="vacuum"
    )
    assert schedule == {}


def test_missing_progress_is_materialized_and_reset_cutoff_never_moves_back():
    schedule = {}
    assert _managed(schedule, 1, 1)
    assert schedule["progress"] == {"mop": 1, "coverage": 1}
    assert reset_progress(schedule, ["mop", "coverage"], at=10)
    assert reset_progress(schedule, ["mop", "coverage"], at=5)
    assert not _managed(schedule, 2, 7)
    assert schedule["accounting"]["cutoff"] == 10
    assert schedule["progress"] == {"mop": 0, "coverage": 0}
