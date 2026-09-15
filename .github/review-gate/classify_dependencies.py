#!/usr/bin/env python3
"""Classify the complete candidate diff, without checking out or executing it.

Exit 0 with a content digest for dependency-only changes, 3 for ordinary review,
or 1 when GitHub cannot provide a complete, stable comparison.
"""

import base64
import configparser
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import PurePosixPath
from urllib.parse import quote, urlparse

INVALID_LOCK = (ValueError, TypeError, KeyError)
INVALID_JSON = (ValueError, TypeError)
INVALID_STRUCTURE = (ValueError, TypeError, KeyError, AttributeError)

LOCKS = {
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "Cargo.lock",
    "poetry.lock",
    "uv.lock",
    "Pipfile.lock",
    "Gemfile.lock",
    "Podfile.lock",
    "Package.resolved",
    "composer.lock",
    "packages.lock.json",
    "gradle.lockfile",
    "pubspec.lock",
}
JSON_FIELDS = {
    "package.json": [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
        "peerDependenciesMeta",
        "overrides",
        "resolutions",
    ],
    "manifest.json": ["requirements"],
    "composer.json": ["require", "require-dev"],
}
SHA = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
STABLE_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")


def swift_package_resolved_change(
    before_blob, after_blob, *, allow_origin_hash_change=False
):
    """Validate a conservative Package.resolved v3 pin update."""
    try:
        before = json.loads(before_blob) if isinstance(before_blob, str) else None
        after = json.loads(after_blob) if isinstance(after_blob, str) else None
    except INVALID_JSON:
        return False
    if not isinstance(before, dict) or not isinstance(after, dict) or before == after:
        return False
    if (
        set(before) != {"version", "originHash", "pins"}
        or set(after) != set(before)
        or before.get("version") != 3
        or after.get("version") != 3
        or not isinstance(before.get("originHash"), str)
        or not isinstance(after.get("originHash"), str)
        or not SHA256.fullmatch(before.get("originHash", ""))
        or not SHA256.fullmatch(after.get("originHash", ""))
        or (
            before["originHash"] != after["originHash"] and not allow_origin_hash_change
        )
    ):
        return False

    def pin_key(pin):
        if not isinstance(pin, dict) or set(pin) != {
            "identity",
            "kind",
            "location",
            "state",
        }:
            return None
        if (
            not isinstance(pin["identity"], str)
            or not pin["identity"]
            or pin["kind"] != "remoteSourceControl"
            or not isinstance(pin["location"], str)
        ):
            return None
        try:
            parsed = urlparse(pin["location"])
            port = parsed.port
        except ValueError:
            return None
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or port is not None
            or parsed.query
            or parsed.fragment
            or parsed.params
            or not parsed.path
        ):
            return None
        # SwiftPM derives source-control identity from the final URL component,
        # removing the .git suffix and folding case. A differently named pin
        # does not lock this manifest dependency.
        expected_identity = (
            parsed.path.rstrip("/").rsplit("/", 1)[-1].removesuffix(".git").lower()
        )
        if not expected_identity or pin["identity"].lower() != expected_identity:
            return None
        state = pin["state"]
        if (
            not isinstance(state, dict)
            or set(state) != {"revision", "version"}
            or not isinstance(state.get("revision"), str)
            or not isinstance(state.get("version"), str)
            or not SHA.fullmatch(state.get("revision", ""))
            or not STABLE_VERSION.fullmatch(state.get("version", ""))
        ):
            return None
        return pin["identity"].lower()

    old_pins, new_pins = before.get("pins"), after.get("pins")
    if not isinstance(old_pins, list) or not isinstance(new_pins, list):
        return False
    old = {pin_key(pin): pin for pin in old_pins}
    new = {pin_key(pin): pin for pin in new_pins}
    if (
        None in old
        or None in new
        or len(old) != len(old_pins)
        or len(new) != len(new_pins)
        or (old.keys() - new.keys() and new.keys() - old.keys())
    ):
        return False
    for key in set(old) & set(new):
        if (old[key]["kind"], old[key]["location"]) != (
            new[key]["kind"],
            new[key]["location"],
        ):
            return False
        old_state, new_state = old[key]["state"], new[key]["state"]
        if (
            old_state["version"] == new_state["version"]
            and old_state["revision"] != new_state["revision"]
        ):
            return False
        if (
            old_state["version"] != new_state["version"]
            and old_state["revision"] == new_state["revision"]
        ):
            return False
    return True


def swift_lock_matches_manifest(
    lock_text, manifest_text, manifest_name, include_locations=False
):
    """Bind direct registry pins to supported literal Swift/Xcode requirements."""
    try:
        pins = json.loads(lock_text)["pins"]

        def location(value):
            return value.rstrip("/").removesuffix(".git")

        locked = {location(pin["location"]): pin["state"]["version"] for pin in pins}
        if len(locked) != len(pins):
            return False
        requirements = []
        if manifest_name == "project.pbxproj":
            section = re.search(
                r"/\* Begin XCRemoteSwiftPackageReference section \*/(.*?)/"
                r"\* End XCRemoteSwiftPackageReference section \*/",
                manifest_text,
                re.S,
            )
            if not section:
                return False
            entry = re.compile(
                r'\s*[0-9A-Fa-f]+ /\* XCRemoteSwiftPackageReference "[^"]+" '
                r"\*/ = \{\s*isa = XCRemoteSwiftPackageReference;\s*reposito"
                r'ryURL = "([^"]+)";\s*requirement = \{([^{}]+)\};\s*\};',
                re.S,
            )
            position = 0
            while section[1][position:].strip():
                match = entry.match(section[1], position)
                if not match:
                    return False
                attrs = {}
                for assignment in match[2].split(";"):
                    if not assignment.strip():
                        continue
                    field = re.fullmatch(
                        r'\s*(kind|minimumVersion|version)\s*=\s*"?([A-Za-z0-9.]+)"?'
                        r"\s*",
                        assignment,
                    )
                    if not field or field[1] in attrs:
                        return False
                    attrs[field[1]] = field[2]
                kind = attrs.get("kind")
                key = "version" if kind == "exactVersion" else "minimumVersion"
                if kind not in {
                    "exactVersion",
                    "upToNextMajorVersion",
                    "upToNextMinorVersion",
                } or set(attrs) != {"kind", key}:
                    return False
                requirements.append((match[1], kind, attrs[key]))
                position = match.end()
        else:
            pattern = re.compile(
                r'\.package\(\s*url:\s*"([^"]+)"\s*,\s*(from|exact):\s*"([0-'
                r'9.]+)"\s*\)',
                re.S,
            )
            matches = list(pattern.finditer(manifest_text))
            if len(matches) != len(re.findall(r"\.package\s*\(", manifest_text)):
                return False
            requirements = [
                (
                    m[1],
                    "exactVersion" if m[2] == "exact" else "upToNextMajorVersion",
                    m[3],
                )
                for m in matches
            ]
        if not requirements:
            if pins:
                return False
            return set() if include_locations else True
        if len({location(url) for url, _, _ in requirements}) != len(requirements):
            return False
        for url, kind, minimum in requirements:
            value = locked.get(location(url))
            if (
                not value
                or not STABLE_VERSION.fullmatch(minimum)
                or not STABLE_VERSION.fullmatch(value)
            ):
                return False
            actual, lower = (
                tuple(map(int, value.split("."))),
                tuple(map(int, minimum.split("."))),
            )
            if kind == "exactVersion":
                if actual != lower:
                    return False
            else:
                upper = (
                    (lower[0] + 1, 0, 0)
                    if kind == "upToNextMajorVersion"
                    else (lower[0], lower[1] + 1, 0)
                )
                if not lower <= actual < upper:
                    return False
        return (
            {location(url) for url, _, _ in requirements} if include_locations else True
        )
    except INVALID_STRUCTURE:
        return False


def gemfile_lock_matches_manifest(lock_text, manifest):
    """Recognize literal Gemfile declarations without executing Ruby."""

    def constraint(value):
        terms = []
        for term in value.split(","):
            term = term.strip()
            if not term:
                continue
            if re.match(r"[0-9]", term):
                term = "=" + term
            terms.append(re.sub(r"\s+", "", term))
        return sorted(terms)

    try:
        declarations = {}
        source = False
        for line in manifest.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if re.fullmatch(r"source [\'\"]https://rubygems.org/?[\'\"]", line):
                if source:
                    return False
                source = True
                continue
            match = re.fullmatch(
                r"gem [\'\"]([A-Za-z0-9_.-]+)[\'\"](?:,\s*[\'\"]([^\'\"]+)["
                r"\'\"]|,\s*git:\s*[\'\"]([^\'\"]+)[\'\"],\s*ref:\s*[\'\"](["
                r"0-9a-f]{40})[\'\"])?",
                line,
            )
            if not match or match[1] in declarations:
                return False
            declarations[match[1]] = (constraint(match[2] or ""), match[3], match[4])
        if not source or not declarations:
            return False
        section = re.search(
            r"^DEPENDENCIES\n(.*?)(?=^[A-Z]|\Z)", lock_text, re.S | re.M
        )
        if not section:
            return False
        roots = {}
        for line in section[1].splitlines():
            if not line.strip():
                continue
            match = re.fullmatch(r"  ([A-Za-z0-9_.-]+)(?: \(([^()]+)\))?(!)?", line)
            if not match or match[1] in roots:
                return False
            roots[match[1]] = (constraint(match[2] or ""), bool(match[3]))
        if set(roots) != set(declarations):
            return False
        git_sources = {}
        for section in re.finditer(r"^GIT\n(.*?)(?=^[A-Z]|\Z)", lock_text, re.S | re.M):
            remote = re.search(r"^  remote: (\S+)$", section[1], re.M)
            revision = re.search(r"^  revision: ([0-9a-f]{40})$", section[1], re.M)
            if not remote or not revision:
                return False
            for name in re.findall(r"^    ([A-Za-z0-9_.-]+) \(", section[1], re.M):
                git_sources[name] = (remote[1], revision[1])
        for name, (required, url, revision) in declarations.items():
            if roots[name] != (required, url is not None):
                return False
            if url is not None and git_sources.get(name) != (url, revision):
                return False
        return True
    except INVALID_STRUCTURE:
        return False


