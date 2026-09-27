import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { WorkspaceTransport } from "./frontend/map-studio-v4/workspace-transport";', resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Workspace protocol contract runs once in Chromium");
});

async function load(page) {
  await page.route("**/workspace-transport.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  return page.evaluate(async () => {
    const { WorkspaceTransport } = await import("/workspace-transport.js");
    const events = [];
    const errors = [];
    let callback;
    let unsubscribed = 0;
    let snapshotResolve;
    let recoverySnapshotResolve;
    let recoverySnapshotReject;
    let snapshotCalls = 0;
    const snapshotCallTimes = [];
    let recoverySnapshot;
    let subscribeCalls = 0;
    let subscribeFailures = 0;
    const replayOnSubscribe = [];
    let snapshotReject;
    let onEventHook = () => {};
    const snapshot = new Promise((resolve, reject) => { snapshotResolve = resolve; snapshotReject = reject; });
    const connection = {
      subscribeMessage: async (cb) => {
        subscribeCalls += 1;
        if (subscribeFailures > 0) { subscribeFailures -= 1; throw new Error("temporary subscribe failure"); }
        callback = cb;
        for (const event of replayOnSubscribe.splice(0)) callback(event);
        return () => { unsubscribed += 1; };
      },
      sendMessagePromise: async () => { snapshotCalls += 1; snapshotCallTimes.push(performance.now()); return snapshotCalls === 1 ? snapshot : recoverySnapshot; },
    };
    const transport = new WorkspaceTransport(connection, { entryId: "synthetic", onEvent: event => { events.push(event); onEventHook(event); }, onError: error => errors.push(error.message), maxPendingInvalidations: 3 });
    window.workspaceHarness = { callback: value => callback(value), events, errors, snapshotResolve,
      rejectInitialSnapshot: error => snapshotReject(error),
      setOnEventHook: hook => { onEventHook = hook; },
      setRecoverySnapshot: value => { recoverySnapshot = value; },
      queueBeforeSubscribe: value => replayOnSubscribe.push(value),
      failNextSubscriptions: count => { subscribeFailures = count; },
      deferRecoverySnapshot: () => { recoverySnapshot = new Promise((resolve, reject) => { recoverySnapshotResolve = resolve; recoverySnapshotReject = reject; }); },
      resolveRecoverySnapshot: value => recoverySnapshotResolve?.(value), transport,
      rejectRecoverySnapshot: error => recoverySnapshotReject?.(error),
      get snapshotCalls() { return snapshotCalls; }, get snapshotCallTimes() { return snapshotCallTimes; }, get subscribeCalls() { return subscribeCalls; }, get unsubscribed() { return unsubscribed; } };
    return true;
  });
}

function versioned(sequence, epoch = "epoch-a") {
  return { schema: 1, capabilities: { snapshot: 1 }, epoch, sequence, coherence_generation: 1, revisions: { workspace: sequence } };
}

function snapshot(sequence = 0, entry_id = "synthetic", epoch = "epoch-a") {
  return { type: "snapshot", ...versioned(sequence, epoch), entry_id,
    identity: { entry_id, floor_mission_id: null, floor_verified: false },
    status: { state: "ready", reason: null, retryable: false }, payload: { available: true } };
}
function invalidate(sequence, resources = ["state"], epoch = "epoch-a") { return { type: "invalidate", ...versioned(sequence, epoch), resources }; }

async function exhaustSnapshotRetries(page) {
  await page.clock.install();
  await page.evaluate(() => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(Promise.reject(new Error("coordinator unavailable")));
    void h.transport.start();
    h.rejectInitialSnapshot(new Error("coordinator unavailable"));
  });
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.errors.length)).toBe(1);
  // Let the rejected read finish its catch/finally path before advancing fake time.
  await page.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
  for (const [delay, expectedCalls] of [[0, 1], [250, 2], [500, 3], [1000, 4], [2000, 5]]) {
    if (delay) await page.clock.fastForward(delay);
    await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(expectedCalls);
    await expect.poll(() => page.evaluate(() => window.workspaceHarness.errors.length)).toBe(expectedCalls);
  }
}

test("snapshot cursor replays updates that land before subscription", async ({ page }) => {
  await load(page);
  await page.evaluate(([value, initialSnapshot]) => {
    const h = window.workspaceHarness;
    h.queueBeforeSubscribe(value);
    h.transport.start();
    h.snapshotResolve(initialSnapshot);
  }, [invalidate(1), snapshot(0)]);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.map(event => event.type))).toEqual(["snapshot", "invalidation"]);
  expect(await page.evaluate(() => window.workspaceHarness.events[1].invalidation.sequence)).toBe(1);
});

