import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

test("Map Studio loads its registered startup graph without legacy editor assets", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(async () => import("/matic_icons.js"));
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag)?.getWorkspaceSnapshot().map.available === true,
  fixture.panelTag)).toBe(true);

  const scriptResources = await page.evaluate(() => performance.getEntriesByType("resource")
    .map(({ name }) => name)
    .filter((name) => name.endsWith(".js") || name.includes(".js?")));
  expect(scriptResources.some((url) => url.includes("/map_studio_v4/index.js"))).toBe(true);
  expect(scriptResources.some((url) => url.includes("matic_icons.js"))).toBe(true);
  expect(scriptResources.some((url) => /room-plan-editor|matic_map_studio\.js/u.test(url))).toBe(false);
  const resources = scriptResources.filter((name) => name.includes("matic_icons.js")
      || name.includes("/map_studio_v4/"));
  const sizes = await Promise.all(resources.map(async (url) => {
    const response = await page.request.get(url);
    expect(response.ok(), `could not read startup asset ${url}`).toBe(true);
    return gzipSync(await response.body(), { level: 9 }).byteLength;
  }));
  expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(90 * 1024);
});
