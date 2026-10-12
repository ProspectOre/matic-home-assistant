"""Guard the Map Studio translation keys against drift from strings.json.

The shipped TypeScript names its keys and English fallbacks in code; Home
Assistant serves the stored values from ``strings.json``. Every key must exist
in ``common`` with the stored value equal to its fallback, and every ``common``
key must be referenced by shipped code: no key is stored that nothing reads.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from homeassistant.helpers.translation import async_get_translations

# Importing the integration first makes ``custom_components`` resolve to this
# repository, which is what lets Home Assistant's loader find ``matic_robot``.
from custom_components.matic_robot.const import DOMAIN
from tests import frontend_sources
from tests.frontend_sources import (
    EN_PATH,
    STRINGS_PATH,
    backend_key_sites,
    common_strings,
    key_sites,
    live_matches,
    scan_backend_module,
    scan_module,
    scan_notice_text,
    scan_text_references,
    shipped_modules,
    stray_backend_references,
    stray_key_literals,
    stray_notice_text,
    text_referenced_keys,
)

_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
_SIMPLE_PLACEHOLDER = re.compile(r"\{[a-z][a-z0-9_]*\}")


def test_en_translations_are_identical_to_strings() -> None:
    assert STRINGS_PATH.read_bytes() == EN_PATH.read_bytes()


def test_every_frontend_key_site_is_recognized() -> None:
    strays = stray_key_literals()
    assert strays == [], f"key literals outside a recognized site: {strays}"


def _referenced_keys() -> set[str]:
    """Keys named by shipped TypeScript, Python, services.yaml or blueprints."""
    return (
        {site.key for site in key_sites()}
        | {key for _, _, key in backend_key_sites()}
        | text_referenced_keys()
    )


def test_every_backend_key_reference_is_recognized() -> None:
    strays = stray_backend_references()
    assert strays == [], f"backend cache keys built at run time: {strays}"


def test_backend_keys_exist_in_common() -> None:
    missing = {key for _, _, key in backend_key_sites()} - set(common_strings())
    assert missing == set(), f"backend keys missing from common: {sorted(missing)}"


def test_frontend_keys_exist_in_common() -> None:
    common = common_strings()
    missing = {site.key for site in key_sites() if site.key not in common}
    assert missing == set(), f"keys missing from common: {sorted(missing)}"


def test_frontend_fallbacks_equal_the_stored_values() -> None:
    common = common_strings()
    mismatch = {
        (site.key, site.fallback)
        for site in key_sites()
        if site.key in common and common[site.key] != site.fallback
    }
    assert mismatch == set(), f"fallbacks that differ from common: {sorted(mismatch)}"


def test_every_common_key_is_referenced() -> None:
    orphans = set(common_strings()) - _referenced_keys()
    assert orphans == set(), f"common keys that nothing references: {sorted(orphans)}"


def test_every_placeholder_is_supplied_at_its_call_site() -> None:
    common = common_strings()
    unsupplied = frozenset(
        (site.module, site.key)
        for site in key_sites()
        if not set(_PLACEHOLDER.findall(common.get(site.key, site.fallback)))
        <= site.supplied
    )
    assert unsupplied == frozenset(), (
        f"sites that omit a placeholder their stored value names: {sorted(unsupplied)}"
    )


def test_common_values_are_simple_message_format() -> None:
    """HA localize runs IntlMessageFormat, so braces and quotes must stay plain."""
    for key, value in common_strings().items():
        assert isinstance(value, str), key
        assert not re.search(r"['][{}]|[{}][']", value), f"{key}: quote beside a brace"
        assert "''" not in value, f"{key}: doubled apostrophe"
        assert "<" not in value and ">" not in value, f"{key}: angle bracket"
        bare = _SIMPLE_PLACEHOLDER.sub("", value)
        assert "{" not in bare and "}" not in bare, f"{key}: not a {{snake_case}} brace"


_SITE_FORMS = {
    "call with this.localize": (
        'translate(this.localize, "v4_a", "A {n}", { n })',
        [("call", "v4_a", "A {n}", {"n"})],
        [],
    ),
    "call through handlers.t": (
        'handlers.t("v4_a", "A")',
        [("call", "v4_a", "A", set())],
        [],
    ),
    "call nested in a template": (
        'html`<b>${this.#t("v4_a", "A {n}", { n: 1, ...rest })}</b>`',
        [("call", "v4_a", "A {n}", {"n"})],
        [],
    ),
    "pair with shorthand placeholders": (
        '{ label: "L {n}", labelKey: "v4_l", labelPlaceholders: { n } }',
        [("pair", "v4_l", "L {n}", {"n"})],
        [],
    ),
    "pair without placeholders": (
        '{ reason: "R", reasonKey: "v4_r" }',
        [("pair", "v4_r", "R", set())],
        [],
    ),
    "disabledAction with both keys": (
        'disabledAction("id", "L", "R", "v4_l", "v4_r")',
        [("disabled", "v4_l", "L", set()), ("disabled", "v4_r", "R", set())],
        [],
    ),
    "disabledAction without a reason key": (
        'disabledAction("id", "L", "R", "v4_l")',
        [("disabled", "v4_l", "L", set())],
        [],
    ),
    "notice with placeholders": (
        'notice("info", "v4_n", "N {x}", { x: 1 })',
        [("notice", "v4_n", "N {x}", {"x"})],
        [],
    ),
    "notice without placeholders": (
        'notice("info", "v4_n", "N")',
        [("notice", "v4_n", "N", set())],
        [],
    ),
    "notice with a concatenated fallback": (
        'notice("info", "v4_n", "N" + suffix)',
        [],
        ["v4_n"],
    ),
    "template key with a substitution": (
        't(`v4_height_${detent}`, "Height")',
        [],
        ["v4_height_"],
    ),
    "translate through an optional-chained localize": (
        'translate(this.hass?.localize, "v4_a", "A")',
        [("call", "v4_a", "A", set())],
        [],
    ),
    "translate through a private-field localize": (
        'translate(this.#canvas.localize, "v4_a", "A")',
        [("call", "v4_a", "A", set())],
        [],
    ),
    "legacy key with a literal fallback is a site": (
        't("plan_delete", "Delete")',
        [("call", "plan_delete", "Delete", set())],
        [],
    ),
    "legacy key with a variable fallback": (
        't("plan_delete", label)',
        [],
        ["plan_delete"],
    ),
    "legacy key through translate with a variable fallback": (
        'translate(this.hass?.localize, "area_name", name)',
        [],
        ["area_name"],
    ),
    "single-quoted legacy key": (
        "this.#t('plan_delete', 'Delete')",
        [],
        ["plan_delete"],
    ),
    "static template legacy key": (
        "t(`plan_delete`, 'Delete')",
        [],
        ["plan_delete"],
    ),
    "key passed as a variable": (
        "t(key, fallback)",
        [],
        [],
    ),
    "method that ends in t is not a call": (
        'set("plan_delete", "x"); test("plan_delete", y)',
        [],
        [],
    ),
    "comparison is not a stray": (
        'if (id === "v4_x" || id !== "v4_y") return;',
        [],
        [],
    ),
    "comparison with the key first": (
        'if ("v4_x" === id) return;',
        [],
        [],
    ),
    "case label": (
        'switch (id) { case "v4_x": break; }',
        [],
        [],
    ),
    "key assigned, not compared": (
        'const k = "v4_x";',
        [],
        ["v4_x"],
    ),
    "key after a comparison elsewhere in the expression": (
        'const k = (a === b) ? "v4_x" : "v4_y";',
        [],
        ["v4_x", "v4_y"],
    ),
    "site in a line comment": (
        '// t("v4_x", "Old")',
        [],
        [],
    ),
    "site in a block comment": (
        '/* t("v4_x", "Old") */',
        [],
        [],
    ),
    "stray key in a comment": (
        '// the old "v4_x" key',
        [],
        [],
    ),
    "site in static template text": (
        'html`<code>t("v4_x", "A")</code>`',
        [],
        [],
    ),
    "stray key in static template text": (
        'html`<i data-key="v4_x"></i>`',
        [],
        [],
    ),
    "site in an unrelated string": (
        'const hint = \'call t("v4_x", "A")\';',
        [],
        [],
    ),
    "site after a comment and a template": (
        '// c\nconst a = html`${1}`; /* d */ t("v4_a", "A")',
        [("call", "v4_a", "A", set())],
        [],
    ),
    "regex literal holding a key": (
        'const re = /"v4_x"/u;',
        [],
        [],
    ),
    "regex literal holding a site": (
        'const re = /t("v4_x", "A")/u;',
        [],
        [],
    ),
    "regex literal holding quotes": (
        'const re = /[\'"`]/u; t("v4_a", "A")',
        [("call", "v4_a", "A", set())],
        [],
    ),
    "regex literal holding a slash in a class": (
        'const re = /[/]"v4_x"/u; t("v4_a", "A")',
        [("call", "v4_a", "A", set())],
        [],
    ),
    "regex after return": (
        'return /"v4_x"/u.test(s);',
        [],
        [],
    ),
    "division is not a regex": (
        'const q = n / 2; const s = "v4_stray"; const m = k / 3;',
        [],
        ["v4_stray"],
    ),
    "division after a call is not a regex": (
        'const q = f(n) / 2; const s = "v4_stray"; const m = k / 3;',
        [],
        ["v4_stray"],
    ),
}


@pytest.mark.parametrize(
    ("source", "expected", "strays"),
    _SITE_FORMS.values(),
    ids=_SITE_FORMS.keys(),
)
def test_scanner_recognizes_each_site_form(
    source: str,
    expected: list[tuple[str, str, str, set[str]]],
    strays: list[str],
) -> None:
    sites, stray = scan_module("snippet.ts", source)
    assert [
        (site.kind, site.key, site.fallback, set(site.supplied)) for site in sites
    ] == expected
    assert [key for _, _, key in stray] == strays


_BACKEND_FORMS = {
    "plain literal": ('KEY = "component.matic_robot.common.k_a"', ["k_a"], []),
    "f-string with the domain": (
        'KEY: Final = f"component.{DOMAIN}.common.k_b"',
        ["k_b"],
        [],
    ),
    "f-string with a run-time key": (
        'cached[f"component.{DOMAIN}.common.{name}"]',
        [],
        ["{name}"],
    ),
    "other category": ('"component.matic_robot.entity.vacuum.x"', [], []),
    "comment is not a reference": (
        '# "component.matic_robot.common.k_c"\nx = 1',
        [],
        [],
    ),
    "docstring is not a reference": (
        'def f():\n    """component.matic_robot.common.k_d"""',
        [],
        [],
    ),
    "literal beside a comment": (
        'K = "component.matic_robot.common.k_e"  # "component.matic_robot.common.k_f"',
        ["k_e"],
        [],
    ),
    "concatenated key": ('"component.matic_robot.common." + name', [], [""]),
}


@pytest.mark.parametrize(
    ("source", "keys", "strays"),
    _BACKEND_FORMS.values(),
    ids=_BACKEND_FORMS.keys(),
)
def test_backend_scanner_recognizes_each_form(
    source: str, keys: list[str], strays: list[str]
) -> None:
    sites, stray = scan_backend_module("snippet.py", source)
    assert [key for _, _, key in sites] == keys
    assert [text for _, _, text in stray] == strays


def test_scanner_reports_the_line_of_a_site_and_a_stray() -> None:
    source = (
        "// first\n"
        "/* second\n"
        "   third */\n"
        "const a = html`\n"
        "  <b>${1}</b>`;\n"
        't("v4_site", "Site");\n'
        'const k = "v4_stray";\n'
    )
    sites, strays = scan_module("snippet.ts", source)
    assert [(site.key, site.line) for site in sites] == [("v4_site", 6)]
    assert [(key, line) for _, line, key in strays] == [("v4_stray", 7)]


def test_the_walk_scans_every_module_a_shipped_entry_imports(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Shipped code is what the entry points reach; no module name is exempt."""
    (tmp_path / "mockups").mkdir()
    (tmp_path / "index.ts").write_text(
        'import "./gallery-state";\nimport("./review");\n'
    )
    (tmp_path / "ha-icons.ts").write_text(
        'import { x } from "./synthetic-fixtures";\nimport "./mockups/copy";\n'
    )
    for name in (
        "gallery-state.ts",
        "review.ts",
        "synthetic-fixtures.ts",
        "mockups/copy.ts",
    ):
        (tmp_path / name).write_text("")
    monkeypatch.setattr(frontend_sources, "STUDIO_SOURCE", tmp_path)
    frontend_sources._modules.cache_clear()
    try:
        walked = sorted(shipped_modules())
    finally:
        frontend_sources._modules.cache_clear()
    assert walked == [
        "gallery-state.ts",
        "ha-icons.ts",
        "index.ts",
        "mockups/copy.ts",
        "review.ts",
        "synthetic-fixtures.ts",
    ], f"modules the walk scanned: {walked}"


