"""Automation action coverage for room-native cleaning plans."""

import asyncio
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context, ServiceCall
from homeassistant.exceptions import (
    HomeAssistantError,
    ServiceValidationError,
    Unauthorized,
    UnknownUser,
)
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    binding_for_floor_plan,
)
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    UserCommand,
)
from custom_components.matic_robot.client.endpoints import HERMES_ENDPOINTS
from custom_components.matic_robot.client.exceptions import (
    CannotConnectError,
    MaticError,
)
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    HermesCollectionEntry,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.firmware import ANALYSIS_VERSION
from custom_components.matic_robot.managed_executor import (
    PlanCancelledError,
    _async_dispatch_leg_command,
    _async_expire_native_reconciliation,
    _async_mark_run_docked,
    _async_reconcile_native_stop,
    _async_run_room,
    _async_wait_for_vacuum_state,
    _clear_stop_pending_if_stable,
    _mark_dispatch_coverage_verified,
    _native_completion_match,
    _NativeReconciliation,
    _PreparedRoomDispatch,
    _run_provenance,
    _schedule_native_reconciliation,
)
from custom_components.matic_robot.plans import (
    MAX_SAVED_PLANS_PER_ROBOT,
    CleaningPlanManager,
    CleaningRoom,
    SavedPlanLimitError,
    plan_floor_token,
)
from custom_components.matic_robot.room_sequence import (
    _resolve_room_id as _resolve_sequence_room_id,
)
from custom_components.matic_robot.services import (
    CLEAN_AREA_SERVICE_SCHEMA,
    CLEAN_ROOM_SEQUENCE_SCHEMA,
    DELETE_PLAN_ROOM_SCHEMA,
    MOVE_PLAN_ROOM_SCHEMA,
    PLAN_REFERENCE_SCHEMA,
    PREVIEW_ROOM_SEQUENCE_SCHEMA,
    RUN_SELECTED_PLAN_SCHEMA,
    SAVE_PLAN_ROOM_SCHEMA,
    SAVE_PLAN_SCHEMA,
    SAVED_PLAN_SERVICE_SCHEMA,
    _async_execute_rooms,
    _ensure_stop_settled,
    _entry_for_entity,
    _plan_cadence_bindings,
    _require_matic_control,
    _resolve_loaded_matic_vacuums,
    _resolve_room_id,
    _saved_plan_context,
    async_register_services,
)


def test_room_sequence_default_resolver_uses_canonical_reference_rules() -> None:
    room_map = {"room-office": "Office"}

    assert _resolve_sequence_room_id(" ROOM-OFFICE ", room_map) == "room-office"
    with pytest.raises(ValueError, match="missing"):
        _resolve_sequence_room_id("missing", room_map)


@pytest.mark.parametrize(
    "cadence_by_room",
    [None, {"room-a": "invalid"}],
)
def test_dispatch_readback_marker_ignores_missing_or_invalid_cadence(
    cadence_by_room,
):
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "quick")
    dispatch = _PreparedRoomDispatch((room,), None, dt_util.utcnow())
    checkpoint = {"cadence_by_room": cadence_by_room}

    _mark_dispatch_coverage_verified(checkpoint, dispatch)

    assert checkpoint["cadence_by_room"] == cadence_by_room


def test_dispatch_readback_marker_records_room_setting_evidence():
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "quick")
    dispatch = _PreparedRoomDispatch((room,), None, dt_util.utcnow())
    checkpoint = {
        "cadence_by_room": {
            "room-a": {"effective_coverage_setting": "quick"},
            "room-b": {"effective_coverage_setting": "heavy_duty"},
        }
    }

    _mark_dispatch_coverage_verified(checkpoint, dispatch)

    assert checkpoint["cadence_by_room"]["room-a"]["coverage_setting_verified"]
    assert "coverage_setting_verified" not in checkpoint["cadence_by_room"]["room-b"]


async def test_run_provenance_and_docked_bridge_are_bounded(hass) -> None:
    """Automation/user context maps to labels and never stores identity."""
    automation = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {},
        context=Context(parent_id="parent", user_id="private-user"),
    )
    user = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {},
        context=Context(user_id="private-user"),
    )
    unknown = ServiceCall(hass, DOMAIN, "run_selected_plan", {}, context=Context())
    assert _run_provenance(automation) == "automation"
    assert _run_provenance(user) == "user"
    assert _run_provenance(unknown) == "external_unknown"

    manager = SimpleNamespace(async_mark_run_docked=AsyncMock())
    await _async_mark_run_docked(
        manager, "serial", None, "vacuum.matic", automation.context
    )
    manager.async_mark_run_docked.assert_not_awaited()
    await _async_mark_run_docked(
        manager, "serial", "run-1", "vacuum.matic", automation.context
    )
    manager.async_mark_run_docked.assert_awaited_once_with(
        "serial", "run-1", entity_id="vacuum.matic", context=automation.context
    )


@pytest.mark.parametrize("finish_requested", [False, True])
async def test_dock_upgrade_does_not_mask_unmanaged_running_failure(
    hass, finish_requested: bool
) -> None:
    """Only a managed stop may upgrade a still-running run at the dock."""
    finish_event = asyncio.Event()
    if finish_requested:
        finish_event.set()
    manager = SimpleNamespace(
        snapshot=MagicMock(
            return_value={"last_run": {"run_id": "run-1", "outcome": "running"}}
        ),
        cancellation_reason=MagicMock(return_value=None),
        finish_room_event=MagicMock(return_value=finish_event),
        async_mark_run_docked=AsyncMock(),
    )

    await _async_mark_run_docked(manager, "serial", "run-1", "vacuum.matic", Context())

    manager.async_mark_run_docked.assert_not_awaited()


async def test_dock_upgrade_allows_managed_stop_running_failure(hass) -> None:
    """The managed STOP reason authorizes the early dock upgrade."""
    manager = SimpleNamespace(
        snapshot=MagicMock(
            return_value={"last_run": {"run_id": "run-1", "outcome": "running"}}
        ),
        cancellation_reason=MagicMock(return_value="managed_stop"),
        finish_room_event=MagicMock(return_value=asyncio.Event()),
        async_mark_run_docked=AsyncMock(),
    )

    await _async_mark_run_docked(manager, "serial", "run-1", "vacuum.matic", Context())

    manager.async_mark_run_docked.assert_awaited_once()


def _registered_handler(services, service: str):
    return next(
        item.args[2]
        for item in services.async_register.call_args_list
        if item.args[1] == service
    )


def _area_floor_plan(
    *, mission_id: int = 42, partition_id: str = "synthetic-partition"
) -> FloorPlan:
    return FloorPlan(
        mission_id,
        partition_id,
        partition_id.encode(),
        (
            Room(
                "room-office",
                "Office",
                "protocol-office",
                b"office",
                ((0, 0), (4, 0), (4, 4), (0, 4)),
            ),
        ),
    )


async def _registered_services(hass, manager=None):
    services = SimpleNamespace(async_register=MagicMock(), async_call=AsyncMock())
    hass.services = services
    replacement = manager or SimpleNamespace(async_load=AsyncMock())
    if manager is not None:
        replacement.async_load = AsyncMock()
    firmware = SimpleNamespace(
        async_load=AsyncMock(),
        async_record_snapshot=AsyncMock(
            return_value={"baseline": True, "changed_endpoints": []}
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.services.CleaningPlanManager",
            return_value=replacement,
        ),
        patch(
            "custom_components.matic_robot.services.FirmwareTracker",
            return_value=firmware,
        ),
    ):
        await async_register_services(hass)
    return services


def _execution_call(hass) -> ServiceCall:
    return ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        {
            "plan_id": "away",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": False,
        },
    )


def test_room_management_reference_is_stable_and_fail_closed() -> None:
    assert (
        _resolve_room_id(
            "stable-bedroom",
            {
                "stable-bedroom": "Primary Bedroom",
                "other-room": "stable-bedroom",
            },
        )
        == "stable-bedroom"
    )

    with pytest.raises(ServiceValidationError, match="Ambiguous Matic room") as err:
        _resolve_room_id(
            "Bedroom",
            {
                "room-bedroom-east": "Bedroom",
                "room-bedroom-west": "BEDROOM",
            },
        )
    assert err.value.translation_key == "unknown_rooms"
    assert err.value.translation_placeholders == {
        "rooms": "ambiguous room name: Bedroom"
    }

    with pytest.raises(ServiceValidationError, match="Unknown Matic room"):
        _resolve_room_id("Missing", {"room-bedroom": "Bedroom"})


async def test_clean_action_routes_every_verified_preference() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean",
        {
            "entity_id": ["vacuum.test"],
            "rooms": ["Study", "Kitchen"],
            "cleaning_mode": "mop",
            "coverage_setting": "heavy_duty",
            "ordered": True,
        },
    )
    with patch(
        "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
        return_value=["vacuum.test"],
    ):
        await _registered_handler(services, "clean")(call)

    services.async_call.assert_awaited_once_with(
        "vacuum",
        "send_command",
        {
            "entity_id": ["vacuum.test"],
            "command": "clean_rooms",
            "params": {
                "rooms": ["Study", "Kitchen"],
                "cleaning_mode": "mop",
                "coverage": "heavy_duty",
                "ordered": True,
            },
        },
        blocking=True,
        context=call.context,
    )


async def test_clean_action_without_rooms_targets_entire_floor() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"], "ordered": False}
    )
    with patch(
        "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
        return_value=["vacuum.test"],
    ):
        await _registered_handler(services, "clean")(call)
    assert services.async_call.await_args.args[2]["command"] == "clean_all"


async def test_clean_action_checks_oem_stop_fence() -> None:
    """The generic clean service cannot bypass a graceful OEM STOP."""
    hass = SimpleNamespace(data={})
    manager = SimpleNamespace(
        async_load=AsyncMock(), stop_pending=MagicMock(return_value=False)
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"], "ordered": False}
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(
                data=SimpleNamespace(info=SimpleNamespace(serial_number="serial"))
            )
        )
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
    ):
        await _registered_handler(services, "clean")(call)

    manager.stop_pending.assert_called_once_with("serial")


