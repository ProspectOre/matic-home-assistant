import { expect, test } from "@playwright/test";
import { build } from "esbuild";

for (const [width, height, span] of [[400, 400, [10, 10]], [1000, 400, [40, 10]], [100, 900, [10, 40]]]) {
  test(`@safety scale and brush match projected meters at ${width}x${height}`, async ({ page }) => {
    const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state"; export { mapScale } from "./frontend/map-studio-v4/state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
    await page.route("**/projected-scale.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.goto("/");
    const results = await page.evaluate(async ({ width, height, span }) => {
      const { RendererController, createGalleryState, mapScale } = await import("/projected-scale.js");
      const base = createGalleryState("draw");
      let state = { ...base, view: "top", map: { ...base.map, exactPose: false },
        draw: { ...base.draw, tool: "paint", circles: [], outline: null },
        resources: { ...base.resources, scene: { ...base.resources.scene, value: { ...base.resources.scene.value,
          metadata: { ...base.resources.scene.value.metadata, metersPerCell: 1, origin: [0, 0], span, rooms: [] } } } } };
      const canvases = [document.createElement("canvas"), document.createElement("canvas")];
      canvases.forEach(canvas => { Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: `${width}px`, height: `${height}px` }); document.body.append(canvas); });
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let arcs = [];
      const originalArc = CanvasRenderingContext2D.prototype.arc;
      const originalClear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.arc = function (...args) { if (this.canvas === canvases[1]) arcs.push(args); return originalArc.apply(this, args); };
      CanvasRenderingContext2D.prototype.clearRect = function (...args) { if (this.canvas === canvases[1]) arcs = []; return originalClear.apply(this, args); };
      const renderer = new RendererController(...canvases);
      const rows = [];
      try {
        renderer.setState(state);
        await frame();
        for (const zoom of [100, 400, 1000]) for (const brush of [0.2, 2.5]) {
          state = { ...state, draw: { ...state.draw, zoomPercent: zoom, brushMeters: brush } };
          renderer.setState(state);
          await frame();
          const center = renderer.screenToMap(width / 2, height / 2);
          const left = renderer.screenToMap(width / 2 - 20, height / 2);
          const right = renderer.screenToMap(width / 2 + 20, height / 2);
          renderer.setCursor(center);
          await frame();
          const pixelsPerMeter = 40 / Math.hypot(right.x - left.x, right.y - left.y);
          const scale = mapScale(renderer.diagnostics().topPixelsPerMeter);
          rows.push({ zoom, brush, pixelsPerMeter, scale, radius: arcs.at(-1)?.[2] });
        }
        return rows;
      } finally {
        renderer.dispose();
        CanvasRenderingContext2D.prototype.arc = originalArc;
        CanvasRenderingContext2D.prototype.clearRect = originalClear;
        canvases.forEach(canvas => canvas.remove());
      }
    }, { width, height, span });
    for (const row of results) {
      expect(row.scale.pixels / row.scale.meters).toBeCloseTo(row.pixelsPerMeter, 2);
      expect(row.radius).toBeCloseTo(Math.max(2, row.brush / 2 * row.pixelsPerMeter), 2);
    }
  });
}
