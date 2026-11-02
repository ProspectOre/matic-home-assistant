import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

test("comparison loads pinned scene URLs and clears without choosing a replacement when one disappears", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { MaticMapComparisonV4 } from "./frontend/map-studio-v4/map-comparison-element"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/comparison-element.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { MaticMapComparisonV4, createGalleryState } = await import("/comparison-element.js");
    const base = createGalleryState("ready");
    const state = { ...base, workflow: "history", dataMode: "history", owner: { userKey: "u", entryKey: "robot" },
      host: { ...base.host, administrator: true }, selection: { ...base.selection, entryId: "robot" } };
    const scene = base.resources.scene.value;
    const calls = [];
    const records = [
      { id: "a".repeat(32), contentId: "a".repeat(64), createdAt: "2026-10-20T12:00:00Z", revision: 1,
        pointCount: 3, sceneUrl: "/record/a", retention: "kept", imported: true, comparisonGroup: null,
        frame: null, name: "Older", deletedUntil: null, compressedBytes: 10 },
      { id: "b".repeat(32), contentId: "b".repeat(64), createdAt: "2026-10-21T12:00:00Z", revision: 2,
        pointCount: 3, sceneUrl: "/record/b", retention: "kept", imported: true, comparisonGroup: null,
        frame: null, name: "Newer", deletedUntil: null, compressedBytes: 10 },
    ];
    const element = document.createElement("matic-map-comparison-v4");
    element.backend = { scene: async (url, revision, floorCoherent, source, signal) => {
      calls.push({ url, revision, floorCoherent, source });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return { scene: { ...scene, revision, source }, floorCoherent, revision, notModified: false };
    } };
    element.state = state;
    element.catalog = { generation: 1, capturePaused: false, capacityBlocked: false, usage: {}, records };
    const selected = [];
    element.onSelectionChange = (ids) => selected.push(ids);
    document.body.append(element);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const firstCalls = structuredClone(calls);
    element.catalog = { ...element.catalog, generation: 2, records: [records[1]] };
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterDelete = structuredClone(calls);
    const message = element.shadowRoot.querySelector('[role="status"]')?.textContent;
    const clearedPreviews = Array.from(element.shadowRoot.querySelectorAll(".map-preview"), (canvas) => ({
      scene: canvas.state?.resources?.scene?.value ?? null,
      sourcePoints: canvas.rendererDiagnostics()?.sourcePoints ?? 0,
    }));
    element.remove();
    return { firstCalls, afterDelete, message, selected, clearedPreviews };
  });
  expect(result.firstCalls.map(({ url }) => url).sort()).toEqual(["/record/a", "/record/b"]);
  expect(result.afterDelete).toEqual(result.firstCalls);
  expect(result.message).toContain("no longer available");
  expect(result.selected.at(-1)).toBeNull();
  expect(result.clearedPreviews).toHaveLength(2);
  expect(result.clearedPreviews).toEqual([
    { scene: null, sourcePoints: 0 }, { scene: null, sourcePoints: 0 },
  ]);
});

test("comparison aborts both source reads and clears selection when administrator access is lost", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { MaticMapComparisonV4 } from "./frontend/map-studio-v4/map-comparison-element"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/comparison-element.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { MaticMapComparisonV4, createGalleryState } = await import("/comparison-element.js");
    const base = createGalleryState("ready");
    const state = { ...base, workflow: "history", dataMode: "history", owner: { userKey: "u", entryKey: "robot" },
      host: { ...base.host, administrator: true }, selection: { ...base.selection, entryId: "robot" } };
    const records = ["a", "b"].map((prefix, index) => ({
      id: prefix.repeat(32), contentId: prefix.repeat(64), createdAt: `2026-10-2${index}T12:00:00Z`, revision: index + 1,
      pointCount: 3, sceneUrl: `/record/${prefix}`, retention: "kept", imported: true, comparisonGroup: null,
      frame: null, name: prefix, deletedUntil: null, compressedBytes: 10,
    }));
    const signals = [];
    const element = document.createElement("matic-map-comparison-v4");
    element.backend = { scene: async (_url, _revision, _floorCoherent, _source, signal) => new Promise((_resolve, reject) => {
      signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }) };
    element.state = state;
    element.catalog = { generation: 1, capturePaused: false, capacityBlocked: false, usage: {}, records };
    const selected = [];
    element.onSelectionChange = (ids) => selected.push(ids);
    document.body.append(element);
    const deadline = Date.now() + 1000;
    while (signals.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    const pendingReads = signals.length;
    element.state = { ...state, host: { ...state.host, administrator: false } };
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = { pendingReads, aborted: signals.map((signal) => signal.aborted), selected,
      message: element.shadowRoot.querySelector('[role="status"]')?.textContent };
    element.remove();
    return result;
  });
  expect(result.pendingReads).toBe(2);
  expect(result.aborted).toEqual([true, true]);
  expect(result.selected.at(-1)).toBeNull();
  expect(result.message.toLowerCase()).toContain("administrator access");
});

