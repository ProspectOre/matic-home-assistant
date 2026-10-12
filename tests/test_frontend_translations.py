"""Guard the Map Studio translation keys against drift from strings.json.

The shipped TypeScript names its keys and English fallbacks in code; Home
Assistant serves the stored values from ``strings.json``. Every key must exist
in ``common`` with the stored value equal to its fallback, and no ``v4_`` key may
go unreferenced. Only the legacy unreferenced keys stay frozen, for UX1.
"""

from __future__ import annotations

import re

import pytest
from homeassistant.helpers.translation import async_get_translations

# Importing the integration first makes ``custom_components`` resolve to this
# repository, which is what lets Home Assistant's loader find ``matic_robot``.
from custom_components.matic_robot.const import DOMAIN
from tests.frontend_sources import (
    EN_PATH,
    STRINGS_PATH,
    backend_key_sites,
    common_strings,
    key_sites,
    scan_backend_module,
    scan_module,
    shipped_modules,
    stray_backend_references,
    stray_v4_literals,
)

_RATCHET = "Update the baseline in the same commit that fixes or adds this drift."

# Non-``v4_`` keys stored in ``common`` that no shipped code references.
# UX1 owns the decision to reuse or remove each of them.
_LEGACY_UNREFERENCED: frozenset[str] = frozenset(
    {
        "all_rooms",
        "area_added",
        "area_draw_help",
        "area_editor_intro",
        "area_editor_title",
        "area_erase_help",
        "area_layer_photo",
        "area_layer_rooms",
        "area_map",
        "area_map_controls",
        "area_map_layer",
        "area_marks",
        "area_not_selected",
        "area_outside_map",
        "area_pan_help",
        "area_photo_loading",
        "area_photo_ready",
        "area_photo_refresh",
        "area_photo_unavailable",
        "area_selected",
        "area_settings",
        "area_workspace_close",
        "area_workspace_empty",
        "area_workspace_redraw",
        "cleaning_mode",
        "clear",
        "coverage",
        "done_editing",
        "drag_room",
        "draw",
        "expand_map",
        "fit_map",
        "focus_room",
        "include_room",
        "map_cleaning_areas",
        "map_custom_areas_hint",
        "map_more",
        "map_scene_zoom",
        "map_session_unverified",
        "room_editor_intro",
        "room_editor_load_failed",
        "room_editor_loading",
        "room_editor_retry",
        "zoom_in",
        "zoom_out",
    }
)

_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
_SIMPLE_PLACEHOLDER = re.compile(r"\{[a-z][a-z0-9_]*\}")


def _assert_ratchet[T: (str, tuple[str, str])](
    what: str, actual: frozenset[T], baseline: frozenset[T]
) -> None:
    new = sorted(actual - baseline)
    fixed = sorted(baseline - actual)
    assert actual == baseline, (
        f"{what}: new drift {new}; baseline entries no longer drifting {fixed}. "
        f"{_RATCHET}"
    )


def test_en_translations_are_identical_to_strings() -> None:
    assert STRINGS_PATH.read_bytes() == EN_PATH.read_bytes()


def test_every_frontend_key_site_is_recognized() -> None:
    assert stray_v4_literals() == []


def _referenced_keys() -> set[str]:
    """Keys named by the shipped TypeScript or by the integration's Python."""
    return {site.key for site in key_sites()} | {
        key for _, _, key in backend_key_sites()
    }


def test_every_backend_key_reference_is_recognized() -> None:
    assert stray_backend_references() == []


def test_backend_keys_exist_in_common() -> None:
    missing = {key for _, _, key in backend_key_sites()} - set(common_strings())
    assert missing == set(), f"backend keys missing from common: {sorted(missing)}"


def test_frontend_keys_exist_in_common_with_matching_fallbacks() -> None:
    common = common_strings()
    sites = key_sites()
    missing = frozenset(site.key for site in sites if site.key not in common)
    mismatch = frozenset(
        (site.key, site.fallback)
        for site in sites
        if site.key in common and common[site.key] != site.fallback
    )
    assert missing == frozenset(), f"keys missing from common: {sorted(missing)}"
    assert mismatch == frozenset(), (
        f"fallbacks that differ from common: {sorted(mismatch)}"
    )


def test_no_orphan_v4_keys_in_common() -> None:
    referenced = _referenced_keys()
    orphans = (
        frozenset(key for key in common_strings() if key.startswith("v4_")) - referenced
    )
    assert orphans == frozenset(), (
        f"v4 keys in common that no code references: {sorted(orphans)}"
    )


def test_unreferenced_legacy_common_keys_do_not_grow() -> None:
    referenced = _referenced_keys()
    unreferenced = (
        frozenset(key for key in common_strings() if not key.startswith("v4_"))
        - referenced
    )
    _assert_ratchet(
        "legacy keys in common that no code references",
        unreferenced,
        _LEGACY_UNREFERENCED,
    )


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
    "comparison is not a stray": (
        'if (id === "v4_x" || id !== "v4_y") return;',
        [],
        [],
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


def test_effects_build_no_notice_text() -> None:
    modules = shipped_modules()
    assert not re.search(r"\btext\s*:", modules["effects.ts"])
    holders = [
        m for m, source in modules.items() if re.search(r"notice\??\.text", source)
    ]
    assert holders == []


def test_no_manual_placeholder_substitution() -> None:
    holders = [m for m, source in shipped_modules().items() if '.replace("{' in source]
    assert holders == []


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
