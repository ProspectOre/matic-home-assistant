"""Synthetic command-specific native completion evidence."""

from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.api import _decode_cleaning_session
from custom_components.matic_robot.client.models import CleaningSessionRecord
from custom_components.matic_robot.plans import CleaningRoom
from custom_components.matic_robot.services import (
    _async_verify_leg_completion,
    _async_verify_room_completion,
    _native_completion_match,
)
from tests.wire_builders import _bfield, _vfield


def _session_payload(
    statuses: bytes | None,
    global_status: bytes = b"",
    mop_statuses: bytes | None = None,
) -> bytes:
    now = int(dt_util.utcnow().timestamp())
    summary = (
        _bfield(3, _bfield(1, _vfield(1, now - 60)))
        + _bfield(4, _bfield(1, _vfield(1, now - 5)))
        + global_status
    )
    for group, status in ((6, statuses), (7, mop_statuses)):
        if status is not None:
            room = _bfield(3, b"Study") + _bfield(4, _vfield(1, 30)) + status
            summary += _bfield(group, _bfield(1, _bfield(2, room)))
    return _bfield(5, summary)


@pytest.mark.parametrize("vacuum_status", [None, 0, 1, 2, 99])
@pytest.mark.parametrize("mop_status", [None, 0, 1, 2, 99])
@pytest.mark.parametrize("mode", ["vacuum", "mop", "vacuum_and_mop"])
async def test_native_mode_proof_matches_only_the_dispatched_mode(
    vacuum_status, mop_status, mode
):
    def status(value):
        return None if value is None else _vfield(5, value) + _vfield(6, 1)

    session = _decode_cleaning_session(
        _session_payload(status(vacuum_status), mop_statuses=status(mop_status))
    )
    assert session is not None
    assert session.vacuum_completed_rooms == (("Study",) if vacuum_status == 2 else ())
    assert session.mop_completed_rooms == (("Study",) if mop_status == 2 else ())
    record = CleaningSessionRecord(b"synthetic-new", session)
    reader = AsyncMock(return_value=(record,))
    room = CleaningRoom("study", "Study", mode, "standard")
    dispatched = dt_util.utcnow() - timedelta(seconds=90)
    expected = {
        "vacuum": vacuum_status == 2,
        "mop": mop_status == 2,
        "vacuum_and_mop": vacuum_status == mop_status == 2,
    }[mode]
    duration = 60 if mode == "vacuum_and_mop" else 30
    assert (
        await _async_verify_room_completion(
            reader, frozenset(), room, dispatched, attempts=1
        )
        is expected
    )
    leg = await _async_verify_leg_completion(
        reader, frozenset(), [room], dispatched, attempts=1
    )
    assert leg == (
        {"study": (session.ended_at, duration)}
        if expected
        else None
        if vacuum_status is mop_status is None
        else {}
    )
    native = _native_completion_match((record,), frozenset(), room, dispatched)
    assert native == ((record, duration) if expected else None)
    assert (
        _native_completion_match((record,), frozenset({record.key}), room, dispatched)
        is None
    )


@pytest.mark.parametrize(
    "statuses,global_status",
    [
        (_vfield(6, 2), b""),
        (_vfield(5, 3), b""),
        (_bfield(5, b"malformed"), b""),
        (_vfield(5, 2) + _vfield(5, 2), b""),
        (_vfield(5, 2), _vfield(5, 2)),
        (_vfield(5, 2), _bfield(5, b"malformed")),
    ],
)
@pytest.mark.parametrize("group", [6, 7])
def test_mode_proof_rejects_unknown_ambiguous_and_failed_results(
    statuses, global_status, group
):
    session = _decode_cleaning_session(
        _session_payload(
            statuses if group == 6 else None,
            global_status,
            mop_statuses=statuses if group == 7 else None,
        )
    )
    assert session is not None
    assert session.vacuum_completed_rooms == ()
    assert session.mop_completed_rooms == ()
    assert session.combined_completed_rooms == ()


@pytest.mark.parametrize(
    "setting",
    [b"", _vfield(6, 1), _vfield(6, 2), _vfield(6, 99), _bfield(6, b"unknown")],
)
def test_coverage_setting_is_not_cleaning_status(setting):
    session = _decode_cleaning_session(_session_payload(_vfield(5, 2) + setting))
    assert session.completed is True
    assert session.mode_results[0].status == "completed"
    assert session.vacuum_completed_rooms == ("Study",)
    assert session.combined_completed_rooms == ()