test("comparison does not retry a pair continuously after source reads return 503", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { MaticMapComparisonV4 } from "./frontend/map-studio-v4/map-comparison-element"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/comparison-element.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { MaticMapComparisonV4, createGalleryState } = await import("/comparison-element.js");
    const base = createGalleryState("ready");
    const state = { ...base, workflow: "history", dataMode: "history", owner: { userKey: "u", entryKey: "robot" },
      host: { ...base.host, administrator: true }, selection: { ...base.selection, entryId: "robot" } };
    const records = ["a", "b"].map((prefix, index) => ({
      id: prefix.repeat(32), contentId: prefix.repeat(64), createdAt: `2026-10-2${index}T12:00:00Z`, revision: index + 1,
      pointCount: 3, sceneUrl: `/record/${prefix}`, retention: "kept", imported: true, comparisonGroup: null,
      frame: null, name: prefix, deletedUntil: null, compressedBytes: 10,
    }));
    const calls = [];
    const element = document.createElement("matic-map-comparison-v4");
    element.backend = { scene: async (url) => {
      calls.push(url);
      throw Object.assign(new Error("503"), { status: 503 });
    } };
    element.state = state;
    element.catalog = { generation: 1, capturePaused: false, capacityBlocked: false, usage: {}, records };
    document.body.append(element);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const result = { calls, message: element.shadowRoot.querySelector('[role="status"]')?.textContent };
    element.remove();
    return result;
  });
  expect(result.calls).toHaveLength(2);
  expect(result.message).toContain("could not be loaded");
});


for (const coverageCase of ["matching", "mismatched frame", "bad checksum"]) {
  test(`@safety comparison enriches parsed scene buffers: ${coverageCase}`, async ({ page }) => {
    const compressed = deflateSync(Buffer.from([3]));
    const checksum = createHash("sha256").update(compressed).digest("hex");
    const coverage = { version: 1, status: "verified", encoding: "zlib-bitset-little-v1",
      origin_cells: [0, 0], meters_per_cell: 0.015, span_cells: coverageCase === "mismatched frame" ? [3, 1] : [2, 1],
      observed_cells: 2, mask_sha256: coverageCase === "bad checksum" ? "f".repeat(64) : checksum,
      mask_zlib_base64: compressed.toString("base64"), diff_eligible: true };
    const buffers = [0, 1].map((x) => {
      const metadata = Buffer.from(JSON.stringify({ meters_per_cell: 0.015, origin_cells: [0, 0],
        span_cells: [2, 1], sample_step: 1, rooms: [], coverage }));
      const buffer = Buffer.alloc(24 + metadata.byteLength + 8);
      buffer.write("MATIC3D\0", 0, "binary");
      buffer.writeUInt16LE(1, 8); buffer.writeUInt16LE(8, 10);
      buffer.writeUInt32LE(metadata.byteLength, 12); buffer.writeUInt32LE(1, 16);
      metadata.copy(buffer, 24);
      buffer.writeUInt16LE(x, 24 + metadata.byteLength);
      return buffer.toString("base64");
    });
    const bundle = await build({
      stdin: {
        contents: 'import "./frontend/map-studio-v4/map-comparison-element"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state"; export { parseSceneBuffer } from "./frontend/map-studio-v4/scene-parser";',
        resolveDir: process.cwd(),
      }, bundle: true, format: "esm", write: false,
    });
    await page.route("**/comparison-coverage.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.route("**/comparison-coverage", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
    await page.goto("/comparison-coverage");
    const coreCoverage = await page.evaluate(async ({ buffers, coverage }) => {
      const { createGalleryState, parseSceneBuffer } = await import("/comparison-coverage.js");
      const scenes = buffers.map((bytes, index) => ({
        ...parseSceneBuffer(Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0)).buffer),
        revision: index + 1, etag: null, source: "history",
      }));
      const base = createGalleryState("ready");
      const records = ["a", "b"].map((prefix, index) => ({ id: prefix.repeat(32), contentId: prefix.repeat(64),
        createdAt: `2026-10-2${index}T12:00:00Z`, revision: index + 1, pointCount: 1, sceneUrl: `/record/${index}`,
        retention: "kept", imported: false, comparisonGroup: "c".repeat(64), name: prefix, deletedUntil: null, compressedBytes: 10,
        frame: { formatVersion: 1, coordinateVersion: 1, originCells: [0, 0], metersPerCell: 0.015,
          spanCells: [2, 1], diffEligible: true, coverage: { status: "verified", observedCells: 2,
            maskSha256: coverage.mask_sha256, diffEligible: true } } }));
      const element = document.createElement("matic-map-comparison-v4");
      element.backend = { scene: async (url) => ({ scene: scenes[Number(url.at(-1))] }) };
      element.state = { ...base, workflow: "history", dataMode: "history", owner: { userKey: "u", entryKey: "robot" },
        host: { ...base.host, administrator: true }, selection: { ...base.selection, entryId: "robot" } };
    element.catalog = { generation: 1, capturePaused: false, capacityBlocked: false, usage: {}, records };
      document.body.append(element);
      return scenes.map((scene) => scene.metadata.coverage ?? null);
    }, { buffers, coverage });
    expect(coreCoverage).toEqual([null, null]);
    if (coverageCase === "matching") {
      await expect(page.locator(".counts .changed")).toHaveText("Changed 2");
      await expect(page.locator(".counts .unchanged")).toHaveText("Unchanged 0");
      await expect(page.locator(".counts .unknown")).toHaveText("Unknown 0");
    } else {
      await expect(page.locator("matic-map-comparison-v4 p.status[role='status']")).toContainText(coverageCase === "bad checksum"
        ? "could not be loaded" : "don't show enough of the same floor");
      await expect(page.locator(".counts")).toHaveCount(0);
    }
    await page.evaluate(() => document.querySelector("matic-map-comparison-v4")?.remove());
  });
}
