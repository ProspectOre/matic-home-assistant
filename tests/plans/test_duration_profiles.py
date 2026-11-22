"""Learned room duration profiles per cleaning setting."""

from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.plan_timing as plan_timing_module
from custom_components.matic_robot import plan_state
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.native_history import (
    reconcile_pending_native_history,
    record_native_completion,
)
from custom_components.matic_robot.plan_model import CleaningRoom, PlanStopDecision
from custom_components.matic_robot.plan_timing import compatible_duration_history
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import memory_manager, plan_room


def test_native_history_reconciliation_preserves_frozen_duration_settings() -> None:
    """Startup recovery retains settings needed by later duration estimates."""
    now = dt_util.utcnow()
    room_id = "room-kitchen"
    dispatched_at = now - timedelta(seconds=30)
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                room_id,
                "Kitchen",
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (1, 0), (1, 1), (0, 1)),
            ),
        ),
    )
    robot: dict[str, Any] = {
        "rotations": {},
        "rooms": {},
        "pending_native_reconciliation": {
            "plan_id": "away",
            "room_id": room_id,
            "room": "Kitchen",
            "dispatched_at": dispatched_at.isoformat(),
            "expires_at": (now + timedelta(minutes=5)).isoformat(),
            "cleaning_mode": "vacuum",
            "cadence_state": {
                "scope": "plan",
                "effective_cleaning_mode": "vacuum",
                "effective_coverage_setting": "quick",
            },
        },
    }
    native_record = CleaningSessionRecord(
        b"synthetic-native-session",
        CleaningSession(
            (dispatched_at - timedelta(seconds=1)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            30,
            ("Kitchen",),
            (("Kitchen", 30),),
            True,
            ("Kitchen",),
        ),
    )

    original_pending = deepcopy(robot["pending_native_reconciliation"])
    assert reconcile_pending_native_history(robot, floor_plan, [native_record])

    completed = robot["rotations"]["away"]["rooms"][room_id]
    assert completed["cleaning_mode"] == "vacuum"
    assert completed["coverage_setting"] == "quick"
    assert compatible_duration_history(
        robot,
        room_id,
        {"cleaning_mode": "vacuum", "coverage_setting": "quick"},
    ) == [30]
    profiles = deepcopy(completed["duration_profiles"])
    robot["pending_native_reconciliation"] = original_pending
    assert reconcile_pending_native_history(robot, floor_plan, [native_record])
    assert completed["duration_profiles"] == profiles
    assert completed["completed_runs"] == 1

    # Conflicting frozen metadata cannot qualify a duration under either mode;
    # the original mode evidence still owns completion admission.
    for marker_coverage, cadence_mode, cadence_coverage in (
        (None, "mop", "quick"),
        ("standard", "mop", "quick"),
        ("standard", "vacuum", "heavy_duty"),
    ):
        conflicting_marker = {
            "plan_id": "away",
            "room_id": room_id,
            "room": "Kitchen",
            "dispatched_at": dispatched_at.isoformat(),
            "expires_at": (now + timedelta(minutes=5)).isoformat(),
            "cleaning_mode": "vacuum",
            "cadence_state": {
                "scope": "plan",
                "schedule_active": True,
                "mop_every_n": 3,
                "effective_cleaning_mode": cadence_mode,
                "effective_coverage_setting": cadence_coverage,
            },
        }
        if marker_coverage is not None:
            conflicting_marker["coverage_setting"] = marker_coverage
        cadence_records = {"away": {room_id: {"progress": {"mop": 1, "coverage": 0}}}}
        conflicting_robot: dict[str, Any] = {
            "rotations": {},
            "rooms": {},
            "plans": {},
            "plan_room_cadence": deepcopy(cadence_records),
            "pending_native_reconciliation": conflicting_marker,
        }
        assert reconcile_pending_native_history(
            conflicting_robot, floor_plan, [native_record]
        )
        conflicting_completed = conflicting_robot["rotations"]["away"]["rooms"][room_id]
        assert conflicting_completed["completed_runs"] == 1
        assert "cleaning_mode" not in conflicting_completed
        assert "coverage_setting" not in conflicting_completed
        assert conflicting_robot["plan_room_cadence"] == cadence_records
        for mode in ("vacuum", "mop"):
            for coverage in ("quick", "standard", "heavy_duty"):
                assert (
                    compatible_duration_history(
                        conflicting_robot,
                        room_id,
                        {"cleaning_mode": mode, "coverage_setting": coverage},
                    )
                    == []
                )

    # A frozen cadence snapshot can recover settings from an older marker.
    legacy_marker = {
        "plan_id": "away",
        "room_id": room_id,
        "room": "Kitchen",
        "dispatched_at": dispatched_at.isoformat(),
        "expires_at": (now + timedelta(minutes=5)).isoformat(),
        "cadence_state": {
            "scope": "plan",
            "effective_cleaning_mode": "vacuum",
            "effective_coverage_setting": "quick",
        },
    }
    legacy_robot: dict[str, Any] = {
        "rotations": {},
        "rooms": {},
        "pending_native_reconciliation": legacy_marker,
    }
    assert reconcile_pending_native_history(legacy_robot, floor_plan, [native_record])
    legacy_completed = legacy_robot["rotations"]["away"]["rooms"][room_id]
    assert legacy_completed["cleaning_mode"] == "vacuum"
    assert legacy_completed["coverage_setting"] == "quick"
    assert compatible_duration_history(
        legacy_robot,
        room_id,
        {"cleaning_mode": "vacuum", "coverage_setting": "quick"},
    ) == [30]

    unknown_robot: dict[str, Any] = {
        "rotations": {},
        "rooms": {},
        "pending_native_reconciliation": {
            key: value for key, value in legacy_marker.items() if key != "cadence_state"
        },
    }
    assert reconcile_pending_native_history(unknown_robot, floor_plan, [native_record])
    unknown_completed = unknown_robot["rotations"]["away"]["rooms"][room_id]
    assert "cleaning_mode" not in unknown_completed
    assert "coverage_setting" not in unknown_completed
    assert unknown_completed["last_duration_seconds"] == 30
    assert unknown_completed["duration_profiles"] == {}
    assert "duration_history_seconds" not in unknown_completed
    assert (
        compatible_duration_history(
            unknown_robot,
            room_id,
            {"cleaning_mode": "vacuum", "coverage_setting": "quick"},
        )
        == []
    )


@pytest.mark.parametrize(
    ("previous_mode", "previous_coverage"),
    [("vacuum", "quick"), ("mop", "heavy_duty")],
    ids=["mode-changed", "coverage-changed"],
)
@pytest.mark.parametrize(
    "duration_seconds", [None, 30], ids=["no-duration", "duration"]
)
def test_native_completion_retains_separate_duration_tiers_when_settings_change(
    previous_mode: str, previous_coverage: str, duration_seconds: int | None
) -> None:
    room_id = "room-kitchen"
    robot: dict[str, Any] = {
        "rotations": {
            "away": {
                "rooms": {
                    room_id: {
                        "cleaning_mode": previous_mode,
                        "coverage_setting": previous_coverage,
                        "last_duration_seconds": 90,
                        "average_duration_seconds": 90,
                        "duration_samples": 1,
                        "duration_history_seconds": [90],
                        "last_cancelled_duration_seconds": 45,
                        "last_unverified_duration_seconds": 60,
                    }
                }
            }
        },
        "rooms": {},
    }
    room = CleaningRoom(room_id, "Kitchen", "mop", "quick")

    record_native_completion(
        robot,
        "away",
        room,
        completed_at=dt_util.utcnow().isoformat(),
        duration_seconds=duration_seconds,
        room_settings=room,
    )

    completed = robot["rotations"]["away"]["rooms"][room_id]
    assert completed["cleaning_mode"] == "mop"
    assert completed["coverage_setting"] == "quick"
    assert "last_cancelled_duration_seconds" not in completed
    assert "last_unverified_duration_seconds" not in completed
    assert compatible_duration_history(
        robot,
        room_id,
        {"cleaning_mode": "vacuum", "coverage_setting": "quick"},
    ) == ([90] if previous_mode == "vacuum" else [])
    assert compatible_duration_history(
        robot,
        room_id,
        {
            "cleaning_mode": previous_mode,
            "coverage_setting": previous_coverage,
        },
    ) == [90]
    assert compatible_duration_history(
        robot,
        room_id,
        {"cleaning_mode": "mop", "coverage_setting": "quick"},
    ) == ([duration_seconds] if duration_seconds is not None else [])
    if duration_seconds is None:
        assert "last_duration_seconds" not in completed
        assert "average_duration_seconds" not in completed
        assert "duration_samples" not in completed
        assert "duration_history_seconds" not in completed
    else:
        assert completed["duration_history_seconds"] == [duration_seconds]
        assert completed["duration_samples"] == 1


def test_native_completion_does_not_qualify_legacy_unscoped_duration_samples() -> None:
    room_id = "room-kitchen"
    robot: dict[str, Any] = {
        "rotations": {
            "away": {
                "rooms": {
                    room_id: {
                        "last_duration_seconds": 90,
                        "average_duration_seconds": 90,
                        "duration_samples": 1,
                        "duration_history_seconds": [90],
                    }
                }
            }
        },
        "rooms": {},
    }

    record_native_completion(
        robot,
        "away",
        CleaningRoom(room_id, "Kitchen", "mop", "quick"),
        completed_at=dt_util.utcnow().isoformat(),
        duration_seconds=None,
        room_settings=None,
    )

    completed = robot["rotations"]["away"]["rooms"][room_id]
    assert "cleaning_mode" not in completed
    assert "coverage_setting" not in completed
    assert "duration_history_seconds" not in completed
    assert (
        compatible_duration_history(
            robot,
            room_id,
            {"cleaning_mode": "mop", "coverage_setting": "quick"},
        )
        == []
    )


def test_native_completion_without_frozen_settings_retains_prior_qualified_tier() -> (
    None
):
    room_id = "room-kitchen"
    robot: dict[str, Any] = {
        "rotations": {
            "away": {
                "rooms": {
                    room_id: {
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "duration_samples": 1,
                        "duration_history_seconds": [90],
                    }
                }
            }
        },
        "rooms": {},
    }
    floor_room = Room(room_id, "Kitchen", "protocol-kitchen", b"kitchen", ())

    record_native_completion(
        robot,
        "away",
        floor_room,
        completed_at=dt_util.utcnow().isoformat(),
        duration_seconds=30,
        room_settings=None,
    )

    completed = robot["rotations"]["away"]["rooms"][room_id]
    assert "cleaning_mode" not in completed
    assert "coverage_setting" not in completed
    assert completed["last_duration_seconds"] == 30
    assert "duration_history_seconds" not in completed
    assert compatible_duration_history(
        robot,
        room_id,
        {"cleaning_mode": "vacuum", "coverage_setting": "quick"},
    ) == [90]


async def test_stop_policy_learns_room_duration_and_applies_threshold(hass) -> None:
    """A stop finishes only rooms at or above the plan's learned threshold."""
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
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
    room = plan_room("Kitchen", "room-kitchen")
    lock = manager.control.lock("serial")
    await lock.acquire()
    try:
        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "away", room)
        manager.repository.data["robots"]["serial"]["plans"]["away"][
            "finish_current_room"
        ] = False
        assert manager.control.request_stop("serial") == PlanStopDecision("immediate")

        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "away", room)
        plan = manager.repository.data["robots"]["serial"]["plans"]["away"]
        plan["finish_current_room"] = True
        plan["finish_current_room_threshold"] = "invalid"
        assert manager.control.request_stop("serial") == PlanStopDecision(
            "after_room", None, 50
        )
        plan["finish_current_room_threshold"] = 50

        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "away", room)
        assert manager.control.request_stop("serial") == PlanStopDecision(
            "after_room", None, 50
        )

        for duration in (100, 105, 1000):
            manager.control.prepare_run("serial")
            await manager.ledger.async_mark_started("serial", "away", room)
            active = manager.repository.data["robots"]["serial"]["active_plan"]
            active["active_elapsed_seconds"] = duration
            active["active_segment_started"] = None
            await manager.ledger.async_mark_completed("serial", "away", room)
        record = manager.history.snapshot("serial")["plan_history"]["away"]["rooms"][
            "room-kitchen"
        ]
        assert record["average_duration_seconds"] == 105
        assert record["duration_history_seconds"] == [100, 105, 1000]

        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "away", room)
        active = manager.repository.data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 40
        active["active_segment_started"] = None
        assert manager.control.request_stop("serial") == PlanStopDecision(
            "immediate", 38, 50
        )
        assert manager.control.cancellation_event("serial").is_set()

        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "away", room)
        active = manager.repository.data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 60
        active["active_segment_started"] = None
        motion_token = manager.control.begin_managed_motion("serial")
        assert manager.control.request_stop("serial") == PlanStopDecision(
            "after_room", 57, 50
        )
        assert manager.control.finish_room_event("serial").is_set()
        assert not manager.control.cancellation_event("serial").is_set()
        assert manager.control.motion_generation("serial") == motion_token

        # Replacement supersedes a graceful-stop reason while the old executor
        # still holds its lock and persisted plan snapshot.
        manager.control.mark_managed_stop("serial")
        await manager.control.async_replace_managed_motion("serial")
        assert manager.control.cancellation_reason("serial") == "motion_replaced"
        assert manager.control.request_stop("serial").behavior == "immediate"

        changed = CleaningRoom("room-kitchen", "Kitchen", "mop", "standard")
        await manager.ledger.async_mark_started("serial", "away", changed)
        changed_record = manager.history.snapshot("serial")["plan_history"]["away"][
            "rooms"
        ]["room-kitchen"]
        assert "average_duration_seconds" not in changed_record
    finally:
        lock.release()


