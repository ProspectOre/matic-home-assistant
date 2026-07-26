"""Durable intelligent cleaning behavior."""

import asyncio
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    binding_for_floor_plan,
)
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    CleaningRoom,
    ManagedMotionReplacedError,
    PlanStopDecision,
    _duration_history,
    _elapsed_seconds,
    _estimated_progress,
    _expected_duration,
    resolve_rooms,
)
from custom_components.matic_robot.services import (
    SESSION_HISTORY_ATTEMPTS,
    PlanCancelledError,
    RoomRunOutcome,
    RoomTakenOverError,
    _async_active_session_state,
    _async_execute_rooms,
    _async_run_room,
    _async_session_history_baseline,
    _async_verify_room_completion,
    _async_wait_for_active_session_resolution,
    _async_wait_for_room_outcome,
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


async def test_custom_areas_round_trip_by_id_and_name_without_snapshot(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "protocol", b"room", ((0, 0), (2, 0), (0, 2))),),
    )
    saved = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Litter box",
        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_floor_plan(floor_plan),
    }

    await manager.async_save_area("serial", "litter_box", saved)

    assert manager.area("serial", "litter_box") == {"id": "litter_box", **saved}
    assert manager.area("serial", "LITTER BOX") == {"id": "litter_box", **saved}
    assert manager.areas("serial") == {"litter_box": saved}
    assert "areas" not in manager.snapshot("serial")
    with pytest.raises(KeyError):
        manager.area("serial", "missing")

    await manager.async_delete_area("serial", "litter_box")
    assert manager.areas("serial") == {}


async def test_plan_store_migrates_legacy_areas_without_fabricating_map_binding(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    assert manager._store.version == 1
    assert manager._store.minor_version == 2
    assert manager._store._private is True
    stored = {
        "robots": {
            "serial": {
                "areas": {
                    "legacy": {
                        "name": "Legacy",
                        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
                    },
                    "bound": {"schema_version": AREA_SCHEMA_VERSION},
                    "corrupt": "not-a-record",
                }
            },
            "no_areas": {"areas": []},
            "corrupt": "not-a-robot",
        }
    }

    migrated = await manager._store._async_migrate_func(1, 1, stored)

    legacy = migrated["robots"]["serial"]["areas"]["legacy"]
    assert legacy["schema_version"] == 0
    assert "map_binding" not in legacy
    assert migrated["robots"]["serial"]["areas"]["bound"] == {
        "schema_version": AREA_SCHEMA_VERSION
    }
    assert migrated["robots"]["serial"]["areas"]["corrupt"] == "not-a-record"

    with pytest.raises(ValueError, match="storage version"):
        await manager._store._async_migrate_func(2, 1, stored)
    with pytest.raises(ValueError, match="minor version"):
        await manager._store._async_migrate_func(1, 3, stored)


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


async def test_motion_arbiter_revokes_and_serializes_managed_commands(hass) -> None:
    manager = CleaningPlanManager(hass)
    token = manager.begin_managed_motion("serial")

    assert manager.command_lock("serial") is manager.command_lock("serial")
    assert manager.managed_motion_is_current("serial", token) is True
    async with manager.managed_command("serial", token):
        assert manager.command_lock("serial").locked()

    async with manager.external_motion("serial"):
        assert manager.command_lock("serial").locked()
        assert manager.managed_motion_is_current("serial", token) is False

    with pytest.raises(ManagedMotionReplacedError):
        async with manager.managed_command("serial", token):
            pass

    newer = manager.begin_managed_motion("serial")
    manager.end_managed_motion("serial", token)
    assert manager.managed_motion_is_current("serial", newer) is True
    manager.end_managed_motion("serial", newer)
    assert manager.managed_motion_is_current("serial", newer) is False


async def test_suspended_and_interrupted_rooms_never_advance_history(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    await manager.async_mark_started("serial", "away", room)

    await manager.async_mark_suspended("serial", "away", room, "low_charge")
    snapshot = manager.snapshot("serial")
    record = snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]
    assert record["last_result"] == "suspended"
    assert record["suspended_runs"] == 1
    assert snapshot["active_plan"]["status"] == "suspended"
    assert snapshot["completed_runs"] == 0
    assert snapshot["suspended_runs"] == 1

    await manager.async_mark_resumed("serial", "away", room)
    assert manager.snapshot("serial")["active_plan"]["status"] == "running"
    await manager.async_mark_interrupted("serial", "away", room, "unknown stop")
    snapshot = manager.snapshot("serial")
    record = snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]
    assert record["last_result"] == "interrupted"
    assert record["interrupted_runs"] == 1
    assert snapshot["completed_runs"] == 0
    assert snapshot["interrupted_runs"] == 1
    assert snapshot["active_plan"] is None
    assert snapshot["last_interrupted_plan"]["room"] == "Kitchen"


