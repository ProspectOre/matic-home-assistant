import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// The live map's layers sit one tap away beside Fit map, and each robot's
// choice is saved in this browser and comes back after a reload. A key on the
// map names what the carpet, vent, zone and trail outlines mean.

const RUG = [[0.3, 0.3], [1.2, 0.3], [1.2, 0.9], [0.3, 0.9]];
const VENT = [[1.5, 0.3], [1.8, 0.3], [1.8, 0.42], [1.5, 0.42]];
const FLOOR_TYPES = { entry_id: "synthetic", page_count: 1, truncated: false, layers: { carpet: [RUG], vent: [VENT] } };
const SURVEY = { enabled: true, cell_size: 0.3048, cells: [] };
const ZONE = [[0.8, 0.8], [1.6, 0.8], [1.6, 1.6], [0.8, 1.6]];
const AREAS = {
  scene_url: "/api/matic_robot/slam_scene/synthetic", rooms: [], areas: [], selected_area: null,
  zones: [{ kind: "no_go", outline: ZONE, holes: [], room_ids: [], area_ids: [] },
    { kind: "unknown", outline: ZONE, holes: [], room_ids: [], area_ids: [] }],
};
const PREFERENCES = "matic-map-studio:v4:synthetic-admin";

const mount = async (page, options = {}) => {
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", wifiSignal: SURVEY, floorTypes: FLOOR_TYPES, ...options });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  return panel;
};
const shown = (panel) => panel.evaluate((element) => {
  const { trail, wifiSignal, floorTypes } = element.getWorkspaceSnapshot();
  return { trail: trail?.id ?? null, wifi: wifiSignal?.status ?? null, floorTypes: floorTypes?.status ?? null };
});
const quick = (panel, layer) => panel.locator(`[data-quick-layer=${layer}]`);
const keyRows = (panel) => panel.locator(".map-key li").allInnerTexts();
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.layers ?? null, PREFERENCES);

test("each layer is one tap away, stays in step with Map options and comes back after a reload", async ({ page }) => {
  let panel = await mount(page);
  await expect(quick(panel, "wifi")).toHaveAttribute("aria-pressed", "false");
  await expect(quick(panel, "floor-types")).toHaveAccessibleName("Carpet and vents");
  expect(await saved(page) ?? {}).toEqual({});

  await quick(panel, "floor-types").click();
  await quick(panel, "wifi").click();
  await expect.poll(() => shown(panel)).toEqual({ trail: null, wifi: "ready", floorTypes: "ready" });
  await expect(quick(panel, "floor-types")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => keyRows(panel)).toEqual(["Carpet", "Floor vent"]);
  await panel.getByRole("button", { name: "Map options" }).click();
  await expect(panel.locator("[data-wifi-signal]")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect.poll(() => saved(page)).toEqual({ "synthetic-entry": { trail: false, wifi: true, floorTypes: true } });

  // Home Assistant mounts the panel afresh on every page load.
  panel = await mount(page);
  await expect.poll(() => shown(panel)).toEqual({ trail: null, wifi: "ready", floorTypes: "ready" });
  await expect(quick(panel, "wifi")).toHaveAttribute("aria-pressed", "true");
  await quick(panel, "wifi").click();
  await expect.poll(() => saved(page)).toEqual({ "synthetic-entry": { trail: false, wifi: false, floorTypes: true } });
});

test("the live trail is saved too, and the key names it", async ({ page }) => {
  let panel = await mount(page);
  await quick(panel, "trail").click();
  await expect.poll(() => shown(panel)).toMatchObject({ trail: "live" });
  await expect.poll(() => keyRows(panel)).toEqual(["Robot trail"]);
  await expect.poll(() => saved(page)).toEqual({ "synthetic-entry": { trail: true, wifi: false, floorTypes: false } });

  panel = await mount(page);
  await expect.poll(() => shown(panel)).toEqual({ trail: "live", wifi: null, floorTypes: null });
  await expect(quick(panel, "trail")).toHaveAttribute("aria-pressed", "true");
});

test("the key tells a no-go zone from a robot zone of unknown purpose", async ({ page }) => {
  const panel = await mount(page, { initialAreasCatalog: AREAS });
  await expect.poll(() => keyRows(panel)).toEqual(["No-go zone", "Robot zone, purpose unknown"]);
  await page.screenshot({ path: test.info().outputPath("map-key.png") });
});

test("the layer toggles and key fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await mount(page, { initialAreasCatalog: AREAS });
  await quick(panel, "floor-types").click();
  await expect.poll(() => keyRows(panel)).toEqual(["Carpet", "Floor vent", "No-go zone", "Robot zone, purpose unknown"]);
  for (const target of [panel.locator(".map-tools"), panel.locator(".map-key")]) {
    const box = await target.boundingBox();
    expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath("layers-mobile.png") });
  // Help opens below the toggles stacked under Fit map.
  await panel.getByRole("button", { name: "How to move the map", exact: true }).click();
  const help = await panel.getByRole("dialog", { name: "How to move the map", exact: true }).boundingBox();
  const tools = await panel.locator(".map-tools").boundingBox();
  expect(help.y).toBeGreaterThanOrEqual(tools.y + tools.height);
});