@pytest.mark.parametrize(
    ("due_mode", "due_coverage"),
    [("vacuum_and_mop", "quick"), ("vacuum", "heavy_duty"), ("mop", "standard")],
)
async def test_duration_tiers_survive_periodic_settings_and_restart(
    hass, due_mode: str, due_coverage: str
) -> None:
    """An every-third-clean setting must learn without erasing the regular tier."""
    manager = CleaningPlanManager(hass)
    manager.repository.store.async_save = AsyncMock()
    regular = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "quick")
    due = replace(regular, cleaning_mode=due_mode, coverage_setting=due_coverage)
    for room, duration in [(regular, 100), (regular, 110), (due, 300)] * 3:
        await manager.ledger.async_mark_started("serial", "away", room)
        await manager.ledger.async_mark_completed(
            "serial", "away", room, duration_seconds=duration
        )

    def expected(current: CleaningPlanManager, room: CleaningRoom) -> int | None:
        return current.history.next_run_estimate_seconds(
            "serial", [(room.room_id, room.cleaning_mode, room.coverage_setting)]
        )

    assert expected(manager, regular) == 105
    assert expected(manager, due) == 300
    persisted = deepcopy(manager.repository.store.async_save.call_args.args[0])
    reloaded = CleaningPlanManager(hass)
    reloaded.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=persisted), async_save=AsyncMock()
    )
    await reloaded.async_load()
    await reloaded.ledger.async_mark_started("serial", "away", regular)
    assert expected(reloaded, regular) == 105
    assert expected(reloaded, due) == 300
    assert (
        reloaded.history.snapshot("serial")["last_completed_by_room"][regular.room_id][
            "duration_seconds"
        ]
        == 300
    )


