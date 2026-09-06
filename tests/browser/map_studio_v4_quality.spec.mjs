import { expect, test } from "@playwright/test";

test("keeps checkbox state attached to its room when selected rows move", async ({ page }) => {
  await page.goto("/map-studio-v4-audit");
  const gallery = page.locator("matic-map-studio-gallery-v0-4-0");
  await gallery.getByRole("button", { name: /^Run a plan/ }).click();
  await gallery.getByRole("button", { name: "Create a plan", exact: true }).click();
  const rows = gallery.locator(".plan-room");
  await rows.last().getByRole("checkbox").click();
  await expect(rows.first()).toHaveAttribute("data-selected", "true");
  const assertConsistent = async () => {
    expect(await rows.evaluateAll((items) => items.map((item) => ({
      selected: item.dataset.selected === "true",
      checked: item.querySelector("input").checked,
    })).filter((item) => item.selected !== item.checked))).toEqual([]);
  };
  await assertConsistent();
  await rows.last().getByRole("checkbox").click();
  await assertConsistent();
  await rows.first().getByRole("checkbox").click();
  await assertConsistent();
});

for (const [colorScheme, header] of [["light", false], ["dark", false], ["light", true], ["dark", true]]) {
  test(`keeps the ${colorScheme} header readable with ${header ? "host header colors" : "default colors"}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/map-studio-v4-audit");
    const gallery = page.locator("matic-map-studio-gallery-v0-4-0");
    await expect(gallery.getByRole("heading", { name: "Matic Map", exact: true })).toBeVisible();
    if (header) await gallery.evaluate((element) => {
      element.style.setProperty("--app-header-background-color", "#075985");
      element.style.setProperty("--app-header-text-color", "#ffffff");
    });
    if (header) await expect(gallery.locator(".app-bar > .ms-btn").first()).toHaveCSS("color", "rgb(255, 255, 255)");
    const ratios = await gallery.locator(".app-bar").evaluate((bar) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      const luminance = (color) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const background = luminance(getComputedStyle(bar).backgroundColor);
      return [...bar.querySelectorAll("h1, button")].map((element) => {
        const foreground = luminance(getComputedStyle(element).color);
        return { name: element.getAttribute("aria-label") || element.textContent.trim(),
          ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
      });
    });
    expect(ratios.length).toBeGreaterThan(1);
    for (const result of ratios) expect(result.ratio, result.name).toBeGreaterThanOrEqual(4.5);
  });
}

async function loadQualityModules(page) {
  const { build } = await import("esbuild");
  const bundle = await build({
    stdin: { contents: `export { EffectController } from "./frontend/map-studio-v4/effects";
      export { WorkspaceStore } from "./frontend/map-studio-v4/state";
      export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
      export { PreferenceStore, preferencesKey } from "./frontend/map-studio-v4/preferences";`, resolveDir: process.cwd() },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/quality-modules.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
}

for (const action of ["save-plan", "clean-rooms"]) {
  test(`${action} preserves room IDs and never drops a missing target`, async ({ page }) => {
    await loadQualityModules(page);
    const result = await page.evaluate(async (action) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
      const initial = createGalleryState("ready");
      const targets = [
        { roomId: initial.resources.plans.value.rooms[0].roomId, cleaningMode: "vacuum", coverageSetting: "quick" },
        { roomId: "room-no-longer-listed", cleaningMode: "mop", coverageSetting: "standard" },
      ];
      const store = new WorkspaceStore({ ...initial,
        planDraft: { ...initial.planDraft, name: "Exact targets", rooms: targets, dirty: true },
        selection: { ...initial.selection, roomSettings: targets, roomIds: targets.map((room) => room.roomId) },
      });
      const calls = [];
      const effects = new EffectController(store, { service: async (...args) => calls.push(args), dispose() {} });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      try { await effects.executeAction(action); return { targets: targets.map((room) => room.roomId), sent: calls[0]?.[2]?.rooms.map((room) => room.room) }; }
      finally { effects.dispose(); }
    }, action);
    expect(result.sent).toEqual(result.targets);
  });
}

for (const context of ["disposed", "robot", "user"]) {
  for (const rejected of [false, true]) {
    test(`ignores a late ${rejected ? "failed" : "successful"} plan save after context becomes ${context}`, async ({ page }) => {
      await loadQualityModules(page);
      const result = await page.evaluate(async ({ context, rejected }) => {
        const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
        const initial = createGalleryState("ready");
        const store = new WorkspaceStore({ ...initial, planDraft: { ...initial.planDraft, dirty: true } });
        let finish;
        const effects = new EffectController(store, {
          catalog: async () => { throw new DOMException("Aborted", "AbortError"); },
          service: () => new Promise((resolve, reject) => { finish = () => rejected ? reject(new Error("Late failure")) : resolve(); }),
          dispose() {},
        });
        const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
        effects.sync(projection);
        const pending = effects.savePlan();
        if (context === "disposed") effects.dispose();
        else effects.sync({ ...projection, ...(context === "robot" ? { entryKey: "other-entry", vacuumEntityId: "vacuum.other" } : { userKey: "two" }) });
        await Promise.resolve(); await Promise.resolve();
        store.patch({ command: "idle", notice: null, planDraft: { ...store.value.planDraft, name: "New context draft", dirty: true } });
        const before = JSON.stringify({ command: store.value.command, notice: store.value.notice, draft: store.value.planDraft });
        finish(); await pending;
        const after = JSON.stringify({ command: store.value.command, notice: store.value.notice, draft: store.value.planDraft });
        effects.dispose();
        return before === after;
      }, { context, rejected });
      expect(result).toBe(true);
    });
  }
}

test("debounced preferences stay with the user who changed them", async ({ page }) => {
  await loadQualityModules(page);
  await page.clock.install();
  await page.evaluate(async () => {
    const { PreferenceStore } = await import("/quality-modules.js");
    const preferences = new PreferenceStore();
    const initial = preferences.load("first-user");
    preferences.schedule({ ...initial, view: "three" });
    preferences.load("second-user");
  });
  await page.clock.runFor(300);
  const stored = await page.evaluate(() => ({
    first: JSON.parse(localStorage.getItem("matic-map-studio:v4:first-user") || "null"),
    second: localStorage.getItem("matic-map-studio:v4:second-user"),
  }));
  expect(stored.first?.view).toBe("three");
  expect(stored.second).toBeNull();
});

for (const colorScheme of ["light", "dark"]) {
  for (const surface of ["primary", "transition"]) {
    test(`${colorScheme} ${surface} text has readable contrast`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/map-studio-v4-review");
      if (surface === "primary") {
        await page.getByRole("button", { name: "Run a plan 1 saved routine", exact: true }).click();
        await page.getByRole("button", { name: /Daily clean.*Edit plan/ }).click();
      }
      else await page.getByRole("button", { name: "transition", exact: true }).click();
      const element = page.locator(surface === "primary" ? ".action-bar .ms-btn--primary" : ".map-message");
      await expect(element).toBeVisible();
      const ratios = await element.evaluate((element) => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        const light = (color) => {
          context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          const c = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
        };
        const bg = light(getComputedStyle(element).backgroundColor);
        return [element, ...element.querySelectorAll("strong, span")].map((item) => {
          const fg = light(getComputedStyle(item).color);
          return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
        });
      });
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
}

for (const action of ["saveArea", "deleteArea"]) {
  for (const rejected of [false, true]) {
    test(`${action} ignores late ${rejected ? "failure" : "success"} after switching user`, async ({ page }) => {
      await loadQualityModules(page);
      const result = await page.evaluate(async ({ action, rejected }) => {
        const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
        const initial = createGalleryState("draw");
        const store = new WorkspaceStore(initial);
        let finish;
        let writes = 0;
        let reads = 0;
        const effects = new EffectController(store, {
          [action]: () => { writes++; return new Promise((resolve, reject) => {
            finish = () => rejected ? reject(new Error("Late failure")) : resolve("entryway");
          }); },
          areas: async () => { reads++; return initial.resources.areas.value; },
          dispose() {},
        });
        const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
        effects.sync(projection);
        const pending = effects[action]();
        await effects[action]();
        effects.sync({ ...projection, userKey: "two" });
        await Promise.resolve(); await Promise.resolve();
        store.patch({ notice: null });
        const before = JSON.stringify(store.value);
        finish(); await pending;
        const unchanged = JSON.stringify(store.value) === before;
        effects.dispose();
        return { unchanged, reads, writes };
      }, { action, rejected });
      expect(result).toEqual({ unchanged: true, reads: 0, writes: 1 });
    });
  }
}

for (const scenario of ["draw", "history"]) {
for (const change of ["user", "robot", "access", "removed"]) {
  test(`clears private ${scenario} state when ${change} changes`, async ({ page }) => {
    await loadQualityModules(page);
    const result = await page.evaluate(async ({ change, scenario }) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
      const initial = createGalleryState(scenario);
      const store = new WorkspaceStore(initial);
      const effects = new EffectController(store, { catalog: async () => { throw new DOMException("Aborted", "AbortError"); }, dispose() {} });
      const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
      effects.sync(projection);
      effects.sync({ ...projection, ...(change === "user" ? { userKey: "two" } : change === "robot" ? { entryKey: "other" } : { host: { ...initial.host, ...(change === "removed" ? { robotCount: 0 } : { administrator: false }) } }) });
      const result = { circles: store.value.draw.circles, undo: store.value.draw.undo, areaName: store.value.areaDraft.name, planName: store.value.planDraft.name, rooms: store.value.selection.roomSettings, workflow: store.value.workflow, dataMode: store.value.dataMode, label: store.value.floor.displayName, readOnly: store.value.floor.readOnly };
      effects.dispose();
      return result;
    }, { change, scenario });
    expect(result).toEqual({ circles: [], undo: [], areaName: "", planName: "", rooms: [], workflow: "none", dataMode: "live", label: "Current floor", readOnly: false });
  });
}

}

test("All tasks returns from area review to the task chooser", async ({ page }) => {
  await page.goto("/map-studio-v4-audit");
  const gallery = page.locator("matic-map-studio-gallery-v0-4-0");
  await gallery.evaluate(async (element) => {
    const module = await import("/map_studio_v4/index.js");
    element.replaceWorkspaceState({ ...module.createGalleryState("ready"), workflow: "areaReview" });
  });
  await gallery.getByRole("button", { name: "Back to all tasks", exact: true }).click();
  await expect(gallery.getByRole("button", { name: /^One-time clean/ })).toBeVisible();
});


test("a changed live floor clears the previous floor's drafts and scene", async ({ page }) => {
  await loadQualityModules(page);
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
    const initial = createGalleryState("draw");
    const store = new WorkspaceStore({ ...initial, precisionOpen: true, dialog: "confirmDeleteArea", fullMap: true });
    const next = { ...initial.resources.entry, selectedFloorOrdinal: 9, mapFloorOrdinal: 9, mapSessionKey: "next-floor" };
    const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
    const effects = new EffectController(store, { catalog: async () => [next], scene: aborted, pose: aborted, history: aborted, plans: aborted, dispose() {} });
    effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
    await effects.refreshCatalog(true);
    const result = { circles: store.value.draw.circles, planName: store.value.planDraft.name, areaName: store.value.areaDraft.name, scene: store.value.resources.scene.value, rooms: store.value.selection.roomSettings, workflow: store.value.workflow, precisionOpen: store.value.precisionOpen, dialog: store.value.dialog, fullMap: store.value.fullMap };
    effects.dispose();
    return result;
  });
  expect(result).toEqual({ circles: [], planName: "", areaName: "", scene: null, rooms: [], workflow: "none", precisionOpen: false, dialog: null, fullMap: false });
});


test("a newly rendered narrow floor selector matches the saved map", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/map-studio-v4-audit");
  const gallery = page.locator("matic-map-studio-gallery-v0-4-0");
  await gallery.evaluate(async (element) => {
    const module = await import("/map_studio_v4/index.js");
    const state = module.createGalleryState("history");
    element.replaceWorkspaceState({ ...state, workflow: "none", selection: { ...state.selection, floorId: "saved-1" } });
  });
  await expect(gallery.getByRole("combobox", { name: "Choose floor", exact: true })).toHaveValue("saved-1");
});


for (const outcome of ["success", "failure", "settle-timer"]) {
  test(`floor change invalidates old motion ${outcome}`, async ({ page }) => {
    await loadQualityModules(page);
    await page.clock.install();
    const result = await page.evaluate(async (outcome) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
      const initial = createGalleryState("draw");
      const store = new WorkspaceStore(initial);
      let finish;
      const next = { ...initial.resources.entry, selectedFloorOrdinal: 9, mapFloorOrdinal: 9, mapSessionKey: "next-floor" };
      const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
      const effects = new EffectController(store, { catalog: async () => [next], scene: aborted, pose: aborted, history: aborted, plans: aborted,
        service: () => new Promise((resolve, reject) => { finish = () => outcome === "failure" ? reject(new Error("Late failure")) : resolve(); }), dispose() {} });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      const pending = effects.executeAction("run-area");
      if (outcome === "settle-timer") { finish(); await pending; }
      await effects.refreshCatalog(true);
      store.patch({ command: "starting", notice: { tone: "info", text: "New floor action" } });
      if (outcome !== "settle-timer") { finish(); await pending; }
      window.qualityMotion = { store, effects };
      return store.value.command;
    }, outcome);
    expect(result).toBe("starting");
    await page.clock.fastForward(16000);
    expect(await page.evaluate(() => {
      const { store, effects } = window.qualityMotion;
      const result = { command: store.value.command, text: store.value.notice?.text };
      effects.dispose(); delete window.qualityMotion;
      return result;
    })).toEqual({ command: "starting", text: "New floor action" });
  });
}

for (const sameOwner of [true, false]) {
  test(`reattached controllers ${sameOwner ? "retain the same owner's" : "clear another owner's"} draft`, async ({ page }) => {
    await loadQualityModules(page);
    const result = await page.evaluate(async (sameOwner) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
      const initial = createGalleryState("draw");
      const store = new WorkspaceStore(initial);
      const backend = () => ({ catalog: async () => { throw new DOMException("Aborted", "AbortError"); }, dispose() {} });
      const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
      const first = new EffectController(store, backend());
      first.sync(projection); first.dispose();
      const second = new EffectController(store, backend());
      second.sync({ ...projection, userKey: sameOwner ? "one" : "two" });
      const result = { name: store.value.areaDraft.name, circles: store.value.draw.circles.length };
      second.dispose();
      return { ...result, originalCount: initial.draw.circles.length };
    }, sameOwner);
    expect(result.name).toBe(sameOwner ? "Entryway" : "");
    expect(result.circles).toBe(sameOwner ? result.originalCount : 0);
  });
}

for (const rejected of [false, true]) {
  test(`floor navigation clears a cancelled plan mutation before late ${rejected ? "failure" : "success"}`, async ({ page }) => {
    await loadQualityModules(page);
    const result = await page.evaluate(async (rejected) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      let finish;
      const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
      const effects = new EffectController(store, { catalog: async () => [initial.resources.entry], scene: aborted, pose: aborted, history: aborted, plans: aborted,
        service: () => new Promise((resolve, reject) => { finish = () => rejected ? reject(new Error("Late failure")) : resolve(); }), dispose() {} });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      const pending = effects.savePlan();
      await effects.selectFloor("saved-1");
      const saved = { command: store.value.command, notice: store.value.notice };
      await effects.selectFloor("current");
      const live = { command: store.value.command, notice: store.value.notice };
      finish(); await pending;
      const final = { command: store.value.command, notice: store.value.notice };
      effects.dispose();
      return { saved, live, final };
    }, rejected);
    expect(result).toEqual({ saved: { command: "idle", notice: null }, live: { command: "idle", notice: null }, final: { command: "idle", notice: null } });
  });
}

for (const sameFloor of [true, false]) {
  test(`revalidation preserves drafts until ${sameFloor ? "the same" : "a different"} floor is verified`, async ({ page }) => {
    await loadQualityModules(page);
    const result = await page.evaluate(async (sameFloor) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
      const initial = createGalleryState("draw");
      const store = new WorkspaceStore({ ...initial, areaDraft: { ...initial.areaDraft, name: "Edited outline", dirty: true }, planDraft: { ...initial.planDraft, name: "Edited plan", dirty: true } });
      let entry = { ...initial.resources.entry, mapFloorOrdinal: null, mapFloorCoherent: false };
      const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
      const effects = new EffectController(store, { catalog: async () => [entry], scene: aborted, pose: aborted, history: aborted, plans: aborted, areas: async () => initial.resources.areas.value, dispose() {} });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      await effects.refreshCatalog(true);
      const unknown = { name: store.value.areaDraft.name, count: store.value.draw.circles.length, available: store.value.map.available };
      entry = sameFloor ? initial.resources.entry : { ...initial.resources.entry, selectedFloorOrdinal: 9, mapFloorOrdinal: 9, mapSessionKey: "new-floor" };
      await effects.refreshCatalog(true);
      if (sameFloor) {
        store.patch({ map: initial.map, coherence: "current" });
        await effects.loadAreas();
      }
      const restored = { name: store.value.areaDraft.name, plan: store.value.planDraft.name, count: store.value.draw.circles.length };
      effects.dispose();
      return { unknown, restored, count: initial.draw.circles.length };
    }, sameFloor);
    expect(result.unknown).toEqual({ name: "Edited outline", count: result.count, available: false });
    expect(result.restored).toEqual(sameFloor ? { name: "Edited outline", plan: "Edited plan", count: result.count } : { name: "", plan: "", count: 0 });
  });
}

for (const dispose of [false, true]) {
  test(`preserves both owners' rapid preference changes before ${dispose ? "disposal" : "debounce"}`, async ({ page }) => {
    await loadQualityModules(page);
    await page.clock.install();
    await page.evaluate(async (dispose) => {
      const { PreferenceStore } = await import("/quality-modules.js");
      const preferences = new PreferenceStore();
      preferences.schedule({ ...preferences.load("first-user"), view: "three" });
      preferences.schedule({ ...preferences.load("second-user"), quality: "maximum" });
      if (dispose) preferences.dispose();
    }, dispose);
    if (!dispose) await page.clock.runFor(300);
    const stored = await page.evaluate(() => ({
      first: JSON.parse(localStorage.getItem("matic-map-studio:v4:first-user") || "null"),
      second: JSON.parse(localStorage.getItem("matic-map-studio:v4:second-user") || "null"),
    }));
    expect(stored.first?.view).toBe("three");
    expect(stored.second?.quality).toBe("maximum");
  });
}

