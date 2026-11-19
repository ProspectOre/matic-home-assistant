"""The signed-in views that serve saved photos and their pixelated previews."""

from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from homeassistant.helpers.http import KEY_HASS
from PIL import Image

from custom_components.matic_robot import photos
from custom_components.matic_robot.client.snaps import RobotPhoto
from custom_components.matic_robot.photos import (
    MaticRobotPhotoPreviewView,
    MaticRobotPhotoView,
)
from tests.test_photo_patrol import START, _photo, _saved


async def test_photo_view_serves_recent_photos_privately() -> None:
    store = _saved(_photo(1))
    hass = object()
    request = SimpleNamespace(app={KEY_HASS: hass})
    view = MaticRobotPhotoView()

    with patch.object(
        photos, "runtime_for_entry", return_value=SimpleNamespace(photos=store)
    ) as runtime:
        found = await view.get(request, "e", "photo-1")
        missing = await view.get(request, "e", "photo-2")
    runtime.assert_called_with(hass, "e")
    with patch.object(photos, "runtime_for_entry", return_value=None):
        unloaded = await view.get(request, "e", "photo-1")

    assert view.url == "/api/matic_robot/photo/{entry_id}/{photo_id}"
    assert view.requires_auth is True
    assert found.status == 200
    assert found.body == b"image-1"
    assert found.content_type == "image/webp"
    assert found.headers["Cache-Control"] == "private, no-store, max-age=0"
    assert (missing.status, unloaded.status) == (404, 404)
    assert missing.headers["Cache-Control"] == "private, no-store, max-age=0"


async def test_photo_view_routes_colliding_ids_to_the_requested_robot() -> None:
    """A shared photo ID cannot make one robot's image visible through another."""
    stores = {}
    for entry_id, image in (
        ("robot-east", b"east-image"),
        ("robot-west", b"west-image"),
        ("robot-upper", b"upper-image"),
    ):
        store = _saved(RobotPhoto("same-photo-id", START, image, None, 4, 3))
        stores[entry_id] = SimpleNamespace(photos=store)

    hass = object()
    request = SimpleNamespace(app={KEY_HASS: hass})
    view = MaticRobotPhotoView()
    with patch.object(
        photos,
        "runtime_for_entry",
        side_effect=lambda _hass, entry_id: stores.get(entry_id),
    ):
        responses = {
            entry_id: await view.get(request, entry_id, "same-photo-id")
            for entry_id in stores
        }
        unknown_entry = await view.get(request, "unloaded-robot", "same-photo-id")

    assert {entry_id: response.body for entry_id, response in responses.items()} == {
        "robot-east": b"east-image",
        "robot-west": b"west-image",
        "robot-upper": b"upper-image",
    }
    assert all(response.status == 200 for response in responses.values())
    assert unknown_entry.status == 404


async def test_photo_preview_is_pixelated_private_webp_without_full_fallback() -> None:
    encoded = BytesIO()
    image = Image.new("RGB", (96, 96))
    pixels = image.load()
    for y in range(96):
        for x in range(96):
            pixels[x, y] = (
                (x * 31) % 256,
                (y * 29) % 256,
                ((x + y) * 23) % 256,
            )
    image.save(encoded, format="WEBP", quality=100)
    original = encoded.getvalue()
    photo = RobotPhoto("preview", START, original, original, 96, 96)
    store = _saved(photo)

    async def run_in_executor(function, *args):
        return function(*args)

    hass = SimpleNamespace(
        async_add_executor_job=AsyncMock(side_effect=run_in_executor)
    )
    request = SimpleNamespace(app={KEY_HASS: hass})
    view = MaticRobotPhotoPreviewView()

    with patch.object(
        photos, "runtime_for_entry", return_value=SimpleNamespace(photos=store)
    ):
        found = await view.get(request, "e", "preview")
        missing = await view.get(request, "e", "missing")
    with patch.object(photos, "runtime_for_entry", return_value=None):
        unloaded = await view.get(request, "e", "preview")

    assert view.url == "/api/matic_robot/photo/{entry_id}/preview/{photo_id}"
    assert view.requires_auth is True
    assert found.status == 200
    assert found.body != original
    assert found.content_type == "image/webp"
    with Image.open(BytesIO(found.body)) as preview:
        assert preview.size == (96, 96)
    assert len(preview.getcolors(maxcolors=100_000) or []) < 1000
    assert (missing.status, unloaded.status) == (404, 404)
    assert found.headers["Cache-Control"] == "private, no-store, max-age=0"

    invalid_store = _saved(_photo(1))
    with patch.object(
        photos, "runtime_for_entry", return_value=SimpleNamespace(photos=invalid_store)
    ):
        invalid = await view.get(request, "e", "photo-1")
    assert invalid.status == 422
    assert invalid.body != b"image-1"
    assert hass.async_add_executor_job.await_count == 2
    assert [call.args for call in hass.async_add_executor_job.await_args_list] == [
        (photos._pixelated_preview, original),
        (photos._pixelated_preview, b"image-1"),
    ]
