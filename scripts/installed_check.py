#!/usr/bin/env python3
"""Install a release candidate on a Home Assistant host and record a receipt.

Run from the repository's virtual environment on a machine that can reach the
host. Each step is recorded in a JSON receipt bound to the candidate tag and
commit; the first failure stops the run. Physical steps run only with
``--physical`` and after the owner types the room name to confirm the robot
and home are ready. See docs/installed-check.md.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
from collections.abc import Awaitable, Callable, Mapping
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, cast

import aiohttp

DOMAIN = "matic_robot"
INTEGRATION = f"custom_components/{DOMAIN}"
REPOSITORY = "ProspectOre/matic-home-assistant"
RECEIPT_SCHEMA = 1
RESTART_TIMEOUT = 600.0
PHYSICAL_TIMEOUT = 3600.0
BACKUP_TIMEOUT = 600.0
HA_REQUEST_TIMEOUT = 60.0
MCP_REQUEST_TIMEOUT = 30.0
MCP_SHUTDOWN_TIMEOUT = 2.0
SSH_TIMEOUT = 60.0
ASSISTANT_TOOLS = (
    "matic_get_operations",
    "matic_get_plan",
    "matic_get_plan_readiness",
    "matic_get_native_history",
    "matic_get_recent_events",
    "matic_get_activity",
    "matic_get_firmware",
)


class CheckFailed(RuntimeError):
    """A step found the installed candidate different from what was expected."""


@dataclass(frozen=True)
class Candidate:
    """The files, actions and served assets at an immutable candidate commit."""

    tag: str | None
    commit: str
    version: str
    files: dict[str, str]
    services: frozenset[str]
    served: dict[str, bytes]

    @classmethod
    def from_git(cls, repo: Path, tag: str) -> Candidate:
        """Read the candidate from the local checkout's copy of the tag."""
        commit = _git(repo, "rev-parse", f"refs/tags/{tag}^{{commit}}").decode().strip()
        return cls._from_commit(repo, commit, tag)

    @classmethod
    def from_commit(cls, repo: Path, commit: str) -> Candidate:
        """Read an unpublished candidate by its full commit ID, without a tag."""
        if re.fullmatch(r"[0-9a-f]{40}", commit) is None:
            raise ValueError("the candidate needs a full lowercase commit ID")
        resolved = _git(repo, "rev-parse", "--verify", f"{commit}^{{commit}}")
        if resolved.decode().strip() != commit:
            raise ValueError("the candidate ID must identify a commit")
        return cls._from_commit(repo, commit, None)

    @classmethod
    def _from_commit(cls, repo: Path, commit: str, tag: str | None) -> Candidate:
        archive = _git(repo, "archive", "--format=tar", commit, INTEGRATION)
        blobs: dict[str, bytes] = {}
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for member in tar.getmembers():
                if member.isfile() and (handle := tar.extractfile(member)):
                    path = PurePosixPath(member.name).relative_to(INTEGRATION)
                    blobs[path.as_posix()] = handle.read()
        return cls.from_blobs(tag, commit, blobs)

    @classmethod
    def from_blobs(
        cls, tag: str | None, commit: str, blobs: Mapping[str, bytes]
    ) -> Candidate:
        """Build the candidate from the integration's files at the tag."""
        version = json.loads(blobs["manifest.json"])["version"]
        services = re.findall(
            r"^([a-z_]+):", blobs["services.yaml"].decode(), re.MULTILINE
        )
        return cls(
            tag=tag,
            commit=commit,
            version=version,
            files={path: _sha256(data) for path, data in blobs.items()},
            services=frozenset(services),
            served=served_assets(version, blobs),
        )


def served_assets(version: str, blobs: Mapping[str, bytes]) -> dict[str, bytes]:
    """Return the content-addressed URLs the frontend serves for these files.

    The URL roots repeat the hashing in frontend.py, so a running Home
    Assistant only answers them when it loaded exactly these files.
    """
    icons = blobs["matic_icons.js"]
    studio = hashlib.sha256()
    prefix = "map_studio_v4/"
    for path in sorted(name for name in blobs if name.startswith(prefix)):
        studio.update(path.removeprefix(prefix).encode())
        studio.update(b"\0")
        studio.update(blobs[path])
        studio.update(b"\0")
    root = f"/{DOMAIN}/{version}-{studio.hexdigest()[:12]}/map-studio-v4"
    return {
        f"/{DOMAIN}/{version}-{_sha256(icons)[:12]}/icons.js": icons,
        f"{root}/index.js": blobs[f"{prefix}index.js"],
    }


