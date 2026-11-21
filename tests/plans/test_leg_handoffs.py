"""Settled handoffs between legs."""

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.managed_dispatch import _async_dispatch_leg_command
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_observation import (
    _async_wait_for_settled_leg_handoff,
)
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RoomTakenOverError,
)
from tests.plans.fakes import (
    credit_rooms,
    heavy_room,
    memory_manager,
    plan_room,
    run_plan_call,
)
from tests.session_fakes import FakeRobot
from tests.wire_builders import _session_identity


async def test_settled_leg_handoff_waits_for_returning_robot(hass, monkeypatch) -> None:
    """A settings boundary waits for return settlement without sending STOP."""
    robot = FakeRobot()
    shown = iter(("returning", "idle"))
    refresh = AsyncMock(side_effect=lambda: robot.show(next(shown)))
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.LEG_HANDOFF_POLL_SECONDS", 0
    )

    assert await _async_wait_for_settled_leg_handoff(
        robot.port(
            refresh=refresh,
            active_session=AsyncMock(return_value=None),
            session_identity=AsyncMock(return_value=b""),
        ),
        asyncio.Event(),
        timeout_seconds=1,
    )
    assert refresh.await_count == 2


async def test_settled_leg_handoff_accepts_inactive_session_before_identity_clears(
    hass, monkeypatch
) -> None:
    """A blocked dock must not strand the next settings leg on stale identity."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.LEG_HANDOFF_POLL_SECONDS", 0
    )
    robot.show("returning")

    assert await _async_wait_for_settled_leg_handoff(
        robot.port(
            session_identity=AsyncMock(return_value=b"completed-session"),
        ),
        None,
        expected_identity=b"completed-session",
        timeout_seconds=1,
    )


async def test_settled_leg_handoff_tolerates_session_read_error(
    hass, monkeypatch
) -> None:
    """A transient session read error keeps the bounded handoff fail-closed."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.LEG_HANDOFF_POLL_SECONDS", 0
    )
    robot.show("returning")

    assert not await _async_wait_for_settled_leg_handoff(
        robot.port(
            active_session=AsyncMock(side_effect=MaticError("session unavailable")),
            session_identity=AsyncMock(return_value=b"completed-session"),
        ),
        None,
        expected_identity=b"completed-session",
        timeout_seconds=0.001,
    )


async def test_settled_leg_handoff_covers_cancel_refresh_error_and_replacement(
    hass,
) -> None:
    """Handoff fails closed for cancellation, refresh errors, and takeover."""
    robot = FakeRobot()
    robot.show("returning")
    cancelled = asyncio.Event()
    cancelled.set()
    with pytest.raises(PlanCancelledError):
        await _async_wait_for_settled_leg_handoff(
            robot.port(active_session=AsyncMock(return_value=None)),
            cancelled,
            timeout_seconds=1,
        )

    robot.show("error")
    with pytest.raises(HomeAssistantError):
        await _async_wait_for_settled_leg_handoff(
            robot.port(
                refresh=AsyncMock(side_effect=MaticError("refresh failed")),
                active_session=AsyncMock(return_value=None),
                session_identity=AsyncMock(return_value=b""),
            ),
            None,
            timeout_seconds=1,
        )
    robot.show("returning")

    with pytest.raises(RoomTakenOverError):
        await _async_wait_for_settled_leg_handoff(
            robot.port(
                active_session=AsyncMock(return_value=None),
                session_identity=AsyncMock(return_value=b"replacement"),
            ),
            None,
            expected_identity=b"original",
            timeout_seconds=1,
        )

    with pytest.raises(RoomTakenOverError):
        await _async_wait_for_settled_leg_handoff(
            robot.port(
                active_session=AsyncMock(return_value=None),
                session_identity=AsyncMock(return_value=b"replacement"),
            ),
            None,
            reject_new_identity=True,
            timeout_seconds=1,
        )