async def test_stop_policy_learns_room_duration_and_applies_threshold(hass) -> None:
    """A stop finishes only rooms at or above the plan's learned threshold."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "away",
        {
            "name": "Away",
            "enabled": True,
            "finish_current_room": True,
            "finish_current_room_threshold": 50,
            "rooms": [],
        },
    )
    room = _room("Kitchen", "room-kitchen")
    lock = manager.lock("serial")
    await lock.acquire()
    try:
        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        manager._data["robots"]["serial"]["plans"]["away"]["finish_current_room"] = (
            False
        )
        assert manager.request_stop("serial") == PlanStopDecision("immediate")

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        plan = manager._data["robots"]["serial"]["plans"]["away"]
        plan["finish_current_room"] = True
        plan["finish_current_room_threshold"] = "invalid"
        assert manager.request_stop("serial") == PlanStopDecision(
            "after_room", None, 50
        )
        plan["finish_current_room_threshold"] = 50

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        assert manager.request_stop("serial") == PlanStopDecision(
            "after_room", None, 50
        )

        for duration in (100, 105, 1000):
            manager.prepare_run("serial")
            await manager.async_mark_started("serial", "away", room)
            active = manager._data["robots"]["serial"]["active_plan"]
            active["active_elapsed_seconds"] = duration
            active["active_segment_started"] = None
            await manager.async_mark_completed("serial", "away", room)
        record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][
            "room-kitchen"
        ]
        assert record["average_duration_seconds"] == 105
        assert record["duration_history_seconds"] == [100, 105, 1000]

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 40
        active["active_segment_started"] = None
        assert manager.request_stop("serial") == PlanStopDecision("immediate", 38, 50)
        assert manager.cancellation_event("serial").is_set()

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 60
        active["active_segment_started"] = None
        assert manager.request_stop("serial") == PlanStopDecision("after_room", 57, 50)
        assert manager.finish_room_event("serial").is_set()
        assert not manager.cancellation_event("serial").is_set()

        changed = CleaningRoom("room-kitchen", "Kitchen", "mop", "standard")
        await manager.async_mark_started("serial", "away", changed)
        changed_record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][
            "room-kitchen"
        ]
        assert "average_duration_seconds" not in changed_record
    finally:
        lock.release()


async def test_active_duration_excludes_suspension_and_cancel_is_not_learned(
    hass,
) -> None:
    """Only active cleaning segments feed successful duration estimates."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial", "away", {"name": "Away", "enabled": True, "rooms": []}
    )
    room = _room("Kitchen", "room-kitchen")
    base = dt_util.utcnow()

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=30),
    ):
        await manager.async_mark_suspended("serial", "away", room, "low_charge")
    active = manager.snapshot("serial")["active_plan"]
    assert active["active_elapsed_seconds"] == 30
    assert active["active_segment_started"] is None
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(hours=1),
    ):
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(hours=1, seconds=30),
    ):
        await manager.async_mark_completed("serial", "away", room)

    record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][room.room_id]
    assert record["last_duration_seconds"] == 60
    assert record["duration_history_seconds"] == [60]

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=15),
    ):
        await manager.async_mark_cancelled("serial", "away", room)
    cancelled = manager.snapshot("serial")["plan_history"]["away"]["rooms"][
        room.room_id
    ]
    assert cancelled["last_duration_seconds"] == 60
    assert cancelled["last_cancelled_duration_seconds"] == 15
    assert cancelled["duration_history_seconds"] == [60]

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=45),
    ):
        await manager.async_mark_ended_unverified("serial", "away", room)
    unverified = manager.snapshot("serial")
    unverified_record = unverified["plan_history"]["away"]["rooms"][room.room_id]
    assert unverified["completed_runs"] == 1
    assert unverified["unverified_runs"] == 1
    assert unverified_record["last_result"] == "ended_unverified"
    assert unverified_record["last_duration_seconds"] == 60
    assert unverified_record["last_unverified_duration_seconds"] == 45
    assert unverified_record["duration_history_seconds"] == [60]


