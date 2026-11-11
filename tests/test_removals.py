"""Repairs notices for what 0.6 removes, and the one-click blueprint update."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.config_entries import SOURCE_IGNORE
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from homeassistant.util.yaml import Input, load_yaml
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import CONF_SERIAL_NUMBER, DOMAIN
from custom_components.matic_robot.removals import (
    BLUEPRINT_ISSUE_ID,
    RELEASE_NOTES_URL,
    async_warn_of_removals,
    warn_of_removal,
)
from custom_components.matic_robot.services import async_register_services

SERIAL = "synthetic-serial"
VACUUM = "vacuum.matic"
SOURCE = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/blueprints/automation/matic_robot"
)
# The two ways released Matic blueprints passed the plan to the retired action.
TEMPLATE_DATA = (
    "\"{{ {'plan': plan_name | trim} if (plan_name or '') | trim else {} }}\""
)
MAPPING_DATA = "\n      plan: !input plan"


def _blueprint(
    name: str,
    data: str,
    *,
    source: str = SOURCE,
    action: str = "matic_robot.intelligent_clean",
) -> str:
    return f"""
blueprint:
  name: "Matic: {name}"
  domain: automation
  source_url: {source}/{name}.yaml
  input:
    vacuum:
      selector:
        entity:
    plan:
      default: ""
variables:
  plan_name: !input plan
triggers:
  - trigger: event
    event_type: never_fired
actions:
  - action: {action}
    target:
      entity_id: !input vacuum
    data: {data}
"""


BLUEPRINTS = {
    "template": _blueprint("template", TEMPLATE_DATA),
    "mapping": _blueprint("mapping", MAPPING_DATA),
    "statement": _blueprint("statement", '"{% if plan_name %}{}{% endif %}"'),
    "current": _blueprint(
        "current", TEMPLATE_DATA, action="matic_robot.run_selected_plan"
    ),
    "elsewhere": _blueprint(
        "elsewhere", TEMPLATE_DATA, source="https://example.com/blueprints"
    ),
    "broken": "blueprint: 5\n",
}
AUTOMATIONS = """
- id: named_plan
  alias: Named plan
  use_blueprint:
    path: matic/template.yaml
    input: {vacuum: vacuum.matic, plan: " Main floor "}
- id: default_plan
  alias: Default plan
  use_blueprint:
    path: matic/template.yaml
    input: {vacuum: vacuum.matic}
- id: older_copy
  alias: Older copy
  use_blueprint:
    path: matic/mapping.yaml
    input: {vacuum: vacuum.matic, plan: Main floor}
