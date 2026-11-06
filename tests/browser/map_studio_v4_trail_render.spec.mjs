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
