"""Per-room daily limits use only bounded, verified completion evidence."""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest
from aiohttp.test_utils import make_mocked_request
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import ServiceValidationError, Unauthorized
from homeassistant.helpers.http import KEY_HASS
from homeassistant.util import dt as dt_util

from custom_components.matic_robot import daily_room_limit, native_history
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.daily_limit_view import MaticDailyLimitView
from custom_components.matic_robot.http import DAILY_LIMIT_API_URL
from custom_components.matic_robot.plan_model import (
    CleaningRoom,
    SharedRoomScheduleLockedError,
    plan_floor_token,
    room_cadence_identity,
)
from custom_components.matic_robot.plan_repository import MetadataAdmissionClosedError
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.room_sequence import resolve_room_sequence
from custom_components.matic_robot.vacuum import MaticVacuum
from tests.test_entities import _entry

SERIAL = "serial"
ROOM_ID = "kitchen"


def _floor():
    return FloorPlan(
        1, "partition", b"partition", (Room(ROOM_ID, "Kitchen", "p", b"k", ()),)
    )


def _state(robot, identity, now, zone="America/Los_Angeles"):
    return daily_room_limit.daily_state(
        robot, ROOM_ID, identity, now=now, timezone=ZoneInfo(zone)
    )


def test_local_day_rollover_and_dst_count_actual_completion_instants():
    identity = "a" * 64
    robot = {"daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 2}}}
    # 01:30 occurs twice when Pacific daylight time falls back.
    first = datetime(2026, 11, 1, 8, 30, tzinfo=UTC)
    second = datetime(2026, 11, 1, 9, 30, tzinfo=UTC)
    daily_room_limit.record_completion(
        robot, ROOM_ID, identity, first.isoformat(), now=first
    )
    daily_room_limit.record_completion(
        robot, ROOM_ID, identity, second.isoformat(), now=second
    )
    assert _state(robot, identity, second) == {
        "limit": 2,
        "completed_today": 2,
        "reached": True,
    }
    assert _state(robot, identity, datetime(2026, 11, 2, 8, 1, tzinfo=UTC)) == {
        "limit": 2,
        "completed_today": 0,
        "reached": False,
    }
    assert _state(robot, identity, second, "UTC")["completed_today"] == 2


def test_legacy_or_ambiguous_completion_and_overflow_fail_closed():
    identity = "b" * 64
    now = datetime(2026, 7, 1, 18, tzinfo=UTC)
    robot = {
        "daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 2}},
        "rooms": {ROOM_ID: {"last_completed": now.isoformat()}},
    }
    assert _state(robot, identity, now)["reason"] == "completion_history_unverified"
    assert not _state(robot, identity, now + timedelta(days=1))["reached"]
    daily_room_limit.record_completion(robot, ROOM_ID, None, now.isoformat(), now=now)
    assert _state(robot, identity, now)["reached"]
    assert _state(robot, "c" * 64, now)["reason"] == "room_identity_unconfirmed"
    robot["daily_room_completions"][ROOM_ID]["overflow_until"] = (
        now + timedelta(hours=1)
    ).isoformat()
    assert _state(robot, identity, now)["reason"] == "completion_history_unverified"


def test_bounded_receipt_overflow_cannot_silently_reopen_allowance(monkeypatch):
    monkeypatch.setattr(daily_room_limit, "MAX_RECENT_COMPLETIONS", 2)
    identity = "d" * 64
    now = datetime(2026, 7, 1, 18, tzinfo=UTC)
    robot = {"daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 3}}}
    for _ in range(3):
        daily_room_limit.record_completion(
            robot, ROOM_ID, identity, now.isoformat(), now=now
        )
    assert len(robot["daily_room_completions"][ROOM_ID]["receipts"]) == 2
    state = _state(robot, identity, now)
    assert state["completed_today"] == 2
    assert state["reached"] is True
    assert state["reason"] == "completion_history_unverified"


def test_corrupt_receipts_remain_held_after_a_new_completion():
    identity = "d" * 64
    now = datetime(2026, 7, 1, 18, tzinfo=UTC)
    robot = {
        "daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 3}},
        "daily_room_completions": {ROOM_ID: {"receipts": None}},
    }
    assert _state(robot, identity, now)["reached"]
    daily_room_limit.record_completion(
        robot, ROOM_ID, identity, now.isoformat(), now=now
    )
    assert _state(robot, identity, now)["reason"] == "completion_history_unverified"
    robot["daily_room_completions"][ROOM_ID] = {
        "receipts": [{"at": now.isoformat(), "identity": "malformed"}]
    }
    assert _state(robot, identity, now)["reason"] == "completion_history_unverified"


@pytest.mark.parametrize(
    ("policies", "records", "reason"),
    [
        ([], {}, "invalid_policy"),
        ({ROOM_ID: None}, {}, "invalid_policy"),
        ({ROOM_ID: {"identity": "d" * 64, "limit": 0}}, {}, "invalid_policy"),
        (
            {ROOM_ID: {"identity": "d" * 64, "limit": 2}},
            [],
            "completion_history_unverified",
        ),
        (
            {ROOM_ID: {"identity": "d" * 64, "limit": 2}},
            {ROOM_ID: []},
            "completion_history_unverified",
        ),
        (
            {ROOM_ID: {"identity": "d" * 64, "limit": 2}},
            {ROOM_ID: {"overflow_until": "invalid"}},
            "completion_history_unverified",
        ),
        (
            {ROOM_ID: {"identity": "d" * 64, "limit": 2}},
            {ROOM_ID: {"receipts": [{"at": "invalid"}]}},
            "completion_history_unverified",
        ),
    ],
)
def test_corrupt_policy_or_history_fails_closed(policies, records, reason):
    now = datetime(2026, 7, 1, 18, tzinfo=UTC)
    robot = {"daily_room_limits": policies, "daily_room_completions": records}
    assert _state(robot, "d" * 64, now)["reason"] == reason


def test_missing_timezone_and_ambiguous_receipt_fail_closed():
    identity = "d" * 64
    now = datetime(2026, 7, 1, 18, tzinfo=UTC)
    robot = {
        "daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 2}},
        "daily_room_completions": {
            ROOM_ID: {
                "receipts": [
                    {
                        "at": now.isoformat(),
                        "identity": identity,
                        "unverified": "invalid",
                    }
                ]
            }
        },
    }
    assert (
        daily_room_limit.daily_state(robot, ROOM_ID, identity, now=now, timezone=None)[
            "reason"
        ]
        == "timezone_unavailable"
    )
    assert _state(robot, identity, now)["reason"] == "completion_history_unverified"


@pytest.mark.parametrize(
    "completed_at",
    [
        datetime(2026, 7, 1, 13, tzinfo=UTC),
        datetime(2026, 7, 2, 12, tzinfo=UTC),
    ],
    ids=("future-same-day", "future-next-day"),
)
def test_future_completion_timestamp_is_held_instead_of_counted(completed_at):
    identity = "e" * 64
    now = datetime(2026, 7, 1, 12, tzinfo=UTC)
    robot = {"daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 1}}}

    assert daily_room_limit.record_completion(
        robot, ROOM_ID, identity, completed_at.isoformat(), now=now
    )

    row = robot["daily_room_completions"][ROOM_ID]
    assert "receipts" not in row
    assert row["unknown_time_until"] == (now + timedelta(hours=72)).isoformat()
    state = _state(robot, identity, now)
    assert state["completed_today"] == 0
    assert state["reached"] is True
    assert state["reason"] == "completion_history_unverified"


@pytest.mark.parametrize(
    "receipt_at",
    [
        datetime(2026, 7, 1, 13, tzinfo=UTC),
        datetime(2026, 7, 2, 12, tzinfo=UTC),
    ],
    ids=("future-same-day", "future-next-day"),
)
def test_future_receipt_from_older_storage_fails_closed_without_counting(receipt_at):
    identity = "f" * 64
    now = datetime(2026, 7, 1, 12, tzinfo=UTC)
    robot = {
        "daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 1}},
        "daily_room_completions": {
            ROOM_ID: {
                "receipts": [{"at": receipt_at.isoformat(), "identity": identity}]
            }
        },
    }

    state = _state(robot, identity, now)

    assert state["completed_today"] == 0
    assert state["reached"] is True
    assert state["reason"] == "completion_history_unverified"


@pytest.mark.parametrize(
    "completed_at",
    [
        datetime(2026, 7, 1, 13, tzinfo=UTC),
        datetime(2026, 7, 2, 12, tzinfo=UTC),
    ],
    ids=("future-same-day", "future-next-day"),
)
def test_native_future_completion_is_held_not_credited(monkeypatch, completed_at):
    floor = _floor()
    identity = room_cadence_identity(floor, ROOM_ID)
    now = datetime(2026, 7, 1, 12, tzinfo=UTC)
    monkeypatch.setattr(native_history.dt_util, "utcnow", lambda: now)
    robot = {
        "daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 1}},
        "daily_room_completions": {},
        "rooms": {},
    }
    session = CleaningSession(
        (now - timedelta(minutes=2)).isoformat(),
        completed_at.isoformat(),
        120,
        ("Kitchen",),
        (),
        None,
        mode_results=(CleaningModeResult("Kitchen", "vacuum", "completed", 90),),
    )

    assert native_history._import_daily_native_uncertainty(
        robot, floor, [CleaningSessionRecord(b"future-native", session)]
    )

    row = robot["daily_room_completions"][ROOM_ID]
    assert "receipts" not in row
    state = _state(robot, identity, now)
    assert state["completed_today"] == 0
    assert state["reached"] is True
    assert state["reason"] == "completion_history_unverified"
    next_day_state = _state(robot, identity, now + timedelta(days=1))
    assert next_day_state["completed_today"] == 0
    assert next_day_state["reached"] is True
    assert next_day_state["reason"] == "completion_history_unverified"


def test_late_native_proof_resolves_matching_ambiguous_receipt_once():
    identity = "d" * 64
    session = "a" * 64
    now = datetime(2026, 7, 1, 18, tzinfo=UTC)
    robot = {"daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 2}}}
    daily_room_limit.record_completion(
        robot,
        ROOM_ID,
        None,
        now.isoformat(),
        now=now,
        session_hash=session,
        unverified=True,
    )
    assert _state(robot, identity, now)["reason"] == "completion_history_unverified"
    daily_room_limit.record_completion(
        robot,
        ROOM_ID,
        identity,
        now.isoformat(),
        now=now,
        run_id="run",
        session_hash=session,
    )
    assert _state(robot, identity, now)["completed_today"] == 1
    assert not _state(robot, identity, now)["reached"]
    assert len(robot["daily_room_completions"][ROOM_ID]["receipts"]) == 1


def test_unresolved_time_hold_is_refreshed_with_bounded_writes():
    now = datetime(2026, 7, 1, 18, tzinfo=UTC)
    robot = {}
    assert daily_room_limit.record_unknown_completion_time(robot, ROOM_ID, now=now)
    assert not daily_room_limit.record_unknown_completion_time(
        robot, ROOM_ID, now=now + timedelta(minutes=30)
    )
    assert daily_room_limit.record_unknown_completion_time(
        robot, ROOM_ID, now=now + timedelta(hours=1)
    )
    row = robot["daily_room_completions"][ROOM_ID]
    assert row["unknown_time_until"] == (now + timedelta(hours=73)).isoformat()


def test_corrupt_completion_writes_do_not_replace_stored_state(monkeypatch):
    now = datetime(2026, 7, 1, 18, tzinfo=UTC)
    for robot in (
        {"daily_room_completions": []},
        {"daily_room_completions": {ROOM_ID: []}},
    ):
        assert not daily_room_limit.record_unknown_completion_time(
            robot, ROOM_ID, now=now
        )
        assert not daily_room_limit.record_completion(
            robot, ROOM_ID, "d" * 64, now.isoformat(), now=now
        )
    robot = {}
    assert not daily_room_limit.record_completion(
        robot, ROOM_ID, None, "invalid", now=now
    )
    assert not daily_room_limit.record_completion(
        robot, ROOM_ID, None, (now - timedelta(days=4)).isoformat(), now=now
    )
    monkeypatch.setattr(daily_room_limit, "MAX_RECENT_COMPLETIONS", 1)
    robot = {
        "daily_room_completions": {
            ROOM_ID: {
                "receipts": [
                    {"at": now.isoformat(), "identity": None},
                    {"at": now.isoformat(), "identity": None},
                ]
            }
        }
    }
    daily_room_limit.record_completion(robot, ROOM_ID, None, now.isoformat(), now=now)
    assert len(robot["daily_room_completions"][ROOM_ID]["receipts"]) == 1
    assert "overflow_until" in robot["daily_room_completions"][ROOM_ID]
    daily_room_limit.record_completion(
        robot,
        ROOM_ID,
        None,
        (now + timedelta(days=4)).isoformat(),
        now=now + timedelta(days=4),
    )
    assert "overflow_until" not in robot["daily_room_completions"][ROOM_ID]


async def test_daily_policy_changes_require_identity_and_respect_reservations(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    identity = room_cadence_identity(_floor(), ROOM_ID)
    setter = manager.cadence.async_set_daily_limit
    with pytest.raises(ValueError, match="identity"):
        await setter(
            SERIAL, ROOM_ID, room_identity="bad", limit=1, require_current=lambda: True
        )
    manager.cadence.prepared_runs[SERIAL] = SimpleNamespace(rooms={ROOM_ID})
    with pytest.raises(SharedRoomScheduleLockedError):
        await setter(
            SERIAL,
            ROOM_ID,
            room_identity=identity,
            limit=1,
            require_current=lambda: True,
        )
    del manager.cadence.prepared_runs[SERIAL]
    robot = manager.repository.robot(SERIAL)
    robot["daily_room_limits"] = []
    assert manager.cadence.has_any_daily_limit(SERIAL)
    with pytest.raises(ValueError, match="invalid"):
        await setter(
            SERIAL,
            ROOM_ID,
            room_identity=identity,
            limit=1,
            require_current=lambda: True,
        )
    robot["daily_room_limits"] = {}
    await setter(
        SERIAL, ROOM_ID, room_identity=identity, limit=1, require_current=lambda: True
    )
    assert manager.cadence.has_any_daily_limit(SERIAL)
    await setter(
        SERIAL,
        ROOM_ID,
        room_identity=identity,
        limit=None,
        require_current=lambda: True,
    )
    assert not manager.cadence.has_any_daily_limit(SERIAL)


async def test_verified_completion_is_persisted_once_and_blocks_preview(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = _floor()
    identity = room_cadence_identity(floor, ROOM_ID)
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=1, require_current=lambda: True
    )
    await manager.catalog.async_save_plan(
        SERIAL,
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": ROOM_ID,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
        },
    )
    run = "run-one"
    preview = manager.planning.preview(
        SERIAL, {ROOM_ID: "Kitchen"}, "home", floor_plan=floor
    )
    cadence = {**preview["rooms"][0]["cadence"], "identity": identity}
    await manager.ledger.async_begin_run(
        SERIAL,
        "home",
        run,
        1,
        trigger="user",
        service="run_selected_plan",
    )
    await manager.recovery.async_set_recovery_checkpoint(
        SERIAL, run, {"completed_room_ids": [], "cadence_by_room": {ROOM_ID: cadence}}
    )
    room = CleaningRoom(ROOM_ID, "Kitchen", "vacuum", "standard")
    assert await manager.ledger.async_mark_completed(SERIAL, "home", room, run_id=run)
    assert await manager.ledger.async_mark_completed(SERIAL, "home", room, run_id=run)
    assert (
        manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity)["completed_today"]
        == 1
    )
    preview = manager.planning.preview(
        SERIAL, {ROOM_ID: "Kitchen"}, "home", floor_plan=floor
    )
    assert preview["rooms"] == []
    assert preview["daily_limit_held_rooms"][0]["completed_today"] == 1
    persisted = manager.repository.data
    restored = CleaningPlanManager(hass)
    restored.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=persisted), async_save=AsyncMock()
    )
    await restored.async_load()
    assert (
        restored.cadence.daily_limit_state(SERIAL, ROOM_ID, identity)["reached"] is True
    )


async def test_daily_limit_setter_validates_map_policy_and_rolls_back(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    identity = room_cadence_identity(_floor(), ROOM_ID)
    for limit in (0, 101, True):
        with pytest.raises(ValueError):
            await manager.cadence.async_set_daily_limit(
                SERIAL,
                ROOM_ID,
                room_identity=identity,
                limit=limit,
                require_current=lambda: True,
            )
    with pytest.raises(ValueError, match="room map changed"):
        await manager.cadence.async_set_daily_limit(
            SERIAL,
            ROOM_ID,
            room_identity=identity,
            limit=1,
            require_current=lambda: False,
        )
    manager.repository.store.async_save.side_effect = OSError("disk")
    with pytest.raises(OSError):
        await manager.cadence.async_set_daily_limit(
            SERIAL,
            ROOM_ID,
            room_identity=identity,
            limit=1,
            require_current=lambda: True,
        )
    assert not manager.cadence.has_daily_limit(SERIAL, ROOM_ID)


async def test_daily_credit_deduplicates_run_even_without_recovery_checkpoint(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    identity = room_cadence_identity(_floor(), ROOM_ID)
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=2, require_current=lambda: True
    )
    await manager.ledger.async_begin_run(
        SERIAL, "home", "run", 1, trigger="user", service="clean_room_sequence"
    )
    room = CleaningRoom(ROOM_ID, "Kitchen", "vacuum", "standard")
    await manager.ledger.async_mark_completed(SERIAL, "home", room, run_id="run")
    await manager.ledger.async_mark_completed(SERIAL, "home", room, run_id="run")
    receipts = manager.repository.robot(SERIAL)["daily_room_completions"][ROOM_ID][
        "receipts"
    ]
    assert len(receipts) == 1
    # The daily cap does not guess a map identity absent from an old checkpoint.
    assert manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity)["reached"]


async def test_failed_cancelled_and_skipped_attempts_do_not_count(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    identity = room_cadence_identity(_floor(), ROOM_ID)
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=1, require_current=lambda: True
    )
    room = CleaningRoom(ROOM_ID, "Kitchen", "vacuum", "standard")
    await manager.ledger.async_begin_run(
        SERIAL, "home", "run", 1, trigger="user", service="run_selected_plan"
    )
    await manager.ledger.async_mark_failed(SERIAL, "home", room, "failed")
    await manager.ledger.async_mark_interrupted(SERIAL, "home", room, "interrupted")
    await manager.ledger.async_mark_cancelled(SERIAL, "home", room)
    await manager.ledger.async_mark_skipped(SERIAL, "home", room, run_id="run")
    assert manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity) == {
        "limit": 1,
        "completed_today": 0,
        "reached": False,
    }


