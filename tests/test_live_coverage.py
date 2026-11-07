"""Tests for the live native coverage subscription."""

import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import _coverage_context
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.client.slam_tiles import SlamSemanticTile
from custom_components.matic_robot.coverage_changes import CoverageChanges
from custom_components.matic_robot.coverage_view import (
    MaticLiveCoverageView,
    _coverage_runs,
)
from custom_components.matic_robot.live_coverage import LiveCoverage

from .test_coverage_receipts import active_key
from .test_floor_types import _request
from .test_slam_map import synthetic_semantic_entry

MISSION = 42


class _CoverageStub(SimpleNamespace):
    __hash__ = object.__hash__
    withdrawal_revision = 0


def _client():
    client = MagicMock()
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=True)
    return client


def _page_entry(
    cells: bytes,
    *,
    sequence: int | None,
    epoch: int = 10,
    mission_id: int = MISSION,
) -> HermesCollectionEntry:
    entry = synthetic_semantic_entry(mission_id=mission_id, cells=cells)
    return replace(entry, sequence_start_ns=epoch, sequence_no=sequence)


def _marker(session: bytes, *, epoch: int = 10, sequence: int = 1):
    return HermesCollectionEntry(b"active", session, epoch, sequence)


@pytest.fixture(autouse=True)
def _view_map_key(monkeypatch) -> None:
    monkeypatch.setattr(
        "custom_components.matic_robot.coverage_view._map_session_key",
        lambda runtime: getattr(runtime, "test_map_key", "a" * 64),
    )


def test_coverage_requires_active_session_and_verified_current_frame() -> None:
    floor = SimpleNamespace(mission_id=MISSION)
    data = SimpleNamespace(
        telemetry=SimpleNamespace(active_cleaning_session=True), floor_plan=floor
    )
    runtime = SimpleNamespace(
        coordinator=SimpleNamespace(data=data),
        slam_map=SimpleNamespace(floor_plan_is_current=MagicMock(return_value=True)),
    )
    with patch(
        "custom_components.matic_robot._pose_frame_key", return_value=("id", "key", 1)
    ):
        assert _coverage_context(runtime) == (MISSION, ("id", "key", 1))
        data.telemetry.active_cleaning_session = False
        assert _coverage_context(runtime) is None
        data.telemetry.active_cleaning_session = True
        runtime.slam_map.floor_plan_is_current.return_value = False
        assert _coverage_context(runtime) is None
        runtime.slam_map.floor_plan_is_current.return_value = True
        floor.mission_id = None
        assert _coverage_context(runtime) is None
        data.floor_plan = None
        assert _coverage_context(runtime) is None
    data.floor_plan = floor
    floor.mission_id = MISSION
    with patch(
        "custom_components.matic_robot._pose_frame_key", return_value=("id", None, 1)
    ):
        assert _coverage_context(runtime) is None


async def test_missing_marker_keeps_active_coverage_hidden(monkeypatch) -> None:
    client = _client()
    session = active_key()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    client.async_get_tracked_collection_entries = AsyncMock(return_value=())
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._RETRY_SECONDS", 0.001
    )
    await coverage._watch_session((MISSION, "floor"), session)
    assert coverage.current() == ()
    assert coverage.partial is True
    assert coverage.ownership_unverified is True
    client.async_subscribe_collection_entries.assert_not_called()

    runtime = SimpleNamespace(live_coverage=coverage)
    response = await MaticLiveCoverageView().get(_request(runtime), "entry")
    payload = json.loads(response.body)
    assert payload["active"] is True
    assert payload["runs"] == []
    assert payload["truncated"] is True
    assert payload["ownership_unverified"] is True


