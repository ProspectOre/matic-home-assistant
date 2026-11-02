import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../../frontend/map-studio-v4/archive-panel.ts", import.meta.url))],
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
});
const source = outputFiles[0].text;
const id = (n) => n.toString(16).padStart(32, "0");
const record = (n, retention) => ({ id: id(n), contentId: "a".repeat(64), createdAt: "2026-10-31T10:00:00Z",
  name: `Map ${n}`, retention, revision: 1, pointCount: 3, sceneUrl: retention === "trash" ? null : `/api/map/${id(n)}`,
  deletedUntil: retention === "trash" ? "2026-11-01T10:00:00Z" : null,
  imported: false, comparisonGroup: null, frame: null, compressedBytes: 50 });
const catalog = { generation: 7, capturePaused: false, capacityBlocked: false,
  records: [record(1, "automatic"), record(2, "kept"), record(3, "trash")],
  usage: { recordCount: 3, automaticCount: 1, keptCount: 1, trashCount: 1, compressedBytes: 150,
    activeCompressedBytes: 100, trashCompressedBytes: 50, reservedCount: 0, reservedBytes: 0 } };

test.beforeEach(async ({ page }) => {
  await page.route("**/archive-component-test", (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body></body></html>",
  }));
  await page.route("**/archive-component-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: source }));
  await page.goto("/archive-component-test");
  await page.evaluate(() => import("/archive-component-test.js"));
  await page.evaluate(async (catalog) => {
    window.actions = []; window.exports = []; window.views = []; window.comparisons = []; window.imports = [];
    const element = document.createElement("matic-archive-panel-v4");
    element.entryId = "entry"; element.authorized = true; element.catalog = catalog;
    element.onAction = (action) => window.actions.push(action);
    element.onExport = (ids) => window.exports.push(ids);
    element.onView = (id) => window.views.push(id);
    element.onCompare = (ids) => window.comparisons.push(ids);
    element.onImport = (file) => window.imports.push({ name: file.name, size: file.size });
    document.body.append(element); window.archive = element; await element.updateComplete;
  }, catalog);
});

test("@safety archive deletion requires exact selection and explicit kept inclusion", async ({ page }) => {
  await page.getByRole("checkbox", { name: "Map 1", exact: true }).check();
  await page.getByRole("checkbox", { name: "Map 2", exact: true }).check();
  const launch = page.getByRole("button", { name: "Move selected to Recently deleted", exact: true });
  await launch.click();
  const confirmation = page.getByRole("region", { name: "Move these saved maps to Recently deleted?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("heading")).toBeFocused();
  await expect(confirmation.getByRole("button", { name: "Move to Recently deleted", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.actions.length)).toBe(0);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(launch).toBeFocused();
  await launch.click();
  await confirmation.getByRole("checkbox", { name: /Include 1/ }).check();
  await confirmation.getByRole("button", { name: "Move to Recently deleted", exact: true }).click();
  const actions = await page.evaluate(() => window.actions);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ action: "delete", recordIds: [id(1), id(2)], expectedGeneration: 7, allowKept: true });
});

test("@safety a changed catalog cancels confirmation and clears old targets", async ({ page }) => {
  await page.getByRole("button", { name: "Select all automatic maps", exact: true }).click();
  await page.getByRole("button", { name: "Move selected to Recently deleted", exact: true }).click();
  await page.evaluate(async () => { window.archive.catalog = { ...window.archive.catalog, generation: 8 }; await window.archive.updateComplete; });
  await expect(page.getByRole("region", { name: "Move these saved maps to Recently deleted?" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Map 1", exact: true })).not.toBeChecked();
  await expect(page.getByRole("status")).toContainText("Saved maps changed");
  expect(await page.evaluate(() => window.actions)).toEqual([]);
});

test("@safety empty trash confirms only deleted IDs and does not touch kept history", async ({ page }) => {
  await page.getByRole("button", { name: "Empty recently deleted", exact: true }).click();
  const confirmation = page.getByRole("region", { name: "Permanently delete these saved maps?" });
  await expect(confirmation).toContainText("Map 3");
  await expect(confirmation).not.toContainText("Map 2");
  await expect(confirmation).toContainText("cannot be undone");
  await confirmation.getByRole("button", { name: "Delete permanently", exact: true }).click();
  expect(await page.evaluate(() => window.actions[0])).toMatchObject({ action: "permanent_delete", recordIds: [id(3)], expectedGeneration: 7 });
});

test("keep, naming, pause, import and compare are explicit typed intents", async ({ page }) => {
  const first = page.locator("article.record").first();
  await first.getByRole("button", { name: "Keep", exact: true }).click();
  await first.getByRole("textbox", { name: "Name", exact: true }).fill("Before the move");
  await first.getByRole("button", { name: "Save name", exact: true }).click();
  await page.getByRole("button", { name: "Pause automatic history", exact: true }).click();
  await first.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("checkbox", { name: "Map 1", exact: true }).check();
  await page.getByRole("checkbox", { name: "Map 2", exact: true }).check();
  await page.getByRole("button", { name: "Compare selected", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({ name: "maps.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  expect(await page.evaluate(() => window.actions.map(({ action, recordIds, name }) => ({ action, recordIds, ...(name === undefined ? {} : { name }) })))).toEqual([
    { action: "keep", recordIds: [id(1)] }, { action: "rename", recordIds: [id(1)], name: "Before the move" }, { action: "pause_capture", recordIds: [] },
  ]);
  expect(await page.evaluate(() => window.exports)).toEqual([[id(1)]]);
  expect(await page.evaluate(() => window.comparisons)).toEqual([[id(1), id(2)]]);
  expect(await page.evaluate(() => window.imports)).toEqual([{ name: "maps.json", size: 2 }]);
});

test("@safety access loss removes protected records and action controls", async ({ page }) => {
  await page.getByRole("button", { name: "Select all automatic maps", exact: true }).click();
  await page.evaluate(async () => { window.archive.authorized = false; await window.archive.updateComplete; });
  await expect(page.getByRole("status")).toContainText("Administrator access");
  await expect(page.locator("article.record")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Retry access", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.archive._selected)).toEqual([]);
});

test("name drafts survive an unrelated capture but never cross robot ownership", async ({ page }) => {
  const field = page.locator("article.record").first().getByRole("textbox", { name: "Name", exact: true });
  await field.fill("Unsaved kitchen name");
  await page.evaluate(async () => { window.archive.catalog = { ...window.archive.catalog, generation: 8 }; await window.archive.updateComplete; });
  await expect(field).toHaveValue("Unsaved kitchen name");
  await page.evaluate(async () => { window.archive.entryId = "different-entry"; await window.archive.updateComplete; });
  await expect(field).toHaveValue("Map 1");
});

test("@mobile archive controls fit a phone and keep permanent deletion reachable", async ({ page }) => {
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.getByRole("button", { name: "Empty recently deleted", exact: true }).click();
  const confirm = page.getByRole("region", { name: "Permanently delete these saved maps?" });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Delete permanently", exact: true })).toBeVisible();
});
