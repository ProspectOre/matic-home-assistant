"""Offline contracts for the registered Map Studio frontend assets."""

from __future__ import annotations

import gzip
import json
import re
import shutil
import subprocess
from hashlib import sha256
from pathlib import Path

import pytest

from custom_components.matic_robot import frontend
from tests.frontend_sources import shipped_modules, without_comments

_MS_CUSTOM_PROPERTY_USE = re.compile(r"var\(\s*(--ms-[a-z0-9-]+)")
_MS_CUSTOM_PROPERTY_DEFINED = re.compile(r"(--ms-[a-z0-9-]+)\s*:")
_MS_CUSTOM_PROPERTY_SET = re.compile(r"""setProperty\(\s*["'`](--ms-[a-z0-9-]+)["'`]""")

_REPOSITORY = Path(__file__).parents[1]
_STUDIO_V4_DIRECTORY = frontend.MATIC_MAP_STUDIO_V4_DIRECTORY
_SCENE_PARSER_SOURCE = (
    _REPOSITORY / "frontend" / "map-studio-v4" / "scene-parser.ts"
).read_text(encoding="utf-8")
_STUDIO_V4_CHUNK_DIRECTORY = _STUDIO_V4_DIRECTORY / "chunks"
_STUDIO_V4_WORKFLOW_CHUNK_PATHS = tuple(
    sorted(_STUDIO_V4_CHUNK_DIRECTORY.glob("workflow-panel-*.js"))
)
_STUDIO_V4_DIAGNOSTICS_CHUNK_PATHS = tuple(
    sorted(_STUDIO_V4_CHUNK_DIRECTORY.glob("diagnostics-panel-*.js"))
)
_STUDIO_V4_JS = "\n".join(
    path.read_text(encoding="utf-8")
    for path in sorted(_STUDIO_V4_DIRECTORY.rglob("*.js"))
)


def _studio_v4_tree_hash() -> str:
    digest = sha256()
    for path in sorted(_STUDIO_V4_DIRECTORY.rglob("*")):
        if not path.is_file():
            continue
        digest.update(path.relative_to(_STUDIO_V4_DIRECTORY).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:12]


def test_v4_cache_key_tracks_packaged_module_tree() -> None:
    expected = _studio_v4_tree_hash()
    assert frontend.MATIC_MAP_STUDIO_V4_VERSION == expected
    assert expected in frontend.MATIC_MAP_STUDIO_V4_PATH
    assert "import.meta.url.match" in _STUDIO_V4_JS
    assert "matic-map-panel-v0-4-0" in _STUDIO_V4_JS
    assert "matic-map-studio-gallery-v0-4-0" not in _STUDIO_V4_JS
    assert not hasattr(frontend, "ROOM_PLAN_EDITOR_PATH")


def _startup_graph() -> tuple[int, dict[str, int]]:
    """Read the startup graph and budget from their one definition."""
    node = shutil.which("node")
    assert node is not None, "node measures the startup graph"
    result = subprocess.run(
        [node, str(_REPOSITORY / "scripts" / "startup_graph.mjs")],
        capture_output=True,
        text=True,
        check=True,
    )
    graph = json.loads(result.stdout)
    return graph["budget"], graph["assets"]


def test_v4_foundation_is_local_licensed_and_within_initial_budget() -> None:
    """Keep the startup graph and lazy workflow code within their budgets."""
    budget, startup = _startup_graph()
    assert sum(startup.values()) <= budget, startup
    assert len(_STUDIO_V4_WORKFLOW_CHUNK_PATHS) == 1
    assert len(_STUDIO_V4_DIAGNOSTICS_CHUNK_PATHS) == 1
    startup_bytes = [
        (_STUDIO_V4_DIRECTORY.parent / path).read_bytes() for path in startup
    ]
    workflow_bytes = _STUDIO_V4_WORKFLOW_CHUNK_PATHS[0].read_bytes()
    diagnostics_bytes = _STUDIO_V4_DIAGNOSTICS_CHUNK_PATHS[0].read_bytes()
    assert len(gzip.compress(workflow_bytes, mtime=0)) <= 30 * 1024
    assert len(gzip.compress(diagnostics_bytes, mtime=0)) <= 30 * 1024

    # The custom element implementation and registration stay in the lazy
    # workflow module. The shared tag constant may be needed by shell selectors,
    # but the workflow class itself must not leak into eagerly loaded assets.
    assert b"MaticMapWorkflowV4" in workflow_bytes
    assert b"MaticMapDiagnosticsV4" in diagnostics_bytes
    assert all(
        b"MaticMapDiagnosticsV4" not in contents
        for contents in [*startup_bytes, workflow_bytes]
    )
    assert all(b"MaticMapWorkflowV4" not in contents for contents in startup_bytes)
    assert re.search(
        rb"customElements\.get\((\w+)\)\|\|customElements\.define\(\1,",
        workflow_bytes,
    )
    assert "SPDX-License-Identifier: BSD-3-Clause" in _STUDIO_V4_JS
    assert 'from"lit"' not in _STUDIO_V4_JS
    assert "https://" not in _STUDIO_V4_JS
    assert frontend.MATIC_MAP_PANEL_ELEMENT == (
        f"matic-map-panel-v0-4-0-{frontend.MATIC_MAP_STUDIO_V4_VERSION}"
    )


