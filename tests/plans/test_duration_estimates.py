"""Run timing, progress and duration estimates."""

from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.plan_model import CleaningRoom, PlanStopDecision
from custom_components.matic_robot.plan_timing import (
    _compatible_duration_history,
    _duration_history,
    _estimated_progress,
    _expected_duration,
    _stored_count,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import memory_manager, plan_room


async def test_snapshot_reports_running_active_elapsed(hass) -> None:
    """Read-only snapshots include the currently open cleaning segment."""
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial", "away", {"name": "Away", "enabled": True, "rooms": []}
    )
    room = plan_room("Kitchen", "room-kitchen")
    base = dt_util.utcnow()

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.ledger.async_mark_started("serial", "away", room)
        await manager.ledger.async_mark_resumed("serial", "away", room)

    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=45),
    ):
        active = manager.history.snapshot("serial")["active_plan"]

    assert active["status"] == "running"
    assert active["active_elapsed_seconds"] == 45


@pytest.mark.parametrize("samples", [0, 2, 3])
async def test_current_room_timing_shares_stop_clock_and_confidence(
    hass, samples
) -> None:
    """The displayed estimate uses exactly Stop's clock, confidence and floor."""
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial",
        "away",
        {
            "name": "Away",
            "enabled": True,
            "rooms": [],
            "finish_current_room": True,
            "finish_current_room_threshold": 50,
        },
    )
    room = plan_room("Kitchen", "room-kitchen")
    base = dt_util.utcnow()
    for _ in range(samples):
        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=base - timedelta(seconds=100),
        ):
            await manager.ledger.async_mark_started("serial", "away", room)
            await manager.ledger.async_mark_resumed("serial", "away", room)
        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow", return_value=base
        ):
            await manager.ledger.async_mark_completed("serial", "away", room)

    async with manager.control.lock("serial"):
        manager.control.prepare_run("serial")
        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow", return_value=base
        ):
            await manager.ledger.async_begin_run(
                "serial",
                "away",
                "timed-run",
                1,
                trigger="user",
                service="run_selected_plan",
            )
            await manager.ledger.async_mark_started(
                "serial", "away", room, run_id="timed-run"
            )
            assert manager.history.current_room_timing("serial") is None
            await manager.ledger.async_mark_resumed("serial", "away", room)
        active_before = deepcopy(manager.repository.robot("serial")["active_plan"])
        saves = manager.repository.store.async_save.await_count
        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=base + timedelta(seconds=49.9),
        ):
            timing = manager.history.current_room_timing("serial")
            expected = 49 if samples == 3 else None
            assert timing["estimated_percent"] == expected
            assert timing["active_elapsed_seconds"] == 49
            assert timing["expected_seconds"] == (100 if samples == 3 else None)
            assert timing["baseline_samples"] == samples
            assert manager.control.request_stop("serial") == PlanStopDecision(
                "immediate" if samples == 3 else "after_room", expected, 50
            )
        assert manager.repository.store.async_save.await_count == saves
        assert manager.repository.robot("serial")["active_plan"] == active_before

        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=base + timedelta(seconds=50),
        ):
            manager.control.prepare_run("serial")
            assert manager.control.request_stop("serial") == PlanStopDecision(
                "after_room", 50 if samples == 3 else None, 50
            )
            await manager.ledger.async_mark_suspended("serial", "away", room, "paused")
        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=base + timedelta(hours=1),
        ):
            paused = manager.history.current_room_timing("serial")
            assert paused["active_elapsed_seconds"] == 50
            assert paused["estimated_percent"] == (50 if samples == 3 else None)
            await manager.ledger.async_mark_resumed("serial", "away", room)
        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=base + timedelta(hours=1, seconds=50),
        ):
            assert manager.history.current_room_timing("serial")[
                "estimated_percent"
            ] == (100 if samples == 3 else None)
            assert (
                manager.history.snapshot("serial")["last_run"]["outcome"] == "running"
            )
            assert (
                manager.history.snapshot("serial")["last_run"]["completed_room_count"]
                == 0
            )
            await manager.ledger.async_mark_verifying("serial", "away", room)
            assert manager.history.current_room_timing("serial") is None


