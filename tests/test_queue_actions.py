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
from custom_components.matic_robot.client.models import (
    CleaningSessionRecord,
    RobotActivity,
)
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_run import RoomRunOutcome
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.run_history import _ROOM_RESULTS
from custom_components.matic_robot.verified_completion import global_room
from tests.session_fakes import FakeRobot, run_step
from tests.test_entities import _entry
from tests.test_plans import _call, _leg_manager, _leg_record, _room

SERIAL = "synthetic-serial"


def _cleaning_entity(hass, *, cleaning: bool = True):
    entry = _entry()
    session = entry.runtime_data.session
    state = session.state.value
    session.state.set(
        replace(state, operational=replace(state.operational, cleaning=cleaning))
    )
    session.client.async_change_queue = AsyncMock()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    entity.hass = hass
    entity.entity_id = "vacuum.matic"
    return entity, session, manager


async def test_skip_during_a_plan_run_is_noted_for_the_run(hass) -> None:
    entity, session, manager = _cleaning_entity(hass)
    await manager.ledger.async_begin_run(
        SERIAL, "plan", "run-1", 2, trigger="user", service="run_selected_plan"
    )
    token = manager.control.begin_managed_motion(SERIAL)
    events = []
    hass.bus.async_listen("matic_robot_queue_changed", events.append)

    await entity.async_send_command("skip_room", {"room": "Study"})
    await hass.async_block_till_done()

    call = session.client.async_change_queue.await_args
    assert call.args[1:] == (QueueAction.SKIP, entity._commands.floor_plan().rooms[1])
    assert manager.ledger.skipped_room_ids(SERIAL, "run-1") == {"room-2"}
    assert manager.control.managed_motion_is_current(SERIAL, token)
    assert [event.data for event in events] == [
        {
            "entity_id": "vacuum.matic",
            "action": "skip",
            "room_id": "room-2",
            "room": "Study",
            "run_id": "run-1",
        }
    ]
    session.heartbeat.async_request_refresh.assert_awaited()


async def test_queue_changes_outside_a_plan_run_carry_no_run(hass) -> None:
    entity, session, _manager = _cleaning_entity(hass)
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

    calls = session.client.async_change_queue.await_args_list
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
    entity, session, _manager = _cleaning_entity(hass)

    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_send_command("clean_room_again", params)

    assert raised.value.translation_key == key
    session.client.async_change_queue.assert_not_awaited()


async def test_queue_change_needs_a_clean(hass) -> None:
    entity, session, _manager = _cleaning_entity(hass, cleaning=False)

    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_change_queue(QueueAction.SKIP, "Kitchen")

    assert raised.value.translation_key == "queue_no_clean_running"
    assert raised.value.translation_placeholders == {"room": "Kitchen"}
    session.client.async_change_queue.assert_not_awaited()


async def test_queue_change_refused_when_the_clean_ends_while_waiting(hass) -> None:
    entity, session, manager = _cleaning_entity(hass)
    state = session.state.value

    @asynccontextmanager
    async def clean_ends(_serial):
        session.state.set(
            replace(state, operational=replace(state.operational, cleaning=False))
        )
        yield

    manager.control.external_command = clean_ends

    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_change_queue(QueueAction.SKIP, "Kitchen")

    assert raised.value.translation_key == "queue_no_clean_running"
    session.client.async_change_queue.assert_not_awaited()


@pytest.mark.parametrize(
    ("error", "kind", "key"),
    [
        (QueueChangeError("last_room"), ServiceValidationError, "queue_last_room"),
        (MaticError("synthetic"), HomeAssistantError, "queue_change_failed"),
        (ValueError("synthetic"), HomeAssistantError, "queue_change_failed"),
    ],
)
async def test_queue_change_errors_are_translated(hass, error, kind, key) -> None:
    entity, session, manager = _cleaning_entity(hass)
    await manager.ledger.async_begin_run(
        SERIAL, "plan", "run-1", 2, trigger="user", service="run_selected_plan"
    )
    session.client.async_change_queue.side_effect = error

    with pytest.raises(kind) as raised:
        await entity.async_change_queue(QueueAction.SKIP, "Study")

    assert raised.value.translation_key == key
    assert manager.ledger.skipped_room_ids(SERIAL, "run-1") == frozenset()


