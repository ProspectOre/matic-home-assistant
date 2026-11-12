"""Executor-level runs driven through a RobotPort of fakes."""

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.const import DOMAIN, EVENT_PLAN_FINISHED
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_observation import _LegOutcomeObserver
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.session_fakes import FakeRobot, robot_port
from tests.wire_builders import _session_identity

from .test_plans import _call, _room
from .test_session_ownership import REPLACEMENT, ROOM


async def test_managed_run_identity_outcome_and_activity_scope(hass) -> None:
    """A managed run emits one bounded terminal record without user identity."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    events = []
    hass.bus.async_listen(EVENT_PLAN_FINISHED, events.append)
    set_run_id = MagicMock()
    confirmed = MagicMock()

    async def fake_leg(*args, **kwargs):
        args[6].confirm_room_completed(args[5][0].name)
        kwargs["record_room_completed"](args[5][0])
        return True

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg",
        AsyncMock(side_effect=fake_leg),
    ):
        await _async_execute_rooms(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            floor_token="floor",
            robot=robot_port(
                confirm_room_completed=confirmed, set_activity_run_id=set_run_id
            ),
        )

    await hass.async_block_till_done()
    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "completed"
    assert last_run["reason_code"] == "all_rooms_verified"
    assert last_run["room_count"] == 1
    assert last_run["completed_room_count"] == 1
    confirmed.assert_called_once_with("Kitchen")
    assert last_run["trigger"] == "external_unknown"
    assert last_run["provenance"] == "external_unknown"
    assert last_run["service"] == "run_selected_plan"
    assert len(events) == 1
    event = events[0].data
    assert event["run_id"] == last_run["run_id"]
    assert event["outcome"] == "completed"
    assert event["terminal_activity"] == "unknown"
    assert "room_outcomes" not in event
    assert "@" not in str(event)
    assert set_run_id.call_args_list[0].args[0] == last_run["run_id"]
    assert set_run_id.call_args_list[-1].args[0] is None
    assert (
        await manager.ledger.async_finish_run("serial", "wrong-run", "failed", "x", 9)
        is False
    )


async def test_run_finalizer_preserves_scope_for_stop_watcher(hass) -> None:
    """A registered STOP watcher owns the journal until dock confirmation ends."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    scope: dict[str, str | None] = {"run_id": None}

    def set_run_id(run_id: str | None) -> None:
        scope["run_id"] = run_id

    watcher_release = asyncio.Event()

    async def watcher() -> None:
        await watcher_release.wait()

    async def fake_leg(*_args, **_kwargs):
        manager.control.register_reconciliation_task(
            "serial",
            asyncio.create_task(watcher()),
            dock=True,
            run_id=_kwargs["run_id"],
        )
        return True

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg",
        AsyncMock(side_effect=fake_leg),
    ):
        await _async_execute_rooms(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "room-kitchen")],
            floor_token="floor",
            robot=robot_port(
                set_activity_run_id=set_run_id,
                get_activity_run_id=lambda: scope["run_id"],
            ),
        )

    assert scope["run_id"] is not None
    assert manager.control.dock_reconciliation_active("serial") is True
    watcher_release.set()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert scope["run_id"] is None


async def test_run_finalizer_clears_scope_after_cancelled_stop_watcher(hass) -> None:
    """A delegated journal scope is released even when its watcher is cancelled."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    scope: dict[str, str | None] = {"run_id": None}
    watcher_started = asyncio.Event()

    async def watcher() -> None:
        watcher_started.set()
        await asyncio.Event().wait()

    async def fake_leg(*_args, **_kwargs):
        manager.control.register_reconciliation_task(
            "serial",
            asyncio.create_task(watcher()),
            dock=True,
            run_id=_kwargs["run_id"],
        )
        await watcher_started.wait()
        return True

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg",
        AsyncMock(side_effect=fake_leg),
    ):
        await _async_execute_rooms(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "room-kitchen")],
            floor_token="floor",
            robot=robot_port(
                set_activity_run_id=lambda run_id: scope.__setitem__("run_id", run_id),
                get_activity_run_id=lambda: scope["run_id"],
            ),
        )

    assert scope["run_id"] is not None
    manager.control.cancel_reconciliation_tasks("serial")
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert scope["run_id"] is None


async def test_run_finalizer_clears_scope_owned_by_another_run(hass) -> None:
    """An older dock watcher cannot pin a newer run's activity scope."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    set_run_id = MagicMock()
    watcher_release = asyncio.Event()

    async def watcher() -> None:
        await watcher_release.wait()

    async def fake_leg(*_args, **_kwargs):
        manager.control.register_reconciliation_task(
            "serial", asyncio.create_task(watcher()), dock=True
        )
        return True

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg",
        AsyncMock(side_effect=fake_leg),
    ):
        await _async_execute_rooms(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "room-kitchen")],
            floor_token="floor",
            robot=robot_port(
                set_activity_run_id=set_run_id, get_activity_run_id=lambda: "newer-run"
            ),
        )

    assert set_run_id.call_args_list[-1].args[0] is None
    watcher_release.set()
    manager.control.cancel_reconciliation_tasks("serial")
    await asyncio.sleep(0)


