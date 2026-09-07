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


def _session_payload(statuses: bytes, global_status: bytes = b"") -> bytes:
    now = int(dt_util.utcnow().timestamp())
    room = _bfield(3, b"Study") + _bfield(4, _vfield(1, 30)) + statuses
    summary = (
        _bfield(3, _bfield(1, _vfield(1, now - 60)))
        + _bfield(4, _bfield(1, _vfield(1, now - 5)))
        + _bfield(6, _bfield(1, _bfield(2, room)))
        + global_status
    )
    return _bfield(5, summary)


@pytest.mark.parametrize("vacuum_status,other_status", [(2, 1), (1, 2)])
@pytest.mark.parametrize("mode", ["vacuum", "mop", "vacuum_and_mop"])
async def test_native_mode_proof_matches_only_the_dispatched_mode(
    vacuum_status, other_status, mode
):
    session = _decode_cleaning_session(
        _session_payload(_vfield(5, vacuum_status) + _vfield(6, other_status))
    )
    assert session is not None
    assert session.completed is None
    assert session.completed_rooms == ()
    assert session.vacuum_completed_rooms == (("Study",) if vacuum_status == 2 else ())
    record = CleaningSessionRecord(b"synthetic-new", session)
    reader = AsyncMock(return_value=(record,))
    room = CleaningRoom("study", "Study", mode, "standard")
    dispatched = dt_util.utcnow() - timedelta(seconds=90)
    expected = vacuum_status == 2 and mode == "vacuum"
    assert (
        await _async_verify_room_completion(
            reader, frozenset(), room, dispatched, attempts=1
        )
        is expected
    )
    leg = await _async_verify_leg_completion(
        reader, frozenset(), [room], dispatched, attempts=1
    )
    assert leg == ({"study": (session.ended_at, 30)} if expected else {})
    native = _native_completion_match((record,), frozenset(), room, dispatched)
    assert native == ((record, 30) if expected else None)
    # The same completed history key must never credit a later dispatch.
    assert (
        _native_completion_match((record,), frozenset({record.key}), room, dispatched)
        is None
    )


@pytest.mark.parametrize(
    "statuses,global_status",
    [
        (_vfield(6, 2), b""),
        (_vfield(5, 3) + _vfield(6, 2), b""),
        (_vfield(5, 2) + _vfield(6, 3), b""),
        (_vfield(5, 2) + _bfield(6, b"malformed"), b""),
        (_bfield(5, b"malformed") + _vfield(6, 2), b""),
        (_vfield(5, 2) + _vfield(5, 2) + _vfield(6, 1), b""),
        (_vfield(5, 2) + _vfield(6, 1), _vfield(5, 2)),
        (_vfield(5, 2) + _vfield(6, 1), _bfield(5, b"malformed")),
    ],
)
def test_vacuum_proof_rejects_unknown_ambiguous_and_failed_results(
    statuses, global_status
):
    session = _decode_cleaning_session(_session_payload(statuses, global_status))
    assert session is not None
    assert session.vacuum_completed_rooms == ()


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