async def test_clean_area_uses_only_private_saved_geometry(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    managed_token = manager.begin_managed_motion("serial")
    floor_plan = _area_floor_plan()
    await manager.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": binding_for_floor_plan(floor_plan),
        },
    )
    services = await _registered_services(hass, manager)
    client = SimpleNamespace(async_start_custom_coverage=AsyncMock())
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_refresh=AsyncMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            coordinator=coordinator,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    context = ("vacuum.test", entry, "serial", {"office": "Office"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "area": "Litter box",
                "coverage_setting": "heavy_duty",
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        result = await _registered_handler(services, "clean_area")(call)

    assert result is None
    assert call.data["area"] == "Litter box"
    assert "circles" not in call.data
    assert manager.managed_motion_is_current("serial", managed_token) is False
    client.async_start_custom_coverage.assert_awaited_once_with(
        floor_plan,
        [(1.0, 2.0, 0.35)],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.HEAVY_DUTY,
    )
    coordinator.async_request_refresh.assert_awaited_once()


async def test_clean_area_reports_unknown_invalid_and_missing_map(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.async_save_area(
        "serial",
        "broken",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Broken",
            "circles": [{}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": binding_for_floor_plan(floor_plan),
        },
    )
    await manager.async_save_area(
        "serial",
        "invalid_settings",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Invalid settings",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "map_binding": binding_for_floor_plan(floor_plan),
        },
    )
    await manager.async_save_area(
        "serial",
        "non_string_settings",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Non-string settings",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": 5,
            "coverage_setting": "standard",
            "map_binding": binding_for_floor_plan(floor_plan),
        },
    )
    services = await _registered_services(hass, manager)
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_refresh=AsyncMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=SimpleNamespace(async_start_custom_coverage=AsyncMock()),
            coordinator=coordinator,
        )
    )
    context = ("vacuum.test", entry, "serial", {"office": "Office"})

    async def invoke(area: str) -> None:
        call = ServiceCall(
            hass,
            DOMAIN,
            "clean_area",
            CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": area}),
        )
        await _registered_handler(services, "clean_area")(call)

    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError) as unknown:
            await invoke("Missing")
        assert unknown.value.translation_key == "unknown_area"
        with pytest.raises(ServiceValidationError) as invalid:
            await invoke("Broken")
        assert invalid.value.translation_key == "invalid_area"
        with pytest.raises(ServiceValidationError) as invalid_settings:
            await invoke("Invalid settings")
        assert invalid_settings.value.translation_key == "invalid_area"
        with pytest.raises(ServiceValidationError) as non_string_settings:
            await invoke("Non-string settings")
        assert non_string_settings.value.translation_key == "invalid_area"
        coordinator.data.floor_plan = None
        with pytest.raises(ServiceValidationError) as no_map:
            await invoke("Broken")
        assert no_map.value.translation_key == "room_plan_unavailable"


@pytest.mark.parametrize(
    "mismatch", ["legacy", "invalid", "mission", "partition", "geometry"]
)
async def test_clean_area_blocks_every_stale_map_binding_before_robot_command(
    hass, mismatch
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    saved_floor_plan = _area_floor_plan()
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Litter box",
        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_floor_plan(saved_floor_plan),
    }
    if mismatch == "legacy":
        area.pop("schema_version")
        area.pop("map_binding")
        live_floor_plan = saved_floor_plan
    elif mismatch == "invalid":
        area["schema_version"] = AREA_SCHEMA_VERSION + 1
        live_floor_plan = saved_floor_plan
    elif mismatch == "mission":
        live_floor_plan = _area_floor_plan(mission_id=43)
    elif mismatch == "partition":
        live_floor_plan = _area_floor_plan(partition_id="new-partition")
    else:
        room = saved_floor_plan.rooms[0]
        live_floor_plan = FloorPlan(
            saved_floor_plan.mission_id,
            saved_floor_plan.partition_protocol_id,
            saved_floor_plan.partition_id_wire,
            (
                Room(
                    room.id,
                    room.name,
                    room.protocol_id,
                    room.id_wire,
                    ((0.01, 0), *room.boundary[1:]),
                ),
            ),
        )
    await manager.async_save_area("serial", "litter_box", area)
    managed_token = manager.begin_managed_motion("serial")
    services = await _registered_services(hass, manager)
    client = SimpleNamespace(async_start_custom_coverage=AsyncMock())
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=live_floor_plan),
        async_request_refresh=AsyncMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            coordinator=coordinator,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
        ),
        pytest.raises(ServiceValidationError) as stale,
    ):
        await _registered_handler(services, "clean_area")(call)

    assert stale.value.translation_key == "area_map_changed"
    assert manager.managed_motion_is_current("serial", managed_token) is True
    client.async_start_custom_coverage.assert_not_awaited()

    coordinator.async_request_refresh.assert_not_awaited()


async def test_clean_area_rechecks_floor_plan_after_motion_lock_wait(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": binding_for_floor_plan(floor_plan),
        },
    )
    managed_token = manager.begin_managed_motion("serial")
    services = await _registered_services(hass, manager)
    client = SimpleNamespace(async_start_custom_coverage=AsyncMock())
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_refresh=AsyncMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            coordinator=coordinator,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )
    lock = manager.command_lock("serial")
    await lock.acquire()
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await asyncio.sleep(0)
        coordinator.data.floor_plan = _area_floor_plan(mission_id=43)
        lock.release()
        with pytest.raises(ServiceValidationError) as stale:
            await task

    assert stale.value.translation_key == "area_map_changed"
    assert manager.managed_motion_is_current("serial", managed_token) is True
    client.async_start_custom_coverage.assert_not_awaited()

    coordinator.data.floor_plan = floor_plan
    lock = manager.command_lock("serial")
    await lock.acquire()
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await asyncio.sleep(0)
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
        lock.release()
        with pytest.raises(ServiceValidationError) as transitioning:
            await task

    assert transitioning.value.translation_key == "room_plan_unavailable"
    assert manager.managed_motion_is_current("serial", managed_token) is True
    client.async_start_custom_coverage.assert_not_awaited()

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = True
    replace_started = asyncio.Event()
    release_replace = asyncio.Event()
    original_replace = manager.async_replace_managed_motion

    async def delayed_replace(serial_number: str) -> None:
        replace_started.set()
        await release_replace.wait()
        await original_replace(serial_number)

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
        ),
        patch.object(
            manager,
            "async_replace_managed_motion",
            side_effect=delayed_replace,
        ),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await replace_started.wait()
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
        release_replace.set()
        with pytest.raises(ServiceValidationError) as changed_during_replace:
            await task

    assert changed_during_replace.value.translation_key == "room_plan_unavailable"
    assert manager.managed_motion_is_current("serial", managed_token) is False
    client.async_start_custom_coverage.assert_not_awaited()

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = True
    managed_token = manager.begin_managed_motion("serial")
    lock = manager.command_lock("serial")
    await lock.acquire()
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await asyncio.sleep(0)
        await manager.async_delete_area("serial", "litter_box")
        lock.release()
        with pytest.raises(ServiceValidationError) as deleted:
            await task

    assert deleted.value.translation_key == "unknown_area"
    assert manager.managed_motion_is_current("serial", managed_token) is True


