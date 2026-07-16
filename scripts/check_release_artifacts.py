#!/usr/bin/env python3
"""Verify release archives contain exactly the current integration source."""

from __future__ import annotations

import argparse
import tarfile
import zipfile
from collections.abc import Iterable
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "custom_components" / "matic_robot"
ARCHIVE_MARKER = "custom_components/matic_robot/"
FORBIDDEN_PARTS = {"__pycache__", ".DS_Store", ".private", "captures", "www"}


class ArtifactError(RuntimeError):
    """A built release archive does not match the public source tree."""


def source_integration_files(integration: Path = INTEGRATION) -> set[str]:
    """Return every public integration file that must ship."""
    return {
        path.relative_to(integration).as_posix()
        for path in integration.rglob("*")
        if path.is_file()
        and path.suffix != ".pyc"
        and not FORBIDDEN_PARTS.intersection(path.relative_to(integration).parts)
    }


def _integration_members(names: Iterable[str]) -> set[str]:
    """Normalize integration members from a wheel or source archive."""
    members: set[str] = set()
    for name in names:
        normalized = PurePosixPath(name)
        if normalized.is_absolute() or ".." in normalized.parts:
            raise ArtifactError(f"Unsafe archive member: {name}")
        if ARCHIVE_MARKER not in name or name.endswith("/"):
            continue
        relative = name.split(ARCHIVE_MARKER, 1)[1]
        if relative:
            members.add(relative)
    return members


def artifact_integration_files(artifact: Path) -> set[str]:
    """Return integration files stored in one supported release archive."""
    if artifact.suffix == ".whl":
        with zipfile.ZipFile(artifact) as archive:
            return _integration_members(archive.namelist())
    if artifact.name.endswith(".tar.gz"):
        with tarfile.open(artifact, "r:gz") as archive:
            return _integration_members(
                member.name for member in archive.getmembers() if member.isfile()
            )
    raise ArtifactError(f"Unsupported release artifact: {artifact.name}")


def validate_artifact(artifact: Path, expected: set[str]) -> None:
    """Require an archive to contain exactly the expected integration files."""
    actual = artifact_integration_files(artifact)
    forbidden = sorted(
        path
        for path in actual
        if FORBIDDEN_PARTS.intersection(PurePosixPath(path).parts)
    )
    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    problems: list[str] = []
    if missing:
        problems.append(f"missing: {', '.join(missing)}")
    if unexpected:
        problems.append(f"unexpected: {', '.join(unexpected)}")
    if forbidden:
        problems.append(f"forbidden: {', '.join(forbidden)}")
    if problems:
        raise ArtifactError(f"{artifact.name}: {'; '.join(problems)}")


def check_release_directory(directory: Path) -> list[Path]:
    """Validate the single wheel and source archive in a release directory."""
    wheels = sorted(directory.glob("*.whl"))
    source_archives = sorted(directory.glob("*.tar.gz"))
    if len(wheels) != 1 or len(source_archives) != 1:
        raise ArtifactError(
            "Release directory must contain exactly one wheel and one .tar.gz "
            f"source archive; found {len(wheels)} wheel(s) and "
            f"{len(source_archives)} source archive(s)"
        )
    expected = source_integration_files()
    artifacts = [*wheels, *source_archives]
    for artifact in artifacts:
        validate_artifact(artifact, expected)
    return artifacts


def main() -> int:
    """Run the release-artifact gate."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    artifacts = check_release_directory(args.directory)
    for artifact in artifacts:
        print(f"Release artifact verified: {artifact}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