def gemfile_lock_update(before, after):
    """Registry version changes with validated reachable graph and fixed sources."""
    numeric = r"[0-9]+(?:\.[0-9]+)*"
    platform = (
        r"(?:-(?:arm64|aarch64|x86_64|x86|universal|java|jruby|mingw|"
        r"mswin|ruby|darwin|linux|freebsd|solaris|cygwin|windows)"
        r"(?:[-_.][A-Za-z0-9]+)*)?"
    )
    gem_version = numeric + platform
    name = r"[A-Za-z0-9_][A-Za-z0-9_.-]*"

    def version(raw):
        if not re.fullmatch(numeric, raw):
            raise ValueError("unsupported gem version")
        return tuple(map(int, raw.split(".")))

    def compare(a, b):
        size = max(len(a), len(b))
        a, b = a + (0,) * (size - len(a)), b + (0,) * (size - len(b))
        return (a > b) - (a < b)

    def requirements(raw):
        if not raw:
            return []
        found = []
        for term in raw.split(","):
            sentinel = re.fullmatch(r"\s*(<|>=)\s*(" + numeric + r")\.a\s*", term)
            if sentinel:
                found.append((sentinel[1], version(sentinel[2])))
                continue
            match = re.fullmatch(
                r"\s*(~>|>=|<=|!=|=|>|<)?\s*(" + numeric + r")\s*", term
            )
            if not match:
                raise ValueError("unsupported gem constraint")
            found.append((match[1] or "=", version(match[2])))
        return found

    def satisfies(value, constraint):
        match = re.fullmatch(gem_version, value)
        if not match:
            raise ValueError("unsupported gem version")
        v = tuple(map(int, match.group(0).split("-", 1)[0].split(".")))
        for op, wanted in requirements(constraint):
            cmp = compare(v, wanted)
            if op == "~>":
                prefix = wanted[:-1] if len(wanted) > 1 else wanted
                upper = (*prefix[:-1], prefix[-1] + 1)
                if cmp < 0 or compare(v, upper) >= 0:
                    return False
            elif not {
                "=": cmp == 0,
                "!=": cmp != 0,
                ">": cmp > 0,
                "<": cmp < 0,
                ">=": cmp >= 0,
                "<=": cmp <= 0,
            }[op]:
                return False
        return True

    def parse(text):
        if not isinstance(text, str):
            raise ValueError("invalid lock text")
        sections = []
        for line in text.splitlines():
            if not line:
                continue
            if not line.startswith(" "):
                if line not in {
                    "GEM",
                    "GIT",
                    "PLATFORMS",
                    "DEPENDENCIES",
                    "BUNDLED WITH",
                }:
                    raise ValueError("unsupported lock section")
                sections.append((line, []))
            elif not sections:
                raise ValueError("missing section")
            else:
                sections[-1][1].append(line)
        for single in ("GEM", "PLATFORMS", "DEPENDENCIES", "BUNDLED WITH"):
            if sum(kind == single for kind, _ in sections) != 1:
                raise ValueError("duplicate or missing section")
        records = {}
        edges = []
        graph = {}
        roots = set()
        metadata = []
        for kind, lines in sections:
            if kind != "GEM":
                metadata.append((kind, lines))
            if kind not in {"GEM", "GIT"}:
                continue
            marker = lines.index("  specs:")
            fields = {}
            for line in lines[:marker]:
                match = re.fullmatch(r"  (remote|revision|ref): (\S+)", line)
                if not match or match[1] in fields:
                    raise ValueError("unsupported source metadata")
                fields[match[1]] = match[2]
            if kind == "GEM":
                if fields != {"remote": "https://rubygems.org/"}:
                    raise ValueError("unsupported gem source")
            else:
                if set(fields) not in (
                    {"remote", "revision"},
                    {"remote", "revision", "ref"},
                ):
                    raise ValueError("unsupported git metadata")
                parsed = urlparse(fields["remote"])
                if (
                    parsed.scheme != "https"
                    or not parsed.hostname
                    or parsed.username is not None
                    or parsed.password is not None
                    or parsed.port is not None
                    or not parsed.path
                    or parsed.query
                    or parsed.fragment
                    or parsed.params
                ):
                    raise ValueError("unsupported git source")
                if any(
                    not re.fullmatch("[0-9a-f]{40}", fields[key])
                    for key in fields
                    if key != "remote"
                ):
                    raise ValueError("mutable git revision")
            if kind == "GEM":
                metadata.append((kind, lines[: marker + 1]))
            current = None
            for line in lines[marker + 1 :]:
                spec = re.fullmatch(
                    r"    (" + name + r") \((" + gem_version + r")\)", line
                )
                if spec:
                    current = spec[1]
                    if current in records:
                        raise ValueError("duplicate package")
                    records[current] = (spec[2], kind)
                    graph[current] = {}
                    continue
                dep = re.fullmatch(r"      (" + name + r")(?: \(([^()]+)\))?", line)
                if not dep or current is None:
                    raise ValueError("unsupported gem spec")
                requirements(dep[2] or "")
                if dep[1] in graph[current]:
                    raise ValueError("duplicate dependency edge")
                graph[current][dep[1]] = dep[2] or ""
                edges.append((dep[1], dep[2] or ""))
        for kind, lines in sections:
            if kind == "PLATFORMS":
                if not lines or any(
                    not re.fullmatch(r"  [A-Za-z0-9_.-]+", line) for line in lines
                ):
                    raise ValueError("invalid platforms")
            elif kind == "BUNDLED WITH":
                if len(lines) != 1 or not lines[0].startswith("  "):
                    raise ValueError("invalid bundler")
                bundled = lines[0].strip()
                version(bundled)
            elif kind == "DEPENDENCIES":
                seen = set()
                for line in lines:
                    dep = re.fullmatch(r"  (" + name + r")(?: \(([^()]+)\))?(!)?", line)
                    if not dep or dep[1] in seen or dep[1] not in records:
                        raise ValueError("invalid direct dependency")
                    seen.add(dep[1])
                    roots.add(dep[1])
                    requirements(dep[2] or "")
                    if bool(dep[3]) != (records[dep[1]][1] == "GIT"):
                        raise ValueError("changed source binding")
                    edges.append((dep[1], dep[2] or ""))
        for dep, constraint in edges:
            target = bundled if dep == "bundler" else records.get(dep, (None, None))[0]
            if target is None or not satisfies(target, constraint):
                raise ValueError("unresolved gem requirement")
        reachable, pending = set(), list(roots)
        while pending:
            key = pending.pop()
            if key in reachable or key == "bundler":
                continue
            reachable.add(key)
            pending.extend(graph[key])
        if set(records) != reachable:
            raise ValueError("unreachable gem record")
        return records, graph, metadata

    try:
        if before == after:
            return False
        old_records, old_graph, old_metadata = parse(before)
        new_records, new_graph, new_metadata = parse(after)
        if old_metadata != new_metadata:
            return False
        changed_version = False
        for key in old_records.keys() & new_records.keys():
            old_version, old_source = old_records[key]
            new_version, new_source = new_records[key]
            if old_source != new_source:
                return False
            old_platform = re.fullmatch(gem_version, old_version).group(0).split(
                "-", 1
            )[1:]  # Preserve native gem platform identity across updates.
            new_platform = re.fullmatch(gem_version, new_version).group(0).split(
                "-", 1
            )[1:]
            if old_platform != new_platform:
                return False
            if old_version == new_version:
                if old_graph[key] != new_graph[key]:
                    return False
            else:
                if old_source != "GEM":
                    return False
                changed_version = True
        # Graph churn must be justified by a changed registry package; root
        # requirements and every Git section remain identical above.
        return changed_version
    except INVALID_STRUCTURE:
        return False


def toml_loader():
    try:
        import tomllib

        return tomllib.loads
    except ImportError:
        for module in ("tomli", "pip._vendor.tomli"):
            try:
                imported = __import__(module, fromlist=["loads"])
                return imported.loads
            except ImportError:
                pass
    return None


def only_fields(before, after, fields):
    """At least one dependency field changes and every other field is identical."""
    if not isinstance(before, dict) or not isinstance(after, dict) or before == after:
        return False
    old, new = copy.deepcopy(before), copy.deepcopy(after)
    for field in fields:
        old.pop(field, None)
        new.pop(field, None)
    return old == new


def package_constraints(before, after, fields):
    if not only_fields(before, after, fields):
        return False

    def flattened(data):
        result = {}
        for field in fields:
            value = data.get(field, {})
            if field in ("overrides", "resolutions"):
                for path in nested_constraint_paths(value, (field,)):
                    node = value
                    for part in path[1:]:
                        node = node[part]
                    result[path] = node
            elif isinstance(value, dict):
                for name, item in value.items():
                    result[(field, name)] = item
        return result

    old_flat, new_flat = flattened(before), flattened(after)
    removed, added = set(old_flat) - set(new_flat), set(new_flat) - set(old_flat)
    if removed and added:
        return False
    for field in fields:
        old_values, new_values = before.get(field, {}), after.get(field, {})
        if old_values == new_values:
            continue
        if field == "peerDependenciesMeta":
            return False
        if not isinstance(old_values, dict) or not isinstance(new_values, dict):
            return False
        removed_names = set(old_values) - set(new_values)
        added_names = set(new_values) - set(old_values)
        if removed_names and added_names:
            return False
        if field in ("overrides", "resolutions"):
            old_paths = {
                path
                for name, value in old_values.items()
                for path in nested_constraint_paths(value, (name,))
            }
            new_paths = {
                path
                for name, value in new_values.items()
                for path in nested_constraint_paths(value, (name,))
            }
            if old_paths - new_paths and new_paths - old_paths:
                return False
        for name in set(old_values) | set(new_values):
            old, new = old_values.get(name), new_values.get(name)
            if old == new or name not in new_values:
                continue
            if old is None and isinstance(new, str):
                old = new
            if field in ("overrides", "resolutions"):
                if old is None:
                    old = {}
                if (
                    not valid_nested_constraints(old)
                    or not valid_nested_constraints(new)
                    or not nested_identity_preserved(old, new)
                ):
                    return False
            elif field == "peerDependenciesMeta":
                if old is None:
                    old = {}
                if not valid_peer_metadata(old) or not valid_peer_metadata(new):
                    return False
                # Peer optionality is install/validation behavior, not a
                # version selector. It must remain byte-for-byte stable,
                # including additions and removals.
                if old != new:
                    return False
            elif not valid_manifest_npm_constraint(
                old
            ) or not valid_manifest_npm_constraint(new):
                return False
    return True


NPM_VERSION = r"[0-9]+(?:\.[0-9xX*]+){0,2}"
NPM_COMPARATOR = rf"(?:~|\^|<=|>=|<|>|=)?\s*{NPM_VERSION}"


def valid_npm_constraint(value):
    if isinstance(value, str) and re.search(r"(?<![0-9A-Za-z])0[0-9]+", value):
        return False
    if not isinstance(value, str):
        return False
    value = value.strip()
    if value == "*":
        return True
    for branch in value.split("||"):
        branch = branch.strip()
        if not branch:
            return False
        if re.fullmatch(rf"{NPM_VERSION}\s+-\s+{NPM_VERSION}", branch):
            continue
        if not re.fullmatch(rf"{NPM_COMPARATOR}(?:\s+{NPM_COMPARATOR})*", branch):
            return False
    return True


def valid_manifest_npm_constraint(value):
    """Manifest selectors must not float to an arbitrary registry version."""
    return (
        isinstance(value, str) and value.strip() != "*" and valid_npm_constraint(value)
    )


def valid_nested_constraints(value):
    if isinstance(value, str):
        # An override/resolution wildcard floats a transitive package to an
        # arbitrary registry release and cannot receive the exemption.
        return value.strip() != "*" and valid_npm_constraint(value)
    if isinstance(value, dict):
        return all(valid_nested_constraints(item) for item in value.values())
    return False


def nested_identity_preserved(before, after):
    if isinstance(before, str) and isinstance(after, str):
        return True
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    removed, added = set(before) - set(after), set(after) - set(before)
    if removed and added:
        return False
    return all(
        nested_identity_preserved(before[name], after[name])
        for name in set(before) & set(after)
    )


def nested_constraint_paths(value, prefix=()):
    if isinstance(value, str):
        return {prefix}
    if isinstance(value, dict):
        paths = set()
        for name, child in value.items():
            paths |= nested_constraint_paths(child, (*prefix, name))
        return paths
    return set()


def valid_peer_metadata(value):
    if not isinstance(value, dict):
        return False
    if set(value) <= {"optional"}:
        return isinstance(value.get("optional", True), bool)
    return isinstance(value, dict) and all(
        isinstance(options, dict)
        and set(options) <= {"optional"}
        and isinstance(options.get("optional", True), bool)
        for options in value.values()
    )


def stable_version(value):
    return isinstance(value, str) and not re.search(
        r"[+*\[\]()${}]|\blatest\b|(?:^|[-.])(alpha|be"
        r"ta|rc|dev|snapshot|canary|preview|eap|m[0-9])",
        value,
        re.I,
    )


def valid_requirement(value):
    if not isinstance(value, str) or any(
        token in value.lower() for token in ("://", "git+", "file:", "path:", " @ ")
    ):
        return False
    # Requirements with mutable or prerelease selectors stay under regular
    # review; a dependency-only exemption may only carry stable registry data.
    if re.search(r"(?:\*|alpha|beta|rc|dev|snapshot|canary|preview|eap)", value, re.I):
        return False
    match = re.fullmatch(
        r"[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?"
        r"(?:\s*(?:===\s*[^;#\s][^;#]*|(?:==|~=|"
        r"!=|<=|>=|<|>|\^|~)\s*[0-9xX*][^;#]*))?"
        r"(?:\s*;[^#]+)?",
        value.strip(),
    )
    if not match:
        return False
    marker = re.search(r"\s*;\s*(.+)$", value.strip())
    if marker:
        # Environment markers must be syntactically valid and immutable. The
        # exemption permits version changes while preserving install scope.
        try:
            from packaging.markers import Marker

            Marker(marker.group(1))
        except Exception:
            return False
    return True


def valid_requirement_line(value):
    if not isinstance(value, str):
        return False
    stripped = value.strip()
    if stripped.startswith("--hash="):
        return bool(
            re.fullmatch(
                r"--hash=sha256:[0-9a-fA-F]{64}|--hash=sha384:["
                r"0-9a-fA-F]{96}|--hash=sha512:[0-9a-fA-F]{128}",
                stripped,
            )
        )
    return valid_requirement(stripped)


def requirement_marker(value):
    if not isinstance(value, str) or ";" not in value:
        return None
    return value.split(";", 1)[1].strip()


def requirement_has_selector(value):
    return bool(
        re.search(
            r"(?:===|==|~=|!=|<=|>=|<|>|\^|~)\s*[^;#\s]",
            value.split(";", 1)[0],
        )
    )


def requirement_markers_preserved(before, after):
    def grouped(values):
        result = {}
        for value in values:
            name = re.split(r"[<>=!~; @]", value, maxsplit=1)[0].strip().lower()
            result.setdefault(name, []).append(requirement_marker(value))
        return result

    old_markers, new_markers = grouped(before), grouped(after)
    shared = old_markers.keys() & new_markers.keys()
    return all(
        sorted(old_markers[name], key=lambda item: item or "")
        == sorted(new_markers[name], key=lambda item: item or "")
        for name in shared
    )


