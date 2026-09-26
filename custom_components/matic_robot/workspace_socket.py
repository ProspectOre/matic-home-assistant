"""Authenticated, bounded workspace snapshots and invalidations for Map Studio."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Literal, cast
from uuid import uuid4

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.components.websocket_api.decorators import websocket_command
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import (
    ConfigEntryAuthFailed,
    HomeAssistantError,
    Unauthorized,
)

from .const import DOMAIN, EVENT_ACTIVITY_OBSERVED, EVENT_CLEANING_FINISHED

PROTOCOL_VERSION = 1
COMMAND_SNAPSHOT = f"{DOMAIN}/workspace_snapshot"
COMMAND_SUBSCRIBE = f"{DOMAIN}/workspace_subscribe"
QUEUE_LIMIT = 32
SNAPSHOT_CURSOR_LIMIT = 32
# Only scene identity/content changes invalidate spatial coherence. Operational
# status and activity have their own revisions and cannot force a map reload.
COHERENCE_RESOURCES = frozenset({"scene"})
MAX_RESOURCE_REVISION = 2**53 - 1
CAPABILITIES = {
    "snapshot": 1,
    "subscription": 1,
    "rest_catalog": 1,
    "catalog_projection": 1,
}
RecoveryReason = Literal[
    "gap",
    "overflow",
    "restart",
    "entry_removed",
    "authorization",
    "snapshot_required",
]


def _resync_event(reason: RecoveryReason) -> dict[str, str]:
    """Build a transport recovery request with a typed reason."""
    return {"type": "resync", "reason": reason}


def _coordinator_recovery_reason(coordinator: Any) -> RecoveryReason:
    """Map coordinator failure to a bounded reason without exposing details."""
    if isinstance(getattr(coordinator, "last_exception", None), ConfigEntryAuthFailed):
        return "authorization"
    return "snapshot_required"


def _next_resource_revision(current: int) -> int:
    """Advance a JSON-safe, bounded resource revision."""
    return min(MAX_RESOURCE_REVISION, max(0, current) + 1)


class WorkspaceError(HomeAssistantError):
    """Workspace request cannot be served safely."""


@dataclass(slots=True)
class _EntryListeners:
    """Lifecycle and publisher subscriptions owned for one loaded entry."""

    entry: Any
    state_unsubscribe: Any
    source_unsubscribers: list[Any] = field(default_factory=list)
    source_state: dict[str, Any] = field(default_factory=dict)
    sources_closed: bool = False


class WorkspaceSocket:
    """Own workspace cursors and per-entry invalidation history."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._epoch = str(uuid4())
        self._sequence: dict[str, int] = {}
        self._coherence_generation: dict[str, int] = {}
        self._removed_entries: set[str] = set()
        self._history: dict[str, deque[dict[str, Any]]] = {}
        self._resource_revisions: dict[str, dict[str, int]] = {}
        self._subscriptions: dict[str, dict[ActiveConnection, int]] = {}
        self._snapshots: dict[ActiveConnection, dict[str, int]] = {}
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
            self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, self._async_stop)
        )

    async def _async_stop(self, _event: Any) -> None:
        await self.async_stop()

    async def async_stop(self) -> None:
        """Release event listeners and connection state."""
        if self._closed:
            return
        self._closed = True
        for entry_id, entry_subscriptions in self._subscriptions.items():
            for connection, msg_id in tuple(entry_subscriptions.items()):
                connection.send_event(msg_id, _resync_event("restart"))
                connection.subscriptions.pop((DOMAIN, "workspace", entry_id), None)
        for connection, cursors in tuple(self._snapshots.items()):
            for entry_id in tuple(cursors):
                connection.subscriptions.pop(
                    (DOMAIN, "workspace_snapshot", entry_id), None
                )
        for unsubscribe in self._unsubscribers:
            unsubscribe()
        self._unsubscribers.clear()
        for entry_id in tuple(self._tracked_entries):
            self._untrack_entry(entry_id)
        self._subscriptions.clear()
        self._snapshots.clear()
        self._history.clear()
        self._resource_revisions.clear()
        self._coherence_generation.clear()
        self._removed_entries.clear()

    @callback
    def _async_event(self, event: Any) -> None:
        """Record an entry-local invalidation and deliver it to its listeners."""
        data = getattr(event, "data", None) or {}
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
            cursors.pop(entry_id, None)
            connection.subscriptions.pop((DOMAIN, "workspace_snapshot", entry_id), None)
            if not cursors:
                self._snapshots.pop(connection, None)
        for connection in tuple(self._subscriptions.pop(entry_id, {})):
            connection.subscriptions.pop((DOMAIN, "workspace", entry_id), None)

    def _remove_entry(self, entry_id: str) -> None:
        """Notify listeners once, then discard state for an unloaded entry."""
        if entry_id not in self._removed_entries:
            for connection, msg_id in tuple(
                self._subscriptions.get(entry_id, {}).items()
            ):
                connection.send_event(msg_id, _resync_event("entry_removed"))
        self._close_entry_sources(entry_id)
        self._clear_entry(entry_id)

    def track_entry(self, entry: Any) -> None:
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
        runtime = getattr(tracked.entry, "runtime_data", None)
        coordinator = getattr(runtime, "coordinator", None)
        if coordinator is not None:
            tracked.source_state["coordinator"] = self._coordinator_state(coordinator)
            revisions = self._resource_revisions.setdefault(entry_id, {})
            revisions.update({"status": 0, "robot_state": 0})
            add_listener = getattr(coordinator, "async_add_listener", None)
            if callable(add_listener):
                tracked.source_unsubscribers.append(
                    add_listener(lambda: self._async_coordinator_changed(entry_id))
                )

        serial_number = self._serial_number(coordinator)
        plans = getattr(runtime, "cleaning_plans", None)
        if plans is not None and isinstance(serial_number, str):
            tracked.source_state["plans"] = plans.plans(serial_number)
            tracked.source_state["areas"] = plans.areas(serial_number)
            add_listener = getattr(plans, "async_add_listener", None)
            if callable(add_listener):
                tracked.source_unsubscribers.append(
                    add_listener(
                        serial_number,
                        lambda: self._async_plan_store_changed(entry_id),
                    )
                )
            revisions = self._resource_revisions.setdefault(entry_id, {})
            revisions.update({"plans": 0, "areas": 0, "plan_state": 0})

        slam_map = getattr(runtime, "slam_map", None)
        if slam_map is not None:
            tracked.source_state["scene"] = self._scene_state(runtime)
            add_listener = getattr(slam_map, "async_add_listener", None)
            if callable(add_listener):
                tracked.source_unsubscribers.append(
                    add_listener(lambda: self._async_scene_changed(entry_id))
                )
            scene_revision = tracked.source_state["scene"][0]
            self._resource_revisions.setdefault(entry_id, {})["scene"] = (
                scene_revision if scene_revision is not None else 0
            )

        history = getattr(runtime, "slam_history", None)
        if history is not None:
            tracked.source_state["history"] = self._history_state(history)
            add_listener = getattr(history, "async_add_listener", None)
            if callable(add_listener):
                tracked.source_unsubscribers.append(
                    add_listener(lambda: self._async_history_changed(entry_id))
                )
            self._resource_revisions.setdefault(entry_id, {}).setdefault("history", 0)

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
        runtime = getattr(tracked.entry, "runtime_data", None)
        coordinator = getattr(runtime, "coordinator", None)
        serial_number = self._serial_number(coordinator)
        plans = getattr(runtime, "cleaning_plans", None)
        if plans is None or not isinstance(serial_number, str):
            return
        current_plans = plans.plans(serial_number)
        current_areas = plans.areas(serial_number)
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

    def _async_coordinator_changed(self, entry_id: str) -> None:
        """Publish only status or operational state changes from HA's coordinator."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None or tracked.sources_closed:
            return
        runtime = getattr(tracked.entry, "runtime_data", None)
        coordinator = getattr(runtime, "coordinator", None)
        if coordinator is None:
            return
        current = self._coordinator_state(coordinator)
        previous = tracked.source_state.get("coordinator")
        tracked.source_state["coordinator"] = current
        resources: list[str] = []
        if previous is None or current[0] != previous[0]:
            resources.append("status")
        if previous is None or current[1] != previous[1]:
            resources.append("robot_state")
        if resources:
            self._invalidate(entry_id, resources)
        self._async_scene_changed(entry_id)

    def _async_scene_changed(self, entry_id: str) -> None:
        """Publish scene content or verified floor-identity changes."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None or tracked.sources_closed:
            return
        if "scene" not in tracked.source_state:
            return
        runtime = getattr(tracked.entry, "runtime_data", None)
        current = self._scene_state(runtime)
        if tracked.source_state.get("scene") == current:
            return
        tracked.source_state["scene"] = current
        revision = current[0]
        resource_revisions = self._resource_revisions.setdefault(entry_id, {})
        if revision is not None:
            resource_revisions["scene"] = revision
        else:
            resource_revisions.pop("scene", None)
        self._invalidate(entry_id, ["scene"], bump_resources=[])

    def _async_history_changed(self, entry_id: str) -> None:
        """Publish history only after the private history catalog changes."""
        tracked = self._tracked_entries.get(entry_id)
        if tracked is None or tracked.sources_closed:
            return
        runtime = getattr(tracked.entry, "runtime_data", None)
        history = getattr(runtime, "slam_history", None)
        if history is None:
            return
        current = self._history_state(history)
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
    ) -> None:
        """Advance bounded per-entry revisions and fan out one invalidation."""
        if self._closed or not resources:
            return
        self._removed_entries.discard(entry_id)
        resource_revisions = self._resource_revisions.setdefault(entry_id, {})
        for resource in resources if bump_resources is None else bump_resources:
            resource_revisions[resource] = _next_resource_revision(
                resource_revisions.get(resource, 0)
            )
        generation = self._coherence_generation.setdefault(entry_id, 1)
        if COHERENCE_RESOURCES.intersection(resources):
            generation += 1
            self._coherence_generation[entry_id] = generation
        sequence = self._sequence.get(entry_id, 0) + 1
        self._sequence[entry_id] = sequence
        revisions = {"workspace": sequence, **resource_revisions}
        message = {
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
            connection.send_event(msg_id, message)

    @staticmethod
    def _serial_number(coordinator: Any) -> str | None:
        """Read robot identity internally without placing it on the wire."""
        data = getattr(coordinator, "data", None)
        info = getattr(data, "info", None)
        serial_number = getattr(info, "serial_number", None)
        return serial_number if isinstance(serial_number, str) else None

    @staticmethod
    def _coordinator_state(coordinator: Any) -> tuple[bool, Any]:
        """Return privacy-minimized coordinator identity for change detection."""
        data = getattr(coordinator, "data", None)
        operational = getattr(data, "operational", None)
        return getattr(coordinator, "last_update_success", False) is True, operational

    @staticmethod
    def _scene_state(runtime: Any) -> tuple[int | None, int | None]:
        """Return bounded scene revision and only a proven floor identity."""
        coordinator = getattr(runtime, "coordinator", None)
        slam_map = getattr(runtime, "slam_map", None)
        data = getattr(coordinator, "data", None)
        floor_plan = getattr(data, "floor_plan", None)
        raw_revision = getattr(slam_map, "revision", None)
        revision = (
            min(MAX_RESOURCE_REVISION, max(0, raw_revision))
            if isinstance(raw_revision, int) and not isinstance(raw_revision, bool)
            else None
        )
        mission_id = None
        is_current = getattr(slam_map, "floor_plan_is_current", None)
        if (
            getattr(coordinator, "last_update_success", False) is True
            and callable(is_current)
            and is_current(floor_plan)
        ):
            candidate = getattr(floor_plan, "mission_id", None)
            if isinstance(candidate, int) and not isinstance(candidate, bool):
                mission_id = candidate
        return (revision, mission_id)

    @staticmethod
    def _history_state(history: Any) -> tuple[tuple[str, int], ...]:
        """Return bounded catalog identity without retaining scene payloads."""
        catalog = getattr(history, "catalog", None)
        if not callable(catalog):
            return ()
        snapshots = catalog()
        return tuple(
            (snapshot.snapshot_id, snapshot.revision)
            for snapshot in snapshots
            if isinstance(getattr(snapshot, "snapshot_id", None), str)
            and isinstance(getattr(snapshot, "revision", None), int)
            and not isinstance(getattr(snapshot, "revision", None), bool)
        )

    def _entry(self, entry_id: str) -> Any:
        """Return only a currently loaded integration entry."""
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            if entry.entry_id == entry_id and entry.state is ConfigEntryState.LOADED:
                return entry
        raise WorkspaceError("Matic entry is unavailable")

    def snapshot(
        self, entry_id: str, connection: ActiveConnection | None = None
    ) -> dict[str, Any]:
        """Return a versioned, minimized projection and remember its cursor."""
        entry = self._entry(entry_id)
        sequence = self._sequence.get(entry_id, 0)
        generation = self._coherence_generation.setdefault(entry_id, 1)
        self._removed_entries.discard(entry_id)
        runtime = getattr(entry, "runtime_data", None)
        coordinator = getattr(runtime, "coordinator", None)
        state = getattr(coordinator, "data", None)
        state_available = coordinator is not None and state is not None
        update_success = getattr(coordinator, "last_update_success", False) is True
        available = state_available and update_success
        entry_projection = None
        if (
            available
            and runtime is not None
            and getattr(runtime, "slam_map", None) is not None
            and getattr(runtime, "cleaning_plans", None) is not None
            and getattr(runtime, "slam_history", None) is not None
            and getattr(state, "info", None) is not None
        ):
            # Use the exact field owner and serializer shared with the REST
            # catalog; WebSocket projection cannot invent map or run state.
            from .frontend import DATA_SLAM_SCENE_VIEW
            from .slam_scene import catalog_entry_projection

            scene_view = self.hass.data.get(DATA_SLAM_SCENE_VIEW)
            entry_projection = catalog_entry_projection(entry_id, runtime, scene_view)
        if available:
            status = {"state": "ready", "reason": None, "retryable": False}
        elif state_available:
            status = {
                "state": "stale",
                "reason": _coordinator_recovery_reason(coordinator),
                "retryable": not isinstance(
                    getattr(coordinator, "last_exception", None), ConfigEntryAuthFailed
                ),
            }
        else:
            status = {
                "state": "unavailable",
                "reason": _coordinator_recovery_reason(coordinator),
                "retryable": not isinstance(
                    getattr(coordinator, "last_exception", None), ConfigEntryAuthFailed
                ),
            }

        identity: dict[str, Any] = {
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
        slam_map = getattr(runtime, "slam_map", None)
        if slam_map is not None and available:
            revision = getattr(slam_map, "revision", None)
            if isinstance(revision, int) and not isinstance(revision, bool):
                resource_revisions.setdefault("scene", 0)
        history = getattr(runtime, "slam_history", None)
        if "history" not in resource_revisions:
            catalog = getattr(history, "catalog", None)
            snapshots = catalog() if callable(catalog) else ()
            history_revisions = [
                revision
                for snapshot in snapshots
                if isinstance((revision := getattr(snapshot, "revision", None)), int)
                and not isinstance(revision, bool)
                and revision >= 0
            ]
            resource_revisions["history"] = min(
                MAX_RESOURCE_REVISION, max(history_revisions, default=0)
            )
        revisions = {"workspace": sequence, **resource_revisions}
        if entry_projection is not None:
            floor_verified = bool(
                entry_projection["map_floor_coherent"]
                and entry_projection["map_session_verified"]
            )
            floor_plan = getattr(state, "floor_plan", None)
            mission_id = getattr(floor_plan, "mission_id", None)
            map_revision = entry_projection["map_revision"]
            if (
                floor_verified
                and isinstance(mission_id, int)
                and not isinstance(mission_id, bool)
            ):
                identity["floor_mission_id"] = mission_id
                identity["floor_verified"] = True
            if isinstance(map_revision, int) and not isinstance(map_revision, bool):
                revisions["scene"] = min(MAX_RESOURCE_REVISION, max(0, map_revision))
            else:
                revisions.pop("scene", None)
        elif available:
            floor_plan = getattr(state, "floor_plan", None)
            slam_map = getattr(runtime, "slam_map", None)
            is_current = bool(
                slam_map is not None
                and callable(getattr(slam_map, "floor_plan_is_current", None))
                and slam_map.floor_plan_is_current(floor_plan)
            )
            if is_current:
                mission_id = getattr(floor_plan, "mission_id", None)
                map_revision = getattr(slam_map, "revision", None)
                if isinstance(mission_id, int) and not isinstance(mission_id, bool):
                    identity["floor_mission_id"] = mission_id
                    identity["floor_verified"] = True
                if isinstance(map_revision, int) and not isinstance(map_revision, bool):
                    revisions["scene"] = min(
                        MAX_RESOURCE_REVISION, max(0, map_revision)
                    )
            else:
                revisions.pop("scene", None)
        else:
            revisions.pop("scene", None)

        result = {
            "schema": PROTOCOL_VERSION,
            "capabilities": dict(CAPABILITIES),
            "epoch": self._epoch,
            "sequence": sequence,
            "coherence_generation": generation,
            "entry_id": entry_id,
            "identity": identity,
            "status": status,
            "revisions": revisions,
            # Deliberately omit RobotState: it contains robot identity, raw
            # operational fields, maps, pose and telemetry not needed here.
            "payload": {"available": available, "entry": entry_projection},
        }
        if connection is not None and connection not in self._subscriptions.get(
            entry_id, {}
        ):
            # A live subscriber already receives and buffers every event while
            # this read is in flight. Only an unsubscribed startup snapshot
            # needs a replay cursor for the following subscribe handshake.
            cursors = self._snapshots.setdefault(connection, {})
            if entry_id not in cursors and len(cursors) >= SNAPSHOT_CURSOR_LIMIT:
                raise WorkspaceError("Too many pending workspace snapshots")
            cursors[entry_id] = sequence
            connection.subscriptions[(DOMAIN, "workspace_snapshot", entry_id)] = (
                lambda: self._release_snapshot_cursor(connection, entry_id)
            )
        return result

    @callback
    def subscribe(
        self,
        connection: ActiveConnection,
        entry_id: str,
        msg_id: int,
    ) -> list[dict[str, Any]]:
        """Subscribe and replay every invalidation since this connection's snapshot."""
        self._entry(entry_id)
        self._remove_subscription(connection, entry_id)
        cursor = self._snapshots.get(connection, {}).pop(
            entry_id, self._sequence.get(entry_id, 0)
        )
        connection.subscriptions.pop((DOMAIN, "workspace_snapshot", entry_id), None)
        cursors = self._snapshots.get(connection)
        if cursors == {}:
            self._snapshots.pop(connection, None)

        self._subscriptions.setdefault(entry_id, {})[connection] = msg_id
        connection.subscriptions[(DOMAIN, "workspace", entry_id)] = lambda: (
            self.unsubscribe(connection, entry_id)
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
    def unsubscribe(self, connection: ActiveConnection, entry_id: str) -> None:
        """Remove one entry subscription without affecting another entry."""
        self._remove_subscription(connection, entry_id)
        cursors = self._snapshots.get(connection)
        if cursors is not None:
            cursors.pop(entry_id, None)
            connection.subscriptions.pop((DOMAIN, "workspace_snapshot", entry_id), None)
            if not cursors:
                self._snapshots.pop(connection, None)

    def _release_snapshot_cursor(
        self, connection: ActiveConnection, entry_id: str
    ) -> None:
        """Forget a snapshot cursor when its WebSocket connection closes."""
        cursors = self._snapshots.get(connection)
        if cursors is None:
            return
        cursors.pop(entry_id, None)
        if not cursors:
            self._snapshots.pop(connection, None)

    def _remove_subscription(self, connection: ActiveConnection, entry_id: str) -> None:
        """Remove a listener while preserving a pending snapshot cursor."""
        subscriptions = self._subscriptions.get(entry_id)
        if subscriptions is not None:
            subscriptions.pop(connection, None)
            if not subscriptions:
                self._subscriptions.pop(entry_id, None)
        connection.subscriptions.pop((DOMAIN, "workspace", entry_id), None)


def _require_admin(connection: ActiveConnection) -> None:
    """Require administrator authorization for every workspace request."""
    if not connection.user or not connection.user.is_admin:
        raise Unauthorized


@websocket_command(
    {
        vol.Required("type"): COMMAND_SNAPSHOT,
        vol.Required("version"): vol.In([PROTOCOL_VERSION]),
        vol.Required("entry_id"): str,
    }
)
@callback
def websocket_snapshot(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Serve a versioned snapshot to administrators."""
    _require_admin(connection)
    manager: WorkspaceSocket = hass.data[DOMAIN]["workspace_socket"]
    connection.send_result(msg["id"], manager.snapshot(msg["entry_id"], connection))


@websocket_command(
    {
        vol.Required("type"): COMMAND_SUBSCRIBE,
        vol.Required("version"): vol.In([PROTOCOL_VERSION]),
        vol.Required("entry_id"): str,
    }
)
@callback
def websocket_subscribe(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Install an administrator subscription and return its handshake cursor."""
    _require_admin(connection)
    manager: WorkspaceSocket = hass.data[DOMAIN]["workspace_socket"]
    replay = manager.subscribe(connection, msg["entry_id"], msg["id"])
    sequence = manager._sequence.get(msg["entry_id"], 0)
    connection.send_result(
        msg["id"],
        {
            "version": PROTOCOL_VERSION,
            "epoch": manager._epoch,
            "sequence": sequence,
            "queue_limit": QUEUE_LIMIT,
        },
    )
    for event in replay:
        connection.send_event(msg["id"], event)


async def async_register(hass: HomeAssistant) -> WorkspaceSocket:
    """Register commands once and return the lifecycle owner."""
    existing = hass.data.setdefault(DOMAIN, {}).get("workspace_socket")
    if existing is not None:
        return cast(WorkspaceSocket, existing)
    manager = WorkspaceSocket(hass)
    hass.data[DOMAIN]["workspace_socket"] = manager
    websocket_api.async_register_command(hass, websocket_snapshot)
    websocket_api.async_register_command(hass, websocket_subscribe)
    await manager.async_start()
    return manager
