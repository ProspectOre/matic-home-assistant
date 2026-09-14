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
from pathlib import PurePosixPath
from urllib.parse import quote

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
    for field in fields:
        old_values, new_values = before.get(field, {}), after.get(field, {})
        if old_values == new_values:
            continue
        if not isinstance(old_values, dict) or not isinstance(new_values, dict):
            return False
        removed_names = set(old_values) - set(new_values)
        added_names = set(new_values) - set(old_values)
        if removed_names and added_names:
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
                if not valid_nested_constraints(old) or not valid_nested_constraints(new):
                    return False
            elif field == "peerDependenciesMeta":
                if old is None:
                    old = {}
                if not valid_peer_metadata(old) or not valid_peer_metadata(new):
                    return False
            elif not valid_npm_constraint(old) or not valid_npm_constraint(new):
                return False
    return True


NPM_VERSION = r"[0-9]+(?:\.[0-9xX*]+){0,2}(?:[-+][0-9A-Za-z.-]+)?"
NPM_COMPARATOR = rf"[~^<>=]*\s*{NPM_VERSION}"


def valid_npm_constraint(value):
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


def valid_nested_constraints(value):
    if isinstance(value, str):
        return valid_npm_constraint(value)
    if isinstance(value, dict):
        return all(valid_nested_constraints(item) for item in value.values())
    return False


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
        r"[+*\[\]()]|latest[.]|(?:^|[-.])(alpha|beta|rc|dev|snapshot|canary|preview|eap|m[0-9])",
        value,
        re.I,
    )