async def test_session_or_frame_change_immediately_hides_coverage() -> None:
    context = [(MISSION, "floor")]
    client = _client()
    session = active_key()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    coverage = LiveCoverage(client, lambda: context[0])
    coverage._bound_context = context[0]
    coverage._session = session
    coverage._changes = CoverageChanges(MISSION, 10, 1)
    old_generation = coverage.generation
    client.async_get_cleaning_session_identity.return_value = active_key(UUID(int=5))
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    assert coverage.generation > old_generation
    assert coverage._changes is None
    context[0] = (MISSION, "other")
    assert coverage.current() is None


async def test_frame_change_during_session_read_is_discarded() -> None:
    context = [(MISSION, "floor")]
    client = _client()

    async def read_session():
        context[0] = (MISSION, "other")
        return active_key()

    client.async_get_cleaning_session_identity = read_session
    coverage = LiveCoverage(client, lambda: context[0])
    session = active_key()
    coverage._bound_context = (MISSION, "floor")
    coverage._session = session
    coverage._changes = CoverageChanges(MISSION, 10, 1)
    assert await coverage.async_current() is None
    assert coverage.current() is None


async def test_watcher_fails_closed_on_session_read_failure(monkeypatch) -> None:
    client = _client()
    failed = asyncio.Event()
    calls = 0
    session = active_key()

    async def read_session():
        nonlocal calls
        calls += 1
        if calls > 1:
            failed.set()
            raise CannotConnectError("offline")
        return session

    async def updates():
        await asyncio.Event().wait()
        yield  # pragma: no cover

    client.async_get_cleaning_session_identity = read_session
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=[_marker(session)]
    )
    client.async_subscribe_collection_entries = MagicMock(return_value=updates())
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._CHECK_SECONDS", 0.001
    )
    task = asyncio.create_task(coverage.watch())
    try:
        await asyncio.wait_for(failed.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert coverage.current() is None
    finally:
        if not task.done():
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task


async def test_watcher_tracks_only_post_marker_changes(monkeypatch) -> None:
    session = active_key()
    baseline = bytearray(1024)
    baseline[0] = 1
    changed = bytearray(baseline)
    changed[1] = 1

    async def updates():
        yield _page_entry(bytes(baseline), sequence=2)
        yield _page_entry(bytes(changed), sequence=3)

    client = _client()
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=[_marker(session)]
    )
    client.async_subscribe_collection_entries = MagicMock(return_value=updates())
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._CHECK_SECONDS", 60
    )

    await coverage._watch_session((MISSION, "floor"), session)

    assert coverage.partial is True
    assert coverage.ownership_unverified is False
    assert coverage.current()[0].cells[0] == 0
    assert coverage.current()[0].cells[1] == 1
    client.async_subscribe_collection_entries.assert_called_once_with(
        "map_combined_coverage", include_deletions=True
    )


async def test_marker_read_racing_frame_change_never_subscribes() -> None:
    session = active_key()
    context = [(MISSION, "floor")]
    client = _client()

    async def read_marker(*args, **kwargs):
        context[0] = (MISSION, "new-floor")
        return [_marker(session)]

    client.async_get_tracked_collection_entries = read_marker
    client.async_subscribe_collection_entries = MagicMock()
    coverage = LiveCoverage(client, lambda: context[0])

    await coverage._watch_session((MISSION, "floor"), session)

    assert coverage.current() is None
    client.async_subscribe_collection_entries.assert_not_called()


