"""Contract tests binding room_plan_editor.js to its Python counterparts.

These assert the couplings the JavaScript relies on without introducing any JS
tooling: the custom element name Home Assistant derives from the registered
selector, the row keys and option values the editor reads and writes, the
localize keys it looks up, and the static path that serves the module. When
``node`` is available a syntax gate runs ``node --check``; otherwise it is
skipped. No network or browser is involved.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from hashlib import sha256
from pathlib import Path

import pytest

from custom_components.matic_robot import frontend
from custom_components.matic_robot.area_selector import MaticAreaSelector
from custom_components.matic_robot.client.commands import CleaningMode, CoverageSetting
from custom_components.matic_robot.room_plan_selector import MaticRoomPlanSelector

_EDITOR_PATH = Path(frontend.__file__).with_name("room_plan_editor.js")
_JS = _EDITOR_PATH.read_text(encoding="utf-8")
_STUDIO_PATH = Path(frontend.__file__).with_name("matic_map_studio.js")
_STUDIO_JS = _STUDIO_PATH.read_text(encoding="utf-8")


def test_registers_ha_selector_for_python_selector_type() -> None:
    """The element name must be the one HA derives from the selector type."""
    match = re.search(r'customElements\.define\(\s*"([^"]+)"', _JS)
    assert match is not None
    expected = f"ha-selector-{MaticRoomPlanSelector.selector_type}"
    assert match.group(1) == expected
    # The guard that avoids redefining the element must use the same name.
    assert f'customElements.get("{expected}")' in _JS

    area_element = f"ha-selector-{MaticAreaSelector.selector_type}"
    assert f'customElements.define("{area_element}"' in _JS
    assert f'customElements.get("{area_element}")' in _JS


def test_editor_reads_the_selector_config_rooms_shape() -> None:
    """The editor reads ``selector.rooms`` with ``room_id``/``name`` fields."""
    # Config the Python selector accepts, keyed by the same "rooms" collection.
    selector = MaticRoomPlanSelector(
        {"rooms": [{"room_id": "room-a", "name": "Kitchen"}]}
    )
    assert "rooms" in selector.config
    assert "?.rooms" in _JS
    assert "room.room_id" in _JS
    assert "room.name" in _JS
    # The selector type is also referenced as a config namespace fallback.
    assert f'"{MaticRoomPlanSelector.selector_type}"' in _JS


def test_editor_row_keys_match_selector_canonical_keys() -> None:
    """Every row key the JS reads must be one the selector produces."""
    selector = MaticRoomPlanSelector(
        {"rooms": [{"room_id": "room-a", "name": "Kitchen"}]}
    )
    canonical = selector(
        [
            {
                "room_id": "room-a",
                "included": True,
                "cleaning_mode": CleaningMode.VACUUM.value,
                "coverage_setting": CoverageSetting.STANDARD.value,
            }
        ]
    )
    canonical_keys = set(canonical[0])
    js_row_keys = set(re.findall(r"row\.([a-z_]+)", _JS))
    # The JS also references row.room_id inside nested closures; ensure the keys
    # it treats as persisted values are exactly the selector's canonical keys.
    assert js_row_keys == canonical_keys


def test_cleaning_mode_options_match_enum() -> None:
    """The cleaning-mode dropdown must offer exactly the CleaningMode values."""
    mode_block = _JS[_JS.index("cleaning_mode,") : _JS.index("coverage_setting,")]
    js_values = set(re.findall(r'value:\s*"([^"]+)"', mode_block))
    assert js_values == {mode.value for mode in CleaningMode}


def test_coverage_options_match_enum() -> None:
    """The coverage dropdown must offer exactly the CoverageSetting values."""
    coverage_block = _JS[_JS.index("coverage_setting,") :]
    js_values = set(re.findall(r'value:\s*"([^"]+)"', coverage_block))
    assert js_values == {coverage.value for coverage in CoverageSetting}


def test_localize_keys_exist_in_strings() -> None:
    """Every localize key the editor looks up must exist in strings.json."""
    strings = json.loads(
        Path(frontend.__file__).with_name("strings.json").read_text(encoding="utf-8")
    )
    common = strings["common"]
    referenced = set(re.findall(r'this\._localize\(\s*"([a-z_]+)"', _JS))
    assert referenced, "expected the editor to look up localize keys"
    missing = referenced - set(common)
    assert not missing, f"missing common strings: {sorted(missing)}"


def test_static_path_serves_the_editor_file() -> None:
    """The registered static path must point at this exact module file."""
    assert frontend.ROOM_PLAN_EDITOR_PATH.endswith(".js")
    assert Path(frontend.__file__).with_name("room_plan_editor.js") == _EDITOR_PATH
    assert frontend.MATIC_MAP_STUDIO_PATH.endswith(".js")
    assert Path(frontend.__file__).with_name("matic_map_studio.js") == _STUDIO_PATH


def test_nested_select_change_does_not_escape_as_the_editor_value() -> None:
    """A scalar dropdown event must not replace the form's full room list."""
    listener = _JS[_JS.index('field.addEventListener("value-changed"') :]
    listener = listener[: listener.index("return field;")]
    assert listener.index("event.stopPropagation();") < listener.index(
        "onChange(event.detail.value);"
    )