def test_progress_estimate_rejects_missing_and_malformed_start_times() -> None:
    now = dt_util.utcnow()
    assert _elapsed_seconds(None, now) is None
    assert _elapsed_seconds("not-a-timestamp", now) is None
    assert _elapsed_seconds((now - timedelta(seconds=5)).isoformat(), now) == 5
    assert _estimated_progress("not-a-timestamp", 100) is None


def test_duration_estimator_is_recent_bounded_and_outlier_resistant() -> None:
    record = {"duration_history_seconds": [90, 91, 92, 93, 94, 95, 1000, 96]}
    assert _duration_history(record) == [91, 92, 93, 94, 95, 1000, 96]
    assert _expected_duration(record) == 94
    assert _expected_duration({"duration_history_seconds": [90, 100]}) is None


async def test_verifying_state_closes_time_without_counting_suspension(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial", "away", {"name": "Away", "enabled": True, "rooms": []}
    )
    room = _room("Kitchen", "room-kitchen")
    base = dt_util.utcnow()
    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=20),
    ):
        await manager.async_mark_verifying("serial", "away", room)

    snapshot = manager.snapshot("serial")
    assert snapshot["active_plan"]["status"] == "verifying"
    assert snapshot["active_plan"]["active_elapsed_seconds"] == 20
    assert snapshot["suspended_runs"] == 0


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
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")

    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ) as wait,
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            motion_token=3,
            active_session=AsyncMock(return_value=False),
        )

    assert services.async_call.await_args.args[2] == {
        "entity_id": "vacuum.matic",
        "command": "clean_rooms",
        "params": {
            "rooms": ["room-study"],
            "cleaning_mode": "vacuum",
            "coverage": "quick",
            "ordered": False,
            "_matic_plan_run": 3,
        },
    }
    assert wait.await_count == 1
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()
    assert (
        bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_ended_unverified"
    )


async def test_room_timeout_is_failure_safe() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
    )
    sender = AsyncMock(side_effect=MaticError("synthetic cleanup failure"))
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
            motion_token=7,
            managed_user_command=sender,
        )
    sender.assert_awaited_once_with(7, UserCommand.STOP)
    manager.async_mark_failed.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_failed"


async def test_room_recharge_waits_for_resume_before_unverified_handoff() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(side_effect=["cleaning", "cleaning"]),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(
                side_effect=[
                    RoomRunOutcome.SUSPENDED,
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                ]
            ),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            active_session=AsyncMock(return_value=False),
        )

    manager.async_mark_suspended.assert_awaited_once_with(
        "serial", "away", _room("Kitchen", "room-kitchen"), "low_charge"
    )
    assert manager.async_mark_resumed.await_count == 2
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


