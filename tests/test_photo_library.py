"""The photo library: robot photos saved to disk, filed into albums, bounded."""

from __future__ import annotations

import asyncio
import errno
import hashlib
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.matic_robot import image as image_platform
from custom_components.matic_robot import llm_camera, photo_library
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    HermesCollectionEntry,
    RobotPose,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.photo_library import (
    MANUAL_ALBUM,
    PhotoLibrary,
    PhotoPlace,
    PhotoSource,
    async_remove_photos,
)
from tests.hermes_fakes import watch
from tests.test_entities import _entry as _entities_entry
from tests.test_photos import PREVIEW, WEBP, _bfield, _key, _timestamp, _value

ENTRY_ID = "entry"
STORAGE_KEY = f"{DOMAIN}.photos.{ENTRY_ID}"
ISSUE_ID = f"photo_storage_failed_{ENTRY_ID}"
HERE = PhotoPlace("Study", 1.0, 2.0, 0.5, 7)
NOW = dt_util.parse_datetime("2026-11-19T12:00:00+00:00")


@pytest.fixture(autouse=True)
def _frozen(freezer: FrozenDateTimeFactory) -> None:
    freezer.move_to(NOW)


@pytest.fixture(name="folder")
def folder_fixture(hass: HomeAssistant, tmp_path: Path) -> Path:
    hass.config.config_dir = str(tmp_path)
    return tmp_path / DOMAIN / "photos" / ENTRY_ID


def _snap(
    number: int, *, age: timedelta = timedelta(), preview: bytes | None = PREVIEW
) -> HermesCollectionEntry:
    seconds = int((dt_util.utcnow() - age).timestamp())
    return HermesCollectionEntry(
        _key(UUID(int=number)),
        _value(captured=_bfield(1, _timestamp(seconds, None)), preview=preview),
    )


def _id(number: int) -> str:
    return str(UUID(int=number))


def _library(hass: HomeAssistant, *entries: HermesCollectionEntry) -> PhotoLibrary:
    client = SimpleNamespace(
        async_get_tracked_collection_entries=AsyncMock(return_value=entries)
    )
    return PhotoLibrary(hass, ENTRY_ID, client, place=lambda: HERE)


def _entries(library: PhotoLibrary, *entries: HermesCollectionEntry) -> None:
    library._client.async_get_tracked_collection_entries.return_value = entries


async def test_a_photo_is_written_to_disk_and_recorded(
    hass: HomeAssistant, folder: Path, hass_storage: dict[str, Any]
) -> None:
    library = _library(hass, _snap(1))
    listener = MagicMock()
    remove = library.async_add_listener(listener)

    assert library.latest is None
    assert await library.async_read() is True

    record = library.photo(_id(1))
    assert record is not None and library.latest == record
    assert (folder / f"{_id(1)}.webp").read_bytes() == WEBP
    assert (folder / f"{_id(1)}.preview.webp").read_bytes() == PREVIEW
    assert not await hass.async_add_executor_job(lambda: [*folder.glob("*.part")])
    assert record.captured_at == NOW
    assert record.album == MANUAL_ALBUM
    assert record.source is PhotoSource.MATIC_APP
    assert record.size == len(WEBP) + len(PREVIEW) == library.total_bytes
    assert record.sha256 == hashlib.sha256(WEBP).hexdigest()
    assert record.place == HERE
    assert library.photo_count == 1
    assert library.album(MANUAL_ALBUM) == [record]
    listener.assert_called_once_with()

    # The record is saved shortly after, and a fresh library loads it.
    async_fire_time_changed(hass, NOW + timedelta(seconds=2))
    await hass.async_block_till_done()
    stored = hass_storage[STORAGE_KEY]["data"]["photos"]
    assert stored[0]["photo_id"] == _id(1)
    reloaded = _library(hass)
    await reloaded.async_load()
    assert reloaded.photo(_id(1)) == record
    assert await reloaded.async_image(_id(1)) == WEBP
    assert await reloaded.async_image(_id(1), preview=True) == PREVIEW
    await reloaded.async_shutdown()

    # A photo already saved is not saved again, so nothing is announced.
    assert await library.async_read() is False
    remove()
    _entries(library, _snap(2, age=timedelta(seconds=-1)))
    assert await library.async_read() is True
    listener.assert_called_once()


