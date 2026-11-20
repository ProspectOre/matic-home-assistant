"""Signed photo links: each opens one photo for a day without signing in."""

from __future__ import annotations

from datetime import timedelta
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from PIL import Image
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.matic_robot import photos
from custom_components.matic_robot.client.snaps import RobotPhoto
from custom_components.matic_robot.llm_camera import _first_photo
from custom_components.matic_robot.photos import (
    MaticRobotPhotoPreviewView,
    MaticRobotPhotoView,
)
from custom_components.matic_robot.service_photos import signed_photo
from tests.test_photo_tours import START, _photo, _saved

FULL = "/api/matic_robot/photo/e/photo-1"
PREVIEW = "/api/matic_robot/photo/e/preview/photo-1"


async def test_signed_links_open_one_photo_for_a_day(
    hass: HomeAssistant,
    hass_client_no_auth: ClientSessionGenerator,
    freezer: FrozenDateTimeFactory,
) -> None:
    assert await async_setup_component(hass, "http", {})
    hass.http.register_view(MaticRobotPhotoView)
    hass.http.register_view(MaticRobotPhotoPreviewView)
    client = await hass_client_no_auth()
    photo = {"photo_id": "photo-1", "url": FULL, "preview_url": PREVIEW}

    signed = signed_photo(hass, photo)
    other = signed["url"].replace("photo-1", "photo-2")

    assert signed["photo_id"] == "photo-1"
    assert signed["url"].startswith(f"{FULL}?authSig=")
    assert signed["preview_url"].startswith(f"{PREVIEW}?authSig=")
    encoded = BytesIO()
    Image.new("RGB", (8, 8)).save(encoded, format="WEBP")
    webp = encoded.getvalue()
    first = RobotPhoto("photo-1", START, webp, webp, 8, 8)
    store = SimpleNamespace(photos=_saved(first, _photo(2)))
    with patch.object(photos, "runtime_for_entry", return_value=store):
        assert (await client.get(FULL)).status == 401
        full = await client.get(signed["url"])
        assert (full.status, await full.read()) == (200, webp)
        assert (await client.get(signed["preview_url"])).status == 200
        # The signature names one path, so it opens no other photo.
        assert (await client.get(other)).status == 401
        freezer.tick(timedelta(hours=24, seconds=1))
        assert (await client.get(signed["url"])).status == 401


def test_assist_gets_the_preview_link_without_its_signature() -> None:
    signed = {
        "photo_id": "photo-1",
        "url": f"{FULL}?authSig=full",
        "preview_url": f"{PREVIEW}?authSig=preview",
    }

    assert _first_photo({"robots": [{"photos": [signed]}]}) == {
        "photo_id": "photo-1",
        "preview_url": PREVIEW,
    }