async def test_active_session_clearing_at_dock_is_not_completion_credit() -> None:
    """Session disappearance permits handoff but never proves room completion."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = _room("Kitchen", "room-kitchen")
    reader = AsyncMock(side_effect=[True, False])
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            active_session=reader,
        )

    manager.async_mark_suspended.assert_not_awaited()
    manager.async_mark_verifying.assert_awaited_once_with("serial", "away", room)
    assert manager.async_mark_resumed.await_count == 1
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


async def test_new_native_completed_record_credits_only_after_manager_commit() -> None:
    """A new, overlapping, single-room native success is positive evidence."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    order: list[str] = []
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(
            side_effect=lambda *_args: order.append("manager_commit")
        ),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    now = dt_util.utcnow()
    old = CleaningSessionRecord(
        b"old-key",
        CleaningSession(
            (now - timedelta(hours=2)).isoformat(),
            (now - timedelta(hours=1)).isoformat(),
            60,
            ("Kitchen",),
            (("Kitchen", 60),),
            True,
        ),
    )
    history_reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal history_reads
        history_reads += 1
        if history_reads == 1:
            return (old,)
        ended = dt_util.utcnow()
        new = CleaningSessionRecord(
            b"new-key",
            CleaningSession(
                (ended - timedelta(seconds=5)).isoformat(),
                ended.isoformat(),
                5,
                ("Kitchen",),
                (("Kitchen", 5),),
                True,
            ),
        )
        return (old, new)

    confirm = MagicMock(side_effect=lambda *_args: order.append("tracker_confirm"))
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            active_session=AsyncMock(return_value=False),
            session_history=history,
            confirm_room_completed=confirm,
        )

    manager.async_mark_verifying.assert_awaited_once()
    manager.async_mark_completed.assert_awaited_once()
    manager.async_mark_ended_unverified.assert_not_awaited()
    assert order == ["manager_commit", "tracker_confirm"]
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_completed"


async def test_managed_plan_rejects_duplicate_room_names_before_dispatch() -> None:
    """Native history names cannot safely distinguish duplicate mapped rooms."""
    hass = SimpleNamespace()
    with pytest.raises(ServiceValidationError) as failure:
        await _async_run_room(
            hass,
            _call(hass),
            SimpleNamespace(),
            "vacuum.matic",
            "serial",
            _room("Office", "room-office-a"),
            room_name_is_unique=False,
        )
    assert failure.value.translation_key == "ambiguous_room_name"


async def test_native_completion_evidence_fails_closed_on_errors_and_ambiguity() -> (
    None
):
    room = _room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()

    async def failing_reader() -> tuple[CleaningSessionRecord, ...]:
        raise MaticError("synthetic unavailable")

    assert await _async_session_history_baseline(failing_reader) is None
    assert (
        await _async_verify_room_completion(failing_reader, frozenset(), room, now)
        is False
    )

    def record(
        key: bytes,
        started: str | None,
        ended: str | None,
        *,
        completed: bool = True,
        room_name: str = "Kitchen",
        duration: int = 10,
    ) -> CleaningSessionRecord:
        return CleaningSessionRecord(
            key,
            CleaningSession(
                started,
                ended,
                duration,
                (room_name,),
                ((room_name, duration),),
                completed,
            ),
        )

    invalid = record(b"invalid", "bad", "also-bad")
    old = record(
        b"old",
        (now - timedelta(hours=3)).isoformat(),
        (now - timedelta(hours=2)).isoformat(),
    )
    valid_one = record(
        b"one",
        (now - timedelta(seconds=5)).isoformat(),
        now.isoformat(),
    )
    valid_two = record(
        b"two",
        (now - timedelta(seconds=4)).isoformat(),
        now.isoformat(),
    )
    reader = AsyncMock(side_effect=[(invalid, old), (valid_one, valid_two)])
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert (
            await _async_verify_room_completion(reader, frozenset(), room, now) is False
        )

    empty = AsyncMock(return_value=())
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert (
            await _async_verify_room_completion(empty, frozenset(), room, now) is False
        )
    assert empty.await_count == SESSION_HISTORY_ATTEMPTS

    cancel_event = asyncio.Event()

    async def cancel_during_retry() -> tuple[CleaningSessionRecord, ...]:
        asyncio.get_running_loop().call_soon(cancel_event.set)
        return ()

    with pytest.raises(PlanCancelledError):
        await _async_verify_room_completion(
            cancel_during_retry,
            frozenset(),
            room,
            now,
            cancel_event=cancel_event,
        )

    unset_cancel = asyncio.Event()
    with patch(
        "custom_components.matic_robot.services.SESSION_HISTORY_RETRY_SECONDS", 0
    ):
        assert not await _async_verify_room_completion(
            empty,
            frozenset(),
            room,
            now,
            cancel_event=unset_cancel,
        )

    already_cancelled = asyncio.Event()
    already_cancelled.set()
    with pytest.raises(PlanCancelledError):
        await _async_verify_room_completion(
            empty,
            frozenset(),
            room,
            now,
            cancel_event=already_cancelled,
        )

    cleaning_state = SimpleNamespace(state="cleaning")
    takeover_hass = SimpleNamespace(
        states=SimpleNamespace(get=MagicMock(return_value=cleaning_state))
    )
    with pytest.raises(RoomTakenOverError):
        await _async_verify_room_completion(
            empty,
            frozenset(),
            room,
            now,
            hass=takeover_hass,
            entity_id="vacuum.matic",
        )


