"""Synthetic regressions for the native double-pass retained-goal override."""

from collections import Counter
from unittest.mock import AsyncMock, Mock, call
from uuid import UUID

import pytest

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import (
    CleaningMode as Mode,
)
from custom_components.matic_robot.client.commands import (
    CoverageSetting as Setting,
)
from custom_components.matic_robot.client.commands import (
    encode_coverage_command,
    encode_mixed_coverage_commands,
)
from custom_components.matic_robot.client.coverage_goals import (
    coverage_command_goal_signatures,
    coverage_readback_matches,
)
from custom_components.matic_robot.client.exceptions import MaticError
from tests.test_mixed_coverage import (
    PARTITION,
    ROOMS,
    _normal_coverage_fixture,
    _plan_for_signatures,
    _session_identity,
)


def _override(goals, *, omit=False):
    return Counter(
        (region, 3 if mode == 1 else setting, floor, mode, behavior)
        for (region, setting, floor, mode, behavior), count in goals.items()
        for _ in range(count)
        if not (omit and mode == 1 and behavior == 3)
    )


def _mixed_goals(settings=(Setting.STANDARD, Setting.QUICK)):
    commands = encode_mixed_coverage_commands(
        mission_id=42,
        partition_id=PARTITION,
        region_ids=ROOMS,
        settings=list(settings),
        modes=[Mode.BOTH, Mode.MOP],
    )
    return Counter(coverage_command_goal_signatures(commands.update))


@pytest.mark.parametrize("omit", (False, True))
def test_double_pass_requires_whole_mop_groups_and_explicit_context(omit):
    expected = _mixed_goals()
    actual = _override(expected, omit=omit)
    assert not coverage_readback_matches(expected, actual)
    assert coverage_readback_matches(expected, actual, deep_mop_enabled=True)
    # Identical readback remains compatible with firmware that keeps the setting.
    assert coverage_readback_matches(expected, expected, deep_mop_enabled=True)


def test_reported_five_room_standard_plan_retains_46_of_48_goals():
    commands = encode_mixed_coverage_commands(
        mission_id=42,
        partition_id=PARTITION,
        region_ids=[str(UUID(int=100 + index)) for index in range(5)],
        settings=[Setting.STANDARD] * 5,
        modes=[Mode.BOTH, Mode.BOTH, Mode.VACUUM, Mode.VACUUM, Mode.VACUUM],
    )
    expected = Counter(coverage_command_goal_signatures(commands.update))
    actual = _override(expected, omit=True)
    assert (expected.total(), actual.total()) == (48, 46)
    assert ((expected - actual).total(), (actual - expected).total()) == (8, 6)
    assert not coverage_readback_matches(expected, actual)
    assert coverage_readback_matches(expected, actual, deep_mop_enabled=True)


@pytest.mark.parametrize(
    "corruption",
    ("partial", "missing", "duplicate", "vacuum", "room", "floor", "mode", "behavior"),
)
def test_double_pass_does_not_hide_other_goal_changes(corruption):
    expected = _mixed_goals()
    actual = _override(expected, omit=True)
    goal = next(g for g in actual if g[3] == (0 if corruption == "vacuum" else 1))
    actual[goal] -= 1
    changed = list(goal)
    if corruption == "partial":
        changed[1] = 1
    elif corruption == "duplicate":
        actual[goal] += 2
    elif corruption == "vacuum":
        changed[1] = 3
    elif corruption == "room":
        changed[0] = str(UUID(int=99))
    elif corruption == "floor":
        changed[2] = 1
    elif corruption == "mode":
        changed[3] = 0
    elif corruption == "behavior":
        changed[4] = 9
    if corruption not in ("missing", "duplicate"):
        actual[tuple(changed)] += 1
    assert not coverage_readback_matches(expected, +actual, deep_mop_enabled=True)


@pytest.mark.parametrize(
    "malformation", ("incomplete", "multiple_settings", "mop_quick", "mop_heavy")
)
def test_double_pass_does_not_generalize_unproven_source_groups(malformation):
    expected = _mixed_goals()
    goal = next(g for g in expected if g[3] == 1)
    if malformation == "incomplete":
        del expected[goal]
    elif malformation == "multiple_settings":
        expected[(goal[0], 2, *goal[2:])] += 1
    else:
        expected = Counter(
            (
                region,
                (2 if malformation == "mop_quick" else 0) if mode == 1 else setting,
                floor,
                mode,
                behavior,
            )
            for region, setting, floor, mode, behavior in expected.elements()
        )
    assert not coverage_readback_matches(
        expected, _override(expected, omit=True), deep_mop_enabled=True
    )


@pytest.mark.parametrize("mode", Mode)
@pytest.mark.parametrize("setting", Setting)
@pytest.mark.parametrize("deep_mop", (False, True))
def test_native_retained_setting_matrix(mode, setting, deep_mop):
    expected = Counter(
        coverage_command_goal_signatures(
            encode_coverage_command(
                mission_id=42,
                partition_id=PARTITION,
                region_ids=[ROOMS[0]],
                cleaning_mode=mode,
                coverage_setting=setting,
            )
        )
    )
    actual = Counter(
        (
            region,
            3
            if (cleaning == 0 and value == 0) or (cleaning == 1 and deep_mop)
            else value,
            floor,
            cleaning,
            behavior,
        )
        for region, value, floor, cleaning, behavior in expected.elements()
        if not (cleaning == 1 and behavior == 3)
    )
    assert coverage_readback_matches(expected, actual, deep_mop_enabled=deep_mop)
    if deep_mop and mode != Mode.VACUUM:
        assert not coverage_readback_matches(expected, actual)