async def test_clean_area_rechecks_stop_fence_after_motion_lock_wait(hass) -> None:
    """A STOP queued first fences a custom-area clean waiting on its lock."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": binding_for_floor_plan(floor_plan),
        },
    )
    managed_token = manager.begin_managed_motion("serial")
    services = await _registered_services(hass, manager)
    client = SimpleNamespace(async_start_custom_coverage=AsyncMock())
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_refresh=AsyncMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            coordinator=coordinator,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )
    lock = manager.command_lock("serial")
    await lock.acquire()
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await asyncio.sleep(0)
        manager.mark_stop_pending("serial")
        lock.release()
        with pytest.raises(ServiceValidationError) as blocked:
            await task

    assert blocked.value.translation_key == "robot_stop_pending"
    assert manager.managed_motion_is_current("serial", managed_token) is True
    client.async_start_custom_coverage.assert_not_awaited()
    coordinator.async_request_refresh.assert_not_awaited()


async def test_clean_area_translates_client_failure_without_protocol_details(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    await manager.async_save_area(
        "serial",
        "litter_box",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Litter box",
            "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": binding_for_floor_plan(floor_plan),
        },
    )
    client = SimpleNamespace(
        async_start_custom_coverage=AsyncMock(
            side_effect=MaticError("synthetic protocol detail")
        )
    )
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_refresh=AsyncMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            coordinator=coordinator,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_area",
        CLEAN_AREA_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "area": "Litter box"}),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"office": "Office"}),
        ),
        pytest.raises(ServiceValidationError) as failure,
    ):
        await _registered_handler(services, "clean_area")(call)

    assert failure.value.translation_key == "robot_command_failed"
    assert "protocol detail" not in str(failure.value)
    coordinator.async_request_refresh.assert_not_awaited()


async def test_clean_room_sequence_preserves_order_and_per_room_settings(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room("room-office", "Office", "office", b"office", ()),
            Room("room-study", "Study", "study", b"study", ()),
        ),
    )
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_refresh=AsyncMock(),
        async_confirm_room_completed=MagicMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=coordinator,
            client=SimpleNamespace(
                async_has_active_cleaning_session=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(
                    return_value=b"native-task"
                ),
                async_send_user_command=AsyncMock(),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "rooms": [
                    {
                        "room": "Study",
                        "cleaning_mode": "mop",
                        "coverage_setting": "heavy_duty",
                    },
                    {
                        "room": "Office",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                    },
                ],
            }
        ),
    )
    # Existing room-sequence callers keep their saved per-room settings unless
    # they explicitly opt into shared cadence.
    assert call.data["use_room_schedule"] is False

    async def exercise_sequence(*_args, **kwargs) -> None:
        assert kwargs["floor_is_current"]() is True
        token = manager.begin_managed_motion("serial")
        try:
            await kwargs["managed_user_command"](token, UserCommand.STOP)
        finally:
            manager.end_managed_motion("serial", token)

    execute = AsyncMock(side_effect=exercise_sequence)
    dock_after_stop = MagicMock()
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=(
                "vacuum.test",
                entry,
                "serial",
                {"room-office": "Office", "room-study": "Study"},
            ),
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            execute,
        ),
        patch(
            "custom_components.matic_robot.managed_executor.schedule_dock_after_stop",
            dock_after_stop,
        ),
    ):
        await _registered_handler(services, "clean_room_sequence")(call)

    rooms = execute.await_args.args[5]
    assert rooms == [
        CleaningRoom("room-study", "Study", "mop", "heavy_duty"),
        CleaningRoom("room-office", "Office", "vacuum", "standard"),
    ]
    assert "intelligent" not in execute.await_args.kwargs
    assert execute.await_args.args[1].data["plan_id"] == "quick_clean"
    assert execute.await_args.args[1].data["return_to_base"] is True
    assert execute.await_args.kwargs["floor_token"] == plan_floor_token(floor_plan)
    entry.runtime_data.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.STOP
    )
    coordinator.async_request_refresh.assert_awaited_once_with()
    dock_after_stop.assert_called_once()


async def test_preview_room_sequence_matches_dispatch_and_rejects_stale_token(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    identity = _plan_cadence_bindings(
        SimpleNamespace(
            runtime_data=SimpleNamespace(
                coordinator=SimpleNamespace(
                    data=SimpleNamespace(floor_plan=floor_plan)
                ),
                slam_map=SimpleNamespace(
                    floor_plan_is_current=MagicMock(return_value=True)
                ),
            )
        )
    )[1][room.id]
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 2},
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.id: identity},
    )
    schedule = manager._robot("serial")["shared_room_cadence"][room.id]
    schedule["progress"] = {"mop": 1, "coverage": 0}
    entry = SimpleNamespace(
        entry_id="entry-preview",
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(
                data=SimpleNamespace(floor_plan=floor_plan),
                async_request_refresh=AsyncMock(),
                async_confirm_room_completed=MagicMock(),
            ),
            client=SimpleNamespace(
                async_has_active_cleaning_session=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(return_value=b"native"),
                async_send_user_command=AsyncMock(),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    services = await _registered_services(hass, manager)
    input_data = {
        "entity_id": ["vacuum.test"],
        "rooms": [
            {
                "room": room.id,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            }
        ],
        "use_room_schedule": True,
    }
    preview_call = ServiceCall(
        hass,
        DOMAIN,
        "preview_room_sequence",
        PREVIEW_ROOM_SEQUENCE_SCHEMA(input_data),
    )
    context = ("vacuum.test", entry, "serial", {room.id: room.name})
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        preview = await _registered_handler(services, "preview_room_sequence")(
            preview_call
        )

    assert len(preview["preview_token"]) == 64
    assert preview["rooms"][0]["cleaning_mode"] == "vacuum_and_mop"
    assert preview["rooms"][0]["cadence_reasons"] == ["mop_due"]

    async def execute_sequence(*_args, **kwargs) -> None:
        # The managed executor invokes this after its stop/checkpoint awaits;
        # keep the service regression at the same TOCTOU boundary.
        kwargs["validate_prepared_run"]()

    execute = AsyncMock(side_effect=execute_sequence)
    dispatch_data = {**input_data, "preview_token": preview["preview_token"]}
    dispatch_call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(dispatch_data),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch("custom_components.matic_robot.services._async_execute_rooms", execute),
    ):
        await _registered_handler(services, "clean_room_sequence")(dispatch_call)
    assert (
        execute.await_args.args[5][0].cleaning_mode
        == preview["rooms"][0]["cleaning_mode"]
    )
    assert (
        execute.await_args.args[5][0].coverage_setting
        == preview["rooms"][0]["coverage_setting"]
    )

    duplicate_input = {
        "entity_id": ["vacuum.test"],
        "rooms": [
            {
                "room": room.id,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
            {
                "room": room.name,
                "cleaning_mode": "mop",
                "coverage_setting": "heavy_duty",
            },
        ],
    }
    duplicate_preview_call = ServiceCall(
        hass,
        DOMAIN,
        "preview_room_sequence",
        PREVIEW_ROOM_SEQUENCE_SCHEMA(duplicate_input),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
    ):
        duplicate_preview = await _registered_handler(
            services, "preview_room_sequence"
        )(duplicate_preview_call)
    assert [item["cleaning_mode"] for item in duplicate_preview["rooms"]] == [
        "vacuum",
        "mop",
    ]
    duplicate_dispatch = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(
            {
                **duplicate_input,
                "preview_token": duplicate_preview["preview_token"],
            }
        ),
    )
    execute.reset_mock()
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            execute,
        ),
    ):
        await _registered_handler(services, "clean_room_sequence")(duplicate_dispatch)
    assert [room.cleaning_mode for room in execute.await_args.args[5]] == [
        "vacuum",
        "mop",
    ]

    tracked_duplicate_input = {**duplicate_input, "use_room_schedule": True}
    tracked_duplicate_preview = ServiceCall(
        hass,
        DOMAIN,
        "preview_room_sequence",
        PREVIEW_ROOM_SEQUENCE_SCHEMA(tracked_duplicate_input),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError, match="duplicate tracked room"),
    ):
        await _registered_handler(services, "preview_room_sequence")(
            tracked_duplicate_preview
        )
    tracked_duplicate_dispatch = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(tracked_duplicate_input),
    )
    execute.reset_mock()
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            execute,
        ),
        pytest.raises(ServiceValidationError, match="duplicate tracked room"),
    ):
        await _registered_handler(services, "clean_room_sequence")(
            tracked_duplicate_dispatch
        )
    execute.assert_not_awaited()

    async def mutate_before_dispatch(*_args, **kwargs) -> None:
        schedule["progress"] = {"mop": 0, "coverage": 0}
        schedule["policy"]["do_mop_next"] = True
        kwargs["validate_prepared_run"]()

    execute_with_mutation = AsyncMock(side_effect=mutate_before_dispatch)
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            execute_with_mutation,
        ),
        pytest.raises(ServiceValidationError, match="resolution changed"),
    ):
        await _registered_handler(services, "clean_room_sequence")(dispatch_call)
    execute_with_mutation.assert_awaited_once()

    schedule["progress"] = {"mop": 1, "coverage": 0}
    schedule["policy"]["do_mop_next"] = False
    schedule["identity"] = identity

    async def invalidate_identity(*_args, **kwargs) -> None:
        schedule["identity"] = "0" * 64
        kwargs["validate_prepared_run"]()

    execute_with_invalid_map = AsyncMock(side_effect=invalidate_identity)
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            execute_with_invalid_map,
        ),
        pytest.raises(ServiceValidationError, match="different map"),
    ):
        await _registered_handler(services, "clean_room_sequence")(dispatch_call)
    execute_with_invalid_map.assert_awaited_once()

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError, match="different map"),
    ):
        await _registered_handler(services, "preview_room_sequence")(preview_call)

    schedule["identity"] = identity
    schedule["progress"] = {"mop": 0, "coverage": 0}
    schedule["policy"]["do_mop_next"] = True
    stale_call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(dispatch_data),
    )
    execute.reset_mock()
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError, match="preview is stale"),
    ):
        await _registered_handler(services, "clean_room_sequence")(stale_call)
    execute.assert_not_awaited()


async def test_preview_room_sequence_requires_administrator(hass) -> None:
    hass.auth = SimpleNamespace(
        async_get_user=AsyncMock(return_value=SimpleNamespace(is_admin=False))
    )
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "preview_room_sequence",
        PREVIEW_ROOM_SEQUENCE_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "rooms": [
                    {
                        "room": "room-office",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                    }
                ],
            }
        ),
        context=Context(user_id="restricted-user"),
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        pytest.raises(Unauthorized),
    ):
        await _registered_handler(services, "preview_room_sequence")(call)

    hass.auth.async_get_user.return_value = None
    with pytest.raises(UnknownUser):
        await _registered_handler(services, "preview_room_sequence")(call)


@pytest.mark.parametrize(
    ("use_room_schedule", "override_room_schedule"),
    [(False, False), (True, False), (True, True)],
)
async def test_clean_room_sequence_schedule_selection_controls_shared_accounting(
    hass, use_room_schedule, override_room_schedule
) -> None:
    """Only a manual run using the room schedule may advance shared progress."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    identity = _plan_cadence_bindings(
        SimpleNamespace(
            runtime_data=SimpleNamespace(
                coordinator=SimpleNamespace(
                    data=SimpleNamespace(floor_plan=floor_plan)
                ),
                slam_map=SimpleNamespace(
                    floor_plan_is_current=MagicMock(return_value=True)
                ),
            )
        )
    )[1][room.id]
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 2,
                        "coverage_every_n": 2,
                        "periodic_coverage_setting": "quick",
                    },
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.id: identity},
    )
    manager._robot("serial")["shared_room_cadence"][room.id]["progress"] = {
        "mop": 1,
        "coverage": 1,
    }
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_refresh=AsyncMock(),
        async_confirm_room_completed=MagicMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=coordinator,
            client=SimpleNamespace(
                async_has_active_cleaning_session=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(return_value=b"native"),
                async_send_user_command=AsyncMock(),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    service_data = {
        "entity_id": ["vacuum.test"],
        "use_room_schedule": use_room_schedule,
        "rooms": [
            {
                "room": room.id,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            }
        ],
    }
    if override_room_schedule:
        service_data["override_room_schedule"] = True
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_room_sequence",
        CLEAN_ROOM_SEQUENCE_SCHEMA(service_data),
    )

    async def execute_sequence(*args, **kwargs):
        run_id = (
            "manual-with-schedule" if use_room_schedule else "manual-without-schedule"
        )
        run_manager = args[2]
        run_rooms = args[5]
        await run_manager.async_begin_run(
            "serial",
            "quick_clean",
            run_id,
            len(run_rooms),
            trigger="user",
            service="clean_room_sequence",
        )
        await run_manager.async_mark_started(
            "serial", "quick_clean", run_rooms[0], run_id=run_id
        )
        cadence_by_room = kwargs["cadence_by_room"]
        cadence_by_room[run_rooms[0].room_id]["coverage_setting_verified"] = True
        await run_manager.async_set_recovery_checkpoint(
            "serial",
            run_id,
            {"cadence_by_room": cadence_by_room},
        )
        # This method is the managed executor's verified-completion boundary.
        await run_manager.async_mark_completed("serial", "quick_clean", run_rooms[0])

    execute = AsyncMock(side_effect=execute_sequence)
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {room.id: room.name}),
        ),
        patch("custom_components.matic_robot.services._async_execute_rooms", execute),
    ):
        await _registered_handler(services, "clean_room_sequence")(call)

    assert execute.await_args.args[5] == [
        CleaningRoom(
            room.id,
            room.name,
            "vacuum_and_mop"
            if use_room_schedule and not override_room_schedule
            else "vacuum",
            "quick" if use_room_schedule and not override_room_schedule else "standard",
        )
    ]
    snapshot = execute.await_args.kwargs["cadence_by_room"][room.id]
    assert snapshot["scope"] == ("shared" if use_room_schedule else "plan")
    assert snapshot["schedule_active"] is use_room_schedule
    assert snapshot["mop_due"] is use_room_schedule
    assert snapshot["coverage_due"] is use_room_schedule
    expected_progress = (
        {"mop": 0, "coverage": 0}
        if use_room_schedule and not override_room_schedule
        else {"mop": 1, "coverage": 1}
    )
    assert (
        manager._robot("serial")["shared_room_cadence"][room.id]["progress"]
        == expected_progress
    )


async def test_reset_room_cadence_service_targets_one_room_and_reports_blockers(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                },
                {
                    "room_id": "room-study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            ],
        },
    )
    manager._robot("serial")["plan_room_cadence"]["home"]["room-office"] = {
        "identity": None,
        "progress": {"mop": 2, "coverage": 4},
    }
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {})
    reset = ServiceCall(
        hass,
        DOMAIN,
        "reset_room_cadence",
        {
            "entity_id": ["vacuum.test"],
            "plan": "Home",
            "room_id": "room-office",
            "modes": ["mop"],
        },
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        result = await _registered_handler(services, "reset_room_cadence")(reset)
    assert result == {
        "plan_id": "home",
        "reset_room_ids": ["room-office"],
        "reset_modes": ["mop"],
    }
    assert manager.cadence_progress("serial", "home", "room-office")["mop"] == 0
    assert manager.cadence_progress("serial", "home", "room-office")["coverage"] == 4

    manager._robot("serial")["active_plan"] = {
        "plan_id": "home",
        "room_id": "room-office",
    }
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(
            ServiceValidationError, match="cannot reset while its plan is running"
        ),
    ):
        await _registered_handler(services, "reset_room_cadence")(reset)


