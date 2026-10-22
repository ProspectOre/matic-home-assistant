#!/usr/bin/env python3
"""Fail when a repository's workflows drift from the delivery contract.

Usage: delivery-contract.py [REPO_ROOT]
Reads REPO_ROOT/.github/delivery-contract.json:
  {"workflows": {"ci.yml": "ci", "release.yml": "dispatch", "nightly.yml": "nightly"},
   "hosted": false, "dependabot": true}
Kinds: ci (pull_request + push + concurrency), dispatch (workflow_dispatch /
workflow_call / repository_dispatch only), nightly (one schedule, at most one file).
hosted:false requires every runs-on to be a list containing self-hosted.
Contract: wiki workflows/delivery-contract.md. Stdlib only; no YAML parser needed.
"""

import json
import re
import sys
from pathlib import Path

KINDS = {"ci", "dispatch", "nightly"}
DISPATCH_EVENTS = {"workflow_dispatch", "workflow_call", "repository_dispatch"}
KEY = re.compile(r"""^\s*(?:-\s*)?(['"]?)([A-Za-z_]+)\1\s*(?::.*)?$""")
RUNS_ON = re.compile(r"""^(\s*)(['"]?)runs-on\2\s*:\s*(.*)$""")


def uncommented(text):
    """Return the text without comment lines."""
    lines = text.splitlines()
    return "\n".join(line for line in lines if not line.lstrip().startswith("#"))


def flow_items(value):
    """Return the items of a one-line flow list `[a, 'b']` (None if not one)."""
    if not (value.startswith("[") and value.endswith("]")):
        return None
    items = [t.strip().strip("'\"") for t in value[1:-1].split(",")]
    return [t for t in items if t]


def block_items(lines, start, indent):
    """Return the `- item` children deeper than indent (None on any other line)."""
    items = []
    for nxt in lines[start:]:
        if nxt.strip() == "":
            continue
        width = len(nxt) - len(nxt.lstrip(" "))
        if width <= indent:
            break
        m = re.match(r"^\s*-\s*(['\"]?)([^#'\"]*?)\1\s*(#.*)?$", nxt)
        if not m:
            return None
        items.append(m.group(2).strip())
    return items


def triggers(text):
    """Return the event names under the top-level `on:` key (None if unparseable)."""
    lines = uncommented(text).splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"""^(?:on|'on'|"on"):\s*(.*)$""", line)
        if not m:
            continue
        inline = m.group(1).split("#", 1)[0].strip()
        if inline:
            names = flow_items(inline) if inline.startswith("[") else [inline]
            if names is None or not names:
                return None
            if all(re.fullmatch(r"[A-Za-z_]+", n) for n in names):
                return set(names)
            return None
        found = set()
        indent = None
        for nxt in lines[i + 1 :]:
            if nxt.strip() == "":
                continue
            width = len(nxt) - len(nxt.lstrip(" "))
            if width == 0 and not nxt.startswith("-"):
                break
            if indent is None:
                indent = width
            if width > indent:
                continue
            k = KEY.match(nxt)
            if width < indent or not k:
                return None
            found.add(k.group(2))
        return found or None
    return None


def runs_on_violations(text):
    """Return runs-on lines whose value is not a list containing self-hosted."""
    lines = uncommented(text).splitlines()
    bad = []
    for i, line in enumerate(lines):
        if "runs-on" not in line:
            continue
        m = RUNS_ON.match(line)
        if not m:
            bad.append(line.strip())  # flow mapping or a shape we cannot read
            continue
        value = m.group(3).split(" #", 1)[0].strip()
        if value:
            items = flow_items(value)
        else:
            items = block_items(lines, i + 1, len(m.group(1)))
        if not items or "self-hosted" not in items:
            bad.append(value or "<block>")
    return bad


def check(root):
    root = Path(root)
    gh = root / ".github"
    errors = []
    try:
        contract = json.loads((gh / "delivery-contract.json").read_text())
    except (OSError, ValueError) as exc:
        return [f".github/delivery-contract.json unreadable: {exc}"]
    allowed = contract.get("workflows", {})
    for name, kind in allowed.items():
        if kind not in KINDS:
            errors.append(f"{name}: unknown kind {kind!r}")
    workflows = gh / "workflows"
    found = workflows.glob("*.y*ml") if workflows.is_dir() else ()
    present = sorted(p.name for p in found)
    unlisted = [n for n in present if n not in allowed]
    errors.extend(f"{n}: not in delivery-contract.json" for n in unlisted)
    missing = [n for n in allowed if n not in present]
    errors.extend(f"{n}: listed but missing" for n in missing)
    nightly = 0
    for name in present:
        kind = allowed.get(name)
        if kind is None:
            continue
        text = (gh / "workflows" / name).read_text()
        on = triggers(text)
        if on is None:
            errors.append(f"{name}: cannot parse triggers")
            on = set()
        if "pull_request_target" in on or "pull_request_target" in text:
            errors.append(f"{name}: pull_request_target is forbidden")
        if not contract.get("hosted") and runs_on_violations(text):
            errors.append(f"{name}: runs-on must be a list containing self-hosted")
        if kind == "ci":
            if not {"pull_request", "push"} <= on:
                errors.append(f"{name}: ci must run on pull_request and push")
            if not re.search(r"^concurrency:", text, re.MULTILINE):
                errors.append(f"{name}: ci needs top-level concurrency")
            if "schedule" in on:
                errors.append(f"{name}: ci must not be scheduled")
        elif kind == "dispatch":
            extra = on - DISPATCH_EVENTS
            if extra:
                errors.append(f"{name}: dispatch workflow also runs on {sorted(extra)}")
        elif kind == "nightly":
            nightly += 1
            if "schedule" not in on:
                errors.append(f"{name}: nightly needs a schedule")
            if not {"schedule", "workflow_dispatch"} >= on:
                errors.append(f"{name}: nightly runs beyond schedule/workflow_dispatch")
    if nightly > 1:
        errors.append("more than one nightly workflow")
    deps = [d for d in (gh / "dependabot.yml", gh / "dependabot.yaml") if d.exists()]
    if contract.get("dependabot", True) and not deps:
        errors.append("dependabot.yml: missing")
    for dep in deps if contract.get("dependabot", True) else ():
        text = uncommented(dep.read_text())
        intervals = re.findall(r"interval:\s*['\"]?([a-z]+)", text)
        if any(i != "monthly" for i in intervals):
            errors.append(f"{dep.name}: every interval must be monthly")
        blocks = len(re.findall(r"^\s*-?\s*package-ecosystem:", text, re.MULTILINE))
        if len(re.findall(r"^\s*groups:", text, re.MULTILINE)) < blocks:
            errors.append(f"{dep.name}: every ecosystem needs a groups: entry")
        limits = re.findall(r"open-pull-requests-limit:\s*(\d+)", text)
        if len(limits) < blocks or any(int(x) > 2 for x in limits):
            limit_msg = "every ecosystem needs open-pull-requests-limit <= 2"
            errors.append(f"{dep.name}: {limit_msg}")
    return errors


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    errors = check(root)
    for e in errors:
        print(f"delivery-contract: {e}", file=sys.stderr)
    summary = f"{len(errors)} violation(s)" if errors else "ok"
    print(f"delivery-contract: {summary}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
