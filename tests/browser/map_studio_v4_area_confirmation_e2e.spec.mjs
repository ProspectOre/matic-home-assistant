import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// This is a mounted-panel E2E with the fixture's fake Home Assistant backend.
// MaticGetPlan is a backend service and is covered separately; here we prove
// the UI reloads and parses its next_run_preview response after area confirmation.

const AREA_ID = "office-saved-id";
const OUTLINE = [
  { x: 0.7, y: 0.7 },
  { x: 1.3, y: 0.7 },
  { x: 1.3, y: 1.3 },
  { x: 0.7, y: 1.3 },
];
const area = (status, canRebind, geometry = "outline") => ({
  id: AREA_ID,
  name: "Office",
  circles: geometry === "empty" ? [] : [{ x: 1, y: 1, radius: 0.2 }],
  outline: geometry === "outline" ? OUTLINE : null,
  cleaning_mode: "vacuum",
  coverage_setting: "standard",
  status,
  can_rebind: canRebind,
});

const PLAN_CATALOG = {
  rooms: [{ room_id: "room-a", name: "Office" }],
  selected_plan: "office-plan",
  plans: [{
    id: "office-plan",
    name: "Office plan",
    enabled: true,
    run_behavior: "intelligent",
    rooms: [],
    areas: [AREA_ID],
    room_order: [],
    return_to_base: true,
    finish_current_room: false,
    finish_current_room_threshold: 50,
    next_run_preview: null,
  }],
};

const AREAS_CATALOG = (entryId, areaStatus, canRebind, geometry = "outline") => ({
  scene_url: `/api/matic_robot/slam_scene/${entryId === "synthetic-entry" ? "synthetic" : entryId}`,
  rooms: [],
  areas: [area(areaStatus, canRebind, geometry)],
  selected_area: null,
});

const clickPanelButton = async (panel, label) => {
  await panel.getByRole("button", { name: label, exact: true }).click();
};

async function mountPanel(page, geometry = "outline") {
  await page.addInitScript(() => {
    const paths = new WeakMap();
    const overlay = (context) => context.canvas.isConnected
      && context.canvas.classList.contains("overlay-canvas");
    const record = (context, command) => {
      if (!overlay(context)) return;
      paths.get(context)?.push(command);
    };
    const beginPath = CanvasRenderingContext2D.prototype.beginPath;
    const moveTo = CanvasRenderingContext2D.prototype.moveTo;
    const lineTo = CanvasRenderingContext2D.prototype.lineTo;
    const arc = CanvasRenderingContext2D.prototype.arc;
    const closePath = CanvasRenderingContext2D.prototype.closePath;
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    window.__areaConfirmationOutlineStrokes = [];
    window.__areaConfirmationCircleStrokes = [];
    CanvasRenderingContext2D.prototype.beginPath = function (...args) {
      if (overlay(this)) paths.set(this, []);
      return beginPath.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.moveTo = function (...args) {
      record(this, "moveTo");
      return moveTo.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.lineTo = function (...args) {
      record(this, "lineTo");
      return lineTo.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      record(this, { command: "arc", args });
      return arc.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.closePath = function (...args) {
      record(this, "closePath");
      return closePath.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.stroke = function (...args) {
      const path = paths.get(this);
      if (overlay(this) && path?.includes("moveTo") && path?.includes("lineTo")) {
        window.__areaConfirmationOutlineStrokes.push([...path]);
      }
      if (overlay(this) && path?.includes("moveTo") && path?.some((command) => command?.command === "arc")) {
        window.__areaConfirmationCircleStrokes.push([...path]);
      }
      return stroke.call(this, ...args);
    };
  });
  const { panelTag } = await installPanelFixture(page, {
    initialAreasCatalog: AREAS_CATALOG("synthetic-entry", "stale", true, geometry),
    initialPlanCatalog: PLAN_CATALOG,
  });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.testPanel = "true";
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(`${panelTag}[data-test-panel=true]`);
  await expect.poll(async () => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose;
  })).toBe(true);
  return panel;
}

test("saved-area confirmation writes the same ID, reads it back as current, and checks plan preview without motion", async ({ page }) => {
  const panel = await mountPanel(page);
  const shell = panel.locator("matic-map-shell-v4");
  await clickPanelButton(panel, "Clean custom area Draw or choose a custom area");
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await page.evaluate(() => { window.__areaConfirmationOutlineStrokes.length = 0; });
  await clickPanelButton(panel, "Office Vacuum · Optimal Map changed · Check it before cleaning");
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areaReview");
  await expect(shell.getByText("The map changed since this area was saved.", { exact: false })).toBeVisible();
  await expect(shell.getByText("Inspect its outline and coverage", { exact: false })).toBeVisible();
  await expect.poll(async () => panel.evaluate((element) => {
    const outline = element.getWorkspaceSnapshot().draw.outline;
    return outline && { closed: outline.closed, points: outline.points };
  })).toEqual({ closed: true, points: OUTLINE });
  await expect.poll(() => page.evaluate(() => window.__areaConfirmationOutlineStrokes
    .some((path) => path.filter((command) => command === "lineTo").length === 3
      && path.includes("moveTo") && path.includes("closePath")))).toBe(true);
  await expect.poll(async () => panel.evaluate((element) => {
    const find = (root) => {
      for (const button of root.querySelectorAll("button")) {
        if (button.innerText.trim() === "Confirm area on current map") return button.getAttribute("aria-disabled") !== "true";
      }
      for (const child of root.querySelectorAll("*")) if (child.shadowRoot) {
        const value = find(child.shadowRoot);
        if (value !== null) return value;
      }
      return null;
    };
    return find(element.shadowRoot);
  })).toBe(true);

  // Clicking the actual shell action runs saveArea through EffectController and MaticBackend.
  await clickPanelButton(panel, "Confirm area on current map");
  await expect.poll(async () => page.evaluate(() => window.__panelFixture.areaRequests.filter((request) => request.method === "POST").length)).toBe(1);
  await expect.poll(async () => page.evaluate(() => window.__panelFixture.areaRequests.filter((request) => request.method === "GET").length)).toBeGreaterThan(1);
  await expect.poll(async () => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    const saved = state.resources.areas.value?.areas.find((candidate) => candidate.id === "office-saved-id");
    return { command: state.command, draftId: state.areaDraft.id, status: state.areaDraft.status,
      canRebind: state.areaDraft.canRebind, savedStatus: saved?.status, savedCanRebind: saved?.canRebind };
  })).toEqual({ command: "idle", draftId: AREA_ID, status: "current", canRebind: false, savedStatus: "current", savedCanRebind: false });

  const areaRequests = await page.evaluate(() => window.__panelFixture.areaRequests);
  // How many reads precede the write depends on when the workflow opens; one write is read back.
  const methods = areaRequests.map((request) => request.method);
  expect(methods.slice(methods.indexOf("POST"))).toEqual(["POST", "GET"]);
  const post = areaRequests.find((request) => request.method === "POST");
  expect(post.body).toMatchObject({ area_id: AREA_ID, name: "Office" });
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);

  // A subsequent real workflow open makes one plans GET. The fake backend
  // supplies a fresh next_run_preview response for the UI to validate and parse.
  await clickPanelButton(panel, "Back to areas");
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await clickPanelButton(panel, "Back to all tasks");
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("none");
  const planReadsBefore = await page.evaluate(() => window.__panelFixture.planReads);
  await page.evaluate(({ token, catalog }) => {
    const next = structuredClone(catalog);
    next.plans[0].next_run_preview = {
      preview_token: token,
      rooms: [],
      entries: [{ kind: "area", area_id: "office-saved-id", name: "Office", cleaning_mode: "vacuum", coverage_setting: "standard", cadence_reasons: [] }],
      mission_boundaries: [],
      blocker: null,
    };
    window.__panelFixture.setPlanCatalog(next);
  }, { token: "a".repeat(64), catalog: PLAN_CATALOG });
  await clickPanelButton(panel, "Your plans");
  await expect.poll(async () => page.evaluate(() => window.__panelFixture.planReads)).toBe(planReadsBefore + 1);
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.plans.value?.plans
    .find((candidate) => candidate.id === "office-plan")?.nextRunPreview?.previewToken ?? null)).toBe("a".repeat(64));

  const state = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(state.resources.areas.value.areas.find((candidate) => candidate.id === AREA_ID)).toMatchObject({
    id: AREA_ID, status: "current", canRebind: false,
  });
  expect(state.resources.plans.value.plans.find((candidate) => candidate.id === "office-plan")).toBeDefined();
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});

