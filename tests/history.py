"""Paired inventory reads for synthetic record-backed robot histories."""

from collections.abc import Awaitable, Callable

from custom_components.matic_robot.client.models import CleaningSessionRecord


async def history_keys(
    reader: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]],
) -> frozenset[bytes]:
    return frozenset(record.key for record in await reader())
