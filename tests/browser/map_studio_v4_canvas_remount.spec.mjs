import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

test("reattaching one panel restores its same canvas renderer and gesture controller", async ({ page }) => {
  const fixture = await installPanelFixture(page, {
    moduleSource: "typescript",
    scenePoint: { x: 50, y: 40, color: [255, 40, 20] },
  });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    window.__canvasRemountPanel = panel;
    document.body.append(panel);
  });

  const panel = page.locator(fixture.panelTag);
  const map = panel.locator("matic-map-shell-v4").locator("matic-map-canvas-v4");
  const mapRoot = map.locator(".map-root");
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.renderedPoints ?? 0))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const element = window.__canvasRemountPanel.shadowRoot
      .querySelector("matic-map-shell-v4").shadowRoot.querySelector("matic-map-canvas-v4");
    window.__canvasRemountMap = element;
    window.__canvasRemountScene = element.canvasIdentity().scene;
  });

  for (let cycle = 0; cycle < 2; cycle += 1) {
    const before = await panel.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      return state.cameras[state.view] ?? null;
    });
    await mapRoot.press("ArrowRight");
    await expect.poll(() => panel.evaluate((element, previousCamera) => {
      const state = element.getWorkspaceSnapshot();
      const camera = state.cameras[state.view];
      return Boolean(camera && (!previousCamera
        || camera.targetX !== previousCamera.targetX
        || camera.targetZ !== previousCamera.targetZ
        || camera.yaw !== previousCamera.yaw));
    }, before)).toBe(true);

    await panel.evaluate((element) => element.remove());
    await page.evaluate(() => document.body.append(window.__canvasRemountPanel));
    await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.renderedPoints ?? 0))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => {
      const element = window.__canvasRemountPanel.shadowRoot
        .querySelector("matic-map-shell-v4").shadowRoot.querySelector("matic-map-canvas-v4");
      return {
        sameMap: element === window.__canvasRemountMap,
        sameSceneCanvas: element.canvasIdentity().scene === window.__canvasRemountScene,
        rendererAvailable: element.rendererDiagnostics() !== null,
      };
    })).toEqual({ sameMap: true, sameSceneCanvas: true, rendererAvailable: true });

    const restored = await panel.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      return state.cameras[state.view] ?? null;
    });
    await mapRoot.press("ArrowRight");
    await expect.poll(() => panel.evaluate((element, previousCamera) => {
      const state = element.getWorkspaceSnapshot();
      const camera = state.cameras[state.view];
      return Boolean(camera && previousCamera
        && (camera.targetX !== previousCamera.targetX
          || camera.targetZ !== previousCamera.targetZ
          || camera.yaw !== previousCamera.yaw));
    }, restored)).toBe(true);
  }
});

test("a reattached panel keeps growing the live trail it was showing", async ({ page }) => {
  const fixture = await installPanelFixture(page, {
    moduleSource: "typescript",
    initialRobotStates: { "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } } },
  });
  await page.evaluate(() => {
    window.__trailPanel = window.__panelFixture.createPanel();
    document.body.append(window.__trailPanel);
  });
  const panel = page.locator(fixture.panelTag);
  const snapshot = () => panel.evaluate((element) => element.getWorkspaceSnapshot());
  await expect.poll(async () => (await snapshot()).map.exactPose).toBe(true);
  await panel.evaluate((element) => element.shadowRoot.querySelector("matic-map-shell-v4")
    .dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "show-trail", trail: "live" }, bubbles: true, composed: true,
    })));
  await expect.poll(async () => (await snapshot()).trail?.id).toBe("live");
  const lastPoint = async () => (await snapshot()).trail?.segments.at(-1)?.at(-1) ?? null;
  await page.evaluate(() => window.__panelFixture.pushPose([1, 1]));
  await expect.poll(lastPoint).toEqual([1, 1]);

  await panel.evaluate((element) => element.remove());
  await page.evaluate(() => document.body.append(window.__trailPanel));
  await expect.poll(async () => (await snapshot()).map.exactPose).toBe(true);
  expect((await snapshot()).trail?.id).toBe("live");
  await page.evaluate(() => window.__panelFixture.pushPose([2, 1]));
  await expect.poll(lastPoint).toEqual([2, 1]);
});
