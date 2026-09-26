"""Queued managed runs reserve cadence while their execution is prepared."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    CleaningRoom,
    _managed_stop_policy,
)
from custom_components.matic_robot.restart import async_recover_managed_run
from tests.test_restart import recovery_state as restart_recovery_fixture


def _manager(hass) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    return manager


def _plan(*room_ids: str, scope: str = "plan") -> dict[str, object]:
    return {
        "name": "Home",
        "rooms": [
            {
                "room_id": room_id,
                "name": room_id.title(),
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": scope, "mop_every_n": 3},
            }
            for room_id in room_ids
        ],
    }


async def test_queued_room_cadence_is_reserved_before_stop_settlement_await(
    hass,
) -> None:
    manager = _manager(hass)
    await manager.async_save_plan("serial", "home", _plan("room-a", "room-b"))
    entered = asyncio.Event()
    release = asyncio.Event()

    async def stop_fence(*_args) -> None:
        entered.set()
        await release.wait()

    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        {
            "plan_id": "home",
            "return_to_base": False,
            "start_timeout": 120,
            "completion_timeout": 21600,
        },
    )
    rooms = [
        CleaningRoom("room-a", "Room A", "vacuum", "standard"),
        CleaningRoom("room-b", "Room B", "vacuum", "standard"),
    ]
    with patch(
        "custom_components.matic_robot.managed_executor._ensure_stop_settled",
        new=stop_fence,
    ):
        task = asyncio.create_task(
            _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.test",
                "serial",
                rooms,
            )
        )
        await entered.wait()
        try:
            assert manager.snapshot("serial")["active_plan"] is None
            assert manager._prepared_runs["serial"].rooms.keys() == {
                "room-a",
                "room-b",
            }
            with pytest.raises(ValueError, match="reserved"):
                await manager.async_reset_cadence("serial", "home", ["room-b"])
        finally:
            manager.request_stop("serial")
            release.set()
            await task

    assert "serial" not in manager._prepared_runs


async def test_reservation_covers_room_b_during_room_a_and_leaves_other_plan_editable(
    hass,
) -> None:
    manager = _manager(hass)
    await manager.async_save_plan("serial", "home", _plan("room-a", "room-b"))
    await manager.async_save_plan("serial", "other", _plan("room-c"))
    manager.reserve_prepared_run("serial", "home", "run-a", ["room-a", "room-b"])
    await manager.async_mark_started(
        "serial", "home", CleaningRoom("room-a", "Room A", "vacuum", "standard")
    )

    with pytest.raises(ValueError, match="reserved"):
        await manager.async_reset_cadence("serial", "home", ["room-b"])
    # An unrelated private schedule is independent of this queued run.
    await manager.async_reset_cadence("serial", "other", ["room-c"])

    manager.release_prepared_run("serial", "run-a")
    await manager.async_reset_cadence("serial", "home", ["room-b"])


async def test_shared_cadence_reservation_covers_mutations_from_another_plan(
    hass,
) -> None:
    manager = _manager(hass)
    floor_token = "a" * 64
    identity = "b" * 64
    shared_plan = _plan("room-b", scope="shared")
    await manager.async_save_plan(
        "serial",
        "home",
        shared_plan,
        floor_token=floor_token,
        room_identities={"room-b": identity},
    )
    await manager.async_save_plan(
        "serial",
        "other",
        shared_plan,
        floor_token=floor_token,
        room_identities={"room-b": identity},
    )
    # Old saved plans can lack their room token while the durable shared row
    # still carries the verified identity needed to freeze queued work.
    manager._robot("serial")["plans"]["home"]["rooms"][0].pop("cadence_identity", None)
    manager.reserve_prepared_run(
        "serial",
        "home",
        "run-shared",
        ["room-b"],
    )
    assert manager._prepared_runs["serial"].rooms["room-b"] == (
        "shared",
        identity,
    )

    with pytest.raises(ValueError, match="shared room cadence is reserved"):
        await manager.async_reset_cadence("serial", "other", ["room-b"])
    changed = _plan("room-b", scope="shared")
    changed["rooms"][0]["cadence"]["mop_every_n"] = 4
    with pytest.raises(ValueError, match="shared room cadence is reserved"):
        await manager.async_save_plan(
            "serial",
            "other",
            changed,
            floor_token=floor_token,
            room_identities={"room-b": identity},
        )

    manager.release_prepared_run("serial", "run-shared")


async def test_opted_in_inactive_room_blocks_shared_creation_during_preflight(
    hass,
) -> None:
    manager = _manager(hass)
    floor_token = "a" * 64
    identity_b = "b" * 64
    identity_c = "c" * 64
    room_b = CleaningRoom("room-b", "Room B", "vacuum", "standard")
    _effective, cadence = manager.resolve_cadence(
        "serial",
        "quick_clean",
        [room_b],
        floor_token=floor_token,
        room_identities={"room-b": identity_b},
        use_shared_schedule=True,
    )
    cadence["room-b"]["identity"] = identity_b
    assert cadence["room-b"]["scope"] == "plan"
    assert cadence["room-b"]["schedule_active"] is False
    assert cadence["room-b"]["shared_schedule_participating"] is True

    entered = asyncio.Event()
    release = asyncio.Event()

    async def hold_preflight(*_args) -> None:
        entered.set()
        await release.wait()

    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        {
            "plan_id": "quick_clean",
            "return_to_base": False,
            "start_timeout": 120,
            "completion_timeout": 21600,
        },
    )
    with patch(
        "custom_components.matic_robot.managed_executor._ensure_stop_settled",
        new=hold_preflight,
    ):
        task = asyncio.create_task(
            _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.test",
                "serial",
                [room_b],
                cadence_by_room=cadence,
            )
        )
        await entered.wait()
        try:
            with pytest.raises(ValueError, match="shared room cadence is reserved"):
                await manager.async_save_plan(
                    "serial",
                    "created-b",
                    _plan("room-b", scope="shared"),
                    floor_token=floor_token,
                    room_identities={"room-b": identity_b},
                )
            # The reservation is room-specific; an unrelated shared schedule
            # remains editable while this one-off waits at the stop fence.
            await manager.async_save_plan(
                "serial",
                "created-c",
                _plan("room-c", scope="shared"),
                floor_token=floor_token,
                room_identities={"room-c": identity_c},
            )
            assert "room-b" not in manager._robot("serial")["shared_room_cadence"]
            assert "room-c" in manager._robot("serial")["shared_room_cadence"]
        finally:
            manager.request_stop("serial")
            release.set()
            await task


async def test_non_opted_in_inactive_room_does_not_reserve_future_shared_schedule(
    hass,
) -> None:
    manager = _manager(hass)
    floor_token = "a" * 64
    identity = "b" * 64
    room = CleaningRoom("room-b", "Room B", "vacuum", "standard")
    _effective, cadence = manager.resolve_cadence(
        "serial",
        "quick_clean",
        [room],
        floor_token=floor_token,
        room_identities={"room-b": identity},
        use_shared_schedule=False,
    )
    assert cadence["room-b"]["schedule_active"] is False
    assert cadence["room-b"]["shared_schedule_participating"] is False
    manager.reserve_prepared_run(
        "serial", "quick_clean", "run-private", ["room-b"], cadence
    )

    await manager.async_save_plan(
        "serial",
        "created-b",
        _plan("room-b", scope="shared"),
        floor_token=floor_token,
        room_identities={"room-b": identity},
    )

    assert "room-b" in manager._robot("serial")["shared_room_cadence"]
    manager.release_prepared_run("serial", "run-private")


async def test_saved_plan_stop_edits_apply_to_future_runs_not_active_run(hass) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Room A", "vacuum", "standard")
    saved_plan = {
        **_plan(room.room_id),
        "finish_current_room": True,
        "finish_current_room_threshold": 50,
    }
    await manager.async_save_plan("serial", "home", saved_plan)
    entered = asyncio.Event()
    release_preflight = asyncio.Event()
    room_started = asyncio.Event()
    release_room = asyncio.Event()

    async def hold_preflight(*_args) -> None:
        entered.set()
        await release_preflight.wait()

    async def hold_room(*args, **kwargs) -> bool:
        _hass, call, room_manager = args[:3]
        serial_number = args[4]
        run_room = args[5][0]
        await room_manager.async_mark_started(
            serial_number,
            call.data["plan_id"],
            run_room,
            run_id=kwargs["run_id"],
        )
        room_started.set()
        await release_room.wait()
        return False

    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_entire_plan",
        {
            "plan_id": "home",
            "return_to_base": False,
            "start_timeout": 120,
            "completion_timeout": 21600,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.managed_executor._ensure_stop_settled",
            new=hold_preflight,
        ),
        patch(
            "custom_components.matic_robot.managed_executor._async_run_leg",
            new=hold_room,
        ),
    ):
        task = asyncio.create_task(
            _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.test",
                "serial",
                [room],
            )
        )
        await entered.wait()
        edited_plan = deepcopy(manager._robot("serial")["plans"]["home"])
        edited_plan["finish_current_room"] = False
        edited_plan["finish_current_room_threshold"] = 0
        await manager.async_save_plan("serial", "home", edited_plan)
        release_preflight.set()
        await room_started.wait()
        try:
            assert (
                manager.snapshot("serial")["active_plan"]["finish_current_room"] is True
            )
            assert (
                manager.snapshot("serial")["active_plan"][
                    "finish_current_room_threshold"
                ]
                == 50
            )
            assert manager.request_stop("serial").behavior == "after_room"
        finally:
            release_room.set()
            await task


async def test_restart_restores_frozen_stop_policy_after_saved_plan_edit(hass) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Room A", "vacuum", "standard")
    saved_plan = {
        **_plan(room.room_id),
        "finish_current_room": True,
        "finish_current_room_threshold": 70,
    }
    await manager.async_save_plan("serial", "home", saved_plan)
    manager.reserve_prepared_run("serial", "home", "run-frozen", [room.room_id])
    stop_enabled, stop_threshold = manager.prepared_run_stop_policy(
        "serial", "run-frozen"
    )
    await manager.async_begin_run(
        "serial",
        "home",
        "run-frozen",
        1,
        trigger="user",
        service="clean_entire_plan",
        finish_current_room=stop_enabled,
        finish_current_room_threshold=stop_threshold,
    )
    checkpoint = {
        "version": 1,
        "phase": "accepted",
        "rooms": [
            {
                "room_id": room.room_id,
                "name": room.name,
                "cleaning_mode": room.cleaning_mode,
                "coverage_setting": room.coverage_setting,
            }
        ],
        "finish_current_room": stop_enabled,
        "finish_current_room_threshold": stop_threshold,
    }
    await manager.async_set_recovery_checkpoint("serial", "run-frozen", checkpoint)
    await manager.async_mark_started("serial", "home", room, run_id="run-frozen")
    edited_plan = deepcopy(manager._robot("serial")["plans"]["home"])
    edited_plan["finish_current_room"] = False
    edited_plan["finish_current_room_threshold"] = 10
    await manager.async_save_plan("serial", "home", edited_plan)

    stored = deepcopy(manager._data)
    recovered = _manager(hass)
    recovered._store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    await recovered.async_load()
    await recovered.lock("serial").acquire()
    try:
        decision = recovered.request_stop("serial")
    finally:
        recovered.lock("serial").release()

    assert decision.behavior == "after_room"
    assert decision.threshold == 70
    assert recovered._prepared_runs["serial"].finish_current_room is True
    assert recovered._prepared_runs["serial"].finish_current_room_threshold == 70


async def test_inflight_shared_write_blocks_a_run_in_another_plan(hass) -> None:
    manager = _manager(hass)
    floor_token = "a" * 64
    identity = "b" * 64
    shared = _plan("room-b", scope="shared")
    for plan_id in ("home", "other"):
        await manager.async_save_plan(
            "serial",
            plan_id,
            shared,
            floor_token=floor_token,
            room_identities={"room-b": identity},
        )
    entered = asyncio.Event()
    release = asyncio.Event()

    async def pause_save(_data) -> None:
        entered.set()
        await release.wait()

    manager._store.async_save = pause_save
    changed = _plan("room-b", scope="shared")
    changed["rooms"][0]["cadence"]["mop_every_n"] = 4
    save_task = asyncio.create_task(
        manager.async_save_plan(
            "serial",
            "other",
            changed,
            floor_token=floor_token,
            room_identities={"room-b": identity},
        )
    )
    await entered.wait()
    try:
        with pytest.raises(HomeAssistantError, match="shared cadence is being saved"):
            manager.reserve_prepared_run("serial", "home", "run-shared", ["room-b"])
    finally:
        release.set()
    await save_task
    manager._store.async_save = AsyncMock()
    manager.reserve_prepared_run("serial", "home", "run-after-save", ["room-b"])
    manager.release_prepared_run("serial", "run-after-save")


async def test_executor_maps_a_conflicting_restored_reservation_to_validation_error(
    hass,
) -> None:
    manager = _manager(hass)
    manager.reserve_prepared_run("serial", "home", "restored-run", ["room-a"])
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        {
            "plan_id": "home",
            "return_to_base": False,
            "start_timeout": 120,
            "completion_timeout": 21600,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.managed_executor._ensure_stop_settled",
            new=AsyncMock(),
        ) as stop_settlement,
        pytest.raises(ServiceValidationError, match="already owns the robot"),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.test",
            "serial",
            [CleaningRoom("room-b", "Room B", "vacuum", "standard")],
        )

    stop_settlement.assert_not_awaited()
    assert manager._prepared_runs["serial"].run_id == "restored-run"


async def test_inflight_failed_cadence_write_cannot_seed_a_run(hass) -> None:
    manager = _manager(hass)
    await manager.async_save_plan("serial", "home", _plan("room-a"))
    entered = asyncio.Event()
    release = asyncio.Event()

    async def fail_after_pause(_data) -> None:
        entered.set()
        await release.wait()
        raise OSError("synthetic persistence failure")

    manager._store.async_save = fail_after_pause
    updated = _plan("room-a")
    updated["rooms"][0]["cadence"] = {"scope": "plan", "mop_every_n": 4}
    task = asyncio.create_task(manager.async_save_plan("serial", "home", updated))
    await entered.wait()
    try:
        with pytest.raises(HomeAssistantError, match="being saved"):
            manager.reserve_prepared_run("serial", "home", "run-one", ["room-a"])
    finally:
        release.set()
    with pytest.raises(OSError, match="synthetic persistence failure"):
        await task

    manager._store.async_save = AsyncMock()
    manager.reserve_prepared_run("serial", "home", "run-two", ["room-a"])
    manager.release_prepared_run("serial", "run-two")


async def test_recovery_restores_reservation_from_durable_checkpoint(hass) -> None:
    manager = _manager(hass)
    robot = manager._robot("serial")
    robot["plans"]["home"] = _plan("room-a", "room-b")
    robot["last_run"] = {
        "plan_id": "home",
        "run_id": "recovered-run",
        "outcome": "running",
        "recovery_checkpoint": {
            "rooms": [
                {"room_id": "room-a"},
                {"room_id": "room-b"},
            ],
            "cadence_by_room": {
                "room-a": {"scope": "plan", "identity": "room-a-identity"},
                "room-b": {
                    "scope": "plan",
                    "identity": "room-b-identity",
                    "shared_schedule_participating": True,
                },
            },
        },
    }
    stored = {"robots": {"serial": robot}}
    manager._store.async_load = AsyncMock(return_value=stored)

    await manager.async_load()

    assert manager._prepared_runs["serial"].run_id == "recovered-run"
    assert manager._prepared_runs["serial"].shared_schedule_rooms == {"room-b"}
    with pytest.raises(ValueError, match="reserved"):
        await manager.async_reset_cadence("serial", "home", ["room-b"])
    manager.release_prepared_run("serial", "recovered-run")


async def test_rejected_restart_recovery_releases_restored_reservation(hass) -> None:
    manager, entry, _checkpoint, room = await restart_recovery_fixture.__wrapped__(hass)
    manager._robot("serial")["plans"]["plan"] = {
        "name": "Home",
        "rooms": [
            {
                "room_id": room.room_id,
                "name": room.name,
                "cadence": {"scope": "plan", "mop_every_n": 3},
            }
        ],
    }
    # Match async_load's durable-checkpoint restoration before recovery runs.
    manager.restore_prepared_run("serial", "plan", "run", [room.room_id])
    manager._robot("serial")["last_run"]["recovery_checkpoint"]["phase"] = "ready"

    with patch(
        "custom_components.matic_robot.restart._async_execute_rooms",
        new=AsyncMock(),
    ) as executor:
        await async_recover_managed_run(hass, entry, "serial")

    executor.assert_not_awaited()
    assert manager.recovery_run("serial") is None
    assert "serial" not in manager._prepared_runs
    await manager.async_reset_cadence("serial", "plan", [room.room_id])


def test_prepared_stop_policy_requires_the_owning_run(hass) -> None:
    manager = _manager(hass)
    manager.reserve_prepared_run("serial", "home", "run-one", ["room-a"])

    with pytest.raises(HomeAssistantError, match="does not own"):
        manager.prepared_run_stop_policy("serial", "run-two")

    assert manager.prepared_run_stop_policy("serial", "run-one") == (False, 50)


async def test_request_stop_uses_matching_recovery_checkpoint_policy(hass) -> None:
    manager = _manager(hass)
    robot = manager._robot("serial")
    robot["plans"]["home"] = {
        "finish_current_room": False,
        "finish_current_room_threshold": 100,
    }
    robot["active_plan"] = {
        "plan_id": "home",
        "room_id": "room-a",
        "run_id": "run-one",
        "started": dt_util.utcnow().isoformat(),
    }
    checkpoint = {
        "finish_current_room": True,
        "finish_current_room_threshold": 0,
    }
    robot["last_run"] = {
        "plan_id": "home",
        "run_id": "run-one",
        "recovery_checkpoint": checkpoint,
    }
    async with manager.lock("serial"):
        decision = manager.request_stop("serial")

    assert decision.threshold == 0
    assert decision.behavior == "after_room"


async def test_request_stop_fails_closed_for_invalid_persisted_plan(hass) -> None:
    manager = _manager(hass)
    robot = manager._robot("serial")
    robot["plans"]["damaged"] = None
    robot["active_plan"] = {
        "plan_id": "damaged",
        "room_id": "room-a",
        "started": dt_util.utcnow().isoformat(),
    }

    async with manager.lock("serial"):
        decision = manager.request_stop("serial")

    assert decision.behavior == "immediate"


def test_invalid_persisted_stop_policy_uses_safe_defaults() -> None:
    assert _managed_stop_policy(None) == (False, 50)


async def test_prepared_preview_rejection_cleans_reservation_before_dispatch(
    hass,
) -> None:
    manager = _manager(hass)
    await manager.async_save_plan("serial", "home", _plan("room-a"))
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        {
            "plan_id": "home",
            "return_to_base": False,
            "start_timeout": 120,
            "completion_timeout": 21600,
        },
    )
    validate_calls = 0

    def reject_after_checkpoint() -> None:
        nonlocal validate_calls
        validate_calls += 1
        if validate_calls == 2:
            raise ValueError("preview changed")

    with (
        patch(
            "custom_components.matic_robot.managed_executor._ensure_stop_settled",
            new=AsyncMock(),
        ),
        patch(
            "custom_components.matic_robot.managed_executor._async_run_leg"
        ) as run_leg,
        pytest.raises(ValueError, match="preview changed"),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.test",
            "serial",
            [CleaningRoom("room-a", "Room A", "vacuum", "standard")],
            floor_token="synthetic-floor-token",
            session_identity=AsyncMock(return_value=b"native-session"),
            validate_prepared_run=reject_after_checkpoint,
        )

    assert validate_calls == 2
    run_leg.assert_not_awaited()
    assert "serial" not in manager._prepared_runs
