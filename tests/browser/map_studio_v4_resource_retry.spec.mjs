import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

async function openWorkflow(page, workflow) {
  await page.evaluate((selected) => {
    const panel = window.__resourcePanel;
    const shell = panel.shadowRoot.querySelector("matic-map-shell-v4");
    shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "open-workflow", workflow: selected }, bubbles: true, composed: true,
    }));
  }, workflow);
}

async function mountPanelWithFailedRequest(page, resource) {
  await page.evaluate((resource) => {
    const panel = window.__panelFixture.createPanel();
    const original = panel.hass.fetchWithAuth.bind(panel.hass);
    const state = { failed: false, calls: 0, armed: false };
    const suffix = resource === "areas" ? "/areas/synthetic" : "/plans/synthetic";
    panel.hass = {
      ...panel.hass,
      fetchWithAuth: async (path, ...args) => {
        if (path.endsWith(suffix)) {
          if (state.armed) state.calls += 1;
          if (state.armed && !state.failed) {
            state.failed = true;
            return new Response("unavailable", { status: 503 });
          }
        }
        return original(path, ...args);
      },
    };
    window.__resourceRetry = state;
    window.__resourcePanel = panel;
    document.body.append(panel);
  }, resource);
  // Map pins read both catalogs once the map is in, so arm the failure after that read.
  await expect.poll(() => page.evaluate((name) => window.__resourcePanel.getWorkspaceSnapshot().resources[name].status, resource)).toBe("ready");
}

test("area review reports a failed reload and Try again recovers", async ({ page }) => {
  await installPanelFixture(page, { moduleSource: "packaged" });
  await mountPanelWithFailedRequest(page, "areas");
  await expect.poll(() => page.evaluate(() => window.__resourcePanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  await page.evaluate(() => { window.__resourceRetry.armed = true; });
  await openWorkflow(page, "areaReview");

  const alert = page.getByRole("alert").filter({ hasText: "Home Assistant couldn't load your saved areas." });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText("Home Assistant couldn't load your saved areas.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => window.__resourcePanel.getWorkspaceSnapshot().resources.areas.status)).toBe("ready");
  await expect(alert).toHaveCount(0);
  expect(await page.evaluate(() => window.__resourceRetry.calls)).toBe(2);
});

test("plan resource problem box contains only its unavailable sentence", async ({ page }) => {
  await installPanelFixture(page, { moduleSource: "packaged" });
  await mountPanelWithFailedRequest(page, "plans");
  await expect.poll(() => page.evaluate(() => window.__resourcePanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  await page.evaluate(() => { window.__resourceRetry.armed = true; });
  await openWorkflow(page, "plans");

  const alert = page.getByRole("alert").filter({ hasText: "Home Assistant couldn't load rooms and plans." });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText("Home Assistant couldn't load rooms and plans.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => window.__resourcePanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
  expect(await page.evaluate(() => window.__resourceRetry.calls)).toBe(2);
});
