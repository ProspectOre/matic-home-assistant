"""Bounded, payload-free command and raw-state evidence for local diagnosis."""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Callable
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from .models import RobotOperationalState

_LOGGER = logging.getLogger(__name__)
MAX_OBSERVATIONS = 512
ObservationCallback = Callable[[dict[str, Any]], None]


class ActivityJournal:
    """Order observations within one client lifetime, without retaining payloads.

    Timestamps are local receipt times, not robot event times. Separate poll and
    push cursors avoid mistaking a slower poll for a reversal in the push stream.
    Transport acknowledgement is not proof that a command was executed.
    """

    def __init__(self, callback: ObservationCallback | None = None) -> None:
        self._callback = callback
        self._session = uuid4().hex
        self._sequence = 0
        self._run_id: str | None = None
        self._events: deque[dict[str, Any]] = deque(maxlen=MAX_OBSERVATIONS)
        self._states: dict[str, tuple[tuple[int, ...], tuple[int, ...]]] = {}
        self.record("started")

    @property
    def snapshot(self) -> list[dict[str, Any]]:
        """Return detached records, oldest first; older evidence is evicted."""
        return deepcopy(list(self._events))

    def set_run_id(self, run_id: str | None) -> None:
        """Associate subsequent integration observations with one managed run."""
        self._run_id = run_id if isinstance(run_id, str) and run_id else None

    def record(self, kind: str, **fields: Any) -> int:
        """Record only fields constructed by the client's observation sites."""
        self._sequence += 1
        event = {
            "observation_session": self._session,
            "sequence": self._sequence,
            "observed_at": datetime.now(UTC).isoformat(),
            "kind": kind,
            **fields,
        }
        if self._run_id is not None:
            event["run_id"] = self._run_id
        self._events.append(event)
        if self._callback is not None:
            try:
                self._callback(deepcopy(event))
            except Exception:
                # Observer failures must not alter robot commands or disclose
                # an exception message that might contain private material.
                _LOGGER.warning("Matic activity observer failed")
        return self._sequence

    def observe_state(
        self, state: RobotOperationalState, source: Literal["poll", "push"]
    ) -> None:
        """Record raw code changes before HA error confirmation or filtering."""
        signature = (state.state_codes, state.error_codes)
        if self._states.get(source) == signature:
            return
        self._states[source] = signature
        self.record(
            "state",
            source=source,
            state_codes=list(state.state_codes),
            error_codes=list(state.error_codes),
            activity=state.activity,
        )