def valid_requirement(value):
    if not isinstance(value, str) or any(token in value.lower() for token in ("://", "git+", "file:", "path:", " @ ")):
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?(?:\s*(?:===|==|~=|!=|<=|>=|<|>|\^|~)\s*[0-9xX*][^;#]*)?(?:\s*;[^#]+)?", value.strip()))


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
    return True


def valid_composer_constraint(value):
    return isinstance(value, str) and not any(
        token in value.lower() for token in ("://", "git-", "dev-")
    ) and bool(re.fullmatch(r"[0-9A-Za-z*+<>=~^|., _-]+", value.strip()))


def valid_toml_constraint(value):
    """Accept registry version constraints while rejecting source redirects."""
    if not isinstance(value, str):
        return False
    lowered = value.strip().lower()
    if not lowered or any(token in lowered for token in ("://", "git", "path", "file:")):
        return False
    return bool(re.fullmatch(r"[0-9A-Za-zxX*.+<>=~^|, _-]+", value.strip()))


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
            if any(key != "version" and key not in ("version_constraint",) for key in value):
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
    old_names = {re.split(r"[<>=!~; @]", value, 1)[0].strip().lower() for value in old_values}
    new_names = {re.split(r"[<>=!~; @]", value, 1)[0].strip().lower() for value in new_values}
    if old_names - new_names and new_names - old_names:
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


def replacements(patch, pattern, preserve_structure=False, immutable_refs=False):
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


def dependency_file(path, before, after, patch, status="modified"):
    """Pure policy. Contents are immutable GitHub blobs, never local PR files."""
    name = PurePosixPath(path).name
    if (
        status not in ("modified", "added", "removed")
        or path.startswith("/")
        or ".." in PurePosixPath(path).parts
    ):
        return False
    if name in LOCKS:
        return status != "removed"
    if path.startswith(".github/workflows/") and name.endswith((".yml", ".yaml")):
        return replacements(
            patch,
            (
                r"(?P<prefix>[ \t]*(?:-[ \t]+)?uses:[ \t]*[\w.-]+/"
                r"[\w./-]+@)(?P<dependency>(?:[0-9a-fA-F]{40}|v?[0-9]+(?:\.[0-9]+){0,2}))"
                r"(?P<suffix>[ \t]*)(?:#.*)?"
            ),
            True,
            immutable_refs=True,
        )
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
                # Security configuration and trusted keys must remain bytewise
                # equivalent; only component/artifact checksum records may vary.
                for child in list(root):
                    if local(child.tag) == "components":
                        root.remove(child)
                    else:
                        child.tail = None
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

            return before != after and valid_components(old) and valid_components(new)
        except ET.ParseError:
            return False
    if re.fullmatch(r"(?:requirements|constraints)(?:[._-][\w.-]+)?\.(?:txt|in)", name):
        lines = changed_lines(patch)
        if status != "modified" or lines is None:
            return False

        def semantic(values):
            return [
                line.split("#", 1)[0].strip()
                for line in values
                if line.split("#", 1)[0].strip()
            ]

        old_values, new_values = semantic(lines[0]), semantic(lines[1])
        old_names = {
            re.split(r"[<>=!~; @]", value, 1)[0].strip().lower()
            for value in old_values
        }
        new_names = {
            re.split(r"[<>=!~; @]", value, 1)[0].strip().lower()
            for value in new_values
        }
        # A pure add or removal is a dependency update; replacing one package
        # with another must remain under ordinary review.
        if old_names - new_names and new_names - old_names:
            return False
        return old_values != new_values and all(
            not line.strip()
            or line.lstrip().startswith("#")
            or re.fullmatch(
                r"\s*[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?\s*(?:(?:===|==|~=|!=|<=|>=|<|>)[^;#\n]+)?(?:\s*;[^#\n]+)?(?:\s*#.*)?",
                line,
            )
            for line in lines[0] + lines[1]
        )
    if name in (
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
    ):
        # Keep this deliberately bounded: interpolation/executable Gradle
        # expressions are never dependency-only version changes.
        direct = replacements(
            patch,
            r"""(?P<prefix>\s*(?:(?:\w*Implementation|implementation|api|ksp|kapt|classpath|\w*RuntimeOnly|runtimeOnly|compileOnly)\s*\(?["'][\w.+-]+:[\w.+-]+:))(?P<dependency>[\w.+-]+)(?P<suffix>["']\)?\s*(?://.*)?)""",
            True,
        ) or replacements(
            patch,
            r"""(?P<prefix>\s*(?:id|kotlin)\(["'][\w.-]+["']\)\s+version\s+["'])(?P<dependency>[\w.+-]+)(?P<suffix>["'](?:\s+apply\s+false)?)""",
            True,
        )
        if not direct:
            return False
        changed = changed_lines(patch)
        return all(
            stable_version(match.group("dependency"))
            for line in (changed[1] if changed else [])
            for match in [re.search(r""":(?P<dependency>[\w.+-]+)["']?\)?\s*(?://.*)?$""", line)]
            if match
        )
    if name == "Gemfile":
        lines = changed_lines(patch)
        if lines and not lines[0] and lines[1]:
            declaration = (
                r"\s*gem\s+['\"][A-Za-z0-9_.-]+['\"]"
                r"(?:\s*,\s*['\"][0-9<>=~.,* _+-]+['\"])?\s*"
            )
            return all(re.fullmatch(declaration, line) for line in lines[1])
        return replacements(
            patch,
            (
                r"(?P<prefix>\s*gem\s+['\"][A-Za-z0-9_.-]+['\"])"
                r"(?:\s*,\s*['\"](?P<dependency>[A-Za-z0-9<>=~.,* _+-]+)['\"])?"
                r"(?P<suffix>(?:\s*,[^\n]*)?)"
            ),
            True,
        )
    if name == "Package.swift":
        lines = changed_lines(patch)
        if status not in ("modified", "added", "removed") or lines is None:
            return False
        package_line = re.compile(r"^\s*\.package\s*\((?P<body>[^()]*)\)\s*,?\s*$")

        def parse(values):
            result = []
            for line in values:
                match = package_line.fullmatch(line)
                if not match:
                    return None
                body = match.group("body")
                if re.search(r"\b(?:path|branch|revision)\s*:", body):
                    return None
                identity = re.search(r"\b(?:url|name)\s*:\s*[\"']([^\"']+)[\"']", body)
                if not identity:
                    return None
                normalized = re.sub(
                    r"\b(?:from|exact|upToNextMajor|upToNextMinor)\s*:\s*[\"']?[0-9A-Za-z.+_-]+[\"']?",
                    lambda m: re.sub(r"[\"']?[0-9A-Za-z.+_-]+[\"']?$", "<VERSION>", m.group(0)),
                    body,
                )
                result.append((identity.group(1), normalized, body))
            return result

        old_values, new_values = parse(lines[0]), parse(lines[1])
        if old_values is None or new_values is None:
            return False
        old_ids, new_ids = [item[0] for item in old_values], [item[0] for item in new_values]
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
                        r"^([ \t]*kind = )[A-Za-z0-9]+(;[ \t]*)$",
                        r"\1<KIND>\2",
                        line,
                    )
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
        if before != after and old == new and re.search(
            r"\b(?:minimumVersion|version) = ", "\n".join(before.splitlines())
        ):
            return True

        def remote_entries(text):
            match = re.search(
                r"/\* Begin XCRemoteSwiftPackageReference section \*/(?P<body>.*?)/\* End XCRemoteSwiftPackageReference section \*/",
                text,
                re.S,
            )
            if not match:
                return None, None
            entries = {}
            current = []
            for line in match.group("body").splitlines():
                if re.match(r"\s*[A-Fa-f0-9]+ /\* XCRemoteSwiftPackageReference \"[^\"]+\" \*/ = \{", line):
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
                        if re.search(r"\b(?:branch|revision|exactVersion|upToNextMajorVersion|upToNextMinorVersion)\s*=", block) is None and "requirement =" not in block:
                            return None, None
                        normalized_block = re.sub(
                            r"(\bkind = )[A-Za-z0-9]+;", r"\1<KIND>;", block
                        )
                        normalized_block = re.sub(
                            r"(\b(?:minimumVersion|maximumVersion|version) = )\"?[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?\"?;",
                            r"\1<VERSION>;",
                            normalized_block,
                        )
                        entries[identity.group(1)] = normalized_block
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
        removed, added = set(old_entries) - set(new_entries), set(new_entries) - set(old_entries)
        if removed and added:
            return False
        for identity in set(old_entries) & set(new_entries):
            if old_entries[identity] != new_entries[identity]:
                return False
        if not (removed or added):
            return False

        def scrub(text):
            text = text.replace(
                old_section if old_section and old_section in text else new_section,
                "/* XCRemoteSwiftPackageReference section elided */",
            )
            # Xcode updates these references alongside the package dictionary.
            text = re.sub(
                r"^[ \t]*[^\n]*XCRemoteSwiftPackageReference[^\n]*\n", "", text, flags=re.M
            )
            product = re.compile(
                r"/\* Begin XCSwiftPackageProductDependency section \*/.*?/\* End XCSwiftPackageProductDependency section \*/",
                re.S,
            )
            return product.sub("/* XCSwiftPackageProductDependency section elided */", text)

        return scrub(before) == scrub(after)
    if status != "modified" or before is None or after is None:
        return False
    try:
        if name in JSON_FIELDS:
            if name == "manifest.json" and not path.startswith("custom_components/"):
                return False
            old_json, new_json = json.loads(before), json.loads(after)
            if name == "package.json":
                return package_constraints(old_json, new_json, JSON_FIELDS[name])
            if name == "manifest.json":
                if not only_fields(old_json, new_json, JSON_FIELDS[name]):
                    return False
                old_req, new_req = old_json.get("requirements", []), new_json.get("requirements", [])
                if not isinstance(old_req, list) or not isinstance(new_req, list):
                    return False
                old_names = {re.split(r"[<>=!~; @]", item, 1)[0].strip().lower() for item in old_req if isinstance(item, str)}
                new_names = {re.split(r"[<>=!~; @]", item, 1)[0].strip().lower() for item in new_req if isinstance(item, str)}
                return not (old_names - new_names and new_names - old_names) and all(valid_requirement(item) for item in new_req)
            if name == "composer.json":
                if not only_fields(old_json, new_json, JSON_FIELDS[name]):
                    return False
                for field in JSON_FIELDS[name]:
                    old_values, new_values = old_json.get(field, {}), new_json.get(field, {})
                    if not isinstance(old_values, dict) or not isinstance(new_values, dict):
                        return False
                    removed, added = set(old_values) - set(new_values), set(new_values) - set(old_values)
                    if removed and added:
                        return False
                    if not all(valid_composer_constraint(value) for value in new_values.values()):
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
                            r"[+*\[\]()]|latest[.]|(?:^|[-.])(alpha|beta|rc|dev|snapshot|canary|preview|eap|m[0-9])",
                            value,
                            re.I,
                        )
                    )
                return False

            def stable_changes(before_value, after_value):
                if before_value == after_value:
                    return True
                if isinstance(before_value, dict) and isinstance(after_value, dict):
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
                    if any(not valid_requirement(line.strip()) for line in values if line.strip() and not line.lstrip().startswith("#")):
                        return False
                    old_names = {re.split(r"[<>=!~; @]", line.strip(), 1)[0].lower() for line in old_value.splitlines() if line.strip() and not line.lstrip().startswith("#")}
                    new_names = {re.split(r"[<>=!~; @]", line.strip(), 1)[0].lower() for line in values if line.strip() and not line.lstrip().startswith("#")}
                    if old_names - new_names and new_names - old_names:
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
    """Target workflows execute base pins, so resolve accepted candidate pins explicitly."""
    refs = set()
    for file in files:
        path = file["filename"]
        if not path.startswith(".github/workflows/") or not path.endswith((".yml", ".yaml")):
            continue
        for line in changed_lines(file["patch"])[1]:
            match = re.fullmatch(
                r"[ \t]*(?:-[ \t]+)?uses:[ \t]*(?P<repo>[\w.-]+/[\w.-]+)"
                r"(?:/[\w./-]+)?@(?P<ref>[0-9a-fA-F]{40}|v?[0-9]+(?:\.[0-9]+){0,2})[ \t]*(?:#.*)?", line)
            if match:
                refs.add((match["repo"], match["ref"]))
    for repository, ref in sorted(refs):
        resolved = gh(f"repos/{repository}/commits/{ref}").get("sha", "")
        if not SHA.fullmatch(resolved) or (SHA.fullmatch(ref.lower()) and resolved != ref.lower()):
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
        structured = (
            name in JSON_FIELDS
            or name
            in (
                "pyproject.toml",
                "Cargo.toml",
                "Pipfile",
                "setup.cfg",
                "project.pbxproj",
            )
            or name.endswith(".versions.toml")
            or (name == "verification-metadata.xml" and "/gradle/" in "/" + path)
        )
        if structured and status == "modified":
            before = content(repo, path, ancestor)
            after = content(repo, path, head)
        if not structured and name not in LOCKS and name != "verification-metadata.xml":
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
    resolve_action_updates(files)
    final = snapshot()
    if (
        final["changed_files"] != pr["changed_files"]
        or final["base"]["ref"] != pr["base"]["ref"]
        or final["draft"] != pr["draft"]
    ):
        raise ValueError("Candidate changed during dependency classification")
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
