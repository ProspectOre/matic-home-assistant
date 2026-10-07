"""Bounded mixed-readback failures must remain diagnosable without robot IDs."""

import asyncio
import logging
from collections import Counter
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest

from custom_components.matic_robot.client.api import (
    MaticHermesClient,
    _log_mixed_readback_timeout,
)
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    encode_mixed_coverage_commands,
)
from custom_components.matic_robot.client.coverage_goals import (
    coverage_command_goal_signatures,
    coverage_plan_goal_signatures,
)
from custom_components.matic_robot.client.exceptions import MaticError
from tests.test_mixed_coverage import coverage_plan_from_command

LOGGER = "custom_components.matic_robot.client.api"


async def test_poll_sleep_timeout_keeps_specific_error_and_private_goal_deltas(
    monkeypatch, caplog
):
    """Reproduce #218: fast mismatching reads, then expiry inside the sleep."""
    rooms = [str(UUID(int=value)) for value in range(1, 6)]
    command_ids = iter(UUID(int=value) for value in range(100, 200))
    commands = encode_mixed_coverage_commands(
        mission_id=42,
        partition_id=str(UUID(int=10)),
        region_ids=rooms,
        settings=[CoverageSetting.OPTIMAL] * 5,
        modes=[CleaningMode.BOTH] * 2 + [CleaningMode.VACUUM] * 3,
        command_id_factory=lambda: next(command_ids),
    )
    expected = Counter(coverage_command_goal_signatures(commands.update))
    payload = coverage_plan_from_command(commands.update, drop_goal_index=-2)
    actual = Counter(coverage_plan_goal_signatures(payload))
    missing = next(iter(expected - actual))
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_property = AsyncMock(return_value=payload)
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"owned")
    monkeypatch.setattr(f"{LOGGER}._MIXED_COVERAGE_READBACK_TIMEOUT", 0.01)
    monkeypatch.setattr(f"{LOGGER}._MIXED_COVERAGE_READBACK_INTERVAL", 60.0)
    caplog.set_level(logging.DEBUG, logger=LOGGER)

    with pytest.raises(
        MaticError, match="Mixed coverage readback verification timed out"
    ) as caught:
        await client._async_wait_for_mixed_coverage_readback(
            expected, require_current=Mock(), expected_identity=b"owned"
        )

    assert isinstance(caught.value.__cause__, TimeoutError)
    client.async_get_property.assert_awaited_once_with("coverage_plan")
    assert "stage=poll_interval" in caplog.text
    assert f"missing=[{(5, *missing[1:], 1)}]" in caplog.text
    assert "unexpected=[]" in caplog.text
    assert all(room not in caplog.text for room in rooms)
    assert str(UUID(int=10)) not in caplog.text
    assert commands.session_id not in caplog.text


@pytest.mark.parametrize("stage", ["coverage_plan", "session_identity"])
async def test_stalled_read_is_bounded_and_reports_last_sample(
    monkeypatch, caplog, stage
):
    """Expiry bounds both the plan request and the subsequent identity guard."""
    client = MaticHermesClient("robot.invalid", 16320)

    async def stalled(*_args):
        await asyncio.Event().wait()

    client.async_get_property = AsyncMock(
        side_effect=stalled if stage == "coverage_plan" else None,
        return_value=b"",
    )
    client.async_get_cleaning_session_identity = AsyncMock(side_effect=stalled)
    monkeypatch.setattr(f"{LOGGER}._MIXED_COVERAGE_READBACK_TIMEOUT", 0.01)
    caplog.set_level(logging.DEBUG, logger=LOGGER)
    with pytest.raises(MaticError, match="readback verification timed out"):
        await client._async_wait_for_mixed_coverage_readback(
            Counter({("private-room", 0, 0, 0, 0): 1}),
            require_current=Mock(),
            expected_identity=b"private-session",
        )
    assert f"stage={stage}" in caplog.text
    if stage == "coverage_plan":
        assert "sample=unobserved" in caplog.text
        assert "actual_count=None" in caplog.text
    else:
        assert "sample=malformed" in caplog.text
        assert "actual_count=0" in caplog.text
    assert "private-" not in caplog.text


async def test_transport_timeout_is_preserved_without_readback_diagnostics(
    monkeypatch, caplog
):
    client = MaticHermesClient("robot.invalid", 16320)
    failure = TimeoutError("transport")
    client.async_get_property = AsyncMock(side_effect=failure)
    monkeypatch.setattr(f"{LOGGER}._MIXED_COVERAGE_READBACK_TIMEOUT", 60.0)
    caplog.set_level(logging.DEBUG, logger=LOGGER)
    with pytest.raises(TimeoutError) as caught:
        await client._async_wait_for_mixed_coverage_readback(
            Counter(), require_current=Mock(), expected_identity=b"owned"
        )
    assert caught.value is failure
    assert not caplog.records


async def test_external_cancellation_is_preserved_without_timeout_diagnostics(
    monkeypatch, caplog
):
    client = MaticHermesClient("robot.invalid", 16320)
    entered = asyncio.Event()

    async def stalled(_name):
        entered.set()
        await asyncio.Event().wait()

    client.async_get_property = AsyncMock(side_effect=stalled)
    monkeypatch.setattr(f"{LOGGER}._MIXED_COVERAGE_READBACK_TIMEOUT", 60.0)
    caplog.set_level(logging.DEBUG, logger=LOGGER)
    task = asyncio.create_task(
        client._async_wait_for_mixed_coverage_readback(
            Counter(), require_current=Mock(), expected_identity=b"owned"
        )
    )
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not caplog.records


def test_goal_diagnostics_bound_deltas_and_redact_unexpected_rooms(caplog):
    expected = Counter({(f"expected-private-{i}", 0, 0, 0, 0): 1 for i in range(33)})
    actual = Counter({(f"unexpected-private-{i}", 1, 0, 1, 0): 2 for i in range(33)})
    caplog.set_level(logging.DEBUG, logger=LOGGER)
    _log_mixed_readback_timeout(
        expected, actual, stage="poll_interval", malformed=False
    )
    assert "sample=observed expected_count=33 actual_count=66" in caplog.text
    assert "missing_omitted=1" in caplog.text
    assert "unexpected_omitted=1" in caplog.text
    assert "(32, 0, 0, 0, 0, 1)" in caplog.text
    assert "(33, 0, 0, 0, 0, 1)" not in caplog.text
    assert "(34, 1, 0, 1, 0, 2)" in caplog.text
    assert "private" not in caplog.text


def test_goal_diagnostics_are_debug_only(caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)
    _log_mixed_readback_timeout(Counter(), None, stage="coverage_plan", malformed=False)
    assert not caplog.records
