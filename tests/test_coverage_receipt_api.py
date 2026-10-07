"""Public API coverage receipt dispatch and completion regressions."""

import hashlib
from itertools import count
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    encode_coverage_command,
    encode_mixed_coverage_commands,
)
from custom_components.matic_robot.client.coverage_receipts import (
    make_coverage_receipt,
)
from custom_components.matic_robot.client.models import FloorPlan, Room
from tests.test_coverage_receipts import (
    SESSION,
    active_key,
    receipt_plan,
)

FLOOR = FloorPlan(
    42,
    "00000000-0000-0000-0000-000000000456",
    b"partition",
    (
        Room(
            "room-a",
            "Room A",
            "00000000-0000-0000-0000-000000000123",
            b"room",
            (),
        ),
    ),
)
REGION = FLOOR.rooms[0].protocol_id
REGION_B = "00000000-0000-0000-0000-000000000124"
MIXED_FLOOR = FloorPlan(
    FLOOR.mission_id,
    FLOOR.partition_protocol_id,
    FLOOR.partition_id_wire,
    (*FLOOR.rooms, Room("room-b", "Room B", REGION_B, b"room-b", ())),
)
ACTIVE_IDENTITY = active_key()
SESSION_HASH = hashlib.sha256(str(SESSION).encode("ascii")).hexdigest()


def _normal_fixture():
    identifiers = count(500)
    command = encode_coverage_command(
        mission_id=FLOOR.mission_id,
        partition_id=FLOOR.partition_protocol_id,
        region_ids=[REGION],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.QUICK,
        ordered=True,
        session_id=SESSION,
        command_id_factory=lambda: UUID(int=next(identifiers)),
    )
    plan = receipt_plan(command, transform_heavy=False)
    receipt = make_coverage_receipt(command, plan, FLOOR, str(SESSION))
    assert receipt is not None
    return command, plan, receipt


def _configure_normal_dispatch(client, monkeypatch, command, plan):
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.uuid4", lambda: SESSION
    )
    client._async_require_idle_native_session = AsyncMock(return_value=b"prior")
    client._async_send_user_payload = AsyncMock()
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[ACTIVE_IDENTITY] * 8
    )
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=True)
    client.async_get_property = AsyncMock(return_value=plan)
    client.async_get_floor_plan = AsyncMock(return_value=FLOOR)


async def test_normal_start_returns_receipt_for_observed_active_session(
    monkeypatch,
):
    client = MaticHermesClient("robot.invalid", 16320)
    command, plan, expected = _normal_fixture()
    _configure_normal_dispatch(client, monkeypatch, command, plan)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.encode_coverage_command",
        lambda **_kwargs: command,
    )

    receipt = await client.async_start_coverage(
        FLOOR,
        [REGION],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.QUICK,
        ordered=True,
        require_settings_readback=True,
    )

    # Receipt means the generated session and exact echoed goals were observed
    # consistently at dispatch; the protocol exposes no atomic marker.
    assert receipt == expected
    client._async_send_user_payload.assert_awaited_once()
    client.async_get_property.assert_awaited_once_with("coverage_plan")


