"""Encode verified Hermes commands."""

from __future__ import annotations

import math
import struct
from collections.abc import Callable, Sequence
from dataclasses import dataclass
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
    OPTIMAL = "standard"
    HEAVY_DUTY = "heavy_duty"
    STANDARD = OPTIMAL  # Backward-compatible Python alias.


_COVERAGE_SETTING_VALUES = {
    CoverageSetting.HEAVY_DUTY: 0,
    CoverageSetting.OPTIMAL: 1,
    CoverageSetting.QUICK: 2,
}


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

_SINK_REFILL_WAIT_SECONDS = 900


def encode_user_command(command: UserCommand) -> bytes:
    """Return the exact official-app protobuf payload for a user command."""
    return _COMMAND_PAYLOADS[command]


def encode_mission_id(mission_id: int) -> bytes:
    """Encode a floor's mission ID, also the key of per-floor collections."""
    if not 0 <= mission_id <= 0xFFFFFFFF:
        raise ValueError("mission_id must fit in an unsigned 32-bit integer")
    return _fixed32(2, mission_id)


def encode_sink_summon_command(*, mission_id: int, posture: bytes) -> bytes:
    """Drive to this floor's sink posture and wait there for a water refill.

    The posture is sent exactly as read from ``sink_summon_locations``. Like the
    official app, the robot waits up to 15 minutes, docking once refilled.
    """
    if not posture:
        raise ValueError("a sink posture is required")
    wait_for_refill = _field(
        1, _field(1, _varint_field(1, _SINK_REFILL_WAIT_SECONDS)) + _varint_field(2, 0)
    )
    navigate_to = (
        _field(1, posture)
        + _field(2, encode_mission_id(mission_id))
        + _field(4, wait_for_refill)
    )
    return _field(2, _field(4, navigate_to))


def encode_go_to_room_command(
    *, mission_id: int, partition_id: str, region_id: str
) -> bytes:
    """Drive to a room on this floor, with no wait task, like a plain NavigateTo.

    The app's own navigation sends a posture; firmware also accepts a room as
    the goal (NavigateTo field 5), which leaves the robot to choose the spot.
    """
    room_goal = _field(1, _field(1, _wrapped_uuid(str(UUID(partition_id))))) + _field(
        4, _field(2, _wrapped_uuid(str(UUID(region_id))))
    )
    navigate_to = _field(5, room_goal) + _field(2, encode_mission_id(mission_id))
    return _field(2, _field(4, navigate_to))


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
    coverage_setting: CoverageSetting = CoverageSetting.OPTIMAL,
    ordered: bool = False,
    command_id_factory: Callable[[], UUID] = uuid4,
    session_id: UUID | None = None,
    _region_settings: Sequence[CoverageSetting] | None = None,
    _region_modes: Sequence[CleaningMode] | None = None,
) -> bytes:
    """Encode a verified normal coverage command.

    UUIDs are used for command bookkeeping only. ``session_id`` pins the
    verified field-6 session identity when a tracked caller must prove which
    new native task accepted this command. The active mission, partition, and
    region identifiers come from the robot.
    """
    if not region_ids:
        raise ValueError("at least one region is required")

    partition_id = str(UUID(partition_id))
    normalized_regions = tuple(str(UUID(value)) for value in region_ids)
    settings = (
        tuple(_region_settings)
        if _region_settings is not None
        else (coverage_setting,) * len(normalized_regions)
    )
    if len(settings) != len(normalized_regions):
        raise ValueError("one coverage setting is required per region")
    modes = (
        tuple(_region_modes)
        if _region_modes is not None
        else (cleaning_mode,) * len(normalized_regions)
    )
    if len(modes) != len(normalized_regions):
        raise ValueError("one cleaning mode is required per region")
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
        for region_id, setting, mode in zip(
            normalized_regions, settings, modes, strict=True
        )
        for spec in _coverage_specs(mode, _COVERAGE_SETTING_VALUES[setting])
    )
    coverage = (
        _field(2, _field(2, _field(1, b"")))
        + _field(3, encode_mission_id(mission_id))
        + _field(5, goals)
        + _field(
            6,
            _field(
                2,
                _wrapped_uuid(
                    str(session_id if session_id is not None else command_id_factory())
                ),
            ),
        )
        + _field(7, _field(1, _wrapped_uuid(str(command_id_factory()))))
    )
    return _field(15, _field(1, _field(3, coverage)))


