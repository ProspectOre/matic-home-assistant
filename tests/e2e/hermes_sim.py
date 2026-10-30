"""A simulated Matic robot that serves the local Hermes protocol.

The simulator speaks the same transport as the robot: TLS with a
``robot_server`` certificate, HTTP/2 and gRPC, with the ``Hermes``,
``HermesDiscoveryRPC`` and ``HermesAuth`` services. The integration's real
client connects to it unchanged; the only test substitution is the trust
anchor, which points at a CA generated for each simulator instead of Matic's.

Every value it serves is synthetic. Command payloads are compared against the
bytes captured from the official app, written out here rather than imported
from the integration's encoders, so an encoder regression fails the test
instead of agreeing with itself.

Results from this simulator are simulated evidence. They do not replace
installed or physical qualification.
"""

from __future__ import annotations

import asyncio
import datetime
import hashlib
import ssl
import time
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from secrets import token_bytes
from typing import Any
from uuid import uuid4

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID, ObjectIdentifier
from grpclib.const import Status
from grpclib.exceptions import GRPCError
from grpclib.server import Server, Stream

from custom_components.matic_robot.client.auth import (
    AUTHORIZATION_KEY,
    HermesCredential,
)
from custom_components.matic_robot.client.proto.hermes_auth_grpc import HermesAuthBase
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import (
    BotToken,
    TokenRequest,
)
from custom_components.matic_robot.client.proto.hermes_bot_info_grpc import (
    HermesDiscoveryRPCBase,
)
from custom_components.matic_robot.client.proto.hermes_bot_info_pb2 import (
    BotInformation,
)
from custom_components.matic_robot.client.proto.hermes_grpc import HermesBase
from custom_components.matic_robot.client.proto.hermes_pb2 import (
    ChannelResponse,
    CollectionResponse,
    KabukiOutputWire,
    SequenceId,
    Unit,
    Value,
)

from .sim_mission import (
    IDLE_SESSION_KEY,
    CoverageSession,
    SimFloor,
    bytes_field,
    earlier_session,
    map_pages,
    parse_coverage_command,
    uuid_wire,
)

ROLE_OID = ObjectIdentifier("2.5.4.72")

# Official-app payloads for the ``user_command`` channel, from captures.
STOP_PAYLOAD = bytes.fromhex("7a040a022200")
PAUSE_PAYLOAD = bytes.fromhex("4801880101")
RESUME_PAYLOAD = bytes.fromhex("4801880100")
DOCK_PAYLOAD = bytes.fromhex("12042a020800")


class Phase(StrEnum):
    """Physical phase of the simulated robot."""

    DOCKED = "docked"
    CHARGING = "charging"
    CLEANING = "cleaning"
    PAUSED = "paused"
    RETURNING = "returning"
    STOPPED = "stopped"
    RECHARGING = "recharging"
    FAULTED = "faulted"


# ``kabuki_state`` codes per phase, copied from the live-verified transitions
# in tests/test_hermes_state.py, including codes the integration does not
# interpret. Plain charging (107 alone) is the one set not seen live.
_PHASE_STATES: dict[Phase, tuple[int, ...]] = {
    Phase.DOCKED: (106,),
    Phase.CHARGING: (107,),
    Phase.CLEANING: (101, 119, 209, 212),
    Phase.PAUSED: (109, 200, 119),
    Phase.RETURNING: (104, 105),
    Phase.STOPPED: (),
    # Low-charge recharge and resume: the task is retained on the dock.
    Phase.RECHARGING: (107, 119, 206),
    # A blocking fault: paused without the task flag, with an error code.
    Phase.FAULTED: (109, 200),
}


def _bytes_field(number: int, value: bytes) -> bytes:
    tag = (number << 3) | 2
    return _varint(tag) + _varint(len(value)) + value


def _varint(value: int) -> bytes:
    result = bytearray()
    while value > 0x7F:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value)
    return bytes(result)


@dataclass(frozen=True, slots=True)
class ReceivedCommand:
    """One channel write as the simulated robot received it."""

    channel: str
    payload: bytes
    target: str | None
    authorized: bool


