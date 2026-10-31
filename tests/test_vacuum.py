"""Motion arbitration tests for the Matic vacuum entity."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot import vacuum
from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    binding_for_floor_plan,
)
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    UserCommand,
)
from custom_components.matic_robot.client.exceptions import (
    CoverageGuardError,
    CoverageGuardReason,
    MaticError,
    SinkLocationUnavailableError,
)
from custom_components.matic_robot.client.mission import decode_mission_client_state
from custom_components.matic_robot.const import MAX_ROOM_SEQUENCE_SIZE
from custom_components.matic_robot.plan_model import (
    PLAN_FLOOR_TOKEN,
    PLAN_MOTION_TOKEN,
    PLAN_SESSION_ID,
    CleaningRoom,
    plan_area_fingerprint,
    plan_floor_token,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.run_control import ManagedMotionReplacedError
from tests.test_entities import _entry
from tests.test_mission import _labeled as _labeled_floor
from tests.test_mission import _state as _mission_client_state


async def test_queued_return_cannot_dock_newer_motion(hass) -> None:
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial = "synthetic-serial"
    entity = vacuum.MaticVacuum(entry)
    lock = manager.control.command_lock(serial)
    await lock.acquire()
    task = asyncio.create_task(entity.async_return_to_base())
    try:
        for _ in range(30):
            waiters = getattr(lock, "_waiters", None)
            if waiters and any(not waiter.done() for waiter in waiters):
                break
            await asyncio.sleep(0)
        else:
            pytest.fail("Return-to-base did not queue")
        # A previously admitted clean changes ownership while Return waits.
        manager.control.begin_managed_motion(serial)
        lock.release()
        with pytest.raises(ServiceValidationError, match="superseded"):
            await task
        entry.runtime_data.coordinator.client.async_send_user_command.assert_not_awaited()
        await entity.async_return_to_base()
        entry.runtime_data.coordinator.client.async_send_user_command.assert_awaited_once_with(
            UserCommand.DOCK
        )
    finally:
        if lock.locked():
            lock.release()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("command", ["start", "clean_rooms"])
@pytest.mark.parametrize("coherent", [True, False])
async def test_numeric_floor_label_preserves_map_command_guard(command, coherent):
    """A display fallback neither blocks a verified floor nor authorizes a stale map."""
    entry = _entry()
    floor_plan = entry.runtime_data.coordinator.data.floor_plan
    labeled = _labeled_floor(floor_plan.mission_id, 5)
    decoded = decode_mission_client_state(
        _mission_client_state(active=labeled, canonical=(labeled,))
    )
    entry.runtime_data.coordinator.data = replace(
        entry.runtime_data.coordinator.data,
        floor_plan=replace(
            floor_plan,
            floor_label=decoded.active_floor.label,
            mapped_floors=decoded.mapped_floors,
        ),
    )
    entry.runtime_data.slam_map.floor_plan_is_current.return_value = coherent
    entity = vacuum.MaticVacuum(entry)
    operation = (
        entity.async_start()
        if command == "start"
        else entity.async_send_command("clean_rooms", {"rooms": ["Study"]})
    )

    if coherent:
        await operation
        entry.runtime_data.coordinator.client.async_start_coverage.assert_awaited_once()
        assert (
            entry.runtime_data.coordinator.client.async_start_coverage.await_args.args[
                0
            ].mission_id
            == floor_plan.mission_id
        )
    else:
        with pytest.raises(ServiceValidationError) as error:
            await operation
        assert error.value.translation_key == "room_plan_unavailable"
        entry.runtime_data.coordinator.client.async_start_coverage.assert_not_awaited()
    entry.runtime_data.coordinator.client.async_send_user_command.assert_not_awaited()


async def test_managed_clean_token_is_required_until_external_replacement(hass) -> None:
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    token = manager.control.begin_managed_motion("synthetic-serial")
    session_id = "11111111-1111-4111-8111-111111111111"

    await entity.async_send_command(
        "clean_rooms",
        {"rooms": ["Study"], PLAN_MOTION_TOKEN: token, PLAN_SESSION_ID: session_id},
    )
    assert manager.control.managed_motion_is_current("synthetic-serial", token) is True
    assert (
        entry.runtime_data.coordinator.client.async_start_coverage.await_args.kwargs[
            "require_settings_readback"
        ]
        is True
    )
    assert entry.runtime_data.coordinator.client.async_start_coverage.await_args.kwargs[
        "session_id"
    ].hex == session_id.replace("-", "")

    await entity.async_send_command("clean_all")
    assert manager.control.managed_motion_is_current("synthetic-serial", token) is False
    with pytest.raises(ManagedMotionReplacedError):
        await entity.async_send_command(
            "clean_rooms",
            {"rooms": ["Study"], PLAN_MOTION_TOKEN: token, PLAN_SESSION_ID: session_id},
        )


async def test_explicit_vacuum_room_lists_share_the_sequence_limit(hass) -> None:
    entry = _entry()
    state = entry.runtime_data.coordinator.data
    floor_plan = state.floor_plan
    template = floor_plan.rooms[0]
    rooms = tuple(
        replace(
            template,
            id=f"room-{index}",
            name=f"Room {index}",
            protocol_id=f"protocol-{index}",
            id_wire=f"room-{index}".encode(),
        )
        for index in range(1, MAX_ROOM_SEQUENCE_SIZE + 2)
    )
    entry.runtime_data.coordinator.data = replace(
        state,
        floor_plan=replace(floor_plan, rooms=rooms),
    )
    entity = vacuum.MaticVacuum(entry)
    run = AsyncMock()

    with patch.object(entity, "_async_clean_rooms", run):
        await entity.async_send_command(
            "clean_rooms",
            {"rooms": [room.id for room in rooms[:MAX_ROOM_SEQUENCE_SIZE]]},
        )
        assert len(run.await_args.args[0]) == MAX_ROOM_SEQUENCE_SIZE
        run.reset_mock()
        with pytest.raises(ServiceValidationError) as raised:
            await entity.async_send_command(
                "clean_rooms", {"rooms": [room.id for room in rooms]}
            )

    assert raised.value.translation_key == "room_sequence_limit"
    run.assert_not_awaited()


async def test_managed_clean_token_rejects_non_integer_values(hass) -> None:
    entry = _entry()
    entry.runtime_data.cleaning_plans = CleaningPlanManager(hass)
    entity = vacuum.MaticVacuum(entry)

    for value in (True, "1"):
        with pytest.raises(ServiceValidationError, match="token is invalid"):
            await entity.async_send_command("clean_all", {PLAN_MOTION_TOKEN: value})

    for value in (True, "not-a-token", "A" * 64):
        with pytest.raises(ServiceValidationError, match="floor token is invalid"):
            await entity.async_send_command("clean_all", {PLAN_FLOOR_TOKEN: value})


async def test_managed_session_marker_is_private_and_canonical(hass) -> None:
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    valid_session = "abcdefab-cdef-4abc-8def-abcdefabcdef"
    token = manager.control.begin_managed_motion("synthetic-serial")

    for value in (1, "not-a-uuid", valid_session.upper()):
        with pytest.raises(ServiceValidationError, match="session ID is invalid"):
            await entity.async_send_command(
                "clean_rooms", {"rooms": ["Study"], PLAN_SESSION_ID: value}
            )

    with pytest.raises(ServiceValidationError, match="invalid for this room command"):
        await entity.async_send_command(
            "clean_rooms", {"rooms": ["Study"], PLAN_SESSION_ID: valid_session}
        )
    with pytest.raises(ServiceValidationError, match="has no session ID"):
        await entity.async_send_command(
            "clean_rooms", {"rooms": ["Study"], PLAN_MOTION_TOKEN: token}
        )
    with pytest.raises(ServiceValidationError, match="has no session ID"):
        await entity.async_send_command(
            "clean_rooms",
            {
                "rooms": ["Study"],
                PLAN_MOTION_TOKEN: token,
                "room_coverage": ["quick"],
                "room_modes": ["vacuum"],
            },
        )
    with pytest.raises(ServiceValidationError, match="requires a managed room command"):
        await entity.async_send_command("clean_all", {PLAN_SESSION_ID: valid_session})


@pytest.mark.parametrize(
    "change",
    [
        "coherence",
        "identity",
        "partition",
        "partition_wire",
        "room_id",
        "room_protocol",
        "room_wire",
        "removed_room",
    ],
)
async def test_managed_clean_rechecks_floor_inside_command_lock(
    hass, change: str
) -> None:
    """A queued native command cannot outlive its exact coherent map."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    floor_plan = entry.runtime_data.coordinator.data.floor_plan
    assert floor_plan is not None
    motion_token = manager.control.begin_managed_motion("synthetic-serial")
    session_id = "22222222-2222-4222-8222-222222222222"
    command_lock = manager.control.command_lock("synthetic-serial")
    await command_lock.acquire()

    task = asyncio.create_task(
        entity.async_send_command(
            "clean_rooms",
            {
                "rooms": ["Study"],
                PLAN_MOTION_TOKEN: motion_token,
                PLAN_FLOOR_TOKEN: plan_floor_token(floor_plan),
                PLAN_SESSION_ID: session_id,
            },
        )
    )
    await asyncio.sleep(0)
    if change == "coherence":
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
    else:
        if change == "identity":
            updated = replace(floor_plan, mission_id=floor_plan.mission_id + 1)
        elif change == "partition":
            updated = replace(floor_plan, partition_protocol_id="replacement-partition")
        elif change == "partition_wire":
            updated = replace(floor_plan, partition_id_wire=b"replacement-partition")
        elif change == "removed_room":
            updated = replace(floor_plan, rooms=floor_plan.rooms[:1])
        else:
            field, value = {
                "room_id": ("id", "replacement-room"),
                "room_protocol": ("protocol_id", "replacement-room"),
                "room_wire": ("id_wire", b"replacement-room"),
            }[change]
            updated = replace(
                floor_plan,
                rooms=(
                    floor_plan.rooms[0],
                    replace(floor_plan.rooms[1], **{field: value}),
                ),
            )
        entry.runtime_data.coordinator.data = replace(
            entry.runtime_data.coordinator.data,
            floor_plan=updated,
        )
    command_lock.release()

    with pytest.raises(ServiceValidationError) as excinfo:
        await task
    assert excinfo.value.translation_key == "room_plan_unavailable"
    entry.runtime_data.coordinator.client.async_start_coverage.assert_not_awaited()