async def test_execute_rooms_skips_every_room_once_cancellation_is_set(hass) -> None:
    cancel_event = asyncio.Event()
    cancel_event.set()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial",
        "away",
        {
            "name": "Away",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    manager.control.prepare_run = MagicMock(return_value=cancel_event)
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {
            "plan_id": "away",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": True,
        },
    )
    room = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "quick")
    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg", AsyncMock()
    ) as run:
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.test",
            "serial",
            [room],
            floor_token="floor",
            robot=robot_port(),
        )
    run.assert_not_awaited()


@pytest.mark.parametrize("replace", [False, True])
async def test_stop_owns_a_start_waiting_for_its_initial_settlement_check(
    hass, replace: bool
) -> None:
    """An immediate Stop cannot be forgotten by a not-yet-dispatched run."""
    manager = CleaningPlanManager(hass)
    entered = asyncio.Event()
    release = asyncio.Event()

    async def delayed_check(*_args) -> None:
        entered.set()
        await release.wait()

    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        {
            "plan_id": "quick_clean",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": True,
        },
    )
    room = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "quick")
    command = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.managed_dispatch._ensure_stop_settled",
            side_effect=delayed_check,
        ),
        patch("custom_components.matic_robot.managed_leg._async_run_leg") as run,
    ):
        task = asyncio.create_task(
            _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.test",
                "serial",
                [room],
                floor_token="floor",
                robot=robot_port(),
                managed_user_command=command,
            )
        )
        await entered.wait()
        try:
            assert manager.control.lock("serial").locked()
            assert manager.control.request_stop("serial").behavior == "immediate"
            if replace:
                async with manager.control.external_motion("serial"):
                    pass
            with pytest.raises(ServiceValidationError, match="already running"):
                await _async_execute_rooms(
                    hass,
                    call,
                    manager,
                    "vacuum.test",
                    "serial",
                    [room],
                    floor_token="floor",
                    robot=robot_port(),
                )
        finally:
            release.set()
            await task
    run.assert_not_awaited()
    command.assert_not_awaited()
    assert not manager.control.lock("serial").locked()
    assert not manager.control.has_managed_task("serial")


@pytest.mark.parametrize("multi_room", [False, True])
async def test_unexpected_outer_abort_cannot_stop_a_replacement(
    hass, monkeypatch, multi_room
):
    robot = FakeRobot()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    identity = b""
    commands = []
    sender = AsyncMock()

    async def dispatch(command):
        nonlocal identity
        commands.append(command)
        identity = _session_identity(command.session_id)
        robot.show("cleaning", current_area=ROOM.name)

    async def fail_after_replacement(*args, **kwargs):
        nonlocal identity
        identity = REPLACEMENT
        raise RuntimeError("unexpected observer failure")

    robot.on_start = dispatch
    if multi_room:
        monkeypatch.setattr(
            _LegOutcomeObserver,
            "next",
            fail_after_replacement,
        )
    else:
        monkeypatch.setattr(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            fail_after_replacement,
        )
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    call = ServiceCall(
        hass,
        "matic_robot",
        "run_selected_plan",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    with pytest.raises(RuntimeError, match="unexpected observer failure"):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            floor_token="floor",
            robot=robot.port(session_identity=AsyncMock(side_effect=lambda: identity)),
            managed_user_command=sender,
        )
    sender.assert_not_awaited()
    assert len(commands) == 1
    assert manager.history.snapshot("serial")["active_plan"] is None
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is False
    assert not manager.control.lock("serial").locked()
