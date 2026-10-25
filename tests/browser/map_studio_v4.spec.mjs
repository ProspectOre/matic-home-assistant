import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { build } from "esbuild";

import { installPanelFixture, openPlanPicker } from "./map_studio_v4_panel_fixture.mjs";
import { pointer, touchDrag, twoFingerPinch } from "./touch.mjs";

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

async function loadGallery(page, { scenario = "ready", narrow = false, beforeMount } = {}) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await beforeMount?.();
  await page.evaluate(async () => {
    window.__galleryModule = await import("/map_studio_v4-review/review.js");
  });
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

async function loadEffectHarness(page) {
  const bundle = await build({
    stdin: {
    contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { LayerHistoryController, layerDepth } from "./frontend/map-studio-v4/layer-history"; export { WorkspaceStore, captureCoordinateEdit, canEditCoordinates, canReadFloorResources, draftForPlan, selectPrimaryAction } from "./frontend/map-studio-v4/state"; export { createGalleryState, withGalleryRoomPreview } from "./frontend/map-studio-v4/gallery-state";',
    resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/plan-recovery-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

async function snapshot(page) {
  return page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot(), GALLERY_TAG);
}

// Synthetic PointerEvents are not "active pointers", so the capture calls the
// shell and gesture controller make throw NotFoundError and abort the handler
// half-way.
async function shimPointerCapture(page) {
  await page.addInitScript(() => {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  });
}

// Detent changes animate block-size; a drag that starts mid-animation reads
// the wrong start height. Wait until the sheet has held one height for a few
// frames before measuring or dragging again.
const settleSheet = (gallery) => gallery.locator(".mobile-sheet").evaluate((element) => new Promise((resolve) => {
  let last = -1;
  let stable = 0;
  const tick = () => {
    const height = element.getBoundingClientRect().height;
    stable = Math.abs(height - last) < 0.5 ? stable + 1 : 0;
    last = height;
    if (stable >= 4) resolve(height);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));

const sheetSeam = (gallery) => gallery.locator(".scene-window").evaluate((element) => {
  const bounds = element.getBoundingClientRect();
  const sheet = element.getRootNode().host.getRootNode().querySelector(".mobile-sheet")?.getBoundingClientRect();
  return sheet ? Math.abs(bounds.bottom - sheet.top) : Number.POSITIVE_INFINITY;
});

// A slow drag: 12px every 40ms (0.3 px/ms, under the 0.5 px/ms flick
// threshold) ending on a repeated point so the release velocity is zero.
function slowDrag(dy, x = 160, y = 20) {
  const steps = Math.ceil(Math.abs(dy) / 12);
  const points = [[x, y]];
  for (let index = 1; index <= steps; index += 1) points.push([x, y + (dy * index) / steps]);
  points.push([x, y + dy]);
  return points;
}

test.describe("Map Studio v0.4 foundation", () => {
  test("loads workflow tools on first open and diagnostics only when requested", async ({ page }) => {
    const workflowRequests = [];
    const diagnosticsRequests = [];
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/chunks/workflow-panel-*.js", async (route) => {
      await held;
      await route.continue();
    });
    page.on("request", (request) => {
      if (request.url().includes("/chunks/workflow-panel-")) workflowRequests.push(request.url());
      if (request.url().includes("/chunks/diagnostics-panel-")) diagnosticsRequests.push(request.url());
    });
    // Nothing pinned: home shortcuts render from the workflow chunk (UX9),
    // so a home with shortcuts loads it; a home without them does not.
    const gallery = await loadGallery(page, { scenario: "home-unpinned" });
    await expect(gallery.locator(".panel-heading")).toBeVisible();
    expect(workflowRequests).toHaveLength(0);

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "history" });
    }, GALLERY_TAG);
    await expect(gallery.getByRole("status")).toContainText("Loading…");
    release();
    await expect(gallery.locator("matic-map-workflow-v4")).toBeVisible();
    expect(workflowRequests).toHaveLength(1);
    expect(diagnosticsRequests).toHaveLength(0);

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "none" });
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "history" });
    }, GALLERY_TAG);
    await expect(gallery.locator("matic-map-workflow-v4")).toBeVisible();
    expect(workflowRequests).toHaveLength(1);

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "none" });
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "support" });
    }, GALLERY_TAG);
    await expect(gallery.locator("matic-map-diagnostics-v4")).toBeVisible();
    expect(diagnosticsRequests).toHaveLength(1);
  });

  for (const narrow of [false, true]) {
    test(`Draw ${narrow ? "on a phone" : "at desktop width"} shows its tools at once and says Loading once${narrow ? " @mobile" : ""}`, async ({ page }) => {
      if (narrow) await page.setViewportSize({ width: 390, height: 844 });
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route("**/chunks/{workflow-panel,outline-editor,draw-tools}-*.js", async (route) => {
        await held;
        await route.continue();
      });
      const gallery = await loadGallery(page, { scenario: "ready", narrow });
      await gallery.evaluate((element) => element.setScenario("draw"));
      const toolbar = gallery.getByRole("toolbar", { name: "Draw area tools" });
      const loading = gallery.locator(".loading[role=status]", { hasText: "Loading…" });
      await expect(toolbar).toBeVisible();
      await expect(loading).toHaveCount(1);
      // A phone's draw sheet rests at peek: the line sits by the tools it is about.
      await expect(loading).toBeInViewport();
      const before = await toolbar.boundingBox();
      release();
      await expect(gallery.locator("matic-map-workflow-v4")).toBeAttached();
      await expect(loading).toHaveCount(0);
      expect(await toolbar.boundingBox(), "the tools must not move when the rest arrives").toEqual(before);
    });
  }

  // A failed import is final for the page in every engine, so Try again
  // reloads; the failure shows where the workflow is looked at, once.
  for (const [chunk, workflow, view, narrow] of [
    ["workflow-panel", "rooms", "matic-map-workflow-v4", false],
    ["outline-editor", "draw", "matic-map-workflow-v4", false],
    ["outline-editor", "draw", "matic-map-workflow-v4", true],
    ["diagnostics-panel", "support", "matic-map-diagnostics-v4", false],
  ]) {
    test(`a ${chunk} chunk that fails in ${workflow}${narrow ? " on a phone" : ""} says so once, and Try again reloads into it${narrow ? " @mobile" : ""}`, async ({ page }) => {
      if (narrow) await page.setViewportSize({ width: 390, height: 844 });
      const pattern = `**/chunks/${chunk}-*.js`;
      await page.route(pattern, (route) => route.abort());
      await page.goto("/map-studio-v4-audit");
      const gallery = page.locator(GALLERY_TAG);
      await gallery.evaluate((element, [selected, phone]) => {
        element.narrow = phone;
        element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: selected });
      }, [workflow, narrow]);
      const failure = gallery.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." });
      await expect(failure).toHaveCount(1);
      await expect(failure).toBeInViewport();
      await expect(gallery.locator(".loading[role=status]", { hasText: "Loading…" })).toHaveCount(0);

      await page.unroute(pattern);
      await Promise.all([
        page.waitForEvent("load"),
        failure.getByRole("button", { name: "Try again" }).click(),
      ]);
      // The reload lands in the workflow Try again was pressed in.
      await expect.poll(() => gallery.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe(workflow);
      // A phone's draw sheet rests at peek, with the workflow body below it.
      await expect(gallery.locator(view)).toBeAttached();
      if (!narrow) await expect(gallery.locator(view)).toBeVisible();
      await expect(failure).toHaveCount(0);
      expect(await page.evaluate(() => sessionStorage.length), "the resume marker lasts one reload").toBe(0);
    });
  }

  // The shell loads and builds the outline editor, so a constructor that
  // throws is a failure it says, not a map that ignores taps.
  for (const narrow of [false, true]) {
    test(`an outline editor that cannot be built says so in Draw${narrow ? " on a phone @mobile" : ""}`, async ({ page }) => {
      if (narrow) await page.setViewportSize({ width: 390, height: 844 });
      await page.route("**/chunks/outline-editor-*.js", (route) => route.fulfill({
        contentType: "text/javascript",
        body: "export class OutlineEditor { constructor() { throw new Error(\"synthetic\"); } }",
      }));
      const gallery = await loadGallery(page, { scenario: "ready", narrow });
      await gallery.evaluate((element) => element.setScenario("draw"));
      const failure = gallery.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." });
      await expect(failure).toHaveCount(1);
      await expect(failure.getByRole("button", { name: "Try again" })).toBeInViewport();
    });
  }

  test("only Draw needs the outline editor", async ({ page }) => {
    const outlineRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("/chunks/outline-editor-")) outlineRequests.push(request.url());
    });
    await page.route("**/chunks/outline-editor-*.js", (route) => route.abort());
    const gallery = await loadGallery(page, { scenario: "ready" });
    const failure = gallery.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." });
    await gallery.evaluate((element) => {
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "plans" });
    });
    await expect(gallery.locator("matic-map-workflow-v4")).toBeVisible();
    await expect(failure).toHaveCount(0);
    expect(outlineRequests).toHaveLength(0);

    await gallery.evaluate((element) => {
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "draw" });
    });
    await expect(failure).toHaveCount(1);
  });

  test("Try again in Draw reloads into Draw, and Back works as after a fresh entry @safety", async ({ page }) => {
    const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
    const panel = page.locator(fixture.panelTag);
    const snapshot = () => page.evaluate((tag) => {
      const state = document.querySelector(tag)?.getWorkspaceSnapshot();
      return { workflow: state?.workflow, ready: state?.map.available === true };
    }, fixture.panelTag);
    const mount = () => page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    await mount();
    await expect.poll(snapshot).toEqual({ workflow: "none", ready: true });
    const entryLength = await page.evaluate(() => history.length);

    await page.route("**/chunks/outline-editor-*.js", (route) => route.abort());
    // UX9: Clean custom area opens Your areas, whose New area opens Draw.
    await panel.getByRole("button", { name: /Clean custom area/ }).click();
    await panel.getByRole("button", { name: "New area", exact: true }).click();
    const failure = panel.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." });
    await expect(failure).toHaveCount(1);
    expect(await page.evaluate(() => history.length)).toBe(entryLength + 2);

    await page.unroute("**/chunks/outline-editor-*.js");
    await Promise.all([
      page.waitForEvent("load"),
      failure.getByRole("button", { name: "Try again" }).click(),
    ]);
    await fixture.remount();
    await mount();
    await expect.poll(snapshot).toEqual({ workflow: "draw", ready: true });
    await expect(panel.getByRole("toolbar", { name: "Draw area tools" })).toBeVisible();
    await expect(failure).toHaveCount(0);
    expect(await page.evaluate(() => history.length), "no layer entry is left behind").toBe(entryLength + 2);

    await page.evaluate(() => history.back());
    await expect.poll(snapshot).toEqual({ workflow: "areas", ready: true });
    await page.evaluate(() => history.back());
    await expect.poll(snapshot).toEqual({ workflow: "none", ready: true });
    expect(await page.evaluate(() => history.state?.maticMapLayer ?? null)).toBeNull();
  });

  // A reload loses the draft, so Try again asks first, as Back does.
  test("Try again with an unsaved area asks before the reload discards it @safety", async ({ page }) => {
    await page.route("**/chunks/outline-editor-*.js", (route) => route.abort());
    await page.goto("/map-studio-v4-audit");
    const gallery = page.locator(GALLERY_TAG);
    const draft = () => gallery.evaluate((element) => {
      const { workflow, draw } = element.getWorkspaceSnapshot();
      return { workflow, dirty: draw.dirty };
    });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "draw", draw: { ...state.draw, dirty: true } });
    });
    const failure = gallery.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." });
    const retry = failure.getByRole("button", { name: "Try again" });
    const dialog = gallery.getByRole("dialog", { name: "Discard changes?" });
    await page.evaluate(() => { window.__samePage = true; });

    await retry.click();
    await expect(dialog).toBeVisible();
    // shell.md §5: a Draw draft's primary is Name and save, so the dialog offers no Save.
    await expect(dialog.getByRole("button", { name: "Save" }), "a Draw draft has no Save").toHaveCount(0);
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(retry, "Keep editing hands focus back to Try again").toBeFocused();
    expect(await draft()).toEqual({ workflow: "draw", dirty: true });
    expect(await page.evaluate(() => window.__samePage), "Keep editing must not reload").toBe(true);

    await page.unroute("**/chunks/outline-editor-*.js");
    await retry.click();
    await Promise.all([
      page.waitForEvent("load"),
      dialog.getByRole("button", { name: "Discard" }).click(),
    ]);
    await expect.poll(draft).toEqual({ workflow: "draw", dirty: false });
    await expect(gallery.getByRole("toolbar", { name: "Draw area tools" })).toBeVisible();
    await expect(failure).toHaveCount(0);
  });

  // The draw tools are startup code, so an area draft can be dirty while the
  // views chunk failed; the shell's own discard dialog still guards it.
  test("browser Back asks before discarding an area drawn while the workflow views failed @safety", async ({ page }) => {
    const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
    const panel = page.locator(fixture.panelTag);
    const draft = () => page.evaluate((tag) => {
      const { workflow, draw } = document.querySelector(tag).getWorkspaceSnapshot();
      return { workflow, dirty: draw.dirty };
    }, fixture.panelTag);
    await page.route("**/chunks/workflow-panel-*.js", (route) => route.abort());
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    await panel.getByRole("button", { name: /Clean custom area/ }).click();
    await expect(panel.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." })).toHaveCount(1);
    // Your areas failed too, so its New area is opened as it would open Draw.
    for (const detail of [{ type: "open-workflow", workflow: "draw" }, { type: "mark-draft", strokeDelta: 1 }]) {
      await page.evaluate(({ tag, detail }) => {
        document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
          detail,
          bubbles: true,
          composed: true,
        }));
      }, { tag: fixture.panelTag, detail });
    }
    await expect.poll(draft).toEqual({ workflow: "draw", dirty: true });

    await page.evaluate(() => history.back());
    const dialog = panel.getByRole("dialog", { name: "Discard changes?" });
    await expect(dialog).toBeVisible();
    // shell.md §5: a new area's draft says it is lost for good.
    await expect(dialog).toContainText("This new area hasn't been saved, and discarding it can't be undone.");
    await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeVisible();
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(draft).toEqual({ workflow: "areas", dirty: false });
  });

  // One saved two-room plan, as Home Assistant's plan catalog sends it.
  const dailyPlanCatalog = () => {
    const rooms = ["kitchen", "hall"].map((id, index) => ({
      room_id: id, name: id === "kitchen" ? "Kitchen" : "Hall",
      boundary: [[index * 6, 0], [index * 6 + 6, 0], [index * 6 + 6, 5], [index * 6, 5]],
    }));
    const planRooms = rooms.map((room) => ({ room_id: room.room_id, cleaning_mode: "vacuum", coverage_setting: "standard" }));
    return {
      rooms,
      selected_plan: "daily",
      plans: [{
        id: "daily", name: "Daily", enabled: true, run_behavior: "ordered", rooms: planRooms,
        room_order: planRooms.map((room) => room.room_id), return_to_base: true,
        finish_current_room: false, finish_current_room_threshold: 50,
      }],
    };
  };

  // Plan and area writes load on the first save; a failed load is that
  // write's own failure and leaves nothing pending.
  test("Save shows the plan save failure when the writes fail to load @safety", async ({ page }) => {
    const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: dailyPlanCatalog() });
    const panel = page.locator(fixture.panelTag);
    const state = () => page.evaluate((tag) => {
      const { command, planDraft } = document.querySelector(tag).getWorkspaceSnapshot();
      return { command, dirty: planDraft.dirty };
    }, fixture.panelTag);
    await page.route("**/chunks/catalog-writes-*.js", (route) => route.abort());
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    await openPlanPicker(panel);
    await panel.getByRole("button", { name: /^Daily/ }).click();
    await page.evaluate((tag) => {
      document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-plan-view", view: "edit" }, bubbles: true, composed: true,
      }));
    }, fixture.panelTag);
    await panel.getByRole("list", { name: "Rooms", exact: true }).getByRole("checkbox").first().uncheck();
    const save = panel.getByRole("button", { name: "Save", exact: true });
    await save.click();

    await expect(panel.getByRole("alert")).toHaveText("Home Assistant can't confirm the plan was saved, so check your plans, then try again.");
    await expect.poll(state).toEqual({ command: "idle", dirty: true });
    await expect(save).toBeEnabled();
    expect(await page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(0);
  });

  // The writes stay out of startup, but opening a workflow that can write
  // starts their load so a save rarely waits for it.
  test("opening the plan workflow, not startup, requests the plan and area writes", async ({ page }) => {
    const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: dailyPlanCatalog() });
    const panel = page.locator(fixture.panelTag);
    const requested = [];
    page.on("request", (request) => { if (/\/chunks\/catalog-writes-[^/]+\.js$/u.test(request.url())) requested.push(request.url()); });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    await expect.poll(() => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot().map.available, fixture.panelTag)).toBe(true);
    expect(requested).toEqual([]);
    await openPlanPicker(panel);
    await expect.poll(() => requested.length).toBe(1);
  });

  test("Stop failure is reported while the deferred catalog module is still loading @safety", async ({ page }) => {
    const fixture = await installPanelFixture(page, {
      moduleSource: "packaged",
      initialRobotStates: { "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } } },
    });
    let releaseModule;
    let moduleRequested = false;
    let moduleLoaded = false;
    const heldModule = new Promise((resolve) => { releaseModule = resolve; });
    await page.route("**/chunks/catalog-writes-*.js", async (route) => {
      moduleRequested = true;
      await heldModule;
      await route.continue();
      moduleLoaded = true;
    });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    await expect.poll(() => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot().activity, fixture.panelTag))
      .toBe("cleaning");
    await page.evaluate((tag) => document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4")
      .dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "open-workflow", workflow: "plans" }, bubbles: true, composed: true,
      })), fixture.panelTag);
    await expect.poll(() => moduleRequested).toBe(true);
    await page.evaluate((tag) => {
      window.__panelFixture.failNextService("stop_intelligent_cleaning", new Error("stop failed"));
      document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4")
        .dispatchEvent(new CustomEvent("matic-workspace-action", {
          detail: { id: "stop" }, bubbles: true, composed: true,
        }));
    }, fixture.panelTag);
    await expect.poll(() => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot().notice?.key, fixture.panelTag))
      .toBe("v4_notice_stop_unconfirmed");
    expect(moduleLoaded).toBe(false);
    releaseModule();
    await expect.poll(() => moduleLoaded).toBe(true);
  });

  // A resumed Try again opens only what the entry screen would: a limited map
  // offers no room choice, so the reload stays on the entry screen.
  test("Try again in Rooms reloads onto the entry screen when the map is then limited", async ({ page }) => {
    await page.route("**/chunks/workflow-panel-*.js", (route) => route.abort());
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "rooms" });
    });
    const failure = gallery.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." });
    await Promise.all([
      page.waitForEvent("load"),
      failure.getByRole("button", { name: "Try again" }).click(),
    ]);
    await page.unroute("**/chunks/workflow-panel-*.js");
    const limited = await loadGallery(page, { scenario: "map-limited" });
    await expect(limited.locator("#home-reason")).toContainText("Home Assistant can show this map but can't confirm it well enough to start cleaning.");
    expect(await limited.evaluate((element) => {
      const { workflow, notice } = element.getWorkspaceSnapshot();
      return { workflow, notice };
    })).toEqual({ workflow: "none", notice: null });
    expect(await page.evaluate(() => sessionStorage.length), "the refused marker is dropped").toBe(0);
  });

  // The marker belongs to the reload Try again started: one the map does not
  // open within 30 seconds (an offline error page, another page first) is
  // dropped, and the map opens on the entry screen.
  test("Try again's resume is dropped when the map opens more than 30 seconds later", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-12T12:00:00Z") });
    await page.route("**/chunks/workflow-panel-*.js", (route) => route.abort());
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "rooms" });
    });
    const failure = gallery.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." });
    await Promise.all([
      page.waitForEvent("load"),
      failure.getByRole("button", { name: "Try again" }).click(),
    ]);
    await page.unroute("**/chunks/workflow-panel-*.js");
    const markedAt = await page.evaluate(() => JSON.parse(sessionStorage.getItem("matic-map-resume")).at);
    const later = await loadGallery(page, {
      scenario: "ready",
      beforeMount: async () => {
        // Age the marker itself, after navigation. Test setup can take more
        // than a second, so a fixed 12:00:31 does not guarantee a stale marker.
        await page.clock.setSystemTime(new Date(markedAt + 31_000));
        expect(await page.evaluate(() => Date.now()) - markedAt).toBeGreaterThanOrEqual(31_000);
      },
    });
    await expect(later.getByRole("heading", { level: 2 })).toBeAttached();
    expect(await later.evaluate((element) => element.getWorkspaceSnapshot().workflow), "workflow after a stale resume")
      .toBe("none");
    expect(await page.evaluate(() => sessionStorage.length), "stored markers after a stale resume").toBe(0);
  });

  test("a chunk loading while the panel is detached gets its full 20 seconds after it returns", async ({ page }) => {
    await page.clock.install();
    await page.route("**/chunks/workflow-panel-*.js", () => {});
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "rooms" });
    });
    const loading = gallery.locator(".loading[role=status]", { hasText: "Loading…" });
    await expect(loading).toHaveCount(1);
    await gallery.evaluate((element) => { window.__detached = element; element.remove(); });
    await page.clock.runFor(30_000);
    await page.evaluate(() => document.body.append(window.__detached));
    await expect(loading).toHaveCount(1);
    await page.clock.runFor(19_000);
    await expect(loading).toHaveCount(1);
    await page.clock.runFor(1_000);
    await expect(gallery.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." })).toHaveCount(1);
  });

  test("a chunk still loading after 20 seconds counts as failed", async ({ page }) => {
    await page.clock.install();
    await page.route("**/chunks/workflow-panel-*.js", () => {});
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "rooms" });
    });
    const loading = gallery.locator(".loading[role=status]", { hasText: "Loading…" });
    await expect(loading).toHaveCount(1);
    await page.clock.runFor(19_000);
    await expect(loading).toHaveCount(1);
    await page.clock.runFor(1_000);
    await expect(gallery.getByRole("alert").filter({ hasText: "The cleaning tools didn't load. Reload the page to try again." })).toHaveCount(1);
    await expect(loading).toHaveCount(0);
  });

  // MS-KEY-01: a control that leaves while focused hands focus to the heading,
  // or in Full map, where no heading shows, to the control that leaves it.
  for (const [layout, setup, target] of [
    ["the status strip", async () => {}, ".panel-heading h2"],
    ["the phone action bar", async (page, gallery) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gallery.evaluate((element) => { element.narrow = true; });
    }, ".panel-heading h2"],
    ["the Full map HUD", async (page, gallery) => {
      await gallery.evaluate((element) => {
        element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), fullMap: true });
      });
      // Full map entry focuses its exit control after a frame; let it land first.
      await expect(gallery.locator(".workspace-toggle")).toBeFocused();
    }, ".workspace-toggle"],
  ]) {
    test(`@safety Stop pressed in ${layout} keeps focus in the panel when it leaves`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "cleaning" });
      await setup(page, gallery);
      await gallery.evaluate((element) => {
        element.addEventListener("matic-workspace-action", (event) => {
          if (event.detail.id !== "stop") return;
          element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), activity: "stopping", command: "settling" });
        });
      });
      const stop = gallery.getByRole("button", { name: "Stop cleaning" });
      await stop.focus();
      // The key press must reach Stop; a layout change in between would move it.
      await expect(stop).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(stop).toHaveCount(0);
      const focused = await gallery.evaluate((element, selector) => {
        let active = element.shadowRoot.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        if (active?.matches(selector)) return selector;
        return active ? active.outerHTML.slice(0, 80) : `document.activeElement ${document.activeElement?.localName}`;
      }, target);
      expect(focused).toBe(target);
    });
  }

  test("confirms a named room schedule reset and sends its exact saved identities", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans.value;
      const cadence = {
        scope: "shared",
        mopEveryN: 3,
        coverageEveryN: 2,
        periodicCoverageSetting: "quick",
        doMopNext: false,
        doCoverageNext: false,
      };
      const plan = plans.plans[0];
      const rooms = plan.rooms.map((room) => room.roomId === "room-a"
        ? { ...room, cadence, cadenceProgress: { mopProgress: 1, coverageProgress: 1, mopDue: false, coverageDue: false, nextMopIn: 2, nextCoverageIn: 1, reasons: [] } }
        : room);
      element.replaceWorkspaceState({
        ...state,
        resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...plans, plans: [{ ...plan, rooms }] } } },
      });
    }, GALLERY_TAG);
    await openPlanPicker(gallery);
    await gallery.getByRole("button", { name: /^Daily clean/ }).click();
    await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    const inspector = gallery.locator(".inspector");
    // plan.md §3: a room's schedule is inside its settings.
    await inspector.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
    // room-schedule.md §3: Reset lives in the room's "More for {room}" menu.
    const more = inspector.getByRole("group", { name: "Smart cleaning for Kitchen" }).getByRole("button", { name: "More for Kitchen" });
    await more.click();
    await expect(inspector.getByRole("menuitem", { name: "Reset vacuum rotation progress for Kitchen" })).toBeVisible();
    const reset = inspector.getByRole("menuitem", { name: "Reset mopping progress for Kitchen" });
    await reset.click();
    const dialog = gallery.getByRole("dialog", { name: "Reset mopping progress?" });
    await expect(dialog).toContainText("The count for Kitchen starts again in every plan that shares its schedule");
    await expect(dialog).toContainText("Other work and cleaning history don't change.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await more.click();
    await reset.click();
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      element.__resetAction = null;
      element.addEventListener("matic-workspace-action", (event) => {
        element.__resetAction = event.detail;
      }, { once: true });
    }, GALLERY_TAG);
    await dialog.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const action = await page.evaluate((tag) => document.querySelector(tag).__resetAction, GALLERY_TAG);
    expect(action).toEqual({ id: "reset-room-cadence", planId: "daily", roomId: "room-a", mode: "mop" });
  });

  test("explains unverified schedule progress and keeps each reset available", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans.value;
      const plan = plans.plans[0];
      const rooms = plan.rooms.map((room) => room.roomId === "room-a"
        ? {
          ...room,
          cadence: {
            scope: "plan",
            mopEveryN: 3,
            coverageEveryN: 4,
            periodicCoverageSetting: "heavy_duty",
            doMopNext: false,
            doCoverageNext: false,
          },
          cadenceProgress: undefined,
          cadenceReasons: ["mop_progress_unverified", "coverage_progress_unverified"],
        }
        : room);
      element.replaceWorkspaceState({
        ...state,
        resources: {
          ...state.resources,
          plans: { ...state.resources.plans, value: { ...plans, plans: [{ ...plan, rooms }] } },
        },
      });
    }, GALLERY_TAG);
    await openPlanPicker(gallery);
    await gallery.getByRole("button", { name: /^Daily clean/ }).click();
    await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    const inspector = gallery.locator(".inspector");
    await inspector.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
    await expect(inspector.getByRole("group", { name: "Smart cleaning for Kitchen" })).toBeVisible();
    await expect(inspector).toContainText("Can't run this schedule until you reset its mopping progress, which Home Assistant can't confirm.");
    await expect(inspector).toContainText("Can't run this schedule until you reset its vacuum rotation progress, which Home Assistant can't confirm.");
    await expect(inspector.getByRole("button", { name: "Reset mopping progress for Kitchen" })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Reset vacuum rotation progress for Kitchen" })).toBeVisible();
  });

  test("previews next-run order, effective settings, cadence reasons, and part breaks", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans.value;
      const current = plans.plans[0];
      const nextRunPreview = {
        previewToken: "a".repeat(64),
        rooms: [
          { roomId: "room-b", name: "Living room", cleaningMode: "vacuum_and_mop", coverageSetting: "heavy_duty", cadenceReasons: ["mop_due"] },
          { roomId: "room-a", name: "Kitchen", cleaningMode: "vacuum", coverageSetting: "quick", cadenceReasons: ["coverage_due"] },
        ],
        missionBoundaries: [1],
        blocker: null,
      };
      element.replaceWorkspaceState({
        ...state,
        resources: {
          ...state.resources,
          plans: { ...state.resources.plans, value: { ...plans, plans: [{ ...current, nextRunPreview }] } },
        },
      });
    }, GALLERY_TAG);
    await openPlanPicker(gallery);
    await gallery.getByRole("button", { name: /^Daily clean/ }).click();
    // plan.md §3 Run R1: server order, one setting string per row, due lines
    // above, `v4_room_parts` and a named divider at each boundary.
    const rows = gallery.locator(".run-list > li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText("Living room Vacuum + mop · Heavy duty");
    await expect(rows.nth(1)).toHaveText("Part 2 starts here; the robot may stop at the dock first Kitchen Vacuum · Quick");
    await expect(gallery.getByText("Mop due in Living room", { exact: true })).toBeVisible();
    await expect(gallery.getByText("Quick vacuum due in Kitchen", { exact: true })).toBeVisible();
    await expect(gallery.getByText("The robot cleans in 2 parts and may stop at the dock between parts.", { exact: true })).toBeVisible();
    // plan.md §6 (v4_action_run_plan_named): Run plan is named with the plan.
    await expect(gallery.getByRole("button", { name: "Run plan Daily clean", exact: true })).toBeEnabled();
  });

  test("keeps manual room choice within the service limit and explains the disabled choices", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const catalog = state.resources.plans.value;
      const template = catalog.rooms[0];
      const rooms = Array.from({ length: 101 }, (_, index) => ({
        ...template,
        roomId: `room-limit-${index + 1}`,
        name: `Room ${index + 1}`,
      }));
      const selected = rooms.slice(0, 99);
      element.replaceWorkspaceState({
        ...state,
        workflow: "rooms",
        resources: {
          ...state.resources,
          plans: { ...state.resources.plans, value: { ...catalog, rooms } },
        },
        selection: {
          ...state.selection,
          roomIds: selected.map((room) => room.roomId),
          roomSettings: selected.map((room) => ({ roomId: room.roomId, cleaningMode: "vacuum", coverageSetting: "standard" })),
        },
      });
    }, GALLERY_TAG);
    const rooms = gallery.getByRole("group", { name: "Rooms to clean" });
    const choices = rooms.locator('input[type="checkbox"]');
    await expect(choices).toHaveCount(101);
    await choices.nth(99).check();
    await expect(choices.nth(99)).toBeChecked();
    // home-rooms.md §4 R5: the limit line sits in the header with no live
    // role, and the spare row is held by it, not natively disabled.
    await expect(choices.nth(100)).toHaveAttribute("aria-disabled", "true");
    await expect(choices.nth(100)).toHaveAccessibleDescription("Up to 100 rooms fit in one clean, so remove one to add another.");
    await expect(gallery.getByRole("status").filter({ hasText: "Up to 100 rooms fit" })).toHaveCount(0);
    await expect(gallery.locator("#rooms-limit")).toHaveText("Up to 100 rooms fit in one clean, so remove one to add another.");
    await expect(rooms.locator('input[type="checkbox"]:checked')).toHaveCount(100);

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const catalogRooms = state.resources.plans.value.rooms;
      const selected = catalogRooms.slice(0, 99).map((room) => ({
        roomId: room.roomId, cleaningMode: "vacuum", coverageSetting: "standard",
      }));
      element.replaceWorkspaceState({
        ...state,
        workflow: "plan",
        planView: "edit",
        planDraft: { ...state.planDraft, id: null, name: "Capacity check", rooms: selected, dirty: false },
      });
    }, GALLERY_TAG);
    const planRooms = gallery.getByRole("list", { name: "Rooms", exact: true });
    const planChoices = planRooms.getByRole("checkbox");
    await expect(planChoices).toHaveCount(101);
    await planChoices.nth(99).check();
    await expect(planChoices.nth(99)).toBeChecked();
    // plan.md §3: the room past the limit stays focusable, says why, and
    // doesn't change.
    const limit = "Can't add more rooms until you remove one; a plan holds up to 100.";
    await expect(gallery.getByText(limit, { exact: true })).toBeVisible();
    await expect(planChoices.nth(100)).toHaveAttribute("aria-disabled", "true");
    await expect(planChoices.nth(100)).toHaveAccessibleDescription(limit);
    await planChoices.nth(100).dispatchEvent("click");
    await expect(planChoices.nth(100)).not.toBeChecked();
    await expect.poll(async () => (await snapshot(page)).planDraft.rooms.length).toBe(100);
  });

  test("blocks an oversized legacy plan with a clear recovery action", async ({ page }) => {
    const roomCatalog = Array.from({ length: 102 }, (_, index) => ({
      room_id: `legacy-room-${index + 1}`,
      name: `Legacy room ${index + 1}`,
      boundary: [[0, 0], [6, 0], [6, 5], [0, 5]],
    }));
    const planRooms = roomCatalog.map((room) => ({
      room_id: room.room_id,
      cleaning_mode: "vacuum",
      coverage_setting: "standard",
    }));
    const fixture = await installPanelFixture(page, {
      moduleSource: "packaged",
      initialPlanCatalog: {
        rooms: roomCatalog,
        selected_plan: "legacy-plan",
        plans: [{
          id: "legacy-plan",
          name: "Legacy plan",
          enabled: true,
          run_behavior: "ordered",
          rooms: planRooms,
          room_order: planRooms.map((room) => room.room_id),
          return_to_base: true,
          finish_current_room: false,
          finish_current_room_threshold: 50,
        }],
      },
    });
    await page.evaluate(() => {
      document.body.append(window.__panelFixture.createPanel());
    });
    const gallery = page.locator(fixture.panelTag);
    await expect.poll(() => page.evaluate(() => {
      const panel = document.querySelector(window.__panelFixture.panelTag);
      const plans = panel?.getWorkspaceSnapshot().resources.plans;
      return { status: plans?.status, count: plans?.value?.plans[0]?.rooms.length };
    })).toEqual({ status: "ready", count: 102 });
    await openPlanPicker(gallery);
    await gallery.getByRole("button", { name: /^Legacy plan/ }).click();

    await expect(gallery.getByRole("button", { name: "Run plan Legacy plan", exact: true })).toBeDisabled();
    // A saved plan opens in Run (plan.md §5 State); its rooms change in Edit.
    await page.evaluate((tag) => {
      document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-plan-view", view: "edit" }, bubbles: true, composed: true,
      }));
    }, fixture.panelTag);
    const rooms = gallery.getByRole("list", { name: "Rooms", exact: true });
    const draftRoomCount = () => page.evaluate(
      (tag) => document.querySelector(tag).getWorkspaceSnapshot().planDraft.rooms.length,
      fixture.panelTag,
    );
    await rooms.getByRole("checkbox").first().uncheck();
    expect(await draftRoomCount()).toBe(101);
    await expect(gallery.getByRole("button", { name: "Save", exact: true })).toBeEnabled();

    const initialPlanReads = await page.evaluate(() => window.__panelFixture.planReads);
    await gallery.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(1);
    await expect.poll(() => page.evaluate((tag) => {
      const state = document.querySelector(tag).getWorkspaceSnapshot();
      return {
        draftDirty: state.planDraft.dirty,
        draftCount: state.planDraft.rooms.length,
        savedCount: state.resources.plans.value?.plans[0]?.rooms.length,
        planView: state.planView,
      };
    }, fixture.panelTag)).toEqual({ draftDirty: false, draftCount: 101, savedCount: 101, planView: "run" });
    await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(initialPlanReads);

    const firstSavedCall = await page.evaluate(() => window.__panelFixture.serviceCalls[0]);
    expect(firstSavedCall.data.rooms.map((room) => room.room)).toEqual(
      Array.from({ length: 101 }, (_, index) => `legacy-room-${index + 2}`),
    );

    // A save returns to Run (plan.md §5 Navigation); the next edit opens Edit again.
    await page.evaluate((tag) => {
      document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-plan-view", view: "edit" }, bubbles: true, composed: true,
      }));
    }, fixture.panelTag);

    await gallery.getByRole("checkbox", { name: /Legacy room 2$/ }).uncheck();
    expect(await draftRoomCount()).toBe(100);
    await expect(gallery.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await gallery.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(2);
    await expect.poll(() => page.evaluate((tag) => {
      const state = document.querySelector(tag).getWorkspaceSnapshot();
      return {
        draftDirty: state.planDraft.dirty,
        draftCount: state.planDraft.rooms.length,
        savedCount: state.resources.plans.value?.plans[0]?.rooms.length,
      };
    }, fixture.panelTag)).toEqual({ draftDirty: false, draftCount: 100, savedCount: 100 });

    const savedCall = await page.evaluate(() => window.__panelFixture.serviceCalls[1]);
    expect(savedCall).toMatchObject({ domain: "matic_robot", service: "save_plan", target: { entity_id: "vacuum.synthetic" } });
    expect(savedCall.data.rooms.map((room) => room.room)).toEqual(
      Array.from({ length: 100 }, (_, index) => `legacy-room-${index + 3}`),
    );

    await gallery.getByRole("button", { name: "Back to plans", exact: true }).click();
    await gallery.getByRole("button", { name: /^Legacy plan/ }).click();
    await gallery.getByRole("button", { name: "Edit Legacy plan", exact: true }).click();
    await expect(gallery.getByRole("list", { name: "Rooms", exact: true })
      .getByRole("checkbox", { checked: true })).toHaveCount(100);
    await expect.poll(() => page.evaluate((tag) => {
      const state = document.querySelector(tag).getWorkspaceSnapshot();
      return state.planDraft.rooms.length;
    }, fixture.panelTag)).toBe(100);
  });

  test("requires review when a saved-plan preview changes before dispatch", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = { ...createGalleryState("ready"), workflow: "plan" };
      const store = new WorkspaceStore(initial);
      const oldCatalog = initial.resources.plans.value;
      const firstPlan = oldCatalog.plans[0];
      const updatedCatalog = {
        ...oldCatalog,
        plans: [{
          ...firstPlan,
          nextRunPreview: {
            ...firstPlan.nextRunPreview,
            rooms: [...firstPlan.nextRunPreview.rooms].reverse(),
          },
        }],
      };
      let useUpdatedPreview = false;
      const calls = [];
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry],
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => useUpdatedPreview ? updatedCatalog : oldCatalog,
        service: async (...args) => { calls.push(args); },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      try {
        await effects.refreshCatalog(true);
        useUpdatedPreview = true;
        await effects.executeAction("run-plan");
        return { calls, notice: store.value.notice?.key, refreshedOrder: store.value.resources.plans.value?.plans[0]?.nextRunPreview?.rooms.map((room) => room.roomId) };
      } finally { effects.dispose(); }
    });
    expect(result.calls).toEqual([]);
    expect(result.notice).toBe("v4_notice_plan_preview_changed");
    expect(result.refreshedOrder).toEqual(["room-c", "room-b", "room-a"]);
  });

  test("routes a typed room cadence reset to the exact saved plan and room", async ({ page }) => {
    await loadEffectHarness(page);
    const calls = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState, withGalleryRoomPreview } = await import("/plan-recovery-test.js");
      const base = createGalleryState("ready");
      const initial = withGalleryRoomPreview({ ...base, workflow: "rooms", selection: {
        ...base.selection, roomIds: ["room-a"],
        roomSettings: [{ roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "quick" }],
      } });
      const store = new WorkspaceStore(initial);
      const captured = [];
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry],
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        service: async (...args) => { captured.push(args); },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      try {
        await effects.refreshCatalog(true);
        await effects.executeAction({ id: "reset-room-cadence", planId: "daily", roomId: "room-a", mode: "mop" });
        return captured;
      } finally { effects.dispose(); }
    });
    expect(calls).toEqual([["matic_robot", "reset_room_cadence", { plan: "daily", room_id: "room-a", modes: ["mop"] }, "vacuum.synthetic", { acknowledgementTimeout: "mutation" }]]);
  });

  test("uses the shared room schedule by default and keeps its progress visible during an override", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans.value;
      const rooms = plans.rooms.map((room) => room.roomId === "room-a" ? {
        ...room,
        sharedCadence: { scope: "shared", mopEveryN: 3, coverageEveryN: null,
          periodicCoverageSetting: null, doMopNext: false, doCoverageNext: false },
        sharedCadenceProgress: { mopProgress: 3, coverageProgress: 0,
          mopDue: true, coverageDue: false, nextMopIn: 0, nextCoverageIn: null, reasons: ["mop_due"] },
        sharedCadenceReasons: ["mop_due"],
      } : room);
      element.replaceWorkspaceState({ ...state,
        resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...plans, rooms } } } });
    }, GALLERY_TAG);
    await gallery.getByRole("button", { name: /^Clean rooms/ }).click();
    const roomList = gallery.getByRole("group", { name: "Rooms to clean" });
    // home-rooms.md §5 Due work: the shared schedule's due work puts the
    // "Use room schedules" switch in the settings row, on by
    // default; off sends the user's settings alone and keeps the switch.
    await expect(gallery.getByRole("switch")).toHaveCount(0);
    await roomList.getByRole("checkbox").first().check();
    await gallery.getByRole("button", { name: /^Cleaning settings/ }).click();
    const useSchedule = gallery.getByRole("switch", { name: "Use room schedules" });
    await expect(useSchedule).toHaveAttribute("aria-checked", "true");
    expect((await snapshot(page)).selection.useRoomSchedule).toBe(true);
    await useSchedule.click();
    await expect(useSchedule).toHaveAttribute("aria-checked", "false");
    expect((await snapshot(page)).selection.useRoomSchedule).toBe(false);
    await expect(useSchedule).toBeVisible();
  });

  test("registers the sidebar robot before opening the map without replacing other icon sets", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.customIcons = { other: { getIcon: async () => ({ path: "M1 1H2" }) } };
    });
    await page.addScriptTag({ url: "/matic_icons.js", type: "module" });
    const result = await page.evaluate(async () => ({
      robot: await window.customIcons.matic.getIcon("robot"),
      unknown: await window.customIcons.matic.getIcon("unknown"),
      list: await window.customIcons.matic.getIconList(),
      other: await window.customIcons.other.getIcon("existing"),
      panelLoaded: !!customElements.get("matic-map-studio-gallery-v0-4-0"),
    }));
    expect(result.robot.viewBox).toBe("0 0 24 24");
    expect(result.robot.path).toContain("M8.2 6.2H22.6");
    expect(result.unknown.path).toBe("");
    expect(result.list).toEqual([{ name: "robot", keywords: ["robot", "vacuum", "matic"] }]);
    expect(result.other.path).toBe("M1 1H2");
    expect(result.panelLoaded).toBe(false);
  });

  for (const canRebind of [true, false]) {
    test(`shows one actionable area recovery instruction when review is ${canRebind}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready" });
      await page.evaluate(({ tag, reviewable }) => {
        const element = document.querySelector(tag);
        const state = element.getWorkspaceSnapshot();
        element.replaceWorkspaceState({
          ...state,
          workflow: "areaReview",
          areaDraft: { ...state.areaDraft, status: "stale", canRebind: reviewable },
          draw: { ...state.draw, circles: [{ x: 1.5, y: 1.4, radius: 0.3 }] },
        });
      }, { tag: GALLERY_TAG, reviewable: canRebind });
      const review = gallery.getByText("The map changed since this area was saved. Inspect its saved circle coverage on the current map, then confirm to update the saved map binding. Redraw it if the coverage is uncertain.", { exact: true });
      const redraw = gallery.getByText("Home Assistant can't use this area as it was saved, so redraw it.", { exact: true });
      await expect(canRebind ? review : redraw).toBeVisible();
      await expect(canRebind ? redraw : review).toHaveCount(0);
    });
  }

  // plan.md §3 Picker: the default plan first, then catalog order; line 2 the
  // count and order; line 3 the due work or "Needs attention"; a paused plan
  // shows only its chip; Create a plan is the last, secondary row.
  test("the picker shows each plan's order, default and due work, and Create a plan last", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plans" });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      const value = state.resources.plans.value;
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans,
        value: { ...value, plans: [value.plans[1], value.plans[2], value.plans[0]] } } } });
    });
    const rows = gallery.locator("[data-plan-row]");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((items) => items.map((item) => item.dataset.planRow))).toEqual(["daily", "weekend", "guest"]);
    const daily = gallery.getByRole("button", { name: /^Daily clean/ });
    await expect(daily.locator("strong bdi")).toHaveText("Daily clean");
    await expect(daily.locator("strong .ms-chip")).toHaveText("Default");
    await expect(daily.locator("strong .ms-chip")).toHaveAttribute("title", "Home Assistant's plan button and plan select run this plan.");
    await expect(daily).toHaveAccessibleDescription("Home Assistant's plan button and plan select run this plan.");
    await expect(daily.locator("small")).toHaveText("3 rooms · Longest-waiting rooms first");
    // Intl.ListFormat joins the rooms that share a due kind (plan.md §3).
    await expect(daily.locator(".line")).toHaveText(["Mop due in Kitchen and Living room", "Optimal vacuum due in Kitchen"]);
    const weekend = gallery.getByRole("button", { name: /^Weekend refresh/ });
    await expect(weekend.locator(".ms-chip")).toHaveCount(0);
    await expect(weekend.locator("small")).toHaveText("2 rooms · Top to bottom, as listed");
    await expect(weekend.locator(".line")).toHaveText("Needs attention before it can run");
    // Line 3 is one size whatever it says (plan.md §3, --ms-t-xs).
    const size = (row) => row.locator(".line").first().evaluate((element) => getComputedStyle(element).fontSize);
    expect(await size(weekend)).toBe(await size(daily));
    await expect(weekend).toHaveAccessibleDescription("");
    const paused = gallery.getByRole("button", { name: /^Guest prep/ });
    await expect(paused.locator("strong .ms-chip")).toHaveText("Paused");
    await expect(paused.locator("small")).toHaveText("1 room · Longest-waiting rooms first");
    await expect(paused.locator(".line")).toHaveCount(0);
    const items = gallery.locator("matic-map-plan-views-v4 li");
    await expect(items.last().getByRole("button")).toHaveText("Create a plan");
    await expect(items.last().getByRole("button")).not.toHaveClass(/ms-btn--primary/);
  });

  for (const [width, narrow] of [[390, true], [1024, false]]) {
    test(`a long plan name ends in an ellipsis and keeps its chips on line 1 at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const gallery = await loadGallery(page, { scenario: "plans", narrow });
      await settleWorkspace(gallery);
      await gallery.evaluate((element) => {
        const state = element.getWorkspaceSnapshot();
        const value = state.resources.plans.value;
        const plans = value.plans.map((plan) => plan.id === "daily" ? { ...plan, name: "A very long plan name for every room on the ground floor and the stairs" } : plan);
        element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...value, plans } } } });
      });
      const row = gallery.locator('[data-plan-row="daily"]');
      await expect(row.locator(".plan-title bdi")).toHaveText(/^A very long plan name/);
      const layout = await row.evaluate((button) => {
        const bdi = button.querySelector(".plan-title bdi");
        const chip = button.querySelector(".plan-title .ms-chip");
        const body = button.querySelector(".ms-row__body").getBoundingClientRect();
        const name = bdi.getBoundingClientRect();
        const chipBox = chip.getBoundingClientRect();
        return {
          ellipsis: getComputedStyle(bdi).textOverflow,
          truncated: bdi.scrollWidth > bdi.clientWidth,
          inside: name.right <= body.right + 0.5 && chipBox.right <= body.right + 0.5,
          sameLine: Math.abs(chipBox.top + chipBox.height / 2 - (name.top + name.height / 2)) < 4,
        };
      });
      expect(layout).toEqual({ ellipsis: "ellipsis", truncated: true, inside: true, sameLine: true });
    });
  }

  test("Rooms' preview gives each room its setting as one string", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms" });
    await settleWorkspace(gallery);
    await page.evaluate((tag) => {
      const { withGalleryRoomPreview } = window.__galleryModule;
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState(withGalleryRoomPreview({ ...state, workflow: "rooms", selection: { ...state.selection,
        roomIds: ["room-a"], roomSettings: [{ roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "standard" }] } }));
    }, GALLERY_TAG);
    // home-rooms.md §6 v4_room_setting_*: the whole string, not mode + coverage
    // text, as the selected row's second line.
    const kitchen = gallery.getByRole("group", { name: "Rooms to clean" }).getByRole("checkbox", { name: /^Kitchen/ });
    await expect(kitchen).toBeChecked();
    await expect(kitchen).toHaveAccessibleName("Kitchen Vacuum · Optimal");
  });

  test("a picker with no plans offers one filled Create a plan", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plans" });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans,
        value: { ...state.resources.plans.value, plans: [], selectedPlan: null } } } });
    });
    await expect(gallery.getByRole("heading", { level: 3, name: "No plans yet" })).toBeVisible();
    await expect(gallery.getByText("Save a plan to repeat a set of rooms.", { exact: true })).toBeVisible();
    // The card stands alone: no "Tap a plan" description above it.
    await expect(gallery.getByText("Tap a plan to see its next run.")).toHaveCount(0);
    await expect(gallery.locator("[data-plan-row]")).toHaveCount(0);
    const create = gallery.getByRole("button", { name: "Create a plan", exact: true });
    await expect(create).toHaveClass(/ms-btn--primary/);
    await create.click();
    expect(await gallery.evaluate((element) => element.getWorkspaceSnapshot())).toMatchObject({ workflow: "plan", planView: "edit" });
  });

  // plan.md §5 Navigation and focus: a row opens Run and focuses its heading;
  // Back returns to the picker with focus on that row (MS-KEY-01).
  test("a picker row opens Run, and Back returns focus to that row", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plans" });
    await gallery.getByRole("button", { name: /^Weekend refresh/ }).click();
    expect(await gallery.evaluate((element) => element.getWorkspaceSnapshot())).toMatchObject({
      workflow: "plan", planView: "run", selection: { planId: "weekend" },
    });
    await expect(gallery.getByRole("heading", { level: 2, name: "Weekend refresh" })).toBeFocused();
    await gallery.getByRole("button", { name: "Back to plans", exact: true }).click();
    await expect(gallery.getByRole("button", { name: /^Weekend refresh/ })).toBeFocused();
  });

  // plan.md §3 Run view, R1 ready, at the phone sheet and the inspector.
  for (const [width, height, narrow] of [[390, 844, true], [1024, 768, false]]) {
    test(`Run shows the next run's summary, due work and rooms at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent", narrow });
      await settleWorkspace(gallery);
      await gallery.evaluate((element) => {
        const state = element.getWorkspaceSnapshot();
        const catalog = state.resources.plans.value;
        const plans = catalog.plans.map((plan) => ({ ...plan, nextRunPreview: { ...plan.nextRunPreview,
          rooms: plan.nextRunPreview.rooms.map((room) => ({ ...room, cadenceReasons: ["mop_due"] })) } }));
        element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...catalog, plans } } } });
      });
      await expect(gallery.getByText("3 rooms · about 33 min", { exact: true })).toBeVisible();
      await expect(gallery.getByText("Mop due in Kitchen, Living room, and Office", { exact: true })).toBeVisible();
      await expect(gallery.getByRole("heading", { name: "Next run", level: 3 })).toBeVisible();
      await expect(gallery.getByText("Longest-waiting rooms and custom areas first, checked again when you run the plan.", { exact: true })).toBeVisible();
      // Intelligent rotation: an unnumbered list, one setting string per row.
      await expect(gallery.locator("ol.run-list")).toHaveCount(0);
      const rows = gallery.locator("ul.run-list > li");
      await expect(rows).toHaveText(["Kitchen Vacuum · Optimal", "Living room Vacuum · Optimal", "Office Vacuum · Optimal"]);
      await expect(rows.locator(".pos-badge")).toHaveCount(0);
      const enabled = gallery.getByRole("switch", { name: "Plan enabled" });
      await expect(enabled).toHaveAttribute("aria-checked", "true");
      await expect(enabled).toHaveAccessibleDescription("When it's on, this plan can run from here, from automations and from Home Assistant actions.");
      await expect(gallery.getByText("Returns to the dock when finished", { exact: true })).toBeVisible();
      await expect(gallery.getByRole("button", { name: "Run plan Daily clean", exact: true })).toBeEnabled();
      await expect(gallery.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    });
  }

  test("Run numbers Saved order and marks each part break", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-ordered" });
    await expect(gallery.locator("ol.run-list > li")).toHaveText(["1 Office Vacuum · Optimal", "2 Kitchen Vacuum · Optimal", "3 Living room Vacuum · Optimal"]);
    await expect(gallery.getByText("Longest-waiting rooms and custom areas first, checked again when you run the plan.")).toHaveCount(0);

    await gallery.evaluate((element) => element.setScenario("plan-run-parts"));
    await settleWorkspace(gallery);
    await expect(gallery.getByText("The robot cleans in 2 parts and may stop at the dock between parts.", { exact: true })).toBeVisible();
    await expect(gallery.getByText("Mop due in Kitchen", { exact: true })).toBeVisible();
    const rows = gallery.locator("ol.run-list > li");
    await expect(rows).toHaveText([
      "1 Kitchen Vacuum + mop · Optimal",
      "Part 2 starts here; the robot may stop at the dock first 2 Living room Vacuum · Optimal",
      "3 Office Vacuum · Optimal",
    ]);
    await expect(gallery.locator(".run-row[data-break]")).toHaveCount(1);
  });

  test("Run lists custom areas in their place and counts them apart from rooms", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-ordered" });
    const preview = async (steps, missionBoundaries) => gallery.evaluate((element, [steps, missionBoundaries]) => {
      const state = element.getWorkspaceSnapshot();
      const catalog = state.resources.plans.value;
      const plans = catalog.plans.map((plan) => ({ ...plan, nextRunPreview: { ...plan.nextRunPreview,
        rooms: steps.filter((step) => step.roomId), steps, missionBoundaries } }));
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...catalog, plans } } } });
    }, [steps, missionBoundaries]);
    const rug = { areaId: "rug", name: "Rug", cleaningMode: "mop", coverageSetting: "quick", cadenceReasons: [] };
    const kitchen = { roomId: "room-a", name: "Kitchen", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: [] };
    const hall = { areaId: "hall", name: "Hall runner", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: [] };

    await preview([rug, kitchen, hall], [1, 2]);
    // Boundaries count every step, so each switch between a room and an area starts a part.
    await expect(gallery.locator("ol.run-list > li")).toHaveText([
      "1 Rug Mop",
      "Part 2 starts here; the robot may stop at the dock first 2 Kitchen Vacuum · Optimal",
      "Part 3 starts here; the robot may stop at the dock first 3 Hall runner Vacuum · Optimal",
    ]);
    await expect(gallery.getByText("1 room · 2 custom areas", { exact: true })).toBeVisible();
    await expect(gallery.getByText("The robot cleans in 3 parts and may stop at the dock between parts.", { exact: true })).toBeVisible();
    // A plan with custom areas runs like any other.
    await expect(gallery.getByRole("button", { name: /^Run plan/ })).toBeEnabled();

    await preview([rug], []);
    await expect(gallery.locator("ol.run-list > li")).toHaveText(["1 Rug Mop"]);
    await expect(gallery.getByText("1 custom area", { exact: true })).toBeVisible();
    await expect(gallery.getByText("0 rooms", { exact: true })).toHaveCount(0);
  });

  test("a paused plan lists its rooms and turns on from the switch", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-run-paused" });
    await expect(gallery.getByText("3 rooms", { exact: true })).toBeVisible();
    await expect(gallery.getByRole("heading", { name: "In this plan", level: 3 })).toBeVisible();
    await expect(gallery.locator("ul.run-list > li")).toHaveText(["Kitchen Vacuum · Optimal", "Living room Vacuum · Optimal", "Office Vacuum · Optimal"]);
    await expect(gallery.getByRole("switch", { name: "Plan enabled" })).toHaveAttribute("aria-checked", "false");
    await expect(gallery.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    await expect(gallery.locator(".problem")).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Run plan Daily clean", exact: true })).toBeDisabled();
  });

  test("a paused plan with custom areas lists them in their places, in the picker and in Edit", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-run-paused" });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      const catalog = state.resources.plans.value;
      const plans = catalog.plans.map((plan) => plan.id !== state.planDraft.id ? plan : { ...plan, entries: [
        { kind: "room", room_id: plan.rooms[0].roomId },
        { kind: "area", area_id: "rug", name: "Rug", cleaning_mode: "mop", coverage_setting: "quick" },
        ...plan.rooms.slice(1).map((room) => ({ kind: "room", room_id: room.roomId })),
        { kind: "area", area_id: "gone", cleaning_mode: "unknown", coverage_setting: "quick" },
      ] });
      // The draft is read from the plan as the plans list sends it.
      const planDraft = window.__galleryModule.draftForPlan(plans.find((plan) => plan.id === state.planDraft.id));
      element.replaceWorkspaceState({ ...state, planDraft, resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...catalog, plans } } } });
    });
    await expect(gallery.getByText("3 rooms · 1 custom area", { exact: true })).toBeVisible();
    // An area Map Studio can't read is left out rather than shown wrong.
    await expect(gallery.locator("ul.run-list > li")).toHaveText(["Kitchen Vacuum · Optimal", "Rug Mop", "Living room Vacuum · Optimal", "Office Vacuum · Optimal"]);
    await gallery.getByRole("button", { name: /^Edit / }).click();
    // Edit lists the area in its place among the rooms, and leaves out the one it can't read.
    await expect(gallery.getByRole("list", { name: "Rooms and custom areas", exact: true }).getByRole("button", { name: /^Settings for / }))
      .toHaveText([/^\s*Kitchen/u, /^\s*Rug/u, /^\s*Living room/u, /^\s*Office/u]);
    await gallery.getByRole("button", { name: "Cancel", exact: true }).click();
    await gallery.getByRole("button", { name: "Back to plans", exact: true }).click();
    await expect(gallery.getByRole("button", { name: /^Daily clean/ })).toContainText("3 rooms · 1 custom area · ");
  });

  test("a room that blocks the run says Needs attention, and Review opens it in Edit", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-run-blocked" });
    const rows = gallery.locator("ul.run-list > li");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("Needs attention");
    await expect(gallery.getByText("Needs attention", { exact: true })).toHaveCount(1);
    await expect(gallery.locator(".problem")).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    await expect(gallery.getByText("Can't run this plan until you reset Living room's schedule progress, which Home Assistant can't confirm.").first()).toBeVisible();
    await gallery.getByRole("button", { name: "Review Living room", exact: true }).click();
    expect(await gallery.evaluate((element) => element.getWorkspaceSnapshot().planView)).toBe("edit");
    // plan.md §5: Edit opens with that room's settings open and focused.
    const settings = gallery.getByRole("list", { name: "Rooms", exact: true })
      .getByRole("button", { name: "Settings for Living room", exact: true });
    await expect(settings).toHaveAttribute("aria-expanded", "true");
    await expect(settings).toBeFocused();
    await expect(settings).toContainText("Needs attention");
  });

  test("a next run that can't be checked says why and offers Try again", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-legacy-oversized" });
    await gallery.evaluate((element) => element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), planView: "run" }));
    await expect(gallery.locator(".problem")).toHaveText("Can't run this plan until it has 100 rooms or fewer.");
    const intents = await page.evaluateHandle(() => {
      const seen = [];
      document.addEventListener("matic-workspace-intent", (event) => seen.push(event.detail), true);
      return seen;
    });
    await gallery.getByRole("button", { name: "Try again", exact: true }).click();
    expect(await intents.evaluate((seen) => seen)).toContainEqual({ type: "open-workflow", workflow: "plan" });
  });

  test("the Run switch says why it is held", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent" });
    await settleWorkspace(gallery);
    const enabled = gallery.getByRole("switch", { name: "Plan enabled" });
    await expect(enabled).not.toHaveAttribute("aria-disabled", "true");
    const base = await gallery.evaluate((element) => element.getWorkspaceSnapshot());
    const hint ="When it's on, this plan can run from here, from automations and from Home Assistant actions.";
    for (const [patch, reason] of [
      [{ command: "pending", pendingAction: "save-plan" }, "Waiting for Home Assistant to save the plan."],
      [{ command: "pending", pendingAction: "run-plan" }, "Waiting for Home Assistant to check the next run."],
      [{ activity: "cleaning" }, "Can't change this until the robot finishes."],
      [{ host: { connected: true, robotConnected: false } }, "Waiting for Home Assistant to reach the robot again."],
      [{ pageActive: false }, "Waiting for the map to be ready."],
    ]) {
      await gallery.evaluate((element, { value, base }) => {
        element.replaceWorkspaceState({ ...base, ...value, ...(value.host ? { host: { ...base.host, ...value.host } } : {}) });
      }, { value: patch, base });
      await expect(enabled, reason).toHaveAttribute("aria-disabled", "true");
      await expect(enabled, reason).toHaveAccessibleDescription(`${hint} ${reason}`);
      await enabled.dispatchEvent("click");
      expect(await gallery.evaluate((element) => element.getWorkspaceSnapshot().planDraft.enabled), reason).toBe(true);
    }
  });

  test("Run heads the list After this run while a plan is running", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent" });
    await settleWorkspace(gallery);
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, entry: { ...state.resources.entry, activePlan: true } } });
    });
    await expect(gallery.getByRole("heading", { name: "After this run", level: 3 })).toBeVisible();
    await expect(gallery.getByRole("heading", { name: "Next run", level: 3 })).toHaveCount(0);
  });

  test("the Run switch pauses a saved plan through Home Assistant and says so", async ({ page }) => {
    const rooms = [
      { room_id: "kitchen", name: "Kitchen", boundary: [[0, 0], [3, 0], [3, 3], [0, 3]] },
      { room_id: "hall", name: "Hall", boundary: [[3, 0], [6, 0], [6, 3], [3, 3]] },
    ];
    const planRooms = rooms.map((room) => ({ room_id: room.room_id, cleaning_mode: "vacuum", coverage_setting: "standard" }));
    const fixture = await installPanelFixture(page, {
      moduleSource: "packaged",
      initialPlanCatalog: {
        rooms,
        selected_plan: "daily",
        plans: [{
          id: "daily", name: "Daily clean", enabled: true, run_behavior: "intelligent",
          rooms: planRooms, room_order: planRooms.map((room) => room.room_id),
          return_to_base: true, finish_current_room: false, finish_current_room_threshold: 50,
        }],
      },
    });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    await openPlanPicker(panel);
    await panel.getByRole("button", { name: /^Daily clean/ }).click();
    const enabled = panel.getByRole("switch", { name: "Plan enabled" });
    await expect(enabled).toHaveAttribute("aria-checked", "true");
    // From the keyboard, so every engine gives the switch focus (Safari does not on a click).
    await enabled.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(1);
    const call = await page.evaluate(() => window.__panelFixture.serviceCalls[0]);
    expect(call).toMatchObject({ domain: "matic_robot", service: "save_plan", data: { plan_id: "daily", enabled: false } });
    await expect(panel.locator("[data-notice-slot], [data-notice-toast]").filter({ hasText: "Plan paused" }).first()).toBeVisible();
    await expect(enabled).toHaveAttribute("aria-checked", "false");
    // plan.md §5: focus stays on the switch after success and after failure.
    await expect(enabled).toBeFocused();
    await page.evaluate(() => window.__panelFixture.failNextService("save_plan"));
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(2);
    await expect(enabled).toHaveAttribute("aria-checked", "false");
    await expect(enabled).toBeFocused();
  });

  test("Run's summary uses the one-room forms", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent" });
    await settleWorkspace(gallery);
    const oneRoom = (seconds) => gallery.evaluate((element, seconds) => {
      const state = element.getWorkspaceSnapshot();
      const catalog = state.resources.plans.value;
      const plans = catalog.plans.map((plan) => ({ ...plan, rooms: plan.rooms.slice(0, 1), roomOrder: plan.roomOrder.slice(0, 1),
        nextRunEstimateSeconds: seconds, nextRunPreview: { ...plan.nextRunPreview, rooms: plan.nextRunPreview.rooms.slice(0, 1) } }));
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...catalog, plans } } } });
    }, seconds);
    await oneRoom(1_980);
    await expect(gallery.locator(".summary")).toHaveText("1 room · about 33 min");
    await oneRoom(null);
    await expect(gallery.locator(".summary")).toHaveText("1 room");
  });

  test("a next run with no usable preview asks to retry it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent" });
    await settleWorkspace(gallery);
    for (const preview of [null, { previewToken: "not-a-token" }]) {
      await gallery.evaluate((element, preview) => {
        const state = element.getWorkspaceSnapshot();
        const catalog = state.resources.plans.value;
        const plans = catalog.plans.map((plan) => ({ ...plan, nextRunPreview: preview && { ...plan.nextRunPreview, ...preview } }));
        element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...catalog, plans } } } });
      }, preview);
      await expect(gallery.locator(".problem")).toHaveText("Can't run this plan until you retry its next-run preview.");
      await expect(gallery.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    }
  });

  test("an area-blocked Run explains the affected area and opens Your areas", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-run-areas" });
    await settleWorkspace(gallery);
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      const catalog = state.resources.plans.value;
      const plans = catalog.plans.map((plan) => ({ ...plan,
        nextRunPreview: { ...plan.nextRunPreview, blocker: "area_map_changed", rooms: [], steps: [] },
      }));
      const areas = state.resources.areas.value.areas.map((area) => ({ ...area,
        status: area.id === "entryway" ? "review" : area.status,
        canRebind: area.id === "entryway" ? true : area.canRebind,
      }));
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources,
        plans: { ...state.resources.plans, value: { ...catalog, plans } },
        areas: { ...state.resources.areas, value: { ...state.resources.areas.value, areas } },
      } });
    });
    const affected = gallery.locator(".run-row").filter({ hasText: "Entryway" });
    await expect(affected).toContainText("Map changed · Check it before cleaning");
    await expect(gallery.getByRole("button", { name: "Run plan Daily clean", exact: true })).toBeDisabled();
    await expect(gallery.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    const blockedState = await gallery.evaluate((element) => element.getWorkspaceSnapshot());
    for (const phase of ["paused", "saving"]) {
      await gallery.evaluate((element, { state, phase }) => element.replaceWorkspaceState({
        ...state,
        planDraft: { ...state.planDraft, enabled: phase !== "paused" },
        command: phase === "saving" ? "pending" : "idle",
        pendingAction: phase === "saving" ? "save-plan" : null,
      }), { state: blockedState, phase });
      await expect(gallery.locator(".run-row .problem"), phase).toHaveCount(0);
    }
    await gallery.evaluate((element, state) => element.replaceWorkspaceState(state), blockedState);
    await expect(affected).toContainText("Map changed · Check it before cleaning");
    await gallery.getByRole("button", { name: "Your areas", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areas");
  });

  test("turning a paused plan on shows no problem while it saves, then retries the stale preview", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-run-paused" });
    await settleWorkspace(gallery);
    const base = await gallery.evaluate((element) => element.getWorkspaceSnapshot());
    await gallery.evaluate((element, base) => element.replaceWorkspaceState({ ...base, command: "pending", pendingAction: "save-plan",
      planDraft: { ...base.planDraft, enabled: true } }), base);
    await expect(gallery.getByRole("switch", { name: "Plan enabled" })).toHaveAttribute("aria-checked", "true");
    await expect(gallery.locator(".problem")).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    await expect(gallery.getByText("Can't run this plan until you turn it on.")).toHaveCount(0);
    // The save is done but the preview still says paused: it is stale, so it is retried.
    await gallery.evaluate((element, base) => element.replaceWorkspaceState({ ...base, planDraft: { ...base.planDraft, enabled: true } }), base);
    await expect(gallery.locator(".problem")).toHaveText("Can't run this plan until you retry its next-run preview.");
  });

  test("delete dialogs use a generic title, the bare verb and the saved name", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent" });
    const savedPlan = await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        planDraft: { ...state.planDraft, name: "Unsaved rename", dirty: true },
        dialog: "confirmDeletePlan",
      });
      return state.resources.plans.value.plans.find((plan) => plan.id === state.planDraft.id).name;
    });
    const planDialog = gallery.getByRole("dialog", { name: "Delete plan?" });
    await expect(planDialog).toContainText(`Automations that run "${savedPlan}" will stop working, and the robot won't move.`);
    await expect(planDialog).not.toContainText("Unsaved rename");
    await expect(planDialog.getByRole("button", { name: "Delete", exact: true })).toBeVisible();

    await page.evaluate((tag) => document.querySelector(tag).setScenario("area-review-rebind"), GALLERY_TAG);
    const savedArea = await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        areaDraft: { ...state.areaDraft, name: "Unsaved area name", dirty: true },
        dialog: "confirmDeleteArea",
      });
      return state.resources.areas.value.areas.find((area) => area.id === state.areaDraft.id).name;
    });
    const areaDialog = gallery.getByRole("dialog", { name: "Delete area?" });
    await expect(areaDialog).toContainText(`Automations that clean "${savedArea}" will stop working, and the robot won't move.`);
    await expect(areaDialog).not.toContainText("Unsaved area name");
    await expect(areaDialog.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  });

  // The backend promotes the first remaining item in saved order, paused or
  // not, or none (plans.py:2623-2624, 2159-2160); the dialog says which.
  const openDelete = (gallery, { kind, id, selected, order }) => gallery.evaluate((element, request) => {
    const state = element.getWorkspaceSnapshot();
    const plan = request.kind === "plan";
    const resource = plan ? state.resources.plans : state.resources.areas;
    const scenario = window.__galleryModule.createGalleryState(plan ? "plans" : "area-review-rebind").resources;
    const pool = plan ? scenario.plans.value.plans : scenario.areas.value.areas;
    const extra = (itemId) => ({ ...pool[0], id: itemId, name: itemId[0].toUpperCase() + itemId.slice(1) });
    const items = request.order.map((itemId) => pool.find((item) => item.id === itemId) ?? extra(itemId));
    const name = items.find((item) => item.id === request.id).name;
    const value = { ...resource.value, [plan ? "plans" : "areas"]: items, [plan ? "selectedPlan" : "selectedArea"]: request.selected };
    element.replaceWorkspaceState({
      ...state,
      resources: { ...state.resources, [plan ? "plans" : "areas"]: { ...resource, value } },
      ...(plan
        ? { planDraft: { ...state.planDraft, id: request.id, name }, selection: { ...state.selection, planId: request.id } }
        : { areaDraft: { ...state.areaDraft, id: request.id, name }, selection: { ...state.selection, areaId: request.id } }),
      dialog: plan ? "confirmDeletePlan" : "confirmDeleteArea",
    });
  }, { kind, id, selected, order });

  test("deleting the default plan says which plan becomes the default", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plans" });
    const dialog = gallery.getByRole("dialog", { name: "Delete plan?" });
    for (const [id, order, expected] of [
      ["weekend", ["daily", "weekend", "guest"], "Daily clean becomes your default plan."],
      ["daily", ["daily", "guest", "weekend"], "Guest prep becomes your default plan."],
      ["daily", ["daily"], "You'll have no default plan."],
    ]) {
      await openDelete(gallery, { kind: "plan", id, selected: id, order });
      await expect(dialog, `deleting default ${id} of ${order}`).toContainText(expected);
    }
    await openDelete(gallery, { kind: "plan", id: "weekend", selected: "daily", order: ["daily", "weekend"] });
    await expect(dialog).toContainText("Automations that run \"Weekend refresh\" will stop working, and the robot won't move.");
    await expect(dialog, "a plan that is not the default changes no default").not.toContainText("default plan");
  });

  test("deleting the selected custom area says which area becomes selected", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-rebind" });
    const dialog = gallery.getByRole("dialog", { name: "Delete area?" });
    for (const [id, order, expected] of [
      ["entryway", ["porch", "entryway", "desk"], "Porch becomes the selected custom area."],
      ["porch", ["entryway", "desk", "porch"], "Entryway becomes the selected custom area."],
      ["entryway", ["entryway"], "No custom area will be selected."],
    ]) {
      await openDelete(gallery, { kind: "area", id, selected: id, order });
      await expect(dialog, `deleting selected ${id} of ${order}`).toContainText(expected);
    }
    await openDelete(gallery, { kind: "area", id: "entryway", selected: "porch", order: ["porch", "entryway"] });
    await expect(dialog).toContainText("Automations that clean \"Entryway\" will stop working, and the robot won't move.");
    await expect(dialog, "an area that is not selected changes no selection").not.toContainText("custom area");
  });

  test("area review holds its controls while a command runs, so Delete can't seem to run", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-rebind" });
    const remove = gallery.getByRole("button", { name: "Delete", exact: true });
    const name = gallery.getByRole("textbox", { name: "Area name" });
    await expect(remove).toBeEnabled();
    await expect(name).toBeEditable();
    await gallery.evaluate((element) => element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), command: "pending" }));
    // Held with a reason (map-surfaces.md §5 R12): focusable, described, inert.
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await expect(name).toHaveAttribute("aria-disabled", "true");
    await expect(name).toHaveAttribute("readonly", "");
    await remove.click({ force: true });
    await expect(gallery.getByRole("dialog")).toHaveCount(0);
    expect(await gallery.evaluate((element) => element.getWorkspaceSnapshot().dialog)).toBeNull();
    await gallery.evaluate((element) => element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), command: "idle" }));
    await expect(remove).not.toHaveAttribute("aria-disabled", "true");
  });

  test("Delete shows and its dialog stands only while the catalog holds the saved item", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-rebind" });
    const unresolved = (patch) => gallery.evaluate((element, { patch: kind }) => {
      const state = element.getWorkspaceSnapshot();
      const resources = kind === "area-loading"
        ? { ...state.resources, areas: { status: "loading", value: null, problem: null } }
        : { ...state.resources, plans: { ...state.resources.plans, value: { ...state.resources.plans.value, plans: [] } } };
      element.replaceWorkspaceState({ ...state, resources, ...(kind === "plan-gone" ? { planDraft: { ...state.planDraft, dirty: true } } : {}) });
      const dialog = kind === "area-loading" ? "confirmDeleteArea" : "confirmDeletePlan";
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), dialog });
      return element.getWorkspaceSnapshot().dialog;
    }, { patch });

    await expect(gallery.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    expect(await unresolved("area-loading"), "a delete dialog for an area the catalog has not loaded").toBeNull();
    await expect(gallery.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(gallery.getByRole("dialog")).toHaveCount(0);

    await page.evaluate((tag) => document.querySelector(tag).setScenario("plan-saved-intelligent"), GALLERY_TAG);
    // Delete lives in Edit's More actions (plan.md §3); Run has none.
    await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    await expect(gallery.getByRole("button", { name: "More actions", exact: true })).toBeVisible();
    expect(await unresolved("plan-gone"), "a delete dialog for a plan deleted elsewhere").toBeNull();
    await expect(gallery.getByRole("button", { name: "More actions", exact: true })).toHaveCount(0);
    await expect(gallery.getByRole("dialog")).toHaveCount(0);
  });

  test("a room settings check that fails says so and offers Try again", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms" });
    // The gallery always admits a synthetic preview, so the failed check is
    // rendered by handing the workflow panel that state directly. The panel
    // loads lazily, so wait for it before writing its state.
    await expect.poll(() => gallery.evaluate((element) => {
      const shell = element.shadowRoot.querySelector(".stage").firstElementChild;
      return [...(shell?.shadowRoot?.querySelectorAll("*") ?? [])]
        .some((node) => node.localName.startsWith("matic-map-workflow-v4"));
    })).toBe(true);
    await gallery.evaluate((element) => {
      const shell = element.shadowRoot.querySelector(".stage").firstElementChild;
      const panel = [...shell.shadowRoot.querySelectorAll("*")]
        .find((node) => node.localName.startsWith("matic-map-workflow-v4"));
      const state = element.getWorkspaceSnapshot();
      panel.state = { ...state, manualRoomPreview: { status: "error", value: null, problem: "request-failed" } };
    });
    // home-rooms.md §4 R4: the failed check is one line above the rows with
    // its Try again button.
    const problem = gallery.locator(".check-lines .line", { hasText: "room settings" });
    await expect(problem).toContainText("Home Assistant couldn't check the room settings.");
    await expect(problem.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  });

  test("a selected point has one name in every language", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const shell = element.shadowRoot.querySelector(".stage").firstElementChild;
      shell.localize = (key, values) => key === "component.matic_robot.common.v4_zone_point_number"
        ? `Punkt ${values.number}`
        : key;
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, draw: { ...state.draw, tool: "outline", undo: [], redo: [],
        outline: { closed: true, points: [{ x: 1, y: 1 }, { x: 3.5, y: 1 }, { x: 3.5, y: 2.5 }, { x: 1, y: 2.5 }] },
        circles: [{ x: 2.25, y: 1.75, radius: 0.7 }] } });
    }, GALLERY_TAG);
    await gallery.getByRole("button", { name: "Punkt 1", exact: true }).click();
    const actions = gallery.locator(".zone-point-actions");
    await expect(actions).toHaveAttribute("aria-label", "Punkt 1");
    await expect(actions.locator(".zone-selection")).toHaveText("Punkt 1");
  });

  test("never offers a hidden stale plan while its catalog is loading or unavailable @safety", async ({ page }) => {
    const gallery = await loadGallery(page);
    for (const workflow of ["plan", "rooms"]) {
      for (const status of ["loading", "error", "empty"]) {
        await page.evaluate(({ tag, workflow, status }) => {
          const element = document.querySelector(tag);
          const state = element.getWorkspaceSnapshot();
          element.replaceWorkspaceState({ ...state, workflow, resources: { ...state.resources, plans: { status, value: null, problem: status === "error" ? "request-failed" : null } } });
        }, { tag: GALLERY_TAG, workflow, status });
        await expect(gallery.locator(".action-bar button")).toHaveAttribute("aria-disabled", "true");
        await expect(gallery.locator(".action-bar")).not.toContainText("Run plan");
      }
    }
  });
  test("recovers an uncertain action only after a successful status read without replaying it", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState, withGalleryRoomPreview } = await import("/plan-recovery-test.js");
      const base = createGalleryState("ready");
      const initial = withGalleryRoomPreview({ ...base, workflow: "rooms", selection: {
        ...base.selection, roomIds: ["room-a"],
        roomSettings: [{ roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "quick" }],
      } });
      const store = new WorkspaceStore({ ...initial, command: "failed" });
      let writes = 0;
      let reject = true;
      const effects = new EffectController(store, {
        catalog: async () => { if (reject) throw new Error("Offline"); return [initial.resources.entry]; },
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        service: async () => { writes += 1; },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      try {
        await effects.executeAction("recheck-status");
        const failed = store.value.command;
        reject = false;
        await effects.executeAction("recheck-status");
        return { failed, recovered: store.value.command, writes };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ failed: "failed", recovered: "idle", writes: 0 });
  });
  for (const forced of [false, true]) {
    for (const succeeds of [false, true]) {
      test(`awaits ${forced ? "in-flight forced" : "queued forced"} status recovery when the read ${succeeds ? "succeeds" : "fails"}`, async ({ page }) => {
        await loadEffectHarness(page);
        await page.evaluate(async ({ forced }) => {
          const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
          const initial = createGalleryState("ready");
          const store = new WorkspaceStore({ ...initial, command: "failed" });
          const harness = { pending: [], settled: false, writes: 0, store, initial };
          let hold = false;
          const effects = new EffectController(store, {
            catalog: async (signal) => {
              if (!hold) return [initial.resources.entry];
              return new Promise((resolve, reject) => {
                harness.pending.push({ resolve, reject });
                signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
              });
            },
            history: async () => initial.resources.history.value,
            scene: async () => { throw new DOMException("Aborted", "AbortError"); },
            pose: async () => { throw new DOMException("Aborted", "AbortError"); },
            plans: async () => initial.resources.plans.value,
            service: async () => { harness.writes += 1; },
            dispose() {},
          });
          effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
          await effects.refreshCatalog(true);
          hold = true;
          void effects.refreshCatalog(forced);
          harness.effects = effects;
          harness.recovery = effects.executeAction("recheck-status").then(() => { harness.settled = true; });
          window.__statusRecovery = harness;
        }, { forced });
        await expect.poll(() => page.evaluate(() => window.__statusRecovery.pending.length)).toBe(forced ? 1 : 2);
        expect(await page.evaluate(() => {
          const h = window.__statusRecovery;
          return { settled: h.settled, command: h.store.value.command, writes: h.writes };
        })).toEqual({ settled: false, command: "failed", writes: 0 });
        const result = await page.evaluate(async ({ succeeds }) => {
          const h = window.__statusRecovery;
          const request = h.pending.at(-1);
          if (succeeds) request.resolve([h.initial.resources.entry]);
          else request.reject(new Error("Offline"));
          try {
            await h.recovery;
            return { command: h.store.value.command, writes: h.writes };
          } finally { h.effects.dispose(); }
        }, { succeeds });
        expect(result).toEqual({ command: succeeds ? "idle" : "failed", writes: 0 });
      });
    }
  }
  test("keeps Stop enabled after failed and accepted starts in every active state and layout @safety", async ({ page }) => {
    const gallery = await loadGallery(page);
    for (const command of ["failed", "starting"]) {
      for (const activity of ["cleaning", "returning", "recharging", "paused"]) {
        for (const fullMap of [false, true]) {
          await page.evaluate(({ tag, activity, fullMap, command }) => {
            const element = document.querySelector(tag);
            element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), activity, command, fullMap });
          }, { tag: GALLERY_TAG, activity, fullMap, command });
          const stop = gallery.getByRole("button", { name: "Stop cleaning", exact: true });
          await expect(stop).toBeVisible();
          await expect(stop).not.toHaveAttribute("aria-disabled", "true");
        }
      }
    }
  });
  for (const mobile of [false, true]) {
    test(`keeps Stop reachable before vacuum state catches up${mobile ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { narrow: mobile });
      for (const evidence of ["starting", "runnerLocked", "activePlan", "nativeSessionActive"]) {
        for (const fullMap of [false, true]) {
          await page.evaluate(({ tag, evidence, fullMap }) => {
            const element = document.querySelector(tag);
            const state = element.getWorkspaceSnapshot();
            element.replaceWorkspaceState({
              ...state, activity: "docked", command: evidence === "starting" ? "starting" : "idle",
              fullMap, coherence: "verifying",
              resources: { ...state.resources, entry: {
                ...state.resources.entry, runnerLocked: evidence === "runnerLocked",
                activePlan: evidence === "activePlan", nativeSessionActive: evidence === "nativeSessionActive",
              } },
            });
          }, { tag: GALLERY_TAG, evidence, fullMap });
          const stop = gallery.getByRole("button", { name: "Stop cleaning", exact: true });
          await expect(stop).toBeVisible();
          await expect(stop).not.toHaveAttribute("aria-disabled", "true");
        }
      }
    });
  }
  for (const startRejects of [false, true]) {
    for (const stopRejects of [false, true]) {
      test(`stops an unresolved start and preserves the ${stopRejects ? "failed" : "accepted"} Stop after a late ${startRejects ? "rejection" : "acknowledgement"}`, async ({ page }) => {
        await loadEffectHarness(page);
        const result = await page.evaluate(async ({ startRejects, stopRejects }) => {
          const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
          const initial = { ...createGalleryState("ready"), workflow: "plan" };
          const store = new WorkspaceStore(initial);
          const calls = [];
          let completeStart;
          const effects = new EffectController(store, {
            catalog: async () => [initial.resources.entry],
            history: async () => initial.resources.history.value,
            scene: async () => { throw new DOMException("Aborted", "AbortError"); },
            pose: async () => { throw new DOMException("Aborted", "AbortError"); },
            plans: async () => initial.resources.plans.value,
            service: async (domain, service) => {
              calls.push(`${domain}.${service}`);
              if (calls.length === 1) return new Promise((resolve, reject) => {
                completeStart = () => startRejects ? reject(new Error("Late start error")) : resolve();
              });
              if (stopRejects) throw new Error("Stop acknowledgement lost");
            },
            dispose() {},
          });
          effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
          try {
            await effects.refreshCatalog(true);
            const start = effects.executeAction("run-plan");
            for (let index = 0; index < 20 && !completeStart; index++) await new Promise((resolve) => setTimeout(resolve, 0));
            const whileStarting = store.value.command;
            await effects.executeAction("run-plan");
            await effects.executeAction("stop");
            const afterStop = { command: store.value.command, notice: store.value.notice };
            completeStart();
            await start;
            return { calls, whileStarting, preserved: JSON.stringify(afterStop) === JSON.stringify({ command: store.value.command, notice: store.value.notice }), command: store.value.command };
          } finally { effects.dispose(); }
        }, { startRejects, stopRejects });
        expect(result).toEqual({ calls: ["matic_robot.run_selected_plan", "matic_robot.stop_intelligent_cleaning"], whileStarting: "starting", preserved: true, command: stopRejects ? "failed" : "settling" });
      });
    }
  }
  for (const rejected of [false, true]) {
    for (const managed of [false, true]) {
      test(`allows ${managed ? "managed" : "direct"} Stop after a ${rejected ? "rejected" : "successful"} start acknowledgement without replaying Start`, async ({ page }) => {
        await loadEffectHarness(page);
        const result = await page.evaluate(async ({ managed, rejected }) => {
          const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
          const initial = createGalleryState("ready");
          const store = new WorkspaceStore({ ...initial, selection: { ...initial.selection, areaId: "entryway" } });
          const calls = [];
          const effects = new EffectController(store, {
            catalog: async () => [initial.resources.entry],
            history: async () => initial.resources.history.value,
            scene: async () => { throw new DOMException("Aborted", "AbortError"); },
            pose: async () => { throw new DOMException("Aborted", "AbortError"); },
            plans: async () => initial.resources.plans.value,
            service: async (domain, service) => {
              calls.push(`${domain}.${service}`);
              if (rejected && calls.length === 1) throw new Error("Acknowledgement lost");
            },
            dispose() {},
          });
          const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
          effects.sync(projection);
          try {
            await effects.refreshCatalog(true);
            await effects.executeAction("run-area");
            const failed = store.value.command;
            effects.sync({ ...projection, activity: "cleaning" });
            store.patch({ resources: { ...store.value.resources, entry: { ...store.value.resources.entry, activePlan: managed, runnerLocked: managed } } });
            await effects.executeAction("run-area");
            const host = store.value.host;
            for (const key of ["connected", "administrator", "robotConnected"]) {
              store.patch({ host: { ...host, [key]: false } });
              await effects.executeAction("stop");
            }
            store.patch({ host });
            await effects.executeAction("stop");
            await effects.executeAction("stop");
            return { failed, calls, command: store.value.command };
          } finally { effects.dispose(); }
        }, { managed, rejected });
        expect(result).toEqual({ failed: rejected ? "failed" : "starting", calls: ["matic_robot.clean_area", "matic_robot.stop_intelligent_cleaning"], command: "settling" });
      });
    }
  }
  test("ignores an old start response, including a late coverage guard, after changing robots or closing the panel @safety", async ({ page }) => {
    await loadEffectHarness(page);
    const results = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const results = [];
      for (const close of [false, true]) {
        for (const rejectLate of [false, true]) {
          const initial = { ...createGalleryState("ready"), workflow: "plan" };
          const store = new WorkspaceStore(initial);
          const calls = [];
          let completeStart;
          let switched = false;
          const effects = new EffectController(store, {
            catalog: async () => switched ? new Promise(() => {}) : [initial.resources.entry],
            history: async () => initial.resources.history.value,
            scene: async () => { throw new DOMException("Aborted", "AbortError"); },
            pose: async () => { throw new DOMException("Aborted", "AbortError"); },
            plans: async () => initial.resources.plans.value,
            service: (domain, service, data, entity) => {
              calls.push([service, entity]);
              if (service !== "run_selected_plan") return Promise.resolve();
              return new Promise((resolve, reject) => {
              completeStart = () => rejectLate
                ? reject(Object.assign(new Error("late guard"), { translation_domain: "matic_robot", translation_key: "coverage_identity_changed" }))
                : resolve();
              });
            },
            dispose() {},
          });
          const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
          effects.sync(projection);
          await effects.refreshCatalog(true);
          const start = effects.executeAction("run-plan");
          for (let index = 0; index < 20 && !completeStart; index++) await new Promise((resolve) => setTimeout(resolve, 0));
          if (!completeStart) throw new Error("The initial managed start was not dispatched");
          if (close) effects.dispose();
          else {
            switched = true;
            effects.sync({ ...projection, entryKey: "other", vacuumEntityId: "vacuum.other", activity: "cleaning" });
            // Stop uses B's own projected activity and entity before its catalog
            // arrives. A's late start result must not overwrite that command.
            await effects.executeAction("stop");
            if (store.value.command !== "settling") throw new Error("B's acknowledged Stop was not pending settlement");
          }
          const current = () => JSON.stringify({
            command: store.value.command,
            notice: store.value.notice,
            selection: store.value.selection,
          });
          const before = current();
          completeStart();
          await start;
          results.push({ calls, preserved: current() === before });
          effects.dispose();
        }
      }
      return results;
    });
    expect(results).toEqual([false, true].flatMap((close) => Array.from({ length: 2 }, () => ({
      calls: [["run_selected_plan", "vacuum.synthetic"],
        ...(!close ? [["stop_intelligent_cleaning", "vacuum.other"]] : [])],
      preserved: true,
    }))));
  });
  // Home Assistant's service error carries the integration's translation key;
  // The catalog write helper maps a Matic coverage guard key to its notice and treats any
  // other error, whatever its text or domain, as an unconfirmed action.
  test("maps Matic coverage guard rejections to their notices and keeps other service errors generic", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const rejection = (domain, key) => Object.assign(new Error("secret untrusted service text"), {
        translation_domain: domain, translation_key: key,
      });
      const notices = [];
      for (const error of [
        rejection("matic_robot", "coverage_identity_unavailable"),
        rejection("matic_robot", "coverage_activity_unavailable"),
        rejection("matic_robot", "coverage_native_session_active"),
        rejection("matic_robot", "coverage_identity_changed"),
        rejection("other_domain", "coverage_identity_unavailable"),
        rejection("matic_robot", "toString"),
        new Error("secret untrusted service text"),
      ]) {
        const initial = { ...createGalleryState("ready"), workflow: "plan" };
        const store = new WorkspaceStore(initial);
        const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
        const backend = {
          catalog: async () => [initial.resources.entry],
          history: async () => initial.resources.history.value,
          scene: aborted,
          pose: aborted,
          plans: async () => initial.resources.plans.value,
          service: async () => { throw error; },
          dispose() {},
        };
        const effects = new EffectController(store, backend);
        effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
        // The preflight reads the plans fresh, which needs a current map.
        await effects.refreshCatalog(true);
        await effects.executeAction("run-plan");
        notices.push(store.value.notice?.key);
        effects.dispose();
      }
      return notices;
    });
    expect(result, "notice keys for each service rejection").toEqual([
      "v4_notice_coverage_task_unknown",
      "v4_notice_coverage_activity_unknown",
      "v4_notice_coverage_robot_busy",
      "v4_notice_coverage_task_changed",
      "v4_notice_action_unconfirmed",
      "v4_notice_action_unconfirmed",
      "v4_notice_action_unconfirmed",
    ]);
  });
  test("ends Starting when a managed service returns at the end of its run", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = { ...createGalleryState("ready"), workflow: "plan" };
      const store = new WorkspaceStore(initial);
      const calls = [];
      let finish;
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry],
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        previewRoomSequence: async (_entityId, rooms) => ({
          entryId: initial.selection.entryId, floorToken: "f".repeat(64), previewToken: "b".repeat(64),
          rooms: rooms.map((room) => ({ roomId: room.room, name: room.room === "room-a" ? "Kitchen" : room.room,
            cleaningMode: room.cleaning_mode, coverageSetting: room.coverage_setting, cadenceReasons: [] })),
          missionBoundaries: [], blocker: null,
        }),
        service: async (domain, service) => {
          calls.push(service);
          await new Promise((resolve) => { finish = resolve; });
        },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      // The preflight reads the plans fresh, which needs a current map.
      await effects.refreshCatalog(true);
      const phases = [];
      try {
        for (const action of ["run-plan", "clean-rooms"]) {
          finish = undefined;
          const room = initial.resources.plans.value.rooms[0];
          store.patch({ workflow: action === "run-plan" ? "plan" : "rooms", selection: {
            ...store.value.selection,
            roomIds: action === "clean-rooms" ? [room.roomId] : store.value.selection.roomIds,
            roomSettings: [{ roomId: room.roomId, cleaningMode: "vacuum", coverageSetting: "quick" }],
          } });
          for (let index = 0; action === "clean-rooms" && index < 20 && store.value.manualRoomPreview.status !== "ready"; index++) await new Promise((resolve) => setTimeout(resolve, 0));
          const run = effects.executeAction(action);
          if (action === "run-plan") {
            for (let index = 0; index < 20 && !finish; index++) await new Promise((resolve) => setTimeout(resolve, 0));
          } else {
            for (let index = 0; index < 20 && !finish; index++) await new Promise((resolve) => setTimeout(resolve, 0));
          }
          phases.push(store.value.command);
          finish();
          await run;
          phases.push(store.value.command);
        }
        return { calls, phases };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ calls: ["run_selected_plan", "clean_room_sequence"], phases: ["starting", "idle", "starting", "idle"] });
  });
  test("sends default shared scheduling and explicit settings overrides with room-sequence requests", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState, withGalleryRoomPreview } = await import("/plan-recovery-test.js");
      const base = createGalleryState("ready");
      const initial = withGalleryRoomPreview({ ...base, workflow: "rooms", selection: {
        ...base.selection, roomIds: ["room-a"],
        roomSettings: [{ roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "quick" }],
      } });
      const store = new WorkspaceStore(initial);
      const calls = [];
      const effects = new EffectController(store, {
        catalog: async () => new Promise(() => {}),
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        previewRoomSequence: async (_entityId, rooms) => ({
          entryId: initial.selection.entryId, floorToken: "f".repeat(64), previewToken: "b".repeat(64),
          rooms: rooms.map((room) => ({ roomId: room.room, name: room.room === "room-a" ? "Kitchen" : room.room,
            cleaningMode: room.cleaning_mode, coverageSetting: room.coverage_setting, cadenceReasons: [] })),
          missionBoundaries: [], blocker: null,
        }),
        service: async (...args) => { calls.push(args); },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      try {
        for (let i = 0; i < 20 && store.value.manualRoomPreview.status !== "ready"; i++) await new Promise(resolve => setTimeout(resolve, 0));
        await effects.executeAction("clean-rooms");
        store.patch({ selection: { ...store.value.selection, useRoomSchedule: false } });
        for (let i = 0; i < 20 && store.value.manualRoomPreview.status !== "ready"; i++) await new Promise(resolve => setTimeout(resolve, 0));
        await effects.executeAction("clean-rooms");
        return calls;
      } finally { effects.dispose(); }
    });
    expect(result).toHaveLength(2);
    for (const [domain, service, data] of result) {
      expect(domain).toBe("matic_robot");
      expect(service).toBe("clean_room_sequence");
      expect(data.rooms).toEqual([{ room: "room-a", cleaning_mode: "vacuum", coverage_setting: "quick" }]);
      expect(data.use_room_schedule).toBe(true);
    }
    expect(result[0][2].override_room_schedule).toBe(false);
    expect(result[1][2].override_room_schedule).toBe(true);
  });
  test("resumes a paused managed task with the resume-only command", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("paused");
      const store = new WorkspaceStore({ ...initial, managedLock: true });
      const calls = [];
      const effects = new EffectController(store, {
        catalog: async () => [{ ...initial.resources.entry, runnerLocked: true, activePlan: true }],
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        service: async (...args) => { calls.push(args); },
        dispose() {},
      });
      const projection = { host: initial.host, activity: "paused", batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
      effects.sync(projection);
      try {
        await effects.refreshCatalog(true);
        const ready = store.value;
        for (const blocked of [
          { ...ready, activity: "docked" },
          { ...ready, coherence: "verifying" },
          { ...ready, dataMode: "history" },
          { ...ready, resources: { ...ready.resources, entry: { ...ready.resources.entry, stopSettlePending: true } } },
        ]) {
          store.replace(blocked);
          await effects.executeAction("resume");
        }
        store.replace(ready);
        await effects.executeAction("resume");
        await effects.executeAction("resume");
        return { calls, command: store.value.command };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ calls: [["vacuum", "send_command", { command: "resume" }, "vacuum.synthetic"]], command: "starting" });
  });
  test("clears a deleted dirty plan identity only after successful deletion", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      let reject = true;
      let deleted = false;
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry],
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => deleted ? { ...initial.resources.plans.value, selectedPlan: null, plans: [] } : initial.resources.plans.value,
        service: async () => { if (reject) throw new Error("Offline"); deleted = true; },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      try {
        await effects.refreshCatalog(true);
        store.patch({ planDraft: { ...store.value.planDraft, name: "Keep on failure", dirty: true } });
        await effects.deletePlan();
        const failed = { id: store.value.planDraft.id, dirty: store.value.planDraft.dirty, name: store.value.planDraft.name };
        reject = false;
        await effects.deletePlan();
        const deletedDraft = { selected: store.value.selection.planId, id: store.value.planDraft.id, dirty: store.value.planDraft.dirty, name: store.value.planDraft.name };
        const deletionNotice = store.value.notice?.key;
        effects.selectPlan(null);
        const nextNotice = store.value.notice;
        return { failed, deletionNotice, nextNotice, deleted: deletedDraft };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ deletionNotice: "v4_notice_plan_deleted", nextNotice: null, failed: { id: "daily", dirty: true, name: "Keep on failure" }, deleted: { selected: null, id: null, dirty: false, name: "" } });
  });
  for (const pruned of ["snapshot", "floor", "all", "navigation"]) {
    test(`reconciles the scene and floor when history prunes the selected ${pruned}`, async ({ page }) => {
      await loadEffectHarness(page);
      const result = await page.evaluate(async ({ pruned }) => {
        const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
        const initial = createGalleryState("ready");
        initial.resources.entry = { ...initial.resources.entry, deltaUrl: null };
        const store = new WorkspaceStore(initial);
        let history = initial.resources.history.value;
        const effects = new EffectController(store, {
          catalog: async () => [initial.resources.entry],
          history: async () => history,
          scene: async (url, revision) => ({ scene: { ...initial.resources.scene.value, marker: url }, revision, floorCoherent: true }),
          pose: async () => { throw new DOMException("Aborted", "AbortError"); },
          plans: async () => initial.resources.plans.value,
          dispose() {},
        });
        effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
        try {
          await effects.refreshCatalog(true);
          await effects.selectFloor("saved-1");
          const staleMarker = store.value.resources.scene.value.marker;
          history = { ...history, floors: pruned === "all" ? [] : (pruned === "floor" || pruned === "navigation") ? history.floors.filter((floor) => floor.id !== "saved-1") : history.floors.map((floor) => floor.id !== "saved-1" ? floor : { ...floor, snapshots: [{ ...floor.snapshots[0], id: "replacement", sceneUrl: "/replacement-history", revision: 4 }] }) };
          const recovery = effects.openWorkflow("history");
          if (pruned === "navigation") {
            await Promise.resolve();
            store.dispatch({ type: "open-workflow", workflow: "support" });
          }
          await recovery;
          return { staleMarker, marker: store.value.resources.scene.value?.marker, floor: store.value.selection.floorId, snapshot: store.value.selection.historyId, dataMode: store.value.dataMode, readOnly: store.value.floor.readOnly, label: store.value.floor.displayName, workflow: store.value.workflow, liveUrl: initial.resources.entry.sceneUrl };
        } finally { effects.dispose(); }
      }, { pruned });
      expect(result.staleMarker).toBe("/synthetic-history-saved");
      expect(result.marker).toBe(pruned === "snapshot" ? "/replacement-history" : result.liveUrl);
      expect(result.floor).toBe(pruned === "snapshot" ? "saved-1" : "current");
      expect(result.snapshot).toBe(pruned === "snapshot" ? "replacement" : null);
      expect(result.dataMode).toBe(pruned === "snapshot" ? "history" : "live");
      expect(result.readOnly).toBe(pruned === "snapshot");
      expect(result.workflow).toBe(pruned === "navigation" ? "support" : "history");
      if (pruned !== "snapshot") expect(result.label).not.toBe("Shed");
    });
  }
  test("browser Back cancels draft confirmation without leaving the editor", async ({ page }) => {
    await loadEffectHarness(page);
    await page.evaluate(async () => {
      const { WorkspaceStore, LayerHistoryController, createGalleryState } = await import("/plan-recovery-test.js");
      const store = new WorkspaceStore(createGalleryState("ready"));
      const layers = new LayerHistoryController(store);
      layers.start();
      store.dispatch({ type: "open-workflow", workflow: "plan" });
      store.dispatch({ type: "patch-plan-draft", patch: { name: "Keep on Back" } });
      window.__draftNavigation = { store, layers };
      history.back();
    });
    await expect.poll(() => page.evaluate(() => window.__draftNavigation.store.value.dialog)).toBe("discardDraft");
    await page.evaluate(() => history.back());
    await expect.poll(() => page.evaluate(() => window.__draftNavigation.store.value.dialog)).toBe(null);
    expect(await page.evaluate(() => {
      const { store, layers } = window.__draftNavigation;
      layers.dispose();
      return { workflow: store.value.workflow, name: store.value.planDraft.name, dirty: store.value.planDraft.dirty };
    })).toEqual({ workflow: "plan", name: "Keep on Back", dirty: true });
  });
  test("keeps desktop plan actions visible while long forms scroll", async ({ page }) => {
    const gallery = await loadGallery(page);
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      // A room open with its settings makes the form long.
      element.replaceWorkspaceState({
        ...state, workflow: "plan", planView: "edit", expandedRoom: state.planDraft.rooms[0].roomId,
        planDraft: { ...state.planDraft, dirty: true },
      });
    }, GALLERY_TAG);
    const save = gallery.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeInViewport({ ratio: 1 });
    const body = gallery.locator(".workflow-body");
    // replaceWorkspaceState schedules the Lit render; wait for its expanded
    // room form to contribute overflow before asserting the body can scroll.
    await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight), {
      message: "the expanded plan form makes the workflow body scrollable",
    }).toBe(true);
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(gallery.getByText("When a run ends", { exact: true })).toBeInViewport();
  });

  test("a limited map while idle says so and offers one Try again that rechecks", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "map-limited" });
    await expect(gallery.locator(".status-copy strong")).toHaveText("Map limited");
    await expect(gallery.locator(".status-copy small")).toHaveText("Cleaning can't start");
    await expect(gallery.locator("#home-reason")).toContainText("Home Assistant can show this map but can't confirm it well enough to start cleaning.");
    // The cards stay, demoted (home-rooms.md §4 H8 layout).
    await expect(gallery.locator('.quick-actions .ms-row[aria-disabled="true"]')).toHaveCount(4);
    const retry = gallery.locator(".home-actions").getByRole("button", { name: "Try again", exact: true });
    await expect(retry).not.toHaveAttribute("aria-disabled", "true");
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      element.__actions = [];
      element.addEventListener("matic-workspace-action", (event) => element.__actions.push(event.detail));
    }, GALLERY_TAG);
    await retry.click();
    expect(await page.evaluate((tag) => document.querySelector(tag).__actions, GALLERY_TAG))
      .toEqual([{ id: "recheck-status" }]);

    // A catalog read the user did not ask for (sync, spatial recovery) changes nothing.
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        resources: { ...state.resources, catalog: { ...state.resources.catalog, status: "loading" } },
      });
    });
    await expect(gallery.locator(".status-copy small")).toHaveText("Cleaning can't start");
    await expect(retry).not.toHaveAttribute("aria-disabled", "true");

    // While the user's recheck runs the button stays, disabled, and the strip says so.
    await gallery.evaluate((element) => {
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), rechecking: true });
    });
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await expect(gallery.locator(".status-copy small")).toHaveText("Checking again");
    await retry.dispatchEvent("click");
    expect(await page.evaluate((tag) => document.querySelector(tag).__actions.length, GALLERY_TAG)).toBe(1);
  });

  test("distinguishes setup, robot problems and unavailable maps from localization", async ({ page }) => {
    // shell.md §2: these rows have no footer button; the strip says the state.
    const gallery = await loadGallery(page, { scenario: "empty" });
    await expect(gallery.locator(".status-copy strong")).toHaveText("No robot");
    await expect(gallery.locator(".action-bar")).not.toContainText("Check the integration");
    await page.evaluate((tag) => document.querySelector(tag).setScenario("problem"), GALLERY_TAG);
    await expect(gallery.locator(".status-copy strong")).toHaveText("Needs attention");
    // No footer button, so no footer at all (home-rooms.md §3: the bar is absent when idle).
    await expect(gallery.locator(".action-bar button")).toHaveCount(0);
    await page.evaluate((tag) => document.querySelector(tag).setScenario("unsupported"), GALLERY_TAG);
    await expect(gallery.locator(".action-bar button")).toHaveCount(0);
    await expect(gallery.locator(".status-copy strong")).toHaveText("Map unavailable");
    await expect(gallery.locator(".status-copy small")).toContainText("Home Assistant can't show the map right now, so cleaning can't start.");

    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, coherence: "unavailable", map: { ...state.map, available: false } });
    });
    await expect(gallery.locator(".status-copy strong")).toHaveText("Map unavailable");
    await expect(gallery.locator(".status-copy small")).toContainText("Home Assistant can't show the map right now, so cleaning can't start.");
    await expect(gallery.locator(".status-copy strong")).not.toHaveText("Locating");

    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, activity: "cleaning", coherence: "unavailable" });
    });
    await expect(gallery.locator(".status-copy strong")).toHaveText("Cleaning");
    await expect(gallery.locator(".status-copy small")).toHaveText("Live map unavailable");
    await expect(gallery.getByRole("button", { name: "Stop cleaning", exact: true }).first()).toBeEnabled();
  });
  for (const retained of [false, true]) {
    test(`keeps a ${retained ? "retained" : "saved"} map visible during live revalidation`, async ({ page }) => {
      await loadEffectHarness(page);
      const result = await page.evaluate(async (retained) => {
        const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
        const initial = createGalleryState("ready");
        const store = new WorkspaceStore({ ...initial, workflow: "rooms", selection: {
          ...initial.selection,
          areaId: "entryway",
          roomIds: ["room-a"],
          roomSettings: [{ roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "standard" }],
        } });
        if (!retained) store.patch({ resources: { ...initial.resources, scene: { status: "idle", value: null, problem: null } } });
        let entry = { ...initial.resources.entry, mapFloorCoherent: false, mapSessionVerified: false, mapSessionKey: null, deltaUrl: null };
        let commands = 0;
        const effects = new EffectController(store, {
          catalog: async () => [entry],
          history: async () => initial.resources.history.value,
          scene: async (_url, revision, floorCoherent, mode) => ({ revision, floorCoherent, scene: { ...initial.resources.scene.value, marker: mode } }),
          pose: async () => { throw new DOMException("Aborted", "AbortError"); },
          plans: async () => initial.resources.plans.value,
          areas: async () => initial.resources.areas.value,
          previewRoomSequence: async (_entityId, rooms) => ({
            entryId: initial.selection.entryId,
            floorToken: "f".repeat(64),
            previewToken: "b".repeat(64),
            rooms: rooms.map((room) => ({
              roomId: room.room,
              name: room.room === "room-a" ? "Kitchen" : room.room,
              cleaningMode: room.cleaning_mode,
              coverageSetting: room.coverage_setting,
              cadenceReasons: [],
            })),
            missionBoundaries: [],
            blocker: null,
          }),
          service: async () => { commands++; },
          dispose() {},
        });
        try {
          effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
          await effects.refreshCatalog(true);
          for (let i = 0; i < 20 && !store.value.map.available; i++) await new Promise((resolve) => setTimeout(resolve, 0));
          await effects.refreshCatalog();
          for (const action of ["clean-rooms", "run-plan", "run-area"]) await effects.executeAction(action);
          window.__pausedMapState = store.value;
          const paused = { available: store.value.map.available, exactPose: store.value.map.exactPose, scene: !!store.value.resources.scene.value, notice: store.value.notice?.key ?? null, commands };
          entry = { ...initial.resources.entry, deltaUrl: null };
          await effects.refreshCatalog();
          for (let i = 0; i < 20 && store.value.resources.scene.value?.marker !== "live"; i++) await new Promise((resolve) => setTimeout(resolve, 0));
          for (let i = 0; i < 100 && store.value.manualRoomPreview.status !== "ready"; i++) await new Promise((resolve) => setTimeout(resolve, 0));
          await effects.executeAction("clean-rooms");
          return { paused, commands, recovered: { available: store.value.map.available, readOnly: store.value.floor.readOnly, marker: store.value.resources.scene.value?.marker } };
        } finally { effects.dispose(); }
      }, retained);
      expect(result.paused).toMatchObject({ available: true, exactPose: false, scene: true, commands: 0 });
      expect(result.paused.notice).toBe(retained ? null : "v4_notice_saved_map");
      expect(result.commands).toBe(1);
      expect(result.recovered).toEqual({ available: true, readOnly: false, marker: "live" });
      await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
      await page.evaluate(async (tag) => {
        await customElements.whenDefined(tag);
        const gallery = document.createElement(tag);
        gallery.controls = false;
        gallery.scenario = "ready";
        document.body.append(gallery);
        await gallery.updateComplete;
        gallery.replaceWorkspaceState(window.__pausedMapState);
      }, GALLERY_TAG);
      await expect(page.locator(GALLERY_TAG).locator(".scene-window")).toBeVisible();
      // The status strip carries locating; the saved-map branch also has its dated notice.
      const visibleGallery = page.locator(GALLERY_TAG);
      await expect(visibleGallery.locator(".map-message")).toHaveCount(0);
      await expect(visibleGallery.locator(".status-copy strong")).toHaveText("Locating");
      if (!retained) {
        await expect(visibleGallery.locator("[data-notice-slot]")).toContainText("Showing the saved map from");
        await expect(visibleGallery.locator(".root > .sr-only[aria-live=polite]")).toContainText("Showing the saved map from");
      } else {
        await expect(visibleGallery.locator(".root > .sr-only[aria-live=polite]")).toContainText("Locating");
      }
      await expect(visibleGallery.locator("matic-map-canvas-v4 .scene-window")).toHaveAttribute("aria-label", /Saved read-only map/);

    });
  }

  test("retains the map when delta revalidation cannot refresh the catalog", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore({ ...initial, selection: { ...initial.selection,
        roomSettings: [{ roomId: "room-1", cleaningMode: "vacuum", coverageSetting: "standard" }] } });
      const entry = { ...initial.resources.entry, deltaUrl: "/api/matic_robot/synthetic/delta" };
      let rejectCatalog = false, releaseDelta, commands = 0;
      const effects = new EffectController(store, {
        catalog: async () => { if (rejectCatalog) throw new Error("Catalog offline"); return [entry]; },
        history: async () => initial.resources.history.value,
        scene: async () => ({ revision: entry.mapRevision, floorCoherent: true, scene: initial.resources.scene.value }),
        sceneDelta: async () => new Promise(resolve => { releaseDelta = () => resolve({ revision: entry.mapRevision, floorCoherent: false, scene: null, notModified: true }); }),
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        areas: async () => initial.resources.areas.value,
        service: async () => { commands++; },
        dispose() {},
      });
      try {
        effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
        await effects.refreshCatalog(true);
        for (let i = 0; i < 20 && !releaseDelta; i++) await new Promise(resolve => setTimeout(resolve, 0));
        if (!releaseDelta) throw new Error("Delta stream did not start");
        rejectCatalog = true;
        releaseDelta();
        for (let i = 0; i < 20 && store.value.resources.catalog.status !== "error"; i++) await new Promise(resolve => setTimeout(resolve, 0));
        await effects.executeAction("clean-rooms");
        window.__deltaRecheckState = store.value;
        return { retained: store.value.resources.scene.value === initial.resources.scene.value,
          available: store.value.map.available, readOnly: store.value.floor.readOnly,
          exactPose: store.value.map.exactPose, catalog: store.value.resources.catalog.status, commands,
          notice: store.value.notice };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ retained: true, available: true, readOnly: true, exactPose: false, catalog: "error", commands: 0, notice: null });
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
    await page.evaluate(async tag => {
      await customElements.whenDefined(tag);
      const gallery = document.createElement(tag);
      gallery.controls = false; gallery.scenario = "ready";
      document.body.append(gallery); await gallery.updateComplete;
      gallery.replaceWorkspaceState(window.__deltaRecheckState);
    }, GALLERY_TAG);
    await expect(page.locator(GALLERY_TAG).locator(".scene-window")).toBeVisible();
    // The catalog failure leaves coherence degraded, so the workspace, not a
    // notice, says the map is limited; the row has no footer button (shell.md §2).
    await expect(page.locator(GALLERY_TAG).getByRole("heading", { name: "Saved map is read only" })).toBeVisible();
    await expect(page.locator(GALLERY_TAG).locator(".status-copy strong")).toHaveText("Map limited");
    await expect(page.locator(GALLERY_TAG).getByRole("button", { name: "Finding the map" })).toHaveCount(0);
  });

  test("returning to live keeps the saved map if the catalog is unavailable", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("history");
      const store = new WorkspaceStore(initial);
      const effects = new EffectController(store, {
        catalog: async () => { throw new Error("Catalog offline"); }, dispose() {},
      });
      try {
        effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
        await effects.selectFloor("current");
        return { retained: store.value.resources.scene.value === initial.resources.scene.value,
          labelRetained: store.value.floor.displayName === initial.floor.displayName,
          available: store.value.map.available, readOnly: store.value.floor.readOnly,
          exactPose: store.value.map.exactPose, catalog: store.value.resources.catalog.status,
          floor: store.value.selection.floorId, mode: store.value.dataMode };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ retained: true, labelRetained: true, available: true,
      readOnly: true, exactPose: false, catalog: "error", floor: "current", mode: "live" });
  });

  for (const scenario of ["unreadable-newest", "late-history", "transient-all", "live-unavailable"]) {
    test(`saved-map fallback handles ${scenario}`, async ({ page }) => {
      await loadEffectHarness(page);
      const result = await page.evaluate(async (scenario) => {
        const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
        const initial = createGalleryState("ready");
        const store = new WorkspaceStore({ ...initial, map: { ...initial.map, available: false }, resources: { ...initial.resources, scene: { status: "idle", value: null, problem: null } } });
        let entry = { ...initial.resources.entry, mapFloorCoherent: scenario === "live-unavailable", mapSessionVerified: scenario === "live-unavailable", deltaUrl: null };
        let historyReads = 0;
        let liveOffline = scenario === "live-unavailable";
        let offline = scenario === "transient-all";
        const history = initial.resources.history.value;
        const historyReleases = [];
        const effects = new EffectController(store, {
          catalog: async () => [entry],
          history: async () => scenario === "transient-all"
            ? { ...history, floors: [{ ...history.floors[0], snapshots: history.floors[0].snapshots.slice(0, 1) }] }
            : history,
          scene: async (_url, revision, floorCoherent, mode) => {
            if (mode === "live" && liveOffline) throw new Error("Live scene temporarily offline");
            if (mode === "history") {
              historyReads++;
              if (offline) throw new Error("Snapshot endpoint temporarily offline");
              if (scenario === "unreadable-newest" && historyReads === 1) throw new Error("Missing snapshot");
              if (scenario === "late-history") await new Promise((resolve) => { historyReleases.push(resolve); });
            }
            return { revision, floorCoherent, scene: { ...initial.resources.scene.value, marker: mode } };
          },
          pose: async () => { throw new DOMException("Aborted", "AbortError"); },
          plans: async () => initial.resources.plans.value, areas: async () => initial.resources.areas.value,
          dispose() {},
        });
        try {
          effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId });
          await effects.refreshCatalog(true);
          for (let i = 0; i < 20 && !(scenario === "late-history" ? historyReleases.length > 0 : store.value.map.available); i++) await new Promise((resolve) => setTimeout(resolve, 0));
          if (scenario === "live-unavailable") {
            if (!store.value.map.available || !store.value.floor.readOnly || store.value.resources.scene.value?.marker !== "history") throw new Error("Expected a saved map while live scene was unavailable");
            liveOffline = false;
            await new Promise(resolve => setTimeout(resolve, 0));
            await effects.refreshCatalog();
            for (let i = 0; i < 20 && store.value.resources.scene.value?.marker !== "live"; i++) await new Promise(resolve => setTimeout(resolve, 0));
          }
          if (scenario === "transient-all") {
            if (store.value.map.available || historyReads !== 1) throw new Error("Expected one failed snapshot read");
            offline = false;
            await effects.refreshCatalog();
            for (let i = 0; i < 20 && !store.value.map.available; i++) await new Promise(resolve => setTimeout(resolve, 0));
          }
          if (scenario === "late-history") {
            entry = { ...initial.resources.entry, deltaUrl: null };
            await effects.refreshCatalog();
            for (const release of historyReleases) release();
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          return { historyReads, available: store.value.map.available, marker: store.value.resources.scene.value?.marker, readOnly: store.value.floor.readOnly };
        } finally { effects.dispose(); }
      }, scenario);
      expect(result).toEqual(scenario === "late-history" || scenario === "live-unavailable"
        ? { historyReads: scenario === "late-history" ? 2 : 1, available: true, marker: "live", readOnly: false }
        : { historyReads: 2, available: true, marker: "history", readOnly: true });
    });
  }

  for (const outcome of ["success", "error"]) {
    test(`@safety disconnect fences an in-flight pose ${outcome} before cancellation`, async ({ page }) => {
      await loadEffectHarness(page);
      const result = await page.evaluate(async (outcome) => {
        const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
        const initial = createGalleryState("ready");
        const store = new WorkspaceStore(initial);
        let finish;
        let hold = false;
        let abortedGeneration;
        const effects = new EffectController(store, {
          catalog: async () => [{ ...initial.resources.entry, deltaUrl: null }],
          history: async () => initial.resources.history.value,
          scene: async (_url, revision) => ({ scene: initial.resources.scene.value, revision, floorCoherent: true }),
          pose: async (_url, signal) => {
            if (!hold) return initial.resources.pose.value;
            signal.addEventListener("abort", () => { abortedGeneration = store.value.generation; }, { once: true });
            // A transport can settle after abort; admission must still reject it.
            return new Promise((resolve, reject) => {
              finish = () => outcome === "success"
                ? resolve(initial.resources.pose.value) : reject(new Error("Late transport failure"));
            });
          },
          dispose() {},
        });
        const projection = {
          host: initial.host, activity: initial.activity, batteryPercent: 92,
          robotLabel: "Synthetic", robots: initial.robots, language: "en",
          userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
        };
        try {
          effects.sync(projection);
          await effects.refreshCatalog(true);
          await effects.refreshPose();
          const connectedGeneration = store.value.generation;
          const retainedScene = store.value.resources.scene.value;
          hold = true;
          const pending = effects.refreshPose();
          effects.sync({ ...projection, host: { ...projection.host, connected: false } });
          const disconnectedGeneration = store.value.generation;
          finish();
          await pending;
          const disconnected = {
            pose: store.value.resources.pose, exactPose: store.value.map.exactPose,
            coherence: store.value.coherence, retainedScene: store.value.resources.scene.value === retainedScene,
          };
          effects.sync({ ...projection, host: { ...projection.host, connected: false } });
          const repeatedDisconnectGeneration = store.value.generation;
          hold = false;
          effects.sync(projection);
          await effects.refreshCatalog(true);
          await effects.refreshPose();
          return {
            connectedGeneration, disconnectedGeneration, abortedGeneration, repeatedDisconnectGeneration,
            disconnected, recovered: store.value.map.exactPose && store.value.coherence === "current",
          };
        } finally { effects.dispose(); }
      }, outcome);
      expect(result.disconnectedGeneration).toBeGreaterThan(result.connectedGeneration);
      expect(result.abortedGeneration).toBe(result.disconnectedGeneration);
      expect(result.repeatedDisconnectGeneration).toBe(result.disconnectedGeneration);
      expect(result.disconnected).toEqual({
        pose: { status: "idle", value: null, problem: null }, exactPose: false,
        coherence: "degraded", retainedScene: true,
      });
      expect(result.recovered).toBe(true);
    });
  }

  for (const force of [false, true]) {
    for (const outcome of ["success", "error"]) {
      test(`@safety reconnect supersedes a ${force ? "forced" : "polling"} catalog ${outcome} without waiting for polling`, async ({ page }) => {
        await loadEffectHarness(page);
        const result = await page.evaluate(async ({ force, outcome }) => {
          const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
          const initial = createGalleryState("ready");
          const store = new WorkspaceStore(initial);
          const entry = { ...initial.resources.entry, deltaUrl: null };
          let reads = 0;
          let finish;
          const problems = [];
          const unsubscribe = store.subscribe((state) => {
            if (state.resources.catalog.problem) problems.push(state.resources.catalog.problem);
          });
          const effects = new EffectController(store, {
            catalog: async () => {
              if (++reads !== 2) return [entry];
              return new Promise((resolve, reject) => {
                finish = () => outcome === "success"
                  ? resolve([entry]) : reject(new Error("Obsolete connection failed"));
              });
            },
            history: async () => initial.resources.history.value,
            scene: async (_url, revision) => ({ scene: initial.resources.scene.value, revision, floorCoherent: true }),
            pose: async () => initial.resources.pose.value,
            dispose() {},
          });
          const projection = {
            host: initial.host, activity: initial.activity, batteryPercent: 92,
            robotLabel: "Synthetic", robots: initial.robots, language: "en",
            userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
          };
          try {
            effects.sync(projection);
            await effects.refreshCatalog(true);
            const pending = effects.refreshCatalog(force);
            effects.sync({ ...projection, host: { ...projection.host, connected: false } });
            effects.sync(projection);
            finish();
            await pending;
            return { reads, problems, status: store.value.resources.catalog.status, coherence: store.value.coherence };
          } finally { unsubscribe(); effects.dispose(); }
        }, { force, outcome });
        expect(result).toEqual({ reads: 3, problems: [], status: "ready", coherence: "current" });
      });
    }
  }

  test("robot reconnect rejects pending catalog proof until a fresh read completes", async ({ page }) => {
    await loadEffectHarness(page);
    await page.evaluate(async () => {
      const m = await import("/plan-recovery-test.js");
      const initial = m.createGalleryState("ready");
      const entry = { ...initial.resources.entry, deltaUrl: null };
      const store = new m.WorkspaceStore(initial);
      const pending = [];
      const recovery = window.__robotReconnectProof = { store, reads: 0, pending: null, releaseStale: null, releaseFresh: null, module: m };
      const effects = recovery.effects = new m.EffectController(store, {
        catalog: async (signal) => {
          recovery.reads += 1;
          if (recovery.reads === 1) return [entry];
          return new Promise((resolve) => {
            const release = () => resolve([entry]);
            pending.push({ signal, release });
            if (recovery.reads === 2) recovery.releaseStale = release;
            if (recovery.reads === 3) recovery.releaseFresh = release;
          });
        },
        history: async () => initial.resources.history.value,
        scene: async (_url, revision) => ({ scene: initial.resources.scene.value, revision, floorCoherent: true }),
        pose: async () => initial.resources.pose.value,
        plans: async () => initial.resources.plans.value,
        dispose() {},
      });
      const projection = {
        host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en",
        userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
      };
      recovery.projection = projection;
      effects.sync(projection);
      await effects.refreshCatalog(true);
      recovery.pending = effects.refreshCatalog(true);
      effects.sync({ ...projection, host: { ...projection.host, robotConnected: false } });
      recovery.disconnected = {
        generation: store.value.generation,
        coherence: store.value.coherence,
        canEdit: m.canEditCoordinates(store.value),
        canRead: m.canReadFloorResources(store.value),
        staleAborted: pending[0].signal.aborted,
      };
      effects.sync(projection);
      recovery.reconnectedBeforeProof = {
        generation: store.value.generation,
        coherence: store.value.coherence,
        canEdit: m.canEditCoordinates(store.value),
        canRead: m.canReadFloorResources(store.value),
      };
      recovery.releaseStale();
    });
    await expect.poll(() => page.evaluate(() => window.__robotReconnectProof.reads)).toBe(3);
    const beforeFreshProof = await page.evaluate(() => {
      const r = window.__robotReconnectProof;
      return {
        state: r.reconnectedBeforeProof,
        reads: r.reads,
        staleAborted: r.disconnected.staleAborted,
        freshPending: typeof r.releaseFresh === "function",
        coherence: r.store.value.coherence,
        canEdit: r.module.canEditCoordinates(r.store.value),
      };
    });
    expect(beforeFreshProof).toMatchObject({
      state: { coherence: "degraded", canEdit: false, canRead: false },
      reads: 3, staleAborted: true, freshPending: true,
      coherence: "degraded", canEdit: false,
    });
    await page.evaluate(() => window.__robotReconnectProof.releaseFresh());
    await expect.poll(() => page.evaluate(() => {
      const r = window.__robotReconnectProof;
      return { coherence: r.store.value.coherence, canEdit: r.store.value.coherence === "current" };
    })).toEqual({ coherence: "current", canEdit: true });
    await page.evaluate(async () => {
      const r = window.__robotReconnectProof;
      await r.pending;
      r.effects.dispose();
    });
  });

  test("combined HA and robot reconnect clears the offline notice while re-proving", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const m = await import("/plan-recovery-test.js");
      const initial = m.createGalleryState("ready");
      const entry = { ...initial.resources.entry, deltaUrl: null };
      const store = new m.WorkspaceStore(initial);
      let reads = 0;
      const effects = new m.EffectController(store, {
        catalog: async () => { reads += 1; return [entry]; },
        history: async () => initial.resources.history.value,
        scene: async (_url, revision) => ({ scene: initial.resources.scene.value, revision, floorCoherent: true }),
        pose: async () => initial.resources.pose.value,
        plans: async () => initial.resources.plans.value,
        dispose() {},
      });
      const projection = {
        host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en",
        userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
      };
      effects.sync(projection);
      await effects.refreshCatalog(true);
      effects.sync({ ...projection, host: { ...projection.host, connected: false, robotConnected: false } });
      effects.sync(projection);
      const pending = { notice: store.value.notice?.key ?? null, reads };
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const recovered = { notice: store.value.notice?.key ?? null, reads, coherence: store.value.coherence };
      effects.dispose();
      return { pending, recovered };
    });
    expect(result.pending.notice).toBeNull();
    expect(result.recovered).toMatchObject({ notice: null, coherence: "current" });
    expect(result.recovered.reads).toBeGreaterThanOrEqual(2);
  });

  test("active delta loop owns pixel admission across 204 gaps and catalog revisions", async ({ page }) => {
    await loadEffectHarness(page);
    await page.evaluate(async () => {
      const m = await import("/plan-recovery-test.js");
      const initial = m.createGalleryState("ready");
      const state = window.__deltaCatalogRace = {
        entry: { ...initial.resources.entry, deltaUrl: "/delta" },
        sceneCalls: 0,
        deltaCalls: 0,
        release204: null,
        releaseDelta: null,
      };
      const store = state.store = new m.WorkspaceStore(initial);
      const effects = state.effects = new m.EffectController(store, {
        catalog: async () => [state.entry],
        history: async () => initial.resources.history.value,
        scene: async (_url, revision) => {
          state.sceneCalls += 1;
          return { scene: initial.resources.scene.value, revision, floorCoherent: true };
        },
        sceneDelta: async (_url, _scene, _floorCoherent, signal) => {
          const call = ++state.deltaCalls;
          if (call === 1) return new Promise((resolve) => {
            state.release204 = () => resolve({ revision: state.entry.mapRevision, floorCoherent: true, scene: null, notModified: true });
          });
          if (call === 2) return new Promise((resolve) => {
            state.releaseDelta = () => resolve({ revision: state.entry.mapRevision, floorCoherent: true, scene: initial.resources.scene.value });
          });
          return new Promise((_resolve, reject) => {
            const abort = () => reject(new DOMException("Aborted", "AbortError"));
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
        },
        pose: async () => initial.resources.pose.value,
        plans: async () => initial.resources.plans.value,
        dispose() {},
      });
      const projection = {
        host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en",
        userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
      };
      effects.sync(projection);
      await effects.refreshCatalog(true);
    });
    await expect.poll(() => page.evaluate(() => window.__deltaCatalogRace.deltaCalls)).toBe(1);
    await page.evaluate(() => window.__deltaCatalogRace.release204());
    await expect.poll(() => page.evaluate(() => window.__deltaCatalogRace.deltaCalls)).toBe(2);

    const catalogDuringDelta = await page.evaluate(async () => {
      const s = window.__deltaCatalogRace;
      const revision = s.store.value.resources.entry.mapRevision;
      const generation = s.store.value.generation;
      s.entry = { ...s.entry, mapRevision: revision + 1 };
      await s.effects.refreshCatalog();
      return {
        generationBefore: generation,
        generationAfter: s.store.value.generation,
        revisionBefore: revision,
        revisionAfterCatalog: s.store.value.resources.entry.mapRevision,
        sceneCalls: s.sceneCalls,
      };
    });
    expect(catalogDuringDelta.generationAfter).toBe(catalogDuringDelta.generationBefore);
    expect(catalogDuringDelta.revisionAfterCatalog).toBe(catalogDuringDelta.revisionBefore);
    expect(catalogDuringDelta.sceneCalls).toBe(1);

    const advanced = await page.evaluate(async () => {
      const s = window.__deltaCatalogRace;
      s.releaseDelta();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const revision = s.store.value.resources.entry.mapRevision;
      const generation = s.store.value.generation;
      s.entry = { ...s.entry, mapRevision: revision + 1 };
      await s.effects.refreshCatalog();
      const ownerPreserved = {
        generationBefore: generation,
        generationAfter: s.store.value.generation,
        revisionBefore: revision,
        revisionAfterCatalog: s.store.value.resources.entry.mapRevision,
        sceneCalls: s.sceneCalls,
        deltaCalls: s.deltaCalls,
      };
      const boundaryGeneration = s.store.value.generation;
      s.entry = { ...s.entry, selectedFloorOrdinal: 2, mapFloorOrdinal: 2 };
      await s.effects.refreshCatalog(true);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const proofBoundary = {
        generationBefore: boundaryGeneration,
        generationAfter: s.store.value.generation,
        sceneCalls: s.sceneCalls,
      };
      s.effects.dispose();
      return { ownerPreserved, proofBoundary };
    });
    expect(advanced.ownerPreserved.generationAfter).toBe(advanced.ownerPreserved.generationBefore);
    expect(advanced.ownerPreserved.revisionAfterCatalog).toBe(advanced.ownerPreserved.revisionBefore);
    expect(advanced.ownerPreserved.sceneCalls).toBe(1);
    expect(advanced.ownerPreserved.deltaCalls).toBeGreaterThanOrEqual(3);
    expect(advanced.proofBoundary.generationAfter).toBeGreaterThan(advanced.proofBoundary.generationBefore);
    expect(advanced.proofBoundary.sceneCalls).toBe(2);
  });

  test("catalog pixel revision falls back to a new scene when no delta owner exists", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const m = await import("/plan-recovery-test.js");
      const initial = m.createGalleryState("ready");
      const state = { entry: { ...initial.resources.entry, deltaUrl: null }, sceneCalls: 0 };
      const store = new m.WorkspaceStore(initial);
      const effects = new m.EffectController(store, {
        catalog: async () => [state.entry],
        history: async () => initial.resources.history.value,
        scene: async (_url, revision) => {
          state.sceneCalls += 1;
          return { scene: initial.resources.scene.value, revision, floorCoherent: true };
        },
        pose: async () => initial.resources.pose.value,
        plans: async () => initial.resources.plans.value,
        dispose() {},
      });
      const projection = {
        host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en",
        userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
      };
      effects.sync(projection);
      await effects.refreshCatalog(true);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const generation = store.value.generation;
      state.entry = { ...state.entry, mapRevision: state.entry.mapRevision + 1 };
      await effects.refreshCatalog();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const result = {
        generationBefore: generation,
        generationAfter: store.value.generation,
        revision: store.value.resources.entry.mapRevision,
        sceneCalls: state.sceneCalls,
      };
      effects.dispose();
      return result;
    });
    expect(result.generationAfter).toBe(result.generationBefore);
    expect(result.sceneCalls).toBe(2);
  });

  test("retries history reads and retains the selected saved floor label", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      let reads = 0;
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry],
        history: async () => { if (++reads === 1) throw new Error("Offline"); return initial.resources.history.value; },
        // This test isolates catalog recovery from optional scene/pose reads.
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        dispose() {},
      });
      try {
        effects.sync({
          host: initial.host, activity: initial.activity, batteryPercent: 92,
          robotLabel: "Synthetic", robots: initial.robots, language: "en",
          userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
        });
        await effects.refreshCatalog(true);
        // Catalog starts its optional reads concurrently; wait for the failed
        // history request to settle before using the screen's retry action.
        for (let i = 0; i < 20 && store.value.resources.history.status !== "error"; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
        const failed = store.value.resources.history.status;
        await effects.openWorkflow("history");
        const retried = { status: store.value.resources.history.status, reads };
        await effects.selectFloor("saved-1");
        await effects.openWorkflow("history");
        return { failed, retried, floor: store.value.selection.floorId, label: store.value.floor.displayName, reads };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ failed: "error", retried: { status: "ready", reads: 2 }, floor: "saved-1", label: "Shed", reads: 3 });
  });
  test("protects plan drafts across nested selectors, back navigation and floor changes", async ({ page }) => {
    const gallery = await loadGallery(page);
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "plan", planView: "edit", planDraft: { ...state.planDraft, name: "Keep these edits", dirty: true } });
    }, GALLERY_TAG);
    const dialog = gallery.getByRole("dialog", { name: "Discard changes?" });
    // Edit's Cancel takes the place of Back (plan.md §3).
    const cancel = gallery.locator('[data-dialog-launcher="discardDraft"]');
    await cancel.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(gallery.getByRole("textbox", { name: "Plan name" })).toHaveValue("Keep these edits");
    await gallery.getByRole("combobox", { name: "Choose floor" }).selectOption("saved-1");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(gallery.getByRole("combobox", { name: "Choose floor" })).toHaveValue("current");
    await cancel.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await gallery.getByRole("button", { name: "Back to plans", exact: true }).click();
    await gallery.getByRole("button", { name: "Create a plan", exact: true }).click();
    expect(await snapshot(page)).toMatchObject({ workflow: "plan", selection: { planId: null }, planDraft: { dirty: false, name: "", rooms: [] } });
  });

  test("preserves dirty drafts on browser-layer dismissal and freezes forms during a save", async ({ page }) => {
    const gallery = await loadGallery(page);
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const { reduceWorkspace } = window.__galleryModule;
      element.replaceWorkspaceState(reduceWorkspace({ ...state, workflow: "plan", planView: "edit", planDraft: { ...state.planDraft, dirty: true } }, { type: "dismiss-top-layer" }));
    }, GALLERY_TAG);
    await expect(gallery.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    await gallery.getByRole("button", { name: "Keep editing" }).click();
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, command: "pending", pendingAction: "save-plan", expandedRoom: state.planDraft.rooms[0].roomId });
    }, GALLERY_TAG);
    // plan.md §4 E5: every control stays readable and focusable, says why
    // once, and doesn't change.
    const held = "Waiting for Home Assistant to save the plan.";
    const name = gallery.getByRole("textbox", { name: "Plan name" });
    await expect(name).toHaveAttribute("aria-disabled", "true");
    await expect(name).toHaveAttribute("readonly", "");
    await expect(name).toHaveAccessibleDescription(held);
    const mode = gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen", exact: true });
    await expect(mode).toHaveAttribute("aria-disabled", "true");
    await expect(mode).toHaveAccessibleDescription(held);
  });
  test("preserves plan edits after a failed or blocked save and allows retry", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      let reject = true;
      let writes = 0;
      let reloads = 0;
      const effects = new EffectController(store, {
        service: async () => { writes += 1; if (reject) throw new Error("Unavailable"); },
        dispose() {},
      });
      effects.sync({
        host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en",
        userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
      });
      const draft = { ...initial.planDraft, name: "Unsaved changes", dirty: true };
      store.patch({ planDraft: draft });
      effects.loadPlans = async () => {
        reloads += 1;
        store.patch({ planDraft: initial.planDraft });
      };
      try {
        await effects.savePlan();
        const failure = { draft: store.value.planDraft, command: store.value.command, reloads };
        store.patch({ command: "pending" });
        await effects.savePlan();
        const blocked = { draft: store.value.planDraft, writes, reloads };
        store.patch({ command: "failed" });
        reject = false;
        await effects.savePlan();
        const retry = { command: store.value.command, writes, reloads };
        return { draft, failure, blocked, retry };
      } finally { effects.dispose(); }
    });
    // A failed Home Assistant write returns to idle (plan.md §9, shell.md §6).
    expect(result.failure).toEqual({ draft: result.draft, command: "idle", reloads: 0 });
    expect(result.blocked).toEqual({ draft: result.draft, writes: 1, reloads: 0 });
    expect(result.retry).toEqual({ command: "idle", writes: 2, reloads: 1 });
  });

  test("saving keeps the default plan unless it is the plan being saved", async ({ page }) => {
    await loadEffectHarness(page);
    const select = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      const sent = [];
      const effects = new EffectController(store, {
        service: async (_domain, _service, data) => {
          sent.push(data.select);
          return { response: { plan: { id: data.plan_id ?? "new-plan" } } };
        },
        dispose() {},
      });
      effects.sync({
        host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en",
        userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
      });
      effects.loadPlans = async () => {};
      try {
        for (const id of [null, "weekend", "daily"]) {
          store.patch({ planDraft: { ...initial.planDraft, id, name: "Saved plan", dirty: true } });
          await effects.savePlan();
        }
        return sent;
      } finally { effects.dispose(); }
    });
    expect(select).toEqual([false, false, true]);
  });

  test("history exposes keyboard navigation buttons and meaningful timeline values", async ({ page, browserName }) => {
    const gallery = await loadGallery(page, { scenario: "history-floors" });
    const floors = gallery.getByRole("group", { name: "Mapped floors" });
    const current = floors.getByRole("button", { name: "Current floor Live" });
    const saved = floors.getByRole("button", { name: "Saved floor 1 Saved map" });
    await current.focus();
    // Safari's default keyboard preference uses Option-Tab for native buttons.
    await current.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(saved).toBeFocused();
    await expect(saved).toHaveAttribute("aria-current", "true");
    const timeline = gallery.getByRole("slider", { name: "Map timeline" });
    await expect(timeline).toHaveAttribute("aria-valuetext", /2026/);
    // One way back: Show live map in the bar, no row (map-surfaces.md §5).
    await expect(gallery.getByRole("button", { name: /Return to current floor/ })).toHaveCount(0);
    await saved.press("Enter");
    expect((await snapshot(page)).selection.floorId).toBe("saved-1");
  });
  test("production entry excludes the gallery and review reuses its compiled constructors", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      await import("/map_studio_v4/index.js");
      const panel = customElements.get("matic-map-panel-v0-4-0");
      const shell = customElements.get("matic-map-shell-v4");
      const galleryBeforeReview = Boolean(customElements.get("matic-map-studio-gallery-v0-4-0"));
      await import("/map_studio_v4-review/review.js");
      return {
        productionPanel: Boolean(panel), galleryBeforeReview,
        galleryAfterReview: Boolean(customElements.get("matic-map-studio-gallery-v0-4-0")),
        samePanel: panel === customElements.get("matic-map-panel-v0-4-0"),
        sameShell: shell === customElements.get("matic-map-shell-v4"),
      };
    });
    expect(result).toEqual({ productionPanel: true, galleryBeforeReview: false,
      galleryAfterReview: true, samePanel: true, sameShell: true });
  });

  test("registers the v0.4 panel and gallery without replacing v0.3 tags", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });

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

  test("rebuilds the live workspace after a cold browser reload", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/map-studio-v4-audit");
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery).toBeVisible();
    await expect(gallery.getByRole("heading", { name: "Choose what to clean" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Clean rooms" })).toBeVisible();

    await page.reload();
    const reloaded = page.locator(GALLERY_TAG);
    await expect(reloaded).toBeVisible();
    await expect(reloaded.getByRole("heading", { name: "Choose what to clean" })).toBeVisible();
    await expect(reloaded.getByRole("button", { name: "Clean rooms" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("disposes polling on unload and reattaches with fresh controllers", async ({ page }) => {
    const scene = syntheticScene("Room", 10);
    let catalogRequests = 0;
    let sceneRequests = 0;
    let poseRequests = 0;
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
    await page.route("**/api/matic_robot/slam_entries", (route) => {
      catalogRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [entry] }),
      });
    });
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", (route) => {
      sceneRequests += 1;
      return route.fulfill({
        status: 200,
        body: scene,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": "1",
          "X-Matic-Floor-Coherent": "1",
        },
      });
    });
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => {
      poseRequests += 1;
      // Keep the first request open long enough for the one-second polling
      // tick to queue a retry. Removing the panel must abort that request and
      // clear the queued retry instead of issuing a pose read while detached.
      const response = {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          position: null,
          source: "current_area",
          revision: 1,
          pose_revision: poseRequests,
          map_floor_coherent: true,
          pose_freshness: "live",
          map_session_key: "a".repeat(64),
        }),
      };
      if (poseRequests === 1) {
        return new Promise((resolve) => {
          setTimeout(() => {
            void route.fulfill(response).catch(() => {});
            resolve();
          }, 1_500);
        });
      }
      return route.fulfill(response);
    });
    await page.route("**/api/matic_robot/slam_history/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entry_id: "synthetic-entry",
        live_available: true,
        floors: [
          { id: "current", active: true, read_only: false, live_available: true, snapshots: [] },
          {
            id: "saved-floor",
            active: false,
            read_only: true,
            live_available: false,
            label: "Saved floor",
            ordinal: 2,
            snapshots: [{
              id: "saved-snapshot",
              created_at: "2026-08-29T14:00:00Z",
              revision: 1,
              point_count: 4,
              scene_url: "/synthetic-history-saved",
            }],
          },
        ],
      }),
    }));
    await page.route("**/synthetic-history-saved", (route) => route.fulfill({
      status: 200,
      body: scene,
      headers: {
        "Content-Type": "application/vnd.matic.slam-scene",
        "X-Matic-Revision": "1",
        "X-Matic-Floor-Coherent": "1",
      },
    }));

    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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
      window.__lifecyclePanel = panel;
    });

    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return { coherence: state.coherence, scene: state.resources.scene.status };
    })).toEqual({ coherence: "current", scene: "ready" });
    const mounted = { catalogRequests, sceneRequests, poseRequests };

    await page.evaluate(() => window.__lifecyclePanel.remove());
    // Allow disconnectedCallback to abort the current requests and clear both
    // polling timers before checking that detached panels stay completely quiet.
    await page.waitForTimeout(1_200);
    const detached = { catalogRequests, sceneRequests, poseRequests };
    expect(detached).toEqual(mounted);

    await page.evaluate(() => document.body.append(window.__lifecyclePanel));
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return {
        coherence: state.coherence,
        scene: state.resources.scene.status,
      };
    })).toMatchObject({ coherence: "current", scene: "ready" });
    // A retained scene can already be ready while the fresh controllers are
    // starting their reads. Wait for each request instead of treating that
    // retained render as proof that every asynchronous read has started.
    await expect.poll(() => catalogRequests).toBeGreaterThan(mounted.catalogRequests);
    await expect.poll(() => sceneRequests).toBeGreaterThan(mounted.sceneRequests);
    await expect.poll(() => poseRequests).toBeGreaterThan(mounted.poseRequests);

    await page.evaluate(() => {
      const shell = window.__lifecyclePanel.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "open-workflow", workflow: "rooms" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(async () => page.evaluate(() =>
      window.__lifecyclePanel.getWorkspaceSnapshot().workflow)).toBe("rooms");

    await page.evaluate(() => {
      const shell = window.__lifecyclePanel.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-floor", floorId: "saved-floor" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return {
        dataMode: state.dataMode,
        floorId: state.selection.floorId,
        workflow: state.workflow,
        scene: state.resources.scene.status,
      };
    })).toEqual({ dataMode: "history", floorId: "saved-floor", workflow: "none", scene: "ready" });
    const historical = { catalogRequests, sceneRequests, poseRequests };
    await page.evaluate(() => window.__lifecyclePanel.remove());
    await page.waitForTimeout(1_200);
    expect({ catalogRequests, sceneRequests, poseRequests }).toEqual(historical);
    await page.evaluate(() => document.body.append(window.__lifecyclePanel));
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return {
        dataMode: state.dataMode,
        floorId: state.selection.floorId,
        scene: state.resources.scene.status,
      };
    })).toEqual({ dataMode: "history", floorId: "saved-floor", scene: "ready" });
    expect(catalogRequests).toBeGreaterThan(historical.catalogRequests);
    expect(sceneRequests).toBe(historical.sceneRequests);
    expect(poseRequests).toBe(historical.poseRequests);

    await page.evaluate(() => window.__lifecyclePanel.remove());
    const beforeOfflineReattach = { catalogRequests, sceneRequests, poseRequests };
    // Update the HA projection while the element is detached, then reattach it
    // synchronously so connectedCallback must use current properties rather
    // than the stale connected projection from its previous mount.
    await page.evaluate(() => {
      const panel = window.__lifecyclePanel;
      panel.hass = { ...panel.hass, connected: false };
      document.body.append(panel);
    });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return { connected: state.host.connected, coherence: state.coherence };
    })).toEqual({ connected: false, coherence: "degraded" });
    await page.waitForTimeout(1_200);
    expect({ catalogRequests, sceneRequests, poseRequests }).toEqual(beforeOfflineReattach);
    await page.evaluate(() => window.__lifecyclePanel.remove());
  });

  test("does not revoke a verified map for same-entry HA telemetry updates", async ({ page }) => {
    await installPanelFixture(page);
    await page.evaluate(async () => {
      window.__galleryModule = await import("/map_studio_v4-review/review.js");
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = window.__panelFixture.createPanel();
      document.body.append(panel);
      window.__telemetryPanel = panel;
    });
    await expect.poll(() => page.evaluate(() => {
      const module = window.__galleryModule;
      const panel = window.__telemetryPanel;
      const state = panel.getWorkspaceSnapshot();
      return {
        coherence: state.coherence,
        canEdit: module.canEditCoordinates(state),
        canReadFloorResources: module.canReadFloorResources(state),
      };
    })).toEqual({ coherence: "current", canEdit: true, canReadFloorResources: true });

    const updates = await page.evaluate(async () => {
      const panel = window.__telemetryPanel;
      const module = window.__galleryModule;
      const originalFetchWithAuth = panel.hass.fetchWithAuth;
      window.__telemetryCatalogRequests = 0;
      panel.hass = {
        ...panel.hass,
        fetchWithAuth: async (path, ...args) => {
          if (String(path).endsWith("slam_entries")) window.__telemetryCatalogRequests += 1;
          return originalFetchWithAuth(path, ...args);
        },
      };
      await panel.updateComplete;
      const generation = panel.getWorkspaceSnapshot().generation;
      const update = async (patch) => {
        const vacuum = panel.hass.states["vacuum.synthetic"];
        panel.hass = {
          ...panel.hass,
          states: { ...panel.hass.states, "vacuum.synthetic": { ...vacuum, ...patch } },
        };
        await panel.updateComplete;
        const state = panel.getWorkspaceSnapshot();
        return {
          coherence: state.coherence,
          canEdit: module.canEditCoordinates(state),
          canReadFloorResources: module.canReadFloorResources(state),
          generation: state.generation,
          catalogRequests: window.__telemetryCatalogRequests,
        };
      };
      const battery = await update({ attributes: { ...panel.hass.states["vacuum.synthetic"].attributes, battery_level: 90 } });
      const activity = await update({ state: "cleaning" });
      return { battery, activity, generation };
    });

    for (const update of [updates.battery, updates.activity]) {
      expect(update).toMatchObject({
        coherence: "current", canEdit: true, canReadFloorResources: true,
        generation: updates.generation, catalogRequests: 0,
      });
    }

    const offline = await page.evaluate(async () => {
      const panel = window.__telemetryPanel;
      const module = window.__galleryModule;
      panel.hass = { ...panel.hass, connected: false };
      await panel.updateComplete;
      const disconnected = panel.getWorkspaceSnapshot();
      const vacuum = panel.hass.states["vacuum.synthetic"];
      panel.hass = {
        ...panel.hass,
        states: {
          ...panel.hass.states,
          "vacuum.synthetic": {
            ...vacuum,
            attributes: { ...vacuum.attributes, battery_level: 89 },
          },
        },
      };
      await panel.updateComplete;
      const afterTelemetry = panel.getWorkspaceSnapshot();
      return [disconnected, afterTelemetry].map((state) => ({
        connected: state.host.connected,
        coherence: state.coherence,
        canEdit: module.canEditCoordinates(state),
        canReadFloorResources: module.canReadFloorResources(state),
      }));
    });
    expect(offline).toEqual([
      { connected: false, coherence: "degraded", canEdit: false, canReadFloorResources: false },
      { connected: false, coherence: "degraded", canEdit: false, canReadFloorResources: false },
    ]);
    await page.evaluate(() => window.__telemetryPanel.remove());
  });

  test("revokes action authority across detach until fresh catalog proof completes", async ({ page }) => {
    await page.clock.install();
    await installPanelFixture(page);
    await page.evaluate(async () => {
      window.__remountModule = await import("/map_studio_v4-review/review.js");
      const panel = window.__panelFixture.createPanel();
      document.body.append(panel);
      window.__remountPanel = panel;
    });
    await expect.poll(() => page.evaluate(() => {
      const module = window.__remountModule;
      const state = window.__remountPanel.getWorkspaceSnapshot();
      return {
        coherence: state.coherence,
        scene: state.resources.scene.status,
        canEdit: module.canEditCoordinates(state),
        canStart: module.canStartMotion(state),
      };
    })).toEqual({ coherence: "current", scene: "ready", canEdit: true, canStart: true });

    await page.evaluate(() => {
      const panel = window.__remountPanel;
      const original = panel.hass.fetchWithAuth;
      const gates = [{ release: null, signal: null }, { release: null, signal: null }];
      const harness = window.__remountGap = { panel, calls: 0, gates };
      panel.hass = {
        ...panel.hass,
        fetchWithAuth: (path, init) => {
          if (String(path).endsWith("slam_entries")) {
            const gate = gates[harness.calls++];
            if (gate) {
              gate.signal = init?.signal ?? null;
              return new Promise((resolve, reject) => {
                gate.release = () => { void original(path, init).then(resolve, reject); };
              });
            }
          }
          return original(path, init);
        },
      };
    });
    // The live controller's five-second catalog poll is held across detach.
    await page.clock.fastForward(5_000);
    await expect.poll(() => page.evaluate(() => window.__remountGap.calls)).toBe(1);
    const beforeDetach = await page.evaluate(() => {
      const state = window.__remountPanel.getWorkspaceSnapshot();
      const module = window.__remountModule;
      return {
        generation: state.generation,
        canEdit: module.canEditCoordinates(state),
        canStart: module.canStartMotion(state),
      };
    });
    expect(beforeDetach).toMatchObject({ canEdit: true, canStart: true });

    await page.evaluate(() => window.__remountPanel.remove());
    const detached = await page.evaluate(() => {
      const state = window.__remountPanel.getWorkspaceSnapshot();
      const module = window.__remountModule;
      return {
        generation: state.generation,
        coherence: state.coherence,
        exactPose: state.map.exactPose,
        retainedScene: state.resources.scene.value !== null,
        canEdit: module.canEditCoordinates(state),
        canStart: module.canStartMotion(state),
        staleRequestAborted: window.__remountGap.gates[0].signal?.aborted ?? false,
      };
    });
    expect(detached).toEqual({
      generation: beforeDetach.generation + 1,
      coherence: "verifying",
      exactPose: false,
      retainedScene: true,
      canEdit: false,
      canStart: false,
      staleRequestAborted: true,
    });

    await page.evaluate(() => document.body.append(window.__remountPanel));
    await expect.poll(() => page.evaluate(() => window.__remountGap.calls)).toBe(2);
    const reattachedPending = await page.evaluate(() => {
      const state = window.__remountPanel.getWorkspaceSnapshot();
      const module = window.__remountModule;
      return {
        generation: state.generation,
        coherence: state.coherence,
        canEdit: module.canEditCoordinates(state),
        canStart: module.canStartMotion(state),
      };
    });
    expect(reattachedPending).toEqual({
      generation: detached.generation,
      coherence: "verifying",
      canEdit: false,
      canStart: false,
    });

    // Resolve the disposed controller's response while the new controller's
    // authoritative catalog is still held; the old result must not re-admit it.
    await page.evaluate(() => window.__remountGap.gates[0].release());
    await page.evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 0)));
    const afterStaleResult = await page.evaluate(() => {
      const state = window.__remountPanel.getWorkspaceSnapshot();
      const module = window.__remountModule;
      return {
        generation: state.generation,
        coherence: state.coherence,
        canEdit: module.canEditCoordinates(state),
        canStart: module.canStartMotion(state),
      };
    });
    expect(afterStaleResult).toEqual(reattachedPending);

    await page.evaluate(() => window.__remountGap.gates[1].release());
    await expect.poll(() => page.evaluate(() => {
      const state = window.__remountPanel.getWorkspaceSnapshot();
      const module = window.__remountModule;
      return {
        coherence: state.coherence,
        scene: state.resources.scene.status,
        canEdit: module.canEditCoordinates(state),
        canStart: module.canStartMotion(state),
      };
    })).toEqual({ coherence: "current", scene: "ready", canEdit: true, canStart: true });
    expect(await page.evaluate(() => window.__remountPanel.getWorkspaceSnapshot().generation))
      .toBeGreaterThan(detached.generation);
    await page.evaluate(() => window.__remountPanel.remove());
  });

  test("projects the meter-space robot pose onto the scene center", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    const overlay = gallery.locator("matic-map-canvas-v4 .overlay-canvas");

    // Report the measured centroid instead of a bare boolean. "The marker was
    // never painted" and "the marker landed off centre" are different faults
    // that a true/false poll renders identically, which makes a failure here
    // impossible to diagnose from CI logs alone.
    let measured;
    await expect.poll(async () => {
      measured = await overlay.evaluate((canvas) => {
        const context = canvas.getContext("2d");
        if (!context) return { painted: false, reason: "no 2d context" };
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
        const measured = {
          painted: points.length > 0,
          samples: points.length,
          canvas: `${canvas.width}x${canvas.height}`,
          dpr: window.devicePixelRatio,
        };
        if (!points.length) return { ...measured, reason: "no marker pixels" };
        const x = points.reduce((sum, point) => sum + point[0], 0) / points.length;
        const y = points.reduce((sum, point) => sum + point[1], 0) / points.length;
        // Allow one CSS pixel rather than one device pixel. The overlay is
        // sized to an odd number of device pixels (a 606.5 CSS-pixel viewport
        // at ratio 2), so the true centre falls on a half pixel while the
        // symmetric marker rasterises onto a whole one -- a structural ~1px
        // offset before any antialiasing. WebKit's arc antialiasing then
        // differs by a fraction of a pixel between platforms, which is enough
        // to cross a one-device-pixel bound. The meter-versus-cell conversion
        // this guards would be wrong by far more than a pixel.
        const tolerance = Math.max(1, window.devicePixelRatio || 1);
        return {
          ...measured,
          tolerance,
          offsetX: Math.round((x - canvas.width / 2) * 100) / 100,
          offsetY: Math.round((y - canvas.height / 2) * 100) / 100,
          centered: Math.abs(x - canvas.width / 2) <= tolerance
            && Math.abs(y - canvas.height / 2) <= tolerance,
        };
      });
      return measured.painted;
    }).toBe(true);
    expect(measured, `pose projection ${JSON.stringify(measured)}`)
      .toMatchObject({ centered: true });
  });

  test("fits the complete 3D scene inside the perspective viewport", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const map = gallery.locator("matic-map-canvas-v4");
    const window = gallery.locator("matic-map-canvas-v4 .scene-window");

    const bounds = await window.boundingBox();
    expect(bounds).not.toBeNull();
    const aspect = bounds.width / bounds.height;
    const halfVertical = (Math.PI / 3.15) / 2;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
    const sceneRadius = Math.hypot(180 * 0.05, 140 * 0.05) / 2;
    const expectedFit = sceneRadius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.08;

    await expect.poll(async () => map.evaluate((element) => element.rendererDiagnostics()))
      .toMatchObject({ fitActive: true });
    const diagnostics = await map.evaluate((element) => element.rendererDiagnostics());
    expect(diagnostics.fitDistance).toBeCloseTo(expectedFit, 4);
    expect(diagnostics.cameraDistance).toBeCloseTo(diagnostics.fitDistance, 6);
  });

  test("preserves navigation when a live scene revision arrives", async ({ page }) => {
    const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
    await page.route("**/scene-camera-preservation.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const { RendererController, createGalleryState } = await import("/scene-camera-preservation.js");
      const sceneCanvas = document.createElement("canvas");
      const overlayCanvas = document.createElement("canvas");
      for (const canvas of [sceneCanvas, overlayCanvas]) {
        Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
        document.body.append(canvas);
      }
      const renderer = new RendererController(sceneCanvas, overlayCanvas);
      const state = {
        ...createGalleryState("ready"),
        cameras: {
          three: {
            yaw: -0.7,
            pitch: 0.82,
            zoom: 0.8,
            targetX: 0.1,
            targetZ: -0.2,
          },
        },
      };
      renderer.setState(state);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      renderer.setCamera({
        ...renderer.camera,
        yaw: 0.35,
        pitch: 1.04,
        distance: renderer.camera.distance * 0.62,
        targetX: 0.2,
        targetZ: -0.3,
      });
      const before = renderer.camera;
      const scene = state.resources.scene.value;
      renderer.setState({
        ...state,
        resources: {
          ...state.resources,
          scene: { ...state.resources.scene, value: { ...scene, revision: scene.revision + 1 } },
        },
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = renderer.camera;
      const diagnostics = renderer.diagnostics();
      renderer.dispose();
      sceneCanvas.remove();
      overlayCanvas.remove();
      return { before, after, fitActive: diagnostics.fitActive };
    });
    expect(result.after).toEqual(result.before);
    expect(result.fitActive).toBe(false);
  });

  test("rebases the navigation target when live scene bounds move", async ({ page }) => {
    const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
    await page.route("**/scene-camera-rebase.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const { RendererController, createGalleryState } = await import("/scene-camera-rebase.js");
      const sceneCanvas = document.createElement("canvas");
      const overlayCanvas = document.createElement("canvas");
      for (const canvas of [sceneCanvas, overlayCanvas]) {
        Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
        document.body.append(canvas);
      }
      let notified = null;
      let preferences = null;
      const renderer = new RendererController(sceneCanvas, overlayCanvas, {
        onCamera: camera => { notified = camera; },
        onCameraPreferences: cameras => { preferences = cameras; },
      });
      const state = createGalleryState("ready");
      state.cameras = {
        ...state.cameras,
        three: {
          ...state.cameras.three,
          zoom: 0.8,
          targetX: 0.1,
          targetZ: -0.2,
        },
      };
      const previousThreeZoom = state.cameras.three.zoom;
      renderer.setState(state);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      renderer.setCamera({
        ...renderer.camera,
        yaw: 0.35,
        pitch: 1.04,
        distance: renderer.camera.distance * 0.62,
        targetX: 0.2,
        targetZ: -0.3,
      });
      const before = renderer.camera;
      const scene = state.resources.scene.value;
      renderer.setState({
        ...state,
        resources: {
          ...state.resources,
          scene: {
            ...state.resources.scene,
            value: {
              ...scene,
              revision: scene.revision + 1,
              metadata: {
                ...scene.metadata,
                origin: [4, -2],
                span: [200, 160],
              },
            },
          },
        },
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = renderer.camera;
      renderer.dispose();
      sceneCanvas.remove();
      overlayCanvas.remove();
      return { before, after, notified, preferences, previousThreeZoom };
    });
    expect(result.after.targetX).toBeCloseTo(result.before.targetX + 0.7, 6);
    expect(result.after.targetZ).toBeCloseTo(result.before.targetZ - 0.4, 6);
    expect(result.after.yaw).toBe(result.before.yaw);
    expect(result.after.distance).toBe(result.before.distance);
    expect(result.notified).toMatchObject({ targetX: result.after.targetX, targetZ: result.after.targetZ });
    expect(result.preferences.three.targetX).toBeCloseTo(0.8, 12);
    expect(result.preferences.three.targetZ).toBeCloseTo(-0.6, 12);
    expect(result.preferences.three.zoom).not.toBe(result.previousThreeZoom);
  });

  test("rebases inactive preferences when the active view is still fitted", async ({ page }) => {
    const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
    await page.route("**/scene-camera-fit-rebase.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const { RendererController, createGalleryState } = await import("/scene-camera-fit-rebase.js");
      const sceneCanvas = document.createElement("canvas");
      const overlayCanvas = document.createElement("canvas");
      for (const canvas of [sceneCanvas, overlayCanvas]) {
        Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
        document.body.append(canvas);
      }
      let preferences = null;
      const renderer = new RendererController(sceneCanvas, overlayCanvas, {
        onCameraPreferences: cameras => { preferences = cameras; },
      });
      const state = createGalleryState("ready");
      state.cameras = {
        ...state.cameras,
        top: { ...state.cameras.top, zoom: 0.8, targetX: 0.1, targetZ: -0.2 },
      };
      const previousTopZoom = state.cameras.top.zoom;
      renderer.setState(state);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scene = state.resources.scene.value;
      renderer.setState({
        ...state,
        resources: {
          ...state.resources,
          scene: {
            ...state.resources.scene,
            value: {
              ...scene,
              revision: scene.revision + 1,
              metadata: { ...scene.metadata, origin: [4, -2], span: [200, 160] },
            },
          },
        },
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      renderer.dispose();
      sceneCanvas.remove();
      overlayCanvas.remove();
      return { preferences, previousTopZoom };
    });
    expect(result.preferences.top.targetX).toBeCloseTo(0.8, 12);
    expect(result.preferences.top.targetZ).toBeCloseTo(-0.6, 12);
    expect(result.preferences.top.zoom).not.toBe(result.previousTopZoom);
  });

  for (const [transition, destinationFit] of ["three-top", "top-three", "enter-draw", "leave-draw"]
    .flatMap(transition => [false, true].map(fit => [transition, fit]))) {
    test(`preserves rebased camera ownership during ${transition} fit=${destinationFit}`, async ({ page }) => {
      const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
      await page.route("**/camera-transition.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
      await page.goto("/");
      const result = await page.evaluate(async ({ transition, destinationFit }) => {
        const { RendererController, createGalleryState } = await import("/camera-transition.js");
        const canvases = [document.createElement("canvas"), document.createElement("canvas")];
        for (const canvas of canvases) {
          Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
          document.body.append(canvas);
        }
        let notifications = 0;
        let preferences = null;
        const renderer = new RendererController(...canvases, {
          onCamera: () => { notifications++; },
          onCameraPreferences: cameras => { preferences = cameras; },
        });
        const state = createGalleryState("ready");
        state.view = transition === "top-three" ? "top" : "three";
        state.workflow = transition === "leave-draw" ? "draw" : "none";
        state.cameras = {
          three: { yaw: -Math.PI / 4, pitch: 0.82, zoom: 1, targetX: 0, targetZ: 0 },
          top: { yaw: 0, pitch: Math.PI / 2 - 0.018, zoom: 1, targetX: 0, targetZ: 0 },
        };
        const destinationView = transition === "three-top" || transition === "enter-draw" ? "top" : "three";
        if (!destinationFit) state.cameras[destinationView] = {
          ...state.cameras[destinationView], zoom: 0.8, targetX: 0.1, targetZ: -0.2,
        };
        renderer.setState(state);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        notifications = 0;
        const next = {
          ...state,
          view: transition === "three-top" ? "top" : "three",
          workflow: transition === "enter-draw" ? "draw" : "none",
          resources: {
            ...state.resources,
            scene: { ...state.resources.scene, value: {
              ...state.resources.scene.value,
              revision: state.resources.scene.value.revision + 1,
              metadata: { ...state.resources.scene.value.metadata, origin: [4, -2], span: [200, 160] },
            } },
          },
        };
        renderer.setState(next);
        const afterTransition = renderer.camera;
        const fitAfterTransition = renderer.diagnostics().fitActive;
        const outgoing = preferences[transition === "top-three" || transition === "leave-draw" ? "top" : "three"];
        next.cameras = preferences;
        renderer.setState({ ...next, resources: { ...next.resources,
          scene: { ...next.resources.scene, value: { ...next.resources.scene.value, revision: next.resources.scene.value.revision + 1 } },
        } });
        const expectedRevision = next.resources.scene.value.revision + 1;
        const expectedPoints = next.resources.scene.value.total;
        const beforePublication = {
          notifications, camera: renderer.camera, revision: renderer.diagnostics().sceneRevision,
        };
        const publishDeadline = performance.now() + 5000;
        let publication = renderer.diagnostics();
        while ((publication.sceneRevision !== expectedRevision
          || publication.renderedPoints !== expectedPoints)
          && performance.now() < publishDeadline) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          publication = renderer.diagnostics();
        }
        const afterRevision = renderer.camera;
        renderer.dispose();
        canvases.forEach(canvas => canvas.remove());
        return {
          notifications, outgoing, afterTransition, afterRevision, fitAfterTransition,
          beforePublication, publication, expectedRevision, expectedPoints,
        };
      }, { transition, destinationFit });
      expect(result.publication.sceneRevision).toBe(result.expectedRevision);
      expect(result.publication.renderedPoints).toBe(result.expectedPoints);
      expect(result.beforePublication.notifications).toBe(1);
      expect(result.beforePublication.revision).toBe(result.expectedRevision - 1);
      expect(result.beforePublication.camera).toEqual(result.afterTransition);
      expect(result.notifications).toBe(2); // Final destination, then the same-view revision.
      expect(result.outgoing.zoom).toBeCloseTo(1, 6);
      expect(result.outgoing.targetX).toBe(0);
      expect(result.outgoing.targetZ).toBe(0);
      expect(result.outgoing.yaw).toBeCloseTo(transition === "top-three" || transition === "leave-draw" ? 0 : -Math.PI / 4, 6);
      expect(result.fitAfterTransition).toBe(destinationFit);
      expect(result.afterTransition.targetX).toBeCloseTo(destinationFit ? 0 : 0.8, 6);
      expect(result.afterTransition.targetZ).toBeCloseTo(destinationFit ? 0 : -0.6, 6);
      expect(result.afterRevision).toEqual(result.afterTransition);
    });
  }

  test("draw zoom control follows the rebased destination without feedback jumps", async ({ page }) => {
    const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state"; export { WorkspaceStore } from "./frontend/map-studio-v4/state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
    await page.route("**/draw-camera-authority.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const { RendererController, createGalleryState, WorkspaceStore } = await import("/draw-camera-authority.js");
      const canvases = [document.createElement("canvas"), document.createElement("canvas")];
      for (const canvas of canvases) {
        Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
        document.body.append(canvas);
      }
      const state = createGalleryState("ready");
      state.cameras = { top: { yaw: 0, pitch: 1.55, zoom: 2, targetX: 0.1, targetZ: -0.2 } };
      state.draw = { ...state.draw, zoomPercent: 200 };
      const store = new WorkspaceStore(state);
      const notices = [];
      const renderer = new RendererController(...canvases, {
        onCameraPreferences: cameras => {
          for (const [view, camera] of Object.entries(cameras)) store.dispatch({ type: "set-camera", view, camera });
        },
        onCamera: (camera, zoomPercent) => {
          notices.push({ camera, zoomPercent });
          store.dispatch({ type: "set-camera", view: store.value.workflow === "draw" ? "top" : store.value.view,
            camera: { ...camera, zoom: zoomPercent / 100 } });
          if (store.value.workflow === "draw") store.dispatch({ type: "set-zoom", value: zoomPercent });
        },
      });
      renderer.setState(store.value);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // Initial ready-camera publication is separate from the measured rebase.
      notices.length = 0;
      const scene = state.resources.scene.value;
      store.replace({ ...store.value, workflow: "draw", resources: { ...state.resources,
        scene: { ...state.resources.scene, value: { ...scene, revision: scene.revision + 1,
          metadata: { ...scene.metadata, origin: [4, -2], span: [200, 160] } } },
      } });
      renderer.setState(store.value);
      const rebased = renderer.camera;
      const zoom = store.value.draw.zoomPercent;
      const fit = renderer.diagnostics().fitDistance;
      renderer.setState(store.value);
      const echoed = renderer.camera;
      store.dispatch({ type: "step-zoom", factor: 1.25 });
      renderer.setState(store.value);
      const stepped = renderer.camera;
      renderer.dispose();
      canvases.forEach(canvas => canvas.remove());
      return { rebased, echoed, stepped, zoom, fit, notices };
    });
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0].camera.orthographic).toBe(true);
    expect(result.zoom).toBe(Math.round(result.fit / result.rebased.distance * 100));
    expect(result.zoom).not.toBe(200);
    expect(result.echoed).toEqual(result.rebased);
    expect(result.stepped.distance).toBeCloseTo(result.fit * 100 / Math.round(result.zoom * 1.25), 8);
    expect(result.stepped.targetX).toBe(result.rebased.targetX);
    expect(result.stepped.targetZ).toBe(result.rebased.targetZ);
  });

  test("fits after a generation changes before its replacement scene arrives", async ({ page }) => {
    const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
    await page.route("**/scene-camera-generation.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const { RendererController, createGalleryState } = await import("/scene-camera-generation.js");
      const sceneCanvas = document.createElement("canvas");
      const overlayCanvas = document.createElement("canvas");
      for (const canvas of [sceneCanvas, overlayCanvas]) {
        Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
        document.body.append(canvas);
      }
      const renderer = new RendererController(sceneCanvas, overlayCanvas);
      const state = {
        ...createGalleryState("ready"),
        generation: 1,
        selection: { ...createGalleryState("ready").selection, floorId: "floor-1" },
      };
      renderer.setState(state);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      renderer.setCamera({
        ...renderer.camera,
        yaw: 0.35,
        pitch: 1.04,
        distance: renderer.camera.distance * 0.62,
        targetX: 0.2,
        targetZ: -0.3,
      });
      const scene = state.resources.scene.value;
      const nextSelection = { ...state.selection, floorId: "floor-2" };
      renderer.setState({ ...state, generation: 2, selection: nextSelection });
      renderer.setState({
        ...state,
        generation: 2,
        selection: nextSelection,
        resources: {
          ...state.resources,
          scene: { ...state.resources.scene, value: { ...scene, revision: scene.revision + 1 } },
        },
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const diagnostics = renderer.diagnostics();
      renderer.dispose();
      sceneCanvas.remove();
      overlayCanvas.remove();
      return diagnostics;
    });
    expect(result.fitActive).toBe(true);
  });

  test("keeps an off-screen room polygon intact while zooming", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const scene = state.resources.scene.value;
      element.replaceWorkspaceState({
        ...state,
        resources: {
          ...state.resources,
          scene: {
            ...state.resources.scene,
            value: {
              ...scene,
              metadata: {
                ...scene.metadata,
                rooms: [{
                  id: "whole-floor",
                  name: "Whole floor",
                  boundary: [[0, 0], [180, 0], [180, 140], [0, 140]],
                  center: [90, 70],
                }],
              },
            },
          },
        },
      });
    }, GALLERY_TAG);

    await gallery.getByRole("button", { name: "2D", exact: true }).click();
    await gallery.getByRole("button", { name: "Room colors", exact: true }).click();
    await gallery.getByRole("button", { name: "Room names", exact: true }).click();
    // Double-click the scene itself: the map root now also hosts the control
    // rail and dock, so its centre is not guaranteed to be bare map.
    const scene = gallery.locator("matic-map-canvas-v4 .scene-window");
    const box = await scene.boundingBox();
    expect(box).not.toBeNull();
    for (let index = 0; index < 4; index += 1) {
      await scene.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
    }

    const overlay = gallery.locator("matic-map-canvas-v4 .overlay-canvas");
    await expect.poll(async () => overlay.evaluate((canvas) => {
      const context = canvas.getContext("2d");
      if (!context) return false;
      const samples = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      return samples.every(([x, y]) => context.getImageData(
        Math.floor(canvas.width * x),
        Math.floor(canvas.height * y),
        1,
        1,
      ).data[3] > 0);
    })).toBe(true);
  });

  test("upgrades a pre-existing shell without a blank first render", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = "<matic-map-shell-v4></matic-map-shell-v4>";
    });
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });

    await expect(page.locator("matic-map-shell-v4")).toContainText("Matic Map");
    expect(errors).toEqual([]);
  });

  test("rejects stale coherence generations and fails closed @safety", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4-review/review.js");
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

  test("explains pending stop recovery in room and plan actions without mislabeling the map", async ({ page }) => {
    const sourceBundle = await build({
      entryPoints: ["frontend/map-studio-v4/review.ts"],
      bundle: true,
      format: "esm",
      target: "es2022",
      write: false,
    });
    await page.route("**/map_studio_v4-review/review.js", (route) => route.fulfill({
      contentType: "text/javascript",
      body: sourceBundle.outputFiles[0].text,
    }));
    const gallery = await loadGallery(page, { scenario: "ready" });
    const result = await page.evaluate((tag) => {
      const module = window.__galleryModule;
      const buildState = (workflow, { stopPending = true, mapVerified = true, otherLock = false } = {}) => {
        const base = module.createGalleryState(workflow === "rooms" ? "rooms" : "ready");
        const roomId = base.resources.plans.value.rooms[0].roomId;
        const state = {
          ...base,
          workflow,
          managedLock: stopPending || otherLock,
          resources: {
            ...base.resources,
            entry: { ...base.resources.entry, stopSettlePending: stopPending },
          },
          map: mapVerified ? base.map : { ...base.map, complete: false },
          selection: {
            ...base.selection,
            roomIds: workflow === "rooms" ? [roomId] : base.selection.roomIds,
            roomSettings: workflow === "rooms"
              ? [{ roomId, cleaningMode: "vacuum", coverageSetting: "standard" }]
              : base.selection.roomSettings,
          },
        };
        return workflow === "rooms" ? module.withGalleryRoomPreview(state) : state;
      };
      const inspect = (state) => {
        const action = module.selectPrimaryAction(state);
        return {
          action: action.id,
          enabled: action.enabled,
          reason: action.reason,
          reasonKey: action.reasonKey,
          stopOffered: module.selectStopSecondaryAction(state) !== null,
        };
      };
      const roomState = buildState("rooms");
      const planState = buildState("plan");
      const lockedState = buildState("rooms", { stopPending: false, otherLock: true });
      const mapBlockedState = buildState("rooms", { mapVerified: false });
      document.querySelector(tag).replaceWorkspaceState(roomState);
      return {
        rooms: inspect(roomState),
        plan: inspect(planState),
        otherManagedLock: inspect(lockedState),
        mapBlocked: inspect(mapBlockedState),
      };
    }, GALLERY_TAG);

    const stopReason = "Waiting for the robot to finish stopping.";
    expect(result.rooms).toEqual({
      action: "clean-rooms", enabled: false, reason: stopReason,
      reasonKey: "v4_reason_stop_settle_pending", stopOffered: false,
    });
    expect(result.plan).toEqual({
      action: "run-plan", enabled: false, reason: stopReason,
      reasonKey: "v4_reason_stop_settle_pending", stopOffered: false,
    });
    expect(result.otherManagedLock).toMatchObject({
      action: "clean-rooms", enabled: false,
      reason: "Waiting for the robot to finish what it's doing.",
      reasonKey: "v4_reason_robot_operation_waiting", stopOffered: false,
    });
    expect(result.mapBlocked).toMatchObject({
      action: "clean-rooms", enabled: false,
      reason: "Waiting for the map to be ready.",
      reasonKey: "v4_reason_clean_rooms_verification", stopOffered: false,
    });

    const cleanButton = gallery.getByRole("button", { name: "Clean 1 room" });
    await expect(cleanButton).toHaveAttribute("aria-disabled", "true");
    await expect(gallery.locator(".map-message")).toHaveCount(0);
    const reasonId = await cleanButton.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    await expect(gallery.locator("#" + reasonId)).toHaveText(stopReason);

    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      const base = module.createGalleryState("ready");
      document.querySelector(tag).replaceWorkspaceState({
        ...base,
        workflow: "plan",
        managedLock: true,
        resources: {
          ...base.resources,
          entry: { ...base.resources.entry, stopSettlePending: true },
        },
      });
    }, GALLERY_TAG);
    const runButton = gallery.getByRole("button", { name: "Run plan" });
    await expect(runButton).toHaveAttribute("aria-disabled", "true");
    const runReasonId = await runButton.getAttribute("aria-describedby");
    expect(runReasonId).toBeTruthy();
    await expect(gallery.locator("#" + runReasonId)).toHaveText(stopReason);
  });

  test("dismisses dialog, precision, expanded map, and workflow one layer at a time", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4-review/review.js");
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
      { dialog: "discardDraft", precision: false, fullMap: false, workflow: "draw" },
    ]);
  });

  test("opens History without hiding the live map and preserves a chosen saved map", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4-review/review.js");
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

  test("describes saved maps as saved and gives history-specific recovery copy", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history" });
    const scene = gallery.locator("matic-map-canvas-v4 .scene-window");
    await expect(scene).toHaveAttribute(
      "aria-label",
      "Saved read-only map for Shed. Live robot position is hidden.",
    );
    await expect(gallery.getByRole("combobox", { name: "Choose floor" })).toHaveValue("saved-1");
    await expect(gallery.locator(".floor-switcher option:checked")).toContainText("Shed");
    await expect(gallery.getByText("The current private map is not available.", { exact: true })).toHaveCount(0);

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        map: { ...state.map, available: false },
        resources: {
          ...state.resources,
          scene: { ...state.resources.scene, status: "loading", value: null, problem: null },
        },
      });
    }, GALLERY_TAG);
    await expect(gallery.locator(".map-message")).toContainText("Loading saved map");
    await expect(scene).toHaveAttribute("aria-label", "The saved map is loading.");

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        resources: {
          ...state.resources,
          scene: { ...state.resources.scene, status: "error", value: null, problem: "request-failed" },
        },
      });
    }, GALLERY_TAG);
    await expect(gallery.locator(".map-message")).toContainText("Saved map unavailable");
    await expect(scene).toHaveAttribute("aria-label", "This saved map is unavailable.");
  });

  test("keeps saved floors view-only and never opens cleaning workflows", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "none" });
    }, GALLERY_TAG);

    await expect(gallery.getByRole("heading", { name: "Saved map is read only" })).toBeVisible();
    const recoveryExplanation = gallery.getByText("Return to the live map to choose rooms, run a plan, or draw a custom area.", { exact: true });
    await expect(recoveryExplanation).toHaveCount(1);
    await expect(recoveryExplanation).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Clean rooms" })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Run a plan" })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Clean custom area" })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Show live map" })).toBeVisible();

    const workflows = await page.evaluate((tag) => {
      const module = window.__galleryModule;
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      return ["rooms", "plan", "draw", "areaReview"].map((workflow) =>
        module.reduceWorkspace(state, { type: "open-workflow", workflow }).workflow,
      );
    }, GALLERY_TAG);
    expect(workflows).toEqual(["none", "none", "none", "none"]);
  });

  test("uses accessible peek, half, and full mobile sheet detents", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    const sheet = gallery.locator(".mobile-sheet");
    // The cycle toggle is gone: two explicit step buttons that disable at the
    // ends, plus a live region that announces the detent that was reached.
    const showMore = gallery.getByRole("button", { name: "Expand panel" });
    const showLess = gallery.getByRole("complementary", { name: "Cleaning panel" }).getByRole("button", { name: "Collapse panel", exact: true });
    const live = gallery.locator(".root > .sr-only[aria-live=polite]");

    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(gallery.getByRole("banner").getByText("Docked", { exact: true })).toHaveCount(0);
    await expect.poll(async () => gallery.locator(".scene-window").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const sheetBounds = element.getRootNode().host.getRootNode().querySelector(".mobile-sheet")?.getBoundingClientRect();
      return sheetBounds ? Math.abs(bounds.bottom - sheetBounds.top) : Number.POSITIVE_INFINITY;
    })).toBeLessThanOrEqual(1);
    await expect(showMore).toHaveAttribute("aria-controls", "sheet-panel");
    await expect(showMore).toBeEnabled();
    await expect(showLess).toBeEnabled();
    await showMore.click();
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await expect(showMore).toBeDisabled();
    await expect(showLess).toBeEnabled();
    await expect(live).toContainText("Cleaning panel, full height");
    await showLess.click();
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await showLess.click();
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await expect(showLess).toBeDisabled();
    await expect(live).toContainText("Cleaning panel, collapsed");
    await expect(gallery.locator("#sheet-panel")).toBeHidden();
    await showMore.click();
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(live).toContainText("Cleaning panel, half height");
    await expect(gallery.locator("#sheet-panel")).toBeVisible();

    // Room choices are immediately visible; long forms start at full height.
    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      document.querySelector(tag).replaceWorkspaceState(module.createGalleryState("rooms"));
    }, GALLERY_TAG);
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(gallery.locator("#sheet-panel")).toBeVisible();
    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      document.querySelector(tag).replaceWorkspaceState({ ...module.createGalleryState("ready"), workflow: "plan" });
    }, GALLERY_TAG);
    // shell.md §5 Sheet: plan Run rests at half, Edit's long form at full.
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      document.querySelector(tag).replaceWorkspaceState({ ...module.createGalleryState("ready"), workflow: "plan", planView: "edit" });
    }, GALLERY_TAG);
    await expect(sheet).toHaveAttribute("data-detent", "full");
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
    await openPlanPicker(gallery);
    await gallery.getByRole("button", { name: /^Daily clean/ }).click();
    await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    // plan.md §3: Delete is in the heading's More actions, which takes focus back.
    const more = gallery.getByRole("button", { name: "More actions" });
    await expect(more).toBeVisible();
    await more.click();
    await gallery.getByRole("menuitem", { name: "Delete" }).click();
    await expect(gallery.getByRole("dialog", { name: "Delete plan?" })).toBeVisible();
    expect(await page.evaluate(() => window.__mapStudioActions)).toEqual([]);
    await gallery.getByRole("dialog", { name: "Delete plan?" }).getByRole("button", { name: "Cancel" }).click();
    await expect(more).toBeFocused();

    await more.click();
    await gallery.getByRole("menuitem", { name: "Delete" }).click();
    await gallery.getByRole("dialog", { name: "Delete plan?" })
      .getByRole("button", { name: "Delete", exact: true }).click();
    await expect(gallery.getByRole("dialog", { name: "Delete plan?" })).toHaveCount(0);
    expect(await page.evaluate(() => window.__mapStudioActions)).toEqual(["delete-plan"]);

    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      const galleryElement = document.querySelector(tag);
      galleryElement.replaceWorkspaceState({
        ...module.createGalleryState("draw-saved"),
        workflow: "areaReview",
      });
    }, GALLERY_TAG);
    const deleteArea = gallery.getByRole("button", { name: "Delete", exact: true });
    await deleteArea.click();
    await gallery.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteArea).toBeFocused();
  });

  test("restores focus after a cancelled dialog on a phone", async ({ page }) => {
    // The desktop inspector and the mobile sheet were both rendered, one hidden
    // with display:none, so #dialogLauncherFor's querySelector picked the hidden
    // copy on narrow and focus() silently did nothing. The wide equivalent of
    // this test passed throughout, because it never ran at this size.
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await expect(gallery.locator(".mobile-sheet")).toBeVisible();

    await openPlanPicker(gallery);
    await gallery.getByRole("button", { name: /^Daily clean/ }).click();
    await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    // Exactly one panel: two meant the launcher lookup could pick the hidden one.
    await expect(gallery.locator("matic-map-workflow-v4")).toHaveCount(1);
    const more = gallery.getByRole("button", { name: "More actions" });
    await expect(more).toBeVisible();
    await more.click();
    await gallery.getByRole("menuitem", { name: "Delete" }).click();
    await expect(gallery.getByRole("dialog", { name: "Delete plan?" })).toBeVisible();
    await gallery.getByRole("dialog", { name: "Delete plan?" }).getByRole("button", { name: "Cancel" }).click();
    await expect(more).toBeFocused();
  });

  test("preserves Draw state through the workspace toggle and restores focus in Escape order", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    // Precision is a brush popover opened from the dock's Brush button; the
    // zoom stepper and the "400% · 0.20 m" chip no longer exist. Zoom is a
    // view concern handled by the map itself.
    const brushButton = gallery.getByRole("button", { name: /^Brush width, 60 cm/ });
    await expect(brushButton).toHaveAttribute("aria-haspopup", "dialog");
    await expect(brushButton).toHaveAttribute("aria-expanded", "false");
    await expect(gallery.getByLabel("Map zoom percent")).toHaveCount(0);
    await brushButton.click();
    await expect(brushButton).toHaveAttribute("aria-expanded", "true");
    const brush = gallery.getByLabel("Brush width in centimeters");
    await expect(brush).toBeVisible();
    await expect(gallery.getByRole("slider", { name: "Brush width slider" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /Zoom in|Zoom out/ })).toHaveCount(0);
    await brush.fill("20");
    await brush.press("Tab");
    await expect.poll(async () => (await snapshot(page)).draw.brushMeters).toBe(0.2);
    await brush.press("Escape");
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(false);
    await expect(gallery.getByRole("button", { name: /^Brush width, 20 cm/ })).toBeFocused();

    const workspaceToggle = gallery.locator(".workspace-toggle");
    await expect(workspaceToggle).toHaveAccessibleName("Full map");
    await expect(workspaceToggle).toHaveAttribute("aria-pressed", "false");
    // Full map asks for browser full screen (D3), where the browser's own
    // Escape would leave both at once; the panel-only order is tested here.
    await page.evaluate(() => { Element.prototype.requestFullscreen = async () => undefined; });
    await workspaceToggle.click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(gallery.locator(".inspector")).toBeHidden();
    await expect(workspaceToggle).toHaveAttribute("aria-pressed", "true");
    const precision = gallery.getByRole("button", { name: /^Brush width, 20 cm/ });
    await expect(precision).toBeVisible();
    await precision.click();
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(true);

    // Escape order: brush field -> Brush button -> expanded map.
    await gallery.getByLabel("Brush width in centimeters").press("Escape");
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(false);
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(precision).toBeFocused();

    await precision.press("Escape");
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);
    await expect.poll(async () => (await snapshot(page)).draw).toMatchObject({
      brushMeters: 0.2,
      dirty: true,
      strokeCount: 3,
    });
    await expect(workspaceToggle).toBeFocused();
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

  // D1 (map-surfaces.md §10): a plain drag moves the map; Shift-drag rotates.
  test("supports a plain-drag move, a Shift-drag orbit, double-click zoom, and keyboard flight", async ({ page }) => {
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
    const afterPan = (await snapshot(page)).cameras.three;
    expect(afterPan.yaw).toBeCloseTo(-Math.PI / 4, 3);
    expect(afterPan.pitch).toBeCloseTo(0.82, 3);

    await page.keyboard.down("Shift");
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 70, centerY - 35, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const afterOrbit = (await snapshot(page)).cameras.three;
    expect(afterOrbit.yaw).not.toBeCloseTo(afterPan.yaw, 3);
    expect(afterOrbit.pitch).not.toBeCloseTo(afterPan.pitch, 3);
    expect(Math.hypot(
      afterOrbit.targetX - afterPan.targetX,
      afterOrbit.targetZ - afterPan.targetZ,
    )).toBeLessThan(0.001);

    const zoomBeforeDoubleClick = afterOrbit.zoom;
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
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    // Help is a non-modal dialog anchored to the rail, not a second
    // complementary landmark: the workspace aside is the only one.
    await expect(gallery.getByRole("complementary")).toHaveCount(1);
    await expect(gallery.getByRole("complementary", { name: "Cleaning panel" })).toBeVisible();
    const help = gallery.getByRole("button", { name: "How to move the map" });
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await expect(help).toHaveAttribute("aria-controls", "navigation-help");
    await help.click();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    const panel = gallery.getByRole("dialog", { name: "How to move the map" });
    await expect(panel).toHaveAttribute("aria-modal", "false");
    await expect(panel).toContainText("Scroll to move the map · pinch to zoom · twist to rotate");
    await expect(panel).toContainText("right-drag or Shift-drag to rotate");
    await expect(panel).toContainText("WASD to move · Q/E or arrows to orbit");
    await expect(gallery.getByRole("complementary")).toHaveCount(1);
    const close = panel.getByRole("button", { name: "Close" });
    await expect(close).toBeFocused();
    await close.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(help).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps workflow navigation and Stop together in the inspector", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "cleaning" });
    // A busy robot demotes the home cards (home-rooms.md §4 H4), so Rooms is
    // opened directly: the view a clean that started from it is left in.
    await gallery.evaluate((element) => element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), workflow: "rooms" }));
    const inspector = gallery.locator(".inspector");
    await expect(inspector.getByRole("button", { name: "Back to all tasks" })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Back to all tasks" })).toHaveText("All tasks");
    const stop = inspector.locator(".status-strip").getByRole("button", { name: "Stop cleaning" });
    await expect(stop).toBeVisible();
    await expect(stop).toHaveText("Stop");
    await expect(inspector.locator(".action-bar").getByRole("button", { name: /Stop/ })).toHaveCount(0);
    await expect(gallery.getByRole("banner").getByText("Cleaning", { exact: true })).toHaveCount(0);
  });

  test("uses one ordered room list for plan selection and per-room settings", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await openPlanPicker(gallery);
    await gallery.getByRole("button", { name: /^Daily clean/ }).click();
    await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    const inspector = gallery.locator(".inspector");
    // plan.md §3 Edit: one list named by its visible "Rooms" heading, the
    // plan's rooms first, then the rest.
    await expect(inspector.getByRole("heading", { name: "Rooms", level: 3, exact: true })).toBeVisible();
    await expect(inspector.getByText("3 of 4 selected", { exact: true })).toBeVisible();
    const list = inspector.getByRole("list", { name: "Rooms", exact: true });
    await expect(list).toHaveCount(1);
    const rows = list.getByRole("listitem");
    await expect(rows).toHaveCount(4);
    await expect(list.getByRole("checkbox", { checked: true })).toHaveCount(3);
    await expect(list.getByRole("checkbox").nth(3)).not.toBeChecked();
    // Settings stay closed until a row is opened, and one row is open at a time.
    await expect(list.getByLabel(/^Cleaning mode for /)).toHaveCount(0);
    const kitchen = list.getByRole("button", { name: "Settings for Kitchen", exact: true });
    await expect(kitchen).toHaveAttribute("aria-expanded", "false");
    await kitchen.click();
    await expect(kitchen).toHaveAttribute("aria-expanded", "true");
    await expect(list.getByLabel(/^Cleaning mode for /)).toHaveCount(1);
    // room-schedule.md §3: the open room shows its Schedule group, headed, not a disclosure.
    const cadenceSettings = list.getByRole("group", { name: "Smart cleaning for Kitchen" });
    await expect(cadenceSettings).toHaveCount(1);
    await expect(cadenceSettings.getByRole("heading", { level: 3, name: "Smart cleaning" })).toBeVisible();
    await expect(cadenceSettings.getByRole("spinbutton", { name: /^(Mop|Occasional mopping)/ })).toHaveAttribute("min", "2");
    await expect(cadenceSettings.getByRole("spinbutton", { name: /vacuum/ })).toHaveAttribute("min", "1");
    await expect(cadenceSettings.getByRole("spinbutton", { name: /vacuum/ })).toHaveAttribute("max", "100");
    const second = list.getByRole("button", { name: /^Settings for / }).nth(1);
    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(kitchen).toHaveAttribute("aria-expanded", "false");
    await expect(list.getByLabel(/^Cleaning mode for /)).toHaveCount(1);
    await second.click();
    await expect(list.getByLabel(/^Cleaning mode for /)).toHaveCount(0);
    // When a run ends FOLLOWS the room list: what to clean, then how it ends.
    const runEnd = inspector.locator("details", { has: page.getByText("When a run ends", { exact: true }) });
    await expect(runEnd).toHaveCount(1);
    expect(await runEnd.evaluate((element) =>
      Boolean(element.compareDocumentPosition(element.parentElement.querySelector('[aria-labelledby="edit-rooms"]')) & Node.DOCUMENT_POSITION_PRECEDING),
    )).toBe(true);
  });

  // The ready plan in Edit, with `patch` over its draft and `extra` over the state.
  const editDaily = async (page, patch = {}, extra = {}) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate(({ tag, patch, extra }) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "plan", planView: "edit", ...extra, planDraft: { ...state.planDraft, ...patch } });
    }, { tag: GALLERY_TAG, patch, extra });
    await settleWorkspace(gallery);
    return { gallery, rooms: gallery.getByRole("list", { name: "Rooms", exact: true }) };
  };

  test("Edit's arrows say when a room is already at an end, keep focus, and announce a move", async ({ page }) => {
    const { gallery, rooms } = await editDaily(page, { runBehavior: "ordered" });
    const state = await snapshot(page);
    const [first, second, last] = state.planDraft.rooms.map((room) =>
      state.resources.plans.value.rooms.find((candidate) => candidate.roomId === room.roomId).name);
    const up = rooms.getByRole("button", { name: `Move ${first} earlier`, exact: true });
    await expect(up).toHaveAttribute("aria-disabled", "true");
    await expect(up).toHaveAccessibleDescription(`${first} is already first`);
    const down = rooms.getByRole("button", { name: `Move ${last} later`, exact: true });
    await expect(down).toHaveAttribute("aria-disabled", "true");
    await expect(down).toHaveAccessibleDescription(`${last} is already last`);
    // An end arrow changes nothing and keeps focus.
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(up).toBeFocused();
    expect((await snapshot(page)).planDraft.rooms.map((room) => room.roomId)).toHaveLength(3);
    const before = (await snapshot(page)).planDraft.rooms.map((room) => room.roomId);
    const later = rooms.getByRole("button", { name: `Move ${first} later`, exact: true });
    await later.focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await snapshot(page)).planDraft.rooms.map((room) => room.roomId)).toEqual([before[1], before[0], before[2]]);
    // Focus stays on the arrow, now in the second row, and the move is said once.
    await expect(rooms.getByRole("button", { name: `Move ${first} later`, exact: true })).toBeFocused();
    await expect(rooms.locator(".pos-badge")).toHaveText(["1", "2", "3"]);
    await expect(rooms.getByRole("button", { name: /^Settings for / }).first()).toHaveAccessibleName(`Settings for ${second}`);
    await expect(gallery.getByRole("status").filter({ hasText: `${first} moved to position 2` })).toHaveCount(1);
  });

  test("opening a room's settings doesn't change whether it is in the plan", async ({ page }) => {
    const { rooms } = await editDaily(page);
    const settings = rooms.getByRole("button", { name: "Settings for Kitchen", exact: true });
    await settings.click();
    await expect(settings).toHaveAttribute("aria-expanded", "true");
    await expect(rooms.getByRole("checkbox", { name: "Include Kitchen", exact: true })).toBeChecked();
    expect((await snapshot(page)).planDraft.rooms).toHaveLength(3);
  });

  test("a room ticked again gets back the settings it had", async ({ page }) => {
    const { rooms } = await editDaily(page, {}, { expandedRoom: "room-a" });
    await rooms.getByRole("combobox", { name: "Cleaning mode for Kitchen", exact: true }).selectOption("vacuum_and_mop");
    const include = rooms.getByRole("checkbox", { name: "Include Kitchen", exact: true });
    await include.uncheck();
    await expect.poll(async () => (await snapshot(page)).planDraft.rooms.map((room) => room.roomId)).not.toContain("room-a");
    // An unticked room shows only its name, with nothing to open.
    await expect(rooms.getByRole("button", { name: "Settings for Kitchen", exact: true })).toHaveCount(0);
    await include.check();
    const kitchen = (await snapshot(page)).planDraft.rooms.find((room) => room.roomId === "room-a");
    expect(kitchen).toMatchObject({ cleaningMode: "vacuum_and_mop" });
    await expect(rooms.getByRole("button", { name: "Settings for Kitchen", exact: true })).toContainText("Vacuum + mop");
  });

  for (const [cadence, line] of [
    [{ mopEveryN: 2, coverageEveryN: null, periodicCoverageSetting: null }, "Mop every 2 cleans"],
    [{ mopEveryN: 1, coverageEveryN: null, periodicCoverageSetting: null }, "Mop every clean"],
    [{ mopEveryN: null, coverageEveryN: 1, periodicCoverageSetting: "quick" }, "Quick vacuum every clean"],
    [{ mopEveryN: null, coverageEveryN: 4, periodicCoverageSetting: "standard" }, "Optimal vacuum every 4 cleans"],
    [{ mopEveryN: 1, coverageEveryN: 3, periodicCoverageSetting: "heavy_duty" }, "Mop every clean · Heavy duty vacuum every 3 cleans"],
    [{ mopEveryN: 5, coverageEveryN: 1, periodicCoverageSetting: "quick" }, "Mop every 5 cleans · Quick vacuum every clean"],
    [{ mopEveryN: 1, coverageEveryN: 1, periodicCoverageSetting: "standard" }, "Mop every clean · Optimal vacuum every clean"],
  ]) {
    test(`an Edit row says its schedule as "${line}"`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready" });
      const rooms = await page.evaluate(({ tag, cadence }) => {
        const element = document.querySelector(tag);
        const state = element.getWorkspaceSnapshot();
        const policy = { scope: "plan", doMopNext: false, doCoverageNext: false, ...cadence };
        const draftRooms = state.planDraft.rooms.map((room, index) => index === 0 ? { ...room, cadence: policy } : room);
        element.replaceWorkspaceState({ ...state, workflow: "plan", planView: "edit", planDraft: { ...state.planDraft, rooms: draftRooms } });
        return draftRooms.length;
      }, { tag: GALLERY_TAG, cadence });
      expect(rooms).toBe(3);
      const settings = gallery.getByRole("button", { name: "Settings for Kitchen", exact: true });
      await expect(settings.getByText(line, { exact: true })).toBeVisible();
      await expect(gallery.getByRole("button", { name: /^Settings for / }).nth(1).locator("small")).toHaveCount(1);
    });
  }

  test("the finish threshold shows only while Finish the current room is on", async ({ page }) => {
    const { gallery } = await editDaily(page, { finishCurrentRoom: false, finishCurrentRoomThreshold: 60 });
    await gallery.getByText("When a run ends", { exact: true }).click();
    const finish = gallery.getByRole("switch", { name: "Finish the current room when you press Stop" });
    await expect(finish).toHaveAttribute("aria-checked", "false");
    await expect(finish).toHaveAccessibleDescription("Only if the room is at least 60% done; otherwise the robot stops right away.");
    await expect(gallery.getByRole("slider")).toHaveCount(0);
    await finish.click();
    await expect(finish).toHaveAttribute("aria-checked", "true");
    const slider = gallery.getByRole("slider", { name: "Finish if at least 60% done" });
    await expect(slider).toHaveAttribute("aria-valuetext", "60%");
    await slider.fill("80");
    await expect.poll(async () => (await snapshot(page)).planDraft.finishCurrentRoomThreshold).toBe(80);
    await expect(gallery.getByRole("slider", { name: "Finish if at least 80% done" })).toHaveAttribute("aria-valuetext", "80%");
    await finish.click();
    await expect(gallery.getByRole("slider")).toHaveCount(0);
    const dock = gallery.getByRole("switch", { name: "Return to the dock when finished" });
    await expect(dock).toHaveAttribute("aria-checked", "true");
    await dock.click();
    expect((await snapshot(page)).planDraft.returnToBase).toBe(false);
  });

  test("a save holds every Edit control with one shared reason", async ({ page }) => {
    const { gallery, rooms } = await editDaily(page, { runBehavior: "ordered", finishCurrentRoom: true, dirty: true },
      { command: "pending", pendingAction: "save-plan", expandedRoom: "room-a" });
    const held = "Waiting for Home Assistant to save the plan.";
    await expect(gallery.getByText(held, { exact: true }).first()).toBeVisible();
    await gallery.getByText("When a run ends", { exact: true }).click();
    const controls = [
      gallery.getByRole("textbox", { name: "Plan name" }),
      gallery.getByRole("group", { name: "Cleaning order" }).getByRole("button", { name: "Intelligent rotation", exact: true }),
      rooms.getByRole("checkbox", { name: "Include Kitchen", exact: true }),
      rooms.getByRole("button", { name: "Settings for Kitchen", exact: true }),
      rooms.getByRole("button", { name: "Move Kitchen later", exact: true }),
      rooms.getByRole("combobox", { name: "Cleaning mode for Kitchen", exact: true }),
      gallery.getByRole("switch", { name: "Return to the dock when finished" }),
      gallery.getByRole("slider"),
    ];
    for (const control of controls) {
      await expect(control).toHaveAttribute("aria-disabled", "true");
      await expect(control).toHaveAccessibleDescription(new RegExp(held.replace(/\./gu, "\\.")));
    }
    const before = await snapshot(page);
    await rooms.getByRole("checkbox", { name: "Include Kitchen", exact: true }).dispatchEvent("click");
    await rooms.getByRole("button", { name: "Move Kitchen later", exact: true }).dispatchEvent("click");
    await gallery.getByRole("switch", { name: "Return to the dock when finished" }).dispatchEvent("click");
    const after = await snapshot(page);
    expect(after.planDraft).toEqual(before.planDraft);
    await expect(rooms.getByRole("checkbox", { name: "Include Kitchen", exact: true })).toBeChecked();
  });

  test("the workflow holds no fieldset; each control says why it is held", async ({ page }) => {
    const { gallery } = await editDaily(page, {}, { command: "pending", pendingAction: "save-plan" });
    await expect(gallery.locator("fieldset")).toHaveCount(0);
    await gallery.evaluate((element) => element.setScenario("rooms"));
    await settleWorkspace(gallery);
    await expect(gallery.locator("fieldset")).toHaveCount(0);
  });

  test("Rooms' choices stay readable but don't change while the robot works", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms" });
    await settleWorkspace(gallery);
    const group = gallery.getByRole("group", { name: "Rooms to clean" });
    const busy = "Can't change rooms until the robot finishes or stops.";
    await expect(gallery.getByText(busy, { exact: true })).toHaveCount(0);
    await expect(group.getByRole("checkbox").first()).not.toHaveAttribute("aria-disabled", "true");
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), activity: "cleaning" });
    }, GALLERY_TAG);
    await expect(gallery.getByText(busy, { exact: true })).toHaveCount(1);
    const choices = group.getByRole("checkbox");
    const count = await choices.count();
    expect(count).toBeGreaterThan(1);
    for (let index = 0; index < count; index += 1) {
      await expect(choices.nth(index)).toHaveAttribute("aria-disabled", "true");
      await expect(choices.nth(index)).toHaveAccessibleDescription(busy);
    }
    const before = (await snapshot(page)).selection.roomIds;
    const wasChecked = await choices.first().isChecked();
    await choices.first().dispatchEvent("click");
    await expect(choices.first()).toBeChecked({ checked: wasChecked });
    expect((await snapshot(page)).selection.roomIds).toEqual(before);
  });

  test("@safety keeps room schedule controls readable in desktop and narrow inspectors", async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 900, narrow: false },
      { width: 390, height: 844, narrow: true },
      { width: 320, height: 700, narrow: true },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const gallery = await loadGallery(page, { scenario: "ready", narrow: viewport.narrow });
      await page.evaluate((tag) => {
        const module = window.__galleryModule;
        const state = module.createGalleryState("ready");
        const catalog = state.resources.plans.value;
        const plan = catalog.plans[0];
        const rooms = plan.rooms.map((room) => room.roomId === "room-a" ? {
          ...room,
          cadence: {
            scope: "shared",
            mopEveryN: 100,
            coverageEveryN: 2,
            periodicCoverageSetting: "heavy_duty",
            doMopNext: false,
            doCoverageNext: false,
          },
        } : room);
        document.querySelector(tag).replaceWorkspaceState({ ...state, resources: {
          ...state.resources,
          plans: { ...state.resources.plans, value: { ...catalog, plans: [{ ...plan, rooms }] } },
        } });
      }, GALLERY_TAG);
      await openPlanPicker(gallery);
      await gallery.getByRole("button", { name: /^Daily clean/ }).click();
      await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
      const rooms = gallery.getByRole("list", { name: "Rooms", exact: true });
      await rooms.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
      const cadence = rooms.getByRole("group", { name: "Smart cleaning for Kitchen" });
      const mopInterval = cadence.getByRole("spinbutton", { name: "Mop every 100 cleans" });
      const coverageInterval = cadence.getByRole("spinbutton", { name: "Heavy duty vacuum every 2 cleans" });
      const coverage = cadence.getByLabel("Vacuum level for Kitchen");
      await expect(mopInterval).toHaveValue("100");
      await expect(coverageInterval).toHaveValue("2");
      await expect(coverage).toHaveValue("heavy_duty");
      // Every control sits inside the room card, at least 44 px, with no sideways scroll.
      const layout = await cadence.evaluate((settings) => {
        const bounds = settings.getBoundingClientRect();
        const fields = [...settings.querySelectorAll(".ms-stepper button, .ms-stepper input, .sched-row select")].map((control) => {
          const rect = control.getBoundingClientRect();
          return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
        });
        return { clientWidth: settings.clientWidth, scrollWidth: settings.scrollWidth,
          fields: fields.map((field) => ({ ...field, inside: field.left >= bounds.left - 1 && field.right <= bounds.right + 1 })) };
      });
      expect(layout.fields).toHaveLength(7);
      expect(layout.fields.every((field) => field.width >= 44 && field.height >= 44 && field.inside), JSON.stringify({ ...viewport, layout })).toBe(true);
      expect(layout.scrollWidth, JSON.stringify({ ...viewport, layout })).toBeLessThanOrEqual(layout.clientWidth + 1);
    }
  });

  test("keeps plan choices available after catalog loading", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await openPlanPicker(gallery);
    const choice = gallery.getByRole("button", { name: /^Daily clean/ });
    await expect(choice).toBeVisible();
    await expect(gallery.getByRole("textbox", { name: "Plan name" })).toHaveCount(0);

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const current = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...current,
        resources: {
          ...current.resources,
          plans: { status: "loading", value: null, problem: null },
        },
      });
    }, GALLERY_TAG);
    await expect(gallery.getByRole("status")).toContainText("Loading rooms and plans…");
    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      const element = document.querySelector(tag);
      const current = element.getWorkspaceSnapshot();
      const ready = module.createGalleryState("ready");
      element.replaceWorkspaceState({
        ...current,
        resources: { ...current.resources, plans: ready.resources.plans },
      });
    }, GALLERY_TAG);
    await expect(choice).toBeVisible();
  });

  test("uses task-specific loading, empty, and error messages", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        workflow: "plan",
        resources: { ...state.resources, plans: { status: "loading", value: null, problem: null } },
      });
    }, GALLERY_TAG);
    await expect(gallery.getByRole("status")).toContainText("Loading rooms and plans…");

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        workflow: "areas",
        resources: { ...state.resources, areas: { status: "empty", value: null, problem: null } },
      });
    }, GALLERY_TAG);
    await expect(gallery.getByRole("heading", { level: 3, name: "No custom areas yet" })).toBeVisible();

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        workflow: "history",
        resources: { ...state.resources, history: { status: "error", value: null, problem: "request-failed" } },
      });
    }, GALLERY_TAG);
    // The shell's static alert region is always present, so filter to the panel's message.
    await expect(gallery.getByRole("alert").filter({ hasText: "Map history is unavailable" })).toHaveText("Map history is unavailable right now.");
  });

  test("asks before switching floors with an unsaved custom-area draft", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    const floor = gallery.getByLabel("Choose floor", { exact: true });
    await floor.selectOption("saved-1");

    await expect(gallery.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    expect(await snapshot(page)).toMatchObject({
      dataMode: "live",
      workflow: "draw",
      floor: { readOnly: false },
      draw: { dirty: true },
    });
    await gallery.getByRole("dialog", { name: "Discard changes?" }).press("Escape");
    await expect(gallery.getByRole("dialog", { name: "Discard changes?" })).toHaveCount(0);
    await expect(floor).toHaveValue("current");
    expect(await snapshot(page)).toMatchObject({
      dataMode: "live",
      workflow: "draw",
      draw: { dirty: true },
    });

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        workflow: "areaReview",
        draw: { ...state.draw, dirty: false },
        areaDraft: { ...state.areaDraft, dirty: true },
      });
    }, GALLERY_TAG);
    await gallery.getByRole("button", { name: "Redraw" }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
    await floor.selectOption("saved-1");
    await expect(gallery.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    await gallery.getByRole("button", { name: "Keep editing" }).click();
    await expect(floor).toHaveValue("current");
    expect(await snapshot(page)).toMatchObject({
      dataMode: "live",
      workflow: "draw",
      areaDraft: { dirty: true },
    });
  });

  test("falls back to selection copy when the Clipboard API rejects an HTTP origin", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "support" });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
      });
      window.__legacyCopies = [];
      document.execCommand = (command) => {
        const textarea = document.querySelector('textarea[aria-hidden="true"]');
        window.__legacyCopies.push({ command, value: textarea?.value || "" });
        return command === "copy";
      };
    }, GALLERY_TAG);
    const copyButton = gallery.getByRole("button", { name: "Copy summary" });
    await copyButton.click();
    await expect(gallery.getByRole("status")).toHaveText("Copied");
    await expect(copyButton).toBeFocused();
    expect(await page.evaluate(() => window.__legacyCopies)).toEqual([{
      command: "copy",
      value: expect.stringContaining("Connection: Connected"),
    }]);
    expect(await page.evaluate(() => ({
      temporaryTextareas: document.querySelectorAll('textarea[aria-hidden="true"]').length,
      containsPrivateNames: window.__legacyCopies[0].value.includes("House")
        || window.__legacyCopies[0].value.includes("Kitchen"),
    }))).toEqual({ temporaryTextareas: 0, containsPrivateNames: false });
  });

  test("opens Custom areas on a blank draft and preserves only an explicit edit", async ({ page }) => {
    const scene = syntheticScene("Room", 10);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
    await page.evaluate(async (sceneBytes) => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
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
          if (path === entry.areas_url) {
            return new Response(JSON.stringify({
              scene_url: entry.scene_url,
              rooms: [{
                room_id: "room-1",
                name: "Room",
                boundary: [[0, 0], [4, 0], [4, 4], [0, 4]],
              }],
              areas: [{
                id: "saved-area",
                name: "Saved area",
                circles: [{ x: 1, y: 1, radius: 0.3 }],
                cleaning_mode: "vacuum",
                coverage_setting: "standard",
                status: "current",
                can_rebind: false,
              }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("", { status: 404 });
        },
      };
      document.body.append(panel);
      window.__areaPanel = panel;
    }, [...scene]);
    await expect.poll(async () => page.evaluate(() =>
      window.__areaPanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");

    const dispatch = (detail) => page.evaluate((intent) => {
      const shell = window.__areaPanel.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: intent,
        bubbles: true,
        composed: true,
      }));
    }, detail);

    await dispatch({ type: "open-workflow", workflow: "draw" });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__areaPanel.getWorkspaceSnapshot();
      return {
        status: state.resources.areas.status,
        areaId: state.selection.areaId,
        circles: state.draw.circles.length,
      };
    })).toEqual({ status: "ready", areaId: null, circles: 0 });

    await dispatch({ type: "select-area", areaId: "saved-area" });
    await dispatch({ type: "open-workflow", workflow: "areaReview" });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__areaPanel.getWorkspaceSnapshot();
      return { workflow: state.workflow, areaId: state.selection.areaId, circles: state.draw.circles.length };
    })).toEqual({ workflow: "areaReview", areaId: "saved-area", circles: 1 });

    await dispatch({ type: "open-workflow", workflow: "draw" });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__areaPanel.getWorkspaceSnapshot();
      return { workflow: state.workflow, areaId: state.selection.areaId, circles: state.draw.circles.length };
    })).toEqual({ workflow: "draw", areaId: "saved-area", circles: 1 });

    await dispatch({ type: "open-workflow", workflow: "none" });
    await dispatch({ type: "open-workflow", workflow: "draw" });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__areaPanel.getWorkspaceSnapshot();
      return { workflow: state.workflow, areaId: state.selection.areaId, circles: state.draw.circles.length };
    })).toEqual({ workflow: "draw", areaId: null, circles: 0 });
    await page.evaluate(() => window.__areaPanel.remove());
  });

  test("keeps Stop reachable while paused and strips transition expanded map to safety controls @safety", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "paused" });
    await gallery.getByRole("button", { name: "Full map", exact: true }).click();
    await expect(gallery.getByRole("button", { name: "Resume cleaning" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Stop cleaning" })).toBeVisible();

    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      const galleryElement = document.querySelector(tag);
      galleryElement.replaceWorkspaceState({
        ...module.createGalleryState("transition"),
        fullMap: true,
      });
    }, GALLERY_TAG);
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(gallery.locator(".map-tools button")).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Exit full map", exact: true })).toBeVisible();
    await expect(gallery.locator(".full-map-hud")).toContainText("Locating");
    // The canvas card stays while Locating (map-surfaces.md §4 Full map, Locating).
    await expect(gallery.locator(".map-message")).toContainText("Locating");
  });

  test("uses identical map math for the brush cursor and scale", async ({ page }) => {
    await page.goto("/");
    const combinations = await page.evaluate(async () => {
      const module = await import("/map_studio_v4-review/review.js");
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

  const DRAW_TOOL_NAMES = ["Points", "Paint", "Erase", "Move map", "Undo", "Redo", "Clear", /^Brush width, 60 cm/];

  async function expectDrawTools(gallery, tools) {
    await expect(tools).toHaveCount(8);
    for (let index = 0; index < 8; index += 1) {
      const tool = tools.nth(index);
      await expect(tool).toHaveAccessibleName(DRAW_TOOL_NAMES[index]);
      const bounds = await tool.boundingBox();
      expect(bounds.width, `tool ${index} width`).toBeGreaterThanOrEqual(44);
      expect(bounds.height, `tool ${index} height`).toBeGreaterThanOrEqual(44);
    }
    // Paint, Erase and Move map are toggles (aria-pressed), never radios;
    // exactly one is pressed and Paint is the default.
    await expect(tools.locator('[aria-checked], [role="radio"]')).toHaveCount(0);
    await expect(gallery.locator('.draw-tools button[aria-pressed="true"]')).toHaveCount(1);
    await expect(gallery.locator('.draw-tools button[aria-pressed="true"]')).toHaveAccessibleName("Paint");
    await expect(gallery.getByRole("button", { name: "Done editing" })).toHaveCount(0);
  }

  for (const width of [320, 390]) {
    test(`fits all eight 44px Draw tools inside the sheet without horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      const gallery = await loadGallery(page, { scenario: "draw", narrow: true });
      const toolbar = gallery.locator(".draw-tools");
      await expect(toolbar).toHaveCount(1);
      await expect(toolbar).toHaveRole("toolbar");
      await expect(toolbar).toHaveAccessibleName("Draw area tools");
      await expect(toolbar).toHaveClass(/draw-tools--grid/);
      await expectDrawTools(gallery, toolbar.locator("button"));
      expect(await page.evaluate((limit) => document.documentElement.scrollWidth <= limit, width)).toBe(true);
      // On a phone the sheet owns the tools: they live inside .mobile-sheet
      // (in .sheet-tools, above the body) rather than floating over the map.
      expect(await toolbar.evaluate((element) => Boolean(element.closest(".sheet-tools")?.closest(".mobile-sheet")))).toBe(true);
      const sheet = await gallery.locator(".mobile-sheet").boundingBox();
      const drawTools = await toolbar.boundingBox();
      expect(drawTools.y).toBeGreaterThanOrEqual(sheet.y - 1);
      expect(drawTools.y + drawTools.height).toBeLessThanOrEqual(sheet.y + sheet.height + 1);
      await expect(gallery.locator("matic-map-canvas-v4 .draw-tools")).toHaveCount(0);
    });
  }

  test("docks the eight Draw tools on the map without overlapping the inspector at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    const dock = gallery.locator("matic-map-canvas-v4 .map-dock");
    await expect(dock).toHaveCount(1);
    const toolbar = dock.locator(".draw-tools");
    await expect(toolbar).toHaveRole("toolbar");
    await expect(toolbar).toHaveClass(/draw-tools--row/);
    await expectDrawTools(gallery, toolbar.locator("button"));
    await expect(gallery.locator(".sheet-tools")).toHaveCount(0);
    const dockBounds = await dock.boundingBox();
    const inspector = await gallery.locator(".inspector").boundingBox();
    const overlaps = dockBounds.x < inspector.x + inspector.width
      && dockBounds.x + dockBounds.width > inspector.x
      && dockBounds.y < inspector.y + inspector.height
      && dockBounds.y + dockBounds.height > inspector.y;
    expect(overlaps, `dock ${JSON.stringify(dockBounds)} vs inspector ${JSON.stringify(inspector)}`).toBe(false);
  });

  test("uses modern map display controls without compromising the map-first shell", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });

    await gallery.getByRole("complementary", { name: "Cleaning panel" })
      .getByRole("button", { name: /^Clean rooms Pick rooms and clean them now\./ }).click();
    await gallery.getByRole("button", { name: "2D", exact: true }).click();
    const appearance = gallery.getByRole("group", { name: "Map style" });
    await expect(appearance.getByRole("button")).toHaveText(["Photo", "Room colors"]);
    await appearance.getByRole("button", { name: "Room colors", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).appearance).toBe("rooms");
    await expect(appearance.getByRole("button", { name: "Room colors" })).toHaveAttribute("aria-pressed", "true");

    const options = gallery.getByRole("button", { name: "Map options" });
    await expect(options).toHaveAttribute("aria-controls", "map-options");
    await options.click();
    await expect(options).toHaveAttribute("aria-expanded", "true");
    // Map options is a menu (home-rooms.md §5 Display): the detail choice is
    // a radio group inside it, and a choice leaves the menu open.
    const menu = gallery.getByRole("menu", { name: "Map options" });
    await expect(menu.getByRole("group", { name: "Map detail" })).toBeVisible();
    await menu.getByRole("menuitemradio", { name: "Maximum" }).click();
    await expect.poll(async () => (await snapshot(page)).quality).toBe("maximum");
    await expect(menu.getByRole("menuitemradio", { name: "Maximum" })).toHaveAttribute("aria-checked", "true");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(options).toBeFocused();

    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    await gallery.getByRole("button", { name: "Rotate right" }).click();
    await expect.poll(async () => (await snapshot(page)).cameras.three?.yaw ?? null)
      .not.toBeNull();
  });

  test("makes the first cleaning decision explicit without a phantom Run plan action", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });

    const navigation = gallery.getByRole("button", { name: "Open Home Assistant sidebar" });
    await expect(navigation).toBeVisible();
    await page.evaluate((tag) => {
      window.__navigationToggles = 0;
      document.querySelector(tag).addEventListener("hass-toggle-menu", () => {
        window.__navigationToggles += 1;
      });
    }, GALLERY_TAG);
    await navigation.click();
    expect(await page.evaluate(() => window.__navigationToggles)).toBe(1);

    await expect(gallery.getByRole("heading", { name: "Choose what to clean", level: 2 })).toBeVisible();
    await expect(gallery.getByLabel("Choose robot")).toHaveCount(0);
    await expect(gallery.getByLabel("Choose floor", { exact: true })).toBeVisible();
    await expect(gallery.getByLabel("Choose floor", { exact: true })).toHaveAttribute("name", "map-floor");
    await expect(gallery.getByLabel("Choose floor", { exact: true })).toBeEnabled();
    await expect(gallery.getByLabel("Choose floor", { exact: true }).locator("option"))
      .toHaveText(["House", "Shed", "Annex · No saved map for this floor yet"]);
    await expect(gallery.getByLabel("Choose floor", { exact: true }).locator('option[value="saved-2"]'))
      .toBeDisabled();
    // Three task cards, then the Maps group (home-rooms.md §3). The entry never offers a
    // phantom "Run plan" before a plan has been chosen.
    const quick = gallery.getByRole("group", { name: "Cleaning choices" }).getByRole("button");
    await expect(quick).toHaveCount(3);
    await expect(quick.nth(0)).toHaveAccessibleName(/^Clean rooms Pick rooms and clean them now\./);
    await expect(quick.nth(0)).not.toHaveClass(/ms-row--featured/);
    // The default plan pinned as a one-tap shortcut under Shortcuts, then the
    // custom-area card and the Your plans row (UX9 owner ruling).
    await expect(gallery.getByRole("group", { name: "Shortcuts" }).getByRole("button")).toHaveAccessibleName(/^Run Daily clean 3 rooms/);
    await expect(quick.nth(1)).toHaveAccessibleName(/^Clean custom area Draw or choose a custom area/);
    await expect(quick.nth(2)).toHaveAccessibleName("Your plans");
    await expect(gallery.getByRole("heading", { name: "Maps", level: 3 })).toBeVisible();
    await expect(gallery.locator(".maps").getByRole("button", { name: /^Map history Browse earlier floor maps\./ })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /^Run plan/ })).toHaveCount(0);
    // The launcher and the Rooms strip action share "Clean rooms"; each view holds only one.
    await expect(gallery.getByRole("button", { name: /^Clean rooms/ })).toHaveCount(1);

    await gallery.getByLabel("Choose floor", { exact: true }).selectOption("saved-1");
    await expect.poll(async () => (await snapshot(page)).selection.floorId).toBe("saved-1");
    await gallery.getByLabel("Choose floor", { exact: true }).selectOption("current");
    await expect.poll(async () => (await snapshot(page)).selection.floorId).toBe("current");

    await gallery.getByRole("button", { name: /^Clean rooms Pick rooms and clean them now\./ }).click();
    await expect(gallery.getByRole("heading", { name: "Choose rooms" })).toBeVisible();
    // Disabled actions stay focusable and explain themselves: aria-disabled
    // plus an aria-describedby reason, which is stronger than `disabled`.
    const cleanRooms = gallery.getByRole("button", { name: "Clean rooms", exact: true });
    await expect(cleanRooms).toHaveCount(1);
    // A leaked launcher ("Clean rooms Pick rooms and clean them now.") would not match the exact name.
    await expect(gallery.getByRole("button", { name: /^Clean rooms/ })).toHaveCount(1);
    await expect(cleanRooms).toHaveAttribute("aria-disabled", "true");
    await expect(cleanRooms).toHaveAccessibleDescription(/room/i);
    await expect(cleanRooms).not.toHaveAttribute("disabled");
  });

  test("keeps the plan action honest while saved plans are loading", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      const element = document.querySelector(tag);
      const state = module.createGalleryState("ready");
      element.replaceWorkspaceState({
        ...state,
        resources: {
          ...state.resources,
          plans: { status: "loading", value: null, problem: null },
        },
      });
    }, GALLERY_TAG);

    // Publish cleaning choices together after their pinned metadata settles.
    await expect(gallery.getByRole("button", { name: /^Run Daily clean/ })).toHaveCount(0);
    await expect(gallery.getByText("Loading your saved home choices…", { exact: true })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Your plans", exact: true })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: /Create a plan/ })).toHaveCount(0);
    await page.evaluate((tag) => {
      document.querySelector(tag).replaceWorkspaceState(window.__galleryModule.createGalleryState("ready"));
    }, GALLERY_TAG);
    await expect(gallery.getByText("Loading your saved home choices…", { exact: true })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Your plans", exact: true })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /^Run Daily clean/ })).toBeVisible();
  });

  test("retries a plan catalog after a transient floor-recheck conflict", async ({ page }) => {
    const scene = syntheticScene("Current room", 18);
    let plansRequests = 0;
    let releaseScene = () => {};
    const sceneReady = new Promise((resolve) => {
      releaseScene = resolve;
    });
    let releasePlanRecovery = () => {};
    const planRecovery = new Promise((resolve) => {
      releasePlanRecovery = resolve;
    });
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
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [entry] }),
    }));
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", async (route) => {
      await sceneReady;
      return route.fulfill({
        status: 200,
        body: scene,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": "1",
          "X-Matic-Floor-Coherent": "1",
        },
      });
    });
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        position: [18, 12],
        source: "latest_pose",
        revision: 1,
        pose_revision: 1,
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
      if (plansRequests === 0) {
        plansRequests = 1;
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          headers: { "X-Matic-Plans-Conflict": "map-rechecking" },
          body: "{}",
        });
      }
      await planRecovery;
      plansRequests = 2;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rooms: [{ room_id: "room-1", name: "Current room" }],
          plans: [],
          selected_plan: null,
        }),
      });
    });
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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
      window.__transientPlansPanel = panel;
    });
    // Let the scene settle only after the panel is mounted. The first plans
    // request starts from the scene's authoritative success path, so the
    // transient conflict cannot be hidden by a simultaneous retry.
    releaseScene();
    await expect.poll(() => plansRequests).toBe(1);
    await expect.poll(async () => page.evaluate(() =>
      window.__transientPlansPanel.getWorkspaceSnapshot().resources.plans.problem)).toBe("map-rechecking");
    // The catalog poll is the authoritative next coherence check. It should
    // recover the transient 409 without requiring the user to open the plan.
    // Hold the recovery response until the intermediate state is observed so
    // this assertion cannot race the production retry path.
    releasePlanRecovery();
    await expect.poll(() => plansRequests, { timeout: 8_000 }).toBe(2);
    await expect.poll(async () => page.evaluate(() =>
      window.__transientPlansPanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
    await page.evaluate(() => window.__transientPlansPanel.remove());
  });

  test("keeps first-use supporting copy at AA contrast in light and dark themes", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.addScriptTag({
      type: "module",
      content: `
        import { createGalleryState, withGalleryRoomPreview } from "/map_studio_v4-review/review.js";
        const rooms = createGalleryState("rooms");
        const roomIds = ["room-a", "room-b"];
        window.__contrastGalleryStates = {
          preview: withGalleryRoomPreview({
            ...rooms,
            selection: {
              ...rooms.selection,
              roomIds,
              roomSettings: roomIds.map((roomId) => ({
                roomId,
                cleaningMode: "vacuum",
                coverageSetting: "standard",
              })),
            },
          }),
          empty: { ...rooms, selection: { ...rooms.selection, roomIds: [] } },
        };
      `,
    });

    const contrastRatios = async (selector) => gallery.locator(selector).evaluateAll((elements) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      // Computed transition colours may use oklab, not RGB. Let the browser
      // resolve CSS colours to sRGB before applying the WCAG luminance formula.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const luminance = (color) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = context.getImageData(0, 0, 1, 1).data;
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
      };
      // Walk up to the first ancestor that actually paints a background, so
      // text that sits directly on a surface (.action-reason, .action-summary,
      // .sheet-status) is measured against what it is really drawn over.
      const painted = (element) => {
        let node = element.closest("button, select") ?? element.parentElement;
        while (node && node !== document.body) {
          const color = getComputedStyle(node).backgroundColor;
          if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
          node = node.parentElement ?? node.getRootNode()?.host ?? null;
        }
        return "rgb(255, 255, 255)";
      };
      return elements.map((element) => {
        const foreground = luminance(getComputedStyle(element).color);
        const background = luminance(painted(element));
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });
    // evaluateAll does not wait, and the Draw list renders in the lazily
    // loaded workflow chunk, so wait for the rows before measuring them.
    const expectContrast = async (selector) => {
      await gallery.locator(selector).first().waitFor();
      const ratios = await contrastRatios(selector);
      expect(ratios.length, `${selector} rendered`).toBeGreaterThan(0);
      expect(Math.min(...ratios), `${selector} contrast ${JSON.stringify(ratios)}`).toBeGreaterThanOrEqual(4.5);
    };
    const sweep = async () => {
      await gallery.evaluate((element) => element.setScenario("ready"));
      await expectContrast(".quick-actions .ms-row__body small");
      await expectContrast(".floor-switcher");
      await gallery.evaluate((element) => {
        element.replaceWorkspaceState(window.__contrastGalleryStates.preview);
      });
      await expectContrast(".action-summary");
      await gallery.evaluate((element) => {
        element.replaceWorkspaceState(window.__contrastGalleryStates.empty);
      });
      await expectContrast(".action-reason");
      // Your areas' rows (UX9): the setting line and the warning line.
      await gallery.evaluate((element) => element.setScenario("areas-list"));
      await expectContrast(".area-row small");
      await expectContrast(".area-row .line");
      await gallery.evaluate((element) => element.setScenario("draw"));
      await expectContrast(".draw-hint");
      await gallery.evaluate((element) => { element.narrow = true; element.setScenario("rooms"); });
      await expectContrast(".sheet-status");
      await gallery.evaluate((element) => { element.narrow = false; });
    };

    await sweep();
    await gallery.evaluate((element) => {
      element.style.setProperty("--card-background-color", "#11181c");
      element.style.setProperty("--secondary-background-color", "#192126");
      element.style.setProperty("--primary-text-color", "#f1f5f7");
      element.style.setProperty("--secondary-text-color", "#a8b5bc");
      element.style.setProperty("--primary-color", "#42a5f5");
    });
    await sweep();
  });

  test("honors reduced motion and announces a fail-closed map transition", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await expect(gallery.locator(".mobile-sheet")).toHaveCSS("transition-duration", "0s");
    const mapLive = gallery.locator("matic-map-canvas-v4 [aria-live=polite]");
    await expect(mapLive).toContainText("Live map");

    await gallery.evaluate((element) => element.setScenario("transition"));
    // The canvas chip carries no live role; the shell's polite region announces
    // the status title change (shell.md §4 rule 6).
    await expect(gallery.locator("matic-map-canvas-v4 .map-message")).toContainText("Locating");
    await expect(gallery.locator(".root > .sr-only[aria-live=polite]")).toHaveText("Locating");
    // Locating has no footer button (shell.md §2 row 8); the sheet body gives
    // the reason once, under the heading, and the held cards point at it
    // (home-rooms.md §4 H3).
    await expect(gallery.getByRole("button", { name: "Finding the map" })).toHaveCount(0);
    await expect(gallery.locator("#home-reason")).toHaveText("Waiting for the robot to confirm which floor it is on.");
    await expect(gallery.getByRole("button", { name: /^Clean rooms/ }))
      .toHaveAccessibleDescription("Waiting for the robot to confirm which floor it is on.");
    await expect(mapLive).toContainText("not available");
  });

  test("distinguishes selected rows in every list", async ({ page }) => {
    // Selected state lives on .ms-row[data-selected="true"], so a row that
    // misses the class keeps the attribute and loses the distinction. Counting
    // [data-selected] rows cannot see that, which is how the plan room list
    // shipped looking identical whether a room was in the plan or not.
    const gallery = await loadGallery(page, { scenario: "ready" });
    await openPlanPicker(gallery);
    await gallery.getByRole("button", { name: /^Daily clean/ }).click();
    await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    const inspector = gallery.locator(".inspector");
    const rows = inspector.getByRole("list", { name: "Rooms", exact: true }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    const distinct = await rows.evaluateAll((elements) => {
      const shade = (element) => {
        const style = getComputedStyle(element);
        return `${style.backgroundColor}|${style.borderTopColor}`;
      };
      const on = elements.filter((element) => element.dataset.selected === "true").map(shade);
      const off = elements.filter((element) => element.dataset.selected !== "true").map(shade);
      return on.length > 0 && off.length > 0 && !on.some((value) => off.includes(value));
    });
    expect(distinct).toBe(true);
  });

  test("gives the map status overlay a readable surface", async ({ page }) => {
    // The overlay sits directly on the map, including the photo view, so it
    // needs its own background. It once inherited one from a shared rule that
    // also styled the toolbars; when that rule was replaced by a class, every
    // toolbar was updated and this was missed, and nothing failed because the
    // other assertions on .map-message only check presence and text.
    const gallery = await loadGallery(page, { scenario: "ha-offline" });
    const state = await snapshot(page);
    await gallery.evaluate((element, map) => element.replaceWorkspaceState({
      ...element.getWorkspaceSnapshot(), map: { ...map, available: false },
    }), state.map);
    const message = gallery.locator("matic-map-canvas-v4 .map-message");
    await expect(message).toBeVisible();
    const surface = await message.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.borderTopWidth,
        shadow: style.boxShadow,
      };
    });
    expect(surface.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(surface.border).not.toBe("0px");
    expect(surface.shadow).not.toBe("none");
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
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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
      const rooms = shell.shadowRoot.querySelector('[data-launcher="rooms"]');
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

  test("drags the sheet grip without re-reading canvas geometry", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await shimPointerCapture(page);
    await page.goto("/");
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getBoundingClientRect;
      window.__canvasRectReads = 0;
      HTMLCanvasElement.prototype.getBoundingClientRect = function measuredBounds() {
        window.__canvasRectReads += 1;
        return original.call(this);
      };
    });
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
    await page.evaluate(async (tag) => {
      await customElements.whenDefined(tag);
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = "ready";
      gallery.narrow = true;
      document.body.style.margin = "0";
      document.body.append(gallery);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, GALLERY_TAG);
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery.locator(".sheet-grip")).toBeVisible();

    // Dispatched from inside the page: every Playwright locator action walks
    // the DOM and measures elements (canvases included), which would be
    // counted against the app. A drag translates the sheet; only the
    // committed detent on release may relayout the canvas.
    const reads = await gallery.evaluate(async (element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const grip = shell.shadowRoot.querySelector(".sheet-grip");
      const bounds = grip.getBoundingClientRect();
      const x = bounds.left + 160;
      const y = bounds.top + 20;
      const touch = (type, clientY) => grip.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 11, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY,
      }));
      const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await frames();
      window.__canvasRectReads = 0;
      touch("pointerdown", y);
      for (let index = 1; index <= 20; index += 1) touch("pointermove", y - index * 8);
      await frames();
      const duringDrag = window.__canvasRectReads;
      const transform = shell.shadowRoot.querySelector(".mobile-sheet").style.transform;
      touch("pointerup", y - 160);
      await frames();
      return { duringDrag, transform, afterRelease: window.__canvasRectReads - duringDrag };
    });
    expect(reads.transform).toMatch(/translateY\(-\d+/);
    expect(reads.duringDrag, JSON.stringify(reads)).toBeLessThanOrEqual(2);
    await expect(gallery.locator(".mobile-sheet")).toHaveAttribute("data-detent", "full");
  });

  test("clears a drawn area reversibly and exposes official cleaning-mode wording", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const before = await snapshot(page);
    expect(before.draw.circles.length).toBeGreaterThan(0);

    // Clear is a tool in the toolbar (map-surfaces.md §5), undoable, so the
    // action bar carries only Cancel and the primary.
    await expect(gallery.locator(".action-bar").getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
    const clear = gallery.getByRole("toolbar", { name: "Draw area tools" }).getByRole("button", { name: "Clear", exact: true });
    await expect(clear).toBeEnabled();
    await clear.click();
    await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBe(0);
    await expect(clear).toBeDisabled();
    await gallery.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).draw.circles.length)
      .toBe(before.draw.circles.length);

    await gallery.evaluate((element) => element.setScenario("rooms"));
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("rooms");
    const inspector = gallery.locator(".inspector");
    await expect(inspector.getByLabel(/^Cleaning mode for /)).toHaveCount(0);
    await inspector.getByRole("checkbox", { name: /^Kitchen/ }).check();
    // home-rooms.md §4 R3: a selected room's own settings open from its row.
    await expect(inspector.getByLabel(/^Cleaning mode for /)).toHaveCount(0);
    await inspector.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
    await expect(inspector.getByLabel(/^Cleaning mode for /)).toBeVisible();
    await expect(inspector.getByLabel(/^Cleaning mode for /)).toHaveValue("vacuum");
    const mode = inspector.getByLabel(/^Vacuum coverage for /);
    await expect(mode).toHaveValue("standard");
    await expect(mode.locator("option")).toHaveText(["Quick", "Optimal", "Heavy duty"]);
    await mode.selectOption("heavy_duty");
    const cleaningSystem = inspector.getByLabel(/^Cleaning mode for /);
    await cleaningSystem.selectOption("mop");
    await expect(mode).toHaveCount(0);
    await expect(inspector.getByRole("switch", { name: "Double-pass mopping" })).toBeVisible();
    await cleaningSystem.selectOption("vacuum_and_mop");
    await expect(mode).not.toHaveAttribute("aria-disabled", "true");
    await expect(mode).toHaveValue("heavy_duty");
  });

  test("selects a requested robot deterministically", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4-review/review.js");
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
      const module = await import("/map_studio_v4-review/review.js");
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
      action: { id: "stop", label: "Stop", labelKey: "v4_action_stop", kind: "danger", enabled: true },
      canStart: false,
    });

    const gallery = await loadGallery(page, { scenario: "recharging" });
    await expect(gallery).toContainText("Charging to resume");
    await expect(gallery).toContainText("18% battery");
    const stop = gallery.getByRole("button", { name: "Stop cleaning", exact: true });
    await expect(stop).toBeVisible();
    await expect(stop).toHaveText("Stop");
    await expect(stop).not.toHaveAttribute("aria-disabled", "true");
  });

  test("hides the robot selector when non-vacuum Matic entities have stale entry metadata", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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
        v4_how_to_move: "Cómo mover el mapa",
        v4_full_map: "Mapa completo",
        v4_trackpad: "Panel táctil",
        v4_trackpad_help: "Desplázate para mover · pellizca para ampliar · gira para rotar",
        v4_clean_rooms: "Limpiar habitaciones",
        v4_action_clean_rooms: "Limpiar las habitaciones elegidas",
        v4_reason_clean_rooms_empty: "Elige al menos una habitación.",
        v4_map_workspace: "Espacio de trabajo del mapa",
        v4_robot_status_and_action: "Estado y acción del robot",
      };
      shell.localize = (key) => strings[key.split(".").at(-1)] || key;
      shell.requestUpdate();
    });
    await expect(gallery.getByRole("heading", { name: "Mapa Matic" })).toBeVisible();
    await expect(gallery.getByRole("complementary", { name: "Espacio de trabajo del mapa", exact: true })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Mapa completo" })).toBeVisible();
    const help = gallery.getByRole("button", { name: "Cómo mover el mapa" });
    await help.click();
    await expect(gallery.getByRole("dialog", { name: "Cómo mover el mapa" }))
      .toContainText("Panel táctil");
    await expect(gallery.getByRole("dialog", { name: "Cómo mover el mapa" }))
      .toContainText("Desplázate para mover");
    await gallery.getByRole("dialog", { name: "Cómo mover el mapa" }).getByRole("button").press("Escape");
    // Action labels and their disabled reasons resolve through the same
    // localize hook, so a translated shell never mixes in English actions.
    await gallery.getByRole("button", { name: /^Limpiar habitaciones/ }).click();
    const clean = gallery.getByRole("button", { name: "Limpiar las habitaciones elegidas" });
    await expect(clean).toHaveAttribute("aria-disabled", "true");
    await expect(clean).toHaveAccessibleDescription("Elige al menos una habitación.");
  });

  for (const translated of [false, true]) {
    for (const [scenario, selector, dialog] of [
      ["home-shortcuts", '[data-launcher^="run:plan:"] small'],
      ["plans", "[data-plan-row] small"],
      ["plan-saved-intelligent", ".summary"],
      ["plan-edit-ordered", ".list-header small"],
      ["plan-dirty", "#dialog-title", "discardDraft"],
    ]) {
      test(`RTL copy isolates ${scenario} with ${translated ? "Arabic translation" : "English fallback"}`, async ({ page }) => {
        const gallery = await loadGallery(page, { scenario });
        await settleWorkspace(gallery);
        await gallery.evaluate((element, { translated, dialog }) => {
          document.documentElement.dir = "rtl";
          const state = element.getWorkspaceSnapshot();
          element.replaceWorkspaceState({ ...state, locale: "ar", ...(dialog ? { dialog } : {}) });
          if (translated) {
            element.localize = (key) => {
              const name = key.split(".").at(-1);
              if (name === "v4_discard_title") return "تجاهل التغييرات؟";
              if (name === "v4_plan_rooms_selected") return "٣ من ١٢ محددة";
              if (name.startsWith("v4_plan_row_") || name.startsWith("v4_plan_summary_rooms")) return "٣ غرف · حوالي ٢٠ دقيقة";
              return key;
            };
          }
        }, { translated, dialog });
        const phrase = gallery.locator(selector).first();
        await expect(phrase).toBeVisible();
        await expect.poll(() => phrase.evaluate((element) =>
          getComputedStyle(element.querySelector("bdi") ?? element).direction,
        )).toBe(translated ? "rtl" : "ltr");
        if (translated) await expect(phrase).toContainText(/[غت٣]/u);
      });
    }
  }

  test("keeps the mobile map usable in RTL", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
    await page.evaluate((tag) => {
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = "draw";
      gallery.narrow = true;
      document.body.style.margin = "0";
      document.body.append(gallery);
    }, GALLERY_TAG);
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
  });

  test("ignores a saved Classic preference and always starts the modern panel", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("matic-map-studio:preferred-frontend", "v3");
    });
    const fixtureInfo = await installPanelFixture(page, { moduleSource: "packaged" });
    const classicRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/classic-must-not-load.js") classicRequests.push(request.url());
    });
    await page.evaluate(async (panelTag) => {
      await customElements.whenDefined(panelTag);
      const panel = window.__panelFixture.createPanel();
      panel.panel = { config: { classic_module_url: "/classic-must-not-load.js" } };
      window.__modernPanel = panel;
      document.body.append(panel);
      await panel.updateComplete;
    }, fixtureInfo.panelTag);
    await expect.poll(() => page.evaluate(() =>
      window.__modernPanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");

    const result = await page.evaluate(() => ({
      savedPreference: localStorage.getItem("matic-map-studio:preferred-frontend"),
      modernShell: Boolean(window.__modernPanel.shadowRoot.querySelector("matic-map-shell-v4")),
      classicPanel: Boolean(window.__modernPanel.shadowRoot.querySelector("matic-map-panel-v0-3-1")),
    }));
    expect(result).toEqual({ savedPreference: "v3", modernShell: true, classicPanel: false });
    expect(classicRequests).toEqual([]);
    await page.evaluate(() => window.__modernPanel.remove());
  });

  // Browser full screen folded into Full map (D3): map_studio_v4_map_surfaces.spec.mjs.

  test("coalesces 100 unrelated Home Assistant updates without workspace churn", async ({ page }) => {
    let catalogRequests = 0;
    await page.route("**/api/matic_robot/slam_entries*", async (route) => {
      catalogRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"entries":[]}' });
    });
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
    const result = await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      let calls = 0;
      let updates = 0;
      let renders = 0;
      const Panel = customElements.get("matic-map-panel-v0-4-0");
      const originalUpdate = Panel.prototype.update;
      const originalRender = Panel.prototype.render;
      Panel.prototype.update = function update(changed) {
        updates += 1;
        return originalUpdate.call(this, changed);
      };
      Panel.prototype.render = function render() {
        renders += 1;
        return originalRender.call(this);
      };
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
      const settle = async () => {
        let settled = false;
        for (let attempt = 0; attempt < 5 && !settled; attempt += 1) settled = await panel.updateComplete;
      };
      await settle();
      for (let attempt = 0; attempt < 50 && panel.getWorkspaceSnapshot().resources.catalog.status === "loading"; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 2));
      }
      await new Promise(resolve => setTimeout(resolve, 30));
      await settle();
      const beforeState = panel.getWorkspaceSnapshot();
      const beforeUpdates = updates;
      const beforeRenders = renders;
      for (let index = 0; index < 100; index += 1) {
        panel.hass = {
          ...panel.hass,
          states: { ...relevant, "sensor.unrelated": { state: String(index), attributes: {} } },
        };
        await settle();
      }
      return {
        calls,
        defined: Boolean(customElements.get("matic-map-panel-v0-4-0")),
        workspaceUnchanged: panel.getWorkspaceSnapshot() === beforeState,
        updateDelta: updates - beforeUpdates,
        renderDelta: renders - beforeRenders,
        lastUnrelatedState: panel.hass.states["sensor.unrelated"].state,
      };
    });
    expect(result).toEqual({ calls: 0, defined: true, workspaceUnchanged: true,
      updateDelta: 0, renderDelta: 0, lastUnrelatedState: "99" });
    // Every iteration replaces the test map with the next synthetic state;
    // no update may refetch the private catalog after initial admission.
    expect(catalogRequests).toBe(1);
  });

  test("rebuilds the HA adapter boundary when the connection instance changes", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      let fetches = 0;
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "local-user", is_admin: true },
        states: { "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
        } },
        fetchWithAuth: async () => {
          fetches += 1;
          return new Response('{"entries":[]}', { status: 200,
            headers: { "Content-Type": "application/json" } });
        },
      };
      document.body.append(panel);
      for (let attempt = 0; attempt < 5; attempt += 1) await panel.updateComplete;
      window.__adapterConnectionHarness = { panel, fetchCount: () => fetches };
    });
    await expect.poll(() => page.evaluate(() => window.__adapterConnectionHarness.fetchCount())).toBe(1);

    await page.evaluate(async () => {
      const { panel } = window.__adapterConnectionHarness;
      panel.hass = { ...panel.hass, connection: {} };
      for (let attempt = 0; attempt < 5; attempt += 1) await panel.updateComplete;
    });
    await expect.poll(() => page.evaluate(() => window.__adapterConnectionHarness.fetchCount())).toBe(2);
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
    let poseAgeSeconds;
    let poseFloorCoherent = true;
    let poseRequests = 0;
    let failNextPose = false;
    let holdNextPose = false;
    let holdAfterNextAgedPose = false;
    let heldPoseRequests = 0;
    let releaseHeldPose;
    const heldPoseGate = new Promise((resolve) => { releaseHeldPose = resolve; });
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
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", async (route) => {
      poseRequests += 1;
      if (failNextPose) {
        failNextPose = false;
        return route.fulfill({ status: 503, body: "temporary" });
      }
      if (holdNextPose) {
        holdNextPose = false;
        heldPoseRequests += 1;
        await heldPoseGate;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          position: posePosition,
          source: posePosition ? "latest_pose" : "current_area",
          revision: catalogRevision + 100,
          pose_revision: poseRequests,
          map_floor_coherent: poseFloorCoherent,
          pose_freshness: poseFreshness,
          ...(poseAgeSeconds === undefined ? {} : { pose_age_seconds: poseAgeSeconds }),
          map_session_key: poseSessionKey,
        }),
      });
      if (holdAfterNextAgedPose && poseAgeSeconds === 3) {
        holdAfterNextAgedPose = false;
        holdNextPose = true;
      }
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
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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
    const contentGeneration = await page.evaluate(() => window.__deltaPanel.getWorkspaceSnapshot().generation);
    holdDeltaRecoveryScene = true;
    failNextDelta = true;
    await expect.poll(() => fullSceneRequests).toBe(2);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, position: state.resources.pose.value?.position };
    })).toEqual({ exactPose: true, position: [10, 12] });
    expect(await page.evaluate(() => window.__deltaPanel.getWorkspaceSnapshot().generation)).toBe(contentGeneration);
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
      exactPose: false,
      freshness: "coordinator_fallback",
      position: [11, 13],
    });
    posePosition = null;
    const requestsBeforeMissingFallback = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeMissingFallback);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, pose: state.resources.pose.value };
    })).toEqual({
      exactPose: false,
      pose: expect.objectContaining({ freshness: "coordinator_fallback", position: null }),
    });
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
    })).toEqual({ exactPose: false, freshness: "live", position: null });
    failNextPose = true;
    const requestsBeforeFailure = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 }).toBeGreaterThan(requestsBeforeFailure);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, pose: state.resources.pose.value };
    })).toEqual({ exactPose: false, pose: null });
    posePosition = [11, 13];
    const requestsBeforeRecovery = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeRecovery);
    await expect.poll(() => page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, position: state.resources.pose.value?.position };
    })).toEqual({ exactPose: true, position: [11, 13] });
    holdNextFullScene = true;
    catalogRevision = 3;
    // End the live delta owner after publishing the new catalog revision.
    // With no healthy delta stream, the catalog becomes the bounded full-scene
    // fallback and this test can assert the retained-pose loading behavior.
    failNextDelta = true;
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
    expect(await page.evaluate(() => window.__deltaPanel.getWorkspaceSnapshot().generation)).toBe(contentGeneration);
    releaseHeldFullScene();
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().resources.scene.value?.revision)).toBe(3);
    const requestsBeforeSessionChange = poseRequests;
    poseSessionKey = "b".repeat(64);
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeSessionChange);
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().map.exactPose), { timeout: 5_000 }).toBe(false);
    // Return to the same catalog key, then consume the backend's typed
    // frame-revoked response: it must clear the old verified marker.
    poseSessionKey = "a".repeat(64);
    posePosition = [11, 13];
    await expect.poll(() => page.evaluate(() => window.__deltaPanel.getWorkspaceSnapshot().map.exactPose)).toBe(true);
    poseFloorCoherent = false;
    poseSessionKey = null;
    posePosition = null;
    await expect.poll(() => page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, pose: state.resources.pose.value };
    })).toEqual({ exactPose: false, pose: null });
    // A point read near the backend's freshness limit gets only its remaining
    // lifetime locally. The next request hangs, but expiry still clears it.
    poseFloorCoherent = true;
    poseSessionKey = "a".repeat(64);
    posePosition = [11, 13];
    poseAgeSeconds = 3.0;
    holdAfterNextAgedPose = true;
    const requestsBeforeAgedPose = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeAgedPose);
    await expect.poll(() => page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return {
        exactPose: state.map.exactPose,
        age: state.resources.pose.value?.nativeObservationAgeSeconds,
        revision: state.resources.pose.value?.poseRevision,
      };
    }), { timeout: 1_000 }).toMatchObject({ exactPose: true, age: 3 });
    await expect.poll(() => heldPoseRequests, { timeout: 5_000 })
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__deltaPanel.getWorkspaceSnapshot().map.exactPose)).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, pose: state.resources.pose.value };
    }), { timeout: 2_500, intervals: [50, 100, 200] }).toEqual({ exactPose: false, pose: null });
    holdNextPose = false;
    poseAgeSeconds = 0;
    releaseHeldPose();
    await expect.poll(() => page.evaluate(() => window.__deltaPanel.getWorkspaceSnapshot().map.exactPose)).toBe(true);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__deltaPanel.getWorkspaceSnapshot().map.exactPose)).toBe(true);
    poseAgeSeconds = null;
    const requestsBeforeUnknownAge = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeUnknownAge);
    await expect.poll(() => page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, age: state.resources.pose.value?.nativeObservationAgeSeconds };
    })).toEqual({ exactPose: false, age: null });
    poseAgeSeconds = 0;
    const requestsBeforeFinalRecovery = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeFinalRecovery);
    await expect.poll(() => page.evaluate(() => window.__deltaPanel.getWorkspaceSnapshot().map.exactPose)).toBe(true);
    await page.evaluate(() => window.__deltaPanel.remove());
  });

  test("retains a verified same-floor scene while a new revision is built @safety", async ({ page }) => {
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
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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

  test("routes Stop through the server even when the catalog has no managed plan @safety", async ({ page }) => {
    const scene = syntheticScene("Direct room", 18);
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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
      .toEqual(["matic_robot", "stop_intelligent_cleaning"]);
    expect(await page.evaluate(() => window.__directStop.calls[0][2].include_unmanaged)).toBe(true);
  });

  test("fails motion closed when the private catalog reports managed work @safety", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4-review/review.js", type: "module" });
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
      const module = await import("/map_studio_v4-review/review.js");
      return module.canStartMotion(window.__managedPanel.getWorkspaceSnapshot());
    })).toBe(false);
  });
});

test.describe("Map Studio v0.4 on touch @mobile", () => {
  test("keeps offline status above the bottom sheet", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ha-offline", narrow: true });
    const state = await snapshot(page);
    await gallery.evaluate((element, map) => element.replaceWorkspaceState({
      ...element.getWorkspaceSnapshot(), map: { ...map, available: false },
    }), state.map);
    await settleSheet(gallery);
    const message = await gallery.locator(".map-message").boundingBox();
    const sheet = await gallery.locator(".mobile-sheet").boundingBox();
    expect(message.y).toBeGreaterThanOrEqual(0);
    expect(message.y + message.height).toBeLessThan(sheet.y);
  });

  // Runs on the iPhone 15 and Pixel 7 projects only (tag-selected). The
  // gallery's narrow stage is a fixed 390x844 frame for the desktop harness;
  // on a device the shell must fill the real viewport instead.
  async function loadPhone(page, { scenario = "ready", dir = "ltr" } = {}) {
    await shimPointerCapture(page);
    await page.goto("/");
    await page.evaluate((direction) => { document.documentElement.dir = direction; }, dir);
    await page.addScriptTag({
      type: "module",
      content: 'import * as module from "/map_studio_v4-review/review.js"; window.__phoneModule = module;',
    });
    await page.evaluate(async ({ tag, selectedScenario }) => {
      await customElements.whenDefined(tag);
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = selectedScenario;
      gallery.narrow = true;
      document.body.style.margin = "0";
      document.body.append(gallery);
      await gallery.updateComplete;
      const stage = gallery.shadowRoot.querySelector(".stage");
      stage.style.blockSize = "100vh";
      stage.style.minBlockSize = "0";
      stage.style.maxInlineSize = "none";
    }, { tag: GALLERY_TAG, selectedScenario: scenario });
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery.locator(".mobile-sheet")).toBeVisible();
    return gallery;
  }

  async function replaceState(page, build) {
    // Retain the module in the page realm instead of creating a short-lived
    // dynamic-import promise for each state change in mobile Chromium.
    await page.evaluate(({ tag, source }) => {
      const module = window.__phoneModule;
      const build = new Function("module", "state", `return (${source})(module, state);`);
      const element = document.querySelector(tag);
      element.replaceWorkspaceState(build(module, element.getWorkspaceSnapshot()));
    }, { tag: GALLERY_TAG, source: build.toString() });
  }

  async function settlePhoneMap(gallery) {
    await gallery.evaluate(async (element) => {
      await element.updateComplete;
      const shell = element.shadowRoot.querySelector(".shell");
      await shell.updateComplete;
      const canvas = shell.shadowRoot.querySelector("matic-map-canvas-v4");
      await canvas.updateComplete;
    });
  }

  // The draw scenario ships with a saved outline; start every stroke test
  // from an empty draft so "nothing was painted" is unambiguous.
  const emptyDraw = (module) => {
    const draw = module.createGalleryState("draw");
    return { ...draw, draw: { ...draw.draw, circles: [], strokeCount: 0, dirty: false, redo: [] } };
  };

  async function sceneCentre(gallery) {
    const box = await gallery.locator(".scene-window").boundingBox();
    expect(box).not.toBeNull();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  }

  const dispatch = (locator, event) => locator.dispatchEvent(event.type, event.init);

  test("moves the sheet between detents by dragging the grip", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "ready" });
    const sheet = gallery.locator(".mobile-sheet");
    const grip = gallery.locator(".sheet-grip");
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await settleSheet(gallery);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);

    await touchDrag(page, grip, slowDrag(-220), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await expect(sheet).not.toHaveClass(/dragging/);
    await settleSheet(gallery);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);

    await touchDrag(page, grip, slowDrag(220), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await settleSheet(gallery);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);

    await touchDrag(page, grip, slowDrag(220), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await settleSheet(gallery);
    await expect(gallery.locator("#sheet-panel")).toBeHidden();
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);
    expect(await sheet.evaluate((element) => element.style.transform)).toBe("");
  });

  test("lets a fast flick reach the next detent without covering the distance", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "ready" });
    const sheet = gallery.locator(".mobile-sheet");
    const grip = gallery.locator(".sheet-grip");
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await settleSheet(gallery);

    // Give the synthetic input a browser-clock cadence. Sending each event as
    // a separate Playwright locator call adds WebKit IPC time to event.timeStamp
    // and can turn this 1.5 px/ms flick into a sub-threshold drag on CI.
    const fastFlick = async (points) => {
      const box = await grip.boundingBox();
      expect(box).not.toBeNull();
      await grip.evaluate((element, { points, left, top }) => {
        const pointerId = 11;
        const start = performance.now();
        const fire = (type, [x, y], elapsed) => {
          const event = new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: "touch",
            isPrimary: true,
            button: 0,
            clientX: left + x,
            clientY: top + y,
          });
          Object.defineProperty(event, "timeStamp", { value: start + elapsed });
          element.dispatchEvent(event);
        };
        fire("pointerdown", points[0], 0);
        for (let index = 1; index < points.length; index += 1) {
          fire("pointermove", points[index], index * 16);
        }
        fire("pointerup", points.at(-1), (points.length - 1) * 16);
      }, { points, left: box.x, top: box.y });
    };

    // 75px is nowhere near the full detent, but ~1.5 px/ms is a flick.
    await fastFlick([[160, 20], [160, -5], [160, -30], [160, -55]]);
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await settleSheet(gallery);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);

    // A flick down from full is one step, to half, never straight to peek.
    await fastFlick([[160, 20], [160, 45], [160, 70], [160, 95]]);
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await settleSheet(gallery);

    // Dragging the same 75px slowly snaps back to where it started.
    await touchDrag(page, grip, slowDrag(-75), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "half");
  });

  test("does not paint when a second finger lands during the arming delay", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    await replaceState(page, emptyDraw);
    await settlePhoneMap(gallery);
    const root = gallery.locator(".map-root");
    const { x, y } = await sceneCentre(gallery);

    await dispatch(root, pointer("pointerdown", 11, x - 20, y));
    await page.waitForTimeout(60);
    await dispatch(root, pointer("pointerdown", 12, x + 20, y));
    for (let step = 1; step <= 6; step += 1) {
      await page.waitForTimeout(16);
      await dispatch(root, pointer("pointermove", 11, x - 20 - step * 12, y));
      await dispatch(root, pointer("pointermove", 12, x + 20 + step * 12, y));
    }
    await dispatch(root, pointer("pointerup", 11, x - 92, y));
    await dispatch(root, pointer("pointerup", 12, x + 92, y));
    await page.waitForTimeout(200);
    const after = await snapshot(page);
    expect(after.draw.circles.length).toBe(0);
    expect(after.draw.strokeCount).toBe(0);
  });

  test("paints once a single finger has rested for the arming delay", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    await replaceState(page, emptyDraw);
    const root = gallery.locator(".map-root");
    const { x, y } = await sceneCentre(gallery);
    await dispatch(root, pointer("pointermove", 99, x, y));
    await page.waitForTimeout(50);
    const overlay = gallery.locator(".overlay-canvas");
    const beforePreview = await overlay.evaluate(canvas => canvas.toDataURL());
    const baseline = (await snapshot(page)).draw;

    await dispatch(root, pointer("pointerdown", 11, x, y));
    await page.waitForTimeout(150);
    await dispatch(root, pointer("pointermove", 11, x + 20, y));
    await page.waitForTimeout(16);
    await dispatch(root, pointer("pointermove", 11, x + 40, y));
    expect((await snapshot(page)).draw).toEqual(baseline);
    await expect.poll(
      async () => overlay.evaluate(canvas => canvas.toDataURL()),
      { timeout: 2_000 },
    ).not.toBe(beforePreview);
    expect((await snapshot(page)).draw).toEqual(baseline);
    await dispatch(root, pointer("pointerup", 11, x + 40, y));
    await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBeGreaterThan(0);
    const committed = (await snapshot(page)).draw;
    expect(committed.strokeCount).toBe(baseline.strokeCount + 1);
    expect(committed.undo).toHaveLength(baseline.undo.length + 1);
  });

  for (const authorityChange of ["generation", "coherence", "permission", "new draft"]) test(`drops an armed brush preview when ${authorityChange} changes`, async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    await replaceState(page, (module) => {
      const ready = module.createGalleryState("draw");
      return { ...ready, draw: { ...ready.draw,
        circles: [{ x: 1, y: 1, radius: .2 }], dirty: true, strokeCount: 3,
        undo: [[{ x: .7, y: .7, radius: .1 }]], redo: [[{ x: .8, y: .8, radius: .1 }]],
      } };
    });
    await settlePhoneMap(gallery);
    const root = gallery.locator(".map-root");
    const { x, y } = await sceneCentre(gallery);
    const baseline = (await snapshot(page)).draw;

    await dispatch(root, pointer("pointerdown", 11, x, y));
    await page.waitForTimeout(150);
    await dispatch(root, pointer("pointermove", 11, x + 24, y + 8));
    await page.waitForTimeout(16);
    await dispatch(root, pointer("pointermove", 11, x + 40, y + 14));
    const beforeAuthorityChange = (await snapshot(page)).draw;
    expect(beforeAuthorityChange).toEqual(baseline);

    // Keep the current draft intact for authority losses. A same-generation
    // draft replacement exercises the reducer's baseline identity fence.
    const mutate = authorityChange === "generation"
      ? (_module, state) => ({ ...state, generation: state.generation + 1 })
      : authorityChange === "coherence"
        ? (_module, state) => ({ ...state, coherence: "verifying" })
        : authorityChange === "permission"
          ? (_module, state) => ({ ...state, host: { ...state.host, robotConnected: false } })
          : (_module, state) => ({ ...state, draw: { ...state.draw, circles: [{ x: 1.2, y: 1, radius: .2 }] } });
    await replaceState(page, mutate);
    const retained = authorityChange === "new draft"
      ? { ...baseline, circles: [{ x: 1.2, y: 1, radius: .2 }] }
      : baseline;
    // Dispatch before Lit forwards the new state to the canvas. The reducer
    // must reject the old capture while the controller can still hold its
    // prior prop. The retained draft is not cleared to make the test pass.
    await dispatch(root, pointer("pointermove", 11, x + 64, y + 14));
    await dispatch(root, pointer("pointerup", 11, x + 64, y + 14));
    expect((await snapshot(page)).draw).toEqual(retained);
    await settlePhoneMap(gallery);
    expect((await snapshot(page)).draw).toEqual(retained);
  });

  for (const dirty of [false, true]) test(`pointer cancellation preserves ${dirty ? "dirty" : "clean"} draft history`, async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    const setBaseline = dirty ? (module) => {
      const ready = module.createGalleryState("draw");
      const state = { ...ready, draw: { ...ready.draw, circles: [], strokeCount: 0, dirty: false, redo: [] } };
      return { ...state, draw: { ...state.draw,
        circles: [{ x: 1, y: 1, radius: .2 }], dirty: true, strokeCount: 3,
        undo: [[{ x: .7, y: .7, radius: .1 }]], redo: [[{ x: .8, y: .8, radius: .1 }]],
      } };
    } : (module) => {
      const ready = module.createGalleryState("draw");
      return { ...ready, draw: { ...ready.draw, circles: [], strokeCount: 0, dirty: false, redo: [] } };
    };
    await replaceState(page, setBaseline);
    await settlePhoneMap(gallery);
    const root = gallery.locator(".map-root");
    const { x, y } = await sceneCentre(gallery);
    const baseline = (await snapshot(page)).draw;
    await dispatch(root, pointer("pointerdown", 11, x, y));
    await page.waitForTimeout(150);
    await dispatch(root, pointer("pointermove", 11, x + 35, y + 8));
    await page.waitForTimeout(30);
    expect((await snapshot(page)).draw).toEqual(baseline);
    await dispatch(root, pointer("pointercancel", 11, x + 35, y + 8));
    await settlePhoneMap(gallery);
    expect((await snapshot(page)).draw).toEqual(baseline);
  });

  // Finds a point over a room by tapping candidate spots and watching the
  // selection; the point is handed back unselected.
  async function findRoomPoint(page, gallery) {
    const root = gallery.locator(".map-root");
    const { box } = await sceneCentre(gallery);
    const candidates = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.4, 0.4], [0.6, 0.6], [0.5, 0.5]];
    for (const [fx, fy] of candidates) {
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      await dispatch(root, pointer("pointerdown", 11, x, y));
      await dispatch(root, pointer("pointerup", 11, x, y));
      await page.waitForTimeout(50);
      const ids = (await snapshot(page)).selection.roomIds;
      if (ids.length === 1) {
        await dispatch(root, pointer("pointerdown", 11, x, y));
        await dispatch(root, pointer("pointerup", 11, x, y));
        await expect.poll(async () => (await snapshot(page)).selection.roomIds).toEqual([]);
        return { x, y, roomId: ids[0] };
      }
    }
    throw new Error("no candidate point landed on a room");
  }

  test("selects a room on a tap under 7px and ignores a 20px drag", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "rooms" });
    await gallery.getByRole("button", { name: "2D", exact: true }).click();
    await gallery.getByRole("button", { name: "Fit the whole map on screen" }).click();
    const root = gallery.locator(".map-root");
    const { x, y, roomId } = await findRoomPoint(page, gallery);

    // A 4px wobble is still a tap.
    await dispatch(root, pointer("pointerdown", 11, x, y));
    await page.waitForTimeout(30);
    await dispatch(root, pointer("pointermove", 11, x + 3, y + 2));
    await dispatch(root, pointer("pointerup", 11, x + 3, y + 2));
    await expect.poll(async () => (await snapshot(page)).selection.roomIds).toEqual([roomId]);

    // A 20px drag from the same spot pans; it must not toggle the room.
    await dispatch(root, pointer("pointerdown", 11, x, y));
    await page.waitForTimeout(30);
    await dispatch(root, pointer("pointermove", 11, x + 10, y + 5));
    await page.waitForTimeout(16);
    await dispatch(root, pointer("pointermove", 11, x + 20, y + 8));
    await dispatch(root, pointer("pointerup", 11, x + 20, y + 8));
    await page.waitForTimeout(150);
    expect((await snapshot(page)).selection.roomIds).toEqual([roomId]);
  });

  test("pinches the camera with two fingers without touching the drawn area", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    const root = gallery.locator(".map-root");
    const before = await snapshot(page);
    expect(before.draw.circles.length).toBeGreaterThan(0);
    const box = await root.boundingBox();
    const cx = box.width / 2;
    const cy = box.height * 0.4;

    await twoFingerPinch(page, root, { a: [cx - 30, cy], b: [cx + 30, cy] }, { a: [cx - 90, cy], b: [cx + 90, cy] });
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent).toBeGreaterThan(before.draw.zoomPercent);
    const after = await snapshot(page);
    expect(after.draw.circles).toEqual(before.draw.circles);
    expect(after.draw.strokeCount).toBe(before.draw.strokeCount);
  });

  test("does not commit an outline handle drag across an authority generation", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    await replaceState(page, (_module, state) => ({ ...state, draw: {
      ...state.draw,
      tool: "outline",
      outline: { points: [{ x: 1.5, y: 1.4 }, { x: 1.9, y: 1.6 }, { x: 1.8, y: 2 }], closed: true },
    } }));
    await settlePhoneMap(gallery);
    await gallery.getByRole("button", { name: "Points", exact: true }).click();
    const handle = gallery.locator(".zone-point:not(.zone-midpoint)").first();
    await expect(handle).toBeVisible();
    const bounds = await handle.boundingBox();
    const before = (await snapshot(page)).draw.outline;
    const target = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

    await dispatch(handle, pointer("pointerdown", 11, target.x, target.y));
    await dispatch(handle, pointer("pointermove", 11, target.x + 8, target.y + 6));
    await expect.poll(async () => handle.boundingBox()).not.toEqual(bounds);
    await replaceState(page, (_module, state) => ({ ...state, generation: state.generation + 1 }));
    await dispatch(handle, pointer("pointerup", 11, target.x + 8, target.y + 6));

    expect((await snapshot(page)).draw.outline).toEqual(before);
    await settlePhoneMap(gallery);
    expect((await snapshot(page)).draw.outline).toEqual(before);
  });

  test("keeps the primary action, Stop, and every draw tool within thumb reach", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "rooms" });
    const reach = async (locator, label) => {
      const height = await page.evaluate(() => window.innerHeight);
      const box = await locator.boundingBox();
      expect(box, `${label} has a box`).not.toBeNull();
      const centre = box.y + box.height / 2;
      expect(centre, `${label} centre ${centre} of ${height}`).toBeGreaterThanOrEqual(height * 0.45);
    };
    await replaceState(page, (module) => {
      const rooms = module.createGalleryState("rooms");
      return { ...rooms, selection: { ...rooms.selection, roomIds: ["room-a", "room-b"] } };
    });
    await reach(gallery.locator(".action-bar").getByRole("button", { name: "Clean 2 rooms" }), "Clean rooms");

    await gallery.evaluate((element) => element.setScenario("cleaning"));
    await reach(gallery.locator(".action-bar").getByRole("button", { name: "Stop cleaning" }), "Stop");

    await gallery.evaluate((element) => element.setScenario("draw"));
    const tools = gallery.locator(".sheet-tools .draw-tools button");
    await expect(tools).toHaveCount(8);
    for (let index = 0; index < 8; index += 1) await reach(tools.nth(index), `draw tool ${index}`);
  });

  for (const width of [320, 390]) {
    test(`gives every visible button a 44px target at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      const gallery = await loadPhone(page, { scenario: "ready" });
      const showMore = gallery.getByRole("button", { name: "Expand panel" });
      const allowed = [];
      const undersized = [];
      const sweep = async (label) => {
        // Open the sheet fully so the panel's own buttons are on screen too.
        for (let step = 0; step < 2; step += 1) {
          if (await showMore.isEnabled()) await showMore.click();
        }
        const buttons = gallery.locator("button:visible");
        const count = await buttons.count();
        expect(count, `${label} renders buttons`).toBeGreaterThan(0);
        for (let index = 0; index < count; index += 1) {
          const button = buttons.nth(index);
          const box = await button.boundingBox();
          if (!box) continue;
          if (box.width < 44 || box.height < 44) {
            const name = await button.evaluate((element) => element.getAttribute("aria-label") || element.textContent.trim());
            if (allowed.some((pattern) => pattern.test(name))) continue;
            undersized.push(`${label}: "${name}" ${Math.round(box.width)}x${Math.round(box.height)}`);
          }
        }
      };
      await sweep("ready");
      for (const scenario of ["rooms", "draw", "cleaning", "history"]) {
        await gallery.evaluate((element, next) => element.setScenario(next), scenario);
        await sweep(scenario);
      }
      await replaceState(page, (module) => ({ ...module.createGalleryState("ready"), workflow: "plan" }));
      await sweep("plan");
      expect(undersized, undersized.join("\n")).toEqual([]);
    });
  }

  for (const dir of ["ltr", "rtl"]) {
    test(`never scrolls sideways at 320px in ${dir}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 740 });
      const gallery = await loadPhone(page, { scenario: "ready", dir });
      const overflow = () => page.evaluate((tag) => {
        const gallery = document.querySelector(tag);
        const shell = gallery.shadowRoot.querySelector("matic-map-shell-v4");
        return {
          document: document.documentElement.scrollWidth,
          gallery: gallery.scrollWidth,
          root: shell.shadowRoot.querySelector(".root").scrollWidth,
        };
      }, GALLERY_TAG);
      const check = async (label) => {
        const widths = await overflow();
        for (const [key, value] of Object.entries(widths)) {
          expect(value, `${label} ${dir} ${key} width`).toBeLessThanOrEqual(320);
        }
      };
      await check("ready");
      for (const scenario of ["rooms", "draw", "history"]) {
        await gallery.evaluate((element, next) => element.setScenario(next), scenario);
        await check(scenario);
      }
      await replaceState(page, (module) => ({ ...module.createGalleryState("ready"), workflow: "plan" }));
      await check("plan");
    });
  }

  test("collapses a full sheet from the scrim without toggling a room", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "rooms" });
    await replaceState(page, (module) => {
      const rooms = module.createGalleryState("rooms");
      return { ...rooms, selection: { ...rooms.selection, roomIds: ["room-a"] } };
    });
    const sheet = gallery.locator(".mobile-sheet");
    const showMore = gallery.getByRole("button", { name: "Expand panel" });
    await expect(gallery.locator("matic-map-canvas-v4").getByRole("button", { name: "Collapse panel", exact: true })).toHaveCount(0);
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await showMore.click();
    await expect(sheet).toHaveAttribute("data-detent", "full");
    const scrim = gallery.locator("matic-map-canvas-v4").getByRole("button", { name: "Collapse panel", exact: true });
    await expect(scrim).toBeVisible();
    await scrim.click();
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await expect(scrim).toHaveCount(0);
    await page.waitForTimeout(150);
    expect((await snapshot(page)).selection.roomIds).toEqual(["room-a"]);
  });

  test("pads the sheet for the home indicator", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "ready" });
    await gallery.evaluate((element) => element.style.setProperty("--safe-area-inset-bottom", "34px"));
    const sheet = gallery.locator(".mobile-sheet");
    await expect(sheet).toHaveCSS("padding-bottom", "34px");
    await gallery.evaluate((element) => element.style.setProperty("--safe-area-inset-bottom", "0px"));
    await expect.poll(async () => Number.parseFloat(await sheet.evaluate((element) => getComputedStyle(element).paddingBottom))).toBeLessThan(34);
  });

  test("settles instantly under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const gallery = await loadPhone(page, { scenario: "ready" });
    const sheet = gallery.locator(".mobile-sheet");
    await expect(sheet).toHaveCSS("transition-duration", "0s");
    await settleSheet(gallery);
    const grip = gallery.locator(".sheet-grip");
    await touchDrag(page, grip, slowDrag(-220), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "full");
    const immediate = await sheet.evaluate((element) => new Promise((resolve) => {
      requestAnimationFrame(() => resolve(element.getBoundingClientRect().height));
    }));
    await page.waitForTimeout(400);
    const settled = await sheet.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(immediate - settled)).toBeLessThanOrEqual(1);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);
  });
});

for (const narrow of [false, true]) for (const direction of ["ltr", "rtl"]) {
  test(`Draw toolbar uses one tab stop and skips disabled tools in ${direction} ${narrow ? "on a phone @mobile" : "on desktop"}`, async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", narrow });
    await page.evaluate((direction) => { document.documentElement.dir = direction; }, direction);
    const forward = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backward = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
    const toolbar = gallery.getByRole("toolbar", { name: "Draw area tools" });
    await expect(toolbar).toBeVisible();
    const zone = toolbar.getByRole("button", { name: "Points", exact: true });
    const paint = toolbar.getByRole("button", { name: "Paint", exact: true });
    const erase = toolbar.getByRole("button", { name: "Erase", exact: true });
    const brush = toolbar.getByRole("button", { name: /^Brush width/ });
    await expect(toolbar.locator('button[tabindex="0"]')).toHaveCount(1);
    await paint.focus();
    const before = await snapshot(page);
    await paint.press(forward);
    await expect(erase).toBeFocused();
    await expect(paint).toHaveAttribute("tabindex", "-1");
    await erase.press("End");
    await expect(brush).toBeFocused();
    await brush.press(forward);
    await expect(zone).toBeFocused();
    await zone.press(backward);
    await expect(brush).toBeFocused();
    await brush.press("Home");
    await expect(zone).toBeFocused();
    // Moving focus never paints or changes the map camera / chosen tool.
    expect((await snapshot(page)).draw).toEqual(before.draw);
    await expect(toolbar.locator('button[tabindex="0"]')).toHaveCount(1);
    const expected = await toolbar.locator('button:not(:disabled)').evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") || button.textContent.trim()));
    const reached = [];
    for (let index = 0; index < expected.length; index++) {
      reached.push(await toolbar.locator('button[tabindex="0"]').evaluate((button) => button.getAttribute("aria-label") || button.textContent.trim()));
      await page.keyboard.press(forward);
    }
    expect(reached).toEqual(expected);
    await expect(zone).toBeFocused();
  });
}

for (const dirty of [false, true]) {
  test(`collapsed Draw sheet keeps an exit for ${dirty ? "unsaved" : "blank"} areas @mobile`, async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: dirty ? "draw" : "ready", narrow: true });
    if (!dirty) {
      await gallery.getByRole("button", { name: /^Clean custom area/ }).click();
      await gallery.getByRole("button", { name: "New area", exact: true }).click();
    }
    const sheet = gallery.locator(".mobile-sheet");
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    // UX9: a new drawing's Back goes to Your areas.
    const back = sheet.locator(".sheet-grip").getByRole("button", { name: "Back to areas" });
    await expect(back).toBeVisible();
    await back.click();
    if (dirty) {
      await expect(gallery.getByRole("dialog")).toBeVisible();
      await gallery.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
      await expect(back).toBeFocused();
      await back.click();
      await expect(gallery.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(gallery.getByRole("dialog")).toHaveCount(0);
      await expect(back).toBeFocused();
      await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
      await back.click();
      await gallery.getByRole("button", { name: "Discard", exact: true }).click();
    }
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areas");
    await expect(gallery.getByRole("button", { name: "New area", exact: true })).toBeVisible();
  });
}

for (const activity of ["docked", "idle"]) {
  for (const betweenLegs of [false, true]) {
    test(`an active plan remains in progress while the robot is ${activity}${betweenLegs ? " between legs" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page);
      await page.evaluate(({ tag, activity, betweenLegs }) => {
        const module = window.__galleryModule;
        const state = module.createGalleryState("ready");
        document.querySelector(tag).replaceWorkspaceState({ ...state, activity,
          managedLock: true, resources: { ...state.resources, entry: { ...state.resources.entry, activePlan: !betweenLegs, runnerLocked: betweenLegs } } });
      }, { tag: GALLERY_TAG, activity, betweenLegs });
      await expect(gallery.locator(".status-copy strong")).toHaveText("Run in progress");
      await expect(gallery.locator(".status-copy small")).toHaveText(activity === "docked"
        ? "Robot docked; the clean has not finished." : "Waiting for the clean to continue or finish.");
      await expect(gallery.getByRole("button", { name: "Stop cleaning", exact: true }).first()).toBeEnabled();
    });
  }
}

for (const ordered of [false, true]) {
  test(`the order segment switches numbers and arrows ${ordered ? "on for saved order" : "off for rotation"}`, async ({ page }) => {
    const gallery = await loadGallery(page);
    await page.evaluate(({ tag, ordered }) => {
      const module = window.__galleryModule;
      const state = module.createGalleryState("ready");
      document.querySelector(tag).replaceWorkspaceState({ ...state, workflow: "plan", planView: "edit", planDraft: {
        ...state.planDraft, runBehavior: ordered ? "intelligent" : "ordered",
      } });
    }, { tag: GALLERY_TAG, ordered });
    const order = gallery.getByRole("group", { name: "Cleaning order" });
    const choice = order.getByRole("button", { name: ordered ? "Saved order" : "Intelligent rotation", exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(order.getByRole("button", { name: ordered ? "Intelligent rotation" : "Saved order", exact: true })).toHaveAttribute("aria-pressed", "false");
    // plan.md §3: the hint under the segment says what the order means.
    await expect(order.getByText(ordered ? "Top to bottom, as listed" : "Longest-waiting first", { exact: true })).toBeVisible();
    expect((await snapshot(page)).planDraft.runBehavior).toBe(ordered ? "ordered" : "intelligent");
    const rooms = gallery.getByRole("list", { name: "Rooms", exact: true });
    await expect(rooms.getByRole("button", { name: /^Move .* (earlier|later)$/ })).toHaveCount(ordered ? 6 : 0);
    await expect(rooms.locator(".pos-badge")).toHaveText(ordered ? ["1", "2", "3"] : []);
  });
}

for (const width of [320, 390, 820, 1280]) {
  test(`map corner controls stay separate at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const gallery = await loadGallery(page);
    const floor = gallery.getByRole("combobox", { name: "Choose floor" });
    await expect(floor).toHaveCount(1);
    await floor.locator('option[value="current"]').evaluate((option) => { option.textContent = "An exceptionally long saved floor display name"; });
    const fit = gallery.getByRole("button", { name: "Fit the whole map on screen" });
    const view = gallery.getByRole("group", { name: "Map view", exact: true });
    const camera = gallery.getByRole("toolbar", { name: "Map camera controls" });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const check = async () => expect(async () => {
      const [f, v, fitBox, c, map] = await Promise.all([floor.boundingBox(), view.boundingBox(), fit.boundingBox(), camera.boundingBox(), gallery.locator(".map-root").boundingBox()]);
      for (const box of [f, v, fitBox, c]) expect(box).not.toBeNull();
      expect(f.x + f.width).toBeLessThanOrEqual(v.x);
      expect(v.x + v.width).toBeLessThanOrEqual(fitBox.x);
      expect(Math.abs((f.y + f.height / 2) - (v.y + v.height / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs((f.y + f.height / 2) - (fitBox.y + fitBox.height / 2))).toBeLessThanOrEqual(2);
      expect(c.x + c.width).toBeLessThanOrEqual(map.x + map.width);
      expect(c.y).toBeGreaterThan(fitBox.y + fitBox.height);
      const sheet = gallery.locator(".mobile-sheet");
      if (await sheet.count()) {
        const bounds = await sheet.boundingBox();
        expect(c.y + c.height).toBeLessThanOrEqual(bounds.y);
      }
      expect(f.height).toBeGreaterThanOrEqual(44);
    }).toPass({ timeout: 2000 });
    await check();
    const more = gallery.getByRole("button", { name: "Expand panel" });
    if (await more.count()) {
      await more.click();
      await check();
      await gallery.getByRole("complementary", { name: "Cleaning panel" }).getByRole("button", { name: "Collapse panel", exact: true }).click();
      await check();
    }
    await page.screenshot({ path: testInfo.outputPath(`synthetic-corners-${width}.png`) });
    await gallery.evaluate((element) => element.setScenario("draw"));
    await expect(floor).toBeVisible();
    await expect(fit).toBeVisible();
    await expect(camera).toHaveCount(0);
    await expect(gallery.getByRole("toolbar", { name: "Draw area tools" })).toBeVisible();
    // Locating shows no map, so the floor select leaves the rail with Fit
    // (home-rooms.md §11 MS-HOME-04).
    await gallery.evaluate((element) => element.setScenario("transition"));
    await expect(floor).toHaveCount(0);
    await expect(fit).toHaveCount(0);
  });
}

test("short phone keeps plan footer reachable below the reserved map controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const gallery = await loadGallery(page);
  await gallery.locator(".stage").evaluate((stage) => { stage.style.minBlockSize = "0"; stage.style.blockSize = "568px"; });
  await openPlanPicker(gallery);
  await gallery.getByRole("button", { name: /^Daily clean/ }).click();
  // shell.md §5 Sheet: Run rests at half; Edit's long form opens at full.
  await gallery.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
  await settleSheet(gallery);
  const sheet = gallery.locator(".mobile-sheet");
  await expect(sheet).toHaveAttribute("data-detent", "full");
  // The form's last control, When a run ends, scrolls above the footer.
  const runEnd = gallery.getByText("When a run ends", { exact: true });
  await runEnd.scrollIntoViewIfNeeded();
  await expect(runEnd).toBeInViewport();
  const footer = await gallery.locator(".action-bar").boundingBox();
  expect(footer.y + footer.height).toBeLessThanOrEqual(568);
  const body = await sheet.boundingBox();
  const view = await gallery.getByRole("group", { name: "Map view", exact: true }).boundingBox();
  expect(body.y).toBeGreaterThan(view.y + view.height);
});

for (const width of [1024, 1100]) {
  test(`selected-room chip stays below camera controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const gallery = await loadGallery(page, { scenario: "rooms" });
    await page.evaluate((tag) => {
      const module = window.__galleryModule;
      const state = module.createGalleryState("rooms");
      document.querySelector(tag).replaceWorkspaceState({ ...state, view: "three",
        selection: { ...state.selection, roomIds: ["room-a", "room-b"] } });
    }, GALLERY_TAG);
    const chip = gallery.locator(".selection-chip");
    const camera = gallery.getByRole("toolbar", { name: "Map camera controls" });
    await expect(chip).toBeVisible();
    const [chipBox, cameraBox] = await Promise.all([chip.boundingBox(), camera.boundingBox()]);
    expect(cameraBox.y + cameraBox.height).toBeLessThanOrEqual(chipBox.y);
    const before = (await snapshot(page)).cameras.three?.yaw ?? null;
    await camera.getByRole("button", { name: "Rotate right" }).click();
    await expect.poll(async () => (await snapshot(page)).cameras.three?.yaw ?? null).not.toBe(before);
    const pitch = (await snapshot(page)).cameras.three?.pitch ?? null;
    await camera.getByRole("button", { name: "Lower viewing angle" }).click();
    await expect.poll(async () => (await snapshot(page)).cameras.three?.pitch ?? null).not.toBe(pitch);
    await chip.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(chip).toHaveCount(0);
    await expect(camera).toBeVisible();
    await gallery.evaluate((element) => element.setScenario("draw"));
    await expect(camera).toHaveCount(0);
    await expect(gallery.getByRole("toolbar", { name: "Draw area tools" })).toBeVisible();
  });
}

for (const width of [1024, 1100]) {
  for (const height of [500, 900]) {
    for (const three of [false, true]) {
      for (const selected of [false, true]) {
        test(`navigation help avoids ${three ? "3D" : "2D"} controls at ${width}x${height}${selected ? " with selected rooms" : ""}`, async ({ page }) => {
          await page.setViewportSize({ width, height });
          const gallery = await loadGallery(page, { scenario: "rooms" });
          await gallery.locator(".stage").evaluate((stage, height) => { stage.style.minBlockSize = "0"; stage.style.blockSize = `${height}px`; }, height);
          await gallery.evaluate((element, { three, selected }) => {
            const state = element.getWorkspaceSnapshot();
            element.replaceWorkspaceState({ ...state, view: three ? "three" : "top",
              selection: { ...state.selection, roomIds: selected ? ["room-a", "room-b"] : [] } });
          }, { three, selected });
          const launcher = gallery.getByRole("button", { name: "How to move the map", exact: true });
          await launcher.click();
          const help = gallery.getByRole("dialog", { name: "How to move the map", exact: true });
          await expect(help).toBeVisible();
          const helpBox = await help.boundingBox();
          for (const selector of [".map-context", ".map-tools", ".appearance-switch", ".camera-steps", ".map-extras", ".selection-chip"]) {
            const controls = gallery.locator(selector);
            if (!await controls.count()) continue;
            const box = await controls.boundingBox();
            const overlaps = helpBox.x < box.x + box.width && helpBox.x + helpBox.width > box.x
              && helpBox.y < box.y + box.height && helpBox.y + helpBox.height > box.y;
            expect(overlaps, selector).toBe(false);
          }
          expect(helpBox.height).toBeGreaterThan(44);
          if (!three) {
            await gallery.getByRole("button", { name: "Room colors", exact: true }).click();
            await expect.poll(async () => (await snapshot(page)).appearance).toBe("rooms");
          } else {
            await gallery.getByRole("button", { name: "Rotate right" }).click();
            await expect.poll(async () => (await snapshot(page)).cameras.three?.yaw ?? null).not.toBeNull();
          }
          // Activating another map control dismisses this non-modal help.
          await expect(help).toHaveCount(0);
          await launcher.click();
          await expect(help).toBeVisible();
          const close = help.getByRole("button", { name: "Close", exact: true });
          await close.scrollIntoViewIfNeeded();
          await close.click();
          await expect(help).toHaveCount(0);
          await expect(launcher).toBeFocused();
        });
      }
    }
  }
}

for (const width of [320, 390]) {
  test(`sheet scrim leaves corner controls clickable at ${width}px @mobile`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    const gallery = await loadGallery(page, { scenario: "rooms", narrow: true });
    const sheet = gallery.locator(".mobile-sheet");
    const more = gallery.getByRole("button", { name: "Expand panel" });
    const less = gallery.getByRole("complementary", { name: "Cleaning panel" }).getByRole("button", { name: "Collapse panel", exact: true });
    for (const detent of ["full", "half", "peek"]) {
      if (detent === "full") await more.click();
      else await less.click();
      await expect(sheet).toHaveAttribute("data-detent", detent);
      await settleSheet(gallery);
      const floor = gallery.getByRole("combobox", { name: "Choose floor", exact: true });
      await floor.evaluate((element) => { element.dataset.clicked = "false"; element.addEventListener("click", () => { element.dataset.clicked = "true"; }, { once: true }); });
      await floor.click();
      await page.keyboard.press("Enter");
      await expect(floor).toHaveAttribute("data-clicked", "true");
      await gallery.getByRole("button", { name: "2D", exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).view).toBe("top");
      await gallery.getByRole("button", { name: "3D", exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).view).toBe("three");
      await gallery.getByRole("button", { name: "Fit the whole map on screen" }).click();
      const yaw = (await snapshot(page)).cameras.three?.yaw ?? null;
      await gallery.getByRole("button", { name: "Rotate right" }).click();
      await expect.poll(async () => (await snapshot(page)).cameras.three?.yaw ?? null).not.toBe(yaw);
      await expect(sheet).toHaveAttribute("data-detent", detent);
    }
    await more.click();
    await more.click();
    await settleSheet(gallery);
    const selection = (await snapshot(page)).selection.roomIds;
    const scrim = gallery.locator("matic-map-canvas-v4").getByRole("button", { name: "Collapse panel", exact: true });
    // The left middle of the exposed map has no control; it still dismisses.
    await scrim.click({ position: { x: 4, y: 90 } });
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    expect((await snapshot(page)).selection.roomIds).toEqual(selection);
  });
}

test("native floor keys and gestures do not drive the map", async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "rooms" });
  const floor = gallery.getByRole("combobox", { name: "Choose floor", exact: true });
  await gallery.getByRole("button", { name: "3D", exact: true }).click();
  await floor.focus();
  const before = await snapshot(page);
  const prevented = await floor.evaluate((element) => {
    const events = [
      ...["ArrowDown", "ArrowUp", "w", "a", "s", "d", " ", "Escape"].map((key) => new KeyboardEvent("keydown", { key, code: key === " " ? "Space" : key, bubbles: true, composed: true, cancelable: true })),
      new WheelEvent("wheel", { deltaY: 100, bubbles: true, composed: true, cancelable: true }),
      ...["gesturestart", "gesturechange", "gestureend"].map((name) => new Event(name, { bubbles: true, composed: true, cancelable: true })),
    ];
    return events.map((event) => { element.dispatchEvent(event); return event.defaultPrevented; });
  });
  expect(prevented).toEqual(Array(prevented.length).fill(false));
  expect((await snapshot(page)).workflow).toBe("rooms");
  expect((await snapshot(page)).cameras).toEqual(before.cameras);
  // Real browser typeahead changes the selected native option and floor.
  await floor.press("s");
  await floor.press("Enter");
  await expect(floor).toHaveValue("saved-1");
  await expect.poll(async () => (await snapshot(page)).selection.floorId).toBe("saved-1");
  await floor.selectOption("current");
  await gallery.getByRole("button", { name: "3D", exact: true }).click();
  const rotate = gallery.getByRole("button", { name: "Rotate right", exact: true });
  await rotate.focus();
  const yaw = (await snapshot(page)).cameras.three?.yaw ?? null;
  await rotate.press("Space");
  await expect.poll(async () => (await snapshot(page)).cameras.three?.yaw ?? null).not.toBe(yaw);
  const afterButton = (await snapshot(page)).cameras.three?.yaw ?? null;
  await gallery.locator(".map-root").press("ArrowRight");
  await expect.poll(async () => (await snapshot(page)).cameras.three?.yaw ?? null).not.toBe(afterButton);
});

test("keyboard drawing paints erases and restores one centered mark", async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "draw" });
  await page.evaluate((tag) => {
    const element = document.querySelector(tag);
    const state = element.getWorkspaceSnapshot();
    element.replaceWorkspaceState({ ...state, draw: { ...state.draw, circles: [], undo: [], redo: [], strokeCount: 0, dirty: false } });
  }, GALLERY_TAG);
  const map = gallery.locator(".map-root");
  await map.focus();
  await expect(gallery.locator(".keyboard-aim")).toBeVisible();
  // The fitted scene center is the unmapped gap between rooms. Aim onto floor.
  await map.press("ArrowDown");
  await map.press("Enter");
  await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBe(1);
  const painted = (await snapshot(page)).draw.circles;
  expect((await snapshot(page)).draw.undo).toHaveLength(1);
  await map.press("e");
  await map.press("Enter");
  await expect.poll(async () => (await snapshot(page)).draw.circles).toEqual([]);
  await gallery.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).draw.circles).toEqual(painted);
  const beforeButton = (await snapshot(page)).draw.circles;
  await gallery.getByRole("button", { name: "Paint", exact: true }).press("Enter");
  expect((await snapshot(page)).draw.circles).toEqual(beforeButton);
  await map.focus();
  await map.press("ArrowRight");
  await map.press("Enter");
  await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBe(2);
});

for (const blocked of ["read-only", "unverified", "pending", "out-of-bounds", "unfocused", "no-canvas"]) {
  test(`keyboard drawing ignores ${blocked} targets @safety`, async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const map = gallery.locator(".map-root");
    const renderer = gallery.locator("matic-map-canvas-v4");
    const waitForPublication = (hidden = false) => expect.poll(() => renderer.evaluate((element, { tag, hidden }) => {
      const state = document.querySelector(tag).getWorkspaceSnapshot();
      const scene = state.resources.scene.value;
      const diagnostics = element.rendererDiagnostics();
      const canvas = element.renderRoot.querySelector(".scene-canvas");
      return {
        published: Boolean(scene && diagnostics
          && diagnostics.sceneRevision === scene.revision
          && diagnostics.sourcePoints === scene.total
          && diagnostics.renderedPoints === scene.total),
        cameraEcho: hidden || Boolean(diagnostics && state.draw.zoomPercent === Math.max(100, Math.min(1000,
          Math.round(diagnostics.fitDistance / diagnostics.cameraDistance * 100)))),
        sized: !hidden || (canvas.width === 1 && canvas.height === 1),
      };
    }, { tag: GALLERY_TAG, hidden })).toEqual({ published: true, cameraEcho: true, sized: true });
    await waitForPublication();
    await map.focus();
    await map.press("ArrowDown");
    if (blocked === "out-of-bounds") {
      for (let i = 0; i < 60; i++) await map.press("ArrowRight");
    }
    await page.evaluate(({ tag, blocked }) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state,
        ...(blocked === "read-only" ? { floor: { ...state.floor, readOnly: true } } : {}),
        ...(blocked === "unverified" ? { coherence: "verifying" } : {}),
        ...(blocked === "pending" ? { command: "pending" } : {}),
        ...(blocked === "out-of-bounds" ? { cameras: { ...state.cameras, top: { yaw: 0, pitch: 0, zoom: 1, targetX: 1000, targetZ: 1000 } } } : {}),
      });
    }, { tag: GALLERY_TAG, blocked });
    if (blocked === "unfocused") await gallery.getByRole("button", { name: "Paint", exact: true }).focus();
    if (blocked === "no-canvas") await gallery.locator(".scene-canvas").evaluate((canvas) => { canvas.style.display = "none"; });
    // Initial camera publication is settled; hidden resize need not emit a new camera intent.
    await waitForPublication(blocked === "no-canvas");
    if (blocked === "unfocused") await expect(map).not.toBeFocused();
    else await expect(map).toBeFocused();
    const before = (await snapshot(page)).draw;
    await map.dispatchEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, composed: true });
    expect((await snapshot(page)).draw).toEqual(before);
  });
}

test("zone perimeter closes automatically and supports extending dragging inserting deleting and undo", async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "draw" });
  await page.evaluate((tag) => {
    const element = document.querySelector(tag), state = element.getWorkspaceSnapshot();
    element.replaceWorkspaceState({ ...state, cameras: { top: { yaw: 0, pitch: 0, zoom: 2, targetX: 2.475, targetZ: -1.975 } },
      draw: { ...state.draw, circles: [], outline: null, undo: [], redo: [], strokeCount: 0, dirty: false } });
  }, GALLERY_TAG);
  await gallery.getByRole("button", { name: "Points", exact: true }).click();
  const canvas = gallery.locator(".scene-canvas");
  // The canvas carries no Points guidance; the panel's one hint does (map-surfaces.md §6, R10).
  await expect(gallery.locator(".zone-guidance")).toHaveCount(0);
  await expect(gallery.locator(".draw-hint")).toHaveText("Click to add points · right-drag to move the map");
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * .3 - 45, box.y + box.height * .25 - 40);
  const clear = gallery.getByRole("button", { name: "Clear", exact: true });
  await expect(clear).toBeEnabled();
  expect((await snapshot(page)).draw.circles).toHaveLength(0);
  await clear.click();
  await expect(gallery.locator(".zone-point:not(.zone-midpoint)")).toHaveCount(0);
  await gallery.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(gallery.locator(".zone-point:not(.zone-midpoint)")).toHaveCount(1);
  await clear.click();
  for (const [index, [x, y]] of [[-45, -40], [45, -40], [45, 40], [-45, 40]].entries()) {
    await page.mouse.click(box.x + box.width * .3 + x, box.y + box.height * .25 + y);
    const outline = (await snapshot(page)).draw.outline;
    expect(outline.points).toHaveLength(index + 1);
    expect(outline.closed).toBe(index >= 2);
  }
  await expect(gallery.locator(".zone-point:not(.zone-midpoint)")).toHaveCount(4);
  // An image ancestor flattens these controls out of Safari's native AX tree.
  const accessibleScene = await gallery.locator(".scene-window").ariaSnapshot();
  expect(accessibleScene).toMatch(/^- group /);
  expect(accessibleScene).toContain('button "Point 1"');
  expect(accessibleScene).not.toContain('button "Close zone"');
  await expect.poll(async () => (await snapshot(page)).draw.outline.closed).toBe(true);
  expect((await snapshot(page)).draw.circles.length).toBeGreaterThan(0);
  const closed = (await snapshot(page)).draw.outline;
  await gallery.getByRole("button", { name: "Point 1", exact: true }).click();
  expect((await snapshot(page)).draw.outline).toEqual(closed);
  const before = (await snapshot(page)).draw.outline;
  const first = gallery.getByRole("button", { name: "Point 1", exact: true });
  const unrotated = await first.boundingBox();
  await gallery.locator(".map-root").evaluate(element => {
    for (const [name,rotation] of [["gesturestart",0],["gesturechange",90],["gestureend",90]]) {
      const event=new Event(name,{bubbles:true,cancelable:true}); Object.assign(event,{scale:1,rotation}); element.dispatchEvent(event);
    }
  });
  await expect.poll(async () => (await snapshot(page)).cameras.top.yaw).toBeCloseTo(Math.PI/2);
  const handle = await first.boundingBox();
  expect(Math.hypot(handle.x-unrotated.x,handle.y-unrotated.y)).toBeGreaterThan(10);
  await page.mouse.move(handle.x + 22, handle.y + 22); await page.mouse.down();
  await page.mouse.move(handle.x + 12, handle.y + 17, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).draw.outline).not.toEqual(before);
  await first.focus();
  await gallery.getByRole("button", { name: "Insert point", exact: true }).click();
  await expect(gallery.locator(".zone-point:not(.zone-midpoint)")).toHaveCount(5);
  await gallery.getByRole("button", { name: "Point 2", exact: true }).press("Delete");
  await expect(gallery.locator(".zone-point:not(.zone-midpoint)")).toHaveCount(4);
  await gallery.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(gallery.locator(".zone-point:not(.zone-midpoint)")).toHaveCount(5);
  await gallery.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(gallery.locator(".zone-point:not(.zone-midpoint)")).toHaveCount(4);
});

test("renderer hides a new pose until the read-only scene is replaced", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/pose-readonly.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/pose-readonly.js");
    const scene = document.createElement("canvas"), overlay = document.createElement("canvas");
    for (const canvas of [scene, overlay]) {
      Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
      document.body.append(canvas);
    }
    let markers = 0;
    const context = overlay.getContext("2d"), originalArc = context.arc;
    context.arc = function(x, y, radius, ...rest) {
      if (radius === 7) markers++;
      return originalArc.call(this, x, y, radius, ...rest);
    };
    const renderer = new RendererController(scene, overlay);
    const initial = createGalleryState("ready");
    const state = { ...initial, map: { ...initial.map, exactPose: true },
      resources: { ...initial.resources, pose: { status: "ready", problem: null,
        value: { ...initial.resources.pose.value, position: [1.3, 1.6] } } } };
    const results = [];
    for (const readOnly of [true, false, true]) {
      markers = 0;
      renderer.setState({ ...state, floor: { ...state.floor, readOnly } });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      results.push(markers > 0);
    }
    renderer.dispose();
    return results;
  });
  expect(results).toEqual([false, true, false]);
});

test("rotated zone coordinates match rendered coverage and preserve zoom anchors", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/zone-projection.js", route => route.fulfill({contentType:"text/javascript",body:bundle.outputFiles[0].text}));
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const {RendererController,createGalleryState} = await import("/zone-projection.js");
    const scene = document.createElement("canvas"), overlay = document.createElement("canvas");
    for (const canvas of [scene,overlay]) {
      Object.assign(canvas.style,{position:"absolute",left:"31px",top:"47px",width:"720px",height:"540px"});
      document.body.append(canvas);
    }
    const arcs = [], context = overlay.getContext("2d"), originalArc = context.arc;
    context.arc = function(x,y,...rest) { arcs.push({x,y}); return originalArc.call(this,x,y,...rest); };
    const renderer = new RendererController(scene,overlay);
    const state = createGalleryState("draw"), point = {x:1.3,y:1.6};
    renderer.setState({...state, draw:{...state.draw,circles:[{...point,radius:.2}],outline:null},
      resources:{...state.resources,pose:{status:"empty",value:null,problem:null}}, selection:{...state.selection,roomIds:[]}});
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await frame();
    const bounds = scene.getBoundingClientRect(), results = [];
    for (const yaw of [0,Math.PI/2,-Math.PI/3,Math.PI]) {
      renderer.setCamera({...renderer.camera,yaw,targetX:.15,targetZ:-.1,distance:4});
      arcs.length=0; await frame();
      const rendered=arcs[0], projected=renderer.mapToScreen(point);
      const inverse=renderer.screenToMap(bounds.left+rendered.x,bounds.top+rendered.y);
      const moved=renderer.offsetMapPoint(point,.1,0), movedPixel=renderer.mapToScreen(moved);
      renderer.zoomAt(1.2,bounds.left+projected.x,bounds.top+projected.y);
      const anchored=renderer.mapToScreen(point);
      results.push({yaw,rendered,projected,inverse,movedPixel,anchored});
    }
    renderer.dispose(); return results;
  });
  for (const result of results) {
    expect(result.projected.x).toBeCloseTo(result.rendered.x,4);
    expect(result.projected.y).toBeCloseTo(result.rendered.y,4);
    expect(result.inverse.x).toBeCloseTo(1.3,5);
    expect(result.inverse.y).toBeCloseTo(1.6,5);
    expect(result.movedPixel.x).toBeGreaterThan(result.projected.x);
    expect(result.movedPixel.y).toBeCloseTo(result.projected.y,4);
    expect(result.anchored.x).toBeCloseTo(result.projected.x,3);
    expect(result.anchored.y).toBeCloseTo(result.projected.y,3);
  }
  expect(Math.hypot(results[1].projected.x-results[0].projected.x,results[1].projected.y-results[0].projected.y)).toBeGreaterThan(10);
});

test("zone keyboard creation and point editing stay local and undoable", async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "draw" });
  await gallery.getByRole("button", { name: "Points", exact: true }).click();
  const map = gallery.locator(".map-root");
  await map.focus();
  await map.press("ArrowDown"); await map.press("Enter");
  await expect(gallery.locator(".zone-point:not(.zone-midpoint)")).toHaveCount(1);
  await expect(gallery.locator(".action-bar").getByRole("button", { name: "Name and save", exact: true })).toBeDisabled();
  await map.press("ArrowLeft"); await map.press("Enter");
  await map.press("ArrowDown"); await map.press("Enter");
  await expect.poll(async () => (await snapshot(page)).draw.outline.closed).toBe(true);
  const before = (await snapshot(page)).draw.outline;
  await gallery.getByRole("button", { name: "Point 1", exact: true }).press("ArrowRight");
  await expect.poll(async () => (await snapshot(page)).draw.outline.points[0].x).toBeCloseTo(before.points[0].x - .02);
  await gallery.getByRole("button", { name: "Delete point 1", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).draw.outline.closed).toBe(false);
  await gallery.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).draw.outline.closed).toBe(true);
});

// shell.md §2 row 8: a map Home Assistant cannot confirm well enough cannot be
// edited, so Name and save is disabled and says why, as the strip's body does.
// (A degraded map shows no action button at all: `locating` has no button.)
for (const flag of ["complete", "floorCoherent", "sessionVerified"]) test(`Name and save explains itself when the map is not ${flag}`, async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "draw" });
  await gallery.getByRole("button", { name: "Points", exact: true }).click();
  const map = gallery.locator(".map-root");
  await map.focus();
  await map.press("ArrowDown"); await map.press("Enter");
  await map.press("ArrowLeft"); await map.press("Enter");
  await map.press("ArrowDown"); await map.press("Enter");
  await expect.poll(async () => (await snapshot(page)).draw.outline.closed).toBe(true);
  const save = gallery.locator(".action-bar").getByRole("button", { name: "Name and save", exact: true });
  await expect(save).toBeEnabled();
  await gallery.evaluate((element, flag) => {
    const state = element.getWorkspaceSnapshot();
    element.replaceWorkspaceState({ ...state, map: { ...state.map, [flag]: false } });
  }, flag);
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription("Can't save until Home Assistant can confirm this map.");
});

for (const [missing, reason] of [
  ["name", "Can't save until you name the area."],
  ["circles", "Can't save until you draw the area."],
]) test(`Save area names the missing ${missing} in its disabled reason`, async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "ready" });
  await gallery.evaluate((element, missing) => {
    const state = element.getWorkspaceSnapshot();
    element.replaceWorkspaceState({ ...state, workflow: "areaReview",
      areaDraft: { ...state.areaDraft, id: null, name: missing === "name" ? "" : "Kitchen corner", dirty: true },
      draw: { ...state.draw, circles: missing === "circles" ? [] : [{ x: 1, y: 1, radius: .2 }], dirty: true } });
  }, missing);
  const save = gallery.locator(".action-bar").getByRole("button", { name: "Save area", exact: true });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription(reason);
});

for (const change of ["revision", "floor", "session"]) test(`slow initial scene survives only a ${change} catalog update`, async ({ page }) => {
  await loadEffectHarness(page);
  await page.evaluate(async () => {
    const m = await import("/plan-recovery-test.js");
    const initial = m.createGalleryState("ready");
    const recovery = window.__slowScene = {
      entry: { ...initial.resources.entry, deltaUrl: null },
      store: new m.WorkspaceStore(), requests: [],
    };
    const backend = {
      dispose() {}, catalog: async () => [recovery.entry],
      scene: (_url, revision, _coherent, _source, signal) => new Promise((resolve, reject) => {
        const request = { revision, signal, resolve: (publishedRevision = revision) => resolve({ revision: publishedRevision, floorCoherent: true, scene: { ...initial.resources.scene.value, revision: publishedRevision } }) };
        recovery.requests.push(request);
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
      history: () => new Promise(resolve => { recovery.finishHistory = () => resolve(initial.resources.history.value); }),
      pose: async () => { throw new DOMException("Aborted", "AbortError"); },
      plans: async () => initial.resources.plans.value,
    };
    recovery.effects = new m.EffectController(recovery.store, backend);
    recovery.effects.sync({ userKey: "synthetic-user", entryKey: recovery.entry.entryId, host: initial.host, activity: "cleaning", batteryPercent: 90, robotLabel: initial.robotLabel, robots: initial.robots, language: "en" });
    await recovery.effects.refreshCatalog(true);
  });
  await expect.poll(() => page.evaluate(() => window.__slowScene.requests.length)).toBe(1);
  const result = await page.evaluate(async (change) => {
    const s = window.__slowScene;
    const first = s.requests[0];
    s.entry = { ...s.entry, mapRevision: s.entry.mapRevision + 1,
      ...(change === "floor" ? { selectedFloorOrdinal: 2, mapFloorOrdinal: 2 } : {}),
      ...(change === "session" ? { mapSessionKey: "b".repeat(64) } : {}),
    };
    const finishFirstHistory = s.finishHistory;
    await s.effects.refreshCatalog();
    const publishedRevision = first.revision + 2;
    first.resolve(publishedRevision);
    await Promise.resolve();
    finishFirstHistory();
    await Promise.resolve();
    const result = { history: s.store.value.resources.history.status, aborted: first.signal.aborted, requests: s.requests.length, available: s.store.value.map.available, advanced: s.store.value.resources.entry.mapRevision === publishedRevision };
    s.effects.dispose();
    return result;
  }, change);
  expect(result).toEqual(change === "revision"
    ? { history: "ready", aborted: false, requests: 1, available: true, advanced: true }
    : { history: "loading", aborted: true, requests: 2, available: false, advanced: false });
});

test("live scene recovers from a transient failure on an unchanged catalog", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/scene-recovery-test.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async () => {
    const m = await import("/scene-recovery-test.js");
    const initial = m.createGalleryState("ready");
    const entry = { ...initial.resources.entry, deltaUrl: null };
    const store = new m.WorkspaceStore();
    const recovery = window.__sceneRecovery = { store, calls: 0, healthy: false };
    const backend = {
      dispose: () => {}, catalog: async () => [entry],
      scene: async () => {
        recovery.calls++;
        if (!recovery.healthy) throw new Error("Temporary scene failure");
        return { revision: entry.mapRevision, floorCoherent: true, scene: initial.resources.scene.value };
      },
      history: async () => initial.resources.history.value,
      pose: async () => initial.resources.pose.value,
      plans: async () => initial.resources.plans.value,
    };
    const effects = recovery.effects = new m.EffectController(store, backend);
    effects.sync({userKey:"synthetic-user",entryKey:entry.entryId,host:initial.host,activity:initial.activity,batteryPercent:initial.batteryPercent,robotLabel:initial.robotLabel,robots:initial.robots,language:"en"}, undefined);
    await effects.refreshCatalog(true);
  });
  await expect.poll(() => page.evaluate(() => window.__sceneRecovery.store.value.resources.scene.status)).toBe("error");
  expect(await page.evaluate(() => window.__sceneRecovery.store.value.map.available)).toBe(false);
  await page.evaluate(async () => {
    window.__sceneRecovery.healthy = true;
    await window.__sceneRecovery.effects.refreshCatalog();
  });
  await expect.poll(() => page.evaluate(() => window.__sceneRecovery.store.value.map.available)).toBe(true);
  expect(await page.evaluate(() => window.__sceneRecovery.store.value.resources.scene.status)).toBe("ready");
  await page.evaluate(() => window.__sceneRecovery.effects.dispose());
});

for (const rejectedScene of ["revision", "floor", "empty"]) test(`live scene recovers after a rejected ${rejectedScene} response`, async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/scene-recovery-test.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async (rejectedScene) => {
    const m = await import("/scene-recovery-test.js");
    const initial = m.createGalleryState("ready");
    const entry = { ...initial.resources.entry, deltaUrl: null };
    const store = new m.WorkspaceStore();
    const recovery = window.__sceneRecovery = { store, calls: 0, healthy: false };
    const backend = {
      dispose: () => {}, catalog: async () => [entry],
      scene: async () => {
        recovery.calls++;
        if (!recovery.healthy) return { revision: entry.mapRevision - (rejectedScene === "revision" ? 1 : 0), floorCoherent: rejectedScene !== "floor", scene: rejectedScene === "empty" ? null : initial.resources.scene.value };
        return { revision: entry.mapRevision, floorCoherent: true, scene: initial.resources.scene.value };
      },
      // Isolate live-scene rejection; saved-map fallback has dedicated cases.
      history: async () => { throw new Error("No readable saved snapshots"); },
      pose: async () => initial.resources.pose.value,
      plans: async () => initial.resources.plans.value,
    };
    const effects = recovery.effects = new m.EffectController(store, backend);
    effects.sync({userKey:"synthetic-user",entryKey:entry.entryId,host:initial.host,activity:initial.activity,batteryPercent:initial.batteryPercent,robotLabel:initial.robotLabel,robots:initial.robots,language:"en"}, undefined);
    await effects.refreshCatalog(true);
    if (rejectedScene === "floor") {
      // Simulate the verified scene retained while a replacement is loading.
      store.patch({ resources: { ...store.value.resources, scene: initial.resources.scene }, map: { ...initial.map, available: true, floorCoherent: true, exactPose: true } });
      await effects.refreshCatalog(true);
    }
  }, rejectedScene);
  await expect.poll(() => page.evaluate(() => window.__sceneRecovery.store.value.resources.scene.status)).toBe("error");
  expect(await page.evaluate(() => window.__sceneRecovery.store.value.map.available)).toBe(rejectedScene === "floor");
  if (rejectedScene === "floor") {
    expect(await page.evaluate(() => {
      const state = window.__sceneRecovery.store.value;
      return { scene: state.resources.scene.value !== null, coherent: state.map.floorCoherent, pose: state.map.exactPose, status: state.coherence };
    })).toEqual({ scene: true, coherent: false, pose: false, status: "verifying" });
  }
  await page.evaluate(async () => {
    window.__sceneRecovery.healthy = true;
    await window.__sceneRecovery.effects.refreshCatalog();
  });
  await expect.poll(() => page.evaluate(() => window.__sceneRecovery.store.value.map.available)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__sceneRecovery.store.value.resources.scene.status)).toBe("ready");
  await page.evaluate(() => window.__sceneRecovery.effects.dispose());
});

test("saved areas recover when Draw opens before the live scene is ready", async ({ page }) => {
  const bundle = await build({ stdin: { contents: `export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "esm", write: false });
  await page.route("**/area-loading-test.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async () => {
    const m = await import("/area-loading-test.js");
    const initial = m.createGalleryState("ready");
    const entry = { ...initial.resources.entry, deltaUrl: null };
    const store = new m.WorkspaceStore();
    store.replace({ ...initial, resources: { ...initial.resources, scene: {status:"idle",value:null,problem:null}, areas: {status:"idle",value:null,problem:null} }, map: {...initial.map,available:false} });
    let releaseScene;
    const sceneReady = new Promise(resolve => { releaseScene = resolve; });
    window.__areaLoading = { store, calls: 0, releaseScene, mismatch: false };
    const backend = {
      dispose: () => {},
      catalog: async () => [entry],
      scene: async () => { await sceneReady; return { revision: entry.mapRevision, floorCoherent: true, scene: initial.resources.scene.value }; },
      history: async () => initial.resources.history.value,
      pose: async () => initial.resources.pose.value,
      plans: async () => initial.resources.plans.value,
      areas: async () => { window.__areaLoading.calls++; return {sceneUrl:window.__areaLoading.mismatch ? "/api/matic_robot/slam_scene/other" : entry.sceneUrl,rooms:[],areas:[{id:"saved",name:"Saved zone",circles:[],status:"current",canRebind:false}]}; },
    };
    const effects = new m.EffectController(store, backend);
    window.__areaLoading.effects = effects;
    effects.sync({userKey:"synthetic-user",entryKey:entry.entryId,host:initial.host,activity:initial.activity,batteryPercent:initial.batteryPercent,robotLabel:initial.robotLabel,robots:initial.robots,language:"en"}, undefined);
    await effects.refreshCatalog(true);
    await effects.openWorkflow("draw");
  });
  expect(await page.evaluate(() => window.__areaLoading.calls)).toBe(0);
  await page.evaluate(() => window.__areaLoading.releaseScene());
  await expect.poll(() => page.evaluate(() => window.__areaLoading.store.value.map.available)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__areaLoading.store.value.resources.areas.status)).toBe("ready");
  expect(await page.evaluate(() => window.__areaLoading.calls)).toBe(1);
  // A reconnect can leave metadata idle while retaining the rendered scene.
  // Recover it on a verified catalog poll, without accepting another scene.
  await page.evaluate(async () => {
    const s = window.__areaLoading;
    s.mismatch = true;
    s.store.patch({resources:{...s.store.value.resources,areas:{status:"idle",value:null,problem:null}}});
    await s.effects.refreshCatalog();
  });
  await expect.poll(() => page.evaluate(() => window.__areaLoading.store.value.resources.areas.status)).toBe("error");
  expect(await page.evaluate(() => window.__areaLoading.store.value.resources.areas.value)).toBeNull();
  await page.evaluate(async () => {
    window.__areaLoading.mismatch = false;
    await window.__areaLoading.effects.openWorkflow("draw");
  });
  await expect.poll(() => page.evaluate(() => window.__areaLoading.store.value.resources.areas.status)).toBe("ready");
  expect(await page.evaluate(() => window.__areaLoading.calls)).toBe(3);
  await page.evaluate(() => window.__areaLoading.effects.dispose());
});

test("zone geometry and saved perimeter survive the authenticated backend round trip", async ({ page }) => {
  const bundle = await build({ stdin: { contents: `export * from "./frontend/map-studio-v4/area-outline"; export { insideOutline, outlineCircles } from "./frontend/map-studio-v4/outline-editor"; export { MaticBackend } from "./frontend/map-studio-v4/backend"; export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore, selectPrimaryAction } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";`, resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/zone-contract.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const m = await import("/zone-contract.js");
    const outline = { closed: true, points: [{x:1,y:1},{x:3,y:1},{x:3,y:3},{x:1,y:3}] };
    const circles = m.outlineCircles(m, outline, () => true);
    const inscribed = circles.every(c => m.insideOutline(c, outline.points) && outline.points.every((a,i) => m.edgeDistance(c,a,outline.points[(i+1)%4]) >= c.radius));
    const crossed = m.validOutline({closed:true,points:[outline.points[0],outline.points[2],outline.points[1],outline.points[3]]});
    const store = new m.WorkspaceStore(); store.replace(m.createGalleryState("draw"));
    let saved, mutations = 0;
    const backend = new m.MaticBackend(() => ({ fetchWithAuth: async (path, init) => {
      if (init.method === "POST") { saved = JSON.parse(init.body); mutations++; return new Response(JSON.stringify({ id: "zone" })); }
      return new Response(JSON.stringify({scene_url:store.value.resources.entry.sceneUrl,rooms:[],areas:[{id:"zone",name:saved.name,circles:saved.circles,outline:saved.outline,cleaning_mode:saved.cleaning_mode,coverage_setting:saved.coverage_setting,status:"current",can_rebind:false}]}));
    }}));
    const effects = new m.EffectController(store, backend);
    store.patch({ areaDraft: {...store.value.areaDraft,id:null,name:""},draw:{...store.value.draw,circles,outline,dirty:true}});
    for (const narrowHint of [false, true]) {
      store.patch({workflow:"draw",narrowHint});
      const action = m.selectPrimaryAction(store.value);
      if (!action.enabled || action.id !== "review-area") throw new Error("Unnamed zone must open its review form");
      await effects.executeAction(action.id);
      if (store.value.workflow !== "areaReview" || mutations !== 0) throw new Error("Review must precede saving");
    }
    store.patch({areaDraft:{...store.value.areaDraft,name:"Zone"}});
    await effects.executeAction(m.selectPrimaryAction(store.value).id);
    const loaded = await backend.areas(store.value.resources.entry.areasUrl);
    store.patch({ resources: {...store.value.resources, areas: {status:"ready",value:loaded,problem:null}} });
    effects.selectArea("zone");
    const reopened = store.value.draw.outline;
    store.patch({workflow:"draw"});
    if (!m.selectPrimaryAction(store.value).enabled) throw new Error("Saved unchanged outline must return to review");
    effects.dispose();
    return {inscribed,crossed,count:circles.length,mutations, savedPoints:saved.outline, reopened};
  });
  expect(result.inscribed).toBe(true); expect(result.crossed).toBe(false);
  expect(result.count).toBeGreaterThan(0); expect(result.count).toBeLessThanOrEqual(512);
  expect(result.mutations).toBe(1); expect(result.reopened).toEqual({closed:true,points:result.savedPoints});
});

for (const device of [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "tablet portrait", width: 820, height: 1180, touch: true },
  { name: "tablet landscape", width: 1180, height: 820, touch: true },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "small phone", width: 320, height: 740, touch: true },
]) for (const scheme of ["light", "dark"]) {
  test(`zone controls fit and edit on ${device.name} in ${scheme}${device.touch ? " @mobile" : ""}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.emulateMedia({ colorScheme: scheme });
    const gallery = await loadGallery(page, { scenario: "draw" });
    await page.evaluate((tag) => {
      const e = document.querySelector(tag), s = e.getWorkspaceSnapshot();
      const stage = e.shadowRoot.querySelector(".stage");
      stage.style.blockSize = "100dvh"; stage.style.minBlockSize = "0"; stage.style.maxInlineSize = "none";
      e.replaceWorkspaceState({ ...s, draw: { ...s.draw, tool: "outline", undo: [], redo: [],
        outline: { closed: true, points: [{x:1,y:1},{x:3.5,y:1},{x:3.5,y:2.5},{x:1,y:2.5}] },
        circles: [{x:2.25,y:1.75,radius:.7}] } });
    }, GALLERY_TAG);
    await expect(gallery.getByRole("button", { name: "Points", exact: true })).toHaveAttribute("aria-pressed", "true");
    const first = gallery.getByRole("button", { name: "Point 1", exact: true });
    if (device.touch) await first.tap(); else await first.click();
    await expect(gallery.getByRole("button", { name: "Insert point", exact: true })).toBeVisible();
    await expect(gallery.getByRole("button", {name:"Name and save",exact:true})).toBeEnabled();
    const targets = gallery.locator(".zone-point, .draw-tools button, .zone-help button, .action-bar button");
    for (const target of await targets.all()) {
      const box = await target.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(device.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(device.height + 1);
      if (await target.isDisabled()) continue;
      expect(await target.evaluate(button => {
        const r = button.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        let hit = document.elementFromPoint(x, y);
        for (let i = 0; hit?.shadowRoot && i < 12; i++) { const next = hit.shadowRoot.elementFromPoint(x,y); if (!next || next === hit) break; hit = next; }
        return hit === button || button.contains(hit);
      }), await target.getAttribute("aria-label") || await target.innerText()).toBe(true);
    }
    const scale = await gallery.locator(".map-scale").boundingBox(), hint = await gallery.locator(".zone-help").boundingBox();
    expect(scale.x < hint.x + hint.width && scale.x + scale.width > hint.x && scale.y < hint.y + hint.height && scale.y + scale.height > hint.y).toBe(false);
    const pointActions = gallery.locator(".zone-point-actions");
    const row = await pointActions.boundingBox();
    expect(row.height).toBeLessThanOrEqual(56);
    expect(row.width).toBeLessThanOrEqual(300);
    await expect(pointActions.locator(".zone-selection")).toHaveText("Point 1");
    await expect(gallery.locator(".zone-guidance")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${device.name.replaceAll(" ", "-")}-${scheme}-selected.png`) });
    const insert = gallery.getByRole("button", { name: "Insert point", exact: true });
    if (device.touch) await insert.tap(); else await insert.click();
    await expect.poll(async () => (await snapshot(page)).draw.outline.points.length).toBe(5);
    const remove = gallery.getByRole("button", { name: "Delete point 2", exact: true });
    if (device.touch) await remove.tap(); else await remove.click();
    await expect.poll(async () => (await snapshot(page)).draw.outline.points.length).toBe(4);
    await page.screenshot({ path: testInfo.outputPath(`${device.name.replaceAll(" ", "-")}-${scheme}.png`) });
  });
}

for (const interruption of ["Escape", "pointer cancel", "floor revalidation"]) {
  test(`zone drag rolls back on ${interruption}`, async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    await page.evaluate(tag => {
      const e = document.querySelector(tag), s = e.getWorkspaceSnapshot();
      e.replaceWorkspaceState({...s, draw:{...s.draw,tool:"outline",outline:{closed:true,points:[{x:1,y:1},{x:3.5,y:1},{x:3.5,y:2.5},{x:1,y:2.5}]},circles:[{x:2,y:1.75,radius:.5}]}});
    }, GALLERY_TAG);
    const first = gallery.getByRole("button", { name: "Point 1", exact: true });
    const before = (await snapshot(page)).draw;
    const box = await first.boundingBox();
    await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down();
    await page.mouse.move(box.x + 32, box.y + 25, {steps:3});
    if (interruption === "Escape") await page.keyboard.press("Escape");
    else if (interruption === "pointer cancel") await first.dispatchEvent("pointercancel", {pointerId:1,bubbles:true,composed:true});
    else await page.evaluate(tag => { const e=document.querySelector(tag),s=e.getWorkspaceSnapshot();e.replaceWorkspaceState({...s,coherence:"verifying"}); }, GALLERY_TAG);
    await page.mouse.up();
    expect((await snapshot(page)).draw).toEqual(before);
  });
}

test("painting can undo back to an editable perimeter and ignores no-op marks", async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "draw" });
  await gallery.getByRole("button", { name: "Points", exact: true }).click();
  const map = gallery.locator(".map-root");
  await map.focus();
  await map.press("ArrowDown"); await map.press("Enter");
  await map.press("ArrowLeft"); await map.press("Enter");
  await map.press("ArrowDown"); await map.press("Enter");
  const zone = (await snapshot(page)).draw.outline;
  await gallery.getByRole("button", { name: "Paint", exact: true }).click();
  await map.focus(); await map.press("ArrowLeft"); await map.press("Enter");
  await expect.poll(async () => (await snapshot(page)).draw.outline).toBeNull();
  const paintedCircle = (await snapshot(page)).draw.circles.at(-1);
  await gallery.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).draw.outline).toEqual(zone);
  // A pointer click on an already painted circle must preserve the perimeter.
  await page.evaluate(({tag, paintedCircle}) => {
    const e=document.querySelector(tag),s=e.getWorkspaceSnapshot();
    e.replaceWorkspaceState({...s,draw:{...s.draw,circles:[paintedCircle]}});
  },{tag:GALLERY_TAG,paintedCircle});
  await map.focus();
  const box = await gallery.locator(".scene-canvas").boundingBox();
  await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
  expect((await snapshot(page)).draw.outline).toEqual(zone);
});

test("companion safe areas keep navigation and drawing actions clear of system UI", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const gallery = await loadGallery(page, { narrow: true });
  await gallery.evaluate((element) => {
    element.style.setProperty("--safe-area-inset-top", "62px");
    element.style.setProperty("--safe-area-inset-bottom", "34px");
  });
  const navigation = gallery.getByRole("button", { name: "Open Home Assistant sidebar", exact: true });
  const bar = gallery.locator(".app-bar");
  await expect.poll(async () => (await navigation.boundingBox())?.y).toBeGreaterThanOrEqual(62);
  const initialHeight = (await bar.boundingBox()).height;
  await gallery.getByRole("button", { name: /Clean custom area/ }).click();
  await gallery.getByRole("button", { name: "New area", exact: true }).click();
  const clear = gallery.getByRole("button", { name: "Clear", exact: true });
  const clearBox = await clear.boundingBox();
  expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(844 - 34);
  await expect(gallery.locator(".mobile-sheet")).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await gallery.evaluate((element) => {
    element.style.setProperty("--safe-area-inset-top", "0px");
    element.style.setProperty("--safe-area-inset-left", "62px");
    element.style.setProperty("--safe-area-inset-right", "62px");
    element.style.setProperty("--safe-area-inset-bottom", "21px");
  });
  await expect.poll(async () => Math.round(initialHeight - (await bar.boundingBox()).height)).toBe(62);
  const floor = await gallery.getByRole("combobox", { name: "Choose floor" }).boundingBox();
  expect(floor.x).toBeGreaterThanOrEqual(62);
  const fit = await gallery.getByRole("button", { name: "Fit the whole map on screen" }).boundingBox();
  expect(fit.x + fit.width).toBeLessThanOrEqual(844 - 62);
  const overflow = gallery.getByRole("button", { name: "Map options", exact: true });
  const overflowBox = await overflow.boundingBox();
  expect(overflowBox.x + overflowBox.width).toBeLessThanOrEqual(844 - 62);
  await page.setViewportSize({ width: 390, height: 844 });
  await gallery.evaluate((element) => {
    for (const edge of ["top", "right", "bottom", "left"]) element.style.setProperty(`--safe-area-inset-${edge}`, "0px");
  });
  await expect.poll(async () => (await navigation.boundingBox())?.y).toBeLessThan(20);
});

test("plan catalog refresh preserves explicit selection and reconciles a saved new plan", async ({ page }) => {
  await loadEffectHarness(page);
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
    const initial = createGalleryState("ready");
    const store = new WorkspaceStore(initial);
    let catalog = initial.resources.plans.value;
    const second = { ...catalog.plans[0], id: "second", name: "Evening routine", enabled: false };
    catalog = { ...catalog, plans: [...catalog.plans, second] };
    let writes = 0;
    const effects = new EffectController(store, {
      catalog: async () => [initial.resources.entry],
      history: async () => initial.resources.history.value,
      scene: async () => { throw new DOMException("Aborted", "AbortError"); },
      pose: async () => { throw new DOMException("Aborted", "AbortError"); },
      plans: async () => catalog,
      service: async () => {
        writes += 1;
        catalog = { ...catalog, selectedPlan: "new", plans: [...catalog.plans, { ...second, id: "new", name: "New routine", enabled: true }] };
        return { response: { plan: { id: "new" } } };
      },
      dispose() {},
    });
    try {
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test",
        entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      await effects.refreshCatalog(true);
      for (let i = 0; i < 20 && store.value.resources.plans.status === "loading"; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      store.patch({ coherence: "current", floor: initial.floor, resources: { ...store.value.resources, scene: initial.resources.scene } });
      await effects.loadPlans();
      effects.selectPlan("second");
      await effects.loadPlans();
      const selected = { id: store.value.planDraft.id, name: store.value.planDraft.name };
      effects.selectPlan(null);
      await effects.loadPlans();
      const blank = { id: store.value.planDraft.id, name: store.value.planDraft.name, enabled: store.value.planDraft.enabled };
      store.patch({ coherence: "current", floor: initial.floor, resources: { ...store.value.resources, scene: initial.resources.scene },
        planDraft: { ...store.value.planDraft, name: "New routine", rooms: second.rooms, dirty: true } });
      await effects.savePlan();
      return { selected, blank, savedId: store.value.planDraft.id, dirty: store.value.planDraft.dirty, writes };
    } finally { effects.dispose(); }
  });
  expect(result).toEqual({ selected: { id: "second", name: "Evening routine" }, blank: { id: null, name: "", enabled: true }, savedId: "new", dirty: false, writes: 1 });
});

for (const boundary of ["service", "catalog"]) {
  test(`late plan save ${boundary} completion preserves navigation and later drafts`, async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async (boundary) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const results = [];
      for (const destination of ["plans", "none", "other-editor"]) {
        const initial = createGalleryState("ready");
        const store = new WorkspaceStore({ ...initial, workflow: "plan", planDraft: { ...initial.planDraft, dirty: true } });
        let finish;
        const pending = new Promise((resolve) => { finish = resolve; });
        let reading = false;
        const effects = new EffectController(store, { service: async () => { if (boundary === "service") await pending; }, dispose() {} });
        effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92,
          robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test",
          entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
        effects.loadPlans = async () => { reading = true; if (boundary === "catalog") await pending; };
        try {
          const saving = effects.savePlan();
          if (boundary === "catalog") {
            for (let i = 0; i < 20 && !reading; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
            if (!reading) throw new Error("Save did not reach catalog refresh");
          }
          store.dispatch({ type: "discard-draft" });
          store.dispatch({ type: "open-workflow", workflow: destination === "other-editor" ? "plan" : destination });
          if (destination === "other-editor") store.patch({ planDraft: { ...initial.planDraft, id: "second", name: "Keep later edits", dirty: true } });
          const expected = { workflow: store.value.workflow, draft: store.value.planDraft };
          finish();
          await saving;
          results.push({ expected, actual: { workflow: store.value.workflow, draft: store.value.planDraft } });
        } finally { effects.dispose(); }
      }
      return results;
    }, boundary);
    for (const row of result) expect(row.actual).toEqual(row.expected);
  });
}

test("late plan deletion clears the deleted identity without replacing another workflow", async ({ page }) => {
  await loadEffectHarness(page);
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
    const results = [];
    for (const destination of ["rooms", "none", "plans", "other-editor", "same-editor"]) {
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore({ ...initial, workflow: "plan" });
      let finish;
      const pending = new Promise((resolve) => { finish = resolve; });
      const effects = new EffectController(store, { service: async () => pending, dispose() {} });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test",
        entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      effects.loadPlans = async () => {};
      try {
        const deleting = effects.deletePlan();
        store.dispatch({ type: "open-workflow", workflow: destination.endsWith("editor") ? "plan" : destination });
        if (destination === "other-editor") store.patch({ selection: { ...store.value.selection, planId: "second" }, planDraft: { ...initial.planDraft, id: "second", name: "Keep later edits", dirty: true } });
        finish();
        await deleting;
        results.push({ destination, workflow: store.value.workflow, id: store.value.planDraft.id, dirty: store.value.planDraft.dirty });
      } finally { effects.dispose(); }
    }
    return results;
  });
  expect(result).toEqual([
    { destination: "rooms", workflow: "rooms", id: null, dirty: false },
    { destination: "none", workflow: "none", id: null, dirty: false },
    { destination: "plans", workflow: "plans", id: null, dirty: false },
    { destination: "other-editor", workflow: "plan", id: "second", dirty: true },
    { destination: "same-editor", workflow: "plans", id: null, dirty: false },
  ]);
});

// plan.md §5 State, Map, Navigation; home-rooms.md §5 selection gate.
test.describe("plan view state", () => {
  // Dispatches `intents` to a store holding the gallery scenario (with `patch`
  // spread over it) and returns the fields these rules change.
  async function run(page, scenario, intents, patch = {}) {
    await loadEffectHarness(page);
    return page.evaluate(async ({ scenario, intents, patch }) => {
      const { WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const store = new WorkspaceStore({ ...createGalleryState(scenario), ...patch });
      const before = store.value;
      for (const intent of intents) store.dispatch(intent);
      const state = store.value;
      return {
        unchanged: state === before,
        workflow: state.workflow,
        planView: state.planView,
        expandedRoom: state.expandedRoom,
        dialog: state.dialog,
        planId: state.selection.planId,
        draft: { id: state.planDraft.id, dirty: state.planDraft.dirty, enabled: state.planDraft.enabled,
          rooms: state.planDraft.rooms.map((room) => room.roomId), parked: state.planDraft.parkedRooms },
        selectedRooms: state.selection.roomIds,
      };
    }, { scenario, intents, patch });
  }

  test("starts in Run with nothing pending and no open row", async ({ page }) => {
    await loadEffectHarness(page);
    const initial = await page.evaluate(async () => {
      const { WorkspaceStore } = await import("/plan-recovery-test.js");
      const { planView, pendingAction, expandedRoom, planDraft } = new WorkspaceStore().value;
      return { planView, pendingAction, expandedRoom, parked: planDraft.parkedRooms };
    });
    expect(initial).toEqual({ planView: "run", pendingAction: null, expandedRoom: null, parked: [] });
  });

  test("select-plan opens Create in Edit and a saved plan in Run", async ({ page }) => {
    expect(await run(page, "plans", [{ type: "select-plan", planId: null }]))
      .toMatchObject({ workflow: "plan", planView: "edit", expandedRoom: null, planId: null });
    expect(await run(page, "plans", [{ type: "select-plan", planId: "weekend" }]))
      .toMatchObject({ workflow: "plan", planView: "run", expandedRoom: null, planId: "weekend" });
    // Entering the plan workflow opens Run even for the plan already selected.
    expect(await run(page, "plans", [{ type: "select-plan", planId: "daily" }]))
      .toMatchObject({ workflow: "plan", planView: "run", planId: "daily" });
    // Another saved plan from an open Edit opens in Run and closes the row.
    expect(await run(page, "plans", [
      { type: "select-plan", planId: "daily" },
      { type: "set-plan-view", view: "edit", roomId: "room-a" },
      { type: "select-plan", planId: "weekend" },
    ])).toMatchObject({ workflow: "plan", planView: "run", expandedRoom: null, planId: "weekend" });
  });

  test("reselecting the open plan keeps its view and open row", async ({ page }) => {
    expect(await run(page, "plan-saved-intelligent", [
      { type: "set-plan-view", view: "edit", roomId: "room-b" },
      { type: "select-plan", planId: "daily" },
    ])).toMatchObject({ workflow: "plan", planView: "edit", expandedRoom: "room-b", planId: "daily" });
  });

  test("leaving the plan workflow resets the view, Try again keeps it", async ({ page }) => {
    const edit = { type: "set-plan-view", view: "edit", roomId: "room-a" };
    expect(await run(page, "plan-saved-intelligent", [edit, { type: "open-workflow", workflow: "rooms" }]))
      .toMatchObject({ workflow: "rooms", planView: "run", expandedRoom: null });
    expect(await run(page, "plan-saved-intelligent", [edit, { type: "open-workflow", workflow: "plan" }]))
      .toMatchObject({ workflow: "plan", planView: "edit", expandedRoom: "room-a" });
    expect(await run(page, "plan-saved-intelligent", [edit, { type: "return-live" }]))
      .toMatchObject({ workflow: "none", planView: "run", expandedRoom: null });
  });

  test("set-plan-view edit opens, keeps or closes the room row", async ({ page }) => {
    expect(await run(page, "plan-saved-intelligent", [{ type: "set-plan-view", view: "edit", roomId: "room-a" }]))
      .toMatchObject({ planView: "edit", expandedRoom: "room-a" });
    expect(await run(page, "plan-saved-intelligent", [
      { type: "set-plan-view", view: "edit", roomId: "room-a" },
      { type: "set-plan-view", view: "edit" },
    ])).toMatchObject({ planView: "edit", expandedRoom: "room-a" });
    expect(await run(page, "plan-saved-intelligent", [
      { type: "set-plan-view", view: "edit", roomId: "room-a" },
      { type: "set-plan-view", view: "edit", roomId: null },
    ])).toMatchObject({ planView: "edit", expandedRoom: null });
    expect(await run(page, "plans", [{ type: "set-plan-view", view: "edit", roomId: "room-a" }]))
      .toMatchObject({ unchanged: true, workflow: "plans" });
  });

  test("set-plan-view run needs a saved, clean draft", async ({ page }) => {
    expect(await run(page, "plan-saved-intelligent", [
      { type: "set-plan-view", view: "edit", roomId: "room-a" },
      { type: "set-plan-view", view: "run" },
    ])).toMatchObject({ planView: "run", expandedRoom: null });
    expect(await run(page, "plan-dirty", [{ type: "set-plan-view", view: "run" }]))
      .toMatchObject({ unchanged: true, planView: "edit" });
    expect(await run(page, "plan-new", [{ type: "set-plan-view", view: "run" }]))
      .toMatchObject({ unchanged: true, planView: "edit" });
  });

  test("set-plan-enabled reflects the Run switch on a saved, clean draft only", async ({ page }) => {
    expect(await run(page, "plan-saved-intelligent", [{ type: "set-plan-enabled", enabled: false }]))
      .toMatchObject({ planView: "run", draft: { id: "daily", enabled: false, dirty: false } });
    expect(await run(page, "plan-dirty", [{ type: "set-plan-enabled", enabled: false }]))
      .toMatchObject({ unchanged: true });
    expect(await run(page, "plan-cadence-shared", [{ type: "set-plan-enabled", enabled: false }]))
      .toMatchObject({ unchanged: true });
    expect(await run(page, "plan-new", [{ type: "set-plan-enabled", enabled: false }]))
      .toMatchObject({ unchanged: true });
    expect(await run(page, "plans", [{ type: "set-plan-enabled", enabled: false }]))
      .toMatchObject({ unchanged: true });
  });

  test("discarding returns a saved plan to Run and a new plan to the picker", async ({ page }) => {
    expect(await run(page, "plan-dirty", [
      { type: "set-plan-view", view: "edit", roomId: "room-a" },
      { type: "open-dialog", dialog: "discardDraft" },
      { type: "discard-draft" },
    ])).toMatchObject({ workflow: "plan", planView: "run", expandedRoom: null, dialog: null, planId: "daily",
      draft: { id: "daily", dirty: false, rooms: ["room-a", "room-b", "room-c"], parked: [] } });
    expect(await run(page, "plan-new", [
      { type: "toggle-room", roomId: "room-a" },
      { type: "discard-draft" },
    ])).toMatchObject({ workflow: "plans", planView: "run", dialog: null, planId: null, draft: { id: null, dirty: false, rooms: [] } });
    // A saved plan the catalog no longer holds has no Run view to return to.
    expect(await page.evaluate(async () => {
      const { WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const state = createGalleryState("plan-dirty");
      const store = new WorkspaceStore({ ...state, resources: { ...state.resources,
        plans: { ...state.resources.plans, value: { ...state.resources.plans.value, plans: [] } } } });
      store.dispatch({ type: "discard-draft" });
      const { workflow, planView, selection, planDraft } = store.value;
      return { workflow, planView, planId: selection.planId, id: planDraft.id, dirty: planDraft.dirty };
    })).toEqual({ workflow: "plans", planView: "run", planId: null, id: null, dirty: false });
  });

  test("a reload without the open saved plan leaves for Your plans and says it was removed", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState, layerDepth } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("plans");
      const store = new WorkspaceStore(initial);
      const catalog = { deleted: false };
      const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry], scene: aborted, pose: aborted,
        history: async () => initial.resources.history.value,
        plans: async () => {
          const value = structuredClone(initial.resources.plans.value);
          return catalog.deleted ? { ...value, plans: value.plans.filter((plan) => plan.id !== "daily" && plan.id !== catalog.deleted) } : value;
        },
        areas: async () => initial.resources.areas.value,
        dispose() {},
      });
      try {
        effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
        await effects.refreshCatalog(true);
        store.patch({ map: initial.map, coherence: "current" });
        await effects.loadPlans({ force: true });
        effects.selectPlan("daily");
        const opened = { planView: store.value.planView, id: store.value.planDraft.id };
        catalog.deleted = true;
        await effects.loadPlans({ force: true });
        const run = store.value;
        effects.selectPlan("weekend");
        store.patch({ notice: null });
        store.dispatch({ type: "set-plan-view", view: "edit" });
        const editing = { planView: store.value.planView, id: store.value.planDraft.id };
        catalog.deleted = "weekend";
        await effects.loadPlans({ force: true });
        const edit = store.value;
        const read = (state) => ({ workflow: state.workflow, planView: state.planView, expandedRoom: state.expandedRoom,
          planId: state.selection.planId, id: state.planDraft.id, notice: state.notice?.key, depth: layerDepth(state) });
        return { opened, run: read(run), editing, edit: read(edit) };
      } finally { effects.dispose(); }
    });
    const left = { workflow: "plans", planView: "run", expandedRoom: null, planId: null, id: null,
      notice: "v4_notice_plan_removed", depth: 1 };
    expect(result).toEqual({ opened: { planView: "run", id: "daily" }, run: left,
      editing: { planView: "edit", id: "weekend" }, edit: left });
  });

  test("dismissing steps Edit to Run, then Run or a new plan to the picker", async ({ page }) => {
    const dismiss = { type: "dismiss-top-layer" };
    expect(await run(page, "plan-saved-intelligent", [{ type: "set-plan-view", view: "edit", roomId: "room-a" }, dismiss]))
      .toMatchObject({ workflow: "plan", planView: "run", expandedRoom: null });
    expect(await run(page, "plan-saved-intelligent", [dismiss])).toMatchObject({ workflow: "plans", planView: "run" });
    expect(await run(page, "plan-new", [dismiss])).toMatchObject({ workflow: "plans", planView: "run" });
    expect(await run(page, "plan-dirty", [dismiss])).toMatchObject({ workflow: "plan", planView: "edit", dialog: "discardDraft" });
    expect(await run(page, "plans", [dismiss])).toMatchObject({ workflow: "none" });
  });

  test("map taps never change the plan in Run", async ({ page }) => {
    expect(await run(page, "plan-saved-intelligent", [{ type: "toggle-room", roomId: "room-d" }]))
      .toMatchObject({ unchanged: true });
  });

  test("unticking a room in Edit parks its settings until it is ticked again", async ({ page }) => {
    const parked = await run(page, "plan-cadence-shared", [{ type: "toggle-room", roomId: "room-a" }]);
    expect(parked.draft.rooms).toEqual(["room-b", "room-c"]);
    expect(parked.draft.parked.map((room) => room.roomId)).toEqual(["room-a"]);
    expect(parked.draft.parked[0].cadence).toBeTruthy();
    const restored = await page.evaluate(async () => {
      const { WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const store = new WorkspaceStore(createGalleryState("plan-cadence-shared"));
      const saved = store.value.planDraft.rooms[0];
      store.dispatch({ type: "toggle-room", roomId: "room-b" });
      store.dispatch({ type: "toggle-room", roomId: "room-a" });
      store.dispatch({ type: "toggle-room", roomId: "room-a" });
      store.dispatch({ type: "toggle-room", roomId: "room-d" });
      const { rooms, parkedRooms, dirty } = store.value.planDraft;
      return { rooms, parked: parkedRooms.map((room) => room.roomId), dirty, same: JSON.stringify(rooms[1]) === JSON.stringify(saved) };
    });
    expect(restored).toMatchObject({ parked: ["room-b"], dirty: true, same: true });
    expect(restored.rooms.map((room) => room.roomId)).toEqual(["room-c", "room-a", "room-d"]);
    expect(restored.rooms[2]).toEqual({ roomId: "room-d", cleaningMode: "vacuum", coverageSetting: "standard" });
  });

  test("the plan room limit still refuses a new room in Edit", async ({ page }) => {
    expect(await run(page, "plan-legacy-oversized", [{ type: "toggle-room", roomId: "room-extra" }]))
      .toMatchObject({ unchanged: true });
  });

  test("Rooms selection waits for an editable map with no robot work to stop", async ({ page }) => {
    const toggle = [{ type: "open-workflow", workflow: "rooms" }, { type: "toggle-room", roomId: "room-a" }];
    expect((await run(page, "ready", toggle)).selectedRooms).toEqual(["room-a"]);
    expect((await run(page, "ready", toggle, { activity: "cleaning" })).selectedRooms).toEqual([]);
    expect((await run(page, "ready", toggle, { coherence: "degraded" })).selectedRooms).toEqual([]);
  });

  test("a dirty plan draft asks before going to Run", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-dirty" });
    await expect(gallery.getByRole("textbox", { name: "Plan name" })).toBeVisible();
    await page.evaluate((tag) => {
      const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
      const body = [...shell.shadowRoot.querySelectorAll("*")].find((element) => element.localName.startsWith("matic-map-workflow-v4"));
      body.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-plan-view", view: "run" }, bubbles: true, composed: true,
      }));
    }, GALLERY_TAG);
    await expect(gallery.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    const state = await snapshot(page);
    expect({ planView: state.planView, dirty: state.planDraft.dirty }).toEqual({ planView: "edit", dirty: true });
  });

  test("layerDepth puts Run and a new plan's Edit under a saved plan's Edit", async ({ page }) => {
    await loadEffectHarness(page);
    const depths = await page.evaluate(async () => {
      const { createGalleryState, layerDepth } = await import("/plan-recovery-test.js");
      return ["ready", "plans", "plan-saved-intelligent", "plan-new", "plan-dirty"]
        .map((scenario) => layerDepth(createGalleryState(scenario)));
    });
    expect(depths).toEqual([0, 1, 2, 2, 3]);
  });
});

test.describe("plan primary action", () => {
  // The primary action for a gallery scenario with `state` spread over it, the
  // open plan's catalog entry patched with `plan`, its preview with `preview`,
  // `reasons[roomId]` as that saved room's cadenceReasons, and `draft` over the
  // plan draft.
  async function primary(page, scenario, { state = {}, plan = {}, preview = {}, reasons = {}, draft = {} } = {}) {
    await loadEffectHarness(page);
    return page.evaluate(async ({ scenario, state, plan, preview, reasons, draft }) => {
      const { createGalleryState, selectPrimaryAction } = await import("/plan-recovery-test.js");
      const base = createGalleryState(scenario);
      const catalog = base.resources.plans.value;
      const plans = catalog.plans.map((saved) => saved.id !== base.planDraft.id ? saved : {
        ...saved,
        ...plan,
        rooms: (plan.rooms ?? saved.rooms).map((room) => room.roomId in reasons ? { ...room, cadenceReasons: reasons[room.roomId] } : room),
        nextRunPreview: { ...saved.nextRunPreview, ...preview },
      });
      const resources = { ...base.resources, plans: { ...base.resources.plans, value: { ...catalog, plans } } };
      const { id, label, labelKey, enabled, reason, reasonKey, reasonPlaceholders, jump } =
        selectPrimaryAction({ ...base, resources, planDraft: { ...base.planDraft, ...draft }, ...state });
      return { id, label, labelKey, enabled, reason, reasonKey, reasonPlaceholders, jump };
    }, { scenario, state, plan, preview, reasons, draft });
  }
  const run = { planView: "run" };
  const blocked = { blocker: "invalid_cadence_policy", rooms: [] };

  test("routes Edit, a dirty draft and a new plan to Save, a clean saved plan to Done", async ({ page }) => {
    expect(await primary(page, "plan-saved-intelligent"))
      .toMatchObject({ id: "run-plan", label: "Run plan", enabled: true, reason: undefined });
    expect(await primary(page, "plan-saved-intelligent", { state: { planView: "edit" } }))
      .toMatchObject({ id: "save-plan", label: "Done", labelKey: "v4_action_done", enabled: true });
    expect(await primary(page, "plan-dirty"))
      .toMatchObject({ id: "save-plan", label: "Save", labelKey: "v4_action_save_plan" });
    expect(await primary(page, "plan-new"))
      .toMatchObject({ id: "save-plan", label: "Save", labelKey: "v4_action_save_plan" });
  });

  test("Save is disabled while a save is pending, then names the map, the limit or the form", async ({ page }) => {
    expect(await primary(page, "plan-dirty", { state: { command: "pending", pendingAction: "save-plan" } })).toMatchObject({
      id: "save-plan", label: "Save", enabled: false,
      reason: "Waiting for Home Assistant to save the plan.", reasonKey: "v4_reason_plan_saving",
    });
    expect(await primary(page, "plan-saved-intelligent", { state: { planView: "edit", pageActive: false } }))
      .toMatchObject({ label: "Done", enabled: false, reason: "Waiting for the map to be ready.", reasonKey: "v4_reason_save_plan_map" });
    expect(await primary(page, "plan-legacy-oversized"))
      .toMatchObject({ label: "Done", enabled: false, reasonKey: "v4_reason_save_plan_room_limit" });
    expect(await primary(page, "plan-new")).toMatchObject({ enabled: false, reasonKey: "v4_reason_save_plan" });
  });

  test("Run plan waits for the next-run check or a plan save before the robot fallback", async ({ page }) => {
    expect(await primary(page, "plan-saved-intelligent", { state: { command: "pending", pendingAction: "run-plan" } })).toMatchObject({
      id: "run-plan", enabled: false,
      reason: "Waiting for Home Assistant to check the next run.", reasonKey: "v4_reason_run_plan_checking",
    });
    expect(await primary(page, "plan-saved-intelligent", { state: { command: "pending", pendingAction: "save-plan" } }))
      .toMatchObject({ id: "run-plan", enabled: false, reasonKey: "v4_reason_plan_saving" });
    expect(await primary(page, "plan-saved-intelligent", { state: { command: "pending" } }))
      .toMatchObject({ id: "run-plan", enabled: false, reasonKey: "v4_reason_robot_operation_waiting" });
  });

  test("a paused plan says so before any blocker; a malformed token asks for a retry", async ({ page }) => {
    expect(await primary(page, "plan-cadence-blocked", { state: run, draft: { enabled: false } })).toMatchObject({
      id: "run-plan", enabled: false,
      reason: "Can't run this plan until you turn it on.", reasonKey: "v4_reason_run_plan_paused", jump: undefined,
    });
    expect(await primary(page, "plan-saved-intelligent", { preview: { previewToken: "not-a-token" } })).toMatchObject({
      enabled: false, reason: "Can't run this plan until you retry its next-run preview.", reasonKey: "v4_reason_run_plan_preview",
    });
  });

  test("a blocked run names the first blocking room in saved order and links to it", async ({ page }) => {
    // plan-cadence-blocked: Kitchen holds invalid_cadence_policy and mop_progress_unverified; progress wins.
    expect(await primary(page, "plan-cadence-blocked", { state: run })).toEqual({
      id: "run-plan", label: "Run plan", labelKey: "v4_action_run_plan", enabled: false,
      reason: "Can't run this plan until you reset {room}'s schedule progress, which Home Assistant can't confirm.",
      reasonKey: "v4_reason_plan_room_progress",
      reasonPlaceholders: { room: "Kitchen" },
      jump: { label: "Review {room}", labelKey: "v4_review_room", labelPlaceholders: { room: "Kitchen" }, roomId: "room-a" },
    });
    const cases = [
      [["coverage_progress_unverified", "identity_changed"], "v4_reason_plan_room_progress"],
      [["room_not_on_current_map", "identity_changed"], "v4_reason_plan_room_map",
        "Can't run this plan until you review {room}'s schedule on this map."],
      [["shared_schedule_unavailable", "room_not_on_current_map"], "v4_reason_plan_room_off_map",
        "Can't run this plan until {room} is on the current map or removed from the plan."],
      [["coverage_requires_vacuum", "shared_schedule_unavailable"], "v4_reason_plan_room_schedule",
        "Can't run this plan until you fix {room}'s schedule."],
      [["coverage_requires_vacuum", "invalid_cadence_policy"], "v4_reason_plan_room_schedule"],
      [["mop_due", "coverage_requires_vacuum"], "v4_reason_plan_room_mode",
        "Can't run this plan until {room} uses a vacuum mode or its vacuum rotation is off."],
    ];
    for (const [roomReasons, reasonKey, reason] of cases) {
      // The saved order is Office, Kitchen, Living room; Kitchen's due reason never blocks.
      const action = await primary(page, "plan-saved-intelligent", {
        plan: { roomOrder: ["room-c", "room-a", "room-b"] }, preview: blocked,
        reasons: { "room-c": ["mop_due"], "room-a": roomReasons, "room-b": ["identity_changed"] },
      });
      expect(action).toMatchObject({ enabled: false, reasonKey, reasonPlaceholders: { room: "Kitchen" }, jump: { roomId: "room-a" } });
      if (reason) expect(action.reason).toBe(reason);
    }
  });

  test("a plan-level blocker, or a blocking room without a name, names no room", async ({ page }) => {
    const cases = [
      ["cadence_identity_unavailable", "v4_preview_identity_unavailable",
        "Can't run this plan until Home Assistant can match its rooms to the current map."],
      ["cadence_identity_changed", "v4_preview_identity_unavailable"],
      ["plan_has_no_rooms", "v4_preview_no_rooms", "Can't run this plan until it has at least one room."],
      ["plan_room_limit", "v4_preview_room_limit", "Can't run this plan until it has 100 rooms or fewer."],
      ["invalid_plan", "v4_preview_invalid", "Can't run this plan until you open Edit and save it again."],
      ["area_map_changed", "v4_preview_area_changed", "Can't run this plan until you review its custom areas on the current map."],
      // An enabled draft with a preview still paused: the preview is stale, so it is retried.
      ["plan_disabled", "v4_reason_run_plan_preview"],
      ["preview_unavailable", "v4_reason_run_plan_preview"],
      ["coverage_requires_vacuum", "v4_reason_run_plan_preview"],
    ];
    for (const [blocker, reasonKey, reason] of cases) {
      const action = await primary(page, "plan-saved-intelligent", { preview: { blocker, rooms: [] } });
      expect(action).toMatchObject({ id: "run-plan", enabled: false, reasonKey, reasonPlaceholders: undefined, jump: undefined });
      if (reason) expect(action.reason).toBe(reason);
    }
    // room-z is in the plan but not in the catalog, so it has no name to show.
    expect(await primary(page, "plan-saved-intelligent", {
      plan: { rooms: [{ roomId: "room-z", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: ["room_not_on_current_map"] }], roomOrder: ["room-z"] },
      preview: { blocker: "invalid_plan", rooms: [] },
    })).toMatchObject({ reasonKey: "v4_preview_invalid", jump: undefined });
  });

  test("the action bar fills in the blocking room's name", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-cadence-blocked" });
    await page.evaluate((tag) => {
      document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-plan-view", view: "run" }, bubbles: true, composed: true,
      }));
    }, GALLERY_TAG);
    // plan.md R3: the reason ends in the link that opens that room.
    await expect(gallery.locator(".action-reason")).toHaveText(
      "Can't run this plan until you reset Kitchen's schedule progress, which Home Assistant can't confirm. Review Kitchen",
    );
  });
});

test.describe("plan effects", () => {
  // Installs `window.planEffects(scenario)`: an EffectController over a gallery
  // scenario with a synced robot and a current map. `run.calls` lists
  // [service, data] per Home Assistant call and `run.reloads` counts plan
  // reads. A test replaces `run.plans` or `run.service` to hold or fail them,
  // and `run.inFlight()` waits until a lazily loaded write reaches the service.
  async function loadPlanEffects(page) {
    await loadEffectHarness(page);
    await page.evaluate(async () => {
      const m = await import("/plan-recovery-test.js");
      const ticks = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
      window.planEffects = async (scenario) => {
        const initial = m.createGalleryState(scenario);
        const store = new m.WorkspaceStore(initial);
        const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
        const run = { m, initial, store, calls: [], reloads: 0, plans: null, service: null };
        run.projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
        run.effects = new m.EffectController(store, {
          catalog: async () => [initial.resources.entry], scene: aborted, pose: aborted,
          history: async () => initial.resources.history.value,
          areas: async () => initial.resources.areas.value,
          plans: async () => { run.reloads += 1; return run.plans ? run.plans() : structuredClone(initial.resources.plans.value); },
          service: async (_domain, service, data) => { run.calls.push([service, data]); return run.service?.(service, data); },
          dispose() {},
        });
        run.effects.sync(run.projection);
        await run.effects.refreshCatalog(true);
        await ticks();
        store.patch({ map: initial.map, coherence: "current", workflow: initial.workflow, planView: initial.planView,
          selection: initial.selection, planDraft: initial.planDraft, resources: { ...store.value.resources, plans: initial.resources.plans } });
        run.reloads = 0;
        run.hold = () => new Promise((resolve, reject) => { run.finish = resolve; run.fail = reject; });
        run.inFlight = async () => { for (let i = 0; i < 20 && run.calls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
        return run;
      };
    });
  }

  test("an in-place reload keeps the plans on screen and a failed one leaves them untouched", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-saved-intelligent");
      const { store, effects } = run;
      const fresh = structuredClone(store.value.resources.plans.value);
      fresh.plans[0].name = "Renamed elsewhere";
      run.plans = () => run.hold().then(() => fresh);
      const loading = effects.loadPlans({ force: true, inPlace: true });
      const during = store.value.resources.plans.status;
      run.finish(); const returned = await loading;
      const success = { during, returned: returned === store.value.resources.plans.value,
        name: store.value.resources.plans.value.plans[0].name, status: store.value.resources.plans.status };
      const before = store.value.resources.plans;
      run.plans = async () => { throw new Error("Unavailable"); };
      const failed = { returned: await effects.loadPlans({ force: true, inPlace: true }), untouched: store.value.resources.plans === before };
      // With no catalog to keep, the read shows loading as before.
      store.patch({ resources: { ...store.value.resources, plans: { status: "idle", value: null, problem: null } } });
      run.plans = () => run.hold().then(() => fresh);
      const cold = effects.loadPlans({ inPlace: true });
      const empty = store.value.resources.plans.status;
      run.finish(); await cold;
      effects.dispose();
      return { success, failed, empty };
    });
    expect(result).toEqual({
      success: { during: "ready", returned: true, name: "Renamed elsewhere", status: "ready" },
      failed: { returned: null, untouched: true },
      empty: "loading",
    });
  });

  test("the preflight never shows Loading rooms and plans", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-saved-intelligent");
      const { m, store, effects } = run;
      const catalog = structuredClone(store.value.resources.plans.value);
      run.plans = () => run.hold().then(() => catalog);
      const running = effects.executeAction("run-plan");
      const action = m.selectPrimaryAction(store.value);
      const during = { status: store.value.resources.plans.status, command: store.value.command,
        pendingAction: store.value.pendingAction, id: action.id, enabled: action.enabled, reasonKey: action.reasonKey };
      run.finish(); await running;
      const sent = { calls: run.calls.map(([service]) => service), pendingAction: store.value.pendingAction };
      store.patch({ notice: null });
      const before = store.value.resources.plans;
      run.plans = async () => { throw new Error("Unavailable"); };
      await effects.executeAction("run-plan");
      const failed = { notice: store.value.notice?.key, command: store.value.command,
        pendingAction: store.value.pendingAction, untouched: store.value.resources.plans === before, calls: run.calls.length };
      effects.dispose();
      return { during, sent, failed };
    });
    expect(result).toEqual({
      during: { status: "ready", command: "pending", pendingAction: "run-plan", id: "run-plan", enabled: false,
        reasonKey: "v4_reason_run_plan_checking" },
      sent: { calls: ["run_selected_plan"], pendingAction: null },
      failed: { notice: "v4_notice_plan_preview_refresh_failed", command: "idle", pendingAction: null, untouched: true, calls: 1 },
    });
  });

  test("a plan write is pending as a plan save until it settles or is cancelled", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-dirty");
      const { m, store, effects } = run;
      run.service = () => run.hold();
      const saving = effects.executeAction("save-plan");
      await run.inFlight();
      const action = m.selectPrimaryAction(store.value);
      const during = { command: store.value.command, pendingAction: store.value.pendingAction,
        id: action.id, enabled: action.enabled, reasonKey: action.reasonKey };
      run.finish(); await saving;
      const settled = { command: store.value.command, pendingAction: store.value.pendingAction };
      store.patch({ planDraft: { ...store.value.planDraft, name: "Edited again", dirty: true } });
      run.calls.length = 0;
      const cancelled = effects.savePlan();
      await run.inFlight();
      void effects.selectFloor("saved-1");
      const afterCancel = { command: store.value.command, pendingAction: store.value.pendingAction };
      run.finish(); await cancelled;
      effects.dispose();
      return { during, settled, afterCancel };
    });
    expect(result).toEqual({
      during: { command: "pending", pendingAction: "save-plan", id: "save-plan", enabled: false, reasonKey: "v4_reason_plan_saving" },
      settled: { command: "idle", pendingAction: null },
      afterCancel: { command: "idle", pendingAction: null },
    });
  });

  // shell.md §6: "Check robot status" follows only a failed robot command.
  for (const write of ["save", "delete", "reset"]) {
    test(`a failed plan ${write} returns to idle with its notice, not Check robot status`, async ({ page }) => {
      await loadPlanEffects(page);
      const result = await page.evaluate(async (write) => {
        const run = await window.planEffects(write === "save" ? "plan-dirty" : "plan-saved-intelligent");
        const { m, store, effects } = run;
        run.service = async () => { throw new Error("Unavailable"); };
        if (write === "delete") store.dispatch({ type: "set-plan-view", view: "edit" });
        if (write === "save") await effects.executeAction("save-plan");
        else if (write === "delete") await effects.executeAction("delete-plan");
        else await effects.executeAction({ id: "reset-room-cadence", planId: "daily", roomId: "room-a", mode: "mop" });
        const action = m.selectPrimaryAction(store.value);
        effects.dispose();
        return { calls: run.calls.length, command: store.value.command, pendingAction: store.value.pendingAction,
          notice: store.value.notice?.key, primary: action.id, labelKey: action.labelKey };
      }, write);
      expect(result).toEqual({
        calls: 1, command: "idle", pendingAction: null,
        ...{
          save: { notice: "v4_notice_plan_save_failed", primary: "save-plan", labelKey: "v4_action_save_plan" },
          delete: { notice: "v4_notice_plan_delete_failed", primary: "save-plan", labelKey: "v4_action_done" },
          reset: { notice: "v4_notice_reset_mop_failed", primary: "run-plan", labelKey: "v4_action_run_plan" },
        }[write],
      });
    });
  }

  test("post-write reloads keep the plans on screen", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const outcome = {};
      for (const write of ["save", "reset", "delete"]) {
        const run = await window.planEffects(write === "save" ? "plan-dirty" : "plan-saved-intelligent");
        const { store, effects } = run;
        const statuses = new Set();
        const unsubscribe = store.subscribe((state) => statuses.add(state.resources.plans.status));
        if (write === "save") await effects.executeAction("save-plan");
        else if (write === "delete") await effects.executeAction("delete-plan");
        else await effects.executeAction({ id: "reset-room-cadence", planId: "daily", roomId: "room-a", mode: "mop" });
        unsubscribe();
        outcome[write] = { statuses: [...statuses], reloads: run.reloads, workflow: store.value.workflow };
        effects.dispose();
      }
      return outcome;
    });
    expect(result).toEqual({
      save: { statuses: ["ready"], reloads: 1, workflow: "plan" },
      reset: { statuses: ["ready"], reloads: 1, workflow: "plan" },
      delete: { statuses: ["ready"], reloads: 1, workflow: "plans" },
    });
  });

  test("Done returns a clean saved plan to Run without a write, and a save returns to Run", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-saved-intelligent");
      const { store, effects } = run;
      store.dispatch({ type: "set-plan-view", view: "edit" });
      await effects.executeAction("save-plan");
      const done = { planView: store.value.planView, calls: run.calls.length };
      store.dispatch({ type: "set-plan-view", view: "edit" });
      store.dispatch({ type: "patch-plan-draft", patch: { name: "Renamed" } });
      await effects.executeAction("save-plan");
      const saved = { planView: store.value.planView, dirty: store.value.planDraft.dirty,
        calls: run.calls.map(([service]) => service) };
      effects.dispose();
      return { done, saved };
    });
    expect(result).toEqual({
      done: { planView: "run", calls: 0 },
      saved: { planView: "run", dirty: false, calls: ["save_plan"] },
    });
  });

  test("the Run switch saves the freshly read plan with only enabled changed", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-saved-intelligent");
      const { m, store, effects } = run;
      const catalog = structuredClone(store.value.resources.plans.value);
      catalog.plans[0].name = "Renamed elsewhere";
      run.plans = async () => structuredClone(catalog);
      run.service = (_service, data) => run.hold().then(() => { catalog.plans[0].enabled = data.enabled; });
      const original = store.value.planDraft;
      const pausing = effects.setPlanEnabled(false);
      await run.inFlight();
      const during = { enabled: store.value.planDraft.enabled, dirty: store.value.planDraft.dirty, command: store.value.command,
        pendingAction: store.value.pendingAction, notice: store.value.notice, status: store.value.resources.plans.status, reloads: run.reloads };
      run.finish(); await pausing;
      const paused = { enabled: store.value.planDraft.enabled, command: store.value.command, pendingAction: store.value.pendingAction,
        notice: store.value.notice && { key: store.value.notice.key, tone: store.value.notice.tone }, reloads: run.reloads };
      const [service, sent] = run.calls[0];
      // The one request shape: a save of the fresh plan with the same change.
      store.patch({ planView: "edit", planDraft: { ...m.draftForPlan({ ...catalog.plans[0], enabled: true }), enabled: false, dirty: true } });
      run.service = (_service, data) => { catalog.plans[0].enabled = data.enabled; };
      await effects.savePlan();
      const sameShape = JSON.stringify(sent) === JSON.stringify(run.calls[1][1]);
      store.patch({ planView: "run", planDraft: { ...store.value.planDraft, dirty: false } });
      run.calls.length = 0;
      await effects.setPlanEnabled(true);
      const on = { enabled: store.value.planDraft.enabled, notice: store.value.notice?.key, sent: run.calls[0]?.[1].enabled };
      effects.dispose();
      return { originalEnabled: original.enabled, during, paused, service, name: sent.name, sameShape, on };
    });
    expect(result).toEqual({
      originalEnabled: true,
      during: { enabled: false, dirty: false, command: "pending", pendingAction: "save-plan", notice: null, status: "ready", reloads: 1 },
      paused: { enabled: false, command: "idle", pendingAction: null, notice: { key: "v4_notice_plan_paused", tone: "success" }, reloads: 2 },
      service: "save_plan",
      name: "Renamed elsewhere",
      sameShape: true,
      on: { enabled: true, notice: "v4_notice_plan_on", sent: true },
    });
  });

  test("full-plan saves keep a plan's custom areas in their saved places", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-saved-intelligent");
      const { m, store, effects } = run;
      const catalog = structuredClone(store.value.resources.plans.value);
      const plan = catalog.plans[0];
      const [first, second, third] = plan.rooms.map((room) => room.roomId);
      const area = (id) => ({ kind: "area", area_id: id, cleaning_mode: "mop", coverage_setting: "quick" });
      plan.entries = [area("rug"), { kind: "room", room_id: first }, { kind: "room", room_id: second }, area("mat"), { kind: "room", room_id: third }];
      run.plans = async () => structuredClone(catalog);
      run.service = () => {};
      const steps = (data) => data.rooms.map((item) => item.area ?? item.room);
      await effects.setPlanEnabled(false);
      const switched = steps(run.calls[0][1]);
      const rug = run.calls[0][1].rooms[0];
      // Edit takes a room out: areas stay put and the rooms close up around them.
      store.patch({ planView: "edit", planDraft: { ...m.draftForPlan(plan), rooms: m.draftForPlan(plan).rooms.slice(1), dirty: true } });
      await effects.savePlan();
      const edited = steps(run.calls[1][1]);
      // A plan of areas alone keeps them when the switch saves it.
      plan.rooms = [];
      plan.entries = [area("rug")];
      store.patch({ planView: "run", planDraft: { ...m.draftForPlan(plan), dirty: false } });
      await effects.setPlanEnabled(true);
      const areasOnly = steps(run.calls[2][1]);
      // Edit saves a plan of areas alone: there are no rooms, and the areas are kept.
      store.patch({ resources: { ...store.value.resources, plans: { ...store.value.resources.plans, value: structuredClone(catalog) } },
        planView: "edit", planDraft: { ...m.draftForPlan(plan), name: "Spots", dirty: true } });
      const saveAction = m.selectPrimaryAction(store.value);
      await effects.savePlan();
      const renamed = { name: run.calls[3]?.[1].name, steps: run.calls[3] && steps(run.calls[3][1]) };
      effects.dispose();
      return { switched, rug, edited, areasOnly, saveEnabled: saveAction.enabled, renamed, ids: [first, second, third] };
    });
    const [first, second, third] = result.ids;
    expect(result.switched).toEqual(["rug", first, second, "mat", third]);
    expect(result.rug).toEqual({ area: "rug", cleaning_mode: "mop", coverage_setting: "quick" });
    expect(result.edited).toEqual(["rug", second, third, "mat"]);
    expect(result.areasOnly).toEqual(["rug"]);
    expect(result.saveEnabled).toBe(true);
    expect(result.renamed).toEqual({ name: "Spots", steps: ["rug"] });
  });

  for (const failure of ["reload", "send"]) {
    test(`the switch reverts after a failed ${failure === "reload" ? "pre-send reload" : "send"}`, async ({ page }) => {
      await loadPlanEffects(page);
      const result = await page.evaluate(async (failure) => {
        const run = await window.planEffects("plan-saved-intelligent");
        const { store, effects } = run;
        if (failure === "reload") run.plans = async () => { throw new Error("Unavailable"); };
        if (failure === "send") run.service = async () => { throw new Error("Unavailable"); };
        const original = store.value.planDraft;
        await effects.setPlanEnabled(false);
        effects.dispose();
        return { calls: run.calls.length, reverted: store.value.planDraft === original, command: store.value.command,
          pendingAction: store.value.pendingAction, notice: store.value.notice?.key, status: store.value.resources.plans.status };
      }, failure);
      expect(result).toEqual({ calls: failure === "send" ? 1 : 0, reverted: true, command: "idle", pendingAction: null,
        notice: "v4_notice_plan_save_failed", status: "ready" });
    });
  }

  for (const write of ["switch", "preflight"]) test(`the ${write} leaves for Your plans when its fresh read lost the plan`, async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async (write) => {
      const run = await window.planEffects("plan-saved-intelligent");
      const { store, effects } = run;
      const catalog = structuredClone(store.value.resources.plans.value);
      run.plans = async () => ({ ...catalog, plans: [] });
      if (write === "switch") await effects.setPlanEnabled(false);
      else await effects.executeAction("run-plan");
      effects.dispose();
      const state = store.value;
      return { calls: run.calls.length, workflow: state.workflow, planView: state.planView, planId: state.selection.planId,
        draft: { id: state.planDraft.id, dirty: state.planDraft.dirty }, command: state.command,
        pendingAction: state.pendingAction, notice: state.notice?.key, tone: state.notice?.tone, status: state.resources.plans.status };
    }, write);
    expect(result).toEqual({ calls: 0, workflow: "plans", planView: "run", planId: null, draft: { id: null, dirty: false },
      command: "idle", pendingAction: null, notice: "v4_notice_plan_removed", tone: "warning", status: "ready" });
  });

  // An in-place read keeps only a settled catalog: when it replaces a shown
  // read that was loading and then fails, it reports the failure itself.
  for (const write of ["switch", "save"]) {
    test(`a failed ${write} reload that replaced a loading read does not stay loading`, async ({ page }) => {
      await loadPlanEffects(page);
      const result = await page.evaluate(async (write) => {
        const run = await window.planEffects(write === "save" ? "plan-dirty" : "plan-saved-intelligent");
        const { store, effects } = run;
        run.plans = () => run.reloads === 1 ? run.hold() : Promise.reject(new Error("Unavailable"));
        const shown = effects.loadPlans();
        const loading = store.value.resources.plans.status;
        if (write === "save") await effects.executeAction("save-plan");
        else await effects.setPlanEnabled(false);
        run.finish(); await shown;
        const outcome = { loading, status: store.value.resources.plans.status, command: store.value.command, reloads: run.reloads };
        effects.dispose();
        return outcome;
      }, write);
      expect(result).toEqual({ loading: "loading", status: "error", command: "idle", reloads: 2 });
    });
  }

  test("a background reload during the switch's read is skipped and the switch still saves", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-saved-intelligent");
      const { store, effects } = run;
      const catalog = structuredClone(store.value.resources.plans.value);
      run.plans = () => run.reloads === 1 ? run.hold().then(() => catalog) : Promise.resolve(catalog);
      run.service = (_service, data) => { catalog.plans[0].enabled = data.enabled; };
      const switching = effects.setPlanEnabled(false);
      for (let i = 0; i < 20 && run.reloads === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      const background = await effects.loadPlans();
      const skipped = { returned: background, reloads: run.reloads };
      run.finish(); await switching;
      const outcome = { skipped, calls: run.calls.map(([service]) => service), notice: store.value.notice?.key, enabled: store.value.planDraft.enabled };
      effects.dispose();
      return outcome;
    });
    expect(result).toEqual({ skipped: { returned: null, reloads: 1 }, calls: ["save_plan"], notice: "v4_notice_plan_paused", enabled: false });
  });

  test("the switch changes nothing outside a clean, idle Run on an editable map", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const refusals = {
        edit: (store) => store.dispatch({ type: "set-plan-view", view: "edit" }),
        picker: (store) => store.patch({ workflow: "plans" }),
        dirty: (store) => store.patch({ planDraft: { ...store.value.planDraft, dirty: true } }),
        unsaved: (store) => store.patch({ planDraft: { ...store.value.planDraft, id: null } }),
        pending: (store) => store.patch({ command: "pending" }),
        map:(store) => store.patch({ pageActive: false }),
        working: (store) => store.patch({ activity: "cleaning" }),
      };
      const outcome = {};
      for (const [name, refuse] of Object.entries(refusals)) {
        const run = await window.planEffects("plan-saved-intelligent");
        refuse(run.store);
        const before = run.store.value;
        await run.effects.setPlanEnabled(false);
        outcome[name] = { unchanged: run.store.value === before, calls: run.calls.length, reloads: run.reloads };
        run.effects.dispose();
      }
      return outcome;
    });
    for (const value of Object.values(result)) expect(value).toEqual({ unchanged: true, calls: 0, reloads: 0 });
    expect(Object.keys(result)).toHaveLength(7);
  });

  // The switch looks enabled after a failed or settling command, so it works then too.
  for (const command of ["failed", "settling"]) {
    test(`the Run switch saves after a ${command} command`, async ({ page }) => {
      await loadPlanEffects(page);
      const result = await page.evaluate(async (command) => {
        const run = await window.planEffects("plan-saved-intelligent");
        run.store.patch({ command });
        await run.effects.setPlanEnabled(false);
        const outcome = { calls: run.calls.map(([service, data]) => [service, data.enabled]), command: run.store.value.command };
        run.effects.dispose();
        return outcome;
      }, command);
      expect(result).toEqual({ calls: [["save_plan", false]], command: "idle" });
    });
  }

  for (const context of ["disposed", "robot", "user"]) {
    for (const rejected of [false, true]) {
      test(`a late ${rejected ? "failed" : "successful"} switch after context becomes ${context} changes nothing`, async ({ page }) => {
        await loadPlanEffects(page);
        const result = await page.evaluate(async ({ context, rejected }) => {
          const run = await window.planEffects("plan-saved-intelligent");
          const { store, effects } = run;
          run.service = () => run.hold();
          const switching = effects.setPlanEnabled(false);
          await run.inFlight();
          if (context === "disposed") effects.dispose();
          else effects.sync({ ...run.projection, ...(context === "robot" ? { entryKey: "other-entry", vacuumEntityId: "vacuum.other" } : { userKey: "two" }) });
          await Promise.resolve(); await Promise.resolve();
          const before = store.value;
          if (rejected) run.fail(new Error("Late failure")); else run.finish();
          await switching;
          const after = store.value;
          effects.dispose();
          return { unchanged: after === before, reloads: run.reloads };
        }, { context, rejected });
        expect(result).toEqual({ unchanged: true, reloads: 1 });
      });
    }
  }
});

test("browser Back steps from Edit to Run to the picker before leaving the route", async ({ page }) => {
  await loadEffectHarness(page);
  const route = page.url();
  await page.evaluate(async () => {
    const { WorkspaceStore, LayerHistoryController, createGalleryState } = await import("/plan-recovery-test.js");
    const store = new WorkspaceStore(createGalleryState("ready"));
    const layers = new LayerHistoryController(store);
    layers.start();
    store.dispatch({ type: "open-workflow", workflow: "plans" });
    store.dispatch({ type: "select-plan", planId: "daily" });
    store.dispatch({ type: "set-plan-view", view: "edit", roomId: "room-a" });
    window.__planLayers = { store, layers };
  });
  expect(await page.evaluate(() => history.state.maticMapLayer.depth)).toBe(3);
  await page.evaluate(() => history.back());
  await expect.poll(() => page.evaluate(() => window.__planLayers.store.value.planView)).toBe("run");
  expect(await page.evaluate(() => ({ workflow: window.__planLayers.store.value.workflow, depth: history.state.maticMapLayer.depth })))
    .toEqual({ workflow: "plan", depth: 2 });
  await page.evaluate(() => history.back());
  await expect.poll(() => page.evaluate(() => window.__planLayers.store.value.workflow)).toBe("plans");
  expect(await page.evaluate(() => history.state.maticMapLayer.depth)).toBe(1);
  expect(page.url()).toBe(route);
  await page.evaluate(() => history.back());
  await expect.poll(() => page.evaluate(() => window.__planLayers.store.value.workflow)).toBe("none");
  expect(page.url()).toBe(route);
  await page.evaluate(() => window.__planLayers.layers.dispose());
});

for (const refresh of ["delayed", "failed"]) {
  test(`area save acknowledgement permits leaving before ${refresh} catalog refresh`, async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async (refresh) => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore({ ...initial, workflow: "areaReview",
        areaDraft: { ...initial.areaDraft, id: null, name: "Saved zone", dirty: true },
        draw: { ...initial.draw, circles: [{ x: 1, y: 1, radius: .2 }], dirty: true } });
      let finish;
      const pending = new Promise(resolve => { finish = resolve; });
      let reading = false;
      const effects = new EffectController(store, { saveArea: async () => "saved-zone", dispose() {} });
      effects.loadAreas = async () => {
        reading = true;
        await pending;
        if (refresh === "failed") store.patch({ resources: { ...store.value.resources, areas: { status: "error", value: null, problem: "areas-unavailable" } } });
      };
      try {
        const saving = effects.saveArea();
        for (let i = 0; i < 20 && !reading; i++) await new Promise(resolve => setTimeout(resolve, 0));
        if (!reading) throw new Error("Save did not reach catalog refresh");
        const acknowledged = { notice: store.value.notice.key, areaDirty: store.value.areaDraft.dirty, drawDirty: store.value.draw.dirty, id: store.value.areaDraft.id };
        store.dispatch({ type: "dismiss-top-layer" });
        const left = { workflow: store.value.workflow, dialog: store.value.dialog };
        finish();
        await saving;
        return { acknowledged, left, afterRefresh: { workflow: store.value.workflow, dialog: store.value.dialog } };
      } finally { effects.dispose(); }
    }, refresh);
    expect(result).toEqual({ acknowledged: { notice: "v4_notice_area_saved", areaDirty: false, drawDirty: false, id: "saved-zone" }, left: { workflow: "areas", dialog: null }, afterRefresh: { workflow: "areas", dialog: null } });
  });
}

for (const boundary of ["write", "catalog"]) {
  test(`late area save ${boundary} completion preserves a later area draft`, async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async (boundary) => {
      const { EffectController, WorkspaceStore, createGalleryState, captureCoordinateEdit } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore({ ...initial, workflow: "areaReview",
        areaDraft: { ...initial.areaDraft, id: null, name: "First area", dirty: true },
        draw: { ...initial.draw, circles: [{ x: 1, y: 1, radius: .2 }], dirty: true } });
      let finish;
      const pending = new Promise(resolve => { finish = resolve; });
      let reading = false;
      const effects = new EffectController(store, { saveArea: async () => { if (boundary === "write") await pending; return "first"; }, dispose() {} });
      effects.loadAreas = async () => { reading = true; if (boundary === "catalog") await pending; };
      try {
        const saving = effects.saveArea();
        if (boundary === "catalog") {
          for (let i = 0; i < 20 && !reading; i++) await new Promise(resolve => setTimeout(resolve, 0));
          if (!reading) throw new Error("Save did not reach catalog refresh");
        }
        store.dispatch({ type: "discard-draft" });
        store.dispatch({ type: "open-workflow", workflow: "draw" });
        store.dispatch({ type: "patch-area-draft", patch: { name: "Later area" } });
        // This test creates a later, independently admitted drawing state
        // while the earlier save's catalog reconciliation is still pending.
        store.patch({ command: "idle" });
        const coordinateEdit = captureCoordinateEdit(store.value, "paint");
        if (!coordinateEdit) throw new Error("Draw edit was not admitted");
        store.dispatch({ type: "set-draft-circles", circles: [{ x: 2, y: 2, radius: .3 }], coordinateEdit });
        const expected = { draft: store.value.areaDraft, draw: store.value.draw, selection: store.value.selection };
        finish();
        await saving;
        store.dispatch({ type: "dismiss-top-layer" });
        return { expected, actual: { draft: store.value.areaDraft, draw: store.value.draw, selection: store.value.selection }, dialog: store.value.dialog };
      } finally { effects.dispose(); }
    }, boundary);
    expect(result.actual).toEqual(result.expected);
    expect(result.dialog).toBe("discardDraft");
  });
}

test("failed area write keeps the draft and leave confirmation", async ({ page }) => {
  await loadEffectHarness(page);
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
    const initial = createGalleryState("ready");
    const store = new WorkspaceStore({ ...initial, workflow: "areaReview",
      areaDraft: { ...initial.areaDraft, id: null, name: "Keep this area", dirty: true },
      draw: { ...initial.draw, circles: [{ x: 1, y: 1, radius: .2 }], dirty: true } });
    const effects = new EffectController(store, { saveArea: async () => { throw new Error("Write failed"); }, dispose() {} });
    try {
      await effects.saveArea();
      store.dispatch({ type: "dismiss-top-layer" });
      return { name: store.value.areaDraft.name, areaDirty: store.value.areaDraft.dirty, drawDirty: store.value.draw.dirty, dialog: store.value.dialog, notice: store.value.notice.key };
    } finally { effects.dispose(); }
  });
  expect(result).toEqual({ name: "Keep this area", areaDirty: true, drawDirty: true, dialog: "discardDraft", notice: "v4_notice_area_save_failed" });
});

test("area save clears an obsolete discard prompt opened while the write was pending", async ({ page }) => {
  await loadEffectHarness(page);
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
    const initial = createGalleryState("ready");
    const store = new WorkspaceStore({ ...initial, workflow: "areaReview",
      areaDraft: { ...initial.areaDraft, id: null, name: "Saved zone", dirty: true },
      draw: { ...initial.draw, circles: [{ x: 1, y: 1, radius: .2 }], dirty: true } });
    let finish;
    const effects = new EffectController(store, { saveArea: () => new Promise(resolve => { finish = resolve; }), dispose() {} });
    effects.loadAreas = async () => {};
    try {
      const saving = effects.saveArea();
      // The write is pending once the lazily loaded save reaches the backend.
      for (let i = 0; i < 20 && !finish; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      store.dispatch({ type: "dismiss-top-layer" });
      const pendingDialog = store.value.dialog;
      finish("saved-zone");
      await saving;
      const savedDialog = store.value.dialog;
      store.dispatch({ type: "dismiss-top-layer" });
      return { pendingDialog, savedDialog, workflow: store.value.workflow, notice: store.value.notice.key };
    } finally { effects.dispose(); }
  });
  expect(result).toEqual({ pendingDialog: "discardDraft", savedDialog: null, workflow: "areas", notice: "v4_notice_area_saved" });
});

test("map taps select run and plan rooms in both views and clear old deletion notices", async ({ page }) => {
  const bundle = await build({ stdin: { contents: `
    export { RendererController } from "./frontend/map-studio-v4/renderer-controller";
    export { GestureController } from "./frontend/map-studio-v4/gesture-controller";
    export { WorkspaceStore } from "./frontend/map-studio-v4/state";
    export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
  `, resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/room-taps.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { RendererController, GestureController, WorkspaceStore, createGalleryState } = await import("/room-taps.js");
    const results = [];
    for (const workflow of ["rooms", "plan"]) for (const view of ["top", "three"]) {
      const canvas = document.createElement("canvas"), overlay = document.createElement("canvas");
      for (const element of [canvas, overlay]) {
        Object.assign(element.style, { position: "absolute", left: "31px", top: "47px", width: "720px", height: "540px" });
        document.body.append(element);
      }
      const initial = createGalleryState("rooms");
      // plan.md §5 Map: taps change the plan only in Edit.
      const store = new WorkspaceStore({ ...initial, workflow, view, planView: "edit", selection: { ...initial.selection, roomIds: [], roomSettings: [] }, planDraft: { ...initial.planDraft, rooms: [] } });
      const renderer = new RendererController(canvas, overlay);
      renderer.setState(store.value);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const gestures = new GestureController(canvas, renderer, { state: () => store.value, onRoom: roomId => store.dispatch({ type: "toggle-room", roomId }), onCircles: () => {}, onCirclePreview: () => {} });
      const bounds = canvas.getBoundingClientRect();
      let hit;
      for (let y = 20; y < 520 && !hit; y += 10) for (let x = 20; x < 700 && !hit; x += 10) {
        const room = renderer.roomAt(bounds.left + x, bounds.top + y);
        if (room) hit = { x: bounds.left + x, y: bounds.top + y, room };
      }
      if (!hit) throw new Error(`No selectable room in ${view}`);
      const mapPoint = renderer.screenToMap(hit.x, hit.y);
      const projected = renderer.mapToScreen(mapPoint);
      if (Math.hypot(projected.x + bounds.left - hit.x, projected.y + bounds.top - hit.y) > .01) throw new Error("Room projection mismatch");
      const tap = (end = "pointerup") => {
        for (const type of ["pointerdown", end]) canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: hit.x, clientY: hit.y, bubbles: true }));
      };
      // Synthetic pointers have no browser capture owner.
      canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {};
      tap();
      const selected = workflow === "plan" ? store.value.planDraft.rooms.map(room => room.roomId) : store.value.selection.roomIds;
      tap("pointercancel");
      const afterCancel = workflow === "plan" ? store.value.planDraft.rooms.map(room => room.roomId) : store.value.selection.roomIds;
      tap();
      const remaining = workflow === "plan" ? store.value.planDraft.rooms.length : store.value.selection.roomIds.length;
      store.patch({ notice: { tone: "success", key: "v4_notice_plan_deleted", fallback: "Plan deleted" } });
      store.dispatch({ type: "select-plan", planId: "daily" });
      results.push({ selected, afterCancel, remaining, room: hit.room, notice: store.value.notice });
      gestures.dispose(); renderer.dispose(); canvas.remove(); overlay.remove();
    }
    return results;
  });
  for (const result of results) {
    expect(result.selected).toEqual([result.room]);
    expect(result.afterCancel).toEqual(result.selected);
    expect(result.remaining).toBe(0);
    expect(result.notice).toBeNull();
  }
});

// plan.md §3, §5 Navigation and focus, Dialogs; shell.md §5 discardDraft,
// Sheet: the shell's heading, bar, dialogs, focus and detents for Run and Edit.
test.describe("plan shell", () => {
  const intent = (page, detail) => page.evaluate(({ tag, detail }) => {
    document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail, bubbles: true, composed: true,
    }));
  }, { tag: GALLERY_TAG, detail });
  // Replaces the gallery state with `values` over it, object values merged one level deep.
  const patch = (page, values) => page.evaluate(({ tag, values }) => {
    const element = document.querySelector(tag);
    const state = element.getWorkspaceSnapshot();
    element.replaceWorkspaceState({ ...state, ...Object.fromEntries(Object.entries(values).map(([key, value]) =>
      [key, value && typeof value === "object" && key !== "notice" ? { ...state[key], ...value } : value])) });
  }, { tag: GALLERY_TAG, values });
  const wide = async (page, scenario) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    return loadGallery(page, { scenario });
  };
  const narrow = async (page, scenario) => {
    await page.setViewportSize({ width: 390, height: 844 });
    return loadGallery(page, { scenario, narrow: true });
  };
  const scenario = (gallery, name) => gallery.evaluate((element, name) => element.setScenario(name), name);
  const catalog = () => ({
    rooms: [{ room_id: "kitchen", name: "Kitchen", boundary: [[0, 0], [6, 0], [6, 5], [0, 5]] }],
    selected_plan: "daily",
    plans: [{
      id: "daily", name: "Daily", enabled: true, run_behavior: "ordered",
      rooms: [{ room_id: "kitchen", cleaning_mode: "vacuum", coverage_setting: "standard" }],
      room_order: ["kitchen"], return_to_base: true, finish_current_room: false, finish_current_room_threshold: 50,
    }],
  });
  const openPanelPlan = async (page) => {
    const fixture = await installPanelFixture(page, { initialPlanCatalog: catalog() });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    await openPlanPicker(panel);
    await panel.getByRole("button", { name: /^Daily/ }).click();
    await panel.getByRole("button", { name: "Edit Daily", exact: true }).click();
    return { panel, fixture };
  };

  test("Run is titled with the plan's name, Edit with Edit plan or New plan and an unsaved chip", async ({ page }) => {
    const gallery = await wide(page, "plan-saved-intelligent");
    const heading = gallery.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText("Daily clean");
    await expect(heading.locator("bdi")).toHaveText("Daily clean");
    await expect(gallery.locator(".panel-description")).toHaveCount(0);
    await intent(page, { type: "set-plan-view", view: "edit" });
    await expect(heading).toHaveText("Edit plan");
    await patch(page, { planDraft: { dirty: true } });
    await expect(heading.locator(".ms-chip")).toHaveText("Unsaved changes");
    await expect(heading).toHaveAccessibleName("Edit plan Unsaved changes");
    await scenario(gallery, "plan-new");
    await expect(heading).toHaveText("New plan");
    await scenario(gallery, "plans");
    await expect(gallery.locator(".panel-description")).toHaveText("Tap a plan to see its next run.");
  });

  test("Run goes back to the picker; Edit has no back button", async ({ page }) => {
    const gallery = await wide(page, "plan-saved-intelligent");
    await intent(page, { type: "set-plan-view", view: "edit" });
    await expect(gallery.getByRole("heading", { level: 2 })).toHaveText("Edit plan");
    await expect(gallery.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
    await intent(page, { type: "set-plan-view", view: "run" });
    await gallery.getByRole("button", { name: "Back to plans", exact: true }).click();
    expect((await snapshot(page)).workflow).toBe("plans");
    await expect(gallery.getByRole("button", { name: "Back to all tasks", exact: true })).toBeVisible();
  });

  test("Run's Edit button opens Edit, names the plan, and waits while a save or check is pending", async ({ page }) => {
    const gallery = await wide(page, "plan-saved-intelligent");
    const edit = gallery.getByRole("button", { name: "Edit Daily clean", exact: true });
    await expect(edit).toHaveText("Edit");
    await edit.click();
    expect((await snapshot(page)).planView).toBe("edit");
    await expect(gallery.getByRole("heading", { level: 2 })).toBeFocused();
    await gallery.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(edit).toBeFocused();
    for (const [pendingAction, reason] of [
      ["save-plan", "Waiting for Home Assistant to save the plan."],
      ["run-plan", "Waiting for Home Assistant to check the next run."],
    ]) {
      await patch(page, { command: "pending", pendingAction });
      await expect(edit).toHaveAttribute("aria-disabled", "true");
      await expect(edit).toHaveAccessibleDescription(reason);
      await edit.click({ force: true });
      expect((await snapshot(page)).planView).toBe("run");
    }
  });

  test("Edit's More actions menu holds Delete, which waits for unsaved changes", async ({ page }) => {
    const gallery = await wide(page, "plan-saved-intelligent");
    await intent(page, { type: "set-plan-view", view: "edit" });
    const more = gallery.getByRole("button", { name: "More actions", exact: true });
    const remove = gallery.getByRole("menu").getByRole("menuitem", { name: "Delete", exact: true });
    await expect(more).toHaveAttribute("aria-haspopup", "menu");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(remove).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(gallery.getByRole("menu")).toHaveCount(0);
    await expect(more).toBeFocused();
    expect((await snapshot(page)).planView).toBe("edit");
    await more.click();
    await remove.click();
    const dialog = gallery.getByRole("dialog", { name: "Delete plan?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(more).toBeFocused();
    await patch(page, { planDraft: { dirty: true } });
    await more.click();
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await expect(remove).toHaveAccessibleDescription("Can't delete this plan until you save or cancel your changes.");
    await remove.click({ force: true });
    await expect(gallery.getByRole("dialog")).toHaveCount(0);
    // A delete asked for while a command is pending would be refused after
    // its dialog closed, so Delete waits and says why.
    for (const [held, reason] of [
      [{ command: "pending", pendingAction: "save-plan" }, "Waiting for Home Assistant to save the plan."],
      [{ command: "pending", pendingAction: null }, "Waiting for the robot to finish what it's doing."],
    ]) {
      await patch(page, { planDraft: { dirty: false }, ...held });
      await expect(remove, reason).toHaveAccessibleDescription(reason);
      await expect(remove).toHaveAttribute("aria-disabled", "true");
      await remove.click({ force: true });
      await expect(gallery.getByRole("dialog")).toHaveCount(0);
    }
    await scenario(gallery, "plan-new");
    await expect(gallery.getByRole("heading", { level: 2 })).toHaveText("New plan");
    await expect(more).toHaveCount(0);
  });

  test("Edit's bar puts Cancel before the primary; Cancel leaves for Run or the picker and asks first when edited", async ({ page }) => {
    const gallery = await wide(page, "plan-saved-intelligent");
    await intent(page, { type: "set-plan-view", view: "edit" });
    const bar = gallery.locator(".workflow > .action-bar");
    const cancel = bar.getByRole("button", { name: "Cancel", exact: true });
    await expect(bar.getByRole("button")).toHaveText(["Cancel", "Done"]);
    await cancel.click();
    expect((await snapshot(page)).planView).toBe("run");
    await scenario(gallery, "plan-new");
    await cancel.click();
    expect((await snapshot(page)).workflow).toBe("plans");
    await scenario(gallery, "plan-dirty");
    await expect(bar.getByRole("button")).toHaveText(["Cancel", "Save"]);
    await cancel.click();
    const dialog = gallery.getByRole("dialog", { name: "Discard changes?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(cancel).toBeFocused();
    await patch(page, { command: "pending", pendingAction: "save-plan" });
    await expect(cancel).toHaveAttribute("aria-disabled", "true");
    await expect(cancel).toHaveAccessibleDescription("Waiting for Home Assistant to save the plan.");
    await cancel.click({ force: true });
    await expect(dialog).toHaveCount(0);
    expect((await snapshot(page)).planView).toBe("edit");
  });

  test("while the robot works, Edit keeps Cancel beside Stop on a phone and says when it can save on wide", async ({ page }) => {
    let gallery = await narrow(page, "plan-dirty");
    await patch(page, { activity: "cleaning" });
    await expect(gallery.locator(".mobile-sheet > .action-bar").getByRole("button")).toHaveText(["Cancel", "Stop"]);
    gallery = await wide(page, "plan-dirty");
    await patch(page, { activity: "cleaning" });
    const bar = gallery.locator(".workflow > .action-bar");
    await expect(bar.getByRole("button")).toHaveText(["Cancel"]);
    await expect(bar).toContainText("You can save when the robot finishes.");
    await expect(gallery.locator(".status-strip").getByRole("button", { name: "Stop cleaning" })).toBeVisible();
  });

  test("Run plan is named for its plan", async ({ page }) => {
    const gallery = await wide(page, "plan-saved-intelligent");
    await expect(gallery.locator(".workflow > .action-bar").getByRole("button", { name: "Run plan Daily clean", exact: true }))
      .toHaveText("Run plan");
  });

  test("a blocked run links to the room its reason names", async ({ page }) => {
    const gallery = await wide(page, "plan-cadence-blocked");
    await intent(page, { type: "set-plan-view", view: "run" });
    const reason = gallery.locator(".workflow > .action-bar .action-reason");
    await expect(reason).toContainText("Can't run this plan until you reset Kitchen's schedule progress, which Home Assistant can't confirm.");
    await expect(reason.locator("bdi").first()).toHaveText("Kitchen");
    const review = reason.getByRole("button", { name: "Review Kitchen", exact: true });
    await expect(review.locator("bdi")).toHaveText("Kitchen");
    expect(await review.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await review.click();
    expect(await snapshot(page)).toMatchObject({ planView: "edit", expandedRoom: "room-a" });
  });

  test("the picker and Run open at half height and Edit at full, again on each view change", async ({ page }) => {
    const gallery = await narrow(page, "plans");
    const sheet = gallery.locator(".mobile-sheet");
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await intent(page, { type: "select-plan", planId: (await snapshot(page)).resources.plans.value.plans[0].id });
    await expect(gallery.getByRole("heading", { level: 2 })).toHaveText("Daily clean");
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await intent(page, { type: "set-plan-view", view: "edit" });
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await intent(page, { type: "set-plan-view", view: "run" });
    await expect(sheet).toHaveAttribute("data-detent", "half");
  });

  test("Discard changes? names the saved plan or area, or says the new one is lost", async ({ page }) => {
    const gallery = await wide(page, "plan-dirty");
    const dialog = gallery.getByRole("dialog", { name: "Discard changes?" });
    await gallery.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveAccessibleDescription("Your changes to \"Daily clean\" haven't been saved, and discarding them can't be undone.");
    await expect(dialog.getByRole("button")).toHaveText(["Keep editing", "Save", "Discard"]);
    await expect(dialog.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
    await scenario(gallery, "plan-new");
    await patch(page, { planDraft: { name: "Evening", dirty: true } });
    await gallery.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveAccessibleDescription("This new plan hasn't been saved, and discarding it can't be undone.");
    await expect(dialog.getByRole("button"), "a plan with no rooms can't be saved").toHaveText(["Keep editing", "Discard"]);
    await scenario(gallery, "area-review-new");
    await gallery.getByRole("button", { name: "Back to areas", exact: true }).click();
    await expect(dialog).toHaveAccessibleDescription("This new area hasn't been saved, and discarding it can't be undone.");
    await scenario(gallery, "area-review-rebind");
    await patch(page, { areaDraft: { dirty: true } });
    await gallery.getByRole("button", { name: "Back to areas", exact: true }).click();
    await expect(dialog).toHaveAccessibleDescription("Your changes to \"Entryway\" haven't been saved, and discarding them can't be undone.");
  });

  test("Save in Discard changes? waits while saving, then goes on, or keeps the draft after a failure", async ({ page }) => {
    const gallery = await wide(page, "plan-dirty");
    // The gallery has no writes: the test plays the write, which answers the
    // dialog through the action's `settled` callback, as effects.ts does.
    await page.evaluate((tag) => {
      window.__actions = [];
      window.__settled = [];
      document.querySelector(tag).addEventListener("matic-workspace-action", (event) => {
        window.__actions.push(event.detail.id);
        window.__settled.push(event.detail.settled);
      });
    }, GALLERY_TAG);
    const settle = (saved) => page.evaluate((value) => window.__settled.shift()(value), saved);
    const cancel = gallery.getByRole("button", { name: "Cancel", exact: true });
    const dialog = gallery.getByRole("dialog", { name: "Discard changes?" });
    const pending = { command: "pending", pendingAction: "save-plan" };
    await cancel.click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    expect(await page.evaluate(() => window.__actions)).toEqual(["save-plan"]);
    await patch(page, pending);
    for (const name of ["Keep editing", "Save", "Discard"]) {
      await expect(dialog.getByRole("button", { name, exact: true })).toHaveAttribute("aria-disabled", "true");
    }
    await expect(dialog.locator("#dialog-detail")).toContainText("Saving…");
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "Discard", exact: true }).click({ force: true });
    await expect(dialog).toBeVisible();
    await patch(page, { command: "idle", notice: {
      tone: "error", key: "v4_notice_plan_save_failed",
      fallback: "Home Assistant can't confirm the plan was saved, so check your plans, then try again.",
    } });
    await expect(dialog, "the notice alone does not answer the dialog's save").toBeVisible();
    await settle(false);
    await expect(dialog).toHaveCount(0);
    expect(await snapshot(page)).toMatchObject({ workflow: "plan", planView: "edit", planDraft: { dirty: true } });
    await expect(cancel).toBeFocused();

    await cancel.click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await patch(page, pending);
    await patch(page, {
      command: "idle", notice: { tone: "success", key: "v4_notice_plan_saved", fallback: "Plan saved" },
      planDraft: { dirty: false, name: "Saved name" },
    });
    await settle(true);
    await expect(dialog).toHaveCount(0);
    expect(await snapshot(page)).toMatchObject({ planView: "run", planDraft: { dirty: false, name: "Saved name" } });
    expect(await page.evaluate(() => window.__actions)).toEqual(["save-plan", "save-plan"]);
  });

  test("Save in Discard changes? saves the plan and goes on to Run", async ({ page }) => {
    const { panel } = await openPanelPlan(page);
    await panel.getByRole("textbox", { name: "Plan name" }).fill("Daily tidy");
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await panel.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel.getByRole("dialog")).toHaveCount(0);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Daily tidy");
    await expect(panel.locator("[data-notice-slot]")).toHaveText("Plan saved");
    expect(await page.evaluate(() => window.__panelFixture.serviceCalls.map(({ service, data }) => [service, data.name])))
      .toEqual([["save_plan", "Daily tidy"]]);
  });

  test("Delete from Edit lands on the picker with Plan deleted and focus on its heading", async ({ page }) => {
    const { panel } = await openPanelPlan(page);
    await panel.getByRole("button", { name: "More actions", exact: true }).click();
    await panel.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await panel.getByRole("dialog", { name: "Delete plan?" }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(panel.getByRole("heading", { level: 2, name: "Your plans" })).toBeFocused();
    await expect(panel.locator("[data-notice-slot]")).toHaveText("Plan deleted");
    await expect(panel.locator("[data-notice-toast]")).toHaveText("Plan deleted");
    expect(await page.evaluate(() => window.__panelFixture.serviceCalls.map(({ service, data }) => [service, data])))
      .toEqual([["delete_plan", { plan: "daily" }]]);
  });
});

// design-system.md §8 and shell.md §8: axe serious and critical findings are
// zero at every width, and aria-label sits only on a role that takes a name
// (MS-AXE-01; axe files a named generic that has content under "incomplete").
async function settleWorkspace(gallery) {
  const { workflow } = await gallery.evaluate((element) => element.getWorkspaceSnapshot());
  if (workflow !== "none") await expect(gallery.locator("matic-map-workflow-v4")).toBeAttached();
  await expect(gallery.locator(".loading[role=status]", { hasText: "Loading…" })).toHaveCount(0);
  await gallery.evaluate(async (element) => {
    await element.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

// plan.md §3: Create a plan is the picker's filled button only when it lists no plans.
async function openEmptyPicker(gallery) {
  await gallery.evaluate((element) => element.setScenario("plans"));
  await settleWorkspace(gallery);
  await gallery.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans,
      value: { ...state.resources.plans.value, plans: [], selectedPlan: null } } } });
  });
  await settleWorkspace(gallery);
}

const axeFindings = (results) => results.map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.flat().join(" >> ")).join(" | ")}`);

test.describe("Map Studio accessibility baselines", () => {
  for (const scenario of ["ready", "rooms", "plans", "plan-saved-intelligent", "plan-saved-ordered", "plan-edit-ordered", "plan-run-paused", "plan-run-blocked", "plan-new", "plan-dirty",
    "plan-cadence-shared", "plan-cadence-blocked", "plan-schedule-available", "plan-schedule-joining", "plan-schedule-conflict",
    "draw", "history", "cleaning", "access",
    // map-surfaces.md §4: the Draw, area review, history and Full map states (UX5).
    "draw-points", "draw-redraw", "area-review-saved", "area-review-stale", "history-floors", "full-map-cleaning",
    // home-rooms.md §4: home by state and the Rooms states (UX4).
    "rooms-ready", "rooms-busy", "rooms-failed", "rooms-empty", "room-limit", "home-plan-due", "home-plan-paused",
    "problem", "map-unavailable", "empty", "robot-offline"]) {
    for (const [width, height] of [[390, 844], [1024, 768]]) {
      const narrow = width < 1024;
      test(`${scenario} at ${width} has no serious axe finding and no name on an unnamed role${narrow ? " @mobile" : ""}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        const gallery = await loadGallery(page, { scenario, narrow });
        await settleWorkspace(gallery);
        const { violations, incomplete } = await new AxeBuilder({ page }).analyze();
        expect(axeFindings(violations.filter(({ impact }) => impact === "serious" || impact === "critical"))).toEqual([]);
        expect(axeFindings(incomplete.filter(({ id }) => id === "aria-prohibited-attr"))).toEqual([]);
      });
    }
  }

  // home-rooms.md §5 Display: the Map options menu on a phone.
  test("Map options open at 390 has no serious axe finding @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow: true });
    await settleWorkspace(gallery);
    await gallery.getByRole("button", { name: "Map options" }).click();
    await expect(gallery.getByRole("menu", { name: "Map options" })).toBeVisible();
    const { violations, incomplete } = await new AxeBuilder({ page }).analyze();
    expect(axeFindings(violations.filter(({ impact }) => impact === "serious" || impact === "critical"))).toEqual([]);
    expect(axeFindings(incomplete.filter(({ id }) => id === "aria-prohibited-attr"))).toEqual([]);
  });

  // home-rooms.md §5 Settings, Due work: the open disclosures.
  test("Rooms with the settings row and a room's settings open has no serious axe finding", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "rooms-ready" });
    await settleWorkspace(gallery);
    await gallery.getByRole("button", { name: /^Cleaning settings/ }).click();
    await expect(gallery.getByRole("switch", { name: "Use room schedules" })).toBeVisible();
    const kitchen = gallery.getByRole("button", { name: "Settings for Kitchen", exact: true });
    await kitchen.click();
    await expect(kitchen).toHaveAttribute("aria-expanded", "true");
    await expect(gallery.getByLabel("Cleaning mode for Kitchen")).toBeVisible();
    const { violations, incomplete } = await new AxeBuilder({ page }).analyze();
    expect(axeFindings(violations.filter(({ impact }) => impact === "serious" || impact === "critical"))).toEqual([]);
    expect(axeFindings(incomplete.filter(({ id }) => id === "aria-prohibited-attr"))).toEqual([]);
  });

  // home-rooms.md §8 Forced colors, RTL; MS-HOME-11 dark tints.
  for (const [label, setup] of [
    ["dark", (page) => page.emulateMedia({ colorScheme: "dark" })],
    // The parsed <html> replaces the one an init script would set dir on, so
    // the direction is set once the page is up.
    ["RTL", (page) => page.evaluate(() => { document.documentElement.dir = "rtl"; })],
    ["forced colors", (page) => page.emulateMedia({ forcedColors: "active" })],
  ]) {
    test(`rooms-ready at 390 in ${label} has no serious axe finding and keeps Settings in its row @mobile`, async ({ page }) => {
      if (label !== "RTL") await setup(page);
      await page.setViewportSize({ width: 390, height: 844 });
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow: true });
      if (label === "RTL") await setup(page);
      await settleWorkspace(gallery);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe(label === "RTL" ? "rtl" : "ltr");
      await gallery.getByRole("button", { name: "Expand panel" }).click();
      const kitchen = gallery.getByRole("button", { name: "Settings for Kitchen", exact: true });
      await expect(kitchen).toBeVisible();
      const row = await kitchen.locator("xpath=ancestor::*[contains(@class, 'room-row')]").boundingBox();
      const button = await kitchen.boundingBox();
      expect(button.x).toBeGreaterThanOrEqual(row.x - 0.5);
      expect(button.x + button.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
      // Under forced colors the platform owns every colour and axe 4.13 has
      // no forced-colors handling: Linux WebKit's emulated system colours
      // fail its contrast rule (UX3 R34), so that rule is not a finding
      // there; the forced-colors styles are asserted instead. Dark and RTL
      // keep the full rule set.
      const forced = label === "forced colors";
      await expect.poll(() => page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(forced);
      const builder = new AxeBuilder({ page });
      const { violations, incomplete } = await (forced ? builder.disableRules(["color-contrast"]) : builder).analyze();
      expect(axeFindings(violations.filter(({ impact }) => impact === "serious" || impact === "critical"))).toEqual([]);
      expect(axeFindings(incomplete.filter(({ id }) => id === "aria-prohibited-attr"))).toEqual([]);
      // Forced colors: the Settings button's edge is ButtonBorder and the
      // primary paints the Highlight pair (WebKit doesn't expose
      // forced-color-adjust, so the colours themselves are compared).
      const system = (name) => page.evaluate((color) => {
        const probe = document.createElement("i");
        probe.style.cssText = `color: ${color}; forced-color-adjust: none`;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }, name);
      const primary = gallery.locator(".action-bar .ms-btn--primary");
      await expect(primary).toBeVisible();
      expect(await kitchen.evaluate((element) => getComputedStyle(element).borderTopColor) === await system("ButtonBorder")).toBe(forced);
      expect(await primary.evaluate((element) => {
        const { color, backgroundColor } = getComputedStyle(element);
        return [color, backgroundColor];
      })).toEqual(forced ? [await system("HighlightText"), await system("Highlight")] : expect.not.arrayContaining([await system("Highlight")]));
    });
  }

  test("the toast sits in a region named Notifications, so axe finds no content outside a landmark", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "ready" });
    await settleWorkspace(gallery);
    await gallery.locator("matic-map-shell-v4").evaluate((shell) => shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "set-notice", notice: { tone: "error", key: "v4_notice_audit_sample", fallback: "Sample notice text" } },
      bubbles: true, composed: true,
    })));
    await expect(gallery.getByRole("region", { name: "Notifications" })).toContainText("Sample notice text");
    const { violations } = await new AxeBuilder({ page }).withRules(["region"]).analyze();
    expect(axeFindings(violations)).toEqual([]);
  });

  // The help popover's title continues the outline under the app's h1, so it
  // is an h2; its size comes from its class, not its level.
  test("the help popover's title is an h2 that keeps the heading order valid", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "ready" });
    await settleWorkspace(gallery);
    await gallery.getByRole("button", { name: "How to move the map" }).click();
    const title = gallery.getByRole("dialog", { name: "How to move the map" }).getByRole("heading", { name: "How to move the map" });
    await expect(title).toHaveJSProperty("tagName", "H2");
    await expect(title).toHaveCSS("font-size", "13px");
    const { violations } = await new AxeBuilder({ page }).withRules(["heading-order"]).analyze();
    expect(axeFindings(violations)).toEqual([]);
  });

  // MS-AXE-02: a scrolling body is a region named by the h2, and it and the
  // capped pinned top above it (which holds the h2) are tab stops only while
  // they overflow with nothing inside to Tab to; a pinned top that is a tab
  // stop is a group named by the h2 (a second region of that name would make
  // the landmark ambiguous). The stage fills the viewport, so a
  // resize after the first layout must be caught too. 360x480 is a small
  // phone with the regular sheet at half; a landscape phone (under 480 px
  // tall) gets the compact sheet, whose full height leaves these tops
  // unclipped (compact_layout spec).
  const openScroller = async (page, scenario, width, height) => {
    await page.setViewportSize({ width, height });
    const gallery = await loadGallery(page, { scenario, narrow: width < 1024 });
    await settleWorkspace(gallery);
    await gallery.locator(".stage").evaluate((stage) => {
      Object.assign(stage.style, { blockSize: "100dvh", minBlockSize: "0", maxInlineSize: "none" });
    });
    await settleWorkspace(gallery);
    const heading = gallery.getByRole("heading", { level: 2 }).first();
    const title = (await heading.textContent()).trim();
    return { gallery, heading, body: gallery.getByRole("region", { name: title, exact: true }).last() };
  };
  const scrollerState = (element, top) => element.evaluate((node, pinned) => {
    const target = pinned ? node.closest(".panel-top") : node;
    const tabbable = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
    // Workflow bodies can contain another custom element (for example the
    // plan picker). Inspect the whole composed subtree, not just one host.
    const containsTabbable = (root) => Boolean(root.querySelector(tabbable))
      || [...root.querySelectorAll("*")].some((child) => child.shadowRoot && containsTabbable(child.shadowRoot));
    return {
      overflows: target.scrollHeight > target.clientHeight,
      focusableChild: containsTabbable(target),
      tabindex: target.getAttribute("tabindex"),
      role: target.getAttribute("role"),
      named: target.getAttribute("aria-labelledby") === "workspace-title",
    };
  }, top);

  test("a scroller is a tab stop only while it overflows without a focusable child @mobile", async ({ page }) => {
    const scroller = async (scenario, width, height, which) => {
      const { heading, body } = await openScroller(page, scenario, width, height);
      return scrollerState(which === "body" ? body : heading, which === "top");
    };
    // home-rooms.md §3: a held home has an empty body under its heading, so the
    // text-only body is the Rooms view's empty description (R9).
    expect(await scroller("rooms-empty", 360, 480, "body"), "rooms-empty body on a small phone").toEqual({ overflows: true, focusableChild: false, tabindex: "0", role: "region", named: true });
    expect(await scroller("plans", 360, 480, "body"), "plans body on a small phone").toEqual({ overflows: true, focusableChild: true, tabindex: null, role: "region", named: true });
    expect(await scroller("access", 1440, 900, "body"), "access body on a desktop").toEqual({ overflows: false, focusableChild: false, tabindex: null, role: "region", named: true });
    expect(await scroller("paused", 360, 480, "top"), "paused pinned top on a small phone").toEqual({ overflows: true, focusableChild: false, tabindex: "0", role: "group", named: true });
    expect(await scroller("ready", 360, 480, "top"), "ready pinned top on a small phone").toEqual({ overflows: false, focusableChild: false, tabindex: null, role: null, named: false });
  });

  test("a focused tab-stop scroller shows a 2 px ring inset 2 px and stays a tab stop until it loses focus @mobile", async ({ page }) => {
    const { gallery, body } = await openScroller(page, "rooms-empty", 360, 480);
    await expect(body).toHaveAttribute("tabindex", "0");
    await body.focus();
    expect(await body.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth, style.outlineOffset, style.outlineColor];
    })).toEqual(["solid", "2px", "-2px", "rgb(6, 120, 206)"]);
    // A taller phone keeps the narrow layout (and so this body) but stops it
    // overflowing.
    await page.setViewportSize({ width: 390, height: 844 });
    await settleWorkspace(gallery);
    await expect.poll(() => scrollerState(body, false), "no longer overflowing, but focused").toMatchObject({ overflows: false, tabindex: "0" });
    await gallery.getByRole("heading", { level: 2 }).first().focus();
    await expect.poll(() => scrollerState(body, false), "after blur").toMatchObject({ overflows: false, tabindex: null });
  });

  // The pinned top is re-checked when its content changes: a notice brings a
  // Close button, so it stops being a tab stop until the notice goes.
  test("the pinned top is a tab stop only while no notice gives it a control @mobile", async ({ page }) => {
    const { gallery, heading } = await openScroller(page, "paused", 360, 480);
    const notice = (value) => gallery.locator("matic-map-shell-v4").evaluate((shell, next) => shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "set-notice", notice: next }, bubbles: true, composed: true,
    })), value);
    await expect.poll(() => scrollerState(heading, true)).toMatchObject({ focusableChild: false, tabindex: "0", role: "group", named: true });
    const { violations } = await new AxeBuilder({ page }).withRules(["landmark-unique", "aria-allowed-role"]).analyze();
    expect(axeFindings(violations), "the body stays the only region named by the h2").toEqual([]);
    await notice({ tone: "warning", key: "v4_notice_sample", fallback: "Sample notice text" });
    await expect(gallery.locator("[data-notice-slot]")).toBeVisible();
    await expect.poll(() => scrollerState(heading, true), "with a notice").toMatchObject({ focusableChild: true, tabindex: null, role: null, named: false });
    await notice(null);
    await expect.poll(() => scrollerState(heading, true), "after the notice").toMatchObject({ focusableChild: false, tabindex: "0", role: "group", named: true });
  });

  // MS-AXE-03 (design-system.md §5): HA's fill pair is kept at 4.5:1, else the
  // fill steps 5% toward black (white under a darker label) until it reaches
  // it, else the label becomes whichever of black or white contrasts more.
  test("primary and Stop resolve HA's theme colours to a 4.5:1 pair @mobile", async ({ page }) => {
    const luminance = (rgb) => rgb.reduce((sum, channel, index) => {
      const value = channel / 255;
      return sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    }, 0);
    const pair = async (button) => {
      const [label, fill] = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor];
      });
      const [high, low] = [label, fill].map((color) => luminance(color.match(/\d+/gu).slice(0, 3).map(Number))).sort((x, y) => y - x);
      return { label, fill, ratio: Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100 };
    };
    const theme = (vars) => page.evaluate((values) => {
      for (const [name, value] of Object.entries(values)) document.documentElement.style.setProperty(name, value);
    }, vars);
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "cleaning", narrow: true });
    await settleWorkspace(gallery);
    await theme({ "--primary-color": "#009ac7", "--text-primary-color": "#ffffff", "--error-color": "#db4437" });
    const stop = gallery.getByRole("button", { name: "Stop cleaning" });
    await expect.poll(() => pair(stop), "Stop: white on #db4437 is 4.29:1").toEqual({ label: "rgb(255, 255, 255)", fill: "rgb(208, 65, 52)", ratio: 4.68 });

    await openEmptyPicker(gallery);
    const create = gallery.getByRole("button", { name: "Create a plan" });
    await expect.poll(() => pair(create), "primary: white on #009ac7 is 3.26:1").toEqual({ label: "rgb(255, 255, 255)", fill: "rgb(0, 123, 159)", ratio: 4.85 });
    await theme({ "--primary-color": "#0b5394" });
    await expect.poll(() => pair(create), "a passing pair is kept").toEqual({ label: "rgb(255, 255, 255)", fill: "rgb(11, 83, 148)", ratio: 7.84 });
    await theme({ "--primary-color": "#808080", "--text-primary-color": "#777777" });
    await expect.poll(() => pair(create), "no 5% step reaches 4.5:1").toEqual({ label: "rgb(0, 0, 0)", fill: "rgb(128, 128, 128)", ratio: 5.32 });
  });
});

// design-system.md §5 (MS-AXE-03): the other D1 colours, measured with HA's
// default palettes (the values ha_theme_axe.mjs applies).
test.describe("Map Studio resolved theme colours", () => {
  const HA_LIGHT = { "--primary-color": "#009ac7", "--text-primary-color": "#ffffff", "--error-color": "#db4437", "--card-background-color": "#ffffff", "--secondary-background-color": "#e5e5e5", "--primary-text-color": "#141414" };
  const HA_DARK = { ...HA_LIGHT, "--card-background-color": "#1c1c1c", "--secondary-background-color": "#282828", "--primary-text-color": "#e1e1e1" };
  // `rgb()` and `color(srgb …)` (color-mix results) as 0-255 channels.
  const channels = (css) => {
    const values = css.match(/[\d.]+/gu).map(Number);
    return css.startsWith("color(srgb") ? values.slice(0, 3).map((value) => value * 255) : values.slice(0, 3);
  };
  const luminance = (rgb) => rgb.reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  }, 0);
  const ratio = (a, b) => {
    const [high, low] = [a, b].map((css) => luminance(channels(css))).sort((x, y) => y - x);
    return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
  };
  const theme = (page, vars) => page.evaluate((values) => {
    for (const [name, value] of Object.entries(values)) document.documentElement.style.setProperty(name, value);
  }, vars);
  const style = (locator, property) => locator.evaluate((element, name) => getComputedStyle(element)[name], property);
  // A computed colour in any syntax (color-mix gives oklab or color()) as
  // the sRGB pixel the browser paints.
  const paint = (locator, property) => locator.evaluate((element, name) => {
    const context = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { colorSpace: "srgb" });
    context.fillStyle = getComputedStyle(element)[name];
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${red}, ${green}, ${blue})`;
  }, property);

  test("checked switches keep their knob distinct from a custom theme's indicator", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent" });
    const toggle = gallery.getByRole("switch", { name: "Plan enabled", exact: true });
    for (const vars of [HA_LIGHT, HA_DARK, { ...HA_LIGHT, "--primary-color": "#777777", "--text-primary-color": "#777777" }]) {
      await theme(page, vars);
      await expect.poll(async () => {
        const colors = await toggle.evaluate((element) => ["::before", "::after"].map((pseudo) => getComputedStyle(element, pseudo).backgroundColor));
        return ratio(...colors);
      }).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the focus ring reaches 3:1 on both surfaces and danger text 4.5:1 on the card", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    await settleWorkspace(gallery);
    await gallery.getByRole("button", { name: "Points", exact: true }).click();
    const feedback = gallery.locator(".zone-feedback");
    const ring = async () => {
      // Draw's Back goes to Your areas (UX9).
      const button = gallery.getByRole("button", { name: "Back to areas", exact: true });
      // A Tab first, so the focus is keyboard focus (:focus-visible).
      await page.keyboard.press("Tab");
      await button.focus();
      return style(button, "outlineColor");
    };
    await theme(page, HA_LIGHT);
    await expect.poll(async () => {
      const color = await ring();
      return { color, sunken: ratio(color, "rgb(229, 229, 229)"), card: ratio(color, "rgb(255, 255, 255)") };
    }, "#009ac7 is 2.59:1 on #e5e5e5").toEqual({ color: "rgb(0, 139, 179)", sunken: 3.12, card: 3.93 });
    await expect.poll(async () => ratio(await style(feedback, "color"), "rgb(255, 255, 255)")).toBeGreaterThanOrEqual(4.5);

    await theme(page, HA_DARK);
    await expect.poll(async () => {
      const color = await ring();
      return { color, sunken: ratio(color, "rgb(40, 40, 40)"), card: ratio(color, "rgb(28, 28, 28)") };
    }, "a passing indicator is kept").toEqual({ color: "rgb(0, 154, 199)", sunken: 4.53, card: 5.23 });
    await expect.poll(async () => ratio(await style(feedback, "color"), "rgb(28, 28, 28)")).toBeGreaterThanOrEqual(4.5);
  });

  test("Delete area text keeps contrast at rest, hover and press in both themes", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-saved" });
    const button = gallery.getByRole("button", { name: "Delete", exact: true });
    for (const vars of [HA_LIGHT, HA_DARK]) {
      await theme(page, vars);
      const check = async () => expect.poll(async () => ratio(await paint(button, "color"), await paint(button, "backgroundColor"))).toBeGreaterThanOrEqual(4.5);
      await check();
      await button.hover();
      await check();
      await page.mouse.down();
      await check();
      await page.mouse.move(0, 0);
      await page.mouse.up();
    }
  });

  // The indicator is checked on every surface it sits on. A light card over
  // a dark sunken surface needs a step away from the card's far end; when no
  // step reaches 3:1 on both, the end colour with the greater minimum wins.
  test("the indicator reaches 3:1 on a light card and a dark sunken surface, or is the end colour that contrasts more", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const gallery = await loadGallery(page, { scenario: "draw" });
    await settleWorkspace(gallery);
    const tool = gallery.getByRole("button", { name: "Paint", exact: true });
    await tool.click();
    await expect(tool).toHaveAttribute("aria-pressed", "true");
    const measure = (card, sunken) => async () => {
      const color = await style(tool, "borderTopColor");
      return { color, card: ratio(color, card), sunken: ratio(color, sunken) };
    };
    await theme(page, { ...HA_LIGHT, "--primary-color": "#000000", "--card-background-color": "#ffffff", "--secondary-background-color": "#000000" });
    await expect.poll(measure("rgb(255, 255, 255)", "rgb(0, 0, 0)"), "black is 1:1 on the black surface; the first step toward white that passes both")
      .toEqual({ color: "rgb(102, 102, 102)", card: 5.74, sunken: 3.66 });
    // #767676 sends the search toward black first, but white's minimum
    // (4.54 on the card) beats black's (4 on #6c6c6c).
    await theme(page, { ...HA_LIGHT, "--primary-color": "#767676", "--card-background-color": "#767676", "--secondary-background-color": "#6c6c6c" });
    await expect.poll(measure("rgb(118, 118, 118)", "rgb(108, 108, 108)"), "no step passes; the end colour with the greater minimum")
      .toEqual({ color: "rgb(255, 255, 255)", card: 4.54, sunken: 5.25 });
    expect(errors).toEqual([]);
  });

  // A filled button's hover and press mix away from its label, so the label
  // keeps 4.5:1 in a dark theme too.
  test("hovered and pressed primary and Stop keep their label at 4.5:1 in HA's dark palette", async ({ page }) => {
    // Reduced motion makes the state colours land at once (tokens.ts).
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "cleaning", narrow: true });
    await settleWorkspace(gallery);
    await theme(page, HA_DARK);
    const states = async (button) => {
      await expect.poll(() => style(button, "backgroundColor")).not.toBe("rgb(219, 68, 55)");
      await expect.poll(() => style(button, "backgroundColor")).not.toBe("rgb(0, 154, 199)");
      await button.hover();
      const label = await paint(button, "color");
      const hover = ratio(label, await paint(button, "backgroundColor"));
      await page.mouse.down();
      const active = ratio(label, await paint(button, "backgroundColor"));
      await page.mouse.move(0, 0);
      await page.mouse.up();
      return { label, hover, active };
    };
    expect(await states(gallery.getByRole("button", { name: "Stop cleaning" }))).toEqual({ label: "rgb(255, 255, 255)", hover: 5.97, active: 7.43 });
    await openEmptyPicker(gallery);
    expect(await states(gallery.getByRole("button", { name: "Create a plan" }))).toEqual({ label: "rgb(255, 255, 255)", hover: 6.14, active: 7.61 });
  });

  // An unparsable, transparent or translucent theme colour is never written
  // as a fill: the resolved property goes, so the button shows HA's colour.
  test("a theme colour the resolver cannot measure leaves HA's own colour in place @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "plans", narrow: true });
    await openEmptyPicker(gallery);
    const shell = gallery.locator("matic-map-shell-v4");
    const create = gallery.getByRole("button", { name: "Create a plan" });
    const state = async () => ({
      property: await shell.evaluate((element) => element.style.getPropertyValue("--ms-resolved-accent-fill")),
      fill: await style(create, "backgroundColor"),
    });
    await theme(page, HA_LIGHT);
    await expect.poll(state, "HA's default is resolved").toEqual({ property: "rgba(0,123,159,1)", fill: "rgb(0, 123, 159)" });
    await theme(page, { "--primary-color": "not-a-colour" });
    await expect.poll(state, "unparsable").toEqual({ property: "", fill: "rgba(0, 0, 0, 0)" });
    await theme(page, { "--primary-color": "rgba(0, 0, 0, 0)" });
    await expect.poll(state, "transparent").toEqual({ property: "", fill: "rgba(0, 0, 0, 0)" });
    await theme(page, { "--primary-color": "rgba(0, 154, 199, 0.5)" });
    await expect.poll(state, "translucent").toEqual({ property: "", fill: "rgba(0, 154, 199, 0.5)" });
  });

  // Only the contrast resolver needs an opaque colour. The canvas palette
  // draws a translucent theme colour's RGB, and its accent (the selected-room
  // stroke) is the resolved indicator (design-system.md §7).
  test("the canvas palette keeps a translucent colour's RGB and strokes with the indicator", async ({ page }) => {
    const bundle = await build({
      stdin: { contents: 'export { readCanvasPalette } from "./frontend/map-studio-v4/theme-probe";', resolveDir: process.cwd() },
      bundle: true, format: "esm", write: false,
    });
    await page.route("**/theme-probe-harness.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const palette = await page.evaluate(async () => {
      const { readCanvasPalette } = await import("/theme-probe-harness.js");
      const host = document.createElement("div");
      for (const [name, value] of Object.entries({
        "--ms-accent": "#009ac7",
        "--ms-resolved-indicator": "rgba(0,139,179,1)",
        "--ms-on-accent": "#008bb3",
        "--ms-resolved-on-indicator": "#000000",
        "--ms-surface-card": "rgba(28, 28, 28, 0.5)",
        "--ms-surface-sunken": "rgba(40, 40, 40, 0.8)",
      })) host.style.setProperty(name, value);
      document.body.append(host);
      const { accent, onAccent, plate, roomFill } = readCanvasPalette(host);
      return { accent, onAccent, plate, roomFill };
    });
    expect(palette).toEqual({ accent: [0, 139, 179], onAccent: [0, 0, 0], plate: [28, 28, 28], roomFill: [40, 40, 40] });
  });

  // design-system.md §3 and §7: every selection and checked state reads the
  // indicator, so with HA's light palette (#009ac7 is 2.59:1 on #e5e5e5)
  // they all show the resolved #008bb3.
  test("pressed buttons, checkboxes, the slider and a checked switch show the resolved indicator", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    await settleWorkspace(gallery);
    await theme(page, HA_LIGHT);
    const indicator = "rgb(0, 139, 179)";
    const paint = gallery.getByRole("button", { name: "Paint", exact: true });
    await paint.click();
    await expect(paint).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => style(paint, "borderTopColor"), "pressed tool").toBe(indicator);
    await gallery.getByRole("button", { name: /^Brush width, / }).click();
    await expect.poll(() => style(gallery.getByRole("slider", { name: "Brush width slider" }), "accentColor"), "brush slider").toBe(indicator);

    // Run's "Plan enabled" switch (plan.md §3), on for an enabled plan.
    await gallery.evaluate((element) => element.setScenario("plan-saved-intelligent"));
    await settleWorkspace(gallery);
    const enabled = gallery.getByRole("switch", { name: "Plan enabled" });
    await expect(enabled).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => enabled.evaluate((element) => getComputedStyle(element, "::before").backgroundColor), "checked switch").toBe(indicator);
    await gallery.evaluate((element) => element.setScenario("plan-new"));
    await settleWorkspace(gallery);
    await expect.poll(() => style(gallery.getByRole("checkbox", { name: /^Include / }).first(), "accentColor"), "plan room").toBe(indicator);
    const saved = gallery.getByRole("group", { name: "Cleaning order" }).locator('[aria-pressed="true"]');
    await expect.poll(() => style(saved, "borderTopColor"), "pressed order").toBe(indicator);

    // The Room names switch row sits in the phone's Map options menu
    // (home-rooms.md §5 Display).
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await loadGallery(page, { scenario: "ready", narrow: true });
    await settleWorkspace(phone);
    await theme(page, HA_LIGHT);
    await phone.getByRole("button", { name: "Map options", exact: true }).click();
    const names = phone.getByRole("menuitemcheckbox", { name: "Room names" }).locator(".ms-switch");
    await expect.poll(() => names.evaluate((element) => getComputedStyle(element, "::before").backgroundColor), "Room names").toBe(indicator);
  });

  // One ordering rule: a press always shows over hover, for every variant.
  test("a pressed button shows its pressed colour, not its hover colour", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "rooms" });
    await settleWorkspace(gallery);
    const states = async (button) => {
      await button.hover();
      const hover = await style(button, "backgroundColor");
      await page.mouse.down();
      const pressed = await style(button, "backgroundColor");
      await page.mouse.move(0, 0);
      await page.mouse.up();
      return { differ: hover !== pressed };
    };
    expect(await states(gallery.getByRole("button", { name: "Fit the whole map on screen" })), "plain").toEqual({ differ: true });
    expect(await states(gallery.getByRole("button", { name: "Back to all tasks" })), "secondary").toEqual({ differ: true });
  });
});
