import { build } from "esbuild";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installPanelFixture, openPlanPicker } from "./map_studio_v4_panel_fixture.mjs";

const cadence = (scope, mopEvery, coverageEvery, periodicCoverage, doMopNext = false, doCoverageNext = false) => ({
  scope,
  mop_every_n: mopEvery,
  coverage_every_n: coverageEvery,
  periodic_coverage_setting: periodicCoverage,
  do_mop_next: doMopNext,
  do_coverage_next: doCoverageNext,
});

const planCatalog = ({ enabled = true, policy }) => ({
  rooms: [{ room_id: "room-a", name: "Kitchen" }],
  selected_plan: "daily",
  plans: [{
    id: "daily",
    name: "Daily clean",
    enabled,
    run_behavior: "intelligent",
    rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard", cadence: policy }],
    room_order: ["room-a"],
    return_to_base: true,
    finish_current_room: false,
    finish_current_room_threshold: 50,
  }],
});

const expectNoSeriousAccessibilityViolations = async (page, workflow) => {
  // Every running transition, in the document and in each shadow root, so a
  // control whose colours are still easing (Save turning on) is read at rest.
  const waitForTransitions = () => page.evaluate(async () => {
    const running = () => {
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) if (element.shadowRoot) roots.push(element.shadowRoot);
      }
      return roots.flatMap((root) => root.getAnimations())
        .filter((animation) => "transitionProperty" in animation && animation.playState === "running");
    };
    for (let frame = 0; frame < 120 && running().length; frame += 1) {
      await new Promise(requestAnimationFrame);
    }
  });

  try {
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await waitForTransitions();
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations
        .filter(({ impact }) => impact === "serious" || impact === "critical")
        .map(({ id, impact, help, nodes }) => ({
          id,
          impact,
          help,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        }));
      expect(serious, `${workflow} (${colorScheme}) has serious or critical accessibility violations`).toEqual([]);
    }
  } finally {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: null });
    await waitForTransitions();
  }
};