async def test_cancelled_watcher_clears_session_and_page_stream(monkeypatch) -> None:
    session = active_key()
    closed = asyncio.Event()
    started = asyncio.Event()

    async def updates():
        try:
            started.set()
            await asyncio.Event().wait()
            yield  # pragma: no cover
        finally:
            closed.set()

    client = _client()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=[_marker(session)]
    )
    client.async_subscribe_collection_entries = MagicMock(return_value=updates())
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    task = asyncio.create_task(coverage.watch())
    await asyncio.wait_for(started.wait(), 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()
    assert coverage.current() is None


def test_coverage_runs_keep_modes_and_column_major_cell_positions() -> None:
    cells = bytearray(1024)
    cells[2 * 32 + 3] = 1
    cells[3 * 32 + 3] = 2
    cells[4 * 32 + 3] = 0x10
    cells[5 * 32 + 3] = 0x11
    page = SlamSemanticTile(1, -1, "mission", bytes(cells))

    runs, truncated = _coverage_runs((page,))

    assert runs == [[34, -29, 2, 1], [36, -29, 1, 2], [37, -29, 1, 3]]
    assert truncated is False


async def test_view_requires_admin_and_revalidates_entry() -> None:
    runtime = SimpleNamespace(
        live_coverage=_CoverageStub(
            async_current=AsyncMock(return_value=()),
            revision=1,
            generation=1,
            ownership_unverified=False,
        )
    )
    request = _request(runtime)
    view = MaticLiveCoverageView()
    response = await view.get(request, "entry")
    assert response.status == 200
    assert response.headers["Cache-Control"].startswith("private, no-store")
    assert json.loads(response.body)["active"] is True
    assert json.loads(response.body)["map_session_key"] == "a" * 64
    runtime.live_coverage.partial = True
    assert json.loads((await view.get(request, "entry")).body)["truncated"] is True
    request["hass_user"] = SimpleNamespace(is_admin=False)
    with pytest.raises(Unauthorized):
        await view.get(request, "entry")

    request["hass_user"] = SimpleNamespace(is_admin=True)
    hass = request.app[KEY_HASS]

    async def replace_runtime():
        hass.config_entries.async_get_entry.return_value.runtime_data = object()
        return ()

    runtime.live_coverage.async_current.side_effect = replace_runtime
    assert (await view.get(request, "entry")).status == 503


@pytest.mark.parametrize("update_during", ["encoding", "session_read"])
async def test_view_returns_snapshot_while_coverage_keeps_changing(
    update_during,
) -> None:
    first = SlamSemanticTile(0, 0, "mission", b"\x01" + bytes(1023))
    newer = SlamSemanticTile(0, 0, "mission", b"\x01\x10" + bytes(1022))
    runtime = SimpleNamespace(
        live_coverage=_CoverageStub(
            revision=1,
            generation=1,
            ownership_unverified=False,
        )
    )
    reads = 0

    async def current():
        nonlocal reads
        reads += 1
        if reads == 1:
            return (first,)
        if update_during == "session_read":
            runtime.live_coverage.revision += 1
        return (newer,)

    runtime.live_coverage.async_current = current
    request = _request(runtime)
    hass = request.app[KEY_HASS]

    async def change_during_encoding(target, *args):
        if update_during == "encoding":
            runtime.live_coverage.revision += 1
        return target(*args)

    hass.async_add_executor_job.side_effect = change_during_encoding
    response = await MaticLiveCoverageView().get(request, "entry")
    assert response.status == 200
    assert json.loads(response.body)["runs"] == [[0, 0, 1, 1]]
    assert json.loads(response.body)["coverage_basis"] == "observed_changes"
    assert runtime.live_coverage.revision == 2
    assert reads == 2


async def test_view_requires_and_revalidates_map_session() -> None:
    runtime = SimpleNamespace(
        live_coverage=_CoverageStub(
            async_current=AsyncMock(return_value=()),
            revision=1,
            generation=1,
            ownership_unverified=False,
        ),
        test_map_key=None,
    )
    request = _request(runtime)
    view = MaticLiveCoverageView()
    assert (await view.get(request, "entry")).status == 503
    runtime.test_map_key = "a" * 64

    async def change_map(target, *args):
        runtime.test_map_key = "b" * 64
        return target(*args)

    request.app[KEY_HASS].async_add_executor_job.side_effect = change_map
    assert (await view.get(request, "entry")).status == 503


async def test_view_discards_session_changed_during_encoding() -> None:
    runtime = SimpleNamespace(
        live_coverage=_CoverageStub(
            async_current=AsyncMock(side_effect=[(), None]),
            revision=1,
            generation=1,
            ownership_unverified=False,
        )
    )
    assert (await MaticLiveCoverageView().get(_request(runtime), "entry")).status == 503


async def test_view_handles_revalidation_failure_after_encoding() -> None:
    runtime = SimpleNamespace(
        live_coverage=_CoverageStub(
            async_current=AsyncMock(side_effect=[(), CannotConnectError("offline")]),
            revision=1,
            generation=1,
            ownership_unverified=False,
        )
    )
    assert (await MaticLiveCoverageView().get(_request(runtime), "entry")).status == 503


async def test_async_current_rejects_a_changed_native_session() -> None:
    client = _client()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"new")
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = b"old"
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    client.async_get_cleaning_session_identity.return_value = None
    assert await coverage.async_current() is None
    client.async_get_cleaning_session_identity.return_value = b"old"
    assert await coverage.async_current() is None
    coverage._clear()
    assert await coverage.async_current() is None


