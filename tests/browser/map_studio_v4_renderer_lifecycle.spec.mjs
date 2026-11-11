import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("@safety renderer releases old scenes on hidden owner changes and scene removal, but retains on ordinary hide", async ({ page }) => {
  const bundle = await build({
    stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";', resolveDir: process.cwd() },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/renderer-owner-lifecycle.js", route => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/renderer-owner-lifecycle.js");
    const base = createGalleryState("ready");
    const scene = base.resources.scene.value;
    const canvases = Array.from({ length: 2 }, () => {
      const canvas = document.createElement("canvas");
      Object.assign(canvas.style, { width: "600px", height: "400px" });
      document.body.append(canvas);
      return canvas;
    });
    const renderer = new RendererController(...canvases);
    const stateFor = (owner, pageActive, value) => ({ ...base, owner: { userKey: owner }, pageActive,
      optionalUiReady: false,
      resources: { ...base.resources, scene: { status: value ? "ready" : "idle", value, problem: null } },
    });
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitFor = async predicate => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (predicate()) return true;
        await frame();
      }
      return predicate();
    };
    try {
      renderer.setState(stateFor("owner-a", true, scene));
      const admitted = await waitFor(() => renderer.diagnostics().renderedPoints > 0);
      renderer.setState(stateFor("owner-a", false, scene));
      const hiddenSameOwner = renderer.diagnostics().sourcePoints;
      renderer.setState(stateFor("owner-b", false, scene));
      const hiddenOwnerChange = renderer.diagnostics().sourcePoints;
      const replacement = { ...scene, revision: scene.revision + 1, buffer: scene.buffer.slice(0) };
      renderer.setState(stateFor("owner-b", true, replacement));
      const replacementAdmitted = await waitFor(() => renderer.diagnostics().sourcePoints === replacement.total);
      renderer.setState(stateFor("owner-b", true, null));
      const removed = renderer.diagnostics().sourcePoints;
      return { admitted, hiddenSameOwner, hiddenOwnerChange, replacementAdmitted, removed,
        replacementPoints: replacement.total };
    } finally {
      renderer.dispose();
      canvases.forEach(canvas => canvas.remove());
    }
  });
  expect(result.admitted).toBe(true);
  expect(result.hiddenSameOwner).toBeGreaterThan(0);
  expect(result.hiddenOwnerChange).toBe(0);
  expect(result.replacementAdmitted).toBe(true);
  expect(result.removed).toBe(0);
});
