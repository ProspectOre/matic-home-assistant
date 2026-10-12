// Zoom / reflow audit: 320 CSS px stands in for 400% zoom (WCAG 1.4.10: 320x256).
// Reports horizontal page scroll, inner horizontal scrollers, clipped (ellipsized /
// overflow:hidden) text, and dialog fit.   usage: node tests/browser/ux-audit-tools/reflow.mjs
import { launch, openScenario, inject } from "./common.mjs";

const VIEWPORTS = [[320, 844], [320, 256], [640, 400], [720, 450]];
const SCENARIOS = ["ready", "rooms", "draw", "plan-saved-intelligent", "plan-cadence-shared", "history", "support", "multi-robot", "plans", "area-review-new", "full-map", "problem"];
const DIALOGS = [["confirmResetCadence", "plan-cadence-shared"], ["discardDraft", "plan-dirty"], ["confirmDeletePlan", "plan-saved-intelligent"]];

const { browser, context } = await launch();
const page = await context.newPage();

const measure = () => page.evaluate(() => {
  const a = window.__uxAudit;
  const doc = document.scrollingElement;
  const clipped = [];
  const hscroll = [];
  for (const e of a.all()) {
    const cs = getComputedStyle(e);
    if (cs.display === "none") continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(cs.overflowX) && e.clientWidth > 0) {
      hscroll.push(a.hostPath(e) + ` scrollW=${e.scrollWidth} clientW=${e.clientWidth}`);
    }
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (hasText && e.scrollWidth > e.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX)) {
      clipped.push(`${e.localName}.${[...e.classList].slice(0, 2).join(".")} "${e.textContent.trim().replace(/\s+/g, " ").slice(0, 40)}" ${e.clientWidth}/${e.scrollWidth}px`);
    }
  }
  const body = a.shell().shadowRoot.querySelector(".sheet-body, .workflow-body");
  return {
    pageHScroll: doc.scrollWidth - doc.clientWidth, pageVScroll: doc.scrollHeight - doc.clientHeight,
    sheetBodyHScroll: body ? body.scrollWidth - body.clientWidth : null,
    hscroll: hscroll.slice(0, 6), clipped: [...new Set(clipped)].slice(0, 12),
  };
});

console.log("== Page / scroller overflow and clipped text");
for (const [w, h] of VIEWPORTS) {
  for (const scenario of SCENARIOS) {
    await openScenario(page, scenario, { width: w, height: h });
    await inject(page);
    await page.evaluate(async () => {
      for (const d of window.__uxAudit.all().filter((e) => e.localName === "details")) d.open = true;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const m = await measure();
    const flag = m.pageHScroll > 0 || (m.sheetBodyHScroll ?? 0) > 0 || m.hscroll.length ? "FAIL" : "ok  ";
    console.log(`${flag} ${w}x${h} ${scenario.padEnd(24)} pageH=${m.pageHScroll} pageV=${m.pageVScroll} bodyH=${m.sheetBodyHScroll} hscrollers=${m.hscroll.length} clipped=${m.clipped.length}${m.clipped.length ? " :: " + m.clipped.slice(0, 3).join(" | ") : ""}`);
  }
}

console.log("\n== Dialog fit (rect vs viewport; is it reachable?)");
for (const [w, h] of [[320, 844], [320, 256], [844, 390]]) {
  for (const [dialog, base] of DIALOGS) {
    await openScenario(page, base, {
      width: w, height: h,
      patch: { dialog, ...(dialog === "confirmResetCadence" ? { cadenceResetRequest: { planId: "daily", roomId: "room-a", mode: "mop" } } : {}) },
    });
    await inject(page);
    const d = await page.evaluate(() => {
      const a = window.__uxAudit;
      const dlg = a.all().find((e) => e.classList?.contains("dialog") && a.visible(e));
      if (!dlg) return null;
      const r = dlg.getBoundingClientRect();
      const btns = [...dlg.querySelectorAll("button")].map((b) => { const q = b.getBoundingClientRect(); return { n: b.textContent.trim().slice(0, 18), top: Math.round(q.top), bottom: Math.round(q.bottom) }; });
      const backdrop = dlg.parentElement;
      const cs = getComputedStyle(dlg), bs = getComputedStyle(backdrop);
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width), vh: innerHeight, overflowY: cs.overflowY, maxH: cs.maxBlockSize, backdropOverflow: bs.overflowY, btns };
    });
    if (!d) { console.log(`  ${w}x${h} ${dialog}: not found`); continue; }
    const clippedBtns = d.btns.filter((b) => b.bottom > d.vh || b.top < 0).map((b) => b.n);
    console.log(`${d.top < 0 || d.bottom > d.vh ? "FAIL" : "ok  "} ${w}x${h} ${dialog.padEnd(20)} dialog ${d.w}x${d.h} y=${d.top}..${d.bottom} of vh ${d.vh} overflowY=${d.overflowY} maxBlock=${d.maxH} backdropOverflow=${d.backdropOverflow} buttonsOutsideViewport=${JSON.stringify(clippedBtns)}`);
  }
}
await browser.close();
