"""The guides stay small, linked from the index and free of dead links."""

import re
from pathlib import Path

from tests.test_release_metadata import _DENYLIST

ROOT = Path(__file__).parents[1]
DOCS = ROOT / "docs"
GUIDES = sorted(DOCS.rglob("*.md"))
PAGES = [
    ROOT / "README.md",
    ROOT / "CONTRIBUTING.md",
    ROOT / "SECURITY.md",
    ROOT / "AGENTS.md",
    *GUIDES,
]
MAX_LINES = 150
_FENCE = re.compile(r"```.*?```", re.DOTALL)
_TARGET = re.compile(r"\]\(([^)\s]+)\)")
_SHIPPED = re.compile(r"docs/[a-z0-9-]+\.md(?:#[a-z0-9_-]+)?")


def _anchors(page: Path) -> set[str]:
    """The heading and explicit anchors GitHub gives a Markdown page."""
    text = _FENCE.sub("", page.read_text())
    found = set(re.findall(r'<a id="([^"]+)"', text))
    for heading in re.findall(r"^#{1,6} +(.+)$", text, re.MULTILINE):
        words = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", heading.strip().lower())
        slug = re.sub(r"[^\w\- ]", "", words).replace(" ", "-")
        found.add(slug if slug not in found else f"{slug}-1")
    return found


def _broken(source: Path, target: str) -> bool:
    path, _, anchor = target.partition("#")
    page = (source.parent / path).resolve() if path else source
    if not page.exists():
        return True
    return bool(anchor) and page.suffix == ".md" and anchor not in _anchors(page)


def test_relative_links_and_anchors_resolve() -> None:
    broken = [
        f"{page.relative_to(ROOT)} -> {target}"
        for page in PAGES
        for target in _TARGET.findall(_FENCE.sub("", page.read_text()))
        if not re.match(r"[a-z]+:", target) and _broken(page, target)
    ]
    assert broken == []


def test_links_the_integration_ships_resolve() -> None:
    """Repairs, setup steps and blueprints point at guides by path and anchor."""
    sources = [
        *(ROOT / "custom_components" / "matic_robot").rglob("*.py"),
        *(ROOT / "custom_components" / "matic_robot").glob("*.json"),
        *(ROOT / "blueprints").rglob("*.yaml"),
    ]
    shipped = {link for path in sources for link in _SHIPPED.findall(path.read_text())}
    assert "docs/cleaning.md#custom-areas" in shipped
    assert [link for link in sorted(shipped) if _broken(ROOT / "README.md", link)] == []


def test_every_file_in_docs_is_reachable() -> None:
    index = (DOCS / "README.md").read_text()
    listed = set(_TARGET.findall(index))
    guides = {guide.relative_to(DOCS).as_posix() for guide in GUIDES} - {"README.md"}
    assert sorted(guides - {target.partition("#")[0] for target in listed}) == []
    pages = "".join(page.read_text() for page in PAGES)
    for other in DOCS.rglob("*"):
        if other.is_file() and other.suffix != ".md":
            assert f"docs/{other.relative_to(DOCS).as_posix()}" in pages, other


def test_guides_stay_short() -> None:
    """Release notes are published text on their way to a GitHub release."""
    long = {
        str(page.relative_to(ROOT)): lines
        for page in (ROOT / "README.md", *GUIDES)
        if not page.name.startswith("release-notes-")
        and (lines := len(page.read_text().splitlines())) >= MAX_LINES
    }
    assert long == {}


def test_copy_style_denylist_is_the_one_the_tests_enforce() -> None:
    guide = (DOCS / "copy-style.md").read_text()
    table = guide.split("| Never write | Say instead |", 1)[1].split("\n\n", 1)[0]
    rows = [line.split("|")[1] for line in table.splitlines()[2:]]
    documented = {term.strip() for row in rows for term in row.split(",")}
    assert documented == set(_DENYLIST)
    assert "every word starting `verif`" in guide
