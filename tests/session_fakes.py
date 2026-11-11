"""Run a robot session and its heartbeat on a fake client, or fake one."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from custom_components.matic_robot.client.models import (
    FloorPlan,
    HermesCollectionEntry,
    RobotInfo,
    RobotOperationalState,
    RobotPose,
    RobotTelemetry,
    RunProgress,
)
from custom_components.matic_robot.session import RobotSession
from custom_components.matic_robot.stores import CleaningHistory, LiveState, Store

SYNTHETIC_INFO = RobotInfo(
    "synthetic",
    "Test",
    "robot.invalid",
    16320,
    "192.0.2.1",
    "2001:db8::1",
    True,
    True,
    True,
    "test",
)


def session_entry() -> SimpleNamespace:
    """Return the parts of a config entry a session and its heartbeat use.

    ``unload()`` runs what the session's users registered to stop on unload.
    """
    removals: list[Callable[[], object]] = []

    def unload() -> None:
        while removals:
            removals.pop()()

    return SimpleNamespace(
        entry_id="entry",
        pref_disable_polling=False,
        async_on_unload=MagicMock(side_effect=removals.append),
        async_start_reauth=MagicMock(),
        async_create_background_task=lambda hass, target, name: hass.async_create_task(
            target, name
        ),
        unload=unload,
    )


async def start_session(
    hass: Any, client: AsyncMock, entry: Any = None
) -> RobotSession:
    """Start a session on ``client`` with its state watch live.

    ``client`` answers ``async_get_info`` and ``async_get_state``. Its
    ``async_watch_state``, ``async_watch_poses`` and ``async_watch`` are
    mocks, so the test is the robot: ``push_state``, ``push_pose`` and
    ``displayed_mission_handler`` deliver what it sends.
    """
    session = RobotSession(hass, entry or session_entry(), client)
    await session.async_start()
    client.async_watch_state.call_args.args[1]("connected", None)
    return session


def displayed_mission_handler(client: AsyncMock) -> Callable[..., Any]:
    """Return the callback the heartbeat gave the displayed-mission watch."""
    name, on_entry = client.async_watch.call_args.args[:2]
    assert name == "displayed_mission"
    return on_entry  # type: ignore[no-any-return]


def mission_entry(payload: bytes) -> HermesCollectionEntry:
    """Return one displayed-mission collection entry carrying ``payload``."""
    return HermesCollectionEntry(b"", payload)


async def push_state(session: RobotSession, state: RobotOperationalState) -> None:
    """Publish ``state`` as the robot's next pushed snapshot."""
    await session.client.async_watch_state.call_args.args[0](state)
    session.async_flush_state()


async def push_pose(session: RobotSession, pose: RobotPose) -> None:
    """Publish ``pose`` as the robot's newest on its mission."""
    await session.client.async_watch_poses.call_args.args[0](pose)
    session._pose_publish.flush()


def fake_session(
    *,
    operational: RobotOperationalState,
    session_active: bool | None = None,
    info: RobotInfo = SYNTHETIC_INFO,
    floor_plan: FloorPlan | None = None,
    telemetry: RobotTelemetry | None = None,
    progress: RunProgress | None = None,
    history: CleaningHistory | None = None,
    pose: RobotPose | None = None,
    client: Any = None,
    health: Any = None,
) -> SimpleNamespace:
    """Return a session's stores without a robot, for entities and views.

    Its heartbeat records requests and reads nothing. ``pose_on`` returns
    ``pose`` on the floor it names.
    """
    session = SimpleNamespace(
        info=info,
        client=client if client is not None else SimpleNamespace(),
        error=Store(None),
        state=Store(LiveState(operational, session_active)),
        floor=Store(floor_plan),
        telemetry=Store(telemetry if telemetry is not None else RobotTelemetry()),
        progress=Store(progress),
        history=Store(history if history is not None else CleaningHistory()),
        poses=Store({} if pose is None else {pose.mission_id: pose}),
        health=health
        if health is not None
        else SimpleNamespace(
            unknown_alert_codes={},
            bag_observation=MagicMock(return_value={}),
            async_add_listener=MagicMock(return_value=MagicMock()),
        ),
        heartbeat=SimpleNamespace(
            interval=None,
            floor_read_generation=0,
            expected_floor_mission_id=None,
            displayed_mission=Store(None),
            async_refresh=AsyncMock(),
            async_request_refresh=AsyncMock(),
            async_request_full_refresh=AsyncMock(),
            async_request_floor_plan_refresh=AsyncMock(),
            async_discard_current_room=MagicMock(),
            async_confirm_room_completed=MagicMock(),
        ),
        async_flush_state=MagicMock(),
    )
    session.pose_on = lambda floor: (
        session.poses.value.get(floor.mission_id) if floor is not None else None
    )
    return session


def set_operational(session: Any, **changes: Any) -> None:
    """Replace fields of the state a fake session shows."""
    live = session.state.value
    session.state.set(replace(live, operational=replace(live.operational, **changes)))