async def test_active_session_can_resume_then_end_unverified() -> None:
    """A returning firmware session may resume before an unverified handoff."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    live_state = SimpleNamespace(state="cleaning")
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=live_state)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = _room("Kitchen", "room-kitchen")
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(
                side_effect=[
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                ]
            ),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            active_session=AsyncMock(side_effect=[True, False]),
        )

    manager.async_mark_suspended.assert_not_awaited()
    assert manager.async_mark_verifying.await_count == 2
    assert manager.async_mark_resumed.await_count == 2
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


@pytest.mark.parametrize("failure_stage", ["initial_unknown", "later_unknown"])
async def test_unknown_active_session_interrupts_without_room_credit(
    failure_stage,
) -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    reader = (
        AsyncMock(return_value=None)
        if failure_stage == "initial_unknown"
        else AsyncMock(side_effect=[True, None, None, None])
    )
    sender = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
        patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()),
        pytest.raises(ServiceValidationError) as interrupted,
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            active_session=reader,
            motion_token=10,
            managed_user_command=sender,
        )

    assert interrupted.value.translation_key == "room_interrupted"
    sender.assert_awaited_once_with(10, UserCommand.STOP)
    manager.async_mark_completed.assert_not_awaited()


async def test_room_starting_paused_is_suspended_until_resume() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    wait = AsyncMock(side_effect=["paused", "cleaning"])
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            wait,
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            active_session=AsyncMock(return_value=False),
        )

    manager.async_mark_suspended.assert_awaited_once()
    assert wait.await_count == 2
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


@pytest.mark.parametrize(
    ("outcomes", "expected_reason", "translation_key"),
    [
        (
            [RoomRunOutcome.PAUSED, RoomRunOutcome.HANDOFF_CANDIDATE],
            "paused",
            None,
        ),
        ([RoomRunOutcome.TAKEN_OVER], None, "room_taken_over"),
    ],
)
async def test_room_pause_and_takeover_outcomes(
    outcomes, expected_reason, translation_key
) -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = _room("Kitchen", "room-kitchen")
    wait = AsyncMock(return_value="cleaning")
    run = _async_run_room(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        room,
        active_session=AsyncMock(return_value=False),
    )
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            wait,
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(side_effect=outcomes),
        ),
    ):
        if translation_key is None:
            await run
        else:
            with pytest.raises(ServiceValidationError) as failure:
                await run
            assert failure.value.translation_key == translation_key

    if expected_reason is not None:
        manager.async_mark_suspended.assert_awaited_once_with(
            "serial", "away", room, expected_reason
        )
        manager.async_mark_ended_unverified.assert_awaited_once()
        manager.async_mark_completed.assert_not_awaited()
    else:
        manager.async_mark_interrupted.assert_awaited_once()
        manager.async_mark_completed.assert_not_awaited()


async def test_room_interruption_and_replaced_dispatch_never_complete() -> None:
    room = _room("Kitchen", "room-kitchen")
    for interrupted in (True, False):
        services = SimpleNamespace(async_call=AsyncMock())
        bus = SimpleNamespace(async_fire=MagicMock())
        hass = SimpleNamespace(services=services, bus=bus)
        manager = SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_interrupted=AsyncMock(),
            async_mark_cancelled=AsyncMock(),
            async_mark_resumed=AsyncMock(),
            cancellation_reason=MagicMock(return_value=None),
        )
        if interrupted:
            outcome = AsyncMock(return_value=RoomRunOutcome.INTERRUPTED)
            state = AsyncMock(return_value="cleaning")
        else:
            services.async_call.side_effect = ManagedMotionReplacedError("replaced")
            outcome = AsyncMock()
            state = AsyncMock()
        sender = AsyncMock()
        with (
            patch(
                "custom_components.matic_robot.services._async_wait_for_room_outcome",
                outcome,
            ),
            patch(
                "custom_components.matic_robot.services._async_wait_for_vacuum_state",
                state,
            ),
            pytest.raises(
                ServiceValidationError if interrupted else PlanCancelledError
            ),
        ):
            await _async_run_room(
                hass,
                _call(hass),
                manager,
                "vacuum.matic",
                "serial",
                room,
                motion_token=4,
                managed_user_command=sender,
            )
        manager.async_mark_completed.assert_not_awaited()
        if interrupted:
            manager.async_mark_interrupted.assert_awaited_once()
            assert (
                bus.async_fire.call_args_list[-1].args[0].endswith("room_interrupted")
            )
        else:
            manager.async_mark_cancelled.assert_awaited_once()
            sender.assert_not_awaited()


async def test_unload_cancellation_stops_and_persists_interruption() -> None:
    """Config-entry unload stops accepted motion and never credits the room."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_cancelled=AsyncMock(),
        async_mark_resumed=AsyncMock(),
        cancellation_reason=MagicMock(return_value="config_entry_unload"),
    )
    sender = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            motion_token=8,
            managed_user_command=sender,
        )

    sender.assert_awaited_once_with(8, UserCommand.STOP)
    manager.async_mark_interrupted.assert_awaited_once()
    manager.async_mark_cancelled.assert_not_awaited()
    manager.async_mark_completed.assert_not_awaited()


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


