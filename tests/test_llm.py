"""Read-only Home Assistant LLM and MCP operations surface."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import probatio
import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context, Event, State
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import llm
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    RobotInfo,
    RobotOperationalState,
    RobotState,
    RobotTelemetry,
    Room,
)
from custom_components.matic_robot.client.observations import (
    MAX_OBSERVATIONS,
    ActivityJournal,
)
from custom_components.matic_robot.const import DATA_LLM_API, DOMAIN
from custom_components.matic_robot.llm import (
    _ERRORS,
    LLM_API_ID,
    MAX_NATIVE_HISTORY_ROOM_EVIDENCE,
    MAX_NATIVE_HISTORY_ROOM_EVIDENCE_BYTES,
    MAX_RECENT_EVENTS,
    NON_ADMIN_PROMPT,
    ROBOT_STATUS_PROMPT,
    MaticCleanRoomsTool,
    MaticFirmwareResearchAPI,
    MaticGetActivityTool,
    MaticGetFirmwareTool,
    MaticGetNativeHistoryTool,
    MaticGetOperationsTool,
    MaticGetPlanTool,
    MaticGetRecentEventsTool,
    MaticResetScheduleTool,
    MaticRobotStatusAPI,
    MaticRunPlanTool,
    MaticStopCleaningTool,
    _async_refusal,
    _entry_name,
    _log_run_end,
    _resolve_entry,
    async_get_tools,
    async_register_matic_llm_api,
)
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    plan_floor_token,
    room_cadence_identity,
)

_INTERNAL_TERMS = re.compile(
    r"\bmission|\bleg|\bnative|runner lock|reconciliation marker|opaque key|"
    r"allowlist|payload",
    re.IGNORECASE,
)


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
    manager.plans.return_value = {
        "whole-home": {"name": "Whole home"},
        "saved": {"name": "Saved"},
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
        slam_map=SimpleNamespace(floor_plan_is_current=MagicMock(return_value=True)),
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
        auth=SimpleNamespace(
            async_get_user=AsyncMock(return_value=user),
            async_get_users=AsyncMock(return_value=[]),
        ),
        bus=SimpleNamespace(async_listen=MagicMock(return_value=MagicMock())),
        async_create_task=lambda target, eager_start=True: asyncio.ensure_future(
            target
        ),
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
    api = MaticRobotStatusAPI(hass)
    api.async_start()
    assert hass.bus.async_listen.call_count == 18

    event_callback = hass.bus.async_listen.call_args_list[0].args[1]
    event_callback(
        Event(
            "matic_robot_room_failed",
            {
                "entry_id": "x" * 300,
                "native_stop_reconciled": True,
                "reason_code": "robot_error",
                "cause": "unknown",
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
    assert event["data"]["reason_code"] == "robot_error"
    assert event["data"]["cause"] == "unknown"
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
                "protocol_version": "3",
                "previous_protocol": "2",
            },
            time_fired_timestamp=1,
        )
    )
    firmware_event = api.recent_events[-1]
    assert firmware_event["data"] == {
        "firmware_version": "172.13",
        "previous_version": "172.12",
        "protocol_version": "3",
        "previous_protocol": "2",
    }

    event_callback(
        Event(
            "matic_robot_firmware_analyzed",
            {
                "firmware_version": "172.13",
                "protocol_version": "3",
                "compatibility_status": "compatible",
                "analysis_version": 2,
                "wire_shape_count": 7,
                "availability_changed_endpoints": 1,
                "content_changed_endpoints": 2,
                "new_wire_shape_count": 3,
                "structural_endpoints": ["synthetic endpoint"],
                "wire_shape_changed_endpoints": ["synthetic endpoint"],
                "new_wire_shapes": {"synthetic endpoint": ["opaque shape"]},
                "opaque_secret": "must not be retained",
            },
            time_fired_timestamp=2,
        )
    )
    analysis_event = api.recent_events[-1]
    assert analysis_event["data"] == {
        "firmware_version": "172.13",
        "protocol_version": "3",
        "compatibility_status": "compatible",
        "analysis_version": 2,
        "wire_shape_count": 7,
        "availability_changed_endpoints": 1,
        "content_changed_endpoints": 2,
        "new_wire_shape_count": 3,
    }

    event_callback(
        Event(
            "matic_robot_cues",
            {"event_type": "intent_classified", "intent": "clean_all"},
            time_fired_timestamp=3,
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
            time_fired_timestamp=4,
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

    event_callback(
        Event(
            "matic_robot_plan_finished",
            {
                "run_id": "run-1",
                "room_outcomes": [
                    {"room_id": "room-1", "room": "Kitchen", "outcome": "partial"},
                    {"room_id": "room-2", "room": "Study", "outcome": "unattempted"},
                    {"room": "ignored", "outcome": 7},
                ],
            },
            time_fired_timestamp=5,
        )
    )
    assert api.recent_events[-1]["data"]["room_outcomes"] == [
        {"room_id": "room-1", "room": "Kitchen", "outcome": "partial"},
        {"room_id": "room-2", "room": "Study", "outcome": "unattempted"},
        {"room": "ignored"},
    ]

    no_user_context = _context()
    no_user_context.context = Context()
    hass.auth.async_get_user.side_effect = {
        "member": SimpleNamespace(is_admin=False)
    }.get
    for context in (
        _context(None),
        no_user_context,
        _context("deleted-user"),
        _context("member"),
    ):
        for refused_api in (api, MaticFirmwareResearchAPI(hass)):
            refused = await refused_api.async_get_api_instance(context)
            assert refused.tools == []
            assert refused.api_prompt == NON_ADMIN_PROMPT
    assert NON_ADMIN_PROMPT == (
        "These tools are only for Home Assistant administrators. Ask an administrator."
    )

    hass.auth.async_get_user.side_effect = None
    hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=True)
    instance = await api.async_get_api_instance(_context())
    assert instance.api.id == LLM_API_ID == "matic_robot_operations"
    assert instance.api.name == "Matic: Robot status (administrators only)"
    assert instance.api_prompt.startswith(
        "Answer in plain words (robot, room, plan, cleaning run) and do not "
        "repeat internal terms."
    )
    assert [tool.name for tool in instance.tools] == [
        "MaticGetOperations",
        "MaticGetPlan",
        "MaticGetNativeHistory",
        "MaticGetRecentEvents",
        "MaticGetActivity",
        "MaticGetFirmware",
        "MaticRunPlan",
        "MaticCleanRooms",
        "MaticStopCleaning",
        "MaticResetSchedule",
    ]
    research = await MaticFirmwareResearchAPI(hass).async_get_api_instance(_context())
    assert research.api.id == "matic_robot_firmware_research"
    assert research.api.name == "Matic: Firmware research (administrators only)"
    assert research.api_prompt.startswith("Answer in plain words")
    assert [tool.name for tool in research.tools] == [
        "MaticGetFirmware",
        "MaticClaimFirmwareInvestigation",
        "MaticCompleteFirmwareInvestigation",
    ]
    for tool in (*instance.tools, *research.tools):
        assert tool.integration == DOMAIN
        assert tool.title
        assert isinstance(tool.parameters, type(llm.Tool.parameters))
        assert not _INTERNAL_TERMS.search(tool.description)
        assert tool.annotations.open_world is False
        assert tool.annotations.read_only is tool.name.startswith("MaticGet")
    assert not _INTERNAL_TERMS.search(instance.api_prompt)
    assert not _INTERNAL_TERMS.search(research.api_prompt)

    with patch("custom_components.matic_robot.llm.llm.async_register_api") as register:
        registered = async_register_matic_llm_api(hass)
    assert [call.args[1].id for call in register.call_args_list] == [
        "matic_robot_operations",
        "matic_robot_firmware_research",
    ]
    assert register.call_args_list[0].args == (hass, registered)
    assert hass.bus.async_listen.call_count == 36


async def test_get_firmware_reads_cached_tracker_without_robot_io() -> None:
    entry = _entry()
    second_entry = _entry(name="Synthetic Robot", entry_id="entry-two")
    cached_report = {
        "id": "a" * 24,
        "revision": 3,
        "observation_contexts": ["cleaning"],
    }
    tracker = SimpleNamespace(
        report=MagicMock(return_value=cached_report),
        report_history=MagicMock(return_value=[cached_report]),
    )
    entry.runtime_data.firmware_tracker = tracker
    second_tracker = SimpleNamespace(
        report=MagicMock(return_value={"id": "b" * 24}),
        report_history=MagicMock(return_value=[]),
    )
    second_entry.runtime_data.firmware_tracker = second_tracker
    hass = _hass(entry, second_entry)
    tool = MaticGetFirmwareTool()

    result = (
        await tool.async_call(
            hass,
            llm.ToolInput(tool.name, {"robot": "entry-one", "include_history": True}),
            _context(),
        )
    ).data

    assert result == {
        "read_only": True,
        "robots": [
            {
                "robot": "Synthetic Robot",
                "entry_id": "entry-one",
                "report": cached_report,
                "history": [cached_report],
            }
        ],
    }
    tracker.report.assert_called_once_with("entry-one")
    tracker.report_history.assert_called_once_with("entry-one")
    entry.runtime_data.client.async_get_cleaning_session_records.assert_not_awaited()

    all_robots = (
        await tool.async_call(hass, llm.ToolInput(tool.name, {}), _context())
    ).data
    assert [robot["robot"] for robot in all_robots["robots"]] == [
        "Synthetic Robot",
        "Synthetic Robot",
    ]
    assert [robot["entry_id"] for robot in all_robots["robots"]] == [
        "entry-one",
        "entry-two",
    ]
    assert all("history" not in robot for robot in all_robots["robots"])
    tracker.report_history.assert_called_once_with("entry-one")
    second_tracker.report_history.assert_not_called()


async def test_firmware_research_tool_requires_current_admin() -> None:
    hass = _hass(_entry(), user=SimpleNamespace(is_admin=False))
    tool = MaticGetFirmwareTool()
    with pytest.raises(HomeAssistantError, match="Only a Home Assistant administrator"):
        await tool.async_call(hass, llm.ToolInput(tool.name, {}), _context())

    no_user = _context(None)
    with pytest.raises(HomeAssistantError, match="Only a Home Assistant administrator"):
        await tool.async_call(hass, llm.ToolInput(tool.name, {}), no_user)

    removed_user = _context("deleted-user")
    hass.auth.async_get_user.return_value = None
    with pytest.raises(HomeAssistantError, match="Only a Home Assistant administrator"):
        await tool.async_call(hass, llm.ToolInput(tool.name, {}), removed_user)
    hass.auth.async_get_user.assert_awaited_with("deleted-user")


@pytest.mark.parametrize(
    "tool_name",
    [
        "MaticGetOperations",
        "MaticGetPlan",
        "MaticGetNativeHistory",
        "MaticGetRecentEvents",
        "MaticGetActivity",
    ],
)
async def test_retained_operations_tools_recheck_admin_after_demotion(
    tool_name: str,
) -> None:
    hass = _hass(_entry())
    hass.auth.async_get_user.side_effect = [
        SimpleNamespace(is_admin=True),
        SimpleNamespace(is_admin=False),
    ]
    instance = await MaticRobotStatusAPI(hass).async_get_api_instance(_context())
    tool = next(tool for tool in instance.tools if tool.name == tool_name)

    with pytest.raises(HomeAssistantError, match="Only a Home Assistant administrator"):
        await tool.async_call(hass, llm.ToolInput(tool_name, {}), _context())

    assert hass.auth.async_get_user.await_count == 2


async def test_firmware_claim_and_complete_tools_bind_args_and_errors() -> None:
    from custom_components.matic_robot.llm import (
        MaticClaimFirmwareInvestigationTool,
        MaticCompleteFirmwareInvestigationTool,
    )

    entry = _entry()
    tracker = SimpleNamespace(
        async_claim_investigation=AsyncMock(return_value={"token": "synthetic-token"}),
        async_complete_investigation=AsyncMock(),
    )
    entry.runtime_data.firmware_tracker = tracker
    hass = _hass(entry)
    claim = MaticClaimFirmwareInvestigationTool()
    claim_args = {
        "robot": "entry-one",
        "report_id": "a" * 24,
        "evidence_revision": 4,
        "routing_revision": 2,
        "provider": "researcher",
    }
    assert (
        await claim.async_call(hass, llm.ToolInput(claim.name, claim_args), _context())
    ).data == {"token": "synthetic-token"}
    tracker.async_claim_investigation.assert_awaited_once_with(
        "entry-one",
        report_id="a" * 24,
        evidence_revision=4,
        routing_revision=2,
        provider="researcher",
    )

    complete = MaticCompleteFirmwareInvestigationTool()
    complete_args = {
        **claim_args,
        "token": "synthetic-token-1234",
        "disposition": "needs_evidence",
        "summary": "Synthetic bounded assessment",
        "sources": ["https://example.invalid/source"],
    }
    assert (
        await complete.async_call(
            hass, llm.ToolInput(complete.name, complete_args), _context()
        )
    ).data == {"recorded": True, "robot_control_changed": False}
    tracker.async_complete_investigation.assert_awaited_once_with(
        "entry-one",
        report_id="a" * 24,
        evidence_revision=4,
        routing_revision=2,
        provider="researcher",
        token="synthetic-token-1234",
        disposition="needs_evidence",
        summary="Synthetic bounded assessment",
        sources=["https://example.invalid/source"],
    )

    tracker.async_claim_investigation.side_effect = ValueError("stale claim")
    with pytest.raises(HomeAssistantError, match="stale claim"):
        await claim.async_call(hass, llm.ToolInput(claim.name, claim_args), _context())

    tracker.async_complete_investigation.side_effect = ValueError("expired claim")
    with pytest.raises(HomeAssistantError, match="expired claim"):
        await complete.async_call(
            hass, llm.ToolInput(complete.name, complete_args), _context()
        )


async def test_operations_and_robot_resolution() -> None:
    named = _entry()
    fallback = _entry(name="", title="Fallback", entry_id="entry-two")
    hass = _hass(named, fallback)
    result = (
        await MaticGetOperationsTool().async_call(
            hass, llm.ToolInput("MaticGetOperations", {}), _context()
        )
    ).data
    assert result["read_only"] is True
    assert result["robot_count"] == 2
    robot = result["robots"][0]
    assert robot["name"] == "Synthetic Robot"
    assert robot["coordinator_available"] is True
    assert robot["robot"] == {
        "activity": "cleaning",
        "battery_percentage": 72,
        "current_room": "Study",
        "previous_room": "Kitchen",
        "error_codes": [207],
        "bag_full": None,
        "bag_missing": None,
        "native_session_active": True,
        "software_version": "172.13",
    }
    assert robot["managed_runner"]["lock_held"] is True
    assert robot["native_reconciliation"]["room"] == "Study"
    assert _entry_name(fallback) == "Fallback"


async def test_operations_includes_read_only_bag_observation_when_available() -> None:
    entry = _entry()
    entry.runtime_data.coordinator.bag_observation = {
        "full": False,
        "missing": False,
        "full_events_observed": 1,
        "replacement_events_observed": 1,
        "last_full_at": "2026-09-02T10:00:00+00:00",
        "last_replaced_at": "2026-09-02T10:02:00+00:00",
    }
    hass = _hass(entry)

    result = (
        await MaticGetOperationsTool().async_call(
            hass, llm.ToolInput("MaticGetOperations", {}), _context()
        )
    ).data

    assert result["robots"][0]["robot"]["bag_observation"] == {
        "full": False,
        "missing": False,
        "full_events_observed": 1,
        "replacement_events_observed": 1,
        "last_full_at": "2026-09-02T10:00:00+00:00",
        "last_replaced_at": "2026-09-02T10:02:00+00:00",
    }


async def test_robot_resolution_variants() -> None:
    named = _entry()
    fallback = _entry(name="", title="Fallback", entry_id="entry-two")
    hass = _hass(named, fallback)

    tool = MaticGetOperationsTool()
    assert tool.resolve_entry(_hass(named), _context(), None) is named
    with pytest.raises(HomeAssistantError, match="More than one robot is set up"):
        tool.resolve_entry(hass, _context(), None)
    assert tool.resolve_entry(hass, _context(), "ENTRY-ONE") is named
    assert tool.resolve_entry(hass, _context(), "matic FALLBACK") is named
    assert tool.resolve_entry(hass, _context(), "fallback") is fallback
    duplicate_name = _entry(entry_id="entry-three")
    duplicates = [named, duplicate_name]
    assert _resolve_entry(duplicates, "ENTRY-ONE") is named
    with pytest.raises(HomeAssistantError, match="More than one robot has that name"):
        _resolve_entry(duplicates, "Synthetic Robot")
    with pytest.raises(HomeAssistantError, match="No robot is named missing"):
        tool.resolve_entry(hass, _context(), "missing")
    with pytest.raises(HomeAssistantError, match="No robot is set up"):
        tool.entries(_hass(), _context())


async def test_plan_tool_projects_the_manager_preview_for_intelligent_and_saved_order(
    hass,
) -> None:
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
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room_map = {room.id: room.name for room in floor_plan.rooms}
    await manager.async_save_plan(
        "synthetic-serial",
        "whole-home",
        {
            "name": "Whole home",
            "enabled": True,
            "run_behavior": "intelligent",
            "return_to_base": True,
            "rooms": [
                {
                    "room_id": "kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
                {
                    "room_id": "study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
                {
                    "room_id": "hall",
                    "cleaning_mode": "vacuum_and_mop",
                    "coverage_setting": "heavy_duty",
                },
            ],
        },
    )
    entry = _entry(floor_plan=floor_plan)
    entry.runtime_data.cleaning_plans = manager
    hass = _hass(entry)
    tool = MaticGetPlanTool()
    result = (
        await tool.async_call(hass, llm.ToolInput(tool.name, {}), _context())
    ).data
    expected = manager.preview(
        "synthetic-serial",
        room_map,
        "whole-home",
        floor_token=plan_floor_token(floor_plan),
        room_identities={
            room.id: room_cadence_identity(floor_plan, room.id)
            for room in floor_plan.rooms
        },
    )
    assert result["preview_scope"] == "next_run"
    assert result["active_run_for_plan"] is False
    assert result["settings_boundary_count"] == 0
    assert [item["id"] for item in result["legs"][0]["rooms"]] == [
        room["room_id"] for room in expected["rooms"]
    ]
    assert result["legs"][0]["rooms"][2]["cleaning_mode"] == "vacuum_and_mop"
    assert result["legs"][0]["cleaning_mode"] == "mixed"
    assert result["legs"][0]["coverage_setting"] == "mixed"
    assert result["rotation"] == expected["rotation"]
    assert (
        result["legs"][0]["dock_between_rooms"]
        == "firmware_resource_servicing_possible"
    )
    assert result["legs"][0]["handoff_after_leg"] == "final_leg"

    await manager.async_save_plan(
        "synthetic-serial",
        "saved",
        {
            "name": "Saved order",
            "enabled": True,
            "run_behavior": "ordered",
            "return_to_base": False,
            "rooms": [
                {
                    "room_id": "hall",
                    "cleaning_mode": "vacuum_and_mop",
                    "coverage_setting": "heavy_duty",
                },
                {
                    "room_id": "kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            ],
        },
    )
    ordered = (
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"plan": "saved order"}), _context()
        )
    ).data
    expected_ordered = manager.preview(
        "synthetic-serial",
        room_map,
        "saved",
        floor_token=plan_floor_token(floor_plan),
        room_identities={
            room.id: room_cadence_identity(floor_plan, room.id)
            for room in floor_plan.rooms
        },
    )
    assert ordered["preview_scope"] == "next_run"
    assert ordered["active_run_for_plan"] is False
    assert ordered["plan"]["name"] == "Saved order"
    assert [room["id"] for room in ordered["legs"][0]["rooms"]] == [
        room["room_id"] for room in expected_ordered["rooms"]
    ]
    assert ordered["rotation"] == expected_ordered["rotation"]
    assert ordered["plan"]["return_to_base"] is False

    await manager.async_save_plan(
        "synthetic-serial",
        "named-id",
        {
            "name": "Unique name",
            "enabled": True,
            "rooms": [
                {
                    "room_id": "kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            ],
        },
    )
    by_name = (
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"plan": "unique NAME"}), _context()
        )
    ).data
    assert by_name["plan"]["id"] == "named-id"

    await manager.async_save_plan(
        "synthetic-serial",
        "first-id",
        {
            "name": "Shared name",
            "enabled": True,
            "rooms": [
                {
                    "room_id": "kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            ],
        },
    )
    await manager.async_save_plan(
        "synthetic-serial",
        "second-id",
        {
            "name": "Shared name",
            "enabled": True,
            "rooms": [
                {
                    "room_id": "study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            ],
        },
    )
    by_id = (
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"plan": "first-id"}), _context()
        )
    ).data
    assert by_id["plan"]["id"] == "first-id"
    with pytest.raises(HomeAssistantError, match="No plan is named missing"):
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"plan": "missing"}), _context()
        )

    no_map = _entry()
    no_map_hass = _hass(no_map)
    with pytest.raises(HomeAssistantError, match="room map"):
        await MaticGetPlanTool().async_call(
            no_map_hass, llm.ToolInput(tool.name, {}), _context()
        )

    with pytest.raises(
        HomeAssistantError, match="More than one plan is named Shared name"
    ):
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"plan": "Shared name"}), _context()
        )

    with pytest.raises(probatio.Invalid):
        await tool.async_call(hass, llm.ToolInput(tool.name, {"plan": ""}), _context())


async def test_plan_tool_projects_real_manager_cadence_preview(hass) -> None:
    floor_plan = FloorPlan(
        3,
        "partition",
        b"partition",
        (Room("kitchen", "Kitchen", "kitchen", b"kitchen", ()),),
    )
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "synthetic-serial",
        "home",
        {
            "name": "Home",
            "enabled": True,
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": "kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "plan",
                        "mop_every_n": 3,
                        "coverage_every_n": 2,
                        "periodic_coverage_setting": "heavy_duty",
                    },
                }
            ],
        },
    )
    progress_record = manager._robot("synthetic-serial")["plan_room_cadence"][
        "home"
    ].setdefault("kitchen", {"progress": {"mop": 0, "coverage": 0}})
    progress = progress_record["progress"]
    progress.update(mop=2, coverage=1)
    entry = _entry(floor_plan=floor_plan)
    entry.runtime_data.cleaning_plans = manager

    hass = _hass(entry)
    result = (
        await MaticGetPlanTool().async_call(
            hass, llm.ToolInput("MaticGetPlan", {}), _context()
        )
    ).data

    expected = manager.preview(
        "synthetic-serial",
        {"kitchen": "Kitchen"},
        "home",
        floor_token=plan_floor_token(floor_plan),
        room_identities={"kitchen": room_cadence_identity(floor_plan, "kitchen")},
    )
    projected_room = result["legs"][0]["rooms"][0]
    assert expected["rooms"][0]["cadence"]["mop_due"] is True
    assert expected["rooms"][0]["cadence"]["coverage_due"] is True
    assert projected_room["cleaning_mode"] == "vacuum_and_mop"
    assert projected_room["coverage_setting"] == "heavy_duty"
    assert projected_room["cadence_reasons"] == ["mop_due", "coverage_due"]
    assert projected_room["cadence"] == expected["rooms"][0]["cadence"]

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
    with pytest.raises(HomeAssistantError, match="room map is being checked"):
        await MaticGetPlanTool().async_call(
            hass, llm.ToolInput("MaticGetPlan", {}), _context()
        )

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = True

    manager._robot("synthetic-serial")["plans"]["home"]["rooms"][0]["cadence"][
        "mop_every_n"
    ] = True
    with pytest.raises(HomeAssistantError, match="The plan can't be previewed"):
        await MaticGetPlanTool().async_call(
            hass, llm.ToolInput("MaticGetPlan", {}), _context()
        )


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
    tool = MaticGetNativeHistoryTool()
    result = (
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"limit": "1"}), _context()
        )
    ).data
    assert len(result["sessions"]) == 1
    assert result["sessions"][0]["room_evidence"] == [
        {
            "room": "Study",
            "visited": True,
            "completed": True,
            "duration_seconds": 540,
        }
    ]
    assert "key" not in result["sessions"][0]

    bounded_names = tuple(
        f"Synthetic room {index:03d} " + ("x" * 490) for index in range(80)
    )
    bounded_records = tuple(
        CleaningSessionRecord(
            f"opaque-secret-{record_index}".encode(),
            CleaningSession(
                f"2026-08-{25 - record_index:02d}T20:00:00+00:00",
                f"2026-08-{25 - record_index:02d}T20:10:00+00:00",
                600,
                bounded_names,
                tuple((room, 540) for room in bounded_names),
                True,
                bounded_names,
            ),
        )
        for record_index in range(2)
    )
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        bounded_records
    )
    bounded = (
        await tool.async_call(hass, llm.ToolInput(tool.name, {"limit": 2}), _context())
    ).data
    evidence = [
        item for session in bounded["sessions"] for item in session["room_evidence"]
    ]
    assert len(evidence) <= MAX_NATIVE_HISTORY_ROOM_EVIDENCE
    assert (
        sum(len(item["room"].encode("utf-8")) for item in evidence)
        <= MAX_NATIVE_HISTORY_ROOM_EVIDENCE_BYTES
    )
    assert any(session["room_evidence_truncated"] for session in bounded["sessions"])
    assert bounded["room_evidence_limits"] == {
        "max_items_across_response": MAX_NATIVE_HISTORY_ROOM_EVIDENCE,
        "max_utf8_bytes_across_response": MAX_NATIVE_HISTORY_ROOM_EVIDENCE_BYTES,
    }
    assert "opaque-secret" not in str(bounded)

    entry.runtime_data.client.async_get_cleaning_session_records.side_effect = (
        CannotConnectError("synthetic outage")
    )
    with pytest.raises(HomeAssistantError, match="cleaning history is unavailable"):
        await tool.async_call(hass, llm.ToolInput(tool.name, {}), _context())
    with pytest.raises(probatio.Invalid):
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"limit": MAX_RECENT_EVENTS}), _context()
        )


async def test_recent_events_returns_newest_first_and_honors_limit() -> None:
    api = MaticRobotStatusAPI(_hass(_entry()))
    for index in range(MAX_RECENT_EVENTS + 1):
        api._async_capture_event(
            Event(
                "matic_robot_room_started",
                {"room": f"Room {index}"},
                time_fired_timestamp=index,
            )
        )
    tool = MaticGetRecentEventsTool(api)
    result = (
        await tool.async_call(
            api.hass, llm.ToolInput(tool.name, {"limit": 2}), _context()
        )
    ).data
    assert len(api.recent_events) == MAX_RECENT_EVENTS
    assert [item["data"]["room"] for item in result["events"]] == [
        f"Room {MAX_RECENT_EVENTS}",
        f"Room {MAX_RECENT_EVENTS - 1}",
    ]
    assert "current Home Assistant process" in result["retention"]


async def test_recent_events_keep_operational_evidence_out_of_activity_churn() -> None:
    api = MaticRobotStatusAPI(_hass(_entry()))
    api._async_capture_event(
        Event(
            "matic_robot_room_started",
            {"room": "Hallway"},
            time_fired_timestamp=0,
        )
    )
    for index in range(MAX_RECENT_EVENTS + 10):
        api._async_capture_event(
            Event(
                "matic_robot_activity_observed",
                {"sequence": index, "kind": "state"},
                time_fired_timestamp=index + 1,
            )
        )

    operational = (
        await MaticGetRecentEventsTool(api).async_call(
            api.hass, llm.ToolInput("MaticGetRecentEvents", {"limit": 1}), _context()
        )
    ).data
    combined = (
        await MaticGetRecentEventsTool(api).async_call(
            api.hass,
            llm.ToolInput(
                "MaticGetRecentEvents", {"limit": 1, "include_activity": True}
            ),
            _context(),
        )
    ).data
    assert len(api.operational_events) == 1
    assert operational["activity_included"] is False
    assert operational["events"][0]["event_type"] == "matic_robot_room_started"
    assert combined["activity_included"] is True
    assert combined["events"][0]["event_type"] == "matic_robot_activity_observed"


async def test_native_history_scopes_completion_to_the_requested_mode() -> None:
    entry = _entry()
    entry.runtime_data.client.async_get_cleaning_session_records.return_value = (
        CleaningSessionRecord(
            b"synthetic-key",
            CleaningSession(
                "2026-08-25T20:00:00+00:00",
                "2026-08-25T20:10:00+00:00",
                600,
                ("Study", "Gallery"),
                (("Study", 120), ("Gallery", 200)),
                None,
                vacuum_completed_rooms=("Study", "Gallery"),
                mode_results=(
                    CleaningModeResult("Study", "vacuum", "completed", 120),
                    CleaningModeResult("Gallery", "vacuum", "completed", 200),
                    CleaningModeResult("Gallery", "mop", "partial", 40),
                ),
            ),
        ),
    )
    hass = _hass(entry)
    tool = MaticGetNativeHistoryTool()
    for mode, expected, durations in (
        (None, [None, None], [120, 200]),
        ("vacuum", [True, True], [120, 200]),
        ("mop", [False, False], [None, 40]),
        ("vacuum_and_mop", [False, False], [120, 240]),
    ):
        result = (
            await tool.async_call(
                hass,
                llm.ToolInput(
                    tool.name, {} if mode is None else {"cleaning_mode": mode}
                ),
                _context(),
            )
        ).data
        session = result["sessions"][0]
        assert session["completion_scope"] == (mode or "unspecified")
        assert [room["completed"] for room in session["room_evidence"]] == expected
        assert [
            room["duration_seconds"] for room in session["room_evidence"]
        ] == durations
        assert "Do not infer the requested mode" in result["completion_authority"]
        assert "not why cleaning ended" in result["completion_authority"]
    with pytest.raises(probatio.Invalid):
        await tool.async_call(
            hass, llm.ToolInput(tool.name, {"cleaning_mode": "unknown"}), _context()
        )


async def test_activity_journal_pagination_filtering_and_restart_guards() -> None:
    entry = _entry()
    journal = entry.runtime_data.client.activity_journal = ActivityJournal()
    journal.record("command_requested", command="STOP", channel="user_command")
    journal.record("command_sending", command_id=2, channel="user_command")
    journal.record(
        "command_result", command_id=2, command="STOP", outcome="acknowledged"
    )
    journal.record("state_stream_started", source="push")
    journal.record(
        "state", source="push", activity="ready", state_codes=[109], error_codes=[]
    )
    journal.record("state_stream_ended", source="push")
    journal.record("command_requested", command="DOCK", channel="user_command")
    journal.record("command_result", command_id=8, command="DOCK", outcome="failed")
    hass = _hass(entry)
    tool = MaticGetActivityTool()

    async def read(**args):
        return (
            await tool.async_call(hass, llm.ToolInput(tool.name, args), _context())
        ).data

    result = await read(limit=2)
    assert [item["sequence"] for item in result["observations"]] == [9, 8]
    assert result["has_more"] is True
    assert result["next_before_sequence"] == 8
    assert result["first_available_sequence"] == 1
    assert result["last_available_sequence"] == 9
    assert result["older_observations_evicted"] is False
    assert result["retained_observations"] == 9
    older = await read(
        before_sequence=8, observation_session=result["observation_session"]
    )
    assert [item["sequence"] for item in older["observations"]] == [4, 3, 2]
    assert older["has_more"] is False
    assert older["next_before_sequence"] is None
    assert [
        item["sequence"] for item in (await read(kind="states"))["observations"]
    ] == [6]
    assert [
        item["sequence"] for item in (await read(kind="stream"))["observations"]
    ] == [7, 5]
    assert len((await read(kind="all"))["observations"]) == 9
    assert not (
        await read(before_sequence=1, observation_session=result["observation_session"])
    )["observations"]
    with pytest.raises(HomeAssistantError, match="also pass the observation ID"):
        await read(before_sequence=8)
    entry.runtime_data.client.activity_journal = ActivityJournal()
    with pytest.raises(HomeAssistantError, match="restarted"):
        await read(before_sequence=8, observation_session=result["observation_session"])
    for invalid in (
        {"limit": 129},
        {"kind": "payload"},
        {"observation_session": "bad"},
        {"before_sequence": 0},
    ):
        with pytest.raises(probatio.Invalid):
            await read(**invalid)
    entry.runtime_data.client.async_get_cleaning_session_records.assert_not_called()


def test_activity_journal_run_id_is_bounded_and_clearable() -> None:
    journal = ActivityJournal()
    journal.set_run_id("a" * 32)
    journal.record("command_requested", command="DOCK")
    assert journal.snapshot[-1]["run_id"] == "a" * 32
    journal.set_run_id(None)
    journal.record("state", activity="ready")
    assert "run_id" not in journal.snapshot[-1]


async def test_activity_journal_eviction_and_output_privacy() -> None:
    entry = _entry()
    journal = entry.runtime_data.client.activity_journal = ActivityJournal()
    for _ in range(MAX_OBSERVATIONS):
        journal.record("state", activity="ready", state_codes=[109], error_codes=[])
    journal.record(
        "command_result",
        command="DOCK",
        outcome="failed",
        error_type="x" * 400,
        channel={"private": "must-not-appear"},
        payload="must-not-appear",
        state_codes=[True],
        error_codes="must-not-appear",
    )
    hass = _hass(entry)
    result = (
        await MaticGetActivityTool().async_call(
            hass,
            llm.ToolInput("MaticGetActivity", {"kind": "all", "limit": 2}),
            _context(),
        )
    ).data
    assert result["older_observations_evicted"] is True
    assert result["first_available_sequence"] == 3
    assert result["retained_observations"] == MAX_OBSERVATIONS
    assert result["buffer_limit"] == MAX_OBSERVATIONS
    assert "must-not-appear" not in str(result)
    assert len(result["observations"][0]["error_type"]) == 256
    assert "state_codes" not in result["observations"][0]
    assert result["observations"][1]["state_codes"] == [109]
    result["observations"][1]["state_codes"].append(1)
    assert journal.snapshot[-2]["state_codes"] == [109]


def _strings(category: str) -> dict[str, str]:
    """Flatten one strings.json category the way Home Assistant serves it."""
    strings = json.loads(
        (
            Path(__file__).parents[1] / "custom_components" / DOMAIN / "strings.json"
        ).read_text()
    )[category]
    return {
        f"component.{DOMAIN}.{category}.{key}"
        + (".message" if isinstance(value, dict) else ""): (
            value["message"] if isinstance(value, dict) else value
        )
        for key, value in strings.items()
    }


def _text(category: str, key: str, **placeholders: str) -> str:
    suffix = ".message" if category == "exceptions" else ""
    return _strings(category)[f"component.{DOMAIN}.{category}.{key}{suffix}"].format(
        **placeholders
    )


def test_llm_errors_match_strings() -> None:
    strings = _strings("exceptions")
    for key, message in _ERRORS.items():
        assert strings[f"component.{DOMAIN}.exceptions.{key}.message"] == message


_READY_PROJECTION = {
    "map_floor_coherent": True,
    "map_session_verified": True,
    "map_complete": True,
    "map_truncated": False,
    "map_health": "healthy",
    "runner_locked": False,
    "stop_settle_pending": False,
    "active_plan": False,
    "native_reconciliation_pending": False,
    "native_session_active": False,
}


def _control_hass(
    *,
    state: str | None = "docked",
    attributes: dict[str, Any] | None = None,
    projection: dict[str, Any] | None = None,
    plans: dict[str, dict[str, Any]] | None = None,
    floor_plan: FloorPlan | None = None,
):
    """Build an administrator, one robot and the panel's facts about it."""
    entry = _entry(floor_plan=floor_plan)
    manager = entry.runtime_data.cleaning_plans
    saved = plans if plans is not None else {"home": {"name": "Home", "enabled": True}}

    def plan(_serial: str, reference: str | None = None) -> dict[str, Any]:
        reference = reference or "home"
        for plan_id, value in saved.items():
            if reference in (plan_id, value["name"]):
                return {"id": plan_id, **value}
        raise KeyError(reference)

    manager.plans.return_value = saved
    manager.plan.side_effect = plan
    hass = _hass(entry)
    hass.config = SimpleNamespace(language="en")
    hass.services = SimpleNamespace(async_call=AsyncMock())
    hass.states = SimpleNamespace(
        get=MagicMock(
            return_value=None
            if state is None
            else State("vacuum.robot", state, attributes or {})
        )
    )
    hass.async_create_background_task = lambda target, name: asyncio.ensure_future(
        target
    )
    registry = SimpleNamespace(
        async_get_entity_id=MagicMock(return_value="vacuum.robot")
    )
    patches = (
        patch("custom_components.matic_robot.llm.er.async_get", return_value=registry),
        patch(
            "custom_components.matic_robot.llm.catalog_entry_projection",
            return_value={**_READY_PROJECTION, **(projection or {})},
        ),
        patch(
            "custom_components.matic_robot.llm.translation.async_get_translations",
            AsyncMock(
                side_effect=lambda _hass, _lang, category, _domains: _strings(category)
            ),
        ),
    )
    return hass, registry, patches


