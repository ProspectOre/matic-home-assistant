import { expect, test } from "@playwright/test";
import { build } from "esbuild";

// Saved-order numbers are checked through what the renderer exposes: the
// text it draws, where it reports a room on screen (mapToScreen), and the
// pixels there compared with the same plan in Intelligent rotation. Nothing
// here knows the badge's colour or how its box is laid out.
test("plan map labels number rooms only in Saved order, and taps edit only in Edit", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { GestureController } from "./frontend/map-studio-v4/gesture-controller"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/plan-numbers.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { RendererController, GestureController, WorkspaceStore, createGalleryState } = await import("/plan-numbers.js");
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    let activeOverlay = null;
    const drawnText = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas === activeOverlay) drawnText.push(String(text));
      return originalFillText.call(this, text, ...args);
    };
    const NativeNumberFormat = Intl.NumberFormat;
    let formatters = 0;
    Intl.NumberFormat = new Proxy(NativeNumberFormat, {
      construct(target, args) {
        formatters += 1;
        return Reflect.construct(target, args);
      },
    });
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const initial = createGalleryState("ready");
    const rooms = initial.resources.scene.value.metadata.rooms;
    const first = rooms[0];
    const stateFor = (workflow, planView, runBehavior) => ({
      ...initial, workflow, planView, locale: "ar-EG", view: "top", labelsVisible: true, appearance: "map",
      planDraft: {
        ...initial.planDraft, runBehavior,
        rooms: rooms.slice(0, 2).reverse().map((room, index) => ({ roomId: room.id, cleaningMode: "vacuum", coverageSetting: "standard", index })),
      },
    });
    // The overlay pixels in a band around where the renderer says the first
    // room's label sits, as one string per render.
    const render = async (workflow, planView, runBehavior, { redraws = 0 } = {}) => {
      const scene = document.createElement("canvas");
      const overlay = document.createElement("canvas");
      for (const canvas of [scene, overlay]) {
        Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
        document.body.append(canvas);
      }
      const store = new WorkspaceStore(stateFor(workflow, planView, runBehavior));
      const renderer = new RendererController(scene, overlay);
      activeOverlay = overlay;
      drawnText.length = 0;
      renderer.setState(store.value);
      await frame();
      const formattersBefore = formatters;
      for (let index = 0; index < redraws; index += 1) {
        renderer.setState({ ...store.value });
        renderer.requestRender();
        await frame();
      }
      const formattersDuringRedraws = formatters - formattersBefore;
      const { metersPerCell, origin } = initial.resources.scene.value.metadata;
      const center = renderer.mapToScreen({ x: (first.center[0] + origin[0]) * metersPerCell, y: (first.center[1] + origin[1]) * metersPerCell });
      const ratio = overlay.width / overlay.getBoundingClientRect().width;
      const band = overlay.getContext("2d").getImageData(
        Math.round((center.x - 90) * ratio), Math.round((center.y - 9) * ratio),
        Math.round(180 * ratio), Math.round(18 * ratio),
      ).data;
      let hit;
      const bounds = scene.getBoundingClientRect();
      for (let y = 20; y < 520 && !hit; y += 8) for (let x = 20; x < 700 && !hit; x += 8) {
        const room = renderer.roomAt(bounds.left + x, bounds.top + y);
        if (room) hit = { x: bounds.left + x, y: bounds.top + y, room };
      }
      const gestures = new GestureController(scene, renderer, {
        state: () => store.value,
        drawReady: () => true,
        onRoom: (roomId) => store.dispatch({ type: "toggle-room", roomId }),
        onCircles: () => {}, onCirclePreview: () => {},
      });
      scene.setPointerCapture = () => {}; scene.releasePointerCapture = () => {};
      const before = store.value.planDraft.rooms.map((room) => room.roomId);
      if (hit) for (const type of ["pointerdown", "pointerup"]) scene.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: hit.x, clientY: hit.y, bubbles: true,
      }));
      const after = store.value.planDraft.rooms.map((room) => room.roomId);
      gestures.dispose(); renderer.dispose(); scene.remove(); overlay.remove();
      const firstLabelIndex = drawnText.indexOf(first.name);
      return {
        band: Array.from(band), before, after, formattersDuringRedraws,
        firstLabelText: firstLabelIndex > 0 ? drawnText[firstLabelIndex - 1] : null,
        drawnText: [...drawnText],
      };
    };
    const changed = (a, b) => a.band.reduce((count, value, index) => count + (value !== b.band[index] ? 1 : 0), 0);
    const orderedRun = await render("plan", "run", "ordered", { redraws: 3 });
    const rotationRun = await render("plan", "run", "intelligent");
    const orderedEdit = await render("plan", "edit", "ordered");
    const rotation = await render("plan", "edit", "intelligent");
    const otherOrdered = await render("rooms", "edit", "ordered");
    const otherRotation = await render("rooms", "edit", "intelligent");
    Intl.NumberFormat = NativeNumberFormat;
    const numerals = [1, 2].map((value) => new NativeNumberFormat("ar-EG").format(value));
    const numbered = (render) => render.drawnText.some((text) => numerals.includes(text));
    return {
      runBadge: changed(orderedRun, rotationRun),
      editBadge: changed(orderedEdit, rotation),
      otherWorkflowDifference: changed(otherOrdered, otherRotation),
      formattersDuringRedraws: orderedRun.formattersDuringRedraws,
      numbered: {
        orderedRun: numbered(orderedRun), orderedEdit: numbered(orderedEdit),
        rotation: numbered(rotation), otherWorkflow: numbered(otherOrdered),
      },
      orderedRun: { label: orderedRun.firstLabelText, before: orderedRun.before, after: orderedRun.after },
      orderedEdit: { label: orderedEdit.firstLabelText, before: orderedEdit.before, after: orderedEdit.after },
    };
  });
  // Saved order changes what is drawn at the room's label; rotation, or any
  // other workflow, draws the label alone.
  expect(result.runBadge).toBeGreaterThan(0);
  expect(result.editBadge).toBeGreaterThan(0);
  expect(result.otherWorkflowDifference).toBe(0);
  expect(result.numbered).toEqual({ orderedRun: true, orderedEdit: true, rotation: false, otherWorkflow: false });
  expect(result.orderedRun.label).toBe(new Intl.NumberFormat("ar-EG").format(2));
  expect(result.orderedEdit.label).toBe(new Intl.NumberFormat("ar-EG").format(2));
  // Redrawing in the same locale reuses one number formatter.
  expect(result.formattersDuringRedraws).toBe(0);
  expect(result.orderedRun.after).toEqual(result.orderedRun.before);
  expect(result.orderedEdit.after).not.toEqual(result.orderedEdit.before);
});