def test_area_editor_keeps_coordinates_private_and_bounds_marks() -> None:
    area = _JS[_JS.index("class MaticAreaEditor") :]
    assert "512" in area
    assert "detail: { value: this._cloneValue() }" in area
    assert "count.textContent = `${this._value.length}" in area
    assert "group.append(mark)" in area
    assert "this._updateControls();" in area
    assert "async_call" not in area
    assert "fetch(" not in area


def test_area_editor_has_labeled_zoomable_draw_and_pan_map() -> None:
    """The area tool must provide precise navigation without mixing it with drawing."""
    area = _JS[_JS.index("class MaticAreaEditor") :]
    assert 'class="room-label"' not in area  # Labels are created safely as text nodes.
    assert 'label.setAttribute("class", "room-label")' in area
    assert "label.textContent = room.name" in area
    assert 'data-tool="draw"' in area
    assert 'data-tool="pan"' in area
    assert 'class="zoom zoom-out"' in area
    assert 'class="zoom zoom-in"' in area
    assert 'class="fit"' in area
    assert 'svg.addEventListener("wheel"' in area
    assert "this._setViewBox(svg" in area


def test_area_editor_buttons_do_not_rebuild_or_escape_to_the_form() -> None:
    """Buttons preserve native activation without leaking into map gestures."""
    area = _JS[_JS.index("class MaticAreaEditor") :]
    guard = area[area.index("_guardButton(") : area.index("_mapPoint(")]
    assert 'event.addEventListener("pointerdown"' not in guard
    assert 'button.addEventListener("pointerdown"' in guard
    pointer_guard, click_guard = guard.split(
        'button.addEventListener("click"', maxsplit=1
    )
    assert "event.preventDefault();" not in pointer_guard
    assert "event.stopPropagation();" in pointer_guard
    assert "event.preventDefault();" in click_guard
    assert "event.stopPropagation();" in click_guard
    undo = area[area.index("_undo()") : area.index("_redo()")]
    assert "this._undoStack.pop()" in undo
    assert "this._setValue(previous, { record: false });" in undo
    assert "this._syncMarks();" in area
    clear = area[area.index('querySelector(".clear")') :]
    assert "this._setValue([]);" in clear


def test_area_editor_is_a_true_fullscreen_workspace() -> None:
    """The map must fill the viewport and return cleanly to HA's save form."""
    area = _JS[_JS.index("class MaticAreaEditor") :]
    assert '<dialog class="workspace' in area
    assert ".workspace.expanded { width: 100vw; height: 100dvh;" in area
    assert "workspace.showModal();" in area
    assert "workspace.close();" in area
    assert 'document.body.style.overflow = "hidden";' in area
    assert "this._restorePageScroll();" in area
    assert 'this._localize("done_editing"' in area
    assert 'event.key === "Escape"' in area


def test_area_editor_has_recoverable_history_and_keyboard_controls() -> None:
    """Clear remains reversible and standard editor shortcuts are available."""
    area = _JS[_JS.index("class MaticAreaEditor") :]
    assert "this._undoStack.push(this._cloneValue());" in area
    assert "this._redoStack.push(this._cloneValue());" in area
    assert 'class="redo"' in area
    assert 'event.key.toLowerCase() === "z"' in area
    assert 'event.key === "0"' in area


def test_area_editor_rejects_marks_started_off_the_floor_plan() -> None:
    """The browser and Python validator share the mapped-room safety boundary."""
    area = _JS[_JS.index("class MaticAreaEditor") :]
    assert "_pointInPolygon(x, y, boundary)" in area
    assert "if (!this._pointIsMapped(circle.x, circle.y))" in area
    assert 'this._localize("area_outside_map"' in area


