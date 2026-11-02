"""Short-lived, immutable media attachments for selected AI Task calls."""

from __future__ import annotations

import asyncio
import secrets
import tempfile
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from time import monotonic
from typing import cast

from homeassistant.components.media_player.browse_media import (
    SearchMedia,
    SearchMediaQuery,
)
from homeassistant.components.media_player.errors import SearchError
from homeassistant.components.media_source import (
    BrowseMediaSource,
    MediaSource,
    MediaSourceItem,
    PlayMedia,
    Unresolvable,
)
from homeassistant.core import HomeAssistant

from .const import DOMAIN

DATA_PHOTO_ATTACHMENT_SOURCE = "photo_attachment_source"
MAX_STAGED_ATTACHMENTS = 4
ATTACHMENT_TTL_SECONDS = 120
MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024


class PhotoAttachmentUnavailable(ValueError):
    """A photo attachment belongs to an unloaded or replaced runtime."""


@dataclass(frozen=True, slots=True)
class _StagedAttachment:
    """One immutable photo snapshot awaiting an AI Task attachment read."""

    entry_id: str
    photo_id: str
    path: Path
    expires_at: float


class MaticPhotoMediaSource(MediaSource):
    """Resolve only random, bounded, short-lived photo attachment IDs."""

    name = "Matic private photo attachment"

    def __init__(self) -> None:
        super().__init__(DOMAIN)
        self._directory = tempfile.TemporaryDirectory(prefix="matic-photo-ai-")
        self._staged: dict[str, _StagedAttachment] = {}
        self._writes: dict[str, asyncio.Future[int]] = {}
        self._expiry_handles: dict[str, asyncio.TimerHandle] = {}
        self._cleanup_tasks: set[asyncio.Task[None]] = set()
        self._release_tasks: dict[str, asyncio.Task[None]] = {}
        self._close_task: asyncio.Task[None] | None = None
        self._entry_generations: dict[str, int] = {}
        self._released_entries: set[str] = set()
        self._closed = False

    async def async_stage_photo(
        self,
        entry_id: str,
        photo_id: str,
        image: bytes,
        *,
        expected_generation: int | None = None,
    ) -> str:
        """Snapshot one exact photo and return its unguessable media-source ID."""
        generation = self._entry_generations.get(entry_id, 0)
        self._require_entry_available(entry_id)
        if expected_generation is not None and expected_generation != generation:
            raise PhotoAttachmentUnavailable("Matic photo attachment runtime changed")
        if not image or len(image) > MAX_ATTACHMENT_BYTES:
            raise ValueError("Photo exceeds the AI attachment size limit")
        if len(self._staged) >= MAX_STAGED_ATTACHMENTS:
            raise ValueError("Too many Matic photo attachments are in progress")
        await self._async_expire()
        self._require_entry_available(entry_id)
        if self._entry_generations.get(entry_id, 0) != generation:
            raise PhotoAttachmentUnavailable(
                "Matic photo attachments were released during staging"
            )
        if len(self._staged) >= MAX_STAGED_ATTACHMENTS:
            raise ValueError("Too many Matic photo attachments are in progress")

        token = secrets.token_urlsafe(32)
        media_source_id = f"media-source://{DOMAIN}/{token}"
        path = Path(self._directory.name, f"{token}.webp")
        snapshot = bytes(image)
        loop = asyncio.get_running_loop()
        self._staged[token] = _StagedAttachment(
            entry_id=entry_id,
            photo_id=photo_id,
            path=path,
            expires_at=monotonic() + ATTACHMENT_TTL_SECONDS,
        )
        self._expiry_handles[token] = loop.call_later(
            ATTACHMENT_TTL_SECONDS, self._schedule_release, media_source_id
        )
        write = loop.run_in_executor(None, path.write_bytes, snapshot)
        self._writes[token] = write
        try:
            await asyncio.shield(write)
        except BaseException:
            cleanup = asyncio.create_task(
                self._async_finish_failed_write(media_source_id)
            )
            self._cleanup_tasks.add(cleanup)
            cleanup.add_done_callback(self._forget_cleanup_task)
            await asyncio.shield(cleanup)
            raise
        finally:
            if write.done() and self._writes.get(token) is write:
                self._writes.pop(token, None)
        if (
            self._closed
            or entry_id in self._released_entries
            or self._entry_generations.get(entry_id, 0) != generation
        ):
            await self.async_release(media_source_id)
            raise PhotoAttachmentUnavailable("Matic photo attachment runtime changed")
        if (
            token not in self._staged
            or token in self._release_tasks
            or self._staged[token].expires_at <= monotonic()
        ):
            await self.async_release(media_source_id)
            raise ValueError("Matic photo attachment expired before use")
        return media_source_id

    def capture_entry_generation(self, entry_id: str) -> int:
        """Capture the current loaded-entry epoch before a delayed photo call."""
        self._require_entry_available(entry_id)
        return self._entry_generations.get(entry_id, 0)

    async def async_resolve_media(self, item: MediaSourceItem) -> PlayMedia:
        """Return the immutable staged file for the exact unexpired token."""
        token = item.identifier
        staged = self._staged.get(token)
        if (
            staged is None
            or staged.entry_id in self._released_entries
            or staged.expires_at <= monotonic()
        ):
            await self.async_release(token)
            raise Unresolvable("Matic photo attachment is unavailable")
        exists = await asyncio.get_running_loop().run_in_executor(
            None, staged.path.is_file
        )
        if (
            not exists
            or self._staged.get(token) is not staged
            or staged.entry_id in self._released_entries
            or token in self._release_tasks
            or staged.expires_at <= monotonic()
            or self._closed
        ):
            await self.async_release(token)
            raise Unresolvable("Matic photo attachment is unavailable")
        return PlayMedia(staged.path.as_uri(), "image/webp", path=staged.path)

    async def async_release(self, media_source_id: str) -> None:
        """Forget and delete one staged file after its AI Task finishes."""
        token = media_source_id.rsplit("/", maxsplit=1)[-1]
        task = self._release_tasks.get(token)
        if task is None:
            task = asyncio.create_task(self._async_release_token(token))
            self._release_tasks[token] = task
            self._cleanup_tasks.add(task)
            task.add_done_callback(partial(self._forget_release_task, token))
        await self._await_cleanup(task)

    def activate_entry(self, entry_id: str) -> None:
        """Allow new attachments after a config entry successfully loads."""
        if self._closed or entry_id not in self._released_entries:
            return
        self._released_entries.discard(entry_id)
        self._entry_generations[entry_id] = self._entry_generations.get(entry_id, 0) + 1

    async def async_release_entry(self, entry_id: str) -> None:
        """Fence and remove every attachment owned by one unloaded entry."""
        if entry_id not in self._released_entries:
            self._released_entries.add(entry_id)
            self._entry_generations[entry_id] = (
                self._entry_generations.get(entry_id, 0) + 1
            )
        tokens = tuple(
            token
            for token, attachment in self._staged.items()
            if attachment.entry_id == entry_id
        )
        await asyncio.gather(
            *(
                self.async_release(f"media-source://{DOMAIN}/{token}")
                for token in tokens
            )
        )

    async def async_browse_media(self, item: MediaSourceItem) -> BrowseMediaSource:
        """Keep private photo attachments out of media browsing."""
        raise Unresolvable("Matic photo attachments cannot be browsed")

    async def async_search_media(
        self, item: MediaSourceItem, query: SearchMediaQuery
    ) -> SearchMedia:
        """Keep private photo attachments out of media search."""
        raise SearchError("Matic photo attachments cannot be searched")

    async def async_close(self, _event: object | None = None) -> None:
        """Delete every staged image when Home Assistant stops."""
        if self._close_task is None:
            self._closed = True
            self._close_task = asyncio.create_task(self._async_close())
        await self._await_cleanup(self._close_task)

    async def _async_close(self) -> None:
        """Finish all file writes and cleanup before removing the temp directory."""
        for handle in self._expiry_handles.values():
            handle.cancel()
        self._expiry_handles.clear()
        await asyncio.gather(
            *(self.async_release(token) for token in tuple(self._staged)),
            return_exceptions=True,
        )
        if self._cleanup_tasks:
            await asyncio.gather(*tuple(self._cleanup_tasks), return_exceptions=True)
        await asyncio.get_running_loop().run_in_executor(None, self._directory.cleanup)

    async def _async_release_token(self, token: str) -> None:
        """Join one writer and delete its file before releasing its quota slot."""
        staged = self._staged.get(token)
        if handle := self._expiry_handles.pop(token, None):
            handle.cancel()
        write = self._writes.get(token)
        if write is not None:
            try:
                await asyncio.shield(write)
            except asyncio.CancelledError:
                if not write.cancelled():
                    raise
            except Exception:
                # A failed write can still have created a partial file.
                pass
            if self._writes.get(token) is write:
                self._writes.pop(token, None)
        if staged is not None:
            await asyncio.get_running_loop().run_in_executor(
                None, staged.path.unlink, True
            )
            self._staged.pop(token, None)

    async def _await_cleanup(self, task: asyncio.Task[None]) -> None:
        """Complete cleanup despite caller cancellation, then preserve it."""
        cancelled = False
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                cancelled = True
        task.result()
        if cancelled:
            raise asyncio.CancelledError

    def _forget_release_task(self, token: str, task: asyncio.Task[None]) -> None:
        """Drop a completed per-photo cleanup task and retrieve its exception."""
        if self._release_tasks.get(token) is task:
            self._release_tasks.pop(token, None)
        self._forget_cleanup_task(task)

    async def _async_finish_failed_write(self, media_source_id: str) -> None:
        """Use the shared release task to join a writer and delete its file."""
        await self.async_release(media_source_id)

    def _schedule_release(self, media_source_id: str) -> None:
        """Schedule deletion at expiry even if an AI provider remains pending."""
        token = media_source_id.rsplit("/", maxsplit=1)[-1]
        self._expiry_handles.pop(token, None)
        task = asyncio.create_task(self.async_release(media_source_id))
        self._cleanup_tasks.add(task)
        task.add_done_callback(self._forget_cleanup_task)

    def _forget_cleanup_task(self, task: asyncio.Task[None]) -> None:
        """Retrieve cleanup-task exceptions and drop completed task references."""
        self._cleanup_tasks.discard(task)
        if not task.cancelled():
            task.exception()

    async def _async_expire(self) -> None:
        """Drop files left behind by an interrupted AI Task call."""
        now = monotonic()
        for token, attachment in tuple(self._staged.items()):
            if attachment.expires_at <= now:
                await self.async_release(token)

    def _require_entry_available(self, entry_id: str) -> None:
        """Reject staging for unloaded entries and after source shutdown."""
        if self._closed or entry_id in self._released_entries:
            raise PhotoAttachmentUnavailable("Matic photo attachments are unavailable")


def photo_attachment_source(hass: HomeAssistant) -> MaticPhotoMediaSource:
    """Return the process-local media source used for private photo snapshots."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    source = domain_data.get(DATA_PHOTO_ATTACHMENT_SOURCE)
    if source is None:
        source = MaticPhotoMediaSource()
        domain_data[DATA_PHOTO_ATTACHMENT_SOURCE] = source
        hass.bus.async_listen_once("homeassistant_stop", source.async_close)
    return cast(MaticPhotoMediaSource, source)


async def async_get_media_source(hass: HomeAssistant) -> MediaSource:
    """Provide Matic's private photo source to Home Assistant Media Source."""
    return photo_attachment_source(hass)
