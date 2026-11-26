"""Mixed room and custom-area plans use distinct native task handoffs."""

from __future__ import annotations

import asyncio
import traceback
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant, callback

from custom_components.matic_robot.area_binding import (
    binding_for_area,
)
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import DOCK_PAYLOAD, Phase, SimulatedRobot
from .plan_run import HISTORY, PlanRun, expect_finished
from .sim_mission import SimFloor, message, messages, read_fields

PLAN = "room-area-room"
AREA_ID = "entry-rug"
AREA_NAME = "Entry rug"


async def _poll_until(plan: PlanRun, predicate: Any) -> None:
    """Poll the real integration until a simulator or event condition holds."""
    async with asyncio.timeout(20):
        while not predicate():
            if plan.task is not None and plan.task.done():
                error = plan.task.exception()
                raise AssertionError(
                    "managed plan ended before condition: "
                    + "".join(traceback.format_exception(error))
                    + f"; finished={plan.finished}"
                )
            await plan.poll()


async def _save_area(plan: PlanRun) -> None:
    """Save the rug as a custom area bound to the robot's floor."""
    session = plan.entry.runtime_data.session
    await _poll_until(plan, lambda: session.floor.value is not None)
    floor_plan = session.floor.value
    assert floor_plan is not None
    circles = [{"x": 1.0, "y": 0.75, "radius": 0.25}]
    await plan.entry.runtime_data.cleaning_plans.catalog.async_save_area(
        session.info.serial_number,
        AREA_ID,
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": AREA_NAME,
            "circles": circles,
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": binding_for_area(floor_plan, circles),
        },
    )


def _native_modes(payload: bytes) -> list[tuple[str, str, int | None]]:
    """Read native per-room summaries independently from simulator objects."""
    summaries = messages(payload, 5)
    assert len(summaries) == 1
    result = []
    for group_number, mode in ((6, "vacuum"), (7, "mop")):
        for group in messages(summaries[0], group_number):
            for entry in messages(group, 1):
                room_ids = messages(entry, 1)
                details = messages(entry, 2)
                assert len(room_ids) == len(details) == 1
                names = messages(details[0], 3)
                assert len(names) == 1
                status = next(
                    (
                        value
                        for number, wire_type, value in read_fields(details[0])
                        if number == 5 and wire_type == 0
                    ),
                    None,
                )
                result.append((names[0].decode(), mode, status))
    return result


def _history_goals(payload: bytes) -> tuple[bytes, ...]:
    snapshot = message(payload, 2, 1, 2)
    assert snapshot is not None
    return tuple(
        goal for wrapper in messages(snapshot, 1) for goal in messages(wrapper, 2)
    )


