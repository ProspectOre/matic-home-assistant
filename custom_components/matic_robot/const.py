"""Constants for Matic Hermes."""

from typing import Final

DOMAIN: Final = "matic_robot"
PLATFORMS: Final = [
    "binary_sensor",
    "button",
    "camera",
    "number",
    "select",
    "sensor",
    "switch",
    "vacuum",
]

# Locally observed, non-credential Hermes collections. This allowlist powers
# advanced diagnostics without allowing arbitrary reads of future secret stores.
HERMES_COLLECTIONS: Final = (
    "active_session_key",
    "approximate_trajectory",
    "child_lock_enabled_state",
    "coverage_corridor",
    "coverage_marker",
    "coverage_plan",
    "coverage_session_history",
    "coverage_session_thumbnails",
    "coverage_time",
    "current_version",
    "deep_mop_override_setting_state",
    "displayed_mission",
    "dock_detections",
    "jukebox_state",
    "kabuki_state",
    "labeled_missions",
    "latest_pose",
    "map_combined_coverage",
    "map_compressed_rgb",
    "map_compressed_rgb_higher",
    "map_integrated",
    "map_semantics",
    "map_semantics_override",
    "matter_pairing_state",
    "planned_path",
    "petwaste_enabled_state",
    "schedule_event_previews",
    "schedule_events",
    "semantics_override",
    "sink_summon_locations",
    "sink_summons",
    "time_zone",
    "update_config",
    "update_state",
    "uploader_config_state",
    "user_tunnel_ssh_permission",
    "voice_enabled_state",
    "water_flow_override_state",
    "wifi_status",
    "zones",
)

CONF_CERTIFICATE_FINGERPRINT: Final = "certificate_fingerprint"
CONF_CLEANING_MODE: Final = "cleaning_mode"
CONF_COVERAGE_SETTING: Final = "coverage_setting"
CONF_HERMES_CREDENTIAL: Final = "hermes_credential"
CONF_HOSTNAME: Final = "hostname"
CONF_SERIAL_NUMBER: Final = "serial_number"

DEFAULT_PORT: Final = 16320
SERVICE_TYPE: Final = "_matic_hermes._tcp.local."
UPDATE_INTERVAL_SECONDS: Final = 30

DATA_PLAN_MANAGER: Final = "cleaning_plan_manager"