async def _run(hass, patches, tool, args: dict[str, Any], context=None):
    with patches[0], patches[1], patches[2]:
        return await tool.async_call(
            hass, llm.ToolInput(tool.name, args), context or _context()
        )


def _refused(result: llm.ToolResult, category: str, key: str, **placeholders: str):
    assert result.error is True
    assert result.data == {
        "done": False,
        "reason": _text(category, key, **placeholders),
    }


@pytest.mark.parametrize(
    ("state", "attributes", "projection", "reason"),
    [
        (None, None, {}, "v4_reason_clean_rooms_verification"),
        ("unavailable", None, {}, "v4_reason_clean_rooms_verification"),
        (
            "docked",
            None,
            {"map_session_verified": False},
            "v4_reason_clean_rooms_verification",
        ),
        ("docked", None, {"map_truncated": True}, "v4_reason_clean_rooms_verification"),
        (
            "docked",
            None,
            {"map_health": "limited"},
            "v4_reason_clean_rooms_verification",
        ),
        (
            "docked",
            None,
            {"stop_settle_pending": True},
            "v4_reason_stop_settle_pending",
        ),
        ("docked", None, {"runner_locked": True}, "v4_reason_robot_operation_waiting"),
        ("docked", None, {"active_plan": True}, "v4_reason_robot_operation_waiting"),
        (
            "docked",
            None,
            {"native_reconciliation_pending": True},
            "v4_reason_robot_operation_waiting",
        ),
        (
            "docked",
            None,
            {"native_session_active": True},
            "v4_reason_robot_operation_waiting",
        ),
        ("cleaning", None, {}, "v4_reason_robot_operation_waiting"),
        (
            "docked",
            {"recharge_and_resume": True, "charging": True},
            {},
            "v4_reason_robot_operation_waiting",
        ),
    ],
)
async def test_start_tools_refuse_with_the_strip_reason(
    state, attributes, projection, reason
) -> None:
    for tool, args in (
        (MaticRunPlanTool(), {}),
        (MaticCleanRoomsTool(), {"rooms": ["Kitchen"]}),
    ):
        hass, _registry, patches = _control_hass(
            state=state, attributes=attributes, projection=projection
        )
        _refused(await _run(hass, patches, tool, args), "common", reason)
        hass.services.async_call.assert_not_awaited()


