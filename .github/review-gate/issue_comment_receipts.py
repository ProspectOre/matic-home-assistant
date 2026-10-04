"""Validate native review-event capture and body-bound issue-comment receipts."""

import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from functools import lru_cache

CONTEXT = re.compile(
    r"review-clean-comment/([1-9][0-9]*)/([1-9][0-9]*)/([1-9][0-9]*)\Z"
)
DIGEST = re.compile(
    r"body-sha256:([0-9a-f]{64}); updated-at:("
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)"
    r"(?:; action:(created|edited))?\Z"
)
SHA = re.compile(r"[0-9a-f]{40}\Z")
HUMAN_REVIEW_RUN_TITLE = re.compile(
    r"Review gate PR #([1-9][0-9]*) \| review-origin=authorized-human-review-v1"
    r" \| policy-workflow-sha=([0-9a-f]{40})\Z"
)
LEGACY_REVIEW_RUN_TITLE = re.compile(
    r"Review gate PR #([1-9][0-9]*) \| policy-workflow-sha=([0-9a-f]{40})\Z"
)
PLAIN_LEGACY_REVIEW_RUN_TITLE = re.compile(r"Review gate PR #([1-9][0-9]*)\Z")
CONNECTOR_BOT_ID = 199175422
CONNECTOR_BOT_LOGIN = "chatgpt-codex-connector[bot]"
LEGACY_MANUAL_REVIEW_LOG = (
    "Manual review request; no native connector receipt is needed."
)
LEGACY_MANUAL_REVIEW_LOG_LINE = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z "
    + re.escape(LEGACY_MANUAL_REVIEW_LOG)
    + r"\Z"
)
NATIVE_CAPTURE_LOG_LINE = re.compile(
    r"(?:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2}) )?"
    r"Review event ([1-9][0-9]*) recorded for PR #([1-9][0-9]*)\Z"
)
CLEAN_COMMENT_CAPTURE_LOG_LINE = re.compile(
    r"(?:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2}) )?"
    r"Review comment receipt ([1-9][0-9]*) recorded for PR #([1-9][0-9]*): "
    r"body-sha256:([0-9a-f]{64}); updated-at:"
    r"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z); "
    r"action:(created|edited); head:([0-9a-f]{40})\Z"
)


def validate_run_actor(actor, label):
    """Require GitHub's server-attested account identity on a workflow run."""
    if (
        not isinstance(actor, dict)
        or type(actor.get("id")) is not int
        or actor["id"] <= 0
        or not isinstance(actor.get("login"), str)
        or not re.fullmatch(r"[A-Za-z0-9_.\-\[\]]+", actor["login"])
        or actor.get("type") not in ("User", "Bot")
    ):
        raise ValueError(f"invalid completed-run {label} provenance")


def is_non_connector_issue_comment_run(run, number):
    """Recognize only a current human request with an explicit origin marker.

    Only a trusted, PR-bound request can be exempted from the connector receipt
    census. A human rerun of a connector-originated run remains a Bot actor;
    classify the original actor, never triggering_actor. Marker-like malformed
    titles and unbound legacy titles stay fail-closed.
    """
    if (
        run.get("event") != "issue_comment"
        or run.get("actor", {}).get("type") != "User"
    ):
        return False
    pulls = run.get("pull_requests")
    if not isinstance(pulls, list) or (
        pulls
        and any(
            not isinstance(pull, dict) or pull.get("number") != number for pull in pulls
        )
    ):
        return False
    title = run.get("display_title")
    if not isinstance(title, str):
        return False
    match = HUMAN_REVIEW_RUN_TITLE.fullmatch(title)
    if match is not None:
        return int(match.group(1)) == number
    return False


def api(endpoint, *, pages=False, query=None):
    command = [os.environ.get("REVIEW_GATE_GH") or "gh", "api", endpoint]
    if query is not None:
        command += ["-f", "query=" + query]
    if pages:
        command += ["--paginate", "--slurp"]
    result = subprocess.run(
        command, text=True, capture_output=True, check=True, timeout=60
    )
    return json.loads(result.stdout)


def trusted_legacy_manual_step(source):
    """Verify the historical workflow's guarded human-only receipt omission."""
    marker = f'echo "{LEGACY_MANUAL_REVIEW_LOG}"'
    if source.count(marker) != 1:
        return False
    lines = source.splitlines()
    starts = [
        index
        for index, line in enumerate(lines)
        if re.fullmatch(r"[ \t]*- id: begin-native-event[ \t]*", line)
    ]
    if len(starts) != 1:
        return False
    start = starts[0]
    indent = len(lines[start]) - len(lines[start].lstrip(" \t"))
    end = len(lines)
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if len(line) - len(line.lstrip(" \t")) == indent and line.lstrip().startswith(
            "- "
        ):
            end = index
            break
    step = "\n".join(lines[start:end])
    if not re.search(
        r"(?m)^\s*if:\s*github\.event_name == ['\"]issue_comment['\"]\s*$", step
    ):
        return False
    guard_at = step.find("if ! jq -e")
    marker_at = step.find(marker)
    if guard_at < 0 or marker_at <= guard_at:
        return False
    guard = step[guard_at:marker_at]
    if not all(
        token in guard
        for token in (
            ".comment.user.id == 199175422",
            '.comment.user.login == "chatgpt-codex-connector[bot]"',
            '.comment.user.type == "Bot"',
        )
    ):
        return False
    if "exit 0" not in step[marker_at:]:
        return False
    # Verify this revision admitted only authorized human review requests.
    return all(
        token in source
        for token in (
            "github.event.issue.pull_request != null",
            "github.event.comment.user.type == 'User'",
            "github.event.comment.author_association == 'OWNER'",
            "github.event.comment.author_association == 'MEMBER'",
            "github.event.comment.author_association == 'COLLABORATOR'",
            "contains(github.event.comment.body, '@codex review')",
        )
    )