async def test_settled_leg_handoff_times_out_without_stop(hass, monkeypatch) -> None:
    """A returning robot reaches the bounded handoff timeout without STOP."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.LEG_HANDOFF_POLL_SECONDS", 0
    )
    robot.show("returning")
    assert not await _async_wait_for_settled_leg_handoff(
        robot.port(
            active_session=AsyncMock(return_value=None),
            session_identity=AsyncMock(return_value=b"active"),
        ),
        None,
        timeout_seconds=0.001,
    )


async def test_settled_leg_handoff_cancel_during_wait(hass, monkeypatch) -> None:
    """Cancellation while waiting aborts the handoff without cleanup."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.LEG_HANDOFF_POLL_SECONDS", 1
    )
    cancel_event = asyncio.Event()
    hass.loop.call_soon(cancel_event.set)
    robot.show("returning")
    with pytest.raises(PlanCancelledError):
        await _async_wait_for_settled_leg_handoff(
            robot.port(
                active_session=AsyncMock(return_value=None),
                session_identity=AsyncMock(return_value=b"active"),
            ),
            cancel_event,
            timeout_seconds=1,
        )


@pytest.mark.parametrize("with_cancel", [False, True])
async def test_settled_handoff_wakes_on_graceful_stop(
    hass, monkeypatch, with_cancel
) -> None:
    """A stop wakes the real waiter promptly even while the robot returns."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.LEG_HANDOFF_POLL_SECONDS", 60
    )
    finish = asyncio.Event()
    observed = asyncio.Event()

    async def identity():
        observed.set()
        return b"previous"

    robot.show("returning")
    waiting = asyncio.create_task(
        _async_wait_for_settled_leg_handoff(
            robot.port(
                active_session=AsyncMock(return_value=None), session_identity=identity
            ),
            asyncio.Event() if with_cancel else None,
            expected_identity=b"previous",
            finish_room_event=finish,
            timeout_seconds=720,
        )
    )
    await observed.wait()
    finish.set()
    assert await asyncio.wait_for(waiting, 1) is False


@pytest.mark.parametrize("settled", [False, True, "pre_stop", "during_wait"])
async def test_settings_handoff_does_not_dispatch_after_stop_or_timeout(
    hass, settled
) -> None:
    """A blocked or stopped boundary leaves remaining legs unattempted."""
    robot = FakeRobot()
    manager = memory_manager(hass)
    rooms = [plan_room("Kitchen", "room-kitchen"), heavy_room("Study", "room-study")]
    sender = AsyncMock()
    if settled == "pre_stop":
        save_checkpoint = manager.recovery.async_set_recovery_checkpoint

        async def save_then_stop(*args, **kwargs):
            await save_checkpoint(*args, **kwargs)
            if args[2].get("phase") == "handoff":
                manager.control.finish_room_event("serial").set()

        manager.recovery.async_set_recovery_checkpoint = save_then_stop

    async def complete_first_leg(*args, **kwargs) -> bool:
        credit_rooms(args, kwargs, args[5][:1])
        return True

    async def block_handoff(*_args, **_kwargs) -> bool:
        recovery = manager.recovery.recovery_run("serial")
        assert recovery is not None
        assert recovery["recovery_checkpoint"]["phase"] == "handoff"
        assert recovery["recovery_checkpoint"]["leg_index"] == 1
        if settled is True:
            manager.control.finish_room_event("serial").set()
        if settled == "during_wait":
            robot.show("returning")
            hass.loop.call_soon(manager.control.finish_room_event("serial").set)
            return await asyncio.wait_for(
                _async_wait_for_settled_leg_handoff(*_args, **_kwargs), 1
            )
        return settled is True

    with (
        patch(
            "custom_components.matic_robot.managed_leg._async_run_leg",
            AsyncMock(side_effect=complete_first_leg),
        ) as run,
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_settled_leg_handoff",
            AsyncMock(side_effect=block_handoff),
        ),
        patch(
            "custom_components.matic_robot.plan_model.leg_groups",
            side_effect=lambda rooms, **_: [[room] for room in rooms],
        ),
    ):
        await _async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            robot=robot.port(
                session_identity=AsyncMock(return_value=b""),
                active_session=AsyncMock(
                    return_value=False if settled is True else None
                ),
                session_history=AsyncMock(return_value=()),
            ),
            managed_user_command=sender,
            floor_is_current=lambda: True,
            floor_token="a" * 64,
        )

    assert run.await_count == 1
    sender.assert_not_awaited()
    assert manager.history.snapshot("serial")["last_run"]["completed_room_count"] == 1


@pytest.mark.parametrize(
    ("takeover_leg", "takeover"),
    [
        (0, "identity"),
        (1, "identity"),
        (2, "identity"),
        (1, "history"),
        (2, "history"),
        (1, "history_error"),
    ],
)
@pytest.mark.parametrize("multi_room", [False, True])
async def test_settings_handoff_rechecks_identity_before_dispatch(
    hass, takeover_leg, takeover, multi_room
) -> None:
    """Every settled boundary fences the real dispatcher, not its later reads."""
    robot = FakeRobot()
    manager = memory_manager(hass)
    rooms = [
        plan_room("Kitchen", "room-kitchen"),
        heavy_room("Study", "room-study"),
        plan_room("Hall", "room-hall"),
    ]
    if multi_room:
        rooms = [
            item
            for room in rooms
            for item in (
                room,
                replace(
                    room, room_id=room.room_id + "-extra", name=room.name + " Extra"
                ),
            )
        ]
    sender = AsyncMock()
    identity = AsyncMock(return_value=b"")
    history = AsyncMock(return_value=())
    sessions: list[bytes] = []

    async def accept(command) -> None:
        sessions.append(_session_identity(command.session_id))
        identity.return_value = sessions[-1]

    robot.on_start = accept
    calls = 0

    async def run_leg(*args, **kwargs) -> bool:
        nonlocal calls
        index = calls
        calls += 1
        assert args[6].session_identity is identity
        if index == 0 and takeover_leg != 0:
            assert kwargs["expected_dispatch_identity"] is None
        else:
            assert kwargs["expected_dispatch_identity"] in {b"", *sessions}
        if index == takeover_leg:
            if takeover == "identity":
                identity.return_value = b"replacement"
            elif takeover == "history":
                history.return_value = (SimpleNamespace(key=b"external-completed"),)
            else:
                history.side_effect = MaticError("history unavailable")
            return await _async_run_leg(*args, **kwargs)
        # Exercise the actual before/after-command reads for each successful
        # earlier leg, allowing its newly created native identity.
        identity.return_value = b""
        dispatch = await _async_dispatch_leg_command(
            robot.port(session_identity=identity),
            args[5],
            7,
            expected_dispatch_identity=kwargs["expected_dispatch_identity"],
            floor_token="floor",
        )
        assert dispatch.native_identity == sessions[-1]
        credit_rooms(args, kwargs, args[5])
        return True

    expected_exception = (
        HomeAssistantError if takeover == "history_error" else ServiceValidationError
    )
    expected_message = (
        "cleaning history could not be read"
        if takeover == "history_error"
        else "original native cleaning task"
    )

    with (
        patch(
            "custom_components.matic_robot.managed_leg._async_run_leg",
            AsyncMock(side_effect=run_leg),
        ) as run,
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_settled_leg_handoff",
            AsyncMock(return_value=True),
        ),
        pytest.raises(expected_exception, match=expected_message),
        # One mission per room, as a recovered 0.5 Smart Stop run has: new
        # runs have no separate native mission at these settings changes.
        patch(
            "custom_components.matic_robot.plan_model.leg_groups",
            side_effect=lambda rooms, **_: [[room] for room in rooms],
        ),
    ):
        await _async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            robot=robot.port(session_identity=identity, session_history=history),
            managed_user_command=sender,
            floor_is_current=lambda: True,
            floor_token="a" * 64,
            handoff_expected_identity=b"" if takeover_leg == 0 else None,
        )

    assert run.await_count == takeover_leg + 1
    assert len(robot.started) == takeover_leg
    sender.assert_not_awaited()
