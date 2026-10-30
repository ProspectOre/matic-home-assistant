// UX4 Home and rooms (docs/ux-spec-0.5/home-rooms.md; D1-D5 accepted
// 2026-10-11). Home gets one heading per state and three task cards, Rooms a
// settings disclosure, check lines and `.ms-check` rows, and the narrow
// Display group moves into Map options.
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import { installPanelFixture, openPlanPicker } from "./map_studio_v4_panel_fixture.mjs";

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";
const HARNESS = "/home-rooms-test.js";

async function loadGallery(page, { scenario = "ready", narrow = false, viewport = null } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  else if (narrow) await page.setViewportSize({ width: 390, height: 844 });
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
  return page.locator(GALLERY_TAG);
}

// The store and gallery fixtures, bundled from source, for reducer-level
// assertions that need no rendering.
async function loadStoreHarness(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { WorkspaceStore, selectPrimaryAction, canSelectRooms } from "./frontend/map-studio-v4/state"; export { createGalleryState, withGalleryRoomPreview } from "./frontend/map-studio-v4/gallery-state"; export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { GestureController } from "./frontend/map-studio-v4/gesture-controller"; export { roomsSummary, roomTapAnnouncement } from "./frontend/map-studio-v4/rooms-view"; export { extendLiveTrail, watchRuns } from "./frontend/map-studio-v4/run-history-data";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route(`**${HARNESS}`, (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

const snapshot = (page) => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot(), GALLERY_TAG);

const patchState = (gallery, patch) => gallery.evaluate((element, applied) => {
  element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), ...applied });
}, patch);

const recordActions = (page) => page.evaluate((tag) => {
  const element = document.querySelector(tag);
  element.__actions = [];
  element.addEventListener("matic-workspace-action", (event) => element.__actions.push(event.detail));
}, GALLERY_TAG);

const actions = (page) => page.evaluate((tag) => document.querySelector(tag).__actions, GALLERY_TAG);

const twoRooms = (state, activity = state.activity) => ({
  ...state,
  activity,
  selection: {
    ...state.selection,
    roomIds: ["room-a", "room-b"],
    roomSettings: [
      { roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "standard" },
      { roomId: "room-b", cleaningMode: "vacuum", coverageSetting: "standard" },
    ],
  },
});

test.describe("plan origin (home-rooms.md §5 Cards D1; plan.md §5 State)", () => {
  test("a plan opened from home returns to home, one opened from the picker returns to the picker", async ({ page }) => {
    await loadStoreHarness(page);
    const result = await page.evaluate(async (harness) => {
      const { WorkspaceStore, createGalleryState } = await import(harness);
      const store = new WorkspaceStore(createGalleryState("ready"));
      const out = {};
      store.dispatch({ type: "select-plan", planId: "daily", origin: "home" });
      out.fromHome = [store.value.planOrigin, store.value.planView, store.value.workflow];
      store.dispatch({ type: "select-plan", planId: "daily" });
      out.reselectKeeps = store.value.planOrigin;
      store.dispatch({ type: "set-plan-view", view: "edit" });
      store.dispatch({ type: "dismiss-top-layer" });
      out.afterEditBack = [store.value.planView, store.value.planOrigin];
      store.dispatch({ type: "dismiss-top-layer" });
      out.homeBack = [store.value.workflow, store.value.planOrigin];
      store.dispatch({ type: "open-workflow", workflow: "plans" });
      store.dispatch({ type: "select-plan", planId: "daily" });
      out.fromPicker = store.value.planOrigin;
      store.dispatch({ type: "dismiss-top-layer" });
      out.pickerBack = store.value.workflow;
      store.dispatch({ type: "open-workflow", workflow: "none" });
      store.dispatch({ type: "select-plan", planId: "daily" });
      out.defaultOrigin = store.value.planOrigin;
      return out;
    }, HARNESS);
    expect(result.fromHome).toEqual(["home", "run", "plan"]);
    expect(result.reselectKeeps).toBe("home");
    expect(result.afterEditBack).toEqual(["run", "home"]);
    expect(result.homeBack).toEqual(["none", "plans"]);
    expect(result.fromPicker).toBe("plans");
    expect(result.pickerBack).toBe("plans");
    expect(result.defaultOrigin).toBe("plans");
  });

  test("Back from Run names and reaches the origin", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent" });
    await patchState(gallery, { planOrigin: "home" });
    const toHome = gallery.getByRole("button", { name: "Back to all tasks" });
    await expect(toHome).toBeVisible();
    await expect(toHome).toContainText("All tasks");
    await toHome.click();
    expect((await snapshot(page)).workflow).toBe("none");

    await patchState(gallery, { workflow: "plan", planView: "run", planOrigin: "plans" });
    const toPlans = gallery.getByRole("button", { name: "Back to plans" });
    await expect(toPlans).toBeVisible();
    await expect(toPlans).toContainText("Your plans");
    await toPlans.click();
    expect((await snapshot(page)).workflow).toBe("plans");
  });
});

test.describe("whole-clean settings (home-rooms.md §5 Settings, Selection gate)", () => {
  test("a whole-clean change becomes the default and rewrites every selected room", async ({ page }) => {
    await loadStoreHarness(page);
    const result = await page.evaluate(async (harness) => {
      const { WorkspaceStore, createGalleryState } = await import(harness);
      const store = new WorkspaceStore({ ...createGalleryState("rooms") });
      const out = {};
      store.dispatch({ type: "set-clean-settings", cleaningMode: "vacuum_and_mop" });
      store.dispatch({ type: "set-clean-settings", coverageSetting: "quick" });
      store.dispatch({ type: "toggle-room", roomId: "room-a" });
      out.newRoom = store.value.selection.roomSettings.find((room) => room.roomId === "room-a");
      store.dispatch({ type: "toggle-room", roomId: "room-b" });
      store.dispatch({ type: "patch-room-settings", roomId: "room-b", cleaningMode: "mop" });
      store.dispatch({ type: "set-clean-settings", coverageSetting: "heavy_duty" });
      out.rewritten = store.value.selection.roomSettings.map((room) => [room.roomId, room.cleaningMode, room.coverageSetting]);
      store.dispatch({ type: "clear-selection" });
      out.afterClear = [store.value.selection.roomIds.length, store.value.selection.cleaningMode, store.value.selection.coverageSetting];
      return out;
    }, HARNESS);
    expect(result.newRoom).toEqual({ roomId: "room-a", cleaningMode: "vacuum_and_mop", coverageSetting: "quick" });
    expect(result.rewritten).toEqual([
      ["room-a", "vacuum_and_mop", "heavy_duty"],
      ["room-b", "vacuum_and_mop", "heavy_duty"],
    ]);
    expect(result.afterClear).toEqual([0, "vacuum_and_mop", "heavy_duty"]);
  });

  test("every rooms intent is refused while the selection is locked", async ({ page }) => {
    await loadStoreHarness(page);
    const result = await page.evaluate(async (harness) => {
      const { WorkspaceStore, createGalleryState, canSelectRooms } = await import(harness);
      const base = createGalleryState("rooms");
      const locked = {
        ...base,
        activity: "cleaning",
        selection: {
          ...base.selection,
          roomIds: ["room-a", "room-b"],
          roomSettings: [
            { roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "standard" },
            { roomId: "room-b", cleaningMode: "vacuum", coverageSetting: "standard" },
          ],
        },
      };
      const store = new WorkspaceStore(locked);
      const before = JSON.stringify(store.value.selection);
      const results = {};
      for (const intent of [
        { type: "toggle-room", roomId: "room-c" },
        { type: "toggle-room", roomId: "room-a" },
        { type: "patch-room-settings", roomId: "room-a", cleaningMode: "mop" },
        { type: "set-clean-settings", cleaningMode: "mop", coverageSetting: "quick" },
        { type: "set-use-room-schedule", value: false },
        { type: "clear-selection" },
      ]) {
        store.dispatch(intent);
        results[intent.type] = JSON.stringify(store.value.selection) === before;
      }
      return { gate: canSelectRooms(locked), results };
    }, HARNESS);
    expect(result.gate).toBe(false);
    expect(result.results).toEqual({
      "toggle-room": true,
      "patch-room-settings": true,
      "set-clean-settings": true,
      "set-use-room-schedule": true,
      "clear-selection": true,
    });
  });

  test("a refused add at the limit raises the limit notice", async ({ page }) => {
    await loadStoreHarness(page);
    const result = await page.evaluate(async (harness) => {
      const { WorkspaceStore, createGalleryState } = await import(harness);
      const store = new WorkspaceStore(createGalleryState("room-limit"));
      store.dispatch({ type: "toggle-room", roomId: "room-extra" });
      const { notice } = store.value;
      return {
        count: store.value.selection.roomIds.length,
        notice: notice && { tone: notice.tone, key: notice.key, placeholders: notice.placeholders },
      };
    }, HARNESS);
    expect(result.count).toBe(100);
    expect(result.notice).toEqual({ tone: "info", key: "v4_room_limit_reached", placeholders: { limit: 100 } });
  });
});

test.describe("no robot (home-rooms.md §4 H10, D2)", () => {
  for (const narrow of [true, false]) {
    test(`the primary action is a link to the integration page (narrow: ${narrow})`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "empty", narrow });
      const link = gallery.locator(".action-bar").getByRole("link", { name: "Open integration" });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", "/config/integrations/integration/matic_robot");
      await expect(link).toHaveClass(/ms-btn--primary/);
      await expect(gallery.getByRole("link", { name: "Open integration" })).toHaveCount(1);
      await expect(gallery.locator(".action-bar button")).toHaveCount(0);
      await recordActions(page);
      await link.evaluate((element) => element.addEventListener("click", (event) => event.preventDefault()));
      await link.click();
      expect(await actions(page)).toEqual([]);
    });
  }
});

// ---- Home by state (home-rooms.md §3 Home, §4 H1-H11) ----------------------

const panelOf = (gallery) => gallery.getByRole("complementary", { name: "Cleaning panel" });
const homeReason = (gallery) => gallery.locator("#home-reason");
// The task cards; the "Your plans" row sits among them (R4 amended). Pinned
// shortcuts sit in their own Shortcuts section above (owner, 2026-10-14).
const cards = (gallery) => gallery.getByRole("group", { name: "Cleaning choices" }).locator("button.ms-row--card");
const shortcutsGroup = (gallery) => gallery.getByRole("group", { name: "Shortcuts" });
// Every card on home, shortcuts first.
const homeCards = (gallery) => panelOf(gallery).locator(".quick-actions button.ms-row--card");
const plansRow = (gallery) => gallery.getByRole("group", { name: "Cleaning choices" }).getByRole("button", { name: "Your plans", exact: true });
const mapsRows = (gallery) => gallery.locator(".maps .ms-row");
const LOCATING = "Waiting for the robot to confirm which floor it is on.";
const BUSY = "You can start a new clean when it's done.";

