"""An observed native end survives restart without authorizing new motion."""

import asyncio
from copy import deepcopy
from dataclasses import asdict
from datetime import timedelta
from unittest.mock import patch

import pytest
from homeassistant.core import CoreState
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client import native_session_hash
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.restart import async_recover_managed_run
from tests.plans.fakes import recovery_record
from tests.session_fakes import take_robot_after_room_completed, verifying_write


@pytest.fixture
async def recovery_state(recovery_state):
    manager, entry, checkpoint, room = recovery_state
    await manager.ledger.async_mark_verifying(
        "serial",
        "plan",
        room,
        checkpoint=verifying_write(dt_util.utcnow() + timedelta(seconds=300)),
    )
    checkpoint = recovery_record(manager)["recovery_checkpoint"]
    entry.runtime_data.client.async_get_cleaning_session_identity.return_value = b""
    entry.robot.show("docked")
    return manager, entry, checkpoint, room


def completed_record():
    now = dt_util.utcnow()
    return CleaningSessionRecord(
        b"finished",
        CleaningSession(
            (now - timedelta(seconds=30)).isoformat(),
            now.isoformat(),
            30,
            ("Kitchen",),
            (("Kitchen", 30),),
            True,
            ("Kitchen",),
        ),
    )


async def test_verification_recovers_real_history_without_motion(hass, recovery_state):
    manager, entry, _, _ = recovery_state
    client = entry.runtime_data.client
    client.async_get_cleaning_session_records.side_effect = [(), (completed_record(),)]
    events = []
    hass.bus.async_listen("matic_robot_room_completed", events.append)
    await async_recover_managed_run(hass, entry, "serial")
    await hass.async_block_till_done()
    run = manager.history.snapshot("serial")["last_run"]
    assert run["outcome"] == "completed"
    assert run["completed_room_count"] == 1
    assert events[0].data["provenance"] == "automation"
    assert events[0].data["room"] == "Kitchen"
    assert run["run_id"] == "run"
    client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize(
    "case",
    [
        "expired",
        "bad_deadline",
        "naive",
        "missing",
        "takeover",
        "cancel",
        "floor",
        "timeout",
        "no_proof",
    ],
)
async def test_verification_fails_closed(hass, recovery_state, case):
    manager, entry, checkpoint, _ = recovery_state
    client = entry.runtime_data.client
    if case == "expired":
        checkpoint["verification_deadline"] = (
            dt_util.utcnow() - timedelta(seconds=1)
        ).isoformat()
    elif case == "bad_deadline":
        checkpoint["verification_deadline"] = "invalid"
    elif case == "naive":
        checkpoint["verification_deadline"] = "2026-09-16T12:00:00"
    elif case == "missing":
        checkpoint.pop("verification_deadline")
    elif case == "takeover":
        client.async_get_cleaning_session_identity.side_effect = [
            b"",
            b"",
            b"replacement",
        ]
    elif case in {"cancel", "floor"}:
        reads = 0

        async def records():
            nonlocal reads
            reads += 1
            if reads == 2:
                if case == "cancel":
                    manager.control.request_stop("serial")
                else:
                    entry.runtime_data.slam_map.floor_plan_is_current.return_value = (
                        False
                    )
            return (completed_record(),)

        client.async_get_cleaning_session_records.side_effect = records
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    with (
        patch(
            "custom_components.matic_robot.restart.async_verify_leg_completion",
            side_effect=TimeoutError,
        )
        if case == "timeout"
        else patch(
            "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
            0,
        )
    ):
        await async_recover_managed_run(hass, entry, "serial")
    assert manager.history.snapshot("serial")["last_run"]["outcome"] != "completed"
    client.async_send_user_command.assert_not_awaited()


async def test_repeated_shutdown_preserves_verification_budget(hass, recovery_state):
    manager, entry, checkpoint, _ = recovery_state

    async def stop(*args, **kwargs):
        hass.set_state(CoreState.stopping)
        raise asyncio.CancelledError

    with patch(
        "custom_components.matic_robot.restart.async_verify_leg_completion",
        side_effect=stop,
    ):
        with pytest.raises(asyncio.CancelledError):
            await async_recover_managed_run(hass, entry, "serial")
    saved = deepcopy(recovery_record(manager)["recovery_checkpoint"])
    assert saved["phase"] == "verifying"
    assert saved["verification_deadline"] == checkpoint["verification_deadline"]
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


