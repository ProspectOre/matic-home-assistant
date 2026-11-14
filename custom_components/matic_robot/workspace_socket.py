"""Authenticated, bounded workspace snapshots and invalidations for Map Studio."""

from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, cast
from uuid import uuid4

import probatio
from homeassistant.components import websocket_api
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.components.websocket_api.decorators import websocket_command
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, Unauthorized

from .client import AuthenticationRequiredError
from .const import DOMAIN, EVENT_ACTIVITY_OBSERVED, EVENT_CLEANING_FINISHED
from .slam_scene import _scene_snapshot_key
from .slam_view_data import catalog_entry_projection, pose_projection
from .workspace_schema import (
    InvalidateEvent,
    RecoveryReason,
    ResyncEvent,
    WorkspaceEvent,
    WorkspaceIdentity,
    WorkspaceSnapshot,
    WorkspaceSnapshotRequest,
    WorkspaceStatus,
    WorkspaceSubscribed,
    WorkspaceSubscribeRequest,
)

if TYPE_CHECKING:
    from . import MaticConfigEntry, MaticRuntimeData
    from .client import RobotOperationalState
    from .session import RobotSession
    from .slam_history import SlamHistoryStore
    from .slam_scene import MaticSlamSceneView

DATA_WORKSPACE_SOCKET = "workspace_socket"
PROTOCOL_VERSION = 1
COMMAND_SNAPSHOT = f"{DOMAIN}/workspace_snapshot"
COMMAND_SUBSCRIBE = f"{DOMAIN}/workspace_subscribe"
QUEUE_LIMIT = 32
SNAPSHOT_CURSOR_LIMIT = 32
MAX_RESOURCE_REVISION = 2**53 - 1
CAPABILITIES = {
    "snapshot": 1,
    "subscription": 1,
    "rest_catalog": 1,
    "catalog_projection": 1,
}


def _resync_event(reason: RecoveryReason) -> ResyncEvent:
    """Build a transport recovery request with a typed reason."""
    return {"type": "resync", "reason": reason}


def _auth_failed(session: RobotSession) -> bool:
    """Return whether the robot refused the entry's credential."""
    return isinstance(session.error.value, AuthenticationRequiredError)


def _recovery_reason(session: RobotSession) -> RecoveryReason:
    """Map why the robot is away to a bounded reason without exposing details."""
    return "authorization" if _auth_failed(session) else "snapshot_required"


def _next_resource_revision(current: int) -> int:
    """Advance a JSON-safe, bounded resource revision."""
    return min(MAX_RESOURCE_REVISION, max(0, current) + 1)


class WorkspaceError(HomeAssistantError):
    """Workspace request cannot be served safely."""


@dataclass(slots=True)
class _EntryListeners:
    """Lifecycle and publisher subscriptions owned for one loaded entry."""

    entry: MaticConfigEntry
    state_unsubscribe: CALLBACK_TYPE
    source_unsubscribers: list[CALLBACK_TYPE] = field(default_factory=list)
    source_state: dict[str, Any] = field(default_factory=dict)
    sources_closed: bool = False


@dataclass(frozen=True, slots=True)
class _SnapshotCursor:
    """Replay position owned by one HA WebSocket request id."""

    sequence: int
    request_id: int