test.describe("home by state", () => {
  for (const narrow of [true, false]) {
    test(`ready: one heading, three cards, Maps and no idle action bar (narrow: ${narrow})${narrow ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready", narrow });
      await expect(gallery.getByRole("heading", { name: "Choose what to clean", level: 2 })).toBeVisible();
      await expect(panelOf(gallery).locator(".panel-description")).toHaveCount(0);
      const group = gallery.getByRole("group", { name: "Cleaning choices" });
      // The default plan pinned as a one-tap shortcut in its own section
      // first, then two cards and, last, the Your plans row (UX9 owner ruling).
      await expect(shortcutsGroup(gallery).getByRole("button")).toHaveCount(1);
      await expect(planCard(gallery)).toHaveAccessibleName(/^Run Daily clean/);
      await expect(group.getByRole("button")).toHaveCount(3);
      await expect(cards(gallery)).toHaveCount(2);
      await expect(cards(gallery).nth(0)).toHaveAccessibleName(/^Clean rooms Pick rooms and clean them now\./);
      await expect(cards(gallery).nth(0)).not.toHaveClass(/ms-row--featured/);
      await expect(cards(gallery).nth(1)).toHaveAccessibleName(/^Clean custom area Draw or choose a custom area/);
      expect(await shortcutsGroup(gallery).evaluate((element, other) => !!(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING), await group.elementHandle())).toBe(true);
      await expect(gallery.getByRole("heading", { name: "Maps", level: 3 })).toBeVisible();
      await expect(mapsRows(gallery)).toHaveCount(3);
      await expect(mapsRows(gallery).nth(0)).toHaveAccessibleName(/^Cleaning history See recent cleans and how they ended\./);
      await expect(mapsRows(gallery).nth(1)).toHaveAccessibleName(/^Map history Browse earlier floor maps\./);
      await expect(mapsRows(gallery).nth(2)).toHaveAccessibleName(/^Map diagnostics Check the map and copy details for support\./);
      await expect(panelOf(gallery).locator(".action-bar")).toHaveCount(0);
      await expect(gallery.getByRole("heading", { name: "Map tools" })).toHaveCount(0);
      await expect(panelOf(gallery).getByRole("group", { name: "Map display" })).toHaveCount(0);
      await expect(panelOf(gallery).locator("h3")).toHaveText(["Shortcuts", "More ways to clean", "Maps"]);
    });
  }

  test("ready without named rooms demotes the rooms card alone (H2)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans.value;
      element.replaceWorkspaceState({
        ...state,
        resources: { ...state.resources, plans: { ...state.resources.plans, value: { ...plans, rooms: [], plans: [], selectedPlan: null } } },
      });
    });
    const rooms = cards(gallery).nth(0);
    await expect(rooms).toHaveAttribute("aria-disabled", "true");
    await expect(rooms).toHaveAccessibleName(/^Clean rooms Can't clean rooms until you name them in the Matic app\./);
    // No plans, so no shortcut: the custom-area card and the Your plans row stay live.
    await expect(cards(gallery)).toHaveCount(2);
    await expect(cards(gallery).nth(1)).not.toHaveAttribute("aria-disabled", "true");
    await expect(plansRow(gallery)).not.toHaveAttribute("aria-disabled", "true");
    await expect(panelOf(gallery).locator(".panel-description")).toHaveCount(0);
  });

  test("locating keeps the heading and demotes every card with one shared reason (H3)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "transition" });
    await expect(gallery.getByRole("heading", { name: "Choose what to clean", level: 2 })).toBeVisible();
    await expect(homeReason(gallery)).toHaveText(LOCATING);
    await expect(homeCards(gallery)).toHaveCount(3);
    for (const index of [0, 1, 2]) {
      const card = homeCards(gallery).nth(index);
      await expect(card).toHaveAttribute("aria-disabled", "true");
      await expect(card).toHaveAccessibleDescription(LOCATING);
      await expect(card).not.toContainText(LOCATING);
    }
    await cards(gallery).nth(0).dispatchEvent("click");
    expect((await snapshot(page)).workflow).toBe("none");
    await expect(mapsRows(gallery).nth(0)).not.toHaveAttribute("aria-disabled", "true");
  });

  for (const scenario of ["cleaning", "returning", "recharging", "starting-command", "stopping-command", "task-in-progress"]) {
    test(`${scenario} is busy: title, one line, demoted cards, Maps enabled (H4)`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario });
      await expect(gallery.getByRole("heading", { name: "The robot is busy", level: 2 })).toBeVisible();
      await expect(homeReason(gallery)).toHaveText(BUSY);
      await expect(homeCards(gallery)).toHaveCount(3);
      for (const index of [0, 1, 2]) {
        await expect(homeCards(gallery).nth(index)).toHaveAttribute("aria-disabled", "true");
        await expect(homeCards(gallery).nth(index)).toHaveAccessibleDescription(BUSY);
      }
      await expect(mapsRows(gallery)).toHaveCount(3);
      await expect(mapsRows(gallery).nth(0)).not.toHaveAttribute("aria-disabled", "true");
      if (scenario === "starting-command") {
        await expect(gallery.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
        await expect(gallery.getByRole("button", { name: "Stop cleaning" })).toBeEnabled();
      }
    });
  }

  test("a busy robot puts Stop in the bar on a phone and in the strip on a desk", async ({ page }) => {
    const narrow = await loadGallery(page, { scenario: "cleaning", narrow: true });
    await expect(narrow.locator(".action-bar").getByRole("button", { name: "Stop cleaning" })).toBeVisible();
    const wide = await loadGallery(page, { scenario: "cleaning", viewport: { width: 1024, height: 768 } });
    await expect(wide.locator(".status-strip").getByRole("button", { name: "Stop cleaning" })).toBeVisible();
    await expect(panelOf(wide).locator(".action-bar")).toHaveCount(0);
  });

  test("paused says how to get back to a new clean (H5)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "paused" });
    await expect(gallery.getByRole("heading", { name: "The robot is busy", level: 2 })).toBeVisible();
    await expect(homeReason(gallery)).toHaveText("Resume or stop this clean before starting a new one.");
    await expect(gallery.getByRole("button", { name: "Resume cleaning" })).toBeVisible();
    await expect(planCard(gallery)).toHaveAttribute("aria-disabled", "true");
  });

  test("a robot problem replaces the cards with diagnostics (H7)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "problem" });
    await expect(gallery.getByRole("heading", { name: "The robot needs attention", level: 2 })).toBeVisible();
    await expect(panelOf(gallery).locator(".panel-description")).toHaveText("The robot reported a problem. Check it in the Matic app, then start a new clean.");
    await expect(gallery.getByRole("group", { name: "Cleaning choices" })).toHaveCount(0);
    await expect(panelOf(gallery).locator("h3")).toHaveCount(1);
    await expect(mapsRows(gallery).nth(0)).toHaveAccessibleName(/^Map diagnostics/);
    await expect(mapsRows(gallery).nth(1)).toHaveAccessibleName(/^Cleaning history/);
    await expect(mapsRows(gallery).nth(2)).toHaveAccessibleName(/^Map history/);
    await panelOf(gallery).getByRole("button", { name: "Open map diagnostics" }).click();
    expect((await snapshot(page)).workflow).toBe("support");
  });

  for (const scenario of ["map-unavailable", "unsupported"]) {
    test(`${scenario}: the map reason, Try again, demoted cards and diagnostics first (H8)`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario });
      await expect(gallery.getByRole("heading", { name: "Choose what to clean", level: 2 })).toBeVisible();
      await expect(homeReason(gallery)).toHaveText("Home Assistant can't show the map right now, so cleaning can't start.");
      await expect(homeCards(gallery)).toHaveCount(3);
      await expect(cards(gallery).nth(0)).toHaveAttribute("aria-disabled", "true");
      await expect(mapsRows(gallery).nth(0)).toHaveAccessibleName(/^Map diagnostics/);
      await recordActions(page);
      await panelOf(gallery).getByRole("button", { name: "Try again", exact: true }).click();
      expect(await actions(page)).toEqual([{ id: "recheck-status" }]);
    });
  }

  test("a limited map keeps its line and Try again under the heading", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "map-limited" });
    await expect(gallery.getByRole("heading", { name: "Choose what to clean", level: 2 })).toBeVisible();
    await expect(homeReason(gallery)).toHaveText("Home Assistant can show this map but can't confirm it well enough to start cleaning.");
    await expect(panelOf(gallery).getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await expect(cards(gallery).nth(0)).toHaveAttribute("aria-disabled", "true");
    await expect(cards(gallery).nth(0)).toHaveAccessibleDescription(/can't confirm it well enough/);
  });

  test("robot offline retains disabled cleaning choices and Maps", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "robot-offline" });
    await expect(gallery.getByRole("heading", { name: "Robot offline", level: 2 })).toBeVisible();
    await expect(panelOf(gallery).locator(".panel-description")).toHaveText("Showing the last known map. Cleaning comes back when the robot reconnects.");
    await expect(gallery.getByRole("group", { name: "Cleaning choices" }).getByRole("button")).toHaveCount(3);
    await expect(cards(gallery).nth(0)).toHaveAttribute("aria-disabled", "true");
    await expect(cards(gallery).nth(1)).toHaveAttribute("aria-disabled", "true");
    await expect(plansRow(gallery)).toHaveAttribute("aria-disabled", "true");
    await expect(mapsRows(gallery)).toHaveCount(3);
  });

  for (const kind of ["reconnecting", "offline", "read-only"]) {
    test(`${kind} retains the map and view controls, holds cleaning, then recovers`, async ({ page }) => {
      const gallery = await loadGallery(page);
      await recordActions(page);
      await gallery.evaluate((element, kind) => {
        const state = element.getWorkspaceSnapshot();
        element.__beforeRecovery = state;
        element.replaceWorkspaceState({ ...state,
          host: { ...state.host, connected: kind !== "reconnecting", robotConnected: kind !== "offline" },
          coherence: "verifying",
          floor: { ...state.floor, readOnly: true },
          map: { ...state.map, exactPose: false },
          notice: kind === "read-only" ? { tone: "warning", key: "v4_notice_saved_map", fallback: "Showing the saved map." } : null,
        });
      }, kind);
      const choices = gallery.getByRole("group", { name: "Cleaning choices" }).getByRole("button");
      await expect(choices).toHaveCount(3);
      for (const choice of await choices.all()) {
        await expect(choice).toHaveAttribute("aria-disabled", "true");
        await choice.click({ force: true });
      }
      expect(await actions(page)).toEqual([]);
      expect((await snapshot(page)).workflow).toBe("none");
      const map = gallery.locator("matic-map-canvas-v4");
      await expect(map.locator(".scene-window")).toBeVisible();
      await expect(map.locator(".map-message")).toHaveCount(0);
      await expect(map.getByRole("button", { name: "Fit the whole map on screen" })).toBeVisible();
      await expect(map.getByRole("button", { name: "How to move the map" })).toBeVisible();
      await map.getByRole("button", { name: "2D", exact: true }).click();
      expect((await snapshot(page)).view).toBe("top");
      expect(await actions(page)).toEqual([]);
      await gallery.evaluate(element => element.replaceWorkspaceState(element.__beforeRecovery));
      for (const choice of await choices.all()) await expect(choice).not.toHaveAttribute("aria-disabled", "true");
      await expect(gallery.getByRole("heading", { name: "Choose what to clean", level: 2 })).toBeVisible();
    });
  }

  test("reconnecting without a retained map keeps the cold-start explanation", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ha-offline" });
    const state = await snapshot(page);
    await patchState(gallery, { map: { ...state.map, available: false } });
    await expect(gallery.getByRole("heading", { name: "Reconnecting to Home Assistant", level: 2 })).toBeVisible();
    await expect(panelOf(gallery).locator(".panel-description")).toHaveText("Waiting for Home Assistant to reconnect.");
    await expect(gallery.getByRole("group", { name: "Cleaning choices" })).toHaveCount(0);
    await expect(mapsRows(gallery)).toHaveCount(0);
    await expect(gallery.locator(".map-message")).toHaveText("Reconnecting");
  });

  for (const [scenario, title, body] of [
    ["access", "Administrator access required", "Ask a Home Assistant administrator to open this map."],
    ["empty", "No robot available", "Check the Matic (Unofficial) integration, or add it if you haven't set up a robot."],
  ]) {
    test(`${scenario} states the problem once, with no cards and no Maps (H10, H11)`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario });
      await expect(gallery.getByRole("heading", { name: title, level: 2 })).toBeVisible();
      await expect(panelOf(gallery).locator(".panel-description")).toHaveText(body);
      await expect(panelOf(gallery).locator("h3")).toHaveCount(0);
      await expect(gallery.getByRole("group", { name: "Cleaning choices" })).toHaveCount(0);
      await expect(mapsRows(gallery)).toHaveCount(0);
      await expect(panelOf(gallery).locator(".host-state")).toHaveCount(0);
    });
  }

  test("an unavailable robot selection states it once (H11)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "multi-robot" });
    await patchState(gallery, { robots: [{ entryId: "synthetic-entry-two", label: "Second robot" }] });
    await expect(gallery.getByRole("heading", { name: "Selected robot unavailable", level: 2 })).toBeVisible();
    await expect(panelOf(gallery).locator(".panel-description")).toHaveText("Choose another robot to open its map.");
    await expect(panelOf(gallery).locator("h3")).toHaveCount(0);
    await expect(gallery.getByRole("group", { name: "Cleaning choices" })).toHaveCount(0);
  });

  test("a saved map keeps Maps and no cards (read-only)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history" });
    await patchState(gallery, { workflow: "none" });
    await expect(gallery.getByRole("heading", { name: "Saved map is read only", level: 2 })).toBeVisible();
    await expect(gallery.getByRole("group", { name: "Cleaning choices" })).toHaveCount(0);
    await expect(mapsRows(gallery)).toHaveCount(3);
  });

  test("a live read-only map keeps Smart Stop understandable and reachable", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, dataMode: "live", activity: "cleaning",
        floor: { ...state.floor, readOnly: true },
        smartStop: { runId: "run-123", target: "Master Bedroom", kind: "room", phase: "finishing_room" } });
    });
    await expect(gallery.getByRole("heading", { name: "Map is read only", level: 2 })).toBeVisible();
    await expect(panelOf(gallery).locator(".panel-description")).toHaveCount(0);
    await expect(gallery.locator('[data-launcher="rooms"]')).toHaveAccessibleDescription("Cleaning is unavailable while the map is read only.");
    await expect(gallery.getByText("Finishing Master Bedroom, then returning to the dock.", { exact: true })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Stop now & dock", exact: true })).toBeEnabled();
    await expect(gallery.getByText("Saved map is read only", { exact: true })).toHaveCount(0);
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, activity: "paused" });
    });
    await expect(panelOf(gallery).locator(".panel-description")).toHaveCount(0);
    await expect(gallery.getByText("Resume to finish this clean, or stop now and dock.", { exact: true })).toBeVisible();
  });

  // MS-HOME-01 / MS-STATUS-02: a notice is visible on home, under the heading,
  // in every layout; at peek it toasts.
  for (const scenario of ["ready", "cleaning"]) {
    test(`${scenario}: a notice shows under the home heading at 390 and 1024`, async ({ page }) => {
      const notice = { tone: "error", key: "v4_notice_stop_unconfirmed", fallback: "Home Assistant couldn't confirm the stop." };
      for (const narrow of [false, true]) {
        const gallery = await loadGallery(page, { scenario, narrow });
        await page.evaluate(({ tag, detail }) => {
          const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
          shell.dispatchEvent(new CustomEvent("matic-workspace-intent", { detail, bubbles: true, composed: true }));
        }, { tag: GALLERY_TAG, detail: { type: "set-notice", notice } });
        const slot = gallery.locator("[data-notice-slot]");
        await expect(slot).toBeVisible();
        await expect(slot).toContainText(notice.fallback);
        await expect(slot).not.toHaveAttribute("role", /.+/);
        await expect(slot).not.toHaveAttribute("aria-live", /.+/);
        const heading = gallery.locator(".panel-heading");
        await expect(slot).toHaveJSProperty("previousElementSibling.className", await heading.evaluate((element) => element.className));
        if (narrow) {
          await panelOf(gallery).getByRole("button", { name: "Collapse panel", exact: true }).click();
          await expect(panelOf(gallery)).toHaveAttribute("data-detent", "peek");
          await page.evaluate(({ tag, detail }) => {
            const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
            shell.dispatchEvent(new CustomEvent("matic-workspace-intent", { detail, bubbles: true, composed: true }));
          }, { tag: GALLERY_TAG, detail: { type: "set-notice", notice: { ...notice, fallback: "Again at peek" } } });
          const toast = gallery.getByRole("region", { name: "Notifications" });
          await expect(toast).toBeVisible();
          await expect(toast).toContainText("Again at peek");
        }
      }
    });
  }

  test("forced colors draw a demoted card in GrayText and the featured card with a border", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    const gallery = await loadGallery(page, { scenario: "transition" });
    const probe = await page.evaluate(() => {
      const element = document.createElement("span");
      element.style.color = "GrayText";
      document.body.append(element);
      return getComputedStyle(element).color;
    });
    await expect(cards(gallery).nth(0)).toHaveAttribute("aria-disabled", "true");
    const title = cards(gallery).nth(0).locator("strong");
    expect(await title.evaluate((element) => getComputedStyle(element).color)).toBe(probe);
    const border = await cards(gallery).nth(0).evaluate((element) => getComputedStyle(element).borderTopStyle);
    expect(border).not.toBe("none");
  });
});

// ---- The plan card (home-rooms.md §5 Cards D1; plan.md §5 Navigation) -------

// The deepest focused element, through shadow roots, as name-ish text.
const focusedText = (page) => page.evaluate(() => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active ? `${active.tagName.toLowerCase()} ${active.getAttribute("aria-label") ?? active.textContent.replace(/\s+/g, " ").trim()}` : null;
});

const planCard = (gallery) => shortcutsGroup(gallery).locator("button.shortcut").first();

test.describe("the plan card", () => {
  test("names the default plan with the picker's lines", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await expect(planCard(gallery)).toHaveAccessibleName(/^Run Daily clean 3 rooms · Smart Order$/);
    await expect(planCard(gallery).locator("strong bdi")).toHaveText("Daily clean");
    await expect(planCard(gallery).locator(".line")).toHaveCount(0);
  });

  // UX9 owner ruling: every due line shows in full (no clamp).
  test("shows due work below, every line in full, all of it in the name", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "home-plan-due" });
    const lines = planCard(gallery).locator(".line");
    await expect(lines).toHaveText(["Mop due in Kitchen and Living room", "Heavy duty vacuum due in Living room"]);
    await expect(lines.first().locator("svg")).toHaveCount(1);
    expect(await planCard(gallery).locator(".card-lines").evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe("none");
    await expect(planCard(gallery)).toHaveAccessibleName(/Mop due in Kitchen and Living room Heavy duty vacuum due in Living room$/);
  });

  // A shortcut that can't run gives Run plan's own reason (UX9).
  test("shows a blocked plan's one line with the warning glyph", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "home-plan-blocked" });
    const line = planCard(gallery).locator(".line");
    await expect(line).toHaveText([/^Can't run this plan until/]);
    await expect(line).toHaveAttribute("data-tone", "warning");
    await expect(line.locator("svg")).toHaveCount(1);
    await expect(planCard(gallery)).toHaveAttribute("aria-disabled", "true");
  });

  test("shows a paused plan's chip, no due work and why it can't run", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "home-plan-paused" });
    await expect(planCard(gallery).locator(".ms-chip")).toHaveText("Paused");
    await expect(planCard(gallery).locator(".line")).toHaveText(["Can't run this plan until you turn it on."]);
    await expect(planCard(gallery)).toHaveAccessibleName(/^Run Daily clean Paused 3 rooms/);
  });

  test("a shortcut held on Run comes back to the shortcut by Back and by Escape", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await planCard(gallery).click();
    expect(await snapshot(page)).toMatchObject({ workflow: "plan", planView: "run", planOrigin: "home" });
    await gallery.getByRole("button", { name: "Back to all tasks" }).click();
    expect((await snapshot(page)).workflow).toBe("none");
    await expect.poll(() => focusedText(page)).toMatch(/^button Run Daily clean/);

    await page.keyboard.press("Enter");
    expect(await snapshot(page)).toMatchObject({ workflow: "plan", planView: "run", planOrigin: "home" });
    await page.keyboard.press("Escape");
    expect((await snapshot(page)).workflow).toBe("none");
    await expect.poll(() => focusedText(page)).toMatch(/^button Run Daily clean/);
  });

  // The installed panel routes a shortcut's select-plan and Run plan through
  // EffectController (Codex, #254): the run goes out once, and a rejection
  // lands back on home with its notice and the shortcut focused.
  test("the installed panel runs a shortcut once and a rejection returns home to it with its notice", async ({ page }) => {
    const rooms = ["kitchen", "hall"].map((id, index) => ({
      room_id: id, name: id === "kitchen" ? "Kitchen" : "Hall",
      boundary: [[index * 6, 0], [index * 6 + 6, 0], [index * 6 + 6, 5], [index * 6, 5]],
    }));
    const planRooms = rooms.map((room) => ({ room_id: room.room_id, cleaning_mode: "vacuum", coverage_setting: "standard" }));
    const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: {
      rooms, selected_plan: "daily",
      plans: [{
        id: "daily", name: "Daily", enabled: true, run_behavior: "ordered", rooms: planRooms,
        room_order: planRooms.map((room) => room.room_id), return_to_base: true,
        finish_current_room: false, finish_current_room_threshold: 50,
        next_run_preview: {
          preview_token: "e".repeat(64),
          rooms: rooms.map((room) => ({ room_id: room.room_id, name: room.name, cleaning_mode: "vacuum", coverage_setting: "standard", cadence_reasons: [] })),
          mission_boundaries: [],
          blocker: null,
        },
      }],
    }, userData: { "matic_robot_home_shortcuts.synthetic-entry": { pins: [{ kind: "plan", id: "daily" }] } } });
    const panel = page.locator(fixture.panelTag);
    const state = () => page.evaluate((tag) => {
      const { workflow, planView, planOrigin } = document.querySelector(tag).getWorkspaceSnapshot();
      return { workflow, planView, planOrigin };
    }, fixture.panelTag);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const run = panel.locator("button.shortcut");
    await expect(run).toHaveAccessibleName(/^Run Daily/);
    await expect(run).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
    await page.evaluate(() => window.__panelFixture.failNextService("run_selected_plan", {
      translation_domain: "matic_robot",
      translation_key: "coverage_native_session_active",
    }));
    await run.click();
    await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.map((call) => call.service))).toEqual(["run_selected_plan"]);
    await expect.poll(state).toMatchObject({ workflow: "none" });
    await expect.poll(() => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot().notice?.key, fixture.panelTag)).toBe("v4_notice_coverage_robot_busy");
    await expect.poll(() => focusedText(page)).toMatch(/^button Run Daily/);
  });

  // UX9: a catalog being reread or that failed keeps its last list, so the
  // shortcut stays, gated as its Run view is; the picker reports the status.
  for (const status of ["loading", "error"]) {
    test(`a retained catalog while ${status} keeps the shortcut and the Your plans row`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready" });
      await gallery.evaluate((element, next) => {
        const state = element.getWorkspaceSnapshot();
        element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans, status: next, problem: next === "error" ? "plans-unavailable" : null } } });
      }, status);
      await expect(planCard(gallery)).toHaveAccessibleName(/^Run Daily clean/);
      await expect(plansRow(gallery)).toHaveCount(1);
      await expect(cards(gallery).nth(0)).not.toHaveAttribute("aria-disabled", "true");
    });
  }

  for (const narrow of [true, false]) {
    test(`a Your plans row, last on home, opens the picker and takes focus back (UX9, narrow: ${narrow})${narrow ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready", narrow });
      const row = plansRow(gallery);
      await expect(row).toBeVisible();
      await expect(row).toHaveAccessibleName("Your plans");
      await expect(row).not.toHaveClass(/ms-row--card/);
      // After the custom-area card, last in the group.
      expect(await row.evaluate((element) => element.nextElementSibling)).toBe(null);
      expect(await cards(gallery).nth(1).evaluate((card) => card.nextElementSibling?.textContent.replace(/\s+/g, " ").trim())).toBe("Your plans");
      await expect(cards(gallery)).toHaveCount(2);
      await row.click();
      expect((await snapshot(page)).workflow).toBe("plans");
      await expect(gallery.getByRole("heading", { level: 2, name: "Your plans" })).toBeFocused();
      // A plan opened from the picker still returns to the picker, and the picker to home.
      await gallery.getByRole("button", { name: /^Daily clean/ }).click();
      expect((await snapshot(page)).planOrigin).toBe("plans");
      await gallery.getByRole("button", { name: "Back to plans" }).click();
      await expect(gallery.getByRole("heading", { level: 2, name: "Your plans" })).toBeVisible();
      await gallery.getByRole("button", { name: "Back to all tasks" }).click();
      expect((await snapshot(page)).workflow).toBe("none");
      await expect.poll(() => focusedText(page)).toBe("button Your plans");
      await page.keyboard.press("Enter");
      await expect(gallery.getByRole("heading", { level: 2, name: "Your plans" })).toBeFocused();
      await page.keyboard.press("Escape");
      expect((await snapshot(page)).workflow).toBe("none");
      await expect.poll(() => focusedText(page)).toBe("button Your plans");
    });
  }

  test("the Your plans row is held with the cards and stays when nothing is pinned", async ({ page }) => {
    const busy = await loadGallery(page, { scenario: "cleaning" });
    await expect(plansRow(busy)).toHaveAttribute("aria-disabled", "true");
    await expect(plansRow(busy)).toHaveAccessibleDescription(BUSY);
    await plansRow(busy).dispatchEvent("click");
    expect((await snapshot(page)).workflow).toBe("none");
    const picker = await loadGallery(page, { scenario: "ready" });
    await picker.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, homePins: { status: "ready", pins: [] } });
    });
    await expect(cards(picker)).toHaveCount(2);
    await expect(plansRow(picker)).toHaveCount(1);
  });

  test("the picker still returns to its row (plan.md §5)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "plans" });
    await openPlanPicker(gallery);
    await expect(gallery.getByRole("heading", { level: 2, name: "Your plans" })).toBeVisible();
    await gallery.getByRole("button", { name: /^Daily clean/ }).click();
    expect((await snapshot(page)).planOrigin).toBe("plans");
    await gallery.getByRole("button", { name: "Back to plans" }).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Your plans" })).toBeVisible();
    await expect.poll(() => focusedText(page)).toMatch(/^button Daily clean/);
  });

  // A pinned plan that is gone or on another floor shows no shortcut (UX9).
  test("a pinned plan that is missing shows nothing, and Your plans still opens the picker", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, homePins: { status: "ready", pins: [{ kind: "plan", id: "gone" }] } });
    });
    await expect(cards(gallery)).toHaveCount(2);
    await plansRow(gallery).click();
    expect((await snapshot(page)).workflow).toBe("plans");
    await gallery.getByRole("button", { name: "Back to all tasks" }).click();
    await expect.poll(() => focusedText(page)).toBe("button Your plans");
  });

  // The host moves a Run whose plan was deleted to the picker itself
  // (effects.ts, catalog-writes.ts); this pins the shell's own Back when the
  // plan is already gone.
  test("Escape from a Run whose plan is gone returns home with focus on the card or heading", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await planCard(gallery).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Daily clean" })).toBeVisible();
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans;
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...plans, value: { ...plans.value, plans: [], selectedPlan: null } } } });
    });
    await page.keyboard.press("Escape");
    expect((await snapshot(page)).workflow).toBe("none");
    // The shortcut is gone with its plan, so the heading takes focus.
    await expect.poll(() => focusedText(page)).toBe("h2 Choose what to clean");
  });

  test("a long shortcut name wraps in full without widening its card", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    const short = await planCard(gallery).boundingBox();
    const name = "A very long plan name that goes on and on past the width of the card";
    await gallery.evaluate((element, longName) => {
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans;
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...plans, value: { ...plans.value, plans: plans.value.plans.map((plan) => ({ ...plan, name: longName })) } } } });
    }, name);
    await expect(planCard(gallery)).toHaveAccessibleName(new RegExp(`^Run ${name} 3 rooms`));
    await expect(planCard(gallery).locator("strong bdi")).toHaveText(name);
    const title = planCard(gallery).locator(".card-name");
    const widths = await title.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(widths.scroll, JSON.stringify(widths)).toBeLessThanOrEqual(widths.client + 1);
    // The card itself stays inside the sheet.
    const sheet = await panelOf(gallery).boundingBox();
    const card = await planCard(gallery).boundingBox();
    expect(card.x + card.width).toBeLessThanOrEqual(sheet.x + sheet.width);
    expect((await planCard(gallery).boundingBox()).height).toBeGreaterThan(short.height);
  });

  test("every home launcher takes focus back when its workflow closes (MS-KEY-01)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    const back = async () => {
      await gallery.getByRole("button", { name: /^Back to all tasks$/ }).first().click();
      expect((await snapshot(page)).workflow).toBe("none");
    };
    await cards(gallery).nth(0).focus();
    await page.keyboard.press("Enter");
    await expect(gallery.getByRole("heading", { level: 2, name: "Choose rooms" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => focusedText(page)).toMatch(/^button Clean rooms/);

    await cards(gallery).nth(1).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Your areas" })).toBeVisible();
    await back();
    await expect.poll(() => focusedText(page)).toMatch(/^button Clean custom area/);

    await mapsRows(gallery).nth(0).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Cleaning history" })).toBeVisible();
    await back();
    await expect.poll(() => focusedText(page)).toMatch(/^button Cleaning history/);

    await mapsRows(gallery).nth(1).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Map history" })).toBeVisible();
    await back();
    await expect.poll(() => focusedText(page)).toMatch(/^button Map history/);

    await mapsRows(gallery).nth(2).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Map diagnostics" })).toBeVisible();
    await back();
    await expect.poll(() => focusedText(page)).toMatch(/^button Map diagnostics/);

    await gallery.getByRole("button", { name: "Map options" }).click();
    await gallery.getByRole("menu", { name: "Map options" }).getByRole("menuitem", { name: "Map diagnostics" }).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Map diagnostics" })).toBeVisible();
    await back();
    await expect.poll(() => focusedText(page)).toMatch(/^h2 Choose what to clean/);

    // R18: a workflow opened another way after a card press drops the card.
    await cards(gallery).nth(0).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Choose rooms" })).toBeVisible();
    await gallery.getByRole("button", { name: "Map options" }).click();
    await gallery.getByRole("menu", { name: "Map options" }).getByRole("menuitem", { name: "Map diagnostics" }).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Map diagnostics" })).toBeVisible();
    await back();
    await expect.poll(() => focusedText(page)).toMatch(/^h2 Choose what to clean/);
  });

  test("the diagnostics button of a robot problem takes focus back", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "problem" });
    await panelOf(gallery).getByRole("button", { name: "Open map diagnostics" }).click();
    await gallery.getByRole("button", { name: /^Back to all tasks$/ }).first().click();
    await expect.poll(() => focusedText(page)).toMatch(/^button Open map diagnostics/);
  });

  // UX9 owner ruling: due lines show in full, so on a phone the half sheet
  // shows Clean rooms and the plan shortcut whole and the custom-area card's
  // top edge; the Your plans row is reached by a small scroll (accepted).
  // Shortcuts come first (owner, 2026-10-14): the pinned shortcut fits the
  // half sheet whole and Clean rooms starts inside it.
  test("the shortcut and Clean rooms fit the half sheet at 390, and Your plans scrolls into reach; at 320 too @mobile", async ({ page }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }]) {
      const gallery = await loadGallery(page, { scenario: "home-plan-due", viewport });
      const body = panelOf(gallery).locator(".sheet-body");
      const box = await body.boundingBox();
      const shortcut = await planCard(gallery).boundingBox();
      expect(shortcut.y).toBeGreaterThanOrEqual(box.y);
      expect(shortcut.y + shortcut.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
      const rooms = await cards(gallery).nth(0).boundingBox();
      expect(rooms.y).toBeGreaterThanOrEqual(box.y);
      expect(rooms.y).toBeLessThan(box.y + box.height);
      await plansRow(gallery).scrollIntoViewIfNeeded();
      const row = await plansRow(gallery).boundingBox();
      const after = await body.boundingBox();
      expect(row.y).toBeGreaterThanOrEqual(after.y);
      expect(row.y + row.height).toBeLessThanOrEqual(after.y + after.height + 0.5);
    }
  });
});

