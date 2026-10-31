import { expect, test } from "@playwright/test";
import { build } from "esbuild";

// Cleaning history's map pictures: a failed read, a 404 included, is asked
// again after a minute, and only the newest twelve object URLs are kept.

test("run pictures retry a failed read and keep the newest twelve", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { readRunThumbnail } from "./frontend/map-studio-v4/run-history-data";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/run-thumbnails.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { readRunThumbnail } = await import("/run-thumbnails.js");
    const store = { value: { runThumbnails: {} }, patch(next) { this.value = { ...this.value, ...next }; } };
    const responses = { transient: [503, 200], later: [404, 200] };
    const calls = [];
    const backend = {
      async runThumbnail(_entry, id) {
        calls.push(id);
        const status = (responses[id] ?? [200]).shift() ?? 200;
        if (status !== 200) throw Object.assign(new Error("request-failed"), { status });
        return new Blob(["x"], { type: "image/webp" });
      },
    };
    const pending = { reads: new Set(), retry: new Map() };
    const read = (id) => readRunThumbnail(store, backend, "entry", id, pending, () => false);
    let now = 1_000_000;
    Date.now = () => now;

    await read("transient");
    const afterFailure = "transient" in store.value.runThumbnails;
    await read("transient");
    const callsWithinMinute = calls.length;
    now += 60_001;
    await read("transient");
    const retried = store.value.runThumbnails.transient?.startsWith("blob:");

    await read("later");
    const laterMissing = !("later" in store.value.runThumbnails);
    now += 60_001;
    await read("later");
    const later = store.value.runThumbnails.later?.startsWith("blob:");

    const revoked = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    const first = store.value.runThumbnails.transient;
    for (let index = 0; index < 11; index += 1) await read(`run-${index}`);
    return {
      afterFailure, callsWithinMinute, retried, laterMissing, later,
      kept: Object.keys(store.value.runThumbnails).length, firstRevoked: revoked.includes(first),
    };
  });
  expect(result.afterFailure).toBe(false);
  expect(result.callsWithinMinute).toBe(1);
  expect(result.retried).toBe(true);
  expect(result.laterMissing).toBe(true);
  expect(result.later).toBe(true);
  expect(result.kept).toBe(12);
  expect(result.firstRevoked).toBe(true);
});