@pytest.mark.parametrize(
    "change", ["refinement", "target_refinement", "vertex_order", "room_order"]
)
async def test_queued_room_clean_uses_fresh_map_after_geometry_update(hass, change):
    """Native room targets survive geometry-only updates while awaiting dispatch."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    floor = entry.runtime_data.coordinator.data.floor_plan
    assert floor is not None
    token = manager.control.begin_managed_motion("synthetic-serial")
    lock = manager.control.command_lock("synthetic-serial")
    await lock.acquire()
    task = asyncio.create_task(
        entity.async_send_command(
            "clean_rooms",
            {
                "rooms": ["Study"],
                PLAN_MOTION_TOKEN: token,
                PLAN_FLOOR_TOKEN: plan_floor_token(floor),
                PLAN_SESSION_ID: "33333333-3333-4333-8333-333333333333",
            },
        )
    )
    await asyncio.sleep(0)
    if change == "room_order":
        updated = replace(floor, rooms=tuple(reversed(floor.rooms)))
    else:
        room_index = 1 if change == "target_refinement" else 0
        room = floor.rooms[room_index]
        boundary = (
            tuple((x + 0.025, y) for x, y in room.boundary)
            if change in {"refinement", "target_refinement"}
            else tuple(reversed(room.boundary))
        )
        updated = replace(
            floor,
            rooms=tuple(
                replace(item, boundary=boundary) if index == room_index else item
                for index, item in enumerate(floor.rooms)
            ),
        )
    entry.runtime_data.coordinator.data = replace(
        entry.runtime_data.coordinator.data,
        floor_plan=updated,
    )
    lock.release()
    await task
    dispatched = entry.runtime_data.coordinator.client.async_start_coverage.await_args
    assert dispatched.args[0] is updated
    assert dispatched.args[1] == ["protocol-2"]
    assert manager.control.managed_motion_is_current("synthetic-serial", token)


async def test_room_commands_prefer_stable_ids_and_reject_ambiguous_names() -> None:
    entry = _entry()
    floor_plan = entry.runtime_data.coordinator.data.floor_plan
    assert floor_plan is not None
    entry.runtime_data.coordinator.data = replace(
        entry.runtime_data.coordinator.data,
        floor_plan=replace(
            floor_plan,
            rooms=(
                replace(
                    floor_plan.rooms[0],
                    id="stable-bedroom",
                    name="Primary Bedroom",
                ),
                replace(floor_plan.rooms[1], name="stable-bedroom"),
            ),
        ),
    )
    entity = vacuum.MaticVacuum(entry)

    await entity.async_send_command("clean_rooms", {"rooms": ["stable-bedroom"]})
    call = entry.runtime_data.coordinator.client.async_start_coverage.await_args
    assert call.args[1] == ["protocol-1"]

    entry.runtime_data.coordinator.data = replace(
        entry.runtime_data.coordinator.data,
        floor_plan=replace(
            entry.runtime_data.coordinator.data.floor_plan,
            rooms=(
                replace(floor_plan.rooms[0], name="Bedroom"),
                replace(floor_plan.rooms[1], name="BEDROOM"),
            ),
        ),
    )
    with pytest.raises(ServiceValidationError, match="ambiguous room name"):
        await entity.async_send_command("clean_rooms", {"rooms": ["Bedroom"]})


@pytest.mark.parametrize(
    "operational_changes",
    [
        {"cleaning": False, "returning": True},
        {"cleaning": False, "error_codes": (327,)},
        {"cleaning": False, "charging": True, "low_charge": True},
        {"cleaning": True, "charging": True, "low_charge": False},
        {"cleaning": True, "charging_idle": True, "low_charge": False},
        {"cleaning": False, "paused": True, "charging": True},
        {"cleaning": False, "paused": True, "charging": True, "error_codes": (999,)},
    ],
)
async def test_return_to_base_stops_resumable_firmware_task(
    hass, operational_changes
) -> None:
    """OEM STOP owns the graceful return after an active task."""
    entry = _entry(idle=True)
    state = entry.runtime_data.coordinator.data
    entry.runtime_data.coordinator.data = replace(
        state,
        operational=replace(state.operational, **operational_changes),
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)

    await entity.async_return_to_base()

    client = entry.runtime_data.coordinator.client
    assert [
        item.args[0] for item in client.async_send_user_command.await_args_list
    ] == [UserCommand.STOP]
    assert "stop_fence_expires_at" in manager.repository.robot("synthetic-serial")
    manager.repository.store.async_save.assert_awaited_once()


async def test_return_to_base_stops_idle_robot_with_managed_plan(hass) -> None:
    """Persisted managed ownership also uses OEM STOP for the final return."""
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    lock = manager.control.lock("synthetic-serial")
    await lock.acquire()
    try:
        await entity.async_return_to_base()
    finally:
        lock.release()

    client = entry.runtime_data.coordinator.client
    assert [
        item.args[0] for item in client.async_send_user_command.await_args_list
    ] == [UserCommand.STOP]
    assert "stop_fence_expires_at" in manager.repository.robot("synthetic-serial")
    manager.repository.store.async_save.assert_awaited_once()


@pytest.mark.parametrize("action", ["async_stop", "async_return_to_base"])
async def test_entity_stop_persists_original_run_owner(hass, action):
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    await manager.ledger.async_begin_run(
        "synthetic-serial",
        "plan",
        "run",
        1,
        trigger="user",
        service="run_selected_plan",
    )
    await manager.ledger.async_mark_started(
        "synthetic-serial",
        "plan",
        CleaningRoom("kitchen", "Kitchen", "vacuum", "standard"),
        run_id="run",
    )
    entity = vacuum.MaticVacuum(entry)
    await getattr(entity, action)()
    restored = CleaningPlanManager(hass)
    restored.repository.store = SimpleNamespace(
        async_save=AsyncMock(),
        async_load=AsyncMock(return_value=deepcopy(manager.repository.data)),
    )
    await restored.async_load()
    assert restored.control.pending_stop_run_id("synthetic-serial") == "run"
    entry.runtime_data.coordinator.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )


@pytest.mark.parametrize(
    ("action", "managed_stop_dispatch", "expected_reason"),
    [
        ("async_stop", True, "managed_stop"),
        ("async_return_to_base", True, "managed_stop"),
        ("async_return_to_base", False, "motion_replaced"),
    ],
)
async def test_stop_dispatch_preserves_managed_stop_reason(
    hass, action, managed_stop_dispatch, expected_reason
) -> None:
    """A dispatched STOP keeps the managed cancellation classification."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    await manager.catalog.async_save_plan(
        serial_number,
        "plan",
        {
            "name": "Plan",
            "enabled": True,
            "finish_current_room": False,
            "rooms": [],
        },
    )
    await manager.ledger.async_begin_run(
        serial_number,
        "plan",
        "run",
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=False,
    )
    await manager.ledger.async_mark_started(
        serial_number,
        "plan",
        CleaningRoom("kitchen", "Kitchen", "vacuum", "standard"),
        run_id="run",
    )
    manager.control.begin_managed_motion(serial_number)
    entity = vacuum.MaticVacuum(entry)
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    try:
        manager.control.mark_managed_stop(serial_number)
        if managed_stop_dispatch:
            with manager.control.managed_stop_dispatch(serial_number):
                await getattr(entity, action)()
        else:
            await getattr(entity, action)()
    finally:
        plan_lock.release()

    assert manager.control.cancellation_reason(serial_number) == expected_reason
    entry.runtime_data.coordinator.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )


async def test_stop_marks_oem_fence_and_blocks_new_motion_until_docked(hass) -> None:
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    entity.entity_id = "vacuum.test"
    entity.hass = hass
    native_active = AsyncMock(return_value=False)
    entry.runtime_data.coordinator.client.async_get_active_cleaning_session_state = (
        native_active
    )
    entry.runtime_data.coordinator.client.async_get_state = AsyncMock(
        return_value=replace(
            entry.runtime_data.coordinator.data.operational, charging=True
        )
    )

    await entity.async_stop()
    assert manager.control.stop_pending("synthetic-serial") is True
    assert "stop_fence_expires_at" in manager.repository.robot("synthetic-serial")
    manager.repository.store.async_save.assert_awaited_once()
    state = entry.runtime_data.coordinator.data
    entry.runtime_data.coordinator.data = replace(
        state,
        operational=replace(
            state.operational,
            cleaning=True,
            charging=False,
            returning=False,
        ),
    )
    hass.states.async_set("vacuum.test", "cleaning")
    with pytest.raises(ServiceValidationError) as blocked:
        await entity._async_ensure_stop_settled("synthetic-serial")
    assert blocked.value.translation_key == "robot_stop_pending"

    state = entry.runtime_data.coordinator.data
    entry.runtime_data.coordinator.data = replace(
        state,
        operational=replace(
            state.operational,
            cleaning=False,
            charging=True,
            returning=False,
        ),
    )
    hass.states.async_set("vacuum.test", "charging")
    native_active.return_value = True
    with pytest.raises(ServiceValidationError) as native_blocked:
        await entity._async_ensure_stop_settled("synthetic-serial")
    assert native_blocked.value.translation_key == "robot_stop_pending"
    assert manager.control.stop_pending("synthetic-serial") is True

    native_active.return_value = False
    await entity._async_ensure_stop_settled("synthetic-serial")
    assert manager.control.stop_pending("synthetic-serial") is False
    assert "stop_fence_expires_at" not in manager.repository.robot("synthetic-serial")
    assert manager.repository.store.async_save.await_count == 2