def dependency_map_constraints(before, after):
    if not isinstance(before, dict) or not isinstance(after, dict) or before == after:
        return False
    removed, added = set(before) - set(after), set(after) - set(before)
    if removed and added:
        return False
    for name, value in after.items():
        if name in before and before[name] == value:
            continue
        if not valid_requirement(value):
            return False
        if name in before and requirement_marker(before[name]) != requirement_marker(
            value
        ):
            return False
    return True


def valid_composer_constraint(value):
    return (
        isinstance(value, str)
        and not any(token in value.lower() for token in ("://", "git-", "dev-"))
        and not re.search(
            r"[+*]|(?:^|[-.])(alpha|beta|rc|dev|snapshot|canary|preview|"
            r"eap|m[0-9])(?:[-.0-9]|$)",
            value,
            re.I,
        )
        and bool(re.fullmatch(r"[0-9A-Za-z*+<>=~^|., _-]+", value.strip()))
    )


def valid_toml_constraint(value):
    """Accept registry version constraints while rejecting source redirects."""
    if not isinstance(value, str):
        return False
    lowered = value.strip().lower()
    if not lowered or any(
        token in lowered for token in ("://", "git", "path", "file:")
    ):
        return False
    return not re.search(
        r"[xX*+]|(?:^|[-.])(alpha|beta|rc|dev|snapshot|canary|previe"
        r"w|eap|m[0-9])(?:[-.0-9]|$)",
        value,
        re.I,
    ) and bool(re.fullmatch(r"[0-9A-Za-z.+<>=~^|, _-]+", value.strip()))


def dependency_entry_change(before, after):
    """Validate one TOML dependency value, preserving identity and sources."""
    if before == after:
        return True
    if isinstance(before, str) and isinstance(after, str):
        return valid_toml_constraint(after)
    if isinstance(before, dict) and isinstance(after, dict):
        if set(before) != set(after):
            return False
        for key, old_value in before.items():
            new_value = after[key]
            if old_value == new_value:
                continue
            # Version is the only mutable field. A changed source, feature,
            # registry, or workspace setting requires ordinary review.
            if key not in ("version", "version_constraint"):
                return False
            if not valid_toml_constraint(new_value):
                return False
        return True
    return False


def dependency_map_change(before, after):
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    removed, added = set(before) - set(after), set(after) - set(before)
    if removed and added:
        return False
    for name in set(before) & set(after):
        if not dependency_entry_change(before[name], after[name]):
            if not (
                isinstance(before[name], list)
                and isinstance(after[name], list)
                and dependency_list_change(before[name], after[name])
            ):
                return False
    for name in set(after) - set(before):
        value = after[name]
        if isinstance(value, str) and not valid_toml_constraint(value):
            return False
        if isinstance(value, list) and not dependency_list_change([], value):
            return False
        if isinstance(value, dict):
            # New entries must not introduce a source or mutable configuration.
            if any(
                key != "version" and key not in ("version_constraint",) for key in value
            ):
                return False
            if "version" in value and not valid_toml_constraint(value["version"]):
                return False
    return True


def dependency_list_change(before, after):
    if not isinstance(before, list) or not isinstance(after, list):
        return False
    old_values = [value for value in before if isinstance(value, str)]
    new_values = [value for value in after if isinstance(value, str)]
    if len(old_values) != len(before) or len(new_values) != len(after):
        return False
    old_names = {
        re.split(r"[<>=!~; @]", value, maxsplit=1)[0].strip().lower()
        for value in old_values
    }
    new_names = {
        re.split(r"[<>=!~; @]", value, maxsplit=1)[0].strip().lower()
        for value in new_values
    }
    if old_names - new_names and new_names - old_names:
        return False
    if not requirement_markers_preserved(old_values, new_values):
        return False
    for value in new_values:
        name = re.split(r"[<>=!~; @]", value, maxsplit=1)[0].strip().lower()
        if name not in old_names and not requirement_has_selector(value):
            return False
    return all(valid_requirement(value) for value in new_values)


def toml_dependency_change(before, after, paths):
    """Compare selected TOML dependency paths and leave all other config intact."""
    if not isinstance(before, dict) or not isinstance(after, dict) or before == after:
        return False
    old, new = copy.deepcopy(before), copy.deepcopy(after)

    def take(data, path):
        target = data
        for key in path[:-1]:
            if not isinstance(target, dict):
                return None
            target = target.get(key, {})
        if not isinstance(target, dict):
            return None
        return target.pop(path[-1], None)

    changed = False
    for path, kind in paths:
        old_value = take(old, path)
        new_value = take(new, path)
        if old_value == new_value:
            continue
        changed = True
        if kind == "map":
            if not dependency_map_change(old_value or {}, new_value or {}):
                return False
        elif kind == "list":
            if not dependency_list_change(old_value or [], new_value or []):
                return False
        else:
            return False
    return changed and old == new


def dependency_names(value, kind):
    if kind == "list" and isinstance(value, list):
        return {
            re.split(r"[<>=!~; @]", item, maxsplit=1)[0].strip().lower()
            for item in value
            if isinstance(item, str)
        }
    if kind == "map" and isinstance(value, dict):
        if value and all(isinstance(item, list) for item in value.values()):
            return {
                re.split(r"[<>=!~; @]", item, maxsplit=1)[0].strip().lower()
                for items in value.values()
                for item in items
                if isinstance(item, str)
            }
        return {str(name).lower() for name in value}
    return set()


def dependency_scopes(value, kind, scope):
    """Return dependency identities mapped to their manifest section scopes."""
    result = {}

    def add(name, suffix=()):
        result.setdefault(name, set()).add(tuple(scope) + tuple(suffix))

    if kind == "list" and isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                add(re.split(r"[<>=!~; @]", item, maxsplit=1)[0].strip().lower())
    elif kind == "map" and isinstance(value, dict):
        if value and all(isinstance(item, list) for item in value.values()):
            for group, items in value.items():
                for item in items:
                    if isinstance(item, str):
                        add(
                            re.split(r"[<>=!~; @]", item, maxsplit=1)[0]
                            .strip()
                            .lower(),
                            (str(group),),
                        )
        else:
            for name in value:
                add(str(name).lower())
    return result


def changed_lines(patch):
    if not patch:
        return None
    old, new = [], []
    for line in patch.splitlines():
        if line.startswith(("---", "+++")):
            continue
        if line.startswith("-"):
            old.append(line[1:])
        elif line.startswith("+"):
            new.append(line[1:])
    return old, new


def replacements(
    patch,
    pattern,
    preserve_structure=False,
    immutable_refs=False,
    stable_dependency=False,
):
    if not patch:
        return False
    # Pair only adjacent replacement blocks. Aggregating across hunks would
    # allow an action or dependency declaration to move to another job/scope.
    blocks, old, new = [], [], []
    for line in [*patch.splitlines(), ""]:
        if line.startswith("-") and not line.startswith("---"):
            old.append(line[1:])
        elif line.startswith("+") and not line.startswith("+++"):
            new.append(line[1:])
        elif old or new:
            blocks.append((old, new))
            old, new = [], []
    if not blocks:
        return False
    for old, new in blocks:
        if not old or len(old) != len(new):
            return False
        for index, left in enumerate(old):
            right = new[index]
            a, b = re.fullmatch(pattern, left), re.fullmatch(pattern, right)
            if not a or not b:
                return False
            if (
                immutable_refs
                and SHA.fullmatch(a.group("dependency").lower())
                and not SHA.fullmatch(b.group("dependency").lower())
            ):
                return False
            if stable_dependency and not stable_version(b.group("dependency")):
                return False
            if preserve_structure:
                if a.group("prefix") != b.group("prefix") or a.group(
                    "suffix"
                ) != b.group("suffix"):
                    return False
                if a.group("dependency") == b.group("dependency"):
                    return False
            elif left.split("//", 1)[0].strip() == right.split("//", 1)[0].strip():
                return False
    return True


def parse_gradle_declaration(value):
    declaration = re.compile(
        r"^\s*(?P<configuration>[A-Za-z_][\w]*)\s*(?:\(\s*)?[\"']"
        # Gradle's fourth coordinate and @extension select a different
        # artifact; leave both forms for ordinary review instead of treating
        # them as a bounded version change.
        r"(?P<group>[\w.+-]+):(?P<artifact>[\w.+-]+):(?P<version>[^\"':@]+)"
        r"[\"']\s*\)?\s*(?://.*)?$"
    )
    plugin = re.compile(
        r"^\s*(?P<form>id|kotlin)\(\s*[\"'](?P<id>[\w.-]+)[\"']\s*\)\s+version\s+"
        r"[\"'](?P<version>[^\"']+)[\"'](?P<apply>\s+apply\s+false)?\s*$"
    )

    match = declaration.fullmatch(value) or plugin.fullmatch(value)
    if not match:
        return None
    data = match.groupdict()
    configuration = data.get("configuration")
    if configuration and not re.fullmatch(
        r"(?:[A-Za-z0-9_]*(?:Implementation|RuntimeOnly|CompileOnly)|i"
        r"mplementation|api|ksp|kapt|classpath|runtimeOnly|compileOnly)",
        configuration,
    ):
        return None
    is_plugin = "id" in data and data.get("id") is not None
    return (
        "plugin" if is_plugin else "dependency",
        data.get("form") if is_plugin else configuration,
        data.get("apply") if is_plugin else "",
        data.get("group"),
        data.get("artifact"),
        data.get("id"),
        data["version"],
    )


NPM_RANGE_VERSION = re.compile(
    r"(?P<major>[0-9]+)"
    r"(?:\.(?P<minor>[0-9]+|[xX*]))?"
    r"(?:\.(?P<patch>[0-9]+|[xX*]))?"
)
NPM_RANGE_OPERATORS = {"", "=", "<", "<=", ">", ">=", "~", "^"}


def npm_range_selector(value):
    """Return bounds for the stable numeric portion of one npm selector."""
    match = NPM_RANGE_VERSION.fullmatch(value)
    if not match:
        return None
    parts = match.groupdict()
    if any(
        value and value.isdigit() and len(value) > 1 and value.startswith("0")
        for value in parts.values()
    ):
        return None
    if parts["patch"] in ("x", "X", "*") and parts["minor"] in (None, "x", "X", "*"):
        return None
    if parts["minor"] in ("x", "X", "*") and parts["patch"] is not None:
        return None
    values = tuple(
        int(parts[name]) if parts[name] and parts[name].isdigit() else 0
        for name in ("major", "minor", "patch")
    )
    wildcard = next(
        (
            index
            for index, name in enumerate(("major", "minor", "patch"))
            if parts[name] in ("x", "X", "*")
        ),
        None,
    )
    precision = (
        wildcard
        if wildcard is not None
        else sum(parts[name] is not None for name in ("major", "minor", "patch"))
    )
    exact = wildcard is None and precision == 3
    if exact:
        return values, None, True, precision
    upper_index = precision - 1 if wildcard is None else wildcard - 1
    upper = list(values)
    upper[upper_index] += 1
    for index in range(upper_index + 1, 3):
        upper[index] = 0
    return values, tuple(upper), False, precision


def npm_version_satisfies(version, constraint):
    """Evaluate the bounded stable-selector grammar; unknown ranges need review."""
    if not isinstance(constraint, str) or not re.fullmatch(
        r"[0-9]+\.[0-9]+\.[0-9]+", version
    ):
        return False
    if any(len(part) > 1 and part.startswith("0") for part in version.split(".")):
        return False
    actual = tuple(map(int, version.split(".")))
    token = re.compile(
        r"(?P<operator>[~^<>=]*)\s*(?P<version>[0-9]+(?:\.[0-9xX*]+){0,2})"
    )

    def matches(selector, operator):
        selected = npm_range_selector(selector)
        if selected is None or operator not in NPM_RANGE_OPERATORS:
            return False
        lower, upper, exact, precision = selected
        if operator in ("", "="):
            return actual == lower if exact else lower <= actual < upper
        if operator == "<":
            return actual < lower
        if operator == "<=":
            return actual <= lower if exact else actual < upper
        if operator == ">":
            return actual > lower if exact else actual >= upper
        if operator == ">=":
            return actual >= lower
        if operator == "~":
            upper_index = 0 if precision == 1 else 1
            upper_bound = list(lower)
            upper_bound[upper_index] += 1
            for index in range(upper_index + 1, 3):
                upper_bound[index] = 0
            return lower <= actual < tuple(upper_bound)
        if operator == "^":
            if lower[0] or precision == 1:
                upper_bound = (lower[0] + 1, 0, 0)
            elif lower[1] or precision == 2:
                upper_bound = (0, lower[1] + 1, 0)
            else:
                upper_bound = (0, 0, lower[2] + 1)
            return lower <= actual < upper_bound
        return False

    for branch in constraint.split("||"):
        branch = branch.strip()
        if branch == "*":
            return True
        hyphen = re.fullmatch(
            r"([0-9]+(?:\.[0-9xX*]+){0,2})\s+-\s+"
            r"([0-9]+(?:\.[0-9xX*]+){0,2})",
            branch,
        )
        if hyphen:
            lower = npm_range_selector(hyphen.group(1))
            upper = npm_range_selector(hyphen.group(2))
            if lower is None or upper is None:
                continue
            lower_bound = lower[0]
            upper_bound = upper[0] if upper[2] else upper[1]
            if lower_bound <= actual and (
                actual <= upper_bound if upper[2] else actual < upper_bound
            ):
                return True
            continue
        position, predicates, valid = 0, [], True
        while position < len(branch):
            while position < len(branch) and branch[position].isspace():
                position += 1
            match = token.match(branch, position)
            if not match:
                valid = False
                break
            operator = match.group("operator")
            if operator not in NPM_RANGE_OPERATORS:
                valid = False
                break
            predicates.append((match.group("version"), operator))
            position = match.end()
            if position < len(branch) and not branch[position].isspace():
                valid = False
                break
        if (
            valid
            and predicates
            and all(matches(selector, operator) for selector, operator in predicates)
        ):
            return True
    return False