// Map options is an ARIA menu (design-system.md §5 Menus, MS-KEY-02) that
// holds the phone's Map display rows (home-rooms.md §5 Display); help lives
// in the map rail on every width (MS-HOME-04).
const optionsButton = (gallery) => gallery.getByRole("button", { name: "Map options", exact: true });
const optionsMenu = (gallery) => gallery.getByRole("menu", { name: "Map options" });
const openOptions = async (gallery) => {
  await optionsButton(gallery).click();
  await expect(optionsMenu(gallery)).toBeVisible();
  return optionsMenu(gallery);
};
const rowNames = (menu) => menu.locator("[role^=menuitem]").evaluateAll((rows) => rows.map((row) => row.textContent.replace(/\s+/g, " ").trim()));

test.describe("Map options and the rail (home-rooms.md §5 Display, §11 MS-HOME-04, MS-RESP-05)", () => {
  test("opens as a menu named Map options with its first row focused @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    const button = optionsButton(gallery);
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveAttribute("aria-controls", "map-options");
    const menu = await openOptions(gallery);
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toHaveId("map-options");
    await expect.poll(() => focusedText(page)).toBe("button Photo");
    expect(await rowNames(menu)).toEqual([
      "Photo", "Room colors", "Room names", "Auto detail", "Efficient", "Balanced", "Maximum", "Robot trail", "Map zoom", "Map diagnostics",
    ]);
    await expect(menu.getByRole("group", { name: "Map display" })).toBeVisible();
    await expect(menu.getByRole("group", { name: "Map detail" })).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: "Photo" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemradio", { name: "Auto detail" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Room names" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Room names" }).locator(".ms-switch")).toHaveCount(1);
    for (const tabindex of await menu.locator("[role^=menuitem]").evaluateAll((rows) => rows.map((row) => row.getAttribute("tabindex")))) {
      expect(tabindex).toBe("-1");
    }
  });

  test("Up, Down, Home and End move over every row, wrapping", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await openOptions(gallery);
    const names = [];
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press("ArrowDown");
      names.push((await focusedText(page)).replace(/^button /, ""));
    }
    expect(names).toEqual(["Room colors", "Room names", "Auto detail", "Efficient", "Balanced", "Maximum", "Robot trail", "Map zoom", "Map diagnostics", "Photo"]);
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => focusedText(page)).toBe("button Map diagnostics");
    await page.keyboard.press("Home");
    await expect.poll(() => focusedText(page)).toBe("button Photo");
    await page.keyboard.press("End");
    await expect.poll(() => focusedText(page)).toBe("button Map diagnostics");
  });

  test("display and detail rows change the map and keep the menu open; action rows close it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    const menu = await openOptions(gallery);
    await menu.getByRole("menuitemradio", { name: "Room colors" }).click();
    await expect.poll(async () => (await snapshot(page)).appearance).toBe("rooms");
    await expect(menu.getByRole("menuitemradio", { name: "Room colors" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemradio", { name: "Photo" })).toHaveAttribute("aria-checked", "false");
    await expect(menu).toBeVisible();
    // The chosen row shows it: the selected tint and a check glyph (walkthrough finding 1).
    await expect(menu.getByRole("menuitemradio", { name: "Room colors" })).toHaveAttribute("data-selected", "true");
    await expect(menu.getByRole("menuitemradio", { name: "Room colors" }).locator("svg")).toHaveCount(1);
    await expect(menu.getByRole("menuitemradio", { name: "Photo" })).not.toHaveAttribute("data-selected", "true");
    await expect(menu.getByRole("menuitemradio", { name: "Photo" }).locator("svg")).toHaveCount(0);

    await menu.getByRole("menuitemcheckbox", { name: "Room names" }).click();
    await expect.poll(async () => (await snapshot(page)).labelsVisible).toBe(false);
    await expect(menu.getByRole("menuitemcheckbox", { name: "Room names" })).toHaveAttribute("aria-checked", "false");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Room names" }).locator(".ms-switch")).toHaveAttribute("aria-checked", "false");
    await expect(menu).toBeVisible();

    await menu.getByRole("menuitemradio", { name: "Maximum" }).click();
    await expect.poll(async () => (await snapshot(page)).quality).toBe("maximum");
    await expect(menu.getByRole("menuitemradio", { name: "Maximum" })).toHaveAttribute("aria-checked", "true");
    await expect(menu).toBeVisible();

    await menu.getByRole("menuitem", { name: "Map diagnostics" }).click();
    await expect(menu).toHaveCount(0);
    await expect(gallery.getByRole("heading", { level: 2, name: "Map diagnostics" })).toBeVisible();
  });

  test("Escape closes the menu and returns focus to its button", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    const menu = await openOptions(gallery);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(optionsButton(gallery)).toBeFocused();
    await expect(optionsButton(gallery)).toHaveAttribute("aria-expanded", "false");
    expect((await snapshot(page)).workflow).toBe("none");
  });

  test("3D drops the Photo and Room colors rows; a desk keeps them in the rail and has no Map display group", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await patchState(gallery, { view: "three" });
    const menu = await openOptions(gallery);
    expect(await rowNames(menu)).toEqual(["Room names", "Auto detail", "Efficient", "Balanced", "Maximum", "Robot trail", "Map zoom", "Map diagnostics"]);
    await page.keyboard.press("Escape");

    const wide = await loadGallery(page, { scenario: "ready", viewport: { width: 1180, height: 760 } });
    const wideMenu = await openOptions(wide);
    expect(await rowNames(wideMenu)).toEqual(["Auto detail", "Efficient", "Balanced", "Maximum", "Robot trail", "Map zoom", "Map diagnostics"]);
    await expect(wideMenu.getByRole("group", { name: "Map display" })).toHaveCount(0);
    await expect.poll(() => focusedText(page)).toBe("button Auto detail");
    await page.keyboard.press("Escape");
    const style = wide.getByRole("group", { name: "Map style" });
    await expect(style.getByRole("button")).toHaveText(["Photo", "Room colors"]);
    await expect(wide.getByRole("button", { name: "Room names", exact: true })).toBeVisible();
  });

  test("a phone keeps help in the rail with a Touch row first and no help button on home @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    const help = gallery.locator("matic-map-canvas-v4").getByRole("button", { name: "How to move the map" });
    await expect(help).toBeVisible();
    await expect(panelOf(gallery).getByRole("button", { name: "How to move the map" })).toHaveCount(0);
    await expect(panelOf(gallery).getByRole("group", { name: "Map display" })).toHaveCount(0);
    await expect(panelOf(gallery).locator("h3")).toHaveText(["Shortcuts", "More ways to clean", "Maps"]);
    await expect(gallery.locator("matic-map-canvas-v4").getByRole("button", { name: "Room names" })).toHaveCount(0);
    await help.click();
    const popover = gallery.getByRole("dialog", { name: "How to move the map" });
    // A coarse pointer reads the Touch row alone (map-surfaces.md §5 Help).
    await expect(popover.locator("dt")).toHaveText(["Touch"]);
    await expect(popover).toContainText("Drag to move the map · pinch to zoom · twist two fingers to rotate");
    await expect(popover.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(help).toBeFocused();
  });

  test("the rail shows no floor, Fit or help without a scene (MS-HOME-04)", async ({ page }) => {
    for (const scenario of ["empty", "access"]) {
      const gallery = await loadGallery(page, { scenario });
      await expect(gallery.getByRole("combobox", { name: "Choose floor" })).toHaveCount(0);
      await expect(gallery.getByRole("button", { name: "Fit the whole map on screen" })).toHaveCount(0);
      await expect(gallery.getByRole("button", { name: "How to move the map" })).toHaveCount(0);
    }
    const locating = await loadGallery(page, { scenario: "transition" });
    await expect(locating.getByRole("button", { name: "Fit the whole map on screen" })).toHaveCount(0);
    await expect(locating.getByRole("button", { name: "How to move the map" })).toHaveCount(0);
  });

  test("Escape closes the menu first and leaves Rooms second (shell.md §5)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await cards(gallery).nth(0).click();
    await expect(gallery.getByRole("heading", { level: 2, name: "Choose rooms" })).toBeVisible();
    const menu = await openOptions(gallery);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(optionsButton(gallery)).toBeFocused();
    expect((await snapshot(page)).workflow).toBe("rooms");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("none");
  });

  test("the multi-robot header at 320 keeps a 44 px robot select and an unclipped title (R24)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "multi-robot", viewport: { width: 320, height: 844 } });
    const robot = gallery.getByRole("combobox", { name: "Choose robot" });
    await expect(robot).toBeVisible();
    expect((await robot.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const title = gallery.getByRole("heading", { level: 1, name: "Matic Map" });
    expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bar = gallery.locator(".app-bar");
    expect(await bar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(robot).toHaveCSS("text-overflow", "ellipsis");
  });
});

