"""Integration setup and unload lifecycle tests."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.components import frontend
from homeassistant.exceptions import ConfigEntryAuthFailed

from custom_components.matic_robot import (
    _async_resume_native_reconciliation,
    _floor_plan_supports_area_binding,
    _register_native_history_sync,
    _register_slam_map_floor_plan_sync,
    _schedule_native_reconciliation_recovery,
    async_remove_entry,
    async_setup,
    async_setup_entry,
    async_unload_entry,
)
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
    DATA_FIRMWARE_TRACKER,
    DATA_LLM_API,
    DATA_PLAN_MANAGER,
    DOMAIN,
    PLATFORMS,
)
from custom_components.matic_robot.plans import (
    STOP_FENCE_EXPIRES_AT,
    AreaBindingUpgradeResult,
    CleaningPlanManager,
)


def _entry() -> SimpleNamespace:
    def close_background_coroutine(hass, target, name):
        target.close()

    return SimpleNamespace(
        data={
            "host": "192.0.2.1",
            "port": 16320,
            CONF_HOSTNAME: "robot.invalid",
            CONF_SERIAL_NUMBER: "synthetic-serial",
            CONF_CERTIFICATE_FINGERPRINT: "00" * 32,
            CONF_HERMES_CREDENTIAL: "test-credential",
        },
        options={},
        runtime_data=None,
        entry_id="entry",
        async_create_background_task=MagicMock(side_effect=close_background_coroutine),
        async_on_unload=MagicMock(),
    )


def test_floor_plan_area_binding_support_requires_usable_geometry() -> None:
    assert not _floor_plan_supports_area_binding(None)
    assert not _floor_plan_supports_area_binding(
        FloorPlan(42, "synthetic-partition", b"synthetic-partition", ())
    )
    assert _floor_plan_supports_area_binding(
        FloorPlan(
            42,
            "synthetic-partition",
            b"synthetic-partition",
            (
                Room(
                    "room",
                    "Room",
                    "room",
                    b"room",
                    ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0)),
                ),
            ),
        )
    )


async def test_slam_map_mission_change_refreshes_the_cached_floor_plan(hass) -> None:
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    floor_plan = FloorPlan(42, "synthetic-partition", b"partition", ())
    coordinator = SimpleNamespace(
        data=SimpleNamespace(floor_plan=floor_plan),
        async_request_floor_plan_refresh=AsyncMock(),
    )
    listener: object | None = None

    def add_listener(candidate):
        nonlocal listener
        listener = candidate
        return remove_listener

    slam_map = SimpleNamespace(
        floor_plan_is_current=MagicMock(return_value=False),
        async_add_listener=add_listener,
    )

    _register_slam_map_floor_plan_sync(hass, entry, slam_map, coordinator)
    assert callable(listener)
    listener()
    listener()
    assert len(scheduled) == 1
    await scheduled[0]
    coordinator.async_request_floor_plan_refresh.assert_awaited_once()
    entry.async_on_unload.assert_called_once_with(remove_listener)

    slam_map.floor_plan_is_current.return_value = True
    listener()
    assert len(scheduled) == 1


async def test_native_reconciliation_recovery_is_lifecycle_bound() -> None:
    pending = {
        "plan_id": "away",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": "2026-08-13T12:00:00+00:00",
        "expires_at": "2026-08-13T12:12:00+00:00",
    }
    plans = MagicMock()
    plans.pending_native_reconciliation.return_value = None
    entry = SimpleNamespace(async_create_background_task=MagicMock())
    hass = MagicMock()
    client = MagicMock()
    coordinator = MagicMock()

    _schedule_native_reconciliation_recovery(
        hass, entry, client, coordinator, plans, "synthetic-serial"
    )
    entry.async_create_background_task.assert_not_called()

    lifecycle_task = asyncio.create_task(asyncio.sleep(0))

    def capture_task(_hass, target, _name):
        target.close()
        return lifecycle_task

    plans.pending_native_reconciliation.return_value = pending
    entry.async_create_background_task.side_effect = capture_task
    _schedule_native_reconciliation_recovery(
        hass, entry, client, coordinator, plans, "synthetic-serial"
    )
    await lifecycle_task

    assert entry.async_create_background_task.call_args.args[2] == (
        "matic_robot native stop recovery"
    )
    plans.register_reconciliation_task.assert_called_once_with(
        "synthetic-serial", lifecycle_task
    )


async def test_restart_recovery_credits_late_native_completion(hass) -> None:
    now = datetime(2026, 8, 13, 12, tzinfo=UTC)
    room = Room(
        "room-kitchen",
        "Kitchen",
        "protocol-kitchen",
        b"kitchen",
        ((0, 0), (1, 0), (1, 1), (0, 1)),
    )
    floor_plan = FloorPlan(1, "partition", b"partition", (room,))
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    manager._robot("synthetic-serial")["pending_native_reconciliation"] = {
        "plan_id": "away",
        "room_id": room.id,
        "room": room.name,
        "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        "expires_at": (now + timedelta(seconds=10)).isoformat(),
    }
    pending = manager.pending_native_reconciliation("synthetic-serial")
    assert pending is not None
    native_record = CleaningSessionRecord(
        b"late-session",
        CleaningSession(
            (now - timedelta(seconds=4)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            3,
            (room.name,),
            ((room.name, 3),),
            True,
            (room.name,),
        ),
    )
    client = SimpleNamespace(
        async_get_cleaning_session_records=AsyncMock(return_value=(native_record,))
    )
    coordinator = SimpleNamespace(data=SimpleNamespace(floor_plan=floor_plan))

    with (
        patch("custom_components.matic_robot.dt_util.utcnow", return_value=now),
        patch("custom_components.matic_robot.asyncio.sleep", AsyncMock()) as sleep,
    ):
        await _async_resume_native_reconciliation(
            client,
            coordinator,
            manager,
            "synthetic-serial",
            pending,
        )

    sleep.assert_awaited_once_with(5)
    client.async_get_cleaning_session_records.assert_awaited_once()
    assert manager.pending_native_reconciliation("synthetic-serial") is None
    room_history = manager.snapshot("synthetic-serial")["plan_history"]["away"][
        "rooms"
    ][room.id]
    assert room_history["last_result"] == "completed"
    assert room_history["last_duration_seconds"] == 3


async def test_restart_recovery_expires_marker_after_transport_error(hass) -> None:
    now = datetime(2026, 8, 13, 12, tzinfo=UTC)
    dispatched_at = now - timedelta(seconds=5)
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    robot = manager._robot("synthetic-serial")
    robot["pending_native_reconciliation"] = {
        "plan_id": "away",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": dispatched_at.isoformat(),
        "expires_at": (now + timedelta(seconds=1)).isoformat(),
    }
    robot[STOP_FENCE_EXPIRES_AT] = (now + timedelta(seconds=1)).isoformat()
    manager._stop_fences["synthetic-serial"] = 0
    pending = manager.pending_native_reconciliation("synthetic-serial")
    assert pending is not None
    client = SimpleNamespace(
        async_get_cleaning_session_records=AsyncMock(
            side_effect=CannotConnectError("history unavailable")
        )
    )
    coordinator = SimpleNamespace(data=SimpleNamespace(floor_plan=None))

    with (
        patch(
            "custom_components.matic_robot.dt_util.utcnow",
            side_effect=(now, now + timedelta(seconds=2)),
        ),
        patch("custom_components.matic_robot.asyncio.sleep", AsyncMock()) as sleep,
    ):
        await _async_resume_native_reconciliation(
            client,
            coordinator,
            manager,
            "synthetic-serial",
            pending,
        )

    sleep.assert_awaited_once_with(1)
    client.async_get_cleaning_session_records.assert_awaited_once()
    assert manager.pending_native_reconciliation("synthetic-serial") is None
    assert STOP_FENCE_EXPIRES_AT not in manager._robot("synthetic-serial")
    manager._store.async_save.assert_awaited_once()


async def test_restart_recovery_does_not_import_for_replacement_marker(hass) -> None:
    now = datetime(2026, 8, 13, 12, tzinfo=UTC)
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    robot = manager._robot("synthetic-serial")
    robot["pending_native_reconciliation"] = {
        "plan_id": "away",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        "expires_at": (now + timedelta(seconds=10)).isoformat(),
    }
    pending = manager.pending_native_reconciliation("synthetic-serial")
    assert pending is not None
    replacement = {
        **pending,
        "dispatched_at": now.isoformat(),
    }

    async def replace_marker() -> tuple[CleaningSessionRecord, ...]:
        robot["pending_native_reconciliation"] = replacement
        return ()

    client = SimpleNamespace(
        async_get_cleaning_session_records=AsyncMock(side_effect=replace_marker)
    )
    coordinator = SimpleNamespace(data=SimpleNamespace(floor_plan=None))

    with (
        patch("custom_components.matic_robot.dt_util.utcnow", return_value=now),
        patch("custom_components.matic_robot.asyncio.sleep", AsyncMock()),
        patch.object(
            manager,
            "async_import_native_history",
            wraps=manager.async_import_native_history,
        ) as import_history,
    ):
        await _async_resume_native_reconciliation(
            client,
            coordinator,
            manager,
            "synthetic-serial",
            pending,
        )

    import_history.assert_not_awaited()
    assert manager.pending_native_reconciliation("synthetic-serial") == replacement


async def test_setup_registers_services_without_media_view() -> None:
    hass = SimpleNamespace(
        http=SimpleNamespace(register_view=MagicMock()),
        bus=SimpleNamespace(async_listen=MagicMock(return_value=MagicMock())),
        services=SimpleNamespace(async_register=MagicMock()),
        data={},
    )

    history = SimpleNamespace(async_load=AsyncMock())
    firmware = SimpleNamespace(async_load=AsyncMock())
    with (
        patch(
            "custom_components.matic_robot.services.CleaningPlanManager",
            return_value=history,
        ),
        patch(
            "custom_components.matic_robot.services.FirmwareTracker",
            return_value=firmware,
        ),
        patch(
            "custom_components.matic_robot.async_register_matic_llm_api",
            return_value=SimpleNamespace(id="matic_robot_operations"),
        ),
    ):
        assert await async_setup(hass, {}) is True

    assert hass.services.async_register.call_count == 17
    hass.http.register_view.assert_not_called()
    assert hass.data[DOMAIN][DATA_PLAN_MANAGER] is history
    assert hass.data[DOMAIN][DATA_LLM_API].id == "matic_robot_operations"


async def test_setup_registers_configuration_editor_when_frontend_is_loaded() -> None:
    hass = SimpleNamespace(
        http=SimpleNamespace(
            register_view=MagicMock(), async_register_static_paths=AsyncMock()
        ),
        bus=SimpleNamespace(
            async_fire=MagicMock(),
            async_listen=MagicMock(return_value=MagicMock()),
        ),
        services=SimpleNamespace(async_register=MagicMock()),
        data={frontend.DATA_EXTRA_MODULE_URL: set()},
    )

    with (
        patch("custom_components.matic_robot.services.CleaningPlanManager") as history,
        patch("custom_components.matic_robot.services.FirmwareTracker") as firmware,
        patch(
            "custom_components.matic_robot.async_register_matic_llm_api",
            return_value=SimpleNamespace(id="matic_robot_operations"),
        ),
    ):
        history.return_value.async_load = AsyncMock()
        firmware.return_value.async_load = AsyncMock()
        assert await async_setup(hass, {}) is True

    hass.http.async_register_static_paths.assert_awaited_once()
    assert hass.http.register_view.call_count == 8
    from custom_components.matic_robot.frontend import (
        DATA_SLAM_POSE_VIEW,
        DATA_SLAM_SCENE_VIEW,
        MANIFEST_VERSION,
        MATIC_MAP_PANEL_ELEMENT,
        MATIC_MAP_STUDIO_PATH,
        ROOM_PLAN_EDITOR_PATH,
        ROOM_PLAN_EDITOR_VERSION,
    )

    assert MANIFEST_VERSION in ROOM_PLAN_EDITOR_PATH
    assert hass.data[DATA_SLAM_SCENE_VIEW] in {
        call.args[0] for call in hass.http.register_view.call_args_list
    }
    assert hass.data[DATA_SLAM_POSE_VIEW] in {
        call.args[0] for call in hass.http.register_view.call_args_list
    }
    assert ROOM_PLAN_EDITOR_VERSION in ROOM_PLAN_EDITOR_PATH
    assert ROOM_PLAN_EDITOR_PATH in hass.data[frontend.DATA_EXTRA_MODULE_URL]
    panel = hass.data[frontend.DATA_PANELS]["matic-map"]
    assert panel.require_admin is True
    assert panel.config_panel_domain is None
    assert panel.config["_panel_custom"]["name"] == MATIC_MAP_PANEL_ELEMENT
    assert panel.config["_panel_custom"]["module_url"] == MATIC_MAP_STUDIO_PATH


@pytest.mark.parametrize("native_history_error", [False, True])
async def test_setup_refreshes_before_forwarding_platforms(
    native_history_error: bool,
) -> None:
    coordinator_unsubscribe = MagicMock()
    plan_unsubscribe = MagicMock()
    plans = MagicMock()
    plans.areas.return_value = {}
    plans.async_add_listener.return_value = plan_unsubscribe
    plans.async_upgrade_area_bindings = AsyncMock(
        side_effect=(
            AreaBindingUpgradeResult(0, True),
            AreaBindingUpgradeResult(0, True),
            AreaBindingUpgradeResult(0, True),
            AreaBindingUpgradeResult(0, True),
            AreaBindingUpgradeResult(1, False),
        )
    )
    plans.async_import_native_history = AsyncMock(return_value=False)
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="America/Los_Angeles"),
        config_entries=SimpleNamespace(async_forward_entry_setups=AsyncMock()),
        bus=SimpleNamespace(async_listen=MagicMock(return_value=MagicMock())),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: plans,
                DATA_FIRMWARE_TRACKER: MagicMock(),
            }
        },
    )
    entry = _entry()
    client = MagicMock()
    client.async_get_cleaning_session_records = AsyncMock(
        side_effect=CannotConnectError("history unavailable")
        if native_history_error
        else None,
        return_value=(),
    )
    coordinator = SimpleNamespace(
        async_config_entry_first_refresh=AsyncMock(),
        async_add_listener=MagicMock(return_value=coordinator_unsubscribe),
        async_watch_cues=AsyncMock(),
        data=SimpleNamespace(
            floor_plan=FloorPlan(
                42,
                "synthetic-partition",
                b"synthetic-partition",
                (),
            )
            if native_history_error
            else None
        ),
    )
    initial_floor_plan = coordinator.data.floor_plan
    setup_floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room(
                "setup-room",
                "Setup Room",
                "setup-room",
                b"setup-room",
                ((-2.0, 0.0), (-1.0, 0.0), (-2.0, 1.0)),
            ),
        ),
    )

    def deliver_setup_floor_plan(_serial_number, _listener):
        coordinator.data.floor_plan = setup_floor_plan
        return plan_unsubscribe

    plans.async_add_listener.side_effect = deliver_setup_floor_plan
    setup_scheduled = []

    def capture_setup_tasks(_hass, target, name):
        if name == "matic_robot custom area binding upgrade":
            setup_scheduled.append(target)
        else:
            target.close()

    entry.async_create_background_task.side_effect = capture_setup_tasks
    map_unsubscribe = MagicMock()
    slam_map = SimpleNamespace(
        async_load=AsyncMock(),
        async_collect=MagicMock(),
        async_shutdown=AsyncMock(),
        async_add_listener=MagicMock(return_value=map_unsubscribe),
        floor_plan_is_current=MagicMock(return_value=True),
    )
    slam_history = SimpleNamespace(
        async_load=AsyncMock(),
        async_shutdown=AsyncMock(),
    )

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch(
            "custom_components.matic_robot.MaticCoordinator",
            return_value=coordinator,
        ),
        patch("custom_components.matic_robot.HermesCredential.from_storage") as decode,
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch(
            "custom_components.matic_robot.SlamHistoryStore",
            return_value=slam_history,
        ),
        patch(
            "custom_components.matic_robot.async_collect_slam_history",
            return_value=MagicMock(),
        ) as collect_history,
        patch(
            "custom_components.matic_robot.async_sync_custom_area_issue"
        ) as sync_area_issue,
        patch(
            "custom_components.matic_robot.dt_util.now",
            return_value=datetime(2026, 7, 14, tzinfo=UTC),
        ),
    ):
        assert await async_setup_entry(hass, entry) is True
    assert len(setup_scheduled) == 1
    await setup_scheduled[0]

    decode.assert_called_once_with("test-credential")
    coordinator.async_config_entry_first_refresh.assert_awaited_once()
    assert plans.async_upgrade_area_bindings.await_count == 2
    assert plans.async_upgrade_area_bindings.await_args_list[0].args == (
        "synthetic-serial",
        initial_floor_plan,
    )
    assert plans.async_upgrade_area_bindings.await_args_list[1].args == (
        "synthetic-serial",
        setup_floor_plan,
    )
    if native_history_error:
        plans.async_import_native_history.assert_not_awaited()
    else:
        plans.async_import_native_history.assert_awaited_once_with(
            "synthetic-serial", None, ()
        )
    hass.config_entries.async_forward_entry_setups.assert_awaited_once_with(
        entry, PLATFORMS
    )
    plans.pending_native_reconciliation.assert_called_once_with("synthetic-serial")
    assert entry.runtime_data.client is client
    assert entry.runtime_data.slam_map is slam_map
    assert entry.runtime_data.slam_history is slam_history
    slam_map.async_load.assert_awaited_once()
    slam_map.async_add_listener.assert_called_once()
    slam_history.async_load.assert_awaited_once()
    slam_map.async_collect.assert_called_once_with(client)
    collect_history.assert_called_once()
    assert entry.async_create_background_task.call_count == 4
    coordinator.async_watch_cues.assert_called_once_with()
    assert (
        entry.runtime_data.firmware_tracker
        is (hass.data[DOMAIN][DATA_FIRMWARE_TRACKER])
    )
    coordinator.async_add_listener.assert_called_once()
    sync_callback = coordinator.async_add_listener.call_args.args[0]
    plans.async_add_listener.assert_called_once_with("synthetic-serial", sync_callback)
    assert entry.async_on_unload.call_args_list[-2:] == [
        ((coordinator_unsubscribe,), {}),
        ((plan_unsubscribe,), {}),
    ]
    hass.bus.async_listen.assert_called_once()
    assert hass.bus.async_listen.call_args.args[0] == f"{DOMAIN}_cleaning_finished"
    sync_area_issue.assert_called_once_with(hass, "entry", {}, setup_floor_plan)

    with patch(
        "custom_components.matic_robot.async_sync_custom_area_issue"
    ) as listener_sync:
        scheduled = []
        entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
            scheduled.append(target)
        )
        partial_floor_plan = FloorPlan(
            42,
            "synthetic-partition",
            b"synthetic-partition",
            (
                Room(
                    "room",
                    "Room",
                    "room",
                    b"room",
                    ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0)),
                ),
            ),
        )
        complete_floor_plan = FloorPlan(
            42,
            "synthetic-partition",
            b"synthetic-partition",
            (
                *partial_floor_plan.rooms,
                Room(
                    "later-room",
                    "Later Room",
                    "later-room",
                    b"later-room",
                    ((2.0, 0.0), (3.0, 0.0), (2.0, 1.0)),
                ),
            ),
        )
        updated_floor_plan = FloorPlan(
            42,
            "synthetic-partition",
            b"synthetic-partition",
            (
                *complete_floor_plan.rooms,
                Room(
                    "final-room",
                    "Final Room",
                    "final-room",
                    b"final-room",
                    ((4.0, 0.0), (5.0, 0.0), (4.0, 1.0)),
                ),
            ),
        )
        coordinator.data.floor_plan = partial_floor_plan
        sync_callback()
        coordinator.data.floor_plan = complete_floor_plan
        sync_callback()
        assert len(scheduled) == 1
        await scheduled[0]
        assert len(scheduled) == 2
        await scheduled[1]
        sync_callback()
        assert len(scheduled) == 2
        coordinator.data.floor_plan = updated_floor_plan
        sync_callback()
        assert len(scheduled) == 3
        await scheduled[2]
        plans.async_add_listener.call_args.args[1]()

    assert listener_sync.call_count == 5
    assert entry.async_create_background_task.call_count == 7
    assert plans.async_upgrade_area_bindings.await_count == 5
    assert plans.async_upgrade_area_bindings.call_args.args == (
        "synthetic-serial",
        updated_floor_plan,
    )
    assert (
        entry.async_create_background_task.call_args.args[2]
        == "matic_robot custom area binding upgrade"
    )


async def test_setup_closes_client_when_first_refresh_fails() -> None:
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="UTC"),
        config_entries=SimpleNamespace(async_forward_entry_setups=AsyncMock()),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: MagicMock(),
                DATA_FIRMWARE_TRACKER: MagicMock(),
            }
        },
    )
    entry = _entry()
    entry.data.pop(CONF_HERMES_CREDENTIAL)
    client = MagicMock()
    coordinator = SimpleNamespace(
        async_config_entry_first_refresh=AsyncMock(side_effect=RuntimeError("offline"))
    )

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch(
            "custom_components.matic_robot.MaticCoordinator",
            return_value=coordinator,
        ),
        pytest.raises(RuntimeError, match="offline"),
    ):
        await async_setup_entry(hass, entry)

    client.close.assert_called_once()


async def test_revoked_credential_enters_reauthentication_before_setup() -> None:
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="UTC"),
        config_entries=SimpleNamespace(async_forward_entry_setups=AsyncMock()),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: MagicMock(),
                DATA_FIRMWARE_TRACKER: MagicMock(),
            }
        },
    )
    entry = _entry()
    client = MagicMock()
    coordinator = SimpleNamespace(
        async_config_entry_first_refresh=AsyncMock(
            side_effect=ConfigEntryAuthFailed("credential rejected")
        )
    )

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch(
            "custom_components.matic_robot.MaticCoordinator",
            return_value=coordinator,
        ),
        patch("custom_components.matic_robot.HermesCredential.from_storage"),
        patch("custom_components.matic_robot.SlamMapStore") as slam_store,
        patch("custom_components.matic_robot.SlamHistoryStore") as history_store,
        pytest.raises(ConfigEntryAuthFailed, match="rejected"),
    ):
        await async_setup_entry(hass, entry)

    client.close.assert_called_once()
    hass.config_entries.async_forward_entry_setups.assert_not_awaited()
    slam_store.assert_not_called()
    history_store.assert_not_called()


async def test_setup_closes_client_when_platform_forwarding_fails() -> None:
    plans = MagicMock()
    plans.async_upgrade_area_bindings = AsyncMock(
        return_value=AreaBindingUpgradeResult(0, False)
    )
    plans.async_import_native_history = AsyncMock(return_value=False)
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="UTC"),
        config_entries=SimpleNamespace(
            async_forward_entry_setups=AsyncMock(
                side_effect=RuntimeError("platform setup failed")
            )
        ),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: plans,
                DATA_FIRMWARE_TRACKER: MagicMock(),
            }
        },
    )
    entry = _entry()
    client = MagicMock()
    client.async_get_cleaning_session_records = AsyncMock(return_value=())
    coordinator = SimpleNamespace(
        async_config_entry_first_refresh=AsyncMock(),
        data=SimpleNamespace(floor_plan=None),
    )
    slam_map = SimpleNamespace(
        async_load=AsyncMock(),
        async_collect=MagicMock(),
        async_shutdown=AsyncMock(),
    )
    slam_history = SimpleNamespace(
        async_load=AsyncMock(),
        async_shutdown=AsyncMock(),
    )

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch(
            "custom_components.matic_robot.MaticCoordinator",
            return_value=coordinator,
        ),
        patch("custom_components.matic_robot.HermesCredential.from_storage"),
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch(
            "custom_components.matic_robot.SlamHistoryStore",
            return_value=slam_history,
        ),
        pytest.raises(RuntimeError, match="platform setup failed"),
    ):
        await async_setup_entry(hass, entry)

    client.close.assert_called_once()
    slam_map.async_shutdown.assert_awaited_once()
    slam_history.async_shutdown.assert_awaited_once()


@pytest.mark.parametrize("unload_ok", [True, False])
async def test_unload_closes_client_only_after_all_platforms_unload(unload_ok) -> None:
    client = MagicMock()
    slam_map = SimpleNamespace(async_shutdown=AsyncMock())
    slam_history = SimpleNamespace(async_shutdown=AsyncMock())
    plans = SimpleNamespace(async_cancel_and_wait=AsyncMock())
    entry = SimpleNamespace(
        entry_id="entry",
        data={CONF_SERIAL_NUMBER: "synthetic-serial"},
        runtime_data=SimpleNamespace(
            client=client,
            slam_map=slam_map,
            slam_history=slam_history,
            cleaning_plans=plans,
        ),
    )
    scene_view = SimpleNamespace(clear_entry=MagicMock())
    pose_view = SimpleNamespace(clear_entry=MagicMock())
    from custom_components.matic_robot.frontend import (
        DATA_SLAM_POSE_VIEW,
        DATA_SLAM_SCENE_VIEW,
    )

    hass = SimpleNamespace(
        config_entries=SimpleNamespace(
            async_unload_platforms=AsyncMock(return_value=unload_ok)
        ),
        data={
            DATA_SLAM_POSE_VIEW: pose_view,
            DATA_SLAM_SCENE_VIEW: scene_view,
        },
    )

    assert await async_unload_entry(hass, entry) is unload_ok
    plans.async_cancel_and_wait.assert_awaited_once_with("synthetic-serial")
    assert client.close.called is unload_ok
    assert scene_view.clear_entry.called is unload_ok
    assert pose_view.clear_entry.called is unload_ok
    assert slam_map.async_shutdown.await_count == int(unload_ok)
    assert slam_history.async_shutdown.await_count == int(unload_ok)


async def test_remove_entry_erases_firmware_history() -> None:
    tracker = SimpleNamespace(async_remove_robot=AsyncMock())
    scene_view = SimpleNamespace(clear_entry=MagicMock())
    pose_view = SimpleNamespace(clear_entry=MagicMock())
    from custom_components.matic_robot.frontend import (
        DATA_SLAM_POSE_VIEW,
        DATA_SLAM_SCENE_VIEW,
    )

    hass = SimpleNamespace(
        data={
            DOMAIN: {DATA_FIRMWARE_TRACKER: tracker},
            DATA_SLAM_POSE_VIEW: pose_view,
            DATA_SLAM_SCENE_VIEW: scene_view,
        }
    )
    entry = SimpleNamespace(entry_id="entry")
    slam_map = SimpleNamespace(async_remove=AsyncMock())
    slam_history = SimpleNamespace(async_remove=AsyncMock())

    with (
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch(
            "custom_components.matic_robot.SlamHistoryStore",
            return_value=slam_history,
        ),
        patch(
            "custom_components.matic_robot.async_delete_custom_area_issue"
        ) as delete_area_issue,
    ):
        await async_remove_entry(hass, entry)

    tracker.async_remove_robot.assert_awaited_once_with("entry")
    scene_view.clear_entry.assert_called_once_with("entry")
    pose_view.clear_entry.assert_called_once_with("entry")
    slam_map.async_remove.assert_awaited_once()
    slam_history.async_remove.assert_awaited_once()
    delete_area_issue.assert_called_once_with(hass, "entry")

    bare = SimpleNamespace(data={})
    with (
        patch("custom_components.matic_robot.SlamMapStore", return_value=slam_map),
        patch(
            "custom_components.matic_robot.SlamHistoryStore",
            return_value=slam_history,
        ),
        patch(
            "custom_components.matic_robot.async_delete_custom_area_issue"
        ) as delete_bare_area_issue,
    ):
        await async_remove_entry(bare, entry)

    delete_bare_area_issue.assert_called_once_with(bare, "entry")


async def test_finished_session_records_where_the_robot_worked(hass) -> None:
    """Any finished clean updates rotation fairness, claiming no completion."""
    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED

    entry = MagicMock()
    entry.entry_id = "entry-1"
    unloads: list = []
    entry.async_on_unload = unloads.append
    client = SimpleNamespace(
        async_get_cleaning_session_records=AsyncMock(return_value=("record",))
    )
    plans = SimpleNamespace(async_import_native_history=AsyncMock(return_value=True))
    coordinator = SimpleNamespace(data=SimpleNamespace(floor_plan="floor-plan"))

    _register_native_history_sync(hass, entry, client, coordinator, plans, "serial")
    assert unloads

    hass.bus.async_fire(EVENT_CLEANING_FINISHED, {"entry_id": "other"})
    await hass.async_block_till_done()
    plans.async_import_native_history.assert_not_awaited()

    hass.bus.async_fire(EVENT_CLEANING_FINISHED, {"entry_id": "entry-1"})
    await hass.async_block_till_done()
    plans.async_import_native_history.assert_awaited_once_with(
        "serial", "floor-plan", ("record",)
    )


async def test_finished_session_sync_survives_an_unreadable_robot(hass) -> None:
    from custom_components.matic_robot.client.exceptions import MaticError
    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED

    entry = MagicMock()
    entry.entry_id = "entry-1"
    entry.async_on_unload = MagicMock()
    client = SimpleNamespace(
        async_get_cleaning_session_records=AsyncMock(side_effect=MaticError("down"))
    )
    plans = SimpleNamespace(async_import_native_history=AsyncMock())
    coordinator = SimpleNamespace(data=SimpleNamespace(floor_plan="floor-plan"))

    _register_native_history_sync(hass, entry, client, coordinator, plans, "serial")
    hass.bus.async_fire(EVENT_CLEANING_FINISHED, {"entry_id": "entry-1"})
    await hass.async_block_till_done()

    plans.async_import_native_history.assert_not_awaited()
