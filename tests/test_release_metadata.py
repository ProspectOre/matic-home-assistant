"""Release metadata and generated-code compatibility checks."""

import ast
import json
import re
import struct
import sys
import tomllib
from collections.abc import Callable, Iterator
from pathlib import Path

import homeassistant
import pytest
import yaml

from tests.frontend_sources import common_strings, key_sites

ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "custom_components" / "matic_robot"
REPOSITORY_URL = "https://github.com/ProspectOre/matic-home-assistant"
QUALITY_SCALE_RULES = {
    "action-setup",
    "appropriate-polling",
    "config-flow-test-coverage",
    "config-flow",
    "dependency-transparency",
    "docs-actions",
    "docs-conditions",
    "docs-high-level-description",
    "docs-installation-instructions",
    "docs-removal-instructions",
    "docs-triggers",
    "entity-unique-id",
    "has-entity-name",
    "runtime-data",
    "test-before-configure",
    "test-before-setup",
    "unique-config-entry",
    "action-exceptions",
    "config-entry-unloading",
    "docs-configuration-parameters",
    "docs-installation-parameters",
    "entity-unavailable",
    "integration-owner",
    "parallel-updates",
    "reauthentication-flow",
    "test-coverage",
    "devices",
    "diagnostics",
    "discovery",
    "docs-data-update",
    "docs-examples",
    "docs-known-limitations",
    "docs-supported-devices",
    "docs-supported-functions",
    "docs-troubleshooting",
    "docs-use-cases",
    "entity-category",
    "entity-device-class",
    "entity-disabled-by-default",
    "entity-translations",
    "exception-translations",
    "icon-translations",
    "reconfiguration-flow",
    "repair-issues",
    "stale-devices",
    "async-dependency",
    "inject-websession",
    "strict-typing",
}

# Maps each third-party import root used by the integration to the PyPI
# distribution that provides it. Every distribution must be satisfied either by
# the manifest requirements or by Home Assistant core's own constraints.
IMPORT_ROOT_TO_DISTRIBUTION = {
    "PIL": "Pillow",
    "aiohttp": "aiohttp",
    "bleak": "bleak",
    "bleak_retry_connector": "bleak-retry-connector",
    "cryptography": "cryptography",
    "dbus_fast": "dbus-fast",
    "google": "protobuf",
    "grpclib": "grpclib",
    "h2": "h2",
    "numpy": "numpy",
    "probatio": "probatio",
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


def test_local_brand_assets_match_home_assistant_sizes() -> None:
    """Keep local brand icons ready for HA and HACS presentation."""
    brand = INTEGRATION / "brand"

    def png_dimensions(path: Path) -> tuple[int, int]:
        content = path.read_bytes()
        assert content[:8] == b"\x89PNG\r\n\x1a\n"
        return struct.unpack(">II", content[16:24])

    assert png_dimensions(brand / "icon.png") == (256, 256)
    assert png_dimensions(brand / "icon@2x.png") == (512, 512)
    assert "<svg" in (brand / "logo.svg").read_text()


def test_quality_scale_file_is_an_unscored_self_audit() -> None:
    """Track reviewed rules without claiming an official HA quality tier."""
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())
    audit_text = (INTEGRATION / "quality_scale.yaml").read_text()
    audit = yaml.safe_load(audit_text)

    assert "quality_scale" not in manifest
    assert "has not been reviewed or scored by Home Assistant" in audit_text
    assert set(audit) == {"rules"}
    assert set(audit["rules"]) == QUALITY_SCALE_RULES
    for rule, result in audit["rules"].items():
        if result == "done":
            continue
        assert result["status"] == "exempt", rule
        assert result["comment"].strip(), rule


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
    """Keep Hassfest's config-entry and runtime dependencies explicit."""
    integration = (INTEGRATION / "__init__.py").read_text()
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())

    assert "CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)" in integration
    assert "bluetooth_adapters" in manifest["dependencies"]
    assert "http" in manifest["dependencies"]
    assert "zeroconf" in manifest["dependencies"]
    assert not any(
        requirement.startswith("cryptography")
        for requirement in manifest["requirements"]
    )


def test_generated_proto_has_no_newer_runtime_guard() -> None:
    """HA must be able to import checked-in gencode on protobuf 6.x."""
    generated = (INTEGRATION / "client" / "proto" / "hermes_pb2.py").read_text()

    assert "runtime_version" not in generated
    assert "ValidateProtobufRuntimeVersion" not in generated


