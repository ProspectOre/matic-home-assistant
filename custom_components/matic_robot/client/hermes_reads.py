"""Decoded robot reads and endpoint health."""

from __future__ import annotations

import asyncio
import logging
import struct
from collections.abc import (
    AsyncGenerator,
    Callable,
)
from dataclasses import replace
from time import monotonic

from google.protobuf.message import DecodeError

from .cleaning_schedule import decode_schedule
from .cleaning_session import (
    _native_history_collection_revision,
    decode_cleaning_session,
    decode_cleaning_session_records,
)
from .endpoints import HERMES_ENDPOINT_MAP, HermesEndpointKind
from .exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    EndpointUnsupportedError,
)
from .floor_plan import decode_floor_plans, decode_pose
from .flythrough import Flythrough, decode_flythrough
from .hermes_collections import HermesCollections
from .hermes_connection import HermesConnection
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
    RunProgress,
)
from .operational_state import decode_operational_state, decode_pose_observation_time
from .proto.hermes_bot_info_grpc import HermesDiscoveryRPCStub
from .proto.hermes_bot_info_pb2 import Unit as DiscoveryUnit
from .telemetry import (
    TELEMETRY_PROPERTIES,
    decode_bag_pass,
    decode_binary_state,
    decode_coverage_time,
    decode_current_version,
    decode_deep_mop_state,
    decode_latest_maintenance,
    decode_presence_state,
    decode_run_progress,
    decode_timezone,
    decode_update_state,
    decode_uploader_state,
    decode_water_flow_factor,
)
from .telemetry_fields import TELEMETRY_NESTED_MAX_BYTES, decode_text_field
from .trajectory import decode_approximate_trajectory
from .wifi_status import WIFI_STATUS_MAX_BYTES, decode_wifi_status
from .wire import (
    decode_fields,
)
from .zones import MAX_ZONES, decode_zones

_LOGGER = logging.getLogger(__name__)
_RPC_TIMEOUT = 10.0
_LATEST_POSE_ENTRY_LIMIT = 64
_LATEST_POSE_VALUE_MAX_BYTES = 16 * 1024
_LATEST_POSE_READ_TIMEOUT = 3.0
_DISPLAYED_MISSION_LIMIT = 256


def _pose_entry_mission(entry: HermesCollectionEntry) -> int:
    """Read the mission from a bounded, well-formed collection key."""
    if len(entry.key) != 5:
        raise DecodeError("latest pose has a malformed mission key")
    fields = decode_fields(entry.key, max_fields=2)
    if (
        len(fields) != 1
        or fields[0].number != 2
        or fields[0].wire_type != 5
        or not isinstance(fields[0].value, bytes)
        or len(fields[0].value) != 4
    ):
        raise DecodeError("latest pose has a malformed mission key")
    return int(struct.unpack("<I", fields[0].value)[0])


def _decode_pose_entry(entry: HermesCollectionEntry) -> RobotPose:
    """Decode a pose only when its bounded mission key is well formed."""
    if len(entry.value) > _LATEST_POSE_VALUE_MAX_BYTES:
        raise DecodeError("latest pose exceeds its value size bound")
    mission_id = _pose_entry_mission(entry)
    return decode_pose(
        entry.value,
        mission_id=mission_id,
        observed_at=decode_pose_observation_time(entry.value),
    )