for (const change of ["user", "robot"]) {
  test(`immediately replaces an aborted forced catalog after ${change} changes`, async ({ page }) => {
    await loadQualityModules(page);
    const result = await page.evaluate(async (change) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      let calls = 0;
      const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
      const effects = new EffectController(store, {
        catalog: (signal) => {
          calls += 1;
          if (calls === 1) return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
          return Promise.resolve([initial.resources.entry]);
        }, scene: aborted, pose: aborted, history: aborted, plans: aborted, areas: aborted, dispose() {},
      });
      const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
      effects.sync(projection);
      const first = effects.refreshCatalog(true);
      effects.sync({ ...projection, userKey: change === "user" ? "two" : "one", entryKey: change === "robot" ? "other" : projection.entryKey });
      await first;
      const result = { calls, status: store.value.resources.catalog.status };
      effects.dispose();
      return result;
    }, change);
    expect(result.calls).toBeGreaterThanOrEqual(2);
    expect(result.status).toBe("ready");
  });
}

test("a rejected pose session cannot be resurrected by a same-floor catalog refresh", async ({ page }) => {
  await loadQualityModules(page);
  await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/quality-modules.js");
    const initial = createGalleryState("ready");
    const store = new WorkspaceStore(initial);
    let poses = 0;
    window.poseRecoveryCatalogs = 0;
    const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
    const effects = new EffectController(store, {
      catalog: async () => { window.poseRecoveryCatalogs += 1; return [initial.resources.entry]; },
      pose: async () => {
        poses += 1;
        if (poses > 1) return new Promise(() => {});
        return { ...initial.resources.pose.value, floorCoherent: true, mapSessionKey: "different-session" };
      }, scene: aborted, history: aborted, plans: aborted, areas: aborted, dispose() {},
    });
    window.poseRecoveryStore = store;
    window.poseRecoveryEffects = effects;
    effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
    void effects.refreshCatalog(true);
  });
  await expect.poll(() => page.evaluate(() => window.poseRecoveryCatalogs)).toBeGreaterThanOrEqual(2);
  const result = await page.evaluate(() => ({ exactPose: window.poseRecoveryStore.value.map.exactPose, pose: window.poseRecoveryStore.value.resources.pose.value }));
  expect(result).toEqual({ exactPose: false, pose: null });
  await page.evaluate(() => window.poseRecoveryEffects.dispose());
});