async def test_queued_stop_fence_is_rechecked_inside_command_lock(hass) -> None:
    """Commands queued behind STOP cannot bypass its newly created fence."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    lock = manager.control.command_lock("synthetic-serial")
    await lock.acquire()

    async def wait_for_queued_commands(count: int) -> None:
        for _ in range(30):
            waiters = getattr(lock, "_waiters", None)
            if (
                waiters is not None
                and sum(not waiter.done() for waiter in waiters) >= count
            ):
                return
            await asyncio.sleep(0)
        pytest.fail(f"{count} commands did not reach the command lock")

    stop_task = asyncio.create_task(entity.async_stop())
    await wait_for_queued_commands(1)
    clean_task = asyncio.create_task(entity.async_start())
    await wait_for_queued_commands(2)
    pause_task = asyncio.create_task(entity.async_pause())
    await wait_for_queued_commands(3)
    lock.release()

    await stop_task
    for task in (clean_task, pause_task):
        with pytest.raises(ServiceValidationError) as blocked:
            await task
        assert blocked.value.translation_key == "robot_stop_pending"

    client = entry.runtime_data.coordinator.client
    assert [
        item.args[0] for item in client.async_send_user_command.await_args_list
    ] == [UserCommand.STOP]
    client.async_start_coverage.assert_not_awaited()


async def test_unload_drains_accepted_stop_before_closing_metadata(hass) -> None:
    """An admitted policy decision and checkpoint finish across teardown."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    checkpoint_started = asyncio.Event()
    release_checkpoint = asyncio.Event()
    entered_send = asyncio.Event()
    release_send = asyncio.Event()
    client = entry.runtime_data.coordinator.client
    checkpoint = manager.ledger.async_checkpoint_stop_intent

    async def delayed_checkpoint(serial_number: str, behavior: str, **kwargs) -> None:
        checkpoint_started.set()
        await release_checkpoint.wait()
        await checkpoint(serial_number, behavior, **kwargs)

    manager.ledger.async_checkpoint_stop_intent = delayed_checkpoint

    async def delayed_send(command: UserCommand) -> None:
        assert command is UserCommand.STOP
        entered_send.set()
        await release_send.wait()

    client.async_send_user_command.side_effect = delayed_send
    stop = asyncio.create_task(entity.async_stop())
    close: asyncio.Task[None] | None = None
    try:
        await checkpoint_started.wait()
        manager.control.begin_command_teardown("synthetic-serial")
        release_checkpoint.set()
        await entered_send.wait()
        close = asyncio.create_task(
            manager.control.async_close_command_admission_and_wait("synthetic-serial")
        )
        await asyncio.sleep(0)
        assert not close.done()

        release_send.set()
        await stop
        await close
        assert manager.control.stop_pending("synthetic-serial")
        assert manager.control.command_admission_open("synthetic-serial") is False
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            await entity._async_command(UserCommand.PAUSE)
        assert [
            call.args[0] for call in client.async_send_user_command.call_args_list
        ] == [UserCommand.STOP]
    finally:
        release_checkpoint.set()
        release_send.set()
        pending = [stop]
        if close is not None:
            pending.append(close)
        await asyncio.gather(*pending, return_exceptions=True)


