// Design-system census on the plan editor + control sizing + surface nesting +
// HA-theme sentinel render.   usage: node tests/browser/ux-audit-tools/ds.mjs
import { launch, openScenario, inject, outputPath } from "./common.mjs";
const { browser, context } = await launch();
const page = await context.newPage();

const openAllDetails = () => page.evaluate(async () => {
  for (const d of window.__uxAudit.all().filter((e) => e.localName === "details")) d.open = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});

// ---- 1. Type scale census (plan editor, schedule open) -------------------
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await openScenario(page, "plan-cadence-shared", { width: w, height: h });
  await inject(page);
  await openAllDetails();
  const census = await page.evaluate(() => {
    const a = window.__uxAudit;
    const wf = a.shell().shadowRoot.querySelector("matic-map-workflow-v4");
    const regions = [wf.shadowRoot, a.shell().shadowRoot.querySelector(".panel-heading"), a.shell().shadowRoot.querySelector(".action-bar"), a.shell().shadowRoot.querySelector(".sheet-grip, .status-strip")].filter(Boolean);
    const pairs = new Map();
    const sizes = new Map();
    const weights = new Map();
    const spacings = new Map();
    const visit = (root) => {
      const list = root.querySelectorAll ? [...root.querySelectorAll("*")] : [];
      for (const e of list) {
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(e);
        const key = `${cs.fontSize}/${cs.fontWeight}`;
        const ex = `${e.localName}.${[...e.classList].slice(0, 1).join("")}`;
        const p = pairs.get(key) ?? { n: 0, ex: new Set() };
        p.n += 1; if (p.ex.size < 3) p.ex.add(ex); pairs.set(key, p);
        sizes.set(cs.fontSize, (sizes.get(cs.fontSize) ?? 0) + 1);
        weights.set(cs.fontWeight, (weights.get(cs.fontWeight) ?? 0) + 1);
        const ls = cs.letterSpacing + (cs.textTransform !== "none" ? "+" + cs.textTransform : "");
        spacings.set(ls, (spacings.get(ls) ?? 0) + 1);
      }
    };
    for (const r of regions) visit(r);
    return {
      sizes: [...sizes].sort(), weights: [...weights].sort(), spacings: [...spacings],
      pairs: [...pairs].map(([k, v]) => `${k} x${v.n} (${[...v.ex].join(", ")})`).sort(),
    };
  });
  console.log(`\n== Type census plan editor @${w}: ${census.sizes.length} sizes, ${census.weights.length} weights, ${census.pairs.length} size/weight pairs`);
  console.log("  sizes:", JSON.stringify(census.sizes));
  console.log("  weights:", JSON.stringify(census.weights));
  console.log("  letter-spacing/transform:", JSON.stringify(census.spacings));
  for (const p of census.pairs) console.log("   ", p);
}

// ---- 2. Undefined token consequence: summary font-weight ------------------
await openScenario(page, "plan-cadence-shared", { width: 390, height: 844 });
await inject(page);
await openAllDetails();
console.log("\n== --ms-w-semibold (undefined) on .cadence-config > summary:");
console.log(JSON.stringify(await page.evaluate(() => {
  const a = window.__uxAudit;
  const s = a.all().find((e) => e.localName === "summary" && a.visible(e));
  const cs = getComputedStyle(s);
  const host = a.shell().shadowRoot.querySelector("matic-map-workflow-v4");
  return { fontWeight: cs.fontWeight, fontSize: cs.fontSize, token: getComputedStyle(host).getPropertyValue("--ms-w-semibold") || "(undefined)", strongSibling: getComputedStyle(a.all().find((e) => e.matches(".plan-option-copy strong") && a.visible(e))).fontWeight };
})));

// ---- 3. Control height census (390) ---------------------------------------
await openScenario(page, "plan-cadence-shared", { width: 390, height: 844 });
await inject(page);
await openAllDetails();
const heights = await page.evaluate(() => {
  const a = window.__uxAudit;
  const groups = {};
  const add = (k, e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); (groups[k] ??= new Map()).set(`${Math.round(r.height * 10) / 10}h x ${Math.round(r.width)}w r=${cs.borderTopLeftRadius} fs=${cs.fontSize}`, 0); };
  for (const e of a.all()) {
    if (!a.visible(e) || e.closest(".skip-link")) continue;
    if (e.localName === "input") add("input[" + (e.type) + "]" + (e.type === "checkbox" ? "(box)" : ""), e);
    else if (e.localName === "select") add("select", e);
    else if (e.localName === "summary") add("summary", e);
    else if (e.localName === "label" && e.querySelector("input[type=checkbox]")) add("label>checkbox (hit row)", e);
    else if (e.localName === "button") add("button" + (e.className.match(/ms-btn--(sm|lg|icon)|ms-switch|icon-button|sheet-back/g) || []).join("+"), e);
  }
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, [...v.keys()]]));
});
console.log("\n== Control box census @390 (plan-cadence-shared, schedule open)");
for (const [k, v] of Object.entries(heights)) console.log(`  ${k.padEnd(34)} ${v.join(" | ")}`);

