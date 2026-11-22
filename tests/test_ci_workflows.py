"""Keep CI running on every merge and on every supported Home Assistant."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).parents[1]
GITHUB = ROOT / ".github"
CONTRACT = json.loads((GITHUB / "delivery-contract.json").read_text(encoding="utf-8"))


def _workflow(name: str) -> dict[Any, Any]:
    """Return a parsed workflow. YAML reads its `on` key as True."""
    workflow: dict[Any, Any] = yaml.safe_load(
        (GITHUB / "workflows" / name).read_text(encoding="utf-8")
    )
    return workflow


@pytest.mark.parametrize(
    "name", [name for name, kind in CONTRACT["workflows"].items() if kind == "ci"]
)
def test_ci_runs_for_every_merge_into_main_and_release_branches(name: str) -> None:
    """A shared push group would drop the queued run of an earlier merge."""
    workflow = _workflow(name)
    assert workflow[True]["push"]["branches"] == ["main", "release/**"]
    assert (
        "github.event_name == 'push' && github.sha || github.ref"
        in workflow["concurrency"]["group"]
    )


def test_browser_shards_keep_the_traces_of_retried_tests() -> None:
    """Trace a retry, upload it per shard and print each browser's output."""
    browser = _workflow("test.yml")["jobs"]["browser"]
    steps = browser["steps"]
    shard = "--shard=${{ matrix.shard }}/${{ strategy.job-total }}"
    commands = [step.get("run") for step in steps]
    run = commands.index(f"npm run test:browser -- {shard}")
    upload = steps[run + 1]

    assert browser["strategy"]["matrix"] == {"shard": [1, 2, 3, 4, 5, 6, 7, 8]}
    assert upload["if"] == "failure()"
    assert upload["uses"].startswith("actions/upload-artifact@")
    assert upload["with"] == {
        "name": "browser-traces-${{ matrix.shard }}",
        "path": "test-results/",
    }
    config = (ROOT / "playwright.config.mjs").read_text(encoding="utf-8")
    assert 'trace: "on-first-retry"' in config
    # The trace is the retry's; a crashed first attempt leaves only this.
    assert steps[run]["env"]["DEBUG"] == "pw:browser"


def test_the_household_browser_tests_run_alone_and_in_every_sharded_run() -> None:
    """`@household` is a name to run them by, never a filter on the CI shards."""
    scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert scripts["test:browser"] == "playwright test"
    assert scripts["test:browser:household"] == "playwright test --grep @household"
    config = (ROOT / "playwright.config.mjs").read_text(encoding="utf-8")
    filters = [line for line in config.splitlines() if "grep" in line.lower()]
    assert filters
    assert not [line for line in filters if "household" in line]
    tagged = [
        path.name
        for path in (ROOT / "tests" / "browser").glob("*.spec.mjs")
        if "@household" in path.read_text(encoding="utf-8")
    ]
    assert "map_studio_v4_multi_robot_scale.spec.mjs" in tagged
    assert "map_studio_v4_entry_selection.spec.mjs" in tagged


def test_nightly_installs_a_version_for_every_lane_and_runs_every_suite() -> None:
    """A lane without its own install would rerun the pinned version."""
    job = _workflow("nightly.yml")["jobs"]["nightly"]
    matrix = job["strategy"]["matrix"]
    install = next(step["run"] for step in job["steps"] if "HA" in step.get("env", {}))
    conditions = [step.get("if") for step in job["steps"]]

    assert matrix == {"ha": ["minimum", "current", "beta"], "suite": ["pytest", "live"]}
    assert job["strategy"]["fail-fast"] is False
    assert "$(jq -r .homeassistant hacs.json)" in install
    for lane in matrix["ha"]:
        assert f"\n  {lane}) uv pip install " in install
    for suite in matrix["suite"]:
        assert f"matrix.suite == '{suite}'" in conditions


def _commands(job: dict[str, Any]) -> list[str]:
    """Return each step's command, or the action it uses without its ref."""
    return [step.get("run") or step["uses"].split("@")[0] for step in job["steps"]]


@pytest.mark.parametrize(
    ("workflow", "job", "reader"),
    [
        ("nightly.yml", "nightly", "pytest"),
        ("nightly.yml", "nightly", "npx playwright test"),
        (
            "windows-assistive-qualification.yml",
            "windows-assistive-qualification",
            "./scripts/qualify_windows_accessibility.ps1",
        ),
    ],
)
def test_matic_map_is_built_before_a_job_reads_it(
    workflow: str, job: str, reader: str
) -> None:
    """The bundle is not committed. Test shares one build; see below."""
    commands = [
        step.get("run", "") for step in _workflow(workflow)["jobs"][job]["steps"]
    ]
    built = next(i for i, run in enumerate(commands) if "npm run build:" in run)

    assert "npm run build:map-studio-v4" in commands[built].splitlines()
    assert built < min(i for i, run in enumerate(commands) if reader in run)


def test_one_job_builds_matic_map_and_shares_it() -> None:
    """No other job in Test builds Matic Map or reruns the build tests."""
    jobs = _workflow("test.yml")["jobs"]
    build = jobs["build"]
    upload = build["steps"][-1]

    assert next(iter(jobs)) == "build"
    assert _commands(build)[1:] == [
        "python3 .github/scripts/delivery-contract.py .",
        "actions/setup-node",
        "npm ci",
        "npm run test:build",
        "npm run build:map-studio-v4",
        "actions/upload-artifact",
    ]
    assert upload["with"]["name"] == "matic-map"
    assert upload["with"]["path"].split() == [
        "custom_components/matic_robot/matic_icons.js",
        "custom_components/matic_robot/map_studio_v4/",
        "tests/browser/.generated/",
    ]
    # The review build sits under a dot directory, which is skipped otherwise.
    assert upload["with"]["include-hidden-files"] is True
    assert upload["with"]["if-no-files-found"] == "error"
    for name, job in jobs.items():
        assert name == "build" or not any(
            "npm run build:" in run or "test:build" in run for run in _commands(job)
        )


