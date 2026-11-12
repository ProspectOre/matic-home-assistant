import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture, openPlanPicker } from "./map_studio_v4_panel_fixture.mjs";

// A shared schedule whose counting Home Assistant can't confirm reports one
// room reason, cadence_progress_unverified, and recovers only through a reset
// of both modes (completion_ledger.reset_progress).
const unverified = ["cadence_progress_unverified"];
const catalog = {
  rooms: [{ room_id: "room-a", name: "Kitchen", shared_cadence_reasons: unverified, shared_cadence: {
    scope: "shared", mop_every_n: 3, coverage_every_n: 2, periodic_coverage_setting: "heavy_duty", do_mop_next: false, do_coverage_next: false,
  }, shared_cadence_progress: null }],
  selected_plan: "daily",
  plans: [{
    id: "daily", name: "Daily clean", enabled: true, run_behavior: "intelligent",
    rooms: [{
      room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard",
      cadence: { scope: "shared", mop_every_n: 3, coverage_every_n: 2, periodic_coverage_setting: "heavy_duty", do_mop_next: false, do_coverage_next: false },
      cadence_progress: null,
      cadence_reasons: unverified,
    }],
    room_order: ["room-a"], return_to_base: true, finish_current_room: false, finish_current_room_threshold: 50,
    next_run_preview: { rooms: [], mission_boundaries: [], blocker: "cadence_progress_unverified" },
  }],
};

test("a shared schedule's unverified progress loads and resets both modes", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const fixture = await installPanelFixture(page, { initialPlanCatalog: catalog, moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await openPlanPicker(panel);
  await panel.getByRole("button", { name: /^Daily clean/ }).click();
  const reason = "Can't run this plan until you reset Kitchen's schedule progress, which Home Assistant can't confirm.";
  await expect(panel.getByRole("button", { name: "Run plan Daily clean" })).toBeDisabled();
  await expect(panel.getByRole("paragraph").filter({ hasText: reason })).toBeVisible();
  await panel.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
  await panel.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
  const schedule = panel.getByRole("group", { name: "Smart cleaning for Kitchen" });
  await expect(schedule.getByText(reason, { exact: true })).toBeVisible();
  const reset = schedule.getByRole("button", { name: "Reset schedule progress for Kitchen" });
  await expect(reset).toHaveText("Reset schedule progress");
  await reset.click();
  await panel.getByRole("dialog", { name: "Reset schedule progress?" }).getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.map(({ service, data }) => [service, data])))
    .toEqual([["reset_room_cadence", { plan: "daily", room_id: "room-a", modes: ["mop", "coverage"] }]]);
  await expect(panel.getByText("Schedule progress reset", { exact: true }).first()).toBeVisible();
});

test("the Rooms line names the reset, and only a saved room offers it", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { cadenceProblem, scheduleModel } from "./frontend/map-studio-v4/plan-cadence"; export { translate } from "./frontend/map-studio-v4/localize";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/shared-progress-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async (reasons) => {
    const m = await import("/shared-progress-test.js");
    const t = (key, fallback, placeholders) => m.translate(undefined, key, fallback, placeholders);
    const cadence = { scope: "shared", mopEveryN: 3, coverageEveryN: null, periodicCoverageSetting: null, doMopNext: false, doCoverageNext: false };
    const room = { roomId: "a", cleaningMode: "vacuum", coverageSetting: "standard", cadence, cadenceReasons: reasons };
    const model = (saved) => m.scheduleModel(t, "en", { room, saved, catalogRoom: undefined, name: "Kitchen", offLevel: null });
    return { line: m.cadenceProblem(t, reasons), saved: model(room).resettable, unsaved: model(undefined).resettable.both };
  }, ["cadence_progress_unverified"]);

  expect(result).toEqual({
    line: "Can't run this schedule until you reset its progress, which Home Assistant can't confirm.",
    saved: { mop: false, coverage: false, both: true },
    unsaved: false,
  });
});
