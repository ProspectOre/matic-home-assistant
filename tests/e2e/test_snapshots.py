"""Snapshots of what a configured simulated robot exposes.

Both are taken once setup and its firmware snapshot have finished, and both
hold only what this integration decides, as plain data, so every supported
Home Assistant serializes them the same. Per entity that is its registry
fields, its state and the attributes the integration adds; the diagnostics
snapshot is the redacted report as a download holds it. Values that differ on
every run, such as ports, entry ids, timestamps and source hashes, are recorded
by type only. Update both with `pytest --snapshot-update` and review the diff
like code.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from enum import Enum

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import async_get_platforms
from pytest_homeassistant_custom_component.common import MockConfigEntry
from syrupy.assertion import SnapshotAssertion
from syrupy.extensions.amber import AmberSnapshotExtension
from syrupy.matchers import path_type

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.diagnostics import (
    async_get_config_entry_diagnostics,
)

from .plan_run import firmware_snapshot_saved

ENTITY_COUNT = 54
_VOLATILE_ATTRIBUTES = path_type(
    {
        r".*\.attributes\.(matic_entry_id|last_snapshot_at|firmware_report\.id)": (
            str,
        ),
    },
    regex=True,
)
# Hashes, counts and versions of the loaded code and interpreter, which change
# with every source edit and with what the test process imported before.
_RUNTIME_CODE = (
    "process_id|python_cache_tag|python_version|loaded_modules|unloaded_modules|"
    "observed_functions|excluded_generated_or_wrapper_functions|"
    "runtime_code_sha256|loaded_python_source_sha256|loaded_python_source_files"
)
_VOLATILE_DIAGNOSTICS = path_type(
    {
        rf"runtime_code\.({_RUNTIME_CODE})": (int, str, list, dict),
        r"activity_observations\.\d+\.(observation_session|observed_at)": (str,),
        r"entry\.port": (int,),
        r"firmware_tracking\.(last_snapshot_at|firmware_report\.id)": (str,),
    },
    regex=True,
)


@pytest.fixture
def snapshot(snapshot: SnapshotAssertion) -> SnapshotAssertion:
    """Use syrupy's own serializer, whichever extension the helper applies."""
    return snapshot.use_extension(AmberSnapshotExtension)


def _plain(value: object) -> object:
    """Return ``value`` as JSON-like data with enums as their values."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(_plain(key)): _plain(item) for key, item in value.items()}
    if isinstance(value, list | tuple | set | frozenset):
        items = [_plain(item) for item in value]
        return items if isinstance(value, list | tuple) else sorted(items, key=str)
    return value


async def test_entities_match_snapshot(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, snapshot: SnapshotAssertion
) -> None:
    await firmware_snapshot_saved(hass, loaded_entry)
    entries = er.async_entries_for_config_entry(
        er.async_get(hass), loaded_entry.entry_id
    )
    assert len(entries) == ENTITY_COUNT
    # Disabled entities are registered but never added, so they have neither.
    added = {
        entity_id: entity
        for platform in async_get_platforms(hass, DOMAIN)
        for entity_id, entity in platform.entities.items()
    }
    exposed = {}
    for entry in sorted(entries, key=lambda entry: entry.entity_id):
        entity = added.get(entry.entity_id)
        state = hass.states.get(entry.entity_id)
        exposed[entry.entity_id] = _plain(
            {
                "unique_id": entry.unique_id,
                "translation_key": entry.translation_key,
                "name": entry.original_name,
                "device_class": entry.original_device_class,
                "entity_category": entry.entity_category,
                "disabled_by": entry.disabled_by,
                "unit_of_measurement": entry.unit_of_measurement,
                "supported_features": entry.supported_features,
                "options": getattr(entity, "options", None),
                "state": state.state if state is not None else None,
                "attributes": entity.extra_state_attributes if entity else None,
            }
        )
    assert exposed == snapshot(matcher=_VOLATILE_ATTRIBUTES)


async def test_diagnostics_match_snapshot(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, snapshot: SnapshotAssertion
) -> None:
    await firmware_snapshot_saved(hass, loaded_entry)
    diagnostics = await async_get_config_entry_diagnostics(hass, loaded_entry)
    assert _plain(diagnostics) == snapshot(matcher=_VOLATILE_DIAGNOSTICS)
