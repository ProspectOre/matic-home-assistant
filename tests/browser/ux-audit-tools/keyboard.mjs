// Keyboard scripts for Map Studio v4 (gallery). Each step prints PASS/FAIL with the
// observed active element. usage: node tests/browser/ux-audit-tools/keyboard.mjs
import { launch, openScenario, inject, settle, sleep, GALLERY_TAG } from "./common.mjs";

const { browser, context } = await launch();
const page = await context.newPage();
const results = [];
const log = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

const active = () => page.evaluate(() => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body) return { tag: "body", name: "", cls: "", inShell: false, rect: null };
  const label = (el.getAttribute("aria-label") || el.textContent || el.value || "").trim().replace(/\s+/g, " ").slice(0, 44);
  const r = el.getBoundingClientRect();
  const root = el.getRootNode();
  return {
    tag: el.localName, cls: [...el.classList].slice(0, 3).join("."), name: label, id: el.id,
    tabindex: el.getAttribute("tabindex"), inShell: true,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1,
  };
});
const fmt = (a) => `${a.tag}${a.cls ? "." + a.cls : ""} "${a.name}"`;
const snap = () => page.evaluate((tag) => {
  const s = document.querySelector(tag).getWorkspaceSnapshot();
  return { workflow: s.workflow, dialog: s.dialog, precisionOpen: s.precisionOpen, fullMap: s.fullMap };
}, GALLERY_TAG);
const tabTo = async (pred, max = 60, shift = false) => {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(shift ? "Shift+Tab" : "Tab");
    const a = await active();
    if (pred(a)) return { ok: true, steps: i + 1, a };
  }
  return { ok: false, steps: max, a: await active() };
};
const settleAll = async () => { await settle(page); await sleep(150); };

// ---------- K1: Tab order on `ready` (phone + desktop) ----------
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await openScenario(page, "ready", { width: w, height: h });
  await inject(page);
  const order = [];
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press("Tab");
    const a = await active();
    order.push(`${i + 1}:${a.tag}.${a.cls.split(".")[0] || ""}"${a.name.slice(0, 22)}"${a.inViewport === false ? "(offscreen)" : ""}`);
  }
  console.log(`\nK1 tab order ready ${w}x${h}:\n  ` + order.join("\n  "));
}

// ---------- K2: Rooms launcher -> heading focus -> Escape -> launcher ----------
for (const [w, h] of [[390, 844], [1440, 900]]) {
  console.log(`\n--- K2 rooms open/close @${w}x${h}`);
  await openScenario(page, "ready", { width: w, height: h });
  await inject(page);
  const t = await tabTo((a) => /One-time clean/.test(a.name));
  log(`K2a Tab reaches "One-time clean" launcher @${w}`, t.ok, `after ${t.steps} Tab presses -> ${fmt(t.a)}`);
  await page.keyboard.press("Enter");
  await settleAll();
  let a = await active();
  log(`K2b Enter opens Rooms; focus moves to workflow heading @${w}`, a.tag === "h2" && /Choose rooms/.test(a.name), `focus = ${fmt(a)} state=${JSON.stringify(await snap())}`);
  await page.keyboard.press("Escape");
  await settleAll();
  a = await active();
  const s = await snap();
  log(`K2c Escape closes Rooms (workflow none) @${w}`, s.workflow === "none", JSON.stringify(s));
  log(`K2d Focus returns to the "One-time clean" launcher @${w}`, /One-time clean/.test(a.name), `focus = ${fmt(a)}`);
}

// ---------- K3: plan editor heading focus + Escape ----------
for (const [w, h] of [[390, 844], [1440, 900]]) {
  console.log(`\n--- K3 plan editor @${w}x${h}`);
  await openScenario(page, "ready", { width: w, height: h });
  await inject(page);
  let t = await tabTo((x) => /Run a plan/.test(x.name));
  await page.keyboard.press("Enter");
  await settleAll();
  let a = await active();
  log(`K3a Run a plan -> Plans heading focus @${w}`, a.tag === "h2" && /Your plans/.test(a.name), `focus = ${fmt(a)}`);
  t = await tabTo((x) => x.tag === "button" && !/Back|workspace|sidebar|Map options|Show|Fit|3D|2D/.test(x.name) && x.name.length > 3, 12);
  console.log("   first plan-list control after heading:", fmt(t.a));
  await page.keyboard.press("Enter");
  await settleAll();
  a = await active();
  const s = await snap();
  log(`K3b Plan list -> plan editor heading focus @${w}`, s.workflow === "plan" && a.tag === "h2", `workflow=${s.workflow} focus = ${fmt(a)}`);
  await page.keyboard.press("Escape");
  await settleAll();
  a = await active();
  const s2 = await snap();
  log(`K3c Escape from plan editor returns to plans list @${w}`, s2.workflow === "plans", JSON.stringify(s2));
  log(`K3d Focus restored to the plan row that opened the editor @${w}`, a.tag !== "h2" && a.tag !== "body", `focus = ${fmt(a)}`);
}

