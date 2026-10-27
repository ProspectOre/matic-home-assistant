import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

// Custom areas in plans (docs/actions.md "Custom areas in plans"): Edit adds,
// orders, sets and removes a plan's saved custom areas, Save sends the run
// order Edit shows, and Your areas names the plans that clean each area.

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

async function loadGallery(page, { scenario = "ready", narrow = false } = {}) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
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
  const gallery = page.locator(GALLERY_TAG);
  await settleWorkspace(gallery);
  return gallery;
}

async function settleWorkspace(gallery) {
  const { workflow } = await gallery.evaluate((element) => element.getWorkspaceSnapshot());
  if (workflow !== "none") await expect(gallery.locator("matic-map-workflow-v4")).toBeAttached();
  await gallery.evaluate(async (element) => {
    await element.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

const snapshot = (page) => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot(), GALLERY_TAG);

/** The draft's run order as Edit shows it: room IDs and "area:" IDs. */
const runOrder = async (page) => {
  const { planDraft } = await snapshot(page);
  const order = [];
  for (let at = 0; at <= planDraft.rooms.length; at += 1) {
    for (const area of planDraft.areas) if (Math.min(area.slot, planDraft.rooms.length) === at) order.push(`area:${area.areaId}`);
    if (at < planDraft.rooms.length) order.push(planDraft.rooms[at].roomId);
  }
  return order;
};

/** The primary action the shell shows for the gallery's state. */
const primary = (page) => page.evaluate((tag) => {
  const action = window.__galleryModule.selectPrimaryAction(document.querySelector(tag).getWorkspaceSnapshot());
  return { label: action.label, enabled: action.enabled, reasonKey: action.reasonKey, reason: action.reason };
}, GALLERY_TAG);

// The deepest focused element's accessible name.
const focusedName = (page) => page.evaluate(() => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active?.getAttribute("aria-label") ?? active?.localName;
});

const axeFindings = (results) => results.map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.flat().join(" >> ")).join(" | ")}`);

test.describe("plan Edit with custom areas", () => {
  test("lists the plan's areas in their places, numbered with the rooms in Saved order", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-areas" });
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    await expect(gallery.getByText("3 rooms · 2 custom areas", { exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: /^Settings for / })).toHaveText([
      /^\s*1\s*Kitchen/u, /^\s*2\s*Entryway\s*Vacuum · Optimal\s*Custom area · Every run/u, /^\s*3\s*Living room/u,
      /^\s*4\s*Office/u, /^\s*5\s*Under the dining table\s*Mop\s*Custom area · Every run/u,
    ]);
    // The rooms left out follow, as before; the areas are all in the plan.
    await expect(list.getByRole("checkbox", { name: "Include Bedroom", exact: true })).not.toBeChecked();
    await expect(gallery.getByRole("heading", { name: "Custom areas", level: 3, exact: true })).toBeVisible();
    await expect(gallery.getByText("No other custom areas are ready to add. Draw or redraw one in Your areas.", { exact: true })).toBeVisible();
    // The note that areas couldn't be edited here is gone.
    await expect(gallery.getByText(/Saving keeps each custom area/u)).toHaveCount(0);
    const first = list.getByRole("button", { name: "Move Entryway earlier", exact: true });
    await expect(first).not.toHaveAttribute("aria-disabled");
    await expect(list.getByRole("button", { name: "Move Under the dining table later", exact: true })).toHaveAccessibleDescription("Under the dining table is already last");
  });

  test("moves an area among the rooms, keeps focus on the arrow and says where it went", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-areas" });
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    expect(await runOrder(page)).toEqual(["room-a", "area:entryway", "room-b", "room-c", "area:dining"]);
    const earlier = list.getByRole("button", { name: "Move Under the dining table earlier", exact: true });
    await earlier.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => runOrder(page)).toEqual(["room-a", "area:entryway", "room-b", "area:dining", "room-c"]);
    await expect(list.getByRole("button", { name: "Move Under the dining table earlier", exact: true })).toBeFocused();
    await expect(gallery.getByRole("status").filter({ hasText: "Under the dining table moved to position 4" })).toHaveCount(1);
    // A room passes an area the same way; rooms keep their own settings.
    await list.getByRole("button", { name: "Move Kitchen later", exact: true }).click();
    await expect.poll(() => runOrder(page)).toEqual(["area:entryway", "room-a", "room-b", "area:dining", "room-c"]);
    await expect(gallery.getByRole("status").filter({ hasText: "Kitchen moved to position 2" })).toHaveCount(1);
    await expect(list.locator(".pos-badge")).toHaveText(["1", "2", "3", "4", "5"]);
    await expect(list.getByRole("button", { name: "Move Entryway earlier", exact: true })).toHaveAccessibleDescription("Entryway is already first");
    expect((await snapshot(page)).planDraft.dirty).toBe(true);
  });

  test("Smart Order includes every room and area without promising a fixed order", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-areas-rotation" });
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    await expect(gallery.getByText("Smart Order chooses the longest-waiting rooms and areas first. Saved order follows your list.", { exact: true })).toBeVisible();
    await expect(list.locator(".pos-badge")).toHaveCount(0);
    await expect(list.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await expect(list.getByRole("button", { name: /^Settings for / })).toHaveText([
      /^\s*Kitchen/u, /^\s*Entryway/u, /^\s*Living room/u, /^\s*Office/u, /^\s*Under the dining table/u,
    ]);
    await gallery.getByRole("button", { name: "Saved order", exact: true }).click();
    await expect(gallery.getByText(/Rooms and custom areas rotate together/u)).toHaveCount(0);
    await expect(list.locator(".pos-badge")).toHaveCount(5);
  });

  test("sets an area's cleaning mode and vacuum coverage, with no coverage for Mop and no schedule", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-areas" });
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    const settings = list.getByRole("button", { name: "Settings for Entryway", exact: true });
    await settings.click();
    await expect(settings).toHaveAttribute("aria-expanded", "true");
    const mode = list.getByRole("combobox", { name: "Cleaning mode for Entryway", exact: true });
    const coverage = list.getByRole("combobox", { name: "Vacuum coverage for Entryway", exact: true });
    await coverage.selectOption("heavy_duty");
    await expect(settings).toContainText("Vacuum · Heavy duty");
    await mode.selectOption("mop");
    await expect(coverage).toHaveCount(0);
    await expect(settings).toContainText("Mop");
    await expect(list.getByRole("switch", { name: "Double-pass mopping" })).toBeVisible();
    // An area runs every time: it has no room schedule.
    await expect(list.getByRole("group", { name: /^Smart cleaning for / })).toHaveCount(0);
    const { planDraft } = await snapshot(page);
    expect(planDraft.areas.find((area) => area.areaId === "entryway")).toMatchObject({ cleaningMode: "mop", coverageSetting: "heavy_duty" });
    // One row is open at a time: opening a room closes the area.
    await list.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
    await expect(settings).toHaveAttribute("aria-expanded", "false");
  });

  test("adds a saved area last in the run, focuses it, and an unticked area gets its settings back", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-ordered" });
    // A plan of rooms keeps its Rooms list as it was; Custom areas follows it.
    const rooms = gallery.getByRole("list", { name: "Rooms", exact: true });
    await expect(rooms.getByRole("listitem")).toHaveCount(4);
    await expect(gallery.getByText("3 of 4 selected", { exact: true })).toBeVisible();
    const choices = gallery.getByRole("list", { name: "Custom areas", exact: true });
    await expect(gallery.getByText("Choose a custom area to clean it every time this plan runs.", { exact: true })).toBeVisible();
    await expect(choices.getByRole("listitem")).toHaveText([/^\s*Entryway\s*Vacuum · Optimal\s*$/u]);
    // The row moves to the run list, so the checkbox is clicked rather than checked in place.
    await choices.getByRole("checkbox", { name: "Include Entryway", exact: true }).click();
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    const include = list.getByRole("checkbox", { name: "Include Entryway", exact: true });
    await expect(include).toBeChecked();
    await expect(include).toBeFocused();
    expect(await runOrder(page)).toEqual(["room-a", "room-b", "room-c", "area:entryway"]);
    await expect(gallery.getByText("3 rooms · 1 custom area", { exact: true })).toBeVisible();
    await expect(list.locator(".pos-badge")).toHaveText(["1", "2", "3", "4"]);
    await list.getByRole("button", { name: "Settings for Entryway", exact: true }).click();
    await list.getByRole("combobox", { name: "Cleaning mode for Entryway", exact: true }).selectOption("vacuum_and_mop");
    // Unticked, it goes back to Custom areas and takes focus there.
    await include.click();
    const again = choices.getByRole("checkbox", { name: "Include Entryway", exact: true });
    await expect(again).toBeFocused();
    await expect(again).not.toBeChecked();
    expect((await snapshot(page)).planDraft.areas).toEqual([]);
    await expect(gallery.getByRole("list", { name: "Rooms", exact: true })).toBeVisible();
    await again.click();
    expect((await snapshot(page)).planDraft.areas).toEqual([expect.objectContaining({ areaId: "entryway", cleaningMode: "vacuum_and_mop", slot: 3 })]);
    await expect.poll(() => focusedName(page)).toBe("Include Entryway");
  });

  test("a room taken out closes up around the areas, which keep their places", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-areas" });
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    await list.getByRole("checkbox", { name: "Include Kitchen", exact: true }).uncheck();
    expect(await runOrder(page)).toEqual(["area:entryway", "room-b", "room-c", "area:dining"]);
    await list.getByRole("checkbox", { name: "Include Kitchen", exact: true }).check();
    expect(await runOrder(page)).toEqual(["area:entryway", "room-b", "room-c", "area:dining", "room-a"]);
  });

  test("a plan of areas alone saves; taking out its last area leaves nothing to save", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-run-areas-only" });
    await gallery.getByRole("button", { name: /^Edit / }).click();
    await settleWorkspace(gallery);
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    await expect(gallery.getByText("2 custom areas", { exact: true })).toBeVisible();
    await list.getByRole("checkbox", { name: "Include Entryway", exact: true }).click();
    expect(await primary(page)).toMatchObject({ label: "Save", enabled: true });
    await list.getByRole("checkbox", { name: "Include Under the dining table", exact: true }).click();
    expect(await primary(page)).toMatchObject({ label: "Save", enabled: false, reasonKey: "v4_reason_save_plan",
      reason: "Can't save until the plan has a name and at least one room or custom area." });
  });

  test("an area deleted or drawn on another map needs attention, and one drawn elsewhere holds Save", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-area-stale" });
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    const porch = list.getByRole("button", { name: "Settings for Porch mat", exact: true });
    const rug = list.getByRole("button", { name: "Settings for Old rug", exact: true });
    await expect(porch).toContainText("Needs attention");
    await expect(porch).toHaveAccessibleDescription("Redraw it before cleaning");
    await expect(rug).toContainText("Needs attention");
    await expect(rug).toHaveAccessibleDescription("Not found · Remove it from this plan");
    await expect(list.getByRole("button", { name: "Settings for Entryway", exact: true })).not.toContainText("Needs attention");
    // Neither is dropped behind the user's back.
    expect((await snapshot(page)).planDraft.areas.map((area) => area.areaId)).toEqual(["entryway", "dining", "porch", "old-rug"]);
    expect(await primary(page)).toMatchObject({ enabled: false, reasonKey: "v4_reason_save_plan_areas",
      reason: "Can't save until you remove the custom areas that need attention." });
    await expect(gallery.locator(".action-reason")).toHaveText("Can't save until you remove the custom areas that need attention.");
    await list.getByRole("checkbox", { name: "Include Porch mat", exact: true }).click();
    // One the areas list doesn't hold is left to Home Assistant, as that list may be older.
    expect(await primary(page)).toMatchObject({ label: "Save", enabled: true });
    await list.getByRole("checkbox", { name: "Include Old rug", exact: true }).click();
    expect((await snapshot(page)).planDraft.areas.map((area) => area.areaId)).toEqual(["entryway", "dining"]);
    // Neither can be added again here: only areas ready on this map are offered.
    await expect(gallery.getByRole("list", { name: "Custom areas", exact: true })).toHaveCount(0);
  });

  test("while a save is pending every area control is held and says why", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-ordered" });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, command: "pending", pendingAction: "save-plan",
        planDraft: { ...state.planDraft, areas: [{ areaId: "entryway", name: "Entryway", cleaningMode: "vacuum", coverageSetting: "standard", slot: 1 }] } });
    });
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    const include = list.getByRole("checkbox", { name: "Include Entryway", exact: true });
    await expect(include).toHaveAttribute("aria-disabled", "true");
    await expect(include).toHaveAccessibleDescription("Waiting for Home Assistant to save the plan.");
    await include.dispatchEvent("click");
    await expect(include).toBeChecked();
    const earlier = list.getByRole("button", { name: "Move Entryway earlier", exact: true });
    await expect(earlier).toHaveAttribute("aria-disabled", "true");
    await earlier.dispatchEvent("click");
    expect(await runOrder(page)).toEqual(["room-a", "area:entryway", "room-b", "room-c"]);
  });

  test("a plan holds up to 100 custom areas", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-ordered" });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      const areas = Array.from({ length: 100 }, (_, index) => ({ areaId: `spot-${index}`, name: `Spot ${index}`, cleaningMode: "vacuum", coverageSetting: "standard", slot: 3 }));
      element.replaceWorkspaceState({ ...state, planDraft: { ...state.planDraft, areas } });
    });
    const limit = "Can't add more custom areas until you remove one; a plan holds up to 100.";
    await expect(gallery.getByText(limit, { exact: true })).toBeVisible();
    const entryway = gallery.getByRole("list", { name: "Custom areas", exact: true }).getByRole("checkbox", { name: "Include Entryway", exact: true });
    await expect(entryway).toHaveAttribute("aria-disabled", "true");
    await expect(entryway).toHaveAccessibleDescription(limit);
    await entryway.dispatchEvent("click");
    expect((await snapshot(page)).planDraft.areas).toHaveLength(100);
  });

  test("Cancel discards area changes and Run lists the saved areas again", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-areas" });
    const list = gallery.getByRole("list", { name: "Rooms and custom areas", exact: true });
    await list.getByRole("checkbox", { name: "Include Entryway", exact: true }).click();
    await gallery.getByRole("button", { name: "Cancel", exact: true }).click();
    const dialog = gallery.getByRole("dialog");
    await dialog.getByRole("button", { name: "Discard", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).planView).toBe("run");
    expect(await runOrder(page)).toEqual(["room-a", "area:entryway", "room-b", "room-c", "area:dining"]);
    await expect(gallery.locator("ol.run-list > li")).toHaveCount(5);
  });

  for (const [scenario, open] of [["plan-edit-areas", "Entryway"], ["plan-edit-area-stale", "Porch mat"], ["plan-edit-ordered", null]]) {
    for (const [width, height] of [[390, 844], [1024, 768]]) {
      const narrow = width < 1024;
      test(`${scenario} Edit rows at ${width} have no serious axe finding${narrow ? " @mobile" : ""}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        const gallery = await loadGallery(page, { scenario, narrow });
        if (open) {
          const settings = gallery.getByRole("button", { name: `Settings for ${open}`, exact: true });
          await settings.click();
          await expect(settings).toHaveAttribute("aria-expanded", "true");
        }
        const { violations, incomplete } = await new AxeBuilder({ page }).analyze();
        expect(axeFindings(violations.filter(({ impact }) => impact === "serious" || impact === "critical"))).toEqual([]);
        expect(axeFindings(incomplete.filter(({ id }) => id === "aria-prohibited-attr"))).toEqual([]);
      });
    }
  }
});