// The Rooms view (home-rooms.md §3 Rooms, §4 R1-R10, §5 Settings, Due work,
// Clean, Selection gate and Keyboard; R5, R20-R22, R25, R28).
const roomsGroup = (gallery) => gallery.getByRole("group", { name: "Rooms to clean" });
const roomBox = (gallery, name) => roomsGroup(gallery).getByRole("checkbox", { name: new RegExp(`^${name}( |$)`) });
const primary = (gallery) => panelOf(gallery).getByRole("button", { name: /^Clean( \d+)? rooms?$/ });
const primaryReason = (gallery) => gallery.locator("#primary-reason");
const settingsRow = (gallery) => gallery.getByRole("button", { name: /^Cleaning settings/ });
const checkLines = (gallery) => gallery.locator(".check-lines .line");
const description = (gallery) => gallery.locator("#rooms-description");
const listHeader = (gallery) => gallery.locator(".list-header");
// Playwright refuses selectOption on an aria-disabled select, so a held
// select is changed the way a browser would report it.
const forceSelect = (select, value) => select.evaluate((element, next) => {
  element.value = next;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}, value);
const plansResource = (gallery, patch) => gallery.evaluate((element, applied) => {
  const state = element.getWorkspaceSnapshot();
  element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans, ...applied } } });
}, patch);
const roomPreview = (gallery, patch) => gallery.evaluate((element, applied) => {
  const state = element.getWorkspaceSnapshot();
  element.replaceWorkspaceState({ ...state, manualRoomPreview: { ...state.manualRoomPreview, ...applied } });
}, patch);

