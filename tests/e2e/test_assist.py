"""Assist and MCP clients driving the simulated robot through Matic's tools.

The tools call the same actions as Matic Map, so a conversation cleans,
reports and stops the robot the way the panel does.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from homeassistant.components.homeassistant.exposed_entities import (
    async_expose_entity,
)
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import llm
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import slam_map_store
from custom_components.matic_robot.slam_view_data import catalog_entry_projection

from .hermes_sim import STOP_PAYLOAD, Phase, SimulatedRobot
from .plan_run import VACUUM, poll
from .sim_mission import SimFloor, two_room_floor


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


@pytest.fixture(autouse=True)
def settled_map(monkeypatch: pytest.MonkeyPatch) -> None:
    """Count the map settled at once, as it is after a few quiet seconds."""
    monkeypatch.setattr(slam_map_store, "MAP_SETTLE_SECONDS", 0)


async def _assist_ready(hass: HomeAssistant) -> None:
    """Home Assistant's Assist API, with its exposed-entities settings."""
    assert await async_setup_component(hass, "homeassistant", {})
    assert await async_setup_component(hass, "llm", {})
    async_expose_entity(hass, "conversation", VACUUM, True)


def _map_verified(entry: MockConfigEntry) -> bool:
    """The map facts Matic's tools require before they place a room."""
    projection = catalog_entry_projection(entry.entry_id, entry.runtime_data)
    return bool(
        projection["map_floor_coherent"]
        and projection["map_session_verified"]
        and projection["map_complete"]
        and not projection["map_truncated"]
        and projection["map_health"] not in ("problem", "limited")
    )


async def _map_ready(entry: MockConfigEntry) -> None:
    """Wait for the map to verify; setup returns before both layers arrive."""
    async with asyncio.timeout(10):
        # The map store announces no verified map.
        while not _map_verified(entry):  # noqa: ASYNC110
            await asyncio.sleep(0.01)


async def _api(
    hass: HomeAssistant, api_id: str, platform: str, *, admin: bool = True
) -> llm.APIInstance:
    user = await hass.auth.async_create_user(
        "Person", group_ids=["system-admin" if admin else "system-users"]
    )
    await hass.async_block_till_done()
    context = llm.LLMContext(
        platform=platform,
        context=Context(user_id=user.id),
        language="en",
        assistant="conversation",
        device_id=None,
    )
    return await llm.async_get_api(hass, api_id, context)


async def _call(api: llm.APIInstance, tool: str, **args: Any) -> dict[str, Any]:
    """The tool's answer; a refusal is its reason alone."""
    name = next(t.name for t in api.tools if t.name.endswith(tool))
    result = await api.async_call_tool(llm.ToolInput(name, args))
    return {"refused": result.data["reason"]} if result.error else dict(result.data)


async def test_assist_cleans_a_room_reports_it_and_stops(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    floor: SimFloor,
) -> None:
    await _assist_ready(hass)
    await _map_ready(loaded_entry)
    assist = await _api(hass, llm.LLM_API_ASSIST, "conversation")

    started = await _call(assist, "MaticCleanRooms", rooms=["Study"])

    assert started == {"started": True, "rooms": ["Study"]}
    async with asyncio.timeout(10):
        await robot.wait_for_phase(Phase.CLEANING)
    assert robot.session is not None
    assert robot.session.current_visit.room == floor.rooms[1].id
    await poll(hass, loaded_entry, robot)
    (status,) = (await _call(assist, "MaticGetOperations"))["robots"]
    assert status["robot"]["activity"] == "cleaning"
    assert status["robot"]["current_room"] == "Study"

    assert await _call(assist, "MaticStopCleaning") == {"stop_sent": True}
    assert STOP_PAYLOAD in robot.received()


async def test_assist_explains_why_the_robot_cannot_start(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    await _assist_ready(hass)
    await _map_ready(loaded_entry)
    assist = await _api(hass, llm.LLM_API_ASSIST, "conversation")

    refused = await _call(assist, "MaticCleanRooms", rooms=["Garage"])
    nothing = await _call(assist, "MaticStopCleaning")

    assert refused == {
        "refused": "These rooms aren't on the robot's map: Garage. "
        "Check the spelling, or choose rooms from the list."
    }
    assert nothing == {
        "refused": "The robot isn't cleaning, so there is nothing to stop."
    }
    assert robot.received() == []


async def test_assist_offers_nothing_for_an_unexposed_robot_or_a_member(
    hass: HomeAssistant, loaded_entry: MockConfigEntry
) -> None:
    await _assist_ready(hass)
    async_expose_entity(hass, "conversation", VACUUM, False)
    hidden = await _api(hass, llm.LLM_API_ASSIST, "conversation")
    async_expose_entity(hass, "conversation", VACUUM, True)
    member = await _api(hass, llm.LLM_API_ASSIST, "conversation", admin=False)

    assert not any(tool.name.startswith("matic_robot") for tool in hidden.tools)
    assert not any(tool.name.startswith("matic_robot") for tool in member.tools)


async def test_an_mcp_client_reads_status_without_the_control_tools(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    await _assist_ready(hass)
    status_api = await _api(hass, "matic_robot_status", "mcp_server")

    snapshot = await _call(status_api, "MaticGetOperations")

    assert snapshot["robot_count"] == 1
    assert snapshot["robots"][0]["robot"]["activity"] == "docked"
    assert snapshot["robots"][0]["robot_reachable"] is True
    assert not any(
        tool.name.endswith(("CleanRooms", "StopCleaning", "RunPlan"))
        for tool in status_api.tools
    )
    assert robot.received() == []
