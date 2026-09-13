"""Command causality, raw transition retention, and privacy regressions."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import Event

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import RobotOperationalState
from custom_components.matic_robot.client.observations import (
    MAX_OBSERVATIONS,
    ActivityJournal,
)
from custom_components.matic_robot.const import EVENT_ACTIVITY_OBSERVED
from custom_components.matic_robot.llm import MaticOperationsAPI
from tests.test_api_paths import _OpenMethod, _Stream


def test_raw_transitions_are_bounded_detached_and_payload_free() -> None:
    delivered = []
    journal = ActivityJournal(delivered.append)
    assert journal.current_run_id() is None
    journal.set_run_id("run-1")
    assert journal.current_run_id() == "run-1"
    journal.set_run_id(None)
    assert journal.current_run_id() is None
    state = RobotOperationalState(
        80,
        (101, 119),
        (),
        False,
        False,
        False,
        False,
        True,
        False,
        current_area="private-room",
        software_version="private-version",
    )
    journal.observe_state(state, "push")
    journal.observe_state(state, "push")
    journal.observe_state(replace(state, battery_percentage=79), "push")
    assert len(journal.snapshot) == 2
    docking = replace(state, state_codes=(104, 105, 223, 119), returning=True)
    journal.observe_state(docking, "push")
    journal.observe_state(state, "poll")
    journal.observe_state(docking, "push")
    assert len(journal.snapshot) == 4  # Slow poll must not reset the push cursor.
    journal.observe_state(replace(docking, error_codes=(205,)), "push")
    assert journal.snapshot[-1]["error_codes"] == [205]
    assert "private" not in json.dumps(journal.snapshot)
    delivered[-1]["state_codes"].append(999)
    snapshot = journal.snapshot
    snapshot[-1]["error_codes"].clear()
    assert journal.snapshot[-1]["error_codes"] == [205]
    assert 999 not in journal.snapshot[-1]["state_codes"]
    for i in range(MAX_OBSERVATIONS):
        journal.observe_state(replace(state, state_codes=(i,)), "push")
    assert len(journal.snapshot) == MAX_OBSERVATIONS
    assert journal.snapshot[0]["sequence"] > 1
    assert journal.snapshot[-1]["sequence"] > journal.snapshot[0]["sequence"]
    assert (
        ActivityJournal().snapshot[0]["observation_session"]
        != snapshot[0]["observation_session"]
    )


@pytest.mark.parametrize(
    "response,outcome",
    [(None, "unacknowledged"), (SimpleNamespace(ByteSize=lambda: 4), "acknowledged")],
)
async def test_command_transport_records_attempt_send_and_result(
    monkeypatch, response, outcome
) -> None:
    delivered = []
    client = MaticHermesClient(
        "robot.invalid", 16320, observation_callback=delivered.append
    )
    client._channel = object()
    stream = _Stream(response=response)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda _: SimpleNamespace(SendToChannel=_OpenMethod(stream)),
    )
    await client.async_send_user_command(UserCommand.STOP)
    attempt, sending, result = delivered[1:]
    assert attempt["command"] == "STOP"
    assert sending["command_id"] == result["command_id"] == attempt["sequence"]
    assert result["outcome"] == outcome
    assert stream.request.value == bytes.fromhex("7a040a022200")
    assert "payload" not in json.dumps(delivered)
    assert "robot.invalid" not in json.dumps(delivered)


@pytest.mark.parametrize(
    "error,outcome",
    [
        (CannotConnectError("private-secret"), "failed"),
        (asyncio.CancelledError(), "cancelled"),
    ],
)
async def test_connection_failure_and_cancellation_never_claim_sent(
    error, outcome
) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_connect = AsyncMock(side_effect=error)
    with pytest.raises(type(error)):
        await client.async_send_user_command(UserCommand.DOCK)
    events = client.activity_journal.snapshot
    assert [event["kind"] for event in events] == [
        "started",
        "command_requested",
        "command_result",
    ]
    assert events[-1]["outcome"] == outcome
    assert "private-secret" not in json.dumps(events)


async def test_observer_failure_cannot_block_a_command(monkeypatch, caplog) -> None:
    def broken(_event):
        raise RuntimeError("private-secret")

    client = MaticHermesClient("robot.invalid", 16320, observation_callback=broken)
    client._channel = object()
    stream = _Stream()
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda _: SimpleNamespace(SendToChannel=_OpenMethod(stream)),
    )
    await client.async_send_user_command(UserCommand.STOP)
    assert stream.request is not None
    assert "private-secret" not in caplog.text


def test_mcp_keeps_only_bounded_integer_raw_codes() -> None:
    api = MaticOperationsAPI(SimpleNamespace())
    api._async_capture_event(
        Event(
            EVENT_ACTIVITY_OBSERVED,
            {
                "kind": "state",
                "source": "push",
                "sequence": 2,
                "state_codes": list(range(300)),
                "error_codes": ["private"],
                "payload": "private",
                "room_name": "private",
            },
        )
    )
    event = api.recent_events[-1]
    assert event["data"]["state_codes"] == list(range(256))
    assert "error_codes" not in event["data"]
    assert "private" not in json.dumps(event)
