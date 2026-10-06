"""Offline contracts for the registered Map Studio frontend assets."""

from __future__ import annotations

import gzip
import re
import shutil
import subprocess
from hashlib import sha256
from pathlib import Path

import pytest

from custom_components.matic_robot import frontend

_STUDIO_V4_DIRECTORY = frontend.MATIC_MAP_STUDIO_V4_DIRECTORY
_SCENE_PARSER_SOURCE = (
    Path(__file__).parents[1] / "frontend" / "map-studio-v4" / "scene-parser.ts"
).read_text(encoding="utf-8")
_STUDIO_V4_PATH = _STUDIO_V4_DIRECTORY / "index.js"
_STUDIO_V4_CHUNK_DIRECTORY = _STUDIO_V4_DIRECTORY / "chunks"
_STUDIO_V4_SHARED_CHUNK_PATHS = tuple(
    sorted(_STUDIO_V4_CHUNK_DIRECTORY.glob("chunk-*.js"))
)
_STUDIO_V4_WORKFLOW_CHUNK_PATHS = tuple(
    sorted(_STUDIO_V4_CHUNK_DIRECTORY.glob("workflow-panel-*.js"))
)
_STUDIO_V4_DIAGNOSTICS_CHUNK_PATHS = tuple(
    sorted(_STUDIO_V4_CHUNK_DIRECTORY.glob("diagnostics-panel-*.js"))
)
_STUDIO_V4_EAGER_PATHS = (_STUDIO_V4_PATH, *_STUDIO_V4_SHARED_CHUNK_PATHS)
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


def test_v4_foundation_is_local_licensed_and_within_initial_budget() -> None:
    """Keep eager assets and lazy workflow code within their private budgets."""
    assert all(path.is_file() for path in _STUDIO_V4_EAGER_PATHS)
    assert _STUDIO_V4_SHARED_CHUNK_PATHS
    assert len(_STUDIO_V4_WORKFLOW_CHUNK_PATHS) == 1
    assert len(_STUDIO_V4_DIAGNOSTICS_CHUNK_PATHS) == 1
    eager_bytes = [path.read_bytes() for path in _STUDIO_V4_EAGER_PATHS]
    workflow_bytes = _STUDIO_V4_WORKFLOW_CHUNK_PATHS[0].read_bytes()
    diagnostics_bytes = _STUDIO_V4_DIAGNOSTICS_CHUNK_PATHS[0].read_bytes()
    eager_gzip_bytes = sum(
        len(gzip.compress(contents, mtime=0)) for contents in eager_bytes
    )
    assert eager_gzip_bytes <= 90 * 1024
    assert len(gzip.compress(workflow_bytes, mtime=0)) <= 30 * 1024
    assert len(gzip.compress(diagnostics_bytes, mtime=0)) <= 30 * 1024

    # The custom element implementation and registration stay in the lazy
    # workflow module. The shared tag constant may be needed by shell selectors,
    # but the workflow class itself must not leak into eagerly loaded assets.
    assert b"MaticMapWorkflowV4" in workflow_bytes
    assert b"MaticMapDiagnosticsV4" in diagnostics_bytes
    assert all(
        b"MaticMapDiagnosticsV4" not in contents
        for contents in [*eager_bytes, workflow_bytes]
    )
    assert all(b"MaticMapWorkflowV4" not in contents for contents in eager_bytes)
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
