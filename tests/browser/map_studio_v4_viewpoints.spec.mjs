import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// Placing a viewpoint in Photos: Add viewpoint, a map tap for the spot, more
// taps or the turn buttons to aim the camera, a name, and Save. Delete asks
// once more. The server's refusals read as what to do next.

const KEY = "a".repeat(64);
const ROOMS = [
  { id: "room-a", name: "Kitchen", center: [30, 40], boundary: [[0, 0], [60, 0], [60, 80], [0, 80]] },
  { id: "room-b", name: "Office", center: [80, 40], boundary: [[60, 0], [100, 0], [100, 80], [60, 80]] },
];
const GALLERY = {
  map: { map_session_key: KEY, mission_id: 7 },
  viewpoints: [{ viewpoint_id: "v1", name: "Back door", mission_id: 7, x: 1, y: 0.5, heading: 0.5, room_id: "room-b" }],
  albums: [],
};

const mount = async (page, photoGallery = GALLERY) => {
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", sceneRooms: ROOMS, photoGallery });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  // Frame the whole floor from above, as the inspect tests do.
  const canvas = panel.locator("matic-map-canvas-v4");
  await canvas.evaluate((element) => element.dispatchEvent(new CustomEvent("matic-workspace-intent",
    { detail: { type: "set-view", view: "top" }, bubbles: true, composed: true })));
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().view)).toBe("top");
  await panel.getByRole("button", { name: /^Photos See photos the robot took/ }).click();
  await expect(panel.getByRole("heading", { level: 2, name: "Photos" })).toBeVisible();
  // Frame after the sheet opens, so the floor sits in the map that is left.
  await canvas.evaluate((element) => element.rendererController.setCamera({ ...element.rendererController.camera,
    targetX: 0, targetZ: 0, distance: 1.2 }));
  return panel;
};
const editor = (panel) => panel.locator("matic-viewpoint-editor-v4");
const marks = (panel) => panel.evaluate((element) => element.getWorkspaceSnapshot().photoMarks);
const writes = (page) => page.evaluate(() => window.__viewpointWrites ?? []);
// Where a map point (metres) sits on the page.
const onPage = (panel, x, y) => panel.locator("matic-map-canvas-v4").evaluate((canvas, point) => {
  const at = canvas.rendererController.mapToScreen(point);
  const box = canvas.renderRoot.querySelector(".scene-canvas").getBoundingClientRect();
  return { x: box.left + at.x, y: box.top + at.y };
}, { x, y });
const tap = async (page, panel, x, y) => {
  const at = await onPage(panel, x, y);
  await page.mouse.click(at.x, at.y);
};
const near = (actual, expected) => expect(Math.abs(actual - expected)).toBeLessThan(0.02);

test("a tap places a viewpoint, another aims it, and Save keeps it on the map", async ({ page }) => {
  const panel = await mount(page);
  const view = editor(panel);
  await view.getByRole("button", { name: "Add viewpoint" }).click();
  await expect(view.getByRole("textbox", { name: "Name" })).toBeFocused();
  await expect(view.getByRole("status")).toHaveText("Tap the map where the robot should stand.");

  await tap(page, panel, 0.5, 0.9);
  let draft = (await marks(panel)).draft;
  near(draft.spot.x, 0.5);
  near(draft.spot.y, 0.9);
  expect(draft.heading).toBe(0);
  await expect(view.getByRole("status")).toHaveText("Tap the map where the camera should look, or turn it here.");
  // A tap straight up the map's +y aims the camera there.
  await tap(page, panel, 0.5, 1.3);
  draft = (await marks(panel)).draft;
  near(draft.spot.x, 0.5);
  near(draft.heading, Math.PI / 2);
  await view.getByRole("button", { name: "Turn left" }).click();
  near((await marks(panel)).draft.heading, Math.PI / 2 + Math.PI / 12);
  await view.getByRole("button", { name: "Turn right" }).click();
  near((await marks(panel)).draft.heading, Math.PI / 2);

  await view.getByRole("textbox", { name: "Name" }).fill("  Stove  ");
  await page.keyboard.press("Enter");
  await expect(view.getByRole("listitem")).toHaveText([/^Back door/, /^Stove/]);
  const [saved] = await writes(page);
  expect(saved.method).toBe("POST");
  expect(saved.path).toBe("/api/matic_robot/photo_gallery/synthetic-entry/viewpoints");
  expect(Object.keys(saved.body).sort()).toEqual(["heading", "map_session_key", "name", "x", "y"]);
  expect(saved.body).toMatchObject({ name: "Stove", map_session_key: KEY });
  near(saved.body.heading, Math.PI / 2);
  const after = await marks(panel);
  expect(after.draft).toBeNull();
  expect(after.viewpoints.map(({ name }) => name)).toEqual(["Back door", "Stove"]);
  await expect(view.getByRole("button", { name: "Add viewpoint" })).toBeFocused();
});

