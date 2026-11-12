import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture, openPlanPicker } from "./map_studio_v4_panel_fixture.mjs";

// room-schedule.md: the pure schedule model (plan-cadence.ts), tested through
// an esbuild-bundled harness route, then the Schedule block in the gallery.

async function loadHarness(page) {
  const bundle = await build({
    stdin: {
      contents: 'export * from "./frontend/map-studio-v4/plan-cadence"; export { translate } from "./frontend/map-studio-v4/localize"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/room-schedule-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

async function loadGallery(page, { scenario = "ready", narrow = false } = {}) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    window.__galleryModule = await import("/map_studio_v4-review/review.js");
  });
  await page.evaluate(async ({ tag, selectedScenario, selectedNarrow }) => {
    await customElements.whenDefined(tag);
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = selectedScenario;
    gallery.narrow = selectedNarrow;
    document.body.style.margin = "0";
    document.body.append(gallery);
  }, { tag: GALLERY_TAG, selectedScenario: scenario, selectedNarrow: narrow });
  return page.locator(GALLERY_TAG);
}

const snapshot = (page) => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot(), GALLERY_TAG);

// Merges `patch` (a function source over the snapshot) into the gallery's state.
const patchState = (page, source) => page.evaluate(({ tag, source }) => {
  const element = document.querySelector(tag);
  element.replaceWorkspaceState(new Function("s", `return (${source})`)(element.getWorkspaceSnapshot()));
}, { tag: GALLERY_TAG, source });

// The deepest focused element's accessible name.
const focusedName = (page) => page.evaluate(() => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active?.getAttribute("aria-label") ?? active?.localName;
});

// Evaluates `body` in the page with m (the harness module), t (the fallback
// translator), p (a policy), g (progress), room (a draft room) and input (a
// ScheduleInput: cadence, saved room, progress, catalog room, extra fields).
const run = (page, body) => page.evaluate(async (body) => {
  const m = await import("/room-schedule-test.js");
  const t = (key, fallback, placeholders) => m.translate(undefined, key, fallback, placeholders);
  const p = (patch = {}) => ({ scope: "plan", mopEveryN: null, coverageEveryN: null, periodicCoverageSetting: null, doMopNext: false, doCoverageNext: false, ...patch });
  const g = (patch = {}) => ({ mopProgress: 0, coverageProgress: 0, mopDue: false, coverageDue: false, nextMopIn: null, nextCoverageIn: null, reasons: [], ...patch });
  const room = (cadence, cadenceProgress, extra = {}) => ({ roomId: "a", cleaningMode: "vacuum", coverageSetting: "standard", ...(cadence ? { cadence } : {}), ...(cadenceProgress ? { cadenceProgress } : {}), ...extra });
  const input = (cadence, saved, progress, catalogRoom, extra = {}) => ({ room: room(cadence, progress, extra.room), saved, catalogRoom, name: "Kitchen", offLevel: null, ...extra.input });
  return new Function("m", "t", "p", "g", "room", "input", body)(m, t, p, g, room, input);
}, body);

