"""Static readers for the shipped Map Studio TypeScript.

Plain importable helpers (not pytest fixtures) for the translation drift guard.
They read the TypeScript source as text, with no Node and no TypeScript parser,
and recognize the few forms in which a localization key reaches the UI:

``call``      ``t("key", "Fallback", { name })`` and ``translate(localize, ...)``
``pair``      ``label: "Fallback", labelKey: "key"`` in one object literal
``disabled``  ``disabledAction("id", "Label", "Reason", "labelKey", "reasonKey")``
``notice``    ``notice("tone", "key", "Fallback", { name })``

Only real code counts: a match inside a comment, a regex literal, a string or the
static part of a template literal is not a site. A ``"v4_*"`` literal, or a quoted
first argument of ``t(``/``translate(``, that is not at one of these sites is
reported by ``stray_key_literals`` so a new form cannot slip past the guard.

The integration's Python names ``common`` keys in one form, a full cache key
whose key part is literal: ``"component.matic_robot.common.key"`` or
``f"component.{DOMAIN}.common.key"``. ``backend_key_sites`` finds those string
literals in the syntax tree (never comments or docstrings), and
``stray_backend_references`` reports a cache key built from a run-time name.
``text_referenced_keys`` reads the same full cache key in ``services.yaml``, the
blueprints and the other ``strings.json`` categories.
"""

from __future__ import annotations

import ast
import json
import re
from bisect import bisect_right
from collections.abc import Iterator
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

REPO = Path(__file__).resolve().parents[1]
STUDIO_SOURCE = REPO / "frontend" / "map-studio-v4"
INTEGRATION = REPO / "custom_components" / "matic_robot"
BLUEPRINTS = REPO / "blueprints"
STRINGS_PATH = INTEGRATION / "strings.json"
EN_PATH = INTEGRATION / "translations" / "en.json"

_ENTRY_POINTS = ("index.ts", "ha-icons.ts")


@dataclass(frozen=True)
class KeySite:
    """One place where shipped code names a localization key and its fallback."""

    module: str
    line: int
    key: str
    fallback: str
    supplied: frozenset[str]
    kind: Literal["call", "pair", "disabled", "notice"]


# --- module walk -----------------------------------------------------------

