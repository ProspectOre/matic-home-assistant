"""Causal goal/session evidence uses synthetic identities and complete groups."""

import hashlib
import struct
from copy import deepcopy
from uuid import UUID

import pytest

from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    _wrapped_uuid,
    encode_coverage_command,
)
from custom_components.matic_robot.client.coverage_receipts import (
    coverage_floor_hash,
    coverage_region_hash,
    make_coverage_receipt,
    native_session_hash,
    receipt_from_storage,
    receipt_matches_plan,
)
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.client.wire import (
    bytes_fields,
    decode_fields,
    first_bytes,
    first_varint,
)
from tests.wire_builders import _field, _fixed32, _fixed64, _varint_field

SESSION = UUID(int=987)
REGION = str(UUID(int=123))
PARTITION = str(UUID(int=456))


def receipt_floor():
    return FloorPlan(
        42, PARTITION, b"partition", (Room("room-a", "Room A", REGION, b"room", ()),)
    )


def receipt_command(mode=CleaningMode.BOTH, setting=CoverageSetting.STANDARD):
    return encode_coverage_command(
        mission_id=42,
        partition_id=PARTITION,
        region_ids=[REGION],
        cleaning_mode=mode,
        coverage_setting=setting,
        ordered=True,
        session_id=SESSION,
    )


def receipt_plan(command, *, deep=False, transform_heavy=True, omit_mop=True):
    coverage = first_bytes(first_bytes(first_bytes(command, 15), 1), 3)
    goals = bytes_fields(first_bytes(coverage, 5), 1)
    retained = []
    for goal in goals:
        key = first_bytes(goal, 6)
        spec = first_bytes(key, 3)
        setting, floor, mode, behavior = (first_varint(spec, n) for n in (1, 2, 4, 5))
        if mode == 1 and behavior == 3 and omit_mop:
            continue
        setting = (
            3
            if (mode == 1 and deep) or (mode == 0 and setting == 0 and transform_heavy)
            else setting
        )
        spec = b"".join(
            _varint_field(n, v)
            for n, v in ((1, setting), (2, floor), (4, mode), (5, behavior))
        )
        retained.append(
            _field(6, _field(1, first_bytes(key, 1)) + _field(3, spec))
            + _field(7, first_bytes(goal, 7))
        )
    return _field(7, _field(1, b"".join(_field(1, goal) for goal in retained)))


def history_key(session=SESSION):
    return _field(2, _wrapped_uuid(str(session)))


def active_key(session=SESSION):
    return _field(1, b"\x15" + struct.pack("<I", 42)) + _field(2, history_key(session))


def _plan_with_goals(goals):
    return _field(7, _field(1, b"".join(_field(1, goal) for goal in goals)))


def _command_with_goals(command, goals):
    """Rebuild a synthetic normal command while keeping its session envelope."""
    envelope = first_bytes(command, 15)
    request = first_bytes(envelope, 1)
    coverage = first_bytes(request, 3)
    containers = bytes_fields(coverage, 5)
    assert len(containers) == 1
    rebuilt_container = b"".join(_field(1, goal) for goal in goals)
    rebuilt_coverage = b"".join(
        _field(field.number, field.value)
        if field.wire_type == 2 and field.number != 5
        else _fixed32(field.number, int.from_bytes(field.value, "little"))
        if field.wire_type == 5
        else b""
        for field in decode_fields(coverage)
        if field.number != 5
    ) + _field(5, rebuilt_container)
    return _field(15, _field(1, _field(3, rebuilt_coverage)))


@pytest.mark.parametrize("mode", CleaningMode)
@pytest.mark.parametrize("setting", CoverageSetting)
@pytest.mark.parametrize("deep", (False, True))
async def test_receipt_requires_echoed_goals_and_qualifies_native_transformations(
    mode, setting, deep
):
    command = receipt_command(mode, setting)
    plan = receipt_plan(command, deep=deep)
    receipt = make_coverage_receipt(
        command, plan, receipt_floor(), str(SESSION), deep_mop_enabled=deep
    )
    if mode == CleaningMode.MOP:
        assert receipt is None
        return
    assert receipt is not None
    assert len(receipt.rooms) == 1
    assert receipt.rooms[0].coverage_setting == setting
    assert receipt.rooms[0].region_hash == coverage_region_hash(REGION)
    assert receipt.session_hash == hashlib.sha256(str(SESSION).encode()).hexdigest()
    assert receipt.floor_hash == coverage_floor_hash(receipt_floor())
    assert receipt_matches_plan(receipt, plan)
    assert receipt_from_storage(receipt.as_storage()) == receipt
    assert REGION not in str(receipt.as_storage()) and str(SESSION) not in str(
        receipt.as_storage()
    )


def test_different_same_value_goals_cannot_create_or_confirm_a_receipt():
    command = receipt_command()
    plan = receipt_plan(command)
    receipt = make_coverage_receipt(command, plan, receipt_floor(), str(SESSION))
    assert receipt is not None
    unrelated = receipt_plan(receipt_command())
    assert (
        make_coverage_receipt(command, unrelated, receipt_floor(), str(SESSION)) is None
    )
    assert not receipt_matches_plan(receipt, unrelated)
    assert (
        make_coverage_receipt(command, plan, receipt_floor(), str(UUID(int=999)))
        is None
    )


def test_receipt_rejects_plan_with_different_goal_settings():
    command = receipt_command(setting=CoverageSetting.QUICK)
    quick_plan = receipt_plan(command, transform_heavy=False)
    standard_plan = receipt_plan(
        receipt_command(setting=CoverageSetting.STANDARD), transform_heavy=False
    )
    receipt = make_coverage_receipt(command, quick_plan, receipt_floor(), str(SESSION))
    assert receipt is not None

    assert (
        make_coverage_receipt(command, standard_plan, receipt_floor(), str(SESSION))
        is None
    )
    assert not receipt_matches_plan(receipt, standard_plan)