async def test_cadence_room_edit_rolls_back_when_persistence_fails(hass) -> None:
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager._store = SimpleNamespace(async_save=save)
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(
                data=SimpleNamespace(floor_plan=floor_plan),
                async_request_refresh=AsyncMock(),
                async_confirm_room_completed=MagicMock(),
            ),
            client=SimpleNamespace(
                async_has_active_cleaning_session=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(
                    return_value=b"native-task"
                ),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    identity = _plan_cadence_bindings(entry)[1][room.id]
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        floor_token=plan_floor_token(floor_plan),
        room_identities={room.id: identity},
    )
    schedule = manager._robot("serial")["shared_room_cadence"][room.id]
    schedule["progress"] = {"mop": 2, "coverage": 0}
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", entry, "serial", {room.id: room.name})
    update = ServiceCall(
        hass,
        DOMAIN,
        "save_plan_room",
        SAVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Home",
                "room": {
                    "room": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "shared", "mop_every_n": 5},
                },
            }
        ),
    )
    save.side_effect = OSError("disk unavailable")
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(OSError, match="disk unavailable"),
    ):
        await _registered_handler(services, "save_plan_room")(update)

    assert manager.plan("serial", "home")["rooms"][0]["cadence"]["mop_every_n"] == 3
    assert schedule["progress"] == {"mop": 2, "coverage": 0}


async def test_plan_cadence_bindings_uses_verified_current_map() -> None:
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=floor_plan)),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    floor_token, identities = _plan_cadence_bindings(entry)
    assert floor_token == plan_floor_token(floor_plan)
    assert set(identities) == {room.id for room in floor_plan.rooms}


async def test_late_native_completion_uses_current_room_cadence_identity(hass) -> None:
    room = CleaningRoom("room-office", "Office", "vacuum", "quick")
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=floor_plan)),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    now = dt_util.utcnow()
    reconciliation = _NativeReconciliation(
        "home", room.room_id, room.name, now - timedelta(seconds=10)
    )
    record = CleaningSessionRecord(
        b"late-native-session",
        CleaningSession(
            (now - timedelta(seconds=12)).isoformat(),
            now.isoformat(),
            12,
            (room.name,),
            ((room.name, 12),),
            True,
            completed_rooms=(room.name,),
        ),
    )
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    manager.async_mark_native_completed = AsyncMock(return_value=True)
    hass.states.async_set("vacuum.test", "docked")
    with (
        patch(
            "custom_components.matic_robot.managed_executor.OEM_STOP_RECONCILIATION_POLL_SECONDS",
            0,
        ),
        patch(
            "custom_components.matic_robot.managed_executor.current_room_cadence_identity",
            return_value=_plan_cadence_bindings(entry)[1][room.room_id],
        ),
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
            frozenset(),
            None,
            AsyncMock(return_value=(record,)),
            None,
            None,
        )
    assert (
        manager.async_mark_native_completed.await_args.kwargs["room_identity"]
        == _plan_cadence_bindings(entry)[1][room.room_id]
    )


async def test_tracked_run_checkpoints_its_cadence_snapshot_before_dispatch(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    cancel = asyncio.Event()
    cancel.set()
    manager.prepare_run = MagicMock(return_value=cancel)
    checkpoint_write = AsyncMock(wraps=manager.async_set_recovery_checkpoint)
    manager.async_set_recovery_checkpoint = checkpoint_write
    room = CleaningRoom("room-office", "Office", "vacuum", "quick")
    cadence_snapshot = {
        room.room_id: {
            "scope": "shared",
            "mop_due": True,
            "coverage_due": False,
            "identity": "synthetic-room-identity",
        }
    }
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
        new=AsyncMock(),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.test",
            "serial",
            [room],
            cadence_by_room=cadence_snapshot,
            floor_token="synthetic-floor-token",
            session_identity=AsyncMock(return_value=b"native-session"),
        )

    checkpoint_write.assert_awaited()
    checkpoint = checkpoint_write.await_args.args[2]
    assert checkpoint["cadence_by_room"] == cadence_snapshot
    assert checkpoint["rooms"] == [
        {
            "room_id": room.room_id,
            "name": room.name,
            "cleaning_mode": room.cleaning_mode,
            "coverage_setting": room.coverage_setting,
        }
    ]


@pytest.mark.parametrize("service", ["run_selected_plan", "clean_room_sequence"])
async def test_cleaning_service_rejects_invalid_cadence_resolution(
    hass, service: str
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    manager.resolve_cadence = MagicMock(side_effect=ValueError("invalid cadence"))
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=floor_plan)),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        entry,
        "serial",
        {"room-office": "Office"},
    )
    if service == "run_selected_plan":
        call = ServiceCall(
            hass,
            DOMAIN,
            service,
            {"entity_id": ["vacuum.test"], "plan": "Home"},
        )
    else:
        call = ServiceCall(
            hass,
            DOMAIN,
            service,
            CLEAN_ROOM_SEQUENCE_SCHEMA(
                {
                    "entity_id": ["vacuum.test"],
                    "rooms": [
                        {
                            "room": "Office",
                            "cleaning_mode": "vacuum",
                            "coverage_setting": "quick",
                        }
                    ],
                }
            ),
        )

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError, match="invalid cadence") as raised,
    ):
        await _registered_handler(services, service)(call)

    assert raised.value.translation_key == "invalid_plan"


@pytest.mark.parametrize(
    "rooms, message",
    [([], "plan has no rooms"), (["malformed"], "plan contains an invalid room")],
)
async def test_run_selected_plan_rejects_malformed_authoritative_preview(
    hass, rooms, message: str
) -> None:
    """Never dispatch data that failed authoritative preview materialization."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    manager.preview = MagicMock(return_value={"plan_id": "home", "rooms": rooms})
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=floor_plan)),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", entry, "serial", {"room-office": "Office"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {"entity_id": ["vacuum.test"], "plan": "Home"},
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(),
        ) as execute,
        pytest.raises(ServiceValidationError, match=message) as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(call)

    assert raised.value.translation_key == "invalid_plan"
    execute.assert_not_awaited()


async def test_tokenized_saved_run_localizes_preview_failure_after_preflight(
    hass,
) -> None:
    """A preview failure after executor settlement remains recoverable."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": "room-office",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(
                data=SimpleNamespace(floor_plan=floor_plan),
                async_request_refresh=AsyncMock(),
                async_confirm_room_completed=MagicMock(),
            ),
            client=SimpleNamespace(
                async_has_active_cleaning_session=AsyncMock(return_value=False),
                async_get_cleaning_session_records=AsyncMock(return_value=()),
                async_get_cleaning_session_identity=AsyncMock(
                    return_value=b"native-task"
                ),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", entry, "serial", {"room-office": "Office"})
    preview_call = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Home"}),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        preview = await _registered_handler(services, "preview_plan")(preview_call)

    original_preview = manager.preview
    preview_calls = 0

    def fail_after_initial_preview(*args, **kwargs):
        nonlocal preview_calls
        preview_calls += 1
        if preview_calls > 1:
            raise ValueError("authoritative preview unavailable")
        return original_preview(*args, **kwargs)

    manager.preview = MagicMock(side_effect=fail_after_initial_preview)
    token_call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        RUN_SELECTED_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Home",
                "preview_token": preview["preview_token"],
            }
        ),
    )

    async def invoke_validation(*_args, **kwargs) -> None:
        kwargs["validate_prepared_run"]()

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(side_effect=invoke_validation),
        ) as execute,
        pytest.raises(
            ServiceValidationError, match="authoritative preview unavailable"
        ) as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(token_call)

    assert raised.value.translation_key == "invalid_plan"
    execute.assert_awaited_once()


async def test_intelligent_exact_preview_stop_and_reset_actions(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "upstairs",
        {
            "name": "Upstairs",
            "enabled": True,
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": "room-study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
            "return_to_base": True,
        },
    )
    services = await _registered_services(hass, manager)
    floor_plan = _area_floor_plan()
    floor_plan = replace(
        floor_plan,
        rooms=(replace(floor_plan.rooms[0], id="room-study", name="Study"),),
    )
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_refresh=AsyncMock(),
        async_discard_current_room=MagicMock(),
        async_confirm_room_completed=MagicMock(),
    )
    client = SimpleNamespace(
        async_has_active_cleaning_session=AsyncMock(return_value=False),
        async_get_cleaning_session_records=AsyncMock(return_value=()),
        async_get_cleaning_session_identity=AsyncMock(return_value=b"native-task"),
        async_send_user_command=AsyncMock(),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=coordinator,
            client=client,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    context = ("vacuum.test", entry, "serial", {"room-study": "Study"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Upstairs"}),
    )

    async def exercise_managed_command(*_args, **kwargs) -> None:
        token = manager.begin_managed_motion("serial")
        try:
            await kwargs["managed_user_command"](token, UserCommand.STOP)
        finally:
            manager.end_managed_motion("serial", token)

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(side_effect=exercise_managed_command),
        ) as execute,
    ):
        await _registered_handler(services, "intelligent_clean")(call)
        await _registered_handler(services, "clean_entire_plan")(call)
        await _registered_handler(services, "run_selected_plan")(call)
        preview = await _registered_handler(services, "preview_plan")(call)

    assert execute.await_count == 3
    assert "intelligent" not in execute.await_args_list[0].kwargs
    assert execute.await_args_list[0].kwargs["refresh"] is (
        coordinator.async_request_refresh
    )
    assert "intelligent" not in execute.await_args_list[1].kwargs
    assert "intelligent" not in execute.await_args_list[2].kwargs
    floor_guard = execute.await_args_list[0].kwargs["floor_is_current"]
    assert execute.await_args_list[0].kwargs["floor_token"] == plan_floor_token(
        floor_plan
    )
    assert floor_guard() is True
    coordinator.data.floor_plan = replace(
        floor_plan,
        rooms=tuple(
            replace(room, boundary=tuple((x + 0.025, y) for x, y in room.boundary))
            for room in floor_plan.rooms
        ),
    )
    assert floor_guard() is True
    coordinator.data.floor_plan = _area_floor_plan(mission_id=43)
    assert floor_guard() is False
    coordinator.data.floor_plan = floor_plan
    assert client.async_send_user_command.await_count == 3
    assert "stop_fence_expires_at" in manager._robot("serial")
    assert preview["plan_name"] == "Upstairs"
    assert preview["run_behavior"] == "ordered"
    assert preview["rooms"][0]["room_id"] == "room-study"
    assert len(preview["preview_token"]) == 64

    token_call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        RUN_SELECTED_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Upstairs",
                "preview_token": preview["preview_token"],
            }
        ),
    )

    async def validate_tokenized_run(*_args, **kwargs) -> None:
        assert "intelligent" not in kwargs
        kwargs["validate_prepared_run"]()

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(side_effect=validate_tokenized_run),
        ) as token_execute,
    ):
        await _registered_handler(services, "run_selected_plan")(token_call)
    token_execute.assert_awaited_once()

    async def mutate_saved_plan_before_dispatch(*_args, **kwargs) -> None:
        manager._robot("serial")["plans"]["upstairs"]["return_to_base"] = False
        kwargs["validate_prepared_run"]()

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(side_effect=mutate_saved_plan_before_dispatch),
        ) as changed_execute,
        pytest.raises(ServiceValidationError, match="resolution changed"),
    ):
        await _registered_handler(services, "run_selected_plan")(token_call)
    changed_execute.assert_awaited_once()

    manager._robot("serial")["plans"]["upstairs"]["return_to_base"] = True
    manager._robot("serial")["plans"]["upstairs"]["return_to_base"] = False
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(),
        ) as stale_execute,
        pytest.raises(ServiceValidationError, match="preview is stale"),
    ):
        await _registered_handler(services, "run_selected_plan")(token_call)
    stale_execute.assert_not_awaited()
    manager._robot("serial")["plans"]["upstairs"]["return_to_base"] = True

    lock = manager.lock("serial")
    await lock.acquire()
    manager.prepare_run("serial")
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    assert manager.cancellation_event("serial").is_set()
    coordinator.async_discard_current_room.assert_called_once_with()
    lock.release()
    services.async_call.assert_awaited_with(
        "vacuum",
        "return_to_base",
        {"entity_id": "vacuum.test"},
        blocking=True,
        context=stop.context,
    )

    plan = manager.plan("serial", "upstairs")
    plan_id = plan.pop("id")
    plan["finish_current_room"] = True
    plan["finish_current_room_threshold"] = 50
    await manager.async_save_plan("serial", plan_id, plan, select=False)
    services.async_call.reset_mock()
    stop = ServiceCall(
        hass,
        DOMAIN,
        "stop_intelligent_cleaning",
        {"entity_id": ["vacuum.test"], "include_unmanaged": True},
    )
    await lock.acquire()
    manager.prepare_run("serial")
    await manager.async_mark_started(
        "serial",
        "upstairs",
        CleaningRoom("room-study", "Study", "vacuum", "quick"),
    )
    try:
        with patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ):
            await _registered_handler(services, "stop_intelligent_cleaning")(stop)
        services.async_call.assert_not_awaited()
        assert manager.finish_room_event("serial").is_set()
    finally:
        lock.release()

    reset = ServiceCall(
        hass,
        DOMAIN,
        "reset_plan_history",
        {"entity_id": ["vacuum.test"], "plan": "Upstairs", "all_plans": False},
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        await _registered_handler(services, "reset_plan_history")(reset)


async def test_managed_actions_ignore_inactive_stop(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "disabled",
        {"name": "Disabled", "enabled": False, "rooms": []},
    )
    services = await _registered_services(hass, manager)
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=floor_plan)),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    context = ("vacuum.test", entry, "serial", {"one": "Kitchen"})
    missing = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
    )
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    reset_missing = ServiceCall(
        hass,
        DOMAIN,
        "reset_plan_history",
        {"entity_id": ["vacuum.test"], "plan": "Missing", "all_plans": False},
    )
    disabled = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Disabled"}),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "preview_plan")(missing)
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "intelligent_clean")(missing)
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "reset_plan_history")(reset_missing)
        with pytest.raises(ServiceValidationError, match="disabled"):
            await _registered_handler(services, "preview_plan")(disabled)
        await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    services.async_call.assert_not_awaited()


