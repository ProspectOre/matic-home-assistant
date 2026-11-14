"""Public client for the robot local Hermes API."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from types import TracebackType

from .auth import HermesCredential
from .hermes_commands import HermesCommands
from .hermes_connection import HermesConnection
from .models import HermesCollectionEntry, RobotOperationalState, RobotPose
from .observations import ActivityJournal, ObservationCallback
from .supervisor import OnWatchStatus, async_watch


class MaticHermesClient(HermesCommands):
    """Certificate-pinned client for a single Matic robot.

    Collections, decoded reads and validated commands come from the classes
    it extends; this one owns the connection's lifecycle and watches.
    """

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
        super().__init__(
            HermesConnection(
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
        )

    async def __aenter__(self) -> MaticHermesClient:
        try:
            await self.async_connect()
        except BaseException:
            # A failed first dial leaves the supervisor retrying.
            await self.async_shutdown()
            raise
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.async_shutdown()

    @property
    def activity_journal(self) -> ActivityJournal:
        """Return the session's bounded activity journal."""
        return self._connection.activity_journal

    async def async_connect(self) -> None:
        """Dial the robot, pin its certificate and complete the handshake.

        Every request does this when no channel is open. From the first one
        on, a supervisor task keeps the connection and redials after a loss.
        """
        await self._connection.async_channel()

    @property
    def connected(self) -> bool:
        """Whether the connection to the robot is open."""
        return self._connection.supervisor.connected

    @property
    def connection_error(self) -> Exception | None:
        """Why the last dial failed; None while connected or about to redial."""
        return self._connection.supervisor.error

    def add_connection_listener(
        self, listener: Callable[[], None]
    ) -> Callable[[], None]:
        """Call ``listener`` after each dial and each loss; return its removal."""
        return self._connection.supervisor.add_listener(listener)

    async def async_watch(
        self,
        collection_name: str,
        on_entry: Callable[[HermesCollectionEntry], Awaitable[object]],
        on_status: OnWatchStatus | None = None,
    ) -> None:
        """Give ``on_entry`` a collection's snapshot and every later update.

        The subscription is opened again whenever it ends, on the supervisor's
        pacing, until the client shuts down.
        """
        await async_watch(
            self._connection.async_keep_subscribed,
            lambda: self.async_subscribe_collection_entries(collection_name),
            on_entry,
            on_status,
        )

    async def async_watch_state(
        self,
        on_state: Callable[[RobotOperationalState], Awaitable[object]],
        on_status: OnWatchStatus | None = None,
    ) -> None:
        """Give ``on_state`` every snapshot of ``kabuki_state``, like a watch."""
        await async_watch(
            self._connection.async_keep_subscribed,
            self.async_subscribe_state,
            on_state,
            on_status,
        )

    async def async_watch_poses(
        self, on_pose: Callable[[RobotPose], Awaitable[object]]
    ) -> None:
        """Give ``on_pose`` each mission's latest pose, like a watch."""
        await async_watch(
            self._connection.async_keep_subscribed, self.async_subscribe_poses, on_pose
        )

    async def async_shutdown(self) -> None:
        """Close the connection for good; every later request fails."""
        await self._connection.async_shutdown()

    @property
    def command_health(self) -> dict[str, str]:
        """Return non-sensitive acknowledgment health for sent commands."""
        return self._connection.command_health
