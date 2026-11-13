"""Native completion accounting across replay, policy ownership and resets."""

from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.coverage_receipts import native_session_hash
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.completion_ledger import (
    record_completion,
    reset_progress,
)
from custom_components.matic_robot.native_cadence import import_native_cadence
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    room_cadence_identity,
)
from tests.session_fakes import FakeRobot
from tests.test_cadence_manager import _floor
from tests.test_coverage_receipts import history_key


def scenario():
    now = dt_util.utcnow()
    floor = _floor()
    session = CleaningSession(
        started_at=(now - timedelta(minutes=3)).isoformat(),
        ended_at=(now - timedelta(minutes=2)).isoformat(),
        duration_seconds=60,
        rooms=("Kitchen",),
        room_durations=(),
        completed=True,
        mission_id=floor.mission_id,
        partition_id=floor.partition_protocol_id,
        initiator="app",
        stop_reason="finished",
        completion_kind="completed",
        mode_results=(
            CleaningModeResult("Kitchen", "vacuum", "completed", 60, "room-proto"),
        ),
    )
    record = CleaningSessionRecord(history_key(), session)
    schedule = {
        "identity": room_cadence_identity(floor, "room-a"),
        "policy": {
            "mop_every_n": 3,
            "coverage_every_n": 3,
            "periodic_coverage_setting": "heavy_duty",
        },
        "progress": {"mop": 0, "coverage": 0},
    }
    robot = {
        "native_cleanings": {
            "enabled": True,
            "since": (now - timedelta(hours=1)).isoformat(),
        },
        "shared_room_cadence": {"room-a": schedule},
        "managed_native_sessions": {},
    }
    import_native_cadence(robot, floor, [])
    return floor, record, schedule, robot


def test_replay_revision_disabled_and_retention():
    floor, record, schedule, robot = scenario()
    assert import_native_cadence(robot, floor, [record])
    assert schedule["progress"] == {"mop": 1, "coverage": 1}
    baseline = deepcopy(robot)
    assert not import_native_cadence(robot, floor, [record])
    assert robot == baseline
    assert not import_native_cadence(robot, floor, [])
    robot["native_cleanings"]["enabled"] = False
    cancelled = replace(
        record, session=replace(record.session, stop_reason="user_cancelled")
    )
    assert import_native_cadence(robot, floor, [cancelled])
    assert schedule["progress"] == {"mop": 0, "coverage": 0}
    assert import_native_cadence(robot, floor, [record])
    assert schedule["progress"] == {"mop": 1, "coverage": 1}
    new = replace(record, key=history_key(UUID(int=900)))
    assert not import_native_cadence(robot, floor, [new])


@pytest.mark.parametrize(
    "updates",
    [
        {"mission_id": 99},
        {"partition_id": "other"},
        {"initiator": None},
        {"stop_reason": "user_cancelled"},
        {"completion_kind": "incomplete"},
        {"started_at": None},
        {"ended_at": "invalid"},
        {"started_at": "2020-01-01T00:00:00+00:00"},
        {"ended_at": "2099-01-01T00:00:00+00:00"},
        {
            "mode_results": (
                CleaningModeResult("Kitchen", "vacuum", "completed", 60, "other"),
            )
        },
    ],
)
def test_unverified_or_historical_sessions_do_not_count(updates):
    floor, record, schedule, robot = scenario()
    assert not import_native_cadence(
        robot, floor, [replace(record, session=replace(record.session, **updates))]
    )
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


def test_claimed_private_managed_session_is_never_external():
    floor, record, schedule, robot = scenario()
    robot["managed_native_sessions"][native_session_hash(record.key)] = {
        "run_id": "private"
    }
    assert not import_native_cadence(robot, floor, [record])
    assert "accounting" not in schedule


def test_reset_prevents_replay_and_new_policy_cannot_backfill():
    floor, record, schedule, robot = scenario()
    assert import_native_cadence(robot, floor, [record])
    assert reset_progress(
        schedule, ["mop", "coverage"], at=dt_util.utcnow().timestamp()
    )
    assert not import_native_cadence(robot, floor, [record])
    assert schedule["progress"] == {"mop": 0, "coverage": 0}
    schedule.pop("accounting")
    schedule.pop("native_events")
    schedule["native_since"] = dt_util.utcnow().isoformat()
    assert not import_native_cadence(robot, floor, [record])


