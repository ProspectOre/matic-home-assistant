"""Focused protocol tests for the Map Studio workspace websocket."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import ConfigEntryAuthFailed, Unauthorized

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.workspace_socket import (
    QUEUE_LIMIT,
    SNAPSHOT_CURSOR_LIMIT,
    WorkspaceError,
    WorkspaceSocket,
    websocket_snapshot,
    websocket_subscribe,
)


class _Hass:
    def __init__(self, entries: list[object]) -> None:
        self.config_entries = SimpleNamespace(async_entries=lambda _domain: entries)
        self.data: dict[str, object] = {}
        self.bus = SimpleNamespace(
            async_listen=MagicMock(return_value=MagicMock()),
            async_listen_once=MagicMock(return_value=MagicMock()),
        )


def _entry(entry_id: str, *, loaded: bool = True) -> SimpleNamespace:
    coordinator = SimpleNamespace(
        last_update_success=True,
        data=SimpleNamespace(
            info=SimpleNamespace(serial_number="private-serial"),
            pose=SimpleNamespace(x=123.0, y=456.0),
        ),
    )
    return SimpleNamespace(
        entry_id=entry_id,
        state=ConfigEntryState.LOADED if loaded else ConfigEntryState.SETUP_RETRY,
        runtime_data=SimpleNamespace(coordinator=coordinator),
    )


class _LifecycleEntry(SimpleNamespace):
    def __init__(self, entry_id: str) -> None:
        super().__init__(
            entry_id=entry_id,
            state=ConfigEntryState.LOADED,
            runtime_data=SimpleNamespace(
                coordinator=SimpleNamespace(last_update_success=True)
            ),
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


class _Publisher:
    def __init__(self) -> None:
        self.listeners = set()

    def async_add_listener(self, listener: Any) -> Any:
        self.listeners.add(listener)

        def remove_listener() -> None:
            self.listeners.discard(listener)

        return remove_listener

    def publish(self) -> None:
        for listener in tuple(self.listeners):
            listener()


class _PlanPublisher(_Publisher):
    def __init__(self) -> None:
        super().__init__()
        self.plan_data = {"plan-a": {"name": "Morning"}}
        self.area_data: dict[str, dict[str, Any]] = {}

    def plans(self, _serial_number: str) -> Any:
        return {key: dict(value) for key, value in self.plan_data.items()}

    def areas(self, _serial_number: str) -> Any:
        return {key: dict(value) for key, value in self.area_data.items()}

    def async_add_listener(self, _serial_number: str, listener: Any) -> Any:
        return super().async_add_listener(listener)


class _ScenePublisher(_Publisher):
    def __init__(self) -> None:
        super().__init__()
        self.revision = 1
        self.current = True

    def floor_plan_is_current(self, floor_plan: Any) -> bool:
        return self.current and floor_plan is not None


class _CoordinatorPublisher(_Publisher):
    def __init__(self, data: Any) -> None:
        super().__init__()
        self.data = data
        self.last_update_success = True
        self.last_exception = None


class _HistoryPublisher(_Publisher):
    def __init__(self) -> None:
        super().__init__()
        self.snapshots: tuple[Any, ...] = ()

    def catalog(self) -> tuple[Any, ...]:
        return self.snapshots


def _connection(*, admin: bool = True) -> Any:
    class Connection:
        def __init__(self) -> None:
            self.subscriptions = {}
            self.send_event = MagicMock()
            self.send_result = MagicMock()

    connection = Connection()
    connection.user = SimpleNamespace(is_admin=admin)
    return connection


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
            "history": 0,
        },
        "payload": {"available": True, "entry": None},
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
    floor_plan = SimpleNamespace(mission_id=47)
    entry.runtime_data.coordinator.data.floor_plan = floor_plan
    entry.runtime_data.slam_map = SimpleNamespace(
        revision=12, floor_plan_is_current=MagicMock(return_value=True)
    )
    entry.runtime_data.slam_history = SimpleNamespace(
        catalog=lambda: (
            SimpleNamespace(revision=3),
            SimpleNamespace(revision=8),
        )
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


def test_snapshot_omits_invalid_projected_scene_revision() -> None:
    entry = _entry("entry-a")
    entry.runtime_data.coordinator.data.floor_plan = SimpleNamespace(mission_id=47)
    entry.runtime_data.slam_map = SimpleNamespace(
        revision=12, floor_plan_is_current=lambda _floor_plan: True
    )
    entry.runtime_data.cleaning_plans = object()
    entry.runtime_data.slam_history = SimpleNamespace(catalog=lambda: ())
    projection = {
        "map_floor_coherent": True,
        "map_session_verified": True,
        "map_revision": None,
    }

    with patch(
        "custom_components.matic_robot.slam_scene.catalog_entry_projection",
        return_value=projection,
    ):
        snapshot = WorkspaceSocket(_Hass([entry])).snapshot("entry-a")

    assert snapshot["identity"]["floor_verified"] is True
    assert snapshot["identity"]["floor_mission_id"] == 47
    assert "scene" not in snapshot["revisions"]


def test_snapshot_marks_stale_coordinator_data_without_reusing_floor_identity() -> None:
    entry = _entry("entry-a")
    entry.runtime_data.coordinator.last_update_success = False
    entry.runtime_data.coordinator.last_exception = RuntimeError("private detail")
    floor_plan = SimpleNamespace(mission_id=47)
    entry.runtime_data.coordinator.data.floor_plan = floor_plan
    is_current = MagicMock(return_value=True)
    entry.runtime_data.slam_map = SimpleNamespace(
        revision=12, floor_plan_is_current=is_current
    )
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


def test_snapshot_unknown_coordinator_and_authorization_status_are_typed() -> None:
    entry = _entry("entry-a")
    entry.runtime_data.coordinator.data = None
    entry.runtime_data.coordinator.last_exception = ConfigEntryAuthFailed(
        "auth required"
    )
    manager = WorkspaceSocket(_Hass([entry]))

    snapshot = manager.snapshot("entry-a")

    assert snapshot["payload"] == {"available": False, "entry": None}
    assert snapshot["status"] == {
        "state": "unavailable",
        "reason": "authorization",
        "retryable": False,
    }
    assert snapshot["identity"]["floor_mission_id"] is None
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


def test_snapshot_and_subscribe_replay_intervening_events_per_entry() -> None:
    hass = _Hass([_entry("entry-a"), _entry("entry-b")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    snapshot = manager.snapshot("entry-a", connection)
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
    manager.snapshot("entry-a", connection)
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
                    "history": 0,
                },
                "resources": ["activity"],
            },
        },
    )
    connection.subscriptions[(DOMAIN, "workspace", "entry-a")]()
    connection.send_event.reset_mock()
    _emit(manager, "entry-a")
    connection.send_event.assert_not_called()


def test_status_and_activity_events_do_not_advance_spatial_generation() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    manager.snapshot("entry-a", connection)
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
    coordinator = _CoordinatorPublisher(
        SimpleNamespace(
            info=SimpleNamespace(serial_number="private-serial"),
            operational=SimpleNamespace(cleaning=False),
        )
    )
    entry.runtime_data.coordinator = coordinator
    plans = _PlanPublisher()
    entry.runtime_data.cleaning_plans = plans
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
    entry.runtime_data.coordinator = _CoordinatorPublisher(
        SimpleNamespace(
            info=SimpleNamespace(serial_number="private-serial"),
            operational=SimpleNamespace(cleaning=False),
            floor_plan=SimpleNamespace(mission_id=47),
        )
    )
    scene = _ScenePublisher()
    history = _HistoryPublisher()
    entry.runtime_data.slam_map = scene
    entry.runtime_data.slam_history = history
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.snapshot("entry-a", connection)
    manager.subscribe(connection, "entry-a", 22)

    scene.revision = 2
    scene.publish()
    scene_event = connection.send_event.call_args.args[1]["invalidation"]
    assert scene_event["resources"] == ["scene"]
    assert scene_event["coherence_generation"] == 2
    assert scene_event["revisions"]["scene"] == 2

    scene.publish()
    assert connection.send_event.call_count == 1
    scene.revision = None
    scene.publish()
    assert (
        "scene"
        not in connection.send_event.call_args.args[1]["invalidation"]["revisions"]
    )

    history.snapshots = (SimpleNamespace(snapshot_id="snapshot-a", revision=5),)
    history.publish()
    history_event = connection.send_event.call_args.args[1]["invalidation"]
    assert history_event["resources"] == ["history"]
    assert history_event["revisions"]["history"] == 1
    assert history_event["sequence"] == 3
    assert history_event["coherence_generation"] == 3
    history.publish()
    assert connection.send_event.call_count == 3

    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    assert not scene.listeners
    assert not history.listeners
    assert not entry.runtime_data.coordinator.listeners


def test_coordinator_publishes_status_and_operational_changes_only() -> None:
    entry = _LifecycleEntry("entry-a")
    operational = SimpleNamespace(cleaning=False)
    coordinator = _CoordinatorPublisher(
        SimpleNamespace(
            info=SimpleNamespace(serial_number="private-serial"),
            operational=operational,
        )
    )
    entry.runtime_data.coordinator = coordinator
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.subscribe(connection, "entry-a", 23)

    coordinator.last_update_success = False
    coordinator.publish()
    status_event = connection.send_event.call_args.args[1]["invalidation"]
    assert status_event["resources"] == ["status"]
    assert status_event["coherence_generation"] == 1
    assert status_event["revisions"]["status"] == 1
    assert status_event["revisions"]["robot_state"] == 0

    coordinator.data = SimpleNamespace(
        info=SimpleNamespace(serial_number="private-serial"),
        operational=SimpleNamespace(cleaning=True),
    )
    coordinator.publish()
    state_event = connection.send_event.call_args.args[1]["invalidation"]
    assert state_event["resources"] == ["robot_state"]
    assert state_event["coherence_generation"] == 1
    assert state_event["revisions"]["robot_state"] == 1
    assert state_event["sequence"] == 2

    coordinator.publish()
    assert connection.send_event.call_count == 2

    callback = next(iter(coordinator.listeners))
    entry.set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    callback()
    assert connection.send_event.call_count == 3
    assert connection.send_event.call_args.args[1] == {
        "type": "resync",
        "reason": "entry_removed",
    }


@pytest.mark.asyncio
async def test_unavailable_sources_and_idempotent_cleanup_are_safe() -> None:
    entry = _LifecycleEntry("entry-a")
    manager = WorkspaceSocket(_Hass([entry]))
    manager._untrack_entry("missing")
    manager._async_coordinator_changed("entry-a")
    manager._async_scene_changed("entry-a")
    manager._async_history_changed("entry-a")
    manager._invalidate("entry-a", ["workspace"])

    coordinator = _CoordinatorPublisher(
        SimpleNamespace(
            info=SimpleNamespace(serial_number="private-serial"),
            operational=SimpleNamespace(cleaning=False),
        )
    )
    entry.runtime_data.coordinator = coordinator
    plans = _PlanPublisher()
    entry.runtime_data.cleaning_plans = plans
    no_catalog = _Publisher()
    entry.runtime_data.slam_history = no_catalog
    manager.track_entry(entry)
    plan_listener = next(iter(plans.listeners))
    coordinator_listener = next(iter(coordinator.listeners))
    history_listener = next(iter(no_catalog.listeners))
    entry.runtime_data.cleaning_plans = None
    plan_listener()
    assert manager._sequence.get("entry-a", 0) == 1

    assert WorkspaceSocket._history_state(no_catalog) == ()
    history_listener()
    assert manager._sequence.get("entry-a", 0) == 1
    entry.runtime_data.coordinator = None
    coordinator_listener()
    assert manager._sequence.get("entry-a", 0) == 1
    entry.runtime_data.slam_history = None
    history_listener()
    assert manager._sequence.get("entry-a", 0) == 1

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
    manager.snapshot("entry-a", connection)
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
            {"id": 9, "entry_id": "entry-a", "version": 1},
        )

    connection = _connection()
    connection.user = None
    with pytest.raises(Unauthorized):
        websocket_subscribe(
            hass,
            connection,
            {"id": 10, "entry_id": "entry-a", "version": 1},
        )


def test_websocket_subscribe_returns_handshake_and_replays_snapshot_gap() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    hass.data[DOMAIN] = {"workspace_socket": manager}
    connection = _connection()

    manager.snapshot("entry-a", connection)
    _emit(manager, "entry-a")
    websocket_subscribe(
        hass,
        connection,
        {"id": 12, "entry_id": "entry-a", "version": 1},
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
                    "history": 0,
                },
                "resources": ["activity"],
            },
        },
    )


def test_malformed_and_closed_events_are_ignored() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    for event in (SimpleNamespace(data=None), SimpleNamespace(data={}), None):
        manager._async_event(event)
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
    manager.snapshot("entry-a", connection)
    manager.snapshot("entry-a", idle_connection)
    manager.subscribe(connection, "entry-a", 13)
    # An already-active stream buffers updates during reads, so only idle
    # snapshots need retained replay cursors.
    manager.snapshot("entry-a", connection)
    assert connection not in manager._snapshots
    assert idle_connection in manager._snapshots

    hass.config_entries.async_entries = lambda _domain: []
    _emit(manager, "entry-a")

    assert connection not in manager._snapshots
    assert connection.subscriptions == {}
    assert manager._subscriptions == {}
    assert idle_connection not in manager._snapshots


def test_unsubscribe_clears_pending_snapshot_cursor() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    manager.snapshot("entry-a", connection)

    manager.unsubscribe(connection, "entry-a")

    assert connection not in manager._snapshots
    assert manager._subscriptions == {}


def test_connection_close_clears_abandoned_snapshot_cursor() -> None:
    manager = WorkspaceSocket(_Hass([_entry("entry-a")]))
    connection = _connection()
    manager.snapshot("entry-a", connection)
    close_cleanup = connection.subscriptions[(DOMAIN, "workspace_snapshot", "entry-a")]

    for unsubscribe in tuple(connection.subscriptions.values()):
        unsubscribe()
    close_cleanup()
    connection.subscriptions.clear()

    assert connection not in manager._snapshots
    assert connection.subscriptions == {}


def test_pending_snapshot_cursors_are_bounded_per_connection() -> None:
    entries = [_entry(f"entry-{index}") for index in range(SNAPSHOT_CURSOR_LIMIT + 1)]
    manager = WorkspaceSocket(_Hass(entries))
    connection = _connection()

    for entry in entries[:SNAPSHOT_CURSOR_LIMIT]:
        manager.snapshot(entry.entry_id, connection)
    manager.snapshot(entries[0].entry_id, connection)
    with pytest.raises(WorkspaceError, match="Too many pending workspace snapshots"):
        manager.snapshot(entries[-1].entry_id, connection)

    assert len(manager._snapshots[connection]) == SNAPSHOT_CURSOR_LIMIT
    assert len(connection.subscriptions) == SNAPSHOT_CURSOR_LIMIT


@pytest.mark.asyncio
async def test_start_and_stop_are_idempotent_and_stop_callback_closes_manager() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)

    await manager.async_start()
    await manager.async_start()
    assert hass.bus.async_listen.call_count == 2
    assert hass.bus.async_listen_once.call_count == 1

    stop_callback = hass.bus.async_listen_once.call_args.args[1]
    await stop_callback(None)
    await manager.async_stop()

    assert manager._closed
    assert not manager._unsubscribers
    assert hass.bus.async_listen.call_count == 2


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
    manager.snapshot("entry-a", connection)
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
    assert hass.bus.async_listen.call_count == 2
    assert hass.bus.async_listen_once.call_count == 1


@pytest.mark.asyncio
async def test_stop_removes_pending_snapshot_cursor_cleanup() -> None:
    hass = _Hass([_entry("entry-a")])
    manager = WorkspaceSocket(hass)
    connection = _connection()
    manager.snapshot("entry-a", connection)
    await manager.async_start()

    await manager.async_stop()

    assert not manager._snapshots
    assert connection.subscriptions == {}


def test_idle_entry_unload_resyncs_once_and_unregisters_lifecycle_listener() -> None:
    entry = _LifecycleEntry("entry-a")
    manager = WorkspaceSocket(_Hass([entry]))
    connection = _connection()
    manager.track_entry(entry)
    manager.snapshot("entry-a", connection)
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
