"""Read-only Home Assistant LLM and MCP operations surface."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import voluptuous as vol
from homeassistant.core import Context, Event
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import llm

from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    RobotInfo,
    RobotOperationalState,
    RobotState,
    RobotTelemetry,
    Room,
)
from custom_components.matic_robot.llm import (
    LLM_API_ID,
    MAX_RECENT_EVENTS,
    MaticGetNativeHistoryTool,
    MaticGetOperationsTool,
    MaticGetPlanTool,
    MaticGetRecentEventsTool,
    MaticOperationsAPI,
    _entry_name,
    _loaded_entries,
    _resolve_entry,
    async_register_matic_llm_api,
)
from custom_components.matic_robot.plans import CleaningRoom


def _state(*, name: str = "Synthetic Robot", floor_plan: FloorPlan | None = None):
    return RobotState(
        info=RobotInfo(
            "synthetic-serial",
            name,
            "robot.invalid",
            16320,
            "192.0.2.1",
            "2001:db8::1",
            True,
            True,
            True,
            "synthetic-hardware",
        ),
        operational=RobotOperationalState(
            72,
            (1,),
            (207,),
            False,
            False,
            False,
            False,
            True,
            False,
            software_version="172.12",
            current_area="Study",
            previous_area="Kitchen",
        ),
        floor_plan=floor_plan,
        telemetry=RobotTelemetry(
            software_version="172.13",
            active_cleaning_session=True,
        ),
    )


def _entry(
    *,
    name: str = "Synthetic Robot",
    title: str = "Matic fallback",
    entry_id: str = "entry-one",
    floor_plan: FloorPlan | None = None,
):
    manager = MagicMock()
    manager.snapshot.return_value = {
        "active_plan": {
            "plan_id": "whole-home",
            "room_id": "study",
            "room": "Study",
            "status": "running",
        },
        "selected_plan": "whole-home",
        "selected_plan_name": "Whole home",
    }
    manager.lock.return_value.locked.return_value = True
    manager.stop_pending.return_value = False
    manager.pending_native_reconciliation.return_value = {
        "plan_id": "whole-home",
        "room_id": "study",
        "room": "Study",
        "dispatched_at": "2026-08-25T20:00:00+00:00",
        "expires_at": "2026-08-25T20:12:00+00:00",
    }
    state = _state(name=name, floor_plan=floor_plan)
    runtime = SimpleNamespace(
        coordinator=SimpleNamespace(data=state, last_update_success=True),
        cleaning_plans=manager,
        client=SimpleNamespace(async_get_cleaning_session_records=AsyncMock()),
    )
    return SimpleNamespace(
        entry_id=entry_id,
        title=title,
        runtime_data=runtime,
    )


def _hass(*entries, user=None):
    user = user or SimpleNamespace(is_admin=True)
    return SimpleNamespace(
        auth=SimpleNamespace(async_get_user=AsyncMock(return_value=user)),
        bus=SimpleNamespace(async_listen=MagicMock(return_value=MagicMock())),
        config_entries=SimpleNamespace(
            async_loaded_entries=MagicMock(return_value=list(entries))
        ),
    )


def _context(user_id: str | None = "admin") -> llm.LLMContext:
    return llm.LLMContext(
        platform="mcp_server",
        context=Context(user_id=user_id) if user_id is not None else None,
        language="*",
        assistant="conversation",
        device_id=None,
    )


async def test_api_registration_event_capture_and_admin_gate() -> None:
    hass = _hass(_entry())
    api = MaticOperationsAPI(hass)
    api.async_start()
    assert hass.bus.async_listen.call_count == 11

    event_callback = hass.bus.async_listen.call_args_list[0].args[1]
    event_callback(
        Event(
            "matic_robot_room_failed",
            {
                "entry_id": "x" * 300,
                "native_stop_reconciled": True,
                "error": 7,
                "coverage_setting": 1.5,
                "device_id": None,
                "ignored": ["private"],
            },
            time_fired_timestamp=0,
        )
    )
    event = api.recent_events[-1]
    assert event["event_type"] == "matic_robot_room_failed"
    assert len(event["data"]["entry_id"]) == 256
    assert event["data"]["native_stop_reconciled"] is True
    assert event["data"]["error"] == 7
    assert event["data"]["coverage_setting"] == 1.5
    assert event["data"]["device_id"] is None
    assert "ignored" not in event["data"]
    assert "software_version" not in event["data"]

    event_callback(
        Event(
            "matic_robot_firmware_changed",
            {
                "firmware_version": "172.13",
                "previous_version": "172.12",
            },
            time_fired_timestamp=1,
        )
    )
    firmware_event = api.recent_events[-1]
    assert firmware_event["data"] == {
        "firmware_version": "172.13",
        "previous_version": "172.12",
    }

    event_callback(
        Event(
            "matic_robot_cues",
            {"event_type": "intent_classified", "intent": "clean_all"},
            time_fired_timestamp=2,
        )
    )
    cues_event = api.recent_events[-1]
    assert cues_event["data"] == {
        "event_type": "intent_classified",
        "intent": "clean_all",
    }

    event_callback(
        Event(
            "matic_robot_cleaning_finished",
            {
                "started_at": "2026-08-25T20:00:00+00:00",
                "ended_at": "2026-08-25T20:10:00+00:00",
                "duration_seconds": 600,
                "completed": True,
                "rooms": ["Private room", "Other private room"],
                "completed_rooms": ["Private room"],
                "room_durations": {"Private room": 540},
            },
            time_fired_timestamp=3,
        )
    )
    cleaning_event = api.recent_events[-1]
    assert cleaning_event["data"] == {
        "started_at": "2026-08-25T20:00:00+00:00",
        "ended_at": "2026-08-25T20:10:00+00:00",
        "duration_seconds": 600,
        "completed": True,
        "room_count": 2,
        "completed_room_count": 1,
        "room_duration_count": 1,
    }

    missing_context = _context(None)
    with pytest.raises(HomeAssistantError, match="Administrator"):
        await api.async_get_api_instance(missing_context)
    no_user_context = _context()
    no_user_context.context = Context()
    with pytest.raises(HomeAssistantError, match="Administrator"):
        await api.async_get_api_instance(no_user_context)

    hass.auth.async_get_user.side_effect = [None, SimpleNamespace(is_admin=False)]
    for _ in range(2):
        with pytest.raises(HomeAssistantError, match="Administrator"):
            await api.async_get_api_instance(_context())

    hass.auth.async_get_user.side_effect = None
    hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=True)
    instance = await api.async_get_api_instance(_context())
    assert instance.api.id == LLM_API_ID
    assert "never issue" in instance.api_prompt
    assert [tool.name for tool in instance.tools] == [
        "MaticGetOperations",
        "MaticGetPlan",
        "MaticGetNativeHistory",
        "MaticGetRecentEvents",
    ]

    with patch("custom_components.matic_robot.llm.llm.async_register_api") as register:
        registered = async_register_matic_llm_api(hass)
    register.assert_called_once_with(hass, registered)
    assert hass.bus.async_listen.call_count == 22


async def test_operations_and_robot_resolution() -> None:
    named = _entry()
    fallback = _entry(name="", title="Fallback", entry_id="entry-two")
    hass = _hass(named, fallback)
    result = await MaticGetOperationsTool(MaticOperationsAPI(hass)).async_call(
        hass, llm.ToolInput("MaticGetOperations", {}), _context()
    )
    assert result["read_only"] is True
    assert result["robot_count"] == 2
    robot = result["robots"][0]
    assert robot["name"] == "Synthetic Robot"
    assert robot["coordinator_available"] is True
    assert robot["robot"] == {
        "activity": "error",
        "battery_percentage": 72,
        "current_room": "Study",
        "previous_room": "Kitchen",
        "error_codes": [207],
        "native_session_active": True,
        "software_version": "172.13",
    }
    assert robot["managed_runner"]["lock_held"] is True
    assert robot["native_reconciliation"]["room"] == "Study"
    assert _entry_name(fallback) == "Fallback"

    assert _resolve_entry(_hass(named), None) is named
    with pytest.raises(HomeAssistantError, match="Specify one"):
        _resolve_entry(hass, None)
    assert _resolve_entry(hass, "ENTRY-ONE") is named
    assert _resolve_entry(hass, "matic FALLBACK") is named
    assert _resolve_entry(hass, "fallback") is fallback
    with pytest.raises(HomeAssistantError, match="Unknown Matic robot"):
        _resolve_entry(hass, "missing")
    with pytest.raises(HomeAssistantError, match="No loaded"):
        _loaded_entries(_hass())


async def test_plan_tool_reports_exact_leg_boundaries() -> None:
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room("kitchen", "Kitchen", "kitchen", b"kitchen", ()),
            Room("study", "Study", "study", b"study", ()),
            Room("hall", "Hall", "hall", b"hall", ()),
        ),
    )
    entry = _entry(floor_plan=floor_plan)
    manager = entry.runtime_data.cleaning_plans
    rooms = [
        CleaningRoom("kitchen", "Kitchen", "vacuum", "quick"),
        CleaningRoom("study", "Study", "vacuum", "quick"),
        CleaningRoom("hall", "Hall", "vacuum_and_mop", "optimal"),
    ]
    manager.rooms_for_plan.return_value = (
        {
            "id": "whole-home",
            "name": "Whole home",
            "run_behavior": "intelligent",
            "return_to_base": True,
        },
        rooms,
    )
    manager.choose.return_value = rooms
    hass = _hass(entry)
    tool = MaticGetPlanTool(MaticOperationsAPI(hass))
    result = await tool.async_call(hass, llm.ToolInput(tool.name, {}), _context())
    assert result["preview_scope"] == "next_run"
    assert result["active_run_for_plan"] is True
    assert result["settings_boundary_count"] == 1
    assert result["legs"][0]["rooms"] == [
        {"id": "kitchen", "name": "Kitchen"},
        {"id": "study", "name": "Study"},
    ]
    assert result["legs"][0]["dock_between_rooms"] == "not_expected"
    assert result["legs"][0]["handoff_after_leg"] == "firmware_may_touch_dock"
    assert result["legs"][1]["handoff_after_leg"] == "final_leg"

    manager.rooms_for_plan.return_value = (
        {"id": "saved", "run_behavior": "saved_order", "return_to_base": False},
        rooms[:1],
    )
    manager.snapshot.return_value = {"active_plan": None}
    ordered = await tool.async_call(
        hass, llm.ToolInput(tool.name, {"plan": "saved"}), _context()
    )
    assert ordered["preview_scope"] == "next_run"
    assert ordered["active_run_for_plan"] is False
    assert ordered["plan"]["name"] == "saved"

    no_map = _entry()
    no_map_hass = _hass(no_map)
    with pytest.raises(HomeAssistantError, match="room map"):
        await MaticGetPlanTool(MaticOperationsAPI(no_map_hass)).async_call(
            no_map_hass, llm.ToolInput(tool.name, {}), _context()
        )
    manager.rooms_for_plan.side_effect = KeyError("missing")
    with pytest.raises(HomeAssistantError, match="plan is unavailable"):
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"robot": "entry-one"}), _context()
        )
    with pytest.raises(vol.Invalid):
        await tool.async_call(hass, llm.ToolInput(tool.name, {"plan": ""}), _context())


async def test_native_history_is_bounded_sanitized_and_failure_safe() -> None:
    entry = _entry()
    records = (
        CleaningSessionRecord(
            b"new-secret-key",
            CleaningSession(
                "2026-08-25T20:00:00+00:00",
                "2026-08-25T20:10:00+00:00",
                600,
                ("Study",),
                (("Study", 540),),
                True,
                ("Study",),
            ),
        ),
        CleaningSessionRecord(
            b"old-secret-key",
            CleaningSession(
                "2026-08-24T20:00:00+00:00",
                None,
                None,
                ("Kitchen",),
                (),
                False,
                (),
            ),
        ),
    )
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = records
    hass = _hass(entry)
    tool = MaticGetNativeHistoryTool(MaticOperationsAPI(hass))
    result = await tool.async_call(
        hass, llm.ToolInput(tool.name, {"limit": "1"}), _context()
    )
    assert len(result["sessions"]) == 1
    assert result["sessions"][0]["completed_rooms"] == ["Study"]
    assert result["sessions"][0]["room_durations"] == [
        {"room": "Study", "duration_seconds": 540}
    ]
    assert "key" not in result["sessions"][0]

    entry.runtime_data.client.async_get_cleaning_session_records.side_effect = (
        CannotConnectError("synthetic outage")
    )
    with pytest.raises(HomeAssistantError, match="history is unavailable"):
        await tool.async_call(hass, llm.ToolInput(tool.name, {}), _context())
    with pytest.raises(vol.Invalid):
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"limit": MAX_RECENT_EVENTS}), _context()
        )


async def test_recent_events_returns_newest_first_and_honors_limit() -> None:
    api = MaticOperationsAPI(_hass(_entry()))
    for index in range(MAX_RECENT_EVENTS + 1):
        api._async_capture_event(
            Event(
                "matic_robot_room_started",
                {"room": f"Room {index}"},
                time_fired_timestamp=index,
            )
        )
    tool = MaticGetRecentEventsTool(api)
    result = await tool.async_call(
        api.hass, llm.ToolInput(tool.name, {"limit": 2}), _context()
    )
    assert len(api.recent_events) == MAX_RECENT_EVENTS
    assert [item["data"]["room"] for item in result["events"]] == [
        f"Room {MAX_RECENT_EVENTS}",
        f"Room {MAX_RECENT_EVENTS - 1}",
    ]
    assert "current Home Assistant process" in result["retention"]
