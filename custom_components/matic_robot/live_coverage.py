"""Display changes observed in the native coverage map during one session."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from contextlib import aclosing
from time import monotonic

from google.protobuf.message import DecodeError

from .client.api import MaticHermesClient
from .client.coverage_receipts import native_session_hash
from .client.exceptions import CannotConnectError
from .client.slam_tiles import SlamSemanticTile, decode_slam_mission_id
from .client.wire import first_bytes
from .coverage_changes import CoverageChanges

_LOGGER = logging.getLogger(__name__)
_CHECK_SECONDS = 5.0
_RETRY_SECONDS = 2.0


class LiveCoverage:
    """Track coverage changes during one active run in one coordinate frame."""

    def __init__(
        self,
        client: MaticHermesClient,
        context: Callable[[], tuple[int, object] | None],
    ) -> None:
        self._client = client
        self._context = context
        self._bound_context: tuple[int, object] | None = None
        self._session: bytes | None = None
        self._changes: CoverageChanges | None = None
        self.partial = False
        self.revision = 0
        self.generation = 0

    @property
    def ownership_unverified(self) -> bool:
        """A verified baseline stream is required before reporting changes."""
        return self._changes is None

    def current(self) -> tuple[SlamSemanticTile, ...] | None:
        """Return only pages belonging to the currently verified frame."""
        if self._bound_context is None or self._bound_context != self._context():
            return None
        return () if self._changes is None else self._changes.visible_pages()

    def _clear(self) -> None:
        self._bound_context = None
        self._session = None
        self._changes = None
        self.partial = False
        self.revision += 1
        self.generation += 1

    async def async_current(self) -> tuple[SlamSemanticTile, ...] | None:
        """Revalidate task activity and private identity before serving pages."""
        context = self._bound_context
        session = self._session
        generation = self.generation
        if context is None or session is None or context != self._context():
            return None
        current_session = await self._client.async_get_cleaning_session_identity()
        active = await self._client.async_get_active_cleaning_session_state()
        if (
            current_session != session
            or self._bound_context != context
            or self.generation != generation
        ):
            raise CannotConnectError("coverage session changed or is unknown")
        if active is not True:
            # A retained property cannot carry a baseline across a task end
            # or an interval whose activity cannot be verified.
            self._clear()
            return None
        return self.current()

    async def watch(self) -> None:
        """Restart from an empty page set after any stream or session change."""
        while True:
            try:
                context = self._context()
                if context is not None:
                    session = await self._client.async_get_cleaning_session_identity()
                    active = (
                        await self._client.async_get_active_cleaning_session_state()
                    )
                    if session and active is True and self._context() == context:
                        await self._watch_session(context, session)
            except Exception:
                _LOGGER.debug("Live coverage stream failed", exc_info=True)
            finally:
                self._clear()
            await asyncio.sleep(_RETRY_SECONDS)

    async def _watch_session(self, context: tuple[int, object], session: bytes) -> None:
        # The active-session property identifies the floor and run. Its sequence
        # excludes pre-run deliveries, but cannot certify any retained cells.
        # Start a single page stream and use its first sample per key as baseline.
        self._bound_context = context
        self._session = session
        self.partial = True
        self.generation += 1
        markers = await self._client.async_get_tracked_collection_entries(
            "active_session_key", limit=1
        )
        if self._context() != context:
            return
        marker = markers[0] if markers else None
        if (
            marker is None
            or marker.deleted
            or marker.value != session
            or native_session_hash(session, active=True) is None
            or decode_slam_mission_id(first_bytes(session, 1)) != context[0]
            or marker.sequence_start_ns is None
            or marker.sequence_no is None
        ):
            # Expose the active-but-unavailable state while awaiting a retry.
            await asyncio.sleep(_RETRY_SECONDS)
            return
        changes = CoverageChanges(
            context[0], marker.sequence_start_ns, marker.sequence_no
        )
        self._changes = changes
        self.generation += 1
        stream = self._client.async_subscribe_collection_entries(
            "map_combined_coverage", include_deletions=True
        )
        async with aclosing(stream):
            pending = asyncio.create_task(anext(stream))
            next_check = monotonic() + _CHECK_SECONDS
            try:
                while self._bound_context == context and self._context() == context:
                    done, _ = await asyncio.wait(
                        {pending}, timeout=max(0.0, next_check - monotonic())
                    )
                    if pending in done:
                        try:
                            entry = pending.result()
                        except StopAsyncIteration:
                            return
                        if self._bound_context != context or self._context() != context:
                            return
                        try:
                            changed = changes.update(entry)
                        except DecodeError:
                            changed = False  # No decodable page key.
                        if changed:
                            self.revision += 1
                        pending = asyncio.create_task(anext(stream))
                    if monotonic() >= next_check:
                        current_session = (
                            await self._client.async_get_cleaning_session_identity()
                        )
                        active = (
                            await self._client.async_get_active_cleaning_session_state()
                        )
                        if (
                            current_session != session
                            or active is not True
                            or self._context() != context
                        ):
                            return
                        next_check = monotonic() + _CHECK_SECONDS
            finally:
                pending.cancel()
                # Consume the child result without swallowing cancellation of
                # the watcher itself if HA unloads the entry during cleanup.
                await asyncio.gather(pending, return_exceptions=True)