@pytest.mark.parametrize(
    ("job", "reader"),
    [
        ("test", 'python scripts/check.py --all --built ${BASE:+--base "$BASE"}'),
        ("live", "npx playwright test --config playwright.live.config.mjs"),
        ("browser", "npm run test:browser -- --shard="),
    ],
)
def test_every_lane_downloads_the_build_before_reading_it(
    job: str, reader: str
) -> None:
    lane = _workflow("test.yml")["jobs"][job]
    commands = _commands(lane)
    download = commands.index("actions/download-artifact")

    assert lane["needs"] == "build"
    assert lane["steps"][download]["with"] == {"name": "matic-map"}
    assert download < next(i for i, run in enumerate(commands) if reader in run)


def test_a_failed_build_skips_every_lane_and_an_edit_run_still_replays() -> None:
    """Lanes that replay in an edit run must run while the build is skipped."""
    jobs = _workflow("test.yml")["jobs"]
    edit_run = "${{ !(github.event.action == 'edited' && !github.event.changes.base) }}"

    assert jobs["build"]["if"] == edit_run
    assert jobs["browser"]["if"] == edit_run
    for lane in ("test", "live"):
        assert jobs[lane]["if"] == (
            "${{ !cancelled() && needs.build.result != 'failure' }}"
        )


def test_release_publishes_the_zip_test_built_for_its_commit() -> None:
    """Release rebuilds nothing: it finds, checks, attests and publishes."""
    workflow = _workflow("release.yml")
    (job,) = workflow["jobs"].values()
    steps = {step.get("id"): step for step in job["steps"]}
    download = next(
        step
        for step in job["steps"]
        if step.get("uses", "").startswith("actions/download-artifact@")
    )

    assert list(workflow[True]) == ["workflow_dispatch"]
    assert list(workflow[True]["workflow_dispatch"]["inputs"]) == ["tag"]
    assert workflow["permissions"] == {"contents": "read"}
    assert job["permissions"] == {
        "actions": "read",
        "attestations": "write",
        "contents": "write",
        "id-token": "write",
    }
    assert job["steps"][0]["with"] == {"persist-credentials": False}
    assert _commands(job)[2:] == [
        'python scripts/release.py check "$TAG"',
        "python scripts/release.py built",
        "actions/download-artifact",
        "python scripts/release.py verify",
        "actions/attest",
        'python scripts/release.py publish "$TAG"',
        'python scripts/release.py prune "$TAG"',
    ]
    assert steps["test"]["run"] == "python scripts/release.py built"
    assert download["with"] == {
        "name": "matic_robot.zip",
        "path": "dist",
        "run-id": "${{ steps.test.outputs.run-id }}",
        "github-token": "${{ github.token }}",
    }
    assert "digest-mismatch" not in download["with"]
    assert not any("npm" in run for run in _commands(job))


def test_the_allowed_install_script_is_the_locked_esbuild() -> None:
    """Every job builds with esbuild, and Dependabot moves only its version."""
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    esbuild = package["devDependencies"]["esbuild"]

    assert package["allowScripts"] == {f"esbuild@{esbuild}": True}


def test_dependabot_updates_npm_but_not_the_browser_runtime() -> None:
    """Playwright must match the browser job's image, which Dependabot cannot move."""
    dependabot = yaml.safe_load((GITHUB / "dependabot.yml").read_text(encoding="utf-8"))
    npm = next(
        update
        for update in dependabot["updates"]
        if update["package-ecosystem"] == "npm"
    )

    assert {"dependency-name": "@playwright/test"} in npm["ignore"]


def test_ci_requires_every_lane_and_an_edit_run_reports_its_last_code_run() -> None:
    """The one required check fails when any lane, browser shards included, does."""
    jobs = _workflow("test.yml")["jobs"]
    ci = jobs["ci"]
    gate = next(step for step in ci["steps"] if step.get("name"))
    replay = next(
        step for step in ci["steps"] if "last-code-run.sh" in step.get("run", "")
    )

    assert ci["needs"] == [name for name in jobs if name != "ci"]
    assert ci["if"] == "always()"
    for lane in ci["needs"]:
        assert f'"${lane.upper()}" = success' in gate["run"]
    assert gate["env"] == {
        lane.upper(): f"${{{{ needs.{lane}.result }}}}" for lane in ci["needs"]
    }
    # An edit run's replays wait for the whole code run, up to 55 minutes.
    edit_run = "${{ github.event.action == 'edited' && !github.event.changes.base"
    assert ci["timeout-minutes"] == f"{edit_run} && 60 || 5 }}}}"
    for lane in ("test", "live"):
        assert jobs[lane]["timeout-minutes"] == f"{edit_run} && 60 || 20 }}}}"
    assert replay["run"] == ".github/scripts/last-code-run.sh ci"
    # Exactly one of the gate and the replay runs, whichever kind of run it is.
    assert gate["if"] == "${{ !fromJSON(env.RECHECK) }}"
    assert all(
        step["if"] == "${{ fromJSON(env.RECHECK) }}"
        for step in ci["steps"]
        if step is not gate
    )
    assert ci["permissions"] == {
        "actions": "read",
        "checks": "read",
        "contents": "read",
    }
    # An edit run changes no code, so the shards skip and `ci` replays.
    assert jobs["browser"]["if"] == (
        "${{ !(github.event.action == 'edited' && !github.event.changes.base) }}"
    )
