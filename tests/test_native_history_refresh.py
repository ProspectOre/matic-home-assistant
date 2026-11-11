"""Native history reaches the plan ledger once, and late results still count."""

import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.matic_robot.client.cleaning_session import (
    _native_history_collection_revision,
)
from custom_components.matic_robot.client.exceptions import (
    CannotConnectError,
    MaticError,
)
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    HermesCollectionEntry,
    RobotTelemetry,
    Room,
)
from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED
from custom_components.matic_robot.native_history_sync import (
    NativeHistorySync,
    async_resume_native_reconciliation,
    async_watch_native_reconciliation,
)
from custom_components.matic_robot.plan_storage import STOP_FENCE_EXPIRES_AT
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.session import RobotSession
from custom_components.matic_robot.session_listeners import _FinishedSessions
from custom_components.matic_robot.stores import Store
from tests.session_fakes import session_entry, start_session
from tests.test_robot_health import _client

SYNC = "custom_components.matic_robot.native_history_sync"
EMPTY_SESSION = CleaningSession(None, None, None, (), (), None)


def _floor_plan() -> FloorPlan:
    return FloorPlan(
        7,
        "synthetic-floor",
        b"synthetic-floor",
        (Room("study", "Study", "study", b"study", ()),),
    )


async def _syncing(hass, *, processed=False, generation=None):
    """Return a session whose revision-0 history is imported, and its sync."""
    client = _client()
    client.async_get_floor_plan.return_value = _floor_plan()
    client.async_get_telemetry.return_value = RobotTelemetry(
        native_history_revision="revision-0"
    )
    entry = session_entry()
    session = await start_session(hass, client, entry)
    control = (
        SimpleNamespace()
        if generation is None
        else SimpleNamespace(robot_generation=generation)
    )
    plans = SimpleNamespace(
        control=control,
        ledger=SimpleNamespace(
            async_process_native_history=AsyncMock(return_value=processed)
        ),
    )
    sync = NativeHistorySync(hass, entry, session, plans, "synthetic")
    sync.acknowledged = "revision-0"
    sync.async_start()
    return session, sync, entry, plans


async def _read_revision(
    hass, session: RobotSession, revision: str, latest_session=None
) -> None:
    """Have the heartbeat read telemetry naming ``revision`` now."""
    session.client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=latest_session, native_history_revision=revision
    )
    session.heartbeat._force_full_refresh = True
    await session.heartbeat.async_refresh()


async def _stop(entry, session: RobotSession) -> None:
    """Unload the entry and stop the session, so no timer outlives the test."""
    entry.unload()
    await session.async_stop()


def _blocked_read(record, revision):
    """Return a history read that waits for its release, and both events."""
    started = asyncio.Event()
    release = asyncio.Event()

    async def read():
        started.set()
        await release.wait()
        return (record,), revision

    return read, started, release


async def test_native_result_enrichment_imports_each_revision_without_replay(hass):
    now = dt_util.utcnow()
    session, sync, entry, plans = await _syncing(hass, processed=True)
    _FinishedSessions(hass, entry, session).async_start()
    finished = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    initial = CleaningSession(
        started_at=(now - timedelta(minutes=20)).isoformat(),
        ended_at=(now - timedelta(minutes=1)).isoformat(),
        duration_seconds=1140,
        rooms=("Study",),
        room_durations=(),
        completed=None,
    )
    enriched = replace(
        initial,
        mode_results=(CleaningModeResult("Study", "vacuum", "completed", 600),),
    )
    for cleaning, revision in (
        (replace(initial, ended_at=None), "revision-0"),
        (initial, "revision-1"),
        (enriched, "revision-2"),
        (enriched, "revision-2"),
    ):
        records = (CleaningSessionRecord(b"synthetic-history", cleaning),)
        session.client.async_get_cleaning_session_snapshot.return_value = (
            records,
            revision,
        )
        await _read_revision(hass, session, revision, cleaning)
        await hass.async_block_till_done()

    assert len(finished) == 1
    assert sync.acknowledged == "revision-2"
    ledger = plans.ledger.async_process_native_history
    assert ledger.await_count == 2
    assert ledger.await_args.args == (
        "synthetic",
        _floor_plan(),
        (CleaningSessionRecord(b"synthetic-history", enriched),),
    )
    assert (
        ledger.await_args.kwargs["coverage_verifier"]
        is session.client.async_confirm_coverage_receipt
    )
    floor_reader = ledger.await_args.kwargs["current_floor_plan"]
    replacement = FloorPlan(8, "replacement-floor", b"replacement", ())
    session.floor.value = replacement
    assert floor_reader() is replacement

    entry.unload()
    session.history.set(replace(session.history.value, revision="revision-3"))
    await hass.async_block_till_done()
    assert ledger.await_count == 2
    await session.async_stop()