_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}/[^"']+)["']""")


def _resolve(importer: Path, specifier: str) -> Path:
    base = importer.parent / specifier
    for candidate in (base.with_name(base.name + ".ts"), base / "index.ts"):
        if candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(f"{importer.name} imports {specifier!r}, which is missing")


@cache
def _modules() -> dict[str, str]:
    root = STUDIO_SOURCE.resolve()
    pending = [root / entry for entry in _ENTRY_POINTS]
    found: dict[str, str] = {}
    while pending:
        path = pending.pop()
        module = path.relative_to(root).as_posix()
        if module in found:
            continue
        source = path.read_text(encoding="utf-8")
        found[module] = source
        pending.extend(_resolve(path, spec) for spec in _IMPORT.findall(source))
    return dict(sorted(found.items()))


def shipped_modules() -> dict[str, str]:
    """Module name to source for every file the shipped bundle imports."""
    return dict(_modules())


# --- structure scanner -----------------------------------------------------

_CODE_TOKEN = re.compile(r"""["'`{}()\[\],/]""")
_TEMPLATE_TOKEN = re.compile(r"""\\.|`|\$\{""", re.DOTALL)
_QUOTED = {
    '"': re.compile(r'"(?:[^"\\\n]|\\.)*"'),
    "'": re.compile(r"'(?:[^'\\\n]|\\.)*'"),
}
_REGEX_LITERAL = re.compile(r"/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\[\\\n])+/[a-z]*")
_REGEX_AFTER = frozenset("(,=:[!&|?{};+-*%<>~^")
_REGEX_AFTER_WORD = frozenset(
    {"return", "typeof", "case", "in", "of", "delete", "void", "throw", "else", "new"}
)
_Token = tuple[str, int, int]


def _starts_regex(text: str, slash: int) -> bool:
    """Whether the ``/`` at ``slash`` opens a regex literal rather than divides."""
    end = slash
    while end and text[end - 1].isspace():
        end -= 1
    if end == 0 or text[end - 1] in _REGEX_AFTER:
        return True
    begin = end
    while begin and (text[begin - 1].isalnum() or text[begin - 1] in "_$"):
        begin -= 1
    return text[begin:end] in _REGEX_AFTER_WORD


def _tokens(text: str, start: int = 0) -> Iterator[_Token]:
    """Yield ``(kind, begin, end)`` for each lexical item of TypeScript source.

    ``punct`` is one bracket or comma of real code; ``string``, ``comment``,
    ``regex`` and ``text`` (the static part of a template literal) are the spans
    in which code-like text is not code. The braces of ``${...}`` template
    expressions are balanced internally and not yielded.
    """
    frames = ["code"]
    i = chunk = start
    while True:
        if frames[-1] == "tpl":
            template = _TEMPLATE_TOKEN.search(text, i)
            if template is None:
                return
            i = template.end()
            if template.group() == "`":
                yield "text", chunk, template.start()
                frames.pop()
            elif template.group() == "${":
                yield "text", chunk, template.start()
                frames.append("expr")
            continue
        token = _CODE_TOKEN.search(text, i)
        if token is None:
            return
        char, begin = token.group(), token.start()
        i = token.end()
        if char in _QUOTED:
            quoted = _QUOTED[char].match(text, begin)
            if quoted:
                i = quoted.end()
                yield "string", begin, i
        elif char == "`":
            frames.append("tpl")
            chunk = i
        elif char == "/":
            if text.startswith("/", i):
                newline = text.find("\n", i)
                i = len(text) if newline < 0 else newline
                yield "comment", begin, i
            elif text.startswith("*", i):
                end = text.find("*/", i)
                if end < 0:
                    return
                i = end + 2
                yield "comment", begin, i
            elif _starts_regex(text, begin):
                regex = _REGEX_LITERAL.match(text, begin)
                if regex:
                    i = regex.end()
                    yield "regex", begin, i
        elif char == "}":
            closes_expression = frames[-1] == "expr"
            if len(frames) > 1:
                frames.pop()
            if frames[-1] == "tpl":
                chunk = i
            if not closes_expression:
                yield "punct", begin, i
        else:
            if char == "{":
                frames.append("code")
            yield "punct", begin, i


def _structure(text: str, start: int = 0) -> Iterator[tuple[int, str]]:
    """Yield ``(index, char)`` for each bracket and comma that is real code."""
    for kind, begin, _ in _tokens(text, start):
        if kind == "punct":
            yield begin, text[begin]


@cache
def _dead_spans(text: str) -> tuple[tuple[int, int], ...]:
    """Source spans where code-shaped text is a comment, a regex or string content."""
    return tuple(
        (begin + 1 if kind == "string" else begin, end)
        for kind, begin, end in _tokens(text)
        if kind != "punct"
    )


def _is_code(text: str, offset: int) -> bool:
    """Whether ``offset`` is real code: not inside a comment, regex or string."""
    spans = _dead_spans(text)
    index = bisect_right(spans, (offset, len(text))) - 1
    return index < 0 or offset >= spans[index][1]


def live_matches(pattern: re.Pattern[str], text: str) -> list[re.Match[str]]:
    """Matches of ``pattern`` that start in real code."""
    return [match for match in pattern.finditer(text) if _is_code(text, match.start())]


_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)


def without_comments(text: str) -> str:
    """``text`` with its comments removed: script comments, and the ``/* */``
    comments inside template literals (the styles), which the lexer reads as text."""
    kept: list[str] = []
    last = 0
    for kind, begin, end in _tokens(text):
        if kind == "comment":
            kept.append(text[last:begin])
            last = end
        elif kind == "text":
            kept.append(text[last:begin])
            kept.append(_BLOCK_COMMENT.sub("", text[begin:end]))
            last = end
    kept.append(text[last:])
    return "".join(kept)


_OPENERS = "{(["
_CLOSERS = "})]"


def _balanced_end(text: str, start: int) -> int:
    """Index of the bracket that closes the one opened just before ``start``."""
    depth = 1
    for index, char in _structure(text, start):
        if char in _OPENERS:
            depth += 1
        elif char in _CLOSERS:
            depth -= 1
            if depth == 0:
                return index
    raise ValueError(f"unbalanced brackets after offset {start}")


def _object_entries(text: str, open_index: int) -> list[tuple[int, int]]:
    """Source span of each top-level entry of the object literal at ``open_index``."""
    entries: list[tuple[int, int]] = []
    entry_start = open_index + 1
    depth = 0
    for index, char in _structure(text, entry_start):
        if char in _OPENERS:
            depth += 1
        elif char in _CLOSERS and depth:
            depth -= 1
        elif char in _CLOSERS or (char == "," and depth == 0):
            entries.append((entry_start, index))
            entry_start = index + 1
            if char in _CLOSERS:
                return entries
    raise ValueError(f"unterminated object literal at offset {open_index}")


