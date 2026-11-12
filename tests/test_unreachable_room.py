"""A dispatched room the robot cannot reach is settled from native history.

The OEM app (1.183.1) titles a ``Finished`` stop reason "Area inaccessible"
when the requested room stayed unattempted. That record, and only that
record, settles the room as unreachable so the plan can continue.
"""

import asyncio
from collections.abc import Callable
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_observation import (
    NativeTaskSignal,
    _classify_native_identity,
)
from custom_components.matic_robot.native_completion import (
    match_single_room_unreachable,
)
from custom_components.matic_robot.plan_model import PLAN_SESSION_ID, CleaningRoom
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.run_history import run_ending, run_rooms
from tests.session_fakes import robot_port
from tests.wire_builders import _session_identity

KITCHEN = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
STUDY = CleaningRoom("room-study", "Study", "vacuum", "quick")
REPLACEMENT = b"synthetic-oem-session"


@pytest.fixture(autouse=True)
def fast_polls(monkeypatch):
    for name, value in (
        ("ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS", 0.001),
        ("SESSION_HISTORY_RETRY_SECONDS", 0),
    ):
        monkeypatch.setattr(
            f"custom_components.matic_robot.managed_observation.{name}", value
        )


def _session(
    room: str,
    status: str,
    *,
    stop_reason: str | None = "finished",
    mode: str = "vacuum",
    extra_rooms: tuple[str, ...] = (),
    started_offset: float = -1,
) -> CleaningSession:
    now = dt_util.utcnow()
    completed = status == "completed"
    results = (
        CleaningModeResult(room, mode, status, 300 if completed else 0),
        *(CleaningModeResult(other, mode, "completed", 300) for other in extra_rooms),
    )
    rooms = (room, *extra_rooms)
    finished = stop_reason == "finished"
    return CleaningSession(
        started_at=(now + timedelta(seconds=started_offset)).isoformat(),
        ended_at=now.isoformat(),
        duration_seconds=1,
        rooms=rooms,
        room_durations=tuple((r.room, r.duration_seconds) for r in results),
        completed=completed and finished,
        completed_rooms=(room,) if completed and finished else (),
        vacuum_completed_rooms=(room,) if completed and finished else (),
        mode_results=results,
        stop_reason=stop_reason,
        completion_kind="completed" if completed else "not_started",
    )


def test_identity_signals_are_one_rule() -> None:
    owned = b"owned"
    assert _classify_native_identity(None, owned) is NativeTaskSignal.UNKNOWN
    assert _classify_native_identity(b"", owned) is NativeTaskSignal.ENDED
    assert _classify_native_identity(owned, owned) is NativeTaskSignal.OWNED
    assert _classify_native_identity(b"other", owned) is NativeTaskSignal.REPLACED


@pytest.mark.parametrize(
    ("status", "options", "baseline", "expected"),
    [
        ("unattempted", {}, frozenset(), True),
        # The robot reached the room: not unreachable.
        ("partial", {}, frozenset(), False),
        ("completed", {}, frozenset(), False),
        # A stop by the owner or the robot is not an inaccessible area.
        ("unattempted", {"stop_reason": "user_cancelled"}, frozenset(), False),
        ("unattempted", {"stop_reason": "bot_cancelled"}, frozenset(), False),
        ("unattempted", {"stop_reason": None}, frozenset(), False),
        # Another room in the same record is not this dispatch.
        ("unattempted", {"extra_rooms": ("Hall",)}, frozenset(), False),
        # A record that existed before dispatch is not this mission.
        ("unattempted", {}, frozenset({b"new"}), False),
        # A mission queued long before its dispatch still ends inside it.
        ("unattempted", {"started_offset": -7200}, frozenset(), True),
    ],
)
def test_unreachable_match_requires_finished_unattempted_single_room(
    status, options, baseline, expected
) -> None:
    # Build the record when the test runs: collection can precede it by minutes.
    session = _session("Kitchen", status, **options)
    now = dt_util.utcnow()
    matches = match_single_room_unreachable(
        (CleaningSessionRecord(b"new", session),),
        room_name="Kitchen",
        cleaning_mode="vacuum",
        dispatched_at=now - timedelta(seconds=5),
        now=now + timedelta(seconds=1),
        baseline=baseline,
    )
    assert bool(matches) is expected