async def test_write_tools_fail_closed_for_non_administrators() -> None:
    for tool in (
        MaticRunPlanTool(),
        MaticCleanRoomsTool(),
        MaticStopCleaningTool(),
        MaticResetScheduleTool(),
    ):
        hass, _registry, patches = _control_hass()
        hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=False)
        with pytest.raises(
            HomeAssistantError,
            match="Only a Home Assistant administrator can use the robot tools",
        ) as err:
            await _run(hass, patches, tool, {"rooms": ["Kitchen"], "schedule": "mop"})
        assert err.value.translation_key == "llm_admin_required"
        hass.services.async_call.assert_not_awaited()


async def test_write_tools_need_the_robot_vacuum_entity() -> None:
    hass, registry, patches = _control_hass()
    registry.async_get_entity_id.return_value = None
    with pytest.raises(HomeAssistantError, match="The robot is unavailable"):
        await _run(hass, patches, MaticStopCleaningTool(), {})


async def test_run_plan_previews_then_runs_on_the_panel_action() -> None:
    hass, registry, patches = _control_hass()
    started = asyncio.Event()
    release = asyncio.Event()

    async def call(domain, service, data, **kwargs):
        if service == "preview_plan":
            return {"preview_token": "a" * 64}
        started.set()
        await release.wait()

    hass.services.async_call.side_effect = call
    context = _context()
    with patch("custom_components.matic_robot.llm.RUN_START_WAIT_SECONDS", 0.01):
        result = await _run(hass, patches, MaticRunPlanTool(), {}, context)
    assert result.error is False
    assert result.data == {"started": True, "plan": "Home"}
    assert started.is_set()
    registry.async_get_entity_id.assert_called_once_with(
        "vacuum", DOMAIN, "synthetic-serial_vacuum"
    )
    assert [call.args[:3] for call in hass.services.async_call.await_args_list] == [
        (DOMAIN, "preview_plan", {"entity_id": "vacuum.robot", "plan": "home"}),
        (
            DOMAIN,
            "run_selected_plan",
            {"entity_id": "vacuum.robot", "plan": "home", "preview_token": "a" * 64},
        ),
    ]
    for awaited in hass.services.async_call.await_args_list:
        assert awaited.kwargs["context"] is context.context
        assert awaited.kwargs["blocking"] is True
    assert hass.services.async_call.await_args_list[0].kwargs["return_response"]
    release.set()
    for _ in range(3):
        await asyncio.sleep(0)