@dataclass(slots=True)
class RobotCertificate:
    """A generated CA and ``robot_server`` leaf for one simulator."""

    ca_pem: bytes
    leaf_pem: bytes
    key_pem: bytes
    leaf_der: bytes

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(self.leaf_der).hexdigest()


def make_robot_certificate(
    *, hostname: str, serial_number: str, role: str = "robot_server"
) -> RobotCertificate:
    """Issue a robot certificate shaped like Matic's DirectoryName SAN."""
    now = datetime.datetime.now(datetime.UTC)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Simulated CA")])
    ca = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )
    leaf_key = ec.generate_private_key(ec.SECP256R1())
    directory_name = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, hostname),
            x509.NameAttribute(NameOID.SERIAL_NUMBER, serial_number),
            x509.NameAttribute(ROLE_OID, role),
        ]
    )
    leaf = (
        x509.CertificateBuilder()
        .subject_name(directory_name)
        .issuer_name(ca_name)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.DirectoryName(directory_name)]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    return RobotCertificate(
        ca_pem=ca.public_bytes(serialization.Encoding.PEM),
        leaf_pem=leaf.public_bytes(serialization.Encoding.PEM),
        key_pem=leaf_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
        leaf_der=leaf.public_bytes(serialization.Encoding.DER),
    )


