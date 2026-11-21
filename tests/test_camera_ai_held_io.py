"""Photo attachments while a file write or read is held in its thread."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from homeassistant.components.media_source import MediaSourceItem, Unresolvable
from homeassistant.components.media_source.helper import async_resolve_media
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.matic_robot import media_source as media_source_module
from custom_components.matic_robot.media_source import (
    MaticPhotoMediaSource,
    photo_attachment_source,
)

# How long a held thread or its test waits before giving up. Passing tests
# never reach it; it only bounds a failure.
HELD_SECONDS = 30


@pytest.fixture
def resume() -> Iterator[threading.Event]:
    """Let held threads go when the test ends, however it ends."""
    event = threading.Event()
    yield event
    event.set()


async def test_cancelled_executor_write_is_joined_before_cleanup(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch, resume: threading.Event
) -> None:
    source = photo_attachment_source(hass)
    started = threading.Event()
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        started.set()
        resume.wait(timeout=HELD_SECONDS)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    task = asyncio.create_task(source.async_stage_photo("entry-one", "photo", b"image"))
    assert await asyncio.to_thread(started.wait, HELD_SECONDS)
    path = next(iter(source._staged.values())).path
    task.cancel()
    resume.set()

    with pytest.raises(asyncio.CancelledError):
        await task

    assert source._staged == {}
    assert source._writes == {}
    assert not await asyncio.to_thread(path.exists)


async def test_cancelled_release_keeps_its_quota_reservation_until_write_finishes(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch, resume: threading.Event
) -> None:
    source = MaticPhotoMediaSource()
    started = threading.Event()
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        started.set()
        resume.wait(timeout=HELD_SECONDS)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    stage = asyncio.create_task(source.async_stage_photo("entry", "photo", b"image"))
    assert await asyncio.to_thread(started.wait, HELD_SECONDS)
    token = next(iter(source._staged))
    path = source._staged[token].path
    media_id = f"media-source://matic_robot/{token}"
    release = asyncio.create_task(source.async_release(media_id))
    await asyncio.sleep(0)
    release.cancel()
    await asyncio.sleep(0)

    assert not release.done()
    assert token in source._staged
    assert len(source._staged) == 1
    assert await asyncio.to_thread(path.exists) is False

    resume.set()
    with pytest.raises(asyncio.CancelledError):
        await release
    await asyncio.gather(stage, return_exceptions=True)

    assert source._staged == {}
    assert source._writes == {}
    assert not await asyncio.to_thread(path.exists)
    await source.async_close()


async def test_entry_release_joins_held_write_and_prevents_late_publication(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch, resume: threading.Event
) -> None:
    source = photo_attachment_source(hass)
    retained_id = await source.async_stage_photo(
        "entry-two", "photo-two", b"other entry"
    )
    started = threading.Event()
    original_write = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        started.set()
        resume.wait(timeout=HELD_SECONDS)
        return original_write(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    staging = asyncio.create_task(
        source.async_stage_photo("entry-one", "held-photo", b"held image")
    )
    assert await asyncio.to_thread(started.wait, HELD_SECONDS)
    token = next(
        token
        for token, staged in source._staged.items()
        if staged.entry_id == "entry-one"
    )
    path = source._staged[token].path
    releasing = asyncio.create_task(source.async_release_entry("entry-one"))
    await asyncio.sleep(0)
    assert not releasing.done()
    media_id = f"media-source://matic_robot/{token}"
    resolving = asyncio.create_task(
        source.async_resolve_media(MediaSourceItem.from_uri(hass, media_id, None))
    )
    await asyncio.sleep(0)
    assert not resolving.done()
    resume.set()

    with pytest.raises(
        ValueError,
        match=r"runtime changed|released during staging|expired before use",
    ):
        await staging
    with pytest.raises(Unresolvable):
        await resolving
    await releasing

    assert token not in source._staged
    assert not await asyncio.to_thread(path.exists)
    assert await source.async_resolve_media(
        MediaSourceItem.from_uri(hass, retained_id, None)
    )
    await source.async_close()


async def test_expired_blocked_writes_keep_all_attachment_slots_reserved(
    monkeypatch: pytest.MonkeyPatch, resume: threading.Event
) -> None:
    source = MaticPhotoMediaSource()
    started = threading.Event()
    write_lock = threading.Lock()
    write_count = 0
    paths: list[Path] = []
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        nonlocal write_count
        with write_lock:
            write_count += 1
            if write_count == media_source_module.MAX_STAGED_ATTACHMENTS:
                started.set()
        paths.append(path)
        resume.wait(timeout=HELD_SECONDS)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    stages = [
        asyncio.create_task(
            source.async_stage_photo("entry", f"photo-{index}", b"image")
        )
        for index in range(media_source_module.MAX_STAGED_ATTACHMENTS)
    ]
    assert await asyncio.to_thread(started.wait, HELD_SECONDS)
    assert len(source._staged) == media_source_module.MAX_STAGED_ATTACHMENTS
    # Expire each by running its timer now. A short lifetime instead could
    # pass before the last photo is staged, whose own expiry sweep would then
    # wait on a held write and never start its own.
    for timer in tuple(source._expiry_handles.values()):
        expire, arguments = timer._callback, timer._args
        timer.cancel()
        expire(*arguments)
    await asyncio.sleep(0)

    with pytest.raises(ValueError, match="Too many"):
        await source.async_stage_photo("entry", "photo-overflow", b"image")

    assert len(source._staged) == media_source_module.MAX_STAGED_ATTACHMENTS
    resume.set()
    release_tasks = tuple(source._release_tasks.values())
    assert len(release_tasks) == media_source_module.MAX_STAGED_ATTACHMENTS
    await asyncio.gather(*release_tasks)
    stage_results = await asyncio.gather(*stages, return_exceptions=True)
    assert all(isinstance(result, ValueError) for result in stage_results)
    assert source._staged == {}
    assert all(not path.exists() for path in paths)
    await source.async_close()


async def test_staging_does_not_start_after_close_during_expiry_cleanup(
    monkeypatch: pytest.MonkeyPatch, resume: threading.Event
) -> None:
    monkeypatch.setattr(media_source_module, "ATTACHMENT_TTL_SECONDS", 0.01)
    source = MaticPhotoMediaSource()
    started = threading.Event()
    write_count = 0
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        nonlocal write_count
        write_count += 1
        started.set()
        resume.wait(timeout=HELD_SECONDS)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    first_stage = asyncio.create_task(source.async_stage_photo("entry", "first", b"x"))
    assert await asyncio.to_thread(started.wait, HELD_SECONDS)
    await asyncio.sleep(0.03)
    next_stage = asyncio.create_task(source.async_stage_photo("entry", "second", b"y"))
    await asyncio.sleep(0)
    close = asyncio.create_task(source.async_close())
    resume.set()

    await close
    await asyncio.gather(first_stage, return_exceptions=True)
    with pytest.raises(ValueError, match="unavailable"):
        await next_stage

    assert write_count == 1
    assert source._staged == {}


async def test_home_assistant_resolution_rechecks_after_concurrent_release(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch, resume: threading.Event
) -> None:
    assert await async_setup_component(hass, "media_source", {})
    hass.config.components.add("matic_robot")
    source = photo_attachment_source(hass)
    media_id = await source.async_stage_photo("entry", "photo", b"private bytes")
    token = media_id.rsplit("/", maxsplit=1)[-1]
    path = source._staged[token].path
    observed = threading.Event()
    original_is_file = Path.is_file

    def paused_is_file(target: Path) -> bool:
        was_present = original_is_file(target)
        observed.set()
        resume.wait(timeout=HELD_SECONDS)
        return was_present

    monkeypatch.setattr(Path, "is_file", paused_is_file)
    resolving = asyncio.create_task(async_resolve_media(hass, media_id, None))
    assert await asyncio.to_thread(observed.wait, HELD_SECONDS)
    await source.async_release(media_id)
    assert not await asyncio.to_thread(path.exists)
    resume.set()

    with pytest.raises(Unresolvable):
        await resolving

    assert source._staged == {}
    await source.async_close()


async def test_cancelled_internal_release_keeps_reservation_until_retry(
    monkeypatch: pytest.MonkeyPatch, resume: threading.Event
) -> None:
    source = MaticPhotoMediaSource()
    started = threading.Event()
    original_write_bytes = Path.write_bytes

    def blocking_write(path: Path, payload: bytes) -> int:
        started.set()
        resume.wait(timeout=HELD_SECONDS)
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", blocking_write)
    stage = asyncio.create_task(source.async_stage_photo("entry", "photo", b"image"))
    assert await asyncio.to_thread(started.wait, HELD_SECONDS)
    token = next(iter(source._staged))
    media_id = f"media-source://matic_robot/{token}"
    release_wrapper = asyncio.create_task(source.async_release(media_id))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    cleanup = source._release_tasks[token]
    cleanup.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cleanup
    with pytest.raises(asyncio.CancelledError):
        await release_wrapper

    assert token in source._staged
    assert len(source._staged) == 1
    resume.set()
    await asyncio.gather(stage, return_exceptions=True)
    await source.async_release(media_id)

    assert source._staged == {}
    await source.async_close()
