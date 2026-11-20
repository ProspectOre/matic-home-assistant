"""Matic Map's list of viewpoints and photo albums."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import photo_gallery_view
from custom_components.matic_robot.photo_gallery_view import MaticPhotoGalleryView
from custom_components.matic_robot.photo_library import (
    PhotoPlace,
    PhotoRecord,
    PhotoSource,
)
from custom_components.matic_robot.viewpoints import Viewpoint

START = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)
STOVE = Viewpoint("vp-1", "Stove", 7, 1.5, 2.0, 0.5, "kitchen")


def _record(number: int, album: str, place: PhotoPlace) -> PhotoRecord:
    return PhotoRecord(
        f"photo-{number}",
        START + timedelta(minutes=number),
        album,
        PhotoSource.HOME_ASSISTANT,
        10,
        "0" * 64,
        True,
        place,
        starred=number == 1,
    )


RECORDS = (
    _record(1, "manual", PhotoPlace("Kitchen", 1.5, 2.0, 0.5, 7)),
    _record(2, "tour-a", PhotoPlace(None)),
    _record(3, "manual", PhotoPlace("Study", 3.0, 1.0, None, 7)),
)


def _photo(number: int, album_place: dict, *, starred: bool = False) -> dict:
    return {
        "photo_id": f"photo-{number}",
        "captured_at": (START + timedelta(minutes=number)).isoformat(),
        "source": "home_assistant",
        "starred": starred,
        **album_place,
        "url": f"/api/matic_robot/photo/e/photo-{number}",
        "preview_url": f"/api/matic_robot/photo/e/preview/photo-{number}",
    }


GALLERY = {
    "viewpoints": [
        {
            "viewpoint_id": "vp-1",
            "name": "Stove",
            "mission_id": 7,
            "x": 1.5,
            "y": 2.0,
            "heading": 0.5,
            "room_id": "kitchen",
        }
    ],
    "albums": [
        {
            "album": "manual",
            "photos": [
                _photo(
                    3,
                    {
                        "area": "Study",
                        "pose": {"x": 3.0, "y": 1.0, "heading": None, "mission_id": 7},
                    },
                ),
                _photo(
                    1,
                    {
                        "area": "Kitchen",
                        "pose": {"x": 1.5, "y": 2.0, "heading": 0.5, "mission_id": 7},
                    },
                    starred=True,
                ),
            ],
        },
        {"album": "tour-a", "photos": [_photo(2, {"area": None, "pose": None})]},
    ],
}


class _Request(dict):
    def __init__(self, **values: object) -> None:
        super().__init__(values)
        self.app = {KEY_HASS: object()}


async def test_lists_viewpoints_and_albums_newest_first() -> None:
    runtime = SimpleNamespace(
        photos=SimpleNamespace(records=RECORDS),
        viewpoints=SimpleNamespace(all=(STOVE,)),
    )
    request = _Request(hass_user=SimpleNamespace(is_admin=True))
    with patch.object(photo_gallery_view, "runtime_for_entry", return_value=runtime):
        response = await MaticPhotoGalleryView().get(request, "e")

    assert json.loads(response.body) == GALLERY
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"


async def test_only_an_administrator_reads_the_gallery() -> None:
    request = _Request(hass_user=SimpleNamespace(is_admin=False))
    with pytest.raises(Unauthorized):
        await MaticPhotoGalleryView().get(request, "e")


async def test_an_unloaded_robot_has_no_gallery() -> None:
    request = _Request(hass_user=SimpleNamespace(is_admin=True))
    with patch.object(photo_gallery_view, "runtime_for_entry", return_value=None):
        response = await MaticPhotoGalleryView().get(request, "e")

    assert response.status == 404
    assert MaticPhotoGalleryView.requires_auth is True
