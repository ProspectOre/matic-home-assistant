import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const ROOM_CATALOG = {
  rooms: [{ room_id: "kitchen", name: "Kitchen", boundary: [[0, 0], [6, 0], [6, 5], [0, 5]] }],
  plans: [],
  selected_plan: null,
};

test("source renderer explains simplified photographic fallback and hides it in room tasks @safety", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  const fixture = await installPanelFixture(page, {
    moduleSource: "typescript",
    initialPlanCatalog: ROOM_CATALOG,
  });
  await page.evaluate((panelTag) => {
    document.body.style.margin = "0";
    const panel = window.__panelFixture.createPanel();
    panel.style.width = "100vw";
    panel.style.height = "100vh";
    window.__rendererNoticePanel = panel;
    document.body.append(panel);
  }, fixture.panelTag);

  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() =>
    window.__rendererNoticePanel.getWorkspaceSnapshot().resources.scene.status,
  )).toBe("ready");
  const map = panel.locator("matic-map-shell-v4").locator("matic-map-canvas-v4");
  const notice = map.locator(".detail-notice");
  const sceneCanvas = map.locator("canvas.scene-canvas");
  const capability = await sceneCanvas.evaluate((canvas) => {
    const context = canvas.getContext("webgl2");
    return { webgl2: context !== null, loseContext: Boolean(context?.getExtension("WEBGL_lose_context")) };
  });
  if (browserName === "chromium") {
    expect(capability, "Chromium must exercise actual WebGL loss and restoration").toEqual({ webgl2: true, loseContext: true });
  } else {
    test.skip(!capability.webgl2 || !capability.loseContext, `${browserName} does not expose WEBGL_lose_context`);
  }
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.mode)).toBe("webgl2");
  await expect(notice).toHaveCount(0);

  await page.evaluate(() => {
    const context = window.__rendererNoticePanel.shadowRoot
      .querySelector("matic-map-shell-v4").shadowRoot.querySelector("matic-map-canvas-v4")
      .shadowRoot.querySelector("canvas.scene-canvas").getContext("webgl2");
    window.__rendererNoticeExtension = context.getExtension("WEBGL_lose_context");
    window.__rendererNoticeExtension.loseContext();
  });
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.mode)).toBe("canvas2d");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("simplified map");

  // Entering a room task switches to top-down Room colors, where a fallback
  // detail warning would distract from the task controls.
  await panel.getByRole("button", { name: /Clean rooms/ }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__rendererNoticePanel.getWorkspaceSnapshot().resources.plans.status,
  )).toBe("ready");
  await panel.getByRole("checkbox", { name: "Kitchen", exact: true }).check();
  await expect.poll(() => page.evaluate(() => {
    const state = window.__rendererNoticePanel.getWorkspaceSnapshot();
    return { workflow: state.workflow, appearance: state.appearance };
  })).toEqual({ workflow: "rooms", appearance: "rooms" });
  await expect(notice).toHaveCount(0);

  // The Home camera and photo appearance return with the task, so the warning
  // is again relevant until WebGL recovers.
  await panel.getByRole("button", { name: "Back to all tasks", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = window.__rendererNoticePanel.getWorkspaceSnapshot();
    return { workflow: state.workflow, appearance: state.appearance };
  })).toEqual({ workflow: "none", appearance: "photo" });
  await expect(notice).toBeVisible();

  await page.evaluate(() => window.__rendererNoticeExtension.restoreContext());
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.mode)).toBe("webgl2");
  await expect(notice).toHaveCount(0);
});
