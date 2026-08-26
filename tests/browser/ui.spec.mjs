import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";

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

async function installBrowserDoubles(page, { webgl = false, images = false } = {}) {
  await page.addInitScript(({ enableWebgl, enableImages }) => {
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

    if (enableImages) {
      class SyntheticImage extends EventTarget {
        naturalWidth = 640;
        naturalHeight = 480;
        complete = true;

        get src() {
          return this._src || "";
        }

        set src(value) {
          this._src = value;
          if (value) queueMicrotask(() => this.dispatchEvent(new Event("load")));
        }
      }
      window.Image = SyntheticImage;
    }

    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(kind, options) {
      if (kind !== "webgl2") return nativeGetContext.call(this, kind, options);
      if (!enableWebgl) return null;
      window.__glCalls = [];
      const constants = new Map();
      let nextConstant = 1;
      return new Proxy({}, {
        get(_target, property) {
          if (typeof property === "string" && /^[A-Z0-9_]+$/.test(property)) {
            if (!constants.has(property)) constants.set(property, nextConstant++);
            return constants.get(property);
          }
          if (["createBuffer", "createProgram", "createShader", "createVertexArray", "getUniformLocation"].includes(property)) {
            return () => ({ property });
          }
          if (["getProgramParameter", "getShaderParameter"].includes(property)) {
            return () => true;
          }
          if (["getProgramInfoLog", "getShaderInfoLog"].includes(property)) {
            return () => "";
          }
          return (...args) => window.__glCalls.push([property, args.length]);
        },
      });
    };
  }, { enableWebgl: webgl, enableImages: images });
}

async function loadAreaEditor(page, value = [], sceneUrl = undefined) {
  await page.goto("/");
  await page.addScriptTag({ url: "/room_plan_editor.js" });
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
  return page.locator("ha-selector-matic-area");
}

async function loadRoomPlanEditor(page) {
  await page.goto("/");
  await page.addScriptTag({ url: "/room_plan_editor.js" });
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
  return page.locator("ha-selector-matic-room-plan");
}

async function loadStudio(page, states = {}, { areaEditor = true } = {}) {
  await page.goto("/");
  if (areaEditor) await page.addScriptTag({ url: "/room_plan_editor.js" });
  await page.addScriptTag({ url: "/matic_map_studio.js" });
  await page.evaluate((syntheticStates) => {
    window.__authenticatedPaths = [];
    window.__serviceCalls = [];
    const studio = document.createElement("matic-map-panel-v0-3-1");
    studio.panel = {};
    studio.hass = {
      states: syntheticStates,
      auth: { data: { access_token: "stale-token-must-not-be-used" } },
      localize: () => undefined,
      hassUrl: (path) => path,
      fetchWithAuth: (path, init = {}) => {
        window.__authenticatedPaths.push(path);
        if (!path.startsWith("/")) {
          throw new Error(`authenticated path must be relative: ${path}`);
        }
        return fetch(path, {
          ...init,
          headers: {
            ...(init.headers || {}),
            Authorization: "Bearer synthetic-token",
          },
        });
      },
      callService: (...args) => {
        window.__serviceCalls.push(args);
        return Promise.resolve();
      },
    };
    document.body.append(studio);
    window.__studio = studio;
  }, states);
  return page.locator("matic-map-panel-v0-3-1");
}

