import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("a docked robot never reuses the previous clean position as its current position", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { initialWorkspaceState, WorkspaceStore } from "./frontend/map-studio-v4/state"; export { describeMap } from "./frontend/map-studio-v4/map-canvas"; export { RunHistoryResources } from "./frontend/map-studio-v4/run-history-resources"; export { ResourceRequests } from "./frontend/map-studio-v4/resource-requests";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/dock-position.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { initialWorkspaceState, WorkspaceStore, describeMap, RunHistoryResources, ResourceRequests } = await import("/dock-position.js");
    const base = initialWorkspaceState();
    const state = {
      ...base,
      activity: "docked",
      dataMode: "live",
      coherence: "current",
      selection: { ...base.selection, entryId: "entry", floorId: "current" },
      map: { ...base.map, available: true, floorCoherent: true, sessionVerified: true, exactPose: false },
      host: { ...base.host, connected: true, administrator: true, robotConnected: true },
      seen: { entryId: "entry", mapSessionKey: "a".repeat(64), position: [9, 9] },
      resources: {
        ...base.resources,
        entry: { entryId: "entry", mapSessionKey: "a".repeat(64), mapFloorCoherent: true, mapSessionVerified: true },
      },
    };
    const reads = [];
    const resources = new RunHistoryResources(new WorkspaceStore(state), { runs: async () => {
      reads.push("history");
      return { runs: [] };
    } }, new ResourceRequests(), { disposed: () => false, pageActive: () => true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const result = { description: describeMap(state), reads };
    resources.dispose();
    return result;
  });
  expect(result.description).toContain("The robot is docked.");
  expect(result.description).toContain("location on this floor is unknown");
  expect(result.description).not.toContain("Last clean");
  expect(result.description).not.toContain("last seen");
  expect(result.reads).toEqual([]);
});

test("a fresh map-bound live pose remains the only source of current robot position", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { initialWorkspaceState } from "./frontend/map-studio-v4/state"; export { describeMap } from "./frontend/map-studio-v4/map-canvas";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/verified-position.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { initialWorkspaceState, describeMap } = await import("/verified-position.js");
    const base = initialWorkspaceState();
    const session = "b".repeat(64);
    const state = {
      ...base,
      activity: "cleaning",
      dataMode: "live",
      coherence: "current",
      selection: { ...base.selection, entryId: "entry", floorId: "current" },
      map: { ...base.map, available: true, floorCoherent: true, sessionVerified: true, exactPose: true },
      host: { ...base.host, connected: true, administrator: true, robotConnected: true },
      seen: { entryId: "entry", mapSessionKey: session, position: [9, 9] },
      resources: {
        ...base.resources,
        entry: { entryId: "entry", mapSessionKey: session, mapFloorCoherent: true, mapSessionVerified: true },
        pose: { status: "ready", problem: null, value: { position: [1, 2], mapSessionKey: session,
          freshness: "live", floorCoherent: true } },
      },
    };
    return describeMap(state);
  });
  expect(result).toContain("position is confirmed");
  expect(result).not.toContain("Last clean");
});