async def test_run_plan_reports_quick_outcomes_and_refusals() -> None:
    preview = AsyncMock(return_value={"preview_token": "b" * 64})

    async def finished(domain, service, data, **kwargs):
        return await preview() if service == "preview_plan" else None

    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = finished
    result = await _run(hass, patches, MaticRunPlanTool(), {"plan": "Home"})
    assert result.data == {"started": True, "finished": True, "plan": "Home"}

    async def refused(domain, service, data, **kwargs):
        if service == "preview_plan":
            return await preview()
        raise ServiceValidationError(
            "busy", translation_domain=DOMAIN, translation_key="plan_already_running"
        )

    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = refused
    _refused(
        await _run(hass, patches, MaticRunPlanTool(), {}),
        "exceptions",
        "plan_already_running",
    )

    async def broken(domain, service, data, **kwargs):
        if service == "preview_plan":
            return await preview()
        raise RuntimeError("synthetic")

    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = broken
    with pytest.raises(RuntimeError, match="synthetic"):
        await _run(hass, patches, MaticRunPlanTool(), {})

    hass, _registry, patches = _control_hass()
    with pytest.raises(HomeAssistantError, match="No plan is named Missing"):
        await _run(hass, patches, MaticRunPlanTool(), {"plan": "Missing"})
    hass, _registry, patches = _control_hass(plans={})
    _refused(
        await _run(hass, patches, MaticRunPlanTool(), {}),
        "exceptions",
        "unknown_plan",
        plan="",
    )
    hass.services.async_call.assert_not_awaited()
    hass, _registry, patches = _control_hass(
        plans={"home": {"name": "Home", "enabled": False}}
    )
    _refused(
        await _run(hass, patches, MaticRunPlanTool(), {}),
        "common",
        "v4_reason_run_plan_paused",
    )

    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = ServiceValidationError(
        "The cleaning request is invalid: plan has no rooms",
        translation_domain=DOMAIN,
        translation_key="invalid_plan",
        translation_placeholders={"error": "plan has no rooms"},
    )
    _refused(
        await _run(hass, patches, MaticRunPlanTool(), {}),
        "exceptions",
        "invalid_plan",
        error="plan has no rooms",
    )
    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = HomeAssistantError("raw private text")
    _refused(
        await _run(hass, patches, MaticRunPlanTool(), {}),
        "exceptions",
        "robot_command_failed",
    )