test.describe("room schedule model", () => {
  test.beforeEach(({ page }) => loadHarness(page));

  test("snaps typed input and steps to Off and back", async ({ page }) => {
    expect(await run(page, `return [["e",true,4],["",false,4],["0",false,4],["-1",false,4],["250",false,4],["2.5",false,4],["7",false,null],[" 3 ",false,null]].map(([r,b,c]) => m.snapInterval(r,b,c));`))
      .toEqual([4, null, 1, 1, 100, 3, 7, 3]);
    expect(await run(page, `return [[null,1],[1,-1],[null,-1],[100,1],[5,1],[5,-1]].map(([c,d]) => m.stepInterval(c,d));`))
      .toEqual([1, null, null, 100, 6, 4]);
  });

  test("new mopping starts at two while saved and explicitly joined every-clean settings survive", async ({ page }) => {
    const result = await run(page, `
      const legacy = p({ scope: "shared", mopEveryN: 1, coverageEveryN: 4, periodicCoverageSetting: "heavy_duty" });
      const catalog = { roomId: "a", name: "Kitchen", sharedCadence: legacy };
      const off = input(undefined, room(), undefined, catalog);
      const saved = input(legacy, room(legacy), g({ nextMopIn: 1 }), catalog);
      const joined = m.withScope(off, "shared");
      return {
        steps: [[null,1],[2,-1],[1,1],[1,-1]].map(([v,d]) => m.stepInterval(v,d,2)),
        typed: ["1", "0", "-5", ""].map(v => m.snapInterval(v,false,null,2)),
        enabled: m.withInterval(off,"mop",1),
        coverage: m.withInterval(off,"coverage",1),
        saved: m.scheduleModel(t,"en",saved).mop.every,
        joined, pending: m.scheduleModel(t,"en",input(joined,room(),undefined,catalog)).joinPending,
        upgraded: m.withInterval(saved,"mop",2),
      };`);
    expect(result.steps).toEqual([2, null, 2, null]);
    expect(result.typed).toEqual([2, 2, 2, null]);
    expect(result.enabled).toMatchObject({ scope: "plan", mopEveryN: 2, coverageEveryN: null });
    expect(result.coverage).toMatchObject({ scope: "plan", mopEveryN: null, coverageEveryN: 1 });
    expect(result.saved).toBe(1);
    expect(result.joined).toMatchObject({ scope: "shared", mopEveryN: 1, coverageEveryN: 4 });
    expect(result.pending).toBe(true);
    expect(result.upgraded).toMatchObject({ scope: "shared", mopEveryN: 2, coverageEveryN: 4 });
  });

  test("status lines follow the server's next clean", async ({ page }) => {
    const rows = await run(page, `
      const m1 = m.scheduleModel(t, "en", input(p({ mopEveryN: 3 }), room(p({ mopEveryN: 3 })), g({ nextMopIn: 2 })));
      const m2 = m.scheduleModel(t, "en", input(p({ mopEveryN: 4 }), room(p({ mopEveryN: 3 })), g({ nextMopIn: 2 })));
      const m3 = m.scheduleModel(t, "en", input(p({ mopEveryN: 1, coverageEveryN: 5, periodicCoverageSetting: "quick", doCoverageNext: true }), undefined, g({ nextMopIn: 1, nextCoverageIn: 1 })));
      const m4 = m.scheduleModel(t, "en", input(p({ mopEveryN: 3 }), room(p({ mopEveryN: 3 })), g({ nextMopIn: 1 })));
      const m5 = m.scheduleModel(t, "en", input(p({ scope: "shared", mopEveryN: 3 }), room(p({ mopEveryN: 3 })), g({ nextMopIn: 2 })));
      const m6 = m.scheduleModel(t, "en", input(p({ mopEveryN: 3 }), undefined, undefined));
      return [m1.mop.status, m1.mop.label, m2.mop.status, m3.mop.status, m3.coverage.status, m3.coverage.label, m3.next?.label,
        m4.mop.status, m5.mop.status, m6.mop.status, m6.coverage.status, m6.coverage.label, m3.mop.label];`);
    expect(rows).toEqual(["Due in 2 cleans", "Mop every 3 cleans", "Keeps the progress so far", "Due every clean", "Due next clean",
      "Quick vacuum every 5 cleans", "Quick vacuum on the next clean", "Due next clean", null, null, "Not scheduled", "Heavy duty vacuum", "Mop every clean"]);
  });

  test("joins a shared schedule with its exact values, read-only until Save", async ({ page }) => {
    const result = await run(page, `
      const shared = p({ scope: "shared", mopEveryN: 3, coverageEveryN: 2, periodicCoverageSetting: "heavy_duty" });
      const catalogRoom = { roomId: "a", name: "Kitchen", sharedCadence: shared, sharedCadenceProgress: g({ nextMopIn: 2, nextCoverageIn: 1 }) };
      const saved = room(p());
      const off = input(undefined, room(), undefined, catalogRoom);
      const offModel = m.scheduleModel(t, "en", off);
      const joined = m.withInterval(off, "mop", 5);
      const joining = input(joined, room(), undefined, catalogRoom);
      const joinModel = m.scheduleModel(t, "en", joining);
      const privateOff = input(p(), saved, undefined, catalogRoom);
      return {
        hint: offModel.sharedHint, scope: offModel.scope, joined,
        joinPending: joinModel.joinPending, statuses: [joinModel.mop.status, joinModel.coverage.status],
        explanation: joinModel.explanation, hintWhileJoining: joinModel.sharedHint,
        duringJoin: m.withInterval(joining, "mop", 7), level: m.withLevel(joining, "quick"), next: m.withNextClean(joining, true),
        leave: m.withScope(joining, "plan"), rejoin: m.withScope(off, "shared"),
        privateHint: m.scheduleModel(t, "en", privateOff).sharedHint,
        privateOn: m.withInterval(privateOff, "mop", 4),
      };`);
    const shared = { scope: "shared", mopEveryN: 3, coverageEveryN: 2, periodicCoverageSetting: "heavy_duty", doMopNext: false, doCoverageNext: false };
    expect(result).toEqual({
      hint: true, scope: "shared", joined: shared,
      joinPending: true, statuses: ["Due in 2 cleans", "Due next clean"],
      explanation: "Saving shares this room's progress with every plan that uses it, picking up any progress already counted.",
      hintWhileJoining: false,
      duringJoin: null, level: null, next: null,
      leave: { ...shared, scope: "plan" }, rejoin: shared,
      privateHint: false,
      privateOn: { ...shared, scope: "plan", mopEveryN: 4, coverageEveryN: null, periodicCoverageSetting: null },
    });
  });

  test("a room that uses the shared schedule edits it in place", async ({ page }) => {
    const result = await run(page, `
      const shared = p({ scope: "shared", mopEveryN: 3 });
      const catalogRoom = { roomId: "a", name: "Kitchen", sharedCadence: shared };
      const model = m.scheduleModel(t, "en", input(shared, room(shared), g({ nextMopIn: 2 }), catalogRoom));
      const left = m.scheduleModel(t, "en", input({ ...shared, scope: "plan" }, room(shared), g({ nextMopIn: 2 }), catalogRoom));
      return [model.sharedHint, model.joinPending, model.participating, model.explanation,
        m.withInterval(input(shared, room(shared), undefined, catalogRoom), "mop", 4)?.mopEveryN, left.explanation, left.mop.status];`);
    expect(result).toEqual([false, false, true, "Changes apply to every plan using Kitchen's smart cleaning settings.", 4,
      "Saving starts new progress for this plan only, and other plans keep the shared schedule.", null]);
  });

  test("a new rotation is Heavy duty unless a level was chosen while Off", async ({ page }) => {
    const result = await run(page, `
      const quickRoom = { room: { coverageSetting: "quick" } };
      const plain = input(undefined, undefined, undefined, undefined, quickRoom);
      const chosen = input(undefined, undefined, undefined, undefined, { ...quickRoom, input: { offLevel: "quick" } });
      return [m.withInterval(plain, "coverage", 2), m.withInterval(chosen, "coverage", 2).periodicCoverageSetting,
        m.withLevel(plain, "standard"), m.scheduleModel(t, "en", chosen).coverage.label,
        m.withLevel(input(p({ coverageEveryN: 2, periodicCoverageSetting: "heavy_duty", mopEveryN: 3 })), "quick"),
        m.withInterval(input(p({ coverageEveryN: 2, periodicCoverageSetting: "quick", doCoverageNext: true })), "coverage", null)];`);
    expect(result).toEqual([
      { scope: "shared", mopEveryN: null, coverageEveryN: 2, periodicCoverageSetting: "heavy_duty", doMopNext: false, doCoverageNext: false },
      "quick", null, "Quick vacuum",
      { scope: "plan", mopEveryN: 3, coverageEveryN: 2, periodicCoverageSetting: "quick", doMopNext: false, doCoverageNext: false },
      { scope: "plan", mopEveryN: null, coverageEveryN: null, periodicCoverageSetting: "quick", doMopNext: false, doCoverageNext: false },
    ]);
  });

  test("the next-clean switch names only work it can bring forward", async ({ page }) => {
    const result = await run(page, `
      const policy = p({ mopEveryN: 3, coverageEveryN: 5, periodicCoverageSetting: "heavy_duty" });
      const dueMop = input(policy, room(policy), g({ nextMopIn: 1, nextCoverageIn: 4 }));
      const neither = input(policy, room(policy), g({ nextMopIn: 2, nextCoverageIn: 4 }));
      // A new row counts from the server's count: the rotation is due at 4 of 5.
      const everyClean = input(p({ mopEveryN: 1, coverageEveryN: 5, periodicCoverageSetting: "quick" }), undefined, g({ coverageProgress: 4, nextMopIn: 1, nextCoverageIn: 1 }));
      const flagged = p({ ...policy, doMopNext: true });
      const on = input(flagged, room(flagged), g({ nextMopIn: 1, nextCoverageIn: 1 }));
      const mopOff = m.withInterval(on, "mop", null);
      return {
        dueMop: m.scheduleModel(t, "en", dueMop).next, dueMopOn: m.withNextClean(dueMop, true),
        neither: m.scheduleModel(t, "en", neither).next.label,
        everyClean: m.scheduleModel(t, "en", everyClean).next, everyCleanSwitch: m.withNextClean(everyClean, true),
        on: m.scheduleModel(t, "en", on).next, onStatus: m.scheduleModel(t, "en", on).mop.status, off: m.withNextClean(on, false),
        mopOff: [mopOff.mopEveryN, mopOff.doMopNext],
      };`);
    expect(result).toEqual({
      dueMop: { label: "Heavy duty vacuum on the next clean", on: false, mop: false, coverage: true, blocked: null },
      dueMopOn: expect.objectContaining({ doMopNext: false, doCoverageNext: true }),
      neither: "Mop and heavy duty vacuum on the next clean",
      everyClean: null, everyCleanSwitch: null,
      on: { label: "Mop on the next clean", on: true, mop: true, coverage: false, blocked: null },
      onStatus: "Due next clean",
      off: expect.objectContaining({ doMopNext: false, doCoverageNext: false }),
      mopOff: [null, false],
    });
  });

  // Codex P2 (#253): while on, the switch names the work it brought forward,
  // so a row edited afterwards never joins a checked label it wouldn't do.
  test("while on, the switch names only the work it brought forward", async ({ page }) => {
    const result = await run(page, `
      const saved = p({ mopEveryN: 3, coverageEveryN: 5, periodicCoverageSetting: "heavy_duty" });
      const progress = g({ nextMopIn: 2, nextCoverageIn: 1 });
      const forced = m.withNextClean(input(saved, room(saved), progress), true);
      const edited = input({ ...forced, coverageEveryN: 6 }, room(saved), progress);
      const model = m.scheduleModel(t, "en", edited);
      const off = m.withNextClean(edited, false);
      const again = m.withNextClean(input(off, room(saved), progress), true);
      return { forced: [forced.doMopNext, forced.doCoverageNext], next: model.next, coverageStatus: model.coverage.status,
        off: [off.doMopNext, off.doCoverageNext], again: [again.doMopNext, again.doCoverageNext],
        againLabel: m.scheduleModel(t, "en", input(again, room(saved), progress)).next.label };`);
    expect(result).toEqual({
      forced: [true, false],
      next: { label: "Mop on the next clean", on: true, mop: true, coverage: false, blocked: null },
      coverageStatus: "Keeps the progress so far",
      off: [false, false], again: [true, true],
      againLabel: "Mop and heavy duty vacuum on the next clean",
    });
  });

  // Codex P2 (#253): work whose row a mode conflict holds can't be brought forward.
  test("the switch is held while the work it names has a mode conflict", async ({ page }) => {
    const result = await run(page, `
      const legacy = p({ coverageEveryN: 3, periodicCoverageSetting: "heavy_duty" });
      const mopRoom = input(legacy, room(legacy), g({ nextCoverageIn: 2 }), undefined, { room: { cleaningMode: "mop" } });
      const fine = input(legacy, room(legacy), g({ nextCoverageIn: 2 }));
      return { next: m.scheduleModel(t, "en", mopRoom).next, on: m.withNextClean(mopRoom, true),
        fine: m.scheduleModel(t, "en", fine).next.blocked, fineOn: m.withNextClean(fine, true).doCoverageNext };`);
    expect(result).toEqual({
      next: { label: "Heavy duty vacuum on the next clean", on: false, mop: false, coverage: true, blocked: "coverage" },
      on: null, fine: null, fineOn: true,
    });
  });

  // Final review 1: the server counts a saved flag as due next clean, so
  // turning it off falls back to the progress, and the switch stays.
  test("turning off a saved next-clean flag keeps the switch and counts from progress", async ({ page }) => {
    const result = await run(page, `
      const flagged = p({ mopEveryN: 3, doMopNext: true });
      const fresh = input(flagged, room(flagged), g({ mopDue: true, nextMopIn: 1 }));
      const off = m.withNextClean(fresh, false);
      const offFresh = input(off, room(flagged), g({ mopDue: true, nextMopIn: 1 }));
      const offDue = input(off, room(flagged), g({ mopProgress: 2, mopDue: true, nextMopIn: 1 }));
      const a = m.scheduleModel(t, "en", offFresh);
      const b = m.scheduleModel(t, "en", offDue);
      return { off: [off.doMopNext, off.doCoverageNext], next: a.next, status: a.mop.status,
        dueNext: b.next, dueStatus: b.mop.status, again: m.withNextClean(offFresh, true).doMopNext };`);
    expect(result).toEqual({
      off: [false, false],
      next: { label: "Mop on the next clean", on: false, mop: true, coverage: false, blocked: null }, status: "Due in 3 cleans",
      dueNext: { label: "Mop on the next clean", on: false, mop: true, coverage: false, blocked: null }, dueStatus: "Due next clean",
      again: true,
    });
  });

  // Final review 2: the backend adopts the shared schedule on save and checks
  // it against this room's mode (cadence.py:45-46, 66-70).
  test("a shared schedule this room's mode can't use counts in this plan only", async ({ page }) => {
    const result = await run(page, `
      const shared = p({ scope: "shared", mopEveryN: 3, coverageEveryN: 2, periodicCoverageSetting: "heavy_duty" });
      const catalogRoom = { roomId: "a", name: "Kitchen", sharedCadence: shared };
      const both = { room: { cleaningMode: "vacuum_and_mop" } };
      const off = input(undefined, room(), undefined, catalogRoom, both);
      const model = m.scheduleModel(t, "en", off);
      const on = m.withInterval(off, "coverage", 4);
      const own = input(on, room(), undefined, catalogRoom, both);
      const fits = m.scheduleModel(t, "en", input(undefined, room(), undefined, catalogRoom));
      const coverageOnly = { roomId: "a", name: "Kitchen", sharedCadence: p({ scope: "shared", coverageEveryN: 2, periodicCoverageSetting: "quick" }) };
      return {
        hint: model.sharedHint, reason: model.sharedReason, on,
        ownModel: [m.scheduleModel(t, "en", own).joinPending, m.scheduleModel(t, "en", own).explanation],
        rejoin: m.withScope(own, "shared"), leave: m.withScope(own, "plan")?.scope,
        fits: [fits.sharedReason, fits.sharedHint],
        mopRoom: m.scheduleModel(t, "en", input(undefined, room(), undefined, coverageOnly, { room: { cleaningMode: "mop" } })).sharedReason,
        bothRoom: m.scheduleModel(t, "en", input(undefined, room(), undefined, coverageOnly, both)).sharedReason,
      };`);
    const reason = "Can't count across all plans until this room's cleaning mode works with its shared schedule.";
    expect(result).toEqual({
      hint: false, reason,
      on: { scope: "plan", mopEveryN: null, coverageEveryN: 4, periodicCoverageSetting: "heavy_duty", doMopNext: false, doCoverageNext: false },
      ownModel: [false, "Starts counting completed cleans in this plan only, from zero."],
      rejoin: null, leave: "plan",
      fits: [null, true],
      mopRoom: reason, bothRoom: null,
    });
  });

  // Codex P2 (#253): the catalog reports a broken shared schedule by its
  // reasons alone, which still counts as one that exists and can't be joined.
  test("a shared schedule reported only by its reasons is never joined", async ({ page }) => {
    const result = await run(page, `
      const catalogRoom = { roomId: "a", name: "Kitchen", sharedCadenceReasons: ["invalid_cadence_policy"] };
      const off = input(undefined, room(), undefined, catalogRoom);
      const model = m.scheduleModel(t, "en", off);
      const on = m.withInterval(off, "mop", 3);
      const own = input(on, room(), undefined, catalogRoom);
      const stray = m.scheduleModel(t, "en", input(p({ scope: "shared", mopEveryN: 3 }), room(), undefined, catalogRoom));
      const member = m.scheduleModel(t, "en", input(p({ scope: "shared", mopEveryN: 3 }), room(p({ scope: "shared", mopEveryN: 3 })), g({ nextMopIn: 2 }), catalogRoom));
      return { hint: model.sharedHint, reason: model.sharedReason, joinPending: model.joinPending, on,
        rejoin: m.withScope(own, "shared"), strayJoinPending: stray.joinPending,
        member: [member.participating, member.joinPending, member.sharedReason, member.mop.status] };`);
    expect(result).toEqual({
      hint: false, reason: "Can't count across all plans until you fix this room's shared schedule in a plan that uses it.", joinPending: false,
      on: { scope: "plan", mopEveryN: 3, coverageEveryN: null, periodicCoverageSetting: null, doMopNext: false, doCoverageNext: false },
      rejoin: null, strayJoinPending: false,
      member: [true, false, null, "Due in 2 cleans"],
    });
  });

  // Codex P2 (#253): a scope change starts fresh progress (plans.py
  // reset_private_progress), so a schedule due on the shared count can still
  // be brought forward in the same save.
  test("leaving a shared schedule makes its due work available to bring forward", async ({ page }) => {
    const result = await run(page, `
      const shared = p({ scope: "shared", mopEveryN: 3, coverageEveryN: 2, periodicCoverageSetting: "heavy_duty" });
      const catalogRoom = { roomId: "a", name: "Kitchen", sharedCadence: shared };
      const due = g({ mopDue: true, coverageDue: true, nextMopIn: 1, nextCoverageIn: 1 });
      const staying = input(shared, room(shared), due, catalogRoom);
      const leaving = input({ ...shared, scope: "plan" }, room(shared), due, catalogRoom);
      const left = m.scheduleModel(t, "en", leaving);
      const on = m.withNextClean(leaving, true);
      const sharing = input(p({ scope: "shared", mopEveryN: 3 }), room(p({ mopEveryN: 3 })), g({ mopDue: true, nextMopIn: 1 }));
      return { staying: m.scheduleModel(t, "en", staying).next, left: left.next, statuses: [left.mop.status, left.coverage.status],
        on: [on.scope, on.doMopNext, on.doCoverageNext], sharing: m.scheduleModel(t, "en", sharing).next?.label };`);
    expect(result).toEqual({
      staying: null,
      left: { label: "Mop and heavy duty vacuum on the next clean", on: false, mop: true, coverage: true, blocked: null },
      statuses: [null, null],
      on: ["plan", true, true],
      sharing: "Mop on the next clean",
    });
  });

  // Codex P2 (#253): every clean is always due and hides the switch, so a
  // row moved there drops the flag the switch set, as turning it Off does.
  test("mopping stays occasional while every-clean coverage clears its next-clean flag", async ({ page }) => {
    const result = await run(page, `
      const on = p({ mopEveryN: 3, coverageEveryN: 4, periodicCoverageSetting: "quick", doMopNext: true, doCoverageNext: true });
      const i = input(on, room(on), g({ nextMopIn: 1, nextCoverageIn: 1 }));
      const mopOne = m.withInterval(i, "mop", 1);
      const coverageOne = m.withInterval(i, "coverage", 1);
      const mopTwo = m.withInterval(i, "mop", 2);
      return { mopOne: [mopOne.mopEveryN, mopOne.doMopNext, mopOne.doCoverageNext],
        coverageOne: [coverageOne.coverageEveryN, coverageOne.doCoverageNext, coverageOne.doMopNext, coverageOne.periodicCoverageSetting],
        mopTwo: [mopTwo.mopEveryN, mopTwo.doMopNext],
        // Saved at every clean, raised again later: the switch is back, and off.
        back: (() => { const saved = { ...mopOne, doCoverageNext: false }; const due = g({ nextMopIn: 1, nextCoverageIn: 1 });
          return m.scheduleModel(t, "en", input(m.withInterval(input(saved, room(saved), due), "mop", 3), room(saved), due)).next; })() };`);
    expect(result).toEqual({
      mopOne: [2, true, true],
      coverageOne: [1, false, true, "quick"],
      mopTwo: [2, true],
      back: { label: "Mop on the next clean", on: true, mop: true, coverage: false, blocked: null },
    });
  });

  // Codex P2 (#253): the server's next_*_in belongs to the saved row. Once the
  // draft turns a row on, changes how often, moves its flag or its scope, the
  // count the save keeps decides (cadence.py:94-131): due at interval - 1.
  test("a draft that changes what the server counted derives due from the kept count", async ({ page }) => {
    const result = await run(page, `
      const paused = room(p({}), g({ mopProgress: 2, coverageProgress: 3 }));
      const resumed = input(p({ mopEveryN: 3 }), paused, g({ mopProgress: 2, coverageProgress: 3 }));
      const resumedModel = m.scheduleModel(t, "en", resumed);
      const partly = m.scheduleModel(t, "en", input(p({ mopEveryN: 4 }), paused, g({ mopProgress: 2, coverageProgress: 3 })));
      const rotation = m.scheduleModel(t, "en", input(p({ coverageEveryN: 4, periodicCoverageSetting: "quick" }), paused, g({ mopProgress: 2, coverageProgress: 3 })));
      const counting = room(p({ mopEveryN: 5 }), g({ mopProgress: 3, nextMopIn: 2 }));
      const shorter = m.scheduleModel(t, "en", input(p({ mopEveryN: 2 }), counting, g({ mopProgress: 3, nextMopIn: 2 })));
      const exact = m.scheduleModel(t, "en", input(p({ mopEveryN: 4 }), counting, g({ mopProgress: 3, nextMopIn: 2 })));
      const longer = m.scheduleModel(t, "en", input(p({ mopEveryN: 8 }), counting, g({ mopProgress: 3, nextMopIn: 2 })));
      const unchanged = m.scheduleModel(t, "en", input(p({ mopEveryN: 5 }), counting, g({ mopProgress: 3, nextMopIn: 2 })));
      const sharing = m.scheduleModel(t, "en", input(p({ scope: "shared", mopEveryN: 3 }), paused, g({ mopProgress: 2, coverageProgress: 3 })));
      const flagged = m.scheduleModel(t, "en", input(p({ mopEveryN: 8, doMopNext: true }), counting, g({ mopProgress: 3, nextMopIn: 2 })));
      const every = m.scheduleModel(t, "en", input(p({ mopEveryN: 1 }), paused, g({ mopProgress: 2, coverageProgress: 3 })));
      return {
        resumed: [resumedModel.mop.status, resumedModel.next, m.withNextClean(resumed, true)],
        partly: [partly.mop.status, partly.next?.label],
        rotation: [rotation.coverage.status, rotation.next],
        shorter: [shorter.mop.status, shorter.next], exact: [exact.mop.status, exact.next],
        longer: [longer.mop.status, longer.next?.label], unchanged: [unchanged.mop.status, unchanged.next?.label],
        sharing: [sharing.mop.status, sharing.next?.label],
        flagged: [flagged.mop.status, flagged.next?.on],
        every: [every.mop.status, every.next],
      };`);
    expect(result).toEqual({
      resumed: ["Due next clean", null, null],
      partly: ["Due in 2 cleans", "Mop on the next clean"],
      rotation: ["Due next clean", null],
      shorter: ["Due next clean", null], exact: ["Due next clean", null],
      longer: ["Keeps the progress so far", "Mop on the next clean"], unchanged: ["Due in 2 cleans", "Mop on the next clean"],
      sharing: [null, "Mop on the next clean"],
      flagged: ["Due next clean", true],
      every: ["Due every clean", null],
    });
  });

  test("row and room reasons", async ({ page }) => {
    const result = await run(page, `
      const unverified = m.scheduleModel(t, "en", input(p({ mopEveryN: 3 }), undefined, undefined, undefined,
        { room: { cleaningMode: "vacuum", cadenceReasons: ["mop_progress_unverified", "coverage_progress_unverified", "identity_changed"] } }));
      const mopMode = m.scheduleModel(t, "en", input(p(), undefined, undefined, undefined, { room: { cleaningMode: "mop" } }));
      const legacy = m.scheduleModel(t, "en", input(p({ coverageEveryN: 3, periodicCoverageSetting: "heavy_duty" }), undefined, undefined, undefined, { room: { cleaningMode: "mop" } }));
      const both = m.scheduleModel(t, "en", input(p(), undefined, undefined, undefined, { room: { cleaningMode: "vacuum_and_mop" } }));
      const offMap = m.scheduleModel(t, "en", input(p(), undefined, undefined, undefined, { room: { cadenceReasons: ["room_not_on_current_map"] } }));
      const invalid = m.scheduleModel(t, "en", input(p(), undefined, undefined, undefined, { room: { cadenceReasons: ["invalid_cadence_policy"] } }));
      return {
        unverified: [unverified.mop.reason, unverified.mop.unverified, unverified.mop.blocked, unverified.coverage.reason, unverified.coverage.unverified, unverified.roomReason],
        mopMode: [mopMode.mop.reason, mopMode.mop.blocked, mopMode.coverage.reason, mopMode.coverage.blocked, mopMode.legacyCoverage],
        legacy: [legacy.coverage.reason, legacy.coverage.blocked, legacy.legacyCoverage],
        both: [both.mop.blocked, both.coverage.blocked],
        offMap: offMap.roomReason, invalid: invalid.roomReason,
        turnOff: m.withoutLegacyCoverage(p({ scope: "shared", coverageEveryN: 3, periodicCoverageSetting: "heavy_duty", doCoverageNext: true })),
      };`);
    expect(result).toEqual({
      unverified: ["Can't run this schedule until you reset its mopping progress, which Home Assistant can't confirm.", true, false,
        "Can't run this schedule until you reset its vacuum rotation progress, which Home Assistant can't confirm.", true,
        "Can't run this plan until you review Kitchen's schedule on this map."],
      mopMode: ["This mode already mops every clean. Choose Vacuum above for occasional mopping.", true,
        "Can't add a vacuum rotation until this room's cleaning mode includes vacuuming.", true, false],
      legacy: ["The vacuum rotation needs a cleaning mode that includes vacuuming, so change the mode or turn the rotation off.", true, true],
      both: [true, false],
      offMap: "Can't run this plan until Kitchen is on the current map or removed from the plan.",
      invalid: "Can't run this plan until you fix Kitchen's schedule.",
      turnOff: { scope: "plan", mopEveryN: null, coverageEveryN: null, periodicCoverageSetting: null, doMopNext: false, doCoverageNext: false },
    });
  });

  test("explanations in order", async ({ page }) => {
    const result = await run(page, `
      const e = (cadence, saved) => m.scheduleModel(t, "en", input(cadence, saved)).explanation;
      return [
        e(p({ scope: "shared", mopEveryN: 3 }), undefined),
        e(p({ mopEveryN: 3 }), room()),
        e(p({ mopEveryN: 3 }), room(p({ mopEveryN: 2 }))),
        e(p({ mopEveryN: 3 }), room(p({ mopEveryN: 3 }))),
        e(undefined, undefined),
        // Codex P2 (#253): a paused private schedule keeps its counters, so re-enabling resumes them.
        e(p({ mopEveryN: 3 }), room(p(), g({ mopProgress: 2 }))),
        e(p({ mopEveryN: 3 }), room(p(), g({ coverageProgress: 2 }))),
        e(p({ mopEveryN: 3, coverageEveryN: 2, periodicCoverageSetting: "quick" }), room(p(), g({ coverageProgress: 2 }))),
        e(p({ mopEveryN: 3 }), room(p(), g())),
      ];`);
    expect(result).toEqual([
      "Starts counting from zero, across plans that use these settings.",
      "Starts counting completed cleans in this plan only, from zero.",
      "Changing how often keeps your progress. Turning this off pauses counting.",
      null,
      null,
      "Changing how often keeps your progress. Turning this off pauses counting.",
      "Starts counting completed cleans in this plan only, from zero.",
      "Changing how often keeps your progress. Turning this off pauses counting.",
      "Starts counting completed cleans in this plan only, from zero.",
    ]);
  });

  test("Reset offers only saved progress and says why it can't run", async ({ page }) => {
    const result = await run(page, `
      const r = (saved) => { const { mop, coverage, both } = m.scheduleModel(t, "en", input(p({ mopEveryN: 3, coverageEveryN: 2 }), saved)).resettable; return both ? null : { mop, coverage }; };
      const state = m.createGalleryState("plan-cadence-shared");
      return {
        none: r(undefined), zero: r(room(p({ mopEveryN: 3 }), g())), counted: r(room(p({ mopEveryN: 3 }), g({ mopProgress: 1 }))),
        flagged: r(room(p({ coverageEveryN: 2, doCoverageNext: true }))), unverified: r(room(p(), undefined, { cadenceReasons: ["coverage_progress_unverified"] })),
        idle: m.resetBlock(t, state),
        dirty: m.resetBlock(t, { ...state, planDraft: { ...state.planDraft, dirty: true } }),
        busy: m.resetBlock(t, { ...state, activity: "cleaning" }),
        history: m.resetBlock(t, { ...state, dataMode: "history" }),
        command: m.resetBlock(t, { ...state, command: "pending" }),
      };`);
    const busy = "Can't reset until the robot is idle and the map is live.";
    expect(result).toEqual({
      none: { mop: false, coverage: false }, zero: { mop: false, coverage: false }, counted: { mop: true, coverage: false },
      flagged: { mop: false, coverage: true }, unverified: { mop: false, coverage: true },
      idle: null, dirty: "Can't reset until you save or cancel your changes.", busy, history: busy, command: busy,
    });
  });
});

