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

    assert manifest["version"] == "0.3.5"
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
        "ab22029681aa532bfe7de5774a9972d67bfbd2c0 # master" in workflow
    )


def test_review_gate_uses_only_regular_review_evidence() -> None:
    """Keep manual shipping independent from security-review availability."""
    review_gate = (ROOT / ".github" / "workflows" / "review-gate.yml").read_text()
    regular_review = (
        ROOT / ".github" / "workflows" / "review-regular-review.yml"
    ).read_text()
    regular_comment = (
        ROOT / ".github" / "workflows" / "review-regular-comment.yml"
    ).read_text()
    base_change = (
        ROOT / ".github" / "workflows" / "review-base-change.yml"
    ).read_text()
    rollout = (ROOT / ".github" / "workflows" / "review-gate-rollout.yml").read_text()
    base_advance = (
        ROOT / ".github" / "workflows" / "review-base-advance.yml"
    ).read_text()
    audit = (ROOT / ".github" / "workflows" / "review-gate-audit.yml").read_text()

    assert "cancel-in-progress: true" in review_gate
    assert "group: review-gate-" in review_gate
    assert "pull_request_review:" not in review_gate
    assert "issue_comment:" not in review_gate
    assert "REVIEW_BASE_CONTEXT: review-gate-base-change" in review_gate
    assert "REVIEW_COMMENT_CONTEXT: review-gate-regular-comment" in review_gate
    assert "REVIEW_REVIEW_CONTEXT: review-gate-regular-review" in review_gate
    assert "REVIEW_BOT_EVENT_LOGIN: chatgpt-codex-connector[bot]" in review_gate
    assert "Dedicated routers classify review and" in review_gate
    assert (
        "Exact-head regular PR reviews and explicit clean regular issue" in review_gate
    )
    assert "updatedAt" in review_gate
    assert "stock_clean_envelope" in review_gate
    assert "stock_clean_issue_comment_envelope" in review_gate
    assert "didn.t find any major issues" in review_gate
    assert "codex[[:space:]]+in[[:space:]]+github" in review_gate
    assert "def availability_notice:" in review_gate
    assert "availability_notice) | not" in review_gate
    assert 'source == "issue_comment"' in review_gate
    assert "total_count" in review_gate
    assert "latest_regular_issue_comment_at" in review_gate
    assert "latest_regular_review_invalidation_at" in review_gate
    assert "latest_finding_at" in review_gate
    assert "shared_open_head_count" in review_gate
    assert "shared_open_head_owner" in review_gate
    assert "$pr.state" in review_gate
    assert '"$pr_state" != "OPEN"' in review_gate
    assert "final_gate_snapshot" in review_gate
    assert "evidence_marker" in review_gate
    assert "; evidence $evidence_marker" in review_gate
    assert "Disarming automatic merge on" in review_gate
    assert "gh pr merge" not in review_gate
    assert "--auto" not in review_gate

    assert "name: Route Regular Codex Review Events" in regular_review
    assert "pull_request_review:" in regular_review
    assert "review-gate-review-event-${{ github.event.review.id }}" in regular_review
    assert "cancel-in-progress: false" in regular_review
    assert "REVIEW_BOT_EVENT_LOGIN: chatgpt-codex-connector[bot]" in regular_review
    assert "EVENT_PREVIOUS_REVIEW_BODY" in regular_review
    assert "body_is_regular_review" in regular_review
    assert "def security_heading:" in regular_review
    assert "security_heading | not" in regular_review
    assert "EVENT_REVIEW_COMMIT_SHA" in regular_review
    assert "def availability_notice:" in regular_review
    assert "availability_notice | not" in regular_review
    assert "Ignoring a review attached to an older pull request head" in regular_review
    assert "REVIEW_REVIEW_CONTEXT: review-gate-regular-review" in regular_review
    assert "Regular review invalidated; require a newer normal review" in regular_review
    assert "needs: route" in regular_review
    assert (
        "github.event.pull_request.head.repo.full_name == github.repository"
        in regular_review
    )
    assert (
        "GitHub downgrades pull_request_review tokens for forks to read-only"
        in regular_review
    )
    assert "contents: read" in regular_review
    assert (
        "WORKFLOW_REF: ${{ github.event.repository.default_branch }}" in regular_review
    )
    assert "Trusted review-gate evaluator is not installed" in regular_review
    assert (
        "group: review-gate-${{ github.event.pull_request.number }}" in regular_review
    )
    assert '--ref "$WORKFLOW_REF"' in regular_review
    assert "gh workflow run review-gate.yml" in regular_review

    assert "name: Invalidate Review Gate on Regular Comment" in regular_comment
    assert "issue_comment:" in regular_comment
    assert "review-gate-comment-event-${{ github.event.comment.id }}" in regular_comment
    assert "cancel-in-progress: false" in regular_comment
    assert "REVIEW_BOT_EVENT_LOGIN: chatgpt-codex-connector[bot]" in regular_comment
    assert "EVENT_PREVIOUS_COMMENT_BODY" in regular_comment
    assert "body_could_be_regular_comment" in regular_comment
    assert "before the pull request lookup" in regular_comment
    assert "body_is_regular_comment" in regular_comment
    assert "body_is_clean_comment" in regular_comment
    assert "def security_heading:" in regular_comment
    assert "security_heading | not" in regular_comment
    assert "def availability_notice:" in regular_comment
    assert "availability_notice | not" in regular_comment
    assert "REVIEW_COMMENT_CONTEXT: review-gate-regular-comment" in regular_comment
    assert "name: classify-regular-comment" in regular_comment
    assert "needs: classify" in regular_comment
    assert "if: needs.classify.outputs.regular == 'true'" in regular_comment
    assert "| jq -er '.head.sha'" in regular_comment
    assert (
        "WORKFLOW_REF: ${{ github.event.repository.default_branch }}" in regular_comment
    )
    assert "contents: read" in regular_comment
    assert "group: review-gate-${{ github.event.issue.number }}" in regular_comment
    assert "stock_clean_issue_comment_envelope" in regular_comment
    assert '--ref "$WORKFLOW_REF"' in regular_comment
    assert "gh workflow run review-gate.yml" in regular_comment
    assert "Trusted review-gate evaluator is not installed" in regular_comment
    assert "gh pr merge" not in regular_review + regular_comment
    assert "--auto" not in regular_review + regular_comment
    assert "github.event.changes.base != null" in base_change
    assert "WORKFLOW_REF: ${{ github.event.repository.default_branch }}" in base_change
    assert "contents: read" in base_change
    assert "EVENT_BASE_SHA" in base_change
    assert "REVIEW_GATE_CONTEXT: review-gate" in base_change
    assert "review-gate-base-change" in base_change
    assert "group: review-gate-${{ github.event.pull_request.number }}" in base_change
    assert "Base changed; push a new head before @codex review" in base_change
    assert "Base changed for PR #$PR_NUMBER at base $EVENT_BASE_SHA" in base_change
    assert 'stamp_status "$REVIEW_GATE_CONTEXT"' in base_change
    assert base_change.count('stamp_status "$REVIEW_GATE_CONTEXT"') == 2
    assert "cancel-in-progress: true" in base_change
    assert "cancel_active_gate_runs" in base_change
    assert "gh workflow run review-gate.yml" in base_change
    assert '--ref "$WORKFLOW_REF"' in base_change
    assert "Trusted review-gate evaluator is not installed" in base_change
    assert "gh pr merge" not in base_change
    assert "--auto" not in base_change
    assert "pulls?state=open" in base_advance
    assert "BASE_PUSHED_AT" in base_advance
    assert "snapshot_before_base_push" in base_advance
    assert "pull_requests" in base_advance
    assert "--slurpfile prs" in base_advance
    assert "mktemp" in base_advance
    assert "event_head_sha" in base_advance
    assert "EVENT_HEAD_SHA" in base_advance
    assert "gained a new head after the base advance" in base_advance
    assert "group: review-gate-base-advance-" in base_advance
    assert "cancel-in-progress: true" in base_advance
    assert "review-gate-base-change" in base_advance
    assert "disablePullRequestAutoMerge" in base_advance
    assert "((.auto_merge != null) | tostring)" in base_advance
    assert "cancel_active_gate_runs" in base_advance
    assert "gh workflow run review-gate.yml" in base_advance
    assert "WORKFLOW_REF: ${{ github.event.repository.default_branch }}" in base_advance
    assert '--ref "$WORKFLOW_REF"' in base_advance
    assert "contents: read" in base_advance
    assert "Trusted review-gate evaluator is not installed" in base_advance
    assert "push:\n    branches: [main]" in base_advance
    assert "schedule:" in audit
    assert "*/5 * * * *" in audit
    assert "matrix.pr_number" in audit
    assert "actions: write" in audit
    assert "contents: read" in audit
    assert "issues: read" in audit
    assert "statuses: write" in audit
    assert "group: review-gate-${{ matrix.pr_number }}" in audit
    assert "reviewThreads" in audit
    assert "review result" in audit
    assert "gh workflow run review-gate.yml" in audit
    assert "WORKFLOW_REF: ${{ github.event.repository.default_branch }}" in audit
    assert '--ref "$WORKFLOW_REF"' in audit
    assert "Trusted review-gate evaluator is not installed" in audit
    assert "def security_heading:" in audit
    assert "security_heading) | not" in audit
    assert "def availability_notice:" in audit
    assert "availability_notice) | not" in audit
    assert "current_regular_comment_records" in audit
    assert "current_regular_review_records" in audit
    assert "databaseId state submittedAt updatedAt" in audit
    assert 'select((.state // "") != "DISMISSED")' in audit
    assert 'select((.pullRequestReview.state // "") != "DISMISSED")' in audit
    assert "evidence_marker" in audit
    assert "is_reconciliation_pending" in audit
    assert "Reconcile every head through the trusted default-branch workflow" in audit
    assert "issue_comment:" not in audit
    assert "pulls?state=open" in rollout
    assert "actions: write" in rollout
    assert "Disarming automatic merge; waiting for @codex review" in rollout
    assert "disablePullRequestAutoMerge" in rollout
    assert "((.auto_merge != null) | tostring)" in rollout
    assert "cancel-legacy-auto-merge-runs" in rollout
    assert 'gh run cancel "$run_id" --repo "$REPO" || true' in rollout
    assert "active_gate_runs" in rollout
    assert '.event == "workflow_dispatch"' in rollout
    assert '.event == "issue_comment"' in rollout
    assert "group: review-gate-" in rollout
    assert "review-regular-review.yml" in rollout
    assert "review-regular-comment.yml" in rollout
    assert "gh pr merge" not in rollout
    assert "--auto" not in rollout


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
    assert "quality_scale.yaml" in package_data
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