_ENTRY_KEY = re.compile(r"""\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*(?::|$)""")


def _object_keys(text: str, open_index: int) -> frozenset[str]:
    keys: set[str] = set()
    for start, end in _object_entries(text, open_index):
        match = _ENTRY_KEY.match(text, start, end)
        if match:
            keys.add(next(group for group in match.groups() if group))
    return frozenset(keys)


def _supplied_in_arguments(text: str, start: int) -> frozenset[str]:
    """Keys of every object literal among the call arguments after ``start``."""
    end = _balanced_end(text, start)
    supplied: set[str] = set()
    depth = 0
    for index, char in _structure(text, start):
        if index >= end:
            break
        if char == "{" and depth == 0:
            supplied |= _object_keys(text, index)
        if char in _OPENERS:
            depth += 1
        elif char in _CLOSERS:
            depth -= 1
    return frozenset(supplied)


def _brace_ranges(text: str) -> list[tuple[int, int]]:
    """Span of every ``{...}`` block; raises unless all brackets pair up."""
    ranges: list[tuple[int, int]] = []
    opened: list[tuple[str, int]] = []
    for index, char in _structure(text):
        if char in _OPENERS:
            opened.append((char, index))
        elif char in _CLOSERS:
            if not opened or _OPENERS.index(opened[-1][0]) != _CLOSERS.index(char):
                raise ValueError(f"unbalanced {char!r} at offset {index}")
            opener, start = opened.pop()
            if opener == "{":
                ranges.append((start, index))
    if opened:
        raise ValueError(f"unbalanced {opened[-1][0]!r} at offset {opened[-1][1]}")
    return ranges


def _placeholder_keys(text: str, open_index: int, field: str) -> frozenset[str]:
    """Keys of the ``field: {...}`` entry among one object literal's entries."""
    entry = re.compile(rf"\s*{field}\s*:\s*\{{")
    for start, end in _object_entries(text, open_index):
        match = entry.match(text, start, end)
        if match:
            return _object_keys(text, match.end() - 1)
    return frozenset()


# --- recognized sites ------------------------------------------------------

_KEY = r'"([A-Za-z0-9_]+)"'
_FALLBACK = r'"((?:[^"\\\n]|\\.)*)"'
_LOCALIZE_ARGUMENT = r"(?:[\w$#]+(?:\??\.[\w$#]+)*\s*,\s*)?"
_CALL = re.compile(
    r"(?<![\w$])(?:t\(|translate\(\s*"
    + _LOCALIZE_ARGUMENT
    + r")\s*"
    + _KEY
    + r"\s*,\s*"
    + _FALLBACK
    + r"(?=\s*[,)])"
)
_PAIR = re.compile(
    r"(?<![\w$])(label|reason):\s*" + _FALLBACK + r",\s*(labelKey|reasonKey):\s*" + _KEY
)
_DISABLED = re.compile(
    r'(?<![\w$])disabledAction\(\s*"[^"]*"\s*,\s*'
    + _FALLBACK
    + r"\s*,\s*"
    + _FALLBACK
    + r"\s*,\s*"
    + _KEY
    + r"(?:\s*,\s*"
    + _KEY
    + r")?\s*,?\s*\)"
)
_NOTICE = re.compile(
    r'(?<![\w$])notice\(\s*"[^"]*"\s*,\s*'
    + _KEY
    + r"\s*,\s*"
    + _FALLBACK
    + r"(?=\s*[,)])"
)


def _unescape(raw: str) -> str:
    return json.loads(f'"{raw}"')


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _sites_in(module: str, text: str) -> list[tuple[KeySite, int]]:
    """Every recognized site in one module, with its key literal's offset."""
    ranges = _brace_ranges(text)
    found: list[tuple[KeySite, int]] = []

    def add(
        kind: Literal["call", "pair", "disabled", "notice"],
        key_offset: int,
        key: str,
        fallback: str,
        supplied: frozenset[str],
    ) -> None:
        site = KeySite(
            module, _line(text, key_offset), key, _unescape(fallback), supplied, kind
        )
        found.append((site, key_offset))

    for match in live_matches(_CALL, text):
        supplied = _supplied_in_arguments(text, match.end())
        add("call", match.start(1) - 1, match[1], match[2], supplied)
    for match in live_matches(_NOTICE, text):
        supplied = _supplied_in_arguments(text, match.end())
        add("notice", match.start(1) - 1, match[1], match[2], supplied)
    for match in live_matches(_DISABLED, text):
        add("disabled", match.start(3) - 1, match[3], match[1], frozenset())
        if match[4]:
            add("disabled", match.start(4) - 1, match[4], match[2], frozenset())
    for match in live_matches(_PAIR, text):
        enclosing = min(
            (r for r in ranges if r[0] < match.start() < r[1]),
            key=lambda r: r[1] - r[0],
        )
        supplied = _placeholder_keys(text, enclosing[0], f"{match[1]}Placeholders")
        add("pair", match.start(4) - 1, match[4], match[2], supplied)
    return found