async def test_a_requested_photo_goes_to_its_album(
    hass: HomeAssistant, folder: Path, freezer: FrozenDateTimeFactory
) -> None:
    library = _library(hass)
    library.async_expect_photo("mission")
    withdrawn = library.async_expect_photo("never sent")
    withdrawn()
    withdrawn()

    # A photo from before the request belongs to whoever took it then.
    _entries(library, _snap(1, age=timedelta(minutes=2)), _snap(2))
    await library.async_read()

    assert library.photo(_id(1)).album == MANUAL_ALBUM
    assert library.photo(_id(2)).album == "mission"
    assert library.photo(_id(2)).source is PhotoSource.HOME_ASSISTANT
    assert [record.photo_id for record in library.album("mission")] == [_id(2)]

    # A request no photo answered expires, and a later photo is the app's.
    library.async_expect_photo("expired")
    freezer.tick(photo_library.EXPECTATION_LIFETIME + timedelta(seconds=1))
    _entries(library, _snap(3))
    await library.async_read()
    assert library.photo(_id(3)).album == MANUAL_ALBUM


async def test_an_old_photo_has_no_place_and_an_expired_one_is_skipped(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(
        hass,
        _snap(1, age=photo_library.PLACE_WINDOW + timedelta(seconds=1), preview=None),
        _snap(2, age=photo_library.MAX_PHOTO_AGE + timedelta(seconds=1)),
        HermesCollectionEntry(_key(UUID(int=3)), b"\x00"),
        HermesCollectionEntry(b"\x0a\x03abc", _value()),
    )

    await library.async_read()

    record = library.photo(_id(1))
    assert record.place == PhotoPlace(None)
    assert not record.has_preview and record.size == len(WEBP)
    assert library.photo_count == 1
    # Without a preview the preview request answers with the full image.
    assert await library.async_image(_id(1), preview=True) == WEBP
    assert await library.async_image(_id(9)) is None
    (folder / f"{_id(1)}.webp").unlink()
    assert await library.async_image(_id(1)) is None


@pytest.mark.parametrize(
    ("error", "translation_key"),
    [
        (OSError(errno.ENOSPC, "full"), "photo_disk_full"),
        (OSError(errno.EACCES, "denied"), "photo_storage_failed"),
    ],
)
async def test_a_failed_write_raises_a_repair_until_a_photo_saves(
    hass: HomeAssistant,
    folder: Path,
    error: OSError,
    translation_key: str,
) -> None:
    library = _library(hass, _snap(1))
    library.async_expect_photo("mission")
    with patch.object(PhotoLibrary, "_write", side_effect=error):
        assert await library.async_read() is False

    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_ID)
    assert issue is not None and issue.translation_key == translation_key
    assert issue.translation_placeholders == {"folder": str(folder)}
    assert library.photo_count == 0

    # The photo stayed on the robot, so the next read saves it, still in the
    # album that asked for it.
    assert await library.async_read() is True
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_ID) is None
    assert library.photo(_id(1)).album == "mission"


async def test_a_photo_that_reads_back_wrong_is_not_recorded(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(hass, _snap(1))
    with patch.object(Path, "read_bytes", return_value=b"different"):
        await library.async_read()

    assert library.photo_count == 0
    assert await hass.async_add_executor_job(lambda: [*folder.iterdir()]) == []
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_ID)
    assert issue.translation_key == "photo_storage_failed"


async def test_old_and_overflowing_photos_are_removed_but_starred_ones_kept(
    hass: HomeAssistant, folder: Path, freezer: FrozenDateTimeFactory
) -> None:
    library = _library(hass, _snap(1), _snap(2, age=timedelta(seconds=-1)))
    await library.async_read()
    one = library.photo(_id(1))
    library._records[_id(1)] = photo_library.replace(one, starred=True)

    # Room for two photos: the starred one stays even though it is oldest.
    _entries(library, _snap(3, age=timedelta(seconds=-2)))
    with patch.object(photo_library, "MAX_LIBRARY_BYTES", one.size * 2 - 1):
        await library.async_read()
    assert sorted(library._records) == [_id(1), _id(3)]
    assert not (folder / f"{_id(2)}.webp").exists()
    assert not (folder / f"{_id(2)}.preview.webp").exists()

    # The robot still holds the evicted photo; it is not saved again, even
    # by a library that loads the records afresh.
    _entries(library, _snap(1), _snap(2, age=timedelta(seconds=-1)))
    assert await library.async_read() is False
    await library._store.async_save(library._data())
    reloaded = _library(hass, _snap(2, age=timedelta(seconds=-1)))
    await reloaded.async_load()
    assert await reloaded.async_read() is False
    await reloaded.async_shutdown()

    # A month later only the starred photo is left.
    freezer.tick(photo_library.MAX_PHOTO_AGE + timedelta(seconds=10))
    _entries(library, _snap(4))
    await library.async_read()
    assert sorted(library._records) == [_id(1), _id(4)]


