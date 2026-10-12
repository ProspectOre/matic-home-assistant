"""Guard the Map Studio translation keys against drift from strings.json.

The shipped TypeScript names its keys and English fallbacks in code; Home
Assistant serves the stored values from ``strings.json``. The baselines below
freeze the drift that exists today so that every commit stays green while any
new drift fails. Each task that removes drift shrinks its baseline in the same
commit; nothing here is a target to keep.
"""

from __future__ import annotations

import re

import pytest

from tests.frontend_sources import (
    EN_PATH,
    STRINGS_PATH,
    common_strings,
    key_sites,
    shipped_modules,
    stray_v4_literals,
)

_RATCHET = "Update the baseline in the same commit that fixes or adds this drift."

# Keys named by shipped code that are absent from ``common``.
_BASELINE_MISSING: frozenset[str] = frozenset(
    {
        "v4_action_starting",
        "v4_action_starting_detail",
        "v4_cadence_clear_mop_to_change_normal",
        "v4_cadence_coverage_due",
        "v4_cadence_coverage_due_reason",
        "v4_cadence_coverage_progress",
        "v4_cadence_coverage_verification_hint",
        "v4_cadence_description",
        "v4_cadence_do_mop_next",
        "v4_cadence_do_mop_next_named",
        "v4_cadence_due_unknown_reason",
        "v4_cadence_existing_effect",
        "v4_cadence_identity_blocked",
        "v4_cadence_mop_due",
        "v4_cadence_mop_due_reason",
        "v4_cadence_mop_interval",
        "v4_cadence_mop_interval_named",
        "v4_cadence_mop_progress",
        "v4_cadence_mop_requires_vacuum",
        "v4_cadence_new_private_effect",
        "v4_cadence_new_shared_effect",
        "v4_cadence_next_actions_named",
        "v4_cadence_not_enabled",
        "v4_cadence_policy_invalid",
        "v4_cadence_scope",
        "v4_cadence_scope_named",
        "v4_cadence_shared",
        "v4_cadence_shared_join_effect",
        "v4_cadence_shared_leave_effect",
        "v4_cadence_shared_unavailable",
        "v4_cadence_this_plan",
        "v4_discard_plan",
        "v4_discard_plan_detail",
        "v4_effective_room_order",
        "v4_effective_room_preview",
        "v4_map_recovery_automatic",
        "v4_map_unavailable_reason",
        "v4_next_run_mission",
        "v4_next_run_preview",
        "v4_next_run_preview_hint",
        "v4_next_run_preview_order",
        "v4_next_run_preview_save_first",
        "v4_next_run_preview_stale",
        "v4_next_run_preview_unavailable",
        "v4_override_room_schedule",
        "v4_override_room_schedule_hint",
        "v4_plans_required_reason",
        "v4_plans_unavailable_action",
        "v4_preview_identity_unavailable",
        "v4_preview_invalid",
        "v4_preview_no_rooms",
        "v4_preview_plan_disabled",
        "v4_preview_shared_unavailable",
        "v4_problem_reason",
        "v4_reason_room_preview_blocked",
        "v4_reason_room_preview_loading",
        "v4_reason_room_preview_unavailable",
        "v4_reason_run_plan_preview",
        "v4_reason_starting",
        "v4_recheck_robot",
        "v4_recheck_robot_reason",
        "v4_reset_cadence_hint",
        "v4_reset_coverage_cadence_button",
        "v4_reset_coverage_cadence_button_named",
        "v4_reset_coverage_cadence_confirm",
        "v4_reset_coverage_cadence_title",
        "v4_reset_mop_cadence_button",
        "v4_reset_mop_cadence_button_named",
        "v4_reset_mop_cadence_confirm",
        "v4_reset_mop_cadence_title",
        "v4_reset_private_coverage_cadence_detail",
        "v4_reset_private_mop_cadence_detail",
        "v4_reset_shared_coverage_cadence_detail",
        "v4_reset_shared_mop_cadence_detail",
        "v4_retry_preview",
        "v4_return_current_floor",
        "v4_room",
        "v4_room_cadence_named",
        "v4_room_cleaning_system_named",
        "v4_room_mission_boundary",
        "v4_room_preview_blocked",
        "v4_room_preview_loading",
        "v4_room_preview_schedule_override",
        "v4_room_preview_unavailable",
        "v4_setup_reason",
        "v4_shared_schedule_status",
        "v4_touch",
        "v4_touch_help",
        "v4_workflow_load_failed",
        "v4_workflow_loading",
    }
)