async def test_verified_leg_never_dispatches_remaining_queue(hass, recovery_state):
    manager, entry, checkpoint, _ = recovery_state
    other = CleaningRoom("hall", "Hall", "mop", "standard")
    checkpoint["rooms"].append(asdict(other))
    checkpoint["single_room_missions"] = True
    manager.repository.robot("serial")["last_run"]["room_count"] = 2
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        completed_record(),
    )
    with patch("custom_components.matic_robot.restart.async_execute_rooms") as execute:
        await async_recover_managed_run(hass, entry, "serial")
    execute.assert_not_called()
    run = manager.history.snapshot("serial")["last_run"]
    assert run["outcome"] == "unverified"
    assert run["completed_room_count"] == 1
    assert run["reason_code"] == "restart_remaining_queue_unverified"
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("proof", ["partial", "complete"])
async def test_multiroom_verification_deduplicates_prior_credit(
    hass, recovery_state, proof
):
    manager, entry, checkpoint, room = recovery_state
    other = CleaningRoom("hall", "Hall", "vacuum", "standard")
    checkpoint["rooms"].append(asdict(other))
    manager.repository.robot("serial")["last_run"]["room_count"] = 2
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    await manager.ledger.async_mark_completed(
        "serial", "plan", room, duration_seconds=30
    )
    events = []
    hass.bus.async_listen("matic_robot_room_completed", events.append)
    now = dt_util.utcnow()
    record = CleaningSessionRecord(
        b"finished",
        CleaningSession(
            (now - timedelta(seconds=30)).isoformat(),
            now.isoformat(),
            30,
            ("Kitchen", "Hall"),
            (("Kitchen", 30), ("Hall", 30)),
            True,
            ("Kitchen", "Hall") if proof == "complete" else ("Kitchen",),
        ),
    )
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        record,
    )
    with patch(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    ):
        await async_recover_managed_run(hass, entry, "serial")
    await hass.async_block_till_done()
    run = manager.history.snapshot("serial")["last_run"]
    assert run["completed_room_count"] == (2 if proof == "complete" else 1)
    assert run["outcome"] == ("completed" if proof == "complete" else "unverified")
    assert [event.data["room_id"] for event in events] == (
        ["hall"] if proof == "complete" else []
    )
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


def _hall_unattempted_record(hall: str = "unattempted") -> CleaningSessionRecord:
    now = dt_util.utcnow()
    return CleaningSessionRecord(
        b"finished",
        CleaningSession(
            (now - timedelta(seconds=30)).isoformat(),
            now.isoformat(),
            30,
            ("Kitchen", "Hall"),
            (("Kitchen", 30), ("Hall", 0)),
            False,
            ("Kitchen",),
            ("Kitchen",),
            mode_results=(
                CleaningModeResult("Kitchen", "vacuum", "completed", 30),
                CleaningModeResult("Hall", "vacuum", hall, 0),
            ),
            stop_reason="finished",
        ),
    )


@pytest.mark.parametrize(
    ("owner_skipped", "hall", "reason_code"),
    [
        (False, "unattempted", "room_unreachable"),
        (False, "partial", "room_partly_cleaned"),
        (True, "unattempted", "owner_skipped"),
    ],
)
async def test_recovery_settles_a_room_without_credit_as_the_leg_runner_does(
    hass, recovery_state, owner_skipped, hall, reason_code
):
    """An unreached, partly cleaned or skipped room settles without credit."""
    manager, entry, checkpoint, _ = recovery_state
    checkpoint["rooms"].append(
        asdict(CleaningRoom("hall", "Hall", "vacuum", "standard"))
    )
    last_run = manager.repository.robot("serial")["last_run"]
    last_run["room_count"] = 2
    if owner_skipped:
        last_run["skipped_room_ids"] = ["hall"]
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        _hall_unattempted_record(hall),
    )
    skipped = []
    hass.bus.async_listen("matic_robot_room_skipped", skipped.append)
    await async_recover_managed_run(hass, entry, "serial")
    await hass.async_block_till_done()
    run = manager.history.snapshot("serial")["last_run"]
    assert (run["outcome"], run["reason_code"]) == ("completed", "all_rooms_settled")
    assert run["completed_room_count"] == 1
    assert [
        (event.data["room_id"], event.data["reason_code"]) for event in skipped
    ] == [("hall", reason_code)]
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("during_write", [False, True])
@pytest.mark.parametrize("owner_skipped", [False, True])
async def test_recovery_does_not_settle_a_room_after_losing_the_robot(
    hass, recovery_state, owner_skipped, during_write
):
    """A takeover after a room's credit stops recovery settling the next one."""
    manager, entry, checkpoint, _ = recovery_state
    checkpoint["rooms"].append(
        asdict(CleaningRoom("hall", "Hall", "vacuum", "standard"))
    )
    last_run = manager.repository.robot("serial")["last_run"]
    last_run["room_count"] = 2
    if owner_skipped:
        last_run["skipped_room_ids"] = ["hall"]
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        _hall_unattempted_record(),
    )
    skipped = []
    hass.bus.async_listen("matic_robot_room_skipped", skipped.append)
    take_robot_after_room_completed(hass, manager, during_write=during_write)
    await async_recover_managed_run(hass, entry, "serial")
    await hass.async_block_till_done()
    assert skipped == []
    run = manager.history.snapshot("serial")["last_run"]
    assert (run["outcome"], run["reason_code"]) == (
        "unverified",
        "restart_recovery_superseded",
    )
    assert run["completed_room_count"] == 1


