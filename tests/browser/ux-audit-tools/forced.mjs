// Forced-colors + reduced-motion probe: computed styles of the state-bearing
// controls under emulated forced-colors:active, plus motion properties under
// prefers-reduced-motion: reduce. usage: node tests/browser/ux-audit-tools/forced.mjs
import { launch, openScenario, inject, outputPath } from "./common.mjs";

const { browser, context } = await launch();
const page = await context.newPage();

const probe = (selectorList) => page.evaluate((sels) => {
  const a = window.__uxAudit;
  const out = {};
  for (const [label, sel] of Object.entries(sels)) {
    const el = a.all().find((e) => { try { return e.matches(sel) && a.visible(e); } catch { return false; } });
    if (!el) { out[label] = null; continue; }
    const cs = getComputedStyle(el);
    out[label] = {
      color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor + " " + cs.borderTopWidth + " " + cs.borderTopStyle,
      outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor,
      fca: cs.forcedColorAdjust, boxShadow: cs.boxShadow === "none" ? "none" : "yes",
      transition: cs.transitionDuration, anim: cs.animationDuration, text: (el.textContent || "").trim().slice(0, 24),
    };
  }
  return out;
}, selectorList);

const SELS = {
  primaryEnabled: ".ms-btn--primary:not([aria-disabled='true']):not(.skip-link)",
  primaryDisabled: ".action-bar .ms-btn--primary[aria-disabled='true']",
  secondary: ".ms-btn--secondary",
  pressedBtn: ".ms-btn[aria-pressed='true']",
  selectedRow: ".ms-row[data-selected='true'], .ms-row[aria-pressed='true'], .ms-row[aria-current='true']",
  disabledRow: ".ms-row[aria-disabled='true']",
  field: ".ms-field > input, .ms-field > select, .ms-select",
  switchOn: ".ms-switch[aria-checked='true']",
  checkbox: "input[type='checkbox']",
  sheetHandle: ".sheet-handle",
  statusIcon: ".status-icon",
};

for (const [scenario, w, h, tag] of [["rooms", 390, 844, "rooms"], ["plan-saved-intelligent", 390, 844, "plan"], ["ready", 1440, 900, "ready-wide"], ["draw", 390, 844, "draw"]]) {
  await openScenario(page, scenario, { width: w, height: h, forced: true });
  await inject(page);
  console.log(`\n=== forced-colors ${scenario} ${w}x${h}`);
  console.log(JSON.stringify(await probe(SELS), null, 1).replace(/\n\s+/g, " "));
}

// Primary-button label legibility in forced colors: compare text colour vs its own background.
await openScenario(page, "plan-saved-intelligent", { width: 390, height: 844, forced: true });
await inject(page);
const prim = await page.evaluate(() => {
  const a = window.__uxAudit;
  const b = a.all().find((e) => e.matches(".action-bar .ms-btn--primary") && a.visible(e));
  const cs = getComputedStyle(b);
  const r = a.rect(b);
  return { text: b.textContent.trim(), color: cs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage, rect: r, fca: cs.forcedColorAdjust, ariaDisabled: b.getAttribute("aria-disabled") };
});
console.log("\nprimary button (plan, forced):", JSON.stringify(prim));
await page.screenshot({ path: outputPath("forced-primary.png"), clip: { x: 0, y: 740, width: 390, height: 104 } });
// Before/after for MS-DS-01: the same button with forced-color-adjust:none set inline.
const barClip = { x: 0, y: 760, width: 390, height: 84 };
await page.screenshot({ path: outputPath("forced-primary-before.png"), clip: barClip });
await page.evaluate(() => {
  const a = window.__uxAudit;
  const b = a.all().find((e) => e.matches(".action-bar .ms-btn--primary") && a.visible(e));
  b.style.setProperty("forced-color-adjust", "none");
});
await page.waitForTimeout(200);
await page.screenshot({ path: outputPath("forced-primary-after.png"), clip: barClip });

// Focus ring survival: tab to a control in forced colors and read outline.
for (const forced of [true, false]) {
  await openScenario(page, "rooms", { width: 390, height: 844, forced });
  await inject(page);
  await page.keyboard.press("Tab"); // skip link 1
  await page.keyboard.press("Tab"); // skip link 2
  await page.keyboard.press("Tab"); // first real control
  const f = await page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    const cs = getComputedStyle(el);
    return { tag: el.localName, name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}` };
  });
  console.log(`\nfocus ring forced=${forced}:`, JSON.stringify(f));
}

// Reduced motion: transition/animation durations + sheet transition + spinner animations.
for (const reduced of ["reduce", "no-preference"]) {
  await openScenario(page, "plan-saved-intelligent", { width: 390, height: 844, reduced });
  await inject(page);
  const m = await page.evaluate(() => {
    const a = window.__uxAudit;
    const sheet = a.shell().shadowRoot.querySelector(".mobile-sheet");
    const btn = a.all().find((e) => e.matches(".ms-btn") && a.visible(e));
    const running = document.getAnimations({ subtree: true }).filter((x) => x.playState === "running").length;
    const cs = getComputedStyle(sheet), cb = getComputedStyle(btn);
    return { sheetTransition: cs.transitionProperty + " " + cs.transitionDuration, btnTransition: cb.transitionDuration, fastToken: getComputedStyle(a.shell()).getPropertyValue("--ms-fast"), runningAnimations: running };
  });
  console.log(`\nreduced-motion=${reduced}:`, JSON.stringify(m));
}
await browser.close();
