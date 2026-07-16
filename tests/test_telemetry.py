"""Fixtures for the expanded safe Hermes telemetry and settings."""

from __future__ import annotations

import struct
from datetime import UTC, datetime
from unittest.mock import AsyncMock, call

import pytest

from custom_components.matic_robot.client.api import (
    MaticHermesClient,
    _decode_binary_state,
    _decode_cleaning_session,
    _decode_coverage_time,
    _decode_current_version,
    _decode_deep_mop_state,
    _decode_nested_timestamp,
    _decode_presence_state,
    _decode_schedule,
    _decode_timezone,
    _decode_update_state,
    _decode_uploader_state,
    _decode_water_flow_factor,
    _decode_wifi_status,
)
from tests.wire_builders import _bfield, _fixed64, _vfield


def test_decode_safe_telemetry_fixtures() -> None:
    version = b"\x0a\x06v200.1\x12\x06stable\x18\x19\x20\x01"
    timezone = b"\x0a\x0b\x12\x09Etc/UTC+1"

    assert _decode_current_version(version) == ("v200.1", "stable", 25, True)
    assert _decode_binary_state(b"\x08\x01") is True
    assert _decode_binary_state(b"tombstone-value!") is False
    assert _decode_deep_mop_state(b"\x0a\x00") is True
    assert _decode_deep_mop_state(b"\x12\x00") is False
    assert _decode_presence_state(b"tombstone-value!") is False
    assert _decode_presence_state(b"\x0a\x00") is True
    assert _decode_water_flow_factor(b"\x0a\x05\x0d" + struct.pack("<f", 1.4)) == 1.4
    assert _decode_update_state(b"\x0a\x00") == "idle"
    assert _decode_update_state(b"\x32\x00") == "available"
    assert _decode_timezone(timezone) == "Etc/UTC+1"
    assert _decode_wifi_status(b"\x08\x03")[0] == "connected"


def test_decode_optional_telemetry_fails_closed() -> None:
    malformed = b"\x0a\xff"

    assert _decode_current_version(malformed) == (None, None, None, None)
    assert _decode_binary_state(malformed) is None
    assert _decode_deep_mop_state(malformed) is None
    assert _decode_presence_state(malformed) is None
    assert _decode_water_flow_factor(malformed) is None
    assert _decode_update_state(malformed) is None
    assert _decode_timezone(malformed) is None
    assert _decode_wifi_status(malformed)[0] is None


@pytest.mark.parametrize(
    "decoder",
    [
        _decode_current_version,
        _decode_binary_state,
        _decode_deep_mop_state,
        _decode_presence_state,
        _decode_water_flow_factor,
        _decode_update_state,
        _decode_timezone,
    ],
)
def test_decode_optional_telemetry_rejects_non_bytes(decoder) -> None:
    result = decoder(None)
    assert result in {None, (None, None, None, None)}
    assert _decode_wifi_status(None) == (None, None, None, ())


def test_decode_optional_telemetry_handles_defaults_and_unknowns() -> None:
    assert _decode_deep_mop_state(b"\x18\x01") is None
    assert _decode_water_flow_factor(b"tombstone-value!") == 1.0
    assert _decode_update_state(b"\x3a\x00") is None
    assert _decode_timezone(b"tombstone-value!") is None
    assert _decode_wifi_status(b"\x08\x63")[0] == "unknown"


async def test_complete_telemetry_snapshot_omits_sensitive_payloads() -> None:
    client = MaticHermesClient("192.0.2.1", 16320)
    values = {
        "current_version": b"\x0a\x04v1.0\x12\x06stable\x18\x19",
        "petwaste_enabled_state": b"\x08\x01",
        "child_lock_enabled_state": b"disabled-setting",
        "update_config": b"\x0a\x06stable",
        "update_state": b"\x0a\x00",
        "voice_enabled_state": b"disabled-setting",
        "matter_pairing_state": b"disabled-setting",
        "deep_mop_override_setting_state": b"\x12\x00",
        "water_flow_override_state": b"\x0a\x05\x0d" + struct.pack("<f", 1.0),
        "time_zone": b"\x0a\x0b\x12\x09Etc/UTC+1",
        "wifi_status": b"\x08\x03\x22\x0cprivate-ssid",
        "user_tunnel_ssh_permission": b"disabled-setting",
        "uploader_config_state": b"disabled-setting",
        "active_session_key": b"disabled-setting",
        "coverage_time": b"disabled-setting",
    }
    client.async_get_property = AsyncMock(side_effect=lambda name: values[name])
    client.async_get_collection_entries = AsyncMock(return_value=())
    client.async_get_collection_count = AsyncMock(side_effect=(4, 1))

    telemetry = await client.async_get_telemetry()

    assert telemetry.software_version == "v1.0"
    assert telemetry.protocol_version == 25
    assert telemetry.supports_easter_event is False
    assert telemetry.child_lock_enabled is False
    assert telemetry.pet_waste_enabled is True
    assert telemetry.deep_mop_enabled is False
    assert telemetry.matter_pairing_enabled is False
    assert telemetry.water_flow_factor == 1.0
    assert telemetry.wifi_state == "connected"
    assert telemetry.scheduled_cleanings == 0
    assert telemetry.local_cleaning_sessions == 0
    assert telemetry.wifi_ssid == "private-ssid"