@dataclass(frozen=True, slots=True)
class MixedCoverageCommands:
    """A normal start and an identity-preserving, live-verified goal update."""

    initial: bytes
    update: bytes
    session_id: str


def encode_mixed_coverage_commands(
    *,
    mission_id: int,
    partition_id: str,
    region_ids: Sequence[str],
    settings: Sequence[CoverageSetting],
    modes: Sequence[CleaningMode],
    command_id_factory: Callable[[], UUID] = uuid4,
    session_id: UUID | None = None,
) -> MixedCoverageCommands:
    """Prepare a normal start and a per-room goal update.

    The update must only be sent after observing this exact session cleaning
    its first room. Round IDs, floor identity and room order stay unchanged.
    """
    if (
        len(region_ids) < 2
        or len(settings) != len(region_ids)
        or len(modes) != len(region_ids)
    ):
        raise ValueError("mixed coverage requires settings for two or more rooms")
    settings = tuple(CoverageSetting(setting) for setting in settings)
    modes = tuple(CleaningMode(mode) for mode in modes)
    if len({str(UUID(region)) for region in region_ids}) != len(region_ids):
        raise ValueError("mixed coverage rooms must be distinct")
    initial_count = len(_coverage_specs(modes[0], 0))
    goal_ids = tuple(
        command_id_factory() for _ in range(len(region_ids) * initial_count)
    )
    session_id = session_id or command_id_factory()
    initial_command_id = command_id_factory()
    # START can begin under one mode/setting only. Keep it scoped to the first
    # room until the exact session is observed; the subsequent UPDATE carries
    # the complete ordered, per-room goals.
    initial_ids = iter((*goal_ids[:initial_count], initial_command_id))
    initial = encode_coverage_command(
        mission_id=mission_id,
        partition_id=partition_id,
        region_ids=region_ids[:1],
        cleaning_mode=modes[0],
        coverage_setting=settings[0],
        ordered=True,
        command_id_factory=lambda: next(initial_ids),
        session_id=session_id,
    )
    updated_ids: list[UUID] = []
    for index, mode in enumerate(modes):
        count = len(_coverage_specs(mode, 0))
        old_ids = goal_ids[index * initial_count : (index + 1) * initial_count]
        updated_ids.extend(old_ids[:count])
        updated_ids.extend(
            command_id_factory() for _ in range(max(0, count - initial_count))
        )
    update_ids = iter((*updated_ids, command_id_factory()))
    update = encode_coverage_command(
        mission_id=mission_id,
        partition_id=partition_id,
        region_ids=region_ids,
        cleaning_mode=modes[0],
        coverage_setting=settings[0],
        ordered=True,
        command_id_factory=lambda: next(update_ids),
        session_id=session_id,
        _region_settings=settings,
        _region_modes=modes,
    )
    return MixedCoverageCommands(initial, update, str(session_id))


def encode_custom_coverage_command(
    *,
    mission_id: int,
    circles: Sequence[tuple[float, float, float]],
    cleaning_mode: CleaningMode = CleaningMode.BOTH,
    coverage_setting: CoverageSetting = CoverageSetting.OPTIMAL,
    command_id_factory: Callable[[], UUID] = uuid4,
    session_id: UUID | None = None,
) -> bytes:
    """Encode an official-app-compatible drawn-circle coverage command.

    Circle coordinates use the same robot map coordinate system as room
    boundaries. A fresh synthetic partition ID is required by the custom-area
    target and contains no robot identity. A managed plan pins the field-6
    session identity, as it does for room coverage, so it can recognise its
    own mission; otherwise that identity is generated like the other IDs.
    """
    if not circles:
        raise ValueError("at least one circle is required")
    if len(circles) > 512:
        raise ValueError("at most 512 circles are supported")

    normalized: list[tuple[float, float, float]] = []
    for circle in circles:
        if len(circle) != 3:
            raise ValueError("each circle must contain x, y, and radius")
        x, y, radius = (float(value) for value in circle)
        if not all(math.isfinite(value) for value in (x, y, radius)):
            raise ValueError("circle values must be finite")
        if not 0.05 <= radius <= 2.5:
            raise ValueError("circle radius must be between 0.05 and 2.5 meters")
        normalized.append((x, y, radius))

    setting_value = _COVERAGE_SETTING_VALUES[coverage_setting]
    custom_partition_id = str(command_id_factory())
    circles_message = b"".join(
        _field(
            1,
            _field(1, _float_field(1, x) + _float_field(2, y))
            + _float_field(2, radius),
        )
        for x, y, radius in normalized
    )
    drawn_area = _field(2, circles_message)
    target = (
        _field(1, _field(1, _wrapped_uuid(custom_partition_id)))
        + _field(2, _field(3, drawn_area))
        + _field(3, _field(2, b""))
    )
    goals = b"".join(
        _field(
            2,
            _field(
                6,
                _field(1, _field(2, _wrapped_uuid(str(command_id_factory()))))
                + _field(3, spec),
            )
            + _field(7, target),
        )
        for spec in _coverage_specs(cleaning_mode, setting_value)
    )
    coverage = (
        _field(2, _field(2, _field(1, b"")))
        + _field(3, encode_mission_id(mission_id))
        + _field(5, goals)
        + _field(
            6,
            _field(
                2,
                _wrapped_uuid(
                    str(session_id if session_id is not None else command_id_factory())
                ),
            ),
        )
        + _field(7, _field(1, _wrapped_uuid(str(command_id_factory()))))
    )
    return _field(15, _field(1, _field(3, coverage)))


