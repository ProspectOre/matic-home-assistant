"""Bounded wifi status decoders."""

from __future__ import annotations

from google.protobuf.message import DecodeError

from .models import (
    WifiNetwork,
)
from .operational_state import _OPERATIONAL_STATE_MAX_FIELDS
from .telemetry_fields import (
    _TELEMETRY_NESTED_MAX_FIELDS,
    TELEMETRY_NESTED_MAX_BYTES,
    bounded_fields,
    decode_text_field,
    decode_text_from_fields,
    telemetry_bytes,
    telemetry_varint,
)

WIFI_STATUS_MAX_BYTES = 256 * 1024
_WIFI_NETWORK_MAX_COUNT = 256


def wifi_scan_block(payload: bytes) -> bytes | None:
    """Return the raw scan-result block of a ``wifi_status`` value."""
    try:
        return telemetry_bytes(
            payload,
            7,
            max_bytes=WIFI_STATUS_MAX_BYTES,
            max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
        )
    except DecodeError:
        return None


def decode_wifi_status(
    payload: object,
) -> tuple[str | None, str | None, int | None, tuple[WifiNetwork, ...]]:
    """Decode the current Wi-Fi link and full locally visible network scan."""
    if not isinstance(payload, bytes) or len(payload) > WIFI_STATUS_MAX_BYTES:
        return None, None, None, ()
    names = {
        0: "unknown",
        1: "unknown",
        2: "connecting",
        3: "connected",
        4: "disconnected",
        5: "disconnecting",
        6: "roaming",
    }
    try:
        fields = bounded_fields(
            payload,
            max_bytes=WIFI_STATUS_MAX_BYTES,
            max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
        )
        state = names.get(
            telemetry_varint(
                payload,
                1,
                max_bytes=WIFI_STATUS_MAX_BYTES,
                max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
            ),
            "unknown",
        )
    except DecodeError:
        return None, None, None, ()

    ssid = decode_text_from_fields(fields, 4) or decode_text_from_fields(fields, 10)
    networks: list[WifiNetwork] = []
    try:
        scan = telemetry_bytes(
            payload,
            7,
            max_bytes=WIFI_STATUS_MAX_BYTES,
            max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
        )
        scan_fields = bounded_fields(
            scan,
            max_bytes=WIFI_STATUS_MAX_BYTES,
            max_fields=_WIFI_NETWORK_MAX_COUNT * 2,
        )
        network_count = sum(
            field.number == 1 and isinstance(field.value, bytes)
            for field in scan_fields
        )
        if network_count > _WIFI_NETWORK_MAX_COUNT:
            return state, ssid, None, ()
        for field in scan_fields:
            if field.number != 1 or not isinstance(field.value, bytes):
                continue
            item = field.value
            bounded_fields(
                item,
                max_bytes=TELEMETRY_NESTED_MAX_BYTES,
                max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
            )
            network_ssid = decode_text_field(item, 1) or decode_text_field(item, 7)
            if network_ssid is None:
                continue
            try:
                encoded_signal = telemetry_varint(item, 6)
                signal = (encoded_signal >> 1) ^ -(encoded_signal & 1)
            except DecodeError:
                signal = None
            try:
                connected = bool(telemetry_varint(item, 3))
            except DecodeError:
                connected = network_ssid == ssid
            try:
                known = bool(telemetry_varint(item, 8))
            except DecodeError:
                known = connected
            networks.append(WifiNetwork(network_ssid, signal, connected, known))
    except DecodeError:
        pass

    networks.sort(
        key=lambda item: (
            not item.connected,
            -(item.signal_dbm if item.signal_dbm is not None else -999),
            item.ssid.casefold(),
        )
    )
    current = next((item for item in networks if item.connected), None)
    return (
        state,
        ssid,
        current.signal_dbm if current is not None else None,
        tuple(networks),
    )