for (const narrow of [true, false]) {
  test.describe(`the Rooms view (narrow: ${narrow})`, () => {
    test(`starts with no selection: header, collapsed settings, plain rows and a disabled Clean (R1)${narrow ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms", narrow });
      await expect(description(gallery)).toHaveText("Choose rooms on the map or in the list.");
      await expect(gallery.getByRole("heading", { level: 3, name: "Rooms to clean" })).toBeVisible();
      await expect(listHeader(gallery).getByText(/\d+ selected/)).toHaveCount(0);
      await expect(listHeader(gallery).getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
      await expect(settingsRow(gallery)).toHaveAccessibleName("Cleaning settings Vacuum · Optimal");
      await expect(settingsRow(gallery)).toHaveAttribute("aria-expanded", "false");
      const boxes = roomsGroup(gallery).getByRole("checkbox");
      await expect(boxes).toHaveCount(4);
      for (const [index, name] of ["Kitchen", "Living room", "Office", "Bedroom"].entries()) {
        await expect(boxes.nth(index)).toHaveAccessibleName(name);
      }
      await expect(gallery.getByRole("button", { name: /^Settings for / })).toHaveCount(0);
      await expect(primary(gallery)).toHaveAttribute("aria-disabled", "true");
      await expect(primaryReason(gallery)).toHaveText("Can't start until you choose a named room.");
      for (const text of ["Ready", "Select rooms here", "Override shared schedule settings", "Effective cleaning preview"]) {
        await expect(panelOf(gallery).getByText(text)).toHaveCount(0);
      }
      await expect(checkLines(gallery)).toHaveCount(0);
    });

    test(`a tap on the name selects the room: the label is the 44 px target${narrow ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms", narrow });
      const label = roomsGroup(gallery).locator("label.ms-check").first();
      expect((await label.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await roomsGroup(gallery).getByText("Kitchen", { exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).selection.roomIds).toEqual(["room-a"]);
      await expect(roomBox(gallery, "Kitchen")).toBeChecked();
      await expect(listHeader(gallery).getByText("1 selected", { exact: true })).toBeVisible();
      await expect(listHeader(gallery).getByRole("button", { name: "Clear", exact: true })).toBeVisible();
    });

    test("shows Checking settings… on a selected row while the check runs (R2)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow });
      await roomPreview(gallery, { status: "loading", value: null });
      await expect(roomBox(gallery, "Kitchen")).toHaveAccessibleName("Kitchen Checking settings…");
      await expect(primary(gallery)).toHaveAttribute("aria-disabled", "true");
      await expect(primaryReason(gallery)).toHaveText("Waiting for the room settings check.");
    });

    test("shows each room's effective setting and the check lines above the rows (R3)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow });
      await expect(roomBox(gallery, "Kitchen")).toHaveAccessibleName("Kitchen Vacuum + mop · Optimal");
      await expect(roomBox(gallery, "Living room")).toHaveAccessibleName("Living room Vacuum · Heavy duty");
      await expect(roomBox(gallery, "Office")).toHaveAccessibleName("Office Vacuum · Optimal");
      await expect(checkLines(gallery)).toHaveText([
        "Mop due in Kitchen",
        "Heavy duty vacuum due in Living room",
        "The robot cleans in 2 parts and may stop at the dock between parts.",
      ]);
      const lines = await checkLines(gallery).first().boundingBox();
      const rows = await roomsGroup(gallery).boundingBox();
      expect(lines.y).toBeLessThan(rows.y);
      await expect(listHeader(gallery).getByText("4 selected", { exact: true })).toBeVisible();
      await expect(listHeader(gallery).getByRole("button", { name: "Clear", exact: true })).toBeVisible();
      await expect(settingsRow(gallery)).toHaveAccessibleName("Cleaning settings Vacuum · Optimal");
      await expect(primary(gallery)).toHaveText("Clean 4 rooms");
      await expect(primary(gallery)).not.toHaveAttribute("aria-disabled", "true");
    });

    test("the settings row opens the whole-clean selects and the due switch", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow });
      await settingsRow(gallery).click();
      await expect(settingsRow(gallery)).toHaveAttribute("aria-expanded", "true");
      await expect(settingsRow(gallery)).toHaveAttribute("aria-controls", "clean-settings");
      const body = gallery.locator("#clean-settings");
      await expect(body.getByRole("combobox", { name: "Cleaning mode" })).toHaveValue("vacuum");
      await expect(body.getByRole("combobox", { name: "Vacuum coverage" })).toHaveValue("standard");
      const due = body.getByRole("switch", { name: "Use room schedules" });
      await expect(due).toHaveAttribute("aria-checked", "true");
      await expect(due).toHaveAccessibleDescription("");
      await due.click();
      await expect.poll(async () => (await snapshot(page)).selection.useRoomSchedule).toBe(false);
      await expect(due).toHaveAttribute("aria-checked", "false");
      await expect(due).toBeVisible();

      const plain = await loadGallery(page, { scenario: "rooms", narrow });
      await settingsRow(plain).click();
      await expect(plain.locator("#clean-settings").getByRole("combobox")).toHaveCount(2);
      await expect(plain.getByRole("switch")).toHaveCount(0);
    });

    test("a whole-clean change rewrites every room; a per-room change makes the value mixed", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow });
      await settingsRow(gallery).click();
      await gallery.locator("#clean-settings").getByRole("combobox", { name: "Cleaning mode" }).selectOption("vacuum_and_mop");
      await expect.poll(async () => (await snapshot(page)).selection.roomSettings.map((room) => room.cleaningMode))
        .toEqual(["vacuum_and_mop", "vacuum_and_mop", "vacuum_and_mop", "vacuum_and_mop"]);
      await expect(settingsRow(gallery)).toHaveAccessibleName("Cleaning settings Vacuum + mop · Optimal");
      await gallery.getByRole("button", { name: "Settings for Office" }).click();
      await gallery.getByRole("combobox", { name: "Cleaning mode for Office" }).selectOption("mop");
      await expect.poll(async () => (await snapshot(page)).selection.roomSettings.find((room) => room.roomId === "room-c").cleaningMode).toBe("mop");
      await expect(settingsRow(gallery)).toHaveAccessibleName("Cleaning settings Different per room");
      // One selected room changed on its own: the value is still "Different
      // per room", since the selects keep showing the whole-clean setting.
      const state = await snapshot(page);
      await patchState(gallery, { selection: { ...state.selection, roomIds: ["room-c"] } });
      await expect(settingsRow(gallery)).toHaveAccessibleName("Cleaning settings Different per room");
      await settingsRow(gallery).click();
      await expect(gallery.locator("#clean-settings").getByRole("combobox", { name: "Cleaning mode" })).toHaveValue("vacuum_and_mop");
      await patchState(gallery, { selection: { ...state.selection, roomIds: ["room-a"] } });
      await expect(settingsRow(gallery)).toHaveAccessibleName("Cleaning settings Vacuum + mop · Optimal");
    });

    test("one disclosure opens at a time, and Mop holds the coverage select with its hint (R28)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow });
      const kitchen = gallery.getByRole("button", { name: "Settings for Kitchen" });
      const box = await kitchen.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await kitchen.click();
      await expect(kitchen).toHaveAttribute("aria-expanded", "true");
      await expect(gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen" })).toBeVisible();
      await expect(gallery.getByRole("combobox", { name: "Vacuum coverage for Kitchen" })).toBeVisible();
      await gallery.getByRole("button", { name: "Settings for Living room" }).click();
      await expect(kitchen).toHaveAttribute("aria-expanded", "false");
      await expect(gallery.getByRole("combobox", { name: "Cleaning mode for Living room" })).toBeVisible();
      await expect(gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen" })).toHaveCount(0);
      await settingsRow(gallery).click();
      await expect(gallery.getByRole("combobox", { name: /^Cleaning mode for / })).toHaveCount(0);
      await expect(gallery.locator("#clean-settings")).toBeVisible();

      await kitchen.click();
      await gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen" }).selectOption("mop");
      const coverage = gallery.getByRole("combobox", { name: "Vacuum coverage for Kitchen" });
      await expect(coverage).toHaveCount(0);
      await expect(gallery.getByRole("switch", { name: "Double-pass mopping" })).toBeVisible();
      const before = (await snapshot(page)).selection.roomSettings.find((room) => room.roomId === "room-a").coverageSetting;
      await gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen" }).selectOption("vacuum_and_mop");
      await expect(coverage).toHaveValue(before);
      await expect(gallery.getByRole("switch", { name: "Double-pass mopping" })).toBeVisible();
      await gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen" }).selectOption("vacuum");
      await expect(coverage).toHaveValue(before);
    });

    test("an opened disclosure scrolls into view, and Escape from the action bar closes it first", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow });
      await settingsRow(gallery).click();
      const body = panelOf(gallery).locator(narrow ? ".sheet-body" : ".workflow-body");
      const mode = gallery.locator("#clean-settings").getByRole("combobox", { name: "Cleaning mode" });
      await expect.poll(async () => {
        const [scroller, select] = await Promise.all([body.boundingBox(), mode.boundingBox()]);
        return select.y >= scroller.y && select.y + select.height <= scroller.y + scroller.height + 0.5;
      }).toBe(true);
      await gallery.getByRole("button", { name: "Clean 4 rooms" }).focus();
      await page.keyboard.press("Escape");
      await expect(settingsRow(gallery)).toHaveAttribute("aria-expanded", "false");
      await expect(settingsRow(gallery)).toBeFocused();
      expect((await snapshot(page)).workflow).toBe("rooms");
    });

    test("Escape peels the menu, then the disclosure, then Rooms (Review Focus 4)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready", narrow });
      await cards(gallery).nth(0).click();
      await roomsGroup(gallery).getByText("Kitchen", { exact: true }).click();
      const kitchen = gallery.getByRole("button", { name: "Settings for Kitchen" });
      await kitchen.click();
      await expect(kitchen).toHaveAttribute("aria-expanded", "true");
      await gallery.getByRole("button", { name: "Map options", exact: true }).click();
      await expect(gallery.getByRole("menu", { name: "Map options" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(gallery.getByRole("menu", { name: "Map options" })).toHaveCount(0);
      await expect.poll(() => focusedText(page)).toBe("button Map options");
      await expect(kitchen).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(kitchen).toHaveAttribute("aria-expanded", "false");
      await expect(kitchen).toBeFocused();
      expect((await snapshot(page)).workflow).toBe("rooms");
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await snapshot(page)).workflow).toBe("none");
      await expect.poll(() => focusedText(page)).toMatch(/^button Clean rooms/);
    });

    test("Escape closes an open disclosure first and leaves Rooms second (§5 Keyboard)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready", narrow });
      await cards(gallery).nth(0).click();
      await roomsGroup(gallery).getByText("Kitchen", { exact: true }).click();
      const kitchen = gallery.getByRole("button", { name: "Settings for Kitchen" });
      await kitchen.click();
      await gallery.getByRole("combobox", { name: "Vacuum coverage for Kitchen" }).focus();
      await page.keyboard.press("Escape");
      await expect(kitchen).toHaveAttribute("aria-expanded", "true");
      await kitchen.focus();
      await page.keyboard.press("Escape");
      await expect(kitchen).toHaveAttribute("aria-expanded", "false");
      await expect(kitchen).toBeFocused();
      expect((await snapshot(page)).workflow).toBe("rooms");
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await snapshot(page)).workflow).toBe("none");
      await expect.poll(() => focusedText(page)).toMatch(/^button Clean rooms/);
    });

    test("a failed or blocked check shows one line above the rows (R4)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-failed", narrow });
      await expect(checkLines(gallery)).toHaveCount(1);
      await expect(checkLines(gallery).first()).toContainText("Home Assistant couldn't check the room settings.");
      await expect(primaryReason(gallery)).toHaveText("Can't start until Home Assistant checks the room settings.");
      const retries = (await snapshot(page)).manualRoomPreviewRetry;
      await gallery.locator(".check-lines").getByRole("button", { name: "Try again" }).click();
      await expect.poll(async () => (await snapshot(page)).manualRoomPreviewRetry).toBe(retries + 1);

      const blocked = await loadGallery(page, { scenario: "rooms-ready", narrow });
      await blocked.evaluate((element) => {
        const { withGalleryRoomPreview } = window.__galleryModule;
        const state = element.getWorkspaceSnapshot();
        element.replaceWorkspaceState(withGalleryRoomPreview({ ...state, selection: { ...state.selection,
          roomSettings: state.selection.roomSettings.map((room) => room.roomId === "room-a" ? { ...room, cleaningMode: "mop" } : room) } },
        { blocker: "invalid_cadence_policy" }));
      });
      await expect(checkLines(blocked).last()).toHaveText("Turn off \"Use room schedules\" to use this cleaning mode.");
      await expect(primaryReason(blocked)).toHaveText("Can't start until you change the settings noted above.");
      await settingsRow(blocked).click();
      await blocked.getByRole("switch", { name: "Use room schedules" }).click();
      await expect(checkLines(blocked).last()).toHaveText("These rooms can't be cleaned with the current settings. Change the settings or the rooms, then try again.");
    });

    test("a row keeps its own schedule problem as a third line (R20)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow });
      await gallery.evaluate((element) => {
        const { withGalleryRoomPreview } = window.__galleryModule;
        element.replaceWorkspaceState(withGalleryRoomPreview(element.getWorkspaceSnapshot(), { reasons: { "room-c": ["coverage_requires_vacuum"] } }));
      });
      await expect(roomBox(gallery, "Office")).toHaveAccessibleName(/^Office Vacuum · Optimal The vacuum rotation needs a cleaning mode/);
      await expect(roomsGroup(gallery).locator(".problem-line .ms-icon")).toHaveCount(1);
    });

    test("at the limit the header line has no live role and unselected rows are held by it (R5)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "room-limit", narrow });
      // The scenario selects all 100 rooms; a 101st shows the held row.
      await gallery.evaluate((element) => {
        const state = element.getWorkspaceSnapshot();
        const plans = state.resources.plans.value;
        element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans,
          value: { ...plans, rooms: [...plans.rooms, { roomId: "room-extra", name: "Pantry" }] } } } });
      });
      const limit = gallery.locator("#rooms-limit");
      await expect(limit).toHaveText("Up to 100 rooms fit in one clean, so remove one to add another.");
      await expect(limit).not.toHaveAttribute("role", /./);
      await expect(gallery.getByRole("status").filter({ hasText: "Up to 100 rooms" })).toHaveCount(0);
      const boxes = roomsGroup(gallery).getByRole("checkbox");
      await expect(boxes).toHaveCount(101);
      const spare = boxes.nth(100);
      await expect(spare).not.toBeChecked();
      await expect(spare).toHaveAttribute("aria-disabled", "true");
      await expect(spare).toHaveAccessibleDescription("Up to 100 rooms fit in one clean, so remove one to add another.");
      await spare.dispatchEvent("click");
      expect((await snapshot(page)).selection.roomIds).toHaveLength(100);
      await expect(spare).not.toBeChecked();
    });

    test("a busy robot holds every control with one shared description and no summary (R7, R10)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-busy", narrow });
      const busy = "Can't change rooms until the robot finishes or stops.";
      await expect(description(gallery)).toHaveText(busy);
      const boxes = roomsGroup(gallery).getByRole("checkbox");
      for (let index = 0; index < await boxes.count(); index += 1) {
        await expect(boxes.nth(index)).toHaveAttribute("aria-disabled", "true");
        await expect(boxes.nth(index)).toHaveAccessibleDescription(busy);
      }
      const clear = listHeader(gallery).getByRole("button", { name: "Clear", exact: true });
      await expect(clear).toHaveAttribute("aria-disabled", "true");
      await expect(clear).toHaveAccessibleDescription(busy);
      const before = (await snapshot(page)).selection;
      await boxes.first().dispatchEvent("click");
      await clear.dispatchEvent("click");
      await settingsRow(gallery).click();
      const mode = gallery.locator("#clean-settings").getByRole("combobox", { name: "Cleaning mode" });
      await expect(mode).toHaveAttribute("aria-disabled", "true");
      await expect(mode).toHaveAccessibleDescription(busy);
      await forceSelect(mode, "mop");
      await expect(mode).toHaveValue("vacuum");
      const due = gallery.getByRole("switch", { name: "Use room schedules" });
      await expect(due).toHaveAttribute("aria-disabled", "true");
      await due.dispatchEvent("click");
      await gallery.getByRole("button", { name: "Settings for Kitchen" }).click();
      const room = gallery.getByRole("combobox", { name: "Cleaning mode for Kitchen" });
      await expect(room).toHaveAttribute("aria-disabled", "true");
      await forceSelect(room, "mop");
      await expect(room).toHaveValue("vacuum");
      expect((await snapshot(page)).selection).toEqual(before);
      await expect(gallery.locator(".action-summary")).toHaveCount(0);
    });

    test("rows held by a map that is not ready say so to screen readers", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow });
      await patchState(gallery, { coherence: "verifying" });
      await expect(roomBox(gallery, "Kitchen")).toHaveAttribute("aria-disabled", "true");
      await expect(roomBox(gallery, "Kitchen")).toHaveAccessibleDescription("Waiting for the map to be ready.");
      await expect(description(gallery)).toHaveText("Choose rooms on the map or in the list.");
    });

    test("empty, loading and failed catalogs take the description slot (R9)", async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "rooms-empty", narrow });
      await expect(description(gallery)).toHaveText("This floor has no rooms yet. Name rooms in the Matic app to see them here.");
      await expect(gallery.getByRole("heading", { level: 3, name: "Rooms to clean" })).toHaveCount(0);
      await expect(settingsRow(gallery)).toHaveCount(0);
      await expect(listHeader(gallery)).toHaveCount(0);
      await expect(primaryReason(gallery)).toHaveText("Can't start until you choose a named room.");

      await plansResource(gallery, { status: "loading", value: null });
      await expect(panelOf(gallery).getByRole("status").filter({ hasText: "Loading rooms and plans…" })).toBeVisible();
      await plansResource(gallery, { status: "error", value: null });
      await expect(panelOf(gallery).getByRole("alert").filter({ hasText: "Home Assistant couldn't load rooms and plans." })).toBeVisible();
      await expect(panelOf(gallery).getByRole("button", { name: "Try again" })).toBeVisible();
    });
  });
}

