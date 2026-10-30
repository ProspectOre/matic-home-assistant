"""Tests for maintenance suggestions, the bag pass and their Repairs."""

from __future__ import annotations

import struct
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.protobuf.message import DecodeError
from homeassistant.helpers import issue_registry as ir

from custom_components.matic_robot.binary_sensor import MAINTENANCE_DESCRIPTIONS
from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.consumables import (
    MAX_BAG_PASS_PAYLOAD_BYTES,
    MAX_MAINTENANCE_SUGGESTIONS,
    decode_bag_pass_expiry,
    decode_maintenance_suggestions,
    latest_maintenance_suggestions,
)
from custom_components.matic_robot.client.models import (
    HermesCollectionEntry,
    MaintenancePart,
    RobotTelemetry,
)
from custom_components.matic_robot.client.wire import WireField, packed_varints
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.maintenance import (
    MaintenanceIssues,
    async_delete_maintenance_issues,
)
from tests.wire_builders import _bfield, _vfield

PASS_START = 1_782_432_000  # 2026-06-26 UTC
PASS_END = 1_813_968_000  # 2027-06-26 UTC


def _recap(month: int, year: int, suggestions: bytes = b"") -> HermesCollectionEntry:
    area = (
        bytes((0x0D,))
        + struct.pack("<f", 1.0)
        + bytes((0x15,))
        + struct.pack("<f", 0.0)
    )
    durations = _bfield(1, _vfield(1, 60)) + _bfield(2, b"")
    value = _bfield(1, area) + _vfield(2, 1) + suggestions + _bfield(7, durations)
    return HermesCollectionEntry(_vfield(1, month) + _vfield(2, year), value)


def _timestamp(seconds: int, nanos: int | None = None) -> bytes:
    return _vfield(1, seconds) + (b"" if nanos is None else _vfield(2, nanos))


def _bag_pass(start: bytes, end: bytes) -> HermesCollectionEntry:
    return HermesCollectionEntry(
        b"\x0a\x00", _bfield(1, _bfield(1, start) + _bfield(2, end))
    )


def test_maintenance_suggestions_accept_packed_and_unpacked_values() -> None:
    fields = (
        WireField(4, 2, bytes((3, 1))),
        WireField(4, 0, 2),
        WireField(4, 0, 99),
    )
    assert decode_maintenance_suggestions(fields) == (
        MaintenancePart.BRUSH_ROLL,
        MaintenancePart.SIDE_BRUSH,
        MaintenancePart.MOP_ROLL,
    )
    assert decode_maintenance_suggestions((WireField(4, 0, 4),)) == (
        MaintenancePart.CASTER_AND_WEDGE,
    )
    assert decode_maintenance_suggestions(()) == ()


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ((WireField(4, 5, b"\x00\x00\x00\x00"),), "invalid shape"),
        ((WireField(4, 0, 1),) * (MAX_MAINTENANCE_SUGGESTIONS + 1), "size limit"),
        ((WireField(4, 2, b"\x01" * (MAX_MAINTENANCE_SUGGESTIONS + 1)),), "limit"),
        ((WireField(4, 2, b"\x81"),), "truncated"),
    ],
)
def test_maintenance_suggestions_reject_malformed_fields(
    fields: tuple[WireField, ...], message: str
) -> None:
    with pytest.raises(DecodeError, match=message):
        decode_maintenance_suggestions(fields)


def test_packed_varints_decode_multibyte_values() -> None:
    assert packed_varints(b"\x01\xac\x02", 2) == (1, 300)


def test_latest_maintenance_suggestions_pick_the_newest_month() -> None:
    assert latest_maintenance_suggestions([]) is None
    assert latest_maintenance_suggestions(
        [
            (12, 2025, (MaintenancePart.MOP_ROLL,)),
            (10, 2026, (MaintenancePart.BRUSH_ROLL,)),
            (9, 2026, ()),
        ]
    ) == ("2026-10", (MaintenancePart.BRUSH_ROLL,))


def test_bag_pass_reports_the_end_of_an_active_pass() -> None:
    expires = decode_bag_pass_expiry(
        _bag_pass(_timestamp(PASS_START), _timestamp(PASS_END, 5))
    )
    assert expires == datetime.fromtimestamp(PASS_END, UTC)
    # Other statuses use tags this integration has not seen; none is a pass.
    other = HermesCollectionEntry(b"", _bfield(3, _bfield(1, _timestamp(PASS_END))))
    assert decode_bag_pass_expiry(other) is None


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (b"", "empty or oversized"),
        (b"\x00" * (MAX_BAG_PASS_PAYLOAD_BYTES + 1), "empty or oversized"),
        (_vfield(1, 1), "invalid shape"),
        (_bfield(1, b"") + _bfield(1, b""), "invalid shape"),
        (_bfield(1, b"") + _vfield(2, 1), "invalid shape"),
        (_bfield(1, _bfield(1, _timestamp(PASS_START))), "invalid shape"),
        (
            _bfield(1, _bfield(2, _timestamp(PASS_END)) + _bfield(2, b"")),
            "invalid shape",
        ),
        (
            _bfield(1, _bfield(1, _timestamp(PASS_END)) + _bfield(2, b"")),
            "timestamp has an invalid shape",
        ),
        (
            _bfield(1, _bfield(1, _timestamp(PASS_START)) + _vfield(2, PASS_END)),
            "timestamp has an invalid shape",
        ),
        (
            _bfield(
                1,
                _bfield(1, _timestamp(PASS_START))
                + _bfield(2, _timestamp(PASS_END) + _vfield(3, 1)),
            ),
            "timestamp has an invalid shape",
        ),
        (
            _bfield(1, _bfield(1, _timestamp(1)) + _bfield(2, _timestamp(PASS_END))),
            "outside safe bounds",
        ),
        (
            _bfield(
                1, _bfield(1, _timestamp(PASS_END)) + _bfield(2, _timestamp(PASS_START))
            ),
            "ends before it starts",
        ),
    ],
)
def test_bag_pass_rejects_malformed_payloads(value: bytes, message: str) -> None:
    with pytest.raises(DecodeError, match=message):
        decode_bag_pass_expiry(HermesCollectionEntry(b"", value))


