import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const HARNESS = "/mop-controls-test.js";
async function harness(page) {
  const bundle = await build({ stdin: { contents: `
    export { HassAdapter } from "./frontend/map-studio-v4/hass-adapter";
    export { EffectController } from "./frontend/map-studio-v4/effects";
    export { WorkspaceStore } from "./frontend/map-studio-v4/state";
    export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";
    export { roomsSummary } from "./frontend/map-studio-v4/rooms-view";
  `, resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route(`**${HARNESS}`, route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

async function setupWrite(page) {
  await harness(page);
  await page.evaluate(async (url) => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import(url);
    const initial = createGalleryState("ready");
    const store = new WorkspaceStore(initial);
    const calls = [];
    let release;
    const effects = new EffectController(store, {
      catalog: async () => [window.__mop?.entry ?? initial.resources.entry],
      history: async () => initial.resources.history.value,
      scene: async () => { throw new DOMException("Aborted", "AbortError"); },
      pose: async () => { throw new DOMException("Aborted", "AbortError"); },
      plans: async () => initial.resources.plans.value,
      service: (...args) => { calls.push(args); return new Promise((resolve, reject) => { release = (fail) => fail ? reject(new Error("refused")) : resolve(); }); },
      dispose() {},
    });
    const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92,
      robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test",
      entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
      deepMop: { entityId: "switch.renamed_double_pass", enabled: false } };
    effects.sync(projection);
    await effects.refreshCatalog(true);
    window.__mop = { store, effects, projection, calls, entry: initial.resources.entry, release: (fail = false) => release(fail) };
  }, HARNESS);
}
const writeState = page => page.evaluate(() => {
  const { store, calls } = window.__mop;
  return { calls: calls.length, enabled: store.value.deepMop?.enabled, command: store.value.command,
    pending: store.value.pendingAction, notice: store.value.notice?.key ?? null };
});
const startWrite = page => page.evaluate(() => { window.__mop.operation = window.__mop.effects.executeAction("toggle-deep-mop"); });

test("double-pass setting binds by selected robot metadata and tolerates renamed entities", async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async (url) => {
    const { HassAdapter } = await import(url);
    const adapter = new HassAdapter();
    const vacuum = entry => ({ state: "docked", attributes: { matic_entry_id: entry } });
    const setting = (entry, state) => ({ state, attributes: { matic_entry_id: entry, matic_setting: "deep_mop" } });
    const states = { "vacuum.one": vacuum("one"), "vacuum.two": vacuum("two"),
      "switch.renamed": setting("one", "off"), "switch.other": setting("two", "on"),
      "switch.deep_mop": { state: "on", attributes: {} } };
    const project = () => adapter.project({ states, user: { is_admin: true } }, { config: { entry_id: "one" } }).deepMop;
    const out = { selected: project(), other: adapter.project({ states }, undefined, "two").deepMop };
    states["switch.renamed"] = setting("one", "on"); out.updated = project();
    states["switch.renamed"] = setting("one", "unknown"); out.unknown = project();
    states["switch.duplicate"] = setting("one", "off"); out.duplicate = project();
    delete states["switch.duplicate"]; delete states["switch.renamed"]; out.missing = project();
    states["switch.renamed"] = setting("one", "off"); delete states["vacuum.one"]; out.noVacuum = project();
    return out;
  }, HARNESS);
  expect(result).toEqual({ selected: { entityId: "switch.renamed", enabled: false },
    other: { entityId: "switch.other", enabled: true }, updated: { entityId: "switch.renamed", enabled: true },
    unknown: { entityId: "switch.renamed", enabled: null }, duplicate: null, missing: null, noVacuum: null });
});

test("double-pass write targets the live switch, waits for readback, and blocks duplicate sends", async ({ page }) => {
  await setupWrite(page);
  await startWrite(page);
  await expect.poll(() => writeState(page)).toMatchObject({ calls: 1, enabled: false, command: "pending", pending: "set-deep-mop" });
  await page.evaluate(() => window.__mop.effects.executeAction("toggle-deep-mop"));
  expect(await page.evaluate(() => window.__mop.calls)).toEqual([["switch", "turn_on", {}, "switch.renamed_double_pass", { acknowledgementTimeout: "mutation" }]]);
  await page.evaluate(() => window.__mop.release());
  expect(await writeState(page)).toMatchObject({ enabled: false, command: "pending" });
  await page.evaluate(async () => {
    const run = window.__mop;
    run.effects.sync({ ...run.projection, deepMop: { ...run.projection.deepMop, enabled: true } });
    await run.operation;
  });
  expect(await writeState(page)).toMatchObject({ calls: 1, enabled: true, command: "idle", pending: null, notice: null });
  await startWrite(page);
  await expect.poll(() => page.evaluate(() => window.__mop.calls.length)).toBe(2);
  expect(await page.evaluate(() => window.__mop.calls[1].slice(0, 4))).toEqual(["switch", "turn_off", {}, "switch.renamed_double_pass"]);
  await page.evaluate(async () => { const run = window.__mop; run.release(); run.effects.sync(run.projection); await run.operation; run.effects.dispose(); });
});

for (const failure of ["service", "unknown", "missing", "timeout"]) {
  test(`double-pass ${failure} failure clears pending without claiming success`, async ({ page }) => {
    await setupWrite(page);
    if (failure === "timeout") await page.clock.install();
    await startWrite(page);
    await expect.poll(() => page.evaluate(() => window.__mop.calls.length)).toBe(1);
    await page.evaluate((kind) => {
      const run = window.__mop;
      run.release(kind === "service");
      if (kind === "unknown" || kind === "missing") run.effects.sync({ ...run.projection,
        deepMop: kind === "missing" ? null : { ...run.projection.deepMop, enabled: null } });
    }, failure);
    if (failure === "timeout") await page.clock.runFor(5100);
    await page.evaluate(() => window.__mop.operation);
    expect(await writeState(page)).toMatchObject({ command: "idle", pending: null, notice: "v4_deep_mop_failed" });
    if (failure === "service" || failure === "timeout") expect((await writeState(page)).enabled).toBe(false);
    await page.evaluate(() => window.__mop.effects.dispose());
  });
}

for (const changed of ["robot", "user", "connection", "administrator"]) {
  test(`double-pass late acknowledgement cannot restore the old ${changed} context`, async ({ page }) => {
    await setupWrite(page);
    await startWrite(page);
    await expect.poll(() => page.evaluate(() => window.__mop.calls.length)).toBe(1);
    const result = await page.evaluate(async (kind) => {
      const run = window.__mop;
      const next = { ...run.projection };
      if (kind === "robot") { next.entryKey = "other"; next.vacuumEntityId = "vacuum.other"; next.deepMop = { entityId: "switch.other", enabled: true }; }
      if (kind === "user") next.userKey = "other";
      if (kind === "connection") next.host = { ...next.host, connected: false };
      if (kind === "administrator") next.host = { ...next.host, administrator: false };
      run.effects.sync(next);
      if (kind === "robot") await run.effects.refreshCatalog(true);
      const before = { owner: run.store.value.owner, deepMop: run.store.value.deepMop, notice: run.store.value.notice, command: run.store.value.command };
      run.release(); await run.operation;
      const after = { owner: run.store.value.owner, deepMop: run.store.value.deepMop, notice: run.store.value.notice, command: run.store.value.command };
      run.effects.dispose(); return { before, after };
    }, changed);
    expect(result.after).toEqual(result.before);
    expect(result.after.command).not.toBe("pending");
  });
}

for (const guard of ["missing", "unknown", "busy", "read-only"]) {
  test(`double-pass refuses a ${guard} setting`, async ({ page }) => {
    await setupWrite(page);
    const calls = await page.evaluate(async (kind) => {
      const run = window.__mop;
      const next = { ...run.projection };
      if (kind === "missing") next.deepMop = null;
      if (kind === "unknown") next.deepMop = { ...next.deepMop, enabled: null };
      if (kind === "busy") next.activity = "cleaning";
      if (kind === "read-only") next.host = { ...next.host, administrator: false };
      run.effects.sync(next);
      await run.effects.executeAction("toggle-deep-mop");
      run.effects.dispose(); return run.calls;
    }, guard);
    expect(calls).toEqual([]);
  });
}

test("double-pass remains pending through a map session change and works without a current map", async ({ page }) => {
  await setupWrite(page);
  await startWrite(page);
  await expect.poll(() => page.evaluate(() => window.__mop.calls.length)).toBe(1);
  await page.evaluate(async () => {
    const run = window.__mop;
    run.entry = { ...run.entry, mapSessionKey: "replacement-session", mapRevision: run.entry.mapRevision + 1 };
    await run.effects.refreshCatalog(true);
  });
  expect(await writeState(page)).toMatchObject({ command: "pending", pending: "set-deep-mop", enabled: false });
  await page.evaluate(async () => {
    const run = window.__mop;
    run.release();
    run.effects.sync({ ...run.projection, deepMop: { ...run.projection.deepMop, enabled: true } });
    await run.operation;
    run.store.replace({ ...run.store.value, coherence: "unavailable", map: { ...run.store.value.map, complete: false } });
  });
  await startWrite(page);
  await expect.poll(() => page.evaluate(() => window.__mop.calls.length)).toBe(2);
  await page.evaluate(async () => { const run = window.__mop; run.release(); run.effects.sync(run.projection); await run.operation; run.effects.dispose(); });
});

const TAG = "matic-map-studio-gallery-v0-4-0";
async function gallery(page, scenario) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async ({ tag, scenario }) => {
    await import("/map_studio_v4-review/review.js");
    await customElements.whenDefined(tag);
    const element = document.createElement(tag); element.controls = false; element.scenario = scenario;
    document.body.style.margin = "0"; document.body.append(element);
  }, { tag: TAG, scenario });
  return page.locator(TAG);
}