@pytest.mark.parametrize("outcome", ["cancelled", "failed", "unverified"])
async def test_duration_tiers_keep_learned_stop_threshold_after_failed_override(
    hass, outcome: str
) -> None:
    """An unsuccessful one-shot override cannot erase a learned regular clean."""
    manager = CleaningPlanManager(hass)
    manager.repository.store.async_save = AsyncMock()
    await manager.catalog.async_save_plan(
        "serial", "daily", {"finish_current_room": True, "rooms": []}
    )
    regular = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "quick")
    override = replace(regular, coverage_setting="heavy_duty")
    for _ in range(3):
        await manager.ledger.async_mark_started("serial", "daily", regular)
        await manager.ledger.async_mark_completed(
            "serial", "daily", regular, duration_seconds=100
        )
    await manager.ledger.async_mark_started("serial", "daily", override)
    if outcome == "cancelled":
        await manager.ledger.async_mark_cancelled("serial", "daily", override)
    elif outcome == "failed":
        await manager.ledger.async_mark_failed(
            "serial", "daily", override, "start timeout"
        )
    else:
        await manager.ledger.async_mark_ended_unverified("serial", "daily", override)
    record = manager.history.snapshot("serial")["plan_history"]["daily"]["rooms"][
        regular.room_id
    ]
    assert set(record["duration_profiles"]) == {"vacuum:quick"}
    assert record["completed_runs"] == 3
    assert record["duration_profiles"]["vacuum:quick"]["duration_samples"] == 3

    async with manager.control.lock("serial"):
        manager.control.prepare_run("serial")
        await manager.ledger.async_begin_run(
            "serial",
            "daily",
            "regular-again",
            1,
            trigger="user",
            service="run_selected_plan",
        )
        await manager.ledger.async_mark_started(
            "serial", "daily", regular, run_id="regular-again"
        )
        await manager.ledger.async_mark_resumed("serial", "daily", regular)
        active = manager.repository.robot("serial")["active_plan"]
        active["active_elapsed_seconds"] = 25
        active["active_segment_started"] = None
        assert manager.history.current_room_timing("serial")["expected_seconds"] == 100
        assert manager.history.current_room_timing("serial")["estimated_percent"] == 25
        assert manager.control.request_stop("serial") == PlanStopDecision(
            "immediate", 25, 50
        )


