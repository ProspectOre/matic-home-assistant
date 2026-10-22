import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

test("scene parser retains native room labels up to the UTF-8 byte limit", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { parseSceneBuffer } from "./frontend/map-studio-v4/scene-parser";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/scene-parser.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { parseSceneBuffer } = await import("/scene-parser.js");
    const encode = (rooms) => {
      const metadata = new TextEncoder().encode(JSON.stringify({
        meters_per_cell: .05, origin_cells: [0, 0], span_cells: [10, 10],
        rooms,
      }));
      const buffer = new ArrayBuffer(32 + metadata.length);
      new Uint8Array(buffer).set(new TextEncoder().encode("MATIC3D\0"));
      const view = new DataView(buffer);
      view.setUint16(8, 1, true); view.setUint16(10, 8, true);
      view.setUint32(12, metadata.length, true); view.setUint32(16, 1, true);
      new Uint8Array(buffer, 24, metadata.length).set(metadata);
      return parseSceneBuffer(buffer).metadata.rooms;
    };
    return {
      ascii129: encode([{ name: "a".repeat(129), boundary: [[0,0], [1,0], [1,1]], center: [.5,.5] }]).length,
      ascii256: encode([{ name: "a".repeat(256), boundary: [[0,0], [1,0], [1,1]], center: [.5,.5] }]).length,
      ascii257: encode([{ name: "a".repeat(257), boundary: [[0,0], [1,0], [1,1]], center: [.5,.5] }]).length,
      unicode256: encode([{ name: "é".repeat(128), boundary: [[0,0], [1,0], [1,1]], center: [.5,.5] }]).length,
      overLimit: encode([{ name: "é".repeat(129), boundary: [[0,0], [1,0], [1,1]], center: [.5,.5] }]).length,
      allLong: (() => {
        const rooms = Array.from({ length: 256 }, (_, index) => ({
          room_id: `room_${index.toString(16).padStart(16, "0")}`,
          name: "x".repeat(256), boundary: [[0,0], [1,0], [1,1]], center: [.5,.5],
        }));
        const parsed = encode(rooms);
        return { count: parsed.length, ids: parsed.map(({ id }) => id), namesRetained: parsed.every(({ name }) => name.length === 256) };
      })(),
    };
  });
  expect(result.ascii257).toBe(0);
  expect(result.allLong.count).toBe(256);
  expect(new Set(result.allLong.ids).size).toBe(256);
  expect(result.allLong.namesRetained).toBe(true);
  expect(result).toMatchObject({ ascii129: 1, ascii256: 1, unicode256: 1, overLimit: 0 });
});

test("precomputes room selection once for the supported 100-room bound", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state"; export { parseSceneBuffer } from "./frontend/map-studio-v4/scene-parser";',
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
  expect(new Set(result.roomFillStyles).size).toBe(100);
});

