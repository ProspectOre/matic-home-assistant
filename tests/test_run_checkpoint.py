"""A durable run checkpoints each step of its queue in the order recovery reads."""

import hashlib
from copy import deepcopy
from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_run import (
    _async_completion_budget,
    _PreparedRoomDispatch,
)
from custom_components.matic_robot.plan_model import CleaningRoom, leg_groups
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.session_fakes import robot_port

from .test_restart import recovery_state as recovery_fixture


@pytest.fixture
async def recovery_state(hass):
    return await recovery_fixture.__wrapped__(hass)


@pytest.mark.parametrize("history_state", ["available", "missing", "error"])
async def test_executor_checkpoints_each_dispatch(hass, recovery_state, history_state):
    manager, _, checkpoint, room = recovery_state
    await manager.ledger.async_finish_run("serial", "run", "unverified", "test", 0)
    room2 = CleaningRoom("office", "Office", "mop", "standard")
    seen = []

    async def leg(*args, **kwargs):
        saved = manager.recovery.recovery_run("serial")
        assert saved["recovery_checkpoint"]["phase"] == "dispatching"
        if args[5] == [room2]:
            expected = hashlib.sha256(b"new").hexdigest()
            assert kwargs["expected_dispatch_history"] == frozenset({expected})
            assert saved["recovery_checkpoint"]["handoff_history"] == [expected]
        if args[5] == [room]:
            # Model the native leg ending before the next settings boundary;
            # the durable runner must wait for this settled handoff.
            hass.states.async_set(checkpoint["entity_id"], "idle")
            kwargs["on_native_identity"](b"new")
        dispatch = _PreparedRoomDispatch(
            tuple(args[5]),
            frozenset({b"old"}),
            dt_util.utcnow(),
            native_identity=b"new",
        )
        await kwargs["checkpoint_dispatch"](dispatch)
        assert (
            manager.recovery.recovery_run("serial")["recovery_checkpoint"]["phase"]
            == "starting"
        )
        await _async_completion_budget(dispatch, 100, kwargs["checkpoint_dispatch"])
        seen.append(manager.recovery.recovery_run("serial")["recovery_checkpoint"])
        for target in args[5]:
            kwargs["record_room_completed"](target)
        return True

    with (
        patch(
            "custom_components.matic_robot.managed_leg._async_run_leg",
            side_effect=leg,
        ),
        patch(
            "custom_components.matic_robot.managed_executor.leg_groups",
            side_effect=lambda rooms, **kwargs: leg_groups(
                rooms,
                mixed_settings=history_state == "available",
                preserve_legacy_settings=kwargs.get("preserve_legacy_settings", False),
            ),
        ),
    ):
        await _async_execute_rooms(
            hass,
            ServiceCall(hass, DOMAIN, "run_selected_plan", checkpoint["data"]),
            manager,
            checkpoint["entity_id"],
            "serial",
            [room, room2],
            robot=robot_port(
                session_identity=AsyncMock(return_value=b""),
                session_history=(
                    None
                    if history_state == "missing"
                    else AsyncMock(side_effect=CannotConnectError("unavailable"))
                    if history_state == "error"
                    else AsyncMock(return_value=(SimpleNamespace(key=b"new"),))
                ),
            ),
            floor_token=checkpoint["floor_token"],
        )
    if history_state != "available":
        assert len(seen) == 1
        assert manager.history.snapshot("serial")["last_run"]["outcome"] == "unverified"
        return
    assert [value["leg_index"] for value in seen] == [0]
    assert seen[0]["mixed_settings"] is True
    assert [item["cleaning_mode"] for item in seen[0]["rooms"]] == [
        room.cleaning_mode,
        "mop",
    ]
    assert all(
        value["phase"] == "accepted" and value["completion_deadline"] for value in seen
    )
    assert seen[0]["native_identity_hash"] == hashlib.sha256(b"new").hexdigest()
    assert seen[0]["history_baseline"] == [hashlib.sha256(b"old").hexdigest()]
    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "completed"


