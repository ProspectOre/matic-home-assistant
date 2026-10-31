"""Serve the robot's own map picture of a clean to Cleaning history.

The robot keeps a WebP map for each clean in its retained history, keyed like
the history record. One read returns all of them, so the pictures are kept
per robot within a byte budget. Evicted pictures are read again on demand.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from http import HTTPStatus
from time import monotonic

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .client.exceptions import MaticError
from .run_history import native_run_id
from .slam_scene import PRIVATE_NO_STORE_HEADERS, _runtime_for_entry

RUN_THUMBNAIL_API_URL = "/api/matic_robot/run_thumbnail/{entry_id}/{run_id}"
RUN_THUMBNAILS_READ_SECONDS = 20.0
# A missing picture is looked for again at most this often.
RUN_THUMBNAILS_REREAD_SECONDS = 60.0
RUN_THUMBNAILS_CACHE_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class _CachedThumbnails:
    read_at: float
    images: dict[str, bytes]
    known_ids: frozenset[str]


class MaticRunThumbnailView(HomeAssistantView):
    """Return one clean's map picture, or 404 when the robot has none."""

    url = RUN_THUMBNAIL_API_URL
    name = "api:matic_robot:run_thumbnail"

    def __init__(self) -> None:
        self._cache: dict[str, _CachedThumbnails] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def clear_entry(self, entry_id: str) -> None:
        """Forget pictures retained for one robot."""
        self._cache.pop(entry_id, None)
        self._locks.pop(entry_id, None)

    @require_admin
    async def get(
        self, request: web.Request, entry_id: str, run_id: str
    ) -> web.Response:
        """Return the WebP picture for a robot history id."""
        runtime = _runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None or not run_id.startswith("robot-"):
            return _not_found()
        async with self._locks.setdefault(entry_id, asyncio.Lock()):
            cached = self._cache.get(entry_id)
            if cached is None or (
                run_id not in cached.images
                and (
                    run_id in cached.known_ids
                    or monotonic() >= cached.read_at + RUN_THUMBNAILS_REREAD_SECONDS
                )
            ):
                try:
                    async with asyncio.timeout(RUN_THUMBNAILS_READ_SECONDS):
                        images = (
                            await runtime.client.async_get_cleaning_session_images()
                        )
                except MaticError, TimeoutError:
                    return web.Response(
                        status=HTTPStatus.SERVICE_UNAVAILABLE,
                        headers=PRIVATE_NO_STORE_HEADERS,
                    )
                if _runtime_for_entry(request.app[KEY_HASS], entry_id) is not runtime:
                    return _not_found()
                # Keep the requested image first, even when it is late in the
                # collection. Remember evicted IDs so a later request can read
                # them immediately instead of treating them as missing images.
                retained: dict[str, bytes] = {}
                remaining = RUN_THUMBNAILS_CACHE_BYTES
                for thumbnail in sorted(
                    images, key=lambda item: native_run_id(item.key) != run_id
                ):
                    if len(thumbnail.image) <= remaining:
                        retained[native_run_id(thumbnail.key)] = thumbnail.image
                        remaining -= len(thumbnail.image)
                cached = _CachedThumbnails(
                    monotonic(),
                    retained,
                    frozenset(native_run_id(image.key) for image in images),
                )
                self._cache[entry_id] = cached
        image = cached.images.get(run_id)
        if image is None:
            return _not_found()
        return web.Response(
            body=image, content_type="image/webp", headers=PRIVATE_NO_STORE_HEADERS
        )


def _not_found() -> web.Response:
    return web.Response(status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS)
