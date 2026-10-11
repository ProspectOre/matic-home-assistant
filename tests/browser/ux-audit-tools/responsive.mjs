// Measures the shell against the 2026-08-29 "Responsive contract" table.
// usage: node tests/browser/ux-audit-tools/responsive.mjs  -> prints one JSON line per (scenario,viewport)
import { launch, openScenario, inject } from "./common.mjs";

const VIEWPORTS = [
  [320, 844], [360, 844], [390, 844], [844, 390], [600, 1024], [768, 1024],
  [768, 600], [768, 432], [1024, 768], [1024, 900], [1440, 900], [1920, 1080],
];
const SCENARIOS = (process.argv[2] ?? "ready,rooms,draw,plan-saved-intelligent").split(",");

const { browser, context } = await launch();
const page = await context.newPage();
const rows = [];
for (const scenario of SCENARIOS) {
  for (const [width, height] of VIEWPORTS) {
    await openScenario(page, scenario, { width, height });
    await inject(page);
    const m = await page.evaluate(() => {
      const a = window.__uxAudit;
      const root = a.shell().shadowRoot;
      const q = (sel, r = root) => r.querySelector(sel);
      const R = (el) => (el ? a.rect(el) : null);
      const rootEl = q(".root");
      const narrow = rootEl.classList.contains("narrow");
      const bar = q(".app-bar");
      const title = q(".title");
      const workspace = q(".workspace");
      const canvas = q(".canvas");
      const inspector = q(".inspector");
      const sheet = q(".mobile-sheet");
      const body = q(".sheet-body") ?? q(".workflow-body");
      const canvasEl = q("matic-map-canvas-v4");
      const doc = document.scrollingElement;
      const fit = canvasEl?.shadowRoot?.querySelector(".fit");
      const viewSwitch = canvasEl?.shadowRoot?.querySelector(".view-switch");
      const floor = q(".floor-switcher");
      const toggle = q(".workspace-toggle");
      const overflow = q(".overflow");
      const tools = [...root.querySelectorAll(".sheet-tools .draw-tools button, .sheet-tools button[data-tool]")];
      const drawBtns = canvasEl?.shadowRoot ? [...canvasEl.shadowRoot.querySelectorAll(".draw-tools button")] : [];
      const vw = window.innerWidth, vh = window.innerHeight;
      // horizontal overflow of any visible interactive/painted element
      const offscreenX = a.all().filter((e) => e.matches(a.INTERACTIVE) && a.visible(e)).filter((e) => {
        const r = e.getBoundingClientRect();
        // exclude things merely scrolled below the sheet viewport
        return (r.right > vw + 0.5 || r.left < -0.5) && !e.closest(".skip-link");
      }).map((e) => a.name(e) + ":" + Math.round(e.getBoundingClientRect().left) + ".." + Math.round(e.getBoundingClientRect().right));
      // overlap among top-chrome controls
      const chrome = [["floor", floor], ["viewSwitch", viewSwitch], ["fit", fit], ["menu", q(".nav--menu")], ["toggle", toggle], ["overflow", overflow]]
        .filter(([, el]) => el).map(([n, el]) => [n, a.rect(el)]);
      const overlaps = [];
      for (let i = 0; i < chrome.length; i += 1) for (let j = i + 1; j < chrome.length; j += 1) {
        const [n1, r1] = chrome[i], [n2, r2] = chrome[j];
        const ox = Math.min(r1.x + r1.w, r2.x + r2.w) - Math.max(r1.x, r2.x);
        const oy = Math.min(r1.y + r1.h, r2.y + r2.h) - Math.max(r1.y, r2.y);
        if (ox > 0.5 && oy > 0.5) overlaps.push(n1 + "x" + n2 + ":" + Math.round(ox) + "x" + Math.round(oy));
      }
      const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
      const gridCols = workspace ? getComputedStyle(workspace).gridTemplateColumns : null;
      return {
        narrow, vw, vh,
        docScrollW: doc.scrollWidth, docClientW: doc.clientWidth, docScrollH: doc.scrollHeight, docClientH: doc.clientHeight,
        bar: R(bar), titleText: title?.textContent.trim(), titleFont: cs(title, "fontSize"), titleTrunc: title ? title.scrollWidth > title.clientWidth + 0.5 : null,
        workspace: R(workspace), canvas: R(canvas), inspector: !narrow ? R(inspector) : null,
        sheet: narrow ? R(sheet) : null, detent: sheet?.dataset.detent ?? null,
        bodyScroll: body ? { client: body.clientHeight, scroll: body.scrollHeight } : null,
        gridCols,
        fit: R(fit), viewSwitch: R(viewSwitch), floor: R(floor), toggle: R(toggle), overflow: R(overflow),
        sheetToolButtons: tools.map((b) => ({ n: a.name(b), w: a.rect(b).w, h: a.rect(b).h })),
        drawDockButtons: drawBtns.filter((b) => a.visible(b)).map((b) => ({ n: a.name(b), w: a.rect(b).w, h: a.rect(b).h })),
        offscreenX, overlaps,
      };
    });
    const canvasShare = m.workspace && m.canvas ? Math.round((m.canvas.w / m.workspace.w) * 1000) / 10 : null;
    const sheetShare = m.workspace && m.sheet ? Math.round((m.sheet.h / m.workspace.h) * 1000) / 10 : null;
    rows.push({ scenario, width: width, height, canvasShare, sheetShare, ...m });
    console.log(JSON.stringify({ scenario, width, height, canvasShare, sheetShare, ...m }));
  }
}
await browser.close();