@pytest.mark.parametrize("include_unmanaged", [False, True])
async def test_stop_resolves_unmanaged_cleaning_without_a_room_map(
    hass, include_unmanaged
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    coordinator = SimpleNamespace(async_discard_current_room=MagicMock())
    entry = SimpleNamespace(runtime_data=SimpleNamespace(coordinator=coordinator))
    stop = ServiceCall(
        hass,
        DOMAIN,
        "stop_intelligent_cleaning",
        {"entity_id": ["vacuum.test"], "include_unmanaged": include_unmanaged},
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=("vacuum.test", entry, "serial", {}),
    ) as resolve:
        await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    resolve.assert_called_once_with(hass, stop, require_rooms=False)
    if include_unmanaged:
        coordinator.async_discard_current_room.assert_called_once_with()
        services.async_call.assert_awaited_once_with(
            "vacuum",
            "return_to_base",
            {"entity_id": "vacuum.test"},
            blocking=True,
            context=stop.context,
        )
    else:
        coordinator.async_discard_current_room.assert_not_called()
        services.async_call.assert_not_awaited()


async def test_room_native_plan_crud_is_complete(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {
            "room-kitchen": "Kitchen",
            "room-study": "Study",
            "other-room": "room-study",
        },
    )
    save = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "Away cleaning",
                "rooms": [
                    {
                        "room": "Kitchen",
                        "cleaning_mode": "vacuum_and_mop",
                        "coverage_setting": "standard",
                    }
                ],
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        saved = await _registered_handler(services, "save_plan")(save)
    assert saved["plan"]["id"] == "away_cleaning"
    assert saved["plan"]["rooms"][0]["room_id"] == "room-kitchen"

    add = ServiceCall(
        hass,
        DOMAIN,
        "save_plan_room",
        SAVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Away cleaning",
                "room": {
                    "room": "room-study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        added = await _registered_handler(services, "save_plan_room")(add)
    assert added["position"] == 2

    move = ServiceCall(
        hass,
        DOMAIN,
        "move_plan_room",
        MOVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "away_cleaning",
                "room": "Study",
                "new_position": 1,
            }
        ),
    )
    listing = ServiceCall(hass, DOMAIN, "list_plans", {"entity_id": ["vacuum.test"]})
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        moved = await _registered_handler(services, "move_plan_room")(move)
        plans = await _registered_handler(services, "list_plans")(listing)
    assert moved["room"]["room_id"] == "room-study"
    assert [room["room_id"] for room in plans["plans"][0]["rooms"]] == [
        "room-study",
        "room-kitchen",
    ]

    remove = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Away cleaning",
                "room": "Kitchen",
            }
        ),
    )
    select = ServiceCall(
        hass,
        DOMAIN,
        "select_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Away cleaning"}),
    )
    delete = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Away cleaning"}),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        removed = await _registered_handler(services, "delete_plan_room")(remove)
        selected = await _registered_handler(services, "select_plan")(select)
        deleted = await _registered_handler(services, "delete_plan")(delete)
    assert removed["deleted"]["room_id"] == "room-kitchen"
    assert selected["selected_plan_id"] == "away_cleaning"
    assert deleted["deleted_plan_id"] == "away_cleaning"
    assert manager.plans("serial") == {}


async def test_save_plan_reports_the_per_robot_plan_limit(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    manager._robot("serial")["plans"].update(
        {
            f"plan-{index}": {"name": f"Plan {index}", "rooms": []}
            for index in range(MAX_SAVED_PLANS_PER_ROBOT)
        }
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "One too many",
                "rooms": [{"room": "Kitchen"}],
            }
        ),
    )
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen"},
    )

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError, match="at most") as raised,
    ):
        await _registered_handler(services, "save_plan")(call)

    assert isinstance(raised.value.__cause__, SavedPlanLimitError)
    manager._store.async_save.assert_not_awaited()


async def test_save_plan_translates_cadence_edit_blocked_during_run(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = _area_floor_plan()
    room = floor_plan.rooms[0]
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    manager._robot("serial")["active_plan"] = {
        "plan_id": "home",
        "room_id": room.id,
    }
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=floor_plan)),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan_id": "home",
                "name": "Home",
                "rooms": [
                    {
                        "room": room.id,
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "cadence": {"scope": "plan", "mop_every_n": 3},
                    }
                ],
            }
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {room.id: room.name}),
        ),
        pytest.raises(
            ServiceValidationError, match="cannot change while its plan is running"
        ) as raised,
    ):
        await _registered_handler(services, "save_plan")(call)

    assert raised.value.translation_key == "invalid_plan"
    assert isinstance(raised.value.__cause__, ValueError)


async def test_delete_plan_translates_running_plan_lock(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan("serial", "home", {"name": "Home", "rooms": []})
    manager._robot("serial")["active_plan"] = {
        "plan_id": "home",
        "room_id": "room-office",
    }
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Home"}),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", SimpleNamespace(), "serial", {}),
        ),
        pytest.raises(
            ServiceValidationError, match="cannot be deleted while it is running"
        ) as raised,
    ):
        await _registered_handler(services, "delete_plan")(call)

    assert raised.value.translation_key == "plan_locked"
    assert isinstance(raised.value.__cause__, ValueError)
    assert manager.plan("serial", "home")["name"] == "Home"


async def test_room_crud_rejects_unknown_rooms_membership_and_positions(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "test",
        {
            "name": "Test",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen", "room-study": "Study"},
    )
    bad_room = ServiceCall(
        hass,
        DOMAIN,
        "save_plan_room",
        SAVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Test",
                "room": {"room": "Missing"},
            }
        ),
    )
    bad_delete = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Test",
                "room": "Study",
            }
        ),
    )
    bad_move = ServiceCall(
        hass,
        DOMAIN,
        "move_plan_room",
        MOVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Test",
                "room": "Kitchen",
                "new_position": 2,
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="Unknown Matic room"):
            await _registered_handler(services, "save_plan_room")(bad_room)
        with pytest.raises(ServiceValidationError, match="not part"):
            await _registered_handler(services, "delete_plan_room")(bad_delete)
        with pytest.raises(ServiceValidationError, match="position 2 is invalid"):
            await _registered_handler(services, "move_plan_room")(bad_move)

        update = ServiceCall(
            hass,
            DOMAIN,
            "save_plan_room",
            SAVE_PLAN_ROOM_SCHEMA(
                {
                    "entity_id": ["vacuum.test"],
                    "plan": "Test",
                    "room": {
                        "room": "Kitchen",
                        "cleaning_mode": "mop",
                        "coverage_setting": "standard",
                    },
                }
            ),
        )
        result = await _registered_handler(services, "save_plan_room")(update)
        assert result["position"] == 1
        assert manager.plan("serial", "test")["rooms"][0]["cleaning_mode"] == "mop"

        unknown = ServiceCall(
            hass,
            DOMAIN,
            "select_plan",
            PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
        )
        with pytest.raises(ServiceValidationError, match="Unknown Matic cleaning"):
            await _registered_handler(services, "select_plan")(unknown)


def test_saved_plan_context_requires_one_robot_and_live_rooms() -> None:
    """The room map must come from the coordinator, not published attributes.

    0.2.0 removed the vacuum's ``rooms`` state attribute, so this seam
    deliberately builds the context from the real coordinator floor plan.
    """
    call = MagicMock()
    hass = SimpleNamespace(states=SimpleNamespace(get=MagicMock(return_value=None)))
    floor_plan = SimpleNamespace(
        rooms=(
            SimpleNamespace(id="one", name="Kitchen"),
            SimpleNamespace(id="two", name="Study"),
        )
    )
    data = SimpleNamespace(
        info=SimpleNamespace(serial_number="synthetic-serial"),
        floor_plan=floor_plan,
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=data),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
    ):
        assert _saved_plan_context(hass, call)[2:] == (
            "synthetic-serial",
            {"one": "Kitchen", "two": "Study"},
        )
        assert _saved_plan_context(hass, call, require_current_floor=True)[3] == {
            "one": "Kitchen",
            "two": "Study",
        }
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
        with pytest.raises(ServiceValidationError, match="room map"):
            _saved_plan_context(hass, call, require_current_floor=True)
        entry.runtime_data.slam_map.floor_plan_is_current.return_value = True
        data.floor_plan = None
        with pytest.raises(ServiceValidationError, match="room map"):
            _saved_plan_context(hass, call)
        assert _saved_plan_context(hass, call, require_rooms=False)[3] == {}
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        _saved_plan_context(hass, call)


