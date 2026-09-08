"""A suspended native mission cannot adopt an independent OEM cleaning task."""

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom
from custom_components.matic_robot.services import (
    PlanCancelledError,
    RoomTakenOverError,
    _async_execute_rooms,
    _async_wait_for_owned_resume,
)

ROOM = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
ORIGINAL = b"synthetic-original-session"
REPLACEMENT = b"synthetic-oem-session"


@pytest.fixture(autouse=True)
def fast_identity_polls(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.services.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0.001,
    )


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize(
    "suspension,replacement",
    [
        (suspension, replacement)
        for suspension in ("low_charge", "paused", "returning", "cleaning")
        for replacement in (b"", REPLACEMENT, None, MaticError("offline"))
        # A cleared session during an ordinary return permits history
        # verification; its absence alone does not imply replacement.
        if not (suspension in ("returning", "cleaning") and replacement == b"")
    ],
)
async def test_lost_session_releases_plan_without_stop_credit_or_next_leg(
    hass, multi_room, replacement, suspension
):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    suspended = asyncio.Event()
    started = asyncio.Event()
    original_suspend = manager.async_mark_suspended
    original_resume = manager.async_mark_resumed

    async def suspend(*args):
        await original_suspend(*args)
        suspended.set()

    async def resume(*args):
        await original_resume(*args)
        started.set()

    manager.async_mark_suspended = suspend
    manager.async_mark_resumed = AsyncMock(side_effect=resume)
    identity = ORIGINAL
    returning = asyncio.Event()

    async def read_identity():
        if not dispatched:
            return b""
        current = hass.states.get("vacuum.matic")
        if current is not None and current.state == "returning":
            returning.set()
        if isinstance(identity, Exception):
            raise identity
        return identity

    dispatched = []

    async def send_command(call):
        dispatched.append(call.data)
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    hass.services.async_register("vacuum", "send_command", send_command)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    # A settings boundary would dispatch a second native mission on completion.
    rooms.append(
        replace(ROOM, room_id="room-study", name="Study", coverage_setting="quick")
    )
    sender = AsyncMock()
    history = AsyncMock(return_value=())
    presence = AsyncMock(return_value=None)
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            session_identity=read_identity,
            active_session=presence,
            session_history=history,
            managed_user_command=sender,
        )
    )
    await asyncio.wait_for(started.wait(), 1)
    credit_before = manager.snapshot("serial")["last_completed_by_room"]
    hass.states.async_set(
        "vacuum.matic",
        "paused"
        if suspension == "paused"
        else ("cleaning" if suspension == "cleaning" else "returning"),
        {
            "current_area": ROOM.name,
            "low_charge": suspension == "low_charge",
        },
    )
    if suspension != "cleaning":
        await asyncio.wait_for(
            (returning if suspension == "returning" else suspended).wait(), 1
        )
    identity = replacement
    # Identical target room must not disguise an independent OEM mission.
    hass.states.async_set(
        "vacuum.matic",
        "cleaning" if replacement else "docked",
        {
            "current_area": ROOM.name,
            "low_charge": False,
        },
    )
    with pytest.raises(ServiceValidationError) as error:
        await asyncio.wait_for(runner, 1)
    assert error.value.translation_key == "room_taken_over"
    assert len(dispatched) == 1
    sender.assert_not_awaited()
    presence.assert_not_awaited()
    history.assert_awaited_once()  # Baseline only; no new mission history credited.
    manager.async_mark_resumed.assert_awaited_once()
    snapshot = manager.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["last_completed_by_room"] == credit_before
    assert snapshot["native_reconciliation_pending"] is False
    assert not manager.lock("serial").locked()
    assert not manager.stop_pending("serial")
    assert ORIGINAL.decode() not in str(snapshot)
    assert REPLACEMENT.decode() not in str(snapshot)


async def test_same_session_resumes_only_after_cleaning_in_target_room(hass):
    hass.states.async_set("vacuum.matic", "docked", {"current_area": ROOM.name})
    reader = AsyncMock(return_value=ORIGINAL)
    resumed = asyncio.create_task(
        _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            10,
            None,
            ROOM,
            reader,
            ORIGINAL,
        )
    )
    await asyncio.sleep(0.005)
    assert not resumed.done()
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Hallway"})
    await asyncio.sleep(0.005)
    assert not resumed.done()
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    await asyncio.wait_for(resumed, 1)


