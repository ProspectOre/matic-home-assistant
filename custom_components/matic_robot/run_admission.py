"""Coordinate service callers with managed-run admission."""

from __future__ import annotations

import asyncio
from contextvars import ContextVar

admission_event: ContextVar[asyncio.Event | None] = ContextVar(
    "matic_run_admission", default=None
)


def managed_run_admitted() -> None:
    """Tell the service caller that the manager now owns this run."""
    event = admission_event.get()
    if event is not None:
        event.set()