const entry = (id, key, extra = {}) => ({
  entry_id: id, scene_url: "/api/matic_robot/slam_scene/synthetic", delta_url: null,
  history_url: `/api/matic_robot/slam_history/${id}`, areas_url: `/api/matic_robot/areas/${id}`,
  plans_url: `/api/matic_robot/plans/${id}`, map_revision: 7, map_floor_coherent: true, map_session_verified: true,
  map_session_key: key.repeat(64), map_complete: true, map_truncated: false, selected_floor_ordinal: 1, map_floor_ordinal: 1,
  history_count: 1, history_floor_count: 2, map_health: "ready", stream_failures: 0, bootstrap_state: "complete",
  bootstrap_photo_seen: true, bootstrap_structure_seen: true, bootstrap_failures: 0, runner_locked: false,
  stop_settle_pending: false, active_plan: false, native_reconciliation_pending: false, native_session_active: false,
  floor_layers_url: "/api/matic_robot/floor_layers/synthetic", ...extra,
});

test("each robot keeps its own layers, and a robot with none saved starts with them off", async ({ page }) => {
  const panel = await mount(page, {
    initialCatalogEntries: [
      entry("synthetic-entry", "a", { wifi_heatmap_url: "/api/matic_robot/wifi_heatmap/synthetic" }),
      entry("synthetic-entry-b", "b"),
    ],
    initialRobotStates: {
      "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } },
      "vacuum.synthetic_b": { state: "docked", attributes: { matic_entry_id: "synthetic-entry-b" } },
    },
  });
  await quick(panel, "wifi").click();
  await expect.poll(() => shown(panel)).toMatchObject({ wifi: "ready" });

  await panel.locator("select.robot-switcher").selectOption("synthetic-entry-b");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.entry?.entryId)).toBe("synthetic-entry-b");
  await expect(quick(panel, "floor-types")).toHaveAttribute("aria-pressed", "false");
  expect(await shown(panel)).toMatchObject({ wifi: null, floorTypes: null });
  await quick(panel, "floor-types").click();
  await expect.poll(() => shown(panel)).toMatchObject({ floorTypes: "ready" });

  await panel.locator("select.robot-switcher").selectOption("synthetic-entry");
  await expect.poll(() => shown(panel)).toEqual({ trail: null, wifi: "ready", floorTypes: null });
  await expect.poll(() => saved(page)).toEqual({
    "synthetic-entry": { trail: false, wifi: true, floorTypes: false },
    "synthetic-entry-b": { trail: false, wifi: false, floorTypes: true },
  });
});