async def test_action_errors_relay_their_translated_reason() -> None:
    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = ServiceValidationError(
        "The saved-plan preview is stale; refresh it before starting",
        translation_domain=DOMAIN,
        translation_key="plan_preview_changed",
    )
    result = await _run(hass, patches, MaticRunPlanTool(), {})
    assert result.data["reason"] == (
        "The plan changed after you previewed it. Preview it again, then run the plan."
    )
    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = ServiceValidationError(
        "room cadence cannot reset while its plan is running",
        translation_domain=DOMAIN,
        translation_key="cadence_reset_blocked",
    )
    result = await _run(
        hass, patches, MaticResetScheduleTool(), {"schedule": "mop", "scope": "plan"}
    )
    assert result.data["reason"] == (
        "This room schedule progress is in use by a running plan. Wait for the run "
        "to finish, then try again."
    )


async def test_run_left_running_logs_its_later_end(caplog) -> None:
    release = asyncio.Event()

    async def call(domain, service, data, **kwargs):
        if service == "preview_plan":
            return {"preview_token": "c" * 64}
        await release.wait()
        raise HomeAssistantError("room interrupted")

    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = call
    caplog.set_level(logging.DEBUG, logger="custom_components.matic_robot.llm")
    with patch("custom_components.matic_robot.llm.RUN_START_WAIT_SECONDS", 0.01):
        assert (await _run(hass, patches, MaticRunPlanTool(), {})).data["started"]
    release.set()
    for _ in range(3):
        await asyncio.sleep(0)
    assert "ended: room interrupted" in caplog.text


