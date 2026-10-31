"""Async client for the robot's local Hermes API."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import struct
from collections import Counter
from collections.abc import (
    AsyncGenerator,
    AsyncIterator,
    Awaitable,
    Callable,
    Sequence,
)
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import replace
from time import monotonic
from types import TracebackType
from typing import cast
from uuid import UUID, uuid4

from google.protobuf.message import DecodeError
from grpclib.client import Channel
from grpclib.const import Status
from grpclib.exceptions import GRPCError

from .auth import HermesCredential
from .commands import (
    CleaningMode,
    CoverageSetting,
    CoverageUpdateGoal,
    HermesConnectionKind,
    QueueAction,
    QueueChangeError,
    UserCommand,
    encode_coverage_command,
    encode_coverage_goal_update,
    encode_custom_coverage_command,
    encode_go_to_room_command,
    encode_mission_id,
    encode_mixed_coverage_commands,
    encode_redo_coverage_command,
    encode_sink_summon_command,
    encode_user_command,
    encode_user_data,
    queue_start_visit,
    requeue_coverage_goals,
)
from .coverage_goals import (
    CoveragePlanGoal,
    coverage_command_goal_signatures,
    coverage_plan_goal_signatures,
    coverage_plan_goals,
    coverage_plan_lacks_active_goals,
    coverage_readback_matches,
)
from .coverage_receipts import (
    CoverageReceipt,
    coverage_floor_hash,
    make_coverage_receipt,
    native_session_hash,
    receipt_matches_history,
    receipt_matches_plan,
)
from .endpoints import HERMES_ENDPOINT_MAP, HermesEndpointKind
from .exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    CoverageGuardError,
    CoverageGuardReason,
    EndpointUnsupportedError,
    MaticError,
    PairingModeRequiredError,
    SinkLocationUnavailableError,
)
from .floor_plan import decode_floor_plans, decode_pose, room_name_key
from .flythrough import Flythrough, decode_flythrough
from .history import (
    CleaningSessionImage,
    MonthlyCleaningRecap,
    decode_cleaning_session_image,
    decode_monthly_cleaning_recap,
)
from .mission import MissionClientState, decode_mission_client_state
from .models import (
    CleaningSessionRecord,
    FloorPlan,
    HermesCollectionEntry,
    RobotInfo,
    RobotOperationalState,
    RobotPose,
    RobotTelemetry,
    RobotTrajectory,
    Room,
    RunProgress,
)
from .observations import ActivityJournal, ObservationCallback
from .proto.hermes_auth_grpc import HermesAuthStub
from .proto.hermes_auth_pb2 import TokenRequest
from .proto.hermes_bot_info_grpc import HermesDiscoveryRPCStub
from .proto.hermes_bot_info_pb2 import Unit as DiscoveryUnit
from .proto.hermes_grpc import HermesStub
from .proto.hermes_pb2 import (
    ChannelRequest,
    CollectionRequest,
    InitialRequest,
    SubscriptionServiceConfig,
    Unit,
)
from .telemetry import (
    TELEMETRY_NESTED_MAX_BYTES,
    TELEMETRY_PROPERTIES,
    WIFI_STATUS_MAX_BYTES,
    decode_bag_pass,
    decode_binary_state,
    decode_cleaning_session,
    decode_coverage_time,
    decode_current_version,
    decode_deep_mop_state,
    decode_latest_maintenance,
    decode_operational_state,
    decode_pose_observation_time,
    decode_presence_state,
    decode_run_progress,
    decode_schedule,
    decode_text_field,
    decode_timezone,
    decode_update_state,
    decode_uploader_state,
    decode_water_flow_factor,
    decode_wifi_status,
    wifi_scan_block,
)
from .tls import async_robot_client_context
from .trajectory import decode_approximate_trajectory
from .transport import (
    TRANSPORT_ERRORS,
    BoundedStream,
    PinnedChannel,
    async_cancel_stream,
    async_connection_candidates,
    response_value_bytes,
)
from .wire import (
    decode_fields,
    uuid_string,
)
from .zones import MAX_ZONES, decode_zones

_LOGGER = logging.getLogger(__name__)

HERMES_TARGET_KEY = "hermes-target"
_RPC_TIMEOUT = 10.0
# Streamed collection reads have per-message timeouts; this caps the whole
# read so a slow-dripping stream cannot hold a poll cycle open for minutes.
_COLLECTION_TIMEOUT = 30.0
_COLLECTION_MAX_BYTES = 64 * 1024 * 1024
_LATEST_POSE_ENTRY_LIMIT = 64
_LATEST_POSE_VALUE_MAX_BYTES = 16 * 1024
_LATEST_POSE_READ_TIMEOUT = 3.0
_DISPLAYED_MISSION_LIMIT = 256
_WIFI_SCAN_RESULT_TIMEOUT_SECONDS = 8.0
_WIFI_SCAN_RESULT_INTERVAL_SECONDS = 1.0
# The scan reply arrives once the scan is done and wifi_status follows within
# about a quarter second, so an unchanged block after two reads is a repeat.
_WIFI_SCAN_SETTLE_READS = 2
# START readback includes undocking; mixed UPDATE readback begins once cleaning.
_COVERAGE_START_READBACK_TIMEOUT = 30.0
_MIXED_COVERAGE_READBACK_TIMEOUT = 8.0
_MIXED_COVERAGE_READBACK_INTERVAL = 0.5
_MIXED_READBACK_DELTA_LIMIT = 32
# The app's queue changes showed in the plan within about 10 to 20 seconds.
_QUEUE_READBACK_TIMEOUT = 45.0
_QUEUE_READBACK_INTERVAL = 2.0
_BINARY_SETTING_STATE_PROPERTIES = {
    "child_lock": "child_lock_enabled_state",
    "pet_waste": "petwaste_enabled_state",
    "voice": "voice_enabled_state",
}
_SETTING_READBACK_TIMEOUT_SECONDS = 8.0
_SETTING_READBACK_INTERVAL_SECONDS = 0.25


def _queue_start_index(plan: Sequence[CoveragePlanGoal], current_region: str) -> int:
    """Return the plan index where the current room's last visit begins."""
    visits: list[tuple[str, list[int]]] = []
    for index, goal in enumerate(plan):
        if visits and visits[-1][0] == goal.region_id:
            visits[-1][1].append(index)
        else:
            visits.append((goal.region_id, [index]))
    return visits[queue_start_visit(visits, current_region)][1][0]


def _region_order(goals: Sequence[CoverageUpdateGoal | CoveragePlanGoal]) -> list[str]:
    order: list[str] = []
    for goal in goals:
        if not order or order[-1] != goal.region_id:
            order.append(goal.region_id)
    return order


def _queue_readback_matches(
    sent: Sequence[CoverageUpdateGoal],
    held: Sequence[CoveragePlanGoal],
    *,
    dropped: set[str],
    expected_order: list[str],
) -> bool:
    """Match the plan after a queue change by round IDs, specs and room order.

    The robot lists a room's behaviors in its own order and may leave out the
    last floor mop behavior, so the check compares rooms, not goal positions.
    """
    held_rounds = {goal.round_id: goal.signature for goal in held}
    if dropped & held_rounds.keys():
        return False
    for goal in sent:
        signature = held_rounds.get(goal.round_id)
        if signature is None:
            if (goal.floor, goal.mode, goal.behavior) != (0, 1, 3):
                return False
            continue
        # Heavy Duty vacuum and double-pass mop read back as setting 3.
        region, setting, floor, mode, behavior = signature
        if (region, floor, mode, behavior) != (
            goal.region_id,
            goal.floor,
            goal.mode,
            goal.behavior,
        ) or (
            setting != goal.setting
            and (setting, goal.setting, mode)
            not in {
                (3, 0, 0),
                (3, 1, 1),
            }
        ):
            return False
    sent_rounds = {goal.round_id for goal in sent}
    return (
        _region_order([goal for goal in held if goal.round_id in sent_rounds])
        == expected_order
    )


def _log_mixed_readback_timeout(
    expected: Counter[tuple[str, int, int, int, int]],
    actual: Counter[tuple[str, int, int, int, int]] | None,
    *,
    stage: str,
    malformed: bool,
) -> None:
    """Describe bounded goal differences using attempt-local room ordinals."""
    if not _LOGGER.isEnabledFor(logging.DEBUG):
        return
    observed = actual if actual is not None else Counter()
    rooms: dict[str, int] = {}
    for region, *_ in (*expected, *observed):
        if region not in rooms:
            rooms[region] = len(rooms) + 1

    def delta(
        goals: Counter[tuple[str, int, int, int, int]],
    ) -> list[tuple[int, int, int, int, int, int]]:
        return [
            (rooms[region], setting, floor, mode, behavior, count)
            for (region, setting, floor, mode, behavior), count in list(goals.items())[
                :_MIXED_READBACK_DELTA_LIMIT
            ]
        ]

    missing = expected - observed
    unexpected = observed - expected
    _LOGGER.debug(
        "Mixed coverage readback timed out: stage=%s sample=%s "
        "expected_count=%s actual_count=%s "
        "missing=%s missing_omitted=%s unexpected=%s unexpected_omitted=%s; "
        "goal tuples=(room_ordinal, setting, floor, mode, behavior, count)",
        stage,
        "malformed" if malformed else "unobserved" if actual is None else "observed",
        expected.total(),
        actual.total() if actual is not None else None,
        delta(missing),
        max(0, len(missing) - _MIXED_READBACK_DELTA_LIMIT),
        delta(unexpected),
        max(0, len(unexpected) - _MIXED_READBACK_DELTA_LIMIT),
    )