test.describe("Schedule block", () => {
  test("rows step, snap, turn Off and keep the rotation level", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    await expect(schedule.getByRole("heading", { level: 3, name: "Smart cleaning" })).toBeVisible();
    const mop = schedule.getByRole("spinbutton", { name: /^Mop/ });
    const rotation = schedule.getByRole("spinbutton", { name: /vacuum/ });
    await expect(schedule.getByRole("spinbutton", { name: /^Mop every 3 cleans$/ })).toHaveValue("3");
    await expect(mop).toHaveAccessibleDescription("Due in 2 cleans");
    await expect(schedule.getByRole("spinbutton", { name: "Heavy duty vacuum every 2 cleans" })).toHaveValue("2");
    await expect(rotation).toHaveAccessibleDescription("Due next clean");
    const level = schedule.getByRole("combobox", { name: "Vacuum level for Kitchen" });
    await expect(level).toHaveValue("heavy_duty");

    await schedule.getByRole("button", { name: "Increase Mop every 3 cleans" }).click();
    await expect(mop).toHaveValue("4");
    await expect(schedule.getByText("Mop every 4 cleans", { exact: true })).toBeVisible();
    await expect(mop).toHaveAccessibleDescription("Keeps the progress so far");
    expect((await snapshot(page)).planDraft.rooms[0].cadence.mopEveryN).toBe(4);

    await mop.fill("250");
    await mop.press("Enter");
    await expect(mop).toHaveValue("100");
    const increase = schedule.getByRole("button", { name: "Increase Mop every 100 cleans" });
    await expect(increase).toHaveAttribute("aria-disabled", "true");
    await expect(increase).toHaveAccessibleDescription("Every 100 cleans is the longest schedule.");
    await increase.focus();
    await page.keyboard.press("Enter");
    await expect(mop).toHaveValue("100");
    expect(await focusedName(page)).toBe("Increase Mop every 100 cleans");

    const dirty = (await snapshot(page)).planDraft.dirty;
    await mop.fill("");
    await mop.pressSequentially("e");
    await mop.press("Enter");
    await mop.blur();
    await expect(mop).toHaveValue("100");
    expect((await snapshot(page)).planDraft.dirty).toBe(dirty);
    expect((await snapshot(page)).planDraft.rooms[0].cadence.mopEveryN).toBe(100);

    await mop.fill("");
    await mop.press("Tab");
    const off = schedule.getByRole("spinbutton", { name: "Occasional mopping", exact: true });
    await expect(off).toHaveValue("");
    await expect(off).toHaveAttribute("placeholder", "Off");
    await expect(off).toHaveAccessibleDescription("Not scheduled");
    const decrease = schedule.getByRole("button", { name: "Decrease Occasional mopping", exact: true });
    await expect(decrease).toHaveAttribute("aria-disabled", "true");
    await expect(decrease).toHaveAccessibleDescription("This schedule is already off.");

    await level.selectOption("quick");
    expect((await snapshot(page)).planDraft.rooms[0].cadence.periodicCoverageSetting).toBe("quick");
    await expect(schedule.getByRole("spinbutton", { name: "Quick vacuum every 2 cleans" })).toBeVisible();
    await rotation.fill("");
    await rotation.press("Tab");
    const before = (await snapshot(page)).planDraft;
    await level.selectOption("standard");
    await expect(schedule.getByRole("spinbutton", { name: "Optimal vacuum", exact: true })).toBeVisible();
    expect((await snapshot(page)).planDraft).toEqual(before);
    await schedule.getByRole("button", { name: "Increase Optimal vacuum", exact: true }).click();
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ coverageEveryN: 1, periodicCoverageSetting: "standard" });
    await expect(schedule.getByRole("spinbutton", { name: "Optimal vacuum every clean" })).toHaveAccessibleDescription("Due every clean");
  });

  test("occasional mopping steps Off to two, clamps typed one, and releases normal mode when off", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const mop = schedule.getByRole("spinbutton", { name: /^(Mop|Occasional mopping)/ });
    await mop.fill("");
    await mop.press("Tab");
    await schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true }).click();
    await expect(mop).toHaveValue("2");
    await expect(mop).toHaveAttribute("min", "2");
    await mop.fill("1");
    await mop.press("Tab");
    await expect(mop).toHaveValue("2");
    const mode = gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen" });
    await expect(mode.locator('option[value="vacuum_and_mop"]')).toHaveJSProperty("disabled", true);
    await schedule.getByRole("button", { name: "Decrease Mop every 2 cleans", exact: true }).click();
    await expect(mop).toHaveValue("");
    await expect(mode.locator('option[value="vacuum_and_mop"]')).toHaveJSProperty("disabled", false);
    await mode.selectOption("vacuum_and_mop");
    await expect(mop).toHaveAttribute("aria-disabled", "true");
    await schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true }).click({ force: true });
    expect((await snapshot(page)).planDraft.rooms[0]).toMatchObject({ cleaningMode: "vacuum_and_mop", cadence: { mopEveryN: null } });
  });

  test("legacy every-clean mopping stays untouched until edited", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    await patchState(page, `({ ...s, planDraft: { ...s.planDraft, rooms: s.planDraft.rooms.map((r,i) => i ? r : { ...r, cadence: { ...r.cadence, mopEveryN: 1 } }) } })`);
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const mop = schedule.getByRole("spinbutton", { name: "Mop every clean", exact: true });
    await expect(mop).toHaveValue("1");
    await expect(mop).toHaveAccessibleDescription(/This saved setting mops every clean/);
    await expect(gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen" }))
      .toHaveAccessibleDescription("Turn the mopping schedule off to change the cleaning mode.");
    const before = (await snapshot(page)).planDraft;
    await mop.focus();
    await mop.press("Tab");
    expect((await snapshot(page)).planDraft).toEqual(before);
    await schedule.getByRole("button", { name: "Increase Mop every clean", exact: true }).click();
    expect((await snapshot(page)).planDraft.rooms[0].cadence.mopEveryN).toBe(2);
  });

  test("a new vacuum rotation is Heavy duty whatever the room's coverage", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    await gallery.getByRole("button", { name: "Settings for Living room", exact: true }).click();
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Living room" });
    await schedule.getByRole("button", { name: "Increase Heavy duty vacuum", exact: true }).click();
    const state = await snapshot(page);
    expect(state.planDraft.rooms[1].coverageSetting).toBe("standard");
    expect(state.planDraft.rooms[1].cadence).toEqual({
      scope: "shared", mopEveryN: null, coverageEveryN: 1, periodicCoverageSetting: "heavy_duty", doMopNext: false, doCoverageNext: false,
    });
  });

  // Codex P2 (#253): a level chosen while the rotation is on replaces the
  // one remembered from while it was Off, so turning it off shows the latest.
  test("the latest level wins after the rotation is turned off again", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const rotation = schedule.getByRole("spinbutton", { name: /vacuum/ });
    const level = schedule.getByRole("combobox", { name: "Vacuum level for Kitchen" });
    const cadence = async () => (await snapshot(page)).planDraft.rooms[0].cadence;
    await rotation.fill("");
    await rotation.press("Tab");
    await level.selectOption("quick");
    await schedule.getByRole("button", { name: "Increase Quick vacuum", exact: true }).click();
    expect(await cadence()).toMatchObject({ coverageEveryN: 1, periodicCoverageSetting: "quick" });
    await level.selectOption("standard");
    expect(await cadence()).toMatchObject({ periodicCoverageSetting: "standard" });
    await schedule.getByRole("button", { name: "Decrease Optimal vacuum every clean", exact: true }).click();
    expect(await cadence()).toMatchObject({ coverageEveryN: null });
    await expect(level).toHaveValue("standard");
    await expect(schedule.getByRole("spinbutton", { name: "Optimal vacuum", exact: true })).toBeVisible();
    await schedule.getByRole("button", { name: "Increase Optimal vacuum", exact: true }).click();
    expect(await cadence()).toMatchObject({ coverageEveryN: 1, periodicCoverageSetting: "standard" });
  });

  test("mode conflicts hold their control with one reason", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "plan-schedule-conflict" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const mop = schedule.getByRole("spinbutton", { name: "Occasional mopping", exact: true });
    await expect(mop).toHaveAttribute("aria-disabled", "true");
    await expect(mop).toHaveAccessibleDescription("This mode already mops every clean. Choose Vacuum above for occasional mopping.");
    const increase = schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true });
    await expect(increase).toHaveAccessibleDescription("This mode already mops every clean. Choose Vacuum above for occasional mopping.");
    await increase.click({ force: true });
    expect((await snapshot(page)).planDraft.dirty).toBe(false);
    const rotation = schedule.getByRole("spinbutton", { name: "Heavy duty vacuum every 3 cleans" });
    await expect(rotation).toHaveAttribute("aria-disabled", "true");
    await expect(rotation).toHaveAccessibleDescription("The vacuum rotation needs a cleaning mode that includes vacuuming, so change the mode or turn the rotation off.");
    // Codex P2 (#253): the switch can't bring forward work its row holds.
    const next = schedule.getByRole("switch", { name: "Heavy duty vacuum on the next clean" });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toHaveAccessibleDescription("Do it once on the next clean, then resume the usual pattern. The vacuum rotation needs a cleaning mode that includes vacuuming, so change the mode or turn the rotation off.");
    await next.click({ force: true });
    await expect(next).toHaveAttribute("aria-checked", "false");
    expect((await snapshot(page)).planDraft.dirty).toBe(false);
    const turnOff = schedule.getByRole("button", { name: "Turn off the vacuum rotation in Kitchen", exact: true });
    await expect(turnOff).toHaveText("Turn off");
    await turnOff.click();
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toEqual({
      scope: "plan", mopEveryN: null, coverageEveryN: null, periodicCoverageSetting: null, doMopNext: false, doCoverageNext: false,
    });

    const shared = await loadGallery(page, { scenario: "plan-cadence-shared" });
    await expect(shared.getByRole("combobox", { name: "Cleaning mode for Kitchen" }))
      .toHaveAccessibleDescription("Turn the mopping schedule off to change the cleaning mode.");
  });

  test("a save in flight holds every schedule control", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    await patchState(page, `{ ...s, command: "pending", pendingAction: "save-plan" }`);
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const controls = schedule.locator(".ms-stepper button, .ms-stepper input, .sched-row select");
    await expect(controls).toHaveCount(7);
    for (const control of await controls.all()) await expect(control).toHaveAttribute("aria-disabled", "true");
    const before = (await snapshot(page)).planDraft;
    await schedule.getByRole("button", { name: "Increase Mop every 3 cleans" }).click({ force: true });
    await schedule.getByRole("spinbutton", { name: /^Mop/ }).fill("9", { force: true });
    await schedule.getByRole("spinbutton", { name: /^Mop/ }).press("Enter");
    // A held select still opens natively; its change shows the draft's value again.
    await schedule.getByRole("combobox", { name: "Vacuum level for Kitchen" }).evaluate((select) => {
      select.value = "quick";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(schedule.getByRole("combobox", { name: "Vacuum level for Kitchen" })).toHaveValue("heavy_duty");
    // The switch, the room menu and both scope radios are held by the same reason.
    const saving = "Waiting for Home Assistant to save the plan.";
    await schedule.getByText("Advanced", { exact: true }).click();
    const held = [
      schedule.getByRole("switch", { name: "Mop on the next clean" }),
      schedule.getByRole("button", { name: "More for Kitchen" }),
      schedule.getByRole("radio", { name: "Across all plans (recommended)" }),
      schedule.getByRole("radio", { name: "In this plan only" }),
    ];
    for (const control of held) {
      await expect(control).toHaveAttribute("aria-disabled", "true");
      await expect(control).toHaveAccessibleDescription(new RegExp(saving.replace(/\./g, "\\.")));
      await control.click({ force: true });
    }
    await expect(schedule.getByRole("menu")).toHaveCount(0);
    await expect(schedule.getByRole("radio", { name: "Across all plans (recommended)" })).toBeChecked();
    expect((await snapshot(page)).planDraft).toEqual(before);
    await expect(schedule.getByRole("spinbutton", { name: /^Mop/ })).toHaveValue("3");
  });

  test("a save in flight holds Turn off, inline Reset and the stepper ends with their own reasons", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const saving = "Waiting for Home Assistant to save the plan.";
    const gallery = await loadGallery(page, { scenario: "plan-schedule-conflict" });
    await patchState(page, `{ ...s, command: "pending", pendingAction: "save-plan" }`);
    let schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const turnOff = schedule.getByRole("button", { name: "Turn off the vacuum rotation in Kitchen", exact: true });
    await expect(turnOff).toHaveAttribute("aria-disabled", "true");
    await expect(turnOff).toHaveAccessibleDescription(saving);
    await turnOff.click({ force: true });
    expect((await snapshot(page)).planDraft.dirty).toBe(false);
    // At Off, "−" says both why it can't act and that a save holds it.
    await expect(schedule.getByRole("button", { name: "Decrease Occasional mopping", exact: true }))
      .toHaveAccessibleDescription(`This schedule is already off. ${saving}`);

    await loadGallery(page, { scenario: "plan-cadence-blocked" });
    await patchState(page, `{ ...s, command: "pending", pendingAction: "save-plan" }`);
    schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const reset = schedule.locator(".sched-row").getByRole("button", { name: "Reset mopping progress for Kitchen" });
    await expect(reset).toHaveAttribute("aria-disabled", "true");
    await expect(reset).toHaveAccessibleDescription(saving);
    await reset.click({ force: true });
    expect((await snapshot(page)).dialog).toBeNull();
  });

  for (const [width, height, narrow, shared] of [[390, 844, true, true], [360, 844, true, false], [320, 844, true, false], [1024, 768, false, false]]) {
    test(`the level select and stepper ${shared ? "share" : "stack"} their line at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const gallery = await loadGallery(page, { scenario: "plan-cadence-shared", narrow });
      const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
      // The sheet settles at its detent first, so both boxes are read in one frame.
      await schedule.evaluate(async (element) => {
        const root = element.getRootNode();
        let host = root.host;
        while (host?.getRootNode() instanceof ShadowRoot) host = host.getRootNode().host;
        await Promise.all((host ?? document).getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
      });
      const [select, stepper] = await schedule.evaluate((element) => [
        element.querySelector(".sched-level").getBoundingClientRect().toJSON(),
        element.querySelectorAll(".ms-stepper")[1].getBoundingClientRect().toJSON(),
      ]);
      if (shared) expect(Math.abs(stepper.y - select.y)).toBeLessThanOrEqual(2);
      else expect(stepper.y).toBeGreaterThanOrEqual(select.y + select.height);
      for (const target of await schedule.locator(".ms-stepper button, .ms-stepper input, .sched-row select").all()) {
        const box = await target.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe("next clean, Advanced and joining", () => {
  test.beforeEach(({ page }) => page.setViewportSize({ width: 1024, height: 768 }));
  const shared = { scope: "shared", mopEveryN: 3, coverageEveryN: 2, periodicCoverageSetting: "heavy_duty", doMopNext: false, doCoverageNext: false };
  const officeCadence = async (page) => (await snapshot(page)).planDraft.rooms.find((room) => room.roomId === "room-c").cadence;

  test("turning a row on joins Office's shared schedule, read-only until Save", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-schedule-available" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Office" });
    await expect(schedule.getByText("Office has a shared schedule, and turning on a row uses it.", { exact: true })).toBeVisible();
    await schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true }).click();
    const mop = schedule.getByRole("spinbutton", { name: "Mop every 3 cleans" });
    const rotation = schedule.getByRole("spinbutton", { name: "Heavy duty vacuum every 2 cleans" });
    await expect(mop).toHaveValue("3");
    await expect(rotation).toHaveValue("2");
    await expect(mop).toHaveAttribute("readonly", "");
    await expect(rotation).toHaveAttribute("readonly", "");
    await expect(schedule.getByRole("button", { name: /^(Increase|Decrease) / })).toHaveCount(0);
    await expect(schedule.getByRole("combobox")).toHaveCount(0);
    await expect(mop).toHaveAccessibleDescription("Due in 2 cleans");
    await expect(rotation).toHaveAccessibleDescription("Due next clean");
    await expect(schedule.getByText("Uses Office's shared schedule; change it after you save, or choose \"In this plan only\" under Advanced.", { exact: true })).toBeVisible();
    await expect(schedule.getByText("Saving shares this room's progress with every plan that uses it, picking up any progress already counted.", { exact: true })).toBeVisible();
    await expect(schedule.getByText(/has a shared schedule/)).toHaveCount(0);
    expect(await officeCadence(page)).toEqual(shared);
    const next = schedule.getByRole("switch", { name: "Mop on the next clean" });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await next.click({ force: true });
    expect(await officeCadence(page)).toEqual(shared);

    await schedule.getByText("Advanced", { exact: true }).click();
    await schedule.getByRole("radio", { name: "In this plan only" }).check();
    expect(await officeCadence(page)).toEqual({ ...shared, scope: "plan" });
    await expect(mop).not.toHaveAttribute("readonly", "");
    await expect(schedule.getByText("Starts counting completed cleans in this plan only, from zero.", { exact: true })).toBeVisible();
    await schedule.getByRole("radio", { name: "Across all plans (recommended)" }).check();
    expect(await officeCadence(page)).toEqual(shared);
    await expect(mop).toHaveAttribute("readonly", "");
  });

  test("shared every-clean mopping needs an explicit Advanced join", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-schedule-available" });
    await patchState(page, `({ ...s, resources: { ...s.resources, plans: { ...s.resources.plans, value: { ...s.resources.plans.value, rooms: s.resources.plans.value.rooms.map(r => r.roomId !== "room-c" ? r : { ...r, sharedCadence: { ...r.sharedCadence, mopEveryN: 1 } }) } } } })`);
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Office" });
    await expect(schedule.getByText(/New smart cleaning stays in this plan/)).toBeVisible();
    await schedule.getByText("Advanced", { exact: true }).click();
    await expect(schedule.getByRole("radio", { name: "In this plan only" })).toBeChecked();
    await expect(schedule.getByRole("radio", { name: "Across all plans (recommended)" })).not.toBeChecked();
    await schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true }).click();
    expect(await officeCadence(page)).toMatchObject({ scope: "plan", mopEveryN: 2, coverageEveryN: null });
    await schedule.getByRole("radio", { name: "Across all plans (recommended)" }).check();
    expect(await officeCadence(page)).toEqual({ ...shared, mopEveryN: 1 });
    await expect(schedule.getByRole("spinbutton", { name: "Mop every clean", exact: true })).toHaveAttribute("readonly", "");
  });

  test("Cancel undoes a join", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-schedule-joining" });
    await gallery.getByRole("button", { name: "Cancel", exact: true }).click();
    const discard = gallery.getByRole("dialog");
    await discard.getByRole("button", { name: /^Discard/ }).click();
    const daily = (await snapshot(page)).resources.plans.value.plans[0];
    expect(daily.rooms.find((room) => room.roomId === "room-c").cadence).toBeUndefined();
    const state = await snapshot(page);
    expect(state.planDraft.rooms.find((room) => room.roomId === "room-c").cadence).toBeUndefined();
  });

  test("the next-clean switch brings work forward and its label names it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    await expect(schedule.getByText("Changes apply to every plan using Kitchen's smart cleaning settings.", { exact: true })).toBeVisible();
    const next = schedule.getByRole("switch", { name: "Mop on the next clean" });
    await expect(next).toHaveAccessibleDescription("Do it once on the next clean, then resume the usual pattern.");
    await expect(next).toHaveAttribute("aria-checked", "false");
    await next.click();
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ doMopNext: true, doCoverageNext: false });
    await expect(next).toHaveAttribute("aria-checked", "true");
    await expect(schedule.getByRole("spinbutton", { name: "Mop every 3 cleans" })).toHaveAccessibleDescription("Due next clean");
    await next.click();
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ doMopNext: false, doCoverageNext: false });
    // Turning the mop row Off clears the work it brought forward.
    await next.click();
    const mop = schedule.getByRole("spinbutton", { name: /^Mop/ });
    await mop.fill("");
    await mop.press("Tab");
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ mopEveryN: null, doMopNext: false });
    await expect(schedule.getByRole("switch")).toHaveCount(0);

    // With neither due, the label names both; every clean is never named.
    await patchState(page, `{ ...s, planDraft: { ...s.planDraft, rooms: s.planDraft.rooms.map((room, index) => index ? room : { ...room, cadenceProgress: { ...room.cadenceProgress, nextMopIn: 2, nextCoverageIn: 2 }, cadence: { ...room.cadence, mopEveryN: 3, doMopNext: false } }) } }`);
    await expect(schedule.getByRole("switch")).toHaveAccessibleName("Mop and heavy duty vacuum on the next clean");
    await patchState(page, `{ ...s, planDraft: { ...s.planDraft, rooms: s.planDraft.rooms.map((room, index) => index ? room : { ...room, cadenceProgress: { ...room.cadenceProgress, nextMopIn: 1, nextCoverageIn: 1 }, cadence: { ...room.cadence, mopEveryN: 1 } }) } }`);
    await expect(schedule.getByRole("switch")).toHaveCount(0);
  });

  test("a row edited while the switch is on stays out of its checked label", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    // The mop is due in 2 and the rotation is due next clean, so only the mop can come forward.
    await patchState(page, `{ ...s, planDraft: { ...s.planDraft, rooms: s.planDraft.rooms.map((room, index) => index ? room : { ...room, cadenceProgress: { ...room.cadenceProgress, nextMopIn: 2, nextCoverageIn: 1 } }) } }`);
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const next = schedule.getByRole("switch");
    await expect(next).toHaveAccessibleName("Mop on the next clean");
    await next.click();
    await schedule.getByRole("button", { name: /^Increase Heavy duty vacuum/ }).click();
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ doMopNext: true, doCoverageNext: false });
    await expect(next).toHaveAttribute("aria-checked", "true");
    await expect(next).toHaveAccessibleName("Mop on the next clean");
    await next.click();
    await expect(next).toHaveAccessibleName("Mop and heavy duty vacuum on the next clean");
    await next.click();
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ doMopNext: true, doCoverageNext: true });
  });

  test("turning off a saved next-clean switch keeps it in place to turn back on", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    // The saved plan brought the mop forward, so the server counts it due next clean.
    await patchState(page, `(() => {
      const flag = (room) => room.roomId === "room-a" ? { ...room, cadence: { ...room.cadence, doMopNext: true }, cadenceProgress: { ...room.cadenceProgress, mopDue: true, nextMopIn: 1 } } : room;
      const plans = s.resources.plans.value.plans.map((plan) => ({ ...plan, rooms: plan.rooms.map(flag) }));
      return { ...s, resources: { ...s.resources, plans: { ...s.resources.plans, value: { ...s.resources.plans.value, plans } } }, planDraft: { ...s.planDraft, rooms: s.planDraft.rooms.map(flag) } };
    })()`);
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const next = schedule.getByRole("switch", { name: "Mop on the next clean" });
    const mop = schedule.getByRole("spinbutton", { name: "Mop every 3 cleans" });
    await expect(next).toHaveAttribute("aria-checked", "true");
    await expect(mop).toHaveAccessibleDescription("Due next clean");
    await next.focus();
    await page.keyboard.press("Space");
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ doMopNext: false, doCoverageNext: false });
    await expect(next).toHaveAttribute("aria-checked", "false");
    await expect(next).toBeFocused();
    await expect(mop).not.toHaveAccessibleDescription("Due next clean");
    await page.keyboard.press("Space");
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ doMopNext: true });
  });

  test("a broken shared schedule keeps the room to this plan, with a reason", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-schedule-available" });
    await patchState(page, `{ ...s, resources: { ...s.resources, plans: { ...s.resources.plans, value: { ...s.resources.plans.value,
      rooms: s.resources.plans.value.rooms.map(({ sharedCadence, sharedCadenceProgress, ...room }) => room.roomId === "room-c" ? { ...room, sharedCadenceReasons: ["shared_schedule_unavailable"] } : room) } } } }`);
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Office" });
    await expect(schedule.getByText(/has a shared schedule/)).toHaveCount(0);
    await schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true }).click();
    expect(await officeCadence(page)).toEqual({ scope: "plan", mopEveryN: 2, coverageEveryN: null, periodicCoverageSetting: null, doMopNext: false, doCoverageNext: false });
    await expect(schedule.getByRole("spinbutton", { name: "Mop every 2 cleans" })).not.toHaveAttribute("readonly", "");
    await schedule.getByText("Advanced", { exact: true }).click();
    const across = schedule.getByRole("radio", { name: "Across all plans (recommended)" });
    await expect(across).toHaveAttribute("aria-disabled", "true");
    await expect(across).toHaveAccessibleDescription("Can't count across all plans until you fix this room's shared schedule in a plan that uses it.");
    await across.click({ force: true });
    expect((await officeCadence(page)).scope).toBe("plan");
  });

  test("a shared schedule this room's mode can't use keeps the room to this plan, with a reason", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-schedule-available" });
    await patchState(page, `{ ...s, planDraft: { ...s.planDraft, rooms: s.planDraft.rooms.map((room) => room.roomId === "room-c" ? { ...room, cleaningMode: "vacuum_and_mop" } : room) } }`);
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Office" });
    await expect(schedule.getByText(/has a shared schedule/)).toHaveCount(0);
    await schedule.getByRole("button", { name: "Increase Heavy duty vacuum", exact: true }).click();
    expect(await officeCadence(page)).toEqual({ scope: "plan", mopEveryN: null, coverageEveryN: 1, periodicCoverageSetting: "heavy_duty", doMopNext: false, doCoverageNext: false });
    await schedule.getByText("Advanced", { exact: true }).click();
    const across = schedule.getByRole("radio", { name: "Across all plans (recommended)" });
    await expect(across).toHaveAttribute("aria-disabled", "true");
    await expect(across).toHaveAccessibleDescription("Can't count across all plans until this room's cleaning mode works with its shared schedule.");
    await across.click({ force: true });
    await expect(schedule.getByRole("radio", { name: "In this plan only" })).toBeChecked();
    expect((await officeCadence(page)).scope).toBe("plan");
  });

  test("a new schedule counts across all plans, and Advanced holds the choice", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    await gallery.getByRole("button", { name: "Settings for Living room", exact: true }).click();
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Living room" });
    const summary = schedule.locator("details.advanced > summary");
    await expect(summary).toHaveText("Advanced");
    expect(await schedule.locator("details.advanced").evaluate((details) => details.open)).toBe(false);
    expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true }).click();
    expect((await snapshot(page)).planDraft.rooms[1].cadence.scope).toBe("shared");
    await expect(schedule.getByText("Starts counting from zero, across plans that use these settings.", { exact: true })).toBeVisible();
    await summary.click();
    for (const radio of await schedule.getByRole("radio").all()) expect((await radio.locator("..").boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(schedule.getByText("Only cleans the robot confirms count toward these schedules, and due work stays due until a clean is confirmed.")).toBeVisible();
  });

  // Codex P2 (#253): a level chosen while Off is view state for this draft only.
  test("a level chosen while Off is forgotten with the draft", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    await gallery.getByRole("button", { name: "Settings for Living room", exact: true }).click();
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Living room" });
    const level = schedule.getByRole("combobox", { name: "Vacuum level for Living room" });
    await level.selectOption("quick");
    await expect(schedule.getByRole("spinbutton", { name: "Quick vacuum", exact: true })).toBeVisible();
    expect((await snapshot(page)).planDraft.dirty).toBe(false);
    await gallery.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(gallery.getByRole("button", { name: "Edit Daily clean", exact: true })).toBeVisible();
    await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    await gallery.getByRole("button", { name: "Settings for Living room", exact: true }).click();
    await expect(level).toHaveValue("heavy_duty");
    await schedule.getByRole("button", { name: "Increase Heavy duty vacuum", exact: true }).click();
    expect((await snapshot(page)).planDraft.rooms[1].cadence.periodicCoverageSetting).toBe("heavy_duty");
  });

  test("leaving a shared schedule says other plans keep it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    // The rotation is due on the shared count; the plan's fresh count can bring it forward.
    await expect(schedule.getByRole("switch")).toHaveAccessibleName("Mop on the next clean");
    await schedule.getByText("Advanced", { exact: true }).click();
    await schedule.getByRole("radio", { name: "In this plan only" }).check();
    await expect(schedule.getByText("Saving starts new progress for this plan only, and other plans keep the shared schedule.", { exact: true })).toBeVisible();
    const next = schedule.getByRole("switch");
    await expect(next).toHaveAccessibleName("Mop and heavy duty vacuum on the next clean");
    await next.click();
    expect((await snapshot(page)).planDraft.rooms[0].cadence).toMatchObject({ scope: "plan", doMopNext: true, doCoverageNext: true });
  });
});

// Review Focus 1: a room with a shared schedule this plan doesn't use never
// saves the user's own values, or Off, counted across all plans.
test.describe("saving next to a shared schedule", () => {
  const raw = { scope: "shared", mop_every_n: 3, coverage_every_n: 2, periodic_coverage_setting: "heavy_duty", do_mop_next: false, do_coverage_next: false };
  const catalog = {
    rooms: [{ room_id: "room-a", name: "Kitchen", shared_cadence: raw }],
    selected_plan: "daily",
    plans: [{
      id: "daily", name: "Daily clean", enabled: true, run_behavior: "intelligent",
      rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
      room_order: ["room-a"], return_to_base: true, finish_current_room: false, finish_current_room_threshold: 50,
    }],
  };
  const open = async (page) => {
    const fixture = await installPanelFixture(page, { initialPlanCatalog: catalog, moduleSource: "packaged" });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    await openPlanPicker(panel);
    await panel.getByRole("button", { name: /^Daily clean/ }).click();
    await panel.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    await panel.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
    return { panel, schedule: panel.getByRole("group", { name: "Smart cleaning for Kitchen" }) };
  };
  const saved = async (page, panel) => {
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(1);
    return (await page.evaluate(() => window.__panelFixture.serviceCalls))[0].data.rooms[0];
  };

  test("a level chosen while Off sends no schedule", async ({ page }) => {
    const { panel, schedule } = await open(page);
    await schedule.getByLabel("Vacuum level for Kitchen").selectOption("quick");
    await panel.getByRole("textbox", { name: "Plan name" }).fill("Daily clean 2");
    expect(await saved(page, panel)).not.toHaveProperty("cadence");
  });

  test("turning a row on sends exactly the shared schedule", async ({ page }) => {
    const { panel, schedule } = await open(page);
    await schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true }).click();
    expect((await saved(page, panel)).cadence).toEqual(raw);
  });

  test("In this plan only sends the user's own values", async ({ page }) => {
    const { panel, schedule } = await open(page);
    await schedule.getByRole("button", { name: "Increase Occasional mopping", exact: true }).click();
    await schedule.getByText("Advanced", { exact: true }).click();
    await schedule.getByRole("radio", { name: "In this plan only" }).check();
    await schedule.getByRole("button", { name: "Increase Mop every 3 cleans" }).click();
    expect((await saved(page, panel)).cadence).toEqual({ ...raw, scope: "plan", mop_every_n: 4 });
  });
});

test.describe("room menu and Reset", () => {
  test.beforeEach(({ page }) => page.setViewportSize({ width: 1024, height: 768 }));
  const focusedDisclosure = (page) => page.evaluate(() => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.getAttribute("data-room-disclosure") ?? active?.getAttribute("aria-label") ?? null;
  });
  const listenForAction = (page) => page.evaluate((tag) => {
    const element = document.querySelector(tag);
    element.__action = null;
    element.addEventListener("matic-workspace-action", (event) => { element.__action = event.detail; }, { once: true });
  }, GALLERY_TAG);

  test("More for Kitchen resets a schedule and returns focus to the room", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const more = schedule.getByRole("button", { name: "More for Kitchen" });
    await expect(more).toHaveAttribute("aria-haspopup", "menu");
    await more.click();
    const menu = schedule.getByRole("menu", { name: "More for Kitchen" });
    await expect(menu.getByRole("menuitem", { name: "Reset mopping progress for Kitchen" })).toHaveText("Reset mopping");
    await expect(menu.getByRole("menuitem", { name: "Reset vacuum rotation progress for Kitchen" })).toHaveText("Reset vacuum rotation");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(gallery.getByRole("heading", { level: 2 })).toBeVisible();
    expect((await snapshot(page)).planView).toBe("edit");

    await more.click();
    await menu.getByRole("menuitem", { name: "Reset mopping progress for Kitchen" }).click();
    const dialog = gallery.getByRole("dialog", { name: "Reset mopping progress?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => focusedDisclosure(page)).toBe("room-a");
    expect((await snapshot(page)).expandedRoom).toBe("room-a");

    await more.click();
    await menu.getByRole("menuitem", { name: "Reset mopping progress for Kitchen" }).click();
    await listenForAction(page);
    await dialog.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate((tag) => document.querySelector(tag).__action, GALLERY_TAG))
      .toEqual({ id: "reset-room-cadence", planId: "daily", roomId: "room-a", mode: "mop" });
    await expect.poll(() => focusedDisclosure(page)).toBe("room-a");

    await more.click();
    await menu.getByRole("menuitem", { name: "Reset vacuum rotation progress for Kitchen" }).click();
    await expect(gallery.getByRole("dialog", { name: "Reset vacuum rotation progress?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => focusedDisclosure(page)).toBe("room-a");
  });

  test("arrow keys move through the room menu and Tab leaves it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    await schedule.getByRole("button", { name: "More for Kitchen" }).click();
    const menu = schedule.getByRole("menu", { name: "More for Kitchen" });
    const mop = menu.getByRole("menuitem", { name: "Reset mopping progress for Kitchen" });
    const rotation = menu.getByRole("menuitem", { name: "Reset vacuum rotation progress for Kitchen" });
    await expect(mop).toBeFocused();
    for (const [key, focused] of [["ArrowDown", rotation], ["ArrowDown", mop], ["ArrowUp", rotation], ["Home", mop], ["End", rotation]]) {
      await page.keyboard.press(key);
      await expect(focused).toBeFocused();
    }
    await expect(mop).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);
  });

  test("a save closes the room menu and its button says so", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    const more = schedule.getByRole("button", { name: "More for Kitchen" });
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await patchState(page, `{ ...s, command: "pending", pendingAction: "save-plan" }`);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await patchState(page, `{ ...s, command: "idle", pendingAction: null }`);
    await expect(schedule.getByRole("menu")).toHaveCount(0);
  });

  test("nothing to reset offers no menu", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
    await patchState(page, `{ ...s, resources: { ...s.resources, plans: { ...s.resources.plans, value: { ...s.resources.plans.value,
      plans: s.resources.plans.value.plans.map((plan) => ({ ...plan, rooms: plan.rooms.map((room) => room.cadenceProgress
        ? { ...room, cadenceProgress: { ...room.cadenceProgress, mopProgress: 0, coverageProgress: 0 } } : room) })) } } } }`);
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    await expect(schedule.getByRole("spinbutton", { name: "Mop every 3 cleans" })).toBeVisible();
    await expect(schedule.getByRole("button", { name: "More for Kitchen" })).toHaveCount(0);
  });

  for (const [why, setup, reason] of [
    ["unsaved changes", "dirty", "Can't reset until you save or cancel your changes."],
    ["a busy robot", "{ ...s, activity: \"cleaning\" }", "Can't reset until the robot is idle and the map is live."],
  ]) {
    test(`Reset waits for ${why}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "plan-cadence-shared" });
      const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
      if (setup === "dirty") await schedule.getByRole("button", { name: "Increase Mop every 3 cleans" }).click();
      else await patchState(page, setup);
      await schedule.getByRole("button", { name: "More for Kitchen" }).click();
      const item = schedule.getByRole("menuitem", { name: "Reset mopping progress for Kitchen" });
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toHaveAccessibleDescription(reason);
      await item.click({ force: true });
      await expect(gallery.getByRole("dialog")).toHaveCount(0);
      expect((await snapshot(page)).dialog).toBeNull();
    });
  }

  test("progress Home Assistant can't confirm shows Reset in its row", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-blocked" });
    const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
    await expect(schedule.getByText("Can't run this plan until you fix Kitchen's schedule.", { exact: true })).toBeVisible();
    const mop = schedule.getByRole("spinbutton", { name: /^Mop/ });
    await expect(mop).toHaveAccessibleDescription("Can't run this schedule until you reset its mopping progress, which Home Assistant can't confirm.");
    const reset = schedule.locator(".sched-row").getByRole("button", { name: "Reset mopping progress for Kitchen" });
    await expect(reset).toHaveText("Reset mopping");
    await reset.click();
    const dialog = gallery.getByRole("dialog", { name: "Reset mopping progress?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => focusedDisclosure(page)).toBe("room-a");
  });
});

