"""Keep the newest photo from the robot's camera."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Iterable, Iterator
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
    are counted by id. Reads only add photos: a read that times out returns
    what it has without an error, so it cannot prove a photo was deleted. A
    photo deleted in the Matic app stays until the integration reloads.
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
            entries = await self._client.async_get_tracked_collection_entries(
                PHOTO_COLLECTION, limit=MAX_PHOTO_ENTRIES
            )
        except MaticError as err:
            _LOGGER.debug("Matic photos are unavailable: %s", err)
            return False
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
                changed = True
            if self._latest is None or photo.captured_at > self._latest.captured_at:
                self._latest = photo
                changed = True
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
