import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// Photos in Matic Map: albums newest first with pixelated previews, a
// full-screen viewer that steps through every photo by button, arrow key or
// swipe, and a read that fetches nothing but this robot's photo routes.

const ROUTE = "/api/matic_robot/photo/synthetic-entry";
const shot = (id, capturedAt, { area = "Kitchen", source = "home_assistant" } = {}) => ({
  photo_id: id, captured_at: capturedAt, source, starred: false, area,
  pose: { x: 1, y: 2, heading: 0.5, mission_id: 7 },
  url: `${ROUTE}/${id}`, preview_url: `${ROUTE}/preview/${id}`,
});

const GALLERY = {
  viewpoints: [{ viewpoint_id: "v1", name: "Back door", mission_id: 7, x: 1, y: 2, heading: 0.5, room_id: "r1" }],
  albums: [
    { album: "tour-2", photos: [shot("p3", "2026-11-19T18:02:00+00:00", { area: "Hall" }), shot("p2", "2026-11-19T18:00:00+00:00")] },
    { album: "manual", photos: [shot("p1", "2026-11-18T09:00:00+00:00", { area: null, source: "matic_app" })] },
  ],
};

const mountPanel = async (page, photoGallery) => {
  const { panelTag } = await installPanelFixture(page, { photoGallery });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.testPanel = "true";
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(`${panelTag}[data-test-panel=true]`);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  return panel;
};

const openPhotos = async (panel) => {
  await panel.getByRole("button", { name: /^Photos See photos the robot took/ }).click();
  await expect(panel.getByRole("heading", { level: 2, name: "Photos" })).toBeVisible();
};

const photoReads = (page) => page.evaluate(() => window.__photoReads ?? []);

test("Photos lists albums newest first and the viewer steps through every photo", async ({ page }) => {
  const panel = await mountPanel(page, GALLERY);
  await openPhotos(panel);
  const gallery = panel.locator("matic-photo-gallery-v4");
  await expect(gallery.locator("h3")).toHaveText([/^Photo tour, /, "Single photos", "Saved viewpoints"]);
  await expect(gallery.getByRole("listitem").filter({ hasText: "Back door" })).toHaveCount(1);
  await expect(gallery.locator(".shot img")).toHaveCount(3);
  expect((await photoReads(page)).sort()).toEqual([`${ROUTE}/preview/p1`, `${ROUTE}/preview/p2`, `${ROUTE}/preview/p3`]);

  const shots = gallery.locator(".shot");
  await expect(shots.nth(0)).toHaveAccessibleName(/^Hall · /);
  await expect(shots.nth(2)).toHaveAccessibleName(/^From the Matic app · /);
  await shots.nth(0).click();
  const viewer = gallery.getByRole("dialog");
  await expect(viewer).toHaveAccessibleName(/^Hall · /);
  await expect(viewer.getByRole("img")).toHaveAccessibleName(/^Hall · /);
  await expect(viewer.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(viewer.getByRole("button", { name: "Newer" })).toBeDisabled();
  expect(await photoReads(page)).toContain(`${ROUTE}/p3`);

  await page.keyboard.press("ArrowRight");
  await expect(viewer).toHaveAccessibleName(/^Kitchen · /);
  // The tour's last photo steps on into the next album.
  await viewer.getByRole("button", { name: "Older" }).click();
  await expect(viewer).toHaveAccessibleName(/^From the Matic app · /);
  await expect(viewer.getByRole("button", { name: "Older" })).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toHaveAccessibleName(/^Kitchen · /);

  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // Escape closed the viewer only; Photos stays open with focus on the first photo opened.
  await expect(panel.getByRole("heading", { level: 2, name: "Photos" })).toBeVisible();
  await expect(shots.nth(0)).toBeFocused();
  const reads = (await photoReads(page)).filter((path) => !path.includes("/preview/"));
  expect(reads).toEqual([`${ROUTE}/p3`, `${ROUTE}/p2`, `${ROUTE}/p1`, `${ROUTE}/p2`]);
});

test("on a phone the viewer fills the screen and a swipe turns the photo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await mountPanel(page, GALLERY);
  await openPhotos(panel);
  const gallery = panel.locator("matic-photo-gallery-v4");
  await gallery.locator(".shot").nth(0).click();
  const viewer = gallery.getByRole("dialog");
  await expect(viewer.getByRole("img")).toBeVisible();
  expect(await viewer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });

  const swipe = async (from, to) => {
    await page.mouse.move(from, 420);
    await page.mouse.down();
    await page.mouse.move(to, 420, { steps: 4 });
    await page.mouse.up();
  };
  await swipe(300, 80);
  await expect(viewer).toHaveAccessibleName(/^Kitchen · /);
  await swipe(80, 300);
  await expect(viewer).toHaveAccessibleName(/^Hall · /);
  // A short drag is a tap, not a swipe.
  await swipe(200, 180);
  await expect(viewer).toHaveAccessibleName(/^Hall · /);
});

test("Photos explains an empty library and offers Try again after a failed read", async ({ page }) => {
  const panel = await mountPanel(page, { viewpoints: [], albums: [] });
  await openPhotos(panel);
  const gallery = panel.locator("matic-photo-gallery-v4");
  await expect(gallery).toContainText("No photos yet. Press Take photo, or run a photo tour from an automation.");
  await expect(gallery.locator("h3")).toHaveCount(0);

  // A photo link outside this robot's photo route fails the whole read, and nothing is fetched.
  await page.evaluate((route) => {
    window.__photoGalleryReply = { viewpoints: [], albums: [{ album: "manual", photos: [{
      photo_id: "p1", captured_at: "2026-11-18T09:00:00+00:00", source: "home_assistant", starred: false, area: null, pose: null,
      url: "/api/elsewhere/p1", preview_url: `${route}/preview/p1`,
    }] }] };
  }, ROUTE);
  await panel.getByRole("button", { name: "Back to all tasks" }).click();
  await openPhotos(panel);
  await expect(gallery.getByRole("alert")).toHaveText("Couldn't load the photos.");
  expect(await photoReads(page)).toEqual([]);

  await page.evaluate(() => { window.__photoGalleryReply = null; });
  await gallery.getByRole("button", { name: "Try again" }).click();
  await expect(gallery).toContainText("No photos yet.");
});
