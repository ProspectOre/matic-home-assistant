"""Which floor plan the heartbeat admits, as the displayed mission changes."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock, MagicMock

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client import MaticHermesClient
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.mission import MissionClientState
from custom_components.matic_robot.client.models import (
    FloorPlan,
    HermesCollectionEntry,
    MappedFloor,
    RobotOperationalState,
    RobotTelemetry,
)
from custom_components.matic_robot.session import RobotSession
from tests.hermes_fakes import FakeChannel, watch
from tests.session_fakes import (
    SYNTHETIC_INFO,
    displayed_mission_handler,
    start_session,
)

DECODE = "custom_components.matic_robot.heartbeat.decode_mission_client_state"


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = SYNTHETIC_INFO
    client.async_get_state.return_value = RobotOperationalState(
        50, (), (), False, False, False, False, False, False
    )
    client.async_get_floor_plan.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(protocol_version=25)
    client.add_connection_listener = MagicMock()
    return client


async def _watch_display(session: RobotSession, entries, runs: int = 1) -> None:
    """Run the heartbeat's displayed-mission watch over ``entries``."""
    await watch(entries, runs)(
        "displayed_mission", displayed_mission_handler(session.client)
    )


async def test_floor_watcher_refreshes_changed_mission_and_labels(
    hass, monkeypatch
) -> None:
    client = _client()
    floors = (
        MappedFloor(42, "Main", "1" * 64),
        MappedFloor(84, "Workshop", "2" * 64),
    )
    client.async_get_floor_plan.return_value = FloorPlan(
        42, "partition", b"", (), mapped_floors=floors
    )
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat.async_request_refresh = AsyncMock()
    heartbeat._verified_floor_mission_id = 42
    heartbeat._map_refresh_due = 99.0

    async def entries(name):
        assert name == "displayed_mission"
        yield HermesCollectionEntry(b"", b"same")
        yield HermesCollectionEntry(b"", b"changed")
        raise asyncio.CancelledError

    monkeypatch.setattr(
        DECODE,
        lambda payload: MissionClientState(
            floors[0] if payload == b"same" else floors[1], floors
        ),
    )

    with pytest.raises(asyncio.CancelledError):
        await _watch_display(session, entries)

    heartbeat.async_request_refresh.assert_awaited_once_with()
    assert heartbeat._verified_floor_mission_id is None
    assert heartbeat.displayed_mission.value == 84
    assert session.floor.value is None
    assert heartbeat._map_refresh_due == 0.0


async def test_a_repeated_displayed_mission_leaves_admitted_floor_reads_alone(
    hass, monkeypatch
) -> None:
    client = _client()
    floor = MappedFloor(42, "Main", "1" * 64)
    client.async_get_floor_plan.return_value = FloorPlan(
        42, "partition", b"", (), mapped_floors=(floor,)
    )
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat.async_request_refresh = AsyncMock()
    monkeypatch.setattr(DECODE, lambda _payload: MissionClientState(floor, (floor,)))
    entry = HermesCollectionEntry(b"", b"same")
    await heartbeat._async_displayed_mission(entry)
    generation = heartbeat.floor_read_generation
    floor_plan = session.floor.value

    await heartbeat._async_displayed_mission(entry)

    assert heartbeat.floor_read_generation == generation
    assert session.floor.value is floor_plan is not None
    heartbeat.async_request_refresh.assert_not_awaited()


async def test_floor_watcher_revokes_verified_map_after_same_mission_signature_change(
    hass, monkeypatch
) -> None:
    client = _client()
    old_floor = MappedFloor(42, "Main", "1" * 64)
    new_floor = MappedFloor(42, "Main", "2" * 64)
    client.async_get_floor_plan.return_value = FloorPlan(
        42, "partition", b"", (), mapped_floors=(old_floor,)
    )
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._displayed_floor_mission_id = 42
    heartbeat._displayed_floor_signature = (old_floor,)
    heartbeat._verified_floor_mission_id = 42
    heartbeat.async_request_refresh = AsyncMock()

    async def entries(_name):
        yield HermesCollectionEntry(b"", b"changed")
        raise asyncio.CancelledError

    monkeypatch.setattr(
        DECODE, lambda _payload: MissionClientState(new_floor, (new_floor,))
    )
    generation = heartbeat.floor_read_generation
    with pytest.raises(asyncio.CancelledError):
        await _watch_display(session, entries)

    assert heartbeat._displayed_floor_mission_id == 42
    assert heartbeat._displayed_floor_signature == (new_floor,)
    assert heartbeat._verified_floor_mission_id is None
    assert heartbeat.floor_read_generation == generation + 1
    assert session.floor.value is None
    heartbeat.async_request_refresh.assert_awaited_once_with()


