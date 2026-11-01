import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

test("@safety the packaged scene parser runs in a real Worker", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.sceneWorkerMessages = [];
    window.sceneWorkerErrors = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) => {
          window.sceneWorkerMessages.push({ ok: event.data.ok, total: event.data.parsed?.total });
        });
        this.addEventListener("error", (event) => window.sceneWorkerErrors.push(event.message));
      }
    };
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    scenePoint: { x: 2, y: 2, color: [40, 120, 200] },
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.sceneWorkerMessages)).toContainEqual({ ok: true, total: 1 });
  expect(await page.evaluate(() => window.sceneWorkerErrors)).toEqual([]);
});
