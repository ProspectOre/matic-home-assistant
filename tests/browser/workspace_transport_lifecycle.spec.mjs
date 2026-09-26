import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state";', resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Workspace lifecycle runs once in Chromium");
});

test("legacy mode is inert and enabled mode follows admin, entry, and dispose lifecycle", async ({ page }) => {
  await page.route("**/lifecycle.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async () => {
    const { EffectController, WorkspaceStore } = await import("/lifecycle.js");
    const callbacks = [];
    let unsubscribed = 0;
    const connection = {
      subscribeMessage: async callback => { callbacks.push(callback); return () => { unsubscribed += 1; }; },
      sendMessagePromise: async message => ({ schema: 1, capabilities: {}, epoch: "e", sequence: 0, coherence_generation: 1,
        revisions: {}, entry_id: message.entry_id, identity: { entry_id: message.entry_id, floor_mission_id: null, floor_verified: false },
        status: { state: "ready", reason: null, retryable: false }, payload: { available: true } }),
    };
    const projection = entryKey => ({ host: { connected: true, administrator: true, robotConnected: true, robotCount: 1 }, activity: "idle",
      batteryPercent: 50, language: "en", userKey: "u", vacuumEntityId: "vacuum.x", entryKey, robotLabel: "Matic", robots: [{ entryId: entryKey, label: "Matic" }] });
    let catalogCalls = 0;
    const backend = { catalog: async () => { catalogCalls += 1; return []; }, dispose() {} };
    const legacy = new EffectController(new WorkspaceStore(), backend, connection);
    legacy.sync(projection("entry-a"), undefined);
    const legacySubscriptions = callbacks.length;
    legacy.dispose();
    const enabled = new EffectController(new WorkspaceStore(), backend, connection, true);
    enabled.sync(projection("entry-a"), undefined);
    const waitForSubscription = async (index) => {
      for (let attempt = 0; attempt < 20 && typeof callbacks[index] !== "function"; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (typeof callbacks[index] !== "function") throw new Error(`workspace subscription ${index} was not established`);
    };
    await waitForSubscription(0);
    const first = callbacks.length;
    const baselineCatalogCalls = catalogCalls;
    callbacks[0]({ type: "invalidate", ...({ schema: 1, capabilities: {}, epoch: "e", sequence: 1, coherence_generation: 1, revisions: { status: 1 }, resources: ["status"] }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterInvalidation = catalogCalls;
    enabled.sync(projection("entry-b"), undefined);
    await waitForSubscription(1);
    const afterEntryChange = { subscriptions: callbacks.length, unsubscribed };
    callbacks[1]({ type: "resync", reason: "entry_removed" });
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterEntryRemoved = unsubscribed;
    enabled.sync(projection("entry-c"), undefined);
    await waitForSubscription(2);
    const afterEntryRemovedReplacement = callbacks.length;
    enabled.sync({ ...projection("entry-c"), host: { ...projection("entry-c").host, administrator: false } }, undefined);
    const afterAuthorizationLoss = unsubscribed;
    enabled.sync({ ...projection("entry-c"), host: { ...projection("entry-c").host, connected: false } }, undefined);
    const afterDisconnect = unsubscribed;
    enabled.dispose(); enabled.dispose();
    window.lifecycleResult = { legacySubscriptions, first, baselineCatalogCalls, afterInvalidation, afterEntryChange, afterEntryRemoved, afterEntryRemovedReplacement, afterAuthorizationLoss, afterDisconnect, unsubscribed };
  });
  await expect.poll(() => page.evaluate(() => window.lifecycleResult)).toMatchObject({
    legacySubscriptions: 0,
    first: 1,
    afterEntryChange: { subscriptions: 2, unsubscribed: 1 },
    afterEntryRemoved: 2,
    afterEntryRemovedReplacement: 3,
    afterAuthorizationLoss: 3,
    afterDisconnect: 3,
    unsubscribed: 3,
  });
  const lifecycle = await page.evaluate(() => window.lifecycleResult);
  expect(lifecycle.afterInvalidation).toBe(lifecycle.baselineCatalogCalls);
});
