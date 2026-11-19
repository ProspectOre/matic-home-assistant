"""An edit run's required check reports the last code run on the same head."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

SCRIPT = Path(__file__).parents[1] / ".github" / "scripts" / "last-code-run.sh"
OWN_RUN = 900
OWN_SUITE = 9000
WORKFLOW = 7

# Answers each GitHub API path with canned JSON through the real jq filter.
FAKE_GH = """\
import json, subprocess, sys
from pathlib import Path

state = Path(sys.argv[1])
args = sys.argv[2:]
path = next(arg for arg in args if arg.startswith("repos/"))
expression = args[args.index("--jq") + 1]
answers = json.loads((state / "answers.json").read_text())
if path.endswith("/check-runs"):
    calls = state / "check_run_calls"
    count = int(calls.read_text()) if calls.exists() else 0
    calls.write_text(str(count + 1))
    pages = answers["check_runs"]
    body = pages[min(count, len(pages) - 1)]
elif path.endswith("/actions/runs"):
    body = answers["runs"]
else:
    body = answers["run"]
result = subprocess.run(
    ["jq", "-r", expression], input=json.dumps(body), text=True, capture_output=True
)
sys.stdout.write(result.stdout)
sys.exit(result.returncode)
"""


def _check_run(status: str, conclusion: str | None, suite: int = 1) -> dict[str, Any]:
    return {
        "id": suite,
        "status": status,
        "conclusion": conclusion,
        "html_url": f"https://example.invalid/run/{suite}",
        "app": {"slug": "github-actions"},
        "check_suite": {"id": suite},
    }


def _run(
    tmp_path: Path,
    check_runs: list[list[dict[str, Any]]],
    earlier_status: str = "completed",
) -> subprocess.CompletedProcess[str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (tmp_path / "answers.json").write_text(
        json.dumps(
            {
                "run": {"check_suite_id": OWN_SUITE, "workflow_id": WORKFLOW},
                "check_runs": [{"check_runs": page} for page in check_runs],
                "runs": {
                    "workflow_runs": [
                        {"id": 1, "workflow_id": WORKFLOW, "status": earlier_status},
                        {"id": 2, "workflow_id": WORKFLOW + 1, "status": "queued"},
                        {"id": OWN_RUN, "workflow_id": WORKFLOW, "status": "queued"},
                    ]
                },
            }
        )
    )
    (tmp_path / "fake_gh.py").write_text(FAKE_GH)
    gh = bin_dir / "gh"
    gh.write_text(
        f'#!/bin/sh\nexec "{sys.executable}" "{tmp_path / "fake_gh.py"}" '
        f'"{tmp_path}" "$@"\n'
    )
    sleep = bin_dir / "sleep"
    sleep.write_text("#!/bin/sh\n")
    for script in (gh, sleep):
        script.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "GITHUB_REPOSITORY": "owner/repo",
        "GITHUB_RUN_ID": str(OWN_RUN),
        "HEAD_SHA": "abc123",
    }
    return subprocess.run(
        ["bash", str(SCRIPT), "ci"],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


pytestmark = pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")


def test_waits_for_a_check_run_that_appears_once_its_needs_finish(
    tmp_path: Path,
) -> None:
    """The code run's `ci` job is still waiting on browser shards at first."""
    result = _run(
        tmp_path,
        [
            [],
            [],
            [_check_run("in_progress", None)],
            [_check_run("completed", "success")],
        ],
        earlier_status="in_progress",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Last code run of 'ci': success" in result.stdout
    assert (tmp_path / "check_run_calls").read_text() == "4"


def test_fails_when_no_earlier_run_of_the_workflow_is_unfinished(
    tmp_path: Path,
) -> None:
    result = _run(tmp_path, [[]])

    assert result.returncode == 1
    assert "No code run of 'ci' for this head" in result.stdout


@pytest.mark.parametrize(("conclusion", "code"), [("success", 0), ("failure", 1)])
def test_reports_the_newest_earlier_result_and_ignores_its_own_suite(
    tmp_path: Path, conclusion: str, code: int
) -> None:
    result = _run(
        tmp_path,
        [
            [
                _check_run("completed", "failure" if code == 0 else "success", 1),
                _check_run("completed", conclusion, 2),
                _check_run("completed", "cancelled", 3),
                _check_run("in_progress", None, OWN_SUITE),
            ]
        ],
    )

    assert result.returncode == code
    assert f"Last code run of 'ci': {conclusion}" in result.stdout
