"""Restart recovery follows the dispatch's own session and the idle revision."""

import hashlib
from dataclasses import asdict
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from custom_components.matic_robot.client import native_session_hash
from custom_components.matic_robot.client.exceptions import (
    NativeHistoryIncompleteError,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.restart import async_recover_managed_run
from tests.client.test_coverage_receipts import active_key
from tests.plans.fakes import save_run_checkpoint


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
    await save_run_checkpoint(manager, checkpoint)
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


OTHER = UUID("22222222-2222-4222-8222-222222222222")


@pytest.mark.parametrize(
    "case", ["own_session", "malformed", "other_session", "incomplete"]
)
async def test_a_tracked_dispatch_resumes_only_by_its_own_session(
    hass, recovery_state, case
):
    manager, entry, checkpoint, _room = recovery_state
    identity = active_key()
    own = native_session_hash(identity, active=True)
    checkpoint.update(
        native_identity_hash=hashlib.sha256(identity).hexdigest(),
        history_baseline=[] if case == "incomplete" else None,
        session_hash={
            "malformed": "not-a-session",
            "other_session": hashlib.sha256(str(OTHER).encode()).hexdigest(),
        }.get(case, own),
    )
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    client = entry.runtime_data.client
    client.async_get_cleaning_session_identity.return_value = identity
    if case == "incomplete":
        client.async_get_cleaning_session_records.side_effect = (
            NativeHistoryIncompleteError("entry without a session identity")
        )

    with patch(
        "custom_components.matic_robot.restart._async_execute_rooms", AsyncMock()
    ) as runner:
        await async_recover_managed_run(hass, entry, "serial")

    if case == "own_session":
        dispatch = runner.await_args.kwargs["recovered_dispatch"]
        assert dispatch.history_baseline is None
        assert dispatch.session_hash == own
        return
    runner.assert_not_awaited()
    assert manager.history.snapshot("serial")["last_run"]["reason_code"] == (
        "restart_history_incomplete"
        if case == "incomplete"
        else "restart_checkpoint_unverified"
    )
    client.async_send_user_command.assert_not_awaited()
