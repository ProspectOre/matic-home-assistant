#!/usr/bin/env python3
"""Classify immutable review-comment bodies by their own result section."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from _thread import RLock
from array import array
from bisect import bisect_left, bisect_right
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

# Pinned Markdown packages are embedded so every standalone native loader
# verifies the complete parser bundle before importing third-party code.
_MARKDOWN_NAMESPACE = "_review_gate_markdown_ee015381_f0fa19c6"
_MARKDOWN_MODULES = None
_MARKDOWN_LOCK = RLock()
_MARKDOWN_NAMESPACE += "_" + str(id(_MARKDOWN_LOCK))


def _markdown_packages():
    with _MARKDOWN_LOCK:
        return _load_markdown_packages()


def _load_markdown_packages():
    global _MARKDOWN_MODULES
    if _MARKDOWN_MODULES is not None:
        return _MARKDOWN_MODULES
    from _frozen_importlib import BuiltinImporter, FrozenImporter
    from _frozen_importlib_external import PathFinder

    stdlib = Path(
        getattr(sys, "_stdlib_dir", None)
        or (
            Path(sys.base_prefix)
            / "lib"
            / ("python" + ".".join(map(str, sys.version_info[:2])))
        )
    ).resolve()
    cached_os = sys.modules.get("os")
    if cached_os is not None:
        spec = getattr(cached_os, "__spec__", None)
        origin = getattr(spec, "origin", None)
        if origin not in ("built-in", "frozen") and (
            not isinstance(origin, str) or Path(origin).resolve() != stdlib / "os.py"
        ):
            raise ImportError("Conflicting Markdown stdlib root module")

    def trusted_origin(spec):
        if spec is None:
            return False
        if spec.origin in ("built-in", "frozen"):
            return True
        if not isinstance(spec.origin, str):
            return False
        origin = Path(spec.origin).resolve()
        return stdlib in origin.parents and not any(
            part in ("site-packages", "dist-packages") for part in origin.parts
        )

    class StdlibOnly:
        def find_spec(self, fullname, path=None, target=None):
            spec = BuiltinImporter.find_spec(fullname) or FrozenImporter.find_spec(
                fullname
            )
            if spec is None:
                search = (
                    list(path)
                    if path is not None
                    else [str(stdlib), str(stdlib / "lib-dynload")]
                )
                spec = PathFinder.find_spec(fullname, search)
            if not trusted_origin(spec):
                raise ImportError("Markdown dependency requested a non-stdlib module")
            return spec

    guard = StdlibOnly()
    sys.meta_path.insert(0, guard)
    try:
        for name in (
            "base64",
            "builtins",
            "hashlib",
            "io",
            "types",
            "zipfile",
            "abc",
            "collections",
            "contextlib",
            "enum",
            "functools",
            "inspect",
            "keyword",
            "operator",
            "typing",
            "warnings",
            "string",
            "dataclasses",
            "bisect",
            "urllib.parse",
            "__future__",
            "signal",
            "threading",
        ):
            cached = sys.modules.get(name)
            if cached is not None and not trusted_origin(
                getattr(cached, "__spec__", None)
            ):
                raise ImportError("Conflicting Markdown stdlib module")
            __import__(name)
        import base64
        import builtins
        import hashlib
        import io
        import types
        import zipfile
    finally:
        sys.meta_path.remove(guard)

    source = {}
    allow = {
        "mistune/__init__.py",
        "mistune/block_parser.py",
        "mistune/core.py",
        "mistune/helpers.py",
        "mistune/inline_parser.py",
        "mistune/list_parser.py",
        "mistune/markdown.py",
        "mistune/util.py",
        "mistune/_inline/emphasis.py",
        "mistune/_inline/links.py",
        "mistune/plugins/__init__.py",
        "mistune/plugins/formatting.py",
        "mistune/plugins/footnotes.py",
        "mistune/plugins/table.py",
        "mistune/renderers/html.py",
        "mistune/renderers/_list.py",
        "typing_extensions.py",
    }
    for _filename, digest, encoded in _MARKDOWN_WHEELS:
        blob = base64.b64decode(encoded, validate=True)
        if hashlib.sha256(blob).hexdigest() != digest:
            raise ImportError("Markdown archive hash mismatch")
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or len(names) > 100:
                raise ImportError("Ambiguous Markdown archive members")
            if sum(item.file_size for item in archive.infolist()) > 2_000_000:
                raise ImportError("Oversized Markdown archive")
            for item in archive.infolist():
                parts = item.filename.split("/")
                if (
                    item.filename.startswith("/")
                    or "\\" in item.filename
                    or any(part in ("", ".", "..") for part in parts)
                    or (item.external_attr >> 16) & 0o170000 == 0o120000
                ):
                    raise ImportError("Unsafe Markdown archive member")
                if not (
                    parts[0] == "mistune"
                    or parts[0] == "typing_extensions.py"
                    or parts[0]
                    in ("mistune-3.3.4.dist-info", "typing_extensions-4.15.0.dist-info")
                ):
                    raise ImportError("Unexpected Markdown archive package")
                if item.filename in allow:
                    source[item.filename] = archive.read(item).decode("utf-8")
    if set(source) != allow:
        raise ImportError("Missing Markdown package member")
    if any(
        name == _MARKDOWN_NAMESPACE or name.startswith(_MARKDOWN_NAMESPACE + ".")
        for name in sys.modules
    ):
        raise ImportError("Conflicting private Markdown module")
    loaded = {}
    package = types.ModuleType(_MARKDOWN_NAMESPACE)
    package.__path__ = []
    package.__package__ = _MARKDOWN_NAMESPACE
    loaded[_MARKDOWN_NAMESPACE] = package
    sys.modules[_MARKDOWN_NAMESPACE] = package
    standard = {
        "abc",
        "bisect",
        "builtins",
        "collections",
        "contextlib",
        "dataclasses",
        "enum",
        "functools",
        "html",
        "inspect",
        "io",
        "keyword",
        "operator",
        "re",
        "string",
        "sys",
        "types",
        "typing",
        "urllib",
        "warnings",
        "__future__",
    }

    def module(name):
        if name in loaded:
            return loaded[name]
        if not name.startswith(_MARKDOWN_NAMESPACE + "."):
            raise ImportError("Markdown import escaped its private namespace")
        relative = name[len(_MARKDOWN_NAMESPACE) + 1 :]
        stem = relative.replace(".", "/")
        filename = (
            stem + "/__init__.py" if stem + "/__init__.py" in source else stem + ".py"
        )
        namespace = relative in ("mistune._inline", "mistune.renderers")
        if filename not in source and not namespace:
            raise ImportError("Unbundled Markdown module")
        value = types.ModuleType(name)
        value.__file__ = "<verified-markdown>/" + filename
        value.__package__ = (
            name
            if filename.endswith("/__init__.py") or namespace
            else name.rpartition(".")[0]
        )
        if value.__package__ == name:
            value.__path__ = []
        value.__builtins__ = dict(vars(builtins), __import__=private_import)
        loaded[name] = value
        sys.modules[name] = value
        parent, _, child = name.rpartition(".")
        setattr(module(parent), child, value)
        if not namespace:
            exec(compile(source[filename], value.__file__, "exec"), value.__dict__)
        return value

    def plugin_import(name):
        if not name.startswith("mistune."):
            raise ImportError("Unbundled Markdown plugin")
        return module(_MARKDOWN_NAMESPACE + "." + name)

    def private_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level:
            base = globals["__package__"].split(".")
            if level > len(base):
                raise ImportError("Markdown relative import escaped its package")
            name = ".".join(base[: len(base) - level + 1]) + (
                "." + name if name else ""
            )
        elif name == "typing_extensions":
            name = _MARKDOWN_NAMESPACE + ".typing_extensions"
        elif name == "importlib" and fromlist == ("import_module",):
            return types.SimpleNamespace(import_module=plugin_import)
        elif name.split(".")[0] in standard:
            value = sys.modules.get(name)
            if value is None or not trusted_origin(getattr(value, "__spec__", None)):
                raise ImportError("Unverified Markdown stdlib import")
            return builtins.__import__(name, globals, locals, fromlist, 0)
        else:
            raise ImportError("Unbundled Markdown dependency import")
        value = module(name)
        for child in fromlist:
            if child != "*" and not hasattr(value, child):
                module(name + "." + child)
        return value if fromlist else module(name.split(".")[0])

    try:
        mistune = module(_MARKDOWN_NAMESPACE + ".mistune")
        if mistune.__version__ != "3.3.4":
            raise ImportError("Incorrect Markdown package version")
    except BaseException:
        for name in loaded:
            sys.modules.pop(name, None)
        raise
    _MARKDOWN_MODULES = mistune
    return mistune


# BEGIN PINNED MARKDOWN WHEELS
_MARKDOWN_WHEELS = (
    (
        "mistune-3.3.4-py3-none-any.whl",
        "ee015381e955e370962968befe1d729ab60fafb6a715ac6751763fbce38c8d4a",
        (
            "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"
            "XpAwY5PaZGA9YMfbxdiwdtgSHWi1QRMstenOi667tdjKcBvzjRm7pjrWAjcsahZjdGLa3HFvp+DidjKuhZCT4TIW"
            "x5CqDKN5rtIHamh9KsaAlii0In5rj2Gr9duVK/K3JVnrfdGo34eWvmPsrv4sjIV8sNti6oL6MXwT7sLPk39x44M4"
            "mL5NXvf6dnxsm6VttLDtBDLwoWnB2mKY5uHkYBHbWcNCmQYablVGNi1y6ukfUEsDBBQAAAAIAMAq9lwnTOaKXAAA"
            "AFsAAAAdAAAAbWlzdHVuZS0zLjMuNC5kaXN0LWluZm8vV0hFRUwFwTEKwzAMBdBdp9DYDjJJugRfoHQrJSSzC58m"
            "YKQgy0Nu3/e2HaiywtthmnlMAz2h8BLmmRuin2FWG9/mKQ1pvNPHLOTV5N0d9fhmDu+gpfwyn9dD1BRS9CL6A1BL"
            "AwQUAAAACADAKvZcdqYpDy0AAAAxAAAAKAAAAG1pc3R1bmUtMy4zLjQuZGlzdC1pbmZvL2VudHJ5X3BvaW50cy50"
            "eHSLTs7PK87PSY0vTi7KLCgpjuXKzSwuKc1LVbBVgLL04uNzEzPz4uOtknMyuQBQSwMEFAAAAAgAwCr2XC2a8VcK"
            "AAAACAAAACUAAABtaXN0dW5lLTMuMy40LmRpc3QtaW5mby90b3BfbGV2ZWwudHh0y80sLinNS+UCAFBLAwQUAAAA"
            "CADAKvZcvuEL6gMIAABHDgAAHgAAAG1pc3R1bmUtMy4zLjQuZGlzdC1pbmZvL1JFQ09SRHXXyZaqShYG4Pl9FjhF"
            "0DOoASjSCCiNgkxYdNL3IODTF7dq3UxOpWeiy8kHEbH/HdsqG8apjv/leVmdjZ73q12hIfVRgvy31y+iEd4lP0In"
            "aphfbqQr1luewpNJ6pexqLzZTWR8jq86hDI4+Kv6sio/q3+3Yod3VX3qJWGuSF/Oi+n5UqUkciVaLrqpyjWwSK/R"
            "USQIwwHyZQVlExZe6/dD3O+867Su5FM5yytPi7oe6sPAVke7rN8+PNliZnJ9lbJLGQIeAjTJ0F9g2PTxDqqOshF7"
            "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"
            "GgAAAAAAAAAAAAAApIFwugAAbWlzdHVuZS9wbHVnaW5zL3Nwb2lsZXIucHlQSwECFAMUAAAACAC2KvZc5hCf37EH"
            "AAC1HQAAGAAAAAAAAAAAAAAApIGzvwAAbWlzdHVuZS9wbHVnaW5zL3RhYmxlLnB5UEsBAhQDFAAAAAgAtir2XN23"
            "x3I8AwAA0AcAAB0AAAAAAAAAAAAAAKSBmscAAG1pc3R1bmUvcGx1Z2lucy90YXNrX2xpc3RzLnB5UEsBAhQDFAAA"
            "AAgAtir2XCqxMbKhAQAAIAMAABYAAAAAAAAAAAAAAKSBEcsAAG1pc3R1bmUvcGx1Z2lucy91cmwucHlQSwECFAMU"
            "AAAACAC2KvZcAAAAAAIAAAAAAAAAHQAAAAAAAAAAAAAApIHmzAAAbWlzdHVuZS9yZW5kZXJlcnMvX19pbml0X18u"
            "cHlQSwECFAMUAAAACAC2KvZcrX7XQ+ACAABXCQAAGgAAAAAAAAAAAAAApIEjzQAAbWlzdHVuZS9yZW5kZXJlcnMv"
            "X2xpc3QucHlQSwECFAMUAAAACAC2KvZcfIFrwDUGAABVFgAAGQAAAAAAAAAAAAAApIE70AAAbWlzdHVuZS9yZW5k"
            "ZXJlcnMvaHRtbC5weVBLAQIUAxQAAAAIALYq9lw0t4YJ2gsAAPEqAAAdAAAAAAAAAAAAAACkgafWAABtaXN0dW5l"
            "L3JlbmRlcmVycy9tYXJrZG93bi5weVBLAQIUAxQAAAAIALYq9lw5VpYovwUAADUXAAAYAAAAAAAAAAAAAACkgbzi"
            "AABtaXN0dW5lL3JlbmRlcmVycy9yc3QucHlQSwECFAMUAAAACADAKvZctGm+yfUCAADDBQAAKAAAAAAAAAAAAAAA"
            "pIGx6AAAbWlzdHVuZS0zLjMuNC5kaXN0LWluZm8vbGljZW5zZXMvTElDRU5TRVBLAQIUAxQAAAAIAMAq9lxhUk/F"
            "vwIAAEIHAAAgAAAAAAAAAAAAAACkgezrAABtaXN0dW5lLTMuMy40LmRpc3QtaW5mby9NRVRBREFUQVBLAQIUAxQA"
            "AAAIAMAq9lwnTOaKXAAAAFsAAAAdAAAAAAAAAAAAAACkgenuAABtaXN0dW5lLTMuMy40LmRpc3QtaW5mby9XSEVF"
            "TFBLAQIUAxQAAAAIAMAq9lx2pikPLQAAADEAAAAoAAAAAAAAAAAAAACkgYDvAABtaXN0dW5lLTMuMy40LmRpc3Qt"
            "aW5mby9lbnRyeV9wb2ludHMudHh0UEsBAhQDFAAAAAgAwCr2XC2a8VcKAAAACAAAACUAAAAAAAAAAAAAAKSB8+8A"
            "AG1pc3R1bmUtMy4zLjQuZGlzdC1pbmZvL3RvcF9sZXZlbC50eHRQSwECFAMUAAAACADAKvZcvuEL6gMIAABHDgAA"
            "HgAAAAAAAAAAAAAAtIFA8AAAbWlzdHVuZS0zLjMuNC5kaXN0LWluZm8vUkVDT1JEUEsFBgAAAAAtAC0AmQwAAH/4"
            "AAAAAA=="
        ),
    ),
    (
        "typing_extensions-4.15.0-py3-none-any.whl",
        "f0fa19c6845758ab08074a0cfa8b7aecb71c999ca73d62883bc25cc018c4e548",
        (
            "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"
            "biYhM1NJocFadvczfX5xHdWDjpoLNg3kpUkS2BoZ58PS8yDdBH5lVYqKR95W5V/bCvXDaaSuLmHn1oVFQHosBd/2"
            "iIaX1S1vKmBkknZRjBeWuotjvMU7Kxq6uKCsPe8qs5Y8xL8hrJcSVoeeP7h+uLc7iDAiCBvpgim5NYPPLwgi0aeB"
            "qooMO1kTBWpFCnJa2DnNJWAc3gcvqQX+jy0HqDkE3lK0aBZoDsrflMVsWRZR04yOW85QpLhX6Mx9ZroS5fT/aJNS"
            "N1oJTRkHRrJ9s7ehWy1aXNKupb51RpZUZ9BcZHNuXTk4O728OH71/vL4VEbrWoffZjyvw+wq8WwCHpGg5MYqb06X"
            "XLj/AFBLAwQUAAAACAAAACFI2xNUmQwBAACrAQAAKQAAAHR5cGluZ19leHRlbnNpb25zLTQuMTUuMC5kaXN0LWlu"
            "Zm8vUkVDT1JEjdC7koIwAIXh3mcJiNzUwkIkAq6CQFSWxgly2XhJ0ISLPv1uY7OV9Zn5v5kjnjWh1bHoRUE5YZTL"
            "9RPwH6wa5ix8KZGS2IhdlIY7yaPLjizemFSflgFepqaI2/t617WlqMDIVHR1OhD/c5IujwxZkXPChURoyYZXcvrb"
            "Cj5cewvox/CtBU/JOhI3qk5x2qfsmnl6iuE+TxmNMb4v/Vc7xm2Ys/EEjLSpZn6CHVwI12/BUatd9EJQ3IpoQh95"
            "sluVPrG0/fe+J9U2lDIYNufaJz4HE/WT/AaiuT1H87fQoUo7S+eeoJjfct2xULLc8swKmvEhqZG9uri4bDbpF/WA"
            "phof/RXBRRDZAAx+AVBLAQIUAxQAAAAIAPBtGVuO4dO9lpMAAK1yAgAUAAAAAAAAAAAAAACkgQAAAAB0eXBpbmdf"
            "ZXh0ZW5zaW9ucy5weVBLAQIUAxQAAAAIAPBtGVvOf4+K+hAAAHA2AAAzAAAAAAAAAAAAAACkgciTAAB0eXBpbmdf"
            "ZXh0ZW5zaW9ucy00LjE1LjAuZGlzdC1pbmZvL2xpY2Vuc2VzL0xJQ0VOU0VQSwECFAMUAAAACAAAACFID3wEs1MA"
            "AABSAAAAKAAAAAAAAAAAAAAApIETpQAAdHlwaW5nX2V4dGVuc2lvbnMtNC4xNS4wLmRpc3QtaW5mby9XSEVFTFBL"
            "AQIUAxQAAAAIAAAAIUiRra+iPwUAALsMAAArAAAAAAAAAAAAAACkgaylAAB0eXBpbmdfZXh0ZW5zaW9ucy00LjE1"
            "LjAuZGlzdC1pbmZvL01FVEFEQVRBUEsBAhQDFAAAAAgAAAAhSNsTVJkMAQAAqwEAACkAAAAAAAAAAAAAAKSBNKsA"
            "AHR5cGluZ19leHRlbnNpb25zLTQuMTUuMC5kaXN0LWluZm8vUkVDT1JEUEsFBgAAAAAFAAUAqQEAAIesAAAAAA=="
        ),
    ),
)
# END PINNED MARKDOWN WHEELS


REGULAR_HEADING = re.compile(
    r"\A[ ]{0,3}(?:@|#{1,6}[ \t]+(?:[^A-Za-z0-9\r\n]+[ \t]+)?)?"
    r"codex[ \t]+review(?:[ \t]*:|[ \t]|$)|"
    r"\A[ ]{0,3}(?:#{1,6}[ \t]+)?review result(?:[ \t]*:|[ \t]|$)|"
    r"\A[ ]{0,3}\*{0,2}(?:<sub>)*!\[P[0-3][ \t]+badge\]\([^)\r\n]+\)(?:</sub>)*",
    re.IGNORECASE,
)
SECURITY_HEADING = re.compile(
    r"\A[ ]{0,3}(?:#{1,6}[ \t]+(?:[^A-Za-z0-9\r\n]+[ \t]+)?)?"
    r"(?:codex[ \t-]+)?security(?:[ \t-]+)review"
    r"(?:[ \t]*:|[ \t]*[^A-Za-z0-9\s][^\r\n]*|[ \t]*$)",
    re.IGNORECASE,
)
PRIORITY_RESULT = re.compile(r"\A[^\S\r\n]*\[P[0-3]\](?:[^\S\r\n]|$)", re.I)

# Unicode 17.0.0 DerivedCoreProperties.txt: Default_Ignorable_Code_Point.
# https://www.unicode.org/Public/17.0.0/ucd/DerivedCoreProperties.txt
# Candidate detection only: never normalize source, evidence or commit authority.
_DEFAULT_IGNORABLE_CLASS = (
    r"[\u00ad\u034f\u061c\u115f-\u1160\u17b4-\u17b5\u180b-\u180f"
    r"\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f"
    r"\ufeff\uffa0\ufff0-\ufff8\U0001bca0-\U0001bca3"
    r"\U0001d173-\U0001d17a\U000e0000-\U000e0fff]"
)
_DEFAULT_IGNORABLE = re.compile(_DEFAULT_IGNORABLE_CLASS)
_PRIORITY_CANDIDATE = re.compile(
    r"\["
    + _DEFAULT_IGNORABLE_CLASS
    + r"*P"
    + _DEFAULT_IGNORABLE_CLASS
    + r"*[0-3]"
    + _DEFAULT_IGNORABLE_CLASS
    + r"*\]",
    re.I,
)

# Unicode 17.0.0 PropList.txt: Bidi_Control, uncertainty only.
# https://www.unicode.org/Public/17.0.0/ucd/PropList.txt
_BIDI_CONTROL = re.compile(r"[\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]")
_BIDI_PRIORITY_CANDIDATE = re.compile(
    r"[\[\]]"
    + _DEFAULT_IGNORABLE_CLASS
    + r"*(?:P"
    + _DEFAULT_IGNORABLE_CLASS
    + r"*[0-3]|[0-3]"
    + _DEFAULT_IGNORABLE_CLASS
    + r"*P)"
    + _DEFAULT_IGNORABLE_CLASS
    + r"*[\[\]]",
    re.I,
)


def _unicode_priority_uncertain(row):
    if not _DEFAULT_IGNORABLE.search(row):
        return False
    # Logical order cannot establish rendered order in a bidi-controlled row.
    # Retain only uncertainty from a priority-like signature, never a finding.
    if _BIDI_CONTROL.search(row) and _BIDI_PRIORITY_CANDIDATE.search(row):
        return True
    if any(
        _DEFAULT_IGNORABLE.search(match.group())
        for match in _PRIORITY_CANDIDATE.finditer(row)
    ):
        return True
    return bool(
        PRIORITY_RESULT.match(_DEFAULT_IGNORABLE.sub("", row))
        and not PRIORITY_RESULT.match(row)
    )


RESULT_HEADING = re.compile(
    r"(?:" + REGULAR_HEADING.pattern + r")|(?:" + SECURITY_HEADING.pattern + r")",
    re.IGNORECASE,
)
REVIEWED_COMMIT = re.compile(
    r"(?im)^[ ]{0,3}\*{0,2}reviewed commit:\*{0,2}[ \t]*"
    r"`([0-9a-f]{10}|[0-9a-f]{40})`[ \t]*$"
)
FENCE_LINE = re.compile(
    r"^[ ]{0,3}(?P<char>`|~)(?P<count>(?P=char){2,})(?P<info>[^\r\n]*)$"
)
AVAILABILITY = re.compile(
    r"\A[ \t\r\n]*(?:@|#{1,6}[ \t]+(?:[^A-Za-z0-9\r\n]+[ \t]+)?)?"
    r"(?:codex[ \t]+review|review(?:[ \t]+result)?)(?:[ \t]*:|[ \t]|\r?\n|$)[ \t\r\n]*"
    r"(?:you have reached (?:your )?(?:codex )?usage limits"
    r"(?: for (?:codex )?(?:code )?reviews?)?[.!]?"
    r"(?:\.[ \t]+you can see your limits in the \[codex usage dashboard\]"
    r"\(https://chatgpt\.com/codex/cloud/settings/usage\)\.)?"
    r"(?:\r?\nTo continue using code reviews, add credits to your account and "
    r"enable them "
    r"for code reviews in your "
    r"\[settings\]\(https://chatgpt\.com/codex/cloud/settings/code-review\)\.)?|"
    r"(?:codex[ \t]+)?review(?:[ \t]+result)?(?:[ \t]+is)?[ \t]+"
    r"(?:currently[ \t]+)?(?:unavailable|at[ \t]+capacity|rate[ \t-]*limited)"
    r"(?: due(?: to)? usage quota)?[.!]?|"
    r"(?:currently[ \t]+)?(?:unavailable|at[ \t]+capacity|rate[ \t-]*limited)"
    r"(?: due(?: to)? usage quota)?[.!]?|"
    r"(?:could not|unable to)[ \t]+(?:start|complete|perform)[ \t]+"
    r"(?:the[ \t]+)?(?:codex[ \t]+)?review[.!]?|try again later[.!]?)"
    r"[ \t\r\n]*\Z",
    re.I,
)
CLEAN_SUMMARY = (
    r"(?:no (?:issues?|findings?|bugs?|vulnerabilities?) found|no major issues|"
    r"no blocking issues|didn.t find any (?:major )?issues|"
    r"did not find any (?:major )?issues)"
)
CLEAN_SALUTATION = (
    r"(?:What shall we delve into next\?|You['\u2019]re on a roll\.|Delightful!|"
    r"Nice work!|"
    r"Already looking forward to the next diff\.|Another round soon, please!|"
    r"More of your lovely PRs please\.|Hooray!|Swish!|Bravo\.|"
    r"Can['\u2019]t wait for the next one!|Keep it up!|Keep them coming!|Breezy!|"
    r"Chef['\u2019]s kiss[.!]?|:tada:)"
)
CLEAN_REACTION = r"(?::\+1:|👍|:rocket:|:rocket!|🚀)"
KNOWN_REGULAR_CLEAN_RESULT = re.compile(
    r"\A[ \t]*(?:"
    + CLEAN_SUMMARY
    + r")[.!]?(?:[ \t]+"
    + CLEAN_SALUTATION
    + r")?[ \t]*(?:"
    + CLEAN_REACTION
    + r")?[ \t]*\Z",
    re.I,
)
KNOWN_SECURITY_CLEAN_RESULT = re.compile(
    r"\A[ \t]*(?:security review completed[.!]?[ \t\r\n]+)?"
    r"(?:no (?:security )?issues (?:were )?found(?: in this pull request)?|"
    r"didn.t find any (?:major )?issues(?: in this pull request)?)[.!]?[ \t]*\Z",
    re.I,
)
KNOWN_REVIEW_FOOTER = re.compile(
    r"(?is)\A\s*<details>\s*<summary>\s*(?:\u2139\uFE0F\s*)?about codex in github"
    r"\s*</summary>\s*<br\s*/?>\s*"
    r"\[your team has set up codex to review pull requests in this repo\]"
    r"\(https://chatgpt\.com/codex/cloud/settings/general\)\.\s*"
    r"reviews are triggered when you\s*-\s*open a pull request for review\s*"
    r"-\s*mark a draft as ready\s*-\s*comment \"@codex review\"\.\s*"
    r"if codex has suggestions, it will comment; otherwise it will react with "
    r"(?:👍|:\+1:)\.\s*"
    r"codex can also answer questions or update the pr\.\s*"
    r"try commenting \"@codex address that feedback\"\.\s*</details>\s*\Z"
)
KNOWN_SECURITY_FOOTER = re.compile(
    r"(?is)\A\s*_only the user who started this review can view the report in "
    r"codex\._\s*"
    r"<details>\s*<summary>\s*(?:\u2139\uFE0F\s*)?about codex security "
    r"reviews in github"
    r"\s*</summary>\s*<br\s*/?>\s*"
    r"this is an experimental codex feature\. (?:security )?reviews are triggered "
    r"when:\s*"
    r"-\s*you comment \"@codex security review\"\s*"
    r"-\s*a regular code review gets triggered \(for example, \"@codex review\" "
    r"or when a pr (?:is|was) opened\),"
    r" and you(?:\u2019|'|&#39;)re opted in so security review runs alongside code "
    r"review\s*"
    r"once complete, codex will leave suggestions, or a comment if no findings "
    r"(?:were|are) found\.\s*</details>\s*\Z"
)
EXPLICIT_ADVERSE = re.compile(
    r"\bP[0-3]\b|\bfinding(?:s)?[ \t]+"
    r"(?:observed|remain(?:s|ing)?|reported|persist(?:s|ing)?|unresolved)\b|"
    r"\b(?:vulnerab\w*|unsafe|exploitable|defect|bug|regression|security risk|"
    r"issue remains)[^\r\n]*"
    r"\b(?:remain(?:s|ing)?|persist(?:s|ing)?|unresolved|exploitable|exposed)\b|"
    r"codex-security-review-finding:v1",
    re.I,
)
SECURITY_MARKER = re.compile(
    r"(?im)(?:^|\n)[ \t]*<!--[ \t]*codex-security-review-finding:v1[ \t]*-->[ \t]*\r?$"
)
INLINE_SECURITY_MARKER = re.compile(
    r"(?im)(?:^|\n)[ \t]*\[P[0-3]\][^\r\n]*[ \t]+"
    r"<!--[ \t]*codex-security-review-finding:v1[ \t]*-->[ \t]*\r?$"
)
SECURITY_SEVERITY = re.compile(r"(?im)(?:^|\n)[ \t]*\[P[0-3]\]")
SECURITY_REPORT_LINK = re.compile(r"\[view security finding report\]\(", re.I)
COORDINATOR_PRELUDE = re.compile(
    r"\A[ \t\r\n]*@codex review[ \t]*\r?\n[ \t\r\n]*"
    r"(?:Review current head `(?P<display_head>[0-9a-f]{40})`\."
    r"(?: Report concrete correctness, security, and regression defects with their "
    r"triggering conditions\."
    r" Assess related cases together; omit style-only preferences\.)?"
    r"[ \t]*\r?\n[ \t\r\n]*)?"
    r"<!--[ \t]*review-request:v2[ \t]+head=(?P<head>[0-9a-f]{40})[ \t]+"
    r"base=[0-9a-f]{40}[ \t]*-->[ \t]*(?:\r?\n|$)",
    re.I | re.S,
)
_PRIVATE_EVIDENCE = re.compile(
    r"\ARoot-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}\Z", re.I
)
_RETRY_REASON = re.compile(r"\ARetry reason:[^\r\n]*\Z", re.I)
_LEGACY_METADATA = re.compile(
    r"\ARoot-cause diagnosis:[ \t]*\r?\n"
    r"[ \t]*- rootCause:[^\r\n]*\r?\n"
    r"[ \t]*- changes:[^\r\n]*\r?\n"
    r"[ \t]*- validation:[^\r\n]*\Z",
    re.I,
)


def _markdown_lines(text: str, keepends: bool = False) -> list[str]:
    """Split physical Markdown CR/LF lines without rewriting inline characters."""
    lines = re.findall(r"[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$", text)
    return lines if keepends else [line.rstrip("\r\n") for line in lines]


def _backslash_escaped(text: str, position: int) -> bool:
    before = position - 1
    while before >= 0 and text[before] == "\\":
        before -= 1
    return (position - before - 1) % 2 == 1


def _without_inline_code(text: str) -> str:
    return _outside_html_blocks(text, _without_inline_code_in_markdown)


def _without_inline_code_in_markdown(text: str) -> str:
    """Mask code spans with matching backtick runs, retaining line positions."""
    runs = list(re.finditer(r"`+", text))
    next_same: dict[int, int] = {}
    closing: dict[int, int] = {}
    for index in range(len(runs) - 1, -1, -1):
        length = len(runs[index].group())
        if length in next_same:
            closing[index] = next_same[length]
        next_same[length] = index
    chunks: list[str] = []
    position = 0
    index = 0
    while index < len(runs):
        if _backslash_escaped(text, runs[index].start()):
            index += 1
            continue
        end_index = closing.get(index)
        if end_index is None:
            index += 1
            continue
        start, end = runs[index].start(), runs[end_index].end()
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
        index = end_index + 1
    chunks.append(text[position:])
    return "".join(chunks)


SECURITY_MARKER_COMMENT = re.compile(
    r"(?is)<!--[ \t]*codex-security-review-finding:v1[ \t]*-->"
)
HTML_COMMENT_END = re.compile(r"--!?>")
HTML_CODE_CONTAINER_TAGS = frozenset(
    {
        "code",
        "iframe",
        "noembed",
        "noframes",
        "pre",
        "script",
        "style",
        "textarea",
        "xmp",
    }
)
HTML_INLINE_FORMATTING_TAGS = frozenset("span a b strong em i u s sub sup".split())
RAW_HTML_TEXT_TAGS = frozenset(
    {"iframe", "noembed", "noframes", "script", "style", "textarea", "title", "xmp"}
)
HTML_VOID_TAGS = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)
HTML_HEADING_TAGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
HTML_P_CLOSING_START_TAGS = frozenset(
    {
        "address",
        "article",
        "aside",
        "blockquote",
        "center",
        "dd",
        "details",
        "dialog",
        "dir",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hgroup",
        "hr",
        "li",
        "listing",
        "main",
        "menu",
        "nav",
        "ol",
        "p",
        "pre",
        "search",
        "section",
        "summary",
        "table",
        "ul",
    }
)
HTML_BUTTON_SCOPE_BOUNDARY_TAGS = frozenset(
    {
        "applet",
        "button",
        "caption",
        "html",
        "marquee",
        "object",
        "select",
        "table",
        "td",
        "template",
        "th",
    }
)
HTML_SPECIAL_TAGS = frozenset(
    "address applet area article aside base basefont bgsound blockquote body br "
    "button caption center col colgroup dd details dir div dl dt embed fieldset "
    "figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header "
    "hgroup hr html iframe img input keygen li link listing main marquee menu "
    "meta nav noembed noframes noscript object ol p param plaintext pre script "
    "search section select source style summary table tbody td template textarea "
    "tfoot th thead title tr track ul wbr xmp".split()
)
HTML_ITEM_START_BOUNDARY_TAGS = HTML_SPECIAL_TAGS - {"address", "div", "p"}
HTML_SCOPE_BOUNDARY_TAGS = HTML_BUTTON_SCOPE_BOUNDARY_TAGS - {"button"}
HTML_IN_BODY_IGNORED_START_TAGS = frozenset(
    (
        "body caption col colgroup frame frameset head html tbody td tfoot th thead tr"
    ).split()
)
HTML_TABLE_CONTEXT_TAGS = frozenset(
    "caption colgroup table tbody td tfoot th thead tr".split()
)
HTML_FOREIGN_BREAKOUT_TAGS = frozenset(
    (
        "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 "
        "head hr i img li listing menu meta nobr ol p pre ruby s small span strong "
        "strike sub sup table tt u ul var"
    ).split()
)
HTML_ITEM_TAGS = frozenset({"li", "dt", "dd"})
HTML_IMPLIED_END_TAGS = frozenset(
    {"dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc"}
)
SVG_BUTTON_SCOPE_BOUNDARY_TAGS = frozenset({"desc", "foreignobject", "title"})
MATHML_BUTTON_SCOPE_BOUNDARY_TAGS = frozenset(
    {"annotation-xml", "mi", "mn", "mo", "ms", "mtext"}
)
SVG_HTML_INTEGRATION_POINT_TAGS = SVG_BUTTON_SCOPE_BOUNDARY_TAGS
MATHML_TEXT_INTEGRATION_POINT_TAGS = frozenset({"mi", "mn", "mo", "ms", "mtext"})
HTML_CODE_CONTAINER_CLOSER = re.compile(
    r"</\s*(?:" + "|".join(sorted(HTML_CODE_CONTAINER_TAGS)) + r")(?=[\s/>])",
    re.IGNORECASE,
)
REFERENCE_DEFINITION_START = re.compile(r"(?m)^[ ]*\[")
LIST_MARKER_PREFIX = re.compile(r"([ ]{0,3})([-+*]|[0-9]{1,9}[.)])([ \t]+)")
HTML_MARKUP_TAG_START = re.compile(r"</?\s*([A-Za-z][A-Za-z0-9:-]*)")
BACKSLASH_ESCAPED_CONTAINER_TAG = re.compile(
    r"\\+(?P<tag></?\s*(?:details|summary)\b[^<>]*>)", re.IGNORECASE
)
HTML_BLOCK_TAGS = frozenset(
    # GitHub's GFM type-6 list: source interrupts paragraphs; search and
    # hgroup remain type-7 tags and require a paragraph boundary.
    "address article aside base basefont blockquote body caption center col colgroup "
    "dd details dialog dir div dl dt fieldset figcaption figure footer form frame "
    "frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu "
    "menuitem nav noframes ol optgroup option p param section source summary table "
    "tbody td tfoot th thead title tr track ul".split()
)
HTML_BLOCK_TAG_START = re.compile(r"</?([A-Za-z][A-Za-z0-9-]*)(?=[ \t>]|/>|$)")
HTML_BLOCK_RAW_END = re.compile(r"</(?:pre|script|style|textarea)>", re.I)
HTML_ATTRIBUTE_NAME = re.compile(r"[A-Za-z_:][A-Za-z0-9_.:-]*")
VISIBLE_CHARACTER_REFERENCE = re.compile(
    r"&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?"
)
EVIDENCE_LINE_SEPARATORS = str.maketrans(
    "\r\n\v\f\x1c\x1d\x1e\x85\u2028\u2029", " " * 10
)


def _complete_html_block_tag(text: str, name: re.Match[str]) -> bool:
    """Recognize CommonMark type-7 tags without retrying growing suffixes."""
    cursor = name.end()
    closing = text.startswith("</")
    while cursor < len(text):
        before_space = cursor
        while cursor < len(text) and text[cursor] in " \t":
            cursor += 1
        if text.startswith(">", cursor) or (
            not closing and text.startswith("/>", cursor)
        ):
            cursor += 1 if text[cursor] == ">" else 2
            return not text[cursor:].strip(" \t")
        if closing or cursor == before_space:
            return False
        attribute = HTML_ATTRIBUTE_NAME.match(text, cursor)
        if attribute is None:
            return False
        cursor = attribute.end()
        value_start = cursor
        while cursor < len(text) and text[cursor] in " \t":
            cursor += 1
        if cursor >= len(text) or text[cursor] != "=":
            cursor = value_start
            continue
        cursor += 1
        while cursor < len(text) and text[cursor] in " \t":
            cursor += 1
        if cursor == len(text):
            return False
        if text[cursor] in "\"'":
            end = text.find(text[cursor], cursor + 1)
            if end < 0:
                return False
            cursor = end + 1
        else:
            value_start = cursor
            while cursor < len(text) and text[cursor] not in " \t\"'=<>`":
                cursor += 1
            if cursor == value_start:
                return False
    return False


def _html_block_end(
    text: str, paragraph_boundary: bool
) -> re.Pattern[str] | str | None:
    """Return an HTML-block terminator, or the empty string for blank-line end."""
    if re.match(r"[ ]{0,3}<(?:pre|script|style|textarea)(?=[ \t>]|$)", text, re.I):
        return HTML_BLOCK_RAW_END
    content = text.lstrip(" ")
    if len(text) - len(content) > 3:
        return None
    for start, end in (("<!--", "-->"), ("<?", "?>"), ("<![CDATA[", "]]>")):
        if content.startswith(start):
            return end
    if re.match(r"<![A-Za-z]", content):
        return ">"
    name = HTML_BLOCK_TAG_START.match(content)
    if name is None:
        return None
    if name.group(1).lower() in HTML_BLOCK_TAGS:
        return ""
    if (
        paragraph_boundary
        and (
            content.startswith("</")
            or name.group(1).lower() not in {"pre", "script", "style", "textarea"}
        )
        and _complete_html_block_tag(content, name)
    ):
        return ""
    return None


@lru_cache(maxsize=8)
def _html_block_spans(text: str) -> tuple[tuple[int, int], ...]:
    spans: list[tuple[int, int]] = []
    scan = _mask_markdown_link_destinations_in_markdown(
        _without_inline_code_in_markdown(text)
    )
    _actual_metadata(text, html_scan=scan, raw_html_blocks=spans)
    return tuple(spans)


def _outside_html_blocks(text: str, transform: Any) -> str:
    """Apply an inline Markdown transform only where block parsing enables it."""
    chunks: list[str] = []
    position = 0
    for start, end in _html_block_spans(text):
        chunks.append(transform(text[position:start]))
        chunks.append(text[start:end])
        position = end
    chunks.append(transform(text[position:]))
    return "".join(chunks)


def _column_indent(text: str) -> int:
    column = 0
    for character in text:
        if character == " ":
            column += 1
        elif character == "\t":
            column = (column // 4 + 1) * 4
        else:
            break
    return column


def _markdown_escaped_punctuation(text: str) -> bytearray:
    """Mark ASCII punctuation escaped by an odd-length backslash run."""
    escaped = bytearray(len(text))
    backslash_run = 0
    for index, character in enumerate(text):
        escaped[index] = int(
            bool(backslash_run & 1)
            and character.isascii()
            and 0x21 <= ord(character) <= 0x7E
            and not character.isalnum()
        )
        if character == "\\":
            backslash_run += 1
        else:
            backslash_run = 0
    return escaped


def _quote_prefix_end(line: str, count: int | None = None) -> tuple[int, int]:
    cursor = 0
    found = 0
    while count is None or found < count:
        marker = cursor
        while marker < len(line) and marker - cursor < 3 and line[marker] == " ":
            marker += 1
        if marker >= len(line) or line[marker] != ">":
            break
        cursor = marker + 1
        if cursor < len(line) and line[cursor] == " ":
            cursor += 1
        found += 1
    return cursor, found


def _strip_quote_prefix(line: str, count: int | None = None) -> tuple[str, int]:
    cursor, found = _quote_prefix_end(line, count)
    return line[cursor:], found


def _block_prefix(line: str) -> tuple[str, int, int]:
    """Remove blockquote/list markers; return text, quote depth and list indent."""
    cursor, quotes = _quote_prefix_end(line)
    list_indent = 0
    while True:
        match = LIST_MARKER_PREFIX.match(line, cursor)
        if not match:
            break
        content_column = (
            list_indent + _column_indent(match.group(1)) + len(match.group(2))
        )
        for character in match.group(3):
            content_column = (
                content_column + 1
                if character == " "
                else (content_column // 4 + 1) * 4
            )
        list_indent = content_column
        cursor = match.end()
    return line[cursor:], quotes, list_indent


def _strip_list_indent(line: str, columns: int) -> str:
    index = 0
    column = 0
    while index < len(line) and line[index] in " \t" and column < columns:
        if line[index] == " ":
            column += 1
        else:
            column = (column // 4 + 1) * 4
        index += 1
    return line[index:] if column >= columns else line


def _is_blank_markdown_line(text: str, start: int, end: int) -> bool:
    """Treat quote/list-prefixed whitespace lines as Markdown blank lines."""
    cursor = start
    while cursor < end:
        indent_start = cursor
        while cursor < end and text[cursor] == " " and cursor - indent_start < 3:
            cursor += 1
        if cursor < end and text[cursor] == ">":
            cursor += 1
            if cursor < end and text[cursor] in " \t":
                cursor += 1
            continue

        marker_end = cursor
        if cursor < end and text[cursor] in "-+*":
            marker_end = cursor + 1
        elif cursor < end and "0" <= text[cursor] <= "9":
            digits_end = cursor
            while digits_end < end and "0" <= text[digits_end] <= "9":
                digits_end += 1
            if (
                digits_end - cursor <= 9
                and digits_end < end
                and text[digits_end] in ".)"
            ):
                marker_end = digits_end + 1

        if marker_end > cursor and marker_end < end and text[marker_end] in " \t":
            cursor = marker_end
            while cursor < end and text[cursor] in " \t":
                cursor += 1
            continue
        break
    return not text[cursor:end].strip(" \t")


class _MarkdownLinkIndex:
    """Index link delimiters once so malformed labels cannot rescan suffixes."""

    _WHITESPACE = " \t\r\n"

    def __init__(self, text: str) -> None:
        self.text = text
        length = len(text)
        self.escaped = _markdown_escaped_punctuation(text)

        self.line_ending_prefix = array("i", [0]) * (length + 1)
        for index, character in enumerate(text):
            self.line_ending_prefix[index + 1] = self.line_ending_prefix[index] + int(
                character == "\n"
                or (character == "\r" and text[index + 1 : index + 2] != "\n")
            )

        blank_line_starts = bytearray(length + 1)
        line_start = 0
        while line_start < length:
            line_end = line_start
            while line_end < length and text[line_end] not in "\r\n":
                line_end += 1
            if _is_blank_markdown_line(text, line_start, line_end):
                blank_line_starts[line_start] = 1
            if (
                line_end < length
                and text[line_end] == "\r"
                and text[line_end + 1 : line_end + 2] == "\n"
            ):
                line_start = line_end + 2
            else:
                line_start = line_end + 1
        self.blank_line_starts = blank_line_starts
        self.next_blank_line = array("i", [length]) * (length + 1)
        next_blank_line = length
        for index in range(length - 1, -1, -1):
            if blank_line_starts[index]:
                next_blank_line = index
            self.next_blank_line[index] = next_blank_line

        self.parenthesis_pairs = array("i", [-1]) * length
        parenthesis_stack: list[int] = []
        for index, character in enumerate(text):
            if self.escaped[index]:
                continue
            if character == "(":
                parenthesis_stack.append(index)
            elif character == ")" and parenthesis_stack:
                opening = parenthesis_stack.pop()
                self.parenthesis_pairs[opening] = index

        self.unescaped_whitespace = array("i", [0]) * (length + 1)
        for index, character in enumerate(text):
            self.unescaped_whitespace[index + 1] = self.unescaped_whitespace[
                index
            ] + int(character in self._WHITESPACE and not self.escaped[index])

        self.bare_stop = array("i", [length]) * (length + 1)
        next_whitespace = length
        for index in range(length - 1, -1, -1):
            character = text[index]
            if character in self._WHITESPACE:
                next_whitespace = index
            if not self.escaped[index] and character in self._WHITESPACE + ")":
                self.bare_stop[index] = index
            elif not self.escaped[index] and character == "(":
                close = self.parenthesis_pairs[index]
                if (
                    close < 0
                    or self.unescaped_whitespace[close]
                    - self.unescaped_whitespace[index + 1]
                ):
                    # An unmatched opening parenthesis is permitted as a
                    # literal destination character when whitespace or a
                    # line ending terminates the destination first.
                    self.bare_stop[index] = next_whitespace
                else:
                    self.bare_stop[index] = self.bare_stop[close + 1]
            else:
                self.bare_stop[index] = self.bare_stop[index + 1]

        self.next_non_whitespace = array("i", [length]) * (length + 1)
        self.next_single_quote = array("i", [length]) * (length + 1)
        self.next_double_quote = array("i", [length]) * (length + 1)
        self.next_angle_barrier = array("i", [-1]) * (length + 1)
        for index in range(length - 1, -1, -1):
            character = text[index]
            self.next_non_whitespace[index] = (
                self.next_non_whitespace[index + 1]
                if character in self._WHITESPACE
                else index
            )
            self.next_single_quote[index] = (
                index
                if character == "'" and not self.escaped[index]
                else self.next_single_quote[index + 1]
            )
            self.next_double_quote[index] = (
                index
                if character == '"' and not self.escaped[index]
                else self.next_double_quote[index + 1]
            )
            self.next_angle_barrier[index] = (
                index
                if character in "<>\r\n" and not self.escaped[index]
                else self.next_angle_barrier[index + 1]
            )

    def _valid_separator(self, start: int, end: int) -> bool:
        return self.line_ending_prefix[end] - self.line_ending_prefix[start] <= 1

    def _title_end(self, position: int) -> int | None:
        if position >= len(self.text):
            return None
        opener = self.text[position]
        if opener == "'":
            close = self.next_single_quote[position + 1]
            if close >= len(self.text) or self.next_blank_line[position + 1] < close:
                return None
            return close + 1
        if opener == '"':
            close = self.next_double_quote[position + 1]
            if close >= len(self.text) or self.next_blank_line[position + 1] < close:
                return None
            return close + 1
        if opener == "(":
            close = self.parenthesis_pairs[position]
            if close < 0 or self.next_blank_line[position + 1] < close:
                return None
            return close + 1
        return None

    def link_end(self, closing_bracket: int) -> int | None:
        """Return the closing `)` for a valid destination/title, if present."""
        text = self.text
        length = len(text)
        initial = closing_bracket + 2
        cursor = self.next_non_whitespace[initial]
        had_leading_space = cursor > initial
        if had_leading_space and not self._valid_separator(initial, cursor):
            return None

        if had_leading_space and cursor < length and text[cursor] in ('"', "'", "("):
            title_close = self._title_end(cursor)
            if title_close is not None:
                title_end = self.next_non_whitespace[title_close]
                if (
                    self._valid_separator(title_close, title_end)
                    and title_end < length
                    and text[title_end] == ")"
                ):
                    return title_end

        if cursor < length and text[cursor] == "<":
            barrier = self.next_angle_barrier[cursor + 1]
            if (
                barrier < 0
                or text[barrier] != ">"
                or self.line_ending_prefix[barrier] != self.line_ending_prefix[cursor]
            ):
                return None
            cursor = barrier + 1
            if cursor >= length:
                return None
            if text[cursor] == ")":
                return cursor
            separator = cursor
            cursor = self.next_non_whitespace[cursor]
            if cursor == separator or cursor >= length:
                return None
            if not self._valid_separator(separator, cursor):
                return None
            if text[cursor] == ")":
                return cursor
            title_close = self._title_end(cursor)
            if title_close is None:
                return None
            cursor = self.next_non_whitespace[title_close]
            if not self._valid_separator(title_close, cursor):
                return None
            return cursor if cursor < length and text[cursor] == ")" else None

        stop = self.bare_stop[cursor]
        if stop < 0 or stop >= length:
            return None
        if text[stop] == ")":
            return stop
        if text[stop] not in self._WHITESPACE:
            return None
        cursor = self.next_non_whitespace[stop]
        if cursor >= length:
            return None
        if not self._valid_separator(stop, cursor):
            return None
        if text[cursor] == ")":
            return cursor
        title_close = self._title_end(cursor)
        if title_close is None:
            return None
        cursor = self.next_non_whitespace[title_close]
        if not self._valid_separator(title_close, cursor):
            return None
        return cursor if cursor < length and text[cursor] == ")" else None


def _reference_definition_scan_text(
    text: str,
) -> tuple[
    str,
    set[int],
    dict[int, tuple[int, int, int]],
    dict[int, int],
    bytearray,
]:
    """Normalize reference labels in Markdown containers without shifting offsets."""
    normalized = list(text)
    candidate_openings: set[int] = set()
    line_contexts: dict[int, tuple[int, int, int]] = {}
    blank_line_starts = bytearray(len(text) + 1)
    valid_openings: set[int] = set()
    label_closings: dict[int, int] = {}
    offset = 0
    for line in _markdown_lines(text, keepends=True):
        source = line.rstrip("\r\n")
        content, quotes, list_indent = _block_prefix(source)
        prefix_length = len(source) - len(content)
        indent_text = content[: len(content) - len(content.lstrip(" \t"))]
        content_indent = _column_indent(indent_text)
        line_contexts[offset] = (quotes, list_indent, content_indent)
        if prefix_length:
            normalized[offset : offset + prefix_length] = [" "] * prefix_length
        if not content.strip(" \t"):
            blank_line_starts[offset] = 1
        if re.match(r"[ ]{0,3}\[", content):
            opening = offset + prefix_length + content.index("[")
            candidate_openings.add(opening)
        offset += len(line)

    container_scan = "".join(normalized)
    escaped = _markdown_escaped_punctuation(text)
    bracket_pairs = array("i", [-1]) * len(text)
    bracket_stack: list[int] = []
    for index, character in enumerate(container_scan):
        if blank_line_starts[index]:
            bracket_stack.clear()
        if escaped[index]:
            continue
        if character == "[":
            bracket_stack.append(index)
        elif character == "]" and bracket_stack:
            bracket_pairs[bracket_stack.pop()] = index

    normalized_label_length = array("i", [0]) * (len(text) + 1)
    label_non_whitespace = array("i", [0]) * (len(text) + 1)
    for index, character in enumerate(text):
        normalized_label_length[index + 1] = normalized_label_length[index] + int(
            not (character == "\r" and text[index + 1 : index + 2] == "\n")
        )
        label_non_whitespace[index + 1] = label_non_whitespace[index] + int(
            not character.isspace()
        )

    mask_ranges: list[tuple[int, int]] = []
    for match in REFERENCE_DEFINITION_START.finditer(container_scan):
        opening = match.end() - 1
        if opening not in candidate_openings:
            continue
        cursor = bracket_pairs[opening]
        if cursor < 0 or text[cursor + 1 : cursor + 2] != ":":
            continue
        label_closings[opening] = cursor
        label_start = opening + 1
        label_length = (
            normalized_label_length[cursor] - normalized_label_length[label_start]
        )
        has_non_whitespace = (
            label_non_whitespace[cursor] - label_non_whitespace[label_start]
        ) > 0
        if label_length > 999 or not has_non_whitespace:
            continue
        valid_openings.add(opening)
        mask_ranges.append((label_start, cursor))

    merged_ranges: list[list[int]] = []
    for start, end in mask_ranges:
        if merged_ranges and start <= merged_ranges[-1][1]:
            merged_ranges[-1][1] = max(merged_ranges[-1][1], end)
        else:
            merged_ranges.append([start, end])
    for start, end in merged_ranges:
        for index in range(start, end):
            if text[index] not in "\r\n":
                normalized[index] = "x"
    return (
        "".join(normalized),
        valid_openings,
        line_contexts,
        label_closings,
        blank_line_starts,
    )


def _next_unescaped_positions(
    text: str, escaped: bytearray, blank_line_starts: bytearray
) -> tuple[array, array, array, array]:
    """Index title delimiters and blank lines in one reverse pass."""
    length = len(text)
    next_double_quote = array("i", [length]) * (length + 1)
    next_single_quote = array("i", [length]) * (length + 1)
    next_parenthesis = array("i", [length]) * (length + 1)
    next_blank_line = array("i", [length]) * (length + 1)
    for index in range(length - 1, -1, -1):
        next_double_quote[index] = (
            index
            if text[index] == '"' and not escaped[index]
            else next_double_quote[index + 1]
        )
        next_single_quote[index] = (
            index
            if text[index] == "'" and not escaped[index]
            else next_single_quote[index + 1]
        )
        next_parenthesis[index] = (
            index
            if text[index] == ")" and not escaped[index]
            else next_parenthesis[index + 1]
        )
        next_blank_line[index] = (
            index if blank_line_starts[index] else next_blank_line[index + 1]
        )
    return (
        next_double_quote,
        next_single_quote,
        next_parenthesis,
        next_blank_line,
    )


def _reference_definition_end(
    text: str,
    label_end: int,
    next_double_quote: array,
    next_single_quote: array,
    next_parenthesis: array,
    next_blank_line: array,
) -> tuple[int, str] | None:
    """Parse one reference destination/title without rescanning later lines."""
    length = len(text)
    cursor = label_end + 2  # closing bracket and colon
    while cursor < length and text[cursor] in " \t":
        cursor += 1

    if cursor < length and text[cursor] in "\r\n":
        if text.startswith("\r\n", cursor):
            cursor += 2
        else:
            cursor += 1
        if next_blank_line[cursor] == cursor:
            return None
        while cursor < length and text[cursor] in " \t":
            cursor += 1

    destination_start = cursor
    if cursor < length and text[cursor] == "<":
        cursor += 1
        while cursor < length:
            character = text[cursor]
            if character in "\r\n<":
                return None
            if character == "\\":
                if cursor + 1 >= length or text[cursor + 1] == "\n":
                    return None
                cursor += 2
            elif character == ">":
                cursor += 1
                break
            else:
                cursor += 1
        else:
            return None
    else:
        while cursor < length:
            character = text[cursor]
            if character == "\\":
                if cursor + 1 >= length or text[cursor + 1] == "\n":
                    return None
                cursor += 2
            elif character in " \t\r\n<>":
                break
            else:
                cursor += 1
        if cursor == destination_start:
            return None

    destination = text[destination_start:cursor]
    destination_end = cursor

    def line_end(position: int) -> int:
        end = text.find("\n", position)
        if end < 0:
            return length
        return end - 1 if end > position and text[end - 1] == "\r" else end

    first_line_end = line_end(destination_end)
    separator = destination_end
    while separator < first_line_end and text[separator] in " \t":
        separator += 1
    if separator == first_line_end:
        first_line_match_end = first_line_end
        after_newline = first_line_end
        if after_newline < length and text[after_newline] == "\r":
            after_newline += 1
        if after_newline < length and text[after_newline] == "\n":
            after_newline += 1
            title_start = after_newline
            while title_start < length and text[title_start] in " \t":
                title_start += 1
            if (
                title_start < length
                and next_blank_line[after_newline] != after_newline
                and text[title_start] in "\"'("
            ):
                parsed_title = _reference_title_end(
                    text,
                    title_start,
                    next_double_quote,
                    next_single_quote,
                    next_parenthesis,
                    next_blank_line,
                )
                if parsed_title is not None:
                    title_end, title_line_end = parsed_title
                    if all(
                        character in " \t"
                        for character in text[title_end + 1 : title_line_end]
                    ):
                        return title_line_end, destination
        return first_line_match_end, destination

    if separator >= length or text[separator] not in "\"'(":
        return None
    parsed_title = _reference_title_end(
        text,
        separator,
        next_double_quote,
        next_single_quote,
        next_parenthesis,
        next_blank_line,
    )
    if parsed_title is None:
        return None
    title_end, title_line_end = parsed_title
    if not all(
        character in " \t" for character in text[title_end + 1 : title_line_end]
    ):
        return None
    return title_line_end, destination


def _reference_title_end(
    text: str,
    opening: int,
    next_double_quote: array,
    next_single_quote: array,
    next_parenthesis: array,
    next_blank_line: array,
) -> tuple[int, int] | None:
    delimiter_index = {
        '"': next_double_quote,
        "'": next_single_quote,
        "(": next_parenthesis,
    }.get(text[opening])
    if delimiter_index is None:
        return None
    closing = delimiter_index[opening + 1]
    if closing >= len(text) or next_blank_line[opening + 1] < closing:
        return None
    end = text.find("\n", closing + 1)
    if end < 0:
        line_end = len(text)
    else:
        line_end = end - 1 if end > closing and text[end - 1] == "\r" else end
    return closing, line_end


def _reference_definition_spans(
    source: str,
    valid_openings: set[int],
    line_contexts: dict[int, tuple[int, int, int]],
    label_closings: dict[int, int],
    blank_line_starts: bytearray,
) -> list[tuple[int, int]]:
    """Return valid reference definition spans with bounded delimiter scans."""
    escaped = _markdown_escaped_punctuation(source)
    (
        next_double_quote,
        next_single_quote,
        next_parenthesis,
        next_blank_line,
    ) = _next_unescaped_positions(source, escaped, blank_line_starts)
    spans: list[tuple[int, int]] = []
    consumed_until = 0
    for match in REFERENCE_DEFINITION_START.finditer(source):
        opening = match.end() - 1
        label_end = label_closings.get(opening)
        if label_end is None or match.start() < consumed_until:
            continue
        parsed = _reference_definition_end(
            source,
            label_end,
            next_double_quote,
            next_single_quote,
            next_parenthesis,
            next_blank_line,
        )
        if parsed is None:
            continue
        end, destination = parsed
        consumed_until = end
        if (
            opening in valid_openings
            and _valid_reference_destination(destination)
            and _reference_match_has_valid_containers(
                source, match.start(), end, line_contexts
            )
        ):
            spans.append((match.start(), end))
    return spans


def _reference_match_has_valid_containers(
    source: str,
    start: int,
    end: int,
    line_contexts: dict[int, tuple[int, int, int]],
) -> bool:
    """Reject a definition span that crosses into a different block container."""
    line_start = source.rfind("\n", 0, start) + 1
    initial = line_contexts.get(line_start)
    if initial is None:
        return False
    initial_quotes, initial_list_indent, _ = initial
    cursor = line_start
    while cursor < end:
        line_end = source.find("\n", cursor)
        if line_end == -1:
            line_end = len(source)
        if cursor != line_start:
            context = line_contexts.get(cursor)
            if context is None:
                return False
            quotes, list_indent, content_indent = context
            if quotes != initial_quotes or list_indent != 0:
                return False
            if initial_list_indent:
                if content_indent < initial_list_indent:
                    return False
            elif content_indent > 3:
                return False
        cursor = line_end + 1
    return True


def _valid_reference_destination(destination: str) -> bool:
    """Reject malformed destinations before masking a reference definition."""

    def escaped_punctuation(character: str) -> bool:
        return (
            character.isascii()
            and character.isprintable()
            and not character.isalnum()
            and not character.isspace()
        )

    if destination.startswith("<"):
        if not destination.endswith(">"):
            return False
        cursor = 1
        while cursor < len(destination) - 1:
            character = destination[cursor]
            if character == "\\":
                cursor += 1
                if cursor >= len(destination) - 1 or not escaped_punctuation(
                    destination[cursor]
                ):
                    return False
            elif character in "<>\r\n" or character.isspace() or ord(character) < 32:
                return False
            cursor += 1
        return True

    depth = 0
    cursor = 0
    while cursor < len(destination):
        character = destination[cursor]
        if character == "\\":
            cursor += 1
            if cursor >= len(destination) or not escaped_punctuation(
                destination[cursor]
            ):
                return False
        elif character in "<>\r\n" or character.isspace() or ord(character) < 32:
            return False
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth < 0:
                return False
        cursor += 1
    return depth == 0


def _mask_markdown_link_destinations(text: str) -> str:
    return _outside_html_blocks(text, _mask_markdown_link_destinations_in_markdown)


def _mask_markdown_link_destinations_in_markdown(text: str) -> str:
    """Mask inline Markdown destinations/titles before scanning HTML tokens."""
    if "[" not in text:
        return text
    spans: list[tuple[int, int]] = []
    links = _MarkdownLinkIndex(text)
    label_openings: list[int] = []
    covered_until = 0
    for position, character in enumerate(text):
        if links.blank_line_starts[position]:
            label_openings.clear()
        if links.escaped[position]:
            continue
        if character == "[":
            label_openings.append(position)
            continue
        if character != "]" or not label_openings:
            continue
        label_openings.pop()
        if position < covered_until or text[position + 1 : position + 2] != "(":
            continue
        end = links.link_end(position)
        if end is not None:
            spans.append((position + 1, end + 1))
            covered_until = end + 1

    chunks: list[str] = []
    position = 0
    for start, end in spans:
        if start < position:
            continue
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _mask_markdown_link_metadata(text: str) -> str:
    """Mask destinations, titles, and reference definitions; retain link labels."""
    return _outside_html_blocks(text, _mask_markdown_link_metadata_in_markdown)


@lru_cache(maxsize=8)
def _mask_markdown_link_metadata_in_markdown(text: str) -> str:
    if "[" not in text:
        return text
    text = _mask_markdown_link_destinations_in_markdown(text)
    spans = _reference_definition_spans(*_reference_definition_scan_text(text))
    chunks: list[str] = []
    position = 0
    for start, end in spans:
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _escaped_container_tag_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for match in re.finditer(r"&lt;[^<>\r\n]*?&gt;", text, re.IGNORECASE):
        decoded = html.unescape(match.group())
        if re.fullmatch(r"</?\s*(?:details|summary)\b[^<>]*>", decoded, re.IGNORECASE):
            spans.append((match.start(), match.end()))
    return spans


def _mask_escaped_container_tags(text: str) -> str:
    """Ignore escaped details/summary markup while preserving adjacent text."""
    spans = _escaped_container_tag_spans(text)
    chunks: list[str] = []
    position = 0
    for start, end in spans:
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _mask_backslash_escaped_container_tags(text: str) -> str:
    """Mask only backslash-escaped details/summary tags in structural views."""
    spans = [
        (match.start(), match.end())
        for match in BACKSLASH_ESCAPED_CONTAINER_TAG.finditer(text)
        if _backslash_escaped(text, match.start("tag"))
    ]
    chunks: list[str] = []
    position = 0
    for start, end in spans:
        chunks.append(text[position:start])
        chunks.append(re.sub(r"[^\r\n]", " ", text[start:end]))
        position = end
    chunks.append(text[position:])
    return "".join(chunks)


def _restore_html_code_container_closers(
    source: str, masked: str, normalize_attributes: bool = False
) -> str:
    """Keep raw HTML code-container closers visible to the HTML tokenizer."""
    chunks: list[str] = []
    position = 0
    for match in HTML_CODE_CONTAINER_CLOSER.finditer(source):
        start = match.start()
        if start < position or _backslash_escaped(source, start):
            continue
        markup = _html_markup_at(source, start, require_complete=True)
        if markup is None:
            break
        end = markup[2]
        chunks.append(masked[position:start])
        if normalize_attributes:
            name = HTML_MARKUP_TAG_START.match(source, start)
            assert name is not None
            chunks.append(source[start : name.end()])
            chunks.append(re.sub(r"[^\r\n]", " ", source[name.end() : end - 1]))
            chunks.append(">")
        else:
            chunks.append(source[start:end])
        position = end
    chunks.append(masked[position:])
    return "".join(chunks)


def _html_markup_at(
    text: str, start: int, require_complete: bool = False
) -> tuple[str, bool, int] | None:
    """Return a complete tag name, closing flag, and end offset at ``start``."""
    if start >= len(text) or text[start] != "<":
        return None
    if text.startswith("<!", start) or text.startswith("<?", start):
        quote: str | None = None
        for index in range(start + 2, len(text)):
            character = text[index]
            if quote:
                if character == quote:
                    quote = None
            elif character in "\"'":
                quote = character
            elif character == ">":
                return "", False, index + 1
        return "", False, len(text)

    match = HTML_MARKUP_TAG_START.match(text, start)
    if not match:
        return None
    closing = text[start + 1 : start + 2] == "/"
    tag = match.group(1).lower()
    quote: str | None = None
    for index in range(match.end(), len(text)):
        character = text[index]
        if quote:
            if character == quote:
                quote = None
        elif character in "\"'":
            quote = character
        elif character == ">":
            return tag, closing, index + 1
    return None if require_complete else (tag, closing, len(text))


def _incomplete_html_tag_quote(text: str) -> str | None:
    """Return the open quote state for a multiline HTML tag, if present."""
    position = 0
    while position < len(text):
        start = text.find("<", position)
        if start < 0:
            return None
        if _backslash_escaped(text, start):
            position = start + 1
            continue
        markup = _html_markup_at(text, start)
        if markup is None:
            position = start + 1
            continue
        tag, _, end = markup
        if tag and end == len(text) and text[end - 1 : end] != ">":
            opener = HTML_MARKUP_TAG_START.match(text, start)
            quote: str | None = None
            if opener is not None:
                for index in range(opener.end(), len(text)):
                    character = text[index]
                    if quote is not None:
                        if character == quote:
                            quote = None
                    elif character in "\"'":
                        quote = character
            return quote or ""
        position = end
    return None


def _continue_html_tag(quote: str, text: str) -> str | None:
    """Advance a multiline HTML tag through one physical line."""
    open_quote = quote or None
    for index, character in enumerate(text):
        if open_quote is not None:
            if character == open_quote:
                open_quote = None
        elif character in "\"'":
            open_quote = character
        elif character == ">":
            return _incomplete_html_tag_quote(text[index + 1 :])
    return open_quote or ""


def _unterminated_html_comment_start(text: str) -> int | None:
    """Find an actual unterminated comment while respecting tags and raw text."""
    position = 0
    raw_text_tag: str | None = None
    while position < len(text):
        if raw_text_tag is not None:
            closing = re.search(
                r"</\s*" + re.escape(raw_text_tag) + r"\s*>",
                text[position:],
                re.IGNORECASE,
            )
            if closing is None:
                return None
            position += closing.end()
            raw_text_tag = None
            continue

        if text.startswith("<!--", position):
            closing = HTML_COMMENT_END.search(text, position + 4)
            if _backslash_escaped(text, position):
                if closing is None:
                    return None
                position = closing.end()
                continue
            if closing is None:
                return position
            position = closing.end()
            continue

        if text[position] == "<":
            markup = _html_markup_at(text, position)
            if markup is not None:
                tag, closing, end = markup
                if tag in RAW_HTML_TEXT_TAGS and not closing and end > position:
                    raw_text_tag = tag
                if end <= position or (end == len(text) and text[end - 1 : end] != ">"):
                    return None
                position = end
                continue
        position += 1
    return None


def _mask_code_line(line: str) -> str:
    """Mask code while preserving every source character offset."""
    return "".join(character if character in "\r\n" else " " for character in line)


def _actual_metadata(
    text: str,
    html_scan: str | None = None,
    raw_html_blocks: list[tuple[int, int]] | None = None,
) -> str:
    if html_scan is None and raw_html_blocks is None:
        return _cached_actual_metadata(text)
    return _scan_actual_metadata(text, html_scan, raw_html_blocks)


@lru_cache(maxsize=8)
def _cached_actual_metadata(text: str) -> str:
    return _scan_actual_metadata(text)


def _scan_actual_metadata(
    text: str,
    html_scan: str | None = None,
    raw_html_blocks: list[tuple[int, int]] | None = None,
) -> str:
    """Mask Markdown code blocks while retaining physical line positions."""
    if html_scan is None:
        html_scan = _mask_markdown_link_destinations(_without_inline_code(text))
    masked: list[str] = []
    fence_char: str | None = None
    fence_length = 0
    fence_quotes = 0
    fence_list_indent = 0
    indented_code = False
    block_boundary = True
    html_paragraph_boundary = True
    active_list_indent: int | None = None
    list_has_blank = False
    html_tag_open = False
    html_tag_quote = ""
    html_block_active = False
    html_block_terminator: re.Pattern[str] | str = ""
    html_block_start = 0
    html_block_quotes = 0
    html_block_list_indent = 0
    previous_quotes = 0
    offset = 0

    def finish_html_block(end: int) -> None:
        nonlocal html_block_active, block_boundary, html_paragraph_boundary
        nonlocal html_tag_open, html_tag_quote
        if raw_html_blocks is not None:
            raw_html_blocks.append((html_block_start, end))
        html_block_active = False
        block_boundary = True
        html_paragraph_boundary = True
        html_tag_open = False
        html_tag_quote = ""

    def html_block_finished(content: str) -> bool:
        if not html_block_terminator:
            return False
        if isinstance(html_block_terminator, str):
            return html_block_terminator in content
        return html_block_terminator.search(content) is not None

    for line in _markdown_lines(text, keepends=True):
        line_start = offset
        source_line = line.rstrip("\r\n")
        html_line = html_scan[offset : offset + len(line)].rstrip("\r\n")
        offset += len(line)
        if fence_char is not None:
            content, found_quotes = _strip_quote_prefix(source_line, fence_quotes)
            if found_quotes == fence_quotes:
                content = _strip_list_indent(content, fence_list_indent)
                closing = re.fullmatch(
                    r"[ ]{0,3}"
                    + re.escape(fence_char)
                    + "{"
                    + str(fence_length)
                    + r",}[ \t]*",
                    content,
                )
            else:
                closing = None
            masked.append(_mask_code_line(line))
            if closing:
                fence_char = None
                fence_length = 0
                fence_quotes = 0
                fence_list_indent = 0
                block_boundary = True
                html_paragraph_boundary = True
            continue

        if html_block_active:
            raw_content, quotes = _strip_quote_prefix(source_line, html_block_quotes)
            container_ended = quotes != html_block_quotes or (
                html_block_list_indent
                and raw_content.strip(" \t")
                and _column_indent(raw_content) < html_block_list_indent
            )
            if container_ended or (
                not html_block_terminator and not raw_content.strip(" \t")
            ):
                finish_html_block(line_start)
                if container_ended and html_block_list_indent:
                    active_list_indent = None
                    list_has_blank = False
            else:
                masked.append(line)
                if html_block_finished(raw_content):
                    finish_html_block(offset)
                continue

        if html_tag_open:
            masked.append(line)
            next_quote = _continue_html_tag(html_tag_quote, html_line)
            if next_quote is None:
                html_tag_open = False
                html_tag_quote = ""
                block_boundary = False
            else:
                html_tag_quote = next_quote
            continue

        content, quotes, list_indent = _block_prefix(source_line)
        match = FENCE_LINE.match(content)
        if match and match.group("char") == "`" and "`" in match.group("info"):
            match = None
        if match:
            fence_char = match.group("char")
            fence_length = len(match.group("count")) + 1
            fence_quotes = quotes
            fence_list_indent = list_indent
            masked.append(_mask_code_line(line))
            block_boundary = True
            indented_code = False
            html_paragraph_boundary = True
            continue

        plain, _ = _strip_quote_prefix(line.rstrip("\r\n"))
        indent = _column_indent(plain)
        if not plain.strip():
            masked.append(_mask_code_line(line))
            if active_list_indent is not None:
                list_has_blank = True
            block_boundary = True
            html_paragraph_boundary = True
            continue

        if list_indent:
            active_list_indent = list_indent
            list_has_blank = False
        elif active_list_indent is not None:
            starts_root_block = bool(
                RESULT_HEADING.match(content)
                or re.match(
                    r"^[ ]{0,3}(?:#{1,6}[ \t]|>|[-+*][ \t]|[0-9]+[.)][ \t])",
                    content,
                )
            )
            if (list_has_blank and indent < active_list_indent) or starts_root_block:
                active_list_indent = None
                list_has_blank = False
            else:
                list_has_blank = False

        code_indent = 4 + (list_indent or active_list_indent or 0)
        if indent >= code_indent and (indented_code or block_boundary):
            masked.append(_mask_code_line(line))
            indented_code = True
            html_paragraph_boundary = True
            continue
        indented_code = False

        raw_content = content
        inherited_indent = 0 if list_indent else (active_list_indent or 0)
        if inherited_indent:
            raw_content = _strip_list_indent(raw_content, inherited_indent)
        terminator = _html_block_end(
            raw_content,
            html_paragraph_boundary or bool(list_indent) or quotes != previous_quotes,
        )
        previous_quotes = quotes
        if terminator is not None:
            html_block_active = True
            html_block_terminator = terminator
            html_block_start = line_start
            html_block_quotes = quotes
            html_block_list_indent = list_indent or inherited_indent
            masked.append(line)
            if html_block_finished(raw_content):
                finish_html_block(offset)
            continue

        pending_html_quote = _incomplete_html_tag_quote(html_line)
        if pending_html_quote is not None:
            masked.append(line)
            html_tag_open = True
            html_tag_quote = pending_html_quote
            block_boundary = False
            html_paragraph_boundary = False
            continue

        masked.append(line)
        stripped = line.rstrip("\r\n")
        block_content = content.strip()
        block_boundary = bool(
            RESULT_HEADING.match(content)
            or (quotes and not block_content)
            or (list_indent and not block_content)
            or re.match(r"^[ ]{0,3}(?:#{1,6}[ \t]|>)", stripped)
        )
        html_paragraph_boundary = bool(
            re.match(r"^[ ]{0,3}#{1,6}(?:[ \t]|$)", content)
            or re.fullmatch(r"[ ]{0,3}(?:=+|-+)[ \t]*", content)
            or re.fullmatch(r"[ ]{0,3}(?:\*[ \t]*){3,}", content)
            or re.fullmatch(r"[ ]{0,3}(?:_[ \t]*){3,}", content)
        )
    if html_block_active:
        finish_html_block(len(text))
    return "".join(masked)


def _visible_html(
    text: str,
    visible_open: bool = True,
    mask_attributes: bool = False,
    visible_summary_ranges: list[tuple[int, int]] | None = None,
    markdown_preprocessed: bool = False,
    decode_entities: bool = False,
    raw_html_blocks: list[tuple[int, int]] | None = None,
    strip_inline_markup: bool = False,
    mask_raw_html_text: bool = False,
    preserve_markup_lines: bool = False,
    preserve_markdown_comments: bool = False,
    preserve_inline_code: bool = False,
    preserve_inline_markup: bool = False,
) -> str:
    """Mask only container spans, preserving visible prefixes and suffixes."""
    metadata = text if markdown_preprocessed else _actual_metadata(text)
    scan = (
        metadata
        if markdown_preprocessed
        else _restore_html_code_container_closers(
            metadata, _without_inline_code(metadata)
        )
    )
    # Markdown destinations and titles are not HTML. Mask them only in the
    # parser input so their literal tags cannot open containers or shift offsets.
    escaped_markup_spans = _escaped_container_tag_spans(scan)
    parser_scan = scan if markdown_preprocessed else _mask_markdown_link_metadata(scan)
    # HTMLParser's script/style mode only recognizes whitespace-only end tags.
    # Normalize valid closers in its input while retaining every source offset.
    parser_scan = _restore_html_code_container_closers(
        parser_scan, parser_scan, normalize_attributes=True
    )
    parser_scan = _mask_escaped_container_tags(parser_scan)
    unterminated_comment = _unterminated_html_comment_start(parser_scan)
    # Python 3.9's HTMLParser does not recognize HTML's --!> comment end tag.
    # Normalize only its parser input, without changing source offsets.
    parser_scan = parser_scan.replace("--!>", "--->")
    line_offsets = [0]
    line_offsets.extend(match.end() for match in re.finditer("\n", scan))
    tokens: list[tuple[int, int, str, bool, str]] = []
    attribute_spans: list[tuple[int, int]] = []
    inline_markup_spans: list[tuple[int, int]] = []
    block_markup_spans: list[tuple[int, int]] = []

    class ContainerParser(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=False)
            self.open_elements: list[tuple[str, str, bool]] = []
            self.open_element_counts: dict[str, int] = {}
            self.html_open_element_counts: dict[str, int] = {}
            self.body_contexts: list[bool] = []
            self.table_modes: list[bool] = []
            self.active_form_index: int | None = None
            self.active_form_on_stack = False
            self.template_depth = 0
            self.direct_summaries: set[int] = set()

        def _pop_elements(self, index: int, start: int, end: int) -> None:
            # Replay every visibility transition made by tree-stack truncation,
            # including descendants implicitly closed by an ancestor end tag.
            for popped in range(len(self.open_elements) - 1, index - 1, -1):
                tag, namespace, _ = self.open_elements[popped]
                self.open_element_counts[tag] -= 1
                if namespace != "html":
                    continue
                self.html_open_element_counts[tag] -= 1
                if tag == "template":
                    self.template_depth -= 1
                if tag in HTML_CODE_CONTAINER_TAGS:
                    kind = "code-close"
                elif tag == "summary":
                    kind = "summary-close"
                elif tag == "details":
                    kind = "details-close"
                else:
                    continue
                tokens.append(
                    (
                        start,
                        end if popped == index else start,
                        kind,
                        popped in self.direct_summaries,
                        tag,
                    )
                )
            self.direct_summaries.difference_update(
                range(index, len(self.open_elements))
            )
            if self.active_form_index is not None and self.active_form_index >= index:
                # Implicit closure removes the node, but not the HTML form pointer.
                self.active_form_on_stack = False
            del self.open_elements[index:]
            del self.body_contexts[index:]
            del self.table_modes[index:]

        def _summary_parent_is_details(self) -> bool:
            if not self.open_elements:
                return False
            if self.open_elements[-1][:2] == ("details", "html"):
                return True
            # In table insertion modes, non-table content is inserted before
            # the last table. Cell/caption content keeps its ordinary parent.
            if self.open_elements[-1][1] != "html" or self.open_elements[-1][0] not in {
                "table",
                "tbody",
                "tfoot",
                "thead",
                "tr",
            }:
                return False
            for index in range(len(self.open_elements) - 1, -1, -1):
                if self.open_elements[index][:2] == ("template", "html"):
                    return False
                if self.open_elements[index][:2] == ("table", "html"):
                    return index > 0 and self.open_elements[index - 1][:2] == (
                        "details",
                        "html",
                    )
            return False

        def _in_body_insertion_context(self) -> bool:
            # Cache context with the stack so repeated invalid tags cannot scan
            # a deep parent chain. Ambiguous template modes remain unchanged.
            return self.template_depth == 0 and (
                not self.body_contexts or self.body_contexts[-1]
            )

        def _table_insertion_index(self) -> int | None:
            if not self.table_modes or not self.table_modes[-1]:
                return None
            return next(
                (
                    index
                    for index in range(len(self.open_elements) - 1, -1, -1)
                    if self.open_elements[index][:2] == ("table", "html")
                ),
                None,
            )

        def _ignore_start_markup(self, start: int) -> None:
            if strip_inline_markup:
                inline_markup_spans.append(
                    (start, start + len(self.get_starttag_text()))
                )

        def _ignore_end_markup(self, start: int) -> None:
            if strip_inline_markup:
                markup = _html_markup_at(scan, start)
                if markup is not None:
                    inline_markup_spans.append((start, markup[2]))

        def _start_tag_namespace(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> str:
            if not self.open_elements:
                parent_tag, parent_namespace, parent_html_integration = (
                    "",
                    "html",
                    False,
                )
            else:
                parent_tag, parent_namespace, parent_html_integration = (
                    self.open_elements[-1]
                )

            process_as_html = parent_namespace == "html"
            if parent_namespace == "svg":
                process_as_html = parent_tag in SVG_HTML_INTEGRATION_POINT_TAGS
            elif parent_namespace == "math":
                process_as_html = parent_html_integration or (
                    parent_tag in MATHML_TEXT_INTEGRATION_POINT_TAGS
                    and tag not in {"mglyph", "malignmark"}
                )

            if not process_as_html and (
                tag in HTML_FOREIGN_BREAKOUT_TAGS
                or (
                    tag == "font"
                    and any(name in {"color", "face", "size"} for name, _ in attrs)
                )
            ):
                index = len(self.open_elements) - 1
                while index >= 0:
                    element, namespace, integration = self.open_elements[index]
                    if (
                        namespace == "html"
                        or (
                            namespace == "svg"
                            and element in SVG_HTML_INTEGRATION_POINT_TAGS
                        )
                        or (
                            namespace == "math"
                            and (
                                integration
                                or element in MATHML_TEXT_INTEGRATION_POINT_TAGS
                            )
                        )
                    ):
                        break
                    index -= 1
                self._pop_elements(index + 1, self._offset(), self._offset())
                return self._start_tag_namespace(tag, attrs)
            if not process_as_html:
                return parent_namespace
            if tag == "svg":
                return "svg"
            if tag == "math":
                return "math"
            return "html"

        @staticmethod
        def _is_button_scope_boundary(tag: str, namespace: str) -> bool:
            if namespace == "html":
                return tag in HTML_BUTTON_SCOPE_BOUNDARY_TAGS
            if namespace == "svg":
                return tag in SVG_BUTTON_SCOPE_BOUNDARY_TAGS
            if namespace == "math":
                return tag in MATHML_BUTTON_SCOPE_BOUNDARY_TAGS
            return False

        def _offset(self) -> int:
            line, column = self.getpos()
            return line_offsets[line - 1] + column

        def _close_implied_item(self, tag: str) -> None:
            targets = {"li"} if tag == "li" else {"dt", "dd"}
            if not any(
                self.html_open_element_counts.get(target, 0) for target in targets
            ):
                return
            for index in range(len(self.open_elements) - 1, -1, -1):
                element, namespace, _ = self.open_elements[index]
                if namespace == "html":
                    if element in targets:
                        self._pop_elements(index, self._offset(), self._offset())
                        return
                    if element in HTML_ITEM_START_BOUNDARY_TAGS:
                        return
                elif self._is_button_scope_boundary(element, namespace):
                    return

        def _element_in_scope(self, tag: str) -> int | None:
            if not self.html_open_element_counts.get(tag, 0):
                return None
            for index in range(len(self.open_elements) - 1, -1, -1):
                element, namespace, _ = self.open_elements[index]
                if namespace == "html":
                    if element == tag:
                        return index
                    if element in HTML_SCOPE_BOUNDARY_TAGS:
                        return None
                    if tag == "li" and element in {"ol", "ul"}:
                        return None
                elif self._is_button_scope_boundary(element, namespace):
                    return None
            return None

        def _generate_implied_end_tags(self, exclude: str = "") -> None:
            while self.open_elements:
                tag, namespace, _ = self.open_elements[-1]
                if (
                    namespace != "html"
                    or tag not in HTML_IMPLIED_END_TAGS
                    or tag == exclude
                ):
                    return
                self._pop_elements(
                    len(self.open_elements) - 1, self._offset(), self._offset()
                )

        def handle_comment(self, data: str) -> None:
            start = self._offset()
            if _backslash_escaped(scan, start):
                return
            close = HTML_COMMENT_END.search(scan, start + 4)
            if close is None:
                return
            end = close.end()
            protocol = scan[start:end]
            if SECURITY_MARKER_COMMENT.fullmatch(protocol) or re.fullmatch(
                r"<!-- review-request:v2 head=[0-9a-f]{40} base=[0-9a-f]{40} -->",
                protocol,
                re.I,
            ):
                return
            tokens.append((start, end, "comment", False, ""))

        def handle_starttag(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> None:
            if not re.match(
                r"<[A-Za-z][A-Za-z0-9-]*(?=[ \t\r\n\v\f/>])",
                self.get_starttag_text(),
            ):
                return
            normalized_tag = tag.lower()
            start = self._offset()
            if _backslash_escaped(scan, start):
                return
            if mask_attributes:
                tag_text = self.get_starttag_text()
                tag_name = HTML_MARKUP_TAG_START.match(tag_text)
                if tag_name is not None and tag_text.endswith(">"):
                    attribute_start = start + tag_name.end()
                    attribute_end = start + len(tag_text) - 1
                    if attribute_start < attribute_end:
                        attribute_spans.append((attribute_start, attribute_end))
            namespace = self._start_tag_namespace(normalized_tag, attrs)
            if (
                namespace == "html"
                and normalized_tag in HTML_IN_BODY_IGNORED_START_TAGS
                and (
                    normalized_tag in {"body", "frame", "frameset", "head", "html"}
                    or self._in_body_insertion_context()
                )
            ):
                # Review bodies are fragments: document wrappers cannot create
                # children or enable frameset insertion in the existing body.
                self._ignore_start_markup(start)
                return
            table_mode = bool(self.table_modes and self.table_modes[-1])
            if namespace == "html" and normalized_tag == "form":
                if self.template_depth == 0 and self.active_form_index is not None:
                    self._ignore_start_markup(start)
                    return
            if (
                namespace == "html"
                and normalized_tag == "table"
                and self.template_depth == 0
            ):
                table_index = self._table_insertion_index()
                if table_index is not None:
                    # In-table insertion closes the current table and then
                    # reprocesses the start in its parent's insertion context.
                    self._pop_elements(table_index, start, start)
            if (
                namespace == "html"
                and normalized_tag == "summary"
                and self.open_elements
                and self.open_elements[-1][:2] == ("colgroup", "html")
            ):
                # An in-column-group non-column token closes the group and is
                # reprocessed in the table insertion mode.
                self._pop_elements(len(self.open_elements) - 1, start, start)
            if namespace == "html" and normalized_tag == "button":
                # In-body button insertion closes an existing button in scope,
                # including visibility containers implicitly popped with it.
                button_index = self._element_in_scope("button")
                if button_index is not None:
                    self._generate_implied_end_tags()
                    self._pop_elements(button_index, start, start)
            if namespace == "html" and normalized_tag in HTML_ITEM_TAGS:
                self._close_implied_item(normalized_tag)
            if namespace == "html" and normalized_tag in {"option", "optgroup"}:
                if self._element_in_scope("select") is not None:
                    exclude = "optgroup" if normalized_tag == "option" else ""
                    self._generate_implied_end_tags(exclude)
                elif self.open_elements and self.open_elements[-1][:2] == (
                    "option",
                    "html",
                ):
                    self._pop_elements(len(self.open_elements) - 1, start, start)
            if (
                namespace == "html"
                and normalized_tag in HTML_P_CLOSING_START_TAGS
                and self.html_open_element_counts.get("p", 0)
            ):
                paragraph_index = None
                for index in range(len(self.open_elements) - 1, -1, -1):
                    element, element_namespace, _ = self.open_elements[index]
                    if self._is_button_scope_boundary(element, element_namespace):
                        break
                    if element == "p" and element_namespace == "html":
                        paragraph_index = index
                        break
                if paragraph_index is not None:
                    self._pop_elements(paragraph_index, start, start)
            if (
                namespace == "html"
                and normalized_tag in HTML_HEADING_TAGS
                and self.open_elements
                and self.open_elements[-1][0] in HTML_HEADING_TAGS
                and self.open_elements[-1][1] == "html"
            ):
                self._pop_elements(len(self.open_elements) - 1, start, start)
            if (
                strip_inline_markup
                and namespace == "html"
                and normalized_tag
                not in (HTML_CODE_CONTAINER_TAGS | {"details", "summary"})
            ):
                end = start + len(self.get_starttag_text())
                destination = (
                    block_markup_spans
                    if normalized_tag in HTML_BLOCK_TAGS or normalized_tag == "br"
                    else inline_markup_spans
                )
                if not (
                    preserve_inline_markup
                    and normalized_tag in HTML_INLINE_FORMATTING_TAGS
                ):
                    destination.append((start, end))
            if namespace == "html" and (
                normalized_tag in HTML_CODE_CONTAINER_TAGS
                or normalized_tag in {"details", "summary"}
            ):
                end = start + len(self.get_starttag_text())
                if normalized_tag in HTML_CODE_CONTAINER_TAGS:
                    tokens.append((start, end, "code-open", False, normalized_tag))
                elif normalized_tag == "summary":
                    direct_child = self._summary_parent_is_details()
                    if direct_child:
                        self.direct_summaries.add(len(self.open_elements))
                    tokens.append(
                        (start, end, "summary-open", direct_child, normalized_tag)
                    )
                else:
                    expanded = any(name.lower() == "open" for name, _ in attrs)
                    tokens.append(
                        (start, end, "details-open", expanded, normalized_tag)
                    )
            if namespace != "html" or normalized_tag not in HTML_VOID_TAGS:
                attrs_by_name = dict(attrs)
                encoding = (attrs_by_name.get("encoding") or "").lower()
                mathml_html_integration = (
                    namespace == "math"
                    and normalized_tag == "annotation-xml"
                    and encoding in {"text/html", "application/xhtml+xml"}
                )
                in_body = self.body_contexts[-1] if self.body_contexts else True
                if namespace != "html":
                    # An outer table does not govern HTML integration content.
                    in_body = True
                elif normalized_tag in HTML_TABLE_CONTEXT_TAGS:
                    in_body = False
                elif normalized_tag == "template":
                    self.template_depth += 1
                in_table = bool(self.table_modes and self.table_modes[-1])
                if namespace != "html" or normalized_tag in {
                    "caption",
                    "td",
                    "th",
                    "template",
                }:
                    in_table = False
                elif normalized_tag == "table":
                    in_table = True
                self.open_elements.append(
                    (normalized_tag, namespace, mathml_html_integration)
                )
                self.open_element_counts[normalized_tag] = (
                    self.open_element_counts.get(normalized_tag, 0) + 1
                )
                if namespace == "html":
                    self.html_open_element_counts[normalized_tag] = (
                        self.html_open_element_counts.get(normalized_tag, 0) + 1
                    )
                self.body_contexts.append(in_body)
                self.table_modes.append(in_table)
                if namespace == "html" and normalized_tag == "form":
                    if self.template_depth == 0:
                        self.active_form_index = len(self.open_elements) - 1
                        self.active_form_on_stack = True
                    if table_mode:
                        # In-table forms immediately leave the stack, including
                        # in templates; only ordinary parsing sets the pointer.
                        self._pop_elements(len(self.open_elements) - 1, start, start)

        def handle_startendtag(
            self, tag: str, attrs: list[tuple[str, str | None]]
        ) -> None:
            # HTML ignores self-closing flags on these non-void containers.
            self.handle_starttag(tag, attrs)

        def handle_endtag(self, tag: str) -> None:
            normalized_tag = tag.lower()
            start = self._offset()
            if _backslash_escaped(scan, start):
                return
            if mask_attributes:
                markup = _html_markup_at(scan, start)
                tag_name = HTML_MARKUP_TAG_START.match(scan, start)
                if markup is not None and markup[1] and tag_name is not None:
                    attribute_start = tag_name.end()
                    attribute_end = markup[2] - 1
                    if attribute_start < attribute_end:
                        attribute_spans.append((attribute_start, attribute_end))
            matching_index = (
                next(
                    (
                        index
                        for index in range(len(self.open_elements) - 1, -1, -1)
                        if self.open_elements[index][0] == normalized_tag
                    ),
                    None,
                )
                if self.open_element_counts.get(normalized_tag, 0)
                else None
            )
            matching_namespace = (
                self.open_elements[matching_index][1]
                if matching_index is not None
                else "html"
            )
            if matching_namespace == "html" and normalized_tag == "form":
                if self.template_depth == 0:
                    form_index = self.active_form_index
                    on_stack = self.active_form_on_stack
                    self.active_form_index = None
                    self.active_form_on_stack = False
                    if (
                        form_index is None
                        or not on_stack
                        or self._element_in_scope("form") != form_index
                    ):
                        self._ignore_end_markup(start)
                        return
                    self._generate_implied_end_tags()
                    # HTML removes only the active form node. Descendants stay
                    # open and keep their existing summary visibility identity.
                    self.open_element_counts[self.open_elements[form_index][0]] -= 1
                    self.html_open_element_counts[
                        self.open_elements[form_index][0]
                    ] -= 1
                    del self.open_elements[form_index]
                    del self.body_contexts[form_index]
                    del self.table_modes[form_index]
                    self.direct_summaries = {
                        index - 1 if index > form_index else index
                        for index in self.direct_summaries
                    }
                    if strip_inline_markup:
                        markup = _html_markup_at(scan, start)
                        if markup is not None:
                            block_markup_spans.append((start, markup[2]))
                    return
                matching_index = self._element_in_scope("form")
                if matching_index is None:
                    self._ignore_end_markup(start)
                    return
                self._generate_implied_end_tags()
            if matching_namespace == "html" and (
                normalized_tag in HTML_ITEM_TAGS or normalized_tag == "button"
            ):
                matching_index = self._element_in_scope(normalized_tag)
                if matching_index is None:
                    self._ignore_end_markup(start)
                    return
            if (
                strip_inline_markup
                and matching_namespace == "html"
                and (
                    matching_index is None
                    or normalized_tag
                    not in (HTML_CODE_CONTAINER_TAGS | {"details", "summary"})
                )
            ):
                markup = _html_markup_at(scan, start)
                if markup is not None:
                    # Ignored end tags have no rendered separator. An unmatched
                    # p/br closer is instead reprocessed as a real element.
                    separates = normalized_tag in {"p", "br"} or (
                        matching_index is not None and normalized_tag in HTML_BLOCK_TAGS
                    )
                    destination = (
                        block_markup_spans if separates else inline_markup_spans
                    )
                    if not (
                        preserve_inline_markup
                        and normalized_tag in HTML_INLINE_FORMATTING_TAGS
                    ):
                        destination.append((start, markup[2]))
            if matching_index is not None:
                markup = _html_markup_at(scan, start)
                self._pop_elements(
                    matching_index, start, markup[2] if markup else start
                )

    parser = ContainerParser()
    parser.feed(parser_scan)
    parser.close()
    if unterminated_comment is not None:
        tokens.append((unterminated_comment, len(scan), "comment", False, ""))
    tokens.sort(key=lambda token: token[0])

    details: list[dict[str, bool]] = []
    code_tags: list[str] = []
    open_summaries: list[tuple[int, bool, int]] = []
    start: int | None = None
    spans: list[tuple[int, int]] = []
    markup_spans = list(escaped_markup_spans) + inline_markup_spans
    spans.extend(attribute_spans)
    spans.extend(block_markup_spans)
    inline_code_tokens = set()
    if preserve_inline_code:
        line_breaks = [match.start() for match in re.finditer(r"[\r\n]", text)]
        unsupported_counts = [0]
        for token in tokens:
            unsupported_counts.append(
                unsupported_counts[-1]
                + (
                    token[2] not in {"comment", "code-open", "code-close"}
                    or (token[2] != "comment" and token[4] != "code")
                )
            )
        pending_codes = []
        for index, token in enumerate(tokens):
            begin, end, kind, _expanded, tag = token
            if kind == "code-open":
                pending_codes.append((index, begin, tag))
            elif kind == "code-close":
                for position in range(len(pending_codes) - 1, -1, -1):
                    opening, source_start, opened_tag = pending_codes[position]
                    if opened_tag == tag:
                        if tag == "code" and (
                            bisect_left(line_breaks, end)
                            == bisect_left(line_breaks, source_start)
                            and unsupported_counts[index]
                            == unsupported_counts[opening + 1]
                        ):
                            inline_code_tokens.update((source_start, begin))
                        del pending_codes[position:]
                        break

    def hidden_state() -> bool:
        return any(tag != "inline-code" for tag in code_tags) or any(
            not visible_open or (not item["expanded"] and not item["in_summary"])
            for item in details
        )

    for token_start, token_end, kind, expanded, tag in tokens:
        was_hidden = hidden_state()
        if kind == "comment":
            if not was_hidden and not preserve_markdown_comments:
                destination = markup_spans if strip_inline_markup else spans
                destination.append((token_start, token_end))
            continue
        if kind == "code-open":
            code_tags.append(
                "inline-code" if token_start in inline_code_tokens else tag
            )
        elif kind == "code-close":
            closing_tag = "inline-code" if token_start in inline_code_tokens else tag
            for index in range(len(code_tags) - 1, -1, -1):
                if code_tags[index] == closing_tag:
                    del code_tags[index:]
                    break
        elif any(tag != "inline-code" for tag in code_tags):
            continue
        elif kind == "details-open":
            details.append(
                {"expanded": expanded, "in_summary": False, "summary_seen": False}
            )
        elif kind == "details-close" and details:
            details.pop()
        elif kind == "summary-open" and details and expanded:
            if not details[-1]["summary_seen"]:
                details[-1]["summary_seen"] = True
                if visible_open and not details[-1]["expanded"]:
                    details[-1]["in_summary"] = True
        elif (
            kind == "summary-close"
            and expanded
            and details
            and details[-1]["in_summary"]
        ):
            details[-1]["in_summary"] = False
        is_hidden = hidden_state()
        if kind == "summary-open" and expanded:
            open_summaries.append((token_end, not is_hidden, len(details)))
        elif kind == "summary-close" and expanded and open_summaries:
            summary_start, summary_visible, _ = open_summaries.pop()
            if summary_visible and visible_summary_ranges is not None:
                visible_summary_ranges.append((summary_start, token_start))
        elif kind == "details-close":
            while open_summaries and open_summaries[-1][2] > len(details):
                summary_start, summary_visible, _ = open_summaries.pop()
                if summary_visible and visible_summary_ranges is not None:
                    visible_summary_ranges.append((summary_start, token_start))
        if not was_hidden and is_hidden:
            if kind == "details-open":
                markup_spans.append((token_start, token_end))
                start = token_end
            else:
                start = token_start
        elif was_hidden and not is_hidden and start is not None:
            if kind == "summary-open":
                spans.append((start, token_start))
                markup_spans.append((token_start, token_end))
            else:
                spans.append((start, token_end))
            start = None
        elif (
            not was_hidden
            and not is_hidden
            and kind
            in {
                "details-open",
                "details-close",
                "summary-open",
                "summary-close",
            }
        ):
            markup_spans.append((token_start, token_end))
    if start is not None:
        spans.append((start, len(text)))
    if visible_summary_ranges is not None:
        for summary_start, summary_visible, _ in open_summaries:
            if summary_visible:
                visible_summary_ranges.append((summary_start, len(text)))
    replacements = sorted(
        [(start, end, False) for start, end in spans]
        + [(start, end, True) for start, end in markup_spans],
        key=lambda span: (span[0], -span[1], span[2]),
    )
    raw_context = bytearray(len(text))
    escaped = bytearray()
    if decode_entities or mask_raw_html_text:
        for raw_start, raw_end in (
            _html_block_spans(text) if raw_html_blocks is None else raw_html_blocks
        ):
            raw_context[raw_start:raw_end] = b"\x01" * (raw_end - raw_start)
        escaped = _markdown_escaped_punctuation(text)

    def visible_text(start: int, end: int) -> str:
        chunk = text[start:end]
        if mask_raw_html_text:
            chunk = "".join(
                " "
                if raw_context[start + index] and character not in "\r\n"
                else character
                for index, character in enumerate(chunk)
            )
        if not decode_entities:
            return chunk

        def decode(match: re.Match[str]) -> str:
            reference = match.group()
            raw = bool(raw_context[start + match.start()])
            if not raw:
                if escaped[start + match.start()] or not reference.endswith(";"):
                    return reference
                name = reference[1:-1]
                if name.startswith("#"):
                    hexadecimal = name[1:2].lower() == "x"
                    digits = name[2:] if hexadecimal else name[1:]
                    if len(digits) > (6 if hexadecimal else 7):
                        return reference
                elif name + ";" not in html.entities.html5:
                    return reference
            if reference.startswith("&#"):
                hexadecimal = reference[2:3].lower() == "x"
                digits = reference[3:] if hexadecimal else reference[2:]
                digits = digits.rstrip(";").lstrip("0") or "0"
                if len(digits) > (6 if hexadecimal else 7):
                    return "\ufffd"
                reference = "&#" + ("x" if hexadecimal else "") + digits + ";"
            return html.unescape(reference).translate(EVIDENCE_LINE_SEPARATORS)

        return VISIBLE_CHARACTER_REFERENCE.sub(decode, chunk)

    chunks: list[str] = []
    position = 0
    for start, end, remove_markup in replacements:
        if start < position:
            continue
        chunks.append(visible_text(position, start))
        replacement = "" if remove_markup else " "
        masked = re.sub(r"[^\r\n]", replacement, text[start:end])
        if remove_markup and preserve_markup_lines:
            # Removing inline tags must not join physical CR and LF rows,
            # but spaces inside a visible priority would change its label.
            masked = " ".join(re.findall(r"\r\n|\r|\n", text[start:end]))
            if chunks[-1].endswith("\r") and (
                masked.startswith("\n") or (not masked and text[end:].startswith("\n"))
            ):
                masked = " " + masked
            if masked.endswith("\r") and text[end:].startswith("\n"):
                masked += " "
        chunks.append(masked)
        position = end
    chunks.append(visible_text(position, len(text)))
    return "".join(chunks)


def _commit_metadata(text: str) -> str:
    """Keep commit authority outside expandable, commented and code examples."""
    metadata = _visible_html(
        _actual_metadata(text),
        visible_open=False,
        mask_attributes=True,
        preserve_markup_lines=True,
    )
    code_lines = _markdown_lines(_without_inline_code(metadata), keepends=True)
    lines: list[str] = []
    quote_active = False
    list_content_indent: int | None = None
    list_after_blank = False
    for index, line in enumerate(_markdown_lines(metadata, keepends=True)):
        source = line.rstrip("\r\n")
        structural = code_lines[index].rstrip("\r\n")
        quote_text, quote_depth = _strip_quote_prefix(structural)
        _, _, list_indent = _block_prefix(structural)
        indent = _column_indent(quote_text)

        if not structural.strip():
            if list_content_indent is not None:
                list_after_blank = True
            # An unmarked blank line closes a blockquote lazy continuation.
            if not re.match(r"^[ ]{0,3}>", structural):
                quote_active = False
        else:
            root_block = bool(
                RESULT_HEADING.match(structural)
                or re.match(
                    r"^[ ]{0,3}(?:#{1,6}[ \t]|[-+*][ \t]|[0-9]+[.)][ \t])",
                    structural,
                )
            )
            if quote_depth:
                quote_active = True
            elif root_block:
                quote_active = False

            if list_indent:
                list_content_indent = list_indent
                list_after_blank = False
            elif list_content_indent is not None:
                if (list_after_blank and indent < list_content_indent) or root_block:
                    list_content_indent = None
                    list_after_blank = False
                else:
                    list_after_blank = False

        in_list = list_content_indent is not None and (
            not list_after_blank or indent >= list_content_indent
        )
        if REVIEWED_COMMIT.fullmatch(source) and (
            not code_lines[index].strip() or quote_active or quote_depth or in_list
        ):
            lines.append(re.sub(r"[^\r\n]", " ", line))
        else:
            lines.append(line)
    return "".join(lines)


def _reviewed_commits(text: str) -> list[str]:
    return [
        match.group(1).lower()
        for match in REVIEWED_COMMIT.finditer(_commit_metadata(text))
    ]


def _valid_coordinator_metadata(metadata: str) -> bool:
    lines = metadata.split("\n")
    index = 0
    while index < len(lines):
        if not lines[index].strip(" \t\r"):
            index += 1
            continue
        line = lines[index].strip(" \t\r")
        if _RETRY_REASON.fullmatch(line) or _PRIVATE_EVIDENCE.fullmatch(line):
            index += 1
            continue
        if _LEGACY_METADATA.fullmatch(
            "\n".join(lines[index : index + 4]).strip(" \t\r\n")
        ):
            index += 4
            continue
        return False
    return True


def _coordinator_container_prefix(lines: list[str]) -> tuple[list[str], list[bool]]:
    """Retain visible container wrappers while removing authenticated metadata."""
    container_tag = re.compile(r"</?\s*(?:details|summary)\b[^<>]*>", re.IGNORECASE)
    partial_container_tag = re.compile(
        r"</?\s*(?:details|summary)\b[^>]*", re.IGNORECASE
    )
    result: list[str] = []
    container_lines: list[bool] = []
    in_multiline_tag = False
    for line in lines:
        decoded = html.unescape(line)
        # Backslash escaping affects Markdown's HTML parsing only when the
        # number of backslashes is odd. Ignore a run before a wrapper tag for
        # metadata validation, while retaining the original prefix for parsing.
        normalized = re.sub(
            r"\\+(?=</?\s*(?:details|summary)\b)", "", decoded, flags=re.IGNORECASE
        )
        stripped = normalized.strip(" \t\r\n")
        if in_multiline_tag:
            result.append(line)
            container_lines.append(True)
            if ">" in decoded:
                in_multiline_tag = False
            continue
        position = 0
        found = False
        while position < len(stripped):
            while position < len(stripped) and stripped[position].isspace():
                position += 1
            match = container_tag.match(stripped, position)
            if match is None:
                found = False
                break
            found = True
            position = match.end()
        if found and not stripped[position:].strip():
            result.append(line)
            container_lines.append(True)
            continue
        if partial_container_tag.fullmatch(stripped) and ">" not in stripped:
            result.append(line)
            container_lines.append(True)
            in_multiline_tag = True
            continue
        result.append(re.sub(r"[^\r\n]", " ", line))
        container_lines.append(False)
    return result, container_lines


def _coordinator_body(body: str) -> tuple[str, str | None]:
    match = COORDINATOR_PRELUDE.match(body)
    if not match:
        return body, None
    rest = body[match.end() :]
    # Metadata is the prefix before the first recognized result heading. Do not
    # let a malformed request marker supply a fallback commit to a section.
    lines = _markdown_lines(rest)
    structural_text = _visible_html(_actual_metadata(rest), preserve_markup_lines=True)
    structural_lines = _markdown_lines(
        _without_inline_code(_mask_backslash_escaped_container_tags(structural_text))
    )
    priority_lines = _markdown_lines(_priority_projection(rest))
    structural_lines.extend([""] * (len(lines) - len(structural_lines)))
    priority_lines.extend([""] * (len(lines) - len(priority_lines)))
    for first, _last, label, _kind in _markdown_document(rest)[4]:
        structural_lines[first] = label
    start = next(
        (
            i
            for i, line in enumerate(structural_lines)
            if RESULT_HEADING.match(line)
            or PRIORITY_RESULT.match(line)
            or PRIORITY_RESULT.match(priority_lines[i])
            or AVAILABILITY.fullmatch(line)
            or SECURITY_MARKER.fullmatch(line)
            or INLINE_SECURITY_MARKER.fullmatch(line)
        ),
        len(lines),
    )
    prefix, container_lines = _coordinator_container_prefix(lines[:start])
    metadata_lines = structural_lines[:start]
    for index, is_container in enumerate(container_lines):
        if is_container:
            metadata_lines[index] = re.sub(r"[^\r\n]", " ", metadata_lines[index])
    metadata = "\n".join(metadata_lines)
    valid_metadata = not (
        not _valid_coordinator_metadata(metadata)
        or re.search(r"\bP[0-3]\b", metadata, re.I)
        or (
            SECURITY_MARKER_COMMENT.search(_without_inline_code(metadata))
            and not re.search(
                r"(?is)\A[ \t\r\n]*(?:Retry reason:[^\r\n]*\r?\n[ \t]*)*"
                r"Root-cause diagnosis:[ \t]*\r?\n[ \t]*- rootCause:[^\r\n]*"
                r"codex-security-review-finding:v1[^\r\n]*\r?\n[ \t]*- changes:[^\r\n]*"
                r"\r?\n[ \t]*- validation:[^\r\n]*[ \t\r\n]*\Z",
                metadata,
                re.I,
            )
        )
    )
    if not valid_metadata:
        marker_prefix = structural_lines[:start]
        marker_only = all(
            not line.strip()
            or SECURITY_MARKER.fullmatch(line)
            or INLINE_SECURITY_MARKER.fullmatch(line)
            for line in marker_prefix
        )
        if not (
            marker_only
            and any(line.strip() for line in marker_prefix)
            and start < len(lines)
            and SECURITY_HEADING.match(structural_lines[start])
        ):
            return body, None
        return "\n".join(lines), match.group("head").lower()
    return "\n".join(prefix + lines[start:]), match.group("head").lower()


def _section_spans(body: str, coordinator_bound: bool = False):
    original_lines = _markdown_lines(body)
    authority_lines = _markdown_lines(_commit_metadata(body))
    authority_lines.extend([""] * (len(original_lines) - len(authority_lines)))
    # A section beginning inside an expanded container must not lose the
    # container context and acquire its copied footer as commit authority.
    original_lines = [
        re.sub(r"[^\r\n]", " ", line)
        if REVIEWED_COMMIT.fullmatch(line)
        and not REVIEWED_COMMIT.fullmatch(authority_lines[index])
        else line
        for index, line in enumerate(original_lines)
    ]
    structural_text = _visible_html(_actual_metadata(body), preserve_markup_lines=True)
    lines = _markdown_lines(
        _without_inline_code(_mask_backslash_escaped_container_tags(structural_text))
    )
    lines.extend([""] * (len(original_lines) - len(lines)))
    priority_lines = _markdown_lines(_priority_projection(body))
    priority_lines.extend([""] * (len(original_lines) - len(priority_lines)))
    diagnostic_rows, _unknown, _containers, container_boundaries, headings = (
        _markdown_document(body)
    )
    for first, _last, label, _kind in headings:
        lines[first] = label
    marker_container_starts = {
        start
        for start, (label, units) in container_boundaries
        if SECURITY_MARKER.fullmatch(label.strip())
        and units
        and all(marked and not unknown for _row, _label, marked, unknown in units)
    }
    starts: list[int] = []
    kinds: dict[int, str] = {}
    reviewed_counts = [0]
    inline_security_counts = [0]
    priority_counts = [0]
    priority_matches = [
        bool(
            PRIORITY_RESULT.match(line) or PRIORITY_RESULT.match(priority_lines[index])
        )
        for index, line in enumerate(lines)
    ]
    inline_security_matches = [
        bool(
            INLINE_SECURITY_MARKER.search(line)
            or (
                SECURITY_MARKER_COMMENT.search(line)
                and INLINE_SECURITY_MARKER.search(diagnostic_rows[index])
            )
        )
        for index, line in enumerate(lines)
    ]
    # Assign every mapped boundary explicitly. Ownership belongs to each
    # authenticated cell/row, so a first marked row cannot hide later ordinary
    # units and a same-row marker cannot claim another priority cell.
    for start, (_label, units) in container_boundaries:
        inline_security_matches[start] = bool(units) and all(
            marked and not unknown for _row, _label, marked, unknown in units
        )
    for index, _line in enumerate(lines):
        reviewed_counts.append(
            reviewed_counts[-1]
            + bool(REVIEWED_COMMIT.fullmatch(authority_lines[index]))
        )
        inline_security_counts.append(
            inline_security_counts[-1] + inline_security_matches[index]
        )
        priority_counts.append(priority_counts[-1] + priority_matches[index])
    for i, line in enumerate(lines):
        if RESULT_HEADING.match(line):
            starts.append(i)
            kinds[i] = "security" if SECURITY_HEADING.match(line) else "regular"
        elif i in marker_container_starts:
            starts.append(i)
            kinds[i] = "security"
        elif priority_matches[i]:
            previous_start = starts[-1] if starts else 0
            previous_bound = reviewed_counts[i] > reviewed_counts[previous_start]
            prior_priority = priority_counts[i] > priority_counts[previous_start]
            regular_clean = False
            security_clean = False
            if starts and not prior_priority:
                # A visible priority line makes a strict standalone clean result
                # impossible. Inspect each result's pre-list text only once.
                previous = "\n".join(original_lines[previous_start:i])
                regular_clean = _standalone_regular_clean(previous)
                if coordinator_bound:
                    security_clean = _standalone_security_clean(previous)
            marker_start = i
            while marker_start > previous_start and (
                (
                    not lines[marker_start - 1].strip()
                    and not original_lines[marker_start - 1].strip()
                )
                or SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                or (
                    INLINE_SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                    and not priority_matches[marker_start - 1]
                )
            ):
                marker_start -= 1
            marker_text = "\n".join(lines[marker_start:i])
            marker_only = bool(marker_text.strip()) and all(
                not candidate.strip()
                or SECURITY_MARKER.fullmatch(candidate)
                or INLINE_SECURITY_MARKER.fullmatch(candidate)
                for candidate in lines[marker_start:i]
            )
            # A priority list remains inside its heading until that result is
            # complete. A bound result or standalone clean summary ends it.
            inline_security = inline_security_matches[i]
            prior_inline_security = (
                inline_security_counts[i] > inline_security_counts[previous_start]
            )
            explicit_security_prior = bool(
                starts and SECURITY_HEADING.match(lines[previous_start])
            )
            if (
                not starts
                or previous_bound
                or regular_clean
                or security_clean
                or marker_only
                or (
                    prior_inline_security
                    and not inline_security
                    and not explicit_security_prior
                )
            ):
                kind = (
                    "security"
                    if inline_security
                    or marker_only
                    or (
                        starts
                        and kinds[starts[-1]] == "security"
                        and not (
                            prior_inline_security
                            and not inline_security
                            and not explicit_security_prior
                        )
                        and (
                            not coordinator_bound
                            or previous_bound
                            or not security_clean
                        )
                    )
                    else "unheaded"
                )
                starts.append(i)
                kinds[i] = kind
    if not starts:
        return [("unheaded", body, 0, len(lines))]

    attached_starts: dict[int, int] = {}
    for index, start in enumerate(starts):
        previous_start = starts[index - 1] if index else 0
        marker_start = start
        while marker_start > previous_start and (
            (
                not lines[marker_start - 1].strip()
                and not original_lines[marker_start - 1].strip()
            )
            or SECURITY_MARKER.fullmatch(lines[marker_start - 1])
            or (
                INLINE_SECURITY_MARKER.fullmatch(lines[marker_start - 1])
                and not priority_matches[marker_start - 1]
            )
        ):
            marker_start -= 1
        marker_run = lines[marker_start:start]
        if (
            any(line.strip() for line in marker_run)
            and all(
                not line.strip()
                or SECURITY_MARKER.fullmatch(line)
                or INLINE_SECURITY_MARKER.fullmatch(line)
                for line in marker_run
            )
            and (SECURITY_HEADING.match(lines[start]) or kinds[start] == "security")
        ):
            attached_starts[start] = marker_start
            kinds[start] = "security"
    unconsumed_prefix = lines[: attached_starts.get(starts[0], starts[0])]
    result = []
    if any(line.strip() for line in unconsumed_prefix):
        # A result heading cannot erase preceding adverse evidence. Keep the
        # prefix independently bound; missing metadata remains fail-closed.
        result.append(
            (
                "unheaded",
                "\n".join(original_lines[: attached_starts.get(starts[0], starts[0])]),
                0,
                attached_starts.get(starts[0], starts[0]),
            )
        )
    for index, start in enumerate(starts):
        next_start = starts[index + 1] if index + 1 < len(starts) else len(lines)
        end = attached_starts.get(next_start, next_start)
        text_start = attached_starts.get(start, start)
        result.append(
            (kinds[start], "\n".join(original_lines[text_start:end]), text_start, end)
        )
    return result


def _raw_sections(body: str, coordinator_bound: bool = False):
    return [
        (kind, text) for kind, text, _, _ in _section_spans(body, coordinator_bound)
    ]


def _target_ref(section: str, request_head: str | None) -> str:
    refs = _reviewed_commits(section)
    if len(set(refs)) > 1:
        # Multiple different reviewed commits in one result section do not
        # identify a single safe destination for status history.
        return "__unbound__"
    if refs:
        return refs[-1]
    return request_head or "__unbound__"


def _shared_footer_ref(raw_sections: list[tuple[str, str]]) -> str | None:
    """A single trailing commit footer can bind adjacent split result sections."""
    if len(raw_sections) < 2 or raw_sections[0][0] != "security":
        return None
    if any(kind in ("regular", "security") for kind, _ in raw_sections[1:]):
        return None
    if any(_reviewed_commits(text) for _, text in raw_sections[1:-1]):
        return None
    refs = _reviewed_commits(raw_sections[-1][1])
    if len(set(refs)) == 1:
        return refs[0]
    return None


def _without_heading(kind: str, section: str) -> str:
    lines = _markdown_lines(section)
    if not lines:
        return section
    heading = REGULAR_HEADING if kind == "regular" else SECURITY_HEADING
    for first, last, label, heading_kind in _markdown_document(section)[4]:
        if first == 0 and heading_kind == kind:
            match = heading.match(label)
            return "\n".join([label[match.end() :], *lines[last:]])
    match = heading.match(lines[0])
    if match:
        lines[0] = lines[0][match.end() :]
    return "\n".join(lines)


def _without_known_review_footer(text: str) -> str:
    match = re.search(r"(?is)(?:\A|\r?\n)([ \t]*<details>.*?</details>[ \t]*)\Z", text)
    if match and KNOWN_REVIEW_FOOTER.fullmatch(match.group(1).strip()):
        return text[: match.start()].rstrip()
    return text


def _without_known_security_footer(text: str) -> str:
    text = text.rstrip()
    match = re.search(
        r"(?is)(?:\A|\r?\n)"
        r"([ \t]*_only the user who started this review.*?</details>[ \t]*)\Z",
        text,
    )
    if match and KNOWN_SECURITY_FOOTER.fullmatch(match.group(1).strip()):
        return text[: match.start()].rstrip()
    return text


def _without_review_metadata(text: str) -> str:
    text = text.strip()
    text = re.sub(
        r"(?im)(?:\A|\r?\n)[ \t]*\[view security finding report\]"
        r"\(https?://[^\s)]+\)[ \t]*\Z",
        "",
        text,
    ).strip()
    text = re.sub(
        r"(?im)(?:\A|\r?\n)[ \t]*\*{0,2}reviewed commit:\*{0,2}[ \t]*"
        r"`(?:[0-9a-f]{10}|[0-9a-f]{40})`[ \t]*\Z",
        "",
        text,
    )
    return text.strip()


def _standalone_regular_clean(section: str) -> bool:
    text = _without_heading("regular", section)
    text = _without_known_review_footer(text)
    text = _without_review_metadata(text)
    return bool(KNOWN_REGULAR_CLEAN_RESULT.fullmatch(text))


def _standalone_security_clean(section: str) -> bool:
    text = _without_heading("security", section)
    text = _without_known_security_footer(text)
    text = _without_known_review_footer(text)
    text = _without_review_metadata(text)
    return bool(KNOWN_SECURITY_CLEAN_RESULT.fullmatch(text))


class MarkdownBoundaryError(ValueError):
    """The pinned structured parser could not establish a bounded view."""


_MARKDOWN_PARSE_SECONDS = 10.0
_MARKDOWN_ACTIVE_DEADLINE = None


class _MarkdownDeadline:
    """Bound regex engine work as well as observable Python helper scans."""

    def __enter__(self):
        global _MARKDOWN_ACTIVE_DEADLINE
        self.signal = sys.modules.get("signal")
        if self.signal is None:
            raise MarkdownBoundaryError("Missing verified Markdown signal module")
        if not hasattr(self.signal, "setitimer"):
            raise MarkdownBoundaryError("Markdown requires the Unix policy runtime")
        self.nested = False
        active = _MARKDOWN_ACTIVE_DEADLINE
        if active is not None:
            if sys.modules["threading"].get_ident() != active.owner:
                raise MarkdownBoundaryError("Markdown parsing requires the main thread")
            if self.signal.getsignal(self.signal.SIGALRM) != active.expired:
                raise MarkdownBoundaryError("Lost Markdown signal ownership")
            if self.signal.getitimer(self.signal.ITIMER_REAL)[0] <= 0:
                raise MarkdownBoundaryError("Markdown parse runtime budget exceeded")
            self.nested = True
            return self
        if any(self.signal.getitimer(self.signal.ITIMER_REAL)):
            raise MarkdownBoundaryError("Conflicting Markdown parse timer")
        self.previous = self.signal.getsignal(self.signal.SIGALRM)
        if self.previous not in (self.signal.SIG_DFL, self.signal.SIG_IGN):
            raise MarkdownBoundaryError("Conflicting Markdown signal handler")
        try:
            self.signal.signal(self.signal.SIGALRM, self.expired)
        except ValueError as exc:
            raise MarkdownBoundaryError(
                "Markdown parsing requires the main thread"
            ) from exc
        try:
            self.signal.setitimer(self.signal.ITIMER_REAL, _MARKDOWN_PARSE_SECONDS)
        except (OSError, ValueError) as exc:
            try:
                self.signal.setitimer(self.signal.ITIMER_REAL, 0)
            finally:
                self.signal.signal(self.signal.SIGALRM, self.previous)
            raise MarkdownBoundaryError("Cannot arm Markdown parse timer") from exc
        self.owner = sys.modules["threading"].get_ident()
        _MARKDOWN_ACTIVE_DEADLINE = self
        return self

    @staticmethod
    def expired(signum, frame):
        raise MarkdownBoundaryError("Markdown parse runtime budget exceeded")

    def __exit__(self, kind, value, traceback):
        global _MARKDOWN_ACTIVE_DEADLINE
        if self.nested:
            return
        try:
            self.signal.setitimer(self.signal.ITIMER_REAL, 0)
        finally:
            try:
                self.signal.signal(self.signal.SIGALRM, self.previous)
            finally:
                _MARKDOWN_ACTIVE_DEADLINE = None


class _MarkdownWork:
    def __init__(self):
        self.remaining = 2_000_000

    def spend(self, amount):
        self.remaining -= amount
        if self.remaining < 0:
            raise MarkdownBoundaryError("Markdown scanning work budget exceeded")


class _BudgetText(str):
    """Count character scans/copies used by the maintained parser's helpers."""

    def __new__(cls, value, work):
        instance = super().__new__(cls, value)
        instance.work = work
        return instance

    def __getitem__(self, key):
        size = len(range(*key.indices(len(self)))) if isinstance(key, slice) else 1
        self.work.spend(size)
        value = super().__getitem__(key)
        return _BudgetText(value, self.work) if isinstance(key, slice) else value

    def __iter__(self):
        for char in super().__iter__():
            self.work.spend(1)
            yield char

    def find(self, sub, start=0, end=None):
        end = len(self) if end is None else end
        first, last, _ = slice(start, end).indices(len(self))
        found = super().find(sub, start, end)
        self.work.spend(max(0, (found + len(sub) if found >= 0 else last) - first))
        return found

    def rfind(self, sub, start=0, end=None):
        end = len(self) if end is None else end
        first, last, _ = slice(start, end).indices(len(self))
        found = super().rfind(sub, start, end)
        self.work.spend(max(0, last - (found if found >= 0 else first)))
        return found