def test_options_flow_titles_use_only_placeholders_the_step_supplies() -> None:
    """Only the named reset confirmation carries its plan in the title."""
    for filename in ("strings.json", "translations/en.json"):
        translations = json.loads((INTEGRATION / filename).read_text())
        titled = {
            step_name: step["title"]
            for step_name, step in translations["options"]["step"].items()
            if "{" in step.get("title", "")
        }
        assert titled == {"confirm_reset_history": "Reset history for {plan_name}?"}


def test_every_options_flow_field_has_inline_guidance() -> None:
    """Keep native maintenance forms understandable without outside documentation."""
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


# docs/copy-style-0.5.md denylist table, verbatim
_DENYLIST = tuple(
    "mission|leg|dock visit|generation|profile|section|round-robin|session|managed"
    "|managed run|identity|authoritative|cadence|interval|qualifying|schedule scope"
    "|endpoint|payload|fingerprint|SHA-256|wire-shape|Hermes|token|revision|ledger"
    "|epoch|goal ID|stable ID|native|OEM|coherence|reconciliation|runner lock"
    "|opportunity|handoff|recheck|scene|credential|bond|local access|pinned"
    "|certificate|TLS|workspace|Map Studio|routine|cleaning system|intent".split("|")
)
_DENIED = re.compile(
    r"\b(?:" + "|".join(map(re.escape, _DENYLIST)) + r")(?:s|es)?\b|\bverif\w*",
    re.IGNORECASE,
)
_TEMPLATE = re.compile(r"\{\{.*?\}\}|\{%.*?%\}|\{[a-z0-9_]+\}", re.DOTALL)
Copy = Iterator[tuple[str, str]]


