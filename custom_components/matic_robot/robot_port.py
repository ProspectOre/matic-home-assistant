"""The robot as a plan run reaches it: its commands, reads and session stores."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING, Protocol

from homeassistant.core import CALLBACK_TYPE, HomeAssistant

from .client import (
    CleaningSessionRecord,
    CoverageVerifier,
    MaticError,
    NativeHistoryIncompleteError,
    RobotOperationalState,
)
from .robot_commands import PlanStart, RobotCommands
from .stores import LiveState, Store

if TYPE_CHECKING:
    from . import MaticConfigEntry

_LOGGER = logging.getLogger(__name__)


class SessionHistory(Protocol):
    """A strict read of the robot's retained history.

    With ``session_hash``, it waits for that session's record and returns
    only it.
    """

    def __call__(
        self, *, session_hash: str | None = None
    ) -> Awaitable[tuple[CleaningSessionRecord, ...]]: ...


@dataclass(frozen=True, slots=True)
class RobotPort:
    """What a run sends to and reads from the robot, and the stores it writes.

    ``state`` and ``error`` are the session's stores: the robot's newest
    snapshot, and why it cannot be reached.
    """

    start: Callable[[PlanStart], Awaitable[None]]
    # Skips the rooms still waiting in the run's mission:
    # (motion token, floor token, mission identity).
    end_after_current_room: Callable[[int, str, bytes], Awaitable[None]]
    state: Store[LiveState]
    error: Store[Exception | None]
    refresh: Callable[[], Awaitable[None]]
    active_session: Callable[[], Awaitable[bool | None]]
    fresh_state: Callable[[], Awaitable[object]]
    session_history: SessionHistory
    # The retained history's keys alone, read until the given ones arrive.
    session_keys: Callable[..., Awaitable[frozenset[bytes]]]
    # A fingerprint of the robot's inactive session marker, if it has one.
    idle_session_revision: Callable[[], Awaitable[str | None]]
    session_identity: Callable[[], Awaitable[bytes | None]]
    coverage_verifier: CoverageVerifier
    confirm_room_completed: Callable[[str], None]
    set_activity_run_id: Callable[[str | None], None]
    get_activity_run_id: Callable[[], str | None]

    @classmethod
    def for_entry(
        cls, hass: HomeAssistant, entry: MaticConfigEntry, entity_id: str
    ) -> RobotPort:
        """Bind the port to an entry's client, robot session and vacuum."""
        session = entry.runtime_data.session
        client = entry.runtime_data.client
        heartbeat = session.heartbeat
        journal = client.activity_journal
        commands = RobotCommands(hass, entry, entity_id)
        return cls(
            start=commands.async_start_plan_leg,
            end_after_current_room=commands.async_end_after_current_room,
            state=session.state,
            error=session.error,
            refresh=heartbeat.async_request_refresh,
            active_session=client.async_get_active_cleaning_session_state,
            fresh_state=client.async_get_state,
            # Strict: a history the robot could not read is never empty.
            session_history=partial(
                client.async_get_cleaning_session_records, strict=True
            ),
            session_keys=client.async_get_cleaning_session_keys,
            idle_session_revision=client.async_get_idle_cleaning_session_revision,
            session_identity=client.async_get_cleaning_session_identity,
            coverage_verifier=client.async_confirm_coverage_receipt,
            confirm_room_completed=heartbeat.async_confirm_room_completed,
            set_activity_run_id=journal.set_run_id,
            get_activity_run_id=journal.current_run_id,
        )

    async def history_keys(
        self,
        *,
        session_hash: str | None = None,
        handoff: bool = False,
        expected_hashes: frozenset[str] | None = None,
        raise_incomplete: bool = False,
    ) -> frozenset[bytes] | None:
        """Read the retained history's opaque keys; None when the read fails.

        ``handoff`` reads the key inventory alone, waiting for
        ``expected_hashes``. With ``raise_incomplete``, an entry without a
        session identity raises NativeHistoryIncompleteError instead, since
        retrying does not help until the robot drops it.
        """
        try:
            if handoff:
                return await self.session_keys(
                    session_hash=session_hash, expected_hashes=expected_hashes
                )
            records = await self.session_history(session_hash=session_hash)
        except MaticError as err:
            _LOGGER.debug(
                "Native Matic completion baseline unavailable (%s)", type(err).__name__
            )
            if raise_incomplete and isinstance(err, NativeHistoryIncompleteError):
                raise
            return None
        return frozenset(record.key for record in records)

    async def handoff_revision(self) -> str | None:
        """Read the inactive session marker's fingerprint; None when unknown."""
        try:
            return await self.idle_session_revision()
        except MaticError:
            return None

    def observed(self) -> RobotOperationalState | None:
        """Return the robot's state as its vacuum shows it; None if unreachable."""
        if self.error.value is not None:
            return None
        return self.state.value.operational

    def subscribe(self, listener: Callable[[], None]) -> CALLBACK_TYPE:
        """Call ``listener`` after each change to what ``observed`` returns."""
        removals = (self.state.subscribe(listener), self.error.subscribe(listener))

        def remove() -> None:
            for removal in removals:
                removal()

        return remove