def _markdown_text(tokens, *, block_markers=False, before_code=False):
    chunks = []
    code_chunks = {}
    html_code_depth = 0
    stack = [(token, False) for token in reversed(tokens)]
    visited = 0
    while stack:
        token, in_link = stack.pop()
        visited += 1
        if visited > 65536:
            raise MarkdownBoundaryError("Markdown node budget exceeded")
        kind = token.get("type")
        if before_code and (
            kind == "codespan"
            or (
                kind == "inline_html"
                and re.match(r"<code(?:[ \t/>]|$)", token.get("raw", ""), re.I)
            )
        ):
            break
        if kind == "text":
            raw = token.get("raw", "")

            # Decode each text token separately. An escaped ampersand belongs
            # to a distinct token and cannot create an entity across a boundary.
            def decode(match):
                ref = match.group()
                if not ref.endswith(";"):
                    return ref
                if not ref.startswith("&#") and ref[1:] not in html.entities.html5:
                    return ref
                return html.unescape(ref).translate(EVIDENCE_LINE_SEPARATORS)

            if html_code_depth:
                code_chunks[len(chunks)] = in_link
            chunks.append(VISIBLE_CHARACTER_REFERENCE.sub(decode, raw))
        elif (
            block_markers
            and kind == "block_html"
            and SECURITY_MARKER_COMMENT.fullmatch(token.get("raw", "").strip())
        ):
            chunks.append(token["raw"].strip())
        elif kind == "codespan":
            code_chunks[len(chunks)] = in_link
            chunks.append(token.get("raw", ""))
        elif kind in ("softbreak", "linebreak"):
            chunks.append("\n")
        elif kind == "inline_html":
            raw = token.get("raw", "")
            code_tag = re.fullmatch(r"<(/?)code(?:\s[^>]*)?>", raw, re.I)
            if code_tag:
                if code_tag.group(1):
                    html_code_depth = max(0, html_code_depth - 1)
                else:
                    html_code_depth += 1
            elif not html_code_depth and SECURITY_MARKER_COMMENT.fullmatch(raw):
                chunks.append(raw)
        elif kind not in (
            "codespan",
            "image",
            "block_code",
            "block_html",
        ) and not token.get("_review_url"):
            stack.extend(
                (child, in_link or kind == "link")
                for child in reversed(token.get("children", ()))
            )
    if not code_chunks:
        return "".join(chunks)
    rendered = "".join(chunks)
    priorities = [
        (match.start(), match.end()) for match in _PRIORITY_CANDIDATE.finditer(rendered)
    ]
    if _BIDI_CONTROL.search(rendered):
        priorities.extend(
            (match.start(), match.end())
            for match in _BIDI_PRIORITY_CANDIDATE.finditer(rendered)
        )
        priorities.sort()
    # Adjacent code elements may jointly cover an entire priority. Only a
    # priority with an actual rendered character outside the code union can
    # restore otherwise inert fragments; group boundaries are not evidence.
    code_ranges = []
    position = 0
    for index, chunk in enumerate(chunks):
        end = position + len(chunk)
        if index in code_chunks and end > position:
            if code_ranges and code_ranges[-1][1] == position:
                code_ranges[-1] = (code_ranges[-1][0], end)
            else:
                code_ranges.append((position, end))
        position = end
    code_starts = [start for start, _end in code_ranges]
    composed_priorities = []
    for start, end in priorities:
        enclosing = bisect_right(code_starts, start) - 1
        if enclosing < 0 or code_ranges[enclosing][1] < end:
            composed_priorities.append((start, end))
    priority_starts = [start for start, _end in composed_priorities]
    priority_ends = [end for _start, end in composed_priorities]
    position = 0
    visible = []
    for index, chunk in enumerate(chunks):
        end = position + len(chunk)
        first = bisect_right(priority_ends, position)
        last = bisect_left(priority_starts, end) - 1
        if index not in code_chunks or code_chunks[index] or first <= last:
            visible.append(chunk)
        position = end
    return "".join(visible)


