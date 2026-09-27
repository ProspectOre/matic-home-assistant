import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const sceneModule = "scene-parser-resilience.js";

async function loadParser(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { SceneParser } from "./frontend/map-studio-v4/scene-parser";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route(`**/${sceneModule}`, route => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
}

function syntheticScene() {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms: [],
  }));
  const bytes = Buffer.alloc(24 + metadata.length + 8);
  bytes.write("MATIC3D\0", 0, "binary");
  bytes.writeUInt16LE(1, 8);
  bytes.writeUInt16LE(8, 10);
  bytes.writeUInt32LE(metadata.length, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(0, 20);
  metadata.copy(bytes, 24);
  return [...bytes];
}

test("worker unavailable parses on the fallback path and preserves buffer ownership", async ({ page }) => {
  await page.addInitScript(() => { window.Worker = undefined; });
  await loadParser(page);
  const result = await page.evaluate(async ({ module, bytes }) => {
    const { SceneParser } = await import(module);
    const parser = new SceneParser();
    const input = new Uint8Array(bytes).buffer;
    const parsed = await parser.parse(input);
    parser.dispose();
    return {
      sameBuffer: parsed.buffer === input,
      inputLength: input.byteLength,
      pointOffset: parsed.pointOffset,
      total: parsed.total,
      span: parsed.metadata.span,
    };
  }, { module: `/${sceneModule}`, bytes: syntheticScene() });

  expect(result).toEqual({
    sameBuffer: true,
    inputLength: syntheticScene().length,
    pointOffset: expect.any(Number),
    total: 1,
    span: [100, 80],
  });
});

test("worker failure rejects its pending request and later parses fall back", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
    window.Worker = class {
      onmessage = null;
      onerror = null;
      terminated = false;
      constructor() { window.workerInstances.push(this); }
      postMessage() {}
      terminate() { this.terminated = true; }
    };
    URL.createObjectURL = () => "blob:scene-parser-test";
    URL.revokeObjectURL = () => {};
  });
  await loadParser(page);
  const result = await page.evaluate(async ({ module, bytes }) => {
    const { SceneParser } = await import(module);
    const parser = new SceneParser();
    const first = new Uint8Array(bytes).buffer;
    let firstError = "none";
    const pending = parser.parse(first).catch(error => { firstError = error.code || error.name; });
    window.workerInstances[0].onerror(new Error("synthetic worker failure"));
    await pending;
    const second = new Uint8Array(bytes).buffer;
    const parsed = await parser.parse(second);
    parser.dispose();
    return {
      firstError,
      workerTerminated: window.workerInstances[0].terminated,
      secondBufferPreserved: parsed.buffer === second,
      secondTotal: parsed.total,
    };
  }, { module: `/${sceneModule}`, bytes: syntheticScene() });

  expect(result).toEqual({
    firstError: "scene-worker-failed",
    workerTerminated: true,
    secondBufferPreserved: true,
    secondTotal: 1,
  });
});

test("worker parsing transfers ownership of the input buffer", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      onmessage = null;
      onerror = null;
      postMessage(message, transfer) {
        const received = structuredClone(message.buffer, { transfer });
        window.detachedInputLength = message.buffer.byteLength;
        this.onmessage({ data: {
          id: message.id,
          ok: true,
          parsed: {
            buffer: received,
            pointOffset: 24,
            floorCount: 1,
            surfaceCount: 0,
            total: 1,
            metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
          },
        } });
      }
      terminate() {}
    };
    URL.createObjectURL = () => "blob:scene-parser-transfer-test";
    URL.revokeObjectURL = () => {};
  });
  await loadParser(page);
  const result = await page.evaluate(async ({ module, bytes }) => {
    const { SceneParser } = await import(module);
    const parser = new SceneParser();
    const input = new Uint8Array(bytes).buffer;
    const parsed = await parser.parse(input);
    parser.dispose();
    return {
      inputLengthAfterTransfer: input.byteLength,
      workerReceivedLength: parsed.buffer.byteLength,
      recordedDetachedLength: window.detachedInputLength,
      total: parsed.total,
    };
  }, { module: `/${sceneModule}`, bytes: syntheticScene() });

  expect(result).toEqual({
    inputLengthAfterTransfer: 0,
    workerReceivedLength: syntheticScene().length,
    recordedDetachedLength: 0,
    total: 1,
  });
});

test("worker accepts the maximum point count and rejects one point over the limit", async ({ page }) => {
  await loadParser(page);
  const result = await page.evaluate(async module => {
    const { SceneParser } = await import(module);
    const metadata = new TextEncoder().encode(JSON.stringify({
      meters_per_cell: 0.015,
      span_cells: [100, 80],
      origin_cells: [10, 10],
      sample_step: 1,
      rooms: [],
    }));
    const makeScene = pointCount => {
      const buffer = new ArrayBuffer(24 + metadata.byteLength + pointCount * 8);
      const view = new DataView(buffer);
      new Uint8Array(buffer, 0, 8).set(new TextEncoder().encode("MATIC3D\0"));
      view.setUint16(8, 1, true);
      view.setUint16(10, 8, true);
      view.setUint32(12, metadata.byteLength, true);
      view.setUint32(16, pointCount, true);
      view.setUint32(20, 0, true);
      new Uint8Array(buffer, 24, metadata.byteLength).set(metadata);
      return buffer;
    };

    const parser = new SceneParser();
    const maximum = await parser.parse(makeScene(1_500_000));
    let overLimitError = "none";
    try {
      await parser.parse(makeScene(1_500_001));
    } catch (error) {
      overLimitError = error.code || error.name;
    }
    parser.dispose();
    return {
      maximumTotal: maximum.total,
      maximumBufferBytes: maximum.buffer.byteLength,
      overLimitError,
    };
  }, `/${sceneModule}`);

  expect(result.maximumTotal).toBe(1_500_000);
  expect(result.maximumBufferBytes).toBeGreaterThan(12_000_000);
  expect(result.maximumBufferBytes).toBeLessThan(13_000_000);
  expect(result.overLimitError).toBe("invalid-scene");
});

test("dispose is idempotent across repeated parser lifecycles and revokes worker URLs", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
    window.revokedWorkerUrls = [];
    window.Worker = class {
      onmessage = null;
      onerror = null;
      terminated = false;
      constructor(url) { this.url = url; window.workerInstances.push(this); }
      postMessage() {}
      terminate() { this.terminated = true; }
    };
    let nextUrl = 0;
    URL.createObjectURL = () => `blob:scene-parser-${++nextUrl}`;
    URL.revokeObjectURL = url => window.revokedWorkerUrls.push(url);
  });
  await loadParser(page);
  const result = await page.evaluate(async module => {
    const { SceneParser } = await import(module);
    for (let index = 0; index < 6; index += 1) {
      const parser = new SceneParser();
      parser.dispose();
      parser.dispose();
    }
    return {
      workersTerminated: window.workerInstances.every(worker => worker.terminated),
      workerCount: window.workerInstances.length,
      revokedUrls: window.revokedWorkerUrls,
    };
  }, `/${sceneModule}`);

  expect(result.workersTerminated).toBe(true);
  expect(result.workerCount).toBe(6);
  expect(result.revokedUrls).toEqual(Array.from({ length: 6 }, (_, index) => `blob:scene-parser-${index + 1}`));
});
