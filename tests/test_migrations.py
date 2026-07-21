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
        async_get_device=MagicMock(return_value=SimpleNamespace(name="Matic"))
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
    device_registry = SimpleNamespace(async_get_device=MagicMock(return_value=None))
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
