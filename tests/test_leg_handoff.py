"""The next leg starts while the robot drives home, without docking first."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import CleaningSessionRecord
from custom_components.matic_robot.leg_handoff import async_dispatch_on_return
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_run import PlanCancelledError
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.robot_commands import PlanStart
from tests.session_fakes import FakeRobot, one_room_missions
from tests.test_unreachable_room import KITCHEN, STUDY, _events, _session
from tests.wire_builders import _session_identity


@pytest.fixture(autouse=True)
def fast_polls(monkeypatch):
    one_room_missions(monkeypatch)
    for name, value in (
        ("ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS", 0.001),
        ("SESSION_HISTORY_RETRY_SECONDS", 0),
        ("LEG_HANDOFF_POLL_SECONDS", 0.001),
    ):
        monkeypatch.setattr(
            f"custom_components.matic_robot.managed_observation.{name}", value
        )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_dispatch."
        "DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS",
        0.01,
    )


class _Robot:
    """Synthetic robot that cannot reach the kitchen and heads home slowly."""

    def __init__(
        self,
        hass,
        *,
        refuse_while_returning: bool,
        start_late: bool = False,
        fail_after_taking: bool = False,
    ) -> None:
        self.hass = hass
        self.fake = FakeRobot()
        self.fake.on_start = self.send_command
        self.state = "docked"
        self.identity = b""
        self.records: list[CleaningSessionRecord] = []
        self.dispatch_states: list[str] = []
        self.refuse_while_returning = refuse_while_returning
        self.start_late = start_late
        self.fail_after_taking = fail_after_taking

    async def read_identity(self) -> bytes:
        return self.identity

    async def history(self) -> tuple[CleaningSessionRecord, ...]:
        return tuple(self.records)

    def show(self, state: str, **attributes) -> None:
        self.state = state
        self.fake.show(state, **attributes)

    async def send_command(self, command: PlanStart) -> None:
        state = self.state
        self.dispatch_states.append(state)
        if state == "returning" and self.refuse_while_returning:
            if self.start_late:
                # The robot answers late, then starts the mission after all.
                self.hass.loop.call_later(
                    0.05, setattr, self, "identity", b"late-mission"
                )
            else:
                # The refusal lands as the robot reaches its dock.
                self.show("docked")
            raise MaticError("refused")
        self.identity = _session_identity(command.session_id)
        if state == "returning" and self.fail_after_taking:
            # The robot starts the room, then the settings readback fails.
            self.show("cleaning")
            raise MaticError("readback failed")
        first = len(self.dispatch_states) == 1
        area = None if first else STUDY.name
        self.show("cleaning", current_area=area)
        end = self._give_up() if first else self._finish_study()
        self.hass.async_create_task(end, eager_start=False)

    async def _give_up(self) -> None:
        await asyncio.sleep(0.01)
        self.records.append(
            CleaningSessionRecord(b"kitchen", _session("Kitchen", "unattempted"))
        )
        self.identity = b""
        # The robot never docks on its own here: only the next leg moves it on.
        self.show("returning")

    async def _finish_study(self) -> None:
        await asyncio.sleep(0.01)
        self.show("returning", current_area=STUDY.name)
        self.records.append(
            CleaningSessionRecord(b"study", _session("Study", "completed"))
        )
        self.identity = b""
        self.show("docked")


async def _run(hass, robot: _Robot, sender: AsyncMock | None = None) -> list:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["plans"]["test-plan"] = {
        "finish_current_room": True
    }
    robot.show("docked")
    events: list = []
    for name in ("room_skipped", "room_completed"):
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
                active_session=AsyncMock(return_value=None),
                session_history=robot.history,
            ),
            managed_user_command=sender or AsyncMock(),
        ),
        3,
    )
    await hass.async_block_till_done()
    return events


async def test_next_room_starts_before_the_robot_docks(hass) -> None:
    robot = _Robot(hass, refuse_while_returning=False)
    events = await _run(hass, robot)

    assert robot.dispatch_states == ["docked", "returning"]
    assert [e["reason_code"] for e in _events(events, "room_skipped")] == [
        "room_unreachable"
    ]
    assert [e["room_id"] for e in _events(events, "room_completed")] == ["room-study"]


async def test_refused_next_room_waits_for_the_dock(hass) -> None:
    robot = _Robot(hass, refuse_while_returning=True)
    events = await _run(hass, robot)

    assert robot.dispatch_states == ["docked", "returning", "docked"]
    assert [e["room_id"] for e in _events(events, "room_completed")] == ["room-study"]


def _robot(state: str | None, identity: bytes | None):
    robot = FakeRobot()
    if state is not None:
        robot.show(state)
    return robot.port(session_identity=AsyncMock(return_value=identity))


@pytest.mark.parametrize(
    ("state", "identity"),
    [
        ("docked", b""),
        (None, b""),
        ("returning", b"ended-mission"),
        ("returning", None),
    ],
)
async def test_only_a_returning_robot_with_no_mission_is_sent_on(
    state, identity
) -> None:
    dispatch = AsyncMock()
    assert (
        await async_dispatch_on_return(
            _robot(state, identity),
            dispatch,
            lambda _identity: None,
            AsyncMock(),
            AsyncMock(),
            lambda: False,
        )
        is None
    )
    dispatch.assert_not_awaited()


@pytest.mark.parametrize(
    "error", [PlanCancelledError(), HomeAssistantError("lost after the robot took it")]
)
async def test_a_taken_or_cancelled_dispatch_is_not_retried(error) -> None:
    bound: list[bytes | None] = []

    async def dispatch(on_identity):
        on_identity(b"ours")
        raise error

    on_refused = AsyncMock()
    stop_taken = AsyncMock()
    with pytest.raises(type(error)):
        await async_dispatch_on_return(
            _robot("returning", b""),
            dispatch,
            bound.append,
            on_refused,
            stop_taken,
            lambda: False,
        )
    assert bound == [b"ours"]
    on_refused.assert_not_awaited()
    if isinstance(error, PlanCancelledError):
        stop_taken.assert_not_awaited()
    else:
        stop_taken.assert_awaited_once()


async def test_a_refused_room_that_starts_late_is_never_sent_twice(hass) -> None:
    robot = _Robot(hass, refuse_while_returning=True, start_late=True)
    with pytest.raises(HomeAssistantError):
        await _run(hass, robot)

    assert robot.dispatch_states == ["docked", "returning"]


async def test_a_room_taken_then_failed_on_the_way_home_is_stopped(hass) -> None:
    robot = _Robot(hass, refuse_while_returning=False, fail_after_taking=True)
    sender = AsyncMock()
    with pytest.raises(MaticError):
        await _run(hass, robot, sender)

    assert robot.dispatch_states == ["docked", "returning"]
    assert sender.await_args_list[-1].args[1] is UserCommand.STOP


@pytest.mark.parametrize(
    ("taken", "shutting_down", "stopped"),
    [(True, False, True), (True, True, False), (False, False, False)],
)
async def test_a_cancelled_dispatch_stops_only_a_taken_room_outside_shutdown(
    taken, shutting_down, stopped
) -> None:
    async def dispatch(on_identity):
        if taken:
            on_identity(b"ours")
        raise asyncio.CancelledError

    stop_taken = AsyncMock()
    with pytest.raises(asyncio.CancelledError):
        await async_dispatch_on_return(
            _robot("returning", b""),
            dispatch,
            lambda _identity: None,
            AsyncMock(),
            stop_taken,
            lambda: shutting_down,
        )
    assert stop_taken.await_count == int(stopped)