async def test_unknown_read_at_resume_must_recover_identity_before_acceptance(hass):
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    reader = AsyncMock(side_effect=[None, MaticError("offline"), ORIGINAL])
    await _async_wait_for_owned_resume(
        hass, "vacuum.matic", 10, None, ROOM, reader, ORIGINAL
    )
    assert reader.await_count == 3


@pytest.mark.parametrize("expected,reader", [(None, AsyncMock()), (ORIGINAL, None)])
async def test_unknown_original_identity_cannot_resume(hass, expected, reader):
    with pytest.raises(RoomTakenOverError):
        await _async_wait_for_owned_resume(
            hass, "vacuum.matic", 10, None, ROOM, reader, expected
        )


@pytest.mark.parametrize("cancel_first", [False, True])
async def test_resume_wait_honors_cancellation(hass, cancel_first):
    hass.states.async_set("vacuum.matic", "docked")
    cancel = asyncio.Event()
    if cancel_first:
        cancel.set()
    resumed = asyncio.create_task(
        _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            10,
            cancel,
            ROOM,
            AsyncMock(return_value=ORIGINAL),
            ORIGINAL,
        )
    )
    await asyncio.sleep(0.005)
    cancel.set()
    with pytest.raises(PlanCancelledError):
        await resumed


async def test_resume_wait_propagates_robot_error_and_cleans_listener(hass):
    hass.states.async_set("vacuum.matic", "error")
    with pytest.raises(ServiceValidationError):
        await _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            10,
            None,
            ROOM,
            AsyncMock(return_value=ORIGINAL),
            ORIGINAL,
        )


@pytest.mark.parametrize("identity, expected_result", [(ORIGINAL, True), (b"", False)])
async def test_returning_session_checks_identity_before_accepting_cleaning(
    hass, identity, expected_result
):
    from custom_components.matic_robot.services import (
        _async_wait_for_active_session_resolution,
    )

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    presence = AsyncMock(return_value=True)
    assert (
        await _async_wait_for_active_session_resolution(
            hass,
            "vacuum.matic",
            presence,
            identity_reader=AsyncMock(return_value=identity),
            expected_identity=ORIGINAL,
        )
        is expected_result
    )
    presence.assert_not_awaited()


@pytest.mark.parametrize("identity", [REPLACEMENT, None])
async def test_returning_session_replacement_or_unknown_cannot_resume(hass, identity):
    from custom_components.matic_robot.services import (
        _async_wait_for_active_session_resolution,
    )

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    with pytest.raises(RoomTakenOverError):
        await _async_wait_for_active_session_resolution(
            hass,
            "vacuum.matic",
            None,
            identity_reader=AsyncMock(return_value=identity),
            expected_identity=ORIGINAL,
        )