async def test_refresh_hides_an_unreachable_robot(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(hass)
    library._client.async_get_tracked_collection_entries.side_effect = (
        CannotConnectError("offline")
    )
    assert await library.async_refresh() is False
    with pytest.raises(CannotConnectError):
        await library.async_read()


async def test_refresh_after_snap_reads_until_the_new_photo_lands(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(hass)
    library.async_refresh = AsyncMock(side_effect=[False, False])
    with patch.object(photo_library.asyncio, "sleep", AsyncMock()) as sleep:
        await library.async_refresh_after_snap()
    assert [call.args[0] for call in sleep.await_args_list] == list(
        photo_library.SNAP_READ_DELAYS_SECONDS
    )

    library.async_refresh = AsyncMock(return_value=True)
    with patch.object(photo_library.asyncio, "sleep", AsyncMock()) as sleep:
        await library.async_refresh_after_snap()
    assert sleep.await_count == 1


async def test_watch_saves_photos_from_every_subscription(
    hass: HomeAssistant, folder: Path
) -> None:
    batches = iter(((_snap(1),), (_snap(1), _snap(2)), asyncio.CancelledError()))

    async def subscribe(name: str):
        assert name == "instamatic_snaps"
        batch = next(batches)
        if isinstance(batch, BaseException):
            raise batch
        for entry in batch:
            yield entry

    library = _library(hass)
    library._client.async_watch = watch(subscribe, 3)
    with pytest.raises(asyncio.CancelledError):
        await library.async_watch()
    assert sorted(library._records) == [_id(1), _id(2)]


async def test_load_skips_records_it_cannot_read(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    good = {
        "photo_id": _id(1),
        "captured_at": NOW.isoformat(),
        "album": "mission",
        "source": "home_assistant",
        "size": 10,
        "sha256": "00",
        "has_preview": False,
        "place": {"area": None, "x": None, "y": None, "heading": None},
    }
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": {"photos": [good, {**good, "photo_id": "../x"}, {"album": "a"}]},
    }
    library = _library(hass)
    await library.async_load()
    assert list(library._records) == [_id(1)]
    assert library.photo(_id(1)).starred is False
    await library.async_shutdown()

    empty = PhotoLibrary(hass, "other", None, place=lambda: HERE)
    await empty.async_load()
    assert empty.photo_count == 0
    await empty.async_shutdown()


async def test_removing_the_robot_erases_its_photos(
    hass: HomeAssistant, folder: Path, hass_storage: dict[str, Any]
) -> None:
    library = _library(hass, _snap(1))
    await library.async_read()
    await library._store.async_save(library._data())
    _entries(library, _snap(2))
    with patch.object(PhotoLibrary, "_write", side_effect=OSError("x")):
        await library.async_read()
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_ID) is not None

    await async_remove_photos(hass, ENTRY_ID)

    assert not await hass.async_add_executor_job(folder.exists)
    assert STORAGE_KEY not in hass_storage
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_ID) is None


def test_a_place_takes_the_pose_when_there_is_one() -> None:
    pose = RobotPose(1.0, 2.0, 0.0, mission_id=7, heading=0.5)
    assert PhotoPlace.at("Study", pose) == HERE
    assert PhotoPlace.at("Study", None) == PhotoPlace("Study")


