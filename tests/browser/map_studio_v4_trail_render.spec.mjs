import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("travel path preserves observed steps and only connects points within each recorded segment", async ({ page }) => {
  const bundle = await build({
    stdin: { contents: 'export { drawRunTrail } from "./frontend/map-studio-v4/renderer-layers";', resolveDir: process.cwd() },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/trail-render.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { drawRunTrail } = await import("/trail-render.js");
    const path = [], strokes = [], dots = [];
    const context = {
      beginPath() {}, save() {}, restore() {},
      moveTo(x, y) { path.push(["move", x, y]); },
      lineTo(x, y) { path.push(["line", x, y]); },
      arc(x, y, radius) { dots.push([x, y, radius]); },
      stroke() { strokes.push({ width: this.lineWidth, colour: this.strokeStyle }); },
      fill() {},
    };
    const state = { dataMode: "live", workflow: "none", resources: { entry: { mapSessionKey: "frame" } },
      trail: { id: "live", mapSessionKey: "frame", segments: [
        [[0, 0], [0.4, 0.1], [1.2, 0], [2.4, 0]],
        [[3, 0], [3.4, 0.2]],
        // Legacy saved segments retain their original observations without bridging.
        [[6, 0], [6.4, 0.2], [7.2, 0]],
      ] } };
    const palette = { accent: [6, 120, 206], onAccent: [255, 255, 255] };
    drawRunTrail(context, state, palette, (x, y) => ({ x, y }));
    return { path, strokes, dots };
  });
  expect(result.path).toEqual([
    ["move", 0, 0], ["line", 0.4, 0.1], ["line", 1.2, 0], ["line", 2.4, 0],
    ["move", 3, 0], ["line", 3.4, 0.2],
    ["move", 6, 0], ["line", 6.4, 0.2], ["line", 7.2, 0],
  ]);
  expect(result.path.filter(([kind]) => kind === "line").map(([, x]) => x)).not.toContain(3);
  expect(result.dots).toEqual([]);
  expect(result.strokes).toEqual([
    { width: 4, colour: "rgba(255,255,255,1)" },
    { width: 2, colour: "rgba(6,120,206,1)" },
  ]);
});

test("migrated trails retain every section and the original aggregate point bound", async ({ page }) => {
  const bundle = await build({ stdin: { contents: `
    export { drawRunTrail } from "./frontend/map-studio-v4/renderer-layers";
    export { parseRunTrail, extendLiveTrail } from "./frontend/map-studio-v4/run-history-data";
    export { parsePose } from "./frontend/map-studio-v4/pose-contract";
  `, resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/migrated-trail.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { drawRunTrail, parseRunTrail, extendLiveTrail, parsePose } = await import("/migrated-trail.js");
    const key = "a".repeat(64);
    const sections = Array.from({ length: 12 }, (_, index) => [[index * 2, 0], [index * 2 + 0.4, 0]]);
    const payload = segments => ({ trail: "live", map_session_key: key, segments });
    const trail = parseRunTrail(payload(sections));
    const path = [];
    const context = { beginPath() {}, save() {}, restore() {},
      moveTo(x, y) { path.push(["move", x, y]); }, lineTo(x, y) { path.push(["line", x, y]); },
      stroke() {}, fill() {}, arc() {} };
    drawRunTrail(context, { dataMode: "live", workflow: "none", trail, resources: { entry: { mapSessionKey: key } } },
      { accent: [6, 120, 206], onAccent: [255, 255, 255] }, (x, y) => ({ x, y }));
    const store = { value: { activity: "cleaning", generation: 1, selection: { entryId: "robot" }, trail },
      patch(change) { this.value = { ...this.value, ...change }; } };
    const observe = (x, timestamp, frame = "b") => extendLiveTrail(store, parsePose({
      position: [x, 0], source: "exact_pose", revision: 1, pose_revision: timestamp,
      map_floor_coherent: true, map_session_key: key, pose_freshness: "live",
      pose_age_seconds: 0, pose_measured_at: timestamp, pose_frame_key: frame.repeat(64),
    }));
    observe(24, 100);
    observe(24.3, 101);
    observe(24.31, 102, "c"); // A -> B -> A occurred between browser reads.
    store.value.generation += 1;
    observe(24.32, 103, "c"); // A browser-side proof revocation is also a break.
    const continued = store.value.trail.segments;
    const invalid = [];
    for (const sections of [Array.from({ length: 9 }, () => []),
      [[...Array(4_001)].map(() => [0, 0])],
      Array.from({ length: 9 }, () => Array.from({ length: 4_000 }, () => [0, 0]))]) {
      try { parseRunTrail(payload(sections)); invalid.push(false); }
      catch { invalid.push(true); }
    }
    const full = Array.from({ length: 32_000 }, () => [[0, 0]]);
    store.value = { ...store.value, trail: parseRunTrail(payload(full)) };
    const storedPoints = store.value.trail.segments.reduce((n, s) => n + s.length, 0);
    observe(0.1, 104);
    const maximumPoints = store.value.trail.segments.reduce((n, s) => n + s.length, 0);
    store.value = { ...store.value, trail: parseRunTrail(payload([[]])) };
    for (let index = 0; index < 20; index += 1) observe(index * 0.2, 200 + index * 10);
    return { path, continued, invalid, storedPoints, maximumPoints, smallSections: store.value.trail.segments,
      finalPoints: store.value.trail.segments.reduce((n, s) => n + s.length, 0) };
  });
  const original = Array.from({ length: 12 }, (_, index) => [[index * 2, 0], [index * 2 + 0.4, 0]]);
  expect(result.path).toEqual(original.flatMap(([first, last]) => [["move", ...first], ["line", ...last]]));
  expect(result.continued).toEqual([...original, [[24, 0], [24.3, 0]], [[24.31, 0]], [[24.32, 0]]]);
  expect(result.invalid).toEqual([true, true, true]);
  expect(result.storedPoints).toBe(32_000);
  expect(result.maximumPoints).toBe(4_000);
  expect(result.smallSections).toEqual(Array.from({ length: 20 }, (_, index) => [[index * 0.2, 0]]));
  expect(result.finalPoints).toBe(20);
});