for (const mobile of [false, true]) {
  test(`contextual mop controls preserve values and report unknown without a false off state${mobile ? " @mobile" : ""}`, async ({ page }) => {
    const ui = await gallery(page, "rooms-ready");
    await ui.getByRole("button", { name: /^Cleaning settings / }).click();
    const settings = ui.locator("#clean-settings");
    const mode = settings.getByRole("combobox", { name: "Cleaning mode", exact: true });
    const coverage = settings.getByRole("combobox", { name: "Vacuum coverage", exact: true });
    // The fixture has scheduled mopping due even though its base mode is Vacuum.
    await expect(settings.getByRole("switch", { name: "Double-pass mopping" })).toBeVisible();
    await settings.getByRole("switch", { name: "Use room schedules" }).click();
    await expect(settings.getByRole("switch", { name: "Double-pass mopping" })).toHaveCount(0);
    await coverage.selectOption("heavy_duty");
    await mode.selectOption("mop");
    await expect(coverage).toHaveCount(0);
    const toggle = settings.getByRole("switch", { name: "Double-pass mopping" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toHaveAccessibleDescription("All mopping · saves immediately");
    await ui.evaluate(element => {
      const state = element.getWorkspaceSnapshot();
      element.__mopActions = [];
      element.addEventListener("matic-workspace-action", event => element.__mopActions.push(event.detail.id));
      element.replaceWorkspaceState({ ...state, coherence: "unavailable", map: { ...state.map, complete: false } });
    });
    await expect(toggle).toHaveAttribute("aria-disabled", "false");
    await toggle.click();
    expect(await ui.evaluate(element => element.__mopActions)).toEqual(["toggle-deep-mop"]);
    await ui.evaluate(element => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, deepMop: { ...state.deepMop, enabled: null } });
    });
    await expect(toggle).toHaveCount(0);
    await expect(settings.getByText("Double-pass mopping", { exact: true })).toBeVisible();
    await expect(settings.getByText("Unavailable", { exact: true })).toBeVisible();
    await ui.evaluate(element => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, coherence: "current", map: { ...state.map, complete: true }, deepMop: { ...state.deepMop, enabled: true } });
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await ui.evaluate(element => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, command: "pending", pendingAction: "set-deep-mop" });
    });
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    await expect(toggle).toHaveAttribute("aria-busy", "true");
    await expect(toggle).toHaveAccessibleDescription("Saving…");
    await ui.evaluate(element => element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), command: "idle", pendingAction: null }));
    await mode.selectOption("vacuum_and_mop");
    await expect(coverage).toHaveValue("heavy_duty");
    await mode.selectOption("vacuum");
    await expect(toggle).toHaveCount(0);
    await expect(coverage).toHaveValue("heavy_duty");
  });
}

