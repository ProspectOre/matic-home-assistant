"""Keep every robot photo on Home Assistant's disk, grouped into albums.

Each photo is a full WebP and, when the robot sent one, its pixelated preview,
in a folder per robot outside ``www``, so nothing is served without a login.
The records (album, capture time, where the robot was) live in Home
Assistant's private storage. Bytes are read from disk on demand; only records
stay in memory.
"""

from __future__ import annotations

import asyncio
import errno
import hashlib
import logging
import os
import shutil
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import UUID

from google.protobuf.message import DecodeError
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .client import (
    HermesCollectionEntry,
    MaticError,
    RobotPhoto,
    RobotPose,
    decode_instamatic_snap,
)
from .const import DOMAIN

if TYPE_CHECKING:
    from .client import MaticHermesClient

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
PHOTO_COLLECTION = "instamatic_snaps"
MAX_PHOTO_ENTRIES = 64
# The robot counts down for about 9 s and stores the photo about 6 s after
# the command, so the first read waits past both and a second read covers a
# slow save. Each delay follows the previous read: reads at +12 s and +20 s.
SNAP_READ_DELAYS_SECONDS = (12.0, 8.0)
MAX_LIBRARY_BYTES = 500 * 1024 * 1024
MAX_PHOTO_AGE = timedelta(days=30)
PRUNE_INTERVAL = timedelta(days=1)
# A photo up to this much older than the request that asked for it still
# answers it: the robot's clock and Home Assistant's differ a little.
CLOCK_TOLERANCE = timedelta(seconds=2)
# A request nobody's photo answered expires; later photos are the app's.
EXPECTATION_LIFETIME = timedelta(minutes=2)
# The robot saves a photo about 6 s after taking it and stays put meanwhile.
PLACE_WINDOW = timedelta(minutes=1)
MANUAL_ALBUM = "manual"
STORAGE_ISSUE = "photo_storage_failed"


class PhotoSource(StrEnum):
    """Who asked for a photo."""

    HOME_ASSISTANT = "home_assistant"
    MATIC_APP = "matic_app"


@dataclass(frozen=True, slots=True)
class PhotoPlace:
    """Where the robot was when a photo was saved."""

    area: str | None
    x: float | None = None
    y: float | None = None
    heading: float | None = None
    mission_id: int | None = None

    @classmethod
    def at(cls, area: str | None, pose: RobotPose | None) -> PhotoPlace:
        if pose is None:
            return cls(area)
        return cls(area, pose.x, pose.y, pose.heading, pose.mission_id)


@dataclass(frozen=True, slots=True)
class PhotoRecord:
    """One saved photo. ``size`` counts the full image and its preview."""

    photo_id: str
    captured_at: datetime
    album: str
    source: PhotoSource
    size: int
    sha256: str
    has_preview: bool
    place: PhotoPlace
    starred: bool = False


@dataclass(slots=True, eq=False)
class _Expectation:
    requested_at: datetime
    album: str


