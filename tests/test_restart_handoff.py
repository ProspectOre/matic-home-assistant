"""Restart recovery of a leg handoff checks the robot's idle session revision."""

from dataclasses import asdict
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.restart import async_recover_managed_run


@pytest.mark.parametrize(
    ("saved", "current", "resumes"),
    [
        pytest.param(None, "a" * 64, False, id="unobserved"),
        pytest.param("a" * 64, "a" * 64, True, id="matches"),
        pytest.param("a" * 64, "b" * 64, False, id="changed"),
        pytest.param("a" * 64, None, False, id="unreadable"),
        pytest.param("missing", "a" * 64, True, id="saved_before_0_6_kept_it"),
    ],
)
async def test_handoff_resumes_only_while_the_idle_revision_holds(
    hass, recovery_state, saved, current, resumes
):
    manager, entry, checkpoint, room = recovery_state
    next_room = CleaningRoom("office", "Office", "mop", "standard")
    checkpoint.update(
        {
            "phase": "handoff",
            "handoff_history": [],
            "leg_index": 1,
            "single_room_missions": True,
            "rooms": [asdict(room), asdict(next_room)],
            "completed_room_ids": [room.room_id],
        }
    )
    if saved != "missing":
        checkpoint["handoff_revision"] = saved
    client = entry.runtime_data.client
    client.async_get_idle_cleaning_session_revision = AsyncMock(return_value=current)
    manager.repository.robot("serial")["last_run"]["room_count"] = 2
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    client.async_get_cleaning_session_identity.return_value = b""
    entry.robot.show("idle")

    with (
        patch(
            "custom_components.matic_robot.restart._async_wait_for_settled_leg_handoff",
            AsyncMock(return_value=True),
        ) as settled,
        patch(
            "custom_components.matic_robot.restart._async_execute_rooms", AsyncMock()
        ) as runner,
    ):
        await async_recover_managed_run(hass, entry, "serial")

    assert settled.await_count == runner.await_count == int(resumes)
    if not resumes:
        last_run = manager.history.snapshot("serial")["last_run"]
        assert last_run["reason_code"] == "restart_native_mission_changed_or_ended"
    client.async_send_user_command.assert_not_awaited()
