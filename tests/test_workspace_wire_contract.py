"""Pin the workspace socket's messages to their wire bytes.

The snapshot fixture is shared with the browser tests. The other expected
messages were recorded from release/0.6 before the socket was built through
`workspace_schema`; the order of keys is part of what is pinned.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.json import json_bytes

from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
)
from custom_components.matic_robot.client.models import RobotPose
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.frontend import DATA_SLAM_SCENE_VIEW
from custom_components.matic_robot.slam_scene import MaticSlamSceneView
from custom_components.matic_robot.slam_view_data import _map_session_key
from custom_components.matic_robot.workspace_socket import (
    WorkspaceSocket,
    _resync_event,
    websocket_subscribe,
)
from tests.test_slam_scene import _runtime as _scene_runtime
from tests.test_workspace_socket import _connection, _entry, _Hass, _LifecycleEntry

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
        ledger=SimpleNamespace(pending_native_reconciliation=lambda _serial: None),
        control=SimpleNamespace(
            lock=lambda _serial: SimpleNamespace(locked=lambda: False),
            stop_pending=lambda _serial: False,
        ),
        history=SimpleNamespace(snapshot=lambda _serial: {}),
    )
    slam_history = SimpleNamespace(
        catalog_for_mission=lambda _mission: (),
        catalogs_by_mission=dict,
    )
    session = SimpleNamespace(
        info=SimpleNamespace(serial_number="synthetic-serial"),
        error=SimpleNamespace(value=None),
        floor=SimpleNamespace(value=floor_plan),
        state=SimpleNamespace(value=SimpleNamespace(session_active=False)),
    )
    entry = SimpleNamespace(
        entry_id=entry_id,
        state=ConfigEntryState.LOADED,
        runtime_data=SimpleNamespace(
            session=session,
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


def test_snapshot_bytes() -> None:
    """The fixture's bytes, with the revisions in the order the socket adds them."""
    expected = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    hass, entry_id = _synthetic_workspace_hass()
    socket = WorkspaceSocket(hass)
    socket._epoch = expected["epoch"]
    order = ("workspace", "status", "robot_state", "activity", "plans", "areas")
    revisions = {name: expected["revisions"][name] for name in order}
    revisions |= {"plan_state": 0, "scene": 7, "history": 0}

    assert json_bytes(socket.snapshot(entry_id)) == json_bytes(
        expected | {"revisions": revisions}
    )


def test_unavailable_snapshot_bytes() -> None:
    stale = _entry("entry-a")
    stale.runtime_data.session.error.value = AuthenticationRequiredError("refused")
    missing = _entry("entry-b")
    missing.runtime_data.session = None
    socket = WorkspaceSocket(_Hass([stale, missing]))
    socket._epoch = "epoch"

    assert json_bytes(socket.snapshot("entry-a")) == json_bytes(STALE_SNAPSHOT)
    assert json_bytes(socket.snapshot("entry-b")) == json_bytes(
        STALE_SNAPSHOT
        | {
            "entry_id": "entry-b",
            "identity": STALE_SNAPSHOT["identity"] | {"entry_id": "entry-b"},
            "status": {
                "state": "unavailable",
                "reason": "snapshot_required",
                "retryable": True,
            },
        }
    )


def test_subscription_message_bytes() -> None:
    entry = _LifecycleEntry("entry-a")
    entry.runtime_data = _scene_runtime(pose=False)
    entry.runtime_data.session.poses.set(
        {1: RobotPose(0.1, 0.2, 0.0, mission_id=1, observed_at=99.5, heading=0.5)}
    )
    hass = _Hass([entry])
    hass.data[DATA_SLAM_SCENE_VIEW] = MaticSlamSceneView()
    socket = WorkspaceSocket(hass)
    socket._epoch = "epoch"
    hass.data[DOMAIN] = {"workspace_socket": socket}
    socket.track_entry(entry)
    connection = _connection()
    socket.snapshot("entry-a", (connection, 1))
    socket._invalidate("entry-a", ["plans", "areas"], bump_coherence=True)

    with patch("custom_components.matic_robot.slam_view_data.time", return_value=100.0):
        websocket_subscribe(
            hass,
            connection,
            {"id": 2, "entry_id": "entry-a", "version": 1, "poses": True},
        )
    epoch = hass.data[DATA_SLAM_SCENE_VIEW].scene_epoch("entry-a").encode()
    key = _map_session_key(entry.runtime_data)
    assert key is not None

    (result,) = connection.send_result.call_args_list
    invalidate, pose = (call.args[1] for call in connection.send_event.call_args_list)
    assert json_bytes(result.args[1]) == json_bytes(SUBSCRIBED)
    assert json_bytes(invalidate) == json_bytes(INVALIDATE)
    assert json_bytes(pose).replace(epoch, b"EPOCH").replace(
        key.encode(), b"KEY"
    ) == json_bytes(POSE)
    assert json_bytes(_resync_event("overflow")) == json_bytes(
        {"type": "resync", "reason": "overflow"}
    )


STALE_SNAPSHOT: dict[str, Any] = {
    "schema": 1,
    "capabilities": {
        "snapshot": 1,
        "subscription": 1,
        "rest_catalog": 1,
        "catalog_projection": 1,
    },
    "epoch": "epoch",
    "sequence": 0,
    "coherence_generation": 1,
    "entry_id": "entry-a",
    "identity": {
        "entry_id": "entry-a",
        "floor_mission_id": None,
        "floor_verified": False,
    },
    "status": {"state": "stale", "reason": "authorization", "retryable": False},
    "revisions": {
        "workspace": 0,
        "status": 0,
        "robot_state": 0,
        "activity": 0,
        "plans": 0,
        "areas": 0,
        "plan_state": 0,
        "history": 0,
    },
    "payload": {"available": False, "entry": None},
}
SUBSCRIBED = {"version": 1, "epoch": "epoch", "sequence": 1, "queue_limit": 32}
INVALIDATE = {
    "type": "invalidate",
    "invalidation": {
        "epoch": "epoch",
        "sequence": 1,
        "coherence_generation": 2,
        "revisions": {
            "workspace": 1,
            "status": 0,
            "robot_state": 0,
            "plans": 1,
            "areas": 1,
            "plan_state": 0,
            "scene": 7,
            "history": 0,
            "activity": 0,
        },
        "resources": ["areas", "plans"],
    },
}
POSE = {
    "type": "pose",
    "pose": {
        "position": [0.1, 0.2],
        "heading": 0.5,
        "source": "exact_pose",
        "scene_revision": 7,
        "scene_epoch": "EPOCH",
        "map_floor_coherent": True,
        "map_session_key": "KEY",
        "pose_age_seconds": 0.5,
        "observed_at": 99.5,
    },
}
