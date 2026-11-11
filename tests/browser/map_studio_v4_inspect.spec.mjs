import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// A tap on the live map opens a details card for the robot, a trail point, a
// robot zone or a room, with the actions the panel already offers. Enter on
// the focused map does the same for the middle of the view.

// The fixture's scene: 1.5 cm cells from (0.15 m, 0.15 m). Kitchen spans 0.15
// to 1.05 m across, Office 1.05 to 1.65 m; both 0.15 to 1.35 m deep.
const ROOMS = [
  { id: "room-a", name: "Kitchen", center: [30, 40], boundary: [[0, 0], [60, 0], [60, 80], [0, 80]] },
  { id: "room-b", name: "Office", center: [80, 40], boundary: [[60, 0], [100, 0], [100, 80], [60, 80]] },
];
const PLANS = { rooms: ROOMS.map(({ id, name }) => ({ room_id: id, name })), plans: [], selected_plan: null };
const AREAS = {
  scene_url: "/api/matic_robot/slam_scene/synthetic", rooms: [], areas: [], selected_area: null,
  zones: [{ kind: "no_go", outline: [[1.2, 0.3], [1.5, 0.3], [1.5, 0.6], [1.2, 0.6]], holes: [], room_ids: ["room-b"], area_ids: [] }],
};
const CLEANING = { "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } } };

const mount = async (page, options = {}) => {
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", sceneRooms: ROOMS,
    initialPlanCatalog: PLANS, initialAreasCatalog: AREAS, posePosition: [1.35, 1.1], ...options });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  // The card is drawn by the layers chunk, which loads once the map is in.
  await expect(panel.locator("[data-quick-layer=trail]")).toBeVisible();
  // The fixture's scene has one point, so Fit map frames a few centimetres;
  // frame the whole floor from above instead.
  const canvas = panel.locator("matic-map-canvas-v4");
  await canvas.evaluate((element) => element.dispatchEvent(new CustomEvent("matic-workspace-intent",
    { detail: { type: "set-view", view: "top" }, bubbles: true, composed: true })));
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().view)).toBe("top");
  await canvas.evaluate((element) => element.rendererController.setCamera({ ...element.rendererController.camera,
    targetX: 0, targetZ: 0, distance: 1.2 }));
  return panel;
};
const snapshot = (panel) => panel.evaluate((element) => {
  const { workflow, selection, trail, followMode } = element.getWorkspaceSnapshot();
  return { workflow, roomIds: selection.roomIds, trail: trail?.segments.flat() ?? null, followMode };
});
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
const card = (panel) => panel.locator(".inspect");
const rows = (panel) => card(panel).locator("dt, dd").allInnerTexts();

test("a room, a zone and the robot each open a card with what fits, and Choose for a clean picks the room", async ({ page }) => {
  const panel = await mount(page);
  await tap(page, panel, 0.5, 0.9);
  await expect(card(panel).getByRole("heading", { name: "Kitchen" })).toBeVisible();
  // 0.9 m by 1.2 m.
  expect(await rows(panel)).toEqual(["Size", "1.1 m²"]);

  await tap(page, panel, 1.35, 0.45);
  await expect(card(panel).getByRole("heading", { name: "No-go zone" })).toBeVisible();
  expect(await rows(panel)).toEqual(["Size", "0.1 m²", "Rooms", "Office"]);
  await expect(card(panel).getByRole("button")).toHaveCount(1);

  await tap(page, panel, 1.35, 1.1);
  await expect(card(panel).getByRole("heading", { name: "Robot" })).toBeVisible();
  await card(panel).getByRole("button", { name: "Follow the robot" }).click();
  await expect.poll(async () => (await snapshot(panel)).followMode).toBe("follow");

  await tap(page, panel, 0.5, 0.9);
  await card(panel).getByRole("button", { name: "Choose for a clean" }).click();
  await expect.poll(() => snapshot(panel)).toMatchObject({ workflow: "rooms", roomIds: ["room-a"] });
  await expect(card(panel)).toHaveCount(0);
  // In Choose rooms a tap picks rooms and opens no card.
  await tap(page, panel, 1.35, 0.9);
  await expect.poll(async () => (await snapshot(panel)).roomIds).toEqual(["room-a", "room-b"]);
  await expect(card(panel)).toHaveCount(0);
});

