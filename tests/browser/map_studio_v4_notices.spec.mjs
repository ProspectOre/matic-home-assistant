import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const MAP_CHANGED = {
  tone: "info",
  key: "v4_notice_map_changed",
  fallback: "The map changed, so choose what to clean again.",
};

const PLAN_CATALOG = {
  rooms: [{ room_id: "room-a", name: "Kitchen" }],
  selected_plan: "daily",
  plans: [{
    id: "daily",
    name: "Daily clean",
    enabled: true,
    run_behavior: "intelligent",
    rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
    room_order: ["room-a"],
    return_to_base: true,
    finish_current_room: false,
    finish_current_room_threshold: 50,
    next_run_preview: {
      preview_token: "e".repeat(64),
      rooms: [{
        room_id: "room-a", name: "Kitchen", cleaning_mode: "vacuum",
        coverage_setting: "standard", cadence_reasons: [],
      }],
      mission_boundaries: [],
      blocker: null,
    },
  }],
};

async function mountPanel(page, { localize = null, ...options } = {}) {
  const fixture = await installPanelFixture(page, options);
  await page.evaluate((translations) => {
    const panel = window.__panelFixture.createPanel();
    if (translations) {
      panel.hass = { ...panel.hass, localize: (key) => translations[key] ?? key };
    }
    window.__noticePanel = panel;
    document.body.append(panel);
  }, localize);
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__noticePanel.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose;
  })).toBe(true);
  return panel;
}

const snapshot = (page) => page.evaluate(() => {
  const state = window.__noticePanel.getWorkspaceSnapshot();
  return { command: state.command, notice: state.notice, workflow: state.workflow };
});

const sendIntent = (page, detail) => page.evaluate((intent) => {
  window.__noticePanel.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent(
    "matic-workspace-intent",
    { detail: intent, bubbles: true, composed: true },
  ));
}, detail);

const serviceCalls = (page, service) => page.evaluate((name) =>
  window.__panelFixture.serviceCalls.filter((call) => call.service === name).length, service);

test("notice text is translated at render time", async ({ page }) => {
  const panel = await mountPanel(page, {
    localize: { "component.matic_robot.common.v4_notice_map_changed": "Karte geändert" },
  });
  await sendIntent(page, { type: "set-notice", notice: MAP_CHANGED });

  expect((await snapshot(page)).notice).toEqual(MAP_CHANGED);
  await expect(panel.getByText("Karte geändert").first()).toBeAttached();
  await expect(panel.getByText(MAP_CHANGED.fallback)).toHaveCount(0);
});

test("a set-notice intent without a valid notice is ignored", async ({ page }) => {
  await mountPanel(page);
  expect((await snapshot(page)).notice).toBeNull();
  for (const notice of [
    { tone: "error", text: "x" },
    { tone: "error", key: "__proto__", fallback: "x" },
    { tone: "error", key: "v4_notice_map_changed", fallback: 42 },
  ]) {
    await sendIntent(page, { type: "set-notice", notice });
    expect((await snapshot(page)).notice, JSON.stringify(notice)).toBeNull();
  }
});

test("@safety a Stop the robot rejects reports that Home Assistant can't confirm it stopped", async ({ page }) => {
  const panel = await mountPanel(page, {
    initialRobotStates: {
      "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } },
    },
  });
  await page.evaluate(() => window.__panelFixture.failNextService("stop_intelligent_cleaning"));
  await panel.getByRole("button", { name: "Stop cleaning", exact: true }).first().click();

  await expect.poll(async () => (await snapshot(page)).command).toBe("failed");
  expect((await snapshot(page)).notice).toMatchObject({ tone: "error", key: "v4_notice_stop_unconfirmed" });
  expect(await serviceCalls(page, "stop_intelligent_cleaning")).toBe(1);
});

test("a coverage guard rejection maps to its notice key", async ({ page }) => {
  const panel = await mountPanel(page, { initialPlanCatalog: PLAN_CATALOG });
  await expect.poll(() => page.evaluate(() =>
    window.__noticePanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
  await sendIntent(page, { type: "open-workflow", workflow: "plan" });
  await expect.poll(async () => (await snapshot(page)).workflow).toBe("plan");
  await page.evaluate(() => window.__panelFixture.failNextService("run_selected_plan", {
    translation_domain: "matic_robot",
    translation_key: "coverage_native_session_active",
  }));
  await panel.getByRole("button", { name: "Run this plan", exact: true }).first().click();

  await expect.poll(async () => (await snapshot(page)).command).toBe("failed");
  expect((await snapshot(page)).notice).toMatchObject({ tone: "error", key: "v4_notice_coverage_robot_busy" });
  expect(await serviceCalls(page, "run_selected_plan")).toBe(1);
});

test("a failed area save reports the area notice key", async ({ page }) => {
  const panel = await mountPanel(page);
  await page.evaluate(() => {
    const panel = window.__noticePanel;
    const fetchWithAuth = panel.hass.fetchWithAuth;
    window.__areaSaves = 0;
    panel.hass = {
      ...panel.hass,
      fetchWithAuth: (path, init) => {
        if (init?.method === "POST" && path.includes("/areas/")) {
          window.__areaSaves += 1;
          return Promise.resolve(new Response("{}", { status: 500 }));
        }
        return fetchWithAuth(path, init);
      },
    };
  });
  await sendIntent(page, { type: "open-workflow", workflow: "draw" });
  await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
  await sendIntent(page, { type: "set-draw-tool", tool: "paint" });
  await page.evaluate(() => {
    const state = window.__noticePanel.getWorkspaceSnapshot();
    window.__noticePanel.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent(
      "matic-workspace-intent",
      {
        detail: {
          type: "set-draft-circles",
          circles: [{ x: 1, y: 1, radius: 0.4 }],
          coordinateEdit: {
            generation: state.generation,
            tool: "paint",
            baselineCircles: state.draw.circles,
            baselineOutline: state.draw.outline ?? null,
          },
        },
        bubbles: true,
        composed: true,
      },
    ));
  });
  await panel.getByRole("button", { name: "Name and save", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).workflow).toBe("areaReview");
  await sendIntent(page, { type: "patch-area-draft", patch: { name: "Hallway" } });
  await panel.getByRole("button", { name: "Save area", exact: true }).first().click();

  await expect.poll(async () => (await snapshot(page)).notice?.key ?? null).toBe("v4_notice_area_save_failed");
  expect((await snapshot(page)).notice?.tone).toBe("error");
  expect(await page.evaluate(() => window.__areaSaves)).toBe(1);
});