@lru_cache(maxsize=8)
def _markdown_document(text):
    if len(text) > 262144:
        raise MarkdownBoundaryError("Markdown input budget exceeded")
    mistune = _markdown_packages()
    with _MarkdownDeadline():
        return _parse_markdown_document(text, mistune)


def _parse_markdown_document(text, mistune):
    original = _actual_metadata(text)
    raw_blocks = _html_block_spans(original)
    # HTML visibility and source authority remain separate from Markdown.
    # Raw blocks retain their browser-visible text without Markdown formatting.
    html_view = _visible_html(
        original,
        mask_attributes=True,
        decode_entities=True,
        strip_inline_markup=True,
        preserve_markup_lines=True,
    )
    source = _visible_html(
        original,
        mask_attributes=True,
        strip_inline_markup=True,
        mask_raw_html_text=True,
        preserve_markup_lines=True,
        preserve_markdown_comments=True,
        preserve_inline_code=True,
        preserve_inline_markup=True,
    )
    source = source.replace("\r\n", "\n").replace("\r", "\n")
    original_rows = _markdown_lines(original)
    html_rows = _markdown_lines(html_view)
    source_rows = _markdown_lines(source)
    marker_visibility_safe = None
    for index, line in enumerate(original_rows):
        # Raw-block masking also covers a pure comment inside a nested list or
        # quote. Restore only a globally visible authenticated marker row so the
        # official AST can validate its physical wrapper and cell ownership.
        wrapper = re.fullmatch(
            r"(?: {0,3}(?:(?:[-+*]|\d{1,9}[.)])[ \t]+|> ?))+(.*)", line
        )
        if (
            wrapper
            and "codex-security-review-finding" in wrapper.group(1).casefold()
            and SECURITY_MARKER_COMMENT.search(
                _visible_html(
                    _mask_markdown_link_metadata(
                        _without_inline_code(
                            _actual_metadata(
                                _mask_backslash_escaped_container_tags(wrapper.group(1))
                            )
                        )
                    ),
                    mask_attributes=True,
                )
            )
            and index < len(html_rows)
            and SECURITY_MARKER_COMMENT.search(html_rows[index])
            and not _html_visibility_ambiguous(line)
        ):
            if marker_visibility_safe is None:
                marker_visibility_safe = not _html_visibility_ambiguous(original)
            if marker_visibility_safe:
                source_rows[index] = line
    source = "\n".join(source_rows)
    count = len(_markdown_lines(text))
    rows = [""] * count
    uncertain = set()
    starts = [0]
    starts.extend(match.end() for match in re.finditer("\n", source))
    html_rows = _markdown_lines(html_view)
    original_offsets = [0]
    for line in _markdown_lines(original, keepends=True):
        original_offsets.append(original_offsets[-1] + len(line))
    for begin, end in raw_blocks:
        first = bisect_right(original_offsets, begin) - 1
        last = bisect_left(original_offsets, end)
        for index in range(first, min(last, count)):
            rows[index] = html_rows[index] if index < len(html_rows) else ""

    work = _MarkdownWork()

    class SourceState(mistune.BlockState):
        def process(self, src):
            super().process(_BudgetText(src, work))

        def append_token(self, token):
            token["_review_start"] = self.cursor
            super().append_token(token)

        def add_paragraph(self, value):
            super().add_paragraph(value)
            self.tokens[-1].setdefault("_review_start", self.cursor)

    class SourceBlockParser(mistune.BlockParser):
        def parse_method(self, match, state):
            start, index = state.cursor, len(state.tokens)
            previous_kind = state.tokens[-1].get("type") if index else None
            result = super().parse_method(match, state)
            # Setext parsing converts an existing paragraph instead of appending
            # a token; retain its original start and record the underline end.
            if (
                previous_kind == "paragraph"
                and index == len(state.tokens)
                and state.tokens[-1].get("type") == "heading"
            ):
                state.tokens[-1]["_review_end"] = (
                    result if isinstance(result, int) else state.cursor
                )
            for token in state.tokens[index:]:
                if token.get("type") in ("list", "block_quote", "table"):
                    token["_review_start"] = start
                else:
                    token.setdefault("_review_start", start)
                token.setdefault(
                    "_review_end", result if isinstance(result, int) else state.cursor
                )
            return result

    class LabelInlineParser(mistune.InlineParser):
        def render(self, state):
            state.src = _BudgetText(state.src, work)
            return super().render(state)

        def _add_auto_link(self, url, text, state):
            super()._add_auto_link(url, text, state)
            state.tokens[-1]["_review_url"] = True

    block = SourceBlockParser(max_nested_level=16)
    block.state_cls = SourceState
    md = mistune.Markdown(
        renderer=None,
        block=block,
        inline=LabelInlineParser(max_emphasis_depth=20, max_image_depth=20),
    )
    # Callable plugins avoid any ambient plugin discovery.
    formatting = sys.modules[mistune.__name__ + ".plugins.formatting"]
    table = sys.modules[mistune.__name__ + ".plugins.table"]
    md.use(formatting.strikethrough)
    md.use(table.table)

    def save_source(markdown, state):
        pending = list(state.tokens)
        nodes = 0
        while pending:
            token = pending.pop()
            nodes += 1
            if nodes > 65536:
                raise MarkdownBoundaryError("Markdown block budget exceeded")
            if "text" in token:
                token["_review_source"] = token["text"]
            pending.extend(token.get("children", ()))

    md.before_render_hooks.append(save_source)
    try:
        tokens, _state = md.parse(source)
    except (RecursionError, RuntimeError, IndexError) as exc:
        raise MarkdownBoundaryError("Structured Markdown parsing failed") from exc
    container_rows = set()
    container_boundaries = {}
    heading_nodes = []

    def mapped_container(token, next_start):
        """Verify simple physical container rows against the complete AST."""
        kind = token.get("type")
        if kind not in ("list", "block_quote", "table"):
            return None
        begin, end = token.get("_review_start", 0), token.get("_review_end", 0)
        end = min(end, next_start)
        if end <= begin:
            return None
        first = bisect_right(starts, begin) - 1
        physical = _markdown_lines(source[begin:end])
        mapped = []
        flattened = []
        for offset, line in enumerate(physical):
            if not line.strip():
                continue
            if kind == "table":
                # The verified plugin owns pipe escaping and cell splitting.
                # The complete AST equality below also validates row mapping.
                if "|" not in line:
                    return None
                strip_row = (
                    table._strip_pipe_table_row
                    if line.strip().startswith("|")
                    else table._strip_table_line
                )
                row_text = strip_row(_BudgetText(line, work))
                if row_text is None:
                    return None
                cells = table._split_table_cells(row_text)
                if all(re.fullmatch(r"\s*:?-+:?\s*", cell) for cell in cells):
                    continue
                labels = [
                    _markdown_text(md.inline(cell.strip(), _state.env))
                    for cell in cells
                ]
                original_row = original_rows[first + offset]
                original_strip = (
                    table._strip_pipe_table_row
                    if original_row.strip().startswith("|")
                    else table._strip_table_line
                )
                original_row_text = original_strip(_BudgetText(original_row, work))
                if original_row_text is None:
                    return None
                source_units = table._split_table_cells(original_row_text)
                if len(source_units) != len(labels):
                    return None
                flattened.extend(labels)
            else:
                pattern = (
                    r" {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+([^ \t].*)"
                    if kind == "list"
                    else r" {0,3}> ?(.*)"
                )
                match = re.fullmatch(pattern, line)
                if match is None:
                    return None
                visible = _markdown_text(md.inline(match.group(1), _state.env))
                original_match = re.fullmatch(pattern, original_rows[first + offset])
                if original_match is None:
                    return None
                source_units = [original_match.group(1)]
                labels = [visible]
                flattened.append(visible)
            finding_units = []
            diagnostic_labels = []
            for raw_unit, label in zip(source_units, labels):  # noqa: B905
                # Marker ownership follows the actual cell/row source. Rendered
                # labels cannot authenticate code, title or escaped examples.
                actual_marker = False
                if "codex-security-review-finding" in raw_unit.casefold():
                    authority = _visible_html(
                        _mask_markdown_link_metadata(
                            _without_inline_code(
                                _actual_metadata(
                                    _mask_backslash_escaped_container_tags(raw_unit)
                                )
                            )
                        ),
                        mask_attributes=True,
                    )
                    actual_marker = bool(
                        any(
                            not _backslash_escaped(authority, match.start())
                            for match in SECURITY_MARKER_COMMENT.finditer(authority)
                        )
                        and not _html_visibility_ambiguous(raw_unit)
                    )
                if not actual_marker:
                    label = SECURITY_MARKER_COMMENT.sub("", label)
                diagnostic_labels.append(label)
                priority_label = label
                task_candidate = re.sub(
                    r"\A[^\S\r\n]*(?:[-+*][ \t]+)?\[[ xX]\][^\S\r\n]+", "", label
                )
                if task_candidate != label and _unicode_priority_uncertain(
                    task_candidate
                ):
                    # Checkbox projection must not conceal Unicode uncertainty
                    # in the candidate label, including unsupported containers.
                    return None
                if (
                    kind != "list"
                    and task_candidate != label
                    and PRIORITY_RESULT.match(task_candidate)
                ):
                    # An unmatched task-shaped priority in another container
                    # has no validated list ownership; retain uncertainty.
                    return None
                if kind == "list":
                    # Only literal source task syntax supplies list decoration.
                    # Escapes, entities, HTML and code cannot create a checkbox.
                    source_task = re.match(r"\A[ \t]*\[[ xX]\][ \t]+", raw_unit)
                    rendered_task = re.match(r"\A[^\S\r\n]*\[[ xX]\][^\S\r\n]+", label)
                    coded_task = re.match(
                        r"\A[ \t]*(?:`+\[[ xX]\]`+|<code>\[[ xX]\]</code>)[ \t]+",
                        raw_unit,
                        re.I,
                    )
                    if (rendered_task or coded_task) and not source_task:
                        return None
                    if source_task and rendered_task:
                        priority_label = label[rendered_task.end() :]
                if PRIORITY_RESULT.match(priority_label):
                    count_priorities = len(
                        re.findall(r"\[P[0-3]\]", priority_label, re.I)
                    )
                    marked = bool(
                        actual_marker
                        and INLINE_SECURITY_MARKER.fullmatch(priority_label)
                    )
                    finding_units.append(
                        (
                            first + offset,
                            priority_label,
                            marked and count_priorities == 1,
                            marked and count_priorities != 1,
                        )
                    )
                elif actual_marker and SECURITY_MARKER.fullmatch(
                    priority_label.strip()
                ):
                    # The marker is its own security signal. It cannot transfer
                    # ownership to a priority in another physical source cell.
                    finding_units.append((first + offset, priority_label, True, False))
                elif actual_marker:
                    # Unsupported marker-bearing units cannot silently erase
                    # security evidence merely because decoration is unmapped.
                    return None
            visible = " ".join(diagnostic_labels)
            mapped.append((first + offset, visible, tuple(finding_units)))
        if "".join(flattened).replace("\n", "") != _markdown_text(
            [token], block_markers=True
        ).replace("\n", ""):
            return None
        return mapped

    for token_index, token in enumerate(tokens):
        position = token.get("_review_start", 0)
        first = bisect_right(starts, position) - 1
        if token.get("type") == "heading":
            # Heading soft breaks collapse to spaces in the browser. This
            # category projection never replaces raw source/footer authority.
            label = _markdown_text(token.get("children", ())).replace("\n", " ")
            end = token.get("_review_end", position)
            last = bisect_left(starts, end)
            pending = list(token.get("children", ()))
            code_heading = False
            while pending:
                child = pending.pop()
                if child.get("type") == "codespan" or (
                    child.get("type") == "inline_html"
                    and re.match(r"<code(?:[ \t/>]|$)", child.get("raw", ""), re.I)
                ):
                    code_heading = True
                pending.extend(child.get("children", ()))
            if code_heading:
                prefix = _markdown_text(
                    token.get("children", ()), before_code=True
                ).replace("\n", " ")
                if (
                    (
                        RESULT_HEADING.match(prefix)
                        or RESULT_HEADING.match(_DEFAULT_IGNORABLE.sub("", prefix))
                    )
                    and prefix
                    and not prefix[-1].isalnum()
                ):
                    # Ancillary code cannot erase an already established
                    # visible category with its own source boundary.
                    label = prefix
                    code_heading = False
            if code_heading and last > first:
                # Code text must never be erased to synthesize a protocol
                # category. Blank only the diagnostic heading projection.
                heading_nodes.append((first, last, "", "inert"))
            diagnostic_label = _DEFAULT_IGNORABLE.sub("", label)
            uncertain_heading = bool(
                diagnostic_label != label
                and RESULT_HEADING.match(diagnostic_label)
                and not RESULT_HEADING.match(label)
            )
            if (
                not code_heading
                and (RESULT_HEADING.match(label) or uncertain_heading)
                and last > first
                and not _html_visibility_ambiguous("\n".join(original_rows[first:last]))
            ):
                heading_nodes.append(
                    (
                        first,
                        last,
                        label,
                        (
                            (
                                "security_uncertain"
                                if SECURITY_HEADING.match(diagnostic_label)
                                else "regular_uncertain"
                            )
                            if uncertain_heading
                            else (
                                "security"
                                if SECURITY_HEADING.match(label)
                                else "regular"
                            )
                        ),
                    )
                )
                if uncertain_heading:
                    # Candidate-only Unicode projection cannot authenticate a
                    # heading. Preserve its physical source and uncertainty.
                    uncertain.add(first)
        if "_review_source" not in token:
            visible = _markdown_text(
                [token],
                block_markers=token.get("type") in ("list", "block_quote", "table"),
            )
            if (
                re.search(r"(?i)\bP[0-3]\b", visible)
                or _unicode_priority_uncertain(visible)
                or SECURITY_MARKER_COMMENT.search(visible)
            ):
                next_start = (
                    tokens[token_index + 1].get("_review_start", len(source))
                    if token_index + 1 < len(tokens)
                    else len(source)
                )
                mapped = mapped_container(token, next_start)
                if mapped is not None:
                    priority = next(
                        (
                            label
                            for _row, _visible, units in mapped
                            for _source_row, label, _marked, _unknown in units
                            if PRIORITY_RESULT.match(label)
                        ),
                        None,
                    )
                    if priority is None:
                        priority = next(
                            (
                                label
                                for _row, _visible, units in mapped
                                for _source_row, label, marked, _unknown in units
                                if marked
                            ),
                            None,
                        )
                    if priority is not None:
                        # A qualified container starts at its original source
                        # row, including a table header preceding the finding.
                        container_boundaries[first] = (
                            priority,
                            tuple(
                                unit
                                for _row, _visible, units in mapped
                                for unit in units
                            ),
                        )
                    for row, label, _units in mapped:
                        if row < count:
                            rows[row] = label
                            container_rows.add(row)
                    continue
                uncertain.add(first)
                if first < count:
                    rows[first] = visible.replace("\n", " ")
            continue
        raw = token["_review_source"]
        visible = _markdown_text(token.get("children", ()))
        raw_lines = _markdown_lines(raw)
        visible_lines = visible.split("\n")
        # CommonMark drops blank physical rows inside a paragraph. Preserve
        # their source offsets instead of treating the following row as earlier.
        offsets = [offset for offset, line in enumerate(raw_lines) if line.strip()]
        if len(offsets) != len(visible_lines):
            if re.search(r"(?i)\bP[0-3]\b", visible) or _unicode_priority_uncertain(
                visible
            ):
                uncertain.add(first)
            continue
        for offset, line in zip(offsets, visible_lines):  # noqa: B905
            if first + offset < count:
                rows[first + offset] = line
    uncertain.update(
        index for index, row in enumerate(rows) if _unicode_priority_uncertain(row)
    )
    return (
        tuple(rows),
        frozenset(uncertain),
        frozenset(container_rows),
        tuple(container_boundaries.items()),
        tuple(heading_nodes),
    )


