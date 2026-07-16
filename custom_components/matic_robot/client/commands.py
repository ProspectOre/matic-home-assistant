"""Encode verified Hermes commands."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from enum import StrEnum
from uuid import UUID, uuid4


class UserCommand(StrEnum):
    """Commands whose protobuf payloads were verified against a real robot."""

    STOP = "stop"
    PAUSE = "pause"
    RESUME = "resume"
    DOCK = "dock"


class CleaningMode(StrEnum):
    """Cleaning modes displayed by the Matic app."""

    VACUUM = "vacuum"
    MOP = "mop"
    BOTH = "vacuum_and_mop"


class CoverageSetting(StrEnum):
    """Supported coverage passes displayed by the Matic app."""

    QUICK = "quick"
    STANDARD = "standard"


class HermesConnectionKind(StrEnum):
    """Connection origins supported by Matic's official Hermes client."""

    BLUETOOTH = "bluetooth"
    REMOTE = "remote"
    IP = "ip"
    HOSTNAME = "hostname"
    AVAHI = "avahi"


_COMMAND_PAYLOADS = {
    UserCommand.STOP: bytes.fromhex("7a040a022200"),
    UserCommand.PAUSE: bytes.fromhex("4801880101"),
    UserCommand.RESUME: bytes.fromhex("4801880100"),
    UserCommand.DOCK: bytes.fromhex("12042a020800"),
}


def encode_user_command(command: UserCommand) -> bytes:
    """Return the exact official-app protobuf payload for a user command."""
    return _COMMAND_PAYLOADS[command]


def encode_user_data(
    *,
    app_id: str,
    timezone_identifier: str,
    seconds_from_gmt: int,
    connection_kind: HermesConnectionKind = HermesConnectionKind.IP,
) -> bytes:
    """Encode the official local-client context sent after each connection."""
    app_id = str(UUID(app_id))
    if not timezone_identifier:
        raise ValueError("timezone_identifier must not be empty")
    if not -(1 << 63) <= seconds_from_gmt < (1 << 63):
        raise ValueError("seconds_from_gmt must fit in a signed 64-bit integer")
    timezone = _field(2, timezone_identifier.encode()) + _varint_field(
        3, seconds_from_gmt & ((1 << 64) - 1)
    )
    connection = {
        HermesConnectionKind.BLUETOOTH: _field(4, b""),
        HermesConnectionKind.REMOTE: _field(5, b""),
        HermesConnectionKind.IP: b"",
        HermesConnectionKind.HOSTNAME: _field(7, b""),
        HermesConnectionKind.AVAHI: _field(8, b""),
    }[connection_kind]
    return _field(1, _wrapped_uuid(app_id)) + _field(2, timezone) + connection


def encode_coverage_command(
    *,
    mission_id: int,
    partition_id: str,
    region_ids: Sequence[str],
    cleaning_mode: CleaningMode = CleaningMode.BOTH,
    coverage_setting: CoverageSetting = CoverageSetting.STANDARD,
    ordered: bool = False,
    command_id_factory: Callable[[], UUID] = uuid4,
) -> bytes:
    """Encode a verified normal coverage command.

    UUIDs are used for command bookkeeping only. The active mission, partition,
    and region identifiers come from the robot.
    """
    if not 0 <= mission_id <= 0xFFFFFFFF:
        raise ValueError("mission_id must fit in an unsigned 32-bit integer")
    if not region_ids:
        raise ValueError("at least one region is required")

    partition_id = str(UUID(partition_id))
    normalized_regions = tuple(str(UUID(value)) for value in region_ids)
    setting_value = {
        CoverageSetting.STANDARD: 1,
        CoverageSetting.QUICK: 2,
    }[coverage_setting]
    specs = _coverage_specs(cleaning_mode, setting_value)
    goal_field = 1 if ordered else 2
    goals = b"".join(
        _field(
            goal_field,
            _coverage_goal(
                partition_id=partition_id,
                region_id=region_id,
                spec=spec,
                command_id=str(command_id_factory()),
            ),
        )
        for region_id in normalized_regions
        for spec in specs
    )
    coverage = (
        _field(2, _field(2, _field(1, b"")))
        + _field(3, _fixed32(2, mission_id))
        + _field(5, goals)
        + _field(6, _field(2, _wrapped_uuid(str(command_id_factory()))))
        + _field(7, _field(1, _wrapped_uuid(str(command_id_factory()))))
    )
    return _field(15, _field(1, _field(3, coverage)))


def _coverage_specs(
    cleaning_mode: CleaningMode, setting_value: int
) -> tuple[bytes, ...]:
    specs: list[bytes] = []
    if cleaning_mode in {CleaningMode.VACUUM, CleaningMode.BOTH}:
        for floor in (0, 1):
            specs.extend(
                (
                    _varint_field(1, setting_value)
                    + _varint_field(2, floor)
                    + _varint_field(4, 0)
                    + _varint_field(5, behavior)
                )
                for behavior in range(4)
            )
    if cleaning_mode in {CleaningMode.MOP, CleaningMode.BOTH}:
        specs.extend(
            (
                _varint_field(1, setting_value)
                + _varint_field(2, 0)
                + _varint_field(4, 1)
                + _varint_field(5, behavior)
            )
            for behavior in range(4)
        )
    return tuple(specs)


def _coverage_goal(
    *, partition_id: str, region_id: str, spec: bytes, command_id: str
) -> bytes:
    goal = _field(
        6,
        _field(1, _field(2, _wrapped_uuid(command_id))) + _field(3, spec),
    )
    target = (
        _field(1, _field(1, _wrapped_uuid(partition_id)))
        + _field(2, _field(1, b""))
        + _field(3, _field(3, _field(2, _wrapped_uuid(region_id))))
    )
    return goal + _field(7, target)


def _wrapped_uuid(value: str) -> bytes:
    uuid_int = UUID(value).int
    return _field(
        2,
        _fixed64(1, uuid_int >> 64) + _fixed64(2, uuid_int & ((1 << 64) - 1)),
    )


def _field(number: int, value: bytes) -> bytes:
    return _varint((number << 3) | 2) + _varint(len(value)) + value


def _varint_field(number: int, value: int) -> bytes:
    return _varint(number << 3) + _varint(value)


def _fixed32(number: int, value: int) -> bytes:
    return _varint((number << 3) | 5) + value.to_bytes(4, "little")


def _fixed64(number: int, value: int) -> bytes:
    return _varint((number << 3) | 1) + value.to_bytes(8, "little")


def _varint(value: int) -> bytes:
    output = bytearray()
    while value > 0x7F:
        output.append((value & 0x7F) | 0x80)
        value >>= 7
    output.append(value)
    return bytes(output)
