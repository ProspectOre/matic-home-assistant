import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// A photo check's notification opens /matic-map?entry=<entry id>&photo=<id>:
// Matic Map opens Photos with that photo in the viewer, then drops the link
// from the address so Back or a reload doesn't open it again.

const ROUTE = "/api/matic_robot/photo/synthetic-entry";
const shot = (index) => ({
  photo_id: `q${index}`, captured_at: new Date(Date.UTC(2026, 10, 19, 12, 0) - index * 60_000).toISOString(),
  source: "home_assistant", starred: false, area: index === 65 ? "Hall" : "Kitchen", pose: null,
  url: `${ROUTE}/q${index}`, preview_url: `${ROUTE}/preview/q${index}`,
});
// More than one page of 60, so the linked photo starts off the grid.
const GALLERY = { map: null, viewpoints: [], albums: [{ album: "manual", photos: Array.from({ length: 70 }, (_, index) => shot(index)) }] };

const mount = async (page, link) => {
  const { panelTag } = await installPanelFixture(page, { photoGallery: GALLERY });
  await page.evaluate(async ({ tag, link }) => {
    if (link) history.replaceState(null, "", `/matic-map?${link}`);
    document.body.append(window.__panelFixture.createPanel());
    await customElements.whenDefined(tag);
  }, { tag: panelTag, link });
  return page.locator(panelTag);
};
const address = (page) => page.evaluate(() => `${location.pathname}${location.search}`);

test("a link opens Photos at its photo, with its tile shown, and leaves the address", async ({ page }) => {
  const panel = await mount(page, "entry=synthetic-entry&photo=q65");
  const gallery = panel.locator("matic-photo-gallery-v4");
  const viewer = gallery.getByRole("dialog");

  await expect(viewer.getByRole("img")).toHaveAccessibleName(/^Hall · /);
  expect(await address(page)).toBe("/matic-map");
  await expect(gallery.locator(".shot")).toHaveCount(70);
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(gallery.locator(".shot").nth(65)).toBeFocused();
});

test("a link to a photo that is gone says so and shows the rest", async ({ page }) => {
  const panel = await mount(page, "entry=synthetic-entry&photo=pruned");
  const gallery = panel.locator("matic-photo-gallery-v4");

  await expect(gallery.getByRole("status")).toHaveText("The photo from the link is no longer saved.");
  await expect(gallery.locator(".shot")).toHaveCount(60);
  await expect(gallery.getByRole("dialog")).toHaveCount(0);
  expect(await address(page)).toBe("/matic-map");
  // Opening a photo clears the message.
  await gallery.locator(".shot").first().click();
  await expect(gallery.getByText("The photo from the link is no longer saved.")).toHaveCount(0);
});

test("a link that arrives while Photos is open opens its photo", async ({ page }) => {
  const panel = await mount(page, null);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  await panel.getByRole("button", { name: /^Photos See photos the robot took/ }).click();
  const gallery = panel.locator("matic-photo-gallery-v4");
  await expect(gallery.locator(".shot")).toHaveCount(60);

  // Home Assistant's navigate pushes the address, then announces it.
  await page.evaluate(() => {
    history.pushState(null, "", "/matic-map?entry=synthetic-entry&photo=q65");
    window.dispatchEvent(new Event("location-changed"));
  });

  await expect(gallery.getByRole("dialog").getByRole("img")).toHaveCount(1);
  await expect(gallery.getByRole("dialog")).toHaveAccessibleName(/^Hall · /);
  expect(await address(page)).toBe("/matic-map");
});

test("a link to a robot that is gone is dropped without opening Photos", async ({ page }) => {
  const panel = await mount(page, "entry=removed-entry&photo=q1");

  await expect.poll(() => address(page)).toBe("/matic-map");
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("none");
  await expect(panel.locator("matic-photo-gallery-v4")).toHaveCount(0);
});
