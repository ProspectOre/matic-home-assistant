import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function installSelectionHarness(page) {
  const bundle = await build({
    stdin: {
      contents: `
        import { MaticMapCanvasV4 } from "./frontend/map-studio-v4/map-canvas";
        import { createGalleryState, withGalleryRoomPreview } from "./frontend/map-studio-v4/gallery-state";
        import { WorkspaceStore, manualRoomPreviewKey, selectPrimaryAction } from "./frontend/map-studio-v4/state";
        window.__selectionHarnessModule = { MaticMapCanvasV4, createGalleryState, withGalleryRoomPreview, WorkspaceStore, manualRoomPreviewKey, selectPrimaryAction };
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/selection-clear-harness.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  await page.addScriptTag({ type: "module", url: "/selection-clear-harness.js" });
  await page.evaluate(() => {
    const api = window.__selectionHarnessModule;
    const state = api.createGalleryState("rooms");
    const rooms = Array.from({ length: 100 }, (_, index) => ({
      roomId: `room-${index}`,
      name: `Room ${index}`,
    }));
    const roomSettings = rooms.map(({ roomId }) => ({
      roomId,
      cleaningMode: "vacuum",
      coverageSetting: "standard",
    }));
    state.resources.plans.value.rooms = rooms;
    state.selection = { ...state.selection, entryId: "synthetic-entry", roomIds: rooms.map(({ roomId }) => roomId), roomSettings };
    const ready = api.withGalleryRoomPreview(state);
    const store = new api.WorkspaceStore(ready);
    const canvas = document.createElement("matic-map-canvas-v4");
    canvas.state = ready;
    canvas.style.width = "900px";
    canvas.style.height = "700px";
    document.body.append(canvas);
    const metrics = { commits: 0, nonemptyPreviewKeys: 0, previousKey: api.manualRoomPreviewKey(ready) };
    store.subscribe((next) => {
      metrics.commits += 1;
      canvas.state = next;
      const key = api.manualRoomPreviewKey(next);
      if (key && key !== metrics.previousKey) metrics.nonemptyPreviewKeys += 1;
      metrics.previousKey = key;
    });
    // Do not include WorkspaceStore.subscribe's initial delivery in the measured changes.
    metrics.commits = 0;
    canvas.addEventListener("matic-workspace-intent", (event) => store.dispatch(event.detail));
    window.__selectionHarness = { api, canvas, store, metrics };
  });
}

test("clears 100 rooms atomically without starting intermediate previews", async ({ page }) => {
  await installSelectionHarness(page);
  const before = await page.evaluate(() => {
    const { api, store } = window.__selectionHarness;
    return {
      roomCount: store.value.selection.roomIds.length,
      actionEnabled: api.selectPrimaryAction(store.value).enabled,
    };
  });
  expect(before).toEqual({ roomCount: 100, actionEnabled: true });

  await page.evaluate(() => window.__selectionHarness.canvas.shadowRoot.querySelector(".selection-chip button").click());
  const cleared = await page.evaluate(() => {
    const { api, store, metrics } = window.__selectionHarness;
    return {
      roomCount: store.value.selection.roomIds.length,
      settingsCount: store.value.selection.roomSettings.length,
      action: api.selectPrimaryAction(store.value),
      commits: metrics.commits,
      nonemptyPreviewKeys: metrics.nonemptyPreviewKeys,
    };
  });
  expect(cleared.roomCount).toBe(0);
  expect(cleared.settingsCount).toBe(0);
  expect(cleared.commits).toBe(1);
  expect(cleared.nonemptyPreviewKeys).toBe(0);
  expect(cleared.action).toMatchObject({ id: "clean-rooms", enabled: false });

  const noOp = await page.evaluate(() => {
    const { canvas, store, metrics } = window.__selectionHarness;
    const before = store.value;
    const commits = metrics.commits;
    const previews = metrics.nonemptyPreviewKeys;
    canvas.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "clear-selection" }, bubbles: true, composed: true,
    }));
    return {
      sameState: store.value === before,
      commits: metrics.commits - commits,
      nonemptyPreviewKeys: metrics.nonemptyPreviewKeys - previews,
    };
  });
  expect(noOp).toEqual({ sameState: true, commits: 0, nonemptyPreviewKeys: 0 });
});