async def test_room_area_room_plan_uses_verified_native_handoffs(
    plan: PlanRun,
    robot: SimulatedRobot,
    hass: HomeAssistant,
    floor: SimFloor,
) -> None:
    """Each requested leg gets its own session, evidence, and room or area credit."""
    session = plan.entry.runtime_data.session
    await _save_area(plan)
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id=PLAN,
        name="Kitchen, rug, Study",
        run_behavior="ordered",
        rooms=[
            {"room": "Kitchen", "cleaning_mode": "vacuum"},
            {"area": AREA_NAME},
            {"room": "Study", "cleaning_mode": "vacuum"},
        ],
    )

    manager = plan.entry.runtime_data.cleaning_plans
    serial = session.info.serial_number
    before = manager.repository.robot(serial)
    room_ids = [str(room["room_id"]) for room in before["plans"][PLAN]["rooms"]]
    room_counts_before = {
        room_id: before.get("rooms", {}).get(room_id, {}).get("completed_runs", 0)
        for room_id in room_ids
    }
    area_runs_before = (
        before.get("area_history", {}).get(AREA_ID, {}).get("completed_runs", 0)
    )
    plan_rooms_before = {
        room_id: before.get("rotations", {})
        .get(PLAN, {})
        .get("rooms", {})
        .get(room_id, {})
        .get("completed_runs", 0)
        for room_id in room_ids
    }
    plan_area_before = (
        before.get("rotations", {})
        .get(PLAN, {})
        .get("areas", {})
        .get(AREA_ID, {})
        .get("completed_runs", 0)
    )

    observed: list[tuple[str, str | None]] = []
    for name in (
        "room_started",
        "room_completed",
        "area_started",
        "area_finished",
    ):
        hass.bus.async_listen(
            f"{DOMAIN}_{name}",
            callback(
                lambda event, event_name=name: observed.append(
                    (event_name, event.data.get("room") or event.data.get("area"))
                )
            ),
        )

    await plan.start_service("run_selected_plan", plan=PLAN)
    expected = (
        ("Kitchen", floor.rooms[0].id, {(0, 1)}),
        (AREA_NAME, None, {(0, 1)}),
        ("Study", floor.rooms[1].id, {(0, 1)}),
    )
    sessions: list[bytes] = []
    native_summaries: list[list[tuple[str, str, int | None]]] = []
    for leg, (label, room_id, modes) in enumerate(expected):
        await _poll_until(
            plan,
            lambda leg=leg: (
                robot.session is not None
                and len(plan.coverage_commands()) > leg
                and robot.session.current_visit is not None
            ),
        )
        session = robot.session
        assert session is not None
        assert len(session.visits) == 1
        visit = session.visits[0]
        assert visit.room == room_id
        assert set(visit.passes) == modes
        if room_id is None:
            assert visit.custom_area
            assert visit.circles == ((1.0, 0.75, 0.25),)
            await _poll_until(
                plan,
                lambda: (
                    any(
                        name == "area_started" and event_label == AREA_NAME
                        for name, event_label in observed
                    )
                    and manager.repository.robot(serial)
                    .get("area_history", {})
                    .get(AREA_ID, {})
                    .get("last_result")
                    == "running"
                ),
            )
        else:
            assert not visit.custom_area
            await _poll_until(
                plan,
                lambda label=label: (
                    any(
                        name == "room_started" and event_label == label
                        for name, event_label in observed
                    )
                    and manager.repository.robot(serial)
                    .get("active_plan", {})
                    .get("room")
                    == label
                    and manager.repository.robot(serial)
                    .get("active_plan", {})
                    .get("status")
                    == "running"
                ),
            )
        await plan.poll()

        session_key = session.session_wire
        requested_goals = tuple(session.goals)
        assert session_key not in sessions
        sessions.append(session_key)
        history_start = len(robot._history)
        robot.finish_room()
        await plan.poll()
        robot.finish_session()
        native_record = next(
            (
                payload
                for key, payload in robot._history[history_start:]
                if key == session_key
            ),
            None,
        )
        assert native_record is not None
        assert _history_goals(native_record) == requested_goals
        summary = _native_modes(native_record)
        if room_id is not None:
            assert summary == [(label, "vacuum", 2)]
            native_summaries.append(summary)
        else:
            assert summary == []
            native_summaries.append(summary)
        await plan.poll()
        robot.arrive_at_dock()
        await plan.poll()
        assert robot.phase is Phase.DOCKED
        if room_id is not None:
            try:
                await _poll_until(
                    plan,
                    lambda label=label: any(
                        name == "room_completed" and event_label == label
                        for name, event_label in observed
                    ),
                )
            except AssertionError as err:
                raise AssertionError(
                    f"waiting for room_completed {label}; observed={observed}; "
                    f"phase={robot.phase}; commands={len(plan.coverage_commands())}; "
                    f"session={robot.session}; finished={plan.finished}"
                ) from err
        else:
            await _poll_until(
                plan,
                lambda: any(
                    name == "area_finished" and event_label == AREA_NAME
                    for name, event_label in observed
                ),
            )
        if leg < len(expected) - 1:
            # Docked between legs, the summary keeps the running run, no target.
            history = hass.states.get(HISTORY)
            assert history is not None
            summary = history.attributes["run"]
            assert (summary["outcome"], summary["target"]) == ("running", None)
            assert summary["completed_room_count"] == 1

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    assert plan.error is None
    assert len(sessions) == len(set(sessions)) == 3
    assert len(plan.coverage_commands()) == 3
    assert native_summaries == [
        [("Kitchen", "vacuum", 2)],
        [],
        [("Study", "vacuum", 2)],
    ]
    assert observed == [
        ("room_started", "Kitchen"),
        ("room_completed", "Kitchen"),
        ("area_started", AREA_NAME),
        ("area_finished", AREA_NAME),
        ("room_started", "Study"),
        ("room_completed", "Study"),
    ]

    after = manager.repository.robot(serial)
    for room_id in room_ids:
        assert (
            after["rooms"][room_id]["completed_runs"] == room_counts_before[room_id] + 1
        )
        assert (
            after["rotations"][PLAN]["rooms"][room_id]["completed_runs"]
            == plan_rooms_before[room_id] + 1
        )
    assert after["area_history"][AREA_ID]["completed_runs"] == area_runs_before + 1
    assert (
        after["rotations"][PLAN]["areas"][AREA_ID]["completed_runs"]
        == plan_area_before + 1
    )


async def test_area_end_sends_no_dock_to_a_robot_already_returning(
    plan: PlanRun,
    robot: SimulatedRobot,
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The DOCK decision reads the robot, not a state push still held back."""
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ROOM_STATUS_REFRESH_SECONDS",
        0.05,
    )
    await _save_area(plan)
    await plan.call(
        DOMAIN, "save_plan", plan_id="rug", name="Rug", rooms=[{"area": AREA_NAME}]
    )
    finished: list[str] = []
    hass.bus.async_listen(
        f"{DOMAIN}_area_finished",
        callback(lambda event: finished.append(event.data["area"])),
    )
    await plan.start_service("run_selected_plan", plan="rug")
    robot.finish_room()
    await plan.poll()
    # The robot ends the area and heads home on its own. Its state push waits
    # out the session's publish interval, held here until the run has ended.
    throttle = plan.entry.runtime_data.session._state_publish
    with patch.object(throttle, "request"):
        robot.finish_session()
        await plan.outcome()
    throttle.request()
    assert finished == [AREA_NAME]
    assert robot.phase is Phase.RETURNING
    assert DOCK_PAYLOAD not in robot.received()
