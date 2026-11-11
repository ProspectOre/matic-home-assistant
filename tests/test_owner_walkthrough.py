"""The interface stage matrix: one cell list for the script, the stage and the guide."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).parents[1]
CELLS = json.loads((ROOT / "scripts" / "walkthrough_cells.json").read_text())
DOC = " ".join((ROOT / "docs" / "testing.md").read_text().split())
GALLERY = (
    ROOT / "frontend" / "map-studio-v4-review" / "gallery-scenarios.ts"
).read_text()


def _quoted_list(name: str) -> set[str]:
    """The string literals of one exported array in gallery-scenarios.ts."""
    match = re.search(rf"export const {name}\b[^=]*= \[(.*?)\];", GALLERY, re.S)
    assert match, name
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def test_matrix_is_thirteen_journeys_by_nine_setups() -> None:
    # UX9 appended R12 (Your areas) and R13 (Home shortcuts); earlier IDs stay.
    assert [row["id"] for row in CELLS["rows"]] == [f"R{n:02}" for n in range(1, 14)]
    assert [col["id"] for col in CELLS["columns"]] == [f"C{n:02}" for n in range(1, 10)]


def test_every_step_names_a_gallery_scenario_and_dialog() -> None:
    scenarios = _quoted_list("GALLERY_SCENARIOS")
    dialogs = _quoted_list("GALLERY_DIALOGS")
    for row in CELLS["rows"]:
        for step in row["steps"]:
            scenario, _, dialog = step.partition(":")
            assert scenario in scenarios, (row["id"], step)
            assert not dialog or dialog in dialogs, (row["id"], step)


def test_every_cell_says_what_to_check() -> None:
    """The cell list replaced the guide's tables, so it must stand alone."""
    for row in CELLS["rows"]:
        assert row["journey"].strip() and row["check"].strip(), row["id"]
    for column in CELLS["columns"]:
        assert column["setup"].strip() and column["hash"].strip(), column["id"]


def test_testing_guide_matches_the_cell_list_and_the_command() -> None:
    rows, columns = len(CELLS["rows"]), len(CELLS["columns"])
    assert f"{rows} journeys and {columns} setups, {rows * columns} cells" in DOC
    assert "npm run stage:walkthrough -- R01-C01" in DOC
    assert "scripts/walkthrough_cells.json" in DOC
    package = json.loads((ROOT / "package.json").read_text())
    script = package["scripts"]["stage:walkthrough"]
    assert script == "node scripts/stage_walkthrough.mjs"