for (const scenario of ["area-review-saved", "plan-edit-areas"]) {
  test(`${scenario} shows only relevant controls while preserving coverage`, async ({ page }) => {
    const ui = await gallery(page, scenario);
    const plan = scenario === "plan-edit-areas";
    if (plan) await ui.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
    const mode = ui.getByRole("combobox", { name: plan ? "Cleaning mode for Kitchen" : "Cleaning mode", exact: true });
    const coverage = ui.getByRole("combobox", { name: plan ? "Vacuum coverage for Kitchen" : "Vacuum coverage", exact: true });
    await coverage.selectOption("heavy_duty");
    await mode.selectOption("mop");
    await expect(coverage).toHaveCount(0);
    await expect(ui.getByRole("switch", { name: "Double-pass mopping" })).toBeVisible();
    await mode.selectOption("vacuum_and_mop");
    await expect(coverage).toHaveValue("heavy_duty");
    await mode.selectOption("vacuum");
    await expect(ui.getByRole("switch", { name: "Double-pass mopping" })).toHaveCount(0);
  });
}

for (const fence of ["stopSettlePending", "nativeReconciliationPending"]) {
  test(`double-pass waits for the ${fence} catalog fence after the command settles`, async ({ page }) => {
    await setupWrite(page);
    const held = await page.evaluate(async (field) => {
      const run = window.__mop;
      run.entry = { ...run.entry, [field]: true };
      await run.effects.refreshCatalog(true);
      await run.effects.executeAction("toggle-deep-mop");
      return { calls: run.calls.length, command: run.store.value.command, locked: run.store.value.managedLock };
    }, fence);
    expect(held).toEqual({ calls: 0, command: "idle", locked: true });
    await page.evaluate(async (field) => {
      const run = window.__mop;
      run.entry = { ...run.entry, [field]: false };
      await run.effects.refreshCatalog(true);
      run.operation = run.effects.executeAction("toggle-deep-mop");
    }, fence);
    await expect.poll(() => page.evaluate(() => window.__mop.calls.length)).toBe(1);
    await page.evaluate(async () => {
      const run = window.__mop; run.release();
      run.effects.sync({ ...run.projection, deepMop: { ...run.projection.deepMop, enabled: true } });
      await run.operation; run.effects.dispose();
    });
  });
}