async def test_current_room_timing_rejects_other_owners_and_settings(hass) -> None:
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    await manager.catalog.async_save_plan(
        "serial", "away", {"name": "Away", "rooms": []}
    )
    for _ in range(3):
        await manager.ledger.async_mark_started("serial", "away", room)
        manager.repository.robot("serial")["active_plan"]["active_elapsed_seconds"] = (
            100
        )
        await manager.ledger.async_mark_completed("serial", "away", room)
    await manager.ledger.async_begin_run(
        "serial", "away", "new-run", 1, trigger="user", service="run_selected_plan"
    )
    changed = CleaningRoom(room.room_id, room.name, "mop", "standard")
    await manager.ledger.async_mark_started("serial", "away", changed, run_id="new-run")
    await manager.ledger.async_mark_resumed("serial", "away", changed)
    assert manager.history.current_room_timing("serial")["expected_seconds"] is None
    robot = manager.repository.robot("serial")
    active = deepcopy(robot["active_plan"])
    for fields in (
        {"run_id": "old"},
        {"plan_id": "other"},
        {"room_id": ""},
        {"room_id": None},
        {"status": "recovering"},
        {"cleaning_started": None},
    ):
        robot["active_plan"] = {**active, **fields}
        assert manager.history.current_room_timing("serial") is None
    robot["active_plan"] = active
    robot["last_run"]["outcome"] = "unverified"
    assert manager.history.current_room_timing("serial") is None
    robot["last_run"] = None
    assert manager.history.current_room_timing("serial") is None


async def test_current_room_timing_rejects_replaced_motion_before_cleanup(hass) -> None:
    """A replacement cannot inherit the old room's clock during executor unwind."""
    manager = CleaningPlanManager(hass)
    manager.repository.store.async_save = AsyncMock()
    room = plan_room("Kitchen", "room-kitchen")
    async with manager.control.lock("serial"):
        manager.control.prepare_run("serial")
        await manager.ledger.async_begin_run(
            "serial", "daily", "old-run", 1, trigger="user", service="run_selected_plan"
        )
        await manager.ledger.async_mark_started(
            "serial", "daily", room, run_id="old-run"
        )
        await manager.ledger.async_mark_resumed("serial", "daily", room)
        robot = manager.repository.robot("serial")
        robot["rotations"]["daily"]["rooms"][room.room_id]["duration_profiles"] = {
            f"{room.cleaning_mode}:{room.coverage_setting}": {
                "duration_history_seconds": [100, 100, 100],
                "duration_samples": 3,
            }
        }
        robot["active_plan"]["active_elapsed_seconds"] = 50
        robot["active_plan"]["active_segment_started"] = None
        manager.control.mark_managed_stop("serial")
        assert manager.history.current_room_timing("serial")["estimated_percent"] == 50
        await manager.control.async_replace_managed_motion("serial")
        assert robot["active_plan"]["run_id"] == robot["last_run"]["run_id"]
        assert manager.control.cancellation_reason("serial") == "motion_replaced"
        assert manager.history.current_room_timing("serial") is None


async def test_active_duration_excludes_suspension_and_cancel_is_not_learned(
    hass,
) -> None:
    """Only active cleaning segments feed successful duration estimates."""
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial", "away", {"name": "Away", "enabled": True, "rooms": []}
    )
    room = plan_room("Kitchen", "room-kitchen")
    base = dt_util.utcnow()

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.ledger.async_mark_started("serial", "away", room)
        await manager.ledger.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=30),
    ):
        await manager.ledger.async_mark_suspended("serial", "away", room, "low_charge")
    active = manager.history.snapshot("serial")["active_plan"]
    assert active["active_elapsed_seconds"] == 30
    assert active["active_segment_started"] is None
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(hours=1),
    ):
        await manager.ledger.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(hours=1, seconds=30),
    ):
        await manager.ledger.async_mark_completed("serial", "away", room)

    record = manager.history.snapshot("serial")["plan_history"]["away"]["rooms"][
        room.room_id
    ]
    assert record["last_duration_seconds"] == 60
    assert record["duration_history_seconds"] == [60]
    assert manager.history.snapshot("serial")["last_completed_by_room"][
        room.room_id
    ] == {
        "name": "Kitchen",
        "at": (base + timedelta(hours=1, seconds=30)).isoformat(),
        "duration_seconds": 60,
        "runs": 1,
    }

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.ledger.async_mark_started("serial", "away", room)
        await manager.ledger.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=15),
    ):
        await manager.ledger.async_mark_cancelled("serial", "away", room)
    cancelled = manager.history.snapshot("serial")["plan_history"]["away"]["rooms"][
        room.room_id
    ]
    assert cancelled["last_duration_seconds"] == 60
    assert cancelled["last_cancelled_duration_seconds"] == 15
    assert cancelled["duration_history_seconds"] == [60]

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.ledger.async_mark_started("serial", "away", room)
        await manager.ledger.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=45),
    ):
        await manager.ledger.async_mark_ended_unverified("serial", "away", room)
    unverified = manager.history.snapshot("serial")
    unverified_record = unverified["plan_history"]["away"]["rooms"][room.room_id]
    assert unverified["completed_runs"] == 1
    assert unverified["unverified_runs"] == 1
    assert unverified_record["last_result"] == "ended_unverified"
    assert unverified_record["last_duration_seconds"] == 60
    assert unverified_record["last_unverified_duration_seconds"] == 45
    assert unverified_record["duration_history_seconds"] == [60]


