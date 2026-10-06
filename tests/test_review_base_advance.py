"""Exercise Matic base-advance invalidation for both supported base branches."""

import json
import os
import subprocess
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).parents[1]
WORKFLOW_PATH = ROOT / ".github/workflows/review-base-advance.yml"
WORKFLOW = yaml.safe_load(WORKFLOW_PATH.read_text())
REPO = "ProspectOre/matic-home-assistant"
HEAD = "a" * 40
MAIN_BASE = "b" * 40
RELEASE_BASE = "c" * 40


def _run_discovery(base_branch: str) -> list[dict[str, object]]:
    step = WORKFLOW["jobs"]["discover"]["steps"][0]
    pulls = [
        {"number": 41, "head": {"sha": "1" * 40}, "base": {"ref": "main"}},
        {
            "number": 42,
            "head": {"sha": HEAD},
            "base": {"ref": "release/0.4"},
        },
        {
            "number": 43,
            "head": {"sha": "3" * 40},
            "base": {"ref": "release/0.5"},
        },
    ]
    prelude = r"""gh() {
      if [[ "$1" == api && "$2" == repos/"$REPO"/pulls\?* ]]; then
        cat "$PULLS_JSON"
        return 0
      fi
      echo "Unexpected gh call: $*" >&2
      return 91
    }
    """
    with tempfile.TemporaryDirectory() as tmp:
        output_path = Path(tmp) / "github-output"
        pulls_path = Path(tmp) / "pulls.json"
        pulls_path.write_text(json.dumps(pulls))
        environment = dict(
            os.environ,
            BASE_BRANCH=base_branch,
            GH_TOKEN="test-token",
            REPO=REPO,
            GITHUB_OUTPUT=str(output_path),
            PULLS_JSON=str(pulls_path),
        )
        result = subprocess.run(
            ["bash"],
            input=prelude + step["run"],
            text=True,
            capture_output=True,
            env=environment,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        fields = dict(
            line.split("=", 1) for line in output_path.read_text().splitlines()
        )
        assert int(fields["count"]) == 1
        return json.loads(fields["matrix"])["include"]


def _run_invalidation(
    current_base: str,
) -> tuple[subprocess.CompletedProcess[str], str]:
    step = WORKFLOW["jobs"]["invalidate"]["steps"][0]
    pr = {
        "node_id": "PR_42",
        "base": {"ref": current_base, "sha": RELEASE_BASE},
        "head": {"sha": HEAD},
        "auto_merge": None,
    }
    prelude = r"""gh() {
      printf '%s\n' "$*" >> "$CALLS"
      case "$1:$2" in
        "api:repos/ProspectOre/matic-home-assistant/pulls/42")
          cat "$CURRENT_PR_JSON" ;;
        "api:repos/ProspectOre/matic-home-assistant/actions/workflows/review-gate.yml/runs?per_page=100")
          printf '%s' '[{"workflow_runs":[]}]' ;;
        api:repos/ProspectOre/matic-home-assistant/statuses/*)
          return 0 ;;
        "api:repos/ProspectOre/matic-home-assistant/contents/.github/workflows/review-gate.yml?ref=main")
          return 0 ;;
        workflow:run)
          return 0 ;;
        *)
          echo "Unexpected gh call: $*" >&2
          return 91 ;;
      esac
    }
    """
    with tempfile.TemporaryDirectory() as tmp:
        calls_path = Path(tmp) / "calls"
        current_pr_path = Path(tmp) / "pull.json"
        current_pr_path.write_text(json.dumps(pr))
        environment = dict(
            os.environ,
            BASE_BRANCH="release/0.4",
            BASE_PUSHED_AT="1728000000",
            EVENT_HEAD_SHA=HEAD,
            EVENT_BASE_SHA=RELEASE_BASE,
            GH_TOKEN="test-token",
            PR_NUMBER="42",
            REPO=REPO,
            REVIEW_BASE_CONTEXT="review-gate-base-change",
            REVIEW_GATE_CONTEXT="review-gate",
            WORKFLOW_REF="main",
            CURRENT_PR_JSON=str(current_pr_path),
            CALLS=str(calls_path),
            GITHUB_SERVER_URL="https://github.com",
            GITHUB_RUN_ID="12345",
        )
        result = subprocess.run(
            ["bash"],
            input=prelude + step["run"],
            text=True,
            capture_output=True,
            env=environment,
            check=False,
        )
        return result, calls_path.read_text() if calls_path.exists() else ""


def test_release_base_push_is_an_authorized_invalidation_trigger() -> None:
    condition = WORKFLOW["jobs"]["discover"]["if"]
    assert "github.ref_type == 'branch'" in condition
    assert "github.repository == 'ProspectOre/matic-home-assistant'" in condition
    assert "github.ref_name == 'release/0.4'" in condition

    expected_branch = (
        "${{ github.event_name == 'push' && github.ref_name "
        "|| github.event.repository.default_branch }}"
    )
    for job in ("discover", "invalidate"):
        assert (
            WORKFLOW["jobs"][job]["steps"][0]["env"]["BASE_BRANCH"] == expected_branch
        )


def test_discovery_selects_only_prs_for_the_advanced_base() -> None:
    assert _run_discovery("main") == [{"pr_number": 41, "event_head_sha": "1" * 40}]
    assert _run_discovery("release/0.4") == [{"pr_number": 42, "event_head_sha": HEAD}]


def test_release_base_advance_revokes_gate_and_dispatches_main_evaluator() -> None:
    result, calls = _run_invalidation("release/0.4")
    assert result.returncode == 0, result.stderr
    assert f"repos/{REPO}/statuses/{HEAD}" in calls
    assert "context=review-gate-base-change" in calls
    workflow_run = f"workflow run review-gate.yml --repo {REPO} --ref main"
    assert workflow_run in calls
    assert (
        "Base branch advancement invalidated regular review for PR #42."
        in result.stdout
    )


def test_release_event_skips_pr_that_has_since_retargeted() -> None:
    result, calls = _run_invalidation("main")
    assert result.returncode == 0, result.stderr
    assert "no longer targets release/0.4" in result.stdout
    assert "statuses/" not in calls
    assert "workflow run" not in calls