test("Save explains what is missing and what the robot refused, and keeps the placed spot", async ({ page }) => {
  const panel = await mount(page);
  const view = editor(panel);
  await view.getByRole("button", { name: "Add viewpoint" }).click();
  await view.getByRole("button", { name: "Save viewpoint" }).click();
  await expect(view.getByRole("alert")).toHaveText("Tap the map where the robot should stand.");
  await tap(page, panel, 1.3, 0.5);
  await view.getByRole("button", { name: "Save viewpoint" }).click();
  await expect(view.getByRole("alert")).toHaveText("Give the viewpoint a name of up to 64 characters.");
  await expect(view.getByRole("textbox", { name: "Name" })).toBeFocused();
  expect(await writes(page)).toEqual([]);

  await page.evaluate(() => { window.__viewpointReply = { status: 400, body: { error: "viewpoint_in_no_go_zone" } }; });
  await view.getByRole("textbox", { name: "Name" }).fill("Desk");
  await view.getByRole("button", { name: "Save viewpoint" }).click();
  await expect(view.getByRole("alert")).toHaveText("That spot is in or next to a no-go zone. Move it at least 25 cm away.");
  expect((await marks(panel)).draft.spot).not.toBeNull();

  // Move clears the spot, so the next tap places it again.
  await view.getByRole("button", { name: "Move" }).click();
  expect((await marks(panel)).draft.spot).toBeNull();
  await tap(page, panel, 0.4, 0.4);
  near((await marks(panel)).draft.spot.x, 0.4);

  await page.evaluate(() => { window.__viewpointReply = { status: 409, body: { error: "map_changed" } }; });
  await view.getByRole("button", { name: "Save viewpoint" }).click();
  await expect(view.getByRole("alert")).toHaveText("The robot's map changed. Cancel, then place the viewpoint again.");
  await page.evaluate(() => { window.__viewpointReply = { status: 500 }; });
  await view.getByRole("button", { name: "Save viewpoint" }).click();
  await expect(view.getByRole("alert")).toHaveText("Couldn't save the viewpoint. Try again.");

  await view.getByRole("button", { name: "Cancel" }).click();
  expect((await marks(panel)).draft).toBeNull();
  await expect(view.getByRole("button", { name: "Add viewpoint" })).toBeFocused();
  // Without a viewpoint being placed, a tap opens the map's details card again.
  await tap(page, panel, 0.5, 0.9);
  expect((await marks(panel)).draft).toBeNull();
});

test("Delete asks once more, then removes the viewpoint from the list and the map", async ({ page }) => {
  const panel = await mount(page);
  const view = editor(panel);
  await view.getByRole("button", { name: "Delete Back door" }).click();
  await expect(view.getByText("Delete Back door? Photo tours that stop there will stop working.")).toBeVisible();
  await expect(view.getByRole("button", { name: "Delete viewpoint" })).toBeFocused();
  await view.getByRole("button", { name: "Keep" }).click();
  await expect(view.getByRole("listitem")).toHaveText([/^Back door/]);
  expect(await writes(page)).toEqual([]);

  await page.evaluate(() => { window.__viewpointReply = { status: 500 }; });
  await view.getByRole("button", { name: "Delete Back door" }).click();
  await view.getByRole("button", { name: "Delete viewpoint" }).click();
  await expect(view.getByRole("alert")).toHaveText("Couldn't delete the viewpoint. Try again.");
  await page.evaluate(() => { window.__viewpointReply = undefined; });
  await view.getByRole("button", { name: "Delete viewpoint" }).click();
  await expect(view.getByRole("listitem")).toHaveCount(0);
  expect((await writes(page)).map(({ method, path }) => `${method} ${path}`).at(-1))
    .toBe("DELETE /api/matic_robot/photo_gallery/synthetic-entry/viewpoints/v1");
  expect((await marks(panel)).viewpoints).toEqual([]);
  await expect(view.getByRole("button", { name: "Add viewpoint" })).toBeFocused();
});

test("a viewpoint already deleted elsewhere just leaves the list", async ({ page }) => {
  const panel = await mount(page);
  const view = editor(panel);
  await page.evaluate(() => { window.__viewpointReply = { status: 404 }; });
  await view.getByRole("button", { name: "Delete Back door" }).click();
  await view.getByRole("button", { name: "Delete viewpoint" }).click();
  await expect(view.getByRole("listitem")).toHaveCount(0);
  await expect(view.getByRole("alert")).toHaveCount(0);
});

test("without the robot's current map there is nowhere to place a viewpoint", async ({ page }) => {
  const panel = await mount(page, { ...GALLERY, map: null });
  const view = editor(panel);
  await expect(view.getByText("Viewpoints can be added once the robot's current map is shown.")).toBeVisible();
  await expect(view.getByRole("button", { name: "Add viewpoint" })).toHaveCount(0);
  // Saved viewpoints can still be deleted.
  await expect(view.getByRole("button", { name: "Delete Back door" })).toBeVisible();
});

test("a viewpoint left half placed is gone when Photos opens again", async ({ page }) => {
  const panel = await mount(page);
  await editor(panel).getByRole("button", { name: "Add viewpoint" }).click();
  await tap(page, panel, 0.5, 0.9);
  expect((await marks(panel)).draft.spot).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("heading", { level: 2, name: "Photos" })).toHaveCount(0);
  await panel.getByRole("button", { name: /^Photos See photos the robot took/ }).click();
  await expect(editor(panel).getByRole("button", { name: "Add viewpoint" })).toBeVisible();
  expect((await marks(panel)).draft).toBeNull();
});

test("on a phone a tap places the viewpoint and the form stays in reach @mobile", async ({ page }) => {
  const panel = await mount(page);
  const view = editor(panel);
  await view.getByRole("button", { name: "Add viewpoint" }).click();
  const at = await onPage(panel, 0.5, 0.9);
  await page.touchscreen.tap(at.x, at.y);
  await expect.poll(async () => (await marks(panel)).draft.spot !== null).toBe(true);
  const save = view.getByRole("button", { name: "Save viewpoint" });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x >= 0 && box.x + box.width <= viewport.width && box.height >= 24).toBe(true);
  await page.screenshot({ path: test.info().outputPath("viewpoint-mobile.png") });
});