const exerciseCadenceRoundtrip = async ({ page }) => {
  const privateInitial = cadence("plan", 2, 3, "quick");
  const sharedEdited = cadence("shared", 7, 5, "heavy_duty", true, true);
  const privateEdited = cadence("plan", 4, 2, "standard", true, true);
  const cadenceDisabledWrite = cadence("plan", null, null, "standard");
  const cadenceDisabled = cadence("plan", null, null, null);
  const cadenceReenabled = cadence("plan", 4, 2, "standard");
  const fixture = await installPanelFixture(page, {
    initialPlanCatalog: planCatalog({ policy: privateInitial }),
    moduleSource: "packaged",
  });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.cadenceRoundtrip = "true";
    document.body.append(panel);
  });

  const panel = page.locator(`${fixture.panelTag}[data-cadence-roundtrip="true"]`);
  await expect.poll(() => page.evaluate(() => {
    const panel = document.querySelector("[data-cadence-roundtrip='true']");
    return panel?.getWorkspaceSnapshot().resources.scene.status;
  })).toBe("ready");
  await expect.poll(() => page.evaluate(() => {
    const resource = document.querySelector("[data-cadence-roundtrip='true']").getWorkspaceSnapshot().resources.plans;
    return { status: resource.status, problem: resource.problem };
  })).toEqual({ status: "ready", problem: null });
  await expectNoSeriousAccessibilityViolations(page, "ready workspace");
  await openPlanPicker(panel);
  const editPlan = panel.getByRole("button", { name: /^Daily clean/ });
  await expect(editPlan).toBeVisible();
  await editPlan.click();
  if ((page.viewportSize()?.width ?? Infinity) <= 600) {
    const sheet = panel.locator(".mobile-sheet");
    await expect(sheet).toBeVisible();
    // shell.md §5 Sheet: a saved plan opens in Run, at half height.
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(sheet.locator(".sheet-body")).toBeVisible();
  }

  const rooms = panel.getByRole("list", { name: "Rooms", exact: true });
  const schedule = rooms.getByRole("group", { name: "Smart cleaning for Kitchen" });
  // A saved plan opens in Run, and Save returns there (plan.md §5); its
  // schedules change in Edit, inside the room's settings (plan.md §3).
  const openSchedule = async () => {
    await panel.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
    const settings = rooms.getByRole("button", { name: "Settings for Kitchen", exact: true });
    if ((await settings.getAttribute("aria-expanded")) !== "true") await settings.click();
    await expect(schedule).toBeVisible();
  };
  await openSchedule();
  await expectNoSeriousAccessibilityViolations(page, "plan cadence editor");
  // "Count completed cleans" lives under Advanced (room-schedule.md §3).
  const scopeRadio = (label) => schedule.getByRole("radio", { name: label, exact: true, includeHidden: true });
  const setScope = async (label) => {
    if (!(await scopeRadio(label).isVisible())) await schedule.getByText("Advanced", { exact: true }).click();
    await scopeRadio(label).check();
  };
  const shared = "Across all plans (recommended)";
  const thisPlan = "In this plan only";
  // Each field is named by its row's label line, which says its value (room-schedule.md §3).
  const mopInterval = schedule.getByRole("spinbutton", { name: /^(Mop|Occasional mopping)/ });
  const coverageInterval = schedule.getByRole("spinbutton", { name: /vacuum/ });
  const coverageSetting = schedule.getByLabel("Vacuum level for Kitchen");
  // One next-clean switch, named by the work it brings forward.
  const nextClean = schedule.getByRole("switch");
  const save = panel.getByRole("button", { name: "Save", exact: true });

  const waitForReadback = async (saveCount, expectedEnabled, expectedPolicy) => {
    await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(saveCount);
    await expect.poll(() => page.evaluate(() => {
      const state = document.querySelector("[data-cadence-roundtrip='true']").getWorkspaceSnapshot();
      return {
        draftEnabled: state.planDraft.enabled,
        draftDirty: state.planDraft.dirty,
        draftCadence: state.planDraft.rooms[0]?.cadence ?? null,
        savedEnabled: state.resources.plans.value?.plans[0]?.enabled,
        savedCadence: state.resources.plans.value?.plans[0]?.rooms[0]?.cadence ?? null,
      };
    })).toEqual({
      draftEnabled: expectedEnabled,
      draftDirty: false,
      draftCadence: {
        scope: expectedPolicy.scope,
        mopEveryN: expectedPolicy.mop_every_n,
        coverageEveryN: expectedPolicy.coverage_every_n,
        periodicCoverageSetting: expectedPolicy.periodic_coverage_setting,
        doMopNext: expectedPolicy.do_mop_next,
        doCoverageNext: expectedPolicy.do_coverage_next,
      },
      savedEnabled: expectedEnabled,
      savedCadence: {
        scope: expectedPolicy.scope,
        mopEveryN: expectedPolicy.mop_every_n,
        coverageEveryN: expectedPolicy.coverage_every_n,
        periodicCoverageSetting: expectedPolicy.periodic_coverage_setting,
        doMopNext: expectedPolicy.do_mop_next,
        doCoverageNext: expectedPolicy.do_coverage_next,
      },
    });
  };

  await setScope(shared);
  await mopInterval.fill("7");
  await coverageInterval.fill("5");
  await coverageSetting.selectOption("heavy_duty");
  await expect(nextClean).toHaveAccessibleName("Mop and heavy duty vacuum on the next clean");
  await nextClean.click();
  await expect(nextClean).toHaveAttribute("aria-checked", "true");
  await save.click();
  await waitForReadback(1, true, sharedEdited);
  await openSchedule();
  await expect(scopeRadio(shared)).toBeChecked();
  await expect(mopInterval).toHaveValue("7");
  await expect(coverageInterval).toHaveValue("5");

  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await panel.getByRole("button", { name: "Back to plans" }).click();
  await expect(panel.getByRole("button", { name: /^Daily clean/ })).toBeVisible();
  await panel.getByRole("button", { name: /^Daily clean/ }).click();
  await panel.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
  await rooms.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
  const reopenedSchedule = rooms.getByRole("group", { name: "Smart cleaning for Kitchen" });
  await expect(reopenedSchedule.getByRole("radio", { name: shared, exact: true, includeHidden: true })).toBeChecked();
  await expect(reopenedSchedule.getByRole("spinbutton", { name: "Mop every 7 cleans" })).toHaveValue("7");
  await expect(reopenedSchedule.getByRole("spinbutton", { name: "Heavy duty vacuum every 5 cleans" })).toHaveValue("5");
  await expect(reopenedSchedule.getByLabel("Vacuum level for Kitchen")).toHaveValue("heavy_duty");
  await expect(reopenedSchedule.getByRole("switch")).toHaveAttribute("aria-checked", "true");

  // The saved flags stay set, so the switch stays on through the scope change.
  await setScope(thisPlan);
  await expect(nextClean).toHaveAttribute("aria-checked", "true");
  await mopInterval.fill("4");
  await coverageInterval.fill("2");
  await coverageSetting.selectOption("standard");
  await save.click();
  await waitForReadback(2, true, privateEdited);
  await openSchedule();
  await expect(scopeRadio(thisPlan)).toBeChecked();
  await expect(mopInterval).toHaveValue("4");
  await expect(coverageInterval).toHaveValue("2");

  await mopInterval.fill("");
  await coverageInterval.fill("");
  await save.click();
  await waitForReadback(3, true, cadenceDisabled);
  await openSchedule();
  // Nothing is scheduled, so there is nothing to bring forward.
  await expect(nextClean).toHaveCount(0);

  // A new rotation is Heavy duty unless a level is chosen first (room-schedule.md D1).
  await expect(coverageSetting).toHaveValue("heavy_duty");
  await coverageSetting.selectOption("standard");
  await mopInterval.fill("4");
  await coverageInterval.fill("2");
  await save.click();
  await waitForReadback(4, true, cadenceReenabled);

  const calls = await page.evaluate(() => window.__panelFixture.serviceCalls);
  const payload = (enabledValue, policy) => ({
    plan_id: "daily",
    name: "Daily clean",
    enabled: enabledValue,
    run_behavior: "intelligent",
    rooms: [{
      room: "room-a",
      cleaning_mode: "vacuum",
      coverage_setting: "standard",
      cadence: policy,
    }],
    return_to_base: true,
    finish_current_room: false,
    finish_current_room_threshold: 50,
    occupancy_aware: false,
    occupancy_sensors: {},
    select: true,
  });
  expect(calls).toEqual([
    payload(true, sharedEdited),
    payload(true, privateEdited),
    payload(true, cadenceDisabledWrite),
    payload(true, cadenceReenabled),
  ].map((data) => ({
    domain: "matic_robot",
    service: "save_plan",
    data,
    target: { entity_id: "vacuum.synthetic" },
  })));
  expect(await page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThanOrEqual(5);
};

