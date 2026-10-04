import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("precomputes room selection once for the supported 100-room bound", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/renderer-room-bounds.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/renderer-room-bounds.js");
    const base = createGalleryState("ready");
    const roomCount = 100;
    const rooms = Array.from({ length: roomCount }, (_, index) => {
      const column = index % 10;
      const row = Math.floor(index / 10);
      const left = column * 16;
      const top = row * 12;
      return {
        id: `scene-${index}`,
        roomId: `room-${index}`,
        name: `Room ${index}`,
        boundary: [[left, top], [left + 15, top], [left + 15, top + 11], [left, top + 11]],
        center: [left + 7.5, top + 5.5],
      };
    });
    const selectedRooms = rooms.filter((_, index) => index % 2 === 0).map((room) => ({
      roomId: room.roomId,
      cleaningMode: "vacuum",
      coverageSetting: "standard",
    }));
    let selectedIdsMapCalls = 0;
    selectedRooms.map = function (...args) {
      selectedIdsMapCalls += 1;
      return Array.prototype.map.apply(this, args);
    };
    const plans = {
      ...base.resources.plans.value,
      rooms: rooms.map(({ roomId, name }) => ({ roomId, name })),
    };
    const state = {
      ...base,
      workflow: "plan",
      view: "top",
      appearance: "rooms",
      labelsVisible: false,
      planDraft: { ...base.planDraft, rooms: selectedRooms },
      resources: {
        ...base.resources,
        plans: { ...base.resources.plans, value: plans },
        scene: {
          ...base.resources.scene,
          value: {
            ...base.resources.scene.value,
            metadata: { ...base.resources.scene.value.metadata, rooms },
          },
        },
      },
    };
    const sceneCanvas = document.createElement("canvas");
    const overlayCanvas = document.createElement("canvas");
    for (const canvas of [sceneCanvas, overlayCanvas]) {
      Object.assign(canvas.style, { position: "absolute", width: "900px", height: "700px" });
      document.body.append(canvas);
    }
    const fillStyles = [];
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas === overlayCanvas) fillStyles.push(String(this.fillStyle));
      return originalFill.apply(this, args);
    };
    const renderer = new RendererController(sceneCanvas, overlayCanvas);
    renderer.setState(state);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    renderer.dispose();
    CanvasRenderingContext2D.prototype.fill = originalFill;
    sceneCanvas.remove();
    overlayCanvas.remove();
    const roomFillStyles = fillStyles.slice(0, roomCount);
    return { selectedIdsMapCalls, roomFillStyles, fillCount: fillStyles.length };
  });

  expect(result.selectedIdsMapCalls).toBe(1);
  expect(result.roomFillStyles).toHaveLength(100);
  const firstStyle = result.roomFillStyles[0];
  const secondStyle = result.roomFillStyles[1];
  expect(firstStyle).not.toBe(secondStyle);
  for (let index = 0; index < 100; index += 1) {
    expect(result.roomFillStyles[index]).toBe(index % 2 === 0 ? firstStyle : secondStyle);
  }
  expect(result.roomFillStyles.filter((style) => style === firstStyle)).toHaveLength(50);
  expect(result.roomFillStyles.filter((style) => style === secondStyle)).toHaveLength(50);
});
