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
async function mountPanel(page) {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: PLAN_CATALOG });
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
