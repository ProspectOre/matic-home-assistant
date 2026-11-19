"""Snapshots of what a configured simulated robot exposes.

Both are taken once setup and its firmware snapshot have finished. The entity
snapshot holds every registry entry and state of a robot with no mapped rooms;
the diagnostics snapshot holds the redacted report. Values that
differ on every run, such as ports, tokens, ids, timestamps and source hashes,
are recorded by type only. Update both with `pytest --snapshot-update` and
review the diff like code.
"""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.syrupy import (
    HomeAssistantSnapshotExtension,
)
from syrupy.assertion import SnapshotAssertion
from syrupy.matchers import path_type

from custom_components.matic_robot.diagnostics import (
    async_get_config_entry_diagnostics,
)

from .plan_run import firmware_snapshot_saved

ENTITY_COUNT = 54
_VOLATILE_ATTRIBUTES = path_type(
    {
        r".*\.state\.attributes\.(access_token|entity_picture|matic_entry_id|"
        r"last_snapshot_at|firmware_report\.id)": (str,),
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
    """Serialize registry entries and states without their ids and times."""
    return snapshot.use_extension(HomeAssistantSnapshotExtension)


async def test_entities_match_snapshot(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, snapshot: SnapshotAssertion
) -> None:
    await firmware_snapshot_saved(hass, loaded_entry)
    entries = er.async_entries_for_config_entry(
        er.async_get(hass), loaded_entry.entry_id
    )
    assert len(entries) == ENTITY_COUNT
    exposed = {
        entry.entity_id: {"entry": entry, "state": hass.states.get(entry.entity_id)}
        for entry in sorted(entries, key=lambda entry: entry.entity_id)
    }
    assert exposed == snapshot(matcher=_VOLATILE_ATTRIBUTES)


async def test_diagnostics_match_snapshot(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, snapshot: SnapshotAssertion
) -> None:
    await firmware_snapshot_saved(hass, loaded_entry)
    diagnostics = await async_get_config_entry_diagnostics(hass, loaded_entry)
    assert diagnostics == snapshot(matcher=_VOLATILE_DIAGNOSTICS)
