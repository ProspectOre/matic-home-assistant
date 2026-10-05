import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

test("@safety request diagnostics are passive and scoped to the mounted controller", async ({ page }) => {
  await installPanelFixture(page);
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    window.diagnosticsPanel = panel;
    document.body.append(panel);
  });
  await expect.poll(() => page.evaluate(() => window.diagnosticsPanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  const result = await page.evaluate(() => {
    const panel = window.diagnosticsPanel;
    const before = panel.getWorkspaceSnapshot();
    const fixture = window.__panelFixture;
    const reads = fixture.catalogReads;
    const stats = fixture.stats();
    const first = panel.getRequestDiagnostics();
    let unchanged = true;
    for (let i = 0; i < 100; i += 1) {
      unchanged &&= JSON.stringify(panel.getRequestDiagnostics()) === JSON.stringify(first);
    }
    const passive = panel.getWorkspaceSnapshot() === before
      && reads === fixture.catalogReads && JSON.stringify(stats) === JSON.stringify(fixture.stats());
    const frozen = Object.isFrozen(first) && Object.isFrozen(first.http)
      && Object.values(first.http).every(Object.isFrozen);
    panel.remove();
    const detached = panel.getRequestDiagnostics();
    document.body.append(panel);
    const remounted = panel.getRequestDiagnostics();
    panel.remove();
    return { first, unchanged, passive, frozen, detached, remounted };
  });
  expect(result.first.http.catalog.completed).toBeGreaterThan(0);
  expect(result.first.http.scene.completed).toBeGreaterThan(0);
  expect(result.first.workspace).toBeNull();
  expect(result.unchanged).toBe(true);
  expect(result.passive).toBe(true);
  expect(result.frozen).toBe(true);
  expect(result.detached).toEqual({ http: null, workspace: null });
  for (const metric of Object.values(result.remounted.http)) expect(metric.requests).toBe(0);
  expect(JSON.stringify(result.first)).not.toMatch(/synthetic|entry_id|floor|\/api\//u);
});

test("20 admitted panel lifecycles release resources and ignore late history scenes", async ({ page }) => {
  const fixtureInfo = await installPanelFixture(page);
  const result = await page.evaluate(async ({ panelTag }) => {
    await customElements.whenDefined(panelTag);
    const fixture = window.__panelFixture;
    const waitFor = async (predicate, label) => {
      for (let attempt = 0; attempt < 2_000; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error(`panel state did not reach ${label}`);
    };
    const send = (shell, detail) => shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail, bubbles: true, composed: true,
    }));

    let resolvedHistoryScenes = 0;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const panel = fixture.createPanel();
      document.body.append(panel);
      await panel.updateComplete;
      await waitFor(() => panel.getWorkspaceSnapshot().resources.scene.status === "ready", "initial live scene");
      if (window.__panelFixturePopstateCount() !== 1) throw new Error("mounted panel did not own exactly one popstate listener");
      const shell = panel.shadowRoot.querySelector("matic-map-shell-v4");

      send(shell, { type: "open-workflow", workflow: "plans" });
      await waitFor(() => panel.getWorkspaceSnapshot().workflow === "plans"
        && panel.getWorkspaceSnapshot().resources.plans.status === "ready", "plans workflow");
      send(shell, { type: "open-workflow", workflow: "draw" });
      await waitFor(() => panel.getWorkspaceSnapshot().workflow === "draw"
        && panel.getWorkspaceSnapshot().resources.areas.status === "ready", "draw workflow");
      send(shell, { type: "open-workflow", workflow: "history" });
      await waitFor(() => panel.getWorkspaceSnapshot().workflow === "history"
        && panel.getWorkspaceSnapshot().resources.history.status === "ready", "history workflow");
      while (resolvedHistoryScenes < fixture.pendingHistoryScenes.length) {
        fixture.pendingHistoryScenes[resolvedHistoryScenes++]();
      }
      await waitFor(() => panel.getWorkspaceSnapshot().resources.scene.status === "ready", "history workflow scene");
      const savedFloorResponseIndex = fixture.pendingHistoryScenes.length;
      send(shell, { type: "set-floor", floorId: "saved-1" });
      await waitFor(() => panel.getWorkspaceSnapshot().selection.floorId === "saved-1"
        && panel.getWorkspaceSnapshot().dataMode === "history"
        && panel.getWorkspaceSnapshot().resources.scene.status === "loading"
        && fixture.pendingHistoryScenes.length > savedFloorResponseIndex, "saved floor scene request");

      panel.remove();
      await panel.updateComplete;
      if (window.__panelFixturePopstateCount() !== 0) throw new Error("panel popstate listener survived detach");
      const disposedState = panel.getWorkspaceSnapshot();
      fixture.pendingHistoryScenes[savedFloorResponseIndex]();
      resolvedHistoryScenes = savedFloorResponseIndex + 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (panel.getWorkspaceSnapshot() !== disposedState
        || panel.getWorkspaceSnapshot().selection.floorId !== "saved-1"
        || panel.getWorkspaceSnapshot().resources.scene.status !== "loading") {
        throw new Error("late history response revived a detached panel");
      }
    }
    return fixture.stats();
  }, { panelTag: fixtureInfo.panelTag });

  expect(result).toEqual({
    workersCreated: 20,
    workersTerminated: 20,
    urlsCreated: 20,
    urlsRevoked: 20,
    activePopstateListeners: 0,
    pendingHistoryScenes: 40,
    planReads: 40,
    serviceCalls: 0,
  });
});
