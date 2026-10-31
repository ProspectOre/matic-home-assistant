"""Bounded telemetry decoders."""

from __future__ import annotations

import math
import struct
from datetime import datetime

from google.protobuf.message import DecodeError

from .consumables import decode_bag_pass_expiry
from .history import (
    decode_monthly_cleaning_recap,
    decode_monthly_recap_key,
)
from .models import (
    HermesCollectionEntry,
    RunProgress,
)
from .telemetry_fields import (
    decode_text_field,
    decode_text_from_fields,
    telemetry_bytes,
    telemetry_fields,
    telemetry_varint,
)

TELEMETRY_PROPERTIES = (
    "current_version",
    "petwaste_enabled_state",
    "child_lock_enabled_state",
    "update_config",
    "update_state",
    "voice_enabled_state",
    "matter_pairing_state",
    "deep_mop_override_setting_state",
    "water_flow_override_state",
    "time_zone",
    "wifi_status",
    "user_tunnel_ssh_permission",
    "uploader_config_state",
    "coverage_time",
)


def decode_current_version(
    payload: object,
) -> tuple[str | None, str | None, int | None, bool | None]:
    """Decode Matic's verified current-version property."""
    if not isinstance(payload, bytes):
        return None, None, None, None
    try:
        fields = telemetry_fields(payload)
    except DecodeError:
        return None, None, None, None
    protocol = next(
        (field.value for field in fields if field.number == 3 and field.wire_type == 0),
        None,
    )
    supports = next(
        (
            bool(field.value)
            for field in fields
            if field.number == 4 and field.wire_type == 0
        ),
        False,
    )
    return (
        decode_text_from_fields(fields, 1),
        decode_text_from_fields(fields, 2),
        protocol if isinstance(protocol, int) else None,
        supports,
    )


def decode_binary_state(payload: object) -> bool | None:
    """Decode BinaryState, including Hermes' verified disabled tombstone."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        return bool(telemetry_varint(payload, 1))
    except DecodeError:
        return None


def decode_deep_mop_state(payload: object) -> bool | None:
    """Decode the native app's observed disabled/enabled empty-message arms.

    Field 1 is disabled; field 2 enables double-pass mopping. Accept only the
    complete observed encodings so ambiguous or malformed state cannot qualify
    a firmware coverage-setting override.
    """
    if not isinstance(payload, bytes):
        return None
    if payload == b"\x12\x00":
        return True
    if payload == b"\x0a\x00":
        return False
    return None


def decode_presence_state(payload: object) -> bool | None:
    """Decode an optional-state property without exposing its nested data."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        return bool(telemetry_fields(payload))
    except DecodeError:
        return None


def decode_water_flow_factor(payload: object) -> float | None:
    """Decode WaterFlowOverrideFactor without exposing unrelated payloads."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return 1.0
    try:
        nested = telemetry_bytes(payload, 1)
        raw_factor = next(
            item.value
            for item in telemetry_fields(nested)
            if item.number == 1
            and item.wire_type == 5
            and isinstance(item.value, bytes)
        )
        factor = struct.unpack("<f", raw_factor)[0]
    except DecodeError, StopIteration, struct.error:
        return None
    return round(factor, 1) if math.isfinite(factor) else None


def decode_update_state(payload: object) -> str | None:
    """Decode the verified updater oneof without triggering an update."""
    if not isinstance(payload, bytes):
        return None
    names = {
        1: "idle",
        2: "busy",
        3: "progress",
        4: "error",
        5: "complete",
        6: "available",
    }
    try:
        return names.get(telemetry_fields(payload)[0].number)
    except DecodeError, IndexError:
        return None


def decode_timezone(payload: object) -> str | None:
    """Decode only the non-sensitive timezone identifier."""
    if not isinstance(payload, bytes) or len(payload) == 16:
        return None
    try:
        return decode_text_field(telemetry_bytes(payload, 1), 2)
    except DecodeError:
        return None


def decode_uploader_state(payload: object) -> bool | None:
    """Decode whether optional vendor diagnostic upload is enabled."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        fields = telemetry_fields(payload)
    except DecodeError:
        return None
    for field in fields:
        if field.number == 1 and isinstance(field.value, bytes):
            return False
        if field.number == 2:
            if isinstance(field.value, int):
                return bool(field.value)
            if isinstance(field.value, bytes):
                try:
                    return bool(telemetry_varint(field.value, 1))
                except DecodeError:
                    return False
    return None


def decode_latest_maintenance(
    entries: tuple[HermesCollectionEntry, ...],
) -> tuple[str, tuple[int, ...]] | None:
    """Return the newest recap month and its maintenance suggestions.

    An unreadable newest recap yields None rather than an older month, so
    stale suggestions never replace current ones.
    """
    keyed: list[tuple[tuple[int, int], HermesCollectionEntry]] = []
    for entry in entries:
        try:
            month, year = decode_monthly_recap_key(entry)
        except DecodeError:
            continue
        keyed.append(((year, month), entry))
    if not keyed:
        return None
    (year, month), newest = max(keyed, key=lambda item: item[0])
    try:
        recap = decode_monthly_cleaning_recap(newest)
    except DecodeError:
        return None
    return f"{year:04d}-{month:02d}", recap.maintenance_suggestions


def decode_bag_pass(
    entries: tuple[HermesCollectionEntry, ...],
) -> datetime | None:
    """Return the expiry of the first decodable active bag pass."""
    for entry in entries:
        try:
            expires_at = decode_bag_pass_expiry(entry)
        except DecodeError:
            continue
        if expires_at is not None:
            return expires_at
    return None


def decode_coverage_time(payload: object) -> int | None:
    """Decode the total active cleaning duration when the property is present."""
    if not isinstance(payload, bytes) or len(payload) == 16:
        return None
    try:
        for field in telemetry_fields(payload):
            if field.number != 3 or not isinstance(field.value, bytes):
                continue
            return telemetry_varint(field.value, 1)
    except DecodeError:
        pass
    return None


def decode_run_progress(payload: bytes) -> RunProgress | None:
    """Decode a running clean's time from ``coverage_time`` field 4.

    Live runs report ``4{1: session, 2{1: elapsed s}, 3{1{1{1: remaining s}}}}``.
    Without field 4 no clean is under way.
    """
    try:
        if not any(field.number == 4 for field in telemetry_fields(payload)):
            return None
        run = telemetry_bytes(payload, 4)
        elapsed = telemetry_varint(telemetry_bytes(run, 2), 1)
        remaining = telemetry_bytes(run, 3)
        for _ in range(2):
            remaining = telemetry_bytes(remaining, 1)
        return RunProgress(elapsed, telemetry_varint(remaining, 1))
    except DecodeError:
        return None