async def test_saved_plan_context_reads_rooms_the_vacuum_actually_exposes() -> None:
    """Guard the producer/consumer seam with the real vacuum entity.

    The context and the vacuum entity must agree on the same coordinator
    floor plan so a state-attribute change can never break plan services.
    """
    from custom_components.matic_robot import vacuum as vacuum_platform
    from tests.test_entities import _entry as entity_entry

    entry = entity_entry()
    entity = vacuum_platform.MaticVacuum(entry)
    call = MagicMock()
    hass = SimpleNamespace(states=SimpleNamespace(get=MagicMock(return_value=None)))

    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
    ):
        room_map = _saved_plan_context(hass, call)[3]

    assert room_map == entity.extra_state_attributes["rooms"]
    assert room_map == {"room-1": "Kitchen", "room-2": "Study"}


def _resolution_hass(*, loaded: bool = True, available: bool = True):
    entity = SimpleNamespace(platform=DOMAIN, config_entry_id="entry")
    registry = SimpleNamespace(async_get=MagicMock(return_value=entity))
    entry = SimpleNamespace(
        state=ConfigEntryState.LOADED if loaded else ConfigEntryState.SETUP_RETRY
    )
    state = SimpleNamespace(state="docked" if available else "unavailable")
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry)),
        states=SimpleNamespace(get=MagicMock(return_value=state)),
    )
    call = ServiceCall(
        hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"], "ordered": False}
    )
    referenced = SimpleNamespace(
        referenced={"vacuum.test"}, indirectly_referenced=set()
    )
    return hass, call, registry, referenced


def test_action_target_resolution_accepts_loaded_matic_vacuum() -> None:
    hass, call, registry, referenced = _resolution_hass()
    with (
        patch(
            "custom_components.matic_robot.services.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.services.er.async_get",
            return_value=registry,
        ),
    ):
        assert _resolve_loaded_matic_vacuums(hass, call) == ["vacuum.test"]


async def test_domain_service_rejects_unauthorized_direct_and_indirect_targets() -> (
    None
):
    user = SimpleNamespace(
        is_admin=False,
        permissions=SimpleNamespace(
            check_entity=MagicMock(
                side_effect=lambda entity_id, _policy: entity_id.endswith("allowed")
            )
        ),
    )
    hass = SimpleNamespace(
        auth=SimpleNamespace(async_get_user=AsyncMock(return_value=user))
    )
    handler = AsyncMock()
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        {"device_id": ["robot-device"]},
        context=Context(user_id="restricted-user"),
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.allowed", "vacuum.denied"],
        ),
        pytest.raises(Unauthorized) as raised,
    ):
        await _require_matic_control(hass, handler)(call)

    assert raised.value.entity_id == "vacuum.denied"
    handler.assert_not_awaited()


async def test_domain_service_allows_control_admin_and_system_contexts() -> None:
    handler = AsyncMock(return_value={"ok": True})
    allowed_user = SimpleNamespace(
        is_admin=False,
        permissions=SimpleNamespace(check_entity=MagicMock(return_value=True)),
    )
    admin = SimpleNamespace(
        is_admin=True,
        permissions=SimpleNamespace(check_entity=MagicMock(return_value=False)),
    )
    hass = SimpleNamespace(
        auth=SimpleNamespace(
            async_get_user=AsyncMock(side_effect=(allowed_user, admin, None))
        )
    )
    guarded = _require_matic_control(hass, handler)
    with patch(
        "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
        return_value=["vacuum.test"],
    ):
        assert await guarded(
            ServiceCall(
                hass,
                DOMAIN,
                "clean",
                {"entity_id": ["vacuum.test"]},
                context=Context(user_id="allowed-user"),
            )
        ) == {"ok": True}
        assert await guarded(
            ServiceCall(
                hass,
                DOMAIN,
                "clean",
                {"entity_id": ["vacuum.test"]},
                context=Context(user_id="admin-user"),
            )
        ) == {"ok": True}
        assert await guarded(
            ServiceCall(hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"]})
        ) == {"ok": True}
        with pytest.raises(UnknownUser):
            await guarded(
                ServiceCall(
                    hass,
                    DOMAIN,
                    "clean",
                    {"entity_id": ["vacuum.test"]},
                    context=Context(user_id="missing-user"),
                )
            )

    admin.permissions.check_entity.assert_not_called()
    assert handler.await_count == 3


@pytest.mark.parametrize(("loaded", "available"), [(False, True), (True, False)])
def test_action_target_resolution_rejects_unavailable_robot(loaded, available) -> None:
    hass, call, registry, referenced = _resolution_hass(
        loaded=loaded, available=available
    )
    with (
        patch(
            "custom_components.matic_robot.services.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.services.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="unavailable"),
    ):
        _resolve_loaded_matic_vacuums(hass, call)


def test_action_target_resolution_rejects_non_matic_target() -> None:
    hass, call, registry, referenced = _resolution_hass()
    registry.async_get.return_value = SimpleNamespace(
        platform="other", config_entry_id="entry"
    )
    with (
        patch(
            "custom_components.matic_robot.services.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.services.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="Select at least one"),
    ):
        _resolve_loaded_matic_vacuums(hass, call)


async def test_inspect_hermes_endpoint_returns_bounded_safe_snapshot() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    client = SimpleNamespace(
        async_inspect_endpoint=AsyncMock(
            return_value=(HermesCollectionEntry(b"key", b"payload"),)
        )
    )
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    call = ServiceCall(
        hass,
        DOMAIN,
        "inspect_hermes_endpoint",
        {
            "entity_id": ["vacuum.test"],
            "endpoint": "wifi_status",
            "limit": 1,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
    ):
        response = await _registered_handler(services, "inspect_hermes_endpoint")(call)
    assert response["kind"] == "property"
    assert response["entries"][0]["key_size"] == 3
    assert response["entries"][0]["value_size"] == 7
    assert "key" not in response["entries"][0]
    client.async_inspect_endpoint.assert_awaited_once_with("wifi_status", limit=1)


async def test_inspect_hermes_endpoint_requires_exactly_one_robot() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "inspect_hermes_endpoint",
        {
            "entity_id": ["vacuum.one", "vacuum.two"],
            "endpoint": "wifi_status",
            "limit": 1,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        await _registered_handler(services, "inspect_hermes_endpoint")(call)


async def test_inspect_hermes_endpoint_fingerprints_payloads() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    client = SimpleNamespace(
        async_inspect_endpoint=AsyncMock(
            return_value=(HermesCollectionEntry(b"key", b"payload"),)
        )
    )
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    call = ServiceCall(
        hass,
        DOMAIN,
        "inspect_hermes_endpoint",
        {
            "entity_id": ["vacuum.test"],
            "endpoint": "wifi_status",
            "limit": 1,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
    ):
        response = await _registered_handler(services, "inspect_hermes_endpoint")(call)
    assert response["entries"][0]["key_sha256"] == (
        "2c70e12b7a0646f92279f427c7b38e7334d8e5389cff167a1dc30e73f826b683"
    )
    assert response["entries"][0]["value_sha256"] == (
        "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5"
    )


async def test_inspect_pose_endpoint_returns_only_safe_vector_paths() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    client = SimpleNamespace(
        async_inspect_endpoint=AsyncMock(
            return_value=(HermesCollectionEntry(b"", b"synthetic"),)
        )
    )
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    call = ServiceCall(
        hass,
        DOMAIN,
        "inspect_hermes_endpoint",
        {
            "entity_id": ["vacuum.test"],
            "endpoint": "latest_pose",
            "limit": 1,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
        patch(
            "custom_components.matic_robot.services.pose_vector_paths",
            return_value=((2, 1, 1),),
        ),
    ):
        response = await _registered_handler(services, "inspect_hermes_endpoint")(call)

    assert response["pose_vector_paths"] == [[2, 1, 1]]


async def test_firmware_snapshot_persists_safe_full_endpoint_sweep() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)

    async def inspect(name: str, *, limit: int):
        assert limit == 1
        if name == "zones":
            return ()
        if name == "map_integrated":
            raise CannotConnectError("synthetic failure with private context")
        return (HermesCollectionEntry(b"key", b"value"),)

    client = SimpleNamespace(async_inspect_endpoint=AsyncMock(side_effect=inspect))
    state = SimpleNamespace(
        telemetry=SimpleNamespace(software_version="v168.11", protocol_version=25),
        operational=SimpleNamespace(software_version="fallback"),
    )
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            client=client, coordinator=SimpleNamespace(data=state)
        ),
    )
    call = ServiceCall(
        hass,
        DOMAIN,
        "firmware_snapshot",
        {"entity_id": ["vacuum.test"]},
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
        patch(
            "custom_components.matic_robot.firmware.snapshot_timestamp",
            return_value="timestamp",
        ),
    ):
        response = await _registered_handler(services, "firmware_snapshot")(call)

    assert response["endpoint_count"] == len(HERMES_ENDPOINTS)
    assert response["analysis_version"] == ANALYSIS_VERSION
    assert response["populated_endpoints"] == len(HERMES_ENDPOINTS) - 2
    assert response["empty_endpoints"] == 1
    assert response["failed_endpoints"] == 1
    assert response["structural_endpoints"] == 0
    assert response["wire_shape_count"] == 0
    failed = next(item for item in response["endpoints"] if item["status"] == "error")
    assert failed["error_type"] == "CannotConnectError"
    assert "synthetic failure" not in repr(response)
    tracker = hass.data[DOMAIN]["firmware_tracker"]
    tracker.async_record_snapshot.assert_awaited_once()


async def test_firmware_snapshot_requires_exactly_one_robot() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "firmware_snapshot",
        {"entity_id": ["vacuum.one", "vacuum.two"]},
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        await _registered_handler(services, "firmware_snapshot")(call)


async def test_plan_runs_reject_disabled_plans_and_unknown_selection(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial", "disabled", {"name": "Disabled", "enabled": False, "rooms": []}
    )
    services = await _registered_services(hass, manager)
    floor_plan = _area_floor_plan()
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=floor_plan)),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    context = ("vacuum.test", entry, "serial", {"one": "Kitchen"})
    disabled = ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Disabled"}),
    )
    missing = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="disabled"):
            await _registered_handler(services, "intelligent_clean")(disabled)
        with pytest.raises(ServiceValidationError, match="Unknown Matic cleaning"):
            await _registered_handler(services, "run_selected_plan")(missing)


async def test_save_plan_rejects_names_that_produce_no_plan_id(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"room-kitchen": "Kitchen"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "???",
                "rooms": [{"room": "Kitchen"}],
            }
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as excinfo,
    ):
        await _registered_handler(services, "save_plan")(call)
    assert "Plan ID is empty" in str(excinfo.value)
    assert excinfo.value.translation_key == "invalid_plan"
    assert excinfo.value.translation_placeholders == {"error": "Plan ID is empty"}
    assert manager.plans("serial") == {}


