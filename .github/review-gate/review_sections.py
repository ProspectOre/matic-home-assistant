#!/usr/bin/env python3
"""Classify immutable review-comment bodies by their own result section."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

REGULAR_HEADING = re.compile(
    r"\A[ ]{0,3}(?:@|#{1,6}[ \t]+(?:[^A-Za-z0-9\r\n]+[ \t]+)?)?"
    r"codex[ \t]+review(?:[ \t]*:|[ \t]|$)|"
    r"\A[ ]{0,3}(?:#{1,6}[ \t]+)?review result(?:[ \t]*:|[ \t]|$)|"
    r"\A[ ]{0,3}\*{0,2}(?:<sub>)*!\[P[0-3][ \t]+badge\]\([^)\r\n]+\)(?:</sub>)*",
    re.IGNORECASE,
)
SECURITY_HEADING = re.compile(
    r"\A[ ]{0,3}(?:#{1,6}[ \t]+(?:[^A-Za-z0-9\r\n]+[ \t]+)?)?"
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
    r"(?im)^[ ]{0,3}\*{0,2}reviewed commit:\*{0,2}[ \t]*"
    r"`([0-9a-f]{10}|[0-9a-f]{40})`[ \t]*$"
)
FENCE_LINE = re.compile(
    r"^[ ]{0,3}(?P<char>`|~)(?P<count>(?P=char){2,})(?P<info>[^\r\n]*)$"
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
_PRIVATE_EVIDENCE = re.compile(
    r"\ARoot-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}\Z", re.I
)
_RETRY_REASON = re.compile(r"\ARetry reason:[^\r\n]*\Z", re.I)
_LEGACY_METADATA = re.compile(
    r"\ARoot-cause diagnosis:[ \t]*\r?\n"
    r"[ \t]*- rootCause:[^\r\n]*\r?\n"
    r"[ \t]*- changes:[^\r\n]*\r?\n"
    r"[ \t]*- validation:[^\r\n]*\Z",
    re.I,
)


def _backslash_escaped(text: str, position: int) -> bool:
    before = position - 1
    while before >= 0 and text[before] == "\\":
        before -= 1
    return (position - before - 1) % 2 == 1


def _without_inline_code(text: str) -> str:
    """Mask code spans with matching backtick runs, retaining line positions."""
    runs = list(re.finditer(r"`+", text))
    next_same: dict[int, int] = {}
    closing: dict[int, int] = {}
    for index in range(len(runs) - 1, -1, -1):
        length = len(runs[index].group())
        if length in next_same:
            closing[index] = next_same[length]
        next_same[length] = index
    chunks: list[str] = []
    position = 0
    index = 0
    while index < len(runs):
        if _backslash_escaped(text, runs[index].start()):
            index += 1
            continue
        end_index = closing.get(index)
        if end_index is None:
            index += 1
            continue
        start, end = runs[index].start(), runs[end_index].end()
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
        index = end_index + 1
    chunks.append(text[position:])
    return "".join(chunks)


SECURITY_MARKER_COMMENT = re.compile(
    r"(?is)<!--[ \t]*codex-security-review-finding:v1[ \t]*-->"
)
HTML_COMMENT_END = re.compile(r"--!?>")
HTML_CODE_CONTAINER_TAGS = frozenset(
    {"code", "iframe", "noembed", "noframes", "pre", "script", "style", "textarea", "xmp"}
)
RAW_HTML_TEXT_TAGS = frozenset({"iframe", "noembed", "noframes", "script", "style", "textarea", "title", "xmp"})
HTML_CODE_CONTAINER_CLOSER = re.compile(
    r"</\s*(?:" + "|".join(sorted(HTML_CODE_CONTAINER_TAGS)) + r")\s*>",
    re.IGNORECASE,
)
REFERENCE_DEFINITION = re.compile(
    r"""(?m)^[ ]*\[(?:[^\]\r\n]|\r?\n(?![ \t]*(?:\r?\n)))*\]:"""
    r"""[ \t]*(?:\r?\n(?![ \t]*(?:\r?\n))[ \t]*)?"""
    r"""(?P<destination>(?:<(?:\\.|[^<>\\\r\n])*>|\\.|[^ \t\r\n])+)"""
    r"""(?:(?:[ \t]+|\r?\n(?![ \t]*(?:\r?\n))[ \t]*)(?:"""
    r""""(?:\\.|(?!(?:\r?\n)[ \t]*(?:\r?\n))[^"\\])*"|"""
    r"""'(?:\\.|(?!(?:\r?\n)[ \t]*(?:\r?\n))[^'\\])*'|"""
    r"""\((?:\\.|(?!(?:\r?\n)[ \t]*(?:\r?\n))[^)\\])*\)))?"""
    r"""[ \t]*$"""
)
REFERENCE_DEFINITION_START = re.compile(r"(?m)^[ ]*\[")
BACKSLASH_ESCAPED_CONTAINER_TAG = re.compile(
    r"\\+(?P<tag></?\s*(?:details|summary)\b[^<>]*>)", re.IGNORECASE
)


