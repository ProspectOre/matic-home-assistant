#!/usr/bin/env python3
"""Classify immutable review-comment bodies by their own result section."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

REGULAR_HEADING = re.compile(
    r"\A[ \t]*(?:@|#{1,6}[ \t]+(?:[^A-Za-z0-9\r\n]+[ \t]+)?)?"
    r"codex[ \t]+review(?:[ \t]*:|[ \t]|$)|"
    r"\A[ \t]*(?:#{1,6}[ \t]+)?review result(?:[ \t]*:|[ \t]|$)|"
    r"\A[ \t]*\*{0,2}(?:<sub>)*!\[P[0-3][ \t]+badge\]\([^)\r\n]+\)(?:</sub>)*",
    re.IGNORECASE,
)
SECURITY_HEADING = re.compile(
    r"\A[ \t]*(?:#{1,6}[ \t]+(?:[^A-Za-z0-9\r\n]+[ \t]+)?)?"
    r"(?:codex[ \t-]+)?security(?:[ \t-]+)review"
    r"(?:[ \t]*:|[ \t]*[^A-Za-z0-9\s][^\r\n]*|[ \t]*$)",
    re.IGNORECASE,
)
PRIORITY_RESULT = re.compile(r"\A[ \t]*\[P[0-3]\](?:[ \t]|$)", re.I)
RESULT_HEADING = re.compile(
    r"(?:" + REGULAR_HEADING.pattern + r")|(?:" + SECURITY_HEADING.pattern + r")",
    re.IGNORECASE,
)
REVIEWED_COMMIT = re.compile(
    r"(?im)^[ \t]*\*{0,2}reviewed commit:\*{0,2}[ \t]*`([0-9a-f]{10}|[0-9a-f]{40})`"
)
AVAILABILITY = re.compile(
    r"\A[ \t\r\n]*(?:@|#{1,6}[ \t]+(?:[^A-Za-z0-9\r\n]+[ \t]+)?)?"
    r"(?:codex[ \t]+review|review(?:[ \t]+result)?)(?:[ \t]*:|[ \t]|\r?\n|$)[ \t\r\n]*"
    r"(?:you have reached (?:your )?(?:codex )?usage limits"
    r"(?: for (?:codex )?(?:code )?reviews?)?[.!]?"
    r"(?:\.[ \t]+you can see your limits in the \[codex usage dashboard\]"
    r"\(https://chatgpt\.com/codex/cloud/settings/usage\)\.)?"
    r"(?:\r?\nTo continue using code reviews, add credits to your account and "
    r"enable them "
    r"for code reviews in your "
    r"\[settings\]\(https://chatgpt\.com/codex/cloud/settings/code-review\)\.)?|"
    r"(?:codex[ \t]+)?review(?:[ \t]+result)?(?:[ \t]+is)?[ \t]+"
    r"(?:currently[ \t]+)?(?:unavailable|at[ \t]+capacity|rate[ \t-]*limited)"
    r"(?: due(?: to)? usage quota)?[.!]?|"
    r"(?:currently[ \t]+)?(?:unavailable|at[ \t]+capacity|rate[ \t-]*limited)"
    r"(?: due(?: to)? usage quota)?[.!]?|"
    r"(?:could not|unable to)[ \t]+(?:start|complete|perform)[ \t]+"
    r"(?:the[ \t]+)?(?:codex[ \t]+)?review[.!]?|try again later[.!]?)"
    r"[ \t\r\n]*\Z",
    re.I,
)
CLEAN_SUMMARY = (
    r"(?:no (?:issues?|findings?|bugs?|vulnerabilities?) found|no major issues|"
    r"no blocking issues|didn.t find any (?:major )?issues|"
    r"did not find any (?:major )?issues)"
)
CLEAN_SALUTATION = (
    r"(?:What shall we delve into next\?|You['\u2019]re on a roll\.|Delightful!|"
    r"Nice work!|"
    r"Already looking forward to the next diff\.|Another round soon, please!|"
    r"More of your lovely PRs please\.|Hooray!|Swish!|Bravo\.|"
    r"Can['\u2019]t wait for the next one!|Keep it up!|Keep them coming!|Breezy!|"
    r"Chef['\u2019]s kiss[.!]?|:tada:)"
)
CLEAN_REACTION = r"(?::\+1:|👍|:rocket:|:rocket!|🚀)"
KNOWN_REGULAR_CLEAN_RESULT = re.compile(
    r"\A[ \t]*(?:"
    + CLEAN_SUMMARY
    + r")[.!]?(?:[ \t]+"
    + CLEAN_SALUTATION
    + r")?[ \t]*(?:"
    + CLEAN_REACTION
    + r")?[ \t]*\Z",
    re.I,
)
KNOWN_SECURITY_CLEAN_RESULT = re.compile(
    r"\A[ \t]*(?:security review completed[.!]?[ \t\r\n]+)?"
    r"(?:no (?:security )?issues (?:were )?found(?: in this pull request)?|"
    r"didn.t find any (?:major )?issues(?: in this pull request)?)[.!]?[ \t]*\Z",
    re.I,
)
KNOWN_REVIEW_FOOTER = re.compile(
    r"(?is)\A\s*<details>\s*<summary>\s*(?:\u2139\uFE0F\s*)?about codex in github"
    r"\s*</summary>\s*<br\s*/?>\s*"
    r"\[your team has set up codex to review pull requests in this repo\]"
    r"\(https://chatgpt\.com/codex/cloud/settings/general\)\.\s*"
    r"reviews are triggered when you\s*-\s*open a pull request for review\s*"
    r"-\s*mark a draft as ready\s*-\s*comment \"@codex review\"\.\s*"
    r"if codex has suggestions, it will comment; otherwise it will react with "
    r"(?:👍|:\+1:)\.\s*"
    r"codex can also answer questions or update the pr\.\s*"
    r"try commenting \"@codex address that feedback\"\.\s*</details>\s*\Z"
)
KNOWN_SECURITY_FOOTER = re.compile(
    r"(?is)\A\s*_only the user who started this review can view the report in "
    r"codex\._\s*"
    r"<details>\s*<summary>\s*(?:\u2139\uFE0F\s*)?about codex security "
    r"reviews in github"
    r"\s*</summary>\s*<br\s*/?>\s*"
    r"this is an experimental codex feature\. (?:security )?reviews are triggered "
    r"when:\s*"
    r"-\s*you comment \"@codex security review\"\s*"
    r"-\s*a regular code review gets triggered \(for example, \"@codex review\" "
    r"or when a pr (?:is|was) opened\),"
    r" and you(?:\u2019|'|&#39;)re opted in so security review runs alongside code "
    r"review\s*"
    r"once complete, codex will leave suggestions, or a comment if no findings "
    r"(?:were|are) found\.\s*</details>\s*\Z"
)
EXPLICIT_ADVERSE = re.compile(
    r"\bP[0-3]\b|\bfinding(?:s)?[ \t]+"
    r"(?:observed|remain(?:s|ing)?|reported|persist(?:s|ing)?|unresolved)\b|"
    r"\b(?:vulnerab\w*|unsafe|exploitable|defect|bug|regression|security risk|"
    r"issue remains)[^\r\n]*"
    r"\b(?:remain(?:s|ing)?|persist(?:s|ing)?|unresolved|exploitable|exposed)\b|"
    r"codex-security-review-finding:v1",
    re.I,
)
SECURITY_MARKER = re.compile(
    r"(?im)(?:^|\n)[ \t]*<!--[ \t]*codex-security-review-finding:v1[ \t]*-->[ \t]*\r?$"
)
INLINE_SECURITY_MARKER = re.compile(
    r"(?im)(?:^|\n)[ \t]*\[P[0-3]\][^\r\n]*[ \t]+"
    r"<!--[ \t]*codex-security-review-finding:v1[ \t]*-->[ \t]*\r?$"
)
SECURITY_SEVERITY = re.compile(r"(?im)(?:^|\n)[ \t]*\[P[0-3]\]")
SECURITY_REPORT_LINK = re.compile(r"\[view security finding report\]\(", re.I)
COORDINATOR_PRELUDE = re.compile(
    r"\A[ \t\r\n]*@codex review[ \t]*\r?\n[ \t\r\n]*"
    r"(?:Review current head `(?P<display_head>[0-9a-f]{40})`\."
    r"(?: Report concrete correctness, security, and regression defects with their "
    r"triggering conditions\."
    r" Assess related cases together; omit style-only preferences\.)?"
    r"[ \t]*\r?\n[ \t\r\n]*)?"
    r"<!--[ \t]*review-request:v2[ \t]+head=(?P<head>[0-9a-f]{40})[ \t]+"
    r"base=[0-9a-f]{40}[ \t]*-->[ \t]*(?:\r?\n|$)",
    re.I | re.S,
)
COORDINATOR_METADATA = re.compile(
    r"\A[ \t\r\n]*(?:(?:Retry reason:[^\r\n]*|"
    r"Root-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}|"
    r"Root-cause diagnosis:[ \t]*\r?\n[ \t]*- rootCause:[^\r\n]*\r?\n"
    r"[ \t]*- changes:[^\r\n]*\r?\n[ \t]*- validation:[^\r\n]*)"
    r"[ \t\r\n]*)*\Z",
    re.I,
)
SECURITY_MARKER_IN_CODE = re.compile(r"`[^`]*`")
SECURITY_MARKER_COMMENT = re.compile(
    r"(?is)<!--[ \t]*codex-security-review-finding:v1[ \t]*-->"
)


def _coordinator_body(body: str) -> tuple[str, str | None]:
    match = COORDINATOR_PRELUDE.match(body)
    if not match:
        return body, None
    rest = body[match.end() :]
    # Metadata is the prefix before the first recognized result heading. Do not
    # let a malformed request marker supply a fallback commit to a section.
    lines = rest.splitlines()
    start = next(
        (
            i
            for i, line in enumerate(lines)
            if RESULT_HEADING.match(line)
            or PRIORITY_RESULT.match(line)
            or AVAILABILITY.fullmatch(line)
            or SECURITY_MARKER.fullmatch(line)
            or INLINE_SECURITY_MARKER.fullmatch(line)
        ),
        len(lines),
    )
    metadata = "\n".join(lines[:start])
    valid_metadata = not (
        not COORDINATOR_METADATA.fullmatch(metadata)
        or re.search(r"\bP[0-3]\b", metadata, re.I)
        or (
            SECURITY_MARKER_COMMENT.search(SECURITY_MARKER_IN_CODE.sub("", metadata))
            and not re.search(
                r"(?is)\A[ \t\r\n]*(?:Retry reason:[^\r\n]*\r?\n[ \t]*)*"
                r"Root-cause diagnosis:[ \t]*\r?\n[ \t]*- rootCause:[^\r\n]*"
                r"codex-security-review-finding:v1[^\r\n]*\r?\n[ \t]*- changes:[^\r\n]*"
                r"\r?\n[ \t]*- validation:[^\r\n]*[ \t\r\n]*\Z",
                metadata,
                re.I,
            )
        )
    )
    if not valid_metadata:
        marker_prefix = lines[:start]
        marker_only = all(
            not line.strip()
            or SECURITY_MARKER.fullmatch(line)
            or INLINE_SECURITY_MARKER.fullmatch(line)
            for line in marker_prefix
        )
        if not (
            marker_only
            and any(line.strip() for line in marker_prefix)
            and start < len(lines)
            and SECURITY_HEADING.match(lines[start])
        ):
            return body, None
        return "\n".join(lines), match.group("head").lower()
    return "\n".join(lines[start:]), match.group("head").lower()


def _raw_sections(body: str) -> list[tuple[str, str]]:
    lines = body.splitlines()
    starts: list[int] = []
    kinds: dict[int, str] = {}
    for i, line in enumerate(lines):
        if RESULT_HEADING.match(line):
            starts.append(i)
            kinds[i] = "security" if SECURITY_HEADING.match(line) else "regular"
        elif PRIORITY_RESULT.match(line):
            previous_start = starts[-1] if starts else 0
            previous = "\n".join(lines[previous_start:i])
            marker_start = i
            while marker_start > previous_start and (
                not lines[marker_start - 1].strip()
                or SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                or INLINE_SECURITY_MARKER.fullmatch(lines[marker_start - 1])
            ):
                marker_start -= 1
            marker_text = "\n".join(lines[marker_start:i])
            marker_only = bool(marker_text.strip()) and all(
                not candidate.strip()
                or SECURITY_MARKER.fullmatch(candidate)
                or INLINE_SECURITY_MARKER.fullmatch(candidate)
                for candidate in lines[marker_start:i]
            )
            # A priority list remains inside its heading until that result is
            # complete. A bound result or standalone clean summary ends it.
            inline_security = bool(INLINE_SECURITY_MARKER.search(line))
            if (
                (
                    inline_security
                    and (
                        not starts
                        or REVIEWED_COMMIT.search(previous)
                        or _standalone_regular_clean(previous)
                    )
                )
                or not starts
                or REVIEWED_COMMIT.search(previous)
                or _standalone_regular_clean(previous)
                or _standalone_security_clean(previous)
                or marker_only
            ):
                kind = (
                    "security"
                    if inline_security
                    or marker_only
                    or (
                        starts
                        and kinds[starts[-1]] == "security"
                        and (
                            REVIEWED_COMMIT.search(previous)
                            or not _standalone_security_clean(previous)
                        )
                    )
                    else "unheaded"
                )
                starts.append(i)
                kinds[i] = kind
    if not starts:
        return [("unheaded", body)]

    attached_starts: dict[int, int] = {}
    for index, start in enumerate(starts):
        previous_start = starts[index - 1] if index else 0
        marker_start = start
        while marker_start > previous_start and (
            not lines[marker_start - 1].strip()
            or SECURITY_MARKER.fullmatch(lines[marker_start - 1])
            or (
                INLINE_SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                and not PRIORITY_RESULT.match(lines[marker_start - 1])
            )
        ):
            marker_start -= 1
        marker_run = lines[marker_start:start]
        if (
            any(line.strip() for line in marker_run)
            and all(
                not line.strip()
                or SECURITY_MARKER.fullmatch(line)
                or INLINE_SECURITY_MARKER.fullmatch(line)
                for line in marker_run
            )
            and (SECURITY_HEADING.match(lines[start]) or kinds[start] == "security")
        ):
            attached_starts[start] = marker_start
            kinds[start] = "security"
    unconsumed_prefix = lines[: attached_starts.get(starts[0], starts[0])]
    result: list[tuple[str, str]] = []
    if any(line.strip() for line in unconsumed_prefix):
        # A result heading cannot erase preceding adverse evidence. Keep the
        # prefix independently bound; missing metadata remains fail-closed.
        result.append(("unheaded", "\n".join(unconsumed_prefix)))
    for index, start in enumerate(starts):
        next_start = starts[index + 1] if index + 1 < len(starts) else len(lines)
        end = attached_starts.get(next_start, next_start)
        text_start = attached_starts.get(start, start)
        result.append((kinds[start], "\n".join(lines[text_start:end])))
    return result


def _target_ref(section: str, request_head: str | None) -> str:
    refs = [match.group(1).lower() for match in REVIEWED_COMMIT.finditer(section)]
    if len(set(refs)) > 1:
        # Multiple different reviewed commits in one result section do not
        # identify a single safe destination for status history.
        return "__unbound__"
    if refs:
        return refs[-1]
    return request_head or "__unbound__"


def _without_heading(kind: str, section: str) -> str:
    lines = section.splitlines()
    if not lines:
        return section
    heading = REGULAR_HEADING if kind == "regular" else SECURITY_HEADING
    match = heading.match(lines[0])
    if match:
        lines[0] = lines[0][match.end() :]
    return "\n".join(lines)


def _without_known_review_footer(text: str) -> str:
    match = re.search(r"(?is)(?:\A|\r?\n)([ \t]*<details>.*?</details>[ \t]*)\Z", text)
    if match and KNOWN_REVIEW_FOOTER.fullmatch(match.group(1).strip()):
        return text[: match.start()].rstrip()
    return text


def _without_known_security_footer(text: str) -> str:
    text = text.rstrip()
    match = re.search(
        r"(?is)(?:\A|\r?\n)"
        r"([ \t]*_only the user who started this review.*?</details>[ \t]*)\Z",
        text,
    )
    if match and KNOWN_SECURITY_FOOTER.fullmatch(match.group(1).strip()):
        return text[: match.start()].rstrip()
    return text


def _without_review_metadata(text: str) -> str:
    text = text.strip()
    text = re.sub(
        r"(?im)(?:\A|\r?\n)[ \t]*\[view security finding report\]"
        r"\(https?://[^\s)]+\)[ \t]*\Z",
        "",
        text,
    ).strip()
    text = re.sub(
        r"(?im)(?:\A|\r?\n)[ \t]*\*{0,2}reviewed commit:\*{0,2}[ \t]*"
        r"`(?:[0-9a-f]{10}|[0-9a-f]{40})`[ \t]*\Z",
        "",
        text,
    )
    return text.strip()


def _standalone_regular_clean(section: str) -> bool:
    text = _without_heading("regular", section)
    text = _without_known_review_footer(text)
    text = _without_review_metadata(text)
    return bool(KNOWN_REGULAR_CLEAN_RESULT.fullmatch(text))


def _standalone_security_clean(section: str) -> bool:
    text = _without_heading("security", section)
    text = _without_known_security_footer(text)
    text = _without_known_review_footer(text)
    text = _without_review_metadata(text)
    return bool(KNOWN_SECURITY_CLEAN_RESULT.fullmatch(text))


def _security_facts(kind: str, section: str) -> tuple[bool, bool]:
    marker = bool(INLINE_SECURITY_MARKER.search(section)) or (
        kind in ("security", "unheaded") and bool(SECURITY_MARKER.search(section))
    )
    coordinator_marker = (
        kind == "regular"
        and "retry reason" in section.casefold()
        and bool(
            SECURITY_MARKER_COMMENT.search(SECURITY_MARKER_IN_CODE.sub("", section))
        )
    )
    marker = marker or coordinator_marker
    heading = kind == "security"
    severity = bool(
        SECURITY_SEVERITY.search(section)
        or (heading and re.search(r"(?i)\bP[0-3]\b", section))
    )
    security_text = "\n".join(
        line for line in section.splitlines() if not SECURITY_MARKER.fullmatch(line)
    )
    unheaded_security = (
        kind in ("unheaded", "regular")
        and bool(re.search(r"(?i)\bP[0-3]\b", security_text))
        and bool(
            re.search(r"(?i)\bsecurity\b|\bvulnerab\w*|\bexploitable\b", security_text)
        )
    )
    report_link = bool(SECURITY_REPORT_LINK.search(section))
    clean_claim = _standalone_security_clean(section) and not severity and not marker
    finding = (
        marker
        or unheaded_security
        or (heading and severity)
        or (heading and report_link and not clean_claim)
    )
    event = marker or unheaded_security or (heading and (report_link or clean_claim))
    return event, finding


def classify_body(body: str) -> dict[str, Any]:
    parsed_body, request_head = _coordinator_body(body)
    raw_sections = _raw_sections(parsed_body)

    sections: list[dict[str, Any]] = []
    for kind, text in raw_sections:
        regular_heading = kind == "regular"
        security_heading = kind == "security"
        availability = bool(
            AVAILABILITY.fullmatch(
                _without_review_metadata(_without_known_review_footer(text))
            )
        ) and not bool(SECURITY_REPORT_LINK.search(text))
        clean = _standalone_regular_clean(text)
        ordinary_text = "\n".join(
            line
            for line in text.splitlines()
            if not INLINE_SECURITY_MARKER.search(line)
            and not SECURITY_MARKER.fullmatch(line)
        )
        ordinary_text = _without_review_metadata(ordinary_text)
        ordinary_text = _without_heading(kind, ordinary_text)
        prefix_adverse = kind == "unheaded" and bool(
            EXPLICIT_ADVERSE.search(ordinary_text)
        )
        security_event, security_finding = _security_facts(kind, text)
        adverse_regular = bool(
            prefix_adverse
            or (
                regular_heading
                and ordinary_text.strip()
                and (
                    bool(EXPLICIT_ADVERSE.search(ordinary_text))
                    or (not availability and not clean)
                )
            )
        )
        has_result = (
            regular_heading
            or security_heading
            or security_event
            or security_finding
            or prefix_adverse
        )
        if security_event and not adverse_regular and not ordinary_text.strip():
            kind = "security"
        sections.append(
            {
                "kind": kind,
                "body": text,
                "has_result": has_result,
                "regular_clean": regular_heading and clean,
                "availability": availability,
                "regular_adverse": adverse_regular,
                "security_event": security_event,
                "security_finding": security_finding,
                "target_ref": _target_ref(text, request_head),
            }
        )
    return {"request_head": request_head, "sections": sections}


def classify_event(event: dict[str, Any]) -> dict[str, Any]:
    action = event.get("action", "")
    comment = event.get("comment") or {}
    current = classify_body(comment.get("body") or "")
    if action == "edited":
        previous_body = ((event.get("changes") or {}).get("body") or {}).get(
            "from"
        ) or ""
    elif action == "deleted":
        previous_body = comment.get("body") or ""
    else:
        previous_body = ""
    previous = (
        classify_body(previous_body)
        if previous_body
        else {"request_head": None, "sections": []}
    )
    return {"action": action, "current": current, "previous": previous}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "event", nargs="?", type=Path, help="GitHub issue-comment event JSON"
    )
    parser.add_argument(
        "--records", action="store_true", help="Annotate live API records from stdin"
    )
    args = parser.parse_args()
    try:
        if args.records:

            def annotate(value):
                if isinstance(value, list):
                    return [annotate(item) for item in value]
                if isinstance(value, dict):
                    result = {key: annotate(item) for key, item in value.items()}
                    if isinstance(value.get("body"), str):
                        result["review_gate_sections"] = classify_body(value["body"])[
                            "sections"
                        ]
                        result["review_gate_prefix_known"] = all(
                            section["kind"] != "unheaded"
                            or section["has_result"]
                            or section["availability"]
                            for section in result["review_gate_sections"]
                        )
                    return result
                return value

            data = sys.stdin.read()
            decoder = json.JSONDecoder()
            while data.strip():
                data = data.lstrip()
                value, end = decoder.raw_decode(data)
                print(json.dumps(annotate(value), separators=(",", ":")))
                data = data[end:]
            return 0
        if args.event is None:
            parser.error("an event path or --records is required")
        event = json.loads(args.event.read_text(encoding="utf-8"))
        print(json.dumps(classify_event(event), separators=(",", ":")))
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        print(f"Could not classify review event sections: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
