"""Durable intelligent cleaning behavior."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    CleaningRoom,
    resolve_rooms,
)
from custom_components.matic_robot.services import (
    PlanCancelledError,
    _async_execute_rooms,
    _async_run_room,
    _async_wait_for_vacuum_state,
    _entry_for_entity,
)


def _room(name: str, room_id: str) -> CleaningRoom:
    return CleaningRoom(
        room_id=room_id,
        name=name,
        cleaning_mode="vacuum_and_mop",
        coverage_setting="standard",
    )


def _call(hass, *, return_to_base: bool = False) -> ServiceCall:
    return ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        {
            "plan_id": "away",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": return_to_base,
        },
    )


def test_rooms_resolve_live_names_ids_and_individual_settings() -> None:
    rooms = resolve_rooms(
        [
            {
                "room": "Kitchen",
                "cleaning_mode": "vacuum_and_mop",
                "coverage_setting": "standard",
            },
            {
                "room_id": "room-study",
                "cleaning_mode": "vacuum",
                "coverage_setting": "quick",
            },
        ],
        {
            "room-kitchen": "Kitchen",
            "room-study": "Study",
            "room-omitted": "Garage",
        },
    )

    assert rooms == [
        CleaningRoom("room-kitchen", "Kitchen", "vacuum_and_mop", "standard"),
        CleaningRoom("room-study", "Study", "vacuum", "quick"),
    ]


@pytest.mark.parametrize("identifier", ["Unknown room", "Kitchen"])
def test_rooms_reject_unknown_or_duplicate_mapped_rooms(identifier) -> None:
    raw = [
        {
            "room": "Kitchen",
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
        },
        {
            "room": identifier,
            "cleaning_mode": "mop",
            "coverage_setting": "standard",
        },
    ]
    with pytest.raises(ValueError):
        resolve_rooms(raw, {"room-kitchen": "Kitchen"})


async def test_intelligent_order_avoids_restarting_with_the_same_room(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")
    bedroom = _room("Bedroom", "room-bedroom")

    assert manager.choose("serial", "away", [kitchen, study, bedroom]) == [
        kitchen,
        study,
        bedroom,
    ]
    await manager.async_mark_started("serial", "away", kitchen)
    await manager.async_mark_completed("serial", "away", kitchen)

    assert manager.choose("serial", "away", [kitchen, study, bedroom]) == [
        study,
        bedroom,
        kitchen,
    ]
    snapshot = manager.snapshot("serial")
    assert snapshot["completed_runs"] == 1
    assert snapshot["last_completed_by_room"]["room-kitchen"]["runs"] == 1
    assert snapshot["active_plan"] is None


async def test_failed_cancelled_and_interrupted_rooms_remain_due(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")

    await manager.async_mark_started("serial", "away", kitchen)
    await manager.async_mark_failed("serial", "away", kitchen, "robot error")
    assert manager.choose("serial", "away", [kitchen, study])[0] == kitchen

    await manager.async_mark_started("serial", "away", kitchen)
    await manager.async_mark_cancelled("serial", "away", kitchen)
    snapshot = manager.snapshot("serial")
    assert snapshot["failed_runs"] == 1
    assert snapshot["cancelled_runs"] == 1
    assert manager.choose("serial", "away", [kitchen, study])[0] == kitchen


async def test_restart_recovers_interrupted_room(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(
        async_load=AsyncMock(return_value=None),
        async_save=AsyncMock(),
    )
    await manager.async_load()
    assert manager._data == {"robots": {}}

    room = _room("Kitchen", "room-kitchen")
    await manager.async_mark_started("serial", "away", room)
    recovering = CleaningPlanManager(hass)
    recovering._store = SimpleNamespace(
        async_load=AsyncMock(return_value=manager._data), async_save=AsyncMock()
    )
    await recovering.async_load()
    snapshot = recovering.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["last_interrupted_plan"]["room"] == "Kitchen"
    assert (
        snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]["last_result"]
        == "interrupted"
    )


async def test_listener_lock_and_cancel_lifecycle(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    listener = MagicMock()
    remove = manager.async_add_listener("serial", listener)
    assert manager.lock("serial") is manager.lock("serial")
    assert manager.cancel("serial") is False

    lock = manager.lock("serial")
    await lock.acquire()
    event = manager.prepare_run("serial")
    assert manager.cancel("serial") is True
    assert event.is_set()
    lock.release()

    await manager.async_mark_started("serial", "away", _room("Kitchen", "one"))
    listener.assert_called_once()
    remove()
    await manager.async_mark_failed(
        "serial", "away", _room("Kitchen", "one"), "cancelled"
    )
    listener.assert_called_once()


async def test_room_native_plan_lifecycle_preview_selection_and_reset(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room_map = {"room-kitchen": "Kitchen", "room-study": "Study"}

    await manager.async_save_plan(
        "serial",
        "whole_home",
        {
            "name": "Whole home",
            "enabled": True,
            "run_behavior": "intelligent",
            "rooms": [
                {
                    "room_id": room_id,
                    "cleaning_mode": "vacuum_and_mop",
                    "coverage_setting": "standard",
                }
                for room_id in room_map
            ],
            "return_to_base": True,
        },
    )
    assert list(manager.plans("serial")) == ["whole_home"]
    assert manager.plan("serial")["name"] == "Whole home"
    preview = manager.preview("serial", room_map)
    assert [room["name"] for room in preview["rooms"]] == ["Kitchen", "Study"]

    await manager.async_save_plan(
        "serial",
        "upstairs",
        {
            "name": "Upstairs",
            "enabled": True,
            "rooms": [
                {
                    "room_id": "room-study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
            "return_to_base": False,
        },
    )
    await manager.async_select_plan("serial", "whole_home")
    assert manager.snapshot("serial")["selected_plan_name"] == "Whole home"
    await manager.async_mark_completed(
        "serial", "whole_home", _room("Kitchen", "room-kitchen")
    )
    assert manager.preview("serial", room_map)["rooms"][0]["name"] == "Study"
    await manager.async_reset_history("serial", "whole_home")
    assert manager.snapshot("serial")["completed_runs"] == 0
    await manager.async_delete_plan("serial", "whole_home")
    assert manager.snapshot("serial")["selected_plan"] == "upstairs"
    await manager.async_reset_history("serial")


async def test_plan_validation_rejects_disabled_empty_unknown_and_missing(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial", "disabled", {"name": "Disabled", "enabled": False, "rooms": []}
    )
    with pytest.raises(ValueError, match="disabled"):
        manager.rooms_for_plan("serial", {}, "disabled")
    with pytest.raises(KeyError):
        manager.plan("serial", "missing")
    with pytest.raises(KeyError):
        await manager.async_select_plan("serial", "missing")

    await manager.async_save_plan(
        "serial", "empty", {"name": "Empty", "enabled": True, "rooms": []}
    )
    with pytest.raises(ValueError, match="no rooms"):
        manager.rooms_for_plan("serial", {}, "empty")


async def test_room_execution_uses_its_individual_settings() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_failed=AsyncMock(),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")

    with patch(
        "custom_components.matic_robot.services._async_wait_for_vacuum_state",
        AsyncMock(side_effect=["cleaning", "docked"]),
    ) as wait:
        await _async_run_room(
            hass, _call(hass), manager, "vacuum.matic", "serial", room
        )

    assert services.async_call.await_args.args[2] == {
        "entity_id": "vacuum.matic",
        "command": "clean_rooms",
        "params": {
            "rooms": ["room-study"],
            "cleaning_mode": "vacuum",
            "coverage": "quick",
            "ordered": False,
        },
    }
    assert wait.await_count == 2
    manager.async_mark_completed.assert_awaited_once()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_completed"


async def test_room_timeout_is_failure_safe() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_failed=AsyncMock(),
    )
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(side_effect=TimeoutError),
        ),
        pytest.raises(ServiceValidationError, match="Timed out"),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
        )
    manager.async_mark_failed.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_failed"


async def test_wait_handles_error_unavailable_transition_and_cancel(hass) -> None:
    hass.states.async_set("vacuum.matic", "error")
    with pytest.raises(ServiceValidationError, match="error"):
        await _async_wait_for_vacuum_state(hass, "vacuum.matic", {"cleaning"}, 10)

    hass.states.async_set("vacuum.matic", "unavailable")
    waiting = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.matic", {"cleaning"}, 10)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.matic", "cleaning")
    assert await waiting == "cleaning"

    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.matic", {"docked"}, 10, cancel)
    )
    await asyncio.sleep(0)
    cancel.set()
    with pytest.raises(PlanCancelledError):
        await waiting


async def test_execute_rooms_rejects_overlap_handles_cancel_and_returns_home(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    call = _call(hass, return_to_base=True)
    lock = manager.lock("serial")
    await lock.acquire()
    try:
        with pytest.raises(ServiceValidationError, match="already running"):
            await _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [room],
                intelligent=True,
            )
    finally:
        lock.release()

    with patch(
        "custom_components.matic_robot.services._async_run_room",
        AsyncMock(side_effect=PlanCancelledError),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            intelligent=True,
        )

    service_call = AsyncMock()
    fake_hass = SimpleNamespace(
        services=SimpleNamespace(async_call=service_call),
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        ),
    )
    with patch(
        "custom_components.matic_robot.services._async_run_room", AsyncMock()
    ) as run:
        await _async_execute_rooms(
            fake_hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            intelligent=False,
        )
    run.assert_awaited_once()
    service_call.assert_awaited_once_with(
        "vacuum",
        "return_to_base",
        {"entity_id": "vacuum.matic"},
        blocking=True,
        context=call.context,
    )


def test_entry_lookup_rejects_missing_registry_entry() -> None:
    registry = SimpleNamespace(async_get=MagicMock(return_value=None))
    with (
        patch(
            "custom_components.matic_robot.services.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="unavailable"),
    ):
        _entry_for_entity(SimpleNamespace(), "vacuum.matic")
