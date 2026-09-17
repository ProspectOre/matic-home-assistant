#!/usr/bin/env python3
"""Bounded event envelopes. The receiver must authenticate the sensor first."""
import argparse
import base64
from datetime import datetime
import json
import os
import re
from pathlib import Path
import sys

MARKER = "REVIEW_EVENT_V1:"
IGNORED = "REVIEW_EVENT_IGNORED_V1"
BOT = {"id": 199175422, "login": "chatgpt-codex-connector[bot]", "type": "Bot"}
SHA = re.compile(r"[0-9a-f]{40}")
LIMIT = 60_000
ACTIONS = {"pull_request_review": {"submitted", "edited", "dismissed"},
           "pull_request_review_comment": {"created", "edited", "deleted"}}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def positive(value):
    return type(value) is int and value > 0


def sha(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def compact(value):
    require(isinstance(value, dict), "envelope must be an object")
    raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    require(len(raw) <= LIMIT, "envelope exceeds 60KB")
    return raw


def capture(event, event_name):
    repo, pr = event["repository"], event["pull_request"]
    key = "review" if event_name == "pull_request_review" else "comment"
    actor = event.get(key, {}).get("user", {})
    # Filter irrelevant actors before copying or bounding attacker-controlled
    # review bodies. The receiver records this as a successful no-op receipt.
    if any(actor.get(k) != v for k, v in BOT.items()):
        return None
    out = {"event_name": event_name,
           "repository": {k: repo[k] for k in ("id", "full_name")},
           "pull_request": {"number": pr["number"], "head": {"sha": pr["head"]["sha"]},
                            "base": {k: pr["base"][k] for k in ("sha", "ref")}},
           "action": event["action"]}
    fields = (("id", "commit_id", "submitted_at", "body") if key == "review" else
              ("id", "original_commit_id", "pull_request_review_id", "updated_at", "body"))
    out[key] = {k: event[key][k] for k in fields}
    if key == "comment" and "in_reply_to_id" in event[key]:
        out[key]["in_reply_to_id"] = event[key]["in_reply_to_id"]
    out[key]["user"] = {k: event[key]["user"][k] for k in BOT}
    if "body" in event.get("changes", {}):
        out["changes"] = {"body": {"from": event["changes"]["body"]["from"]}}
    compact(out)
    return out


def encode(event):
    return MARKER + base64.b64encode(compact(event)).decode("ascii")


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(
        r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z", value), "invalid timestamp")
    datetime.fromisoformat(value.replace("Z", "+00:00"))


def validate(e, repo, repo_id, pr, head):
    compact(e)
    require(positive(repo_id) and positive(pr) and sha(head), "invalid expected binding")
    try:
        require(e["repository"]["full_name"] == repo and type(e["repository"]["id"]) is int
                and e["repository"]["id"] == repo_id, "repository binding mismatch")
        request = e["pull_request"]
        require(type(request["number"]) is int and request["number"] == pr
                and request["head"]["sha"] == head, "PR/head binding mismatch")
        require(sha(request["base"]["sha"]) and isinstance(request["base"]["ref"], str)
                and request["base"]["ref"], "invalid base")
        event = e["event_name"]
        require(event in ACTIONS and e["action"] in ACTIONS[event], "unsupported event/action")
        key = "review" if event == "pull_request_review" else "comment"
        require(("comment" if key == "review" else "review") not in e, "ambiguous event object")
        item, actor = e[key], e[key]["user"]
        require(positive(item["id"]) and positive(actor["id"]), "invalid item/actor id")
        require(isinstance(actor["login"], str) and actor["type"] in ("User", "Bot"), "invalid actor")
        if not all(actor.get(k) == v for k, v in BOT.items()):
            return False
        if key == "review":
            require(sha(item["commit_id"]) and
                    (item["body"] is None or isinstance(item["body"], str)), "invalid review")
            timestamp(item["submitted_at"])
            if item["commit_id"] != head:
                return False
        else:
            require(sha(item["original_commit_id"]) and positive(item["pull_request_review_id"])
                    and isinstance(item["body"], str), "invalid inline comment")
            if "in_reply_to_id" in item and item["in_reply_to_id"] is not None:
                require(positive(item["in_reply_to_id"]), "invalid inline reply origin")
            timestamp(item["updated_at"])
            if item["original_commit_id"] != head:
                return False
        if e["action"] == "edited":
            require(isinstance(e["changes"]["body"]["from"], str), "missing previous body")
    except (KeyError, TypeError, AttributeError) as exc:
        raise ValueError("malformed event fields") from exc
    return True


def extract(text):
    # A command echoed into the log is not an event record. Only a complete
    # output line, optionally prefixed by GitHub timestamp, is eligible.
    lines = [re.sub(r"^\d{4}-\d\d-\d\dT\S+ ", "", line)
             for line in text.splitlines()]
    ignored = [line for line in lines if line == IGNORED]
    records = [line[len(MARKER):] for line in lines if line.startswith(MARKER)]
    require(len(ignored) + len(records) == 1, "expected exactly one event marker")
    if ignored:
        return None
    require(len(records[0]) <= 4 * ((LIMIT + 2) // 3), "encoded envelope too large")
    try:
        raw = base64.b64decode(records[0], validate=True)
        require(len(raw) <= LIMIT, "envelope too large")
        obj = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("invalid event marker") from exc
    compact(obj)
    return obj


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("capture")
    command = sub.add_parser("extract")
    command.add_argument("log")
    command.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.cmd == "capture":
        event = capture(json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text()),
                        os.environ["GITHUB_EVENT_NAME"])
        print(IGNORED if event is None else encode(event))
    else:
        event = extract(Path(args.log).read_text())
        Path(args.output).write_bytes(IGNORED.encode() if event is None else compact(event))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