def npm_lock_update(before, after):
    """Allow registry version updates, binding artifact identity and checksums.

    npm v2 and v3 are supported when their normalized graph and artifact
    metadata pass validation; other lock schemas need ordinary review.
    """

    def parse(text):
        value = json.loads(text)
        if not isinstance(value, dict) or value.get("lockfileVersion") not in (2, 3):
            raise ValueError("unsupported lock schema")
        packages = value.get("packages")
        if not isinstance(packages, dict) or "" not in packages:
            raise ValueError("missing package map")
        bundled_owners = {}
        for path, node in packages.items():
            if not isinstance(node, dict):
                raise ValueError("invalid package")
            for field in (
                "dependencies",
                "devDependencies",
                "optionalDependencies",
                "peerDependencies",
            ):
                dependencies = node.get(field, {})
                if not isinstance(dependencies, dict) or not all(
                    isinstance(key, str)
                    and (version == "*" or valid_npm_constraint(version))
                    for key, version in dependencies.items()
                ):
                    raise ValueError("non-registry dependency constraint")
            if not path:
                continue
            identity = path.rsplit("node_modules/", 1)[-1]
            if not re.fullmatch(
                r"node_modules/(?:@[a-z0-9._-]+/)?[a-z0-9._-]+"
                r"(?:/node_modules/(?:@[a-z0-9._-]+/)?[a-z0-9._-]+)*",
                path,
            ) or any(part in (".", "..") for part in path.split("/")):
                raise ValueError("non-registry identity")
            if node.get("name", identity) != identity:
                raise ValueError("aliased package identity")
            version = node.get("version", "")
            if not isinstance(version, str) or not re.fullmatch(
                r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version
            ):
                raise ValueError("non-registry version")
            if node.get("inBundle") is True:
                if "resolved" in node or "integrity" in node:
                    raise ValueError("mixed bundled source representation")
                owners = []
                for owner_path, owner in packages.items():
                    if not owner_path or owner.get("inBundle") is True:
                        continue
                    bundles = owner.get("bundleDependencies", [])
                    if not isinstance(bundles, list) or not all(
                        isinstance(item, str)
                        and re.fullmatch(r"(?:@[a-z0-9._-]+/)?[a-z0-9._-]+", item)
                        for item in bundles
                    ):
                        raise ValueError("unsupported bundled dependency list")
                    for bundled in bundles:
                        prefix = f"{owner_path}/node_modules/{bundled}"
                        if path == prefix or path.startswith(prefix + "/node_modules/"):
                            owners.append(owner_path)
                if not owners or "from" in node or "link" in node:
                    raise ValueError("unbound bundled package")
                bundled_owners[path] = owners
                continue
            source = node.get("resolved")
            if not isinstance(source, str):
                raise ValueError("missing artifact source")
            parsed = urlparse(source)
            expected_path = f"/{identity}/-/{identity.split('/')[-1]}-{version}.tgz"
            if (
                parsed.scheme != "https"
                or parsed.netloc not in {"registry.npmjs.org", "registry.yarnpkg.com"}
                or parsed.path != expected_path
                or parsed.query
                or parsed.fragment
                or parsed.params
                or "from" in node
                or "link" in node
            ):
                raise ValueError("artifact identity mismatch")
            integrity = node.get("integrity", "")
            if not isinstance(integrity, str):
                raise ValueError("missing integrity")
            algorithm, separator, encoded = integrity.partition("-")
            sizes = {"sha256": 32, "sha384": 48, "sha512": 64}
            if not separator or algorithm not in sizes:
                raise ValueError("unsupported integrity")
            if len(base64.b64decode(encoded, validate=True)) != sizes[algorithm]:
                raise ValueError("invalid integrity digest")

        def resolve_dependency(path, identity):
            # Resolve npm's nearest ancestor node_modules entry. Peer
            # dependencies use the same lookup, but missing required peers
            # must fail closed while optional peers may be absent.
            candidates = []
            current = path
            while current:
                candidates.append(f"{current}/node_modules/{identity}")
                current = (
                    current.rsplit("/node_modules/", 1)[0]
                    if "/node_modules/" in current
                    else ""
                )
            candidates.append(f"node_modules/{identity}")
            return next((packages[p] for p in candidates if p in packages), None)

        def resolve_peer(path, identity):
            # A peer is resolved from the dependent package's parent scope or
            # an ancestor. A child-only node_modules entry cannot satisfy it.
            parent = (
                path.rsplit("/node_modules/", 1)[0] if "/node_modules/" in path else ""
            )
            current = parent
            candidates = []
            while current:
                candidates.append(f"{current}/node_modules/{identity}")
                current = (
                    current.rsplit("/node_modules/", 1)[0]
                    if "/node_modules/" in current
                    else ""
                )
            candidates.append(f"node_modules/{identity}")
            return next((packages[p] for p in candidates if p in packages), None)

        paths_by_node = {id(node): path for path, node in packages.items()}
        graph = {path: set() for path in packages}
        for path, node in packages.items():
            for field in ("dependencies", "devDependencies", "optionalDependencies"):
                for identity, constraint in node.get(field, {}).items():
                    # Resolve npm's nearest ancestor node_modules entry.
                    target = resolve_dependency(path, identity)
                    if target is None:
                        raise ValueError("missing graph dependency")
                    graph[path].add(paths_by_node[id(target)])
                    if not npm_version_satisfies(target["version"], constraint):
                        raise ValueError("unvalidated dependency range")
            peer_meta = node.get("peerDependenciesMeta", {})
            if not valid_peer_metadata(peer_meta):
                raise ValueError("invalid peer metadata")
            for identity, constraint in node.get("peerDependencies", {}).items():
                target = resolve_peer(path, identity)
                optional = isinstance(peer_meta.get(identity), dict) and peer_meta[
                    identity
                ].get("optional", False)
                if target is None:
                    if optional:
                        continue
                    raise ValueError("missing required peer dependency")
                graph[path].add(paths_by_node[id(target)])
                if not npm_version_satisfies(target["version"], constraint):
                    raise ValueError("unvalidated peer dependency range")
        reachable, pending = set(), [""]
        while pending:
            path = pending.pop()
            if path not in reachable:
                reachable.add(path)
                pending.extend(graph[path] - reachable)
        if value.get("lockfileVersion") == 2:
            legacy = value.get("dependencies")
            if not isinstance(legacy, dict):
                raise ValueError("missing legacy dependency tree")

            # npm v2 carries both the normalized packages graph and a legacy
            # dependency tree. Flatten the latter to package paths and bind
            # its install-relevant fields to the normalized records.
            legacy_nodes = {}

            def walk_legacy(tree, parent=""):
                if not isinstance(tree, dict):
                    raise ValueError("invalid legacy dependency tree")
                for name, node in tree.items():
                    if (
                        not isinstance(name, str)
                        or not re.fullmatch(r"(?:@[a-z0-9._-]+/)?[a-z0-9._-]+", name)
                        or not isinstance(node, dict)
                    ):
                        raise ValueError("invalid legacy package")
                    path = (
                        f"{parent}/node_modules/{name}"
                        if parent
                        else f"node_modules/{name}"
                    )
                    if path in legacy_nodes:
                        raise ValueError("duplicate legacy package")
                    if set(node) - {
                        "version",
                        "resolved",
                        "integrity",
                        "dev",
                        "optional",
                        "devOptional",
                        "peer",
                        "requires",
                        "dependencies",
                        "bundled",
                    }:
                        raise ValueError("unsupported legacy package metadata")
                    legacy_nodes[path] = node
                    nested = node.get("dependencies", {})
                    if not isinstance(nested, dict):
                        raise ValueError("invalid nested legacy dependency tree")
                    walk_legacy(nested, path)

            walk_legacy(legacy)
            package_paths = set(packages) - {""}
            if set(legacy_nodes) != package_paths:
                raise ValueError("legacy/package graph mismatch")
            # The v2 `requires` map mirrors install dependencies and optional
            # dependencies; peer metadata is represented in `packages` only.
            dependency_fields = ("dependencies", "optionalDependencies")
            for path in package_paths:
                package = packages[path]
                legacy_node = legacy_nodes[path]
                for field in ("version", "resolved", "integrity"):
                    if package.get(field) != legacy_node.get(field):
                        raise ValueError("legacy package metadata mismatch")
                if bool(package.get("inBundle", False)) != bool(
                    legacy_node.get("bundled", False)
                ):
                    raise ValueError("legacy bundle mismatch")
                for field in ("peer", "optional", "dev", "devOptional"):
                    if package.get(field) != legacy_node.get(field):
                        raise ValueError("legacy package flags mismatch")
                requires = {}
                for field in dependency_fields:
                    dependencies = package.get(field, {})
                    if not isinstance(dependencies, dict):
                        raise ValueError("invalid package dependency map")
                    requires.update(dependencies)
                if legacy_node.get("requires", {}) != requires:
                    raise ValueError("legacy package requirements mismatch")
            # The consistency check above authorizes the legacy projection;
            # remove it before old/new comparison so legitimate version bumps
            # are compared through the normalized packages graph.
            value.pop("dependencies")
        return value, reachable, bundled_owners

    try:
        (old, old_reachable, _), (new, new_reachable, bundled_owners) = (
            parse(before),
            parse(after),
        )
        old_packages, new_packages = old.pop("packages"), new.pop("packages")
        for path, owners in bundled_owners.items():
            if old_packages.get(path) == new_packages[path]:
                continue
            # The enclosing registry tarball is the bundle's integrity proof.
            # Unchanged bytes cannot justify a new or altered bundled record.
            if not any(
                tuple(
                    old_packages.get(owner, {}).get(field)
                    for field in ("version", "resolved", "integrity")
                )
                != tuple(
                    new_packages[owner].get(field)
                    for field in ("version", "resolved", "integrity")
                )
                for owner in owners
            ):
                return False
            if path not in old_packages and set(new_packages[path]) - {
                "version",
                "inBundle",
                "dependencies",
                "optionalDependencies",
                "peerDependencies",
                "peerDependenciesMeta",
                "dev",
                "optional",
                "devOptional",
                "license",
                "engines",
                "os",
                "cpu",
            }:
                return False

        dependency_fields = {
            "dependencies",
            "devDependencies",
            "optionalDependencies",
            "peerDependencies",
        }
        removed = old_packages.keys() - new_packages.keys()
        if (
            old != new
            or not removed <= old_reachable
            or not (new_packages.keys() - {""}) <= new_reachable
        ):
            return False
        # Root executable metadata must not change with dependency versions.
        root_old, root_new = dict(old_packages[""]), dict(new_packages[""])
        for root in (root_old, root_new):
            for field in dependency_fields:
                dependencies = root.pop(field, {})
                if not isinstance(dependencies, dict):
                    return False
                if not all(isinstance(v, str) for v in dependencies.values()):
                    return False
        if root_old != root_new:
            return False
        for path in old_packages.keys() & new_packages.keys() - {""}:
            old_node, new_node = old_packages[path], new_packages[path]
            metadata_old, metadata_new = dict(old_node), dict(new_node)
            for metadata in (metadata_old, metadata_new):
                for field in ("version", "resolved", "integrity"):
                    metadata.pop(field, None)
            if old_node["version"] != new_node["version"]:
                for metadata in (metadata_old, metadata_new):
                    for field in dependency_fields:
                        metadata.pop(field, None)
            if metadata_old != metadata_new:
                return False
            if old_node["version"] == new_node["version"] and (
                old_node.get("resolved") != new_node.get("resolved")
                or old_node.get("integrity") != new_node.get("integrity")
            ):
                return False
        if not (new_packages.keys() - old_packages.keys()) <= new_reachable:
            return False
        return True
    except INVALID_LOCK:
        return False