async def test_failed_history_read_retries_after_one_heartbeat(hass):
    session, sync, entry, plans = await _syncing(hass)
    record = CleaningSessionRecord(b"older-session", EMPTY_SESSION)
    session.client.async_get_cleaning_session_snapshot.side_effect = [
        MaticError("temporary read failure"),
        ((record,), "revision-a"),
    ]

    await _read_revision(hass, session, "revision-a")
    await hass.async_block_till_done()
    assert sync.acknowledged == "revision-0"
    plans.ledger.async_process_native_history.assert_not_awaited()

    async_fire_time_changed(hass, dt_util.utcnow() + session.heartbeat.interval)
    await hass.async_block_till_done()

    assert session.client.async_get_cleaning_session_snapshot.await_count == 2
    plans.ledger.async_process_native_history.assert_awaited_once()
    assert plans.ledger.async_process_native_history.await_args.args[2] == (record,)
    assert sync.acknowledged == "revision-a"
    await _stop(entry, session)


async def test_rejected_import_retries_and_a_new_revision_cancels_the_wait(hass):
    session, sync, entry, plans = await _syncing(hass)
    plans.ledger.async_process_native_history.side_effect = (None, None, False)
    record = CleaningSessionRecord(b"session", EMPTY_SESSION)
    session.client.async_get_cleaning_session_snapshot.return_value = (
        (record,),
        "revision-a",
    )

    await _read_revision(hass, session, "revision-a")
    await hass.async_block_till_done()
    assert sync.acknowledged == "revision-0"
    async_fire_time_changed(hass, dt_util.utcnow() + session.heartbeat.interval)
    await hass.async_block_till_done()
    assert sync.acknowledged == "revision-0"

    # A new revision imports at once instead of waiting for the retry.
    session.client.async_get_cleaning_session_snapshot.return_value = (
        (record,),
        "revision-b",
    )
    await _read_revision(hass, session, "revision-b")
    await hass.async_block_till_done()

    assert plans.ledger.async_process_native_history.await_count == 3
    assert sync.acknowledged == "revision-b"
    await _stop(entry, session)


async def test_older_session_revision_imports_when_latest_session_is_unchanged(
    hass,
):
    session, sync, entry, plans = await _syncing(hass)
    latest = CleaningSession(
        started_at="2026-10-30T08:00:00+00:00",
        ended_at="2026-10-30T08:30:00+00:00",
        duration_seconds=1800,
        rooms=(),
        room_durations=(),
        completed=True,
    )
    older_before = CleaningSessionRecord(
        b"older-session",
        CleaningSession(
            started_at="2026-10-01T08:00:00+00:00",
            ended_at="2026-10-01T08:30:00+00:00",
            duration_seconds=1800,
            rooms=("Study",),
            room_durations=(),
            completed=None,
        ),
    )
    older_revised = replace(
        older_before,
        session=replace(older_before.session, duration_seconds=2100),
    )
    session.client.async_get_cleaning_session_snapshot.side_effect = [
        ((older_before,), "revision-a"),
        ((older_revised,), "revision-b"),
    ]

    await _read_revision(hass, session, "revision-a", latest)
    await hass.async_block_till_done()
    await _read_revision(hass, session, "revision-b", latest)
    await hass.async_block_till_done()

    assert plans.ledger.async_process_native_history.await_count == 2
    assert plans.ledger.async_process_native_history.await_args.args[2] == (
        older_revised,
    )
    assert sync.acknowledged == "revision-b"
    await _stop(entry, session)