def _column_indent(text: str) -> int:
    column = 0
    for character in text:
        if character == " ":
            column += 1
        elif character == "\t":
            column = (column // 4 + 1) * 4
        else:
            break
    return column


def _strip_quote_prefix(line: str, count: int | None = None) -> tuple[str, int]:
    rest = line
    found = 0
    while count is None or found < count:
        match = re.match(r"[ ]{0,3}>[ ]?", rest)
        if not match:
            break
        rest = rest[match.end() :]
        found += 1
    return rest, found


def _block_prefix(line: str) -> tuple[str, int, int]:
    """Remove blockquote/list markers; return text, quote depth and list indent."""
    rest, quotes = _strip_quote_prefix(line)
    list_indent = 0
    while True:
        match = re.match(r"([ ]{0,3})([-+*]|[0-9]{1,9}[.)])([ \t]+)", rest)
        if not match:
            break
        content_column = list_indent + _column_indent(match.group(1)) + len(match.group(2))
        for character in match.group(3):
            content_column = (
                content_column + 1
                if character == " "
                else (content_column // 4 + 1) * 4
            )
        list_indent = content_column
        rest = rest[match.end() :]
    return rest, quotes, list_indent


def _strip_list_indent(line: str, columns: int) -> str:
    index = 0
    while (
        index < len(line)
        and line[index] in " \t"
        and _column_indent(line[:index]) < columns
    ):
        index += 1
    return line[index:] if _column_indent(line[:index]) >= columns else line


def _markdown_link_end(text: str, opening: int) -> int | None:
    """Return the closing `)` of a valid inline link destination and title."""
    cursor = opening + 2
    initial = cursor
    while cursor < len(text) and text[cursor] in " \t\r\n":
        cursor += 1
    had_leading_space = cursor > initial
    title_after_empty_destination = False

    def title_end(position: int) -> int | None:
        opener = text[position]
        if opener in ("\"", "'"):
            position += 1
            while position < len(text):
                if _backslash_escaped(text, position):
                    position += 1
                elif text[position] == opener:
                    return position + 1
                position += 1
            return None
        if opener == "(":
            depth = 1
            position += 1
            while position < len(text):
                if _backslash_escaped(text, position):
                    position += 1
                elif text[position] == "(":
                    depth += 1
                elif text[position] == ")":
                    depth -= 1
                    if depth == 0:
                        return position + 1
                position += 1
        return None

    # An empty destination can be followed by a title only when whitespace
    # separates the title from the opening parenthesis.
    if had_leading_space and cursor < len(text) and text[cursor] in ('"', "'", "("):
        destination_end = cursor
        title_after_empty_destination = True
    elif cursor < len(text) and text[cursor] == "<":
        destination_start = cursor
        cursor += 1
        while cursor < len(text):
            if _backslash_escaped(text, cursor):
                cursor += 1
            elif text[cursor] in "\r\n<":
                return None
            elif text[cursor] == ">":
                cursor += 1
                break
            cursor += 1
        else:
            return None
        destination_end = cursor if cursor > destination_start + 1 else None
        if destination_end is None:
            return None
    else:
        depth = 0
        destination_start = cursor
        while cursor < len(text):
            if _backslash_escaped(text, cursor):
                cursor += 1
            elif text[cursor] in " \t\r\n":
                if depth:
                    return None
                break
            elif text[cursor] == "(":
                depth += 1
            elif text[cursor] == ")":
                if depth == 0:
                    break
                depth -= 1
            cursor += 1
        if depth:
            return None
        destination_end = cursor if cursor > destination_start else None

    cursor = destination_end if destination_end is not None else cursor
    if cursor >= len(text):
        return None
    if text[cursor] == ")":
        return cursor

    if title_after_empty_destination:
        title_close = title_end(cursor)
        if title_close is None:
            return None
        cursor = title_close
        while cursor < len(text) and text[cursor] in " \t\r\n":
            cursor += 1
        return cursor if cursor < len(text) and text[cursor] == ")" else None

    separator_start = cursor
    while cursor < len(text) and text[cursor] in " \t\r\n":
        cursor += 1
    if cursor == separator_start or cursor >= len(text):
        return None
    title_close = title_end(cursor)
    if title_close is None:
        return None
    cursor = title_close
    while cursor < len(text) and text[cursor] in " \t\r\n":
        cursor += 1
    return cursor if cursor < len(text) and text[cursor] == ")" else None


def _reference_definition_scan_text(
    text: str,
) -> tuple[str, set[int], dict[int, tuple[int, int, int]]]:
    """Normalize container prefixes and valid reference labels without shifting offsets."""
    normalized = list(text)
    candidate_openings: set[int] = set()
    line_contexts: dict[int, tuple[int, int, int]] = {}
    valid_openings: set[int] = set()
    offset = 0
    for line in text.splitlines(keepends=True):
        source = line.rstrip("\r\n")
        content, quotes, list_indent = _block_prefix(source)
        prefix_length = len(source) - len(content)
        content_indent = _column_indent(content[: len(content) - len(content.lstrip(" \t"))])
        line_contexts[offset] = (quotes, list_indent, content_indent)
        if prefix_length:
            normalized[offset : offset + prefix_length] = [" "] * prefix_length
        if re.match(r"[ ]{0,3}\[", content):
            opening = offset + prefix_length + content.index("[")
            candidate_openings.add(opening)
        offset += len(line)

    container_scan = "".join(normalized)
    for match in REFERENCE_DEFINITION_START.finditer(container_scan):
        opening = match.end() - 1
        if opening not in candidate_openings:
            continue
        cursor = opening + 1
        depth = 1
        while cursor < len(text):
            character = text[cursor]
            if character in "\r\n":
                line_ending = 2 if text[cursor : cursor + 2] == "\r\n" else 1
                next_line_start = cursor + line_ending
                next_line_end = next_line_start
                while next_line_end < len(text) and text[next_line_end] not in "\r\n":
                    next_line_end += 1
                if not container_scan[next_line_start:next_line_end].strip(" \t"):
                    break
                cursor += line_ending
                continue
            if character == "\\" and cursor + 1 < len(text):
                if text[cursor + 1] in "\r\n":
                    line_ending = (
                        2 if text[cursor + 1 : cursor + 3] == "\r\n" else 1
                    )
                    cursor += 1 + line_ending
                    continue
                cursor += 2
                continue
            if character == "[":
                depth += 1
            elif character == "]":
                depth -= 1
                if depth == 0:
                    break
            cursor += 1
        if depth != 0 or cursor >= len(text) or text[cursor + 1 : cursor + 2] != ":":
            continue
        label = re.sub(r"\r?\n", " ", text[opening + 1 : cursor])
        if len(label) > 999 or not label.strip():
            continue
        valid_openings.add(opening)
        for index in range(opening + 1, cursor):
            if text[index] not in "\r\n":
                normalized[index] = "x"
    return "".join(normalized), valid_openings, line_contexts


def _reference_match_has_valid_containers(
    source: str,
    start: int,
    end: int,
    line_contexts: dict[int, tuple[int, int, int]],
) -> bool:
    """Reject a definition span that crosses into a different block container."""
    line_start = source.rfind("\n", 0, start) + 1
    initial = line_contexts.get(line_start)
    if initial is None:
        return False
    initial_quotes, initial_list_indent, _ = initial
    cursor = line_start
    while cursor < end:
        line_end = source.find("\n", cursor)
        if line_end == -1:
            line_end = len(source)
        if cursor != line_start:
            context = line_contexts.get(cursor)
            if context is None:
                return False
            quotes, list_indent, content_indent = context
            if quotes != initial_quotes or list_indent != 0:
                return False
            if initial_list_indent:
                if content_indent < initial_list_indent:
                    return False
            elif content_indent > 3:
                return False
        cursor = line_end + 1
    return True


def _valid_reference_destination(destination: str) -> bool:
    """Reject malformed destinations before masking a reference definition."""
    def escaped_punctuation(character: str) -> bool:
        return (
            character.isascii()
            and character.isprintable()
            and not character.isalnum()
            and not character.isspace()
        )

    if destination.startswith("<"):
        if not destination.endswith(">"):
            return False
        cursor = 1
        while cursor < len(destination) - 1:
            character = destination[cursor]
            if character == "\\":
                cursor += 1
                if cursor >= len(destination) - 1 or not escaped_punctuation(
                    destination[cursor]
                ):
                    return False
            elif character in "<>\r\n" or character.isspace() or ord(character) < 32:
                return False
            cursor += 1
        return True

    depth = 0
    cursor = 0
    while cursor < len(destination):
        character = destination[cursor]
        if character == "\\":
            cursor += 1
            if cursor >= len(destination) or not escaped_punctuation(destination[cursor]):
                return False
        elif character in "<>\r\n" or character.isspace() or ord(character) < 32:
            return False
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth < 0:
                return False
        cursor += 1
    return depth == 0


def _mask_markdown_link_destinations(text: str) -> str:
    """Mask inline Markdown destinations/titles before scanning HTML tokens."""
    spans: list[tuple[int, int]] = []
    for match in re.finditer(r"\]\(", text):
        if _backslash_escaped(text, match.start()):
            continue
        depth = 0
        label_open = None
        for index in range(match.start(), -1, -1):
            if _backslash_escaped(text, index):
                continue
            if text[index] == "]":
                depth += 1
            elif text[index] == "[":
                depth -= 1
                if depth == 0:
                    label_open = index
                    break
        if label_open is None:
            continue
        end = _markdown_link_end(text, match.start())
        if end is not None:
            spans.append((match.start(), end + 1))

    chunks: list[str] = []
    position = 0
    for start, end in spans:
        if start < position:
            continue
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _escaped_container_tag_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for match in re.finditer(r"&lt;[^<>\r\n]*?&gt;", text, re.IGNORECASE):
        decoded = html.unescape(match.group())
        if re.fullmatch(
            r"</?\s*(?:details|summary)\b[^<>]*>", decoded, re.IGNORECASE
        ):
            spans.append((match.start(), match.end()))
    return spans


def _mask_escaped_container_tags(text: str) -> str:
    """Ignore escaped details/summary markup while preserving adjacent text."""
    spans = _escaped_container_tag_spans(text)
    chunks: list[str] = []
    position = 0
    for start, end in spans:
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _mask_backslash_escaped_container_tags(text: str) -> str:
    """Mask only backslash-escaped details/summary tags in structural views."""
    spans = [
        (match.start(), match.end())
        for match in BACKSLASH_ESCAPED_CONTAINER_TAG.finditer(text)
        if _backslash_escaped(text, match.start("tag"))
    ]
    chunks: list[str] = []
    position = 0
    for start, end in spans:
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _restore_html_code_container_closers(source: str, masked: str) -> str:
    """Keep raw HTML code-container closers visible to the HTML tokenizer."""
    chunks: list[str] = []
    position = 0
    for match in HTML_CODE_CONTAINER_CLOSER.finditer(source):
        start, end = match.span()
        if _backslash_escaped(source, start):
            continue
        chunks.append(masked[position:start])
        chunks.append(source[start:end])
        position = end
    chunks.append(masked[position:])
    return "".join(chunks)


def _html_markup_at(text: str, start: int) -> tuple[str, bool, int] | None:
    """Return a complete tag name, closing flag, and end offset at ``start``."""
    if start >= len(text) or text[start] != "<":
        return None
    if text.startswith("<!", start) or text.startswith("<?", start):
        quote: str | None = None
        for index in range(start + 2, len(text)):
            character = text[index]
            if quote:
                if character == quote:
                    quote = None
            elif character in "\"'":
                quote = character
            elif character == ">":
                return "", False, index + 1
        return "", False, len(text)

    match = re.match(r"</?\s*([A-Za-z][A-Za-z0-9:-]*)", text[start:])
    if not match:
        return None
    closing = text[start + 1 : start + 2] == "/"
    tag = match.group(1).lower()
    quote: str | None = None
    for index in range(start + match.end(), len(text)):
        character = text[index]
        if quote:
            if character == quote:
                quote = None
        elif character in "\"'":
            quote = character
        elif character == ">":
            return tag, closing, index + 1
    return tag, closing, len(text)


def _unterminated_html_comment_start(text: str) -> int | None:
    """Find an actual unterminated comment while respecting tags and raw text."""
    position = 0
    raw_text_tag: str | None = None
    while position < len(text):
        if raw_text_tag is not None:
            closing = re.search(
                r"</\s*" + re.escape(raw_text_tag) + r"\s*>",
                text[position:],
                re.IGNORECASE,
            )
            if closing is None:
                return None
            position += closing.end()
            raw_text_tag = None
            continue

        if text.startswith("<!--", position):
            closing = HTML_COMMENT_END.search(text, position + 4)
            if _backslash_escaped(text, position):
                if closing is None:
                    return None
                position = closing.end()
                continue
            if closing is None:
                return position
            position = closing.end()
            continue

        if text[position] == "<":
            markup = _html_markup_at(text, position)
            if markup is not None:
                tag, closing, end = markup
                if tag in RAW_HTML_TEXT_TAGS and not closing and end > position:
                    raw_text_tag = tag
                if end <= position or end == len(text) and text[end - 1 : end] != ">":
                    return None
                position = end
                continue
        position += 1
    return None


def _actual_metadata(text: str) -> str:
    """Mask Markdown code blocks while retaining physical line positions."""
    masked: list[str] = []
    fence_char: str | None = None
    fence_length = 0
    fence_quotes = 0
    fence_list_indent = 0
    indented_code = False
    block_boundary = True
    active_list_indent: int | None = None
    list_has_blank = False
    for line in text.splitlines(keepends=True):
        content, quotes, list_indent = _block_prefix(line.rstrip("\r\n"))
        if fence_char is not None:
            content, found_quotes = _strip_quote_prefix(
                line.rstrip("\r\n"), fence_quotes
            )
            if found_quotes == fence_quotes:
                content = _strip_list_indent(content, fence_list_indent)
                closing = re.fullmatch(
                    r"[ ]{0,3}"
                    + re.escape(fence_char)
                    + "{"
                    + str(fence_length)
                    + r",}[ \t]*",
                    content,
                )
            else:
                closing = None
            masked.append("\n" if line.endswith("\n") else "")
            if closing:
                fence_char = None
                fence_length = 0
                fence_quotes = 0
                fence_list_indent = 0
                block_boundary = True
            continue

        match = FENCE_LINE.match(content)
        if match and match.group("char") == "`" and "`" in match.group("info"):
            match = None
        if match:
            fence_char = match.group("char")
            fence_length = len(match.group("count")) + 1
            fence_quotes = quotes
            fence_list_indent = list_indent
            masked.append("\n" if line.endswith("\n") else "")
            block_boundary = True
            indented_code = False
            continue

        plain, _ = _strip_quote_prefix(line.rstrip("\r\n"))
        indent = _column_indent(plain)
        if not plain.strip():
            masked.append("\n" if line.endswith("\n") else "")
            if active_list_indent is not None:
                list_has_blank = True
            block_boundary = True
            continue

        if list_indent:
            active_list_indent = list_indent
            list_has_blank = False
        elif active_list_indent is not None:
            starts_root_block = bool(
                RESULT_HEADING.match(content)
                or re.match(r"^[ ]{0,3}(?:#{1,6}[ \t]|>|[-+*][ \t]|[0-9]+[.)][ \t])", content)
            )
            if list_has_blank and indent < active_list_indent or starts_root_block:
                active_list_indent = None
                list_has_blank = False
            else:
                list_has_blank = False

        code_indent = 4 + (list_indent or active_list_indent or 0)
        if indent >= code_indent and (indented_code or block_boundary):
            masked.append("\n" if line.endswith("\n") else "")
            indented_code = True
            continue
        indented_code = False
        masked.append(line)
        stripped = line.rstrip("\r\n")
        block_content = content.strip()
        block_boundary = bool(
            RESULT_HEADING.match(content)
            or (quotes and not block_content)
            or (list_indent and not block_content)
            or re.match(r"^[ ]{0,3}(?:#{1,6}[ \t]|>)", stripped)
        )
    return "".join(masked)


def _visible_html(text: str, visible_open: bool = True) -> str:
    """Mask only container spans, preserving visible prefixes and suffixes."""
    metadata = _actual_metadata(text)
    scan = _restore_html_code_container_closers(
        metadata, _without_inline_code(metadata)
    )
    # Markdown destinations and titles are not HTML. Mask them only in the
    # parser input so their literal tags cannot open containers or shift offsets.
    scan = re.sub(
        r"\]\([ \t]*<[^>\r\n]*>(?:[ \t]+(?:\"[^\"]*\"|'[^']*'))?[ \t]*\)",
        lambda match: re.sub(r"[^\r\n]", " ", match.group()),
        scan,
    )
    escaped_markup_spans = _escaped_container_tag_spans(scan)
    parser_scan = _mask_markdown_link_destinations(scan)
    reference_scan, valid_openings, line_contexts = _reference_definition_scan_text(
        parser_scan
    )
    reference_spans: list[tuple[int, int]] = []
    for match in REFERENCE_DEFINITION.finditer(reference_scan):
        opening = match.start() + match.group().index("[")
        if (
            opening in valid_openings
            and _valid_reference_destination(match.group("destination"))
            and _reference_match_has_valid_containers(
                parser_scan, match.start(), match.end(), line_contexts
            )
        ):
            reference_spans.append((match.start(), match.end()))
    if reference_spans:
        chunks: list[str] = []
        position = 0
        for start, end in reference_spans:
            chunks.append(parser_scan[position:start])
            chunks.append(re.sub(r"[^\r\n]", " ", parser_scan[start:end]))
            position = end
        chunks.append(parser_scan[position:])
        parser_scan = "".join(chunks)
    parser_scan = _mask_escaped_container_tags(parser_scan)
    unterminated_comment = _unterminated_html_comment_start(parser_scan)
    # Python 3.9's HTMLParser does not recognize HTML's --!> comment end tag.
    # Normalize only its parser input, without changing source offsets.
    parser_scan = parser_scan.replace("--!>", "--->")
    line_offsets = [0]
    line_offsets.extend(match.end() for match in re.finditer("\n", scan))
    tokens: list[tuple[int, int, str, bool, str]] = []
    class ContainerParser(HTMLParser):
        def _offset(self) -> int:
            line, column = self.getpos()
            return line_offsets[line - 1] + column

        def handle_comment(self, data: str) -> None:
            start = self._offset()
            if _backslash_escaped(scan, start):
                return
            close = HTML_COMMENT_END.search(scan, start + 4)
            if close is None:
                return
            end = close.end()
            protocol = scan[start:end]
            if SECURITY_MARKER_COMMENT.fullmatch(protocol) or re.fullmatch(
                r"<!-- review-request:v2 head=[0-9a-f]{40} base=[0-9a-f]{40} -->",
                protocol,
                re.I,
            ):
                return
            tokens.append((start, end, "comment", False, ""))

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            normalized_tag = tag.lower()
            if normalized_tag in HTML_CODE_CONTAINER_TAGS or normalized_tag in {
                "details",
                "summary",
            }:
                start = self._offset()
                if _backslash_escaped(scan, start):
                    return
                end = start + len(self.get_starttag_text())
                if normalized_tag in HTML_CODE_CONTAINER_TAGS:
                    tokens.append((start, end, "code-open", False, normalized_tag))
                    return
                if normalized_tag == "summary":
                    tokens.append((start, end, "summary-open", False, normalized_tag))
                    return
                expanded = any(name.lower() == "open" for name, _ in attrs)
                tokens.append((start, end, "details-open", expanded, normalized_tag))

        def handle_startendtag(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> None:
            # HTML ignores self-closing flags on these non-void containers.
            self.handle_starttag(tag, attrs)

        def handle_endtag(self, tag: str) -> None:
            normalized_tag = tag.lower()
            if normalized_tag in HTML_CODE_CONTAINER_TAGS or normalized_tag in {
                "details",
                "summary",
            }:
                start = self._offset()
                if _backslash_escaped(scan, start):
                    return
                close = scan.find(">", start)
                end = close + 1 if close >= 0 else start + len("</details>")
                if normalized_tag in HTML_CODE_CONTAINER_TAGS:
                    kind = "code-close"
                elif normalized_tag == "summary":
                    kind = "summary-close"
                else:
                    kind = "details-close"
                tokens.append((start, end, kind, False, normalized_tag))

    parser = ContainerParser(convert_charrefs=False)
    parser.feed(parser_scan)
    parser.close()
    if unterminated_comment is not None:
        tokens.append((unterminated_comment, len(scan), "comment", False, ""))
    tokens.sort(key=lambda token: token[0])

    details: list[dict[str, bool]] = []
    code_tags: list[str] = []
    start: int | None = None
    spans: list[tuple[int, int]] = []
    markup_spans = list(escaped_markup_spans)

    def hidden_state() -> bool:
        return bool(code_tags) or any(
            not visible_open
            or (not item["expanded"] and not item["in_summary"])
            for item in details
        )

    for token_start, token_end, kind, expanded, tag in tokens:
        was_hidden = hidden_state()
        if kind == "comment":
            if not was_hidden:
                spans.append((token_start, token_end))
            continue
        if kind == "code-open":
            code_tags.append(tag)
        elif kind == "code-close":
            for index in range(len(code_tags) - 1, -1, -1):
                if code_tags[index] == tag:
                    del code_tags[index:]
                    break
        elif code_tags:
            continue
        elif kind == "details-open":
            details.append({"expanded": expanded, "in_summary": False})
        elif kind == "details-close" and details:
            details.pop()
        elif kind == "summary-open" and details:
            if visible_open and not details[-1]["expanded"]:
                details[-1]["in_summary"] = True
        elif kind == "summary-close" and details and details[-1]["in_summary"]:
            details[-1]["in_summary"] = False
        is_hidden = hidden_state()
        if not was_hidden and is_hidden:
            if kind == "details-open":
                markup_spans.append((token_start, token_end))
                start = token_end
            else:
                start = token_start
        elif was_hidden and not is_hidden and start is not None:
            if kind == "summary-open":
                spans.append((start, token_start))
                markup_spans.append((token_start, token_end))
            else:
                spans.append((start, token_end))
            start = None
        elif not was_hidden and not is_hidden and kind in {
            "details-open",
            "details-close",
            "summary-open",
            "summary-close",
        }:
            markup_spans.append((token_start, token_end))
    if start is not None:
        spans.append((start, len(text)))
    replacements = sorted(
        [(start, end, False) for start, end in spans]
        + [(start, end, True) for start, end in markup_spans]
    )
    chunks: list[str] = []
    position = 0
    for start, end, remove_markup in replacements:
        if start < position:
            continue
        chunks.append(text[position:start])
        replacement = "" if remove_markup else " "
        chunks.append(re.sub(r"[^\r\n]", replacement, text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _commit_metadata(text: str) -> str:
    """Keep commit authority outside expandable, commented and code examples."""
    metadata = _visible_html(_actual_metadata(text), visible_open=False)
    code_lines = _without_inline_code(metadata).splitlines(keepends=True)
    lines: list[str] = []
    quote_active = False
    list_content_indent: int | None = None
    list_after_blank = False
    for index, line in enumerate(metadata.splitlines(keepends=True)):
        source = line.rstrip("\r\n")
        structural = code_lines[index].rstrip("\r\n")
        quote_text, quote_depth = _strip_quote_prefix(structural)
        _, _, list_indent = _block_prefix(structural)
        indent = _column_indent(quote_text)

        if not structural.strip():
            if list_content_indent is not None:
                list_after_blank = True
            # An unmarked blank line closes a blockquote lazy continuation.
            if not re.match(r"^[ ]{0,3}>", structural):
                quote_active = False
        else:
            root_block = bool(
                RESULT_HEADING.match(structural)
                or re.match(r"^[ ]{0,3}(?:#{1,6}[ \t]|[-+*][ \t]|[0-9]+[.)][ \t])", structural)
            )
            if quote_depth:
                quote_active = True
            elif root_block:
                quote_active = False

            if list_indent:
                list_content_indent = list_indent
                list_after_blank = False
            elif list_content_indent is not None:
                if list_after_blank and indent < list_content_indent or root_block:
                    list_content_indent = None
                    list_after_blank = False
                else:
                    list_after_blank = False

        in_list = list_content_indent is not None and (
            not list_after_blank or indent >= list_content_indent
        )
        if (
            REVIEWED_COMMIT.fullmatch(source)
            and (not code_lines[index].strip() or quote_active or quote_depth or in_list)
        ):
            lines.append(re.sub(r"[^\r\n]", " ", line))
        else:
            lines.append(line)
    return "".join(lines)


def _has_reviewed_commit(text: str) -> bool:
    return REVIEWED_COMMIT.search(_commit_metadata(text)) is not None


def _reviewed_commits(text: str) -> list[str]:
    return [
        match.group(1).lower()
        for match in REVIEWED_COMMIT.finditer(_commit_metadata(text))
    ]


def _valid_coordinator_metadata(metadata: str) -> bool:
    lines = metadata.split("\n")
    index = 0
    while index < len(lines):
        if not lines[index].strip(" \t\r"):
            index += 1
            continue
        line = lines[index].strip(" \t\r")
        if _RETRY_REASON.fullmatch(line) or _PRIVATE_EVIDENCE.fullmatch(line):
            index += 1
            continue
        if _LEGACY_METADATA.fullmatch(
            "\n".join(lines[index : index + 4]).strip(" \t\r\n")
        ):
            index += 4
            continue
        return False
    return True


def _coordinator_container_prefix(lines: list[str]) -> tuple[list[str], list[bool]]:
    """Retain visible container wrappers while removing authenticated metadata."""
    container_tag = re.compile(
        r"</?\s*(?:details|summary)\b[^<>]*>", re.IGNORECASE
    )
    partial_container_tag = re.compile(
        r"</?\s*(?:details|summary)\b[^>]*", re.IGNORECASE
    )
    result: list[str] = []
    container_lines: list[bool] = []
    in_multiline_tag = False
    for line in lines:
        decoded = html.unescape(line)
        # Backslash escaping affects Markdown's HTML parsing only when the
        # number of backslashes is odd. Ignore a run before a wrapper tag for
        # metadata validation, while retaining the original prefix for parsing.
        normalized = re.sub(
            r"\\+(?=</?\s*(?:details|summary)\b)", "", decoded, flags=re.IGNORECASE
        )
        stripped = normalized.strip(" \t\r\n")
        if in_multiline_tag:
            result.append(line)
            container_lines.append(True)
            if ">" in decoded:
                in_multiline_tag = False
            continue
        position = 0
        found = False
        while position < len(stripped):
            while position < len(stripped) and stripped[position].isspace():
                position += 1
            match = container_tag.match(stripped, position)
            if match is None:
                found = False
                break
            found = True
            position = match.end()
        if found and not stripped[position:].strip():
            result.append(line)
            container_lines.append(True)
            continue
        if partial_container_tag.fullmatch(stripped) and ">" not in stripped:
            result.append(line)
            container_lines.append(True)
            in_multiline_tag = True
            continue
        result.append(re.sub(r"[^\r\n]", " ", line))
        container_lines.append(False)
    return result, container_lines


def _coordinator_body(body: str) -> tuple[str, str | None]:
    match = COORDINATOR_PRELUDE.match(body)
    if not match:
        return body, None
    rest = body[match.end() :]
    # Metadata is the prefix before the first recognized result heading. Do not
    # let a malformed request marker supply a fallback commit to a section.
    lines = rest.splitlines()
    structural_text = _visible_html(_actual_metadata(rest))
    structural_lines = _without_inline_code(
        _mask_backslash_escaped_container_tags(structural_text)
    ).splitlines()
    start = next(
        (
            i
            for i, line in enumerate(structural_lines)
            if RESULT_HEADING.match(line)
            or PRIORITY_RESULT.match(line)
            or AVAILABILITY.fullmatch(line)
            or SECURITY_MARKER.fullmatch(line)
            or INLINE_SECURITY_MARKER.fullmatch(line)
        ),
        len(lines),
    )
    prefix, container_lines = _coordinator_container_prefix(lines[:start])
    metadata_lines = structural_lines[:start]
    for index, is_container in enumerate(container_lines):
        if is_container:
            metadata_lines[index] = re.sub(r"[^\r\n]", " ", metadata_lines[index])
    metadata = "\n".join(metadata_lines)
    valid_metadata = not (
        not _valid_coordinator_metadata(metadata)
        or re.search(r"\bP[0-3]\b", metadata, re.I)
        or (
            SECURITY_MARKER_COMMENT.search(_without_inline_code(metadata))
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
        marker_prefix = structural_lines[:start]
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
            and SECURITY_HEADING.match(structural_lines[start])
        ):
            return body, None
        return "\n".join(lines), match.group("head").lower()
    return "\n".join(prefix + lines[start:]), match.group("head").lower()


def _raw_sections(body: str, coordinator_bound: bool = False) -> list[tuple[str, str]]:
    original_lines = body.splitlines()
    authority_lines = _commit_metadata(body).splitlines()
    # A section beginning inside an expanded container must not lose the
    # container context and acquire its copied footer as commit authority.
    original_lines = [
        re.sub(r"[^\r\n]", " ", line)
        if REVIEWED_COMMIT.fullmatch(line)
        and not REVIEWED_COMMIT.fullmatch(authority_lines[index])
        else line
        for index, line in enumerate(original_lines)
    ]
    structural_text = _visible_html(_actual_metadata(body))
    lines = _without_inline_code(
        _mask_backslash_escaped_container_tags(structural_text)
    ).splitlines()
    starts: list[int] = []
    kinds: dict[int, str] = {}
    for i, line in enumerate(lines):
        if RESULT_HEADING.match(line):
            starts.append(i)
            kinds[i] = "security" if SECURITY_HEADING.match(line) else "regular"
        elif PRIORITY_RESULT.match(line):
            previous_start = starts[-1] if starts else 0
            previous = "\n".join(original_lines[previous_start:i])
            marker_start = i
            while marker_start > previous_start and (
                (
                    not lines[marker_start - 1].strip()
                    and not original_lines[marker_start - 1].strip()
                )
                or SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                or (
                    INLINE_SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                    and not PRIORITY_RESULT.match(lines[marker_start - 1])
                )
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
            prior_inline_security = any(
                INLINE_SECURITY_MARKER.search(candidate)
                for candidate in lines[previous_start:i]
            )
            explicit_security_prior = bool(
                starts and SECURITY_HEADING.match(lines[previous_start])
            )
            if (
                (
                    inline_security
                    and (
                        not starts
                        or _has_reviewed_commit(previous)
                        or _standalone_regular_clean(previous)
                    )
                )
                or not starts
                or _has_reviewed_commit(previous)
                or _standalone_regular_clean(previous)
                or (coordinator_bound and _standalone_security_clean(previous))
                or marker_only
                or (
                    prior_inline_security
                    and not inline_security
                    and not explicit_security_prior
                )
            ):
                kind = (
                    "security"
                    if inline_security
                    or marker_only
                    or (
                        starts
                        and kinds[starts[-1]] == "security"
                        and not (
                            prior_inline_security
                            and not inline_security
                            and not explicit_security_prior
                        )
                        and (
                            not coordinator_bound
                            or _has_reviewed_commit(previous)
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
            (
                not lines[marker_start - 1].strip()
                and not original_lines[marker_start - 1].strip()
            )
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
        result.append(
            (
                "unheaded",
                "\n".join(original_lines[: attached_starts.get(starts[0], starts[0])]),
            )
        )
    for index, start in enumerate(starts):
        next_start = starts[index + 1] if index + 1 < len(starts) else len(lines)
        end = attached_starts.get(next_start, next_start)
        text_start = attached_starts.get(start, start)
        result.append((kinds[start], "\n".join(original_lines[text_start:end])))
    return result


def _target_ref(section: str, request_head: str | None) -> str:
    refs = _reviewed_commits(section)
    if len(set(refs)) > 1:
        # Multiple different reviewed commits in one result section do not
        # identify a single safe destination for status history.
        return "__unbound__"
    if refs:
        return refs[-1]
    return request_head or "__unbound__"


def _shared_footer_ref(raw_sections: list[tuple[str, str]]) -> str | None:
    """A single trailing commit footer can bind adjacent split result sections."""
    if len(raw_sections) < 2 or raw_sections[0][0] != "security":
        return None
    if any(kind in ("regular", "security") for kind, _ in raw_sections[1:]):
        return None
    if any(_reviewed_commits(text) for _, text in raw_sections[1:-1]):
        return None
    refs = _reviewed_commits(raw_sections[-1][1])
    if len(set(refs)) == 1:
        return refs[0]
    return None


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
    raw_section = section
    section = _without_inline_code(_actual_metadata(_visible_html(section)))
    marker = bool(INLINE_SECURITY_MARKER.search(section)) or (
        kind in ("security", "unheaded") and bool(SECURITY_MARKER.search(section))
    )
    coordinator_marker = (
        kind == "regular"
        and "retry reason" in section.casefold()
        and bool(SECURITY_MARKER_COMMENT.search(_without_inline_code(section)))
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
        bool(COORDINATOR_PRELUDE.match(section))
        and bool(re.search(r"(?i)\bP[0-3]\b", security_text))
        and bool(
            re.search(r"(?i)\bsecurity\b|\bvulnerab\w*|\bexploitable\b", security_text)
        )
    )
    report_link = bool(SECURITY_REPORT_LINK.search(section))
    clean_claim = (
        _standalone_security_clean(raw_section) and not severity and not marker
    )
    finding = (
        marker
        or unheaded_security
        or (heading and severity)
        or (heading and report_link and not clean_claim)
    )
    event = finding or (heading and (report_link or clean_claim))
    return event, finding


def classify_body(body: str) -> dict[str, Any]:
    parsed_body, request_head = _coordinator_body(body)
    raw_sections = _raw_sections(
        parsed_body, coordinator_bound=request_head is not None
    )
    # Coordinator request metadata already supplies an authenticated fallback;
    # a trailing footer is shared only for ordinary comments split by markers.
    shared_footer_ref = (
        _shared_footer_ref(raw_sections) if request_head is None else None
    )

    sections: list[dict[str, Any]] = []
    for section_index, (kind, text) in enumerate(raw_sections):
        raw_kind = kind
        regular_heading = kind == "regular"
        security_heading = kind == "security"
        availability = bool(
            AVAILABILITY.fullmatch(
                _without_review_metadata(_without_known_review_footer(text))
            )
        ) and not bool(SECURITY_REPORT_LINK.search(text))
        clean = _standalone_regular_clean(text)
        ordinary_text = _visible_html(text)
        ordinary_text = _without_known_review_footer(ordinary_text)
        ordinary_text = _without_review_metadata(ordinary_text)
        ordinary_text = _without_heading(kind, ordinary_text)
        ordinary_text = _without_inline_code(_actual_metadata(ordinary_text))
        ordinary_text = "\n".join(
            line
            for line in ordinary_text.splitlines()
            if not INLINE_SECURITY_MARKER.search(line)
            and not SECURITY_MARKER.fullmatch(line)
        )
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
                "target_ref": _target_ref(
                    text,
                    (
                        request_head
                        if raw_kind != "unheaded"
                        or section_index > 0
                        or len(raw_sections) == 1
                        or (section_index == 0 and PRIORITY_RESULT.match(text))
                        else None
                    )
                    or shared_footer_ref,
                ),
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
