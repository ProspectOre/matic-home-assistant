"""Packaging and custom-integration release checks."""

import json
import os
import re
import shutil
import subprocess
import tomllib
from pathlib import Path

import pytest
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

    assert manifest["version"] == "0.5.0rc17"
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
        "06749dd8c0b54f350bc69c8752456cee498808a3 # master" in workflow
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
    assert "npm run test:browser" in commands
    assert package["scripts"]["test:browser"] == "playwright test"
    assert not any("playwright install" in command for command in commands)
    browser_test = next(
        step for step in browser["steps"] if step.get("run") == "npm run test:browser"
    )
    assert browser_test["env"]["HOME"] == "/root"


@pytest.mark.parametrize(
    ("scenario", "expected_code", "expected_error"),
    [
        ("clean", 0, ""),
        ("bundle", 1, "bundle is stale"),
        ("icons", 1, "bundle is stale"),
        ("wrong-workspace", 1, "outside the checked-out workspace"),
        ("missing-repository", 128, "not a git repository"),
        ("corrupt-index", 128, "Git could not verify"),
    ],
)
def test_browser_bundle_check_preserves_git_and_parity_guards(
    tmp_path: Path, scenario: str, expected_code: int, expected_error: str
) -> None:
    """Verify the actual CI shell under a synthetic container ownership boundary."""
    workspace = tmp_path / "workspace"
    bundle = workspace / "custom_components/matic_robot/map_studio_v4/index.js"
    icons = workspace / "custom_components/matic_robot/matic_icons.js"
    bundle.parent.mkdir(parents=True)
    bundle.write_text("bundle\n")
    icons.write_text("icons\n")
    global_config = tmp_path / "gitconfig"
    global_config.write_text("")
    env = {
        key: value for key, value in os.environ.items() if not key.startswith("GIT_")
    }
    env.update(
        GIT_CONFIG_GLOBAL=str(global_config), GIT_CONFIG_NOSYSTEM="1", LC_ALL="C"
    )
    for arguments in (
        ["init", "--quiet"],
        ["add", "custom_components"],
        [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Synthetic baseline",
        ],
    ):
        subprocess.run(
            ["git", *arguments], cwd=workspace, env=env, check=True, capture_output=True
        )
    env.update(GITHUB_WORKSPACE=str(workspace), GIT_TEST_ASSUME_DIFFERENT_OWNER="1")
    untrusted = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=workspace,
        env=env,
        capture_output=True,
        text=True,
    )
    assert untrusted.returncode != 0
    assert "detected dubious ownership" in untrusted.stderr
    if scenario in {"bundle", "icons"}:
        (bundle if scenario == "bundle" else icons).write_text("changed\n")
    elif scenario == "wrong-workspace":
        env.update(
            GITHUB_WORKSPACE=str(tmp_path / "other"),
            GIT_TEST_ASSUME_DIFFERENT_OWNER="0",
        )
    elif scenario == "missing-repository":
        shutil.rmtree(workspace / ".git")
    elif scenario == "corrupt-index":
        (workspace / ".git" / "index").write_bytes(b"invalid")
    workflow = load_yaml(ROOT / ".github" / "workflows" / "browser.yml")
    command = next(
        step["run"]
        for step in workflow["jobs"]["browser"]["steps"]
        if step.get("name") == "Committed bundle matches the frontend source"
    )
    assert re.findall(r"safe\.directory=(\S+)", command) == [
        '"$GITHUB_WORKSPACE"',
        '"$GITHUB_WORKSPACE"',
    ]
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", command],
        cwd=workspace,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == expected_code, result.stderr
    if expected_error:
        assert expected_error in result.stderr
    else:
        assert not result.stderr
    assert global_config.read_text() == ""


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
    assert {path for path in workflow_chunks.rglob("*") if path.is_file()} == set(
        chunk_files
    )
    production_graph = "\n".join(
        path.read_text() for path in studio_bundle.rglob("*.js")
    )
    assert "GALLERY_SCENARIOS" not in production_graph
    assert "createGalleryState" not in production_graph
    assert "matic-map-studio-gallery-v0-4-0" not in production_graph
    assert not (INTEGRATION / "map_studio_v4-review").exists()


def test_python_package_includes_home_assistant_runtime_files() -> None:
    """Keep non-Python integration files in wheel and sdist builds."""
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())
    package_data = set(
        config["tool"]["setuptools"]["package-data"]["custom_components.matic_robot"]
    )

    assert "manifest.json" in package_data
    assert "quality_scale.yaml" in package_data
    assert "brand/*.png" in package_data
    assert "translations/*.json" in package_data
    assert "client/matic_intermediate_ca.pem" in package_data
    assert "client/proto/*.proto" in package_data
    assert "www/*.js" not in package_data
    assert "*.js" in package_data
    assert "map_studio_v4/*.js" in package_data
    assert "map_studio_v4/**/*.js" in package_data
    assert (INTEGRATION / "manifest.json").exists()
    assert (INTEGRATION / "client" / "matic_intermediate_ca.pem").exists()


def test_ci_inspects_finished_release_archives() -> None:
    """Run artifact inspection only after the wheel and sdist are built."""
    workflow = (ROOT / ".github" / "workflows" / "test.yml").read_text()
    # The default builds the wheel from the fresh sdist, not stale build/lib.
    build = "- run: python -m build\n"
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

    assert len(blueprints) == 5
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