async def test_late_native_verified_completion_is_counted_once(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = _floor()
    identity = room_cadence_identity(floor, ROOM_ID)
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=1, require_current=lambda: True
    )
    room = CleaningRoom(ROOM_ID, "Kitchen", "vacuum", "standard")
    now = dt_util.utcnow()
    await manager.ledger.async_begin_run(
        SERIAL, "home", "run", 1, trigger="user", service="clean_room_sequence"
    )
    await manager.ledger.async_mark_started(SERIAL, "home", room)
    await manager.ledger.async_mark_failed(
        SERIAL,
        "home",
        room,
        "unverified",
        native_reconciliation={
            "plan_id": "home",
            "room_id": ROOM_ID,
            "room": "Kitchen",
            "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
            "run_id": "run",
        },
    )
    record = CleaningSessionRecord(
        b"session",
        CleaningSession(
            (now - timedelta(seconds=10)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            9,
            ("Kitchen",),
            (("Kitchen", 9),),
            True,
            ("Kitchen",),
        ),
    )
    await manager.ledger.async_import_native_history(SERIAL, floor, [record])
    await manager.ledger.async_import_native_history(SERIAL, floor, [record])
    assert (
        manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity)["completed_today"]
        == 1
    )


@pytest.mark.parametrize("native_key", [b"native-session", b""])
async def test_external_native_uncertainty_is_bounded_and_never_counts_as_completion(
    hass,
    native_key,
):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = _floor()
    identity = room_cadence_identity(floor, ROOM_ID)
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=2, require_current=lambda: True
    )
    now = dt_util.utcnow()

    def record(status):
        return CleaningSessionRecord(
            native_key,
            CleaningSession(
                (now - timedelta(minutes=2)).isoformat(),
                now.isoformat(),
                120,
                ("Kitchen",),
                (),
                None,
                mode_results=(CleaningModeResult("Kitchen", "vacuum", status, 90),),
            ),
        )

    await manager.ledger.async_import_native_history(SERIAL, floor, [record("partial")])
    assert (
        manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity)["reached"] is False
    )
    await manager.ledger.async_import_native_history(
        SERIAL, floor, [record("completed")]
    )
    await manager.ledger.async_import_native_history(
        SERIAL, floor, [record("completed")]
    )
    state = manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity)
    assert state["completed_today"] == 0
    assert state["reason"] == "completion_history_unverified"
    assert (
        len(
            manager.repository.robot(SERIAL)["daily_room_completions"][ROOM_ID][
                "receipts"
            ]
        )
        == 1
    )


