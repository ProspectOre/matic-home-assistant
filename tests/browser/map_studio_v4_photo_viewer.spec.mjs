import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// The photo viewer's tools: Star keeps a photo past the library's limits,
// Download saves the full photo, and Compare with earlier puts the newest
// earlier photo of the same view beside the open one.

const ROUTE = "/api/matic_robot/photo/synthetic-entry";
const AT_DOOR = { x: 1, y: 2, heading: 0.5, mission_id: 7 };
const shot = (id, capturedAt, { area = "Hall", pose = AT_DOOR, starred = false } = {}) => ({
  photo_id: id, captured_at: capturedAt, source: "home_assistant", starred, area, pose,
  url: `${ROUTE}/${id}`, preview_url: `${ROUTE}/preview/${id}`,
});
const GALLERY = {
  map: null,
  viewpoints: [],
  albums: [{ album: "manual", photos: [
    shot("now", "2026-11-19T18:00:00+00:00"),
    // 0.3 m away and 20° turned: the same view.
    shot("near", "2026-11-19T12:00:00+00:00", { pose: { ...AT_DOOR, x: 1.3, heading: 0.85 } }),
    // Same spot, facing the other way.
    shot("turned", "2026-11-19T11:00:00+00:00", { pose: { ...AT_DOOR, heading: 2.5 } }),
    shot("before", "2026-11-18T09:00:00+00:00", { starred: true }),
    // Two photos without a pose compare by area.
    shot("den-new", "2026-11-17T09:00:00+00:00", { area: "Den", pose: null }),
    shot("den-old", "2026-11-16T09:00:00+00:00", { area: "Den", pose: null }),
  ] }],
};

const mount = async (page) => {
  const { panelTag } = await installPanelFixture(page, { photoGallery: GALLERY });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    document.body.append(panel);
    await customElements.whenDefined(tag);
  }, panelTag);
  const panel = page.locator(panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  await panel.getByRole("button", { name: /^Photos See photos the robot took/ }).click();
  const gallery = panel.locator("matic-photo-gallery-v4");
  await expect(gallery.locator(".shot img")).toHaveCount(6);
  return gallery;
};
const open = async (gallery, index) => {
  await gallery.locator(".shot").nth(index).click();
  const viewer = gallery.getByRole("dialog");
  await expect(viewer.getByRole("img")).toHaveCount(1);
  return viewer;
};
const stars = (page) => page.evaluate(() => window.__photoStars ?? []);

test("Star marks a photo to keep, on the viewer and its tile, and says when the limit is reached", async ({ page }) => {
  const gallery = await mount(page);
  await expect(gallery.locator(".shot").nth(3)).toHaveAccessibleName(/, starred$/);
  await expect(gallery.locator(".shot").nth(0)).not.toHaveAccessibleName(/starred/);

  const viewer = await open(gallery, 0);
  const star = viewer.getByRole("button", { name: "Star" });
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  expect(await stars(page)).toEqual([{ method: "PUT", path: "/api/matic_robot/photo_gallery/synthetic-entry/photos/now/star", body: { starred: true } }]);
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");

  await page.evaluate(() => { window.__photoStarReply = { status: 409, body: { error: "star_limit" } }; });
  await star.click();
  await expect(viewer.getByRole("alert")).toHaveText("100 photos are starred. Unstar one to star this one.");
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => { window.__photoStarReply = { status: 500 }; });
  await star.click();
  await expect(viewer.getByRole("alert")).toHaveText("Couldn't change the star. Try again.");
  // The next photo starts without the last one's message.
  await viewer.getByRole("button", { name: "Older" }).click();
  await expect(viewer.getByRole("alert")).toHaveCount(0);

  await page.evaluate(() => { window.__photoStarReply = undefined; });
  await viewer.getByRole("button", { name: "Star" }).click();
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(gallery.locator(".shot").nth(1)).toHaveAccessibleName(/, starred$/);
});

test("Download saves the full photo under its capture time", async ({ page }) => {
  const gallery = await mount(page);
  const viewer = await open(gallery, 0);
  const download = viewer.getByRole("link", { name: "Download" });
  await expect(download).toHaveAttribute("download", "matic-photo-2026-11-19T18-00-00.webp");
  await expect(download).toHaveAttribute("href", /^blob:/);
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toBe("matic-photo-2026-11-19T18-00-00.webp");
});

test("Compare with earlier shows the newest earlier photo of the same view beside the open one", async ({ page }) => {
  const gallery = await mount(page);
  const viewer = await open(gallery, 0);
  await viewer.getByRole("button", { name: "Compare with earlier" }).click();
  // The turned photo shares the spot but not the view, so "near" is chosen.
  await expect(viewer.getByRole("img")).toHaveCount(2);
  await expect(viewer.locator("figcaption")).toHaveText([/^Hall · /, /^Hall · /]);
  const reads = await page.evaluate(() => window.__photoReads);
  expect(reads).toContain(`${ROUTE}/near`);
  expect(reads).not.toContain(`${ROUTE}/turned`);
  await viewer.getByRole("button", { name: "Show one photo" }).click();
  await expect(viewer.getByRole("img")).toHaveCount(1);

  // Stepping on ends the comparison.
  await viewer.getByRole("button", { name: "Compare with earlier" }).click();
  await viewer.getByRole("button", { name: "Older" }).click();
  await expect(viewer.getByRole("img")).toHaveCount(1);
  // "near" has "before" at the same view; "turned" has nothing like it earlier.
  await expect(viewer.getByRole("button", { name: "Compare with earlier" })).toBeVisible();
  await viewer.getByRole("button", { name: "Older" }).click();
  await expect(viewer.getByRole("button", { name: "Compare with earlier" })).toHaveCount(0);
  await viewer.getByRole("button", { name: "Older" }).click();
  await expect(viewer.getByRole("button", { name: "Compare with earlier" })).toHaveCount(0);
  // Without a pose, photos of the same area compare.
  await viewer.getByRole("button", { name: "Older" }).click();
  await viewer.getByRole("button", { name: "Compare with earlier" }).click();
  await expect(viewer.locator("figcaption")).toHaveText([/^Den · Nov 16/, /^Den · Nov 17/]);
});

test("on a phone the compared photos stack and the tools stay on screen @mobile", async ({ page }) => {
  const gallery = await mount(page);
  const viewer = await open(gallery, 0);
  await viewer.getByRole("button", { name: "Compare with earlier" }).click();
  await expect(viewer.getByRole("img")).toHaveCount(2);
  const [first, second] = await viewer.locator("figure").evaluateAll((figures) => figures.map((figure) => figure.getBoundingClientRect().toJSON()));
  expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1);
  const viewport = page.viewportSize();
  for (const name of ["Star", "Show one photo", "Older"]) {
    const box = await viewer.getByRole("button", { name }).boundingBox();
    expect(box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath("compare-mobile.png") });
});
