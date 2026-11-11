"""Late native room results refresh statistics without replaying automations."""

import asyncio
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.matic_robot import _register_native_history_sync
from custom_components.matic_robot.client.cleaning_session import (
    _native_history_collection_revision,
)
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    HermesCollectionEntry,
    RobotTelemetry,
    Room,
)
from custom_components.matic_robot.const import (
    EVENT_CLEANING_FINISHED,
    EVENT_NATIVE_HISTORY_UPDATED,
)
from tests.session_fakes import start_coordinator
from tests.test_coordinator import _client


def _floor_plan() -> FloorPlan:
    return FloorPlan(
        7,
        "synthetic-floor",
        b"synthetic-floor",
        (Room("study", "Study", "study", b"study", ()),),
    )


async def _native_sync_harness(hass, revision="revision-0"):
    client = _client()
    client.async_get_floor_plan.return_value = _floor_plan()
    client.async_get_telemetry.return_value = RobotTelemetry(
        native_history_revision=revision
    )
    coordinator = await start_coordinator(hass, client)
    coordinator.async_set_updated_data(await coordinator._async_update_data())
    entry = MagicMock(entry_id="entry")
    unloads = []
    entry.async_on_unload = unloads.append
    plans = SimpleNamespace(
        control=SimpleNamespace(),
        ledger=SimpleNamespace(
            async_process_native_history=AsyncMock(return_value=False)
        ),
    )
    _register_native_history_sync(hass, entry, client, coordinator, plans, "synthetic")
    coordinator.async_ack_native_history_revision(revision)
    return client, coordinator, entry, unloads, plans


async def _poll_history_revision(coordinator, client, revision, latest_session=None):
    client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=latest_session, native_history_revision=revision
    )
    coordinator._slow_refresh_due = 0
    coordinator.async_set_updated_data(await coordinator._async_update_data())


async def test_native_result_enrichment_refreshes_history_once_without_finished_replay(
    hass,
):
    now = dt_util.utcnow()
    client = _client()
    floor_plan = FloorPlan(
        7,
        "synthetic-floor",
        b"synthetic-floor",
        (Room("study", "Study", "study", b"study", ()),),
    )
    client.async_get_floor_plan.return_value = floor_plan
    with patch(
        "custom_components.matic_robot.coordinator.dt_util.utcnow",
        return_value=now - timedelta(hours=1),
    ):
        coordinator = await start_coordinator(hass, client)
    client.async_get_telemetry.return_value = RobotTelemetry(
        native_history_revision="revision-0"
    )
    coordinator.async_set_updated_data(await coordinator._async_update_data())
    entry = MagicMock(entry_id="entry")
    unloads = []
    entry.async_on_unload = unloads.append
    plans = SimpleNamespace(
        control=SimpleNamespace(),
        ledger=SimpleNamespace(
            async_process_native_history=AsyncMock(return_value=True)
        ),
    )
    _register_native_history_sync(hass, entry, client, coordinator, plans, "synthetic")
    coordinator.async_ack_native_history_revision("revision-0")
    finished = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    updated = async_capture_events(hass, EVENT_NATIVE_HISTORY_UPDATED)

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
    for session, revision in (
        (replace(initial, ended_at=None), "revision-0"),
        (initial, "revision-1"),
        (enriched, "revision-2"),
        (enriched, "revision-2"),
    ):
        client.async_get_telemetry.return_value = RobotTelemetry(
            latest_session=session, native_history_revision=revision
        )
        records = (CleaningSessionRecord(b"synthetic-history", session),)
        client.async_get_cleaning_session_records.return_value = records
        client.async_get_cleaning_session_snapshot.return_value = (records, revision)
        coordinator._slow_refresh_due = 0
        coordinator.async_set_updated_data(await coordinator._async_update_data())
        await hass.async_block_till_done()
        if revision == "revision-2":
            assert coordinator.native_history_revision_is_current(revision)
            assert plans.ledger.async_process_native_history.await_count >= 2
            assert coordinator._acknowledged_native_history_revision == revision

    assert len(finished) == 1
    assert len(updated) == 2
    assert [event.data for event in updated] == [
        {"entry_id": "entry", "revision": "revision-1"},
        {"entry_id": "entry", "revision": "revision-2"},
    ]
    assert plans.ledger.async_process_native_history.await_count == 2
    assert plans.ledger.async_process_native_history.await_args.args[2] == (
        CleaningSessionRecord(b"synthetic-history", enriched),
    )

    for remove in unloads:
        remove()
    hass.bus.async_fire(EVENT_NATIVE_HISTORY_UPDATED, {"entry_id": "entry"})
    await hass.async_block_till_done()
    assert plans.ledger.async_process_native_history.await_count == 2