def compare_files(expected: Mapping[str, str], installed: Mapping[str, str]) -> None:
    """Raise unless the installed files are exactly the candidate's."""
    missing = sorted(expected.keys() - installed.keys())
    extra = sorted(installed.keys() - expected.keys())
    changed = sorted(
        path
        for path in expected.keys() & installed.keys()
        if expected[path] != installed[path]
    )
    if missing or extra or changed:
        raise CheckFailed(
            f"installed files differ: missing {missing}, extra {extra}, "
            f"changed {changed}"
        )


def parse_sha256sum(output: str) -> dict[str, str]:
    """Parse ``sha256sum`` lines run from inside the integration directory."""
    hashes: dict[str, str] = {}
    for line in output.splitlines():
        digest, _, path = line.partition("  ")
        hashes[path.removeprefix("./")] = digest
    return hashes


@dataclass
class Step:
    """One recorded step of the check."""

    name: str
    status: str
    started: str
    finished: str
    evidence: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@dataclass
class Receipt:
    """Everything the run observed, bound to the candidate."""

    candidate: Candidate
    started: str = field(default_factory=lambda: _now())
    steps: list[Step] = field(default_factory=list)
    home_assistant: str | None = None

    def as_json(self) -> dict[str, Any]:
        """Return the receipt as written to the ledger."""
        failed = any(step.status == "failed" for step in self.steps)
        return {
            "schema_version": RECEIPT_SCHEMA,
            "candidate": {
                "tag": self.candidate.tag,
                "commit": self.candidate.commit,
                "version": self.candidate.version,
                "files": len(self.candidate.files),
            },
            "home_assistant": self.home_assistant,
            "started": self.started,
            "finished": _now(),
            "result": "failed" if failed else "passed",
            "steps": [step.__dict__ for step in self.steps],
        }

    def write(self, directory: Path) -> Path:
        """Write the receipt next to earlier ones and return its path."""
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        contents = json.dumps(self.as_json(), indent=2) + "\n"
        suffix = 0
        while True:
            collision = f"-{suffix}" if suffix else ""
            label = self.candidate.tag or self.candidate.commit
            path = directory / f"{label}-{stamp}{collision}.json"
            try:
                with path.open("x", encoding="utf-8") as receipt_file:
                    receipt_file.write(contents)
            except FileExistsError:
                suffix += 1
            else:
                return path