test("plan editor saves cadence choices and restores them from the packaged panel @safety", exerciseCadenceRoundtrip);
test("plan editor restores cadence choices on touch viewports @mobile", exerciseCadenceRoundtrip);

test("mop-only legacy vacuum rules stay visible and can leave shared participation @safety", async ({ page }) => {
  const catalog = planCatalog({ policy: cadence("shared", null, 3, "heavy_duty", false, true) });
  catalog.plans[0].rooms[0].cleaning_mode = "mop";
  catalog.plans[0].rooms[0].cadence_reasons = ["coverage_requires_vacuum"];
  catalog.plans[0].next_run_preview = {
    rooms: [], mission_boundaries: [], blocker: "coverage_requires_vacuum",
  };
  const fixture = await installPanelFixture(page, { initialPlanCatalog: catalog, moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await openPlanPicker(panel);
  await panel.getByRole("button", { name: /^Daily clean/ }).click();
  await expect(panel.getByRole("button", { name: "Run plan Daily clean", exact: true })).toBeDisabled();
  // The schedule changes in Edit, which opens at full height (plan.md §3).
  await panel.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
  const rooms = panel.getByRole("list", { name: "Rooms", exact: true });
  await rooms.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
  const schedule = rooms.getByRole("group", { name: "Smart cleaning for Kitchen" });
  const rotation = schedule.getByRole("spinbutton", { name: /vacuum/ });
  await expect(rotation).toHaveValue("3");
  await expect(rotation).toHaveAttribute("aria-disabled", "true");
  await expect(schedule.getByLabel("Vacuum level for Kitchen")).toHaveValue("heavy_duty");
  await expect(schedule.getByLabel("Vacuum level for Kitchen")).toHaveAttribute("aria-disabled", "true");
  const turnOff = schedule.getByRole("button", { name: "Turn off the vacuum rotation in Kitchen", exact: true });
  await expect(turnOff).toHaveText("Turn off");
  await turnOff.click();
  await expect(schedule.getByRole("radio", { name: "In this plan only", exact: true, includeHidden: true })).toBeChecked();
  await expect(rotation).toHaveValue("");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(1);
  const calls = await page.evaluate(() => window.__panelFixture.serviceCalls);
  expect(calls[0].data.rooms[0]).toMatchObject({
    cleaning_mode: "mop", coverage_setting: "standard",
    cadence: cadence("plan", null, null, null),
  });
});

const sharedScheduleCatalog = (paused = false) => {
  const shared = paused ? cadence("shared", null, null, null) : cadence("shared", 4, 3, "heavy_duty", true, false);
  const privatePolicy = cadence("plan", 2, 2, "quick");
  const roomPlan = (id, name, policy) => ({
    id, name, enabled: true, run_behavior: "intelligent",
    rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard", cadence: policy,
      cadence_identity: policy.scope === "shared" ? "shared:room-a" : `${id}:room-a` }],
    room_order: ["room-a"], return_to_base: true,
    finish_current_room: false, finish_current_room_threshold: 50,
  });
  return {
    rooms: [{
      room_id: "room-a", name: "Kitchen", boundary: [[0, 0], [5, 0], [5, 5]],
      shared_cadence: shared, shared_cadence_delete_token: "a".repeat(64),
    }],
    plans: [roomPlan("daily", "Daily clean", shared), roomPlan("weekend", "Weekend clean", shared),
      roomPlan("private", "Private clean", privatePolicy)],
    selected_plan: "daily",
  };
};

