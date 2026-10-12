import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const PREFIX = "component.matic_robot.common.";

const PLAN_CATALOG = {
  rooms: [
    { room_id: "room-a", name: "Kitchen" },
    { room_id: "room-b", name: "Hall" },
  ],
  selected_plan: null,
  plans: [],
};

// The templates a fake `localize` answers with, each reordered the way a
// translation may. Keys it does not know come back unchanged, which is Home
// Assistant's own miss behaviour.
const TEMPLATES = {
  v4_action_clean_rooms_count: "Räume reinigen: {count}",
  v4_action_clean_rooms_count_one: "Einen Raum reinigen",
  v4_brush_button: "Pinselbreite {brush}, Einstellungen",
  v4_brush: "Pinsel {brush}",
  v4_map_scale: "Maßstab {distance}",
  v4_rooms_selected: "Gewählt: {count} Räume",
  v4_rooms_selected_names: "Räume gewählt: {count} · {rooms}",
  v4_rooms_summary_dock: "{rooms}, danach zurück zum Dock",
  v4_zone_add_point_after: "Punkt nach {number} hinzufügen",
  v4_history_position: "{position} von {count}",
};

// Installs `window.__localize`, which answers from TEMPLATES and records the
// placeholders it is handed. Call it before the page loads.
const installLocalize = (page) => page.addInitScript(({ prefix, templates }) => {
  window.__localizeCalls = [];
  window.__localize = (key, placeholders) => {
    const name = key.slice(prefix.length);
    window.__localizeCalls.push({ key: name, placeholders });
    const template = templates[name];
    return template ? template.replace(/\{(\w+)\}/gu, (_, field) => placeholders?.[field] ?? "") : key;
  };
}, { prefix: PREFIX, templates: TEMPLATES });

async function mountPanel(page, fixtureOptions = {}) {
  await installLocalize(page);
  const fixture = await installPanelFixture(page, { initialPlanCatalog: PLAN_CATALOG, ...fixtureOptions });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    panel.hass = { ...panel.hass, localize: window.__localize };
    window.__translationPanel = panel;
    document.body.append(panel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__translationPanel.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.resources.plans.status === "ready";
  })).toBe(true);
  return panel;
}

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

// Mounts a gallery scenario whose shell speaks through the fake localize.
async function mountGallery(page, { scenario, narrow = false }) {
  await installLocalize(page);
  await page.goto("/");
  await page.evaluate(async ({ tag, selectedScenario, selectedNarrow }) => {
    await import("/map_studio_v4-review/review.js");
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = selectedScenario;
    gallery.narrow = selectedNarrow;
    document.body.style.margin = "0";
    document.body.append(gallery);
    await gallery.updateComplete;
    gallery.shadowRoot.querySelector("matic-map-shell-v4").localize = window.__localize;
  }, { tag: GALLERY_TAG, selectedScenario: scenario, selectedNarrow: narrow });
  return page.locator(GALLERY_TAG);
}

const sendIntent = (page, detail) => page.evaluate((intent) => {
  window.__translationPanel.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent(
    "matic-workspace-intent",
    { detail: intent, bubbles: true, composed: true },
  ));
}, detail);

const localizeCalls = (page, key) => page.evaluate(
  (name) => window.__localizeCalls.filter((call) => call.key === name),
  key,
);

test("counted labels take their numbers from placeholders", async ({ page }) => {
  const panel = await mountPanel(page);
  await sendIntent(page, { type: "open-workflow", workflow: "rooms" });
  await sendIntent(page, { type: "toggle-room", roomId: "room-a" });
  await sendIntent(page, { type: "toggle-room", roomId: "room-b" });

  await expect(panel.getByRole("button", { name: "Räume reinigen: 2", exact: true })).toBeVisible();
  const counted = await localizeCalls(page, "v4_action_clean_rooms_count");
  expect(counted.length).toBeGreaterThan(0);
  expect(counted.every((call) => call.placeholders?.count === 2)).toBe(true);

  await sendIntent(page, { type: "toggle-room", roomId: "room-b" });
  await expect(panel.getByRole("button", { name: "Einen Raum reinigen", exact: true })).toBeVisible();
  expect((await localizeCalls(page, "v4_action_clean_rooms_count_one")).length).toBeGreaterThan(0);
});