ROOM = CleaningRoom("room-2", "Study", "vacuum", "standard")


async def test_a_skipped_room_keeps_its_rotation_turn(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.ledger.async_begin_run(
        SERIAL, "plan", "run-1", 1, trigger="user", service="run_selected_plan"
    )
    record = manager.ledger.room(SERIAL, "plan", ROOM)
    record["last_opportunity"] = "2026-10-01T00:00:00+00:00"
    await manager.ledger.async_mark_started(SERIAL, "plan", ROOM, run_id="run-1")
    await manager.ledger.async_mark_resumed(SERIAL, "plan", ROOM)
    assert record["last_opportunity"] != "2026-10-01T00:00:00+00:00"

    assert await manager.ledger.async_note_room_skipped(SERIAL, "run-1", "room-2")
    assert await manager.ledger.async_note_room_skipped(SERIAL, "run-1", "room-2")
    assert manager.ledger.skipped_room_ids(SERIAL, "run-1") == {"room-2"}
    await manager.ledger.async_mark_skipped(SERIAL, "plan", ROOM, run_id="run-1")

    record = manager.ledger.room(SERIAL, "plan", ROOM)
    assert record["last_result"] == "skipped"
    assert record["skipped_runs"] == 1
    assert record["last_opportunity"] == "2026-10-01T00:00:00+00:00"
    stats = global_room(manager.repository.robot(SERIAL), ROOM.room_id, ROOM.name)
    assert "last_opportunity" not in stats
    assert "opportunity_before_run" not in stats
    assert manager.history.snapshot(SERIAL)["skipped_runs"] == 1
    assert manager.repository.robot(SERIAL)["active_plan"] is None
    assert _ROOM_RESULTS["skipped"] == "skipped"


async def test_a_skip_from_another_run_is_not_kept(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())

    assert not await manager.ledger.async_note_room_skipped(SERIAL, "run-1", "room-2")
    assert manager.ledger.skipped_room_ids(SERIAL, "run-1") == frozenset()

    await manager.ledger.async_begin_run(
        SERIAL, "plan", "run-1", 1, trigger="user", service="run_selected_plan"
    )
    assert not await manager.ledger.async_note_room_skipped(SERIAL, "run-2", "room-2")
    assert manager.ledger.skipped_room_ids(SERIAL, "run-2") == frozenset()
    manager.repository.robot(SERIAL)["last_run"]["skipped_room_ids"] = "damaged"
    assert manager.ledger.skipped_room_ids(SERIAL, "run-1") == frozenset()

    # A baseline left by another run never rewinds this run's opportunity.
    record = manager.ledger.room(SERIAL, "plan", ROOM)
    record["last_opportunity"] = "2026-10-02T00:00:00+00:00"
    record["opportunity_before_run"] = {"run_id": "run-0", "value": None}
    await manager.ledger.async_mark_skipped(SERIAL, "plan", ROOM, run_id="run-1")
    assert record["last_opportunity"] == "2026-10-02T00:00:00+00:00"


async def test_plan_run_settles_a_skipped_room_as_skipped(hass) -> None:
    """A room skipped mid-run closes as skipped with the run's ID, not unverified."""
    robot = FakeRobot()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    robot.on_start = AsyncMock()
    rooms = [_room("Kitchen", "room-kitchen"), _room("Study", "room-study")]
    events = []
    for event in ("room_skipped", "room_ended_unverified"):
        hass.bus.async_listen(f"matic_robot_{event}", events.append)
    mark_resumed = manager.ledger.async_mark_resumed

    async def skip_first_room_then_stop(
        serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        await mark_resumed(serial_number, plan_id, room)
        if room.room_id != rooms[1].room_id:
            return
        run_id = manager.ledger.active_run_id(serial_number)
        assert run_id is not None
        await manager.ledger.async_note_room_skipped(
            serial_number, run_id, "room-kitchen"
        )
        manager.control.cancel(serial_number)

    async def begin_observing_next_room(*_args, **_kwargs) -> float:
        robot.show("cleaning", current_area=rooms[1].name)
        return 30

    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_owned_start",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_run._async_completion_budget",
            side_effect=begin_observing_next_room,
        ),
        patch.object(
            manager.ledger, "async_mark_resumed", side_effect=skip_first_room_then_stop
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
                floor_token="floor",
                robot=robot.port(session_identity=robot.accepting),
            ),
            timeout=8,
        )
    await hass.async_block_till_done()

    snapshot = manager.history.snapshot("serial")
    records = snapshot["plan_history"]["away"]["rooms"]
    assert records["room-kitchen"]["last_result"] == "skipped"
    assert snapshot["skipped_runs"] == 1
    assert [event.event_type for event in events] == ["matic_robot_room_skipped"]
    assert events[0].data["room_id"] == "room-kitchen"
    assert events[0].data["reason_code"] == "owner_skipped"
    assert events[0].data["run_id"] == snapshot["last_run"]["run_id"]