def test_progress_estimate_rejects_missing_and_malformed_start_times() -> None:
    assert _estimated_progress("not-a-timestamp", 100) is None


def test_persisted_duration_values_fail_closed() -> None:
    assert _stored_count({"count": 3}, "count") == 3
    for value in (-1, True, 1.5, "3", None):
        assert _stored_count({"count": value}, "count") == 0
    assert _duration_history(
        {"duration_history_seconds": [True, float("inf"), float("nan"), 42]}
    ) == [42]
    assert _duration_history(
        {"duration_samples": 3, "average_duration_seconds": 90}
    ) == [90, 90, 90]
    assert (
        _duration_history({"duration_samples": 2, "average_duration_seconds": 90}) == []
    )
    for average in (True, float("inf"), float("nan"), 0, -1, "90"):
        assert (
            _duration_history(
                {"duration_samples": 3, "average_duration_seconds": average}
            )
            == []
        )

    active = {
        "active_elapsed_seconds": float("inf"),
        "active_segment_started": "2026-01-01T00:00:00",
    }
    assert _estimated_progress(active, 100) == 0


def test_duration_estimator_is_recent_bounded_and_outlier_resistant() -> None:
    record = {"duration_history_seconds": [90, 91, 92, 93, 94, 95, 1000, 96]}
    assert _duration_history(record) == [91, 92, 93, 94, 95, 1000, 96]
    assert _expected_duration(record) == 94
    assert _expected_duration({"duration_history_seconds": [90, 100]}) is None


def test_compatible_duration_history_is_room_and_settings_scoped() -> None:
    now = dt_util.utcnow()
    robot = {
        "rotations": {
            "older": {
                "rooms": {
                    "room-hall": {
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "duration_history_seconds": [90, 91, 92],
                        "last_completed": (now - timedelta(days=1)).isoformat(),
                    }
                }
            },
            "newer": {
                "rooms": {
                    "room-hall": {
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "duration_history_seconds": [93, 94, 95, 96, 97],
                        "last_completed": now.isoformat(),
                    },
                    "different-room": {
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "duration_history_seconds": [1, 1, 1],
                    },
                }
            },
            "different-settings": {
                "rooms": {
                    "room-hall": {
                        "cleaning_mode": "mop",
                        "coverage_setting": "quick",
                        "duration_history_seconds": [2, 2, 2],
                    }
                }
            },
            1: {"rooms": {}},
            "malformed": {"rooms": []},
        }
    }
    active = {"cleaning_mode": "vacuum", "coverage_setting": "quick"}
    assert _compatible_duration_history(robot, "room-hall", active) == [
        91,
        92,
        93,
        94,
        95,
        96,
        97,
    ]
    assert _compatible_duration_history(robot, "missing", active) == []
    assert _compatible_duration_history(robot, "room-hall", {}) == []
    assert _compatible_duration_history({"rotations": []}, "room-hall", active) == []


def _estimate_manager(hass, rotations: dict[str, Any]) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager.repository.data = {"robots": {"serial": {"rotations": rotations}}}
    return manager


def _history(mode: str, coverage: str, samples: list[int]) -> dict[str, Any]:
    return {
        "cleaning_mode": mode,
        "coverage_setting": coverage,
        "duration_history_seconds": samples,
    }


