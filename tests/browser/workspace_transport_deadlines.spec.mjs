import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { WorkspaceTransport } from "./frontend/map-studio-v4/workspace-transport";', resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Workspace deadlines run once in Chromium");
  await page.route("**/workspace-deadlines.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.clock.install();
});

async function start(page, held) {
  await page.evaluate(async held => {
    const { WorkspaceTransport } = await import("/workspace-deadlines.js");
    const events = [], errors = [], callbacks = [];
    let snapshotCalls = 0, subscribeCalls = 0, unsubscribed = 0;
    let resolveSnapshot, resolveSubscribe, rejectSnapshot, rejectSubscribe;
    const snapshot = sequence => ({ schema: 1, capabilities: { snapshot: 1 }, epoch: "epoch-a", sequence,
      coherence_generation: 1, revisions: { workspace: sequence }, entry_id: "entry-a",
      identity: { entry_id: "entry-a", floor_mission_id: null, floor_verified: false },
      status: { state: "ready", reason: null, retryable: false }, payload: { available: true } });
    const connection = {
      sendMessagePromise: async () => {
        snapshotCalls += 1;
        if (held === "snapshot" && snapshotCalls === 1) return await new Promise((resolve, reject) => { resolveSnapshot = resolve; rejectSnapshot = reject; });
        return snapshot(snapshotCalls === 1 ? 0 : 10);
      },
      subscribeMessage: async callback => {
        subscribeCalls += 1;
        callbacks.push(callback);
        if (held === "subscription" && subscribeCalls === 1) return await new Promise((resolve, reject) => { resolveSubscribe = resolve; rejectSubscribe = reject; });
        return () => { unsubscribed += 1; };
      },
    };
    const transport = new WorkspaceTransport(connection, { entryId: "entry-a", onEvent: event => events.push(event), onError: error => errors.push(error.name) });
    const starting = transport.start();
    window.deadlines = { transport, starting, events, errors, callbacks, snapshot,
      lateSnapshot: () => resolveSnapshot(snapshot(0)),
      lateSubscribe: () => resolveSubscribe(() => { unsubscribed += 1; }),
      lateDenial: () => (held === "snapshot" ? rejectSnapshot : rejectSubscribe)({ code: "unauthorized" }),
      get snapshotCalls() { return snapshotCalls; }, get subscribeCalls() { return subscribeCalls; },
      get unsubscribed() { return unsubscribed; } };
  }, held);
  await expect.poll(() => page.evaluate(() => window.deadlines.snapshotCalls)).toBe(1);
  if (held === "subscription") await expect.poll(() => page.evaluate(() => window.deadlines.subscribeCalls)).toBe(1);
}

for (const held of ["snapshot", "subscription"]) {
  for (const retired of [false, true]) {
    test(`late ${held} access denial after deadline respects owner retirement (${retired})`, async ({ page }) => {
      await start(page, held);
      await page.clock.fastForward(10_001);
      await expect.poll(() => page.evaluate(() => window.deadlines.errors.includes("TimeoutError"))).toBe(true);
      await page.evaluate(async retired => {
        const h = window.deadlines;
        if (retired) h.transport.dispose();
        h.lateDenial();
        for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      }, retired);
      expect(await page.evaluate(() => window.deadlines.events.filter(event => event.accessDenied === true).length)).toBe(retired ? 0 : 1);
      await page.evaluate(() => window.deadlines.transport.dispose());
    });
  }

  test(`${held} deadline retains one wire owner and ignores its late completion`, async ({ page }) => {
    await start(page, held);
    await page.clock.fastForward(10_001);
    await expect.poll(() => page.evaluate(() => window.deadlines.errors.includes("TimeoutError"))).toBe(true);
    await page.clock.fastForward(35_000);
    expect(await page.evaluate(held => held === "snapshot" ? window.deadlines.snapshotCalls : window.deadlines.subscribeCalls, held)).toBe(1);
    await page.evaluate(held => {
      const h = window.deadlines;
      if (held === "snapshot") h.lateSnapshot();
      else {
        h.callbacks[0]({ type: "snapshot", snapshot: h.snapshot(999) });
        h.lateSubscribe();
      }
    }, held);
    if (held === "subscription") await expect.poll(() => page.evaluate(() => window.deadlines.unsubscribed)).toBe(1);
    await page.evaluate(() => window.deadlines.transport.notifyReconnect());
    await page.clock.fastForward(1);
    await expect.poll(() => page.evaluate(() => window.deadlines.events.filter(event => event.type === "snapshot").map(event => event.snapshot.sequence)))
      .toEqual(held === "snapshot" ? [10] : [0, 10]);
    await page.evaluate(() => window.deadlines.transport.dispose());
  });

  test(`disposing a pending ${held} settles its wait and retires late callbacks`, async ({ page }) => {
    await start(page, held);
    const before = await page.evaluate(() => window.deadlines.events.length);
    await page.evaluate(async held => {
      const h = window.deadlines;
      h.transport.dispose();
      await h.starting;
      if (held === "snapshot") h.lateSnapshot();
      else {
        h.callbacks[0]({ type: "snapshot", snapshot: h.snapshot(999) });
        h.lateSubscribe();
      }
    }, held);
    await page.clock.fastForward(40_000);
    expect(await page.evaluate(() => window.deadlines.events.length)).toBe(before);
    if (held === "subscription") expect(await page.evaluate(() => window.deadlines.unsubscribed)).toBe(1);
  });
}

test("oversized revision maps are rejected before they become a stream fence", async ({ page }) => {
  await start(page, "snapshot");
  await page.evaluate(() => {
    const h = window.deadlines;
    h.lateSnapshot();
  });
  await expect.poll(() => page.evaluate(() => window.deadlines.subscribeCalls)).toBe(1);
  await page.evaluate(() => {
    const h = window.deadlines;
    h.callbacks[0]({ type: "invalidate", epoch: "epoch-a", sequence: 1, coherence_generation: 1,
      revisions: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`resource-${i}`, 1])), resources: ["plans"] });
  });
  expect(await page.evaluate(() => window.deadlines.events.some(event => event.type === "invalidation"))).toBe(false);
  expect(await page.evaluate(() => window.deadlines.events.some(event => event.type === "resync" && event.reason === "invalid_message"))).toBe(true);
  await page.evaluate(() => window.deadlines.transport.dispose());
});