def test_cancelled_run_is_not_logged() -> None:
    task = MagicMock()
    task.cancelled.return_value = True
    _log_run_end(task)
    task.exception.assert_not_called()
    task.cancelled.return_value = False
    task.exception.return_value = None
    _log_run_end(task)


async def test_clean_rooms_previews_the_sequence_then_runs_it() -> None:
    hass, _registry, patches = _control_hass()

    async def call(domain, service, data, **kwargs):
        if service == "preview_room_sequence":
            return {
                "preview_token": "d" * 64,
                "blocker": None,
                "rooms": [{"name": "Kitchen"}, {"name": "Study"}],
            }
        return None

    hass.services.async_call.side_effect = call
    result = await _run(
        hass,
        patches,
        MaticCleanRoomsTool(),
        {"rooms": ["kitchen", "Study"], "cleaning_mode": "mop"},
    )
    assert result.data == {
        "started": True,
        "finished": True,
        "rooms": ["Kitchen", "Study"],
    }
    sequence = {
        "entity_id": "vacuum.robot",
        "rooms": [
            {"room": "kitchen", "cleaning_mode": "mop"},
            {"room": "Study", "cleaning_mode": "mop"},
        ],
        "use_room_schedule": True,
        "override_room_schedule": False,
        "return_to_base": True,
    }
    assert [call.args[:3] for call in hass.services.async_call.await_args_list] == [
        (DOMAIN, "preview_room_sequence", sequence),
        (DOMAIN, "clean_room_sequence", {**sequence, "preview_token": "d" * 64}),
    ]

    for blocked in (
        {"preview_token": None, "blocker": "shared_schedule_unavailable", "rooms": []},
        {"preview_token": "e" * 64, "blocker": None, "rooms": []},
    ):
        hass, _registry, patches = _control_hass()
        hass.services.async_call.return_value = blocked
        _refused(
            await _run(hass, patches, MaticCleanRoomsTool(), {"rooms": ["Kitchen"]}),
            "common",
            "v4_reason_room_preview_blocked",
        )
        assert hass.services.async_call.await_args.args[1] == "preview_room_sequence"
        assert (
            hass.services.async_call.await_args.args[2]["rooms"][0]["cleaning_mode"]
            == "vacuum"
        )

    hass, _registry, patches = _control_hass()
    hass.services.async_call.side_effect = ServiceValidationError(
        "Unknown Matic rooms: Attic",
        translation_domain=DOMAIN,
        translation_key="unknown_rooms",
        translation_placeholders={"rooms": "Attic"},
    )
    _refused(
        await _run(hass, patches, MaticCleanRoomsTool(), {"rooms": ["Attic"]}),
        "exceptions",
        "unknown_rooms",
        rooms="Attic",
    )