def dependency_file(path, before, after, patch, status="modified"):
    """Pure policy. Contents are immutable GitHub blobs, never local PR files."""
    name = PurePosixPath(path).name
    if (
        status not in ("modified", "added", "removed")
        or path.startswith("/")
        or ".." in PurePosixPath(path).parts
    ):
        return False
    if name == "Package.resolved":
        if status != "modified" or before is None or after is None:
            return False
        return swift_package_resolved_change(
            before, after, allow_origin_hash_change=True
        )
    if name == "Gemfile.lock":
        return status == "modified" and gemfile_lock_update(before, after)
    if name in LOCKS:
        # Unknown lock grammars cannot grant an executable-source exemption.
        if name not in ("package-lock.json", "npm-shrinkwrap.json"):
            return False
        if status != "modified" or before is None or after is None:
            return False
        return npm_lock_update(before, after)
    if path.startswith(".github/workflows/") and name.endswith((".yml", ".yaml")):
        changed = changed_lines(patch)
        if changed is None:
            return False
        valid = replacements(
            patch,
            (
                r"(?P<prefix>[ \t]*(?:-[ \t]+)?uses:[ \t]*[\w.-]+/"
                r"[\w./-]+@)(?P<dependency>(?:[0-9a-f"
                r"A-F]{40}|v?[0-9]+(?:\.[0-9]+){0,2}))"
                r"(?P<suffix>[ \t]*)(?:#.*)?"
            ),
            True,
            immutable_refs=True,
        )
        if not valid:
            return False
        for line in changed[1]:
            match = re.fullmatch(
                r"[ \t]*(?:-[ \t]+)?uses:[ \t]*[\w.-]+/[\w./-]+@"
                r"(?P<ref>[^ \t#]+)[ \t]*(?:#.*)?",
                line,
            )
            if not match or not SHA.fullmatch(match["ref"].lower()):
                return False
        return True
    if name.startswith("Dockerfile"):
        return replacements(
            patch,
            (
                r"(?P<prefix>[ \t]*FROM[ \t]+(?:--platform=[^\s]+[ \t]+)?"
                r"[A-Za-z0-9_.-]+(?::[0-9]+)?(?:/[A-Za-z0-9_.-]+)*(?:@sha256:|:))"
                r"(?P<dependency>[A-Za-z0-9_.-]+)"
                r"(?P<suffix>(?:[ \t]+[Aa][Ss][ \t]+\w+)?[ \t]*)(?:#.*)?"
            ),
            True,
            stable_dependency=True,
        )
    if name == "verification-metadata.xml" and "/gradle/" in "/" + path:
        # Component checksum records are dependency data; global verification
        # policy, trusted keys and the metadata file itself cannot be removed.
        if status != "modified" or before is None or after is None:
            return False
        if any(
            token in text.upper()
            for text in (before, after)
            for token in ("<!DOCTYPE", "<!ENTITY")
        ):
            return False
        try:
            old, new = ET.fromstring(before), ET.fromstring(after)

            def local(tag):
                return tag.rsplit("}", 1)[-1]

            def scrub(root):
                # Security configuration, component identities, artifacts, and
                # checksum algorithms remain equivalent; only digest values may
                # vary between lockfile updates.
                for group in root:
                    if local(group.tag) != "components":
                        group.tail = None
                        continue
                    for component in group:
                        version = component.attrib.get("version", "")
                        if version and stable_version(version):
                            component.attrib["version"] = "<VERSION>"
                            prefix = component.attrib.get("name", "") + "-" + version
                            for artifact in component:
                                artifact_name = artifact.attrib.get("name", "")
                                if artifact_name.startswith(prefix) and artifact_name[
                                    len(prefix) :
                                ].startswith((".", "-")):
                                    artifact.attrib["name"] = (
                                        component.attrib["name"]
                                        + "-<VERSION>"
                                        + artifact_name[len(prefix) :]
                                    )
                    for node in group.iter():
                        node.tail = None
                        if local(node.tag).startswith("sha"):
                            node.attrib["value"] = "<DIGEST>"
                return ET.tostring(root, encoding="unicode")

            if scrub(copy.deepcopy(old)) != scrub(copy.deepcopy(new)):
                return False

            def valid_components(root):
                if local(root.tag) != "verification-metadata":
                    return False
                groups = [node for node in root if local(node.tag) == "components"]
                if len(groups) != 1 or groups[0].attrib:
                    return False
                rules = {
                    "components": ({"component"}, set(), set()),
                    "component": (
                        {"artifact"},
                        {"group", "name", "version"},
                        {"group", "name", "version"},
                    ),
                    "artifact": ({"sha1", "sha256", "sha512"}, {"name"}, {"name"}),
                    "sha1": (set(), {"value", "origin", "reason"}, {"value"}),
                    "sha256": (set(), {"value", "origin", "reason"}, {"value"}),
                    "sha512": (set(), {"value", "origin", "reason"}, {"value"}),
                }
                for node in groups[0].iter():
                    tag = local(node.tag)
                    if tag not in rules:
                        return False
                    children, attributes, required = rules[tag]
                    if set(node.attrib) - attributes or not required <= set(
                        node.attrib
                    ):
                        return False
                    if (
                        any(local(child.tag) not in children for child in node)
                        or (node.text or "").strip()
                    ):
                        return False
                    if tag.startswith("sha") and not re.fullmatch(
                        r"[0-9a-fA-F]{"
                        + str({"sha1": 40, "sha256": 64, "sha512": 128}[tag])
                        + "}",
                        node.attrib["value"],
                    ):
                        return False
                return True

            def component_coordinates(root):
                groups = [node for node in root if local(node.tag) == "components"]
                if len(groups) != 1:
                    return None
                return sorted(
                    (
                        node.attrib.get("group"),
                        node.attrib.get("name"),
                        node.attrib.get("version"),
                    )
                    for node in groups[0]
                    if local(node.tag) == "component"
                )

            if not valid_components(old) or not valid_components(new):
                return False
            old_components = next(
                node for node in old if local(node.tag) == "components"
            )
            new_components = next(
                node for node in new if local(node.tag) == "components"
            )
            for previous, current in zip(old_components, new_components, strict=False):
                if previous.attrib["version"] == current.attrib["version"]:
                    prior_data = [
                        (local(node.tag), node.attrib) for node in previous.iter()
                    ]
                    current_data = [
                        (local(node.tag), node.attrib) for node in current.iter()
                    ]
                    if prior_data != current_data:
                        return False
            return before != after and component_coordinates(
                old
            ) != component_coordinates(new)
        except ET.ParseError:
            return False
    if re.fullmatch(r"(?:requirements|constraints)(?:[._-][\w.-]+)?\.(?:txt|in)", name):
        lines = changed_lines(patch)
        if status not in ("modified", "added") or lines is None:
            return False

        def semantic(values):
            return [
                line.split("#", 1)[0].strip()
                for line in values
                if line.split("#", 1)[0].strip()
            ]

        old_values, new_values = semantic(lines[0]), semantic(lines[1])
        old_names = {
            re.split(r"[<>=!~; @]", value, maxsplit=1)[0].strip().lower()
            for value in old_values
            if not value.startswith("--hash=")
        }
        new_names = {
            re.split(r"[<>=!~; @]", value, maxsplit=1)[0].strip().lower()
            for value in new_values
            if not value.startswith("--hash=")
        }
        # A pure add or removal is a dependency update; replacing one package
        # with another must remain under ordinary review.
        if old_names - new_names and new_names - old_names:
            return False
        if not old_names and not new_names:
            return False
        old_requirements = [
            value for value in old_values if not value.startswith("--hash=")
        ]
        new_requirements = [
            value for value in new_values if not value.startswith("--hash=")
        ]

        def hash_records(values):
            result = {}
            current = None
            for value in semantic(values):
                value = value.removesuffix("\\").strip()
                if value.startswith("--hash="):
                    if current is None:
                        return None
                    result[current][1].append(value)
                else:
                    current = re.split(r"[<>=!~; @]", value, maxsplit=1)[0].lower()
                    if current in result:
                        return None
                    result[current] = (value, [])
            return result

        # Bind hashes using complete immutable files, not patch context: an
        # unrelated version bump cannot authorize another package's hash edit.
        old_records = hash_records(
            before.splitlines() if before is not None else lines[0]
        )
        new_records = hash_records(
            after.splitlines() if after is not None else lines[1]
        )
        if old_records is None or new_records is None:
            return False
        if any(hashes for _, hashes in old_records.values()):
            # Once a requirements file carries artifact hashes, a newly added
            # package must carry at least one hash as well; otherwise the
            # dependency-only path could weaken the file's integrity policy.
            for identity in new_records.keys() - old_records.keys():
                if not new_records[identity][1]:
                    return False
        for identity in old_records.keys() & new_records.keys():
            old_requirement, old_hashes = old_records[identity]
            new_requirement, new_hashes = new_records[identity]
            if len(new_hashes) < len(old_hashes):
                return False
            if old_requirement == new_requirement and old_hashes != new_hashes:
                return False
        return (
            old_values != new_values
            # Hash-only churn is not a version update and must not be accepted
            # after the hash lines have been stripped from both projections.
            and old_requirements != new_requirements
            and all(
                not line.split("#", 1)[0].strip()
                or valid_requirement_line(line.split("#", 1)[0].strip())
                for line in lines[0] + lines[1]
            )
            and all(
                re.search(
                    r"(?:===|==|~=|!=|<=|>=|<|>|\^|~)\s*[^;#\s]", line.split(";", 1)[0]
                )
                for line in new_requirements
            )
            and requirement_markers_preserved(old_requirements, new_requirements)
        )
    if name in (
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
    ):
        # Keep this deliberately bounded: interpolation/executable Gradle
        # expressions are never dependency-only version changes.
        lines = changed_lines(patch)
        if status != "modified" or lines is None:
            return False

        blocks, old_block, new_block = [], [], []
        for line in [*patch.splitlines(), ""]:
            if line.startswith("-") and not line.startswith("---"):
                old_block.append(line[1:])
            elif line.startswith("+") and not line.startswith("+++"):
                new_block.append(line[1:])
            elif old_block or new_block:
                blocks.append((old_block, new_block))
                old_block, new_block = [], []
        if not blocks:
            return False
        removed_ids, added_ids = set(), set()
        for old_lines, new_lines in blocks:
            old_values = [parse_gradle_declaration(line) for line in old_lines]
            new_values = [parse_gradle_declaration(line) for line in new_lines]
            if any(value is None for value in old_values + new_values):
                return False
            if not old_values:
                added_ids.update(value[:-1] for value in new_values)
                if any(not stable_version(value[-1]) for value in new_values):
                    return False
                continue
            if not new_values:
                removed_ids.update(value[:-1] for value in old_values)
                continue
            if len(old_values) != len(new_values):
                return False
            for old_value, new_value in zip(old_values, new_values, strict=False):
                if old_value[:-1] != new_value[:-1] or old_value[-1] == new_value[-1]:
                    return False
                if not stable_version(new_value[-1]):
                    return False
        # A patch that removes one declaration and adds a different one in
        # separate hunks is a replacement, even when the identities do not
        # intersect. Keep that change under ordinary review rather than
        # granting the dependency-only exemption.
        return not (removed_ids and added_ids)
    if name == "Gemfile":
        lines = changed_lines(patch)
        declaration = (
            r"\s*gem\s+['\"][A-Za-z0-9_.-]+['\"]"
            r"(?:\s*,\s*['\"][0-9<>=~.,* _+-]+['\"])?\s*"
        )
        if lines and (not lines[0] or not lines[1]):
            changed = lines[0] + lines[1]
            if not changed or not all(
                re.fullmatch(declaration, line) for line in changed
            ):
                return False
            if lines[1]:
                for line in lines[1]:
                    constraint = re.fullmatch(
                        r"\s*gem\s+['\"][A-Za-z0-9_.-]+['\"]\s*,\s*['\"]"
                        r"(?P<value>[0-9<>=~.,* _+-]+)['\"]\s*",
                        line,
                    )
                    if (
                        not constraint
                        or not stable_version(constraint.group("value"))
                        or not re.search(r"[0-9]", constraint.group("value"))
                    ):
                        return False
            return True
        return replacements(
            patch,
            (
                r"(?P<prefix>\s*gem\s+['\"][A-Za-z0-9_.-]+['\"])"
                r"(?:\s*,\s*['\"](?P<dependency>[A-Za-z0-9<>=~.,* _+-]+)['\"])?"
                r"(?P<suffix>(?:\s*,[^\n]*)?)"
            ),
            True,
            stable_dependency=True,
        )
    if name == "Package.swift":
        lines = changed_lines(patch)
        if status not in ("modified", "added", "removed") or lines is None:
            return False
        package_line = re.compile(r"^\s*\.package\s*\((?P<body>[^()]*)\)\s*,?\s*$")

        def strip_comments(value):
            """Remove Swift comments while preserving quoted string contents."""
            out, index, quote = [], 0, None
            while index < len(value):
                if quote:
                    out.append(value[index])
                    if value[index] == "\\" and index + 1 < len(value):
                        out.append(value[index + 1])
                        index += 2
                        continue
                    if value[index] == quote:
                        quote = None
                    index += 1
                    continue
                if value[index] in ('"', "'"):
                    quote = value[index]
                    out.append(value[index])
                    index += 1
                    continue
                if value.startswith("//", index):
                    break
                if value.startswith("/*", index):
                    close = value.find("*/", index + 2)
                    if close < 0:
                        return None
                    out.append(" ")
                    index = close + 2
                    continue
                out.append(value[index])
                index += 1
            return "".join(out)

        def arguments(body):
            parts, start, quote, index = [], 0, None, 0
            while index < len(body):
                char = body[index]
                if quote:
                    if char == "\\":
                        index += 2
                        continue
                    if char == quote:
                        quote = None
                elif char in ('"', "'"):
                    quote = char
                elif char == ",":
                    parts.append(body[start:index].strip())
                    start = index + 1
                index += 1
            if quote:
                return None
            parts.append(body[start:].strip())
            return parts

        version_selector = re.compile(
            r"(?P<prefix>\b(?:from|exact|upToNextMajor|upToNextMinor)\s*:\s*)"
            r"(?P<quote>[\"'])"
            r"(?P<version>[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?)"
            r"(?P=quote)"
        )
        re.compile(r"\b(?:from|exact|upToNextMajor|upToNextMinor)\s*:")

        def parse(values):
            result = []
            for line in values:
                line = strip_comments(line)
                if line is None:
                    return None
                match = package_line.fullmatch(line)
                if not match:
                    return None
                body = strip_comments(match.group("body"))
                if body is None:
                    return None
                if re.search(r"\b(?:path|branch|revision)\s*:", body):
                    return None
                identity = re.search(r"\b(?:url|name)\s*:\s*[\"']([^\"']+)[\"']", body)
                if not identity:
                    return None
                parsed = urlparse(identity.group(1))
                try:
                    port = parsed.port
                except ValueError:
                    return None
                if (
                    parsed.scheme != "https"
                    or not parsed.hostname
                    or parsed.username
                    or parsed.password
                    or port is not None
                    or parsed.query
                    or parsed.fragment
                    or parsed.params
                    or not parsed.path
                ):
                    return None
                # Package.swift is executable Swift. A version variable or
                # expression can change the selected dependency without
                # appearing as a literal version update, so only accept
                # quoted, bounded numeric literals in requirement arguments.
                args = arguments(body)
                while args and not args[-1]:
                    args.pop()
                body = re.sub(r",\s*$", "", body)
                if not args or not re.match(
                    r"^(?:url|name)\s*:\s*[\"'][^\"']+[\"']$", args[0]
                ):
                    return None
                for argument in args[1:]:
                    if not argument and argument == args[-1]:
                        continue
                    if not argument:
                        return None
                    match = version_selector.fullmatch(argument)
                    if not match or not stable_version(match.group("version")):
                        return None
                normalized = version_selector.sub(
                    lambda match: (
                        match.group("prefix")
                        + match.group("quote")
                        + "<VERSION>"
                        + match.group("quote")
                    ),
                    body,
                )
                result.append((identity.group(1), normalized, body))
            return result

        old_values, new_values = parse(lines[0]), parse(lines[1])
        if old_values is None or new_values is None:
            return False
        old_ids, new_ids = (
            [item[0] for item in old_values],
            [item[0] for item in new_values],
        )
        if set(old_ids) - set(new_ids) and set(new_ids) - set(old_ids):
            return False
        if old_ids and new_ids:
            return (
                old_ids == new_ids
                and [item[1] for item in old_values] == [item[1] for item in new_values]
                and old_values != new_values
            )
        return bool(old_ids or new_ids)
    if name == "project.pbxproj" and status == "modified":
        # Swift package requirement entries have a stable surrounding form;
        # only the quoted version token may change.
        if before is None or after is None:
            return False

        # Xcode stores these as XCRemoteSwiftPackageReference dictionaries.
        # Permit only minimumVersion token changes inside those sections.
        def normalize(text):
            out, section = [], False
            for line in text.splitlines():
                if line == "/* Begin XCRemoteSwiftPackageReference section */":
                    section = True
                if section:
                    line = re.sub(
                        (
                            r"^([ \t]*(?:minimumVersion|maximumVersion|version) = )"
                            r"\"?[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?"
                            r"\"?(;[ \t]*)$"
                        ),
                        r"\1<VERSION>\2",
                        line,
                    )
                out.append(line)
                if line == "/* End XCRemoteSwiftPackageReference section */":
                    section = False
            return out

        old, new = normalize(before), normalize(after)
        if (
            before != after
            and old == new
            and re.search(
                r"\b(?:minimumVersion|version) = ", "\n".join(before.splitlines())
            )
        ):
            old_kinds = re.findall(r"\bkind = ([A-Za-z0-9]+);", before)
            new_kinds = re.findall(r"\bkind = ([A-Za-z0-9]+);", after)
            old_versions = re.findall(
                r"\b(?:minimumVersion|maximumVersion|version) = \"?("
                r"[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?)\"?;",
                before,
            )
            new_versions = re.findall(
                r"\b(?:minimumVersion|maximumVersion|version) = \"?("
                r"[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?)\"?;",
                after,
            )
            return (
                old_kinds == new_kinds
                and old_versions != new_versions
                and all(stable_version(value) for value in new_versions)
            )

        def remote_entries(text):
            match = re.search(
                r"/\* Begin XCRemoteSwiftPackageReference section \*/(?P<b"
                r"ody>.*?)/\* End XCRemoteSwiftPackageReference section \*/",
                text,
                re.S,
            )
            if not match:
                return None, None
            entries = {}
            current = []
            for line in match.group("body").splitlines():
                if re.match(
                    r"\s*[A-Fa-f0-9]+ /\* XCRemoteSwiftP"
                    r"ackageReference \"[^\"]+\" \*/ = \{",
                    line,
                ):
                    if current:
                        return None, None
                    current = [line]
                elif current:
                    current.append(line)
                    if line.strip() == "};":
                        block = "\n".join(current)
                        identity = re.search(r"repositoryURL = \"([^\"]+)\";", block)
                        if not identity:
                            return None, None
                        if (
                            re.search(
                                r"\b(?:branch|revision|exactVersion|upToNe"
                                r"xtMajorVersion|upToNextMinorVersion)\s*=",
                                block,
                            )
                            is None
                            and "requirement =" not in block
                        ):
                            return None, None
                        normalized_block = re.sub(
                            r"(\bkind = )[A-Za-z0-9]+;", r"\1<KIND>;", block
                        )
                        normalized_block = re.sub(
                            r"(\b(?:minimumVersion|maximumVersion|version) = "
                            r")\"?[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?\"?;",
                            r"\1<VERSION>;",
                            normalized_block,
                        )
                        entries[identity.group(1)] = (normalized_block, block)
                        current = []
                elif line.strip():
                    return None, None
            if current:
                return None, None
            return entries, match.group(0)

        old_entries, old_section = remote_entries(before)
        new_entries, new_section = remote_entries(after)
        if old_entries is None or new_entries is None:
            return False
        removed, added = (
            set(old_entries) - set(new_entries),
            set(new_entries) - set(old_entries),
        )
        if removed and added:
            return False
        for identity in set(old_entries) & set(new_entries):
            old_normalized, old_raw = old_entries[identity]
            new_normalized, new_raw = new_entries[identity]
            if old_normalized != new_normalized:
                return False
            old_kind = re.findall(r"\bkind = ([A-Za-z0-9]+);", old_raw)
            new_kind = re.findall(r"\bkind = ([A-Za-z0-9]+);", new_raw)
            new_version = re.findall(
                r"\b(?:minimumVersion|maximumVersion|version) = \"?("
                r"[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?)\"?;",
                new_raw,
            )
            if any(not stable_version(value) for value in new_version):
                return False
            if old_kind != new_kind:
                return False
        for identity in added:
            _, raw = new_entries[identity]
            if re.search(r"\b(?:branch|revision)\s*=", raw):
                return False
        if not (removed or added):
            return False

        package_ids = {}
        for identity, (_, raw) in old_entries.items():
            header = re.match(r"\s*([A-Fa-f0-9]+) /\*", raw)
            if header:
                package_ids[identity] = header.group(1)
        for identity, (_, raw) in new_entries.items():
            header = re.match(r"\s*([A-Fa-f0-9]+) /\*", raw)
            if header:
                package_ids[identity] = header.group(1)
        ignored_package_ids = {
            package_ids[identity]
            for identity in removed | added
            if identity in package_ids
        }

        def scrub(text):
            product_start = "/* Begin XCSwiftPackageProductDependency section */"
            product_end = "/* End XCSwiftPackageProductDependency section */"
            ignored_product_ids = set()
            product_block = []
            product_id = None
            start, end = text.find(product_start), text.find(product_end)
            if start >= 0 and end > start:
                for line in text[start + len(product_start) : end].splitlines():
                    header = re.match(r"\s*([A-Fa-f0-9]+) /\* .* \*/ = \{", line)
                    if header:
                        product_block = [line]
                        product_id = header.group(1)
                    elif product_block:
                        product_block.append(line)
                        if line.strip() == "};":
                            if (
                                any(
                                    (
                                        match := re.search(
                                            r"\bpackage = ([A-Fa-f0-9]+) /\*", item
                                        )
                                    )
                                    and match.group(1) in ignored_package_ids
                                    for item in product_block
                                )
                                and product_id
                            ):
                                ignored_product_ids.add(product_id)
                            product_block, product_id = [], None
            text = text.replace(
                old_section if old_section and old_section in text else new_section,
                "/* XCRemoteSwiftPackageReference section elided */",
            )
            start, end = text.find(product_start), text.find(product_end)
            if start >= 0 and end > start:
                body = text[start + len(product_start) : end]
                kept, block = [], []
                for line in body.splitlines(keepends=True):
                    if re.match(r"\s*[A-Fa-f0-9]+ /\* .* \*/ = \{", line):
                        if block:
                            kept.extend(block)
                        block = [line]
                    elif block:
                        block.append(line)
                        if line.strip() == "};":
                            if not any(
                                re.search(r"\bpackage = ([A-Fa-f0-9]+) /\*", item)
                                and re.search(
                                    r"\bpackage = ([A-Fa-f0-9]+) /\*", item
                                ).group(1)
                                in ignored_package_ids
                                for item in block
                            ):
                                kept.extend(block)
                            block = []
                    else:
                        kept.append(line)
                kept.extend(block)
                text = text[: start + len(product_start)] + "".join(kept) + text[end:]
            # Xcode also creates PBXBuildFile records and Frameworks build-phase
            # links for package products. Remove only records tied to the
            # product references that were added or removed above.
            dropped_build_ids = set()
            build_start = "/* Begin PBXBuildFile section */"
            build_end = "/* End PBXBuildFile section */"
            start, end = text.find(build_start), text.find(build_end)
            if start >= 0 and end > start and ignored_product_ids:
                body = text[start + len(build_start) : end]
                kept, block, block_id = [], [], None
                for line in body.splitlines(keepends=True):
                    header = re.match(r"\s*([A-Fa-f0-9]+) /\* .* \*/ = \{", line)
                    if header:
                        if block:
                            kept.extend(block)
                        block, block_id = [line], header.group(1)
                    elif block:
                        block.append(line)
                        if line.strip() == "};":
                            if any(
                                (
                                    match := re.search(
                                        r"\bproductRef = ([A-Fa-f0-9]+) /\*", item
                                    )
                                )
                                and match.group(1) in ignored_product_ids
                                for item in block
                            ):
                                if block_id:
                                    dropped_build_ids.add(block_id)
                            else:
                                kept.extend(block)
                            block, block_id = [], None
                    else:
                        kept.append(line)
                kept.extend(block)
                text = text[: start + len(build_start)] + "".join(kept) + text[end:]
            if dropped_build_ids:
                ids = "|".join(re.escape(item) for item in sorted(dropped_build_ids))
                text = re.sub(
                    rf"^[ \t]*(?:{ids}) /\*[^\n]*\*/[,;]?[ \t]*\n",
                    "",
                    text,
                    flags=re.M,
                )
            # Xcode updates these references alongside the package dictionary.
            if ignored_package_ids:
                ids = "|".join(re.escape(item) for item in sorted(ignored_package_ids))
                text = re.sub(
                    rf"^[^\n]*(?:{ids}) /\* XCRemoteSwiftPackageReference[^\n]*\n",
                    "",
                    text,
                    flags=re.M,
                )
            return text

        return scrub(before) == scrub(after)
    if status not in ("modified", "added") or after is None:
        return False
    try:
        if name in JSON_FIELDS:
            if name == "manifest.json" and not path.startswith("custom_components/"):
                return False
            old_json, new_json = (
                json.loads("{}" if before is None else before),
                json.loads(after),
            )
            if name == "package.json":
                return package_constraints(old_json, new_json, JSON_FIELDS[name])
            if name == "manifest.json":
                if not only_fields(old_json, new_json, JSON_FIELDS[name]):
                    return False
                old_req, new_req = (
                    old_json.get("requirements", []),
                    new_json.get("requirements", []),
                )
                if not isinstance(old_req, list) or not isinstance(new_req, list):
                    return False
                old_names = {
                    re.split(r"[<>=!~; @]", item, maxsplit=1)[0].strip().lower()
                    for item in old_req
                    if isinstance(item, str)
                }
                new_names = {
                    re.split(r"[<>=!~; @]", item, maxsplit=1)[0].strip().lower()
                    for item in new_req
                    if isinstance(item, str)
                }
                return (
                    not (old_names - new_names and new_names - old_names)
                    and requirement_markers_preserved(old_req, new_req)
                    and all(valid_requirement(item) for item in new_req)
                    and all(
                        item in old_req
                        or re.search(
                            r"(?:===|==|~=|!=|<=|>=|<|>|\^|~)\s*[^;#\s]",
                            item.split(";", 1)[0],
                        )
                        for item in new_req
                    )
                )
            if name == "composer.json":
                if not only_fields(old_json, new_json, JSON_FIELDS[name]):
                    return False
                old_all = {
                    key
                    for field in ("require", "require-dev")
                    for key in (
                        old_json.get(field, {})
                        if isinstance(old_json.get(field, {}), dict)
                        else {}
                    )
                }
                new_all = {
                    key
                    for field in ("require", "require-dev")
                    for key in (
                        new_json.get(field, {})
                        if isinstance(new_json.get(field, {}), dict)
                        else {}
                    )
                }
                if old_all - new_all and new_all - old_all:
                    return False
                old_scopes = {
                    key: {
                        field
                        for field in ("require", "require-dev")
                        if isinstance(old_json.get(field, {}), dict)
                        and key in old_json.get(field, {})
                    }
                    for key in old_all
                }
                new_scopes = {
                    key: {
                        field
                        for field in ("require", "require-dev")
                        if isinstance(new_json.get(field, {}), dict)
                        and key in new_json.get(field, {})
                    }
                    for key in new_all
                }
                if any(old_scopes[key] != new_scopes[key] for key in old_all & new_all):
                    return False
                for field in JSON_FIELDS[name]:
                    old_values, new_values = (
                        old_json.get(field, {}),
                        new_json.get(field, {}),
                    )
                    if not isinstance(old_values, dict) or not isinstance(
                        new_values, dict
                    ):
                        return False
                    removed, added = (
                        set(old_values) - set(new_values),
                        set(new_values) - set(old_values),
                    )
                    if removed and added:
                        return False
                    if not all(
                        valid_composer_constraint(value)
                        for value in new_values.values()
                    ):
                        return False
                return True
            return only_fields(old_json, new_json, JSON_FIELDS[name])
        if name == "libs.versions.toml" or (
            name.endswith(".versions.toml") and "/gradle/" in "/" + path
        ):
            loads = toml_loader()
            if loads is None:
                return False
            old, new = loads(before), loads(after)
            allowed = {"versions", "libraries", "plugins", "bundles"}

            def stable(value):
                if isinstance(value, dict):
                    return all(stable(item) for item in value.values())
                if isinstance(value, list):
                    return all(stable(item) for item in value)
                if isinstance(value, str):
                    return not (
                        re.search(
                            r"[+*\[\]()${}]|\blatest\b|(?:^|[-.])(alpha|bet"
                            r"a|rc|dev|snapshot|canary|preview|eap|m[0-9])",
                            value,
                            re.I,
                        )
                    )
                return False

            def stable_changes(before_value, after_value):
                if before_value == after_value:
                    return True
                if isinstance(before_value, dict) and isinstance(after_value, dict):
                    if set(before_value) != set(after_value):
                        return False
                    return all(
                        stable_changes(before_value.get(key), value)
                        for key, value in after_value.items()
                    )
                return stable(after_value)

            def stable_catalog_references(before_data, after_data):
                for section in ("libraries", "plugins"):
                    old_section = before_data.get(section, {})
                    for key, value in after_data.get(section, {}).items():
                        if value == old_section.get(key):
                            continue
                        if not isinstance(value, dict):
                            continue
                        version = value.get("version")
                        if isinstance(version, dict) and "ref" in version:
                            target = after_data.get("versions", {}).get(version["ref"])
                            if not isinstance(target, str) or not stable(target):
                                return False
                return True

            def catalog_identity(data):
                data = copy.deepcopy(data)
                data["versions"] = dict.fromkeys(data.get("versions", {}))
                for section in ("libraries", "plugins"):
                    for key, value in data.get(section, {}).items():
                        if isinstance(value, dict):
                            value.pop("version", None)
                        elif isinstance(value, str):
                            data[section][key] = value.rsplit(":", 1)[0]
                return data

            return (
                set(old) <= allowed
                and set(new) <= allowed
                and stable_changes(old, new)
                and stable_catalog_references(old, new)
                and old != new
                and catalog_identity(old) == catalog_identity(new)
            )
        if name in ("pyproject.toml", "Cargo.toml", "Pipfile"):
            loads = toml_loader()
            if loads is None:
                return False
            old, new = loads(before), loads(after)
            original = old != new
            paths = {
                "pyproject.toml": [
                    (("project", "dependencies"), "list"),
                    (("project", "optional-dependencies"), "map"),
                    (("build-system", "requires"), "list"),
                    (("dependency-groups",), "map"),
                    (("tool", "poetry", "dependencies"), "map"),
                    (("tool", "poetry", "dev-dependencies"), "map"),
                ],
                "Cargo.toml": [
                    (("dependencies",), "map"),
                    (("dev-dependencies",), "map"),
                    (("build-dependencies",), "map"),
                    (("workspace", "dependencies"), "map"),
                ],
                "Pipfile": [(("packages",), "map"), (("dev-packages",), "map")],
            }[name]
            # Poetry groups contain one dependency map per named group. Keep
            # group identity and all non-dependency settings bytewise equal.
            if name == "pyproject.toml":
                old_groups = old.get("tool", {}).get("poetry", {}).get("group", {})
                new_groups = new.get("tool", {}).get("poetry", {}).get("group", {})
                if not isinstance(old_groups, dict) or not isinstance(new_groups, dict):
                    return False
                if set(old_groups) != set(new_groups):
                    return False
                paths.extend(
                    (("tool", "poetry", "group", group, "dependencies"), "map")
                    for group in old_groups
                )
            old_names, new_names = set(), set()
            old_scopes, new_scopes = {}, {}
            for path, kind in paths:
                old_value, new_value = old, new
                for key in path:
                    old_value = (
                        old_value.get(key, {}) if isinstance(old_value, dict) else {}
                    )
                    new_value = (
                        new_value.get(key, {}) if isinstance(new_value, dict) else {}
                    )
                old_names |= dependency_names(old_value, kind)
                new_names |= dependency_names(new_value, kind)
                # Poetry's `python` entry declares the interpreter/runtime,
                # rather than an installable dependency; runtime-floor edits
                # must stay under ordinary review.
                if path[:3] == ("tool", "poetry", "dependencies"):
                    if not isinstance(old_value, dict) or not isinstance(
                        new_value, dict
                    ):
                        return False
                    if old_value.get("python") != new_value.get("python"):
                        return False
                    old_names.discard("python")
                    new_names.discard("python")
                for dependency, scopes in dependency_scopes(
                    old_value, kind, path
                ).items():
                    old_scopes.setdefault(dependency, set()).update(scopes)
                for dependency, scopes in dependency_scopes(
                    new_value, kind, path
                ).items():
                    new_scopes.setdefault(dependency, set()).update(scopes)
            if old_names - new_names and new_names - old_names:
                return False
            if any(
                old_scopes[name] != new_scopes[name]
                for name in old_scopes.keys() & new_scopes.keys()
            ):
                return False
            return original and toml_dependency_change(old, new, paths)
        if name == "setup.cfg":

            def config(text):
                parser = configparser.ConfigParser(interpolation=None)
                parser.read_string(text)
                return {s: dict(parser[s]) for s in parser.sections()}

            old, new = config(before), config(after)
            changed = old != new
            dependency_sections = {
                "options": ("install_requires", "setup_requires", "tests_require"),
                "options.extras_require": None,
            }
            all_old_names, all_new_names = set(), set()
            old_scopes, new_scopes = {}, {}
            for section, keys in dependency_sections.items():
                old_section, new_section = old.get(section, {}), new.get(section, {})
                if keys is None:
                    old_values, new_values = old_section, new_section
                else:
                    old_values = {key: old_section.get(key, "") for key in keys}
                    new_values = {key: new_section.get(key, "") for key in keys}
                for key, value in old_values.items():
                    if not isinstance(value, str):
                        continue
                    for line in value.splitlines():
                        if line.strip() and not line.lstrip().startswith("#"):
                            dependency = re.split(
                                r"[<>=!~; @]", line.strip(), maxsplit=1
                            )[0].lower()
                            all_old_names.add(dependency)
                            old_scopes.setdefault(dependency, set()).add((section, key))
                for key, value in new_values.items():
                    if not isinstance(value, str):
                        continue
                    for line in value.splitlines():
                        if line.strip() and not line.lstrip().startswith("#"):
                            dependency = re.split(
                                r"[<>=!~; @]", line.strip(), maxsplit=1
                            )[0].lower()
                            all_new_names.add(dependency)
                            new_scopes.setdefault(dependency, set()).add((section, key))
            if all_old_names - all_new_names and all_new_names - all_old_names:
                return False
            if any(
                old_scopes[name] != new_scopes[name]
                for name in old_scopes.keys() & new_scopes.keys()
            ):
                return False
            for section, keys in dependency_sections.items():
                old_section, new_section = old.get(section, {}), new.get(section, {})
                if keys is None:
                    old_values, new_values = old_section, new_section
                else:
                    old_values = {key: old_section.get(key, "") for key in keys}
                    new_values = {key: new_section.get(key, "") for key in keys}
                for key, value in new_values.items():
                    old_value = old_values.get(key, "")
                    if value == old_value:
                        continue
                    values = value.splitlines() if isinstance(value, str) else []
                    all_old_names |= {
                        re.split(r"[<>=!~; @]", line.strip(), maxsplit=1)[0].lower()
                        for line in old_value.splitlines()
                        if line.strip() and not line.lstrip().startswith("#")
                    }
                    all_new_names |= {
                        re.split(r"[<>=!~; @]", line.strip(), maxsplit=1)[0].lower()
                        for line in values
                        if line.strip() and not line.lstrip().startswith("#")
                    }
                    if any(
                        not valid_requirement(line.strip())
                        for line in values
                        if line.strip() and not line.lstrip().startswith("#")
                    ):
                        return False
                    if not requirement_markers_preserved(
                        [
                            line.strip()
                            for line in old_value.splitlines()
                            if line.strip()
                        ],
                        [
                            line.strip()
                            for line in values
                            if line.strip() and not line.lstrip().startswith("#")
                        ],
                    ):
                        return False
                    old_names = {
                        re.split(r"[<>=!~; @]", line.strip(), maxsplit=1)[0].lower()
                        for line in old_value.splitlines()
                        if line.strip() and not line.lstrip().startswith("#")
                    }
                    new_names = {
                        re.split(r"[<>=!~; @]", line.strip(), maxsplit=1)[0].lower()
                        for line in values
                        if line.strip() and not line.lstrip().startswith("#")
                    }
                    if old_names - new_names and new_names - old_names:
                        return False
                    for line in values:
                        if not line.strip() or line.lstrip().startswith("#"):
                            continue
                        name = re.split(r"[<>=!~; @]", line.strip(), maxsplit=1)[
                            0
                        ].lower()
                        if name not in old_names and not requirement_has_selector(
                            line.strip()
                        ):
                            return False
            for data in (old, new):
                for key in ("install_requires", "setup_requires", "tests_require"):
                    data.get("options", {}).pop(key, None)
                data.pop("options.extras_require", None)
            return changed and old == new
    except (ValueError, TypeError, configparser.Error):  # fmt: skip
        return False
    return False


