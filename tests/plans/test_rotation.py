"""Room rotation from managed and native room history."""

import asyncio
from copy import deepcopy
from datetime import UTC, timedelta
from unittest.mock import MagicMock, patch

import pytest
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.plan_state as plan_state_module
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.plan_timing import _latest_timestamp
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import memory_manager, plan_room


async def test_native_history_import_records_activity_not_completion(
    hass,
) -> None:
    manager = memory_manager(hass)
    listener = MagicMock()
    manager.repository.async_add_listener("serial", listener)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room("living", "Living Room", "living", b"living", ()),
            Room("hall", "Hallway", "hall", b"hall", ()),
            Room("office-a", "Office", "office-a", b"office-a", ()),
            Room("office-b", "The Office", "office-b", b"office-b", ()),
        ),
    )

    def record(
        key: bytes,
        ended_at: str | None,
        room: str,
        duration: int | float | bool,
        *,
        completed_rooms: tuple[str, ...],
    ) -> CleaningSessionRecord:
        return CleaningSessionRecord(
            key,
            CleaningSession(
                "2026-07-28T17:00:00+00:00",
                ended_at,
                600,
                (room,),
                ((room, duration),),
                True,
                completed_rooms,
            ),
        )

    manager.repository.robot("serial")["rooms"]["hall"] = {
        "name": "Hallway",
        "last_completed": "2026-07-28T23:30:00+00:00",
        "last_duration_seconds": 77,
    }
    records = (
        record(
            b"living-old",
            "2026-07-28T18:00:00+00:00",
            "Living Room",
            100,
            completed_rooms=("Living Room",),
        ),
        record(
            b"living-new",
            "2026-07-28T19:00:00+00:00",
            "the Living Room",
            120.6,
            completed_rooms=("the Living Room",),
        ),
        record(
            b"attempted",
            "2026-07-28T20:00:00+00:00",
            "Living Room",
            180,
            completed_rooms=(),
        ),
        record(
            b"older-hall",
            "2026-07-28T22:00:00+00:00",
            "Hallway",
            90,
            completed_rooms=("Hallway",),
        ),
        record(
            b"ambiguous",
            "2026-07-28T22:00:00+00:00",
            "Office",
            90,
            completed_rooms=("Office",),
        ),
        record(
            b"unknown",
            "2026-07-28T22:00:00+00:00",
            "Garage",
            90,
            completed_rooms=("Garage",),
        ),
        record(
            b"invalid-duration",
            "2026-07-28T22:00:00+00:00",
            "Living Room",
            True,
            completed_rooms=("Living Room",),
        ),
        record(
            b"future",
            "2099-07-28T22:00:00+00:00",
            "Living Room",
            90,
            completed_rooms=("Living Room",),
        ),
        record(
            b"unfinished",
            None,
            "Living Room",
            90,
            completed_rooms=("Living Room",),
        ),
    )

    assert (
        await manager.ledger.async_import_native_history("serial", floor_plan, records)
        is True
    )
    history = manager.history.snapshot("serial")["last_completed_by_room"]
    # The robot's record cannot prove a room was finished, so importing it
    # never claims a completion: it only keeps rotation fairness current.
    assert history["living"]["at"] is None
    assert history["living"]["runs"] == 0
    assert history["living"]["name"] == "Living Room"
    assert history["hall"]["at"] == "2026-07-28T23:30:00+00:00"
    assert "office-a" not in history
    rooms = manager.repository.robot("serial")["rooms"]
    # A record with no usable duration still proves the robot worked there,
    # so the newest such session is the room's latest opportunity.
    assert rooms["living"]["last_opportunity"] == "2026-07-28T22:00:00+00:00"
    assert "last_duration_seconds" not in rooms["living"]
    # A verified completion that is newer than the native evidence stands.
    assert "last_opportunity" not in rooms["hall"]
    manager.repository.store.async_save.assert_awaited_once()
    listener.assert_called_once()

    manager.repository.store.async_save.reset_mock()
    listener.reset_mock()
    assert (
        await manager.ledger.async_import_native_history("serial", floor_plan, records)
        is False
    )
    assert (
        await manager.ledger.async_import_native_history("serial", None, records)
        is None
    )
    manager.repository.store.async_save.assert_not_awaited()
    listener.assert_not_called()