async def test_floor_read_rejects_old_signature_and_accepts_single_plan_payload(
    hass, monkeypatch
) -> None:
    client = _client()
    old_floor = MappedFloor(42, "Main", "1" * 64)
    new_floor = MappedFloor(42, "Main", "2" * 64)
    old_map = FloorPlan(42, "partition", b"", (), mapped_floors=(old_floor,))
    new_map = replace(old_map, mapped_floors=(new_floor,))
    client.async_get_floor_plan.return_value = old_map
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._displayed_floor_mission_id = 42
    heartbeat._displayed_floor_signature = (old_floor,)
    heartbeat._verified_floor_mission_id = 42
    heartbeat.async_request_refresh = AsyncMock()

    async def entries(_name):
        yield HermesCollectionEntry(b"", b"changed")
        raise asyncio.CancelledError

    monkeypatch.setattr(
        DECODE, lambda _payload: MissionClientState(new_floor, (new_floor,))
    )
    with pytest.raises(asyncio.CancelledError):
        await _watch_display(session, entries)

    assert session.floor.value is None
    assert await heartbeat._async_optional_floor_plan() is None
    assert session.floor.value is None

    unannotated_single_plan = replace(new_map, mapped_floors=())
    client.async_get_floor_plan.return_value = unannotated_single_plan
    assert await heartbeat._async_optional_floor_plan() is unannotated_single_plan
    assert heartbeat._cached_floor_plan is unannotated_single_plan


async def test_floor_watcher_preserves_published_map_when_invalidated_read_matches(
    hass, monkeypatch
) -> None:
    client = _client()
    mapped_floor = MappedFloor(42, "Main", "1" * 64)
    floor_plan = FloorPlan(42, "partition", b"", (), mapped_floors=(mapped_floor,))
    client.async_get_floor_plan.return_value = floor_plan
    session = await start_session(hass, client)
    heartbeat = session.heartbeat

    read_started = asyncio.Event()
    release_read = asyncio.Event()

    async def slow_floor_read(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id is None
        read_started.set()
        await release_read.wait()
        return floor_plan

    client.async_get_floor_plan.side_effect = slow_floor_read
    heartbeat._map_refresh_due = 0.0
    poll = asyncio.create_task(heartbeat.async_refresh())
    await read_started.wait()

    heartbeat.async_request_refresh = AsyncMock()

    async def entries(_name):
        yield HermesCollectionEntry(b"", b"matching")
        raise asyncio.CancelledError

    monkeypatch.setattr(
        DECODE, lambda _payload: MissionClientState(mapped_floor, (mapped_floor,))
    )
    with pytest.raises(asyncio.CancelledError):
        await _watch_display(session, entries)

    heartbeat.async_request_refresh.assert_awaited_once_with()
    assert heartbeat._map_refresh_due == 0.0
    release_read.set()
    await poll
    assert session.floor.value is floor_plan
    assert heartbeat._floor_reads_in_flight == 0

    client.async_get_floor_plan.side_effect = None
    await heartbeat.async_refresh()

    assert session.floor.value is floor_plan
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=42)


