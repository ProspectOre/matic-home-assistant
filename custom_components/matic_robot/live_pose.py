"""Keep the most recent robot pose from a persistent tracked stream."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from contextlib import aclosing
from time import time

from .client.api import MaticHermesClient
from .client.floor_plan import POSE_FUTURE_ALLOWANCE_SECONDS
from .client.models import RobotPose

_LOGGER = logging.getLogger(__name__)
_RETRY_SECONDS = 2
_STREAM_IDLE_SECONDS = 3


class LivePose:
    """Retain at most one observation, scoped to the current mission."""

    def __init__(
        self,
        client: MaticHermesClient,
        mission: Callable[[], int | None],
        frame: Callable[[], object],
        on_pose: Callable[[RobotPose], None] | None = None,
        *,
        admit: Callable[[RobotPose], bool] | None = None,
    ) -> None:
        self._client = client
        self._mission = mission
        self._frame = frame
        self._on_pose = on_pose
        self._admit = admit
        self._pose_frame: object = None
        self._last_timestamp: float | None = None
        self._pose: RobotPose | None = None
        self.revision = 0

    def current(self) -> RobotPose | None:
        """Never transfer an observation to a different mission."""
        if (
            self._pose is None
            or self._pose.mission_id != self._mission()
            or self._pose_frame != self._frame()
            or (self._admit is not None and not self._admit(self._pose))
        ):
            self._pose = None
            self._pose_frame = None
            return None
        return self._pose

    async def watch(self) -> None:
        """Reconnect after stream failure; config entry owns cancellation."""
        try:
            await self._watch_streams()
        finally:
            self._pose = None
            self._pose_frame = None

    async def _watch_streams(self) -> None:
        while True:
            idle_timeout = False
            try:
                async with (
                    aclosing(
                        self._client.async_subscribe_poses(self._mission)
                    ) as stream,
                    asyncio.timeout(_STREAM_IDLE_SECONDS) as idle,
                ):
                    async for pose in stream:
                        if (
                            pose.mission_id == self._mission()
                            and pose.observed_at is not None
                            and pose.observed_at
                            <= time() + POSE_FUTURE_ALLOWANCE_SECONDS
                        ):
                            if self._admit is not None and not self._admit(pose):
                                continue
                            frame = self._frame()
                            # Keep this watermark across frames. A native sample
                            # within the two-second future allowance can predate
                            # a new frame yet pass its wall-clock admission fence.
                            # Resetting here would rebind that replay to the frame.
                            if (
                                self._last_timestamp is not None
                                and pose.observed_at <= self._last_timestamp
                            ):
                                continue
                            self._pose = pose
                            self._pose_frame = frame
                            self._last_timestamp = pose.observed_at
                            self.revision += 1
                            # A silent stream (or a replay of the same sample)
                            # must not leave background trail collection stalled.
                            idle.reschedule(
                                asyncio.get_running_loop().time() + _STREAM_IDLE_SECONDS
                            )
                            if self._on_pose is not None:
                                try:
                                    self._on_pose(pose)
                                except Exception:
                                    _LOGGER.exception("Live robot pose observer failed")
            except asyncio.CancelledError:
                raise
            except TimeoutError:
                # Keep the last observation through a silent-stream reconnect.
                # Consumers still enforce its native age and current frame.
                idle_timeout = True
                _LOGGER.debug("Reopening idle live robot pose stream")
            except Exception:
                _LOGGER.debug("Live robot pose stream failed", exc_info=True)
            finally:
                if not idle_timeout:
                    self._pose = None
                    self._pose_frame = None
            task = asyncio.current_task()
            if task is not None and task.cancelling():
                raise asyncio.CancelledError
            await asyncio.sleep(0 if idle_timeout else _RETRY_SECONDS)