test.describe("the Rooms view: RTL and forced colors", () => {
  test("mirrors the open chevron and keeps the Settings button inside its row in RTL", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms-ready", narrow: true });
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    await settingsRow(gallery).click();
    await expect(settingsRow(gallery)).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => settingsRow(gallery).locator(".ms-icon").evaluate((element) => {
      const { rotate, transform } = getComputedStyle(element);
      return rotate === "-90deg" || /matrix\(-?0(\.0+)?, -?1, 1, -?0(\.0+)?/.test(transform) ? "mirrored" : `${rotate} ${transform}`;
    })).toBe("mirrored");
    const kitchen = gallery.getByRole("button", { name: "Settings for Kitchen" });
    await kitchen.click();
    await expect(kitchen).toHaveAttribute("aria-expanded", "true");
    const row = await kitchen.locator("xpath=ancestor::*[contains(@class, 'room-row')]").boundingBox();
    const button = await kitchen.boundingBox();
    expect(button.x).toBeGreaterThanOrEqual(row.x - 0.5);
    expect(button.x + button.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
  });

  test("a selected row takes the Highlight fill in forced colors", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    const gallery = await loadGallery(page, { scenario: "rooms-ready" });
    const row = roomsGroup(gallery).locator(".room-row").first();
    const highlight = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "background: Highlight; forced-color-adjust: none";
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    });
    await expect(row).toHaveCSS("background-color", highlight);
    await expect(roomBox(gallery, "Kitchen")).toBeVisible();
  });

  // Walkthrough item 4. Chromium's emulation resolves Highlight to a
  // translucent fill and HighlightText to white, and `forced-color-adjust:
  // auto` paints a Canvas backplate behind text, so a Highlight/HighlightText
  // button must opt out of the backplate or its label sits white on white.
  // The share of light pixels inside the label's box tells the two apart: a
  // backplate fills it; glyphs on the Highlight fill do not.
  test("forced colors keep the primary and Stop labels readable and every button's text off its fill", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "forced-colours emulation is Chromium's");
    await page.emulateMedia({ forcedColors: "active" });
    const lightShare = async (locator) => {
      const box = await locator.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const { x, y, width, height } = range.getBoundingClientRect();
        return { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(width), height: Math.ceil(height) };
      });
      const png = await page.screenshot({ clip: box });
      return page.evaluate(async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let light = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 600) light += 1;
        }
        return light / (pixels.length / 4);
      }, png.toString("base64"));
    };
    for (const [scenario, name, viewport] of [
      ["rooms-ready", "Clean 4 rooms", { width: 1024, height: 768 }],
      ["cleaning", "Stop cleaning", { width: 390, height: 844 }],
    ]) {
      const gallery = await loadGallery(page, { scenario, narrow: viewport.width < 600, viewport });
      const button = gallery.locator(".action-bar").getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveCSS("forced-color-adjust", "none");
      expect(await lightShare(button)).toBeLessThan(0.6);
      const clashes = await gallery.evaluate((root) => {
        const found = [];
        const walk = (node) => {
          for (const element of node.querySelectorAll(".ms-btn, .ms-chip")) {
            const { color, backgroundColor } = getComputedStyle(element);
            if (color === backgroundColor) found.push(`${element.className}: ${color}`);
            if (element.shadowRoot) walk(element.shadowRoot);
          }
          for (const element of node.querySelectorAll("*")) if (element.shadowRoot) walk(element.shadowRoot);
        };
        walk(root.shadowRoot ?? root);
        return found;
      });
      expect(clashes).toEqual([]);
    }
  });
});