const openSharedDeleteDialog = async (page, panel) => {
  await openPlanPicker(panel);
  await panel.getByRole("button", { name: /^Daily clean/ }).click();
  await panel.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
  const rooms = panel.getByRole("list", { name: "Rooms", exact: true });
  const settings = rooms.getByRole("button", { name: "Settings for Kitchen", exact: true });
  if ((await settings.getAttribute("aria-expanded")) !== "true") await settings.click();
  const schedule = rooms.getByRole("group", { name: "Smart cleaning for Kitchen" });
  const more = schedule.getByRole("button", { name: "More for Kitchen", exact: true });
  await more.click();
  await panel.getByRole("menuitem", { name: "Delete shared schedule", exact: true }).click();
  return { schedule, more, dialog: panel.getByRole("dialog", { name: "Delete shared schedule?" }) };
};

test("shared schedule deletion confirms one token-bound write and preserves private cadence @safety", async ({ page }) => {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(), moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);

  const first = await openSharedDeleteDialog(page, panel);
  await expect(first.dialog).toContainText('"Daily clean" and "Weekend clean"');
  await expect(first.dialog).toContainText("Those plans keep their usual cleaning settings");
  await first.dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(first.dialog).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Settings for Kitchen", exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);

  await first.more.click();
  await panel.getByRole("menuitem", { name: "Delete shared schedule", exact: true }).click();
  const dialog = panel.getByRole("dialog", { name: "Delete shared schedule?" });
  await dialog.getByRole("button", { name: "Delete shared schedule", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const panel = document.querySelector(window.__panelFixture.panelTag);
    const plans = panel.getWorkspaceSnapshot().resources.plans.value.plans;
    return plans.map((plan) => ({ id: plan.id, cadence: plan.rooms[0]?.cadence ?? null }));
  })).toEqual([
    { id: "daily", cadence: null },
    { id: "weekend", cadence: null },
    { id: "private", cadence: {
      scope: "plan", mopEveryN: 2, coverageEveryN: 2,
      periodicCoverageSetting: "quick", doMopNext: false, doCoverageNext: false,
    } },
  ]);
  const calls = await page.evaluate(() => window.__panelFixture.serviceCalls);
  expect(calls).toEqual([{
    domain: "matic_robot", service: "delete_room_schedule",
    data: { room_id: "room-a", expected_token: "a".repeat(64) },
    target: { entity_id: "vacuum.synthetic" },
  }]);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls.some((call) => /reset|start|stop/i.test(call.service)))).toBe(false);
  await expect.poll(() => page.evaluate(() => document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot().notice?.key)).toBe("v4_notice_shared_schedule_deleted");
});