async def test_newer_revision_waiting_behind_import_is_not_lost(hass):
    session, sync, entry, plans = await _syncing(hass)
    read_started = asyncio.Event()
    release_read = asyncio.Event()
    old_record = CleaningSessionRecord(b"old", EMPTY_SESSION)
    new_record = CleaningSessionRecord(b"new", EMPTY_SESSION)
    reads = 0

    async def read_snapshot():
        nonlocal reads
        reads += 1
        if reads == 1:
            read_started.set()
            await release_read.wait()
            return (old_record,), "revision-a"
        return (new_record,), "revision-b"

    session.client.async_get_cleaning_session_snapshot.side_effect = read_snapshot
    await _read_revision(hass, session, "revision-a")
    await read_started.wait()
    await _read_revision(hass, session, "revision-b")
    release_read.set()
    await hass.async_block_till_done()

    assert reads == 2
    plans.ledger.async_process_native_history.assert_awaited_once()
    assert plans.ledger.async_process_native_history.await_args.args[2] == (new_record,)
    assert sync.acknowledged == "revision-b"
    await _stop(entry, session)


async def test_unload_during_history_read_prevents_import_and_ack(hass):
    session, sync, entry, plans = await _syncing(hass)
    record = CleaningSessionRecord(b"record", EMPTY_SESSION)
    read, started, release = _blocked_read(record, "revision-a")
    session.client.async_get_cleaning_session_snapshot.side_effect = read

    await _read_revision(hass, session, "revision-a")
    await started.wait()
    # A newer revision that arrives meanwhile is not imported either.
    await _read_revision(hass, session, "revision-b")
    entry.unload()
    release.set()
    await hass.async_block_till_done()

    plans.ledger.async_process_native_history.assert_not_awaited()
    assert sync.acknowledged == "revision-0"
    await session.async_stop()


async def test_floor_disappearing_during_history_read_prevents_import_and_ack(hass):
    session, sync, entry, plans = await _syncing(hass)
    record = CleaningSessionRecord(b"record", EMPTY_SESSION)
    read, started, release = _blocked_read(record, "revision-a")
    session.client.async_get_cleaning_session_snapshot.side_effect = read

    await _read_revision(hass, session, "revision-a")
    await started.wait()
    session.floor.set(None)
    release.set()
    await hass.async_block_till_done()

    plans.ledger.async_process_native_history.assert_not_awaited()
    assert sync.acknowledged == "revision-0"
    await _stop(entry, session)


async def test_no_history_is_read_for_a_robot_removed_since_the_sync_began(hass):
    generation = [1]
    session, sync, entry, _plans = await _syncing(
        hass, processed=True, generation=lambda _serial: generation[0]
    )
    generation[0] = 2

    await _read_revision(hass, session, "revision-a")
    await hass.async_block_till_done()

    session.client.async_get_cleaning_session_snapshot.assert_not_awaited()
    assert sync.acknowledged == "revision-0"
    await _stop(entry, session)


async def test_robot_removed_during_history_read_prevents_import(hass):
    """An import started before a robot is re-added cannot count for it."""
    generation = [1]
    session, sync, entry, plans = await _syncing(
        hass, processed=True, generation=lambda _serial: generation[0]
    )
    record = CleaningSessionRecord(b"record", EMPTY_SESSION)
    read, started, release = _blocked_read(record, "revision-a")
    session.client.async_get_cleaning_session_snapshot.side_effect = read

    await _read_revision(hass, session, "revision-a")
    await started.wait()
    generation[0] = 2
    release.set()
    await hass.async_block_till_done()

    plans.ledger.async_process_native_history.assert_not_awaited()
    assert sync.acknowledged == "revision-0"
    await _stop(entry, session)