def legacy_workflow_source(repo, workflow_file, source_sha):
    """Read a workflow only from the run's validated default-branch revision."""
    if (
        not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        or not re.fullmatch(r"[A-Za-z0-9_.-]+\.yml", workflow_file)
        or not SHA.fullmatch(source_sha)
    ):
        return None
    path = f".github/workflows/{workflow_file}"
    try:
        record = api(f"repos/{repo}/contents/{path}?ref={source_sha}")
        if (
            not isinstance(record, dict)
            or record.get("path") != path
            or record.get("encoding") != "base64"
            or not isinstance(record.get("content"), str)
        ):
            return None
        encoded = re.sub(r"\s+", "", record["content"])
        return base64.b64decode(encoded, validate=True).decode("utf-8")
    except (
        OSError,
        ValueError,
        UnicodeDecodeError,
        subprocess.SubprocessError,
        json.JSONDecodeError,
    ):
        return None


@lru_cache(maxsize=32)
def trusted_legacy_manual_workflow(repo, workflow_file, source_sha):
    """Bind legacy human-log interpretation to the workflow at the run's head."""
    source = legacy_workflow_source(repo, workflow_file, source_sha)
    return source is not None and trusted_legacy_manual_step(source)


def trusted_legacy_connector_bot_step(source):
    """Prove the historical gate admitted this exact connector actor for PR comments."""
    run_name = next(
        (line for line in source.splitlines() if line.startswith("run-name:")), ""
    )
    if not all(
        token in run_name
        for token in (
            "Review gate PR #",
            "github.event.pull_request.number",
            "github.event.issue.number",
        )
    ):
        return False
    lines = source.splitlines()
    if not any(re.fullmatch(r"[ \t]+issue_comment[ \t]*:", line) for line in lines):
        return False
    try:
        evaluate = lines.index("  evaluate:")
    except ValueError:
        return False
    end = next(
        (
            index
            for index in range(evaluate + 1, len(lines))
            if re.match(r"^  [A-Za-z0-9_-]+:", lines[index])
        ),
        len(lines),
    )
    job = lines[evaluate + 1 : end]
    condition = next(
        (
            index
            for index, line in enumerate(job)
            if re.fullmatch(r"[ \t]{4}if:[ \t]*>-?[ \t]*", line)
        ),
        None,
    )
    runs_on = next(
        (
            index
            for index, line in enumerate(job)
            if re.match(r"^[ \t]{4}runs-on:", line)
        ),
        None,
    )
    if condition is None or runs_on is None or runs_on <= condition + 1:
        return False
    expression = "\n".join(job[condition + 1 : runs_on])
    return (
        re.search(r"github\.event\.issue\.pull_request\s*!=\s*null", expression)
        is not None
        and re.search(
            r"github\.event\.comment\.user\.login\s*==\s*['\"]chatgpt-codex-connector\[bot\]['\"]",
            expression,
        )
        is not None
        and re.search(r"github\.event\.comment\.user\.id\s*==\s*199175422", expression)
        is not None
        and re.search(
            r"github\.event\.comment\.user\.type\s*==\s*['\"]Bot['\"]", expression
        )
        is not None
    )


@lru_cache(maxsize=32)
def trusted_legacy_connector_bot_workflow(repo, workflow_file, source_sha):
    """Bind legacy bot attribution to the workflow revision that admitted it."""
    source = legacy_workflow_source(repo, workflow_file, source_sha)
    return source is not None and trusted_legacy_connector_bot_step(source)


def has_legacy_manual_review_log(repo, run_id, attempt):
    """Read one specific Actions attempt; unavailable logs fail closed."""
    if (
        not isinstance(repo, str)
        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        or type(run_id) is not int
        or run_id <= 0
        or type(attempt) is not int
        or attempt <= 0
    ):
        return False
    try:
        result = subprocess.run(
            [
                os.environ.get("REVIEW_GATE_GH") or "gh",
                "run",
                "view",
                str(run_id),
                "--repo",
                repo,
                "--attempt",
                str(attempt),
                "--log",
            ],
            text=True,
            capture_output=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):  # fmt: skip
        return False
    if result.returncode != 0:
        return False
    return any(
        len(fields := line.split("\t")) == 3
        and LEGACY_MANUAL_REVIEW_LOG_LINE.fullmatch(fields[2])
        for line in result.stdout.splitlines()
    )


def has_native_capture_log(repo, run_id, attempt, number):
    """Prove the exact trusted run reached its native-receipt publication step."""
    if (
        not isinstance(repo, str)
        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        or type(run_id) is not int
        or run_id <= 0
        or type(attempt) is not int
        or attempt <= 0
        or type(number) is not int
        or number <= 0
    ):
        return False
    try:
        result = subprocess.run(
            [
                os.environ.get("REVIEW_GATE_GH") or "gh",
                "run",
                "view",
                str(run_id),
                "--repo",
                repo,
                "--attempt",
                str(attempt),
                "--log",
            ],
            text=True,
            capture_output=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):  # fmt: skip
        return False
    if result.returncode != 0:
        return False
    return any(
        len(fields := line.split("\t")) == 3
        and (match := NATIVE_CAPTURE_LOG_LINE.fullmatch(fields[2])) is not None
        and int(match.group(1)) == run_id
        and int(match.group(2)) == number
        for line in result.stdout.splitlines()
    )


