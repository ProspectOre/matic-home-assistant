"""Exercise summary evidence and the trusted workflow's actual decision code."""

import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).parents[1]
MODULE_PATH = ROOT / ".github/scripts/review_summary.py"
SPEC = importlib.util.spec_from_file_location("review_summary", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
summary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(summary)
HEAD = "01234567" * 5
PREFIX = HEAD[:7]
COMPLETED = (
    '✅ **Completed** <relative-time datetime="2026-01-01T00:00:01.250Z">'
    "2026-01-01T00:00:01.250Z</relative-time>"
)


def body(status=COMPLETED, commit=PREFIX):
    """Synthetic connector-generated envelope, without private PR content."""
    return (
        summary.HEADER
        + "\nThis comment shows the latest Codex review activity.\n\n"
        + "| Review | Status | Commit | Review trigger |\n"
        + "| --- | --- | --- | --- |\n"
        + f"| 📝 **Code Review** | {status} | `{commit}` | New commits |\n"
    )


@pytest.fixture
def evidence():
    """A completed current-head review followed by its positive bot reaction."""
    return (
        [
            {
                "id": 11,
                "user": {"login": summary.BOT},
                "body": body(),
                "updated_at": "2026-01-01T00:00:02Z",
            }
        ],
        [
            {
                "id": 22,
                "user": {"login": summary.BOT},
                "content": "+1",
                "created_at": "2026-01-01T00:00:03Z",
            }
        ],
        {PREFIX: HEAD},
    )


def evaluate(evidence):
    comments, reactions, resolved = evidence
    return summary.records(comments, reactions, HEAD, resolved)


def test_current_review_needs_both_summary_and_fresh_reaction(evidence):
    assert evaluate(evidence) == [
        {
            "at": "2026-01-01T00:00:03Z",
            "id": "review-summary-11-22",
            "source": "review_summary",
            "completed_at": "2026-01-01T00:00:01.250Z",
            "clean": True,
        }
    ]
    evidence[1].clear()
    assert evaluate(evidence)[0]["clean"] is False


@pytest.mark.parametrize(
    "mutation",
    [
        "other_author",
        "old_head",
        "security_only",
        "no_envelope",
        "no_review_row",
    ],
)
def test_unrelated_metadata_does_not_supply_regular_evidence(evidence, mutation):
    comment = evidence[0][0]
    if mutation == "other_author":
        comment["user"]["login"] = "someone-else"
    elif mutation == "old_head":
        comment["body"] = body(commit="b" * 40)
    elif mutation == "security_only":
        comment["body"] = body().replace("Code Review", "Security Review")
    elif mutation == "no_envelope":
        comment["body"] = "Quoted:\n" + body()
    else:
        comment["body"] = summary.HEADER
    assert evaluate(evidence) == []


@pytest.mark.parametrize(
    "mutation",
    [
        "running",
        "failed",
        "unknown_status",
        "duplicate_row",
        "duplicate_comment",
        "unresolved_prefix",
        "wrong_resolved_commit",
        "other_reaction_author",
        "old_reaction",
        "ambiguous_same_second",
        "negative_reaction",
        "bad_reaction_id",
        "invalid_reaction_time",
        "future_completion",
        "mismatched_display_time",
    ],
)
def test_incomplete_or_ambiguous_evidence_fails_closed(evidence, mutation):
    comment, reaction = evidence[0][0], evidence[1][0]
    if mutation in {"running", "failed", "unknown_status"}:
        comment["body"] = body(status=mutation)
    elif mutation == "duplicate_row":
        comment["body"] += body().splitlines()[-1]
    elif mutation == "duplicate_comment":
        evidence[0].append({**comment, "id": 12})
    elif mutation == "unresolved_prefix":
        evidence[2].clear()
    elif mutation == "wrong_resolved_commit":
        evidence[2][PREFIX] = "b" * 40
    elif mutation == "other_reaction_author":
        reaction["user"]["login"] = "someone-else"
    elif mutation == "old_reaction":
        reaction["created_at"] = "2025-12-31T23:59:59Z"
    elif mutation == "ambiguous_same_second":
        reaction["created_at"] = "2026-01-01T00:00:01Z"
    elif mutation == "negative_reaction":
        reaction["content"] = "-1"
    elif mutation == "bad_reaction_id":
        reaction["id"] = True
    elif mutation == "invalid_reaction_time":
        reaction["created_at"] = "tomorrow"
    elif mutation == "future_completion":
        comment["body"] = body().replace("00:00:01.250Z", "00:00:09Z")
    else:
        comment["body"] = body().replace(
            ">2026-01-01T00:00:01.250Z", ">2026-01-01T00:00:02Z"
        )
    assert all(record["clean"] is False for record in evaluate(evidence))


def test_security_changes_do_not_invalidate_completed_code_review(evidence):
    security = "| 🔒 **Security Review** | Running | `b123456` | Comment |\n"
    previous, current = body(), body() + security
    assert not summary.changed_for_head(current, previous, "edited", HEAD)
    evidence[0][0].update(body=current, updated_at="2026-01-01T00:00:10Z")
    assert evaluate(evidence)[0]["clean"] is True


@pytest.mark.parametrize(
    "current,previous,action",
    [
        (body(), "", "created"),
        (body(), body(status="Running"), "edited"),
        (body(status="Running"), body(), "edited"),
        ("removed", body(), "edited"),
        (body(), "", "deleted"),
        (body(commit="b" * 40), body(), "edited"),
    ],
)
def test_changes_to_regular_review_revoke_current_head(current, previous, action):
    assert summary.changed_for_head(current, previous, action, HEAD)


@pytest.mark.parametrize("value", [None, 2, "yesterday", "2026-99-99T00:00:00Z"])
def test_invalid_timestamps_are_not_ordered_as_evidence(value):
    assert summary.timestamp(value) is None


def test_malformed_trusted_metadata_raises(evidence):
    evidence[0][0]["updated_at"] = "invalid"
    with pytest.raises(ValueError, match="Malformed trusted"):
        evaluate(evidence)


def test_collect_resolves_full_commit_and_scopes_reactions_to_pr(evidence, monkeypatch):
    calls = []

    def api(path, *, paginate=False):
        calls.append((path, paginate))
        if "/comments?" in path:
            return evidence[0]
        if "/reactions?" in path:
            return evidence[1]
        if path == f"repos/example/project/commits/{PREFIX}":
            return {"sha": HEAD}
        pytest.fail(f"Unexpected endpoint: {path}")

    monkeypatch.setattr(summary, "api", api)
    assert summary.collect("example/project", "42", HEAD, summary.BOT)[0]["clean"]
    assert calls == [
        ("repos/example/project/issues/42/comments?per_page=100", True),
        (f"repos/example/project/commits/{PREFIX}", False),
        ("repos/example/project/issues/42/reactions?per_page=100", True),
    ]
    calls.clear()
    assert summary.collect("example/project", "42", HEAD, "github-actions[bot]") == []
    assert not calls


def workflow_run(name, job, step=0):
    config = yaml.safe_load((ROOT / ".github/workflows" / name).read_text())
    return config["jobs"][job]["steps"][step]["run"]


def shell_function(script, name):
    match = re.search(rf"(?ms)^{name}\(\) \{{\n.*?^\}}", script)
    assert match is not None
    return match[0]


@pytest.mark.parametrize(
    "change,expected",
    [
        ("completed", "true"),
        ("running", "true"),
        ("security_edit", "false"),
        ("reader_unavailable", "true"),
    ],
)
def test_actual_comment_router_recognizes_current_summary(tmp_path, change, expected):
    fixture = tmp_path / "gh"
    fixture.write_text(
        "#!/usr/bin/env python3\nimport json,os,sys\n"
        "from pathlib import Path\n"
        "if any('/contents/' in a for a in sys.argv):\n"
        " if os.environ.get('FAIL_READER') == 'true': raise SystemExit(1)\n"
        " print(Path(os.environ['SUMMARY_MODULE']).read_text())\n"
        "elif any('/pulls/42' in a for a in sys.argv):\n"
        " print(json.dumps({'head':{'sha':os.environ['TEST_HEAD']}}))\n"
        "else: raise SystemExit('Unexpected GitHub call')\n"
    )
    fixture.chmod(0o700)
    current = body(status="Running") if change == "running" else body()
    previous = (
        body() if change in {"security_edit", "running"} else body(status="Running")
    )
    if change == "security_edit":
        current += "| 🔒 **Security Review** | Running | `b123456` | Comment |\n"
    output = tmp_path / "output"
    env = dict(
        os.environ,
        PATH=f"{tmp_path}:{os.environ['PATH']}",
        EVENT_COMMENT_AUTHOR=summary.BOT,
        REVIEW_BOT_EVENT_LOGIN=summary.BOT,
        EVENT_COMMENT_BODY=current,
        EVENT_PREVIOUS_COMMENT_BODY=previous,
        EVENT_ACTION="edited",
        PR_NUMBER="42",
        REPO="example/project",
        REVIEW_WORKFLOW_SHA="c" * 40,
        RUNNER_TEMP=str(tmp_path),
        GITHUB_OUTPUT=str(output),
        TEST_HEAD=HEAD,
        SUMMARY_MODULE=str(MODULE_PATH),
        FAIL_READER=str(change == "reader_unavailable").lower(),
    )
    script = workflow_run("review-regular-comment.yml", "classify")
    # The repository's fixed PATH prefixes still precede our isolated fake gh.
    script = script.replace('export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"', ":")
    subprocess.run(["bash", "-c", script], env=env, check=True, capture_output=True)
    values = dict(line.split("=", 1) for line in output.read_text().splitlines())
    assert values["regular"] == expected
    # Both paths revoke the gate; a completion edit need not require a new run.
    assert values["clean"] == ("true" if change == "completed" else "false")
    if expected == "true":
        assert values["head_sha"] == HEAD


@pytest.mark.parametrize(
    "active,updated,security,expected",
    [
        (True, "2026-01-01T00:00:01Z", False, 1),
        (False, "2026-01-01T00:00:01Z", False, 0),
        (True, "2026-01-01T00:00:01Z", True, 0),
    ],
)
def test_summary_cannot_skip_unresolved_bot_findings(
    tmp_path, active, updated, security, expected
):
    review_body = "### Security Review" if security else "Review on the short head"
    event = {
        "data": {
            "repository": {
                "pullRequest": {
                    "reviewThreads": {
                        "nodes": [
                            {
                                "isResolved": not active,
                                "isOutdated": False,
                                "comments": {
                                    "nodes": [
                                        {
                                            "author": {
                                                "login": summary.BOT.removesuffix(
                                                    "[bot]"
                                                )
                                            },
                                            "replyTo": None,
                                            "originalCommit": {"oid": HEAD},
                                            "commit": {"oid": HEAD},
                                            "updatedAt": updated,
                                            "pullRequestReview": {
                                                "databaseId": 7,
                                                "body": review_body,
                                            },
                                        }
                                    ]
                                },
                            }
                        ]
                    }
                }
            }
        }
    }
    data = tmp_path / "graphql.json"
    data.write_text(json.dumps(event))
    script = shell_function(
        workflow_run("review-gate.yml", "evaluate"), "regular_review_thread_summary"
    )
    env = dict(
        os.environ,
        FIXTURE=str(data),
        head_sha=HEAD,
        REVIEW_BOT_LOGIN=summary.BOT.removesuffix("[bot]"),
        review_owner="example",
        review_repo="project",
        pr_number="42",
    )
    result = subprocess.run(
        [
            "bash",
            "-c",
            'gh() { cat "$FIXTURE"; }\n'
            + script
            + '\nregular_review_thread_summary "[]" true',
        ],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    groups = json.loads(result.stdout)
    assert sum(group["active_count"] for group in groups) == expected


@pytest.mark.parametrize(
    "finding_at,active,invalidation,accepted",
    [
        ("", 0, "", True),
        ("2026-01-01T00:00:01Z", 0, "", False),
        ("2026-01-01T00:00:01Z", 1, "", False),
        ("2026-01-01T00:00:04Z", 0, "", False),
        ("", 0, "2026-01-01T00:00:04Z", False),
    ],
)
def test_actual_gate_decision_preserves_finding_and_invalidation_fences(
    tmp_path, evidence, finding_at, active, invalidation, accepted
):
    (tmp_path / "evidence").write_text(
        json.dumps(
            {
                "deliveries": evaluate(evidence),
                "review_ids": [],
            }
        )
    )
    groups = (
        []
        if not finding_at
        else [
            {
                "id": "7",
                "total_count": 1,
                "active_count": active,
                "latest_at": finding_at,
            }
        ]
    )
    (tmp_path / "threads").write_text(json.dumps(groups))
    run = workflow_run("review-gate.yml", "evaluate")
    script = "\n".join(
        shell_function(run, name)
        for name in ("read_gate_snapshot", "require_clean_regular_snapshot")
    )
    script += """
regular_evidence() { cat "$FIXTURES/evidence"; }
regular_review_thread_summary() { cat "$FIXTURES/threads"; }
latest_regular_issue_comment_at() { printf '%s' "$INVALIDATION"; }
latest_regular_review_invalidation_at() { :; }
base_change_marker_exists() { return 1; }
stamp_status() { :; }
stamp_review_gate() { echo "$1"; }
snapshot="$(read_gate_snapshot)"
require_clean_regular_snapshot "$snapshot"
echo accepted
"""
    result = subprocess.run(
        ["bash", "-c", script],
        check=True,
        capture_output=True,
        text=True,
        env=dict(
            os.environ,
            FIXTURES=str(tmp_path),
            INVALIDATION=invalidation,
            head_prefix=HEAD[:10],
            REVIEW_REVIEW_CONTEXT="review-gate-regular-review",
        ),
    )
    assert ("accepted" in result.stdout.splitlines()) is accepted


def test_workflows_fetch_only_their_trusted_definition_commit():
    for name, job in (
        ("review-gate.yml", "evaluate"),
        ("review-regular-comment.yml", "classify"),
        ("review-gate-audit.yml", "audit"),
    ):
        config = yaml.safe_load((ROOT / ".github/workflows" / name).read_text())
        step = config["jobs"][job]["steps"][0]
        assert step["env"]["REVIEW_WORKFLOW_SHA"] == "${{ github.workflow_sha }}"
        assert "review_summary.py?ref=$REVIEW_WORKFLOW_SHA" in step["run"]
        assert "review_summary.py?ref=$head_sha" not in step["run"]


@pytest.mark.parametrize(
    "scenario,withdraws",
    [
        ("late_reaction", True),
        ("unchanged", False),
        ("reaction_removed", True),
        ("security_edit", False),
        ("reader_unavailable", True),
        ("reopened_finding", True),
    ],
)
def test_actual_audit_reconciles_summary_lifecycle(
    tmp_path, evidence, scenario, withdraws
):
    comments, reactions, _ = evidence
    if scenario == "reaction_removed":
        reactions.clear()
    if scenario == "security_edit":
        comments[0]["body"] += (
            "| 🔒 **Security Review** | Running | `b123456` | Comment |\n"
        )
        comments[0]["updated_at"] = "2026-01-01T00:00:09Z"
    status = {
        "context": "review-gate",
        "state": "success",
        "updated_at": "2026-01-01T00:00:04Z",
        "description": "Clean regular review; evidence review-summary:11:22",
    }
    if scenario == "late_reaction":
        status.update(
            state="pending",
            updated_at="2026-01-01T00:00:00Z",
            description="Waiting for the regular review",
        )
    threads = []
    if scenario == "reopened_finding":
        threads = [
            {
                "isResolved": False,
                "isOutdated": False,
                "comments": {
                    "nodes": [
                        {
                            "originalCommit": {"oid": HEAD},
                            "replyTo": None,
                            "author": {"login": summary.BOT.removesuffix("[bot]")},
                            "pullRequestReview": {
                                "state": "COMMENTED",
                                "body": "Review using a newer envelope",
                                "author": {"login": summary.BOT.removesuffix("[bot]")},
                                "commit": {"oid": HEAD},
                            },
                        }
                    ]
                },
            }
        ]
    payloads = {
        "comments": comments,
        "reactions": reactions,
        "statuses": [status],
        "threads": threads,
        "head": HEAD,
    }
    (tmp_path / "payloads.json").write_text(json.dumps(payloads))
    fake_gh = tmp_path / "gh"
    fake_gh.write_text("""#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
base=Path(os.environ['FIXTURES'])
d=json.loads((base/'payloads.json').read_text())
a=sys.argv[1:]
if a[:2] == ['workflow','run']:
    with (base/'writes').open('a') as f: f.write('dispatch\\n')
    raise SystemExit(0)
if a[0] != 'api': raise SystemExit('Unexpected command')
path=next((x for x in a if x.startswith('repos/') or x=='graphql'),'')
if '/statuses/' in path:
    with (base/'writes').open('a') as f: f.write('pending\\n')
    raise SystemExit(0)
if '/contents/.github/scripts/' in path:
    if os.environ.get('FAIL_READER') == 'true': raise SystemExit(1)
    print(Path(os.environ['SUMMARY_MODULE']).read_text())
    raise SystemExit(0)
if '/contents/.github/workflows/' in path: value={}
elif '/pulls/42' in path: value={'head':{'sha':d['head']}}
elif '/commits/' in path and '/statuses?' not in path: value={'sha':d['head']}
elif '/comments?' in path: value=d['comments']
elif '/reactions?' in path: value=d['reactions']
elif '/statuses?' in path: value=d['statuses']
elif path=='graphql':
    if any('reviewThreads(' in x for x in a):
        value={'data':{'repository':{'pullRequest':{'reviewThreads':{'nodes':d['threads']}}}}}
    else: value={'data':{'repository':{'pullRequest':{'reviews':{'nodes':[]}}}}}
else: raise SystemExit('Unexpected API path '+path)
if '--slurp' in a: value=[value]
print(json.dumps(value))
""")
    fake_gh.chmod(0o700)
    script = workflow_run("review-gate-audit.yml", "audit").replace(
        'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"', ":"
    )
    env = dict(
        os.environ,
        PATH=f"{tmp_path}:{os.environ['PATH']}",
        REPO="example/project",
        PR_NUMBER="42",
        REVIEW_GATE_CONTEXT="review-gate",
        REVIEW_COMMENT_CONTEXT="review-gate-regular-comment",
        REVIEW_BOT_EVENT_LOGIN=summary.BOT,
        REVIEW_BOT_LOGIN=summary.BOT.removesuffix("[bot]"),
        REVIEW_WORKFLOW_SHA="c" * 40,
        WORKFLOW_REF="main",
        RUNNER_TEMP=str(tmp_path),
        FIXTURES=str(tmp_path),
        SUMMARY_MODULE=str(MODULE_PATH),
        FAIL_READER=str(scenario == "reader_unavailable").lower(),
    )
    process = subprocess.run(
        ["bash", "-c", script], env=env, capture_output=True, text=True
    )
    assert process.returncode == (1 if scenario == "reader_unavailable" else 0), (
        process.stderr
    )
    writes = (
        (tmp_path / "writes").read_text().splitlines()
        if (tmp_path / "writes").exists()
        else []
    )
    assert ("pending" in writes) is withdraws
    assert ("dispatch" in writes) is (withdraws and scenario != "reader_unavailable")