def _texts(node: object, path: str) -> Copy:
    if isinstance(node, dict):
        for key, value in node.items():
            yield from _texts(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _texts(value, f"{path}.{index}")
    elif isinstance(node, str):
        yield path, node


def _common(*modules: str) -> Copy:
    common = common_strings()
    # No modules: every stored key (test_every_common_key_is_referenced keeps
    # each one referenced).
    keys = (
        {s.key for s in key_sites() if s.module in modules} if modules else set(common)
    )
    for key in sorted(keys & set(common)):
        yield f"common.{key}", common[key]


def _strings() -> dict:
    return json.loads((INTEGRATION / "strings.json").read_text())


def _advanced() -> set[str]:
    return {
        key
        for key, value in _strings()["services"].items()
        if value.get("name", "").startswith("Advanced: ")
    }


def _services() -> Copy:
    for key, value in _strings()["services"].items():
        if key not in _advanced():
            yield from _texts(value, f"services.{key}")


def _services_yaml() -> Copy:
    data = yaml.safe_load((INTEGRATION / "services.yaml").read_text())
    for key, value in data.items():
        if key not in _advanced():
            yield from _texts(value, f"services.yaml.{key}")


class _BlueprintLoader(yaml.SafeLoader): ...


_BlueprintLoader.add_constructor(
    "!input", lambda loader, node: loader.construct_scalar(node)
)


def _blueprints() -> Copy:
    for path in sorted((ROOT / "blueprints").rglob("*.yaml")):
        data = yaml.load(path.read_text(), Loader=_BlueprintLoader)
        meta = data["blueprint"]
        yield f"{path.name}:name", meta["name"]
        yield f"{path.name}:description", meta["description"]
        for key, spec in meta["input"].items():
            for field in ("name", "description"):
                if field in spec:
                    yield f"{path.name}:input.{key}.{field}", spec[field]
        for found_path, text in _texts(data, path.name):
            if found_path.rsplit(".", 1)[-1] in {"title", "message"}:
                yield found_path, text


_LLM_COPY = {
    "LLM_API_NAME",
    "FIRMWARE_LLM_API_NAME",
    "PLAIN_WORDS_PROMPT",
    "NON_ADMIN_PROMPT",
    "ROBOT_STATUS_PROMPT",
    "FIRMWARE_RESEARCH_PROMPT",
    "_ERRORS",
    "description",
}


def _llm() -> Copy:
    tree = ast.parse((INTEGRATION / "llm.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            getattr(t, "id", "") in _LLM_COPY for t in node.targets
        ):
            for part in ast.walk(node.value):
                if isinstance(part, ast.Constant) and isinstance(part.value, str):
                    yield f"llm:{part.lineno}", part.value
        elif (
            isinstance(node, ast.Call)
            and getattr(node.func, "id", "") == "HomeAssistantError"
        ):
            for arg in node.args:
                for part in ast.walk(arg):
                    if isinstance(part, ast.Constant) and isinstance(part.value, str):
                        yield f"llm:{part.lineno}", part.value


_COPY_SURFACES: dict[str, Callable[[], Copy]] = {
    "strings:common": _common,
    "strings:config": lambda: _texts(_strings()["config"], "config"),
    "strings:options": lambda: _texts(_strings()["options"], "options"),
    "strings:issues": lambda: _texts(_strings()["issues"], "issues"),
    "strings:entity": lambda: _texts(_strings()["entity"], "entity"),
    "strings:selector": lambda: _texts(_strings()["selector"], "selector"),
    "strings:device": lambda: _texts(_strings()["device"], "device"),
    "strings:device_automation": lambda: _texts(
        _strings()["device_automation"], "device_automation"
    ),
    "strings:exceptions": lambda: _texts(_strings()["exceptions"], "exceptions"),
    "strings:services": _services,
    "services.yaml": _services_yaml,
    "blueprints": _blueprints,
    "llm": _llm,
}


@pytest.mark.parametrize("surface", sorted(_COPY_SURFACES))
def test_plan_ui_uses_clear_scheduler_language(surface: str) -> None:
    """User-facing copy avoids the docs/copy-style-0.5.md denylist."""
    hits = {
        path: _DENIED.findall(_TEMPLATE.sub("", text))
        for path, text in _COPY_SURFACES[surface]()
    }
    assert {path: found for path, found in hits.items() if found} == {}


def test_every_copy_surface_is_scanned() -> None:
    expected = {f"strings:{category}" for category in _strings()} | {
        "services.yaml",
        "blueprints",
        "llm",
    }
    assert set(_COPY_SURFACES) == expected


def test_blueprint_scanner_reads_every_blueprint() -> None:
    texts = list(_blueprints())
    files = {
        "clean_when_away.yaml",
        "firmware_intelligence.yaml",
        "pet_aware.yaml",
        "quiet_hours.yaml",
        "room_rotation.yaml",
    }
    for name in files:
        assert sum(path.startswith(f"{name}:") for path, _ in texts) >= 3, name
    assert {path.split(":")[0] for path, _ in texts if ":" in path} == files
    for blueprint in (ROOT / "blueprints").rglob("*.yaml"):
        meta = yaml.load(blueprint.read_text(), Loader=_BlueprintLoader)["blueprint"]
        missing = [
            key for key, spec in meta["input"].items() if "description" not in spec
        ]
        assert missing == [], f"{blueprint.name}: {missing}"


def _raised_keys() -> Iterator[tuple[str, int, str, frozenset[str] | None]]:
    """Literal exception keys at every *Error(...) / _validation_error(...) call."""
    for path in sorted(INTEGRATION.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            name = getattr(node, "func", None) and (
                getattr(node.func, "id", None) or getattr(node.func, "attr", "")
            )
            if not isinstance(node, ast.Call) or not (
                name.endswith("Error")
                or name in {"_validation_error", "_error", "_async_refusal"}
            ):
                continue
            words = {k.arg: k.value for k in node.keywords}
            if (
                name == "_async_refusal"
                and len(node.args) >= 4
                and getattr(node.args[2], "value", None) == "exceptions"
                and isinstance(node.args[3], ast.Constant)
            ):
                # llm.py: a refusal the model relays in the exception's words
                holders = node.args[4] if len(node.args) > 4 else None
                yield (
                    path.name,
                    node.lineno,
                    node.args[3].value,
                    frozenset(k.value for k in holders.keys)
                    if isinstance(holders, ast.Dict)
                    else frozenset(),
                )
                continue
            if name == "_error" and node.args:
                # llm.py: _error("llm_*", **placeholders)
                yield (
                    path.name,
                    node.lineno,
                    node.args[0].value,
                    frozenset(k.arg for k in node.keywords),
                )
                continue
            if name == "_validation_error" and len(node.args) >= 2:
                key, holders = (
                    node.args[1],
                    node.args[2] if len(node.args) > 2 else words.get("placeholders"),
                )
            else:
                key, holders = (
                    words.get("translation_key"),
                    words.get("translation_placeholders"),
                )
            # Dynamic keys (err.reason_code) are covered by their enum test.
            if not (isinstance(key, ast.Constant) and isinstance(key.value, str)):
                continue
            supplied = (
                frozenset(k.value for k in holders.keys if isinstance(k, ast.Constant))
                if isinstance(holders, ast.Dict)
                else frozenset()
                if holders is None
                else None
            )
            yield path.name, node.lineno, key.value, supplied


def test_every_raised_exception_key_exists_with_its_placeholders() -> None:
    exceptions = _strings()["exceptions"]
    for file, line, key, supplied in _raised_keys():
        assert key in exceptions, f"{file}:{line} {key}"
        needed = frozenset(re.findall(r"\{([a-z_]+)\}", exceptions[key]["message"]))
        assert supplied is None or needed <= supplied, (
            f"{file}:{line} {key} lacks {sorted(needed - supplied)}"
        )


def test_every_exception_key_is_raised() -> None:
    from custom_components.matic_robot.client.exceptions import CoverageGuardReason

    raised = {key for _file, _line, key, _supplied in _raised_keys()}
    raised |= {reason.value for reason in CoverageGuardReason}
    assert set(_strings()["exceptions"]) - raised == set()


def test_coverage_guard_text_matches_everywhere() -> None:
    from custom_components.matic_robot.client.exceptions import _COVERAGE_GUARD_MESSAGES

    catalog = (ROOT / "frontend/map-studio-v4/catalog-writes.ts").read_text()
    for reason, text in _COVERAGE_GUARD_MESSAGES.items():
        assert _strings()["exceptions"][reason.value]["message"] == text
        assert re.search(
            rf'{reason.value}: \["v4_notice_coverage_\w+", '
            rf'"{re.escape(text)}"\]',
            catalog,
        )


def test_advanced_actions_are_exactly_the_four_named() -> None:
    assert _advanced() == {
        "inspect_hermes_endpoint",
        "firmware_snapshot",
        "firmware_investigator",
        "firmware_notification",
    }


_HOUSEHOLD_DOCS = (
    "README.md",
    "docs/README.md",
    "docs/actions.md",
    "docs/automation.md",
    "docs/cleaning.md",
    "docs/entities.md",
    "docs/features.md",
    "docs/room-schedules.md",
)
# Code, link targets and HTML anchors name things; the prose around them is copy.
_NOT_PROSE = re.compile(r"```.*?```|`[^`]*`|\]\([^)]*\)|<[^>]+>", re.DOTALL)


@pytest.mark.parametrize("doc", _HOUSEHOLD_DOCS)
def test_household_docs_use_the_copy_style(doc: str) -> None:
    """Docs a household reads avoid the denylist and the retired editors.

    "Configure" is Home Assistant's own button and may be named; the retired
    Configure flow and editors may not.
    """
    prose = _NOT_PROSE.sub("", (ROOT / doc).read_text())
    assert _DENIED.findall(prose) == []
    assert not re.search(r"Configure (?:flow|editor)|0\.5 development|→", prose)


def test_denylist_scanner_matches_plurals_and_verify_family() -> None:
    assert _DENIED.findall("Missions, verified tokens; Map Studio") == [
        "Missions",
        "verified",
        "tokens",
        "Map Studio",
    ]
    harmless = _TEMPLATE.sub("", "legend sessionless preview_token {interval}")
    assert _DENIED.findall(harmless) == []
    assert _TEMPLATE.sub("", "Every {interval}{{ x.revision }}{% if a %}") == "Every "


def test_options_flow_directs_editing_to_the_single_map_workspace() -> None:
    """Native settings must not advertise a competing plan or Area editor."""
    for filename in ("strings.json", "translations/en.json"):
        translations = json.loads((INTEGRATION / filename).read_text())
        steps = translations["options"]["step"]
        assert set(steps) == {
            "init",
            "default_plan",
            "reset_history",
            "confirm_reset_history",
            "confirm_reset_all_history",
            "advanced",
            "workspace_transport",
        }
        assert "[Matic Map](/matic-map)" in steps["init"]["description"]
        assert "actions that do not name a plan" in steps["default_plan"]["description"]
        assert "{plan_name}" in steps["confirm_reset_history"]["description"]
        for step in ("confirm_reset_history", "confirm_reset_all_history"):
            assert "plans and settings are kept" in steps[step]["description"]
            assert steps[step]["submit"] == "Reset"


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


def test_user_copy_matches_pairing_and_plan_behavior() -> None:
    """Keep recovery steps and plan actions accurate in every English source."""
    for filename in ("strings.json", "translations/en.json"):
        translations = json.loads((INTEGRATION / filename).read_text())
        errors = translations["config"]["error"]
        for key in ("pairing_code_expired", "pairing_code_rejected"):
            recovery = errors[key].casefold()
            assert "turn pairing mode off and back on" in recovery
            assert "enter the new code" in recovery

        pair_step = translations["config"]["step"]["pair"]
        pairing = pair_step["description"]
        assert "Pairing mode is a short window in the Matic app" in pairing
        assert "2. Turn on Pairing mode." in pairing
        assert "3. Come back here and choose Start pairing." in pairing
        assert pair_step["submit"] == "Start pairing"
        # The only field is the manual pairing import checkbox; the
        # confirmation itself stays submit-only.
        assert set(pair_step["data"]) == {"import_credential"}
        assert "pairing_mode_off" not in errors
        assert "pairing_mode_confirmation_required" not in errors

        options = translations["options"]
        assert "Choosing a default plan" in options["step"]["init"]["description"]
        assert "data" not in options["step"]["confirm_reset_history"]

        entities = translations["entity"]["binary_sensor"]
        assert entities["diagnostic_upload"]["name"] == "Diagnostic upload"
        assert entities["ssh_tunnel_permission"]["name"] == (
            "Support tunnel permission"
        )
        assert entities["paused"]["state"] == {
            "off": "Not paused",
            "on": "Paused",
        }
        assert not {"update_available", "active_cleaning_session"} & set(entities)
        assert translations["entity"]["number"]["water_flow"]["name"] == (
            "Mopping water flow"
        )
        assert translations["entity"]["sensor"]["cleaning_history"]["name"] == (
            "Rooms cleaned by plans"
        )
        assert {
            key: value["name"]
            for key, value in translations["entity"]["button"].items()
        } == {
            "run_selected_plan": "Run plan",
            "intelligent_clean": "Run intelligent rotation",
            "clean_entire_plan": "Run saved order",
            "stop_intelligent_cleaning": "Stop cleaning",
            "clean_selected_area": "Clean custom area",
        }
        selects = translations["entity"]["select"]
        assert selects["cleaning_mode"]["name"] == "Default cleaning mode"
        assert selects["coverage_setting"]["name"] == "Default vacuum coverage"
        assert selects["saved_cleaning_plan"]["name"] == "Default cleaning plan"
        assert selects["custom_cleaning_area"]["name"] == "Custom cleaning area"
        assert translations["selector"]["coverage_setting"]["options"] == {
            "heavy_duty": "Heavy duty",
            "quick": "Quick",
            "standard": "Optimal",
        }
        assert selects["coverage_setting"]["state"] == {
            "heavy_duty": "Heavy duty",
            "quick": "Quick",
            "standard": "Optimal",
        }
        assert (
            translations["entity"]["button"]["clean_selected_area"]["name"]
            == "Clean custom area"
        )

        services = translations["services"]
        intelligent = services["intelligent_clean"]["description"]
        assert "starting with the ones that have waited longest" in intelligent
        assert "keeps going until you stop it or every room is done" in intelligent
        assert "started but not finished stay due" in intelligent
        assert "top to bottom" in services["clean_entire_plan"]["description"]
        assert "the way it is saved" in services["run_selected_plan"]["description"]
        assert (
            "after all selected rooms finish."
            in services["save_plan"]["fields"]["return_to_base"]["description"]
        )
        clean_fields = services["clean"]["fields"]
        assert "Omit this field" in clean_fields["rooms"]["description"]
        assert "Omit it" in clean_fields["cleaning_mode"]["description"]
        assert "Omit it" in clean_fields["coverage_setting"]["description"]
        assert {
            key: services[key]["name"]
            for key in (
                "run_selected_plan",
                "intelligent_clean",
                "clean_entire_plan",
                "stop_intelligent_cleaning",
                "reset_plan_history",
                "inspect_hermes_endpoint",
                "firmware_snapshot",
                "firmware_investigator",
                "firmware_notification",
            )
        } == {
            "run_selected_plan": "Run plan",
            "intelligent_clean": "Run intelligent rotation",
            "clean_entire_plan": "Run saved order",
            "stop_intelligent_cleaning": "Stop cleaning",
            "reset_plan_history": "Reset room cleaning history",
            "inspect_hermes_endpoint": "Advanced: Inspect robot data",
            "firmware_snapshot": "Advanced: Record firmware snapshot",
            "firmware_investigator": "Advanced: Choose firmware investigator",
            "firmware_notification": "Advanced: Update firmware notification",
        }
        assert services["save_plan"]["fields"]["run_behavior"]["description"].endswith(
            "Saved order cleans every selected room from top to bottom."
        )
        assert services["firmware_investigator"]["description"] == (
            "Home Assistant assigns the connected agent that researches firmware "
            "reports, and robot controls are unchanged. Switching agents ends any "
            "research already claimed and keeps the evidence, and only "
            "administrators can call this action."
        )
        assert services["firmware_notification"]["description"] == (
            "Home Assistant records that the current firmware report was "
            "acknowledged or that its notification was delivered, or asks for "
            "another read-only check. The firmware alerts blueprint uses it."
        )
        exceptions = translations["exceptions"]
        for alias in ("start", "clean_segments", "dock"):
            assert alias in exceptions["unsupported_command"]["message"]
        assert exceptions["single_robot_required"]["message"] == (
            "Select exactly one robot."
        )
        assert "room map" in exceptions["room_plan_unavailable"]["message"]
        assert "reported an error" in exceptions["robot_error"]["message"]
        inspection = services["inspect_hermes_endpoint"]
        assert "never stored or shown" in inspection["description"]
        assert set(inspection["fields"]) == {"endpoint", "limit"}
        firmware_snapshot = services["firmware_snapshot"]["description"]
        assert "saves a record without the data itself" in firmware_snapshot
        assert (
            "check the Firmware check status sensor"
            in translations["issues"]["firmware_regression"]["description"]
        )


def test_readme_states_the_actual_runtime_and_validation_scope() -> None:
    """Do not imply unsupported runtimes or universal live-device validation."""
    readme = (ROOT / "README.md").read_text()
    compatibility = (ROOT / "docs" / "acceptance-0.4.md").read_text()
    minimum = json.loads((ROOT / "hacs.json").read_text())["homeassistant"]
    supported_version = ".".join(minimum.split(".")[:2])

    assert f"Home Assistant {supported_version}+" in readme
    assert "docs/acceptance-0.4.md" in readme
    assert "Live use has covered 2026.7 and 2026.8" in compatibility
    assert "Each exposed command is tested against a real robot" not in readme


def test_documented_entity_surface_matches_release_contract() -> None:
    """Keep the linked entity reference aligned with the release contract."""
    readme = " ".join((ROOT / "README.md").read_text().split())
    automation = " ".join((ROOT / "docs" / "automation.md").read_text().split())
    entities = " ".join((ROOT / "docs" / "entities.md").read_text().split())
    surface = (
        "51 fixed entities — 21 sensors, 11 binary sensors, 5 buttons, "
        "4 switches, 4 selects, 1 number, 2 cameras, 1 event, 1 update, and "
        "1 vacuum"
    )

    assert "docs/entities.md" in readme
    assert "entities.md" in automation
    assert surface in entities
    assert "two opt-in statistics sensors per mapped room" in entities
    assert "photographic SLAM camera is disabled by default" in entities


def test_away_blueprint_starts_and_stops_intelligent_cleaning() -> None:
    """Keep the primary presence workflow safe around active cleanings."""
    blueprint = (
        ROOT / "blueprints/automation/matic_robot/clean_when_away.yaml"
    ).read_text()

    assert "mode: parallel" in blueprint
    assert "id: everyone_left" in blueprint
    assert "id: someone_returned" in blueprint
    assert "vacuum_entity: !input vacuum" in blueprint
    assert "states(vacuum_entity) in ('docked', 'idle')" in blueprint
    assert "action: matic_robot.intelligent_clean" in blueprint
    assert "action: matic_robot.stop_intelligent_cleaning" in blueprint
