"""Packaging and custom-integration release checks."""

import json
import re
import tomllib
from pathlib import Path

from homeassistant.components.automation.config import AUTOMATION_BLUEPRINT_SCHEMA
from homeassistant.components.blueprint.models import Blueprint
from homeassistant.util.yaml import load_yaml

from custom_components.matic_robot.client.endpoints import HERMES_ENDPOINT_NAMES

ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "custom_components" / "matic_robot"
ACTION_USE = re.compile(
    r"^\s*(?:-\s*)?uses:\s+(?P<action>[^@\s]+)@(?P<ref>\S+)"
    r"(?:\s+#\s+(?P<comment>.+))?$",
    re.MULTILINE,
)
COMMIT_SHA = re.compile(r"[0-9a-f]{40}")
SEMANTIC_ACTION_REF = re.compile(r"(?:main|master|v\d+(?:\.\d+)*)")


def test_release_versions_and_links_are_consistent() -> None:
    """Keep install metadata aligned for HACS and GitHub releases."""
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())
    hacs = json.loads((ROOT / "hacs.json").read_text())
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]

    assert manifest["version"] == "0.2.2"
    assert project["version"] == manifest["version"]
    assert hacs["homeassistant"] == "2026.7.0"
    assert manifest["documentation"].startswith("https://github.com/")
    assert manifest["issue_tracker"].endswith("/issues")
    assert manifest["codeowners"]
    assert manifest["dependencies"] == ["bluetooth_adapters", "http", "zeroconf"]
    assert manifest["after_dependencies"] == ["frontend", "recorder"]


def test_github_validation_runs_hacs_and_hassfest() -> None:
    """Keep both official repository validators wired into CI."""
    workflow = (ROOT / ".github" / "workflows" / "validate.yml").read_text()

    assert "hacs/action@1ebf01c408f29afcb6406bd431bc98fd8cbb15aa # main" in workflow
    assert (
        "home-assistant/actions/hassfest@"
        "f4ca6f671bd429efb108c0f2fa0ae8af0215986c # master" in workflow
    )


def test_github_actions_use_immutable_refs_with_semantic_comments() -> None:
    """Pin external actions while documenting the corresponding upstream ref."""
    for path in (ROOT / ".github" / "workflows").glob("*.yml"):
        uses = list(ACTION_USE.finditer(path.read_text()))
        assert uses, f"{path} has no actions"

        for use in uses:
            action = use.group("action")
            if action.startswith("./"):
                continue

            ref = use.group("ref")
            comment = use.group("comment")
            assert COMMIT_SHA.fullmatch(ref), f"{action}@{ref} is not immutable"
            assert comment is not None, f"{action}@{ref} has no semantic ref comment"
            assert SEMANTIC_ACTION_REF.fullmatch(comment), (
                f"{action}@{ref} has an invalid semantic ref comment: {comment}"
            )


def test_source_and_runtime_translations_stay_in_sync() -> None:
    """Ship runtime translations while retaining canonical Hassfest source."""
    strings = json.loads((INTEGRATION / "strings.json").read_text())
    translation = json.loads((INTEGRATION / "translations" / "en.json").read_text())

    assert translation == strings
    assert (INTEGRATION / "icons.json").exists()
    assert (INTEGRATION / "services.yaml").exists()
    assert not (INTEGRATION / "www").exists()
    assert (INTEGRATION / "room_plan_editor.js").exists()


def test_python_package_includes_home_assistant_runtime_files() -> None:
    """Keep non-Python integration files in wheel and sdist builds."""
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())
    package_data = set(
        config["tool"]["setuptools"]["package-data"]["custom_components.matic_robot"]
    )

    assert "manifest.json" in package_data
    assert "brand/*.png" in package_data
    assert "translations/*.json" in package_data
    assert "client/matic_intermediate_ca.pem" in package_data
    assert "client/proto/*.proto" in package_data
    assert "www/*.js" not in package_data
    assert "*.js" in package_data
    assert (INTEGRATION / "manifest.json").exists()
    assert (INTEGRATION / "client" / "matic_intermediate_ca.pem").exists()