async def test_native_completion_with_unresolved_room_identity_is_held(
    hass, monkeypatch
):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = _floor()
    identity = room_cadence_identity(floor, ROOM_ID)
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=1, require_current=lambda: True
    )
    now = dt_util.utcnow()
    session = CleaningSession(
        (now - timedelta(minutes=2)).isoformat(),
        now.isoformat(),
        120,
        ("Kitchen",),
        (),
        None,
        mode_results=(CleaningModeResult("Kitchen", "vacuum", "completed", 90),),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.native_history.room_cadence_identity",
        MagicMock(side_effect=ValueError("map identity unavailable")),
    )
    await manager.ledger.async_import_native_history(
        SERIAL, floor, [CleaningSessionRecord(b"native", session)]
    )
    assert manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity)["reason"] == (
        "completion_history_unverified"
    )


async def test_native_completion_without_time_holds_then_expires(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = _floor()
    identity = room_cadence_identity(floor, ROOM_ID)
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=1, require_current=lambda: True
    )
    now = dt_util.utcnow()
    session = CleaningSession(
        now.isoformat(),
        None,
        None,
        ("Kitchen",),
        (),
        None,
        mode_results=(CleaningModeResult("Kitchen", "vacuum", "completed", 90),),
    )
    await manager.ledger.async_import_native_history(
        SERIAL, floor, [CleaningSessionRecord(b"unknown-time", session)]
    )
    robot = manager.repository.robot(SERIAL)
    assert manager.cadence.daily_limit_state(SERIAL, ROOM_ID, identity)["reason"] == (
        "completion_history_unverified"
    )
    assert (
        daily_room_limit.daily_state(
            robot, ROOM_ID, identity, now=now + timedelta(hours=73), timezone=UTC
        )["reached"]
        is False
    )


