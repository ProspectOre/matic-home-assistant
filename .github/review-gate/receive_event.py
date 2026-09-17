#!/usr/bin/env python3
"""Trusted workflow_run receiver; candidate sensor logs require byte provenance."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile
from io import BytesIO

from event_relay import extract, positive, require, sha, validate

SENSOR = ".github/workflows/review-regular-review.yml"


def api(endpoint, payload=None, raw=False, pages=False):
    command = ["gh", "api", endpoint]
    if raw:
        command += ["-H", "Accept: application/vnd.github.raw+json"]
    if pages:
        command += ["--paginate", "--slurp"]
    if payload is not None:
        command += ["--method", "POST", "--input", "-"]
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, check=True)
    return result.stdout if raw else json.loads(result.stdout or "null")


def job_log(endpoint):
    """Return text from the REST logs endpoint, which is a zip archive."""
    result = subprocess.run(["gh", "api", endpoint], capture_output=True, check=True)
    data = result.stdout
    if data.startswith(b"PK"):
        with zipfile.ZipFile(BytesIO(data)) as archive:
            names = [name for name in archive.namelist() if not name.endswith("/")]
            require(len(names) == 1, "unexpected sensor log archive")
            return archive.read(names[0]).decode("utf-8")
    return data.decode("utf-8")


def authenticate(run, candidate_definition, trusted_definition):
    require(run.get("event") in ("pull_request_review", "pull_request_review_comment"), "wrong source event")
    require(run.get("path") == SENSOR and sha(run.get("head_sha")), "wrong source workflow")
    require(candidate_definition == trusted_definition and bool(trusted_definition), "sensor definition changed")


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    policy = os.environ["POLICY_REF"]
    default = os.environ["DEFAULT_BRANCH"]
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo), "invalid repository")
    require(sha(policy) and os.environ["GITHUB_WORKFLOW_REF"].endswith("@refs/heads/" + default),
            "receiver must run from the trusted default branch")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    source = event["workflow_run"]
    run_id, attempt = source["id"], source["run_attempt"]
    require(positive(run_id) and positive(attempt), "invalid run identity")
    root = "repos/" + repo
    run = api(f"{root}/actions/runs/{run_id}")
    require(run["id"] == run_id and run["repository"]["full_name"] == repo, "source repository mismatch")
    # A rerun replays the same original event. Only its current attempt can
    # finish the receipt; an older completion must not overwrite its state.
    if run["run_attempt"] != attempt:
        return
    head = run["head_sha"]
    require(sha(head), "invalid source head")
    pulls = [p for page in api(f"{root}/pulls?state=open&per_page=100", pages=True) for p in page]
    open_targets = [p for p in pulls if p["head"]["sha"] == head]
    run_targets = [{"number": p["number"]} for p in source.get("pull_requests", [])
                   if p.get("number")]
    targets = open_targets or run_targets
    if not targets:
        return  # Closed or superseded candidate: never transfer the event.
    context = f"review-event-capture/{run_id}"

    def stamp(state):
        for pr in targets:
            api(f"{root}/statuses/{head}", {"context": context, "state": state,
                "description": f"Review event {run_id} for PR #{pr['number']}",
                "target_url": source["html_url"]})
            if state != "success":
                api(f"{root}/statuses/{head}", {"context": "review-gate", "state": "pending",
                    "description": "Waiting for authenticated review event capture",
                    "target_url": source["html_url"]})

    if event["action"] == "requested":
        if run.get("status") == "completed" or run.get("conclusion"):
            return  # A delayed requested notification must not regress completion.
    stamp("pending")
    if event["action"] == "requested":
        return
    try:
        require(event["action"] == "completed" and run["conclusion"] == "success", "sensor did not finish")
        authenticate(run, api(f"{root}/contents/{SENSOR}?ref={head}", raw=True),
                     api(f"{root}/contents/{SENSOR}?ref={policy}", raw=True))
        jobs = [job for page in api(f"{root}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100", pages=True)
                for job in page["jobs"]]
        require(len(jobs) == 1 and jobs[0]["name"] == "capture-review-event"
                and jobs[0]["conclusion"] == "success", "unexpected sensor jobs")
        envelope = extract(job_log(f"{root}/actions/jobs/{jobs[0]['id']}/logs"))
        if envelope is None:
            stamp("success")
        else:
            number = envelope["pull_request"]["number"]
            require(any(p["number"] == number for p in targets), "event PR does not own source head")
            require(envelope["event_name"] == run["event"], "event kind mismatch")
            accepted = validate(envelope, repo, run["repository"]["id"], number, head)
            # A completed source run may describe an older head for a PR that
            # has since advanced. Preserve its receipt, but never evaluate the
            # current head from a stale event.
            current_target = next((p for p in open_targets if p["number"] == number), None)
            if accepted and current_target is not None:
                with tempfile.TemporaryDirectory() as folder:
                    payload = Path(folder) / "event.json"
                    payload.write_text(json.dumps(envelope))
                    env = dict(os.environ, REPO=repo, EVENT_NAME=envelope["event_name"],
                               FORWARDED_EVENT_PATH=str(payload), EVENT_PR_NUMBER=str(number),
                               EVENT_HEAD_SHA=head, INPUT_PR=str(number), RECORD_EVENT_ONLY="true",
                               REVIEW_GATE_CONTEXT="review-gate", REVIEW_BASE_CONTEXT="review-gate-base-change",
                               REVIEW_COMMENT_CONTEXT="review-gate-regular-comment",
                               REVIEW_REVIEW_CONTEXT="review-gate-regular-review",
                               SECURITY_REVIEW_BOT_LOGIN="chatgpt-codex-connector",
                               SECURITY_REVIEW_BOT_EVENT_LOGIN="chatgpt-codex-connector[bot]")
                    subprocess.run(["bash", os.environ["CANONICAL_REVIEW_GATE"]], env=env, check=True)
            stamp("success")  # Capture receipt only; never a successful review-gate.
        try:
            for pr in open_targets:
                if repo.endswith("/prospectore.github.io"):
                    token = os.environ.get("RECONCILE_TOKEN")
                    require(bool(token), "web reconciliation token is unavailable")
                    old = os.environ.get("GH_TOKEN")
                    try:
                        os.environ["GH_TOKEN"] = token
                        api(f"{root}/dispatches", {"event_type": "review-gate-reconcile",
                            "client_payload": {"pull_request": pr["number"]}})
                    finally:
                        if old is None:
                            os.environ.pop("GH_TOKEN", None)
                        else:
                            os.environ["GH_TOKEN"] = old
                else:
                    inputs = {"pull_request": str(pr["number"])}
                    if repo.endswith("/Operator-Insights"):
                        inputs["runner_route"] = "mbp"
                    api(f"{root}/actions/workflows/review-gate.yml/dispatches", {"ref": default, "inputs": inputs})
        except Exception as exc:
            # Capture has already succeeded. A reconciliation retry must not
            # replace that immutable receipt with a false capture failure.
            print(f"reconciliation dispatch failed: {exc}", file=os.sys.stderr)
    except Exception:
        stamp("failure")
        raise


if __name__ == "__main__":
    main()