async def test_leg_settles_a_skipped_room_without_credit(hass, monkeypatch) -> None:
    """The leg closes a skipped room as skipped and lets the run continue."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    rooms = [_room("Kitchen", "room-kitchen"), _room("Office", "room-office")]
    manager = _leg_manager()
    manager.ledger.skipped_room_ids = MagicMock(return_value=frozenset({"room-office"}))
    manager.ledger.async_mark_skipped = AsyncMock()
    skipped = []
    hass.bus.async_listen("matic_robot_room_skipped", skipped.append)

    async def send_command(_call) -> None:
        robot.show("cleaning", current_area="Kitchen")

        async def end_leg() -> None:
            await asyncio.sleep(0)
            robot.show("returning", current_area="Kitchen", low_charge=False)

        hass.async_create_task(end_leg(), eager_start=True)

    robot.on_start = send_command
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
        robot.port(session_history=history, session_identity=robot.accepting),
        7,
        managed_user_command=AsyncMock(),
        run_id="run-1",
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )
    await hass.async_block_till_done()

    # The skipped room is settled, so the run goes on to its next leg.
    assert completed is True
    manager.ledger.async_mark_ended_unverified.assert_not_awaited()
    manager.ledger.async_mark_skipped.assert_awaited_once_with(
        "serial", "away", rooms[1], run_id="run-1"
    )
    assert [event.data["run_id"] for event in skipped] == ["run-1"]


async def test_one_room_leg_settles_a_skipped_room(monkeypatch) -> None:
    """A one-room mission skipped after Clean room again added a room settles."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(bus=bus)
    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            async_claim_native_session=AsyncMock(),
            async_mark_started=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_resumed=AsyncMock(),
            async_mark_skipped=AsyncMock(),
            skipped_room_ids=MagicMock(return_value=frozenset({"room-study"})),
        )
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")

    async def mission_ends(*_args, **_kwargs):
        robot.show("returning")
        return RoomRunOutcome.HANDOFF_CANDIDATE

    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            mission_ends,
        ),
    ):
        settled = await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(
                active_session=AsyncMock(return_value=False),
                session_identity=robot.accepting,
            ),
            3,
            run_id="run-1",
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    assert settled is True
    manager.ledger.async_mark_skipped.assert_awaited_once_with(
        "serial", "away", room, run_id="run-1"
    )
    manager.ledger.async_mark_ended_unverified.assert_not_awaited()
    manager.ledger.async_mark_completed.assert_not_awaited()
    event, data = bus.async_fire.call_args_list[-1].args
    assert event == "matic_robot_room_skipped"
    assert (data["run_id"], data["reason_code"]) == ("run-1", "owner_skipped")