async def test_deleting_the_last_room_disables_the_plan(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "solo",
        {
            "name": "Solo",
            "enabled": True,
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"room-kitchen": "Kitchen"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA(
            {"entity_id": ["vacuum.test"], "plan": "Solo", "room": "Kitchen"}
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        removed = await _registered_handler(services, "delete_plan_room")(call)
    assert removed["deleted"]["room_id"] == "room-kitchen"
    saved = manager.plan("serial", "solo")
    assert saved["rooms"] == []
    assert saved["enabled"] is False


async def test_room_edits_reject_rooms_outside_the_plan_or_map(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "test",
        {
            "name": "Test",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen", "room-study": "Study"},
    )
    outside_plan = ServiceCall(
        hass,
        DOMAIN,
        "move_plan_room",
        MOVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Test",
                "room": "Study",
                "new_position": 1,
            }
        ),
    )
    unmapped = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA(
            {"entity_id": ["vacuum.test"], "plan": "Test", "room": "Nowhere"}
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="not part of this plan"):
            await _registered_handler(services, "move_plan_room")(outside_plan)
        with pytest.raises(ServiceValidationError, match="Unknown Matic room: Nowhere"):
            await _registered_handler(services, "delete_plan_room")(unmapped)
    assert manager.plan("serial", "test")["rooms"][0]["room_id"] == "room-kitchen"


async def test_room_cancellation_records_history_and_reraises() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_cancelled=AsyncMock(),
        cancellation_reason=MagicMock(return_value=None),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    with (
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_vacuum_state",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_run_room(
            hass, _execution_call(hass), manager, "vacuum.test", "serial", room
        )
    manager.async_mark_cancelled.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_cancelled"


async def test_room_cancellation_preserves_low_charge_reason() -> None:
    """Room cleanup carries suspension evidence to the plan finalizer."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_cancelled=AsyncMock(),
        cancellation_reason=MagicMock(return_value=None),
        snapshot=MagicMock(
            return_value={
                "active_plan": {
                    "status": "suspended",
                    "suspend_reason": "low_charge",
                }
            }
        ),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    with (
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_vacuum_state",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        pytest.raises(PlanCancelledError) as excinfo,
    ):
        await _async_run_room(
            hass, _execution_call(hass), manager, "vacuum.test", "serial", room
        )
    assert excinfo.value.suspend_reason == "low_charge"


@pytest.mark.parametrize("changes_during_history", [False, True])
async def test_room_dispatch_rechecks_exact_floor_before_robot_command(
    changes_during_history: bool,
) -> None:
    """No room IDs are sent after either floor-coherence guard fails."""
    services = SimpleNamespace(async_call=AsyncMock())
    hass = SimpleNamespace(services=services)
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    session_history = AsyncMock(return_value=())
    floor_is_current = MagicMock(
        side_effect=[True, False] if changes_during_history else [False]
    )
    on_dispatch = MagicMock()

    with pytest.raises(ServiceValidationError) as excinfo:
        await _async_dispatch_leg_command(
            hass,
            _execution_call(hass),
            "vacuum.test",
            [room],
            17,
            session_history,
            floor_is_current=floor_is_current,
            on_dispatch=on_dispatch,
        )

    assert excinfo.value.translation_key == "room_plan_unavailable"
    if changes_during_history:
        session_history.assert_awaited_once()
    else:
        session_history.assert_not_awaited()
    on_dispatch.assert_not_called()
    services.async_call.assert_not_awaited()


async def test_room_handoff_after_returning_does_not_credit_completion(hass) -> None:
    """A targeted return permits handoff without claiming room completion."""

    async def send_command(*_args, **_kwargs) -> None:
        hass.states.async_set("vacuum.test", "cleaning", {"current_area": "Study"})

        async def finish_room() -> None:
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.test",
                "returning",
                {"current_area": "Study", "low_charge": False},
            )

        hass.async_create_task(finish_room(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    refresh = AsyncMock()

    with patch(
        "custom_components.matic_robot.managed_executor.ROOM_STATUS_REFRESH_SECONDS", 0
    ):
        await _async_run_room(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            CleaningRoom("room-study", "Study", "vacuum", "quick"),
            refresh=refresh,
            active_session=AsyncMock(return_value=False),
        )

    assert hass.states.get("vacuum.test").state == "returning"
    refresh.assert_awaited()
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()
    manager.async_mark_failed.assert_not_awaited()


async def test_app_stop_after_partial_room_never_credits_or_advances(hass) -> None:
    """A direct idle transition is an interruption and receives no credit."""

    async def send_command(*_args, **_kwargs) -> None:
        hass.states.async_set("vacuum.test", "cleaning", {"current_area": "Study"})

        async def stop_room() -> None:
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            hass.states.async_set("vacuum.test", "idle", {"current_area": "Study"})

        hass.async_create_task(stop_room(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    session_reader = AsyncMock(return_value=False)
    sender = AsyncMock()

    with pytest.raises(ServiceValidationError):
        await _async_run_room(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            CleaningRoom("room-study", "Study", "vacuum", "quick"),
            motion_token=17,
            active_session=session_reader,
            managed_user_command=sender,
        )

    session_reader.assert_not_awaited()
    manager.async_mark_interrupted.assert_awaited_once()
    manager.async_mark_ended_unverified.assert_not_awaited()
    manager.async_mark_completed.assert_not_awaited()


@pytest.mark.parametrize(
    ("error", "expected_type", "expected_reason_code"),
    [
        (
            MaticError("robot rejected the command"),
            ServiceValidationError,
            "robot_error",
        ),
        (
            ServiceValidationError("translated failure"),
            ServiceValidationError,
            "managed_failure",
        ),
        (HomeAssistantError("call failed"), HomeAssistantError, "managed_failure"),
    ],
)
async def test_room_failures_translate_client_errors_at_boundary(
    error, expected_type, expected_reason_code
) -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
    )
    finish_room_event = asyncio.Event()
    finish_room_event.set()
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    with (
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_vacuum_state",
            AsyncMock(side_effect=error),
        ),
        pytest.raises(expected_type) as excinfo,
    ):
        await _async_run_room(
            hass,
            _execution_call(hass),
            manager,
            "vacuum.test",
            "serial",
            room,
            finish_room_event=finish_room_event,
        )
    if isinstance(error, MaticError):
        assert excinfo.value.translation_key == "robot_command_failed"
        assert "robot rejected" not in str(excinfo.value)
    else:
        assert excinfo.value is error
    manager.async_mark_failed.assert_awaited_once()
    assert not finish_room_event.is_set()
    manager.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_failed"
    event_data = bus.async_fire.call_args_list[-1].args[1]
    assert event_data["reason_code"] == expected_reason_code
    assert event_data["cause"] == "unknown"


@pytest.mark.parametrize("run_id", [None, "synthetic-run"])
async def test_oem_stop_reconciliation_credits_late_native_session(
    hass, run_id
) -> None:
    """The ten-minute OEM stop can finish a room after the runner saw an error."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    events = []
    hass.bus.async_listen("matic_robot_room_reconciled", events.append)
    await manager.async_mark_started("serial", "away", room)
    await manager.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
            "run_id": run_id,
        },
    )
    assert manager.pending_native_reconciliation("serial").get("run_id") == run_id
    session = CleaningSession(
        (now - timedelta(seconds=10)).isoformat(),
        (now - timedelta(seconds=1)).isoformat(),
        9,
        (room.name,),
        ((room.name, 9),),
        True,
        (room.name,),
    )
    reads = AsyncMock(side_effect=[(), (CleaningSessionRecord(b"new", session),)])
    hass.states.async_set("vacuum.test", "docked")
    confirmed = MagicMock()
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, now - timedelta(seconds=5), run_id=run_id
    )
    with patch(
        "custom_components.matic_robot.managed_executor.OEM_STOP_RECONCILIATION_POLL_SECONDS",
        0,
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
            frozenset(),
            None,
            reads,
            confirmed,
            None,
        )

    record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][room.room_id]
    assert record["last_result"] == "completed"
    assert record["last_duration_seconds"] == 9
    assert manager.snapshot("serial")["native_reconciliation_pending"] is False
    confirmed.assert_called_once_with(room.name)
    await hass.async_block_till_done()
    assert events[0].data.get("run_id") == run_id


