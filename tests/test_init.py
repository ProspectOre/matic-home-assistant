"""Integration setup and unload lifecycle tests."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.components import frontend

from custom_components.matic_robot import (
    async_remove_entry,
    async_setup,
    async_setup_entry,
    async_unload_entry,
)
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

    assert hass.services.async_register.call_count == 16
    hass.http.register_view.assert_not_called()
    assert hass.data[DOMAIN][DATA_PLAN_MANAGER] is history


async def test_setup_registers_configuration_editor_when_frontend_is_loaded() -> None:
    hass = SimpleNamespace(
        http=SimpleNamespace(
            register_view=MagicMock(), async_register_static_paths=AsyncMock()
        ),
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
    from custom_components.matic_robot.frontend import MANIFEST_VERSION

    assert (
        f"/matic_robot/room-plan-editor.js?v={MANIFEST_VERSION}"
        in hass.data[frontend.DATA_EXTRA_MODULE_URL]
    )


async def test_setup_refreshes_before_forwarding_platforms() -> None:
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="America/Los_Angeles"),
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
    coordinator = SimpleNamespace(async_config_entry_first_refresh=AsyncMock())

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch(
            "custom_components.matic_robot.MaticCoordinator",
            return_value=coordinator,
        ),
        patch("custom_components.matic_robot.HermesCredential.from_storage") as decode,
        patch(
            "custom_components.matic_robot.dt_util.now",
            return_value=datetime(2026, 7, 14, tzinfo=UTC),
        ),
    ):
        assert await async_setup_entry(hass, entry) is True

    decode.assert_called_once_with("test-credential")
    coordinator.async_config_entry_first_refresh.assert_awaited_once()
    hass.config_entries.async_forward_entry_setups.assert_awaited_once_with(
        entry, PLATFORMS
    )
    assert entry.runtime_data.client is client
    assert (
        entry.runtime_data.firmware_tracker
        is (hass.data[DOMAIN][DATA_FIRMWARE_TRACKER])
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


async def test_setup_closes_client_when_platform_forwarding_fails() -> None:
    hass = SimpleNamespace(
        config=SimpleNamespace(time_zone="UTC"),
        config_entries=SimpleNamespace(
            async_forward_entry_setups=AsyncMock(
                side_effect=RuntimeError("platform setup failed")
            )
        ),
        data={
            DOMAIN: {
                DATA_PLAN_MANAGER: MagicMock(),
                DATA_FIRMWARE_TRACKER: MagicMock(),
            }
        },
    )
    entry = _entry()
    client = MagicMock()
    coordinator = SimpleNamespace(async_config_entry_first_refresh=AsyncMock())

    with (
        patch("custom_components.matic_robot.MaticHermesClient", return_value=client),
        patch(
            "custom_components.matic_robot.MaticCoordinator",
            return_value=coordinator,
        ),
        patch("custom_components.matic_robot.HermesCredential.from_storage"),
        pytest.raises(RuntimeError, match="platform setup failed"),
    ):
        await async_setup_entry(hass, entry)

    client.close.assert_called_once()


@pytest.mark.parametrize("unload_ok", [True, False])
async def test_unload_closes_client_only_after_all_platforms_unload(unload_ok) -> None:
    client = MagicMock()
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(
            async_unload_platforms=AsyncMock(return_value=unload_ok)
        )
    )

    assert await async_unload_entry(hass, entry) is unload_ok
    assert client.close.called is unload_ok


async def test_remove_entry_erases_firmware_history() -> None:
    tracker = SimpleNamespace(async_remove_robot=AsyncMock())
    hass = SimpleNamespace(data={DOMAIN: {DATA_FIRMWARE_TRACKER: tracker}})
    entry = SimpleNamespace(entry_id="entry")

    await async_remove_entry(hass, entry)

    tracker.async_remove_robot.assert_awaited_once_with("entry")

    bare = SimpleNamespace(data={})
    await async_remove_entry(bare, entry)
