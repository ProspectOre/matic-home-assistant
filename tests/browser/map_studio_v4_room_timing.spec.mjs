import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const history = JSON.parse(readFileSync(new URL("./fixtures/matic_active_cleaning_history.json", import.meta.url), "utf8"));
const timing = JSON.parse(readFileSync(new URL("./fixtures/matic_current_room_timing.json", import.meta.url), "utf8"));

for (const [viewport, fontSize] of [
  [{ width: 320, height: 700 }, 16],
  [{ width: 402, height: 874 }, 16],
  [{ width: 402, height: 874 }, 20],
  [{ width: 844, height: 390 }, 16],
  [{ width: 844, height: 390 }, 20],
]) {
  test(`active room status stays readable at ${viewport.width}x${viewport.height} with ${fontSize}px font @mobile`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const room = { id: "room-bedroom", name: "Master Bedroom", center: [0.5, 0.5], boundary: [[0, 0], [1, 0], [1, 1], [0, 1]] };
    const activeHistory = structuredClone(history);
    activeHistory.active_plan.room_id = room.id;
    const activeTiming = structuredClone(timing);
    activeTiming.attributes.room_id = room.id;
    activeTiming.attributes.room = room.name;
    const fixture = await installPanelFixture(page, { sceneRooms: [room], initialRobotStates: {
      "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry", battery_level: 70, current_area: "The Master Bedroom" } },
      "sensor.synthetic_history": { state: "ready", attributes: activeHistory },
      "sensor.synthetic_progress": activeTiming,
    } });
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size}px`;
      document.body.append(window.__panelFixture.createPanel());
    }, fontSize);
    const shell = page.locator(fixture.panelTag).locator("matic-map-shell-v4");
    const status = shell.locator(".sheet-status");
    await expect(status).toContainText("In Master Bedroom");
    await expect(status.locator(".room-estimate")).toHaveText("Estimated room progress: 35% (based on time)");
    const layout = await status.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const sheet = element.closest(".mobile-sheet").getBoundingClientRect();
      const controls = [...element.parentElement.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
      const estimate = element.querySelector(".room-estimate");
      return {
        textFits: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
        estimateFits: estimate.scrollWidth <= estimate.clientWidth + 1 && estimate.scrollHeight <= estimate.clientHeight + 1,
        withinSheet: rect.top >= sheet.top && rect.bottom <= sheet.bottom,
        overlapsControl: controls.some((control) => rect.left < control.right && rect.right > control.left && rect.top < control.bottom && rect.bottom > control.top),
      };
    });
    expect(layout).toEqual({ textFits: true, estimateFits: true, withinSheet: true, overlapsControl: false });
    const stop = shell.getByRole("button", { name: "Stop cleaning", exact: true });
    await expect(stop).toBeVisible();
    const box = await stop.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    if (viewport.width === 402 && fontSize === 16) await page.screenshot({ path: test.info().outputPath("active-room-status.png") });

    await shell.getByRole("button", { name: "Full map", exact: true }).click();
    const hud = shell.locator(".full-map-hud");
    const hudEstimate = hud.locator(".room-estimate");
    await expect(hudEstimate).toHaveText("Estimated room progress: 35% (based on time)");
    const hudTextFits = await hudEstimate.evaluate((element) =>
      element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1);
    expect(hudTextFits).toBe(true);
    const hudStop = hud.getByRole("button", { name: "Stop cleaning", exact: true });
    await expect(hudStop).toBeVisible();
    const hudStopBox = await hudStop.boundingBox();
    expect(hudStopBox.x).toBeGreaterThanOrEqual(0);
    expect(hudStopBox.y).toBeGreaterThanOrEqual(0);
    expect(hudStopBox.x + hudStopBox.width).toBeLessThanOrEqual(viewport.width);
    expect(hudStopBox.y + hudStopBox.height).toBeLessThanOrEqual(viewport.height);
    if (viewport.width === 402 && fontSize === 16) await page.screenshot({ path: test.info().outputPath("active-room-status-full-map.png") });
  });
}

test("map options remain usable when the robot starts cleaning @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  const room = { id: "room-bedroom", name: "Master Bedroom", center: [0.5, 0.5], boundary: [[0, 0], [1, 0], [1, 1], [0, 1]] };
  const activeHistory = structuredClone(history);
  activeHistory.active_plan.room_id = room.id;
  const fixture = await installPanelFixture(page, { sceneRooms: [room], initialRobotStates: {
    "vacuum.synthetic": { state: "docked", attributes: { matic_entry_id: "synthetic-entry", battery_level: 70, current_area: "Master Bedroom" } },
    "sensor.synthetic_history": { state: "ready", attributes: activeHistory },
  } });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const shell = panel.locator("matic-map-shell-v4");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().coherence)).toBe("current");
  await shell.getByRole("button", { name: "Map options", exact: true }).click();
  const menu = shell.getByRole("menu", { name: "Map options" });
  await expect(menu).toBeVisible();
  await panel.evaluate((element) => {
    const states = structuredClone(element.hass.states);
    states["vacuum.synthetic"].state = "cleaning";
    element.hass = { ...element.hass, states };
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().activity)).toBe("cleaning");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Map zoom", exact: true }).click();
  await expect(shell.getByRole("dialog", { name: "Map zoom", exact: true })).toBeVisible();
});

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

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Smart Stop explains its state and keeps the immediate override reachable at ${viewport.width}x${viewport.height} @mobile`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const activeHistory = structuredClone(history);
    Object.assign(activeHistory.active_plan, { room_id: "bedroom", room: "Master Bedroom", smart_stop_pending: true, smart_stop_phase: "finishing_room" });
    const activeTiming = structuredClone(timing);
    Object.assign(activeTiming.attributes, { room_id: "bedroom", room: "Master Bedroom" });
    const fixture = await installPanelFixture(page, { moduleSource: "packaged", sceneRooms: [
      { id: "bedroom", name: "Master Bedroom", center: [0.5, 0.5], boundary: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    ], initialRobotStates: {
      "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry", battery_level: 70, current_area: "Master Bedroom" } },
      "sensor.synthetic_history": { state: "ready", attributes: activeHistory },
      "sensor.synthetic_progress": activeTiming,
    } });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    const shell = panel.locator("matic-map-shell-v4");
    const status = shell.locator(".sheet-status");
    await expect(status).toContainText("Smart Stop");
    await expect(status).toContainText("Finishing Master Bedroom, then returning to the dock.");
    await expect(status.locator(".room-estimate")).toHaveText("Estimated room progress: 35% (based on time)");
    expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    const stop = shell.getByRole("button", { name: "Stop now & dock", exact: true });
    await expect(stop).toBeEnabled();
    const box = await stop.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await stop.click();
    const calls = await page.evaluate(() => window.__panelFixture.serviceCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ domain: "matic_robot", service: "stop_intelligent_cleaning", data: { stop_now: true, expected_run_id: "partial-1" } });
  });
}