@pytest.mark.parametrize("mop_status", [None, 0, 1, 2])
def test_unscoped_history_does_not_infer_requested_modes_from_native_summaries(
    mop_status,
):
    from custom_components.matic_robot.llm import _bounded_native_room_evidence

    session = _decode_cleaning_session(
        _session_payload(
            _vfield(5, 2),
            mop_statuses=None if mop_status is None else _vfield(5, mop_status),
        )
    )
    # A native single-mode room summary can be true while combined proof is
    # absent. Neither the summary nor missing mop data identifies user intent.
    assert session.completed_rooms == (("Study",) if mop_status in (None, 2) else ())
    generic, _, _, _ = _bounded_native_room_evidence(session, 20, 5000)
    assert generic[0]["completed"] is None
    vacuum, _, _, _ = _bounded_native_room_evidence(
        session, 20, 5000, cleaning_mode="vacuum"
    )
    combined, _, _, _ = _bounded_native_room_evidence(
        session, 20, 5000, cleaning_mode="vacuum_and_mop"
    )
    assert vacuum[0]["completed"] is True
    assert vacuum[0]["duration_seconds"] == 30
    assert combined[0]["completed"] is (mop_status == 2)


@pytest.mark.parametrize(
    "mode", ["vacuum", "mop", "vacuum_and_mop", None, "unknown", 5]
)
async def test_restart_reconciliation_retains_only_known_vacuum_dispatch(hass, mode):
    import json
    from types import SimpleNamespace

    from custom_components.matic_robot.client.models import FloorPlan, Room
    from custom_components.matic_robot.plans import CleaningPlanManager
    from custom_components.matic_robot.services import (
        _build_native_reconciliation,
        _native_reconciliation_data,
    )

    room = CleaningRoom("study", "Study", "vacuum", "standard")
    dispatched = dt_util.utcnow() - timedelta(seconds=90)
    marker = _native_reconciliation_data(
        _build_native_reconciliation("synthetic-plan", room, dispatched, True)
    )
    assert marker["cleaning_mode"] == "vacuum"
    if mode is None:
        marker.pop("cleaning_mode")
    else:
        marker["cleaning_mode"] = mode
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_mark_started("synthetic-serial", "synthetic-plan", room)
    await manager.async_mark_failed(
        "synthetic-serial",
        "synthetic-plan",
        room,
        "synthetic interruption",
        native_reconciliation=marker,
    )
    stored = json.loads(json.dumps(manager._data))
    restarted = CleaningPlanManager(hass)
    restarted._store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    await restarted.async_load()
    session = _decode_cleaning_session(_session_payload(_vfield(5, 2) + _vfield(6, 1)))
    record = CleaningSessionRecord(b"synthetic-new", session)
    floor = FloorPlan(
        1,
        "synthetic",
        b"synthetic",
        (
            Room(
                "study",
                "Study",
                "synthetic-study",
                b"synthetic-study",
                ((0, 0), (1, 0), (1, 1)),
            ),
        ),
    )
    await restarted.async_import_native_history("synthetic-serial", floor, [record])
    state = restarted.snapshot("synthetic-serial")
    result = state["plan_history"]["synthetic-plan"]["rooms"]["study"]
    assert result["last_result"] == ("completed" if mode == "vacuum" else "failed")
    assert state["native_reconciliation_pending"] is (mode != "vacuum")
    await restarted.async_import_native_history("synthetic-serial", floor, [record])
    assert restarted.snapshot("synthetic-serial")["plan_history"]["synthetic-plan"][
        "rooms"
    ]["study"].get("completed_runs", 0) == (1 if mode == "vacuum" else 0)