test("the brush label and its accessible name take the width from placeholders", async ({ page }) => {
  const panel = await mountPanel(page);
  await sendIntent(page, { type: "open-workflow", workflow: "draw" });
  await sendIntent(page, { type: "set-draw-tool", tool: "paint" });

  // Found by class: its accessible name is the translated text under test.
  const brush = panel.locator(".draw-brush").first();
  await expect(brush).toHaveAttribute("aria-label", /^Pinselbreite \d+\.\d{2} m, Einstellungen$/);
  await expect(brush).toContainText(/^Pinsel \d+\.\d{2} m$/);
  for (const key of ["v4_brush_button", "v4_brush"]) {
    const calls = await localizeCalls(page, key);
    expect(calls.length, key).toBeGreaterThan(0);
    expect(calls.every((call) => /^\d+\.\d{2} m$/.test(call.placeholders?.brush)), key).toBe(true);
  }
});

// map-surfaces.md §5: the scale bar stays with a translated label.
test("the scale bar's accessible name takes its distance from a placeholder", async ({ page }) => {
  const panel = await mountPanel(page);
  await sendIntent(page, { type: "open-workflow", workflow: "draw" });

  // Found by class: its accessible name is the translated text under test.
  const scale = panel.locator(".map-scale");
  await expect(scale).toHaveAttribute("aria-label", /^Maßstab [\d.]+ c?m$/);
  const calls = await localizeCalls(page, "v4_map_scale");
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((call) => /^[\d.]+ c?m$/.test(call.placeholders?.distance))).toBe(true);
});

// Patches the mounted panel the way Home Assistant does when it swaps the
// connection, language or loader, and waits for the render to settle. The
// "__loader__" and "__connection__" markers stand for a fresh recording
// loader (installed by installLoader) and a fresh connection object.
const patchHass = (page, fields) => page.evaluate(async (patch) => {
  const panel = window.__translationPanel;
  const next = { ...panel.hass };
  for (const [name, value] of Object.entries(patch)) {
    if (value === "__loader__") next[name] = window.__loader;
    else if (value === "__connection__") next[name] = {};
    else next[name] = value === null ? undefined : value;
  }
  panel.hass = next;
  for (let attempt = 0; attempt < 5; attempt += 1) await panel.updateComplete;
}, fields);

const installLoader = (page, mode = "resolve") => page.evaluate((behaviour) => {
  window.__loaderCalls = [];
  window.__loader = (...args) => {
    window.__loaderCalls.push(args);
    if (behaviour === "reject") return Promise.reject(new Error("synthetic loader failure"));
    if (behaviour === "never") return new Promise(() => {});
    return Promise.resolve({});
  };
}, mode);

const loaderCalls = (page) => page.evaluate(() => window.__loaderCalls);