async def test_repeated_displayed_mission_revokes_conflicting_verified_read(
    hass, monkeypatch
) -> None:
    client = _client()
    mapped_floor = MappedFloor(42, "Main", "1" * 64)
    floor_plan = FloorPlan(42, "partition", b"", (), mapped_floors=(mapped_floor,))
    client.async_get_floor_plan.return_value = floor_plan
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._displayed_floor_mission_id = 42
    heartbeat._displayed_floor_signature = (mapped_floor,)
    heartbeat._verified_floor_mission_id = 84
    heartbeat._map_refresh_due = 0.0

    read_started = asyncio.Event()
    release_read = asyncio.Event()

    async def stale_floor_read(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 84
        read_started.set()
        await release_read.wait()
        return floor_plan

    client.async_get_floor_plan.side_effect = stale_floor_read
    floor_read = asyncio.create_task(heartbeat._async_optional_floor_plan())
    await read_started.wait()
    heartbeat.async_request_refresh = AsyncMock()

    async def entries(_name):
        yield HermesCollectionEntry(b"", b"same")
        raise asyncio.CancelledError

    monkeypatch.setattr(
        DECODE, lambda _payload: MissionClientState(mapped_floor, (mapped_floor,))
    )
    generation = heartbeat.floor_read_generation
    with pytest.raises(asyncio.CancelledError):
        await _watch_display(session, entries)

    assert heartbeat._verified_floor_mission_id is None
    assert heartbeat.expected_floor_mission_id == 42
    assert heartbeat.floor_read_generation == generation + 1
    heartbeat.async_request_refresh.assert_awaited_once_with()
    release_read.set()

    assert await floor_read is floor_plan
    assert session.floor.value is floor_plan
    assert heartbeat._cached_floor_plan is floor_plan
    assert heartbeat._floor_reads_in_flight == 0


async def test_floor_read_does_not_preserve_map_after_same_mission_signature_change(
    hass,
) -> None:
    client = _client()
    old_floor = MappedFloor(42, "Main", "1" * 64)
    new_floor = MappedFloor(42, "Main", "2" * 64)
    floor_plan = FloorPlan(42, "partition", b"", (), mapped_floors=(old_floor,))
    client.async_get_floor_plan.return_value = floor_plan
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._displayed_floor_mission_id = 42
    heartbeat._displayed_floor_signature = (old_floor,)
    heartbeat._map_refresh_due = 0.0
    await heartbeat.async_refresh()

    read_started = asyncio.Event()
    release_read = asyncio.Event()

    async def slow_floor_read(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 42
        read_started.set()
        await release_read.wait()
        return floor_plan

    client.async_get_floor_plan.side_effect = slow_floor_read
    heartbeat._map_refresh_due = 0.0
    poll = asyncio.create_task(heartbeat.async_refresh())
    await read_started.wait()
    heartbeat._displayed_floor_signature = (new_floor,)
    heartbeat._floor_read_generation += 1
    release_read.set()
    await poll

    assert session.floor.value is None
    assert heartbeat._floor_reads_in_flight == 0
    assert heartbeat._cached_floor_plan is floor_plan


async def test_floor_watcher_revokes_unknown_state_and_subscribes_again(
    hass, monkeypatch
) -> None:
    client = _client()
    floor = MappedFloor(42, "Main", "1" * 64)
    attempts = 0

    async def entries(name):
        nonlocal attempts
        assert name == "displayed_mission"
        attempts += 1
        yield HermesCollectionEntry(b"", b"bad")
        yield HermesCollectionEntry(b"", b"unknown")
        if attempts == 1:
            yield HermesCollectionEntry(b"", b"current")
        raise MaticError("stream closed")

    session = await start_session(hass, client)
    session.heartbeat.async_request_refresh = AsyncMock()

    def decode(payload):
        if payload == b"bad":
            raise DecodeError("bad")
        return MissionClientState(floor if payload == b"current" else None, (floor,))

    monkeypatch.setattr(DECODE, decode)

    await _watch_display(session, entries, 2)

    assert attempts == 2
    session.heartbeat.async_request_refresh.assert_awaited_once_with()
    assert session.heartbeat.displayed_mission.value is None


@pytest.mark.parametrize("malformed", [False, True])
async def test_unknown_display_revokes_published_and_inflight_maps(
    hass, monkeypatch, malformed
) -> None:
    client = _client()
    floor = MappedFloor(42, "Main", "1" * 64)
    plan = FloorPlan(42, b"partition", b"partition", ())
    client.async_get_floor_plan.return_value = plan
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._verified_floor_mission_id = 42
    heartbeat._displayed_floor_mission_id = 42
    heartbeat._displayed_floor_signature = (floor,)
    await heartbeat.async_refresh()
    assert session.floor.value is plan
    started = asyncio.Event()
    release = asyncio.Event()

    async def read(**kwargs):
        started.set()
        await release.wait()
        return plan

    client.async_get_floor_plan.side_effect = read
    heartbeat._map_refresh_due = 0.0
    pending = asyncio.create_task(heartbeat._async_optional_floor_plan())
    await started.wait()
    unknown_processed = asyncio.Event()
    recover = asyncio.Event()
    recovered = asyncio.Event()

    async def entries(name):
        yield HermesCollectionEntry(b"", b"unknown")
        unknown_processed.set()
        await recover.wait()
        yield HermesCollectionEntry(b"", b"current")
        recovered.set()
        await asyncio.Event().wait()

    def decode(payload):
        if payload == b"unknown" and malformed:
            raise DecodeError("synthetic malformed display")
        return MissionClientState(floor if payload == b"current" else None, (floor,))

    monkeypatch.setattr(DECODE, decode)
    heartbeat.async_request_refresh = AsyncMock()
    watcher = asyncio.create_task(_watch_display(session, entries))
    try:
        await unknown_processed.wait()
        assert session.floor.value is None
        assert heartbeat.expected_floor_mission_id is None
        assert heartbeat.displayed_mission.value is None
        release.set()
        assert await pending is None
        client.async_get_floor_plan.reset_mock(side_effect=True)
        assert await heartbeat._async_optional_floor_plan() is None
        await heartbeat.async_request_floor_plan_refresh(42)
        assert heartbeat.expected_floor_mission_id is None
        assert await heartbeat._async_optional_floor_plan() is None
        client.async_get_floor_plan.assert_not_awaited()
        recover.set()
        await recovered.wait()
        assert heartbeat.expected_floor_mission_id == 42
        assert await heartbeat._async_optional_floor_plan() is plan
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


@pytest.mark.parametrize("malformed", [False, True])
@pytest.mark.parametrize("recover_before_publish", [False, True])
@pytest.mark.parametrize("delay_history", [False, True])
async def test_floor_revocation_fences_completed_poll_snapshot(
    hass, monkeypatch, malformed, recover_before_publish, delay_history
) -> None:
    """A cached map cannot outlive its authority while unrelated work waits."""
    client = _client()
    floor = MappedFloor(42, "Main", "1" * 64)
    plan = FloorPlan(42, b"partition", b"partition", ())
    client.async_get_floor_plan.return_value = plan
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._displayed_floor_mission_id = 42
    heartbeat._displayed_floor_signature = (floor,)
    heartbeat._map_refresh_due = 0.0
    await heartbeat.async_refresh()
    assert session.floor.value is plan
    client.async_get_floor_plan.reset_mock()
    floor_captured = asyncio.Event()
    blocked = asyncio.Event()
    release = asyncio.Event()
    read_floor = heartbeat._async_optional_floor_plan
    read_history = heartbeat._async_cleaning_history

    async def cached_floor():
        value = await read_floor()
        assert value is plan
        floor_captured.set()
        return value

    async def delayed_read():
        blocked.set()
        await release.wait()
        return RobotTelemetry(protocol_version=25)

    async def delayed_history(*args):
        blocked.set()
        await release.wait()
        return await read_history(*args)

    monkeypatch.setattr(heartbeat, "_async_optional_floor_plan", cached_floor)
    if delay_history:
        monkeypatch.setattr(heartbeat, "_async_cleaning_history", delayed_history)
    else:
        heartbeat._slow_refresh_due = 0.0
        client.async_get_telemetry.side_effect = delayed_read
    poll = asyncio.create_task(heartbeat.async_refresh())
    await floor_captured.wait()
    await blocked.wait()
    client.async_get_floor_plan.assert_not_awaited()
    unknown_processed = asyncio.Event()
    recover = asyncio.Event()
    recovered = asyncio.Event()

    async def entries(name):
        yield HermesCollectionEntry(b"", b"unknown")
        unknown_processed.set()
        await recover.wait()
        yield HermesCollectionEntry(b"", b"current")
        recovered.set()
        await asyncio.Event().wait()

    def decode(payload):
        if payload == b"unknown" and malformed:
            raise DecodeError("synthetic malformed display")
        return MissionClientState(floor if payload == b"current" else None, (floor,))

    monkeypatch.setattr(DECODE, decode)
    heartbeat.async_request_refresh = AsyncMock()
    watcher = asyncio.create_task(_watch_display(session, entries))
    try:
        await unknown_processed.wait()
        assert session.floor.value is None
        if recover_before_publish:
            recover.set()
            await recovered.wait()
            assert heartbeat.displayed_mission.value == 42
        release.set()
        await poll
        assert session.floor.value is None
        assert heartbeat._cached_floor_plan is None
        # A subsequent read under the recovered identity can restore the map.
        recover.set()
        await recovered.wait()
        assert await read_floor() is plan
    finally:
        release.set()
        watcher.cancel()
        await asyncio.gather(poll, watcher, return_exceptions=True)


async def test_floor_revocation_during_the_reads_withholds_the_floor(hass) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(42, "partition", b"", ())
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    assert session.floor.value is not None

    async def read_telemetry():
        heartbeat._floor_read_generation += 1
        heartbeat._displayed_floor_unknown = True
        return RobotTelemetry()

    client.async_get_telemetry.side_effect = read_telemetry
    heartbeat._slow_refresh_due = 0.0
    heartbeat._map_refresh_due = 0.0
    await heartbeat.async_refresh()

    assert session.floor.value is None


async def test_floor_fetch_failure_does_not_reuse_old_mission_plan(hass) -> None:
    client = _client()
    old_floor = FloorPlan(42, "partition", b"", ())
    client.async_get_floor_plan.return_value = old_floor
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    assert session.floor.value is old_floor

    heartbeat._displayed_floor_mission_id = 84
    heartbeat._map_refresh_due = 0.0
    client.async_get_floor_plan.side_effect = MaticError("floor transition")

    await heartbeat.async_refresh()

    assert session.floor.value is None
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=84)


async def test_floor_fetch_started_before_mission_change_cannot_publish_old_plan(
    hass,
) -> None:
    client = _client()
    old_floor = FloorPlan(42, "partition", b"", ())
    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch_floor_plan(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 42
        started.set()
        await release.wait()
        return old_floor

    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    client.async_get_floor_plan.side_effect = fetch_floor_plan
    heartbeat._displayed_floor_mission_id = 42

    read = asyncio.create_task(heartbeat._async_optional_floor_plan())
    await started.wait()
    heartbeat._displayed_floor_mission_id = 84
    release.set()

    assert await read is None
    assert heartbeat._cached_floor_plan is None


async def test_failed_floor_fetch_started_before_mission_change_cannot_reuse_old_plan(
    hass,
) -> None:
    client = _client()
    old_floor = FloorPlan(42, "partition", b"", ())
    client.async_get_floor_plan.return_value = old_floor
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._displayed_floor_mission_id = 42

    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch_floor_plan(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 42
        started.set()
        await release.wait()
        raise MaticError("floor transition")

    client.async_get_floor_plan.side_effect = fetch_floor_plan
    heartbeat._map_refresh_due = 0.0
    read = asyncio.create_task(heartbeat._async_optional_floor_plan())
    await started.wait()
    heartbeat._displayed_floor_mission_id = 84
    release.set()

    assert await read is None
    assert heartbeat._cached_floor_plan is old_floor


async def test_floor_read_rejects_displayed_mission_aba_result(
    hass, monkeypatch
) -> None:
    client = _client()
    floor = FloorPlan(42, "partition", b"", ())
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._cached_floor_plan = floor

    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch_floor_plan(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 42
        started.set()
        await release.wait()
        return floor

    client.async_get_floor_plan.side_effect = fetch_floor_plan
    states = {
        b"a": MissionClientState(
            MappedFloor(42, "Main", "a"), (MappedFloor(42, "Main", "a"),)
        ),
        b"b": MissionClientState(
            MappedFloor(84, "Workshop", "b"), (MappedFloor(84, "Workshop", "b"),)
        ),
        b"a-again": MissionClientState(
            MappedFloor(42, "Main", "a"), (MappedFloor(42, "Main", "a"),)
        ),
    }

    async def entries(_name):
        for payload in (b"a", b"b", b"a-again"):
            yield HermesCollectionEntry(b"", payload)
        raise asyncio.CancelledError

    monkeypatch.setattr(DECODE, states.__getitem__)
    refreshes = 0
    read: asyncio.Task[FloorPlan | None] | None = None

    async def request_refresh() -> None:
        nonlocal refreshes, read
        refreshes += 1
        if refreshes == 1:
            read = asyncio.create_task(heartbeat._async_optional_floor_plan())
            await started.wait()

    heartbeat.async_request_refresh = request_refresh
    with pytest.raises(asyncio.CancelledError):
        await _watch_display(session, entries)
    assert read is not None
    release.set()

    assert await read is None
    assert heartbeat.displayed_mission.value == 42
    assert heartbeat._cached_floor_plan is floor


async def test_same_floor_fetch_failure_reuses_verified_cached_plan(hass) -> None:
    client = _client()
    floor = FloorPlan(42, "partition", b"", ())
    client.async_get_floor_plan.return_value = floor
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    assert session.floor.value is floor

    heartbeat._displayed_floor_mission_id = 42
    heartbeat._map_refresh_due = 0.0
    client.async_get_floor_plan.side_effect = MaticError("temporary read failure")

    await heartbeat.async_refresh()

    assert session.floor.value is floor
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=42)


@pytest.mark.parametrize("watcher", ("displayed_mission", "state"))
async def test_watcher_finishes_when_a_closed_channel_replaces_its_cancellation(
    hass, watcher
) -> None:
    """Real grpclib error replacement cannot leave teardown in a retry sleep."""
    from grpclib.exceptions import StreamTerminatedError
    from grpclib.utils import Wrapper

    client = MaticHermesClient("192.0.2.1", 16320)
    fake = _client()
    for name in ("async_get_info", "async_get_state", "async_get_floor_plan"):
        setattr(client, name, getattr(fake, name))
    client.async_get_telemetry = fake.async_get_telemetry
    watch_state, watch_collection = client.async_watch_state, client.async_watch
    client.async_watch_state = AsyncMock()
    client.async_watch_poses = AsyncMock()
    client.async_watch = AsyncMock()
    session = await start_session(hass, client)
    on_entry = displayed_mission_handler(client)
    wrapper = Wrapper()
    started = asyncio.Event()
    subscriptions = 0

    async def subscription(*_args):
        nonlocal subscriptions
        subscriptions += 1
        async with client._connection._map_stream_errors("synthetic subscription"):
            with wrapper:
                started.set()
                await asyncio.Event().wait()
            yield None

    class Channel(FakeChannel):
        def close(self) -> None:
            super().close()
            wrapper.cancel(StreamTerminatedError("synthetic closed channel"))
            if watcher == "displayed_mission":
                # HA's cancellation races the close-triggered cancellation.
                # Wrapper replaces both with its saved transport error on the
                # same stack.
                task.cancel("synthetic config entry unload")

    client.async_subscribe_collection_entries = subscription
    client.async_subscribe_state = subscription
    client._connection.supervisor._open = AsyncMock(return_value=Channel())
    session.heartbeat.async_request_refresh = AsyncMock()
    task = asyncio.create_task(
        watch_collection("displayed_mission", on_entry)
        if watcher == "displayed_mission"
        else watch_state(AsyncMock())
    )
    await started.wait()

    await client.async_shutdown()

    await asyncio.wait_for(task, 0.5)
    assert subscriptions == 1
    session.heartbeat.async_request_refresh.assert_not_awaited()
    assert session.floor.value is None


async def test_a_refresh_naming_no_new_mission_keeps_the_floor_generation(
    hass,
) -> None:
    """Only a newly verified mission makes reads already in flight stale."""
    session = await start_session(hass, _client())
    heartbeat = session.heartbeat
    heartbeat.async_request_refresh = AsyncMock()

    await heartbeat.async_request_floor_plan_refresh(42)
    generation = heartbeat.floor_read_generation
    for mission_id in (42, None):
        heartbeat._map_refresh_due = 1.0e9
        await heartbeat.async_request_floor_plan_refresh(mission_id)
        assert heartbeat._map_refresh_due == 0.0

    assert heartbeat.floor_read_generation == generation
    assert heartbeat.async_request_refresh.await_count == 3
