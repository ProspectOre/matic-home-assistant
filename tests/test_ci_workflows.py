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
    """Record a trace on retry and upload it under a name unique to the shard."""
    browser = _workflow("browser.yml")["jobs"]["browser"]
    steps = browser["steps"]
    shard = "--shard=${{ matrix.shard }}/${{ strategy.job-total }}"
    commands = [step.get("run") for step in steps]
    upload = steps[commands.index(f"npm run test:browser -- {shard}") + 1]

    assert browser["strategy"]["matrix"] == {"shard": [1, 2, 3, 4]}
    assert upload["if"] == "failure()"
    assert upload["uses"].startswith("actions/upload-artifact@")
    assert upload["with"] == {
        "name": "browser-traces-${{ matrix.shard }}",
        "path": "test-results/",
    }
    config = (ROOT / "playwright.config.mjs").read_text(encoding="utf-8")
    assert 'trace: "on-first-retry"' in config


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


def test_dependabot_updates_npm_but_not_the_browser_runtime() -> None:
    """Playwright must match the browser.yml image, which Dependabot cannot move."""
    dependabot = yaml.safe_load((GITHUB / "dependabot.yml").read_text(encoding="utf-8"))
    npm = next(
        update
        for update in dependabot["updates"]
        if update["package-ecosystem"] == "npm"
    )

    assert {"dependency-name": "@playwright/test"} in npm["ignore"]