test.describe("Run and home with custom areas", () => {
  test("Run lists rooms and areas in their places, a part each", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-run-areas" });
    await expect(gallery.getByText("3 rooms · 2 custom areas", { exact: true })).toBeVisible();
    await expect(gallery.locator("ol.run-list > li bdi")).toHaveText(["Kitchen", "Entryway", "Living room", "Office", "Under the dining table"]);
    await expect(gallery.locator("ol.run-list > li[data-break]")).toHaveCount(3);
    await expect(gallery.getByText("The robot cleans in 4 parts and may stop at the dock between parts.", { exact: true })).toBeVisible();
  });

  test("Intelligent Run shows the mixed server order even when areas cross rooms", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-edit-areas-rotation" });
    await gallery.evaluate((element) => element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), planView: "run" }));
    await settleWorkspace(gallery);
    await expect(gallery.locator("ul.run-list > li bdi")).toHaveText(["Under the dining table", "Office", "Entryway", "Living room", "Kitchen"]);
    await expect(gallery.getByText("Smart Order cleans the rooms and areas that have waited longest first, checking again each time.", { exact: true })).toBeVisible();
    await expect(gallery.locator("ul.run-list > li[data-break]")).toHaveCount(3);
  });

  test("a plan of areas alone lists them and no rooms", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-run-areas-only" });
    await expect(gallery.getByText("2 custom areas", { exact: true })).toBeVisible();
    await expect(gallery.getByText("0 rooms", { exact: true })).toHaveCount(0);
    await expect(gallery.getByText("The robot cleans in 2 parts and may stop at the dock between parts.", { exact: true })).toBeVisible();
    await expect(gallery.locator("ol.run-list > li bdi")).toHaveText(["Entryway", "Under the dining table"]);
  });

  test("a home shortcut for a plan with areas counts them", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "home-shortcut-areas" });
    await expect(gallery.getByText(/^3 rooms · 2 custom areas · /u)).toBeVisible();
    await expect(gallery.getByText(/^2 custom areas · /u)).toBeVisible();
  });
});