for (const width of [320, 390, 820, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`plan picker separates selection and creation at ${width}px ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/map-studio-v4-audit");
      const gallery = page.locator("matic-map-studio-gallery-v0-4-0");
      await gallery.evaluate((element, theme) => {
        element.theme = theme;
        const state = element.getWorkspaceSnapshot();
        const plan = state.resources.plans.value.plans[0];
        element.replaceWorkspaceState({ ...state, resources: { ...state.resources,
          plans: { ...state.resources.plans, value: { ...state.resources.plans.value,
            plans: [plan, { ...plan, id: "second", name: "Evening routine", enabled: false }] } } } });
      }, theme);
      const menu = gallery.getByRole("button", { name: "Open Home Assistant sidebar" });
      const title = gallery.getByRole("heading", { name: "Matic Map", exact: true });
      const toggle = gallery.getByRole("button", { name: "Hide cleaning panel", exact: true });
      const [m, t, w] = await Promise.all([menu.boundingBox(), title.boundingBox(), toggle.boundingBox()]);
      expect(m.x + m.width).toBeLessThanOrEqual(t.x);
      expect(w.x).toBeGreaterThan(t.x);
      await gallery.getByRole("button", { name: /^Run a plan/ }).click();
      await expect(gallery.getByRole("heading", { name: "Your plans", exact: true })).toBeVisible();
      await expect(gallery.getByRole("textbox", { name: "Plan name" })).toHaveCount(0);
      await expect(gallery.getByRole("button", { name: "Run this plan", exact: true })).toHaveCount(0);
      const create = gallery.getByRole("button", { name: "Create a plan", exact: true });
      const choice = gallery.getByRole("button", { name: /Evening routine.*paused.*Edit plan/ });
      for (const control of [menu, create, choice]) {
        const box = await control.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: testInfo.outputPath(`picker-${width}-${theme}.png`) });
      await choice.click();
      await expect(gallery.getByRole("heading", { name: "Edit plan", exact: true })).toBeVisible();
      await expect(gallery.getByRole("textbox", { name: "Plan name" })).toHaveValue("Evening routine");
      await gallery.getByRole("button", { name: "Back to plans", exact: true }).click();
      await create.click();
      await expect(gallery.getByRole("textbox", { name: "Plan name" })).toHaveValue("");
      const draft = await gallery.evaluate((element) => element.getWorkspaceSnapshot().planDraft);
      expect(draft).toMatchObject({ id: null, name: "", rooms: [], enabled: true, dirty: false });
    });
  }
}

test("Escape from the plan editor returns to the picker", async ({ page }) => {
  await page.goto("/map-studio-v4-audit");
  const gallery = page.locator("matic-map-studio-gallery-v0-4-0");
  await gallery.getByRole("button", { name: /^Run a plan/ }).click();
  await gallery.getByRole("button", { name: /Daily clean.*Edit plan/ }).click();
  await page.keyboard.press("Escape");
  await expect(gallery.getByRole("heading", { name: "Your plans", exact: true })).toBeVisible();
});

test("discarding plan edits through Escape returns to the picker", async ({ page }) => {
  await page.goto("/map-studio-v4-audit");
  const gallery = page.locator("matic-map-studio-gallery-v0-4-0");
  await gallery.getByRole("button", { name: /^Run a plan/ }).click();
  await gallery.getByRole("button", { name: /Daily clean.*Edit plan/ }).click();
  await gallery.getByRole("textbox", { name: "Plan name" }).fill("Unsaved change");
  await page.keyboard.press("Escape");
  const dialog = gallery.getByRole("dialog", { name: "Discard plan changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(gallery.getByRole("heading", { name: "Your plans", exact: true })).toBeVisible();
  await gallery.getByRole("button", { name: /Daily clean.*Edit plan/ }).click();
  await expect(gallery.getByRole("textbox", { name: "Plan name" })).toHaveValue("Daily clean");
});
