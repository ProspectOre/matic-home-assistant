"""The photo library's edges: shutdown, leftovers on disk, eviction order."""

from __future__ import annotations

import errno
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from custom_components.matic_robot import photo_library
from custom_components.matic_robot.client import RobotPhoto
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.photo_library import PhotoLibrary
from tests.test_photo_library import (
    ISSUE_ID,
    NOW,
    _entries,
    _frozen,  # noqa: F401  # autouse: a fixed clock
    _id,
    _library,
    _snap,
    folder_fixture,  # noqa: F401  # The photo folder in a temporary config.
)


async def test_a_closed_library_saves_and_prunes_nothing(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(hass, _snap(1))
    await library.async_load()
    await library.async_read()
    await library.async_shutdown()
    library._records[_id(1)] = photo_library.replace(
        library.photo(_id(1)), captured_at=NOW - photo_library.MAX_PHOTO_AGE * 2
    )

    await library.async_prune()
    _entries(library, _snap(2, age=timedelta(seconds=-1)))
    assert await library.async_read() is False

    assert sorted(library._records) == [_id(1)]
    assert not await hass.async_add_executor_job((folder / f"{_id(2)}.webp").exists)


async def test_loading_deletes_files_no_record_accounts_for(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(hass, _snap(1))
    await library.async_read()
    await library._store.async_save(library._data())

    def leave_leftovers() -> None:
        (folder / f"{_id(2)}.webp").write_bytes(b"orphan")
        (folder / f"{_id(1)}.part").write_bytes(b"half")
        (folder / f"{_id(1)}.preview.part").write_bytes(b"half")

    await hass.async_add_executor_job(leave_leftovers)
    reloaded = _library(hass)
    await reloaded.async_load()
    await reloaded.async_shutdown()

    names = await hass.async_add_executor_job(
        lambda: sorted(path.name for path in folder.iterdir())
    )
    assert names == [f"{_id(1)}.preview.webp", f"{_id(1)}.webp"]


async def test_a_robot_that_never_saved_a_photo_loads_without_a_folder(
    hass: HomeAssistant, folder: Path
) -> None:
    library = PhotoLibrary(hass, "fresh", _library(hass)._client, place=lambda: None)
    await library.async_load()
    await library.async_shutdown()
    assert library.photo_count == 0


async def test_a_full_library_evicts_strictly_oldest_first(
    hass: HomeAssistant, folder: Path
) -> None:
    """A small old photo that would still fit goes once a newer one does not."""
    library = _library(
        hass,
        _snap(1, preview=None),
        _snap(2, age=timedelta(seconds=-1)),
        _snap(3, age=timedelta(seconds=-2)),
    )
    await library.async_read()
    room = library.photo(_id(3)).size + library.photo(_id(1)).size

    # The middle photo does not fit, so the oldest goes even though it would.
    with patch.object(photo_library, "MAX_LIBRARY_BYTES", room):
        await library.async_prune()

    assert sorted(library._records) == [_id(3)]
    assert library._evicted_through == library.photo(_id(3)).captured_at - (
        timedelta(seconds=1)
    )


async def test_the_repair_stays_while_a_photo_still_fails_to_save(
    hass: HomeAssistant, folder: Path
) -> None:
    library = _library(hass, _snap(1), _snap(2, age=timedelta(seconds=-1)))
    real_write = PhotoLibrary._write

    def fail_on_second(self: PhotoLibrary, photo: RobotPhoto) -> None:
        if photo.photo_id == _id(2):
            raise OSError(errno.EIO, "io")
        real_write(self, photo)

    with patch.object(PhotoLibrary, "_write", fail_on_second):
        assert await library.async_read() is True

    assert library.photo_count == 1
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_ID) is not None
    _entries(library, _snap(2, age=timedelta(seconds=-1)))
    await library.async_read()
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_ID) is None
