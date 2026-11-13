"""A complete fake of an entry's runtime data for workspace tests.

Each collaborator has every member the workspace socket and the catalog
projection read, so tests change state instead of removing members.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from custom_components.matic_robot.slam_decoded_map import DecodedMap
from custom_components.matic_robot.slam_history_format import SlamHistorySnapshot
from custom_components.matic_robot.stores import LiveState, Store


class Publisher:
    """A store that calls its listeners when a test publishes a change."""

    def __init__(self) -> None:
        self.listeners: set[Callable[[], None]] = set()

    def async_add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        self.listeners.add(listener)
        return lambda: self.listeners.discard(listener)

    def publish(self) -> None:
        for listener in tuple(self.listeners):
            listener()


class ScenePublisher(Publisher):
    """The live map store: revision, identity and session verification."""

    def __init__(self) -> None:
        super().__init__()
        self.revision = 1
        self.current = True
        self.live_session_verified = True
        self.mission_identity: Any = None
        self.health = SimpleNamespace(
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

    def floor_plan_is_current(self, floor_plan: Any) -> bool:
        return self.current and self.live_session_verified and floor_plan is not None


class HistoryPublisher(Publisher):
    """The saved-map history store and its catalog."""

    def __init__(self) -> None:
        super().__init__()
        self.snapshots: tuple[Any, ...] = ()
        self.generation = 0
        self.capture_paused = False
        self.capacity_blocked = False

    def catalog(self) -> tuple[Any, ...]:
        return self.snapshots

    def catalog_for_mission(self, mission_token: str | None) -> tuple[Any, ...]:
        return tuple(
            snapshot
            for snapshot in self.snapshots
            if snapshot.mission_token == mission_token
        )

    def catalogs_by_mission(self) -> dict[str | None, tuple[Any, ...]]:
        return {}


class PlanPublisher(Publisher):
    """The plan manager's catalog, repository, history, control and ledger."""

    def __init__(self) -> None:
        super().__init__()
        self.plan_data: dict[str, dict[str, Any]] = {"plan-a": {"name": "Morning"}}
        self.area_data: dict[str, dict[str, Any]] = {}
        self.catalog = self
        self.repository = self
        self.history = SimpleNamespace(snapshot=lambda _serial: {})
        self.control = SimpleNamespace(
            lock=lambda _serial: SimpleNamespace(locked=lambda: False),
            stop_pending=lambda _serial: False,
        )
        self.ledger = SimpleNamespace(pending_native_reconciliation=lambda _s: None)

    def plans(self, _serial_number: str) -> Any:
        return {key: dict(value) for key, value in self.plan_data.items()}

    def areas(self, _serial_number: str) -> Any:
        return {key: dict(value) for key, value in self.area_data.items()}

    def async_add_listener(  # type: ignore[override]
        self, _serial_number: str, listener: Callable[[], None]
    ) -> Callable[[], None]:
        return super().async_add_listener(listener)


def saved_map(**fields: Any) -> SlamHistorySnapshot:
    """Return a saved map with no content; its record ID is its content ID."""
    fields.setdefault("record_id", fields["snapshot_id"])
    return SlamHistorySnapshot(
        **{
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
            "revision": 0,
            "point_count": 0,
            "compressed": b"",
            **fields,
        }
    )


def history_snapshot(snapshot_id: str, revision: int) -> SlamHistorySnapshot:
    """Return a saved map with no content."""
    return saved_map(snapshot_id=snapshot_id, revision=revision)


def session(
    *, cleaning: bool = False, floor_plan: Any = None, zones: tuple[str, ...] = ()
) -> SimpleNamespace:
    """Return a reachable robot session with no map identity."""
    return SimpleNamespace(
        info=SimpleNamespace(serial_number="private-serial"),
        error=Store(None),
        state=Store(LiveState(SimpleNamespace(cleaning=cleaning), False)),
        floor=Store(floor_plan),
        telemetry=Store(SimpleNamespace(zones=zones)),
        poses=Store({None: SimpleNamespace(x=123.0, y=456.0)}),
    )


def runtime(robot_session: Any = None) -> SimpleNamespace:
    """Return runtime data with every collaborator present."""
    return SimpleNamespace(
        session=robot_session if robot_session is not None else session(),
        cleaning_plans=PlanPublisher(),
        slam_map=ScenePublisher(),
        slam_history=HistoryPublisher(),
        run_trails=MagicMock(),
    )


def mock_history() -> SimpleNamespace:
    """Return a saved-map history whose readers are mocks a test can program."""
    return SimpleNamespace(
        catalog=MagicMock(return_value=()),
        catalog_for_mission=MagicMock(return_value=()),
        catalogs_by_mission=MagicMock(return_value=()),
        async_scene=AsyncMock(return_value=None),
        generation=0,
        capture_paused=False,
        capacity_blocked=False,
        async_add_listener=MagicMock(return_value=MagicMock()),
    )


def mock_repository() -> SimpleNamespace:
    """Return a plan repository that accepts change listeners."""
    return SimpleNamespace(async_add_listener=MagicMock(return_value=MagicMock()))


def activity_journal() -> SimpleNamespace:
    """Return a client activity journal with no run in scope."""
    return SimpleNamespace(
        set_run_id=MagicMock(), current_run_id=MagicMock(return_value=None)
    )


def entity_slam_map() -> SimpleNamespace:
    """Return an empty live map whose floor checks pass, as entity tests use."""
    return SimpleNamespace(
        async_add=AsyncMock(),
        decoded_tiles=MagicMock(return_value=()),
        async_decoded_map=AsyncMock(return_value=DecodedMap(0, None, (), ())),
        tile_count=0,
        structure_tile_count=0,
        map_complete=False,
        revision=0,
        mission_identity=None,
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=True),
        async_add_listener=MagicMock(return_value=MagicMock()),
    )


def mock_cadence() -> SimpleNamespace:
    """Return a cadence owner with no schedules and no daily limits."""
    return SimpleNamespace(
        daily_limit_state=MagicMock(return_value={"limit": None, "reached": False}),
        shared_cadence_delete_token=MagicMock(return_value=None),
        cadence_editor_state=MagicMock(return_value={"cadence": None}),
    )