async def test_room_outcome_requires_target_evidence_and_classifies_recharge(
    hass,
) -> None:
    room = _room("Study", "room-study")
    hass.states.async_set("vacuum.matic", "returning", {"low_charge": False})
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.INTERRUPTED
    )

    hass.states.async_set(
        "vacuum.matic",
        "returning",
        {"current_area": "Study", "low_charge": True},
    )
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.SUSPENDED
    )

    hass.states.async_set("vacuum.matic", "paused", {"current_area": "Study"})
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.PAUSED
    )

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": None})
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.matic", "idle")
    assert await waiting is RoomRunOutcome.INTERRUPTED

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "room-study"})
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room)
    )
    await asyncio.sleep(0)
    hass.states.async_set(
        "vacuum.matic",
        "returning",
        {"previous_area": "Study", "low_charge": False},
    )
    hass.states.async_set("vacuum.matic", "docked")
    assert await waiting is RoomRunOutcome.HANDOFF_CANDIDATE


async def test_room_outcome_propagates_errors_and_cancellation(hass) -> None:
    room = _room("Study", "room-study")
    hass.states.async_set("vacuum.matic", "error")
    with pytest.raises(ServiceValidationError, match="reported an error"):
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room, cancel)
    )
    await asyncio.sleep(0)
    cancel.set()
    with pytest.raises(PlanCancelledError):
        await waiting

    cancel.clear()
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room, cancel)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.matic", "returning", {"low_charge": False})
    assert await waiting is RoomRunOutcome.HANDOFF_CANDIDATE

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
    stopped = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.matic", "idle", {"current_area": "Study"})
    assert await stopped is RoomRunOutcome.INTERRUPTED