_UNBALANCED = {
    "unclosed brace": 'if (a) { t("v4_a", "A");',
    "closer for the wrong opener": 'f(a]; t("v4_a", "A");',
    "closer with no opener": 'a); t("v4_a", "A");',
}


@pytest.mark.parametrize("source", _UNBALANCED.values(), ids=_UNBALANCED.keys())
def test_scanner_rejects_unbalanced_source(source: str) -> None:
    with pytest.raises(ValueError, match="unbalanced"):
        scan_module("snippet.ts", source)


_TEXT_FORMS = {
    "dotted reference": ("description: component.matic_robot.common.k_a", ["k_a"]),
    "strings.json cross-reference": (
        '"[%key:component::matic_robot::common::k_b%]"',
        ["k_b"],
    ),
    "two references": (
        "component.matic_robot.common.k_a component.matic_robot.common.k_c",
        ["k_a", "k_c"],
    ),
    "other category": ("component.matic_robot.entity.vacuum.k_d", []),
    "other integration": ("component.other.common.k_e", []),
    "selector translation_key target": ("translation_key: cleaning_mode", []),
    "bare mention of common": ("the common keys are shared", []),
}


@pytest.mark.parametrize(("text", "keys"), _TEXT_FORMS.values(), ids=_TEXT_FORMS.keys())
def test_text_reference_scanner_recognizes_each_form(
    text: str, keys: list[str]
) -> None:
    assert scan_text_references(text) == keys