@pytest.mark.parametrize(
    ("state", "projection", "category", "reason"),
    [
        ("unavailable", {}, "exceptions", "llm_robot_unavailable"),
        ("cleaning", {"stop_settle_pending": True}, "common", "v4_reason_stop"),
        ("docked", {}, "exceptions", "llm_nothing_to_stop"),
    ],
)
async def test_stop_refuses_like_the_panel(state, projection, category, reason) -> None:
    hass, _registry, patches = _control_hass(state=state, projection=projection)
    _refused(await _run(hass, patches, MaticStopCleaningTool(), {}), category, reason)
    hass.services.async_call.assert_not_awaited()


@pytest.mark.parametrize(
    ("state", "attributes", "projection"),
    [
        ("cleaning", None, {}),
        ("paused", None, {}),
        ("returning", None, {}),
        ("docked", {"recharge_and_resume": True, "charging": True}, {}),
        ("docked", None, {"runner_locked": True}),
        ("docked", None, {"active_plan": True}),
        ("docked", None, {"native_session_active": True}),
    ],
)
async def test_stop_sends_the_panel_stop(state, attributes, projection) -> None:
    hass, _registry, patches = _control_hass(
        state=state, attributes=attributes, projection=projection
    )
    result = await _run(hass, patches, MaticStopCleaningTool(), {})
    assert result.data == {"stop_sent": True}
    hass.services.async_call.assert_awaited_once()
    assert hass.services.async_call.await_args.args == (
        DOMAIN,
        "stop_intelligent_cleaning",
        {"entity_id": "vacuum.robot", "include_unmanaged": True},
    )

    hass, _registry, patches = _control_hass(
        state=state, attributes=attributes, projection=projection
    )
    hass.services.async_call.side_effect = ServiceValidationError(
        "changed", translation_domain=DOMAIN, translation_key="managed_run_changed"
    )
    _refused(
        await _run(hass, patches, MaticStopCleaningTool(), {}),
        "exceptions",
        "managed_run_changed",
    )


async def test_reset_schedule_uses_the_panel_reset() -> None:
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room("kitchen", "Kitchen", "kitchen", b"kitchen", ()),
            Room("study", "Study", "study", b"study", ()),
        ),
    )
    hass, _registry, patches = _control_hass(floor_plan=floor_plan)
    result = await _run(
        hass,
        patches,
        MaticResetScheduleTool(),
        {"room": "kitchen", "schedule": "mop"},
    )
    assert result.data == {
        "reset": True,
        "plan": "Home",
        "room": "Kitchen",
        "schedule": "mop",
    }
    assert hass.services.async_call.await_args.args == (
        DOMAIN,
        "reset_room_cadence",
        {
            "entity_id": "vacuum.robot",
            "plan": "home",
            "modes": ["mop"],
            "room_id": "kitchen",
        },
    )
    assert hass.services.async_call.await_args.kwargs["return_response"] is True

    hass, _registry, patches = _control_hass(floor_plan=floor_plan)
    result = await _run(
        hass,
        patches,
        MaticResetScheduleTool(),
        {"plan": "Home", "schedule": "coverage", "scope": "plan"},
    )
    assert result.data == {
        "reset": True,
        "plan": "Home",
        "room": None,
        "schedule": "coverage",
    }
    assert "room_id" not in hass.services.async_call.await_args.args[2]

    hass, _registry, patches = _control_hass(floor_plan=floor_plan)
    with pytest.raises(HomeAssistantError, match="Name the room to reset"):
        await _run(hass, patches, MaticResetScheduleTool(), {"schedule": "mop"})
    with pytest.raises(HomeAssistantError, match="No room is named Attic"):
        await _run(
            hass,
            patches,
            MaticResetScheduleTool(),
            {"room": "Attic", "schedule": "mop"},
        )
    with pytest.raises(HomeAssistantError, match="No plan is named Missing"):
        await _run(
            hass,
            patches,
            MaticResetScheduleTool(),
            {"plan": "Missing", "schedule": "mop", "scope": "plan"},
        )
    hass.services.async_call.assert_not_awaited()
    hass, _registry, patches = _control_hass(plans={}, floor_plan=floor_plan)
    _refused(
        await _run(
            hass,
            patches,
            MaticResetScheduleTool(),
            {"schedule": "mop", "scope": "plan"},
        ),
        "exceptions",
        "unknown_plan",
        plan="",
    )
    hass.services.async_call.assert_not_awaited()

    for state, projection, reason in (
        ("cleaning", {}, "v4_reason_robot_operation_waiting"),
        ("docked", {"map_complete": False}, "v4_reason_clean_rooms_verification"),
    ):
        hass, _registry, patches = _control_hass(
            state=state, projection=projection, floor_plan=floor_plan
        )
        _refused(
            await _run(
                hass,
                patches,
                MaticResetScheduleTool(),
                {"room": "Kitchen", "schedule": "mop"},
            ),
            "common",
            reason,
        )


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        (MaticRunPlanTool(), {"plan": "home"}),
        (
            MaticResetScheduleTool(),
            {"plan": "home", "schedule": "mop", "scope": "plan"},
        ),
    ],
)
async def test_plan_tools_refuse_a_name_two_plans_share(tool, args) -> None:
    hass, _registry, patches = _control_hass(
        plans={
            "home-a": {"name": "Home", "enabled": True},
            "home-b": {"name": "Home", "enabled": True},
        }
    )
    with pytest.raises(HomeAssistantError) as raised:
        await _run(hass, patches, tool, args)
    assert raised.value.translation_key == "llm_plan_ambiguous"
    assert (
        str(raised.value)
        == "More than one plan is named home. Use the plan's ID instead."
    )
    hass.services.async_call.assert_not_awaited()


async def test_refusals_use_the_conversation_language() -> None:
    hass, _registry, patches = _control_hass(state="cleaning")
    hass.config.language = "de"
    context = _context()
    context.language = "fr"
    translations = AsyncMock(return_value=_strings("common"))
    with (
        patches[0],
        patches[1],
        patch(
            "custom_components.matic_robot.llm.translation.async_get_translations",
            translations,
        ),
    ):
        await MaticRunPlanTool().async_call(
            hass, llm.ToolInput("MaticRunPlan", {}), context
        )
        context.language = "*"
        await MaticRunPlanTool().async_call(
            hass, llm.ToolInput("MaticRunPlan", {}), context
        )
    assert [call.args[1] for call in translations.await_args_list] == ["fr", "de"]


