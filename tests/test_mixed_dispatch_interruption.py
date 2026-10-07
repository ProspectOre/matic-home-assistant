"""Regression tests for interrupted mixed-mode START/UPDATE dispatch."""

from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    _wrapped_uuid,
    encode_mixed_coverage_commands,
)
from custom_components.matic_robot.client.coverage_goals import (
    coverage_command_goal_signatures,
)
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import FloorPlan, RobotOperationalState

PARTITION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ROOMS = (
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
)
STARTED_SESSION = "33333333-3333-4333-8333-333333333333"
REPLACEMENT_SESSION = "44444444-4444-4444-8444-444444444444"


async def test_mixed_dispatch_interrupted_after_start_contains_only_first_room():
    """A lost handoff cannot leave later rooms running with the first mode."""
    client = MaticHermesClient("robot.invalid", 16320)
    floor = FloorPlan(42, PARTITION, b"partition", ())
    writes: list[tuple[bytes, str]] = []
    client._async_require_idle_native_session = AsyncMock(return_value=b"baseline")
    client._async_send_user_payload = AsyncMock(
        side_effect=lambda payload, *, command_name: writes.append(
            (payload, command_name)
        )
    )
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[
            _wrapped_uuid(REPLACEMENT_SESSION),
            _wrapped_uuid(REPLACEMENT_SESSION),
        ]
    )
    client.async_get_state = AsyncMock(
        return_value=RobotOperationalState(
            battery_percentage=None,
            state_codes=(119,),
            error_codes=(),
            charging_idle=False,
            charging=False,
            low_charge=False,
            paused=False,
            cleaning=True,
            returning=False,
            current_area="First",
        )
    )
    client.async_send_user_command = AsyncMock()

    commands = encode_mixed_coverage_commands(
        mission_id=42,
        partition_id=PARTITION,
        region_ids=ROOMS,
        settings=[CoverageSetting.QUICK, CoverageSetting.OPTIMAL],
        modes=[CleaningMode.VACUUM, CleaningMode.MOP],
        session_id=UUID(STARTED_SESSION),
    )

    with pytest.raises(MaticError, match="mission changed before coverage update"):
        await client.async_start_mixed_coverage(
            floor,
            list(ROOMS),
            [CoverageSetting.QUICK, CoverageSetting.OPTIMAL],
            [CleaningMode.VACUUM, CleaningMode.MOP],
            first_room_name="First",
            require_current=Mock(),
            require_owned=Mock(),
            prepare_stop=AsyncMock(),
            rollback_stop=AsyncMock(),
            session_id=UUID(STARTED_SESSION),
        )

    assert [name for _, name in writes] == ["START_COVERAGE"]
    assert {
        signature[0] for signature in coverage_command_goal_signatures(writes[0][0])
    } == {ROOMS[0]}
    assert coverage_command_goal_signatures(commands.initial) == tuple(
        signature
        for signature in coverage_command_goal_signatures(commands.update)
        if signature[0] == ROOMS[0]
    )
    assert {
        signature[0] for signature in coverage_command_goal_signatures(commands.update)
    } == set(ROOMS)
    client.async_send_user_command.assert_not_awaited()
