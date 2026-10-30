"""Queue changes to a running clean: skip, clean next and clean again."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client import api as api_module
from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    CoverageUpdateGoal,
    QueueAction,
    QueueChangeError,
    encode_coverage_goal_update,
    requeue_coverage_goals,
)
from custom_components.matic_robot.client.coverage_goals import (
    CoveragePlanGoal,
    coverage_plan_goals,
)
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.client.wire import (
    bytes_fields,
    first_bytes,
    uuid_string,
)
from tests.test_mixed_coverage import _session_identity

# Produced offline by Matic 1.167.0's own queue encoder from the synthetic
# identifiers below and mission 42. No robot data is present.
VECTORS = Path(__file__).parent / "fixtures" / "queue_vectors"

PARTITION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CURRENT = "11111111-1111-4111-8111-111111111111"
QUEUED = "22222222-2222-4222-8222-222222222222"
SESSION = "33333333-3333-4333-8333-333333333333"
ROUND = "44444444-4444-4444-8444-444444444444"
NEW = "55555555-5555-4555-8555-555555555555"
THIRD = "66666666-6666-4666-8666-666666666666"


def _goal(region: str, round_id: str = ROUND, **spec: int) -> CoverageUpdateGoal:
    values = {"setting": 1, "floor": 0, "mode": 0, "behavior": 0} | spec
    return CoverageUpdateGoal(round_id, region, **values)


def _command_goals(payload: bytes) -> list[bytes]:
    coverage = first_bytes(first_bytes(first_bytes(payload, 15), 1), 3)
    return [
        goal
        for container in bytes_fields(coverage, 5)
        for goal in bytes_fields(container, 1)
    ]


def _round_ids(payload: bytes) -> list[UUID]:
    return [
        UUID(uuid_string(first_bytes(first_bytes(goal, 6), 1)))
        for goal in _command_goals(payload)
    ]


def _command_id(payload: bytes) -> UUID:
    coverage = first_bytes(first_bytes(first_bytes(payload, 15), 1), 3)
    return UUID(uuid_string(first_bytes(first_bytes(coverage, 7), 1)))


def _plan(payload: bytes) -> bytes:
    """Store a command's goals as the robot's coverage_plan readback does."""
    return _field(
        7, _field(1, b"".join(_field(1, goal) for goal in _command_goals(payload)))
    )


def _field(number: int, value: bytes) -> bytes:
    return bytes([(number << 3) | 2]) + _varint(len(value)) + value


def _varint(value: int) -> bytes:
    out = bytearray()
    while value > 0x7F:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def _replay(vector: str, goals: tuple[CoverageUpdateGoal, ...]) -> bytes:
    expected = (VECTORS / f"{vector}.pb").read_bytes()
    return encode_coverage_goal_update(
        mission_id=42,
        partition_id=PARTITION,
        session_id=SESSION,
        goals=goals,
        command_id_factory=lambda: _command_id(expected),
    )


@pytest.mark.parametrize(
    ("vector", "action", "target", "plan"),
    [
        ("skip", QueueAction.SKIP, CURRENT, (CURRENT, QUEUED)),
        ("prioritize3", QueueAction.CLEAN_NEXT, THIRD, (CURRENT, QUEUED, THIRD)),
        ("redo_vacuum", QueueAction.CLEAN_AGAIN, CURRENT, (CURRENT, QUEUED)),
        ("add_vacuum", QueueAction.CLEAN_AGAIN, NEW, (CURRENT, QUEUED)),
    ],
)
def test_queue_changes_match_the_app_encoder(vector, action, target, plan):
    expected = (VECTORS / f"{vector}.pb").read_bytes()
    rounds = iter(
        round_id for round_id in _round_ids(expected) if round_id != UUID(ROUND)
    )
    goals = requeue_coverage_goals(
        [_goal(region) for region in plan],
        action=action,
        current_region=CURRENT,
        target_region=target,
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.OPTIMAL,
        round_id_factory=lambda: next(rounds),
    )

    assert _replay(vector, goals) == expected


def test_clean_next_on_the_next_room_matches_an_unchanged_queue():
    expected = (VECTORS / "prioritize.pb").read_bytes()
    goals = (_goal(CURRENT), _goal(QUEUED))

    assert _replay("prioritize", goals) == expected
    with pytest.raises(QueueChangeError, match="already_next"):
        requeue_coverage_goals(
            goals,
            action=QueueAction.CLEAN_NEXT,
            current_region=CURRENT,
            target_region=QUEUED,
        )


def test_finished_rooms_are_left_out_and_kept_rounds_survive():
    done = "77777777-7777-4777-8777-777777777777"
    plan = [
        _goal(done, "88888888-8888-4888-8888-888888888888"),
        _goal(CURRENT, "99999999-9999-4999-8999-999999999999"),
        _goal(QUEUED),
        _goal(THIRD),
    ]

    goals = requeue_coverage_goals(
        plan,
        action=QueueAction.SKIP,
        current_region=CURRENT,
        target_region=QUEUED,
    )

    assert goals == (plan[1], plan[3])


def test_cleaning_a_finished_room_again_appends_fresh_goals():
    done = "77777777-7777-4777-8777-777777777777"
    plan = [
        _goal(done, mode=0, setting=3),
        _goal(done, mode=1, setting=1),
        _goal(CURRENT),
    ]
    rounds = iter(UUID(int=value) for value in range(1, 20))

    goals = requeue_coverage_goals(
        plan,
        action=QueueAction.CLEAN_AGAIN,
        current_region=CURRENT,
        target_region=done,
        round_id_factory=lambda: next(rounds),
    )

    assert goals[0] == plan[2]
    fresh = goals[1:]
    assert {goal.region_id for goal in fresh} == {done}
    # Both modes come back, and the retained Heavy Duty setting 3 maps to 0.
    assert [(goal.mode, goal.setting) for goal in fresh] == [(0, 0)] * 8 + [(1, 1)] * 4
    assert [goal.round_id for goal in fresh] == [
        str(UUID(int=value)) for value in range(1, 13)
    ]


@pytest.mark.parametrize(
    ("modes", "expected"),
    [((1,), {1}), ((0,), {0}), ((), {0})],
)
def test_clean_again_keeps_the_room_mode(modes, expected):
    plan = [_goal(CURRENT, mode=mode) for mode in modes] or [_goal(CURRENT)]
    if not modes:
        target = NEW
    else:
        target = CURRENT
    goals = requeue_coverage_goals(
        plan,
        action=QueueAction.CLEAN_AGAIN,
        current_region=CURRENT,
        target_region=target,
        cleaning_mode=None if modes else CleaningMode.VACUUM,
    )

    assert {goal.mode for goal in goals if goal.region_id == target} == expected


def test_mop_readback_setting_three_goes_back_as_standard():
    plan = [_goal(CURRENT), _goal(QUEUED, mode=1, setting=3)]

    goals = requeue_coverage_goals(
        plan,
        action=QueueAction.SKIP,
        current_region=CURRENT,
        target_region=CURRENT,
    )

    assert goals == (_goal(QUEUED, mode=1, setting=1),)


@pytest.mark.parametrize(
    ("action", "current", "target", "reason"),
    [
        (QueueAction.SKIP, NEW, CURRENT, "current_room_unknown"),
        (QueueAction.SKIP, CURRENT, NEW, "room_not_queued"),
        (QueueAction.CLEAN_NEXT, CURRENT, NEW, "room_not_queued"),
        (QueueAction.CLEAN_NEXT, CURRENT, CURRENT, "already_next"),
    ],
)
def test_queue_changes_the_clean_cannot_take(action, current, target, reason):
    with pytest.raises(QueueChangeError) as error:
        requeue_coverage_goals(
            [_goal(CURRENT), _goal(QUEUED)],
            action=action,
            current_region=current,
            target_region=target,
        )

    assert error.value.reason == reason


def test_skipping_the_only_room_left_is_refused():
    with pytest.raises(QueueChangeError, match="last_room"):
        requeue_coverage_goals(
            [_goal(QUEUED), _goal(CURRENT)],
            action=QueueAction.SKIP,
            current_region=CURRENT,
            target_region=CURRENT,
        )


def test_goal_update_needs_goals():
    with pytest.raises(ValueError, match="at least one goal"):
        encode_coverage_goal_update(
            mission_id=42, partition_id=PARTITION, session_id=SESSION, goals=()
        )


def test_plan_goals_keep_order_and_round_ids():
    command = (VECTORS / "prioritize3.pb").read_bytes()

    goals = coverage_plan_goals(_plan(command))

    assert goals == (
        CoveragePlanGoal(ROUND, (CURRENT, 1, 0, 0, 0)),
        CoveragePlanGoal(ROUND, (THIRD, 1, 0, 0, 0)),
        CoveragePlanGoal(ROUND, (QUEUED, 1, 0, 0, 0)),
    )
    assert [goal.region_id for goal in goals] == [CURRENT, THIRD, QUEUED]


def test_plan_goals_reject_empty_oversized_and_crowded_plans():
    with pytest.raises(DecodeError, match="no active goals"):
        coverage_plan_goals(b"")
    with pytest.raises(DecodeError, match="byte limit"):
        coverage_plan_goals(b"\x00" * (2 * 1024 * 1024 + 1))
    goal = _command_goals((VECTORS / "skip.pb").read_bytes())[0]
    crowded = _field(
        7, _field(1, _field(1, goal) * 4000) + _field(1, _field(1, goal) * 97)
    )
    with pytest.raises(DecodeError, match="budget"):
        coverage_plan_goals(crowded)


_REAL_SLEEP = asyncio.sleep
DONE = "77777777-7777-4777-8777-777777777777"


def _room(region: str, name: str) -> Room:
    return Room(region, name, region, b"", ())


ROOMS = (
    _room(DONE, "Done"),
    _room(CURRENT, "Current"),
    _room(QUEUED, "Queued"),
    _room(THIRD, "Third"),
)
FLOOR = FloorPlan(42, PARTITION, b"partition", ROOMS)


def _rounds(region: str, start: int) -> list[CoverageUpdateGoal]:
    return [
        _goal(region, str(UUID(int=start + index)), floor=floor, behavior=behavior)
        for index, (floor, behavior) in enumerate(((0, 0), (0, 1)))
    ]


LIVE = (
    _rounds(DONE, 10) + _rounds(CURRENT, 20) + _rounds(QUEUED, 30) + _rounds(THIRD, 40)
)


def _readback(goals) -> bytes:
    return _plan(
        encode_coverage_goal_update(
            mission_id=42, partition_id=PARTITION, session_id=SESSION, goals=goals
        )
    )


def _client(monkeypatch, *plans, area="the current", identity=None):
    client = MaticHermesClient("robot.invalid", 16320)
    identity = _session_identity(UUID(SESSION)) if identity is None else identity
    client.async_get_cleaning_session_identity = AsyncMock(return_value=identity)
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=True)
    client.async_get_state = AsyncMock(return_value=Mock(current_area=area))
    client.async_get_property = AsyncMock(side_effect=list(plans))
    client._async_send_user_payload = AsyncMock()

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(api_module.asyncio, "sleep", no_wait)
    return client


def _sent(client) -> tuple[CoveragePlanGoal, ...]:
    payload = client._async_send_user_payload.await_args.args[0]
    assert client._async_send_user_payload.await_args.kwargs == {
        "command_name": "UPDATE_QUEUE"
    }
    assert _command_id(payload)
    return coverage_plan_goals(_plan(payload))


async def test_skip_waits_until_the_room_leaves_the_plan(monkeypatch):
    skipped = LIVE[:4] + LIVE[6:]
    client = _client(
        monkeypatch,
        _readback(LIVE),
        _readback(LIVE),
        b"\xff",
        _readback(skipped),
    )

    await client.async_change_queue(FLOOR, QueueAction.SKIP, ROOMS[2])

    assert [goal.round_id for goal in _sent(client)] == [
        goal.round_id for goal in LIVE[2:4] + LIVE[6:]
    ]
    assert client.async_get_property.await_count == 4


async def test_clean_next_waits_for_the_new_room_order(monkeypatch):
    # The robot lists behaviors in its own order and may leave out the last
    # floor mop behavior of a room.
    mop = _goal(THIRD, str(UUID(int=99)), mode=1, behavior=3)
    live = [*LIVE, mop]
    reordered = [*LIVE[:4], LIVE[7], LIVE[6], *LIVE[4:6]]
    client = _client(
        monkeypatch, _readback(live), _readback(live), _readback(reordered)
    )

    await client.async_change_queue(FLOOR, QueueAction.CLEAN_NEXT, ROOMS[3])

    assert [goal.region_id for goal in _sent(client)] == [
        CURRENT,
        CURRENT,
        THIRD,
        THIRD,
        THIRD,
        QUEUED,
        QUEUED,
    ]


async def test_clean_again_waits_for_fresh_goals(monkeypatch):
    client = _client(monkeypatch, _readback(LIVE), _readback(LIVE))
    sent = []

    async def capture(payload, **_kwargs):
        sent.extend(coverage_plan_goals(_plan(payload)))
        client.async_get_property.side_effect = [
            _readback(
                LIVE[:4]
                + [
                    CoverageUpdateGoal(goal.round_id, *goal.signature)
                    for goal in sent[2:]
                ]
            )
        ]

    client._async_send_user_payload.side_effect = capture

    await client.async_change_queue(
        FLOOR,
        QueueAction.CLEAN_AGAIN,
        ROOMS[0],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.QUICK,
    )

    assert [goal.region_id for goal in sent[-8:]] == [DONE] * 8
    assert {goal.signature[1] for goal in sent[-8:]} == {2}


@pytest.mark.parametrize(
    ("identity", "active", "area", "plan", "reason"),
    [
        (b"", True, "Current", None, "no_clean_running"),
        (None, False, "Current", None, "no_clean_running"),
        (None, True, None, None, "current_room_unknown"),
        (None, True, "Elsewhere", None, "current_room_unknown"),
        (None, True, "Current", b"\xff", "plan_unreadable"),
    ],
)
async def test_queue_change_refusals(monkeypatch, identity, active, area, plan, reason):
    client = _client(monkeypatch, plan or _readback(LIVE), area=area, identity=identity)
    client.async_get_active_cleaning_session_state.return_value = active

    with pytest.raises(QueueChangeError) as error:
        await client.async_change_queue(FLOOR, QueueAction.SKIP, ROOMS[2])

    assert error.value.reason == reason
    client._async_send_user_payload.assert_not_awaited()


async def test_unreadable_task_identity_is_an_error(monkeypatch):
    client = _client(monkeypatch, identity=b"\x0a\x01\x00")

    with pytest.raises(MaticError, match="identity cannot be read"):
        await client.async_change_queue(FLOOR, QueueAction.SKIP, ROOMS[2])


async def test_task_change_before_sending_stops_the_change(monkeypatch):
    client = _client(monkeypatch, _readback(LIVE))
    identity = client.async_get_cleaning_session_identity.return_value
    client.async_get_cleaning_session_identity.side_effect = [identity, b"other"]

    with pytest.raises(MaticError, match="changed before"):
        await client.async_change_queue(FLOOR, QueueAction.SKIP, ROOMS[2])

    client._async_send_user_payload.assert_not_awaited()


async def test_task_change_during_readback_is_an_error(monkeypatch):
    client = _client(monkeypatch, _readback(LIVE))
    identity = client.async_get_cleaning_session_identity.return_value
    client.async_get_cleaning_session_identity.side_effect = [
        identity,
        identity,
        b"other",
    ]

    with pytest.raises(MaticError, match="changed during"):
        await client.async_change_queue(FLOOR, QueueAction.SKIP, ROOMS[2])


async def test_unconfirmed_queue_change_times_out(monkeypatch):
    client = _client(monkeypatch)
    client.async_get_property = AsyncMock(return_value=_readback(LIVE))
    monkeypatch.setattr(api_module, "_QUEUE_READBACK_TIMEOUT", 0.05)

    async def tick(_seconds):
        await _REAL_SLEEP(0.001)

    monkeypatch.setattr(api_module.asyncio, "sleep", tick)

    with pytest.raises(MaticError, match="did not confirm"):
        await client.async_change_queue(FLOOR, QueueAction.SKIP, ROOMS[2])


def test_readback_needs_every_required_goal_sent():
    sent = LIVE[2:4]

    assert not api_module._queue_readback_matches(
        sent,
        coverage_plan_goals(_readback(LIVE[2:3])),
        dropped=set(),
        expected_order=[CURRENT],
    )