test("Smart Stop projection is bound to the active run and its phase", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { HassAdapter } from "./frontend/map-studio-v4/hass-adapter";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/smart-stop-projection.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async (history) => {
    const { HassAdapter } = await import("/smart-stop-projection.js");
    const adapter = new HassAdapter();
    const active = { ...history.active_plan, smart_stop_pending: true, smart_stop_phase: "finishing_area", area_id: "area-1", area: "Master Bathroom" };
    const states = {
      "vacuum.robot": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } },
      "sensor.history": { state: "ready", attributes: { ...history, active_plan: active } },
    };
    const hass = { connected: true, user: { is_admin: true }, states };
    const read = () => adapter.project(hass, undefined, "synthetic-entry").smartStop;
    const area = read();
    states["sensor.history"] = { state: "ready", attributes: { ...history, active_plan: { ...active, run_id: "old-run" } } };
    const stale = read();
    states["sensor.history"] = { state: "ready", attributes: { ...history, active_plan: { ...active, smart_stop_phase: "verifying_completion" } } };
    const verifying = read();
    states["sensor.history"] = { state: "ready", attributes: { ...history, active_plan: { ...active, smart_stop_phase: "returning_to_dock" } } };
    const returning = read();
    states["sensor.history"] = { state: "ready", attributes: { ...history, active_plan: { ...active, smart_stop_phase: "unrecognized" } } };
    const unknown = read();
    return { area, stale, verifying, returning, unknown };
  }, history);
  expect(result.area).toEqual({ runId: "partial-1", target: "Master Bathroom", kind: "area", phase: "finishing_area" });
  expect(result.stale).toBeNull();
  expect(result.verifying.phase).toBe("verifying_completion");
  expect(result.returning.phase).toBe("returning_to_dock");
  expect(result.unknown).toBeNull();
});

test("Smart Stop shows paused and return phases without hiding connection problems", async ({ page }) => {
  const activeHistory = structuredClone(history);
  Object.assign(activeHistory.active_plan, { room: "Master Bedroom", smart_stop_pending: true, smart_stop_phase: "finishing_room" });
  const fixture = await installPanelFixture(page, { initialRobotStates: {
    "vacuum.synthetic": { state: "paused", attributes: { matic_entry_id: "synthetic-entry", battery_level: 70 } },
    "sensor.synthetic_history": { state: "ready", attributes: activeHistory },
  } });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const shell = panel.locator("matic-map-shell-v4");
  await expect(shell.locator(".status-copy")).toContainText("Resume to finish this clean, or stop now and dock.");
  await expect(shell.getByRole("button", { name: "Stop now & dock", exact: true })).toBeEnabled();
  await panel.evaluate((element) => {
    const states = structuredClone(element.hass.states);
    states["vacuum.synthetic"].state = "idle";
    states["sensor.synthetic_history"].attributes.active_plan.smart_stop_phase = "verifying_completion";
    element.hass = { ...element.hass, states };
  });
  await expect(shell.locator(".status-copy")).toContainText("Checking the result before docking.");
  await expect(shell.getByRole("button", { name: "Stop now & dock", exact: true })).toBeDisabled();
  await panel.evaluate((element) => {
    const states = structuredClone(element.hass.states);
    states["vacuum.synthetic"].state = "returning";
    states["sensor.synthetic_history"].attributes.active_plan.smart_stop_phase = "returning_to_dock";
    element.hass = { ...element.hass, states };
  });
  await expect(shell.locator(".status-copy")).toContainText("Smart Stop is returning to the dock.");
  await expect(shell.getByRole("button", { name: "Stop now & dock", exact: true })).toBeDisabled();
  await panel.evaluate((element) => { element.hass = { ...element.hass, connected: false }; });
  await expect(shell.locator(".status-copy")).toContainText("Home Assistant is offline");
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
      await expect(estimate).toHaveText("Estimated room progress: 35% (based on time)");
      expect(await estimate.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
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
      await expect(estimate).toHaveText("Estimated room progress: 100% (based on time)");
      await expect(shell.locator(viewport.width < 1000 ? ".sheet-status" : ".status-copy")).toContainText("0 of 3 rooms completed");
      await expect(stop).toBeVisible();
      await shell.getByRole("button", { name: "Full map", exact: true }).click();
      await expect(shell.locator(".full-map-hud .room-estimate")).toHaveText("Estimated room progress: 100% (based on time)");
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