// ---------- K4: Escape ordering dialog -> precision -> Full map -> workflow ----------
for (const [w, h] of [[390, 844], [1440, 900]]) {
  for (const dialog of ["confirmStop", "discardDraft"]) {
    console.log(`\n--- K4 Escape ordering @${w}x${h} dialog=${dialog}`);
    await openScenario(page, "draw", { width: w, height: h, patch: { workflow: "draw", precisionOpen: true, fullMap: true, dialog } });
    await inject(page);
    // put focus inside the shell via the dialog's own initial focus (what a user would have)
    await settleAll();
    let a = await active();
    console.log("   initial focus:", fmt(a), JSON.stringify(await snap()));
    const seq = [];
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Escape");
      await settleAll();
      const s = await snap();
      a = await active();
      seq.push({ s, a: fmt(a), inShell: a.inShell });
      console.log(`   Esc#${i + 1} -> ${JSON.stringify(s)} focus=${fmt(a)}`);
    }
    const order = seq.map((x) => x.s);
    const dialogGone = order[0].dialog === null;
    const precisionNext = dialogGone && order[1].precisionOpen === false;
    const fullMapNext = order[2].fullMap === false;
    const workflowNext = order[3].workflow === "none";
    log(`K4 ${dialog} @${w}: Esc1 closes dialog`, dialogGone, JSON.stringify(order[0]));
    log(`K4 ${dialog} @${w}: Esc2 closes precision`, precisionNext, JSON.stringify(order[1]));
    log(`K4 ${dialog} @${w}: Esc3 leaves Full map`, fullMapNext, JSON.stringify(order[2]));
    log(`K4 ${dialog} @${w}: Esc4 leaves workflow`, workflowNext, JSON.stringify(order[3]));
    log(`K4 ${dialog} @${w}: focus stays inside the shell after every Esc (so the next Esc works)`, seq.every((x) => x.inShell), seq.map((x) => x.a).join(" | "));
  }
}

// ---------- K5: dialog focus trap + inert background ----------
for (const [w, h] of [[390, 844]]) {
  await openScenario(page, "cleaning", { width: w, height: h, patch: { dialog: "confirmStop" } });
  await inject(page);
  await settleAll();
  const seen = [];
  let a = await active();
  seen.push(fmt(a));
  for (let i = 0; i < 4; i += 1) { await page.keyboard.press("Tab"); a = await active(); seen.push(fmt(a)); }
  const inDialog = await page.evaluate(() => {
    const shell = document.querySelector("matic-map-studio-gallery-v0-4-0").shadowRoot.querySelector(".stage").firstElementChild;
    const dlg = shell.shadowRoot.querySelector(".dialog");
    let el = shell.shadowRoot.activeElement;
    return Boolean(dlg && el && dlg.contains(el));
  });
  log("K5a Tab cycles inside dialog (4 Tabs)", inDialog, seen.join(" -> "));
  const inertApp = await page.evaluate(() => {
    const shell = document.querySelector("matic-map-studio-gallery-v0-4-0").shadowRoot.querySelector(".stage").firstElementChild;
    return shell.shadowRoot.querySelector(".app").hasAttribute("inert");
  });
  log("K5b Background .app is inert while dialog open", inertApp, `inert=${inertApp}`);
  await page.keyboard.press("Shift+Tab");
  a = await active();
  log("K5c Shift+Tab stays in dialog", /Keep cleaning|Stop/.test(a.name), fmt(a));
}

