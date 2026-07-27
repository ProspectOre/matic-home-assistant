import { expect, test } from "@playwright/test";

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

async function loadAreaEditor(page, value = []) {
  await page.goto("/");
  await page.addScriptTag({ url: "/room_plan_editor.js" });
  await page.evaluate(({ rooms, initialValue }) => {
    const editor = document.createElement("ha-selector-matic-area");
    editor.hass = {
      locale: { language: "en" },
      localize: () => undefined,
    };
    editor.selector = { rooms };
    editor.value = initialValue;
    document.body.append(editor);
    window.__areaEditor = editor;
  }, { rooms: ROOMS, initialValue: value });
  return page.locator("ha-selector-matic-area");
}

async function loadStudio(page, states = {}) {
  await page.goto("/");
  await page.addScriptTag({ url: "/matic_map_studio.js" });
  await page.evaluate((syntheticStates) => {
    window.__authenticatedPaths = [];
    const studio = document.createElement("matic-map-panel-v0-3-0");
    studio.panel = {};
    studio.hass = {
      states: syntheticStates,
      auth: { data: { access_token: "stale-token-must-not-be-used" } },
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
    };
    document.body.append(studio);
    window.__studio = studio;
  }, states);
  return page.locator("matic-map-panel-v0-3-0");
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
    rooms: [{ name: roomName, boundary: [[0, 0], [1, 0], [1, 1]], center: [0.3, 0.3] }],
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

test.describe("custom-area editor", () => {
  test.beforeEach(async ({ page }) => installBrowserDoubles(page));

  test("draw, Undo, Redo, and reversible Clear update the selector value", async ({ page }) => {
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

    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length)).toBe(1);
    await expect(editor.locator(".marks circle")).toHaveCount(1);
    await editor.locator(".undo").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length)).toBe(0);
    await editor.locator(".redo").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length)).toBe(1);
    await editor.locator(".clear").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length)).toBe(0);
    await editor.locator(".undo").click();
    await expect.poll(() => page.evaluate(() => window.__areaEditor.value.length)).toBe(1);
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
});

test.describe("map studio", () => {
  test("renders its controls and supports real pointer drag plus synthetic pinch/twist", async ({ page }) => {
    await installBrowserDoubles(page, { webgl: true });
    const studio = await loadStudio(page);
    const viewport = studio.locator(".viewport");
    await expect(viewport).toBeVisible();
    await expect(studio.locator("[data-view]" )).toHaveCount(3);
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
      const studio = document.createElement("matic-map-panel-v0-3-0");
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
    const studio = page.locator("matic-map-panel-v0-3-0");
    await expect(studio.locator("h1")).toHaveText(translatedTitle);
    await expect(studio.locator('[data-view="top"]')).toHaveAttribute("aria-pressed", "true");
    await expect(studio.locator(".status")).toHaveAttribute("aria-live", "polite");
    await expect(studio.locator(".quality")).toHaveValue("efficient");
    await expect(studio.locator(".layers")).toHaveAttribute("aria-pressed", "false");

    await studio.locator(".quality").selectOption("balanced");
    await studio.locator(".layers").click();
    await expect.poll(() => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("matic-map-studio:v2:synthetic-user"));
      return { view: saved.view, labels: saved.labels, quality: saved.quality };
    })).toEqual({ view: "top", labels: true, quality: "balanced" });
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
          body: JSON.stringify({ position: [0.15, 0.15], source: "alpha_pose" }),
        });
      } catch (_error) {
        // The entry switch intentionally aborts the superseded request.
      }
    });
    await page.route("**/pose-beta", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ position: [0.3, 0.3], source: "beta_pose" }),
    }));
    const studio = await loadStudio(page, {
      "camera.alpha_rooms": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          matic_entry_id: "alpha",
          robot_location_source: "exact_pose",
        },
      },
      "camera.beta_rooms": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: {
          matic_entry_id: "beta",
          robot_location_source: "exact_pose",
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
    await expect.poll(() => page.evaluate(() => window.__studio._robot?.source)).toBe("beta_pose");
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
    await expect(studio.locator(".status")).toContainText("Full local 3D scene");
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

  test("uses the local camera map when WebGL 2 is unavailable", async ({ page }) => {
    await installBrowserDoubles(page, { images: true });
    const studio = await loadStudio(page, {
      "camera.synthetic_map": {
        state: "idle",
        last_updated: "2026-01-01T00:00:00Z",
        attributes: { source: "local_robot_slam", map_revision: 1 },
      },
    });
    await expect(studio.locator(".map-image")).toBeVisible();
    await expect(studio.locator(".scene-canvas")).toBeHidden();
    await expect(studio.locator(".status")).toContainText("3D rendering paused");
    await expect(studio.locator(".status")).toHaveAttribute("data-tone", "warning");
    await expect(studio.locator(".resolution-value")).toHaveText("640 × 480");
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
    await expect(studio.locator(".status")).toContainText("Full local 3D scene");
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
            attributes: { robot_location_source: "exact_pose" },
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
    await studio.locator(".fullscreen").click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(studio.locator(".fullscreen")).toHaveText("Exit full screen");
    await studio.locator(".fullscreen").click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  });
});
