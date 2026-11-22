"""The frozen views of a robot's stored active plan and last run."""

import pytest

from custom_components.matic_robot import plan_state
from custom_components.matic_robot.plan_records import (
    ActivePlan,
    LastRun,
    stored_active_plan,
    stored_last_run,
)
from tests.plans.fakes import memory_manager, plan_room


def test_target_names_the_room_before_the_area() -> None:
    both = ActivePlan.parse(
        {"plan_id": "plan", "room_id": "room", "room": "Room", "area_id": "rug"}
    )
    assert both.target == {"kind": "room", "id": "room", "name": "Room"}
    area = ActivePlan.parse({"plan_id": "plan", "area_id": "rug", "area": 3})
    assert area.target == {"kind": "area", "id": "rug", "name": None}


@pytest.mark.parametrize(
    "record",
    [
        {"plan_id": "plan"},
        {"plan_id": "plan", "room_id": None, "area_id": 3},
        {"room_id": "room"},
    ],
    ids=["no target", "malformed target", "no plan"],
)
def test_a_record_without_a_plan_and_target_is_no_active_plan(record) -> None:
    assert ActivePlan.parse(record) is None
    robot = {"active_plan": dict(record)}
    assert stored_active_plan(robot) is None


@pytest.mark.parametrize(
    ("stored", "kept"),
    [
        ({"plan_id": "plan", "room_id": None, "area_id": "rug"}, True),
        ({"plan_id": "plan", "room_id": None}, False),
        ({"plan_id": "plan", "area_id": 3}, False),
    ],
    ids=["null room, area", "null room only", "malformed area"],
)
def test_loading_keeps_exactly_the_plans_that_parse(stored, kept) -> None:
    robot = {"active_plan": dict(stored)}
    plan_state.parse_robot(robot)
    assert (robot["active_plan"] == stored) is kept
    assert (robot["active_plan"] is None) is not kept


@pytest.mark.parametrize(
    ("stored", "elapsed"),
    [(30, 30), (2.5, 2.5), (-1, 0), (float("nan"), 0), ("30", 0)],
    ids=["int", "float", "negative", "nan", "text"],
)
def test_elapsed_seconds_keep_a_valid_stored_number(stored, elapsed) -> None:
    active = ActivePlan.parse(
        {"plan_id": "plan", "room_id": "room", "active_elapsed_seconds": stored}
    )
    assert active.elapsed_seconds == elapsed


def test_active_plan_reads_its_frozen_stop_policy() -> None:
    record = {"plan_id": "plan", "room_id": "room"}
    assert ActivePlan.parse(record).stop_policy is None
    frozen = ActivePlan.parse(
        {
            **record,
            "finish_current_room": True,
            "finish_current_room_threshold": 140,
        }
    )
    assert frozen.stop_policy == (True, 100)


def test_published_forms_are_copies_of_the_stored_records() -> None:
    robot = {
        "active_plan": {"plan_id": "plan", "room_id": "room", "status": None},
        "last_run": {
            "run_id": "run",
            "plan_id": "plan",
            "held_rooms": [{"room_id": "room"}],
            "recovery_checkpoint": {"stop_intent": "after_room"},
        },
    }
    active = stored_active_plan(robot)
    run = stored_last_run(robot)
    assert active is not None and run is not None
    published = active.published()
    published["status"] = "running"
    assert robot["active_plan"]["status"] is None
    run_record = run.published()
    assert run_record == {
        "run_id": "run",
        "plan_id": "plan",
        "held_rooms": [{"room_id": "room"}],
    }
    run_record["held_rooms"].clear()
    assert robot["last_run"]["held_rooms"] == [{"room_id": "room"}]
    assert run.checkpoint == {"stop_intent": "after_room"}


def test_last_run_reads_counts_and_skipped_rooms() -> None:
    run = LastRun.parse(
        {
            "run_id": "run",
            "plan_id": "plan",
            "outcome": "running",
            "room_count": 3,
            "completed_room_count": True,
            "skipped_room_ids": ["room", 4],
            "recovery_checkpoint": [],
        }
    )
    assert run.running
    assert (run.room_count, run.completed_room_count) == (3, 0)
    assert run.skipped_room_ids == frozenset({"room"})
    assert run.checkpoint is None
    bare = LastRun.parse({"run_id": "run", "plan_id": "plan"})
    assert not bare.running
    assert bare.skipped_room_ids == frozenset()


def test_a_robot_without_records_has_no_views() -> None:
    robot = {"active_plan": None, "last_run": None}
    assert stored_active_plan(robot) is None
    assert stored_last_run(robot) is None


async def test_room_marks_without_an_active_plan_only_touch_the_room(hass) -> None:
    manager = memory_manager(hass)
    room = plan_room("Room", "room")
    await manager.ledger.async_mark_suspended("serial", "plan", room, "low_charge")
    await manager.ledger.async_mark_verifying("serial", "plan", room)
    robot = manager.repository.robot("serial")
    assert robot["active_plan"] is None
    assert robot["rotations"]["plan"]["rooms"]["room"]["last_result"] == "verifying"
