"""Runtime coverage for the four cleaning automation blueprints."""

from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from homeassistant.components.automation.config import AUTOMATION_BLUEPRINT_SCHEMA
from homeassistant.components.blueprint.const import CONF_BLUEPRINT, CONF_USE_BLUEPRINT
from homeassistant.components.blueprint.models import Blueprint, BlueprintInputs
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from homeassistant.util.yaml import load_yaml
from pytest_homeassistant_custom_component.common import async_fire_time_changed

ROOT = Path(__file__).parents[1] / "blueprints/automation/matic_robot"
VACUUM = "vacuum.matic_test"
BATTERY = "sensor.matic_test_battery"
PET = "binary_sensor.litter_box_occupied"
PEOPLE = ["person.alex", "person.sam"]
AUTOMATION = "automation.blueprint_under_test"


@pytest.fixture(autouse=True)
async def detach_triggers(hass: HomeAssistant) -> AsyncIterator[None]:
    """Turn the automation off so its time triggers do not outlive the test."""
    yield
    await hass.services.async_call(
        "automation", "turn_off", {"entity_id": AUTOMATION}, blocking=True
    )


async def setup_blueprint(
    hass: HomeAssistant, filename: str, inputs: dict[str, Any]
) -> list[ServiceCall]:
    """Load one blueprint as a live automation and record the actions it calls."""
    path = ROOT / filename
    blueprint = Blueprint(
        load_yaml(path),
        path=str(path),
        expected_domain="automation",
        schema=AUTOMATION_BLUEPRINT_SCHEMA,
    )
    substituted = BlueprintInputs(
        blueprint,
        {
            CONF_BLUEPRINT: {"path": str(path)},
            CONF_USE_BLUEPRINT: {"path": str(path), "input": inputs},
        },
    ).async_substitute()
    calls: list[ServiceCall] = []

    async def record(call: ServiceCall) -> None:
        calls.append(call)

    for service in ("intelligent_clean", "stop_intelligent_cleaning"):
        hass.services.async_register("matic_robot", service, record)
    substituted["id"] = filename
    substituted["alias"] = "blueprint under test"
    assert await async_setup_component(
        hass, "automation", {"automation": [substituted]}
    )
    await hass.async_block_till_done()
    return calls


async def run_now(hass: HomeAssistant) -> None:
    """Fire the automation as its time trigger would, conditions included."""
    await hass.services.async_call(
        "automation",
        "trigger",
        {"entity_id": AUTOMATION, "skip_condition": False},
        blocking=True,
    )
    await hass.async_block_till_done()


async def advance(hass: HomeAssistant, **delta: float) -> None:
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(**delta))
    await hass.async_block_till_done()


async def test_named_zone_counts_as_away_and_blank_plan_is_omitted(
    hass: HomeAssistant,
) -> None:
    """A member at Work is away, and a blank plan runs the default plan."""
    for person in PEOPLE:
        hass.states.async_set(person, "home")
    hass.states.async_set(VACUUM, "docked")
    calls = await setup_blueprint(
        hass,
        "clean_when_away.yaml",
        {"vacuum": VACUUM, "household": PEOPLE, "settle_time": {"minutes": 5}},
    )
    hass.states.async_set(PEOPLE[0], "Work")
    hass.states.async_set(PEOPLE[1], "not_home")
    await hass.async_block_till_done()
    assert calls == []
    await advance(hass, minutes=6)

    assert [call.service for call in calls] == ["intelligent_clean"]
    assert "plan" not in calls[0].data

    hass.states.async_set(PEOPLE[1], "home")
    await hass.async_block_till_done()
    assert [call.service for call in calls] == [
        "intelligent_clean",
        "stop_intelligent_cleaning",
    ]


