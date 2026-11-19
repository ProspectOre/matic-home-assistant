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
# after checking the query the script sent. A path's answers are served one
# per call, the last one repeating; an answer that is a list is the pages of
# one --paginate call.
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
elif path.endswith("/actions/workflows/7/runs"):
    name, expected = "runs", {"head_sha=abc123", "per_page=100"}
else:
    name, expected = "run", set()
assert fields == expected, (path, fields)
assert name == "run" or "--paginate" in args, path
calls = state / f"{name}_calls"
count = int(calls.read_text()) if calls.exists() else 0
calls.write_text(str(count + 1))
calls_answers = answers[name]
answer = calls_answers[min(count, len(calls_answers) - 1)]
for body in answer if isinstance(answer, list) else [answer]:
    result = subprocess.run(
        ["jq", "-r", expression], input=json.dumps(body), text=True, capture_output=True
    )
    sys.stdout.write(result.stdout)
    if result.returncode:
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
            {"id": 1, "status": earlier_status},
            {"id": OWN_RUN, "status": "queued"},
            # A later edit run waits on this one, so this one must not wait on it.
            {"id": OWN_RUN + 1, "status": "in_progress"},
        ]
    }


def _run(
    tmp_path: Path,
    check_runs: list[list[dict[str, Any]]],
    earlier: tuple[str, ...] = ("completed",),
    *,
    one_call: bool = False,
    gh_script: str | None = None,
) -> subprocess.CompletedProcess[str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (tmp_path / "answers.json").write_text(
        json.dumps(
            {
                "run": [{"check_suite_id": OWN_SUITE, "workflow_id": WORKFLOW}],
                "check_runs": [[{"check_runs": page} for page in check_runs]]
                if one_call
                else [{"check_runs": page} for page in check_runs],
                "runs": [_runs(status) for status in earlier],
            }
        )
    )
    (tmp_path / "fake_gh.py").write_text(FAKE_GH)
    gh = bin_dir / "gh"
    gh.write_text(
        gh_script
        or f'#!/bin/sh\nexec "{sys.executable}" "{tmp_path / "fake_gh.py"}" '
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


# CI must run these: the runner has jq, and a skip there would pass the gate.
pytestmark = pytest.mark.skipif(
    shutil.which("jq") is None and not os.environ.get("CI"), reason="needs jq"
)


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


def test_takes_the_newest_result_across_pages(tmp_path: Path) -> None:
    result = _run(
        tmp_path,
        [[_check_run("success", 3)], [_check_run("failure", 2)]],
        one_call=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Last code run of 'ci': success" in result.stdout


def test_gives_up_when_an_earlier_run_never_finishes(tmp_path: Path) -> None:
    # A shell gh keeps 110 polls fast: it reports an earlier run as unfinished.
    polls = tmp_path / "polls"
    gh = (
        f'#!/bin/sh\necho >> "{polls}"\ncase "$*" in\n'
        f'  *"/actions/runs/{OWN_RUN}"*) echo "{OWN_SUITE} {WORKFLOW}" ;;\n'
        '  *"/runs"*) echo 1 ;;\n  *) exit 9 ;;\nesac\n'
    )

    result = _run(tmp_path, [[]], gh_script=gh)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "The last code run of 'ci' did not finish in time." in result.stdout
    assert len(polls.read_text().splitlines()) == 1 + 110


def test_ignores_a_check_run_of_the_same_name_from_another_app(
    tmp_path: Path,
) -> None:
    foreign = _check_run("success", 2) | {"app": {"slug": "another-app"}}

    result = _run(tmp_path, [[_check_run("failure", 1), foreign]])

    assert result.returncode == 1
    assert "Last code run of 'ci': failure" in result.stdout
