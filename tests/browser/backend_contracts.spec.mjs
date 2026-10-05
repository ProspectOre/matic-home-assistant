import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export { parseAreasCatalog, parseCatalog, parseHistoryCatalog, parsePlansCatalog, parsePose } from "./frontend/map-studio-v4/backend-contracts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Backend contract checks run once in Chromium");
});

test("catalog, pose, history, and area parsers reject their own malformed root shapes", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async () => {
    const { parseAreasCatalog, parseCatalog, parseHistoryCatalog, parsePose } = await import("/backend-contracts.js");
    const cases = [
      ["catalog", parseCatalog, {}, "invalid-catalog-entries"],
      ["pose", parsePose, { position: null }, "invalid-pose-freshness"],
      ["history", parseHistoryCatalog, {}, "invalid-history-floors"],
      ["areas", parseAreasCatalog, { rooms: [], scene_url: "/api/matic_robot/scene" }, "invalid-area-list"],
    ];
    return cases.map(([name, parse, payload, expected]) => {
      try {
        parse(payload);
        return { name, code: null, expected };
      } catch (error) {
        return { name, code: error.code ?? null, expected };
      }
    });
  });

  expect(result).toEqual([
    { name: "catalog", code: "invalid-catalog-entries", expected: "invalid-catalog-entries" },
    { name: "pose", code: "invalid-pose-freshness", expected: "invalid-pose-freshness" },
    { name: "history", code: "invalid-history-floors", expected: "invalid-history-floors" },
    { name: "areas", code: "invalid-area-list", expected: "invalid-area-list" },
  ]);
});

test("catalog live workspace capability defaults off and validates explicit booleans", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async () => {
    const { parseCatalog } = await import("/backend-contracts.js");
    const entry = {
      entry_id: "entry-a",
      scene_url: "/api/matic_robot/scene",
      delta_url: null,
      pose_url: "/api/matic_robot/pose",
      history_url: "/api/matic_robot/history",
      areas_url: "/api/matic_robot/areas",
      plans_url: "/api/matic_robot/plans",
      map_revision: 0,
      map_floor_coherent: true,
      map_session_verified: true,
      map_session_key: null,
      map_block_reason: null,
      runner_locked: false,
      stop_settle_pending: false,
      active_plan: false,
      native_reconciliation_pending: false,
      native_session_active: null,
      map_complete: false,
      map_truncated: false,
      selected_floor_ordinal: null,
      map_floor_ordinal: null,
      history_count: 0,
      history_floor_count: 0,
      map_health: "unknown",
      stream_failures: 0,
      bootstrap_state: "not_started",
      bootstrap_photo_seen: false,
      bootstrap_structure_seen: false,
      bootstrap_failures: 0,
    };
    const parse = value => parseCatalog({ entries: [value] })[0].liveWorkspaceTransportEnabled;
    const malformed = { ...entry, live_workspace_transport_enabled: "yes" };
    let malformedCode = null;
    try { parse(malformed); } catch (error) { malformedCode = error.code ?? null; }
    return { omitted: parse(entry), enabled: parse({ ...entry, live_workspace_transport_enabled: true }),
      disabled: parse({ ...entry, live_workspace_transport_enabled: false }), malformedCode };
  });

  expect(result).toEqual({ omitted: false, enabled: true, disabled: false,
    malformedCode: "invalid-live-workspace-transport" });
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

test("saved-plan parsing preserves a room-limit blocker without inventing a preview token", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async payload => {
    const { parsePlansCatalog } = await import("/backend-contracts.js");
    payload.plans[0].next_run_preview = {
      rooms: [],
      mission_boundaries: [],
      blocker: "plan_room_limit",
    };
    const parsed = parsePlansCatalog(payload).plans[0].nextRunPreview;
    return { blocker: parsed.blocker, previewToken: parsed.previewToken ?? null };
  }, plansPayload());

  expect(result).toEqual({ blocker: "plan_room_limit", previewToken: null });
});

test("saved-plan parsing admits explicit unverified cadence recovery state", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async payload => {
    const { parsePlansCatalog } = await import("/backend-contracts.js");
    payload.plans[0].rooms[0].cadence_reasons = [
      "mop_progress_unverified",
      "coverage_progress_unverified",
    ];
    payload.plans[0].next_run_preview = {
      rooms: [],
      mission_boundaries: [],
      blocker: "cadence_progress_unverified",
    };
    const parsed = parsePlansCatalog(payload).plans[0];
    return {
      reasons: parsed.rooms[0].cadenceReasons,
      blocker: parsed.nextRunPreview.blocker,
    };
  }, plansPayload());

  expect(result).toEqual({
    reasons: ["mop_progress_unverified", "coverage_progress_unverified"],
    blocker: "cadence_progress_unverified",
  });
});

test("legacy saved plans remain editable up to the bounded recovery cap", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async payload => {
    const { parsePlansCatalog } = await import("/backend-contracts.js");
    const parse = count => {
      const candidate = structuredClone(payload);
      candidate.plans[0].rooms = Array.from({ length: count }, (_, index) => ({
        room_id: `room-${index}`,
        cleaning_mode: "vacuum",
        coverage_setting: "standard",
      }));
      candidate.plans[0].room_order = candidate.plans[0].rooms.map(room => room.room_id);
      try {
        return parsePlansCatalog(candidate).plans[0].rooms.length;
      } catch (error) {
        return error.code ?? "unknown";
      }
    };
    return { legacy: parse(102), cap: parse(256), over: parse(257) };
  }, plansPayload());

  expect(result).toEqual({ legacy: 102, cap: 256, over: "invalid-plan-rooms" });
});

test("saved-plan preview parsing enforces the shared room-sequence limit", async ({ page }) => {
  await load(page);
  const result = await page.evaluate(async payload => {
    const { parsePlansCatalog } = await import("/backend-contracts.js");
    const room = index => ({
      room_id: `room-${index}`,
      name: `Room ${index}`,
      cleaning_mode: "vacuum",
      coverage_setting: "standard",
      cadence_reasons: [],
    });
    const parse = count => {
      const candidate = structuredClone(payload);
      candidate.plans[0].next_run_preview = {
        rooms: Array.from({ length: count }, (_, index) => room(index)),
        mission_boundaries: [],
        blocker: null,
        preview_token: "a".repeat(64),
      };
      try {
        parsePlansCatalog(candidate);
        return null;
      } catch (error) {
        return error.code ?? "unknown";
      }
    };
    return { atLimit: parse(100), overLimit: parse(101) };
  }, plansPayload());

  expect(result).toEqual({ atLimit: null, overLimit: "invalid-plan-preview" });
});