// Plan Task 4: a Reset from the room menu ends with a notice, in Edit with the
// room still open; a failed one says so and leaves Done as the primary.
test.describe("Reset through Home Assistant", () => {
  const catalog = {
    rooms: [{ room_id: "room-a", name: "Kitchen" }],
    selected_plan: "daily",
    plans: [{
      id: "daily", name: "Daily clean", enabled: true, run_behavior: "intelligent",
      rooms: [{
        room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard",
        cadence: { scope: "plan", mop_every_n: 3, coverage_every_n: null, periodic_coverage_setting: null, do_mop_next: false, do_coverage_next: false },
        cadence_progress: { mop_progress: 1, coverage_progress: 0, next_mop_in: 2, next_coverage_in: null },
      }],
      room_order: ["room-a"], return_to_base: true, finish_current_room: false, finish_current_room_threshold: 50,
    }],
  };
  for (const failing of [false, true]) {
    test(failing ? "a failed Reset says so and keeps Edit open" : "a Reset shows its notice and keeps Edit open", async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      const fixture = await installPanelFixture(page, { initialPlanCatalog: catalog, moduleSource: "packaged" });
      await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
      const panel = page.locator(fixture.panelTag);
      await openPlanPicker(panel);
      await panel.getByRole("button", { name: /^Daily clean/ }).click();
      await panel.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
      await panel.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
      if (failing) await page.evaluate(() => window.__panelFixture.failNextService("reset_room_cadence"));
      const schedule = panel.getByRole("group", { name: "Smart cleaning for Kitchen" });
      await schedule.getByRole("button", { name: "More for Kitchen" }).click();
      await schedule.getByRole("menuitem", { name: "Reset mopping progress for Kitchen" }).click();
      await panel.getByRole("dialog", { name: "Reset mopping progress?" }).getByRole("button", { name: "Reset", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.map(({ service, data }) => [service, data])))
        .toEqual([["reset_room_cadence", { plan: "daily", room_id: "room-a", modes: ["mop"] }]]);
      await expect(panel.getByText(failing ? "Mopping progress wasn't reset; try again." : "Mopping progress reset", { exact: true }).first()).toBeVisible();
      await expect(schedule).toBeVisible();
      await expect(panel.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    });
  }
});