def test_duration_profiles_bound_each_supported_tier_without_mixing() -> None:
    """All nine settings pairs retain their own latest seven verified samples."""
    robot: dict[str, Any] = {"rotations": {}, "rooms": {}}
    completed_at = dt_util.utcnow().isoformat()
    for index, key in enumerate(plan_timing_module.DURATION_PROFILE_KEYS, 1):
        mode, coverage = key.split(":")
        room = CleaningRoom("room", "Room", mode, coverage)
        for offset in range(10):
            record_native_completion(
                robot,
                "daily",
                room,
                completed_at=completed_at,
                duration_seconds=index * 100 + offset,
                room_settings=room,
            )
    record = robot["rotations"]["daily"]["rooms"]["room"]
    assert len(record["duration_profiles"]) == 9
    assert record["completed_runs"] == 90
    for index, key in enumerate(plan_timing_module.DURATION_PROFILE_KEYS, 1):
        mode, coverage = key.split(":")
        profile = record["duration_profiles"][key]
        assert profile["duration_samples"] == 10
        assert compatible_duration_history(
            robot, "room", {"cleaning_mode": mode, "coverage_setting": coverage}
        ) == list(range(index * 100 + 3, index * 100 + 10))


def test_duration_profile_repair_keeps_only_known_legacy_settings() -> None:
    """The load repair preserves existing evidence, never reconstructs erased tiers."""
    now = dt_util.utcnow().isoformat()
    valid = {
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
        "duration_history_seconds": [90, 100, 110],
        "duration_samples": 23,
        "last_completed": now,
        "completed_runs": 23,
    }
    unknown = {"duration_history_seconds": [1, 1, 1], "duration_samples": 3}
    average = {
        "cleaning_mode": "mop",
        "coverage_setting": "standard",
        "average_duration_seconds": 200,
        "duration_samples": 3,
    }
    records = {
        "valid": deepcopy(valid),
        "unknown": unknown,
        "average": average,
        "empty": {},
        "bad": "not-a-record",
    }
    global_history = {"valid": {"last_completed": now, "last_duration_seconds": 110}}
    robot = {
        "rotations": {
            "daily": {"rooms": records},
            "bad-rooms": {"rooms": []},
            "bad": [],
        },
        "rooms": deepcopy(global_history),
    }
    assert plan_state.parse_robot(robot)
    assert records["valid"]["duration_profiles"] == {
        "vacuum:quick": {
            "duration_history_seconds": [90, 100, 110],
            "duration_samples": 23,
            "last_completed": now,
        }
    }
    assert {
        k: v for k, v in records["valid"].items() if k != "duration_profiles"
    } == valid
    assert (
        records["average"]["duration_profiles"]["mop:standard"][
            "duration_history_seconds"
        ]
        == [200] * 3
    )
    assert records["unknown"]["duration_profiles"] == {}
    assert records["empty"] == {}
    assert robot["rooms"] == global_history
    repaired = deepcopy(robot)
    plan_state.parse_robot(robot)
    assert robot == repaired
    plan_timing_module.admit_room_settings(
        unknown, CleaningRoom("room", "Room", "vacuum", "quick")
    )
    assert unknown["duration_profiles"] == {}
    assert "duration_history_seconds" not in unknown