test("Enter on the focused map inspects its middle, Escape closes the card, and Close returns focus to the map", async ({ page }) => {
  const panel = await mount(page);
  const map = panel.locator(".map-root");
  await expect(map).toHaveAttribute("aria-keyshortcuts", "Enter");
  await map.focus();
  await page.keyboard.press("Enter");
  await expect(card(panel)).toBeVisible();
  await expect(card(panel)).toHaveAccessibleName(/Kitchen|Office/u);
  await page.keyboard.press("Escape");
  await expect(card(panel)).toHaveCount(0);
  await expect.poll(() => snapshot(panel)).toMatchObject({ workflow: "none" });

  // Escape from inside the card closes it too.
  await page.keyboard.press("Enter");
  await card(panel).getByRole("button", { name: "Close details" }).focus();
  await page.keyboard.press("Escape");
  await expect(card(panel)).toHaveCount(0);
  await expect(map).toBeFocused();

  await page.keyboard.press("Enter");
  await card(panel).getByRole("button", { name: "Close details" }).click();
  await expect(card(panel)).toHaveCount(0);
  await expect(map).toBeFocused();
});

test("a trail point shows the robot's time, steps along the path, and the key names the arrows and the ring", async ({ page }) => {
  const panel = await mount(page, { initialRobotStates: CLEANING, posePosition: null });
  await panel.locator("[data-quick-layer=trail]").click();
  await expect.poll(async () => (await snapshot(panel)).trail).toEqual([]);
  const start = 1_800_000_000;
  for (const [index, x] of [0.3, 0.5, 0.7].entries()) {
    await page.evaluate(({ x, at }) => window.__panelFixture.pushPose([x, 0.9], { observed_at: at }), { x, at: start + index * 30 });
  }
  await expect.poll(async () => (await snapshot(panel)).trail).toEqual([[0.3, 0.9, start], [0.5, 0.9, start + 30], [0.7, 0.9, start + 60]]);
  await expect.poll(() => panel.locator(".map-key li").allInnerTexts()).toEqual(["No-go zone", "Robot trail", "Direction of travel"]);

  await tap(page, panel, 0.51, 0.91);
  await expect(card(panel).getByRole("heading", { name: "Trail point" })).toBeVisible();
  const [timeLabel, time, intoLabel, into, pointLabel, point] = await rows(panel);
  expect([timeLabel, intoLabel, into, pointLabel, point]).toEqual(["Robot here at", "Into the clean", "1 min", "Point", "2 of 3"]);
  // The fixture's Home Assistant names no time zone, so the browser's applies.
  expect(time).toBe(await page.evaluate((at) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" })
    .format(at * 1000), start + 30));
  await expect(card(panel)).toContainText("Times come from the robot.");
  await expect.poll(() => panel.locator(".map-key li").allInnerTexts())
    .toEqual(["No-go zone", "Robot trail", "Direction of travel", "Point you're inspecting"]);

  await card(panel).getByRole("button", { name: "Later point" }).click();
  await expect(card(panel).locator("dd").last()).toHaveText("3 of 3");
  await expect(card(panel).getByRole("button", { name: "Later point" })).toBeDisabled();
  await card(panel).getByRole("button", { name: "Earlier point" }).click();
  await card(panel).getByRole("button", { name: "Earlier point" }).click();
  await expect(card(panel).locator("dd").last()).toHaveText("1 of 3");
  await expect(card(panel).getByRole("button", { name: "Earlier point" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("trail-point.png") });
});

test("while the robot cleans, its card offers the panel's Stop", async ({ page }) => {
  const panel = await mount(page, { initialRobotStates: CLEANING });
  await tap(page, panel, 1.35, 1.1);
  await expect(card(panel).getByRole("heading", { name: "Robot" })).toBeVisible();
  await expect(card(panel).getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  // A Choose for a clean would have nothing to start while the robot works.
  await tap(page, panel, 0.5, 0.9);
  await expect(card(panel).getByRole("heading", { name: "Kitchen" })).toBeVisible();
  await expect(card(panel).getByRole("button")).toHaveCount(1);
});

test("the card fits a phone and opens from a tap @mobile", async ({ page }) => {
  const panel = await mount(page);
  const at = await onPage(panel, 0.5, 0.9);
  await page.touchscreen.tap(at.x, at.y);
  await expect(card(panel).getByRole("heading", { name: "Kitchen" })).toBeVisible();
  const box = await card(panel).boundingBox();
  const viewport = page.viewportSize();
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height).toBe(true);
  await page.screenshot({ path: test.info().outputPath("inspect-mobile.png") });
});
