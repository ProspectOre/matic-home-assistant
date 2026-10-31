"""Installed-host check script tests, against a scripted Home Assistant."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from aiohttp import WSMsgType, web

from custom_components.matic_robot import frontend
from scripts.installed_check import (
    ASSISTANT_TOOLS,
    INTEGRATION,
    Candidate,
    CheckFailed,
    HomeAssistant,
    InstalledCheck,
    Options,
    Receipt,
    _main,
    call_mcp_tools,
    compare_files,
    main,
    parse_sha256sum,
)

ROOT = Path(__file__).resolve().parents[1]
ROBOT = "vacuum.matic"


def _blobs(version: str = "0.6.0b1") -> dict[str, bytes]:
    return {
        "manifest.json": json.dumps(
            {"domain": "matic_robot", "version": version}
        ).encode(),
        "services.yaml": b"clean:\n  target: {}\ngo_to_room:\n  fields: {}\n",
        "matic_icons.js": b"icons",
        "map_studio_v4/index.js": b"studio",
        "map_studio_v4/chunks/a.js": b"chunk",
    }


def _candidate(version: str = "0.6.0b1") -> Candidate:
    return Candidate.from_blobs("v0.6.0b1", "c" * 40, _blobs(version))


def test_served_paths_repeat_the_frontend_hashing() -> None:
    integration = ROOT / INTEGRATION
    blobs = {
        path.relative_to(integration).as_posix(): path.read_bytes()
        for path in integration.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts
    }
    candidate = Candidate.from_blobs("tag", "commit", blobs)
    assert set(candidate.served) == {
        frontend.MATIC_ICONS_PATH,
        frontend.MATIC_MAP_STUDIO_V4_PATH,
    }
    assert "clean" in candidate.services
    assert "go_to_room" in candidate.services


def test_candidate_reads_the_tag_from_git(tmp_path: Path) -> None:
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(tmp_path), *args],
            capture_output=True,
            check=True,
            text=True,
        ).stdout.strip()

    git("init", "-q")
    for name, data in _blobs().items():
        path = tmp_path / INTEGRATION / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    (tmp_path / "README.md").write_text("outside the integration")
    git("add", ".")
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "c")
    git("tag", "v0.6.0b1")
    candidate = Candidate.from_git(tmp_path, "v0.6.0b1")
    assert candidate.commit == git("rev-parse", "HEAD")
    assert candidate.version == "0.6.0b1"
    assert set(candidate.files) == set(_blobs())
    assert candidate.services == {"clean", "go_to_room"}


def test_installed_files_must_match_exactly() -> None:
    expected = {"a.py": "1", "b.py": "2"}
    compare_files(expected, parse_sha256sum("1  ./a.py\n2  ./b.py\n"))
    with pytest.raises(CheckFailed, match=r"missing \['b.py'\], extra \['c.py'\]"):
        compare_files(expected, {"a.py": "1", "c.py": "3"})
    with pytest.raises(CheckFailed, match=r"changed \['a.py'\]"):
        compare_files(expected, {"a.py": "9", "b.py": "2"})


class FakeHomeAssistant:
    """Answers the commands the check sends, and records them."""

    poll_interval = 0

    def __init__(self, candidate: Candidate) -> None:
        self.candidate = candidate
        self.version = candidate.version
        self.robot_states = ["docked"]
        self.protected = True
        self.backups: list[dict[str, Any]] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.served = dict(candidate.served)
        self.sent: list[str] = []
        self.clean_error: str | None = None

    def services_called(self) -> list[str]:
        return [
            f"{data['domain']}.{data['service']}"
            for kind, data in self.calls
            if kind == "call_service"
        ]

    async def call(self, message_type: str, **data: Any) -> Any:
        self.calls.append((message_type, data))
        match message_type:
            case "get_config":
                return {"version": "2026.10.4", "state": "RUNNING"}
            case "backup/info":
                return {"backups": list(self.backups)}
            case "backup/generate_with_automatic_settings":
                self.backups.append(
                    {
                        "backup_id": "b1",
                        "name": "Automatic backup",
                        "agents": {"hassio.local": {"protected": self.protected}},
                        "database_included": True,
                    }
                )
                return None
            case "hacs/repositories/list":
                return [{"id": "42", "full_name": "prospectore/matic-home-assistant"}]
            case "manifest/get":
                return {"version": self.version}
            case "config/entity_registry/list":
                return [
                    {
                        "entity_id": ROBOT,
                        "platform": "matic_robot",
                        "disabled_by": None,
                    },
                    {
                        "entity_id": "sensor.off",
                        "platform": "matic_robot",
                        "disabled_by": "user",
                    },
                    {"entity_id": "light.x", "platform": "hue", "disabled_by": None},
                ]
            case "get_states":
                state = (
                    self.robot_states.pop(0)
                    if len(self.robot_states) > 1
                    else (self.robot_states[0])
                )
                return [{"entity_id": ROBOT, "state": state}]
            case "get_services":
                return {"matic_robot": {name: {} for name in self.candidate.services}}
        return None

    async def send(self, message_type: str, **data: Any) -> int:
        self.calls.append((message_type, data))
        self.sent.append(message_type)
        return len(self.sent)

    async def receive(
        self, message_id: int, *, timeout_seconds: float | None = None
    ) -> dict[str, Any]:
        if self.sent[message_id - 1] == "backup/subscribe_events":
            event = {"manager_state": "create_backup", "state": "completed"}
            return {"id": message_id, "event": event}
        return {"id": message_id, "success": True}

    def reply_if_ready(self, message_id: int) -> dict[str, Any] | None:
        if self.clean_error is not None:
            return {"id": message_id, "success": False, "error": self.clean_error}
        return {"id": message_id, "success": True}

    async def get(self, path: str) -> tuple[int, bytes]:
        body = self.served.get(path)
        return (200, body) if body is not None else (404, b"")

    async def wait_until_running(self) -> str:
        return "2026.10.4"


def _statuses(receipt: dict[str, Any]) -> dict[str, str]:
    return {step["name"]: step["status"] for step in receipt["steps"]}


async def test_full_run_installs_checks_and_runs_the_physical_steps(
    tmp_path: Path,
) -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)
    ha.robot_states = ["docked", "docked", "cleaning", "docked", "returning", "docked"]
    prompts: list[str] = []

    def confirm(prompt: str) -> str:
        prompts.append(prompt)
        return "Kitchen"

    check = InstalledCheck(ha, candidate, Options(room="Kitchen", confirm=confirm))  # type: ignore[arg-type]
    receipt = await check.run()
    written = json.loads(receipt.write(tmp_path).read_text())
    assert written["result"] == "passed"
    assert written["candidate"]["tag"] == "v0.6.0b1"
    assert written["candidate"]["commit"] == "c" * 40
    assert _statuses(written) == {
        "backup": "passed",
        "install": "passed",
        "served_assets": "passed",
        "installed_files": "skipped",
        "entities": "passed",
        "actions": "passed",
        "assistant_tools": "skipped",
        "physical": "passed",
    }
    assert (
        "hacs/repository/download",
        {"repository": "42", "version": "v0.6.0b1"},
    ) in (ha.calls)
    assert ha.services_called() == [
        "homeassistant.restart",
        "matic_robot.clean",
        "vacuum.send_command",
    ]
    assert len(prompts) == 2


async def test_a_failed_step_stops_the_run(tmp_path: Path) -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)
    ha.version = "0.5.0"
    receipt = (
        await InstalledCheck(ha, candidate, Options(install=False)).run()  # type: ignore[arg-type]
    ).as_json()
    assert receipt["result"] == "failed"
    assert _statuses(receipt) == {
        "backup": "skipped",
        "install": "skipped",
        "served_assets": "failed",
    }
    assert "loaded manifest is 0.5.0" in receipt["steps"][-1]["error"]


async def test_stale_served_assets_fail() -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)
    ha.served.popitem()
    receipt = (
        await InstalledCheck(ha, candidate, Options(install=False)).run()
    ).as_json()  # type: ignore[arg-type]
    assert "answered 404" in receipt["steps"][-1]["error"]


async def test_an_unencrypted_backup_stops_before_install() -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)
    ha.protected = False
    receipt = (await InstalledCheck(ha, candidate, Options()).run()).as_json()  # type: ignore[arg-type]
    assert _statuses(receipt) == {"backup": "failed"}
    assert not ha.services_called()


async def test_physical_steps_need_the_owner_to_type_the_room() -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)
    options = Options(install=False, room="Kitchen", confirm=lambda _: "yes")
    receipt = (await InstalledCheck(ha, candidate, options).run()).as_json()  # type: ignore[arg-type]
    assert (
        receipt["steps"][-1]["error"] == "the owner did not confirm; nothing was sent"
    )
    assert not ha.services_called()


async def test_physical_steps_need_a_docked_robot() -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)
    ha.robot_states = ["docked", "cleaning"]
    options = Options(install=False, room="Kitchen", confirm=lambda _: "Kitchen")
    receipt = (await InstalledCheck(ha, candidate, options).run()).as_json()  # type: ignore[arg-type]
    assert receipt["steps"][-1]["error"] == "the robot is not docked"
    assert not ha.services_called()


async def test_installed_files_are_hashed_over_ssh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate = _candidate()
    listing = "".join(
        f"{digest}  ./{path}\n" for path, digest in candidate.files.items()
    )
    commands: list[list[str]] = []

    class Process:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return listing.encode(), b""

    async def run(*command: str, **_: Any) -> Process:
        commands.append(list(command))
        return Process()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", run)
    ha = FakeHomeAssistant(candidate)
    receipt = (
        await InstalledCheck(ha, candidate, Options(install=False, ssh="ha")).run()  # type: ignore[arg-type]
    ).as_json()
    assert _statuses(receipt)["installed_files"] == "passed"
    assert commands[0][:2] == ["ssh", "ha"]


FAKE_MCP = """
import json, sys
for line in sys.stdin:
    message = json.loads(line)
    if "id" not in message:
        continue
    method = message["method"]
    if method == "initialize":
        result = {"protocolVersion": "2025-06-18", "capabilities": {}}
    elif method == "tools/list":
        result = {"tools": [{"name": name} for name in sys.argv[1:]]}
    else:
        name = message["params"]["name"]
        result = {"content": [], "isError": name == "matic_get_firmware"}
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}))
    sys.stdout.flush()