async def test_failed_history_import_retries_same_telemetry_revision(hass):
    client, coordinator, _entry, _unloads, plans = await _native_sync_harness(hass)

    record = CleaningSessionRecord(
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
    client.async_get_cleaning_session_snapshot.side_effect = [
        MaticError("temporary read failure"),
        ((record,), "revision-a"),
    ]

    await _poll_history_revision(coordinator, client, "revision-a")
    await hass.async_block_till_done()
    assert coordinator._acknowledged_native_history_revision == "revision-0"
    plans.ledger.async_process_native_history.assert_not_awaited()

    await _poll_history_revision(coordinator, client, "revision-a")
    await hass.async_block_till_done()

    assert client.async_get_cleaning_session_snapshot.await_count == 2
    assert plans.ledger.async_process_native_history.await_count == 1
    assert plans.ledger.async_process_native_history.await_args.args[2] == (record,)
    assert coordinator._acknowledged_native_history_revision == "revision-a"


async def test_rejected_import_retries_after_admission_reopens(hass):
    client, coordinator, _entry, _unloads, plans = await _native_sync_harness(hass)
    plans.ledger.async_process_native_history.side_effect = (None, False)
    record = CleaningSessionRecord(
        b"session",
        CleaningSession(
            "2026-10-01T08:00:00+00:00",
            "2026-10-01T08:30:00+00:00",
            1800,
            ("Study",),
            (),
            None,
        ),
    )
    client.async_get_cleaning_session_snapshot.return_value = ((record,), "revision-a")

    await _poll_history_revision(coordinator, client, "revision-a")
    await hass.async_block_till_done()
    assert coordinator._acknowledged_native_history_revision == "revision-0"

    await _poll_history_revision(coordinator, client, "revision-a")
    await hass.async_block_till_done()

    assert plans.ledger.async_process_native_history.await_count == 2
    assert coordinator._acknowledged_native_history_revision == "revision-a"


async def test_older_session_revision_refreshes_even_when_latest_session_is_unchanged(
    hass,
):
    client, coordinator, _entry, _unloads, plans = await _native_sync_harness(hass)
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
    client.async_get_cleaning_session_snapshot.side_effect = [
        ((older_before,), "revision-a"),
        ((older_revised,), "revision-b"),
    ]

    await _poll_history_revision(coordinator, client, "revision-a", latest)
    await hass.async_block_till_done()
    await _poll_history_revision(coordinator, client, "revision-b", latest)
    await hass.async_block_till_done()

    assert plans.ledger.async_process_native_history.await_count == 2
    assert plans.ledger.async_process_native_history.await_args.args[2] == (
        older_revised,
    )
    assert coordinator._acknowledged_native_history_revision == "revision-b"


async def test_newer_revision_waiting_behind_import_is_not_lost(hass):
    client, coordinator, _entry, _unloads, plans = await _native_sync_harness(hass)
    read_started = asyncio.Event()
    release_read = asyncio.Event()
    empty_session = CleaningSession(None, None, None, (), (), None)
    old_record = CleaningSessionRecord(b"old", empty_session)
    new_record = CleaningSessionRecord(b"new", empty_session)
    reads = 0

    async def read_snapshot():
        nonlocal reads
        reads += 1
        if reads == 1:
            read_started.set()
            await release_read.wait()
            return (old_record,), "revision-a"
        return (new_record,), "revision-b"

    client.async_get_cleaning_session_snapshot.side_effect = read_snapshot
    await _poll_history_revision(coordinator, client, "revision-a")
    await read_started.wait()
    await _poll_history_revision(coordinator, client, "revision-b")
    release_read.set()
    await hass.async_block_till_done()
    await _poll_history_revision(coordinator, client, "revision-b")
    await hass.async_block_till_done()

    assert reads == 2
    assert plans.ledger.async_process_native_history.await_count == 1
    assert plans.ledger.async_process_native_history.await_args.args[2] == (new_record,)
    assert coordinator._acknowledged_native_history_revision == "revision-b"


async def test_unload_during_history_read_prevents_import_and_ack(hass):
    client, coordinator, _entry, unloads, plans = await _native_sync_harness(hass)
    read_started = asyncio.Event()
    release_read = asyncio.Event()
    record = CleaningSessionRecord(
        b"record", CleaningSession(None, None, None, (), (), None)
    )

    async def read_snapshot():
        read_started.set()
        await release_read.wait()
        return (record,), "revision-a"

    client.async_get_cleaning_session_snapshot.side_effect = read_snapshot
    await _poll_history_revision(coordinator, client, "revision-a")
    await read_started.wait()
    for unload in unloads:
        unload()
    release_read.set()
    await hass.async_block_till_done()

    plans.ledger.async_process_native_history.assert_not_awaited()
    assert coordinator._acknowledged_native_history_revision == "revision-0"


async def test_floor_disappearing_during_history_read_prevents_import_and_ack(hass):
    client, coordinator, _entry, _unloads, plans = await _native_sync_harness(hass)
    read_started = asyncio.Event()
    release_read = asyncio.Event()
    record = CleaningSessionRecord(
        b"record", CleaningSession(None, None, None, (), (), None)
    )

    async def read_snapshot():
        read_started.set()
        await release_read.wait()
        return (record,), "revision-a"

    client.async_get_cleaning_session_snapshot.side_effect = read_snapshot
    await _poll_history_revision(coordinator, client, "revision-a")
    await read_started.wait()
    coordinator.data = replace(coordinator.data, floor_plan=None)
    release_read.set()
    await hass.async_block_till_done()

    plans.ledger.async_process_native_history.assert_not_awaited()
    assert coordinator._acknowledged_native_history_revision == "revision-0"


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