async def test_intelligent_order_avoids_restarting_with_the_same_room(hass) -> None:
    manager = memory_manager(hass)
    kitchen = plan_room("Kitchen", "room-kitchen")
    study = plan_room("Study", "room-study")
    bedroom = plan_room("Bedroom", "room-bedroom")

    assert manager.planning.choose("serial", "away", [kitchen, study, bedroom]) == [
        kitchen,
        study,
        bedroom,
    ]
    await manager.ledger.async_mark_started("serial", "away", kitchen)
    await manager.ledger.async_mark_completed("serial", "away", kitchen)

    assert manager.planning.choose("serial", "away", [kitchen, study, bedroom]) == [
        study,
        bedroom,
        kitchen,
    ]
    snapshot = manager.history.snapshot("serial")
    assert snapshot["completed_runs"] == 1
    assert snapshot["last_completed_by_room"]["room-kitchen"]["runs"] == 1
    assert snapshot["active_plan"] is None


async def test_intelligent_order_includes_external_room_cleaning(hass) -> None:
    """Native activity outside this integration moves a room behind its peers."""
    manager = memory_manager(hass)
    kitchen = plan_room("Kitchen", "room-kitchen")
    study = plan_room("Study", "room-study")
    manager.repository.robot("serial")["rooms"]["room-kitchen"] = {
        "last_opportunity": "2026-08-31T12:00:00+00:00",
    }

    assert manager.planning.choose("serial", "away", [kitchen, study]) == [
        study,
        kitchen,
    ]


async def test_unfinished_rooms_remain_due_without_monopolizing_rotation(hass) -> None:
    manager = memory_manager(hass)
    kitchen = plan_room("Kitchen", "room-kitchen")
    study = plan_room("Study", "room-study")

    await manager.ledger.async_mark_started("serial", "away", kitchen)
    started_record = manager.repository.robot("serial")["rotations"]["away"]["rooms"][
        kitchen.room_id
    ]
    assert "last_opportunity" not in started_record
    assert kitchen.room_id not in manager.repository.robot("serial")["rooms"]
    await manager.ledger.async_mark_failed(
        "serial", "away", kitchen, "dispatch rejected"
    )
    assert manager.planning.choose("serial", "away", [kitchen, study]) == [
        kitchen,
        study,
    ]
    await manager.ledger.async_mark_started("serial", "away", kitchen)
    await manager.ledger.async_mark_resumed("serial", "away", kitchen)
    confirmed_at = manager.repository.robot("serial")["rotations"]["away"]["rooms"][
        kitchen.room_id
    ]["last_opportunity"]
    assert (
        manager.repository.robot("serial")["rooms"][kitchen.room_id]["last_opportunity"]
        == confirmed_at
    )
    await manager.ledger.async_mark_resumed("serial", "away", kitchen)
    assert (
        manager.repository.robot("serial")["rotations"]["away"]["rooms"][
            kitchen.room_id
        ]["last_opportunity"]
        == confirmed_at
    )
    await manager.ledger.async_mark_failed("serial", "away", kitchen, "robot error")
    assert manager.planning.choose("serial", "away", [kitchen, study]) == [
        study,
        kitchen,
    ]

    await manager.ledger.async_mark_started("serial", "away", study)
    await manager.ledger.async_mark_resumed("serial", "away", study)
    await manager.ledger.async_mark_cancelled("serial", "away", study)
    snapshot = manager.history.snapshot("serial")
    assert snapshot["failed_runs"] == 2
    assert snapshot["cancelled_runs"] == 1
    assert manager.planning.choose("serial", "away", [kitchen, study]) == [
        kitchen,
        study,
    ]


