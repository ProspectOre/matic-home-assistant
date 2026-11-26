"""A durable run checkpoints each step of its queue in the order recovery reads."""

import hashlib
from copy import deepcopy
from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_executor import (
    async_execute_rooms,
    async_finish_plan_run,
)
from custom_components.matic_robot.managed_run import (
    PreparedRoomDispatch,
    async_completion_budget,
)
from custom_components.matic_robot.plan_model import CleaningRoom, leg_groups
from custom_components.matic_robot.plan_records import LastRun
from custom_components.matic_robot.run_machine import (
    Restarted,
    Run,
    RunPhase,
    transition,
)
from tests.plans.fakes import (
    credit_rooms,
    memory_manager,
    recovery_record,
    save_run_checkpoint,
)
from tests.session_fakes import FakeRobot, robot_port


def _release_0_6_checkpoint(phase: str) -> dict:
    """A checkpoint as release/0.6 at 8fd81dce saved it, mid two-leg run."""
    handoff = phase == "handoff"
    return {
        "version": 1,
        "mixed_settings": True,
        "single_room_missions": True,
        "entity_id": "vacuum.matic",
        "floor_token": "a" * 64,
        "rooms": [
            asdict(CleaningRoom("kitchen", "Kitchen", "vacuum", "standard")),
            asdict(CleaningRoom("office", "Office", "mop", "standard")),
        ],
        "data": {
            "plan_id": "plan",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": False,
        },
        "leg_index": 1 if handoff else 0,
        "phase": phase,
        "completed_room_ids": ["kitchen"] if handoff else [],
        "finish_current_room": True,
        "finish_current_room_threshold": 50,
        "dispatched_at": "2026-11-12T06:01:54.865482+00:00",
        "completion_deadline": "2026-11-12T06:03:34.866398+00:00",
        "native_identity_hash": hashlib.sha256(b"session").hexdigest(),
        "history_baseline": [hashlib.sha256(b"before").hexdigest()],
        **({"handoff_history": []} if handoff else {}),
    }


@pytest.mark.parametrize(
    ("phase", "resumed"),
    [
        ("accepted", Run(RunPhase.ACCEPTED)),
        ("handoff", Run(RunPhase.HANDOFF, 1, frozenset({"kitchen"}))),
    ],
)
def test_a_release_0_6_checkpoint_resumes(phase, resumed) -> None:
    """Recovery reads what release/0.6 saved; the pinned run saves the same keys."""
    record = {
        "run_id": "run",
        "plan_id": "plan",
        "room_count": 2,
        "completed_room_count": 0,
        "recovery_checkpoint": _release_0_6_checkpoint(phase),
    }
    assert transition(Run(), Restarted(LastRun.parse(record)))[0] == resumed