async def test_manual_sequence_omits_held_room_and_binds_preview_token(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = _floor()
    identity = room_cadence_identity(floor, ROOM_ID)
    requested = [
        {"room": "Kitchen", "cleaning_mode": "vacuum", "coverage_setting": "standard"}
    ]

    def preview():
        return resolve_room_sequence(
            manager,
            SERIAL,
            floor,
            {ROOM_ID: "Kitchen"},
            requested,
            entry_id="entry",
            return_to_base=True,
            use_room_schedule=False,
            override_room_schedule=False,
        )

    before = preview()
    await manager.cadence.async_set_daily_limit(
        SERIAL, ROOM_ID, room_identity=identity, limit=1, require_current=lambda: True
    )
    now = dt_util.utcnow()
    daily_room_limit.record_completion(
        manager.repository.robot(SERIAL), ROOM_ID, identity, now.isoformat(), now=now
    )
    after = preview()
    assert after["rooms"] == []
    assert after["daily_limit_held_rooms"][0]["room_id"] == ROOM_ID
    assert before["preview_token"] != after["preview_token"]


async def test_daily_limit_preserves_area_entries_in_mixed_plan(hass):
    from tests.test_plan_entries import (
        SERIAL as plan_serial,
    )
    from tests.test_plan_entries import (
        _area_entry,
        _manager,
        _room,
        _room_entry,
    )
    from tests.test_plan_entries import (
        _floor as plan_floor,
    )

    floor = plan_floor()
    manager = await _manager(hass, floor)
    room_id = "room-kitchen"
    identity = room_cadence_identity(floor, room_id)
    await manager.catalog.async_save_plan(
        plan_serial,
        "mixed",
        {
            "name": "Mixed",
            "rooms": [_room(room_id)],
            "entries": [_room_entry(room_id), _area_entry("rug")],
        },
    )
    await manager.cadence.async_set_daily_limit(
        plan_serial,
        room_id,
        room_identity=identity,
        limit=1,
        require_current=lambda: True,
    )
    now = dt_util.utcnow()
    daily_room_limit.record_completion(
        manager.repository.robot(plan_serial),
        room_id,
        identity,
        now.isoformat(),
        now=now,
    )
    preview = manager.planning.preview(
        plan_serial,
        {room.id: room.name for room in floor.rooms},
        "mixed",
        floor_plan=floor,
    )
    assert preview["rooms"] == []
    assert [entry["kind"] for entry in preview["entries"]] == ["area"]
    assert preview["daily_limit_held_rooms"][0]["room_id"] == room_id


async def test_untracked_vacuum_room_clean_is_refused_when_policy_enabled(hass):
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    floor = entry.runtime_data.coordinator.data.floor_plan
    room = floor.rooms[0]
    identity = room_cadence_identity(floor, room.id)
    await manager.cadence.async_set_daily_limit(
        "synthetic-serial",
        room.id,
        room_identity=identity,
        limit=2,
        require_current=lambda: True,
    )
    vacuum = MaticVacuum(entry)
    with pytest.raises(ServiceValidationError) as raised:
        await vacuum.async_send_command("clean_rooms", {"rooms": [room.id]})
    assert raised.value.translation_key == "daily_room_limit_requires_managed"
    entry.runtime_data.coordinator.client.async_start_coverage.assert_not_awaited()


async def test_direct_redo_and_reached_room_refuse_bypassing_daily_limit(hass):
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    floor = entry.runtime_data.coordinator.data.floor_plan
    room = floor.rooms[0]
    identity = room_cadence_identity(floor, room.id)
    serial = "synthetic-serial"
    await manager.cadence.async_set_daily_limit(
        serial, room.id, room_identity=identity, limit=1, require_current=lambda: True
    )
    now = dt_util.utcnow()
    daily_room_limit.record_completion(
        manager.repository.robot(serial), room.id, identity, now.isoformat(), now=now
    )
    vacuum = MaticVacuum(entry)
    with pytest.raises(ServiceValidationError) as redo:
        await vacuum.async_redo_last_clean()
    assert redo.value.translation_key == "daily_room_limit_requires_managed"
    with pytest.raises(ServiceValidationError) as clean:
        await vacuum.async_send_command("clean_rooms", {"rooms": [room.id]})
    assert clean.value.translation_key == "daily_room_limit_reached"
    entry.runtime_data.coordinator.client.async_start_coverage.assert_not_awaited()


async def test_direct_clean_refuses_when_room_identity_cannot_be_resolved(
    hass, monkeypatch
):
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    floor = entry.runtime_data.coordinator.data.floor_plan
    room = floor.rooms[0]
    await manager.cadence.async_set_daily_limit(
        "synthetic-serial",
        room.id,
        room_identity=room_cadence_identity(floor, room.id),
        limit=1,
        require_current=lambda: True,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.vacuum.room_cadence_identity",
        MagicMock(side_effect=ValueError("map identity unavailable")),
    )
    with pytest.raises(ServiceValidationError) as clean:
        await MaticVacuum(entry).async_send_command("clean_rooms", {"rooms": [room.id]})
    assert clean.value.translation_key == "daily_room_limit_reached"


async def test_redo_rechecks_daily_policy_after_loading_native_history(hass):
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    floor = entry.runtime_data.coordinator.data.floor_plan
    room = floor.rooms[0]
    now = dt_util.utcnow()
    session = CleaningSession(
        (now - timedelta(minutes=2)).isoformat(),
        now.isoformat(),
        120,
        (room.name,),
        (),
        None,
    )

    async def history():
        await manager.cadence.async_set_daily_limit(
            "synthetic-serial",
            room.id,
            room_identity=room_cadence_identity(floor, room.id),
            limit=1,
            require_current=lambda: True,
        )
        return [CleaningSessionRecord(b"native", session)]

    client = entry.runtime_data.coordinator.client
    client.async_get_cleaning_session_records = AsyncMock(side_effect=history)
    vacuum = MaticVacuum(entry)
    vacuum._holds_task = lambda: False
    with pytest.raises(ServiceValidationError) as redo:
        await vacuum.async_redo_last_clean()
    assert redo.value.translation_key == "daily_room_limit_requires_managed"
    client.async_redo_clean.assert_not_awaited()


async def test_daily_policy_enabled_during_command_wait_is_rechecked_before_write(hass):
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    floor = entry.runtime_data.coordinator.data.floor_plan
    room = floor.rooms[0]
    identity = room_cadence_identity(floor, room.id)
    vacuum = MaticVacuum(entry)
    applied = False
    writes = []

    async def wait_for_stop(_serial):
        nonlocal applied
        if not applied:
            applied = True
            await manager.cadence.async_set_daily_limit(
                "synthetic-serial",
                room.id,
                room_identity=identity,
                limit=2,
                require_current=lambda: True,
            )

    async def start_coverage(*_args, require_current, **_kwargs):
        require_current()
        writes.append("sent")

    vacuum._async_ensure_stop_settled = wait_for_stop
    entry.runtime_data.coordinator.client.async_start_coverage = AsyncMock(
        side_effect=start_coverage
    )
    with pytest.raises(ServiceValidationError) as raised:
        await vacuum.async_send_command("clean_rooms", {"rooms": [room.id]})
    assert raised.value.translation_key == "daily_room_limit_requires_managed"
    assert writes == []


def _daily_limit_request(hass, body, *, admin=True):
    encoded = json.dumps(body).encode()
    request = make_mocked_request(
        "POST",
        DAILY_LIMIT_API_URL.format(entry_id="entry"),
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(len(encoded)),
        },
        app={KEY_HASS: hass},
    )
    request["hass_user"] = SimpleNamespace(is_admin=admin)
    request._read_bytes = encoded
    return request


