"""Hide live coverage until its pages can be associated with a cleaning run."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable

from .client.api import MaticHermesClient
from .client.exceptions import CannotConnectError
from .client.slam_tiles import SlamSemanticTile

_LOGGER = logging.getLogger(__name__)
_CHECK_SECONDS = 5.0


class LiveCoverage:
    """Expose the active run without attributing unverified native pages to it."""

    def __init__(
        self,
        client: MaticHermesClient,
        context: Callable[[], tuple[int, object] | None],
    ) -> None:
        self._client = client
        self._context = context
        self._bound_context: tuple[int, object] | None = None
        self._session: bytes | None = None
        self.partial = False
        self.ownership_unverified = True
        self.revision = 0
        self.generation = 0

    def current(self) -> tuple[SlamSemanticTile, ...] | None:
        """Return an empty, partial layer for a verified active run."""
        if self._bound_context is None or self._bound_context != self._context():
            return None
        return ()

    def _clear(self) -> None:
        self._bound_context = None
        self._session = None
        self.partial = False
        self.revision += 1
        self.generation += 1

    async def async_current(self) -> tuple[SlamSemanticTile, ...] | None:
        """Revalidate the private session before answering a client."""
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

    async def _refresh_session(self) -> None:
        context = self._context()
        session = (
            await self._client.async_get_cleaning_session_identity()
            if context is not None
            else None
        )
        if context != self._context():
            context, session = None, None
        if context == self._bound_context and session == self._session:
            return
        self._clear()
        if context is not None and session:
            self._bound_context = context
            self._session = session
            # Page keys contain a floor mission but no proven run identity.
            # A tracked read has no completion barrier, so even a deletion
            # cannot establish ownership of a subsequently delivered page.
            self.partial = True
            self.generation += 1

    async def watch(self) -> None:
        """Keep the active-run availability state current and fail closed."""
        try:
            while True:
                try:
                    await self._refresh_session()
                except Exception:
                    self._clear()
                    _LOGGER.debug("Live coverage session check failed", exc_info=True)
                await asyncio.sleep(_CHECK_SECONDS)
        finally:
            self._clear()
