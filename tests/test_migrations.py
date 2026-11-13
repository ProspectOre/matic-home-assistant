"""Config entry migration tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.migrations import (
    MINIMUM_UPGRADE_VERSION,
    UPGRADE_ISSUE_ID,
    async_migrate_entry,
)


def _entry(*, version: int = 1, minor_version: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        entry_id="entry",
        version=version,
        minor_version=minor_version,
        data={"serial_number": "serial"},
    )


def _hass() -> MagicMock:
    return MagicMock(data={ir.DATA_REGISTRY: SimpleNamespace(issues={})})


async def test_future_major_versions_refuse_to_downgrade() -> None:
    hass = _hass()
    assert await async_migrate_entry(hass, _entry(version=2)) is False  # type: ignore[arg-type]
    hass.config_entries.async_update_entry.assert_not_called()


async def test_current_minor_version_is_left_untouched() -> None:
    hass = _hass()
    with patch("custom_components.matic_robot.migrations.er.async_get") as registry_get:
        assert await async_migrate_entry(hass, _entry(minor_version=5)) is True  # type: ignore[arg-type]
    registry_get.assert_not_called()
    hass.config_entries.async_update_entry.assert_not_called()


@pytest.mark.parametrize("minor_version", [1, 2])
async def test_pre_0_5_entries_are_refused_untouched_with_a_repair(
    hass, minor_version: int
) -> None:
    """0.6 reads what 0.5.4 stored; older entries step through 0.5.4 first."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"serial_number": "serial"},
        version=1,
        minor_version=minor_version,
    )
    entry.add_to_hass(hass)
    registry = er.async_get(hass)
    # 0.5 removed this entity; an older entry still has it.
    retired = registry.async_get_or_create(
        "sensor", DOMAIN, "serial_software_version", config_entry=entry
    )

    assert await async_migrate_entry(hass, entry) is False

    assert entry.minor_version == minor_version
    assert registry.async_get(retired.entity_id) == retired
    issue = ir.async_get(hass).async_get_issue(DOMAIN, UPGRADE_ISSUE_ID)
    assert issue is not None
    assert issue.severity is ir.IssueSeverity.ERROR
    assert not issue.is_fixable
    assert issue.translation_placeholders == {"version": MINIMUM_UPGRADE_VERSION}


async def test_upgrade_to_0_6_leaves_no_removed_entity_behind(hass) -> None:
    """0.6 deletes 14 duplicate entities, enabled or not, and keeps the rest."""
    entry = MockConfigEntry(
        domain=DOMAIN, data={"serial_number": "serial"}, version=1, minor_version=3
    )
    entry.add_to_hass(hass)
    registry = er.async_get(hass)
    removed = {
        ("binary_sensor", "paused"),
        ("binary_sensor", "returning"),
        ("binary_sensor", "fully_charged"),
        ("sensor", "activity"),
        ("sensor", "rooms"),
        ("sensor", "update_state"),
        ("sensor", "update_channel"),
        ("sensor", "scheduled_cleanings"),
        ("sensor", "protocol_version"),
        ("sensor", "dock_detections"),
        ("sensor", "sink_summon_locations"),
        ("button", "intelligent_clean"),
        ("button", "clean_entire_plan"),
        ("button", "stop_intelligent_cleaning"),
    }
    kept = [
        ("binary_sensor", "charging"),
        ("binary_sensor", "cleaning"),
        ("binary_sensor", "low_charge"),
        ("binary_sensor", "problem"),
        ("button", "run_selected_plan"),
        ("sensor", "cleaning_history"),
        ("sensor", "current_area"),
        ("sensor", "local_cleaning_sessions"),
    ]
    for domain, key in (*sorted(removed), *kept):
        registry.async_get_or_create(
            domain,
            DOMAIN,
            f"serial_{key}",
            config_entry=entry,
            # A disabled entity leaves a registry entry behind too.
            disabled_by=(
                er.RegistryEntryDisabler.INTEGRATION if key == "paused" else None
            ),
        )

    assert await async_migrate_entry(hass, entry) is True
    assert entry.minor_version == 5
    assert [
        (item.domain, item.unique_id.removeprefix("serial_"))
        for item in er.async_entries_for_config_entry(registry, entry.entry_id)
    ] == kept

    # A later start never deletes again, even an entity with a removed key.
    registry.async_get_or_create(
        "sensor", DOMAIN, "serial_activity", config_entry=entry
    )
    assert await async_migrate_entry(hass, entry) is True
    assert registry.async_get_entity_id("sensor", DOMAIN, "serial_activity")


async def test_retired_entity_cleanup_needs_a_serial(hass) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={}, version=1, minor_version=3)
    entry.add_to_hass(hass)
    assert await async_migrate_entry(hass, entry) is True
    assert entry.minor_version == 5


async def test_stored_maintenance_repairs_are_deleted_once(hass) -> None:
    """0.6 development builds stored a Repair that nothing raises any more."""
    entry = MockConfigEntry(domain=DOMAIN, data={}, version=1, minor_version=3)
    entry.add_to_hass(hass)
    kept = ("maintenance_other_2026-10", f"robot_alert_{entry.entry_id}_bag_full")
    for issue_id in (f"maintenance_{entry.entry_id}_2026-10", *kept):
        ir.async_create_issue(
            hass,
            DOMAIN,
            issue_id,
            is_fixable=False,
            is_persistent=True,
            severity=ir.IssueSeverity.WARNING,
            translation_key="custom_area_map_changed",
        )

    assert await async_migrate_entry(hass, entry) is True
    assert entry.minor_version == 5
    assert {
        issue_id for domain, issue_id in ir.async_get(hass).issues if domain == DOMAIN
    } == set(kept)
