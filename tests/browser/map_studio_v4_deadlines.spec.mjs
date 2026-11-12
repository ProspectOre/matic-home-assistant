import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { manifestBytes, sceneMetadata, syntheticPages } from "./scene_manifest_fixture.mjs";

// A one-page manifest: the "pages" case stalls on the page read that follows it.
const manifest = manifestBytes(sceneMetadata(), syntheticPages(1)).toString("base64");

for (const kind of ["catalog", "scene", "pages"]) {
  for (const stall of ["headers", "body"]) {
    for (const cancel of [false, true]) {
      test(`${kind} ${stall} stall settles on ${cancel ? "cancellation" : "its deadline"}`, async ({ page }) => {
        const bundle = await build({ stdin: { contents: 'export { MaticBackend } from "./frontend/map-studio-v4/backend";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
        await page.route("**/deadline-module.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
        await page.goto("/");
        await page.clock.install();
        await page.evaluate(async ({ kind, stall, manifest }) => {
          const { MaticBackend } = await import("/deadline-module.js");
          window.deadlineResult = "pending";
          window.deadlineCancellations = 0;
          window.deadlineController = new AbortController();
          window.deadlineBackend = new MaticBackend(() => ({ fetchWithAuth: async (path) => {
            if (kind === "pages" && !path.includes("/pages?")) {
              return new Response(Uint8Array.from(atob(manifest), char => char.charCodeAt(0)), {
                headers: { "Content-Type": "application/vnd.matic.slam-manifest", "X-Matic-Revision": "2" },
              });
            }
            if (stall === "headers") return new Promise(resolve => {
              window.deadlineLateHeaders = () => resolve(new Response(new ReadableStream({
                cancel() { window.deadlineCancellations += 1; },
              })));
            });
            return new Response(new ReadableStream({ start() {}, cancel() { window.deadlineCancellations += 1; } }), {
              headers: { "Content-Type": kind === "catalog" ? "application/json" : "application/vnd.matic.slam-scene", "X-Matic-Revision": "2" },
            });
          } }));
          const signal = window.deadlineController.signal;
          const pending = kind === "catalog" ? window.deadlineBackend.catalog(signal)
            : window.deadlineBackend.scene("/api/matic_robot/test", 1, true, "live", signal);
          pending.then(() => { window.deadlineResult = "resolved"; }, error => { window.deadlineResult = typeof error.code === "string" ? error.code : error.name; });
        }, { kind, stall, manifest });
        if (cancel) await page.evaluate(() => window.deadlineController.abort());
        else await page.clock.fastForward(({ catalog: 10000, scene: 60000, pages: 60000 })[kind] + 1);
        await expect.poll(() => page.evaluate(() => window.deadlineResult)).toBe(cancel ? "AbortError" : "request-timeout");
        if (stall === "headers") await page.evaluate(() => window.deadlineLateHeaders());
        await expect.poll(() => page.evaluate(() => window.deadlineCancellations)).toBe(1);
        await page.evaluate(() => window.deadlineBackend.dispose());
      });
    }
  }
}