def test_area_editor_does_not_rebuild_during_ha_refresh_or_value_echo() -> None:
    """Polling and Home Assistant's same-value echo must not cancel gestures."""
    area = _JS[_JS.index("class MaticAreaEditor") :]
    hass_setter = area[
        area.index("set hass(value)") : area.index("set selector(value)")
    ]
    assert "previousLanguage" in hass_setter
    assert "languageChanged" in hass_setter
    assert hass_setter.count("this._render();") == 1
    value_setter = area[area.index("set value(value)") : area.index("get value()")]
    assert "const unchanged" in value_setter
    assert "if (unchanged) return;" in value_setter
    assert "this._syncMarks();" in value_setter


def test_area_editor_drag_creates_one_circle_with_a_preview() -> None:
    """One center-to-edge gesture commits one bounded cleaning circle."""
    area = _JS[_JS.index("class MaticAreaEditor") :]
    assert 'class="preview"' in area
    assert "_updateDraft(svg, event)" in area
    assert "_commitDraft()" in area
    assert "Math.max(0.1, Math.min(2.5, distance))" in area


def test_map_panel_has_private_live_navigation_controls() -> None:
    """The studio renders true bounded 3D geometry with native-style gestures."""
    panel = _STUDIO_JS[_STUDIO_JS.index("class MaticMapStudio") :]
    assert "Full local SLAM · private inside Home Assistant" in panel
    assert 'canvas.getContext("webgl2"' in panel
    assert "gl_PointCoord" in panel
    assert "vertexAttribIPointer" in panel
    assert "MATIC_SCENE_MAX_POINTS" in _STUDIO_JS
    assert 'data-view="three"' in panel
    assert 'data-view="top"' in panel
    assert "maticOrthographic" in _STUDIO_JS
    assert "maticPerspective" in _STUDIO_JS
    assert 'class="refresh"' in panel
    assert 'class="zoom-slider"' in panel
    assert 'class="resolution-value"' in panel
    assert 'viewport.addEventListener("keydown"' in panel
    assert 'viewport.addEventListener("dblclick"' in panel
    assert 'viewport.addEventListener("gesturestart"' in panel
    assert 'viewport.addEventListener("gesturechange"' in panel
    assert "event.rotation" in panel
    assert "centerY - this._pinch.centerY" in panel
    assert "maticAngleDelta(angle - this._pinch.angle)" in panel
    assert "_startInertia" in panel
    assert "_isMouseWheel" in panel
    assert "maticClamp(deltaX, -80, 80)" in panel
    assert 'drag.pointerType !== "mouse"' in panel
    assert "[0, 1, 2].includes(event.button)" in panel
    assert "viewport.focus({ preventScroll: true })" in panel
    assert "Math.PI / 2 - 0.018" in panel
    assert "MATIC_SCENE_REQUEST_TIMEOUT_MS" in _STUDIO_JS
    assert "this._sceneAbortController?.abort()" in panel
    assert "_showRetainedScene" in panel
    assert 'headers["If-None-Match"]' in panel
    assert "response.arrayBuffer()" in panel
    assert "response.status === 304" in panel
    assert "Authorization: `Bearer ${token}`" in panel
    assert 'typeof this._hass?.fetchWithAuth === "function"' in panel
    assert "this._hass.fetchWithAuth(path, init)" in panel
    assert "viewport.clientWidth * pixelRatio" in panel
    assert "viewport.clientHeight * pixelRatio" in panel
    assert "this._fallbackLoadingVersion" in panel
    assert "const loader = new Image();" in panel
    assert "new ResizeObserver" in panel
    assert "viewport.releasePointerCapture" in panel
    assert 'class="room-labels"' in panel
    assert 'class="robot-marker"' in panel
    assert "label.textContent = room.name" in panel


def test_map_panel_localizes_every_visible_string_with_english_fallback() -> None:
    """The panel follows Home Assistant's translation namespace."""
    strings = json.loads(
        Path(frontend.__file__).with_name("strings.json").read_text(encoding="utf-8")
    )
    translations = json.loads(
        Path(frontend.__file__)
        .with_name("translations")
        .joinpath("en.json")
        .read_text(encoding="utf-8")
    )
    referenced = set(re.findall(r'this\._localize\(\s*"([a-z_]+)"', _STUDIO_JS))
    referenced.update(re.findall(r'text\(\s*"([a-z_]+)"', _STUDIO_JS))
    assert referenced
    assert not referenced - set(strings["common"])
    assert strings["common"] == translations["common"]
    assert "component.matic_robot.common.${key}" in _STUDIO_JS