def test_correction_replays_later_managed_completion():
    floor, record, schedule, robot = scenario()
    assert import_native_cadence(robot, floor, [record])
    snapshot = {
        "scope": "shared",
        "schedule_active": True,
        "mop_every_n": 3,
        "coverage_every_n": 3,
        "periodic_coverage_setting": "heavy_duty",
        "mop_due": False,
        "coverage_due": False,
    }
    assert record_completion(
        schedule,
        "f" * 64,
        at=dt_util.utcnow().timestamp(),
        source="managed",
        snapshot=snapshot,
        mode="vacuum",
    )
    assert schedule["progress"] == {"mop": 2, "coverage": 2}
    revised = replace(record, session=replace(record.session, partition_id="changed"))
    assert import_native_cadence(robot, floor, [revised])
    assert schedule["progress"] == {"mop": 1, "coverage": 1}


async def test_option_activation_is_durable_and_idempotent(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.ledger.async_set_native_cleanings_enabled("serial", True)
    first = deepcopy(manager.repository.robot("serial")["native_cleanings"])
    await manager.ledger.async_set_native_cleanings_enabled("serial", True)
    assert manager.repository.robot("serial")["native_cleanings"] == first
    assert manager.repository.store.async_save.await_count == 1
    await manager.ledger.async_set_native_cleanings_enabled("serial", False)
    assert manager.repository.robot("serial")["native_cleanings"]["enabled"] is False
    with pytest.raises(ValueError):
        await manager.ledger.async_set_native_cleanings_enabled("serial", "yes")


async def test_claim_save_failure_prevents_reservation_and_ownership_is_checked(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_save=AsyncMock(side_effect=OSError("disk"))
    )
    with pytest.raises(OSError):
        await manager.ledger.async_claim_native_session("serial", str(UUID(int=32)))
    assert not manager.repository.robot("serial")["managed_native_sessions"]
    manager.repository.store.async_save = AsyncMock()
    with pytest.raises(ValueError, match="no longer owns"):
        await manager.ledger.async_claim_native_session(
            "serial", str(UUID(int=32)), run_id="wrong"
        )
    await manager.ledger.async_claim_native_session("serial", str(UUID(int=32)))
    await manager.ledger.async_claim_native_session("serial", str(UUID(int=32)))
    assert manager.repository.store.async_save.await_count == 1


async def test_managed_claim_window_retains_latest_sessions(hass, monkeypatch):
    from custom_components.matic_robot import plan_state

    monkeypatch.setattr(plan_state, "MAX_MANAGED_NATIVE_SESSION_CLAIMS", 2)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    sessions = [str(UUID(int=index)) for index in (40, 41, 42)]

    for session in sessions:
        await manager.ledger.async_claim_native_session("serial", session)

    claims = manager.repository.robot("serial")["managed_native_sessions"]
    assert set(claims) == {
        native_session_hash(history_key(UUID(session))) for session in sessions[-2:]
    }
    assert manager.repository.store.async_save.await_count == 3


def test_loaded_managed_claims_are_validated_and_bounded(hass, monkeypatch):
    from custom_components.matic_robot import plan_state

    monkeypatch.setattr(plan_state, "MAX_MANAGED_NATIVE_SESSION_CLAIMS", 2)
    manager = CleaningPlanManager(hass)
    robot = manager.repository.robot("serial")
    robot["managed_native_sessions"] = {
        "bad": {},
        "1" * 64: {"run_id": "old"},
        "2" * 64: {"run_id": "second"},
        "3" * 64: {"run_id": "latest"},
        "4" * 64: [],
    }

    assert plan_state._normalize_robot(robot)

    assert robot["managed_native_sessions"] == {
        "2" * 64: {"run_id": "second"},
        "3" * 64: {"run_id": "latest"},
    }


@pytest.mark.parametrize(
    "kind", ["duplicate", "bool_duration", "identity", "policy", "schedule", "key"]
)
def test_invalid_native_admission_is_fail_closed(kind):
    floor, record, schedule, robot = scenario()
    if kind == "duplicate":
        record = replace(
            record,
            session=replace(
                record.session, mode_results=record.session.mode_results * 2
            ),
        )
    elif kind == "bool_duration":
        record = replace(
            record,
            session=replace(
                record.session,
                mode_results=(
                    replace(record.session.mode_results[0], duration_seconds=True),
                ),
            ),
        )
    elif kind == "identity":
        schedule["identity"] = "wrong"
    elif kind == "policy":
        schedule["policy"] = None
    elif kind == "schedule":
        robot["shared_room_cadence"]["room-a"] = None
    else:
        record = replace(record, key=b"invalid")
    assert not import_native_cadence(robot, floor, [record])
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


async def test_canonical_manager_import_resolves_protocol_uuid_not_local_room_id(hass):
    floor, record, _schedule, _robot = scenario()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    assert await manager.ledger.async_import_native_history("serial", floor, [record])
    stats = manager.repository.robot("serial")["rooms"]["room-a"]
    assert stats["last_opportunity"] == record.session.ended_at
    assert stats["robot_last_partition_hash"]
    assert not await manager.ledger.async_import_native_history(
        "serial", floor, [record]
    )
    wrong = replace(record, session=replace(record.session, mission_id=42))
    await manager.ledger.async_import_native_history("serial", floor, [wrong])
    assert (
        "robot_last_completed"
        not in manager.repository.robot("serial")["rooms"]["room-a"]
    )
    assert (
        manager.repository.robot("serial")["rooms"]["room-a"]["last_opportunity"]
        == record.session.ended_at
    )


async def test_closed_metadata_admission_cannot_silently_claim_a_dispatch(hass):
    from custom_components.matic_robot.plans import MetadataAdmissionClosedError

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.repository.async_close_metadata_admission_and_wait("serial")
    with pytest.raises(MetadataAdmissionClosedError):
        await manager.ledger.async_claim_native_session("serial", str(UUID(int=9)))
    manager.repository.store.async_save.assert_not_awaited()


async def test_dispatch_never_sends_before_claim_or_after_floor_changes():
    from homeassistant.exceptions import ServiceValidationError

    from custom_components.matic_robot.managed_dispatch import (
        _async_dispatch_leg_command,
    )
    from custom_components.matic_robot.plans import CleaningRoom

    robot = FakeRobot()
    claim = AsyncMock(side_effect=OSError("disk"))
    args = (
        robot.port(),
        [CleaningRoom("room-a", "Kitchen", "vacuum", "standard")],
        7,
    )
    with pytest.raises(OSError):
        await _async_dispatch_leg_command(*args, floor_token="floor", on_claim=claim)
    claim.assert_awaited_once()
    assert not robot.started
    states = iter((True, True, False))
    claim = AsyncMock()
    with pytest.raises(ServiceValidationError):
        await _async_dispatch_leg_command(
            *args,
            floor_token="floor",
            on_claim=claim,
            floor_is_current=lambda: next(states),
        )
    claim.assert_awaited_once()
    assert not robot.started


def test_shared_managed_ledger_deduplicates_completion():
    from custom_components.matic_robot.cadence_accounting import apply_verified_cadence
    from custom_components.matic_robot.plans import CleaningRoom
    from tests.test_completion_ledger import _snapshot

    _floor_value, _record, schedule, robot = scenario()
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    snapshot = _snapshot(scope="shared")
    kwargs = {"completion_id": "e" * 64, "completed_at": dt_util.utcnow().timestamp()}
    assert apply_verified_cadence(robot, "plan", room, snapshot, **kwargs)
    before = deepcopy(schedule)
    assert not apply_verified_cadence(robot, "plan", room, snapshot, **kwargs)
    assert schedule == before


def test_delayed_records_use_verified_saved_floor_bindings():
    floor, record, schedule, robot = scenario()
    other = replace(floor, mission_id=8, partition_protocol_id="other", rooms=())
    # First arrival while another floor is active still belongs to this saved
    # schedule's previously verified mission/partition/room identity.
    assert import_native_cadence(robot, other, [record])
    assert schedule["progress"]["mop"] == 1
    cancelled = replace(
        record, session=replace(record.session, stop_reason="user_cancelled")
    )
    assert import_native_cadence(robot, other, [cancelled])
    assert schedule["progress"]["mop"] == 0
    # A newly loaded inventory can establish the binding before this floor
    # becomes active in this process, with the same exact identity check.
    schedule.pop("native_binding")
    schedule.pop("native_events")
    schedule.pop("accounting")
    assert import_native_cadence(
        robot, replace(other, history_floor_plans=(floor, other)), [record]
    )
    assert schedule["progress"]["mop"] == 1
    # Rebinding invalidates both earlier event and native floor proofs.
    schedule["identity"] = "different-map"
    assert import_native_cadence(robot, other, [record])
    assert schedule["progress"]["mop"] == 0


async def test_malformed_revision_retracts_cached_canonical_statistics(hass):
    floor, record, _schedule, _robot = scenario()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.ledger.async_import_native_history("serial", floor, [record])
    assert manager.repository.robot("serial")["rooms"]["room-a"]["robot_last_completed"]
    rejected = replace(record, session=CleaningSession(None, None, None, (), (), None))
    other = replace(floor, mission_id=8, partition_protocol_id="other", rooms=())
    assert await manager.ledger.async_import_native_history("serial", other, [rejected])
    assert (
        "robot_last_completed"
        not in manager.repository.robot("serial")["rooms"]["room-a"]
    )
    await manager.ledger.async_import_native_history("serial", floor, [record])
    assert (
        "robot_last_completed"
        not in manager.repository.robot("serial")["rooms"]["room-a"]
    )
