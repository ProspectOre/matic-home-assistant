"""Authoritative Hermes endpoint metadata for reads and firmware checks."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class HermesEndpointKind(StrEnum):
    """How a Hermes endpoint must be read."""

    PROPERTY = "property"
    COLLECTION = "collection"


class HermesEndpointSensitivity(StrEnum):
    """Maximum privacy classification for an endpoint payload."""

    DIAGNOSTIC = "diagnostic"
    HOME_CONTEXT = "home_context"


@dataclass(frozen=True, slots=True)
class HermesEndpoint:
    """Describe one observed, non-credential Hermes read endpoint."""

    name: str
    kind: HermesEndpointKind
    sensitivity: HermesEndpointSensitivity = HermesEndpointSensitivity.HOME_CONTEXT


def _property(
    name: str,
    sensitivity: HermesEndpointSensitivity = HermesEndpointSensitivity.HOME_CONTEXT,
) -> HermesEndpoint:
    return HermesEndpoint(name, HermesEndpointKind.PROPERTY, sensitivity)


def _collection(
    name: str,
    sensitivity: HermesEndpointSensitivity = HermesEndpointSensitivity.HOME_CONTEXT,
) -> HermesEndpoint:
    return HermesEndpoint(name, HermesEndpointKind.COLLECTION, sensitivity)


# This is the single source of truth for public Hermes inspection. Endpoint kind
# is evidence-based: properties return one current value, while collections may
# stream zero or more keyed records. Credential stores are intentionally absent.
HERMES_ENDPOINTS = (
    _property("active_session_key"),
    _collection("approximate_trajectory"),
    _property("child_lock_enabled_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _collection("coverage_corridor"),
    _collection("coverage_marker"),
    _property("coverage_plan"),
    _collection("coverage_session_history"),
    _collection("coverage_session_thumbnails"),
    _property("coverage_time", HermesEndpointSensitivity.DIAGNOSTIC),
    _property("current_version", HermesEndpointSensitivity.DIAGNOSTIC),
    _property("deep_mop_override_setting_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _collection("displayed_mission"),
    _collection("dock_detections", HermesEndpointSensitivity.DIAGNOSTIC),
    _collection("jukebox_state"),
    _property("kabuki_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _collection("labeled_missions"),
    _property("latest_pose"),
    _collection("map_combined_coverage"),
    _collection("map_compressed_rgb"),
    _collection("map_compressed_rgb_higher"),
    _collection("map_integrated"),
    _collection("map_semantics"),
    _collection("map_semantics_override"),
    _property("matter_pairing_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _collection("planned_path"),
    _property("petwaste_enabled_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _collection("schedule_event_previews"),
    _collection("schedule_events"),
    _collection("semantics_override"),
    _collection("sink_summon_locations"),
    _collection("sink_summons"),
    _property("time_zone"),
    _property("update_config", HermesEndpointSensitivity.DIAGNOSTIC),
    _property("update_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _property("uploader_config_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _property("user_tunnel_ssh_permission", HermesEndpointSensitivity.DIAGNOSTIC),
    _property("voice_enabled_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _property("water_flow_override_state", HermesEndpointSensitivity.DIAGNOSTIC),
    _property("wifi_status"),
    _collection("zones"),
)

HERMES_ENDPOINT_MAP = {endpoint.name: endpoint for endpoint in HERMES_ENDPOINTS}
HERMES_ENDPOINT_NAMES = tuple(HERMES_ENDPOINT_MAP)