@pytest.mark.parametrize(
    "corruption",
    ("partial", "missing", "duplicate", "floor", "mode", "setting", "region"),
)
def test_heavy_vacuum_rewrite_cannot_hide_corruption(corruption):
    expected = _mixed_goals((Setting.HEAVY_DUTY, Setting.STANDARD))
    actual = Counter(
        (region, 3 if mode == 0 else setting, floor, mode, behavior)
        for region, setting, floor, mode, behavior in expected.elements()
    )
    assert coverage_readback_matches(expected, actual)
    goal = next(goal for goal in actual if goal[3] == 0)
    changed = list(goal)
    actual.subtract({goal: 1})
    if corruption == "partial":
        changed[1] = 0
    elif corruption == "duplicate":
        actual[goal] += 2
    elif corruption == "floor":
        changed[2] = 2
    elif corruption == "mode":
        changed[3] = 1
    elif corruption == "setting":
        changed[1] = 4
    elif corruption == "region":
        changed[0] = str(UUID(int=99))
    if corruption not in ("missing", "duplicate"):
        actual[tuple(changed)] += 1
    assert not coverage_readback_matches(expected, +actual, deep_mop_enabled=True)


def test_heavy_vacuum_requires_a_complete_expected_group():
    expected = _mixed_goals((Setting.HEAVY_DUTY, Setting.STANDARD))
    del expected[next(goal for goal in expected if goal[3] == 0)]
    actual = Counter(
        (region, 3 if mode == 0 else setting, floor, mode, behavior)
        for region, setting, floor, mode, behavior in expected.elements()
    )
    assert not coverage_readback_matches(expected, actual)


def test_rewritten_and_unchanged_complete_room_groups_can_coexist():
    expected = _mixed_goals((Setting.HEAVY_DUTY, Setting.STANDARD))
    actual = Counter(
        (
            region,
            3 if mode == 0 or region == ROOMS[1] else setting,
            floor,
            mode,
            behavior,
        )
        for region, setting, floor, mode, behavior in expected.elements()
    )
    assert coverage_readback_matches(expected, actual, deep_mop_enabled=True)


@pytest.mark.parametrize(
    "states,accepted",
    (
        ((b"\x12\x00", b"\x12\x00"), True),
        ((b"\x0a\x00",), False),
        ((b"",), False),
        ((b"\x0a\x00\x12\x00",), False),
        ((b"\x12\x00", b"\x0a\x00"), False),
        ((b"\x12\x00", b"\x12\x00\x12\x00"), False),
    ),
)
async def test_override_requires_enabled_state_around_a_fresh_plan(states, accepted):
    client = MaticHermesClient("robot.invalid", 16320)
    expected = _mixed_goals()
    actual = _override(expected, omit=True)
    plan = _plan_for_signatures(actual.elements())
    client.async_get_property = AsyncMock(
        side_effect=[plan, states[0], *([plan, states[1]] if len(states) == 2 else [])]
    )
    observed, matched = await client._async_read_coverage_readback(expected)
    assert observed == actual
    assert matched is accepted
    names = ["coverage_plan", "deep_mop_override_setting_state"]
    assert client.async_get_property.await_args_list == [
        call(name) for name in names * len(states)
    ]


async def test_override_does_not_accept_a_stale_first_plan():
    client = MaticHermesClient("robot.invalid", 16320)
    expected = _mixed_goals()
    actual = _override(expected, omit=True)
    changed = actual.copy()
    del changed[next(goal for goal in actual if goal[3] == 0)]
    client.async_get_property = AsyncMock(
        side_effect=[
            _plan_for_signatures(actual.elements()),
            b"\x12\x00",
            _plan_for_signatures(changed.elements()),
            b"\x12\x00",
        ]
    )
    observed, matched = await client._async_read_coverage_readback(expected)
    assert observed == changed
    assert not matched


@pytest.mark.parametrize("kind", ("normal", "mixed"))
@pytest.mark.parametrize("replaced", (False, True))
async def test_override_acceptance_retains_native_identity_fences(kind, replaced):
    client = MaticHermesClient("robot.invalid", 16320)
    floor, payload = _normal_coverage_fixture(Mode.BOTH)
    expected = Counter(coverage_command_goal_signatures(payload))
    actual = _override(expected, omit=True)
    plan = _plan_for_signatures(actual.elements())
    client.async_get_property = AsyncMock(
        side_effect=[plan, b"\x12\x00", plan, b"\x12\x00"]
    )
    session = UUID(int=100)
    identity = _session_identity(session)
    latest = _session_identity(UUID(int=101)) if replaced else identity
    client.async_get_cleaning_session_identity = AsyncMock(
        side_effect=[identity, latest, latest] if kind == "normal" else [latest]
    )
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=True)
    client.async_get_floor_plan = AsyncMock(return_value=floor)

    if kind == "normal":
        run = client._async_wait_for_coverage_readback(
            expected,
            floor,
            pre_dispatch_identity=b"prior",
            expected_session_id=str(session),
        )
    else:
        run = client._async_wait_for_mixed_coverage_readback(
            expected,
            require_current=Mock(),
            expected_identity=identity,
        )
    if replaced:
        with pytest.raises(MaticError, match="mission changed"):
            await run
    else:
        await run
    assert client.async_get_property.await_count == 4