async def test_revisited_room_updates_active_room_without_losing_skip_baseline(
    hass,
) -> None:
    manager = memory_manager(hass)
    kitchen, study = (
        plan_room("Kitchen", "room-kitchen"),
        plan_room("Study", "room-study"),
    )
    robot = manager.repository.robot("serial")
    robot["last_run"] = {
        "run_id": "run-1",
        "plan_id": "away",
        "outcome": "running",
        "recovery_checkpoint": {"started_room_ids": []},
    }
    original = "2026-08-31T12:00:00+00:00"
    manager.ledger.room("serial", "away", kitchen)["last_opportunity"] = original
    robot["rooms"][kitchen.room_id] = {"last_opportunity": original}

    assert await manager.ledger.async_mark_started(
        "serial", "away", kitchen, run_id="run-1"
    )
    await manager.ledger.async_mark_resumed("serial", "away", kitchen)
    assert await manager.ledger.async_mark_started(
        "serial", "away", study, run_id="run-1"
    )
    await manager.ledger.async_mark_resumed("serial", "away", study)
    assert not await manager.ledger.async_mark_started(
        "serial", "away", kitchen, run_id="run-1"
    )
    await manager.ledger.async_mark_resumed("serial", "away", kitchen)

    assert (
        manager.history.snapshot("serial")["active_plan"]["room_id"] == kitchen.room_id
    )
    assert (
        manager.ledger.room("serial", "away", kitchen)["opportunity_before_run"][
            "value"
        ]
        == original
    )
    assert (
        robot["rooms"][kitchen.room_id]["opportunity_before_run"]["value"] == original
    )


async def test_stale_run_completion_cannot_credit_new_run_with_same_plan_id(
    hass,
) -> None:
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    checkpoint = {"completed_room_ids": [], "cadence_by_room": {}}
    manager.repository.robot("serial").update(
        {
            "last_run": {
                "run_id": "current-run",
                "plan_id": "away",
                "outcome": "running",
                "room_count": 1,
                "completed_room_count": 0,
                "recovery_checkpoint": checkpoint,
            },
            "active_plan": {
                "run_id": "current-run",
                "plan_id": "away",
                "room_id": room.room_id,
            },
        }
    )

    accepted = await manager.ledger.async_mark_completed(
        "serial", "away", room, run_id="superseded-run"
    )

    assert accepted is False
    assert manager.repository.robot("serial")["rotations"] == {}
    assert manager.repository.robot("serial")["active_plan"]["run_id"] == "current-run"
    assert manager.repository.robot("serial")["last_run"]["completed_room_count"] == 0
    manager.repository.store.async_save.assert_not_awaited()

    assert await manager.ledger.async_mark_completed(
        "serial", "away", room, run_id="current-run"
    )
    assert manager.repository.robot("serial")["last_run"]["completed_room_count"] == 1
    assert manager.repository.robot("serial")["active_plan"] is None


@pytest.mark.parametrize("outcome", ["completed", "failed", "cancelled", "interrupted"])
async def test_terminal_run_cannot_credit_late_completion(hass, outcome: str) -> None:
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    robot = manager.repository.robot("serial")
    robot.update(
        {
            "plan_room_cadence": {
                "away": {room.room_id: {"identity": "existing", "progress": 2}}
            },
            "last_run": {
                "run_id": "finished-run",
                "plan_id": "away",
                "outcome": outcome,
                "room_count": 1,
                "completed_room_count": 0,
                "recovery_checkpoint": {
                    "completed_room_ids": [],
                    "cadence_by_room": {
                        room.room_id: {
                            "scope": "shared",
                            "identity": "late-completion",
                            "progress": 0,
                        }
                    },
                },
            },
            "active_plan": {
                "run_id": "finished-run",
                "plan_id": "away",
                "room_id": room.room_id,
            },
        }
    )
    plan_state_module.parse_robot(robot)
    before = deepcopy(robot)

    accepted = await manager.ledger.async_mark_completed(
        "serial", "away", room, run_id="finished-run", duration_seconds=120
    )

    assert accepted is False
    assert manager.repository.robot("serial") == before
    manager.repository.store.async_save.assert_not_awaited()


async def test_three_room_short_runs_cycle_after_terminal_outcomes(hass) -> None:
    manager = memory_manager(hass)
    kitchen = plan_room("Kitchen", "room-kitchen")
    study = plan_room("Study", "room-study")
    bedroom = plan_room("Bedroom", "room-bedroom")
    rooms = [kitchen, study, bedroom]

    await manager.ledger.async_mark_started("serial", "away", kitchen)
    await manager.ledger.async_mark_resumed("serial", "away", kitchen)
    await manager.ledger.async_mark_failed("serial", "away", kitchen, "blocked")
    assert manager.planning.choose("serial", "away", rooms)[0] == study

    await manager.ledger.async_mark_started("serial", "away", study)
    await manager.ledger.async_mark_resumed("serial", "away", study)
    await manager.ledger.async_mark_cancelled("serial", "away", study)
    assert manager.planning.choose("serial", "away", rooms)[0] == bedroom

    await manager.ledger.async_mark_started("serial", "away", bedroom)
    await manager.ledger.async_mark_resumed("serial", "away", bedroom)
    await manager.ledger.async_mark_interrupted("serial", "away", bedroom, "offline")
    assert manager.planning.choose("serial", "away", rooms)[0] == kitchen
    assert manager.history.snapshot("serial")["completed_runs"] == 0


