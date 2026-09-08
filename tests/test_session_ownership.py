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
        for suspension in ("low_charge", "paused", "returning")
        for replacement in (b"", REPLACEMENT, None, MaticError("offline"))
        # A cleared session during an ordinary return permits history
        # verification; its absence alone does not imply replacement.
        if not (suspension == "returning" and replacement == b"")
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
        "paused" if suspension == "paused" else "returning",
        {
            "current_area": ROOM.name,
            "low_charge": suspension == "low_charge",
        },
    )
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
    assert snapshot.get("pending_native_reconciliation") is None
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
            session_identity=AsyncMock(return_value=None),
            managed_user_command=sender,
        )
    sender.assert_not_awaited()
    assert manager.snapshot("serial")["active_plan"] is None
