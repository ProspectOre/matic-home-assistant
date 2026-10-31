"""Exercise executor dispatch, native outcomes, and stop-policy boundaries."""

import asyncio
from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from homeassistant.core import ServiceCall
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_run import RoomRunOutcome
from custom_components.matic_robot.plan_model import PLAN_SESSION_ID, CleaningRoom
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.wire_builders import _session_identity

LAYOUTS = (
    (("mop", "quick"), ("mop", "standard"), ("mop", "heavy_duty")),
    (("vacuum_and_mop", "standard"),) * 3,
    (("vacuum", "quick"), ("vacuum", "heavy_duty")),
    (
        ("vacuum_and_mop", "quick"),
        ("vacuum", "quick"),
        ("vacuum_and_mop", "quick"),
        ("vacuum_and_mop", "quick"),
    ),
)


@pytest.mark.parametrize("layout", LAYOUTS)
@pytest.mark.parametrize("return_to_base", (False, True))
async def test_executor_preserves_room_settings_and_verified_completion(
    hass, layout, return_to_base
):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        CleaningRoom(f"room-{i}", f"Room {i}", mode, setting)
        for i, (mode, setting) in enumerate(layout)
    ]
    await manager.catalog.async_save_plan(
        "serial",
        "matrix",
        {
            "name": "Matrix",
            "enabled": True,
            "run_behavior": "ordered",
            "return_to_base": return_to_base,
            "rooms": [asdict(r) for r in rooms],
        },
    )
    expected = rooms
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {
            "plan_id": "matrix",
            "return_to_base": return_to_base,
            "start_timeout": 120,
            "completion_timeout": 600,
        },
    )
    commands, confirmed = [], []
    identity = b""
    ended = False
    started_at = None

    async def send(service_call):
        nonlocal identity, started_at
        params = service_call.data["params"]
        commands.append(params)
        assert params["rooms"] == [r.room_id for r in expected]
        assert params["ordered"] is True
        assert params["cleaning_mode"] == expected[0].cleaning_mode
        assert params["coverage"] == expected[0].coverage_setting
        effective_settings = {
            (
                r.cleaning_mode,
                "standard" if r.cleaning_mode == "mop" else r.coverage_setting,
            )
            for r in expected
        }
        if len(effective_settings) > 1:
            assert params["room_modes"] == [r.cleaning_mode for r in expected]
            assert params["room_coverage"] == [r.coverage_setting for r in expected]
        else:
            assert "room_modes" not in params
            assert "room_coverage" not in params
        session_id = params.get(PLAN_SESSION_ID)
        identity = (
            _session_identity(UUID(session_id))
            if isinstance(session_id, str)
            else b"synthetic-task"
        )
        started_at = dt_util.utcnow().isoformat()
        hass.states.async_set(
            "vacuum.matic", "cleaning", {"current_area": expected[0].name}
        )

    async def observe_terminal(*args, **kwargs):
        nonlocal ended, identity
        ended, identity = True, b""
        hass.states.async_set("vacuum.matic", "returning")
        return RoomRunOutcome.HANDOFF_CANDIDATE, None

    async def history():
        if not ended:
            return ()
        results = tuple(
            CleaningModeResult(room.name, mode, "completed", 20)
            for room in rooms
            for mode in ("vacuum", "mop")
            if room.cleaning_mode in (mode, "vacuum_and_mop")
        )
        names = tuple(r.name for r in rooms)
        return (
            CleaningSessionRecord(
                b"synthetic-record",
                CleaningSession(
                    started_at,
                    dt_util.utcnow().isoformat(),
                    120,
                    names,
                    (),
                    True,
                    completed_rooms=names,
                    vacuum_completed_rooms=tuple(
                        r.name
                        for r in rooms
                        if r.cleaning_mode in ("vacuum", "vacuum_and_mop")
                    ),
                    mop_completed_rooms=tuple(
                        r.name
                        for r in rooms
                        if r.cleaning_mode in ("mop", "vacuum_and_mop")
                    ),
                    combined_completed_rooms=tuple(
                        r.name for r in rooms if r.cleaning_mode == "vacuum_and_mop"
                    ),
                    mode_results=results,
                ),
            ),
        )

    def confirm(room_name):
        confirmed.append(room_name)
        if len(confirmed) == len(rooms):
            # Native history has proven completion. Make the final dock policy
            # observable independently of a robot already returning itself.
            hass.states.async_set("vacuum.matic", "idle")

    hass.services.async_register("vacuum", "send_command", send)
    dock = AsyncMock()
    await _async_execute_rooms(
        hass,
        call,
        manager,
        "vacuum.matic",
        "serial",
        expected,
        active_session=AsyncMock(return_value=False),
        session_history=history,
        confirm_room_completed=confirm,
        managed_user_command=dock,
        mapped_room_names=tuple(r.name for r in rooms),
        floor_is_current=lambda: True,
        floor_token="a" * 64,
        session_identity=AsyncMock(side_effect=lambda: identity),
        wait_for_leg_outcome=observe_terminal,
    )
    assert len(commands) == 1
    assert confirmed == [r.name for r in expected]
    result = manager.ledger.snapshot("serial")["last_run"]
    assert result["outcome"] == "completed"
    assert result["completed_room_count"] == len(rooms)
    assert not manager.control.lock("serial").locked()
    if return_to_base:
        dock.assert_awaited_once()
        assert dock.await_args.args[1] is UserCommand.DOCK
    else:
        dock.assert_not_awaited()


