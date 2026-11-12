import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// The robot's own phase and whole-run time show in the status while it
// cleans, for runs started anywhere. They come from the robot's sensors.

const UNITS = { run_progress: "%", time_remaining: "min" };

const sensors = (states) => Object.fromEntries(Object.entries(states).map(([key, state]) => [`sensor.synthetic_${key}`, {
  state: String(state),
  attributes: { matic_entry_id: "synthetic-entry", matic_metric: key, unit_of_measurement: UNITS[key] },
}]));

const vacuum = (metrics) => ({
  "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry", battery_level: 70 } },
  ...sensors(metrics),
});

test("status names the cleaning phase and the robot's time left", async ({ page }) => {
  const fixture = await installPanelFixture(page, { initialRobotStates: vacuum({
    cleaning_phase: "edges", run_progress: 40, time_remaining: 25,
  }) });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const status = panel.locator("matic-map-shell-v4").getByRole("complementary", { name: "Cleaning panel" });
  await expect(status.locator("strong").first()).toHaveText("Cleaning edges");
  await expect(status.locator(".room-estimate")).toHaveText("40% done · about 25 min left");

  await panel.evaluate((element) => {
    const states = structuredClone(element.hass.states);
    for (const key of ["cleaning_phase", "run_progress", "time_remaining"]) states[`sensor.synthetic_${key}`].state = "unknown";
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
    const sensor = (key, state, unit, id = key) => [`sensor.robot_${id}`, {
      state, attributes: { matic_entry_id: "synthetic-entry", matic_metric: key, unit_of_measurement: unit },
    }];
    const read = (...metrics) => new HassAdapter().project({
      connected: true,
      user: { is_admin: true },
      states: {
        "vacuum.robot": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } },
        ...Object.fromEntries(metrics),
      },
    }, undefined, "synthetic-entry").robotRun;
    return [
      read(sensor("cleaning_phase", "toekicks"), sensor("run_progress", "12.4", "%"), sensor("time_remaining", "1.51", "min")),
      read(sensor("cleaning_phase", "mopping"), sensor("run_progress", "140", "%"), sensor("time_remaining", "-5", "s")),
      read(sensor("run_progress", "unknown", "%"), sensor("time_remaining", "90", undefined)),
      // Two sensors with one key leave the fact unknown.
      read(sensor("time_remaining", "2", "h"), sensor("time_remaining", "3", "h", "time_left")),
      read(),
    ];
  });
  expect(result).toEqual([
    { phase: "toekicks", percent: 12, remainingSeconds: 91 },
    { phase: null, percent: 100, remainingSeconds: null },
    null,
    null,
    null,
  ]);
});
