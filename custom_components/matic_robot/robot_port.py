"""The robot as a plan run reaches it: the client's reads and the session stores."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING

from .client.coverage_receipts import CoverageVerifier
from .client.models import CleaningSessionRecord

if TYPE_CHECKING:
    from . import MaticConfigEntry


@dataclass(frozen=True, slots=True)
class RobotPort:
    """What a run reads from the robot and the stores it writes."""

    refresh: Callable[[], Awaitable[None]]
    active_session: Callable[[], Awaitable[bool | None]]
    session_history: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]]
    session_identity: Callable[[], Awaitable[bytes | None]]
    coverage_verifier: CoverageVerifier
    confirm_room_completed: Callable[[str], None]
    set_activity_run_id: Callable[[str | None], None]
    get_activity_run_id: Callable[[], str | None]

    @classmethod
    def for_entry(cls, entry: MaticConfigEntry) -> RobotPort:
        """Bind the port to an entry's client and robot session."""
        client = entry.runtime_data.client
        heartbeat = entry.runtime_data.session.heartbeat
        journal = client.activity_journal
        return cls(
            refresh=heartbeat.async_request_refresh,
            active_session=client.async_get_active_cleaning_session_state,
            # Strict: a history the robot could not read is never empty.
            session_history=partial(
                client.async_get_cleaning_session_records, strict=True
            ),
            session_identity=client.async_get_cleaning_session_identity,
            coverage_verifier=client.async_confirm_coverage_receipt,
            confirm_room_completed=heartbeat.async_confirm_room_completed,
            set_activity_run_id=journal.set_run_id,
            get_activity_run_id=journal.current_run_id,
        )
