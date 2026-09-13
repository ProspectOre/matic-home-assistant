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

        return semantic(lines[0]) != semantic(lines[1]) and all(
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
        return replacements(
            patch,
            r"""(?P<prefix>\s*(?:(?:\w*Implementation|implementation|api|ksp|kapt|classpath|\w*RuntimeOnly|runtimeOnly|compileOnly)\s*\(?["'][\w.+-]+:[\w.+-]+:))(?P<dependency>[\w.+-]+)(?P<suffix>["']\)?\s*(?://.*)?)""",
            True,
        ) or replacements(
            patch,
            r"""(?P<prefix>\s*(?:id|kotlin)\(["'][\w.-]+["']\)\s+version\s+["'])(?P<dependency>[\w.+-]+)(?P<suffix>["'](?:\s+apply\s+false)?)""",
            True,
        )
    if name == "Gemfile":
        return replacements(
            patch,
            (
                r"(?P<prefix>\s*gem\s+['\"][A-Za-z0-9_.-]+['\"])"
                r"(?:\s*,\s*['\"](?P<dependency>[A-Za-z0-9<>=~.,* _+-]+)['\"])?"
                r"(?P<suffix>(?:\s*,[^\n]*)?)"
            ),
            True,
        )
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
        return (
            before != after
            and old == new
            and bool(
                re.search(
                    r"\b(?:minimumVersion|version) = ", "\n".join(before.splitlines())
                )
            )
        )
    if status != "modified" or before is None or after is None:
        return False
    try:
        if name in JSON_FIELDS:
            if name == "manifest.json" and not path.startswith("custom_components/"):
                return False
            return only_fields(json.loads(before), json.loads(after), JSON_FIELDS[name])
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
                and stable(new)
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
                    ("project", "dependencies"),
                    ("project", "optional-dependencies"),
                    ("build-system", "requires"),
                    ("dependency-groups",),
                    ("tool", "poetry", "dependencies"),
                    ("tool", "poetry", "dev-dependencies"),
                    ("tool", "poetry", "group"),
                ],
                "Cargo.toml": [
                    ("dependencies",),
                    ("dev-dependencies",),
                    ("build-dependencies",),
                    ("workspace", "dependencies"),
                ],
                "Pipfile": [("packages",), ("dev-packages",)],
            }[name]
            for data in (old, new):
                for keys in paths:
                    target = data
                    for key in keys[:-1]:
                        target = target.get(key, {}) if isinstance(target, dict) else {}
                    if isinstance(target, dict):
                        target.pop(keys[-1], None)
            return original and old == new
        if name == "setup.cfg":

            def config(text):
                parser = configparser.ConfigParser(interpolation=None)
                parser.read_string(text)
                return {s: dict(parser[s]) for s in parser.sections()}

            old, new = config(before), config(after)
            changed = old != new
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