def test_next_run_estimate_sums_room_medians_at_their_settings(hass) -> None:
    manager = _estimate_manager(
        hass,
        {
            "daily": {
                "rooms": {
                    "room-hall": _history("vacuum", "quick", [600, 660, 720]),
                    "room-kitchen": _history("mop", "heavy_duty", [300, 900, 1200]),
                    "room-den": _history("vacuum", "standard", [100, 120, 140]),
                }
            }
        },
    )
    rooms = [
        ("room-hall", "vacuum", "quick"),
        ("room-kitchen", "mop", "heavy_duty"),
        ("room-den", "vacuum", "standard"),
    ]
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    listener = MagicMock()
    manager.repository.async_add_listener("serial", listener)

    assert manager.history.next_run_estimate_seconds("serial", rooms) == 660 + 900 + 120
    manager.repository.store.async_save.assert_not_called()
    listener.assert_not_called()


def test_next_run_estimate_counts_samples_from_every_plan(hass) -> None:
    manager = _estimate_manager(
        hass,
        {
            "daily": {"rooms": {"room-hall": _history("vacuum", "quick", [600, 620])}},
            "weekly": {"rooms": {"room-hall": _history("vacuum", "quick", [640])}},
        },
    )

    assert (
        manager.history.next_run_estimate_seconds(
            "serial", [("room-hall", "vacuum", "quick")]
        )
        == 620
    )


def test_next_run_estimate_is_unknown_when_any_room_lacks_confidence(hass) -> None:
    manager = _estimate_manager(
        hass,
        {
            "daily": {
                "rooms": {
                    "room-hall": _history("vacuum", "quick", [600, 660, 720]),
                    "room-kitchen": _history("vacuum", "quick", [300, 360]),
                    "room-den": _history("mop", "quick", [100, 120, 140]),
                }
            }
        },
    )
    hall = ("room-hall", "vacuum", "quick")

    assert manager.history.next_run_estimate_seconds("serial", [hall]) == 660
    assert (
        manager.history.next_run_estimate_seconds(
            "serial", [hall, ("room-kitchen", "vacuum", "quick")]
        )
        is None
    )
    assert (
        manager.history.next_run_estimate_seconds(
            "serial", [hall, ("room-den", "vacuum", "quick")]
        )
        is None
    )
    assert manager.history.next_run_estimate_seconds("serial", []) is None


async def test_stop_policy_reuses_compatible_history_across_plans(hass) -> None:
    manager = memory_manager(hass)
    for plan_id in ("source", "target"):
        await manager.catalog.async_save_plan(
            "serial",
            plan_id,
            {
                "name": plan_id.title(),
                "enabled": True,
                "finish_current_room": True,
                "finish_current_room_threshold": 50,
                "rooms": [],
            },
        )
    room = plan_room("Hallway", "room-hall")
    for duration in (90, 100, 110):
        await manager.ledger.async_mark_started("serial", "source", room)
        active = manager.repository.data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = duration
        active["active_segment_started"] = None
        await manager.ledger.async_mark_completed("serial", "source", room)

    lock = manager.control.lock("serial")
    await lock.acquire()
    try:
        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "target", room)
        active = manager.repository.data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 40
        active["active_segment_started"] = None
        assert manager.control.request_stop("serial") == PlanStopDecision(
            "immediate", 40, 50
        )

        changed = CleaningRoom("room-hall", "Hallway", "mop", "quick")
        manager.control.prepare_run("serial")
        await manager.ledger.async_mark_started("serial", "target", changed)
        assert manager.control.request_stop("serial") == PlanStopDecision(
            "after_room", None, 50
        )
    finally:
        lock.release()


async def test_verifying_state_closes_time_without_counting_suspension(hass) -> None:
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial", "away", {"name": "Away", "enabled": True, "rooms": []}
    )
    room = plan_room("Kitchen", "room-kitchen")
    base = dt_util.utcnow()
    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.ledger.async_mark_started("serial", "away", room)
        await manager.ledger.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=20),
    ):
        await manager.ledger.async_mark_verifying("serial", "away", room)

    snapshot = manager.history.snapshot("serial")
    assert snapshot["active_plan"]["status"] == "verifying"
    assert snapshot["active_plan"]["active_elapsed_seconds"] == 20
    assert snapshot["suspended_runs"] == 0
