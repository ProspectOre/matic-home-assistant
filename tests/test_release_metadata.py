"""Release metadata and generated-code compatibility checks."""

import ast
import json
import re
import sys
import tomllib
from pathlib import Path

import homeassistant
import yaml

ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "custom_components" / "matic_robot"
REPOSITORY_URL = "https://github.com/ProspectOre/matic-home-assistant"

# Maps each third-party import root used by the integration to the PyPI
# distribution that provides it. Every distribution must be satisfied either by
# the manifest requirements or by Home Assistant core's own constraints.
IMPORT_ROOT_TO_DISTRIBUTION = {
    "PIL": "Pillow",
    "bleak": "bleak",
    "bleak_retry_connector": "bleak-retry-connector",
    "cryptography": "cryptography",
    "dbus_fast": "dbus-fast",
    "google": "protobuf",
    "grpclib": "grpclib",
    "voluptuous": "voluptuous",
    "zeroconf": "zeroconf",
}


def _normalize(name: str) -> str:
    """Return a PEP 503 normalized distribution name."""
    return re.sub(r"[-_.]+", "-", name).casefold()


def _requirement_distribution(requirement: str) -> str:
    """Return the normalized distribution name from a requirement specifier."""
    return _normalize(re.split(r"[<>=!~ ]", requirement, maxsplit=1)[0])


def _third_party_import_roots() -> set[str]:
    """Collect top-level third-party import roots across the integration."""
    roots: set[str] = set()
    for path in INTEGRATION.rglob("*.py"):
        if "proto" in path.parts:
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
    return {
        root
        for root in roots
        if root not in sys.stdlib_module_names
        and root not in {"homeassistant", "custom_components"}
    }


def _home_assistant_provided_distributions() -> set[str]:
    """Return the distributions Home Assistant core pins for its own runtime."""
    constraints = (
        Path(homeassistant.__file__).parent / "package_constraints.txt"
    ).read_text()
    provided: set[str] = set()
    for line in constraints.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        provided.add(_requirement_distribution(line))
    return provided


def test_runtime_third_party_imports_are_declared() -> None:
    """Every third-party import must ship via the manifest or HA core."""
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())
    manifest_distributions = {
        _requirement_distribution(req) for req in manifest["requirements"]
    }
    ha_distributions = _home_assistant_provided_distributions()

    for root in _third_party_import_roots():
        assert root in IMPORT_ROOT_TO_DISTRIBUTION, f"unmapped import root: {root}"
        distribution = _normalize(IMPORT_ROOT_TO_DISTRIBUTION[root])
        assert distribution in manifest_distributions | ha_distributions, root

    assert "protobuf" in manifest_distributions
    assert "grpclib" in manifest_distributions


def test_grpclib_pin_matches_between_pyproject_and_manifest() -> None:
    """Keep the grpclib pin identical in the package and the HA manifest."""
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]

    manifest_grpclib = next(
        req for req in manifest["requirements"] if req.startswith("grpclib")
    )
    project_grpclib = next(
        req for req in project["dependencies"] if req.startswith("grpclib")
    )
    assert manifest_grpclib == project_grpclib == "grpclib==0.4.9"


def test_public_branding_is_explicitly_unofficial() -> None:
    """Keep the HA and HACS names clear about project ownership."""
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())
    hacs = json.loads((ROOT / "hacs.json").read_text())

    assert manifest["name"] == "Matic (Unofficial)"
    assert hacs["name"] == manifest["name"]
    assert manifest["domain"] == "matic_robot"


def test_release_metadata_uses_the_authenticated_repository_owner() -> None:
    """Keep every public link and code-owner identity on the intended account."""
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())
    pyproject = (ROOT / "pyproject.toml").read_text()
    blueprints = ROOT / "blueprints" / "automation" / "matic_robot"
    issue_config = (ROOT / ".github" / "ISSUE_TEMPLATE" / "config.yml").read_text()

    assert manifest["codeowners"] == ["@ProspectOre"]
    assert manifest["documentation"] == REPOSITORY_URL
    assert manifest["issue_tracker"] == f"{REPOSITORY_URL}/issues"
    assert f'Documentation = "{REPOSITORY_URL}#readme"' in pyproject
    assert f'Issues = "{REPOSITORY_URL}/issues"' in pyproject
    assert f'Source = "{REPOSITORY_URL}"' in pyproject
    assert f"{REPOSITORY_URL}/security/advisories/new" in issue_config
    for blueprint in blueprints.glob("*.yaml"):
        assert REPOSITORY_URL in blueprint.read_text()


