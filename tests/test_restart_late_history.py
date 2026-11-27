"""A restarted run keeps watching late history for rooms it left unproven."""

from copy import deepcopy
from dataclasses import asdict
from datetime import timedelta
from unittest.mock import patch

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client import native_session_hash
from custom_components.matic_robot.client.commands import _wrapped_uuid
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.restart import async_recover_managed_run
from tests.plans.fakes import recovery_record
from tests.session_fakes import verifying_write
from tests.wire_builders import _field

# A history record key: the session UUID, as the robot sends it.
SESSION_KEY = _field(2, _wrapped_uuid("7f9d3337-4935-4d30-98f3-f38af88cc147"))
HALL = CleaningRoom("hall", "Hall", "vacuum", "standard")


def _record(rooms: tuple[str, ...], proven: tuple[str, ...]) -> CleaningSessionRecord:
    now = dt_util.utcnow()
    return CleaningSessionRecord(
        SESSION_KEY,
        CleaningSession(
            (now - timedelta(seconds=60)).isoformat(),
            now.isoformat(),
            60,
            rooms,
            tuple((room, 30) for room in rooms),
            True,
            proven,
        ),
    )


async def _recover(hass, recovery_state, *, rooms, started, proven):
    """Recover a leg whose mission ended before the restart; return the manager."""
    manager, entry, _, room = recovery_state
    await manager.ledger.async_mark_verifying(
        "serial",
        "plan",
        room,
        checkpoint=verifying_write(dt_util.utcnow() + timedelta(seconds=300)),
    )
    checkpoint = deepcopy(recovery_record(manager)["recovery_checkpoint"])
    checkpoint["rooms"] = [asdict(item) for item in rooms]
    manager.repository.robot("serial")["last_run"]["room_count"] = len(rooms)
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    for item in rooms:
        if item.room_id in started and item.room_id != room.room_id:
            await manager.ledger.async_mark_started(
                "serial", "plan", item, run_id="run"
            )
    # The mission's session, as the leg saved it when its dispatch was accepted.
    stored = manager.repository.robot("serial")["last_run"]["recovery_checkpoint"]
    stored["session_hash"] = native_session_hash(SESSION_KEY)
    client = entry.runtime_data.client
    client.async_get_cleaning_session_identity.return_value = b""
    client.async_get_cleaning_session_records.return_value = (
        _record(tuple(item.name for item in rooms), proven),
    )
    entry.robot.show("docked")
    with (
        patch(
            "custom_components.matic_robot.managed_observation."
            "SESSION_HISTORY_RETRY_SECONDS",
            0,
        ),
        patch(
            "custom_components.matic_robot.restart.schedule_grouped_native_reconciliation"
        ) as watch,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    await hass.async_block_till_done()
    client.async_send_user_command.assert_not_awaited()
    return manager, watch


async def test_unproven_entered_room_keeps_a_late_history_marker(hass, recovery_state):
    """The robot entered the Hall but its record proves only the Kitchen."""
    kitchen = recovery_state[3]
    manager, watch = await _recover(
        hass,
        recovery_state,
        rooms=(kitchen, HALL),
        started=("kitchen", "hall"),
        proven=("Kitchen",),
    )
    run = manager.history.snapshot("serial")["last_run"]
    assert (run["outcome"], run["completed_room_count"]) == ("unverified", 1)
    marker = manager.ledger.pending_native_reconciliation("serial")
    assert marker is not None
    assert [room["room_id"] for room in marker["rooms"]] == ["hall"]
    assert (marker["run_id"], marker["session_hash"]) == (
        "run",
        native_session_hash(SESSION_KEY),
    )
    watch.assert_called_once()
    assert watch.call_args.args[4]["session_hash"] == marker["session_hash"]
    assert [room["room_id"] for room in watch.call_args.args[4]["rooms"]] == ["hall"]


@pytest.mark.parametrize(
    "case", ["one_room", "not_entered"], ids=["one-room leg", "room never entered"]
)
async def test_no_marker_where_a_live_run_keeps_none(hass, recovery_state, case):
    """An unproven one-room leg, or a room the robot never entered, has no marker."""
    kitchen = recovery_state[3]
    one_room = case == "one_room"
    manager, watch = await _recover(
        hass,
        recovery_state,
        rooms=(kitchen,) if one_room else (kitchen, HALL),
        started=("kitchen",),
        proven=() if one_room else ("Kitchen",),
    )
    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "unverified"
    assert manager.ledger.pending_native_reconciliation("serial") is None
    watch.assert_not_called()
