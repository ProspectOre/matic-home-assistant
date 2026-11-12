"""The read-only and control LLM APIs, and entity exposure on every path."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context, Event
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import llm
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DATA_LLM_API, DOMAIN
from custom_components.matic_robot.llm import (
    LLM_API_ID,
    READ_ONLY_LLM_API_ID,
    ROBOT_CONTROL_PROMPT,
    ROBOT_STATUS_PROMPT,
    MaticRobotControlAPI,
    MaticRobotStatusAPI,
    async_get_tools,
    async_register_matic_llm_api,
)
from custom_components.matic_robot.llm_common import NON_ADMIN_PROMPT
from tests.test_llm import _context, _control_hass, _entry, _hass, _run

_READ_TOOLS = [
    "MaticGetOperations",
    "MaticGetPlan",
    "MaticGetPlanReadiness",
    "MaticGetNativeHistory",
    "MaticGetRecentEvents",
    "MaticGetActivity",
    "MaticGetRunHistory",
    "MaticGetSchedules",
    "MaticGetZones",
    "MaticGetFirmware",
]


async def test_read_only_api_offers_only_the_read_tools() -> None:
    hass = _hass(_entry())
    status = MaticRobotStatusAPI(hass)
    read_only = await status.async_get_api_instance(_context())
    assert read_only.api.id == READ_ONLY_LLM_API_ID == "matic_robot_status"
    assert read_only.api.name == (
        "Matic: Robot status, read-only (administrators only)"
    )
    assert read_only.api_prompt == ROBOT_STATUS_PROMPT
    assert "MaticRunPlan" not in ROBOT_STATUS_PROMPT
    assert [tool.name for tool in read_only.tools] == _READ_TOOLS
    assert all(tool.annotations.read_only for tool in read_only.tools)

    control = await MaticRobotControlAPI(status).async_get_api_instance(_context())
    assert control.api.id == LLM_API_ID
    assert control.api_prompt == ROBOT_CONTROL_PROMPT
    assert [tool.name for tool in control.tools][:10] == _READ_TOOLS
    assert not any(tool.annotations.read_only for tool in control.tools[10:])

    hass.auth.async_get_user.return_value = SimpleNamespace(is_admin=False)
    refused = await status.async_get_api_instance(_context())
    assert refused.tools == []
    assert refused.api_prompt == NON_ADMIN_PROMPT


async def test_a_client_can_select_the_read_only_api_alone(hass) -> None:
    """Selections stored by 0.5 name the control API's id and keep its tools."""
    admin = await hass.auth.async_create_user("Admin", group_ids=["system-admin"])
    async_register_matic_llm_api(hass)
    await hass.async_block_till_done()
    context = llm.LLMContext(
        platform="mcp_server",
        context=Context(user_id=admin.id),
        language="*",
        assistant="conversation",
        device_id=None,
    )
    read_only = await llm.async_get_api(hass, "matic_robot_status", context)
    assert [tool.name for tool in read_only.tools] == _READ_TOOLS
    stored = await llm.async_get_api(hass, "matic_robot_operations", context)
    assert len(stored.tools) == 18
    merged = await llm.async_get_api(
        hass, ["matic_robot_status", "matic_robot_firmware_research"], context
    )
    assert not any(
        tool.name.endswith(("RunPlan", "CleanRooms", "StopCleaning", "SendToSink"))
        for tool in merged.tools
    )


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
    api = MaticRobotControlAPI(MaticRobotStatusAPI(hass))
    admin = await hass.auth.async_create_user("Admin", group_ids=["system-admin"])
    member = await hass.auth.async_create_user("Member", group_ids=["system-users"])
    api.status.async_start()
    await hass.async_block_till_done()
    assert admin.id in api.status.administrators
    assert member.id not in api.status.administrators

    def context(user_id: str | None, assistant: str = "conversation"):
        return llm.LLMContext(
            platform="conversation",
            context=Context(user_id=user_id),
            language="en",
            assistant=assistant,
            device_id=None,
        )

    exposed = MagicMock(return_value=True)
    with patch("custom_components.matic_robot.llm_common.async_should_expose", exposed):
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
    assert tools.prompt == ROBOT_CONTROL_PROMPT
    assert [tool.name for tool in tools.tools] == [
        f"{DOMAIN}__{tool.name}" for tool in api.tools()
    ]
    assert "matic_robot__MaticClaimFirmwareInvestigation" not in {
        tool.name for tool in tools.tools
    }
    assert all(tool.integration == DOMAIN for tool in tools.tools)

    await hass.auth.async_update_user(member, group_ids=["system-admin"])
    await hass.async_block_till_done()
    assert member.id in api.status.administrators
    await hass.auth.async_remove_user(member)
    await hass.async_block_till_done()
    assert member.id not in api.status.administrators


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
    assist = {tool.name: tool for tool in MaticRobotControlAPI(api).tools()}

    async def call(tool, args):
        return await _run(hass, patches, tool, args, _context())

    with (
        patch(
            "custom_components.matic_robot.llm_common.er.async_entries_for_config_entry",
            side_effect=lambda _registry, entry_id: registered[entry_id],
        ),
        patch(
            "custom_components.matic_robot.llm_common.async_should_expose",
            should_expose,
        ),
    ):
        operations = (await call(assist["MaticGetOperations"], {})).data
        assert operations["robot_count"] == 1
        assert [robot["entry_id"] for robot in operations["robots"]] == ["entry-one"]
        firmware = (await call(assist["MaticGetFirmware"], {})).data
        assert [robot["entry_id"] for robot in firmware["robots"]] == ["entry-one"]
        events = (await call(assist["MaticGetRecentEvents"], {})).data["events"]
        assert [event["data"]["room"] for event in events] == [
            "visible entity",
            "visible device",
            "visible entry",
        ]

        for name, args in (
            ("MaticGetFirmware", {}),
            ("MaticGetPlan", {}),
            ("MaticGetNativeHistory", {}),
            ("MaticGetActivity", {}),
            ("MaticRunPlan", {}),
            ("MaticCleanRooms", {"rooms": ["Kitchen"]}),
            ("MaticStopCleaning", {}),
            ("MaticResetSchedule", {"schedule": "mop", "scope": "plan"}),
            ("MaticGoToRoom", {"room": "Kitchen"}),
            ("MaticSendToSink", {}),
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
            with pytest.raises(HomeAssistantError, match="No robot is exposed"):
                await call(assist[name], {})
    should_expose.assert_called_with(hass, "conversation", "vacuum.hidden")
