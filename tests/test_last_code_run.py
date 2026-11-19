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
HEAD = "abc123"

# Answers each GitHub API path with canned JSON through the real jq filter,
# after checking the query the script sent. A path's pages are served in turn,
# the last one repeating.
FAKE_GH = """\
import json, subprocess, sys
from pathlib import Path

state = Path(sys.argv[1])
args = sys.argv[2:]
path = next(arg for arg in args if arg.startswith("repos/owner/repo/"))
fields = {args[i + 1] for i, arg in enumerate(args) if arg == "-f"}
expression = args[args.index("--jq") + 1]
answers = json.loads((state / "answers.json").read_text())
if path.endswith("/commits/abc123/check-runs"):
    name, expected = "check_runs", {"check_name=ci", "filter=all", "per_page=100"}
elif path.endswith("/actions/runs"):
    name, expected = "runs", {"head_sha=abc123", "per_page=100"}
else:
    name, expected = "run", set()
assert fields == expected, (path, fields)
calls = state / f"{name}_calls"
count = int(calls.read_text()) if calls.exists() else 0
calls.write_text(str(count + 1))
pages = answers[name]
body = pages[min(count, len(pages) - 1)]
result = subprocess.run(
    ["jq", "-r", expression], input=json.dumps(body), text=True, capture_output=True
)
sys.stdout.write(result.stdout)
sys.exit(result.returncode)
"""


def _check_run(conclusion: str | None, suite: int = 1) -> dict[str, Any]:
    return {
        "id": suite,
        "status": "completed" if conclusion else "in_progress",
        "conclusion": conclusion,
        "html_url": f"https://example.invalid/run/{suite}",
        "app": {"slug": "github-actions"},
        "check_suite": {"id": suite},
    }


def _runs(earlier_status: str) -> dict[str, Any]:
    return {
        "workflow_runs": [
            {"id": 1, "workflow_id": WORKFLOW, "status": earlier_status},
            {"id": 2, "workflow_id": WORKFLOW + 1, "status": "queued"},
            {"id": OWN_RUN, "workflow_id": WORKFLOW, "status": "queued"},
        ]
    }


def _run(
    tmp_path: Path,
    check_runs: list[list[dict[str, Any]]],
    earlier: tuple[str, ...] = ("completed",),
) -> subprocess.CompletedProcess[str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (tmp_path / "answers.json").write_text(
        json.dumps(
            {
                "run": [{"check_suite_id": OWN_SUITE, "workflow_id": WORKFLOW}],
                "check_runs": [{"check_runs": page} for page in check_runs],
                "runs": [_runs(status) for status in earlier],
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
        "HEAD_SHA": HEAD,
    }
    return subprocess.run(
        ["bash", str(SCRIPT), "ci"],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


pytestmark = pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")


def test_waits_while_an_earlier_run_is_unfinished(tmp_path: Path) -> None:
    """A re-run's `ci` check run appears only once its needs finish; until
    then the earlier attempt's result must not count."""
    result = _run(
        tmp_path,
        [[_check_run("failure", 1), _check_run("success", 2)]],
        earlier=("in_progress", "in_progress", "completed"),
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Last code run of 'ci': success" in result.stdout
    assert (tmp_path / "runs_calls").read_text() == "3"
    assert (tmp_path / "check_runs_calls").read_text() == "1"


def test_fails_when_no_earlier_run_has_the_check(tmp_path: Path) -> None:
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
                _check_run("failure" if code == 0 else "success", 1),
                _check_run(conclusion, 2),
                _check_run("cancelled", 3),
                _check_run(None, OWN_SUITE),
            ]
        ],
    )

    assert result.returncode == code
    assert f"Last code run of 'ci': {conclusion}" in result.stdout