def _daily_limit_runtime(floor, setter):
    runtime = SimpleNamespace(
        coordinator=SimpleNamespace(
            data=SimpleNamespace(
                floor_plan=floor,
                info=SimpleNamespace(serial_number=SERIAL),
            )
        ),
        slam_map=SimpleNamespace(floor_plan_is_current=MagicMock(return_value=True)),
        cleaning_plans=SimpleNamespace(
            cadence=SimpleNamespace(async_set_daily_limit=setter)
        ),
    )
    entry = SimpleNamespace(
        domain="matic_robot",
        state=ConfigEntryState.LOADED,
        entry_id="entry",
        runtime_data=runtime,
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry))
    )
    return hass, runtime


@pytest.mark.parametrize("limit", [True, 0, 101, "1"])
async def test_daily_limit_view_rejects_invalid_limit_without_writing(limit):
    floor = _floor()
    setter = AsyncMock()
    request_hass, _ = _daily_limit_runtime(floor, setter)
    response = await MaticDailyLimitView().post(
        _daily_limit_request(
            request_hass,
            {
                "room_id": ROOM_ID,
                "floor_token": plan_floor_token(floor),
                "limit": limit,
            },
        ),
        "entry",
    )
    assert response.status == HTTPStatus.BAD_REQUEST
    setter.assert_not_awaited()