@cache
def _scan() -> tuple[tuple[KeySite, int], ...]:
    found = [
        item for module, text in _modules().items() for item in _sites_in(module, text)
    ]
    return tuple(sorted(found, key=lambda item: (item[0].module, item[1])))


def key_sites() -> list[KeySite]:
    """Every localization key site in the shipped modules, in source order."""
    return [site for site, _ in _scan()]


# A ``v4_*`` literal that is compared (``=== "v4_x"``, ``"v4_x" !==``, ``case``) is a
# value, not a key. A template literal that starts with ``v4_`` and continues into
# ``${`` counts as a stray: its key is built at run time, so no baseline could see it.
_V4_LITERAL = re.compile(
    r"""(?P<before>(?:[!=]==|\bcase)\s*)?"""
    r"""(?:(?P<quote>["'])(?P<quoted>v4_\w*)(?P=quote)|`(?P<templated>v4_\w*)(?:`|\$\{))"""
    r"""(?P<after>\s*[!=]==)?"""
)
# Whatever its prefix, a quoted first argument of ``t(`` or ``translate(`` names a key.
_QUOTED_ARGUMENT = re.compile(
    r"(?<![\w$])(?:t\(|translate\(\s*"
    + _LOCALIZE_ARGUMENT
    + r")\s*(?P<quote>[\"'`])(?P<key>(?:(?!(?P=quote)|\$\{)[^\\]|\\.)*)",
    re.DOTALL,
)


def _strays_in(
    module: str, text: str, sites: list[tuple[KeySite, int]]
) -> list[tuple[str, int, str]]:
    found: dict[int, str] = {}
    for match in live_matches(_QUOTED_ARGUMENT, text):
        found[match.start("quote")] = match["key"]
    for match in _V4_LITERAL.finditer(text):
        if match["before"] or match["after"]:
            continue
        group = "quoted" if match["quoted"] is not None else "templated"
        offset = match.start(group) - 1
        if _is_code(text, offset):
            found.setdefault(offset, match[group])
    at_site = {offset for _, offset in sites}
    return [
        (module, _line(text, offset), key)
        for offset, key in sorted(found.items())
        if offset not in at_site
    ]


def scan_module(
    module: str, text: str
) -> tuple[list[KeySite], list[tuple[str, int, str]]]:
    """Recognized sites and stray key literals of one module's source text."""
    sites = _sites_in(module, text)
    return [site for site, _ in sites], _strays_in(module, text, sites)


def stray_key_literals() -> list[tuple[str, int, str]]:
    """Key literals that no recognized site accounts for, in the shipped modules."""
    return [
        stray
        for module, text in _modules().items()
        for stray in scan_module(module, text)[1]
    ]


# --- notice text -----------------------------------------------------------

_NOTICE_TEXT_READ = re.compile(r"(?<![\w$])notice\??\.text\b")


def scan_notice_text(module: str, text: str) -> list[tuple[str, int]]:
    """``(module, line)`` of each notice built with a ``text`` field or read from it.

    A notice carries a ``key`` and ``fallback``. One rule: an object literal that
    has both a ``tone`` and a ``text`` is the retired shape, wherever it is built
    and whatever it is (a chip is flagged too and names its words ``label``), and
    ``notice.text`` is the retired read. Names the scan cannot type (``toast.text``)
    and a spread that may carry the tone are left to ``tsc``, which rejects ``text``
    on a ``WorkspaceNotice``.
    """
    found = {match.start() for match in live_matches(_NOTICE_TEXT_READ, text)}
    found |= {
        index
        for index, char in _structure(text)
        if char == "{" and {"tone", "text"} <= _object_keys(text, index)
    }
    return [(module, _line(text, offset)) for offset in sorted(found)]