def _priority_projection(text):
    rows, uncertain, container_rows, container_boundaries, _headings = (
        _markdown_document(text)
    )
    # Only a validated container start can establish a result boundary.
    # Interior diagnostics and unknown maps never become section authority.
    lines = [
        line if index not in uncertain | container_rows else ""
        for index, line in enumerate(rows)
    ]
    for row, (label, _finding_units) in container_boundaries:
        if row not in uncertain:
            lines[row] = label
    return "\n".join(lines) + (" " if lines and not lines[-1] else "")


@lru_cache(maxsize=8)
def _security_details_priority_uncertain(text):
    """Retain uncertainty when visible HTML defeats ordinary row ownership."""
    source = _mask_markdown_link_metadata(_without_inline_code(_actual_metadata(text)))
    opening = re.search(r"<details(?:[ \t\r\n>])", source, re.I)
    if opening is None or not _standalone_security_clean(source[: opening.start()]):
        return False
    if _html_visibility_ambiguous(source):
        return False  # The caller already retains global HTML uncertainty.
    if "![" in source:
        # Inspect original Markdown with its reference definitions before
        # destination masking can turn inert image syntax into a candidate.
        rendered_rows = _markdown_document(text)[0]
        if not any(
            _PRIORITY_CANDIDATE.search(row) or _unicode_priority_uncertain(row)
            for row in rendered_rows
        ):
            return False
    fragment = source[opening.start() :]
    summaries = []
    _visible_html(fragment, mask_attributes=True, visible_summary_ranges=summaries)

    def unowned_priority(raw, visible):
        candidates = [
            row
            for row in _markdown_lines(visible)
            if _PRIORITY_CANDIDATE.search(row) or _unicode_priority_uncertain(row)
        ]
        if not candidates:
            return False
        marker = SECURITY_MARKER_COMMENT.search(raw)
        colocated = bool(
            len(candidates) == 1
            and len(re.findall(r"\[P[0-3]\]", visible, re.I)) == 1
            and INLINE_SECURITY_MARKER.fullmatch(visible.strip())
            and marker is not None
            and not _backslash_escaped(raw, marker.start())
        )
        return not colocated

    body_parts = []
    position = 0
    for start, end in sorted(summaries):
        raw = fragment[start:end]
        visible = _visible_html(
            raw, mask_attributes=True, decode_entities=True, strip_inline_markup=True
        )
        if unowned_priority(raw, visible):
            return True
        body_parts.append(fragment[position:start])
        body_parts.append(re.sub(r"[^\r\n]", " ", raw))
        position = end
    body_parts.append(fragment[position:])
    body = "".join(body_parts)
    visible_body = _visible_html(
        body, mask_attributes=True, decode_entities=True, strip_inline_markup=True
    )
    # Body marker ownership is supported only for a direct physical row;
    # nested elements cannot transfer a marker to another rendered unit.
    direct_body = re.sub(r"\A<details\b[^>]*>", "", body, flags=re.I)
    direct_body = re.sub(r"</details>[ \t\r\n]*\Z", "", direct_body, flags=re.I)
    direct_body = re.sub(
        r"<summary\b[^>]*>[ \t\r\n]*</summary>", "", direct_body, flags=re.I
    )
    raw_body = (
        direct_body if INLINE_SECURITY_MARKER.fullmatch(direct_body.strip()) else ""
    )
    return unowned_priority(raw_body, visible_body)


