"""Action, selector, icon and blueprint copy contract (ha-entities.md section 6)."""

import json
import re
from pathlib import Path

import yaml
from homeassistant.util.yaml import load_yaml

ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "custom_components" / "matic_robot"
BLUEPRINTS = sorted((ROOT / "blueprints/automation/matic_robot").glob("*.yaml"))
STRINGS = json.loads((INTEGRATION / "strings.json").read_text())
SERVICES = yaml.safe_load((INTEGRATION / "services.yaml").read_text())
ADVANCED_ACTIONS = {
    "inspect_hermes_endpoint": "Advanced: Inspect robot data",
    "firmware_snapshot": "Advanced: Record firmware snapshot",
    "firmware_investigator": "Advanced: Choose firmware investigator",
    "firmware_notification": "Advanced: Update firmware notification",
}
DENYLIST = re.compile(
    r"\b(mission|leg|generation|profile|section|round-robin|session|managed|"
    r"identity|authoritative|cadence|interval|qualifying|endpoint|payload|"
    r"fingerprint|sha-256|wire-shape|hermes|token|ledger|epoch|stable id|"
    r"native|oem|coherence|reconciliation|runner lock|handoff|recheck|"
    r"credential|bond|local access|pinned|certificate|tls|workspace|"
    r"map studio|routine|cleaning system|intent)(s|es)?\b|\bverif\w*",
    re.IGNORECASE,
)


def test_action_names_follow_the_glossary() -> None:
    names = {key: service["name"] for key, service in STRINGS["services"].items()}
    assert {key: names[key] for key in ADVANCED_ACTIONS} == ADVANCED_ACTIONS
    assert names["run_selected_plan"] == "Run plan"
    assert names["intelligent_clean"] == "Run intelligent rotation"
    assert names["clean_entire_plan"] == "Run saved order"
    assert names["stop_intelligent_cleaning"] == "Stop cleaning"
    assert names["reset_plan_history"] == "Reset room cleaning history"
    ordinary = set(names) - set(ADVANCED_ACTIONS)
    assert not any(names[key].startswith("Advanced:") for key in ordinary)


def test_everyday_action_copy_avoids_internal_terms() -> None:
    for key, service in STRINGS["services"].items():
        if key in ADVANCED_ACTIONS:
            continue
        texts = [service["name"], service["description"]]
        for field in service.get("fields", {}).values():
            texts += [field["name"], field["description"]]
        for text in texts:
            assert DENYLIST.search(text) is None, (key, text)
            assert not re.search(r"\b[a-z]+_[a-z_]+\b", text), (key, text)


def test_id_fields_are_advanced_and_plan_fields_hint_the_default() -> None:
    for key, field in (
        ("run_selected_plan", "preview_token"),
        ("stop_intelligent_cleaning", "expected_run_id"),
        ("save_plan", "plan_id"),
        ("save_plan", "start_timeout"),
        ("save_plan", "completion_timeout"),
        ("firmware_notification", "revision"),
    ):
        assert SERVICES[key]["fields"][field]["advanced"] is True
    plan_fields = [
        (key, service["fields"]["plan"])
        for key, service in SERVICES.items()
        if "plan" in (service or {}).get("fields", {})
    ]
    assert len(plan_fields) == 11
    for key, field in plan_fields:
        assert field["example"] == "Main floor"
        description = STRINGS["services"][key]["fields"]["plan"]["description"]
        assert description.startswith("Plan name or ID.")
        assert description.endswith("Find IDs with List cleaning plans.")
        assert ("Leave empty" in description) is not field.get("required", False)


def test_room_objects_declare_their_fields() -> None:
    for key, field in (
        ("clean_room_sequence", "rooms"),
        ("preview_room_sequence", "rooms"),
        ("save_plan", "rooms"),
        ("save_plan_room", "room"),
    ):
        selector = SERVICES[key]["fields"][field]["selector"]["object"]
        assert list(selector["fields"]) == ["room", "cleaning_mode", "coverage_setting"]
        assert selector.get("multiple", False) is (field == "rooms")
        assert selector["translation_key"] == "plan_room"
    assert set(STRINGS["selector"]["plan_room"]["fields"]) == {
        "room",
        "cleaning_mode",
        "coverage_setting",
    }


def _selects() -> list[dict]:
    found = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            selector = node.get("selector")
            if isinstance(selector, dict) and isinstance(selector.get("select"), dict):
                found.append(selector["select"])
            for value in node.values():
                walk(value)

    walk(SERVICES)
    return found


def test_every_pick_list_is_translated() -> None:
    selects = _selects()
    assert selects
    for select in selects:
        labels = STRINGS["selector"][select["translation_key"]]["options"]
        assert set(select["options"]) == set(labels)
    items = STRINGS["selector"]["robot_data_item"]["options"]
    assert len(items) == 40
    for label in items.values():
        assert len(label.split()) <= 5
        assert "_" not in label


def test_every_action_has_an_icon() -> None:
    icons = json.loads((INTEGRATION / "icons.json").read_text())["services"]
    assert set(icons) == set(SERVICES)
    assert {icons[key]["service"] for key in ADVANCED_ACTIONS} == {"mdi:wrench-outline"}


def test_blueprints_are_named_and_every_input_is_described() -> None:
    names = set()
    inputs = 0
    for path in BLUEPRINTS:
        blueprint = load_yaml(path)["blueprint"]
        names.add(blueprint["name"])
        assert DENYLIST.search(blueprint["description"]) is None
        for key, item in blueprint["input"].items():
            inputs += 1
            assert item["description"].strip(), (path.name, key)
        if "plan" in blueprint["input"]:
            assert blueprint["input"]["plan"]["name"] == "Plan"
            assert blueprint["input"]["plan"]["default"] == ""
        if "vacuum" in blueprint["input"]:
            assert blueprint["input"]["vacuum"]["name"] == "Robot"
    assert names == {
        "Matic: Clean when everyone leaves",
        "Matic: Clean during quiet hours",
        "Matic: Clean after pets leave",
        "Matic: Clean on a schedule",
        "Matic: Send firmware alerts",
    }
    # The firmware blueprint derives the robot from its sensor, so 19 remain.
    assert inputs == 19