async def test_mixed_start_returns_receipt_for_observed_update(monkeypatch):
    client = MaticHermesClient("robot.invalid", 16320)
    commands = encode_mixed_coverage_commands(
        mission_id=MIXED_FLOOR.mission_id,
        partition_id=MIXED_FLOOR.partition_protocol_id,
        region_ids=[REGION, REGION_B],
        settings=[CoverageSetting.QUICK, CoverageSetting.QUICK],
        modes=[CleaningMode.VACUUM, CleaningMode.VACUUM],
        session_id=SESSION,
    )
    plan = receipt_plan(commands.update, transform_heavy=False)
    expected = make_coverage_receipt(commands.update, plan, MIXED_FLOOR, str(SESSION))
    assert expected is not None
    client._async_require_idle_native_session = AsyncMock(return_value=b"prior")
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.encode_mixed_coverage_commands",
        lambda **_kwargs: commands,
    )
    client._async_send_user_payload = AsyncMock()
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[ACTIVE_IDENTITY] * 10
    )
    client.async_get_state = AsyncMock(
        return_value=Mock(activity=Mock(value="cleaning"), current_area="Room A")
    )
    client.async_get_floor_plan = AsyncMock(return_value=MIXED_FLOOR)
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=True)
    client.async_get_property = AsyncMock(return_value=plan)
    client.async_send_user_command = AsyncMock()
    require_current = Mock()

    receipt = await client.async_start_mixed_coverage(
        MIXED_FLOOR,
        [REGION, REGION_B],
        [CoverageSetting.QUICK, CoverageSetting.QUICK],
        [CleaningMode.VACUUM, CleaningMode.VACUUM],
        first_room_name="Room A",
        require_current=require_current,
        require_owned=Mock(),
        prepare_stop=AsyncMock(),
        rollback_stop=AsyncMock(),
        session_id=SESSION,
    )

    assert receipt == expected
    assert [
        call.kwargs["command_name"]
        for call in client._async_send_user_payload.await_args_list
    ] == [
        "START_COVERAGE",
        "UPDATE_COVERAGE",
    ]


async def test_mixed_start_returns_receipt_when_deep_mop_plan_converges(monkeypatch):
    client = MaticHermesClient("robot.invalid", 16320)
    commands = encode_mixed_coverage_commands(
        mission_id=MIXED_FLOOR.mission_id,
        partition_id=MIXED_FLOOR.partition_protocol_id,
        region_ids=[REGION, REGION_B],
        settings=[CoverageSetting.QUICK, CoverageSetting.STANDARD],
        modes=[CleaningMode.VACUUM, CleaningMode.MOP],
        session_id=SESSION,
    )
    override_plan = receipt_plan(
        commands.update,
        deep=True,
        transform_heavy=False,
        omit_mop=True,
    )
    converged_plan = receipt_plan(
        commands.update,
        transform_heavy=False,
        omit_mop=False,
    )
    expected = make_coverage_receipt(
        commands.update, converged_plan, MIXED_FLOOR, str(SESSION)
    )
    assert expected is not None
    client._async_require_idle_native_session = AsyncMock(return_value=b"prior")
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.encode_mixed_coverage_commands",
        lambda **_kwargs: commands,
    )
    client._async_send_user_payload = AsyncMock()
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[ACTIVE_IDENTITY] * 10
    )
    client.async_get_state = AsyncMock(
        return_value=Mock(activity=Mock(value="cleaning"), current_area="Room A")
    )
    client.async_get_floor_plan = AsyncMock(return_value=MIXED_FLOOR)
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=True)
    client.async_get_property = AsyncMock(
        side_effect=[override_plan, b"\x12\x00", converged_plan]
    )
    client.async_send_user_command = AsyncMock()

    receipt = await client.async_start_mixed_coverage(
        MIXED_FLOOR,
        [REGION, REGION_B],
        [CoverageSetting.QUICK, CoverageSetting.STANDARD],
        [CleaningMode.VACUUM, CleaningMode.MOP],
        first_room_name="Room A",
        require_current=Mock(),
        require_owned=Mock(),
        prepare_stop=AsyncMock(),
        rollback_stop=AsyncMock(),
        session_id=SESSION,
    )

    assert receipt == expected
    assert [call.args for call in client.async_get_property.await_args_list] == [
        ("coverage_plan",),
        ("deep_mop_override_setting_state",),
        ("coverage_plan",),
    ]


def _completion_client(*, identity=b"", active=False, floor=FLOOR, plan=None):
    client = MaticHermesClient("robot.invalid", 16320)
    _, valid_plan, receipt = _normal_fixture()
    client.async_get_cleaning_session_identity = AsyncMock(return_value=identity)
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=active)
    client.async_get_floor_plan = AsyncMock(return_value=floor)
    client.async_get_property = AsyncMock(
        return_value=valid_plan if plan is None else plan
    )
    return client, receipt


