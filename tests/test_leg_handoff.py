"""The next leg starts while the robot drives home, without docking first."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import CleaningSessionRecord
from custom_components.matic_robot.leg_handoff import async_dispatch_on_return
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_run import PlanCancelledError
from custom_components.matic_robot.plan_model import PLAN_SESSION_ID
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.session_fakes import robot_port
from tests.test_unreachable_room import KITCHEN, STUDY, _events, _session
from tests.wire_builders import _session_identity


@pytest.fixture(autouse=True)
def fast_polls(monkeypatch):
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

    def __init__(self, hass, *, refuse_while_returning: bool) -> None:
        self.hass = hass
        self.identity = b""
        self.records: list[CleaningSessionRecord] = []
        self.dispatch_states: list[str] = []
        self.refuse_while_returning = refuse_while_returning

    async def read_identity(self) -> bytes:
        return self.identity

    async def history(self) -> tuple[CleaningSessionRecord, ...]:
        return tuple(self.records)

    async def send_command(self, call) -> None:
        state = self.hass.states.get("vacuum.matic").state
        self.dispatch_states.append(state)
        if state == "returning" and self.refuse_while_returning:
            # The refusal lands as the robot reaches its dock.
            self.hass.states.async_set("vacuum.matic", "docked")
            raise MaticError("refused")
        self.identity = _session_identity(UUID(call.data["params"][PLAN_SESSION_ID]))
        first = len(self.dispatch_states) == 1
        area = None if first else STUDY.name
        self.hass.states.async_set("vacuum.matic", "cleaning", {"current_area": area})
        end = self._give_up() if first else self._finish_study()
        self.hass.async_create_task(end, eager_start=False)

    async def _give_up(self) -> None:
        await asyncio.sleep(0.01)
        self.records.append(
            CleaningSessionRecord(b"kitchen", _session("Kitchen", "unattempted"))
        )
        self.identity = b""
        # The robot never docks on its own here: only the next leg moves it on.
        self.hass.states.async_set("vacuum.matic", "returning")

    async def _finish_study(self) -> None:
        await asyncio.sleep(0.01)
        self.hass.states.async_set(
            "vacuum.matic", "returning", {"current_area": STUDY.name}
        )
        self.records.append(
            CleaningSessionRecord(b"study", _session("Study", "completed"))
        )
        self.identity = b""
        self.hass.states.async_set("vacuum.matic", "docked")


async def _run(hass, robot: _Robot) -> list:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["plans"]["test-plan"] = {
        "finish_current_room": True
    }
    hass.states.async_set("vacuum.matic", "docked")
    hass.services.async_register("vacuum", "send_command", robot.send_command)
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
            robot=robot_port(
                session_identity=robot.read_identity,
                active_session=AsyncMock(return_value=None),
                session_history=robot.history,
            ),
            managed_user_command=AsyncMock(),
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


def _hass(state: str | None):
    current = None if state is None else SimpleNamespace(state=state)
    return SimpleNamespace(states=SimpleNamespace(get=lambda _entity_id: current))


@pytest.mark.parametrize(
    ("state", "identity", "reader"),
    [
        ("docked", b"", True),
        (None, b"", True),
        ("returning", b"ended-mission", True),
        ("returning", None, True),
        ("returning", b"", False),
    ],
)
async def test_only_a_returning_robot_with_no_mission_is_sent_on(
    state, identity, reader
) -> None:
    dispatch = AsyncMock()
    assert (
        await async_dispatch_on_return(
            _hass(state),
            "vacuum.matic",
            AsyncMock(return_value=identity) if reader else None,
            dispatch,
            lambda _identity: None,
            AsyncMock(),
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
    with pytest.raises(type(error)):
        await async_dispatch_on_return(
            _hass("returning"),
            "vacuum.matic",
            AsyncMock(return_value=b""),
            dispatch,
            bound.append,
            on_refused,
        )
    assert bound == [b"ours"]
    on_refused.assert_not_awaited()