async def test_fair_rotation_cycles_every_mapped_room_during_short_runs(hass) -> None:
    manager = memory_manager(hass)
    rooms = [plan_room(f"Room {index}", f"room-{index}") for index in range(12)]
    base = dt_util.utcnow() - timedelta(hours=1)

    for index, expected in enumerate(rooms * 2):
        assert manager.planning.choose("serial", "away", rooms)[0] == expected
        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=base + timedelta(seconds=index),
        ):
            await manager.ledger.async_mark_started("serial", "away", expected)
            await manager.ledger.async_mark_resumed("serial", "away", expected)
            await manager.ledger.async_mark_failed(
                "serial", "away", expected, "blocked"
            )

    assert manager.history.snapshot("serial")["completed_runs"] == 0
    assert manager.history.snapshot("serial")["failed_runs"] == 24


async def test_new_plan_uses_global_room_completion_as_rotation_fallback(hass) -> None:
    manager = memory_manager(hass)
    kitchen = plan_room("Kitchen", "room-kitchen")
    study = plan_room("Study", "room-study")

    await manager.ledger.async_mark_started("serial", "weekday", kitchen)
    await manager.ledger.async_mark_completed("serial", "weekday", kitchen)

    assert manager.planning.choose("serial", "weekend", [kitchen, study]) == [
        study,
        kitchen,
    ]

    second_manager = memory_manager(hass)
    await second_manager.ledger.async_mark_started("serial", "weekday", kitchen)
    await second_manager.ledger.async_mark_resumed("serial", "weekday", kitchen)
    await second_manager.ledger.async_mark_failed(
        "serial", "weekday", kitchen, "synthetic blockage"
    )
    assert second_manager.planning.choose("serial", "weekend", [kitchen, study]) == [
        study,
        kitchen,
    ]


async def test_plan_reset_ignores_old_shared_history_but_accepts_new_activity(
    hass,
) -> None:
    manager = memory_manager(hass)
    kitchen = plan_room("Kitchen", "room-kitchen")
    study = plan_room("Study", "room-study")
    rooms = [kitchen, study]
    base = dt_util.utcnow() - timedelta(minutes=3)
    await manager.catalog.async_save_plan("serial", "weekday", {"name": "Weekday"})
    await manager.catalog.async_save_plan("serial", "weekend", {"name": "Weekend"})

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.ledger.async_mark_started("serial", "weekday", kitchen)
        await manager.ledger.async_mark_completed("serial", "weekday", kitchen)
    assert manager.planning.choose("serial", "weekend", rooms) == [study, kitchen]

    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(minutes=1),
    ):
        await manager.ledger.async_reset_history("serial", "weekend")
    assert manager.planning.choose("serial", "weekend", rooms) == rooms

    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(minutes=2),
    ):
        await manager.ledger.async_mark_started("serial", "weekday", kitchen)
        await manager.ledger.async_mark_resumed("serial", "weekday", kitchen)
        await manager.ledger.async_mark_failed("serial", "weekday", kitchen, "blocked")
    assert manager.planning.choose("serial", "weekend", rooms) == [study, kitchen]


