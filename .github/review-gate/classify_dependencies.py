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
            old_present = name in old_values
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
                if old_present and old != new:
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
    return bool(
        re.fullmatch(
            r"[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?"
            r"(?:\s*(?:===\s*[^;#\s][^;#]*|(?:==|~=|"
            r"!=|<=|>=|<|>|\^|~)\s*[0-9xX*][^;#]*))?"
            r"(?:\s*;[^#]+)?",
            value.strip(),
        )
    )


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
    return (
        isinstance(value, str)
        and not any(token in value.lower() for token in ("://", "git-", "dev-"))
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


def npm_version_satisfies(version, constraint):
    """Evaluate the bounded stable-selector grammar; unknown ranges need review."""
    if not isinstance(constraint, str) or not re.fullmatch(
        r"[0-9]+\.[0-9]+\.[0-9]+", version
    ):
        return False
    actual = tuple(map(int, version.split(".")))
    for branch in constraint.split("||"):
        branch = branch.strip()
        if branch == "*":
            return True
        match = re.fullmatch(r"([~^=]?)([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?", branch)
        if not match:
            continue
        operator, major, minor, patch = match.groups()
        lower = (int(major), int(minor or 0), int(patch or 0))
        if operator == "^":
            if lower[0]:
                upper = (lower[0] + 1, 0, 0)
            elif minor is None:
                upper = (1, 0, 0)
            elif lower[1]:
                upper = (0, lower[1] + 1, 0)
            elif patch is None:
                upper = (0, 1, 0)
            else:
                upper = (0, 0, lower[2] + 1)
        elif minor is None:
            upper = (lower[0] + 1, 0, 0)
        elif operator == "~" or patch is None:
            upper = (lower[0], lower[1] + 1, 0)
        else:
            if actual == lower:
                return True
            continue
        if lower <= actual < upper:
            return True
    return False


def npm_lock_update(before, after):
    """Allow registry version updates, binding artifact identity and checksums.

    npm v3 is the supported grammar. Other schemas and newly introduced lock
    files need review until their source semantics have dedicated validators.
    """

    def parse(text):
        value = json.loads(text)
        if not isinstance(value, dict) or value.get("lockfileVersion") != 3:
            raise ValueError("unsupported lock schema")
        packages = value.get("packages")
        if not isinstance(packages, dict) or "" not in packages:
            raise ValueError("missing package map")
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
                    isinstance(key, str) and valid_npm_constraint(version)
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
                r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", version
            ):
                raise ValueError("non-registry version")
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
        for path, node in packages.items():
            for field in ("dependencies", "devDependencies", "optionalDependencies"):
                for identity, constraint in node.get(field, {}).items():
                    # Resolve npm's nearest ancestor node_modules entry.
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
                    target = next(
                        (packages[p] for p in candidates if p in packages), None
                    )
                    if target is None:
                        if field == "optionalDependencies":
                            continue
                        raise ValueError("missing graph dependency")
                    if not npm_version_satisfies(target["version"], constraint):
                        raise ValueError("unvalidated dependency range")
        return value

    try:
        old, new = parse(before), parse(after)
        old_packages, new_packages = old.pop("packages"), new.pop("packages")
        if old != new or old_packages.keys() - new_packages.keys():
            return False
        # Root executable metadata must not change with dependency versions.
        dependency_fields = {
            "dependencies",
            "devDependencies",
            "optionalDependencies",
            "peerDependencies",
        }
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
                    metadata.pop(field)
            if metadata_old != metadata_new:
                return False
            if old_node["version"] == new_node["version"] and (
                old_node["resolved"] != new_node["resolved"]
                or old_node["integrity"] != new_node["integrity"]
            ):
                return False
        # New transitive graph shapes need review; root package additions are
        # bound to the companion manifest by classify().
        new_root = new_packages[""]
        root_names = set().union(
            *(set(new_root.get(field, {})) for field in dependency_fields)
        )
        for path in new_packages.keys() - old_packages.keys():
            if path not in {f"node_modules/{name}" for name in root_names}:
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
    if name in LOCKS:
        # Unknown lock grammars cannot grant an executable-source exemption.
        if name not in ("package-lock.json", "npm-shrinkwrap.json"):
            return False
        if status != "modified" or before is None or after is None:
            return False
        return npm_lock_update(before, after)
    if path.startswith(".github/workflows/") and name.endswith((".yml", ".yaml")):
        return replacements(
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
        return old_values != new_values and all(
            not line.split("#", 1)[0].strip()
            or valid_requirement_line(line.split("#", 1)[0].strip())
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
            return bool(changed) and all(
                re.fullmatch(declaration, line) for line in changed
            )
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
                    if not match:
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
            return old_kinds == new_kinds and old_versions != new_versions

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
            old_version = re.findall(
                r"\b(?:minimumVersion|maximumVersion|version) = \"?("
                r"[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?)\"?;",
                old_raw,
            )
            new_version = re.findall(
                r"\b(?:minimumVersion|maximumVersion|version) = \"?("
                r"[0-9]+(?:\.[0-9]+){1,2}(?:[-+][A-Za-z0-9.-]+)?)\"?;",
                new_raw,
            )
            if old_kind != new_kind and old_version == new_version:
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
                return not (old_names - new_names and new_names - old_names) and all(
                    valid_requirement(item) for item in new_req
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
                            r"[+*\[\]()${}]|latest[.]|(?:^|[-.])(alpha|bet"
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
            or name in LOCKS
            or (name == "verification-metadata.xml" and "/gradle/" in "/" + path)
        )
        if structured and status in ("modified", "added"):
            if status == "modified":
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
    # Dependency-only classification is a property of the complete PR: a
    # declaration removed in one Gradle file and a different declaration added
    # in another is a replacement, even though each file is individually safe.
    removed_gradle, added_gradle = Counter(), Counter()
    for record in records:
        if not record["path"].endswith((".gradle", ".gradle.kts")):
            continue
        for line in (record["patch"] or "").splitlines():
            if len(line) < 2 or line[0] not in "+-" or line.startswith(("+++", "---")):
                continue
            declaration = parse_gradle_declaration(line[1:])
            if declaration is None:
                return None
            (removed_gradle if line[0] == "-" else added_gradle)[declaration[:-1]] += 1
    if removed_gradle - added_gradle and added_gradle - removed_gradle:
        return None
    # For non-Gradle manifests, the per-file validators intentionally allow a
    # pure add or removal. Across files that loses section and package scope,
    # so require ordinary review rather than attempting to infer equivalence.
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
    if len(non_gradle_manifests) > 1:
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
        lock = PurePosixPath(record["path"])
        if lock.name not in LOCKS:
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
