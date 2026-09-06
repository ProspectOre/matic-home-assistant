"""Pre-1.0 entity identity migration tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from custom_components.matic_robot.migrations import async_migrate_entry


def _entry(*, version: int = 1, minor_version: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        entry_id="entry",
        version=version,
        minor_version=minor_version,
        data={"serial_number": "serial"},
    )


def _hass() -> SimpleNamespace:
    return SimpleNamespace(
        config_entries=SimpleNamespace(async_update_entry=MagicMock())
    )


async def test_entity_ids_migrate_once_to_descriptive_canonical_names() -> None:
    registry = SimpleNamespace(async_get=MagicMock(), async_update_entity=MagicMock())
    entries = [
        SimpleNamespace(
            unique_id="other_battery",
            domain="sensor",
            entity_id="sensor.ignore",
        ),
        SimpleNamespace(
            unique_id="serial_battery",
            domain="sensor",
            entity_id="sensor.matic_battery",
        ),
        SimpleNamespace(
            unique_id="serial_activity",
            domain="sensor",
            entity_id="sensor.matic_2",
        ),
        SimpleNamespace(
            unique_id="serial_vacuum",
            domain="vacuum",
            entity_id="vacuum.matic_3",
        ),
    ]
    registry.async_get.side_effect = [object(), None]
    device_registry = SimpleNamespace(
        async_get_device_by_identifier=MagicMock(
            return_value=SimpleNamespace(name="Matic")
        )
    )
    hass = _hass()
    entry = _entry()

    with (
        patch(
            "custom_components.matic_robot.migrations.er.async_get",
            return_value=registry,
        ),
        patch(
            "custom_components.matic_robot.migrations.er.async_entries_for_config_entry",
            return_value=entries,
        ),
        patch(
            "custom_components.matic_robot.migrations.dr.async_get",
            return_value=device_registry,
        ),
    ):
        assert await async_migrate_entry(hass, entry) is True  # type: ignore[arg-type]

    registry.async_update_entity.assert_called_once_with(
        "vacuum.matic_3", new_entity_id="vacuum.matic"
    )
    device_registry.async_get_device_by_identifier.assert_called_once_with(
        ("matic_robot", "serial"), "entry"
    )
    hass.config_entries.async_update_entry.assert_called_once_with(
        entry, minor_version=2
    )


async def test_future_major_versions_refuse_to_downgrade() -> None:
    hass = _hass()
    assert await async_migrate_entry(hass, _entry(version=2)) is False  # type: ignore[arg-type]
    hass.config_entries.async_update_entry.assert_not_called()


async def test_current_minor_version_is_left_untouched() -> None:
    hass = _hass()
    with patch("custom_components.matic_robot.migrations.er.async_get") as registry_get:
        assert await async_migrate_entry(hass, _entry(minor_version=2)) is True  # type: ignore[arg-type]
    registry_get.assert_not_called()
    hass.config_entries.async_update_entry.assert_not_called()


async def test_missing_serial_and_device_fall_back_safely() -> None:
    registry = SimpleNamespace(
        async_get=MagicMock(return_value=None), async_update_entity=MagicMock()
    )
    device_registry = SimpleNamespace(
        async_get_device_by_identifier=MagicMock(return_value=None)
    )
    hass = _hass()
    entry = _entry()
    entry.data = {}

    with patch(
        "custom_components.matic_robot.migrations.er.async_get",
        return_value=registry,
    ):
        assert await async_migrate_entry(hass, entry) is True  # type: ignore[arg-type]
    registry.async_update_entity.assert_not_called()

    entries = [
        SimpleNamespace(
            unique_id="serial_battery",
            domain="sensor",
            entity_id="sensor.matic_2",
        ),
    ]
    entry = _entry()
    hass = _hass()
    with (
        patch(
            "custom_components.matic_robot.migrations.er.async_get",
            return_value=registry,
        ),
        patch(
            "custom_components.matic_robot.migrations.er.async_entries_for_config_entry",
            return_value=entries,
        ),
        patch(
            "custom_components.matic_robot.migrations.dr.async_get",
            return_value=device_registry,
        ),
    ):
        assert await async_migrate_entry(hass, entry) is True  # type: ignore[arg-type]
    registry.async_update_entity.assert_called_once_with(
        "sensor.matic_2", new_entity_id="sensor.matic_battery"
    )


async def test_minimum_ha_device_lookup_preserves_entry_ownership() -> None:
    """HA 2026.7 has only the unscoped registry lookup."""
    hass = _hass()
    for device in (
        None,
        SimpleNamespace(name="Other", config_entries={"other"}),
        SimpleNamespace(name="My Matic", config_entries={"entry"}),
    ):
        devices = SimpleNamespace(async_get_device=MagicMock(return_value=device))
        registry = SimpleNamespace(
            async_get=MagicMock(return_value=None), async_update_entity=MagicMock()
        )
        entities = [
            SimpleNamespace(
                unique_id="serial_battery", domain="sensor", entity_id="sensor.old"
            )
        ]
        with (
            patch(
                "custom_components.matic_robot.migrations.dr.async_get",
                return_value=devices,
            ),
            patch(
                "custom_components.matic_robot.migrations.er.async_get",
                return_value=registry,
            ),
            patch(
                "custom_components.matic_robot.migrations.er.async_entries_for_config_entry",
                return_value=entities,
            ),
        ):
            assert await async_migrate_entry(hass, _entry()) is True
        devices.async_get_device.assert_called_once_with(
            identifiers={("matic_robot", "serial")}
        )
        expected = (
            "my_matic_battery"
            if device and "entry" in device.config_entries
            else "matic_battery"
        )
        registry.async_update_entity.assert_called_once_with(
            "sensor.old", new_entity_id=f"sensor.{expected}"
        )
