import { expect, test } from "@playwright/test";
import { pointer } from "./touch.mjs";

const ROOMS = [
  {
    room_id: "synthetic-kitchen",
    name: "Test kitchen",
    boundary: [[0, 0], [6, 0], [6, 5], [0, 5]],
  },
  {
    room_id: "synthetic-hall",
    name: "Test hall",
    boundary: [[6, 1], [9, 1], [9, 4], [6, 4]],
  },
];

async function installBrowserDoubles(page) {
  await page.addInitScript(() => {
    class HaIcon extends HTMLElement {}
    class HaSwitch extends HTMLElement {}
    class HaSelector extends HTMLElement {}
    for (const [name, constructor] of [
      ["ha-icon", HaIcon],
      ["ha-switch", HaSwitch],
      ["ha-selector", HaSelector],
    ]) {
      if (!customElements.get(name)) customElements.define(name, constructor);
    }

    // Synthetic PointerEvents do not become active platform pointers. Keep the
    // browser's event dispatch and handlers real while making capture deterministic.
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
  });
}

async function loadAreaEditor(page, value = [], sceneUrl = undefined) {
  await page.goto("/");
  await page.evaluate(() => import("/room-plan-editor-loader.js"));
  await page.evaluate(({ rooms, initialValue, photoSceneUrl }) => {
    window.__authenticatedPaths = [];
    const editor = document.createElement("ha-selector-matic-area");
    editor.hass = {
      locale: { language: "en" },
      localize: () => undefined,
      fetchWithAuth: (path, init = {}) => {
        window.__authenticatedPaths.push(path);
        return fetch(path, {
          ...init,
          headers: {
            ...(init.headers || {}),
            Authorization: "Bearer synthetic-token",
          },
        });
      },
    };
    editor.selector = {
      rooms,
      ...(photoSceneUrl ? { scene_url: photoSceneUrl } : {}),
    };
    editor.value = initialValue;
    document.body.append(editor);
    window.__areaEditor = editor;
  }, { rooms: ROOMS, initialValue: value, photoSceneUrl: sceneUrl });
  await page.locator("ha-selector-matic-area matic-area-editor-impl")
    .waitFor({ state: "attached" });
  await page.evaluate(() => {
    window.__areaImplementation = window.__areaEditor.shadowRoot
      .querySelector("matic-area-editor-impl");
  });
  return page.locator("ha-selector-matic-area");
}

async function loadRoomPlanEditor(page) {
  await page.goto("/");
  await page.evaluate(() => import("/room-plan-editor-loader.js"));
  await page.evaluate((rooms) => {
    window.__roomPlanChanges = [];
    const editor = document.createElement("ha-selector-matic-room-plan");
    editor.hass = { locale: { language: "en" }, localize: () => undefined };
    editor.selector = { rooms };
    editor.value = rooms.map((room) => ({
      room_id: room.room_id,
      included: false,
      cleaning_mode: "vacuum",
      coverage_setting: "standard",
    }));
    editor.addEventListener("value-changed", (event) => {
      window.__roomPlanChanges.push(event.detail.value);
    });
    document.body.append(editor);
  }, ROOMS);
  await page.locator("ha-selector-matic-room-plan matic-room-plan-editor-impl")
    .waitFor({ state: "attached" });
  return page.locator("ha-selector-matic-room-plan");
}

