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

// A fake `localize` that reorders each counted template the way a translation
// may, and records the placeholders the panel handed it. Keys it does not
// know come back unchanged, which is Home Assistant's own miss behaviour.
async function mountPanel(page, fixtureOptions = {}) {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: PLAN_CATALOG, ...fixtureOptions });
  await page.evaluate((prefix) => {
    const templates = {
      v4_action_clean_rooms_count: (p) => `Räume reinigen: ${p.count}`,
      v4_action_clean_rooms_count_one: () => "Einen Raum reinigen",
      v4_brush_button: (p) => `Pinselbreite ${p.brush}, Einstellungen`,
      v4_brush: (p) => `Pinsel ${p.brush}`,
    };
    window.__localizeCalls = [];
    const panel = window.__panelFixture.createPanel();
    panel.hass = {
      ...panel.hass,
      localize: (key, placeholders) => {
        window.__localizeCalls.push({ key: key.slice(prefix.length), placeholders });
        const template = templates[key.slice(prefix.length)];
        return template ? template(placeholders ?? {}) : key;
      },
    };
    window.__translationPanel = panel;
    document.body.append(panel);
  }, PREFIX);
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__translationPanel.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.resources.plans.status === "ready";
  })).toBe(true);
  return panel;
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

  await expect(panel.getByRole("button", { name: "Räume reinigen: 2" }).first()).toBeAttached();
  const counted = await localizeCalls(page, "v4_action_clean_rooms_count");
  expect(counted.length).toBeGreaterThan(0);
  expect(counted.every((call) => call.placeholders?.count === 2)).toBe(true);

  await sendIntent(page, { type: "toggle-room", roomId: "room-b" });
  await expect(panel.getByRole("button", { name: "Einen Raum reinigen" }).first()).toBeAttached();
  expect((await localizeCalls(page, "v4_action_clean_rooms_count_one")).length).toBeGreaterThan(0);
});

test("the brush label and its accessible name take the width from placeholders", async ({ page }) => {
  const panel = await mountPanel(page);
  await sendIntent(page, { type: "open-workflow", workflow: "draw" });
  await sendIntent(page, { type: "set-draw-tool", tool: "paint" });

  const brush = panel.locator(".draw-brush").first();
  await expect(brush).toHaveAttribute("aria-label", /^Pinselbreite \d+\.\d{2} m, Einstellungen$/);
  await expect(brush).toContainText(/^Pinsel \d+\.\d{2} m$/);
  for (const key of ["v4_brush_button", "v4_brush"]) {
    const calls = await localizeCalls(page, key);
    expect(calls.length, key).toBeGreaterThan(0);
    expect(calls.every((call) => /^\d+\.\d{2} m$/.test(call.placeholders?.brush)), key).toBe(true);
  }
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
  await expect.poll(() => loaderCalls(page)).toHaveLength(2);
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
  await expect(panel.getByRole("button", { name: "Stop cleaning" }).first()).toBeAttached();

  for (const mode of ["reject", "never"]) {
    await installLoader(page, mode);
    await patchHass(page, { connection: "__connection__", language: `${mode}-lang`, loadBackendTranslation: "__loader__" });
    await expect.poll(() => loaderCalls(page)).toHaveLength(1);
    await page.waitForTimeout(100);
    await expect(panel.locator("h2").first()).toBeVisible();
    await expect(panel.getByRole("button", { name: "Stop cleaning" }).first()).toBeAttached();
    // No retry for the same connection and language.
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

  const brush = panel.locator(".draw-brush").first();
  await expect(brush).toHaveAttribute("aria-label", /^Brush width, \d+\.\d{2} m\. Opens brush settings\.$/);
  await expect(brush).toContainText(/^Brush \d+\.\d{2} m$/);
});

test("room lists are joined for the panel language", async ({ page }) => {
  // The gallery's Rooms scenario carries a ready room preview, so the action
  // summary lists the selected rooms.
  const tag = "matic-map-studio-gallery-v0-4-0";
  await page.goto("/");
  const names = await page.evaluate(async (galleryTag) => {
    await import("/map_studio_v4-review/review.js");
    const gallery = document.createElement(galleryTag);
    gallery.controls = false;
    gallery.scenario = "rooms";
    document.body.append(gallery);
    await gallery.updateComplete;
    const shell = gallery.shadowRoot.querySelector(".stage").firstElementChild;
    const rooms = gallery.getWorkspaceSnapshot().resources.plans.value.rooms.slice(0, 3);
    for (const { roomId } of rooms) {
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "toggle-room", roomId }, bubbles: true, composed: true,
      }));
    }
    return rooms.map((room) => room.name);
  }, tag);
  expect(names).toHaveLength(3);
  for (const language of ["de", "en"]) {
    const list = await page.evaluate(({ galleryTag, locale, rooms }) => {
      const gallery = document.querySelector(galleryTag);
      gallery.replaceWorkspaceState({ ...gallery.getWorkspaceSnapshot(), locale });
      return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(rooms);
    }, { galleryTag: tag, locale: language, rooms: names });
    await expect(page.locator(tag).locator(".action-summary"), language).toHaveText(`${list} · returns to the dock`);
  }
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

test("the saved-map date follows Home Assistant's language and server time zone", async ({ page }) => {
  const { notice } = await showSavedMap(page, {
    language: "en", locale: { language: "de", time_zone: "server" }, config: { time_zone: "Asia/Tokyo" },
  });
  const expected = await page.evaluate(() => new Intl.DateTimeFormat("de", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo",
  }).format(new Date("2026-09-25T12:00:00Z")));
  expect(notice).toEqual({
    tone: "warning",
    key: "v4_notice_saved_map",
    fallback: "Showing the saved map from {date} without the robot's position.",
    placeholders: { date: expected },
  });
});

test("a server time zone the browser can't use falls back to the browser's date format", async ({ page }) => {
  const { panel, notice } = await showSavedMap(page, {
    locale: { language: "en", time_zone: "server" }, config: { time_zone: "Not/A_Zone" },
  });
  const expected = await page.evaluate(() => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date("2026-09-25T12:00:00Z")));
  expect(notice?.placeholders).toEqual({ date: expected });
  await expect(panel.getByText(expected, { exact: false }).first()).toBeAttached();
  await expect(panel.getByText("Invalid Date")).toHaveCount(0);
});
