"""Run a robot session and its heartbeat on a fake client, or fake one."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from custom_components.matic_robot.client.models import (
    FloorPlan,
    HermesCollectionEntry,
    RobotActivity,
    RobotInfo,
    RobotOperationalState,
    RobotPose,
    RobotTelemetry,
    RunProgress,
)
from custom_components.matic_robot.robot_commands import PlanStart, RobotCommands
from custom_components.matic_robot.robot_port import RobotPort
from custom_components.matic_robot.run_machine import (
    CheckpointWrite,
    LegVerifying,
    Run,
    RunEvent,
    transition,
)
from custom_components.matic_robot.session import RobotSession
from custom_components.matic_robot.stores import CleaningHistory, LiveState, Store
from tests.wire_builders import _session_identity

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


def robot_client(**methods: Any) -> SimpleNamespace:
    """Return a fake client with ``methods`` and the rest a run's port binds.

    Its activity journal keeps only the run scope.
    """
    scope: dict[str, str | None] = {"run_id": None}
    return SimpleNamespace(
        **{
            "activity_journal": SimpleNamespace(
                set_run_id=lambda run_id: scope.update(run_id=run_id),
                current_run_id=lambda: scope["run_id"],
            ),
            "async_confirm_coverage_receipt": AsyncMock(return_value=False),
            **methods,
        }
    )


_VACUUM_FLAGS: dict[str, dict[str, Any]] = {
    "cleaning": {"cleaning": True},
    "paused": {"paused": True},
    "returning": {"returning": True},
    "docked": {"charging_idle": True},
    "charging": {"charging": True},
    "idle": {},
}


class FakeRobot:
    """A robot a plan run reaches through ports it hands out.

    It records each start a port sends in ``started``, then awaits
    ``on_start`` with it. ``show`` sets the state it reports, in the vacuum's
    words; until then it reports nothing, as if it could not be reached.
    """

    def __init__(self) -> None:
        self.started: list[PlanStart] = []
        # (floor token, mission identity) of each end-after-current-room.
        self.ended_after_current: list[tuple[str, bytes]] = []
        self.on_start: Callable[[PlanStart], Awaitable[None]] | None = None
        # The session the robot runs before any start, such as a prepared one.
        self.running = b""
        self.state = Store(LiveState(_operational(), None))
        self.error: Store[Exception | None] = Store(ConnectionError("no state yet"))

    def show(
        self,
        activity: str,
        *,
        current_area: str | None = None,
        low_charge: bool = False,
        previous_area: str | None = None,
        battery: int = 80,
        error_code: int = 1,
    ) -> None:
        """Report ``activity`` as the vacuum would show it, or ``unavailable``."""
        if activity == "unavailable":
            self.error.set(ConnectionError("unreachable"))
            return
        flags = (
            {"error_codes": (error_code,)}
            if activity == "error"
            else _VACUUM_FLAGS[activity]
        )
        self.state.set(
            LiveState(
                _operational(
                    **flags,
                    battery_percentage=battery,
                    low_charge=low_charge,
                    current_area=current_area,
                    previous_area=previous_area,
                ),
                None,
            )
        )
        self.error.set(None)

    async def accepting(self) -> bytes:
        """Read the session of a robot that runs every start it gets.

        It reports the session ID of the latest start, else ``running``, and
        no session while the robot is returning, docked or idle, unless it
        went home to recharge.
        """
        observed = None if self.error.value else self.state.value.operational
        if (
            observed is not None
            and observed.activity
            in {RobotActivity.RETURNING, RobotActivity.DOCKED, RobotActivity.READY}
            and not observed.low_charge
        ):
            return b""
        if not self.started:
            return self.running
        return _session_identity(self.started[-1].session_id)

    async def owned(self) -> bytes:
        """Read the session of the latest start, whatever the robot shows."""
        return _session_identity(self.started[-1].session_id) if self.started else b""

    async def start(self, command: PlanStart) -> None:
        """Take ``command`` as a port's start."""
        self.started.append(command)
        if self.on_start is not None:
            await self.on_start(command)

    async def end_after_current_room(self, floor_token: str, identity: bytes) -> None:
        """Take a port's end-after-current-room."""
        self.ended_after_current.append((floor_token, identity))

    def taking_starts(self) -> Any:
        """Patch the command module so a port bound to an entry starts here."""
        return patch.object(
            RobotCommands,
            "async_start_plan_leg",
            lambda _commands, command: self.start(command),
        )

    def port(self, **readers: Any) -> RobotPort:
        """Return a port to this robot; it has no history, or ``readers``."""
        return RobotPort(
            **{
                "start": self.start,
                "end_after_current_room": self.end_after_current_room,
                "state": self.state,
                "error": self.error,
                "refresh": AsyncMock(),
                "active_session": AsyncMock(return_value=False),
                "session_history": AsyncMock(return_value=()),
                "session_identity": AsyncMock(return_value=b""),
                "coverage_verifier": AsyncMock(return_value=False),
                "confirm_room_completed": MagicMock(),
                "set_activity_run_id": MagicMock(),
                "get_activity_run_id": MagicMock(return_value=None),
                **readers,
            }
        )


def _operational(**flags: Any) -> RobotOperationalState:
    return RobotOperationalState(
        **{
            "battery_percentage": 80,
            "state_codes": (),
            "error_codes": (),
            "charging_idle": False,
            "charging": False,
            "low_charge": False,
            "paused": False,
            "cleaning": False,
            "returning": False,
            **flags,
        }
    )


def robot_port(**readers: Any) -> RobotPort:
    """Return a port to a robot that shows nothing and has no history."""
    return FakeRobot().port(**readers)


def set_operational(session: Any, **changes: Any) -> None:
    """Replace fields of the state a fake session shows."""
    live = session.state.value
    session.state.set(replace(live, operational=replace(live.operational, **changes)))


async def run_step(event: RunEvent) -> CheckpointWrite:
    """Return the checkpoint write ``event`` makes, for a leg run on its own."""
    return transition(Run(), event)[1]


def verifying_write(deadline: datetime) -> CheckpointWrite:
    """Return the write that marks a leg verifying until ``deadline``."""
    return transition(Run(), LegVerifying(deadline))[1]


def one_room_missions(monkeypatch: Any) -> None:
    """Run each room as its own mission, as a run saved before shared missions."""
    from custom_components.matic_robot import managed_executor

    grouped = managed_executor.leg_groups

    def split(rooms: Any, **options: Any) -> Any:
        return grouped(rooms, **{**options, "single_room_missions": True})

    monkeypatch.setattr(managed_executor, "leg_groups", split)
