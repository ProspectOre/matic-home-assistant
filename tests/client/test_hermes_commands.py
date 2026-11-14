"""Protocol fixtures for live-verified Hermes user commands."""

from __future__ import annotations

import pytest

from custom_components.matic_robot.client.commands import (
    HermesConnectionKind,
    UserCommand,
    encode_coverage_command,
    encode_go_to_room_command,
    encode_redo_coverage_command,
    encode_sink_summon_command,
    encode_user_command,
    encode_user_data,
)
from custom_components.matic_robot.client.proto.hermes_pb2 import ChannelRequest

# The expected payloads below were produced by Matic's own offline Android
# encoder from public, synthetic identifiers (the app_id UUID and timezone in
# test_official_app_user_data_payload). No robot data or credential is present.


@pytest.mark.parametrize(
    ("command", "expected_hex"),
    [
        (UserCommand.STOP, "7a040a022200"),
        (UserCommand.PAUSE, "4801880101"),
        (UserCommand.RESUME, "4801880100"),
        (UserCommand.DOCK, "12042a020800"),
        (UserCommand.STAY_PUT, "820100"),
        (UserCommand.EMOTE_NOD, "12043a020a00"),
        (UserCommand.EMOTE_SHAKE, "12043a021200"),
        (UserCommand.EMOTE_PIROUETTE, "12043a022a00"),
        (UserCommand.EMOTE_SNAP, "12043a024200"),
    ],
)
def test_official_app_command_payloads(command: UserCommand, expected_hex: str) -> None:
    """Lock down the exact payload emitted by the official app."""
    assert encode_user_command(command) == bytes.fromhex(expected_hex)


def test_user_command_channel_envelope() -> None:
    """Lock down the authenticated Hermes channel envelope."""
    request = ChannelRequest(
        channel_name="user_command",
        value=encode_user_command(UserCommand.STOP),
    )

    assert request.SerializeToString() == bytes.fromhex(
        "0a0c757365725f636f6d6d616e6412067a040a022200"
    )


def test_official_app_user_data_payload() -> None:
    """Lock local session context to the official Android encoder fixture."""
    payload = encode_user_data(
        app_id="5104e67a-1eac-4e91-8168-5ce87238cb18",
        timezone_identifier="America/Los_Angeles",
        seconds_from_gmt=-25200,
    )

    assert payload == bytes.fromhex(
        "0a14121209914eac1e7ae604511118cb3872e85c6881"
        "12201213416d65726963612f4c6f735f416e67656c6573"
        "1890bbfeffffffffffff01"
    )


@pytest.mark.parametrize(
    ("connection_kind", "expected_suffix"),
    [
        (HermesConnectionKind.BLUETOOTH, "2200"),
        (HermesConnectionKind.REMOTE, "2a00"),
        (HermesConnectionKind.IP, ""),
        (HermesConnectionKind.HOSTNAME, "3a00"),
        (HermesConnectionKind.AVAHI, "4200"),
    ],
)
def test_official_app_user_data_connection_kinds(
    connection_kind: HermesConnectionKind, expected_suffix: str
) -> None:
    """Lock down every official connection-origin oneof mapping."""
    payload = encode_user_data(
        app_id="5104e67a-1eac-4e91-8168-5ce87238cb18",
        timezone_identifier="UTC",
        seconds_from_gmt=0,
        connection_kind=connection_kind,
    )
    ip_payload = encode_user_data(
        app_id="5104e67a-1eac-4e91-8168-5ce87238cb18",
        timezone_identifier="UTC",
        seconds_from_gmt=0,
        connection_kind=HermesConnectionKind.IP,
    )

    assert payload == ip_payload + bytes.fromhex(expected_suffix)


def test_user_data_rejects_empty_timezone_identifier() -> None:
    with pytest.raises(ValueError, match="timezone_identifier"):
        encode_user_data(
            app_id="5104e67a-1eac-4e91-8168-5ce87238cb18",
            timezone_identifier="",
            seconds_from_gmt=0,
        )


@pytest.mark.parametrize("seconds_from_gmt", [1 << 63, -(1 << 63) - 1])
def test_user_data_rejects_gmt_offsets_beyond_wire_range(
    seconds_from_gmt: int,
) -> None:
    with pytest.raises(ValueError, match="seconds_from_gmt"):
        encode_user_data(
            app_id="5104e67a-1eac-4e91-8168-5ce87238cb18",
            timezone_identifier="UTC",
            seconds_from_gmt=seconds_from_gmt,
        )


@pytest.mark.parametrize("mission_id", [-1, 1 << 32])
def test_coverage_rejects_out_of_range_mission_id(mission_id: int) -> None:
    with pytest.raises(ValueError, match="mission_id"):
        encode_coverage_command(
            mission_id=mission_id,
            partition_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            region_ids=["11111111-1111-4111-8111-111111111111"],
        )


def test_sink_summon_waits_for_a_refill_at_the_saved_posture() -> None:
    """Lock the robot-validated NavigateTo + 900 s refill wait structure."""
    payload = encode_sink_summon_command(
        mission_id=0x01020304,
        posture=bytes.fromhex("0d0000c03f15000000c0220515000080bf"),
    )

    assert payload == bytes.fromhex(
        "122722250a110d0000c03f15000000c0220515000080bf"
        "1205150403020122090a070a030884071000"
    )


def test_sink_summon_rejects_missing_posture_and_out_of_range_mission() -> None:
    with pytest.raises(ValueError, match="posture"):
        encode_sink_summon_command(mission_id=1, posture=b"")
    with pytest.raises(ValueError, match="mission_id"):
        encode_sink_summon_command(mission_id=1 << 32, posture=b"\x0d")


def test_go_to_room_navigates_to_the_room_without_a_wait() -> None:
    """NavigateTo's room goal (field 5) with the mission, and no wait task."""
    payload = encode_go_to_room_command(
        mission_id=0x01020304,
        partition_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        region_id="11111111-1111-4111-8111-111111111111",
    )

    partition = "0a160a14121209aa4aaaaaaaaaaaaa11aaaaaaaaaaaaaa8a"
    region = "2216121412120911411111111111111111111111111111" + "81"
    assert payload == bytes.fromhex(
        "123b22392a30" + partition + region + "12051504030201"
    )


def test_go_to_room_rejects_invalid_identifiers() -> None:
    with pytest.raises(ValueError):
        encode_go_to_room_command(
            mission_id=1, partition_id="partition", region_id="room"
        )
    with pytest.raises(ValueError, match="mission_id"):
        encode_go_to_room_command(
            mission_id=-1,
            partition_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            region_id="11111111-1111-4111-8111-111111111111",
        )


def test_redo_coverage_wraps_the_history_key() -> None:
    key = bytes.fromhex("1214121209" + "aa" * 8 + "11" + "bb" * 8)

    assert encode_redo_coverage_command(key) == bytes.fromhex("7a181a16") + key


@pytest.mark.parametrize(
    "key",
    [
        b"",
        bytes.fromhex("1214121209" + "aa" * 8 + "11" + "bb" * 7),
        bytes.fromhex("1214121208" + "aa" * 8 + "11" + "bb" * 8),
        bytes.fromhex("1214121209" + "aa" * 8 + "12" + "bb" * 8),
    ],
)
def test_redo_coverage_rejects_other_keys(key: bytes) -> None:
    with pytest.raises(ValueError):
        encode_redo_coverage_command(key)
