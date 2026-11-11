"""The release steps: version check, zip, notes and candidate pruning."""

from __future__ import annotations

import json
import re
import subprocess
import zipfile
from pathlib import Path

import pytest

from scripts import release
from scripts.check_fresh_install import FreshInstallError, check_fresh_install

INTEGRATION = release.INTEGRATION.as_posix()
# Every release on GitHub on November 11, 2026, with its pre-release flag. Each
# has a tag and no tag lacks a release.
PUBLISHED = {
    f"v{version}": False
    for version in (
        "0.1.0 0.1.1 0.1.2 0.2.0 0.2.1 0.2.2 0.2.3 0.3.0 0.3.1 0.3.2 0.3.3 0.3.4 "
        "0.3.5 0.3.6 0.3.7 0.3.8 0.3.9 0.3.10 0.3.11 0.3.12 0.4.0 0.4.1 0.4.2 "
        "0.4.3 0.4.4 0.4.5 0.4.6 0.4.7 0.4.8 0.5.0 0.5.1 0.5.2 0.5.3"
    ).split()
} | {"v0.5.4-beta2": True}


def _write(root: Path, files: dict[str, str]) -> None:
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)


def _git(root: Path, *arguments: str) -> None:
    identity = ["-c", "user.name=t", "-c", "user.email=t@example.com"]
    subprocess.run(["git", "-C", str(root), *identity, *arguments], check=True)


@pytest.fixture
def checkout(tmp_path: Path) -> Path:
    """A committed checkout of version 0.6.0b1 with its panel built."""
    _write(
        tmp_path,
        {
            ".gitignore": (
                "__pycache__/\n"
                f"{INTEGRATION}/matic_icons.js\n"
                f"{INTEGRATION}/map_studio_v4/*\n"
            ),
            "pyproject.toml": '[project]\nversion = "0.6.0b1"\n',
            "docs/release-notes-0.6.0-beta1.md": "# Matic 0.6 beta 1\n\nNotes.\n",
            f"{INTEGRATION}/manifest.json": json.dumps({"version": "0.6.0b1"}),
            f"{INTEGRATION}/client/api.py": "",
        },
    )
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "c")
    _write(
        tmp_path,
        {
            f"{INTEGRATION}/matic_icons.js": "icons",
            f"{INTEGRATION}/map_studio_v4/index.js": "panel",
            f"{INTEGRATION}/map_studio_v4/chunks/a.js": "chunk",
        },
    )
    return tmp_path


@pytest.mark.parametrize(
    ("tag", "final", "version"),
    [
        ("v0.6.0", "0.6.0", "0.6.0"),
        ("v0.6.0-beta1", "0.6.0", "0.6.0b1"),
        ("v0.5.0-rc43", "0.5.0", "0.5.0rc43"),
        ("v0.4.4.1-beta1", "0.4.4.1", "0.4.4.1b1"),
    ],
)
def test_a_tag_names_its_version(tag: str, final: str, version: str) -> None:
    assert release.versions(tag) == (final, version)


@pytest.mark.parametrize(
    "tag", ["0.6.0", "v0.6", "v0.6.0b1", "v0.6.0-beta", "v0.6.0-alpha1", "v0.6.0 "]
)
def test_any_other_tag_is_refused(tag: str) -> None:
    with pytest.raises(release.ReleaseError, match=r"is not vX\.Y\.Z"):
        release.versions(tag)


@pytest.mark.parametrize(
    ("tag", "branch"), [("v0.6.0-beta1", "release/0.6"), ("v0.6.0-beta1", "main")]
)
def test_check_accepts_a_tag_the_checkout_agrees_with(
    checkout: Path, tag: str, branch: str
) -> None:
    release.check(tag, branch, PUBLISHED, checkout)


@pytest.mark.parametrize(
    ("tag", "branch", "files", "refusal"),
    [
        ("v0.6.0-beta2", "release/0.6", {}, "needs version 0.6.0b2: manifest.json"),
        (
            "v0.6.0-beta1",
            "release/0.6",
            {"pyproject.toml": '[project]\nversion = "0.6.0"\n'},
            "pyproject.toml has 0.6.0",
        ),
        ("v0.6.0-beta1", "feature/map", {}, "cannot be published from feature/map"),
        (
            "v0.6.0",
            "release/0.6",
            {
                "pyproject.toml": '[project]\nversion = "0.6.0"\n',
                f"{INTEGRATION}/manifest.json": '{"version": "0.6.0"}',
            },
            "a stable version comes from main",
        ),
        (
            "v0.6.0-beta1",
            "main",
            {"docs/release-notes-0.6.0-beta1.md": "Matic 0.6 beta 1\n"},
            "must start with '# Title'",
        ),
    ],
)
def test_check_refuses_a_tag_the_checkout_contradicts(
    checkout: Path, tag: str, branch: str, files: dict[str, str], refusal: str
) -> None:
    _write(checkout, files)
    with pytest.raises(release.ReleaseError, match=refusal):
        release.check(tag, branch, PUBLISHED, checkout)


