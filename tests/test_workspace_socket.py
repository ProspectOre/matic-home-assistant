"""Focused protocol tests for the Map Studio workspace websocket."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from homeassistant.auth.const import GROUP_ID_ADMIN, GROUP_ID_USER
from homeassistant.components.websocket_api.commands import handle_unsubscribe_events
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.exceptions import Unauthorized

from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.frontend import DATA_SLAM_SCENE_VIEW
from custom_components.matic_robot.slam_scene import MaticSlamSceneView
from custom_components.matic_robot.stores import LiveState
from custom_components.matic_robot.workspace_socket import (
    QUEUE_LIMIT,
    SNAPSHOT_CURSOR_LIMIT,
    WorkspaceError,
    WorkspaceSocket,
    websocket_snapshot,
    websocket_subscribe,
)
from tests import runtime_fakes


class _Hass:
    def __init__(self, entries: list[object]) -> None:
        self.config_entries = SimpleNamespace(async_entries=lambda _domain: entries)
        self.data: dict[str, object] = {}
        self.bus = SimpleNamespace(
            async_listen=MagicMock(return_value=MagicMock()),
            async_listen_once=MagicMock(return_value=MagicMock()),
        )


_session = runtime_fakes.session
_Publisher = runtime_fakes.Publisher
_PlanPublisher = runtime_fakes.PlanPublisher
_ScenePublisher = runtime_fakes.ScenePublisher
_HistoryPublisher = runtime_fakes.HistoryPublisher


def _set_cleaning(session: SimpleNamespace, cleaning: bool) -> None:
    session.state.set(LiveState(SimpleNamespace(cleaning=cleaning), False))


def _session_listeners(session: SimpleNamespace) -> list[Any]:
    stores = (session.error, session.state, session.floor, session.telemetry)
    return [listener for store in stores for listener in store._listeners]


def _notify_unchanged(session: SimpleNamespace) -> None:
    """Call the session listeners as a store would, without a new value."""
    for listener in _session_listeners(session):
        listener()


def _entry(entry_id: str, *, loaded: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        entry_id=entry_id,
        state=ConfigEntryState.LOADED if loaded else ConfigEntryState.SETUP_RETRY,
        runtime_data=runtime_fakes.runtime(),
    )


class _LifecycleEntry(SimpleNamespace):
    def __init__(self, entry_id: str) -> None:
        super().__init__(
            entry_id=entry_id,
            state=ConfigEntryState.LOADED,
            runtime_data=runtime_fakes.runtime(),
        )
        self.state_callbacks = []
        self.unload_callbacks = []

    def async_on_state_change(self, callback: Any) -> Any:
        self.state_callbacks.append(callback)
        return lambda: self.state_callbacks.remove(callback)

    def async_on_unload(self, callback: Any) -> None:
        self.unload_callbacks.append(callback)

    def set_state(self, state: ConfigEntryState) -> None:
        self.state = state
        for callback in tuple(self.state_callbacks):
            callback()

    def run_unload_callbacks(self) -> None:
        for callback in tuple(self.unload_callbacks):
            callback()
        self.unload_callbacks.clear()


def _connection(*, admin: bool = True) -> Any:
    class Connection:
        def __init__(self) -> None:
            self.subscriptions = {}
            self.send_event = MagicMock()
            self.send_result = MagicMock()
            self.send_error = MagicMock()

    connection = Connection()
    connection.user = SimpleNamespace(is_admin=admin)
    return connection


def _snapshot(
    manager: WorkspaceSocket, entry_id: str, connection: Any
) -> dict[str, Any]:
    request_id = getattr(connection, "next_request_id", 0) + 1
    connection.next_request_id = request_id
    return manager.snapshot(entry_id, (connection, request_id))


def _emit(manager: WorkspaceSocket, entry_id: str, *, kind: str | None = None) -> None:
    manager._async_event(SimpleNamespace(data={"entry_id": entry_id, "kind": kind}))


def test_snapshot_is_versioned_minimized_and_admin_only() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    hass.data[DOMAIN] = {"workspace_socket": manager}
    connection = _connection()

    websocket_snapshot(
        hass,
        connection,
        {"id": 1, "entry_id": "entry-a", "version": 1},
    )

    snapshot = connection.send_result.call_args.args[1]
    projection = snapshot["payload"]["entry"]
    assert projection["entry_id"] == "entry-a"
    assert projection["map_floor_coherent"] is False
    assert snapshot == {
        "schema": 1,
        "capabilities": {
            "snapshot": 1,
            "subscription": 1,
            "rest_catalog": 1,
            "catalog_projection": 1,
        },
        "epoch": manager._epoch,
        "sequence": 0,
        "coherence_generation": 1,
        "entry_id": "entry-a",
        "identity": {
            "entry_id": "entry-a",
            "floor_mission_id": None,
            "floor_verified": False,
        },
        "status": {"state": "ready", "reason": None, "retryable": False},
        "revisions": {
            "workspace": 0,
            "status": 0,
            "robot_state": 0,
            "activity": 0,
            "plans": 0,
            "areas": 0,
            "plan_state": 0,
            "scene": 1,
            "history": 0,
        },
        "payload": {"available": True, "entry": projection},
    }
    assert "private-serial" not in repr(snapshot)
    assert "123.0" not in repr(snapshot)
    assert snapshot["coherence_generation"] > 0
    assert snapshot["coherence_generation"] != snapshot["sequence"]

    with pytest.raises(Unauthorized):
        websocket_snapshot(
            hass,
            _connection(admin=False),
            {"id": 2, "entry_id": "entry-a", "version": 1},
        )


def test_snapshot_exposes_only_verified_floor_and_existing_resource_revisions() -> None:
    entry = _entry("entry-a")
    entry.runtime_data.session.floor.value = SimpleNamespace(
        mission_id=47, mapped_floors=()
    )
    entry.runtime_data.slam_map.revision = 12
    entry.runtime_data.slam_history.snapshots = (
        runtime_fakes.history_snapshot("snapshot-a", 3),
        runtime_fakes.history_snapshot("snapshot-b", 8),
    )
    manager = WorkspaceSocket(_Hass([entry]))

    snapshot = manager.snapshot("entry-a")

    assert snapshot["identity"] == {
        "entry_id": "entry-a",
        "floor_mission_id": 47,
        "floor_verified": True,
    }
    assert snapshot["revisions"] == {
        "workspace": 0,
        "scene": 12,
        "history": 8,
        "status": 0,
        "robot_state": 0,
        "activity": 0,
        "plans": 0,
        "areas": 0,
        "plan_state": 0,
    }
    assert "pose" not in repr(snapshot)
    assert "private-serial" not in repr(snapshot)


def test_snapshot_scene_fence_uses_current_revision_while_payload_is_cached() -> None:
    entry = _entry("entry-a")
    entry.runtime_data.session.floor.value = SimpleNamespace(mission_id=47)
    entry.runtime_data.slam_map.revision = 8
    hass = _Hass([entry])
    scene_view = SimpleNamespace(current_revision=MagicMock(return_value=8))
    hass.data[DATA_SLAM_SCENE_VIEW] = scene_view
    projection = {
        "map_floor_coherent": True,
        "map_session_verified": True,
        "map_revision": 4,
    }
    manager = WorkspaceSocket(hass)

    with patch(
        "custom_components.matic_robot.workspace_socket.catalog_entry_projection",
        return_value=projection,
    ):
        first = manager.snapshot("entry-a")
        scene_view.current_revision.return_value = 9
        second = manager.snapshot("entry-a")

    assert first["payload"]["entry"]["map_revision"] == 4
    assert first["revisions"]["scene"] == 8
    assert second["payload"]["entry"]["map_revision"] == 4
    assert second["revisions"]["scene"] == 9


def test_snapshot_marks_unreachable_robot_stale_without_reusing_floor_identity() -> (
    None
):
    entry = _entry("entry-a")
    entry.runtime_data.session.error.value = RuntimeError("private detail")
    entry.runtime_data.session.floor.value = SimpleNamespace(mission_id=47)
    is_current = MagicMock(return_value=True)
    entry.runtime_data.slam_map.revision = 12
    entry.runtime_data.slam_map.floor_plan_is_current = is_current
    manager = WorkspaceSocket(_Hass([entry]))

    snapshot = manager.snapshot("entry-a")

    assert snapshot["payload"] == {"available": False, "entry": None}
    assert snapshot["status"] == {
        "state": "stale",
        "reason": "snapshot_required",
        "retryable": True,
    }
    assert snapshot["identity"]["floor_mission_id"] is None
    assert snapshot["identity"]["floor_verified"] is False
    assert snapshot["revisions"] == {
        "workspace": 0,
        "status": 0,
        "robot_state": 0,
        "activity": 0,
        "plans": 0,
        "areas": 0,
        "plan_state": 0,
        "history": 0,
    }
    is_current.assert_not_called()
    assert "private detail" not in repr(snapshot)


def test_snapshot_authorization_status_is_typed() -> None:
    entry = _entry("entry-a")
    entry.runtime_data.session.error.value = AuthenticationRequiredError(
        "auth required"
    )
    manager = WorkspaceSocket(_Hass([entry]))

    refused = manager.snapshot("entry-a")

    assert refused["payload"] == {"available": False, "entry": None}
    assert refused["status"] == {
        "state": "stale",
        "reason": "authorization",
        "retryable": False,
    }
    assert "auth required" not in repr(refused)
    assert refused["identity"]["floor_mission_id"] is None


def test_snapshot_and_subscribe_replay_intervening_events_per_entry() -> None:
    hass = _Hass([_entry("entry-a"), _entry("entry-b")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    snapshot = _snapshot(manager, "entry-a", connection)
    assert snapshot["sequence"] == 0

    _emit(manager, "entry-a")
    _emit(manager, "entry-b")
    replay = manager.subscribe(connection, "entry-a", 7)

    assert len(replay) == 1
    assert replay[0] == {
        "type": "invalidate",
        "invalidation": {
            "epoch": manager._epoch,
            "sequence": 1,
            "coherence_generation": 1,
            "revisions": {
                "workspace": 1,
                "status": 0,
                "robot_state": 0,
                "activity": 1,
                "plans": 0,
                "areas": 0,
                "plan_state": 0,
                "scene": 1,
                "history": 0,
            },
            "resources": ["activity"],
        },
    }
    assert set(manager._history) == {"entry-a", "entry-b"}
    assert manager._subscriptions == {"entry-a": {connection: 7}}


def test_live_invalidation_and_unsubscribe() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    _snapshot(manager, "entry-a", connection)
    manager.subscribe(connection, "entry-a", 5)

    _emit(manager, "entry-a")

    connection.send_event.assert_called_once_with(
        5,
        {
            "type": "invalidate",
            "invalidation": {
                "epoch": manager._epoch,
                "sequence": 1,
                "coherence_generation": 1,
                "revisions": {
                    "workspace": 1,
                    "status": 0,
                    "robot_state": 0,
                    "activity": 1,
                    "plans": 0,
                    "areas": 0,
                    "plan_state": 0,
                    "scene": 1,
                    "history": 0,
                },
                "resources": ["activity"],
            },
        },
    )
    connection.subscriptions[5]()
    connection.send_event.reset_mock()
    _emit(manager, "entry-a")
    connection.send_event.assert_not_called()


def test_status_and_activity_events_do_not_advance_spatial_generation() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    _snapshot(manager, "entry-a", connection)
    manager.subscribe(connection, "entry-a", 5)

    _emit(manager, "entry-a", kind="state")
    status = connection.send_event.call_args.args[1]["invalidation"]
    assert status["resources"] == ["status"]
    assert status["coherence_generation"] == 1

    _emit(manager, "entry-a", kind="completed")
    activity = connection.send_event.call_args.args[1]["invalidation"]
    assert activity["resources"] == ["activity"]
    assert activity["coherence_generation"] == 1
    assert activity["sequence"] == 2


def test_plan_and_area_changes_publish_only_observed_resource_revisions() -> None:
    entry = _LifecycleEntry("entry-a")
    plans = entry.runtime_data.cleaning_plans
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 21)

    plans.plan_data["plan-a"]["name"] = "Evening"
    plans.publish()

    first_event = connection.send_event.call_args.args[1]["invalidation"]
    assert first_event["resources"] == ["plan_state", "plans"]
    assert first_event["coherence_generation"] == 1
    assert first_event["revisions"] == {
        "workspace": 1,
        "status": 0,
        "robot_state": 0,
        "plans": 1,
        "areas": 0,
        "plan_state": 1,
        "scene": 1,
        "history": 0,
    }

    plans.area_data["area-a"] = {"name": "Kitchen"}
    plans.publish()

    second_event = connection.send_event.call_args.args[1]["invalidation"]
    assert second_event["resources"] == ["areas", "plan_state"]
    assert second_event["sequence"] == 2
    assert second_event["coherence_generation"] == 1
    assert second_event["revisions"]["plans"] == 1
    assert second_event["revisions"]["areas"] == 1
    assert second_event["revisions"]["plan_state"] == 2

    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    assert not plans.listeners


def test_scene_and_history_publish_from_their_authoritative_stores() -> None:
    entry = _LifecycleEntry("entry-a")
    entry.runtime_data.session = _session(
        floor_plan=SimpleNamespace(mission_id=47, mapped_floors=())
    )
    scene = _ScenePublisher()
    history = _HistoryPublisher()
    entry.runtime_data.slam_map = scene
    entry.runtime_data.slam_history = history
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    _snapshot(manager, "entry-a", connection)
    manager.subscribe(connection, "entry-a", 22)

    scene.revision = 2
    scene.publish()
    scene_event = connection.send_event.call_args.args[1]["invalidation"]
    assert scene_event["resources"] == ["scene"]
    assert scene_event["coherence_generation"] == 1
    assert scene_event["revisions"]["scene"] == 2

    scene.publish()
    assert connection.send_event.call_count == 1

    history.snapshots = (runtime_fakes.history_snapshot("snapshot-a", 5),)
    history.publish()
    history_event = connection.send_event.call_args.args[1]["invalidation"]
    assert history_event["resources"] == ["history"]
    assert history_event["revisions"]["history"] == 1
    assert history_event["sequence"] == 2
    assert history_event["coherence_generation"] == 1
    history.publish()
    assert connection.send_event.call_count == 2

    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    assert not scene.listeners
    assert not history.listeners
    assert not _session_listeners(entry.runtime_data.session)
    assert not entry.runtime_data.session.poses._listeners


def test_scene_boundary_tracks_session_loss_and_restore_at_fixed_revision() -> None:
    entry = _LifecycleEntry("entry-a")
    entry.runtime_data.session = _session(
        floor_plan=SimpleNamespace(mission_id=47, mapped_floors=())
    )
    scene = _ScenePublisher()
    entry.runtime_data.slam_map = scene
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 26)

    scene.live_session_verified = False
    scene.publish()
    lost = connection.send_event.call_args.args[1]["invalidation"]
    assert lost["resources"] == ["scene"]
    assert lost["sequence"] == 1
    assert lost["coherence_generation"] == 2
    assert lost["revisions"]["scene"] == 1

    scene.publish()
    assert connection.send_event.call_count == 1

    scene.live_session_verified = True
    scene.publish()
    restored = connection.send_event.call_args.args[1]["invalidation"]
    assert connection.send_event.call_count == 2
    assert restored["sequence"] == 2
    assert restored["coherence_generation"] == 3
    assert restored["revisions"]["scene"] == 1


def test_scene_content_burst_does_not_advance_coherence_generation() -> None:
    entry = _LifecycleEntry("entry-a")
    entry.runtime_data.session = _session(
        floor_plan=SimpleNamespace(mission_id=47, mapped_floors=())
    )
    scene = _ScenePublisher()
    entry.runtime_data.slam_map = scene
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 27)

    for revision in range(2, 202):
        scene.revision = revision
        scene.publish()

    assert connection.send_event.call_count == 200
    invalidation = connection.send_event.call_args.args[1]["invalidation"]
    assert invalidation["sequence"] == 200
    assert invalidation["coherence_generation"] == 1
    assert invalidation["revisions"]["scene"] == 201


def test_scene_boundary_tracks_identity_and_floor_geometry_changes() -> None:
    entry = _LifecycleEntry("entry-a")
    entry.runtime_data.session = _session(
        floor_plan=SimpleNamespace(
            mission_id=47,
            partition_protocol_id="partition-a",
            rooms=(SimpleNamespace(name="Kitchen", boundary=((0, 0),)),),
        )
    )
    scene = _ScenePublisher()
    entry.runtime_data.slam_map = scene
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 28)

    scene.mission_identity = SimpleNamespace(mission_token="mission-a", mission_id=47)
    scene.publish()
    identity_change = connection.send_event.call_args.args[1]["invalidation"]
    assert identity_change["coherence_generation"] == 2

    entry.runtime_data.session.floor.set(
        SimpleNamespace(
            mission_id=47,
            partition_protocol_id="partition-b",
            rooms=(SimpleNamespace(name="Kitchen", boundary=((0, 0), (1, 0))),),
        )
    )
    scene.publish()
    geometry_change = connection.send_event.call_args.args[1]["invalidation"]
    assert connection.send_event.call_count == 2
    assert geometry_change["coherence_generation"] == 3

    entry.runtime_data.session.info.serial_number = "another-private-serial"
    scene.publish()
    robot_change = connection.send_event.call_args.args[1]["invalidation"]
    assert connection.send_event.call_count == 3
    assert robot_change["coherence_generation"] == 4


def test_scene_invalidation_tracks_floor_geometry_at_fixed_mission_and_revision() -> (
    None
):
    """A floor-plan-only update invalidates the scene resource for clients."""
    entry = _LifecycleEntry("entry-a")
    entry.runtime_data.session = _session(
        floor_plan=SimpleNamespace(
            mission_id=47,
            partition_protocol_id="partition-a",
            rooms=(SimpleNamespace(name="Kitchen", boundary=((0, 0),)),),
        )
    )
    scene = _ScenePublisher()
    entry.runtime_data.slam_map = scene
    manager = WorkspaceSocket(_Hass([entry]))
    manager.hass.data[DATA_SLAM_SCENE_VIEW] = MaticSlamSceneView()
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 25)

    entry.runtime_data.session.floor.set(
        SimpleNamespace(
            mission_id=47,
            partition_protocol_id="partition-b",
            rooms=(SimpleNamespace(name="Kitchen", boundary=((0, 0), (1, 0))),),
        )
    )

    invalidation = connection.send_event.call_args.args[1]["invalidation"]
    assert invalidation["resources"] == ["scene"]
    assert invalidation["coherence_generation"] == 2
    assert invalidation["revisions"]["scene"] == 2


def test_session_publishes_status_and_operational_changes_only() -> None:
    entry = _LifecycleEntry("entry-a")
    session = entry.runtime_data.session
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 23)

    session.error.set(RuntimeError("offline"))
    status_event = connection.send_event.call_args.args[1]["invalidation"]
    assert status_event["resources"] == ["status"]
    assert status_event["coherence_generation"] == 1
    assert status_event["revisions"]["status"] == 1
    assert status_event["revisions"]["robot_state"] == 0

    _set_cleaning(session, True)
    state_event = connection.send_event.call_args.args[1]["invalidation"]
    assert state_event["resources"] == ["robot_state"]
    assert state_event["coherence_generation"] == 1
    assert state_event["revisions"]["robot_state"] == 1
    assert state_event["sequence"] == 2

    _notify_unchanged(session)
    assert connection.send_event.call_count == 2

    callback = session.state._listeners[0]
    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    callback()
    assert connection.send_event.call_count == 3
    assert connection.send_event.call_args.args[1] == {
        "type": "resync",
        "reason": "entry_removed",
    }


def test_session_push_reconnect_replays_gap_and_recovers_after_overflow() -> None:
    """A reconnect gets missed robot changes or a fresh snapshot after overflow."""
    entry = _LifecycleEntry("entry-a")
    session = entry.runtime_data.session
    manager = WorkspaceSocket(_Hass([entry]))
    manager.track_entry(entry)

    def publish_cleaning(cleaning: bool) -> None:
        _set_cleaning(session, cleaning)

    first = _connection()
    websocket_snapshot(
        SimpleNamespace(data={DOMAIN: {"workspace_socket": manager}}),
        first,
        {"id": 1, "entry_id": "entry-a", "version": 1},
    )
    websocket_subscribe(
        SimpleNamespace(data={DOMAIN: {"workspace_socket": manager}}),
        first,
        {"id": 2, "entry_id": "entry-a", "version": 1, "poses": False},
    )

    publish_cleaning(True)
    live_event = first.send_event.call_args.args[1]["invalidation"]
    assert live_event["resources"] == ["robot_state"]
    assert live_event["sequence"] == 1

    # The old socket is gone. Changes during the gap are recorded for replay.
    first.subscriptions[2]()
    publish_cleaning(False)

    reconnected = _connection()
    hass = SimpleNamespace(data={DOMAIN: {"workspace_socket": manager}})
    snapshot = manager.snapshot("entry-a", (reconnected, 3))
    assert snapshot["sequence"] == 2
    publish_cleaning(True)
    websocket_subscribe(
        hass,
        reconnected,
        {"id": 4, "entry_id": "entry-a", "version": 1, "poses": False},
    )
    replayed = reconnected.send_event.call_args.args[1]
    assert replayed["type"] == "invalidate"
    assert replayed["invalidation"]["sequence"] == 3
    assert replayed["invalidation"]["resources"] == ["robot_state"]

    # A longer disconnect than the bounded history yields a typed resync.
    reconnected.subscriptions[4]()
    overflow_connection = _connection()
    fresh_before_gap = manager.snapshot("entry-a", (overflow_connection, 5))
    assert fresh_before_gap["sequence"] == 3
    for index in range(QUEUE_LIMIT + 1):
        publish_cleaning(bool(index % 2))
    websocket_subscribe(
        hass,
        overflow_connection,
        {"id": 6, "entry_id": "entry-a", "version": 1, "poses": False},
    )
    assert overflow_connection.send_event.call_args.args == (
        6,
        {"type": "resync", "reason": "overflow"},
    )

    overflow_connection.send_event.reset_mock()
    fresh_snapshot = manager.snapshot("entry-a", (overflow_connection, 7))
    assert fresh_snapshot["sequence"] == 3 + QUEUE_LIMIT + 1
    assert fresh_snapshot["revisions"]["robot_state"] == 3 + QUEUE_LIMIT + 1
    websocket_subscribe(
        hass,
        overflow_connection,
        {"id": 8, "entry_id": "entry-a", "version": 1, "poses": False},
    )
    assert overflow_connection.send_event.call_count == 0

    publish_cleaning(not session.state.value.operational.cleaning)
    continuation = overflow_connection.send_event.call_args.args[1]["invalidation"]
    assert continuation["sequence"] == fresh_snapshot["sequence"] + 1
    assert continuation["resources"] == ["robot_state"]


def test_session_invalidates_areas_when_zones_change() -> None:
    entry = _LifecycleEntry("entry-a")
    session = _session(zones=("kitchen-no-go",))
    entry.runtime_data.session = session
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 23)

    _notify_unchanged(session)
    assert connection.send_event.call_count == 0

    session.telemetry.set(SimpleNamespace(zones=("kitchen-no-go", "stairs")))
    event = connection.send_event.call_args.args[1]["invalidation"]
    assert event["resources"] == ["areas"]
    assert event["revisions"]["areas"] == 1

    _notify_unchanged(session)
    assert connection.send_event.call_count == 1


@pytest.mark.asyncio
async def test_untracked_entries_and_repeated_cleanup_are_safe() -> None:
    entry = _LifecycleEntry("entry-a")
    manager = WorkspaceSocket(_Hass([entry]))
    manager._untrack_entry("missing")
    manager._async_session_changed("entry-a")
    manager._async_scene_changed("entry-a")
    manager._async_history_changed("entry-a")
    manager._invalidate("entry-a", ["workspace"])
    assert manager._sequence.get("entry-a", 0) == 1

    manager.track_entry(entry)
    plans = entry.runtime_data.cleaning_plans
    history = entry.runtime_data.slam_history
    plan_listener = next(iter(plans.listeners))
    history_listener = next(iter(history.listeners))
    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    plan_listener()
    history_listener()
    entry.run_unload_callbacks()
    manager._untrack_entry("entry-a")
    await manager.async_stop()
    manager._invalidate("entry-a", ["workspace"])
    assert manager._sequence.get("entry-a", 0) == 1


def test_bounded_replay_returns_typed_overflow_resync() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    _snapshot(manager, "entry-a", connection)
    for _ in range(QUEUE_LIMIT + 1):
        _emit(manager, "entry-a")

    assert manager.subscribe(connection, "entry-a", 6) == [
        {"type": "resync", "reason": "overflow"}
    ]
    assert len(manager._history["entry-a"]) == QUEUE_LIMIT


def test_entry_removal_resyncs_and_keeps_epoch_sequence_monotonic() -> None:
    entry = _entry("entry-a")
    hass = _Hass([entry])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    manager.subscribe(connection, "entry-a", 8)
    _emit(manager, "entry-a")
    assert manager._sequence["entry-a"] == 1
    assert manager._coherence_generation["entry-a"] == 1

    hass.config_entries.async_entries = lambda _domain: []
    _emit(manager, "entry-a")
    assert connection.send_event.call_args.args == (
        8,
        {"type": "resync", "reason": "entry_removed"},
    )
    assert "entry-a" not in manager._history
    assert manager._sequence["entry-a"] == 1
    assert manager._coherence_generation["entry-a"] == 2

    hass.config_entries.async_entries = lambda _domain: [entry]
    _emit(manager, "entry-a")
    assert manager._sequence["entry-a"] == 2
    assert manager._coherence_generation["entry-a"] == 2


def test_unloaded_entry_and_subscribe_request_authorization() -> None:
    hass = _Hass([_entry("entry-a", loaded=False)])
    manager = WorkspaceSocket(hass)
    hass.data[DOMAIN] = {"workspace_socket": manager}
    connection = _connection()
    with pytest.raises(WorkspaceError):
        manager.snapshot("entry-a")
    with pytest.raises(WorkspaceError):
        manager.subscribe(connection, "entry-a", 9)

    hass.config_entries.async_entries = lambda _domain: [_entry("entry-a")]
    with pytest.raises(Unauthorized):
        websocket_subscribe(
            hass,
            _connection(admin=False),
            {"id": 9, "entry_id": "entry-a", "version": 1, "poses": False},
        )

    connection = _connection()
    connection.user = None
    with pytest.raises(Unauthorized):
        websocket_subscribe(
            hass,
            connection,
            {"id": 10, "entry_id": "entry-a", "version": 1, "poses": False},
        )


@pytest.mark.asyncio
async def test_admin_demotion_removes_workspace_subscription_before_delivery(
    hass,
) -> None:
    """A live connection stops receiving workspace events after admin demotion."""
    user = await hass.auth.async_create_system_user(
        "synthetic-workspace-user", group_ids=[GROUP_ID_ADMIN]
    )
    assert user.is_admin

    hass.data.setdefault("websocket_api", {})
    send_message = MagicMock()
    connection = ActiveConnection(
        MagicMock(), hass, send_message, user, refresh_token=None, remote=None
    )
    manager = WorkspaceSocket(_Hass([_entry("entry-a")]))
    manager.subscribe(connection, "entry-a", 11)

    await hass.auth.async_update_user(user, group_ids=[GROUP_ID_USER])

    assert connection.user is user
    assert not connection.user.is_admin
    manager._invalidate("entry-a", ["robot_state"])

    send_message.assert_not_called()
    assert not manager._subscriptions
    assert 11 not in connection.subscriptions


def test_websocket_subscribe_returns_handshake_and_replays_snapshot_gap() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    hass.data[DOMAIN] = {"workspace_socket": manager}
    connection = _connection()

    _snapshot(manager, "entry-a", connection)
    _emit(manager, "entry-a")
    websocket_subscribe(
        hass,
        connection,
        {"id": 12, "entry_id": "entry-a", "version": 1, "poses": False},
    )

    connection.send_result.assert_called_once_with(
        12,
        {
            "version": 1,
            "epoch": manager._epoch,
            "sequence": 1,
            "queue_limit": QUEUE_LIMIT,
        },
    )
    connection.send_event.assert_called_once_with(
        12,
        {
            "type": "invalidate",
            "invalidation": {
                "epoch": manager._epoch,
                "sequence": 1,
                "coherence_generation": 1,
                "revisions": {
                    "workspace": 1,
                    "status": 0,
                    "robot_state": 0,
                    "activity": 1,
                    "plans": 0,
                    "areas": 0,
                    "plan_state": 0,
                    "scene": 1,
                    "history": 0,
                },
                "resources": ["activity"],
            },
        },
    )


def test_workspace_callbacks_use_home_assistant_numeric_unsubscribe_ids() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    hass.data[DOMAIN] = {"workspace_socket": manager}
    connection = _connection()

    websocket_snapshot(
        hass,
        connection,
        {"id": 21, "entry_id": "entry-a", "version": 1},
    )
    assert set(connection.subscriptions) == {21}
    connection.send_result.reset_mock()
    handle_unsubscribe_events(hass, connection, {"id": 22, "subscription": 21})
    connection.send_result.assert_called_once_with(22)
    assert not manager._snapshots

    websocket_snapshot(
        hass,
        connection,
        {"id": 23, "entry_id": "entry-a", "version": 1},
    )
    websocket_subscribe(
        hass,
        connection,
        {"id": 24, "entry_id": "entry-a", "version": 1, "poses": False},
    )
    assert set(connection.subscriptions) == {24}

    websocket_subscribe(
        hass,
        connection,
        {"id": 26, "entry_id": "entry-a", "version": 1, "poses": False},
    )
    assert set(connection.subscriptions) == {26}
    assert manager._subscriptions == {"entry-a": {connection: 26}}
    handle_unsubscribe_events(hass, connection, {"id": 27, "subscription": 24})
    connection.send_error.assert_called_once()
    assert set(connection.subscriptions) == {26}
    assert manager._subscriptions == {"entry-a": {connection: 26}}
    connection.send_error.reset_mock()

    connection.send_result.reset_mock()

    handle_unsubscribe_events(hass, connection, {"id": 28, "subscription": 26})

    connection.send_result.assert_called_once_with(28)
    connection.send_error.assert_not_called()
    assert not manager._subscriptions
    assert not manager._snapshots
    assert not connection.subscriptions


def test_stale_workspace_callbacks_cannot_remove_replacement_registration() -> None:
    manager = WorkspaceSocket(_Hass([_entry("entry-a")]))
    connection = _connection()

    manager.snapshot("entry-a", (connection, 31))
    stale_cursor_cleanup = connection.subscriptions[31]
    manager.snapshot("entry-a", (connection, 32))
    stale_cursor_cleanup()
    assert set(connection.subscriptions) == {32}
    assert manager._snapshots[connection]["entry-a"].request_id == 32

    manager.subscribe(connection, "entry-a", 41)
    stale_subscription_cleanup = connection.subscriptions[41]
    manager.subscribe(connection, "entry-a", 42)
    stale_subscription_cleanup()

    assert manager._subscriptions == {"entry-a": {connection: 42}}
    assert set(connection.subscriptions) == {42}


def test_malformed_and_closed_events_are_ignored() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    for data in ({}, {"entry_id": 7}):
        manager._async_event(SimpleNamespace(data=data))
    assert manager._sequence == {}
    assert manager._history == {}

    manager._closed = True
    _emit(manager, "entry-a")
    assert manager._sequence == {}
    assert manager._history == {}


def test_entry_removal_drops_connection_snapshot_cursors() -> None:
    entry = _entry("entry-a")
    hass = _Hass([entry])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    idle_connection = _connection()
    _snapshot(manager, "entry-a", connection)
    _snapshot(manager, "entry-a", idle_connection)
    manager.subscribe(connection, "entry-a", 13)
    # An already-active stream buffers updates during reads, so only idle
    # snapshots need retained replay cursors.
    _snapshot(manager, "entry-a", connection)
    assert connection not in manager._snapshots
    assert idle_connection in manager._snapshots

    hass.config_entries.async_entries = lambda _domain: []
    _emit(manager, "entry-a")

    assert connection not in manager._snapshots
    assert connection.subscriptions == {}
    assert manager._subscriptions == {}
    assert idle_connection not in manager._snapshots


def test_connection_close_clears_abandoned_snapshot_cursor() -> None:
    manager = WorkspaceSocket(
        _Hass([_entry("entry-a"), _entry("entry-b"), _entry("entry-c")])
    )
    connection = _connection()
    _snapshot(manager, "entry-a", connection)
    _snapshot(manager, "entry-b", connection)
    manager.subscribe(connection, "entry-c", 50)

    # HA iterates its live values view during connection close; callbacks must
    # not mutate the registrations map while that loop is running.
    for unsubscribe in connection.subscriptions.values():
        unsubscribe()
    connection.subscriptions.clear()

    assert connection not in manager._snapshots
    assert not manager._subscriptions
    assert connection.subscriptions == {}


def test_pending_snapshot_cursors_are_bounded_per_connection() -> None:
    entries = [_entry(f"entry-{index}") for index in range(SNAPSHOT_CURSOR_LIMIT + 1)]
    manager = WorkspaceSocket(_Hass(entries))
    connection = _connection()

    for entry in entries[:SNAPSHOT_CURSOR_LIMIT]:
        _snapshot(manager, entry.entry_id, connection)
    _snapshot(manager, entries[0].entry_id, connection)
    with pytest.raises(WorkspaceError, match="Too many pending workspace snapshots"):
        _snapshot(manager, entries[-1].entry_id, connection)

    assert len(manager._snapshots[connection]) == SNAPSHOT_CURSOR_LIMIT
    assert len(connection.subscriptions) == SNAPSHOT_CURSOR_LIMIT


@pytest.mark.asyncio
async def test_start_and_stop_are_idempotent_and_stop_callback_closes_manager() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)

    await manager.async_start()
    await manager.async_start()
    assert hass.bus.async_listen.call_count == 3
    assert hass.bus.async_listen_once.call_count == 0

    stop_callback = hass.bus.async_listen.call_args_list[2].args[1]
    await stop_callback(None)
    await manager.async_stop()

    assert manager._closed
    assert not manager._unsubscribers
    assert hass.bus.async_listen.call_count == 3


@pytest.mark.asyncio
async def test_async_register_returns_existing_workspace_socket() -> None:
    from custom_components.matic_robot.workspace_socket import async_register

    hass = _Hass([_entry("entry-a")])
    existing = WorkspaceSocket(hass)
    hass.data[DOMAIN] = {"workspace_socket": existing}

    with patch(
        "custom_components.matic_robot.workspace_socket.websocket_api.async_register_command"
    ) as register_command:
        assert await async_register(hass) is existing

    register_command.assert_not_called()


@pytest.mark.asyncio
async def test_async_register_creates_and_starts_workspace_socket() -> None:
    from custom_components.matic_robot.workspace_socket import async_register

    hass = _Hass([_entry("entry-a")])

    with patch(
        "custom_components.matic_robot.workspace_socket.websocket_api.async_register_command"
    ) as register_command:
        manager = await async_register(hass)

    assert manager is hass.data[DOMAIN]["workspace_socket"]
    assert isinstance(manager, WorkspaceSocket)
    assert not manager._closed
    assert len(manager._unsubscribers) == 3
    assert register_command.call_count == 2


@pytest.mark.asyncio
async def test_stop_sends_restart_resync_and_removes_subscriptions() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    _snapshot(manager, "entry-a", connection)
    manager.subscribe(connection, "entry-a", 11)
    await manager.async_start()

    await manager.async_stop()

    connection.send_event.assert_called_once_with(
        11, {"type": "resync", "reason": "restart"}
    )
    assert connection.subscriptions == {}
    assert not manager._subscriptions
    assert not manager._history
    assert not manager._unsubscribers
    assert hass.bus.async_listen.call_count == 3
    assert hass.bus.async_listen_once.call_count == 0


@pytest.mark.asyncio
async def test_stop_event_removes_listener_and_cleans_subscriptions(
    hass: Any, caplog: pytest.LogCaptureFixture
) -> None:
    entry = _entry("entry-a")
    with patch.object(hass.config_entries, "async_entries", return_value=[entry]):
        manager = WorkspaceSocket(hass)
        connection = _connection()
        manager.subscribe(connection, "entry-a", 11)
        stop_listener_count = hass.bus.async_listeners().get(
            EVENT_HOMEASSISTANT_STOP, 0
        )
        await manager.async_start()
        assert (
            hass.bus.async_listeners()[EVENT_HOMEASSISTANT_STOP]
            == stop_listener_count + 1
        )

        hass.bus.async_fire(EVENT_HOMEASSISTANT_STOP)
        await hass.async_block_till_done()

        assert manager._closed
        assert connection.subscriptions == {}
        connection.send_event.assert_called_once_with(
            11, {"type": "resync", "reason": "restart"}
        )
        assert hass.bus.async_listeners().get(EVENT_HOMEASSISTANT_STOP, 0) == 0

        await manager.async_stop()

    assert "Unable to remove unknown job listener" not in caplog.text


@pytest.mark.asyncio
async def test_stop_removes_pending_snapshot_cursor_cleanup() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    _snapshot(manager, "entry-a", connection)
    await manager.async_start()

    await manager.async_stop()

    assert not manager._snapshots
    assert connection.subscriptions == {}


def test_idle_entry_unload_resyncs_once_and_unregisters_lifecycle_listener() -> None:
    entry = _LifecycleEntry("entry-a")
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    _snapshot(manager, "entry-a", connection)
    manager.subscribe(connection, "entry-a", 14)

    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)

    connection.send_event.assert_called_once_with(
        14, {"type": "resync", "reason": "entry_removed"}
    )
    assert connection.subscriptions == {}
    assert connection not in manager._snapshots
    assert manager._subscriptions == {}
    assert manager._history == {}
    assert manager._coherence_generation["entry-a"] == 2

    entry.run_unload_callbacks()
    entry.set_state(ConfigEntryState.NOT_LOADED)
    assert not entry.state_callbacks
    assert "entry-a" not in manager._tracked_entries
    connection.send_event.assert_called_once()


def test_track_entry_is_idempotent_for_same_entry_object() -> None:
    entry = _LifecycleEntry("entry-a")
    manager = WorkspaceSocket(_Hass([entry]))

    manager.track_entry(entry)
    manager.track_entry(entry)

    assert len(entry.state_callbacks) == 1
    assert len(entry.unload_callbacks) == 1
    assert manager._tracked_entries["entry-a"].entry is entry


def test_track_entry_replaces_prior_object_for_same_entry_id() -> None:
    first = _LifecycleEntry("entry-a")
    replacement = _LifecycleEntry("entry-a")
    manager = WorkspaceSocket(_Hass([replacement]))

    manager.track_entry(first)
    manager.track_entry(replacement)

    assert not first.state_callbacks
    assert len(replacement.state_callbacks) == 1
    assert manager._tracked_entries["entry-a"].entry is replacement


@pytest.mark.asyncio
async def test_track_entry_after_socket_close_does_not_register_listener() -> None:
    entry = _LifecycleEntry("entry-a")
    manager = WorkspaceSocket(_Hass([entry]))
    await manager.async_stop()

    manager.track_entry(entry)

    assert not entry.state_callbacks
    assert not entry.unload_callbacks
    assert not manager._tracked_entries


@pytest.mark.asyncio
async def test_restart_unhooks_lifecycle_listener_without_duplicate_resync() -> None:
    entry = _LifecycleEntry("entry-a")
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 15)

    await manager.async_stop()

    connection.send_event.assert_called_once_with(
        15, {"type": "resync", "reason": "restart"}
    )
    assert not entry.state_callbacks
    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    connection.send_event.assert_called_once()
