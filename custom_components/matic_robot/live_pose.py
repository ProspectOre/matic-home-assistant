"""Keep the most recent robot pose from a persistent tracked stream."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from time import time

from .client.api import MaticHermesClient
from .client.floor_plan import POSE_FUTURE_ALLOWANCE_SECONDS
from .client.models import RobotPose

_LOGGER = logging.getLogger(__name__)
_RETRY_SECONDS = 2


class LivePose:
    """Retain at most one observation, scoped to the current mission."""

    def __init__(
        self,
        client: MaticHermesClient,
        mission: Callable[[], int | None],
        frame: Callable[[], object],
        on_pose: Callable[[RobotPose], None] | None = None,
    ) -> None:
        self._client = client
        self._mission = mission
        self._frame = frame
        self._on_pose = on_pose
        self._pose_frame: object = None
        self._last_frame: object = None
        self._last_timestamp: float | None = None
        self._pose: RobotPose | None = None
        self.revision = 0

    def current(self) -> RobotPose | None:
        """Never transfer an observation to a different mission."""
        if (
            self._pose is None
            or self._pose.mission_id != self._mission()
            or self._pose_frame != self._frame()
        ):
            self._pose = None
            self._pose_frame = None
            return None
        return self._pose

    async def watch(self) -> None:
        """Reconnect after stream failure; config entry owns cancellation."""
        while True:
            try:
                async for pose in self._client.async_subscribe_poses(self._mission):
                    if (
                        pose.mission_id == self._mission()
                        and pose.observed_at is not None
                        and pose.observed_at <= time() + POSE_FUTURE_ALLOWANCE_SECONDS
                    ):
                        frame = self._frame()
                        if (
                            frame == self._last_frame
                            and self._last_timestamp is not None
                            and pose.observed_at <= self._last_timestamp
                        ):
                            continue
                        self._pose = pose
                        self._pose_frame = frame
                        self._last_frame = frame
                        self._last_timestamp = pose.observed_at
                        self.revision += 1
                        if self._on_pose is not None:
                            self._on_pose(pose)
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOGGER.debug("Live robot pose stream failed", exc_info=True)
            finally:
                self._pose = None
                self._pose_frame = None
            task = asyncio.current_task()
            if task is not None and task.cancelling():
                raise asyncio.CancelledError
            await asyncio.sleep(_RETRY_SECONDS)
