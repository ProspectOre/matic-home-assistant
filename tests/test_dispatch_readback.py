"""What a leg's start readback concludes from the identity the robot reports."""

from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from custom_components.matic_robot.managed_dispatch import async_dispatch_leg_command
from custom_components.matic_robot.managed_run import (
    RobotConnectionLostError,
    RoomTakenOverError,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from tests.session_fakes import FakeRobot
from tests.wire_builders import _session_identity

ROOM = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
FOREIGN = _session_identity(UUID("55555555-5555-4555-8555-555555555555"))


@pytest.fixture(autouse=True)
def fast_readback(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_dispatch.DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS",
        0.02,
    )


@pytest.mark.parametrize(
    ("after_start", "error", "match"),
    [
        # A foreign task at the first read is explicit takeover evidence.
        ([FOREIGN], RoomTakenOverError, "replaced before readback"),
        # One that appears while the run waits for its own is too.
        ([b"", FOREIGN], RoomTakenOverError, "could not be verified"),
        # The robot answers but never shows the task the run started.
        ([b""], RoomTakenOverError, "could not be verified"),
        # The start went out and the robot stopped answering: lost contact.
        ([None], RobotConnectionLostError, "stopped answering"),
        ([b"", None], RobotConnectionLostError, "stopped answering"),
    ],
)
async def test_start_readback_tells_lost_contact_from_another_task(
    hass, after_start, error, match
):
    robot = FakeRobot()
    reads: list[bytes | None] = []

    async def start(_call) -> None:
        reads.extend(after_start)

    async def read() -> bytes | None:
        if not reads:
            return b""
        # The last scripted answer repeats until the readback gives up.
        return reads.pop(0) if len(reads) > 1 else reads[0]

    robot.on_start = start
    bound = []
    with pytest.raises(error, match=match):
        await async_dispatch_leg_command(
            robot.port(session_identity=AsyncMock(side_effect=read)),
            [ROOM],
            7,
            on_identity=bound.append,
            floor_token="floor",
        )
    assert bound == []