async def test_native_reconciliation_recovery_is_lifecycle_bound() -> None:
    pending = {
        "plan_id": "away",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": "2026-08-13T12:00:00+00:00",
        "expires_at": "2026-08-13T12:12:00+00:00",
    }
    plans = MagicMock()
    plans.ledger.async_set_native_cleanings_enabled = AsyncMock()
    plans.recovery.recovery_run.return_value = None
    plans.ledger.pending_native_reconciliation.return_value = None
    entry = SimpleNamespace(async_create_background_task=MagicMock())
    hass = MagicMock()
    session = MagicMock()

    async_resume_native_reconciliation(hass, entry, session, plans, "synthetic-serial")
    entry.async_create_background_task.assert_not_called()

    lifecycle_task = asyncio.create_task(asyncio.sleep(0))

    def capture_task(_hass, target, _name):
        target.close()
        return lifecycle_task

    plans.ledger.pending_native_reconciliation.return_value = pending
    # Without a task to hand over, there is nothing to register for cancelling.
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        target.close()
    )
    async_resume_native_reconciliation(hass, entry, session, plans, "synthetic-serial")
    plans.control.register_reconciliation_task.assert_not_called()

    entry.async_create_background_task.side_effect = capture_task
    async_resume_native_reconciliation(hass, entry, session, plans, "synthetic-serial")
    await lifecycle_task

    assert entry.async_create_background_task.call_args.args[2] == (
        "matic_robot native stop recovery"
    )
    plans.control.register_reconciliation_task.assert_called_once_with(
        "synthetic-serial", lifecycle_task
    )


