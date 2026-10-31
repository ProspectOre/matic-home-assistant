import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// The robot's own phase and whole-run time show in the status while it
// cleans, for runs started anywhere.

const vacuum = (attributes) => ({
  "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry", battery_level: 70, ...attributes } },
});

test("status names the cleaning phase and the robot's time left", async ({ page }) => {
  const fixture = await installPanelFixture(page, { initialRobotStates: vacuum({
    cleaning_phase: "edges", run_progress: 40, time_remaining: 1500,
  }) });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const status = panel.locator("matic-map-shell-v4").getByRole("complementary", { name: "Cleaning panel" });
  await expect(status.locator("strong").first()).toHaveText("Cleaning edges");
  await expect(status.locator(".room-estimate")).toHaveText("40% done · about 25 min left");

  await panel.evaluate((element) => {
    const states = structuredClone(element.hass.states);
    Object.assign(states["vacuum.synthetic"].attributes, { cleaning_phase: null, run_progress: null, time_remaining: null });
    element.hass = { ...element.hass, states };
  });
  await expect(status.locator("strong").first()).toHaveText("Cleaning");
  await expect(status.locator(".room-estimate")).toHaveCount(0);
});

test("run status projection keeps only well-formed robot values", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { HassAdapter } from "./frontend/map-studio-v4/hass-adapter";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/run-status-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { HassAdapter } = await import("/run-status-test.js");
    const read = (attributes) => new HassAdapter().project({
      connected: true,
      user: { is_admin: true },
      states: { "vacuum.robot": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry", ...attributes } } },
    }, undefined, "synthetic-entry").robotRun;
    return [
      read({ cleaning_phase: "toekicks", run_progress: 12.4, time_remaining: 90.6 }),
      read({ cleaning_phase: "mopping", run_progress: 140, time_remaining: -5 }),
      read({ run_progress: "50", time_remaining: Number.NaN }),
      read({}),
    ];
  });
  expect(result).toEqual([
    { phase: "toekicks", percent: 12, remainingSeconds: 91 },
    { phase: null, percent: 100, remainingSeconds: null },
    null,
    null,
  ]);
});
