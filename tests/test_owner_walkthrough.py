"""The owner walkthrough matrix: one cell list for the doc, the script and the stage."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).parents[1]
CELLS = json.loads((ROOT / "scripts" / "walkthrough_cells.json").read_text())
DOC = (ROOT / "docs" / "owner-walkthrough-0.5.md").read_text()
GALLERY = (
    ROOT / "frontend" / "map-studio-v4-review" / "gallery-scenarios.ts"
).read_text()


def _quoted_list(name: str) -> set[str]:
    """The string literals of one exported array in gallery-scenarios.ts."""
    match = re.search(rf"export const {name}\b[^=]*= \[(.*?)\];", GALLERY, re.S)
    assert match, name
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def _table_rows(heading: str) -> list[list[str]]:
    """The body rows of the first Markdown table under a level-2 heading."""
    section = DOC.split(f"## {heading}\n", 1)[1].split("\n## ", 1)[0]
    lines = [line for line in section.splitlines() if line.startswith("|")]
    return [[cell.strip() for cell in line.strip("|").split("|")] for line in lines[2:]]


def test_matrix_is_thirteen_journeys_by_nine_setups() -> None:
    # UX9 appended R12 (Your areas) and R13 (Home shortcuts); earlier IDs stay.
    assert [row["id"] for row in CELLS["rows"]] == [f"R{n:02}" for n in range(1, 14)]
    assert [col["id"] for col in CELLS["columns"]] == [f"C{n:02}" for n in range(1, 10)]
    assert "117 cells" in DOC


def test_every_step_names_a_gallery_scenario_and_dialog() -> None:
    scenarios = _quoted_list("GALLERY_SCENARIOS")
    dialogs = _quoted_list("GALLERY_DIALOGS")
    for row in CELLS["rows"]:
        for step in row["steps"]:
            scenario, _, dialog = step.partition(":")
            assert scenario in scenarios, (row["id"], step)
            assert not dialog or dialog in dialogs, (row["id"], step)


def test_doc_tables_match_the_cell_list() -> None:
    rows = _table_rows("Journeys (rows)")
    assert [(r[0], r[1], r[2]) for r in rows] == [
        (row["id"], row["journey"], f"`steps={','.join(row['steps'])}`")
        for row in CELLS["rows"]
    ]
    columns = _table_rows("Setups (columns)")
    assert [(c[0], c[1], c[2]) for c in columns] == [
        (col["id"], col["setup"], f"`{col['hash']}`") for col in CELLS["columns"]
    ]


def test_sign_off_rule_and_links() -> None:
    assert "does not require one owner response per cell" in DOC
    assert "npm run stage:walkthrough -- R01-C01" in DOC
    package = json.loads((ROOT / "package.json").read_text())
    script = package["scripts"]["stage:walkthrough"]
    assert script == "node scripts/stage_walkthrough.mjs"
    acceptance = (ROOT / "docs" / "acceptance-0.5.md").read_text()
    gate = next(line for line in acceptance.splitlines() if line.startswith("| E6 — "))
    assert "(owner-walkthrough-0.5.md)" in gate