function pointer(type, pointerId, x, y) {
  return { type, init: { bubbles: true, cancelable: true, pointerId, pointerType: "touch", isPrimary: pointerId === 11, button: 0, clientX: x, clientY: y } };
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

test.describe("room-plan editor", () => {
  test("uses reliable native room switches and preserves room settings", async ({ page }) => {
    await installBrowserDoubles(page);
    const editor = await loadRoomPlanEditor(page);
    const kitchen = editor.getByLabel("Include Test kitchen");

    await expect(kitchen).not.toBeChecked();
    await kitchen.check({ force: true });
    await expect(kitchen).toBeChecked();
    await expect(editor.locator(".settings")).toHaveCount(1);
    expect(await page.evaluate(() => window.__roomPlanChanges.at(-1)[0])).toEqual({
      room_id: "synthetic-kitchen",
      included: true,
      cleaning_mode: "vacuum",
      coverage_setting: "standard",
    });

    await kitchen.uncheck({ force: true });
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
      const mapElement = window.__areaEditor.shadowRoot.querySelector(".map");
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

  test("does not paint when a touch becomes a two-finger map gesture", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const editor = await loadAreaEditor(page);
    await page.evaluate(() => {
      const map = window.__areaEditor.shadowRoot.querySelector(".map");
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
      const map = window.__areaEditor.shadowRoot.querySelector(".map");
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
      const map = window.__areaEditor.shadowRoot.querySelector(".map");
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

  test("matches native mobile double-tap zoom, drag zoom, and pan momentum", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const editor = await loadAreaEditor(page);
    const map = editor.locator(".map");
    const initialWidth = Number((await map.getAttribute("viewBox")).split(" ")[2]);

    const firstTapCount = await page.evaluate(() => {
      const mapElement = window.__areaEditor.shadowRoot.querySelector(".map");
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
      const mapElement = window.__areaEditor.shadowRoot.querySelector(".map");
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
      const mapElement = window.__areaEditor.shadowRoot.querySelector(".map");
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

test.describe("map studio", () => {
  test("registers current and compatibility panel tags independently", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/matic_map_studio.js" });

    const registrations = await page.evaluate(() => {
      const current = customElements.get("matic-map-panel-v0-3-1");
      const compatibility = customElements.get("matic-map-panel-v0-3-0");
      return {
        current: Boolean(current),
        compatibility: Boolean(compatibility),
        distinct: current !== compatibility,
      };
    });

    expect(registrations).toEqual({
      current: true,
      compatibility: true,
      distinct: true,
    });
  });

  test("creates and runs a photo-map area without leaving the map workspace", async ({ page }) => {
    const sceneUrl = "/api/matic_robot/slam_scene/entry";
    const areasUrl = "/api/matic_robot/areas/entry";
    const plansUrl = "/api/matic_robot/plans/entry";
    let savedArea;
    let planRequests = 0;
    await page.route("/api/matic_robot/slam_entries", async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "entry",
        scene_url: sceneUrl,
        areas_url: areasUrl,
        plans_url: plansUrl,
        area_editor_url: "/matic_robot/test/room-plan-editor.js",
        map_revision: 1,
        map_complete: true,
        map_health: "ready",
      }] }),
    }));
    await page.route(sceneUrl, async (route) => route.fulfill({
      status: 200,
      contentType: "application/vnd.matic.slam-scene",
      body: syntheticScene("Test kitchen", 10),
    }));
    await page.route(plansUrl, async (route) => {
      planRequests += 1;
      const savedPlan = {
        id: "weekday",
        name: "Weekday",
        enabled: true,
        run_behavior: "intelligent",
        rooms: [{
          room_id: "synthetic-kitchen",
          cleaning_mode: "vacuum",
          coverage_setting: "standard",
        }],
        room_order: ["synthetic-kitchen"],
        return_to_base: true,
        finish_current_room: true,
        finish_current_room_threshold: 50,
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rooms: ROOMS.map(({ room_id, name }) => ({ room_id, name })),
          plans: planRequests > 1 ? [savedPlan] : [],
          selected_plan: planRequests > 1 ? "weekday" : null,
        }),
      });
    });
    await page.route(areasUrl, async (route) => {
      if (route.request().method() === "POST") {
        savedArea = JSON.parse(route.request().postData());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "new_area" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scene_url: sceneUrl,
          rooms: ROOMS,
          areas: savedArea ? [{ id: "new_area", status: "current", ...savedArea }] : [],
        }),
      });
    });
    const studio = await loadStudio(page, {
      "vacuum.synthetic": { attributes: { matic_entry_id: "entry" } },
    });

    await studio.locator(".cleaning-plans").click();
    await expect(studio.locator(".areas-workspace")).toBeVisible();
    await expect(studio.locator(".areas-heading h2")).toHaveText("Cleaning");
    await expect(studio.locator(".cleaning-tab-plans")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(studio.locator(".plan-detail")).toBeVisible();
    await studio.locator(".plan-name").fill("Weekday");
    await studio.locator(".plan-finish-room").check();
    await studio.locator("ha-selector-matic-room-plan").evaluate((editor) => {
      editor.value = editor.value.map((room, index) => ({
        ...room,
        included: index === 0,
        coverage_setting: index === 0 ? "heavy_duty" : room.coverage_setting,
      }));
      editor.dispatchEvent(new CustomEvent("value-changed", {
        detail: { value: editor.value },
        bubbles: true,
        composed: true,
      }));
    });
    await expect(studio.locator(".plan-save")).toBeEnabled();
    await studio.locator(".plan-save").click();
    await expect(studio.locator(".plan-feedback")).toHaveText("Plan saved");
    await expect(studio.locator(".plans-list")).toHaveValue("weekday");
    expect((await page.evaluate(() => window.__serviceCalls))[0]).toEqual([
      "matic_robot",
      "save_plan",
      expect.objectContaining({
        name: "Weekday",
        run_behavior: "intelligent",
        finish_current_room: true,
        finish_current_room_threshold: 50,
        rooms: [{
          room: "synthetic-kitchen",
          cleaning_mode: "vacuum",
          coverage_setting: "heavy_duty",
        }],
      }),
      { entity_id: "vacuum.synthetic" },
    ]);
    await studio.locator(".plan-run").click();
    await expect(studio.locator(".plan-feedback")).toHaveText("Plan started");

    await studio.locator(".cleaning-tab-areas").click();
    await expect(studio.locator(".cleaning-tab-areas")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(studio.locator(".area-detail")).toBeVisible();
    await expect(studio.locator("ha-selector-matic-area .map"))
      .toHaveAttribute("data-layer", "photo");
    await expect(studio.locator("ha-selector-matic-area [data-layer=hybrid]"))
      .toHaveCount(0);
    await expect(studio.locator("details.area-settings")).toHaveCount(0);
    await expect(studio.locator(".area-settings")).toBeVisible();
    await expect(studio.locator(".area-settings label")).toHaveText([
      "Cleaning modeVacuumMopVacuum + mop",
      "CoverageQuickOptimalHeavy Duty",
    ]);
    expect(await studio.locator(".area-detail").evaluate((detail) => {
      const map = detail.querySelector("ha-selector-matic-area")
        .shadowRoot.querySelector(".map").getBoundingClientRect();
      const bounds = detail.getBoundingClientRect();
      return map.height / bounds.height;
    })).toBeGreaterThan(0.95);
    await studio.locator(".area-new").click();
    await studio.locator(".area-name").fill("New area");
    await studio.locator(".area-coverage").selectOption("heavy_duty");
    await studio.locator("ha-selector-matic-area").evaluate((editor) => {
      editor.value = [{ x: 0.5, y: 0.5, radius: 0.35 }];
      editor.dispatchEvent(new CustomEvent("value-changed", {
        detail: { value: editor.value },
        bubbles: true,
        composed: true,
      }));
    });
    await expect(studio.locator(".photo-status")).toHaveText("Private photo map");
    await studio.locator(".area-save").click();
    await expect(studio.locator(".area-feedback")).toHaveText("Area saved");
    await expect(studio.locator(".area-feedback"))
      .toHaveAttribute("data-tone", "success");
    await expect(studio.locator(".area-save")).toHaveText("Save area");
    await expect(studio.locator(".areas-status")).toHaveText("1 saved areas");
    expect(savedArea).toMatchObject({
      name: "New area",
      circles: [{ x: 0.5, y: 0.5, radius: 0.35 }],
      cleaning_mode: "vacuum",
      coverage_setting: "heavy_duty",
    });

    await studio.locator(".area-run").click();
    await expect(studio.locator(".areas-status")).toHaveText(
      "Area cleaning started",
    );
    expect((await page.evaluate(() => window.__serviceCalls)).at(-1)).toEqual([
      "matic_robot",
      "clean_area",
      { area: "new_area" },
      { entity_id: "vacuum.synthetic" },
    ]);
    await studio.locator(".areas-close").click();
    await expect(studio.locator(".areas-workspace")).not.toBeVisible();
  });

  test("loads the area editor when Home Assistant opened before the integration", async ({ page }) => {
    const sceneUrl = "/api/matic_robot/slam_scene/entry";
    const areasUrl = "/api/matic_robot/areas/entry";
    const plansUrl = "/api/matic_robot/plans/entry";
    await page.route("/api/matic_robot/slam_entries", async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "entry",
        scene_url: sceneUrl,
        areas_url: areasUrl,
        plans_url: plansUrl,
        area_editor_url: "/matic_robot/test/room-plan-editor.js",
        map_revision: 1,
        map_complete: true,
        map_health: "ready",
      }] }),
    }));
    await page.route(areasUrl, async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scene_url: sceneUrl, rooms: ROOMS, areas: [] }),
    }));
    await page.route(plansUrl, async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rooms: ROOMS.map(({ room_id, name }) => ({ room_id, name })),
        plans: [],
        selected_plan: null,
      }),
    }));
    await page.route("/matic_robot/test/room-plan-editor.js", async (route) => {
      await route.fulfill({ path: new URL("../../custom_components/matic_robot/room_plan_editor.js", import.meta.url).pathname });
    });
    const studio = await loadStudio(page, {}, { areaEditor: false });

    await studio.locator(".cleaning-areas").click();
    await expect(studio.locator(".cleaning-tab-areas")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(studio.locator("ha-selector-matic-area .map")).toBeVisible();
    await expect(studio.locator(".areas-status")).toHaveText("0 saved areas");
  });

  test("confirms a reviewable stale area without repainting it", async ({ page }) => {
    const sceneUrl = "/api/matic_robot/slam_scene/review";
    const areasUrl = "/api/matic_robot/areas/review";
    const circles = [{ x: 0.5, y: 0.5, radius: 0.35 }];
    let confirmed;
    await page.route("/api/matic_robot/slam_entries", async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "review",
        scene_url: sceneUrl,
        areas_url: areasUrl,
        plans_url: "/api/matic_robot/plans/review",
        area_editor_url: "/matic_robot/test/room-plan-editor.js",
        map_revision: 1,
        map_complete: true,
        map_health: "ready",
      }] }),
    }));
    await page.route(sceneUrl, async (route) => route.fulfill({
      status: 200,
      contentType: "application/vnd.matic.slam-scene",
      body: syntheticScene("Review room", 10),
    }));
    await page.route(areasUrl, async (route) => {
      if (route.request().method() === "POST") {
        confirmed = JSON.parse(route.request().postData());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "litter_box" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scene_url: sceneUrl,
          rooms: ROOMS,
          areas: [{
            id: "litter_box",
            name: "Litter box",
            circles,
            cleaning_mode: "vacuum",
            coverage_setting: "standard",
            status: confirmed ? "current" : "geometry_changed",
            can_rebind: !confirmed,
          }],
        }),
      });
    });
    const studio = await loadStudio(page, {
      "vacuum.review": { attributes: { matic_entry_id: "review" } },
    });

    await studio.locator(".cleaning-areas").click();
    await expect(studio.locator(".areas-list option").nth(1))
      .toHaveText("⚠ Litter box");
    await expect(studio.locator(".area-feedback")).toHaveText(
      "Review the saved outline, then confirm it on the current map.",
    );
    await expect(studio.locator(".area-save")).toHaveText(
      "Confirm on current map",
    );
    await expect(studio.locator(".area-save")).toBeEnabled();
    await expect(studio.locator(".area-run")).toBeHidden();
    expect(await studio.locator("ha-selector-matic-area").evaluate(
      (editor) => editor.value,
    )).toEqual(circles);

    await studio.locator(".area-save").click();

    await expect(studio.locator(".area-feedback")).toHaveText("Area saved");
    await expect(studio.locator(".area-save")).toHaveText("Save area");
    await expect(studio.locator(".area-run")).toBeVisible();
    expect(confirmed).toMatchObject({
      area_id: "litter_box",
      name: "Litter box",
      circles,
    });
  });

  test("streams bounded scene deltas without refetching the full map", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const initial = syntheticScene("Initial room", 10);
    const updated = syntheticScene("Updated room", 24);
    const delta = syntheticDelta(initial, updated, 1, 2);
    let fullSceneRequests = 0;
    let deltaRequests = 0;
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/live-scene",
        delta_url: "/live-delta",
        map_revision: 1,
        map_complete: true,
      }] }),
    }));
    await page.route("**/live-scene", (route) => {
      fullSceneRequests += 1;
      return route.fulfill({
        status: 200,
        body: initial,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": "1",
          ETag: '"scene-1"',
        },
      });
    });
    await page.route("**/live-delta?since=*", async (route) => {
      deltaRequests += 1;
      if (deltaRequests === 1) {
        return route.fulfill({
          status: 200,
          body: delta,
          headers: {
            "Content-Type": "application/vnd.matic.slam-delta",
            "X-Matic-Base-Revision": "1",
            "X-Matic-Revision": "2",
            ETag: '"scene-2"',
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({ status: 204 });
    });

    const studio = await loadStudio(page);
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Updated room");
    await expect.poll(() => page.evaluate(() => window.__studio._sceneRevision)).toBe(2);
    expect(fullSceneRequests).toBe(1);
    expect(deltaRequests).toBeGreaterThanOrEqual(1);
    await expect(studio.locator(".scene-canvas")).toBeVisible();
    await page.evaluate(() => window.__studio._stopDeltaStream());
  });

  test("rejects a scene delta that expands past its declared bound", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [] }),
    }));
    await loadStudio(page);
    const compressed = deflateSync(Buffer.alloc(64, 1)).toString("base64");

    const result = await page.evaluate(async (encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (character) =>
        character.charCodeAt(0));
      try {
        await window.__studio._inflateSceneDelta(bytes, 8);
        return "accepted";
      } catch (error) {
        return error.message;
      }
    }, compressed);

    expect(result).toContain("bounds");
  });

  test("recovers a delta stream with a complete scene when the base expires", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const initial = syntheticScene("Initial room", 10);
    const replacement = syntheticScene("Recovered room", 30);
    let updateRequests = 0;
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/fallback-scene",
        delta_url: "/fallback-delta",
        map_revision: 1,
        map_complete: true,
      }] }),
    }));
    await page.route("**/fallback-scene", (route) => route.fulfill({
      status: 200,
      body: initial,
      headers: {
        "Content-Type": "application/vnd.matic.slam-scene",
        "X-Matic-Revision": "1",
      },
    }));
    await page.route("**/fallback-delta?since=*", async (route) => {
      updateRequests += 1;
      if (updateRequests === 1) {
        return route.fulfill({
          status: 200,
          body: replacement,
          headers: {
            "Content-Type": "application/vnd.matic.slam-scene",
            "X-Matic-Revision": "9",
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({ status: 204 });
    });

    await loadStudio(page);
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Recovered room");
    await expect.poll(() => page.evaluate(() => window.__studio._sceneRevision)).toBe(9);
    await page.evaluate(() => window.__studio._stopDeltaStream());
  });

  test("scrubs private map history and returns to the live stream", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const snapshots = [
      {
        id: "snapshot-old",
        created_at: "2026-07-25T08:30:00Z",
        revision: 2,
        point_count: 1,
        scene_url: "/history-old",
      },
      {
        id: "snapshot-new",
        created_at: "2026-07-26T09:45:00Z",
        revision: 6,
        point_count: 1,
        scene_url: "/history-new",
      },
    ];
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/timeline-live",
        history_url: "/timeline-history",
        history_count: snapshots.length,
        map_revision: 10,
        map_complete: true,
      }] }),
    }));
    await page.route("**/timeline-history", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ snapshots }),
    }));
    await page.route("**/timeline-live", (route) => route.fulfill({
      status: 200,
      body: syntheticScene("Live room", 40),
      headers: {
        "Content-Type": "application/vnd.matic.slam-scene",
        "X-Matic-Revision": "10",
      },
    }));
    await page.route("**/history-old", (route) => route.fulfill({
      status: 200,
      body: syntheticScene("Old room", 8),
      headers: { "Content-Type": "application/vnd.matic.slam-scene" },
    }));
    await page.route("**/history-new", (route) => route.fulfill({
      status: 200,
      body: syntheticScene("Recent room", 16),
      headers: { "Content-Type": "application/vnd.matic.slam-scene" },
    }));

    const studio = await loadStudio(page);
    const timeline = studio.locator(".timeline");
    await expect(timeline).toBeVisible();
    await expect(timeline.locator(".timeline-live")).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.__studio._setPoseStatus("current_area"));
    await expect(studio.locator(".pose-status")).toBeVisible();
    expect(await timeline.locator(".timeline-summary").evaluate((summary) => {
      const event = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      summary.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(false);
    expect(await timeline.locator(".timeline-earlier").evaluate((button) => {
      const event = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      button.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(false);
    await timeline.locator(".timeline-summary").click();
    await expect(timeline).toHaveAttribute("open", "");
    await expect(timeline.locator(".timeline-panel")).toBeVisible();
    expect(await timeline.evaluate((element) => {
      const viewport = element.closest(".viewport").getBoundingClientRect();
      const panel = element.querySelector(".timeline-panel").getBoundingClientRect();
      return panel.top >= viewport.top && panel.bottom <= viewport.bottom;
    })).toBe(true);
    await timeline.locator(".timeline-earlier").click();
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Recent room");
    await expect(studio.locator(".pose-status")).toBeHidden();
    await expect(studio.locator(".status")).toContainText("Map captured");
    await timeline.locator(".timeline-earlier").click();
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Old room");
    await expect(timeline.locator(".timeline-earlier")).toBeDisabled();
    await timeline.locator(".timeline-live").click();
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Live room");
    await expect(timeline.locator(".timeline-live")).toHaveAttribute("aria-pressed", "true");
  });

  test("offers retained floors as explicit read-only map choices", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const savedSnapshot = {
      id: "snapshot-saved-floor",
      created_at: "2026-07-25T08:30:00Z",
      revision: 2,
      point_count: 1,
      scene_url: "/saved-floor-scene",
    };
    const currentSnapshot = {
      id: "snapshot-current-floor",
      created_at: "2026-07-26T08:30:00Z",
      revision: 9,
      point_count: 1,
      scene_url: "/current-floor-history",
    };
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/current-floor-scene",
        history_url: "/floor-history",
        history_count: 1,
        history_floor_count: 2,
        map_revision: 10,
        map_complete: true,
      }] }),
    }));
    await page.route("**/floor-history", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        snapshots: [currentSnapshot],
        floors: [
          {
            id: "current",
            active: true,
            read_only: false,
            live_available: true,
            snapshots: [currentSnapshot],
          },
          {
            id: "saved-1",
            active: false,
            read_only: true,
            ordinal: 1,
            snapshots: [savedSnapshot],
          },
        ],
      }),
    }));
    await page.route("**/current-floor-scene", (route) => route.fulfill({
      status: 200,
      body: syntheticScene("Current floor room", 40),
      headers: { "Content-Type": "application/vnd.matic.slam-scene" },
    }));
    await page.route("**/saved-floor-scene", (route) => route.fulfill({
      status: 200,
      body: syntheticScene("Saved floor room", 8),
      headers: { "Content-Type": "application/vnd.matic.slam-scene" },
    }));

    const studio = await loadStudio(page);
    const floorSelect = studio.locator(".floor-select");
    await expect(floorSelect).toBeVisible();
    await expect(floorSelect.locator("option")).toHaveText([
      "Current floor",
      "Saved floor 1 · read only",
    ]);
    await studio.locator(".timeline-summary").click();
    await floorSelect.selectOption("saved-1");
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Saved floor room");
    await expect(studio.locator(".status")).toContainText(
      "Saved floor 1",
    );
    await expect(studio.locator(".status")).toContainText("read only");
    await expect(studio.locator(".timeline-live")).toBeHidden();
    await expect(studio.locator(".cleaning-plans")).toBeDisabled();
    await expect(studio.locator(".cleaning-areas")).toBeDisabled();

    await floorSelect.selectOption("current");
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Current floor room");
    await expect(studio.locator(".timeline-live")).toBeVisible();
    await expect(studio.locator(".cleaning-plans")).toBeEnabled();
    await expect(studio.locator(".cleaning-areas")).toBeEnabled();

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await studio.evaluate((element) => {
      const header = element.shadowRoot.querySelector("header").getBoundingClientRect();
      const select = element.shadowRoot.querySelector(".floor-select").getBoundingClientRect();
      return {
        headerHeight: header.height,
        selectHeight: select.height,
        contained: select.left >= header.left && select.right <= header.right,
      };
    });
    expect(mobileLayout.headerHeight).toBe(56);
    expect(mobileLayout.selectHeight).toBeGreaterThanOrEqual(38);
    expect(mobileLayout.contained).toBe(true);
  });

  test("repairs self-intersecting room perimeters before projection", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    const boundary = await studio.evaluate((element) =>
      element._normaliseMetadata({
        meters_per_cell: 0.015,
        span_cells: [100, 80],
        origin_cells: [0, 0],
        sample_step: 1,
        rooms: [{
          name: "Synthetic room",
          boundary: [[0, 0], [6, 5], [6, 0], [0, 5]],
          center: [3, 2.5],
        }],
      }).rooms[0].boundary,
    );
    expect(boundary).toEqual([[0, 0], [6, 0], [6, 5], [0, 5]]);
  });

  test("splits dense room traces instead of drawing false closing chords", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    const contours = await studio.evaluate((element) =>
      element._normaliseMetadata({
        meters_per_cell: 0.015,
        span_cells: [100, 80],
        origin_cells: [0, 0],
        sample_step: 1,
        rooms: [{
          name: "Synthetic dense room",
          boundary: [
            ...Array.from({ length: 40 }, (_, index) => [index, 0]),
            ...Array.from({ length: 40 }, (_, index) => [100 + index, 20]),
          ],
          center: [50, 10],
        }],
      }).rooms[0].contours,
    );
    expect(contours).toHaveLength(2);
    expect(contours.map((contour) => contour.closed)).toEqual([false, false]);
    expect(contours.map((contour) => contour.points.length)).toEqual([40, 40]);
  });

  test("preserves explicit closed room contours with long raster edges", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    const contours = await studio.evaluate((element) =>
      element._normaliseMetadata({
        meters_per_cell: 0.015,
        span_cells: [200, 160],
        origin_cells: [0, 0],
        sample_step: 1,
        rooms: [{
          name: "Synthetic clipped room",
          boundary: [
            ...Array.from({ length: 35 }, (_, index) => [index, index % 2]),
            [120, 2],
            ...Array.from({ length: 35 }, (_, index) => [120 - index, 80]),
            [0, 2],
          ],
          boundary_closed: true,
          center: [60, 40],
        }],
      }).rooms[0].contours,
    );
    expect(contours).toHaveLength(1);
    expect(contours[0].closed).toBe(true);
    expect(contours[0].points).toHaveLength(72);
  });

  test("keeps a complete map under the live pose while a new mission rebuilds", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    let currentComplete = true;
    let revision = 1;
    let deltaRequests = 0;
    let stableRequests = 0;
    const snapshot = {
      id: "snapshot-stable",
      created_at: "2026-07-26T09:45:00Z",
      revision: 1,
      point_count: 1000,
      scene_url: "/stable-map",
    };
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/rebuilding-map",
        pose_url: "/live-pose",
        history_url: "/stable-history",
        history_count: 1,
        map_revision: revision,
        map_complete: currentComplete,
        ...(currentComplete ? {} : { delta_url: "/rebuilding-delta" }),
      }] }),
    }));
    await page.route("**/stable-history", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ snapshots: [snapshot] }),
    }));
    await page.route("**/stable-map", (route) => {
      stableRequests += 1;
      return route.fulfill({
        status: 200,
        body: syntheticScene("Complete retained room", 16),
        headers: { "Content-Type": "application/vnd.matic.slam-scene" },
      });
    });
    await page.route("**/rebuilding-map", (route) => route.fulfill({
      status: 200,
      body: syntheticScene(
        currentComplete ? "Complete current room" : "Partial current room",
        32,
      ),
      headers: {
        "Content-Type": "application/vnd.matic.slam-scene",
        "X-Matic-Revision": String(revision),
      },
    }));
    await page.route("**/live-pose", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ position: [0.3, 0.3], source: "exact_pose" }),
    }));
    await page.route("**/rebuilding-delta?since=*", (route) => {
      deltaRequests += 1;
      return route.fulfill({ status: 204 });
    });

    const studio = await loadStudio(page);
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Complete current room");
    expect(stableRequests).toBe(0);

    currentComplete = false;
    revision = 2;
    await page.evaluate(() => window.__studio._update());
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Complete retained room");
    await expect(studio.locator(".status")).toContainText("last complete map");
    await expect(studio.locator(".timeline-live")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.__studio._robot?.source)).toBe("exact_pose");
    expect(await page.evaluate(() => ({
      sceneUrl: window.__studio._sceneUrl,
      stableId: window.__studio._stableLiveSnapshotId,
    }))).toEqual({ sceneUrl: "/stable-map", stableId: "snapshot-stable" });
    expect(deltaRequests).toBe(0);
    await page.evaluate(() => window.__studio._update());
    await expect.poll(() => page.evaluate(() => window.__studio._sceneLoading)).toBe(false);
    expect(stableRequests).toBe(1);

    currentComplete = true;
    revision = 3;
    await page.evaluate(() => window.__studio._update());
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene?.metadata?.rooms?.[0]?.name,
    )).toBe("Complete current room");
    expect(await page.evaluate(() => ({
      sceneUrl: window.__studio._sceneUrl,
      stableId: window.__studio._stableLiveSnapshotId,
    }))).toEqual({ sceneUrl: "/rebuilding-map", stableId: undefined });
    await expect(studio.locator(".status")).toContainText("points · full capture");
  });

  test("never reuses a previous-floor snapshot during a floor transition", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    let previousFloorRequests = 0;
    let transitionFloorRequests = 0;
    const snapshot = {
      id: "snapshot-previous-floor",
      created_at: "2026-07-26T09:45:00Z",
      revision: 1,
      point_count: 1,
      scene_url: "/previous-floor-scene",
    };
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/transition-scene",
        history_url: "/transition-history",
        history_count: 1,
        map_revision: 2,
        map_complete: false,
        map_floor_coherent: false,
      }] }),
    }));
    await page.route("**/transition-history", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        live_available: false,
        snapshots: [],
        floors: [
          {
            id: "current",
            active: true,
            read_only: false,
            live_available: false,
            snapshots: [],
          },
          {
            id: "saved-1",
            active: false,
            read_only: true,
            ordinal: 1,
            snapshots: [snapshot],
          },
        ],
      }),
    }));
    await page.route("**/previous-floor-scene", (route) => {
      previousFloorRequests += 1;
      return route.fulfill({
        status: 200,
        body: syntheticScene("Previous floor room", 8),
      });
    });
    await page.route("**/transition-scene", (route) => {
      transitionFloorRequests += 1;
      return route.fulfill({
        status: 200,
        body: syntheticScene(null, 16),
        headers: { "Content-Type": "application/vnd.matic.slam-scene" },
      });
    });

    const studio = await loadStudio(page);
    await expect(studio.locator(".status")).toContainText(
      "Floor transition detected",
    );
    await expect(studio.locator(".scene-canvas")).toBeHidden();
    await expect(studio.locator(".empty")).toContainText(
      "map paused until localization completes",
    );
    await expect(studio.locator(".floor-select").locator("option").first()).toHaveText(
      "Current floor · map settling",
    );
    await expect(
      studio.locator(".floor-select").locator("option").first(),
    ).toHaveAttribute("disabled", "");
    expect(await page.evaluate(() => window.__studio._robot)).toBeUndefined();
    expect(transitionFloorRequests).toBe(0);
    expect(previousFloorRequests).toBe(0);
  });

  test("withholds an incoherent room-camera fallback during a floor transition", async ({ page }) => {
    await installBrowserDoubles(page, { images: true });
    const studio = await loadStudio(page, {
      "camera.synthetic_rooms": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          source: "local_room_map",
          map_floor_coherent: false,
          robot_location_source: "exact_pose",
        },
      },
    });

    await expect(studio.locator(".status")).toContainText(
      "Floor transition detected",
    );
    await expect(studio.locator(".status")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    await expect(studio.locator(".empty")).toContainText(
      "map paused until localization completes",
    );
    await expect(studio.locator(".map-image")).toBeHidden();
    await expect(studio.locator(".pose-status")).toBeHidden();
    expect(await studio.locator(".map-image").getAttribute("src")).toBeNull();
  });

  test("isolates timeline requests when switching robots", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [] }),
    }));
    await page.route("**/history-a", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: [{
          id: "snapshot-a",
          created_at: "2026-07-25T08:30:00Z",
          scene_url: "/scene-a",
        }] }),
      });
    });
    await page.route("**/history-b", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ snapshots: [
        {
          id: "snapshot-external",
          created_at: "2026-07-26T09:00:00Z",
          scene_url: "https://invalid.example/scene",
        },
        {
          id: "snapshot-b",
          created_at: "2026-07-26T09:45:00Z",
          scene_url: "/scene-b",
        },
      ] }),
    }));
    await loadStudio(page);
    await expect.poll(() => page.evaluate(() => window.__studio._catalogReady)).toBe(true);

    const result = await page.evaluate(async () => {
      const first = window.__studio._fetchHistory({ attributes: {
        entry_id: "robot-a",
        history_url: "/history-a",
        history_count: 1,
      } }, true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const second = window.__studio._fetchHistory({ attributes: {
        entry_id: "robot-b",
        history_url: "/history-b",
        history_count: 2,
      } }, true);
      await Promise.allSettled([first, second]);
      return {
        entryId: window.__studio._historyEntryId,
        ids: window.__studio._history.map((snapshot) => snapshot.id),
      };
    });

    expect(result).toEqual({ entryId: "robot-b", ids: ["snapshot-b"] });
  });

  test("renders its controls and supports real pointer drag plus synthetic pinch/twist", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    const viewport = studio.locator(".viewport");
    await expect(viewport).toBeVisible();
    await expect(studio.locator("[data-view]" )).toHaveCount(2);
    await studio.locator(".map-more > summary").click();
    await studio.locator(".map-style").selectOption("rooms");
    await expect.poll(() => page.evaluate(() => window.__studio._view)).toBe("rooms");
    await expect(studio.locator('[data-view="top"]')).toHaveAttribute("aria-pressed", "true");
    await studio.locator('[data-view="three"]').click();
    await studio.locator('[data-view="top"]').click();
    await expect.poll(() => page.evaluate(() => window.__studio._view)).toBe("rooms");
    await page.evaluate(() => window.__studio._setView("three"));
    const before = await page.evaluate(() => ({ ...window.__studio._camera }));

    const bounds = await viewport.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 - 35, { steps: 4 });
    await page.mouse.up();
    const afterDrag = await page.evaluate(() => ({ ...window.__studio._camera }));
    expect(afterDrag.yaw).not.toBeCloseTo(before.yaw, 4);
    expect(afterDrag.pitch).not.toBeCloseTo(before.pitch, 4);

    await page.evaluate((events) => {
      const viewportElement = window.__studio.shadowRoot.querySelector(".viewport");
      for (const event of events) {
        viewportElement.dispatchEvent(new PointerEvent(event.type, event.init));
      }
    }, [
      pointer("pointerdown", 11, 120, 180),
      pointer("pointerdown", 12, 240, 180),
      pointer("pointermove", 11, 95, 150),
      pointer("pointermove", 12, 290, 220),
      pointer("pointerup", 11, 95, 150),
      pointer("pointerup", 12, 290, 220),
    ]);
    const afterPinch = await page.evaluate(() => ({ ...window.__studio._camera }));
    expect(afterPinch.distance).not.toBeCloseTo(afterDrag.distance, 4);
    expect(afterPinch.yaw).not.toBeCloseTo(afterDrag.yaw, 4);

    await page.evaluate(() => {
      const viewportElement = window.__studio.shadowRoot.querySelector(".viewport");
      const start = new Event("gesturestart", { bubbles: true, cancelable: true });
      Object.assign(start, { scale: 1, rotation: 0 });
      viewportElement.dispatchEvent(start);
      const change = new Event("gesturechange", { bubbles: true, cancelable: true });
      Object.assign(change, { scale: 1.3, rotation: 24 });
      viewportElement.dispatchEvent(change);
    });
    const afterGesture = await page.evaluate(() => ({ ...window.__studio._camera }));
    expect(afterGesture.distance).toBeLessThan(afterPinch.distance);
    expect(afterGesture.yaw).not.toBeCloseTo(afterPinch.yaw, 4);
  });

  test("honors reduced motion for view presets", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    await studio.locator('[data-view="top"]').click();
    await expect.poll(() => page.evaluate(() => window.__studio._view)).toBe("top");
    await expect.poll(() => page.evaluate(() => window.__studio._camera.orthographic)).toBe(true);
    expect(await page.evaluate(() => window.__studio._cameraAnimation)).toBeUndefined();
  });

  test("keeps top-down framing aligned, fitted, and planar", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    await page.evaluate(() => window.__studio._zoom(1.5));
    const threeDistance = await page.evaluate(() => window.__studio._camera.distance);
    await studio.locator('[data-view="top"]').click();
    await expect.poll(() => page.evaluate(() => window.__studio._view)).toBe("top");
    const initial = await page.evaluate(() => ({
      ...window.__studio._camera,
      home: window.__studio._homeTopDistance,
    }));
    expect(initial.yaw).toBeCloseTo(0, 6);
    expect(initial.pitch).toBeCloseTo(Math.PI / 2 - 0.018, 6);
    expect(initial.distance).toBeCloseTo(initial.home, 6);

    await studio.locator(".viewport").dispatchEvent("wheel", {
      deltaY: 80,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    await page.evaluate(() => {
      const viewport = window.__studio.shadowRoot.querySelector(".viewport");
      const pointer = (type, pointerId, x, y) => new PointerEvent(type, {
        pointerId,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      viewport.dispatchEvent(pointer("pointerdown", 31, 120, 150));
      viewport.dispatchEvent(pointer("pointerdown", 32, 240, 150));
      viewport.dispatchEvent(pointer("pointermove", 31, 100, 110));
      viewport.dispatchEvent(pointer("pointermove", 32, 260, 220));
      viewport.dispatchEvent(pointer("pointerup", 31, 100, 110));
      viewport.dispatchEvent(pointer("pointerup", 32, 260, 220));
    });
    expect(await page.evaluate(() => window.__studio._camera.pitch)).toBeCloseTo(
      Math.PI / 2 - 0.018,
      6,
    );
    await page.evaluate(() => window.__studio._zoom(1.4));
    const topDistance = await page.evaluate(() => window.__studio._camera.distance);
    await studio.locator('[data-view="three"]').click();
    expect(await page.evaluate(() => window.__studio._camera.distance)).toBeCloseTo(
      threeDistance,
      6,
    );
    await studio.locator('[data-view="top"]').click();
    expect(await page.evaluate(() => window.__studio._camera.distance)).toBeCloseTo(
      topDistance,
      6,
    );
  });

  test("uses a compact native control hierarchy at desktop and mobile widths", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    const desktop = await studio.evaluate((element) => {
      const root = element.shadowRoot;
      const header = root.querySelector("header").getBoundingClientRect();
      const viewport = root.querySelector(".viewport");
      const commandBar = root.querySelector(".map-command-bar");
      const actions = root.querySelector(".map-actions");
      const cleaning = root.querySelector(".cleaning-actions");
      const fit = root.querySelector(".home-view").getBoundingClientRect();
      return {
        headerHeight: header.height,
        commandBarInsideViewport: commandBar.parentElement === viewport,
        secondaryActionsGrouped: actions.parentElement === commandBar,
        cleaningActionsGrouped: cleaning.parentElement === commandBar,
        cleaningSeparated: !actions.contains(root.querySelector(".cleaning-areas")),
        actionRole: actions.getAttribute("role"),
        cleaningLabel: cleaning.getAttribute("aria-label"),
        fitWidth: fit.width,
        fitHeight: fit.height,
        roomOverlayLabel: root.querySelector(".layers .control-label").textContent,
        roomBoundaryDisplay: getComputedStyle(root.querySelector(".room-lines")).display,
        timelineSummary: root.querySelector(".timeline-summary-title").textContent,
        timelineVisible: root.querySelector(".timeline").offsetParent !== null,
        timelineEmpty: root.querySelector(".timeline-panel").dataset.empty,
        plansLabel: root.querySelector(".cleaning-plans .control-label").textContent,
        areaLabel: root.querySelector(".cleaning-areas .control-label").textContent,
        menuOpen: root.querySelector(".map-more").open,
        historyCollapsed: !root.querySelector(".timeline").open,
        viewportRole: viewport.getAttribute("role"),
      };
    });
    expect(desktop).toEqual({
      headerHeight: 64,
      commandBarInsideViewport: true,
      secondaryActionsGrouped: true,
      cleaningActionsGrouped: true,
      cleaningSeparated: true,
      actionRole: "toolbar",
      cleaningLabel: "Cleaning",
      fitWidth: 38,
      fitHeight: 38,
      roomOverlayLabel: "Rooms",
      roomBoundaryDisplay: "block",
      timelineSummary: "History",
      timelineVisible: true,
      timelineEmpty: "true",
      plansLabel: "Plans",
      areaLabel: "Custom areas",
      menuOpen: false,
      historyCollapsed: true,
      viewportRole: "region",
    });

    await studio.locator(".timeline-summary").click();
    await expect(studio.locator(".timeline-empty")).toBeVisible();
    await expect(studio.locator(".timeline-empty")).toContainText(
      "No saved map snapshots yet",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => studio.evaluate((element) => ({
      header: element.shadowRoot.querySelector("header").getBoundingClientRect().height,
      menuOpen: element.shadowRoot.querySelector(".map-more").open,
      cameraStepsVisible: [...element.shadowRoot.querySelectorAll(".camera-step")]
        .some((button) => button.offsetParent !== null),
    }))).toEqual({ header: 56, menuOpen: false, cameraStepsVisible: false });
  });

  test("keeps mobile maps touch-first and moves area settings into a bottom sheet", async ({ page }) => {
    const sceneUrl = "/api/matic_robot/slam_scene/mobile";
    const areasUrl = "/api/matic_robot/areas/mobile";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("/api/matic_robot/slam_entries", async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "mobile",
        scene_url: sceneUrl,
        areas_url: areasUrl,
        plans_url: "/api/matic_robot/plans/mobile",
        area_editor_url: "/matic_robot/test/room-plan-editor.js",
        map_revision: 1,
        map_complete: true,
        map_health: "ready",
      }] }),
    }));
    await page.route(sceneUrl, async (route) => route.fulfill({
      status: 200,
      contentType: "application/vnd.matic.slam-scene",
      body: syntheticScene("Mobile room", 12),
    }));
    await page.route(areasUrl, async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scene_url: sceneUrl, rooms: ROOMS, areas: [] }),
    }));
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page, {
      "vacuum.mobile": { attributes: { matic_entry_id: "mobile" } },
    });

    const mapLayout = await studio.evaluate((element) => {
      const root = element.shadowRoot;
      const viewport = root.querySelector(".viewport").getBoundingClientRect();
      const fit = root.querySelector(".spatial-controls").getBoundingClientRect();
      const actions = root.querySelector(".map-actions").getBoundingClientRect();
      const cleaning = root.querySelector(".cleaning-actions").getBoundingClientRect();
      const overlap = (first, second) => !(
        first.right <= second.left
        || first.left >= second.right
        || first.bottom <= second.top
        || first.top >= second.bottom
      );
      return {
        sliderVisible: root.querySelector(".spatial-controls .zoom-control")
          .offsetParent !== null,
        fitSize: [fit.width, fit.height],
        actionsSize: [actions.width, actions.height],
        cleaningInside: cleaning.left >= viewport.left
          && cleaning.right <= viewport.right
          && cleaning.bottom <= viewport.bottom,
        cleaningInLowerHalf: cleaning.top > viewport.top + viewport.height / 2,
        topControlsOverlap: overlap(fit, actions),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(mapLayout.sliderVisible).toBe(false);
    expect(mapLayout.fitSize[1]).toBeGreaterThanOrEqual(50);
    expect(mapLayout.actionsSize[1]).toBeGreaterThanOrEqual(50);
    expect(mapLayout.cleaningInside).toBe(true);
    expect(mapLayout.cleaningInLowerHalf).toBe(true);
    expect(mapLayout.topControlsOverlap).toBe(false);
    expect(mapLayout.horizontalOverflow).toBe(false);

    const tapStartDistance = await page.evaluate(() => {
      const viewport = window.__studio.shadowRoot.querySelector(".viewport");
      const bounds = viewport.getBoundingClientRect();
      const x = bounds.left + bounds.width * 0.58;
      const y = bounds.top + bounds.height * 0.48;
      const dispatch = (type, pointerId, clientY = y) => viewport.dispatchEvent(
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
      const distance = window.__studio._camera.distance;
      dispatch("pointerdown", 61);
      dispatch("pointerup", 61);
      dispatch("pointerdown", 62);
      dispatch("pointerup", 62);
      return distance;
    });
    await expect.poll(() => page.evaluate(() => window.__studio._camera.distance))
      .toBeLessThan(tapStartDistance * 0.8);

    const dragStartDistance = await page.evaluate(() => {
      window.__studio._applyPreset("three", false);
      const viewport = window.__studio.shadowRoot.querySelector(".viewport");
      const bounds = viewport.getBoundingClientRect();
      const x = bounds.left + bounds.width * 0.58;
      const y = bounds.top + bounds.height * 0.48;
      const dispatch = (type, pointerId, clientY = y) => viewport.dispatchEvent(
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
      const distance = window.__studio._camera.distance;
      dispatch("pointerdown", 63);
      dispatch("pointerup", 63);
      dispatch("pointerdown", 64);
      dispatch("pointermove", 64, y - 90);
      dispatch("pointerup", 64, y - 90);
      return distance;
    });
    expect(await page.evaluate(() => window.__studio._camera.distance))
      .toBeLessThan(dragStartDistance * 0.55);

    const elasticZoom = await page.evaluate(() => {
      window.__studio._applyPreset("three", false);
      const viewport = window.__studio.shadowRoot.querySelector(".viewport");
      const bounds = viewport.getBoundingClientRect();
      const x = bounds.left + bounds.width * 0.58;
      const y = bounds.top + bounds.height * 0.48;
      const dispatch = (type, pointerId, clientY = y) => viewport.dispatchEvent(
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
      dispatch("pointerdown", 65);
      dispatch("pointerup", 65);
      dispatch("pointerdown", 66);
      dispatch("pointermove", 66, y + 300);
      const during = window.__studio._camera.distance;
      const maximum = window.__studio._cameraDistanceBounds().maximum;
      dispatch("pointerup", 66, y + 300);
      return { during, maximum };
    });
    expect(elasticZoom.during).toBeGreaterThan(elasticZoom.maximum);
    await expect.poll(() => page.evaluate(() => window.__studio._camera.distance))
      .toBeLessThanOrEqual(elasticZoom.maximum);

    await studio.locator(".cleaning-areas").click();
    await expect(studio.locator(".area-detail")).toBeVisible();
    const collapsed = await studio.evaluate((element) => {
      const root = element.shadowRoot;
      const workspace = root.querySelector(".areas-workspace").getBoundingClientRect();
      const header = root.querySelector(".areas-header").getBoundingClientRect();
      const sheet = root.querySelector(".area-fields").getBoundingClientRect();
      const editor = root.querySelector("ha-selector-matic-area").shadowRoot;
      const nav = editor.querySelector(".navigation-controls").getBoundingClientRect();
      const tools = editor.querySelector(".tool-picker").getBoundingClientRect();
      return {
        headerHeight: header.height,
        sheetHeight: sheet.height,
        sheetInside: sheet.left >= workspace.left
          && sheet.right <= workspace.right
          && sheet.bottom <= workspace.bottom,
        zoomVisible: editor.querySelector(".zoom-control").offsetParent !== null,
        toolTargets: [...editor.querySelectorAll(".tool-picker button")]
          .map((button) => button.getBoundingClientRect().height),
        toolbarsShareRow: Math.abs(nav.top - tools.top) < 2,
      };
    });
    expect(collapsed.headerHeight).toBeLessThanOrEqual(110);
    expect(collapsed.sheetHeight).toBeLessThanOrEqual(76);
    expect(collapsed.sheetInside).toBe(true);
    expect(collapsed.zoomVisible).toBe(false);
    expect(collapsed.toolTargets.every((height) => height >= 44)).toBe(true);
    expect(collapsed.toolbarsShareRow).toBe(true);

    await studio.locator(".area-sheet-toggle").click();
    await expect(studio.locator(".area-sheet-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(studio.locator(".area-name")).toBeVisible();
    const expandedHeight = await studio.locator(".area-fields").evaluate(
      (sheet) => sheet.getBoundingClientRect().height,
    );
    expect(expandedHeight).toBeGreaterThan(collapsed.sheetHeight + 100);
    await studio.locator(".area-name").fill("Touch area");
    await expect(studio.locator(".area-sheet-title")).toHaveText("Touch area");
    await expect(studio.locator(".area-sheet-summary")).toHaveText(
      "Vacuum · Optimal",
    );
  });

  test("localizes accessible controls and persists per-user view preferences", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("matic-map-studio:v2:synthetic-user", JSON.stringify({
        view: "top",
        labels: false,
        quality: "efficient",
        camera: { yaw: 0.4, pitch: 1.2, distance: 5, targetX: 1, targetZ: -2 },
      }));
    });
    await page.addScriptTag({ url: "/matic_map_studio.js" });
    const translatedTitle = "Synthetic translated studio";
    await page.evaluate((title) => {
      const studio = document.createElement("matic-map-panel-v0-3-1");
      studio.panel = {};
      studio.hass = {
        states: {},
        user: { id: "synthetic-user" },
        language: "synthetic",
        localize: (key) => key.endsWith(".map_studio_title") ? title : undefined,
        auth: { data: { access_token: "synthetic-token" } },
        hassUrl: (path) => path,
      };
      document.body.append(studio);
      window.__studio = studio;
    }, translatedTitle);
    const studio = page.locator("matic-map-panel-v0-3-1");
    await expect(studio.locator("h1")).toHaveText(translatedTitle);
    await expect(studio.locator('[data-view="top"]')).toHaveAttribute("aria-pressed", "true");
    await expect(studio.locator(".status")).toHaveAttribute("aria-live", "polite");
    await expect(studio.locator(".quality")).toHaveValue("efficient");
    await expect(studio.locator(".layers")).toHaveAttribute("aria-pressed", "false");

    await studio.locator(".map-more > summary").click();
    await studio.locator(".quality").selectOption("balanced");
    await studio.locator(".layers").click();
    await expect.poll(() => page.evaluate(() => {
      const saved = JSON.parse(
        localStorage.getItem("matic-map-studio:v3:synthetic-user") || "{}",
      );
      return { view: saved.view, labels: saved.labels, quality: saved.quality };
    })).toEqual({ view: "top", labels: true, quality: "balanced" });
    expect(await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("matic-map-studio:v3:synthetic-user"));
      return Object.keys(saved.cameras).every((view) => ["three", "top"].includes(view))
        && Object.values(saved.cameras).every((camera) => !Object.hasOwn(camera, "distance"));
    })).toBe(true);
  });

  test("uses the authenticated private catalog without requiring camera state", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    let authorization;
    await page.route("**/api/matic_robot/slam_entries", (route) => {
      authorization = route.request().headers().authorization;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [{
          entry_id: "synthetic-entry",
          scene_url: "/synthetic-scene",
          pose_url: "/synthetic-pose",
          map_revision: 4,
          updated_at: "2026-01-01T00:00:00Z",
        }] }),
      });
    });
    await page.route("**/synthetic-scene", (route) => route.fulfill({
      status: 200,
      body: syntheticScene(),
      headers: { "Content-Type": "application/octet-stream", ETag: '"synthetic-catalog-1"' },
    }));
    const studio = await loadStudio(page);
    await expect.poll(() => page.evaluate(() => window.__studio._catalogEntries.length)).toBe(1);
    expect(authorization).toBe("Bearer synthetic-token");
    expect(
      await page.evaluate(() => window.__authenticatedPaths.every(
        (path) => path.startsWith("/"),
      )),
    ).toBe(true);
    expect(await page.evaluate(() => window.__studio._catalogState().attributes.map_revision)).toBe(4);
    await expect(studio.locator(".status")).toContainText("1 points");
    await expect(studio.locator(".scene-canvas")).toBeVisible();

    await page.evaluate(() => {
      const studioElement = window.__studio;
      studioElement._camera.distance = studioElement._cameraDistanceBounds().minimum;
      studioElement._requestRender();
    });
    await expect.poll(() => studio.locator(".zoom-slider").getAttribute("max"))
      .not.toBe("400");
    const zoomRange = await studio.evaluate((element) => {
      const root = element.shadowRoot;
      const slider = root.querySelector(".zoom-slider");
      return {
        maximum: Number(slider.max),
        value: Number(slider.value),
        label: root.querySelector(".zoom-value").textContent,
      };
    });
    expect(zoomRange.maximum).toBeGreaterThan(400);
    expect(zoomRange.value).toBe(zoomRange.maximum);
    expect(zoomRange.label).toBe(`${zoomRange.maximum}%`);
  });

  test("shows room presence without inventing a precise robot marker", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    let pose = { position: [0.15, 0.15], source: "current_area" };
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/room-presence-scene",
        pose_url: "/room-presence-pose",
        map_revision: 1,
        map_complete: true,
      }] }),
    }));
    await page.route("**/room-presence-scene", (route) => route.fulfill({
      status: 200,
      body: syntheticScene(),
      headers: { "Content-Type": "application/octet-stream", ETag: '"room-presence"' },
    }));
    await page.route("**/room-presence-pose", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pose),
    }));

    const studio = await loadStudio(page);
    await expect(studio.locator(".pose-status")).toBeVisible();
    await expect(studio.locator(".pose-status")).toHaveText(
      "Robot is in the current room · exact position unavailable",
    );
    await expect(studio.locator(".robot-marker")).toBeHidden();
    expect(await page.evaluate(() => window.__studio._robot)).toBeUndefined();

    pose = { position: [0.15, 0.15], source: "exact_pose" };
    await page.evaluate(() => window.__studio._update(true));
    await expect(studio.locator(".pose-status")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__studio._robot?.source))
      .toBe("exact_pose");
  });

  test("abandons a stalled catalog and continues from camera state", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.__catalogAborted = false;
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
        callback,
        delay === 10000 ? 25 : delay,
        ...args,
      );
      window.fetch = (input, init = {}) => {
        if (String(input).includes("/api/matic_robot/slam_entries")) {
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              window.__catalogAborted = true;
              reject(new DOMException("Synthetic timeout", "AbortError"));
            }, { once: true });
          });
        }
        return nativeFetch(input, init);
      };
    });
    await page.route("**/synthetic-scene", (route) => route.fulfill({
      status: 200,
      body: syntheticScene(),
      headers: { "Content-Type": "application/octet-stream", ETag: '"synthetic-camera-1"' },
    }));
    const studio = await loadStudio(page, {
      "camera.synthetic_map": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          source: "local_robot_slam",
          scene_url: "/synthetic-scene",
          map_revision: 1,
          map_complete: true,
        },
      },
    });

    await expect(studio.locator(".scene-canvas")).toBeVisible();
    await expect(studio.locator(".status")).toContainText("1 points");
    await expect.poll(() => page.evaluate(() => window.__catalogAborted)).toBe(true);
    expect(await page.evaluate(() => ({
      loading: window.__studio._catalogLoading,
      controller: window.__studio._catalogAbortController,
    }))).toEqual({ loading: false, controller: undefined });
  });

  test("isolates equal-revision robots while scene and pose requests overlap", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true, images: true });
    let alphaSceneCalls = 0;
    let releaseAlphaScene;
    let releaseAlphaPose;
    let markAlphaRefreshStarted;
    let markAlphaPoseStarted;
    let betaIfNoneMatch;
    const alphaSceneRelease = new Promise((resolve) => {
      releaseAlphaScene = resolve;
    });
    const alphaPoseRelease = new Promise((resolve) => {
      releaseAlphaPose = resolve;
    });
    const alphaRefreshStarted = new Promise((resolve) => {
      markAlphaRefreshStarted = resolve;
    });
    const alphaPoseStarted = new Promise((resolve) => {
      markAlphaPoseStarted = resolve;
    });
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [
        {
          entry_id: "alpha",
          scene_url: "/scene-alpha",
          pose_url: "/pose-alpha",
          map_revision: 9,
          map_complete: true,
        },
        {
          entry_id: "beta",
          scene_url: "/scene-beta",
          pose_url: "/pose-beta",
          map_revision: 9,
          map_complete: true,
        },
      ] }),
    }));
    await page.route("**/scene-alpha", async (route) => {
      alphaSceneCalls += 1;
      if (alphaSceneCalls > 1) {
        markAlphaRefreshStarted();
        await alphaSceneRelease;
      }
      try {
        await route.fulfill({
          status: 200,
          body: syntheticScene("Alpha room", 10),
          headers: { "Content-Type": "application/octet-stream", ETag: '"alpha"' },
        });
      } catch (_error) {
        // The entry switch intentionally aborts the superseded request.
      }
    });
    await page.route("**/scene-beta", (route) => {
      betaIfNoneMatch = route.request().headers()["if-none-match"];
      return route.fulfill({
        status: 200,
        body: syntheticScene("Beta room", 20),
        headers: { "Content-Type": "application/octet-stream", ETag: '"beta"' },
      });
    });
    await page.route("**/pose-alpha", async (route) => {
      markAlphaPoseStarted();
      await alphaPoseRelease;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ position: [0.15, 0.15], source: "exact_pose" }),
        });
      } catch (_error) {
        // The entry switch intentionally aborts the superseded request.
      }
    });
    await page.route("**/pose-beta", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ position: [0.3, 0.3], source: "exact_pose" }),
    }));
    const studio = await loadStudio(page, {
      "camera.alpha_rooms": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          matic_entry_id: "alpha",
          robot_location_source: "exact_pose",
          source: "local_room_map",
        },
      },
      "camera.beta_rooms": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          matic_entry_id: "beta",
          robot_location_source: "exact_pose",
          source: "local_room_map",
        },
      },
    });
    await expect.poll(() => page.evaluate(() => window.__studio._sceneUrl)).toBe("/scene-alpha");
    await alphaPoseStarted;

    await page.evaluate(() => window.__studio._update(true));
    await alphaRefreshStarted;
    await page.evaluate(() => {
      window.__studio.panel = { config: { entry_id: "beta" } };
    });
    releaseAlphaScene();
    releaseAlphaPose();

    await expect.poll(() => page.evaluate(() => window.__studio._sceneUrl)).toBe("/scene-beta");
    await expect.poll(() => page.evaluate(() =>
      window.__studio._scene.metadata.rooms[0].name,
    )).toBe("Beta room");
    await expect.poll(() => page.evaluate(() => ({
      source: window.__studio._robot?.source,
      x: window.__studio._robot?.x,
    }))).toEqual({ source: "exact_pose", x: 10 });
    expect(betaIfNoneMatch).toBeUndefined();
    expect(await page.evaluate(() =>
      window.__studio._entities("beta").rooms[0],
    )).toBe("camera.beta_rooms");
  });

  test("purges retained browser map data after the last entry unloads", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    let entries = [{
      entry_id: "synthetic-entry",
      scene_url: "/synthetic-scene",
      pose_url: "/synthetic-pose",
      map_revision: 1,
      map_complete: true,
    }];
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries }),
    }));
    await page.route("**/synthetic-scene", (route) => route.fulfill({
      status: 200,
      body: syntheticScene(),
      headers: { "Content-Type": "application/octet-stream", ETag: '"private-scene"' },
    }));
    const studio = await loadStudio(page);
    await expect(studio.locator(".scene-canvas")).toBeVisible();
    await expect(studio.locator(".room-label")).toHaveCount(1);

    entries = [];
    await page.evaluate(() => window.__studio._update());

    await expect(studio.locator(".scene-canvas")).toBeHidden();
    await expect(studio.locator(".room-label")).toHaveCount(0);
    await expect(studio.locator(".robot-marker")).toBeHidden();
    await expect(studio.locator(".resolution-value")).toHaveText("—");
    await expect(studio.locator(".status")).toContainText("No local map data");
    expect(await page.evaluate(() => ({
      scene: window.__studio._scene,
      sceneUrl: window.__studio._sceneUrl,
      sceneEtag: window.__studio._sceneEtag,
      robot: window.__studio._robot,
      imageSource: window.__studio.shadowRoot.querySelector(".map-image").getAttribute("src"),
    }))).toEqual({
      scene: undefined,
      sceneUrl: undefined,
      sceneEtag: undefined,
      robot: undefined,
      imageSource: null,
    });
  });

  test("keeps the last 3D scene visible when a live refresh fails", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    let revision = 1;
    let failScene = false;
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/synthetic-scene",
        pose_url: "/synthetic-pose",
        map_revision: revision,
        updated_at: "2026-01-01T00:00:00Z",
      }] }),
    }));
    await page.route("**/synthetic-scene", (route) => failScene
      ? route.fulfill({ status: 503, body: "temporarily unavailable" })
      : route.fulfill({
        status: 200,
        body: syntheticScene(),
        headers: { "Content-Type": "application/octet-stream", ETag: '"synthetic-retained-1"' },
      }));
    const studio = await loadStudio(page);
    await expect(studio.locator(".status")).toContainText("1 points");
    await expect(studio.locator(".scene-canvas")).toBeVisible();

    failScene = true;
    revision = 2;
    await studio.locator(".map-more > summary").click();
    await studio.locator(".refresh").click();
    await expect(studio.locator(".status")).toContainText("last local 3D scene");
    await expect(studio.locator(".scene-canvas")).toBeVisible();
    await expect(studio.locator(".map-image")).toBeHidden();
  });

  test("recovers automatically while the first scene snapshot is still collecting", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    let sceneReady = false;
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/synthetic-scene",
        pose_url: "/synthetic-pose",
        map_revision: 1,
        map_health: sceneReady ? "ready" : "collecting",
        map_complete: sceneReady,
      }] }),
    }));
    await page.route("**/synthetic-scene", (route) => sceneReady
      ? route.fulfill({
        status: 200,
        body: syntheticScene(),
        headers: { "Content-Type": "application/octet-stream", ETag: '"synthetic-recovered-1"' },
      })
      : route.fulfill({ status: 409, body: "scene is still collecting" }));
    const studio = await loadStudio(page);
    await expect(studio.locator(".status")).toContainText("Building local 3D scene");
    await expect(studio.locator(".status")).not.toHaveAttribute("data-tone", "error");

    sceneReady = true;
    await page.evaluate(() => window.__studio._update());
    await expect(studio.locator(".status")).toContainText("points · full capture");
    await expect(studio.locator(".scene-canvas")).toBeVisible();
  });

  test("separates precise mouse and trackpad navigation", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    const initial = await page.evaluate(() => ({ ...window.__studio._camera }));

    await studio.locator(".viewport").dispatchEvent("wheel", {
      deltaY: 120,
      deltaMode: 0,
    });
    const afterMouseWheel = await page.evaluate(() => ({ ...window.__studio._camera }));
    expect(afterMouseWheel.distance).not.toBeCloseTo(initial.distance, 4);
    expect(afterMouseWheel.targetX).toBeCloseTo(initial.targetX, 4);
    expect(afterMouseWheel.targetZ).toBeCloseTo(initial.targetZ, 4);

    await studio.locator(".viewport").dispatchEvent("wheel", {
      deltaX: 8,
      deltaY: 14,
      deltaMode: 0,
    });
    const afterTrackpadPan = await page.evaluate(() => ({ ...window.__studio._camera }));
    expect(afterTrackpadPan.distance).toBeCloseTo(afterMouseWheel.distance, 4);
    expect(afterTrackpadPan.targetX).not.toBeCloseTo(afterMouseWheel.targetX, 4);
    expect(afterTrackpadPan.targetZ).not.toBeCloseTo(afterMouseWheel.targetZ, 4);

    await page.evaluate(() => {
      const viewport = window.__studio.shadowRoot.querySelector(".viewport");
      viewport.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "mouse",
        button: 1,
        clientX: 200,
        clientY: 200,
      }));
      viewport.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "mouse",
        button: 1,
        clientX: 250,
        clientY: 225,
      }));
      viewport.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "mouse",
        button: 1,
        clientX: 250,
        clientY: 225,
      }));
    });
    const afterMiddlePan = await page.evaluate(() => ({
      camera: { ...window.__studio._camera },
      inertia: window.__studio._inertiaFrame,
    }));
    expect(afterMiddlePan.camera.targetX).not.toBeCloseTo(afterTrackpadPan.targetX, 4);
    expect(afterMiddlePan.inertia).toBeUndefined();
  });

  test("hands keyboard navigation to the map after mouse or wheel input", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    const viewport = studio.locator(".viewport");
    const bounds = await viewport.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 - 30);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() =>
      window.__studio.shadowRoot.activeElement?.classList.contains("viewport"),
    )).toBe(true);

    await page.keyboard.press("0");
    await expect.poll(() => page.evaluate(() => window.__studio._camera.yaw)).toBeCloseTo(-Math.PI / 4, 3);
    await expect.poll(() => page.evaluate(() => window.__studio._camera.pitch)).toBeCloseTo(0.82, 3);

    await page.evaluate(() => window.__studio.shadowRoot.activeElement.blur());
    await viewport.dispatchEvent("wheel", { deltaY: 120, deltaMode: 0 });
    await expect.poll(() => page.evaluate(() =>
      window.__studio.shadowRoot.activeElement?.classList.contains("viewport"),
    )).toBe(true);
    const beforeArrow = await page.evaluate(() => window.__studio._camera.yaw);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => window.__studio._camera.yaw)).not.toBeCloseTo(beforeArrow, 4);
  });

  test("loads a bounded synthetic scene through the WebGL path", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    await page.route("**/synthetic-scene", (route) => route.fulfill({
      status: 200,
      body: syntheticScene(),
      headers: { "Content-Type": "application/octet-stream", ETag: '"synthetic-1"' },
    }));
    const studio = await loadStudio(page, {
      "camera.synthetic_map": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          source: "local_robot_slam",
          scene_url: "/synthetic-scene",
          map_revision: 1,
          map_complete: true,
        },
      },
    });
    await expect(studio.locator(".status")).toContainText("1 points");
    await expect(studio.locator(".scene-canvas")).toBeVisible();
    expect(await page.evaluate(() => window.__glCalls.some(([name]) => name === "bufferData"))).toBe(true);
  });

  test("keeps the photorealistic camera out of the room-camera match", async ({ page }) => {
    await installBrowserDoubles(page);
    await loadStudio(page, {
      "camera.synthetic_photo": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          source: "local_robot_slam",
          robot_location_source: "current_area",
        },
      },
      "camera.synthetic_rooms": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          source: "local_room_map",
          robot_location_source: "exact_pose",
        },
      },
    });

    expect(await page.evaluate(() => {
      const entities = window.__studio._entities();
      return { photo: entities.photo?.[0], rooms: entities.rooms?.[0] };
    })).toEqual({
      photo: "camera.synthetic_photo",
      rooms: "camera.synthetic_rooms",
    });
  });

  test("uses the local camera map when WebGL 2 is unavailable", async ({ page }) => {
    await installBrowserDoubles(page, { images: true });
    const studio = await loadStudio(page, {
      "camera.synthetic_map": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          source: "local_robot_slam",
          map_revision: 1,
          robot_location_source: "current_area",
        },
      },
    });
    await expect(studio.locator(".map-image")).toBeVisible();
    await expect(studio.locator(".scene-canvas")).toBeHidden();
    await expect(studio.locator(".status")).toContainText("3D rendering paused");
    await expect(studio.locator(".status")).toHaveAttribute("data-tone", "warning");
    await expect(studio.locator(".resolution-value")).toHaveText("640 × 480");
    await expect(studio.locator(".pose-status")).toHaveText(
      "Robot is in the current room · exact position unavailable",
    );
    await expect(studio.locator(".robot-marker")).toBeHidden();
  });

  test("ends a stalled first image load with actionable state", async ({ page }) => {
    await installBrowserDoubles(page);
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
        callback,
        delay === 15000 ? 25 : delay,
        ...args,
      );
      class HangingImage extends EventTarget {
        naturalWidth = 0;
        naturalHeight = 0;
        complete = false;

        get src() {
          return this._src || "";
        }

        set src(value) {
          this._src = value;
        }
      }
      window.Image = HangingImage;
    });
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 404,
      body: "not available",
    }));
    const studio = await loadStudio(page, {
      "camera.synthetic_map": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: { source: "local_robot_slam", map_revision: 1 },
      },
    });

    await expect(studio.locator(".status")).toHaveText("Local map image is unavailable");
    await expect(studio.locator(".status")).toHaveAttribute("data-tone", "error");
    await expect(studio.locator(".empty")).toContainText("could not be loaded");
    await expect(studio.locator(".map-image")).toBeHidden();
    await expect(studio.locator(".viewport")).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => ({
      loader: window.__studio._fallbackLoader,
      loadingVersion: window.__studio._fallbackLoadingVersion,
      timer: window.__studio._fallbackLoadTimer,
    }))).toEqual({ loader: undefined, loadingVersion: undefined, timer: undefined });
  });

  test("keeps the last camera map visible when its refresh stalls", async ({ page }) => {
    await installBrowserDoubles(page);
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.__fallbackImageRequests = 0;
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
        callback,
        delay === 15000 ? 40 : delay,
        ...args,
      );
      class FirstImageLoads extends EventTarget {
        naturalWidth = 0;
        naturalHeight = 0;
        complete = false;

        get src() {
          return this._src || "";
        }

        set src(value) {
          this._src = value;
          if (!value) return;
          window.__fallbackImageRequests += 1;
          if (window.__fallbackImageRequests !== 1) return;
          this.naturalWidth = 1280;
          this.naturalHeight = 960;
          this.complete = true;
          queueMicrotask(() => this.dispatchEvent(new Event("load")));
        }
      }
      window.Image = FirstImageLoads;
    });
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 404,
      body: "not available",
    }));
    const studio = await loadStudio(page, {
      "camera.synthetic_map": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: { source: "local_robot_slam", map_revision: 1 },
      },
    });
    await expect.poll(() => page.evaluate(() => window.__studio._fallbackVersion)).toBeTruthy();
    await expect(studio.locator(".map-image")).toBeVisible();
    await page.evaluate(() => {
      if (window.__fallbackImageRequests === 1) window.__studio._update(true);
    });

    await expect.poll(() => page.evaluate(() => window.__fallbackImageRequests)).toBeGreaterThan(1);
    await expect(studio.locator(".status")).toHaveText(
      "Showing the last local map · reconnecting…",
    );
    await expect(studio.locator(".status")).toHaveAttribute("data-tone", "warning");
    await expect(studio.locator(".map-image")).toBeVisible();
    await expect(studio.locator(".empty")).toBeHidden();
    await expect(studio.locator(".viewport")).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => ({
      loader: window.__studio._fallbackLoader,
      loadingVersion: window.__studio._fallbackLoadingVersion,
      timer: window.__studio._fallbackLoadTimer,
    }))).toEqual({ loader: undefined, loadingVersion: undefined, timer: undefined });
  });

  test("keeps the fallback stable and restores 3D after WebGL context loss", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true, images: true });
    let sceneRequests = 0;
    await page.route("**/synthetic-scene", (route) => {
      sceneRequests += 1;
      return route.fulfill({
        status: 200,
        body: syntheticScene(),
        headers: { "Content-Type": "application/octet-stream", ETag: '"synthetic-context-1"' },
      });
    });
    const studio = await loadStudio(page, {
      "camera.synthetic_map": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          source: "local_robot_slam",
          scene_url: "/synthetic-scene",
          map_revision: 1,
          map_complete: true,
        },
      },
    });
    const canvas = studio.locator(".scene-canvas");
    await expect(canvas).toBeVisible();
    expect(sceneRequests).toBe(1);

    await canvas.dispatchEvent("webglcontextlost", { cancelable: true });
    await expect(studio.locator(".map-image")).toBeVisible();
    await expect(canvas).toBeHidden();
    await expect(studio.locator(".status")).toContainText("3D rendering paused");

    await page.evaluate(() => window.__studio._update(true));
    await expect(studio.locator(".map-image")).toBeVisible();
    await expect(canvas).toBeHidden();
    expect(sceneRequests).toBe(1);

    await canvas.dispatchEvent("webglcontextrestored");
    await expect(canvas).toBeVisible();
    await expect(studio.locator(".map-image")).toBeHidden();
    await expect(studio.locator(".status")).toContainText("points · full capture");
    expect(sceneRequests).toBe(1);
    expect(await page.evaluate(() => window.__glCalls.some(
      ([name]) => name === "bufferData",
    ))).toBe(true);
  });

  test("coalesces repeated room-map updates while an image is loading", async ({ page }) => {
    await installBrowserDoubles(page);
    await page.addInitScript(() => {
      window.__imageRequests = [];
      window.__pendingImages = [];
      class PendingImage extends EventTarget {
        naturalWidth = 0;
        naturalHeight = 0;
        complete = false;

        get src() {
          return this._src || "";
        }

        set src(value) {
          this._src = value;
          if (value) {
            window.__imageRequests.push(value);
            window.__pendingImages.push(this);
          }
        }
      }
      window.Image = PendingImage;
    });
    const studio = await loadStudio(page);
    await page.evaluate(() => {
      window.__studio._view = "rooms";
      window.__studio.hass = {
        states: {
          "camera.synthetic_rooms": {
            state: "idle",
            last_updated: "2026-01-01T00:00:00Z",
            attributes: {
              robot_location_source: "exact_pose",
              source: "local_room_map",
            },
          },
        },
        auth: { data: { access_token: "synthetic-token" } },
        hassUrl: (path) => path,
      };
    });
    await expect.poll(() => page.evaluate(() => window.__imageRequests.length)).toBe(1);
    await page.evaluate(async () => {
      await window.__studio._update();
      await window.__studio._update();
      await window.__studio._update();
    });
    expect(await page.evaluate(() => window.__imageRequests.length)).toBe(1);
    const dimensions = await page.evaluate(() => {
      const url = new URL(window.__imageRequests[0], window.location.href);
      return [Number(url.searchParams.get("width")), Number(url.searchParams.get("height"))];
    });
    expect(dimensions[0]).toBeLessThanOrEqual(2048);
    expect(dimensions[1]).toBeLessThanOrEqual(2048);
    await expect(studio.locator(".viewport")).toHaveAttribute("aria-busy", "true");
    await page.evaluate(() => {
      const image = window.__pendingImages[0];
      image.naturalWidth = 1600;
      image.naturalHeight = 1200;
      image.complete = true;
      image.dispatchEvent(new Event("load"));
    });
    await expect(studio.locator(".map-image")).not.toHaveAttribute("hidden", "");
    await expect(studio.locator(".viewport")).toHaveAttribute("aria-busy", "false");
  });

  test("enters and exits browser full screen from the studio control", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    await studio.locator(".map-more > summary").click();
    await studio.locator(".fullscreen").click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(studio.locator(".fullscreen")).toHaveText("Exit full screen");
    await studio.locator(".map-more > summary").click();
    await studio.locator(".fullscreen").click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  });
});
