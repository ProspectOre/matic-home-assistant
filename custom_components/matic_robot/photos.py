"""Keep the newest photo from the robot's camera."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Iterable, Iterator
from http import HTTPStatus
from io import BytesIO
from typing import TYPE_CHECKING

from aiohttp import web
from google.protobuf.message import DecodeError
from homeassistant.core import CALLBACK_TYPE, callback
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView
from PIL import Image, UnidentifiedImageError

from .client.exceptions import MaticError
from .client.models import HermesCollectionEntry
from .client.snaps import RobotPhoto, decode_instamatic_snap
from .const import DOMAIN
from .http import (
    PRIVATE_NO_STORE_HEADERS,
    runtime_for_entry,
)

if TYPE_CHECKING:
    from .client.api import MaticHermesClient

_LOGGER = logging.getLogger(__name__)

PHOTO_COLLECTION = "instamatic_snaps"
MAX_PHOTO_ENTRIES = 64
# The robot counts down for about 9 s and stores the photo about 6 s after
# the command, so the first read waits past both and a second read covers a
# slow save. Each delay follows the previous read: reads at +12 s and +20 s.
SNAP_READ_DELAYS_SECONDS = (12.0, 8.0)
# About 6 MiB of full-size photos.
MAX_RECENT_PHOTOS = 16
PREVIEW_BLOCKS = 24


class RobotPhotoStore:
    """Hold the newest robot photos in memory.

    Only the newest ``MAX_RECENT_PHOTOS`` photos' bytes are kept. Older photos
    stay on the robot and are counted by id. Reads only add photos: a read
    that times out returns what it has without an error, so it cannot prove a
    photo was deleted. A photo deleted in the Matic app stays until the
    integration reloads.
    """

    def __init__(self, client: MaticHermesClient) -> None:
        self._client = client
        self._latest: RobotPhoto | None = None
        self._photo_ids: set[str] = set()
        self._recent: dict[str, RobotPhoto] = {}
        self._listeners: set[Callable[[], None]] = set()

    @property
    def latest(self) -> RobotPhoto | None:
        """Return the newest photo seen on the robot."""
        return self._latest

    def photo(self, photo_id: str) -> RobotPhoto | None:
        """Return one of the recent photos by id."""
        return self._recent.get(photo_id)

    @property
    def photo_count(self) -> int:
        """Return how many photos have been seen on the robot."""
        return len(self._photo_ids)

    @callback
    def async_add_listener(self, listener: Callable[[], None]) -> CALLBACK_TYPE:
        """Call ``listener`` when the newest photo or the count changes."""
        self._listeners.add(listener)

        @callback
        def remove() -> None:
            self._listeners.discard(listener)

        return remove

    async def async_refresh(self) -> bool:
        """Read the robot's photos once; return whether a newer one arrived."""
        try:
            return await self.async_read()
        except MaticError as err:
            _LOGGER.debug("Matic photos are unavailable: %s", err)
            return False

    async def async_read(self) -> bool:
        """Read the robot's photos once, raising when the robot can't be read."""
        entries = await self._client.async_get_tracked_collection_entries(
            PHOTO_COLLECTION, limit=MAX_PHOTO_ENTRIES
        )
        previous = self._latest
        if self._async_add_photos(_decode_photos(entries)):
            self._async_notify()
        return self._latest is not previous

    async def async_refresh_after_snap(self) -> None:
        """Pick up the photo a snap command just asked for."""
        for delay in SNAP_READ_DELAYS_SECONDS:
            await asyncio.sleep(delay)
            if await self.async_refresh():
                return

    async def async_watch(self) -> None:
        """Follow the robot's photo collection, including photos from the app."""
        retry_delay = 1
        while True:
            try:
                async for entry in self._client.async_subscribe_collection_entries(
                    PHOTO_COLLECTION
                ):
                    retry_delay = 1
                    if self._async_add_photos(_decode_photos((entry,))):
                        self._async_notify()
            except asyncio.CancelledError:
                raise
            except MaticError as err:
                _LOGGER.debug("Matic photo subscription interrupted: %s", err)
            if self._client.retired:
                return
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)

    @callback
    def _async_add_photos(self, photos: Iterable[RobotPhoto]) -> bool:
        changed = False
        for photo in photos:
            if photo.photo_id not in self._photo_ids:
                self._photo_ids.add(photo.photo_id)
                self._recent[photo.photo_id] = photo
                changed = True
            if self._latest is None or photo.captured_at > self._latest.captured_at:
                self._latest = photo
                changed = True
        while len(self._recent) > MAX_RECENT_PHOTOS:
            oldest = min(self._recent.values(), key=lambda photo: photo.captured_at)
            del self._recent[oldest.photo_id]
        return changed

    @callback
    def _async_notify(self) -> None:
        for listener in tuple(self._listeners):
            listener()


def _decode_photos(
    entries: Iterable[HermesCollectionEntry],
) -> Iterator[RobotPhoto]:
    """Decode one entry at a time so only the photos kept stay in memory."""
    for entry in entries:
        try:
            yield decode_instamatic_snap(entry)
        except DecodeError:
            continue


class MaticRobotPhotoView(HomeAssistantView):
    """Serve one recent robot photo to a signed-in user."""

    url = f"/api/{DOMAIN}/photo/{{entry_id}}/{{photo_id}}"
    name = f"api:{DOMAIN}:photo"

    async def get(
        self, request: web.Request, entry_id: str, photo_id: str
    ) -> web.Response:
        """Return the WebP, or 404 once it has left the recent photos."""
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        photo = runtime.photos.photo(photo_id) if runtime is not None else None
        if photo is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        return web.Response(
            body=photo.image,
            content_type="image/webp",
            headers=PRIVATE_NO_STORE_HEADERS,
        )


class MaticRobotPhotoPreviewView(HomeAssistantView):
    """Serve a deliberately pixelated photo for private notifications."""

    url = f"/api/{DOMAIN}/photo/{{entry_id}}/preview/{{photo_id}}"
    name = f"api:{DOMAIN}:photo-preview"

    async def get(
        self, request: web.Request, entry_id: str, photo_id: str
    ) -> web.Response:
        """Return the pixelated WebP; never fall back to the original image."""
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        photo = runtime.photos.photo(photo_id) if runtime is not None else None
        if photo is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            image = await hass.async_add_executor_job(
                _pixelated_preview, photo.preview or photo.image
            )
        except OSError, UnidentifiedImageError, ValueError:
            return web.Response(
                status=HTTPStatus.UNPROCESSABLE_ENTITY,
                headers=PRIVATE_NO_STORE_HEADERS,
            )
        return web.Response(
            body=image,
            content_type="image/webp",
            headers=PRIVATE_NO_STORE_HEADERS,
        )


def _pixelated_preview(image_bytes: bytes) -> bytes:
    """Shrink to a small mosaic and enlarge with hard pixel edges."""
    with Image.open(BytesIO(image_bytes)) as source:
        source.load()
        width, height = source.size
        small = source.convert("RGB").resize(
            (max(1, width // PREVIEW_BLOCKS), max(1, height // PREVIEW_BLOCKS)),
            Image.Resampling.BOX,
        )
        mosaic = small.resize((width, height), Image.Resampling.NEAREST)
        output = BytesIO()
        mosaic.save(output, format="WEBP", quality=55, method=0)
        return output.getvalue()
