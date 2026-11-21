"""Assist's plan tools name the saved rooms a map edit removed."""

from __future__ import annotations

from homeassistant.helpers import llm

from custom_components.matic_robot.client import FloorPlan, Room
from custom_components.matic_robot.llm_plan import (
    MaticGetPlanReadinessTool,
    MaticGetPlanTool,
)
from tests.test_llm import _context, _entry, _hass

SKIPPED = [{"room_id": "room-hall", "name": "Hall", "match_room_id": None}]


def _preview(**extra: object) -> dict:
    kitchen = {
        "room_id": "kitchen",
        "name": "Kitchen",
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "cadence": {},
    }
    return {
        "plan_id": "saved",
        "plan_name": "Saved",
        "run_behavior": "ordered",
        "return_to_base": True,
        "rotation": {},
        "rooms": [kitchen],
        "entries": [{"kind": "room", **kitchen}],
        **extra,
    }


def _plan_entry():
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (Room("kitchen", "Kitchen", "k", b"k", ((0, 0), (1, 0), (0, 1))),),
    )
    entry = _entry(floor_plan=floor_plan)
    manager = entry.runtime_data.cleaning_plans
    manager.catalog.plans.return_value = {
        "saved": {"name": "Saved", "rooms": [{"room_id": "kitchen"}]}
    }
    return entry, manager


async def test_plan_preview_names_the_rooms_the_run_skips() -> None:
    entry, manager = _plan_entry()
    manager.planning.preview.return_value = _preview(missing_rooms=SKIPPED)
    tool = MaticGetPlanTool()

    result = await tool.async_call(
        _hass(entry), llm.ToolInput(tool.name, {"plan": "saved"}), _context()
    )

    assert result.data["skipped_rooms"] == [{"id": "room-hall", "name": "Hall"}]


async def test_plan_readiness_says_which_rooms_runs_skip() -> None:
    entry, manager = _plan_entry()
    tool = MaticGetPlanReadinessTool()
    manager.planning.preview.return_value = _preview()

    ready = await tool.async_call(
        _hass(entry), llm.ToolInput(tool.name, {"plan": "saved"}), _context()
    )
    manager.planning.preview.return_value = _preview(missing_rooms=SKIPPED)
    skipping = await tool.async_call(
        _hass(entry), llm.ToolInput(tool.name, {"plan": "saved"}), _context()
    )

    assert "skipped_rooms" not in ready.data
    assert "skip" not in ready.data["message"]
    assert skipping.data["status"] == "ready"
    assert skipping.data["skipped_rooms"] == [{"id": "room-hall", "name": "Hall"}]
    assert "Runs skip the rooms a map edit" in skipping.data["message"]