async def test_view_discards_new_valid_session_during_encoding() -> None:
    runtime = SimpleNamespace(
        live_coverage=_CoverageStub(
            async_current=AsyncMock(return_value=()),
            revision=1,
            generation=1,
            ownership_unverified=False,
        )
    )
    request = _request(runtime)

    async def switch_session(target, *args):
        runtime.live_coverage.generation += 1
        runtime.live_coverage.revision += 1
        return target(*args)

    request.app[KEY_HASS].async_add_executor_job.side_effect = switch_session
    assert (await MaticLiveCoverageView().get(request, "entry")).status == 503


async def test_view_handles_unavailable_or_unloaded_coverage() -> None:
    view = MaticLiveCoverageView()
    assert (await view.get(_request(None), "entry")).status == 404
    inactive = SimpleNamespace(
        live_coverage=_CoverageStub(async_current=AsyncMock(return_value=None))
    )
    response = await view.get(_request(inactive), "entry")
    assert json.loads(response.body)["active"] is False
    runtime = SimpleNamespace(
        live_coverage=_CoverageStub(
            async_current=AsyncMock(side_effect=CannotConnectError("offline"))
        )
    )
    assert (await view.get(_request(runtime), "entry")).status == 503


def test_coverage_output_limit_fails_bounded(monkeypatch) -> None:
    monkeypatch.setattr("custom_components.matic_robot.coverage_view._MAX_RUNS", 1)
    cells = bytearray(1024)
    cells[0] = cells[64] = 1
    assert _coverage_runs((SlamSemanticTile(0, 0, "mission", bytes(cells)),))[1]


async def test_quiet_stream_rechecks_identity_until_run_changes(monkeypatch) -> None:
    session = active_key()
    client = _client()
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=[_marker(session)]
    )
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[session, active_key(UUID(int=2))]
    )

    async def updates():
        await asyncio.Event().wait()
        yield

    client.async_subscribe_collection_entries.return_value = updates()
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._CHECK_SECONDS", 0.005
    )
    await asyncio.wait_for(coverage._watch_session((MISSION, "floor"), session), 2)
    assert client.async_get_cleaning_session_identity.await_count == 2


async def test_frame_changes_while_next_page_is_in_flight() -> None:
    session = active_key()
    client = _client()
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=[_marker(session)]
    )
    context = [(MISSION, "floor")]

    async def updates():
        context[0] = (MISSION, "new-floor")
        yield _page_entry(bytes(1024), sequence=2)

    client.async_subscribe_collection_entries.return_value = updates()
    coverage = LiveCoverage(client, lambda: context[0])
    await asyncio.wait_for(coverage._watch_session(context[0], session), 2)
    assert coverage.current() is None