// Task 6: the map and list stay in step, map taps are announced, the summary
// names the run and the chip Clear shares the gate.
const polite = (gallery) => gallery.locator(".root > .sr-only[aria-live=polite]");
const mapTap = (gallery, roomId) => gallery.locator("matic-map-canvas-v4").evaluate((canvas, id) => {
  canvas.dispatchEvent(new CustomEvent("matic-workspace-intent", { detail: { type: "toggle-room", roomId: id }, bubbles: true, composed: true }));
}, roomId);
// Counts the non-empty texts the polite region takes from now on.
const watchPolite = (gallery) => polite(gallery).evaluate((region) => {
  region.__spoken = [];
  new MutationObserver(() => { if (region.textContent) region.__spoken.push(region.textContent); }).observe(region, { childList: true, characterData: true, subtree: true });
});
const spoken = (gallery) => polite(gallery).evaluate((region) => region.__spoken);
const listFormat = (page, locale, items) => page.evaluate(({ language, names }) =>
  new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(names), { language: locale, names: items });
const numberFormat = (page, locale, value) => page.evaluate(({ language, count }) => new Intl.NumberFormat(language).format(count), { language: locale, count: value });

test.describe("map parity and announcements (home-rooms.md §5 Parity, Selection gate; §8 Screen readers; R7-R9)", () => {
  test("a map tap announces the room added, then removed; a list click announces nothing", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms", viewport: { width: 1024, height: 768 } });
    await expect(roomBox(gallery, "Kitchen")).not.toBeChecked();
    await watchPolite(gallery);
    await mapTap(gallery, "room-a");
    await expect(roomBox(gallery, "Kitchen")).toBeChecked();
    await expect(polite(gallery)).toHaveText("Kitchen added");
    await mapTap(gallery, "room-a");
    await expect(roomBox(gallery, "Kitchen")).not.toBeChecked();
    await expect(polite(gallery)).toHaveText("Kitchen removed");
    await roomBox(gallery, "Living room").click();
    await expect(roomBox(gallery, "Living room")).toBeChecked();
    await expect(gallery.locator(".selection-chip")).toContainText("1 selected");
    expect(await spoken(gallery)).toEqual(["Kitchen added", "Kitchen removed"]);
  });

  test("a tap on a busy map announces the reason once and changes nothing (R7, R10)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms-busy", viewport: { width: 1024, height: 768 } });
    await expect(description(gallery)).toHaveText("Can't change rooms until the robot finishes or stops.");
    const before = await snapshot(page);
    const toasts = await gallery.locator("[data-notice-toast]").count();
    await watchPolite(gallery);
    await mapTap(gallery, "room-a");
    await expect(polite(gallery)).toHaveText("Can't change rooms until the robot finishes or stops.");
    const after = await snapshot(page);
    expect(after.selection.roomIds).toEqual(before.selection.roomIds);
    expect(after.notice).toEqual(before.notice);
    await expect(gallery.locator("[data-notice-toast]")).toHaveCount(toasts);
    expect(await spoken(gallery)).toEqual(["Can't change rooms until the robot finishes or stops."]);
  });

  test("a tap while the map is not ready announces the rows' held reason", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms-ready", viewport: { width: 1024, height: 768 } });
    await patchState(gallery, { coherence: "verifying" });
    await expect(roomBox(gallery, "Kitchen")).toHaveAccessibleDescription("Waiting for the map to be ready.");
    const before = (await snapshot(page)).selection.roomIds;
    await mapTap(gallery, "room-a");
    await expect(polite(gallery)).toHaveText("Waiting for the map to be ready.");
    expect((await snapshot(page)).selection.roomIds).toEqual(before);
  });

  test("a tap at the limit gives the slot notice and no added announcement (R8)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "room-limit", viewport: { width: 1024, height: 768 } });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans.value;
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, plans: { ...state.resources.plans,
        value: { ...plans, rooms: [...plans.rooms, { roomId: "room-extra", name: "Pantry" }] } } } });
    });
    await expect(roomBox(gallery, "Pantry")).toHaveAttribute("aria-disabled", "true");
    await watchPolite(gallery);
    await mapTap(gallery, "room-extra");
    const limit = "Up to 100 rooms fit in one clean, so remove one to add another.";
    await expect(gallery.locator("[data-notice-slot]")).toContainText(limit);
    await expect(polite(gallery)).toHaveText(limit);
    expect((await snapshot(page)).selection.roomIds).toHaveLength(100);
    expect(await spoken(gallery)).toEqual([limit]);
  });

  test("the summary lists the rooms in preview order with the dock, and hides on a landscape phone (R27)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms-ready", viewport: { width: 1024, height: 768 } });
    await expect(primary(gallery)).not.toHaveAttribute("aria-disabled", "true");
    const four = await listFormat(page, "en", ["Kitchen", "Living room", "2 more"]);
    await expect(gallery.locator(".action-summary")).toHaveText(`${four}, then back to the dock`);
    const state = await snapshot(page);
    await patchState(gallery, { selection: { ...state.selection, roomIds: ["room-a", "room-b"] } });
    await expect(gallery.locator(".action-summary")).toHaveText("Kitchen and Living room, then back to the dock");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(gallery.locator(".action-summary")).toBeHidden();
  });

  test("@mobile the grip names the selected rooms at peek", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms", narrow: true });
    await patchState(gallery, twoRooms(await snapshot(page)));
    await panelOf(gallery).getByRole("button", { name: "Collapse panel", exact: true }).click();
    await expect(gallery.locator(".sheet-status")).toHaveText("2 selected · Kitchen and Living room");
  });

  test("the chip keeps the count but drops Clear while the selection is held (R17, Task 6 ruling)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms-busy", viewport: { width: 1024, height: 768 } });
    const chip = gallery.locator(".selection-chip");
    const clear = chip.getByRole("button", { name: "Clear" });
    await expect(chip).toContainText("4 selected");
    await expect(clear).toHaveCount(0);
    // The panel's Clear carries the reason (R22).
    await expect(listHeader(gallery).getByRole("button", { name: "Clear" })).toHaveAccessibleDescription("Can't change rooms until the robot finishes or stops.");
    await patchState(gallery, { activity: "docked" });
    await expect(clear).toBeVisible();
    await clear.click();
    expect((await snapshot(page)).selection.roomIds).toEqual([]);
    await expect(chip).toHaveCount(0);
  });

  test("@mobile both Clear buttons are 44 px under a coarse pointer", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms-ready", viewport: { width: 1024, height: 768 } });
    expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(true);
    for (const clear of [listHeader(gallery).getByRole("button", { name: "Clear" }), gallery.locator(".selection-chip").getByRole("button", { name: "Clear" })]) {
      const box = await clear.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("Arabic counts and a bidi room name (Review Focus 5)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms-ready", viewport: { width: 1024, height: 768 } });
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      const plans = state.resources.plans.value;
      element.replaceWorkspaceState({ ...state, locale: "ar", resources: { ...state.resources, plans: { ...state.resources.plans,
        value: { ...plans, rooms: plans.rooms.map((room) => room.roomId === "room-a" ? { ...room, name: "مطبخ" } : room) } } } });
    });
    const four = await numberFormat(page, "ar", 4);
    const two = await numberFormat(page, "ar", 2);
    await expect(listHeader(gallery).locator("small")).toHaveText(`${four} selected`);
    await expect(gallery.locator(".selection-chip")).toContainText(`${four} selected`);
    await expect(gallery.locator(".action-summary")).toContainText(`${two} more`);
    await expect(gallery.locator(".room-row bdi", { hasText: "مطبخ" })).toBeVisible();
  });

  test("the summary and the tap announcement follow the preview and the gate", async ({ page }) => {
    await loadStoreHarness(page);
    const result = await page.evaluate(async (harness) => {
      const { createGalleryState, withGalleryRoomPreview, roomsSummary, roomTapAnnouncement } = await import(harness);
      const t = (key, fallback, placeholders = {}) => Object.entries(placeholders).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), fallback);
      const ready = createGalleryState("rooms-ready");
      const out = {};
      out.four = roomsSummary(t, ready);
      // Preview order wins over selection order.
      const reversed = structuredClone(ready);
      reversed.manualRoomPreview.value.preview.rooms.reverse();
      out.reversed = roomsSummary(t, reversed);
      const two = withGalleryRoomPreview({ ...ready, selection: { ...ready.selection, roomIds: ["room-a", "room-b"] } });
      out.two = roomsSummary(t, two);
      out.none = roomsSummary(t, { ...ready, selection: { ...ready.selection, roomIds: [] } });
      const busy = { ...ready, activity: "cleaning" };
      out.busy = roomTapAnnouncement(t, busy, busy, "room-a");
      const verifying = { ...ready, coherence: "verifying" };
      out.verifying = roomTapAnnouncement(t, verifying, verifying, "room-a");
      out.removed = roomTapAnnouncement(t, ready, two, "room-c");
      out.added = roomTapAnnouncement(t, two, ready, "room-c");
      out.unknown = roomTapAnnouncement(t, two, ready, "scene-9");
      out.same = roomTapAnnouncement(t, ready, ready, "room-a");
      return out;
    }, HARNESS);
    expect(result.four).toBe("Kitchen, Living room, and 2 more, then back to the dock");
    expect(result.reversed).toBe("Bedroom, Office, and 2 more, then back to the dock");
    expect(result.two).toBe("Kitchen and Living room, then back to the dock");
    expect(result.none).toBe("");
    expect(result.busy).toBe("Can't change rooms until the robot finishes or stops.");
    expect(result.verifying).toBe("Waiting for the map to be ready.");
    expect(result.removed).toBe("Office removed");
    expect(result.added).toBe("Office added");
    expect(result.unknown).toBeNull();
    expect(result.same).toBeNull();
  });

  test("an uncatalogued room cannot be tapped, a held tap reaches the reducer, and the selection draws with Room names off (R9, Review Focus 1)", async ({ page }) => {
    await loadStoreHarness(page);
    const result = await page.evaluate(async (harness) => {
      const { RendererController, GestureController, WorkspaceStore, createGalleryState } = await import(harness);
      const out = {};
      const mount = (state) => {
        const canvas = document.createElement("canvas"), overlay = document.createElement("canvas");
        for (const element of [canvas, overlay]) {
          Object.assign(element.style, { position: "absolute", left: "31px", top: "47px", width: "720px", height: "540px" });
          document.body.append(element);
        }
        canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {};
        const store = new WorkspaceStore(state);
        const renderer = new RendererController(canvas, overlay);
        renderer.setState(store.value);
        let taps = 0;
        const gestures = new GestureController(canvas, renderer, { state: () => store.value, onRoom: (roomId) => { taps += 1; store.dispatch({ type: "toggle-room", roomId }); }, onCircles: () => {}, onCirclePreview: () => {} });
        const bounds = canvas.getBoundingClientRect();
        const tap = (x, y) => {
          for (const type of ["pointerdown", "pointerup"]) canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: x, clientY: y, bubbles: true }));
        };
        const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const scan = (want) => {
          for (let y = 20; y < 520; y += 10) for (let x = 20; x < 700; x += 10) {
            const room = renderer.roomAt(bounds.left + x, bounds.top + y);
            const inRoom = renderer.containsMapPoint(renderer.screenToMap(bounds.left + x, bounds.top + y));
            if (want === "hit" ? room : (!room && inRoom)) return { x: bounds.left + x, y: bounds.top + y, room };
          }
          return null;
        };
        const alphaAt = (point) => {
          const ratio = window.devicePixelRatio || 1;
          return overlay.getContext("2d").getImageData(Math.round((point.x - bounds.left) * ratio), Math.round((point.y - bounds.top) * ratio), 1, 1).data[3];
        };
        const dispose = () => { gestures.dispose(); renderer.dispose(); canvas.remove(); overlay.remove(); };
        return { store, renderer, tap, settle, scan, alphaAt, taps: () => taps, dispose };
      };
      const base = createGalleryState("rooms");
      const bare = { ...base, view: "top", labelsVisible: false, appearance: "photo", selection: { ...base.selection, roomIds: [], roomSettings: [] } };
      // Kitchen loses its catalog entry.
      const plans = bare.resources.plans.value;
      const uncatalogued = { ...bare, resources: { ...bare.resources, plans: { ...bare.resources.plans, value: { ...plans, rooms: plans.rooms.map((room) => room.roomId === "room-a" ? { ...room, name: "Elsewhere" } : room) } } } };
      let h = mount(uncatalogued);
      await h.settle();
      const orphan = h.scan("orphan");
      out.orphanFound = Boolean(orphan);
      if (orphan) h.tap(orphan.x, orphan.y);
      out.orphanTaps = h.taps();
      out.orphanSelection = h.store.value.selection.roomIds;
      h.dispose();

      h = mount(bare);
      await h.settle();
      const hit = h.scan("hit");
      out.hit = hit?.room ?? null;
      out.alphaBefore = h.alphaAt(hit);
      h.tap(hit.x, hit.y);
      out.selected = h.store.value.selection.roomIds;
      h.renderer.setState(h.store.value);
      await h.settle();
      out.alphaSelected = h.alphaAt(hit);
      h.renderer.setState({ ...h.store.value, workflow: "none" });
      await h.settle();
      out.alphaHome = h.alphaAt(hit);
      h.dispose();

      h = mount({ ...bare, coherence: "verifying" });
      await h.settle();
      h.tap(hit.x, hit.y);
      out.heldTaps = h.taps();
      out.heldSelection = h.store.value.selection.roomIds;
      h.dispose();

      h = mount({ ...bare, workflow: "plan", planView: "edit", coherence: "verifying", planDraft: { ...bare.planDraft, rooms: [] } });
      await h.settle();
      h.tap(hit.x, hit.y);
      out.planTaps = h.taps();
      h.dispose();
      return out;
    }, HARNESS);
    expect(result.orphanFound).toBe(true);
    expect(result.orphanTaps).toBe(0);
    expect(result.orphanSelection).toEqual([]);
    expect(result.hit).toMatch(/^room-/);
    expect(result.alphaBefore).toBe(0);
    expect(result.selected).toEqual([result.hit]);
    expect(result.alphaSelected).toBeGreaterThan(0);
    expect(result.alphaHome).toBe(0);
    expect(result.heldTaps).toBe(1);
    expect(result.heldSelection).toEqual([]);
    expect(result.planTaps).toBe(0);
  });
});