class HermesReads:
    """Own reads behavior for one robot session."""

    def __init__(
        self, connection: HermesConnection, collections: HermesCollections
    ) -> None:
        self._connection = connection
        self._collections = collections
        self._endpoint_health: dict[str, str] = {}

    async def async_get_info(self) -> RobotInfo:
        """Read identity and connection metadata from the robot."""
        if self._connection._channel is None:
            await self._connection.async_connect()
        channel = self._connection._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        async with (
            self._connection._map_stream_errors("info"),
            asyncio.timeout(_RPC_TIMEOUT),
        ):
            response = await HermesDiscoveryRPCStub(channel).GetBotInfo(
                DiscoveryUnit(), metadata=self._connection._metadata
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

    async def async_get_state(self) -> RobotOperationalState:
        """Read one authenticated snapshot from the ``kabuki_state`` property."""
        # The robot closes an otherwise healthy long-lived HTTP/2 session about
        # once an hour. grpclib reports that closure on the next stream read;
        # replace the pinned channel and retry this idempotent snapshot once so
        # a routine transport rollover does not mark every HA entity unavailable.
        await self._connection.async_connect()
        failed_channel = self._connection._channel
        try:
            payload = await self._collections.async_get_property("kabuki_state")
        except CannotConnectError:
            _LOGGER.debug("Retrying Hermes state read on a fresh pinned channel")
            await self._connection._async_reconnect_after_read_failure(failed_channel)
            payload = await self._collections.async_get_property("kabuki_state")

        try:
            state = decode_operational_state(payload)
            self._connection.activity_journal.observe_state(state, "poll")
            return state
        except DecodeError as err:
            raise CannotConnectError("Hermes returned malformed robot state") from err

    async def async_get_run_progress(self) -> RunProgress | None:
        """Read elapsed and remaining time for the clean under way, if any."""
        return decode_run_progress(
            await self._collections.async_get_property("coverage_time")
        )

    async def async_subscribe_state(self) -> AsyncGenerator[RobotOperationalState]:
        """Yield live snapshots from the local ``kabuki_state`` property."""
        self._connection.activity_journal.record("state_stream_started", source="push")
        try:
            async for entry in self._collections.async_subscribe_collection_entries(
                "kabuki_state"
            ):
                try:
                    state = decode_operational_state(entry.value)
                    self._connection.activity_journal.observe_state(state, "push")
                    yield state
                except DecodeError as err:
                    raise CannotConnectError(
                        "Hermes returned malformed subscribed robot state"
                    ) from err
        finally:
            self._connection.activity_journal.record(
                "state_stream_ended", source="push"
            )

    async def async_get_floor_plan(
        self, *, expected_mission_id: int | None = None
    ) -> FloorPlan:
        """Read and decode the active local coverage plan."""
        try:
            payload = await self._collections.async_get_property("coverage_plan")
            floor_plans = decode_floor_plans(payload)
            if len(floor_plans) == 1:
                return floor_plans[0]

            mission_entries = (
                await self._collections.async_get_tracked_collection_entries(
                    "displayed_mission", limit=_DISPLAYED_MISSION_LIMIT
                )
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
        entries = await self._collections.async_get_collection_entries(
            "map_compressed_rgb", limit=1
        )
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
        iterator = self._collections.async_subscribe_collection_entries("latest_pose")
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
                if len(entry.value) > _LATEST_POSE_VALUE_MAX_BYTES:
                    raise DecodeError("latest pose exceeds its value size bound")
                if _pose_entry_mission(entry) == expected_mission_id:
                    return _decode_pose_entry(entry)
            raise CannotConnectError("latest pose stream exceeded its entry bound")
        except DecodeError as err:
            raise CannotConnectError("Hermes returned a malformed robot pose") from err
        finally:
            await iterator.aclose()

    async def async_subscribe_poses(
        self, mission: Callable[[], int | None]
    ) -> AsyncGenerator[RobotPose]:
        """Decode a persistent stream of mission-keyed pose observations."""
        iterator = self._collections.async_subscribe_collection_entries("latest_pose")
        try:
            async for entry in iterator:
                try:
                    if _pose_entry_mission(entry) == mission():
                        yield _decode_pose_entry(entry)
                except DecodeError:
                    # A bad retained record must not block the valid entries
                    # that follow it in every reconnect snapshot.
                    continue
        finally:
            await iterator.aclose()

    async def async_get_flythrough(self, *, expected_mission_token: str) -> Flythrough:
        """Read the native map tour correlated to the active SLAM mission."""
        try:
            return decode_flythrough(
                await self._collections.async_get_property("flythrough"),
                expected_mission_token=expected_mission_token,
            )
        except DecodeError as err:
            raise CannotConnectError(
                "Hermes returned a malformed map flythrough"
            ) from err

    async def async_subscribe_approximate_trajectory(
        self, floor_plan: FloorPlan
    ) -> AsyncGenerator[RobotTrajectory]:
        """Yield bounded route updates for the active floor-plan mission."""
        async for entry in self._collections.async_subscribe_collection_entries(
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
        payload = await self._collections.async_get_property("active_session_key")
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
        records, _revision = await self.async_get_cleaning_session_snapshot(
            strict=strict
        )
        return records

    async def async_get_cleaning_session_snapshot(
        self,
        *,
        strict: bool = False,
    ) -> tuple[tuple[CleaningSessionRecord, ...], str]:
        """Return decoded records and their revision from one collection read."""
        entries = await self._collections.async_get_tracked_collection_entries(
            "coverage_session_history", limit=64
        )
        records = decode_cleaning_session_records(entries, strict=strict)
        return records, _native_history_collection_revision(entries)

    async def async_get_cleaning_session_images(
        self,
    ) -> tuple[CleaningSessionImage, ...]:
        """Read valid private session maps from the retained history window."""
        entries = await self._collections.async_get_tracked_collection_entries(
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
        entries = await self._collections.async_get_tracked_collection_entries(
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
            native_history_revision=(
                _native_history_collection_revision(session_entries)
                if isinstance(session_entries, tuple)
                else None
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
            value = await self._collections.async_get_property(name)
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
            value = await self._collections.async_get_collection_count(name)
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
                value = await self._collections.async_get_tracked_collection_entries(
                    name, limit=limit
                )
            else:
                value = await self._collections.async_get_collection_entries(
                    name, limit=limit
                )
            self._endpoint_health[name] = "ok"
            return value
        except (
            AuthenticationRequiredError,
            CannotConnectError,
            EndpointUnsupportedError,
        ) as err:
            self._endpoint_health[name] = type(err).__name__
            return None

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
                value = await self._collections.async_get_property(endpoint_name)
                result = (HermesCollectionEntry(b"", value),)
            elif endpoint.tracked:
                result = await self._collections.async_get_tracked_collection_entries(
                    endpoint_name, limit=limit
                )
            else:
                result = await self._collections.async_get_collection_entries(
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