test.describe("Schedule block appearance", () => {
  // Media emulation survives the gallery's navigation; the document's
  // direction doesn't, so it is set once the gallery is in the page.
  const none = async () => {};
  for (const [label, before, after] of [
    ["dark", async (page) => page.emulateMedia({ colorScheme: "dark" }), none],
    ["right-to-left", none, async (page) => page.evaluate(() => { document.documentElement.dir = "rtl"; })],
    ["forced colors", async (page) => page.emulateMedia({ forcedColors: "active" }), none],
  ]) {
    test(`in ${label} at 390 it has no serious axe finding and stays inside the card`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await before(page);
      const gallery = await loadGallery(page, { scenario: "plan-cadence-shared", narrow: true });
      await after(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe(label === "right-to-left" ? "rtl" : "ltr");
      const forced = label === "forced colors";
      // The emulated media is in force before anything is read (as the
      // acceptance spec waits for it); the forced-colors CSS is checked too.
      await expect.poll(() => page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(forced);
      const schedule = gallery.getByRole("group", { name: "Smart cleaning for Kitchen" });
      await schedule.getByText("Advanced", { exact: true }).click();
      await expect(schedule.getByRole("radio", { name: "Across all plans (recommended)" })).toBeChecked();
      // The open chevron points down in either direction, and the room's name is isolated.
      expect(await schedule.locator(".advanced > summary .ms-icon").evaluate((icon) => getComputedStyle(icon).rotate))
        .toBe(label === "right-to-left" ? "-90deg" : "90deg");
      await expect(schedule.locator(".schedule-note bdi")).toHaveText("Kitchen");
      // Under forced colors the platform owns every colour, and axe 4.13 has
      // no forced-colors handling: emulated system colours on Linux WebKit
      // fail its contrast rule, so that rule is not a finding there. The
      // forced-colors styles themselves are asserted instead.
      const builder = new AxeBuilder({ page });
      const { violations } = await (forced ? builder.disableRules(["color-contrast"]) : builder).analyze();
      expect(violations.filter(({ impact }) => impact === "serious" || impact === "critical").map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) }))).toEqual([]);
      // Forced colors: the stepper's border and the open row's text are both
      // CanvasText, and the open row paints Canvas (WebKit doesn't expose
      // forced-color-adjust, so the colours themselves are compared).
      expect(await schedule.evaluate((element) => {
        const row = getComputedStyle(element.closest(".row-expanded"));
        return getComputedStyle(element.querySelector(".ms-stepper")).borderTopColor === row.color && row.backgroundColor !== "rgba(0, 0, 0, 0)";
      })).toBe(forced);
      const escaped = await schedule.evaluate((element) => {
        const card = element.closest(".edit-row").getBoundingClientRect();
        return [...element.querySelectorAll(".ms-stepper button, .advanced > summary .ms-icon, .room-more > button")]
          .map((control) => control.getBoundingClientRect())
          .filter((box) => box.left < card.left - 1 || box.right > card.right + 1).length;
      });
      expect(escaped).toBe(0);
    });
  }
});