@pytest.mark.parametrize("history_state", ["available", "error"])
async def test_executor_checkpoints_each_dispatch(hass, recovery_state, history_state):
    manager, entry, checkpoint, room = recovery_state
    await manager.ledger.async_finish_run("serial", "run", "unverified", "test", 0)
    room2 = CleaningRoom("office", "Office", "mop", "standard")
    seen = []

    async def leg(*args, **kwargs):
        # The dispatch saves the phase once the handoff boundary holds.
        assert recovery_record(manager)["recovery_checkpoint"]["phase"] != (
            "dispatching"
        )
        await kwargs["on_dispatching"]()
        saved = recovery_record(manager)
        assert saved["recovery_checkpoint"]["phase"] == "dispatching"
        if args[5] == [room2]:
            expected = hashlib.sha256(b"new").hexdigest()
            assert kwargs["expected_dispatch_history"] == frozenset({expected})
            assert saved["recovery_checkpoint"]["handoff_history"] == [expected]
        if args[5] == [room]:
            # Model the native leg ending before the next settings boundary;
            # the durable runner must wait for this settled handoff.
            entry.robot.show("idle")
            kwargs["on_native_identity"](b"new")
        dispatch = PreparedRoomDispatch(
            tuple(args[5]),
            frozenset({b"old"}),
            dt_util.utcnow(),
            native_identity=b"new",
        )
        await kwargs["checkpoint_dispatch"](dispatch)
        assert recovery_record(manager)["recovery_checkpoint"]["phase"] == "starting"
        await async_completion_budget(dispatch, 100, kwargs["checkpoint_dispatch"])
        seen.append(recovery_record(manager)["recovery_checkpoint"])
        credit_rooms(args, kwargs, args[5])
        return True

    with (
        patch(
            "custom_components.matic_robot.managed_leg.async_run_room_leg",
            side_effect=leg,
        ),
        patch(
            "custom_components.matic_robot.plan_model.leg_groups",
            side_effect=lambda rooms, **options: (
                leg_groups(rooms, **options)
                if history_state == "available"
                else [[room] for room in rooms]
            ),
        ),
    ):
        await async_execute_rooms(
            hass,
            ServiceCall(hass, DOMAIN, "run_selected_plan", checkpoint["data"]),
            manager,
            checkpoint["entity_id"],
            "serial",
            [room, room2],
            robot=entry.robot.port(
                session_identity=AsyncMock(return_value=b""),
                session_history=(
                    AsyncMock(side_effect=CannotConnectError("unavailable"))
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
        single_room_missions=True,
        completed_room_ids=[first.room_id],
        stop_intent="after_room",
    )
    await save_run_checkpoint(manager, checkpoint)
    run = manager.recovery.recovery_run("serial")
    prepared = PreparedRoomDispatch(
        (room,), frozenset(), dt_util.utcnow(), native_identity=b"synthetic-session"
    )

    async def leg(*args, **kwargs):
        assert args[5] == [room]
        assert kwargs["prepared_dispatch"] == prepared
        assert kwargs["finish_room_event"].is_set()
        credit_rooms(args, kwargs, [room])
        return True

    with patch(
        "custom_components.matic_robot.managed_leg.async_run_room_leg", side_effect=leg
    ) as runner:
        await async_execute_rooms(
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
    robot = FakeRobot()
    manager = memory_manager(hass)
    robot.show("idle")
    kitchen = CleaningRoom("kitchen", "Kitchen", "vacuum", "standard")
    office = CleaningRoom("office", "Office", "mop", "standard")
    saves: list[dict] = []
    save = manager.recovery.async_set_recovery_checkpoint

    async def record(serial_number, run_id, checkpoint):
        saves.append(deepcopy(checkpoint))
        await save(serial_number, run_id, checkpoint)

    async def leg(*args, **kwargs):
        await kwargs["on_dispatching"]()
        dispatch = PreparedRoomDispatch(
            tuple(args[5]), frozenset({b"before"}), dt_util.utcnow(), None, b"session"
        )
        await kwargs["checkpoint_dispatch"](dispatch)
        await async_completion_budget(dispatch, 100, kwargs["checkpoint_dispatch"])
        credit_rooms(args, kwargs, args[5])
        return True

    with (
        patch.object(manager.recovery, "async_set_recovery_checkpoint", record),
        patch(
            "custom_components.matic_robot.managed_leg.async_run_room_leg",
            side_effect=leg,
        ),
        patch(
            "custom_components.matic_robot.plan_model.leg_groups",
            side_effect=lambda rooms, **_: [[room] for room in rooms],
        ),
        patch(
            "custom_components.matic_robot.managed_observation."
            "async_wait_for_settled_leg_handoff",
            AsyncMock(return_value=True),
        ),
    ):
        await async_execute_rooms(
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
            robot=robot.port(
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
    # The fields release/0.6 saved and reads, so either version resumes, plus
    # the dispatch's own session and the handoff's idle revision, which 0.5.5
    # saves under the same names.
    assert set(saves[3]) == set(_release_0_6_checkpoint("accepted")) | {"session_hash"}
    assert set(saves[4]) == set(_release_0_6_checkpoint("handoff")) | {
        "session_hash",
        "handoff_revision",
    }
    assert saves[4]["handoff_history"] == [hashlib.sha256(b"after").hexdigest()]
    assert saves[2]["native_identity_hash"] == hashlib.sha256(b"session").hexdigest()
    assert saves[2]["history_baseline"] == [hashlib.sha256(b"before").hexdigest()]
    assert saves[2]["completion_deadline"] is None
    assert saves[3]["completion_deadline"] is not None
    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "completed"


async def test_plan_finished_reports_its_own_end_once_another_run_is_stored(
    hass, recovery_state
):
    """The finalizer still announces a run whose stored record moved on."""
    manager, _, _, _ = recovery_state
    events = []
    hass.bus.async_listen("matic_robot_plan_finished", events.append)
    await async_finish_plan_run(
        hass,
        manager,
        "serial",
        "vacuum.matic",
        {"plan_id": "plan", "run_id": "older"},
        "failed",
        "robot_command_failed",
        "unknown",
        0,
    )
    await hass.async_block_till_done()
    assert events[0].data == {
        "entity_id": "vacuum.matic",
        "plan_id": "plan",
        "run_id": "older",
        "ended_at": ANY,
        "outcome": "failed",
        "reason_code": "robot_command_failed",
        "cause": "unknown",
        "terminal_activity": "unknown",
        "completed_room_count": 0,
    }
    assert recovery_record(manager)["run_id"] == "run"
