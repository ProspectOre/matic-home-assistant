import { expect, test } from "@playwright/test";

// A saved plan room that a map edit in the Matic app removed: Run says why
// the plan can't run, Edit marks the room, and taking it out lets it save.

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

async function loadGallery(page, scenario) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async ({ tag, selectedScenario }) => {
    await import("/map_studio_v4-review/review.js");
    await customElements.whenDefined(tag);
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = selectedScenario;
    document.body.style.margin = "0";
    document.body.append(gallery);
  }, { tag: GALLERY_TAG, selectedScenario: scenario });
  const gallery = page.locator(GALLERY_TAG);
  await expect(gallery.locator("matic-map-workflow-v4")).toBeAttached();
  return gallery;
}

test("a plan room no longer on the map is named in Run and removed in Edit", async ({ page }) => {
  const gallery = await loadGallery(page, "plan-run-room-missing");
  const notOnMap = "Removed or renumbered in the Matic app · Remove it from this plan";
  const rows = gallery.locator("ul.run-list > li");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText("Room not on the map");
  await expect(rows.nth(3)).toContainText(notOnMap);
  await expect(gallery.getByText(
    "Can't run this plan until you remove the rooms that are no longer on the map. Open Edit to remove them.",
  ).first()).toBeVisible();

  await gallery.locator(".problem + button", { hasText: "Edit" }).click();
  expect(await gallery.evaluate((element) => element.getWorkspaceSnapshot().planView)).toBe("edit");
  const list = gallery.getByRole("list", { name: "Rooms", exact: true });
  const stale = list.getByRole("button", { name: "Settings for Room not on the map", exact: true });
  await expect(stale).toContainText(notOnMap);
  await list.getByRole("checkbox", { name: "Include Room not on the map", exact: true }).click();
  await expect(list.getByText("Room not on the map")).toHaveCount(0);
  const draft = await gallery.evaluate((element) => element.getWorkspaceSnapshot().planDraft);
  expect(draft.rooms.map((room) => room.roomId)).not.toContain("room-gone");
});
