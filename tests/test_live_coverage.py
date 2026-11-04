"""Tests for the live native coverage subscription."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.protobuf.message import DecodeError
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import _coverage_context
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.client.slam_tiles import SlamSemanticTile
from custom_components.matic_robot.coverage_view import (
    MaticLiveCoverageView,
    _coverage_runs,
)
from custom_components.matic_robot.live_coverage import LiveCoverage

from .test_floor_types import _request
from .test_slam_map import synthetic_semantic_entry

MISSION = 0x1234ABCD


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


def test_pages_replace_and_delete_by_mission_and_key() -> None:
    coverage = LiveCoverage(MagicMock(), lambda: (MISSION, "floor"))
    page = synthetic_semantic_entry()
    coverage._bound_context = (MISSION, "floor")
    coverage._update(page, MISSION)
    coverage._update(synthetic_semantic_entry(page_x=3), MISSION)
    assert len(coverage.current()) == 2
    coverage._update(page, MISSION)
    assert len(coverage.current()) == 2
    coverage._update(HermesCollectionEntry(page.key, b"", deleted=True), MISSION)
    assert len(coverage.current()) == 1
    coverage._update(page, 7)
    assert len(coverage.current()) == 1
    with pytest.raises(DecodeError):
        coverage._update(HermesCollectionEntry(b"bad", b"", deleted=True), MISSION)


async def test_session_change_discards_pages_and_closes_stream(monkeypatch) -> None:
    context = [(MISSION, "floor")]
    first_page = asyncio.Event()
    closed = asyncio.Event()
    client = MagicMock()
    client.async_get_cleaning_session_identity = AsyncMock(side_effect=[b"one", b"two"])

    async def stream(*_args, **_kwargs):
        try:
            yield synthetic_semantic_entry()
            first_page.set()
            await asyncio.Event().wait()
        finally:
            closed.set()

    client.async_subscribe_collection_entries = stream
    coverage = LiveCoverage(client, lambda: context[0])
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._CHECK_SECONDS", 0.01
    )
    task = asyncio.create_task(coverage.watch())
    try:
        await asyncio.wait_for(first_page.wait(), 1)
        assert len(coverage.current()) == 1
        await asyncio.wait_for(closed.wait(), 1)
        await asyncio.sleep(0)
        assert coverage.current() is None
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_changed_frame_hides_pages_immediately() -> None:
    context = [(MISSION, "floor")]
    coverage = LiveCoverage(MagicMock(), lambda: context[0])
    coverage._bound_context = context[0]
    coverage._update(synthetic_semantic_entry(), MISSION)
    context[0] = (MISSION, "other-floor")
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
        live_coverage=SimpleNamespace(
            async_current=AsyncMock(return_value=()), revision=1, generation=1
        )
    )
    request = _request(runtime)
    view = MaticLiveCoverageView()
    response = await view.get(request, "entry")
    assert response.status == 200
    assert response.headers["Cache-Control"].startswith("private, no-store")
    assert json.loads(response.body)["active"] is True
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


async def test_view_discards_coverage_changed_during_encoding() -> None:
    runtime = SimpleNamespace(
        live_coverage=SimpleNamespace(
            async_current=AsyncMock(return_value=()), revision=1, generation=1
        )
    )
    request = _request(runtime)
    hass = request.app[KEY_HASS]

    async def change_during_encoding(target, *args):
        runtime.live_coverage.revision += 1
        return target(*args)

    hass.async_add_executor_job.side_effect = change_during_encoding
    assert (await MaticLiveCoverageView().get(request, "entry")).status == 409


async def test_view_discards_session_changed_during_encoding() -> None:
    runtime = SimpleNamespace(
        live_coverage=SimpleNamespace(
            async_current=AsyncMock(side_effect=[(), None]), revision=1, generation=1
        )
    )
    assert (await MaticLiveCoverageView().get(_request(runtime), "entry")).status == 503


async def test_view_handles_revalidation_failure_after_encoding() -> None:
    runtime = SimpleNamespace(
        live_coverage=SimpleNamespace(
            async_current=AsyncMock(side_effect=[(), CannotConnectError("offline")]),
            revision=1,
            generation=1,
        )
    )
    assert (await MaticLiveCoverageView().get(_request(runtime), "entry")).status == 503


async def test_async_current_rejects_a_changed_native_session() -> None:
    client = MagicMock()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"new")
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    coverage._bound_context = (MISSION, "floor")
    coverage._session = b"old"
    coverage._update(synthetic_semantic_entry(), MISSION)
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    client.async_get_cleaning_session_identity.return_value = None
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    client.async_get_cleaning_session_identity.return_value = b"old"
    assert len(await coverage.async_current()) == 1
    coverage._clear()
    assert await coverage.async_current() is None


async def test_view_discards_new_valid_session_during_encoding() -> None:
    runtime = SimpleNamespace(
        live_coverage=SimpleNamespace(
            async_current=AsyncMock(return_value=()), revision=1, generation=1
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
        live_coverage=SimpleNamespace(async_current=AsyncMock(return_value=None))
    )
    response = await view.get(_request(inactive), "entry")
    assert json.loads(response.body)["active"] is False
    runtime = SimpleNamespace(
        live_coverage=SimpleNamespace(
            async_current=AsyncMock(side_effect=CannotConnectError("offline"))
        )
    )
    assert (await view.get(_request(runtime), "entry")).status == 503


def test_page_and_output_limits_fail_bounded(monkeypatch) -> None:
    coverage = LiveCoverage(MagicMock(), lambda: (MISSION, "floor"))
    monkeypatch.setattr("custom_components.matic_robot.live_coverage.MAX_SLAM_TILES", 1)
    coverage._update(synthetic_semantic_entry(), MISSION)
    with pytest.raises(DecodeError, match="too many"):
        coverage._update(synthetic_semantic_entry(page_x=3), MISSION)
    monkeypatch.setattr("custom_components.matic_robot.coverage_view._MAX_RUNS", 1)
    cells = bytearray(1024)
    cells[0] = cells[64] = 1
    assert _coverage_runs((SlamSemanticTile(0, 0, "mission", bytes(cells)),))[1]


async def test_stream_end_and_failures_discard_pages(monkeypatch) -> None:
    client = MagicMock()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"session")
    closed = asyncio.Event()

    async def stream(*_args, **_kwargs):
        yield synthetic_semantic_entry()
        closed.set()

    client.async_subscribe_collection_entries = stream
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    await coverage._watch_session((MISSION, "floor"), b"session")
    assert closed.is_set()
    client.async_get_cleaning_session_identity.side_effect = CannotConnectError(
        "offline"
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._RETRY_SECONDS", 0.01
    )
    task = asyncio.create_task(coverage.watch())
    try:
        await asyncio.sleep(0.02)
        assert coverage.current() is None
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_stream_rechecks_session_and_frame_while_waiting(monkeypatch) -> None:
    context = [(MISSION, "floor")]
    client = MagicMock()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"session")
    ready = asyncio.Event()
    queue = asyncio.Queue()

    async def stream(*_args, **_kwargs):
        ready.set()
        yield await queue.get()

    client.async_subscribe_collection_entries = stream
    coverage = LiveCoverage(client, lambda: context[0])
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._CHECK_SECONDS", 0.01
    )
    task = asyncio.create_task(coverage._watch_session(context[0], b"session"))
    await ready.wait()
    await asyncio.sleep(0.02)
    context[0] = (MISSION, "changed")
    await queue.put(synthetic_semantic_entry())
    await task
    assert coverage.current() is None


async def test_cancelling_active_collector_closes_subscription() -> None:
    client = MagicMock()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"session")
    ready = asyncio.Event()
    closed = asyncio.Event()

    async def stream(*_args, **_kwargs):
        try:
            ready.set()
            await asyncio.Event().wait()
            yield synthetic_semantic_entry()
        finally:
            closed.set()

    client.async_subscribe_collection_entries = stream
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    task = asyncio.create_task(coverage.watch())
    await ready.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()


async def test_stream_discards_an_update_that_arrives_after_frame_change() -> None:
    context = [(MISSION, "floor")]
    client = MagicMock()

    async def stream(*_args, **_kwargs):
        context[0] = (MISSION, "other")
        yield synthetic_semantic_entry()

    client.async_subscribe_collection_entries = stream
    coverage = LiveCoverage(client, lambda: context[0])
    await coverage._watch_session((MISSION, "floor"), b"session")
    assert not coverage._pages