async def test_verified_setting_payloads_and_bounds() -> None:
    client = MaticHermesClient("192.0.2.1", 16320)
    client._async_send_channel_payload = AsyncMock()

    await client.async_set_binary_setting("child_lock", True)
    await client.async_set_binary_setting("pet_waste", False)
    await client.async_set_deep_mop(True)
    await client.async_set_deep_mop(False)
    await client.async_set_water_flow(1.4)

    assert client._async_send_channel_payload.await_args_list == [
        call("child_lock_enabled_command", b"\x08\x01"),
        call("petwaste_enabled_command", b"\x08\x00"),
        call("deep_mop_override_setting_command", b"\x0a\x00"),
        call("deep_mop_override_setting_command", b"\x12\x00"),
        call("water_flow_override_command", b"\x0a\x05\x0d" + struct.pack("<f", 1.4)),
    ]

    with pytest.raises(ValueError, match="Unsupported"):
        await client.async_set_binary_setting("unknown", True)
    with pytest.raises(ValueError, match="between"):
        await client.async_set_water_flow(2.1)
    with pytest.raises(ValueError, match="increments"):
        await client.async_set_water_flow(1.45)


def test_decode_wifi_schedule_and_history() -> None:
    network = _bfield(1, b"Test LAN") + _vfield(3, 1) + _vfield(6, 89) + _vfield(8, 1)
    wifi = _vfield(1, 3) + _bfield(4, b"Test LAN") + _bfield(7, _bfield(1, network))
    state, ssid, signal, networks = _decode_wifi_status(wifi)
    assert (state, ssid, signal) == ("connected", "Test LAN", -45)
    assert networks[0].known is True

    room_id = _fixed64(1, 1) + _fixed64(2, 2)
    days = _vfield(1, 1) + _vfield(3, 1)
    zone = _bfield(2, b"America/Los_Angeles")
    schedule_time = _vfield(1, 510) + _bfield(4, zone)
    weekly = _bfield(1, days) + _bfield(3, schedule_time)
    payload = (
        _bfield(1, weekly)
        + _bfield(2, b"Morning")
        + _vfield(3, 1)
        + _bfield(7, room_id)
        + _bfield(9, b"")
    )
    schedule = _decode_schedule(payload)
    assert schedule is not None
    assert schedule.time == "08:30"
    assert schedule.weekdays == ("sunday", "tuesday")
    assert schedule.timezone == "America/Los_Angeles"
    assert schedule.enabled is True
    assert schedule.ordered is True
    assert len(schedule.room_ids) == 1

    def timestamp(value: int) -> bytes:
        return _bfield(1, _vfield(1, value))

    details = _bfield(3, b"Kitchen") + _bfield(4, _vfield(1, 600))
    room = _bfield(2, details)
    summary = (
        _bfield(3, timestamp(1_700_000_000))
        + _bfield(4, timestamp(1_700_000_900))
        + _bfield(6, _bfield(1, room))
    )
    session = _decode_cleaning_session(_bfield(5, summary))
    assert session is not None
    assert session.duration_seconds == 900
    assert session.rooms == ("Kitchen",)
    assert session.room_durations == (("Kitchen", 600),)
    assert session.completed is True
    assert datetime.fromisoformat(session.started_at or "").tzinfo is UTC


def test_decode_auxiliary_states() -> None:
    assert _decode_uploader_state(_bfield(1, b"")) is False
    assert _decode_uploader_state(_bfield(2, _vfield(1, 1))) is True
    assert _decode_uploader_state(b"tombstone-value!") is False
    assert _decode_coverage_time(_bfield(3, _vfield(1, 321))) == 321
    assert _decode_coverage_time(b"tombstone-value!") is None


def test_decoders_fail_closed_and_use_safe_defaults() -> None:
    assert _decode_uploader_state(None) is None
    assert _decode_uploader_state(b"\x0a\xff") is None
    assert _decode_uploader_state(_bfield(2, b"")) is False
    assert _decode_uploader_state(b"\x18\x01") is None
    assert _decode_coverage_time(_vfield(1, 1)) is None
    assert _decode_coverage_time(b"\x0a\xff") is None
    assert _decode_schedule(b"bad") is None
    assert _decode_cleaning_session(b"bad") is None
    assert _decode_nested_timestamp(b"bad", 1) is None

    network = _bfield(1, b"Fallback LAN")
    scan = _vfield(2, 1) + _bfield(1, _vfield(3, 1)) + _bfield(1, network)
    wifi = _vfield(1, 3) + _bfield(4, b"Fallback LAN") + _bfield(7, scan)
    _state, _ssid, signal, networks = _decode_wifi_status(wifi)
    assert signal is None
    assert networks[0].connected is True
    assert networks[0].known is True

    minimal_time = _vfield(1, 180)
    minimal = _bfield(1, _bfield(1, b"") + _bfield(3, minimal_time))
    schedule = _decode_schedule(minimal)
    assert schedule is not None
    assert schedule.timezone is None
    assert schedule.ordered is False
    assert schedule.enabled is None

    empty_summary = _bfield(5, _vfield(1, 1) + _bfield(6, b"\x0a\xff"))
    session = _decode_cleaning_session(empty_summary)
    assert session is not None
    assert session.rooms == ()