def test_unreachable_match_rejects_a_mixed_mode_that_was_reached() -> None:
    now = dt_util.utcnow()
    base = _session("Kitchen", "unattempted")
    session = replace(
        base,
        mode_results=(
            CleaningModeResult("Kitchen", "vacuum", "unattempted", 0),
            CleaningModeResult("Kitchen", "mop", "partial", 30),
        ),
    )
    assert not match_single_room_unreachable(
        (CleaningSessionRecord(b"new", session),),
        room_name="Kitchen",
        cleaning_mode="vacuum_and_mop",
        dispatched_at=now - timedelta(seconds=5),
        now=now + timedelta(seconds=1),
    )


class _Robot:
    """Synthetic robot whose first mission cannot reach its room."""

    def __init__(self, hass, first_end: Callable[[], CleaningSession] | bytes) -> None:
        self.hass = hass
        self.identity: bytes = b""
        self.records: list[CleaningSessionRecord] = []
        self.dispatches: list[dict] = []
        self.first_end = first_end

    async def read_identity(self) -> bytes | None:
        return self.identity

    async def history(self) -> tuple[CleaningSessionRecord, ...]:
        return tuple(self.records)

    async def send_command(self, call) -> None:
        self.dispatches.append(call.data)
        session_id = UUID(call.data["params"][PLAN_SESSION_ID])
        self.identity = _session_identity(session_id)
        index = len(self.dispatches)
        if index == 1:
            # The robot accepts the mission and drives, but never enters the room.
            self.hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": None}
            )
            self.hass.async_create_task(self._give_up(), eager_start=False)
        else:
            self.hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": STUDY.name}
            )
            self.hass.async_create_task(self._finish_study(), eager_start=False)

    async def _give_up(self) -> None:
        await asyncio.sleep(0.01)
        if isinstance(self.first_end, bytes):
            self.identity = self.first_end
            self.hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": KITCHEN.name}
            )
            return
        self.hass.states.async_set("vacuum.matic", "returning", {"current_area": None})
        self.records.append(CleaningSessionRecord(b"kitchen-mission", self.first_end()))
        self.identity = b""
        self.hass.states.async_set("vacuum.matic", "docked", {"current_area": None})

    async def _finish_study(self) -> None:
        await asyncio.sleep(0.01)
        self.hass.states.async_set(
            "vacuum.matic", "returning", {"current_area": STUDY.name}
        )
        self.records.append(
            CleaningSessionRecord(b"study-mission", _session("Study", "completed"))
        )
        self.identity = b""
        self.hass.states.async_set("vacuum.matic", "docked", {"current_area": None})


async def _run_plan(hass, robot: _Robot):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    # Smart Stop keeps each room in its own native mission.
    manager.repository.robot("serial")["plans"]["test-plan"] = {
        "finish_current_room": True
    }
    hass.states.async_set("vacuum.matic", "docked", {"current_area": None})
    hass.services.async_register("vacuum", "send_command", robot.send_command)
    events: list = []
    for name in (
        "room_skipped",
        "room_interrupted",
        "room_completed",
        "plan_finished",
    ):
        hass.bus.async_listen(f"matic_robot_{name}", events.append)
    call = ServiceCall(
        hass,
        "matic_robot",
        "run_selected_plan",
        {
            "plan_id": "test-plan",
            "start_timeout": 5,
            "completion_timeout": 5,
            "return_to_base": False,
        },
    )
    error: BaseException | None = None
    try:
        await asyncio.wait_for(
            _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [KITCHEN, STUDY],
                floor_token="floor",
                robot=robot_port(
                    session_identity=robot.read_identity,
                    active_session=AsyncMock(return_value=False),
                    session_history=robot.history,
                ),
                managed_user_command=AsyncMock(),
            ),
            3,
        )
    except ServiceValidationError as err:
        error = err
    await hass.async_block_till_done()
    return manager, events, error


def _events(events, name: str) -> list[dict]:
    return [event.data for event in events if event.event_type == f"matic_robot_{name}"]