test("the panel requests matic common translations once per connection and language", async ({ page }) => {
  await mountPanel(page);
  await installLoader(page);
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toEqual([["common", "matic_robot"]]);

  // Repeats of the same pair and unrelated hass updates do not ask again.
  await patchHass(page, { language: "de" });
  await patchHass(page, { states: { "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } } } });
  await page.waitForTimeout(100);
  expect(await loaderCalls(page)).toEqual([["common", "matic_robot"]]);
});

// Home Assistant resets its loaded-integration set in the same synchronous
// call that writes a new language into hass (see the comment in panel.ts), so
// a new localize or resources object for the same language needs no request.
test("a new localize or resources for the same language does not ask again", async ({ page }) => {
  await mountPanel(page);
  await installLoader(page);
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toHaveLength(1);

  await page.evaluate(async () => {
    const panel = window.__translationPanel;
    panel.hass = { ...panel.hass, localize: (key) => key, resources: { de: {} } };
    for (let attempt = 0; attempt < 5; attempt += 1) await panel.updateComplete;
  });
  await page.waitForTimeout(100);
  expect(await loaderCalls(page)).toEqual([["common", "matic_robot"]]);
});

test("a language change requests common translations again", async ({ page }) => {
  await mountPanel(page);
  await installLoader(page);
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toHaveLength(1);

  // A language-only hass update is dropped by shouldUpdate's projection check,
  // so the request has to be made there.
  await patchHass(page, { language: "fr" });
  await expect.poll(() => loaderCalls(page)).toEqual([
    ["common", "matic_robot"],
    ["common", "matic_robot"],
  ]);
});

test("a new connection requests common translations again", async ({ page }) => {
  await mountPanel(page);
  await installLoader(page);
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toHaveLength(1);

  await patchHass(page, { connection: "__connection__" });
  await expect.poll(() => loaderCalls(page)).toEqual([
    ["common", "matic_robot"],
    ["common", "matic_robot"],
  ]);
});

test("a missing, rejecting or never-settling loader leaves the panel usable", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panel = await mountPanel(page, {
    initialRobotStates: { "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } } },
  });

  // Missing: the panel does not call anything and keeps rendering.
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: null });
  await sendIntent(page, { type: "open-workflow", workflow: "rooms" });
  await expect(panel.locator("h2").first()).toBeVisible();
  await expect(panel.getByRole("button", { name: "Stop cleaning" }).first()).toBeVisible();

  for (const mode of ["reject", "never"]) {
    await installLoader(page, mode);
    await patchHass(page, { connection: "__connection__", language: `${mode}-lang`, loadBackendTranslation: "__loader__" });
    await expect.poll(() => loaderCalls(page)).toHaveLength(1);
    await page.waitForTimeout(100);
    await expect(panel.locator("h2").first()).toBeVisible();
    await expect(panel.getByRole("button", { name: "Stop cleaning" }).first()).toBeVisible();
    // No immediate retry for the same connection and language; a rejected
    // load waits 30 s ("a rejected common load is retried once every 30 seconds").
    expect(await loaderCalls(page)).toHaveLength(1);
  }
  expect(errors).toEqual([]);
});

test("a Home Assistant translation error string falls back to English", async ({ page }) => {
  const panel = await mountPanel(page);
  await page.evaluate(() => {
    const element = window.__translationPanel;
    const localize = element.hass.localize;
    element.hass = {
      ...element.hass,
      localize: (key, placeholders) => {
        const name = key.slice("component.matic_robot.common.".length);
        if (name === "v4_brush_button") return "Translation error: no such key";
        if (name === "v4_brush") return "";
        return localize(key, placeholders);
      },
    };
  });
  await sendIntent(page, { type: "open-workflow", workflow: "draw" });
  await sendIntent(page, { type: "set-draw-tool", tool: "paint" });

  // Found by class: its accessible name is the translated text under test.
  const brush = panel.locator(".draw-brush").first();
  await expect(brush).toHaveAttribute("aria-label", /^Brush width, \d+\.\d{2} m\. Opens brush settings\.$/);
  await expect(brush).toContainText(/^Brush \d+\.\d{2} m$/);
});

test("a localize that throws falls back to English", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panel = await mountPanel(page);
  await page.evaluate(() => {
    const element = window.__translationPanel;
    element.hass = {
      ...element.hass,
      localize: () => { throw new Error("synthetic localize failure"); },
    };
  });
  await sendIntent(page, { type: "open-workflow", workflow: "draw" });
  await sendIntent(page, { type: "set-draw-tool", tool: "paint" });

  // Found by class: its accessible name is the translated text under test.
  const brush = panel.locator(".draw-brush").first();
  await expect(brush).toHaveAttribute("aria-label", /^Brush width, \d+\.\d{2} m\. Opens brush settings\.$/);
  await expect(brush).toContainText(/^Brush \d+\.\d{2} m$/);
  expect(errors).toEqual([]);
});