test("all 256 room colors stay distinct by room ID, retain selection and labels, and yield to forced colors", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state"; export { parseSceneBuffer } from "./frontend/map-studio-v4/scene-parser";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/renderer-room-colors.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState, parseSceneBuffer } = await import("/renderer-room-colors.js");
    const base = createGalleryState("ready");
    const rooms = Array.from({ length: 256 }, (_, index) => {
      const left = index * 12;
      return {
        id: `stable-room-${index}`,
        roomId: `room-${index}`,
        name: `Room ${index}`,
        boundary: [[left, 0], [left + 10, 0], [left + 10, 10], [left, 10]],
        center: [left + 5, 5],
      };
    });
    const selectedRooms = [{ roomId: "room-0", cleaningMode: "vacuum", coverageSetting: "standard" }];
    const plans = { ...base.resources.plans.value, rooms: rooms.map(({ roomId, name }) => ({ roomId, name })) };
    const makeState = (orderedRooms, { labelsVisible = false, appearance = "rooms" } = {}) => ({
      ...base,
      workflow: "plan",
      view: "top",
      appearance,
      labelsVisible,
      planDraft: { ...base.planDraft, rooms: selectedRooms },
      resources: {
        ...base.resources,
        plans: { ...base.resources.plans, value: plans },
        scene: { ...base.resources.scene, value: {
          ...base.resources.scene.value,
          metadata: { ...base.resources.scene.value.metadata, rooms: orderedRooms },
        } },
      },
    });
    const sceneCanvas = document.createElement("canvas");
    const overlayCanvas = document.createElement("canvas");
    for (const canvas of [sceneCanvas, overlayCanvas]) {
      Object.assign(canvas.style, { position: "absolute", width: "900px", height: "700px" });
      document.body.append(canvas);
    }
    const capture = async (orderedRooms, options = {}, forced = false, dark = false) => {
      const fills = [];
      const strokes = [];
      const widths = [];
      let textCount = 0;
      const originalFill = CanvasRenderingContext2D.prototype.fill;
      const originalStroke = CanvasRenderingContext2D.prototype.stroke;
      const originalFillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fill = function (...args) {
        if (this.canvas === overlayCanvas) fills.push(String(this.fillStyle));
        return originalFill.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.stroke = function (...args) {
        if (this.canvas === overlayCanvas) { strokes.push(String(this.strokeStyle)); widths.push(this.lineWidth); }
        return originalStroke.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        if (this.canvas === overlayCanvas) textCount += 1;
        return originalFillText.apply(this, args);
      };
      const renderer = new RendererController(sceneCanvas, overlayCanvas);
      renderer.setPalette({ accent: [12, 120, 200], onAccent: [255, 255, 255], text: dark ? [230, 230, 230] : [20, 30, 40], quiet: dark ? [180, 180, 180] : [70, 80, 90], plate: dark ? [28, 28, 28] : [250, 250, 250], roomFill: forced ? [235, 235, 235] : dark ? [40, 40, 40] : [231, 238, 242], forced });
      renderer.setState(makeState(orderedRooms, options));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const diagnostics = renderer.diagnostics();
      const png = options.preview ? overlayCanvas.toDataURL() : null;
      renderer.dispose();
      CanvasRenderingContext2D.prototype.fill = originalFill;
      CanvasRenderingContext2D.prototype.stroke = originalStroke;
      CanvasRenderingContext2D.prototype.fillText = originalFillText;
      return { png, fills, strokes, widths, textCount, renderedPoints: diagnostics.renderedPoints };
    };
    const first = await capture(rooms);
    const reordered = await capture([...rooms].reverse());
    const labeled = await capture(rooms, { labelsVisible: true });
    const forced = await capture(rooms, {}, true);
    const dark = await capture(rooms, {}, false, true);
    const photo = await capture(rooms, { appearance: "photo" });
    const wireRooms = rooms.map((room, index) => ({
      ...room, room_id: `room_${index.toString(16).padStart(16, "0")}`,
    }));
    const parseRooms = (raw) => {
      const metadata = new TextEncoder().encode(JSON.stringify({
        meters_per_cell: .05, origin_cells: [0,0], span_cells: [180,140], rooms: raw,
      }));
      const buffer = new ArrayBuffer(24 + metadata.length + 8);
      new Uint8Array(buffer).set(new TextEncoder().encode("MATIC3D\0"));
      const view = new DataView(buffer);
      view.setUint16(8,1,true); view.setUint16(10,8,true);
      view.setUint32(12,metadata.length,true); view.setUint32(16,1,true);
      new Uint8Array(buffer,24,metadata.length).set(metadata);
      return parseSceneBuffer(buffer).metadata.rooms;
    };
    const parsed = parseRooms(wireRooms);
    const parsedReversed = parseRooms([...wireRooms].reverse());
    const production = await capture(parsed);
    const productionReversed = await capture(parsedReversed);
    const legacy = parseRooms(wireRooms.map(({ room_id, ...room }) => room));
    const duplicate = parseRooms([wireRooms[0], wireRooms[0], { ...wireRooms[1], room_id: "bad" }]);
    const byName = (order, fills) => Object.fromEntries(order.map((room, index) => [room.name, fills[index]]));
    const previewRooms = rooms.slice(0, 12).map((room, index) => {
      const x = index % 4 * 45, y = Math.floor(index / 4) * 45;
      return { ...room, id: `preview-${String(index).padStart(2, "0")}`,
        boundary: [[x,y], [x+45,y], [x+45,y+45], [x,y+45]], center: [x+22.5,y+22.5] };
    });
    const previewLight = await capture(previewRooms, { labelsVisible: true, preview: true });
    const previewDark = await capture(previewRooms, { labelsVisible: true, preview: true }, false, true);
    sceneCanvas.remove();
    overlayCanvas.remove();
    const byId = (order, fills) => Object.fromEntries(order.map((room, index) => [room.id, fills[index]]));
    return {
      first,
      productionByName: byName(parsed, production.fills),
      productionReversedByName: byName(parsedReversed, productionReversed.fills),
      parsedIds: parsed.map((room) => room.id),
      parsedCapCount: parseRooms([...wireRooms, wireRooms[0]]).length,
      legacyIds: legacy.map((room) => room.id),
      duplicateIds: duplicate.map((room) => room.id),
      previewLight, previewDark,
      reordered,
      labeled,
      forced,
      dark,
      photo,
      firstById: byId(rooms, first.fills),
      reorderedById: byId([...rooms].reverse(), reordered.fills),
    };
  });

  for (const [scheme, preview] of [["light", result.previewLight], ["dark", result.previewDark]]) {
    const path = test.info().outputPath(`12-room-${scheme}.png`);
    await writeFile(path, Buffer.from(preview.png.split(",")[1], "base64"));
    await test.info().attach(`12-room-${scheme}`, { path, contentType: "image/png" });
  }
  expect(result.productionByName).toEqual(result.productionReversedByName);
  expect(result.parsedIds).toEqual(Array.from({ length: 256 }, (_, index) => `room_${index.toString(16).padStart(16, "0")}`));
  expect(result.parsedCapCount).toBe(256);
  expect(result.legacyIds[0]).toBe("scene-room-1");
  expect(new Set(result.duplicateIds).size).toBe(3);
  const selectedIndex = result.first.strokes.findIndex((style) => style === "#0c78c8");
  expect(result.first.strokes[selectedIndex]).toBe("#0c78c8");
  expect(result.first.widths[selectedIndex]).toBe(3);
  expect(result.first.widths.slice(0, 256).filter((_, index) => index !== selectedIndex).every((width) => width === 2)).toBe(true);
  expect(result.first.strokes.slice(0, 256).filter((_, index) => index !== selectedIndex).every((style) => style === "#141e28")).toBe(true);
  // Perceptual separation for the first sixteen rooms, beyond byte uniqueness.
  const oklab = (style) => {
    const [r, g, b] = style.match(/rgba\((\d+), (\d+), (\d+),/).slice(1, 4).map(Number)
      .map((value) => value > 10 ? ((value / 255 + .055) / 1.055) ** 2.4 : value / 3294.6);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * l + .793617785 * m - .0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
      .0259040371 * l + .7827717662 * m - .808675766 * s];
  };
  const ids = Object.keys(result.firstById).sort().slice(0, 16);
  for (const fills of [result.first.fills, result.dark.fills]) {
    const order = Object.keys(result.firstById);
    const colors = ids.map((id) => oklab(fills[order.indexOf(id)]));
    const distances = colors.flatMap((color, index) => colors.slice(index + 1)
      .map((other) => Math.hypot(...color.map((value, channel) => value - other[channel]))));
    expect(Math.min(...distances)).toBeGreaterThan(.10);
  }
  const roomCount = Object.keys(result.firstById).length;
  const roomFills = result.first.fills.slice(0, roomCount);
  const unselectedFills = roomFills.filter((_, index) => index !== selectedIndex);
  expect(roomCount).toBe(256);
  expect(new Set(roomFills).size).toBe(roomCount);
  expect(result.firstById).toEqual(result.reorderedById);
  expect(new Set(unselectedFills).size).toBe(roomCount - 1);
  expect(result.labeled.textCount).toBeGreaterThan(0);
  expect(result.first.textCount).toBe(0);
  expect(result.labeled.fills).toEqual(result.first.fills);
  const darkSelectedIndex = result.dark.strokes.findIndex((style) => style === "#0c78c8");
  expect(darkSelectedIndex).toBe(selectedIndex);
  expect(result.dark.strokes[darkSelectedIndex]).toBe("#0c78c8");
  const darkUnselected = result.dark.fills.slice(0, roomCount).filter((_, index) => index !== darkSelectedIndex);
  expect(new Set(darkUnselected).size).toBe(roomCount - 1);
  const channelMean = (style) => style.match(/rgba\((\d+), (\d+), (\d+),/).slice(1, 4)
    .reduce((sum, channel) => sum + Number(channel), 0) / 3;
  const lightUnselected = roomFills.filter((_, index) => index !== selectedIndex);
  expect(darkUnselected.every((style, index) => channelMean(style) < channelMean(lightUnselected[index]))).toBe(true);
  const forcedSelectedIndex = result.forced.strokes.findIndex((style) => style === "#0c78c8");
  expect(forcedSelectedIndex).toBe(selectedIndex);
  expect(result.forced.strokes[forcedSelectedIndex]).toBe("#0c78c8");
  expect(result.forced.fills.slice(0, roomCount))
    .toEqual(Array(roomCount).fill("rgba(235, 235, 235, 0.94)"));
  expect(result.forced.strokes.slice(0, roomCount).filter((_, index) => index !== forcedSelectedIndex))
    .toEqual(Array(roomCount - 1).fill("#141e28"));
  expect(result.photo.renderedPoints).toBeGreaterThan(0);
});