class PhotoLibrary:
    """Save the robot's photos to disk as they appear and keep them in bounds.

    Photos past ``MAX_PHOTO_AGE`` and, oldest first, photos past
    ``MAX_LIBRARY_BYTES`` are removed; a starred photo is kept. When a photo
    cannot be written it stays on the robot, is tried again on the next read,
    and a Repair says why.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        entry_id: str,
        client: MaticHermesClient,
        place: Callable[[], PhotoPlace],
    ) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._client = client
        self._place = place
        self._folder = _folder(hass, entry_id)
        self._store = _store(hass, entry_id)
        self._records: dict[str, PhotoRecord] = {}
        self._expected: deque[_Expectation] = deque()
        self._listeners: set[Callable[[], None]] = set()
        self._lock = asyncio.Lock()
        self._unsaved = False
        self._stop_pruning: CALLBACK_TYPE | None = None

    @property
    def latest(self) -> PhotoRecord | None:
        """Return the newest saved photo."""
        return max(
            self._records.values(), key=lambda record: record.captured_at, default=None
        )

    @property
    def photo_count(self) -> int:
        return len(self._records)

    @property
    def total_bytes(self) -> int:
        return sum(record.size for record in self._records.values())

    def photo(self, photo_id: str) -> PhotoRecord | None:
        return self._records.get(photo_id)

    def album(self, album: str) -> list[PhotoRecord]:
        """Return an album's photos, oldest first."""
        return sorted(
            (record for record in self._records.values() if record.album == album),
            key=lambda record: record.captured_at,
        )

    @callback
    def async_add_listener(self, listener: Callable[[], None]) -> CALLBACK_TYPE:
        """Call ``listener`` when a photo is saved or removed."""
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    @callback
    def async_expect_photo(self, album: str = MANUAL_ALBUM) -> CALLBACK_TYPE:
        """File the next photo taken from now on in ``album``.

        Call this just before sending a snap, and the returned callback if the
        snap was not sent. A photo nobody asked for, such as one taken in the
        Matic app, goes to the manual album.
        """
        expectation = _Expectation(dt_util.utcnow(), album)
        self._expected.append(expectation)

        def withdraw() -> None:
            if expectation in self._expected:
                self._expected.remove(expectation)

        return withdraw

    async def async_load(self) -> None:
        """Load the records, drop expired photos, and keep doing so daily."""
        stored = await self._store.async_load() or {}
        records = (_decode_record(item) for item in stored.get("photos", ()))
        self._records = {record.photo_id: record for record in records if record}
        await self.async_prune()
        self._stop_pruning = async_track_time_interval(
            self._hass, self._async_prune_daily, PRUNE_INTERVAL
        )

    async def async_shutdown(self) -> None:
        """Stop pruning and write any record not yet saved."""
        if self._stop_pruning is not None:
            self._stop_pruning()
            self._stop_pruning = None
        if self._unsaved:
            self._unsaved = False
            await self._store.async_save(self._data())

    async def async_prune(self) -> None:
        """Remove photos past the age and size limits."""
        async with self._lock:
            if await self._async_prune():
                self._async_changed()

    async def async_image(
        self, photo_id: str, *, preview: bool = False
    ) -> bytes | None:
        """Read a photo, or its preview when it has one, from disk."""
        record = self._records.get(photo_id)
        if record is None:
            return None
        path = self._path(photo_id, preview=preview and record.has_preview)
        try:
            return await self._hass.async_add_executor_job(path.read_bytes)
        except OSError:
            return None

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
        previous = self.latest
        await self._async_add_entries(entries)
        return self.latest is not previous

    async def async_refresh_after_snap(self) -> None:
        """Pick up the photo a snap command just asked for."""
        for delay in SNAP_READ_DELAYS_SECONDS:
            await asyncio.sleep(delay)
            if await self.async_refresh():
                return

    async def async_watch(self) -> None:
        """Follow the robot's photo collection, including photos from the app."""
        await self._client.async_watch(
            PHOTO_COLLECTION, lambda entry: self._async_add_entries((entry,))
        )

    async def _async_add_entries(
        self, entries: Iterable[HermesCollectionEntry]
    ) -> None:
        async with self._lock:
            saved = False
            for entry in entries:
                photo = _decode(entry)
                if photo is None or photo.photo_id in self._records:
                    continue
                if dt_util.utcnow() - photo.captured_at > MAX_PHOTO_AGE:
                    continue
                expectation = self._expectation_for(photo)
                record = self._new_record(photo, expectation)
                try:
                    await self._hass.async_add_executor_job(self._write, photo)
                except OSError as err:
                    # The photo stays on the robot and its request stays open
                    # for the next read.
                    self._async_storage_failed(err)
                    break
                if expectation is not None:
                    self._expected.remove(expectation)
                self._records[record.photo_id] = record
                saved = True
            else:
                ir.async_delete_issue(self._hass, DOMAIN, self._issue_id)
            if saved:
                await self._async_prune()
                self._async_changed()

    async def _async_prune_daily(self, _now: datetime) -> None:
        await self.async_prune()

    @callback
    def _async_changed(self) -> None:
        self._unsaved = True
        self._store.async_delay_save(self._saved_data, 1)
        for listener in tuple(self._listeners):
            listener()

    def _saved_data(self) -> dict[str, Any]:
        self._unsaved = False
        return self._data()

    def _expectation_for(self, photo: RobotPhoto) -> _Expectation | None:
        """Return the open request ``photo`` answers, dropping expired ones."""
        now = dt_util.utcnow()
        while self._expected and now - self._expected[0].requested_at > (
            EXPECTATION_LIFETIME
        ):
            self._expected.popleft()
        if (
            self._expected
            and photo.captured_at >= self._expected[0].requested_at - CLOCK_TOLERANCE
        ):
            return self._expected[0]
        return None

    def _new_record(
        self, photo: RobotPhoto, expectation: _Expectation | None
    ) -> PhotoRecord:
        now = dt_util.utcnow()
        album, source = MANUAL_ALBUM, PhotoSource.MATIC_APP
        if expectation is not None:
            album, source = expectation.album, PhotoSource.HOME_ASSISTANT
        # Where the robot is now says where a photo was taken only if it was
        # taken moments ago; an older one, such as from the app, has no place.
        place = (
            self._place()
            if now - photo.captured_at <= PLACE_WINDOW
            else PhotoPlace(None)
        )
        preview = photo.preview or b""
        return PhotoRecord(
            photo.photo_id,
            photo.captured_at,
            album,
            source,
            len(photo.image) + len(preview),
            hashlib.sha256(photo.image).hexdigest(),
            photo.preview is not None,
            place,
        )

    def _write(self, photo: RobotPhoto) -> None:
        """Write the image and preview, each to a temporary name then renamed.

        Like the private records, the folder and files are the owner's only.
        """
        self._folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._folder.chmod(0o700)
        files = [(self._path(photo.photo_id), photo.image)]
        if photo.preview is not None:
            files.append((self._path(photo.photo_id, preview=True), photo.preview))
        for path, data in files:
            unfinished = path.with_suffix(".part")
            descriptor = os.open(
                unfinished, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600
            )
            with os.fdopen(descriptor, "wb") as file:
                file.write(data)
            unfinished.replace(path)
        if files[0][0].read_bytes() != photo.image:
            raise OSError(errno.EIO, "the saved photo does not match the robot's")

    async def _async_prune(self) -> bool:
        cutoff = dt_util.utcnow() - MAX_PHOTO_AGE
        kept = sorted(
            self._records.values(), key=lambda record: record.captured_at, reverse=True
        )
        removed: list[str] = []
        total = 0
        for record in kept:
            if record.starred:
                total += record.size
                continue
            if record.captured_at < cutoff or total + record.size > MAX_LIBRARY_BYTES:
                removed.append(record.photo_id)
                continue
            total += record.size
        for photo_id in removed:
            del self._records[photo_id]
        if removed:
            await self._hass.async_add_executor_job(self._delete_files, removed)
        return bool(removed)

    def _delete_files(self, photo_ids: list[str]) -> None:
        for photo_id in photo_ids:
            for preview in (False, True):
                self._path(photo_id, preview=preview).unlink(missing_ok=True)

    @callback
    def _async_storage_failed(self, err: OSError) -> None:
        _LOGGER.warning("Could not save a Matic photo: %s", err)
        ir.async_create_issue(
            self._hass,
            DOMAIN,
            self._issue_id,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=(
                "photo_disk_full" if err.errno == errno.ENOSPC else STORAGE_ISSUE
            ),
            translation_placeholders={"folder": str(self._folder)},
        )

    @property
    def _issue_id(self) -> str:
        return _issue_id(self._entry_id)

    def _path(self, photo_id: str, *, preview: bool = False) -> Path:
        return self._folder / f"{photo_id}{'.preview' if preview else ''}.webp"

    def _data(self) -> dict[str, Any]:
        return {"photos": [_encode_record(record) for record in self._records.values()]}