async def test_stop_retains_run_id_when_run_finishes_during_checkpoint(hass) -> None:
    """The accepted Stop owns its run correlation across checkpoint waits."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    await manager.ledger.async_begin_run(
        serial_number,
        "plan",
        "run",
        1,
        trigger="user",
        service="run_selected_plan",
    )
    await manager.ledger.async_mark_started(
        serial_number,
        "plan",
        CleaningRoom("kitchen", "Kitchen", "vacuum", "standard"),
        run_id="run",
    )
    entity = vacuum.MaticVacuum(entry)
    entity.entity_id = "vacuum.test"
    entity.hass = hass
    checkpoint = manager.ledger.async_checkpoint_stop_intent
    checkpoint_started = asyncio.Event()
    release_checkpoint = asyncio.Event()

    async def delayed_checkpoint(serial: str, behavior: str, **kwargs) -> None:
        checkpoint_started.set()
        await release_checkpoint.wait()
        await checkpoint(serial, behavior, **kwargs)

    manager.ledger.async_checkpoint_stop_intent = delayed_checkpoint
    with patch.object(vacuum, "schedule_dock_after_stop") as schedule_dock:
        stop = asyncio.create_task(entity.async_stop())
        try:
            await checkpoint_started.wait()
            assert manager.ledger.active_run_id(serial_number) == "run"
            assert await manager.ledger.async_finish_run(
                serial_number,
                "run",
                "cancelled",
                "managed_stop",
                0,
                cause="managed_cancellation",
            )
            assert manager.ledger.active_run_id(serial_number) is None
            release_checkpoint.set()
            await stop
        finally:
            release_checkpoint.set()
            if not stop.done():
                await asyncio.gather(stop, return_exceptions=True)

    assert manager.control.pending_stop_run_id(serial_number) == "run"
    schedule_dock.assert_called_once()
    assert schedule_dock.call_args.kwargs["run_id"] == "run"
    entry.runtime_data.coordinator.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )


async def test_late_stop_after_teardown_does_not_mutate_managed_run(hass) -> None:
    """A rejected late Stop cannot alter the run it is meant to preserve."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)
    generation = manager.control.motion_generation(serial_number)
    cancellation = manager.control.cancellation_event(serial_number)
    assert not cancellation.is_set()
    manager.control.begin_command_teardown(serial_number)
    checkpoint = AsyncMock()
    manager.ledger.async_checkpoint_stop_intent = checkpoint

    with patch.object(
        manager.control, "request_stop", wraps=manager.control.request_stop
    ) as request_stop:
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            await entity.async_stop()

    request_stop.assert_not_called()
    assert manager.control.motion_generation(serial_number) == generation
    assert manager.control.managed_motion_is_current(serial_number, token)
    assert not cancellation.is_set()
    checkpoint.assert_not_awaited()
    entry.runtime_data.coordinator.client.async_send_user_command.assert_not_awaited()


async def test_after_room_stop_keeps_managed_owner(hass) -> None:
    """The graceful policy checkpoints intent without replacing the active run."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)
    decision = SimpleNamespace(behavior="after_room")

    with (
        patch.object(
            manager.control, "request_stop", return_value=decision
        ) as request_stop,
        patch.object(
            manager.ledger, "async_checkpoint_stop_intent", new_callable=AsyncMock
        ) as checkpoint,
    ):
        await entity.async_stop()

    request_stop.assert_called_once_with(serial_number)
    checkpoint.assert_awaited_once_with(serial_number, "after_room", run_id=None)
    assert manager.control.managed_motion_is_current(serial_number, token)
    entry.runtime_data.coordinator.client.async_send_user_command.assert_not_awaited()


async def test_queued_stop_rechecks_teardown_before_stop_policy(hass) -> None:
    """A Stop queued before teardown is rejected before changing plan state."""
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    serial_number = "synthetic-serial"
    lock = manager.control.command_lock(serial_number)
    await lock.acquire()

    async def wait_for_command_waiter() -> None:
        for _ in range(30):
            waiters = getattr(lock, "_waiters", None)
            if waiters is not None and any(not waiter.done() for waiter in waiters):
                return
            await asyncio.sleep(0)
        pytest.fail("Stop did not reach the command lock")

    with patch.object(
        manager.control, "request_stop", wraps=manager.control.request_stop
    ) as request_stop:
        stop = asyncio.create_task(entity.async_stop())
        try:
            await wait_for_command_waiter()
            generation = manager.control.motion_generation(serial_number)
            manager.control.begin_command_teardown(serial_number)
        finally:
            lock.release()
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            await stop

    request_stop.assert_not_called()
    assert manager.control.motion_generation(serial_number) == generation
    assert not manager.control.cancellation_event(serial_number).is_set()
    entry.runtime_data.coordinator.client.async_send_user_command.assert_not_awaited()


async def test_admitted_coverage_finishes_after_teardown_fence(hass) -> None:
    """Teardown drains an external command admitted before the fence."""
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    client = entry.runtime_data.coordinator.client
    preflight_started = asyncio.Event()
    release_preflight = asyncio.Event()

    async def delayed_preflight(*_args, **kwargs) -> None:
        preflight_started.set()
        await release_preflight.wait()
        kwargs["require_current"]()

    client.async_start_coverage.side_effect = delayed_preflight
    start = asyncio.create_task(entity.async_start())
    try:
        await asyncio.wait_for(preflight_started.wait(), timeout=3)
        manager.control.begin_command_teardown("synthetic-serial")
        release_preflight.set()
        await start
    finally:
        release_preflight.set()
        if not start.done():
            await asyncio.gather(start, return_exceptions=True)

    client.async_start_coverage.assert_awaited_once()
    entry.runtime_data.coordinator.async_request_refresh.assert_awaited_once()


async def test_command_admission_closure_rejects_late_managed_dispatch(hass) -> None:
    """A managed task that reaches command admission after unload cannot dispatch."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    token = manager.control.begin_managed_motion("synthetic-serial")
    await manager.control.async_close_command_admission_and_wait("synthetic-serial")
    dispatch = AsyncMock()

    with pytest.raises(HomeAssistantError, match="unavailable during unload"):
        async with manager.control.managed_command("synthetic-serial", token):
            await dispatch()

    dispatch.assert_not_awaited()