def test_workflow_only_classes_ship_in_the_lazy_workflow_chunk() -> None:
    """design-system.md: classes only workflow views use stay out of controls.ts."""
    modules = shipped_modules()
    assert ".ms-chip" not in modules["controls.ts"]
    assert ".ms-chip" in modules["workflow-panel.ts"]


def test_v4_bundle_is_ascii_safe_for_home_assistant_file_editor() -> None:
    """Prevent File Editor uploads from corrupting UTF-8 UI glyphs."""
    for path in _STUDIO_V4_DIRECTORY.rglob("*.js"):
        assert path.read_bytes().isascii(), path


def test_node_syntax_check() -> None:
    """Gate the module through ``node --check`` when node is available."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not available on PATH")
    for path in _STUDIO_V4_DIRECTORY.rglob("*.js"):
        result = subprocess.run(
            [node, "--check", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr


def test_scene_parser_worker_stays_bounded_and_disposable() -> None:
    """Keep local worker execution, fallback, and teardown contracts visible."""
    assert "new Blob([workerSource()]" in _SCENE_PARSER_SOURCE
    assert "URL.createObjectURL" in _SCENE_PARSER_SOURCE
    assert "new Worker(this.#workerUrl)" in _SCENE_PARSER_SOURCE
    assert "worker.postMessage(data, transfer)" in _SCENE_PARSER_SOURCE
    assert "request.fallback(fallbackController.signal)" in _SCENE_PARSER_SOURCE
    assert "this.#worker?.terminate()" in _SCENE_PARSER_SOURCE
    assert "#queued: CodecRun | null = null" in _SCENE_PARSER_SOURCE
    assert 'new ContractError("scene-parser-busy")' in _SCENE_PARSER_SOURCE
    assert "URL.revokeObjectURL(this.#workerUrl)" in _SCENE_PARSER_SOURCE


def _ms_custom_properties(source: str) -> tuple[set[str], set[str]]:
    """The ``--ms-*`` names a source uses and defines, ignoring comments."""
    code = without_comments(source)
    used = set(_MS_CUSTOM_PROPERTY_USE.findall(code))
    defined = {
        name
        for pattern in (_MS_CUSTOM_PROPERTY_DEFINED, _MS_CUSTOM_PROPERTY_SET)
        for name in pattern.findall(code)
    }
    return used, defined


_MS_SOURCES = {
    "declaration": ("css`a{--ms-x:1} b{c:var(--ms-x)}`", {"--ms-x"}, {"--ms-x"}),
    "double-quoted setProperty": ('s.setProperty("--ms-x", v)', set(), {"--ms-x"}),
    "single-quoted setProperty": ("s.setProperty('--ms-x', v)", set(), {"--ms-x"}),
    "backtick setProperty": ("s.setProperty(`--ms-x`, v)", set(), {"--ms-x"}),
    "unquoted setProperty is not a name": ("s.setProperty(name, v)", set(), set()),
    "definition in a style comment": (
        "css`/* --ms-x: 1; */ b{c:var(--ms-x)}`",
        {"--ms-x"},
        set(),
    ),
    "use in a style comment": ("css`/* var(--ms-x) */ a{--ms-y:1}`", set(), {"--ms-y"}),
    "definition in a script block comment": (
        '/* s.setProperty("--ms-x", v) */ var_(css`c{c:var(--ms-x)}`)',
        {"--ms-x"},
        set(),
    ),
    "definition in a script line comment": (
        '// s.setProperty("--ms-x", v)\ncss`c{c:var(--ms-x)}`',
        {"--ms-x"},
        set(),
    ),
    "url slashes are not a comment": (
        "css`u(https://x) a{--ms-x:1}`",
        set(),
        {"--ms-x"},
    ),
}


@pytest.mark.parametrize(
    ("source", "used", "defined"), _MS_SOURCES.values(), ids=_MS_SOURCES.keys()
)
def test_ms_custom_property_reader(
    source: str, used: set[str], defined: set[str]
) -> None:
    assert _ms_custom_properties(source) == (used, defined)


def test_every_ms_custom_property_is_defined() -> None:
    """A ``var(--ms-*)`` without a definition silently falls back to inheritance."""
    found = [_ms_custom_properties(text) for text in shipped_modules().values()]
    used = set().union(*(names for names, _ in found))
    defined = set().union(*(names for _, names in found))
    assert used - defined == set(), f"--ms-* used but never defined: {used - defined}"