@pytest.mark.parametrize("multi_room", [False, True])
async def test_started_task_with_unknown_identity_retires_without_stopping(
    hass, multi_room
):
    from custom_components.matic_robot.services import _async_run_leg

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    sender = AsyncMock()
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))

    async def send_command(call):
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    hass.services.async_register("vacuum", "send_command", send_command)
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
        },
    )
    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=AsyncMock(
                side_effect=lambda: None if hass.states.get("vacuum.matic") else b""
            ),
            managed_user_command=sender,
        )
    sender.assert_not_awaited()
    assert manager.snapshot("serial")["active_plan"] is None


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize("identity", [ORIGINAL, REPLACEMENT, None])
@pytest.mark.parametrize("suspension", ["paused", "low_charge"])
async def test_unload_cleanup_rechecks_native_owner_before_stop(
    hass, multi_room, identity, suspension
):
    from custom_components.matic_robot.client.commands import UserCommand

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    started, suspended = asyncio.Event(), asyncio.Event()
    original_resume = manager.async_mark_resumed
    original_suspend = manager.async_mark_suspended

    async def resume(*args):
        await original_resume(*args)
        started.set()

    async def suspend(*args):
        await original_suspend(*args)
        suspended.set()

    manager.async_mark_resumed = resume
    manager.async_mark_suspended = suspend
    reader = AsyncMock(return_value=ORIGINAL)
    sender = AsyncMock()
    dispatched = []
    reader.side_effect = lambda: reader.return_value if dispatched else b""

    async def dispatch(call):
        dispatched.append(call.data)
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    hass.services.async_register("vacuum", "send_command", dispatch)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    rooms.append(
        replace(ROOM, room_id="room-study", name="Study", coverage_setting="quick")
    )
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            session_identity=reader,
            managed_user_command=sender,
        )
    )
    await asyncio.wait_for(started.wait(), 1)
    credit_before = manager.snapshot("serial")["last_completed_by_room"]
    hass.states.async_set(
        "vacuum.matic",
        "paused" if suspension == "paused" else "returning",
        {
            "current_area": ROOM.name,
            "low_charge": suspension == "low_charge",
        },
    )
    await asyncio.wait_for(suspended.wait(), 1)
    # Replace the native session and unload before the next polling interval.
    reader.return_value = identity
    await asyncio.wait_for(manager.async_cancel_and_wait("serial"), 1)
    await runner
    if identity == ORIGINAL:
        assert sender.await_count == 1
        assert sender.await_args.args[1] is UserCommand.STOP
    else:
        sender.assert_not_awaited()
        assert manager.snapshot("serial")["native_reconciliation_pending"] is False
    assert len(dispatched) == 1
    assert manager.snapshot("serial")["active_plan"] is None
    assert manager.snapshot("serial")["last_completed_by_room"] == credit_before
    assert not manager.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize(
    "stale_state,delayed_identity", [("docked", False), ("cleaning", True)]
)
@pytest.mark.parametrize("final_identity", [ORIGINAL, REPLACEMENT, None, b""])
async def test_start_timeout_stops_only_the_task_bound_before_ha_confirmation(
    hass, multi_room, stale_state, delayed_identity, final_identity
):
    from custom_components.matic_robot.client.commands import UserCommand

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    sender, history = AsyncMock(), AsyncMock(return_value=())
    dispatched = []
    bound = asyncio.Event()
    identity = ORIGINAL
    reads = 0

    async def read_identity():
        nonlocal reads
        if not dispatched:
            return b""
        reads += 1
        if delayed_identity and reads <= 2:
            return b"" if reads == 1 else None
        bound.set()
        return identity

    async def dispatch(call):
        dispatched.append(call.data)
        # The native task accepted the command, but HA still has the old
        # activity or an unrelated room. Neither confirms the new start.
        hass.states.async_set("vacuum.matic", stale_state, {"current_area": "Hallway"})

    hass.services.async_register("vacuum", "send_command", dispatch)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    rooms.append(
        replace(ROOM, room_id="room-study", name="Study", coverage_setting="quick")
    )
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 0.03,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            session_identity=read_identity,
            session_history=history,
            managed_user_command=sender,
        )
    )
    await asyncio.wait_for(bound.wait(), 1)
    identity = final_identity
    with pytest.raises(ServiceValidationError) as error:
        await asyncio.wait_for(runner, 1)
    assert error.value.translation_key == (
        "room_taken_over"
        if final_identity in (REPLACEMENT, b"")
        else "plan_start_timeout"
    )
    if final_identity == ORIGINAL:
        sender.assert_awaited_once()
        assert sender.await_args.args[1] is UserCommand.STOP
    else:
        sender.assert_not_awaited()
    assert len(dispatched) == 1
    history.assert_awaited_once()
    snapshot = manager.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert not snapshot["last_completed_by_room"]
    assert snapshot["native_reconciliation_pending"] is False
    assert not manager.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize(
    "dispatch_result", ["rejected", "unchanged", "new_task", "cancelled"]
)
async def test_existing_oem_task_is_not_adopted_by_a_managed_start(
    hass, multi_room, dispatch_result
):
    from custom_components.matic_robot.client.commands import UserCommand

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    identity = ORIGINAL
    started, command_returned = asyncio.Event(), asyncio.Event()
    original_resume = manager.async_mark_resumed

    async def resume(*args):
        await original_resume(*args)
        started.set()

    manager.async_mark_resumed = resume
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    sender, history = AsyncMock(), AsyncMock(return_value=())
    commands = []

    async def dispatch(call):
        commands.append(call.data)
        command_returned.set()
        if dispatch_result == "rejected":
            raise MaticError("command rejected")

    hass.services.async_register("vacuum", "send_command", dispatch)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 0.03,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            session_identity=AsyncMock(side_effect=lambda: identity),
            session_history=history,
            managed_user_command=sender,
        )
    )
    await asyncio.wait_for(command_returned.wait(), 1)
    if dispatch_result == "new_task":
        # The unchanged old HA state must not count as the new mission.
        await asyncio.sleep(0.005)
        assert not started.is_set()
        identity = REPLACEMENT
        await asyncio.wait_for(started.wait(), 1)
        await manager.async_cancel_and_wait("serial")
        await runner
        sender.assert_awaited_once()
        assert sender.await_args.args[1] is UserCommand.STOP
    elif dispatch_result == "cancelled":
        await asyncio.sleep(0.005)
        await manager.async_cancel_and_wait("serial")
        await runner
        assert not started.is_set()
        sender.assert_not_awaited()
    else:
        with pytest.raises(ServiceValidationError) as error:
            await runner
        assert error.value.translation_key == (
            "robot_command_failed"
            if dispatch_result == "rejected"
            else "plan_start_timeout"
        )
        assert not started.is_set()
        sender.assert_not_awaited()
    assert len(commands) == 1
    history.assert_awaited_once()
    assert all(
        value["runs"] == 0 and value["at"] is None
        for value in manager.snapshot("serial")["last_completed_by_room"].values()
    )
    assert manager.snapshot("serial")["active_plan"] is None
    assert not manager.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
