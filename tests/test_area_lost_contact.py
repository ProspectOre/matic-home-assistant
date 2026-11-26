"""A custom-area leg whose robot stops answering ends as connection lost.

It sends no STOP and credits nothing, as a room leg does.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.managed_area import async_run_area_leg
from custom_components.matic_robot.plan_model import AreaLeg
from tests.plans.fakes import memory_manager
from tests.session_fakes import FakeRobot
from tests.wire_builders import _session_identity

AREA = AreaLeg("rug", "Rug", "vacuum", "quick", "f" * 64)


@pytest.fixture(autouse=True)
def short_waits(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ROOM_STATUS_REFRESH_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_run.RECONNECT_SECONDS", 0.2
    )


async def _run_area(
    hass, robot: FakeRobot, read
) -> tuple[ServiceValidationError, list[tuple[str, str | None]]]:
    """Run the area leg to its failure; return the error and area events."""
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial", "away", "run", 0, trigger="user", service="run_selected_plan"
    )
    events: list = []
    for outcome in ("started", "finished", "failed"):
        hass.bus.async_listen(f"matic_robot_area_{outcome}", events.append)
    sender = AsyncMock()
    call = ServiceCall(
        hass,
        "matic_robot",
        "run_selected_plan",
        {"plan_id": "away", "start_timeout": 30, "completion_timeout": 60},
    )
    with pytest.raises(ServiceValidationError) as error:
        await asyncio.wait_for(
            async_run_area_leg(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                AREA,
                robot.port(session_identity=read),
                asyncio.Event(),
                manager.control.begin_managed_motion("serial"),
                sender,
                prepared_dispatch=None,
                finish_room_event=manager.control.finish_room_event("serial"),
                floor_is_current=None,
                floor_token="a" * 64,
                expected_dispatch_identity=None,
                expected_dispatch_history=None,
                expected_dispatch_revision=None,
                on_native_identity=MagicMock(),
                run_id="run",
                checkpoint_dispatch=AsyncMock(),
                provenance="user",
                settle_history=False,
            ),
            3,
        )
    await hass.async_block_till_done()
    # Nothing is stopped and nothing is credited.
    sender.assert_not_awaited()
    area = manager.repository.robot("serial").get("area_history", {}).get("rug", {})
    assert area.get("completed_runs", 0) == 0
    return error.value, [
        (event.event_type.removeprefix("matic_robot_"), event.data.get("reason_code"))
        for event in events
    ]


async def test_an_area_whose_robot_goes_silent_after_dispatch_is_connection_lost(
    hass,
):
    robot = FakeRobot()
    identity: bytes | None = b""
    # The start readback and the start confirmation see the run's own task.
    answers_after_start = 2

    async def read() -> bytes | None:
        nonlocal answers_after_start
        if identity and answers_after_start:
            answers_after_start -= 1
            return identity
        return None if identity else b""

    async def start(command) -> None:
        nonlocal identity
        identity = _session_identity(command.session_id)
        robot.show("cleaning")

    robot.on_start = start
    error, events = await _run_area(hass, robot, read)

    assert len(robot.started) == 1
    assert error.translation_key == "room_connection_lost"
    assert events == [("area_started", None), ("area_failed", "connection_lost")]


async def test_an_area_whose_robot_never_answers_is_not_sent(hass):
    robot = FakeRobot()
    error, events = await _run_area(hass, robot, AsyncMock(return_value=None))

    assert robot.started == []
    assert error.translation_key == "room_not_sent_connection_lost"
    assert events == [("area_failed", "connection_lost")]