class HomeAssistant:
    """A small WebSocket and HTTP client for one Home Assistant instance."""

    restart_timeout = RESTART_TIMEOUT
    poll_interval = 5.0
    request_timeout = HA_REQUEST_TIMEOUT

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str) -> None:
        self._session = session
        self._url = url.rstrip("/")
        self._token = token
        self._socket: aiohttp.ClientWebSocketResponse | None = None
        self._next_id = 0
        self._pending: dict[int, list[dict[str, Any]]] = {}

    async def connect(self) -> None:
        """Open and authenticate the WebSocket."""
        try:
            async with asyncio.timeout(self.request_timeout):
                socket = await self._session.ws_connect(f"{self._url}/api/websocket")
        except TimeoutError:
            raise CheckFailed(
                "Home Assistant did not accept a connection in time"
            ) from None
        self._socket = socket
        if (await self._receive_json(socket))["type"] != "auth_required":
            raise CheckFailed("Home Assistant did not ask for authentication")
        await socket.send_json({"type": "auth", "access_token": self._token})
        if (reply := await self._receive_json(socket))["type"] != "auth_ok":
            raise CheckFailed(f"Home Assistant refused the token: {reply['type']}")

    async def _receive_json(
        self,
        socket: aiohttp.ClientWebSocketResponse,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        timeout = self.request_timeout if timeout_seconds is None else timeout_seconds
        try:
            async with asyncio.timeout(timeout):
                return cast(dict[str, Any], await socket.receive_json())
        except TimeoutError:
            raise CheckFailed("Home Assistant did not reply in time") from None

    async def close(self) -> None:
        """Close the WebSocket if it is open."""
        if self._socket is not None:
            await self._socket.close()
            self._socket = None
            self._pending.clear()

    async def send(self, message_type: str, **data: Any) -> int:
        """Send one command and return its id."""
        if self._socket is None:
            raise CheckFailed("not connected to Home Assistant")
        self._next_id += 1
        await self._socket.send_json(
            {"id": self._next_id, "type": message_type, **data}
        )
        return self._next_id

    async def receive(
        self, message_id: int, *, timeout_seconds: float | None = None
    ) -> dict[str, Any]:
        """Return the next message for one command id."""
        assert self._socket is not None
        if queued := self._pending.get(message_id):
            return queued.pop(0)
        timeout = self.request_timeout if timeout_seconds is None else timeout_seconds
        deadline = asyncio.get_running_loop().time() + timeout
        try:
            async with asyncio.timeout(timeout):
                while True:
                    remaining = deadline - asyncio.get_running_loop().time()
                    message = await self._receive_json(
                        self._socket, timeout_seconds=remaining
                    )
                    if message.get("id") == message_id:
                        return message
                    self._pending.setdefault(message["id"], []).append(message)
        except TimeoutError:
            raise CheckFailed(
                f"Home Assistant did not reply to message {message_id} in time"
            ) from None

    def reply_if_ready(self, message_id: int) -> dict[str, Any] | None:
        """Return a reply that already arrived for one command id, if any."""
        if queued := self._pending.get(message_id):
            return queued.pop(0)
        return None

    async def call(self, message_type: str, **data: Any) -> Any:
        """Send one command and return its result."""
        try:
            async with asyncio.timeout(self.request_timeout):
                reply = await self.receive(await self.send(message_type, **data))
        except TimeoutError:
            raise CheckFailed(
                f"Home Assistant timed out during {message_type}"
            ) from None
        if not reply.get("success", True):
            raise CheckFailed(f"{message_type} failed: {reply.get('error')}")
        return reply.get("result")

    async def get(self, path: str) -> tuple[int, bytes]:
        """Fetch one served path."""
        try:
            async with asyncio.timeout(self.request_timeout):
                async with self._session.get(f"{self._url}{path}") as response:
                    return response.status, await response.read()
        except TimeoutError:
            raise CheckFailed(f"Home Assistant did not serve {path} in time") from None

    async def wait_until_running(self) -> str:
        """Reconnect after a restart and return the running version."""
        try:
            async with asyncio.timeout(self.restart_timeout):
                while True:
                    try:
                        await self.close()
                        await self.connect()
                        config = await self.call("get_config")
                        if config["state"] == "RUNNING":
                            return str(config["version"])
                    except aiohttp.ClientError, CheckFailed, OSError:
                        pass
                    await asyncio.sleep(self.poll_interval)
        except TimeoutError:
            raise CheckFailed(
                "Home Assistant did not come back after restart"
            ) from None


@dataclass
class Options:
    """What the operator asked the run to do."""

    install: bool = True
    ssh: str | None = None
    aspenos: list[str] | None = None
    room: str | None = None
    confirm: Callable[[str], str] = input


class InstalledCheck:
    """Runs the steps in order and records each one."""

    dock_timeout = PHYSICAL_TIMEOUT
    backup_timeout = BACKUP_TIMEOUT

    def __init__(
        self, ha: HomeAssistant, candidate: Candidate, options: Options
    ) -> None:
        self.ha = ha
        self.candidate = candidate
        self.options = options
        self.receipt = Receipt(candidate)
        self.robot: str | None = None

    async def run(self) -> Receipt:
        """Run every step, stopping at the first failure."""
        steps: list[tuple[str, Callable[[], Awaitable[dict[str, Any]]] | None]] = [
            ("backup", self.backup if self.options.install else None),
            ("install", self.install if self.options.install else None),
            ("served_assets", self.served_assets),
            ("installed_files", self.installed_files if self.options.ssh else None),
            ("entities", self.entities),
            ("actions", self.actions),
            ("assistant_tools", self.assistant_tools if self.options.aspenos else None),
            ("physical", self.physical if self.options.room else None),
        ]
        started = _now()
        try:
            self.receipt.home_assistant = (await self.ha.call("get_config"))["version"]
        except asyncio.CancelledError:
            self.receipt.steps.append(
                Step("home_assistant", "failed", started, _now(), error="cancelled")
            )
            raise
        except Exception as err:
            error = str(err) if isinstance(err, CheckFailed) else repr(err)
            self.receipt.steps.append(
                Step("home_assistant", "failed", started, _now(), error=error)
            )
            return self.receipt
        for name, step in steps:
            started = _now()
            if step is None:
                self.receipt.steps.append(Step(name, "skipped", started, started))
                continue
            try:
                evidence = await step()
            except asyncio.CancelledError:
                self.receipt.steps.append(
                    Step(name, "failed", started, _now(), error="cancelled")
                )
                raise
            except Exception as err:
                # Record any failure, so a receipt always shows where the run
                # stopped, even after the host was changed.
                error = str(err) if isinstance(err, CheckFailed) else repr(err)
                self.receipt.steps.append(
                    Step(name, "failed", started, _now(), error=error)
                )
                break
            self.receipt.steps.append(Step(name, "passed", started, _now(), evidence))
        return self.receipt

    async def backup(self) -> dict[str, Any]:
        """Take a fresh backup with the host's automatic, encrypted settings."""
        try:
            async with asyncio.timeout(self.backup_timeout):
                return await self._create_backup()
        except TimeoutError:
            raise CheckFailed("the backup did not complete in time") from None

    async def _create_backup(self) -> dict[str, Any]:
        """Create and verify one automatic encrypted backup."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.backup_timeout
        before = {item["backup_id"] for item in await self._backups()}
        events = await self.ha.send("backup/subscribe_events")
        await self.ha.call("backup/generate_with_automatic_settings")
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise TimeoutError
            event = (await self.ha.receive(events, timeout_seconds=remaining)).get(
                "event", {}
            )
            if event.get("manager_state") == "create_backup":
                if event.get("state") == "failed":
                    raise CheckFailed(f"backup failed: {event.get('reason')}")
                if event.get("state") == "completed":
                    break
        new = [
            item for item in await self._backups() if item["backup_id"] not in before
        ]
        if len(new) != 1:
            raise CheckFailed(f"expected one new backup, found {len(new)}")
        backup = new[0]
        agents = backup.get("agents", {})
        if not agents or not all(agent["protected"] for agent in agents.values()):
            raise CheckFailed("the new backup is not encrypted on every agent")
        return {
            "backup_id": backup["backup_id"],
            "name": backup["name"],
            "agents": sorted(agents),
            "database_included": backup.get("database_included"),
        }

    async def _backups(self) -> list[dict[str, Any]]:
        info = await self.ha.call("backup/info")
        return list(info["backups"])

    async def install(self) -> dict[str, Any]:
        """Download the tag through HACS and restart Home Assistant."""
        if self.candidate.tag is None:
            raise CheckFailed("an unpublished commit cannot be installed through HACS")
        repositories = await self.ha.call("hacs/repositories/list")
        matches = [
            repo
            for repo in repositories
            if str(repo.get("full_name", "")).lower() == REPOSITORY.lower()
        ]
        if len(matches) != 1:
            raise CheckFailed(f"HACS does not list {REPOSITORY}")
        await self.ha.call(
            "hacs/repository/download",
            repository=matches[0]["id"],
            version=self.candidate.tag,
        )
        await self.ha.call("call_service", domain="homeassistant", service="restart")
        version = await self.ha.wait_until_running()
        self.receipt.home_assistant = version
        return {"hacs_repository": matches[0]["id"], "restarted": True}

    async def served_assets(self) -> dict[str, Any]:
        """Check the running integration serves the candidate's frontend."""
        manifest = await self.ha.call("manifest/get", integration=DOMAIN)
        if manifest["version"] != self.candidate.version:
            raise CheckFailed(
                f"loaded manifest is {manifest['version']}, "
                f"expected {self.candidate.version}"
            )
        for path, expected in self.candidate.served.items():
            status, body = await self.ha.get(path)
            if status != 200 or body != expected:
                raise CheckFailed(f"{path} answered {status} with other bytes")
        return {
            "manifest_version": manifest["version"],
            "paths": sorted(self.candidate.served),
        }

    async def installed_files(self) -> dict[str, Any]:
        """Hash the installed files over SSH and compare them with the tag."""
        assert self.options.ssh is not None
        command = (
            f"cd /config/{INTEGRATION} && "
            "find . -type f ! -path '*/__pycache__/*' -exec sha256sum {} +"
        )
        process = await asyncio.create_subprocess_exec(
            "ssh",
            self.options.ssh,
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        completed = False
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), SSH_TIMEOUT)
            completed = True
        except TimeoutError:
            raise CheckFailed("ssh did not finish in time") from None
        finally:
            if not completed:
                cleanup = asyncio.create_task(_terminate_process(process))
                try:
                    await asyncio.shield(cleanup)
                except asyncio.CancelledError:
                    await cleanup
                    raise
        if process.returncode:
            raise CheckFailed(
                f"ssh exited {process.returncode}: {stderr.decode().strip()}"
            )
        compare_files(self.candidate.files, parse_sha256sum(stdout.decode()))
        return {"files": len(self.candidate.files)}

    async def entities(self) -> dict[str, Any]:
        """Check every enabled Matic entity has a state other than unavailable."""
        registry = await self.ha.call("config/entity_registry/list")
        enabled = [
            entry["entity_id"]
            for entry in registry
            if entry["platform"] == DOMAIN and entry["disabled_by"] is None
        ]
        vacuums = [entity for entity in enabled if entity.startswith("vacuum.")]
        if len(vacuums) != 1:
            raise CheckFailed(f"expected one Matic vacuum, found {len(vacuums)}")
        self.robot = vacuums[0]
        states = {
            state["entity_id"]: state["state"]
            for state in await self.ha.call("get_states")
        }
        missing = sorted(entity for entity in enabled if entity not in states)
        unavailable = sorted(
            entity for entity in enabled if states.get(entity) == "unavailable"
        )
        if missing or unavailable:
            raise CheckFailed(f"missing {missing}, unavailable {unavailable}")
        return {"enabled": len(enabled), "robot_state": states[self.robot]}

    async def actions(self) -> dict[str, Any]:
        """Check the registered actions match services.yaml at the tag."""
        services = await self.ha.call("get_services")
        registered = set(services.get(DOMAIN, {}))
        expected = self.candidate.services
        if registered != expected:
            raise CheckFailed(
                f"actions differ: missing {sorted(expected - registered)}, "
                f"extra {sorted(registered - expected)}"
            )
        return {"actions": len(registered)}

    async def assistant_tools(self) -> dict[str, Any]:
        """Call each read-only Matic tool through the home MCP bridge."""
        assert self.options.aspenos is not None
        results = await call_mcp_tools(self.options.aspenos, ASSISTANT_TOOLS)
        failed = sorted(name for name, ok in results.items() if not ok)
        if failed:
            raise CheckFailed(f"assistant tools failed: {failed}")
        return {"tools": sorted(results)}

    async def physical(self) -> dict[str, Any]:
        """Clean one room and make one sink trip under the owner's eye."""
        assert self.options.room is not None and self.robot is not None
        room = self.options.room
        if await self._robot_state() != "docked":
            raise CheckFailed("the robot is not docked")
        answer = self.options.confirm(
            f"The robot will vacuum {room} on Quick, then go to the sink.\n"
            f"Type {room} to confirm the robot and home are ready: "
        )
        if answer.strip() != room:
            raise CheckFailed("the owner did not confirm; nothing was sent")
        started = _now()
        await self._clean(
            {
                "rooms": [room],
                "cleaning_mode": "vacuum",
                "coverage_setting": "quick",
            }
        )
        cleaned = _now()
        await self.ha.call(
            "call_service",
            domain="vacuum",
            service="send_command",
            target={"entity_id": self.robot},
            service_data={"command": "sink_summon"},
        )
        self.options.confirm(
            "The robot is going to the sink. Refill it, send it home, then press "
            "Enter: "
        )
        await self._wait_for(lambda state: state == "docked", "dock")
        return {"room": room, "clean_started": started, "clean_docked": cleaned}

    async def _robot_state(self) -> str:
        assert self.robot is not None
        states = await self.ha.call("get_states")
        return next(
            state["state"] for state in states if state["entity_id"] == self.robot
        )

    async def _clean(self, service_data: dict[str, Any]) -> None:
        """Clean, watching the robot leave and return to the dock.

        The clean action can block for the whole run, so its reply is read
        whenever it arrives; a rejection fails the step at once.
        """
        assert self.robot is not None
        action = await self.ha.send(
            "call_service",
            domain=DOMAIN,
            service="clean",
            target={"entity_id": self.robot},
            service_data=service_data,
        )
        reply: dict[str, Any] | None = None
        left = False
        try:
            async with asyncio.timeout(self.dock_timeout):
                while True:
                    if reply is None and (reply := self.ha.reply_if_ready(action)):
                        if not reply.get("success", True):
                            raise CheckFailed(
                                f"the clean action failed: {reply.get('error')}"
                            )
                    if await self._robot_state() != "docked":
                        left = True
                    elif left and reply is not None:
                        return
                    await asyncio.sleep(self.ha.poll_interval)
        except TimeoutError:
            what = "dock" if left else "leave the dock"
            raise CheckFailed(f"the robot did not {what} in time") from None

    async def _wait_for(self, reached: Callable[[str], bool], what: str) -> None:
        try:
            async with asyncio.timeout(self.dock_timeout):
                while True:
                    if reached(await self._robot_state()):
                        return
                    await asyncio.sleep(self.ha.poll_interval)
        except TimeoutError:
            raise CheckFailed(f"the robot did not {what} in time") from None