@lru_cache(maxsize=128)
def clean_comment_capture_records(repo, run_id, attempt):
    """Fetch and parse a trusted attempt log once, even when it has many receipts."""
    if (
        not isinstance(repo, str)
        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        or type(run_id) is not int
        or run_id <= 0
        or type(attempt) is not int
        or attempt <= 0
    ):
        return frozenset()
    try:
        result = subprocess.run(
            [
                os.environ.get("REVIEW_GATE_GH") or "gh",
                "run",
                "view",
                str(run_id),
                "--repo",
                repo,
                "--attempt",
                str(attempt),
                "--log",
            ],
            text=True,
            capture_output=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):  # fmt: skip
        return frozenset()
    if result.returncode != 0:
        return frozenset()
    records = set()
    for line in result.stdout.splitlines():
        fields = line.split("\t")
        if len(fields) != 3:
            continue
        match = CLEAN_COMMENT_CAPTURE_LOG_LINE.fullmatch(fields[2])
        if match is not None:
            records.add(
                (
                    int(match.group(1)),
                    int(match.group(2)),
                    match.group(3),
                    match.group(4),
                    match.group(5),
                    match.group(6),
                )
            )
    return frozenset(records)


def has_clean_comment_capture_log(
    repo, run_id, attempt, number, comment_id, digest, updated_at, action, head
):
    """Prove one exact comment receipt and evaluated head from the attempt log."""
    if (
        type(number) is not int
        or number <= 0
        or type(comment_id) is not int
        or comment_id <= 0
        or not re.fullmatch(r"[0-9a-f]{64}", digest)
        or not re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", updated_at
        )
        or action not in ("created", "edited")
        or not SHA.fullmatch(head)
    ):
        return False
    return (
        comment_id,
        number,
        digest,
        updated_at,
        action,
        head,
    ) in clean_comment_capture_records(repo, run_id, attempt)


def current_clean_comment_event_matches(
    number, comment_id, run_id, attempt, digest, updated_at, action
):
    """Bind an in-flight receipt to the runner's immutable current event payload."""
    if (
        str(run_id) != os.environ.get("GITHUB_RUN_ID")
        or str(attempt) != os.environ.get("GITHUB_RUN_ATTEMPT")
        or os.environ.get("GITHUB_EVENT_NAME") != "issue_comment"
    ):
        return False
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        return False
    try:
        with open(event_path, encoding="utf-8") as event_file:
            event = json.load(event_file)
    except (OSError, ValueError, json.JSONDecodeError):  # fmt: skip
        return False
    comment = event.get("comment") if isinstance(event, dict) else None
    actor = comment.get("user") if isinstance(comment, dict) else None
    return (
        isinstance(event, dict)
        and event.get("action") == action
        and isinstance(event.get("issue"), dict)
        and event["issue"].get("number") == number
        and isinstance(comment, dict)
        and comment.get("id") == comment_id
        and isinstance(comment.get("body"), str)
        and hashlib.sha256(comment["body"].encode("utf-8")).hexdigest() == digest
        and comment.get("updated_at") == updated_at
        and isinstance(actor, dict)
        and actor.get("id") == CONNECTOR_BOT_ID
        and actor.get("login") == CONNECTOR_BOT_LOGIN
        and actor.get("type") == "Bot"
    )


