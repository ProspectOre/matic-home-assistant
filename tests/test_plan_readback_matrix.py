"""Configuration and corruption matrices for retained per-room coverage goals."""

from collections import Counter
from itertools import product
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
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
    UserCommand,
    encode_mixed_coverage_commands,
)
from custom_components.matic_robot.client.coverage_goals import (
    coverage_command_goal_signatures,
    coverage_plan_goal_signatures,
    coverage_readback_matches,
)
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import FloorPlan, RobotActivity
from custom_components.matic_robot.client.wire import bytes_fields, first_bytes
from tests.wire_builders import _field

PARTITION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OPTIONS = tuple(product(Mode, Setting))


def _commands(configuration):
    return encode_mixed_coverage_commands(**_arguments(configuration))


def _arguments(configuration):
    return {
        "mission_id": 42,
        "partition_id": PARTITION,
        "region_ids": [str(UUID(int=i + 1)) for i in range(len(configuration))],
        "modes": [mode for mode, _ in configuration],
        "settings": [setting for _, setting in configuration],
    }


def _coverage(payload):
    return first_bytes(first_bytes(first_bytes(payload, 15), 1), 3)


def _readback(update, *, drop_required=False):
    """Synthetic firmware omits mop behavior 3 separately in every room."""
    signatures = coverage_command_goal_signatures(update)
    goals = bytes_fields(first_bytes(_coverage(update), 5), 1)
    retained = [
        goal
        for signature, goal in zip(signatures, goals, strict=True)
        if signature[2:] != (0, 1, 3)
    ]
    if drop_required:
        retained.pop(0)
    return _field(7, _field(1, b"".join(_field(1, goal) for goal in retained)))


@pytest.mark.parametrize("configuration", product(OPTIONS, repeat=3))
def test_three_room_configuration_matrix(configuration):
    """Every mode/setting triple and every subset of normalized mop rooms."""
    commands = _commands(configuration)
    expected = Counter(coverage_command_goal_signatures(commands.update))
    optional = [goal for goal in expected if goal[2:] == (0, 1, 3)]
    for omitted in product((False, True), repeat=len(optional)):
        missing = Counter(
            goal for goal, remove in zip(optional, omitted, strict=True) if remove
        )
        actual = expected - missing
        assert coverage_readback_matches(expected, actual)
        # No room may lose any other vacuum or mop goal, even when its peers
        # have the same mode/setting and complete retained goal sets.
        for goal in actual:
            if goal[2:] != (0, 1, 3):
                assert not coverage_readback_matches(
                    expected, actual - Counter({goal: 1})
                )


@pytest.mark.parametrize("room_count", (2, 4, 16, 64))
@pytest.mark.parametrize("mode", (Mode.MOP, Mode.BOTH))
def test_normalization_scales_by_room_without_mission_wide_limit(room_count, mode):
    configuration = [(mode, tuple(Setting)[i % 3]) for i in range(room_count)]
    commands = _commands(configuration)
    expected = Counter(coverage_command_goal_signatures(commands.update))
    actual = Counter(coverage_plan_goal_signatures(_readback(commands.update)))
    assert (expected - actual).total() == room_count
    assert coverage_readback_matches(expected, actual)


def test_four_room_combined_vacuum_combined_combined_regression():
    configuration = [
        (m, Setting.QUICK) for m in (Mode.BOTH, Mode.VACUUM, Mode.BOTH, Mode.BOTH)
    ]
    commands = _commands(configuration)
    expected = Counter(coverage_command_goal_signatures(commands.update))
    actual = Counter(coverage_plan_goal_signatures(_readback(commands.update)))
    assert expected.total() == 44
    assert actual.total() == 41
    assert coverage_readback_matches(expected, actual)
    initial = Counter(coverage_command_goal_signatures(commands.initial))
    assert not coverage_readback_matches(expected, initial)


@pytest.mark.parametrize("field", range(5))
def test_normalization_rejects_changed_room_setting_floor_mode_or_behavior(field):
    commands = _commands([(Mode.BOTH, Setting.QUICK), (Mode.MOP, Setting.HEAVY_DUTY)])
    expected = Counter(coverage_command_goal_signatures(commands.update))
    actual = Counter(coverage_plan_goal_signatures(_readback(commands.update)))
    for goal in actual:
        changed = list(goal)
        changed[field] = str(UUID(int=999)) if field == 0 else 99
        corrupted = actual - Counter({goal: 1}) + Counter({tuple(changed): 1})
        assert not coverage_readback_matches(expected, corrupted)