def _security_priority_uncertain(kind: str, text: str, finding: bool, projection=None):
    source = _mask_markdown_link_metadata(_without_inline_code(_actual_metadata(text)))
    standalone = (
        kind in ("security", "unheaded") and SECURITY_MARKER.search(source) is not None
    )
    if kind != "security" and not SECURITY_MARKER_COMMENT.search(source):
        return False
    if projection is None:
        projection = _priority_projection(text)
    for row in _markdown_lines(projection):
        if _unicode_priority_uncertain(row):
            return True
        if kind != "security" and not standalone:
            marker = SECURITY_MARKER_COMMENT.search(row)
            if marker is None or row[marker.end() :].strip():
                continue
        for match in re.finditer(
            r"\[[ \t*_~]*P[ \t*_~\[]*[0-3](?:[ \t*_~]*\])?", row, re.I
        ):
            if kind != "security" and not standalone and row[: match.start()].strip():
                continue
            if not finding or not PRIORITY_RESULT.match(match.group()):
                return True
    return False


def _security_facts(kind: str, section: str, projection: str = "") -> tuple[bool, bool]:
    raw_section = section
    source = _without_inline_code(_actual_metadata(raw_section))
    report_view = _visible_html(source, mask_attributes=True)
    source = _mask_markdown_link_metadata(source)
    # Raw HTML blocks render emphasis literally. Normalize only Markdown
    # regions and retain offsets used by report links and summary ranges.
    raw_blocks = _html_block_spans(source)
    raw_block_starts = [start for start, _ in raw_blocks]
    raw_block_ends = [end for _, end in raw_blocks]
    visible_summaries: list[tuple[int, int]] = []
    section = _visible_html(
        source,
        mask_attributes=True,
        visible_summary_ranges=visible_summaries,
        markdown_preprocessed=True,
    )
    severity_text = _visible_html(
        source,
        mask_attributes=True,
        markdown_preprocessed=True,
        decode_entities=True,
        raw_html_blocks=raw_blocks,
        strip_inline_markup=True,
    )
    if visible_summaries:
        summary_text = []
        decoded_summaries = []
        for start, end in visible_summaries:
            summary_blocks = [
                (max(block_start, start) - start, min(block_end, end) - start)
                for block_start, block_end in raw_blocks[
                    bisect_right(raw_block_ends, start) : bisect_left(
                        raw_block_starts, end
                    )
                ]
            ]
            summary_html = _visible_html(
                source[start:end],
                mask_attributes=True,
                markdown_preprocessed=True,
            )
            summary_decoded = _visible_html(
                source[start:end],
                mask_attributes=True,
                markdown_preprocessed=True,
                decode_entities=True,
                raw_html_blocks=summary_blocks,
                strip_inline_markup=True,
            )
            summary_text.append(re.sub(r"</?[^>]+>", " ", summary_html))
            decoded_summaries.append(re.sub(r"</?[^>]+>", " ", summary_decoded))
        section = "\n".join((section, *summary_text))
        severity_text = "\n".join((severity_text, *decoded_summaries))
    decoded_text = severity_text
    # Only structured visible labels supply Markdown severity. Raw HTML rows
    # are already included by the separate visibility projection.
    severity_text = projection
    report_link_candidates = list(SECURITY_REPORT_LINK.finditer(report_view))
    marker = bool(INLINE_SECURITY_MARKER.search(section)) or (
        kind in ("security", "unheaded") and bool(SECURITY_MARKER.search(section))
    )
    marker = marker or any(
        SECURITY_MARKER_COMMENT.search(raw_line)
        and INLINE_SECURITY_MARKER.search(decoded_line)
        # Preserve truncation and the ambient Python 3.9 host compatibility.
        for raw_line, decoded_line in zip(  # noqa: B905
            _markdown_lines(section), _markdown_lines(decoded_text)
        )
    )
    marker = marker or (
        bool(SECURITY_MARKER_COMMENT.search(source))
        and bool(INLINE_SECURITY_MARKER.search(projection))
    )
    coordinator_marker = (
        kind == "regular"
        and "retry reason" in section.casefold()
        and bool(SECURITY_MARKER_COMMENT.search(_without_inline_code(section)))
    )
    marker = marker or coordinator_marker
    heading = kind == "security"
    severity = bool(
        SECURITY_SEVERITY.search(severity_text)
        or (heading and re.search(r"(?i)\bP[0-3]\b", severity_text))
    )
    security_text = "\n".join(
        line
        for line in _markdown_lines(severity_text)
        if not SECURITY_MARKER.fullmatch(line)
    )
    unheaded_security = (
        bool(COORDINATOR_PRELUDE.match(section))
        and bool(re.search(r"(?i)\bP[0-3]\b", security_text))
        and bool(
            re.search(r"(?i)\bsecurity\b|\bvulnerab\w*|\bexploitable\b", security_text)
        )
    )
    report_link = any(
        section[match.start() : match.end() - 1].casefold()
        == "[view security finding report]"
        for match in report_link_candidates
    )
    clean_claim = (
        _standalone_security_clean(raw_section) and not severity and not marker
    )
    finding = (
        marker
        or unheaded_security
        or (heading and severity)
        or (heading and report_link and not clean_claim)
    )
    event = finding or (heading and (report_link or clean_claim))
    return event, finding