class SimulatedRobot:
    """State and protocol behavior of one simulated robot.

    Time does not advance on its own. Tests move the robot between phases with
    the scripted methods, so every scenario is deterministic.
    """

    def __init__(
        self,
        *,
        name: str = "Simulated Matic",
        hostname: str = "matic-sim.local",
        serial_number: str = "SIM0000001",
        software_version: str = "181.10",
        battery: float = 1.0,
    ) -> None:
        self.name = name
        self.hostname = hostname
        self.serial_number = serial_number
        self.software_version = software_version
        self.phase = Phase.DOCKED
        self.battery = battery
        self.errors: tuple[int, ...] = ()
        self.current_area: str | None = None
        self.pairing_open = False
        self.offline = False
        self.credentials: set[str] = set()
        self.commands: list[ReceivedCommand] = []
        self.reads: Counter[str] = Counter()
        self.floor: SimFloor | None = None
        self.session: CoverageSession | None = None
        self.unsupported: set[str] = set()
        self._properties: dict[str, bytes] = {}
        self._collections: dict[str, list[tuple[bytes, bytes]]] = {}
        self._versions: dict[str, int] = {}
        self._changed = asyncio.Condition()
        self._start_ts = 1_700_000_000_000_000_000
        self._sequence = 0
        self._history: list[tuple[bytes, bytes]] = []
        self.set_property("active_session_key", IDLE_SESSION_KEY)
        self._refresh_state()

    # Scripted transitions -------------------------------------------------

    def start_cleaning(self, area: str | None = None) -> None:
        """Begin a task as if the app, a schedule or a voice cue started it."""
        self.current_area = area
        self._set_phase(Phase.CLEANING)

    def set_floor(self, floor: SimFloor) -> None:
        """Map a floor: its room plan and live photographic and structural map."""
        self.floor = floor
        photo, structure = map_pages(floor)
        self.set_collection("map_compressed_rgb", photo)
        self.set_collection("map_integrated", structure)
        self._history = [earlier_session(floor, _now() - 86_400_000_000_000)]
        self.set_collection("coverage_session_history", self._history)
        self._refresh_plan()

    def finish_room(self) -> None:
        """Complete the session's current room and move on to the next."""
        assert self.session is not None
        current = self.session.current_room
        assert current is not None
        self.session.finished[current] = _now()
        upcoming = self.session.current_room
        self.current_area = (
            self.floor.room(upcoming).name
            if self.floor is not None and upcoming is not None
            else None
        )
        self._refresh_state()

    def finish_session(self) -> None:
        """End the task after its last room, write history, head home."""
        self._end_session(completed=True)
        self.current_area = None
        self._set_phase(Phase.RETURNING)

    def app_takes_over(self) -> None:
        """Replace the running task with one started from the Matic app."""
        assert self.session is not None and self.floor is not None
        session = self.session
        self.session = CoverageSession(
            session_wire=bytes_field(2, uuid_wire(uuid4())),
            mission_wire=session.mission_wire,
            goals=[],
            rooms=list(session.rooms),
            modes=session.modes,
            started_at=_now(),
        )
        self.set_property("active_session_key", self.session.active_key)
        self._refresh_plan()

    def arrive_at_dock(self) -> None:
        """Finish a return trip and start charging, or idle when full."""
        self.current_area = None
        self._set_phase(Phase.DOCKED if self.battery >= 1.0 else Phase.CHARGING)

    def low_charge_recharge(self, battery: float = 0.15) -> None:
        """Suspend the task on the dock until the battery recovers."""
        self.battery = battery
        self._set_phase(Phase.RECHARGING)

    def recharged(self) -> None:
        """Resume a recharge-suspended task."""
        self.battery = 0.8
        self._set_phase(Phase.CLEANING)

    def fault(self, code: int = 326) -> None:
        """Stop on a blocking robot error, keeping the native task."""
        self.errors = (code,)
        self._set_phase(Phase.FAULTED)

    def set_errors(self, *codes: int) -> None:
        """Report robot error codes in ``kabuki_state``."""
        self.errors = codes
        self._refresh_state()

    def set_battery(self, fraction: float) -> None:
        self.battery = fraction
        self._refresh_state()

    def set_property(self, name: str, value: bytes) -> None:
        """Serve or replace a Hermes property value."""
        self._properties[name] = value
        self._bump(name)

    def set_collection(self, name: str, entries: Iterable[tuple[bytes, bytes]]) -> None:
        """Serve or replace a Hermes collection."""
        self._collections[name] = list(entries)
        self._bump(name)

    def received(self, channel: str = "user_command") -> list[bytes]:
        """Return payloads written to one channel, oldest first."""
        return [
            command.payload for command in self.commands if command.channel == channel
        ]

    # Protocol behavior ----------------------------------------------------

    def kabuki_state(self) -> bytes:
        wire = KabukiOutputWire(
            states=_PHASE_STATES[self.phase],
            errors=self.errors,
            name=self.name,
            battery_fraction=self.battery,
        )
        extra = _bytes_field(4, self.software_version.encode())
        if self.current_area is not None:
            extra += _bytes_field(16, self.current_area.encode())
        return wire.SerializeToString() + extra

    def issue_credential(self, user_id: str) -> BotToken:
        if not self.pairing_open:
            raise GRPCError(Status.PERMISSION_DENIED, "pairing mode is off")
        token = BotToken(
            user=TokenRequest(user_id=user_id).SerializeToString(),
            hashed_token=token_bytes(32),
        )
        self.credentials.add(HermesCredential.from_message(token).bearer_header())
        return token

    def add_credential(self, user_id: str) -> HermesCredential:
        """Pair a client without opening the pairing window."""
        self.pairing_open = True
        try:
            return HermesCredential.from_message(self.issue_credential(user_id))
        finally:
            self.pairing_open = False
        self.offline = False

    def authorized(self, metadata: Any) -> bool:
        return metadata.get(AUTHORIZATION_KEY) in self.credentials

    def entries(self, name: str) -> list[tuple[bytes, bytes]] | None:
        if name in self.unsupported:
            return None
        if name in self._properties:
            return [(b"", self._properties[name])]
        return self._collections.get(name)

    def apply_command(self, channel: str, payload: bytes) -> None:
        if channel != "user_command":
            return
        coverage = parse_coverage_command(payload, _now())
        if coverage is not None:
            self._start_coverage(coverage)
            return
        if payload == PAUSE_PAYLOAD and self.phase is Phase.CLEANING:
            self._set_phase(Phase.PAUSED)
        elif payload == RESUME_PAYLOAD and self.phase is Phase.PAUSED:
            self._set_phase(Phase.CLEANING)
        elif payload == STOP_PAYLOAD and self.phase in (
            Phase.CLEANING,
            Phase.PAUSED,
            Phase.RETURNING,
        ):
            self._end_session(completed=False)
            self.current_area = None
            self._set_phase(Phase.STOPPED)
        elif payload == STOP_PAYLOAD and self.phase is Phase.RECHARGING:
            self._set_phase(Phase.CHARGING)
        elif payload == DOCK_PAYLOAD and self.phase is Phase.STOPPED:
            self._set_phase(Phase.RETURNING)

    def next_sequence(self) -> SequenceId:
        self._sequence += 1
        return SequenceId(start_ts_nanos=self._start_ts, sequence_no=self._sequence)

    def version(self, name: str) -> int:
        return self._versions.get(name, 0)

    async def wait_for_phase(self, phase: Phase) -> None:
        """Wait until commands or scripted steps move the robot to ``phase``."""
        async with self._changed:
            await self._changed.wait_for(lambda: self.phase is phase)

    async def wait_for_change(self, name: str, seen: int) -> None:
        async with self._changed:
            await self._changed.wait_for(lambda: self.version(name) != seen)

    def _start_coverage(self, coverage: CoverageSession) -> None:
        previous = self.session
        if previous is not None and previous.session_wire == coverage.session_wire:
            # An UPDATE keeps the task and its progress; only goals change.
            coverage.finished = previous.finished
            coverage.started_at = previous.started_at
        self.session = coverage
        self.set_property("active_session_key", coverage.active_key)
        self._refresh_plan()
        current = coverage.current_room
        self.current_area = (
            self.floor.room(current).name
            if self.floor is not None and current is not None
            else None
        )
        self._set_phase(Phase.CLEANING)

    def _end_session(self, *, completed: bool) -> None:
        session = self.session
        if session is None:
            return
        self.session = None
        if self.floor is not None:
            self._history.append(
                (
                    session.session_wire,
                    session.history_value(self.floor, _now(), completed=completed),
                )
            )
            self.set_collection("coverage_session_history", self._history)
        self.set_property("active_session_key", IDLE_SESSION_KEY)
        self._refresh_plan()

    def _refresh_plan(self) -> None:
        if self.floor is None:
            return
        retained = self.session.retained_goals() if self.session is not None else b""
        self.set_property("coverage_plan", self.floor.encode() + retained)

    def _set_phase(self, phase: Phase) -> None:
        self.phase = phase
        self._refresh_state()

    def _refresh_state(self) -> None:
        self.set_property("kabuki_state", self.kabuki_state())

    def _bump(self, name: str) -> None:
        self._versions[name] = self.version(name) + 1
        try:
            loop_running = asyncio.get_running_loop() is not None
        except RuntimeError:
            loop_running = False
        if loop_running:
            asyncio.get_running_loop().create_task(self._notify())

    async def _notify(self) -> None:
        async with self._changed:
            self._changed.notify_all()


