"""Execute saved-plan option combinations with synthetic native observations."""

from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import AsyncMock

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
from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom
from custom_components.matic_robot.services import RoomRunOutcome, _async_execute_rooms

LAYOUTS = (
    (("mop", "quick"), ("mop", "standard"), ("mop", "heavy_duty")),
    (("vacuum_and_mop", "standard"),) * 3,
    (
        ("vacuum_and_mop", "quick"),
        ("vacuum", "quick"),
        ("vacuum_and_mop", "quick"),
        ("vacuum_and_mop", "quick"),
    ),
)


@pytest.mark.parametrize("layout", LAYOUTS)
@pytest.mark.parametrize("selection", ("ordered", "intelligent", "run_all"))
@pytest.mark.parametrize("return_to_base", (False, True))
@pytest.mark.parametrize("finish_current_room", (False, True))
@pytest.mark.parametrize("threshold", (0, 50, 100))
async def test_saved_plan_options_preserve_dispatch_and_verified_completion(
    hass, monkeypatch, layout, selection, return_to_base, finish_current_room, threshold
):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        CleaningRoom(f"room-{i}", f"Room {i}", mode, setting)
        for i, (mode, setting) in enumerate(layout)
    ]
    await manager.async_save_plan(
        "serial",
        "matrix",
        {
            "name": "Matrix",
            "enabled": True,
            "run_behavior": "ordered" if selection == "ordered" else "intelligent",
            "return_to_base": return_to_base,
            "finish_current_room": finish_current_room,
            "finish_current_room_threshold": threshold,
            "rooms": [asdict(r) for r in rooms],
        },
    )
    # An actual previous completion makes intelligent order differ from both
    # saved order and Run all, while preserving each room's attached settings.
    await manager.async_mark_started("serial", "matrix", rooms[0])
    await manager.async_mark_completed("serial", "matrix", rooms[0])
    expected = rooms[1:] + rooms[:1] if selection == "intelligent" else rooms
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_entire_plan" if selection == "run_all" else "run_selected_plan",
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
        if len(set(layout)) > 1:
            assert params["room_modes"] == [r.cleaning_mode for r in expected]
            assert params["room_coverage"] == [r.coverage_setting for r in expected]
        else:
            assert "room_modes" not in params
            assert "room_coverage" not in params
        identity = b"synthetic-task"
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
    monkeypatch.setattr(
        "custom_components.matic_robot.services._async_wait_for_leg_outcome",
        observe_terminal,
    )
    dock = AsyncMock()
    await _async_execute_rooms(
        hass,
        call,
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        intelligent=selection == "intelligent",
        active_session=AsyncMock(return_value=False),
        session_history=history,
        confirm_room_completed=confirm,
        managed_user_command=dock,
        mapped_room_names=tuple(r.name for r in rooms),
        floor_is_current=lambda: True,
        floor_token="a" * 64,
        session_identity=AsyncMock(side_effect=lambda: identity),
    )
    assert len(commands) == 1
    assert confirmed == [r.name for r in expected]
    result = manager.snapshot("serial")["last_run"]
    assert result["outcome"] == "completed"
    assert result["completed_room_count"] == len(rooms)
    assert not manager.lock("serial").locked()
    if return_to_base:
        dock.assert_awaited_once()
        assert dock.await_args.args[1] is UserCommand.DOCK
    else:
        dock.assert_not_awaited()


@pytest.mark.parametrize("mode", ("vacuum", "mop", "vacuum_and_mop"))
@pytest.mark.parametrize("coverage", ("quick", "standard", "heavy_duty"))
@pytest.mark.parametrize("finish_current_room", (False, True))
@pytest.mark.parametrize("threshold", (0, 1, 50, 99, 100))
async def test_stop_threshold_is_independent_of_cleaning_configuration(
    hass, mode, coverage, finish_current_room, threshold
):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room", "Room", mode, coverage)
    await manager.async_save_plan(
        "serial",
        "matrix",
        {
            "finish_current_room": finish_current_room,
            "finish_current_room_threshold": threshold,
            "rooms": [],
        },
    )
    manager._data["robots"]["serial"]["rotations"]["matrix"] = {
        "rooms": {
            room.room_id: {
                "cleaning_mode": mode,
                "coverage_setting": coverage,
                "duration_history_seconds": [100, 100, 100],
            }
        }
    }
    async with manager.lock("serial"):
        for progress in (max(0, threshold - 0.1), threshold, min(100, threshold + 0.1)):
            manager.prepare_run("serial")
            await manager.async_mark_started("serial", "matrix", room)
            active = manager._data["robots"]["serial"]["active_plan"]
            active["active_elapsed_seconds"] = progress
            active["active_segment_started"] = None
            expected = (
                "after_room"
                if finish_current_room and progress >= threshold
                else "immediate"
            )
            assert manager.request_stop("serial").behavior == expected
            manager.cancel("serial")
