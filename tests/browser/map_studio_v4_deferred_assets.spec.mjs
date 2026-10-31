import { expect, test } from "@playwright/test";
import { STARTUP_BUDGET_BYTES, startupGraph } from "../../scripts/startup_graph.mjs";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

test("Map Studio loads exactly its startup graph within budget and no legacy editor assets", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(async () => import("/matic_icons.js"));
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag)?.getWorkspaceSnapshot().map.available === true,
  fixture.panelTag)).toBe(true);

  const scriptPaths = await page.evaluate(() => performance.getEntriesByType("resource")
    .map(({ name }) => new URL(name).pathname)
    .filter((path) => path.endsWith(".js")));
  expect(scriptPaths.some((path) => /room-plan-editor|matic_map_studio\.js/u.test(path))).toBe(false);
  expect(await page.evaluate(() => performance.getEntriesByType("resource")
    .filter(({ name }) => name.includes("robot-atlas.")))).toEqual([]);
  const loaded = scriptPaths
    .filter((path) => path === "/matic_icons.js" || path.startsWith("/map_studio_v4/"))
    .map((path) => path.slice(1))
    .sort();
  const graph = startupGraph();
  expect(loaded).toEqual(Object.keys(graph).sort());
  const total = Object.values(graph).reduce((sum, size) => sum + size, 0);
  expect(total, JSON.stringify(graph)).toBeLessThanOrEqual(STARTUP_BUDGET_BYTES);
});

test("room preview code is requested only when Rooms opens", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  const requests = [];
  page.on("request", (request) => {
    if (/\/chunks\/room-preview-controller-[^/]+\.js$/u.test(request.url())) requests.push(request.url());
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag).getWorkspaceSnapshot().map.available, fixture.panelTag)).toBe(true);
  expect(requests).toEqual([]);
  await page.locator(fixture.panelTag).locator("matic-map-shell-v4").evaluate((shell) => shell.dispatchEvent(
    new CustomEvent("matic-workspace-intent", { detail: { type: "open-workflow", workflow: "rooms" }, bubbles: true, composed: true }),
  ));
  await expect.poll(() => requests.length).toBe(1);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(0);
});
