"""Integration setup and unload lifecycle tests."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.components import frontend
from homeassistant.exceptions import ConfigEntryAuthFailed

from custom_components.matic_robot import (
    async_remove_entry,
    async_setup,
    async_setup_entry,
    async_unload_entry,
)
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
    DATA_FIRMWARE_TRACKER,
    DATA_PLAN_MANAGER,
    DOMAIN,
    PLATFORMS,
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


async def test_setup_registers_services_without_media_view() -> None:
    hass = SimpleNamespace(
        http=SimpleNamespace(register_view=MagicMock()),
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
    ):
        assert await async_setup(hass, {}) is True

    assert hass.services.async_register.call_count == 17
    hass.http.register_view.assert_not_called()
    assert hass.data[DOMAIN][DATA_PLAN_MANAGER] is history


async def test_setup_registers_configuration_editor_when_frontend_is_loaded() -> None:
    hass = SimpleNamespace(
        http=SimpleNamespace(
            register_view=MagicMock(), async_register_static_paths=AsyncMock()
        ),
        bus=SimpleNamespace(async_fire=MagicMock()),
        services=SimpleNamespace(async_register=MagicMock()),
        data={frontend.DATA_EXTRA_MODULE_URL: set()},
    )

    with (
        patch("custom_components.matic_robot.services.CleaningPlanManager") as history,
        patch("custom_components.matic_robot.services.FirmwareTracker") as firmware,
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
    plans.async_import_native_history = AsyncMock(return_value=False)
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="America/Los_Angeles"),
        config_entries=SimpleNamespace(async_forward_entry_setups=AsyncMock()),
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

    decode.assert_called_once_with("test-credential")
    coordinator.async_config_entry_first_refresh.assert_awaited_once()
    if native_history_error:
        plans.async_import_native_history.assert_not_awaited()
    else:
        plans.async_import_native_history.assert_awaited_once_with(
            "synthetic-serial", None, ()
        )
    hass.config_entries.async_forward_entry_setups.assert_awaited_once_with(
        entry, PLATFORMS
    )
    assert entry.runtime_data.client is client
    assert entry.runtime_data.slam_map is slam_map
    assert entry.runtime_data.slam_history is slam_history
    slam_map.async_load.assert_awaited_once()
    slam_history.async_load.assert_awaited_once()
    slam_map.async_collect.assert_called_once_with(client)
    collect_history.assert_called_once()
    assert entry.async_create_background_task.call_count == 2
    assert (
        entry.runtime_data.firmware_tracker
        is (hass.data[DOMAIN][DATA_FIRMWARE_TRACKER])
    )
    coordinator.async_add_listener.assert_called_once()
    sync_callback = coordinator.async_add_listener.call_args.args[0]
    plans.async_add_listener.assert_called_once_with("synthetic-serial", sync_callback)
    assert entry.async_on_unload.call_args_list == [
        ((coordinator_unsubscribe,), {}),
        ((plan_unsubscribe,), {}),
    ]
    sync_area_issue.assert_called_once_with(hass, "entry", {}, None)

    with patch(
        "custom_components.matic_robot.async_sync_custom_area_issue"
    ) as listener_sync:
        sync_callback()
        plans.async_add_listener.call_args.args[1]()

    assert listener_sync.call_count == 2


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