async def test_telemetry_reads_the_newest_recap_and_bag_pass() -> None:
    client = MaticHermesClient("192.0.2.1", 16320)
    collections = {
        "recap_history": (
            _recap(7, 2026),
            _recap(10, 2026, _bfield(4, bytes((1, 2, 3)))),
            _recap(9, 2026, _bfield(4, bytes((1, 2)))),
            HermesCollectionEntry(b"\x08\x0b\x10\xea\x0f", b"\x0a\xff"),
        ),
        "bag_pass_status": (
            HermesCollectionEntry(b"", b"\x0a\xff"),
            HermesCollectionEntry(b"", _bfield(3, b"")),
            _bag_pass(_timestamp(PASS_START), _timestamp(PASS_END)),
        ),
    }

    async def entries(name: str, *, limit: int):
        return collections.get(name, ())

    client.async_get_property = AsyncMock(return_value=b"")
    client.async_get_collection_entries = AsyncMock(side_effect=entries)
    client.async_get_tracked_collection_entries = AsyncMock(side_effect=entries)
    client.async_get_collection_count = AsyncMock(return_value=0)

    telemetry = await client.async_get_telemetry()

    assert telemetry.maintenance_recap_month == "2026-10"
    assert telemetry.maintenance_suggestions == (
        MaintenancePart.BRUSH_ROLL,
        MaintenancePart.SIDE_BRUSH,
        MaintenancePart.MOP_ROLL,
    )
    assert telemetry.bag_pass_expires_at == datetime.fromtimestamp(PASS_END, UTC)
    client.async_get_tracked_collection_entries.assert_any_await(
        "recap_history", limit=120
    )
    client.async_get_collection_entries.assert_any_await("bag_pass_status", limit=4)

    collections.clear()
    telemetry = await client.async_get_telemetry()
    assert telemetry.maintenance_suggestions is None
    assert telemetry.maintenance_recap_month is None
    assert telemetry.bag_pass_expires_at is None


def test_maintenance_binary_sensors_follow_the_newest_recap() -> None:
    def values(telemetry: RobotTelemetry) -> list[bool | None]:
        state = SimpleNamespace(telemetry=telemetry)
        return [
            description.value_fn(state)  # type: ignore[arg-type]
            for description in MAINTENANCE_DESCRIPTIONS
        ]

    assert [description.key for description in MAINTENANCE_DESCRIPTIONS] == [
        "brush_roll_maintenance",
        "side_brush_maintenance",
        "mop_roll_maintenance",
        "caster_and_wedge_maintenance",
    ]
    assert values(RobotTelemetry()) == [None, None, None, None]
    assert values(
        RobotTelemetry(
            maintenance_suggestions=(
                MaintenancePart.BRUSH_ROLL,
                MaintenancePart.CASTER_AND_WEDGE,
            )
        )
    ) == [True, False, False, True]


def _issue_ids(hass) -> set[str]:
    return {
        issue_id
        for domain, issue_id in ir.async_get(hass).issues
        if domain == DOMAIN and issue_id.startswith("maintenance_")
    }


async def test_maintenance_issues_track_the_newest_recap(hass) -> None:
    issues = MaintenanceIssues(hass, "entry")
    other = MaintenanceIssues(hass, "other")
    other.async_sync(
        RobotTelemetry(
            maintenance_recap_month="2026-10",
            maintenance_suggestions=(MaintenancePart.SIDE_BRUSH,),
        )
    )

    issues.async_sync(RobotTelemetry())
    assert _issue_ids(hass) == {"maintenance_other_2026-10_side_brush"}

    october = RobotTelemetry(
        maintenance_recap_month="2026-10",
        maintenance_suggestions=(MaintenancePart.BRUSH_ROLL, MaintenancePart.MOP_ROLL),
    )
    issues.async_sync(october)
    assert _issue_ids(hass) == {
        "maintenance_entry_2026-10_brush_roll",
        "maintenance_entry_2026-10_mop_roll",
        "maintenance_other_2026-10_side_brush",
    }
    issue = ir.async_get(hass).async_get_issue(
        DOMAIN, "maintenance_entry_2026-10_brush_roll"
    )
    assert issue is not None
    assert issue.translation_key == "maintenance_brush_roll"
    assert issue.severity is ir.IssueSeverity.WARNING
    assert issue.is_fixable is False
    assert issue.translation_placeholders is not None
    assert issue.translation_placeholders["month"] == "2026-10"

    # An unreadable recap keeps what is shown; a repeat changes nothing.
    issues.async_sync(RobotTelemetry())
    issues.async_sync(october)
    assert len(_issue_ids(hass)) == 3

    issues.async_sync(
        RobotTelemetry(
            maintenance_recap_month="2026-11",
            maintenance_suggestions=(MaintenancePart.BRUSH_ROLL,),
        )
    )
    assert _issue_ids(hass) == {
        "maintenance_entry_2026-11_brush_roll",
        "maintenance_other_2026-10_side_brush",
    }

    issues.async_sync(
        RobotTelemetry(maintenance_recap_month="2026-12", maintenance_suggestions=())
    )
    assert _issue_ids(hass) == {"maintenance_other_2026-10_side_brush"}

    async_delete_maintenance_issues(hass, "other")
    assert _issue_ids(hass) == set()