// ---------- K6: draw toolbar roving focus ----------
await openScenario(page, "draw", { width: 390, height: 844 });
await inject(page);
{
  const t = await tabTo((x) => x.tag === "button" && /Zone|Paint|Erase|Move map/.test(x.name), 30);
  log("K6a Tab reaches the draw toolbar (one stop)", t.ok, `${t.steps} Tabs -> ${fmt(t.a)}`);
  await page.keyboard.press("ArrowRight");
  const a1 = await active();
  await page.keyboard.press("ArrowRight");
  const a2 = await active();
  log("K6b ArrowRight moves between tools", a1.name !== t.a.name && a2.name !== a1.name, `${fmt(t.a)} -> ${fmt(a1)} -> ${fmt(a2)}`);
  await page.keyboard.press("Tab");
  const a3 = await active();
  log("K6c Tab leaves the toolbar (roving, single tab stop)", !/Zone|Paint|Erase|Move map|Undo|Redo|Brush/.test(a3.name), fmt(a3));
}

// ---------- K7: overflow menu + help dialog Escape/focus return ----------
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await openScenario(page, "ready", { width: w, height: h });
  await inject(page);
  let t = await tabTo((x) => /Map options/.test(x.name));
  await page.keyboard.press("Enter");
  await settleAll();
  let a = await active();
  log(`K7a Map options opens and focus enters the menu @${w}`, /Scene detail|Auto/.test(a.name) || a.tag === "select", fmt(a));
  await page.keyboard.press("Escape");
  await settleAll();
  a = await active();
  log(`K7b Escape closes menu, focus returns to Map options @${w}`, /Map options/.test(a.name), fmt(a));
  // Help
  const help = await page.evaluate(() => {
    const a = window.__uxAudit; const el = a.all().find((e) => /How to move the map/.test(e.getAttribute("aria-label") || e.textContent || "") && e.localName === "button" && a.visible(e));
    return el ? { name: el.getAttribute("aria-label") || el.textContent.trim() } : null;
  });
  if (help) {
    t = await tabTo((x) => x.tag === "button" && /How to move the map/.test(x.name), 80);
    await page.keyboard.press("Enter");
    await settleAll();
    a = await active();
    log(`K7c Help opens, focus enters dialog @${w}`, /Close/.test(a.name), fmt(a));
    await page.keyboard.press("Escape");
    await settleAll();
    a = await active();
    log(`K7d Escape closes help, focus returns to launcher @${w}`, /How to move the map/.test(a.name), fmt(a));
  } else {
    console.log(`   (help launcher not rendered @${w} state ready)`);
  }
}

// ---------- K8: Full map enter/exit via keyboard ----------
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await openScenario(page, "ready", { width: w, height: h });
  await inject(page);
  const t = await tabTo((x) => /Hide cleaning panel/.test(x.name));
  await page.keyboard.press("Enter");
  await settleAll();
  let a = await active();
  log(`K8a Full map entered; focus stays on toggle @${w}`, /Show cleaning panel/.test(a.name), `${fmt(a)} ${JSON.stringify(await snap())}`);
  await page.keyboard.press("Escape");
  await settleAll();
  a = await active();
  const s = await snap();
  log(`K8b Escape leaves Full map, focus returns to toggle @${w}`, s.fullMap === false && /Hide cleaning panel/.test(a.name), `${fmt(a)} ${JSON.stringify(s)}`);
}

// ---------- K9: skip links ----------
await openScenario(page, "ready", { width: 390, height: 844 });
await inject(page);
{
  await page.keyboard.press("Tab");
  let a = await active();
  const vis = await page.evaluate(() => {
    const a = window.__uxAudit;
    const el = a.all().find((e) => e.classList?.contains("skip-link") && e.getRootNode().activeElement === e);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), clip: cs.clipPath };
  });
  log("K9a First Tab stop is a visible Skip link", /Skip to the map$/.test(a.name) && vis && vis.clip === "none", `${fmt(a)} ${JSON.stringify(vis)}`);
  await page.keyboard.press("Enter");
  await settleAll();
  a = await active();
  log("K9b Skip to the map focuses the canvas (map-root)", /Interactive Matic 3D map/.test(a.name) || a.cls.includes("map-root"), fmt(a));
}

await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - fails.length} PASS / ${fails.length} FAIL`);
for (const f of fails) console.log("  FAIL:", f.id);