@pytest.mark.parametrize(
    "command", ["resume", "clean_all", "sink_summon", "go_to_room"]
)
@pytest.mark.parametrize("waiting_check", [1, 2])
async def test_stop_cancels_undispatched_direct_motion(
    hass, command: str, waiting_check: int
) -> None:
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    entered = asyncio.Event()
    release = asyncio.Event()
    checks = 0

    async def delayed_check(_serial: str) -> None:
        nonlocal checks
        checks += 1
        if checks == waiting_check:
            entered.set()
            await release.wait()

    with patch.object(entity, "_async_ensure_stop_settled", side_effect=delayed_check):
        task = asyncio.create_task(
            entity.async_send_command(command, {"room": "Kitchen"})
        )
        await entered.wait()
        manager.control.request_stop("synthetic-serial")
        release.set()
        with pytest.raises(ServiceValidationError, match="superseded"):
            await task
    client = entry.runtime_data.coordinator.client
    client.async_start_coverage.assert_not_awaited()
    client.async_send_user_command.assert_not_awaited()
    client.async_sink_summon.assert_not_awaited()
    client.async_go_to_room.assert_not_awaited()


async def test_stop_supersedes_direct_room_clean_queued_for_command_lock(hass) -> None:
    """A queued direct room clean cannot replace a Stop issued while it waits."""
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    serial_number = "synthetic-serial"
    lock = manager.control.command_lock(serial_number)
    await lock.acquire()

    task = asyncio.create_task(
        entity.async_send_command("clean_rooms", {"rooms": ["Study"]})
    )
    for _ in range(30):
        waiters = getattr(lock, "_waiters", None)
        if waiters is not None and any(not waiter.done() for waiter in waiters):
            break
        await asyncio.sleep(0)
    else:
        lock.release()
        await task
        pytest.fail("Direct room clean never queued for the command lock")

    manager.control.request_stop(serial_number)
    lock.release()

    with pytest.raises(ServiceValidationError, match="superseded"):
        await task
    entry.runtime_data.coordinator.client.async_start_coverage.assert_not_awaited()


@pytest.mark.parametrize("command", ["clean_rooms", "resume", "return_home"])
async def test_after_room_stop_supersedes_queued_direct_motion(
    hass, command: str
) -> None:
    """A graceful Stop preserves its run and fences older direct motion."""
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    room = CleaningRoom("room-2", "Study", "vacuum", "quick")
    run_id = "synthetic-managed-run"
    token = manager.control.begin_managed_motion(serial_number)
    await manager.ledger.async_begin_run(
        serial_number,
        "plan",
        run_id,
        1,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=True,
        finish_current_room_threshold=0,
    )
    await manager.ledger.async_mark_started(serial_number, "plan", room, run_id=run_id)
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    command_lock = manager.control.command_lock(serial_number)
    await command_lock.acquire()
    entity = vacuum.MaticVacuum(entry)
    if command == "clean_rooms":
        task = asyncio.create_task(
            entity.async_send_command("clean_rooms", {"rooms": ["Study"]})
        )
    elif command == "resume":
        task = asyncio.create_task(entity.async_send_command("resume"))
    else:
        task = asyncio.create_task(entity.async_return_to_base())
    try:
        for _ in range(30):
            waiters = getattr(command_lock, "_waiters", None)
            if waiters is not None and any(not waiter.done() for waiter in waiters):
                break
            await asyncio.sleep(0)
        else:
            pytest.fail("Direct room clean never queued for the command lock")

        decision = manager.control.request_stop(serial_number)
        assert decision.behavior == "after_room"
        assert manager.control.finish_room_event(serial_number).is_set()
        assert not manager.control.cancellation_event(serial_number).is_set()

        command_lock.release()
        with pytest.raises(ServiceValidationError, match="superseded"):
            await task

        assert manager.control.managed_motion_is_current(serial_number, token)
        entry.runtime_data.coordinator.client.async_start_coverage.assert_not_awaited()
        entry.runtime_data.coordinator.client.async_send_user_command.assert_not_awaited()
    finally:
        if command_lock.locked():
            command_lock.release()
        if plan_lock.locked():
            plan_lock.release()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize(
    "held_task",
    [
        {"cleaning": True},
        {"cleaning": False, "paused": True},
        {"cleaning": True, "charging": True},
    ],
    ids=["cleaning", "paused", "docked_to_recharge"],
)
async def test_sink_summon_keeps_the_plan_driving_the_task_it_joins(
    hass, held_task: dict[str, bool]
) -> None:
    """The robot carries its task, and the owning plan, through the sink visit."""
    entry = _entry()
    state = entry.runtime_data.coordinator.data
    entry.runtime_data.coordinator.data = replace(
        state, operational=replace(state.operational, **held_task)
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    try:
        await vacuum.MaticVacuum(entry).async_send_command("sink_summon")
    finally:
        plan_lock.release()

    entry.runtime_data.coordinator.client.async_sink_summon.assert_awaited_once()
    assert manager.control.managed_motion_is_current(serial_number, token)
    assert not manager.control.cancellation_event(serial_number).is_set()


async def test_sink_summon_refuses_when_the_task_ends_while_queued(hass) -> None:
    """A task ending behind the command lock must not send motion under it."""
    entry = _entry()
    coordinator = entry.runtime_data.coordinator
    state = coordinator.data
    coordinator.data = replace(
        state, operational=replace(state.operational, cleaning=True)
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)
    command_lock = manager.control.command_lock(serial_number)
    await command_lock.acquire()
    task = asyncio.create_task(
        vacuum.MaticVacuum(entry).async_send_command("sink_summon")
    )
    try:
        for _ in range(30):
            waiters = getattr(command_lock, "_waiters", None)
            if waiters is not None and any(not waiter.done() for waiter in waiters):
                break
            await asyncio.sleep(0)
        else:
            pytest.fail("Sink summon never queued for the command lock")

        coordinator.data = replace(
            state, operational=replace(state.operational, cleaning=False)
        )
        command_lock.release()
        with pytest.raises(HomeAssistantError) as raised:
            await task
    finally:
        if command_lock.locked():
            command_lock.release()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    assert raised.value.translation_key == "robot_task_changed"
    coordinator.client.async_sink_summon.assert_not_awaited()
    assert manager.control.managed_motion_is_current(serial_number, token)


async def test_sink_summon_without_a_task_replaces_a_docked_plan(hass) -> None:
    """A plan docked between rooms holds no task, so the summon is new motion."""
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    try:
        await vacuum.MaticVacuum(entry).async_send_command("sink_summon")
    finally:
        plan_lock.release()

    entry.runtime_data.coordinator.client.async_sink_summon.assert_awaited_once()
    assert not manager.control.managed_motion_is_current(serial_number, token)
    assert manager.control.cancellation_event(serial_number).is_set()


async def test_sink_summon_decides_ownership_after_the_lookup(hass) -> None:
    """A task that ends while the sink posture is read leaves new motion."""
    entry = _entry()
    coordinator = entry.runtime_data.coordinator
    state = coordinator.data
    coordinator.data = replace(
        state, operational=replace(state.operational, cleaning=True)
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)

    async def task_ends(_floor_plan):
        coordinator.data = replace(
            state, operational=replace(state.operational, cleaning=False)
        )
        return b"synthetic-posture"

    coordinator.client.async_get_sink_posture.side_effect = task_ends
    await vacuum.MaticVacuum(entry).async_send_command("sink_summon")

    coordinator.client.async_sink_summon.assert_awaited_once()
    assert not manager.control.managed_motion_is_current(serial_number, token)


@pytest.mark.parametrize("failure", ["no_sink", "stale_map"])
async def test_sink_summon_that_cannot_go_keeps_a_docked_plan(
    hass, failure: str
) -> None:
    """A refused summon never takes ownership from a plan docked between rooms."""
    entry = _entry(idle=True)
    if failure == "no_sink":
        entry.runtime_data.coordinator.client.async_get_sink_posture.side_effect = (
            SinkLocationUnavailableError("synthetic")
        )
    else:
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)

    with pytest.raises(ServiceValidationError):
        await vacuum.MaticVacuum(entry).async_send_command("sink_summon")

    entry.runtime_data.coordinator.client.async_sink_summon.assert_not_awaited()
    assert manager.control.managed_motion_is_current(serial_number, token)
    assert not manager.control.cancellation_event(serial_number).is_set()