// The gallery's Rooms scenario carries a ready room preview, so the action
// summary lists the selected rooms.
const selectRooms = (page, count) => page.evaluate(({ tag, wanted }) => {
  const gallery = document.querySelector(tag);
  const shell = gallery.shadowRoot.querySelector("matic-map-shell-v4");
  const rooms = gallery.getWorkspaceSnapshot().resources.plans.value.rooms.slice(0, wanted);
  for (const { roomId } of rooms) {
    shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "toggle-room", roomId }, bubbles: true, composed: true,
    }));
  }
  return rooms.map((room) => room.name);
}, { tag: GALLERY_TAG, wanted: count });

const joinRooms = (page, locale, rooms) => page.evaluate(({ language, names }) =>
  new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(names),
{ language: locale, names: rooms });

test("room lists are joined for the panel language", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async (tag) => {
    await import("/map_studio_v4-review/review.js");
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = "rooms";
    document.body.append(gallery);
    await gallery.updateComplete;
  }, GALLERY_TAG);
  const names = await selectRooms(page, 3);
  expect(names).toHaveLength(3);
  for (const language of ["de", "en"]) {
    await page.evaluate(({ tag, locale }) => {
      const gallery = document.querySelector(tag);
      gallery.replaceWorkspaceState({ ...gallery.getWorkspaceSnapshot(), locale });
    }, { tag: GALLERY_TAG, locale: language });
    const list = await joinRooms(page, language, names);
    // Found by class: the summary is a plain paragraph with no role or name.
    await expect(page.locator(GALLERY_TAG).locator(".action-summary"), language)
      .toHaveText(`${list} · returns to the dock`);
  }
});

test("the room summary and selection chip take their rooms and count from placeholders", async ({ page }) => {
  const gallery = await mountGallery(page, { scenario: "rooms" });
  const names = await selectRooms(page, 3);
  const list = await joinRooms(page, "en", names);

  // Found by class: the summary is a plain paragraph with no role or name.
  await expect(gallery.locator(".action-summary")).toHaveText(`${list}, danach zurück zum Dock`);
  // The chip has no role or name of its own; its text is the contract.
  await expect(gallery.getByText("Gewählt: 3 Räume", { exact: true })).toBeVisible();
  const dock = await localizeCalls(page, "v4_rooms_summary_dock");
  expect(dock.at(-1).placeholders).toEqual({ rooms: list });
  const chip = await localizeCalls(page, "v4_rooms_selected");
  expect(chip.at(-1).placeholders).toEqual({ count: 3 });
});

test("@mobile the sheet's status line names the selected rooms beside a paused robot", async ({ page }) => {
  const gallery = await mountGallery(page, { scenario: "rooms", narrow: true });
  const names = await selectRooms(page, 2);
  const list = await joinRooms(page, "en", names);
  await page.evaluate((tag) => {
    const element = document.querySelector(tag);
    element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), activity: "paused" });
  }, GALLERY_TAG);
  await gallery.getByRole("button", { name: "Show less of the map workspace" }).click();

  await expect(gallery.getByRole("complementary", { name: "Map workspace" })).toContainText(`Paused · Räume gewählt: 2 · ${list}`);
  const status = await localizeCalls(page, "v4_rooms_selected_names");
  expect(status.at(-1).placeholders).toEqual({ count: 2, rooms: list });
});

