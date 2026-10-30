"""Skip, clean next and clean again from the vacuum entity and plan runs."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot import vacuum
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    QueueAction,
    QueueChangeError,
)
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import CleaningSessionRecord
from custom_components.matic_robot.managed_executor import (
    _async_execute_rooms,
    _async_run_leg,
)
from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom
from custom_components.matic_robot.run_history import _ROOM_RESULTS
from tests.test_entities import _entry
from tests.test_plans import _call, _leg_manager, _leg_record, _room

SERIAL = "synthetic-serial"


def _cleaning_entity(hass, *, cleaning: bool = True):
    entry = _entry()
    coordinator = entry.runtime_data.coordinator
    state = coordinator.data
    coordinator.data = replace(
        state, operational=replace(state.operational, cleaning=cleaning)
    )
    coordinator.client.async_change_queue = AsyncMock()
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    entity.hass = hass
    entity.entity_id = "vacuum.matic"
    return entity, coordinator, manager


async def test_skip_during_a_plan_run_is_noted_for_the_run(hass) -> None:
    entity, coordinator, manager = _cleaning_entity(hass)
    await manager.async_begin_run(
        SERIAL, "plan", "run-1", 2, trigger="user", service="clean_entire_plan"
    )
    token = manager.begin_managed_motion(SERIAL)
    events = []
    hass.bus.async_listen("matic_robot_queue_changed", events.append)

    await entity.async_send_command("skip_room", {"room": "Study"})
    await hass.async_block_till_done()

    call = coordinator.client.async_change_queue.await_args
    assert call.args[1:] == (QueueAction.SKIP, entity._floor_plan().rooms[1])
    assert manager.skipped_room_ids(SERIAL, "run-1") == {"room-2"}
    assert manager.managed_motion_is_current(SERIAL, token)
    assert [event.data for event in events] == [
        {
            "entity_id": "vacuum.matic",
            "action": "skip",
            "room_id": "room-2",
            "room": "Study",
            "run_id": "run-1",
        }
    ]
    coordinator.async_request_refresh.assert_awaited()


async def test_queue_changes_outside_a_plan_run_carry_no_run(hass) -> None:
    entity, coordinator, _manager = _cleaning_entity(hass)
    events = []
    hass.bus.async_listen("matic_robot_queue_changed", events.append)

    await entity.async_send_command("clean_room_next", {"room": "Kitchen"})
    await entity.async_send_command("skip_room", {"room": "Kitchen"})
    await entity.async_send_command(
        "clean_room_again",
        {"room": "Kitchen", "cleaning_mode": "mop", "coverage": "quick"},
    )
    await entity.async_send_command("clean_room_again", {"room": "Kitchen"})
    await hass.async_block_till_done()

    calls = coordinator.client.async_change_queue.await_args_list
    assert [call.args[1] for call in calls] == [
        QueueAction.CLEAN_NEXT,
        QueueAction.SKIP,
        QueueAction.CLEAN_AGAIN,
        QueueAction.CLEAN_AGAIN,
    ]
    assert calls[0].kwargs == {"cleaning_mode": None, "coverage_setting": None}
    assert calls[2].kwargs == {
        "cleaning_mode": CleaningMode.MOP,
        "coverage_setting": CoverageSetting.QUICK,
    }
    assert {event.data["run_id"] for event in events} == {None}


@pytest.mark.parametrize(
    ("params", "key"),
    [
        (None, "queue_room_required"),
        ({"room": " "}, "queue_room_required"),
        ({"room": "Attic"}, "unknown_rooms"),
        ({"room": "Kitchen", "cleaning_mode": "steam"}, "invalid_cleaning_option"),
    ],
)
async def test_queue_commands_refuse_bad_parameters(hass, params, key) -> None:
    entity, coordinator, _manager = _cleaning_entity(hass)

    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_send_command("clean_room_again", params)

    assert raised.value.translation_key == key
    coordinator.client.async_change_queue.assert_not_awaited()


async def test_queue_change_needs_a_clean(hass) -> None:
    entity, coordinator, _manager = _cleaning_entity(hass, cleaning=False)

    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_change_queue(QueueAction.SKIP, "Kitchen")

    assert raised.value.translation_key == "queue_no_clean_running"
    assert raised.value.translation_placeholders == {"room": "Kitchen"}
    coordinator.client.async_change_queue.assert_not_awaited()


async def test_queue_change_refused_when_the_clean_ends_while_waiting(hass) -> None:
    entity, coordinator, manager = _cleaning_entity(hass)
    state = coordinator.data

    @asynccontextmanager
    async def clean_ends(_serial):
        coordinator.data = replace(
            state, operational=replace(state.operational, cleaning=False)
        )
        yield

    manager.external_command = clean_ends

    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_change_queue(QueueAction.SKIP, "Kitchen")

    assert raised.value.translation_key == "queue_no_clean_running"
    coordinator.client.async_change_queue.assert_not_awaited()


@pytest.mark.parametrize(
    ("error", "kind", "key"),
    [
        (QueueChangeError("last_room"), ServiceValidationError, "queue_last_room"),
        (MaticError("synthetic"), HomeAssistantError, "queue_change_failed"),
        (ValueError("synthetic"), HomeAssistantError, "queue_change_failed"),
    ],
)
async def test_queue_change_errors_are_translated(hass, error, kind, key) -> None:
    entity, coordinator, manager = _cleaning_entity(hass)
    await manager.async_begin_run(
        SERIAL, "plan", "run-1", 2, trigger="user", service="clean_entire_plan"
    )
    coordinator.client.async_change_queue.side_effect = error

    with pytest.raises(kind) as raised:
        await entity.async_change_queue(QueueAction.SKIP, "Study")

    assert raised.value.translation_key == key
    assert manager.skipped_room_ids(SERIAL, "run-1") == frozenset()


ROOM = CleaningRoom("room-2", "Study", "vacuum", "standard")


async def test_a_skipped_room_keeps_its_rotation_turn(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_begin_run(
        SERIAL, "plan", "run-1", 1, trigger="user", service="clean_entire_plan"
    )
    record = manager._room(SERIAL, "plan", ROOM)
    record["last_opportunity"] = "2026-10-01T00:00:00+00:00"
    await manager.async_mark_started(SERIAL, "plan", ROOM, run_id="run-1")
    await manager.async_mark_resumed(SERIAL, "plan", ROOM)
    assert record["last_opportunity"] != "2026-10-01T00:00:00+00:00"

    assert await manager.async_note_room_skipped(SERIAL, "run-1", "room-2")
    assert await manager.async_note_room_skipped(SERIAL, "run-1", "room-2")
    assert manager.skipped_room_ids(SERIAL, "run-1") == {"room-2"}
    await manager.async_mark_skipped(SERIAL, "plan", ROOM, run_id="run-1")

    record = manager._room(SERIAL, "plan", ROOM)
    assert record["last_result"] == "skipped"
    assert record["skipped_runs"] == 1
    assert record["last_opportunity"] == "2026-10-01T00:00:00+00:00"
    global_room = manager._global_room(manager._robot(SERIAL), ROOM)
    assert "last_opportunity" not in global_room
    assert "opportunity_before_run" not in global_room
    assert manager.snapshot(SERIAL)["skipped_runs"] == 1
    assert manager._robot(SERIAL)["active_plan"] is None
    assert _ROOM_RESULTS["skipped"] == "skipped"


async def test_a_skip_from_another_run_is_not_kept(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())

    assert not await manager.async_note_room_skipped(SERIAL, "run-1", "room-2")
    assert manager.skipped_room_ids(SERIAL, "run-1") == frozenset()

    await manager.async_begin_run(
        SERIAL, "plan", "run-1", 1, trigger="user", service="clean_entire_plan"
    )
    assert not await manager.async_note_room_skipped(SERIAL, "run-2", "room-2")
    assert manager.skipped_room_ids(SERIAL, "run-2") == frozenset()
    manager._robot(SERIAL)["last_run"]["skipped_room_ids"] = "damaged"
    assert manager.skipped_room_ids(SERIAL, "run-1") == frozenset()

    # A baseline left by another run never rewinds this run's opportunity.
    record = manager._room(SERIAL, "plan", ROOM)
    record["last_opportunity"] = "2026-10-02T00:00:00+00:00"
    record["opportunity_before_run"] = {"run_id": "run-0", "value": None}
    await manager.async_mark_skipped(SERIAL, "plan", ROOM, run_id="run-1")
    assert record["last_opportunity"] == "2026-10-02T00:00:00+00:00"


async def test_plan_run_settles_a_skipped_room_as_skipped(hass) -> None:
    """A room skipped mid-run closes as skipped with the run's ID, not unverified."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    hass.services.async_register("vacuum", "send_command", AsyncMock())
    rooms = [_room("Kitchen", "room-kitchen"), _room("Study", "room-study")]
    events = []
    for event in ("room_skipped", "room_ended_unverified"):
        hass.bus.async_listen(f"matic_robot_{event}", events.append)
    mark_resumed = manager.async_mark_resumed

    async def skip_first_room_then_stop(
        serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        await mark_resumed(serial_number, plan_id, room)
        if room.room_id != rooms[1].room_id:
            return
        run_id = manager.active_run_id(serial_number)
        assert run_id is not None
        await manager.async_note_room_skipped(serial_number, run_id, "room-kitchen")
        manager.cancel(serial_number)

    async def begin_observing_next_room(*_args, **_kwargs) -> float:
        hass.states.async_set(
            "vacuum.matic", "cleaning", {"current_area": rooms[1].name}
        )
        return 30

    with (
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_owned_start",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.managed_executor._async_completion_budget",
            side_effect=begin_observing_next_room,
        ),
        patch.object(
            manager, "async_mark_resumed", side_effect=skip_first_room_then_stop
        ),
    ):
        await asyncio.wait_for(
            _async_execute_rooms(
                hass,
                _call(hass),
                manager,
                "vacuum.matic",
                "serial",
                rooms,
                session_history=AsyncMock(return_value=()),
            ),
            timeout=8,
        )
    await hass.async_block_till_done()

    snapshot = manager.snapshot("serial")
    records = snapshot["plan_history"]["away"]["rooms"]
    assert records["room-kitchen"]["last_result"] == "skipped"
    assert snapshot["skipped_runs"] == 1
    assert [event.event_type for event in events] == ["matic_robot_room_skipped"]
    assert events[0].data["room_id"] == "room-kitchen"
    assert events[0].data["reason_code"] == "owner_skipped"
    assert events[0].data["run_id"] == snapshot["last_run"]["run_id"]


async def test_leg_settles_a_skipped_room_without_credit(hass, monkeypatch) -> None:
    """The leg's own settlement closes a skipped room as skipped."""
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    rooms = [_room("Kitchen", "room-kitchen"), _room("Office", "room-office")]
    manager = _leg_manager()
    manager.skipped_room_ids = MagicMock(return_value=frozenset({"room-office"}))
    manager.async_mark_skipped = AsyncMock()
    skipped = []
    hass.bus.async_listen("matic_robot_room_skipped", skipped.append)

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def end_leg() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(end_leg(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (_leg_record(("Kitchen",), ("Kitchen",)),)

    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        session_history=history,
        managed_user_command=AsyncMock(),
        motion_token=7,
        run_id="run-1",
    )
    await hass.async_block_till_done()

    assert completed is False
    manager.async_mark_ended_unverified.assert_not_awaited()
    manager.async_mark_skipped.assert_awaited_once_with(
        "serial", "away", rooms[1], run_id="run-1"
    )
    assert [event.data["run_id"] for event in skipped] == ["run-1"]