def stray_notice_text() -> list[tuple[str, int]]:
    """Every retired-shape notice in the shipped modules."""
    return [
        built
        for module, text in _modules().items()
        for built in scan_notice_text(module, text)
    ]


# --- references outside the code -------------------------------------------

# A ``common`` key named in YAML or in ``strings.json`` is named with its full
# cache key, in the dotted form or Home Assistant's ``[%key:...::...%]`` form. A
# ``translation_key`` resolves into the ``selector`` or ``entity`` category, so it
# never names a ``common`` key.
_TEXT_REFERENCE = re.compile(
    r"component(?:\.|::)matic_robot(?:\.|::)common(?:\.|::)([a-z0-9_]+)"
)


def scan_text_references(text: str) -> list[str]:
    """The ``common`` keys that one YAML or JSON text names."""
    return _TEXT_REFERENCE.findall(text)


def text_referenced_keys() -> set[str]:
    """``common`` keys named by ``services.yaml``, the blueprints or other strings."""
    others = {k: v for k, v in _strings().items() if k != "common"}
    texts = [
        json.dumps(others),
        (INTEGRATION / "services.yaml").read_text(encoding="utf-8"),
        *(
            path.read_text(encoding="utf-8")
            for path in sorted(BLUEPRINTS.rglob("*.yaml"))
        ),
    ]
    return {key for text in texts for key in scan_text_references(text)}


# --- backend references ----------------------------------------------------

BackendSite = tuple[str, int, str]

_BACKEND_REFERENCE = re.compile(
    r"component\.(?P<domain>matic_robot|\{DOMAIN\})\.common\.(?P<tail>.*)", re.DOTALL
)
_BACKEND_KEY = re.compile(r"[a-z0-9_]+")
_DOCUMENTED = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)


def _string_text(node: ast.expr) -> str | None:
    """A string literal's text; an f-string's substitutions read ``{source}``."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(
            "{" + ast.unparse(part.value) + "}"
            if isinstance(part, ast.FormattedValue)
            else str(getattr(part, "value", ""))
            for part in node.values
        )
    return None


def scan_backend_module(
    module: str, text: str
) -> tuple[list[BackendSite], list[BackendSite]]:
    """``(module, line, key)`` of each backend key, and each non-literal key part.

    Only real string literals count: comments are not in the syntax tree, and
    docstrings and the literal parts inside an f-string are skipped.
    """
    tree = ast.parse(text)
    skipped: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, _DOCUMENTED) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                skipped.add(id(first.value))
        if isinstance(node, ast.JoinedStr):
            skipped.update(id(part) for part in node.values)
    sites: list[BackendSite] = []
    strays: list[BackendSite] = []
    for node in ast.walk(tree):
        if id(node) in skipped or not isinstance(node, ast.expr):
            continue
        literal = _string_text(node)
        match = _BACKEND_REFERENCE.fullmatch(literal) if literal is not None else None
        if match is None:
            continue
        if match["domain"] != "matic_robot" and not isinstance(node, ast.JoinedStr):
            continue
        found = sites if _BACKEND_KEY.fullmatch(match["tail"]) else strays
        found.append((module, node.lineno, match["tail"]))
    sites.sort(key=lambda site: site[1])
    strays.sort(key=lambda site: site[1])
    return sites, strays


@cache
def _backend_scan() -> tuple[tuple[BackendSite, ...], tuple[BackendSite, ...]]:
    sites: list[BackendSite] = []
    strays: list[BackendSite] = []
    for path in sorted(INTEGRATION.rglob("*.py")):
        module = path.relative_to(INTEGRATION).as_posix()
        found, stray = scan_backend_module(module, path.read_text(encoding="utf-8"))
        sites.extend(found)
        strays.extend(stray)
    return tuple(sites), tuple(strays)


def backend_key_sites() -> list[BackendSite]:
    """``(module, line, key)`` of every ``common`` key the integration names."""
    return list(_backend_scan()[0])


def stray_backend_references() -> list[BackendSite]:
    """Backend cache keys whose key part is not a literal key name."""
    return list(_backend_scan()[1])


def _strings() -> dict[str, dict[str, object]]:
    data: dict[str, dict[str, object]] = json.loads(
        STRINGS_PATH.read_text(encoding="utf-8")
    )
    return data


def common_strings() -> dict[str, str]:
    """The ``common`` block of ``strings.json``."""
    return {key: str(value) for key, value in _strings()["common"].items()}