class WorkspaceSocket:
    """Own workspace cursors and per-entry invalidation history."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._epoch = str(uuid4())
        self._sequence: dict[str, int] = {}
        self._coherence_generation: dict[str, int] = {}
        self._removed_entries: set[str] = set()
        self._history: dict[str, deque[InvalidateEvent]] = {}
        self._resource_revisions: dict[str, dict[str, int]] = {}
        self._subscriptions: dict[str, dict[ActiveConnection, int]] = {}
        # Subscriptions that asked for pose events. An older panel did not, and
        # treats an event it does not know as a broken stream.
        self._pose_subscribers: dict[str, set[ActiveConnection]] = {}
        self._snapshots: dict[ActiveConnection, dict[str, _SnapshotCursor]] = {}
        self._unsubscribers: list[Any] = []
        self._tracked_entries: dict[str, _EntryListeners] = {}
        self._closed = False

    async def async_start(self) -> None:
        """Subscribe to workspace invalidations."""
        if self._unsubscribers or self._closed:
            return
        for event_type in (EVENT_ACTIVITY_OBSERVED, EVENT_CLEANING_FINISHED):
            self._unsubscribers.append(
                self.hass.bus.async_listen(event_type, self._async_event)
            )
        self._unsubscribers.append(
            self.hass.bus.async_listen(EVENT_HOMEASSISTANT_STOP, self._async_stop)
        )

    async def _async_stop(self, _event: Any) -> None:
        await self.async_stop()

    async def async_stop(self) -> None:
        """Release event listeners and connection state."""
        if self._closed:
            return
        self._closed = True
        for entry_id, entry_subscriptions in tuple(self._subscriptions.items()):
            for connection, msg_id in tuple(entry_subscriptions.items()):
                self._send_subscription_event(
                    entry_id, connection, msg_id, _resync_event("restart")
                )
                connection.subscriptions.pop(msg_id, None)
        for connection, cursors in tuple(self._snapshots.items()):
            for entry_id in tuple(cursors):
                self._drop_snapshot_cursor(connection, entry_id)
        for unsubscribe in self._unsubscribers:
            unsubscribe()
        self._unsubscribers.clear()
        for entry_id in tuple(self._tracked_entries):
            self._untrack_entry(entry_id)
        self._subscriptions.clear()
        self._pose_subscribers.clear()
        self._snapshots.clear()
        self._history.clear()
        self._resource_revisions.clear()
        self._coherence_generation.clear()
        self._removed_entries.clear()

    @callback
    def _async_event(self, event: Event) -> None:
        """Record an entry-local invalidation and deliver it to its listeners."""
        data = event.data
        entry_id = data.get("entry_id")
        if self._closed or not isinstance(entry_id, str):
            return
        try:
            self._entry(entry_id)
        except WorkspaceError:
            self._remove_entry(entry_id)
            return

        kind = data.get("kind")
        resources = ["status"] if kind == "state" else ["activity"]
        self._invalidate(entry_id, resources)

    def _clear_entry(self, entry_id: str) -> None:
        """Drop cached cursors and subscriptions when an entry unloads."""
        if entry_id not in self._removed_entries:
            self._coherence_generation[entry_id] = (
                self._coherence_generation.get(entry_id, 1) + 1
            )
            self._removed_entries.add(entry_id)
        # Keep the sequence monotonic for this entry id during the server
        # epoch. A later reload must not look like stale traffic to clients.
        self._history.pop(entry_id, None)
        self._resource_revisions.pop(entry_id, None)
        for connection, cursors in tuple(self._snapshots.items()):
            cursor = cursors.pop(entry_id, None)
            if cursor is not None:
                connection.subscriptions.pop(cursor.request_id, None)
            if not cursors:
                self._snapshots.pop(connection, None)
        for connection, msg_id in tuple(self._subscriptions.pop(entry_id, {}).items()):
            connection.subscriptions.pop(msg_id, None)
        self._pose_subscribers.pop(entry_id, None)

    def _remove_entry(self, entry_id: str) -> None:
        """Notify listeners once, then discard state for an unloaded entry."""
        if entry_id not in self._removed_entries:
            for connection, msg_id in tuple(
                self._subscriptions.get(entry_id, {}).items()
            ):
                self._send_subscription_event(
                    entry_id,
                    connection,
                    msg_id,
                    _resync_event("entry_removed"),
                )
        self._close_entry_sources(entry_id)
        self._clear_entry(entry_id)

    def track_entry(self, entry: MaticConfigEntry) -> None:
        """Release entry-local subscriptions as soon as HA starts unloading it.

        ConfigEntry.async_on_state_change runs synchronously when HA changes
        the entry to UNLOAD_IN_PROGRESS. The entry's async_on_unload callback
        removes that listener after it has had a chance to notify subscribers.
        """
        entry_id = entry.entry_id
        if self._closed:
            return
        tracked = self._tracked_entries.get(entry_id)
        if tracked is not None and tracked.entry is entry:
            return
        if tracked is not None:
            self._untrack_entry(entry_id)
        self._removed_entries.discard(entry_id)

        @callback
        def _async_entry_state_changed() -> None:
            if entry.state is not ConfigEntryState.LOADED:
                self._remove_entry(entry_id)

        unsubscribe = entry.async_on_state_change(_async_entry_state_changed)
        tracked = _EntryListeners(entry, unsubscribe)
        self._tracked_entries[entry_id] = tracked
        self._resource_revisions[entry_id] = {}
        self._attach_entry_sources(entry_id, tracked)

        def _untrack_entry() -> None:
            current = self._tracked_entries.get(entry_id)
            if current is tracked:
                self._untrack_entry(entry_id)

        entry.async_on_unload(_untrack_entry)

    def _attach_entry_sources(self, entry_id: str, tracked: _EntryListeners) -> None:
        """Subscribe to the entry's authoritative local resource publishers."""
        runtime = tracked.entry.runtime_data
        session = runtime.session
        serial_number = session.info.serial_number
        plans = runtime.cleaning_plans
        tracked.source_state["session"] = self._session_state(session)
        tracked.source_state["zones"] = session.telemetry.value.zones
        tracked.source_state["plans"] = plans.catalog.plans(serial_number)
        tracked.source_state["areas"] = plans.catalog.areas(serial_number)
        tracked.source_state["scene"] = _scene_snapshot_key(runtime)
        tracked.source_state["scene_boundary"] = self._scene_boundary_state(runtime)
        tracked.source_state["history"] = self._history_state(runtime.slam_history)
        tracked.source_unsubscribers.extend(
            store.subscribe(lambda: self._async_session_changed(entry_id))
            for store in (
                session.error,
                session.state,
                session.floor,
                session.telemetry,
            )
        )
        tracked.source_unsubscribers.extend(
            (
                session.poses.subscribe(lambda: self._async_pose_changed(entry_id)),
                plans.repository.async_add_listener(
                    serial_number, lambda: self._async_plan_store_changed(entry_id)
                ),
                runtime.slam_map.async_add_listener(
                    lambda: self._async_scene_changed(entry_id)
                ),
                runtime.slam_history.async_add_listener(
                    lambda: self._async_history_changed(entry_id)
                ),
            )
        )
        revisions = self._resource_revisions.setdefault(entry_id, {})
        revisions.update(
            {
                "status": 0,
                "robot_state": 0,
                "plans": 0,
                "areas": 0,
                "plan_state": 0,
                "scene": self._scene_revision(entry_id, runtime),
            }
        )
        revisions.setdefault("history", 0)

    def _close_entry_sources(self, entry_id: str) -> None:
        """Stop runtime publishers immediately when entry unloading begins."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None or tracked.sources_closed:
            return
        tracked.sources_closed = True
        for unsubscribe in tracked.source_unsubscribers:
            unsubscribe()
        tracked.source_unsubscribers.clear()

    def _untrack_entry(self, entry_id: str) -> None:
        """Remove every listener owned by one entry."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None:
            return
        self._close_entry_sources(entry_id)
        self._tracked_entries.pop(entry_id, None)
        tracked.state_unsubscribe()

    def _async_plan_store_changed(self, entry_id: str) -> None:
        """Invalidate saved plan state and only changed public plan/Area views."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None or tracked.sources_closed:
            return
        runtime = tracked.entry.runtime_data
        serial_number = runtime.session.info.serial_number
        plans = runtime.cleaning_plans
        current_plans = plans.catalog.plans(serial_number)
        current_areas = plans.catalog.areas(serial_number)
        resources = ["plan_state"]
        revisions = self._resource_revisions.setdefault(entry_id, {})
        if current_plans != tracked.source_state.get("plans"):
            tracked.source_state["plans"] = current_plans
            revisions["plans"] = _next_resource_revision(revisions.get("plans", 0))
            resources.append("plans")
        if current_areas != tracked.source_state.get("areas"):
            tracked.source_state["areas"] = current_areas
            revisions["areas"] = _next_resource_revision(revisions.get("areas", 0))
            resources.append("areas")
        self._invalidate(entry_id, resources, bump_resources=["plan_state"])

    def _async_session_changed(self, entry_id: str) -> None:
        """Publish only status or operational state changes from the session."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None or tracked.sources_closed:
            return
        session = tracked.entry.runtime_data.session
        current = self._session_state(session)
        previous = tracked.source_state.get("session")
        tracked.source_state["session"] = current
        resources: list[str] = []
        if previous is None or current[0] != previous[0]:
            resources.append("status")
        if previous is None or current[1] != previous[1]:
            resources.append("robot_state")
        # Robot zones ride the areas view; a zone drawn in the Matic app
        # reaches an open map through this revision.
        zones = session.telemetry.value.zones
        if zones != tracked.source_state.get("zones"):
            resources.append("areas")
        tracked.source_state["zones"] = zones
        if resources:
            self._invalidate(entry_id, resources)
        self._async_scene_changed(entry_id)

    def _async_scene_changed(self, entry_id: str) -> None:
        """Publish content revisions and verified spatial-boundary changes."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None or tracked.sources_closed:
            return
        runtime = tracked.entry.runtime_data
        current = _scene_snapshot_key(runtime)
        current_boundary = self._scene_boundary_state(runtime)
        previous = tracked.source_state.get("scene")
        previous_boundary = tracked.source_state.get("scene_boundary")
        if previous == current and previous_boundary == current_boundary:
            return
        tracked.source_state["scene"] = current
        tracked.source_state["scene_boundary"] = current_boundary
        self._resource_revisions.setdefault(entry_id, {})["scene"] = (
            self._scene_revision(entry_id, runtime)
        )
        self._invalidate(
            entry_id,
            ["scene"],
            bump_resources=[],
            bump_coherence=previous_boundary != current_boundary,
        )
        # The pose's projection depends on the floor plan and map verification,
        # so a docked robot that sends nothing new still needs it republished.
        if previous_boundary != current_boundary:
            self._async_pose_changed(entry_id)

    def _async_pose_changed(self, entry_id: str) -> None:
        """Send the robot's new position to each subscription that asked for it."""
        for connection in tuple(self._pose_subscribers.get(entry_id, ())):
            self.send_pose(connection, entry_id)

    def send_pose(self, connection: ActiveConnection, entry_id: str) -> None:
        """Send one subscription the robot's position, if it asked for poses."""
        tracked = self._tracked_entries.get(entry_id)
        msg_id = self._subscriptions.get(entry_id, {}).get(connection)
        if (
            self._closed
            or tracked is None
            or tracked.sources_closed
            or msg_id is None
            or connection not in self._pose_subscribers.get(entry_id, ())
        ):
            return
        pose = pose_projection(entry_id, tracked.entry.runtime_data, self._scene_view())
        self._send_subscription_event(
            entry_id, connection, msg_id, {"type": "pose", "pose": pose}
        )

    def _async_history_changed(self, entry_id: str) -> None:
        """Publish history only after the private history catalog changes."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None or tracked.sources_closed:
            return
        current = self._history_state(tracked.entry.runtime_data.slam_history)
        if tracked.source_state.get("history") == current:
            return
        tracked.source_state["history"] = current
        revisions = self._resource_revisions.setdefault(entry_id, {})
        revisions["history"] = _next_resource_revision(revisions.get("history", 0))
        self._invalidate(entry_id, ["history"], bump_resources=[])

    def _invalidate(
        self,
        entry_id: str,
        resources: list[str],
        *,
        bump_resources: list[str] | None = None,
        bump_coherence: bool = False,
    ) -> None:
        """Advance bounded revisions and optionally fence spatial coherence."""
        if self._closed or not resources:
            return
        self._removed_entries.discard(entry_id)
        resource_revisions = self._resource_revisions.setdefault(entry_id, {})
        for resource in resources if bump_resources is None else bump_resources:
            resource_revisions[resource] = _next_resource_revision(
                resource_revisions.get(resource, 0)
            )
        generation = self._coherence_generation.setdefault(entry_id, 1)
        if bump_coherence:
            generation += 1
            self._coherence_generation[entry_id] = generation
        sequence = self._sequence.get(entry_id, 0) + 1
        self._sequence[entry_id] = sequence
        revisions = {"workspace": sequence, **resource_revisions}
        message: InvalidateEvent = {
            "type": "invalidate",
            "invalidation": {
                "epoch": self._epoch,
                "sequence": sequence,
                "coherence_generation": generation,
                "revisions": revisions,
                "resources": sorted(set(resources)),
            },
        }
        self._history.setdefault(entry_id, deque(maxlen=QUEUE_LIMIT)).append(message)
        for connection, msg_id in tuple(self._subscriptions.get(entry_id, {}).items()):
            self._send_subscription_event(entry_id, connection, msg_id, message)

    def _send_subscription_event(
        self,
        entry_id: str,
        connection: ActiveConnection,
        msg_id: int,
        event: WorkspaceEvent,
    ) -> None:
        """Recheck administrator authority before delivering a workspace event."""
        if connection.user is None or not connection.user.is_admin:
            self._remove_subscription(connection, entry_id, unregister=True)
            return
        connection.send_event(msg_id, event)

    @staticmethod
    def _session_state(session: RobotSession) -> tuple[bool, RobotOperationalState]:
        """Return reachability and operational state for change detection."""
        return session.error.value is None, session.state.value.operational

    @staticmethod
    def _scene_boundary_state(runtime: MaticRuntimeData) -> tuple[object, ...]:
        """Return private authorities that require spatial revalidation."""
        session = runtime.session
        floor_plan = session.floor.value
        slam_map = runtime.slam_map
        return (
            session.info.serial_number,
            slam_map.mission_identity,
            floor_plan,
            slam_map.live_session_verified,
            slam_map.floor_plan_is_current(floor_plan),
        )

    def _scene_revision(self, entry_id: str, runtime: MaticRuntimeData) -> int:
        """Project the scene view's transport revision, or the map's without it.

        The scene view is absent when Home Assistant serves no frontend.
        """
        scene_view = self._scene_view()
        raw_revision = (
            scene_view.current_revision(entry_id, runtime)
            if scene_view is not None
            else runtime.slam_map.revision
        )
        return min(MAX_RESOURCE_REVISION, max(0, raw_revision))

    def _scene_view(self) -> MaticSlamSceneView | None:
        from .frontend import DATA_SLAM_SCENE_VIEW

        return cast(
            "MaticSlamSceneView | None", self.hass.data.get(DATA_SLAM_SCENE_VIEW)
        )

    @staticmethod
    def _history_state(history: SlamHistoryStore) -> tuple[object, ...]:
        """Return bounded catalog identity without retaining scene payloads."""
        records = tuple(
            (
                snapshot.snapshot_id,
                snapshot.revision,
                snapshot.mission_token,
                snapshot.created_at.isoformat(),
                snapshot.point_count,
                snapshot.record_id,
                snapshot.name,
                snapshot.retention,
                (
                    snapshot.deleted_until.isoformat()
                    if snapshot.deleted_until is not None
                    else None
                ),
                snapshot.imported,
                snapshot.comparison_group,
                json.dumps(snapshot.frame, sort_keys=True, separators=(",", ":")),
            )
            for snapshot in history.catalog()
        )
        return (
            history.generation,
            history.capture_paused,
            history.capacity_blocked,
            records,
        )

    def _entry(self, entry_id: str) -> MaticConfigEntry:
        """Return only a currently loaded integration entry."""
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            if entry.entry_id == entry_id and entry.state is ConfigEntryState.LOADED:
                return cast("MaticConfigEntry", entry)
        raise WorkspaceError("Matic entry is unavailable")

    def snapshot(
        self,
        entry_id: str,
        request: tuple[ActiveConnection, int] | None = None,
    ) -> WorkspaceSnapshot:
        """Return a versioned, minimized projection and remember its cursor."""
        entry = self._entry(entry_id)
        sequence = self._sequence.get(entry_id, 0)
        generation = self._coherence_generation.setdefault(entry_id, 1)
        self._removed_entries.discard(entry_id)
        runtime = entry.runtime_data
        session = runtime.session
        available = session.error.value is None
        # Use the exact field owner and serializer shared with the REST
        # catalog; WebSocket projection cannot invent map or run state.
        entry_projection = (
            catalog_entry_projection(entry_id, runtime, self._scene_view())
            if available
            else None
        )
        status: WorkspaceStatus
        if available:
            status = {"state": "ready", "reason": None, "retryable": False}
        else:
            status = {
                "state": "stale",
                "reason": _recovery_reason(session),
                "retryable": not _auth_failed(session),
            }

        identity: WorkspaceIdentity = {
            "entry_id": entry_id,
            "floor_mission_id": None,
            "floor_verified": False,
        }
        revisions = {
            "workspace": sequence,
            **self._resource_revisions.get(entry_id, {}),
        }
        resource_revisions = self._resource_revisions.setdefault(entry_id, {})
        # Give the first snapshot a complete, bounded revision projection so
        # the client can establish one baseline before subscribing. Large
        # scene/history payloads remain on their authenticated REST routes.
        for name in (
            "status",
            "robot_state",
            "activity",
            "plans",
            "areas",
            "plan_state",
        ):
            resource_revisions.setdefault(name, 0)
        if available:
            resource_revisions.setdefault("scene", 0)
        if "history" not in resource_revisions:
            history_revisions = [
                snapshot.revision
                for snapshot in runtime.slam_history.catalog()
                if snapshot.revision >= 0
            ]
            resource_revisions["history"] = min(
                MAX_RESOURCE_REVISION, max(history_revisions, default=0)
            )
        revisions = {"workspace": sequence, **resource_revisions}
        if entry_projection is not None:
            floor_plan = session.floor.value
            if (
                floor_plan is not None
                and entry_projection["map_floor_coherent"]
                and entry_projection["map_session_verified"]
            ):
                identity["floor_mission_id"] = floor_plan.mission_id
                identity["floor_verified"] = True
            # The payload may be an older cached encoding while a newer scene
            # revision is being built. Keep its usable revision in the
            # payload, but use the same current-revision authority as scene
            # invalidations for the transport fence.
            resource_revisions["scene"] = max(
                resource_revisions.get("scene", 0),
                self._scene_revision(entry_id, runtime),
            )
            revisions["scene"] = resource_revisions["scene"]
        else:
            revisions.pop("scene", None)

        result: WorkspaceSnapshot = {
            "schema": PROTOCOL_VERSION,
            "capabilities": dict(CAPABILITIES),
            "epoch": self._epoch,
            "sequence": sequence,
            "coherence_generation": generation,
            "entry_id": entry_id,
            "identity": identity,
            "status": status,
            "revisions": revisions,
            # Deliberately omit the session's stores: they hold robot identity,
            # raw operational fields, maps, pose and telemetry not needed here.
            "payload": {"available": available, "entry": entry_projection},
        }
        if request is not None:
            connection, request_id = request
            if connection in self._subscriptions.get(entry_id, {}):
                return result
            # A live subscriber already receives and buffers every event while
            # this read is in flight. Only an unsubscribed startup snapshot
            # needs a replay cursor for the following subscribe handshake.
            cursors = self._snapshots.setdefault(connection, {})
            if entry_id not in cursors and len(cursors) >= SNAPSHOT_CURSOR_LIMIT:
                raise WorkspaceError("Too many pending workspace snapshots")
            old_cursor = cursors.get(entry_id)
            if old_cursor is not None and old_cursor.request_id != request_id:
                connection.subscriptions.pop(old_cursor.request_id, None)
            cursor = _SnapshotCursor(sequence, request_id)
            cursors[entry_id] = cursor
            connection.subscriptions[request_id] = lambda: (
                self._release_snapshot_cursor(connection, entry_id, request_id)
            )
        return result

    @callback
    def subscribe(
        self,
        connection: ActiveConnection,
        entry_id: str,
        msg_id: int,
        *,
        poses: bool = False,
    ) -> list[WorkspaceEvent]:
        """Subscribe and replay every invalidation since this connection's snapshot."""
        self._entry(entry_id)
        self._remove_subscription(connection, entry_id, unregister=True)
        if poses:
            self._pose_subscribers.setdefault(entry_id, set()).add(connection)
        cursor_record = self._snapshots.get(connection, {}).get(entry_id)
        cursor = (
            cursor_record.sequence
            if cursor_record is not None
            else self._sequence.get(entry_id, 0)
        )
        if cursor_record is not None:
            self._drop_snapshot_cursor(connection, entry_id)

        self._subscriptions.setdefault(entry_id, {})[connection] = msg_id
        connection.subscriptions[msg_id] = lambda: self._release_subscription(
            connection, entry_id, msg_id
        )

        history = self._history.get(entry_id, ())
        first_sequence = history[0]["invalidation"]["sequence"] if history else None
        if first_sequence is not None and cursor < first_sequence - 1:
            return [_resync_event("overflow")]
        return [
            message
            for message in history
            if message["invalidation"]["sequence"] > cursor
        ]

    @callback
    def _release_subscription(
        self, connection: ActiveConnection, entry_id: str, msg_id: int
    ) -> None:
        """Release HA-owned subscription state without mutating its callback map."""
        if self._subscriptions.get(entry_id, {}).get(connection) != msg_id:
            return
        self._remove_subscription(connection, entry_id)

    def _release_snapshot_cursor(
        self, connection: ActiveConnection, entry_id: str, request_id: int
    ) -> None:
        """Forget a snapshot cursor when its WebSocket connection closes."""
        cursor = self._snapshots.get(connection, {}).get(entry_id)
        if cursor is None or cursor.request_id != request_id:
            return
        self._forget_snapshot_cursor(connection, entry_id)

    def _drop_snapshot_cursor(
        self, connection: ActiveConnection, entry_id: str
    ) -> None:
        cursor = self._snapshots[connection][entry_id]
        connection.subscriptions.pop(cursor.request_id, None)
        self._forget_snapshot_cursor(connection, entry_id)

    def _forget_snapshot_cursor(
        self, connection: ActiveConnection, entry_id: str
    ) -> None:
        cursors = self._snapshots.get(connection)
        if cursors is not None:
            cursors.pop(entry_id, None)
            if not cursors:
                self._snapshots.pop(connection, None)

    def _remove_subscription(
        self,
        connection: ActiveConnection,
        entry_id: str,
        *,
        unregister: bool = False,
    ) -> None:
        """Remove a listener while preserving a pending snapshot cursor."""
        subscriptions = self._subscriptions.get(entry_id)
        msg_id = subscriptions.get(connection) if subscriptions is not None else None
        if subscriptions is not None:
            subscriptions.pop(connection, None)
            if not subscriptions:
                self._subscriptions.pop(entry_id, None)
        self._pose_subscribers.get(entry_id, set()).discard(connection)
        if unregister and msg_id is not None:
            connection.subscriptions.pop(msg_id, None)