test("saved-area review explains legacy circle-only coverage before confirmation", async ({ page }) => {
  const panel = await mountPanel(page, "circles");
  const shell = panel.locator("matic-map-shell-v4");
  await clickPanelButton(panel, "Clean custom area Draw or choose a custom area");
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await page.evaluate(() => { window.__areaConfirmationCircleStrokes.length = 0; });
  await clickPanelButton(panel, "Office Vacuum · Optimal Map changed · Check it before cleaning");
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areaReview");
  await expect(shell.getByText("Inspect its saved circle coverage", { exact: false })).toBeVisible();
  await expect(shell.getByText("Redraw it if the coverage is uncertain.", { exact: false })).toBeVisible();
  await expect.poll(async () => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return { outline: state.draw.outline, circles: state.draw.circles };
  })).toEqual({ outline: null, circles: [{ x: 1, y: 1, radius: 0.2 }] });
  await expect.poll(() => page.evaluate(() => window.__areaConfirmationCircleStrokes
    .some((path) => path.some((command) => command?.command === "arc"
      && command.args[3] === 0 && command.args[4] === Math.PI * 2)
      && path.includes("moveTo")))).toBe(true);
  await expect(shell.getByRole("button", { name: "Confirm area on current map" })).toBeEnabled();
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});

test("saved-area review with unavailable geometry requires redraw and disables confirmation", async ({ page }) => {
  const panel = await mountPanel(page, "empty");
  const shell = panel.locator("matic-map-shell-v4");
  await clickPanelButton(panel, "Clean custom area Draw or choose a custom area");
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await clickPanelButton(panel, "Office Vacuum · Optimal Map changed · Check it before cleaning");
  await expect.poll(async () => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areaReview");
  await expect(shell.getByText("saved coverage is unavailable to inspect", { exact: false })).toBeVisible();
  await expect(shell.getByText("Redraw the area before confirming its map binding.", { exact: false })).toBeVisible();
  await expect.poll(async () => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return { outline: state.draw.outline, circles: state.draw.circles };
  })).toEqual({ outline: null, circles: [] });
  await expect(shell.getByRole("button", { name: "Confirm area on current map" })).toHaveAttribute("aria-disabled", "true");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});