def gh(*args):
    cli = os.environ.get("REVIEW_GATE_GH", "gh")
    result = subprocess.run([cli, "api", *args], check=True, stdout=subprocess.PIPE)
    return json.loads(result.stdout)


def resolve_action_updates(files):
    """Resolve candidate action pins; target workflows execute base pins."""
    refs = set()
    for file in files:
        path = file["filename"]
        if not path.startswith(".github/workflows/") or not path.endswith(
            (".yml", ".yaml")
        ):
            continue
        for line in changed_lines(file["patch"])[1]:
            match = re.fullmatch(
                r"[ \t]*(?:-[ \t]+)?uses:[ \t]*(?P<repo>[\w.-]+/[\w.-]+)"
                r"(?:/[\w./-]+)?@(?P<ref>[0-9a-fA-F]{40}|"
                r"v?[0-9]+(?:\.[0-9]+){0,2})[ \t]*(?:#.*)?",
                line,
            )
            if match:
                refs.add((match["repo"], match["ref"]))
    for repository, ref in sorted(refs):
        resolved = gh(f"repos/{repository}/commits/{ref}").get("sha", "")
        if not SHA.fullmatch(resolved) or (
            SHA.fullmatch(ref.lower()) and resolved != ref.lower()
        ):
            raise ValueError("Updated action commit did not resolve exactly")