@lru_cache(maxsize=4)
def review_section_module(path):
    """Load the same trusted, hash-verified parser used by the evaluator."""
    spec = importlib.util.spec_from_file_location("receipt_review_sections", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def may_be_clean_review_comment(body):
    """Conservative prefilter; trusted receipt checks establish proof afterward."""
    if not isinstance(body, str):
        return False
    path = os.environ.get("REVIEW_SECTIONS_SCRIPT") or os.path.join(
        os.path.dirname(__file__), "review_sections.py"
    )
    module = review_section_module(path)
    bound_clean = any(
        section["regular_clean"] and section["target_ref"] != "__unbound__"
        for section in module.classify_body(body)["sections"]
    )
    # Keep the legacy automated-suggestions envelope eligible for proof too.
    return bound_clean or (
        "reviewed commit:" in body.casefold()
        and bool(re.search(module.CLEAN_SUMMARY, body, re.I))
    )


def authenticated_clean_comment_statuses(
    status_pages,
    comments,
    repo,
    number,
    workflow_file,
    event_run_id="",
    event_comment_id="",
    event_run_attempt=None,
    prior_comment_id="",
    evaluated_head="",
):
    """Keep receipts backed by the exact trusted workflow attempt and log."""
    if not isinstance(status_pages, list):
        return []
    if (
        not isinstance(comments, list)
        or not isinstance(number, int)
        or number <= 0
        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
        or not re.fullmatch(r"[A-Za-z0-9_.-]+\.yml", workflow_file)
        or not SHA.fullmatch(evaluated_head)
    ):
        return [[] for _ in status_pages]
    wanted_comment_ids = {
        str(comment.get("id"))
        for page in comments
        if isinstance(page, list)
        for comment in page
        if isinstance(comment, dict)
        and type(comment.get("id")) in (int, str)
        and re.fullmatch(r"[1-9][0-9]*", str(comment.get("id")))
        and may_be_clean_review_comment(comment.get("body"))
    }
    if re.fullmatch(r"[1-9][0-9]*", str(prior_comment_id)):
        wanted_comment_ids.add(str(prior_comment_id))
    if not wanted_comment_ids:
        return [[] for _ in status_pages]
    eligible_current_event = (
        str(event_run_id).isdigit()
        and int(event_run_id) > 0
        and str(event_comment_id).isdigit()
        and int(event_comment_id) > 0
        and type(event_run_attempt) is int
        and event_run_attempt > 0
    )
    try:
        repository = api(f"repos/{repo}")
        workflow = api(f"repos/{repo}/actions/workflows/{workflow_file}")
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        subprocess.SubprocessError,
        json.JSONDecodeError,
    ):
        return [[] for _ in status_pages]
    default_branch = (
        repository.get("default_branch") if isinstance(repository, dict) else None
    )
    workflow_id = workflow.get("id") if isinstance(workflow, dict) else None
    workflow_path = f".github/workflows/{workflow_file}"
    if (
        not isinstance(default_branch, str)
        or not default_branch
        or type(workflow_id) is not int
        or workflow_id <= 0
        or workflow.get("path") != workflow_path
    ):
        return [[] for _ in status_pages]

    verified = []
    verified_attempts = {}
    for page in status_pages:
        accepted = []
        for status in page if isinstance(page, list) else ():
            if not isinstance(status, dict):
                continue
            context = CONTEXT.fullmatch(status.get("context", ""))
            digest = DIGEST.fullmatch(status.get("description") or "")
            creator = status.get("creator") or {}
            if (
                context is None
                or digest is None
                or digest.group(3) not in ("created", "edited")
                or context.group(1) not in wanted_comment_ids
                or status.get("state") != "success"
                or creator.get("login") != "github-actions[bot]"
            ):
                continue
            comment_id = int(context.group(1))
            run_id = int(context.group(2))
            attempt = int(context.group(3))
            target_url = (
                f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}"
                f"/{repo}/actions/runs/{run_id}"
            )
            if status.get("target_url") != target_url:
                continue
            attempt_key = (run_id, attempt)
            if attempt_key not in verified_attempts:
                try:
                    run = api(f"repos/{repo}/actions/runs/{run_id}/attempts/{attempt}")
                except (
                    OSError,
                    ValueError,
                    TypeError,
                    KeyError,
                    subprocess.SubprocessError,
                    json.JSONDecodeError,
                ):
                    verified_attempts[attempt_key] = False
                else:
                    verified_attempts[attempt_key] = (
                        isinstance(run, dict)
                        and run.get("id") == run_id
                        and run.get("run_attempt") == attempt
                        and run.get("workflow_id") == workflow_id
                        and run.get("event") == "issue_comment"
                        and run.get("path") == workflow_path
                        and run.get("head_branch") == default_branch
                        and (run.get("head_repository") or {}).get("full_name") == repo
                        and isinstance(run.get("head_sha"), str)
                        and SHA.fullmatch(run["head_sha"]) is not None
                    )
            if not verified_attempts[attempt_key]:
                continue
            is_current_creation = (
                eligible_current_event
                and digest.group(3) == "created"
                and context.group(1) == str(event_comment_id)
                and context.group(2) == str(event_run_id)
                and attempt == event_run_attempt
            )
            # The in-flight exception must match the runner's server event
            # payload byte-for-byte; persisted receipts require the attempt log.
            current_matches = (
                is_current_creation
                and current_clean_comment_event_matches(
                    number,
                    comment_id,
                    run_id,
                    attempt,
                    digest.group(1),
                    digest.group(2),
                    digest.group(3),
                )
            )
            if not current_matches and not has_clean_comment_capture_log(
                repo,
                run_id,
                attempt,
                number,
                comment_id,
                digest.group(1),
                digest.group(2),
                digest.group(3),
                evaluated_head,
            ):
                continue
            accepted.append(status)
        verified.append(accepted)
    return verified


def legacy_human_review_request(run, repo, number, workflow_file=None):
    """Require run-bound workflow source and attempt logs, never nearby comments."""
    if type(number) is not int or number <= 0:
        return False
    if (
        run.get("event") != "issue_comment"
        or run.get("actor", {}).get("type") != "User"
    ):
        return False
    title = run.get("display_title")
    match = None
    if isinstance(title, str):
        match = LEGACY_REVIEW_RUN_TITLE.fullmatch(
            title
        ) or PLAIN_LEGACY_REVIEW_RUN_TITLE.fullmatch(title)
    if match is None or int(match.group(1)) != number:
        return False
    pulls = run.get("pull_requests")
    if not isinstance(pulls, list) or any(
        not isinstance(pull, dict) or pull.get("number") != number for pull in pulls
    ):
        return False
    default_branch = os.environ.get("DEFAULT_BRANCH")
    workflow_file = workflow_file or os.environ.get(
        "REVIEW_GATE_WORKFLOW_FILE", "review-gate.yml"
    )
    source_sha = run.get("head_sha")
    if (
        not isinstance(default_branch, str)
        or not default_branch
        or run.get("head_branch") != default_branch
        or not isinstance(source_sha, str)
        or not SHA.fullmatch(source_sha)
    ):
        return False
    attempt = run.get("run_attempt")
    if type(attempt) is not int or attempt <= 0:
        return False
    if not trusted_legacy_manual_workflow(repo, workflow_file, source_sha):
        return False
    return has_legacy_manual_review_log(repo, run.get("id"), attempt)


