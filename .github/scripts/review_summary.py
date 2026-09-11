"""Read the connector's regular-review summary; never write GitHub state."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timedelta
from typing import Any

BOT = "chatgpt-codex-connector[bot]"
HEADER = "<!-- codex-pull-request-review-summary -->\n\n## Codex Review Summary\n"
SHA = re.compile(r"[0-9a-f]{40}")
COMMIT = re.compile(r"`([0-9a-f]{7,40})`")
COMPLETED = re.compile(
    r'✅ \*\*Completed\*\* <relative-time datetime="(?P<at>[^"<>]+)">'
    r"(?P=at)</relative-time>"
)


def timestamp(value: Any) -> datetime | None:
    """Accept only explicit UTC timestamps, including fractional seconds."""
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z", value
    ):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def code_rows(body: str) -> tuple[tuple[str, ...], ...]:
    """Recognize only the connector envelope and its regular Code Review rows."""
    if not body.startswith(HEADER):
        return ()
    rows = []
    for line in body.splitlines():
        cells = tuple(cell.strip() for cell in line.split("|"))
        if len(cells) >= 2 and cells[1] == "📝 **Code Review**":
            rows.append(cells)
    return tuple(rows)


def matches_head(rows: tuple[tuple[str, ...], ...], head: str) -> bool:
    """A prefix is sufficient to revoke a gate, but cannot grant approval."""
    return any(
        len(row) == 6
        and (match := COMMIT.fullmatch(row[3])) is not None
        and head.startswith(match[1])
        for row in rows
    )


def changed_for_head(body: str, previous: str, action: str, head: str) -> bool:
    """Ignore edits to independent Security Review rows in the same comment."""
    current_rows, previous_rows = code_rows(body), code_rows(previous)
    relevant = matches_head(current_rows, head) or matches_head(previous_rows, head)
    return relevant and (action != "edited" or current_rows != previous_rows)


def completed_for_head(body: str, action: str, head: str) -> bool:
    """Only omit a persistent invalidation; the evaluator must still approve."""
    rows = code_rows(body)
    return (
        action != "deleted"
        and len(rows) == 1
        and matches_head(rows, head)
        and (completed := COMPLETED.fullmatch(rows[0][2])) is not None
        and timestamp(completed["at"]) is not None
    )


def api(path: str, *, paginate: bool = False) -> Any:
    """Use the existing workflow identity for bounded, read-only metadata calls."""
    command = ["gh", "api", "--method", "GET", path]
    if paginate:
        command.extend(("--paginate", "--slurp"))
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    value = json.loads(result.stdout)
    return [item for page in value for item in page] if paginate else value


def records(
    comments: list[dict[str, Any]],
    reactions: list[dict[str, Any]],
    head: str,
    resolved: dict[str, str],
) -> list[dict[str, Any]]:
    """Pair one current-head summary with a fresh, authenticated bot reaction."""
    candidates = [
        comment
        for comment in comments
        if comment.get("user", {}).get("login") == BOT
        and isinstance(comment.get("body"), str)
        and matches_head(code_rows(comment["body"]), head)
    ]
    result = []
    for comment in candidates:
        updated = timestamp(comment.get("updated_at"))
        comment_id = comment.get("id")
        if updated is None or type(comment_id) is not int or comment_id <= 0:
            raise ValueError("Malformed trusted review summary metadata")
        record = {
            "at": updated.isoformat().replace("+00:00", "Z"),
            "id": f"review-summary-{comment_id}-0",
            "source": "review_summary",
            "clean": False,
        }
        result.append(record)
        rows = code_rows(comment["body"])
        # Conflicting summaries/duplicate regular rows are not affirmative proof.
        if len(candidates) != 1 or len(rows) != 1 or len(rows[0]) != 6:
            continue
        row = rows[0]
        commit = COMMIT.fullmatch(row[3])
        completed = COMPLETED.fullmatch(row[2])
        if commit is None or completed is None or resolved.get(commit[1]) != head:
            continue
        completed_at = timestamp(completed["at"])
        if completed_at is None or completed_at >= updated + timedelta(seconds=1):
            continue
        eligible = [
            reaction
            for reaction in reactions
            if reaction.get("user", {}).get("login") == BOT
            and reaction.get("content") == "+1"
            and type(reaction.get("id")) is int
            and reaction["id"] > 0
            and (created := timestamp(reaction.get("created_at"))) is not None
            and created > completed_at
        ]
        if not eligible:
            continue
        reaction = max(eligible, key=lambda value: value["created_at"])
        record.update(
            at=reaction["created_at"],
            id=f"review-summary-{comment_id}-{reaction['id']}",
            completed_at=completed["at"],
            clean=True,
        )
    return result


def collect(repo: str, number: str, head: str, bot: str) -> list[dict[str, Any]]:
    """Resolve every abbreviated commit through GitHub before accepting it."""
    if bot != BOT:
        return []
    comments = api(f"repos/{repo}/issues/{number}/comments?per_page=100", paginate=True)
    prefixes = {
        match[1]
        for comment in comments
        if comment.get("user", {}).get("login") == BOT
        and isinstance(comment.get("body"), str)
        for row in code_rows(comment["body"])
        if len(row) == 6
        and (match := COMMIT.fullmatch(row[3])) is not None
        and head.startswith(match[1])
    }
    if not prefixes:
        return []
    resolved = {
        prefix: api(f"repos/{repo}/commits/{prefix}").get("sha", "")
        for prefix in prefixes
    }
    reactions = api(
        f"repos/{repo}/issues/{number}/reactions?per_page=100", paginate=True
    )
    return records(comments, reactions, head, resolved)


def main() -> None:
    """Run the read-only workflow adapter or classify one comment delivery."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("records", "classify"))
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    if not SHA.fullmatch(args.head):
        parser.error("A full current-head SHA is required")
    if args.operation == "classify":
        body = os.environ.get("EVENT_COMMENT_BODY", "")
        action = os.environ.get("EVENT_ACTION", "")
        value = {
            "regular": changed_for_head(
                body,
                os.environ.get("EVENT_PREVIOUS_COMMENT_BODY", ""),
                action,
                args.head,
            ),
            "completed": completed_for_head(body, action, args.head),
        }
    else:
        repo, number = os.environ["REPO"], os.environ["PR_NUMBER"]
        if not re.fullmatch(
            r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo
        ) or not re.fullmatch(r"[1-9][0-9]*", number):
            parser.error("A repository and positive pull request number are required")
        value = collect(repo, number, args.head, os.environ["REVIEW_BOT_EVENT_LOGIN"])
    print(json.dumps(value))


if __name__ == "__main__":
    main()