// ---- 4. Surface nesting depth ---------------------------------------------
const nesting = await page.evaluate(() => {
  const a = window.__uxAudit;
  const sheet = a.shell().shadowRoot.querySelector(".mobile-sheet, .inspector");
  const paint = (cs) => {
    const hasBorder = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs["border" + s + "Width"]) > 0 && cs["border" + s + "Style"] !== "none" && !/rgba\(\d+, \d+, \d+, 0\)/.test(cs["border" + s + "Color"]));
    const bg = cs.backgroundColor;
    const hasBg = !/rgba\(\d+, \d+, \d+, 0\)/.test(bg) && bg !== "transparent";
    return { hasBorder, hasBg, bg };
  };
  const parentOf = (e) => e.parentElement || (e.getRootNode() instanceof ShadowRoot ? e.getRootNode().host : null);
  const results = [];
  for (const e of a.all()) {
    if (!a.visible(e) || !e.matches(a.INTERACTIVE) || !sheet.contains(e) && !(e.getRootNode() instanceof ShadowRoot && sheet.contains(e.getRootNode().host))) continue;
    const chain = [];
    let n = e; let lastBg = null;
    for (let i = 0; i < 40 && n && n !== sheet; i += 1) {
      const cs = getComputedStyle(n);
      const p = paint(cs);
      const surface = (n === e) ? false : (p.hasBorder || (p.hasBg && p.bg !== lastBg));
      if (n === e) { /* the control itself */ lastBg = null; }
      if (surface) { chain.push(`${n.localName}${n.className ? "." + String(n.className).split(" ").slice(0, 2).join(".") : ""}[${p.hasBorder ? "border" : ""}${p.hasBg ? " bg" : ""}]`); }
      if (p.hasBg) lastBg = p.bg;
      n = parentOf(n);
    }
    results.push({ name: a.name(e).slice(0, 30), tag: e.localName, depth: chain.length, chain });
  }
  results.sort((x, y) => y.depth - x.depth);
  const hist = {};
  for (const r of results) hist[r.depth] = (hist[r.depth] ?? 0) + 1;
  return { hist, deepest: results.slice(0, 3) };
});
console.log("\n== Bordered/filled ancestor surfaces above each control (plan editor @390), histogram depth->count:", JSON.stringify(nesting.hist));
for (const d of nesting.deepest) console.log(`   depth ${d.depth}: ${d.tag} "${d.name}" <- ${d.chain.join(" < ")}`);

// ---- 5. Button census (wide) ----------------------------------------------
for (const [sc, w, h] of [["ready", 1440, 900], ["plan-saved-intelligent", 1440, 900], ["draw", 1440, 900]]) {
  await openScenario(page, sc, { width: w, height: h });
  await inject(page);
  const b = await page.evaluate(() => {
    const a = window.__uxAudit; const out = new Map();
    for (const e of a.all()) {
      if (e.localName !== "button" || !a.visible(e) || e.closest(".skip-link")) continue;
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      const label = (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 20);
      const k = `${Math.round(r.width)}x${Math.round(r.height)} r=${cs.borderTopLeftRadius} fs=${cs.fontSize} fw=${cs.fontWeight}`;
      const v = out.get(k) ?? []; if (v.length < 3) v.push(label); out.set(k, v);
    }
    return [...out].map(([k, v]) => `${k}  <- ${v.join(", ")}`);
  });
  console.log(`\n== Button boxes ${sc} @${w}: ${b.length} distinct`);
  for (const l of b) console.log("   ", l);
}

// ---- 6. HA-theme sentinel render ------------------------------------------
const SENT = {
  "--primary-color": "#ff6a00", "--text-primary-color": "#000000", "--primary-background-color": "#003300",
  "--card-background-color": "#330033", "--secondary-background-color": "#333300", "--primary-text-color": "#ffffcc",
  "--secondary-text-color": "#ccffff", "--divider-color": "#ff00ff", "--disabled-text-color": "#888888",
  "--error-color": "#ff3333", "--warning-color": "#ffcc00", "--success-color": "#00ff88",
  "--app-header-background-color": "#000066", "--app-header-text-color": "#ffffff",
};
for (const [scheme, sc, w, h, tag] of [["light", "plan-saved-intelligent", 390, 844, "plan390"], ["dark", "rooms", 390, 844, "rooms390"], ["light", "ready", 1440, 900, "ready1440"]]) {
  await openScenario(page, sc, { width: w, height: h, theme: scheme });
  await inject(page);
  await page.evaluate((vars) => { for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v); }, SENT);
  await page.waitForTimeout(400);
  const resolved = await page.evaluate(() => {
    const a = window.__uxAudit; const cs = getComputedStyle(a.shell());
    return Object.fromEntries(["--ms-accent", "--ms-on-accent", "--ms-surface-app", "--ms-surface-card", "--ms-surface-sunken", "--ms-surface-bar", "--ms-text", "--ms-text-quiet", "--ms-line", "--ms-danger", "--ms-warning", "--ms-success"].map((k) => [k, cs.getPropertyValue(k).trim().slice(0, 60)]));
  });
  console.log(`\n== sentinel theme ${scheme} ${tag}: ${JSON.stringify(resolved)}`);
  await page.screenshot({ path: outputPath(`sentinel-${tag}-${scheme}.png`) });
}
await browser.close();
