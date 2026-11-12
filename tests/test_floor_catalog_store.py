"""Floor catalogs in the integration's store, migrated from entity options."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.vacuum_catalog import (
    SAVE_DELAY_SECONDS,
    FloorSegmentCatalog,
    _floor_scope,
    async_remove_floor_catalogs,
)

KEY = f"{DOMAIN}.floor_catalogs.entry"


def _floor(partition: str, room: str) -> FloorPlan:
    return FloorPlan(
        1, partition, partition.encode(), (Room(room, room, "protocol", b"x", ()),)
    )


UPSTAIRS = _floor("upstairs", "bedroom")
DOWNSTAIRS = _floor("downstairs", "kitchen")
UP = _floor_scope(UPSTAIRS)
DOWN = _floor_scope(DOWNSTAIRS)


def _segments(room: str) -> list[dict[str, Any]]:
    return [{"id": room, "name": room, "group": "Current floor"}]


def _catalog(room: str, area: str | None = None) -> dict[str, Any]:
    catalog: dict[str, Any] = {"last_seen_segments": _segments(room)}
    if area is not None:
        catalog["area_mapping"] = {area: [room]}
    return catalog


# What 0.5 left in the vacuum's options on the upstairs floor.
OPTIONS_05 = {
    "area_mapping": {"bedroom_area": ["bedroom"]},
    "last_seen_segments": _segments("bedroom"),
    "matic_floor_scope": UP,
    "matic_floor_catalogs": {
        DOWN: _catalog("kitchen", "kitchen_area"),
        UP: _catalog("bedroom", "bedroom_area"),
    },
    "matic_unscoped_catalog": _catalog("legacy", "legacy_area"),
}


def _vacuum(hass: HomeAssistant, options: dict[str, Any] | None = None) -> str:
    registry = er.async_get(hass)
    entity_id = registry.async_get_or_create("vacuum", DOMAIN, "robot").entity_id
    if options is not None:
        registry.async_update_entity_options(entity_id, "vacuum", options)
    return entity_id


def _options(hass: HomeAssistant, entity_id: str) -> dict[str, Any]:
    return dict(er.async_get(hass).async_get(entity_id).options.get("vacuum", {}))


async def _load(hass: HomeAssistant, entity_id: str) -> FloorSegmentCatalog:
    catalog = FloorSegmentCatalog()
    await catalog.async_load(hass, "entry", entity_id)
    return catalog


async def test_upgrade_moves_catalogs_to_the_store_and_leaves_a_copy(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    entity_id = _vacuum(hass, OPTIONS_05)

    await _load(hass, entity_id)

    stored = hass_storage[KEY]["data"]
    assert stored["catalog"] == {
        key: OPTIONS_05[key]
        for key in (
            "matic_floor_scope",
            "matic_floor_catalogs",
            "matic_unscoped_catalog",
        )
    }
    left = {
        key: value for key, value in OPTIONS_05.items() if key != "matic_floor_scope"
    }
    assert _options(hass, entity_id) == left
    assert stored["options_copy"] == {
        "matic_floor_catalogs": OPTIONS_05["matic_floor_catalogs"],
        "matic_unscoped_catalog": OPTIONS_05["matic_unscoped_catalog"],
    }

    # Later loads read the store and leave the options alone.
    stored["catalog"]["matic_floor_catalogs"][UP] = _catalog("bedroom", "moved")
    catalog = await _load(hass, entity_id)
    assert catalog._catalog["matic_floor_catalogs"][UP] == _catalog("bedroom", "moved")
    assert _options(hass, entity_id) == left


async def test_a_new_robot_starts_with_an_empty_store(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    entity_id = _vacuum(hass)

    catalog = await _load(hass, entity_id)

    assert hass_storage[KEY]["data"] == {
        "catalog": {"matic_floor_catalogs": {}},
        "options_copy": {},
    }
    assert _options(hass, entity_id) == {}
    catalog._store = MagicMock()
    catalog.reconcile(hass, entity_id, UPSTAIRS, MagicMock())
    assert set(_options(hass, entity_id)) == {"last_seen_segments"}
    assert catalog._catalog["matic_floor_scope"] == UP

    # Core lost its segments; the store already has this floor, so only core
    # is written.
    catalog._store.async_delay_save.reset_mock()
    er.async_get(hass).async_update_entity_options(entity_id, "vacuum", {})
    catalog.reconcile(hass, entity_id, UPSTAIRS, MagicMock())
    assert _options(hass, entity_id) == {"last_seen_segments": _segments("bedroom")}
    catalog._store.async_delay_save.assert_not_called()


async def test_reupgrade_keeps_floors_only_the_downgrade_changed(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    """0.5 ran after the upgrade: its floors win where it changed them."""
    attic = _floor_scope(_floor("attic", "loft"))
    garage = _floor_scope(_floor("garage", "bay"))
    hass_storage[KEY] = {
        "version": 1,
        "minor_version": 1,
        "key": KEY,
        "data": {
            "catalog": {
                "matic_floor_scope": UP,
                "matic_floor_catalogs": {
                    attic: _catalog("loft", "loft_area"),
                    DOWN: _catalog("kitchen", "remapped_in_06"),
                    UP: _catalog("bedroom", "bedroom_area"),
                },
                "matic_unscoped_catalog": _catalog("legacy", "legacy_area"),
            },
            "options_copy": {
                "matic_floor_catalogs": OPTIONS_05["matic_floor_catalogs"],
                "matic_unscoped_catalog": _catalog("legacy", "legacy_area"),
            },
        },
    }
    after_downgrade = {
        "area_mapping": {"garage_area": ["bay"]},
        "last_seen_segments": _segments("bay"),
        "matic_floor_scope": garage,
        "matic_floor_catalogs": {
            DOWN: _catalog("kitchen", "kitchen_area"),
            UP: _catalog("bedroom", "remapped_in_05"),
            garage: _catalog("bay", "garage_area"),
        },
    }
    entity_id = _vacuum(hass, after_downgrade)

    catalog = await _load(hass, entity_id)

    assert catalog._catalog == {
        "matic_floor_scope": garage,
        "matic_floor_catalogs": {
            attic: _catalog("loft", "loft_area"),
            DOWN: _catalog("kitchen", "remapped_in_06"),
            UP: _catalog("bedroom", "remapped_in_05"),
            garage: _catalog("bay", "garage_area"),
        },
    }
    assert "matic_floor_scope" not in _options(hass, entity_id)
    assert hass_storage[KEY]["data"]["options_copy"] == {
        "matic_floor_catalogs": after_downgrade["matic_floor_catalogs"]
    }


async def test_floor_swaps_save_the_store_and_keep_the_copy_for_a_downgrade(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    entity_id = _vacuum(hass, OPTIONS_05)
    catalog = await _load(hass, entity_id)
    report = MagicMock()

    catalog.reconcile(hass, entity_id, DOWNSTAIRS, report)
    async_fire_time_changed(
        hass, dt_util.utcnow() + timedelta(seconds=SAVE_DELAY_SECONDS + 1)
    )
    await hass.async_block_till_done()

    report.assert_not_called()
    options = _options(hass, entity_id)
    assert options["area_mapping"] == {"kitchen_area": ["kitchen"]}
    assert options["last_seen_segments"] == _segments("kitchen")
    assert options["matic_floor_catalogs"] == OPTIONS_05["matic_floor_catalogs"]
    assert "matic_floor_scope" not in options
    assert hass_storage[KEY]["data"]["catalog"]["matic_floor_scope"] == DOWN

    await async_remove_floor_catalogs(hass, "entry")
    assert KEY not in hass_storage


async def test_flush_writes_a_pending_swap_and_removal_stays_removed(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    entity_id = _vacuum(hass, OPTIONS_05)
    catalog = await _load(hass, entity_id)
    await catalog.async_flush()
    catalog.reconcile(hass, entity_id, DOWNSTAIRS, MagicMock())

    await catalog.async_flush()

    assert hass_storage[KEY]["data"]["catalog"]["matic_floor_scope"] == DOWN
    await async_remove_floor_catalogs(hass, "entry")
    async_fire_time_changed(
        hass, dt_util.utcnow() + timedelta(seconds=SAVE_DELAY_SECONDS + 1)
    )
    await hass.async_block_till_done()
    assert KEY not in hass_storage
