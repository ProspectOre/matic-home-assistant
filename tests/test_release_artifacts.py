"""Built release archive validation tests."""

import tarfile
import zipfile
from pathlib import Path

import pytest

from scripts.check_release_artifacts import (
    ArtifactError,
    artifact_integration_files,
    check_release_directory,
    source_integration_files,
    validate_artifact,
)

MARKER = "custom_components/matic_robot/"


def _wheel(path: Path, files: set[str]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for filename in files:
            archive.writestr(f"{MARKER}{filename}", filename)
    return path


def _source_archive(path: Path, files: set[str]) -> Path:
    staging = path.parent / "staging"
    for filename in files:
        target = staging / "project-0.1.0" / MARKER / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(filename)
    with tarfile.open(path, "w:gz") as archive:
        archive.add(staging / "project-0.1.0", arcname="project-0.1.0")
    return path


def test_release_artifact_gate_accepts_exact_archives(tmp_path, monkeypatch) -> None:
    expected = {"__init__.py", "manifest.json"}
    wheel = _wheel(tmp_path / "project-0.1.0-py3-none-any.whl", expected)
    source = _source_archive(tmp_path / "project-0.1.0.tar.gz", expected)
    monkeypatch.setattr(
        "scripts.check_release_artifacts.source_integration_files",
        lambda: expected,
    )

    assert check_release_directory(tmp_path) == [wheel, source]
    assert artifact_integration_files(wheel) == expected
    assert artifact_integration_files(source) == expected


def test_release_artifact_gate_rejects_stale_dashboard_card(tmp_path) -> None:
    artifact = _wheel(
        tmp_path / "project-0.1.0-py3-none-any.whl",
        {"__init__.py", "www/matic-robot-card.js"},
    )

    with pytest.raises(ArtifactError, match=r"matic-robot-card\.js"):
        validate_artifact(artifact, {"__init__.py"})


def test_source_files_ignore_generated_macos_metadata(tmp_path) -> None:
    (tmp_path / "__init__.py").write_text("")
    (tmp_path / ".DS_Store").write_bytes(b"Finder metadata")

    assert source_integration_files(tmp_path) == {"__init__.py"}


def test_release_directory_requires_one_archive_of_each_type(tmp_path) -> None:
    _wheel(tmp_path / "project-0.1.0-py3-none-any.whl", {"__init__.py"})

    with pytest.raises(ArtifactError, match="exactly one wheel"):
        check_release_directory(tmp_path)
