import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const fixture = JSON.parse(readFileSync("tests/fixtures/workspace_snapshot_v1.json", "utf8"));
const bundle = await build({
  stdin: {
    contents: 'export { WorkspaceTransport } from "./frontend/map-studio-v4/workspace-transport";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  write: false,
});

test.beforeEach(async ({ browserName, page }) => {
  test.skip(browserName !== "chromium", "Workspace wire contract runs once in Chromium");
  await page.route("**/workspace-wire-contract.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
});

async function consumeSnapshot(page, snapshot) {
  await page.goto("/");
  return page.evaluate(async (candidate) => {
    const { WorkspaceTransport } = await import("/workspace-wire-contract.js");
    const events = [];
    const errors = [];
    const transport = new WorkspaceTransport({
      sendMessagePromise: async () => candidate,
      subscribeMessage: async () => () => {},
    }, {
      entryId: "synthetic-entry",
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error.message),
    });
    await transport.start();
    transport.dispose();
    return { events, errors };
  }, snapshot);
}

test("Python workspace snapshot fixture is admitted by the frontend transport parser", async ({ page }) => {
  const result = await consumeSnapshot(page, fixture);
  expect(result.errors).toEqual([]);
  expect(result.events).toHaveLength(1);
  expect(result.events[0]).toMatchObject({
    type: "snapshot",
    snapshot: {
      entry_id: "synthetic-entry",
      identity: { entry_id: "synthetic-entry", floor_mission_id: 42, floor_verified: true },
      payload: {
        available: true,
        entry: {
          entryId: "synthetic-entry",
          runnerLocked: false,
          activePlan: false,
          nativeReconciliationPending: false,
          mapSessionVerified: true,
          mapSessionKey: "45a72b74293517b688bdc37326e5fed522fdaf097072b3eb6bec130ff726322e",
        },
      },
    },
  });
});

test("frontend transport rejects stale identity and missing required projection fields", async ({ page }) => {
  const staleIdentity = structuredClone(fixture);
  staleIdentity.entry_id = "stale-entry";
  staleIdentity.identity.entry_id = "stale-entry";

  const missingGuard = structuredClone(fixture);
  delete missingGuard.payload.entry.runner_locked;

  for (const candidate of [staleIdentity, missingGuard]) {
    const result = await consumeSnapshot(page, candidate);
    expect(result.events).toEqual([]);
    expect(result.errors).toEqual(["invalid-workspace-snapshot"]);
  }
});
