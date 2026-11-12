// Home shortcuts belong to one Home Assistant user and one robot (UX9,
// Codex PRRT_kwDOTau7uM6sNi6X): a read or a queued write made for one owner
// never lands in another's context or data.
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { EffectController } from "./frontend/map-studio-v4/effects";
      export { WorkspaceStore } from "./frontend/map-studio-v4/state";
      export { syntheticEntry, syntheticPlans, syntheticAreas, syntheticHistory } from "./frontend/map-studio-v4-review/synthetic-fixtures";`,
    resolveDir: process.cwd(),
  },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "The pin ownership harness runs once in Chromium");
});

const KEY = "matic_robot_home_shortcuts";
const plan = (id) => ({ kind: "plan", id });

// One controller, a catalog of two robots, and a user-data socket whose
// answers come from the current user's store; any read or write can be held.
async function setup(page, stores) {
  await page.route("**/pins-harness.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async ({ stores, KEY }) => {
    const { EffectController, WorkspaceStore, syntheticEntry, syntheticPlans, syntheticAreas, syntheticHistory } = await import("/pins-harness.js");
    const data = structuredClone(stores);
    const held = [];
    const log = [];
    const h = { user: "u1", hold: new Set(), held, log, data, failSetAt: 0, failSetAlso: 0, sets: 0, plansFail: 0, denied: new Set() };
    // Every plan id these tests pin exists, unless a test narrows the catalog.
    h.planIds = ["daily", "weekend", "u1-plan", "u2-plan", "fresh", "stale", "b-plan", "b-weekend"];
    h.selectedPlan = "daily";
    h.areaIds = ["entryway"];
    h.planCatalog = (base) => {
      const [template] = base.plans;
      const plans = h.planIds.map((id) => base.plans.find((plan) => plan.id === id) ?? { ...template, id, name: id });
      return { ...base, plans, selectedPlan: h.selectedPlan };
    };
    const connection = {
      subscribeMessage: async () => () => undefined,
      sendMessagePromise: async (message) => {
        const user = h.user;
        log.push({ user, type: message.type, value: structuredClone(message.value ?? null) });
        const answer = () => {
          if (h.denied.has(message.type)) throw Object.assign(new Error("access denied"), { code: "unauthorized" });
          if (message.type === "frontend/get_user_data") return { value: structuredClone(data[user]?.[message.key] ?? null) };
          if (message.type === "frontend/set_user_data") {
            h.sets += 1;
            if (h.sets === h.failSetAt || h.sets === h.failSetAlso) throw new Error("synthetic write failure");
            data[user] = { ...(data[user] ?? {}), [message.key]: structuredClone(message.value) };
            return null;
          }
          throw new Error(`unexpected ${message.type}`);
        };
        if (h.hold.has(message.type) || (h.holdAll && message.type === "frontend/get_user_data")) {
          h.hold.delete(message.type);
          return new Promise((resolve, reject) => held.push({ user, type: message.type,
            deny: () => reject(Object.assign(new Error("access denied"), { code: "unauthorized" })), release: (value) => {
            try { resolve(value ?? answer()); } catch (error) { reject(error); }
          } }));
        }
        return answer();
      },
    };
    const entry = (entryId) => ({ ...syntheticEntry(), entryId });
    const backend = {
      catalog: async () => h.catalogEntries ?? [entry("synthetic-entry"), entry("entry-b")],
      plans: async () => {
        if (h.plansFail > 0) { h.plansFail -= 1; throw new Error("synthetic plans failure"); }
        return h.planCatalog(syntheticPlans());
      },
      areas: async () => ({ ...syntheticAreas(), areas: syntheticAreas().areas.filter((area) => h.areaIds.includes(area.id)) }),
      history: async () => syntheticHistory(),
      scene: async () => ({ scene: { revision: 7, source: "live", buffer: new ArrayBuffer(0), pointOffset: 0,
        floorCount: 0, surfaceCount: 0, total: 0, etag: null,
        metadata: { metersPerCell: 0.05, origin: [0, 0], span: [1, 1], sampleStep: 1, rooms: [] } },
        revision: 7, floorCoherent: true }),
      pose: async () => null,
      dispose() {},
    };
    const make = () => {
      const store = new WorkspaceStore();
      const controller = new EffectController(store, backend, connection, false);
      const sync = (user, entryKey, connected = true) => {
        h.user = user;
        controller.sync({ host: { connected, administrator: true, robotConnected: true, robotCount: 2 },
        activity: "idle", batteryPercent: 50, language: "en", userKey: user, vacuumEntityId: "vacuum.x", entryKey,
        robotLabel: "Matic", robots: [{ entryId: "synthetic-entry", label: "A" }, { entryId: "entry-b", label: "B" }] });
      };
      return { store, controller, sync };
    };
    const first = make();
    h.store = first.store;
    h.controller = first.controller;
    h.sync = first.sync;
    // A second tab or dashboard: its own controller on the same user's data.
    h.make = make;
    h.pins = () => ({ entry: h.store.value.selection.entryId, ...h.store.value.homePins });
    window.pinsHarness = h;
  }, { stores, KEY });
}

const pins = (page) => page.evaluate(() => window.pinsHarness.pins());
const sync = (page, user, entry) => page.evaluate(([u, e]) => window.pinsHarness.sync(u, e), [user, entry]);
const hold = (page, type) => page.evaluate((t) => window.pinsHarness.hold.add(t), type);
const heldCount = (page) => page.evaluate(() => window.pinsHarness.held.length);
const release = (page, index, value) => page.evaluate(([i, v]) => window.pinsHarness.held[i].release(v), [index, value]);
const releaseIgnoringFailure = (page, index) => page.evaluate((i) => {
  try { window.pinsHarness.held[i].release(); } catch { /* expected failed write */ }
}, index);
// One key per robot (Codex PRRT_kwDOTau7uM6sPDWX).
const keyOf = (entry) => `${KEY}.${entry}`;
const ALL = ["daily", "weekend", "u1-plan", "u2-plan", "fresh", "stale", "b-plan", "b-weekend"].map(plan).concat([{ kind: "area", id: "entryway" }]);
const record = (pinsList) => ({
  [keyOf("synthetic-entry")]: { version: 2, pins: pinsList, excluded: ALL.filter((pin) => !pinsList.some((shown) => shown.kind === pin.kind && shown.id === pin.id)) },
  [keyOf("entry-b")]: { version: 2, pins: [plan("b-plan")], excluded: ALL.filter((pin) => pin.id !== "b-plan") },
});

test("a new record shows every saved plan and area by default", async ({ page }) => {
  await setup(page, { u1: {} });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: [plan("daily"), plan("weekend"), plan("u1-plan"), plan("u2-plan"), plan("fresh"), plan("stale"), plan("b-plan"), plan("b-weekend"), { kind: "area", id: "entryway" }] });
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key], keyOf("synthetic-entry"))).toEqual({
    version: 2,
    pins: [plan("daily"), plan("weekend"), plan("u1-plan"), plan("u2-plan"), plan("fresh"), plan("stale"), plan("b-plan"), plan("b-weekend"), { kind: "area", id: "entryway" }],
    excluded: [],
  });
});

test("explicit off survives catalog refresh while newly saved plans default on", async ({ page }) => {
  await setup(page, { u1: {} });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: expect.arrayContaining([plan("daily"), plan("weekend")]) });
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const pin = { kind: "plan", id: "weekend" };
    const before = h.store.value.homePins.pins;
    h.controller.saveHomePin(pin, false, before);
    h.store.dispatch({ type: "set-home-pin", pin, pinned: false });
  });
  await expect.poll(() => storedPins(page, "u1", "synthetic-entry")).toEqual(expect.not.arrayContaining([plan("weekend")]));
  await reloadPlans(page, ["daily", "weekend", "fresh"], "daily");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: expect.arrayContaining([plan("daily"), plan("fresh")]) });
  expect(await pins(page)).not.toMatchObject({ pins: expect.arrayContaining([plan("weekend")]) });
  expect(await page.evaluate((key) => window.pinsHarness.data.u1[key].excluded, keyOf("synthetic-entry"))).toContainEqual(plan("weekend"));
});

test("a user who signs in on the same robot gets their own shortcuts, never the last user's", async ({ page }) => {
  await setup(page, { u1: record([plan("u1-plan")]), u2: record([plan("u2-plan")]) });
  await hold(page, "frontend/get_user_data");
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => heldCount(page)).toBe(1);
  // The second user arrives while the first user's read is still out.
  await sync(page, "u2", "synthetic-entry");
  await expect.poll(() => pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: [plan("u2-plan")] });
  await release(page, 0);
  await page.waitForTimeout(50);
  expect(await pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: [plan("u2-plan")] });
  // And back: the first user's own list is read again, fresh.
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: [plan("u1-plan")] });
});

test("robot A, then B, then A again: the first A read, settling last, is dropped", async ({ page }) => {
  await setup(page, { u1: record([plan("fresh")]) });
  await hold(page, "frontend/get_user_data");
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => heldCount(page)).toBe(1);
  await sync(page, "u1", "entry-b");
  await expect.poll(() => pins(page)).toEqual({ entry: "entry-b", status: "ready", pins: [plan("b-plan")] });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: [plan("fresh")] });
  // The first read answers late with what it saw then.
  await release(page, 0, { value: { pins: [plan("stale")] } });
  await page.waitForTimeout(50);
  expect(await pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: [plan("fresh")] });
});

test("a write queued for one user is never sent after another user takes over", async ({ page }) => {
  await setup(page, { u1: record([plan("daily")]), u2: record([plan("u2-plan")]) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
  await hold(page, "frontend/set_user_data"); // the first write, sent for u1 and still out
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const pin = { kind: "plan", id: "weekend" };
    let before = h.store.value.homePins.pins;
    h.controller.saveHomePin(pin, true, before);
    h.store.dispatch({ type: "set-home-pin", pin, pinned: true });
    before = h.store.value.homePins.pins;
    h.controller.saveHomePin({ kind: "plan", id: "daily" }, false, before);
    h.store.dispatch({ type: "set-home-pin", pin: { kind: "plan", id: "daily" }, pinned: false });
  });
  await expect.poll(() => heldCount(page)).toBe(1);
  await sync(page, "u2", "synthetic-entry");
  await expect.poll(() => pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: [plan("u2-plan")] });
  await release(page, 0);
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({ data: window.pinsHarness.data, writes: window.pinsHarness.log.filter((call) => call.type === "frontend/set_user_data") }));
  // Only the write already out for u1; the one queued behind it never went.
  expect(after.writes.map((call) => call.user)).toEqual(["u1"]);
  expect(after.data.u2[keyOf("synthetic-entry")].pins).toEqual([plan("u2-plan")]);
  expect(await pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: [plan("u2-plan")] });
});

test("a failed write undoes only its own toggle, never a newer one of the same pin", async ({ page }) => {
  await setup(page, { u1: record([plan("daily")]) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
  // Off, on, off, on in quick succession; the second write (the first "on") fails.
  const baselineWrites = await page.evaluate(() => window.pinsHarness.sets);
  await page.evaluate((baseline) => {
    const h = window.pinsHarness;
    h.failSetAt = baseline + 2;
    const pin = { kind: "plan", id: "daily" };
    for (const pinned of [false, true, false, true]) {
      const before = h.store.value.homePins.pins;
      h.controller.saveHomePin(pin, pinned, before);
      h.store.dispatch({ type: "set-home-pin", pin, pinned });
    }
  }, baselineWrites);
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBe(baselineWrites + 4);
  await page.waitForTimeout(50);
  expect(await pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
  const stored = await page.evaluate((key) => window.pinsHarness.data.u1[key].pins, keyOf("synthetic-entry"));
  expect(stored).toEqual([plan("daily")]);
});

test("a failed pin save is rolled back after a queued catalog save also fails, and survives reload", async ({ page }) => {
  await setup(page, { u1: record([plan("daily")]) });
  await page.evaluate(() => { window.pinsHarness.planIds = ["daily"]; window.pinsHarness.areaIds = []; });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
  const baseline = await page.evaluate(() => window.pinsHarness.sets);
  await hold(page, "frontend/set_user_data");
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const pin = { kind: "plan", id: "daily" };
    h.controller.saveHomePin(pin, false, h.store.value.homePins.pins);
    h.store.dispatch({ type: "set-home-pin", pin, pinned: false });
  });
  await expect.poll(() => heldCount(page)).toBe(1);
  await page.evaluate((baseline) => {
    const h = window.pinsHarness;
    h.failSetAt = baseline + 1;
    h.failSetAlso = baseline + 2;
  }, baseline);
  await reloadPlans(page, ["daily", "new-catalog-plan"], "daily");
  await releaseIgnoringFailure(page, 0);
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBe(baseline + 2);
  // Reconcile the failed user toggle while retaining the catalog addition;
  // that visible state prevents the store subscription from retrying cleanup.
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily"), plan("new-catalog-plan")] });
  expect(await storedPins(page, "u1", "synthetic-entry")).toEqual([plan("daily")]);
  await reloadPlans(page, ["daily", "new-catalog-plan"], "daily");
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.pinsHarness.sets)).toBe(baseline + 2);

  // A fresh controller reads the confirmed user choice, so the failed toggle
  // cannot disappear from the UI and then unexpectedly return on reload.
  await page.evaluate(() => {
    const h = window.pinsHarness;
    h.reloaded = h.make();
    h.reloaded.sync("u1", "synthetic-entry");
  });
  await expect.poll(() => page.evaluate(() => window.pinsHarness.reloaded.store.value.homePins)).toMatchObject({
    status: "ready", pins: expect.arrayContaining([plan("daily")]),
  });
});

test("a successful user toggle carries forward failed legacy migration exclusions", async ({ page }) => {
  await setup(page, { u1: { [keyOf("synthetic-entry")]: { pins: [plan("daily")] } } });
  await page.evaluate(() => { window.pinsHarness.failSetAt = 1; });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBe(1);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const pin = { kind: "plan", id: "daily" };
    h.controller.saveHomePin(pin, false, h.store.value.homePins.pins);
    h.store.dispatch({ type: "set-home-pin", pin, pinned: false });
  });
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key], keyOf("synthetic-entry"))).toMatchObject({
    version: 2, pins: [], excluded: expect.arrayContaining(ALL),
  });
  await page.evaluate(() => {
    const h = window.pinsHarness;
    h.reloaded = h.make();
    h.reloaded.sync("u1", "synthetic-entry");
  });
  await expect.poll(() => page.evaluate(() => window.pinsHarness.reloaded.store.value.homePins)).toMatchObject({ status: "ready", pins: [] });
});

test("queued same-pin moves keep the last successful order when a later move fails", async ({ page }) => {
  const initial = [plan("daily"), plan("weekend"), plan("fresh"), plan("stale")];
  await setup(page, { u1: record(initial) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: initial });
  await hold(page, "frontend/set_user_data");
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const moved = { kind: "plan", id: "weekend" };
    h.controller.moveHomePin(moved, 1);
    h.controller.moveHomePin(moved, 1);
    // Once the held first write succeeds, fail the second queued snapshot.
    h.failSetAt = h.sets + 2;
  });
  await expect.poll(() => heldCount(page)).toBe(1);
  await release(page, 0);
  const afterFailedSecondMove = [plan("daily"), plan("fresh"), plan("weekend"), plan("stale")];
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: afterFailedSecondMove });
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key]?.pins, keyOf("synthetic-entry"))).toEqual(afterFailedSecondMove);

  // A fresh controller represents a reload and must see the same order.
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const reloaded = h.make();
    h.reloaded = reloaded;
    reloaded.sync("u1", "synthetic-entry");
  });
  await expect.poll(() => page.evaluate(() => window.pinsHarness.reloaded.store.value.homePins)).toMatchObject({ status: "ready", pins: afterFailedSecondMove });
});

test("two failed queued reorder writes return to the last confirmed order", async ({ page }) => {
  const initial = [plan("daily"), plan("weekend"), plan("fresh"), plan("stale")];
  await setup(page, { u1: record(initial) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: initial });
  const baselineWrites = await page.evaluate(() => window.pinsHarness.sets);
  await hold(page, "frontend/set_user_data");
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const moved = { kind: "plan", id: "weekend" };
    h.controller.moveHomePin(moved, 1);
    h.controller.moveHomePin(moved, 1);
    h.failSetAt = h.sets + 1;
    h.failSetAlso = h.sets + 2;
  });
  await expect.poll(() => heldCount(page)).toBe(1);
  await releaseIgnoringFailure(page, 0);
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBeGreaterThanOrEqual(baselineWrites + 2);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: initial });
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key]?.pins, keyOf("synthetic-entry"))).toEqual(initial);
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const reloaded = h.make();
    h.reloaded = reloaded;
    reloaded.sync("u1", "synthetic-entry");
  });
  await expect.poll(() => page.evaluate(() => window.pinsHarness.reloaded.store.value.homePins)).toMatchObject({ status: "ready", pins: initial });
});

test("interleaved moves on different pins replay after the first move fails", async ({ page }) => {
  const initial = [plan("daily"), plan("weekend"), plan("fresh"), plan("stale")];
  const replayed = [plan("daily"), plan("weekend"), plan("stale"), plan("fresh")];
  await setup(page, { u1: record(initial) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: initial });
  const baseline = await page.evaluate(() => window.pinsHarness.sets);
  await hold(page, "frontend/set_user_data");
  await page.evaluate((base) => {
    const h = window.pinsHarness;
    h.failSetAt = base + 1;
    h.controller.moveHomePin({ kind: "plan", id: "weekend" }, 1);
    h.controller.moveHomePin({ kind: "plan", id: "stale" }, -1);
  }, baseline);
  await expect.poll(() => heldCount(page)).toBe(1);
  await releaseIgnoringFailure(page, 0);
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBe(baseline + 2);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: replayed });
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key]?.pins, keyOf("synthetic-entry"))).toEqual(replayed);
  await page.evaluate(() => {
    const h = window.pinsHarness;
    h.reloaded = h.make();
    h.reloaded.sync("u1", "synthetic-entry");
  });
  await expect.poll(() => page.evaluate(() => window.pinsHarness.reloaded.store.value.homePins)).toMatchObject({ status: "ready", pins: replayed });
});

test("interleaved moves on different pins keep the first success when the second fails", async ({ page }) => {
  const initial = [plan("daily"), plan("weekend"), plan("fresh"), plan("stale")];
  const firstMove = [plan("daily"), plan("fresh"), plan("weekend"), plan("stale")];
  await setup(page, { u1: record(initial) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: initial });
  const baseline = await page.evaluate(() => window.pinsHarness.sets);
  await hold(page, "frontend/set_user_data");
  await page.evaluate((base) => {
    const h = window.pinsHarness;
    h.failSetAt = base + 2;
    h.controller.moveHomePin({ kind: "plan", id: "weekend" }, 1);
    h.controller.moveHomePin({ kind: "plan", id: "stale" }, -1);
  }, baseline);
  await expect.poll(() => heldCount(page)).toBe(1);
  await release(page, 0);
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBe(baseline + 2);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: firstMove });
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key]?.pins, keyOf("synthetic-entry"))).toEqual(firstMove);
});

test("interleaved moves on different pins settle to the confirmed base when both fail", async ({ page }) => {
  const initial = [plan("daily"), plan("weekend"), plan("fresh"), plan("stale")];
  await setup(page, { u1: record(initial) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: initial });
  const baseline = await page.evaluate(() => window.pinsHarness.sets);
  await hold(page, "frontend/set_user_data");
  await page.evaluate((base) => {
    const h = window.pinsHarness;
    h.failSetAt = base + 1;
    h.failSetAlso = base + 2;
    h.controller.moveHomePin({ kind: "plan", id: "weekend" }, 1);
    h.controller.moveHomePin({ kind: "plan", id: "stale" }, -1);
  }, baseline);
  await expect.poll(() => heldCount(page)).toBe(1);
  await releaseIgnoringFailure(page, 0);
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBe(baseline + 2);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: initial });
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key]?.pins, keyOf("synthetic-entry"))).toEqual(initial);
});

test("interleaved moves on different pins persist in event order when both succeed", async ({ page }) => {
  const initial = [plan("daily"), plan("weekend"), plan("fresh"), plan("stale")];
  const finalOrder = [plan("daily"), plan("fresh"), plan("stale"), plan("weekend")];
  await setup(page, { u1: record(initial) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: initial });
  await hold(page, "frontend/set_user_data");
  await page.evaluate(() => {
    const h = window.pinsHarness;
    h.controller.moveHomePin({ kind: "plan", id: "weekend" }, 1);
    h.controller.moveHomePin({ kind: "plan", id: "stale" }, -1);
  });
  await expect.poll(() => heldCount(page)).toBe(1);
  await release(page, 0);
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key]?.pins, keyOf("synthetic-entry"))).toEqual(finalOrder);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: finalOrder });
});

test("a failed unpin preserves a different pin's queued exclusion", async ({ page }) => {
  await setup(page, { u1: record([plan("daily"), plan("weekend")]) });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily"), plan("weekend")] });
  const baselineWrites = await page.evaluate(() => window.pinsHarness.sets);
  await page.evaluate((baseline) => {
    const h = window.pinsHarness;
    h.failSetAt = baseline + 1;
    for (const pin of [{ kind: "plan", id: "daily" }, { kind: "plan", id: "weekend" }]) {
      const before = h.store.value.homePins.pins;
      h.controller.saveHomePin(pin, false, before);
      h.store.dispatch({ type: "set-home-pin", pin, pinned: false });
    }
  }, baselineWrites);
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBeGreaterThanOrEqual(baselineWrites + 2);
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key]?.excluded ?? [], keyOf("synthetic-entry"))).toContainEqual(plan("weekend"));
  expect(await pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
  expect(await page.evaluate((key) => window.pinsHarness.data.u1[key]?.pins, keyOf("synthetic-entry"))).toEqual([plan("daily")]);
  await page.evaluate(() => {
    const h = window.pinsHarness;
    const reloaded = h.make();
    h.reloaded = reloaded;
    reloaded.sync("u1", "synthetic-entry");
  });
  await expect.poll(() => page.evaluate(() => window.pinsHarness.reloaded.store.value.homePins)).toMatchObject({ status: "ready", pins: [plan("daily")] });
});

test("with no record yet, a plan list that failed first seeds the default plan once it loads", async ({ page }) => {
  await setup(page, { u1: {} });
  await page.evaluate(() => { window.pinsHarness.plansFail = 1; window.pinsHarness.areaIds = []; window.pinsHarness.planIds = []; window.pinsHarness.selectedPlan = null; });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => page.evaluate(() => window.pinsHarness.store.value.resources.plans.status)).toBe("error");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [] });
  expect(await page.evaluate(() => window.pinsHarness.log.filter((call) => call.type === "frontend/set_user_data").length)).toBe(0);
  // The plans come back: the default plan is seeded then, and written.
  const selected = await page.evaluate(async () => {
    const h = window.pinsHarness;
    h.planIds = ["first"];
    h.selectedPlan = "first";
    await h.controller.loadPlans({ force: true });
    return h.store.value.resources.plans.value.selectedPlan;
  });
  expect(selected).toBeTruthy();
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan(selected)] });
  await expect.poll(() => page.evaluate((key) => window.pinsHarness.data.u1[key]?.pins ?? null, keyOf("synthetic-entry"))).toEqual([plan(selected)]);
});

const storedPins = (page, user, entry) => page.evaluate(([user, key]) => window.pinsHarness.data[user]?.[key]?.pins ?? null, [user, keyOf(entry)]);

test("two tabs writing different robots at once keep both robots' shortcuts", async ({ page }) => {
  const a = [plan("daily")];
  const b = [plan("b-plan")];
  await setup(page, { u1: { [keyOf("synthetic-entry")]: { pins: a }, [keyOf("entry-b")]: { pins: b } } });
  await page.evaluate(() => {
    const h = window.pinsHarness;
    h.tabB = h.make();
    h.sync("u1", "synthetic-entry");
    h.tabB.sync("u1", "entry-b");
  });
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: a });
  await expect.poll(() => page.evaluate(() => window.pinsHarness.tabB.store.value.homePins)).toMatchObject({ status: "ready", pins: b });
  // Both tabs pin at once; any read either write makes is held, then answered together.
  await page.evaluate(() => {
    const h = window.pinsHarness;
    h.holdAll = true;
    for (const [tab, id] of [[h, "weekend"], [h.tabB, "b-weekend"]]) {
      const pin = { kind: "plan", id };
      const before = tab.store.value.homePins.pins;
      tab.controller.saveHomePin(pin, true, before);
      tab.store.dispatch({ type: "set-home-pin", pin, pinned: true });
    }
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const h = window.pinsHarness;
    h.holdAll = false;
    for (const held of h.held.splice(0)) held.release();
  });
  await page.waitForTimeout(100);
  expect(await storedPins(page, "u1", "synthetic-entry")).toEqual([plan("daily"), plan("weekend")]);
  expect(await storedPins(page, "u1", "entry-b")).toEqual([plan("b-plan"), plan("b-weekend")]);
});

const setUserDataWrites = (page) => page.evaluate(() => window.pinsHarness.log.filter((call) => call.type === "frontend/set_user_data").length);
const reloadPlans = (page, ids, selected) => page.evaluate(async ([ids, selected]) => {
  const h = window.pinsHarness;
  h.planIds = ids;
  h.selectedPlan = selected;
  await h.controller.loadPlans({ force: true });
}, [ids, selected]);

test("a user with no plans yet gets the default shortcut once they save their first plan, and after a reload", async ({ page }) => {
  await setup(page, { u1: {} });
  await page.evaluate(() => { window.pinsHarness.planIds = []; window.pinsHarness.areaIds = []; window.pinsHarness.selectedPlan = null; });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [] });
  await page.waitForTimeout(50);
  // No plan, no default: nothing is decided, so no record is written.
  expect(await setUserDataWrites(page)).toBe(0);
  // The first saved plan becomes the default, and with it the first shortcut.
  await reloadPlans(page, ["first"], "first");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("first")] });
  await expect.poll(() => storedPins(page, "u1", "synthetic-entry")).toEqual([plan("first")]);
  // A reload reads that record.
  const reloaded = await page.evaluate(async () => {
    const h = window.pinsHarness;
    const tab = h.make();
    tab.sync("u1", "synthetic-entry");
    for (let i = 0; i < 100 && tab.store.value.homePins.status !== "ready"; i += 1) await new Promise((r) => setTimeout(r, 10));
    return tab.store.value.homePins.pins;
  });
  expect(reloaded).toEqual([plan("first")]);
});

test("returning to the same entry rereads shortcuts and ignores its stale read", async ({ page }) => {
  const saved = [plan("daily"), { kind: "area", id: "entryway" }];
  await setup(page, { u1: record(saved) });
  await hold(page, "frontend/get_user_data");
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => heldCount(page)).toBe(1);

  // An integration reload can temporarily remove the selected entry. The
  // same user and entry may return before the old user-data read settles.
  await page.evaluate(() => { window.pinsHarness.catalogEntries = []; });
  await sync(page, "u1", null);
  await page.evaluate(() => { window.pinsHarness.catalogEntries = null; });
  await hold(page, "frontend/get_user_data");
  await sync(page, "u1", "synthetic-entry");
  // The returning entry is admitted by the catalog poll, which resumes the
  // pinned catalogs and user-data read for the restored owner.
  await page.evaluate(() => window.pinsHarness.controller.refreshCatalog(true));
  await expect.poll(() => heldCount(page)).toBe(2);

  // The result from before the owner loss must not commit. The fresh read for
  // the returned owner restores the same saved pins and explicit exclusions.
  await release(page, 0);
  expect(await pins(page)).toMatchObject({ status: "loading", pins: [] });
  await release(page, 1);
  await expect.poll(() => pins(page)).toEqual({ entry: "synthetic-entry", status: "ready", pins: saved });
  expect(await page.evaluate(() => window.pinsHarness.log.filter((call) => call.type === "frontend/get_user_data").length)).toBe(2);
  expect(await page.evaluate(() => window.pinsHarness.data.u1["matic_robot_home_shortcuts.synthetic-entry"].excluded))
    .toEqual(ALL.filter((pin) => !saved.some((shown) => shown.kind === pin.kind && shown.id === pin.id)));
});

test("with no plans, a reload after the first plan was saved elsewhere seeds it then", async ({ page }) => {
  await setup(page, { u1: {} });
  await page.evaluate(() => { window.pinsHarness.planIds = ["first"]; window.pinsHarness.areaIds = []; window.pinsHarness.selectedPlan = "first"; });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("first")] });
  await expect.poll(() => storedPins(page, "u1", "synthetic-entry")).toEqual([plan("first")]);
});

test("a pin whose plan was deleted leaves home and the record, and the same id coming back is not pinned", async ({ page }) => {
  await setup(page, { u1: { [keyOf("synthetic-entry")]: { version: 2, pins: [plan("daily"), plan("weekend"), plan("ghost")], excluded: ALL.filter((pin) => !["daily", "weekend", "ghost"].includes(pin.id)) } } });
  await sync(page, "u1", "synthetic-entry");
  // "ghost" was deleted before this session (another dashboard, a service call).
  await expect.poll(() => storedPins(page, "u1", "synthetic-entry")).toEqual([plan("daily"), plan("weekend")]);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily"), plan("weekend")] });
  // The default plan is deleted now; another becomes the default, unpinned.
  await reloadPlans(page, ["weekend"], "weekend");
  await expect.poll(() => storedPins(page, "u1", "synthetic-entry")).toEqual([plan("weekend")]);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("weekend")] });
  // A new plan saved under the same name gets the same id; it was never pinned.
  await reloadPlans(page, ["weekend", "daily", "ghost"], "weekend");
  await page.waitForTimeout(50);
  expect(await pins(page)).toMatchObject({ status: "ready", pins: [plan("weekend")] });
  expect(await storedPins(page, "u1", "synthetic-entry")).toEqual([plan("weekend")]);
});

test("a cleanup write that fails is tried once, not on every plan reload", async ({ page }) => {
  await setup(page, { u1: { [keyOf("synthetic-entry")]: { pins: [plan("daily"), plan("ghost")] } } });
  await page.evaluate(() => { window.pinsHarness.failSetAt = 1; });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => page.evaluate(() => window.pinsHarness.sets)).toBe(1);
  await reloadPlans(page, ["daily", "weekend"], "daily");
  await reloadPlans(page, ["daily", "weekend"], "daily");
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.pinsHarness.sets)).toBe(1);
  // Hidden either way: a pin with no plan shows nothing on home.
  expect(await storedPins(page, "u1", "synthetic-entry")).toEqual([plan("daily"), plan("ghost")]);
});

test("a pin whose area was deleted leaves home and the record once the areas load", async ({ page }) => {
  const area = (id) => ({ kind: "area", id });
  await setup(page, { u1: { [keyOf("synthetic-entry")]: { pins: [area("entryway"), area("ghost-area"), plan("daily")] } } });
  await sync(page, "u1", "synthetic-entry");
  await expect.poll(() => storedPins(page, "u1", "synthetic-entry")).toEqual([area("entryway"), plan("daily")]);
  await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [area("entryway"), plan("daily")] });
});

for (const operation of ["frontend/get_user_data", "frontend/set_user_data"]) {
  test(`current ${operation} denial clears private state until an explicit authenticated retry`, async ({ page }) => {
    await setup(page, { u1: record([plan("daily")]) });
    if (operation === "frontend/get_user_data") {
      await page.evaluate(type => window.pinsHarness.denied.add(type), operation);
    }
    await sync(page, "u1", "synthetic-entry");
    if (operation === "frontend/set_user_data") {
      await expect.poll(() => pins(page)).toMatchObject({ status: "ready" });
      await page.evaluate(type => {
        const h = window.pinsHarness;
        h.denied.add(type);
        h.controller.saveHomePin({ kind: "plan", id: "weekend" }, true, h.store.value.homePins.pins);
        h.controller.saveHomePin({ kind: "plan", id: "fresh" }, true, h.store.value.homePins.pins);
      }, operation);
    }
    await expect.poll(() => page.evaluate(() => window.pinsHarness.store.value.resources.catalog.problem)).toBe("access-required");
    expect(await page.evaluate(() => {
      const s = window.pinsHarness.store.value;
      return [s.resources.scene.value, s.resources.plans.value, s.resources.areas.value, s.resources.history.value];
    })).toEqual([null, null, null, null]);
    const calls = await page.evaluate(() => window.pinsHarness.log.length);
    await sync(page, "u1", "synthetic-entry");
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.pinsHarness.log.length)).toBe(calls);
    expect(await page.evaluate(() => window.pinsHarness.store.value.resources.catalog.problem)).toBe("access-required");
    await page.evaluate(async () => {
      const h = window.pinsHarness;
      h.denied.clear();
      await h.controller.executeAction("recheck-status");
    });
    await expect.poll(() => page.evaluate(() => window.pinsHarness.store.value.resources.catalog.status)).toBe("ready");
    await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
    if (operation === "frontend/set_user_data") {
      expect(await page.evaluate(() => window.pinsHarness.log.filter(call => call.type === "frontend/set_user_data").length)).toBe(1);
    }
  });
}

for (const operation of ["frontend/get_user_data", "frontend/set_user_data"]) {
  test(`retired ${operation} denial cannot clear another user's workspace`, async ({ page }) => {
    await setup(page, { u1: record([plan("daily")]), u2: record([plan("u2-plan")]) });
    if (operation === "frontend/get_user_data") await hold(page, operation);
    await sync(page, "u1", "synthetic-entry");
    if (operation === "frontend/set_user_data") {
      await expect.poll(() => pins(page)).toMatchObject({ status: "ready" });
      await hold(page, operation);
      await page.evaluate(() => {
        const h = window.pinsHarness;
        h.controller.saveHomePin({ kind: "plan", id: "weekend" }, true, h.store.value.homePins.pins);
      });
    }
    await expect.poll(() => heldCount(page)).toBe(1);
    await sync(page, "u2", "synthetic-entry");
    await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("u2-plan")] });
    await page.evaluate(() => window.pinsHarness.held[0].deny());
    await page.waitForTimeout(50);
    expect(await pins(page)).toMatchObject({ status: "ready", pins: [plan("u2-plan")] });
    expect(await page.evaluate(() => window.pinsHarness.store.value.resources.catalog.status)).toBe("ready");
  });
}

for (const operation of ["frontend/get_user_data", "frontend/set_user_data"]) {
  test(`a ${operation} denial from before HA reconnect cannot revoke the new session`, async ({ page }) => {
    await setup(page, { u1: record([plan("daily")]) });
    if (operation === "frontend/get_user_data") await hold(page, operation);
    await sync(page, "u1", "synthetic-entry");
    if (operation === "frontend/set_user_data") {
      await expect.poll(() => pins(page)).toMatchObject({ status: "ready" });
      await hold(page, operation);
      await page.evaluate(() => {
        const h = window.pinsHarness;
        h.controller.saveHomePin({ kind: "plan", id: "weekend" }, true, h.store.value.homePins.pins);
      });
    }
    await expect.poll(() => heldCount(page)).toBe(1);
    await page.evaluate(() => window.pinsHarness.sync("u1", "synthetic-entry", false));
    await sync(page, "u1", "synthetic-entry");
    await expect.poll(() => pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
    await page.evaluate(() => window.pinsHarness.held[0].deny());
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.pinsHarness.store.value.resources.catalog.status)).toBe("ready");
    expect(await pins(page)).toMatchObject({ status: "ready", pins: [plan("daily")] });
  });
}