async def test_room_outcome_detects_external_takeover_but_ignores_transit(hass) -> None:
    room = _room("Study", "room-study")
    rooms = {"room-study": "Study", "room-kitchen": "Kitchen"}
    hass.states.async_set(
        "vacuum.matic",
        "cleaning",
        {"current_area": "Study", "rooms": rooms},
    )
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room)
    )
    await asyncio.sleep(0)
    hass.states.async_set(
        "vacuum.matic",
        "cleaning",
        {"current_area": None, "rooms": rooms},
    )
    await asyncio.sleep(0)
    assert waiting.done() is False
    hass.states.async_set(
        "vacuum.matic",
        "cleaning",
        {"current_area": "Hallway transit", "rooms": rooms},
    )
    await asyncio.sleep(0)
    assert waiting.done() is False
    hass.states.async_set(
        "vacuum.matic",
        "cleaning",
        {"current_area": "Kitchen", "rooms": rooms},
    )
    assert await waiting is RoomRunOutcome.TAKEN_OVER


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
    managed_command = AsyncMock()
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
            managed_user_command=managed_command,
        )
    run.assert_awaited_once()
    managed_command.assert_awaited_once()
    assert managed_command.await_args.args[1] is UserCommand.DOCK
    service_call.assert_not_awaited()


async def test_execute_rooms_finishes_current_room_then_stops_and_docks(hass) -> None:
    """A graceful stop never dispatches the next room and always returns home."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    service_call = AsyncMock()
    managed_command = AsyncMock()
    fake_hass = SimpleNamespace(
        services=SimpleNamespace(async_call=service_call),
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        ),
    )
    call = _call(fake_hass, return_to_base=False)

    async def finish_then_stop(*_args, **_kwargs) -> None:
        manager.finish_room_event("serial").set()

    with patch(
        "custom_components.matic_robot.services._async_run_room",
        AsyncMock(side_effect=finish_then_stop),
    ) as run:
        await _async_execute_rooms(
            fake_hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "one"), _room("Study", "two")],
            intelligent=False,
            managed_user_command=managed_command,
        )

    run.assert_awaited_once()
    managed_command.assert_awaited_once()
    assert managed_command.await_args.args[1] is UserCommand.DOCK
    service_call.assert_not_awaited()


async def test_execute_rooms_rechecks_ownership_after_room_history_save(hass) -> None:
    """A replacement after room completion prevents the old plan from docking."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    managed_command = AsyncMock()
    fake_hass = SimpleNamespace(
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        )
    )

    async def replace_after_room(*_args, **_kwargs) -> None:
        manager.replace_managed_motion("serial")

    with patch(
        "custom_components.matic_robot.services._async_run_room",
        AsyncMock(side_effect=replace_after_room),
    ):
        await _async_execute_rooms(
            fake_hass,
            _call(fake_hass, return_to_base=True),
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "one")],
            intelligent=False,
            managed_user_command=managed_command,
        )

    managed_command.assert_not_awaited()
    assert manager.lock("serial").locked() is False


async def test_execute_rooms_handles_final_ownership_and_dock_failures(hass) -> None:
    room = _room("Kitchen", "one")
    fake_hass = SimpleNamespace(
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        )
    )
    call = _call(fake_hass, return_to_base=True)

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    with (
        patch("custom_components.matic_robot.services._async_run_room", AsyncMock()),
        patch.object(
            manager,
            "managed_motion_is_current",
            MagicMock(side_effect=[True, True, False]),
        ),
    ):
        await _async_execute_rooms(
            fake_hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            intelligent=False,
            managed_user_command=AsyncMock(),
        )

    for error in (
        ManagedMotionReplacedError("replaced"),
        MaticError("synthetic dock failure"),
    ):
        manager = CleaningPlanManager(hass)
        manager._store = SimpleNamespace(async_save=AsyncMock())
        sender = AsyncMock(side_effect=error)
        with patch(
            "custom_components.matic_robot.services._async_run_room", AsyncMock()
        ):
            run = _async_execute_rooms(
                fake_hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [room],
                intelligent=False,
                managed_user_command=sender,
            )
            if isinstance(error, MaticError):
                with pytest.raises(ServiceValidationError) as failure:
                    await run
                assert failure.value.translation_key == "robot_command_failed"
            else:
                await run
        sender.assert_awaited_once()