async def test_reconnect_establishes_new_baselines_after_sequence_failure(
    monkeypatch,
) -> None:
    session = active_key()
    client = _client()
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=[_marker(session)]
    )
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    ready = asyncio.Event()
    vacuum = b"\x01" + bytes(1023)

    async def first_stream():
        yield _page_entry(bytes(1024), sequence=2)
        yield _page_entry(vacuum, sequence=3)
        yield _page_entry(vacuum, sequence=4, epoch=9)

    async def second_stream():
        yield HermesCollectionEntry(b"invalid-key", b"", 10, 4)
        yield _page_entry(vacuum, sequence=5)
        yield _page_entry(b"\x11" + bytes(1023), sequence=6)
        ready.set()
        await asyncio.Event().wait()

    client.async_subscribe_collection_entries.side_effect = [
        first_stream(),
        second_stream(),
    ]
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._RETRY_SECONDS", 0.001
    )
    task = asyncio.create_task(coverage.watch())
    try:
        await asyncio.wait_for(ready.wait(), 2)
        runtime = SimpleNamespace(live_coverage=coverage)
        response = await MaticLiveCoverageView().get(_request(runtime), "entry")
        payload = json.loads(response.body)
        assert payload["coverage_basis"] == "observed_changes"
        assert payload["truncated"] is True
        assert payload["runs"] == [[64, -32, 1, 2]]
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 2)


@pytest.mark.parametrize("active", [False, None])
async def test_retained_session_cannot_serve_coverage_after_native_task_ends(active):
    client = _client()
    session = active_key()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    client.async_get_active_cleaning_session_state.return_value = active
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = session
    coverage._changes = CoverageChanges(MISSION, 10, 1)
    coverage._changes.update(_page_entry(bytes(1024), sequence=2))
    coverage._changes.update(_page_entry(bytes([1]) + bytes(1023), sequence=3))
    assert coverage.current()[0].cells[0] == 1  # Coordinator still says active.
    assert await coverage.async_current() is None
    runtime = SimpleNamespace(live_coverage=coverage)
    response = await MaticLiveCoverageView().get(_request(runtime), "entry")
    assert json.loads(response.body)["active"] is False
    assert json.loads(response.body)["runs"] == []


async def test_frame_change_during_native_activity_read_cannot_serve_old_pages():
    context = [(MISSION, "floor")]
    client = _client()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=active_key())
    coverage = LiveCoverage(client, lambda: context[0])
    coverage._bound_context = context[0]
    coverage._session = active_key()

    async def activity():
        context[0] = (MISSION, "other-floor")
        return True

    client.async_get_active_cleaning_session_state = activity
    assert await coverage.async_current() is None


async def test_watcher_discards_retained_session_baseline_after_native_task_end(
    monkeypatch,
):
    client = _client()
    session = active_key()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=[_marker(session)]
    )
    inactive = asyncio.Event()
    closed = asyncio.Event()
    reads = 0

    async def activity():
        nonlocal reads
        reads += 1
        if reads == 1:
            return True
        inactive.set()
        return False

    async def updates():
        try:
            yield _page_entry(bytes(1024), sequence=2)
            yield _page_entry(bytes([1]) + bytes(1023), sequence=3)
            await asyncio.Event().wait()
        finally:
            closed.set()

    client.async_get_active_cleaning_session_state = activity
    client.async_subscribe_collection_entries = MagicMock(return_value=updates())
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))  # Stale coordinator.
    cleared = asyncio.Event()
    clear = coverage._clear

    def observe_clear():
        clear()
        cleared.set()

    monkeypatch.setattr(coverage, "_clear", observe_clear)
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._CHECK_SECONDS", 0.01
    )
    task = asyncio.create_task(coverage.watch())
    try:
        await asyncio.wait_for(inactive.wait(), 2)
        await asyncio.wait_for(closed.wait(), 2)
        await asyncio.wait_for(cleared.wait(), 2)
        assert coverage.current() is None
        assert coverage._changes is None
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_activity_from_next_run_cannot_validate_previous_coverage():
    client = _client()
    previous = active_key()
    following = active_key(UUID(int=8))
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[previous, following]
    )
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = previous
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    client.async_get_active_cleaning_session_state.assert_awaited_once()
    assert client.async_get_cleaning_session_identity.await_count == 2