async def test_restart_recovery_credits_late_native_completion(hass) -> None:
    events = []
    hass.bus.async_listen("matic_robot_room_reconciled", events.append)
    now = datetime(2026, 8, 13, 12, tzinfo=UTC)
    room = Room(
        "room-kitchen",
        "Kitchen",
        "protocol-kitchen",
        b"kitchen",
        ((0, 0), (1, 0), (1, 1), (0, 1)),
    )
    floor_plan = FloorPlan(1, "partition", b"partition", (room,))
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("synthetic-serial")["pending_native_reconciliation"] = {
        "plan_id": "away",
        "room_id": room.id,
        "room": room.name,
        "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        "expires_at": (now + timedelta(seconds=10)).isoformat(),
        "run_id": "synthetic-restart-run",
    }
    pending = manager.ledger.pending_native_reconciliation("synthetic-serial")
    assert pending is not None
    native_record = CleaningSessionRecord(
        b"late-session",
        CleaningSession(
            (now - timedelta(seconds=4)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            3,
            (room.name,),
            ((room.name, 3),),
            True,
            (room.name,),
        ),
    )
    client = SimpleNamespace(
        async_get_cleaning_session_records=AsyncMock(return_value=(native_record,))
    )
    session = SimpleNamespace(client=client, floor=Store(floor_plan))

    with (
        patch(f"{SYNC}.dt_util.utcnow", return_value=now),
        patch(f"{SYNC}.asyncio.sleep", AsyncMock()) as sleep,
    ):
        await async_watch_native_reconciliation(
            session,
            manager,
            "synthetic-serial",
            pending,
        )

    sleep.assert_awaited_once_with(5)
    client.async_get_cleaning_session_records.assert_awaited_once()
    assert manager.ledger.pending_native_reconciliation("synthetic-serial") is None
    room_history = manager.history.snapshot("synthetic-serial")["plan_history"]["away"][
        "rooms"
    ][room.id]
    assert room_history["last_result"] == "completed"
    assert room_history["last_duration_seconds"] == 3
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["run_id"] == "synthetic-restart-run"
    assert events[0].data["reason_code"] == "native_reconciled_completion"


async def test_restart_recovery_expires_marker_after_transport_error(hass) -> None:
    now = datetime(2026, 8, 13, 12, tzinfo=UTC)
    dispatched_at = now - timedelta(seconds=5)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    robot = manager.repository.robot("synthetic-serial")
    robot["pending_native_reconciliation"] = {
        "plan_id": "away",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": dispatched_at.isoformat(),
        "expires_at": (now + timedelta(seconds=1)).isoformat(),
    }
    robot[STOP_FENCE_EXPIRES_AT] = (now + timedelta(seconds=1)).isoformat()
    manager.control.arm_stop_pending("synthetic-serial", -1)
    pending = manager.ledger.pending_native_reconciliation("synthetic-serial")
    assert pending is not None
    client = SimpleNamespace(
        async_get_cleaning_session_records=AsyncMock(
            side_effect=CannotConnectError("history unavailable")
        )
    )
    session = SimpleNamespace(client=client, floor=Store(None))

    with (
        patch(
            f"{SYNC}.dt_util.utcnow",
            side_effect=(now, now + timedelta(seconds=2)),
        ),
        patch(f"{SYNC}.asyncio.sleep", AsyncMock()) as sleep,
    ):
        await async_watch_native_reconciliation(
            session,
            manager,
            "synthetic-serial",
            pending,
        )

    sleep.assert_awaited_once_with(1)
    client.async_get_cleaning_session_records.assert_awaited_once()
    assert manager.ledger.pending_native_reconciliation("synthetic-serial") is None
    assert STOP_FENCE_EXPIRES_AT not in manager.repository.robot("synthetic-serial")
    manager.repository.store.async_save.assert_awaited_once()


@pytest.mark.parametrize("replaced", ["during_wait", "during_read"])
async def test_restart_recovery_does_not_import_for_replacement_marker(
    hass, replaced: str
) -> None:
    now = datetime(2026, 8, 13, 12, tzinfo=UTC)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    robot = manager.repository.robot("synthetic-serial")
    robot["pending_native_reconciliation"] = {
        "plan_id": "away",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        "expires_at": (now + timedelta(seconds=10)).isoformat(),
    }
    pending = manager.ledger.pending_native_reconciliation("synthetic-serial")
    assert pending is not None
    replacement = {
        **pending,
        "dispatched_at": now.isoformat(),
    }

    async def wait(_seconds: float) -> None:
        if replaced == "during_wait":
            robot["pending_native_reconciliation"] = replacement

    async def read() -> tuple[CleaningSessionRecord, ...]:
        if replaced == "during_read":
            robot["pending_native_reconciliation"] = replacement
        return ()

    client = SimpleNamespace(
        async_get_cleaning_session_records=AsyncMock(side_effect=read)
    )
    session = SimpleNamespace(client=client, floor=Store(None))

    with (
        patch(f"{SYNC}.dt_util.utcnow", return_value=now),
        patch(f"{SYNC}.asyncio.sleep", AsyncMock(side_effect=wait)),
        patch.object(
            manager.ledger,
            "async_import_native_history",
            wraps=manager.ledger.async_import_native_history,
        ) as import_history,
    ):
        await async_watch_native_reconciliation(
            session,
            manager,
            "synthetic-serial",
            pending,
        )

    import_history.assert_not_awaited()
    assert client.async_get_cleaning_session_records.await_count == (
        replaced == "during_read"
    )
    assert (
        manager.ledger.pending_native_reconciliation("synthetic-serial") == replacement
    )


def test_history_revision_ignores_active_records_and_tracks_ended_revisions():
    active = CleaningSession(
        started_at="2026-10-31T08:00:00+00:00",
        ended_at=None,
        duration_seconds=None,
        rooms=(),
        room_durations=(),
        completed=None,
    )
    ended = replace(active, ended_at="2026-10-31T08:30:00+00:00")
    entries = (
        HermesCollectionEntry(b"active", b"active-v1"),
        HermesCollectionEntry(b"ended", b"ended-v1"),
    )
    with patch(
        "custom_components.matic_robot.client.cleaning_session.decode_cleaning_session",
        side_effect=lambda payload: active if payload.startswith(b"active") else ended,
    ):
        active_revision = _native_history_collection_revision(entries)
        ended_only_revision = _native_history_collection_revision(
            (HermesCollectionEntry(b"ended", b"ended-v1"),)
        )
        active_changed = _native_history_collection_revision(
            (HermesCollectionEntry(b"active", b"active-v2"),)
        )
        ended_changed = _native_history_collection_revision(
            (HermesCollectionEntry(b"ended", b"ended-v2"),)
        )

    assert active_revision == ended_only_revision
    assert active_changed == _native_history_collection_revision(())
    assert ended_changed != active_revision