async def test_unknown_pre_dispatch_identity_sends_no_cleaning_command(
    hass, multi_room
):
    from custom_components.matic_robot.services import _async_run_leg

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    command, sender = AsyncMock(), AsyncMock()
    hass.services.async_register("vacuum", "send_command", command)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
        },
    )
    with pytest.raises(ServiceValidationError) as error:
        await _async_run_leg(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=AsyncMock(return_value=None),
            managed_user_command=sender,
        )
    assert error.value.translation_key == "room_taken_over"
    command.assert_not_awaited()
    sender.assert_not_awaited()


@pytest.mark.parametrize("multi_room", [False, True])
async def test_unexpected_outer_abort_cannot_stop_a_replacement(
    hass, monkeypatch, multi_room
):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    identity = b""
    commands = []
    sender = AsyncMock()

    async def dispatch(call):
        nonlocal identity
        commands.append(call.data)
        identity = ORIGINAL
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    async def fail_after_replacement(*args, **kwargs):
        nonlocal identity
        identity = REPLACEMENT
        raise RuntimeError("unexpected observer failure")

    hass.services.async_register("vacuum", "send_command", dispatch)
    for waiter in ("_async_wait_for_room_outcome", "_async_wait_for_leg_outcome"):
        monkeypatch.setattr(
            "custom_components.matic_robot.services." + waiter, fail_after_replacement
        )
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
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
            intelligent=False,
            session_identity=AsyncMock(side_effect=lambda: identity),
            managed_user_command=sender,
        )
    sender.assert_not_awaited()
    assert len(commands) == 1
    assert manager.snapshot("serial")["active_plan"] is None
    assert manager.snapshot("serial")["native_reconciliation_pending"] is False
    assert not manager.lock("serial").locked()


@pytest.mark.parametrize(
    "identity,allowed",
    [(b"", True), (ORIGINAL, True), (REPLACEMENT, False), (None, False)],
)
async def test_final_dock_cannot_interrupt_an_independent_native_task(
    hass, identity, allowed
):
    from custom_components.matic_robot.client.commands import UserCommand
    from custom_components.matic_robot.plans import ManagedMotionReplacedError
    from custom_components.matic_robot.services import _guard_native_commands

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    token = manager.begin_managed_motion("serial")
    sender = AsyncMock()
    guarded = _guard_native_commands(
        sender,
        manager,
        "serial",
        AsyncMock(return_value=identity),
        lambda: ORIGINAL,
        allow_ended_dock=True,
    )
    if allowed:
        await guarded(token, UserCommand.DOCK)
        sender.assert_awaited_once_with(token, UserCommand.DOCK)
    else:
        with pytest.raises(ManagedMotionReplacedError):
            await guarded(token, UserCommand.DOCK)
        sender.assert_not_awaited()


