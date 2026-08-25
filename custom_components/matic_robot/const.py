"""Constants for Matic Hermes."""

from typing import Final

DOMAIN: Final = "matic_robot"
PLATFORMS: Final = [
    "binary_sensor",
    "button",
    "camera",
    "event",
    "number",
    "select",
    "sensor",
    "switch",
    "update",
    "vacuum",
]

CONF_CERTIFICATE_FINGERPRINT: Final = "certificate_fingerprint"
CONF_CLEANING_MODE: Final = "cleaning_mode"
CONF_COVERAGE_SETTING: Final = "coverage_setting"
CONF_HERMES_CREDENTIAL: Final = "hermes_credential"
CONF_HOSTNAME: Final = "hostname"
CONF_SERIAL_NUMBER: Final = "serial_number"

DEFAULT_PORT: Final = 16320
SERVICE_TYPE: Final = "_matic_hermes._tcp.local."
UPDATE_INTERVAL_SECONDS: Final = 30
SLOW_UPDATE_INTERVAL_SECONDS: Final = 300
MAP_UPDATE_INTERVAL_SECONDS: Final = 900

DATA_PLAN_MANAGER: Final = "cleaning_plan_manager"
DATA_FIRMWARE_TRACKER: Final = "firmware_tracker"
DATA_SLAM_MAP_STORE: Final = "slam_map_store"
DATA_LLM_API: Final = "llm_api"

EVENT_FIRMWARE_CHANGED: Final = f"{DOMAIN}_firmware_changed"
EVENT_FIRMWARE_ANALYZED: Final = f"{DOMAIN}_firmware_analyzed"
EVENT_CLEANING_FINISHED: Final = f"{DOMAIN}_cleaning_finished"
EVENT_CUES: Final = f"{DOMAIN}_cues"

CUES_EVENT_TYPES: Final = (
    "disabled",
    "ready",
    "wake_word_detected",
    "intent_processing",
    "intent_classified",
    "intent_rejected",
    "gesture_awaiting_pointed_target",
    "gesture_pointed_target_accepted",
    "gesture_no_target_found",
    "gesture_facing_user",
    "gesture_person_not_found",
    "gesture_following",
    "following_started",
    "following_stopped",
)
