import { expect, test } from "@playwright/test";
import { build } from "esbuild";

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
  map: { map_session_key: "a".repeat(64), mission_id: 7 },
  viewpoints: [
    { viewpoint_id: "v1", name: "Back door", mission_id: 7, x: 1, y: 2, heading: 0.5, room_id: "r1" },
    // Saved on another floor's map, so not drawn on this one.
    { viewpoint_id: "v2", name: "Landing", mission_id: 8, x: 0, y: 0, heading: 0, room_id: "r9" },
  ],
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
  // The viewpoints on this floor's map go to the map canvas.
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().photoMarks)).toEqual({
    mapSessionKey: "a".repeat(64), viewpoints: [{ id: "v1", name: "Back door", x: 1, y: 2, heading: 0.5 }],
  });
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
  // WebKit lays out 100dvh a fraction of a pixel short.
  const box = await viewer.boundingBox();
  expect(Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value)]))).toEqual({ x: 0, y: 0, width: 390, height: 844 });

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
  const panel = await mountPanel(page, { map: null, viewpoints: [], albums: [] });
  await openPhotos(panel);
  const gallery = panel.locator("matic-photo-gallery-v4");
  await expect(gallery).toContainText("No photos yet. Press Take photo, or run a photo tour from an automation.");
  await expect(gallery.locator("h3")).toHaveCount(0);

  // A photo link outside this robot's photo route fails the whole read, and nothing is fetched.
  await page.evaluate((route) => {
    window.__photoGalleryReply = { map: null, viewpoints: [], albums: [{ album: "manual", photos: [{
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

test("a photo that fails to load says so and loads on Try again", async ({ page }) => {
  const panel = await mountPanel(page, GALLERY);
  await page.evaluate((path) => { window.__photoFailures = [path]; }, `${ROUTE}/p3`);
  await openPhotos(panel);
  const gallery = panel.locator("matic-photo-gallery-v4");
  await gallery.locator(".shot").nth(0).click();
  const viewer = gallery.getByRole("dialog");
  await expect(viewer.getByRole("alert")).toHaveText("Couldn't load this photo.");
  await page.evaluate(() => { window.__photoFailures = []; });
  await viewer.getByRole("button", { name: "Try again" }).click();
  await expect(viewer.getByRole("img")).toHaveAccessibleName(/^Hall · /);
  await expect(viewer.getByRole("alert")).toHaveCount(0);
});

test("the grid shows sixty photos at a time and reads previews only for those shown", async ({ page }) => {
  const photos = Array.from({ length: 65 }, (_, index) => shot(`q${index}`, new Date(Date.UTC(2026, 10, 19, 12, 0) - index * 60_000).toISOString()));
  const panel = await mountPanel(page, { map: null, viewpoints: [], albums: [{ album: "tour-9", photos: photos.slice(0, 50) }, { album: "manual", photos: photos.slice(50) }] });
  await openPhotos(panel);
  const gallery = panel.locator("matic-photo-gallery-v4");
  await expect(gallery.locator(".shot img")).toHaveCount(60);
  await expect(gallery.locator(".shot")).toHaveCount(60);
  await expect(gallery.locator("h3")).toHaveText([/^Photo tour, /, "Single photos"]);
  expect((await photoReads(page)).length).toBe(60);
  await gallery.getByRole("button", { name: "Show older photos" }).click();
  await expect(gallery.locator(".shot img")).toHaveCount(65);
  await expect(gallery.getByRole("button", { name: "Show older photos" })).toHaveCount(0);
  await expect(gallery.locator(".shot").nth(60)).toBeFocused();
  expect(new Set(await photoReads(page)).size).toBe(65);
});

test("Photos opened before a robot is chosen says so, then reads once one is", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'import "./frontend/map-studio-v4/photo-gallery";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/photo-gallery-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async () => {
    await import("/photo-gallery-test.js");
    document.body.append(document.createElement("matic-photo-gallery-v4"));
  });
  const gallery = page.locator("matic-photo-gallery-v4");
  await expect(gallery.getByRole("alert")).toHaveText("Couldn't load the photos.");
  await gallery.evaluate((element) => {
    element.backend = { photoGallery: async () => ({ map: null, viewpoints: [], albums: [] }), photo: async () => new Blob() };
    element.entryId = "entry";
  });
  await expect(gallery).toContainText("No photos yet.");
});

test("photos run newest first by time when single photos straddle a photo tour", async ({ page }) => {
  const panel = await mountPanel(page, { map: null, viewpoints: [], albums: [
    { album: "manual", photos: [shot("m10", "2026-11-10T09:00:00+00:00", { area: "Den" }), shot("m1", "2026-11-01T09:00:00+00:00", { area: "Porch" })] },
    { album: "tour-5", photos: [shot("t5", "2026-11-05T09:00:00+00:00", { area: "Hall" })] },
  ] });
  await openPhotos(panel);
  const gallery = panel.locator("matic-photo-gallery-v4");
  await expect(gallery.locator("h3")).toHaveText(["Single photos", /^Photo tour, /, "Single photos"]);
  for (const [index, name] of [/^Den · /, /^Hall · /, /^Porch · /].entries()) {
    await expect(gallery.locator(".shot").nth(index)).toHaveAccessibleName(name);
  }
  await gallery.locator(".shot").nth(0).click();
  const viewer = gallery.getByRole("dialog");
  await viewer.getByRole("button", { name: "Older" }).click();
  await expect(viewer).toHaveAccessibleName(/^Hall · /);
  await viewer.getByRole("button", { name: "Older" }).click();
  await expect(viewer).toHaveAccessibleName(/^Porch · /);
});

test("the gallery read accepts the server's 5,000 newest photos and its longest names", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { parsePhotoGallery } from "./frontend/map-studio-v4/photo-gallery-data";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/photo-gallery-data-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async (route) => {
    const { parsePhotoGallery } = await import("/photo-gallery-data-test.js");
    // GALLERY_MAX_PHOTOS in photo_gallery_view.py.
    const photos = (count) => Array.from({ length: count }, (_, index) => ({
      photo_id: `p${index}`, captured_at: "2026-11-18T09:00:00+00:00", source: "home_assistant", starred: false,
      area: "A".repeat(512), pose: null, url: `${route}/p${index}`, preview_url: `${route}/preview/p${index}`,
    }));
    const read = (count) => {
      try {
        // A viewpoint name of 64 code points, each two UTF-16 units.
        return parsePhotoGallery({ map: null, viewpoints: [{ viewpoint_id: "v1", name: "\u{1F600}".repeat(64), mission_id: 7, x: 0, y: 0, heading: 0, room_id: "r1" }], albums: photos(count).map((photo) => ({ album: photo.photo_id, photos: [photo] })) }, "synthetic-entry").albums.length;
      } catch (error) {
        return error.code;
      }
    };
    return [read(5_000), read(5_001)];
  }, ROUTE);
  expect(result).toEqual([5_000, "invalid-photo-gallery"]);
});

test("each viewpoint is a pin with a wedge facing its heading on the mirrored map", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { drawViewpoints } from "./frontend/map-studio-v4/photo-marks"; export { initialWorkspaceState } from "./frontend/map-studio-v4/state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/photo-marks-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { drawViewpoints, initialWorkspaceState } = await import("/photo-marks-test.js");
    const key = "a".repeat(64);
    const base = initialWorkspaceState();
    const state = (changes) => ({
      ...base, workflow: "photos", dataMode: "live",
      resources: { ...base.resources, entry: { mapSessionKey: key } },
      photoMarks: { mapSessionKey: key, viewpoints: [{ id: "v1", name: "Back door", x: 1, y: 2, heading: 0 }] },
      ...changes,
    });
    const draw = (value) => {
      const calls = [];
      const context = new Proxy({}, {
        get: (_target, name) => (...args) => { calls.push([name, ...args.map((arg) => typeof arg === "number" ? Math.round(arg) : arg)]); },
        set: () => true,
      });
      const palette = { accent: [0, 0, 0], onAccent: [255, 255, 255], text: [0, 0, 0] };
      // The map mirrors X, as Matic Map does: +x metres go left on screen.
      drawViewpoints(context, value, palette, (x, y) => ({ x: 300 - x * 100, y: 300 - y * 100 }));
      return calls;
    };
    const shown = draw(state({}));
    return {
      pin: shown.find(([name]) => name === "arc").slice(1, 3),
      tip: shown.filter(([name]) => name === "lineTo")[2].slice(1),
      label: shown.find(([name]) => name === "fillText").slice(1),
      otherWorkflow: draw(state({ workflow: "runs" })).length,
      otherMap: draw(state({ photoMarks: { mapSessionKey: "b".repeat(64), viewpoints: [{ id: "v1", name: "Back door", x: 1, y: 2, heading: 0 }] } })).length,
    };
  });
  expect(result.pin).toEqual([200, 100]);
  // Heading 0 faces +x, which the mirrored map draws to the left: 1.2 m is 120 px.
  expect(result.tip).toEqual([80, 100]);
  expect(result.label).toEqual(["Back door", 210, 100]);
  expect(result.otherWorkflow).toBe(0);
  expect(result.otherMap).toBe(0);
});