test("room labels draw after every room fill so an overlapping room cannot cover a name", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/renderer-label-order.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/renderer-label-order.js");
    const base = createGalleryState("ready");
    // The second room's polygon covers the first room's label position, as a
    // narrow hallway beside a bathroom does on a real floor plan.
    const rooms = [
      { id: "room-a", roomId: "a", name: "Bathroom", boundary: [[40, 40], [60, 40], [60, 60], [40, 60]], center: [50, 50] },
      { id: "room-b", roomId: "b", name: "Hallway", boundary: [[20, 45], [80, 45], [80, 55], [20, 55]], center: [50, 70] },
    ];
    const sceneCanvas = document.createElement("canvas");
    const overlayCanvas = document.createElement("canvas");
    for (const canvas of [sceneCanvas, overlayCanvas]) {
      Object.assign(canvas.style, { position: "absolute", width: "900px", height: "700px" });
      document.body.append(canvas);
    }
    const operations = [];
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas === overlayCanvas) operations.push("fill");
      return originalFill.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (this.canvas === overlayCanvas) operations.push(`text:${text}`);
      return originalFillText.call(this, text, ...args);
    };
    const renderer = new RendererController(sceneCanvas, overlayCanvas);
    renderer.setState({
      ...base,
      view: "top",
      appearance: "rooms",
      labelsVisible: true,
      resources: {
        ...base.resources,
        scene: { ...base.resources.scene, value: {
          ...base.resources.scene.value,
          metadata: { ...base.resources.scene.value.metadata, rooms },
        } },
      },
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    renderer.dispose();
    CanvasRenderingContext2D.prototype.fill = originalFill;
    CanvasRenderingContext2D.prototype.fillText = originalFillText;
    sceneCanvas.remove();
    overlayCanvas.remove();
    return operations;
  });

  const firstText = result.findIndex((operation) => operation.startsWith("text:"));
  expect(firstText).toBeGreaterThan(-1);
  // Both room fills land before the first name. Later overlay fills, such as
  // the robot marker, are meant to sit above the labels.
  expect(result.slice(0, firstText).filter((operation) => operation === "fill").length).toBe(2);
  expect(result.filter((operation) => operation.startsWith("text:"))).toEqual(["text:Bathroom", "text:Hallway"]);
});

