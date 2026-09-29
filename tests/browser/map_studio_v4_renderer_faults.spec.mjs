import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

function invalidCompressedDelta() {
  const compressed = Buffer.from([0xff, 0x00, 0xff]);
  const header = Buffer.alloc(36);
  header.write("MATICDLT", 0, "binary");
  header.writeUInt16LE(1, 8);
  header.writeUInt16LE(1, 10);
  header.writeBigUInt64LE(7n, 12);
  header.writeBigUInt64LE(8n, 20);
  header.writeUInt32LE(24, 28);
  header.writeUInt32LE(compressed.byteLength, 32);
  return [...Buffer.concat([header, compressed])];
}

const ROOM_CATALOG = {
  rooms: [{ room_id: "kitchen", name: "Kitchen", boundary: [[0, 0], [6, 0], [6, 5], [0, 5]] }],
  plans: [],
  selected_plan: null,
};

async function readRendererState(page) {
  return page.evaluate(() => {
    const panel = window.__rendererFaultPanel;
    const map = panel.shadowRoot.querySelector("matic-map-shell-v4")
      .shadowRoot.querySelector("matic-map-canvas-v4");
    const canvas = map.shadowRoot.querySelector("canvas.scene-canvas");
    const workspace = panel.getWorkspaceSnapshot();
    const diagnostics = map.rendererDiagnostics();
    return {
      sameCanvas: canvas === window.__rendererFault.canvas,
      canvasCount: map.shadowRoot.querySelectorAll("canvas.scene-canvas").length,
      contextLost: window.__rendererFault.context.isContextLost(),
      lossPrevented: window.__rendererFault.lossPrevented,
      mode: diagnostics.mode,
      generation: diagnostics.contextGeneration,
      renderedPoints: diagnostics.renderedPoints,
      selection: workspace.selection,
      camera: workspace.cameras.three,
      serviceCalls: window.__panelFixture.serviceCalls.length,
    };
  });
}

test("packaged Map Studio keeps a live frame across WebGL loss and restoration @safety", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  // Center a distinctive scene point and omit pose; no room geometry or other annotation can satisfy the pixel check.
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialPlanCatalog: ROOM_CATALOG,
    posePosition: null,
    scenePoint: { x: 50, y: 40, color: [255, 0, 255] },
  });
  await page.evaluate((panelTag) => {
    document.body.style.margin = "0";
    const panel = window.__panelFixture.createPanel();
    panel.style.width = "100vw";
    panel.style.height = "100vh";
    window.__rendererFaultPanel = panel;
    document.body.append(panel);
  }, fixture.panelTag);

  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() =>
    window.__rendererFaultPanel.getWorkspaceSnapshot().resources.scene.status,
  )).toBe("ready");
  await expect.poll(() => page.evaluate(() =>
    window.__rendererFaultPanel.getWorkspaceSnapshot().resources.plans.status,
  )).toBe("ready");
  const map = panel.locator("matic-map-shell-v4").locator("matic-map-canvas-v4");
  const sceneCanvas = map.locator("canvas.scene-canvas");

  const capability = await sceneCanvas.evaluate((canvas) => {
    const context = canvas.getContext("webgl2");
    return {
      webgl2: context !== null,
      loseContext: Boolean(context?.getExtension("WEBGL_lose_context")),
    };
  });
  if (browserName === "chromium") {
    expect(capability, "Chromium must exercise the actual WebGL loss path").toEqual({ webgl2: true, loseContext: true });
  } else {
    test.skip(!capability.webgl2 || !capability.loseContext, `${browserName} does not expose WEBGL_lose_context`);
  }
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.mode)).toBe("webgl2");

  await panel.getByRole("button", { name: /One-time clean/ }).click();
  const kitchen = panel.getByRole("checkbox", { name: "Kitchen", exact: true });
  await kitchen.check();
  await expect.poll(() => page.evaluate(() =>
    window.__rendererFaultPanel.getWorkspaceSnapshot().selection.roomIds,
  )).toEqual(["kitchen"]);
  await panel.getByRole("button", { name: "3D", exact: true }).click();
  await panel.getByRole("button", { name: "Rotate left", exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__rendererFaultPanel.getWorkspaceSnapshot().cameras.three,
  )).not.toBeUndefined();

  await page.evaluate(() => {
    const canvas = window.__rendererFaultPanel.shadowRoot.querySelector("matic-map-shell-v4")
      .shadowRoot.querySelector("matic-map-canvas-v4").shadowRoot.querySelector("canvas.scene-canvas");
    const context = canvas.getContext("webgl2");
    window.__rendererFault = {
      canvas,
      context,
      extension: context.getExtension("WEBGL_lose_context"),
      lost: 0,
      restored: 0,
      lossPrevented: false,
    };
    canvas.addEventListener("webglcontextlost", (event) => {
      window.__rendererFault.lost += 1;
      window.__rendererFault.lossPrevented = event.defaultPrevented;
    });
    canvas.addEventListener("webglcontextrestored", () => { window.__rendererFault.restored += 1; });
  });
  const before = await readRendererState(page);
  expect(before.canvasCount).toBe(1);

  await page.evaluate(() => window.__rendererFault.extension.loseContext());
  await expect.poll(() => page.evaluate(() => window.__rendererFault.lost)).toBe(1);
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.mode)).toBe("canvas2d");
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.renderedPoints)).toBeGreaterThan(0);
  await expect.poll(() => map.locator("canvas.overlay-canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let scenePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 200 && pixels[index + 1] < 40 && pixels[index + 2] > 200 && pixels[index + 3] > 0) {
        scenePixels += 1;
      }
    }
    return scenePixels;
  })).toBeGreaterThan(0);

  const lost = await readRendererState(page);
  expect(lost).toMatchObject({
    sameCanvas: true,
    canvasCount: 1,
    contextLost: true,
    lossPrevented: true,
    mode: "canvas2d",
    generation: before.generation,
    selection: before.selection,
    camera: before.camera,
    serviceCalls: 0,
  });

  await page.evaluate(() => window.__rendererFault.extension.restoreContext());
  await expect.poll(() => page.evaluate(() => window.__rendererFault.restored)).toBe(1);
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.mode)).toBe("webgl2");
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.contextGeneration))
    .toBe(before.generation + 1);
  await expect.poll(() => map.evaluate((element) => element.rendererDiagnostics()?.renderedPoints)).toBeGreaterThan(0);

  const restored = await readRendererState(page);
  expect(restored).toMatchObject({
    sameCanvas: true,
    canvasCount: 1,
    contextLost: false,
    mode: "webgl2",
    generation: before.generation + 1,
    renderedPoints: 1,
    selection: before.selection,
    camera: before.camera,
    serviceCalls: 0,
  });
});

