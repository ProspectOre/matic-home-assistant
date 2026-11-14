"""Hard bounds for replayable cadence history and native admission metadata."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from uuid import UUID

import pytest
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.completion_ledger as ledger
import custom_components.matic_robot.native_cadence as native_cadence
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.completion_ledger import (
    record_completion,
    reset_progress,
    retract_completion,
)
from custom_components.matic_robot.native_cadence import import_native_cadence
from custom_components.matic_robot.room_identity import room_cadence_identity
from tests.client.test_coverage_receipts import history_key
from tests.test_cadence_manager import _floor


def _event_id(number: int) -> str:
    return f"{number:064x}"


def _snapshot(**changes: object) -> dict[str, object]:
    snapshot: dict[str, object] = {
        "scope": "plan",
        "schedule_active": True,
        "mop_every_n": 3,
        "coverage_every_n": 2,
        "periodic_coverage_setting": "heavy_duty",
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    snapshot.update(changes)
    return snapshot


def _managed(schedule: dict[str, object], event_id: str, at: float) -> bool:
    return record_completion(
        schedule,
        event_id,
        at=at,
        source="managed",
        snapshot=_snapshot(),
        mode="vacuum",
    )


def _native(schedule: dict[str, object], event_id: str, at: float) -> bool:
    return record_completion(
        schedule,
        event_id,
        at=at,
        source="native",
        snapshot=_snapshot(
            scope="shared",
            normal_cleaning_mode="vacuum",
            normal_coverage_setting="standard",
        ),
        mode="vacuum",
    )


def test_event_cap_refuses_growth_but_keeps_retained_events_correctable(monkeypatch):
    monkeypatch.setattr(ledger, "MAX_LEDGER_EVENTS", 2)
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert _managed(schedule, _event_id(1), 1)
    assert _native(schedule, _event_id(2), 2)

    # A retained correction and retraction remain available at capacity.
    assert record_completion(
        schedule,
        _event_id(1),
        at=3,
        source="managed",
        snapshot=_snapshot(),
        mode="vacuum_and_mop",
    )
    assert retract_completion(schedule, _event_id(2))

    assert not _managed(schedule, _event_id(3), 4)
    accounting = schedule["accounting"]  # type: ignore[index]
    assert len(accounting["events"]) == 2
    assert schedule["accounting_unverified"] is True  # type: ignore[index]


def test_partial_reset_refuses_at_cap_and_full_reset_recovers_and_prunes_native_index(
    monkeypatch,
):
    monkeypatch.setattr(ledger, "MAX_LEDGER_EVENTS", 2)
    schedule: dict[str, object] = {"progress": {"mop": 0, "coverage": 0}}
    assert _native(schedule, _event_id(1), 1)
    assert _managed(schedule, _event_id(2), 2)
    schedule["native_events"] = {_event_id(1): {"since": 0}}
    prior_progress = deepcopy(schedule["progress"])

    assert not reset_progress(schedule, ["mop"], at=3)
    assert len(schedule["accounting"]["events"]) == 2  # type: ignore[index]
    assert schedule["progress"] == prior_progress
    assert schedule["accounting_unverified"] is True

    assert reset_progress(schedule, ["mop", "coverage"], at=3)
    assert schedule["accounting"]["events"] == []  # type: ignore[index]
    assert schedule["native_events"] == {}
    assert "accounting_unverified" not in schedule
    assert _managed(schedule, _event_id(3), 4)


def test_oversized_stored_ledger_is_not_scanned_or_mutated(monkeypatch):
    monkeypatch.setattr(ledger, "MAX_LEDGER_EVENTS", 1)
    first = {
        "id": _event_id(1),
        "at": 1,
        "source": "managed",
        "snapshot": _snapshot(),
        "mode": "vacuum",
        "coverage": None,
        "order": 0,
    }
    second = {**first, "id": _event_id(2), "order": 1}
    original_events = [deepcopy(first), deepcopy(second)]
    schedule: dict[str, object] = {
        "accounting": {
            "version": 1,
            "baseline": {"mop": 0, "coverage": 0},
            "events": deepcopy(original_events),
        }
    }
    assert not _managed(schedule, _event_id(3), 3)
    assert schedule["accounting"]["events"] == original_events  # type: ignore[index]
    assert schedule["accounting_unverified"] is True
    assert reset_progress(schedule, ["mop", "coverage"], at=4)
    assert schedule["accounting"]["events"] == []  # type: ignore[index]
    assert schedule["progress"] == {"mop": 0, "coverage": 0}
    assert "accounting_unverified" not in schedule


def _native_record(floor, now, key: UUID | None = None):
    key = key or UUID(int=17)
    session = CleaningSession(
        started_at=(now - timedelta(minutes=3)).isoformat(),
        ended_at=(now - timedelta(minutes=2)).isoformat(),
        duration_seconds=60,
        rooms=("Kitchen",),
        room_durations=(),
        completed=True,
        mission_id=floor.mission_id,
        partition_id=floor.partition_protocol_id,
        initiator="app",
        stop_reason="finished",
        completion_kind="completed",
        mode_results=(
            CleaningModeResult("Kitchen", "vacuum", "completed", 60, "room-proto"),
        ),
    )
    return CleaningSessionRecord(history_key(key), session)


def _native_scenario():
    now = dt_util.utcnow()
    floor = _floor()
    schedule = {
        "identity": room_cadence_identity(floor, "room-a"),
        "policy": {"mop_every_n": 3, "coverage_every_n": 3},
        "progress": {"mop": 0, "coverage": 0},
    }
    robot = {
        "native_cleanings": {
            "enabled": True,
            "since": (now - timedelta(hours=1)).isoformat(),
        },
        "shared_room_cadence": {"room-a": schedule},
        "managed_native_sessions": {},
    }
    return now, floor, schedule, robot


def test_oversized_native_import_is_refused_as_a_whole_and_full_reset_clears_marker(
    monkeypatch,
):
    monkeypatch.setattr(native_cadence, "MAX_NATIVE_IMPORT_RECORDS", 1)
    now, floor, schedule, robot = _native_scenario()
    records = [_native_record(floor, now), _native_record(floor, now, UUID(int=18))]
    assert import_native_cadence(robot, floor, records)
    assert schedule["accounting_unverified"] is True
    assert "accounting" not in schedule
    assert reset_progress(schedule, ["mop", "coverage"], at=now.timestamp())
    assert "accounting_unverified" not in schedule


def test_native_index_cap_refuses_new_session_but_reset_prunes_stale_index(monkeypatch):
    monkeypatch.setattr(ledger, "MAX_LEDGER_EVENTS", 1)
    monkeypatch.setattr(native_cadence, "MAX_NATIVE_IMPORT_RECORDS", 2)
    now, floor, schedule, robot = _native_scenario()
    first = _native_record(floor, now)
    assert import_native_cadence(robot, floor, [first])
    second = _native_record(floor, now, UUID(int=18))

    # An unrelated history row must not quarantine an otherwise full index.
    irrelevant = replace(
        second,
        session=replace(second.session, mission_id=floor.mission_id + 1),
    )
    assert not import_native_cadence(robot, floor, [irrelevant])
    assert "accounting_unverified" not in schedule

    assert import_native_cadence(robot, floor, [second])
    assert len(schedule["native_events"]) == 1
    assert schedule["accounting_unverified"] is True

    assert reset_progress(schedule, ["mop", "coverage"], at=now.timestamp())
    assert schedule["native_events"] == {}
    assert "accounting_unverified" not in schedule


def test_full_reset_cannot_readmit_old_session_with_revised_end_time():
    now, floor, schedule, robot = _native_scenario()
    original = _native_record(floor, now)
    assert import_native_cadence(robot, floor, [original])
    assert schedule["progress"] == {"mop": 1, "coverage": 1}
    reset_at = now - timedelta(minutes=1)
    assert reset_progress(schedule, ["mop", "coverage"], at=reset_at.timestamp())

    corrected = replace(
        original,
        session=replace(original.session, ended_at=now.isoformat()),
    )
    assert not import_native_cadence(robot, floor, [corrected])
    assert schedule["progress"] == {"mop": 0, "coverage": 0}
    assert schedule["native_events"] == {}

    fresh = replace(
        _native_record(floor, now, UUID(int=18)),
        session=replace(
            original.session,
            started_at=(reset_at + timedelta(seconds=1)).isoformat(),
            ended_at=now.isoformat(),
        ),
    )
    assert import_native_cadence(robot, floor, [fresh])
    assert schedule["progress"] == {"mop": 1, "coverage": 1}


def test_full_native_index_refuses_growth_and_keeps_corrections(monkeypatch):
    monkeypatch.setattr(native_cadence, "MAX_LEDGER_EVENTS", 1)
    now, floor, schedule, robot = _native_scenario()
    original = _native_record(floor, now)
    assert import_native_cadence(robot, floor, [original])
    assert import_native_cadence(
        robot, floor, [_native_record(floor, now, UUID(int=18))]
    )
    assert schedule["accounting_unverified"] is True
    assert len(schedule["native_events"]) == 1
    assert not import_native_cadence(
        robot, floor, [_native_record(floor, now, UUID(int=18))]
    )

    corrected = replace(
        original, session=replace(original.session, stop_reason="cancelled")
    )
    assert import_native_cadence(robot, floor, [corrected])
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


def test_oversized_native_index_is_quarantined_until_full_reset(monkeypatch):
    monkeypatch.setattr(native_cadence, "MAX_LEDGER_EVENTS", 1)
    now, floor, schedule, robot = _native_scenario()
    schedule["native_events"] = {_event_id(1): {}, _event_id(2): {}}
    record = _native_record(floor, now)
    assert import_native_cadence(robot, floor, [record])
    assert schedule["accounting_unverified"] is True
    assert len(schedule["native_events"]) == 2
    assert not import_native_cadence(robot, floor, [record])
    assert "accounting" not in schedule
    assert reset_progress(schedule, ["mop", "coverage"], at=now.timestamp())
    assert schedule["native_events"] == {}
    assert "accounting_unverified" not in schedule


@pytest.mark.parametrize("cutoff", [10**1000, float("inf")])
def test_malformed_reset_cutoff_cannot_crash_native_import(cutoff):
    now, floor, schedule, robot = _native_scenario()
    assert import_native_cadence(robot, floor, [])
    schedule["accounting"] = {
        "version": 1,
        "baseline": {"mop": 0, "coverage": 0},
        "events": [],
        "cutoff": cutoff,
    }
    assert not import_native_cadence(robot, floor, [_native_record(floor, now)])
    assert schedule["progress"] == {"mop": 0, "coverage": 0}