async def test_seven_room_partial_session_credits_only_completed_requested_modes(hass):
    from custom_components.matic_robot.client.wire import first_bytes
    from custom_components.matic_robot.llm import _bounded_native_room_evidence

    # Synthetic names, intervals and durations; omitted status is native zero.
    rows = [
        ("Study", 2, 1, 120, 20),
        ("Gallery", 2, 2, 100, 70),
        ("Store", 0, None, 0, None),
        ("Atrium", 2, 2, 160, 80),
        ("Den", 2, 2, 110, 50),
        ("Pantry", 2, 0, 60, 0),
        ("Utility", 0, 0, 0, 0),
    ]
    summary = first_bytes(_session_payload(None), 5)
    for group, status_index, duration_index in ((6, 1, 3), (7, 2, 4)):
        for row in rows:
            if row[status_index] is None:
                continue
            status = _vfield(5, row[status_index]) if row[status_index] else b""
            duration = _vfield(1, row[duration_index]) if row[duration_index] else b""
            detail = (
                _bfield(3, row[0].encode())
                + _bfield(4, duration)
                + status
                + _vfield(6, 1)
            )
            summary += _bfield(group, _bfield(1, _bfield(2, detail)))
    session = _decode_cleaning_session(_bfield(5, summary))
    assert session.completed is False
    assert session.completed_rooms == ("Gallery", "Atrium", "Den")
    assert session.vacuum_completed_rooms == (
        "Study",
        "Gallery",
        "Atrium",
        "Den",
        "Pantry",
    )
    assert session.mop_completed_rooms == ("Gallery", "Atrium", "Den")
    reader = AsyncMock(return_value=(CleaningSessionRecord(b"synthetic-leg", session),))
    rooms = [
        CleaningRoom(row[0].lower(), row[0], "vacuum_and_mop", "standard")
        for row in rows
    ]
    evidence = await _async_verify_leg_completion(
        reader, frozenset(), rooms, dt_util.utcnow() - timedelta(seconds=90), attempts=1
    )
    assert evidence == {
        "gallery": (session.ended_at, 170),
        "atrium": (session.ended_at, 240),
        "den": (session.ended_at, 160),
    }
    readout, _, _, count = _bounded_native_room_evidence(session, 20, 5000)
    assert count == 7
    reported = {item["room"]: item for item in readout}
    assert reported["Study"]["modes"] == {
        "vacuum": {"status": "completed", "duration_seconds": 120},
        "mop": {"status": "partial", "duration_seconds": 20},
    }
    assert reported["Store"]["visited"] is False
    assert reported["Utility"]["visited"] is False
    assert reported["Pantry"]["visited"] is True
    assert reported["Pantry"]["completed"] is None
    assert reported["Pantry"]["modes"]["mop"]["status"] == "unattempted"

    from types import SimpleNamespace

    from custom_components.matic_robot.client.models import FloorPlan, Room
    from custom_components.matic_robot.plans import CleaningPlanManager

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor = FloorPlan(
        1,
        "synthetic",
        b"synthetic",
        tuple(
            Room(row[0].lower(), row[0], row[0].lower(), b"synthetic-room", ())
            for row in rows
        ),
    )
    records = (CleaningSessionRecord(b"synthetic-leg", session),)
    assert await manager.async_import_native_history("synthetic", floor, records)
    history = manager._robot("synthetic")["rooms"]
    for name in ("study", "gallery", "atrium", "den", "pantry"):
        assert history[name]["last_opportunity"] == session.ended_at
        assert not history[name].get("last_completed")
        assert history[name].get("completed_runs", 0) == 0
    for name in ("store", "utility"):
        assert not history.get(name, {}).get("last_opportunity")
    assert not await manager.async_import_native_history("synthetic", floor, records)


@pytest.mark.parametrize("group", [6, 7])
def test_duplicate_room_results_cannot_credit_or_double_duration(group):
    from custom_components.matic_robot.client.wire import first_bytes

    payload = _session_payload(_vfield(5, 2))
    summary = first_bytes(payload, 5)
    duplicated = first_bytes(summary, 6)
    session = _decode_cleaning_session(
        _bfield(5, summary + _bfield(group, duplicated) + _bfield(group, duplicated))
    )
    assert session.completed is None
    assert session.completed_rooms == ()
    assert session.mode_results[-1].status is None
    assert session.mode_results[-1].duration_seconds is None
    assert session.completed_rooms_for_mode("vacuum" if group == 6 else "mop") == ()


@pytest.mark.parametrize(
    "duration",
    [None, b"", _bfield(1, b"bad"), _vfield(1, 5) + _vfield(1, 6), b"\x0a\xff"],
)
async def test_combined_completion_requires_usable_duration_for_both_modes(duration):
    from custom_components.matic_robot.client.wire import first_bytes

    summary = first_bytes(_session_payload(_vfield(5, 2)), 5)
    mop = _bfield(3, b"Study") + _vfield(5, 2)
    if duration is not None:
        mop += _bfield(4, duration)
    session = _decode_cleaning_session(
        _bfield(5, summary + _bfield(7, _bfield(1, _bfield(2, mop))))
    )
    reader = AsyncMock(
        return_value=(CleaningSessionRecord(b"synthetic-duration", session),)
    )
    room = CleaningRoom("study", "Study", "vacuum_and_mop", "standard")
    assert (
        await _async_verify_leg_completion(
            reader,
            frozenset(),
            [room],
            dt_util.utcnow() - timedelta(seconds=90),
            attempts=1,
        )
        == {}
    )
    assert session.room_durations_for_mode("mop") == ()
    assert session.room_durations_for_mode("vacuum") == (("Study", 30),)


def test_legacy_session_preserves_explicit_vacuum_evidence():
    from custom_components.matic_robot.client.models import CleaningSession

    session = CleaningSession(
        None,
        None,
        30,
        ("Study",),
        (("Study", 30),),
        None,
        vacuum_completed_rooms=("Study",),
    )
    assert session.completed_rooms_for_mode("vacuum") == ("Study",)
    assert session.completed_rooms_for_mode("vacuum_and_mop") == ()
    assert session.room_durations_for_mode("vacuum") == (("Study", 30),)