async def call_mcp_tools(command: list[str], names: tuple[str, ...]) -> dict[str, bool]:
    """Call MCP tools that take no arguments over a bounded stdio server."""
    server = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )
    stdin = server.stdin
    stdout = server.stdout
    assert stdin is not None and stdout is not None

    async def request(method: str, params: dict[str, Any], message_id: int) -> Any:
        message = {
            "jsonrpc": "2.0",
            "id": message_id,
            "method": method,
            "params": params,
        }
        try:
            async with asyncio.timeout(MCP_REQUEST_TIMEOUT):
                stdin.write((json.dumps(message) + "\n").encode())
                await stdin.drain()
                while line := await stdout.readline():
                    reply = json.loads(line)
                    if reply.get("id") == message_id:
                        if "error" in reply:
                            raise CheckFailed(f"{method} failed: {reply['error']}")
                        return reply["result"]
        except TimeoutError:
            raise CheckFailed(f"MCP server timed out during {method}") from None
        raise CheckFailed("the MCP server closed its output")

    try:
        await request(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "matic-installed-check", "version": "1"},
            },
            1,
        )
        stdin.write(
            (
                json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"})
                + "\n"
            ).encode()
        )
        await stdin.drain()
        listed = {
            tool["name"] for tool in (await request("tools/list", {}, 2))["tools"]
        }
        if missing := sorted(set(names) - listed):
            raise CheckFailed(f"the MCP server does not list {missing}")
        results = {}
        for offset, name in enumerate(names, start=3):
            result = await request(
                "tools/call", {"name": name, "arguments": {}}, offset
            )
            results[name] = not result.get("isError", False)
        return results
    finally:
        cleanup = asyncio.create_task(_stop_mcp_server(server))
        try:
            await asyncio.shield(cleanup)
        except asyncio.CancelledError:
            await cleanup
            raise