async def test_config_unload_waits_for_managed_runner(hass) -> None:
    """Entry teardown cannot close the client while its runner is still live."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    entered = asyncio.Event()

    async def wait_for_cancel(*_args, **_kwargs) -> None:
        entered.set()
        await manager.cancellation_event("serial").wait()
        raise PlanCancelledError

    fake_hass = SimpleNamespace(
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        )
    )
    with patch(
        "custom_components.matic_robot.services._async_run_room",
        AsyncMock(side_effect=wait_for_cancel),
    ):
        task = asyncio.create_task(
            _async_execute_rooms(
                fake_hass,
                _call(fake_hass),
                manager,
                "vacuum.matic",
                "serial",
                [_room("Kitchen", "one")],
                intelligent=False,
            )
        )
        await entered.wait()
        await manager.async_cancel_and_wait("serial")

    assert task.done()
    assert manager.lock("serial").locked() is False


async def test_run_task_lifecycle_edge_cases(hass) -> None:
    manager = CleaningPlanManager(hass)
    assert manager.cancellation_reason("serial") is None
    await manager.async_cancel_and_wait("serial")
    with (
        patch(
            "custom_components.matic_robot.plans.asyncio.current_task",
            return_value=None,
        ),
        pytest.raises(RuntimeError, match="no current task"),
    ):
        manager.register_run_task("serial")

    manager.register_run_task("serial")
    await manager.async_cancel_and_wait("serial")
    manager.unregister_run_task("serial")


async def test_active_session_readers_are_bounded_and_cancel_safe(hass) -> None:
    assert await _async_active_session_state(None) is None
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert (
            await _async_active_session_state(
                AsyncMock(side_effect=[None, None, False])
            )
            is False
        )

    hass.states.async_set("vacuum.matic", "cleaning")
    assert (
        await _async_wait_for_active_session_resolution(
            hass, "vacuum.matic", AsyncMock(return_value=True)
        )
        is True
    )
    hass.states.async_set("vacuum.matic", "error")
    with pytest.raises(ServiceValidationError, match="reported an error"):
        await _async_wait_for_active_session_resolution(
            hass, "vacuum.matic", AsyncMock(return_value=True)
        )

    hass.states.async_set("vacuum.matic", "returning")
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert (
            await _async_wait_for_active_session_resolution(
                hass, "vacuum.matic", AsyncMock(return_value=None)
            )
            is None
        )
    assert (
        await _async_wait_for_active_session_resolution(hass, "vacuum.matic", None)
        is None
    )

    cancelled = asyncio.Event()
    cancelled.set()
    with pytest.raises(PlanCancelledError):
        await _async_wait_for_active_session_resolution(
            hass, "vacuum.matic", AsyncMock(return_value=True), cancelled
        )

    cancelled.clear()

    async def set_cancel() -> bool:
        cancelled.set()
        return True

    with pytest.raises(PlanCancelledError):
        await _async_wait_for_active_session_resolution(
            hass, "vacuum.matic", set_cancel, cancelled
        )

    with patch(
        "custom_components.matic_robot.services.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0,
    ):
        assert (
            await _async_wait_for_active_session_resolution(
                hass,
                "vacuum.matic",
                AsyncMock(side_effect=[True, False]),
                asyncio.Event(),
            )
            is False
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
