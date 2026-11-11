import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("sampled source detail is disclosed at close zoom and clears on replacement @safety", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'import "./frontend/map-studio-v4/map-canvas"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/surface-notice-test.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.addInitScript(() => {
    const draw = WebGL2RenderingContext.prototype.drawArraysInstanced;
    WebGL2RenderingContext.prototype.drawArraysInstanced = function (...args) {
      window.__surfaceNoticeDraws = (window.__surfaceNoticeDraws || 0) + 1;
      return draw.apply(this, args);
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const webgl2Available = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  });
  test.skip(!webgl2Available, "WebGL2 is unavailable in this browser project");
  await page.evaluate(async () => {
    const { createGalleryState } = await import("/surface-notice-test.js");
    const base = createGalleryState("ready");
    const scene = base.resources.scene.value;
    const canvas = document.createElement("matic-map-canvas-v4");
    canvas.style.display = "block";
    canvas.style.width = "800px";
    canvas.style.height = "600px";
    canvas.state = { ...base, optionalUiReady: true, view: "three", appearance: "photo", quality: "auto",
      resources: { ...base.resources, scene: { ...base.resources.scene,
        value: { ...scene, metadata: { ...scene.metadata, sampleStep: 2 } } } } };
    document.body.append(canvas);
    await canvas.updateComplete;
    canvas.rendererController.setCamera({ ...canvas.rendererController.camera, distance: 1 });
    window.__surfaceNoticeCanvas = canvas;
  });
  const canvas = page.locator("matic-map-canvas-v4");
  const notice = canvas.locator(".detail-notice");
  await expect.poll(() => canvas.evaluate((element) => element.rendererDiagnostics()?.mode)).toBe("webgl2");
  await expect.poll(() => page.evaluate(() => window.__surfaceNoticeDraws || 0)).toBeGreaterThan(0);
  await expect(notice).toContainText("missing some detail");
  await canvas.evaluate((element) => element.rendererController.fit());
  await expect(notice).toHaveCount(0);
  await canvas.evaluate((element) => element.rendererController.setCamera({ ...element.rendererController.camera, distance: 1 }));
  await expect(notice).toContainText("missing some detail");
  await page.evaluate(async () => {
    const canvas = window.__surfaceNoticeCanvas;
    const state = canvas.state;
    const scene = state.resources.scene.value;
    canvas.state = { ...state, resources: { ...state.resources, scene: { ...state.resources.scene,
      value: { ...scene, revision: scene.revision + 1, metadata: { ...scene.metadata, sampleStep: 1 } } } } };
    await canvas.updateComplete;
  });
  await expect(notice).toHaveCount(0);
  await page.evaluate(() => window.__surfaceNoticeCanvas.remove());
});