@pytest.mark.parametrize("stop", [None, "after_room"])
async def test_partial_proof_survives_real_remaining_timeout(
    hass, recovery_state, stop
):
    manager, entry, checkpoint, _ = recovery_state
    checkpoint["rooms"].append(
        asdict(CleaningRoom("hall", "Hall", "vacuum", "standard"))
    )
    checkpoint["verification_deadline"] = (
        dt_util.utcnow() + timedelta(seconds=0.05)
    ).isoformat()
    checkpoint["stop_intent"] = stop
    manager.repository.robot("serial")["last_run"]["room_count"] = 2
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        completed_record(),
    )
    await async_recover_managed_run(hass, entry, "serial")
    run = manager.history.snapshot("serial")["last_run"]
    assert run["completed_room_count"] == 1
    assert run["outcome"] == ("cancelled" if stop else "unverified")
    assert run["reason_code"] == (
        "managed_stop" if stop else "restart_remaining_queue_unverified"
    )
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


async def test_expired_verification_retains_after_room_stop(hass, recovery_state):
    manager, entry, checkpoint, _ = recovery_state
    checkpoint["verification_deadline"] = (
        dt_util.utcnow() - timedelta(seconds=1)
    ).isoformat()
    checkpoint["stop_intent"] = "after_room"
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    await async_recover_managed_run(hass, entry, "serial")
    run = manager.history.snapshot("serial")["last_run"]
    assert run["outcome"] == "cancelled"
    assert run["reason_code"] == "managed_stop"
    assert run["completed_room_count"] == 0


@pytest.mark.parametrize("already_credited", [False, True])
async def test_final_room_completion_wins_over_graceful_stop(
    hass, recovery_state, already_credited
):
    manager, entry, checkpoint, room = recovery_state
    checkpoint["stop_intent"] = "after_room"
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    if already_credited:
        await manager.ledger.async_mark_completed("serial", "plan", room)
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        completed_record(),
    )
    events = []
    hass.bus.async_listen("matic_robot_plan_finished", events.append)
    await async_recover_managed_run(hass, entry, "serial")
    await hass.async_block_till_done()
    run = manager.history.snapshot("serial")["last_run"]
    assert run["outcome"] == "completed"
    assert run["reason_code"] == "all_rooms_verified"
    assert events[0].data["outcome"] == "completed"
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("stage", ["refresh", "history", "verifying"])
@pytest.mark.parametrize("action", ["replace", "stop", "unload", "shutdown"])
async def test_recovery_cancellation_attribution(hass, recovery_state, stage, action):
    manager, entry, _, _ = recovery_state
    client = entry.runtime_data.client

    async def interrupt(*args, **kwargs):
        if action == "replace":
            manager.control.replace_managed_motion("serial")
        elif action == "stop":
            manager.control.request_stop("serial")
        else:
            if action == "shutdown":
                hass.set_state(CoreState.stopping)
            # Unload runs in its own task and waits for the run to end.
            hass.async_create_task(
                manager.control.async_cancel_and_wait(
                    "serial", preserve_run=action == "shutdown"
                )
            )
        return ()

    if stage == "refresh":
        entry.runtime_data.session.heartbeat.async_request_refresh.side_effect = (
            interrupt
        )
    elif stage == "history":
        client.async_get_cleaning_session_records.side_effect = interrupt
    else:
        reads = 0

        async def history(**_: object):
            nonlocal reads
            reads += 1
            if reads > 1:
                return await interrupt()
            return ()

        client.async_get_cleaning_session_records.side_effect = history
    events = []
    hass.bus.async_listen("matic_robot_plan_finished", events.append)
    # Recovery runs as its own task, which unload awaits.
    await hass.async_create_task(async_recover_managed_run(hass, entry, "serial"))
    await hass.async_block_till_done()
    if action == "shutdown":
        assert recovery_record(manager) is not None
        assert not events
    else:
        expected = {
            "replace": ("cancelled", "managed_replaced", "replacement"),
            "stop": ("cancelled", "managed_stop", "managed_cancellation"),
            "unload": ("unverified", "config_entry_unload", "home_assistant"),
        }[action]
        run = manager.history.snapshot("serial")["last_run"]
        assert (run["outcome"], run["reason_code"], run["cause"]) == expected
        assert (
            events[0].data["outcome"],
            events[0].data["reason_code"],
            events[0].data["cause"],
        ) == expected
    client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("action", ["unload", "shutdown"])