test("the history list numbers its saved maps from placeholders", async ({ page }) => {
  const gallery = await mountGallery(page, { scenario: "history" });
  const count = await page.evaluate((tag) =>
    document.querySelector(tag).getWorkspaceSnapshot().resources.history.value.floors
      .find((floor) => floor.id === "saved-1").snapshots.length, GALLERY_TAG);

  await expect(gallery.getByRole("button", { name: new RegExp(` 1 von ${count}$`, "u") })).toBeVisible();
  const positions = (await localizeCalls(page, "v4_history_position")).map((call) => call.placeholders);
  expect(positions).toContainEqual({ position: 1, count });
  expect(positions).toContainEqual({ position: count, count });
});

test("an outline's add-point buttons take the point number from a placeholder", async ({ page }) => {
  const gallery = await mountGallery(page, { scenario: "draw" });
  await page.evaluate((tag) => {
    const element = document.querySelector(tag), state = element.getWorkspaceSnapshot();
    element.replaceWorkspaceState({ ...state, cameras: { top: { yaw: 0, pitch: 0, zoom: 2, targetX: 2.475, targetZ: -1.975 } },
      draw: { ...state.draw, circles: [], outline: null, undo: [], redo: [], strokeCount: 0, dirty: false } });
  }, GALLERY_TAG);
  await gallery.getByRole("button", { name: "Points", exact: true }).click();
  const box = await gallery.getByRole("region", { name: "Interactive Matic 3D map" }).boundingBox();
  for (const [x, y] of [[-90, -70], [90, -70], [90, 70]]) {
    await page.mouse.click(box.x + box.width * 0.5 + x, box.y + box.height * 0.5 + y);
  }

  await expect(gallery.getByRole("button", { name: "Punkt nach 1 hinzufügen" })).toBeVisible();
  const calls = await localizeCalls(page, "v4_zone_add_point_after");
  expect(calls.map((call) => call.placeholders)).toContainEqual({ number: 1 });
});

test("a rejected common load is retried once every 30 seconds", async ({ page }) => {
  await page.clock.install();
  await mountPanel(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await page.evaluate(() => {
    window.__loaderCalls = [];
    window.__loader = function load(...args) {
      window.__loaderCalls.push({ args, boundToHass: this?.loadBackendTranslation === load });
      return Promise.reject(new Error("synthetic loader failure"));
    };
  });
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toEqual([{ args: ["common", "matic_robot"], boundToHass: true }]);

  // Hass updates while the retry waits never ask again.
  for (let battery = 50; battery < 60; battery += 1) {
    await patchHass(page, { states: { "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry", battery_level: battery } } } });
  }
  await page.clock.runFor(29_000);
  expect(await loaderCalls(page)).toHaveLength(1);
  await page.clock.runFor(1_000);
  await expect.poll(() => loaderCalls(page)).toHaveLength(2);
  expect((await loaderCalls(page))[1]).toEqual({ args: ["common", "matic_robot"], boundToHass: true });

  // The retry rejected as well, so the next one waits another 30 seconds.
  await page.clock.runFor(29_000);
  expect(await loaderCalls(page)).toHaveLength(2);
  await page.clock.runFor(1_000);
  await expect.poll(() => loaderCalls(page)).toHaveLength(3);
});