@pytest.mark.parametrize(
    ("error", "status", "reason"),
    [
        (SharedRoomScheduleLockedError(), HTTPStatus.CONFLICT, "room_reserved"),
        (MetadataAdmissionClosedError(), HTTPStatus.CONFLICT, "runtime_unloading"),
        (ValueError("map changed"), HTTPStatus.CONFLICT, "map_rechecking"),
        (ValueError("bad value"), HTTPStatus.BAD_REQUEST, "invalid_request"),
    ],
)
async def test_daily_limit_view_reports_write_refusals(error, status, reason):
    floor = _floor()
    request_hass, _ = _daily_limit_runtime(floor, AsyncMock(side_effect=error))
    response = await MaticDailyLimitView().post(
        _daily_limit_request(
            request_hass,
            {"room_id": ROOM_ID, "floor_token": plan_floor_token(floor), "limit": 1},
        ),
        "entry",
    )
    assert response.status == status
    assert json.loads(response.body) == {"error": reason}


async def test_daily_limit_view_rejects_invalid_or_missing_requests():
    floor = _floor()
    request_hass, runtime = _daily_limit_runtime(floor, AsyncMock())
    body = {"room_id": ROOM_ID, "floor_token": plan_floor_token(floor), "limit": 1}
    view = MaticDailyLimitView()
    request_hass.config_entries.async_get_entry.return_value = None
    assert (
        await view.post(_daily_limit_request(request_hass, body), "entry")
    ).status == 404
    request_hass.config_entries.async_get_entry.return_value = SimpleNamespace(
        domain="matic_robot",
        state=ConfigEntryState.LOADED,
        entry_id="entry",
        runtime_data=runtime,
    )
    assert (
        await view.post(_daily_limit_request(request_hass, {}), "entry")
    ).status == 400
    request = _daily_limit_request(request_hass, body)
    request._read_bytes = b"invalid-json"
    assert (await view.post(request, "entry")).status == 400
    large = _daily_limit_request(request_hass, {"data": "x" * 5000})
    assert (await view.post(large, "entry")).status == 413
    response = await view.post(
        _daily_limit_request(request_hass, {**body, "room_id": "unknown"}), "entry"
    )
    assert json.loads(response.body) == {"error": "room_identity_unconfirmed"}


