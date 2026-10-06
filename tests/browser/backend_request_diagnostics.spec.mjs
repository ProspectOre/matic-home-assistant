import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { MaticBackend } from "./frontend/map-studio-v4/backend"; export { BoundedRequestMetric } from "./frontend/map-studio-v4/request-diagnostics";', resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test("request aggregates are immutable, bounded, resettable, and sample-free", async ({ page }) => {
  await page.route("**/request-diagnostics.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { BoundedRequestMetric } = await import("/request-diagnostics.js");
    const metric = new BoundedRequestMetric();
    metric.record("completed", 4.126);
    const first = metric.snapshot();
    metric.record("failed", Number.NaN);
    metric.record("timedOut", 1_000_000_000_000_000);
    const saturated = metric.snapshot();
    metric.reset();
    const reset = metric.snapshot();
    metric.dispose();
    metric.record("failed", 20);
    return {
      first,
      firstFrozen: Object.isFrozen(first),
      saturated,
      reset,
      disposed: metric.snapshot(),
    };
  });
  expect(result.first).toMatchObject({ requests: 1, completed: 1, failed: 0, totalDurationMs: 4.13, maxDurationMs: 4.13 });
  expect(result.firstFrozen).toBe(true);
  expect(result.saturated.failed).toBe(1);
  expect(Number.isFinite(result.saturated.totalDurationMs)).toBe(true);
  expect(result.saturated.totalDurationMs).toBe(1_000_000_000_000);
  expect(result.saturated.maxDurationMs).toBe(1_000_000_000_000);
  expect(result.reset.requests).toBe(0);
  expect(result.disposed.requests).toBe(0);
  expect(Object.keys(result.first).sort()).toEqual([
    "aborted", "completed", "failed", "maxDurationMs", "requests", "timedOut", "totalDurationMs",
  ]);
});

test("backend records outcomes through body consumption and ignores late completion after dispose", async ({ page }) => {
  await page.route("**/request-diagnostics.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.clock.install();
  await page.evaluate(async () => {
    const { MaticBackend } = await import("/request-diagnostics.js");
    let mode = "body";
    let finishBody = () => {};
    let finishHeaders = () => {};
    let markPending = () => {};
    const backend = new MaticBackend(() => ({ fetchWithAuth: async () => {
      if (mode === "body") return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"entries":[]}'));
          finishBody = () => controller.close();
          window.requestDiagnosticsBodyReady = true;
        },
      }), { headers: { "Content-Type": "application/json" } });
      if (mode === "failure") return new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } });
      return new Promise(resolve => {
        markPending();
        finishHeaders = () => resolve(new Response('{"entries":[]}', { headers: { "Content-Type": "application/json" } }));
      });
    } }));
    window.requestDiagnosticsMode = (value) => { mode = value; };
    window.requestDiagnosticsBackend = backend;
    window.requestDiagnosticsFinishBody = () => finishBody();
    window.requestDiagnosticsFinishHeaders = () => finishHeaders();
    window.requestDiagnosticsPendingStarted = new Promise(resolve => { markPending = () => resolve(true); });
    window.requestDiagnosticsBodyPromise = backend.catalog().then(
      () => { window.requestDiagnosticsBodyDone = true; },
      error => { window.requestDiagnosticsBodyError = String(error); },
    );
  });
  await expect.poll(() => page.evaluate(() => window.requestDiagnosticsBodyReady)).toBe(true);
  const duringBody = await page.evaluate(() => window.requestDiagnosticsBackend.requestDiagnostics().catalog);
  expect(duringBody.requests).toBe(0);
  await page.clock.fastForward(37);
  await page.evaluate(() => window.requestDiagnosticsFinishBody());
  await expect.poll(() => page.evaluate(() => window.requestDiagnosticsBodyDone || window.requestDiagnosticsBodyError)).not.toBeUndefined();
  expect(await page.evaluate(() => window.requestDiagnosticsBodyError)).toBeUndefined();
  const afterBody = await page.evaluate(() => window.requestDiagnosticsBackend.requestDiagnostics().catalog);
  expect(afterBody).toMatchObject({ requests: 1, completed: 1, failed: 0, aborted: 0, timedOut: 0 });
  expect(afterBody.totalDurationMs).toBeGreaterThanOrEqual(37);

  const afterFailure = await page.evaluate(async () => {
    window.requestDiagnosticsMode("failure");
    try { await window.requestDiagnosticsBackend.catalog(); } catch { /* expected */ }
    return window.requestDiagnosticsBackend.requestDiagnostics().catalog;
  });
  expect(afterFailure).toMatchObject({ requests: 2, completed: 1, failed: 1 });

  await page.evaluate(async () => {
    window.requestDiagnosticsMode("pending");
    window.requestDiagnosticsLatePromise = window.requestDiagnosticsBackend.catalog().catch(() => {});
    await window.requestDiagnosticsPendingStarted;
    window.requestDiagnosticsBackend.dispose();
    window.requestDiagnosticsAfterDispose = window.requestDiagnosticsBackend.requestDiagnostics();
  });
  for (const metric of Object.values(await page.evaluate(() => window.requestDiagnosticsAfterDispose))) expect(metric.requests).toBe(0);
  await page.evaluate(() => window.requestDiagnosticsFinishHeaders());
  await page.evaluate(() => window.requestDiagnosticsLatePromise);
  const afterLateCompletion = await page.evaluate(() => window.requestDiagnosticsBackend.requestDiagnostics());
  for (const metric of Object.values(afterLateCompletion)) expect(metric.requests).toBe(0);
});

test("abort and timeout are separate request outcomes", async ({ page }) => {
  await page.route("**/request-diagnostics.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.clock.install();
  await page.evaluate(async () => {
    const { MaticBackend } = await import("/request-diagnostics.js");
    const backend = new MaticBackend(() => ({ fetchWithAuth: async () => new Promise(() => {}) }));
    const controller = new AbortController();
    const aborted = backend.catalog(controller.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    try { await aborted; } catch { /* expected */ }
    const timedOut = backend.catalog();
    await new Promise(resolve => setTimeout(resolve, 0));
    window.requestDiagnosticsBackend = backend;
    window.requestDiagnosticsTimedOut = timedOut;
  });
  await page.clock.fastForward(10_001);
  await expect.poll(() => page.evaluate(async () => {
    try { await window.requestDiagnosticsTimedOut; } catch { /* expected */ }
    return window.requestDiagnosticsBackend.requestDiagnostics().catalog;
  })).toMatchObject({ requests: 2, aborted: 1, timedOut: 1, failed: 0 });
});
