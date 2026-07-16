from __future__ import annotations

from base64 import b64encode

from custom_components.matic_robot.client.discovery import decode_bot_information
from custom_components.matic_robot.client.proto.hermes_bot_info_pb2 import (
    BotInformation,
)


def test_decode_bot_information() -> None:
    encoded = b64encode(
        BotInformation(
            serial_number="example-serial",
            name="Matic",
            hostname="matic-example",
            port=16320,
            encrypted=True,
            requires_auth=True,
            network_auth=False,
            hardware_revision="example-revision",
        ).SerializeToString()
    )

    info = decode_bot_information(encoded)

    assert info is not None
    assert info.serial_number == "example-serial"
    assert info.hostname == "matic-example"
    assert info.requires_auth is True
    assert info.network_auth is False


def test_reject_invalid_bot_information() -> None:
    assert decode_bot_information("not base64") is None