def _html_visibility_ambiguous(body: str) -> bool:
    """Accept only balanced, explicit HTML whose visibility needs no tree repair.

    This is an uncertainty boundary, not another HTML tree builder. Unsupported
    elements, attributes, malformed tokens and formatting reconstruction cannot
    authorize a clean verdict through the visibility approximation below.
    """
    scan = _mask_escaped_container_tags(
        _mask_markdown_link_metadata(_without_inline_code(_actual_metadata(body)))
    )
    # CommonMark URI/email autolinks are text, not raw HTML elements.
    scan = re.sub(
        r"<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*|"
        r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+)>",
        lambda match: _mask_code_line(match.group()),
        scan,
    )
    safe = frozenset(
        "div span details summary pre code a b strong em i u s sub sup br hr".split()
    )
    formatting = frozenset("a b strong em i u s".split())
    blocks = frozenset("div details summary pre hr".split())
    void = frozenset({"br", "hr"})
    offsets = [0] + [match.end() for match in re.finditer("\n", scan)]

    class ExplicitHTML(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=False)
            self.stack: list[str] = []
            self.active: set[str] = set()
            self.ambiguous = False

        def handle_starttag(self, tag, attrs):
            raw = self.get_starttag_text()
            if (
                tag not in safe
                or not re.match(r"<[A-Za-z][A-Za-z0-9-]*(?=[ \t\r\n\v\f/>])", raw)
                or re.search(r"[\v\f\x1c-\x1e\x85\u2028\u2029]", raw)
                or any(name != "open" or tag != "details" for name, _ in attrs)
                or len(attrs) > 1
                or tag in self.active
                or (tag in blocks and self.active)
            ):
                self.ambiguous = True
            if tag not in void:
                self.stack.append(tag)
                if tag in formatting:
                    self.active.add(tag)

        def handle_startendtag(self, tag, attrs):
            self.handle_starttag(tag, attrs)
            if tag not in void:
                # HTML ignores the self-closing flag on ordinary elements.
                self.ambiguous = True

        def handle_comment(self, data):
            # HTMLParser accepts legacy malformed comments that GFM can render
            # literally. Only the standard lexical form belongs to this subset.
            line, column = self.getpos()
            start = offsets[line - 1] + column
            raw = "<!--" + data + "-->"
            if (
                scan[start : start + len(raw)] != raw
                or data.startswith((">", "->"))
                or data.endswith("-")
                or "--" in data
            ):
                self.ambiguous = True

        def handle_decl(self, decl):
            self.ambiguous = True

        def unknown_decl(self, data):
            self.ambiguous = True

        def handle_pi(self, data):
            self.ambiguous = True

        def handle_endtag(self, tag):
            line, column = self.getpos()
            start = offsets[line - 1] + column
            end = scan.find(">", start)
            raw = scan[start : end + 1] if end >= 0 else ""
            if (
                not re.fullmatch(r"</[A-Za-z][A-Za-z0-9-]*[ \t\r\n]*>", raw)
                or not self.stack
                or self.stack[-1] != tag
            ):
                self.ambiguous = True
                return
            self.stack.pop()
            self.active.discard(tag)

    parser = ExplicitHTML()
    try:
        parser.feed(scan)
        parser.close()
    except (ValueError, AssertionError):  # fmt: skip
        return True
    return parser.ambiguous or bool(parser.stack)


