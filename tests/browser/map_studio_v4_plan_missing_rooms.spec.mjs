import { expect, test } from "@playwright/test";

// A saved plan room that a map edit in the Matic app re-created with a new
// ID: Run cleans the rest and names the skipped room, and Edit moves it to
// the room now on the map with its name, keeping its settings.

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

test("a re-created plan room is skipped in Run and moved in Edit", async ({ page }) => {
  const gallery = await loadGallery(page, "plan-run-room-missing");
  await expect(gallery.locator("ul.run-list > li, ol.run-list > li")).toHaveCount(3);
  await expect(gallery.locator("[data-missing-rooms]")).toHaveText(
    "Not on the map, so this run skips: Bedroom. Edit the plan to update them.",
  );

  await gallery.getByRole("button", { name: /^Edit / }).click();
  const list = gallery.getByRole("list", { name: "Rooms", exact: true });
  const stale = list.locator("li", { has: page.locator("[data-room-missing]") });
  await expect(stale).toContainText("Bedroom");
  await expect(stale).toContainText("Removed or renumbered in the Matic app · Runs skip it");
  await stale.getByRole("button", { name: "Use the new Bedroom", exact: true }).click();

  await expect(list.locator("[data-room-missing]")).toHaveCount(0);
  await expect(list.locator("[data-room-relink]")).toHaveCount(0);
  const draft = await gallery.evaluate((element) => element.getWorkspaceSnapshot().planDraft);
  expect(draft.dirty).toBe(true);
  const moved = draft.rooms.at(-1);
  expect(moved.roomId).not.toBe("room-gone");
  expect(moved).toMatchObject({ cleaningMode: "vacuum", coverageSetting: "quick" });
  expect(draft.rooms.filter((room) => room.roomId === moved.roomId)).toHaveLength(1);
});