async def test_daily_limit_view_binds_write_to_live_floor_identity(monkeypatch):
    floor = _floor()
    identity = room_cadence_identity(floor, ROOM_ID)
    setter = AsyncMock(
        return_value={"limit": 2, "completed_today": 1, "reached": False}
    )
    request_hass, runtime = _daily_limit_runtime(floor, setter)
    token = plan_floor_token(floor)

    response = await MaticDailyLimitView().post(
        _daily_limit_request(
            request_hass,
            {"room_id": ROOM_ID, "floor_token": token, "limit": 2},
        ),
        "entry",
    )

    assert response.status == HTTPStatus.OK
    assert json.loads(response.body) == {
        "limit": 2,
        "completed_today": 1,
        "reached": False,
    }
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"
    setter.assert_awaited_once()
    assert setter.await_args.args == (SERIAL, ROOM_ID)
    assert setter.await_args.kwargs["room_identity"] == identity
    assert setter.await_args.kwargs["limit"] == 2
    assert setter.await_args.kwargs["require_current"]()
    monkeypatch.setattr(
        "custom_components.matic_robot.daily_limit_view.room_cadence_identity",
        MagicMock(side_effect=ValueError("room disappeared")),
    )
    assert not setter.await_args.kwargs["require_current"]()
    runtime.coordinator.data.floor_plan = replace(floor, mission_id=2)
    assert not setter.await_args.kwargs["require_current"]()


async def test_daily_limit_view_rejects_stale_and_unauthorized_writes():
    floor = _floor()
    setter = AsyncMock()
    request_hass, runtime = _daily_limit_runtime(floor, setter)
    body = {
        "room_id": ROOM_ID,
        "floor_token": plan_floor_token(floor),
        "limit": 3,
    }
    runtime.slam_map.floor_plan_is_current.return_value = False

    stale = await MaticDailyLimitView().post(
        _daily_limit_request(request_hass, body), "entry"
    )
    assert stale.status == HTTPStatus.CONFLICT
    assert json.loads(stale.body) == {"error": "map_rechecking"}
    setter.assert_not_awaited()

    with pytest.raises(Unauthorized):
        await MaticDailyLimitView().post(
            _daily_limit_request(request_hass, body, admin=False), "entry"
        )
    setter.assert_not_awaited()