def legacy_connector_bot_review_run(run, repo, number, workflow_file=None):
    """Attribute an unassociated legacy bot run only when its title and source agree."""
    if type(number) is not int or number <= 0 or not isinstance(run, dict):
        return False
    actor = run.get("actor")
    if (
        run.get("event") != "issue_comment"
        or not isinstance(actor, dict)
        or type(actor.get("id")) is not int
        or actor["id"] != CONNECTOR_BOT_ID
        or actor.get("login") != CONNECTOR_BOT_LOGIN
        or actor.get("type") != "Bot"
    ):
        return False
    title = run.get("display_title")
    match = (
        PLAIN_LEGACY_REVIEW_RUN_TITLE.fullmatch(title)
        if isinstance(title, str)
        else None
    )
    if match is None or int(match.group(1)) != number:
        return False
    if run.get("pull_requests") != []:
        return False
    default_branch = os.environ.get("DEFAULT_BRANCH")
    workflow_file = workflow_file or os.environ.get(
        "REVIEW_GATE_WORKFLOW_FILE", "review-gate.yml"
    )
    source_sha = run.get("head_sha")
    attempt = run.get("run_attempt")
    if (
        not isinstance(default_branch, str)
        or not default_branch
        or run.get("head_branch") != default_branch
        or not isinstance(source_sha, str)
        or not SHA.fullmatch(source_sha)
        or type(attempt) is not int
        or attempt <= 0
    ):
        return False
    return trusted_legacy_connector_bot_workflow(repo, workflow_file, source_sha)


