"""Remaining Matic 0.6 schedule, custom-area, survey and history E2E paths."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from homeassistant.core import callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.managed_observation as managed_observation_module
import custom_components.matic_robot.managed_reconciliation as managed_reconciliation
from custom_components.matic_robot import wifi_survey as wifi_survey_module
from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    binding_for_area,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.wifi_survey import survey_frame

from .hermes_sim import STOP_PAYLOAD, Phase, SimulatedRobot
from .plan_run import PlanRun, expect_finished
from .sim_mission import (
    CoverageSession,
    SimFloor,
    Visit,
    bytes_field,
    fixed32_int,
    schedule_event,
    two_room_floor,
    uuid_wire,
    wifi_status,
)


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


@pytest.fixture
def robot(floor: SimFloor) -> SimulatedRobot:
    """Start with enabled and disabled robot-native schedule rows present."""
    robot = SimulatedRobot()
    robot.set_floor(floor)
    robot.set_native_schedules(
        [
            schedule_event(
                name="Weekday kitchen",
                weekdays=(1, 2, 3, 4, 5, 6, 7),
                minute_of_day=12 * 60,
                room_ids=tuple(room.id for room in floor.rooms),
                timezone="America/Los_Angeles",
                ordered=True,
                cleaning_mode="vacuum",
            ),
            schedule_event(
                name="Mop bathroom",
                weekdays=(1, 2, 3, 4, 5, 6, 7),
                minute_of_day=13 * 60,
                room_ids=(floor.rooms[1].id,),
                timezone="America/Los_Angeles",
                cleaning_mode="mop",
            ),
            schedule_event(
                name="Full kitchen",
                weekdays=(1, 2, 3, 4, 5, 6, 7),
                minute_of_day=14 * 60,
                room_ids=(floor.rooms[0].id,),
                timezone="America/Los_Angeles",
                cleaning_mode="vacuum_and_mop",
            ),
            schedule_event(
                name="Disabled schedule",
                weekdays=(1, 2, 3, 4, 5, 6, 7),
                minute_of_day=15 * 60,
                room_ids=(floor.rooms[0].id,),
                enabled=False,
                timezone="America/Los_Angeles",
            ),
        ]
    )
    robot.set_collection("schedule_event_previews", [])
    return robot


def test_release_history_resumes_future_session_publication(
    robot: SimulatedRobot,
) -> None:
    floor = robot.floor
    assert floor is not None
    initial_count = len(robot._history)

    def finish_room(session_number: int) -> None:
        robot._start_coverage(
            CoverageSession(
                session_wire=bytes_field(2, uuid_wire(UUID(int=session_number))),
                mission_wire=fixed32_int(2, floor.mission_id),
                visits=[Visit(floor.rooms[0].id, [], [(0, 1)])],
                started_at=session_number,
            )
        )
        robot.finish_room()
        robot.finish_session()

    robot.hold_history()
    finish_room(1)
    assert len(robot._history) == initial_count
    assert len(robot._pending_history) == 1

    robot.release_history()
    assert robot.hold_history_updates is False
    assert len(robot._history) == initial_count + 1
    assert robot._pending_history == []

    finish_room(2)
    assert len(robot._history) == initial_count + 2
    assert robot._pending_history == []


@pytest.fixture(autouse=True)
def short_wifi_sample_interval(
    monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> None:
    """Let the scheduled Wi-Fi collector take one sample in its E2E case."""
    if request.node.name == "test_wifi_survey_records_only_the_signal_cell":
        monkeypatch.setattr(wifi_survey_module, "SAMPLE_INTERVAL_SECONDS", 0.1)


async def _save_area(plan: PlanRun, area_id: str, name: str) -> list[dict[str, float]]:
    """Save a bound custom area through the real per-robot metadata store."""
    coordinator = plan.entry.runtime_data.coordinator
    async with asyncio.timeout(5):
        while coordinator.data is None or coordinator.data.floor_plan is None:
            await plan.poll()
    floor_plan = coordinator.data.floor_plan
    assert floor_plan is not None
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.25}]
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": name,
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
        "map_binding": binding_for_area(floor_plan, circles),
    }
    await plan.entry.runtime_data.cleaning_plans.catalog.async_save_area(
        plan.entry.runtime_data.coordinator.data.info.serial_number, area_id, area
    )
    return circles


async def test_clean_area_sends_saved_geometry_over_hermes(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    circles = await _save_area(plan, "living-rug", "Living rug")

    await plan.call(DOMAIN, "clean_area", area="Living rug")

    assert robot.phase is Phase.CLEANING
    assert robot.session is not None
    assert len(robot.session.visits) == 1
    visit = robot.session.visits[0]
    assert visit.custom_area
    assert visit.room is None
    assert visit.circles == ((circles[0]["x"], circles[0]["y"], circles[0]["radius"]),)
    assert visit.passes
    assert set(visit.passes) == {(0, 2)}
    assert robot.entries("coverage_plan")


async def test_saved_area_plan_finishes_without_room_credit(
    plan: PlanRun,
    robot: SimulatedRobot,
    hass,
) -> None:
    await _save_area(plan, "living-rug", "Living rug")
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id="living-rug-plan",
        name="Living rug plan",
        run_behavior="ordered",
        rooms=[{"area": "Living rug"}],
    )
    area_events: list[tuple[str, dict[str, object]]] = []
    manager = plan.entry.runtime_data.cleaning_plans
    serial = plan.entry.runtime_data.coordinator.data.info.serial_number
    stored_before = manager.repository.robot(serial)
    room_history_before = deepcopy(stored_before["rooms"])
    prior_area_runs = (
        stored_before["area_history"].get("living-rug", {}).get("completed_runs", 0)
    )
    for event_name in ("area_started", "area_finished"):
        hass.bus.async_listen(
            f"{DOMAIN}_{event_name}",
            lambda event, name=event_name: area_events.append((name, dict(event.data))),
        )

    await plan.start_service("run_selected_plan", plan="living-rug-plan")
    assert robot.session is not None and robot.session.current_visit is not None
    assert robot.session.current_visit.custom_area
    serial = plan.entry.runtime_data.coordinator.data.info.serial_number
    async with asyncio.timeout(5):
        while (
            not any(name == "area_started" for name, _data in area_events)
            or manager.repository.robot(serial)["area_history"]
            .get("living-rug", {})
            .get("last_result")
            != "running"
        ):
            await plan.poll()
    robot.finish_room()
    await plan.poll()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    finished = await plan.outcome()

    assert finished["outcome"] == "completed", (
        finished.get("reason_code"),
        finished.get("terminal_activity"),
        finished.get("error"),
        finished,
    )
    expect_finished(
        finished,
        "completed",
        "all_rooms_verified",
        0,
        "docked",
        rooms=0,
    )
    assert [name for name, _data in area_events] == ["area_started", "area_finished"]
    assert len(plan.coverage_commands()) == 1

    run_id = area_events[0][1].get("run_id")
    assert isinstance(run_id, str) and run_id
    stored = manager.repository.robot(serial)
    rotation_record = stored["rotations"]["living-rug-plan"]["areas"]["living-rug"]
    global_record = stored["area_history"]["living-rug"]
    for record in (rotation_record, global_record):
        assert record["completed_runs"] == prior_area_runs + 1
        assert record["last_result"] == "completed"
        assert record["last_completed_run_id"] == run_id
        assert record["completion_basis"] == "owned_session_ended"
    assert stored["rooms"] == room_history_before


async def test_unknown_custom_area_is_refused_before_robot_command(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    with pytest.raises(ServiceValidationError) as err:
        await plan.call(DOMAIN, "clean_area", area="Not saved")

    assert err.value.translation_key == "unknown_area"
    assert robot.received() == []


async def test_native_schedule_calendar_expands_enabled_schedules_only(
    hass,
    plan: PlanRun,
    robot: SimulatedRobot,
    floor: SimFloor,
) -> None:
    await plan.poll()

    assert robot.entries("schedule_events")
    telemetry = await plan.entry.runtime_data.client.async_get_telemetry()
    assert len(telemetry.schedules) == 4
    await plan.poll()
    schedules = plan.entry.runtime_data.coordinator.data.telemetry.schedules
    assert [schedule.name for schedule in schedules] == [
        "Weekday kitchen",
        "Mop bathroom",
        "Full kitchen",
        "Disabled schedule",
    ]
    assert schedules[0].time == "12:00"
    assert schedules[0].enabled is True
    assert schedules[0].ordered is True
    assert schedules[0].room_ids == tuple(str(room.id) for room in floor.rooms)
    assert [schedule.cleaning_mode for schedule in schedules] == [
        "vacuum",
        "mop",
        "vacuum_and_mop",
        None,
    ]
    assert schedules[3].enabled is False

    start = dt_util.now()
    entity_id = er.async_get(plan.hass).async_get_entity_id(
        "calendar",
        DOMAIN,
        f"{plan.entry.runtime_data.coordinator.data.info.serial_number}_native_schedules",
    )
    assert entity_id is not None
    response = await hass.services.async_call(
        "calendar",
        "get_events",
        {
            "entity_id": entity_id,
            "start_date_time": start.isoformat(),
            "end_date_time": (start + timedelta(days=8)).isoformat(),
        },
        blocking=True,
        return_response=True,
    )
    assert response is not None
    events = response[entity_id]["events"]
    assert events
    assert {event["summary"] for event in events} == {
        "Weekday kitchen",
        "Mop bathroom",
        "Full kitchen",
    }
    by_summary = {event["summary"]: event.get("description") for event in events}
    assert by_summary["Weekday kitchen"] == (
        "Vacuum\nRooms in this order: Kitchen, Study"
    )
    assert by_summary["Mop bathroom"] == "Mop\nRooms in any order: Study"
    assert by_summary["Full kitchen"] == "Vacuum and mop\nRooms in any order: Kitchen"
    expected_hours = {
        "Weekday kitchen": 12,
        "Mop bathroom": 13,
        "Full kitchen": 14,
    }
    los_angeles = ZoneInfo("America/Los_Angeles")
    for event in events:
        occurrence = dt_util.parse_datetime(event["start"])
        assert occurrence is not None and occurrence.utcoffset() is not None
        assert (
            occurrence.astimezone(los_angeles).hour == expected_hours[event["summary"]]
        )
    calendar_state = hass.states.get(entity_id)
    assert calendar_state is not None
    upcoming = [
        event
        for event in events
        if (event_start := dt_util.parse_datetime(event["start"])) is not None
        and event_start.timestamp() > start.timestamp()
    ]
    expected_next = min(upcoming, key=lambda event: event["start"])
    assert (
        calendar_state.attributes["matic_next_run"]["name"] == expected_next["summary"]
    )


async def test_new_native_schedule_session_takes_over_a_managed_run(
    plan: PlanRun,
    robot: SimulatedRobot,
) -> None:
    await plan.poll()
    assert plan.entry.runtime_data.coordinator.data.telemetry.schedules
    await plan.start()

    robot.finish_room()
    await plan.poll()
    robot.schedule_takes_over()
    finished = await plan.outcome()

    expect_finished(finished, "unverified", "native_task_taken_over", 0, "cleaning")
    assert plan.error is not None
    # Hermes does not report whether a new native task came from an app or a
    # schedule. The regression asserts that Home Assistant leaves it running.
    assert STOP_PAYLOAD not in robot.received()


async def test_wifi_survey_records_only_the_signal_cell(
    plan: PlanRun,
    robot: SimulatedRobot,
    hass,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    survey = plan.entry.runtime_data.wifi_survey
    assert survey is not None
    floor_plan = plan.entry.runtime_data.coordinator.data.floor_plan
    assert floor_plan is not None

    # The collector only samples while the robot is off its charger.
    robot.start_cleaning("Kitchen")
    coordinator = plan.entry.runtime_data.coordinator
    async with asyncio.timeout(5):
        while coordinator.expected_floor_mission_id != floor_plan.mission_id:
            await plan.poll()
    await plan.poll()
    assert coordinator.data is not None
    assert not coordinator.data.operational.is_charging, (
        coordinator.data.operational,
        coordinator.expected_floor_mission_id,
        floor_plan.mission_id,
    )
    switch_id = er.async_get(plan.hass).async_get_entity_id(
        "switch",
        DOMAIN,
        f"{plan.entry.runtime_data.coordinator.data.info.serial_number}_wifi_survey",
    )
    assert switch_id is not None
    frame = survey_frame(floor_plan.partition_id_wire)
    client = plan.entry.runtime_data.client
    pose_reads = []
    scan_results: list[int | None] = []
    get_pose = client.async_get_pose
    scan_wifi = client.async_scan_wifi_signal

    async def record_pose(*, expected_mission_id: int):
        pose = await get_pose(expected_mission_id=expected_mission_id)
        pose_reads.append(pose)
        return pose

    async def record_scan() -> int | None:
        result = await scan_wifi()
        scan_results.append(result)
        return result

    monkeypatch.setattr(client, "async_get_pose", record_pose)
    monkeypatch.setattr(client, "async_scan_wifi_signal", record_scan)
    robot.queue_wifi_scan(wifi_status(-42, ssid="Private Test Network"))
    await plan.hass.services.async_call("switch", "turn_on", {"entity_id": switch_id})
    await plan.hass.async_block_till_done()
    assert survey.enabled
    try:
        async with asyncio.timeout(5):
            cells = survey.cells(floor_plan.mission_id, frame)
            while not cells:
                await asyncio.sleep(0.05)
                cells = survey.cells(floor_plan.mission_id, frame)
    except TimeoutError:
        pytest.fail(
            "scheduled Wi-Fi sample produced no cell: "
            f"expected_mission={coordinator.expected_floor_mission_id}, "
            f"operational={coordinator.data.operational}, poses={pose_reads!r}, "
            f"scan_results={scan_results!r}, "
            f"scan_commands={len(robot.received('wifi_scan_command'))}, "
            f"switch={hass.states.get(switch_id)!r}"
        )
    assert robot.received("wifi_scan_command")
    assert scan_results and scan_results[0] == -42
    assert len(pose_reads) >= 2
    assert pose_reads[0].observed_at is not None
    assert pose_reads[1].observed_at is not None
    assert pose_reads[1].observed_at > pose_reads[0].observed_at
    switch_entity = hass.states.get(switch_id)
    await hass.services.async_call("switch", "turn_off", {"entity_id": switch_id})
    await hass.async_block_till_done()
    assert len(cells) == 1
    assert cells[0]["dbm"] == -42
    assert cells[0]["samples"] == 1
    assert "Private Test Network" not in repr(survey._data())
    assert switch_entity is not None and switch_entity.state == "on"

    clear_id = er.async_get(hass).async_get_entity_id(
        "button",
        DOMAIN,
        f"{plan.entry.runtime_data.coordinator.data.info.serial_number}_clear_wifi_survey",
    )
    assert clear_id is not None
    await hass.services.async_call("button", "press", {"entity_id": clear_id})
    await hass.async_block_till_done()
    assert survey.cells(floor_plan.mission_id, frame) == []


async def _finish_grouped_run_with_history_held(
    plan: PlanRun,
    robot: SimulatedRobot,
    hass,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    started: list[dict[str, object]] = []
    hass.bus.async_listen(
        f"{DOMAIN}_room_started", lambda event: started.append(dict(event.data))
    )
    await plan.start()
    async with asyncio.timeout(5):
        while not any(event.get("room") == "Kitchen" for event in started):
            await plan.poll()

    robot.finish_room()
    await plan.poll()
    async with asyncio.timeout(5):
        while not any(event.get("room") == "Study" for event in started):
            await plan.poll()
    robot.finish_room()
    await plan.poll()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    return await plan.outcome(), started


async def test_late_native_history_reconciles_after_grouped_completion(
    plan: PlanRun,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
    hass,
) -> None:
    monkeypatch.setattr(
        managed_observation_module, "SESSION_HISTORY_TIMEOUT_SECONDS", 0.25
    )
    monkeypatch.setattr(managed_reconciliation, "OEM_STOP_RECONCILIATION_SECONDS", 10)
    monkeypatch.setattr(
        managed_reconciliation, "OEM_STOP_RECONCILIATION_POLL_SECONDS", 0.05
    )
    robot.hold_history_updates = True
    reconciled: list[dict[str, object]] = []
    room_reconciled = asyncio.Event()

    @callback
    def on_reconciled(event) -> None:
        reconciled.append(dict(event.data))
        room_reconciled.set()

    hass.bus.async_listen(f"{DOMAIN}_room_reconciled", on_reconciled)
    finished, started = await _finish_grouped_run_with_history_held(plan, robot, hass)
    manager = plan.entry.runtime_data.cleaning_plans
    serial = plan.entry.runtime_data.coordinator.data.info.serial_number
    pending = manager.ledger.pending_native_reconciliation(serial)
    assert pending is not None
    assert len(started) == 2
    assert pending["run_id"] == started[0]["run_id"]
    assert {room["room"] for room in pending["rooms"]} == {"Kitchen", "Study"}
    assert reconciled == []
    assert len(plan.coverage_commands()) == 1
    assert finished["outcome"] == "unverified"
    assert finished["completed_room_count"] == 0

    robot.release_history()
    async with asyncio.timeout(10):
        while len(reconciled) < 2:
            await room_reconciled.wait()
            room_reconciled.clear()

    assert {event["room"] for event in reconciled} == {"Kitchen", "Study"}
    assert {event["reason_code"] for event in reconciled} == {
        "native_reconciled_completion"
    }
    assert {event["run_id"] for event in reconciled} == {pending["run_id"]}
    assert manager.ledger.pending_native_reconciliation(serial) is None
    assert len(plan.finished) == 1
    assert plan.finished[0] == finished
    assert len(plan.coverage_commands()) == 1

    stored_rooms = manager.repository.robot(serial)["rooms"]
    for room in plan.entry.runtime_data.coordinator.data.floor_plan.rooms:
        record = stored_rooms[str(room.id)]
        assert record["completed_runs"] == 1
        assert record["last_completed_run_id"] == pending["run_id"]
    stored = manager.repository.robot(serial)
    assert stored["last_run"]["run_id"] == pending["run_id"]
    assert stored["last_run"]["outcome"] == "unverified"
    assert stored["last_run"]["completed_room_count"] == 2
    assert stored["run_history"][-1]["outcome"] == "unverified"
    assert stored["run_history"][-1]["completed_room_count"] == 2


async def test_unmatched_late_history_expires_without_credit_or_redispatch(
    plan: PlanRun,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
    hass,
) -> None:
    from uuid import uuid4

    monkeypatch.setattr(
        managed_observation_module, "SESSION_HISTORY_TIMEOUT_SECONDS", 0.25
    )
    monkeypatch.setattr(managed_reconciliation, "OEM_STOP_RECONCILIATION_SECONDS", 0.25)
    monkeypatch.setattr(
        managed_reconciliation, "OEM_STOP_RECONCILIATION_POLL_SECONDS", 0.05
    )
    robot.hold_history_updates = True
    reconciled: list[dict[str, object]] = []

    @callback
    def on_reconciled(event) -> None:
        reconciled.append(dict(event.data))

    hass.bus.async_listen(f"{DOMAIN}_room_reconciled", on_reconciled)
    finished, _started = await _finish_grouped_run_with_history_held(plan, robot, hass)
    manager = plan.entry.runtime_data.cleaning_plans
    serial = plan.entry.runtime_data.coordinator.data.info.serial_number
    pending = manager.ledger.pending_native_reconciliation(serial)
    assert pending is not None
    assert robot._pending_history
    session, record = robot._pending_history[-1]
    robot._pending_history[-1] = (uuid_wire(uuid4()), record)
    assert robot._pending_history[-1][0] != session
    robot.release_history()
    await asyncio.sleep(0.5)

    assert reconciled == []
    assert manager.ledger.pending_native_reconciliation(serial) is None
    assert finished["outcome"] == "unverified"
    assert len(plan.finished) == 1
    assert len(plan.coverage_commands()) == 1
    stored = manager.repository.robot(serial)
    assert stored["last_run"]["outcome"] == "unverified"
    assert stored["last_run"]["completed_room_count"] == 0
    assert stored["run_history"][-1]["outcome"] == "unverified"
    assert stored["run_history"][-1]["completed_room_count"] == 0