def test_integration_declares_its_home_assistant_runtime_contract() -> None:
    """Keep Hassfest's config-entry and HTTP dependency requirements explicit."""
    integration = (INTEGRATION / "__init__.py").read_text()
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())

    assert "CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)" in integration
    assert "http" in manifest["dependencies"]


def test_generated_proto_has_no_newer_runtime_guard() -> None:
    """HA must be able to import checked-in gencode on protobuf 6.x."""
    generated = (INTEGRATION / "client" / "proto" / "hermes_pb2.py").read_text()

    assert "runtime_version" not in generated
    assert "ValidateProtobufRuntimeVersion" not in generated


def test_options_flow_titles_do_not_require_description_placeholders() -> None:
    """HA renders step titles without the flow's description placeholders."""
    for filename in ("strings.json", "translations/en.json"):
        translations = json.loads((INTEGRATION / filename).read_text())
        titles = [
            step["title"]
            for step in translations["options"]["step"].values()
            if "title" in step
        ]
        assert all("{" not in title for title in titles)


def test_every_options_flow_field_has_inline_guidance() -> None:
    """Keep the plan studio understandable without outside documentation."""
    for filename in ("strings.json", "translations/en.json"):
        translations = json.loads((INTEGRATION / filename).read_text())
        for step_name, step in translations["options"]["step"].items():
            fields = set(step.get("data", {}))
            if not fields:
                continue

            descriptions = step.get("data_description", {})
            assert set(descriptions) == fields, f"{filename}: {step_name}"
            assert all(
                isinstance(descriptions[field], str) and descriptions[field].strip()
                for field in fields
            ), f"{filename}: {step_name}"


def test_plan_ui_uses_clear_scheduler_language() -> None:
    """Keep room selection direct and the intelligent behavior understandable."""
    forbidden = ("profile", "mission", "section", "round-robin")
    for filename in ("strings.json", "translations/en.json"):
        translations = json.loads((INTEGRATION / filename).read_text())
        rendered = json.dumps(translations["options"]).casefold()
        assert all(term not in rendered for term in forbidden)


def test_plan_editor_is_a_single_room_matrix() -> None:
    """Keep per-room inclusion, mode, and coverage together on one form."""
    for filename in ("strings.json", "translations/en.json"):
        translations = json.loads((INTEGRATION / filename).read_text())
        steps = translations["options"]["step"]
        assert "configure_plan_room" not in steps
        assert "configure_added_room" not in steps
        assert "rooms" not in steps["add_plan"]["data"]
        assert "all settings save together" in steps["add_plan"]["description"]
        assert "Every room starts off" in steps["add_plan"]["description"]
        assert "default to Vacuum and Standard" in steps["add_plan"]["description"]
        assert "run_behavior" in steps["add_plan"]["data"]
        assert "room_editor" in steps["add_plan"]["data"]
        behavior = steps["add_plan"]["data_description"]["run_behavior"]
        room_order = steps["add_plan"]["data_description"]["room_editor"]
        assert "short runs" in behavior
        assert "from top to bottom" in behavior
        assert "exact order for Run all" in room_order


def test_action_metadata_matches_the_room_native_public_api() -> None:
    """Keep Home Assistant action metadata aligned with the supported API."""
    strings = json.loads((INTEGRATION / "strings.json").read_text())
    services = yaml.safe_load((INTEGRATION / "services.yaml").read_text())

    assert set(strings["services"]) == set(services)
    assert {
        "intelligent_clean",
        "clean_entire_plan",
        "run_selected_plan",
        "stop_intelligent_cleaning",
        "save_plan_room",
        "delete_plan_room",
        "move_plan_room",
    } <= set(services)
    assert "count" not in services["intelligent_clean"].get("fields", {})


def test_away_blueprint_starts_and_stops_intelligent_cleaning() -> None:
    """Keep the primary presence workflow safe when someone returns early."""
    blueprint = (
        ROOT / "blueprints/automation/matic_robot/clean_when_away.yaml"
    ).read_text()

    assert "mode: parallel" in blueprint
    assert "id: everyone_left" in blueprint
    assert "id: someone_returned" in blueprint
    assert "action: matic_robot.intelligent_clean" in blueprint
    assert "action: matic_robot.stop_intelligent_cleaning" in blueprint