async def _stop_mcp_server(server: asyncio.subprocess.Process) -> None:
    """Close the MCP pipe, then terminate and reap a server that stays open."""
    if server.stdin is not None and not server.stdin.is_closing():
        server.stdin.close()
        with suppress(BrokenPipeError, ConnectionResetError, TimeoutError):
            await asyncio.wait_for(server.stdin.wait_closed(), MCP_SHUTDOWN_TIMEOUT)
    await _terminate_process(server)


async def _terminate_process(process: asyncio.subprocess.Process) -> None:
    """Terminate a timed-out child and reap it, escalating if necessary."""
    if process.returncode is not None:
        return
    with suppress(ProcessLookupError):
        process.terminate()
    try:
        await asyncio.wait_for(process.wait(), MCP_SHUTDOWN_TIMEOUT)
    except TimeoutError:
        with suppress(ProcessLookupError):
            process.kill()
        await process.wait()


def _git(repo: Path, *args: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, check=True
    ).stdout


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


async def _main(args: argparse.Namespace) -> int:
    candidate = (
        Candidate.from_commit(args.repo, args.commit)
        if args.commit
        else Candidate.from_git(args.repo, args.tag)
    )
    receipt = Receipt(candidate)
    stage = "setup"
    cancelled = False
    try:
        token = (
            args.token_file.read_text().strip()
            if args.token_file
            else os.environ["HA_TOKEN"]
        )
        options = Options(
            install=not args.skip_install,
            ssh=args.ssh,
            aspenos=args.aspenos.split() if args.aspenos else None,
            room=args.room if args.physical else None,
        )
        async with aiohttp.ClientSession() as session:
            ha = HomeAssistant(session, args.url, token)
            try:
                stage = "connect"
                await ha.connect()
                stage = "check"
                check = InstalledCheck(ha, candidate, options)
                check.receipt = receipt
                receipt = await check.run()
            finally:
                try:
                    await ha.close()
                except Exception as err:
                    _record_failure(receipt, "close", err)
    except asyncio.CancelledError:
        cancelled = True
        if not receipt.steps or receipt.steps[-1].status != "failed":
            _record_failure(receipt, stage, "cancelled")
    except Exception as err:
        _record_failure(receipt, stage, err)
    path = receipt.write(args.receipts)
    summary = receipt.as_json()
    for step in summary["steps"]:
        print(f"{step['name']:16} {step['status']:8} {step['error'] or ''}")
    print(f"{summary['result']}: {path}")
    if cancelled:
        raise asyncio.CancelledError
    return 0 if summary["result"] == "passed" else 1