@pytest.mark.parametrize(
    ("other_state", "vacuum_state"),
    [("unknown", "docked"), ("unavailable", "docked"), ("Work", "cleaning")],
)
async def test_away_waits_for_unknown_members_and_an_idle_robot(
    hass: HomeAssistant, other_state: str, vacuum_state: str
) -> None:
    """Unknown presence never counts as away and a running clean is kept."""
    for person in PEOPLE:
        hass.states.async_set(person, "home")
    hass.states.async_set(VACUUM, vacuum_state)
    calls = await setup_blueprint(
        hass,
        "clean_when_away.yaml",
        {"vacuum": VACUUM, "household": PEOPLE, "plan": "Main floor"},
    )
    hass.states.async_set(PEOPLE[0], "not_home")
    hass.states.async_set(PEOPLE[1], other_state)
    await advance(hass, minutes=6)
    assert calls == []


async def test_away_recheck_sees_the_household(hass: HomeAssistant) -> None:
    """Trigger variables reach only triggers, so the action recheck needs its own."""
    await setup_blueprint(
        hass, "clean_when_away.yaml", {"vacuum": VACUUM, "household": PEOPLE}
    )
    blueprint = load_yaml(ROOT / "clean_when_away.yaml")
    assert "household_entities" in blueprint["trigger_variables"]
    assert "household_entities" in blueprint["variables"]


async def test_away_passes_a_typed_plan_name(hass: HomeAssistant) -> None:
    hass.states.async_set(PEOPLE[0], "home")
    hass.states.async_set(VACUUM, "idle")
    calls = await setup_blueprint(
        hass,
        "clean_when_away.yaml",
        {"vacuum": VACUUM, "household": PEOPLE[:1], "plan": " Main floor "},
    )
    hass.states.async_set(PEOPLE[0], "not_home")
    await advance(hass, minutes=6)
    assert calls[0].data["plan"] == "Main floor"


async def test_pet_aware_runs_once_a_day_only_when_docked(
    hass: HomeAssistant,
) -> None:
    """Pet clean-up waits for an idle robot and runs at most once a day."""
    hass.states.async_set(PET, "on")
    hass.states.async_set(VACUUM, "cleaning")
    calls = await setup_blueprint(
        hass,
        "pet_aware.yaml",
        {"vacuum": VACUUM, "pet_presence": PET, "plan": "Litter corner"},
    )

    async def pet_leaves() -> None:
        hass.states.async_set(PET, "on")
        await hass.async_block_till_done()
        hass.states.async_set(PET, "off")
        await advance(hass, minutes=11)

    await pet_leaves()
    assert calls == []

    hass.states.async_set(VACUUM, "docked")
    await pet_leaves()
    assert [call.data["plan"] for call in calls] == ["Litter corner"]

    await pet_leaves()
    assert len(calls) == 1


@pytest.mark.parametrize(
    ("battery", "level", "vacuum_state", "runs"),
    [
        (None, None, "docked", True),
        (BATTERY, "80", "docked", True),
        (BATTERY, "40", "docked", False),
        (BATTERY, "unavailable", "docked", False),
        (None, None, "cleaning", False),
    ],
    ids=("no-guard", "charged", "at-minimum", "unknown-level", "busy"),
)
async def test_quiet_hours_battery_guard_is_optional(
    hass: HomeAssistant,
    battery: str | None,
    level: str | None,
    vacuum_state: str,
    runs: bool,
) -> None:
    """The battery guard applies only when a battery sensor is chosen."""
    hass.states.async_set(VACUUM, vacuum_state)
    inputs: dict[str, Any] = {"vacuum": VACUUM}
    if battery is not None:
        hass.states.async_set(battery, level)
        inputs["battery"] = battery
    calls = await setup_blueprint(hass, "quiet_hours.yaml", inputs)
    await run_now(hass)
    assert bool(calls) is runs


@pytest.mark.parametrize(("vacuum_state", "runs"), [("idle", True), ("error", False)])
async def test_scheduled_rotation_needs_a_docked_or_idle_robot(
    hass: HomeAssistant, vacuum_state: str, runs: bool
) -> None:
    hass.states.async_set(VACUUM, vacuum_state)
    calls = await setup_blueprint(hass, "room_rotation.yaml", {"vacuum": VACUUM})
    await run_now(hass)
    assert bool(calls) is runs
    assert all("plan" not in call.data for call in calls)