def content(repo, path, ref):
    data = gh(f"repos/{repo}/contents/{quote(path, safe='/')}?ref={ref}")
    if (
        data.get("type") != "file"
        or data.get("encoding") != "base64"
        or "content" not in data
    ):
        raise ValueError("GitHub did not return a regular, complete dependency file")
    raw = base64.b64decode(data["content"])
    return raw.decode("utf-8")


def classify(repo, number, head, base):
    if (
        not re.fullmatch(r"[\w.-]+/[\w.-]+", repo)
        or not re.fullmatch(r"[1-9][0-9]*", number)
        or not SHA.fullmatch(head)
        or not SHA.fullmatch(base)
    ):
        raise ValueError("Invalid candidate identity")

    def snapshot():
        pr = gh(f"repos/{repo}/pulls/{number}")
        if (
            pr["state"] != "open"
            or pr["head"]["sha"] != head
            or pr["base"]["sha"] != base
        ):
            raise ValueError("Candidate changed during dependency classification")
        return pr

    pr = snapshot()
    pages = gh(
        f"repos/{repo}/pulls/{number}/files?per_page=100", "--paginate", "--slurp"
    )
    files = [item for page in pages for item in page]
    if len(files) != pr["changed_files"] or len({f["filename"] for f in files}) != len(
        files
    ):
        raise ValueError("Incomplete dependency diff")
    if not files:
        return None
    comparison = gh(f"repos/{repo}/compare/{base}...{head}")
    ancestor = comparison["merge_base_commit"]["sha"]
    if not SHA.fullmatch(ancestor):
        raise ValueError("Missing immutable merge base")
    records = []
    base_response = gh(f"repos/{repo}/git/trees/{ancestor}?recursive=1")
    head_response = gh(f"repos/{repo}/git/trees/{head}?recursive=1")
    if base_response.get("truncated") or head_response.get("truncated"):
        return None
    base_tree = {x["path"]: x for x in base_response["tree"]}
    head_tree = {x["path"]: x for x in head_response["tree"]}
    base_blobs = {p for p, x in base_tree.items() if x.get("type") != "tree"}
    head_blobs = {p for p, x in head_tree.items() if x.get("type") != "tree"}
    listed = {f["filename"] for f in files}
    changed_paths = (base_blobs ^ head_blobs) | {
        p
        for p in base_blobs & head_blobs
        if any(
            base_tree[p].get(key) != head_tree[p].get(key)
            for key in ("sha", "type", "mode")
        )
    }
    if changed_paths != listed:
        return None
    for file in files:
        path, status = file["filename"], file["status"]
        for tree, present in (
            (base_tree, status != "added"),
            (head_tree, status != "removed"),
        ):
            entry = tree.get(path)
            if present and (
                not entry
                or entry.get("type") != "blob"
                or entry.get("mode") != "100644"
            ):
                return None  # Non-regular changes require ordinary review.
        expected_status = (
            "modified"
            if path in base_tree and path in head_tree
            else "added"
            if path in head_tree
            else "removed"
        )
        if status != expected_status:
            return None
        expected = head_tree.get(path) if status != "removed" else base_tree.get(path)
        if not expected or file.get("sha") != expected.get("sha"):
            return None
    for file in files:
        path, status = file["filename"], file["status"]
        name = PurePosixPath(path).name
        before = after = None
        # Content validation is necessary for manifests with non-dependency keys.
        requirement_file = bool(
            re.fullmatch(
                r"(?:requirements|constraints)(?:[._-][\w.-]+)?\.(?:txt|in)", name
            )
        )
        structured = (
            requirement_file
            or name in JSON_FIELDS
            or name
            in (
                "pyproject.toml",
                "Cargo.toml",
                "Pipfile",
                "setup.cfg",
                "project.pbxproj",
            )
            or name.endswith(".versions.toml")
            or name in LOCKS
            or (name == "verification-metadata.xml" and "/gradle/" in "/" + path)
        )
        if structured and status in ("modified", "added"):
            try:
                if status == "modified":
                    before = content(repo, path, ancestor)
                after = content(repo, path, head)
            except UnicodeDecodeError:
                # Binary or otherwise non-UTF8 dependency files are valid PR
                # content, but cannot receive a dependency-only exemption.
                return None
        if (
            (not structured or requirement_file)
            and name not in LOCKS
            and name != "verification-metadata.xml"
        ):
            lines = changed_lines(file.get("patch"))
            if (
                lines is None
                or len(lines[0]) != file["deletions"]
                or len(lines[1]) != file["additions"]
            ):
                return None
        if not dependency_file(path, before, after, file.get("patch"), status):
            return None
        records.append(
            {
                "path": path,
                "status": status,
                "sha": file["sha"],
                "patch": file.get("patch"),
                "before": before,
                "after": after,
            }
        )
    # Dependency-only classification is a property of the complete PR: a
    # declaration removed in one Gradle file and a different declaration added
    # in another is a replacement, even though each file is individually safe.
    removed_gradle, added_gradle = Counter(), Counter()
    removed_gradle_paths, added_gradle_paths = {}, {}
    for record in records:
        if not record["path"].endswith((".gradle", ".gradle.kts")):
            continue
        for line in (record["patch"] or "").splitlines():
            if len(line) < 2 or line[0] not in "+-" or line.startswith(("+++", "---")):
                continue
            declaration = parse_gradle_declaration(line[1:])
            if declaration is None:
                return None
            identity = declaration[:-1]
            (removed_gradle if line[0] == "-" else added_gradle)[identity] += 1
            path_map = removed_gradle_paths if line[0] == "-" else added_gradle_paths
            path_map.setdefault(identity, Counter())[record["path"]] += 1
    if removed_gradle - added_gradle and added_gradle - removed_gradle:
        return None
    for identity in removed_gradle_paths.keys() & added_gradle_paths.keys():
        if removed_gradle_paths[identity] != added_gradle_paths[identity]:
            return None
    non_gradle_manifests = [
        record
        for record in records
        if PurePosixPath(record["path"]).name in JSON_FIELDS
        or PurePosixPath(record["path"]).name
        in (
            "pyproject.toml",
            "Cargo.toml",
            "Pipfile",
            "setup.cfg",
            "Gemfile",
            "Package.swift",
        )
    ]
    # Multi-package npm updates are complete when each manifest retains its
    # dependency identities and section paths. Patch line counts are not proof:
    # a one-line JSON replacement can conceal a cross-file dependency move.
    if len(non_gradle_manifests) > 1:

        def manifest_shape(value):
            if isinstance(value, dict):
                return {key: manifest_shape(item) for key, item in value.items()}
            if isinstance(value, list):
                return [manifest_shape(item) for item in value]
            return "<VERSION>" if isinstance(value, str) else value

        for record in non_gradle_manifests:
            if PurePosixPath(record["path"]).name != "package.json":
                return None
            try:
                if manifest_shape(json.loads(record["before"])) != manifest_shape(
                    json.loads(record["after"])
                ):
                    return None
            except INVALID_LOCK:
                return None
    resolve_action_updates(files)
    final = snapshot()
    if (
        final["changed_files"] != pr["changed_files"]
        or final["base"]["ref"] != pr["base"]["ref"]
        or final["draft"] != pr["draft"]
    ):
        raise ValueError("Candidate changed during dependency classification")
    # A lockfile carries artifact source and integrity data that cannot be
    # classified from the filename/patch alone. Require its manifest change
    # in the same PR so the ordinary manifest validator binds the dependency
    # identities; lockfile-only changes stay under regular review.
    records_by_path = {record["path"]: record for record in records}
    for record in records:
        if PurePosixPath(record["path"]).name != "package.json":
            continue
        lock_candidates = [
            str(PurePosixPath(record["path"]).parent / name)
            for name in ("package-lock.json", "npm-shrinkwrap.json")
        ]
        for lock_path in lock_candidates:
            if lock_path in base_tree or lock_path in head_tree:
                if lock_path not in records_by_path:
                    return None
    for record in records:
        lock = PurePosixPath(record["path"])
        if lock.name not in LOCKS:
            continue
        if lock.name == "Package.resolved":
            candidates = []
            for parent in lock.parents:
                if parent.name.endswith(".xcodeproj"):
                    candidates = [str(parent / "project.pbxproj")]
                    break
                candidate = str(parent / "Package.swift")
                if candidate in base_tree and candidate in head_tree:
                    candidates = [candidate]
                    break
            if not candidates:
                return None
            manifest_path = candidates[0]
            manifests = []
            direct_locations = []
            for ref, tree, side in (
                (ancestor, base_tree, "before"),
                (head, head_tree, "after"),
            ):
                entry = tree.get(manifest_path, {})
                if entry.get("type") != "blob" or entry.get("mode") != "100644":
                    return None
                manifest = content(repo, manifest_path, ref)
                direct = swift_lock_matches_manifest(
                    record[side],
                    manifest,
                    PurePosixPath(manifest_path).name,
                    include_locations=True,
                )
                if direct is False:
                    return None
                direct_locations.append(direct)
                manifests.append(manifest)
            old_locations = {
                pin["location"].rstrip("/").removesuffix(".git")
                for pin in json.loads(record["before"])["pins"]
            }
            new_locations = {
                pin["location"].rstrip("/").removesuffix(".git")
                for pin in json.loads(record["after"])["pins"]
            }
            if (
                not new_locations - old_locations
                <= direct_locations[1] - direct_locations[0]
            ):
                return None
            if (
                not old_locations - new_locations
                <= direct_locations[0] - direct_locations[1]
            ):
                return None
            if (
                manifests[0] == manifests[1]
                and json.loads(record["before"])["originHash"]
                != json.loads(record["after"])["originHash"]
            ):
                return None
            continue
        if lock.name == "Gemfile.lock":
            # Direct lock requirements are validated, and remain unchanged.
            # Bind the lock to an unchanged Gemfile; additions and arbitrary
            # executable Ruby manifest changes require ordinary review.
            manifest_path = str(lock.parent / "Gemfile")
            for tree in (base_tree, head_tree):
                entry = tree.get(manifest_path, {})
                if entry.get("type") != "blob" or entry.get("mode") != "100644":
                    return None
            if base_tree[manifest_path]["sha"] != head_tree[manifest_path]["sha"]:
                return None
            manifest = content(repo, manifest_path, head)
            if not all(
                gemfile_lock_matches_manifest(record[side], manifest)
                for side in ("before", "after")
            ):
                return None
            continue
        companion = records_by_path.get(str(lock.parent / "package.json"))
        if companion is None:
            return None
        for side in ("before", "after"):
            try:
                root = json.loads(record[side])["packages"][""]
                manifest = json.loads(companion[side])
                for field in (
                    "dependencies",
                    "devDependencies",
                    "optionalDependencies",
                    "peerDependencies",
                ):
                    if root.get(field, {}) != manifest.get(field, {}):
                        return None
            except INVALID_LOCK:
                return None
    return hashlib.sha256(
        json.dumps([repo, number, head, base, records], sort_keys=True).encode()
    ).hexdigest()


def main():
    try:
        digest = classify(
            os.environ["REPO"],
            os.environ["PR_NUMBER"],
            os.environ["HEAD_SHA"],
            os.environ["BASE_SHA"],
        )
        if digest is None:
            return 3
        print(digest)
        return 0
    except (KeyError, ValueError, UnicodeError, subprocess.CalledProcessError) as error:
        print("Dependency classification failed: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
