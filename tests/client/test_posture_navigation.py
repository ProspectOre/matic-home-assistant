"""Driving the robot to a posture, as a tap on the Matic app's map does."""

from __future__ import annotations

from unittest.mock import AsyncMock

from custom_components.matic_robot.client import FloorPlan, MaticHermesClient

POSTURE = bytes.fromhex("0d0000c03f15000000c022050d0000803f")


async def test_go_to_posture_parks_at_the_posture_without_a_wait() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client._connection._async_send_user_payload = AsyncMock()

    await client.async_go_to_posture(
        FloorPlan(0x01020304, "partition", b"partition", ()), POSTURE
    )

    client._connection._async_send_user_payload.assert_awaited_once_with(
        bytes.fromhex("121c221a0a110d0000c03f15000000c022050d0000803f12051504030201"),
        command_name="GO_TO_POSTURE",
    )