@pytest.mark.parametrize(
    "profiles",
    [
        None,
        [],
        {},
        {"vacuum:quick": {"average_duration_seconds": 99, "duration_samples": 3}},
        {"unsupported:quick": {"duration_history_seconds": [99] * 3}},
    ],
)
def test_authoritative_duration_profiles_never_resurrect_scalar_history(
    profiles,
) -> None:
    record = {
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
        "duration_history_seconds": [99] * 3,
        "duration_samples": 3,
        "duration_profiles": profiles,
    }
    plan_timing_module.normalize_duration_profiles(record)
    assert record["duration_profiles"] == {}
    plan_timing_module.admit_room_settings(
        record, CleaningRoom("room", "Room", "vacuum", "quick")
    )
    assert "duration_history_seconds" not in record
    assert plan_timing_module.normalize_duration_profiles(record) is False


def test_duration_profile_sanitizer_bounds_and_rejects_invalid_values() -> None:
    record = {
        "duration_profiles": {
            "vacuum:quick": {
                "duration_history_seconds": [
                    999,
                    True,
                    float("inf"),
                    float("nan"),
                    -1,
                    0.1,
                    20.5,
                    30,
                ],
                "duration_samples": True,
                "last_completed": "not-a-date",
            },
            "mop:quick": "bad",
            "unknown:unknown": {"duration_history_seconds": [20] * 3},
        }
    }
    assert plan_timing_module.normalize_duration_profiles(record)
    assert record["duration_profiles"] == {
        "vacuum:quick": {"duration_history_seconds": [20, 30], "duration_samples": 2}
    }
    assert (
        plan_timing_module.duration_profile_key(
            {"cleaning_mode": "unknown", "coverage_setting": "quick"}
        )
        is None
    )


