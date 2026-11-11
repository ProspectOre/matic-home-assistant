"""The Repair that moves imported Matic blueprints off the action 0.6 removed."""

from pathlib import Path

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from homeassistant.util.yaml import Input, load_yaml

from custom_components.matic_robot.blueprint_update import (
    BLUEPRINT_ISSUE_ID,
    RELEASE_NOTES_URL,
    async_check_blueprints,
)
from custom_components.matic_robot.const import DOMAIN

VACUUM = "vacuum.matic"
SOURCE = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/blueprints/automation/matic_robot"
)
# The two ways released Matic blueprints passed the plan to the removed action.
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


def _issue(hass: HomeAssistant) -> ir.IssueEntry | None:
    return ir.async_get(hass).async_get_issue(DOMAIN, BLUEPRINT_ISSUE_ID)


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

    async def run(automation: str) -> list[dict[str, object]]:
        calls.clear()
        await hass.services.async_call(
            "automation",
            "trigger",
            {"entity_id": f"automation.{automation}"},
            blocking=True,
        )
        await hass.async_block_till_done()
        return [dict(call.data) for call in calls]

    hass.services.async_register(DOMAIN, "run_selected_plan", record)
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
    assert await run("named_plan") == []

    await async_check_blueprints(hass)

    issue = _issue(hass)
    assert issue is not None
    assert issue.is_fixable
    assert issue.severity is ir.IssueSeverity.ERROR
    assert issue.learn_more_url == RELEASE_NOTES_URL
    assert issue.translation_key == "blueprints_use_removed_action"
    assert issue.translation_placeholders == {
        "blueprints": "Matic: mapping, Matic: template"
    }
    flows = hass.data["repairs"]["flow_manager"]
    form = await flows.async_init(DOMAIN, data={"issue_id": BLUEPRINT_ISSUE_ID})
    assert form["step_id"] == "confirm"
    assert form["description_placeholders"] == issue.translation_placeholders
    assert await run("named_plan") == []

    done = await flows.async_configure(form["flow_id"], {})
    await hass.async_block_till_done()

    assert done["type"] is FlowResultType.CREATE_ENTRY
    assert _issue(hass) is None
    smart_order = {"entity_id": [VACUUM], "run_behavior": "intelligent"}
    assert await run("named_plan") == [{**smart_order, "plan": "Main floor"}]
    assert await run("default_plan") == [smart_order]
    assert await run("older_copy") == [{**smart_order, "plan": "Main floor"}]

    def saved(name: str) -> dict[str, object]:
        return load_yaml(folder / f"{name}.yaml")["actions"][0]

    def untouched(name: str) -> bool:
        return (folder / f"{name}.yaml").read_text() == BLUEPRINTS[name]

    rewritten = await hass.async_add_executor_job(saved, "mapping")
    assert rewritten["action"] == "matic_robot.run_selected_plan"
    assert rewritten["data"] == {"plan": Input("plan"), "run_behavior": "intelligent"}
    for name in ("statement", "current", "elsewhere", "broken"):
        assert await hass.async_add_executor_job(untouched, name)
    await async_check_blueprints(hass)
    assert _issue(hass) is None
