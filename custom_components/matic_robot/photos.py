"""Keep the newest photo from the robot's camera."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

from google.protobuf.message import DecodeError
from homeassistant.core import CALLBACK_TYPE, callback

from .client.exceptions import MaticError
from .client.models import HermesCollectionEntry
from .client.snaps import RobotPhoto, decode_instamatic_snap

if TYPE_CHECKING:
    from .client.api import MaticHermesClient

_LOGGER = logging.getLogger(__name__)

PHOTO_COLLECTION = "instamatic_snaps"
MAX_PHOTO_ENTRIES = 64
# The robot counts down for about 9 s and stores the photo about 6 s after
# the command, so the first read waits past both and a second read covers a
# slow save.
SNAP_READ_DELAYS_SECONDS = (12.0, 20.0)


class RobotPhotoStore:
    """Hold the newest robot photo in memory.

    Only the newest photo's bytes are kept. Older photos stay on the robot and
    are counted by id.
    """

    def __init__(self, client: MaticHermesClient) -> None:
        self._client = client
        self._latest: RobotPhoto | None = None
        self._photo_ids: set[str] = set()
        self._listeners: set[Callable[[], None]] = set()

    @property
    def latest(self) -> RobotPhoto | None:
        """Return the newest photo seen on the robot."""
        return self._latest

    @property
    def photo_count(self) -> int:
        """Return how many photos the robot holds, as last read."""
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
        """Read every photo once; return whether a newer photo arrived."""
        try:
            entries = await self._client.async_get_tracked_collection_entries(
                PHOTO_COLLECTION, limit=MAX_PHOTO_ENTRIES
            )
        except MaticError as err:
            _LOGGER.debug("Matic photos are unavailable: %s", err)
            return False
        photos = _decode_photos(entries)
        previous = self._latest
        previous_ids = self._photo_ids
        # A full read replaces what the stream saw, so photos deleted in the
        # app drop out here.
        self._latest = max(photos, key=lambda photo: photo.captured_at, default=None)
        self._photo_ids = {photo.photo_id for photo in photos}
        if self._latest != previous or self._photo_ids != previous_ids:
            self._async_notify()
        return self._latest is not None and (
            previous is None or self._latest.captured_at > previous.captured_at
        )

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
                # The stream only adds photos. A full read first drops any
                # deleted in the app while the stream was down.
                await self.async_refresh()
                async for entry in self._client.async_subscribe_collection_entries(
                    PHOTO_COLLECTION
                ):
                    retry_delay = 1
                    if self._async_add_entries((entry,)):
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
    def _async_add_entries(self, entries: tuple[HermesCollectionEntry, ...]) -> bool:
        changed = False
        for photo in _decode_photos(entries):
            if photo.photo_id not in self._photo_ids:
                self._photo_ids.add(photo.photo_id)
                changed = True
            if self._latest is None or photo.captured_at > self._latest.captured_at:
                self._latest = photo
                changed = True
        return changed

    @callback
    def _async_notify(self) -> None:
        for listener in tuple(self._listeners):
            listener()


def _decode_photos(entries: tuple[HermesCollectionEntry, ...]) -> list[RobotPhoto]:
    photos: list[RobotPhoto] = []
    for entry in entries:
        try:
            photos.append(decode_instamatic_snap(entry))
        except DecodeError:
            continue
    return photos