def test_check_refuses_an_existing_tag_and_missing_notes(checkout: Path) -> None:
    with pytest.raises(release.ReleaseError, match=r"v0\.6\.0-beta1 already exists"):
        release.check("v0.6.0-beta1", "main", {"v0.6.0-beta1"}, checkout)
    (checkout / "docs/release-notes-0.6.0-beta1.md").unlink()
    with pytest.raises(
        release.ReleaseError, match=r"docs/release-notes-0\.6\.0-beta1\.md is missing"
    ):
        release.check("v0.6.0-beta1", "main", PUBLISHED, checkout)


def test_the_version_on_this_branch_has_its_tag_and_notes() -> None:
    """A version without release notes would only fail when it is published."""
    manifest = json.loads((release.ROOT / INTEGRATION / "manifest.json").read_text())
    stages = {short: stage for stage, short in release.STAGES.items()}
    tag = "v" + re.sub(
        r"(b|rc)(\d+)$", lambda m: f"-{stages[m[1]]}{m[2]}", manifest["version"]
    )

    release.check(tag, "main", PUBLISHED)
    title, body = release.notes(tag)
    assert title.startswith("Matic ")
    assert body.strip() and not body.startswith("#")


def test_the_zip_holds_the_tracked_integration_and_the_built_panel(
    checkout: Path, tmp_path: Path
) -> None:
    """HACS extracts the zip into custom_components/matic_robot as it is."""
    _write(
        checkout,
        {
            f"{INTEGRATION}/.storage/map": "private",
            f"{INTEGRATION}/untracked.py": "",
            f"{INTEGRATION}/__pycache__/api.pyc": "",
            "README.md": "outside the integration",
        },
    )
    archive = tmp_path / "out" / "matic_robot.zip"

    digest = release.build_zip(archive, checkout)

    with zipfile.ZipFile(archive) as bundle:
        assert bundle.namelist() == [
            "client/api.py",
            "manifest.json",
            "map_studio_v4/chunks/a.js",
            "map_studio_v4/index.js",
            "matic_icons.js",
        ]
        assert bundle.read("map_studio_v4/index.js") == b"panel"
    (checkout / INTEGRATION / "manifest.json").touch()
    assert release.build_zip(archive, checkout) == digest


@pytest.mark.parametrize("missing", ["matic_icons.js", "map_studio_v4/index.js"])
def test_no_zip_without_the_built_panel(
    checkout: Path, tmp_path: Path, missing: str
) -> None:
    (checkout / INTEGRATION / missing).unlink()
    with pytest.raises(release.ReleaseError, match="npm run build:map-studio-v4"):
        release.build_zip(tmp_path / "matic_robot.zip", checkout)


def test_the_zip_of_this_checkout_loads_as_an_installed_integration(
    tmp_path: Path,
) -> None:
    archive = tmp_path / "matic_robot.zip"
    release.build_zip(archive)

    check_fresh_install(archive)
    with zipfile.ZipFile(archive) as bundle:
        names = set(bundle.namelist())
    panel = release.ROOT / release.PANEL[1]
    assert names >= {
        path.relative_to(release.ROOT / INTEGRATION).as_posix()
        for path in panel.rglob("*")
        if path.is_file()
    }
    assert not any("__pycache__" in name for name in names)


def test_a_zip_without_the_panel_fails_the_install_check(tmp_path: Path) -> None:
    archive = tmp_path / "matic_robot.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("manifest.json", "{}")
    with pytest.raises(FreshInstallError, match="failed the import check"):
        check_fresh_install(archive)


@pytest.mark.parametrize(
    ("tag", "retired"),
    [
        # Candidates of another version are not this version's to retire.
        ("v0.6.0-beta1", []),
        ("v0.6.0", []),
        ("v0.5.4-beta3", ["v0.5.4-beta2"]),
        ("v0.5.4-rc1", ["v0.5.4-beta2"]),
        ("v0.5.4", ["v0.5.4-beta2"]),
        ("v0.5.4-beta2", []),
    ],
)
def test_pruning_the_published_releases(tag: str, retired: list[str]) -> None:
    """A dry run against what GitHub held on November 11, 2026."""
    assert release.superseded(tag, PUBLISHED, PUBLISHED) == retired


def test_pruning_retires_every_other_candidate_of_the_version() -> None:
    releases = PUBLISHED | {"v0.6.0-beta1": True, "v0.6.0-rc1": True, "v0.6.0": False}
    tags = [*releases, "v0.6.0-beta2", "v0.6.1-beta1", "v0.6.0-beta", "nightly"]
    candidates = ["v0.6.0-beta1", "v0.6.0-beta2", "v0.6.0-rc1"]

    assert release.superseded("v0.6.0-rc2", releases, tags) == candidates
    assert release.superseded("v0.6.0", releases, tags) == candidates
    assert release.superseded("v0.6.0-beta2", releases, tags) == [
        "v0.6.0-beta1",
        "v0.6.0-rc1",
    ]