class QueueAction(StrEnum):
    """Changes the app's queue sheet makes to a running clean."""

    SKIP = "skip"
    CLEAN_NEXT = "clean_next"
    CLEAN_AGAIN = "clean_again"


class QueueChangeError(ValueError):
    """A queue change that the running clean cannot take."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class CoverageUpdateGoal:
    """One goal of a running task: its round ID, room and spec."""

    round_id: str
    region_id: str
    setting: int
    floor: int
    mode: int
    behavior: int


# The robot reports a Heavy Duty vacuum goal and a double-pass mop goal with
# setting 3. That value is never sent; the goal goes back as it was asked for.
_READBACK_SETTINGS = {0: 0, 1: 1}


def requeue_coverage_goals(
    goals: Sequence[CoverageUpdateGoal],
    *,
    action: QueueAction,
    current_region: str,
    target_region: str,
    cleaning_mode: CleaningMode | None = None,
    coverage_setting: CoverageSetting | None = None,
    round_id_factory: Callable[[], UUID] = uuid4,
) -> tuple[CoverageUpdateGoal, ...]:
    """Return the goal list the app sends for one queue change.

    ``goals`` is the robot's plan in order. Rooms before the current one are
    finished; the robot keeps them, so like the app this returns only the
    current room and the rooms after it. Kept goals keep their round IDs and
    goals for a room cleaned again get fresh ones.
    """
    # A room cleaned again after it finished appears twice, so the plan is
    # split into consecutive visits rather than grouped by room.
    visits: list[tuple[str, list[CoverageUpdateGoal]]] = []
    for goal in goals:
        if goal.setting == 3:
            goal = CoverageUpdateGoal(
                goal.round_id,
                goal.region_id,
                _READBACK_SETTINGS[goal.mode],
                goal.floor,
                goal.mode,
                goal.behavior,
            )
        if visits and visits[-1][0] == goal.region_id:
            visits[-1][1].append(goal)
        else:
            visits.append((goal.region_id, [goal]))
    queue = visits[queue_start_visit(visits, current_region) :]
    queued = [region for region, _goals in queue]
    if action is QueueAction.SKIP:
        if target_region not in queued:
            raise QueueChangeError("room_not_queued")
        if len(queue) == 1:
            raise QueueChangeError("last_room")
        del queue[queued.index(target_region)]
    elif action is QueueAction.CLEAN_NEXT:
        if target_region not in queued:
            raise QueueChangeError("room_not_queued")
        index = queued.index(target_region)
        if index <= 1:
            raise QueueChangeError("already_next")
        queue.insert(1, queue.pop(index))
    else:
        fresh = _fresh_goals(
            target_region,
            [
                goal
                for region, room in visits
                if region == target_region
                for goal in room
            ],
            cleaning_mode,
            coverage_setting,
            round_id_factory,
        )
        if target_region in queued:
            queue[queued.index(target_region)] = (target_region, fresh)
        else:
            queue.append((target_region, fresh))
    return tuple(goal for _region, room in queue for goal in room)


def queue_start_visit(
    visits: Sequence[tuple[str, Sequence[object]]], current_region: str
) -> int:
    """Return the index of the visit the robot is on: the room's last visit.

    A room appears twice only when it finished and was added again, and the
    robot reaches that second visit after the first.
    """
    for index in range(len(visits) - 1, -1, -1):
        if visits[index][0] == current_region:
            return index
    raise QueueChangeError("current_room_unknown")


def _fresh_goals(
    region_id: str,
    existing: Sequence[CoverageUpdateGoal],
    cleaning_mode: CleaningMode | None,
    coverage_setting: CoverageSetting | None,
    round_id_factory: Callable[[], UUID],
) -> list[CoverageUpdateGoal]:
    modes = {goal.mode for goal in existing}
    if cleaning_mode is None:
        cleaning_mode = (
            CleaningMode.VACUUM
            if modes == {0}
            else CleaningMode.MOP
            if modes == {1}
            else CleaningMode.BOTH
        )
    if coverage_setting is not None:
        setting = _COVERAGE_SETTING_VALUES[coverage_setting]
    else:
        setting = next(
            (goal.setting for goal in existing if goal.mode == 0),
            _COVERAGE_SETTING_VALUES[CoverageSetting.OPTIMAL],
        )
    fresh = []
    for setting_value, floor, mode, behavior in _coverage_spec_values(
        cleaning_mode, setting
    ):
        fresh.append(
            CoverageUpdateGoal(
                str(round_id_factory()),
                region_id,
                setting_value,
                floor,
                mode,
                behavior,
            )
        )
    return fresh


def encode_coverage_goal_update(
    *,
    mission_id: int,
    partition_id: str,
    session_id: str,
    goals: Sequence[CoverageUpdateGoal],
    command_id_factory: Callable[[], UUID] = uuid4,
) -> bytes:
    """Encode an ordered goal list for a task the robot is already running.

    This is the coverage command with the task's own session ID, as the app's
    queue sheet sends it; the robot replaces the goals still ahead of it.
    """
    if not goals:
        raise ValueError("at least one goal is required")
    partition_id = str(UUID(partition_id))
    encoded = b"".join(
        _field(
            1,
            _coverage_goal(
                partition_id=partition_id,
                region_id=str(UUID(goal.region_id)),
                spec=_coverage_spec(goal.setting, goal.floor, goal.mode, goal.behavior),
                command_id=str(UUID(goal.round_id)),
            ),
        )
        for goal in goals
    )
    coverage = (
        _field(2, _field(2, _field(1, b"")))
        + _field(3, encode_mission_id(mission_id))
        + _field(5, encoded)
        + _field(6, _field(2, _wrapped_uuid(str(UUID(session_id)))))
        + _field(7, _field(1, _wrapped_uuid(str(command_id_factory()))))
    )
    return _field(15, _field(1, _field(3, coverage)))


def _coverage_spec(setting: int, floor: int, mode: int, behavior: int) -> bytes:
    return (
        _varint_field(1, setting)
        + _varint_field(2, floor)
        + _varint_field(4, mode)
        + _varint_field(5, behavior)
    )


def _coverage_spec_values(
    cleaning_mode: CleaningMode, setting_value: int
) -> tuple[tuple[int, int, int, int], ...]:
    values: list[tuple[int, int, int, int]] = []
    if cleaning_mode in {CleaningMode.VACUUM, CleaningMode.BOTH}:
        values.extend(
            (setting_value, floor, 0, behavior)
            for floor in (0, 1)
            for behavior in range(4)
        )
    if cleaning_mode in {CleaningMode.MOP, CleaningMode.BOTH}:
        # The native app's strength selector controls vacuum coverage only.
        # Mop goals always request Standard; double-pass is a robot override.
        values.extend(
            (_COVERAGE_SETTING_VALUES[CoverageSetting.STANDARD], 0, 1, behavior)
            for behavior in range(4)
        )
    return tuple(values)


def _coverage_specs(
    cleaning_mode: CleaningMode, setting_value: int
) -> tuple[bytes, ...]:
    return tuple(
        _coverage_spec(*values)
        for values in _coverage_spec_values(cleaning_mode, setting_value)
    )


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


def _float_field(number: int, value: float) -> bytes:
    """Encode protobuf float while matching official omission of zero."""
    if value == 0:
        return b""
    return _fixed32(number, struct.unpack("<I", struct.pack("<f", value))[0])


def _fixed64(number: int, value: int) -> bytes:
    return _varint((number << 3) | 1) + value.to_bytes(8, "little")


def _varint(value: int) -> bytes:
    output = bytearray()
    while value > 0x7F:
        output.append((value & 0x7F) | 0x80)
        value >>= 7
    output.append(value)
    return bytes(output)
