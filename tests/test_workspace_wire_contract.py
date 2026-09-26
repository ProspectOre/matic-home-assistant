"""Keep the public Python workspace snapshot aligned with its wire fixture."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from homeassistant.config_entries import ConfigEntryState

from custom_components.matic_robot.workspace_socket import WorkspaceSocket

_FIXTURE = Path(__file__).parent / "fixtures" / "workspace_snapshot_v1.json"


def _synthetic_workspace_hass() -> tuple[SimpleNamespace, str]:
    entry_id = "synthetic-entry"
    floor_plan = SimpleNamespace(
        mission_id=42,
        partition_id_wire=b"synthetic-partition",
        mapped_floors=(SimpleNamespace(mission_id=42, label="Main floor"),),
    )
    health = SimpleNamespace(
        state="ready",
        complete=True,
        truncated=False,
        photo_tiles=1,
        structure_tiles=1,
        stream_failures=0,
        bootstrap_state="complete",
        bootstrap_photo_seen=True,
        bootstrap_structure_seen=True,
        bootstrap_failures=0,
    )
    slam_map = SimpleNamespace(
        health=health,
        mission_identity=SimpleNamespace(
            mission_id=42,
            mission_token="synthetic-mission",
        ),
        revision=7,
        live_session_verified=True,
        floor_plan_is_current=lambda plan: plan is floor_plan,
    )
    cleaning_plans = SimpleNamespace(
        snapshot=lambda _serial: {},
        lock=lambda _serial: SimpleNamespace(locked=lambda: False),
        stop_pending=lambda _serial: False,
        pending_native_reconciliation=lambda _serial: None,
    )
    slam_history = SimpleNamespace(
        catalog_for_mission=lambda _mission: (),
        catalogs_by_mission=dict,
    )
    coordinator = SimpleNamespace(
        last_update_success=True,
        data=SimpleNamespace(
            info=SimpleNamespace(serial_number="synthetic-serial"),
            floor_plan=floor_plan,
            telemetry=SimpleNamespace(active_cleaning_session=False),
        ),
    )
    entry = SimpleNamespace(
        entry_id=entry_id,
        state=ConfigEntryState.LOADED,
        runtime_data=SimpleNamespace(
            coordinator=coordinator,
            slam_map=slam_map,
            cleaning_plans=cleaning_plans,
            slam_history=slam_history,
        ),
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda _domain: [entry]),
        data={},
    )
    return hass, entry_id


def test_workspace_snapshot_matches_public_wire_fixture() -> None:
    expected = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    hass, entry_id = _synthetic_workspace_hass()
    socket = WorkspaceSocket(hass)
    socket._epoch = expected["epoch"]

    assert socket.snapshot(entry_id) == expected