test("rejects duplicates and stale events, and requests recovery for gaps and epochs", async ({ page }) => {
  await load(page);
  await page.evaluate(async value => { const p = window.workspaceHarness.transport.start(); window.workspaceHarness.snapshotResolve(value); await p; }, snapshot(2));
  await page.evaluate(values => {
    const h = window.workspaceHarness;
    for (const value of values) h.callback(value);
  }, [invalidate(2), invalidate(4), invalidate(5, ["pose"], "epoch-b")]);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("gap");
  expect(await page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "invalidation").length)).toBe(0);
});

for (const firstResources of [["plans", "areas"], ["areas", "plans"]]) {
  test(`coalesces resource updates with the newest revision fence (${firstResources.join(", ")})`, async ({ page }) => {
    await load(page);
    await page.evaluate(async value => {
      const p = window.workspaceHarness.transport.start();
      window.workspaceHarness.snapshotResolve(value);
      await p;
    }, snapshot(0));

    const result = await page.evaluate(async firstResources => {
      const h = window.workspaceHarness;
      const emit = (sequence, resources, revisions) => h.callback({
        type: "invalidate", schema: 1, capabilities: { snapshot: 1 }, epoch: "epoch-a",
        sequence, coherence_generation: 1, revisions, resources,
      });
      const flush = () => new Promise(resolve => queueMicrotask(resolve));

      // The second `plans` update overwrites that key without moving it in
      // Map order. The resulting aggregate must still carry sequence 2.
      emit(1, firstResources, { plans: 1, areas: 1 });
      emit(2, ["plans"], { plans: 2, areas: 1 });
      await flush();
      const first = h.events.filter(event => event.type === "invalidation").map(event => ({
        ...event.invalidation, resources: [...event.invalidation.resources].sort(),
      }));

      // Duplicates and stale events cannot produce another aggregate or
      // regress the cursor after the coalesced sequence was emitted.
      emit(2, ["history"], { plans: 2, areas: 1, history: 2 });
      emit(1, ["history"], { plans: 1, areas: 1, history: 1 });
      await flush();
      const afterStale = h.events.filter(event => event.type === "invalidation").length;

      // A three-sequence overlap checks that unioning resources still uses
      // the complete revision fence from the greatest accepted sequence.
      emit(3, ["plans", "history"], { plans: 3, areas: 1, history: 3 });
      emit(4, ["areas"], { plans: 3, areas: 4, history: 3 });
      emit(5, ["history"], { plans: 3, areas: 4, history: 5 });
      await flush();
      const all = h.events.filter(event => event.type === "invalidation").map(event => ({
        ...event.invalidation, resources: [...event.invalidation.resources].sort(),
      }));
      h.transport.dispose();
      return { first, afterStale, all };
    }, firstResources);

    expect(result.first).toEqual([{
      epoch: "epoch-a", sequence: 2, coherence_generation: 1,
      revisions: { plans: 2, areas: 1 }, resources: ["areas", "plans"],
    }]);
    expect(result.afterStale).toBe(1);
    expect(result.all[1]).toEqual({
      epoch: "epoch-a", sequence: 5, coherence_generation: 1,
      revisions: { plans: 3, areas: 4, history: 5 },
      resources: ["areas", "history", "plans"],
    });
  });
}

test("a wrong-entry subscription snapshot cannot poison the active entry cursor", async ({ page }) => {
  await load(page);
  await page.evaluate(async value => { const p = window.workspaceHarness.transport.start(); window.workspaceHarness.snapshotResolve(value); await p; }, snapshot(0));
  await page.evaluate(([recovery, invalid]) => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(recovery);
    h.callback(invalid);
  }, [snapshot(0), snapshot(100, "other-entry", "other-epoch")]);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("invalid_message");
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.evaluate(value => window.workspaceHarness.callback(value), invalidate(1));
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "invalidation").map(event => event.invalidation.sequence))).toEqual([1]);
});