async def test_plan_reset_discards_matching_native_reconciliation(hass) -> None:
    manager = memory_manager(hass)
    kitchen = plan_room("Kitchen", "room-kitchen")
    dispatched_at = dt_util.utcnow()
    marker = {
        "plan_id": "away",
        "room_id": kitchen.room_id,
        "room": kitchen.name,
        "dispatched_at": dispatched_at.isoformat(),
    }
    await manager.catalog.async_save_plan("serial", "away", {"name": "Away"})
    await manager.catalog.async_save_plan("serial", "other", {"name": "Other"})

    await manager.ledger.async_mark_started("serial", "away", kitchen)
    await manager.ledger.async_mark_failed(
        "serial", "away", kitchen, "stopped", native_reconciliation=marker
    )
    watcher = asyncio.create_task(asyncio.Event().wait())
    manager.control.register_reconciliation_task("serial", watcher)

    await manager.ledger.async_reset_history("serial", "other")
    assert "pending_native_reconciliation" in manager.repository.robot("serial")
    assert watcher.done() is False

    await manager.ledger.async_reset_history("serial", "away")
    await asyncio.gather(watcher, return_exceptions=True)
    assert watcher.cancelled()
    assert "pending_native_reconciliation" not in manager.repository.robot("serial")
    assert "away" not in manager.repository.robot("serial")["rotations"]
    assert not await manager.ledger.async_mark_native_completed(
        "serial",
        "away",
        kitchen,
        dispatched_at=dispatched_at,
        completed_at=dt_util.utcnow().isoformat(),
        duration_seconds=60,
    )
    assert "away" not in manager.repository.robot("serial")["rotations"]

    await manager.ledger.async_mark_started("serial", "away", kitchen)
    await manager.ledger.async_mark_failed(
        "serial", "away", kitchen, "stopped", native_reconciliation=marker
    )
    second_watcher = asyncio.create_task(asyncio.Event().wait())
    manager.control.register_reconciliation_task("serial", second_watcher)
    await manager.ledger.async_reset_history("serial")
    await asyncio.gather(second_watcher, return_exceptions=True)
    assert second_watcher.cancelled()
    assert "pending_native_reconciliation" not in manager.repository.robot("serial")
    assert manager.repository.robot("serial")["rotations"] == {}


def test_rotation_recovers_from_corrupt_or_future_history(hass) -> None:
    manager = CleaningPlanManager(hass)
    kitchen = plan_room("Kitchen", "room-kitchen")
    study = plan_room("Study", "room-study")
    bedroom = plan_room("Bedroom", "room-bedroom")
    robot = manager.repository.robot("serial")
    robot["rotations"]["away"] = {
        "rooms": {
            kitchen.room_id: {"last_opportunity": "not-a-timestamp"},
            study.room_id: {"last_opportunity": "2030-01-01T00:00:00+00:00"},
            bedroom.room_id: "corrupt-record",
        }
    }
    robot["rooms"] = "corrupt-global-history"
    plan_state_module.parse_robot(robot)

    assert manager.planning.choose("serial", "away", [kitchen, study, bedroom]) == [
        kitchen,
        study,
        bedroom,
    ]


def test_latest_rotation_timestamp_rejects_untrusted_values() -> None:
    now = dt_util.parse_datetime("2026-01-03T00:00:00+00:00")
    assert now is not None
    assert (
        _latest_timestamp(
            None,
            123,
            "invalid",
            "2026-01-01T00:00:00",
            "2030-01-01T00:00:00+00:00",
            now=now,
        )
        is None
    )
    assert (
        _latest_timestamp(
            "2026-01-01T00:00:00+00:00",
            "2026-01-02T00:00:00+00:00",
            now=now,
        )
        == dt_util.parse_datetime("2026-01-02T00:00:00+00:00").timestamp()
    )

    invalid_datetime = MagicMock(tzinfo=UTC)
    invalid_datetime.timestamp.side_effect = OSError
    with patch(
        "custom_components.matic_robot.plans.dt_util.parse_datetime",
        return_value=invalid_datetime,
    ):
        assert _latest_timestamp("synthetic", now=now) is None


async def test_suspended_and_interrupted_rooms_never_advance_history(hass) -> None:
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    await manager.ledger.async_mark_started("serial", "away", room)

    await manager.ledger.async_mark_suspended("serial", "away", room, "low_charge")
    snapshot = manager.history.snapshot("serial")
    record = snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]
    assert record["last_result"] == "suspended"
    assert record["suspended_runs"] == 1
    assert snapshot["active_plan"]["status"] == "suspended"
    assert snapshot["completed_runs"] == 0
    assert snapshot["suspended_runs"] == 1

    await manager.ledger.async_mark_resumed("serial", "away", room)
    assert manager.history.snapshot("serial")["active_plan"]["status"] == "running"
    await manager.ledger.async_mark_interrupted("serial", "away", room, "unknown stop")
    snapshot = manager.history.snapshot("serial")
    record = snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]
    assert record["last_result"] == "interrupted"
    assert record["interrupted_runs"] == 1
    assert snapshot["completed_runs"] == 0
    assert snapshot["interrupted_runs"] == 1
    assert snapshot["active_plan"] is None
    assert snapshot["last_interrupted_plan"]["room"] == "Kitchen"
