// Touch-target audit: every visible interactive element's box (getBoundingClientRect)
// at 390x844, flagging effective targets under 44x44 CSS px.
// usage: node tests/browser/ux-audit-tools/touch.mjs [width] [height] scenarios...
import { launch, openScenario, inject } from "./common.mjs";

const width = Number(process.argv[2] ?? 390);
const height = Number(process.argv[3] ?? 844);
const SCENARIOS = process.argv.slice(4).length
  ? process.argv.slice(4)
  : ["plan-saved-intelligent", "rooms", "draw"];

const { browser, context } = await launch();
const page = await context.newPage();
const all = [];
for (const scenario of SCENARIOS) {
  await openScenario(page, scenario, { width, height });
  await inject(page);
  // Open every collapsed <details> so hidden controls are measurable.
  await page.evaluate(async () => {
    const a = window.__uxAudit;
    for (const d of a.all().filter((e) => e.localName === "details")) d.open = true;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const rows = await page.evaluate(() => {
    const a = window.__uxAudit;
    return a.all()
      .filter((e) => e.matches(a.INTERACTIVE) && a.visible(e) && !e.closest(".skip-link") && e.localName !== "section")
      .map((e) => {
        const d = a.describe(e);
        // Native checkbox / radio inside a <label>: the label is the click target.
        const effW = d.labelW && (d.type === "checkbox" || d.type === "radio") ? Math.max(d.w, d.labelW) : d.w;
        const effH = d.labelH && (d.type === "checkbox" || d.type === "radio") ? Math.max(d.h, d.labelH) : d.h;
        const cs = getComputedStyle(e);
        return { ...d, effW, effH, fontSize: cs.fontSize, ariaPressed: e.getAttribute("aria-pressed") };
      });
  });
  for (const r of rows) all.push({ scenario, ...r });
  const bad = rows.filter((r) => r.effW < 43.5 || r.effH < 43.5);
  console.log(`\n== ${scenario} @${width}x${height}: ${rows.length} interactive, ${bad.length} below 44x44 (effective)`);
  for (const r of bad) {
    console.log(`  ${r.tag}${r.type ? "[" + r.type + "]" : ""} "${r.name}" own ${r.w}x${r.h}` +
      (r.labelW ? ` label ${r.labelW}x${r.labelH}` : "") + ` eff ${r.effW}x${r.effH}  <${r.path}>`);
  }
}
await browser.close();