def test_normalization_rejects_duplicates_and_goals_borrowed_from_another_room():
    commands = _commands([(Mode.MOP, Setting.QUICK)] * 2)
    expected = Counter(coverage_command_goal_signatures(commands.update))
    actual = Counter(coverage_plan_goal_signatures(_readback(commands.update)))
    first, second = [goal for goal in actual if goal[-1] == 0]
    assert not coverage_readback_matches(expected, actual + Counter({first: 1}))
    assert not coverage_readback_matches(
        expected, actual - Counter({second: 1}) + Counter({first: 1})
    )


def test_normalization_requires_complete_unique_sibling_goals_in_expected_command():
    expected = Counter(
        coverage_command_goal_signatures(
            _commands([(Mode.MOP, Setting.QUICK)] * 2).update
        )
    )
    optional = next(goal for goal in expected if goal[-1] == 3)
    sibling = (*optional[:-1], 0)
    for count in (0, 2):
        malformed = expected.copy()
        malformed[sibling] = count
        actual = malformed - Counter({optional: 1})
        assert not coverage_readback_matches(malformed, actual)
    duplicate = expected + Counter({optional: 1})
    assert not coverage_readback_matches(duplicate, expected)
    # Even a malformed command with two settings for one room cannot make
    # two omissions for that room look like independent normalizations.
    extra = Counter({(optional[0], 0, 0, 1, behavior): 1 for behavior in range(4)})
    malformed = expected + extra
    assert not coverage_readback_matches(
        malformed, malformed - Counter({optional: 1, (optional[0], 0, 0, 1, 3): 1})
    )


@pytest.mark.parametrize("configuration", product(OPTIONS, repeat=2))
@pytest.mark.parametrize("drop_required", (False, True))
async def test_actual_client_verifies_each_configuration_and_stops_corruption(
    configuration, drop_required, monkeypatch
):
    """Exercise real encoding, readback parsing, identity guards and recovery."""
    client = MaticHermesClient("robot.invalid", 16320)
    args = _arguments(configuration)
    floor = FloorPlan(42, PARTITION, b"partition", ())
    identity = b""
    started_identity = b""
    update = b""

    async def send(payload, *, command_name):
        nonlocal identity, started_identity, update
        if command_name == "START_COVERAGE":
            started_identity = first_bytes(_coverage(payload), 6)
            identity = started_identity
        else:
            assert command_name == "UPDATE_COVERAGE"
            update = payload

    async def get_property(name):
        assert name == "coverage_plan"
        return _readback(update, drop_required=drop_required)

    client._async_send_user_payload = AsyncMock(side_effect=send)
    client.async_get_cleaning_session_identity = AsyncMock(side_effect=lambda: identity)
    client.async_get_state = AsyncMock(
        side_effect=lambda: SimpleNamespace(
            activity=RobotActivity.CLEANING if identity else RobotActivity.READY,
            cleaning=bool(identity),
            error_codes=(),
            state_codes=(),
            current_area="First" if identity else None,
        )
    )
    client.async_get_floor_plan = AsyncMock(return_value=floor)
    client.async_get_property = AsyncMock(side_effect=get_property)
    stopped_sessions = []

    async def send_stop(command, *, on_transmitted=None):
        stopped_sessions.append((command, identity))
        assert on_transmitted is not None
        on_transmitted()

    client.async_send_user_command = AsyncMock(side_effect=send_stop)
    prepare_stop, rollback_stop = AsyncMock(), AsyncMock()
    require_owned = Mock()
    recovery_stop_transmitted = Mock()
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.monotonic", iter((0.0, 9.0)).__next__
    )

    async def dispatch():
        await client.async_start_mixed_coverage(
            floor,
            args["region_ids"],
            args["settings"],
            args["modes"],
            first_room_name="First",
            require_current=Mock(),
            require_owned=require_owned,
            prepare_stop=prepare_stop,
            rollback_stop=rollback_stop,
            on_recovery_stop_transmitted=recovery_stop_transmitted,
        )

    if drop_required:
        with pytest.raises(MaticError, match="did not retain all requested"):
            await dispatch()
        prepare_stop.assert_awaited_once()
        stop = client.async_send_user_command.await_args
        assert stop.args == (UserCommand.STOP,)
        assert set(stop.kwargs) == {"on_transmitted"}
        assert callable(stop.kwargs["on_transmitted"])
        assert stopped_sessions == [(UserCommand.STOP, started_identity)]
        recovery_stop_transmitted.assert_called_once_with()
        require_owned.assert_called()
    else:
        await dispatch()
        prepare_stop.assert_not_awaited()
        client.async_send_user_command.assert_not_awaited()
        recovery_stop_transmitted.assert_not_called()
    assert client._async_send_user_payload.await_count == 2
    rollback_stop.assert_not_awaited()
