import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const ROOM_CATALOG = {
  rooms: [{
    room_id: "kitchen",
    name: "Kitchen",
    boundary: [[0, 0], [6, 0], [6, 5], [0, 5]],
  }],
  plans: [],
  selected_plan: null,
};

async function mountPanel(page, { width = 1180, height = 760, initialPlanCatalog = ROOM_CATALOG } = {}) {
  await page.setViewportSize({ width, height });
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialPlanCatalog,
  });
  await page.evaluate((panelTag) => {
    document.body.style.margin = "0";
    const panel = window.__panelFixture.createPanel();
    panel.style.width = "100vw";
    panel.style.height = "100vh";
    window.__acceptancePanel = panel;
    document.body.append(panel);
  }, fixture.panelTag);
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() =>
    window.__acceptancePanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  return { fixture, panel };
}

for (const { label, width } of [
  { label: "200% effective viewport", width: 640 },
  { label: "400% effective viewport", width: 320 },
]) {
  test(`keeps the localized RTL workspace usable at ${label} @safety`, async ({ page }) => {
    const { panel } = await mountPanel(page, { width });
    await page.evaluate(() => {
      document.documentElement.dir = "rtl";
      const original = window.__acceptancePanel.hass;
      const translated = {
        map_studio_title: "Mapa Matic",
        v4_how_to_move: "Cómo mover el mapa",
        v4_trackpad: "Panel táctil",
        v4_trackpad_help: "Desplázate para mover · pellizca para ampliar · gira para rotar",
        v4_close: "Cerrar",
      };
      window.__acceptancePanel.hass = {
        ...original,
        locale: { language: "es" },
        localize: (key) => translated[key.split(".").at(-1)] || key,
      };
    });

    await expect(panel.getByRole("heading", { name: "Mapa Matic", exact: true })).toBeVisible();
    const launcher = panel.getByRole("button", { name: "Cómo mover el mapa", exact: true });
    await expect(launcher).toBeVisible();
    await launcher.click();
    const dialog = panel.getByRole("dialog", { name: "Cómo mover el mapa" });
    await expect(dialog).toContainText("Desplázate para mover");
    const close = dialog.getByRole("button", { name: "Cerrar", exact: true });
    await expect(close).toBeFocused();
    await close.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();

    const dimensions = await page.evaluate(() => {
      const shell = window.__acceptancePanel.shadowRoot.querySelector("matic-map-shell-v4");
      const root = shell.shadowRoot.querySelector(".root");
      const canvas = shell.shadowRoot.querySelector("matic-map-canvas-v4");
      const map = canvas?.shadowRoot.querySelector(".map-root");
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        rootClient: root.clientWidth,
        rootScroll: root.scrollWidth,
        mapClient: map?.clientWidth ?? 0,
      };
    });
    expect(dimensions.document, `${label} document width`).toBeLessThanOrEqual(width);
    expect(dimensions.rootScroll, `${label} workspace width`).toBeLessThanOrEqual(dimensions.rootClient);
    expect(dimensions.mapClient, `${label} map remains laid out`).toBeGreaterThan(0);
  });
}

test("forced colors and reduced motion preserve visible dialog and keyboard behavior @safety", async ({ page }) => {
  const { panel } = await mountPanel(page, { width: 320, height: 740 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() =>
    matchMedia("(forced-colors: active)").matches
      && matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

  const launcher = panel.getByRole("button", { name: "How to move the map", exact: true });
  await launcher.click();
  const dialog = panel.getByRole("dialog", { name: "How to move the map" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("border-top-style", "solid");
  await expect(dialog).toHaveCSS("border-top-width", "1px");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();

  const shellMetrics = await page.evaluate(() => {
    const shell = window.__acceptancePanel.shadowRoot.querySelector("matic-map-shell-v4");
    return {
      sheetTransition: getComputedStyle(shell.shadowRoot.querySelector(".mobile-sheet")).transitionDuration,
      speedToken: getComputedStyle(shell).getPropertyValue("--ms-fast").trim(),
    };
  });
  expect(shellMetrics.sheetTransition).toBe("0s");
  expect(shellMetrics.speedToken).toBe("0s");
  await panel.getByRole("button", { name: "Close", exact: true }).press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test("keyboard dismissal keeps an edited plan draft and restores its launcher focus @safety", async ({ page }) => {
  const { panel } = await mountPanel(page);
  await expect.poll(() => page.evaluate(() =>
    window.__panelFixture.planReads > 0
      && window.__acceptancePanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");

  await panel.getByRole("button", { name: /^Create a plan/ }).click();
  await panel.getByRole("button", { name: "Create a plan", exact: true }).click();
  const name = panel.getByRole("textbox", { name: "Plan name" });
  await name.fill("Evening kitchen");
  const back = panel.getByRole("button", { name: "Back to plans" });
  await back.click();
  const discard = panel.getByRole("dialog", { name: "Discard plan changes?" });
  await expect(discard).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(discard).toHaveCount(0);
  await expect(back).toBeFocused();
  await expect(name).toHaveValue("Evening kitchen");
  expect(await page.evaluate(() => {
    const draft = window.__acceptancePanel.getWorkspaceSnapshot().planDraft;
    return { name: draft.name, dirty: draft.dirty };
  })).toEqual({ name: "Evening kitchen", dirty: true });
});