def _record_failure(receipt: Receipt, name: str, error: Exception | str) -> None:
    """Append a failed step so the receipt survives failures outside a step."""
    detail = (
        str(error)
        if isinstance(error, CheckFailed) or isinstance(error, str)
        else repr(error)
    )
    now = _now()
    receipt.steps.append(Step(name, "failed", now, now, error=detail))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "tag", nargs="?", help="release tag to install, for example v0.6.0b1"
    )
    parser.add_argument(
        "--commit", help="full unpublished commit ID to check with --skip-install"
    )
    parser.add_argument("--url", required=True, help="Home Assistant base URL")
    parser.add_argument(
        "--token-file", type=Path, help="long-lived token; else HA_TOKEN"
    )
    parser.add_argument(
        "--receipts", type=Path, required=True, help="private receipt directory"
    )
    parser.add_argument(
        "--repo", type=Path, default=Path(__file__).resolve().parents[1]
    )
    parser.add_argument(
        "--skip-install", action="store_true", help="check what is installed"
    )
    parser.add_argument("--ssh", help="SSH host for hashing the installed files")
    parser.add_argument(
        "--aspenos", help="command that starts the home MCP stdio bridge"
    )
    parser.add_argument(
        "--physical", action="store_true", help="run the physical steps"
    )
    parser.add_argument("--room", help="room for the physical clean")
    args = parser.parse_args(argv)
    if bool(args.tag) == bool(args.commit):
        parser.error("provide either a release tag or --commit")
    if args.commit and (
        not args.skip_install or re.fullmatch(r"[0-9a-f]{40}", args.commit) is None
    ):
        parser.error("--commit requires a full lowercase commit ID and --skip-install")
    if args.physical and not args.room:
        parser.error("--physical needs --room")
    return asyncio.run(_main(args))


if __name__ == "__main__":
    sys.exit(main())