async def test_sink_summon_without_a_task_cancels_a_recovering_plan(hass) -> None:
    """A plan reconnecting after a restart is replaced like any direct motion."""
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    await manager.ledger.async_begin_run(
        serial_number, "plan", "run", 2, trigger="user", service="clean_entire_plan"
    )
    await manager.ledger.async_set_recovery_checkpoint(
        serial_number, "run", {"version": 1, "phase": "handoff", "leg_index": 1}
    )
    generation = manager.control.motion_generation(serial_number)

    await vacuum.MaticVacuum(entry).async_send_command("sink_summon")

    entry.runtime_data.coordinator.client.async_sink_summon.assert_awaited_once()
    assert manager.control.cancellation_event(serial_number).is_set()
    assert manager.control.motion_generation(serial_number) != generation


async def test_go_to_room_keeps_the_plan_driving_the_task_it_joins(hass) -> None:
    """Go to room follows the sink summon: a held task keeps its plan."""
    entry = _entry()
    state = entry.runtime_data.coordinator.data
    entry.runtime_data.coordinator.data = replace(
        state, operational=replace(state.operational, cleaning=True)
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    try:
        await vacuum.MaticVacuum(entry).async_go_to_room("Kitchen")
    finally:
        plan_lock.release()

    entry.runtime_data.coordinator.client.async_go_to_room.assert_awaited_once()
    assert manager.control.managed_motion_is_current(serial_number, token)
    assert not manager.control.cancellation_event(serial_number).is_set()


async def test_go_to_room_refuses_when_the_task_ends_while_queued(hass) -> None:
    entry = _entry()
    coordinator = entry.runtime_data.coordinator
    state = coordinator.data
    coordinator.data = replace(
        state, operational=replace(state.operational, paused=True, cleaning=False)
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    command_lock = manager.control.command_lock("synthetic-serial")
    await command_lock.acquire()
    task = asyncio.create_task(vacuum.MaticVacuum(entry).async_go_to_room("Kitchen"))
    try:
        for _ in range(30):
            waiters = getattr(command_lock, "_waiters", None)
            if waiters is not None and any(not waiter.done() for waiter in waiters):
                break
            await asyncio.sleep(0)
        else:
            pytest.fail("Go to room never queued for the command lock")

        coordinator.data = replace(
            state, operational=replace(state.operational, cleaning=False)
        )
        command_lock.release()
        with pytest.raises(HomeAssistantError) as raised:
            await task
    finally:
        if command_lock.locked():
            command_lock.release()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    assert raised.value.translation_key == "go_to_room_task_changed"
    coordinator.client.async_go_to_room.assert_not_awaited()


@pytest.mark.parametrize("room", ["Kitchen", "Attic"])
async def test_go_to_room_without_a_task_owns_motion_only_when_it_goes(
    hass, room: str
) -> None:
    """An unknown room is refused before it can replace a docked plan."""
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    serial_number = "synthetic-serial"
    token = manager.control.begin_managed_motion(serial_number)

    if room == "Attic":
        with pytest.raises(ServiceValidationError):
            await vacuum.MaticVacuum(entry).async_go_to_room(room)
        entry.runtime_data.coordinator.client.async_go_to_room.assert_not_awaited()
        assert manager.control.managed_motion_is_current(serial_number, token)
        return
    plan_lock = manager.control.lock(serial_number)
    await plan_lock.acquire()
    try:
        await vacuum.MaticVacuum(entry).async_go_to_room(room)
    finally:
        plan_lock.release()
    entry.runtime_data.coordinator.client.async_go_to_room.assert_awaited_once()
    assert not manager.control.managed_motion_is_current(serial_number, token)
    assert manager.control.cancellation_event(serial_number).is_set()


# Plan custom areas -----------------------------------------------------------

_AREA_SESSION = "55555555-5555-4555-8555-555555555555"


def _plan_area_vacuum(hass, area: dict | None = None):
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    entry.runtime_data.coordinator.client.async_start_custom_coverage = AsyncMock()
    floor = entry.runtime_data.coordinator.data.floor_plan
    saved = area or {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Rug",
        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_floor_plan(floor),
    }
    manager.repository.robot("synthetic-serial")["areas"]["rug"] = saved
    token = manager.control.begin_managed_motion("synthetic-serial")
    params = {
        "area": "rug",
        "fingerprint": plan_area_fingerprint(saved),
        "cleaning_mode": "vacuum_and_mop",
        "coverage": "heavy_duty",
        PLAN_MOTION_TOKEN: token,
        PLAN_SESSION_ID: _AREA_SESSION,
        PLAN_FLOOR_TOKEN: plan_floor_token(floor),
    }
    return entry, manager, vacuum.MaticVacuum(entry), params


async def test_plan_area_command_starts_its_owned_custom_coverage(hass) -> None:
    entry, manager, entity, params = _plan_area_vacuum(hass)
    client = entry.runtime_data.coordinator.client

    await entity.async_send_command("clean_plan_area", params)

    client.async_start_custom_coverage.assert_awaited_once()
    call = client.async_start_custom_coverage.await_args
    assert call.args[0] is entry.runtime_data.coordinator.data.floor_plan
    assert call.args[1] == [(1.0, 2.0, 0.35)]
    assert call.kwargs["cleaning_mode"] is CleaningMode.BOTH
    assert call.kwargs["coverage_setting"] is CoverageSetting.HEAVY_DUTY
    assert str(call.kwargs["session_id"]) == _AREA_SESSION
    entry.runtime_data.coordinator.async_request_refresh.assert_awaited()
    # The dispatch check is the transport's last word before the bytes go out.
    require_current = call.kwargs["require_current"]
    require_current()
    manager.control.cancellation_event("synthetic-serial").set()
    with pytest.raises(HomeAssistantError) as stopped:
        require_current()
    assert stopped.value.translation_key == "coverage_stopped_before_start"
    entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
    with pytest.raises(ServiceValidationError, match="room map"):
        require_current()


@pytest.mark.parametrize(
    "change",
    [
        {PLAN_MOTION_TOKEN: None},
        {PLAN_SESSION_ID: None},
        {PLAN_FLOOR_TOKEN: None},
        {"area": None},
        {"area": ""},
        {"area": 1},
        {"fingerprint": None},
        {"fingerprint": 1},
    ],
)
async def test_plan_area_command_requires_its_managed_run(hass, change) -> None:
    entry, _manager, entity, params = _plan_area_vacuum(hass)
    for key, value in change.items():
        if value is None:
            params.pop(key)
        else:
            params[key] = value

    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_send_command("clean_plan_area", params)

    assert raised.value.translation_key == "invalid_plan_command"
    entry.runtime_data.coordinator.client.async_start_custom_coverage.assert_not_awaited()


async def test_plan_area_command_without_params_is_refused(hass) -> None:
    entry, _manager, entity, _params = _plan_area_vacuum(hass)
    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_send_command("clean_plan_area")
    assert raised.value.translation_key == "invalid_plan_command"
    entry.runtime_data.coordinator.client.async_start_custom_coverage.assert_not_awaited()


@pytest.mark.parametrize(
    ("change", "translation_key"),
    [
        ("deleted", "plan_area_missing"),
        ("corrupt", "plan_area_missing"),
        ("redrawn", "area_map_changed"),
        ("other_map", "area_map_changed"),
        ("bad_circle", "invalid_area"),
        ("stale_floor", "room_plan_unavailable"),
    ],
)
async def test_plan_area_command_rechecks_the_area_before_starting(
    hass, change, translation_key
) -> None:
    entry, manager, entity, params = _plan_area_vacuum(hass)
    areas = manager.repository.robot("synthetic-serial")["areas"]
    floor = entry.runtime_data.coordinator.data.floor_plan
    if change == "deleted":
        areas.pop("rug")
    elif change == "corrupt":
        areas["rug"] = "corrupt"
    elif change == "redrawn":
        areas["rug"]["circles"][0]["x"] = 1.5
    elif change == "other_map":
        areas["rug"]["map_binding"] = binding_for_floor_plan(
            replace(floor, mission_id=floor.mission_id + 1)
        )
        params["fingerprint"] = plan_area_fingerprint(areas["rug"])
    elif change == "bad_circle":
        areas["rug"]["circles"] = [{"x": "left", "y": 2.0, "radius": 0.35}]
        params["fingerprint"] = plan_area_fingerprint(areas["rug"])
    else:
        params[PLAN_FLOOR_TOKEN] = "0" * 64

    with pytest.raises(ServiceValidationError) as raised:
        await entity.async_send_command("clean_plan_area", params)

    assert raised.value.translation_key == translation_key
    entry.runtime_data.coordinator.client.async_start_custom_coverage.assert_not_awaited()


@pytest.mark.parametrize(
    ("error", "expected", "translation_key"),
    [
        (
            CoverageGuardError(CoverageGuardReason.NATIVE_SESSION_ACTIVE),
            ServiceValidationError,
            CoverageGuardReason.NATIVE_SESSION_ACTIVE.value,
        ),
        (MaticError("offline"), HomeAssistantError, "robot_command_failed"),
        (ValueError("encode"), HomeAssistantError, "robot_command_failed"),
    ],
)
async def test_plan_area_command_translates_start_failures(
    hass, error, expected, translation_key
) -> None:
    entry, _manager, entity, params = _plan_area_vacuum(hass)
    client = entry.runtime_data.coordinator.client
    client.async_start_custom_coverage.side_effect = error

    with pytest.raises(expected) as raised:
        await entity.async_send_command("clean_plan_area", params)

    assert raised.value.translation_key == translation_key
    assert raised.value.__cause__ is error
    entry.runtime_data.coordinator.async_request_refresh.assert_not_awaited()
