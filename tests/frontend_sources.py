"""Static readers for the shipped Map Studio TypeScript.

Plain importable helpers (not pytest fixtures) for the translation drift guard.
They read the TypeScript source as text, with no Node and no TypeScript parser,
and recognize the few forms in which a localization key reaches the UI:

``call``      ``t("key", "Fallback", { name })`` and ``translate(localize, ...)``
``pair``      ``label: "Fallback", labelKey: "key"`` in one object literal
``disabled``  ``disabledAction("id", "Label", "Reason", "labelKey", "reasonKey")``
``notice``    ``notice("tone", "key", "Fallback", { name })``

A ``"v4_*"`` literal that is not at one of these sites is reported by
``stray_v4_literals`` so a new form cannot slip past the guard unnoticed.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

REPO = Path(__file__).resolve().parents[1]
STUDIO_SOURCE = REPO / "frontend" / "map-studio-v4"
INTEGRATION = REPO / "custom_components" / "matic_robot"
STRINGS_PATH = INTEGRATION / "strings.json"
EN_PATH = INTEGRATION / "translations" / "en.json"

_ENTRY_POINTS = ("index.ts", "ha-icons.ts")
_EXCLUDED_PREFIXES = ("gallery", "mockups")
_EXCLUDED_MODULES = frozenset({"review.ts", "synthetic-fixtures.ts"})


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


def _is_excluded(module: str) -> bool:
    return module in _EXCLUDED_MODULES or module.startswith(_EXCLUDED_PREFIXES)


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
        if module in found or _is_excluded(module):
            continue
        source = path.read_text(encoding="utf-8")
        found[module] = source
        pending.extend(_resolve(path, spec) for spec in _IMPORT.findall(source))
    return dict(sorted(found.items()))


def shipped_modules() -> dict[str, str]:
    """Module name to source for every file the shipped bundle imports."""
    return dict(_modules())


# --- structure scanner -----------------------------------------------------

_CODE_TOKEN = re.compile(r"""["'`{}()\[\],]|//|/\*""")
_TEMPLATE_TOKEN = re.compile(r"""\\.|`|\$\{""", re.DOTALL)
_QUOTED = {
    '"': re.compile(r'"(?:[^"\\\n]|\\.)*"'),
    "'": re.compile(r"'(?:[^'\\\n]|\\.)*'"),
}


def _structure(text: str, start: int = 0) -> Iterator[tuple[int, str]]:
    """Yield ``(index, char)`` for each bracket and comma that is real code.

    Strings, comments and template-literal text are skipped, and the braces of
    ``${...}`` template expressions are balanced internally and not yielded.
    """
    frames = ["code"]
    i = start
    while True:
        if frames[-1] == "tpl":
            template = _TEMPLATE_TOKEN.search(text, i)
            if template is None:
                return
            i = template.end()
            if template.group() == "`":
                frames.pop()
            elif template.group() == "${":
                frames.append("expr")
            continue
        token = _CODE_TOKEN.search(text, i)
        if token is None:
            return
        char, i = token.group(), token.end()
        if char in _QUOTED:
            quoted = _QUOTED[char].match(text, token.start())
            i = quoted.end() if quoted else i
        elif char == "`":
            frames.append("tpl")
        elif char == "//":
            newline = text.find("\n", i)
            if newline < 0:
                return
            i = newline
        elif char == "/*":
            end = text.find("*/", i)
            if end < 0:
                return
            i = end + 2
        elif char == "{":
            frames.append("code")
            yield token.start(), char
        elif char == "}":
            closes_expression = frames[-1] == "expr"
            if len(frames) > 1:
                frames.pop()
            if not closes_expression:
                yield token.start(), char
        else:
            yield token.start(), char


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
        match = _ENTRY_KEY.match(text[start:end])
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
    ranges: list[tuple[int, int]] = []
    opened: list[tuple[str, int]] = []
    for index, char in _structure(text):
        if char in _OPENERS:
            opened.append((char, index))
        elif char in _CLOSERS and opened:
            opener, start = opened.pop()
            if opener == "{":
                ranges.append((start, index))
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
_CALL = re.compile(
    r"(?<![\w$])(?:t|translate)\(\s*(?:(?:this\.)?localize\s*,\s*)?"
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
    r'(?<![\w$])notice\(\s*"[^"]*"\s*,\s*' + _KEY + r"\s*,\s*" + _FALLBACK
)


def _unescape(raw: str) -> str:
    return json.loads(f'"{raw}"')


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _scan_module(module: str, text: str) -> list[tuple[KeySite, int]]:
    """Every recognized site in one module, with its key literal's offset."""
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

    for match in _CALL.finditer(text):
        supplied = _supplied_in_arguments(text, match.end())
        add("call", match.start(1) - 1, match[1], match[2], supplied)
    for match in _NOTICE.finditer(text):
        supplied = _supplied_in_arguments(text, match.end())
        add("notice", match.start(1) - 1, match[1], match[2], supplied)
    for match in _DISABLED.finditer(text):
        add("disabled", match.start(3) - 1, match[3], match[1], frozenset())
        if match[4]:
            add("disabled", match.start(4) - 1, match[4], match[2], frozenset())
    pairs = list(_PAIR.finditer(text))
    if pairs:
        ranges = _brace_ranges(text)
        for match in pairs:
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
        item
        for module, text in _modules().items()
        for item in _scan_module(module, text)
    ]
    return tuple(sorted(found, key=lambda item: (item[0].module, item[1])))


def key_sites() -> list[KeySite]:
    """Every localization key site in the shipped modules, in source order."""
    return [site for site, _ in _scan()]


_V4_LITERAL = re.compile(r"""(["'`])(v4_[A-Za-z0-9_]*)\1""")
_COMPARISON = re.compile(r"[!=]==\s*$")


def stray_v4_literals() -> list[tuple[str, int, str]]:
    """``"v4_*"`` literals that are neither at a site nor compared with ``===``."""
    at_site = {(site.module, offset) for site, offset in _scan()}
    stray: list[tuple[str, int, str]] = []
    for module, text in _modules().items():
        for match in _V4_LITERAL.finditer(text):
            if (module, match.start()) in at_site:
                continue
            if _COMPARISON.search(text[: match.start()]):
                continue
            stray.append((module, _line(text, match.start()), match[2]))
    return stray


def common_strings() -> dict[str, str]:
    """The ``common`` block of ``strings.json``."""
    data = json.loads(STRINGS_PATH.read_text(encoding="utf-8"))
    common: dict[str, str] = data["common"]
    return common
