import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

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
  const waitForTransitions = () => page.evaluate(async () => {
    const transitions = document.getAnimations({ subtree: true })
      .filter((animation) => "transitionProperty" in animation);
    await Promise.all(transitions.map((animation) => animation.finished.catch(() => undefined)));
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
  await panel.getByRole("button", { name: /^Run a plan/ }).click();
  const editPlan = panel.getByRole("button", { name: /Daily clean.*Edit plan/ });
  await expect(editPlan).toBeVisible();
  await editPlan.click();

  const schedule = panel.getByLabel("Plan rooms").locator("details").first();
  await schedule.locator("summary").click();
  if ((page.viewportSize()?.width ?? Infinity) <= 600) {
    const sheet = panel.locator(".mobile-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await expect(sheet.locator(".sheet-body")).toBeVisible();
  }
  await expectNoSeriousAccessibilityViolations(page, "plan cadence editor");
  const scope = schedule.getByLabel("Schedule scope for Kitchen");
  const mopInterval = schedule.getByLabel("Vacuum and mop interval for Kitchen, from 1 to 100");
  const coverageInterval = schedule.getByLabel("Periodic coverage interval for Kitchen, from 1 to 100");
  const coverageSetting = schedule.getByLabel("Periodic coverage setting for Kitchen");
  const mopNext = schedule.getByLabel("Do vacuum and mop on the next clean for Kitchen");
  const coverageNext = schedule.getByLabel("Use periodic coverage on the next clean for Kitchen");
  const save = panel.getByRole("button", { name: "Save plan", exact: true });

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

  await scope.selectOption("shared");
  await mopInterval.fill("7");
  await coverageInterval.fill("5");
  await coverageSetting.selectOption("heavy_duty");
  await mopNext.check();
  await coverageNext.check();
  await save.click();
  await waitForReadback(1, true, sharedEdited);
  await expect(scope).toHaveValue("shared");
  await expect(mopInterval).toHaveValue("7");
  await expect(coverageInterval).toHaveValue("5");

  await panel.getByRole("button", { name: "Back to plans" }).click();
  await expect(panel.getByRole("button", { name: /Daily clean.*Edit plan/ })).toBeVisible();
  await panel.getByRole("button", { name: /Daily clean.*Edit plan/ }).click();
  const reopenedSchedule = panel.getByLabel("Plan rooms").locator("details").first();
  await reopenedSchedule.locator("summary").click();
  await expect(reopenedSchedule.getByLabel("Schedule scope for Kitchen")).toHaveValue("shared");
  await expect(reopenedSchedule.getByLabel("Vacuum and mop interval for Kitchen, from 1 to 100")).toHaveValue("7");
  await expect(reopenedSchedule.getByLabel("Periodic coverage interval for Kitchen, from 1 to 100")).toHaveValue("5");
  await expect(reopenedSchedule.getByLabel("Periodic coverage setting for Kitchen")).toHaveValue("heavy_duty");
  await expect(reopenedSchedule.getByLabel("Do vacuum and mop on the next clean for Kitchen")).toBeChecked();
  await expect(reopenedSchedule.getByLabel("Use periodic coverage on the next clean for Kitchen")).toBeChecked();

  await scope.selectOption("plan");
  await mopInterval.fill("4");
  await coverageInterval.fill("2");
  await coverageSetting.selectOption("standard");
  await save.click();
  await waitForReadback(2, true, privateEdited);
  await expect(scope).toHaveValue("plan");
  await expect(mopInterval).toHaveValue("4");
  await expect(coverageInterval).toHaveValue("2");

  if (!(await schedule.evaluate((details) => details.open))) {
    await schedule.locator("summary").click();
  }
  await mopInterval.fill("");
  await coverageInterval.fill("");
  await save.click();
  await waitForReadback(3, true, cadenceDisabled);
  await expect(mopNext).not.toBeChecked();
  await expect(coverageNext).not.toBeChecked();

  if (!(await schedule.evaluate((details) => details.open))) {
    await schedule.locator("summary").click();
  }
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
