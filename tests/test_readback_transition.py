"""Preference transitions cannot reject a freshly valid coverage plan."""

import asyncio
import logging
from collections import Counter
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.matic_robot.client import api as api_module
from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import CoverageSetting as Setting
from custom_components.matic_robot.client.exceptions import MaticError
from tests.test_deep_mop_readback import _mixed_goals, _override, _plan_for_signatures


@pytest.mark.parametrize("heavy", (False, True))
async def test_fresh_plan_no_longer_needing_override_skips_redundant_state_read(heavy):
    client = MaticHermesClient("robot.invalid", 16320)
    expected = _mixed_goals((Setting.HEAVY_DUTY, Setting.STANDARD))
    first = _plan_for_signatures(_override(expected, omit=True).elements())
    fresh = Counter(
        (region, 3 if heavy and mode == 0 else value, floor, mode, behavior)
        for region, value, floor, mode, behavior in expected.elements()
    )
    client.async_get_property = AsyncMock(
        side_effect=[
            first,
            b"\x12\x00",
            _plan_for_signatures(fresh.elements()),
            MaticError("A redundant preference read must not abort this valid plan"),
        ]
    )
    stages = []
    observed, accepted = await client._async_read_coverage_readback(
        expected, note_stage=stages.append
    )
    assert accepted and observed == fresh
    assert client.async_get_property.await_count == 3
    assert stages == ["coverage_plan", "deep_mop_state_before", "coverage_plan_confirm"]


@pytest.mark.parametrize("which", ("before", "after"))
async def test_stalled_preference_read_reports_its_own_timeout_stage(
    which, monkeypatch, caplog
):
    client = MaticHermesClient("robot.invalid", 16320)
    expected = _mixed_goals()
    plan = _plan_for_signatures(_override(expected, omit=True).elements())
    samples = iter([plan] if which == "before" else [plan, b"\x12\x00", plan])

    async def read(_name):
        sample = next(samples, None)
        if sample is not None:
            return sample
        await asyncio.Event().wait()

    client.async_get_property = AsyncMock(side_effect=read)
    client.async_get_cleaning_session_identity = AsyncMock(return_value=b"owned")
    monkeypatch.setattr(api_module, "_MIXED_COVERAGE_READBACK_TIMEOUT", 0.01)
    with caplog.at_level(logging.DEBUG, logger=api_module.__name__):
        with pytest.raises(MaticError, match="readback verification timed out"):
            await client._async_wait_for_mixed_coverage_readback(
                expected, require_current=Mock(), expected_identity=b"owned"
            )
    assert f"stage=deep_mop_state_{which}" in caplog.text
    client.async_get_cleaning_session_identity.assert_not_awaited()