def _now() -> int:
    """Wall-clock nanoseconds: history must fall between dispatch and now."""
    return time.time_ns()


def _require_auth(robot: SimulatedRobot, stream: Stream[Any, Any]) -> None:
    if not robot.authorized(stream.metadata):
        raise GRPCError(Status.UNAUTHENTICATED, "missing or unknown credential")


class _Hermes(HermesBase):
    def __init__(self, robot: SimulatedRobot) -> None:
        self._robot = robot

    async def Handshake(self, stream: Stream[Unit, Unit]) -> None:
        await stream.recv_message()
        _require_auth(self._robot, stream)
        await stream.send_message(Unit())

    async def FetchCollection(self, stream: Stream[Any, CollectionResponse]) -> None:
        if self._robot.offline:
            raise GRPCError(Status.UNAVAILABLE, "robot is offline")
        _require_auth(self._robot, stream)
        request = await stream.recv_message()
        if request is None or not request.HasField("initial_request"):
            raise GRPCError(Status.INVALID_ARGUMENT, "initial request required")
        name = request.initial_request.collection_name
        self._robot.reads[name] += 1
        if self._robot.entries(name) is None:
            raise GRPCError(Status.UNIMPLEMENTED, f"{name} is not served")
        # A snapshot reader half-closes after its initial request; a tracked
        # subscriber keeps the stream open and acknowledges every sequence id.
        tracking = True
        seen = -1
        while True:
            seen = self._robot.version(name)
            for key, value in self._robot.entries(name) or ():
                sequence = self._robot.next_sequence()
                await stream.send_message(
                    CollectionResponse(
                        key_bytes=key,
                        value=Value(value_bytes=value),
                        sequence_id=sequence,
                    )
                )
                if not tracking:
                    continue
                ack = await stream.recv_message()
                if ack is None:
                    tracking = False
                elif ack.sequence_id != sequence:
                    raise GRPCError(
                        Status.INVALID_ARGUMENT,
                        f"acknowledged {ack.sequence_id} instead of {sequence}",
                    )
            if not tracking:
                return
            await self._robot.wait_for_change(name, seen)

    async def SendToChannel(self, stream: Stream[Any, ChannelResponse]) -> None:
        authorized = self._robot.authorized(stream.metadata)
        target = stream.metadata.get("hermes-target")
        async for request in stream:
            self._robot.commands.append(
                ReceivedCommand(
                    request.channel_name, bytes(request.value), target, authorized
                )
            )
            if authorized:
                self._robot.apply_command(request.channel_name, bytes(request.value))
        if not authorized:
            raise GRPCError(Status.UNAUTHENTICATED, "missing or unknown credential")
        await stream.send_message(ChannelResponse())