async def test_completion_accepts_matching_retained_goals_after_inactive_session():
    client, receipt = _completion_client()
    matching_plan = receipt_plan_for(receipt)
    client.async_get_property = AsyncMock(side_effect=[matching_plan, matching_plan])

    assert await client.async_confirm_coverage_receipt(receipt, SESSION_HASH)
    assert client.async_get_property.await_count == 2


@pytest.mark.parametrize(
    "identity,active,completion_hash",
    (
        (active_key(UUID(int=988)), False, SESSION_HASH),
        (active_key(), True, SESSION_HASH),
        (None, False, SESSION_HASH),
        (b"malformed", False, SESSION_HASH),
        (b"", False, "0" * 64),
    ),
)
async def test_completion_rejects_wrong_or_unavailable_identity(
    identity, active, completion_hash
):
    client, receipt = _completion_client(identity=identity, active=active)

    assert not await client.async_confirm_coverage_receipt(receipt, completion_hash)


async def test_completion_rejects_floor_change():
    client, receipt = _completion_client(
        floor=FloorPlan(43, FLOOR.partition_protocol_id, b"partition", FLOOR.rooms)
    )
    assert not await client.async_confirm_coverage_receipt(receipt, SESSION_HASH)


async def test_completion_rejects_changed_goal_id_or_setting():
    for plan in (
        _changed_goal_plan(),
        _changed_goal_plan(setting=CoverageSetting.HEAVY_DUTY),
    ):
        client, receipt = _completion_client(plan=plan)
        assert not await client.async_confirm_coverage_receipt(receipt, SESSION_HASH)


async def test_completion_rechecks_goals_after_other_native_reads():
    client, receipt = _completion_client()
    changed_plan = _changed_goal_plan()
    # The protocol has no atomic generation marker. A fresh final sample must
    # still match after floor and activity checks, so same-session edits fail.
    client.async_get_property = AsyncMock(
        side_effect=[receipt_plan_for(receipt), changed_plan]
    )

    assert not await client.async_confirm_coverage_receipt(receipt, SESSION_HASH)


async def test_completion_treats_timeout_as_unverified():
    client, receipt = _completion_client()

    async def timeout_read(_name):
        raise TimeoutError

    client.async_get_property = AsyncMock(side_effect=timeout_read)
    assert not await client.async_confirm_coverage_receipt(receipt, SESSION_HASH)


@pytest.mark.parametrize("race", ("floor", "activity", "identity"))
async def test_completion_rejects_native_state_changing_during_confirmation(race):
    client, receipt = _completion_client()
    if race == "floor":
        changed_floor = FloorPlan(
            43, FLOOR.partition_protocol_id, b"partition", FLOOR.rooms
        )
        client.async_get_floor_plan = AsyncMock(side_effect=[FLOOR, changed_floor])
    elif race == "activity":
        client.async_get_active_cleaning_session_state = AsyncMock(
            side_effect=[False, True]
        )
    else:
        client.async_get_cleaning_session_identity = AsyncMock(
            side_effect=[b"", ACTIVE_IDENTITY]
        )

    assert not await client.async_confirm_coverage_receipt(receipt, SESSION_HASH)


def receipt_plan_for(receipt):
    command, plan, _ = _normal_fixture()
    assert make_coverage_receipt(command, plan, FLOOR, str(SESSION)) == receipt
    return plan


def _changed_goal_plan(*, setting=CoverageSetting.QUICK):
    identifiers = count(500 if setting is CoverageSetting.HEAVY_DUTY else 1000)
    changed_command = encode_coverage_command(
        mission_id=FLOOR.mission_id,
        partition_id=FLOOR.partition_protocol_id,
        region_ids=[REGION],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=setting,
        ordered=True,
        session_id=SESSION,
        command_id_factory=lambda: UUID(int=next(identifiers)),
    )
    return receipt_plan(changed_command, transform_heavy=False)
