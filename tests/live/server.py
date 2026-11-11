"""Run Home Assistant with the integration against the simulated robot.

Usage: ``python tests/live/server.py [--port 8123] [--control-port 8124]``
       ``[--workspace-push off|on]``

This is the backend for the live browser tests. It starts the simulated
robot from ``tests/e2e/hermes_sim.py`` on loopback, writes a throwaway Home
Assistant configuration with the Matic config entry already paired, and runs
Home Assistant Core with its frontend in this process. The robot's trust
anchor and ``.local`` name are substituted exactly as in the pytest harness.

A small control server lets a browser test move the robot:
``POST /step/<name>`` runs a scripted step (``finish_room``, ``finish_session``,
``arrive_at_dock`` and others without arguments), and ``GET /state`` returns
the robot's phase, current area, the rooms in its task, the last go-to-room
destination and the commands it received.

Everything here is synthetic and bound to 127.0.0.1. Results are simulated
evidence, not installed or physical qualification.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import socket
import sys
import tempfile
import threading
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic
from typing import Any
from uuid import UUID, uuid4

from aiohttp import web

REPOSITORY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY))

from custom_components.matic_robot import managed_observation  # noqa: E402
from custom_components.matic_robot import wifi_survey as wifi_survey_module  # noqa: E402
from custom_components.matic_robot.client import tls  # noqa: E402
from custom_components.matic_robot.client.cleaning_session import (  # noqa: E402
    decode_cleaning_session,
)
from tests.e2e.conftest import entry_data  # noqa: E402
from tests.e2e.hermes_sim import (  # noqa: E402
    IDLE_SESSION_KEY,
    RunningSimulator,
    SimulatedRobot,
    start_simulator,
)
from tests.e2e.sim_mission import schedule_event, two_room_floor, wifi_status  # noqa: E402

OWNER_ID = "0" * 31 + "1"
STEPS = frozenset(
    {
        "start_cleaning",
        "hold_history",
        "finish_room",
        "finish_session",
        "release_history",
        "arrive_at_dock",
        "low_charge_recharge",
        "recharged",
        "fault",
        "app_takes_over",
        "queue_wifi_sample",
        "move_reported_area",
    }
)


def _storage(key: str, version: int, data: dict[str, Any], minor: int = 1) -> str:
    return json.dumps(
        {"version": version, "minor_version": minor, "key": key, "data": data}
    )


def write_config(
    directory: Path,
    simulator: RunningSimulator,
    port: int,
    *,
    workspace_push: bool = False,
) -> str:
    """Write a configuration that is onboarded and has the robot paired."""
    (directory / "configuration.yaml").write_text(
        "homeassistant:\n"
        "  name: Matic simulation\n"
        "  time_zone: UTC\n"
        "  auth_providers:\n"
        "    - type: trusted_networks\n"
        "      trusted_networks: [127.0.0.1/32]\n"
        "      allow_bypass_login: true\n"
        "frontend:\n"
        "config:\n"
    )
    storage = directory / ".storage"
    storage.mkdir()
    now = datetime.now(UTC).isoformat()
    # Home Assistant keeps HTTP settings in storage and asks to confirm a
    # change; store them as already confirmed.
    (storage / "http").write_text(
        _storage(
            "http",
            2,
            {
                "stable": {
                    "server_port": port,
                    "server_host": ["127.0.0.1"],
                    "cors_allowed_origins": [],
                    "login_attempts_threshold": -1,
                    "ip_ban_enabled": False,
                    "ssl_profile": "modern",
                    "use_x_frame_options": True,
                    "created_at": now,
                    "error": None,
                    "error_message": None,
                },
                "pending": None,
                "yaml_migration_done": True,
            },
            minor=2,
        )
    )
    (storage / "onboarding").write_text(
        _storage(
            "onboarding",
            4,
            {"done": ["user", "core_config", "analytics", "integration"]},
        )
    )
    (storage / "auth").write_text(
        _storage(
            "auth",
            1,
            {
                "users": [
                    {
                        "id": OWNER_ID,
                        "group_ids": ["system-admin"],
                        "is_owner": True,
                        "is_active": True,
                        "name": "Owner",
                        "system_generated": False,
                        "local_only": True,
                    }
                ],
                "groups": [
                    {"id": "system-admin", "name": "Administrators"},
                    {"id": "system-users", "name": "Users"},
                    {"id": "system-read-only", "name": "Read Only"},
                ],
                "credentials": [],
                "refresh_tokens": [],
            },
        )
    )
    credential = simulator.robot.add_credential(str(uuid4()))
    entry_id = uuid4().hex
    simulator.robot.entry_id = entry_id
    (storage / "core.config_entries").write_text(
        _storage(
            "core.config_entries",
            1,
            {
                "entries": [
                    {
                        "entry_id": entry_id,
                        "version": 1,
                        "minor_version": 3,
                        "domain": "matic_robot",
                        "title": simulator.robot.name,
                        "data": entry_data(simulator, credential),
                        "options": {"workspace_push": workspace_push},
                        "pref_disable_new_entities": False,
                        "pref_disable_polling": False,
                        "source": "user",
                        "unique_id": simulator.robot.serial_number,
                        "disabled_by": None,
                        "discovery_keys": {},
                        "subentries": [],
                        "created_at": now,
                        "modified_at": now,
                    }
                ]
            },
            minor=5,
        )
    )
    return entry_id


def _record_robot_state_trace(
    robot: SimulatedRobot,
    trace: deque[dict[str, Any]],
    trace_lock: threading.Lock,
    started_at: float,
    property_name: str,
) -> None:
    key = robot._properties.get("active_session_key", b"")
    session = robot.session
    event = {
        "sequence": len(trace),
        "elapsed_ms": round((monotonic() - started_at) * 1000),
        "property": property_name,
        "phase": robot.phase.value,
        "current_area": robot.current_area,
        "session_active": key != IDLE_SESSION_KEY,
        "session_key_fingerprint": hashlib.sha256(key).hexdigest()[:12],
        "session_rooms": (
            [
                robot.floor.room(visit.room).name
                if visit.room is not None
                else "Custom area"
                if visit.custom_area
                else "Unknown area"
                for visit in session.visits
            ]
            if robot.floor is not None and session is not None
            else []
        ),
        "history_held": robot.hold_history_updates,
        "pending_history_count": len(robot._pending_history),
        "user_command_count": sum(
            command.channel == "user_command" for command in robot.commands
        ),
    }
    with trace_lock:
        trace.append(event)


def _install_robot_state_trace(
    robot: SimulatedRobot,
    trace: deque[dict[str, Any]],
    trace_lock: threading.Lock,
    started_at: float,
) -> None:
    """Record only privacy-safe simulator identity/state transitions."""
    original_set_property = robot.set_property

    def traced_set_property(name: str, value: bytes) -> None:
        original_set_property(name, value)
        if name in {"active_session_key", "kabuki_state"}:
            _record_robot_state_trace(robot, trace, trace_lock, started_at, name)

    robot.set_property = traced_set_property  # type: ignore[method-assign]


def _session_state_trace(
    trace: deque[dict[str, Any]],
    trace_lock: threading.Lock,
    started_at: float,
) -> None:
    """Record what each push and heartbeat published, without identifiers."""
    from custom_components.matic_robot.client.api import MaticHermesClient
    from custom_components.matic_robot.heartbeat import Heartbeat
    from custom_components.matic_robot.session import RobotSession

    def record(event: str, session: Any, error_type: str | None = None) -> None:
        live = session.state.value
        item = {
            "elapsed_ms": round((monotonic() - started_at) * 1000),
            "event": event,
            "published_active": live.session_active,
            "published_cleaning": live.operational.cleaning,
            "published_returning": live.operational.returning,
            "error_type": error_type,
        }
        with trace_lock:
            trace.append(item)

    original_push = RobotSession._async_publish_pending

    def traced_push(self: Any) -> None:
        original_push(self)
        record("push", self)

    RobotSession._async_publish_pending = traced_push  # type: ignore[method-assign]
    original_heartbeat = Heartbeat._async_read

    async def traced_heartbeat(self: Any) -> None:
        try:
            await original_heartbeat(self)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            record("heartbeat_error", self._session, type(err).__name__)
            raise
        record("heartbeat", self._session)

    Heartbeat._async_read = traced_heartbeat  # type: ignore[method-assign]

    original_identity_read = MaticHermesClient.async_get_cleaning_session_identity

    async def traced_identity_read(self: Any) -> bytes | None:
        identity = await original_identity_read(self)
        with trace_lock:
            trace.append(
                {
                    "elapsed_ms": round((monotonic() - started_at) * 1000),
                    "event": "identity_read",
                    "identity_state": (
                        "unknown"
                        if identity is None
                        else "idle"
                        if identity == b""
                        else "active"
                    ),
                    "identity_fingerprint": (
                        hashlib.sha256(identity).hexdigest()[:12] if identity else None
                    ),
                }
            )
        return identity

    MaticHermesClient.async_get_cleaning_session_identity = traced_identity_read


async def _control_app(
    robot: SimulatedRobot,
    robot_trace: deque[dict[str, Any]],
    session_trace: deque[dict[str, Any]],
    trace_lock: threading.Lock,
    started_at: float,
) -> web.Application:
    last_finished_session: dict[str, Any] | None = None

    async def step(request: web.Request) -> web.Response:
        nonlocal last_finished_session
        name = request.match_info["name"]
        if name not in STEPS:
            raise web.HTTPNotFound(text=f"unknown step {name}")
        if name == "queue_wifi_sample":
            robot.queue_wifi_scan(wifi_status(-42))
        elif name == "move_reported_area":
            # Change only the simulated reported location; issue no command.
            robot.set_current_area("Study")
        elif name == "hold_history":
            with trace_lock:
                robot_trace.clear()
                session_trace.clear()
            robot.hold_history()
            _record_robot_state_trace(
                robot, robot_trace, trace_lock, started_at, "hold_history_checkpoint"
            )
        elif name == "finish_session":
            session = robot.session
            robot.finish_session()
            native = (
                decode_cleaning_session(robot._history[-1][1])
                if robot._history
                else None
            )
            last_finished_session = {
                "history_recorded": native is not None,
                "completed": native.completed if native is not None else None,
                "rooms": list(native.rooms) if native is not None else [],
                "custom_area": bool(
                    session
                    and session.visits
                    and all(visit.custom_area for visit in session.visits)
                ),
                "custom_area_circles": [
                    list(circle)
                    for visit in (session.visits if session else ())
                    for circle in visit.circles
                ],
            }
        else:
            getattr(robot, name)()
        return web.json_response({"phase": robot.phase.value})

    async def state(_request: web.Request) -> web.Response:
        with trace_lock:
            robot_events = list(robot_trace)
            session_events = list(session_trace)
        return web.json_response(
            {
                "phase": robot.phase.value,
                "last_finished_session": last_finished_session,
                "entry_id": getattr(robot, "entry_id", None),
                "current_area": robot.current_area,
                "plan": (
                    [
                        robot.floor.room(visit.room).name
                        if visit.room is not None
                        else "Custom area"
                        if visit.custom_area
                        else "Unknown area"
                        for visit in robot.session.visits
                    ]
                    if robot.floor is not None and robot.session is not None
                    else []
                ),
                "destination": (
                    robot.floor.room(robot.destination).name
                    if robot.floor is not None and robot.destination is not None
                    else None
                ),
                "commands": [
                    {"channel": command.channel, "payload": command.payload.hex()}
                    for command in robot.commands
                ],
                "identity_trace": robot_events,
                "session_trace": session_events,
            }
        )

    app = web.Application()
    app.router.add_post("/step/{name}", step)
    app.router.add_get("/state", state)
    return app


def start_robot_thread(
    directory: Path,
    control_port: int,
    robot_trace: deque[dict[str, Any]],
    session_trace: deque[dict[str, Any]],
    trace_lock: threading.Lock,
    started_at: float,
) -> tuple[SimulatedRobot, RunningSimulator]:
    """Run the simulator and its control server on their own event loop."""
    ready: dict[str, Any] = {}
    started = threading.Event()

    def run() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def serve() -> None:
            robot = SimulatedRobot()
            _install_robot_state_trace(robot, robot_trace, trace_lock, started_at)
            robot.set_floor(two_room_floor())
            robot.set_native_schedules(
                [
                    schedule_event(
                        name="Live schedule sample",
                        weekdays=(1, 2, 3, 4, 5, 6, 7),
                        minute_of_day=23 * 60 + 59,
                        room_ids=(UUID("11111111-1111-4111-8111-111111111111"),),
                        cleaning_mode="vacuum",
                    )
                ]
            )
            simulator = await start_simulator(robot, directory)
            runner = web.AppRunner(
                await _control_app(
                    robot, robot_trace, session_trace, trace_lock, started_at
                )
            )
            await runner.setup()
            await web.TCPSite(runner, "127.0.0.1", control_port).start()
            ready.update(robot=robot, simulator=simulator)
            started.set()
            await asyncio.Event().wait()

        loop.run_until_complete(serve())

    threading.Thread(target=run, name="simulated-robot", daemon=True).start()
    if not started.wait(30):
        raise RuntimeError("simulated robot did not start")
    return ready["robot"], ready["simulator"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument("--control-port", type=int, default=8124)
    parser.add_argument(
        "--workspace-push",
        choices=("off", "on"),
        default="off",
        help="simulate an older server without push or a supported server",
    )
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="matic-live-") as temporary:
        robot_trace: deque[dict[str, Any]] = deque(maxlen=256)
        session_trace: deque[dict[str, Any]] = deque(maxlen=256)
        trace_lock = threading.Lock()
        started_at = monotonic()
        return run(
            Path(temporary),
            args.port,
            args.control_port,
            workspace_push=args.workspace_push == "on",
            robot_trace=robot_trace,
            session_trace=session_trace,
            trace_lock=trace_lock,
            started_at=started_at,
        )


def run(
    workspace: Path,
    port: int,
    control_port: int,
    *,
    workspace_push: bool = False,
    robot_trace: deque[dict[str, Any]],
    session_trace: deque[dict[str, Any]],
    trace_lock: threading.Lock,
    started_at: float,
) -> int:
    # Keep survey evidence deterministic and the live observation bounded.
    wifi_survey_module.SAMPLE_INTERVAL_SECONDS = 0.25
    managed_observation.SESSION_HISTORY_TIMEOUT_SECONDS = 15
    robot, simulator = start_robot_thread(
        workspace,
        control_port,
        robot_trace,
        session_trace,
        trace_lock,
        started_at,
    )
    tls.MATIC_INTERMEDIATE_CA = simulator.ca_path
    resolve = socket.getaddrinfo

    def getaddrinfo(host: Any, *rest: Any, **kwargs: Any) -> Any:
        if host == robot.hostname.rstrip("."):
            host = simulator.host
        return resolve(host, *rest, **kwargs)

    socket.getaddrinfo = getaddrinfo
    config = workspace / "config"
    config.mkdir()
    write_config(config, simulator, port, workspace_push=workspace_push)
    # Keep the paired live-test lanes meaningful after push becomes the default:
    # off simulates an older server that omits the capability, while on
    # exercises the current server projection. Saved legacy options do not
    # control production behavior.
    from custom_components.matic_robot import slam_catalog_view, slam_view_data

    catalog_projection = slam_view_data.catalog_entry_projection

    def simulated_catalog_projection(
        entry_id: str, runtime: Any, scene_view: Any = None
    ) -> dict[str, Any]:
        projection = catalog_projection(entry_id, runtime, scene_view)
        if not workspace_push:
            projection.pop("live_workspace_transport_enabled", None)
        return projection

    slam_view_data.catalog_entry_projection = simulated_catalog_projection
    slam_catalog_view.catalog_entry_projection = simulated_catalog_projection
    _session_state_trace(session_trace, trace_lock, started_at)

    from homeassistant import __main__ as hass_main

    sys.argv = ["hass", "--config", str(config)]
    return hass_main.main()


if __name__ == "__main__":
    sys.exit(main())
