#!/usr/bin/env python3
"""The steps of a release. Test runs `zip`; release.yml runs all four.

check TAG    the tag, manifest.json, pyproject.toml and branch agree
zip          build dist/matic_robot.zip, the file HACS installs
publish TAG  create the GitHub release from the zip and its notes
prune TAG    delete the candidates that TAG supersedes
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tomllib
import zipfile
from collections.abc import Iterable, Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = Path("custom_components/matic_robot")
# .gitignore ignores exactly what `npm run build:map-studio-v4` writes here.
PANEL = (INTEGRATION / "matic_icons.js", INTEGRATION / "map_studio_v4")
ARCHIVE = Path("dist/matic_robot.zip")
TAG = re.compile(
    r"v(?P<final>\d+(?:\.\d+){2,3})(?:-(?P<stage>beta|rc)(?P<number>\d+))?"
)
STAGES = {"beta": "b", "rc": "rc"}
# gh fills in the repository it runs for.
API = "repos/{owner}/{repo}"


class ReleaseError(RuntimeError):
    """The release cannot go ahead as asked."""


def versions(tag: str) -> tuple[str, str]:
    """Return the final version a tag belongs to and the version it carries."""
    if (match := TAG.fullmatch(tag)) is None:
        raise ReleaseError(f"{tag} is not vX.Y.Z, vX.Y.Z-betaN or vX.Y.Z-rcN")
    stage = match["stage"]
    suffix = f"{STAGES[stage]}{match['number']}" if stage else ""
    return match["final"], match["final"] + suffix


def notes(tag: str, root: Path = ROOT) -> tuple[str, str]:
    """Return the release title and body from the notes file for a tag."""
    path = root / "docs" / f"release-notes-{tag.removeprefix('v')}.md"
    if not path.is_file():
        raise ReleaseError(f"{path.relative_to(root)} is missing")
    title, _, body = path.read_text(encoding="utf-8").partition("\n")
    if not title.startswith("# "):
        raise ReleaseError(f"{path.relative_to(root)} must start with '# Title'")
    return title.removeprefix("# "), body.strip() + "\n"


def check(tag: str, branch: str, existing: Iterable[str], root: Path = ROOT) -> None:
    """Refuse a tag that the checkout, its branch or the remote contradicts."""
    final, version = versions(tag)
    manifest = json.loads((root / INTEGRATION / "manifest.json").read_text())
    project = tomllib.loads((root / "pyproject.toml").read_text())["project"]
    if not manifest["version"] == project["version"] == version:
        raise ReleaseError(
            f"{tag} needs version {version}: manifest.json has "
            f"{manifest['version']}, pyproject.toml has {project['version']}"
        )
    if branch != "main" and (version == final or not branch.startswith("release/")):
        raise ReleaseError(
            f"{tag} cannot be published from {branch}: a stable version comes "
            "from main, a candidate from main or a release branch"
        )
    if tag in existing:
        raise ReleaseError(f"{tag} already exists")
    notes(tag, root)


def shipped_files(root: Path = ROOT) -> list[str]:
    """Return what HACS unpacks: the tracked integration and the built panel."""
    tracked = _lines("git", "-C", str(root), "ls-files", "--", str(INTEGRATION))
    built = _lines(
        *("git", "-C", str(root), "ls-files"),
        *("--others", "--ignored", "--exclude-standard", "--", *map(str, PANEL)),
    )
    if not {str(PANEL[0]), str(PANEL[1] / "index.js")} <= set(built):
        raise ReleaseError("Matic Map is not built: run npm run build:map-studio-v4")
    return sorted({*tracked, *built})


def build_zip(archive: Path = ROOT / ARCHIVE, root: Path = ROOT) -> str:
    """Write the zip HACS extracts into custom_components/matic_robot.

    Entries carry no build time, so one commit gives one SHA-256 on one
    toolchain. Returns that digest.
    """
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w") as bundle:
        for name in shipped_files(root):
            entry = zipfile.ZipInfo(Path(name).relative_to(INTEGRATION).as_posix())
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            bundle.writestr(entry, (root / name).read_bytes())
    return hashlib.sha256(archive.read_bytes()).hexdigest()


def superseded(
    tag: str, releases: Mapping[str, bool], tags: Iterable[str]
) -> list[str]:
    """Return the candidates a published tag retires: the others of its version.

    Only a tag ending in -betaN or -rcN is a candidate, so a stable tag is
    never returned, and a release GitHub does not mark as a pre-release stops
    the run before anything is deleted.
    """
    final, _ = versions(tag)
    candidates = sorted(
        name
        for name in {*releases, *tags} - {tag}
        if (match := TAG.fullmatch(name)) and match["stage"] and match["final"] == final
    )
    if stable := [name for name in candidates if not releases.get(name, True)]:
        raise ReleaseError(
            f"{', '.join(stable)}: a candidate's tag on a release that is not "
            "a pre-release; nothing was deleted"
        )
    return candidates


def remote_tags() -> dict[str, str]:
    """Return the object each v* tag on GitHub points at."""
    rows = _lines(
        *("gh", "api", "--paginate", f"{API}/git/matching-refs/tags/v"),
        *("--jq", r'.[] | "\(.ref) \(.object.sha)"'),
    )
    return {ref.removeprefix("refs/tags/"): sha for ref, sha in map(str.split, rows)}


def publish(tag: str, root: Path = ROOT) -> None:
    """Create the release and its tag at the commit the workflow built."""
    title, body = notes(tag, root)
    final, version = versions(tag)
    created = _lines(
        *("gh", "release", "create", tag, str(root / ARCHIVE)),
        *("--target", os.environ["GITHUB_SHA"], "--title", title, "--notes", body),
        *([] if version == final else ["--prerelease"]),
    )
    print(*created, sep="\n")


def prune(tag: str) -> None:
    """Print, then delete, the release and tag of each superseded candidate."""
    rows = _lines(
        *("gh", "api", "--paginate", f"{API}/releases"),
        *("--jq", r'.[] | "\(.tag_name) \(.prerelease)"'),
    )
    releases = {name: flag == "true" for name, flag in map(str.split, rows)}
    tags = remote_tags()
    retired = superseded(tag, releases, tags)
    for name in retired:
        print(f"Deleting candidate {name} at {tags.get(name, 'no tag')}", flush=True)
    for name in retired:
        if name in releases:
            _lines("gh", "release", "delete", name, "--cleanup-tag", "--yes")
        else:
            _lines("gh", "api", "--method", "DELETE", f"{API}/git/refs/tags/{name}")


def _lines(*command: str) -> list[str]:
    result = subprocess.run(command, check=True, stdout=subprocess.PIPE, text=True)
    return result.stdout.splitlines()


def main(arguments: list[str] | None = None) -> int:
    """Run one step; a refusal prints one error line and fails."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    steps = parser.add_subparsers(dest="step", required=True)
    steps.add_parser("zip")
    for step in ("check", "publish", "prune"):
        steps.add_parser(step).add_argument("tag")
    selected = parser.parse_args(arguments)
    try:
        if selected.step == "zip":
            print(f"{ARCHIVE} sha256:{build_zip()}")
        elif selected.step == "check":
            check(selected.tag, os.environ["GITHUB_REF_NAME"], remote_tags())
        elif selected.step == "publish":
            publish(selected.tag)
        else:
            prune(selected.tag)
    except ReleaseError as error:
        print(f"::error::{error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