async def test_recovery_executor_skips_verified_legs_and_honors_graceful_stop(
    hass, recovery_state
):
    manager, _, checkpoint, room = recovery_state
    first = CleaningRoom("office", "Office", "mop", "standard")
    await manager.ledger.async_begin_run(
        "serial", "plan", "run", 2, trigger="automation", service="run_selected_plan"
    )
    checkpoint.update(
        rooms=[asdict(first), asdict(room)],
        leg_index=1,
        completed_room_ids=[first.room_id],
        stop_intent="after_room",
    )
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    run = manager.recovery.recovery_run("serial")
    prepared = _PreparedRoomDispatch(
        (room,), frozenset(), dt_util.utcnow(), native_identity=b"synthetic-session"
    )

    async def leg(*args, **kwargs):
        assert args[5] == [room]
        assert kwargs["prepared_dispatch"] == prepared
        assert kwargs["finish_room_event"].is_set()
        kwargs["record_room_completed"](room)
        return True

    with patch(
        "custom_components.matic_robot.managed_leg._async_run_leg", side_effect=leg
    ) as runner:
        await _async_execute_rooms(
            hass,
            ServiceCall(hass, DOMAIN, "run_selected_plan", checkpoint["data"]),
            manager,
            checkpoint["entity_id"],
            "serial",
            [first, room],
            floor_token="floor",
            robot=robot_port(),
            recovery=run,
            recovered_dispatch=prepared,
        )
    runner.assert_awaited_once()
    assert manager.history.snapshot("serial")["last_run"]["completed_room_count"] == 2


async def test_a_two_leg_run_checkpoints_each_step_in_order(hass) -> None:
    """Pin every save a fresh durable run makes, as restart recovery reads them."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    hass.states.async_set("vacuum.matic", "idle")
    kitchen = CleaningRoom("kitchen", "Kitchen", "vacuum", "standard")
    office = CleaningRoom("office", "Office", "mop", "standard")
    saves: list[dict] = []
    save = manager.recovery.async_set_recovery_checkpoint

    async def record(serial_number, run_id, checkpoint):
        saves.append(deepcopy(checkpoint))
        await save(serial_number, run_id, checkpoint)

    async def leg(*args, **kwargs):
        dispatch = _PreparedRoomDispatch(
            tuple(args[5]), frozenset({b"before"}), dt_util.utcnow(), None, b"session"
        )
        await kwargs["checkpoint_dispatch"](dispatch)
        await _async_completion_budget(dispatch, 100, kwargs["checkpoint_dispatch"])
        for room in args[5]:
            kwargs["record_room_completed"](room)
        return True

    with (
        patch.object(manager.recovery, "async_set_recovery_checkpoint", record),
        patch(
            "custom_components.matic_robot.managed_leg._async_run_leg",
            side_effect=leg,
        ),
        patch(
            "custom_components.matic_robot.managed_executor.leg_groups",
            side_effect=lambda rooms, **_: [[room] for room in rooms],
        ),
        patch(
            "custom_components.matic_robot.managed_observation."
            "_async_wait_for_settled_leg_handoff",
            AsyncMock(return_value=True),
        ),
    ):
        await _async_execute_rooms(
            hass,
            ServiceCall(
                hass,
                DOMAIN,
                "run_selected_plan",
                {
                    "plan_id": "plan",
                    "start_timeout": 120,
                    "completion_timeout": 21600,
                    "return_to_base": False,
                },
            ),
            manager,
            "vacuum.matic",
            "serial",
            [kitchen, office],
            robot=robot_port(
                session_identity=AsyncMock(return_value=b""),
                session_history=AsyncMock(
                    return_value=(SimpleNamespace(key=b"after"),)
                ),
            ),
            floor_token="a" * 64,
        )

    assert [
        (save["phase"], save["leg_index"], save["completed_room_ids"]) for save in saves
    ] == [
        ("ready", 0, []),
        ("dispatching", 0, []),
        ("starting", 0, []),
        ("accepted", 0, []),
        ("handoff", 1, ["kitchen"]),
        ("handoff", 1, ["kitchen"]),
        ("dispatching", 1, ["kitchen"]),
        ("starting", 1, ["kitchen"]),
        ("accepted", 1, ["kitchen"]),
    ]
    assert "handoff_history" not in saves[3]
    assert saves[4]["handoff_history"] == [hashlib.sha256(b"after").hexdigest()]
    assert saves[2]["native_identity_hash"] == hashlib.sha256(b"session").hexdigest()
    assert saves[2]["history_baseline"] == [hashlib.sha256(b"before").hexdigest()]
    assert saves[2]["completion_deadline"] is None
    assert saves[3]["completion_deadline"] is not None
    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "completed"