"""


def _issue(hass: HomeAssistant, issue_id: str) -> ir.IssueEntry | None:
    return ir.async_get(hass).async_get_issue(DOMAIN, issue_id)


@pytest.mark.parametrize(
    ("action", "notice", "placeholders"),
    [
        (
            "intelligent_clean",
            "removed_plan_run_action",
            {"run_behavior": "intelligent"},
        ),
        ("clean_entire_plan", "removed_plan_run_action", {"run_behavior": "ordered"}),
        ("select_plan", "removed_select_plan_action", {}),
        ("save_plan_room", "removed_plan_room_action", {}),
        ("delete_plan_room", "removed_plan_room_action", {}),
        ("move_plan_room", "removed_plan_room_action", {}),
    ],
)
async def test_retired_action_warns_and_still_runs(
    hass: HomeAssistant, action: str, notice: str, placeholders: dict[str, str]
) -> None:
    handler = AsyncMock(return_value={"plan_id": "home"})
    call = ServiceCall(hass, DOMAIN, action, {})

    assert await warn_of_removal(hass, handler)(call) == {"plan_id": "home"}

    handler.assert_awaited_once_with(call)
    issue = _issue(hass, f"removed_action_{action}")
    assert issue is not None
    assert issue.translation_key == notice
    assert issue.translation_placeholders == {
        "action": f"matic_robot.{action}",
        **placeholders,
    }
    assert issue.severity is ir.IssueSeverity.WARNING
    assert issue.learn_more_url == RELEASE_NOTES_URL
    assert not issue.is_fixable
    assert not issue.is_persistent


async def test_only_the_retired_actions_are_registered_with_a_notice(
    hass: HomeAssistant,
) -> None:
    with (
        patch(
            "custom_components.matic_robot.services.CleaningPlanManager",
            return_value=SimpleNamespace(async_load=AsyncMock()),
        ),
        patch(
            "custom_components.matic_robot.services.FirmwareTracker",
            return_value=SimpleNamespace(
                async_load=AsyncMock(), replay_reports=MagicMock()
            ),
        ),
    ):
        await async_register_services(hass)
    room = {"plan": "Home", "room": "Kitchen"}
    retired = {
        "intelligent_clean": {},
        "clean_entire_plan": {},
        "select_plan": {"plan": "Home"},
        "save_plan_room": {"plan": "Home", "room": {"room": "Kitchen"}},
        "delete_plan_room": room,
        "move_plan_room": {**room, "new_position": 1},
    }

    kept = {"run_selected_plan": {}, "delete_plan": {"plan": "Home"}}
    for action, data in (kept | retired).items():
        with pytest.raises(ServiceValidationError):
            await hass.services.async_call(
                DOMAIN, action, {"entity_id": VACUUM, **data}, blocking=True
            )

    assert {
        issue_id for domain, issue_id in ir.async_get(hass).issues if domain == DOMAIN
    } == {f"removed_action_{action}" for action in retired}


async def test_startup_names_each_retired_entity_that_is_in_use(
    hass: HomeAssistant,
) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_SERIAL_NUMBER: SERIAL})
    entry.add_to_hass(hass)
    MockConfigEntry(domain=DOMAIN, source=SOURCE_IGNORE).add_to_hass(hass)
    registry = er.async_get(hass)

    def entity(domain: str, key: str, **kwargs: object) -> str:
        return registry.async_get_or_create(
            domain,
            DOMAIN,
            f"{SERIAL}_{key}",
            config_entry=entry,
            suggested_object_id=f"matic_{key}",
            **kwargs,
        ).entity_id

    paused = entity("binary_sensor", "paused")
    button = entity("button", "intelligent_clean")
    used = [
        paused,
        entity("binary_sensor", "cleaning"),
        entity("binary_sensor", "returning", disabled_by=er.RegistryEntryDisabler.USER),
    ]
    entity("sensor", "rooms")
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                {
                    "id": "pause_alert",
                    "alias": "Pause alert",
                    "triggers": {"trigger": "state", "entity_id": used},
                    "actions": [],
                },
                {
                    "alias": "Typed in YAML",
                    "triggers": {"trigger": "state", "entity_id": paused},
                    "actions": [],
                },
            ]
        },
    )
    assert await async_setup_component(
        hass,
        "script",
        {
            "script": {
                "evening_run": {
                    "alias": "Evening run",
                    "sequence": [
                        {"action": "button.press", "target": {"entity_id": button}}
                    ],
                }
            }
        },
    )

    await async_warn_of_removals(hass)

    issues = {
        issue_id: issue
        for (domain, issue_id), issue in ir.async_get(hass).issues.items()
        if domain == DOMAIN
    }
    assert set(issues) == {f"removed_entity_{paused}", f"removed_entity_{button}"}
    state = issues[f"removed_entity_{paused}"]
    assert state.translation_key == "removed_entity_state"
    assert state.translation_placeholders == {
        "entity_id": paused,
        "items": (
            "- [Pause alert](/config/automation/edit/pause_alert)\n"
            "- `automation.typed_in_yaml`"
        ),
    }
    assert state.severity is ir.IssueSeverity.WARNING
    assert state.learn_more_url == RELEASE_NOTES_URL
    assert not state.is_fixable
    plan_button = issues[f"removed_entity_{button}"]
    assert plan_button.translation_key == "removed_entity_plan_button"
    assert plan_button.translation_placeholders == {
        "entity_id": button,
        "items": "- [Evening run](/config/script/edit/evening_run)",
    }


async def test_blueprint_fix_switches_imported_copies_to_run_plan(
    hass: HomeAssistant, tmp_path: Path
) -> None:
    folder = tmp_path / "blueprints/automation/matic"

    def write_home() -> None:
        folder.mkdir(parents=True)
        for name, text in BLUEPRINTS.items():
            (folder / f"{name}.yaml").write_text(text)
        (tmp_path / "automations.yaml").write_text(AUTOMATIONS)
        (tmp_path / "configuration.yaml").write_text(
            "automation: !include automations.yaml\n"
        )

    hass.config.config_dir = str(tmp_path)
    await hass.async_add_executor_job(write_home)
    calls: list[ServiceCall] = []

    async def record(call: ServiceCall) -> None:
        calls.append(call)

    async def run(automation: str) -> tuple[str, dict[str, object]]:
        calls.clear()
        await hass.services.async_call(
            "automation",
            "trigger",
            {"entity_id": f"automation.{automation}"},
            blocking=True,
        )
        await hass.async_block_till_done()
        [call] = calls
        return call.service, dict(call.data)

    for action in ("intelligent_clean", "run_selected_plan"):
        hass.services.async_register(DOMAIN, action, record)
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": await hass.async_add_executor_job(
                load_yaml, tmp_path / "automations.yaml"
            )
        },
    )
    assert await async_setup_component(hass, "repairs", {})
    hass.config.components.add(DOMAIN)  # Repairs asks loaded integrations only.
    assert await run("named_plan") == (
        "intelligent_clean",
        {"entity_id": [VACUUM], "plan": "Main floor"},
    )
    await warn_of_removal(hass, AsyncMock())(
        ServiceCall(hass, DOMAIN, "intelligent_clean", {})
    )

    await async_warn_of_removals(hass)

    issue = _issue(hass, BLUEPRINT_ISSUE_ID)
    assert issue is not None
    assert issue.is_fixable
    assert issue.translation_key == "blueprints_use_removed_action"
    assert issue.translation_placeholders == {
        "blueprints": "Matic: mapping, Matic: template"
    }
    flows = hass.data["repairs"]["flow_manager"]
    form = await flows.async_init(DOMAIN, data={"issue_id": BLUEPRINT_ISSUE_ID})
    assert form["step_id"] == "confirm"
    assert form["description_placeholders"] == issue.translation_placeholders
    assert await run("named_plan") == (
        "intelligent_clean",
        {"entity_id": [VACUUM], "plan": "Main floor"},
    )

    done = await flows.async_configure(form["flow_id"], {})
    await hass.async_block_till_done()

    assert done["type"] is FlowResultType.CREATE_ENTRY
    assert _issue(hass, BLUEPRINT_ISSUE_ID) is None
    assert _issue(hass, "removed_action_intelligent_clean") is None
    smart_order = {"entity_id": [VACUUM], "run_behavior": "intelligent"}
    assert await run("named_plan") == (
        "run_selected_plan",
        {**smart_order, "plan": "Main floor"},
    )
    assert await run("default_plan") == ("run_selected_plan", smart_order)
    assert await run("older_copy") == (
        "run_selected_plan",
        {**smart_order, "plan": "Main floor"},
    )

    def saved(name: str) -> dict[str, object]:
        return load_yaml(folder / f"{name}.yaml")["actions"][0]

    def untouched(name: str) -> bool:
        return (folder / f"{name}.yaml").read_text() == BLUEPRINTS[name]

    rewritten = await hass.async_add_executor_job(saved, "mapping")
    assert rewritten["action"] == "matic_robot.run_selected_plan"
    assert rewritten["data"] == {"plan": Input("plan"), "run_behavior": "intelligent"}
    for name in ("statement", "current", "elsewhere", "broken"):
        assert await hass.async_add_executor_job(untouched, name)
    await async_warn_of_removals(hass)
    assert _issue(hass, BLUEPRINT_ISSUE_ID) is None