async def test_refusal_text_comes_from_the_integration_translations(hass) -> None:
    result = await _async_refusal(hass, _context(), "common", "v4_reason_stop")
    assert result.data["reason"] == _text("common", "v4_reason_stop")
    result = await _async_refusal(
        hass, _context(), "exceptions", "unknown_plan", {"plan": "Attic"}
    )
    assert result.data["reason"] == _text("exceptions", "unknown_plan", plan="Attic")


async def test_assist_gets_the_robot_status_tools_for_administrators(hass) -> None:
    entry = MockConfigEntry(domain=DOMAIN, entry_id="entry-one")
    entry.add_to_hass(hass)
    entry.mock_state(hass, ConfigEntryState.LOADED)
    registry = er.async_get(hass)
    vacuum = registry.async_get_or_create(
        "vacuum", DOMAIN, "synthetic-serial_vacuum", config_entry=entry
    )
    registry.async_get_or_create(
        "sensor", DOMAIN, "synthetic-serial_battery", config_entry=entry
    )
    api = MaticRobotStatusAPI(hass)
    admin = await hass.auth.async_create_user("Admin", group_ids=["system-admin"])
    member = await hass.auth.async_create_user("Member", group_ids=["system-users"])
    api.async_start()
    await hass.async_block_till_done()
    assert admin.id in api.administrators
    assert member.id not in api.administrators

    def context(user_id: str | None, assistant: str = "conversation"):
        return llm.LLMContext(
            platform="conversation",
            context=Context(user_id=user_id),
            language="en",
            assistant=assistant,
            device_id=None,
        )

    exposed = MagicMock(return_value=True)
    with patch("custom_components.matic_robot.llm.async_should_expose", exposed):
        assert async_get_tools(hass, context(admin.id), "assist") is None
        hass.data.setdefault(DOMAIN, {})[DATA_LLM_API] = api
        assert async_get_tools(hass, context(admin.id), "other") is None
        assert async_get_tools(hass, context(admin.id, ""), "assist") is None
        assert async_get_tools(hass, context(member.id), "assist") is None
        assert async_get_tools(hass, context(None), "assist") is None
        no_context = context(admin.id)
        no_context.context = None
        assert async_get_tools(hass, no_context, "assist") is None
        tools = async_get_tools(hass, context(admin.id), "assist")
        exposed.return_value = False
        assert async_get_tools(hass, context(admin.id), "assist") is None
    exposed.assert_called_with(hass, "conversation", vacuum.entity_id)
    assert tools is not None
    assert tools.prompt == ROBOT_STATUS_PROMPT
    assert [tool.name for tool in tools.tools] == [
        f"{DOMAIN}__{tool.name}" for tool in api.tools()
    ]
    assert all(tool.tool.exposed_only for tool in tools.tools)
    assert not any(tool.exposed_only for tool in api.tools())
    assert "matic_robot__MaticClaimFirmwareInvestigation" not in {
        tool.name for tool in tools.tools
    }
    assert all(tool.integration == DOMAIN for tool in tools.tools)

    await hass.auth.async_update_user(member, group_ids=["system-admin"])
    await hass.async_block_till_done()
    assert member.id in api.administrators
    await hass.auth.async_remove_user(member)
    await hass.async_block_till_done()
    assert member.id not in api.administrators


async def test_assist_tools_only_see_robots_exposed_to_the_assistant() -> None:
    hass, _registry, patches = _control_hass(state="cleaning")
    entries = hass.config_entries.async_loaded_entries.return_value
    hidden = _entry(name="Hidden Robot", title="Hidden", entry_id="entry-hidden")
    entries.append(hidden)
    for entry in entries:
        entry.runtime_data.firmware_tracker = SimpleNamespace(
            report=MagicMock(return_value={}), report_history=MagicMock()
        )
    registered = {
        "entry-one": [
            SimpleNamespace(domain="vacuum", entity_id="vacuum.robot", device_id="d1"),
            SimpleNamespace(domain="sensor", entity_id="sensor.one", device_id=None),
        ],
        # An exposed sensor never exposes the robot; only its vacuum does.
        "entry-hidden": [
            SimpleNamespace(domain="vacuum", entity_id="vacuum.hidden", device_id="d2"),
            SimpleNamespace(domain="sensor", entity_id="sensor.hidden", device_id="d2"),
        ],
    }
    should_expose = MagicMock(
        side_effect=lambda _hass, _assistant, entity_id: (
            entity_id in {"vacuum.robot", "sensor.hidden"}
        )
    )
    api = MaticRobotStatusAPI(hass)
    for data in (
        {"entry_id": "entry-one", "room": "visible entry"},
        {"device_id": "d1", "room": "visible device"},
        {"entity_id": "vacuum.robot", "room": "visible entity"},
        {"entry_id": "entry-hidden", "room": "hidden entry"},
        {"device_id": "d2", "room": "hidden device"},
        {"entity_id": "vacuum.hidden", "room": "hidden entity"},
        {"entity_id": None, "room": "unattributed"},
    ):
        api._async_capture_event(
            Event("matic_robot_room_started", data, time_fired_timestamp=0)
        )
    assist = {tool.name: tool for tool in api.tools(exposed_only=True)}
    admin = {tool.name: tool for tool in api.tools()}

    async def call(tool, args):
        return await _run(hass, patches, tool, args, _context())

    with (
        patch(
            "custom_components.matic_robot.llm.er.async_entries_for_config_entry",
            side_effect=lambda _registry, entry_id: registered[entry_id],
        ),
        patch("custom_components.matic_robot.llm.async_should_expose", should_expose),
    ):
        operations = (await call(assist["MaticGetOperations"], {})).data
        assert operations["robot_count"] == 1
        assert [robot["entry_id"] for robot in operations["robots"]] == ["entry-one"]
        assert (await call(admin["MaticGetOperations"], {})).data["robot_count"] == 2
        firmware = (await call(assist["MaticGetFirmware"], {})).data
        assert [robot["entry_id"] for robot in firmware["robots"]] == ["entry-one"]
        events = (await call(assist["MaticGetRecentEvents"], {})).data["events"]
        assert [event["data"]["room"] for event in events] == [
            "visible entity",
            "visible device",
            "visible entry",
        ]
        everything = (await call(admin["MaticGetRecentEvents"], {})).data["events"]
        assert len(everything) == 7

        for name, args in (
            ("MaticGetFirmware", {}),
            ("MaticGetPlan", {}),
            ("MaticGetNativeHistory", {}),
            ("MaticGetActivity", {}),
            ("MaticRunPlan", {}),
            ("MaticCleanRooms", {"rooms": ["Kitchen"]}),
            ("MaticStopCleaning", {}),
            ("MaticResetSchedule", {"schedule": "mop", "scope": "plan"}),
        ):
            for robot in ("entry-hidden", "ENTRY-HIDDEN", "Hidden Robot", "hidden"):
                with pytest.raises(HomeAssistantError) as err:
                    await call(assist[name], {**args, "robot": robot})
                assert err.value.translation_key == "llm_robot_unknown"
                assert str(err.value).startswith(f"No robot is named {robot}.")
        hass.services.async_call.assert_not_awaited()

        # The one exposed robot needs no name, as if it were the only robot.
        stopped = await call(assist["MaticStopCleaning"], {})
        assert stopped.data == {"stop_sent": True}
        assert hass.services.async_call.await_args.args[2]["entity_id"] == (
            "vacuum.robot"
        )

        should_expose.side_effect = None
        should_expose.return_value = False
        for name in ("MaticGetOperations", "MaticGetRecentEvents"):
            with pytest.raises(HomeAssistantError, match="No robot is set up"):
                await call(assist[name], {})
    should_expose.assert_called_with(hass, "conversation", "vacuum.hidden")