test("a room label that would cover another moves aside instead of disappearing", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/renderer-label-spacing.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/renderer-label-spacing.js");
    const base = createGalleryState("ready");
    // Two neighbouring rooms whose centres are a cell apart, as a small
    // bedroom beside a bathroom is on a real floor plan.
    const rooms = [
      { id: "room-a", roomId: "a", name: "Bathroom", boundary: [[40, 40], [50, 40], [50, 60], [40, 60]], center: [49, 50] },
      { id: "room-b", roomId: "b", name: "Quinns Room", boundary: [[50, 40], [60, 40], [60, 60], [50, 60]], center: [51, 50] },
    ];
    const sceneCanvas = document.createElement("canvas");
    const overlayCanvas = document.createElement("canvas");
    for (const canvas of [sceneCanvas, overlayCanvas]) {
      Object.assign(canvas.style, { position: "absolute", width: "900px", height: "700px" });
      document.body.append(canvas);
    }
    const labels = [];
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
      if (this.canvas === overlayCanvas) {
        const width = this.measureText(text).width;
        labels.push({ text, left: x - width / 2, right: x + width / 2, top: y - 8, bottom: y + 8 });
      }
      return originalFillText.call(this, text, x, y, ...args);
    };
    const renderer = new RendererController(sceneCanvas, overlayCanvas);
    renderer.setState({
      ...base,
      view: "top",
      appearance: "rooms",
      labelsVisible: true,
      resources: {
        ...base.resources,
        scene: { ...base.resources.scene, value: {
          ...base.resources.scene.value,
          metadata: { ...base.resources.scene.value.metadata, rooms },
        } },
      },
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    renderer.dispose();
    CanvasRenderingContext2D.prototype.fillText = originalFillText;
    sceneCanvas.remove();
    overlayCanvas.remove();
    return labels;
  });

  expect(result.map((label) => label.text)).toEqual(["Bathroom", "Quinns Room"]);
  const [first, second] = result;
  const overlaps = first.left < second.right && second.left < first.right
    && first.top < second.bottom && second.top < first.bottom;
  expect(overlaps, "both names stay readable without overlapping").toBe(false);
});