def classify_body(body: str) -> dict[str, Any]:
    if len(body) > 262144:
        raise MarkdownBoundaryError("Markdown input budget exceeded")
    _markdown_packages()
    with _MarkdownDeadline():
        return _classify_body(body)


def _classify_body(body: str) -> dict[str, Any]:
    # Connector activity summaries are display metadata, never verdicts. Match
    # the anchored protocol marker, not a quoted marker in review prose.
    if re.match(r"\A\s*<!--\s*codex-pull-request-review-summary\s*-->", body, re.I):
        return {
            "request_head": None,
            "sections": [
                {
                    "kind": "unheaded",
                    "body": body,
                    "has_result": False,
                    "regular_clean": False,
                    "availability": False,
                    "regular_adverse": False,
                    "security_event": False,
                    "security_finding": False,
                    "target_ref": "__unbound__",
                }
            ],
        }
    ambiguous = _html_visibility_ambiguous(body)
    metadata = _without_inline_code(_actual_metadata(body))
    parsed_body, request_head = _coordinator_body(body)
    spans = _section_spans(parsed_body, coordinator_bound=request_head is not None)
    raw_sections = [(kind, text) for kind, text, _, _ in spans]
    markdown_rows, markdown_unknown, _container_rows, _boundaries, _headings = (
        _markdown_document(parsed_body)
    )
    # Coordinator request metadata already supplies an authenticated fallback;
    # a trailing footer is shared only for ordinary comments split by markers.
    shared_footer_ref = (
        _shared_footer_ref(raw_sections) if request_head is None else None
    )

    sections: list[dict[str, Any]] = []
    for section_index, (kind, text) in enumerate(raw_sections):
        raw_kind = kind
        regular_heading = kind == "regular"
        security_heading = kind == "security"
        availability = bool(
            AVAILABILITY.fullmatch(
                _without_review_metadata(_without_known_review_footer(text))
            )
        ) and not bool(SECURITY_REPORT_LINK.search(text))
        clean = _standalone_regular_clean(text)
        ordinary_source = _without_heading(
            kind, _without_review_metadata(_without_known_review_footer(text))
        )
        ordinary_source = _mask_markdown_link_metadata(
            _without_inline_code(_actual_metadata(ordinary_source))
        )
        ordinary_text = _visible_html(
            ordinary_source,
            mask_attributes=True,
            markdown_preprocessed=True,
            decode_entities=True,
            strip_inline_markup=True,
        )
        ordinary_text = _without_known_review_footer(ordinary_text)
        ordinary_text = _without_review_metadata(ordinary_text)
        ordinary_text = "\n".join(
            line
            for line in _markdown_lines(ordinary_text)
            if not INLINE_SECURITY_MARKER.search(line)
            and not SECURITY_MARKER.fullmatch(line)
        )
        _, _, first_row, last_row = spans[section_index]
        projection = "\n".join(markdown_rows[first_row:last_row])
        mapped_units = [
            unit
            for start, (_label, units) in _boundaries
            if first_row <= start < last_row
            for unit in units
        ]
        mapped_security = any(
            marked or unknown for _row, _label, marked, unknown in mapped_units
        )
        mapped_ordinary = any(
            not marked for _row, _label, marked, _unknown in mapped_units
        )
        mapped_unknown = any(unknown for _row, _label, _marked, unknown in mapped_units)
        prefix_adverse = kind == "unheaded" and bool(
            EXPLICIT_ADVERSE.search(ordinary_text)
            or mapped_ordinary
            or any(PRIORITY_RESULT.match(line) for line in _markdown_lines(projection))
        )
        security_event, security_finding = _security_facts(kind, text, projection)
        security_event |= mapped_security
        security_finding |= mapped_security
        priority_uncertain = _security_priority_uncertain(
            kind, text, security_finding, projection
        )
        if kind == "security" and not mapped_ordinary:
            priority_uncertain |= _security_details_priority_uncertain(text)
        structured_unknown = mapped_unknown or any(
            first_row <= row < last_row for row in markdown_unknown
        )
        uncertain_security_heading = any(
            first_row <= first < last_row and heading_kind == "security_uncertain"
            for first, _last, _label, heading_kind in _headings
        )
        adverse_regular = bool(
            prefix_adverse
            or (
                regular_heading
                and ordinary_text.strip()
                and (
                    bool(EXPLICIT_ADVERSE.search(ordinary_text))
                    or (not availability and not clean)
                )
            )
        )
        adverse_regular |= kind != "security" and mapped_ordinary
        has_result = (
            regular_heading
            or security_heading
            or security_event
            or security_finding
            or prefix_adverse
        )
        if security_event and not adverse_regular and not ordinary_text.strip():
            kind = "security"
        sections.append(
            {
                "kind": kind,
                "body": text,
                "has_result": has_result,
                "regular_clean": regular_heading
                and clean
                and not (ambiguous or priority_uncertain or structured_unknown),
                "availability": availability,
                "regular_adverse": adverse_regular,
                "security_event": security_event,
                "security_finding": security_finding,
                "target_ref": _target_ref(
                    text,
                    (
                        request_head
                        if raw_kind != "unheaded"
                        or section_index > 0
                        or len(raw_sections) == 1
                        or (section_index == 0 and PRIORITY_RESULT.match(text))
                        else None
                    )
                    or shared_footer_ref,
                ),
            }
        )
        if priority_uncertain or structured_unknown:
            sections[-1]["parser_ambiguous"] = True
            sections[-1]["security_uncertain"] = priority_uncertain or (
                structured_unknown
                and (
                    kind == "security"
                    or security_event
                    or uncertain_security_heading
                    or (
                        kind == "unheaded"
                        and SECURITY_MARKER_COMMENT.search(
                            _without_inline_code(_actual_metadata(text))
                        )
                        is not None
                    )
                )
            )
    if ambiguous:
        # Visibility repair can hide the protocol marker or category from the
        # rendered section classifier. Retain only uncertainty, never a finding
        # assertion, from raw metadata outside Markdown code.
        security_origin = bool(SECURITY_MARKER_COMMENT.search(metadata)) or bool(
            re.search(r"\b(?:codex[ \t-]+)?security[ \t-]+review\b", metadata, re.I)
        )
        for section in sections:
            section["parser_ambiguous"] = True
            section["security_uncertain"] = security_origin or section.get(
                "security_uncertain", False
            )
    return {"request_head": request_head, "sections": sections}


