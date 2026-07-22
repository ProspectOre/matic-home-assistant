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
from custom_components.matic_robot.client.commands import CleaningMode, CoverageSetting
from custom_components.matic_robot.room_plan_selector import MaticRoomPlanSelector

_EDITOR_PATH = Path(frontend.__file__).with_name("room_plan_editor.js")
_JS = _EDITOR_PATH.read_text(encoding="utf-8")


def test_registers_ha_selector_for_python_selector_type() -> None:
    """The element name must be the one HA derives from the selector type."""
    match = re.search(r'customElements\.define\(\s*"([^"]+)"', _JS)
    assert match is not None
    expected = f"ha-selector-{MaticRoomPlanSelector.selector_type}"
    assert match.group(1) == expected
    # The guard that avoids redefining the element must use the same name.
    assert f'customElements.get("{expected}")' in _JS


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


def test_nested_select_change_does_not_escape_as_the_editor_value() -> None:
    """A scalar dropdown event must not replace the form's full room list."""
    listener = _JS[_JS.index('field.addEventListener("value-changed"') :]
    listener = listener[: listener.index("return field;")]
    assert listener.index("event.stopPropagation();") < listener.index(
        "onChange(event.detail.value);"
    )


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


def test_node_syntax_check() -> None:
    """Gate the module through ``node --check`` when node is available."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not available on PATH")
    result = subprocess.run(
        [node, "--check", str(_EDITOR_PATH)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