# ``(key, fallback)`` pairs where the stored value differs from the fallback.
_BASELINE_MISMATCH: frozenset[tuple[str, str]] = frozenset(
    {
        ("area_delete", "Delete area"),
        ("area_details_hint", "Name the area and choose cleaning settings."),
        ("area_new", "New outline"),
        (
            "area_redraw_required",
            "This outline no longer matches the current room map. "
            "Redraw it before saving.",
        ),
        (
            "area_review_required",
            "Review the saved outline on this current map, then confirm it.",
        ),
        ("area_workspace_title", "Saved custom areas"),
        ("map_studio_title", "Matic Map"),
        ("move_room_down", "Move {room} later"),
        ("move_room_up", "Move {room} earlier"),
        ("plan_delete", "Delete plan"),
        ("plan_rooms", "Plan rooms"),
        ("v4_draw_area", "Draw an area"),
        ("v4_paused", "paused"),
        ("v4_retry", "Try again"),
    }
)

# ``v4_*`` keys stored in ``common`` that no shipped code references.
_BASELINE_ORPHANS: frozenset[str] = frozenset(
    {
        "v4_action_clean_rooms_count",
        "v4_clean",
        "v4_cleaning_plan",
        "v4_history_quick_detail",
        "v4_loading_workspace",
        "v4_map_support",
        "v4_map_zoom",
        "v4_map_zoom_percent",
        "v4_name_and_save",
        "v4_navigation_help",
        "v4_new_area",
        "v4_new_plan",
        "v4_plan",
        "v4_plans_quick_detail",
        "v4_resume",
        "v4_review_details",
        "v4_room_cleaning_mode",
        "v4_room_cleaning_system",
        "v4_room_order_settings",
        "v4_rooms_quick_detail",
        "v4_saved_plan",
        "v4_saved_read_only",
        "v4_workspace_peek",
    }
)

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

# ``(module, key)`` sites whose stored value has a placeholder the site omits.
_BASELINE_UNSUPPLIED: frozenset[tuple[str, str]] = frozenset(
    {
        ("draw-tools.ts", "v4_brush"),
        ("draw-tools.ts", "v4_brush_button"),
        ("map-canvas.ts", "v4_rooms_selected"),
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


def test_frontend_keys_exist_in_common_with_matching_fallbacks() -> None:
    common = common_strings()
    sites = key_sites()
    missing = frozenset(site.key for site in sites if site.key not in common)
    mismatch = frozenset(
        (site.key, site.fallback)
        for site in sites
        if site.key in common and common[site.key] != site.fallback
    )
    _assert_ratchet("keys missing from common", missing, _BASELINE_MISSING)
    _assert_ratchet("fallbacks that differ from common", mismatch, _BASELINE_MISMATCH)


def test_no_orphan_v4_keys_in_common() -> None:
    referenced = {site.key for site in key_sites()}
    orphans = (
        frozenset(key for key in common_strings() if key.startswith("v4_")) - referenced
    )
    _assert_ratchet(
        "v4 keys in common that no code references", orphans, _BASELINE_ORPHANS
    )


def test_unreferenced_legacy_common_keys_do_not_grow() -> None:
    referenced = {site.key for site in key_sites()}
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
    _assert_ratchet("sites that omit a placeholder", unsupplied, _BASELINE_UNSUPPLIED)


def test_common_values_are_simple_message_format() -> None:
    """HA localize runs IntlMessageFormat, so braces and quotes must stay plain."""
    for key, value in common_strings().items():
        assert isinstance(value, str), key
        assert not re.search(r"['][{}]|[{}][']", value), f"{key}: quote beside a brace"
        assert "''" not in value, f"{key}: doubled apostrophe"
        assert "<" not in value and ">" not in value, f"{key}: angle bracket"
        bare = _SIMPLE_PLACEHOLDER.sub("", value)
        assert "{" not in bare and "}" not in bare, f"{key}: not a {{snake_case}} brace"


@pytest.mark.xfail(strict=True, reason="Task 2a")
def test_effects_build_no_notice_text() -> None:
    modules = shipped_modules()
    assert not re.search(r"\btext\s*:", modules["effects.ts"])
    holders = [
        m for m, source in modules.items() if re.search(r"notice\??\.text", source)
    ]
    assert holders == []


@pytest.mark.xfail(strict=True, reason="Task 3")
def test_no_manual_placeholder_substitution() -> None:
    holders = [m for m, source in shipped_modules().items() if '.replace("{' in source]
    assert holders == []
