// Follow-up keyboard probes that verify the root cause behind the K-failures
// in keyboard.mjs (select swallowing Escape, lost focus after dialog close,
// help dialog on phone, pure Escape ordering with focus re-seeded each press).
import { launch, openScenario, inject, settle, sleep, GALLERY_TAG } from "./common.mjs";

const { browser, context } = await launch();
const page = await context.newPage();
const active = () => page.evaluate(() => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body) return "body";
  return `${el.localName}${el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : ""} "${(el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 36)}"`;
});
const snap = () => page.evaluate((tag) => {
  const s = document.querySelector(tag).getWorkspaceSnapshot();
  return JSON.stringify({ workflow: s.workflow, dialog: s.dialog, precisionOpen: s.precisionOpen, fullMap: s.fullMap });
}, GALLERY_TAG);
const dom = (sel) => page.evaluate((s) => {
  const a = window.__uxAudit;
  return a.all().some((e) => e.matches(s) && a.visible(e));
}, sel);
const tabTo = async (re, max = 80) => {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    if (re.test(await active())) return i + 1;
  }
  return -1;
};
const go = async () => { await settle(page); await sleep(200); };

console.log("== P1 Overflow menu: Escape while focus is on the auto-focused <select>");
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await openScenario(page, "ready", { width: w, height: h });
  await inject(page);
  await tabTo(/Map options/);
  await page.keyboard.press("Enter"); await go();
  const f0 = await active(); const open0 = await dom("#map-options");
  await page.keyboard.press("Escape"); await go();
  const open1 = await dom("#map-options"); const f1 = await active();
  console.log(`  @${w}: after open focus=${f0} menuOpen=${open0}; after Escape menuOpen=${open1} focus=${f1}`);
  await page.keyboard.press("Tab"); await page.keyboard.press("Escape"); await go();
  console.log(`  @${w}: Tab to menu row then Escape -> menuOpen=${await dom("#map-options")} focus=${await active()}`);
}

console.log("\n== P2 Help dialog on phone (launcher is in sheet body)");
for (const [w, h] of [[390, 844]]) {
  await openScenario(page, "ready", { width: w, height: h });
  await inject(page);
  console.log("  Tab count to launcher:", await tabTo(/How to move the map/));
  await page.keyboard.press("Enter"); await go();
  console.log("  after Enter: focus=", await active(), "dialog present=", await dom(".help-dialog"));
  await page.keyboard.press("Escape"); await go();
  console.log("  after Escape: focus=", await active(), "dialog present=", await dom(".help-dialog"));
}

console.log("\n== P3 Real flow: cleaning -> Stop (action bar) -> Escape -> focus + next Escape");
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await openScenario(page, "cleaning", { width: w, height: h });
  await inject(page);
  const n = await tabTo(/Stop cleaning|^button.*"Stop"/);
  console.log(`  @${w}: Tab count to Stop=${n} focus=${await active()}`);
  await page.keyboard.press("Enter"); await go();
  console.log(`  dialog open: ${await dom(".dialog")} focus=${await active()}`);
  await page.keyboard.press("Escape"); await go();
  console.log(`  after Escape: dialog open=${await dom(".dialog")} focus=${await active()} state=${await snap()}`);
}

console.log("\n== P4 Real flow: plan-dirty -> Back -> Discard dialog -> Escape -> focus");
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await openScenario(page, "plan-dirty", { width: w, height: h });
  await inject(page);
  const n = await tabTo(/Back to plans/);
  console.log(`  @${w}: Tab count to Back=${n} focus=${await active()}`);
  await page.keyboard.press("Enter"); await go();
  console.log(`  dialog: ${await snap()} focus=${await active()}`);
  await page.keyboard.press("Escape"); await go();
  console.log(`  after Escape: ${await snap()} focus=${await active()}`);
}

console.log("\n== P5 Pure Escape ordering (focus re-seeded to a shell button before each Esc)");
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await openScenario(page, "draw", { width: w, height: h, patch: { workflow: "draw", precisionOpen: true, fullMap: true, dialog: "confirmStop" } });
  await inject(page); await go();
  const seq = [await snap()];
  for (let i = 0; i < 5; i += 1) {
    // re-seed focus inside the shell the way a user pressing Tab would
    await page.evaluate(() => {
      const a = window.__uxAudit;
      const b = a.all().find((e) => e.matches(".nav, .workspace-toggle, .overflow") && a.visible(e));
      b?.focus();
    });
    await page.keyboard.press("Escape"); await go();
    seq.push(await snap());
  }
  console.log(`  @${w}: ` + seq.map((s, i) => (i === 0 ? "start " : `Esc${i} `) + s).join("\n         "));
}
await browser.close();