async def test_reconciliation_abandons_a_room_seen_ending_in_place(hass) -> None:
    """Watching the robot stop disproves the completion its record claims."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    dispatched_at = dt_util.utcnow() - timedelta(seconds=30)
    manager._robot("serial")["pending_native_reconciliation"] = {
        "plan_id": "away",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": dispatched_at.isoformat(),
        "expires_at": (dt_util.utcnow() + timedelta(minutes=12)).isoformat(),
    }
    ended = dt_util.utcnow()
    record = CleaningSessionRecord(
        b"late",
        CleaningSession(
            (ended - timedelta(seconds=20)).isoformat(),
            ended.isoformat(),
            20,
            ("Study",),
            (("Study", 20),),
            True,
            completed_rooms=("Study",),
        ),
    )
    hass.states.async_set("vacuum.matic", "idle", {"current_area": "Study"})
    confirmed: list[str] = []

    with (
        patch(
            "custom_components.matic_robot.managed_executor.OEM_STOP_RECONCILIATION_SECONDS",
            0.05,
        ),
        patch(
            "custom_components.matic_robot.managed_executor."
            "OEM_STOP_RECONCILIATION_POLL_SECONDS",
            0,
        ),
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "serial",
            "vacuum.matic",
            room,
            _NativeReconciliation("away", room.room_id, room.name, dispatched_at),
            frozenset(),
            None,
            AsyncMock(return_value=(record,)),
            confirmed.append,
            None,
        )

    assert confirmed == []
    snapshot = manager.snapshot("serial")
    assert snapshot["last_completed_by_room"].get(room.room_id) is None


async def test_native_stop_reconciliation_handles_transport_and_timeout(hass) -> None:
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager._store = SimpleNamespace(async_save=save)
    await manager.async_mark_started("serial", "away", room)
    await manager.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        },
    )
    save.reset_mock()
    hass.states.async_set("vacuum.test", "cleaning")
    history = AsyncMock(side_effect=MaticError("synthetic offline"))
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, now - timedelta(seconds=5)
    )
    with (
        patch(
            "custom_components.matic_robot.managed_executor.monotonic",
            side_effect=[0, 0, 1],
        ),
        patch(
            "custom_components.matic_robot.managed_executor.OEM_STOP_RECONCILIATION_SECONDS",
            1,
        ),
        patch(
            "custom_components.matic_robot.managed_executor.OEM_STOP_RECONCILIATION_POLL_SECONDS",
            0,
        ),
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
            frozenset(),
            None,
            history,
            None,
            None,
        )
    history.assert_awaited_once()
    assert manager.snapshot("serial")["native_reconciliation_pending"] is False
    save.assert_awaited_once()


async def test_native_stop_reconciliation_expires_without_history_baseline(
    hass,
) -> None:
    """Missing pre-dispatch history disables credit, not durable cleanup."""
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=5)
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager._store = SimpleNamespace(async_save=save)
    await manager.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at.isoformat(),
        },
    )
    save.reset_mock()
    history = AsyncMock()
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, dispatched_at
    )

    with (
        patch(
            "custom_components.matic_robot.managed_executor.OEM_STOP_RECONCILIATION_SECONDS",
            1,
        ),
        patch(
            "custom_components.matic_robot.managed_executor.asyncio.sleep", AsyncMock()
        ) as sleep,
    ):
        await _async_expire_native_reconciliation(
            hass,
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
        )

    sleep.assert_awaited_once_with(1)
    history.assert_not_awaited()
    assert manager.snapshot("serial")["native_reconciliation_pending"] is False
    save.assert_awaited_once()


async def test_clear_native_reconciliation_requires_the_exact_marker(hass) -> None:
    """An old watcher cannot remove a newer durable reconciliation marker."""
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager._store = SimpleNamespace(async_save=save)
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    dispatched_at = dt_util.utcnow() - timedelta(seconds=5)
    await manager.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at.isoformat(),
        },
    )
    save.reset_mock()

    assert (
        await manager.async_clear_native_reconciliation(
            "serial", "away", room.room_id, dispatched_at - timedelta(seconds=1)
        )
        is False
    )
    assert manager.snapshot("serial")["native_reconciliation_pending"] is True
    save.assert_not_awaited()

    save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError, match="disk unavailable"):
        await manager.async_clear_native_reconciliation(
            "serial", "away", room.room_id, dispatched_at
        )
    assert manager.snapshot("serial")["native_reconciliation_pending"] is True
    save.side_effect = None

    assert (
        await manager.async_clear_native_reconciliation(
            "serial", "away", room.room_id, dispatched_at
        )
        is True
    )
    assert manager.snapshot("serial")["native_reconciliation_pending"] is False
    assert save.await_count == 2  # failed clear plus successful retry


async def test_native_reconciliation_schedule_and_stop_fence_guards(hass) -> None:
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, now - timedelta(seconds=5)
    )
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    _schedule_native_reconciliation(
        SimpleNamespace(),
        manager,
        "serial",
        "vacuum.test",
        room,
        reconciliation,
        frozenset(),
        None,
        AsyncMock(),
        None,
        None,
    )
    created: list[str] = []

    def create_background_task(coro, name: str) -> None:
        created.append(name)
        coro.close()

    _schedule_native_reconciliation(
        SimpleNamespace(async_create_background_task=create_background_task),
        manager,
        "serial",
        "vacuum.test",
        room,
        reconciliation,
        frozenset(),
        None,
        AsyncMock(),
        None,
        None,
    )
    _schedule_native_reconciliation(
        SimpleNamespace(async_create_background_task=create_background_task),
        manager,
        "serial",
        "vacuum.test",
        room,
        reconciliation,
        None,
        None,
        AsyncMock(),
        None,
        None,
    )
    assert len(created) == 2

    hass.states.async_set("vacuum.test", "cleaning")
    await _clear_stop_pending_if_stable(manager, "serial", hass, "vacuum.test")
    manager_with_fence = CleaningPlanManager(hass)
    manager_with_fence._store = SimpleNamespace(async_save=AsyncMock())
    manager_with_fence.mark_stop_pending("serial")
    with pytest.raises(ServiceValidationError) as blocked:
        await _ensure_stop_settled(hass, manager_with_fence, "serial", "vacuum.test")
    assert blocked.value.translation_key == "robot_stop_pending"
    hass.states.async_set("vacuum.test", "docked")
    await _ensure_stop_settled(hass, manager_with_fence, "serial", "vacuum.test")
    assert manager_with_fence.stop_pending("serial") is False

    manager_with_fence.mark_stop_pending("serial")
    await _clear_stop_pending_if_stable(
        manager_with_fence, "serial", hass, "vacuum.test"
    )
    await _ensure_stop_settled(hass, manager_with_fence, "serial", "vacuum.test")
    assert manager_with_fence.stop_pending("serial") is False


async def test_native_reconciliation_schedule_registers_lifecycle_task() -> None:
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    reconciliation = _NativeReconciliation(
        "away", room.room_id, room.name, dt_util.utcnow() - timedelta(seconds=5)
    )
    registered = MagicMock()
    manager = SimpleNamespace(
        async_mark_native_completed=AsyncMock(),
        register_reconciliation_task=registered,
    )

    def create_background_task(coro, name: str):
        return asyncio.create_task(coro, name=name)

    with patch(
        "custom_components.matic_robot.managed_executor._async_reconcile_native_stop",
        AsyncMock(),
    ):
        _schedule_native_reconciliation(
            SimpleNamespace(async_create_background_task=create_background_task),
            manager,
            "serial",
            "vacuum.test",
            room,
            reconciliation,
            frozenset(),
            None,
            AsyncMock(),
            None,
            None,
        )
        task = registered.call_args.args[1]
        await task

    registered.assert_called_once_with("serial", task)


def test_native_completion_match_rejects_old_or_invalid_records() -> None:
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=5)
    old = CleaningSessionRecord(
        b"old",
        CleaningSession(
            (now - timedelta(seconds=10)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            1,
            (room.name,),
            ((room.name, 1),),
            True,
            (room.name,),
        ),
    )
    missing_dates = CleaningSessionRecord(
        b"missing",
        CleaningSession(None, None, None, (room.name,), (), True, (room.name,)),
    )
    future = CleaningSessionRecord(
        b"future",
        CleaningSession(
            (now + timedelta(seconds=1)).isoformat(),
            (now + timedelta(seconds=2)).isoformat(),
            1,
            (room.name,),
            ((room.name, 1),),
            True,
            (room.name,),
        ),
    )
    assert (
        _native_completion_match((old,), frozenset({b"old"}), room, dispatched_at)
        is None
    )
    assert (
        _native_completion_match((missing_dates,), frozenset(), room, dispatched_at)
        is None
    )
    assert _native_completion_match((future,), frozenset(), room, dispatched_at) is None


async def test_wait_returns_immediately_when_state_is_already_desired(hass) -> None:
    hass.states.async_set("vacuum.test", "cleaning")
    state = await _async_wait_for_vacuum_state(hass, "vacuum.test", {"cleaning"}, 10)
    assert state == "cleaning"


async def test_wait_ignores_removed_entities_and_fails_on_error_transition(
    hass,
) -> None:
    hass.states.async_set("vacuum.test", "idle")
    waiting = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.test", {"cleaning"}, 10)
    )
    await asyncio.sleep(0)
    hass.states.async_remove("vacuum.test")
    await asyncio.sleep(0)
    assert not waiting.done()
    hass.states.async_set("vacuum.test", "error")
    with pytest.raises(ServiceValidationError, match="reported an error") as excinfo:
        await waiting
    assert excinfo.value.translation_key == "robot_error"


async def test_wait_returns_reached_state_while_cancel_stays_pending(hass) -> None:
    hass.states.async_set("vacuum.test", "cleaning")
    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.test", {"docked"}, 10, cancel)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.test", "docked")
    assert await waiting == "docked"
    assert not cancel.is_set()


async def test_execute_rooms_skips_every_room_once_cancellation_is_set(hass) -> None:
    cancel_event = asyncio.Event()
    cancel_event.set()
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
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
    manager.prepare_run = MagicMock(return_value=cancel_event)
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_entire_plan",
        {
            "plan_id": "away",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": True,
        },
    )
    room = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "quick")
    with patch(
        "custom_components.matic_robot.managed_executor._async_run_room", AsyncMock()
    ) as run:
        await _async_execute_rooms(hass, call, manager, "vacuum.test", "serial", [room])
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
            "custom_components.matic_robot.managed_executor._ensure_stop_settled",
            side_effect=delayed_check,
        ),
        patch("custom_components.matic_robot.managed_executor._async_run_leg") as run,
    ):
        task = asyncio.create_task(
            _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.test",
                "serial",
                [room],
                managed_user_command=command,
            )
        )
        await entered.wait()
        try:
            assert manager.lock("serial").locked()
            assert manager.request_stop("serial").behavior == "immediate"
            if replace:
                async with manager.external_motion("serial"):
                    pass
            with pytest.raises(ServiceValidationError, match="already running"):
                await _async_execute_rooms(
                    hass,
                    call,
                    manager,
                    "vacuum.test",
                    "serial",
                    [room],
                )
        finally:
            release.set()
            await task
    run.assert_not_awaited()
    command.assert_not_awaited()
    assert not manager.lock("serial").locked()
    assert not manager.has_managed_task("serial")


@pytest.mark.parametrize("waiting_stage", ["preflight", "lock", "persist"])
async def test_stop_fences_a_pending_custom_area(hass, waiting_stage: str) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor = _area_floor_plan()
    await manager.async_save_area(
        "serial",
        "test_area",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Test area",
            "circles": [{"x": 1.0, "y": 1.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "map_binding": binding_for_floor_plan(floor),
        },
    )
    services = await _registered_services(hass, manager)
    client = SimpleNamespace(async_start_custom_coverage=AsyncMock())
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            coordinator=SimpleNamespace(
                data=SimpleNamespace(floor_plan=floor),
                async_request_refresh=AsyncMock(),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    entered = asyncio.Event()
    release = asyncio.Event()
    first_check = True

    async def preflight(*_args) -> None:
        nonlocal first_check
        if first_check:
            first_check = False
            if waiting_stage != "persist":
                entered.set()
            if waiting_stage == "preflight":
                await release.wait()

    async def persist(*_args) -> None:
        if waiting_stage == "persist":
            entered.set()
            await release.wait()

    lock = manager.command_lock("serial")
    if waiting_stage == "lock":
        await lock.acquire()
    call = ServiceCall(hass, DOMAIN, "clean_area", {"area": "test_area"})
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"room-office": "Office"}),
        ),
        patch(
            "custom_components.matic_robot.services._ensure_stop_settled",
            side_effect=preflight,
        ),
        patch.object(
            manager, "_async_persist_reconciliation_removal", side_effect=persist
        ),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await entered.wait()
        manager.request_stop("serial")
        release.set()
        if waiting_stage == "lock":
            lock.release()
        with pytest.raises(ServiceValidationError, match="superseded"):
            await task
    client.async_start_custom_coverage.assert_not_awaited()


def test_entry_lookup_returns_loaded_entry_and_rejects_stale_references() -> None:
    registry = SimpleNamespace(
        async_get=MagicMock(return_value=SimpleNamespace(config_entry_id="entry"))
    )
    entry = SimpleNamespace()
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry))
    )
    with patch(
        "custom_components.matic_robot.services.er.async_get", return_value=registry
    ):
        assert _entry_for_entity(hass, "vacuum.test") is entry
        hass.config_entries.async_get_entry.return_value = None
        with pytest.raises(ServiceValidationError, match="unavailable"):
            _entry_for_entity(hass, "vacuum.test")