@pytest.mark.parametrize(
    ("finish_current_room", "threshold", "progress", "expected"),
    (
        (False, 50, 50.0, "immediate"),
        (True, 50, 49.9, "immediate"),
        (True, 50, 50.0, "after_room"),
        (True, 50, 50.1, "after_room"),
    ),
)
async def test_stop_threshold_is_independent_of_cleaning_configuration(
    hass, finish_current_room, threshold, progress, expected
):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room", "Room", "vacuum", "quick")
    await manager.catalog.async_save_plan(
        "serial",
        "matrix",
        {
            "finish_current_room": finish_current_room,
            "finish_current_room_threshold": threshold,
            "rooms": [],
        },
    )
    manager.repository.robot("serial")["rotations"]["matrix"] = {
        "rooms": {
            room.room_id: {
                "cleaning_mode": room.cleaning_mode,
                "coverage_setting": room.coverage_setting,
                "duration_history_seconds": [100, 100, 100],
            }
        }
    }
    async with manager.control.lock("serial"):
        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "matrix", room)
        active = manager.repository.data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = progress
        active["active_segment_started"] = None
        assert manager.control.request_stop("serial").behavior == expected
        manager.control.cancel("serial")


async def test_stop_threshold_does_not_estimate_from_unscoped_duration_history(
    hass,
):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room", "Room", "vacuum", "quick")
    await manager.catalog.async_save_plan(
        "serial",
        "matrix",
        {
            "finish_current_room": True,
            "finish_current_room_threshold": 50,
            "rooms": [],
        },
    )
    manager.repository.robot("serial")["rotations"]["matrix"] = {
        "rooms": {room.room_id: {"duration_history_seconds": [100, 100, 100]}}
    }
    async with manager.control.lock("serial"):
        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "matrix", room)
        active = manager.repository.data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 49
        active["active_segment_started"] = None
        decision = manager.control.request_stop("serial")
        assert decision.behavior == "after_room"
        assert decision.estimated_progress is None
        manager.control.cancel("serial")


async def test_after_room_stop_docks_after_one_room_and_leaves_next_uncredited(
    hass, monkeypatch
):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_TIMEOUT_SECONDS",
        0.01,
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        CleaningRoom("room-a", "Room A", "vacuum", "quick"),
        CleaningRoom("room-b", "Room B", "vacuum", "quick"),
    ]
    await manager.catalog.async_save_plan(
        "serial",
        "stop",
        {
            "name": "Stop boundary",
            "finish_current_room": True,
            "finish_current_room_threshold": 0,
            "rooms": [asdict(room) for room in rooms],
        },
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {
            "plan_id": "stop",
            "start_timeout": 120,
            "completion_timeout": 600,
            "return_to_base": False,
        },
    )
    identity = b""
    started_at = None
    decisions = []
    commands: list[tuple[int, UserCommand]] = []
    confirmed = []
    ended = False

    async def send(service_call):
        nonlocal identity, started_at
        assert service_call.data["params"]["rooms"] == [rooms[0].room_id]
        session_id = service_call.data["params"].get(PLAN_SESSION_ID)
        identity = (
            _session_identity(UUID(session_id))
            if isinstance(session_id, str)
            else b"synthetic-task"
        )
        started_at = dt_util.utcnow().isoformat()
        hass.states.async_set(
            "vacuum.matic", "cleaning", {"current_area": rooms[0].name}
        )

    async def observe_boundary(*_args, **_kwargs):
        nonlocal ended, identity
        decisions.append(manager.control.request_stop("serial"))
        ended = True
        identity = b""
        hass.states.async_set("vacuum.matic", "idle")
        return RoomRunOutcome.HANDOFF_CANDIDATE

    async def history():
        if not ended:
            return ()
        if manager.ledger.snapshot("serial")["active_plan"]["status"] == "verifying":
            decisions.append(manager.control.request_stop("serial", stop_now=True))
        return (
            CleaningSessionRecord(
                b"synthetic-stop-record",
                CleaningSession(
                    started_at,
                    dt_util.utcnow().isoformat(),
                    30,
                    (rooms[0].name,),
                    (),
                    True,
                    completed_rooms=(rooms[0].name,),
                    vacuum_completed_rooms=(rooms[0].name,),
                    mode_results=(
                        CleaningModeResult(rooms[0].name, "vacuum", "completed", 30),
                    ),
                ),
            ),
        )

    async def managed_command(token: int, command: UserCommand) -> None:
        commands.append((token, command))
        if command is UserCommand.STOP:
            manager.control.mark_stop_pending(
                "serial", run_id=manager.ledger.active_run_id("serial")
            )

    def confirm(room_name: str) -> None:
        confirmed.append(room_name)

    hass.services.async_register("vacuum", "send_command", send)
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
        observe_boundary,
    )
    await asyncio.wait_for(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            active_session=AsyncMock(return_value=False),
            session_history=history,
            confirm_room_completed=confirm,
            managed_user_command=managed_command,
            floor_is_current=lambda: True,
            floor_token="a" * 64,
            session_identity=AsyncMock(side_effect=lambda: identity),
        ),
        timeout=3,
    )

    assert [decision.behavior for decision in decisions] == [
        "after_room",
        "after_room",
    ]
    assert [command for _token, command in commands] == [UserCommand.DOCK]
    assert len({token for token, _command in commands}) == 1
    assert confirmed == [rooms[0].name]
    result = manager.ledger.snapshot("serial")["last_run"]
    assert result["outcome"] == "cancelled"
    assert result["reason_code"] == "managed_stop"
    assert result["completed_room_count"] == 1
    completed_by_room = manager.ledger.snapshot("serial")["last_completed_by_room"]
    assert completed_by_room["room-a"]["runs"] == 1
    assert "room-b" not in completed_by_room