test.describe("Your areas with plans", () => {
  test("each area names the plans that clean it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "areas-in-plans" });
    const row = (id) => gallery.locator(`[data-area-row="${id}"]`);
    await expect(row("entryway")).toContainText("In 2 plans: \"Daily clean\" and \"Spots\"");
    await expect(row("dining")).toContainText("In 2 plans: \"Daily clean\" and \"Spots\"");
    await expect(row("hallway").locator("[data-in-plans]")).toHaveCount(0);
    await expect(row("porch").locator("[data-in-plans]")).toHaveCount(0);
    await row("entryway").click();
    await settleWorkspace(gallery);
    await expect(gallery.getByText("In 2 plans: \"Daily clean\" and \"Spots\"", { exact: true })).toBeVisible();
    // Delete says which plans stop cleaning it.
    await gallery.locator("[data-dialog-launcher=confirmDeleteArea]").click();
    const dialog = gallery.getByRole("dialog", { name: "Delete area?" });
    await expect(dialog).toContainText("Automations that clean \"Entryway\" will stop working, and \"Daily clean\" and \"Spots\" won't clean it anymore. The robot won't move.");
  });

  test("one plan reads in the singular, and a plan the area is all of isn't promised to change", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-delete-refused" });
    await expect(gallery.getByText("In 1 plan: \"Entryway only\"", { exact: true })).toBeVisible();
    // The refused delete's notice names the plan to change first.
    await expect(gallery.getByText("Can't delete this area because it's all that \"Entryway only\" cleans. Edit or delete that plan first.").first()).toBeVisible();
    await gallery.evaluate((element) => element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), notice: null, dialog: "confirmDeleteArea" }));
    const dialog = gallery.getByRole("dialog", { name: "Delete area?" });
    await expect(dialog).toContainText("Automations that clean \"Entryway\" will stop working, and the robot won't move.");
  });

  for (const scenario of ["areas-in-plans", "area-delete-refused"]) {
    test(`${scenario} has no serious axe finding`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await loadGallery(page, { scenario });
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(axeFindings(violations.filter(({ impact }) => impact === "serious" || impact === "critical"))).toEqual([]);
    });
  }
});