@pytest.mark.parametrize(
    "bad_command,bad_plan",
    (
        (b"", None),
        (receipt_command() + _field(15, b""), None),
        (receipt_command() + _varint_field(15, 1), None),
        (None, _varint_field(7, 1)),
    ),
)
def test_receipt_rejects_missing_repeated_or_wrong_wire_envelopes(
    bad_command, bad_plan
):
    command = receipt_command()
    plan = receipt_plan(command)
    assert (
        make_coverage_receipt(
            bad_command if bad_command is not None else command,
            bad_plan if bad_plan is not None else plan,
            receipt_floor(),
            str(SESSION),
        )
        is None
    )


def test_receipt_rejects_repeated_goal_identity_and_incomplete_group():
    command = receipt_command(CleaningMode.VACUUM)
    plan = receipt_plan(command, transform_heavy=False)
    plan_root = first_bytes(plan, 7)
    plan_group = first_bytes(plan_root, 1)
    plan_goals = bytes_fields(plan_group, 1)
    assert (
        make_coverage_receipt(
            command,
            _plan_with_goals((*plan_goals, plan_goals[0])),
            receipt_floor(),
            str(SESSION),
        )
        is None
    )

    coverage = first_bytes(first_bytes(first_bytes(command, 15), 1), 3)
    goal_container = bytes_fields(coverage, 5)[0]
    command_goals = bytes_fields(goal_container, 1)
    incomplete_command = _command_with_goals(command, command_goals[:-1])
    incomplete_plan = _plan_with_goals(plan_goals[:-1])
    assert (
        make_coverage_receipt(
            incomplete_command, incomplete_plan, receipt_floor(), str(SESSION)
        )
        is None
    )


def test_receipt_rejects_mixed_settings_for_one_room():
    command = encode_coverage_command(
        mission_id=42,
        partition_id=PARTITION,
        region_ids=[REGION, REGION],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.QUICK,
        ordered=True,
        session_id=SESSION,
        _region_settings=[CoverageSetting.QUICK, CoverageSetting.STANDARD],
    )
    plan = receipt_plan(command, transform_heavy=False)

    assert make_coverage_receipt(command, plan, receipt_floor(), str(SESSION)) is None


def test_changed_same_session_settings_cannot_confirm_a_receipt():
    command = receipt_command(setting=CoverageSetting.HEAVY_DUTY)
    receipt = make_coverage_receipt(
        command, receipt_plan(command), receipt_floor(), str(SESSION)
    )
    assert receipt is not None
    assert not receipt_matches_plan(
        receipt, receipt_plan(command, transform_heavy=False)
    )
    assert not receipt_matches_plan(receipt, b"malformed")
    assert (
        make_coverage_receipt(command, b"malformed", receipt_floor(), str(SESSION))
        is None
    )


@pytest.mark.parametrize("active", (False, True))
def test_native_session_key_requires_exact_known_shape(active):
    valid = active_key() if active else history_key()
    expected = hashlib.sha256(str(SESSION).encode()).hexdigest()
    assert native_session_hash(valid, active=active) == expected
    for malformed in (b"", b"bad", valid * 2, valid + _field(9, b""), b"x" * 97):
        assert native_session_hash(malformed, active=active) is None


def test_active_session_requires_the_observed_mission_id_wire_shape():
    wrong_wire = _field(1, _varint_field(2, 42)) + _field(2, history_key())
    missing_mission = _field(2, history_key())
    repeated_mission = active_key() + _field(1, b"\x15" + struct.pack("<I", 42))

    assert native_session_hash(wrong_wire, active=True) is None
    assert native_session_hash(missing_mission, active=True) is None
    assert native_session_hash(repeated_mission, active=True) is None


@pytest.mark.parametrize(
    "leaf",
    (
        b"",
        _fixed64(1, 1),
        _fixed64(1, 1) * 2,
        _fixed64(1, 1) + _varint_field(2, 2),
        _fixed64(1, 1) + _fixed64(2, 2) + _fixed64(2, 3),
    ),
)
def test_native_session_key_rejects_ambiguous_uuid_leaves(leaf):
    assert native_session_hash(_field(2, _field(2, leaf))) is None


@pytest.mark.parametrize(
    "mutate",
    (
        lambda s: s.update(version=True),
        lambda s: s.update(version=2),
        lambda s: s.update(session_hash="short"),
        lambda s: s.update(floor_hash="G" * 64),
        lambda s: s.update(rooms={}),
        lambda s: s.update(rooms=[]),
        lambda s: s.update(rooms=s["rooms"] * 513),
        lambda s: s.update(rooms=[None]),
        lambda s: s.update(rooms=s["rooms"] * 2),
        lambda s: s["rooms"][0].update(region_hash="x"),
        lambda s: s["rooms"][0].update(goals_hash="x"),
        lambda s: s["rooms"][0].update(coverage_setting=[]),
        lambda s: s["rooms"][0].update(coverage_setting="unknown"),
    ),
)
def test_stored_receipts_reject_malformed_or_oversized_proof(mutate):
    command = receipt_command()
    receipt = make_coverage_receipt(
        command, receipt_plan(command), receipt_floor(), str(SESSION)
    )
    assert receipt is not None
    stored = deepcopy(receipt.as_storage())
    mutate(stored)
    assert receipt_from_storage(stored) is None
    assert receipt_from_storage(None) is None