def test_ci_inspects_finished_release_archives() -> None:
    """Run artifact inspection only after the wheel and sdist are built."""
    workflow = (ROOT / ".github" / "workflows" / "test.yml").read_text()
    build = "python -m build --sdist --wheel"
    inspect = "python scripts/check_release_artifacts.py dist"
    fresh_install = "python scripts/check_fresh_install.py dist"

    assert build in workflow
    assert inspect in workflow
    assert fresh_install in workflow
    assert (
        workflow.index(build) < workflow.index(inspect) < workflow.index(fresh_install)
    )


def test_integration_ships_local_brand_icons() -> None:
    """Serve brand icons locally per Home Assistant 2026.3 brand support."""
    brand = INTEGRATION / "brand"
    assert (brand / "icon.png").exists()
    assert (brand / "icon@2x.png").exists()


def test_recording_boundary_has_no_runtime_surface() -> None:
    """Keep externally consequential recording features out of the public surface."""
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())
    strings = json.loads((INTEGRATION / "strings.json").read_text())
    services = load_yaml(INTEGRATION / "services.yaml")
    endpoint_options = services["inspect_hermes_endpoint"]["fields"]["endpoint"][
        "selector"
    ]["select"]["options"]
    entity_keys = {key for platform in strings["entity"].values() for key in platform}
    recording_entity_keys = {
        "audio_recording_mode",
        "confirm_each_recording",
        "recording_thumbnails",
        "recording_videos",
        "rolling_recording",
        "save_rolling_buffer",
        "start_recording",
        "stop_recording",
        "voice_auto_recording",
    }
    recording_collections = {
        "auto_record_voice_enabled_state",
        "recording_thumbnails",
        "recording_videos",
        "rolling_recordings_config_state",
        "scratch_recordings",
        "user_audio_recording_state",
    }

    assert manifest["dependencies"] == ["bluetooth_adapters", "http", "zeroconf"]
    assert not (INTEGRATION / "media_source.py").exists()
    assert "review_recording" not in services
    assert "review_recording" not in strings["services"]
    assert entity_keys.isdisjoint(recording_entity_keys)
    assert tuple(endpoint_options) == HERMES_ENDPOINT_NAMES
    assert recording_collections.isdisjoint(HERMES_ENDPOINT_NAMES)
    assert recording_collections.isdisjoint(json.dumps(services).split('"'))

    handwritten_runtime = "\n".join(
        (INTEGRATION / path).read_text()
        for path in (
            "binary_sensor.py",
            "button.py",
            "client/api.py",
            "client/commands.py",
            "client/models.py",
            "select.py",
            "sensor.py",
            "services.py",
            "switch.py",
        )
    )
    for symbol in (
        "RecordingConfirmationAction",
        "RecordingMetadata",
        "auto_record_voice_enabled_command",
        "async_confirm_recording",
        "async_flush_rolling_recording",
        "async_set_manual_recording",
        "async_set_rolling_recording",
        "async_set_user_audio_recording",
        "encode_recording_confirmation",
        "recording_command",
        "recording_upload_confirmation",
        "toggle_rolling_recordings",
        "user_audio_recording_command",
    ):
        assert symbol not in handwritten_runtime


def test_native_automation_blueprints_are_importable() -> None:
    """Keep all release blueprints parseable and linked to this integration."""
    blueprints = sorted(
        (ROOT / "blueprints" / "automation" / "matic_robot").glob("*.yaml")
    )

    assert len(blueprints) == 4
    for path in blueprints:
        content = load_yaml(path)
        blueprint = Blueprint(
            content,
            path=str(path),
            expected_domain="automation",
            schema=AUTOMATION_BLUEPRINT_SCHEMA,
        )
        assert blueprint.validate() is None
        assert "matic-home-assistant" in content["blueprint"]["source_url"]