function syntheticScene(roomName = "Synthetic room", pointX = 10) {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms: roomName === null
      ? []
      : [{ name: roomName, boundary: [[0, 0], [1, 0], [1, 1]], center: [0.3, 0.3] }],
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

test.describe("room-plan editor", () => {
  test("uses reliable native room switches and preserves room settings", async ({ page }) => {
    await installBrowserDoubles(page);
    const editor = await loadRoomPlanEditor(page);
    const kitchen = editor.getByLabel("Include Test kitchen");

    await expect(kitchen).not.toBeChecked();
    await editor.locator(".room .switch").first().click();
    await expect(kitchen).toBeChecked();
    await expect(editor.locator(".settings")).toHaveCount(1);
    expect(await page.evaluate(() => window.__roomPlanChanges.at(-1)[0])).toEqual({
      room_id: "synthetic-kitchen",
      included: true,
      cleaning_mode: "vacuum",
      coverage_setting: "standard",
    });

    await kitchen.press("Space");
    await expect(kitchen).not.toBeChecked();
    await expect(editor.locator(".settings")).toHaveCount(0);
  });
});

test.describe("custom-area editor", () => {
  test.beforeEach(async ({ page }) => installBrowserDoubles(page));

  test("paint, erase, Undo, Redo, and reversible Clear update one area", async ({ page }) => {
    const editor = await loadAreaEditor(page);
    const map = editor.locator(".map");
    await expect(map).toBeVisible();
    await expect(editor.locator(".room-label")).toHaveCount(2);

    const bounds = await map.boundingBox();
    expect(bounds).not.toBeNull();
    const centerX = bounds.x + bounds.width * 0.42;
    const centerY = bounds.y + bounds.height * 0.52;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 70, centerY, { steps: 4 });
    await page.mouse.up();

    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length))
      .toBeGreaterThan(1);
    const paintedPoints = await page.evaluate(() => window.__areaEditor.value.length);
    await expect(editor.locator(".marks circle")).toHaveCount(paintedPoints);
    expect(await editor.locator(".undo").evaluate((button) => {
      const event = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      button.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(false);
    await editor.locator(".undo").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length)).toBe(0);
    await editor.locator(".redo").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length))
      .toBe(paintedPoints);
    await editor.locator("[data-tool=erase]").click();
    await page.mouse.click(centerX, centerY);
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length))
      .toBeLessThan(paintedPoints);
    await editor.locator(".undo").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length))
      .toBe(paintedPoints);
    await editor.locator(".clear").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length)).toBe(0);
    await editor.locator(".undo").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length))
      .toBe(paintedPoints);
  });

  test("full-screen workspace tracks a mobile viewport and restores page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 760 });
    const editor = await loadAreaEditor(page);
    const workspace = editor.locator(".workspace");
    await expect(workspace).toBeVisible();
    const bounds = await workspace.boundingBox();
    expect(bounds.width).toBeGreaterThanOrEqual(425);
    expect(bounds.height).toBeGreaterThanOrEqual(755);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await editor.locator(".expand").click();
    await expect(workspace).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
    await editor.locator(".launcher").click();
    await expect(workspace).toBeVisible();
  });

  test("renders the authenticated photo map and keeps drawing overlays aligned", async ({ page }) => {
    const sceneUrl = "/api/matic_robot/slam_scene/0123456789abcdef";
    await page.route(sceneUrl, async (route) => route.fulfill({
      status: 200,
      contentType: "application/vnd.matic.slam-scene",
      body: syntheticScene("Test kitchen", 10),
    }));
    const editor = await loadAreaEditor(page, [], sceneUrl);

    await expect(editor.locator(".photo-status")).toHaveText("Private photo map");
    await expect(editor.locator(".map")).toHaveAttribute("data-layer", "photo");
    await expect(editor.locator("[data-layer=hybrid]")).toHaveCount(0);
    await expect(editor.locator(".photo-map")).toHaveAttribute("href", /^blob:/);
    await expect(editor.locator(".photo-map")).toHaveAttribute("x", "0.15");
    await expect(editor.locator(".photo-map")).toHaveAttribute("y", "-1.35");
    await expect(editor.locator(".room").first()).toHaveAttribute(
      "points",
      "0.15,-0.15 0.16499999999999998,-0.15 0.16499999999999998,-0.16499999999999998",
    );
    await expect(editor.locator(".room-label").first()).toBeVisible();
    await expect(editor.locator(".room").nth(1)).toBeHidden();
    expect(await page.evaluate(() => window.__authenticatedPaths)).toEqual([sceneUrl]);

    await editor.locator(".map-options > summary").click();
    await editor.locator("[data-layer=rooms]").click();
    await expect(editor.locator(".map")).toHaveAttribute("data-layer", "rooms");
    await expect(editor.locator(".room").first()).toHaveAttribute(
      "points",
      "0,0 6,0 6,-5 0,-5",
    );
    await expect(editor.locator(".room").nth(1)).toBeVisible();
    await editor.locator("[data-layer=photo]").click();
    await expect(editor.locator(".map")).toHaveAttribute("data-layer", "photo");
  });

  test("falls back to the room map when the private photo scene is unavailable", async ({ page }) => {
    const sceneUrl = "/api/matic_robot/slam_scene/0123456789abcdef";
    await page.route(sceneUrl, async (route) => route.fulfill({ status: 409 }));
    const editor = await loadAreaEditor(page, [], sceneUrl);

    await expect(editor.locator(".photo-status")).toHaveText(
      "Photo map unavailable · showing rooms",
    );
    await expect(editor.locator(".map")).toHaveAttribute("data-layer", "rooms");
    await expect(editor.locator(".room-label")).toHaveCount(2);
  });

  test("matches map navigation with pinch zoom and two-axis trackpad pan", async ({ page }) => {
    const editor = await loadAreaEditor(page);
    const map = editor.locator(".map");
    const before = await map.getAttribute("viewBox");
    await page.evaluate((events) => {
      const mapElement = window.__areaImplementation.shadowRoot.querySelector(".map");
      for (const event of events) {
        mapElement.dispatchEvent(new PointerEvent(event.type, event.init));
      }
    }, [
      pointer("pointerdown", 21, 120, 180),
      pointer("pointerdown", 22, 240, 180),
      pointer("pointermove", 21, 90, 160),
      pointer("pointermove", 22, 290, 210),
      pointer("pointerup", 21, 90, 160),
      pointer("pointerup", 22, 290, 210),
    ]);
    const afterPinch = await map.getAttribute("viewBox");
    expect(afterPinch).not.toBe(before);

    const pinchParts = afterPinch.split(" ").map(Number);
    await map.dispatchEvent("wheel", { deltaX: 32, deltaY: 18, deltaMode: 0 });
    const afterTrackpad = (await map.getAttribute("viewBox")).split(" ").map(Number);
    expect(afterTrackpad[0]).not.toBeCloseTo(pinchParts[0], 5);
    expect(afterTrackpad[1]).not.toBeCloseTo(pinchParts[1], 5);
    expect(afterTrackpad[2]).toBeCloseTo(pinchParts[2], 5);

    await map.dispatchEvent("wheel", { deltaX: 0, deltaY: 120, deltaMode: 0 });
    const afterWheel = (await map.getAttribute("viewBox")).split(" ").map(Number);
    expect(afterWheel[2]).not.toBeCloseTo(afterTrackpad[2], 5);
  });

  test("does not paint when a touch becomes a two-finger map gesture @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const editor = await loadAreaEditor(page);
    await page.evaluate(() => {
      const map = window.__areaImplementation.shadowRoot.querySelector(".map");
      const bounds = map.getBoundingClientRect();
      const syntheticPointer = (type, pointerId, x, y) => ({
        type,
        init: {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          button: 0,
          clientX: bounds.left + bounds.width * x,
          clientY: bounds.top + bounds.height * y,
        },
      });
      const events = [
        syntheticPointer("pointerdown", 41, 0.40, 0.48),
        syntheticPointer("pointermove", 41, 0.45, 0.48),
        syntheticPointer("pointerdown", 42, 0.62, 0.48),
        syntheticPointer("pointermove", 41, 0.34, 0.44),
        syntheticPointer("pointermove", 42, 0.68, 0.52),
        syntheticPointer("pointerup", 41, 0.34, 0.44),
        syntheticPointer("pointerup", 42, 0.68, 0.52),
      ];
      for (const event of events) {
        map.dispatchEvent(new PointerEvent(event.type, event.init));
      }
    });
    expect(await page.evaluate(() => window.__areaEditor.value)).toEqual([]);
    await editor.locator(".fit").click();

    await page.evaluate(() => {
      const map = window.__areaImplementation.shadowRoot.querySelector(".map");
      const bounds = map.getBoundingClientRect();
      const syntheticPointer = (type, x) => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 43,
        pointerType: "touch",
        button: 0,
        clientX: bounds.left + bounds.width * x,
        clientY: bounds.top + bounds.height * 0.52,
      });
      const events = [
        syntheticPointer("pointerdown", 0.42),
        syntheticPointer("pointermove", 0.50),
        syntheticPointer("pointerup", 0.50),
      ];
      for (const event of events) {
        map.dispatchEvent(event);
      }
    });
    const committed = await page.evaluate(() => window.__areaEditor.value.length);
    expect(committed).toBeGreaterThan(0);

    await page.evaluate((events) => {
      const map = window.__areaImplementation.shadowRoot.querySelector(".map");
      for (const event of events) {
        map.dispatchEvent(new PointerEvent(event.type, event.init));
      }
    }, [
      pointer("pointerdown", 44, 220, 330),
      pointer("pointermove", 44, 260, 330),
      pointer("pointercancel", 44, 260, 330),
    ]);
    expect(await page.evaluate(() => window.__areaEditor.value.length)).toBe(committed);
  });

  test("matches native mobile double-tap zoom, drag zoom, and pan momentum @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const editor = await loadAreaEditor(page);
    const map = editor.locator(".map");
    const initialWidth = Number((await map.getAttribute("viewBox")).split(" ")[2]);

    const firstTapCount = await page.evaluate(() => {
      const mapElement = window.__areaImplementation.shadowRoot.querySelector(".map");
      const bounds = mapElement.getBoundingClientRect();
      const x = bounds.left + bounds.width * 0.42;
      const y = bounds.top + bounds.height * 0.52;
      const dispatch = (type, pointerId, clientY = y) => mapElement.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          clientX: x,
          clientY,
        }),
      );
      dispatch("pointerdown", 51);
      dispatch("pointerup", 51);
      const count = window.__areaEditor.value.length;
      dispatch("pointerdown", 52);
      dispatch("pointerup", 52);
      return count;
    });
    expect(firstTapCount).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length)).toBe(0);
    await expect.poll(async () => Number(
      (await map.getAttribute("viewBox")).split(" ")[2],
    )).toBeLessThan(initialWidth * 0.7);

    await editor.locator(".fit").click();
    await page.evaluate(() => {
      const mapElement = window.__areaImplementation.shadowRoot.querySelector(".map");
      const bounds = mapElement.getBoundingClientRect();
      const x = bounds.left + bounds.width * 0.42;
      const y = bounds.top + bounds.height * 0.52;
      const dispatch = (type, pointerId, clientY = y) => mapElement.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          clientX: x,
          clientY,
        }),
      );
      dispatch("pointerdown", 53);
      dispatch("pointerup", 53);
      dispatch("pointerdown", 54);
      dispatch("pointermove", 54, y - 100);
      dispatch("pointerup", 54, y - 100);
    });
    expect(await page.evaluate(() => window.__areaEditor.value)).toEqual([]);
    const dragZoomWidth = Number((await map.getAttribute("viewBox")).split(" ")[2]);
    expect(dragZoomWidth).toBeLessThan(initialWidth * 0.6);

    await editor.locator("[data-tool=pan]").click();
    const releaseX = await page.evaluate(async () => {
      const mapElement = window.__areaImplementation.shadowRoot.querySelector(".map");
      const bounds = mapElement.getBoundingClientRect();
      const y = bounds.top + bounds.height * 0.52;
      const dispatch = (type, clientX) => mapElement.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 55,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          clientX,
          clientY: y,
        }),
      );
      const startX = bounds.left + bounds.width * 0.42;
      dispatch("pointerdown", startX);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      dispatch("pointermove", startX + 55);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      dispatch("pointermove", startX + 90);
      dispatch("pointerup", startX + 90);
      return Number(mapElement.getAttribute("viewBox").split(" ")[0]);
    });
    await expect.poll(async () => Number(
      (await map.getAttribute("viewBox")).split(" ")[0],
    )).not.toBeCloseTo(releaseX, 2);
  });

  test("lazy Configure selectors retain intrinsic block sizing", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => import("/room-plan-editor-loader.js"));
    await page.evaluate((rooms) => {
      const form = document.createElement("div");
      form.style.width = "520px";
      form.style.padding = "16px";
      form.style.display = "grid";
      form.style.gap = "16px";
      const roomPlan = document.createElement("ha-selector-matic-room-plan");
      roomPlan.hass = { locale: { language: "en" }, localize: () => undefined };
      roomPlan.selector = { rooms };
      roomPlan.value = rooms.map(({ room_id }) => ({
        room_id, included: false, cleaning_mode: "vacuum", coverage_setting: "standard",
      }));
      const area = document.createElement("ha-selector-matic-area");
      area.hass = { locale: { language: "en" }, localize: () => undefined };
      area.selector = { rooms };
      area.value = [];
      form.append(roomPlan, area);
      document.body.append(form);
      window.__configureSelectors = { form, roomPlan, area };
    }, ROOMS);
    await page.locator("ha-selector-matic-room-plan matic-room-plan-editor-impl")
      .waitFor({ state: "attached" });
    await page.locator("ha-selector-matic-area matic-area-editor-impl")
      .waitFor({ state: "attached" });
    await expect(page.locator("ha-selector-matic-area .map")).toBeVisible();

    const openLayout = await page.evaluate(() => {
      const { roomPlan, area } = window.__configureSelectors;
      const roomImplementation = roomPlan.shadowRoot.querySelector("matic-room-plan-editor-impl");
      const areaImplementation = area.shadowRoot.querySelector("matic-area-editor-impl");
      const map = areaImplementation.shadowRoot.querySelector(".map").getBoundingClientRect();
      return {
        roomDisplay: getComputedStyle(roomPlan).display,
        roomWidth: roomPlan.getBoundingClientRect().width,
        roomHeight: roomPlan.getBoundingClientRect().height,
        roomImplementationDisplay: getComputedStyle(roomImplementation).display,
        areaDisplay: getComputedStyle(area).display,
        areaWidth: area.getBoundingClientRect().width,
        areaImplementationDisplay: getComputedStyle(areaImplementation).display,
        mapWidth: map.width,
        mapHeight: map.height,
      };
    });
    expect(openLayout.roomDisplay).toBe("block");
    expect(openLayout.roomImplementationDisplay).toBe("block");
    expect(openLayout.areaDisplay).toBe("block");
    expect(openLayout.areaImplementationDisplay).toBe("block");
    expect(openLayout.roomWidth).toBeGreaterThan(450);
    expect(openLayout.roomHeight).toBeGreaterThan(0);
    expect(openLayout.areaWidth).toBeGreaterThan(450);
    expect(openLayout.mapWidth).toBeGreaterThan(450);
    expect(openLayout.mapHeight).toBeGreaterThan(300);

    await page.locator("ha-selector-matic-area .expand").click();
    await expect(page.locator("ha-selector-matic-area .workspace")).not.toBeVisible();
    const collapsedAreaHeight = await page.locator("ha-selector-matic-area")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(collapsedAreaHeight).toBeGreaterThanOrEqual(58);
    expect(collapsedAreaHeight).toBeLessThan(100);
  });

  test("declutters overlapping room labels", async ({ page }) => {
    const editor = await loadAreaEditor(page);
    await page.evaluate(() => {
      window.__areaEditor.selector = {
        rooms: [
          {
            room_id: "first",
            name: "First long room label",
            boundary: [[0, 0], [4, 0], [4, 4], [0, 4]],
          },
          {
            room_id: "second",
            name: "Second long room label",
            boundary: [[0.1, 0], [4.1, 0], [4.1, 4], [0.1, 4]],
          },
        ],
      };
    });
    await expect(editor.locator('.room-label[visibility="visible"]')).toHaveCount(1);
  });
});