async def async_remove_photos(hass: HomeAssistant, entry_id: str) -> None:
    """Erase every saved photo of a removed robot."""
    await _store(hass, entry_id).async_remove()
    await hass.async_add_executor_job(
        partial(shutil.rmtree, _folder(hass, entry_id), ignore_errors=True)
    )
    ir.async_delete_issue(hass, DOMAIN, _issue_id(entry_id))


def _folder(hass: HomeAssistant, entry_id: str) -> Path:
    """Keep photos out of ``www``, so only the signed-in views serve them."""
    return Path(hass.config.path(DOMAIN, "photos", entry_id))


def _store(hass: HomeAssistant, entry_id: str) -> Store[dict[str, Any]]:
    return Store(hass, STORAGE_VERSION, f"{DOMAIN}.photos.{entry_id}", private=True)


def _issue_id(entry_id: str) -> str:
    return f"{STORAGE_ISSUE}_{entry_id}"


def _decode(entry: HermesCollectionEntry) -> RobotPhoto | None:
    """Decode one photo; its id becomes a file name, so it must be a UUID."""
    try:
        photo = decode_instamatic_snap(entry)
        photo_id = str(UUID(photo.photo_id))
    except DecodeError, ValueError:
        return None
    return replace(photo, photo_id=photo_id)


def _encode_record(record: PhotoRecord) -> dict[str, Any]:
    data = asdict(record)
    data["captured_at"] = record.captured_at.isoformat()
    return data


def _decode_record(data: Any) -> PhotoRecord | None:
    try:
        return PhotoRecord(
            str(UUID(data["photo_id"])),
            datetime.fromisoformat(data["captured_at"]),
            str(data["album"]),
            PhotoSource(data["source"]),
            int(data["size"]),
            str(data["sha256"]),
            bool(data["has_preview"]),
            PhotoPlace(**data["place"]),
            bool(data.get("starred", False)),
        )
    except KeyError, TypeError, ValueError:
        return None