test.describe("custom area plan saves", () => {
  // `window.planEffects(scenario)`: an EffectController over a gallery
  // scenario with a synced robot and a current map; `run.calls` lists
  // [service, data] per Home Assistant call (as map_studio_v4.spec.mjs).
  async function loadPlanEffects(page) {
    const bundle = await build({
      stdin: {
        contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore, draftForPlan, selectPrimaryAction } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
        resolveDir: process.cwd(),
      },
      bundle: true, format: "esm", write: false,
    });
    await page.route("**/plan-areas-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const m = await import("/plan-areas-test.js");
      const ticks = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
      window.planEffects = async (scenario) => {
        const initial = m.createGalleryState(scenario);
        const store = new m.WorkspaceStore(initial);
        const aborted = async () => { throw new DOMException("Aborted", "AbortError"); };
        const run = { m, initial, store, calls: [], plans: null };
        run.effects = new m.EffectController(store, {
          catalog: async () => [initial.resources.entry], scene: aborted, pose: aborted,
          history: async () => initial.resources.history.value,
          areas: async () => initial.resources.areas.value,
          plans: async () => run.plans ? run.plans() : structuredClone(initial.resources.plans.value),
          service: async (_domain, service, data) => { run.calls.push([service, data]); },
          dispose() {},
        });
        run.effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "one", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
        await run.effects.refreshCatalog(true);
        await ticks();
        store.patch({ map: initial.map, coherence: "current", workflow: initial.workflow, planView: initial.planView,
          selection: initial.selection, planDraft: initial.planDraft,
          resources: { ...store.value.resources, plans: initial.resources.plans, areas: initial.resources.areas } });
        return run;
      };
    });
  }

  test("Save sends the run order Edit shows, every area with its settings", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-edit-areas");
      const { store, effects } = run;
      const draft = store.value.planDraft;
      // Edit's moves and settings: the dining table before Office, Entryway mopped.
      store.dispatch({ type: "patch-plan-draft", patch: {
        areas: draft.areas.map((area) => area.areaId === "dining" ? { ...area, slot: 2 }
          : { ...area, cleaningMode: "mop" }),
      } });
      // Living room taken out: the areas after it keep their places.
      store.dispatch({ type: "toggle-room", roomId: "room-b" });
      await effects.savePlan();
      const sent = run.calls[0];
      effects.dispose();
      return { service: sent?.[0], rooms: sent?.[1].rooms, runBehavior: sent?.[1].run_behavior };
    });
    expect(result).toEqual({
      service: "save_plan",
      runBehavior: "ordered",
      rooms: [
        { room: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" },
        { area: "entryway", cleaning_mode: "mop", coverage_setting: "standard" },
        { area: "dining", cleaning_mode: "mop", coverage_setting: "standard" },
        { room: "room-c", cleaning_mode: "vacuum", coverage_setting: "standard" },
      ],
    });
  });

  test("an added area is saved last with its own settings, and an unticked one is not sent", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-edit-ordered");
      const { store, effects } = run;
      store.dispatch({ type: "patch-plan-draft", patch: {
        areas: [{ areaId: "entryway", name: "Entryway", cleaningMode: "vacuum", coverageSetting: "heavy_duty", slot: 3 }],
        parkedAreas: [{ areaId: "gone", name: "Gone", cleaningMode: "mop", coverageSetting: "quick", slot: 0 }],
      } });
      await effects.savePlan();
      const saved = store.value.planDraft;
      effects.dispose();
      return { rooms: run.calls[0]?.[1].rooms.map((item) => item.area ?? item.room), entryway: run.calls[0]?.[1].rooms[3],
        parked: saved.parkedAreas ?? [], dirty: saved.dirty };
    });
    expect(result).toEqual({
      rooms: ["room-a", "room-b", "room-c", "entryway"],
      entryway: { area: "entryway", cleaning_mode: "vacuum", coverage_setting: "heavy_duty" },
      parked: [],
      dirty: false,
    });
  });

  test("the Run switch saves a freshly read plan with its areas exactly as they were", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-run-areas");
      const { store, effects } = run;
      const plan = store.value.resources.plans.value.plans[0];
      await effects.setPlanEnabled(false);
      const sent = run.calls[0]?.[1];
      effects.dispose();
      return { entries: plan.entries, rooms: sent?.rooms, enabled: sent?.enabled };
    });
    expect(result.enabled).toBe(false);
    expect(result.rooms).toEqual(result.entries.map((entry) => entry.kind === "room"
      ? { room: entry.room_id, cleaning_mode: "vacuum", coverage_setting: "standard" }
      : { area: entry.area_id, cleaning_mode: entry.cleaning_mode, coverage_setting: entry.coverage_setting }));
  });

  test("Save is held while an area in a changed plan needs attention", async ({ page }) => {
    await loadPlanEffects(page);
    const result = await page.evaluate(async () => {
      const run = await window.planEffects("plan-edit-area-stale");
      const { m, store } = run;
      const held = m.selectPrimaryAction(store.value);
      // A clean draft has nothing to save: Done stays available.
      const done = m.selectPrimaryAction({ ...store.value, planDraft: { ...store.value.planDraft, dirty: false } });
      store.patch({ planDraft: { ...store.value.planDraft, areas: store.value.planDraft.areas.filter((area) => area.areaId !== "porch") } });
      const ready = m.selectPrimaryAction(store.value);
      // Unknown areas (the list not read yet) leave the check to Home Assistant.
      store.patch({ resources: { ...store.value.resources, areas: { status: "idle", value: null, problem: null } },
        planDraft: { ...store.value.planDraft, areas: [{ areaId: "gone", name: "Gone", cleaningMode: "vacuum", coverageSetting: "quick", slot: 0 }] } });
      const unknown = m.selectPrimaryAction(store.value);
      run.effects.dispose();
      return { held: [held.enabled, held.reasonKey], done: [done.label, done.enabled], ready: ready.enabled, unknown: unknown.enabled };
    });
    expect(result).toEqual({ held: [false, "v4_reason_save_plan_areas"], done: ["Done", true], ready: true, unknown: true });
  });
});
