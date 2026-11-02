import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const MODULE = "/room-candidates-test.js";

async function bundledModule(page, path, contents) {
  const bundle = await build({ stdin: { contents, resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route(`**${path}`, (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  return path;
}

async function mountCandidates(page, { duplicate = false } = {}) {
  const bundle = await build({
    stdin: {
      contents: `export { renderRoomCandidates } from "./frontend/map-studio-v4/room-candidates";
        export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
        export { render } from "lit";`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route(`**${MODULE}`, (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async ({ module, duplicate }) => {
    const { renderRoomCandidates, createGalleryState, render } = await import(module);
    const state = createGalleryState("rooms");
    const catalog = state.resources.plans.value;
    state.roomCandidates = ["room-a", duplicate ? "room-c" : "room-b"];
    if (duplicate) state.resources.plans.value = { ...catalog, rooms: catalog.rooms.map((room) =>
      room.roomId === "room-c" ? { ...room, name: "Kitchen" } : room) };
    const t = (_key, fallback, placeholders) => fallback.replace(/\{([^}]+)\}/gu, (_match, key) => String(placeholders?.[key] ?? `{${key}}`));
    window.__roomCandidateIntents = [];
    const root = document.createElement("div");
    root.id = "test-root";
    document.body.append(root);
    render(renderRoomCandidates(state, (intent) => window.__roomCandidateIntents.push(intent), t), root);
  }, { module: MODULE, duplicate });
  return page.locator("#test-root");
}

test("candidate picker has an accessible named list and lets keyboard users choose a room", async ({ page, browserName }) => {
  const root = await mountCandidates(page);
  const dialog = root.getByRole("dialog", { name: "Choose a room" });
  const kitchen = dialog.getByRole("button", { name: "Select Kitchen", exact: true });
  const livingRoom = dialog.getByRole("button", { name: "Select Living room", exact: true });
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await kitchen.focus();
  await expect(kitchen).toBeFocused();
  // Safari's default tab policy uses Option-Tab to include buttons.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(livingRoom).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
  await expect(kitchen).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__roomCandidateIntents)).toEqual([
    { type: "toggle-room", roomId: "room-a" },
    { type: "show-room-candidates", roomIds: [] },
  ]);
  const axe = await new AxeBuilder({ page }).include("[data-room-candidate-picker]").analyze();
  expect(axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
});

test("duplicate candidate names are distinguished in visible and accessible labels", async ({ page }) => {
  const root = await mountCandidates(page, { duplicate: true });
  const dialog = root.getByRole("dialog", { name: "Choose a room" });
  const first = dialog.getByRole("button", { name: "Select Kitchen, candidate 1", exact: true });
  const second = dialog.getByRole("button", { name: "Select Kitchen, candidate 2", exact: true });
  await expect(first).toContainText("Candidate 1");
  await expect(second).toContainText("Candidate 2");
  await expect(first).toBeDisabled();
  await expect(second).toBeDisabled();
  await expect(dialog).toContainText("Matic can't tell these rooms apart. Rename them in the robot app and wait for the updated room names to appear.");
  await first.evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(await page.evaluate(() => window.__roomCandidateIntents)).toEqual([]);
});

test("Cancel dismisses the ambiguous choice without changing room selection", async ({ page }) => {
  const root = await mountCandidates(page);
  await root.getByRole("dialog", { name: "Choose a room" }).getByRole("button", { name: "Cancel room choice" }).click();
  expect(await page.evaluate(() => window.__roomCandidateIntents)).toEqual([
    { type: "show-room-candidates", roomIds: [] },
  ]);
});

test("an overlapping map tap opens the room candidate picker", async ({ page }) => {
  const boundary = [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]];
  const fixture = await installPanelFixture(page, {
    initialPlanCatalog: {
      rooms: [{ room_id: "room-a", name: "Kitchen" }, { room_id: "room-b", name: "Hall" }],
      plans: [], selected_plan: null,
    },
    sceneRooms: [
      { id: "scene-kitchen", name: "Kitchen", center: [50, 40], boundary },
      { id: "scene-hall", name: "Hall", center: [50, 40], boundary },
    ],
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await panel.getByRole("button", { name: /^Clean rooms/ }).click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("rooms");
  const shell = panel.locator("matic-map-shell-v4");
  const map = shell.locator("matic-map-canvas-v4").locator(".map-root");
  const bounds = await map.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const picker = shell.getByRole("dialog", { name: "Choose a room" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: "Select Hall", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Select Kitchen", exact: true })).toBeVisible();
});

test("late room hits do not apply after a plan or room catalog changes", async ({ page }) => {
  const module = "/deferred-room-hit-test.js";
  const bundle = await build({
    stdin: {
      contents: `export { GestureController } from "./frontend/map-studio-v4/gesture-controller";
        export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";`,
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route(`**${module}`, (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const results = await page.evaluate(async (path) => {
    const { GestureController, createGalleryState } = await import(path);
    const run = async (retire) => {
      let state = createGalleryState("plan-edit-ordered");
      let resolveHit;
      const calls = [];
      const host = document.createElement("div");
      host.tabIndex = 0;
      document.body.append(host);
      const renderer = {
        roomAt: () => null,
        roomCandidatesAt: () => new Promise((resolve) => { resolveHit = resolve; }),
      };
      const gestures = new GestureController(host, renderer, {
        state: () => state,
        drawReady: () => true,
        onCircles: () => undefined,
        onCirclePreview: () => undefined,
        onRoom: (roomId) => calls.push(["room", roomId]),
        onRoomCandidates: (roomIds) => calls.push(["candidates", ...roomIds]),
      });
      const pointer = (type) => new PointerEvent(type, {
        bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true,
        clientX: 10, clientY: 10, button: 0,
      });
      host.dispatchEvent(pointer("pointerdown"));
      host.dispatchEvent(pointer("pointerup"));
      if (retire === "plan") state = { ...state, selection: { ...state.selection, planId: "different-plan" } };
      else if (retire === "catalog") {
        const plans = state.resources.plans.value;
        state = { ...state, resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...plans, rooms: [...plans.rooms] } } } };
      }
      resolveHit({ status: "resolved", roomId: "room-a" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      gestures.dispose();
      host.remove();
      return calls;
    };
    return { planSwitch: await run("plan"), catalogReplacement: await run("catalog") };
  }, module);
  expect(results).toEqual({ planSwitch: [], catalogReplacement: [] });
});

test("narrow shell restores map focus after room choice and keeps Stop reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const module = await bundledModule(page, "/room-candidate-shell-test.js", `
    export { MaticMapShellV4 } from "./frontend/map-studio-v4/shell";
    export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
    export { reduceWorkspace } from "./frontend/map-studio-v4/state";
  `);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (path) => {
    const { MaticMapShellV4, createGalleryState, reduceWorkspace } = await import(path);
    const shell = document.createElement("matic-map-shell-v4");
    shell.style.cssText = "display:block;block-size:52.75rem;max-inline-size:24.375rem;margin-inline:auto";
    const state = createGalleryState("cleaning");
    window.__roomCandidateShellIntents = [];
    shell.state = { ...state, workflow: "rooms", narrowHint: true, roomCandidates: ["room-a", "room-b"] };
    shell.addEventListener("matic-workspace-intent", (event) => {
      window.__roomCandidateShellIntents.push(event.detail);
      if (event.detail.type === "show-room-candidates") shell.state = reduceWorkspace(shell.state, event.detail);
    });
    shell.addEventListener("matic-workspace-action", (event) => window.__roomCandidateShellIntents.push(event.detail));
    document.body.append(shell);
  }, module);

  const shell = page.locator("matic-map-shell-v4");
  const picker = shell.getByRole("dialog", { name: "Choose a room" });
  const stop = shell.getByRole("button", { name: "Stop cleaning", exact: true });
  await expect(picker).toBeVisible();
  // Candidates arrive with the first shell state, before the workflow view
  // chunk has finished loading. The shell must carry focus until it can mount.
  await expect(picker).toBeFocused();
  await expect(stop).toBeVisible();
  await stop.click();
  await expect.poll(() => page.evaluate(() => window.__roomCandidateShellIntents.some(({ id }) => id === "stop"))).toBe(true);

  await picker.getByRole("button", { name: "Cancel room choice" }).click();
  const mapRoot = shell.locator("matic-map-canvas-v4").locator(".map-root");
  await expect(mapRoot).toBeFocused();
  await expect(picker).toHaveCount(0);
});

test("selected area points support accessible numeric editing, keyboard use and map bounds", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: `export { OutlineEditor } from "./frontend/map-studio-v4/outline-editor";
        export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
        export { reduceWorkspace, captureCoordinateEdit } from "./frontend/map-studio-v4/state";
        export { validOutline, edgeDistance } from "./frontend/map-studio-v4/area-outline";
        export { render } from "lit";`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  const module = "/outline-coordinate-test.js";
  await page.route(`**${module}`, (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (modulePath) => {
    const { OutlineEditor, createGalleryState, reduceWorkspace, validOutline, edgeDistance, render } = await import(modulePath);
    const state = createGalleryState("draw-points");
    state.draw = { ...state.draw, tool: "outline", circles: [], outline: {
      closed: true, points: [{ x: 1, y: 1 }, { x: 3.5, y: 1 }, { x: 3.5, y: 2.5 }, { x: 1, y: 2.5 }],
    } };
    const root = document.createElement("div");
    root.id = "outline-root";
    document.body.append(root);
    const canvas = { state, drawingReady: true, localize: undefined, renderRoot: root, updateComplete: Promise.resolve(), requestUpdate() {
      render(editor.render(), root);
    } };
    const renderer = {
      containsMapPoint: (point) => point.x >= 0 && point.x <= 10 && point.y >= 0 && point.y <= 10,
      mapToScreen: (point) => ({ x: point.x * 20, y: point.y * 20 }),
      screenToMap: (x, y) => ({ x: x / 20, y: y / 20 }),
      offsetMapPoint: (point, dx, dy) => ({ x: point.x + dx, y: point.y + dy }),
    };
    const editor = new OutlineEditor({ validOutline, edgeDistance });
    editor.attach(canvas, () => renderer, (intent) => {
      canvas.state = reduceWorkspace(canvas.state, intent);
      render(editor.render(), root);
    });
    window.__outlineState = () => canvas.state;
    render(editor.render(), root);
  }, module);

  const root = page.locator("#outline-root");
  const point = root.getByRole("button", { name: "Point 1", exact: true });
  await point.focus();
  const x = root.getByRole("spinbutton", { name: "X coordinate for point 1 in meters" });
  const y = root.getByRole("spinbutton", { name: "Y coordinate for point 1 in meters" });
  await expect(x).toHaveValue("1");
  await expect(y).toHaveValue("1");
  await x.focus();
  await x.fill("1.25");
  await x.press("Tab");
  await expect.poll(() => page.evaluate(() => window.__outlineState().draw.outline.points[0].x)).toBe(1.25);
  await y.fill("99");
  await y.press("Tab");
  await expect.poll(() => page.evaluate(() => window.__outlineState().draw.outline.points[0].y)).toBe(1);
  await expect(root.getByRole("status").filter({ hasText: "Keep the point on the mapped floor." })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("#outline-root").analyze();
  expect(axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
});

test("Rooms source UI labels the daily cap, reports progress and emits its setting intent", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: `export { MaticRoomsViewV4 } from "./frontend/map-studio-v4/rooms-view";
        export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  const module = "/daily-room-ui-test.js";
  await page.route(`**${module}`, (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (modulePath) => {
    const { MaticRoomsViewV4, createGalleryState } = await import(modulePath);
    const state = createGalleryState("rooms-ready");
    const plans = state.resources.plans.value;
    state.resources.plans.value = { ...plans, rooms: plans.rooms.map((room) => room.roomId === "room-a"
      ? { ...room, dailyLimit: { limit: 3, completedToday: 1, reached: false } }
      : room.roomId === "room-b" ? { ...room, dailyLimit: { limit: 2, completedToday: 2, reached: true } }
        : room.roomId === "room-c" ? { ...room, dailyLimit: { limit: 2, completedToday: 0, reached: true, reason: "completion_history_unverified" } }
          : room) };
    const admitted = state.manualRoomPreview.value;
    state.manualRoomPreview.value = { ...admitted, preview: { ...admitted.preview, dailyLimitHeldRooms: [
      { roomId: "room-b", name: "Living room", limit: 2, completedToday: 2, reached: true },
      { roomId: "room-c", name: "Office", limit: 2, completedToday: 0, reached: true, reason: "completion_history_unverified" },
    ] } };
    window.__dailyUiIntents = [];
    const view = document.createElement("matic-map-rooms-v4");
    view.state = state;
    view.addEventListener("matic-workspace-intent", (event) => window.__dailyUiIntents.push(event.detail));
    document.body.append(view);
  }, module);

  const view = page.locator("matic-map-rooms-v4");
  const kitchen = view.getByRole("checkbox", { name: "Kitchen" });
  await expect(kitchen).toBeChecked();
  await expect(view.getByText("1 of 3 completed today")).toBeVisible();
  await expect(view.getByText("Daily limit reached · 2 of 2 completed today")).toBeVisible();
  await expect(view.getByText("Daily limit held · Home Assistant can't confirm this room's completed cleans.")).toBeVisible();
  await expect(view.getByText("Daily limit reached · 0 of 2 completed today")).toHaveCount(0);
  await expect(view.locator(".check-lines")).toContainText("Held by daily clean limits: Living room: 2 of 2 completed today and Office: held because Home Assistant can't confirm this room's completed cleans.");
  await expect(view.locator(".check-lines")).not.toContainText("when the limit resets");
  await view.getByRole("button", { name: "Settings for Kitchen" }).click();
  const cap = view.getByRole("combobox", { name: "Daily clean limit for Kitchen" });
  await expect(cap).toHaveValue("3");
  await cap.selectOption("2");
  expect(await page.evaluate(() => window.__dailyUiIntents.at(-1))).toEqual({
    type: "set-room-daily-limit", roomId: "room-a", limit: 2,
  });
  const axe = await new AxeBuilder({ page }).include("matic-map-rooms-v4").analyze();
  expect(axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
});

test("saved plan preview describes an unverified daily cap without claiming completion credit", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: `export { MaticPlanViewsV4 } from "./frontend/map-studio-v4/plan-views";
        export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  const module = "/daily-plan-ui-test.js";
  await page.route(`**${module}`, (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (modulePath) => {
    const { createGalleryState } = await import(modulePath);
    const state = createGalleryState("plan-saved-intelligent");
    const catalog = state.resources.plans.value;
    const plan = catalog.plans.find((candidate) => candidate.id === state.planDraft.id);
    state.resources.plans.value = { ...catalog, plans: catalog.plans.map((candidate) => candidate.id === plan.id
      ? { ...candidate, nextRunPreview: { ...candidate.nextRunPreview, dailyLimitHeldRooms: [
        { roomId: "room-a", name: "Kitchen", limit: 2, completedToday: 2, reached: true },
        { roomId: "room-c", name: "Office", limit: 1, completedToday: 0, reached: true, reason: "completion_history_unverified" },
      ] } }
      : candidate) };
    const view = document.createElement("matic-map-plan-views-v4");
    view.state = state;
    document.body.append(view);
  }, module);

  const view = page.locator("matic-map-plan-views-v4");
  const held = view.locator("[data-daily-limit-held]");
  await expect(held).toContainText("Held by daily clean limits: Kitchen: 2 of 2 completed today and Office: held because Home Assistant can't confirm this room's completed cleans.");
  await expect(held).not.toContainText("0 of 1 completed today");
  await expect(held).not.toContainText("when the limit resets");
});