// ---- Cleaning history (PRO-60) and the robot trail (PRO-83) ---------------

test.describe("cleaning history", () => {
  test("explains the last run first and keeps earlier runs one tap away", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "runs" });
    await expect(gallery.getByRole("heading", { level: 2, name: "Cleaning history" })).toBeVisible();
    const last = gallery.getByRole("region", { name: "Daily clean" });
    await expect(last).toContainText("Stopped because the battery was low");
    await expect(last).toContainText("Let the robot charge, then clean the rest.");
    await expect(last.locator("dt")).toHaveText(["Kitchen", "Living room", "Office"]);
    await expect(last.locator("dd")).toHaveText(["Done", "Interrupted", "Not started"]);
    const trail = last.getByRole("button", { name: "Show trail on map" });
    await expect(trail).toHaveAttribute("aria-pressed", "true");
    // A saved map draws no trail, so its run offers none either.
    await patchState(gallery, { dataMode: "history" });
    await expect(trail).toHaveCount(0);
    await patchState(gallery, { dataMode: "live" });
    await expect(trail).toBeVisible();

    const earlier = gallery.getByRole("list", { name: "Earlier" }).getByRole("button");
    await expect(earlier).toHaveCount(2);
    await expect(earlier.nth(0)).toHaveAttribute("aria-expanded", "false");
    await expect(earlier.nth(1)).toContainText("Result not reported");
    await earlier.nth(1).click();
    await expect(earlier.nth(1)).toHaveAttribute("aria-expanded", "true");
    const robot = gallery.getByRole("list", { name: "Earlier" }).getByRole("listitem").nth(1);
    await expect(robot).toContainText("Started from the Matic app or the robot");
    await expect(robot.locator("dd")).toHaveText(["Partly done"]);
    await expect(robot.getByRole("button", { name: "Show trail on map" })).toHaveCount(0);
  });

  test("an empty history, a failed read and a robot whose history can't be read each say so", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "runs" });
    const runs = (await snapshot(page)).resources.runs;
    await patchState(gallery, { resources: { ...(await snapshot(page)).resources, runs: { ...runs, value: { ...runs.value, robotHistory: false, runs: [] } } } });
    await expect(gallery.getByText("No cleans yet. Each clean appears here once it starts.")).toBeVisible();
    await expect(gallery.getByText("Cleans started from the Matic app can't be read right now.")).toBeVisible();

    await patchState(gallery, { resources: { ...(await snapshot(page)).resources, runs: { status: "error", value: null, problem: "runs-unavailable" } } });
    await expect(gallery.getByText("Cleaning history isn't available right now.")).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("the live trail grows only during a run and starts empty for the next one", async ({ page }) => {
    await loadStoreHarness(page);
    const steps = await page.evaluate(async (harness) => {
      const { WorkspaceStore, createGalleryState, extendLiveTrail } = await import(harness);
      const ready = createGalleryState("ready");
      const key = ready.resources.entry.mapSessionKey;
      const store = new WorkspaceStore({ ...ready, activity: "cleaning", trail: { id: "live", mapSessionKey: key, segments: [[[0, 0]]] } });
      const pose = (x) => ({ ...ready.resources.pose.value, mapSessionKey: key, position: [x, 0] });
      const points = () => store.value.trail.segments.flat().map(([x]) => x);
      const seen = [];
      extendLiveTrail(store, pose(1));
      extendLiveTrail(store, pose(1.1));
      seen.push(points());
      store.patch({ activity: "docked" });
      extendLiveTrail(store, pose(2));
      seen.push(points());
      store.patch({ activity: "cleaning" });
      extendLiveTrail(store, pose(3));
      seen.push(points());
      store.patch({ lastRun: { runId: "run-2", outcome: "running", completedRoomCount: 0, roomCount: 1 } });
      extendLiveTrail(store, pose(4));
      seen.push(points());
      store.patch({ activity: "recharging" });
      extendLiveTrail(store, pose(5));
      seen.push(points());
      // A new verified map starts the trail over in its own frame.
      extendLiveTrail(store, { ...pose(6), mapSessionKey: "next-map" });
      seen.push([store.value.trail.mapSessionKey, ...points()]);
      return seen;
    }, HARNESS);
    expect(steps).toEqual([[0, 1], [0, 1], [3], [4], [4, 5], ["next-map", 6]]);
  });

  test("an open history rereads when the run it reports changes", async ({ page }) => {
    await loadStoreHarness(page);
    const reloads = await page.evaluate(async (harness) => {
      const { WorkspaceStore, createGalleryState, watchRuns } = await import(harness);
      const store = new WorkspaceStore({ ...createGalleryState("ready"), workflow: "runs" });
      let count = 0;
      // A disposed controller's watcher stops; its replacement takes over.
      const stop = watchRuns(store, () => { count += 100; });
      stop();
      watchRuns(store, () => { count += 1; });
      const run = { runId: "run-1", outcome: "running", completedRoomCount: 0, roomCount: 2 };
      const seen = [];
      store.patch({ lastRun: run });
      seen.push(count);
      store.patch({ activity: "cleaning" });
      seen.push(count);
      store.patch({ lastRun: { ...run, outcome: "partial", completedRoomCount: 1 } });
      seen.push(count);
      store.patch({ workflow: "none", lastRun: { ...run, outcome: "partial", completedRoomCount: 2 } });
      seen.push(count);
      // Once no managed run is running, the robot docking rereads, and so
      // does a task started from the Matic app as it starts and as it ends.
      store.patch({ workflow: "runs", activity: "docked" });
      seen.push(count);
      for (const activity of ["cleaning", "paused", "returning", "docked"]) {
        store.patch({ activity });
        seen.push(count);
      }
      return seen;
    }, HARNESS);
    expect(reloads).toEqual([1, 1, 2, 2, 3, 4, 4, 4, 5]);
  });

  test("a saved map offers no Robot trail, which only draws on the live map @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history", narrow: true });
    await patchState(gallery, { workflow: "none" });
    const menu = await openOptions(gallery);
    await expect(menu.getByRole("menuitemcheckbox", { name: "Robot trail" })).toHaveCount(0);
  });
});
