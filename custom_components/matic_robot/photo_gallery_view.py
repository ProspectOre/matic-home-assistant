"""Matic Map's read of one robot's viewpoints and photo albums."""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .http import PHOTO_GALLERY_API_URL, PRIVATE_NO_STORE_HEADERS, runtime_for_entry
from .photo_library import PhotoRecord
from .photo_tours import photo_preview_url, photo_url
from .slam_view_data import _map_session_key
from .viewpoints import Viewpoint

# The newest photos Matic Map lists; the library itself is bounded by age and
# size, not by count. photo-gallery-data.ts accepts at most this many.
GALLERY_MAX_PHOTOS = 5_000


class MaticPhotoGalleryView(HomeAssistantView):
    """List viewpoints and albums, newest album first, for Matic Map's admins."""

    url = PHOTO_GALLERY_API_URL
    name = "api:matic_robot:photo_gallery"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        albums: dict[str, list[dict[str, Any]]] = {}
        newest = sorted(
            runtime.photos.records, key=lambda record: record.captured_at, reverse=True
        )
        for record in newest[:GALLERY_MAX_PHOTOS]:
            albums.setdefault(record.album, []).append(_photo(entry_id, record))
        map_key = _map_session_key(runtime)
        identity = runtime.slam_map.mission_identity
        return self.json(
            {
                # The map Matic Map shows now: viewpoints and photo poses with
                # this mission ID are drawn on it, the rest are not.
                "map": (
                    None
                    if map_key is None or identity is None
                    else {"map_session_key": map_key, "mission_id": identity.mission_id}
                ),
                "viewpoints": [viewpoint_json(item) for item in runtime.viewpoints.all],
                "albums": [
                    {"album": album, "photos": photos}
                    for album, photos in albums.items()
                ],
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


def viewpoint_json(viewpoint: Viewpoint) -> dict[str, Any]:
    """A viewpoint as Matic Map reads it."""
    return {
        "viewpoint_id": viewpoint.viewpoint_id,
        "name": viewpoint.name,
        "mission_id": viewpoint.mission_id,
        "x": viewpoint.x,
        "y": viewpoint.y,
        "heading": viewpoint.heading,
        "room_id": viewpoint.room_id,
    }


def _photo(entry_id: str, record: PhotoRecord) -> dict[str, Any]:
    place = record.place
    return {
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
        "url": photo_url(entry_id, record.photo_id),
        "preview_url": photo_preview_url(entry_id, record.photo_id),
    }
