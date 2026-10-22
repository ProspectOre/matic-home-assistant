#!/usr/bin/env python3
"""Find AI attribution in commit messages and pull-request text.

Usage: attribution.py   (in a GitHub Actions pull_request run)
Checks the PR's commits (git log BASE..HEAD), title, body and branch name from
$GITHUB_EVENT_PATH. Commit messages and the title land on main (squash merges
copy every commit message and add a co-author trailer for every other commit
author), so a hit there or an AI commit identity fails a same-repository PR; a fork
PR only gets warnings, which the owner clears from the squash message at merge.
Body and branch hits are warnings: the branch is deleted at merge, and some
agent platforms re-append a body footer that no edit can remove.
The review runner imports `findings`; public repositories vendor this file as
.github/scripts/attribution.py. Policy: wiki workflows/attribution.md.
Stdlib only.
"""

import json
import os
import re
import subprocess
import sys

TRAILER_TOOLS = (
    r"claude|anthropic|openai|chatgpt|codex|copilot|gemini|jules|cursor|devin|"
    r"aider|windsurf|codeium|openclaw|amazon q|kiro"
)
WRITERS = (
    r"claude(?: code)?|chatgpt|openai|codex|copilot|gemini(?: cli)?|windsurf|"
    r"openclaw|aider|cursor (?:agent|ai)|devin ai|"
    r"an? (?:ai|llm)(?: agent| assistant| model)?"
)
PATTERNS = (
    # Trailers: AI co-authors, and trailer keys that only exist to credit a tool.
    re.compile(
        r"^[ \t]*(?:co-authored-by|signed-off-by|reviewed-by|helped-by)[ \t]*:"
        rf"[^\n]*\b(?:{TRAILER_TOOLS})\b[^\n]*",
        re.I | re.M,
    ),
    re.compile(
        r"^[ \t]*(?:assisted|generated|ai-assisted|ai-generated|made-with)-by"
        r"[ \t]*:[^\n]*",
        re.I | re.M,
    ),
    # Footers and sign-offs: "Generated with [Claude Code](...)", "Created by Codex".
    re.compile(
        r"\b(?:generated|created|written|authored|co-authored|made|built|produced"
        r"|drafted)[ \t]+(?:with|by|using|via)[ \t]+(?:\[|the[ \t]+)?"
        rf"(?:{WRITERS})\b[^\n]*",
        re.I,
    ),
    # Agent session and task links.
    re.compile(
        r"https?://(?:www\.)?(?:claude\.ai/code|claude\.com/claude-code|"
        r"chatgpt\.com/codex|jules\.google(?:\.com)?|app\.devin\.ai)\S*",
        re.I,
    ),
)
IDENTITY = re.compile(rf"\b(?:{TRAILER_TOOLS})\b", re.I)
BRANCH = re.compile(rf"^(?:{TRAILER_TOOLS.replace('amazon q|', '')}|ai)[/_-]", re.I)


def findings(text):
    """The attribution snippets in text, in order of appearance."""
    hits = sorted(
        (m.start(), m.group(0).strip())
        for p in PATTERNS
        for m in p.finditer(text or "")
    )
    return [hit[:120] for _, hit in hits]


def ai_identity(name, email):
    """True when a commit author or committer is an AI tool, not a person."""
    return bool(IDENTITY.search(f"{name or ''} <{email or ''}>"))


def ai_branch(name):
    return bool(BRANCH.match(name or ""))


def commits(base, head, number):
    """(sha, author/committer identities, message) for base..head.

    Fetches only commit objects, no trees or blobs.
    """
    subprocess.run(
        [
            "git",
            "fetch",
            "--no-tags",
            "--quiet",
            "--filter=tree:0",
            "origin",
            base,
            f"+refs/pull/{number}/head:refs/remotes/attribution/head",
        ],
        check=True,
    )
    out = subprocess.run(
        [
            "git",
            "log",
            "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e",
            f"{base}..{head}",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    entries = [
        entry.strip("\n").split("\0", 5) for entry in out.split("\x1e") if "\0" in entry
    ]
    return [
        (sha, ((an, ae), (cn, ce)), message) for sha, an, ae, cn, ce, message in entries
    ]


def main():
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as event:
        pr = json.load(event).get("pull_request")
    if not pr:
        print("attribution: not a pull request; nothing to check")
        return 0
    blocking = []
    for sha, identities, message in commits(
        pr["base"]["sha"], pr["head"]["sha"], pr["number"]
    ):
        blocking += [(f"commit {sha[:12]}", hit) for hit in findings(message)]
        blocking += [
            (f"commit {sha[:12]} identity", f"{name} <{email}>")
            for name, email in dict.fromkeys(identities)
            if ai_identity(name, email)
        ]
    blocking += [("PR title", hit) for hit in findings(pr["title"])]
    notes = [("PR description", hit) for hit in findings(pr.get("body"))]
    if ai_branch(pr["head"]["ref"]):
        notes.append(("branch name", pr["head"]["ref"]))
    fork = (pr["head"].get("repo") or {}).get("full_name") != pr["base"]["repo"][
        "full_name"
    ]
    for where, hit in blocking:
        print(f"::{'warning' if fork else 'error'}::AI attribution in {where}: {hit}")
    for where, hit in notes:
        print(f"::warning::AI attribution in {where}: {hit}")
    if blocking and not fork:
        print("attribution: reword the commits or title (policy: no AI attribution).")
        return 1
    print("attribution: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