def test_late_duration_completion_preserves_a_different_active_tier() -> None:
    now = dt_util.utcnow().isoformat()
    active = {
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
        "duration_history_seconds": [100] * 3,
        "duration_samples": 3,
        "last_completed": now,
    }
    robot: dict[str, Any] = {
        "rotations": {"daily": {"rooms": {"room": active}}},
        "rooms": {},
        "active_plan": {"plan_id": "daily", "room_id": "room"},
    }
    prior = CleaningRoom("room", "Room", "mop", "heavy_duty")
    record_native_completion(
        robot,
        "daily",
        prior,
        completed_at=now,
        duration_seconds=300,
        room_settings=prior,
    )
    assert active["cleaning_mode"] == "vacuum"
    assert active["coverage_setting"] == "quick"
    assert active["duration_history_seconds"] == [100] * 3
    assert active["duration_samples"] == 3
    assert active["duration_profiles"]["mop:heavy_duty"][
        "duration_history_seconds"
    ] == [300]
    assert robot["rooms"]["room"]["last_duration_seconds"] == 300


async def test_duration_profile_history_reset_respects_plan_scope(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store.async_save = AsyncMock()
    for plan in ("one", "two"):
        await manager.catalog.async_save_plan("serial", plan, {"rooms": []})
        for coverage, duration in (("quick", 100), ("heavy_duty", 300)):
            room = CleaningRoom("room", "Room", "vacuum", coverage)
            for _ in range(3):
                await manager.ledger.async_mark_completed(
                    "serial", plan, room, duration_seconds=duration
                )
    await manager.ledger.async_reset_history("serial", "one")
    history = manager.history.snapshot("serial")["plan_history"]
    assert "one" not in history
    assert set(history["two"]["rooms"]["room"]["duration_profiles"]) == {
        "vacuum:quick",
        "vacuum:heavy_duty",
    }
    assert (
        manager.history.next_run_estimate_seconds(
            "serial", [("room", "vacuum", "quick")]
        )
        == 100
    )
    await manager.ledger.async_reset_history("serial")
    assert manager.history.snapshot("serial")["plan_history"] == {}
    assert (
        manager.history.next_run_estimate_seconds(
            "serial", [("room", "vacuum", "quick")]
        )
        is None
    )