async def test_unload_ends_a_held_recovery_history_read(hass, recovery_state, action):
    manager, entry, _, _ = recovery_state
    client = entry.runtime_data.client
    held = asyncio.Event()

    async def hold(**_: object):
        held.set()
        await asyncio.Event().wait()

    client.async_get_cleaning_session_records.side_effect = hold
    recovery = hass.async_create_task(async_recover_managed_run(hass, entry, "serial"))
    await held.wait()
    if action == "shutdown":
        hass.set_state(CoreState.stopping)
    async with asyncio.timeout(1):
        await manager.control.async_cancel_and_wait(
            "serial", preserve_run=action == "shutdown"
        )
    await recovery
    assert client.async_get_cleaning_session_records.await_count == 1
    if action == "shutdown":
        assert recovery_record(manager) is not None
    else:
        run = manager.history.snapshot("serial")["last_run"]
        assert (run["outcome"], run["reason_code"]) == (
            "unverified",
            "config_entry_unload",
        )
    client.async_send_user_command.assert_not_awaited()


async def test_recovered_credit_keeps_the_robot_session(hass, recovery_state):
    """A credit after restart names the session it came from, as a leg's does."""
    manager, entry, _, _ = recovery_state
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        completed_record(),
    )
    await async_recover_managed_run(hass, entry, "serial")
    receipts = manager.repository.robot("serial")["daily_room_completions"]["kitchen"][
        "receipts"
    ]
    assert [receipt.get("session_hash") for receipt in receipts] == [
        native_session_hash(b"finished")
    ]


@pytest.mark.parametrize("stop", [None, "after_room"])
async def test_recovery_closes_an_unproven_room_as_the_leg_runner_does(
    hass, recovery_state, stop
):
    """A room the history leaves due ends unverified; on a Smart Stop the run
    cancels each room the robot never entered."""
    manager, entry, checkpoint, _ = recovery_state
    checkpoint["rooms"].append(
        asdict(CleaningRoom("hall", "Hall", "vacuum", "standard"))
    )
    checkpoint["verification_deadline"] = (
        dt_util.utcnow() + timedelta(seconds=0.05)
    ).isoformat()
    checkpoint["stop_intent"] = stop
    manager.repository.robot("serial")["last_run"]["room_count"] = 2
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        completed_record(),
    )
    events = []
    for result in ("ended_unverified", "cancelled"):
        hass.bus.async_listen(f"matic_robot_room_{result}", events.append)
    await async_recover_managed_run(hass, entry, "serial")
    await hass.async_block_till_done()
    assert [
        (event.event_type, event.data["room_id"], event.data["reason_code"])
        for event in events
    ] == [
        (
            "matic_robot_room_cancelled",
            "hall",
            "managed_cancelled",
        )
        if stop
        else ("matic_robot_room_ended_unverified", "hall", "unverified_completion")
    ]
    rooms = manager.repository.robot("serial")["rotations"]["plan"]["rooms"]
    assert rooms["hall"]["last_result"] == ("cancelled" if stop else "ended_unverified")
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("during_write", [False, True])
@pytest.mark.parametrize("stop", [None, "after_room"])
async def test_recovery_leaves_an_unproven_room_after_losing_the_robot(
    hass, recovery_state, stop, during_write
):
    """A takeover after a credit stops recovery cancelling or closing the rest."""
    manager, entry, checkpoint, _ = recovery_state
    checkpoint["rooms"].append(
        asdict(CleaningRoom("hall", "Hall", "vacuum", "standard"))
    )
    checkpoint["verification_deadline"] = (
        dt_util.utcnow() + timedelta(seconds=0.05)
    ).isoformat()
    checkpoint["stop_intent"] = stop
    manager.repository.robot("serial")["last_run"]["room_count"] = 2
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        completed_record(),
    )
    events = []
    for result in ("ended_unverified", "cancelled"):
        hass.bus.async_listen(f"matic_robot_room_{result}", events.append)
    take_robot_after_room_completed(hass, manager, during_write=during_write)
    await async_recover_managed_run(hass, entry, "serial")
    await hass.async_block_till_done()
    assert events == []
    run = manager.history.snapshot("serial")["last_run"]
    assert (run["outcome"], run["reason_code"]) == (
        ("cancelled", "managed_stop")
        if stop
        else ("unverified", "restart_recovery_superseded")
    )
    assert run["completed_room_count"] == 1
    rotation = manager.repository.robot("serial")["rotations"].get("plan", {})
    assert "hall" not in rotation.get("rooms", {})