@pytest.mark.parametrize("phase", ["start", "resume", "return", "outcome"])
@pytest.mark.parametrize("after_transition", [REPLACEMENT, None, ORIGINAL])
async def test_state_transition_requires_a_new_identity_read(
    hass, phase, after_transition
):
    from custom_components.matic_robot.services import (
        _async_wait_for_active_session_resolution,
        _async_wait_for_owned_start,
        _async_wait_with_native_identity,
    )

    read_started, release_read, transition = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )
    reads = 0

    async def reader():
        nonlocal reads
        reads += 1
        if reads == 1:
            # This request captured the old identity before the state changed,
            # but its response arrives after the new cleaning state.
            read_started.set()
            await release_read.wait()
            return ORIGINAL
        return after_transition

    async def outcome():
        await transition.wait()
        return "transition"

    hass.states.async_set("vacuum.matic", "docked", {"current_area": ROOM.name})
    if phase == "start":
        waiter = _async_wait_for_owned_start(
            hass, "vacuum.matic", 10, None, ROOM, reader, lambda _: None, b"", ORIGINAL
        )
    elif phase == "resume":
        waiter = _async_wait_for_owned_resume(
            hass, "vacuum.matic", 10, None, ROOM, reader, ORIGINAL
        )
    elif phase == "return":
        waiter = _async_wait_for_active_session_resolution(
            hass,
            "vacuum.matic",
            None,
            identity_reader=reader,
            expected_identity=ORIGINAL,
        )
    else:
        waiter = _async_wait_with_native_identity(outcome, reader, ORIGINAL)
    task = asyncio.create_task(waiter)
    await asyncio.wait_for(read_started.wait(), 1)
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    transition.set()
    await hass.async_block_till_done()
    release_read.set()
    if after_transition == ORIGINAL:
        await asyncio.wait_for(task, 1)
    else:
        with pytest.raises(RoomTakenOverError):
            await asyncio.wait_for(task, 1)
    assert reads >= 2


async def test_return_does_not_accept_an_ended_read_from_before_new_cleaning(hass):
    from custom_components.matic_robot.services import (
        _async_wait_for_active_session_resolution,
    )

    read_started, release_read = asyncio.Event(), asyncio.Event()
    reads = 0

    async def reader():
        nonlocal reads
        reads += 1
        if reads == 1:
            read_started.set()
            await release_read.wait()
            return b""
        return REPLACEMENT

    hass.states.async_set("vacuum.matic", "returning")
    task = asyncio.create_task(
        _async_wait_for_active_session_resolution(
            hass,
            "vacuum.matic",
            None,
            identity_reader=reader,
            expected_identity=ORIGINAL,
        )
    )
    await asyncio.wait_for(read_started.wait(), 1)
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    release_read.set()
    with pytest.raises(RoomTakenOverError):
        await asyncio.wait_for(task, 1)
    assert reads == 2


@pytest.mark.parametrize("transient", [None, MaticError("temporary read failure")])
@pytest.mark.parametrize("baseline", [b"", ORIGINAL])
async def test_dispatch_retries_a_transient_unknown_baseline(hass, transient, baseline):
    from custom_components.matic_robot.services import _async_dispatch_leg_command

    command = AsyncMock()
    hass.services.async_register("vacuum", "send_command", command)
    reader = AsyncMock(side_effect=[transient, baseline, REPLACEMENT])
    identity_observed = []
    call = ServiceCall(
        hass, "matic_robot", "intelligent_clean", {"plan_id": "test-plan"}
    )
    prepared = await _async_dispatch_leg_command(
        hass,
        call,
        "vacuum.matic",
        [ROOM],
        7,
        None,
        session_identity=reader,
        on_identity=identity_observed.append,
    )
    command.assert_awaited_once()
    assert prepared.native_identity_baseline == baseline
    assert prepared.native_identity == REPLACEMENT
    assert identity_observed == [REPLACEMENT]
    assert reader.await_count == 3