test("a shared deletion whose write module fails to load keeps the schedule and reports deletion failure @safety", async ({ page }) => {
  await page.route("**/chunks/catalog-writes-*.js", route => route.abort());
  const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(), moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const { dialog } = await openSharedDeleteDialog(page, panel);
  await dialog.getByRole("button", { name: "Delete shared schedule", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("The shared schedule wasn't deleted; reload plans, then try again.");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
  expect(await panel.evaluate(element => {
    const state = element.getWorkspaceSnapshot();
    return { command: state.command, fence: state.planWriteBlock,
      scopes: state.resources.plans.value.plans.map(plan => plan.rooms[0]?.cadence?.scope ?? null) };
  })).toEqual({ command: "idle", fence: null, scopes: ["shared", "shared", "plan"] });
});

test("server rejection of shared schedule deletion reports the stale reason @safety", async ({ page }) => {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(), moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const { dialog } = await openSharedDeleteDialog(page, panel);
  await page.evaluate(() => window.__panelFixture.failNextService("delete_room_schedule", Object.assign(
    new Error("stale token"), { translation_domain: "matic_robot", translation_key: "cadence_delete_stale" },
  )));
  await dialog.getByRole("button", { name: "Delete shared schedule", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot().notice?.key)).toBe("v4_notice_shared_schedule_stale");
  await expect.poll(() => page.evaluate(() => {
    const panel = document.querySelector(window.__panelFixture.panelTag);
    return panel.getWorkspaceSnapshot().resources.plans.value.plans.map((plan) => plan.rooms[0]?.cadence?.scope ?? null);
  })).toEqual(["shared", "shared", "plan"]);
  await expect.poll(() => page.evaluate(() => document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot().notice?.key)).toBe("v4_notice_shared_schedule_stale");
});

test("paused shared schedule remains deletable without reset controls @safety", async ({ page }) => {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(true), moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const { schedule, dialog } = await openSharedDeleteDialog(page, panel);
  await expect(schedule.getByRole("button", { name: "Reset mopping progress for Kitchen", exact: true })).toHaveCount(0);
  await expect(schedule.getByRole("button", { name: "Reset vacuum rotation progress for Kitchen", exact: true })).toHaveCount(0);
  await expect(dialog).toContainText("every plan using it");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});


test("a changed shared schedule closes its stale confirmation without writing @safety", async ({ page }) => {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(), moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const { dialog } = await openSharedDeleteDialog(page, panel);
  const bundle = await build({ stdin: { contents: 'export { WorkspaceStore } from "./frontend/map-studio-v4/state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/shared-delete-state.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  const result = await page.evaluate(async () => {
    const { WorkspaceStore } = await import("/shared-delete-state.js");
    const panel = document.querySelector(window.__panelFixture.panelTag);
    const store = new WorkspaceStore(panel.getWorkspaceSnapshot());
    const state = store.value;
    const resource = state.resources.plans;
    store.patch({ resources: { ...state.resources, plans: { ...resource,
      value: { ...resource.value, rooms: resource.value.rooms.map((room) => ({ ...room, sharedDeleteToken: "b".repeat(64) })) },
    } } });
    return { dialog: store.value.dialog, request: store.value.scheduleDeleteRequest };
  });
  expect(result).toEqual({ dialog: null, request: null });
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});

test("a private-only room has no shared schedule delete action @safety", async ({ page }) => {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: planCatalog({ policy: cadence("plan", 2, 3, "quick", true) }), moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await openPlanPicker(panel);
  await panel.getByRole("button", { name: /^Daily clean/ }).click();
  await panel.getByRole("button", { name: "Edit Daily clean", exact: true }).click();
  await panel.getByRole("button", { name: "Settings for Kitchen", exact: true }).click();
  const schedule = panel.getByRole("group", { name: "Smart cleaning for Kitchen" });
  await schedule.getByRole("button", { name: "More for Kitchen", exact: true }).click();
  await expect(panel.getByRole("menuitem", { name: "Delete shared schedule", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});


test("shared schedule confirmation keeps its actions reachable with many plans at 320px @safety", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const catalog = sharedScheduleCatalog();
  for (let i = 0; i < 14; i += 1) catalog.plans.push({ ...structuredClone(catalog.plans[0]), id: `other-${i}`, name: `A long household cleaning plan ${i + 1}` });
  const fixture = await installPanelFixture(page, { initialPlanCatalog: catalog, moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const { dialog } = await openSharedDeleteDialog(page, panel);
  await expect(dialog).toContainText("A long household cleaning plan 14");
  const confirm = dialog.getByRole("button", { name: "Delete shared schedule", exact: true });
  await confirm.scrollIntoViewIfNeeded();
  const box = await confirm.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(box.y + box.height).toBeLessThanOrEqual(568);
  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(violations.map(({ id }) => id)).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});


test("a stored shared schedule remains deletable when its policy is unavailable @safety", async ({ page }) => {
  const catalog = sharedScheduleCatalog();
  delete catalog.rooms[0].shared_cadence;
  const fixture = await installPanelFixture(page, { initialPlanCatalog: catalog, moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const { dialog } = await openSharedDeleteDialog(page, panel);
  await expect(dialog).toContainText('"Daily clean" and "Weekend clean"');
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});


for (const commitBeforeReply of [true, false]) {
  test(`shared deletion timeout fences edits through the late ${commitBeforeReply ? "reply after commit" : "commit"} and refresh @safety`, async ({ page }) => {
    const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(), moduleSource: "packaged" });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    const { dialog } = await openSharedDeleteDialog(page, panel);
    await page.clock.install();
    await page.evaluate((committed) => {
      if (committed) window.__panelFixture.deferNextServiceResponse();
      else window.__panelFixture.deferNextService();
    }, commitBeforeReply);
    await dialog.getByRole("button", { name: "Delete shared schedule", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);
    await page.clock.fastForward(20_000);
    const snapshot = () => page.evaluate(() => document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot());
    await expect.poll(async () => (await snapshot()).planWriteBlock).toBe("pending");
    expect((await snapshot()).command).toBe("idle");
    expect((await snapshot()).notice.key).toBe("v4_notice_shared_schedule_delete_unknown");
    await expect(panel.getByRole("combobox", { name: "Vacuum coverage for Kitchen", exact: true })).toHaveAttribute("aria-disabled", "true");
    // A lifecycle cancellation used to release command-pending. The independent
    // write fence must still block edits and leave Stop available.
    const bundle = await build({ stdin: { contents: 'export { WorkspaceStore, canStopMotion, canEditCoordinates } from "./frontend/map-studio-v4/state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
    await page.route("**/shared-delete-fence.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
    expect(await page.evaluate(async () => {
      const { WorkspaceStore, canStopMotion, canEditCoordinates } = await import("/shared-delete-fence.js");
      const state = document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot();
      const store = new WorkspaceStore({ ...state, command: "idle", pendingAction: null });
      store.dispatch({ type: "patch-plan-draft", patch: { name: "Should not change" } });
      return { held: store.value.planWriteBlock, unchanged: store.value.planDraft.name === state.planDraft.name,
        editable: canEditCoordinates(store.value), stoppable: canStopMotion({ ...store.value, activity: "cleaning" }) };
    })).toEqual({ held: "pending", unchanged: true, editable: false, stoppable: true });
    // Even a successful read before the original wire settles cannot un-fence.
    const reads = await page.evaluate(() => window.__panelFixture.planReads);
    await openPlanPicker(panel);
    await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(reads);
    expect((await snapshot()).planWriteBlock).toBe("pending");
    await page.evaluate(() => window.__panelFixture.releaseService());
    await expect.poll(async () => (await snapshot()).planWriteBlock).toBe(null);
    await expect.poll(async () => (await snapshot()).notice.key).toBe("v4_notice_shared_schedule_deleted");
    expect((await snapshot()).resources.plans.value.plans.map((plan) => plan.rooms[0]?.cadence?.scope ?? null)).toEqual([null, null, "plan"]);
    expect(await page.evaluate(() => window.__panelFixture.serviceCalls.map(({ service }) => service))).toEqual(["delete_room_schedule"]);
  });
}

test("unknown shared deletion stays fenced after a failed read until plans reload @safety", async ({ page }) => {
  const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(), moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const { dialog } = await openSharedDeleteDialog(page, panel);
  await page.clock.install();
  await page.evaluate(() => window.__panelFixture.deferNextServiceResponse());
  await dialog.getByRole("button", { name: "Delete shared schedule", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);
  await page.clock.fastForward(20_000);
  await expect.poll(() => page.evaluate(() => document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot().planWriteBlock)).toBe("pending");
  await page.evaluate(() => {
    window.__panelFixture.failNextPlansRead();
    window.__panelFixture.releaseService();
  });
  await expect.poll(() => page.evaluate(() => {
    const state = document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot();
    return { block: state.planWriteBlock, status: state.resources.plans.status, command: state.command };
  })).toEqual({ block: "refresh", status: "error", command: "idle" });
  await openPlanPicker(panel);
  await expect.poll(() => page.evaluate(() => document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot().planWriteBlock)).toBe(null);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls.map(({ service }) => service))).toEqual(["delete_room_schedule"]);
});


for (const afterTimeout of [false, true]) {
  test(`shared deletion survives disposal ${afterTimeout ? "after" : "before"} its timeout and a remount @safety`, async ({ page }) => {
    const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(), moduleSource: "packaged" });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    const { dialog } = await openSharedDeleteDialog(page, panel);
    await page.clock.install();
    await page.evaluate(() => window.__panelFixture.deferNextServiceResponse());
    await dialog.getByRole("button", { name: "Delete shared schedule", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);
    if (afterTimeout) await page.clock.fastForward(20_000);
    await page.evaluate(() => {
      window.__remountDeletePanel = document.querySelector(window.__panelFixture.panelTag);
      window.__remountDeletePanel.remove();
      document.body.append(window.__remountDeletePanel);
    });
    await expect.poll(() => page.evaluate(() => window.__remountDeletePanel.getWorkspaceSnapshot().planWriteBlock)).toBe("pending");
    await page.evaluate(() => window.__panelFixture.releaseService());
    await expect.poll(() => page.evaluate(() => window.__remountDeletePanel.getWorkspaceSnapshot().planWriteBlock)).toBe("refresh");
    await expect.poll(() => page.evaluate(() => {
      const state = window.__remountDeletePanel.getWorkspaceSnapshot();
      return { coherence: state.coherence, pageActive: state.pageActive, readOnly: state.floor.readOnly };
    })).toEqual({ coherence: "current", pageActive: true, readOnly: false });
    await openPlanPicker(panel);
    await expect.poll(() => page.evaluate(() => window.__remountDeletePanel.getWorkspaceSnapshot().planWriteBlock)).toBe(null);
    expect(await page.evaluate(() => window.__remountDeletePanel.getWorkspaceSnapshot().resources.plans.value.plans.map((plan) => plan.rooms[0]?.cadence?.scope ?? null))).toEqual([null, null, "plan"]);
    expect(await page.evaluate(() => window.__panelFixture.serviceCalls.map(({ service }) => service))).toEqual(["delete_room_schedule"]);
  });
}


for (const remaining of ["policy", "reference", "missing-room"]) {
  test(`an unknown deletion cannot claim success with a remaining ${remaining} @safety`, async ({ page }) => {
    const fixture = await installPanelFixture(page, { initialPlanCatalog: sharedScheduleCatalog(), moduleSource: "packaged" });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    const { dialog } = await openSharedDeleteDialog(page, panel);
    await page.evaluate(() => window.__panelFixture.deferNextServiceResponse());
    await dialog.getByRole("button", { name: "Delete shared schedule", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);
    const uncertain = sharedScheduleCatalog();
    delete uncertain.rooms[0].shared_cadence_delete_token;
    if (remaining !== "policy") delete uncertain.rooms[0].shared_cadence;
    if (remaining !== "reference") {
      for (const plan of uncertain.plans.filter((candidate) => candidate.id !== "private")) delete plan.rooms[0].cadence;
    }
    if (remaining === "missing-room") uncertain.rooms = [];
    await page.evaluate((catalog) => {
      window.__panelFixture.setPlanCatalog(catalog);
      window.__panelFixture.rejectService(0, new Error("synthetic connection lost after dispatch"));
    }, uncertain);
    await expect.poll(() => page.evaluate(() => document.querySelector(window.__panelFixture.panelTag).getWorkspaceSnapshot().notice?.key)).toBe("v4_notice_shared_schedule_delete_not_confirmed");
    expect(await page.evaluate(() => window.__panelFixture.serviceCalls.map(({ service }) => service))).toEqual(["delete_room_schedule"]);
  });
}
