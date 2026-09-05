import { test, expect } from "@playwright/test";
import { build } from "esbuild";

for (const kind of ["catalog", "scene", "delta"]) {
  for (const stall of ["headers", "body"]) {
    for (const cancel of [false, true]) {
      test(`${kind} ${stall} stall settles on ${cancel ? "cancellation" : "its deadline"}`, async ({ page }) => {
        const bundle = await build({ stdin: { contents: 'export { MaticBackend } from "./frontend/map-studio-v4/backend";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
        await page.route("**/deadline-module.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
        await page.goto("/");
        await page.clock.install();
        await page.evaluate(async ({ kind, stall }) => {
          const { MaticBackend } = await import("/deadline-module.js");
          window.deadlineResult = "pending";
          window.deadlineController = new AbortController();
          window.deadlineBackend = new MaticBackend(() => ({ fetchWithAuth: async () => {
            if (stall === "headers") return new Promise(() => {});
            return new Response(new ReadableStream({ start() {} }), {
              headers: { "Content-Type": kind === "catalog" ? "application/json" : "application/vnd.matic.slam-scene", "X-Matic-Revision": "2" },
            });
          } }));
          const signal = window.deadlineController.signal;
          const pending = kind === "catalog" ? window.deadlineBackend.catalog(signal)
            : kind === "scene" ? window.deadlineBackend.scene("/api/matic_robot/test", 1, true, "live", signal)
            : window.deadlineBackend.sceneDelta("/api/matic_robot/test", { revision: 1 }, true, signal);
          pending.then(() => { window.deadlineResult = "resolved"; }, error => { window.deadlineResult = typeof error.code === "string" ? error.code : error.name; });
        }, { kind, stall });
        if (cancel) await page.evaluate(() => window.deadlineController.abort());
        else await page.clock.fastForward(({ catalog: 10000, scene: 60000, delta: 35000 })[kind] + 1);
        await expect.poll(() => page.evaluate(() => window.deadlineResult)).toBe(cancel ? "AbortError" : "request-timeout");
        await page.evaluate(() => window.deadlineBackend.dispose());
      });
    }
  }
}