def _floor_command_identity(floor: FloorPlan) -> tuple[object, ...]:
    """Identify the native floor/partition/room set bound to one command."""
    return (
        floor.mission_id,
        floor.partition_protocol_id,
        floor.partition_id_wire,
        frozenset((room.id, room.protocol_id, room.id_wire) for room in floor.rooms),
    )


_BINARY_SETTING_CHANNELS = {
    "child_lock": "child_lock_enabled_command",
    "pet_waste": "petwaste_enabled_command",
    "voice": "voice_enabled_command",
}


class MaticHermesClient(AbstractAsyncContextManager["MaticHermesClient"]):
    """Certificate-pinned client for a single Matic robot."""

    def __init__(
        self,
        host: str,
        port: int,
        *,
        hostname: str | None = None,
        serial_number: str | None = None,
        certificate_fingerprint: str | None = None,
        credential: HermesCredential | None = None,
        timezone_identifier: str = "UTC",
        seconds_from_gmt: int = 0,
        observation_callback: ObservationCallback | None = None,
    ) -> None:
        self._host = host
        self._port = port
        self._hostname = hostname
        self._serial_number = serial_number
        self._certificate_fingerprint = certificate_fingerprint
        self._credential = credential
        self._timezone_identifier = timezone_identifier
        self._seconds_from_gmt = seconds_from_gmt
        self._channel: Channel | None = None
        self._retired = False
        self._connect_lock = asyncio.Lock()
        self._endpoint_health: dict[str, str] = {}
        self._command_health: dict[str, str] = {}
        self.activity_journal = ActivityJournal(observation_callback)

    async def __aenter__(self) -> MaticHermesClient:
        await self.async_connect()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    async def async_connect(self) -> None:
        """Verify the pinned certificate, then open an HTTP/2 channel."""
        async with self._connect_lock:
            self._require_active()
            if self._channel is not None:
                return
            await self._async_connect_locked()

    async def _async_connect_locked(self) -> None:
        """Open and initialize one channel while holding the connection lock."""
        self._require_active()
        context = await async_robot_client_context()
        self._require_active()
        last_error: CannotConnectError | None = None
        for host in await async_connection_candidates(
            self._host, self._hostname, self._port
        ):
            self._require_active()
            channel = PinnedChannel(
                host,
                self._port,
                ssl=context,
                expected_hostname=self._hostname,
                expected_serial=self._serial_number,
                expected_fingerprint=self._certificate_fingerprint,
                is_retired=lambda: self._retired,
            )
            # Force the TLS handshake now so the pinned identity is enforced and
            # an unreachable candidate falls back to the next resolved address.
            # A pinning failure is a hard security error and is not caught here.
            try:
                async with asyncio.timeout(_RPC_TIMEOUT):
                    await channel.__connect__()
                self._require_active()
                self._host = host
                self._channel = channel
                break
            except TimeoutError:
                last_error = CannotConnectError("Hermes connection timed out")
                continue
            except TRANSPORT_ERRORS as err:
                last_error = CannotConnectError(str(err) or "connection failed")
                continue
            finally:
                # Ownership transfers only after a successful connect.
                if self._channel is not channel:
                    channel.close()
        else:
            raise last_error or CannotConnectError("No reachable robot address")
        try:
            await self._async_handshake()
            await self._async_send_user_data()
            self._require_active()
        except BaseException:
            # Never leave a half-initialized channel behind: closing it lets a
            # later async_connect() re-dial instead of silently no-opping.
            self.close()
            raise

    def _require_active(self) -> None:
        if self._retired:
            raise CannotConnectError("Hermes client has been retired")

    @property
    def retired(self) -> bool:
        """Whether this runtime has permanently revoked transport access."""
        return self._retired

    def retire(self) -> None:
        """Permanently revoke this runtime, including captured channel references."""
        self._retired = True
        self.close()

    async def async_shutdown(self) -> None:
        """Revoke this runtime and wait for any in-flight dial to settle."""
        self.retire()
        async with self._connect_lock:
            self.close()

    def close(self) -> None:
        """Close the active channel while allowing a later reconnect."""
        if self._channel is not None:
            self._channel.close()
            self._channel = None

    async def _async_reconnect_after_read_failure(
        self, failed_channel: Channel | None
    ) -> None:
        """Replace one failed read channel without racing concurrent readers."""
        async with self._connect_lock:
            self._require_active()
            # Another concurrent read may already have replaced the failed
            # channel. Reuse that fresh pinned session instead of closing it.
            if self._channel is not failed_channel and self._channel is not None:
                return
            self.close()
            await self._async_connect_locked()

    @asynccontextmanager
    async def _map_stream_errors(self, description: str) -> AsyncIterator[None]:
        """Map every transport failure onto the Matic error hierarchy.

        Besides ``TimeoutError`` and ``GRPCError`` this also catches the plain
        ``OSError``/``ConnectionResetError``, grpclib ``StreamTerminatedError``
        /``ProtocolError``, and raw ``h2`` protocol errors (live robots reset
        streams mid-conversation, observed as ``StreamClosedError``) so no raw
        transport exception escapes an RPC. Messages stay non-sensitive.
        """
        try:
            yield
        except TimeoutError as err:
            raise CannotConnectError(f"Hermes {description} timed out") from err
        except TRANSPORT_ERRORS as err:
            raise CannotConnectError(f"Hermes {description} connection failed") from err
        except GRPCError as err:
            if err.status is Status.UNAUTHENTICATED:
                raise AuthenticationRequiredError(err.message) from err
            if err.status in (Status.UNIMPLEMENTED, Status.NOT_FOUND):
                raise EndpointUnsupportedError(
                    f"Hermes {description} is not implemented by this firmware"
                ) from err
            raise CannotConnectError(err.message or err.status.name) from err

    async def async_get_info(self) -> RobotInfo:
        """Read identity and connection metadata from the robot."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        async with self._map_stream_errors("info"), asyncio.timeout(_RPC_TIMEOUT):
            response = await HermesDiscoveryRPCStub(channel).GetBotInfo(
                DiscoveryUnit(), metadata=self._metadata
            )
        return RobotInfo(
            serial_number=response.serial_number,
            name=response.name,
            hostname=response.hostname,
            port=response.port,
            ip4_address=response.ip4_address,
            ip6_address=response.ip6_address,
            encrypted=response.encrypted,
            requires_auth=response.requires_auth,
            network_auth=response.network_auth,
            hardware_revision=response.hardware_revision,
        )

    async def async_request_credential(self, user_id: str) -> HermesCredential:
        """Request a scoped credential during the robot's pairing window."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        try:
            async with asyncio.timeout(_RPC_TIMEOUT):
                response = await HermesAuthStub(channel).AuthToken(
                    TokenRequest(user_id=user_id)
                )
            credential = HermesCredential.from_message(response)
        except ValueError as err:
            raise CannotConnectError("Robot returned an incomplete credential") from err
        except TimeoutError as err:
            raise CannotConnectError("Hermes credential request timed out") from err
        except TRANSPORT_ERRORS as err:
            raise CannotConnectError(
                "Hermes credential request connection failed"
            ) from err
        except GRPCError as err:
            if err.status in {
                Status.UNAVAILABLE,
                Status.PERMISSION_DENIED,
                Status.UNAUTHENTICATED,
            }:
                raise PairingModeRequiredError(
                    "Enable pairing mode in the Matic app"
                ) from err
            raise CannotConnectError(err.message or err.status.name) from err
        self._credential = credential
        await self._async_handshake()
        await self._async_send_user_data()
        return credential

    async def _async_handshake(self) -> None:
        """Bind authenticated Hermes context to the active HTTP/2 channel."""
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        if self._credential is None:
            return
        async with self._map_stream_errors("handshake"), asyncio.timeout(_RPC_TIMEOUT):
            await HermesStub(channel).Handshake(Unit(), metadata=self._metadata)

    async def _async_send_user_data(self) -> None:
        """Identify this local app session."""
        if self._credential is None:
            return
        await self._async_send_channel_payload(
            "user_data",
            encode_user_data(
                # The token and application identity use the same persisted UUID.
                app_id=self._credential.app_id,
                timezone_identifier=self._timezone_identifier,
                seconds_from_gmt=self._seconds_from_gmt,
                connection_kind=HermesConnectionKind.IP,
            ),
        )

    async def async_get_state(self) -> RobotOperationalState:
        """Read one authenticated snapshot from the ``kabuki_state`` property."""
        # The robot closes an otherwise healthy long-lived HTTP/2 session about
        # once an hour. grpclib reports that closure on the next stream read;
        # replace the pinned channel and retry this idempotent snapshot once so
        # a routine transport rollover does not mark every HA entity unavailable.
        await self.async_connect()
        failed_channel = self._channel
        try:
            payload = await self.async_get_property("kabuki_state")
        except CannotConnectError:
            _LOGGER.debug("Retrying Hermes state read on a fresh pinned channel")
            await self._async_reconnect_after_read_failure(failed_channel)
            payload = await self.async_get_property("kabuki_state")

        try:
            state = decode_operational_state(payload)
            self.activity_journal.observe_state(state, "poll")
            return state
        except DecodeError as err:
            raise CannotConnectError("Hermes returned malformed robot state") from err

    async def async_get_run_progress(self) -> RunProgress | None:
        """Read elapsed and remaining time for the clean under way, if any."""
        return decode_run_progress(await self.async_get_property("coverage_time"))

    async def async_subscribe_state(self) -> AsyncIterator[RobotOperationalState]:
        """Yield live snapshots from the local ``kabuki_state`` property."""
        self.activity_journal.record("state_stream_started", source="push")
        try:
            async for entry in self.async_subscribe_collection_entries("kabuki_state"):
                try:
                    state = decode_operational_state(entry.value)
                    self.activity_journal.observe_state(state, "push")
                    yield state
                except DecodeError as err:
                    raise CannotConnectError(
                        "Hermes returned malformed subscribed robot state"
                    ) from err
        finally:
            self.activity_journal.record("state_stream_ended", source="push")

    async def async_get_floor_plan(
        self, *, expected_mission_id: int | None = None
    ) -> FloorPlan:
        """Read and decode the active local coverage plan."""
        try:
            payload = await self.async_get_property("coverage_plan")
            floor_plans = decode_floor_plans(payload)
            if len(floor_plans) == 1:
                return floor_plans[0]

            mission_entries = await self.async_get_tracked_collection_entries(
                "displayed_mission", limit=_DISPLAYED_MISSION_LIMIT
            )
            if len(mission_entries) >= _DISPLAYED_MISSION_LIMIT:
                raise DecodeError(
                    "displayed mission collection exceeds its snapshot bound"
                )
            mission_states: list[MissionClientState] = []
            for entry in mission_entries:
                try:
                    mission_states.append(decode_mission_client_state(entry.value))
                except DecodeError:
                    # ``displayed_mission`` is a heterogeneous collection. Only
                    # the exact verified MissionClientState shape is relevant.
                    continue
            if not mission_states:
                raise DecodeError(
                    "multi-floor coverage plan has no mission client state"
                )
            # Tracked collection delivery is the robot's authoritative order:
            # Hermes does not send the next cached or live record until the
            # prior sequence is acknowledged. The last decodable client state
            # therefore represents the currently displayed mission.
            mission_state = mission_states[-1]
            # An unfinished inactive map may have no coverage partition. Only
            # the verified selected floor must have exactly one usable plan.
            if expected_mission_id is None:
                active_floor = mission_state.active_floor
                if active_floor is None:
                    raise DecodeError(
                        "multi-floor coverage plan has no verified active floor"
                    )
            else:
                verified_floors = tuple(
                    floor
                    for floor in mission_state.mapped_floors
                    if floor.mission_id == expected_mission_id
                )
                if len(verified_floors) != 1:
                    raise DecodeError(
                        "verified map mission does not identify one canonical floor"
                    )
                active_floor = verified_floors[0]
            matching = tuple(
                plan
                for plan in floor_plans
                if plan.mission_id == active_floor.mission_id
            )
            if len(matching) != 1:
                raise DecodeError("active mission does not identify one coverage floor")
            return replace(
                matching[0],
                floor_label=active_floor.label,
                mapped_floors=mission_state.mapped_floors,
            )
        except DecodeError as err:
            raise CannotConnectError("Hermes returned a malformed floor plan") from err

    async def async_get_slam_tile_entry(self) -> HermesCollectionEntry:
        """Read the current local photorealistic SLAM tile."""
        entries = await self.async_get_collection_entries("map_compressed_rgb", limit=1)
        if not entries or not entries[0].key or not entries[0].value:
            raise CannotConnectError("Hermes returned no photorealistic SLAM tile")
        return entries[0]

    async def async_get_pose(
        self, *, expected_mission_id: int | None = None
    ) -> RobotPose:
        """Read the uniquely keyed latest local pose for the active mission."""
        if (
            isinstance(expected_mission_id, bool)
            or not isinstance(expected_mission_id, int)
            or not 0 <= expected_mission_id <= 0xFFFFFFFF
        ):
            raise CannotConnectError("active mission identity is unavailable for pose")
        iterator = self.async_subscribe_collection_entries("latest_pose")
        try:
            deadline = monotonic() + _LATEST_POSE_READ_TIMEOUT
            for _ in range(_LATEST_POSE_ENTRY_LIMIT + 1):
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise CannotConnectError("latest pose read exceeded its time bound")
                try:
                    async with asyncio.timeout(remaining):
                        entry = await anext(iterator)
                except StopAsyncIteration as err:
                    raise CannotConnectError(
                        "latest pose stream ended without active pose"
                    ) from err
                except TimeoutError as err:
                    raise CannotConnectError(
                        "latest pose read exceeded its time bound"
                    ) from err
                if len(entry.key) != 5:
                    raise DecodeError("latest pose has a malformed mission key")
                if len(entry.value) > _LATEST_POSE_VALUE_MAX_BYTES:
                    raise DecodeError("latest pose exceeds its value size bound")
                key_fields = decode_fields(entry.key, max_fields=2)
                if (
                    len(key_fields) != 1
                    or key_fields[0].number != 2
                    or key_fields[0].wire_type != 5
                    or not isinstance(key_fields[0].value, bytes)
                    or len(key_fields[0].value) != 4
                ):
                    raise DecodeError("latest pose has a malformed mission key")
                mission_id = struct.unpack("<I", key_fields[0].value)[0]
                if mission_id == expected_mission_id:
                    observed_at = decode_pose_observation_time(entry.value)
                    return decode_pose(
                        entry.value,
                        mission_id=expected_mission_id,
                        observed_at=observed_at,
                    )
            raise CannotConnectError("latest pose stream exceeded its entry bound")
        except DecodeError as err:
            raise CannotConnectError("Hermes returned a malformed robot pose") from err
        finally:
            await iterator.aclose()

    async def async_get_flythrough(self, *, expected_mission_token: str) -> Flythrough:
        """Read the native map tour correlated to the active SLAM mission."""
        try:
            return decode_flythrough(
                await self.async_get_property("flythrough"),
                expected_mission_token=expected_mission_token,
            )
        except DecodeError as err:
            raise CannotConnectError(
                "Hermes returned a malformed map flythrough"
            ) from err

    async def async_subscribe_approximate_trajectory(
        self, floor_plan: FloorPlan
    ) -> AsyncIterator[RobotTrajectory]:
        """Yield bounded route updates for the active floor-plan mission."""
        async for entry in self.async_subscribe_collection_entries(
            "approximate_trajectory"
        ):
            try:
                yield decode_approximate_trajectory(
                    entry.value,
                    expected_mission_id=floor_plan.mission_id,
                )
            except DecodeError as err:
                raise CannotConnectError(
                    "Hermes returned a malformed approximate trajectory"
                ) from err

    async def async_get_cleaning_session_identity(self) -> bytes | None:
        """Keep the vetted session property opaque and in memory for ownership.

        Empty bytes mean the native task ended; ``None`` means unknown. Never
        expose this private identifier through entities, logs, or storage.
        """
        payload = await self.async_get_property("active_session_key")
        present = decode_presence_state(payload)
        if present is None:
            return None
        return payload if present else b""

    async def async_get_active_cleaning_session_state(self) -> bool | None:
        """Derive task activity from the vetted robot operational snapshot.

        The opaque active-session key can remain visible after its native task
        has ended. Keep that identity for ownership checks, and use the
        independently decoded ``kabuki_state`` task signals to decide whether
        it is active. Public charging/docked activity is not ownership proof.
        Unclassified state codes require a stable snapshot and explicitly
        cleared identity before and after it. Integer state and error codes
        are never assigned guessed meanings here.
        """
        state = await self.async_get_state()
        active = state.native_session_activity()
        if active is not None or state.returning:
            return active
        if await self.async_get_cleaning_session_identity() != b"":
            return None
        confirmed = await self.async_get_state()
        if confirmed.native_session_activity() is True:
            return True
        if (
            confirmed.state_codes != state.state_codes
            or confirmed.error_codes != state.error_codes
        ):
            return None
        if await self.async_get_cleaning_session_identity() != b"":
            return None
        return confirmed.native_session_activity(identity_cleared=True)

    async def async_get_cleaning_session_records(
        self,
        *,
        strict: bool = False,
    ) -> tuple[CleaningSessionRecord, ...]:
        """Read opaque-keyed native history records for completion evidence."""
        entries = await self.async_get_tracked_collection_entries(
            "coverage_session_history", limit=64
        )
        records = tuple(
            CleaningSessionRecord(entry.key, session)
            for entry in entries
            if entry.key
            and (session := decode_cleaning_session(entry.value)) is not None
        )
        if strict and len(records) != len(entries):
            raise MaticError("Native history is incomplete or undecodable")
        return records

    async def async_get_cleaning_session_images(
        self,
    ) -> tuple[CleaningSessionImage, ...]:
        """Read valid private session maps from the retained history window."""
        entries = await self.async_get_tracked_collection_entries(
            "coverage_session_thumbnails", limit=64
        )
        images: list[CleaningSessionImage] = []
        for entry in entries:
            try:
                images.append(decode_cleaning_session_image(entry))
            except DecodeError:
                continue
        return tuple(images)

    async def async_get_monthly_cleaning_recaps(
        self,
    ) -> tuple[MonthlyCleaningRecap, ...]:
        """Read valid private monthly cleaning totals in protocol-native units."""
        entries = await self.async_get_tracked_collection_entries(
            "recap_history", limit=120
        )
        recaps: list[MonthlyCleaningRecap] = []
        for entry in entries:
            try:
                recaps.append(decode_monthly_cleaning_recap(entry))
            except DecodeError:
                continue
        return tuple(recaps)

    async def async_get_telemetry(self) -> RobotTelemetry:
        """Read the complete decoded local telemetry surface."""
        results = await asyncio.gather(
            *(self._async_optional_property(name) for name in TELEMETRY_PROPERTIES),
            self._async_optional_collection("schedule_events", limit=64),
            self._async_optional_collection("coverage_session_history", limit=64),
            self._async_optional_collection_count("dock_detections"),
            self._async_optional_collection_count("sink_summon_locations"),
            self._async_optional_collection("recap_history", limit=120),
            self._async_optional_collection("bag_pass_status", limit=4),
            self._async_optional_collection("zones", limit=MAX_ZONES),
        )
        property_count = len(TELEMETRY_PROPERTIES)
        values = dict(zip(TELEMETRY_PROPERTIES, results[:property_count], strict=True))
        schedule_entries = results[property_count]
        session_entries = results[property_count + 1]
        dock_detections = results[property_count + 2]
        sink_summon_locations = results[property_count + 3]
        recap_entries = results[property_count + 4]
        bag_pass_entries = results[property_count + 5]
        zone_entries = results[property_count + 6]
        maintenance = decode_latest_maintenance(
            recap_entries if isinstance(recap_entries, tuple) else ()
        )

        schedules = (
            tuple(
                schedule
                for entry in schedule_entries
                if (schedule := decode_schedule(entry.value)) is not None
            )
            if isinstance(schedule_entries, tuple)
            else ()
        )
        sessions = (
            tuple(
                session
                for entry in session_entries
                if (session := decode_cleaning_session(entry.value)) is not None
            )
            if isinstance(session_entries, tuple)
            else ()
        )
        wifi_state, wifi_ssid, wifi_signal, wifi_networks = decode_wifi_status(
            values["wifi_status"]
        )
        version = decode_current_version(values["current_version"])
        return RobotTelemetry(
            software_version=version[0],
            software_profile=version[1],
            protocol_version=version[2],
            supports_easter_event=version[3],
            update_channel=decode_text_field(values["update_config"], 1),
            update_state=decode_update_state(values["update_state"]),
            wifi_state=wifi_state,
            wifi_ssid=wifi_ssid,
            wifi_signal_dbm=wifi_signal,
            wifi_networks=wifi_networks,
            timezone=decode_timezone(values["time_zone"]),
            scheduled_cleanings=(
                len(schedule_entries) if isinstance(schedule_entries, tuple) else None
            ),
            schedules=schedules,
            local_cleaning_sessions=(
                len(session_entries) if isinstance(session_entries, tuple) else None
            ),
            latest_session=max(
                sessions,
                key=lambda item: item.started_at or "",
                default=None,
            ),
            child_lock_enabled=decode_binary_state(values["child_lock_enabled_state"]),
            pet_waste_enabled=decode_binary_state(values["petwaste_enabled_state"]),
            voice_enabled=decode_binary_state(values["voice_enabled_state"]),
            matter_pairing_enabled=decode_presence_state(
                values["matter_pairing_state"]
            ),
            deep_mop_enabled=decode_deep_mop_state(
                values["deep_mop_override_setting_state"]
            ),
            water_flow_factor=decode_water_flow_factor(
                values["water_flow_override_state"]
            ),
            ssh_tunnel_permission=decode_binary_state(
                values["user_tunnel_ssh_permission"]
            ),
            uploader_opt_in=decode_uploader_state(values["uploader_config_state"]),
            dock_detections=(
                dock_detections if isinstance(dock_detections, int) else None
            ),
            sink_summon_locations=(
                sink_summon_locations
                if isinstance(sink_summon_locations, int)
                else None
            ),
            coverage_time_seconds=decode_coverage_time(values["coverage_time"]),
            maintenance_recap_month=maintenance[0] if maintenance else None,
            maintenance_suggestions=maintenance[1] if maintenance else None,
            bag_pass_expires_at=decode_bag_pass(
                bag_pass_entries if isinstance(bag_pass_entries, tuple) else ()
            ),
            zones=(
                decode_zones(zone_entries) if isinstance(zone_entries, tuple) else ()
            ),
        )

    async def _async_optional_property(self, name: str) -> bytes | None:
        """Return one optional property without hiding core robot state."""
        try:
            max_bytes = (
                WIFI_STATUS_MAX_BYTES
                if name == "wifi_status"
                else TELEMETRY_NESTED_MAX_BYTES
            )
            value = await self.async_get_property(name)
            if len(value) > max_bytes:
                raise CannotConnectError("Hermes property exceeds its value byte limit")
            self._endpoint_health[name] = "ok"
            return value
        except (
            AuthenticationRequiredError,
            CannotConnectError,
            EndpointUnsupportedError,
        ) as err:
            self._endpoint_health[name] = type(err).__name__
            return None

    async def _async_optional_collection_count(self, name: str) -> int | None:
        """Return one optional collection count."""
        try:
            value = await self.async_get_collection_count(name)
            self._endpoint_health[name] = "ok"
            return value
        except (
            AuthenticationRequiredError,
            CannotConnectError,
            EndpointUnsupportedError,
        ) as err:
            self._endpoint_health[name] = type(err).__name__
            return None

    async def _async_optional_collection(
        self, name: str, *, limit: int
    ) -> tuple[HermesCollectionEntry, ...] | None:
        """Return an optional local collection without hiding core state."""
        try:
            endpoint = HERMES_ENDPOINT_MAP.get(name)
            if endpoint is not None and endpoint.tracked:
                value = await self.async_get_tracked_collection_entries(
                    name, limit=limit
                )
            else:
                value = await self.async_get_collection_entries(name, limit=limit)
            self._endpoint_health[name] = "ok"
            return value
        except (
            AuthenticationRequiredError,
            CannotConnectError,
            EndpointUnsupportedError,
        ) as err:
            self._endpoint_health[name] = type(err).__name__
            return None

    async def async_get_property(
        self, collection_name: str, *, max_bytes: int | None = None
    ) -> bytes:
        """Read one authenticated Hermes property snapshot."""
        if max_bytes is None and collection_name in TELEMETRY_PROPERTIES:
            max_bytes = (
                WIFI_STATUS_MAX_BYTES
                if collection_name == "wifi_status"
                else TELEMETRY_NESTED_MAX_BYTES
            )
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        async with (
            self._map_stream_errors(f"{collection_name} stream"),
            asyncio.timeout(_RPC_TIMEOUT),
        ):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._metadata
            ) as stream:
                if max_bytes is not None:
                    # Bound the frame before reading its body, allowing a small
                    # protobuf envelope around the separately bounded value.
                    cast(BoundedStream, stream).message_byte_limit = max_bytes + 4096
                await stream.send_message(request, end=True)
                response = await stream.recv_message()

        if response is None or not response.HasField("value"):
            raise CannotConnectError(
                f"Hermes {collection_name} stream returned no value"
            )
        payload = response_value_bytes(response)
        if max_bytes is not None and len(payload) > max_bytes:
            raise CannotConnectError("Hermes property exceeds its value byte limit")
        if not payload:
            raise CannotConnectError(
                f"Hermes {collection_name} stream returned an empty value"
            )
        return payload

    async def async_get_collection_count(self, collection_name: str) -> int:
        """Count the current entries in a verified Hermes collection."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        count = 0
        async with self._map_stream_errors(f"{collection_name} collection"):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._metadata
            ) as stream:
                await stream.send_message(request, end=True)
                cancel_stream = False
                deadline = monotonic() + _COLLECTION_TIMEOUT
                while count < 4096:
                    if monotonic() >= deadline:
                        cancel_stream = True
                        break
                    try:
                        async with asyncio.timeout(3 if count == 0 else 0.15):
                            response = await stream.recv_message()
                    except TimeoutError:
                        cancel_stream = True
                        break
                    if response is None:
                        break
                    if response.HasField("value"):
                        count += 1
                if count >= 4096:
                    cancel_stream = True
                if cancel_stream:
                    await async_cancel_stream(stream)
        return count

    async def async_get_collection_entries(
        self,
        collection_name: str,
        *,
        limit: int = 256,
        first_timeout: float = 3.0,
        idle_timeout: float = 0.15,
    ) -> tuple[HermesCollectionEntry, ...]:
        """Return a bounded snapshot of one authenticated Hermes collection."""
        if not 1 <= limit <= 4096:
            raise ValueError("Hermes collection limit must be between 1 and 4096")
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        entries: list[HermesCollectionEntry] = []
        collected_bytes = 0
        async with self._map_stream_errors(f"{collection_name} collection"):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._metadata
            ) as stream:
                await stream.send_message(request, end=True)
                cancel_stream = False
                deadline = monotonic() + _COLLECTION_TIMEOUT
                while len(entries) < limit:
                    if monotonic() >= deadline:
                        cancel_stream = True
                        break
                    try:
                        timeout = first_timeout if not entries else idle_timeout
                        async with asyncio.timeout(timeout):
                            response = await stream.recv_message()
                    except TimeoutError:
                        cancel_stream = True
                        break
                    if response is None:
                        break
                    if not response.HasField("value"):
                        continue
                    payload = response_value_bytes(response)
                    entry_size = len(response.key_bytes) + len(payload)
                    if collected_bytes + entry_size > _COLLECTION_MAX_BYTES:
                        await async_cancel_stream(stream)
                        raise CannotConnectError(
                            f"Hermes {collection_name} collection exceeds "
                            "the byte limit"
                        )
                    collected_bytes += entry_size
                    sequence = (
                        response.sequence_id
                        if response.HasField("sequence_id")
                        else None
                    )
                    entries.append(
                        HermesCollectionEntry(
                            bytes(response.key_bytes),
                            payload,
                            int(sequence.start_ts_nanos)
                            if sequence is not None
                            else None,
                            int(sequence.sequence_no) if sequence is not None else None,
                        )
                    )
                if len(entries) >= limit:
                    cancel_stream = True
                if cancel_stream:
                    await async_cancel_stream(stream)
        return tuple(entries)

    async def async_subscribe_collection_entries(
        self, collection_name: str
    ) -> AsyncGenerator[HermesCollectionEntry]:
        """Yield the initial snapshot and later updates from a collection.

        Unlike bounded diagnostic reads, this keeps the robot's server stream
        open. Map collections publish new pages on that stream rather than
        returning their complete history to every fresh snapshot reader.
        """
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        failed_channel = channel
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        try:
            async with self._map_stream_errors(f"{collection_name} subscription"):
                async with HermesStub(channel).FetchCollection.open(
                    metadata=self._metadata
                ) as stream:
                    # FetchCollection is a tracked bidirectional subscription.  The
                    # server sends one update, then waits for its sequence id to be
                    # acknowledged before advancing to the next cached or live item.
                    cancel_stream = True
                    try:
                        await stream.send_message(request, end=False)
                        while (response := await stream.recv_message()) is not None:
                            entry = None
                            if response.HasField("value"):
                                sequence = (
                                    response.sequence_id
                                    if response.HasField("sequence_id")
                                    else None
                                )
                                entry = HermesCollectionEntry(
                                    bytes(response.key_bytes),
                                    response_value_bytes(response),
                                    int(sequence.start_ts_nanos)
                                    if sequence is not None
                                    else None,
                                    int(sequence.sequence_no)
                                    if sequence is not None
                                    else None,
                                )
                            if response.HasField("sequence_id"):
                                await stream.send_message(
                                    CollectionRequest(sequence_id=response.sequence_id),
                                    end=False,
                                )
                            if entry is not None:
                                yield entry
                    except asyncio.CancelledError:
                        # grpclib's context manager handles exceptional exits with
                        # an immediate local reset. Do not await its network reset
                        # while HA is already cancelling this subscription: a
                        # stalled transport would hold config-entry unload open.
                        cancel_stream = False
                        raise
                    finally:
                        # Long-lived bidirectional streams otherwise attempt a
                        # graceful close during config-entry teardown. A robot that
                        # is still holding the subscription open can leave Home
                        # Assistant waiting for that handshake until its task-leak
                        # timeout. Explicit cancellation is local, bounded cleanup.
                        if cancel_stream:
                            await async_cancel_stream(stream)
        except CannotConnectError:
            _LOGGER.debug(
                "Replacing failed Hermes %s subscription channel", collection_name
            )
            await self._async_reconnect_after_read_failure(failed_channel)
            raise

    async def async_get_tracked_collection_entries(
        self,
        collection_name: str,
        *,
        limit: int = 256,
        first_timeout: float = 3.0,
        idle_timeout: float = 0.25,
    ) -> tuple[HermesCollectionEntry, ...]:
        """Return a bounded snapshot while acknowledging tracked updates."""
        if not 1 <= limit <= 4096:
            raise ValueError("Hermes collection limit must be between 1 and 4096")
        entries: list[HermesCollectionEntry] = []
        iterator = self.async_subscribe_collection_entries(collection_name)
        received = False
        collected_bytes = 0
        deadline = monotonic() + _COLLECTION_TIMEOUT
        try:
            while len(entries) < limit:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    break
                timeout = min(idle_timeout if received else first_timeout, remaining)
                try:
                    async with asyncio.timeout(timeout):
                        entry = await anext(iterator)
                except StopAsyncIteration, TimeoutError:
                    break
                received = True
                collected_bytes += len(entry.key) + len(entry.value)
                if collected_bytes > _COLLECTION_MAX_BYTES:
                    raise CannotConnectError(
                        f"Hermes {collection_name} collection exceeds the byte limit"
                    )
                entries.append(entry)
        finally:
            await iterator.aclose()
        return tuple(entries)

    async def async_inspect_endpoint(
        self, endpoint_name: str, *, limit: int = 1
    ) -> tuple[HermesCollectionEntry, ...]:
        """Read a known endpoint through its evidence-backed transport shape."""
        try:
            endpoint = HERMES_ENDPOINT_MAP[endpoint_name]
        except KeyError:
            raise ValueError(f"Unknown Hermes endpoint: {endpoint_name}") from None
        result: tuple[HermesCollectionEntry, ...]
        try:
            if endpoint.kind is HermesEndpointKind.PROPERTY:
                value = await self.async_get_property(endpoint_name)
                result = (HermesCollectionEntry(b"", value),)
            elif endpoint.tracked:
                result = await self.async_get_tracked_collection_entries(
                    endpoint_name, limit=limit
                )
            else:
                result = await self.async_get_collection_entries(
                    endpoint_name, limit=limit
                )
        except (AuthenticationRequiredError, CannotConnectError) as err:
            self._endpoint_health[endpoint_name] = type(err).__name__
            raise
        self._endpoint_health[endpoint_name] = "ok"
        return result

    @property
    def endpoint_health(self) -> dict[str, str]:
        """Return non-sensitive read health for observed endpoints."""
        return dict(self._endpoint_health)

    async def async_send_user_command(
        self,
        command: UserCommand,
        *,
        on_transmitted: Callable[[], None] | None = None,
    ) -> None:
        """Send one live-verified command through the authenticated user channel."""
        payload = encode_user_command(command)
        _LOGGER.debug("Requesting Matic user command %s", command.name)
        await self._async_send_user_payload(
            payload, command_name=command.name, on_transmitted=on_transmitted
        )

    async def _async_require_idle_native_session(self) -> bytes:
        """Require stable, observable idle native state before managed coverage."""
        baseline_identity = await self.async_get_cleaning_session_identity()
        if baseline_identity is None:
            raise CoverageGuardError(CoverageGuardReason.IDENTITY_UNAVAILABLE)
        active = await self.async_get_active_cleaning_session_state()
        if active is None:
            raise CoverageGuardError(CoverageGuardReason.ACTIVITY_UNAVAILABLE)
        if active:
            raise CoverageGuardError(CoverageGuardReason.NATIVE_SESSION_ACTIVE)
        if await self.async_get_cleaning_session_identity() != baseline_identity:
            raise CoverageGuardError(CoverageGuardReason.IDENTITY_CHANGED)
        return baseline_identity

    async def async_get_sink_posture(self, floor_plan: FloorPlan) -> bytes:
        """Return this floor's saved sink posture, as the app stored it."""
        mission_key = encode_mission_id(floor_plan.mission_id)
        postures = [
            entry.value
            for entry in await self.async_get_collection_entries(
                "sink_summon_locations"
            )
            if entry.key == mission_key and entry.value
        ]
        if not postures:
            raise SinkLocationUnavailableError(
                "No sink location is saved for the current floor"
            )
        return postures[-1]

    async def async_sink_summon(self, floor_plan: FloorPlan, posture: bytes) -> None:
        """Send the robot to a sink posture on this floor to await a refill."""
        await self._async_send_user_payload(
            encode_sink_summon_command(
                mission_id=floor_plan.mission_id, posture=posture
            ),
            command_name="SINK_SUMMON",
        )

    async def async_go_to_room(self, floor_plan: FloorPlan, room: Room) -> None:
        """Send the robot to a room on this floor without cleaning it."""
        await self._async_send_user_payload(
            encode_go_to_room_command(
                mission_id=floor_plan.mission_id,
                partition_id=floor_plan.partition_protocol_id,
                region_id=room.protocol_id,
            ),
            command_name="GO_TO_ROOM",
        )

    async def async_redo_clean(self, session_key: bytes) -> None:
        """Clean a finished session again, keyed by its native history key."""
        await self._async_send_user_payload(
            encode_redo_coverage_command(session_key),
            command_name="REDO_COVERAGE",
        )

    async def async_change_queue(
        self,
        floor_plan: FloorPlan,
        action: QueueAction,
        room: Room,
        *,
        cleaning_mode: CleaningMode | None = None,
        coverage_setting: CoverageSetting | None = None,
    ) -> None:
        """Skip, bring forward or repeat a room in the clean that is running.

        Like the app's queue sheet, this resends the goals from the current
        room onward under the task's own session ID, then waits until the
        robot's plan holds every goal sent and none of the goals left out.
        """
        identity = await self.async_get_cleaning_session_identity()
        active = await self.async_get_active_cleaning_session_state()
        if not identity or active is not True:
            raise QueueChangeError("no_clean_running")
        try:
            session_id = uuid_string(identity)
        except DecodeError as err:
            raise MaticError("Native task identity cannot be read") from err
        state = await self.async_get_state()
        area = room_name_key(state.current_area)
        current = [
            candidate.protocol_id
            for candidate in floor_plan.rooms
            if area is not None and room_name_key(candidate.name) == area
        ]
        if len(current) != 1:
            raise QueueChangeError("current_room_unknown")
        try:
            plan = coverage_plan_goals(await self.async_get_property("coverage_plan"))
        except DecodeError as err:
            raise QueueChangeError("plan_unreadable") from err
        goals = requeue_coverage_goals(
            [CoverageUpdateGoal(goal.round_id, *goal.signature) for goal in plan],
            action=action,
            current_region=current[0],
            target_region=room.protocol_id,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
        )
        payload = encode_coverage_goal_update(
            mission_id=floor_plan.mission_id,
            partition_id=floor_plan.partition_protocol_id,
            session_id=session_id,
            goals=goals,
        )
        start = _queue_start_index(plan, current[0])
        sent = {goal.round_id for goal in goals}
        dropped = {goal.round_id for goal in plan[start:]} - sent
        expected_order = _region_order(goals)
        if await self.async_get_cleaning_session_identity() != identity:
            raise MaticError("Native mission changed before the queue change")
        await self._async_send_user_payload(payload, command_name="UPDATE_QUEUE")
        try:
            async with asyncio.timeout(_QUEUE_READBACK_TIMEOUT):
                while True:
                    await asyncio.sleep(_QUEUE_READBACK_INTERVAL)
                    if await self.async_get_cleaning_session_identity() != identity:
                        raise MaticError(
                            "Native mission changed during the queue change"
                        )
                    try:
                        held = coverage_plan_goals(
                            await self.async_get_property("coverage_plan")
                        )
                    except DecodeError:
                        continue
                    if _queue_readback_matches(
                        goals, held, dropped=dropped, expected_order=expected_order
                    ):
                        return
        except TimeoutError as err:
            raise MaticError("Robot did not confirm the queue change") from err

    async def async_start_coverage(
        self,
        floor_plan: FloorPlan,
        region_ids: list[str],
        *,
        cleaning_mode: CleaningMode,
        coverage_setting: CoverageSetting,
        ordered: bool = False,
        require_settings_readback: bool = False,
        session_id: UUID | None = None,
        require_current: Callable[[], None] | None = None,
    ) -> CoverageReceipt | None:
        """Start an exact normal-coverage command for local room IDs."""
        if not require_settings_readback and session_id is not None:
            raise MaticError("An untracked coverage command cannot own a session ID")
        if require_settings_readback and session_id is None:
            session_id = uuid4()
        payload = encode_coverage_command(
            mission_id=floor_plan.mission_id,
            partition_id=floor_plan.partition_protocol_id,
            region_ids=region_ids,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
            ordered=ordered,
            session_id=session_id,
        )
        if require_settings_readback:
            baseline_identity = await self._async_require_idle_native_session()
        else:
            baseline_identity = None
        if require_current is not None:
            require_current()
        await self._async_send_user_payload(payload, command_name="START_COVERAGE")
        if require_settings_readback:
            assert baseline_identity is not None
            assert session_id is not None
            return await self._async_wait_for_coverage_readback(
                Counter(coverage_command_goal_signatures(payload)),
                floor_plan,
                pre_dispatch_identity=baseline_identity,
                expected_session_id=str(session_id),
                command_payload=payload,
            )
        return None

    async def async_start_mixed_coverage(
        self,
        floor_plan: FloorPlan,
        region_ids: list[str],
        settings: list[CoverageSetting],
        modes: list[CleaningMode],
        *,
        first_room_name: str,
        require_current: Callable[[], None],
        require_owned: Callable[[], None],
        prepare_stop: Callable[[], Awaitable[None]],
        rollback_stop: Callable[[], Awaitable[None]],
        on_recovery_stop_transmitted: Callable[[], None] | None = None,
        checkpoint_initial_session: Callable[[str], Awaitable[None]] | None = None,
        session_id: UUID | None = None,
    ) -> CoverageReceipt | None:
        """Start then update only our accepted, still-current native mission.

        There is no retry/replay of either write. A partial dispatch failure
        stops only the exact generated session, never an external replacement.
        Managed callers durably checkpoint the generated identity before the
        initial write, so restart can fence this exact partial transaction.
        """
        commands = encode_mixed_coverage_commands(
            mission_id=floor_plan.mission_id,
            partition_id=floor_plan.partition_protocol_id,
            region_ids=region_ids,
            settings=settings,
            modes=modes,
            session_id=session_id,
        )
        expected_goals = Counter(coverage_command_goal_signatures(commands.update))
        require_current()
        baseline_identity = await self._async_require_idle_native_session()
        require_current()
        if checkpoint_initial_session is not None:
            await checkpoint_initial_session(
                hashlib.sha256(commands.session_id.encode("ascii")).hexdigest()
            )
            # Durable persistence can yield to an external native start. Revoke
            # this transaction before sending any bytes if ownership changed.
            if await self._async_require_idle_native_session() != baseline_identity:
                raise CoverageGuardError(CoverageGuardReason.IDENTITY_CHANGED)
        require_current()
        try:
            await self._async_send_user_payload(
                commands.initial, command_name="START_COVERAGE"
            )
            async with asyncio.timeout(180):
                while True:
                    require_current()
                    identity = await self.async_get_cleaning_session_identity()
                    state = await self.async_get_state()
                    if identity and identity != baseline_identity:
                        if uuid_string(identity) != commands.session_id:
                            raise MaticError(
                                "Native mission changed before coverage update"
                            )
                    elif identity and identity == baseline_identity and state.cleaning:
                        # A retained completed identity is allowed at dispatch,
                        # but it cannot establish ownership of a newly active
                        # task. Fail closed if cleaning resumes under that key.
                        raise MaticError(
                            "Native mission changed before coverage update"
                        )
                    if (
                        identity
                        and identity != baseline_identity
                        and state.activity.value == "cleaning"
                        and room_name_key(state.current_area)
                        == room_name_key(first_room_name)
                    ):
                        break
                    await asyncio.sleep(2)
                latest = await self.async_get_floor_plan()

                if _floor_command_identity(latest) != _floor_command_identity(
                    floor_plan
                ):
                    raise MaticError("Room map changed before coverage update")
                if await self.async_get_cleaning_session_identity() != identity:
                    raise MaticError("Native mission changed before coverage update")
                state = await self.async_get_state()
                if await self.async_get_cleaning_session_identity() != identity:
                    raise MaticError("Native mission changed before coverage update")
                if state.activity.value != "cleaning" or room_name_key(
                    state.current_area
                ) != room_name_key(first_room_name):
                    raise MaticError("First room changed before coverage update")
                require_current()
                await self._async_send_user_payload(
                    commands.update, command_name="UPDATE_COVERAGE"
                )
                if await self.async_get_cleaning_session_identity() != identity:
                    raise MaticError("Native mission changed after coverage update")
                return await self._async_wait_for_mixed_coverage_readback(
                    expected_goals,
                    require_current=require_current,
                    expected_identity=identity,
                    command_payload=commands.update,
                    floor_plan=floor_plan,
                    expected_session_id=commands.session_id,
                )
        except Exception, asyncio.CancelledError:
            # Reconnection/read failure must not turn into an unowned STOP.
            try:
                require_owned()
                current = await self.async_get_cleaning_session_identity()
                require_owned()
                if current and uuid_string(current) == commands.session_id:
                    stop_fence_prepared = False
                    stop_may_have_been_sent = False
                    try:
                        # A callback can install an in-memory fence before its
                        # persistence await fails, so arrange rollback first.
                        stop_fence_prepared = True
                        await prepare_stop()
                        require_owned()
                        if await self.async_get_cleaning_session_identity() != current:
                            raise MaticError(
                                "Native mission changed before recovery STOP"
                            )

                        def note_stop_transmitted() -> None:
                            nonlocal stop_may_have_been_sent
                            if stop_may_have_been_sent:
                                return
                            stop_may_have_been_sent = True
                            if on_recovery_stop_transmitted is not None:
                                on_recovery_stop_transmitted()

                        await self.async_send_user_command(
                            UserCommand.STOP, on_transmitted=note_stop_transmitted
                        )
                        stop_fence_prepared = False
                    except Exception, asyncio.CancelledError:
                        if stop_fence_prepared and not stop_may_have_been_sent:
                            try:
                                await rollback_stop()
                            except Exception, asyncio.CancelledError:
                                _LOGGER.warning(
                                    "Mixed coverage STOP fence rollback failed"
                                )
                        raise
            except Exception:
                _LOGGER.warning(
                    "Mixed coverage recovery could not confirm safe ownership"
                )
            raise

    async def _async_wait_for_mixed_coverage_readback(
        self,
        expected_goals: Counter[tuple[str, int, int, int, int]],
        *,
        require_current: Callable[[], None],
        expected_identity: bytes,
        command_payload: bytes | None = None,
        floor_plan: FloorPlan | None = None,
        expected_session_id: str | None = None,
    ) -> CoverageReceipt | None:
        """Require the acknowledged update to appear intact in the live plan."""
        timeout = asyncio.timeout(_MIXED_COVERAGE_READBACK_TIMEOUT)
        actual_goals: Counter[tuple[str, int, int, int, int]] | None = None
        malformed = False
        stage = "coverage_plan"
        receipt: CoverageReceipt | None = None

        def note_stage(value: str) -> None:
            nonlocal stage
            stage = value

        def capture_plan(plan: bytes, deep: bool) -> None:
            nonlocal receipt
            if (
                command_payload is not None
                and floor_plan is not None
                and expected_session_id is not None
            ):
                receipt = make_coverage_receipt(
                    command_payload,
                    plan,
                    floor_plan,
                    expected_session_id,
                    deep_mop_enabled=deep,
                )

        try:
            async with timeout:
                while True:
                    require_current()
                    stage = "coverage_plan"
                    try:
                        (
                            actual_goals,
                            matched,
                        ) = await self._async_read_coverage_readback(
                            expected_goals,
                            capture_plan=capture_plan,
                            note_stage=note_stage,
                        )
                        malformed = False
                    except DecodeError:
                        actual_goals = Counter()
                        malformed = True
                        matched = False
                    stage = "session_identity"
                    if (
                        await self.async_get_cleaning_session_identity()
                        != expected_identity
                    ):
                        raise MaticError(
                            "Native mission changed during coverage readback"
                        )
                    if matched:
                        return (
                            receipt
                            if receipt is not None
                            and native_session_hash(expected_identity, active=True)
                            == receipt.session_hash
                            else None
                        )
                    stage = "poll_interval"
                    await asyncio.sleep(_MIXED_COVERAGE_READBACK_INTERVAL)
        except TimeoutError as err:
            if not timeout.expired():
                raise
            _log_mixed_readback_timeout(
                expected_goals, actual_goals, stage=stage, malformed=malformed
            )
            raise MaticError("Mixed coverage readback verification timed out") from err

    async def _async_read_coverage_readback(
        self,
        expected_goals: Counter[tuple[str, int, int, int, int]],
        *,
        capture_plan: Callable[[bytes, bool], None] | None = None,
        note_stage: Callable[[str], None] | None = None,
    ) -> tuple[Counter[tuple[str, int, int, int, int]], bool]:
        """Qualify an override with current native state around a fresh plan.

        This is observed current-state consistency, not proof that the global
        override was enabled at dispatch or an atomic property snapshot.
        The caller must still verify native session and ownership guards.
        """

        async def read(name: str, stage: str) -> bytes:
            if note_stage is not None:
                note_stage(stage)
            return await self.async_get_property(name)

        plan = await read("coverage_plan", "coverage_plan")
        actual_goals = Counter(coverage_plan_goal_signatures(plan))
        if coverage_readback_matches(expected_goals, actual_goals):
            if capture_plan is not None:
                capture_plan(plan, False)
            return actual_goals, True
        if not coverage_readback_matches(
            expected_goals, actual_goals, deep_mop_enabled=True
        ):
            return actual_goals, False
        if (
            decode_deep_mop_state(
                await read("deep_mop_override_setting_state", "deep_mop_state_before")
            )
            is not True
        ):
            return actual_goals, False
        plan = await read("coverage_plan", "coverage_plan_confirm")
        actual_goals = Counter(coverage_plan_goal_signatures(plan))
        if coverage_readback_matches(expected_goals, actual_goals):
            if capture_plan is not None:
                capture_plan(plan, False)
            return actual_goals, True
        if not coverage_readback_matches(
            expected_goals, actual_goals, deep_mop_enabled=True
        ):
            return actual_goals, False
        deep_mop_enabled = (
            decode_deep_mop_state(
                await read("deep_mop_override_setting_state", "deep_mop_state_after")
            )
            is True
        )
        matched = deep_mop_enabled and coverage_readback_matches(
            expected_goals, actual_goals, deep_mop_enabled=True
        )
        if matched and capture_plan is not None:
            capture_plan(plan, True)
        return actual_goals, matched

    async def _async_wait_for_coverage_readback(
        self,
        expected_goals: Counter[tuple[str, int, int, int, int]],
        floor_plan: FloorPlan,
        *,
        pre_dispatch_identity: bytes,
        expected_session_id: str,
        command_payload: bytes | None = None,
    ) -> CoverageReceipt | None:
        """Require the generated session and observe matching active-goal values.

        Exact goal UUID echoes additionally produce a dispatch receipt. This
        receipt alone cannot grant cadence credit: completion must match this
        session and the same retained vacuum goals must be observed again.
        """
        deadline = monotonic() + _COVERAGE_START_READBACK_TIMEOUT
        observed_identity: bytes | None = None
        receipt: CoverageReceipt | None = None

        def capture_plan(plan: bytes, deep: bool) -> None:
            nonlocal receipt
            if command_payload is not None:
                receipt = make_coverage_receipt(
                    command_payload,
                    plan,
                    floor_plan,
                    expected_session_id,
                    deep_mop_enabled=deep,
                )

        async with asyncio.timeout(_COVERAGE_START_READBACK_TIMEOUT):
            while True:
                identity = await self.async_get_cleaning_session_identity()
                if identity is None:
                    raise MaticError("Native task identity became unavailable")
                if identity and identity != pre_dispatch_identity:
                    try:
                        observed_session_id = uuid_string(identity)
                    except DecodeError as err:
                        raise MaticError(
                            "Native task identity cannot be correlated to coverage"
                        ) from err
                    if observed_session_id != expected_session_id:
                        raise MaticError(
                            "Native mission does not match dispatched coverage"
                        )
                    if observed_identity is None:
                        observed_identity = identity
                    elif identity != observed_identity:
                        raise MaticError(
                            "Native mission changed during coverage readback"
                        )
                    active = await self.async_get_active_cleaning_session_state()
                    if active is True:
                        try:
                            _, matched = await self._async_read_coverage_readback(
                                expected_goals, capture_plan=capture_plan
                            )
                        except DecodeError:
                            matched = False
                        if matched:
                            if (
                                await self.async_get_cleaning_session_identity()
                                != identity
                            ):
                                raise MaticError(
                                    "Native mission changed during coverage readback"
                                )
                            if (
                                await self.async_get_active_cleaning_session_state()
                                is not True
                            ):
                                raise MaticError(
                                    "Native mission became inactive during "
                                    "coverage readback"
                                )
                            latest_floor = await self.async_get_floor_plan()
                            if _floor_command_identity(
                                latest_floor
                            ) != _floor_command_identity(floor_plan):
                                raise MaticError(
                                    "Room map changed during coverage readback"
                                )
                            # Recheck both live guards after the floor await;
                            # leave identity last so ownership is freshest at
                            # the point we accept readback.
                            if (
                                await self.async_get_active_cleaning_session_state()
                                is not True
                            ):
                                raise MaticError(
                                    "Native mission became inactive during "
                                    "coverage readback"
                                )
                            if (
                                await self.async_get_cleaning_session_identity()
                                != identity
                            ):
                                raise MaticError(
                                    "Native mission changed during coverage readback"
                                )
                            return (
                                receipt
                                if receipt is not None
                                and native_session_hash(identity, active=True)
                                == receipt.session_hash
                                else None
                            )
                if monotonic() >= deadline:
                    raise MaticError(
                        "Robot did not report requested settings with the "
                        "dispatched active session"
                    )
                await asyncio.sleep(_MIXED_COVERAGE_READBACK_INTERVAL)

    async def async_confirm_coverage_receipt(
        self, receipt: CoverageReceipt, completion_session_hash: str
    ) -> bool:
        """Re-observe exact vacuum goals after that native session completed.

        A cleared inactive session is allowed only because the unique retained
        goal IDs and matched history key independently bind the same dispatch.
        Unavailable or changed evidence withholds cadence credit; it does not
        invalidate otherwise verified native cleaning completion.
        """
        if receipt.session_hash != completion_session_hash:
            return False
        try:
            async with asyncio.timeout(_MIXED_COVERAGE_READBACK_TIMEOUT):
                identity = await self.async_get_cleaning_session_identity()
                if identity is None or (
                    identity
                    and native_session_hash(identity, active=True)
                    != receipt.session_hash
                ):
                    return False
                if await self.async_get_active_cleaning_session_state() is not False:
                    return False
                if (
                    coverage_floor_hash(await self.async_get_floor_plan())
                    != receipt.floor_hash
                ):
                    return False
                plan = await self.async_get_property("coverage_plan")
                history_fingerprint = None
                if not receipt_matches_plan(receipt, plan):
                    if not coverage_plan_lacks_active_goals(plan):
                        return False
                    history_fingerprint = (
                        await self._async_coverage_history_fingerprint(receipt)
                    )
                    if history_fingerprint is None:
                        return False
                if (
                    coverage_floor_hash(await self.async_get_floor_plan())
                    != receipt.floor_hash
                ):
                    return False
                if await self.async_get_active_cleaning_session_state() is not False:
                    return False
                if await self.async_get_cleaning_session_identity() != identity:
                    return False
                # A second fresh sample catches same-session edits during the
                # floor/activity checks. The protocol has no atomic generation
                # marker, so this establishes observed consistency only.
                final_plan = await self.async_get_property("coverage_plan")
                if history_fingerprint is None:
                    return receipt_matches_plan(receipt, final_plan)
                if not coverage_plan_lacks_active_goals(final_plan):
                    return False
                return history_fingerprint == (
                    await self._async_coverage_history_fingerprint(receipt)
                )
        except MaticError, DecodeError, TimeoutError:
            return False

    async def _async_coverage_history_fingerprint(
        self, receipt: CoverageReceipt
    ) -> str | None:
        """Bind one complete retained goal set to its unique native history key."""
        entries = await self.async_get_tracked_collection_entries(
            "coverage_session_history", limit=64
        )
        matches = [
            entry
            for entry in entries
            if native_session_hash(entry.key) == receipt.session_hash
        ]
        if len(matches) != 1 or not receipt_matches_history(receipt, matches[0].value):
            return None
        return hashlib.sha256(matches[0].value).hexdigest()

    async def async_start_custom_coverage(
        self,
        floor_plan: FloorPlan,
        circles: list[tuple[float, float, float]],
        *,
        cleaning_mode: CleaningMode,
        coverage_setting: CoverageSetting,
        session_id: UUID | None = None,
        require_current: Callable[[], None] | None = None,
    ) -> None:
        """Start an official drawn-circle custom-area coverage command.

        A managed plan passes the session ID it will recognise as its own
        mission; that start also requires an idle native session first, as a
        tracked room start does.
        """
        payload = encode_custom_coverage_command(
            mission_id=floor_plan.mission_id,
            circles=circles,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
            session_id=session_id,
        )
        if session_id is not None:
            await self._async_require_idle_native_session()
        if require_current is not None:
            require_current()
        await self._async_send_user_payload(
            payload, command_name="START_CUSTOM_COVERAGE"
        )

    async def async_set_binary_setting(self, setting: str, enabled: bool) -> None:
        """Set a live-verified reversible binary preference."""
        try:
            channel = _BINARY_SETTING_CHANNELS[setting]
            state_property = _BINARY_SETTING_STATE_PROPERTIES[setting]
        except KeyError as err:
            raise ValueError(f"Unsupported binary setting: {setting}") from err
        await self._async_send_channel_payload(
            channel,
            bytes((0x08, int(enabled))),
        )
        await self._async_confirm_setting_readback(
            state_property, decode_binary_state, enabled
        )

    async def async_set_deep_mop(self, enabled: bool) -> None:
        """Set the verified double-pass mopping override."""
        await self._async_send_channel_payload(
            "deep_mop_override_setting_command",
            b"\x12\x00" if enabled else b"\x0a\x00",
        )
        await self._async_confirm_setting_readback(
            "deep_mop_override_setting_state", decode_deep_mop_state, enabled
        )

    async def async_set_water_flow(self, factor: float) -> None:
        """Set the verified 0.5x to 2.0x water-flow factor."""
        if not math.isfinite(factor) or not 0.5 <= factor <= 2.0:
            raise ValueError("Water flow must be between 0.5 and 2.0")
        rounded = round(factor, 1)
        if not math.isclose(factor, rounded, abs_tol=1e-6):
            raise ValueError("Water flow must use 0.1 increments")
        await self._async_send_channel_payload(
            "water_flow_override_command",
            b"\x0a\x05\x0d" + struct.pack("<f", rounded),
        )
        await self._async_confirm_setting_readback(
            "water_flow_override_state", decode_water_flow_factor, rounded
        )

    async def async_scan_wifi_signal(self) -> int | None:
        """Ask the robot for one Wi-Fi scan and return its link signal in dBm.

        The robot replies once the scan is done. The scan reply is unread;
        the result is taken from ``wifi_status`` once its scan block differs
        from the one read before the request, or after a short settle when an
        identical scan left it unchanged. ``None`` means no scan block
        appeared in time or the connected network was not listed.
        """
        baseline = wifi_scan_block(await self.async_get_property("wifi_status"))
        await self._async_send_channel_payload("wifi_scan_command", b"")
        reads = 0
        try:
            async with asyncio.timeout(_WIFI_SCAN_RESULT_TIMEOUT_SECONDS):
                while True:
                    await asyncio.sleep(_WIFI_SCAN_RESULT_INTERVAL_SECONDS)
                    payload = await self.async_get_property("wifi_status")
                    scan = wifi_scan_block(payload)
                    reads += 1
                    if scan is not None and (
                        scan != baseline or reads >= _WIFI_SCAN_SETTLE_READS
                    ):
                        return decode_wifi_status(payload)[2]
        except TimeoutError:
            return None

    async def _async_confirm_setting_readback(
        self,
        property_name: str,
        decode: Callable[[object], bool | float | None],
        expected: bool | float,
    ) -> None:
        """Wait for one acknowledged setting write to appear in fresh state."""
        reconnect_attempted = False
        try:
            async with asyncio.timeout(_SETTING_READBACK_TIMEOUT_SECONDS):
                while True:
                    await self.async_connect()
                    failed_channel = self._channel
                    try:
                        observed = decode(await self.async_get_property(property_name))
                    except CannotConnectError:
                        if reconnect_attempted:
                            raise
                        _LOGGER.debug(
                            "Retrying Hermes %s setting read on a fresh pinned channel",
                            property_name,
                        )
                        await self._async_reconnect_after_read_failure(failed_channel)
                        reconnect_attempted = True
                        observed = None
                    if observed is not None and observed == expected:
                        return
                    await asyncio.sleep(_SETTING_READBACK_INTERVAL_SECONDS)
        except TimeoutError as err:
            raise CannotConnectError(
                "The robot did not confirm the requested setting"
            ) from err

    async def _async_send_user_payload(
        self,
        payload: bytes,
        *,
        command_name: str,
        on_transmitted: Callable[[], None] | None = None,
    ) -> None:
        """Send an encoded command through the authenticated user channel."""
        await self._async_send_channel_payload(
            "user_command",
            payload,
            command_name=command_name,
            on_transmitted=on_transmitted,
        )

    async def _async_send_channel_payload(
        self,
        channel_name: str,
        payload: bytes,
        *,
        command_name: str | None = None,
        on_transmitted: Callable[[], None] | None = None,
    ) -> None:
        """Observe every outgoing channel write, including internal cleanup."""
        fields = {"channel": channel_name, "command": command_name or channel_name}
        command_id = self.activity_journal.record("command_requested", **fields)
        try:
            outcome = await self._async_transmit_channel_payload(
                channel_name, payload, command_id, on_transmitted=on_transmitted
            )
        except asyncio.CancelledError:
            self.activity_journal.record(
                "command_result", command_id=command_id, outcome="cancelled", **fields
            )
            raise
        except Exception as err:
            self.activity_journal.record(
                "command_result",
                command_id=command_id,
                outcome="failed",
                error_type=type(err).__name__,
                **fields,
            )
            raise
        self.activity_journal.record(
            "command_result", command_id=command_id, outcome=outcome, **fields
        )

    async def _async_transmit_channel_payload(
        self,
        channel_name: str,
        payload: bytes,
        command_id: int,
        *,
        on_transmitted: Callable[[], None] | None = None,
    ) -> str:
        """Send unchanged bytes; record when transport transmission begins."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")

        request = ChannelRequest(
            channel_name=channel_name,
            value=payload,
        )
        metadata = dict(self._metadata or {})
        metadata[HERMES_TARGET_KEY] = channel_name
        try:
            async with (
                self._map_stream_errors("command"),
                asyncio.timeout(_RPC_TIMEOUT),
            ):
                async with HermesStub(channel).SendToChannel.open(
                    metadata=metadata
                ) as stream:
                    self.activity_journal.record(
                        "command_sending", command_id=command_id, channel=channel_name
                    )
                    await stream.send_message(request, end=True)
                    # A failed send_message can be a local rejection before
                    # any request bytes reach the transport. Mark the point
                    # only after its DATA write returns successfully; errors
                    # while awaiting the response are then known ambiguous.
                    if on_transmitted is not None:
                        on_transmitted()
                    response = await stream.recv_message()
        except MaticError as err:
            self._command_health[channel_name] = type(err).__name__
            raise
        # The response schema is private, so its fields stay unread until
        # fixture evidence exists; whether the robot acknowledged at all is
        # transport-level and safe to observe.
        if response is None:
            self._command_health[channel_name] = "unacknowledged"
            _LOGGER.debug(
                "Hermes %s command stream closed without a response", channel_name
            )
        else:
            self._command_health[channel_name] = "acknowledged"
            _LOGGER.debug(
                "Hermes %s command acknowledged with a %d-byte response",
                channel_name,
                response.ByteSize(),
            )

        return self._command_health[channel_name]

    @property
    def command_health(self) -> dict[str, str]:
        """Return non-sensitive acknowledgment health for sent commands."""
        return dict(self._command_health)

    @property
    def _metadata(self) -> dict[str, str] | None:
        """Return authentication metadata only after pairing."""
        if self._credential is None:
            return None
        return self._credential.metadata()
