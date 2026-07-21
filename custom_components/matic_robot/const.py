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

EVENT_FIRMWARE_CHANGED: Final = f"{DOMAIN}_firmware_changed"
EVENT_CLEANING_FINISHED: Final = f"{DOMAIN}_cleaning_finished"
