import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// A live manifest whose header does not parse.
const malformedManifest = () => [...Buffer.from("MATICMX\0\x01\x00\x1c\x00")];

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

async function magentaPixelsInScreenshot(page, screenshot) {
  const imageUrl = `data:image/png;base64,${screenshot.toString("base64")}`;
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return 0;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let scenePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 200 && pixels[index + 1] < 40 && pixels[index + 2] > 200) scenePixels += 1;
    }
    return scenePixels;
  }, imageUrl);
}

async function screenshotSceneCanvasWithoutOverlay(sceneCanvas, overlayCanvas) {
  const originalStyle = await overlayCanvas.getAttribute("style");
  await overlayCanvas.evaluate((canvas) => { canvas.style.visibility = "hidden"; });
  try {
    return await sceneCanvas.screenshot();
  } finally {
    await overlayCanvas.evaluate((canvas, style) => {
      if (style === null) canvas.removeAttribute("style");
      else canvas.setAttribute("style", style);
    }, originalStyle);
  }
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

  await panel.getByRole("button", { name: /Clean rooms/ }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__rendererFaultPanel.getWorkspaceSnapshot().resources.plans.status,
  )).toBe("ready");
  const kitchen = panel.getByRole("checkbox", { name: "Kitchen", exact: true });
  await kitchen.check();
  await expect.poll(() => page.evaluate(() =>
    window.__rendererFaultPanel.getWorkspaceSnapshot().selection.roomIds,
  )).toEqual(["kitchen"]);
  // Room selection deliberately forces the task map to top view; return Home
  // before rotating so the renderer is exercised in the launch camera mode.
  await panel.getByRole("button", { name: "Back to all tasks", exact: true }).click();
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
  const overlayCanvas = map.locator("canvas.overlay-canvas");
  expect(await magentaPixelsInScreenshot(page,
    await screenshotSceneCanvasWithoutOverlay(sceneCanvas, overlayCanvas))).toBeGreaterThan(0);

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
  await expect.poll(async () => magentaPixelsInScreenshot(page,
    await screenshotSceneCanvasWithoutOverlay(sceneCanvas, overlayCanvas)))
    .toBeGreaterThan(0);

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

test("packaged panel contains a malformed scene update and returns to a coherent admitted scene @safety", async ({ page }) => {
  await installPanelFixture(page, {
    moduleSource: "packaged",
    sceneUpdate: malformedManifest(),
  });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    window.__updateFaultPanel = panel;
    document.body.append(panel);
  });

  await expect.poll(() => page.evaluate(() =>
    window.__updateFaultPanel.getWorkspaceSnapshot().resources.scene.status,
  )).toBe("ready");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.stats().latestReads)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.stats().sceneUpdates)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.stats().latestUnchanged)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__updateFaultPanel.getWorkspaceSnapshot();
    return state.resources.catalog.status === "ready"
      && state.resources.scene.status === "ready"
      && state.coherence === "current";
  })).toBe(true);

  const admitted = await page.evaluate(() => {
    const state = window.__updateFaultPanel.getWorkspaceSnapshot();
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
