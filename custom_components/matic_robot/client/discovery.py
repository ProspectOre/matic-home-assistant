"""Decode robot discovery metadata."""

from __future__ import annotations

from base64 import b64decode
from binascii import Error as Base64Error

from google.protobuf.message import DecodeError

from .models import RobotInfo
from .proto.hermes_bot_info_pb2 import BotInformation


def decode_bot_information(value: str | bytes) -> RobotInfo | None:
    """Decode the base64 BotInformation published in Matic's TXT record."""
    try:
        encoded = value.encode("ascii") if isinstance(value, str) else value
        message = BotInformation.FromString(b64decode(encoded, validate=True))
    except Base64Error, DecodeError, UnicodeEncodeError:
        return None

    if not message.serial_number or not message.hostname or not message.port:
        return None
    return RobotInfo(
        serial_number=message.serial_number,
        name=message.name,
        hostname=message.hostname,
        port=message.port,
        ip4_address=message.ip4_address,
        ip6_address=message.ip6_address,
        encrypted=message.encrypted,
        requires_auth=message.requires_auth,
        network_auth=message.network_auth,
        hardware_revision=message.hardware_revision,
    )
