import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("travel path stays legible and does not bridge large unobserved gaps", async ({ page }) => {
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
      trail: { id: "live", mapSessionKey: "frame", segments: [[[0, 0], [0.4, 0.1], [3, 0], [3.4, 0.2], [6, 0]]] } };
    const palette = { accent: [6, 120, 206], onAccent: [255, 255, 255] };
    drawRunTrail(context, state, palette, (x, y) => ({ x, y }));
    return { path, strokes, dots };
  });
  expect(result.path.slice(0, 5)).toEqual([["move", 0, 0], ["line", 0.4, 0.1], ["move", 3, 0], ["line", 3.4, 0.2], ["move", 6, 0]]);
  expect(result.dots).toEqual([[6, 0, 3.5], [6, 0, 1.5]]);
  expect(result.strokes).toEqual([
    { width: 7, colour: "rgba(255,255,255,1)" },
    { width: 3, colour: "rgba(6,120,206,1)" },
  ]);
});
