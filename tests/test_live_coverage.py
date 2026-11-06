"""Tests for the live native coverage subscription."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import _coverage_context
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.slam_tiles import SlamSemanticTile
from custom_components.matic_robot.coverage_view import (
    MaticLiveCoverageView,
    _coverage_runs,
)
from custom_components.matic_robot.live_coverage import LiveCoverage

from .test_floor_types import _request

MISSION = 0x1234ABCD


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


async def test_unverified_coverage_is_hidden_for_active_run() -> None:
    client = MagicMock()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"session")
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    await coverage._refresh_session()
    assert await coverage.async_current() == ()
    assert coverage.partial is True
    client.async_get_tracked_collection_entries.assert_not_called()
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
    client = MagicMock()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"first")
    coverage = LiveCoverage(client, lambda: context[0])
    await coverage._refresh_session()
    old_generation = coverage.generation
    client.async_get_cleaning_session_identity.return_value = b"second"
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    await coverage._refresh_session()
    assert coverage.generation > old_generation
    assert await coverage.async_current() == ()
    context[0] = (MISSION, "other")
    assert coverage.current() is None


async def test_frame_change_during_session_read_is_discarded() -> None:
    context = [(MISSION, "floor")]
    client = MagicMock()

    async def read_session():
        context[0] = (MISSION, "other")
        return b"session"

    client.async_get_cleaning_session_identity = read_session
    coverage = LiveCoverage(client, lambda: context[0])
    await coverage._refresh_session()
    assert coverage.current() is None


async def test_watcher_fails_closed_on_session_read_failure(monkeypatch) -> None:
    client = MagicMock()
    failed = asyncio.Event()
    calls = 0

    async def read_session():
        nonlocal calls
        calls += 1
        if calls > 1:
            failed.set()
            raise CannotConnectError("offline")
        return b"session"

    client.async_get_cleaning_session_identity = read_session
    coverage = LiveCoverage(client, lambda: (MISSION, "floor"))
    monkeypatch.setattr(
        "custom_components.matic_robot.live_coverage._CHECK_SECONDS", 0.01
    )
    task = asyncio.create_task(coverage.watch())
    try:
        await asyncio.wait_for(failed.wait(), 2)
        assert coverage.current() is None
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


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


async def test_view_requires_and_revalidates_map_session() -> None:
    runtime = SimpleNamespace(
        live_coverage=SimpleNamespace(
            async_current=AsyncMock(return_value=()), revision=1, generation=1
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
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    client.async_get_cleaning_session_identity.return_value = None
    with pytest.raises(CannotConnectError):
        await coverage.async_current()
    client.async_get_cleaning_session_identity.return_value = b"old"
    assert await coverage.async_current() == ()
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


def test_coverage_output_limit_fails_bounded(monkeypatch) -> None:
    monkeypatch.setattr("custom_components.matic_robot.coverage_view._MAX_RUNS", 1)
    cells = bytearray(1024)
    cells[0] = cells[64] = 1
    assert _coverage_runs((SlamSemanticTile(0, 0, "mission", bytes(cells)),))[1]
