import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

function syntheticScene(roomName, pointX) {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms: [{
      name: roomName,
      boundary: [[0, 0], [6, 0], [6, 5], [0, 5]],
      center: [3, 2.5],
    }],
  }));
  const scene = Buffer.alloc(24 + metadata.length + 8);
  scene.write("MATIC3D\0", 0, "binary");
  scene.writeUInt16LE(1, 8);
  scene.writeUInt16LE(8, 10);
  scene.writeUInt32LE(metadata.length, 12);
  scene.writeUInt32LE(1, 16);
  scene.writeUInt32LE(0, 20);
  metadata.copy(scene, 24);
  scene.writeUInt16LE(pointX, 24 + metadata.length);
  scene.writeUInt16LE(12, 26 + metadata.length);
  scene[28 + metadata.length] = 1;
  scene[29 + metadata.length] = 30;
  scene[30 + metadata.length] = 80;
  scene[31 + metadata.length] = 120;
  return scene;
}

function syntheticDelta(base, scene, baseRevision, revision) {
  const difference = Buffer.alloc(Math.max(base.length, scene.length));
  for (let index = 0; index < difference.length; index += 1) {
    difference[index] = (base[index] || 0) ^ (scene[index] || 0);
  }
  const compressed = deflateSync(difference);
  const header = Buffer.alloc(36);
  header.write("MATICDLT", 0, "binary");
  header.writeUInt16LE(1, 8);
  header.writeUInt16LE(1, 10);
  header.writeBigUInt64LE(BigInt(baseRevision), 12);
  header.writeBigUInt64LE(BigInt(revision), 20);
  header.writeUInt32LE(scene.length, 28);
  header.writeUInt32LE(compressed.length, 32);
  return Buffer.concat([header, compressed]);
}

async function loadGallery(page, { scenario = "ready", narrow = false } = {}) {
  await page.goto("/");
  await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
  await page.evaluate(async ({ tag, selectedScenario, selectedNarrow }) => {
    await customElements.whenDefined(tag);
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = selectedScenario;
    gallery.narrow = selectedNarrow;
    document.body.style.margin = "0";
    document.body.append(gallery);
  }, { tag: GALLERY_TAG, selectedScenario: scenario, selectedNarrow: narrow });
  return page.locator(GALLERY_TAG);
}

async function snapshot(page) {
  return page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot(), GALLERY_TAG);
}