test("subscription snapshots cannot switch epochs without a fresh read", async ({ page }) => {
  await load(page);
  await page.evaluate(async value => { const p = window.workspaceHarness.transport.start(); window.workspaceHarness.snapshotResolve(value); await p; }, snapshot(0));
  await page.evaluate(([recovery, invalid]) => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(recovery);
    h.callback(invalid);
  }, [snapshot(0, "synthetic", "epoch-b"), snapshot(90, "synthetic", "epoch-b")]);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.evaluate(([recovery, invalid]) => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(recovery);
    h.callback(invalid);
  }, [snapshot(0, "synthetic", "epoch-b"), snapshot(99, "synthetic", "epoch-a")]);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(3);
  await page.evaluate(value => window.workspaceHarness.callback(value), invalidate(1, ["scene"], "epoch-b"));
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "invalidation").map(event => event.invalidation.epoch))).toEqual(["epoch-b"]);
  expect(await page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").map(event => event.snapshot.epoch))).toEqual(["epoch-a", "epoch-b", "epoch-b"]);
});

test("recovers a sequence gap from a fresh snapshot and replays racing updates", async ({ page }) => {
  await load(page);
  await page.evaluate(async value => { const p = window.workspaceHarness.transport.start(); window.workspaceHarness.snapshotResolve(value); await p; }, snapshot(0));
  await page.evaluate(value => {
    const h = window.workspaceHarness;
    h.deferRecoverySnapshot();
    h.callback(value);
  }, { type: "invalidate", ...versioned(2), resources: ["state"] });
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.evaluate(value => window.workspaceHarness.callback(value), invalidate(3, ["pose"]));
  await page.evaluate(value => window.workspaceHarness.resolveRecoverySnapshot(value), snapshot(1));
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "invalidation").map(event => event.invalidation))).toMatchObject([
    { sequence: 3, resources: ["state", "pose"] },
  ]);
  expect(await page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").map(event => event.snapshot.sequence))).toEqual([0, 1]);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
});

test("authorization failure stops snapshot retries", async ({ page }) => {
  await load(page);
  await page.evaluate(async value => { const p = window.workspaceHarness.transport.start(); window.workspaceHarness.snapshotResolve(value); await p; }, snapshot(0));
  await page.evaluate(() => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(Promise.reject(Object.assign(new Error("denied"), { code: "unauthorized" })));
    h.callback({ type: "invalidate", schema: 1, capabilities: { snapshot: 1 }, epoch: "epoch-a", sequence: 2,
      coherence_generation: 1, revisions: { workspace: 2 }, resources: ["state"] });
  });
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("authorization");
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
});

