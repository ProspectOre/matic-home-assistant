import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

// The live trail the browser grows between reads, held to the cases the
// server's recorder is (tests/test_trail_path.py), and how it is drawn.
const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/trail_path_v1.json", import.meta.url), "utf8"));
const HARNESS = "/trail-path-test.js";

test.beforeEach(async ({ page }) => {
  const bundle = await build({ stdin: { contents: `
    export { extendLiveTrail } from "./frontend/map-studio-v4/run-history-data";
    export { chevrons, overlayShapes } from "./frontend/map-studio-v4/overlay-shapes";
    export { WorkspaceStore } from "./frontend/map-studio-v4/state";
    export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";
  `, resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route(`**${HARNESS}`, (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

// Feeds poses to a cleaning robot's live trail; returns its segments and the shapes drawn for them.
const record = (page, poses, segments = [[]]) => page.evaluate(async ([harness, poses, segments]) => {
  const { WorkspaceStore, createGalleryState, extendLiveTrail, chevrons, overlayShapes } = await import(harness);
  const ready = createGalleryState("ready");
  const key = ready.resources.entry.mapSessionKey;
  const store = new WorkspaceStore({ ...ready, activity: "cleaning", trail: { id: "live", mapSessionKey: key, segments } });
  for (const [x, y, observedAt] of poses) {
    extendLiveTrail(store, { ...ready.resources.pose.value, mapSessionKey: key, position: [x, y], observedAt });
  }
  const scene = { metadata: { metersPerCell: 0.1, origin: [0, 0], span: [41, 41], rooms: [] } };
  const palette = { accent: [6, 120, 206], onAccent: [255, 255, 255], text: [38, 50, 56], quiet: [75, 92, 105],
    plate: [250, 252, 253], roomFill: [231, 238, 242], forced: false };
  const [stroke] = overlayShapes(scene, { ...store.value, labelsVisible: false, view: "top", workflow: "home",
    dataMode: "live", selection: { ...store.value.selection, floorId: "current", roomIds: [] } }, palette);
  const recorded = store.value.trail.segments;
  return { segments: recorded, lines: stroke?.rings.map((ring) => ring.length / 2) ?? [],
    // Each segment drawn whole: its points, then a three-point ring per chevron.
    whole: recorded.filter((segment) => segment.length).flatMap((segment) => [segment.length, ...chevrons(segment).map(() => 3)]) };
}, [HARNESS, poses, segments]);

for (const { name, poses, segments } of FIXTURE.record) {
  test(`the live trail ${name}`, async ({ page }) => {
    const result = await record(page, poses);
    expect(result.segments).toEqual(segments);
    expect(result.lines).toEqual(result.whole);
  });
}

test("a full live trail thins to its shape and keeps the far end of a retraced pass", async ({ page }) => {
  // 4,000 points out 400 m along a line and back, then one more.
  const out = Array.from({ length: 2_000 }, (_, index) => [index / 5, 0]);
  const full = [...out, ...out.slice(0, -1).reverse(), [-0.2, 0]];
  const { segments } = await record(page, [[-0.4, 0, null]], [full]);
  expect(segments).toHaveLength(1);
  const [points] = segments;
  expect(points.length).toBeLessThanOrEqual(2_001);
  expect(points[0]).toEqual([0, 0]);
  expect(points).toContainEqual([399.8, 0]);
  expect(points.at(-1)).toEqual([-0.4, 0]);
});

test("a straight stretch the trail thinned stays drawn, and segments stay apart", async ({ page }) => {
  const { lines, whole } = await record(page, [], [[[0, 0], [2.5, 0]], [[3.6, 0]]]);
  // The 2.5 m line with its two chevrons, then the lone point as a dot.
  expect(lines).toEqual([2, 3, 3, 1]);
  expect(whole).toEqual(lines);
});
