"""Collect native coverage pages while a verified cleaning session is active."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Callable
from contextlib import aclosing, suppress
from time import monotonic

from google.protobuf.message import DecodeError

from .client.api import MaticHermesClient
from .client.exceptions import CannotConnectError
from .client.floor_types import mission_token
from .client.models import HermesCollectionEntry
from .client.slam_tiles import (
    MAX_SLAM_TILES,
    SlamSemanticTile,
    decode_semantic_page_key,
    decode_slam_semantic_tile,
)

_LOGGER = logging.getLogger(__name__)
_CHECK_SECONDS = 5.0
_RETRY_SECONDS = 2.0


class LiveCoverage:
    """Keep bounded pages for one native run and one map coordinate frame."""

    def __init__(
        self,
        client: MaticHermesClient,
        context: Callable[[], tuple[int, object] | None],
    ) -> None:
        self._client = client
        self._context = context
        self._bound_context: tuple[int, object] | None = None
        self._session: bytes | None = None
        self._pages: dict[tuple[int, int], SlamSemanticTile] = {}
        self.revision = 0
        self.generation = 0

    def current(self) -> tuple[SlamSemanticTile, ...] | None:
        """Return only pages belonging to the currently verified frame."""
        if self._bound_context is None or self._bound_context != self._context():
            return None
        return tuple(self._pages.values())

    def _clear(self) -> None:
        self._bound_context = None
        self._session = None
        self._pages.clear()
        self.revision += 1
        self.generation += 1

    async def async_current(self) -> tuple[SlamSemanticTile, ...] | None:
        """Revalidate the private session before giving pages to a client."""
        context = self._bound_context
        session = self._session
        if context is None or session is None or self.current() is None:
            return None
        current_session = await self._client.async_get_cleaning_session_identity()
        if (
            current_session != session
            or self._bound_context != context
            or self._session != session
        ):
            raise CannotConnectError("coverage session changed or is unknown")
        return self.current()

    def _update(self, entry: HermesCollectionEntry, mission: int) -> None:
        x, y, wire_mission = decode_semantic_page_key(entry.key)
        if hashlib.sha256(wire_mission).hexdigest() != mission_token(mission):
            return
        key = (x, y)
        if entry.deleted:
            self._pages.pop(key, None)
        else:
            page = decode_slam_semantic_tile(entry)
            if key not in self._pages and len(self._pages) >= MAX_SLAM_TILES:
                raise DecodeError("too many coverage pages")
            self._pages[key] = page
        self.revision += 1

    async def watch(self) -> None:
        """Restart from an empty page set after any stream or session change."""
        while True:
            try:
                context = self._context()
                if context is not None:
                    session = await self._client.async_get_cleaning_session_identity()
                    if session and self._context() == context:
                        await self._watch_session(context, session)
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOGGER.debug("Live coverage stream failed", exc_info=True)
            finally:
                self._clear()
            await asyncio.sleep(_RETRY_SECONDS)

    async def _watch_session(self, context: tuple[int, object], session: bytes) -> None:
        self._bound_context = context
        self._session = session
        self.generation += 1
        stream = self._client.async_subscribe_collection_entries(
            "map_combined_coverage", include_deletions=True
        )
        async with aclosing(stream):
            pending = asyncio.create_task(anext(stream))
            next_check = monotonic() + _CHECK_SECONDS
            try:
                while self._context() == context:
                    done, _ = await asyncio.wait(
                        {pending}, timeout=max(0.0, next_check - monotonic())
                    )
                    if pending in done:
                        try:
                            entry = pending.result()
                        except StopAsyncIteration:
                            return
                        if self._context() != context:
                            return
                        self._update(entry, context[0])
                        pending = asyncio.create_task(anext(stream))
                    if monotonic() >= next_check:
                        current_session = (
                            await self._client.async_get_cleaning_session_identity()
                        )
                        if current_session != session or self._context() != context:
                            return
                        next_check = monotonic() + _CHECK_SECONDS
            finally:
                pending.cancel()
                with suppress(asyncio.CancelledError, StopAsyncIteration):
                    await pending