def completed_gate_runs(repo, workflow, number, start, through, workflow_file=None):
    """Enumerate terminal failures without trusting GitHub's capped search pages."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("invalid census repository")
    if (
        type(workflow) is not int
        or workflow <= 0
        or type(number) is not int
        or number <= 0
    ):
        raise ValueError("invalid census identity")

    def instant(value):
        if not re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z",
            value or "",
        ):
            raise ValueError("invalid census boundary")
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())

    def stamp(value):
        timestamp = datetime.fromtimestamp(value, timezone.utc)  # noqa: UP017
        return timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")

    first, last = instant(start), instant(through)
    if first > last:
        raise ValueError("inverted census interval")

    def scan(event, begin, end):
        endpoint = (
            f"repos/{repo}/actions/workflows/{workflow}/runs?event={event}&status=completed"
            f"&created={stamp(begin)}..{stamp(end)}&per_page=100"
        )
        initial = api(endpoint)
        if not isinstance(initial, dict):
            raise TypeError("invalid completed-run response")
        count = initial.get("total_count")
        if type(count) is not int or count < 0:
            raise ValueError("invalid completed-run count")
        # GitHub caps total_count at 1,000, so equality is ambiguous too.
        # Split before reading pages; otherwise additional runs can be hidden.
        if count >= 1000:
            if end == begin:
                raise ValueError("completed-run interval exceeds GitHub's search cap")
            middle = (begin + end) // 2
            rows = scan(event, begin, middle)
            rows.update(scan(event, middle + 1, end))
            if len(rows) < count:
                raise ValueError("completed-run census changed during partitioning")
            return rows
        pages = api(endpoint, pages=True) if count > 100 else [initial]
        if not isinstance(pages, list) or not pages:
            raise ValueError("missing completed-run pages")
        rows = []
        for page in pages:
            if (
                not isinstance(page, dict)
                or page.get("total_count") != count
                or not isinstance(page.get("workflow_runs"), list)
            ):
                raise ValueError("completed-run census changed or was truncated")
            rows.extend(page["workflow_runs"])
        ids = [item.get("id") for item in rows if isinstance(item, dict)]
        if (
            len(rows) != count
            or len(ids) != count
            or any(type(value) is not int or value <= 0 for value in ids)
            or len(set(ids)) != count
        ):
            raise ValueError("incomplete completed-run census")
        for run in rows:
            if (
                run.get("event") != event
                or run.get("workflow_id") != workflow
                or run.get("status") != "completed"
            ):
                raise ValueError("completed run changed identity or state")
            created = instant(run.get("created_at"))
            if not begin <= created <= end:
                raise ValueError("completed run outside census interval")
            pulls = run.get("pull_requests")
            if not isinstance(pulls, list) or any(
                not isinstance(pull, dict)
                or type(pull.get("number")) is not int
                or pull["number"] <= 0
                for pull in pulls
            ):
                raise ValueError("invalid completed-run PR associations")
            # actor is the original server-recorded workflow trigger. Keep
            # triggering_actor well-formed too, but do not use it for source
            # classification: a human can rerun a connector-originated bot run.
            validate_run_actor(run.get("actor"), "actor")
            validate_run_actor(run.get("triggering_actor"), "triggering actor")
        return {run["id"]: run for run in rows}

    found = set()
    for event in ("issue_comment", "pull_request_target"):
        for run in scan(event, first, last).values():
            pulls = run["pull_requests"]
            if pulls and all(pull["number"] != number for pull in pulls):
                continue
            # Successful requests and jobs skipped by the trusted event filter
            # do not need native receipts. Unknown/adverse conclusions do.
            if run.get("conclusion") not in ("success", "skipped"):
                # Current origin markers are direct proof. A legacy title is
                # exempt only if its default-branch workflow revision and
                # server-attested actor prove the guarded human or connector path.
                if event == "issue_comment":
                    if is_non_connector_issue_comment_run(
                        run, number
                    ) or legacy_human_review_request(run, repo, number, workflow_file):
                        continue
                    title = run.get("display_title")
                    bot_match = (
                        PLAIN_LEGACY_REVIEW_RUN_TITLE.fullmatch(title)
                        if isinstance(title, str)
                        else None
                    )
                    if (
                        bot_match is not None
                        and int(bot_match.group(1)) != number
                        and legacy_connector_bot_review_run(
                            run, repo, int(bot_match.group(1)), workflow_file
                        )
                    ):
                        continue
                found.add(run["id"])
    return sorted(found)


def trusted_native_attempt(
    record,
    repo,
    run_id,
    attempt,
    workflow_id,
    workflow_file,
    default_branch,
    source_head,
):
    """Bind one retry attempt to the same trusted source run."""
    return (
        isinstance(record, dict)
        and record.get("id") == run_id
        and record.get("run_attempt") == attempt
        and record.get("workflow_id") == workflow_id
        and record.get("event") == "issue_comment"
        and record.get("path") == f".github/workflows/{workflow_file}"
        and record.get("head_branch") == default_branch
        and (record.get("head_repository") or {}).get("full_name") == repo
        and record.get("head_sha") == source_head
        and isinstance(source_head, str)
        and SHA.fullmatch(source_head) is not None
    )


def native_capture_proof(repo, head, number, run_id, workflow_id, workflow_file=None):
    """Recover an event only from a trusted default-branch workflow run.

    Status contexts share the Actions bot identity across candidate and trusted
    workflows. Therefore a matching context, description, and run URL do not
    authenticate the writer; bind the receipt to the immutable workflow-run
    record GitHub serves for that exact run ID.
    """
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) or not SHA.fullmatch(
        head
    ):
        raise ValueError("invalid native capture repository or head")
    if (
        type(number) is not int
        or number <= 0
        or type(run_id) is not int
        or run_id <= 0
        or type(workflow_id) is not int
        or workflow_id <= 0
    ):
        raise ValueError("invalid native capture identity")
    workflow_file = workflow_file or os.environ.get(
        "REVIEW_GATE_WORKFLOW_FILE", "review-gate.yml"
    )
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.yml", workflow_file):
        raise ValueError("invalid native capture workflow file")
    run = api(f"repos/{repo}/actions/runs/{run_id}")
    repository = api(f"repos/{repo}")
    if (
        not isinstance(run, dict)
        or run.get("id") != run_id
        or run.get("workflow_id") != workflow_id
        or run.get("event") != "issue_comment"
        or run.get("path") != f".github/workflows/{workflow_file}"
        or not isinstance(repository, dict)
        or not isinstance(repository.get("default_branch"), str)
        or run.get("head_branch") != repository["default_branch"]
        or (run.get("head_repository") or {}).get("full_name") != repo
        or not isinstance(run.get("head_sha"), str)
        or not SHA.fullmatch(run["head_sha"])
        or type(run.get("run_attempt")) is not int
        or run["run_attempt"] <= 0
    ):
        return False
    attempt = run["run_attempt"]
    capture_logged = has_native_capture_log(repo, run_id, attempt, number)
    # A rerun keeps the workflow_run ID but advances run_attempt. If a later
    # attempt fails before writing its acknowledgement, retain a capture that
    # was already recorded in an earlier, independently verified attempt.
    for earlier_attempt in range(attempt - 1, 0, -1):
        if capture_logged:
            break
        earlier = api(f"repos/{repo}/actions/runs/{run_id}/attempts/{earlier_attempt}")
        if not trusted_native_attempt(
            earlier,
            repo,
            run_id,
            earlier_attempt,
            workflow_id,
            workflow_file,
            repository["default_branch"],
            run["head_sha"],
        ):
            return False
        capture_logged = has_native_capture_log(repo, run_id, earlier_attempt, number)
    if not capture_logged:
        return False
    root = f"repos/{repo}"
    owner, name = repo.split("/")
    heads = {head}
    timeline = api(f"{root}/issues/{number}/timeline?per_page=100", pages=True)
    if not isinstance(timeline, list) or any(
        not isinstance(page, list) for page in timeline
    ):
        raise ValueError("invalid PR timeline pages")
    for item in (item for page in timeline for item in page):
        if not isinstance(item, dict):
            raise TypeError("invalid PR timeline item")
        if item.get("event") == "committed":
            commit = item.get("sha")
            if not isinstance(commit, str) or not SHA.fullmatch(commit):
                raise ValueError("invalid committed PR head")
            heads.add(commit)
    # Force-pushed heads may no longer be in the current commit list. GitHub's
    # immutable before/after refs, not comment prose, extend the proof boundary.
    query = (
        "query($endCursor: String) { repository(owner:"
        + json.dumps(owner)
        + ", name:"
        + json.dumps(name)
        + ") { pullRequest(number:"
        + str(number)
        + ") { timelineItems(first:100, after:$endCursor, "
        "itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]) {"
        " nodes { ... on HeadRefForcePushedEvent { beforeCommit { oid } "
        "afterCommit { oid } } }"
        " pageInfo { hasNextPage endCursor } } } } }"
    )
    force_pages = api("graphql", pages=True, query=query)
    if not isinstance(force_pages, list) or not force_pages:
        raise ValueError("missing force-push history")
    for page in force_pages:
        if page.get("errors"):
            raise ValueError("could not read force-push history")
        history = page["data"]["repository"]["pullRequest"]["timelineItems"]
        for item in history["nodes"]:
            for key in ("beforeCommit", "afterCommit"):
                commit = (item.get(key) or {}).get("oid")
                if not isinstance(commit, str) or not SHA.fullmatch(commit):
                    raise ValueError("a historical PR head is no longer provable")
                heads.add(commit)
    if force_pages[-1]["data"]["repository"]["pullRequest"]["timelineItems"][
        "pageInfo"
    ]["hasNextPage"]:
        raise ValueError("incomplete force-push history")
    context = f"review-native-event/{run_id}"
    receipt_heads = {head}
    historical = sorted(heads - {head})
    for start in range(0, len(historical), 40):
        aliases = {
            f"h{i}": commit for i, commit in enumerate(historical[start : start + 40])
        }
        fields = " ".join(
            f'{alias}: object(oid:"{commit}") {{ ... on Commit '
            "{ oid status { contexts { context } } } }"
            for alias, commit in aliases.items()
        )
        query = (
            "{ repository(owner:"
            + json.dumps(owner)
            + ", name:"
            + json.dumps(name)
            + ") { "
            + fields
            + " } }"
        )
        response = api("graphql", query=query)
        if response.get("errors"):
            raise ValueError("could not inventory native capture receipts")
        objects = response["data"]["repository"]
        for alias, commit in aliases.items():
            obj = objects.get(alias)
            if not isinstance(obj, dict) or obj.get("oid") != commit:
                raise ValueError("a historical PR commit is no longer provable")
            status = obj.get("status")
            if status is not None:
                contexts = status.get("contexts")
                if not isinstance(contexts, list):
                    raise ValueError("invalid native receipt inventory")
                if any(item.get("context") == context for item in contexts):
                    receipt_heads.add(commit)
    found = False
    for commit in sorted(receipt_heads):
        pages = api(f"{root}/commits/{commit}/statuses?per_page=100", pages=True)
        if not isinstance(pages, list) or any(
            not isinstance(page, list) for page in pages
        ):
            raise ValueError("invalid native receipt pages")
        records = [
            status
            for page in pages
            for status in page
            if status.get("context") == context
        ]
        if not records:
            if commit != head:
                raise ValueError("an inventoried native receipt disappeared")
            continue
        latest = max(
            records,
            key=lambda item: (
                item.get("created_at", item.get("updated_at", "")),
                item.get("id", 0),
            ),
        )
        creator = latest.get("creator") or {}
        if (
            latest.get("state") != "success"
            or latest.get("description")
            != f"Review event {run_id} recorded for PR #{number}"
            or creator.get("login") != "github-actions[bot]"
            or creator.get("type") != "Bot"
            or latest.get("target_url")
            != f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{repo}/actions/runs/{run_id}"
        ):
            return False
        found = True
    return found


def receipt_records(status_pages):
    records = {}
    known = {}
    for page in status_pages:
        for status in page:
            match = CONTEXT.fullmatch(status.get("context", ""))
            digest = DIGEST.fullmatch(status.get("description") or "")
            creator = status.get("creator") or {}
            if (
                match
                and digest
                and status.get("state") == "success"
                and digest.group(3) in ("created", "edited")
                and creator.get("login") == "github-actions[bot]"
            ):
                comment_id = match.group(1)
                event_run_id = match.group(2)
                event_run_attempt = match.group(3)
                body_updated_at = digest.group(2)
                record = {
                    "digest": digest.group(1),
                    "bodyUpdatedAt": body_updated_at,
                    "action": digest.group(3) or "legacy",
                    "eventRunId": event_run_id,
                    "eventRunAttempt": event_run_attempt,
                }
                if record["action"] == "created":
                    known.setdefault(comment_id, set()).add(record["digest"])
                records.setdefault(comment_id, []).append(record)
    return records, known


def annotate(comments, status_pages, eligible_event_run_id="", eligible_comment_id=""):
    records, known = receipt_records(status_pages)
    for page in comments:
        for comment in page:
            body = comment.get("body") or ""
            digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
            comment_id = str(comment.get("id"))
            comment_updated_at = comment.get("updated_at")
            event_revisions = {}
            for receipt in records.get(comment_id, ()):
                event_revisions.setdefault(receipt["eventRunId"], set()).add(
                    (receipt["digest"], receipt["bodyUpdatedAt"], receipt["action"])
                )
            # A workflow rerun preserves GITHUB_RUN_ID and increments only
            # GITHUB_RUN_ATTEMPT. Those receipts attest the same immutable
            # event payload, so collapse attempts before testing revision
            # uniqueness. Conflicting revisions under one event ID are
            # anomalous and fail closed.
            matching_events = [
                event_run_id
                for event_run_id, revisions in event_revisions.items()
                if len(revisions) == 1
                and next(iter(revisions)) == (digest, comment_updated_at, "created")
            ]
            has_conflicted_event = any(
                len(revisions) != 1 for revisions in event_revisions.values()
            )
            same_revision_edit = any(
                receipt["action"] == "edited"
                and receipt["bodyUpdatedAt"] == comment_updated_at
                for receipt in records.get(comment_id, ())
            )
            if eligible_event_run_id:
                event_is_current = (
                    comment_id == str(eligible_comment_id)
                    and str(eligible_event_run_id) in matching_events
                )
            else:
                # Audits may reuse a persisted creation receipt only while the
                # exact created revision remains live. An edit observed in the
                # same GitHub timestamp second makes that receipt ambiguous.
                event_is_current = bool(matching_events)
            version_is_current = (
                event_is_current and not has_conflicted_event and not same_revision_edit
            )
            comment["review_gate_creation_receipt"] = version_is_current
            comment["review_gate_has_creation_receipt"] = comment_id in known
    return comments


def creation_receipt(status_pages, comment_id, body):
    if not comment_id or body is None:
        return False
    body_digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    _, known = receipt_records(status_pages)
    return body_digest in known.get(str(comment_id), set())


def has_creation_receipt(status_pages, comment_id):
    if not comment_id:
        return False
    _, known = receipt_records(status_pages)
    return str(comment_id) in known


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--native-run-id", type=int)
    parser.add_argument("--native-workflow-id", type=int)
    parser.add_argument("--pr", type=int)
    parser.add_argument("--completed-gate-workflow-id", type=int)
    parser.add_argument("--census-from")
    parser.add_argument("--census-through")
    parser.add_argument("--prior-id", default="")
    parser.add_argument("--prior-body-base64", default="")
    parser.add_argument("--prior-updated-at", default="")
    parser.add_argument("--event-run-id", default="")
    parser.add_argument("--event-comment-id", default="")
    parser.add_argument("--event-run-attempt", type=int)
    parser.add_argument("--attest-legacy-human-run", action="store_true")
    parser.add_argument("--attest-legacy-bot-run", action="store_true")
    parser.add_argument(
        "--workflow-file",
        default=os.environ.get("REVIEW_GATE_WORKFLOW_FILE", "review-gate.yml"),
    )
    args = parser.parse_args()
    if args.attest_legacy_human_run:
        try:
            payload = json.load(sys.stdin)
            if not isinstance(payload, dict):
                raise TypeError("legacy attestation input must be an object")
            matched = legacy_human_review_request(
                payload.get("run"), args.repo, args.pr, args.workflow_file
            )
        except (ValueError, TypeError, KeyError) as error:
            print(
                f"could not safely attest legacy human review run: {error}",
                file=sys.stderr,
            )
            return 2
        return 0 if matched else 3
    if args.attest_legacy_bot_run:
        try:
            payload = json.load(sys.stdin)
            if not isinstance(payload, dict):
                raise TypeError("legacy attestation input must be an object")
            matched = legacy_connector_bot_review_run(
                payload.get("run"), args.repo, args.pr, args.workflow_file
            )
        except (ValueError, TypeError, KeyError) as error:
            print(
                f"could not safely attest legacy connector bot run: {error}",
                file=sys.stderr,
            )
            return 2
        return 0 if matched else 3
    if args.completed_gate_workflow_id is not None:
        print(
            json.dumps(
                completed_gate_runs(
                    args.repo,
                    args.completed_gate_workflow_id,
                    args.pr,
                    args.census_from,
                    args.census_through,
                    args.workflow_file,
                )
            )
        )
        return 0
    if args.native_run_id is not None:
        if args.native_workflow_id is None:
            parser.error("--native-run-id requires --native-workflow-id")
        return (
            0
            if native_capture_proof(
                args.repo,
                args.head,
                args.pr,
                args.native_run_id,
                args.native_workflow_id,
                args.workflow_file,
            )
            else 3
        )
    try:
        prior_body = base64.b64decode(args.prior_body_base64, validate=True).decode(
            "utf-8"
        )
    except (ValueError, UnicodeDecodeError) as error:
        parser.error(f"prior comment body is not valid UTF-8 base64: {error}")
    comments = json.load(sys.stdin)
    result = subprocess.run(
        [
            os.environ.get("REVIEW_GATE_GH") or "gh",
            "api",
            f"repos/{args.repo}/commits/{args.head}/statuses?per_page=100",
            "--paginate",
            "--slurp",
        ],
        text=True,
        capture_output=True,
        check=True,
    )
    status_pages = json.loads(result.stdout or "[]")
    status_pages = authenticated_clean_comment_statuses(
        status_pages,
        comments,
        args.repo,
        args.pr or 0,
        args.workflow_file,
        args.event_run_id,
        args.event_comment_id,
        args.event_run_attempt,
        args.prior_id,
        args.head,
    )
    records, known = receipt_records(status_pages)
    prior_digest = hashlib.sha256(prior_body.encode("utf-8")).hexdigest()
    prior_body_receipt = any(
        record["digest"] == prior_digest
        and record["bodyUpdatedAt"] == args.prior_updated_at
        for record in records.get(args.prior_id, ())
    )
    prior_body_hash_receipt = any(
        record["digest"] == prior_digest for record in records.get(args.prior_id, ())
    )
    print(
        json.dumps(
            {
                "comments": annotate(
                    comments, status_pages, args.event_run_id, args.event_comment_id
                ),
                "priorCreationReceipt": prior_digest in known.get(args.prior_id, set()),
                "priorBodyReceipt": prior_body_receipt,
                "priorBodyHashReceipt": prior_body_hash_receipt,
                "priorHasCreationReceipt": args.prior_id in known,
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
