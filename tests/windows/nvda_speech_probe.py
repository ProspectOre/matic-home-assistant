"""Temporary passive recorder for the Windows AT qualification pilot only."""

import hashlib
import json
import os
import re
import time

import api
import globalPluginHandler
import speech.extensions as speechExtensions

SAFE_TERMS = (
    "Map options",
    "Your plans",
    "How to move the map",
    "Matic Map",
    "Kitchen",
)
MAX_SEGMENT = 180
MAX_COUNTER = 10_000


def _safe_terms(text):
    if len(text) > MAX_SEGMENT or not all(
        character.isprintable() for character in text
    ):
        return []
    return [
        term
        for term in SAFE_TERMS
        if re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", text, re.IGNORECASE)
    ]


class GlobalPlugin(globalPluginHandler.GlobalPlugin):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._phase_path = os.environ["NVDA_PILOT_PHASE_FILE"]
        self._event_path = os.environ["NVDA_PILOT_EVENT_FILE"]
        self._counts_path = os.path.join(
            os.environ["NVDA_PILOT_DIR"], "probe-counts.json"
        )
        self._counts = dict.fromkeys(
            (
                "focusCallbacks",
                "speechCallbacks",
                "msedgeCallbacks",
                "otherCallbacks",
                "unknownCallbacks",
                "segments",
                "whitelistedSegments",
                "errors",
            ),
            0,
        )
        self._source_hash = self._hash_source()
        speechExtensions.pre_speechQueued.register(self._on_speech_queued)
        self._append({"kind": "loaded"})
        self._publish_counts()

    def _hash_source(self):
        with open(__file__, "rb") as source:
            return hashlib.sha256(source.read()).hexdigest()

    def _phase(self):
        try:
            with open(self._phase_path, encoding="utf-8") as marker:
                value = json.load(marker)
            if value.get("phase") not in {
                "tab-1",
                "tab-2",
                "tab-3",
                "tab-4",
                "tab-5",
                "tab-6",
                "tab-7",
                "tab-8",
                "nvda-report",
            }:
                return "idle"
            return value["phase"]
        except (OSError, ValueError, TypeError):
            return "idle"

    def _module_kind(self, obj=None):
        try:
            focus = obj if obj is not None else api.getFocusObject()
            # Compare NVDA's app identity; handler classes can be shared.
            module = focus.appModule.appName
            if not isinstance(module, str) or not module:
                return "unknown"
            module = module.lower()
            if module in {"msedge", "msedge.exe"}:
                return "msedge"
            return "other" if module else "unknown"
        except Exception:
            self._increment_count("errors")
            return "unknown"

    def _module(self, obj=None):
        return "msedge" if self._module_kind(obj) == "msedge" else None

    def _increment_count(self, name, amount=1):
        self._counts[name] = min(MAX_COUNTER, self._counts[name] + amount)

    def _count_callback(self, name, obj=None):
        self._increment_count(name)
        self._increment_count(self._module_kind(obj) + "Callbacks")

    def _publish_counts(self):
        # Separate from speech evidence: these counters contain no names or text.
        try:
            temporary = self._counts_path + ".tmp"
            with open(temporary, "w", encoding="utf-8") as counts:
                json.dump(self._counts, counts, separators=(",", ":"))
            os.replace(temporary, self._counts_path)
        except OSError:
            self._increment_count("errors")

    def _append(self, value, module=None):
        if value.get("kind") == "loaded":
            module = "nvda"
        elif module is None:
            module = self._module()
        if module is None:
            return
        record = {
            "timeNs": str(time.time_ns()),
            "pid": os.getpid(),
            "module": module,
            "sourceHash": self._source_hash,
            "phase": self._phase(),
            **value,
        }
        with open(self._event_path, "a", encoding="utf-8") as events:
            events.write(
                json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n"
            )

    def event_gainFocus(self, obj, nextHandler):
        try:
            self._count_callback("focusCallbacks", obj)
            name = str(getattr(obj, "name", ""))
            role = str(getattr(obj, "role", ""))
            module = self._module(obj)
            terms = _safe_terms(name)
            if module and terms:
                self._append(
                    {"kind": "focus", "name": terms[0], "role": role[:48]},
                    module,
                )
        except Exception:
            self._increment_count("errors")
        finally:
            self._publish_counts()
            nextHandler()

    def _safe_focus_name(self):
        try:
            name = str(getattr(api.getFocusObject(), "name", ""))
            terms = _safe_terms(name)
            if terms:
                return terms[0]
        except Exception:
            self._increment_count("errors")
        return None

    def _on_speech_queued(self, speechSequence, priority):
        try:
            self._count_callback("speechCallbacks")
            segments = []
            for segment in speechSequence:
                if isinstance(segment, str):
                    self._increment_count("segments")
                if (
                    not isinstance(segment, str)
                    or not segment
                    or len(segment) > MAX_SEGMENT
                ):
                    continue
                terms = _safe_terms(segment)
                if terms:
                    segments.extend(term for term in terms if term not in segments)
                    self._increment_count("whitelistedSegments")
            if segments:
                self._append(
                    {
                        "kind": "speech",
                        "segments": segments[:8],
                        "focusName": self._safe_focus_name(),
                    }
                )
        except Exception:
            # Observation must never disrupt NVDA's speech queue.
            self._increment_count("errors")
        finally:
            self._publish_counts()

    def terminate(self, *args, **kwargs):
        speechExtensions.pre_speechQueued.unregister(self._on_speech_queued)
        super().terminate(*args, **kwargs)
