"""Tests for the robot's per-clean map pictures in Cleaning history."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from aiohttp.test_utils import make_mocked_request
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.history import CleaningSessionImage
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.run_history import native_run_id
from custom_components.matic_robot.run_thumbnails import (
    RUN_THUMBNAILS_REREAD_SECONDS,
    MaticRunThumbnailView,
)

KITCHEN = native_run_id(b"kitchen-key")


def _runtime(read: AsyncMock | None = None) -> SimpleNamespace:
    images = (CleaningSessionImage(b"kitchen-key", b"RIFF-webp", 64, 48),)
    return SimpleNamespace(
        client=SimpleNamespace(
            async_get_cleaning_session_images=read or AsyncMock(return_value=images)
        )
    )


def _request(runtime, *, state=ConfigEntryState.LOADED, replaced=None):
    # The view looks the entry up again after its read.
    entries = [
        SimpleNamespace(domain=DOMAIN, state=state, runtime_data=data)
        for data in (runtime, replaced or runtime)
    ]
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(side_effect=entries))
    )
    request = make_mocked_request("GET", "/", app={KEY_HASS: hass})
    request["hass_user"] = SimpleNamespace(is_admin=True)
    return request


async def test_serves_a_clean_picture_and_reads_once() -> None:
    runtime = _runtime()
    view = MaticRunThumbnailView()

    response = await view.get(_request(runtime), "entry", KITCHEN)
    assert response.status == 200
    assert response.content_type == "image/webp"
    assert response.body == b"RIFF-webp"
    assert response.headers["Cache-Control"].startswith("private, no-store")

    assert (await view.get(_request(runtime), "entry", KITCHEN)).status == 200
    runtime.client.async_get_cleaning_session_images.assert_awaited_once()


async def test_a_missing_picture_is_looked_for_again_after_a_minute() -> None:
    runtime = _runtime()
    view = MaticRunThumbnailView()
    missing = native_run_id(b"other")
    read = runtime.client.async_get_cleaning_session_images

    with patch(
        "custom_components.matic_robot.run_thumbnails.monotonic", return_value=100.0
    ):
        assert (await view.get(_request(runtime), "entry", missing)).status == 404
        assert (await view.get(_request(runtime), "entry", missing)).status == 404
    assert read.await_count == 1
    later = 100.0 + RUN_THUMBNAILS_REREAD_SECONDS
    with patch(
        "custom_components.matic_robot.run_thumbnails.monotonic", return_value=later
    ):
        assert (await view.get(_request(runtime), "entry", missing)).status == 404
    assert read.await_count == 2

    view.clear_entry("entry")
    assert (await view.get(_request(runtime), "entry", KITCHEN)).status == 200
    assert read.await_count == 3


async def test_rejects_other_ids_unloaded_entries_and_failed_reads() -> None:
    view = MaticRunThumbnailView()
    runtime = _runtime()
    assert (await view.get(_request(runtime), "entry", "run-1")).status == 404
    unloaded = _request(runtime, state=ConfigEntryState.NOT_LOADED)
    assert (await view.get(unloaded, "entry", KITCHEN)).status == 404
    runtime.client.async_get_cleaning_session_images.assert_not_awaited()

    failing = _runtime(AsyncMock(side_effect=MaticError("busy")))
    assert (await view.get(_request(failing), "entry", KITCHEN)).status == 503
    slow = _runtime(AsyncMock(side_effect=TimeoutError))
    assert (await view.get(_request(slow), "entry", KITCHEN)).status == 503


async def test_a_reload_during_the_read_is_not_cached() -> None:
    view = MaticRunThumbnailView()
    runtime = _runtime()
    request = _request(runtime, replaced=_runtime())
    assert (await view.get(request, "entry", KITCHEN)).status == 404
    assert (await view.get(_request(runtime), "entry", KITCHEN)).status == 200
    assert runtime.client.async_get_cleaning_session_images.await_count == 2