def _require_admin(connection: ActiveConnection) -> None:
    """Require administrator authorization for every workspace request."""
    if not connection.user or not connection.user.is_admin:
        raise Unauthorized


@websocket_command(
    {
        probatio.Required("type"): COMMAND_SNAPSHOT,
        probatio.Required("version"): probatio.In([PROTOCOL_VERSION]),
        probatio.Required("entry_id"): str,
    }
)
@callback
def websocket_snapshot(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Serve a versioned snapshot to administrators."""
    _require_admin(connection)
    manager = workspace_socket(hass)
    request = cast(WorkspaceSnapshotRequest, msg)
    connection.send_result(
        msg["id"], manager.snapshot(request["entry_id"], (connection, msg["id"]))
    )


@websocket_command(
    {
        probatio.Required("type"): COMMAND_SUBSCRIBE,
        probatio.Required("version"): probatio.In([PROTOCOL_VERSION]),
        probatio.Required("entry_id"): str,
        probatio.Optional("poses", default=False): bool,
    }
)
@callback
def websocket_subscribe(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Install an administrator subscription and return its handshake cursor."""
    _require_admin(connection)
    manager = workspace_socket(hass)
    request = cast(WorkspaceSubscribeRequest, msg)
    entry_id = request["entry_id"]
    replay = manager.subscribe(
        connection, entry_id, msg["id"], poses=request.get("poses", False)
    )
    subscribed: WorkspaceSubscribed = {
        "version": PROTOCOL_VERSION,
        "epoch": manager._epoch,
        "sequence": manager._sequence.get(entry_id, 0),
        "queue_limit": QUEUE_LIMIT,
    }
    connection.send_result(msg["id"], subscribed)
    for event in replay:
        manager._send_subscription_event(entry_id, connection, msg["id"], event)
    manager.send_pose(connection, entry_id)


def workspace_socket(hass: HomeAssistant) -> WorkspaceSocket:
    """Return the socket ``async_setup`` registered before any entry loads."""
    return cast(WorkspaceSocket, hass.data[DOMAIN][DATA_WORKSPACE_SOCKET])


async def async_register(hass: HomeAssistant) -> WorkspaceSocket:
    """Register commands once and return the lifecycle owner."""
    existing = hass.data.setdefault(DOMAIN, {}).get(DATA_WORKSPACE_SOCKET)
    if existing is not None:
        return cast(WorkspaceSocket, existing)
    manager = WorkspaceSocket(hass)
    hass.data[DOMAIN][DATA_WORKSPACE_SOCKET] = manager
    websocket_api.async_register_command(hass, websocket_snapshot)
    websocket_api.async_register_command(hass, websocket_subscribe)
    await manager.async_start()
    return manager