test("a language that fails while an older retry waits gets its own retry", async ({ page }) => {
  await page.clock.install();
  await mountPanel(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await page.evaluate(() => {
    window.__loaderCalls = [];
    window.__loader = function load() {
      window.__loaderCalls.push(this.language);
      return Promise.reject(new Error("synthetic loader failure"));
    };
  });
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toEqual(["de"]);
  await page.clock.runFor(10_000);
  await patchHass(page, { language: "fr" });
  await expect.poll(() => loaderCalls(page)).toEqual(["de", "fr"]);
  await page.clock.runFor(30_000);
  await expect.poll(() => loaderCalls(page)).toEqual(["de", "fr", "fr"]);
});

// A loader whose calls are recorded by language and settle only when the test
// says: window.__settleLoad(index, "reject" | "resolve").
const installHeldLoader = (page) => page.evaluate(() => {
  window.__loaderCalls = [];
  const settlers = [];
  window.__settleLoad = (index, outcome) => settlers[index][outcome]();
  window.__loader = function load() {
    window.__loaderCalls.push(this.language);
    return new Promise((resolve, reject) => {
      settlers.push({ resolve: () => resolve({}), reject: () => reject(new Error("synthetic loader failure")) });
    });
  };
});
const reattach = (page, step) => page.evaluate(async (which) => {
  const panel = window.__translationPanel;
  if (which === "detach") panel.remove();
  else document.body.append(panel);
  await panel.updateComplete;
}, step);
const settleLoad = (page, index, outcome) => page.evaluate(async ({ at, how }) => {
  window.__settleLoad(at, how);
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
}, { at: index, how: outcome });

test("a load that rejects after the panel is detached is asked again on reattach", async ({ page }) => {
  await page.clock.install();
  await mountPanel(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await installHeldLoader(page);
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toEqual(["de"]);
  await reattach(page, "detach");
  await settleLoad(page, 0, "reject");
  await reattach(page, "attach");
  await expect.poll(() => loaderCalls(page)).toEqual(["de", "de"]);
});

test("detaching while a newer language loads does not ask for it twice", async ({ page }) => {
  await page.clock.install();
  await mountPanel(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await installHeldLoader(page);
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toEqual(["de"]);
  // "de" fails and waits for its retry; "fr" is then asked and stays pending.
  await settleLoad(page, 0, "reject");
  await patchHass(page, { language: "fr" });
  await expect.poll(() => loaderCalls(page)).toEqual(["de", "fr"]);
  await reattach(page, "detach");
  await reattach(page, "attach");
  await patchHass(page, { language: "fr" });
  expect(await loaderCalls(page)).toEqual(["de", "fr"]);
});

test("a never-settling common load is not retried", async ({ page }) => {
  await page.clock.install();
  await mountPanel(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await installLoader(page, "never");
  await patchHass(page, { connection: "__connection__", language: "de", loadBackendTranslation: "__loader__" });
  await expect.poll(() => loaderCalls(page)).toHaveLength(1);
  await page.clock.runFor(120_000);
  await patchHass(page, { language: "de" });
  expect(await loaderCalls(page)).toHaveLength(1);
});

// Shows the saved map after the live scene fails, which raises the saved-map
// notice with its {date}. `hass` adds Home Assistant's locale and config.
async function showSavedMap(page, hass) {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: PLAN_CATALOG });
  await page.evaluate((extra) => {
    const panel = window.__panelFixture.createPanel();
    const fetchWithAuth = panel.hass.fetchWithAuth;
    panel.hass = {
      ...panel.hass,
      ...extra,
      fetchWithAuth: (path, init) => (/slam_scene\/synthetic$/u.test(path)
        ? Promise.resolve(new Response("", { status: 503 }))
        : fetchWithAuth(path, init)),
    };
    window.__translationPanel = panel;
    document.body.append(panel);
  }, hass);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingHistoryScenes.length)).toBeGreaterThan(0);
  await page.evaluate(() => window.__panelFixture.pendingHistoryScenes.shift()());
  await expect.poll(() => page.evaluate(() =>
    window.__translationPanel.getWorkspaceSnapshot().notice?.key ?? null)).toBe("v4_notice_saved_map");
  return {
    panel: page.locator(fixture.panelTag),
    notice: await page.evaluate(() => window.__translationPanel.getWorkspaceSnapshot().notice),
  };
}

const SNAPSHOT_TIME = "2026-09-25T12:00:00Z";

// The saved snapshot's time as the history list shows it.
const snapshotTime = (page, language, timeZone) => page.evaluate(([tag, zone, time]) => new Intl.DateTimeFormat(tag ?? undefined, {
  dateStyle: "medium", timeStyle: "short", timeZone: zone ?? undefined,
}).format(new Date(time)), [language ?? null, timeZone ?? null, SNAPSHOT_TIME]);