async def test_latest_photo_image_shows_the_newest_saved_photo(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(hass, _snap(1))
    entry = _entities_entry()
    entry.runtime_data.photos = library
    added: list[object] = []
    await image_platform.async_setup_entry(hass, entry, added.extend)
    entity = added[0]
    entity.hass = hass
    entity.entity_id = "image.test_robot_latest_photo"
    entity.async_write_ha_state = MagicMock()

    assert entity.unique_id == "synthetic-serial_latest_photo"
    assert entity.content_type == "image/webp"
    assert entity.image_last_updated is None
    assert await entity.async_image() is None
    assert entity.extra_state_attributes == {"photo_count": 0}

    await entity.async_added_to_hass()
    await library.async_read()

    entity.async_write_ha_state.assert_called_once()
    assert entity.image_last_updated == NOW
    assert entity.state == NOW.isoformat()
    assert await entity.async_image() == WEBP
    assert entity.extra_state_attributes == {"photo_count": 1}


async def test_photos_are_private_to_home_assistant(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(hass, _snap(1))
    await library.async_read()

    def modes() -> list[int]:
        paths = [folder, *folder.iterdir()]
        return [path.stat().st_mode & 0o777 for path in paths]

    assert await hass.async_add_executor_job(modes) == [0o700, 0o600, 0o600]


async def test_unloading_saves_records_at_once_and_a_reload_keeps_them(
    hass: HomeAssistant, folder: Path, hass_storage: dict[str, Any]
) -> None:
    library = _library(hass, _snap(1))
    library.async_expect_photo("mission")
    await library.async_load()
    await library.async_read()

    await library.async_shutdown()
    await library.async_shutdown()

    assert hass_storage[STORAGE_KEY]["data"]["photos"][0]["album"] == "mission"
    reloaded = _library(hass)
    await reloaded.async_load()
    assert reloaded.photo(_id(1)).album == "mission"
    await reloaded.async_shutdown()


async def test_expired_photos_are_removed_without_new_ones(
    hass: HomeAssistant, folder: Path, freezer: FrozenDateTimeFactory
) -> None:
    library = _library(hass, _snap(1), _snap(2, age=timedelta(days=29)))
    await library.async_read()
    await library.async_shutdown()
    listener = MagicMock()

    # A day later, loading drops the photo now past 30 days.
    freezer.tick(timedelta(days=1, seconds=1))
    library = _library(hass)
    library.async_add_listener(listener)
    await library.async_load()
    assert sorted(library._records) == [_id(1)]
    assert not await hass.async_add_executor_job((folder / f"{_id(2)}.webp").exists)
    listener.assert_called_once_with()

    # With nothing new, the daily check drops the rest when they expire.
    freezer.tick(photo_library.MAX_PHOTO_AGE)
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert library.photo_count == 0
    await library.async_shutdown()
    async_fire_time_changed(hass, dt_util.utcnow() + photo_library.PRUNE_INTERVAL)
    await hass.async_block_till_done()


def test_the_assist_tool_states_how_long_photos_are_kept() -> None:
    description = llm_camera._PHOTO_ACTION_DESCRIPTION
    assert f"{photo_library.MAX_PHOTO_AGE.days} days" in description
    assert "disk" in description


async def test_failed_file_operations_leave_no_partial_files_and_are_logged(
    hass: HomeAssistant, folder: Path, caplog: pytest.LogCaptureFixture
) -> None:
    library = _library(hass, _snap(1))
    with patch.object(Path, "replace", side_effect=OSError(errno.EIO, "io")):
        await library.async_read()
    assert await hass.async_add_executor_job(lambda: [*folder.iterdir()]) == []

    await library.async_read()
    library._records[_id(1)] = photo_library.replace(
        library.photo(_id(1)), captured_at=NOW - photo_library.MAX_PHOTO_AGE * 2
    )
    with patch.object(Path, "unlink", side_effect=OSError(errno.EBUSY, "busy")):
        await library.async_prune()
    assert library.photo_count == 0
    assert "Could not delete a Matic photo" in caplog.text

    def rmtree(_path: Path, *, onexc) -> None:
        onexc(None, str(folder), OSError(errno.EACCES, "denied"))

    with patch.object(photo_library.shutil, "rmtree", rmtree):
        await async_remove_photos(hass, ENTRY_ID)
    assert "Could not erase removed robot photo" in caplog.text
    # A robot that never saved a photo has no folder to erase.
    await async_remove_photos(hass, "never-saved")
