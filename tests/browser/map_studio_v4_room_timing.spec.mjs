import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const history = JSON.parse(readFileSync(new URL("./fixtures/matic_active_cleaning_history.json", import.meta.url), "utf8"));
const timing = JSON.parse(readFileSync(new URL("./fixtures/matic_current_room_timing.json", import.meta.url), "utf8"));

test("timing projection reads the canonical entity and rejects ambiguous or stale ownership", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { HassAdapter } from "./frontend/map-studio-v4/hass-adapter";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/room-timing-test.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async ({ history, timing }) => {
    const { HassAdapter } = await import("/room-timing-test.js");
    const adapter = new HassAdapter();
    const states = {
      "vacuum.robot": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } },
      "sensor.history": { state: "ready", attributes: history },
      "sensor.progress": timing,
    };
    const hass = { connected: true, user: { is_admin: true }, states };
    const read = () => adapter.project(hass, undefined, "synthetic-entry");
    const first = read();
    const same = read();
    const values = [];
    for (const value of ["0", "100", "unknown", "unavailable", "", "101", "-1", "1.5", "NaN", "Infinity"]) {
      states["sensor.progress"] = { ...timing, state: value };
      values.push(read().lastRun?.estimate?.percent ?? null);
    }
    const invalid = [];
    for (const fields of [{ matic_entry_id: "other" }, { run_id: "old" }, { room_id: "other" }, { room: "" }, { status: "suspended" }]) {
      states["sensor.progress"] = { ...timing, attributes: { ...timing.attributes, ...fields } };
      invalid.push(read().lastRun?.estimate ?? null);
    }
    states["sensor.progress"] = timing;
    states["sensor.duplicate"] = timing;
    const duplicate = read().lastRun?.estimate ?? null;
    delete states["sensor.duplicate"];
    states["sensor.progress"] = { ...timing, state: "36" };
    const changed = read();
    return { first: first.lastRun.estimate, same: first === same, values, invalid, duplicate,
      changed: changed !== first, percent: changed.lastRun.estimate.percent };
  }, { history, timing });
  expect(result).toEqual({ first: { roomId: "room-kitchen", room: "Kitchen", percent: 35 }, same: true,
    values: [0, 100, null, null, null, null, null, null, null, null], invalid: [null, null, null, null, null],
    duplicate: null, changed: true, percent: 36 });
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  for (const fontSize of [16, 20]) {
    test(`canonical room estimate and Stop fit ${viewport.width}x${viewport.height} with ${fontSize}px host font`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const fixture = await installPanelFixture(page, { moduleSource: "packaged", sceneRooms: [
        { id: "room-kitchen", name: "Kitchen", center: [0.5, 0.5], boundary: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      ], initialRobotStates: {
        "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry", battery_level: 70, current_area: "The Kitchen" } },
        "sensor.synthetic_history": { state: "ready", attributes: history },
        "sensor.synthetic_progress": timing,
      } });
      await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; document.body.append(window.__panelFixture.createPanel()); }, fontSize);
      const panel = page.locator(fixture.panelTag);
      const shell = panel.locator("matic-map-shell-v4");
      await expect.poll(() => panel.evaluate(element => element.getWorkspaceSnapshot().coherence)).toBe("current");
      const estimate = shell.locator(".room-estimate");
      await expect(estimate).toHaveText("Estimated 35% · Kitchen");
      const stop = shell.getByRole("button", { name: "Stop cleaning", exact: true });
      await expect(stop).toBeVisible();
      const box = await stop.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      const estimateBox = await estimate.boundingBox();
      expect(estimateBox.height).toBeGreaterThan(0);
      expect(estimateBox.y + estimateBox.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({ path: testInfo.outputPath("current-room-estimate.png") });
      const update = (fields) => panel.evaluate((element, fields) => {
        const states = structuredClone(element.hass.states);
        if (fields.percent !== undefined) states["sensor.synthetic_progress"].state = fields.percent;
        if (fields.room !== undefined) states["vacuum.synthetic"].attributes.current_area = fields.room;
        if (fields.activity) states["vacuum.synthetic"].state = fields.activity;
        if (fields.run) states["sensor.synthetic_history"].attributes.active_plan.run_id = fields.run;
        element.hass = { ...element.hass, states };
      }, fields);
      await update({ percent: "100" });
      await expect(estimate).toHaveText("Estimated 100% · Kitchen");
      await expect(shell.locator(viewport.width < 1000 ? ".sheet-status" : ".status-copy")).toContainText("0 of 3 rooms completed");
      await expect(stop).toBeVisible();
      await shell.getByRole("button", { name: "Full map", exact: true }).click();
      await expect(shell.locator(".full-map-hud .room-estimate")).toHaveText("Estimated 100% · Kitchen");
      await expect(stop).toBeVisible();
      await shell.getByRole("button", { name: "Exit full map", exact: true }).click();
      await update({ room: "Study" });
      await expect(estimate).toHaveCount(0);
      await update({ room: "Kitchen", percent: "unknown" });
      await expect(estimate).toHaveCount(0);
      await update({ percent: "35", run: "replacement" });
      await expect(estimate).toHaveCount(0);
      await update({ run: "partial-1", activity: "paused" });
      await expect(estimate).toHaveCount(0);
    });
  }
}
