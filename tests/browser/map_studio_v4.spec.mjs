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

  test("rejects stale coherence generations and fails closed", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const machine = new module.CoherenceMachine();
      const first = machine.begin("entry", "floor-a", "mission-a", 1);
      const second = machine.begin("entry", "floor-b", "mission-b", 2);
      const advanced = machine.advance(second, 3);
      const ready = module.createGalleryState("ready");
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

    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await toggle.click();
    await expect(sheet).toHaveAttribute("data-detent", "peek");

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

  test("keeps browser zoom modifiers untouched and focal wheel zoom bounded", async ({ page }) => {
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
    expect(modifierPrevented).toBe(false);
    expect((await snapshot(page)).draw.zoomPercent).toBe(before);

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
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent).toBeGreaterThan(before);
    const origin = (await snapshot(page)).draw;
    expect(Math.abs(origin.zoomOriginX - 30)).toBeLessThan(0.2);
    expect(Math.abs(origin.zoomOriginY - 70)).toBeLessThan(0.2);
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
    let fullSceneRequests = 0;
    let deltaRequests = 0;
    let failNextDelta = false;
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
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [catalogEntry()] }),
    }));
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", (route) => {
      fullSceneRequests += 1;
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
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        position: null,
        source: "current_area",
        revision: catalogRevision,
        pose_revision: 1,
        map_floor_coherent: true,
        pose_freshness: "live",
      }),
    }));
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

    await expect.poll(async () => page.evaluate(() => {
      const scene = window.__deltaPanel.getWorkspaceSnapshot().resources.scene.value;
      return { revision: scene?.revision, room: scene?.metadata.rooms[0]?.name };
    })).toEqual({ revision: 2, room: "Updated room" });
    expect(fullSceneRequests).toBe(1);
    expect(deltaRequests).toBeGreaterThanOrEqual(1);
    failNextDelta = true;
    await expect.poll(() => fullSceneRequests).toBe(2);
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().notice)).toBe(null);
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
    mapComplete = true;
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().map.complete), { timeout: 10_000 }).toBe(true);
    await page.evaluate(() => {
      const shell = window.__retainedScene.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "open-workflow", workflow: "rooms" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(() => plansRequests).toBe(1);
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
