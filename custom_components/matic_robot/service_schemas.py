"""Validation contracts for the Matic Home Assistant actions."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

import probatio
from homeassistant.helpers import config_validation as cv

from .cadence import MAX_CADENCE_INTERVAL, validate_cadence_interval
from .client.commands import CleaningMode, CoverageSetting
from .client.endpoints import HERMES_ENDPOINT_NAMES
from .const import MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE, MAX_ROOM_SEQUENCE_SIZE

CLEAN_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("rooms"): probatio.All(
            cv.ensure_list, [cv.string], probatio.Length(max=MAX_ROOM_SEQUENCE_SIZE)
        ),
        probatio.Optional("cleaning_mode"): probatio.In(
            [value.value for value in CleaningMode]
        ),
        probatio.Optional("coverage_setting"): probatio.In(
            [value.value for value in CoverageSetting]
        ),
        probatio.Optional("ordered", default=False): cv.boolean,
    }
)

GO_TO_ROOM_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("room"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        )
    }
)

PHOTO_PATROL_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("rooms"): probatio.All(
            cv.ensure_list,
            [probatio.All(cv.string, probatio.Length(min=1, max=128))],
            probatio.Length(min=1, max=12),
        ),
        probatio.Optional("full_resolution", default=False): cv.boolean,
    }
)

CLEAN_ROOM_AGAIN_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("room"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("cleaning_mode"): probatio.In(
            [mode.value for mode in CleaningMode]
        ),
        probatio.Optional("coverage_setting"): probatio.In(
            [setting.value for setting in CoverageSetting]
        ),
    }
)

CLEAN_AREA_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("area"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("cleaning_mode"): probatio.In(
            [value.value for value in CleaningMode]
        ),
        probatio.Optional("coverage_setting"): probatio.In(
            [value.value for value in CoverageSetting]
        ),
    }
)


def _cadence_interval_validator(field: str) -> Callable[[object], int | None]:
    """Adapt the shared cadence validator to probatio errors."""

    def validate(value: object) -> int | None:
        try:
            return validate_cadence_interval(value, field)
        except ValueError as err:
            raise probatio.Invalid(
                f"Use a whole number from 1 to {MAX_CADENCE_INTERVAL}"
            ) from err

    return validate


ROOM_CADENCE_SCHEMA = probatio.Schema(
    {
        probatio.Optional("scope", default="plan"): probatio.In(("plan", "shared")),
        probatio.Optional("mop_every_n"): probatio.Any(
            None,
            _cadence_interval_validator("mop_every_n"),
        ),
        probatio.Optional("coverage_every_n"): probatio.Any(
            None,
            _cadence_interval_validator("coverage_every_n"),
        ),
        probatio.Optional("periodic_coverage_setting"): probatio.Any(
            None, probatio.In([value.value for value in CoverageSetting])
        ),
        probatio.Optional("do_mop_next", default=False): cv.boolean,
        probatio.Optional("do_coverage_next", default=False): cv.boolean,
    }
)

_ROOM_FIELDS = {
    probatio.Required("room"): cv.string,
    probatio.Optional("cleaning_mode", default=CleaningMode.BOTH.value): probatio.In(
        [value.value for value in CleaningMode]
    ),
    probatio.Optional(
        "coverage_setting", default=CoverageSetting.OPTIMAL.value
    ): probatio.In([value.value for value in CoverageSetting]),
}
SAVED_ROOM_SCHEMA = probatio.Schema(_ROOM_FIELDS)
SAVED_PLAN_ROOM_SCHEMA = probatio.Schema(
    {**_ROOM_FIELDS, probatio.Optional("cadence"): ROOM_CADENCE_SCHEMA}
)
# Areas take the same overrides as clean_area and never a cadence: the robot
# reports no per-area completion, so an area runs every time.
SAVED_PLAN_AREA_SCHEMA = probatio.Schema(
    {
        probatio.Required("area"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("cleaning_mode"): probatio.In(
            [value.value for value in CleaningMode]
        ),
        probatio.Optional("coverage_setting"): probatio.In(
            [value.value for value in CoverageSetting]
        ),
    }
)


def saved_plan_entry(value: object) -> dict[str, Any]:
    """Validate one plan entry: a mapped room or a saved custom area."""
    if isinstance(value, Mapping) and "area" in value:
        if "room" in value:
            raise probatio.Invalid("Use either room or area in one entry")
        return dict(SAVED_PLAN_AREA_SCHEMA(value))
    return dict(SAVED_PLAN_ROOM_SCHEMA(value))


SAVED_PLAN_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        )
    }
)

RUN_SELECTED_PLAN_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("preview_token"): probatio.All(
            cv.string,
            probatio.Match(r"^[0-9a-f]{64}$"),
        ),
    }
)

_ROOM_SEQUENCE_FIELDS = {
    probatio.Required("rooms"): probatio.All(
        cv.ensure_list,
        [SAVED_ROOM_SCHEMA],
        probatio.Length(min=1, max=MAX_ROOM_SEQUENCE_SIZE),
    ),
    probatio.Optional("return_to_base", default=True): cv.boolean,
    probatio.Optional("use_room_schedule", default=False): cv.boolean,
    probatio.Optional("override_room_schedule", default=False): cv.boolean,
}
CLEAN_ROOM_SEQUENCE_SCHEMA = cv.make_entity_service_schema(
    {
        **_ROOM_SEQUENCE_FIELDS,
        probatio.Optional("preview_token"): probatio.All(
            cv.string,
            probatio.Match(r"^[0-9a-f]{64}$"),
        ),
    }
)
PREVIEW_ROOM_SEQUENCE_SCHEMA = cv.make_entity_service_schema(_ROOM_SEQUENCE_FIELDS)

PLAN_TARGET_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("include_unmanaged", default=False): cv.boolean,
        probatio.Optional("stop_now", default=False): cv.boolean,
        probatio.Optional("expected_run_id"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
    }
)

RESET_PLAN_HISTORY_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("all_plans", default=False): cv.boolean,
    }
)

RESET_ROOM_CADENCE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("room_id"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("modes"): probatio.All(
            cv.ensure_list,
            [probatio.In(("mop", "coverage"))],
            probatio.Length(min=1, max=2),
        ),
    }
)

DELETE_ROOM_SCHEDULE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("room_id"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Required("expected_token"): probatio.All(
            cv.string, probatio.Match(r"^[0-9a-f]{64}$")
        ),
    }
)

LIST_PLANS_SCHEMA = cv.make_entity_service_schema({})

SAVE_PLAN_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Optional("plan_id"): probatio.All(
            cv.string, probatio.Length(min=1, max=64)
        ),
        probatio.Required("name"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Optional("enabled", default=True): cv.boolean,
        probatio.Optional("run_behavior", default="intelligent"): probatio.In(
            ("intelligent", "ordered")
        ),
        probatio.Required("rooms"): probatio.All(
            cv.ensure_list,
            [saved_plan_entry],
            probatio.Length(min=1, max=MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE),
        ),
        probatio.Optional("return_to_base", default=True): cv.boolean,
        probatio.Optional("finish_current_room", default=False): cv.boolean,
        probatio.Optional("finish_current_room_threshold", default=50): probatio.All(
            probatio.Coerce(int), probatio.Range(min=0, max=100)
        ),
        probatio.Optional("occupancy_aware", default=False): cv.boolean,
        probatio.Optional("occupancy_sensors", default=dict): probatio.All(
            {
                probatio.All(cv.string, probatio.Length(min=1, max=128)): (
                    cv.entity_domain("binary_sensor")
                )
            },
            probatio.Length(max=MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE),
        ),
        probatio.Optional("start_timeout", default=120): probatio.All(
            probatio.Coerce(int), probatio.Range(min=10, max=600)
        ),
        probatio.Optional("completion_timeout", default=21600): probatio.All(
            probatio.Coerce(int), probatio.Range(min=60, max=43200)
        ),
        probatio.Optional("select", default=True): cv.boolean,
    }
)

PLAN_REFERENCE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        )
    }
)

SAVE_PLAN_ROOM_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("plan"): probatio.All(
            cv.string, probatio.Length(min=1, max=128)
        ),
        probatio.Required("room"): saved_plan_entry,
    }
)

_PLAN_ENTRY_TARGET = {
    probatio.Exclusive("room", "plan_entry"): cv.string,
    probatio.Exclusive("area", "plan_entry"): probatio.All(
        cv.string, probatio.Length(min=1, max=128)
    ),
}

DELETE_PLAN_ROOM_SCHEMA = probatio.All(
    cv.make_entity_service_schema(
        {
            probatio.Required("plan"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
            **_PLAN_ENTRY_TARGET,
        }
    ),
    cv.has_at_least_one_key("room", "area"),
)

MOVE_PLAN_ROOM_SCHEMA = probatio.All(
    cv.make_entity_service_schema(
        {
            probatio.Required("plan"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
            **_PLAN_ENTRY_TARGET,
            # A plan holds up to the room limit and as many custom areas again.
            probatio.Required("new_position"): probatio.All(
                probatio.Coerce(int),
                probatio.Range(min=1, max=2 * MAX_ROOM_SEQUENCE_SIZE),
            ),
        }
    ),
    cv.has_at_least_one_key("room", "area"),
)

INSPECT_ENDPOINT_SERVICE_SCHEMA = cv.make_entity_service_schema(
    {
        probatio.Required("endpoint"): probatio.In(HERMES_ENDPOINT_NAMES),
        probatio.Optional("limit", default=32): probatio.All(
            probatio.Coerce(int), probatio.Range(min=1, max=256)
        ),
    }
)

FIRMWARE_SNAPSHOT_SCHEMA = cv.make_entity_service_schema({})
