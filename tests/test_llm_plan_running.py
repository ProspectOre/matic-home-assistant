"""Assist's plan preview says whether that plan's run is running, between rooms too."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from homeassistant.helpers import llm

from custom_components.matic_robot.llm_plan import MaticGetPlanTool
from tests.test_llm import _context, _hass
from tests.test_llm_missing_rooms import _plan_entry, _preview


@pytest.mark.parametrize(
    ("running", "locked", "expected"),
    [
        (SimpleNamespace(plan_id="saved"), False, True),
        (SimpleNamespace(plan_id="other"), True, False),
        (None, True, None),
        (None, False, False),
    ],
    ids=["this-plan", "another-plan", "lock-without-run", "idle"],
)
async def test_active_run_for_plan_follows_the_running_run(
    running: SimpleNamespace | None, locked: bool, expected: bool | None
) -> None:
    entry, manager = _plan_entry()
    manager.planning.preview.return_value = _preview()
    # The fixture's stored room is not consulted: only the running run is.
    manager.history.running_run.return_value = running
    manager.control.lock.return_value.locked.return_value = locked
    tool = MaticGetPlanTool()

    result = await tool.async_call(
        _hass(entry), llm.ToolInput(tool.name, {"plan": "saved"}), _context()
    )

    assert result.data["active_run_for_plan"] is expected