_NOTICE_TEXT_FORMS = {
    "object with tone and text": ('const n = { tone: "info", text: "x" };', [1]),
    "set-notice dispatch": (
        'this.#intent({ type: "set-notice", notice: {\n  tone: "error",\n'
        '  text: "x" } });',
        [1],
    ),
    "text property read": ("const t = state.notice?.text;", [1]),
    "ternary on a text variable": ("const v = cond ? text : other;", []),
    "type annotation": ("interface Row { text: string }", []),
    "placeholder named text": ('notice("info", "k", "F {text}", { text });', []),
    "object with tone and key": ('const n = { tone: "info", key: "k" };', []),
    "commented object": ('// { tone: "info", text: "x" }', []),
    "text read on another name": ("const v = notices.text;", []),
    # The shape is retired for every component, so a chip is flagged as well:
    # a chip names its words `label`.
    "chip with tone and text": ('const chip = { tone: "info", text: "x" };', [1]),
    "tone and text beside a spread": (
        'const n = { ...base, tone: "info", text: "x" };',
        [1],
    ),
    # tsc rejects `text` on a WorkspaceNotice, so these escape only through a
    # spread that may carry the tone, or a name the scan cannot type.
    "text beside a spread alone": ('const n = { ...base, text: "x" };', []),
    "text read through a longer chain": (
        "const t = this.store.value.notice.text;",
        [1],
    ),
    "text read on a differently named value": ("const t = toast.text;", []),
}


@pytest.mark.parametrize(
    ("source", "lines"), _NOTICE_TEXT_FORMS.values(), ids=_NOTICE_TEXT_FORMS.keys()
)
def test_notice_text_scanner_recognizes_each_form(
    source: str, lines: list[int]
) -> None:
    assert [line for _, line in scan_notice_text("snippet.ts", source)] == lines


def test_no_module_builds_notice_text() -> None:
    holders = stray_notice_text()
    assert holders == [], f"notices built with a text field or read from it: {holders}"


def test_no_manual_placeholder_substitution() -> None:
    manual = re.compile(r'\.replace\("\{')
    holders = [
        module
        for module, source in shipped_modules().items()
        if live_matches(manual, source)
    ]
    assert holders == [], f"modules that substitute placeholders by hand: {holders}"


async def test_home_assistant_serves_matic_common_translations(hass) -> None:
    """The `common` category is what the panel asks Home Assistant to load."""
    served = await async_get_translations(hass, "en", "common", [DOMAIN])
    prefix = f"component.{DOMAIN}.common."
    stripped = {
        key.removeprefix(prefix): value
        for key, value in served.items()
        if key.startswith(prefix)
    }
    assert stripped == common_strings()
