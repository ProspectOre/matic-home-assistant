import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export { parsePlansCatalog } from "./frontend/map-studio-v4/backend-contracts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Backend contract checks run once in Chromium");
});

async function load(page) {
  await page.route("**/backend-contracts.js", route => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
}

function plansPayload() {
  return {
    selected_plan: "plan-a",
    rooms: [],
    plans: [{
      id: "plan-a",
      name: "Plan A",
      enabled: true,
      run_behavior: "intelligent",
      rooms: [{
        room_id: "room-a",
        cleaning_mode: "vacuum",
        coverage_setting: "standard",
        cadence: {
          scope: "plan",
          mop_every_n: null,
          coverage_every_n: null,
          periodic_coverage_setting: null,
          do_mop_next: true,
          do_coverage_next: false,
        },
        cadence_progress: {
          mop_progress: 2,
          coverage_progress: 3,
          mop_due: false,
          coverage_due: true,
        },
      }],
      room_order: ["room-a"],
      return_to_base: true,
      finish_current_room: false,
      finish_current_room_threshold: 50,
    }],
  };
}

test("cadence flags preserve supplied booleans and default omitted flags to false", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async payload => {
    const { parsePlansCatalog } = await import("/backend-contracts.js");
    const parsed = parsePlansCatalog(payload).plans[0].rooms[0];
    const omitted = structuredClone(payload);
    delete omitted.plans[0].rooms[0].cadence.do_mop_next;
    delete omitted.plans[0].rooms[0].cadence.do_coverage_next;
    delete omitted.plans[0].rooms[0].cadence_progress.mop_due;
    delete omitted.plans[0].rooms[0].cadence_progress.coverage_due;
    const defaults = parsePlansCatalog(omitted).plans[0].rooms[0];
    return {
      supplied: [parsed.cadence.doMopNext, parsed.cadence.doCoverageNext,
        parsed.cadenceProgress.mopDue, parsed.cadenceProgress.coverageDue],
      omitted: [defaults.cadence.doMopNext, defaults.cadence.doCoverageNext,
        defaults.cadenceProgress.mopDue, defaults.cadenceProgress.coverageDue],
    };
  }, plansPayload());

  expect(result).toEqual({ supplied: [true, false, false, true], omitted: [false, false, false, false] });
});

test("provided cadence flags reject malformed values instead of becoming false", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async payload => {
    const { parsePlansCatalog } = await import("/backend-contracts.js");
    const cases = [
      ["cadence", "do_mop_next", "invalid-do-mop-next"],
      ["cadence", "do_coverage_next", "invalid-do-coverage-next"],
      ["cadence_progress", "mop_due", "invalid-mop-due"],
      ["cadence_progress", "coverage_due", "invalid-coverage-due"],
    ];
    const malformedValues = ["false", 1, {}, null];
    return cases.flatMap(([group, key, expectedCode]) => malformedValues.map(value => {
      const invalid = structuredClone(payload);
      invalid.plans[0].rooms[0][group][key] = value;
      try {
        parsePlansCatalog(invalid);
        return { key, code: null, expectedCode };
      } catch (error) {
        return { key, code: error.code ?? null, expectedCode };
      }
    }));
  }, plansPayload());

  expect(result).toHaveLength(16);
  expect(result.every(({ code, expectedCode }) => code === expectedCode)).toBe(true);
});