"""


async def test_assistant_tools_are_called_through_the_mcp_bridge(
    tmp_path: Path,
) -> None:
    server = tmp_path / "server.py"
    server.write_text(FAKE_MCP)
    command = [sys.executable, str(server), *ASSISTANT_TOOLS]
    results = await call_mcp_tools(command, ASSISTANT_TOOLS)
    assert results == {name: name != "matic_get_firmware" for name in ASSISTANT_TOOLS}
    with pytest.raises(CheckFailed, match="does not list"):
        await call_mcp_tools([sys.executable, str(server), "other"], ASSISTANT_TOOLS)


async def test_silent_mcp_server_times_out_and_is_reaped(tmp_path: Path) -> None:
    server = tmp_path / "silent.py"
    pid_file = tmp_path / "pid"
    server.write_text(
        "import os, pathlib, sys, time\n"
        f"pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
        "time.sleep(30)\n"
    )
    with patch("scripts.installed_check.MCP_REQUEST_TIMEOUT", 0.05):
        with pytest.raises(CheckFailed, match="timed out during initialize"):
            await call_mcp_tools([sys.executable, str(server)], ASSISTANT_TOOLS)
    with pytest.raises(ProcessLookupError):
        os.kill(int(pid_file.read_text()), 0)


async def test_client_authenticates_and_matches_replies_by_id(
    socket_enabled: None,
) -> None:
    async def websocket(request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse()
        await socket.prepare(request)
        await socket.send_json({"type": "auth_required"})
        auth = await socket.receive_json()
        ok = auth["access_token"] == "token"
        await socket.send_json({"type": "auth_ok" if ok else "auth_invalid"})
        async for message in socket:
            if message.type is not WSMsgType.TEXT:
                break
            command = json.loads(message.data)
            if command["type"] == "subscribe":
                await socket.send_json(
                    {"id": command["id"], "type": "result", "success": True}
                )
                await socket.send_json(
                    {"id": command["id"], "type": "event", "event": 1}
                )
            elif command["type"] == "fails":
                await socket.send_json(
                    {
                        "id": command["id"],
                        "type": "result",
                        "success": False,
                        "error": "no",
                    }
                )
            else:
                await socket.send_json(
                    {
                        "id": command["id"],
                        "type": "result",
                        "success": True,
                        "result": {"state": "RUNNING", "version": "2026.10.4"},
                    }
                )
        return socket

    async def asset(_: web.Request) -> web.Response:
        return web.Response(body=b"icons")

    app = web.Application()
    app.router.add_get("/api/websocket", websocket)
    app.router.add_get("/asset.js", asset)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
    url = f"http://127.0.0.1:{port}"
    import aiohttp

    try:
        async with aiohttp.ClientSession() as session:
            ha = HomeAssistant(session, url, "token")
            await ha.connect()
            events = await ha.send("subscribe")
            assert (await ha.call("get_config"))["state"] == "RUNNING"
            assert ha.reply_if_ready(events) == {
                "id": events,
                "type": "result",
                "success": True,
            }
            assert ha.reply_if_ready(events) == {
                "id": events,
                "type": "event",
                "event": 1,
            }
            assert ha.reply_if_ready(events) is None
            await ha.send("subscribe")
            assert (await ha.receive(events + 2))["type"] == "result"
            with pytest.raises(CheckFailed, match="fails failed"):
                await ha.call("fails")
            assert await ha.get("/asset.js") == (200, b"icons")
            ha.poll_interval = 0
            assert await ha.wait_until_running() == "2026.10.4"
            await ha.close()
            with pytest.raises(CheckFailed, match="refused"):
                await HomeAssistant(session, url, "wrong").connect()
    finally:
        await runner.cleanup()


async def test_a_stalled_backup_event_fails_and_writes_a_partial_receipt(
    socket_enabled: None, tmp_path: Path
) -> None:
    async def websocket(request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse()
        await socket.prepare(request)
        await socket.send_json({"type": "auth_required"})
        await socket.receive_json()
        await socket.send_json({"type": "auth_ok"})
        async for message in socket:
            command = json.loads(message.data)
            kind = command["type"]
            result: Any = {"version": "2026.10.4", "state": "RUNNING"}
            if kind == "backup/info":
                result = {"backups": []}
            if kind == "backup/subscribe_events":
                result = None
            await socket.send_json(
                {
                    "id": command["id"],
                    "type": "result",
                    "success": True,
                    "result": result,
                }
            )
        return socket

    app = web.Application()
    app.router.add_get("/api/websocket", websocket)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
    import aiohttp

    try:
        async with aiohttp.ClientSession() as session:
            ha = HomeAssistant(session, f"http://127.0.0.1:{port}", "token")
            ha.request_timeout = 0.05
            await ha.connect()
            check = InstalledCheck(ha, _candidate(), Options())
            check.backup_timeout = 0.05
            receipt = await check.run()
            await ha.close()
        written = json.loads(receipt.write(tmp_path).read_text())
        assert written["result"] == "failed"
        assert written["steps"][-1]["name"] == "backup"
        assert "backup did not complete in time" in written["steps"][-1]["error"]
    finally:
        await runner.cleanup()


async def test_backup_event_wait_uses_backup_deadline_not_request_timeout(
    socket_enabled: None,
) -> None:
    backup = {
        "backup_id": "b1",
        "name": "Automatic backup",
        "agents": {"hassio.local": {"protected": True}},
        "database_included": True,
    }
    backup_count = 0

    async def websocket(request: web.Request) -> web.WebSocketResponse:
        nonlocal backup_count
        socket = web.WebSocketResponse()
        await socket.prepare(request)
        await socket.send_json({"type": "auth_required"})
        await socket.receive_json()
        await socket.send_json({"type": "auth_ok"})
        async for message in socket:
            command = json.loads(message.data)
            kind = command["type"]
            result: Any = None
            if kind == "backup/info":
                result = {"backups": [] if backup_count == 0 else [backup]}
                backup_count += 1
            await socket.send_json(
                {
                    "id": command["id"],
                    "type": "result",
                    "success": True,
                    "result": result,
                }
            )
            if kind == "backup/generate_with_automatic_settings":

                async def finish_backup() -> None:
                    await asyncio.sleep(0.08)
                    await socket.send_json(
                        {
                            "id": 2,
                            "type": "event",
                            "event": {
                                "manager_state": "create_backup",
                                "state": "completed",
                            },
                        }
                    )

                await finish_backup()
        return socket

    app = web.Application()
    app.router.add_get("/api/websocket", websocket)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
    import aiohttp

    try:
        async with aiohttp.ClientSession() as session:
            ha = HomeAssistant(session, f"http://127.0.0.1:{port}", "token")
            ha.request_timeout = 0.02
            await ha.connect()
            check = InstalledCheck(ha, _candidate(), Options())
            check.backup_timeout = 0.5
            assert (await check.backup())["backup_id"] == "b1"
            await ha.close()
    finally:
        await runner.cleanup()


async def test_connect_failure_is_written_as_a_receipt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    candidate = _candidate()
    monkeypatch.setattr(
        Candidate,
        "from_git",
        classmethod(lambda cls, repo, tag: candidate),
    )

    async def fail_connect(self: HomeAssistant) -> None:
        raise CheckFailed("bad credentials")

    monkeypatch.setattr(HomeAssistant, "connect", fail_connect)
    monkeypatch.setenv("HA_TOKEN", "test-token")
    args = argparse.Namespace(
        repo=ROOT,
        tag=candidate.tag,
        token_file=None,
        skip_install=True,
        ssh=None,
        aspenos=None,
        room=None,
        physical=False,
        url="http://127.0.0.1:1",
        receipts=tmp_path,
    )

    assert await _main(args) == 1

    def read_receipts() -> list[str]:
        return [path.read_text() for path in tmp_path.glob("*.json")]

    files = await asyncio.to_thread(read_receipts)
    assert len(files) == 1
    receipt = json.loads(files[0])
    assert receipt["result"] == "failed"
    assert receipt["steps"] == [
        {
            "name": "connect",
            "status": "failed",
            "started": receipt["steps"][0]["started"],
            "finished": receipt["steps"][0]["finished"],
            "evidence": {},
            "error": "bad credentials",
        }
    ]


def test_physical_needs_a_room() -> None:
    with pytest.raises(SystemExit):
        main(["v0.6.0b1", "--url", "http://ha", "--receipts", "r", "--physical"])


async def test_a_failed_clean_action_fails_the_physical_step() -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)
    ha.clean_error = "rooms held"
    options = Options(install=False, room="Kitchen", confirm=lambda _: "Kitchen")
    check = InstalledCheck(ha, candidate, options)  # type: ignore[arg-type]
    receipt = (await check.run()).as_json()
    assert receipt["steps"][-1]["error"] == "the clean action failed: rooms held"
    assert ha.services_called() == ["matic_robot.clean"]


async def test_a_robot_that_never_leaves_the_dock_times_out() -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)
    options = Options(install=False, room="Kitchen", confirm=lambda _: "Kitchen")
    check = InstalledCheck(ha, candidate, options)  # type: ignore[arg-type]
    check.dock_timeout = 0.05
    receipt = (await check.run()).as_json()
    assert receipt["steps"][-1]["error"] == "the robot did not leave the dock in time"


async def test_an_unexpected_error_is_still_recorded(tmp_path: Path) -> None:
    candidate = _candidate()
    ha = FakeHomeAssistant(candidate)

    async def disconnected() -> tuple[int, bytes]:
        raise ConnectionResetError("socket closed")

    ha.get = lambda _: disconnected()  # type: ignore[method-assign]
    check = InstalledCheck(ha, candidate, Options(install=False))  # type: ignore[arg-type]
    receipt = await check.run()
    written = json.loads(receipt.write(tmp_path).read_text())
    assert written["result"] == "failed"
    assert written["steps"][-1] == {
        **written["steps"][-1],
        "name": "served_assets",
        "error": "ConnectionResetError('socket closed')",
    }


def test_receipts_with_the_same_timestamp_do_not_overwrite(tmp_path: Path) -> None:
    candidate = _candidate()
    receipt = Receipt(candidate)
    with patch("scripts.installed_check.datetime") as clock:
        clock.now.return_value = datetime(2026, 10, 30, 12, 0, 0, tzinfo=UTC)
        first = receipt.write(tmp_path)
        first_contents = first.read_text()
        second = receipt.write(tmp_path)

    assert first.name == f"{candidate.tag}-20261030T120000Z.json"
    assert second.name == f"{candidate.tag}-20261030T120000Z-1.json"
    assert first.read_text() == first_contents
    assert json.loads(second.read_text())["candidate"]["commit"] == candidate.commit