def classify_event(event: dict[str, Any]) -> dict[str, Any]:
    _markdown_packages()
    with _MarkdownDeadline():
        return _classify_event(event)


def _classify_event(event: dict[str, Any]) -> dict[str, Any]:
    action = event.get("action", "")
    comment = event.get("comment") or {}
    current = classify_body(comment.get("body") or "")
    if action == "edited":
        previous_body = ((event.get("changes") or {}).get("body") or {}).get(
            "from"
        ) or ""
    elif action == "deleted":
        previous_body = comment.get("body") or ""
    else:
        previous_body = ""
    previous = (
        classify_body(previous_body)
        if previous_body
        else {"request_head": None, "sections": []}
    )
    return {"action": action, "current": current, "previous": previous}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "event", nargs="?", type=Path, help="GitHub issue-comment event JSON"
    )
    parser.add_argument(
        "--records", action="store_true", help="Annotate live API records from stdin"
    )
    args = parser.parse_args()
    try:
        if args.records:

            def annotate(value):
                if isinstance(value, list):
                    return [annotate(item) for item in value]
                if isinstance(value, dict):
                    result = {key: annotate(item) for key, item in value.items()}
                    if isinstance(value.get("body"), str):
                        result["review_gate_sections"] = classify_body(value["body"])[
                            "sections"
                        ]
                        result["review_gate_prefix_known"] = all(
                            section["kind"] != "unheaded"
                            or section["has_result"]
                            or section["availability"]
                            for section in result["review_gate_sections"]
                        )
                    return result
                return value

            data = sys.stdin.read()
            decoder = json.JSONDecoder()
            while data.strip():
                data = data.lstrip()
                value, end = decoder.raw_decode(data)
                print(json.dumps(annotate(value), separators=(",", ":")))
                data = data[end:]
            return 0
        if args.event is None:
            parser.error("an event path or --records is required")
        event = json.loads(args.event.read_text(encoding="utf-8"))
        print(json.dumps(classify_event(event), separators=(",", ":")))
    except (OSError, ValueError, TypeError, ImportError) as exc:
        print(f"Could not classify review event sections: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
