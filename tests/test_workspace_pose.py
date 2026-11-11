"""Robot pose pushed over the workspace subscription."""

from __future__ import annotations

from types import SimpleNamespace

from homeassistant.config_entries import ConfigEntryState

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.frontend import DATA_SLAM_SCENE_VIEW
from custom_components.matic_robot.slam_scene import MaticSlamSceneView
from custom_components.matic_robot.slam_view_data import pose_projection
from custom_components.matic_robot.workspace_socket import (
    WorkspaceSocket,
    websocket_subscribe,
)
from tests.test_slam_scene import _browser_session_key, _fresh_pose, _runtime
from tests.test_workspace_socket import _connection, _Hass, _LifecycleEntry


def _workspace() -> tuple[WorkspaceSocket, _LifecycleEntry, SimpleNamespace]:
    entry = _LifecycleEntry("entry-a")
    entry.runtime_data = _runtime()
    hass = _Hass([entry])
    hass.data[DATA_SLAM_SCENE_VIEW] = MaticSlamSceneView()
    manager = WorkspaceSocket(hass)
    manager.track_entry(entry)
    return manager, entry, SimpleNamespace(data={DOMAIN: {"workspace_socket": manager}})


def _subscribe(socket_hass: SimpleNamespace, msg_id: int, *, poses: bool) -> object:
    connection = _connection()
    websocket_subscribe(
        socket_hass,
        connection,
        {"id": msg_id, "entry_id": "entry-a", "version": 1, "poses": poses},
    )
    return connection


def _poses(connection) -> list[dict[str, object]]:
    return [
        call.args[1]["pose"]
        for call in connection.send_event.call_args_list
        if call.args[1]["type"] == "pose"
    ]


def test_pose_projection_places_the_newest_pose_on_the_current_scene() -> None:
    runtime = _runtime()
    scene_view = MaticSlamSceneView()

    pose = pose_projection("entry", runtime, scene_view)

    assert 0 <= pose.pop("pose_age_seconds") < 1
    assert pose == {
        "position": [0.1, 0.2],
        "heading": 0.5,
        "source": "exact_pose",
        "scene_revision": scene_view.current_revision("entry", runtime),
        "scene_epoch": scene_view.scene_epoch("entry"),
        "map_floor_coherent": True,
        "map_session_key": _browser_session_key(runtime),
    }
    assert pose_projection("entry", _runtime(pose=False)) | {
        "map_session_key": None
    } == {
        "position": None,
        "heading": None,
        "source": "current_area",
        "scene_revision": None,
        "scene_epoch": None,
        "map_floor_coherent": True,
        "map_session_key": None,
        "pose_age_seconds": None,
    }


def test_poses_go_only_to_subscriptions_that_asked_for_them() -> None:
    manager, entry, socket_hass = _workspace()
    older = _subscribe(socket_hass, 1, poses=False)
    newer = _subscribe(socket_hass, 2, poses=True)

    assert _poses(older) == []
    assert [pose["position"] for pose in _poses(newer)] == [[0.1, 0.2]]

    entry.runtime_data.session.poses.set({1: _fresh_pose(0.3, 0.4, 0.0)})
    assert _poses(older) == []
    assert [pose["position"] for pose in _poses(newer)] == [[0.1, 0.2], [0.3, 0.4]]

    newer.subscriptions[2]()
    entry.runtime_data.session.poses.set({1: _fresh_pose(0.5, 0.6, 0.0)})
    assert len(_poses(newer)) == 2
    assert manager._pose_subscribers == {"entry-a": set()}


def test_poses_stop_for_a_demoted_user_and_an_unloading_entry() -> None:
    manager, entry, socket_hass = _workspace()
    demoted = _subscribe(socket_hass, 1, poses=True)
    kept = _subscribe(socket_hass, 2, poses=True)
    demoted.user.is_admin = False

    entry.runtime_data.session.poses.set({1: _fresh_pose(0.3, 0.4, 0.0)})
    assert len(_poses(demoted)) == 1
    assert len(_poses(kept)) == 2
    assert manager._pose_subscribers["entry-a"] == {kept}

    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    entry.runtime_data.session.poses.set({1: _fresh_pose(0.5, 0.6, 0.0)})
    manager.send_pose(kept, "entry-a")
    assert len(_poses(kept)) == 2
    assert "entry-a" not in manager._pose_subscribers


def test_a_new_map_authority_republishes_the_pose() -> None:
    manager, entry, socket_hass = _workspace()
    connection = _subscribe(socket_hass, 1, poses=True)
    manager._async_scene_changed("entry-a")
    assert len(_poses(connection)) == 1

    # A robot that sends no new pose still gets one projected on the new authority.
    entry.runtime_data.slam_map.live_session_verified = False
    manager._async_scene_changed("entry-a")
    assert len(_poses(connection)) == 2