test.describe("Map Studio v0.4 foundation", () => {
  test("registers the v0.4 panel and gallery without replacing v0.3 tags", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });

    expect(await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      await customElements.whenDefined("matic-map-studio-gallery-v0-4-0");
      return {
        panelV4: Boolean(customElements.get("matic-map-panel-v0-4-0")),
        galleryV4: Boolean(customElements.get("matic-map-studio-gallery-v0-4-0")),
        panelV3: Boolean(customElements.get("matic-map-panel-v0-3-1")),
      };
    })).toEqual({ panelV4: true, galleryV4: true, panelV3: false });
  });

  test("registers isolated constructors for successive content-addressed builds", async ({ page }) => {
    await page.goto("/");
    const tags = await page.evaluate(async () => {
      const first = await import("/matic_robot/0.4.0b1-aaaaaaaaaaaa/map-studio-v4/index.js");
      const second = await import("/matic_robot/0.4.0b1-bbbbbbbbbbbb/map-studio-v4/index.js");
      return [first.MATIC_MAP_PANEL_TAG, second.MATIC_MAP_PANEL_TAG];
    });
    expect(tags).toEqual([
      "matic-map-panel-v0-4-0-aaaaaaaaaaaa",
      "matic-map-panel-v0-4-0-bbbbbbbbbbbb",
    ]);
    expect(await page.evaluate((names) => names.every((name) => Boolean(customElements.get(name))), tags))
      .toBe(true);
  });

  test("projects the meter-space robot pose onto the scene center", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    const overlay = gallery.locator("matic-map-canvas-v4 .overlay-canvas");

    await expect.poll(async () => overlay.evaluate((canvas) => {
      const context = canvas.getContext("2d");
      if (!context) return null;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const points = [];
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          if (pixels.data[offset] === 6
            && pixels.data[offset + 1] === 120
            && pixels.data[offset + 2] === 206
            && pixels.data[offset + 3] > 0) points.push([x, y]);
        }
      }
      if (!points.length) return null;
      const x = points.reduce((sum, point) => sum + point[0], 0) / points.length;
      const y = points.reduce((sum, point) => sum + point[1], 0) / points.length;
      return Math.abs(x - canvas.width / 2) <= 1
        && Math.abs(y - canvas.height / 2) <= 1;
    })).toBe(true);
  });

  test("upgrades a pre-existing shell without a blank first render", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = "<matic-map-shell-v4></matic-map-shell-v4>";
    });
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });

    await expect(page.locator("matic-map-shell-v4")).toContainText("Matic Map");
    expect(errors).toEqual([]);
  });

  test("rejects stale coherence generations and fails closed", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const machine = new module.CoherenceMachine();
      const first = machine.begin("entry", "floor-a", "mission-a", 1);
      const second = machine.begin("entry", "floor-b", "mission-b", 2);
      const advanced = machine.advance(second, 3);
      const ready = module.createGalleryState("ready");
      const degraded = { ...ready, coherence: "degraded" };
      const transition = module.createGalleryState("transition");
      return {
        firstRejected: !machine.accepts(first),
        secondSuperseded: !machine.accepts(second),
        advancedAccepted: advanced ? machine.accepts(advanced) : false,
        ready: {
          show: module.canShowLiveMap(ready),
          pose: module.canShowExactPose(ready),
          edit: module.canEditCoordinates(ready),
          motion: module.canStartMotion(ready),
        },
        degraded: {
          show: module.canShowLiveMap(degraded),
          pose: module.canShowExactPose(degraded),
          edit: module.canEditCoordinates(degraded),
          motion: module.canStartMotion(degraded),
        },
        transition: {
          show: module.canShowLiveMap(transition),
          pose: module.canShowExactPose(transition),
          edit: module.canEditCoordinates(transition),
          motion: module.canStartMotion(transition),
        },
      };
    });

    expect(result).toEqual({
      firstRejected: true,
      secondSuperseded: true,
      advancedAccepted: true,
      ready: { show: true, pose: true, edit: true, motion: true },
      degraded: { show: true, pose: true, edit: false, motion: false },
      transition: { show: false, pose: false, edit: false, motion: false },
    });
  });

  test("dismisses dialog, precision, Full map, and workflow one layer at a time", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      let state = {
        ...module.createGalleryState("draw"),
        fullMap: true,
        precisionOpen: true,
        dialog: "discardDraft",
      };
      const layers = [];
      for (let index = 0; index < 4; index += 1) {
        state = module.reduceWorkspace(state, { type: "dismiss-top-layer" });
        layers.push({
          dialog: state.dialog,
          precision: state.precisionOpen,
          fullMap: state.fullMap,
          workflow: state.workflow,
        });
      }
      return layers;
    });

    expect(result).toEqual([
      { dialog: null, precision: true, fullMap: true, workflow: "draw" },
      { dialog: null, precision: false, fullMap: true, workflow: "draw" },
      { dialog: null, precision: false, fullMap: false, workflow: "draw" },
      { dialog: null, precision: false, fullMap: false, workflow: "none" },
    ]);
  });

  test("opens History without hiding the live map and preserves a chosen saved map", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const live = module.createGalleryState("ready");
      const opened = module.reduceWorkspace(live, { type: "open-workflow", workflow: "history" });
      const saved = {
        ...opened,
        dataMode: "history",
        selection: { ...opened.selection, floorId: "saved-floor", historyId: "saved-map" },
      };
      const closed = module.reduceWorkspace(saved, { type: "dismiss-top-layer" });
      return {
        openedMode: opened.dataMode,
        openedWorkflow: opened.workflow,
        closedMode: closed.dataMode,
        closedWorkflow: closed.workflow,
        closedHistory: closed.selection.historyId,
      };
    });

    expect(result).toEqual({
      openedMode: "live",
      openedWorkflow: "history",
      closedMode: "history",
      closedWorkflow: "none",
      closedHistory: "saved-map",
    });
  });

  test("uses accessible peek, half, and full mobile sheet detents", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    const sheet = gallery.locator(".mobile-sheet");
    const toggle = gallery.getByRole("button", { name: /Map workspace, .* height/ });

    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(gallery.getByRole("banner").getByText("Docked", { exact: true })).toHaveCount(0);
    await expect.poll(async () => gallery.locator(".scene-window").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const sheetBounds = element.getRootNode().host.getRootNode().querySelector(".mobile-sheet")?.getBoundingClientRect();
      return sheetBounds ? Math.abs(bounds.bottom - sheetBounds.top) : Number.POSITIVE_INFINITY;
    })).toBeLessThanOrEqual(1);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await toggle.click();
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(sheet).toHaveAttribute("data-detent", "half");

    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      document.querySelector(tag).replaceWorkspaceState(module.createGalleryState("rooms"));
    }, GALLERY_TAG);
    await expect(sheet).toHaveAttribute("data-detent", "half");
  });

  test("confirms destructive plan deletion and restores focus when cancelled", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      window.__mapStudioActions = [];
      element.addEventListener("matic-workspace-action", (event) => {
        window.__mapStudioActions.push(event.detail?.id);
      });
    }, GALLERY_TAG);
    await gallery.getByRole("button", { name: "Plans" }).click();
    const deletePlan = gallery.getByRole("button", { name: "Delete plan" });
    await expect(deletePlan).toBeVisible();
    await deletePlan.click();
    await expect(gallery.getByRole("dialog", { name: "Delete this plan?" })).toBeVisible();
    expect(await page.evaluate(() => window.__mapStudioActions)).toEqual([]);
    await gallery.getByRole("button", { name: "Cancel" }).click();
    await expect(deletePlan).toBeFocused();

    await deletePlan.click();
    await gallery.getByRole("dialog", { name: "Delete this plan?" })
      .getByRole("button", { name: "Delete plan", exact: true }).click();
    await expect(gallery.getByRole("dialog", { name: "Delete this plan?" })).toHaveCount(0);
    expect(await page.evaluate(() => window.__mapStudioActions)).toEqual(["delete-plan"]);

    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      const galleryElement = document.querySelector(tag);
      galleryElement.replaceWorkspaceState({
        ...module.createGalleryState("draw"),
        workflow: "areaReview",
      });
    }, GALLERY_TAG);
    const deleteArea = gallery.getByRole("button", { name: "Delete area" });
    await deleteArea.click();
    await gallery.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteArea).toBeFocused();
  });

  test("preserves Draw state through Full map and restores focus in Escape order", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    const zoom = gallery.getByLabel("Map zoom percent");
    const brush = gallery.getByLabel("Brush width in meters");
    await zoom.fill("400");
    await zoom.press("Tab");
    await brush.fill("0.20");
    await brush.press("Tab");
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent).toBe(400);
    await expect.poll(async () => (await snapshot(page)).draw.brushMeters).toBe(0.2);

    const fullMap = gallery.getByRole("button", { name: "Full map" });
    await fullMap.click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(gallery.locator(".inspector")).toBeHidden();
    const precision = gallery.getByRole("button", { name: "400% · 0.20 m" });
    await expect(precision).toBeVisible();
    await precision.click();
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(true);

    await precision.press("Escape");
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(false);
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(precision).toBeFocused();

    await precision.press("Escape");
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);
    await expect.poll(async () => (await snapshot(page)).draw).toMatchObject({
      zoomPercent: 400,
      brushMeters: 0.2,
      dirty: true,
      strokeCount: 3,
    });
    await expect(fullMap).toBeFocused();
  });

  test("owns trackpad pinch over the map and keeps focal zoom bounded", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const map = gallery.locator(".map-root");
    const before = (await snapshot(page)).draw.zoomPercent;
    const modifierPrevented = await map.evaluate((element) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -120,
        clientX: 200,
        clientY: 200,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(modifierPrevented).toBe(true);
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent).toBeGreaterThan(before);
    const afterPinch = (await snapshot(page)).draw.zoomPercent;

    const wheelPrevented = await map.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -280,
        clientX: bounds.left + bounds.width * 0.3,
        clientY: bounds.top + bounds.height * 0.7,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(wheelPrevented).toBe(true);
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent).toBeGreaterThan(afterPinch);
    const origin = (await snapshot(page)).draw;
    expect(Math.abs(origin.zoomOriginX - 30)).toBeLessThan(0.2);
    expect(Math.abs(origin.zoomOriginY - 70)).toBeLessThan(0.2);
  });

  test("restores native trackpad pinch and twist", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const map = gallery.locator(".map-root");
    const before = await snapshot(page);

    const prevented = await map.evaluate((element) => {
      const start = new Event("gesturestart", { bubbles: true, cancelable: true });
      Object.assign(start, { scale: 1, rotation: 0, clientX: 260, clientY: 220 });
      element.dispatchEvent(start);
      const change = new Event("gesturechange", { bubbles: true, cancelable: true });
      Object.assign(change, { scale: 1.35, rotation: 28, clientX: 260, clientY: 220 });
      element.dispatchEvent(change);
      const end = new Event("gestureend", { bubbles: true, cancelable: true });
      Object.assign(end, { scale: 1.35, rotation: 28 });
      element.dispatchEvent(end);
      return start.defaultPrevented && change.defaultPrevented && end.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent)
      .toBeGreaterThan(before.draw.zoomPercent);
    await expect.poll(async () => (await snapshot(page)).cameras.top?.yaw ?? 0)
      .not.toBeCloseTo(before.cameras.top?.yaw ?? 0, 4);

  });

  test("separates trackpad pan, mouse-wheel zoom, pinch zoom, and pitch", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const map = gallery.locator(".map-root");
    await map.focus();

    await map.dispatchEvent("wheel", { deltaX: 32, deltaY: 18, deltaMode: 0 });
    await expect.poll(async () => Boolean((await snapshot(page)).cameras.three)).toBe(true);
    const afterTrackpad = (await snapshot(page)).cameras.three;
    expect(Math.hypot(afterTrackpad.targetX, afterTrackpad.targetZ)).toBeGreaterThan(0.01);
    expect(afterTrackpad.zoom).toBeCloseTo(1, 2);

    await map.dispatchEvent("wheel", { deltaX: 0, deltaY: -120, deltaMode: 0 });
    const afterWheel = (await snapshot(page)).cameras.three;
    expect(afterWheel.zoom).toBeGreaterThan(afterTrackpad.zoom);

    await map.dispatchEvent("wheel", {
      deltaX: 0,
      deltaY: -20,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 240,
      clientY: 210,
    });
    const afterPinch = (await snapshot(page)).cameras.three;
    expect(afterPinch.zoom).toBeGreaterThan(afterWheel.zoom);

    await map.dispatchEvent("wheel", { deltaX: 0, deltaY: 24, deltaMode: 0, altKey: true });
    const afterPitch = (await snapshot(page)).cameras.three;
    expect(afterPitch.pitch).not.toBeCloseTo(afterPinch.pitch, 4);
  });

  test("supports mouse orbit, modifier pan, double-click zoom, and keyboard flight", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const map = gallery.locator(".map-root");
    const bounds = await map.boundingBox();
    expect(bounds).not.toBeNull();
    const centerX = bounds.x + bounds.width * 0.45;
    const centerY = bounds.y + bounds.height * 0.48;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 90, centerY + 45, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Boolean((await snapshot(page)).cameras.three)).toBe(true);
    const afterOrbit = (await snapshot(page)).cameras.three;
    expect(afterOrbit.yaw).not.toBeCloseTo(-Math.PI / 4, 3);
    expect(afterOrbit.pitch).not.toBeCloseTo(0.82, 3);

    await page.keyboard.down("Shift");
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 70, centerY - 35, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const afterPan = (await snapshot(page)).cameras.three;
    expect(Math.hypot(
      afterPan.targetX - afterOrbit.targetX,
      afterPan.targetZ - afterOrbit.targetZ,
    )).toBeGreaterThan(0.01);
    expect(afterPan.yaw).toBeCloseTo(afterOrbit.yaw, 3);

    const zoomBeforeDoubleClick = afterPan.zoom;
    await page.mouse.dblclick(centerX, centerY);
    await expect.poll(async () => (await snapshot(page)).cameras.three.zoom)
      .toBeGreaterThan(zoomBeforeDoubleClick);

    await map.focus();
    const beforeKeys = (await snapshot(page)).cameras.three;
    await page.keyboard.press("w");
    await page.keyboard.press("q");
    const afterKeys = (await snapshot(page)).cameras.three;
    expect(Math.hypot(
      afterKeys.targetX - beforeKeys.targetX,
      afterKeys.targetZ - beforeKeys.targetZ,
    )).toBeGreaterThan(0.01);
    expect(afterKeys.yaw).not.toBeCloseTo(beforeKeys.yaw, 4);
  });

  test("makes every navigation model discoverable without covering the map permanently", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    const help = gallery.getByRole("button", { name: "Map navigation help" });
    await help.click();
    const panel = gallery.getByRole("complementary", { name: "Map navigation help" });
    await expect(panel).toContainText("Scroll to pan · pinch to zoom · twist to rotate");
    await expect(panel).toContainText("Shift, middle, or right drag to pan");
    await expect(panel).toContainText("WASD to move · Q/E or arrows to orbit");
    await help.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("keeps workflow navigation and Stop together in the inspector", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "cleaning" });
    await gallery.getByRole("button", { name: /Rooms Pick rooms/ }).click();
    const inspector = gallery.locator(".inspector");
    await expect(inspector.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(inspector.locator(".status-strip").getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(inspector.locator(".primary-stack").getByRole("button", { name: "Stop" })).toHaveCount(0);
    await expect(gallery.getByRole("banner").getByText("Cleaning", { exact: true })).toHaveCount(0);
  });

  test("uses one ordered room list for plan selection and per-room settings", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: /Plans Run or edit/ }).click();
    const inspector = gallery.locator(".inspector");
    const list = inspector.getByLabel("Plan rooms");
    await expect(list).toHaveCount(1);
    await expect(inspector.getByLabel("Room order and settings")).toHaveCount(0);
    await expect(list.locator(".room")).toHaveCount(4);
    await expect(list.locator('.room[data-selected="true"]')).toHaveCount(3);
    await expect(list.getByLabel("Cleaning system")).toHaveCount(3);
    await expect(inspector.locator("details")).toHaveCount(0);
    expect(await inspector.locator(".plan-options").evaluate((options) =>
      Boolean(options.compareDocumentPosition(options.parentElement.querySelector('[aria-label="Plan rooms"]')) & Node.DOCUMENT_POSITION_FOLLOWING),
    )).toBe(true);
  });

  test("keeps Stop reachable while paused and strips transition Full map to safety controls", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "paused" });
    await gallery.getByRole("button", { name: "Full map" }).click();
    await expect(gallery.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Stop" })).toBeVisible();

    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      const galleryElement = document.querySelector(tag);
      galleryElement.replaceWorkspaceState({
        ...module.createGalleryState("transition"),
        fullMap: true,
      });
    }, GALLERY_TAG);
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(gallery.locator(".map-tools button")).toHaveCount(1);
    await expect(gallery.getByRole("button", { name: "Full map" })).toHaveText("Close");
    await expect(gallery.locator(".full-map-hud")).toContainText("Locating");
    await expect(gallery.locator(".map-message")).toHaveCount(0);
  });

  test("uses identical map math for the brush cursor and scale", async ({ page }) => {
    await page.goto("/");
    const combinations = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const samples = [
        [100, 0.2],
        [100, 2.5],
        [400, 0.2],
        [400, 2.5],
        [1000, 0.6],
        [1000, 2.5],
      ];
      return samples.map(([zoom, brush]) => {
        const base = module.createGalleryState("draw");
        const state = {
          ...base,
          draw: { ...base.draw, zoomPercent: zoom, brushMeters: brush },
        };
        const scale = module.mapScale(state);
        return {
          zoom,
          brush,
          cursor: module.brushCursorPixels(state),
          expected: brush * (scale.pixels / scale.meters),
        };
      });
    });

    for (const sample of combinations) {
      expect(sample.cursor).toBeCloseTo(sample.expected, 8);
    }
  });

  test("fits all six 44px Draw tools without horizontal overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    const gallery = await loadGallery(page, { scenario: "draw", narrow: true });
    const tools = gallery.locator(".draw-tools button");
    await expect(tools).toHaveCount(6);
    for (let index = 0; index < 6; index += 1) {
      const bounds = await tools.nth(index).boundingBox();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
    const sheet = await gallery.locator(".mobile-sheet").boundingBox();
    const drawTools = await gallery.locator(".draw-tools").boundingBox();
    expect(drawTools.y + drawTools.height).toBeLessThanOrEqual(sheet.y + 1);
  });

  test("restores classic display controls without compromising the map-first shell", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });

    await gallery.getByRole("complementary").getByRole("button", { name: /Rooms Pick rooms and clean them now/ }).click();
    await gallery.getByRole("button", { name: "2D", exact: true }).click();
    await gallery.getByRole("button", { name: "Rooms", exact: true }).last().click();
    await expect.poll(async () => (await snapshot(page)).appearance).toBe("rooms");

    await gallery.getByRole("button", { name: "More map options" }).click();
    await gallery.getByLabel("Scene detail").selectOption("maximum");
    await expect.poll(async () => (await snapshot(page)).quality).toBe("maximum");

    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    await gallery.getByRole("button", { name: "Rotate right" }).click();
    await expect.poll(async () => (await snapshot(page)).cameras.three?.yaw ?? null)
      .not.toBeNull();
  });

  test("makes the first cleaning decision explicit without a phantom Run plan action", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });

    await expect(gallery.getByRole("heading", { name: "Start cleaning" })).toBeVisible();
    await expect(gallery.getByLabel("Choose robot")).toHaveCount(0);
    await expect(gallery.getByLabel("Choose floor", { exact: true })).toBeVisible();
    await expect(gallery.getByLabel("Choose floor", { exact: true })).toBeEnabled();
    await expect(gallery.getByLabel("Choose floor", { exact: true }).locator("option"))
      .toHaveText(["House", "Shed", "Annex · Visit floor to capture"]);
    await expect(gallery.getByLabel("Choose floor", { exact: true }).locator('option[value="saved-2"]'))
      .toBeDisabled();
    await expect(gallery.getByRole("button", { name: /Rooms Pick rooms and clean them now/ })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /Plans Run or edit a saved routine/ })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /Custom areas Use or draw a precise outline/ })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /History Browse earlier floor maps/ })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Run plan", exact: true })).toHaveCount(0);

    await gallery.getByLabel("Choose floor", { exact: true }).selectOption("saved-1");
    await expect.poll(async () => (await snapshot(page)).selection.floorId).toBe("saved-1");
    await gallery.getByLabel("Choose floor", { exact: true }).selectOption("current");
    await expect.poll(async () => (await snapshot(page)).selection.floorId).toBe("current");

    await gallery.getByRole("button", { name: /Rooms Pick rooms and clean them now/ }).click();
    await expect(gallery.getByRole("heading", { name: "Choose rooms" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Choose rooms", exact: true })).toBeDisabled();
  });

  test("keeps first-use supporting copy at AA contrast in light and dark themes", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });

    const contrastRatios = async (selector) => gallery.locator(selector).evaluateAll((elements) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (color) => {
        const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        const rgb = color.startsWith("color(srgb") ? values.map((value) => value * 255) : values;
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
      };
      return elements.map((element) => {
        const foreground = luminance(getComputedStyle(element).color);
        const background = luminance(getComputedStyle(element.closest("button, select")).backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });

    expect(Math.min(...await contrastRatios(".quick-copy small"))).toBeGreaterThanOrEqual(4.5);
    expect(Math.min(...await contrastRatios(".floor-switcher"))).toBeGreaterThanOrEqual(4.5);
    await gallery.evaluate((element) => element.setScenario("draw"));
    expect(Math.min(...await contrastRatios(".list-button small"))).toBeGreaterThanOrEqual(4.5);
    await gallery.evaluate((element) => element.setScenario("ready"));
    await gallery.evaluate((element) => {
      element.style.setProperty("--card-background-color", "#11181c");
      element.style.setProperty("--secondary-background-color", "#192126");
      element.style.setProperty("--primary-text-color", "#f1f5f7");
      element.style.setProperty("--secondary-text-color", "#a8b5bc");
      element.style.setProperty("--primary-color", "#42a5f5");
    });
    expect(Math.min(...await contrastRatios(".quick-copy small"))).toBeGreaterThanOrEqual(4.5);
    expect(Math.min(...await contrastRatios(".floor-switcher"))).toBeGreaterThanOrEqual(4.5);
    await gallery.evaluate((element) => element.setScenario("draw"));
    expect(Math.min(...await contrastRatios(".list-button small"))).toBeGreaterThanOrEqual(4.5);
  });

  test("uses a neutral map surface without a decorative glow", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await expect(gallery.locator(".map-root")).toHaveCSS("background-image", "none");
  });

  test("responds within one interaction budget and reads canvas geometry once per frame", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getBoundingClientRect;
      window.__canvasRectReads = 0;
      HTMLCanvasElement.prototype.getBoundingClientRect = function measuredBounds() {
        window.__canvasRectReads += 1;
        return original.call(this);
      };
    });
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async (tag) => {
      await customElements.whenDefined(tag);
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = "ready";
      document.body.style.margin = "0";
      document.body.append(gallery);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.__canvasRectReads = 0;
    }, GALLERY_TAG);
    const gallery = page.locator(GALLERY_TAG);

    const geometryReads = await gallery.evaluate(async (element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const map = shell.shadowRoot.querySelector("matic-map-canvas-v4");
      window.__canvasRectReads = 0;
      map.shadowRoot.querySelector(".map-tools button").click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.__canvasRectReads;
    });
    expect(geometryReads).toBeLessThanOrEqual(2);

    const response = await gallery.evaluate(async (element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const rooms = shell.shadowRoot.querySelector(".quick-actions button");
      const started = performance.now();
      rooms.click();
      await shell.updateComplete;
      return {
        duration: performance.now() - started,
        workflow: element.getWorkspaceSnapshot().workflow,
      };
    });
    expect(response.workflow).toBe("rooms");
    expect(response.duration).toBeLessThan(100);
  });

  test("clears a drawn area reversibly and exposes official cleaning-mode wording", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const before = await snapshot(page);
    expect(before.draw.circles.length).toBeGreaterThan(0);

    await gallery.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBe(0);
    await gallery.getByRole("button", { name: /Undo/ }).click();
    await expect.poll(async () => (await snapshot(page)).draw.circles.length)
      .toBe(before.draw.circles.length);

    await gallery.evaluate((element) => element.setScenario("rooms"));
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("rooms");
    const inspector = gallery.locator(".inspector");
    await expect(inspector.getByLabel("Cleaning system for room")).toHaveCount(0);
    await inspector.getByRole("checkbox", { name: "Kitchen" }).check();
    await expect(inspector.getByLabel("Cleaning system for room")).toBeVisible();
    await expect(inspector.getByLabel("Cleaning system for room")).toHaveValue("vacuum");
    const mode = inspector.getByLabel("Cleaning mode for room");
    await expect(mode).toHaveValue("standard");
    await expect(mode.locator("option")).toHaveText(["Quick", "Optimal", "Heavy Duty"]);
  });

  test("selects a requested robot deterministically", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const adapter = new module.HassAdapter();
      const hass = {
        connected: true,
        language: "en",
        user: { id: "user", is_admin: true },
        states: {
          "vacuum.first": { state: "docked", attributes: { matic_entry_id: "entry-a", friendly_name: "First" } },
          "vacuum.second": { state: "idle", attributes: { matic_entry_id: "entry-b", friendly_name: "Second" } },
          "sensor.stale_entry": { state: "ready", attributes: { matic_entry_id: "not-a-robot" } },
        },
      };
      const first = adapter.project(hass, undefined, "entry-a");
      const second = adapter.project(hass, undefined, "entry-b");
      return {
        first: [first.entryKey, first.robotLabel],
        second: [second.entryKey, second.robotLabel],
        robots: second.robots.map((robot) => robot.label),
        robotCount: second.host.robotCount,
      };
    });
    expect(result).toEqual({
      first: ["entry-a", "First"],
      second: ["entry-b", "Second"],
      robots: ["First", "Second"],
      robotCount: 2,
    });
  });

  test("shows recharge-and-resume as charging with Stop still available", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const adapter = new module.HassAdapter();
      const projection = adapter.project({
        connected: true,
        language: "en",
        user: { id: "user", is_admin: true },
        states: {
          "vacuum.first": {
            state: "docked",
            attributes: {
              matic_entry_id: "entry-a",
              friendly_name: "First",
              battery_level: 18,
              charging: true,
              recharge_and_resume: true,
            },
          },
        },
      });
      const state = {
        ...module.createGalleryState("ready"),
        activity: projection.activity,
        batteryPercent: projection.batteryPercent,
      };
      return {
        activity: projection.activity,
        action: module.selectPrimaryAction(state),
        canStart: module.canStartMotion(state),
      };
    });
    expect(result).toEqual({
      activity: "recharging",
      action: { id: "stop", label: "Stop", kind: "danger", enabled: true },
      canStart: false,
    });

    const gallery = await loadGallery(page, { scenario: "recharging" });
    await expect(gallery).toContainText("Charging to resume");
    await expect(gallery).toContainText("18% battery");
    await expect(gallery.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  });

  test("hides the robot selector when non-vacuum Matic entities have stale entry metadata", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(() => {
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "entry-a" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "user", is_admin: true },
        states: {
          "vacuum.first": { state: "docked", attributes: { matic_entry_id: "entry-a", friendly_name: "First" } },
          "sensor.stale_entry": { state: "ready", attributes: { matic_entry_id: "not-a-robot" } },
        },
      };
      document.body.append(panel);
    });
    await expect(page.getByLabel("Choose robot")).toHaveCount(0);
  });

  test("routes v0.4 copy through Home Assistant localization", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const strings = {
        map_studio_title: "Mapa Matic",
        v4_navigation_help: "Ayuda de navegación",
        v4_trackpad: "Panel táctil",
        v4_trackpad_help: "Desplázate para mover · pellizca para ampliar · gira para rotar",
      };
      shell.localize = (key) => strings[key.split(".").at(-1)] || key;
      shell.requestUpdate();
    });
    await expect(gallery.getByRole("heading", { name: "Mapa Matic" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Full map" })).toBeVisible();
    const help = gallery.getByRole("button", { name: "Ayuda de navegación" });
    await help.click();
    await expect(gallery.getByRole("complementary", { name: "Ayuda de navegación" }))
      .toContainText("Panel táctil");
    await expect(gallery.getByRole("complementary", { name: "Ayuda de navegación" }))
      .toContainText("Desplázate para mover");
  });

  test("keeps the mobile map usable in RTL", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate((tag) => {
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = "draw";
      gallery.narrow = true;
      document.body.style.margin = "0";
      document.body.append(gallery);
    }, GALLERY_TAG);
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery.getByRole("button", { name: "Clear" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
  });

  test("keeps native browser fullscreen as an optional secondary control", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate(() => {
      window.__v4FullscreenRequested = false;
      Element.prototype.requestFullscreen = async function requestFullscreen() {
        window.__v4FullscreenRequested = this.classList.contains("app");
      };
    });
    await gallery.getByRole("button", { name: "More map options" }).click();
    await gallery.getByRole("menuitem", { name: "Browser full screen" }).click();
    expect(await page.evaluate(() => window.__v4FullscreenRequested)).toBe(true);
  });

  test("projects unrelated Home Assistant updates without service calls", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    const result = await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      let calls = 0;
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      const relevant = {
        "vacuum.synthetic": {
          state: "docked",
          attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
        },
      };
      panel.hass = {
        connected: true,
        language: "en",
        user: { is_admin: true },
        states: relevant,
        callService: () => { calls += 1; },
      };
      document.body.append(panel);
      await panel.updateComplete;
      panel.hass = {
        ...panel.hass,
        states: { ...relevant, "sensor.unrelated": { state: "changed", attributes: {} } },
      };
      await panel.updateComplete;
      return { calls, defined: Boolean(customElements.get("matic-map-panel-v0-4-0")) };
    });
    expect(result).toEqual({ calls: 0, defined: true });
  });

  test("streams a bounded live delta without refetching the full scene", async ({ page }) => {
    const initial = syntheticScene("Initial room", 10);
    const updated = syntheticScene("Updated room", 24);
    const delta = syntheticDelta(initial, updated, 1, 2);
    let catalogRevision = 1;
    let catalogRequests = 0;
    let fullSceneRequests = 0;
    const fullScenePreferCached = [];
    let deltaRequests = 0;
    let failNextDelta = false;
    let poseSessionKey = "a".repeat(64);
    let posePosition = [10, 12];
    let poseFreshness = "live";
    let poseRequests = 0;
    let failNextPose = false;
    let holdDeltaRecoveryScene = false;
    let releaseDeltaRecoveryScene;
    const deltaRecoverySceneGate = new Promise((resolve) => { releaseDeltaRecoveryScene = resolve; });
    let holdNextFullScene = false;
    let releaseHeldFullScene;
    const heldFullSceneGate = new Promise((resolve) => { releaseHeldFullScene = resolve; });
    let releaseFirstDelta;
    const firstDeltaGate = new Promise((resolve) => { releaseFirstDelta = resolve; });
    const catalogEntry = () => ({
      entry_id: "synthetic-entry",
      scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
      delta_url: "/api/matic_robot/slam_delta/synthetic-entry",
      pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
      history_url: "/api/matic_robot/slam_history/synthetic-entry",
      areas_url: "/api/matic_robot/areas/synthetic-entry",
      plans_url: "/api/matic_robot/plans/synthetic-entry",
      map_revision: catalogRevision,
      map_floor_coherent: true,
      map_session_verified: true,
      map_session_key: "a".repeat(64),
      runner_locked: false,
      stop_settle_pending: false,
      active_plan: false,
      native_reconciliation_pending: false,
      native_session_active: false,
      map_complete: true,
      map_truncated: false,
      selected_floor_ordinal: 1,
      map_floor_ordinal: 1,
      history_count: 0,
      history_floor_count: 1,
      map_health: "ready",
      stream_state: "connected",
      stream_failures: 0,
    });
    await page.route("**/api/matic_robot/slam_entries", (route) => {
      catalogRequests += 1;
      const entry = catalogEntry();
      if (catalogRequests === 2) entry.map_revision = 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [entry] }),
      });
    });
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", async (route) => {
      fullSceneRequests += 1;
      fullScenePreferCached.push(route.request().headers()["x-matic-prefer-cached"]);
      if (holdDeltaRecoveryScene && fullSceneRequests === 2) await deltaRecoverySceneGate;
      if (holdNextFullScene) await heldFullSceneGate;
      return route.fulfill({
        status: 200,
        body: catalogRevision === 1 ? initial : updated,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": String(catalogRevision),
          "X-Matic-Floor-Coherent": "1",
          ETag: `"scene-${catalogRevision}"`,
        },
      });
    });
    await page.route("**/api/matic_robot/slam_delta/synthetic-entry?since=*", async (route) => {
      deltaRequests += 1;
      if (failNextDelta) {
        failNextDelta = false;
        return route.fulfill({ status: 503, body: "temporary" });
      }
      if (deltaRequests === 1) {
        await firstDeltaGate;
        catalogRevision = 2;
        return route.fulfill({
          status: 200,
          body: delta,
          headers: {
            "Content-Type": "application/vnd.matic.slam-delta",
            "X-Matic-Base-Revision": "1",
            "X-Matic-Revision": "2",
            "X-Matic-Floor-Coherent": "1",
            ETag: '"scene-2"',
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({
        status: 204,
        headers: {
          "X-Matic-Revision": "2",
          "X-Matic-Floor-Coherent": "1",
        },
      });
    });
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => {
      poseRequests += 1;
      if (failNextPose) {
        failNextPose = false;
        return route.fulfill({ status: 503, body: "temporary" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          position: posePosition,
          source: posePosition ? "latest_pose" : "current_area",
          revision: catalogRevision + 100,
          pose_revision: poseRequests,
          map_floor_coherent: true,
          pose_freshness: poseFreshness,
          map_session_key: poseSessionKey,
        }),
      });
    });
    await page.route("**/api/matic_robot/slam_history/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entry_id: "synthetic-entry",
        live_available: true,
        floors: [{
          id: "current",
          active: true,
          read_only: false,
          live_available: true,
          label: "House",
          snapshots: [],
        }],
      }),
    }));

    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: (path, init) => fetch(path, init),
      };
      document.body.append(panel);
      window.__deltaPanel = panel;
    });

    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().map.exactPose)).toBe(true);
    await page.evaluate(() => {
      window.__poseStayedExact = new Promise((resolve) => {
        const deadline = performance.now() + 750;
        let stayedExact = true;
        const sample = () => {
          const state = window.__deltaPanel.getWorkspaceSnapshot();
          if ((state.resources.scene.value?.revision || 0) >= 2 && !state.map.exactPose) {
            stayedExact = false;
          }
          if (performance.now() >= deadline) resolve(stayedExact);
          else requestAnimationFrame(sample);
        };
        sample();
      });
    });
    releaseFirstDelta();
    await expect.poll(async () => page.evaluate(() => {
      const scene = window.__deltaPanel.getWorkspaceSnapshot().resources.scene.value;
      return { revision: scene?.revision, room: scene?.metadata.rooms[0]?.name };
    })).toEqual({ revision: 2, room: "Updated room" });
    expect(await page.evaluate(() => window.__poseStayedExact)).toBe(true);
    expect(fullSceneRequests).toBe(1);
    expect(fullScenePreferCached).toEqual(["1"]);
    expect(deltaRequests).toBeGreaterThanOrEqual(1);
    await expect.poll(() => catalogRequests, { timeout: 7_000 }).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { revision: state.resources.scene.value?.revision, exactPose: state.map.exactPose };
    })).toEqual({ revision: 2, exactPose: true });
    expect(fullSceneRequests).toBe(1);
    holdDeltaRecoveryScene = true;
    failNextDelta = true;
    await expect.poll(() => fullSceneRequests).toBe(2);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, position: state.resources.pose.value?.position };
    })).toEqual({ exactPose: true, position: [10, 12] });
    releaseDeltaRecoveryScene();
    expect(fullScenePreferCached).toEqual(["1", "1"]);
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().notice)).toBe(null);
    poseFreshness = "coordinator_fallback";
    posePosition = [11, 13];
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return {
        exactPose: state.map.exactPose,
        freshness: state.resources.pose.value?.freshness,
        position: state.resources.pose.value?.position,
      };
    }), { timeout: 5_000 }).toEqual({
      exactPose: true,
      freshness: "coordinator_fallback",
      position: [11, 13],
    });
    posePosition = null;
    const requestsBeforeMissingFallback = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeMissingFallback);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, position: state.resources.pose.value?.position };
    })).toEqual({ exactPose: true, position: [11, 13] });
    poseFreshness = "live";
    const requestsBeforeMissingLivePose = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeMissingLivePose);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return {
        exactPose: state.map.exactPose,
        freshness: state.resources.pose.value?.freshness,
        position: state.resources.pose.value?.position,
      };
    })).toEqual({ exactPose: true, freshness: "coordinator_fallback", position: [11, 13] });
    failNextPose = true;
    const requestsBeforeFailure = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 }).toBeGreaterThan(requestsBeforeFailure);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, position: state.resources.pose.value?.position };
    })).toEqual({ exactPose: true, position: [11, 13] });
    holdNextFullScene = true;
    catalogRevision = 3;
    await expect.poll(() => fullSceneRequests, { timeout: 7_000 }).toBe(3);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return {
        exactPose: state.map.exactPose,
        pose: state.resources.pose.value?.position,
        sceneRevision: state.resources.scene.value?.revision,
        sceneStatus: state.resources.scene.status,
      };
    })).toEqual({
      exactPose: true,
      pose: [11, 13],
      sceneRevision: 2,
      sceneStatus: "loading",
    });
    releaseHeldFullScene();
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().resources.scene.value?.revision)).toBe(3);
    poseSessionKey = "b".repeat(64);
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().map.exactPose), { timeout: 5_000 }).toBe(false);
    await page.evaluate(() => window.__deltaPanel.remove());
  });

  test("retains a verified same-floor scene while a new revision is built", async ({ page }) => {
    const first = syntheticScene("Current room", 10);
    const second = syntheticScene("Updated room", 24);
    let revision = 1;
    let mapComplete = false;
    let sessionVerified = true;
    let sceneRequests = 0;
    let releaseSecond;
    const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
    let plansRequests = 0;
    let releasePlans;
    const plansGate = new Promise((resolve) => { releasePlans = resolve; });
    const entry = () => ({
      entry_id: "synthetic-entry",
      scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
      pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
      history_url: "/api/matic_robot/slam_history/synthetic-entry",
      areas_url: "/api/matic_robot/areas/synthetic-entry",
      plans_url: "/api/matic_robot/plans/synthetic-entry",
      map_revision: revision,
      map_floor_coherent: true,
      map_session_verified: sessionVerified,
      map_session_key: sessionVerified ? "a".repeat(64) : null,
      runner_locked: false,
      stop_settle_pending: false,
      active_plan: false,
      native_reconciliation_pending: false,
      native_session_active: false,
      map_complete: mapComplete,
      map_truncated: false,
      selected_floor_ordinal: 1,
      map_floor_ordinal: 1,
      history_count: 0,
      history_floor_count: 1,
      map_health: mapComplete ? "ready" : "incomplete",
      stream_state: "connected",
      stream_failures: 0,
    });
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [entry()] }),
    }));
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", async (route) => {
      sceneRequests += 1;
      if (sceneRequests > 1) await secondGate;
      return route.fulfill({
        status: 200,
        body: sceneRequests === 1 ? first : second,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": String(sceneRequests === 1 ? 1 : 2),
          "X-Matic-Floor-Coherent": "1",
        },
      });
    });
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        position: null,
        source: "current_area",
        revision,
        pose_revision: revision,
        map_floor_coherent: true,
        pose_freshness: "live",
        map_session_key: "a".repeat(64),
      }),
    }));
    await page.route("**/api/matic_robot/slam_history/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entry_id: "synthetic-entry",
        live_available: true,
        floors: [{ id: "current", active: true, read_only: false, live_available: true, snapshots: [] }],
      }),
    }));
    await page.route("**/api/matic_robot/plans/synthetic-entry", async (route) => {
      plansRequests += 1;
      await plansGate;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rooms: [{ room_id: "room-1", name: "Room" }], plans: [], selected_plan: null }),
      });
    });
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: (path, init) => fetch(path, init),
      };
      document.body.append(panel);
      window.__retainedScene = panel;
    });
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().resources.scene.value?.revision)).toBe(1);
    expect(await page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().map.complete)).toBe(false);
    await page.evaluate(() => {
      const shell = window.__retainedScene.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "open-workflow", workflow: "rooms" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(() => plansRequests).toBe(1);
    expect(await page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return {
        complete: state.map.complete,
        workflow: state.workflow,
        plans: state.resources.plans.status,
        selectedRooms: state.selection.roomIds.length,
      };
    })).toEqual({ complete: false, workflow: "rooms", plans: "loading", selectedRooms: 0 });
    mapComplete = true;
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().map.complete), { timeout: 10_000 }).toBe(true);
    sessionVerified = false;
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return { coherence: state.coherence, plans: state.resources.plans.status };
    }), { timeout: 10_000 }).toEqual({ coherence: "verifying", plans: "loading" });
    releasePlans();
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
    sessionVerified = true;
    revision = 2;
    await expect.poll(() => sceneRequests, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return { workflow: state.workflow, plans: state.resources.plans.status };
    })).toEqual({ workflow: "rooms", plans: "ready" });
    expect(await page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return {
        available: state.map.available,
        status: state.resources.scene.status,
        retainedRevision: state.resources.scene.value?.revision,
      };
    })).toEqual({ available: true, status: "loading", retainedRevision: 1 });
    releaseSecond();
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().resources.scene.value?.revision)).toBe(2);
    await page.evaluate(() => {
      window.__retainedScene.hass = { ...window.__retainedScene.hass, connected: false };
    });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return {
        coherence: state.coherence,
        available: state.map.available,
        exactPose: state.map.exactPose,
        workflow: state.workflow,
        plans: state.resources.plans.status,
        revision: state.resources.scene.value?.revision,
      };
    })).toEqual({
      coherence: "degraded",
      available: true,
      exactPose: false,
      workflow: "rooms",
      plans: "ready",
      revision: 2,
    });
    await page.evaluate(() => {
      window.__retainedScene.hass = { ...window.__retainedScene.hass, connected: true };
    });
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().coherence), { timeout: 10_000 }).toBe("current");
  });

  test("keeps one stable loading surface while a timed-out scene build is rejoined", async ({ page }) => {
    const scene = syntheticScene("Stable room", 18);
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
        callback,
        delay === 60_000 ? 25 : delay,
        ...args,
      );
    });
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async (sceneBytes) => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      let sceneRequests = 0;
      const entry = {
        entry_id: "synthetic-entry",
        scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
        pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
        history_url: "/api/matic_robot/slam_history/synthetic-entry",
        areas_url: "/api/matic_robot/areas/synthetic-entry",
        plans_url: "/api/matic_robot/plans/synthetic-entry",
        map_revision: 1,
        map_floor_coherent: true,
        map_session_verified: true,
        map_session_key: "a".repeat(64),
        runner_locked: false,
        stop_settle_pending: false,
        active_plan: false,
        native_reconciliation_pending: false,
        native_session_active: false,
        map_complete: true,
        map_truncated: false,
        selected_floor_ordinal: 1,
        map_floor_ordinal: 1,
        history_count: 0,
        history_floor_count: 1,
        map_health: "ready",
        stream_state: "connected",
        stream_failures: 0,
      };
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: async (path, init) => {
          // Match Home Assistant's live auth boundary: a native Headers object
          // cannot be merged into the authenticated request, while a plain record
          // is accepted. This guards scene and delta requests against silent 401s.
          if (init?.headers instanceof Headers) {
            return new Response("", { status: 401 });
          }
          if (path === "/api/matic_robot/slam_entries") {
            return new Response(JSON.stringify({ entries: [entry] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (path === entry.scene_url) {
            sceneRequests += 1;
            if (sceneRequests === 1) {
              return new Promise((_resolve, reject) => {
                init.signal.addEventListener("abort", () => {
                  reject(new DOMException("Aborted", "AbortError"));
                }, { once: true });
              });
            }
            return new Response(new Uint8Array(sceneBytes), {
              status: 200,
              headers: {
                "Content-Type": "application/vnd.matic.slam-scene",
                "X-Matic-Revision": "1",
                "X-Matic-Floor-Coherent": "1",
              },
            });
          }
          if (path === entry.pose_url) {
            return new Response(JSON.stringify({
              position: null,
              source: "current_area",
              revision: 1,
              pose_revision: 1,
              map_floor_coherent: true,
              pose_freshness: "live",
              map_session_key: "a".repeat(64),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (path === entry.history_url) {
            return new Response(JSON.stringify({
              entry_id: "synthetic-entry",
              live_available: true,
              floors: [{
                id: "current",
                active: true,
                read_only: false,
                live_available: true,
                label: "House",
                snapshots: [],
              }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("", { status: 404 });
        },
      };
      document.body.append(panel);
      const samples = [];
      const sampler = window.setInterval(() => {
        const state = panel.getWorkspaceSnapshot();
        samples.push({
          scene: state.resources.scene.status,
          available: state.map.available,
        });
      }, 2);
      window.__slowScene = { panel, samples, sampler, get sceneRequests() { return sceneRequests; } };
    }, [...scene]);

    await expect.poll(async () => page.evaluate(() => {
      const state = window.__slowScene.panel.getWorkspaceSnapshot();
      return { status: state.resources.scene.status, available: state.map.available };
    })).toEqual({ status: "ready", available: true });

    const result = await page.evaluate(() => {
      window.clearInterval(window.__slowScene.sampler);
      return {
        requests: window.__slowScene.sceneRequests,
        samples: window.__slowScene.samples,
      };
    });
    expect(result.requests).toBe(2);
    expect(result.samples.some((sample) => sample.scene === "loading")).toBe(true);
    expect(result.samples.some((sample) => sample.scene === "error")).toBe(false);
    expect(result.samples.some((sample) => sample.available && sample.scene !== "ready")).toBe(false);
  });

  test("returns a direct room clean to base instead of using the managed-plan stop", async ({ page }) => {
    const scene = syntheticScene("Direct room", 18);
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async (sceneBytes) => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const calls = [];
      const entry = {
        entry_id: "synthetic-entry",
        scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
        pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
        history_url: "/api/matic_robot/slam_history/synthetic-entry",
        areas_url: "/api/matic_robot/areas/synthetic-entry",
        plans_url: "/api/matic_robot/plans/synthetic-entry",
        map_revision: 1,
        map_floor_coherent: true,
        map_session_verified: true,
        map_session_key: "a".repeat(64),
        runner_locked: false,
        stop_settle_pending: false,
        active_plan: false,
        native_reconciliation_pending: false,
        native_session_active: false,
        map_complete: true,
        map_truncated: false,
        selected_floor_ordinal: 1,
        map_floor_ordinal: 1,
        history_count: 0,
        history_floor_count: 1,
        map_health: "ready",
        stream_state: "connected",
        stream_failures: 0,
      };
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      const hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "cleaning",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        callService: async (...args) => { calls.push(args); },
        fetchWithAuth: async (path) => {
          if (path === "/api/matic_robot/slam_entries") {
            return new Response(JSON.stringify({ entries: [entry] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (path === entry.scene_url) {
            return new Response(new Uint8Array(sceneBytes), {
              status: 200,
              headers: {
                "Content-Type": "application/vnd.matic.slam-scene",
                "X-Matic-Revision": "1",
                "X-Matic-Floor-Coherent": "1",
              },
            });
          }
          if (path === entry.pose_url) {
            return new Response(JSON.stringify({
              position: null,
              source: "current_area",
              revision: 1,
              pose_revision: 1,
              map_floor_coherent: true,
              pose_freshness: "live",
              map_session_key: "a".repeat(64),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (path === entry.history_url) {
            return new Response(JSON.stringify({
              entry_id: "synthetic-entry",
              live_available: true,
              floors: [{ id: "current", active: true, read_only: false, live_available: true, snapshots: [] }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("", { status: 404 });
        },
      };
      panel.hass = hass;
      document.body.append(panel);
      window.__directStop = { panel, calls };
    }, [...scene]);

    await expect.poll(async () => page.evaluate(() =>
      window.__directStop.panel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
    await page.evaluate(() => {
      const shell = window.__directStop.panel.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-action", {
        detail: { id: "stop" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(async () => page.evaluate(() => window.__directStop.calls.length)).toBe(1);
    expect(await page.evaluate(() => window.__directStop.calls[0].slice(0, 2)))
      .toEqual(["vacuum", "return_to_base"]);
  });

  test("fails motion closed when the private catalog reports managed work", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: async (path) => {
          if (path === "/api/matic_robot/slam_entries") {
            return new Response(JSON.stringify({ entries: [{
              entry_id: "synthetic-entry",
              scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
              delta_url: "/api/matic_robot/slam_delta/synthetic-entry",
              pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
              history_url: "/api/matic_robot/slam_history/synthetic-entry",
              areas_url: "/api/matic_robot/areas/synthetic-entry",
              plans_url: "/api/matic_robot/plans/synthetic-entry",
              map_revision: 7,
              map_floor_coherent: true,
              map_session_verified: true,
              map_session_key: "a".repeat(64),
              runner_locked: true,
              stop_settle_pending: false,
              active_plan: false,
              native_reconciliation_pending: false,
              native_session_active: false,
              map_complete: true,
              map_truncated: false,
              selected_floor_ordinal: 1,
              map_floor_ordinal: 1,
              history_count: 0,
              history_floor_count: 1,
              map_health: "ready",
              stream_state: "connected",
              stream_failures: 0,
            }] }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("", { status: 503 });
        },
      };
      document.body.append(panel);
      window.__managedPanel = panel;
    });

    await expect.poll(async () => page.evaluate(() => ({
      catalog: window.__managedPanel.getWorkspaceSnapshot().resources.catalog.status,
      locked: window.__managedPanel.getWorkspaceSnapshot().managedLock,
    }))).toEqual({ catalog: "ready", locked: true });
    expect(await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      return module.canStartMotion(window.__managedPanel.getWorkspaceSnapshot());
    })).toBe(false);
  });
});
