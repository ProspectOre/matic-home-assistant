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
