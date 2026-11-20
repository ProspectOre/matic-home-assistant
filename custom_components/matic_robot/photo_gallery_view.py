"""Matic Map's read of one robot's viewpoints and photo albums."""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

from aiohttp import web
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .http import PHOTO_GALLERY_API_URL, PRIVATE_NO_STORE_HEADERS, runtime_for_entry
from .photo_library import PhotoRecord
from .photo_tours import photo_preview_url, photo_url
from .viewpoints import Viewpoint


class MaticPhotoGalleryView(HomeAssistantView):
    """List viewpoints and albums, newest album first.

    Only an administrator is given full photo links; everyone else gets the
    pixelated previews.
    """

    url = PHOTO_GALLERY_API_URL
    name = "api:matic_robot:photo_gallery"

    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        admin = request["hass_user"].is_admin
        albums: dict[str, list[dict[str, Any]]] = {}
        for record in sorted(
            runtime.photos.records, key=lambda record: record.captured_at, reverse=True
        ):
            albums.setdefault(record.album, []).append(
                _photo(entry_id, record, full=admin)
            )
        return self.json(
            {
                "viewpoints": [_viewpoint(item) for item in runtime.viewpoints.all],
                "albums": [
                    {"album": album, "photos": photos}
                    for album, photos in albums.items()
                ],
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


def _viewpoint(viewpoint: Viewpoint) -> dict[str, Any]:
    return {
        "viewpoint_id": viewpoint.viewpoint_id,
        "name": viewpoint.name,
        "mission_id": viewpoint.mission_id,
        "x": viewpoint.x,
        "y": viewpoint.y,
        "heading": viewpoint.heading,
        "room_id": viewpoint.room_id,
    }


def _photo(entry_id: str, record: PhotoRecord, *, full: bool) -> dict[str, Any]:
    place = record.place
    photo: dict[str, Any] = {
        "photo_id": record.photo_id,
        "captured_at": record.captured_at.isoformat(),
        "source": record.source.value,
        "starred": record.starred,
        "area": place.area,
        "pose": (
            None
            if place.x is None or place.y is None
            else {
                "x": place.x,
                "y": place.y,
                "heading": place.heading,
                "mission_id": place.mission_id,
            }
        ),
        "preview_url": photo_preview_url(entry_id, record.photo_id),
    }
    if full:
        photo["url"] = photo_url(entry_id, record.photo_id)
    return photo