def test_map_panel_persists_only_bounded_view_preferences() -> None:
    """Per-user storage remembers UX state without storing private map data."""
    panel = _STUDIO_JS[_STUDIO_JS.index("class MaticMapStudio") :]
    assert "matic-map-studio:v${MATIC_MAP_PREFERENCES_VERSION}:${identity}" in panel
    assert "this._hass?.user?.id" in panel
    assert "window.localStorage.getItem(identity)" in panel
    assert "window.localStorage.setItem(" in panel
    assert "view: this._view" in panel
    assert "labels: this._labelsVisible" in panel
    assert "quality: this._quality" in panel
    assert "cameras," in panel
    assert "zoom: maticClamp(home / camera.distance" in panel
    storage_block = panel[
        panel.index("\n  _savePreferences() {") : panel.index(
            "\n  _schedulePreferencesSave()"
        )
    ]
    assert "this._scene" not in storage_block
    assert "scene_url" not in storage_block


def test_map_panel_has_accessible_reduced_motion_and_health_status() -> None:
    """Loading, stream health, and motion preferences stay accessible."""
    panel = _STUDIO_JS[_STUDIO_JS.index("class MaticMapStudio") :]
    assert 'matchMedia?.(\n      "(prefers-reduced-motion: reduce)"' in panel
    assert "if (!animate || this._reducedMotion)" in panel
    assert "if (this._reducedMotion) return;" in panel
    assert "@media (prefers-reduced-motion: reduce)" in panel
    assert 'role="status"' in panel
    assert 'aria-live="polite"' in panel
    assert 'aria-atomic="true"' in panel
    assert '"aria-busy"' in panel
    assert "map_truncated" in panel
    assert "stream_failures" in panel
    assert "stream_state" in panel


def test_map_panel_uses_private_catalog_and_bounded_quality_sampling() -> None:
    """The panel works without an enabled photo camera and can lower GPU load."""
    panel = _STUDIO_JS[_STUDIO_JS.index("class MaticMapStudio") :]
    assert '"/api/matic_robot/slam_entries"' in _STUDIO_JS
    assert "await this._fetchCatalog();" in panel
    assert "this._catalogState() || entities.photo?.[1]" in panel
    assert 'cache: "no-store"' in panel
    assert "MATIC_MAP_QUALITY_BUDGETS" in _STUDIO_JS
    assert 'class="quality"' in panel
    assert "_samplePoints(" in panel
    assert "this._renderFloorCount ?? this._scene.floorCount" in panel
    assert "this._renderSurfaceCount ?? this._scene.surfaceCount" in panel


def test_hass_refresh_does_not_rebuild_an_open_editor() -> None:
    """Routine HA state refreshes must not destroy an open dropdown's DOM."""
    setter = _JS[_JS.index("set hass(value)") : _JS.index("set selector(value)")]
    assert "previousLanguage" in setter
    assert "languageChanged" in setter
    assert "if (!hadHass || languageChanged" in setter
    assert 'querySelectorAll("ha-selector")' in setter
    assert setter.count("this._render();") == 1


def test_room_list_does_not_clip_dropdown_menus() -> None:
    """Room list styling must leave nested selector popups visible."""
    styles = _JS[_JS.index("<style>") : _JS.index("</style>")]
    list_rule = styles[styles.index(".list {") :]
    list_rule = list_rule[: list_rule.index("}")]
    assert "overflow: hidden" not in list_rule


def test_editor_cache_buster_tracks_javascript_content() -> None:
    """A frontend-only fix must load even before the next version bump."""
    expected = sha256(_EDITOR_PATH.read_bytes()).hexdigest()[:12]
    assert frontend.ROOM_PLAN_EDITOR_VERSION == expected
    assert expected in frontend.ROOM_PLAN_EDITOR_PATH

    studio_expected = sha256(_STUDIO_PATH.read_bytes()).hexdigest()[:12]
    assert frontend.MATIC_MAP_STUDIO_VERSION == studio_expected
    assert studio_expected in frontend.MATIC_MAP_STUDIO_PATH
    assert 'customElements.get("matic-map-panel-v0-3-0")' in _STUDIO_JS


def test_node_syntax_check() -> None:
    """Gate the module through ``node --check`` when node is available."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not available on PATH")
    for path in (_EDITOR_PATH, _STUDIO_PATH):
        result = subprocess.run(
            [node, "--check", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
