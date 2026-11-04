"""Public facade for the robot local Hermes API."""

from __future__ import annotations

from collections.abc import (
    AsyncGenerator,
    AsyncIterator,
    Awaitable,
    Callable,
)
from contextlib import AbstractAsyncContextManager, aclosing
from types import TracebackType
from uuid import UUID

from .auth import HermesCredential
from .commands import (
    CleaningMode,
    CoverageSetting,
    QueueAction,
    UserCommand,
)
from .coverage_receipts import (
    CoverageReceipt,
)
from .flythrough import Flythrough
from .hermes_collections import HermesCollections
from .hermes_commands import HermesCommands
from .hermes_connection import HermesConnection
from .hermes_reads import HermesReads
from .history import (
    CleaningSessionImage,
    MonthlyCleaningRecap,
)
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
        self._connection = HermesConnection(
            host,
            port,
            hostname=hostname,
            serial_number=serial_number,
            certificate_fingerprint=certificate_fingerprint,
            credential=credential,
            timezone_identifier=timezone_identifier,
            seconds_from_gmt=seconds_from_gmt,
            observation_callback=observation_callback,
        )
        self._collections = HermesCollections(self._connection)
        self._reads = HermesReads(self._connection, self._collections)
        self._commands = HermesCommands(
            self._connection, self._collections, self._reads
        )

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

    @property
    def activity_journal(self) -> ActivityJournal:
        """Return the session's bounded activity journal."""
        return self._connection.activity_journal

    async def async_connect(self) -> None:
        """Verify the pinned certificate, then open an HTTP/2 channel."""
        return await self._connection.async_connect()

    @property
    def retired(self) -> bool:
        """Whether this runtime has permanently revoked transport access."""
        return self._connection.retired

    def retire(self) -> None:
        """Permanently revoke this runtime, including captured channel references."""
        return self._connection.retire()

    async def async_shutdown(self) -> None:
        """Revoke this runtime and wait for any in-flight dial to settle."""
        return await self._connection.async_shutdown()

    def close(self) -> None:
        """Close the active channel while allowing a later reconnect."""
        return self._connection.close()

    async def async_get_info(self) -> RobotInfo:
        """Read identity and connection metadata from the robot."""
        return await self._reads.async_get_info()

    async def async_request_credential(self, user_id: str) -> HermesCredential:
        """Request a scoped credential during the robot's pairing window."""
        return await self._connection.async_request_credential(user_id)

    async def async_get_state(self) -> RobotOperationalState:
        """Read one authenticated snapshot from the ``kabuki_state`` property."""
        return await self._reads.async_get_state()

    async def async_get_run_progress(self) -> RunProgress | None:
        """Read elapsed and remaining time for the clean under way, if any."""
        return await self._reads.async_get_run_progress()

    async def async_subscribe_state(self) -> AsyncIterator[RobotOperationalState]:
        """Yield live snapshots from the local ``kabuki_state`` property."""
        async with aclosing(self._reads.async_subscribe_state()) as values:
            async for value in values:
                yield value

    async def async_get_floor_plan(
        self, *, expected_mission_id: int | None = None
    ) -> FloorPlan:
        """Read and decode the active local coverage plan."""
        return await self._reads.async_get_floor_plan(
            expected_mission_id=expected_mission_id
        )

    async def async_get_slam_tile_entry(self) -> HermesCollectionEntry:
        """Read the current local photorealistic SLAM tile."""
        return await self._reads.async_get_slam_tile_entry()

    async def async_get_pose(
        self, *, expected_mission_id: int | None = None
    ) -> RobotPose:
        """Read the uniquely keyed latest local pose for the active mission."""
        return await self._reads.async_get_pose(expected_mission_id=expected_mission_id)

    async def async_get_flythrough(self, *, expected_mission_token: str) -> Flythrough:
        """Read the native map tour correlated to the active SLAM mission."""
        return await self._reads.async_get_flythrough(
            expected_mission_token=expected_mission_token
        )

    async def async_subscribe_approximate_trajectory(
        self, floor_plan: FloorPlan
    ) -> AsyncIterator[RobotTrajectory]:
        """Yield bounded route updates for the active floor-plan mission."""
        async with aclosing(
            self._reads.async_subscribe_approximate_trajectory(floor_plan)
        ) as values:
            async for value in values:
                yield value

    async def async_get_cleaning_session_identity(self) -> bytes | None:
        """Keep the vetted session property opaque and in memory for ownership.

        Empty bytes mean the native task ended; ``None`` means unknown. Never
        expose this private identifier through entities, logs, or storage.
        """
        return await self._reads.async_get_cleaning_session_identity()

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
        return await self._reads.async_get_active_cleaning_session_state()

    async def async_get_cleaning_session_records(
        self,
        *,
        strict: bool = False,
    ) -> tuple[CleaningSessionRecord, ...]:
        """Read opaque-keyed native history records for completion evidence."""
        return await self._reads.async_get_cleaning_session_records(strict=strict)

    async def async_get_cleaning_session_snapshot(
        self,
        *,
        strict: bool = False,
    ) -> tuple[tuple[CleaningSessionRecord, ...], str]:
        """Read native history and its stable revision from one snapshot."""
        return await self._reads.async_get_cleaning_session_snapshot(strict=strict)

    async def async_get_cleaning_session_images(
        self,
    ) -> tuple[CleaningSessionImage, ...]:
        """Read valid private session maps from the retained history window."""
        return await self._reads.async_get_cleaning_session_images()

    async def async_get_monthly_cleaning_recaps(
        self,
    ) -> tuple[MonthlyCleaningRecap, ...]:
        """Read valid private monthly cleaning totals in protocol-native units."""
        return await self._reads.async_get_monthly_cleaning_recaps()

    async def async_get_telemetry(self) -> RobotTelemetry:
        """Read the complete decoded local telemetry surface."""
        return await self._reads.async_get_telemetry()

    async def async_get_property(
        self, collection_name: str, *, max_bytes: int | None = None
    ) -> bytes:
        """Read one authenticated Hermes property snapshot."""
        return await self._collections.async_get_property(
            collection_name, max_bytes=max_bytes
        )

    async def async_get_collection_count(self, collection_name: str) -> int:
        """Count the current entries in a verified Hermes collection."""
        return await self._collections.async_get_collection_count(collection_name)

    async def async_get_collection_entries(
        self,
        collection_name: str,
        *,
        limit: int = 256,
        first_timeout: float = 3.0,
        idle_timeout: float = 0.15,
    ) -> tuple[HermesCollectionEntry, ...]:
        """Return a bounded snapshot of one authenticated Hermes collection."""
        return await self._collections.async_get_collection_entries(
            collection_name,
            limit=limit,
            first_timeout=first_timeout,
            idle_timeout=idle_timeout,
        )

    async def async_subscribe_collection_entries(
        self, collection_name: str, *, include_deletions: bool = False
    ) -> AsyncGenerator[HermesCollectionEntry]:
        """Yield the initial snapshot and later updates from a collection.

        Unlike bounded diagnostic reads, this keeps the robot's server stream
        open. Map collections publish new pages on that stream rather than
        returning their complete history to every fresh snapshot reader.
        """
        stream = (
            self._collections.async_subscribe_collection_entries(
                collection_name, include_deletions=True
            )
            if include_deletions
            else self._collections.async_subscribe_collection_entries(collection_name)
        )
        async with aclosing(stream) as values:
            async for value in values:
                yield value

    async def async_subscribe_poses(
        self, mission: Callable[[], int | None]
    ) -> AsyncGenerator[RobotPose]:
        """Yield bounded, mission-keyed robot pose observations."""
        async with aclosing(self._reads.async_subscribe_poses(mission)) as values:
            async for value in values:
                yield value

    async def async_get_tracked_collection_entries(
        self,
        collection_name: str,
        *,
        limit: int = 256,
        first_timeout: float = 3.0,
        idle_timeout: float = 0.25,
    ) -> tuple[HermesCollectionEntry, ...]:
        """Return a bounded snapshot while acknowledging tracked updates."""
        return await self._collections.async_get_tracked_collection_entries(
            collection_name,
            limit=limit,
            first_timeout=first_timeout,
            idle_timeout=idle_timeout,
        )

    async def async_inspect_endpoint(
        self, endpoint_name: str, *, limit: int = 1
    ) -> tuple[HermesCollectionEntry, ...]:
        """Read a known endpoint through its evidence-backed transport shape."""
        return await self._reads.async_inspect_endpoint(endpoint_name, limit=limit)

    @property
    def endpoint_health(self) -> dict[str, str]:
        """Return non-sensitive read health for observed endpoints."""
        return self._reads.endpoint_health

    async def async_send_user_command(
        self,
        command: UserCommand,
        *,
        on_transmitted: Callable[[], None] | None = None,
    ) -> None:
        """Send one live-verified command through the authenticated user channel."""
        return await self._commands.async_send_user_command(
            command, on_transmitted=on_transmitted
        )

    async def async_get_sink_posture(self, floor_plan: FloorPlan) -> bytes:
        """Return this floor's saved sink posture, as the app stored it."""
        return await self._commands.async_get_sink_posture(floor_plan)

    async def async_sink_summon(self, floor_plan: FloorPlan, posture: bytes) -> None:
        """Send the robot to a sink posture on this floor to await a refill."""
        return await self._commands.async_sink_summon(floor_plan, posture)

    async def async_go_to_room(self, floor_plan: FloorPlan, room: Room) -> None:
        """Send the robot to a room on this floor without cleaning it."""
        return await self._commands.async_go_to_room(floor_plan, room)

    async def async_redo_clean(self, session_key: bytes) -> None:
        """Clean a finished session again, keyed by its native history key."""
        return await self._commands.async_redo_clean(session_key)

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
        return await self._commands.async_change_queue(
            floor_plan,
            action,
            room,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
        )

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
        return await self._commands.async_start_coverage(
            floor_plan,
            region_ids,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
            ordered=ordered,
            require_settings_readback=require_settings_readback,
            session_id=session_id,
            require_current=require_current,
        )

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
        return await self._commands.async_start_mixed_coverage(
            floor_plan,
            region_ids,
            settings,
            modes,
            first_room_name=first_room_name,
            require_current=require_current,
            require_owned=require_owned,
            prepare_stop=prepare_stop,
            rollback_stop=rollback_stop,
            on_recovery_stop_transmitted=on_recovery_stop_transmitted,
            checkpoint_initial_session=checkpoint_initial_session,
            session_id=session_id,
        )

    async def async_confirm_coverage_receipt(
        self, receipt: CoverageReceipt, completion_session_hash: str
    ) -> bool:
        """Re-observe exact vacuum goals after that native session completed.

        A cleared inactive session is allowed only because the unique retained
        goal IDs and matched history key independently bind the same dispatch.
        Unavailable or changed evidence withholds cadence credit; it does not
        invalidate otherwise verified native cleaning completion.
        """
        return await self._commands.async_confirm_coverage_receipt(
            receipt, completion_session_hash
        )

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
        return await self._commands.async_start_custom_coverage(
            floor_plan,
            circles,
            cleaning_mode=cleaning_mode,
            coverage_setting=coverage_setting,
            session_id=session_id,
            require_current=require_current,
        )

    async def async_set_binary_setting(self, setting: str, enabled: bool) -> None:
        """Set a live-verified reversible binary preference."""
        return await self._commands.async_set_binary_setting(setting, enabled)

    async def async_set_deep_mop(self, enabled: bool) -> None:
        """Set the verified double-pass mopping override."""
        return await self._commands.async_set_deep_mop(enabled)

    async def async_set_water_flow(self, factor: float) -> None:
        """Set the verified 0.5x to 2.0x water-flow factor."""
        return await self._commands.async_set_water_flow(factor)

    async def async_scan_wifi_signal(self) -> int | None:
        """Ask the robot for one Wi-Fi scan and return its link signal in dBm.

        The robot replies once the scan is done. The scan reply is unread;
        the result is taken from ``wifi_status`` once its scan block differs
        from the one read before the request, or after a short settle when an
        identical scan left it unchanged. ``None`` means no scan block
        appeared in time or the connected network was not listed.
        """
        return await self._commands.async_scan_wifi_signal()

    @property
    def command_health(self) -> dict[str, str]:
        """Return non-sensitive acknowledgment health for sent commands."""
        return self._connection.command_health