test("explicit resync gets one immediate attempt without bypassing steady backoff", async ({ page }) => {
  await load(page);
  await exhaustSnapshotRetries(page);
  await page.evaluate(() => window.workspaceHarness.transport.requestResync("restart"));
  await page.clock.fastForward(0);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(6);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.errors.length)).toBe(6);
  await page.evaluate(() => window.workspaceHarness.transport.requestResync("server_request"));
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(6);
  await page.clock.fastForward(30_000);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(7);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("subscription authorization cancels delayed recovery until reconnect", async ({ page }) => {
  await load(page);
  await exhaustSnapshotRetries(page);
  await page.evaluate(() => {
    const h = window.workspaceHarness;
    h.transport.requestResync("server_request");
    h.callback({ type: "resync", reason: "authorization" });
  });
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("authorization");
  await page.clock.fastForward(30_000);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(5);

  await page.evaluate(value => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(value);
    h.transport.notifyReconnect();
  }, snapshot(6));
  await page.clock.fastForward(0);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(6);
  expect(await page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").map(event => event.snapshot.sequence))).toEqual([6]);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("authorization invalidates an in-flight snapshot across reconnect", async ({ page }) => {
  await load(page);
  await page.clock.install();
  await page.evaluate(async ([value, gap]) => {
    const h = window.workspaceHarness;
    const start = h.transport.start();
    h.snapshotResolve(value);
    await start;
    h.deferRecoverySnapshot();
    h.callback(gap);
  }, [snapshot(0), invalidate(2)]);
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.evaluate(() => window.workspaceHarness.callback({ type: "resync", reason: "authorization" }));
  await page.evaluate(value => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(value);
    h.transport.notifyReconnect();
  }, snapshot(2));
  await page.evaluate(value => window.workspaceHarness.resolveRecoverySnapshot(value), snapshot(1));
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").map(event => event.snapshot.sequence))).toEqual([0, 2]);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(3);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("explicit resync requests coalesce with the snapshot already in flight", async ({ page }) => {
  await load(page);
  await page.clock.install();
  await page.evaluate(async ([initialSnapshot, gap]) => {
    const h = window.workspaceHarness;
    const start = h.transport.start();
    h.snapshotResolve(initialSnapshot);
    await start;
    h.deferRecoverySnapshot();
    h.callback(gap);
  }, [snapshot(0), invalidate(2)]);
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.evaluate(() => {
    const h = window.workspaceHarness;
    h.transport.requestResync("restart");
    h.transport.requestResync("server_request");
  });
  await page.evaluate(value => window.workspaceHarness.resolveRecoverySnapshot(value), snapshot(2));
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  expect(await page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").map(event => event.snapshot.sequence))).toEqual([0, 2]);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("explicit resync keeps its immediate retry when the in-flight read fails", async ({ page }) => {
  await load(page);
  await exhaustSnapshotRetries(page);
  await page.evaluate(() => window.workspaceHarness.deferRecoverySnapshot());
  await page.clock.fastForward(30_000);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(6);

  await page.evaluate(() => {
    const h = window.workspaceHarness;
    h.transport.requestResync("restart");
    h.rejectRecoverySnapshot(new Error("coordinator unavailable"));
  });
  await page.clock.fastForward(0);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(7);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("explicit resync stays immediate when its in-flight snapshot is stale", async ({ page }) => {
  await load(page);
  await page.clock.install();
  await page.evaluate(async ([initialSnapshot, firstInvalidation, gap]) => {
    const h = window.workspaceHarness;
    const start = h.transport.start();
    h.snapshotResolve(initialSnapshot);
    await start;
    h.callback(firstInvalidation);
    h.deferRecoverySnapshot();
    h.callback(gap);
  }, [snapshot(0), invalidate(1), invalidate(3)]);
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);

  await page.evaluate(value => {
    const h = window.workspaceHarness;
    h.transport.requestResync("restart");
    h.resolveRecoverySnapshot(value);
  }, snapshot(0));
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(3);
  expect(await page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("snapshot_required");
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("semantic snapshot rejection uses bounded retry instead of an immediate loop", async ({ page }) => {
  await load(page);
  await page.clock.install();
  await page.evaluate(async ([value, initialSnapshot]) => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(value);
    h.setOnEventHook(event => {
      if (event.type === "snapshot") h.transport.requestResync("restart");
    });
    const start = h.transport.start();
    h.snapshotResolve(initialSnapshot);
    await start;
  }, [snapshot(1), snapshot(0)]);
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.clock.fastForward(30);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

for (const authorizationSource of ["snapshot", "transport error"]) {
  test(`authorization after overflow clears deferred recovery from a ${authorizationSource}`, async ({ page }) => {
    await load(page);
    await page.clock.install();
    await page.evaluate(async ([initialSnapshot, gap]) => {
      const h = window.workspaceHarness;
      const start = h.transport.start();
      h.snapshotResolve(initialSnapshot);
      await start;
      h.deferRecoverySnapshot();
      h.callback(gap);
    }, [snapshot(0), invalidate(2)]);
    await page.clock.fastForward(0);
    expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
    await page.evaluate(values => {
      for (const value of values) window.workspaceHarness.callback(value);
    }, [3, 4, 5, 6].map(sequence => invalidate(sequence)));
    await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("overflow");

    if (authorizationSource === "snapshot") {
      await page.evaluate(value => window.workspaceHarness.resolveRecoverySnapshot(value), {
        ...snapshot(0), status: { state: "unavailable", reason: "authorization", retryable: false },
        payload: { available: false },
      });
      await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").at(-1)?.snapshot.status.reason)).toBe("authorization");
    } else {
      await page.evaluate(() => window.workspaceHarness.rejectRecoverySnapshot(Object.assign(new Error("denied"), { code: "unauthorized" })));
      await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("authorization");
    }

    await page.clock.fastForward(0);
    expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
    await page.evaluate(value => {
      const h = window.workspaceHarness;
      h.setRecoverySnapshot(value);
      h.transport.notifyReconnect();
    }, snapshot(6));
    await page.clock.fastForward(0);
    await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").length)).toBe(authorizationSource === "snapshot" ? 3 : 2);
    await page.clock.fastForward(0);
    expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(3);
    await page.evaluate(() => window.workspaceHarness.transport.dispose());
  });
}

test("authorization cancels capped overflow recovery and clears its marker", async ({ page }) => {
  await load(page);
  await exhaustSnapshotRetries(page);
  await page.evaluate(() => window.workspaceHarness.deferRecoverySnapshot());
  await page.clock.fastForward(30_000);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(6);

  await page.evaluate(values => {
    for (const value of values) window.workspaceHarness.callback(value);
  }, [1, 2, 3, 4].map(sequence => invalidate(sequence)));
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("overflow");
  await page.evaluate(() => window.workspaceHarness.rejectRecoverySnapshot(Object.assign(new Error("denied"), { code: "unauthorized" })));
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("authorization");

  await page.clock.fastForward(30_000);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(6);
  await page.evaluate(value => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(value);
    h.transport.notifyReconnect();
  }, snapshot(6));
  await page.clock.fastForward(0);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").map(event => event.snapshot.sequence))).toEqual([6]);
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(7);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("snapshot recovery continues at a bounded interval after its retry budget", async ({ page }) => {
  await load(page);
  await exhaustSnapshotRetries(page);
  await page.evaluate(value => window.workspaceHarness.callback(value), invalidate(1));

  await page.clock.fastForward(28_000);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(5);
  await page.clock.fastForward(2_000);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(6);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.errors.length)).toBe(6);

  await page.evaluate(value => window.workspaceHarness.setRecoverySnapshot(value), snapshot(1));
  await page.clock.fastForward(28_000);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(6);
  await page.clock.fastForward(2_000);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(7);
  expect(await page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").map(event => event.snapshot.sequence))).toEqual([1]);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("overflow during every failed snapshot cannot bypass retry backoff", async ({ page }) => {
  await load(page);
  await page.clock.install();
  await page.evaluate(async ([initialSnapshot, gap]) => {
    const h = window.workspaceHarness;
    const start = h.transport.start();
    h.snapshotResolve(initialSnapshot);
    await start;
    h.deferRecoverySnapshot();
    h.callback(gap);
  }, [snapshot(0), invalidate(2)]);
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);

  const failWithOverflow = async (call, firstSequence) => {
    await page.evaluate(values => values.forEach(value => window.workspaceHarness.callback(value)),
      Array.from({ length: 4 }, (_, index) => invalidate(firstSequence + index)));
    await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("overflow");
    await page.evaluate(() => window.workspaceHarness.rejectRecoverySnapshot(new Error("temporary snapshot failure")));
    await expect.poll(() => page.evaluate(() => window.workspaceHarness.errors.length)).toBe(call - 1);
    await page.clock.fastForward(0);
    expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(call);
  };
  await failWithOverflow(2, 3);

  for (const [delay, call, firstSequence] of [[250, 3, 7], [500, 4, 11], [1000, 5, 15], [2000, 6, 19]]) {
    await page.evaluate(() => window.workspaceHarness.deferRecoverySnapshot());
    await page.clock.fastForward(delay);
    expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(call);
    await failWithOverflow(call, firstSequence);
  }

  const lastFailureTime = await page.evaluate(() => window.workspaceHarness.snapshotCallTimes[5]);
  await page.clock.fastForward(29_999);
  const callTimes = await page.evaluate(() => window.workspaceHarness.snapshotCallTimes);
  expect(callTimes[6] - lastFailureTime).toBeGreaterThanOrEqual(30_000);
  await page.clock.fastForward(1);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(7);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("overflow cannot bypass the bounded retry interval, while reconnect starts recovery immediately", async ({ page }) => {
  await load(page);
  await exhaustSnapshotRetries(page);
  await page.evaluate(values => {
    const h = window.workspaceHarness;
    for (const value of values) h.callback(value);
  }, Array.from({ length: 65 }, (_, index) => invalidate(index + 1)));
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(5);
  await page.evaluate(value => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(value);
    for (let attempt = 0; attempt < 5; attempt++) h.transport.notifyReconnect();
  }, snapshot(65));
  await page.clock.fastForward(0);
  // One snapshot restores the cursor; the overflow flag schedules one more
  // snapshot to close the gap caused by the discarded invalidation buffer.
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(7);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").map(event => event.snapshot.sequence))).toContain(65);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("reconnect burst during an active read coalesces to one follow-up snapshot", async ({ page }) => {
  await load(page);
  await page.clock.install();
  await page.evaluate(async initialSnapshot => {
    const h = window.workspaceHarness;
    const start = h.transport.start();
    h.snapshotResolve(initialSnapshot);
    await start;
    h.deferRecoverySnapshot();
    h.transport.notifyReconnect();
  }, snapshot(0));
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);

  await page.evaluate(recoverySnapshot => {
    const h = window.workspaceHarness;
    for (let attempt = 0; attempt < 5; attempt++) h.transport.notifyReconnect();
    h.resolveRecoverySnapshot(recoverySnapshot);
  }, snapshot(1));
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").length)).toBe(3);
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(3);
  await page.clock.fastForward(0);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(3);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
});

test("transient subscription failure retries after the initial snapshot", async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const h = window.workspaceHarness;
    h.failNextSubscriptions(1);
    h.snapshotResolve({ type: "snapshot", schema: 1, capabilities: { snapshot: 1 }, epoch: "epoch-a", sequence: 0,
      coherence_generation: 1, revisions: { workspace: 0 }, entry_id: "synthetic",
      identity: { entry_id: "synthetic", floor_mission_id: null, floor_verified: false },
      status: { state: "ready", reason: null, retryable: false }, payload: { available: true } });
    void h.transport.start();
  });
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "snapshot").length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.subscribeCalls)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.evaluate(() => window.workspaceHarness.callback({ type: "invalidate", schema: 1, capabilities: { snapshot: 1 },
    epoch: "epoch-a", sequence: 1, coherence_generation: 1, revisions: { workspace: 1 }, resources: ["status"] }));
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "invalidation").length)).toBe(1);
  expect(await page.evaluate(() => ({ subscribeCalls: window.workspaceHarness.subscribeCalls,
    snapshotCalls: window.workspaceHarness.snapshotCalls }))).toEqual({ subscribeCalls: 2, snapshotCalls: 2 });
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
  expect(await page.evaluate(() => window.workspaceHarness.unsubscribed)).toBe(1);
});

