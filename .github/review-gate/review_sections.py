#!/usr/bin/env python3
"""Classify immutable review-comment bodies by their own result section."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from array import array
from bisect import bisect_left, bisect_right
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


def _markdown_lines(text: str, keepends: bool = False) -> list[str]:
    """Split physical Markdown CR/LF lines without rewriting inline characters."""
    lines = re.findall(r"[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$", text)
    return lines if keepends else [line.rstrip("\r\n") for line in lines]


def _backslash_escaped(text: str, position: int) -> bool:
    before = position - 1
    while before >= 0 and text[before] == "\\":
        before -= 1
    return (position - before - 1) % 2 == 1


def _without_inline_code(text: str) -> str:
    return _outside_html_blocks(text, _without_inline_code_in_markdown)


def _without_inline_code_in_markdown(text: str) -> str:
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
    {
        "code",
        "iframe",
        "noembed",
        "noframes",
        "pre",
        "script",
        "style",
        "textarea",
        "xmp",
    }
)
RAW_HTML_TEXT_TAGS = frozenset(
    {"iframe", "noembed", "noframes", "script", "style", "textarea", "title", "xmp"}
)
HTML_VOID_TAGS = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)
HTML_HEADING_TAGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
HTML_P_CLOSING_START_TAGS = frozenset(
    {
        "address",
        "article",
        "aside",
        "blockquote",
        "center",
        "dd",
        "details",
        "dialog",
        "dir",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hgroup",
        "hr",
        "li",
        "listing",
        "main",
        "menu",
        "nav",
        "ol",
        "p",
        "pre",
        "search",
        "section",
        "summary",
        "table",
        "ul",
    }
)
HTML_BUTTON_SCOPE_BOUNDARY_TAGS = frozenset(
    {
        "applet",
        "button",
        "caption",
        "html",
        "marquee",
        "object",
        "select",
        "table",
        "td",
        "template",
        "th",
    }
)
HTML_SPECIAL_TAGS = frozenset(
    "address applet area article aside base basefont bgsound blockquote body br "
    "button caption center col colgroup dd details dir div dl dt embed fieldset "
    "figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header "
    "hgroup hr html iframe img input keygen li link listing main marquee menu "
    "meta nav noembed noframes noscript object ol p param plaintext pre script "
    "search section select source style summary table tbody td template textarea "
    "tfoot th thead title tr track ul wbr xmp".split()
)
HTML_ITEM_START_BOUNDARY_TAGS = HTML_SPECIAL_TAGS - {"address", "div", "p"}
HTML_SCOPE_BOUNDARY_TAGS = HTML_BUTTON_SCOPE_BOUNDARY_TAGS - {"button"}
HTML_IN_BODY_IGNORED_START_TAGS = frozenset(
    (
        "body caption col colgroup frame frameset head html tbody td tfoot th thead tr"
    ).split()
)
HTML_TABLE_CONTEXT_TAGS = frozenset(
    "caption colgroup table tbody td tfoot th thead tr".split()
)
HTML_FOREIGN_BREAKOUT_TAGS = frozenset(
    (
        "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 "
        "head hr i img li listing menu meta nobr ol p pre ruby s small span strong "
        "strike sub sup table tt u ul var"
    ).split()
)
HTML_ITEM_TAGS = frozenset({"li", "dt", "dd"})
HTML_IMPLIED_END_TAGS = frozenset(
    {"dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc"}
)
SVG_BUTTON_SCOPE_BOUNDARY_TAGS = frozenset({"desc", "foreignobject", "title"})
MATHML_BUTTON_SCOPE_BOUNDARY_TAGS = frozenset(
    {"annotation-xml", "mi", "mn", "mo", "ms", "mtext"}
)
SVG_HTML_INTEGRATION_POINT_TAGS = SVG_BUTTON_SCOPE_BOUNDARY_TAGS
MATHML_TEXT_INTEGRATION_POINT_TAGS = frozenset({"mi", "mn", "mo", "ms", "mtext"})
HTML_CODE_CONTAINER_CLOSER = re.compile(
    r"</\s*(?:" + "|".join(sorted(HTML_CODE_CONTAINER_TAGS)) + r")(?=[\s/>])",
    re.IGNORECASE,
)
REFERENCE_DEFINITION_START = re.compile(r"(?m)^[ ]*\[")
LIST_MARKER_PREFIX = re.compile(r"([ ]{0,3})([-+*]|[0-9]{1,9}[.)])([ \t]+)")
HTML_MARKUP_TAG_START = re.compile(r"</?\s*([A-Za-z][A-Za-z0-9:-]*)")
BACKSLASH_ESCAPED_CONTAINER_TAG = re.compile(
    r"\\+(?P<tag></?\s*(?:details|summary)\b[^<>]*>)", re.IGNORECASE
)
HTML_BLOCK_TAGS = frozenset(
    # GitHub's GFM type-6 list: source interrupts paragraphs; search and
    # hgroup remain type-7 tags and require a paragraph boundary.
    "address article aside base basefont blockquote body caption center col colgroup "
    "dd details dialog dir div dl dt fieldset figcaption figure footer form frame "
    "frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu "
    "menuitem nav noframes ol optgroup option p param section source summary table "
    "tbody td tfoot th thead title tr track ul".split()
)
HTML_BLOCK_TAG_START = re.compile(r"</?([A-Za-z][A-Za-z0-9-]*)(?=[ \t>]|/>|$)")
HTML_BLOCK_RAW_END = re.compile(r"</(?:pre|script|style|textarea)>", re.I)
HTML_ATTRIBUTE_NAME = re.compile(r"[A-Za-z_:][A-Za-z0-9_.:-]*")
VISIBLE_CHARACTER_REFERENCE = re.compile(
    r"&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?"
)
EVIDENCE_LINE_SEPARATORS = str.maketrans(
    "\r\n\v\f\x1c\x1d\x1e\x85\u2028\u2029", " " * 10
)


def _complete_html_block_tag(text: str, name: re.Match[str]) -> bool:
    """Recognize CommonMark type-7 tags without retrying growing suffixes."""
    cursor = name.end()
    closing = text.startswith("</")
    while cursor < len(text):
        before_space = cursor
        while cursor < len(text) and text[cursor] in " \t":
            cursor += 1
        if text.startswith(">", cursor) or (
            not closing and text.startswith("/>", cursor)
        ):
            cursor += 1 if text[cursor] == ">" else 2
            return not text[cursor:].strip(" \t")
        if closing or cursor == before_space:
            return False
        attribute = HTML_ATTRIBUTE_NAME.match(text, cursor)
        if attribute is None:
            return False
        cursor = attribute.end()
        value_start = cursor
        while cursor < len(text) and text[cursor] in " \t":
            cursor += 1
        if cursor >= len(text) or text[cursor] != "=":
            cursor = value_start
            continue
        cursor += 1
        while cursor < len(text) and text[cursor] in " \t":
            cursor += 1
        if cursor == len(text):
            return False
        if text[cursor] in "\"'":
            end = text.find(text[cursor], cursor + 1)
            if end < 0:
                return False
            cursor = end + 1
        else:
            value_start = cursor
            while cursor < len(text) and text[cursor] not in " \t\"'=<>`":
                cursor += 1
            if cursor == value_start:
                return False
    return False


def _html_block_end(
    text: str, paragraph_boundary: bool
) -> re.Pattern[str] | str | None:
    """Return an HTML-block terminator, or the empty string for blank-line end."""
    if re.match(r"[ ]{0,3}<(?:pre|script|style|textarea)(?=[ \t>]|$)", text, re.I):
        return HTML_BLOCK_RAW_END
    content = text.lstrip(" ")
    if len(text) - len(content) > 3:
        return None
    for start, end in (("<!--", "-->"), ("<?", "?>"), ("<![CDATA[", "]]>")):
        if content.startswith(start):
            return end
    if re.match(r"<![A-Za-z]", content):
        return ">"
    name = HTML_BLOCK_TAG_START.match(content)
    if name is None:
        return None
    if name.group(1).lower() in HTML_BLOCK_TAGS:
        return ""
    if (
        paragraph_boundary
        and (
            content.startswith("</")
            or name.group(1).lower() not in {"pre", "script", "style", "textarea"}
        )
        and _complete_html_block_tag(content, name)
    ):
        return ""
    return None


def _html_block_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    scan = _mask_markdown_link_destinations_in_markdown(
        _without_inline_code_in_markdown(text)
    )
    _actual_metadata(text, html_scan=scan, raw_html_blocks=spans)
    return spans


def _outside_html_blocks(text: str, transform: Any) -> str:
    """Apply an inline Markdown transform only where block parsing enables it."""
    chunks: list[str] = []
    position = 0
    for start, end in _html_block_spans(text):
        chunks.append(transform(text[position:start]))
        chunks.append(text[start:end])
        position = end
    chunks.append(transform(text[position:]))
    return "".join(chunks)


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


def _markdown_escaped_punctuation(text: str) -> bytearray:
    """Mark ASCII punctuation escaped by an odd-length backslash run."""
    escaped = bytearray(len(text))
    backslash_run = 0
    for index, character in enumerate(text):
        escaped[index] = int(
            bool(backslash_run & 1)
            and character.isascii()
            and 0x21 <= ord(character) <= 0x7E
            and not character.isalnum()
        )
        if character == "\\":
            backslash_run += 1
        else:
            backslash_run = 0
    return escaped


def _quote_prefix_end(line: str, count: int | None = None) -> tuple[int, int]:
    cursor = 0
    found = 0
    while count is None or found < count:
        marker = cursor
        while marker < len(line) and marker - cursor < 3 and line[marker] == " ":
            marker += 1
        if marker >= len(line) or line[marker] != ">":
            break
        cursor = marker + 1
        if cursor < len(line) and line[cursor] == " ":
            cursor += 1
        found += 1
    return cursor, found


def _strip_quote_prefix(line: str, count: int | None = None) -> tuple[str, int]:
    cursor, found = _quote_prefix_end(line, count)
    return line[cursor:], found


def _block_prefix(line: str) -> tuple[str, int, int]:
    """Remove blockquote/list markers; return text, quote depth and list indent."""
    cursor, quotes = _quote_prefix_end(line)
    list_indent = 0
    while True:
        match = LIST_MARKER_PREFIX.match(line, cursor)
        if not match:
            break
        content_column = (
            list_indent + _column_indent(match.group(1)) + len(match.group(2))
        )
        for character in match.group(3):
            content_column = (
                content_column + 1
                if character == " "
                else (content_column // 4 + 1) * 4
            )
        list_indent = content_column
        cursor = match.end()
    return line[cursor:], quotes, list_indent


def _strip_list_indent(line: str, columns: int) -> str:
    index = 0
    column = 0
    while index < len(line) and line[index] in " \t" and column < columns:
        if line[index] == " ":
            column += 1
        else:
            column = (column // 4 + 1) * 4
        index += 1
    return line[index:] if column >= columns else line


def _is_blank_markdown_line(text: str, start: int, end: int) -> bool:
    """Treat quote/list-prefixed whitespace lines as Markdown blank lines."""
    cursor = start
    while cursor < end:
        indent_start = cursor
        while cursor < end and text[cursor] == " " and cursor - indent_start < 3:
            cursor += 1
        if cursor < end and text[cursor] == ">":
            cursor += 1
            if cursor < end and text[cursor] in " \t":
                cursor += 1
            continue

        marker_end = cursor
        if cursor < end and text[cursor] in "-+*":
            marker_end = cursor + 1
        elif cursor < end and "0" <= text[cursor] <= "9":
            digits_end = cursor
            while digits_end < end and "0" <= text[digits_end] <= "9":
                digits_end += 1
            if (
                digits_end - cursor <= 9
                and digits_end < end
                and text[digits_end] in ".)"
            ):
                marker_end = digits_end + 1

        if marker_end > cursor and marker_end < end and text[marker_end] in " \t":
            cursor = marker_end
            while cursor < end and text[cursor] in " \t":
                cursor += 1
            continue
        break
    return not text[cursor:end].strip(" \t")


class _MarkdownLinkIndex:
    """Index link delimiters once so malformed labels cannot rescan suffixes."""

    _WHITESPACE = " \t\r\n"

    def __init__(self, text: str) -> None:
        self.text = text
        length = len(text)
        self.escaped = _markdown_escaped_punctuation(text)

        self.line_ending_prefix = array("i", [0]) * (length + 1)
        for index, character in enumerate(text):
            self.line_ending_prefix[index + 1] = self.line_ending_prefix[index] + int(
                character == "\n"
                or (character == "\r" and text[index + 1 : index + 2] != "\n")
            )

        blank_line_starts = bytearray(length + 1)
        line_start = 0
        while line_start < length:
            line_end = line_start
            while line_end < length and text[line_end] not in "\r\n":
                line_end += 1
            if _is_blank_markdown_line(text, line_start, line_end):
                blank_line_starts[line_start] = 1
            if (
                line_end < length
                and text[line_end] == "\r"
                and text[line_end + 1 : line_end + 2] == "\n"
            ):
                line_start = line_end + 2
            else:
                line_start = line_end + 1
        self.blank_line_starts = blank_line_starts
        self.next_blank_line = array("i", [length]) * (length + 1)
        next_blank_line = length
        for index in range(length - 1, -1, -1):
            if blank_line_starts[index]:
                next_blank_line = index
            self.next_blank_line[index] = next_blank_line

        self.parenthesis_pairs = array("i", [-1]) * length
        parenthesis_stack: list[int] = []
        for index, character in enumerate(text):
            if self.escaped[index]:
                continue
            if character == "(":
                parenthesis_stack.append(index)
            elif character == ")" and parenthesis_stack:
                opening = parenthesis_stack.pop()
                self.parenthesis_pairs[opening] = index

        self.unescaped_whitespace = array("i", [0]) * (length + 1)
        for index, character in enumerate(text):
            self.unescaped_whitespace[index + 1] = self.unescaped_whitespace[
                index
            ] + int(character in self._WHITESPACE and not self.escaped[index])

        self.bare_stop = array("i", [length]) * (length + 1)
        next_whitespace = length
        for index in range(length - 1, -1, -1):
            character = text[index]
            if character in self._WHITESPACE:
                next_whitespace = index
            if not self.escaped[index] and character in self._WHITESPACE + ")":
                self.bare_stop[index] = index
            elif not self.escaped[index] and character == "(":
                close = self.parenthesis_pairs[index]
                if (
                    close < 0
                    or self.unescaped_whitespace[close]
                    - self.unescaped_whitespace[index + 1]
                ):
                    # An unmatched opening parenthesis is permitted as a
                    # literal destination character when whitespace or a
                    # line ending terminates the destination first.
                    self.bare_stop[index] = next_whitespace
                else:
                    self.bare_stop[index] = self.bare_stop[close + 1]
            else:
                self.bare_stop[index] = self.bare_stop[index + 1]

        self.next_non_whitespace = array("i", [length]) * (length + 1)
        self.next_single_quote = array("i", [length]) * (length + 1)
        self.next_double_quote = array("i", [length]) * (length + 1)
        self.next_angle_barrier = array("i", [-1]) * (length + 1)
        for index in range(length - 1, -1, -1):
            character = text[index]
            self.next_non_whitespace[index] = (
                self.next_non_whitespace[index + 1]
                if character in self._WHITESPACE
                else index
            )
            self.next_single_quote[index] = (
                index
                if character == "'" and not self.escaped[index]
                else self.next_single_quote[index + 1]
            )
            self.next_double_quote[index] = (
                index
                if character == '"' and not self.escaped[index]
                else self.next_double_quote[index + 1]
            )
            self.next_angle_barrier[index] = (
                index
                if character in "<>\r\n" and not self.escaped[index]
                else self.next_angle_barrier[index + 1]
            )

    def _valid_separator(self, start: int, end: int) -> bool:
        return self.line_ending_prefix[end] - self.line_ending_prefix[start] <= 1

    def _title_end(self, position: int) -> int | None:
        if position >= len(self.text):
            return None
        opener = self.text[position]
        if opener == "'":
            close = self.next_single_quote[position + 1]
            if close >= len(self.text) or self.next_blank_line[position + 1] < close:
                return None
            return close + 1
        if opener == '"':
            close = self.next_double_quote[position + 1]
            if close >= len(self.text) or self.next_blank_line[position + 1] < close:
                return None
            return close + 1
        if opener == "(":
            close = self.parenthesis_pairs[position]
            if close < 0 or self.next_blank_line[position + 1] < close:
                return None
            return close + 1
        return None

    def link_end(self, closing_bracket: int) -> int | None:
        """Return the closing `)` for a valid destination/title, if present."""
        text = self.text
        length = len(text)
        initial = closing_bracket + 2
        cursor = self.next_non_whitespace[initial]
        had_leading_space = cursor > initial
        if had_leading_space and not self._valid_separator(initial, cursor):
            return None

        if had_leading_space and cursor < length and text[cursor] in ('"', "'", "("):
            title_close = self._title_end(cursor)
            if title_close is not None:
                title_end = self.next_non_whitespace[title_close]
                if (
                    self._valid_separator(title_close, title_end)
                    and title_end < length
                    and text[title_end] == ")"
                ):
                    return title_end

        if cursor < length and text[cursor] == "<":
            barrier = self.next_angle_barrier[cursor + 1]
            if (
                barrier < 0
                or text[barrier] != ">"
                or self.line_ending_prefix[barrier] != self.line_ending_prefix[cursor]
            ):
                return None
            cursor = barrier + 1
            if cursor >= length:
                return None
            if text[cursor] == ")":
                return cursor
            separator = cursor
            cursor = self.next_non_whitespace[cursor]
            if cursor == separator or cursor >= length:
                return None
            if not self._valid_separator(separator, cursor):
                return None
            if text[cursor] == ")":
                return cursor
            title_close = self._title_end(cursor)
            if title_close is None:
                return None
            cursor = self.next_non_whitespace[title_close]
            if not self._valid_separator(title_close, cursor):
                return None
            return cursor if cursor < length and text[cursor] == ")" else None

        stop = self.bare_stop[cursor]
        if stop < 0 or stop >= length:
            return None
        if text[stop] == ")":
            return stop
        if text[stop] not in self._WHITESPACE:
            return None
        cursor = self.next_non_whitespace[stop]
        if cursor >= length:
            return None
        if not self._valid_separator(stop, cursor):
            return None
        if text[cursor] == ")":
            return cursor
        title_close = self._title_end(cursor)
        if title_close is None:
            return None
        cursor = self.next_non_whitespace[title_close]
        if not self._valid_separator(title_close, cursor):
            return None
        return cursor if cursor < length and text[cursor] == ")" else None


def _reference_definition_scan_text(
    text: str,
) -> tuple[
    str,
    set[int],
    dict[int, tuple[int, int, int]],
    dict[int, int],
    bytearray,
]:
    """Normalize reference labels in Markdown containers without shifting offsets."""
    normalized = list(text)
    candidate_openings: set[int] = set()
    line_contexts: dict[int, tuple[int, int, int]] = {}
    blank_line_starts = bytearray(len(text) + 1)
    valid_openings: set[int] = set()
    label_closings: dict[int, int] = {}
    offset = 0
    for line in _markdown_lines(text, keepends=True):
        source = line.rstrip("\r\n")
        content, quotes, list_indent = _block_prefix(source)
        prefix_length = len(source) - len(content)
        indent_text = content[: len(content) - len(content.lstrip(" \t"))]
        content_indent = _column_indent(indent_text)
        line_contexts[offset] = (quotes, list_indent, content_indent)
        if prefix_length:
            normalized[offset : offset + prefix_length] = [" "] * prefix_length
        if not content.strip(" \t"):
            blank_line_starts[offset] = 1
        if re.match(r"[ ]{0,3}\[", content):
            opening = offset + prefix_length + content.index("[")
            candidate_openings.add(opening)
        offset += len(line)

    container_scan = "".join(normalized)
    escaped = _markdown_escaped_punctuation(text)
    bracket_pairs = array("i", [-1]) * len(text)
    bracket_stack: list[int] = []
    for index, character in enumerate(container_scan):
        if blank_line_starts[index]:
            bracket_stack.clear()
        if escaped[index]:
            continue
        if character == "[":
            bracket_stack.append(index)
        elif character == "]" and bracket_stack:
            bracket_pairs[bracket_stack.pop()] = index

    normalized_label_length = array("i", [0]) * (len(text) + 1)
    label_non_whitespace = array("i", [0]) * (len(text) + 1)
    for index, character in enumerate(text):
        normalized_label_length[index + 1] = normalized_label_length[index] + int(
            not (character == "\r" and text[index + 1 : index + 2] == "\n")
        )
        label_non_whitespace[index + 1] = label_non_whitespace[index] + int(
            not character.isspace()
        )

    mask_ranges: list[tuple[int, int]] = []
    for match in REFERENCE_DEFINITION_START.finditer(container_scan):
        opening = match.end() - 1
        if opening not in candidate_openings:
            continue
        cursor = bracket_pairs[opening]
        if cursor < 0 or text[cursor + 1 : cursor + 2] != ":":
            continue
        label_closings[opening] = cursor
        label_start = opening + 1
        label_length = (
            normalized_label_length[cursor] - normalized_label_length[label_start]
        )
        has_non_whitespace = (
            label_non_whitespace[cursor] - label_non_whitespace[label_start]
        ) > 0
        if label_length > 999 or not has_non_whitespace:
            continue
        valid_openings.add(opening)
        mask_ranges.append((label_start, cursor))

    merged_ranges: list[list[int]] = []
    for start, end in mask_ranges:
        if merged_ranges and start <= merged_ranges[-1][1]:
            merged_ranges[-1][1] = max(merged_ranges[-1][1], end)
        else:
            merged_ranges.append([start, end])
    for start, end in merged_ranges:
        for index in range(start, end):
            if text[index] not in "\r\n":
                normalized[index] = "x"
    return (
        "".join(normalized),
        valid_openings,
        line_contexts,
        label_closings,
        blank_line_starts,
    )


def _next_unescaped_positions(
    text: str, escaped: bytearray, blank_line_starts: bytearray
) -> tuple[array, array, array, array]:
    """Index title delimiters and blank lines in one reverse pass."""
    length = len(text)
    next_double_quote = array("i", [length]) * (length + 1)
    next_single_quote = array("i", [length]) * (length + 1)
    next_parenthesis = array("i", [length]) * (length + 1)
    next_blank_line = array("i", [length]) * (length + 1)
    for index in range(length - 1, -1, -1):
        next_double_quote[index] = (
            index
            if text[index] == '"' and not escaped[index]
            else next_double_quote[index + 1]
        )
        next_single_quote[index] = (
            index
            if text[index] == "'" and not escaped[index]
            else next_single_quote[index + 1]
        )
        next_parenthesis[index] = (
            index
            if text[index] == ")" and not escaped[index]
            else next_parenthesis[index + 1]
        )
        next_blank_line[index] = (
            index if blank_line_starts[index] else next_blank_line[index + 1]
        )
    return (
        next_double_quote,
        next_single_quote,
        next_parenthesis,
        next_blank_line,
    )


def _reference_definition_end(
    text: str,
    label_end: int,
    next_double_quote: array,
    next_single_quote: array,
    next_parenthesis: array,
    next_blank_line: array,
) -> tuple[int, str] | None:
    """Parse one reference destination/title without rescanning later lines."""
    length = len(text)
    cursor = label_end + 2  # closing bracket and colon
    while cursor < length and text[cursor] in " \t":
        cursor += 1

    if cursor < length and text[cursor] in "\r\n":
        if text.startswith("\r\n", cursor):
            cursor += 2
        else:
            cursor += 1
        if next_blank_line[cursor] == cursor:
            return None
        while cursor < length and text[cursor] in " \t":
            cursor += 1

    destination_start = cursor
    if cursor < length and text[cursor] == "<":
        cursor += 1
        while cursor < length:
            character = text[cursor]
            if character in "\r\n<":
                return None
            if character == "\\":
                if cursor + 1 >= length or text[cursor + 1] == "\n":
                    return None
                cursor += 2
            elif character == ">":
                cursor += 1
                break
            else:
                cursor += 1
        else:
            return None
    else:
        while cursor < length:
            character = text[cursor]
            if character == "\\":
                if cursor + 1 >= length or text[cursor + 1] == "\n":
                    return None
                cursor += 2
            elif character in " \t\r\n<>":
                break
            else:
                cursor += 1
        if cursor == destination_start:
            return None

    destination = text[destination_start:cursor]
    destination_end = cursor

    def line_end(position: int) -> int:
        end = text.find("\n", position)
        if end < 0:
            return length
        return end - 1 if end > position and text[end - 1] == "\r" else end

    first_line_end = line_end(destination_end)
    separator = destination_end
    while separator < first_line_end and text[separator] in " \t":
        separator += 1
    if separator == first_line_end:
        first_line_match_end = first_line_end
        after_newline = first_line_end
        if after_newline < length and text[after_newline] == "\r":
            after_newline += 1
        if after_newline < length and text[after_newline] == "\n":
            after_newline += 1
            title_start = after_newline
            while title_start < length and text[title_start] in " \t":
                title_start += 1
            if (
                title_start < length
                and next_blank_line[after_newline] != after_newline
                and text[title_start] in "\"'("
            ):
                parsed_title = _reference_title_end(
                    text,
                    title_start,
                    next_double_quote,
                    next_single_quote,
                    next_parenthesis,
                    next_blank_line,
                )
                if parsed_title is not None:
                    title_end, title_line_end = parsed_title
                    if all(
                        character in " \t"
                        for character in text[title_end + 1 : title_line_end]
                    ):
                        return title_line_end, destination
        return first_line_match_end, destination

    if separator >= length or text[separator] not in "\"'(":
        return None
    parsed_title = _reference_title_end(
        text,
        separator,
        next_double_quote,
        next_single_quote,
        next_parenthesis,
        next_blank_line,
    )
    if parsed_title is None:
        return None
    title_end, title_line_end = parsed_title
    if not all(
        character in " \t" for character in text[title_end + 1 : title_line_end]
    ):
        return None
    return title_line_end, destination


def _reference_title_end(
    text: str,
    opening: int,
    next_double_quote: array,
    next_single_quote: array,
    next_parenthesis: array,
    next_blank_line: array,
) -> tuple[int, int] | None:
    delimiter_index = {
        '"': next_double_quote,
        "'": next_single_quote,
        "(": next_parenthesis,
    }.get(text[opening])
    if delimiter_index is None:
        return None
    closing = delimiter_index[opening + 1]
    if closing >= len(text) or next_blank_line[opening + 1] < closing:
        return None
    end = text.find("\n", closing + 1)
    if end < 0:
        line_end = len(text)
    else:
        line_end = end - 1 if end > closing and text[end - 1] == "\r" else end
    return closing, line_end


def _reference_definition_spans(
    source: str,
    valid_openings: set[int],
    line_contexts: dict[int, tuple[int, int, int]],
    label_closings: dict[int, int],
    blank_line_starts: bytearray,
) -> list[tuple[int, int]]:
    """Return valid reference definition spans with bounded delimiter scans."""
    escaped = _markdown_escaped_punctuation(source)
    (
        next_double_quote,
        next_single_quote,
        next_parenthesis,
        next_blank_line,
    ) = _next_unescaped_positions(source, escaped, blank_line_starts)
    spans: list[tuple[int, int]] = []
    consumed_until = 0
    for match in REFERENCE_DEFINITION_START.finditer(source):
        opening = match.end() - 1
        label_end = label_closings.get(opening)
        if label_end is None or match.start() < consumed_until:
            continue
        parsed = _reference_definition_end(
            source,
            label_end,
            next_double_quote,
            next_single_quote,
            next_parenthesis,
            next_blank_line,
        )
        if parsed is None:
            continue
        end, destination = parsed
        consumed_until = end
        if (
            opening in valid_openings
            and _valid_reference_destination(destination)
            and _reference_match_has_valid_containers(
                source, match.start(), end, line_contexts
            )
        ):
            spans.append((match.start(), end))
    return spans


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
            if cursor >= len(destination) or not escaped_punctuation(
                destination[cursor]
            ):
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
    return _outside_html_blocks(text, _mask_markdown_link_destinations_in_markdown)


def _mask_markdown_link_destinations_in_markdown(text: str) -> str:
    """Mask inline Markdown destinations/titles before scanning HTML tokens."""
    spans: list[tuple[int, int]] = []
    links = _MarkdownLinkIndex(text)
    label_openings: list[int] = []
    covered_until = 0
    for position, character in enumerate(text):
        if links.blank_line_starts[position]:
            label_openings.clear()
        if links.escaped[position]:
            continue
        if character == "[":
            label_openings.append(position)
            continue
        if character != "]" or not label_openings:
            continue
        label_openings.pop()
        if position < covered_until or text[position + 1 : position + 2] != "(":
            continue
        end = links.link_end(position)
        if end is not None:
            spans.append((position + 1, end + 1))
            covered_until = end + 1

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


def _mask_markdown_link_metadata(text: str) -> str:
    """Mask destinations, titles, and reference definitions; retain link labels."""
    return _outside_html_blocks(text, _mask_markdown_link_metadata_in_markdown)


def _mask_markdown_link_metadata_in_markdown(text: str) -> str:
    text = _mask_markdown_link_destinations_in_markdown(text)
    spans = _reference_definition_spans(*_reference_definition_scan_text(text))
    chunks: list[str] = []
    position = 0
    for start, end in spans:
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _escaped_container_tag_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for match in re.finditer(r"&lt;[^<>\r\n]*?&gt;", text, re.IGNORECASE):
        decoded = html.unescape(match.group())
        if re.fullmatch(r"</?\s*(?:details|summary)\b[^<>]*>", decoded, re.IGNORECASE):
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


def _restore_html_code_container_closers(
    source: str, masked: str, normalize_attributes: bool = False
) -> str:
    """Keep raw HTML code-container closers visible to the HTML tokenizer."""
    chunks: list[str] = []
    position = 0
    for match in HTML_CODE_CONTAINER_CLOSER.finditer(source):
        start = match.start()
        if start < position or _backslash_escaped(source, start):
            continue
        markup = _html_markup_at(source, start, require_complete=True)
        if markup is None:
            break
        end = markup[2]
        chunks.append(masked[position:start])
        if normalize_attributes:
            name = HTML_MARKUP_TAG_START.match(source, start)
            assert name is not None
            chunks.append(source[start : name.end()])
            chunks.append(re.sub(r"[^\r\n]", " ", source[name.end() : end - 1]))
            chunks.append(">")
        else:
            chunks.append(source[start:end])
        position = end
    chunks.append(masked[position:])
    return "".join(chunks)


def _html_markup_at(
    text: str, start: int, require_complete: bool = False
) -> tuple[str, bool, int] | None:
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

    match = HTML_MARKUP_TAG_START.match(text, start)
    if not match:
        return None
    closing = text[start + 1 : start + 2] == "/"
    tag = match.group(1).lower()
    quote: str | None = None
    for index in range(match.end(), len(text)):
        character = text[index]
        if quote:
            if character == quote:
                quote = None
        elif character in "\"'":
            quote = character
        elif character == ">":
            return tag, closing, index + 1
    return None if require_complete else (tag, closing, len(text))


def _incomplete_html_tag_quote(text: str) -> str | None:
    """Return the open quote state for a multiline HTML tag, if present."""
    position = 0
    while position < len(text):
        start = text.find("<", position)
        if start < 0:
            return None
        if _backslash_escaped(text, start):
            position = start + 1
            continue
        markup = _html_markup_at(text, start)
        if markup is None:
            position = start + 1
            continue
        tag, _, end = markup
        if tag and end == len(text) and text[end - 1 : end] != ">":
            opener = HTML_MARKUP_TAG_START.match(text, start)
            quote: str | None = None
            if opener is not None:
                for index in range(opener.end(), len(text)):
                    character = text[index]
                    if quote is not None:
                        if character == quote:
                            quote = None
                    elif character in "\"'":
                        quote = character
            return quote or ""
        position = end
    return None


def _continue_html_tag(quote: str, text: str) -> str | None:
    """Advance a multiline HTML tag through one physical line."""
    open_quote = quote or None
    for index, character in enumerate(text):
        if open_quote is not None:
            if character == open_quote:
                open_quote = None
        elif character in "\"'":
            open_quote = character
        elif character == ">":
            return _incomplete_html_tag_quote(text[index + 1 :])
    return open_quote or ""


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
                if end <= position or (end == len(text) and text[end - 1 : end] != ">"):
                    return None
                position = end
                continue
        position += 1
    return None


def _mask_code_line(line: str) -> str:
    """Mask code while preserving every source character offset."""
    return "".join(character if character in "\r\n" else " " for character in line)


def _actual_metadata(
    text: str,
    html_scan: str | None = None,
    raw_html_blocks: list[tuple[int, int]] | None = None,
) -> str:
    """Mask Markdown code blocks while retaining physical line positions."""
    if html_scan is None:
        html_scan = _mask_markdown_link_destinations(_without_inline_code(text))
    masked: list[str] = []
    fence_char: str | None = None
    fence_length = 0
    fence_quotes = 0
    fence_list_indent = 0
    indented_code = False
    block_boundary = True
    html_paragraph_boundary = True
    active_list_indent: int | None = None
    list_has_blank = False
    html_tag_open = False
    html_tag_quote = ""
    html_block_active = False
    html_block_terminator: re.Pattern[str] | str = ""
    html_block_start = 0
    html_block_quotes = 0
    html_block_list_indent = 0
    previous_quotes = 0
    offset = 0

    def finish_html_block(end: int) -> None:
        nonlocal html_block_active, block_boundary, html_paragraph_boundary
        nonlocal html_tag_open, html_tag_quote
        if raw_html_blocks is not None:
            raw_html_blocks.append((html_block_start, end))
        html_block_active = False
        block_boundary = True
        html_paragraph_boundary = True
        html_tag_open = False
        html_tag_quote = ""

    def html_block_finished(content: str) -> bool:
        if not html_block_terminator:
            return False
        if isinstance(html_block_terminator, str):
            return html_block_terminator in content
        return html_block_terminator.search(content) is not None

    for line in _markdown_lines(text, keepends=True):
        line_start = offset
        source_line = line.rstrip("\r\n")
        html_line = html_scan[offset : offset + len(line)].rstrip("\r\n")
        offset += len(line)
        if fence_char is not None:
            content, found_quotes = _strip_quote_prefix(source_line, fence_quotes)
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
            masked.append(_mask_code_line(line))
            if closing:
                fence_char = None
                fence_length = 0
                fence_quotes = 0
                fence_list_indent = 0
                block_boundary = True
                html_paragraph_boundary = True
            continue

        if html_block_active:
            raw_content, quotes = _strip_quote_prefix(source_line, html_block_quotes)
            container_ended = quotes != html_block_quotes or (
                html_block_list_indent
                and raw_content.strip(" \t")
                and _column_indent(raw_content) < html_block_list_indent
            )
            if container_ended or (
                not html_block_terminator and not raw_content.strip(" \t")
            ):
                finish_html_block(line_start)
                if container_ended and html_block_list_indent:
                    active_list_indent = None
                    list_has_blank = False
            else:
                masked.append(line)
                if html_block_finished(raw_content):
                    finish_html_block(offset)
                continue

        if html_tag_open:
            masked.append(line)
            next_quote = _continue_html_tag(html_tag_quote, html_line)
            if next_quote is None:
                html_tag_open = False
                html_tag_quote = ""
                block_boundary = False
            else:
                html_tag_quote = next_quote
            continue

        content, quotes, list_indent = _block_prefix(source_line)
        match = FENCE_LINE.match(content)
        if match and match.group("char") == "`" and "`" in match.group("info"):
            match = None
        if match:
            fence_char = match.group("char")
            fence_length = len(match.group("count")) + 1
            fence_quotes = quotes
            fence_list_indent = list_indent
            masked.append(_mask_code_line(line))
            block_boundary = True
            indented_code = False
            html_paragraph_boundary = True
            continue

        plain, _ = _strip_quote_prefix(line.rstrip("\r\n"))
        indent = _column_indent(plain)
        if not plain.strip():
            masked.append(_mask_code_line(line))
            if active_list_indent is not None:
                list_has_blank = True
            block_boundary = True
            html_paragraph_boundary = True
            continue

        if list_indent:
            active_list_indent = list_indent
            list_has_blank = False
        elif active_list_indent is not None:
            starts_root_block = bool(
                RESULT_HEADING.match(content)
                or re.match(
                    r"^[ ]{0,3}(?:#{1,6}[ \t]|>|[-+*][ \t]|[0-9]+[.)][ \t])",
                    content,
                )
            )
            if (list_has_blank and indent < active_list_indent) or starts_root_block:
                active_list_indent = None
                list_has_blank = False
            else:
                list_has_blank = False

        code_indent = 4 + (list_indent or active_list_indent or 0)
        if indent >= code_indent and (indented_code or block_boundary):
            masked.append(_mask_code_line(line))
            indented_code = True
            html_paragraph_boundary = True
            continue
        indented_code = False

        raw_content = content
        inherited_indent = 0 if list_indent else (active_list_indent or 0)
        if inherited_indent:
            raw_content = _strip_list_indent(raw_content, inherited_indent)
        terminator = _html_block_end(
            raw_content,
            html_paragraph_boundary or bool(list_indent) or quotes != previous_quotes,
        )
        previous_quotes = quotes
        if terminator is not None:
            html_block_active = True
            html_block_terminator = terminator
            html_block_start = line_start
            html_block_quotes = quotes
            html_block_list_indent = list_indent or inherited_indent
            masked.append(line)
            if html_block_finished(raw_content):
                finish_html_block(offset)
            continue

        pending_html_quote = _incomplete_html_tag_quote(html_line)
        if pending_html_quote is not None:
            masked.append(line)
            html_tag_open = True
            html_tag_quote = pending_html_quote
            block_boundary = False
            html_paragraph_boundary = False
            continue

        masked.append(line)
        stripped = line.rstrip("\r\n")
        block_content = content.strip()
        block_boundary = bool(
            RESULT_HEADING.match(content)
            or (quotes and not block_content)
            or (list_indent and not block_content)
            or re.match(r"^[ ]{0,3}(?:#{1,6}[ \t]|>)", stripped)
        )
        html_paragraph_boundary = bool(
            re.match(r"^[ ]{0,3}#{1,6}(?:[ \t]|$)", content)
            or re.fullmatch(r"[ ]{0,3}(?:=+|-+)[ \t]*", content)
            or re.fullmatch(r"[ ]{0,3}(?:\*[ \t]*){3,}", content)
            or re.fullmatch(r"[ ]{0,3}(?:_[ \t]*){3,}", content)
        )
    if html_block_active:
        finish_html_block(len(text))
    return "".join(masked)


def _visible_html(
    text: str,
    visible_open: bool = True,
    mask_attributes: bool = False,
    visible_summary_ranges: list[tuple[int, int]] | None = None,
    markdown_preprocessed: bool = False,
    decode_entities: bool = False,
    raw_html_blocks: list[tuple[int, int]] | None = None,
    strip_inline_markup: bool = False,
) -> str:
    """Mask only container spans, preserving visible prefixes and suffixes."""
    metadata = text if markdown_preprocessed else _actual_metadata(text)
    scan = (
        metadata
        if markdown_preprocessed
        else _restore_html_code_container_closers(
            metadata, _without_inline_code(metadata)
        )
    )
    # Markdown destinations and titles are not HTML. Mask them only in the
    # parser input so their literal tags cannot open containers or shift offsets.
    escaped_markup_spans = _escaped_container_tag_spans(scan)
    parser_scan = scan if markdown_preprocessed else _mask_markdown_link_metadata(scan)
    # HTMLParser's script/style mode only recognizes whitespace-only end tags.
    # Normalize valid closers in its input while retaining every source offset.
    parser_scan = _restore_html_code_container_closers(
        parser_scan, parser_scan, normalize_attributes=True
    )
    parser_scan = _mask_escaped_container_tags(parser_scan)
    unterminated_comment = _unterminated_html_comment_start(parser_scan)
    # Python 3.9's HTMLParser does not recognize HTML's --!> comment end tag.
    # Normalize only its parser input, without changing source offsets.
    parser_scan = parser_scan.replace("--!>", "--->")
    line_offsets = [0]
    line_offsets.extend(match.end() for match in re.finditer("\n", scan))
    tokens: list[tuple[int, int, str, bool, str]] = []
    attribute_spans: list[tuple[int, int]] = []
    inline_markup_spans: list[tuple[int, int]] = []
    block_markup_spans: list[tuple[int, int]] = []

    class ContainerParser(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=False)
            self.open_elements: list[tuple[str, str, bool]] = []
            self.open_element_counts: dict[str, int] = {}
            self.html_open_element_counts: dict[str, int] = {}
            self.body_contexts: list[bool] = []
            self.table_modes: list[bool] = []
            self.active_form_index: int | None = None
            self.active_form_on_stack = False
            self.template_depth = 0
            self.direct_summaries: set[int] = set()

        def _pop_elements(self, index: int, start: int, end: int) -> None:
            # Replay every visibility transition made by tree-stack truncation,
            # including descendants implicitly closed by an ancestor end tag.
            for popped in range(len(self.open_elements) - 1, index - 1, -1):
                tag, namespace, _ = self.open_elements[popped]
                self.open_element_counts[tag] -= 1
                if namespace != "html":
                    continue
                self.html_open_element_counts[tag] -= 1
                if tag == "template":
                    self.template_depth -= 1
                if tag in HTML_CODE_CONTAINER_TAGS:
                    kind = "code-close"
                elif tag == "summary":
                    kind = "summary-close"
                elif tag == "details":
                    kind = "details-close"
                else:
                    continue
                tokens.append(
                    (
                        start,
                        end if popped == index else start,
                        kind,
                        popped in self.direct_summaries,
                        tag,
                    )
                )
            self.direct_summaries.difference_update(
                range(index, len(self.open_elements))
            )
            if self.active_form_index is not None and self.active_form_index >= index:
                # Implicit closure removes the node, but not the HTML form pointer.
                self.active_form_on_stack = False
            del self.open_elements[index:]
            del self.body_contexts[index:]
            del self.table_modes[index:]

        def _summary_parent_is_details(self) -> bool:
            if not self.open_elements:
                return False
            if self.open_elements[-1][:2] == ("details", "html"):
                return True
            # In table insertion modes, non-table content is inserted before
            # the last table. Cell/caption content keeps its ordinary parent.
            if self.open_elements[-1][1] != "html" or self.open_elements[-1][0] not in {
                "table",
                "tbody",
                "tfoot",
                "thead",
                "tr",
            }:
                return False
            for index in range(len(self.open_elements) - 1, -1, -1):
                if self.open_elements[index][:2] == ("template", "html"):
                    return False
                if self.open_elements[index][:2] == ("table", "html"):
                    return index > 0 and self.open_elements[index - 1][:2] == (
                        "details",
                        "html",
                    )
            return False

        def _in_body_insertion_context(self) -> bool:
            # Cache context with the stack so repeated invalid tags cannot scan
            # a deep parent chain. Ambiguous template modes remain unchanged.
            return self.template_depth == 0 and (
                not self.body_contexts or self.body_contexts[-1]
            )

        def _table_insertion_index(self) -> int | None:
            if not self.table_modes or not self.table_modes[-1]:
                return None
            return next(
                (
                    index
                    for index in range(len(self.open_elements) - 1, -1, -1)
                    if self.open_elements[index][:2] == ("table", "html")
                ),
                None,
            )

        def _ignore_start_markup(self, start: int) -> None:
            if strip_inline_markup:
                inline_markup_spans.append(
                    (start, start + len(self.get_starttag_text()))
                )

        def _ignore_end_markup(self, start: int) -> None:
            if strip_inline_markup:
                markup = _html_markup_at(scan, start)
                if markup is not None:
                    inline_markup_spans.append((start, markup[2]))

        def _start_tag_namespace(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> str:
            if not self.open_elements:
                parent_tag, parent_namespace, parent_html_integration = (
                    "",
                    "html",
                    False,
                )
            else:
                parent_tag, parent_namespace, parent_html_integration = (
                    self.open_elements[-1]
                )

            process_as_html = parent_namespace == "html"
            if parent_namespace == "svg":
                process_as_html = parent_tag in SVG_HTML_INTEGRATION_POINT_TAGS
            elif parent_namespace == "math":
                process_as_html = parent_html_integration or (
                    parent_tag in MATHML_TEXT_INTEGRATION_POINT_TAGS
                    and tag not in {"mglyph", "malignmark"}
                )

            if not process_as_html and (
                tag in HTML_FOREIGN_BREAKOUT_TAGS
                or (
                    tag == "font"
                    and any(name in {"color", "face", "size"} for name, _ in attrs)
                )
            ):
                index = len(self.open_elements) - 1
                while index >= 0:
                    element, namespace, integration = self.open_elements[index]
                    if (
                        namespace == "html"
                        or (
                            namespace == "svg"
                            and element in SVG_HTML_INTEGRATION_POINT_TAGS
                        )
                        or (
                            namespace == "math"
                            and (
                                integration
                                or element in MATHML_TEXT_INTEGRATION_POINT_TAGS
                            )
                        )
                    ):
                        break
                    index -= 1
                self._pop_elements(index + 1, self._offset(), self._offset())
                return self._start_tag_namespace(tag, attrs)
            if not process_as_html:
                return parent_namespace
            if tag == "svg":
                return "svg"
            if tag == "math":
                return "math"
            return "html"

        @staticmethod
        def _is_button_scope_boundary(tag: str, namespace: str) -> bool:
            if namespace == "html":
                return tag in HTML_BUTTON_SCOPE_BOUNDARY_TAGS
            if namespace == "svg":
                return tag in SVG_BUTTON_SCOPE_BOUNDARY_TAGS
            if namespace == "math":
                return tag in MATHML_BUTTON_SCOPE_BOUNDARY_TAGS
            return False

        def _offset(self) -> int:
            line, column = self.getpos()
            return line_offsets[line - 1] + column

        def _close_implied_item(self, tag: str) -> None:
            targets = {"li"} if tag == "li" else {"dt", "dd"}
            if not any(
                self.html_open_element_counts.get(target, 0) for target in targets
            ):
                return
            for index in range(len(self.open_elements) - 1, -1, -1):
                element, namespace, _ = self.open_elements[index]
                if namespace == "html":
                    if element in targets:
                        self._pop_elements(index, self._offset(), self._offset())
                        return
                    if element in HTML_ITEM_START_BOUNDARY_TAGS:
                        return
                elif self._is_button_scope_boundary(element, namespace):
                    return

        def _element_in_scope(self, tag: str) -> int | None:
            if not self.html_open_element_counts.get(tag, 0):
                return None
            for index in range(len(self.open_elements) - 1, -1, -1):
                element, namespace, _ = self.open_elements[index]
                if namespace == "html":
                    if element == tag:
                        return index
                    if element in HTML_SCOPE_BOUNDARY_TAGS:
                        return None
                    if tag == "li" and element in {"ol", "ul"}:
                        return None
                elif self._is_button_scope_boundary(element, namespace):
                    return None
            return None

        def _generate_implied_end_tags(self, exclude: str = "") -> None:
            while self.open_elements:
                tag, namespace, _ = self.open_elements[-1]
                if (
                    namespace != "html"
                    or tag not in HTML_IMPLIED_END_TAGS
                    or tag == exclude
                ):
                    return
                self._pop_elements(
                    len(self.open_elements) - 1, self._offset(), self._offset()
                )

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

        def handle_starttag(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> None:
            if not re.match(
                r"<[A-Za-z][A-Za-z0-9-]*(?=[ \t\r\n\v\f/>])",
                self.get_starttag_text(),
            ):
                return
            normalized_tag = tag.lower()
            start = self._offset()
            if _backslash_escaped(scan, start):
                return
            if mask_attributes:
                tag_text = self.get_starttag_text()
                tag_name = HTML_MARKUP_TAG_START.match(tag_text)
                if tag_name is not None and tag_text.endswith(">"):
                    attribute_start = start + tag_name.end()
                    attribute_end = start + len(tag_text) - 1
                    if attribute_start < attribute_end:
                        attribute_spans.append((attribute_start, attribute_end))
            namespace = self._start_tag_namespace(normalized_tag, attrs)
            if (
                namespace == "html"
                and normalized_tag in HTML_IN_BODY_IGNORED_START_TAGS
                and (
                    normalized_tag in {"body", "frame", "frameset", "head", "html"}
                    or self._in_body_insertion_context()
                )
            ):
                # Review bodies are fragments: document wrappers cannot create
                # children or enable frameset insertion in the existing body.
                self._ignore_start_markup(start)
                return
            table_mode = bool(self.table_modes and self.table_modes[-1])
            if namespace == "html" and normalized_tag == "form":
                if self.template_depth == 0 and self.active_form_index is not None:
                    self._ignore_start_markup(start)
                    return
            if (
                namespace == "html"
                and normalized_tag == "table"
                and self.template_depth == 0
            ):
                table_index = self._table_insertion_index()
                if table_index is not None:
                    # In-table insertion closes the current table and then
                    # reprocesses the start in its parent's insertion context.
                    self._pop_elements(table_index, start, start)
            if (
                namespace == "html"
                and normalized_tag == "summary"
                and self.open_elements
                and self.open_elements[-1][:2] == ("colgroup", "html")
            ):
                # An in-column-group non-column token closes the group and is
                # reprocessed in the table insertion mode.
                self._pop_elements(len(self.open_elements) - 1, start, start)
            if namespace == "html" and normalized_tag == "button":
                # In-body button insertion closes an existing button in scope,
                # including visibility containers implicitly popped with it.
                button_index = self._element_in_scope("button")
                if button_index is not None:
                    self._generate_implied_end_tags()
                    self._pop_elements(button_index, start, start)
            if namespace == "html" and normalized_tag in HTML_ITEM_TAGS:
                self._close_implied_item(normalized_tag)
            if namespace == "html" and normalized_tag in {"option", "optgroup"}:
                if self._element_in_scope("select") is not None:
                    exclude = "optgroup" if normalized_tag == "option" else ""
                    self._generate_implied_end_tags(exclude)
                elif self.open_elements and self.open_elements[-1][:2] == (
                    "option",
                    "html",
                ):
                    self._pop_elements(len(self.open_elements) - 1, start, start)
            if (
                namespace == "html"
                and normalized_tag in HTML_P_CLOSING_START_TAGS
                and self.html_open_element_counts.get("p", 0)
            ):
                paragraph_index = None
                for index in range(len(self.open_elements) - 1, -1, -1):
                    element, element_namespace, _ = self.open_elements[index]
                    if self._is_button_scope_boundary(element, element_namespace):
                        break
                    if element == "p" and element_namespace == "html":
                        paragraph_index = index
                        break
                if paragraph_index is not None:
                    self._pop_elements(paragraph_index, start, start)
            if (
                namespace == "html"
                and normalized_tag in HTML_HEADING_TAGS
                and self.open_elements
                and self.open_elements[-1][0] in HTML_HEADING_TAGS
                and self.open_elements[-1][1] == "html"
            ):
                self._pop_elements(len(self.open_elements) - 1, start, start)
            if (
                strip_inline_markup
                and namespace == "html"
                and normalized_tag
                not in (HTML_CODE_CONTAINER_TAGS | {"details", "summary"})
            ):
                end = start + len(self.get_starttag_text())
                destination = (
                    block_markup_spans
                    if normalized_tag in HTML_BLOCK_TAGS or normalized_tag == "br"
                    else inline_markup_spans
                )
                destination.append((start, end))
            if namespace == "html" and (
                normalized_tag in HTML_CODE_CONTAINER_TAGS
                or normalized_tag in {"details", "summary"}
            ):
                end = start + len(self.get_starttag_text())
                if normalized_tag in HTML_CODE_CONTAINER_TAGS:
                    tokens.append((start, end, "code-open", False, normalized_tag))
                elif normalized_tag == "summary":
                    direct_child = self._summary_parent_is_details()
                    if direct_child:
                        self.direct_summaries.add(len(self.open_elements))
                    tokens.append(
                        (start, end, "summary-open", direct_child, normalized_tag)
                    )
                else:
                    expanded = any(name.lower() == "open" for name, _ in attrs)
                    tokens.append(
                        (start, end, "details-open", expanded, normalized_tag)
                    )
            if namespace != "html" or normalized_tag not in HTML_VOID_TAGS:
                attrs_by_name = dict(attrs)
                encoding = (attrs_by_name.get("encoding") or "").lower()
                mathml_html_integration = (
                    namespace == "math"
                    and normalized_tag == "annotation-xml"
                    and encoding in {"text/html", "application/xhtml+xml"}
                )
                in_body = self.body_contexts[-1] if self.body_contexts else True
                if namespace != "html":
                    # An outer table does not govern HTML integration content.
                    in_body = True
                elif normalized_tag in HTML_TABLE_CONTEXT_TAGS:
                    in_body = False
                elif normalized_tag == "template":
                    self.template_depth += 1
                in_table = bool(self.table_modes and self.table_modes[-1])
                if namespace != "html" or normalized_tag in {
                    "caption",
                    "td",
                    "th",
                    "template",
                }:
                    in_table = False
                elif normalized_tag == "table":
                    in_table = True
                self.open_elements.append(
                    (normalized_tag, namespace, mathml_html_integration)
                )
                self.open_element_counts[normalized_tag] = (
                    self.open_element_counts.get(normalized_tag, 0) + 1
                )
                if namespace == "html":
                    self.html_open_element_counts[normalized_tag] = (
                        self.html_open_element_counts.get(normalized_tag, 0) + 1
                    )
                self.body_contexts.append(in_body)
                self.table_modes.append(in_table)
                if namespace == "html" and normalized_tag == "form":
                    if self.template_depth == 0:
                        self.active_form_index = len(self.open_elements) - 1
                        self.active_form_on_stack = True
                    if table_mode:
                        # In-table forms immediately leave the stack, including
                        # in templates; only ordinary parsing sets the pointer.
                        self._pop_elements(len(self.open_elements) - 1, start, start)

        def handle_startendtag(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> None:
            # HTML ignores self-closing flags on these non-void containers.
            self.handle_starttag(tag, attrs)

        def handle_endtag(self, tag: str) -> None:
            normalized_tag = tag.lower()
            start = self._offset()
            if _backslash_escaped(scan, start):
                return
            if mask_attributes:
                markup = _html_markup_at(scan, start)
                tag_name = HTML_MARKUP_TAG_START.match(scan, start)
                if markup is not None and markup[1] and tag_name is not None:
                    attribute_start = tag_name.end()
                    attribute_end = markup[2] - 1
                    if attribute_start < attribute_end:
                        attribute_spans.append((attribute_start, attribute_end))
            matching_index = (
                next(
                    (
                        index
                        for index in range(len(self.open_elements) - 1, -1, -1)
                        if self.open_elements[index][0] == normalized_tag
                    ),
                    None,
                )
                if self.open_element_counts.get(normalized_tag, 0)
                else None
            )
            matching_namespace = (
                self.open_elements[matching_index][1]
                if matching_index is not None
                else "html"
            )
            if matching_namespace == "html" and normalized_tag == "form":
                if self.template_depth == 0:
                    form_index = self.active_form_index
                    on_stack = self.active_form_on_stack
                    self.active_form_index = None
                    self.active_form_on_stack = False
                    if (
                        form_index is None
                        or not on_stack
                        or self._element_in_scope("form") != form_index
                    ):
                        self._ignore_end_markup(start)
                        return
                    self._generate_implied_end_tags()
                    # HTML removes only the active form node. Descendants stay
                    # open and keep their existing summary visibility identity.
                    self.open_element_counts[self.open_elements[form_index][0]] -= 1
                    self.html_open_element_counts[
                        self.open_elements[form_index][0]
                    ] -= 1
                    del self.open_elements[form_index]
                    del self.body_contexts[form_index]
                    del self.table_modes[form_index]
                    self.direct_summaries = {
                        index - 1 if index > form_index else index
                        for index in self.direct_summaries
                    }
                    if strip_inline_markup:
                        markup = _html_markup_at(scan, start)
                        if markup is not None:
                            block_markup_spans.append((start, markup[2]))
                    return
                matching_index = self._element_in_scope("form")
                if matching_index is None:
                    self._ignore_end_markup(start)
                    return
                self._generate_implied_end_tags()
            if matching_namespace == "html" and (
                normalized_tag in HTML_ITEM_TAGS or normalized_tag == "button"
            ):
                matching_index = self._element_in_scope(normalized_tag)
                if matching_index is None:
                    self._ignore_end_markup(start)
                    return
            if (
                strip_inline_markup
                and matching_namespace == "html"
                and (
                    matching_index is None
                    or normalized_tag
                    not in (HTML_CODE_CONTAINER_TAGS | {"details", "summary"})
                )
            ):
                markup = _html_markup_at(scan, start)
                if markup is not None:
                    # Ignored end tags have no rendered separator. An unmatched
                    # p/br closer is instead reprocessed as a real element.
                    separates = normalized_tag in {"p", "br"} or (
                        matching_index is not None and normalized_tag in HTML_BLOCK_TAGS
                    )
                    destination = (
                        block_markup_spans if separates else inline_markup_spans
                    )
                    destination.append((start, markup[2]))
            if matching_index is not None:
                markup = _html_markup_at(scan, start)
                self._pop_elements(
                    matching_index, start, markup[2] if markup else start
                )

    parser = ContainerParser()
    parser.feed(parser_scan)
    parser.close()
    if unterminated_comment is not None:
        tokens.append((unterminated_comment, len(scan), "comment", False, ""))
    tokens.sort(key=lambda token: token[0])

    details: list[dict[str, bool]] = []
    code_tags: list[str] = []
    open_summaries: list[tuple[int, bool, int]] = []
    start: int | None = None
    spans: list[tuple[int, int]] = []
    markup_spans = list(escaped_markup_spans) + inline_markup_spans
    spans.extend(attribute_spans)
    spans.extend(block_markup_spans)

    def hidden_state() -> bool:
        return bool(code_tags) or any(
            not visible_open or (not item["expanded"] and not item["in_summary"])
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
            details.append(
                {"expanded": expanded, "in_summary": False, "summary_seen": False}
            )
        elif kind == "details-close" and details:
            details.pop()
        elif kind == "summary-open" and details and expanded:
            if not details[-1]["summary_seen"]:
                details[-1]["summary_seen"] = True
                if visible_open and not details[-1]["expanded"]:
                    details[-1]["in_summary"] = True
        elif (
            kind == "summary-close"
            and expanded
            and details
            and details[-1]["in_summary"]
        ):
            details[-1]["in_summary"] = False
        is_hidden = hidden_state()
        if kind == "summary-open" and expanded:
            open_summaries.append((token_end, not is_hidden, len(details)))
        elif kind == "summary-close" and expanded and open_summaries:
            summary_start, summary_visible, _ = open_summaries.pop()
            if summary_visible and visible_summary_ranges is not None:
                visible_summary_ranges.append((summary_start, token_start))
        elif kind == "details-close":
            while open_summaries and open_summaries[-1][2] > len(details):
                summary_start, summary_visible, _ = open_summaries.pop()
                if summary_visible and visible_summary_ranges is not None:
                    visible_summary_ranges.append((summary_start, token_start))
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
        elif (
            not was_hidden
            and not is_hidden
            and kind
            in {
                "details-open",
                "details-close",
                "summary-open",
                "summary-close",
            }
        ):
            markup_spans.append((token_start, token_end))
    if start is not None:
        spans.append((start, len(text)))
    if visible_summary_ranges is not None:
        for summary_start, summary_visible, _ in open_summaries:
            if summary_visible:
                visible_summary_ranges.append((summary_start, len(text)))
    replacements = sorted(
        [(start, end, False) for start, end in spans]
        + [(start, end, True) for start, end in markup_spans],
        key=lambda span: (span[0], -span[1], span[2]),
    )
    raw_context = bytearray(len(text))
    escaped = bytearray()
    if decode_entities:
        for raw_start, raw_end in (
            _html_block_spans(text) if raw_html_blocks is None else raw_html_blocks
        ):
            raw_context[raw_start:raw_end] = b"\x01" * (raw_end - raw_start)
        escaped = _markdown_escaped_punctuation(text)

    def visible_text(start: int, end: int) -> str:
        chunk = text[start:end]
        if not decode_entities:
            return chunk

        def decode(match: re.Match[str]) -> str:
            reference = match.group()
            raw = bool(raw_context[start + match.start()])
            if not raw:
                if escaped[start + match.start()] or not reference.endswith(";"):
                    return reference
                name = reference[1:-1]
                if name.startswith("#"):
                    hexadecimal = name[1:2].lower() == "x"
                    digits = name[2:] if hexadecimal else name[1:]
                    if len(digits) > (6 if hexadecimal else 7):
                        return reference
                elif name + ";" not in html.entities.html5:
                    return reference
            if reference.startswith("&#"):
                hexadecimal = reference[2:3].lower() == "x"
                digits = reference[3:] if hexadecimal else reference[2:]
                digits = digits.rstrip(";").lstrip("0") or "0"
                if len(digits) > (6 if hexadecimal else 7):
                    return "\ufffd"
                reference = "&#" + ("x" if hexadecimal else "") + digits + ";"
            return html.unescape(reference).translate(EVIDENCE_LINE_SEPARATORS)

        return VISIBLE_CHARACTER_REFERENCE.sub(decode, chunk)

    chunks: list[str] = []
    position = 0
    for start, end, remove_markup in replacements:
        if start < position:
            continue
        chunks.append(visible_text(position, start))
        replacement = "" if remove_markup else " "
        chunks.append(re.sub(r"[^\r\n]", replacement, text[start:end]))
        position = end
    chunks.append(visible_text(position, len(text)))
    return "".join(chunks)


def _commit_metadata(text: str) -> str:
    """Keep commit authority outside expandable, commented and code examples."""
    metadata = _visible_html(
        _actual_metadata(text), visible_open=False, mask_attributes=True
    )
    code_lines = _markdown_lines(_without_inline_code(metadata), keepends=True)
    lines: list[str] = []
    quote_active = False
    list_content_indent: int | None = None
    list_after_blank = False
    for index, line in enumerate(_markdown_lines(metadata, keepends=True)):
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
                or re.match(
                    r"^[ ]{0,3}(?:#{1,6}[ \t]|[-+*][ \t]|[0-9]+[.)][ \t])",
                    structural,
                )
            )
            if quote_depth:
                quote_active = True
            elif root_block:
                quote_active = False

            if list_indent:
                list_content_indent = list_indent
                list_after_blank = False
            elif list_content_indent is not None:
                if (list_after_blank and indent < list_content_indent) or root_block:
                    list_content_indent = None
                    list_after_blank = False
                else:
                    list_after_blank = False

        in_list = list_content_indent is not None and (
            not list_after_blank or indent >= list_content_indent
        )
        if REVIEWED_COMMIT.fullmatch(source) and (
            not code_lines[index].strip() or quote_active or quote_depth or in_list
        ):
            lines.append(re.sub(r"[^\r\n]", " ", line))
        else:
            lines.append(line)
    return "".join(lines)


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
    container_tag = re.compile(r"</?\s*(?:details|summary)\b[^<>]*>", re.IGNORECASE)
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
    lines = _markdown_lines(rest)
    structural_text = _visible_html(_actual_metadata(rest))
    structural_lines = _markdown_lines(
        _without_inline_code(_mask_backslash_escaped_container_tags(structural_text))
    )
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
    original_lines = _markdown_lines(body)
    authority_lines = _markdown_lines(_commit_metadata(body))
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
    lines = _markdown_lines(
        _without_inline_code(_mask_backslash_escaped_container_tags(structural_text))
    )
    priority_lines = _markdown_lines(
        _visible_html(
            _mask_markdown_link_metadata(_without_inline_code(_actual_metadata(body))),
            mask_attributes=True,
            markdown_preprocessed=True,
            decode_entities=True,
        )
    )
    starts: list[int] = []
    kinds: dict[int, str] = {}
    reviewed_counts = [0]
    inline_security_counts = [0]
    priority_counts = [0]
    priority_matches = [
        bool(
            PRIORITY_RESULT.match(line) or PRIORITY_RESULT.match(priority_lines[index])
        )
        for index, line in enumerate(lines)
    ]
    inline_security_matches = [
        bool(
            INLINE_SECURITY_MARKER.search(line)
            or (
                SECURITY_MARKER_COMMENT.search(line)
                and INLINE_SECURITY_MARKER.search(priority_lines[index])
            )
        )
        for index, line in enumerate(lines)
    ]
    for index, _line in enumerate(lines):
        reviewed_counts.append(
            reviewed_counts[-1]
            + bool(REVIEWED_COMMIT.fullmatch(authority_lines[index]))
        )
        inline_security_counts.append(
            inline_security_counts[-1] + inline_security_matches[index]
        )
        priority_counts.append(priority_counts[-1] + priority_matches[index])
    for i, line in enumerate(lines):
        if RESULT_HEADING.match(line):
            starts.append(i)
            kinds[i] = "security" if SECURITY_HEADING.match(line) else "regular"
        elif priority_matches[i]:
            previous_start = starts[-1] if starts else 0
            previous_bound = reviewed_counts[i] > reviewed_counts[previous_start]
            prior_priority = priority_counts[i] > priority_counts[previous_start]
            regular_clean = False
            security_clean = False
            if starts and not prior_priority:
                # A visible priority line makes a strict standalone clean result
                # impossible. Inspect each result's pre-list text only once.
                previous = "\n".join(original_lines[previous_start:i])
                regular_clean = _standalone_regular_clean(previous)
                if coordinator_bound:
                    security_clean = _standalone_security_clean(previous)
            marker_start = i
            while marker_start > previous_start and (
                (
                    not lines[marker_start - 1].strip()
                    and not original_lines[marker_start - 1].strip()
                )
                or SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                or (
                    INLINE_SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                    and not priority_matches[marker_start - 1]
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
            inline_security = inline_security_matches[i]
            prior_inline_security = (
                inline_security_counts[i] > inline_security_counts[previous_start]
            )
            explicit_security_prior = bool(
                starts and SECURITY_HEADING.match(lines[previous_start])
            )
            if (
                not starts
                or previous_bound
                or regular_clean
                or security_clean
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
                            or previous_bound
                            or not security_clean
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
                and not priority_matches[marker_start - 1]
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
    lines = _markdown_lines(section)
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


def _markdown_priority_text(text: str) -> str:
    for pattern in (
        r"\[P(?P<em>\*{1,3})(?P<level>[0-3])(?P=em)\]",
        r"\[(?P<em>\*{1,3})P(?P=em)(?P<level>[0-3])\]",
        r"(?P<em>\*{1,3})\[P(?P<level>[0-3])\](?P=em)",
    ):
        text = re.sub(pattern, lambda match: "[P" + match.group("level") + "]", text)
    return text


def _security_facts(kind: str, section: str) -> tuple[bool, bool]:
    raw_section = section
    source = _without_inline_code(_actual_metadata(raw_section))
    report_view = _visible_html(source, mask_attributes=True)
    source = _mask_markdown_link_metadata(source)
    raw_blocks = _html_block_spans(source)
    raw_block_starts = [start for start, _ in raw_blocks]
    raw_block_ends = [end for _, end in raw_blocks]
    visible_summaries: list[tuple[int, int]] = []
    section = _visible_html(
        source,
        mask_attributes=True,
        visible_summary_ranges=visible_summaries,
        markdown_preprocessed=True,
    )
    severity_text = _visible_html(
        source,
        mask_attributes=True,
        markdown_preprocessed=True,
        decode_entities=True,
        raw_html_blocks=raw_blocks,
        strip_inline_markup=True,
    )
    if visible_summaries:
        summary_text = []
        decoded_summaries = []
        for start, end in visible_summaries:
            summary_blocks = [
                (max(block_start, start) - start, min(block_end, end) - start)
                for block_start, block_end in raw_blocks[
                    bisect_right(raw_block_ends, start) : bisect_left(
                        raw_block_starts, end
                    )
                ]
            ]
            summary_html = _visible_html(
                source[start:end],
                mask_attributes=True,
                markdown_preprocessed=True,
            )
            summary_decoded = _visible_html(
                source[start:end],
                mask_attributes=True,
                markdown_preprocessed=True,
                decode_entities=True,
                raw_html_blocks=summary_blocks,
                strip_inline_markup=True,
            )
            summary_text.append(re.sub(r"</?[^>]+>", " ", summary_html))
            decoded_summaries.append(re.sub(r"</?[^>]+>", " ", summary_decoded))
        section = "\n".join((section, *summary_text))
        severity_text = "\n".join((severity_text, *decoded_summaries))
    section = _markdown_priority_text(section)
    severity_text = _markdown_priority_text(severity_text)
    report_link_candidates = list(SECURITY_REPORT_LINK.finditer(report_view))
    marker = bool(INLINE_SECURITY_MARKER.search(section)) or (
        kind in ("security", "unheaded") and bool(SECURITY_MARKER.search(section))
    )
    marker = marker or any(
        SECURITY_MARKER_COMMENT.search(raw_line)
        and INLINE_SECURITY_MARKER.search(decoded_line)
        # Preserve truncation and the ambient Python 3.9 host compatibility.
        for raw_line, decoded_line in zip(  # noqa: B905
            _markdown_lines(section), _markdown_lines(severity_text)
        )
    )
    coordinator_marker = (
        kind == "regular"
        and "retry reason" in section.casefold()
        and bool(SECURITY_MARKER_COMMENT.search(_without_inline_code(section)))
    )
    marker = marker or coordinator_marker
    heading = kind == "security"
    severity = bool(
        SECURITY_SEVERITY.search(severity_text)
        or (heading and re.search(r"(?i)\bP[0-3]\b", severity_text))
    )
    security_text = "\n".join(
        line
        for line in _markdown_lines(severity_text)
        if not SECURITY_MARKER.fullmatch(line)
    )
    unheaded_security = (
        bool(COORDINATOR_PRELUDE.match(section))
        and bool(re.search(r"(?i)\bP[0-3]\b", security_text))
        and bool(
            re.search(r"(?i)\bsecurity\b|\bvulnerab\w*|\bexploitable\b", security_text)
        )
    )
    report_link = any(
        section[match.start() : match.end() - 1].casefold()
        == "[view security finding report]"
        for match in report_link_candidates
    )
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


def _html_visibility_ambiguous(body: str) -> bool:
    """Accept only balanced, explicit HTML whose visibility needs no tree repair.

    This is an uncertainty boundary, not another HTML tree builder. Unsupported
    elements, attributes, malformed tokens and formatting reconstruction cannot
    authorize a clean verdict through the visibility approximation below.
    """
    scan = _mask_escaped_container_tags(
        _mask_markdown_link_metadata(_without_inline_code(_actual_metadata(body)))
    )
    # CommonMark URI/email autolinks are text, not raw HTML elements.
    scan = re.sub(
        r"<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*|"
        r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+)>",
        lambda match: _mask_code_line(match.group()),
        scan,
    )
    safe = frozenset(
        "div span details summary pre code a b strong em i u s sub sup br hr".split()
    )
    formatting = frozenset("a b strong em i u s".split())
    blocks = frozenset("div details summary pre hr".split())
    void = frozenset({"br", "hr"})
    offsets = [0] + [match.end() for match in re.finditer("\n", scan)]

    class ExplicitHTML(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=False)
            self.stack: list[str] = []
            self.active: set[str] = set()
            self.ambiguous = False

        def handle_starttag(self, tag, attrs):
            raw = self.get_starttag_text()
            if (
                tag not in safe
                or not re.match(r"<[A-Za-z][A-Za-z0-9-]*(?=[ \t\r\n\v\f/>])", raw)
                or re.search(r"[\v\f\x1c-\x1e\x85\u2028\u2029]", raw)
                or any(name != "open" or tag != "details" for name, _ in attrs)
                or len(attrs) > 1
                or tag in self.active
                or (tag in blocks and self.active)
            ):
                self.ambiguous = True
            if tag not in void:
                self.stack.append(tag)
                if tag in formatting:
                    self.active.add(tag)

        def handle_startendtag(self, tag, attrs):
            self.handle_starttag(tag, attrs)
            if tag not in void:
                # HTML ignores the self-closing flag on ordinary elements.
                self.ambiguous = True

        def handle_comment(self, data):
            # HTMLParser accepts legacy malformed comments that GFM can render
            # literally. Only the standard lexical form belongs to this subset.
            line, column = self.getpos()
            start = offsets[line - 1] + column
            raw = "<!--" + data + "-->"
            if (
                scan[start : start + len(raw)] != raw
                or data.startswith((">", "->"))
                or data.endswith("-")
                or "--" in data
            ):
                self.ambiguous = True

        def handle_decl(self, decl):
            self.ambiguous = True

        def unknown_decl(self, data):
            self.ambiguous = True

        def handle_pi(self, data):
            self.ambiguous = True

        def handle_endtag(self, tag):
            line, column = self.getpos()
            start = offsets[line - 1] + column
            end = scan.find(">", start)
            raw = scan[start : end + 1] if end >= 0 else ""
            if (
                not re.fullmatch(r"</[A-Za-z][A-Za-z0-9-]*[ \t\r\n]*>", raw)
                or not self.stack
                or self.stack[-1] != tag
            ):
                self.ambiguous = True
                return
            self.stack.pop()
            self.active.discard(tag)

    parser = ExplicitHTML()
    try:
        parser.feed(scan)
        parser.close()
    except (ValueError, AssertionError):
        return True
    return parser.ambiguous or bool(parser.stack)


def classify_body(body: str) -> dict[str, Any]:
    # Connector activity summaries are display metadata, never verdicts. Match
    # the anchored protocol marker, not a quoted marker in review prose.
    if re.match(r"\A\s*<!--\s*codex-pull-request-review-summary\s*-->", body, re.I):
        return {
            "request_head": None,
            "sections": [
                {
                    "kind": "unheaded",
                    "body": body,
                    "has_result": False,
                    "regular_clean": False,
                    "availability": False,
                    "regular_adverse": False,
                    "security_event": False,
                    "security_finding": False,
                    "target_ref": "__unbound__",
                }
            ],
        }
    ambiguous = _html_visibility_ambiguous(body)
    metadata = _without_inline_code(_actual_metadata(body))
    if SECURITY_MARKER_COMMENT.search(metadata) and any(
        _markdown_priority_text(match.group()) == match.group()
        for match in re.finditer(
            r"\[P(?=[^\]\r\n]{0,24}[*_~])(?=[^\]\r\n]{0,24}[0-3])[^\]\r\n]{1,24}\]",
            metadata,
        )
    ):
        ambiguous = True
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
        ordinary_source = _without_review_metadata(_without_known_review_footer(text))
        ordinary_source = _mask_markdown_link_metadata(
            _without_inline_code(_actual_metadata(ordinary_source))
        )
        ordinary_text = _visible_html(
            ordinary_source,
            mask_attributes=True,
            markdown_preprocessed=True,
            decode_entities=True,
            strip_inline_markup=True,
        )
        ordinary_text = _without_known_review_footer(ordinary_text)
        ordinary_text = _without_review_metadata(ordinary_text)
        ordinary_text = _without_heading(kind, ordinary_text)
        ordinary_text = "\n".join(
            line
            for line in _markdown_lines(ordinary_text)
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
                "regular_clean": regular_heading and clean and not ambiguous,
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
    if ambiguous:
        # Visibility repair can hide the protocol marker or category from the
        # rendered section classifier. Retain only uncertainty, never a finding
        # assertion, from raw metadata outside Markdown code.
        security_origin = bool(SECURITY_MARKER_COMMENT.search(metadata)) or bool(
            re.search(r"\b(?:codex[ \t-]+)?security[ \t-]+review\b", metadata, re.I)
        )
        for section in sections:
            section["parser_ambiguous"] = True
            section["security_uncertain"] = security_origin
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
