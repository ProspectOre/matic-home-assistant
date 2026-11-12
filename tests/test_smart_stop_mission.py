"""A Smart Stop plan runs as one mission and ends it through the robot's queue."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import (
    QueueAction,
    QueueChangeError,
    UserCommand,
    requeue_coverage_goals,
)
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.leg_finish import async_end_after_current_room
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.native_completion import leg_room_results
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.robot_commands import PlanStart, RobotCommands
from tests.session_fakes import FakeRobot
from tests.test_entities import _entry
from tests.test_queue_changes import (
    CURRENT,
    FLOOR,
    LIVE,
    QUEUED,
    THIRD,
    _client,
    _goal,
    _readback,
    _sent,
)
from tests.test_unreachable_room import KITCHEN, STUDY, _events
from tests.wire_builders import _session_identity


@pytest.fixture(autouse=True)
def fast_polls(monkeypatch):
    for name, value in (
        ("ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS", 0.001),
        ("SESSION_HISTORY_RETRY_SECONDS", 0),
        ("SESSION_HISTORY_TIMEOUT_SECONDS", 0.2),
    ):
        monkeypatch.setattr(
            f"custom_components.matic_robot.managed_observation.{name}", value
        )


def test_ending_after_the_current_room_keeps_only_its_goals():
    goals = [_goal(CURRENT), _goal(QUEUED), _goal(THIRD)]

    kept = requeue_coverage_goals(
        goals,
        action=QueueAction.END_AFTER_CURRENT,
        current_region=CURRENT,
        target_region=CURRENT,
    )

    assert [goal.region_id for goal in kept] == [CURRENT]
    with pytest.raises(QueueChangeError, match="last_room"):
        requeue_coverage_goals(
            [_goal(QUEUED), _goal(CURRENT)],
            action=QueueAction.END_AFTER_CURRENT,
            current_region=CURRENT,
            target_region=CURRENT,
        )


async def test_the_client_ends_its_own_mission_after_the_current_room(monkeypatch):
    client = _client(monkeypatch, _readback(LIVE), _readback(LIVE[:4]))
    identity = await client._reads.async_get_cleaning_session_identity()

    await client.async_end_after_current_room(FLOOR, identity)

    assert [goal.round_id for goal in _sent(client)] == [
        goal.round_id for goal in LIVE[2:4]
    ]


async def test_the_client_leaves_another_mission_alone(monkeypatch):
    client = _client(monkeypatch, _readback(LIVE))

    with pytest.raises(QueueChangeError, match="no_clean_running"):
        await client.async_end_after_current_room(FLOOR, b"another mission")

    client._connection._async_send_user_payload.assert_not_awaited()


async def test_a_mission_replaced_before_sending_keeps_its_rooms(monkeypatch):
    client = _client(monkeypatch, _readback(LIVE))
    reads = client._reads.async_get_cleaning_session_identity
    ours = await reads()
    reads.side_effect = [ours, b"another mission"]

    with pytest.raises(MaticError, match="changed before"):
        await client.async_end_after_current_room(FLOOR, ours)

    client._connection._async_send_user_payload.assert_not_awaited()


async def test_robot_commands_end_the_mission_on_the_run_floor(hass):
    entry = _entry()
    entry.runtime_data.session.client.async_end_after_current_room = AsyncMock()
    commands = RobotCommands(hass, entry, "vacuum.test")
    commands.current_floor_plan = MagicMock(return_value=FLOOR)
    control = entry.runtime_data.cleaning_plans.control
    leases: list = []

    @asynccontextmanager
    async def managed_command(serial_number, token):
        leases.append((serial_number, token))
        yield

    control.managed_command = managed_command

    await commands.async_end_after_current_room(7, "floor", b"ours")

    assert leases == [(entry.runtime_data.session.info.serial_number, 7)]

    commands.current_floor_plan.assert_called_once_with("floor")
    entry.runtime_data.session.client.async_end_after_current_room.assert_awaited_once_with(
        FLOOR, b"ours"
    )


@pytest.mark.parametrize(
    ("identity", "error", "ended"),
    [
        (b"", None, False),
        (b"ours", None, True),
        (b"ours", QueueChangeError("last_room"), True),
        (b"ours", QueueChangeError("current_room_unknown"), False),
        (b"ours", MaticError("no readback"), False),
        (b"ours", HomeAssistantError("map changed"), False),
    ],
)
async def test_a_finish_request_ends_the_mission_only_when_the_robot_takes_it(
    identity, error, ended
):
    event = asyncio.Event()
    event.set()
    end = AsyncMock(side_effect=error)
    finished: list = []

    await async_end_after_current_room(
        event,
        end,
        lambda: identity,
        lambda: KITCHEN,
        finished.append,
    )

    assert finished == ([KITCHEN] if ended else [])
    if identity:
        end.assert_awaited_once_with(identity)
    else:
        end.assert_not_awaited()


def _record(key: bytes, statuses: dict[str, str]) -> CleaningSessionRecord:
    now = dt_util.utcnow()
    results = tuple(
        CleaningModeResult(room, "vacuum", status, 300 if status == "completed" else 0)
        for room, status in statuses.items()
    )
    completed = tuple(
        room for room, status in statuses.items() if status == "completed"
    )
    return CleaningSessionRecord(
        key,
        CleaningSession(
            started_at=(now - timedelta(seconds=1)).isoformat(),
            ended_at=now.isoformat(),
            duration_seconds=1,
            rooms=tuple(statuses),
            room_durations=tuple((r.room, r.duration_seconds) for r in results),
            completed=len(completed) == len(statuses),
            completed_rooms=completed,
            vacuum_completed_rooms=completed,
            mode_results=results,
            stop_reason="finished",
            completion_kind="completed",
        ),
    )


def test_a_leg_record_credits_finished_rooms_and_names_unreached_ones():
    record = _record(b"one", {"Kitchen": "unattempted", "Study": "completed"})

    evidence, unreached = leg_room_results(
        record.session, [KITCHEN, STUDY], {KITCHEN.room_id, STUDY.room_id}
    )

    assert set(evidence) == {STUDY.room_id}
    assert unreached == {KITCHEN.room_id}
    assert leg_room_results(record.session, [KITCHEN, STUDY], set()) == ({}, set())


class _Robot:
    """Synthetic robot that cleans the kitchen and then the study in one mission."""

    def __init__(
        self, hass, manager, *, queue_error=None, moves_on=False, ends=False
    ) -> None:
        self.hass = hass
        self.manager = manager
        self.fake = FakeRobot()
        self.fake.on_start = self.start
        self.identity = b""
        self.records: list[CleaningSessionRecord] = []
        self.starts: list[PlanStart] = []
        self.commands: list[UserCommand] = []
        self.ended_after: list[tuple[str, bytes]] = []
        self.queue_error = queue_error
        self.moves_on = moves_on
        # The mission ends on its own even though the queue change failed.
        self.ends = ends

    async def read_identity(self) -> bytes:
        return self.identity

    async def history(self) -> tuple[CleaningSessionRecord, ...]:
        return tuple(self.records)

    async def start(self, command: PlanStart) -> None:
        self.starts.append(command)
        self.identity = _session_identity(command.session_id)
        self.fake.show("cleaning", current_area=KITCHEN.name)
        self.hass.async_create_task(self._ask_to_stop(), eager_start=False)

    async def _ask_to_stop(self) -> None:
        await asyncio.sleep(0.02)
        self.manager.control.request_stop("serial")

    async def end_after_current_room(
        self, _motion_token: int, floor_token: str, identity: bytes
    ) -> None:
        self.ended_after.append((floor_token, identity))
        if self.moves_on or (
            self.queue_error is not None
            and not self.ends
            and getattr(self.queue_error, "reason", None) != "last_room"
        ):
            self.hass.async_create_task(self._next_room(), eager_start=False)
        else:
            self.hass.async_create_task(
                self._end({"Kitchen": "completed", "Study": "unattempted"}),
                eager_start=False,
            )
        if self.queue_error is not None:
            raise self.queue_error

    async def _next_room(self) -> None:
        await asyncio.sleep(0.01)
        self.fake.show("cleaning", current_area=STUDY.name)

    async def command(self, _token: int, command: UserCommand) -> None:
        self.commands.append(command)
        if command is UserCommand.STOP:
            self.hass.async_create_task(
                self._end({"Kitchen": "completed", "Study": "partial"}),
                eager_start=False,
            )

    async def _end(self, statuses: dict[str, str]) -> None:
        await asyncio.sleep(0.01)
        self.records.append(_record(b"mission", statuses))
        self.identity = b""
        self.fake.show("returning", current_area=None)
        await asyncio.sleep(0.01)
        self.fake.show("docked", current_area=None)


async def _run(hass, make_robot, *, smart_stop: bool = True):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial",
        "test-plan",
        {
            "name": "Smart Stop",
            "finish_current_room": smart_stop,
            "finish_current_room_threshold": 0,
            "rooms": [asdict(room) for room in (KITCHEN, STUDY)],
        },
    )
    robot = make_robot(manager)
    robot.fake.show("docked")
    events: list = []
    for name in ("room_cancelled", "room_completed", "room_skipped", "plan_finished"):
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
    error = None
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
                robot=robot.fake.port(
                    session_identity=robot.read_identity,
                    active_session=AsyncMock(return_value=False),
                    session_history=robot.history,
                    end_after_current_room=robot.end_after_current_room,
                ),
                managed_user_command=robot.command,
            ),
            3,
        )
    except ServiceValidationError as err:
        error = err
    await hass.async_block_till_done()
    return robot, events, error


@pytest.mark.parametrize(
    "queue_error",
    [
        None,
        QueueChangeError("last_room"),
        # The mission ended during the readback, so the change went unconfirmed.
        MaticError("Native mission changed during the queue change"),
    ],
)
async def test_smart_stop_ends_the_shared_mission_after_the_current_room(
    hass, queue_error
) -> None:
    robot, events, error = await _run(
        hass,
        lambda manager: _Robot(hass, manager, queue_error=queue_error, ends=True),
    )

    assert error is None
    assert len(robot.starts) == 1
    assert robot.starts[0].rooms == (KITCHEN.room_id, STUDY.room_id)
    assert robot.ended_after == [("floor", robot.ended_after[0][1])]
    assert UserCommand.STOP not in robot.commands
    assert [e["room_id"] for e in _events(events, "room_completed")] == [
        KITCHEN.room_id
    ]
    (cancelled,) = _events(events, "room_cancelled")
    assert (cancelled["room_id"], cancelled["cause"]) == (
        STUDY.room_id,
        "finish_current_room_or_stop",
    )
    assert not _events(events, "room_skipped")
    (finished,) = _events(events, "plan_finished")
    assert finished["reason_code"] == "managed_stop"


@pytest.mark.parametrize(
    ("queue_error", "moves_on"),
    [(QueueChangeError("current_room_unknown"), False), (None, True)],
)
async def test_a_robot_that_keeps_the_next_room_is_stopped_there(
    hass, queue_error, moves_on
) -> None:
    robot, _events_seen, _error = await _run(
        hass,
        lambda manager: _Robot(
            hass, manager, queue_error=queue_error, moves_on=moves_on
        ),
    )

    assert len(robot.ended_after) == 1
    assert robot.commands.count(UserCommand.STOP) == 1


class _UnreachableRobot(_Robot):
    """Synthetic robot that cannot enter the kitchen and cleans the study."""

    def __init__(self, hass, manager, *, study: bool) -> None:
        super().__init__(hass, manager)
        self.study = study

    async def start(self, command: PlanStart) -> None:
        self.starts.append(command)
        self.identity = _session_identity(command.session_id)
        self.fake.show("cleaning", current_area=None)
        self.hass.async_create_task(self._clean(), eager_start=False)

    async def _clean(self) -> None:
        await asyncio.sleep(0.02)
        if not self.study:
            await self._end({"Kitchen": "unattempted", "Study": "unattempted"})
            return
        self.fake.show("cleaning", current_area=STUDY.name)
        await self._end({"Kitchen": "unattempted", "Study": "completed"})


@pytest.mark.parametrize("study", [True, False])
async def test_an_unreachable_room_in_a_shared_mission_settles(hass, study) -> None:
    robot, events, error = await _run(
        hass,
        lambda manager: _UnreachableRobot(hass, manager, study=study),
        smart_stop=False,
    )

    assert error is None
    assert len(robot.starts) == 1
    skipped = {e["room_id"]: e["reason_code"] for e in _events(events, "room_skipped")}
    expected = {KITCHEN.room_id} | (set() if study else {STUDY.room_id})
    assert skipped == dict.fromkeys(expected, "room_unreachable")
    assert [e["room_id"] for e in _events(events, "room_completed")] == (
        [STUDY.room_id] if study else []
    )