async def test_unreachable_room_is_skipped_and_the_plan_moves_on(hass) -> None:
    robot = _Robot(hass, lambda: _session("Kitchen", "unattempted"))
    manager, events, error = await _run_plan(hass, robot)

    assert error is None
    assert len(robot.dispatches) == 2
    skipped = _events(events, "room_skipped")
    assert [(e["room_id"], e["reason_code"], e["cause"]) for e in skipped] == [
        ("room-kitchen", "room_unreachable", "robot")
    ]
    assert not _events(events, "room_interrupted")
    assert [e["room_id"] for e in _events(events, "room_completed")] == ["room-study"]
    (finished,) = _events(events, "plan_finished")
    assert finished["reason_code"] != "native_task_taken_over"
    assert finished["completed_room_count"] == 1

    robot_store = manager.repository.robot("serial")
    kitchen = robot_store["rotations"]["test-plan"]["rooms"]["room-kitchen"]
    assert kitchen["last_result"] == "unreachable"
    assert "last_completed" not in kitchen  # No credit: the room stays due.
    last_run = robot_store["last_run"]
    assert {
        room["name"]: room["result"] for room in run_rooms(robot_store, last_run)
    } == {
        "Kitchen": "unreachable",
        "Study": "completed",
    }


@pytest.mark.parametrize("stop_reason", ["user_cancelled", "bot_cancelled", None])
async def test_owned_mission_ending_before_start_is_not_a_takeover(
    hass, stop_reason
) -> None:
    reads = []
    robot = _Robot(
        hass, lambda: _session("Kitchen", "unattempted", stop_reason=stop_reason)
    )
    history = robot.history

    async def counted_history():
        reads.append(None)
        return await history()

    robot.history = counted_history
    manager, events, error = await _run_plan(hass, robot)
    # Baseline plus one read: a cancelled record is final. An unknown stop
    # keeps polling until the history window closes.
    if stop_reason is None:
        assert len(reads) > 2
    else:
        assert len(reads) == 2

    assert error is not None
    assert error.translation_key == "room_interrupted"
    assert len(robot.dispatches) == 1  # A real stop still ends the plan.
    (interrupted,) = _events(events, "room_interrupted")
    assert interrupted["reason_code"] == "native_task_ended"
    assert not _events(events, "room_skipped")
    (finished,) = _events(events, "plan_finished")
    assert finished["reason_code"] == "native_task_ended"
    last_run = manager.repository.robot("serial")["last_run"]
    assert run_ending(last_run) == "interrupted"


async def test_replacement_before_start_is_still_a_takeover(hass) -> None:
    robot = _Robot(hass, REPLACEMENT)
    _manager, events, error = await _run_plan(hass, robot)

    assert error is not None
    assert error.translation_key == "room_taken_over"
    assert len(robot.dispatches) == 1
    (interrupted,) = _events(events, "room_interrupted")
    assert interrupted["reason_code"] == "native_task_taken_over"
    assert not _events(events, "room_skipped")


def test_area_and_room_failures_name_an_ended_owned_task() -> None:
    from custom_components.matic_robot.managed_run import (
        NativeTaskEndedError,
        _failure_reason_code,
    )

    assert _failure_reason_code(NativeTaskEndedError()) == "native_task_ended"


def test_unreachable_match_bounds_mode_window_and_ambiguity() -> None:
    now = dt_util.utcnow()
    record = CleaningSessionRecord(b"new", _session("Kitchen", "unattempted"))
    window = {
        "room_name": "Kitchen",
        "dispatched_at": now - timedelta(seconds=5),
        "now": now + timedelta(seconds=1),
    }
    # No requested mode means no mode can prove the room unattempted.
    assert not match_single_room_unreachable((record,), cleaning_mode=None, **window)
    # A record that ended before this dispatch belongs to an earlier mission.
    assert not match_single_room_unreachable(
        (record,),
        cleaning_mode="vacuum",
        **{**window, "dispatched_at": now + timedelta(seconds=1)},
    )
    # Two candidates are ambiguous; the matcher stops at two.
    other = CleaningSessionRecord(b"other", record.session)
    assert (
        len(
            match_single_room_unreachable(
                (record, other, record), cleaning_mode="vacuum", **window
            )
        )
        == 2
    )