test("dispose cancels a scheduled snapshot retry", async ({ page }) => {
  await load(page);
  await page.evaluate(async value => { const p = window.workspaceHarness.transport.start(); window.workspaceHarness.snapshotResolve(value); await p; }, snapshot(0));
  await page.evaluate(() => {
    const h = window.workspaceHarness;
    h.setRecoverySnapshot(Promise.reject(new Error("temporary failure")));
    h.callback({ type: "invalidate", schema: 1, capabilities: { snapshot: 1 }, epoch: "epoch-a", sequence: 2,
      coherence_generation: 1, revisions: { workspace: 2 }, resources: ["state"] });
  });
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  await page.waitForTimeout(50);
  await page.evaluate(() => window.workspaceHarness.transport.dispose());
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.workspaceHarness.snapshotCalls)).toBe(2);
  expect(await page.evaluate(() => window.workspaceHarness.unsubscribed)).toBe(1);
});

test("handles malformed messages, bounded overflow, reconnect, and idempotent disposal", async ({ page }) => {
  await load(page);
  await page.evaluate(async value => { const p = window.workspaceHarness.transport.start(); window.workspaceHarness.snapshotResolve(value); await p; }, snapshot(0));
  await page.evaluate(values => { for (const value of values) window.workspaceHarness.callback(value); }, [
    invalidate(1, ["a"]), invalidate(2, ["b"]), invalidate(3, ["c"]), invalidate(4, ["d"]),
  ]);
  await expect.poll(() => page.evaluate(() => window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason))).toContain("overflow");
  await page.evaluate(value => window.workspaceHarness.callback(value), { ...snapshot(0), identity: { entry_id: "other", floor_mission_id: null, floor_verified: true } });
  await page.evaluate(values => { for (const value of values) window.workspaceHarness.callback(value); }, [
    { ...snapshot(0), status: { state: "ready", reason: "gap", retryable: false } },
    { ...snapshot(0), status: { state: "stale", reason: "gap", retryable: false }, payload: { available: true } },
  ]);
  await page.evaluate(() => {
    const h = window.workspaceHarness;
    h.callback({ type: "invalidate", schema: 1, epoch: "epoch-a", sequence: 1, coherence_generation: 1, revisions: {}, resources: ["a"] });
    h.callback({ type: "invalid", private_data: "must not be logged" });
  });
  await page.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
  await page.evaluate(() => { window.workspaceHarness.transport.notifyReconnect(); window.workspaceHarness.transport.dispose(); window.workspaceHarness.transport.dispose(); });
  const result = await page.evaluate(() => ({ reasons: window.workspaceHarness.events.filter(event => event.type === "resync").map(event => event.reason), unsubscribed: window.workspaceHarness.unsubscribed }));
  expect(result.reasons).toEqual(expect.arrayContaining(["invalid_message", "reconnect"]));
  expect(result.unsubscribed).toBe(1);
});