class _Discovery(HermesDiscoveryRPCBase):
    def __init__(self, robot: SimulatedRobot, port: int) -> None:
        self._robot = robot
        self.port = port

    async def GetBotInfo(self, stream: Stream[Any, BotInformation]) -> None:
        await stream.recv_message()
        await stream.send_message(
            BotInformation(
                serial_number=self._robot.serial_number,
                name=self._robot.name,
                hostname=self._robot.hostname,
                port=self.port,
                ip4_address="127.0.0.1",
                encrypted=True,
                requires_auth=True,
                hardware_revision="sim",
            )
        )

    async def RequestRemoteToken(self, stream: Stream[Any, Any]) -> None:
        raise GRPCError(Status.UNIMPLEMENTED, "remote access is not simulated")


class _Auth(HermesAuthBase):
    def __init__(self, robot: SimulatedRobot) -> None:
        self._robot = robot

    async def AuthToken(self, stream: Stream[TokenRequest, BotToken]) -> None:
        request = await stream.recv_message()
        assert request is not None
        await stream.send_message(self._robot.issue_credential(request.user_id))


@dataclass(slots=True)
class RunningSimulator:
    """A started simulator and the values a config entry needs to reach it."""

    robot: SimulatedRobot
    certificate: RobotCertificate
    ca_path: Path
    host: str
    port: int
    _server: Server = field(repr=False)

    async def close(self) -> None:
        self._server.close()
        await self._server.wait_closed()


async def start_simulator(robot: SimulatedRobot, directory: Path) -> RunningSimulator:
    """Serve ``robot`` over TLS on a free loopback port."""
    certificate = make_robot_certificate(
        hostname=robot.hostname, serial_number=robot.serial_number
    )
    ca_path = directory / "sim-ca.pem"
    ca_path.write_bytes(certificate.ca_pem)
    chain_path = directory / "sim-robot.pem"
    chain_path.write_bytes(certificate.leaf_pem + certificate.key_pem)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(chain_path)
    context.set_alpn_protocols(["h2"])
    discovery = _Discovery(robot, 0)
    server = Server([_Hermes(robot), discovery, _Auth(robot)])
    await server.start("127.0.0.1", 0, ssl=context)
    sockets = server._server.sockets if server._server is not None else ()
    port = int(sockets[0].getsockname()[1])
    discovery.port = port
    return RunningSimulator(robot, certificate, ca_path, "127.0.0.1", port, server)