test("packaged panel contains a malformed compressed delta and returns to a coherent admitted scene @safety", async ({ page, browserName }) => {
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    sceneDeltaPayload: invalidCompressedDelta(),
  });
  const decompression = await page.evaluate(async (compressed) => {
    if (typeof DecompressionStream !== "function") return { supported: false, bytes: [] };
    const stream = new Blob([Uint8Array.from(compressed)]).stream().pipeThrough(new DecompressionStream("deflate"));
    return { supported: true, bytes: [...new Uint8Array(await new Response(stream).arrayBuffer())] };
  }, [...deflateSync(Buffer.from([11, 23, 42]))]);
  if (browserName === "chromium") {
    expect(decompression).toEqual({ supported: true, bytes: [11, 23, 42] });
  } else {
    test.skip(!decompression.supported, `${browserName} does not expose DecompressionStream`);
    expect(decompression.bytes).toEqual([11, 23, 42]);
  }
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    window.__deltaFaultPanel = panel;
    document.body.append(panel);
  });

  await expect.poll(() => page.evaluate(() =>
    window.__deltaFaultPanel.getWorkspaceSnapshot().resources.scene.status,
  )).toBe("ready");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.stats().deltaReads)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.stats().deltaPayloadResponses)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.stats().deltaNoChangeResponses)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__deltaFaultPanel.getWorkspaceSnapshot();
    return state.resources.catalog.status === "ready"
      && state.resources.scene.status === "ready"
      && state.coherence === "current";
  })).toBe(true);

  const admitted = await page.evaluate(() => {
    const state = window.__deltaFaultPanel.getWorkspaceSnapshot();
    return {
      available: state.map.available,
      revision: state.resources.scene.value.revision,
      coherence: state.coherence,
      sceneStatus: state.resources.scene.status,
      catalogStatus: state.resources.catalog.status,
      floor: state.selection.floorId,
      serviceCalls: window.__panelFixture.serviceCalls.length,
    };
  });
  expect(admitted).toEqual({
    available: true,
    revision: 7,
    coherence: "current",
    sceneStatus: "ready",
    catalogStatus: "ready",
    floor: "current",
    serviceCalls: 0,
  });

  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(0);
});