@pytest.mark.parametrize("tag", [*PUBLISHED, "v0.5.4", "v0.6.0-beta1", "v0.6.0"])
def test_pruning_never_names_a_stable_release(tag: str) -> None:
    stable = {name for name, prerelease in PUBLISHED.items() if not prerelease}
    assert stable.isdisjoint(release.superseded(tag, PUBLISHED, PUBLISHED))


def test_pruning_stops_at_a_candidate_tag_on_a_stable_release() -> None:
    releases = PUBLISHED | {"v0.6.0-beta1": False}
    with pytest.raises(release.ReleaseError, match="nothing was deleted"):
        release.superseded("v0.6.0-beta2", releases, releases)


class FakeGitHub:
    """Answers the two list requests and records every other command."""

    def __init__(self, releases: dict[str, bool], tags: dict[str, str]) -> None:
        self.releases = releases
        self.tags = tags
        self.commands: list[tuple[str, ...]] = []

    def __call__(self, *command: str) -> list[str]:
        if command[1:3] == ("api", "--paginate"):
            if command[3].endswith("/releases"):
                return [
                    f"{tag} {str(pre).lower()}" for tag, pre in self.releases.items()
                ]
            return [f"refs/tags/{tag} {sha}" for tag, sha in self.tags.items()]
        self.commands.append(command)
        return ["https://github.com/example/releases/tag/new"]


def test_prune_prints_each_candidate_before_deleting_it(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    releases = PUBLISHED | {"v0.6.0-beta1": True, "v0.6.0-beta3": True}
    tags = {tag: f"sha-{tag}" for tag in [*releases, "v0.6.0-beta2"]}
    github = FakeGitHub(releases, tags)
    monkeypatch.setattr(release, "_lines", github)

    release.prune("v0.6.0-beta3")

    assert capsys.readouterr().out.splitlines() == [
        "Deleting candidate v0.6.0-beta1 at sha-v0.6.0-beta1",
        "Deleting candidate v0.6.0-beta2 at sha-v0.6.0-beta2",
    ]
    assert github.commands == [
        ("gh", "release", "delete", "v0.6.0-beta1", "--cleanup-tag", "--yes"),
        (
            *("gh", "api", "--method", "DELETE"),
            "repos/{owner}/{repo}/git/refs/tags/v0.6.0-beta2",
        ),
    ]


def test_prune_deletes_nothing_when_a_candidate_is_published_as_stable(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    releases = PUBLISHED | {"v0.6.0-beta1": False}
    github = FakeGitHub(releases, dict.fromkeys(releases, "sha"))
    monkeypatch.setattr(release, "_lines", github)

    assert release.main(["prune", "v0.6.0"]) == 1

    assert github.commands == []
    assert "::error::v0.6.0-beta1" in capsys.readouterr().out


@pytest.mark.parametrize(
    ("tag", "notes", "flags"),
    [
        ("v0.6.0-beta1", "docs/release-notes-0.6.0-beta1.md", ("--prerelease",)),
        ("v0.6.0", "docs/release-notes-0.6.0.md", ()),
    ],
)
def test_publish_creates_the_release_from_the_zip_and_its_notes(
    checkout: Path,
    monkeypatch: pytest.MonkeyPatch,
    tag: str,
    notes: str,
    flags: tuple[str, ...],
) -> None:
    _write(checkout, {notes: "# Matic 0.6\n\nFirst paragraph.\n\n## More\n"})
    github = FakeGitHub({}, {})
    monkeypatch.setattr(release, "_lines", github)
    monkeypatch.setenv("GITHUB_SHA", "c" * 40)

    release.publish(tag, checkout)

    assert github.commands == [
        (
            *("gh", "release", "create", tag, str(checkout / release.ARCHIVE)),
            *("--target", "c" * 40, "--title", "Matic 0.6"),
            *("--notes", "First paragraph.\n\n## More\n", *flags),
        )
    ]


def test_each_step_runs_from_the_command_line(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    ran: list[tuple[object, ...]] = []
    monkeypatch.setattr(release, "build_zip", lambda: "0" * 64)
    monkeypatch.setattr(release, "remote_tags", lambda: {"v0.5.3": "sha"})
    monkeypatch.setattr(release, "check", lambda *arguments: ran.append(arguments))
    monkeypatch.setattr(release, "publish", lambda tag: ran.append(("publish", tag)))
    monkeypatch.setenv("GITHUB_REF_NAME", "release/0.6")

    assert release.main(["zip"]) == 0
    assert release.main(["check", "v0.6.0-beta1"]) == 0
    assert release.main(["publish", "v0.6.0-beta1"]) == 0

    assert capsys.readouterr().out == f"dist/matic_robot.zip sha256:{'0' * 64}\n"
    assert ran == [
        ("v0.6.0-beta1", "release/0.6", {"v0.5.3": "sha"}),
        ("publish", "v0.6.0-beta1"),
    ]


def test_remote_tags_are_read_through_the_github_cli(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(release, "_lines", FakeGitHub({}, {"v0.5.3": "abc"}))
    assert release.remote_tags() == {"v0.5.3": "abc"}