const savedMapSentence = (date) => `Showing the saved map from ${date} without the robot's position.`;

const showSnapshotInHistory = async (page) => {
  const snapshotId = await page.evaluate((time) => window.__translationPanel.getWorkspaceSnapshot()
    .resources.history.value.floors.flatMap((floor) => floor.snapshots)
    .find((snapshot) => snapshot.createdAt === time).id, SNAPSHOT_TIME);
  await sendIntent(page, { type: "open-workflow", workflow: "history" });
  await sendIntent(page, { type: "set-history", historyId: snapshotId });
};

test("the saved-map date follows Home Assistant's language and server time zone", async ({ page }) => {
  const { panel, notice } = await showSavedMap(page, {
    language: "en", locale: { language: "de", time_zone: "server" }, config: { time_zone: "Asia/Tokyo" },
  });
  expect(notice).toEqual({
    tone: "warning",
    key: "v4_notice_saved_map",
    fallback: "Showing the saved map from {date} without the robot's position.",
    placeholders: { date: { date: SNAPSHOT_TIME } },
  });
  await expect(panel.getByText(savedMapSentence(await snapshotTime(page, "de", "Asia/Tokyo"))).first()).toBeVisible();
});

test("the saved-map notice and the history list show one snapshot's time alike", async ({ page }) => {
  const { panel } = await showSavedMap(page, {
    language: "en", locale: { language: "de", time_zone: "server" }, config: { time_zone: "Asia/Tokyo" },
  });
  const expected = await snapshotTime(page, "de", "Asia/Tokyo");
  await expect(panel.getByText(savedMapSentence(expected)).first()).toBeVisible();
  await showSnapshotInHistory(page);
  await expect(panel.locator('.snapshot[aria-current="true"] > span')).toHaveText(expected);
  await expect(panel.locator('.timeline input[type="range"]')).toHaveAttribute("aria-valuetext", expected);
});

test("a language or time zone change reformats the saved-map date where it shows", async ({ page }) => {
  const { panel } = await showSavedMap(page, {
    language: "en", locale: { language: "de", time_zone: "server" }, config: { time_zone: "Asia/Tokyo" },
  });
  const before = await snapshotTime(page, "de", "Asia/Tokyo");
  await expect(panel.getByText(savedMapSentence(before)).first()).toBeVisible();

  await patchHass(page, { locale: { language: "fr", time_zone: "server" }, config: { time_zone: "America/New_York" } });
  const after = await snapshotTime(page, "fr", "America/New_York");
  expect(after).not.toBe(before);
  await expect(panel.getByText(savedMapSentence(after)).first()).toBeVisible();
  // The polite region keeps the sentence it already spoke; nothing else does.
  await expect(panel.getByText(savedMapSentence(before)).and(panel.locator(":not([aria-live])"))).toHaveCount(0);
  await showSnapshotInHistory(page);
  await expect(panel.locator('.snapshot[aria-current="true"] > span')).toHaveText(after);
});

// A rejected zone drops only the zone; a rejected language drops to the
// browser's own format.
for (const [name, language, expectedLanguage] of [
  ["a server time zone the browser can't use keeps Home Assistant's language", "de", "de"],
  ["a language the browser can't use falls back to the browser's date format", "not a language", undefined],
]) {
  test(name, async ({ page }) => {
    const { panel, notice } = await showSavedMap(page, {
      locale: { language, time_zone: "server" }, config: { time_zone: "Not/A_Zone" },
    });
    const expected = await snapshotTime(page, expectedLanguage);
    expect(notice?.placeholders).toEqual({ date: { date: SNAPSHOT_TIME } });
    await expect(panel.getByText(savedMapSentence(expected)).first()).toBeAttached();
    await expect(panel.getByText("Invalid Date")).toHaveCount(0);
  });
}