async def test_watcher_does_not_bind_a_task_that_changed_during_activity_read(
    monkeypatch,
):
    client = _client()
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[active_key(), active_key(UUID(int=8))]
    )
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))

    async def end_iteration(_delay):
        raise asyncio.CancelledError

    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage.asyncio.sleep", end_iteration
    )
    with pytest.raises(asyncio.CancelledError):
        await coverage.watch()
    client.async_subscribe_collection_entries.assert_not_called()
    assert coverage.current() is None


async def test_watcher_closes_when_next_task_activity_follows_previous_identity(
    monkeypatch,
):
    client = _client()
    session = active_key()
    # Startup and one periodic check agree; the next check straddles a new run.
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[
            session,
            session,
            session,
            session,
            session,
            active_key(UUID(int=8)),
        ]
    )
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=[_marker(session)]
    )
    closed = asyncio.Event()
    cleared = asyncio.Event()

    async def updates():
        try:
            yield _page_entry(bytes(1024), sequence=2)
            await asyncio.Event().wait()
        finally:
            closed.set()

    client.async_subscribe_collection_entries = MagicMock(return_value=updates())
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    clear = coverage._clear

    def observe_clear():
        clear()
        cleared.set()

    monkeypatch.setattr(coverage, "_clear", observe_clear)
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._CHECK_SECONDS", 0.01
    )
    task = asyncio.create_task(coverage.watch())
    try:
        await asyncio.wait_for(cleared.wait(), 2)
        assert closed.is_set()
        assert coverage.current() is None
        assert coverage._changes is None
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.parametrize("failure", [None, b"other", "activity", "confirmation"])
async def test_failed_proof_discards_owned_baseline_without_resurrection(failure):
    client = _client()
    session = active_key()
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = session
    coverage._changes = CoverageChanges(MISSION, 10, 1)
    coverage._changes.update(_page_entry(bytes(1024), sequence=2))
    coverage._changes.update(_page_entry(b"\x01" + bytes(1023), sequence=3))
    assert coverage.current()
    generation = coverage.generation
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    if failure == "activity":
        client.async_get_active_cleaning_session_state.side_effect = CannotConnectError(
            "offline"
        )
    elif failure == "confirmation":
        client.async_get_cleaning_session_identity.side_effect = [session, None]
    else:
        client.async_get_cleaning_session_identity.return_value = failure
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    assert coverage.generation > generation
    assert coverage._changes is None
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=True)
    assert await coverage.async_current() is None


async def test_old_proof_does_not_clear_new_watcher_baseline():
    client = _client()
    session = active_key()
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = session
    newer = CoverageChanges(MISSION, 11, 1)

    async def rebind():
        coverage.generation += 1
        coverage._changes = newer
        return session

    client.async_get_cleaning_session_identity = AsyncMock(side_effect=rebind)
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    assert coverage._changes is newer
    assert coverage._bound_context == (MISSION, "floor")


async def test_frame_loss_before_proof_discards_baseline():
    context = [(MISSION, "floor")]
    coverage = LiveCoverage(_client(), lambda: context[0])
    coverage._bound_context = context[0]
    coverage._session = active_key()
    coverage._changes = CoverageChanges(MISSION, 10, 1)
    context[0] = None
    assert await coverage.async_current() is None
    assert coverage._changes is None
    context[0] = (MISSION, "floor")
    assert await coverage.async_current() is None


async def test_proof_delivery_rechecks_generation():
    client = _client()
    session = active_key()
    entered, release = asyncio.Event(), asyncio.Event()

    async def identity():
        entered.set()
        await release.wait()
        return session

    client.async_get_cleaning_session_identity = identity
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = session
    reading = asyncio.create_task(coverage.async_current())
    await entered.wait()
    coverage._proof_task.add_done_callback(lambda _: coverage._clear())
    release.set()
    with pytest.raises(CannotConnectError):
        await reading


