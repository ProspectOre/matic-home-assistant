"""Typed client models."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


@dataclass(frozen=True, slots=True)
class RobotInfo:
    """Identity and connection metadata returned by a Matic robot."""

    serial_number: str
    name: str
    hostname: str
    port: int
    ip4_address: str
    ip6_address: str
    encrypted: bool
    requires_auth: bool
    network_auth: bool
    hardware_revision: str


class RobotActivity(StrEnum):
    """Stable high-level activity derived from verified Hermes states."""

    ERROR = "error"
    PAUSED = "paused"
    CLEANING = "cleaning"
    RETURNING = "returning"
    CHARGING = "charging"
    DOCKED = "docked"
    READY = "ready"


@dataclass(frozen=True, slots=True)
class RobotOperationalState:
    """Verified fields from the local ``kabuki_state`` property."""

    battery_percentage: int | None
    state_codes: tuple[int, ...]
    error_codes: tuple[int, ...]
    charging_idle: bool
    charging: bool
    low_charge: bool
    paused: bool
    cleaning: bool
    returning: bool
    software_version: str | None = None
    release_channel: str | None = None
    current_area: str | None = None
    previous_area: str | None = None
    robot_profile: str | None = None

    @property
    def activity(self) -> RobotActivity:
        """Return a conservative high-level state without inventing semantics."""
        if self.error_codes:
            return RobotActivity.ERROR
        if self.paused:
            return RobotActivity.PAUSED
        if self.cleaning:
            return RobotActivity.CLEANING
        if self.returning:
            return RobotActivity.RETURNING
        if self.charging:
            return RobotActivity.CHARGING
        if self.charging_idle:
            return RobotActivity.DOCKED
        return RobotActivity.READY

    @property
    def is_charging(self) -> bool:
        """Return whether the robot is docked and charging or charge-idle."""
        return self.charging or self.charging_idle

    @property
    def is_fully_charged(self) -> bool:
        """Return the official fully-charged battery predicate."""
        return self.battery_percentage == 100 and self.is_charging

    @property
    def error_names(self) -> tuple[str, ...]:
        """Return truthful automation-safe labels for raw robot error codes.

        The app's public enum ordering is not the numeric Hermes wire mapping;
        live firmware uses values such as 207 and 304. Preserve those values
        without guessing a human meaning until a numeric mapping is verified.
        """
        return tuple(f"error_code_{code}" for code in self.error_codes)


@dataclass(frozen=True, slots=True)
class RobotTelemetry:
    """Decoded local settings, software, schedules, history, and diagnostics."""

    software_version: str | None = None
    software_profile: str | None = None
    protocol_version: int | None = None
    supports_easter_event: bool | None = None
    update_channel: str | None = None
    update_state: str | None = None
    wifi_state: str | None = None
    wifi_ssid: str | None = None
    wifi_signal_dbm: int | None = None
    wifi_networks: tuple[WifiNetwork, ...] = ()
    timezone: str | None = None
    scheduled_cleanings: int | None = None
    schedules: tuple[CleaningSchedule, ...] = ()
    local_cleaning_sessions: int | None = None
    latest_session: CleaningSession | None = None
    child_lock_enabled: bool | None = None
    pet_waste_enabled: bool | None = None
    voice_enabled: bool | None = None
    matter_pairing_enabled: bool | None = None
    deep_mop_enabled: bool | None = None
    water_flow_factor: float | None = None
    ssh_tunnel_permission: bool | None = None
    uploader_opt_in: bool | None = None
    active_cleaning_session: bool | None = None
    dock_detections: int | None = None
    sink_summon_locations: int | None = None
    coverage_time_seconds: int | None = None


@dataclass(frozen=True, slots=True)
class WifiNetwork:
    """One network reported by the robot's local Wi-Fi scan."""

    ssid: str
    signal_dbm: int | None
    connected: bool
    known: bool


@dataclass(frozen=True, slots=True)
class CleaningSchedule:
    """One locally stored cleaning schedule."""

    name: str | None
    weekdays: tuple[str, ...]
    minute_of_day: int | None
    timezone: str | None
    ordered: bool
    enabled: bool | None
    room_ids: tuple[str, ...]

    @property
    def time(self) -> str | None:
        """Return the schedule wall-clock time."""
        if self.minute_of_day is None:
            return None
        hours, minutes = divmod(self.minute_of_day, 60)
        return f"{hours:02d}:{minutes:02d}"


@dataclass(frozen=True, slots=True)
class CleaningSession:
    """Decoded summary of one robot-native cleaning session."""

    started_at: str | None
    ended_at: str | None
    duration_seconds: int | None
    rooms: tuple[str, ...]
    room_durations: tuple[tuple[str, int], ...]
    completed: bool | None


@dataclass(frozen=True, slots=True)
class HermesCollectionEntry:
    """One raw Hermes collection entry: its opaque key and value bytes."""

    key: bytes
    value: bytes


@dataclass(frozen=True, slots=True)
class RobotState:
    """Latest coordinated state."""

    info: RobotInfo
    operational: RobotOperationalState
    floor_plan: FloorPlan | None = None
    pose: RobotPose | None = None
    telemetry: RobotTelemetry = field(default_factory=RobotTelemetry)


@dataclass(frozen=True, slots=True)
class Room:
    """A named room from the robot's local coverage plan."""

    id: str
    name: str
    protocol_id: str
    id_wire: bytes
    boundary: tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class FloorPlan:
    """The active mission's standard partition."""

    mission_id: int
    partition_protocol_id: str
    partition_id_wire: bytes
    rooms: tuple[Room, ...]


@dataclass(frozen=True, slots=True)
class RobotPose:
    """Latest robot translation in map coordinates."""

    x: float
    y: float
    z: float