test("a moved room label stays on the canvas", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/renderer-label-edge.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/renderer-label-edge.js");
    const base = createGalleryState("ready");
    const rooms = [
      { id: "room-a", roomId: "a", name: "Bathroom", boundary: [[40, 40], [50, 40], [50, 60], [40, 60]], center: [49, 50] },
      { id: "room-b", roomId: "b", name: "Quinns Room", boundary: [[50, 40], [60, 40], [60, 60], [50, 60]], center: [51, 50] },
    ];
    const sceneCanvas = document.createElement("canvas");
    const overlayCanvas = document.createElement("canvas");
    for (const canvas of [sceneCanvas, overlayCanvas]) {
      Object.assign(canvas.style, { position: "absolute", width: "900px", height: "700px" });
      document.body.append(canvas);
    }
    let labels = [];
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
      if (this.canvas === overlayCanvas) labels.push({ text, y });
      return originalFillText.call(this, text, x, y, ...args);
    };
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const renderer = new RendererController(sceneCanvas, overlayCanvas);
    renderer.setState({
      ...base,
      view: "top",
      appearance: "rooms",
      labelsVisible: true,
      resources: {
        ...base.resources,
        scene: { ...base.resources.scene, value: {
          ...base.resources.scene.value,
          metadata: { ...base.resources.scene.value.metadata, rooms },
        } },
      },
    });
    await frame();
    // Pan so the first name sits just inside the lower edge, where the slot
    // below the colliding second name would leave the canvas. A top-down pan
    // moves names linearly, so two samples give the camera for that edge.
    const start = renderer.camera;
    const firstAt = async (targetZ) => {
      labels = [];
      renderer.setCamera({ ...start, distance: start.distance / 2, targetZ }, false);
      await frame();
      return labels.find((label) => label.text === "Bathroom")?.y;
    };
    const y0 = await firstAt(start.targetZ);
    const y1 = await firstAt(start.targetZ - 1);
    const firstY = await firstAt(start.targetZ - (680 - y0) / (y1 - y0));
    const found = { firstY, labels };
    renderer.dispose();
    CanvasRenderingContext2D.prototype.fillText = originalFillText;
    sceneCanvas.remove();
    overlayCanvas.remove();
    return found;
  });

  expect(result.firstY, "the first name sits at the lower edge").toBeGreaterThan(668);
  expect(result.labels.map((label) => label.text)).toEqual(["Bathroom", "Quinns Room"]);
  for (const label of result.labels) expect(label.y + 10, `${label.text} stays on the canvas`).toBeLessThanOrEqual(700);
});
