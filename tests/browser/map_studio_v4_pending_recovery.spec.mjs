import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

for (const coherence of ["degraded", "unavailable"]) {
  for (const pending of ["preferences", "area"]) {
    test(`@safety Home retains map recovery while ${pending} loads on a ${coherence} map`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      const { panelTag } = await installPanelFixture(page, { moduleSource: "packaged" });
      await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
      const panel = page.locator(panelTag);
      const shell = panel.locator("matic-map-shell-v4");
      await expect.poll(() => panel.evaluate(element => element.getWorkspaceSnapshot().coherence)).toBe("current");
      await shell.evaluate((element, { coherence, pending }) => {
        element.state = { ...element.state, coherence,
          homePins: pending === "preferences"
            ? { status: "loading", pins: [] }
            : { status: "ready", pins: [{ kind: "area", id: "missing-area" }] },
          resources: { ...element.state.resources, areas: { status: "idle", value: null, problem: null } },
        };
      }, { coherence, pending });
      await expect(shell.locator(".home-actions").getByRole("button", { name: "Try again", exact: true })).toBeVisible();
      const maps = shell.locator(".maps");
      const history = maps.getByRole("button", { name: /^Map history/u });
      await expect(history).toBeVisible();
      await expect(maps.getByRole("button", { name: /^Map diagnostics/u })).toBeVisible();
      await history.focus();
      const before = await maps.boundingBox();
      await shell.evaluate(element => {
        element.state = { ...element.state, homePins: { status: "ready", pins: [] } };
      });
      await expect(shell.getByRole("group", { name: "Cleaning choices" })).toBeVisible();
      await expect(history).toBeFocused();
      const after = await maps.boundingBox();
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    });
  }
}
