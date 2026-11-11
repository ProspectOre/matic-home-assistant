"""Packaging and custom-integration release checks."""

import json
import re
import tomllib
from pathlib import Path

from homeassistant.components.automation.config import AUTOMATION_BLUEPRINT_SCHEMA
from homeassistant.components.blueprint.models import Blueprint
from homeassistant.util.yaml import load_yaml

from custom_components.matic_robot.client.endpoints import HERMES_ENDPOINT_NAMES
from scripts.release import ARCHIVE

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

    assert manifest["version"] == "0.6.0b1"
    assert project["version"] == manifest["version"]
    assert hacs["homeassistant"] == "2026.10.0"
    # HACS installs the zip a release carries; the default branch has no panel.
    assert hacs["zip_release"] is True
    assert hacs["filename"] == ARCHIVE.name
    assert hacs["hide_default_branch"] is True
    assert manifest["documentation"].startswith("https://github.com/")
    assert manifest["issue_tracker"].endswith("/issues")
    assert manifest["codeowners"]
    assert manifest["dependencies"] == ["bluetooth_adapters", "http", "zeroconf"]
    assert manifest["after_dependencies"] == ["frontend", "recorder"]


def test_github_validation_runs_hacs_and_hassfest() -> None:
    """Keep both official repository validators wired into CI."""
    workflow = (ROOT / ".github" / "workflows" / "validate.yml").read_text()

    # Match the validators by name and pinned-SHA shape rather than one exact
    # SHA, so routine Dependabot bumps of these actions keep the test green.
    assert re.search(r"uses: hacs/action@[0-9a-f]{40} # main$", workflow, re.MULTILINE)
    assert re.search(
        r"uses: home-assistant/actions/hassfest@[0-9a-f]{40} # master$",
        workflow,
        re.MULTILINE,
    )


def test_github_actions_use_immutable_refs_with_semantic_comments() -> None:
    """Pin external actions while documenting the corresponding upstream ref."""
    for path in (ROOT / ".github" / "workflows").glob("*.yml"):
        content = path.read_text()
        uses = list(ACTION_USE.finditer(content))
        # A workflow with no `uses:` lines (pure-shell, e.g. auto-merge.yml) has
        # nothing to pin; the non-empty assert only guards ACTION_USE against
        # silently rotting, so anchor it to the lines it must parse.
        has_uses_lines = re.search(r"^\s*(?:-\s*)?uses:", content, re.MULTILINE)
        assert uses or not has_uses_lines, (
            f"{path} has uses: lines ACTION_USE cannot parse"
        )

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


def test_browser_ci_image_matches_the_locked_playwright_runtime() -> None:
    """Use immutable preinstalled browsers compatible with the full test suite."""
    workflow = load_yaml(ROOT / ".github" / "workflows" / "browser.yml")
    browser = workflow["jobs"]["browser"]
    package = json.loads((ROOT / "package.json").read_text())
    lock = json.loads((ROOT / "package-lock.json").read_text())
    version = package["devDependencies"]["@playwright/test"]
    image = re.fullmatch(
        r"mcr\.microsoft\.com/playwright:v(?P<version>\d+\.\d+\.\d+)"
        r"-noble@sha256:[0-9a-f]{64}",
        browser["container"]["image"],
    )

    assert image is not None, "Browser CI requires an immutable official image"
    assert image["version"] == version
    for dependency in ("@playwright/test", "playwright", "playwright-core"):
        assert lock["packages"][f"node_modules/{dependency}"]["version"] == version

    commands = [step["run"] for step in browser["steps"] if "run" in step]
    assert package["scripts"]["test:browser"] == "playwright test"
    assert not any("playwright install" in command for command in commands)
    browser_test = next(
        step
        for step in browser["steps"]
        if step.get("run", "").startswith("npm run test:browser ")
    )
    assert browser_test["env"]["HOME"] == "/root"


def test_source_and_runtime_translations_stay_in_sync() -> None:
    """Ship runtime translations while retaining canonical Hassfest source."""
    strings = json.loads((INTEGRATION / "strings.json").read_text())
    translation = json.loads((INTEGRATION / "translations" / "en.json").read_text())

    assert translation == strings
    assert (INTEGRATION / "icons.json").exists()
    assert (INTEGRATION / "matic_icons.js").exists()
    assert (INTEGRATION / "services.yaml").exists()
    assert not (INTEGRATION / "www").exists()
    studio_bundle = INTEGRATION / "map_studio_v4"
    assert (studio_bundle / "index.js").exists()
    workflow_chunks = studio_bundle / "chunks"
    assert workflow_chunks.is_dir()
    chunk_files = tuple(workflow_chunks.rglob("*.js"))
    assert chunk_files
    assert all(path.is_file() for path in chunk_files)
    notices = set(workflow_chunks.rglob("*.js.LEGAL.txt"))
    assert notices
    assert all(
        path.with_name(path.name.removesuffix(".LEGAL.txt")).is_file()
        for path in notices
    )
    assert {path for path in workflow_chunks.rglob("*") if path.is_file()} == set(
        chunk_files
    ) | notices
    production_graph = "\n".join(
        path.read_text() for path in studio_bundle.rglob("*.js")
    )
    assert "GALLERY_SCENARIOS" not in production_graph
    assert "createGalleryState" not in production_graph
    assert "matic-map-studio-gallery-v0-4-0" not in production_graph
    assert not (INTEGRATION / "map_studio_v4-review").exists()


def test_ci_checks_and_keeps_the_zip_a_release_ships() -> None:
    """Build the zip after the tests built Matic Map, load it, then keep it."""
    steps = load_yaml(ROOT / ".github" / "workflows" / "test.yml")["jobs"]["test"][
        "steps"
    ]
    commands = [step.get("run") for step in steps]
    build = commands.index("python scripts/release.py zip")
    upload = steps[build + 2]

    assert commands.index("python scripts/check.py --all") < build
    assert commands[build + 1] == "python scripts/check_fresh_install.py"
    assert upload["uses"].startswith("actions/upload-artifact@")
    # Unarchived, the download is the zip itself rather than a zip of it.
    assert upload["with"] == {
        "path": ARCHIVE.as_posix(),
        "archive": False,
        "if-no-files-found": "error",
    }


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
    # The private short-lived AI photo attachment source is not a recording API.
    assert (INTEGRATION / "media_source.py").exists()
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

    assert len(blueprints) == 6
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