async def test_concurrent_viewers_share_proofs_and_revision_encoding():
    client = _client()
    session = active_key()
    entered, release = asyncio.Event(), asyncio.Event()

    async def identity():
        entered.set()
        await release.wait()
        return session

    client.async_get_cleaning_session_identity = AsyncMock(side_effect=identity)
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = session
    coverage._changes = CoverageChanges(MISSION, 10, 1)
    coverage._changes.update(_page_entry(bytes(1024), sequence=2))
    coverage._changes.update(_page_entry(b"\x01" + bytes(1023), sequence=3))
    request = _request(SimpleNamespace(live_coverage=coverage))
    view = MaticLiveCoverageView()
    viewers = [asyncio.create_task(view.get(request, "entry")) for _ in range(12)]
    await entered.wait()
    assert client.async_get_cleaning_session_identity.await_count == 1
    release.set()
    responses = await asyncio.gather(*viewers)
    assert all(response.status == 200 for response in responses)
    assert client.async_get_cleaning_session_identity.await_count == 4
    assert client.async_get_active_cleaning_session_state.await_count == 2
    encoder = request.app[KEY_HASS].async_add_executor_job
    assert encoder.await_count == 1
    assert (await view.get(request, "entry")).status == 200
    assert encoder.await_count == 1
    coverage._changes.update(_page_entry(b"\x01\x10" + bytes(1022), sequence=4))
    coverage.revision += 1
    response = await view.get(request, "entry")
    assert response.status == 200
    assert len(json.loads(response.body)["runs"]) == 2
    assert encoder.await_count == 2


async def test_cancelled_viewer_does_not_cancel_shared_proof():
    client = _client()
    session = active_key()
    entered, release = asyncio.Event(), asyncio.Event()

    async def identity():
        entered.set()
        await release.wait()
        return session

    client.async_get_cleaning_session_identity = AsyncMock(side_effect=identity)
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = session
    first = asyncio.create_task(coverage.async_current())
    second = asyncio.create_task(coverage.async_current())
    await entered.wait()
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    assert await second == ()
    assert client.async_get_cleaning_session_identity.await_count == 2


@pytest.mark.parametrize("removed", ["page", "mode"])
@pytest.mark.parametrize("during", ["encoding", "final_proof"])
async def test_withdrawn_coverage_cannot_reappear_from_inflight_snapshot(
    removed, during
):
    client = _client()
    session = active_key()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=session)
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = session
    coverage._changes = CoverageChanges(MISSION, 10, 1)
    coverage._changes.update(_page_entry(bytes(1024), sequence=2))
    coverage._changes.update(_page_entry(b"\x11" + bytes(1023), sequence=3))
    assert coverage.withdrawal_revision == 0
    request = _request(SimpleNamespace(live_coverage=coverage))
    view = MaticLiveCoverageView()
    withdrawn = False

    def withdraw():
        nonlocal withdrawn
        if withdrawn:
            return
        withdrawn = True
        entry = _page_entry(b"\x01" + bytes(1023), sequence=4)
        if removed == "page":
            entry = replace(entry, deleted=True)
        assert coverage._changes.update(entry)
        coverage.revision += 1

    async def encode(target, *args):
        if during == "encoding":
            withdraw()
        return target(*args)

    activity_reads = 0

    async def active():
        nonlocal activity_reads
        activity_reads += 1
        if during == "final_proof" and activity_reads == 2:
            withdraw()
        return True

    request.app[KEY_HASS].async_add_executor_job.side_effect = encode
    client.async_get_active_cleaning_session_state.side_effect = active
    assert (await view.get(request, "entry")).status == 503
    assert coverage.withdrawal_revision == 1
    response = await view.get(request, "entry")
    assert response.status == 200
    runs = json.loads(response.body)["runs"]
    assert runs == ([] if removed == "page" else [[64, -32, 1, 1]])
