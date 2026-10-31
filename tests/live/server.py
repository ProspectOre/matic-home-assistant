"""Run Home Assistant with the integration against the simulated robot.

Usage: ``python tests/live/server.py [--port 8123] [--control-port 8124]``

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
import json
import socket
import sys
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from aiohttp import web

REPOSITORY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY))

from custom_components.matic_robot import managed_observation  # noqa: E402
from custom_components.matic_robot import wifi_survey as wifi_survey_module  # noqa: E402
from custom_components.matic_robot.client import tls  # noqa: E402
from custom_components.matic_robot.client.telemetry import (  # noqa: E402
    decode_cleaning_session,
)
from tests.e2e.conftest import entry_data  # noqa: E402
from tests.e2e.hermes_sim import (  # noqa: E402
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
    }
)


def _storage(key: str, version: int, data: dict[str, Any], minor: int = 1) -> str:
    return json.dumps(
        {"version": version, "minor_version": minor, "key": key, "data": data}
    )


def write_config(directory: Path, simulator: RunningSimulator, port: int) -> str:
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
                        "options": {},
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


async def _control_app(robot: SimulatedRobot) -> web.Application:
    last_finished_session: dict[str, Any] | None = None

    async def step(request: web.Request) -> web.Response:
        nonlocal last_finished_session
        name = request.match_info["name"]
        if name not in STEPS:
            raise web.HTTPNotFound(text=f"unknown step {name}")
        if name == "queue_wifi_sample":
            robot.queue_wifi_scan(wifi_status(-42))
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
            }
        )

    app = web.Application()
    app.router.add_post("/step/{name}", step)
    app.router.add_get("/state", state)
    return app


def start_robot_thread(
    directory: Path, control_port: int
) -> tuple[SimulatedRobot, RunningSimulator]:
    """Run the simulator and its control server on their own event loop."""
    ready: dict[str, Any] = {}
    started = threading.Event()

    def run() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def serve() -> None:
            robot = SimulatedRobot()
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
            runner = web.AppRunner(await _control_app(robot))
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
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="matic-live-") as temporary:
        return run(Path(temporary), args.port, args.control_port)


def run(workspace: Path, port: int, control_port: int) -> int:
    # Keep survey evidence deterministic and the live observation bounded.
    wifi_survey_module.SAMPLE_INTERVAL_SECONDS = 0.25
    managed_observation.SESSION_HISTORY_TIMEOUT_SECONDS = 15
    robot, simulator = start_robot_thread(workspace, control_port)
    tls.MATIC_INTERMEDIATE_CA = simulator.ca_path
    resolve = socket.getaddrinfo

    def getaddrinfo(host: Any, *rest: Any, **kwargs: Any) -> Any:
        if host == robot.hostname.rstrip("."):
            host = simulator.host
        return resolve(host, *rest, **kwargs)

    socket.getaddrinfo = getaddrinfo
    config = workspace / "config"
    config.mkdir()
    write_config(config, simulator, port)

    from homeassistant import __main__ as hass_main

    sys.argv = ["hass", "--config", str(config)]
    return hass_main.main()


if __name__ == "__main__":
    sys.exit(main())
