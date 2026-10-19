"""The temporary Windows probe keeps unrecognized speech out of diagnostics."""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


@pytest.fixture
def probe(monkeypatch, tmp_path):
    focus = SimpleNamespace(
        appModule=SimpleNamespace(appName="msedge", appModuleName="appModuleHandler"),
        name="Map options",
        role="button",
    )
    api = ModuleType("api")
    api.getFocusObject = lambda: focus
    plugins = ModuleType("globalPluginHandler")
    plugins.GlobalPlugin = type("GlobalPlugin", (), {})
    speech = ModuleType("speech")
    extensions = ModuleType("speech.extensions")
    extensions.pre_speechQueued = SimpleNamespace(
        register=lambda callback: None, unregister=lambda callback: None
    )
    speech.extensions = extensions
    for name, value in (
        ("api", api),
        ("globalPluginHandler", plugins),
        ("speech", speech),
        ("speech.extensions", extensions),
    ):
        monkeypatch.setitem(sys.modules, name, value)
    for name, filename in (
        ("NVDA_PILOT_DIR", "."),
        ("NVDA_PILOT_PHASE_FILE", "phase.json"),
        ("NVDA_PILOT_EVENT_FILE", "events.jsonl"),
    ):
        monkeypatch.setenv(name, str(tmp_path / filename))
    (tmp_path / "phase.json").write_text('{"phase":"tab-1"}')
    source = Path(__file__).parent / "windows/nvda_speech_probe.py"
    spec = importlib.util.spec_from_file_location("windows_probe_test", source)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.GlobalPlugin(), focus, api, tmp_path


def test_unmatched_speech_and_focus_are_counted_without_private_text(probe):
    plugin, focus, _, root = probe
    secret = "private customer phrase"
    focus.name = secret
    continued = []
    plugin.event_gainFocus(focus, lambda: continued.append(True))
    plugin._on_speech_queued([secret, object()], None)
    counts = json.loads((root / "probe-counts.json").read_text())
    assert counts["focusCallbacks"] == 1
    assert counts["speechCallbacks"] == 1
    assert counts["msedgeCallbacks"] == 2
    assert counts["segments"] == 1
    assert counts["whitelistedSegments"] == 0
    assert continued == [True]
    assert secret not in (root / "events.jsonl").read_text()
    assert secret not in (root / "probe-counts.json").read_text()


def test_allowlisted_speech_still_has_the_original_evidence_provenance(probe):
    plugin, focus, _, root = probe
    plugin.event_gainFocus(focus, lambda: None)
    plugin._on_speech_queued(["Map options"], None)
    events = [
        json.loads(line) for line in (root / "events.jsonl").read_text().splitlines()
    ]
    assert [event["kind"] for event in events] == ["loaded", "focus", "speech"]
    assert events[-1]["segments"] == ["Map options"]
    assert events[-1]["focusName"] == "Map options"
    assert events[-1]["module"] == "msedge"
    assert events[-1]["pid"] == events[0]["pid"]
    assert events[-1]["sourceHash"] == events[0]["sourceHash"]
    assert (
        json.loads((root / "probe-counts.json").read_text())["whitelistedSegments"] == 1
    )


def test_unknown_modules_and_callback_errors_are_bounded_without_details(probe):
    plugin, focus, api, root = probe
    focus.appModule.appName = "private application"
    plugin._on_speech_queued(["Map options"], None)

    def missing_focus():
        raise RuntimeError("private API failure")

    api.getFocusObject = missing_focus
    plugin._on_speech_queued(["Map options"], None)

    class BrokenSequence:
        def __iter__(self):
            raise RuntimeError("private sequence failure")

    plugin._on_speech_queued(BrokenSequence(), None)
    plugin._counts["segments"] = 10_000
    plugin._on_speech_queued(["private text"], None)
    counts_raw = (root / "probe-counts.json").read_text()
    counts = json.loads(counts_raw)
    assert counts["otherCallbacks"] == 1
    assert counts["unknownCallbacks"] == 3
    assert counts["errors"] > 0
    assert counts["segments"] == 10_000
    assert "private" not in counts_raw
    assert len((root / "events.jsonl").read_text().splitlines()) == 1


def test_approved_label_does_not_persist_an_unmatched_tail(probe):
    plugin, focus, _, root = probe
    focus.name = "Map options private customer"
    plugin.event_gainFocus(focus, lambda: None)
    plugin._on_speech_queued(["Map options private customer", "Kitchenette"], None)
    raw = (root / "events.jsonl").read_text()
    events = [json.loads(line) for line in raw.splitlines()]
    assert events[-1]["segments"] == ["Map options"]
    assert events[-1]["focusName"] == "Map options"
    assert events[-2]["name"] == "Map options"
    assert "private customer" not in raw
    assert "Kitchenette" not in raw


def test_handler_class_name_does_not_authorize_another_executable(probe):
    plugin, focus, _, root = probe
    focus.appModule.appName = "notepad"
    focus.appModule.appModuleName = "msedge"
    plugin._on_speech_queued(["Map options"], None)
    assert len((root / "events.jsonl").read_text().splitlines()) == 1
    assert json.loads((root / "probe-counts.json").read_text())["otherCallbacks"] == 1


def test_missing_executable_identity_is_not_replaced_with_handler_name(probe):
    plugin, focus, _, root = probe
    del focus.appModule.appName
    focus.appModule.appModuleName = "msedge"
    plugin._on_speech_queued(["Map options"], None)
    assert len((root / "events.jsonl").read_text().splitlines()) == 1
    counts = json.loads((root / "probe-counts.json").read_text())
    assert counts["unknownCallbacks"] == 1
    assert counts["errors"] > 0
